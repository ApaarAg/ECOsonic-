from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict, Field


class SiteBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=255, description="Unique site name")
    latitude: float = Field(..., ge=-90.0, le=90.0, description="Latitude in decimal degrees")
    longitude: float = Field(..., ge=-180.0, le=180.0, description="Longitude in decimal degrees")
    description: Optional[str] = Field(default=None, description="Site description and habitat notes")


class SiteCreate(SiteBase):
    pass


class SiteUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    latitude: Optional[float] = Field(default=None, ge=-90.0, le=90.0)
    longitude: Optional[float] = Field(default=None, ge=-180.0, le=180.0)
    description: Optional[str] = None


class SiteResponse(SiteBase):
    model_config = ConfigDict(from_attributes=True)

    id: str
    created_at: datetime
