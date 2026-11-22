from datetime import datetime
from typing import Any, Dict, Optional
from pydantic import AliasChoices, BaseModel, ConfigDict, Field


VALID_ECOSYSTEM_CATEGORIES = [
    "forest",
    "wetland",
    "lake",
    "grassland",
    "urban_green_space",
    "coastal",
    "marine",
    "temperate_broadleaf_forest",
    "tropical_rainforest",
    "boreal_taiga",
    "grassland_savanna",
    "shrubland_chaparral",
    "wetland_estuary",
    "agricultural_rural",
    "urban_suburban",
    "other",
]


class SiteBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=255, description="Unique site name")
    latitude: float = Field(..., ge=-90.0, le=90.0, description="Latitude in decimal degrees")
    longitude: float = Field(..., ge=-180.0, le=180.0, description="Longitude in decimal degrees")
    description: Optional[str] = Field(default=None, description="Site description and habitat notes")
    ecosystem_category: str = Field(
        default="forest",
        description="Ecosystem classification",
    )
    timezone: str = Field(default="UTC", description="Local IANA timezone identifier")
    location_sensitivity: str = Field(
        default="exact",
        description="Location privacy level: exact, generalized, or restricted",
    )
    generalized_latitude: Optional[float] = Field(
        default=None, ge=-90.0, le=90.0, description="Fuzzed latitude for public display"
    )
    generalized_longitude: Optional[float] = Field(
        default=None, ge=-180.0, le=180.0, description="Fuzzed longitude for public display"
    )
    ecosystem_profile: Optional[Dict[str, Any]] = Field(
        default=None,
        validation_alias=AliasChoices("ecosystem_profile_json", "ecosystem_profile"),
        serialization_alias="ecosystem_profile",
        description="Ecosystem-specific acoustic and environmental baseline profile",
    )
    metadata: Optional[Dict[str, Any]] = Field(
        default=None,
        validation_alias=AliasChoices("metadata_json", "metadata"),
        serialization_alias="metadata",
        description="Arbitrary custom site metadata",
    )


class SiteCreate(SiteBase):
    pass


class SiteUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    latitude: Optional[float] = Field(default=None, ge=-90.0, le=90.0)
    longitude: Optional[float] = Field(default=None, ge=-180.0, le=180.0)
    description: Optional[str] = None
    ecosystem_category: Optional[str] = None
    timezone: Optional[str] = None
    location_sensitivity: Optional[str] = None
    generalized_latitude: Optional[float] = None
    generalized_longitude: Optional[float] = None
    ecosystem_profile: Optional[Dict[str, Any]] = None
    metadata: Optional[Dict[str, Any]] = None


class SiteResponse(SiteBase):
    model_config = ConfigDict(from_attributes=True)

    id: str
    created_at: datetime
