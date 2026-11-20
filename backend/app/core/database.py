import os
from typing import AsyncGenerator
from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.config import settings
from app.core.logging import logger


class Base(DeclarativeBase):
    """Base model class for all SQLAlchemy declarative models."""
    pass


# Ensure parent storage directory exists for SQLite db file
if "sqlite" in settings.DATABASE_URL:
    db_path = settings.DATABASE_URL.replace("sqlite+aiosqlite:///", "").replace("sqlite:///", "")
    db_dir = os.path.dirname(os.path.abspath(db_path))
    if db_dir:
        os.makedirs(db_dir, exist_ok=True)


engine: AsyncEngine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.DEBUG,
    future=True,
    connect_args={"check_same_thread": False} if "sqlite" in settings.DATABASE_URL else {},
)


# SQLite PRAGMA for foreign keys and WAL mode
@event.listens_for(engine.sync_engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    try:
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
    except Exception as e:
        logger.warning("Could not set SQLite pragmas: %s", e)
    finally:
        cursor.close()


async_session_factory = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Dependency for obtaining an asynchronous database session with transaction management."""
    async with async_session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def init_db() -> None:
    """Initializes tables in the database."""
    async with engine.begin() as conn:
        # Import models inside to ensure all models are registered on Base.metadata
        from app.models import analysis, detection, site, review  # noqa: F401
        logger.info("Initializing database schema from metadata...")
        await conn.run_sync(Base.metadata.create_all)
        logger.info("Database schema initialized successfully.")


async def close_db() -> None:
    """Closes all database connections."""
    await engine.dispose()
    logger.info("Database connection pool disposed.")
