"""Unit tests for container-aware ONNX Runtime CPU thread detection."""

from __future__ import annotations

import os
from pathlib import Path

from app.services.direct_onnx_engine import detect_available_cpus, resolve_onnx_thread_config


def test_detect_available_cpus_cgroup_v2_one_vcpu(tmp_path, monkeypatch):
    cg2 = tmp_path / "cpu.max"
    cg2.write_text("100000 100000\n", encoding="utf-8")
    monkeypatch.setattr(os, "cpu_count", lambda: 16)
    monkeypatch.delattr(os, "sched_getaffinity", raising=False)

    avail, sources = detect_available_cpus(
        cgroup_v2_path=cg2,
        cgroup_v1_quota_path=tmp_path / "missing_q",
        cgroup_v1_period_path=tmp_path / "missing_p",
    )
    assert avail == 1
    assert any("cgroup_v2=100000/100000->1" in s for s in sources)


def test_detect_available_cpus_cgroup_v1_two_vcpu(tmp_path, monkeypatch):
    q = tmp_path / "cpu.cfs_quota_us"
    p = tmp_path / "cpu.cfs_period_us"
    q.write_text("200000\n", encoding="utf-8")
    p.write_text("100000\n", encoding="utf-8")
    monkeypatch.setattr(os, "cpu_count", lambda: 32)
    monkeypatch.delattr(os, "sched_getaffinity", raising=False)

    avail, sources = detect_available_cpus(
        cgroup_v2_path=tmp_path / "missing_v2",
        cgroup_v1_quota_path=q,
        cgroup_v1_period_path=p,
    )
    assert avail == 2
    assert any("cgroup_v1=200000/100000->2" in s for s in sources)


def test_detect_available_cpus_sched_affinity(tmp_path, monkeypatch):
    monkeypatch.setattr(os, "cpu_count", lambda: 16)
    monkeypatch.setattr(os, "sched_getaffinity", lambda _pid: {0, 1, 2}, raising=False)

    avail, sources = detect_available_cpus(
        cgroup_v2_path=tmp_path / "missing_v2",
        cgroup_v1_quota_path=tmp_path / "missing_q",
        cgroup_v1_period_path=tmp_path / "missing_p",
    )
    assert avail == 3
    assert any("sched_getaffinity=3" in s for s in sources)


def test_resolve_onnx_thread_config_env_override_and_invalid(monkeypatch):
    monkeypatch.setenv("ONNX_INTRA_OP_THREADS", "4")
    intra, inter, _, sources = resolve_onnx_thread_config()
    assert intra == 4
    assert inter == 1
    assert any("env:ONNX_INTRA_OP_THREADS=4" in s for s in sources)

    monkeypatch.setenv("ONNX_INTRA_OP_THREADS", "not-an-int")
    intra_fb, inter_fb, _, _ = resolve_onnx_thread_config()
    assert 1 <= intra_fb <= 2
    assert inter_fb == 1
