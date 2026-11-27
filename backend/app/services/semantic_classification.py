"""Semantic & Taxonomic Classification Layer around BirdNET+ V3.0 outputs.

Enforces strict separation between:
- Biological taxa supported by BirdNET+ V3.0 (Aves, Amphibia, Insecta, Mammalia,
  Reptilia, Actinopterygii, Arachnida)
- Non-biological anthropogenic/mechanical/cultural classes verified in BirdNET+ V3.0
  or explicit environmental sound-class vocabularies
- Non-biological geophony (e.g. Fire, Wind, Rain, Thunder)
- Unknown / uncertain detections when taxonomy or confidence is insufficient

Scientific Guardrail:
BirdNET+ V3.0 is trained primarily on wildlife vocalizations plus 16 specific non-animal
classes (14 Anthropogenic, 1 Geophony [Fire], 1 Music). It is NOT a general-purpose human
speech, construction, or urban sound classifier. Unrecognized or low-confidence signals are
conservatively categorized as `unknown` rather than fabricated into biological or arbitrary labels.
"""

from __future__ import annotations

import logging
import math
import os
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

logger = logging.getLogger(__name__)

# Default threshold below which even a mapped label is treated as low-confidence/uncertain
# in semantic biological species reporting (raw detections remain accessible for inspection).
DEFAULT_MIN_RELIABLE_BIOLOGICAL_CONFIDENCE = 0.15

BIOLOGICAL_TAXON_GROUPS: Dict[str, str] = {
    "aves": "bird",
    "amphibia": "amphibian",
    "insecta": "insect",
    "mammalia": "mammal",
    "reptilia": "reptile",
    "actinopterygii": "fish",
    "arachnida": "arachnid",
}

# Canonical BirdNET V3.0 non-animal classes partitioned by semantic origin.
ANTHROPOGENIC_CLASSES: Dict[str, str] = {
    "aircraft": "transportation",
    "boat": "transportation",
    "chainsaw": "mechanical_hazard",
    "engine": "machinery",
    "explosion": "hazard",
    "fireworks": "cultural",
    "gun": "hazard",
    "gunshot": "hazard",
    "gunshots": "hazard",
    "hammer": "construction",
    "motor vehicle": "transportation",
    "power tool": "construction",
    "power tools": "construction",
    "sawing": "construction",
    "siren": "transportation",
    "sirens": "transportation",
    "train": "transportation",
    "vehicle horn": "transportation",
    "car horn": "transportation",
    "horn": "transportation",
    "music": "cultural",
    "human": "human",
    "human vocal": "human",
    "human non-vocal": "human",
    "human whistle": "human",
    "speech": "human",
    "footsteps": "human",
    "alarm": "alarm",
    "bell": "signal",
    "vehicle": "transportation",
    "helicopter": "transportation",
    "airplane": "transportation",
    "machinery": "machinery",
    "construction": "construction",
    "noise": "unclassified_noise",
    "ambient noise": "unclassified_noise",
    "environmental": "unclassified_noise",
    "sound_class": "sound_class",
}

GEOPHONY_CLASSES: Dict[str, str] = {
    "fire": "combustion",
    "wind": "weather",
    "rain": "weather",
    "thunder": "weather",
    "geophony": "abiotic",
}


@dataclass(frozen=True)
class TaxonCatalogEntry:
    birdnet_id: Optional[str]
    scientific_name: str
    common_name: str
    taxon_group: str
    ebird_code: Optional[str] = None
    source: str = "birdnet_v3_labels_raw"


