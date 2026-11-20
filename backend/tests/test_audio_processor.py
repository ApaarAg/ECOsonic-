import tempfile
from pathlib import Path
import numpy as np
import pytest
import soundfile as sf

from app.core.exceptions import AudioProcessingError, AudioValidationError
from app.services.audio_processor import audio_processor


def test_extension_validation():
    # Valid formats
    assert audio_processor.validate_extension("test.wav") == "wav"
    assert audio_processor.validate_extension("recording.MP3") == "mp3"
    assert audio_processor.validate_extension("audio.FLAC") == "flac"
    assert audio_processor.validate_extension("field.ogg") == "ogg"
    assert audio_processor.validate_extension("call.m4a") == "m4a"

    # Invalid formats
    with pytest.raises(AudioValidationError):
        audio_processor.validate_extension("script.py")

    with pytest.raises(AudioValidationError):
        audio_processor.validate_extension("video.mp4")

    with pytest.raises(AudioValidationError):
        audio_processor.validate_extension("no_extension")


def test_file_size_validation():
    # 0 bytes error
    with pytest.raises(AudioValidationError, match="0 bytes"):
        audio_processor.validate_file_size(0)

    # Exceeds max upload limit
    with pytest.raises(AudioValidationError, match="exceeds maximum"):
        audio_processor.validate_file_size(300 * 1024 * 1024)

    # Valid size
    audio_processor.validate_file_size(5 * 1024 * 1024)


def test_corrupted_file_detection():
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        f.write(b"NOT_A_VALID_WAV_HEADER_RANDOM_GARBAGE_BYTES")
        temp_path = Path(f.name)

    try:
        with pytest.raises(AudioValidationError):
            audio_processor.validate_mime_and_magic(temp_path, "wav")
    finally:
        if temp_path.exists():
            temp_path.unlink()


def test_smoke_audio_inspection():
    smoke_file = Path(__file__).resolve().parents[1] / "data" / "smoke_audio" / "cicada_orni.ogg"

    assert smoke_file.exists(), "Smoke audio file not found"

    meta = audio_processor.inspect_audio(smoke_file)
    assert meta.duration_seconds > 5.0
    assert meta.sample_rate > 0
    assert meta.channels in [1, 2]
    assert not meta.is_empty


def test_stereo_to_mono_conversion():
    smoke_file = Path("backend/data/smoke_audio/cicada_orni.ogg")
    if not smoke_file.exists():
        smoke_file = Path("data/smoke_audio/cicada_orni.ogg")

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        out_wav = Path(f.name)

    try:
        meta = audio_processor.convert_to_mono_wav(smoke_file, out_wav, target_sr=48000)
        assert out_wav.exists()
        assert meta.sample_rate == 48000
        assert meta.channels == 1
        assert meta.is_mono is True
        assert meta.duration_seconds > 20.0

        # Verify through SoundFile independently
        sf_info = sf.info(str(out_wav))
        assert sf_info.samplerate == 48000
        assert sf_info.channels == 1
        assert sf_info.subtype == "PCM_16"
    finally:
        if out_wav.exists():
            out_wav.unlink()
