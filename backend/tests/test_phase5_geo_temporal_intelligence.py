"""Phase 5 Comprehensive Test Suite: Geo-Temporal Environmental Intelligence & Habitat Monitoring.

Tests all Phase 5 modules:
- Module A: Geographic Occurrence Intelligence (BirdNET Geo V3.0)
- Module B: Monitoring Site Intelligence & Privacy Protections
- Module C: Habitat Drift Engine & Statistical Comparisons
- Module D: Expert Verification Workflows & Non-Destructive Review Audit Trails
- Module E: Environmental Incident Management & Triaging Rules
- Module F: Ecological Evidence Reporting (JSON & CSV)
- Full API Integration Endpoints
"""

from __future__ import annotations

import csv
import io
import uuid
from datetime import datetime, timezone

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.environmental_intelligence import (
    EnvironmentalIncident,
    EnvironmentalReview,
    GeographicContext,
    HabitatComparison,
)
from app.models.live_session import LiveEvent, LiveSession
from app.models.site import Site
from app.models.soundscape import DisturbanceEvent, SoundscapeMeasurement
from app.schemas.environmental_intelligence import (
    EnvironmentalIncidentCreate,
    EnvironmentalIncidentUpdate,
    EnvironmentalReviewCreate,
    EnvironmentalReviewUpdate,
    EventReviewRequest,
    GeoContextualizeRequest,
    HabitatComparisonRequest,
)
from app.schemas.site import SiteCreate
from app.services.ecological_report_service import ecological_report_service
from app.services.environmental_review_service import (
    ALLOWED_REVIEW_DECISIONS,
    environmental_review_service,
)
from app.services.geo_temporal_service import (
    date_to_birdnet_week,
    geo_temporal_service,
)
from app.services.habitat_drift_service import (
    compute_robust_z_score,
    habitat_drift_service,
)
from app.services.incident_management_service import (
    compute_incident_priority,
    incident_management_service,
)
from app.services.site_intelligence_service import site_intelligence_service


# ============================================================================
# MODULE A: Geographic Occurrence Intelligence
# ============================================================================
class TestModuleAGeoTemporalIntelligence:
    def test_week_conversion(self):
        """Test calendar date to BirdNET 48-week meteorological system."""
        assert date_to_birdnet_week("2026-01-01") == 1
        assert date_to_birdnet_week("2026-01-15") == 2
        assert date_to_birdnet_week("2026-06-15") == 22
        assert date_to_birdnet_week("2026-12-31") == 48

    def test_coordinate_validation(self):
        """Test that invalid coordinates raise ValueError."""
        with pytest.raises(ValueError, match="Latitude must be between -90 and 90"):
            geo_temporal_service.predict_species_probabilities(95.0, 10.0, 1)

        with pytest.raises(ValueError, match="Longitude must be between -180 and 180"):
            geo_temporal_service.predict_species_probabilities(10.0, 185.0, 1)

        with pytest.raises(ValueError, match="Week must be -1"):
            geo_temporal_service.predict_species_probabilities(10.0, 10.0, 50)

    def test_geo_prediction_caching(self):
        """Verify that repeated queries hit the LRU in-memory cache."""
        lat, lon, week = 42.44, -76.50, 20  # Ithaca, NY
        cache_info_before = geo_temporal_service.predict_species_probabilities.cache_info()
        probs1 = geo_temporal_service.predict_species_probabilities(lat, lon, week)
        probs2 = geo_temporal_service.predict_species_probabilities(lat, lon, week)
        cache_info_after = geo_temporal_service.predict_species_probabilities.cache_info()

        assert len(probs1) > 0
        assert probs1 is probs2 or (probs1 == probs2).all()
        assert cache_info_after.hits > cache_info_before.hits

    def test_contextualize_biological_detection(self):
        """Test contextualizing a biological species (e.g. Turdus migratorius - American Robin)."""
        # Ithaca, NY in spring
        res = geo_temporal_service.contextualize_acoustic_detection(
            scientific_name="Turdus migratorius",
            acoustic_confidence=0.85,
            latitude=42.44,
            longitude=-76.50,
            week=20,
        )
        assert res.scientific_name == "Turdus migratorius"
        assert res.acoustic_confidence == 0.85
        assert res.geographic_score is not None
        assert res.geographic_score >= 0.0
        assert res.disclaimer != ""
        # Scores are preserved separately without overwriting
        assert res.acoustic_confidence != res.geographic_score

    def test_contextualize_unusual_occurrence(self):
        """Test that species completely unexpected in a location is flagged as unusual."""
        # Apteryx mantelli (North Island Brown Kiwi) queried in London, UK (51.5, -0.1)
        res = geo_temporal_service.contextualize_acoustic_detection(
            scientific_name="Apteryx mantelli",
            acoustic_confidence=0.92,
            latitude=51.5074,
            longitude=-0.1278,
            week=25,
        )
        assert res.scientific_name == "Apteryx mantelli"
        assert res.acoustic_confidence == 0.92
        assert res.geographic_score is not None
        assert res.geographic_score < 0.01
        assert res.is_unusual_occurrence is True
        assert res.review_recommended is True
        assert "unexpected" in res.flag_reason.lower() or "unusual" in res.flag_reason.lower()

    def test_contextualize_non_biological_disturbance(self):
        """Test that non-biological classes (e.g. Chainsaw) have geo_score=None and are not flagged as unexpected species."""
        res = geo_temporal_service.contextualize_acoustic_detection(
            scientific_name="Chainsaw",
            acoustic_confidence=0.78,
            latitude=42.44,
            longitude=-76.50,
            week=20,
        )
        assert res.scientific_name == "Chainsaw"
        assert res.geographic_score is None
        assert res.occurrence_status == "not_applicable"
        assert res.is_unusual_occurrence is False
        assert res.review_recommended is False


