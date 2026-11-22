"""EcoSonic Geographic Occurrence Intelligence Service.

Integrates the official BirdNET+ Geo V3.0 occurrence model to contextualize acoustic detections
with spatial and seasonal distribution probabilities.

Scientific Guardrails:
1. Acoustic scores and geographic occurrence scores are preserved separately.
   They are NEVER arbitrarily multiplied or combined into a single distorted scalar.
2. Low geographic scores do NOT disprove presence (e.g. rare vagrants, range shifts, migratory flyovers).
3. High geographic scores do NOT prove presence (absence of acoustic signal remains absence).
4. Model classifications are screening probabilities, not certified legal evidence.
"""

from __future__ import annotations

import logging
import math
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, NamedTuple, Optional, Tuple, Union

import numpy as np
import pandas as pd

# Set BIRDNET_APP_DATA to local .model_cache if available
model_cache_path = Path(__file__).resolve().parents[3] / ".model_cache"
if model_cache_path.exists():
    os.environ.setdefault("BIRDNET_APP_DATA", str(model_cache_path))

import birdnet
from app.schemas.environmental_intelligence import (
    AcousticDetectionGeoContext,
    SiteGeoContextResponse,
    SpeciesGeoContext,
)

logger = logging.getLogger(__name__)

SCIENTIFIC_GEO_DISCLAIMER = (
    "Geographic occurrence probabilities represent modeled regional and seasonal suitability from BirdNET Geo V3.0. "
    "They do NOT establish empirical presence or absence. Vagrant species, range expansions, and migratory individuals "
    "may occur in areas with low baseline suitability."
)


class CacheInfo(NamedTuple):
    hits: int
    misses: int
    maxsize: int
    currsize: int


def date_to_birdnet_week(dt: Optional[Union[datetime, str]] = None) -> int:
    """Convert a datetime or date string to BirdNET's standard 48 meteorological weeks (4 weeks/month).

    BirdNET partitions each calendar month into 4 weeks:
    - Month 1..12 -> 4 weeks each = 48 weeks total.
    """
    if dt is None:
        dt = datetime.now(timezone.utc)
    elif isinstance(dt, str):
        try:
            dt = datetime.fromisoformat(dt.replace("Z", "+00:00"))
        except Exception:
            dt = datetime.strptime(dt[:10], "%Y-%m-%d")

    month = dt.month
    day = dt.day
    # Days 1-7 -> week 1, 8-15 -> week 2, 16-23 -> week 3, 24+ -> week 4
    week_in_month = min(4, max(1, int((day - 1) / 7.75) + 1))
    week = (month - 1) * 4 + week_in_month
    return min(48, max(1, week))


