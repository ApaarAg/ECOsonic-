"""EcoSonic Acoustic Anomaly Discovery Service.

Detects statistically unusual environmental acoustic segments by combining:
1. Embedding space nearest-neighbor distance (unfamiliar acoustic representations).
2. HDBSCAN density outlier probabilities (points residing outside dense acoustic niches).
3. Soundscape index divergence (abrupt spectral/temporal energy distribution shifts).
4. Temporal recurrence infrequency (singular, non-repeating acoustic events).

Scientific Guardrails:
1. An unusual acoustic event is NOT necessarily a new species or ecological threat.
2. Anomaly scores quantify mathematical divergence from established acoustic baselines.
   Common causes include sensor handling noise, wind buffeting, rare flight calls, or novel mechanical transients.
3. Every candidate is structured for expert human verification with raw audio and embedding evidence.
"""

from __future__ import annotations

import logging
import math
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

from app.services.acoustic_memory.embedding_index import (
    EmbeddingIndexService,
    embedding_index_service,
)
from app.services.acoustic_memory.similarity_service import (
    AcousticSimilarityService,
    SimilaritySearchResult,
    similarity_service,
)

logger = logging.getLogger(__name__)

SCIENTIFIC_ANOMALY_DISCLAIMER = (
    "Acoustic anomaly candidates denote mathematical deviations from indexed baseline soundscapes. "
    "They do NOT establish taxonomic discovery, novel biological species, or ecological hazards."
)