# ============================================================================
# MODULE B: Site Intelligence & Location Privacy
# ============================================================================
class TestModuleBSiteIntelligence:
    def test_ecosystem_baseline_profiles(self):
        """Verify ecosystem baseline definitions for all 8 categories."""
        categories = [
            "temperate_broadleaf_forest",
            "tropical_rainforest",
            "boreal_taiga",
            "grassland_savanna",
            "shrubland_chaparral",
            "wetland_estuary",
            "agricultural_rural",
            "urban_suburban",
        ]
        for cat in categories:
            profile = site_intelligence_service.get_ecosystem_baseline_profile(cat)
            assert "expected_biophony_range" in profile
            assert "expected_anthrophony_range" in profile
            assert "typical_species_families" in profile

    def test_location_privacy_modes(self):
        """Verify exact, generalized, and restricted coordinate privacy behaviors."""
        site_exact = Site(
            id=str(uuid.uuid4()),
            name="Research Station Alpha",
            latitude=-3.465312,
            longitude=-62.215891,
            location_sensitivity="exact",
        )
        coords_exact = site_exact.get_public_coordinates()
        assert coords_exact["latitude"] == -3.465312
        assert coords_exact["longitude"] == -62.215891
        assert coords_exact["sensitivity"] == "exact"

        site_gen = Site(
            id=str(uuid.uuid4()),
            name="Endangered Locus Beta",
            latitude=-3.465312,
            longitude=-62.215891,
            location_sensitivity="generalized",
            generalized_latitude=-3.47,
            generalized_longitude=-62.22,
        )
        coords_gen = site_gen.get_public_coordinates()
        assert coords_gen["latitude"] == -3.47
        assert coords_gen["longitude"] == -62.22
        assert coords_gen["sensitivity"] == "generalized"

        site_restr = Site(
            id=str(uuid.uuid4()),
            name="Confidential Nest Gamma",
            latitude=-3.465312,
            longitude=-62.215891,
            location_sensitivity="restricted",
        )
        coords_restr = site_restr.get_public_coordinates()
        assert coords_restr["latitude"] is None
        assert coords_restr["longitude"] is None
        assert coords_restr["sensitivity"] == "restricted"
        assert "restricted" in coords_restr["note"].lower()