class GeoTemporalIntelligenceService:
    """Production service for geographic occurrence modeling and taxonomy resolution."""

    def __init__(self, model_version: str = "3.0") -> None:
        self.model_version = model_version
        self._lock = threading.Lock()
        self._model: Optional[Any] = None
        self._geo_species_to_idx: Dict[str, int] = {}
        self._sci_to_geo_idx: Dict[str, int] = {}
        self._taxonomy_df: Optional[pd.DataFrame] = None
        self._sci_to_birdnet_id: Dict[str, str] = {}
        self._sci_to_ebird_code: Dict[str, str] = {}
        self._sci_to_common_name: Dict[str, str] = {}
        self._prediction_cache: Dict[Tuple[float, float, int], np.ndarray] = {}
        self._max_cache_size = 500
        self._cache_hits = 0
        self._cache_misses = 0

        # Bind predict_species_probabilities method with cache_info attribute
        def _predict(latitude: float, longitude: float, week: Optional[int] = None, recording_date: Optional[Union[datetime, str]] = None) -> np.ndarray:
            return self.get_raw_geo_predictions(latitude, longitude, week, recording_date)

        def _get_cache_info() -> CacheInfo:
            return CacheInfo(
                hits=self._cache_hits,
                misses=self._cache_misses,
                maxsize=self._max_cache_size,
                currsize=len(self._prediction_cache),
            )

        _predict.cache_info = _get_cache_info  # type: ignore[attr-defined]
        self.predict_species_probabilities = _predict

    def load_model(self) -> None:
        """Lazily load the official BirdNET Geo V3.0 ONNX model and taxonomy."""
        if self._model is not None:
            return

        with self._lock:
            if self._model is not None:
                return

            logger.info("Loading BirdNET Geo V%s ONNX model...", self.model_version)
            t0 = datetime.now()
            self._model = birdnet.load("geo", self.model_version, "onnx")
            elapsed = (datetime.now() - t0).total_seconds()
            logger.info(
                "BirdNET Geo V%s loaded successfully in %.2fs (%d species in model).",
                self.model_version,
                elapsed,
                self._model.n_species,
            )

            # Pre-index geo model species list: "Scientific_CommonName"
            for idx, item in enumerate(self._model.species_list):
                species_str = str(item)
                self._geo_species_to_idx[species_str] = idx
                sci = species_str.split("_")[0].strip()
                self._sci_to_geo_idx[sci.lower()] = idx

            # Load taxonomy table
            self._load_taxonomy()

    def _load_taxonomy(self) -> None:
        """Load taxonomy table for stable BirdNET IDs and eBird codes."""
        # Check local cache first
        candidates = [
            model_cache_path / "taxonomy-v3",
            model_cache_path / "acoustic-models" / "v3.0",
            Path(os.environ.get("APPDATA", "")) / "birdnet" / "taxonomy-v3",
        ]

        # 1. Try acoustic labels csv (has birdnet_id, scientific_name, ebird_code)
        labels_file = model_cache_path / "acoustic-models" / "v3.0" / "labels_raw-88d976477fac.csv"
        if labels_file.exists():
            try:
                df = pd.read_csv(labels_file)
                for _, row in df.iterrows():
                    sci = str(row.get("scientific_name", "")).strip().lower()
                    b_id = str(row.get("birdnet_id", ""))
                    ebird = str(row.get("ebird_code", "")) if pd.notna(row.get("ebird_code")) else None
                    com = str(row.get("common_name", ""))
                    if sci:
                        self._sci_to_birdnet_id[sci] = b_id
                        if ebird:
                            self._sci_to_ebird_code[sci] = ebird
                        if com:
                            self._sci_to_common_name[sci] = com
                logger.info("Loaded %d taxonomy entries from acoustic labels CSV.", len(self._sci_to_birdnet_id))
                return
            except Exception as exc:
                logger.warning("Could not read acoustic labels CSV: %s", exc)

        # 2. Try shared taxonomy csv
        for cand in candidates:
            if cand.exists():
                for p in cand.glob("**/*.csv"):
                    try:
                        df = pd.read_csv(p)
                        if "sci_name" in df.columns:
                            for _, row in df.iterrows():
                                sci = str(row["sci_name"]).strip().lower()
                                b_id = f"BN_{row.get('idx', '')}"
                                ebird = str(row.get("species_code", ""))
                                com = str(row.get("com_name", ""))
                                self._sci_to_birdnet_id[sci] = b_id
                                self._sci_to_ebird_code[sci] = ebird
                                self._sci_to_common_name[sci] = com
                            logger.info("Loaded %d taxonomy entries from %s", len(self._sci_to_birdnet_id), p.name)
                            return
                    except Exception as exc:
                        logger.warning("Failed reading taxonomy CSV %s: %s", p, exc)

    def validate_coordinates(self, latitude: float, longitude: float) -> Tuple[float, float]:
        """Validate geographic coordinates."""
        if not (-90.0 <= latitude <= 90.0):
            raise ValueError(f"Latitude must be between -90 and 90 (got {latitude}).")
        if not (-180.0 <= longitude <= 180.0):
            raise ValueError(f"Longitude must be between -180 and 180 (got {longitude}).")
        return float(latitude), float(longitude)

    def get_raw_geo_predictions(
        self,
        latitude: float,
        longitude: float,
        week: Optional[int] = None,
        recording_date: Optional[Union[datetime, str]] = None,
    ) -> np.ndarray:
        """Execute or retrieve cached Geo model probability vector across all 14,082 species.

        Cache key: (round(lat, 3), round(lon, 3), week) ~110m spatial resolution.
        """
        self.load_model()
        lat_clean, lon_clean = self.validate_coordinates(latitude, longitude)

        if week is None:
            week_val = date_to_birdnet_week(recording_date)
        else:
            if week != -1 and not (1 <= week <= 48):
                raise ValueError(f"Week must be -1 or between 1 and 48 (got {week}).")
            week_val = int(week)

        cache_key = (round(lat_clean, 3), round(lon_clean, 3), week_val)
        if cache_key in self._prediction_cache:
            self._cache_hits += 1
            return self._prediction_cache[cache_key]

        self._cache_misses += 1
        # Execute ONNX geo model
        res = self._model.predict(lat_clean, lon_clean, week=week_val)
        probs = res.species_probs.astype(np.float32)

        # Cache management
        if len(self._prediction_cache) >= self._max_cache_size:
            first_key = next(iter(self._prediction_cache))
            del self._prediction_cache[first_key]

        self._prediction_cache[cache_key] = probs
        return probs

    def get_species_occurrence_score(
        self,
        scientific_name: str,
        latitude: float,
        longitude: float,
        week: Optional[int] = None,
        recording_date: Optional[Union[datetime, str]] = None,
    ) -> Optional[float]:
        """Look up geographic occurrence score for a single scientific name."""
        self.load_model()
        sci_clean = scientific_name.strip().lower()
        idx = self._sci_to_geo_idx.get(sci_clean)
        if idx is None:
            # Try prefix match before underscore
            sci_first = sci_clean.split("_")[0].strip()
            idx = self._sci_to_geo_idx.get(sci_first)

        if idx is None:
            return None

        probs = self.get_raw_geo_predictions(latitude, longitude, week, recording_date)
        score = float(probs[idx])
        return round(score, 6)

    def contextualize_acoustic_detection(
        self,
        scientific_name: str,
        acoustic_confidence: float,
        latitude: Optional[float] = None,
        longitude: Optional[float] = None,
        week: Optional[int] = None,
        recording_date: Optional[Union[datetime, str]] = None,
        date: Optional[Union[datetime, str]] = None,
        detection_id: Optional[str] = None,
        live_event_id: Optional[str] = None,
    ) -> AcousticDetectionGeoContext:
        """Contextualize an acoustic detection with regional and seasonal occurrence probabilities.

        Scientific Rules:
        - Acoustic confidence and geographic score are strictly preserved as separate fields.
        - High acoustic confidence + very low geographic score (<0.03) flags the detection for expert review
          without rejecting or suppressing the acoustic observation.
        """
        effective_date = recording_date if recording_date is not None else date
        if week is None and effective_date is not None:
            week = date_to_birdnet_week(effective_date)

        sci_clean = scientific_name.strip().lower()
        birdnet_id = self._sci_to_birdnet_id.get(sci_clean)
        com_name = self._sci_to_common_name.get(sci_clean)

        # Handle missing coordinates safely
        if latitude is None or longitude is None:
            return AcousticDetectionGeoContext(
                detection_id=detection_id,
                live_event_id=live_event_id,
                scientific_name=scientific_name,
                common_name=com_name,
                birdnet_taxonomy_id=birdnet_id,
                acoustic_confidence=acoustic_confidence,
                geographic_score=None,
                occurrence_status="location_unspecified",
                is_unusual_occurrence=False,
                review_recommended=False,
                flag_reason="No geographic coordinates provided for spatial evaluation.",
                disclaimer=SCIENTIFIC_GEO_DISCLAIMER,
            )

        geo_score = self.get_species_occurrence_score(
            scientific_name, latitude, longitude, week, effective_date
        )

        if geo_score is None:
            # Non-avian / non-biological or unmapped class (e.g. chainsaw, vehicle horn)
            return AcousticDetectionGeoContext(
                detection_id=detection_id,
                live_event_id=live_event_id,
                scientific_name=scientific_name,
                common_name=com_name,
                birdnet_taxonomy_id=birdnet_id,
                acoustic_confidence=acoustic_confidence,
                geographic_score=None,
                occurrence_status="not_applicable",
                is_unusual_occurrence=False,
                review_recommended=False,
                flag_reason="Class is non-biological or unmapped in regional occurrence model.",
                disclaimer=SCIENTIFIC_GEO_DISCLAIMER,
            )

        # Categorize occurrence plausibility
        if geo_score >= 0.10:
            occ_status = "expected"
            is_unusual = False
            review_rec = False
            reason = None
        elif geo_score >= 0.03:
            occ_status = "rare"
            is_unusual = False
            review_rec = False
            reason = "Species is known in regional ecosystem but has low seasonal abundance."
        else:
            # Low geographic suitability (< 0.03)
            if acoustic_confidence >= 0.60:
                occ_status = "unexpected"
                is_unusual = True
                review_rec = True
                reason = (
                    f"Unexpected geographic occurrence: high acoustic confidence ({acoustic_confidence:.2f}) with very low geographic suitability ({geo_score:.4f}). "
                    "Possible vagrant, out-of-season migrant, range expansion, or acoustic false positive."
                )
            else:
                occ_status = "unlikely"
                is_unusual = False
                review_rec = False
                reason = "Low geographic suitability and moderate acoustic confidence."

        return AcousticDetectionGeoContext(
            detection_id=detection_id,
            live_event_id=live_event_id,
            scientific_name=scientific_name,
            common_name=com_name,
            birdnet_taxonomy_id=birdnet_id,
            acoustic_confidence=acoustic_confidence,
            geographic_score=geo_score,
            occurrence_status=occ_status,
            is_unusual_occurrence=is_unusual,
            review_recommended=review_rec,
            flag_reason=reason,
            disclaimer=SCIENTIFIC_GEO_DISCLAIMER,
        )

    def get_site_regional_checklist(
        self,
        latitude: float,
        longitude: float,
        week: Optional[int] = None,
        recording_date: Optional[datetime] = None,
        site_id: Optional[str] = None,
        site_name: Optional[str] = None,
        min_score: float = 0.03,
        top_k: int = 50,
    ) -> SiteGeoContextResponse:
        """Generate a regional species checklist and expected occurrence baseline for a monitoring site."""
        self.load_model()
        lat_clean, lon_clean = self.validate_coordinates(latitude, longitude)
        week_val = week if week is not None else date_to_birdnet_week(recording_date)

        probs = self.get_raw_geo_predictions(lat_clean, lon_clean, week=week_val)

        # Rank species by probability
        ranked_indices = np.argsort(probs)[::-1]

        expected_count = int(np.sum(probs >= 0.10))
        rare_count = int(np.sum((probs >= 0.03) & (probs < 0.10)))
        total_regional = int(np.sum(probs >= min_score))

        top_species: List[SpeciesGeoContext] = []
        for idx in ranked_indices[:top_k]:
            score = float(probs[idx])
            if score < min_score:
                break

            species_str = str(self._model.species_list[idx])
            sci = species_str.split("_")[0].strip()
            com = species_str.split("_")[1].strip() if "_" in species_str else self._sci_to_common_name.get(sci.lower())
            b_id = self._sci_to_birdnet_id.get(sci.lower())
            ebird = self._sci_to_ebird_code.get(sci.lower())

            status = "expected" if score >= 0.10 else "rare"

            top_species.append(
                SpeciesGeoContext(
                    scientific_name=sci,
                    common_name=com,
                    birdnet_taxonomy_id=b_id,
                    species_code=ebird,
                    geo_score=round(score, 6),
                    occurrence_status=status,
                    is_unusual_occurrence=False,
                    review_recommended=False,
                )
            )

        return SiteGeoContextResponse(
            site_id=site_id,
            site_name=site_name,
            latitude=lat_clean,
            longitude=lon_clean,
            week=week_val,
            recording_date=recording_date.isoformat() if recording_date else None,
            model_version=f"BirdNET Geo V{self.model_version}",
            total_regional_species=total_regional,
            expected_species_count=expected_count,
            rare_species_count=rare_count,
            top_regional_species=top_species,
            disclaimer=SCIENTIFIC_GEO_DISCLAIMER,
        )


# Global singleton instance
geo_temporal_service = GeoTemporalIntelligenceService()
