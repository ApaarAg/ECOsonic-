"""Live microphone and audio replay streaming test client for EcoSonic 3.0."""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import math
import os
import signal
import struct
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
import scipy.signal
import sounddevice as sd
import soundfile as sf
import urllib.request
import websockets

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("EcoSonicClient")

TARGET_SAMPLE_RATE = 32000
CHUNK_DURATION_S = 0.25  # 250ms chunks (8,000 samples @ 32 kHz = 16,000 bytes)
TARGET_CHUNK_SAMPLES = int(TARGET_SAMPLE_RATE * CHUNK_DURATION_S)


def list_audio_devices() -> None:
    """Print available host audio input devices."""
    devices = sd.query_devices()
    print("\n=== AVAILABLE AUDIO INPUT DEVICES ===")
    for i, dev in enumerate(devices):
        if dev["max_input_channels"] > 0:
            default_marker = " [DEFAULT INPUT]" if i == sd.default.device[0] else ""
            print(
                f"  [{i:2d}] {dev['name']} "
                f"(In: {dev['max_input_channels']}, Default SR: {dev['default_samplerate']} Hz){default_marker}"
            )
    print("=====================================\n")


def create_session_http(
    base_url: str,
    source_type: str = "desktop_mic",
    device_id: Optional[str] = None,
) -> str:
    """Create a live session record via the REST API and return its UUID."""
    endpoint = f"{base_url.rstrip('/')}/api/v1/live/sessions"
    payload = json.dumps(
        {
            "source_type": source_type,
            "device_id": device_id or "default_microphone",
            "sample_rate": TARGET_SAMPLE_RATE,
            "channels": 1,
        }
    ).encode("utf-8")

    req = urllib.request.Request(
        endpoint,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10.0) as resp:
        data = json.loads(resp.read().decode("utf-8"))
        return data["id"]


def get_session_summary_http(base_url: str, session_id: str) -> Dict[str, Any]:
    """Fetch final session statistics from the REST API."""
    endpoint = f"{base_url.rstrip('/')}/api/v1/live/sessions/{session_id}"
    req = urllib.request.Request(endpoint, method="GET")
    with urllib.request.urlopen(req, timeout=10.0) as resp:
        return json.loads(resp.read().decode("utf-8"))