# ============================================================================
# MODULE C: Habitat Drift Engine
# ============================================================================
class TestModuleCHabitatDrift:
    def test_robust_z_score(self):
        """Verify robust Z-score calculation with median and MAD."""
        history = [10.0, 10.5, 9.5, 10.0, 11.0, 9.8, 10.2]
        z_normal = compute_robust_z_score(10.1, history)
        assert abs(z_normal) < 1.0

        z_outlier = compute_robust_z_score(25.0, history)
        assert z_outlier > 3.0

        # Too few items returns 0.0
        assert compute_robust_z_score(10.0, [10.0]) == 0.0

    @pytest.mark.asyncio
    async def test_session_vs_session_drift_computation(self, test_session: AsyncSession):
        """Test normalized duration and drift stats between two sessions."""
        site_id = str(uuid.uuid4())
        site = Site(
            id=site_id,
            name="Test Drift Forest",
            latitude=42.44,
            longitude=-76.50,
            ecosystem_category="temperate_broadleaf_forest",
        )
        test_session.add(site)

        # Baseline session: 3600 seconds (1 hr), 10 detections, 1 disturbance
        sess1_id = str(uuid.uuid4())
        sess1 = LiveSession(
            id=sess1_id,
            site_id=site_id,
            source_type="browser_mic",
            status="completed",
            total_audio_seconds=3600.0,
            processed_audio_seconds=3600.0,
            started_at=datetime(2026, 5, 1, 6, 0, tzinfo=timezone.utc),
            stopped_at=datetime(2026, 5, 1, 7, 0, tzinfo=timezone.utc),
        )
        test_session.add(sess1)

        # Target session: 1800 seconds (0.5 hr), 20 detections, 5 disturbances (much higher rate)
        sess2_id = str(uuid.uuid4())
        sess2 = LiveSession(
            id=sess2_id,
            site_id=site_id,
            source_type="browser_mic",
            status="completed",
            total_audio_seconds=1800.0,
            processed_audio_seconds=1800.0,
            started_at=datetime(2026, 6, 1, 12, 0, tzinfo=timezone.utc),
            stopped_at=datetime(2026, 6, 1, 12, 30, tzinfo=timezone.utc),
        )
        test_session.add(sess2)
        await test_session.flush()

        # Add detections
        for i in range(10):
            test_session.add(
                LiveEvent(
                    id=str(uuid.uuid4()),
                    session_id=sess1_id,
                    class_label=f"Species {i % 3}",
                    common_name=f"Species {i % 3}",
                    scientific_name=f"Species {i % 3}",
                    confidence_score=0.8,
                    start_seconds=i * 10.0,
                    end_seconds=i * 10.0 + 3.0,
                )
            )

        for i in range(20):
            test_session.add(
                LiveEvent(
                    id=str(uuid.uuid4()),
                    session_id=sess2_id,
                    class_label=f"Species {i % 5}",
                    common_name=f"Species {i % 5}",
                    scientific_name=f"Species {i % 5}",
                    confidence_score=0.8,
                    start_seconds=i * 5.0,
                    end_seconds=i * 5.0 + 3.0,
                )
            )

        # Add disturbances
        test_session.add(
            DisturbanceEvent(
                id=str(uuid.uuid4()),
                session_id=sess1_id,
                event_type="disturbance",
                class_label="Engine",
                category="anthropogenic_disturbance",
                confidence_score=0.7,
                start_seconds=100.0,
                end_seconds=110.0,
            )
        )

        for i in range(5):
            test_session.add(
                DisturbanceEvent(
                    id=str(uuid.uuid4()),
                    session_id=sess2_id,
                    event_type="disturbance",
                    class_label="Chainsaw",
                    category="anthropogenic_disturbance",
                    confidence_score=0.85,
                    start_seconds=i * 50.0,
                    end_seconds=i * 50.0 + 10.0,
                )
            )

        await test_session.commit()

        # Run comparison
        result = await habitat_drift_service.compare_sessions(
            baseline_session_id=sess1_id,
            target_session_id=sess2_id,
            site_id=site_id,
            db=test_session,
            persist=True,
        )

        assert result.site_id == site_id
        assert result.status == "completed"
        assert result.normalized_duration_ratio == 0.5  # 1800s / 3600s
        # Baseline detection rate = 10 / 1.0 hr = 10.0/hr
        # Target detection rate = 20 / 0.5 hr = 40.0/hr
        assert result.detection_rate_per_hour.baseline_value == pytest.approx(10.0, rel=1e-2)
        assert result.detection_rate_per_hour.target_value == pytest.approx(40.0, rel=1e-2)
        # Disturbance rate: 1.0/hr -> 10.0/hr
        assert result.disturbance_frequency_per_hour.baseline_value == pytest.approx(1.0, rel=1e-2)
        assert result.disturbance_frequency_per_hour.target_value == pytest.approx(10.0, rel=1e-2)
        assert len(result.explainable_findings) > 0
        assert "extinction" not in result.scientific_limitations.lower() or "never" in result.scientific_limitations.lower()


