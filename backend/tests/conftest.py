import os
import shutil
import tempfile
from pathlib import Path
from typing import AsyncGenerator
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

# Set testing environment variables before importing app
temp_dir = tempfile.mkdtemp(prefix="ecosonic_test_")
test_db_path = Path(temp_dir) / "test_ecosonic.db"
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{test_db_path}"
os.environ["STORAGE_BASE_DIR"] = temp_dir
model_cache_path = (Path(__file__).resolve().parents[2] / ".model_cache").resolve()
if model_cache_path.exists():
    os.environ.setdefault("BIRDNET_APP_DATA", str(model_cache_path))

from app.config import settings
from app.core import database
from app.core.database import Base, get_db
from app.core.job_manager import job_manager
from app.main import app
from app.models import analysis, detection, live_session, soundscape, site, review  # noqa: F401
from app.services.analysis_pipeline import analysis_pipeline, FallbackMockEngine
from app.services.live import embedding_worker, inference_worker, session_manager
from app.workers import analysis_worker


@pytest.fixture(scope="session", autouse=True)
def cleanup_temp_dir():
    yield
    shutil.rmtree(temp_dir, ignore_errors=True)


@pytest_asyncio.fixture
async def test_engine():
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{test_db_path}",
        poolclass=NullPool,
        connect_args={"check_same_thread": False, "timeout": 30},
    )
    from sqlalchemy import event

    @event.listens_for(engine.sync_engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=30000")
        cursor.close()

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest_asyncio.fixture
async def test_session(test_engine) -> AsyncGenerator[AsyncSession, None]:
    maker = async_sessionmaker(
        bind=test_engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    async with maker() as session:
        yield session
        await session.rollback()


@pytest_asyncio.fixture
async def client(test_engine) -> AsyncGenerator[AsyncClient, None]:
    previous_engine = analysis_pipeline.engine
    previous_factory = analysis_worker.async_session_factory
    analysis_pipeline.set_engine(FallbackMockEngine())
    analysis_pipeline.load()
    maker = async_sessionmaker(
        bind=test_engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    previous_db_factory = database.async_session_factory
    database.async_session_factory = maker
    analysis_worker.async_session_factory = maker
    embedding_worker.async_session_factory = maker
    inference_worker.async_session_factory = maker
    session_manager.async_session_factory = maker

    async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
        async with maker() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise
            finally:
                await session.close()

    app.dependency_overrides[get_db] = override_get_db

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    await job_manager.cancel_and_wait_all(timeout=5.0)
    await session_manager.live_session_manager.shutdown(timeout=5.0)

    app.dependency_overrides.clear()
    analysis_pipeline.set_engine(previous_engine)
    analysis_worker.async_session_factory = previous_factory
    database.async_session_factory = previous_db_factory
    embedding_worker.async_session_factory = previous_db_factory
    inference_worker.async_session_factory = previous_db_factory
    session_manager.async_session_factory = previous_db_factory
