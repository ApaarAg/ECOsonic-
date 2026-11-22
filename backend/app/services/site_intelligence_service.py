"""EcoSonic Monitoring Site Intelligence & Privacy Service.

Manages ecological monitoring locations, ecosystem-specific acoustic baseline profiles,
hardware vs. sound-source coordinate attribution, and location privacy tiers.

Core Principles:
1. Recording station coordinates represent the physical sensor position.
2. Single-microphone deployments do NOT provide sound-source localization; source GPS coordinates are NEVER fabricated.
3. Location sensitivity metadata supports exact, generalized, or restricted public exposure.
4. Ecosystem profiles tailor acoustic thresholds across forests, wetlands, grasslands, marine, and urban green spaces.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.live_session import LiveEvent, LiveSession
from app.models.site import Site
from app.models.soundscape import DisturbanceEvent
from app.schemas.environmental_intelligence import SiteAcousticProfile
from app.schemas.site import VALID_ECOSYSTEM_CATEGORIES

logger = logging.getLogger(__name__)

# Standard ecosystem acoustic baseline profiles
DEFAULT_ECOSYSTEM_PROFILES: Dict[str, Dict[str, Any]] = {
    "temperate_broadleaf_forest": {
        "primary_biophony_range_hz": [2000, 7500],
        "expected_biophony_range": [0.45, 0.85],
        "expected_anthrophony_range": [0.05, 0.25],
        "anthrophony_tolerance_threshold": 0.20,
        "typical_species_families": ["Parulidae", "Turdidae", "Picidae", "Tyrannidae"],
        "expected_dawn_chorus_peak": "05:00-07:30",
        "description": "Temperate deciduous canopy with dense spring songbird vocalizations.",
    },
    "tropical_rainforest": {
        "primary_biophony_range_hz": [1500, 10000],
        "expected_biophony_range": [0.60, 0.95],
        "expected_anthrophony_range": [0.00, 0.15],
        "anthrophony_tolerance_threshold": 0.10,
        "typical_species_families": ["Thraupidae", "Trochilidae", "Furnariidae", "Pipridae"],
        "expected_dawn_chorus_peak": "05:30-08:00",
        "description": "Multi-strata equatorial rainforest with constant biophonic richness across day and night.",
    },
    "boreal_taiga": {
        "primary_biophony_range_hz": [2000, 6500],
        "expected_biophony_range": [0.30, 0.70],
        "expected_anthrophony_range": [0.00, 0.15],
        "anthrophony_tolerance_threshold": 0.15,
        "typical_species_families": ["Fringillidae", "Paridae", "Strigidae", "Sittidae"],
        "expected_dawn_chorus_peak": "04:00-07:00",
        "description": "Coniferous boreal belt with low ambient background noise and seasonal migrant influx.",
    },
    "grassland_savanna": {
        "primary_biophony_range_hz": [1800, 8000],
        "expected_biophony_range": [0.35, 0.75],
        "expected_anthrophony_range": [0.05, 0.30],
        "anthrophony_tolerance_threshold": 0.25,
        "typical_species_families": ["Icteridae", "Passerellidae", "Alaudidae", "Phasianidae"],
        "expected_dawn_chorus_peak": "05:00-07:00",
        "description": "Open prairie and savanna with prominent wind shear and orthopteran insect signatures.",
    },
    "shrubland_chaparral": {
        "primary_biophony_range_hz": [2000, 7000],
        "expected_biophony_range": [0.30, 0.70],
        "expected_anthrophony_range": [0.05, 0.30],
        "anthrophony_tolerance_threshold": 0.25,
        "typical_species_families": ["Mimidae", "Troglodytidae", "Passerellidae"],
        "expected_dawn_chorus_peak": "05:30-07:30",
        "description": "Semi-arid scrub and Mediterranean chaparral with dense low-canopy vocalizers.",
    },
    "wetland_estuary": {
        "primary_biophony_range_hz": [800, 6000],
        "expected_biophony_range": [0.50, 0.90],
        "expected_anthrophony_range": [0.05, 0.25],
        "anthrophony_tolerance_threshold": 0.15,
        "typical_species_families": ["Ardeidae", "Anatidae", "Rallidae", "Scolopacidae"],
        "expected_dawn_chorus_peak": "05:00-08:00",
        "description": "Freshwater marsh, riparian corridor, or estuary with mixed avian and amphibian choruses.",
    },
    "agricultural_rural": {
        "primary_biophony_range_hz": [1500, 6500],
        "expected_biophony_range": [0.25, 0.65],
        "expected_anthrophony_range": [0.15, 0.50],
        "anthrophony_tolerance_threshold": 0.35,
        "typical_species_families": ["Columbidae", "Sturnidae", "Corvidae", "Passeridae"],
        "expected_dawn_chorus_peak": "05:00-07:00",
        "description": "Agro-ecosystem with episodic tractor, irrigation, and livestock acoustic interference.",
    },
    "urban_suburban": {
        "primary_biophony_range_hz": [2000, 7000],
        "expected_biophony_range": [0.20, 0.55],
        "expected_anthrophony_range": [0.30, 0.70],
        "anthrophony_tolerance_threshold": 0.50,
        "typical_species_families": ["Turdidae", "Corvidae", "Columbidae", "Passeridae"],
        "expected_dawn_chorus_peak": "04:30-06:30",
        "description": "Urban green space or suburban habitat with chronic vehicle and mechanical anthrophony.",
    },
    "forest": {
        "primary_biophony_range_hz": [2000, 7500],
        "expected_biophony_range": [0.45, 0.85],
        "expected_anthrophony_range": [0.05, 0.25],
        "anthrophony_tolerance_threshold": 0.20,
        "typical_species_families": ["Parulidae", "Turdidae", "Picidae"],
        "expected_dawn_chorus_peak": "05:00-07:30",
        "description": "Temperate or tropical closed-canopy forest.",
    },
    "wetland": {
        "primary_biophony_range_hz": [800, 6000],
        "expected_biophony_range": [0.50, 0.90],
        "expected_anthrophony_range": [0.05, 0.25],
        "anthrophony_tolerance_threshold": 0.15,
        "typical_species_families": ["Ardeidae", "Anatidae", "Rallidae"],
        "expected_dawn_chorus_peak": "18:00-22:00",
        "description": "Riparian, marsh, or bog wetland.",
    },
    "lake": {
        "primary_biophony_range_hz": [1500, 6000],
        "expected_biophony_range": [0.30, 0.70],
        "expected_anthrophony_range": [0.10, 0.35],
        "anthrophony_tolerance_threshold": 0.25,
        "typical_species_families": ["Anatidae", "Gaviidae", "Laridae"],
        "expected_dawn_chorus_peak": "05:30-08:00",
        "description": "Freshwater lacustrine environment.",
    },
    "grassland": {
        "primary_biophony_range_hz": [1800, 8000],
        "expected_biophony_range": [0.35, 0.75],
        "expected_anthrophony_range": [0.05, 0.30],
        "anthrophony_tolerance_threshold": 0.25,
        "typical_species_families": ["Icteridae", "Passerellidae"],
        "expected_dawn_chorus_peak": "05:00-07:00",
        "description": "Open prairie, savanna, or meadow.",
    },
    "urban_green_space": {
        "primary_biophony_range_hz": [2000, 7000],
        "expected_biophony_range": [0.20, 0.55],
        "expected_anthrophony_range": [0.30, 0.70],
        "anthrophony_tolerance_threshold": 0.45,
        "typical_species_families": ["Turdidae", "Corvidae"],
        "expected_dawn_chorus_peak": "04:30-06:30",
        "description": "Municipal park, botanical garden, or urban forest.",
    },
    "coastal": {
        "primary_biophony_range_hz": [1000, 7000],
        "expected_biophony_range": [0.35, 0.75],
        "expected_anthrophony_range": [0.10, 0.35],
        "anthrophony_tolerance_threshold": 0.30,
        "typical_species_families": ["Laridae", "Charadriidae", "Scolopacidae"],
        "expected_dawn_chorus_peak": "06:00-08:30",
        "description": "Marine intertidal or estuarine boundary.",
    },
    "marine": {
        "primary_biophony_range_hz": [50, 16000],
        "expected_biophony_range": [0.30, 0.70],
        "expected_anthrophony_range": [0.10, 0.40],
        "anthrophony_tolerance_threshold": 0.30,
        "typical_species_families": ["Delphinidae", "Balaenopteridae"],
        "expected_dawn_chorus_peak": "variable",
        "description": "Hydrophone or littoral monitoring.",
    },
    "other": {
        "primary_biophony_range_hz": [2000, 6000],
        "expected_biophony_range": [0.30, 0.70],
        "expected_anthrophony_range": [0.10, 0.35],
        "anthrophony_tolerance_threshold": 0.25,
        "typical_species_families": ["Aves"],
        "expected_dawn_chorus_peak": "05:00-08:00",
        "description": "Unclassified ecological monitoring environment.",
    },
}


class SiteIntelligenceService:
    """Production service for managing site metadata, privacy protection, and acoustic summaries."""

    @staticmethod
    def validate_ecosystem_category(category: str) -> str:
        """Ensure ecosystem category belongs to supported taxonomy."""
        cleaned = category.strip().lower()
        if cleaned not in VALID_ECOSYSTEM_CATEGORIES:
            logger.warning("Unrecognized ecosystem category '%s'; defaulting to 'other'.", category)
            return "other"
        return cleaned

    @staticmethod
    def get_default_profile(category: str) -> Dict[str, Any]:
        """Retrieve default baseline acoustic parameters for an ecosystem type."""
        cat_clean = SiteIntelligenceService.validate_ecosystem_category(category)
        return dict(DEFAULT_ECOSYSTEM_PROFILES.get(cat_clean, DEFAULT_ECOSYSTEM_PROFILES["other"]))

    @staticmethod
    def get_ecosystem_baseline_profile(category: str) -> Dict[str, Any]:
        """Retrieve complete baseline acoustic and ecological parameters for an ecosystem category."""
        return SiteIntelligenceService.get_default_profile(category)

    @staticmethod
    def calculate_generalized_coordinates(latitude: float, longitude: float, precision_degrees: float = 0.1) -> Tuple[float, float]:
        """Fuzz exact coordinates to generalized public coordinates (~11 km at 0.1 deg)."""
        gen_lat = round(latitude / precision_degrees) * precision_degrees
        gen_lon = round(longitude / precision_degrees) * precision_degrees
        return round(gen_lat, 3), round(gen_lon, 3)

    @staticmethod
    def serialize_site_for_privacy(site: Site, requester_is_privileged: bool = False) -> Dict[str, Any]:
        """Serialize site entity respecting location sensitivity policies.

        Policies:
        - 'exact': Returns exact physical coordinates.
        - 'generalized': Returns fuzzed / rounded coordinates (~11 km resolution).
        - 'restricted': Completely suppresses coordinates (None) from public serialization.
        """
        public_coords = site.get_public_coordinates() if not requester_is_privileged else {
            "latitude": site.latitude,
            "longitude": site.longitude,
            "sensitivity": site.location_sensitivity,
        }

        return {
            "id": site.id,
            "name": site.name,
            "latitude": public_coords["latitude"],
            "longitude": public_coords["longitude"],
            "location_sensitivity": site.location_sensitivity,
            "description": site.description,
            "ecosystem_category": site.ecosystem_category,
            "timezone": site.timezone,
            "ecosystem_profile": site.ecosystem_profile_json or SiteIntelligenceService.get_default_profile(site.ecosystem_category),
            "metadata": site.metadata_json or {},
            "created_at": site.created_at.isoformat() if site.created_at else None,
            "station_coordinate_disclaimer": (
                "Displayed coordinates denote the fixed physical recording station. "
                "Single-sensor bioacoustic platforms do not provide sound source localization."
            ),
        }

    async def get_site_acoustic_profile(self, site_id: str, db: AsyncSession) -> Optional[SiteAcousticProfile]:
        """Aggregate all historical monitoring sessions for a site into an acoustic summary profile."""
        site = await db.get(Site, site_id)
        if not site:
            return None

        # 1. Query sessions count and total audio seconds
        sess_query = select(
            func.count(LiveSession.id),
            func.coalesce(func.sum(LiveSession.total_audio_seconds), 0.0),
        ).where(LiveSession.site_id == site_id)
        sess_res = await db.execute(sess_query)
        total_sessions, total_seconds = sess_res.one()

        # 2. Query unique species richness and top taxa
        species_query = (
            select(LiveEvent.common_name, func.count(LiveEvent.id).label("cnt"))
            .join(LiveSession, LiveEvent.session_id == LiveSession.id)
            .where(LiveSession.site_id == site_id, LiveEvent.common_name.is_not(None))
            .group_by(LiveEvent.common_name)
            .order_by(func.count(LiveEvent.id).desc())
        )
        species_res = await db.execute(species_query)
        species_rows = species_res.all()
        species_richness = len(species_rows)
        top_taxa = [row[0] for row in species_rows[:5] if row[0]]

        # 3. Query recent disturbances count
        dist_query = (
            select(func.count(DisturbanceEvent.id))
            .join(LiveSession, DisturbanceEvent.session_id == LiveSession.id)
            .where(LiveSession.site_id == site_id)
        )
        dist_res = await db.execute(dist_query)
        recent_disturbances = dist_res.scalar_one()

        # 4. Query latest session timestamp
        latest_sess_query = (
            select(func.max(LiveSession.created_at)).where(LiveSession.site_id == site_id)
        )
        latest_res = await db.execute(latest_sess_query)
        last_obs = latest_res.scalar_one()

        coords = site.get_public_coordinates()

        return SiteAcousticProfile(
            site_id=site.id,
            name=site.name,
            ecosystem_category=site.ecosystem_category,
            recording_station_coords=coords,
            total_sessions=int(total_sessions),
            total_audio_hours=round(float(total_seconds) / 3600.0, 2),
            species_richness_observed=species_richness,
            common_taxa=top_taxa,
            recent_disturbances_count=int(recent_disturbances),
            last_observation_timestamp=last_obs.isoformat() if last_obs else None,
        )


# Global singleton instance
site_intelligence_service = SiteIntelligenceService()