# ============================================================================
# MODULE D: Expert Verification Workflows
# ============================================================================
class TestModuleDExpertReview:
    @pytest.mark.asyncio
    async def test_non_destructive_review_creation_and_audit(self, test_session: AsyncSession):
        """Verify that human reviews preserve original scores and log immutable audit trails."""
        event_id = str(uuid.uuid4())
        orig_prediction = {
            "scientific_name": "Campephilus principalis",
            "common_name": "Ivory-billed Woodpecker",
        }
        create_in = EnvironmentalReviewCreate(
            review_category="unexpected_geographic_occurrence",
            target_type="live_event",
            target_id=event_id,
            original_prediction=orig_prediction,
            original_score=0.82,
            review_decision="needs_more_evidence",
            reviewer_note="Acoustic match is intriguing, but habitat is unverified.",
        )

        created = await environmental_review_service.create_review(create_in, test_session)
        assert created.id is not None
        assert created.original_score == 0.82
        assert created.review_decision == "needs_more_evidence"
        assert len(created.history) == 1
        assert created.history[0]["action"] == "created"

        # Update decision
        update_in = EnvironmentalReviewUpdate(
            review_decision="uncertain",
            reviewer_note="Spectral harmonics resemble pileated woodpecker toy call.",
        )
        updated = await environmental_review_service.update_review(created.id, update_in, test_session)
        assert updated is not None
        assert updated.review_decision == "uncertain"
        assert updated.original_score == 0.82  # Model score NOT mutated
        assert len(updated.history) == 2
        assert updated.history[1]["action"] == "decision_updated"
        assert updated.history[1]["previous_decision"] == "needs_more_evidence"
        assert updated.history[1]["new_decision"] == "uncertain"


# ============================================================================
# MODULE E: Environmental Incident Management
# ============================================================================
class TestModuleEIncidentManagement:
    def test_priority_rules(self):
        """Verify priority rules for environmental disturbances and hazards."""
        assert compute_incident_priority("anthropogenic_disturbance", "Gun", peak_confidence=0.6) == "critical"
        assert compute_incident_priority("anthropogenic_disturbance", "Fire", peak_confidence=0.55) == "critical"
        assert compute_incident_priority("anthropogenic_disturbance", "Chainsaw", repetition_count=4, peak_confidence=0.7) == "critical"
        assert compute_incident_priority("anthropogenic_disturbance", "Power tool", peak_confidence=0.6) == "medium"
        assert compute_incident_priority("anthropogenic_disturbance", "Aircraft", peak_confidence=0.8) == "low"
        assert compute_incident_priority("anthropogenic_disturbance", "Music", peak_confidence=0.7) == "informational"

    @pytest.mark.asyncio
    async def test_incident_lifecycle(self, test_session: AsyncSession):
        """Test incident creation, code formatting, status update, and resolution."""
        inc_in = EnvironmentalIncidentCreate(
            title="Suspicious Chainsaw Pattern",
            category="logging_signature",
            priority="high",
            status="detected",
            evidence={"source": "Disturbance Radar", "confidence": 0.88},
            investigation_notes="Automated alert triggered from acoustic cluster.",
        )
        created = await incident_management_service.create_incident(inc_in, test_session)
        assert created.incident_code.startswith("INC-")
        assert created.status == "detected"
        assert created.resolved_at is None

        # Resolve incident
        up_in = EnvironmentalIncidentUpdate(
            status="resolved",
            resolution_notes="Confirmed authorized trail maintenance by forestry service.",
        )
        resolved = await incident_management_service.update_incident(created.id, up_in, test_session)
        assert resolved is not None
        assert resolved.status == "resolved"
        assert resolved.resolved_at is not None
        assert "trail maintenance" in resolved.resolution_notes


