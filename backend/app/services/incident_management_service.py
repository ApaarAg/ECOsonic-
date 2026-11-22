"""EcoSonic Environmental Incident Management Service.

Transforms qualifying disturbance detections, recurring acoustic anomalies, and critical soundscape events
into structured investigation records.

Scientific & Operational Guardrails:
1. Incident creation is an automated screening and triaging mechanism.
2. Model confidence is NOT equated with real-world threat severity.
3. Acoustic detections (e.g. 'Chainsaw' or 'Gun') do NOT constitute evidence of criminal activity or illegal logging.
   Permitted land-clearing, construction, forest management, or hunting may produce identical acoustic signatures.
4. Investigation workflows support structured note-taking, evidence linking, status transitions, and resolution tracking.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.environmental_intelligence import EnvironmentalIncident
from app.models.soundscape import DisturbanceEvent
from app.schemas.environmental_intelligence import (
    EnvironmentalIncidentCreate,
    EnvironmentalIncidentResponse,
    EnvironmentalIncidentUpdate,
    IncidentPriority,
    IncidentStatus,
)

logger = logging.getLogger(__name__)

SCIENTIFIC_INCIDENT_DISCLAIMER = (
    "Environmental incidents represent automated screening aggregations. "
    "Acoustic classifications do not constitute proof of criminal activity, illegal logging, or law enforcement violations."
)


def compute_incident_priority(
    category: str,
    class_label: Optional[str] = None,
    repetition_count: int = 1,
    peak_confidence: float = 0.5,
) -> IncidentPriority:
    """Documented rules-based priority determination.

    Rules:
    - Critical environmental hazards (Gun, Explosion, Fire, Chainsaw):
        - Gun, Explosion, Fire -> 'critical' if conf >= 0.50 else 'high'
        - Chainsaw -> 'critical' if (repetition >= 3 and conf >= 0.60) else 'high'
    - Mechanical activity (Power tool, Sawing, Hammer) -> 'medium'
    - Transportation / Cultural (Aircraft, Boat, Engine, Train, Vehicle horn, Music) -> 'low' or 'informational'
    - Critical Acoustic Anomaly -> 'high' if peak_confidence >= 0.70 else 'medium'
    """
    lbl_lower = (class_label or "").strip().lower()

    if lbl_lower in ["gun", "explosion", "fire"]:
        return "critical" if peak_confidence >= 0.50 else "high"
    elif lbl_lower == "chainsaw":
        if repetition_count >= 3 or peak_confidence >= 0.75:
            return "critical"
        return "high"
    elif lbl_lower in ["power tool", "sawing", "hammer", "siren"]:
        return "medium"
    elif lbl_lower in ["aircraft", "boat", "engine", "motor vehicle", "train", "vehicle horn"]:
        return "low"
    elif lbl_lower in ["music", "fireworks"]:
        return "informational"

    if category == "critical_anomaly":
        return "high" if peak_confidence >= 0.70 else "medium"

    return "medium"


class EnvironmentalIncidentService:
    """Production service for managing structured environmental incident investigations."""

    async def _generate_incident_code(self, db: AsyncSession) -> str:
        """Generate human-readable incident code, e.g. INC-20261122-0001."""
        now_str = datetime.now(timezone.utc).strftime("%Y%m%d")
        prefix = f"INC-{now_str}-"

        # Count incidents created today
        query = select(func.count(EnvironmentalIncident.id)).where(
            EnvironmentalIncident.incident_code.like(f"{prefix}%")
        )
        count = (await db.execute(query)).scalar_one()
        return f"{prefix}{count + 1:04d}"

    async def create_incident(
        self,
        incident_in: EnvironmentalIncidentCreate,
        db: AsyncSession,
    ) -> EnvironmentalIncidentResponse:
        """Create a new structured environmental investigation record."""
        inc_id = str(uuid.uuid4())
        inc_code = await self._generate_incident_code(db)
        now_dt = datetime.now(timezone.utc)

        record = EnvironmentalIncident(
            id=inc_id,
            incident_code=inc_code,
            site_id=incident_in.site_id,
            session_id=incident_in.session_id,
            primary_event_id=incident_in.primary_event_id,
            title=incident_in.title,
            category=incident_in.category,
            priority=incident_in.priority,
            status=incident_in.status,
            event_ids_json=incident_in.event_ids,
            evidence_json=incident_in.evidence,
            investigation_notes=incident_in.investigation_notes,
            resolution_notes=None,
            created_at=now_dt,
            updated_at=now_dt,
            resolved_at=None,
        )

        db.add(record)
        await db.flush()
        return EnvironmentalIncidentResponse.model_validate(record)

    async def create_incident_from_disturbance(
        self,
        disturbance: DisturbanceEvent,
        db: AsyncSession,
        site_id: Optional[str] = None,
    ) -> EnvironmentalIncidentResponse:
        """Automatically create an incident record from a qualified DisturbanceEvent."""
        priority = compute_incident_priority(
            category=disturbance.category or "anthropogenic_disturbance",
            class_label=disturbance.class_label,
            repetition_count=1,
            peak_confidence=disturbance.confidence_score,
        )

        title = f"Detected {disturbance.class_label} Activity ({disturbance.start_seconds:.1f}s - {disturbance.end_seconds:.1f}s)"
        evidence = {
            "source_disturbance_id": disturbance.id,
            "class_label": disturbance.class_label,
            "category": disturbance.category,
            "confidence_score": disturbance.confidence_score,
            "start_seconds": disturbance.start_seconds,
            "end_seconds": disturbance.end_seconds,
            "model_version": disturbance.model_version,
        }

        inc_in = EnvironmentalIncidentCreate(
            site_id=site_id,
            session_id=disturbance.session_id,
            primary_event_id=disturbance.id,
            title=title,
            category=disturbance.category or "anthropogenic_disturbance",
            priority=priority,
            status="detected",
            event_ids=[disturbance.id],
            evidence=evidence,
            investigation_notes="Automated incident ticket created from BirdNET Disturbance Radar screening detection.",
        )

        return await self.create_incident(inc_in, db)

    async def update_incident(
        self,
        incident_id: str,
        update_in: EnvironmentalIncidentUpdate,
        db: AsyncSession,
    ) -> Optional[EnvironmentalIncidentResponse]:
        """Update incident priority, status, investigation notes, or resolution records."""
        record = await db.get(EnvironmentalIncident, incident_id)
        if not record:
            return None

        now_dt = datetime.now(timezone.utc)

        if update_in.title is not None:
            record.title = update_in.title
        if update_in.priority is not None:
            record.priority = update_in.priority
        if update_in.status is not None:
            record.status = update_in.status
            if update_in.status == "resolved" and not record.resolved_at:
                record.resolved_at = now_dt
            elif update_in.status != "resolved":
                record.resolved_at = None
        if update_in.event_ids is not None:
            record.event_ids_json = update_in.event_ids
        if update_in.evidence is not None:
            merged_ev = dict(record.evidence_json or {})
            merged_ev.update(update_in.evidence)
            record.evidence_json = merged_ev
        if update_in.investigation_notes is not None:
            record.investigation_notes = update_in.investigation_notes
        if update_in.resolution_notes is not None:
            record.resolution_notes = update_in.resolution_notes

        record.updated_at = now_dt
        await db.flush()
        return EnvironmentalIncidentResponse.model_validate(record)

    async def get_incident(self, incident_id: str, db: AsyncSession) -> Optional[EnvironmentalIncidentResponse]:
        """Retrieve a specific incident by UUID or incident code."""
        record = await db.get(EnvironmentalIncident, incident_id)
        if not record:
            # Try searching by incident code
            stmt = select(EnvironmentalIncident).where(EnvironmentalIncident.incident_code == incident_id)
            record = (await db.execute(stmt)).scalar_one_or_none()

        if not record:
            return None
        return EnvironmentalIncidentResponse.model_validate(record)

    async def list_incidents(
        self,
        db: AsyncSession,
        site_id: Optional[str] = None,
        session_id: Optional[str] = None,
        status: Optional[str] = None,
        priority: Optional[str] = None,
        limit: int = 50,
    ) -> List[EnvironmentalIncidentResponse]:
        """List incident records filtered by site, session, status, or priority level."""
        stmt = select(EnvironmentalIncident).order_by(desc(EnvironmentalIncident.created_at))
        if site_id:
            stmt = stmt.where(EnvironmentalIncident.site_id == site_id)
        if session_id:
            stmt = stmt.where(EnvironmentalIncident.session_id == session_id)
        if status:
            stmt = stmt.where(EnvironmentalIncident.status == status)
        if priority:
            stmt = stmt.where(EnvironmentalIncident.priority == priority)
        stmt = stmt.limit(limit)

        records = (await db.execute(stmt)).scalars().all()
        return [EnvironmentalIncidentResponse.model_validate(r) for r in records]


# Global singleton instance
incident_management_service = EnvironmentalIncidentService()
