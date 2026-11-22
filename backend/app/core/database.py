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
from sqlalchemy.pool import NullPool

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
    poolclass=NullPool if "sqlite" in settings.DATABASE_URL else None,
    connect_args={"check_same_thread": False, "timeout": 30} if "sqlite" in settings.DATABASE_URL else {},
)


# SQLite PRAGMA for foreign keys, WAL mode, and busy timeout
@event.listens_for(engine.sync_engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    try:
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA busy_timeout=30000")
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
        from app.models import (  # noqa: F401
            analysis,
            detection,
            environmental_intelligence,
            live_session,
            review,
            site,
            soundscape,
        )
        logger.info("Initializing database schema from metadata...")
        await conn.run_sync(Base.metadata.create_all)

        # Ensure backward-compatible column upgrades for existing SQLite tables
        def _ensure_sqlite_columns(sync_conn):
            cursor = sync_conn.connection.cursor()
            try:
                # 1. Disturbance events
                cursor.execute("PRAGMA table_info(disturbance_events)")
                dist_cols = {row[1] for row in cursor.fetchall()}
                if dist_cols and "category" not in dist_cols:
                    cursor.execute("ALTER TABLE disturbance_events ADD COLUMN category VARCHAR(100)")
                if dist_cols and "hazard_classification" not in dist_cols:
                    cursor.execute("ALTER TABLE disturbance_events ADD COLUMN hazard_classification VARCHAR(50)")

                # 2. Sites table additions
                cursor.execute("PRAGMA table_info(sites)")
                site_cols = {row[1] for row in cursor.fetchall()}
                if site_cols and "ecosystem_category" not in site_cols:
                    cursor.execute("ALTER TABLE sites ADD COLUMN ecosystem_category VARCHAR(50) DEFAULT 'forest'")
                if site_cols and "timezone" not in site_cols:
                    cursor.execute("ALTER TABLE sites ADD COLUMN timezone VARCHAR(50) DEFAULT 'UTC'")
                if site_cols and "location_sensitivity" not in site_cols:
                    cursor.execute("ALTER TABLE sites ADD COLUMN location_sensitivity VARCHAR(50) DEFAULT 'exact'")
                if site_cols and "generalized_latitude" not in site_cols:
                    cursor.execute("ALTER TABLE sites ADD COLUMN generalized_latitude FLOAT")
                if site_cols and "generalized_longitude" not in site_cols:
                    cursor.execute("ALTER TABLE sites ADD COLUMN generalized_longitude FLOAT")
                if site_cols and "ecosystem_profile_json" not in site_cols:
                    cursor.execute("ALTER TABLE sites ADD COLUMN ecosystem_profile_json JSON")
                if site_cols and "metadata_json" not in site_cols:
                    cursor.execute("ALTER TABLE sites ADD COLUMN metadata_json JSON")
            except Exception as e:
                logger.warning("Auto column migration check failed: %s", e)
            finally:
                cursor.close()

        await conn.run_sync(_ensure_sqlite_columns)
        logger.info("Database schema initialized successfully.")


async def close_db() -> None:
    """Closes all database connections."""
    await engine.dispose()
    logger.info("Database connection pool disposed.")