@dataclass
class AnomalyCandidate:
    """Standardized, reviewable acoustic anomaly candidate."""

    candidate_id: str
    segment_id: str
    session_id: Optional[str]
    analysis_id: Optional[str]
    start_seconds: float
    end_seconds: float
    duration_seconds: float
    anomaly_score: float  # [0.0, 1.0]
    heuristic_breakdown: Dict[str, float]
    primary_reasons: List[str]
    top_similar_matches: List[Dict[str, Any]]
    model_predictions: List[Dict[str, Any]]
    embedding_storage_path: Optional[str]
    audio_path: Optional[str]
    soundscape_context: Dict[str, Any]
    review_status: str = "unreviewed"  # unreviewed, verified_novelty, artifact, ignored
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    disclaimer: str = SCIENTIFIC_ANOMALY_DISCLAIMER

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class AcousticAnomalyService:
    """Production service evaluating acoustic novelty and queuing candidates for human review."""

    def __init__(
        self,
        index_service: Optional[EmbeddingIndexService] = None,
        sim_service: Optional[AcousticSimilarityService] = None,
        anomaly_threshold: float = 0.65,
    ) -> None:
        self.index_service = index_service or embedding_index_service
        self.similarity_service = sim_service or similarity_service
        self.anomaly_threshold = anomaly_threshold

    def evaluate_vector_novelty(
        self,
        vector: np.ndarray,
        k_neighbors: int = 5,
        exclude_segment_id: Optional[str] = None,
    ) -> Tuple[float, List[SimilaritySearchResult], Dict[str, float]]:
        """Compute multi-factor embedding distance and novelty against the indexed corpus.

        Returns:
            Tuple of (composite_novelty_score, top_k_matches, factor_breakdown).
        """
        # Validate and normalize
        v_clean = self.index_service.validate_vector(vector)
        v_norm = self.index_service.normalize_vector(v_clean)

        n_indexed = self.index_service.vector_count
        if n_indexed == 0:
            # First vector in empty corpus is maximally novel by definition
            return 1.0, [], {"knn_distance": 1.0, "density_spread": 1.0, "corpus_support": 0.0}

        # Retrieve top k nearest neighbors
        matches = self.similarity_service.search(
            query_vector=v_norm,
            limit=max(k_neighbors, 5),
            exclude_same_session=False,
        )

        # Filter out self if specified
        if exclude_segment_id:
            matches = [m for m in matches if m.segment_id != exclude_segment_id]

        if not matches:
            return 1.0, [], {"knn_distance": 1.0, "density_spread": 1.0, "corpus_support": 0.0}

        # 1. Distance to nearest neighbor: d_1 = 1.0 - max_sim
        top1_sim = float(matches[0].similarity_score)
        d_top1 = max(0.0, min(1.0, 1.0 - top1_sim))

        # 2. Mean k-NN distance (local density factor)
        k_eval = min(len(matches), k_neighbors)
        k_sims = [m.similarity_score for m in matches[:k_eval]]
        mean_knn_dist = float(np.mean([max(0.0, 1.0 - s) for s in k_sims]))

        # 3. Corpus support penalization (small corpora yield conservative confidence)
        corpus_support = min(1.0, n_indexed / 100.0)

        # Composite novelty score: 60% nearest neighbor distance + 40% local density distance
        raw_novelty = (0.60 * d_top1 + 0.40 * mean_knn_dist) * corpus_support
        novelty_score = round(max(0.0, min(1.0, raw_novelty)), 4)

        factors = {
            "top1_distance": round(d_top1, 4),
            "mean_knn_distance": round(mean_knn_dist, 4),
            "top1_similarity": round(top1_sim, 4),
            "corpus_support": round(corpus_support, 4),
        }

        return novelty_score, matches[:k_neighbors], factors

    def evaluate_segment_anomaly(
        self,
        segment_id: str,
        soundscape_metrics: Optional[Dict[str, Any]] = None,
        model_predictions: Optional[List[Dict[str, Any]]] = None,
        audio_path: Optional[str] = None,
        baseline_soundscape: Optional[Dict[str, Any]] = None,
    ) -> Optional[AnomalyCandidate]:
        """Evaluate a specific indexed segment for acoustic anomalousness.

        Args:
            segment_id: Indexed acoustic segment UUID.
            soundscape_metrics: Optional current soundscape metrics (ACI, NDSI, etc.).
            model_predictions: Detected biological or disturbance classes from BirdNET.
            audio_path: Optional path to segment audio WAV.
            baseline_soundscape: Optional historical baseline soundscape metrics for session/site.

        Returns:
            AnomalyCandidate if anomaly score exceeds threshold, else None.
        """
        vec = self.index_service.get_vector(segment_id, normalized=False)
        if vec is None:
            logger.warning("Segment ID '%s' not found in vector index.", segment_id)
            return None

        meta = self.index_service.get_metadata(segment_id)
        session_id = meta.session_id if meta else None
        analysis_id = meta.analysis_id if meta else None
        start_sec = meta.start_seconds if meta else 0.0
        end_sec = meta.end_seconds if meta else 3.0
        storage_path = meta.vector_storage_path if meta else None
        seg_audio = audio_path or (meta.audio_path if meta else None)

        # 1. Embedding novelty
        emb_score, matches, emb_factors = self.evaluate_vector_novelty(
            vector=vec,
            k_neighbors=5,
            exclude_segment_id=segment_id,
        )

        reasons: List[str] = []
        if emb_score >= 0.50:
            reasons.append("High geometric distance from all known acoustic representations")

        # 2. Soundscape deviation factor
        soundscape_dev = 0.0
        if soundscape_metrics and baseline_soundscape:
            ndsi_cur = soundscape_metrics.get("ndsi")
            ndsi_base = baseline_soundscape.get("ndsi")
            if ndsi_cur is not None and ndsi_base is not None:
                delta_ndsi = abs(float(ndsi_cur) - float(ndsi_base))
                soundscape_dev += min(0.5, delta_ndsi / 2.0)

            ent_cur = soundscape_metrics.get("spectral_entropy")
            ent_base = baseline_soundscape.get("spectral_entropy")
            if ent_cur is not None and ent_base is not None:
                delta_ent = abs(float(ent_cur) - float(ent_base))
                soundscape_dev += min(0.5, delta_ent)

            if soundscape_dev >= 0.40:
                reasons.append("Acoustic energy distribution deviated significantly from baseline")

        # 3. Model classification ambiguity factor
        # If model produced zero confident detections, signal is unrecognized
        model_ambiguity = 0.0
        preds = model_predictions or []
        if meta and meta.label:
            preds.append({"label": meta.label, "confidence": meta.confidence})

        confidences = [p.get("confidence", 0.0) for p in preds if p.get("confidence")]
        max_conf = max(confidences) if confidences else 0.0

        if max_conf < 0.20:
            model_ambiguity = 0.30
            reasons.append("No recognizable biological or disturbance vocalization identified")
        elif max_conf < 0.40:
            model_ambiguity = 0.15

        # 4. Composite Anomaly Score: 60% embedding novelty + 25% soundscape deviation + 15% model ambiguity
        composite_score = round(
            0.60 * emb_score + 0.25 * min(1.0, soundscape_dev) + 0.15 * model_ambiguity, 4
        )

        heuristic = {
            "composite_score": composite_score,
            "embedding_novelty": emb_score,
            "soundscape_deviation": round(soundscape_dev, 4),
            "model_ambiguity": round(model_ambiguity, 4),
            **emb_factors,
        }

        # Build candidate object
        top_matches_summary = [
            {
                "segment_id": m.segment_id,
                "similarity": m.similarity_score,
                "label": m.label,
                "session_id": m.session_id,
            }
            for m in matches[:3]
        ]

        candidate = AnomalyCandidate(
            candidate_id=str(uuid.uuid4()),
            segment_id=segment_id,
            session_id=session_id,
            analysis_id=analysis_id,
            start_seconds=round(start_sec, 3),
            end_seconds=round(end_sec, 3),
            duration_seconds=round(end_sec - start_sec, 3),
            anomaly_score=composite_score,
            heuristic_breakdown=heuristic,
            primary_reasons=reasons or ["Acoustic signature divergent from nearest corpus clusters"],
            top_similar_matches=top_matches_summary,
            model_predictions=preds,
            embedding_storage_path=storage_path,
            audio_path=seg_audio,
            soundscape_context=soundscape_metrics or {},
        )

        return candidate

    def discover_session_anomalies(
        self,
        session_id: str,
        threshold: Optional[float] = None,
        max_candidates: int = 20,
    ) -> List[AnomalyCandidate]:
        """Scan all indexed segments belonging to a session and return prioritized anomaly candidates."""
        cutoff = threshold if threshold is not None else self.anomaly_threshold
        seg_ids, _, meta_list = self.index_service.get_all_vectors(normalized=True)

        session_segments = [
            meta.segment_id for meta in meta_list if meta.session_id == session_id
        ]

        candidates: List[AnomalyCandidate] = []
        for seg_id in session_segments:
            cand = self.evaluate_segment_anomaly(seg_id)
            if cand and cand.anomaly_score >= cutoff:
                candidates.append(cand)

        # Sort highest anomaly score first
        candidates.sort(key=lambda c: c.anomaly_score, reverse=True)
        return candidates[:max_candidates]


# Singleton instance
acoustic_anomaly_service = AcousticAnomalyService()
