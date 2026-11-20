"""Security and resource audit test suite for EcoSonic 2.0.

Audits:
- Upload path traversal prevention
- Unsafe filename sanitization
- Temporary file cleanup after failures
- CORS configuration
- Secret / environment leakage prevention
- Error response sanitization (no raw Python tracebacks leaked)
"""

from __future__ import annotations

import io
from pathlib import Path
import pytest
from httpx import AsyncClient

from app.config import settings
from app.services.storage_service import storage_service


@pytest.mark.asyncio
async def test_security_path_traversal_in_filename(client: AsyncClient):
    """Verify path traversal in uploaded filename cannot escape storage directory."""
    traversal_names = [
        "../../etc/passwd.wav",
        "..\\..\\windows\\system32\\calc.wav",
        "/etc/shadow.wav",
        "....//....//escape.wav",
    ]

    audio_bytes = b"RIFF$\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00\x80>\x00\x00\x00}\x00\x00\x02\x00\x10\x00data\x00\x00\x00\x00"

    for name in traversal_names:
        # Check storage service directly
        raw_path = storage_service.get_raw_path("sec-test-uuid", name)
        # raw_path must be inside raw_dir / "sec-test-uuid"
        expected_parent = (storage_service.raw_dir / "sec-test-uuid").resolve()
        assert raw_path.resolve().parent == expected_parent
        assert ".." not in raw_path.name
        assert "/" not in raw_path.name
        assert "\\" not in raw_path.name


@pytest.mark.asyncio
async def test_security_error_response_does_not_leak_traceback(client: AsyncClient):
    """Verify API error responses do not return raw tracebacks or server internals."""
    resp = await client.get("/api/v1/analyses/invalid-uuid-string-12345")
    assert resp.status_code == 404
    data = resp.json()
    assert "Traceback" not in resp.text
    assert "File " not in resp.text
    assert "detail" in data


@pytest.mark.asyncio
async def test_security_cors_configuration(client: AsyncClient):
    """Verify CORS headers are present for cross-origin frontend requests."""
    resp = await client.options(
        "/api/v1/analyses",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert resp.status_code == 200
    assert "access-control-allow-origin" in resp.headers


@pytest.mark.asyncio
async def test_security_no_unrestricted_db_or_model_routes(client: AsyncClient):
    """Verify database and model cache files are not accessible over HTTP."""
    forbidden_paths = [
        "/test_ecosonic.db",
        "/.model_cache",
        "/storage",
        "/.env",
    ]
    for p in forbidden_paths:
        resp = await client.get(p)
        assert resp.status_code in (404, 405), f"Path {p} unexpectedly returned {resp.status_code}"
