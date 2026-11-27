"""Pre-download and verify BirdNET+ V3.0 acoustic & geo ONNX models into BIRDNET_APP_DATA."""

from __future__ import annotations

import hashlib
import os
import sys
from pathlib import Path

import birdnet


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    app_data = Path(os.environ.get("BIRDNET_APP_DATA", "/app/model_cache")).resolve()
    app_data.mkdir(parents=True, exist_ok=True)
    os.environ["BIRDNET_APP_DATA"] = str(app_data)

    print(f"[model-bootstrap] Provisioning BirdNET V3.0 ONNX models into: {app_data}")

    acoustic_model = birdnet.load("acoustic", "3.0", "onnx", precision="fp32")
    geo_model = birdnet.load("geo", "3.0", "onnx")

    acoustic_files = list((app_data / "acoustic-models" / "v3.0" / "onnx").glob("model-fp32*.onnx"))
    geo_files = list((app_data / "geo-models" / "v3.0" / "onnx").glob("model-fp32*.onnx"))

    if not acoustic_files or acoustic_files[0].stat().st_size < 100_000_000:
        print("[model-bootstrap] ERROR: Acoustic ONNX model missing or incomplete.", file=sys.stderr)
        return 1
    if not geo_files or geo_files[0].stat().st_size < 5_000_000:
        print("[model-bootstrap] ERROR: Geo ONNX model missing or incomplete.", file=sys.stderr)
        return 1

    print(
        f"[model-bootstrap] Acoustic model OK: {acoustic_files[0].name} "
        f"({acoustic_files[0].stat().st_size} bytes, sha256={_sha256(acoustic_files[0])}, "
        f"species={len(acoustic_model.species_list)})"
    )
    print(
        f"[model-bootstrap] Geo model OK: {geo_files[0].name} "
        f"({geo_files[0].stat().st_size} bytes, sha256={_sha256(geo_files[0])}, "
        f"species={geo_model.n_species})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
