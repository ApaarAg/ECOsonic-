"""Reproducible memory, latency, and CPU benchmark for the ECOsonic backend."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import psutil
import websockets

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_DIR.parent
DEFAULT_MODEL_CACHE = REPO_ROOT / ".model_cache"
SMOKE_1 = BACKEND_DIR / "data" / "smoke_audio" / "birds_forest.ogg"
SMOKE_2 = BACKEND_DIR / "data" / "smoke_audio" / "birds_garden.ogg"


def _mb(n_bytes: int) -> float:
    return round(n_bytes / (1024 * 1024), 2)


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _snapshot_tree(pid: int) -> dict:
    proc = psutil.Process(pid)
    p_mem = proc.memory_info()
    parent_rss = _mb(p_mem.rss)
    parent_peak = _mb(getattr(p_mem, "peak_wset", p_mem.rss))
    children = []
    for ch in proc.children(recursive=True):
        try:
            cm = ch.memory_info()
            children.append({
                "pid": ch.pid,
                "name": ch.name(),
                "rss_mb": _mb(cm.rss),
                "peak_rss_mb": _mb(getattr(cm, "peak_wset", cm.rss)),
            })
        except psutil.Error:
            pass
    c_rss = round(sum(c["rss_mb"] for c in children), 2)
    c_peak = round(sum(c["peak_rss_mb"] for c in children), 2)
    return {
        "parent_rss_mb": parent_rss,
        "children_rss_mb": c_rss,
        "process_tree_rss_mb": round(parent_rss + c_rss, 2),
        "peak_rss_mb": round(parent_peak + c_peak, 2),
        "children": children,
    }


class _TreeMonitor:
    def __init__(self, pid: int) -> None:
        self.pid = pid
        self._procs: dict[int, psutil.Process] = {}
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self.peak_tree_rss_mb = 0.0
        self.cpu_samples: list[float] = []

    def _get_proc(self, pid: int) -> psutil.Process | None:
        p = self._procs.get(pid)
        if p is None:
            try:
                p = psutil.Process(pid)
                p.cpu_percent(interval=None)
                self._procs[pid] = p
            except psutil.Error:
                return None
        return p

    def _sample(self) -> None:
        root = self._get_proc(self.pid)
        if root is None:
            return
        try:
            tot_rss = _mb(root.memory_info().rss)
            tot_cpu = root.cpu_percent(interval=None)
            for ch in root.children(recursive=True):
                cp = self._get_proc(ch.pid)
                if cp is None:
                    continue
                try:
                    tot_rss += _mb(cp.memory_info().rss)
                    tot_cpu += cp.cpu_percent(interval=None)
                except psutil.Error:
                    pass
            self.peak_tree_rss_mb = max(self.peak_tree_rss_mb, round(tot_rss, 2))
            self.cpu_samples.append(round(tot_cpu, 2))
        except psutil.Error:
            pass

    def start(self) -> None:
        self.peak_tree_rss_mb = 0.0
        self.cpu_samples = []
        self._stop.clear()
        self._sample()
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def _loop(self) -> None:
        while not self._stop.wait(0.1):
            self._sample()

    def stop(self) -> dict:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=1.0)
        self._sample()
        avg_cpu = round(sum(self.cpu_samples) / len(self.cpu_samples), 2) if self.cpu_samples else 0.0
        peak_cpu = round(max(self.cpu_samples), 2) if self.cpu_samples else 0.0
        return {
            "sampled_peak_tree_rss_mb": self.peak_tree_rss_mb,
            "avg_cpu_percent": avg_cpu,
            "peak_cpu_percent": peak_cpu,
        }


def _http_json(method: str, url: str, body: dict | None = None, timeout: float = 120.0):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Content-Type": "application/json"} if body is not None else {}
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.status, json.loads(resp.read().decode("utf-8"))


def _upload(base_url: str, audio_path: Path) -> tuple[str, float]:
    boundary = f"----EcoSonicBench{uuid.uuid4().hex}"
    payload = b"".join([
        (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="{audio_path.name}"\r\n'
            f"Content-Type: audio/ogg\r\n\r\n"
        ).encode("utf-8"),
        audio_path.read_bytes(),
        f"\r\n--{boundary}--\r\n".encode("utf-8"),
    ])
    req = urllib.request.Request(
        f"{base_url}/api/v1/analyses",
        data=payload,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=120.0) as resp:
        aid = json.loads(resp.read().decode("utf-8"))["id"]
    while True:
        _, body = _http_json("GET", f"{base_url}/api/v1/analyses/{aid}")
        if body["status"] in ("completed", "failed"):
            return body["status"], round(time.perf_counter() - t0, 3)
        time.sleep(0.1)


async def _run_live_ws(base_url: str, ws_base_url: str, concurrent_upload: Path | None = None) -> dict:
    _, sess = _http_json(
        "POST",
        f"{base_url}/api/v1/live/sessions",
        body={"source_type": "browser_mic", "sample_rate": 32000, "channels": 1},
    )
    sid = sess["id"]
    t = np.linspace(0, 3.0, 96000, endpoint=False, dtype=np.float32)
    pcm = (np.sin(2.0 * np.pi * 2000.0 * t) * 12000.0).astype("<i2")

    up_result: dict = {}
    up_thread: threading.Thread | None = None
    if concurrent_upload is not None:
        def _bg():
            st, dt = _upload(base_url, concurrent_upload)
            up_result["status"] = st
            up_result["duration_s"] = dt
        up_thread = threading.Thread(target=_bg, daemon=True)

    async with websockets.connect(
        f"{ws_base_url}/api/v1/live/sessions/{sid}/stream",
        origin="http://localhost:3000",
    ) as ws:
        await asyncio.wait_for(ws.recv(), timeout=10.0)
        await asyncio.wait_for(ws.recv(), timeout=10.0)
        if up_thread is not None:
            up_thread.start()
        for seq in range(12):
            await ws.send(struct.pack(">I", seq) + pcm[seq * 8000 : (seq + 1) * 8000].tobytes())
        while True:
            evt = json.loads(await asyncio.wait_for(ws.recv(), timeout=20.0))
            if evt.get("type") == "processing_update":
                break
        await ws.send(json.dumps({"type": "stop"}))
        while True:
            evt = json.loads(await asyncio.wait_for(ws.recv(), timeout=20.0))
            if evt.get("type") == "session_stopped":
                break

    if up_thread is not None:
        up_thread.join(timeout=60.0)
    return {"upload": up_result} if up_result else {}


def run_benchmark(repeat_uploads: int = 5, output_path: Path | None = None) -> dict:
    tmp_dir = Path(tempfile.mkdtemp(prefix="ecosonic_bench_"))
    storage_dir = tmp_dir / "storage"
    storage_dir.mkdir(parents=True, exist_ok=True)
    db_path = tmp_dir / "bench.db"

    env = os.environ.copy()
    env.update({
        "ENVIRONMENT": "production",
        "MODEL_PREFER_GPU": "false",
        "BIRDNET_APP_DATA": str(DEFAULT_MODEL_CACHE),
        "STORAGE_BASE_DIR": str(storage_dir),
        "DATABASE_URL": f"sqlite+aiosqlite:///{db_path.as_posix()}",
        "ALLOWED_ORIGINS": "http://localhost:3000",
        "PYTHONUNBUFFERED": "1",
    })

    completed_jobs = 0
    failed_jobs = 0
    stages: dict = {}

    try:
        # 1. Fresh process import
        imp_out = subprocess.check_output(
            [
                sys.executable,
                "-c",
                "import json, time, psutil; p=psutil.Process(); t0=time.perf_counter(); "
                "from app.main import app; dt=round(time.perf_counter()-t0, 3); "
                "print(json.dumps({'duration_s': dt, 'rss_mb': round(p.memory_info().rss/1048576, 2)}))",
            ],
            cwd=str(BACKEND_DIR),
            env=env,
            text=True,
        )
        stages["1_fresh_process_import"] = json.loads(imp_out.strip().splitlines()[-1])

        port = _free_port()
        base_url = f"http://127.0.0.1:{port}"
        ws_url = f"ws://127.0.0.1:{port}"
        log_path = tmp_dir / "uvicorn.log"
        log_fh = open(log_path, "w", encoding="utf-8", errors="replace")
        proc = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(port), "--workers", "1"],
            cwd=str(BACKEND_DIR),
            env=env,
            stdout=log_fh,
            stderr=subprocess.STDOUT,
            text=True,
        )
        try:
            mon = _TreeMonitor(proc.pid)
            mon.start()
            t0 = time.perf_counter()
            while True:
                if proc.poll() is not None:
                    log_fh.flush()
                    raise RuntimeError(log_path.read_text(encoding="utf-8", errors="replace"))
                try:
                    code, _ = _http_json("GET", f"{base_url}/ready", timeout=2.0)
                    if code == 200:
                        break
                except Exception:
                    pass
                if time.perf_counter() - t0 > 120:
                    raise TimeoutError("Timed out waiting for /ready")
                time.sleep(0.2)
            ready_dur = round(time.perf_counter() - t0, 3)
            stages["2_model_loaded_and_ready"] = {"duration_s": ready_dur, **mon.stop(), **_snapshot_tree(proc.pid)}

            # 3. First upload
            mon.start()
            st1, dt1 = _upload(base_url, SMOKE_1)
            completed_jobs += int(st1 == "completed")
            failed_jobs += int(st1 != "completed")
            stages["3_first_upload"] = {"status": st1, "duration_s": dt1, **mon.stop(), **_snapshot_tree(proc.pid)}

            # 4. Subsequent upload
            mon.start()
            st2, dt2 = _upload(base_url, SMOKE_2)
            completed_jobs += int(st2 == "completed")
            failed_jobs += int(st2 != "completed")
            stages["4_subsequent_upload"] = {"status": st2, "duration_s": dt2, **mon.stop(), **_snapshot_tree(proc.pid)}

            # 5. Active live WebSocket
            mon.start()
            t_ws = time.perf_counter()
            asyncio.run(_run_live_ws(base_url, ws_url, concurrent_upload=None))
            stages["5_active_live_ws"] = {
                "duration_s": round(time.perf_counter() - t_ws, 3),
                **mon.stop(),
                **_snapshot_tree(proc.pid),
            }

            # 6. Active live WebSocket plus upload
            mon.start()
            t_wsu = time.perf_counter()
            ws_up = asyncio.run(_run_live_ws(base_url, ws_url, concurrent_upload=SMOKE_1))
            up_st = ws_up.get("upload", {}).get("status")
            completed_jobs += int(up_st == "completed")
            failed_jobs += int(up_st != "completed")
            stages["6_live_ws_plus_upload"] = {
                "duration_s": round(time.perf_counter() - t_wsu, 3),
                **ws_up,
                **mon.stop(),
                **_snapshot_tree(proc.pid),
            }

            # 7. Repeated upload workload
            mon.start()
            t_rep = time.perf_counter()
            rep_statuses = []
            for _ in range(repeat_uploads):
                st, _ = _upload(base_url, SMOKE_1)
                rep_statuses.append(st)
                completed_jobs += int(st == "completed")
                failed_jobs += int(st != "completed")
            stages["7_repeated_uploads"] = {
                "count": repeat_uploads,
                "statuses": rep_statuses,
                "duration_s": round(time.perf_counter() - t_rep, 3),
                **mon.stop(),
                **_snapshot_tree(proc.pid),
            }
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
            log_fh.close()
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

    report = {
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "python": sys.version,
        "completed_jobs": completed_jobs,
        "failed_jobs": failed_jobs,
        "stages": stages,
    }
    if output_path is not None:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description="Reproducible ECOsonic memory & latency benchmark.")
    parser.add_argument("--repeat-uploads", type=int, default=5)
    parser.add_argument("--output", type=Path, default=None)
    args = parser.parse_args()
    res = run_benchmark(repeat_uploads=args.repeat_uploads, output_path=args.output)
    print(json.dumps(res, indent=2))


if __name__ == "__main__":
    main()
