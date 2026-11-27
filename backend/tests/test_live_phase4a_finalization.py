"""Targeted finalization tests for Phase 4A live audio streaming, ring buffer, protocol, and persistence."""

from __future__ import annotations

import math
import struct
import tempfile
import uuid
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.database import Base
from app.models.live_session import LiveEvent, LiveSegment, LiveSession
from app.services.birdnet_engine import AudioValidationError
from app.services.live.inference_worker import LiveInferenceWorker
from app.services.live.ring_buffer import AudioRingBuffer
from app.services.live.session_manager import LiveSessionManager, LiveSessionState


@pytest.mark.asyncio
async def test_uint32_sequence_wraparound_and_gaps():
    """Verify uint32 sequence numbers wrap from 2^32 - 1 to 0 without dropping or misclassifying frames."""
    manager = LiveSessionManager()
    session_id = str(uuid.uuid4())
    state = await manager.create_session(session_id=session_id)
    state.status = "active"

    # Pre-set expected_seq right before wraparound boundary: 2^32 - 2
    state.expected_seq = 0xFFFFFFFE  # 4,294,967,294
    pcm_chunk = (np.ones(1000, dtype="<i2") * 500).tobytes()

    # 1. Ingest frame 4,294,967,294 (exact match)
    ok, err = await manager.ingest_audio_frame(session_id, 0xFFFFFFFE, pcm_chunk)
    assert ok is True
    assert state.expected_seq == 0xFFFFFFFF
    assert state.dropped_frames == 0
    assert state.duplicate_frames == 0

    # 2. Ingest frame 4,294,967,295 (max uint32)
    ok, err = await manager.ingest_audio_frame(session_id, 0xFFFFFFFF, pcm_chunk)
    assert ok is True
    assert state.expected_seq == 0  # Wrapped around to 0
    assert state.dropped_frames == 0

    # 3. Ingest frame 0 (after wraparound)
    ok, err = await manager.ingest_audio_frame(session_id, 0, pcm_chunk)
    assert ok is True
    assert state.expected_seq == 1
    assert state.dropped_frames == 0

    # 4. Duplicate frame 0
    ok, err = await manager.ingest_audio_frame(session_id, 0, pcm_chunk)
    assert ok is False
    assert "Duplicate frame detected" in (err or "")
    assert state.duplicate_frames == 1

    # 5. Gap jump: send frame 4 (missing frames 1, 2, 3)
    ok, err = await manager.ingest_audio_frame(session_id, 4, pcm_chunk)
    assert ok is True
    assert state.dropped_frames == 3
    assert state.expected_seq == 5


@pytest.mark.asyncio
async def test_live_session_manager_rejects_unsupported_audio_formats():
    """The inference session contract rejects anything except 32 kHz mono PCM16."""
    manager = LiveSessionManager()
    session_id = str(uuid.uuid4())
    with pytest.raises(ValueError, match="sample_rate=32000 and channels=1"):
        await manager.create_session(session_id=session_id, channels=2)

    with pytest.raises(ValueError, match="sample_rate=32000 and channels=1"):
        await manager.create_session(session_id=session_id, sample_rate=44100)


def test_ring_buffer_zero_variance_detection():
    """Verify AudioRingBuffer flags zero variance on constant flatline audio."""
    rb = AudioRingBuffer(sample_rate=32000, window_duration_s=3.0, hop_duration_s=3.0)

    # Ingest 3 seconds of varying audio (sine wave)
    t = np.linspace(0, 3.0, 96000, endpoint=False)
    sine = (np.sin(2 * np.pi * 440 * t) * 10000).astype("<i2").tobytes()
    rb.write_pcm16_bytes(sine)

    windows = rb.extract_available_windows()
    assert len(windows) == 1
    assert windows[0].is_zero_variance is False
    assert windows[0].is_silent is False

    # Reset and ingest 3 seconds of constant DC flatline (e.g. all 1500)
    rb.reset()
    flat = (np.ones(96000, dtype="<i2") * 1500).tobytes()
    rb.write_pcm16_bytes(flat)

    flat_windows = rb.extract_available_windows()
    assert len(flat_windows) == 1
    assert flat_windows[0].is_zero_variance is True