# ============================================================================
# MODULE F: Ecological Evidence Reports
# ============================================================================
class TestModuleFEcologicalReports:
    @pytest.mark.asyncio
    async def test_json_and_csv_report_generation(self, test_session: AsyncSession):
        """Test generation of comprehensive JSON and scientific CSV reports with metadata headers."""
        site_id = str(uuid.uuid4())
        site = Site(
            id=site_id,
            name="Sanctuary Delta",
            latitude=42.44,
            longitude=-76.50,
            ecosystem_category="wetland_estuary",
            location_sensitivity="generalized",
            generalized_latitude=42.44,
            generalized_longitude=-76.50,
        )
        test_session.add(site)

        # Add session and detections
        sess_id = str(uuid.uuid4())
        sess = LiveSession(
            id=sess_id,
            site_id=site_id,
            source_type="browser_mic",
            status="completed",
            total_audio_seconds=1200.0,
            processed_audio_seconds=1200.0,
            started_at=datetime(2026, 5, 10, 5, 30, tzinfo=timezone.utc),
            stopped_at=datetime(2026, 5, 10, 5, 50, tzinfo=timezone.utc),
        )
        test_session.add(sess)

        det_id = str(uuid.uuid4())
        test_session.add(
            LiveEvent(
                id=det_id,
                session_id=sess_id,
                class_label="Turdus migratorius",
                scientific_name="Turdus migratorius",
                common_name="American Robin",
                confidence_score=0.88,
                start_seconds=10.0,
                end_seconds=13.0,
            )
        )
        await test_session.commit()

        from app.schemas.environmental_intelligence import EcologicalReportRequest

        req = EcologicalReportRequest(site_id=site_id, format="json", mask_sensitive_locations=True)
        json_rep = await ecological_report_service.generate_json_report(req, test_session)

        assert json_rep["site_id"] == site_id
        assert json_rep["metadata"]["site_name"] == "Sanctuary Delta"
        assert json_rep["metadata"]["ecosystem_category"] == "wetland_estuary"
        assert len(json_rep["species_inventory"]) >= 1
        assert "extinction" not in json_rep["disclaimers"]["scientific_integrity"].lower() or "cannot" in json_rep["disclaimers"]["scientific_integrity"].lower()

        # CSV report
        csv_rep = await ecological_report_service.generate_csv_report(req, test_session)
        assert "# EcoSonic Ecological Evidence Report" in csv_rep
        assert "Site ID: " in csv_rep
        assert "Turdus migratorius" in csv_rep


