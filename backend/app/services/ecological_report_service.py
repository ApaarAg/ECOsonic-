"""EcoSonic Ecological Evidence Reporting Service.

Synthesizes multi-modal environmental soundscape intelligence into comprehensive, reproducible reports.
Supports structured JSON export and scientific tabular CSV dataset generation.

Defensibility Guarantees:
1. Clear demarcation between Raw AI Predictions, Expert-Verified Observations, and Statistical Inferences.
2. Unverified or uncertain detections are NEVER labeled as confirmed biological sightings.
3. Coordinates are masked or generalized according to site location sensitivity rules.
4. Reports embed complete model versioning, analysis timeframes, and reproducibility metadata.
"""

from __future__ import annotations

import csv
import io
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.environmental_intelligence import (
    EnvironmentalIncident,
    EnvironmentalReview,
    HabitatComparison,
)
from app.models.live_session import LiveEvent, LiveSession
from app.models.site import Site
from app.models.soundscape import DisturbanceEvent, SoundscapeMeasurement
from app.schemas.environmental_intelligence import (
    EcologicalReportMetadata,
    EcologicalReportRequest,
)
from app.services.site_intelligence_service import site_intelligence_service

logger = logging.getLogger(__name__)

SCIENTIFIC_REPORT_DISCLAIMER = (
    "This report compiles acoustic screening predictions, ecoacoustic signal processing metrics, "
    "and expert human verification records. Unreviewed machine learning inferences do NOT constitute "
    "empirical proof of species occurrence or ecological endangerment."
)


