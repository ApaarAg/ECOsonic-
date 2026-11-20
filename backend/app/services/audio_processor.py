import os
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import numpy as np
import soundfile as sf

from app.config import settings
from app.core.exceptions import AudioProcessingError, AudioValidationError
from app.core.logging import logger

try:
    import imageio_ffmpeg
    HAS_IMAGEIO_FFMPEG = True
except ImportError:
    HAS_IMAGEIO_FFMPEG = False


@dataclass
class AudioMetadata:
    """Detailed structural and acoustic metadata for an ingested audio file."""
    duration_seconds: float
    sample_rate: int
    channels: int
    format: str
    subtype: Optional[str] = None
    frames: int = 0
    file_size_bytes: int = 0
    is_mono: bool = False
    is_empty: bool = False
    rms_amplitude: float = 0.0


class AudioProcessor:
    """Production-grade audio ingestion, validation, inspection, and normalization service."""

    def __init__(self):
        self._ffmpeg_path = self._resolve_ffmpeg_path()
        # Add ffmpeg directory to PATH for external tools (e.g. audioread / librosa)
        ffmpeg_dir = os.path.dirname(self._ffmpeg_path)
        if ffmpeg_dir and ffmpeg_dir not in os.environ.get("PATH", ""):
            os.environ["PATH"] = ffmpeg_dir + os.pathsep + os.environ.get("PATH", "")
        logger.info("AudioProcessor initialized with FFmpeg at: %s", self._ffmpeg_path)

    @classmethod
    def _resolve_ffmpeg_path(cls) -> str:
        """Locates the FFmpeg binary via system PATH or imageio-ffmpeg."""
        system_ffmpeg = shutil.which("ffmpeg")
        if system_ffmpeg:
            return system_ffmpeg

        if HAS_IMAGEIO_FFMPEG:
            try:
                exe = imageio_ffmpeg.get_ffmpeg_exe()
                if exe and os.path.isfile(exe):
                    return exe
            except Exception as e:
                logger.warning("Failed to resolve imageio-ffmpeg binary: %s", e)

        return "ffmpeg"

    @property
    def ffmpeg_bin(self) -> str:
        return self._ffmpeg_path

    def validate_extension(self, filename: str) -> str:
        """Validates that the file has an allowed audio extension."""
        if not filename or "." not in filename:
            raise AudioValidationError(
                f"Invalid filename '{filename}'. File must have an extension."
            )
        ext = filename.rsplit(".", 1)[-1].lower()
        if ext not in settings.ALLOWED_AUDIO_EXTENSIONS:
            allowed = ", ".join(sorted(settings.ALLOWED_AUDIO_EXTENSIONS))
            raise AudioValidationError(
                f"Unsupported audio format '.{ext}'. Supported formats are: {allowed}"
            )
        return ext

    def validate_file_size(self, size_bytes: int) -> None:
        """Validates file size against empty files and maximum upload threshold."""
        if size_bytes <= 0:
            raise AudioValidationError("Uploaded file is empty (0 bytes).")
        if size_bytes > settings.MAX_UPLOAD_SIZE_BYTES:
            max_mb = settings.MAX_UPLOAD_SIZE_BYTES / (1024 * 1024)
            actual_mb = size_bytes / (1024 * 1024)
            raise AudioValidationError(
                f"File size ({actual_mb:.2f} MB) exceeds maximum allowed limit of {max_mb:.0f} MB."
            )

    def validate_mime_and_magic(self, file_path: Path, ext: str, mime_type: Optional[str] = None) -> None:
        """Validates file magic header bytes to guard against disguised or malicious uploads."""
        if not file_path.exists() or file_path.stat().st_size == 0:
            raise AudioValidationError("Audio file does not exist or is 0 bytes.")

        with open(file_path, "rb") as f:
            header = f.read(64)

        if len(header) < 4:
            raise AudioValidationError("Audio file is too small to contain a valid audio header.")

        ext = ext.lower()
        if ext == "wav":
            if not (header.startswith(b"RIFF") and b"WAVE" in header[:16]):
                raise AudioValidationError("File declared as WAV but lacks RIFF/WAVE header.")
        elif ext == "flac":
            if not header.startswith(b"fLaC"):
                raise AudioValidationError("File declared as FLAC but lacks fLaC header.")
        elif ext == "ogg":
            if not header.startswith(b"OggS"):
                raise AudioValidationError("File declared as OGG but lacks OggS header.")
        elif ext == "mp3":
            has_id3 = header.startswith(b"ID3")
            has_sync = any(header.startswith(sig) for sig in [b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"])
            if not (has_id3 or has_sync):
                # We will let FFmpeg integrity check determine if it's a valid raw MP3 stream
                pass
        elif ext == "m4a":
            if b"ftyp" not in header[:16]:
                # Handled during FFmpeg probe
                pass

    def inspect_audio(self, file_path: Path) -> AudioMetadata:
        """
        Deeply inspects an audio file for duration, channels, sample rate, and integrity.
        Handles WAV, FLAC, OGG, MP3, and M4A robustly.
        """
        file_size = file_path.stat().st_size
        self.validate_file_size(file_size)

        # First attempt inspection with SoundFile
        try:
            info = sf.info(str(file_path))
            duration = float(info.duration)
            channels = int(info.channels)
            sr = int(info.samplerate)
            fmt = info.format
            subtype = info.subtype
            frames = int(info.frames)

            if duration <= 0.0 or frames == 0:
                raise AudioValidationError(
                    f"Corrupted or empty audio file: duration is {duration:.2f} seconds."
                )

            rms = self._check_audio_activity(file_path, duration)
            is_empty = rms < 1e-7

            return AudioMetadata(
                duration_seconds=round(duration, 3),
                sample_rate=sr,
                channels=channels,
                format=fmt,
                subtype=subtype,
                frames=frames,
                file_size_bytes=file_size,
                is_mono=(channels == 1),
                is_empty=is_empty,
                rms_amplitude=round(float(rms), 6),
            )
        except (sf.LibsndfileError, RuntimeError):
            # Fallback to FFmpeg inspection
            return self._inspect_via_ffmpeg(file_path, file_size)

    def _inspect_via_ffmpeg(self, file_path: Path, file_size: int) -> AudioMetadata:
        """Inspects non-standard or compressed audio (MP3, OGG-Vorbis/Opus, M4A) via FFmpeg."""
        cmd = [
            self.ffmpeg_bin,
            "-i", str(file_path),
        ]
        try:
            result = subprocess.run(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                errors="replace",
                timeout=30,
            )
            output = result.stderr

            # Check for corruptions
            if "Invalid data found when processing input" in output:
                raise AudioValidationError("Audio file is corrupted or unreadable.")

            # Parse Duration
            dur_match = re.search(r"Duration:\s*(\d+):(\d+):(\d+\.?\d*)", output)
            if not dur_match:
                raise AudioValidationError(
                    "Unable to extract audio duration. File may be corrupted or not a valid audio stream."
                )

            h = float(dur_match.group(1))
            m = float(dur_match.group(2))
            s = float(dur_match.group(3))
            duration = h * 3600 + m * 60 + s

            if duration <= 0.0:
                raise AudioValidationError("Audio file duration is 0 seconds (empty audio).")

            # Parse Audio Stream Info
            audio_match = re.search(
                r"Stream.*Audio:\s*([a-zA-Z0-9_-]+),\s*(\d+)\s*Hz,\s*([^,]+)",
                output,
            )
            if not audio_match:
                raise AudioValidationError("No valid audio stream detected in file.")

            codec = audio_match.group(1)
            sr = int(audio_match.group(2))
            channel_str = audio_match.group(3).strip().lower()

            if "mono" in channel_str or "1 channels" in channel_str:
                channels = 1
            elif "stereo" in channel_str or "2 channels" in channel_str:
                channels = 2
            elif "5.1" in channel_str:
                channels = 6
            elif "7.1" in channel_str:
                channels = 8
            else:
                ch_digits = re.search(r"(\d+)", channel_str)
                channels = int(ch_digits.group(1)) if ch_digits else 2

            frames = int(duration * sr)
            is_empty = False

            return AudioMetadata(
                duration_seconds=round(duration, 3),
                sample_rate=sr,
                channels=channels,
                format=codec.upper(),
                subtype=None,
                frames=frames,
                file_size_bytes=file_size,
                is_mono=(channels == 1),
                is_empty=is_empty,
                rms_amplitude=0.01,
            )
        except subprocess.TimeoutExpired:
            raise AudioProcessingError("Audio validation timed out during FFmpeg check.")
        except Exception as e:
            if isinstance(e, (AudioValidationError, AudioProcessingError)):
                raise
            raise AudioValidationError(f"Audio inspection failed: {e}")

    def _check_audio_activity(self, file_path: Path, duration: float) -> float:
        """Reads a small segment of the audio to compute RMS and detect silent/empty audio."""
        try:
            read_duration = min(duration, 3.0)
            data, _ = sf.read(str(file_path), frames=int(read_duration * 48000), always_2d=True)
            if len(data) == 0:
                return 0.0
            rms = np.sqrt(np.mean(data**2))
            return float(rms)
        except Exception:
            return 0.01

    def convert_to_mono_wav(
        self,
        input_path: Path,
        output_path: Path,
        target_sr: int = 48000,
    ) -> AudioMetadata:
        """
        Converts any supported audio format into a standardized, clean 16-bit PCM Mono WAV file
        resampled to target_sr (default 48000 Hz, required by EcoSonic & BirdNET+).
        """
        if not input_path.exists():
            raise AudioProcessingError(f"Input file not found at: {input_path}")

        output_path.parent.mkdir(parents=True, exist_ok=True)

        cmd = [
            self.ffmpeg_bin,
            "-y",
            "-v", "error",
            "-i", str(input_path),
            "-vn",
            "-ac", "1",
            "-ar", str(target_sr),
            "-c:a", "pcm_s16le",
            str(output_path),
        ]

        logger.info("Executing audio conversion via FFmpeg: %s -> %s", input_path.name, output_path.name)
        try:
            result = subprocess.run(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=180,
            )
            if result.returncode != 0:
                err_msg = result.stderr.decode("utf-8", errors="replace").strip()
                raise AudioProcessingError(f"FFmpeg conversion failed: {err_msg}")
        except subprocess.TimeoutExpired:
            raise AudioProcessingError("Audio conversion timed out after 180 seconds.")
        except Exception as e:
            if isinstance(e, AudioProcessingError):
                raise
            raise AudioProcessingError(f"Unexpected error during audio conversion: {e}")

        if not output_path.exists() or output_path.stat().st_size == 0:
            raise AudioProcessingError("Processed audio file was not generated or is empty.")

        processed_meta = self.inspect_audio(output_path)
        logger.info(
            "Normalized audio ready: duration=%.2fs, sr=%d, channels=%d, size=%d bytes",
            processed_meta.duration_seconds,
            processed_meta.sample_rate,
            processed_meta.channels,
            processed_meta.file_size_bytes,
        )
        return processed_meta


audio_processor = AudioProcessor()
