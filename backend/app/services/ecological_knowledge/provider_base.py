"""Abstract base provider for ecological knowledge and species expectation modeling."""

from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime
import re
from typing import Any, Dict, List, Optional

from app.schemas.ecological_intelligence import (
    ExpectedSpeciesItem,
    ObservationContext,
)


class EcologicalProviderUnavailableError(RuntimeError):
    """Raised when the deterministic ecological knowledge provider cannot operate."""

    code = "ECOLOGICAL_DATA_UNAVAILABLE"


class InvalidObservationCoordinatesError(ValueError):
    """Raised when observation latitude/longitude coordinates are out of bounds or invalid."""

    code = "INVALID_OBSERVATION_COORDINATES"


def canonical_species_id(
    scientific_name: str,
    birdnet_taxonomy_id: Optional[str] = None,
) -> str:
    """Return a deterministic canonical species identifier."""
    if birdnet_taxonomy_id and birdnet_taxonomy_id.strip():
        return birdnet_taxonomy_id.strip()
    slug = re.sub(r"[^a-z0-9]+", "_", scientific_name.strip().lower()).strip("_")
    return f"taxon_{slug}" if slug else "taxon_unknown"


class EcologicalKnowledgeProvider(ABC):
    """Abstract interface for resolving regional species expectations and habitat context.

    Permits swappable backends:
    - Local BirdNET Geo V3.0 ONNX occurrence model
    - Regional static checklists / offline fixtures
    - External biodiversity services (e.g. eBird, GBIF, iNaturalist)
    - Historical baseline database repositories
    """

    @abstractmethod
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
        pass

    @abstractmethod
    async def get_expected_species(
        self,
        context: ObservationContext,
        min_score: float = 0.08,
        top_k: int = 60,
    ) -> List[ExpectedSpeciesItem]:
        """Retrieve regionally and seasonally expected species for the given context.

        Returns an empty list if coordinates are unavailable or outside supported geographical bounds.
        MUST NOT fabricate species or extrapolate without deterministic model/checklist evidence.
        """
        pass

    @abstractmethod
    async def get_species_metadata(
        self,
        scientific_name: str,
    ) -> Optional[Dict[str, Any]]:
        """Look up canonical taxonomy, common names, and identifiers for a scientific name."""
        pass
