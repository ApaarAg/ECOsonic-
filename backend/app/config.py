from pathlib import Path
from typing import List, Set
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

    PROJECT_NAME: str = "EcoSonic 3.0 Bioacoustic Intelligence"
    PROJECT_VERSION: str = "3.0.0"
    ENVIRONMENT: str = "development"
    DEBUG: bool = True

    # Database
    DATABASE_URL: str = "sqlite+aiosqlite:///./storage/ecosonic.db"

    # Base Paths
    BASE_DIR: Path = Path(__file__).resolve().parent.parent
    STORAGE_BASE_DIR: Path = Path(__file__).resolve().parent.parent / "storage"

    # Ingestion constraints
    MAX_UPLOAD_SIZE_BYTES: int = 50 * 1024 * 1024  # 50 MB
    ALLOWED_AUDIO_EXTENSIONS: Set[str] = {"wav", "mp3", "flac", "ogg", "m4a"}
    ALLOWED_MIME_TYPES: Set[str] = {
        "audio/wav",
        "audio/x-wav",
        "audio/wave",
        "audio/mpeg",
        "audio/mp3",
        "audio/flac",
        "audio/x-flac",
        "audio/ogg",
        "application/ogg",
        "audio/mp4",
        "audio/x-m4a",
        "audio/aac",
        "application/octet-stream",  # Fallback for some browsers, validated via header/magic bytes
    }

    # Audio normalization parameters
    TARGET_SAMPLE_RATE: int = 32000  # BirdNET V3.0 native sample rate
    TARGET_CHANNELS: int = 1  # Mono
    MIN_AUDIO_DURATION_SECONDS: float = 0.5
    MAX_AUDIO_DURATION_SECONDS: float = 7200.0  # 2 hours

    # Model & Pipeline settings
    MODEL_VERSION: str = "BirdNET+ V3.0"
    MODEL_PREFER_GPU: bool = True
    DEFAULT_CONFIDENCE_THRESHOLD: float = 0.25
    NUM_WORKER_THREADS: int = 4
    MAX_CONCURRENT_JOBS: int = 1

    # CORS / WebSocket origin allowlist (comma-separated in production)
    ALLOWED_ORIGINS: str = ""

    # Feature Flags
    ENABLE_ACOUSTIC_MEMORY: bool = True

    @property
    def allowed_origins_list(self) -> List[str]:
        raw = [o.strip().rstrip("/") for o in self.ALLOWED_ORIGINS.split(",") if o.strip()]
        if raw:
            return [o for o in raw if o != "*"] if self.ENVIRONMENT == "production" else raw
        if self.ENVIRONMENT == "production":
            return []
        return [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:3000",
            "http://127.0.0.1:3000",
        ]

    @property
    def raw_audio_dir(self) -> Path:
        path = self.STORAGE_BASE_DIR / "raw"
        path.mkdir(parents=True, exist_ok=True)
        return path

    @property
    def processed_audio_dir(self) -> Path:
        path = self.STORAGE_BASE_DIR / "processed"
        path.mkdir(parents=True, exist_ok=True)
        return path

    @property
    def embeddings_dir(self) -> Path:
        path = self.STORAGE_BASE_DIR / "embeddings"
        path.mkdir(parents=True, exist_ok=True)
        return path


settings = Settings()