# ============================================================================
# API INTEGRATION ENDPOINTS
# ============================================================================
class TestPhase5ApiIntegration:
    @pytest.mark.asyncio
    async def test_geo_contextualize_endpoint(self, client: AsyncClient):
        """POST /api/v1/geo/contextualize"""
        payload = {
            "scientific_name": "Turdus migratorius",
            "acoustic_confidence": 0.82,
            "latitude": 42.44,
            "longitude": -76.50,
            "week": 20,
        }
        res = await client.post("/api/v1/geo/contextualize", json=payload)
        assert res.status_code == 200
        data = res.json()
        assert data["scientific_name"] == "Turdus migratorius"
        assert data["acoustic_confidence"] == 0.82
        assert "occurrence_status" in data
        assert "disclaimer" in data

    @pytest.mark.asyncio
    async def test_site_lifecycle_and_intelligence_endpoints(self, client: AsyncClient):
        """Test creating site with Phase 5 attributes and querying intelligence endpoints."""
        site_payload = {
            "name": "Appalachian Field Site",
            "latitude": 38.5,
            "longitude": -80.2,
            "ecosystem_category": "temperate_broadleaf_forest",
            "location_sensitivity": "generalized",
        }
        create_res = await client.post("/api/v1/sites", json=site_payload)
        assert create_res.status_code == 201
        site_data = create_res.json()
        site_id = site_data["id"]

        assert site_data["ecosystem_category"] == "temperate_broadleaf_forest"
        assert site_data["location_sensitivity"] == "generalized"
        assert site_data["generalized_latitude"] == 38.5
        assert site_data["generalized_longitude"] == -80.2

        # GET /api/v1/sites/{id}/geo-context
        geo_res = await client.get(f"/api/v1/sites/{site_id}/geo-context?week=22")
        assert geo_res.status_code == 200
        geo_data = geo_res.json()
        assert geo_data["site_id"] == site_id
        assert geo_data["model_version"] == "BirdNET Geo V3.0"
        assert "top_regional_species" in geo_data

        # GET /api/v1/sites/{id}/species-context
        sp_res = await client.get(f"/api/v1/sites/{site_id}/species-context?scientific_name=Turdus migratorius&confidence=0.85&week=22")
        assert sp_res.status_code == 200
        sp_data = sp_res.json()
        assert sp_data["scientific_name"] == "Turdus migratorius"
        assert sp_data["acoustic_confidence"] == 0.85

        # GET /api/v1/sites/{id}/history
        hist_res = await client.get(f"/api/v1/sites/{site_id}/history")
        assert hist_res.status_code == 200
        hist_data = hist_res.json()
        assert hist_data["site_id"] == site_id
        assert "sound_source_localization_note" in hist_data

        # GET /api/v1/sites/{id}/habitat-drift
        drift_res = await client.get(f"/api/v1/sites/{site_id}/habitat-drift")
        assert drift_res.status_code == 200
        drift_data = drift_res.json()
        assert drift_data["site_id"] == site_id
        assert "stability_index" in drift_data

        # GET /api/v1/sites/{id}/incidents
        inc_res = await client.get(f"/api/v1/sites/{site_id}/incidents")
        assert inc_res.status_code == 200
        assert isinstance(inc_res.json(), list)

        # GET /api/v1/sites/{id}/reports (JSON)
        rep_json_res = await client.get(f"/api/v1/sites/{site_id}/reports?format=json")
        assert rep_json_res.status_code == 200
        assert "species_inventory" in rep_json_res.json()

        # GET /api/v1/sites/{id}/reports (CSV)
        rep_csv_res = await client.get(f"/api/v1/sites/{site_id}/reports?format=csv")
        assert rep_csv_res.status_code == 200
        assert rep_csv_res.headers["content-type"].startswith("text/csv")
        assert "# EcoSonic Ecological Evidence Report" in rep_csv_res.text

    @pytest.mark.asyncio
    async def test_review_and_incident_api_endpoints(self, client: AsyncClient):
        """Test top-level environmental review and incident routes."""
        # POST /api/v1/environmental-events/{event_id}/review
        dummy_event_id = str(uuid.uuid4())
        review_payload = {
            "review_category": "unexpected_geographic_occurrence",
            "target_type": "live_event",
            "original_prediction": {"scientific_name": "Bubo virginianus"},
            "original_score": 0.89,
            "review_decision": "confirmed",
            "reviewer_note": "Distinctive deep hoot sequence confirmed by field ornithologist.",
        }
        rev_post = await client.post(f"/api/v1/environmental-events/{dummy_event_id}/review", json=review_payload)
        assert rev_post.status_code == 201
        rev_data = rev_post.json()
        review_id = rev_data["id"]
        assert rev_data["review_decision"] == "confirmed"
        assert rev_data["original_score"] == 0.89

        # GET /api/v1/environmental-reviews/{id}
        rev_get = await client.get(f"/api/v1/environmental-reviews/{review_id}")
        assert rev_get.status_code == 200
        assert rev_get.json()["id"] == review_id

        # PATCH /api/v1/environmental-reviews/{id}
        patch_res = await client.patch(
            f"/api/v1/environmental-reviews/{review_id}",
            json={"review_decision": "uncertain", "reviewer_note": "Auditory interference noted on playback."},
        )
        assert patch_res.status_code == 200
        assert patch_res.json()["review_decision"] == "uncertain"
        assert len(patch_res.json()["history"]) == 2

        # POST /api/v1/environmental-incidents
        inc_payload = {
            "title": "Chainsaw Cluster Alert",
            "category": "logging_signature",
            "priority": "high",
            "status": "detected",
            "evidence": {"frequency_range": "500-2500Hz", "snr": 14.2},
            "investigation_notes": "Multiple chainsaw bursts detected over 5-minute window.",
        }
        inc_post = await client.post("/api/v1/environmental-incidents", json=inc_payload)
        assert inc_post.status_code == 201
        inc_data = inc_post.json()
        inc_id = inc_data["id"]
        assert inc_data["incident_code"].startswith("INC-")

        # GET /api/v1/environmental-incidents/{id}
        inc_get = await client.get(f"/api/v1/environmental-incidents/{inc_id}")
        assert inc_get.status_code == 200
        assert inc_get.json()["id"] == inc_id

        # PATCH /api/v1/environmental-incidents/{id}
        inc_patch = await client.patch(
            f"/api/v1/environmental-incidents/{inc_id}",
            json={"status": "resolved", "resolution_notes": "Park ranger verified fallen tree removal."},
        )
        assert inc_patch.status_code == 200
        assert inc_patch.json()["status"] == "resolved"
        assert inc_patch.json()["resolved_at"] is not None
