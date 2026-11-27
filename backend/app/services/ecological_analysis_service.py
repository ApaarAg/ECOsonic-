"""Unified Ecological Analysis Synthesis Service.

Consumes single-pass intermediate results (BirdNET detections, processed audio / soundscape metrics,
recording metadata, and geographic/temporal metadata) and produces the five structured, provenance-tagged
ecological sections without running redundant inference passes:
1. species_analysis (Biological vs Anthropogenic vs Unknown separation)
2. disturbance_analysis (Measurable non-biological acoustic indicators & non-causal co-occurrence)
3. context_analysis (Measured recording, acoustic, biological, anthropogenic, and temporal context)
4. expected_species_analysis (BirdNET Geo V3.0 expectation or explicit reference_unavailable / location_unspecified)
5. observation_gap_analysis (Mathematical set comparison: Expected vs Observed biological taxa)
"""

from __future__ import annotations

import logging
import math
from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence

import numpy as np

from app.schemas.ecological_intelligence import (
    ACOUSTIC_COVERAGE_DISCLAIMER,
    SCIENTIFIC_ABSENCE_DISCLAIMER,
)
from app.services.disturbance_radar import (
    SCIENTIFIC_DISTURBANCE_DISCLAIMER,
    disturbance_radar_engine,
)
from app.services.ecological_knowledge import get_ecological_knowledge_provider
from app.services.ecological_knowledge.provider_base import (
    EcologicalProviderUnavailableError,
    InvalidObservationCoordinatesError,
    canonical_species_id,
)
from app.services.geo_temporal_service import date_to_birdnet_week
from app.services.observation_gap_engine import observation_gap_engine
from app.services.semantic_classification import (
    DEFAULT_MIN_RELIABLE_BIOLOGICAL_CONFIDENCE,
    SemanticClassifiedDetection,
    semantic_classifier,
)
from app.services.soundscape_intelligence import soundscape_intelligence_service
from app.services.species_image_service import species_image_service

logger = logging.getLogger(__name__)

# Documented weights for Disturbance Index when indicators are available.
DISTURBANCE_WEIGHT_ANTHRO_CONF_COVERAGE = 0.35
DISTURBANCE_WEIGHT_DURATION_RATIO = 0.25
DISTURBANCE_WEIGHT_SPECTRAL_PRESSURE = 0.25
DISTURBANCE_WEIGHT_HAZARD_SEVERITY = 0.15

HAZARD_TIER_WEIGHT = {
    "critical": 1.0,
    "medium": 0.6,
    "low": 0.3,
}


def _safe_round(val: Optional[float], digits: int = 4) -> Optional[float]:
    if val is None or not math.isfinite(float(val)):
        return None
    return round(float(val), digits)


def _derive_season(latitude: Optional[float], ts: datetime) -> str:
    month = ts.month
    if latitude is not None and abs(float(latitude)) < 23.5:
        return "tropical wet/monsoon" if month in {5, 6, 7, 8, 9, 10} else "tropical dry"
    southern = latitude is not None and float(latitude) < 0.0
    if month in {3, 4, 5}:
        base = "autumn" if southern else "spring"
    elif month in {6, 7, 8}:
        base = "winter" if southern else "summer"
    elif month in {9, 10, 11}:
        base = "spring" if southern else "autumn"
    else:
        base = "summer" if southern else "winter"
    hem = "austral" if southern else "boreal"
    return f"{base} ({hem})"


def _derive_biogeographic_band(latitude: Optional[float], longitude: Optional[float]) -> Dict[str, Optional[str]]:
    if latitude is None or longitude is None:
        return {"biome_band": None, "hemisphere": None, "region": None}
    lat = float(latitude)
    lon = float(longitude)
    hem_ns = "Northern" if lat >= 0 else "Southern"
    hem_ew = "Eastern" if lon >= 0 else "Western"
    abs_lat = abs(lat)
    if abs_lat >= 66.5:
        band = "polar / arctic-alpine belt"
    elif abs_lat >= 50.0:
        band = "boreal / cool-temperate belt"
    elif abs_lat >= 35.0:
        band = "temperate mid-latitude belt"
    elif abs_lat >= 23.5:
        band = "subtropical / warm-temperate belt"
    else:
        band = "tropical / equatorial belt"
    return {
        "biome_band": band,
        "hemisphere": f"{hem_ns} · {hem_ew}",
        "region": f"{abs(lat):.2f}° {'N' if lat >= 0 else 'S'}, {abs(lon):.2f}° {'E' if lon >= 0 else 'W'}",
    }


