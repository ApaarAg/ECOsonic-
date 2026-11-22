"""Database models for Phase 5 Geo-Temporal Environmental Intelligence.

Covers:
1. GeographicContext: Region & seasonal occurrence scores from BirdNET Geo V3.0.
2. HabitatComparison: Multi-horizon statistical habitat drift comparisons.
3. EnvironmentalReview: Expert human verification records for AI outputs.
4. EnvironmentalIncident: Structured environmental investigation records.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class GeographicContext(Base):
    """Geographic occurrence metadata attaching BirdNET Geo predictions to detections or queries."""

    __tablename__ = "geographic_contexts"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    detection_id: Mapped[Optional[str]] = mapped_column(
        String(36), nullable=True, index=True
    )
    live_event_id: Mapped[Optional[str]] = mapped_column(
        String(36), nullable=True, index=True
    )
    site_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("sites.id", ondelete="SET NULL"), nullable=True, index=True
    )
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    week: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    birdnet_taxonomy_id: Mapped[Optional[str]] = mapped_column(
        String(50), nullable=True, index=True
    )
    species_code: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    scientific_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    common_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    geo_score: Mapped[float] = mapped_column(Float, nullable=False, index=True)
    is_unusual_occurrence: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, index=True
    )
    occurrence_status: Mapped[str] = mapped_column(
        String(50), default="expected", nullable=False
    )  # expected, rare, unexpected, vagrant, out_of_season
    geographic_model_version: Mapped[str] = mapped_column(
        String(50), default="BirdNET Geo V3.0", nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    __table_args__ = (
        Index("ix_geo_context_lat_lon_week", "latitude", "longitude", "week"),
        Index("ix_geo_context_species_week", "scientific_name", "week"),
    )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "detection_id": self.detection_id,
            "live_event_id": self.live_event_id,
            "site_id": self.site_id,
            "latitude": self.latitude,
            "longitude": self.longitude,
            "week": self.week,
            "birdnet_taxonomy_id": self.birdnet_taxonomy_id,
            "species_code": self.species_code,
            "scientific_name": self.scientific_name,
            "common_name": self.common_name,
            "geo_score": self.geo_score,
            "is_unusual_occurrence": self.is_unusual_occurrence,
            "occurrence_status": self.occurrence_status,
            "geographic_model_version": self.geographic_model_version,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class HabitatComparison(Base):
    """Persisted statistical comparison between repeated recording sessions from a monitoring site."""

    __tablename__ = "habitat_comparisons"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    site_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("sites.id", ondelete="CASCADE"), nullable=False, index=True
    )
    comparison_type: Mapped[str] = mapped_column(
        String(50), nullable=False, default="session_vs_session", index=True
    )  # session_vs_session, daily, weekly, monthly, historical_baseline
    baseline_session_id: Mapped[Optional[str]] = mapped_column(
        String(36), nullable=True, index=True
    )
    target_session_id: Mapped[Optional[str]] = mapped_column(
        String(36), nullable=True, index=True
    )
    baseline_period: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    comparison_period: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    metrics_json: Mapped[Dict[str, Any]] = mapped_column(JSON, nullable=False)
    drift_category: Mapped[str] = mapped_column(
        String(100), nullable=False, default="stable_observed_soundscape", index=True
    )
    status: Mapped[str] = mapped_column(
        String(50), nullable=False, default="completed", index=True
    )  # completed, insufficient_baseline, failed
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    __table_args__ = (
        Index("ix_habitat_comp_site_type", "site_id", "comparison_type"),
        Index("ix_habitat_comp_site_date", "site_id", "created_at"),
    )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "site_id": self.site_id,
            "comparison_type": self.comparison_type,
            "baseline_session_id": self.baseline_session_id,
            "target_session_id": self.target_session_id,
            "baseline_period": self.baseline_period,
            "comparison_period": self.comparison_period,
            "metrics": self.metrics_json,
            "drift_category": self.drift_category,
            "status": self.status,
            "notes": self.notes,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class EnvironmentalReview(Base):
    """Human-in-the-loop expert review records storing validation decisions without overwriting raw AI predictions."""

    __tablename__ = "environmental_reviews"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    review_category: Mapped[str] = mapped_column(
        String(100), nullable=False, index=True
    )  # unexpected_geographic_occurrence, low_confidence_acoustic_prediction, unusual_acoustic_anomaly, repeated_disturbance_event, soundscape_change
    target_type: Mapped[str] = mapped_column(
        String(50), nullable=False, index=True
    )  # live_event, detection, anomaly_candidate, disturbance_event, unified_event
    target_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    site_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("sites.id", ondelete="SET NULL"), nullable=True, index=True
    )
    session_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    original_prediction_json: Mapped[Dict[str, Any]] = mapped_column(JSON, nullable=False)
    original_score: Mapped[float] = mapped_column(Float, nullable=False)
    geo_context_json: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True)
    audio_evidence_path: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)
    review_decision: Mapped[str] = mapped_column(
        String(50), nullable=False, default="needs_more_evidence", index=True
    )  # confirmed, rejected, uncertain, needs_more_evidence
    reviewer_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    history_json: Mapped[List[Dict[str, Any]]] = mapped_column(
        JSON, default=list, nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    __table_args__ = (
        Index("ix_env_reviews_target", "target_type", "target_id"),
        Index("ix_env_reviews_decision", "review_decision"),
        Index("ix_env_reviews_category", "review_category"),
    )

    @property
    def original_prediction(self) -> Dict[str, Any]:
        return self.original_prediction_json or {}

    @property
    def geo_context(self) -> Optional[Dict[str, Any]]:
        return self.geo_context_json

    @property
    def history(self) -> List[Dict[str, Any]]:
        return self.history_json or []

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "review_category": self.review_category,
            "target_type": self.target_type,
            "target_id": self.target_id,
            "site_id": self.site_id,
            "session_id": self.session_id,
            "original_prediction": self.original_prediction_json,
            "original_score": self.original_score,
            "geo_context": self.geo_context_json,
            "audio_evidence_path": self.audio_evidence_path,
            "review_decision": self.review_decision,
            "reviewer_note": self.reviewer_note,
            "history": self.history_json,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class EnvironmentalIncident(Base):
    """Structured conservation and habitat investigation records for significant disturbance or acoustic anomalies."""

    __tablename__ = "environmental_incidents"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    incident_code: Mapped[str] = mapped_column(
        String(50), unique=True, nullable=False, index=True
    )  # e.g. "INC-20261122-0001"
    site_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("sites.id", ondelete="SET NULL"), nullable=True, index=True
    )
    session_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    primary_event_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    category: Mapped[str] = mapped_column(
        String(100), nullable=False, default="anthropogenic_disturbance", index=True
    )  # anthropogenic_disturbance, logging_signature, gunfire_signature, wildfire_signature, critical_anomaly
    priority: Mapped[str] = mapped_column(
        String(50), nullable=False, default="medium", index=True
    )  # informational, low, medium, high, critical
    status: Mapped[str] = mapped_column(
        String(50), nullable=False, default="detected", index=True
    )  # detected, under_review, confirmed, dismissed, resolved
    event_ids_json: Mapped[List[str]] = mapped_column(JSON, default=list, nullable=False)
    evidence_json: Mapped[Dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    investigation_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    resolution_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    resolved_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        Index("ix_incidents_site_status", "site_id", "status"),
        Index("ix_incidents_priority", "priority"),
    )

    @property
    def event_ids(self) -> List[str]:
        return self.event_ids_json or []

    @property
    def evidence(self) -> Dict[str, Any]:
        return self.evidence_json or {}

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "incident_code": self.incident_code,
            "site_id": self.site_id,
            "session_id": self.session_id,
            "primary_event_id": self.primary_event_id,
            "title": self.title,
            "category": self.category,
            "priority": self.priority,
            "status": self.status,
            "event_ids": self.event_ids_json,
            "evidence": self.evidence_json,
            "investigation_notes": self.investigation_notes,
            "resolution_notes": self.resolution_notes,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "resolved_at": self.resolved_at.isoformat() if self.resolved_at else None,
        }
