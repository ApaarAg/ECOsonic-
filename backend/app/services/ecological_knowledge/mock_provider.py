"""Mock / Static checklist provider for deterministic testing of ecological intelligence."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from app.schemas.ecological_intelligence import (
    ExpectedSpeciesItem,
    ObservationContext,
)
from app.services.ecological_knowledge.provider_base import (
    EcologicalKnowledgeProvider,
    InvalidObservationCoordinatesError,
    canonical_species_id,
)
from app.services.geo_temporal_service import date_to_birdnet_week, geo_temporal_service


class MockEcologicalKnowledgeProvider(EcologicalKnowledgeProvider):
    """Deterministic mock provider with configurable expected species rosters."""

    def __init__(
        self,
        canned_expected: Optional[List[ExpectedSpeciesItem]] = None,
    ) -> None:
        normalized: List[ExpectedSpeciesItem] = []
        self._taxonomy_lookup: Dict[str, Dict[str, Any]] = {}
        for sp in canned_expected or []:
            sp_id = sp.species_id or canonical_species_id(sp.scientific_name, sp.birdnet_taxonomy_id)
            item = sp.model_copy(update={"species_id": sp_id})
            normalized.append(item)
            self._taxonomy_lookup[item.scientific_name.lower()] = {
                "species_id": sp_id,
                "scientific_name": item.scientific_name,
                "common_name": item.common_name,
                "birdnet_taxonomy_id": item.birdnet_taxonomy_id,
                "ebird_code": item.ebird_code,
            }
        self.canned_expected = normalized

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
        week = date_to_birdnet_week(timestamp)
        date_str = timestamp.strftime("%Y-%m-%d") if timestamp else datetime.now(timezone.utc).strftime("%Y-%m-%d")

        gen_coords = None
        if latitude is not None and longitude is not None:
            try:
                latitude, longitude = geo_temporal_service.validate_coordinates(latitude, longitude)
            except ValueError as exc:
                raise InvalidObservationCoordinatesError(str(exc)) from exc
            gen_coords = {"latitude": round(latitude, 2), "longitude": round(longitude, 2)}
        elif latitude is not None or longitude is not None:
            raise InvalidObservationCoordinatesError(
                "Both latitude and longitude must be provided together."
            )

        return ObservationContext(
            session_id=session_id,
            latitude=latitude,
            longitude=longitude,
            generalized_coordinates=gen_coords,
            location_name=location_name or "Test Acoustic Station",
            ecosystem_category=ecosystem_category or "unspecified",
            elevation_m=elevation_m,
            timestamp=timestamp.isoformat() if timestamp else datetime.now(timezone.utc).isoformat(),
            observation_date=date_str,
            meteorological_week=week,
            observation_duration_sec=round(duration_sec, 2),
            total_audio_windows=int(duration_sec // 3.0),
        )

    async def get_expected_species(
        self,
        context: ObservationContext,
        min_score: float = 0.08,
        top_k: int = 60,
    ) -> List[ExpectedSpeciesItem]:
        if context.latitude is None or context.longitude is None:
            return []
        filtered = [s for s in self.canned_expected if s.occurrence_score >= min_score]
        return filtered[:top_k]

    async def get_species_metadata(
        self,
        scientific_name: str,
    ) -> Optional[Dict[str, Any]]:
        return self._taxonomy_lookup.get(scientific_name.lower())