@dataclass
class SemanticClassifiedDetection:
    raw_label: str
    scientific_name: str
    common_name: str
    confidence: float
    start_seconds: float
    end_seconds: float
    duration: float
    classification_category: str  # biological | non_biological_anthropogenic | non_biological_geophony | unknown
    classification_subcategory: str  # bird | amphibian | insect | ... | transportation | machinery | ... | uncertain
    taxon_group: Optional[str]
    record_type: str  # animal | sound_class | unknown
    source_model: str
    classification_method: str
    method_type: str  # MODEL_BASED | DATA_BASED | HEURISTIC
    birdnet_taxonomy_id: Optional[str] = None
    ebird_code: Optional[str] = None
    uncertainty_reason: Optional[str] = None
    provenance: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "label": self.raw_label,
            "class_label": self.raw_label,
            "scientific_name": self.scientific_name,
            "common_name": self.common_name,
            "confidence": round(self.confidence, 4),
            "confidence_score": round(self.confidence, 4),
            "timestamp": round(self.start_seconds, 3),
            "start_seconds": round(self.start_seconds, 3),
            "end_seconds": round(self.end_seconds, 3),
            "duration": round(self.duration, 3),
            "source_model": self.source_model,
            "classification_category": self.classification_category,
            "classification_subcategory": self.classification_subcategory,
            "taxon_group": self.taxon_group,
            "record_type": self.record_type,
            "birdnet_taxonomy_id": self.birdnet_taxonomy_id,
            "ebird_code": self.ebird_code,
            "uncertainty_reason": self.uncertainty_reason,
            "provenance": self.provenance,
        }


def _find_labels_raw_csv() -> Optional[Path]:
    env_dir = os.environ.get("BIRDNET_APP_DATA")
    candidates = [
        Path(env_dir) / "acoustic-models" / "v3.0" / "labels_raw-88d976477fac.csv" if env_dir else None,
        Path(__file__).resolve().parents[3] / ".model_cache" / "acoustic-models" / "v3.0" / "labels_raw-88d976477fac.csv",
        Path.cwd() / ".model_cache" / "acoustic-models" / "v3.0" / "labels_raw-88d976477fac.csv",
        Path.cwd().parent / ".model_cache" / "acoustic-models" / "v3.0" / "labels_raw-88d976477fac.csv",
    ]
    for cand in candidates:
        if cand and cand.is_file():
            return cand
    return None