class EcologicalAnalysisService:
    """Synthesizes semantically clean, provenance-tracked ecological sections from single-pass outputs."""

    @staticmethod
    def build_geospatial_context(
        *,
        latitude: Optional[float],
        longitude: Optional[float],
        timestamp: Optional[datetime],
        ecosystem_category: Optional[str],
        location_name: Optional[str],
        expected_species_status: str,
        expected_count: Optional[int],
    ) -> Dict[str, Any]:
        ts = timestamp or datetime.now(timezone.utc)
        week = date_to_birdnet_week(ts)
        has_coords = (
            latitude is not None
            and longitude is not None
            and math.isfinite(float(latitude))
            and math.isfinite(float(longitude))
        )
        geo_band = _derive_biogeographic_band(latitude if has_coords else None, longitude if has_coords else None)
        ref_status = (
            "available"
            if expected_species_status in {"available", "empty_reference"}
            else "unavailable"
        )
        return {
            "location": {
                "latitude": round(float(latitude), 6) if has_coords else None,
                "longitude": round(float(longitude), 6) if has_coords else None,
                "generalized": (
                    {"latitude": round(float(latitude), 2), "longitude": round(float(longitude), 2)}
                    if has_coords
                    else None
                ),
                "location_name": location_name or (geo_band["region"] if has_coords else None),
                "coordinate_status": "provided" if has_coords else "unspecified",
            },
            "temporal_context": {
                "timestamp": ts.isoformat(),
                "observation_date": ts.strftime("%Y-%m-%d"),
                "meteorological_week": week,
                "season": _derive_season(float(latitude) if has_coords else None, ts),
            },
            "ecological_context": {
                "habitat": ecosystem_category if ecosystem_category and ecosystem_category != "unspecified" else geo_band["biome_band"],
                "biome_band": geo_band["biome_band"],
                "hemisphere": geo_band["hemisphere"],
                "region": geo_band["region"],
                "reference_source": "BirdNET Geo V3.0 ONNX (14,082-taxon spatial-seasonal occurrence model)",
                "occurrence_basis": "species_expected_from_reference",
                "reference_limitations": (
                    "Expected species are regional spatial-seasonal suitability priors derived from latitude, longitude, and meteorological week; occurrence suitability does not prove physical presence or micro-habitat occupancy."
                ),
            },
            "expected_species_count": expected_count,
            "reference_status": ref_status,
        }

    @staticmethod
    def build_species_analysis(
        raw_detections: Sequence[Any],
        *,
        source_model: str = "BirdNET+ V3.0",
        min_reliable_confidence: float = DEFAULT_MIN_RELIABLE_BIOLOGICAL_CONFIDENCE,
    ) -> Dict[str, Any]:
        """Build the Species section cleanly excluding non-biological sounds from biological species."""
        buckets = semantic_classifier.partition_detections(
            raw_detections,
            default_source_model=source_model,
            min_reliable_confidence=min_reliable_confidence,
        )
        bio_list = buckets["biological"]
        non_bio_list = buckets["non_biological"]
        unk_list = buckets["unknown"]

        grouped_bio: Dict[str, List[SemanticClassifiedDetection]] = defaultdict(list)
        for item in bio_list:
            grouped_bio[item.scientific_name.strip().lower()].append(item)

        species_summaries: List[Dict[str, Any]] = []
        taxa_counts: Counter[str] = Counter()
        for sci_key, items in grouped_bio.items():
            confs = [x.confidence for x in items]
            rep = items[0]
            tg = rep.taxon_group or "Unknown"
            taxa_counts[tg] += 1
            species_summaries.append({
                "species_id": canonical_species_id(rep.scientific_name, rep.birdnet_taxonomy_id),
                "scientific_name": rep.scientific_name,
                "common_name": rep.common_name,
                "taxon_group": tg,
                "taxon_subcategory": rep.classification_subcategory,
                "birdnet_taxonomy_id": rep.birdnet_taxonomy_id,
                "ebird_code": rep.ebird_code,
                "detection_count": len(items),
                "max_confidence": round(max(confs), 4),
                "mean_confidence": round(sum(confs) / len(confs), 4),
                "first_seen_seconds": round(min(x.start_seconds for x in items), 3),
                "last_seen_seconds": round(max(x.end_seconds for x in items), 3),
                "classification_category": "biological",
                "provenance": {
                    "source_model": rep.source_model,
                    "method": rep.classification_method,
                    "method_type": "MODEL_BASED",
                },
            })

        species_summaries.sort(key=lambda s: (-s["max_confidence"], s["scientific_name"]))

        if bio_list:
            status_val = "detected"
        elif non_bio_list or unk_list:
            status_val = "no_biological_detections"
        else:
            status_val = "no_detections"

        return {
            "status": status_val,
            "species": species_summaries,
            "biological_detections": [b.to_dict() for b in bio_list],
            "non_biological_detections": [nb.to_dict() for nb in non_bio_list],
            "unknown_detections": [u.to_dict() for u in unk_list],
            "summary": {
                "total_raw_detections": len(bio_list) + len(non_bio_list) + len(unk_list),
                "biological_detection_count": len(bio_list),
                "unique_biological_species": len(species_summaries),
                "non_biological_detection_count": len(non_bio_list),
                "unknown_detection_count": len(unk_list),
                "biological_taxa_breakdown": dict(taxa_counts),
                "min_reliable_confidence_threshold": min_reliable_confidence,
                "classification_note": (
                    "Only verified biological taxa meeting reliability threshold appear in 'species' and 'biological_detections'. "
                    "Non-animal sound classes (anthropogenic, geophony, music) and uncertain detections are separated cleanly."
                ),
            },
            "provenance": {
                "source_model": source_model,
                "processing_method": "semantic_vocabulary_and_confidence_gate",
                "method_type": "MODEL_BASED",
                "confidence_threshold": min_reliable_confidence,
            },
        }

    @staticmethod
    def build_disturbance_analysis(
        *,
        analysis_or_session_id: str,
        species_analysis: Dict[str, Any],
        duration_seconds: Optional[float],
        soundscape_data: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """Compute measurable, non-causal disturbance assessment strictly from non-biological signals & spectral metrics."""
        bio_detections = species_analysis.get("biological_detections", [])
        non_bio_detections = species_analysis.get("non_biological_detections", [])

        anthro_raw = [
            d for d in non_bio_detections
            if d.get("classification_category") == "non_biological_anthropogenic"
        ]
        geophony_raw = [
            d for d in non_bio_detections
            if d.get("classification_category") == "non_biological_geophony"
        ]

        # Aggregate contiguous anthropogenic hits cleanly via existing DisturbanceRadarEngine
        radar_events = disturbance_radar_engine.aggregate_raw_detections(
            anthro_raw, session_id=analysis_or_session_id
        )
        # Note: DisturbanceRadarEngine evaluates verified non-animal sound classes (e.g. Aircraft, Chainsaw, Engine, Fire).
        # Keep only anthropogenic events in anthropogenic_events and track co-occurrences cleanly without causality.
        merged_anthro_events: List[Dict[str, Any]] = []
        co_occurrences: List[Dict[str, Any]] = []

        for ev in radar_events:
            ev_dict = ev.to_dict()
            merged_anthro_events.append(ev_dict)
            co = disturbance_radar_engine.analyze_biological_cooccurrence(
                disturbance_event=ev,
                biological_detections=bio_detections,
                context_window_seconds=30.0,
            )
            co_dict = co.to_dict()
            co_dict["causal_claim_made"] = False
            co_occurrences.append(co_dict)

        # Fallback handling for valid anthropogenic labels outside BirdNET's 16-class radar taxonomy
        # (e.g. if an external detector or explicit human/speech/machinery label was passed)
        matched_labels = {e.get("class_label", "").lower() for e in merged_anthro_events}
        extra_anthro = [
            d for d in anthro_raw
            if str(d.get("common_name", "")).lower() not in matched_labels
            and str(d.get("label", "")).split("_", 1)[-1].lower() not in matched_labels
        ]
        if extra_anthro and not merged_anthro_events:
            for d in extra_anthro:
                merged_anthro_events.append({
                    "event_id": f"anthro-{len(merged_anthro_events)+1}",
                    "session_id": analysis_or_session_id,
                    "class_label": d.get("common_name") or d.get("label"),
                    "event_type": d.get("classification_subcategory", "anthropogenic_sound"),
                    "category": "anthropogenic",
                    "hazard_tier": "low",
                    "priority_level": "LOW",
                    "priority_score": round(0.30 * float(d.get("confidence", 0.0)), 4),
                    "start_seconds": float(d.get("start_seconds", 0.0)),
                    "end_seconds": float(d.get("end_seconds", 3.0)),
                    "duration_seconds": float(d.get("duration", 3.0)),
                    "peak_confidence": float(d.get("confidence", 0.0)),
                    "mean_confidence": float(d.get("confidence", 0.0)),
                    "repetition_count": 1,
                })

        # Compute non-overlapping anthropogenic duration coverage
        intervals = sorted(
            (float(e["start_seconds"]), float(e["end_seconds"]))
            for e in merged_anthro_events
            if float(e["end_seconds"]) > float(e["start_seconds"])
        )
        anthro_covered_s = 0.0
        cur_start, cur_end = -1.0, -1.0
        for s_t, e_t in intervals:
            if cur_end < 0:
                cur_start, cur_end = s_t, e_t
            elif s_t <= cur_end:
                cur_end = max(cur_end, e_t)
            else:
                anthro_covered_s += cur_end - cur_start
                cur_start, cur_end = s_t, e_t
        if cur_end >= 0:
            anthro_covered_s += cur_end - cur_start

        dur_valid = isinstance(duration_seconds, (int, float)) and duration_seconds > 0
        anthro_duration_ratio = (
            min(1.0, anthro_covered_s / float(duration_seconds)) if dur_valid else None
        )

        # Temporal overlap with biological detections (non-causal)
        overlapping_bio = 0
        for b in bio_detections:
            bs, be = float(b.get("start_seconds", 0.0)), float(b.get("end_seconds", 0.0))
            if any(not (be <= s_t or bs >= e_t) for s_t, e_t in intervals):
                overlapping_bio += 1

        # Spectral indicators from soundscape analysis
        sc_metrics = (soundscape_data or {}).get("metrics") or {}
        sc_bands = (soundscape_data or {}).get("frequency_bands") or {}
        ndsi_val = sc_metrics.get("ndsi")
        anthro_band_pct = sc_bands.get("mid_frequency_1_2k_pct")
        anthrophony_energy_share = (
            max(0.0, min(1.0, float(anthro_band_pct) / 100.0))
            if anthro_band_pct is not None and math.isfinite(float(anthro_band_pct))
            else None
        )
        ndsi_pressure = (
            max(0.0, min(1.0, (1.0 - float(ndsi_val)) / 2.0))
            if ndsi_val is not None and math.isfinite(float(ndsi_val))
            else None
        )

        # Compute documented bounded Heuristic Disturbance Index [0.0, 1.0] if measurable evidence exists
        has_spectral_evidence = ndsi_pressure is not None or anthrophony_energy_share is not None
        has_class_evidence = len(merged_anthro_events) > 0
        has_any_evidence = has_class_evidence or has_spectral_evidence

        if not has_any_evidence:
            disturbance_index = None
            severity = "unavailable"
            status_val = "unavailable"
            interpretation = (
                "Insufficient acoustic or model evidence to assess disturbance; "
                "no anthropogenic detections and no spectral soundscape metrics available."
            )
            components_used: Dict[str, Any] = {}
        else:
            weighted_sum = 0.0
            total_weight = 0.0
            components_used = {}

            if has_class_evidence:
                mean_peak = sum(float(e.get("peak_confidence", 0.0)) for e in merged_anthro_events) / len(merged_anthro_events)
                max_hazard = max(
                    HAZARD_TIER_WEIGHT.get(str(e.get("hazard_tier", "low")), 0.3)
                    for e in merged_anthro_events
                )
                weighted_sum += DISTURBANCE_WEIGHT_ANTHRO_CONF_COVERAGE * mean_peak
                total_weight += DISTURBANCE_WEIGHT_ANTHRO_CONF_COVERAGE
                components_used["anthropogenic_mean_confidence"] = round(mean_peak, 4)

                weighted_sum += DISTURBANCE_WEIGHT_HAZARD_SEVERITY * max_hazard
                total_weight += DISTURBANCE_WEIGHT_HAZARD_SEVERITY
                components_used["max_hazard_tier_weight"] = round(max_hazard, 4)

                if anthro_duration_ratio is not None:
                    weighted_sum += DISTURBANCE_WEIGHT_DURATION_RATIO * anthro_duration_ratio
                    total_weight += DISTURBANCE_WEIGHT_DURATION_RATIO
                    components_used["anthropogenic_duration_ratio"] = round(anthro_duration_ratio, 4)
            else:
                components_used["anthropogenic_mean_confidence"] = 0.0
                weighted_sum += DISTURBANCE_WEIGHT_ANTHRO_CONF_COVERAGE * 0.0
                total_weight += DISTURBANCE_WEIGHT_ANTHRO_CONF_COVERAGE
                if anthro_duration_ratio is not None:
                    components_used["anthropogenic_duration_ratio"] = 0.0
                    weighted_sum += DISTURBANCE_WEIGHT_DURATION_RATIO * 0.0
                    total_weight += DISTURBANCE_WEIGHT_DURATION_RATIO

            # Spectral component (derived from NDSI / 1-2 kHz band share)
            spectral_pressure = None
            if ndsi_pressure is not None and anthrophony_energy_share is not None:
                spectral_pressure = 0.5 * ndsi_pressure + 0.5 * anthrophony_energy_share
            elif ndsi_pressure is not None:
                spectral_pressure = ndsi_pressure
            elif anthrophony_energy_share is not None:
                spectral_pressure = anthrophony_energy_share

            if spectral_pressure is not None:
                weighted_sum += DISTURBANCE_WEIGHT_SPECTRAL_PRESSURE * spectral_pressure
                total_weight += DISTURBANCE_WEIGHT_SPECTRAL_PRESSURE
                components_used["spectral_pressure"] = round(spectral_pressure, 4)

            disturbance_index = round(max(0.0, min(1.0, weighted_sum / total_weight)), 4) if total_weight > 0 else None

            if not has_class_evidence:
                if spectral_pressure is not None and spectral_pressure >= 0.65:
                    status_val = "spectral_pressure_without_anthro_label"
                    severity = "elevated_unattributed_low_mid_energy"
                    interpretation = (
                        "Elevated 1-2 kHz acoustic energy relative to biophony observed without identified "
                        "anthropogenic sound-class detections. Cannot distinguish anthropogenic machinery from abiotic noise."
                    )
                else:
                    status_val = "no_anthropogenic_disturbance_detected"
                    severity = "none_detected"
                    interpretation = (
                        "No anthropogenic acoustic activity detected. Biological vocalizations were not treated as disturbance."
                    )
            else:
                if disturbance_index is not None and disturbance_index >= 0.65:
                    status_val = "anthropogenic_disturbance_detected"
                    severity = "elevated"
                    interpretation = (
                        f"Acoustic conditions are consistent with elevated disturbance: "
                        f"{len(merged_anthro_events)} anthropogenic sound event(s) identified across {anthro_covered_s:.1f}s."
                    )
                else:
                    status_val = "anthropogenic_activity_detected"
                    severity = "moderate" if (disturbance_index or 0.0) >= 0.35 else "low"
                    interpretation = (
                        f"Anthropogenic acoustic activity detected ({len(merged_anthro_events)} event(s)); "
                        "observations reflect acoustic presence and temporal overlap only without implying ecological harm."
                    )

        return {
            "status": status_val,
            "severity": severity,
            "disturbance_index": disturbance_index,
            "formula": (
                "Re-normalized weighted combination over available indicators: "
                "0.35*anthro_mean_conf + 0.25*anthro_duration_ratio + 0.25*spectral_pressure + 0.15*hazard_tier_weight"
            ),
            "methodology_note": (
                "HEURISTIC composite bounded in [0.0, 1.0]. Biological detections are strictly excluded from disturbance events. "
                "Temporal co-occurrence reflects overlap/sequence only; causality is never inferred."
            ),
            "anthropogenic_detections": anthro_raw,
            "anthropogenic_events": merged_anthro_events,
            "geophony_detections": geophony_raw,
            "measurable_indicators": {
                "anthropogenic_event_count": len(merged_anthro_events),
                "anthropogenic_raw_hits": len(anthro_raw),
                "anthropogenic_duration_seconds": round(anthro_covered_s, 3),
                "anthropogenic_duration_ratio": _safe_round(anthro_duration_ratio, 4),
                "anthrophony_energy_share": _safe_round(anthrophony_energy_share, 4),
                "ndsi": _safe_round(ndsi_val, 4),
                "ndsi_disturbance_pressure": _safe_round(ndsi_pressure, 4),
                "temporal_overlap_with_biology_count": overlapping_bio,
                "components_used": components_used,
            },
            "co_occurrences": co_occurrences,
            "interpretation": interpretation,
            "disclaimer": SCIENTIFIC_DISTURBANCE_DISCLAIMER,
            "provenance": {
                "source_model": species_analysis.get("provenance", {}).get("source_model", "BirdNET+ V3.0"),
                "processing_method": "non_biological_separation_and_spectral_pressure",
                "method_type": "HEURISTIC" if disturbance_index is not None else "UNAVAILABLE",
                "causal_claim_made": False,
            },
        }

    @staticmethod
    def build_context_analysis(
        *,
        recording_id: str,
        filename: Optional[str],
        duration_seconds: Optional[float],
        sample_rate: Optional[int],
        channels: Optional[int],
        latitude: Optional[float],
        longitude: Optional[float],
        recorded_at: Optional[datetime],
        model_version: Optional[str],
        execution_provider: Optional[str],
        species_analysis: Dict[str, Any],
        disturbance_analysis: Dict[str, Any],
        soundscape_data: Optional[Dict[str, Any]],
        location_name: Optional[str] = None,
        ecosystem_category: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Assemble real measured/derived recording, acoustic, biological, anthropogenic, and temporal context."""
        week = date_to_birdnet_week(recorded_at)
        obs_date = (recorded_at or datetime.now(timezone.utc)).strftime("%Y-%m-%d")

        has_coords = (
            latitude is not None
            and longitude is not None
            and math.isfinite(float(latitude))
            and math.isfinite(float(longitude))
        )
        gen_coords = (
            {"latitude": round(float(latitude), 2), "longitude": round(float(longitude), 2)}
            if has_coords
            else None
        )

        # Acoustic context
        sc_metrics = (soundscape_data or {}).get("metrics") or {}
        sc_bands = (soundscape_data or {}).get("frequency_bands") or {}
        sc_params = (soundscape_data or {}).get("calculation_parameters") or {}
        sc_flags = (soundscape_data or {}).get("quality_flags") or []
        core_bands = {
            k: v for k, v in sc_bands.items()
            if k in {
                "low_frequency_0_1k_pct",
                "mid_frequency_1_2k_pct",
                "biophony_band_2_8k_pct",
                "high_frequency_8_14k_pct",
                "upper_frequency_14_16k_pct",
            }
        }
        dom_band = max(core_bands, key=lambda k: float(core_bands[k])) if core_bands else None

        acoustic_ctx = (
            {
                "status": "measured",
                "soundscape_metrics": sc_metrics,
                "frequency_bands": core_bands or sc_bands,
                "dominant_frequency_band": dom_band,
                "quality_flags": sc_flags,
                "calculation_parameters": sc_params,
                "method_type": "DERIVED",
            }
            if sc_metrics
            else {
                "status": "unavailable",
                "soundscape_metrics": None,
                "frequency_bands": None,
                "dominant_frequency_band": None,
                "quality_flags": ["soundscape_metrics_unavailable"],
                "calculation_parameters": {},
                "method_type": "UNAVAILABLE",
            }
        )

        # Biological context
        bio_detections = species_analysis.get("biological_detections", [])
        bio_species = species_analysis.get("species", [])
        bio_confs = [float(d["confidence"]) for d in bio_detections if "confidence" in d]
        bio_ctx = {
            "status": "detected" if bio_detections else "no_biological_detections",
            "unique_species_count": len(bio_species),
            "detection_count": len(bio_detections),
            "taxa_breakdown": species_analysis.get("summary", {}).get("biological_taxa_breakdown", {}),
            "dominant_biological_taxa": [s["common_name"] or s["scientific_name"] for s in bio_species[:5]],
            "confidence_stats": (
                {
                    "min": round(min(bio_confs), 4),
                    "max": round(max(bio_confs), 4),
                    "mean": round(sum(bio_confs) / len(bio_confs), 4),
                }
                if bio_confs
                else None
            ),
            "method_type": "MODEL_BASED" if bio_detections else "DATA_BASED",
        }

        # Anthropogenic context
        anthro_events = disturbance_analysis.get("anthropogenic_events", [])
        indicators = disturbance_analysis.get("measurable_indicators", {})
        anthro_ctx = {
            "status": "detected" if anthro_events else "none_detected",
            "event_count": len(anthro_events),
            "categories_present": sorted({str(e.get("category")) for e in anthro_events if e.get("category")}),
            "total_disturbance_duration_seconds": indicators.get("anthropogenic_duration_seconds", 0.0),
            "anthrophony_band_pct": sc_bands.get("mid_frequency_1_2k_pct"),
            "disturbance_index": disturbance_analysis.get("disturbance_index"),
            "method_type": "HEURISTIC" if disturbance_analysis.get("disturbance_index") is not None else "DATA_BASED",
        }

        # Temporal context
        total_windows = int(float(duration_seconds) // 3.0) if duration_seconds and duration_seconds > 0 else None
        active_bio_windows = len({
            (round(float(d["start_seconds"]), 2), round(float(d["end_seconds"]), 2))
            for d in bio_detections
        })
        active_anthro_windows = len({
            (round(float(d["start_seconds"]), 2), round(float(d["end_seconds"]), 2))
            for d in disturbance_analysis.get("anthropogenic_detections", [])
        })
        temporal_coverage = (
            round(min(1.0, active_bio_windows / max(1, total_windows)), 4)
            if total_windows is not None and total_windows > 0
            else None
        )

        temporal_ctx = {
            "duration_seconds": _safe_round(duration_seconds, 3),
            "total_3s_windows": total_windows,
            "active_biological_windows": active_bio_windows,
            "active_anthropogenic_windows": active_anthro_windows,
            "biological_window_coverage_ratio": temporal_coverage,
            "biological_first_seen_seconds": round(min(float(d["start_seconds"]) for d in bio_detections), 3) if bio_detections else None,
            "biological_last_seen_seconds": round(max(float(d["end_seconds"]) for d in bio_detections), 3) if bio_detections else None,
            "method_type": "DATA_BASED",
        }

        recording_ctx = {
            "recording_id": recording_id,
            "filename": filename,
            "duration_seconds": _safe_round(duration_seconds, 3),
            "sample_rate": sample_rate,
            "channels": channels,
            "latitude": float(latitude) if has_coords else None,
            "longitude": float(longitude) if has_coords else None,
            "generalized_coordinates": gen_coords,
            "location_name": location_name or ("Field Recording Locus" if has_coords else None),
            "ecosystem_category": ecosystem_category or "unspecified",
            "recorded_at": recorded_at.isoformat() if recorded_at else None,
            "observation_date": obs_date,
            "meteorological_week": week,
            "model_version": model_version,
            "execution_provider": execution_provider,
            "coordinate_status": "provided" if has_coords else "unspecified",
            "method_type": "DATA_BASED",
        }

        return {
            "status": "complete" if sc_metrics else "partial",
            "recording_context": recording_ctx,
            "acoustic_context": acoustic_ctx,
            "biological_context": bio_ctx,
            "anthropogenic_context": anthro_ctx,
            "temporal_context": temporal_ctx,
            "provenance": {
                "processing_method": "single_pass_metadata_and_soundscape_aggregation",
                "method_type": "DERIVED",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            },
        }

    @staticmethod
    async def build_expected_and_gap(
        *,
        recording_id: str,
        timestamp: Optional[datetime],
        duration_seconds: float,
        latitude: Optional[float],
        longitude: Optional[float],
        biological_detections: Sequence[Dict[str, Any]],
        unknown_detections: Sequence[Dict[str, Any]],
        soundscape_data: Optional[Dict[str, Any]],
        min_occurrence_score: float = 0.08,
        min_confidence: float = 0.25,
        location_name: Optional[str] = None,
        ecosystem_category: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Compute expected_species_analysis and observation_gap_analysis with strict unavailable semantics."""
        ts = timestamp or datetime.now(timezone.utc)
        week = date_to_birdnet_week(ts)
        ref_ts = datetime.now(timezone.utc).isoformat()
        provider = get_ecological_knowledge_provider()

        sc_metrics = (soundscape_data or {}).get("metrics") or {}
        if latitude is None or longitude is None:
            expected_section = {
                "status": "location_unspecified",
                "expected_species_status": "reference_unavailable",
                "expected_species": None,
                "expected_count": None,
                "reason": (
                    "Geographic coordinates (latitude, longitude) were not provided with this recording; "
                    "regional species expectations cannot be determined without fabricated assumptions."
                ),
                "provenance": {
                    "source": "BirdNET Geo V3.0 ONNX",
                    "reference_type": "model_prediction",
                    "confidence": "unavailable",
                    "reference_timestamp": ref_ts,
                    "meteorological_week": week,
                    "method_type": "UNAVAILABLE",
                },
            }
            gap_section = {
                "status": "reference_unavailable",
                "expected": None,
                "observed": observation_gap_engine.filter_and_aggregate_detections(
                    biological_detections, min_confidence=min_confidence
                ).values() if biological_detections else [],
                "not_detected": None,
                "not_expected": None,
                "unknown": list(unknown_detections),
                "coverage": {
                    "expected_species_count": None,
                    "detected_expected_count": None,
                    "detected_unexpected_count": None,
                    "gap_count": None,
                    "coverage_ratio": None,
                    "coverage_percentage": None,
                    "observation_adequacy": "location_unspecified",
                    "adequacy_explanation": (
                        "Observation gap comparison requires geographic coordinates to compute expected species."
                    ),
                },
                "coverage_ratio": None,
                "confidence": "unavailable",
                "limitations": [
                    "Recording metadata lacks latitude/longitude coordinates.",
                    "Observed biological taxa are still reported cleanly without fabrication.",
                ],
                "scientific_disclaimer": SCIENTIFIC_ABSENCE_DISCLAIMER,
                "provenance": {
                    "processing_method": "set_comparison",
                    "method_type": "UNAVAILABLE",
                    "reference_timestamp": ref_ts,
                },
            }
            gap_section["observed"] = list(gap_section["observed"])
            return {"expected_species": expected_section, "observation_gap": gap_section}

        try:
            ctx = await provider.resolve_context(
                session_id=recording_id,
                timestamp=ts,
                duration_sec=float(duration_seconds or 0.0),
                latitude=float(latitude),
                longitude=float(longitude),
                location_name=location_name,
                ecosystem_category=ecosystem_category,
                soundscape_metrics={
                    "aci": float(sc_metrics["aci"]) if sc_metrics.get("aci") is not None else 0.0,
                    "ndsi": float(sc_metrics["ndsi"]) if sc_metrics.get("ndsi") is not None else 0.0,
                } if sc_metrics else None,
            )
            expected_items = await provider.get_expected_species(
                context=ctx, min_score=min_occurrence_score, top_k=60
            )
        except (InvalidObservationCoordinatesError, EcologicalProviderUnavailableError) as exc:
            expected_section = {
                "status": "reference_unavailable",
                "expected_species_status": "reference_unavailable",
                "expected_species": None,
                "expected_count": None,
                "reason": str(exc),
                "provenance": {
                    "source": "BirdNET Geo V3.0 ONNX",
                    "reference_type": "model_prediction",
                    "confidence": "unavailable",
                    "reference_timestamp": ref_ts,
                    "meteorological_week": week,
                    "method_type": "UNAVAILABLE",
                },
            }
            observed_agg = list(
                observation_gap_engine.filter_and_aggregate_detections(
                    biological_detections, min_confidence=min_confidence
                ).values()
            )
            gap_section = {
                "status": "reference_unavailable",
                "expected": None,
                "observed": observed_agg,
                "not_detected": None,
                "not_expected": None,
                "unknown": list(unknown_detections),
                "coverage": {
                    "expected_species_count": None,
                    "detected_expected_count": None,
                    "detected_unexpected_count": None,
                    "gap_count": None,
                    "coverage_ratio": None,
                    "coverage_percentage": None,
                    "observation_adequacy": "location_unspecified",
                    "adequacy_explanation": str(exc),
                },
                "coverage_ratio": None,
                "confidence": "unavailable",
                "limitations": [str(exc)],
                "scientific_disclaimer": SCIENTIFIC_ABSENCE_DISCLAIMER,
                "provenance": {
                    "processing_method": "set_comparison",
                    "method_type": "UNAVAILABLE",
                    "reference_timestamp": ref_ts,
                },
            }
            return {"expected_species": expected_section, "observation_gap": gap_section}

        # Distinguish genuine empty checklist vs populated checklist
        exp_status = "available" if expected_items else "empty_reference"
        expected_dicts = [item.model_dump() for item in expected_items]
        expected_section = {
            "status": exp_status,
            "expected_species_status": exp_status,
            "expected_species": expected_dicts,
            "expected_count": len(expected_dicts),
            "min_occurrence_score": min_occurrence_score,
            "reason": (
                None
                if expected_items
                else f"No BirdNET Geo V3.0 species met occurrence_score >= {min_occurrence_score:.2f} at ({latitude:.2f}, {longitude:.2f}) in week {week}."
            ),
            "provenance": {
                "source": "BirdNET Geo V3.0 ONNX",
                "reference_type": "model_prediction",
                "confidence": "modeled_regional_prior",
                "reference_timestamp": ref_ts,
                "meteorological_week": week,
                "method_type": "MODEL_BASED",
            },
        }

        expected_and_det, expected_not_det, detected_unexp, coverage = (
            observation_gap_engine.evaluate_observation_gap(
                context=ctx,
                expected_species=expected_items,
                raw_events=biological_detections,
                min_confidence=min_confidence,
            )
        )

        # Ensure every not_detected entry carries explicit absent=False alongside not_detected=True
        not_detected_dicts = []
        for item in expected_not_det:
            row = item.model_dump()
            row["not_detected"] = True
            row["absent"] = False
            row["classification"] = "not_detected"
            not_detected_dicts.append(row)

        observed_dicts = []
        for item in expected_and_det:
            row = item.model_dump()
            row["classification"] = "observed"
            observed_dicts.append(row)

        not_expected_dicts = []
        for item in detected_unexp:
            row = item.model_dump()
            row["classification"] = "not_expected"
            not_expected_dicts.append(row)

        limitations = [coverage.adequacy_explanation]
        if unknown_detections:
            limitations.append(
                f"{len(unknown_detections)} uncertain/low-confidence detection(s) excluded from species comparison."
            )
        if duration_seconds < 120.0:
            limitations.append(
                "Short recording duration (<120s) limits detectability of infrequently vocalizing taxa."
            )

        gap_confidence = (
            "moderate"
            if coverage.observation_adequacy == "adequate"
            else ("low" if coverage.observation_adequacy in {"marginal_duration", "zero_detections"} else "very_low")
        )

        cov_dict = coverage.model_dump()
        gap_section = {
            "status": "evaluated" if expected_items else "empty_reference",
            "expected": expected_dicts,
            "observed": observed_dicts,
            "not_detected": not_detected_dicts,
            "not_expected": not_expected_dicts,
            "unknown": list(unknown_detections),
            "coverage": cov_dict,
            "coverage_ratio": cov_dict["coverage_ratio"] if expected_items else None,
            "confidence": gap_confidence,
            "limitations": limitations,
            "scientific_disclaimer": SCIENTIFIC_ABSENCE_DISCLAIMER,
            "coverage_disclaimer": ACOUSTIC_COVERAGE_DISCLAIMER,
            "provenance": {
                "processing_method": "deterministic_set_comparison_expected_vs_observed_biology",
                "method_type": "DERIVED",
                "reference_source": "BirdNET Geo V3.0 ONNX",
                "reference_timestamp": ref_ts,
            },
        }
        return {"expected_species": expected_section, "observation_gap": gap_section}

    async def build_analysis_ecology(
        self,
        *,
        analysis_id: str,
        filename: Optional[str],
        duration_seconds: float,
        sample_rate: Optional[int],
        channels: Optional[int],
        latitude: Optional[float],
        longitude: Optional[float],
        recorded_at: Optional[datetime],
        model_version: Optional[str],
        execution_provider: Optional[str],
        raw_detections: Sequence[Any],
        processed_audio: Optional[np.ndarray] = None,
        existing_soundscape: Optional[Dict[str, Any]] = None,
        location_name: Optional[str] = None,
        ecosystem_category: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Compute full 5-section ecological analysis ONCE from shared intermediate artifacts."""
        soundscape_data: Optional[Dict[str, Any]] = existing_soundscape
        if soundscape_data is None and processed_audio is not None and len(processed_audio) > 0:
            try:
                sr = int(sample_rate or 32000)
                if duration_seconds > 65.0:
                    trend = soundscape_intelligence_service.analyze_multi_window(
                        processed_audio, sample_rate=sr, window_duration_s=30.0, hop_duration_s=30.0, session_id=analysis_id
                    )
                    soundscape_data = {
                        "metrics": trend.mean_metrics,
                        "frequency_bands": trend.measurements[-1].frequency_bands if trend.measurements else {},
                        "calculation_parameters": trend.measurements[-1].calculation_parameters if trend.measurements else {},
                        "quality_flags": trend.quality_flags,
                    }
                else:
                    meas = soundscape_intelligence_service.analyze_audio_window(
                        processed_audio, sample_rate=sr, start_seconds=0.0, end_seconds=duration_seconds, session_id=analysis_id
                    )
                    soundscape_data = {
                        "metrics": meas.metrics,
                        "frequency_bands": meas.frequency_bands,
                        "calculation_parameters": meas.calculation_parameters,
                        "quality_flags": meas.quality_flags,
                    }
            except Exception as exc:
                logger.warning("Soundscape computation failed for analysis %s: %s", analysis_id, exc)
                soundscape_data = None

        species_section = self.build_species_analysis(
            raw_detections,
            source_model=model_version or "BirdNET+ V3.0",
        )
        disturbance_section = self.build_disturbance_analysis(
            analysis_or_session_id=analysis_id,
            species_analysis=species_section,
            duration_seconds=duration_seconds,
            soundscape_data=soundscape_data,
        )
        context_section = self.build_context_analysis(
            recording_id=analysis_id,
            filename=filename,
            duration_seconds=duration_seconds,
            sample_rate=sample_rate,
            channels=channels,
            latitude=latitude,
            longitude=longitude,
            recorded_at=recorded_at,
            model_version=model_version,
            execution_provider=execution_provider,
            species_analysis=species_section,
            disturbance_analysis=disturbance_section,
            soundscape_data=soundscape_data,
            location_name=location_name,
            ecosystem_category=ecosystem_category,
        )
        expected_and_gap = await self.build_expected_and_gap(
            recording_id=analysis_id,
            timestamp=recorded_at,
            duration_seconds=duration_seconds,
            latitude=latitude,
            longitude=longitude,
            biological_detections=species_section["biological_detections"],
            unknown_detections=species_section["unknown_detections"],
            soundscape_data=soundscape_data,
            location_name=location_name,
            ecosystem_category=ecosystem_category,
        )

        geospatial_section = self.build_geospatial_context(
            latitude=latitude,
            longitude=longitude,
            timestamp=recorded_at,
            ecosystem_category=ecosystem_category,
            location_name=location_name,
            expected_species_status=str(expected_and_gap["expected_species"].get("expected_species_status", "reference_unavailable")),
            expected_count=expected_and_gap["expected_species"].get("expected_count"),
        )

        # Resolve provenance-tracked specimen images ONCE across observed + top expected species (bounded & cached)
        exp_section = expected_and_gap["expected_species"]
        gap_section = expected_and_gap["observation_gap"]
        image_targets: list[tuple[str, Optional[str]]] = []
        for s in species_section.get("species", []):
            image_targets.append((str(s.get("scientific_name", "")), s.get("common_name")))
        for s in gap_section.get("observed") or []:
            image_targets.append((str(s.get("scientific_name", "")), s.get("common_name")))
        for s in gap_section.get("not_expected") or []:
            image_targets.append((str(s.get("scientific_name", "")), s.get("common_name")))
        for s in (exp_section.get("expected_species") or [])[:18]:
            image_targets.append((str(s.get("scientific_name", "")), s.get("common_name")))

        try:
            image_map = await species_image_service.resolve_batch(image_targets, max_external=12, concurrency=4)
        except Exception as img_exc:
            logger.warning("Species image enrichment skipped cleanly: %s", img_exc)
            image_map = {}

        def _attach_image_dict(row: Dict[str, Any]) -> None:
            key = species_image_service.normalize_key(str(row.get("scientific_name", "")))
            if key in image_map:
                row["image"] = image_map[key]

        for s in species_section.get("species", []):
            _attach_image_dict(s)
        for s in exp_section.get("expected_species") or []:
            _attach_image_dict(s)
        for s in gap_section.get("observed") or []:
            _attach_image_dict(s)
        for s in gap_section.get("not_expected") or []:
            _attach_image_dict(s)
        for s in gap_section.get("not_detected") or []:
            _attach_image_dict(s)

        return {
            "schema_version": "2.0",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "species": species_section,
            "disturbance": disturbance_section,
            "context": context_section,
            "geospatial_context": geospatial_section,
            "expected_species": exp_section,
            "observation_gap": gap_section,
            "soundscape": soundscape_data,
        }


ecological_analysis_service = EcologicalAnalysisService()
