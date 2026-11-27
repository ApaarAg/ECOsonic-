"""Ecological Knowledge Provider package."""

from __future__ import annotations

import logging
import os
from typing import Optional

from app.services.ecological_knowledge.birdnet_geo_provider import BirdNetGeoKnowledgeProvider
from app.services.ecological_knowledge.mock_provider import MockEcologicalKnowledgeProvider
from app.services.ecological_knowledge.provider_base import EcologicalKnowledgeProvider

logger = logging.getLogger(__name__)
_default_provider: Optional[EcologicalKnowledgeProvider] = None


def get_ecological_knowledge_provider() -> EcologicalKnowledgeProvider:
    """Retrieve the active EcologicalKnowledgeProvider singleton."""
    global _default_provider
    if _default_provider is None:
        from app.config import settings

        env = (settings.ENVIRONMENT or "").strip().lower()
        use_mock = os.environ.get("USE_MOCK_ECOLOGY_PROVIDER", "false").lower() == "true"
        if use_mock and env != "production":
            _default_provider = MockEcologicalKnowledgeProvider()
        else:
            if use_mock and env == "production":
                logger.warning(
                    "Ignoring USE_MOCK_ECOLOGY_PROVIDER=true in production environment; using BirdNetGeoKnowledgeProvider."
                )
            _default_provider = BirdNetGeoKnowledgeProvider()
    return _default_provider


def set_ecological_knowledge_provider(provider: EcologicalKnowledgeProvider) -> None:
    """Explicitly set the provider (used for testing and custom backends)."""
    global _default_provider
    _default_provider = provider


__all__ = [
    "EcologicalKnowledgeProvider",
    "BirdNetGeoKnowledgeProvider",
    "MockEcologicalKnowledgeProvider",
    "get_ecological_knowledge_provider",
    "set_ecological_knowledge_provider",
]