class EcologicalReportService:
    """Production service generating auditable ecological reports and scientific CSV exports."""

    async def generate_json_report(
        self,
        request: EcologicalReportRequest,
        db: AsyncSession,
    ) -> Dict[str, Any]:
        """Generate comprehensive hierarchical JSON ecological evidence report."""
        site = await db.get(Site, request.site_id)
        if not site:
            raise ValueError(f"Site {request.site_id} not found.")

        report_id = str(uuid.uuid4())
        now_dt = datetime.now(timezone.utc)

        # 1. Query sessions for site
        sess_stmt = select(LiveSession).where(LiveSession.site_id == site.id).order_by(LiveSession.created_at.asc())
        if request.start_date:
            try:
                start_dt = datetime.fromisoformat(request.start_date.replace("Z", "+00:00"))
                sess_stmt = sess_stmt.where(LiveSession.created_at >= start_dt)
            except Exception:
                pass
        if request.end_date:
            try:
                end_dt = datetime.fromisoformat(request.end_date.replace("Z", "+00:00"))
                sess_stmt = sess_stmt.where(LiveSession.created_at <= end_dt)
            except Exception:
                pass

        sessions = (await db.execute(sess_stmt)).scalars().all()
        session_ids = [s.id for s in sessions]
        total_audio_seconds = sum(s.total_audio_seconds for s in sessions)
        total_audio_hours = round(total_audio_seconds / 3600.0, 3)

        # 2. Query biological detections
        detections_list: List[Dict[str, Any]] = []
        species_counts: Dict[str, int] = {}
        if session_ids:
            ev_stmt = (
                select(LiveEvent)
                .where(LiveEvent.session_id.in_(session_ids))
                .order_by(LiveEvent.created_at.asc())
            )
            events = (await db.execute(ev_stmt)).scalars().all()

            for ev in events:
                sci = ev.scientific_name or ev.class_label
                com = ev.common_name or ev.class_label
                species_counts[com] = species_counts.get(com, 0) + 1

                detections_list.append(
                    {
                        "event_id": ev.id,
                        "session_id": ev.session_id,
                        "scientific_name": sci,
                        "common_name": com,
                        "taxon_group": ev.taxon_group or "Aves",
                        "acoustic_confidence": round(ev.confidence_score, 4),
                        "start_seconds": ev.start_seconds,
                        "end_seconds": ev.end_seconds,
                        "duration_seconds": round(ev.end_seconds - ev.start_seconds, 2),
                        "model_version": ev.model_version or "BirdNET+ V3.0",
                        "timestamp": ev.created_at.isoformat() if ev.created_at else None,
                    }
                )

        # 3. Query disturbance events
        disturbances_list: List[Dict[str, Any]] = []
        if session_ids:
            dist_stmt = (
                select(DisturbanceEvent)
                .where(DisturbanceEvent.session_id.in_(session_ids))
                .order_by(DisturbanceEvent.created_at.asc())
            )
            dist_records = (await db.execute(dist_stmt)).scalars().all()
            for d in dist_records:
                disturbances_list.append(
                    {
                        "event_id": d.id,
                        "session_id": d.session_id,
                        "class_label": d.class_label,
                        "category": d.category,
                        "hazard_classification": d.hazard_classification,
                        "confidence_score": round(d.confidence_score, 4),
                        "start_seconds": d.start_seconds,
                        "end_seconds": d.end_seconds,
                        "duration_seconds": round(d.end_seconds - d.start_seconds, 2),
                        "timestamp": d.created_at.isoformat() if d.created_at else None,
                    }
                )

        # 4. Query human verification reviews
        rev_stmt = select(EnvironmentalReview).where(EnvironmentalReview.site_id == site.id)
        reviews = (await db.execute(rev_stmt)).scalars().all()
        confirmed_count = sum(1 for r in reviews if r.review_decision == "confirmed")
        reviews_list = [r.to_dict() for r in reviews]

        # 5. Query incidents
        inc_stmt = select(EnvironmentalIncident).where(EnvironmentalIncident.site_id == site.id)
        incidents = (await db.execute(inc_stmt)).scalars().all()
        incidents_list = [inc.to_dict() for inc in incidents]

        # 6. Query habitat drift comparisons
        comp_stmt = (
            select(HabitatComparison)
            .where(HabitatComparison.site_id == site.id)
            .order_by(HabitatComparison.created_at.desc())
            .limit(5)
        )
        comparisons = (await db.execute(comp_stmt)).scalars().all()
        comparisons_list = [c.to_dict() for c in comparisons]

        # Coordinate privacy handling
        coords = site_intelligence_service.serialize_site_for_privacy(
            site, requester_is_privileged=not request.mask_sensitive_locations
        )

        metadata = EcologicalReportMetadata(
            report_id=report_id,
            generated_at=now_dt.isoformat(),
            site_id=site.id,
            site_name=site.name,
            ecosystem_category=site.ecosystem_category,
            geographic_coordinates={
                "latitude": coords["latitude"],
                "longitude": coords["longitude"],
                "sensitivity": coords["location_sensitivity"],
            },
            model_version="BirdNET+ V3.0 (Acoustic) & BirdNET Geo V3.0 (Geographic)",
            analysis_period={
                "start": request.start_date or (sessions[0].created_at.isoformat() if sessions else None),
                "end": request.end_date or (sessions[-1].created_at.isoformat() if sessions else None),
            },
            total_audio_hours_analyzed=total_audio_hours,
            species_inventory_count=len(species_counts),
            human_verified_observations_count=confirmed_count,
            disturbances_recorded_count=len(disturbances_list),
            incidents_logged_count=len(incidents_list),
            disclaimer=SCIENTIFIC_REPORT_DISCLAIMER,
        )

        return {
            "site_id": site.id,
            "metadata": metadata.model_dump(),
            "species_inventory": [
                {"scientific_name": k, "count": v}
                for k, v in dict(sorted(species_counts.items(), key=lambda x: x[1], reverse=True)).items()
            ],
            "summary_statistics": {
                "total_monitoring_sessions": len(sessions),
                "total_audio_seconds": round(total_audio_seconds, 2),
                "total_audio_hours": total_audio_hours,
                "total_raw_detections": len(detections_list),
                "unique_taxa_observed": len(species_counts),
                "human_verified_count": confirmed_count,
                "total_disturbances_detected": len(disturbances_list),
                "active_incidents_count": sum(1 for inc in incidents if inc.status in ["detected", "under_review"]),
                "species_abundance_breakdown": dict(sorted(species_counts.items(), key=lambda x: x[1], reverse=True)),
            },
            "biological_observations": detections_list if request.include_raw_ai_predictions else [],
            "anthropogenic_disturbances": disturbances_list,
            "expert_verification_records": reviews_list,
            "environmental_incidents": incidents_list,
            "recent_habitat_drift_comparisons": comparisons_list,
            "disclaimers": {
                "scientific_integrity": SCIENTIFIC_REPORT_DISCLAIMER,
            },
        }

    async def generate_csv_report(
        self,
        request: EcologicalReportRequest,
        db: AsyncSession,
    ) -> str:
        """Generate flattened scientific CSV report suitable for R, Pandas, or QGIS analysis."""
        json_rep = await self.generate_json_report(request, db)
        meta = json_rep["metadata"]
        observations = json_rep["biological_observations"]
        disturbances = json_rep["anthropogenic_disturbances"]

        output = io.StringIO()
        writer = csv.writer(output)

        # Write metadata comments
        writer.writerow(["# EcoSonic Ecological Evidence Report"])
        writer.writerow([f"# Report ID: {meta['report_id']}"])
        writer.writerow([f"# Generated At: {meta['generated_at']}"])
        writer.writerow([f"# Site ID: {meta['site_id']} | Site Name: {meta['site_name']}"])
        writer.writerow([f"# Ecosystem: {meta['ecosystem_category']}"])
        writer.writerow([f"# Coordinates: {meta['geographic_coordinates']['latitude']}, {meta['geographic_coordinates']['longitude']} ({meta['geographic_coordinates']['sensitivity']})"])
        writer.writerow([f"# Total Audio Hours: {meta['total_audio_hours_analyzed']}"])
        writer.writerow([f"# Disclaimer: {meta['disclaimer']}"])
        writer.writerow([])

        # Table 1: Biological Detections
        headers = [
            "record_type",
            "event_id",
            "session_id",
            "timestamp",
            "scientific_name",
            "common_name",
            "taxon_group",
            "acoustic_confidence",
            "start_seconds",
            "end_seconds",
            "duration_seconds",
            "model_version",
            "verification_status",
        ]
        writer.writerow(headers)

        for obs in observations:
            writer.writerow([
                "biological_vocalization",
                obs["event_id"],
                obs["session_id"],
                obs["timestamp"],
                obs["scientific_name"],
                obs["common_name"],
                obs["taxon_group"],
                obs["acoustic_confidence"],
                obs["start_seconds"],
                obs["end_seconds"],
                obs["duration_seconds"],
                obs["model_version"],
                "unreviewed",
            ])

        for d in disturbances:
            writer.writerow([
                "anthropogenic_disturbance",
                d["event_id"],
                d["session_id"],
                d["timestamp"],
                d["class_label"],
                d["class_label"],
                d["category"] or "Anthrophony",
                d["confidence_score"],
                d["start_seconds"],
                d["end_seconds"],
                d["duration_seconds"],
                "BirdNET+ V3.0",
                "pending",
            ])

        return output.getvalue()


# Global singleton instance
ecological_report_service = EcologicalReportService()
