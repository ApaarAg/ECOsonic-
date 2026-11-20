import uuid
from datetime import datetime, timezone
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.analysis import Analysis, EmbeddingSegment
from app.models.detection import Detection
from app.models.review import Review
from app.models.site import Site
from app.repositories.analysis_repository import AnalysisRepository
from app.repositories.detection_repository import DetectionRepository
from app.repositories.site_repository import SiteRepository


@pytest.mark.asyncio
async def test_site_crud(test_session: AsyncSession):
    repo = SiteRepository(test_session)

    site = Site(
        id=str(uuid.uuid4()),
        name="Kruger National Park Zone A",
        latitude=-24.01,
        longitude=31.48,
        description="Savanna monitoring transect",
    )
    created = await repo.create(site)
    assert created.id == site.id

    fetched = await repo.get_by_id(site.id)
    assert fetched is not None
    assert fetched.name == "Kruger National Park Zone A"

    updated = await repo.update(site.id, name="Kruger Zone A Updated")
    assert updated.name == "Kruger Zone A Updated"

    deleted = await repo.delete(site.id)
    assert deleted is True

    gone = await repo.get_by_id(site.id)
    assert gone is None


@pytest.mark.asyncio
async def test_analysis_and_cascading_delete(test_session: AsyncSession):
    analysis_repo = AnalysisRepository(test_session)
    detection_repo = DetectionRepository(test_session)

    analysis_id = str(uuid.uuid4())
    analysis = Analysis(
        id=analysis_id,
        filename="dawn_chorus.wav",
        audio_path="/fake/path/dawn_chorus.wav",
        status="completed",
        progress=100.0,
        current_stage="Completed",
        duration_seconds=60.0,
        latitude=51.5,
        longitude=-0.1,
        recorded_at=datetime.now(timezone.utc),
        model_version="BirdNET+ V3.0",
        metrics_json={"total_detections": 1},
    )
    await analysis_repo.create(analysis)

    det_id = str(uuid.uuid4())
    detection = Detection(
        id=det_id,
        analysis_id=analysis_id,
        class_label="Erithacus rubecula_European Robin",
        scientific_name="Erithacus rubecula",
        common_name="European Robin",
        start_seconds=10.0,
        end_seconds=13.0,
        confidence_score=0.92,
        review_status="unreviewed",
    )
    await detection_repo.create_batch([detection])

    review_id = str(uuid.uuid4())
    review = Review(
        id=review_id,
        detection_id=det_id,
        review_status="confirmed",
        reviewer_note="Crisp territorial song sequence",
    )
    await detection_repo.create_review(review)

    seg_id = str(uuid.uuid4())
    seg = EmbeddingSegment(
        segment_id=seg_id,
        analysis_id=analysis_id,
        vector_index=0,
        start_seconds=10.0,
        end_seconds=13.0,
        detection_id=det_id,
    )
    await analysis_repo.add_embedding_segments([seg])

    # Check relation loading
    loaded = await analysis_repo.get_by_id(analysis_id, load_relations=True)
    assert loaded is not None
    assert len(loaded.detections) == 1
    assert len(loaded.detections[0].reviews) == 1
    assert len(loaded.embedding_segments) == 1

    # Verify cascading delete
    await analysis_repo.delete(analysis_id)

    # Detection should be deleted
    det_check = await detection_repo.get_by_id(det_id)
    assert det_check is None

    # Analysis should be deleted
    an_check = await analysis_repo.get_by_id(analysis_id)
    assert an_check is None
