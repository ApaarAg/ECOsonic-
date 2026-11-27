"""Grounded Gemini Interpretation Service with strict hallucination guards and privacy filters.

Design Principles:
1. Gemini is an INTERPRETATION LAYER, never the source of truth for species ranges or detections.
2. Strict Grounding: Only species, metrics, and context explicitly present in input evidence are allowed.
3. Hallucination Guard: Any model output mentioning unsupported species is scrubbed or rejected.
4. Absence Guard: The model is forbidden from claiming species absence; non-detection is strictly enforced.
5. Location Privacy: High-precision coordinates are coarsened; only generalized context is sent to external APIs.
6. Graceful Degradation: If Gemini is unconfigured, unreachable, or times out, a deterministic rule engine provides the interpretation.
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Dict, List, Optional, Set

import httpx
from pydantic import BaseModel, Field

from app.schemas.ecological_intelligence import (
    DetectedSpeciesItem,
    EcologicalInterpretation,
    ObservationContext,
    ObservationGapCoverage,
    ObservationGapSpeciesItem,
)

logger = logging.getLogger(__name__)

GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"


class RawGeminiSchema(BaseModel):
    """Expected JSON structure from Gemini response."""

    summary: str = Field(..., description="2-3 sentence overview of the acoustic observation session")
    observation_gap_explanation: str = Field(
        ..., description="Explanation of why certain expected species were not registered acoustically"
    )
    detected_highlights: List[str] = Field(
        default_factory=list, description="Notable detected species based on vocal activity"
    )
    unobserved_expected_highlights: List[str] = Field(
        default_factory=list, description="Top regionally expected species that remained silent"
    )
    limitations: List[str] = Field(
        default_factory=list, description="Field recording constraints (weather, time, mic range, duration)"
    )


class EcologicalInterpretationService:
    """Asynchronous ecological interpretation service with strict grounding enforcement."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        model: str = DEFAULT_GEMINI_MODEL,
        timeout_seconds: float = 6.0,
    ) -> None:
        self.api_key = api_key or os.environ.get("GEMINI_API_KEY")
        self.model = model
        self.timeout_seconds = timeout_seconds

    def _build_allowed_species_lexicon(
        self,
        expected_and_detected: List[DetectedSpeciesItem],
        expected_but_not_detected: List[ObservationGapSpeciesItem],
        detected_unexpected: List[DetectedSpeciesItem],
    ) -> Set[str]:
        """Compile a normalized whitelist of all species names present in the evidence."""
        lexicon: Set[str] = set()

        def add_name(sci: str, com: Optional[str]):
            if sci:
                lexicon.add(sci.lower().strip())
                # Add individual words for common name checking (e.g. "thrush", "sparrow")
            if com:
                lexicon.add(com.lower().strip())
                for part in com.split():
                    if len(part) > 3:
                        lexicon.add(part.lower().strip())

        for d in expected_and_detected:
            add_name(d.scientific_name, d.common_name)
        for g in expected_but_not_detected:
            add_name(g.scientific_name, g.common_name)
        for u in detected_unexpected:
            add_name(u.scientific_name, u.common_name)

        return lexicon

    def _sanitize_absence_claims(self, text: str) -> str:
        """Replace scientifically inaccurate claims of species absence with non-detection phrasing."""
        sanitized = re.sub(
            r"\b(is|are|was|were)\s+absent\b",
            "was not acoustically detected",
            text,
            flags=re.IGNORECASE,
        )
        sanitized = re.sub(
            r"\b(confirmed|proven)\s+absence\b",
            "inconclusive acoustic non-detection",
            sanitized,
            flags=re.IGNORECASE,
        )
        sanitized = re.sub(
            r"\babsence\s+of\b",
            "lack of acoustic detections for",
            sanitized,
            flags=re.IGNORECASE,
        )
        sanitized = re.sub(
            r"\b(is|are|was|were)\s+not\s+present\b",
            "was not acoustically detected",
            sanitized,
            flags=re.IGNORECASE,
        )
        sanitized = re.sub(
            r"\bmissing\s+species\b",
            "unobserved expected species",
            sanitized,
            flags=re.IGNORECASE,
        )
        sanitized = re.sub(
            r"\bhave\s+disappeared\b",
            "were not registered",
            sanitized,
            flags=re.IGNORECASE,
        )
        sanitized = re.sub(
            r"\bextinct\b",
            "not registered in this acoustic window",
            sanitized,
            flags=re.IGNORECASE,
        )
        sanitized = re.sub(
            r"\binvasive\b",
            "unexpected visitor",
            sanitized,
            flags=re.IGNORECASE,
        )
        return sanitized

    def _has_ungrounded_taxon(self, text: str, allowed_lexicon: Set[str]) -> bool:
        """Return True if text names a scientific binomial or known animal/bird taxon not in allowed_lexicon."""
        lower_lexicon = {k.lower() for k in allowed_lexicon if k}
        cleaned = self._sanitize_absence_claims(text)
        text_lower = cleaned.lower()

        # 1. Detect ungrounded binomials (Capitalized Genus + lowercase species, e.g. 'Corvus corax')
        non_taxon_first_words = {
            "acoustic", "birdnet", "observation", "ecological", "session", "north", "south",
            "east", "west", "field", "station", "pacific", "temperate", "marginal", "insufficient",
            "location", "april", "january", "february", "march", "may", "june", "july",
            "august", "september", "october", "november", "december",
        }
        for match in re.finditer(r"\b([A-Z][a-z]{2,})\s+([a-z]{3,})\b", text):
            genus = match.group(1).lower()
            species = match.group(2).lower()
            if genus in non_taxon_first_words:
                continue
            binomial = f"{genus} {species}"
            # Ignore ordinary capitalized English phrases unless Genus-like or explicit scientific name check:
            # Known common English pair false-positives can be avoided if either matches common taxa markers or isn't plain prose;
            # specifically flag if binomial ends in Latin taxonomic suffixes or both words look binomial-like when not in lexicon
            latin_suffix = species.endswith(("us", "a", "is", "um", "ae", "ii", "i", "es", "ens", "or", "ax"))
            if latin_suffix and binomial not in lower_lexicon and genus not in lower_lexicon:
                return True

        # 2. Detect explicit ungrounded fauna / avian common taxa markers
        known_taxa_markers = {
            "elephant", "penguin", "lion", "tiger", "bear", "wolf", "zebra", "giraffe",
            "kangaroo", "koala", "monkey", "ape", "chimpanzee", "cheetah", "leopard",
            "whale", "dolphin", "shark", "seal", "otter", "flamingo", "pelican", "ostrich",
            "emu", "peacock", "macaw", "cockatoo", "toucan", "puffin", "albatross",
            "kiwi", "cassowary", "rhino", "rhinoceros", "hippo", "hippopotamus", "camel",
            "owl", "hawk", "eagle", "falcon", "osprey", "heron", "egret", "crane",
            "swan", "duck", "goose", "gull", "tern", "sandpiper", "plover", "woodpecker",
            "kingfisher", "hummingbird", "cardinal", "bluejay", "crow", "raven", "magpie",
            "starling", "sparrow", "finch", "warbler", "thrush", "wren", "robin",
            "chickadee", "nuthatch", "vireo", "swallow", "swift", "nightjar", "cuckoo",
            "dove", "pigeon", "grouse", "quail", "pheasant", "turkey", "vulture", "condor",
        }
        words = set(re.findall(r"\b[a-z]{3,}\b", text_lower))
        for marker in known_taxa_markers:
            if marker in words:
                # Allowed if the exact marker OR a common name in allowed_lexicon contains it as a whole word
                in_lex = any(re.search(rf"\b{re.escape(marker)}\b", lex) for lex in lower_lexicon)
                if not in_lex:
                    return True
        return False

    def _filter_hallucinated_items(
        self,
        items: List[str],
        allowed_lexicon: Set[str],
    ) -> List[str]:
        """Retain only items whose species references are grounded in the evidence lexicon."""
        filtered: List[str] = []
        for item in items:
            cleaned = self._sanitize_absence_claims(item)
            if self._has_ungrounded_taxon(cleaned, allowed_lexicon):
                logger.warning("Dropping ungrounded hallucinated item from interpretation: %s", item)
                continue
            filtered.append(cleaned)
        return filtered

    # Alias for testing and backwards compatibility
    _filter_ungrounded_highlights = _filter_hallucinated_items

    def generate_deterministic_fallback(
        self,
        context: ObservationContext,
        coverage: ObservationGapCoverage,
        expected_and_detected: List[DetectedSpeciesItem],
        expected_but_not_detected: List[ObservationGapSpeciesItem],
        detected_unexpected: List[DetectedSpeciesItem],
    ) -> EcologicalInterpretation:
        """Generate a rule-based ecological interpretation guaranteed to be 100% grounded and factual."""
        det_cnt = len(expected_and_detected)
        gap_cnt = len(expected_but_not_detected)
        unexp_cnt = len(detected_unexpected)
        pct = coverage.coverage_percentage

        summary = (
            f"Acoustic monitoring across a {context.observation_duration_sec:.0f}-second window in {context.ecosystem_category} "
            f"registered {det_cnt} regionally expected bird species, achieving {pct:.1f}% acoustic observation coverage "
            f"({coverage.detected_expected_count} of {coverage.expected_species_count} expected species)."
        )

        top_unobserved = [f"{g.common_name or g.scientific_name} ({g.occurrence_status} suitability: {g.occurrence_score:.2f})" for g in expected_but_not_detected[:3]]
        top_unobserved_str = ", ".join(top_unobserved) if top_unobserved else "none"

        gap_explanation = (
            f"{gap_cnt} expected species were not acoustically detected during this recording window (notably {top_unobserved_str}). "
            "Acoustic non-detection does NOT establish biological absence. Non-detection typically arises from vocal inactivity, "
            "distance beyond microphone capture radius, dense vegetation sound dampening, or observation timing."
        )

        detected_highlights = [
            f"{d.common_name or d.scientific_name}: {d.detection_count} acoustic vocalizations (max confidence: {d.max_confidence:.2f})"
            for d in expected_and_detected[:4]
        ]

        if detected_unexpected:
            detected_highlights.extend([
                f"Unexpected occurrence: {u.common_name or u.scientific_name} detected ({u.detection_count} hits, conf: {u.max_confidence:.2f}) — potential regional visitor, range shift, or transient migrant."
                for u in detected_unexpected[:2]
            ])

        unobserved_highlights = [
            f"{g.common_name or g.scientific_name}: expected in regional {context.ecosystem_category} checklist but silent during this interval."
            for g in expected_but_not_detected[:4]
        ]

        limitations = [
            f"Sampling duration is {context.observation_duration_sec:.0f} seconds; longer observations increase detectability.",
            "Single stationary microphone array records local acoustic radius only (~50–150m depending on canopy density).",
            "Non-vocal behaviors (foraging, brooding, resting) produce no bioacoustic signature.",
            "Species presence or absence should not be concluded from acoustic monitoring alone.",
        ]

        if context.observation_duration_sec < 120.0:
            limitations.insert(0, "CRITICAL: Recording duration < 120s is insufficient for representative ecological coverage.")

        return EcologicalInterpretation(
            summary=summary,
            observation_gap_explanation=gap_explanation,
            detected_highlights=detected_highlights,
            unobserved_expected_highlights=unobserved_highlights,
            limitations=limitations,
            disclaimer="Deterministic rule-based interpretation synthesized directly from verified ECOsonic observation evidence.",
            provider="deterministic_rule_engine",
            is_grounded=True,
        )

    async def interpret_observation_gap(
        self,
        context: ObservationContext,
        coverage: ObservationGapCoverage,
        expected_and_detected: List[DetectedSpeciesItem],
        expected_but_not_detected: List[ObservationGapSpeciesItem],
        detected_unexpected: List[DetectedSpeciesItem],
    ) -> EcologicalInterpretation:
        """Call Gemini to interpret structured evidence, strictly validating grounding and privacy."""
        # Check if Gemini is enabled and configured
        if not self.api_key or self.api_key.strip() in {"", "dummy", "placeholder", "your_gemini_api_key"}:
            logger.info("Gemini API key not configured. Using deterministic ecological interpretation.")
            return self.generate_deterministic_fallback(
                context, coverage, expected_and_detected, expected_but_not_detected, detected_unexpected
            )

        allowed_lexicon = self._build_allowed_species_lexicon(
            expected_and_detected, expected_but_not_detected, detected_unexpected
        )

        # Prepare privacy-safe coarse payload (NO high-precision GPS coordinates!)
        evidence_payload = {
            "observation_context": {
                "ecosystem": context.ecosystem_category,
                "location_region": context.location_name,
                "coarse_coordinates": context.generalized_coordinates,
                "observation_date": context.observation_date,
                "meteorological_week": context.meteorological_week,
                "duration_seconds": context.observation_duration_sec,
                "soundscape_indices": {
                    "acoustic_complexity_index": context.acoustic_complexity_index,
                    "normalized_difference_soundscape_index": context.normalized_difference_soundscape_index,
                },
            },
            "coverage_metrics": {
                "metric_name": coverage.metric_name,
                "expected_species_count": coverage.expected_species_count,
                "detected_expected_count": coverage.detected_expected_count,
                "gap_count": coverage.gap_count,
                "coverage_percentage": coverage.coverage_percentage,
                "adequacy": coverage.observation_adequacy,
            },
            "detected_expected_species": [
                {"scientific_name": d.scientific_name, "common_name": d.common_name, "vocalizations": d.detection_count, "confidence": d.max_confidence}
                for d in expected_and_detected[:8]
            ],
            "unobserved_expected_species": [
                {"scientific_name": g.scientific_name, "common_name": g.common_name, "suitability_score": g.occurrence_score, "suitability_status": g.occurrence_status}
                for g in expected_but_not_detected[:8]
            ],
            "detected_unexpected_species": [
                {"scientific_name": u.scientific_name, "common_name": u.common_name, "vocalizations": u.detection_count, "confidence": u.max_confidence}
                for u in detected_unexpected[:4]
            ],
        }

        system_instruction = (
            "You are an expert bioacoustics researcher for ECOsonic 3.0. "
            "Interpret the provided bioacoustic observation gap evidence. "
            "STRICT SCIENTIFIC RULES:\n"
            "1. NEVER state that any species is 'absent', 'extinct', or 'missing from the forest'. Acoustic non-detection does NOT prove biological absence.\n"
            "2. ONLY discuss species, metrics, and locations provided in the input evidence. NEVER invent or hallucinate species not listed.\n"
            "3. DO NOT label unexpected detections as 'invasive'; describe them as potential visitors, range shifts, or unusual observations.\n"
            "4. Return strict JSON conforming to the requested schema."
        )

        prompt = (
            f"Synthesize an ecological interpretation from this structured bioacoustic evidence:\n"
            f"{json.dumps(evidence_payload, indent=2)}\n\n"
            "Respond in JSON format with fields: summary, observation_gap_explanation, detected_highlights, "
            "unobserved_expected_highlights, limitations."
        )

        request_body = {
            "contents": [{"parts": [{"text": prompt}]}],
            "systemInstruction": {"parts": [{"text": system_instruction}]},
            "generationConfig": {
                "temperature": 0.2,
                "maxOutputTokens": 1024,
                "responseMimeType": "application/json",
            },
        }

        url = f"{GEMINI_API_URL.format(model=self.model)}?key={self.api_key}"

        try:
            async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
                res = await client.post(url, json=request_body)
                if res.status_code != 200:
                    logger.warning("Gemini API returned status %d: %s. Falling back to rule engine.", res.status_code, res.text[:200])
                    return self.generate_deterministic_fallback(
                        context, coverage, expected_and_detected, expected_but_not_detected, detected_unexpected
                    )

                data = res.json()
                text_content = data["candidates"][0]["content"]["parts"][0]["text"]
                parsed = json.loads(text_content)
                gemini_data = RawGeminiSchema.model_validate(parsed)

                # Grounding & Absence Sanitation
                safe_summary = self._sanitize_absence_claims(gemini_data.summary)
                safe_gap_exp = self._sanitize_absence_claims(gemini_data.observation_gap_explanation)
                if self._has_ungrounded_taxon(safe_summary, allowed_lexicon) or self._has_ungrounded_taxon(
                    safe_gap_exp, allowed_lexicon
                ):
                    logger.warning("Gemini summary/explanation referenced ungrounded taxa; falling back deterministically.")
                    return self.generate_deterministic_fallback(
                        context, coverage, expected_and_detected, expected_but_not_detected, detected_unexpected
                    )
                safe_detected = self._filter_hallucinated_items(gemini_data.detected_highlights, allowed_lexicon)
                safe_unobserved = self._filter_hallucinated_items(gemini_data.unobserved_expected_highlights, allowed_lexicon)
                safe_limitations = [self._sanitize_absence_claims(l) for l in gemini_data.limitations]

                # Ensure scientific non-detection disclaimer is always present in limitations
                if not any("not detected" in l.lower() or "non-detection" in l.lower() for l in safe_limitations):
                    safe_limitations.append("Acoustic non-detection does not confirm biological absence.")

                return EcologicalInterpretation(
                    summary=safe_summary,
                    observation_gap_explanation=safe_gap_exp,
                    detected_highlights=safe_detected,
                    unobserved_expected_highlights=safe_unobserved,
                    limitations=safe_limitations,
                    disclaimer="AI-assisted interpretation synthesized by Gemini from verified ECOsonic observation evidence.",
                    provider="gemini",
                    is_grounded=True,
                )

        except Exception as exc:
            logger.warning("Gemini interpretation failed (%s). Falling back to deterministic rule engine.", exc)
            return self.generate_deterministic_fallback(
                context, coverage, expected_and_detected, expected_but_not_detected, detected_unexpected
            )


# Global singleton
ecological_interpretation_service = EcologicalInterpretationService()