@pytest.mark.asyncio
async def test_session_restart_recovery():
    """Verify complete persistence of live session, events, segments, and files across process restart."""
    with tempfile.TemporaryDirectory(prefix="ecosonic_restart_test_") as temp_dir:
        db_file = Path(temp_dir) / "restart_test.db"
        storage_dir = Path(temp_dir) / "storage"
        storage_dir.mkdir(parents=True, exist_ok=True)

        db_url = f"sqlite+aiosqlite:///{db_file}"

        # -------------------------------------------------------------
        # Phase 1: Initialize, create session, ingest audio, save DB
        # -------------------------------------------------------------
        engine1 = create_async_engine(db_url, poolclass=NullPool)
        async with engine1.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        session_maker1 = async_sessionmaker(bind=engine1, class_=AsyncSession, expire_on_commit=False)

        session_id = str(uuid.uuid4())
        event_id = str(uuid.uuid4())
        segment_id = str(uuid.uuid4())

        # Create dummy audio segment file
        audio_file = storage_dir / f"live_{session_id}_0.000_3.000.wav"
        dummy_samples = (np.sin(np.linspace(0, 3.0, 96000)) * 0.5).astype(np.float32)
        sf.write(str(audio_file), dummy_samples, 32000)

        # Create dummy embedding file
        embed_file = storage_dir / f"live_emb_{session_id}_0.000_3.000.npy"
        dummy_vector = np.random.randn(1280).astype(np.float32)
        np.save(str(embed_file), dummy_vector)

        async with session_maker1() as db:
            live_sess = LiveSession(
                id=session_id,
                source_type="field_device",
                device_id="solar_node_alpha",
                sample_rate=32000,
                channels=1,
                status="stopped",
                total_audio_seconds=3.0,
                processed_audio_seconds=3.0,
            )
            db.add(live_sess)

            live_seg = LiveSegment(
                id=segment_id,
                session_id=session_id,
                start_seconds=0.0,
                end_seconds=3.0,
                audio_path=str(audio_file),
                embedding_path=str(embed_file),
                processing_status="processed",
            )
            db.add(live_seg)

            live_ev = LiveEvent(
                id=event_id,
                session_id=session_id,
                detection_id=str(uuid.uuid4()),
                start_seconds=0.5,
                end_seconds=2.5,
                class_label="Turdus migratorius_American Robin",
                scientific_name="Turdus migratorius",
                common_name="American Robin",
                confidence_score=0.92,
                taxon_group="Bird",
                model_version="V3.0",
            )
            db.add(live_ev)
            await db.commit()

        # Completely close and dispose first engine to simulate backend process exit
        await engine1.dispose()

        # -------------------------------------------------------------
        # Phase 2: Start new backend process pointing to same storage
        # -------------------------------------------------------------
        engine2 = create_async_engine(db_url, poolclass=NullPool)
        session_maker2 = async_sessionmaker(bind=engine2, class_=AsyncSession, expire_on_commit=False)

        async with session_maker2() as db:
            result = await db.execute(select(LiveSession).where(LiveSession.id == session_id))
            recovered_session = result.scalar_one_or_none()

            assert recovered_session is not None
            assert recovered_session.id == session_id
            assert recovered_session.source_type == "field_device"
            assert recovered_session.device_id == "solar_node_alpha"
            assert recovered_session.total_audio_seconds == 3.0

            # Recover segments
            seg_result = await db.execute(select(LiveSegment).where(LiveSegment.session_id == session_id))
            recovered_segs = seg_result.scalars().all()
            assert len(recovered_segs) == 1
            assert recovered_segs[0].id == segment_id
            assert Path(recovered_segs[0].audio_path).exists()
            assert Path(recovered_segs[0].embedding_path).exists()

            # Verify saved audio file can be read and decoded cleanly
            read_samples, sr = sf.read(recovered_segs[0].audio_path)
            assert sr == 32000
            assert len(read_samples) == 96000

            # Verify saved embedding vector has 1280 dimensions
            read_vec = np.load(recovered_segs[0].embedding_path)
            assert read_vec.shape == (1280,)
            assert np.allclose(read_vec, dummy_vector)

            # Recover events
            ev_result = await db.execute(select(LiveEvent).where(LiveEvent.session_id == session_id))
            recovered_events = ev_result.scalars().all()
            assert len(recovered_events) == 1
            assert recovered_events[0].id == event_id
            assert recovered_events[0].class_label == "Turdus migratorius_American Robin"
            assert math.isclose(recovered_events[0].confidence_score, 0.92, abs_tol=1e-3)

        await engine2.dispose()


@pytest.mark.asyncio
async def test_rapid_pause_resume_lifecycle(test_engine, test_session):
    """Verify pause and resume correctly transition state and pause discards audio cleanly."""
    manager = LiveSessionManager()
    session_id = str(uuid.uuid4())
    live_sess = LiveSession(
        id=session_id,
        source_type="browser_mic",
        sample_rate=32000,
        channels=1,
        status="created",
    )
    test_session.add(live_sess)
    await test_session.commit()

    state = await manager.create_session(session_id=session_id)

    # Start
    await manager.start_session(session_id)
    assert state.status == "active"

    # Ingest audio while active
    pcm = (np.ones(1000, dtype="<i2") * 1000).tobytes()
    ok, warn = await manager.ingest_audio_frame(session_id, 0, pcm)
    assert ok is True

    # Pause
    await manager.pause_session(session_id)
    assert state.status == "paused"

    # Ingest audio while paused: audio discarded, returns warning
    ok, warn = await manager.ingest_audio_frame(session_id, 1, pcm)
    assert ok is True
    assert "paused" in (warn or "").lower()

    # Resume
    await manager.resume_session(session_id)
    assert state.status == "active"

    # Ingest again
    ok, warn = await manager.ingest_audio_frame(session_id, 2, pcm)
    assert ok is True

    # Stop
    await manager.stop_session(session_id)
    assert state.status == "stopped"

    # Audio after stop is rejected
    ok, warn = await manager.ingest_audio_frame(session_id, 3, pcm)
    assert ok is False
    assert "stopped" in (warn or "").lower()
