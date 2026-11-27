"""Deterministic Species Expectation and Observation Gap Engine.

Scientific Principles Enforced:
1. Acoustic non-detection is NOT biological absence (`not_detected = True`, `absent = False`).
2. Unexpected detections are NOT labeled invasive; they reflect range shifts, vagrants, or unusual visitors.
3. Observation coverage is NOT an ecosystem-health or extinction score; it measures acoustic coverage.
4. Detection quality respects confidence thresholds, multi-window persistence, and duration constraints.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

from app.schemas.ecological_intelligence import (
    ACOUSTIC_COVERAGE_DISCLAIMER,
    DetectedSpeciesItem,
    ExpectedSpeciesItem,
    ObservationContext,
    ObservationGapCoverage,
    ObservationGapSpeciesItem,
)
from app.services.analysis_pipeline import NON_ANIMAL_SOUND_CLASSES
from app.services.ecological_knowledge.provider_base import canonical_species_id
from app.services.geo_temporal_service import is_non_biological_taxon

logger = logging.getLogger(__name__)

# Exact normalized non-biological class labels to exclude from avian expectation analysis
EXCLUDED_SOUND_LABELS: Set[str] = {
    c.lower() for c in NON_ANIMAL_SOUND_CLASSES
}.union({
    "engine",
    "chainsaw",
    "siren",
    "sirens",
    "vehicle",
    "gunshot",
    "gunshots",
    "helicopter",
    "airplane",
    "aircraft",
    "horn",
    "car horn",
    "whistle",
    "machinery",
    "power tools",
    "human",
    "human vocal",
    "human non-vocal",
    "speech",
    "dog",
    "cat",
    "noise",
    "ambient noise",
    "environmental",
    "fireworks",
    "wind",
    "rain",
    "thunder",
})


def _normalize_sci(name: str) -> str:
    return " ".join(name.strip().lower().split())


def _extract_field(ev: Any, key: str, default: Any = None) -> Any:
    if isinstance(ev, dict):
        val = ev.get(key)
        return val if val is not None else default
    val = getattr(ev, key, None)
    return val if val is not None else default


class ObservationGapEngine:
    """Calculates deterministic expectation vs detection matrices and explainable gap scores."""

    @staticmethod
    def filter_and_aggregate_detections(
        raw_events: Sequence[Any],
        min_confidence: float = 0.25,
        single_window_min_confidence: float = 0.35,
    ) -> Dict[str, Dict[str, Any]]:
        """Deduplicate and aggregate detections by scientific name with persistence filtering.

        Quality Rules:
        - Filters out non-animal / mechanical disturbance classes.
        - Requires >= `single_window_min_confidence` if a species was only detected once in the session.
        - Permits lower threshold (`min_confidence`) if species was persistently detected across >= 2 windows.
        """
        grouped: Dict[str, List[Any]] = defaultdict(list)

        for ev in raw_events:
            # Handle both ORM LiveEvent and generic dict/schema safely (preserving explicit 0.0 values)
            class_label = str(_extract_field(ev, "class_label", "") or "")
            sci_name = _extract_field(ev, "scientific_name", None)
            com_name = _extract_field(ev, "common_name", None)
            taxon_group = _extract_field(ev, "taxon_group", None)
            record_type = _extract_field(ev, "record_type", None)
            birdnet_taxonomy_id = _extract_field(ev, "birdnet_taxonomy_id", None)
            ebird_code = _extract_field(ev, "ebird_code", None)
            explicit_species_id = _extract_field(ev, "species_id", None)
            conf = float(_extract_field(ev, "confidence_score", 0.0))
            start_s = float(_extract_field(ev, "start_seconds", 0.0))
            end_s = float(_extract_field(ev, "end_seconds", start_s + 3.0))

            # Infer scientific name if missing
            if not sci_name and "_" in class_label:
                sci_name = class_label.split("_")[0].strip()
                if not com_name:
                    com_name = class_label.split("_")[1].strip()
            elif not sci_name:
                sci_name = class_label.strip()

            if not sci_name:
                continue

            norm_sci = _normalize_sci(str(sci_name))
            norm_label = _normalize_sci(class_label)

            # Skip non-biological / sound disturbance / human classes
            if (
                norm_sci in EXCLUDED_SOUND_LABELS
                or norm_label in EXCLUDED_SOUND_LABELS
                or is_non_biological_taxon(
                    str(sci_name),
                    common_name=com_name,
                    taxon_group=taxon_group,
                    record_type=record_type,
                )
                or is_non_biological_taxon(
                    class_label,
                    common_name=com_name,
                    taxon_group=taxon_group,
                    record_type=record_type,
                )
            ):
                continue

            # Hard floor: ignore anything below min_confidence
            if conf < min_confidence:
                continue

            display_sci = " ".join(str(sci_name).strip().split())
            grouped[norm_sci].append({
                "scientific_name": display_sci,
                "common_name": com_name or display_sci,
                "species_id": explicit_species_id,
                "birdnet_taxonomy_id": birdnet_taxonomy_id,
                "ebird_code": ebird_code,
                "confidence": conf,
                "start_s": start_s,
                "end_s": end_s,
            })

        aggregated: Dict[str, Dict[str, Any]] = {}
        for norm_sci, hits in grouped.items():
            confidences = [h["confidence"] for h in hits]
            max_conf = max(confidences)
            mean_conf = sum(confidences) / len(confidences)
            count = len(hits)
            first_seen = min(h["start_s"] for h in hits)
            last_seen = max(h["end_s"] for h in hits)
            is_persistent = count >= 2

            # Single-hit noise rejection
            if count == 1 and max_conf < single_window_min_confidence:
                logger.debug(
                    "Rejecting isolated low-confidence detection of %s (conf=%.2f < %.2f)",
                    hits[0]["scientific_name"], max_conf, single_window_min_confidence
                )
                continue

            display_sci = hits[0]["scientific_name"]
            common_name = next((h["common_name"] for h in hits if h["common_name"]), display_sci)
            b_id = next((h["birdnet_taxonomy_id"] for h in hits if h["birdnet_taxonomy_id"]), None)
            ebird = next((h["ebird_code"] for h in hits if h["ebird_code"]), None)
            sp_id = next((h["species_id"] for h in hits if h["species_id"]), None) or canonical_species_id(display_sci, b_id)

            aggregated[norm_sci] = {
                "species_id": sp_id,
                "scientific_name": display_sci,
                "common_name": common_name,
                "birdnet_taxonomy_id": b_id,
                "ebird_code": ebird,
                "max_confidence": round(max_conf, 4),
                "mean_confidence": round(mean_conf, 4),
                "detection_count": count,
                "first_seen_seconds": round(first_seen, 2),
                "last_seen_seconds": round(last_seen, 2),
                "is_persistent": is_persistent,
            }

        return aggregated

    @classmethod
    def evaluate_observation_gap(
        cls,
        context: ObservationContext,
        expected_species: List[ExpectedSpeciesItem],
        raw_events: Sequence[Any],
        min_confidence: float = 0.25,
    ) -> Tuple[
        List[DetectedSpeciesItem],
        List[ObservationGapSpeciesItem],
        List[DetectedSpeciesItem],
        ObservationGapCoverage,
    ]:
        """Compute the fourfold expectation-vs-detection matrix and coverage score.

        Returns:
            (expected_and_detected, expected_but_not_detected, detected_unexpected, coverage)
        """
        # 1. Quality-filter and aggregate detected events
        detected_map = cls.filter_and_aggregate_detections(
            raw_events=raw_events, min_confidence=min_confidence
        )
        det_by_tax_id: Dict[str, str] = {}
        for norm_sci, det in detected_map.items():
            if det.get("birdnet_taxonomy_id"):
                det_by_tax_id[str(det["birdnet_taxonomy_id"]).strip()] = norm_sci

        # 2. Deduplicate and index expected species (canonical ID / normalized scientific name)
        expected_by_key: Dict[str, ExpectedSpeciesItem] = {}
        for sp in expected_species:
            if is_non_biological_taxon(sp.scientific_name, common_name=sp.common_name):
                continue
            dedup_key = (
                f"id:{sp.birdnet_taxonomy_id.strip()}"
                if sp.birdnet_taxonomy_id and sp.birdnet_taxonomy_id.strip()
                else f"sci:{_normalize_sci(sp.scientific_name)}"
            )
            existing = expected_by_key.get(dedup_key)
            if existing is None or sp.occurrence_score > existing.occurrence_score:
                expected_by_key[dedup_key] = sp

        deduped_expected = list(expected_by_key.values())

        expected_and_detected: List[DetectedSpeciesItem] = []
        expected_but_not_detected: List[ObservationGapSpeciesItem] = []
        detected_unexpected: List[DetectedSpeciesItem] = []

        # Track which detected species were matched to expectations
        matched_detected_keys: Set[str] = set()

        # 3. Partition expected species into detected vs unobserved gap
        for exp in deduped_expected:
            exp_sci_norm = _normalize_sci(exp.scientific_name)
            matched_key: Optional[str] = None
            if exp_sci_norm in detected_map:
                matched_key = exp_sci_norm
            elif exp.birdnet_taxonomy_id and exp.birdnet_taxonomy_id.strip() in det_by_tax_id:
                matched_key = det_by_tax_id[exp.birdnet_taxonomy_id.strip()]

            exp_tax_id = exp.birdnet_taxonomy_id
            exp_species_id = exp.species_id or canonical_species_id(exp.scientific_name, exp_tax_id)

            if matched_key is not None:
                det = detected_map[matched_key]
                matched_detected_keys.add(matched_key)
                final_tax_id = det.get("birdnet_taxonomy_id") or exp_tax_id
                final_ebird = det.get("ebird_code") or exp.ebird_code
                expected_and_detected.append(
                    DetectedSpeciesItem(
                        species_id=exp_species_id or det.get("species_id"),
                        scientific_name=exp.scientific_name,
                        common_name=exp.common_name or det["common_name"],
                        birdnet_taxonomy_id=final_tax_id,
                        ebird_code=final_ebird,
                        max_confidence=det["max_confidence"],
                        mean_confidence=det["mean_confidence"],
                        detection_count=det["detection_count"],
                        first_seen_seconds=det["first_seen_seconds"],
                        last_seen_seconds=det["last_seen_seconds"],
                        is_persistent=det["is_persistent"],
                        is_expected=True,
                        occurrence_score=exp.occurrence_score,
                        occurrence_status=exp.occurrence_status,
                    )
                )
            else:
                expected_but_not_detected.append(
                    ObservationGapSpeciesItem(
                        species_id=exp_species_id,
                        scientific_name=exp.scientific_name,
                        common_name=exp.common_name,
                        occurrence_score=exp.occurrence_score,
                        occurrence_status=exp.occurrence_status,
                        birdnet_taxonomy_id=exp_tax_id,
                        ebird_code=exp.ebird_code,
                        not_detected=True,
                        evidence_status="insufficient_evidence_for_absence",
                    )
                )

        # 4. Partition detected species not in the expected checklist
        for norm_sci, det in detected_map.items():
            if norm_sci not in matched_detected_keys:
                b_id = det.get("birdnet_taxonomy_id")
                sp_id = det.get("species_id") or canonical_species_id(det["scientific_name"], b_id)
                detected_unexpected.append(
                    DetectedSpeciesItem(
                        species_id=sp_id,
                        scientific_name=det["scientific_name"],
                        common_name=det["common_name"],
                        birdnet_taxonomy_id=b_id,
                        ebird_code=det.get("ebird_code"),
                        max_confidence=det["max_confidence"],
                        mean_confidence=det["mean_confidence"],
                        detection_count=det["detection_count"],
                        first_seen_seconds=det["first_seen_seconds"],
                        last_seen_seconds=det["last_seen_seconds"],
                        is_persistent=det["is_persistent"],
                        is_expected=False,
                        occurrence_score=None,
                        occurrence_status="unexpected",
                    )
                )

        # Sort outputs logically
        # Expected and detected: by detection count desc, then confidence desc
        expected_and_detected.sort(key=lambda s: (s.detection_count, s.max_confidence), reverse=True)
        # Expected but not detected: by occurrence suitability score desc (most expected first)
        expected_but_not_detected.sort(key=lambda s: s.occurrence_score, reverse=True)
        # Detected unexpected: by confidence desc
        detected_unexpected.sort(key=lambda s: (s.detection_count, s.max_confidence), reverse=True)

        # 5. Compute Acoustic Observation Coverage Score
        total_expected = len(deduped_expected)
        detected_exp_cnt = len(expected_and_detected)
        detected_unexp_cnt = len(detected_unexpected)
        gap_cnt = len(expected_but_not_detected)

        # Handle boundary conditions
        if context.latitude is None or context.longitude is None:
            adequacy = "location_unspecified"
            ratio = 0.0
            explanation = "Observation coordinates were not specified. Regional species expectations cannot be evaluated."
        elif context.observation_duration_sec < 120.0:
            adequacy = "insufficient_duration"
            ratio = detected_exp_cnt / max(1, total_expected)
            explanation = (
                f"Recording duration ({context.observation_duration_sec:.0f}s) is too brief for scientific ecological assessment "
                "(minimum 120s recommended)."
            )
        elif len(detected_map) == 0:
            adequacy = "zero_detections"
            ratio = 0.0
            explanation = (
                "Zero acoustic species detections recorded in this session. "
                "This indicates acoustic silence or elevated noise, not regional absence."
            )
        elif context.observation_duration_sec < 300.0:
            adequacy = "marginal_duration"
            ratio = detected_exp_cnt / max(1, total_expected)
            explanation = "Recording duration (< 5 min) provides a preliminary sample. Coverage increases with duration."
        else:
            adequacy = "adequate"
            ratio = detected_exp_cnt / max(1, total_expected)
            explanation = (
                f"Observation captured {detected_exp_cnt} of {total_expected} regionally expected species "
                f"({(ratio * 100):.1f}% acoustic coverage)."
            )

        ratio_clamped = max(0.0, min(1.0, ratio))
        coverage = ObservationGapCoverage(
            expected_species_count=total_expected,
            detected_expected_count=detected_exp_cnt,
            detected_unexpected_count=detected_unexp_cnt,
            gap_count=gap_cnt,
            coverage_ratio=round(ratio_clamped, 4),
            coverage_percentage=round(ratio_clamped * 100.0, 1),
            observation_adequacy=adequacy,
            adequacy_explanation=explanation,
            disclaimer=ACOUSTIC_COVERAGE_DISCLAIMER,
        )

        return expected_and_detected, expected_but_not_detected, detected_unexpected, coverage


# Singleton
observation_gap_engine = ObservationGapEngine()
