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

        # Ensure directory structure exists
        self.raw_dir.mkdir(parents=True, exist_ok=True)
        self.processed_dir.mkdir(parents=True, exist_ok=True)
        self.embeddings_dir.mkdir(parents=True, exist_ok=True)

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


storage_service = StorageService()