class SemanticDetectionClassifier:
    """Thread-safe semantic & taxonomic classifier backed by BirdNET+ V3.0 vocabulary metadata."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._loaded = False
        self._by_label: Dict[str, TaxonCatalogEntry] = {}
        self._by_sci: Dict[str, TaxonCatalogEntry] = {}
        self._catalog_path: Optional[str] = None

    def _ensure_loaded(self) -> None:
        if self._loaded:
            return
        with self._lock:
            if self._loaded:
                return
            csv_path = _find_labels_raw_csv()
            if csv_path is not None:
                try:
                    import pandas as pd

                    df = pd.read_csv(
                        csv_path,
                        usecols=["birdnet_id", "scientific_name", "common_name", "taxon_group", "ebird_code"],
                        low_memory=False,
                    )
                    for row in df.itertuples(index=False):
                        sci = str(getattr(row, "scientific_name", "") or "").strip()
                        com = str(getattr(row, "common_name", "") or "").strip()
                        tg = str(getattr(row, "taxon_group", "") or "").strip()
                        b_id = str(getattr(row, "birdnet_id", "") or "").strip() or None
                        eb_raw = getattr(row, "ebird_code", None)
                        ebird = str(eb_raw).strip() if pd.notna(eb_raw) and str(eb_raw).strip() else None
                        if not sci and not com:
                            continue
                        entry = TaxonCatalogEntry(
                            birdnet_id=b_id,
                            scientific_name=sci or com,
                            common_name=com or sci,
                            taxon_group=tg or "Unknown",
                            ebird_code=ebird,
                        )
                        if sci and com:
                            self._by_label[f"{sci}_{com}".lower()] = entry
                        if sci:
                            self._by_sci[sci.lower()] = entry
                    self._catalog_path = str(csv_path)
                    logger.info("Loaded %d BirdNET V3.0 vocabulary entries for semantic classification.", len(self._by_sci))
                except Exception as exc:
                    logger.warning("Failed to load BirdNET V3.0 labels_raw CSV (%s): %s", csv_path, exc)
            self._loaded = True

    def lookup_entry(self, class_label: str, scientific_name: Optional[str] = None) -> Optional[TaxonCatalogEntry]:
        self._ensure_loaded()
        cleaned_label = " ".join((class_label or "").strip().split()).lower()
        if cleaned_label in self._by_label:
            return self._by_label[cleaned_label]
        if "_" in cleaned_label:
            left = cleaned_label.split("_", 1)[0].strip()
            if left in self._by_sci:
                return self._by_sci[left]
        if scientific_name:
            cleaned_sci = " ".join(scientific_name.strip().split()).lower()
            if cleaned_sci in self._by_sci:
                return self._by_sci[cleaned_sci]
        if cleaned_label in self._by_sci:
            return self._by_sci[cleaned_label]
        return None

    def resolve_model_fields(self, raw_label: str) -> Tuple[str, str, Optional[str], str]:
        """Normalize a raw BirdNET output label to `(scientific_name, common_name, taxon_group, record_type)`."""
        self._ensure_loaded()
        label = (raw_label or "").strip()
        entry = self.lookup_entry(label)
        if entry is not None:
            tg_low = entry.taxon_group.lower()
            if tg_low in {"anthropogenic", "geophony", "music"}:
                return "Unknown", entry.common_name or entry.scientific_name, entry.taxon_group, "sound_class"
            return entry.scientific_name, entry.common_name, entry.taxon_group, "animal"

        parts = [p.strip().lower() for p in label.split("_") if p.strip()]
        if any(p in ANTHROPOGENIC_CLASSES or p in GEOPHONY_CLASSES for p in parts):
            display = label.split("_", 1)[-1].strip() or label
            tg = "Geophony" if any(p in GEOPHONY_CLASSES for p in parts) else "Anthropogenic"
            return "Unknown", display, tg, "sound_class"

        if "_" in label:
            sci, com = (part.strip() for part in label.split("_", 1))
            if sci and com:
                return sci, com, "Unknown", "animal"
        return "Unknown", label or "Unknown", "Unknown", "animal"

    def classify_detection(
        self,
        detection: Any,
        *,
        default_source_model: str = "BirdNET+ V3.0",
        min_reliable_confidence: float = DEFAULT_MIN_RELIABLE_BIOLOGICAL_CONFIDENCE,
    ) -> SemanticClassifiedDetection:
        """Classify a single detection dict or ORM/dataclass row with explicit provenance."""
        self._ensure_loaded()

        def _get(key: str, default: Any = None) -> Any:
            if isinstance(detection, dict):
                val = detection.get(key)
                return val if val is not None else default
            val = getattr(detection, key, None)
            return val if val is not None else default

        raw_label = str(_get("class_label") or _get("label") or "").strip()
        sci_in = str(_get("scientific_name") or "").strip()
        com_in = str(_get("common_name") or "").strip()
        tg_in = _get("taxon_group")
        rec_type_in = _get("record_type")
        source_model = str(_get("model_version") or _get("source_model") or default_source_model)
        start_s = float(_get("start_seconds", 0.0) or 0.0)
        end_s = float(_get("end_seconds", start_s + 3.0) or (start_s + 3.0))
        duration = max(0.0, round(end_s - start_s, 3))

        conf_raw = _get("confidence_score", _get("confidence", 0.0))
        try:
            confidence = float(conf_raw)
        except (TypeError, ValueError):
            confidence = float("nan")

        if not math.isfinite(confidence) or confidence < 0.0 or confidence > 1.0:
            return SemanticClassifiedDetection(
                raw_label=raw_label or "Unknown",
                scientific_name="Unknown",
                common_name=com_in or raw_label or "Unknown",
                confidence=0.0,
                start_seconds=start_s,
                end_seconds=end_s,
                duration=duration,
                classification_category="unknown",
                classification_subcategory="invalid_confidence",
                taxon_group=None,
                record_type="unknown",
                source_model=source_model,
                classification_method="confidence_validation",
                method_type="DATA_BASED",
                uncertainty_reason="Non-finite or out-of-range detection confidence score.",
                provenance={
                    "source_model": source_model,
                    "method": "confidence_validation",
                    "method_type": "DATA_BASED",
                },
            )

        # Look up exact BirdNET V3.0 vocabulary metadata
        entry = self.lookup_entry(raw_label, sci_in or None)
        candidates = []
        for raw_val in (raw_label, sci_in, com_in):
            clean = " ".join(str(raw_val or "").strip().lower().split())
            if not clean:
                continue
            candidates.append(clean)
            if "_" in clean:
                split_parts = [" ".join(p.strip().split()) for p in clean.split("_", 1) if p.strip()]
                if len(split_parts) == 2 and (
                    split_parts[0] == split_parts[1]
                    or split_parts[0] in ANTHROPOGENIC_CLASSES
                    or split_parts[0] in GEOPHONY_CLASSES
                    or split_parts[1] in ANTHROPOGENIC_CLASSES
                    or split_parts[1] in GEOPHONY_CLASSES
                ):
                    candidates.extend(split_parts)

        # 1. Check explicit geophony (natural abiotic environmental signal)
        geo_match = next((GEOPHONY_CLASSES[c] for c in candidates if c in GEOPHONY_CLASSES), None)
        if geo_match or (entry and entry.taxon_group.lower() == "geophony"):
            sub = geo_match or "abiotic"
            return SemanticClassifiedDetection(
                raw_label=raw_label or com_in or "Geophony",
                scientific_name="Non-biological (Geophony)",
                common_name=entry.common_name if entry else (com_in or raw_label),
                confidence=confidence,
                start_seconds=start_s,
                end_seconds=end_s,
                duration=duration,
                classification_category="non_biological_geophony",
                classification_subcategory=sub,
                taxon_group="Geophony",
                record_type="sound_class",
                source_model=source_model,
                classification_method="model_vocabulary_metadata",
                method_type="MODEL_BASED",
                birdnet_taxonomy_id=entry.birdnet_id if entry else None,
                uncertainty_reason=(
                    f"Low confidence ({confidence:.3f} < {min_reliable_confidence:.2f})."
                    if confidence < min_reliable_confidence
                    else None
                ),
                provenance={
                    "source_model": source_model,
                    "method": "model_vocabulary_metadata",
                    "method_type": "MODEL_BASED",
                    "vocabulary_matched": entry is not None,
                },
            )

        # 2. Check explicit anthropogenic / mechanical / cultural sound class
        anthro_match = next((ANTHROPOGENIC_CLASSES[c] for c in candidates if c in ANTHROPOGENIC_CLASSES), None)
        if (
            anthro_match
            or (entry and entry.taxon_group.lower() in {"anthropogenic", "music"})
            or str(rec_type_in or "").strip().lower() == "sound_class"
            or str(tg_in or "").strip().lower() in {"sound_class", "anthropogenic", "music"}
        ):
            sub = anthro_match or (
                "cultural" if entry and entry.taxon_group.lower() == "music" else "anthropogenic_sound"
            )
            display_name = entry.common_name if entry else (com_in or raw_label.split("_", 1)[-1] or "Non-biological sound")
            return SemanticClassifiedDetection(
                raw_label=raw_label or display_name,
                scientific_name="Non-biological (Anthropogenic)",
                common_name=display_name,
                confidence=confidence,
                start_seconds=start_s,
                end_seconds=end_s,
                duration=duration,
                classification_category="non_biological_anthropogenic",
                classification_subcategory=sub,
                taxon_group="Anthropogenic" if sub != "cultural" else "Music",
                record_type="sound_class",
                source_model=source_model,
                classification_method="model_vocabulary_metadata",
                method_type="MODEL_BASED",
                birdnet_taxonomy_id=entry.birdnet_id if entry else None,
                uncertainty_reason=(
                    f"Low confidence ({confidence:.3f} < {min_reliable_confidence:.2f})."
                    if confidence < min_reliable_confidence
                    else None
                ),
                provenance={
                    "source_model": source_model,
                    "method": "model_vocabulary_metadata",
                    "method_type": "MODEL_BASED",
                    "vocabulary_matched": entry is not None,
                },
            )

        # 3. Biological candidates — verify binomial taxonomy & minimum reliability threshold
        resolved_sci = entry.scientific_name if entry else (sci_in if sci_in and sci_in.lower() != "unknown" else "")
        resolved_com = entry.common_name if entry else (com_in or resolved_sci or raw_label)
        resolved_tg = (
            entry.taxon_group
            if entry
            else (str(tg_in).strip() if tg_in and str(tg_in).strip().lower() not in {"", "unknown", "none"} else None)
        )
        tg_sub = BIOLOGICAL_TAXON_GROUPS.get((resolved_tg or "").lower())

        # Is this a well-formed biological taxon (binomial or mapped biological CSV entry)?
        is_binomial = bool(resolved_sci and len(resolved_sci.split()) >= 2 and resolved_sci.lower() != "unknown")
        is_mapped_bio = entry is not None and (resolved_tg or "").lower() in BIOLOGICAL_TAXON_GROUPS

        if not (is_mapped_bio or (is_binomial and str(rec_type_in or "").lower() != "sound_class")):
            return SemanticClassifiedDetection(
                raw_label=raw_label or "Unknown",
                scientific_name=resolved_sci or "Unknown",
                common_name=resolved_com or raw_label or "Unknown",
                confidence=confidence,
                start_seconds=start_s,
                end_seconds=end_s,
                duration=duration,
                classification_category="unknown",
                classification_subcategory="unmapped_label",
                taxon_group=resolved_tg,
                record_type="unknown",
                source_model=source_model,
                classification_method="taxonomy_verification_fallback",
                method_type="DERIVED",
                birdnet_taxonomy_id=entry.birdnet_id if entry else None,
                ebird_code=entry.ebird_code if entry else None,
                uncertainty_reason=(
                    "Label could not be verified against BirdNET+ V3.0 biological taxonomy or non-biological vocabulary."
                ),
                provenance={
                    "source_model": source_model,
                    "method": "taxonomy_verification_fallback",
                    "method_type": "DERIVED",
                },
            )

        if confidence < min_reliable_confidence:
            return SemanticClassifiedDetection(
                raw_label=raw_label,
                scientific_name=resolved_sci,
                common_name=resolved_com,
                confidence=confidence,
                start_seconds=start_s,
                end_seconds=end_s,
                duration=duration,
                classification_category="unknown",
                classification_subcategory="low_confidence_biological_candidate",
                taxon_group=resolved_tg or "Aves",
                record_type="unknown",
                source_model=source_model,
                classification_method="confidence_threshold_gate",
                method_type="DERIVED",
                birdnet_taxonomy_id=entry.birdnet_id if entry else None,
                ebird_code=entry.ebird_code if entry else None,
                uncertainty_reason=(
                    f"Model confidence {confidence:.3f} is below reliable species threshold {min_reliable_confidence:.2f}; "
                    "retained as unknown rather than asserted as a confirmed species."
                ),
                provenance={
                    "source_model": source_model,
                    "method": "confidence_threshold_gate",
                    "method_type": "DERIVED",
                    "min_reliable_confidence": min_reliable_confidence,
                },
            )

        return SemanticClassifiedDetection(
            raw_label=raw_label or f"{resolved_sci}_{resolved_com}",
            scientific_name=resolved_sci,
            common_name=resolved_com,
            confidence=confidence,
            start_seconds=start_s,
            end_seconds=end_s,
            duration=duration,
            classification_category="biological",
            classification_subcategory=tg_sub or "other_biological_taxon",
            taxon_group=resolved_tg or "Unknown",
            record_type="animal",
            source_model=source_model,
            classification_method="birdnet_v3_taxonomy" if is_mapped_bio else "binomial_label_parse",
            method_type="MODEL_BASED",
            birdnet_taxonomy_id=entry.birdnet_id if entry else None,
            ebird_code=entry.ebird_code if entry else None,
            uncertainty_reason=None,
            provenance={
                "source_model": source_model,
                "method": "birdnet_v3_taxonomy" if is_mapped_bio else "binomial_label_parse",
                "method_type": "MODEL_BASED",
                "vocabulary_matched": is_mapped_bio,
            },
        )

    def partition_detections(
        self,
        detections: Iterable[Any],
        *,
        default_source_model: str = "BirdNET+ V3.0",
        min_reliable_confidence: float = DEFAULT_MIN_RELIABLE_BIOLOGICAL_CONFIDENCE,
    ) -> Dict[str, List[SemanticClassifiedDetection]]:
        """Partition raw detections into biological, non-biological, and unknown buckets."""
        biological: List[SemanticClassifiedDetection] = []
        non_biological: List[SemanticClassifiedDetection] = []
        unknown: List[SemanticClassifiedDetection] = []

        for det in detections:
            classified = self.classify_detection(
                det,
                default_source_model=default_source_model,
                min_reliable_confidence=min_reliable_confidence,
            )
            if classified.classification_category == "biological":
                biological.append(classified)
            elif classified.classification_category in {
                "non_biological_anthropogenic",
                "non_biological_geophony",
            }:
                non_biological.append(classified)
            else:
                unknown.append(classified)

        return {
            "biological": biological,
            "non_biological": non_biological,
            "unknown": unknown,
        }


semantic_classifier = SemanticDetectionClassifier()