class AudioStreamer:
    """Captures from physical microphone or replays audio file, and streams via WebSocket."""

    def __init__(
        self,
        ws_url: str,
        session_id: str,
        device_index: Optional[int] = None,
        file_path: Optional[Path] = None,
        speed: float = 1.0,
        max_duration_s: Optional[float] = None,
        loop_file: bool = False,
    ) -> None:
        self.ws_url = ws_url
        self.session_id = session_id
        self.device_index = device_index
        self.file_path = file_path
        self.speed = max(0.1, speed)
        self.max_duration_s = max_duration_s
        self.loop_file = loop_file

        self.audio_queue: asyncio.Queue[bytes] = asyncio.Queue(maxsize=100)
        self.running = False
        self.seq_num = 0
        self.total_bytes_sent = 0
        self.total_samples_sent = 0
        self.detections_received: List[Dict[str, Any]] = []
        self.warnings_received: List[Dict[str, Any]] = []
        self.stream_start_time = 0.0

    def _render_level_meter(self, rms: float) -> str:
        db = 20 * math.log10(max(rms, 1e-7))
        # Map -60 dB .. 0 dB to 20 blocks
        bars = int(max(0, min(20, (db + 60) / 3)))
        meter = "#" * bars + "-" * (20 - bars)
        return f"[{meter}] {db:6.1f} dB"

    def _mic_callback(self, indata: np.ndarray, frames: int, time_info: Any, status: Any) -> None:
        if status:
            logger.warning("Microphone stream status: %s", status)

        # 1. Convert to mono
        if indata.ndim > 1 and indata.shape[1] > 1:
            mono = np.mean(indata, axis=1)
        else:
            mono = indata.flatten()

        # 2. Resample if hardware rate != 32,000 Hz
        hw_sr = self.hw_sample_rate
        if hw_sr != TARGET_SAMPLE_RATE:
            gcd = math.gcd(int(hw_sr), TARGET_SAMPLE_RATE)
            up = TARGET_SAMPLE_RATE // gcd
            down = int(hw_sr) // gcd
            resampled = scipy.signal.resample_poly(mono, up, down).astype(np.float32)
        else:
            resampled = mono.astype(np.float32)

        # 3. Audio level analysis
        rms = float(np.sqrt(np.mean(resampled**2)))
        self.current_meter_str = self._render_level_meter(rms)

        # 4. Convert to PCM16 little-endian
        pcm16 = (np.clip(resampled, -1.0, 1.0) * 32767.0).astype("<i2").tobytes()

        # 5. Push to queue
        try:
            self.loop.call_soon_threadsafe(self.audio_queue.put_nowait, pcm16)
        except asyncio.QueueFull:
            logger.warning("Audio queue full; dropped microphone frame.")

    async def _producer_file(self) -> None:
        """Stream an environmental recording at paced rate."""
        logger.info("Starting file replay from %s (speed=%.1fx)", self.file_path, self.speed)
        data, sr = sf.read(str(self.file_path), dtype="float32")

        # Convert to mono
        if data.ndim > 1:
            mono = np.mean(data, axis=1)
        else:
            mono = data

        # Resample to 32 kHz
        if sr != TARGET_SAMPLE_RATE:
            gcd = math.gcd(sr, TARGET_SAMPLE_RATE)
            mono = scipy.signal.resample_poly(mono, TARGET_SAMPLE_RATE // gcd, sr // gcd).astype(
                np.float32
            )

        total_samples = len(mono)
        pos = 0
        chunk_samples = TARGET_CHUNK_SAMPLES

        delay_s = CHUNK_DURATION_S / self.speed

        while self.running and (self.loop_file or pos < total_samples):
            if pos >= total_samples:
                pos = 0
            t_chunk_start = time.perf_counter()
            end = min(pos + chunk_samples, total_samples)
            chunk = mono[pos:end]
            if len(chunk) < chunk_samples:
                # Pad last chunk with zeros if needed
                pad = np.zeros(chunk_samples - len(chunk), dtype=np.float32)
                chunk = np.concatenate([chunk, pad])

            rms = float(np.sqrt(np.mean(chunk**2)))
            self.current_meter_str = self._render_level_meter(rms)

            pcm16 = (np.clip(chunk, -1.0, 1.0) * 32767.0).astype("<i2").tobytes()
            await self.audio_queue.put(pcm16)

            pos += chunk_samples
            elapsed = time.perf_counter() - t_chunk_start
            wait_time = max(0.0, delay_s - elapsed)
            if wait_time > 0:
                await asyncio.sleep(wait_time)

        logger.info("File replay complete (%d total audio samples sent).", total_samples)
        if self.max_duration_s is None:
            # Allow time for model inference on trailing windows
            await asyncio.sleep(4.0)
            self.running = False

    async def _receiver_loop(self, ws: websockets.WebSocketClientProtocol) -> None:
        """Receive and log server-generated detection events and warnings."""
        async for message in ws:
            try:
                event = json.loads(message)
                etype = event.get("type")

                if etype == "detection":
                    self.detections_received.append(event)
                    print(
                        f"\n>>> [DETECTION] [{event['start_seconds']:5.1f}s - {event['end_seconds']:5.1f}s] "
                        f"{event.get('common_name') or event['class_label']} "
                        f"({event.get('scientific_name', '')}) "
                        f"| Score: {event['confidence_score']:.4f} | Taxon: {event.get('taxon_group', 'Bird')}"
                    )
                elif etype == "processing_update":
                    sys.stdout.write(
                        f"\r[STATUS] Processed: {event['processed_seconds']:5.1f}s | "
                        f"Infer: {event['inference_duration_ms']:5.1f}ms | "
                        f"Lag: {event['window_lag_ms']:5.1f}ms | "
                        f"Queue: {event['queue_size']} | {getattr(self, 'current_meter_str', '')}"
                    )
                    sys.stdout.flush()
                elif etype in ("audio_quality_warning", "backpressure_warning"):
                    self.warnings_received.append(event)
                    print(f"\n[!] [{etype.upper()}]: {event.get('reason') or event}")
                elif etype == "session_stopped":
                    logger.info("Session stop acknowledged by server.")
                    self.running = False
                    break
                elif etype == "inference_error":
                    logger.error("Inference error: %s", event.get("error"))
            except Exception as exc:
                logger.error("Error processing server message: %s", exc)

    async def _sender_loop(self, ws: websockets.WebSocketClientProtocol) -> None:
        """Send framed binary audio chunks over WebSocket."""
        while self.running:
            try:
                pcm_bytes = await asyncio.wait_for(self.audio_queue.get(), timeout=1.0)
            except asyncio.TimeoutError:
                continue

            # Frame header: 4-byte big-endian uint32 sequence number
            header = struct.pack(">I", self.seq_num)
            frame = header + pcm_bytes
            await ws.send(frame)

            self.seq_num += 1
            self.total_bytes_sent += len(pcm_bytes)
            self.total_samples_sent += len(pcm_bytes) // 2

            # Check max duration
            if (
                self.max_duration_s
                and (time.perf_counter() - self.stream_start_time) >= self.max_duration_s
            ):
                logger.info(
                    "Reached target duration of %.1fs. Stopping stream...",
                    self.max_duration_s,
                )
                self.running = False
                break

    async def run(self) -> None:
        self.loop = asyncio.get_running_loop()
        self.running = True
        self.stream_start_time = time.perf_counter()

        logger.info("Connecting to WebSocket: %s", self.ws_url)
        async with websockets.connect(self.ws_url, max_size=2 * 1024 * 1024) as ws:
            logger.info("Connected! Ingesting live audio to session %s...", self.session_id)

            producer_task: Optional[asyncio.Task] = None
            stream: Optional[sd.InputStream] = None

            if self.file_path:
                producer_task = asyncio.create_task(self._producer_file())
            else:
                # Physical microphone capture
                dev_info = sd.query_devices(self.device_index, "input")
                self.hw_sample_rate = int(dev_info["default_samplerate"])
                logger.info(
                    "Capturing from '%s' at hardware rate %d Hz (resampling to %d Hz)",
                    dev_info["name"],
                    self.hw_sample_rate,
                    TARGET_SAMPLE_RATE,
                )
                hw_chunk_samples = int(self.hw_sample_rate * CHUNK_DURATION_S)
                stream = sd.InputStream(
                    device=self.device_index,
                    channels=min(2, int(dev_info["max_input_channels"])),
                    samplerate=self.hw_sample_rate,
                    blocksize=hw_chunk_samples,
                    dtype="float32",
                    callback=self._mic_callback,
                )
                stream.start()

            sender_task = asyncio.create_task(self._sender_loop(ws))
            receiver_task = asyncio.create_task(self._receiver_loop(ws))

            try:
                # Wait while running
                while self.running:
                    await asyncio.sleep(0.2)
            except asyncio.CancelledError:
                pass
            finally:
                self.running = False
                if stream:
                    stream.stop()
                    stream.close()
                if producer_task:
                    producer_task.cancel()

                # Send graceful stop message to server
                try:
                    await ws.send(json.dumps({"type": "stop"}))
                    await asyncio.sleep(1.0)
                except Exception:
                    pass

                sender_task.cancel()
                receiver_task.cancel()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="EcoSonic 3.0 Live Bioacoustic Intelligence Streaming Client"
    )
    parser.add_argument(
        "--list-devices", action="store_true", help="List audio input devices and exit"
    )
    parser.add_argument(
        "--device", type=int, default=None, help="Input device index for physical microphone"
    )
    parser.add_argument(
        "--server", type=str, default="http://127.0.0.1:8000", help="EcoSonic backend server URL"
    )
    parser.add_argument(
        "--session-id", type=str, default=None, help="Existing session UUID (creates new if omitted)"
    )
    parser.add_argument(
        "--file", type=str, default=None, help="Path to audio file for replay mode"
    )
    parser.add_argument(
        "--speed", type=float, default=1.0, help="Replay speed multiplier (default: 1.0)"
    )
    parser.add_argument(
        "--duration", type=float, default=None, help="Duration to stream in seconds"
    )
    parser.add_argument(
        "--loop", action="store_true", help="Loop audio file continuously for duration tests"
    )

    args = parser.parse_args()

    if args.list_devices:
        list_audio_devices()
        return

    base_url = args.server.rstrip("/")
    ws_base = base_url.replace("http://", "ws://").replace("https://", "wss://")

    # Determine session ID
    session_id = args.session_id
    if not session_id:
        src_type = "file_replay" if args.file else "desktop_mic"
        session_id = create_session_http(base_url, source_type=src_type)
        logger.info("Created new live session: %s", session_id)

    ws_url = f"{ws_base}/api/v1/live/sessions/{session_id}/stream"

    file_p = Path(args.file) if args.file else None
    if file_p and not file_p.exists():
        logger.error("Audio replay file does not exist: %s", file_p)
        sys.exit(1)

    client = AudioStreamer(
        ws_url=ws_url,
        session_id=session_id,
        device_index=args.device,
        file_path=file_p,
        speed=args.speed,
        max_duration_s=args.duration,
        loop_file=args.loop,
    )

    def handle_sigint(*_: Any) -> None:
        print("\n[Ctrl+C] Stopping stream gracefully...")
        client.running = False

    signal.signal(signal.SIGINT, handle_sigint)

    try:
        asyncio.run(client.run())
    except KeyboardInterrupt:
        pass

    # Print summary report from server
    try:
        summary = get_session_summary_http(base_url, session_id)
        stats = summary.get("stats") or {}
        print("\n" + "=" * 60)
        print("          LIVE STREAMING SESSION SUMMARY")
        print("=" * 60)
        print(f"Session ID:              {session_id}")
        print(f"Status:                  {summary.get('status')}")
        print(f"Total Audio Streamed:    {summary.get('total_audio_seconds', 0.0):.2f} s")
        print(f"Processed Audio:         {summary.get('processed_audio_seconds', 0.0):.2f} s")
        print(f"Detections Broadcast:    {summary.get('events_count', 0)}")
        print(f"Audio Segments Saved:    {summary.get('segments_count', 0)}")
        print(f"Audio Input Continuity:  {stats.get('audio_input_continuity', 100.0):.1f}%")
        print(f"Dropped Frames:          {summary.get('dropped_frames', 0)}")
        print(f"Dropped Windows:         {summary.get('dropped_windows', 0)}")
        print(f"Avg Inference Latency:   {stats.get('avg_inference_latency_ms', 0.0):.1f} ms")
        print(f"Avg Embedding Latency:   {stats.get('avg_embedding_latency_ms', 0.0):.1f} ms")
        print(f"Window Processing Lag:   {stats.get('window_processing_lag_ms', 0.0):.1f} ms")
        print(f"E2E Event Delivery:      {stats.get('e2e_event_delivery_latency_ms', 0.0):.1f} ms")
        print(f"Host CPU Utilization:    {stats.get('cpu_utilization_pct', 0.0):.1f}%")
        print(f"GPU Utilization:         {stats.get('gpu_utilization_pct')}%")
        print(f"Peak Host Memory:        {stats.get('peak_memory_mb', 0.0):.1f} MB")
        print("=" * 60 + "\n")
    except Exception as exc:
        logger.warning("Could not retrieve session summary: %s", exc)


if __name__ == "__main__":
    main()
