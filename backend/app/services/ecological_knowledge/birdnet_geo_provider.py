"""Production implementation of EcologicalKnowledgeProvider backed by BirdNET Geo V3.0."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import numpy as np

from app.schemas.ecological_intelligence import (
    ExpectedSpeciesItem,
    ObservationContext,
)
from app.services.ecological_knowledge.provider_base import (
    EcologicalKnowledgeProvider,
    EcologicalProviderUnavailableError,
    InvalidObservationCoordinatesError,
    canonical_species_id,
)
from app.services.geo_temporal_service import (
    date_to_birdnet_week,
    geo_temporal_service,
    is_non_biological_taxon,
)

logger = logging.getLogger(__name__)


class BirdNetGeoKnowledgeProvider(EcologicalKnowledgeProvider):
    """Ecological knowledge provider utilizing the official BirdNET Geo V3.0 ONNX model.

    Features:
    - 14,082 species occurrence modeling across global geographic coordinates.
    - 48 meteorological weeks capturing annual seasonal migrations and breeding cycles.
    - Deterministic spatial quantization and LRU caching.
    - Non-destructive privacy coarsening (generalized coordinates).
    """

    def __init__(self) -> None:
        self._geo_service = geo_temporal_service

    async def resolve_context(
        self,
        *,
        session_id: str,
        timestamp: datetime,
        duration_sec: float,
        latitude: Optional[float] = None,
        longitude: Optional[float] = None,
        location_name: Optional[str] = None,
        ecosystem_category: Optional[str] = None,
        elevation_m: Optional[float] = None,
        soundscape_metrics: Optional[Dict[str, float]] = None,
        site_metadata: Optional[Dict[str, Any]] = None,
    ) -> ObservationContext:
        """Construct a validated observation context from spatial and temporal parameters."""
        week = date_to_birdnet_week(timestamp)
        date_str = timestamp.strftime("%Y-%m-%d") if timestamp else datetime.now(timezone.utc).strftime("%Y-%m-%d")
        iso_str = timestamp.isoformat() if timestamp else datetime.now(timezone.utc).isoformat()

        # Validate and apply location privacy coarsening
        generalized_coords: Optional[Dict[str, Optional[float]]] = None
        if latitude is not None and longitude is not None:
            try:
                latitude, longitude = self._geo_service.validate_coordinates(latitude, longitude)
            except ValueError as exc:
                raise InvalidObservationCoordinatesError(str(exc)) from exc
            sensitivity = (site_metadata or {}).get("location_sensitivity", "exact")
            if sensitivity == "restricted":
                generalized_coords = {"latitude": None, "longitude": None}
            elif sensitivity == "generalized":
                gen_lat = (site_metadata or {}).get("generalized_latitude", round(latitude, 2))
                gen_lon = (site_metadata or {}).get("generalized_longitude", round(longitude, 2))
                generalized_coords = {"latitude": gen_lat, "longitude": gen_lon}
            else:
                generalized_coords = {
                    "latitude": round(latitude, 2),
                    "longitude": round(longitude, 2),
                }
        elif latitude is not None or longitude is not None:
            raise InvalidObservationCoordinatesError(
                "Both latitude and longitude must be provided together."
            )

        metrics = soundscape_metrics or {}
        aci = metrics.get("aci")
        if aci is None:
            aci = metrics.get("acoustic_complexity_index")
        ndsi = metrics.get("ndsi")
        if ndsi is None:
            ndsi = metrics.get("normalized_difference_soundscape_index")

        total_windows = max(0, int(duration_sec // 3.0))

        return ObservationContext(
            session_id=session_id,
            latitude=latitude,
            longitude=longitude,
            generalized_coordinates=generalized_coords,
            location_name=location_name or "Field Acoustic Station",
            ecosystem_category=ecosystem_category or "unspecified",
            elevation_m=elevation_m,
            timestamp=iso_str,
            observation_date=date_str,
            meteorological_week=week,
            observation_duration_sec=round(duration_sec, 2),
            total_audio_windows=total_windows,
            acoustic_complexity_index=round(aci, 4) if aci is not None else None,
            normalized_difference_soundscape_index=round(ndsi, 4) if ndsi is not None else None,
        )

    def _compute_expected_species_sync(
        self,
        *,
        latitude: float,
        longitude: float,
        week: int,
        min_score: float,
        top_k: int,
    ) -> List[ExpectedSpeciesItem]:
        self._geo_service.load_model()
        lat_clean, lon_clean = self._geo_service.validate_coordinates(latitude, longitude)
        probs = self._geo_service.get_raw_geo_predictions(
            latitude=lat_clean,
            longitude=lon_clean,
            week=week,
        )

        ranked_indices = np.argsort(probs)[::-1]
        expected_list: List[ExpectedSpeciesItem] = []

        for idx in ranked_indices:
            if len(expected_list) >= top_k:
                break
            score = float(probs[idx])
            if score < min_score:
                break

            species_str = str(self._geo_service._model.species_list[idx])
            parts = species_str.split("_", 1)
            sci = parts[0].strip()
            com = (
                parts[1].strip()
                if len(parts) > 1
                else self._geo_service._sci_to_common_name.get(sci.lower())
            )
            if is_non_biological_taxon(sci, com):
                continue

            b_id = self._geo_service._sci_to_birdnet_id.get(sci.lower())
            ebird = self._geo_service._sci_to_ebird_code.get(sci.lower())
            sp_id = canonical_species_id(sci, b_id)

            if score >= 0.20:
                status = "frequent"
            elif score >= 0.10:
                status = "expected"
            else:
                status = "rare"

            expected_list.append(
                ExpectedSpeciesItem(
                    species_id=sp_id,
                    scientific_name=sci,
                    common_name=com or sci,
                    occurrence_score=round(score, 4),
                    occurrence_status=status,
                    birdnet_taxonomy_id=b_id,
                    ebird_code=ebird,
                )
            )

        return expected_list

    async def get_expected_species(
        self,
        context: ObservationContext,
        min_score: float = 0.08,
        top_k: int = 60,
    ) -> List[ExpectedSpeciesItem]:
        """Retrieve expected species using the deterministic BirdNET Geo V3.0 occurrence model."""
        if context.latitude is None or context.longitude is None:
            logger.info("Coordinates missing for session %s; expected species cannot be evaluated.", context.session_id)
            return []

        try:
            return await asyncio.to_thread(
                self._compute_expected_species_sync,
                latitude=context.latitude,
                longitude=context.longitude,
                week=context.meteorological_week,
                min_score=min_score,
                top_k=top_k,
            )
        except ValueError as exc:
            raise InvalidObservationCoordinatesError(str(exc)) from exc
        except Exception as exc:
            logger.error("BirdNetGeoKnowledgeProvider failed to predict expected species: %s", exc, exc_info=True)
            raise EcologicalProviderUnavailableError(
                f"Deterministic ecological knowledge provider failed: {exc}"
            ) from exc

    async def get_species_metadata(
        self,
        scientific_name: str,
    ) -> Optional[Dict[str, Any]]:
        """Look up taxonomy and naming metadata for a scientific name."""
        sci_clean = scientific_name.strip().lower()
        try:
            await asyncio.to_thread(self._geo_service.load_model)
        except Exception as exc:
            raise EcologicalProviderUnavailableError(
                f"Taxonomy database unavailable: {exc}"
            ) from exc
        com = self._geo_service._sci_to_common_name.get(sci_clean)
        b_id = self._geo_service._sci_to_birdnet_id.get(sci_clean)
        ebird = self._geo_service._sci_to_ebird_code.get(sci_clean)

        if not com and not b_id:
            return None

        return {
            "species_id": canonical_species_id(scientific_name, b_id),
            "scientific_name": scientific_name,
            "common_name": com,
            "birdnet_taxonomy_id": b_id,
            "ebird_code": ebird,
        }
