import os
import shutil
import tempfile
from pathlib import Path
from typing import AsyncGenerator
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

# Set testing environment variables before importing app
temp_dir = tempfile.mkdtemp(prefix="ecosonic_test_")
test_db_path = Path(temp_dir) / "test_ecosonic.db"
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{test_db_path}"
os.environ["STORAGE_BASE_DIR"] = temp_dir
model_cache_path = Path(".model_cache").resolve()
if model_cache_path.exists():
    os.environ.setdefault("BIRDNET_APP_DATA", str(model_cache_path))

from app.config import settings
from app.core.database import Base, get_db
from app.main import app


@pytest.fixture(scope="session", autouse=True)
def cleanup_temp_dir():
    yield
    shutil.rmtree(temp_dir, ignore_errors=True)


@pytest_asyncio.fixture
async def test_engine():
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{test_db_path}",
        connect_args={"check_same_thread": False},
    )
    from sqlalchemy import event

    @event.listens_for(engine.sync_engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
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
    maker = async_sessionmaker(
        bind=test_engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )

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

    app.dependency_overrides.clear()
