import os
import shutil
import tempfile
from pathlib import Path
from typing import BinaryIO, Optional
import numpy as np

from app.config import settings
from app.core.logging import logger


class StorageService:
    """Manages raw audio, processed audio files, and embedding arrays on the filesystem."""

    def __init__(self, base_dir: Optional[Path] = None):
        self.base_dir = base_dir or settings.STORAGE_BASE_DIR
        self.raw_dir = self.base_dir / "raw"
        self.processed_dir = self.base_dir / "processed"
        self.embeddings_dir = self.base_dir / "embeddings"
        self.live_audio_dir = self.base_dir / "live_audio"
        self.live_embeddings_dir = self.base_dir / "live_embeddings"

        # Ensure directory structure exists
        self.raw_dir.mkdir(parents=True, exist_ok=True)
        self.processed_dir.mkdir(parents=True, exist_ok=True)
        self.embeddings_dir.mkdir(parents=True, exist_ok=True)
        self.live_audio_dir.mkdir(parents=True, exist_ok=True)
        self.live_embeddings_dir.mkdir(parents=True, exist_ok=True)

    def get_raw_path(self, analysis_id: str, original_filename: str) -> Path:
        """Returns the destination path for an uploaded raw audio file."""
        target_dir = self.raw_dir / analysis_id
        target_dir.mkdir(parents=True, exist_ok=True)
        # Sanitize filename
        safe_name = os.path.basename(original_filename).replace(" ", "_")
        return target_dir / safe_name

    def get_processed_path(self, analysis_id: str) -> Path:
        """Returns the canonical path for normalized mono 32kHz WAV audio."""
        target_dir = self.processed_dir / analysis_id
        target_dir.mkdir(parents=True, exist_ok=True)
        return target_dir / "audio_mono_32k.wav"

    def get_embedding_path(self, analysis_id: str) -> Path:
        """Returns the path for saved NumPy embedding array (.npy)."""
        target_dir = self.embeddings_dir / analysis_id
        target_dir.mkdir(parents=True, exist_ok=True)
        return target_dir / "embeddings.npy"

    async def save_upload_stream(
        self, stream: BinaryIO, target_path: Path, max_bytes: int
    ) -> int:
        """Saves a binary file stream in chunks, enforcing the max upload size limit."""
        target_path.parent.mkdir(parents=True, exist_ok=True)
        total_bytes = 0
        chunk_size = 1024 * 1024  # 1 MB

        with open(target_path, "wb") as f:
            while chunk := stream.read(chunk_size):
                total_bytes += len(chunk)
                if total_bytes > max_bytes:
                    # Clean up partial file
                    f.close()
                    if target_path.exists():
                        target_path.unlink()
                    raise ValueError(
                        f"Uploaded file exceeds maximum allowed size of {max_bytes} bytes."
                    )
                f.write(chunk)

        return total_bytes

    def save_embeddings(self, analysis_id: str, embeddings: np.ndarray) -> Path:
        """Saves a float NumPy array of embeddings to the embeddings directory."""
        vectors = np.asarray(embeddings)
        if vectors.ndim != 2 or vectors.shape[1] != 1280 or vectors.shape[0] == 0:
            raise ValueError(f"Expected embedding shape (N, 1280) with N > 0; got {vectors.shape}.")
        if vectors.dtype != np.float32 or not np.isfinite(vectors).all():
            raise ValueError("Embeddings must be finite float32 values.")
        path = self.get_embedding_path(analysis_id)
        with tempfile.NamedTemporaryFile(dir=path.parent, suffix=".npy", delete=False) as tmp:
            temp_path = Path(tmp.name)
        try:
            np.save(str(temp_path), vectors, allow_pickle=False)
            os.replace(temp_path, path)
        finally:
            temp_path.unlink(missing_ok=True)
        logger.info(
            "Saved embedding array of shape %s to %s",
            embeddings.shape,
            path,
        )
        return path

    def load_embeddings(self, analysis_id: str) -> Optional[np.ndarray]:
        """Loads saved embeddings array from disk if present."""
        path = self.get_embedding_path(analysis_id)
        if not path.exists():
            return None
        return np.load(str(path), allow_pickle=False)

    def delete_analysis_files(self, analysis_id: str) -> None:
        """Deletes raw audio, processed audio, and embeddings associated with an analysis."""
        for base in [self.raw_dir, self.processed_dir, self.embeddings_dir]:
            target = base / analysis_id
            if target.exists() and target.is_dir():
                shutil.rmtree(target, ignore_errors=True)
                logger.debug("Removed storage directory: %s", target)

    def get_live_audio_path(
        self, session_id: str, start_seconds: float, end_seconds: float
    ) -> Path:
        """Returns destination path for a 3-second live audio segment WAV."""
        target_dir = self.live_audio_dir / session_id
        target_dir.mkdir(parents=True, exist_ok=True)
        return target_dir / f"segment_{start_seconds:.1f}_{end_seconds:.1f}.wav"

    def save_live_audio_segment(
        self,
        session_id: str,
        start_seconds: float,
        end_seconds: float,
        samples: np.ndarray,
        sample_rate: int = 32000,
    ) -> Path:
        """Saves a normalized float32 or int16 numpy array as a 16-bit PCM WAV file."""
        import soundfile as sf

        path = self.get_live_audio_path(session_id, start_seconds, end_seconds)
        data = np.asarray(samples)
        if data.dtype != np.float32:
            data = data.astype(np.float32)

        with tempfile.NamedTemporaryFile(
            dir=path.parent, suffix=".wav", delete=False
        ) as tmp:
            temp_path = Path(tmp.name)
        try:
            sf.write(str(temp_path), data, sample_rate, subtype="PCM_16")
            os.replace(temp_path, path)
        finally:
            temp_path.unlink(missing_ok=True)
        return path

    def get_live_embedding_path(
        self, session_id: str, start_seconds: float, end_seconds: float
    ) -> Path:
        """Returns destination path for a live segment embedding array."""
        target_dir = self.live_embeddings_dir / session_id
        target_dir.mkdir(parents=True, exist_ok=True)
        return target_dir / f"segment_{start_seconds:.1f}_{end_seconds:.1f}.npy"

    def save_live_embedding(
        self,
        session_id: str,
        start_seconds: float,
        end_seconds: float,
        vector: np.ndarray,
    ) -> Path:
        """Validates and atomically saves a 1,280-dimensional embedding vector."""
        arr = np.asarray(vector, dtype=np.float32)
        if arr.ndim == 1:
            arr = arr.reshape(1, -1)
        if arr.ndim != 2 or arr.shape[1] != 1280 or arr.shape[0] == 0:
            raise ValueError(f"Expected embedding shape (1, 1280); got {arr.shape}.")
        if not np.isfinite(arr).all():
            raise ValueError("Live embedding contains NaN or infinite values.")

        path = self.get_live_embedding_path(session_id, start_seconds, end_seconds)
        with tempfile.NamedTemporaryFile(
            dir=path.parent, suffix=".npy", delete=False
        ) as tmp:
            temp_path = Path(tmp.name)
        try:
            np.save(str(temp_path), arr, allow_pickle=False)
            os.replace(temp_path, path)
        finally:
            temp_path.unlink(missing_ok=True)
        return path

    def delete_live_session_files(self, session_id: str) -> None:
        """Deletes all audio segments and embeddings associated with a live session."""
        for base in [self.live_audio_dir, self.live_embeddings_dir]:
            target = base / session_id
            if target.exists() and target.is_dir():
                shutil.rmtree(target, ignore_errors=True)
                logger.debug("Removed live session storage: %s", target)


storage_service = StorageService()
