"""Hardware scanning — stdlib only, best-effort, never raises.

``scan_hardware()`` probes the host for CPU/RAM/GPU capacity so the model
advisor (:mod:`core.model_advisor`) can rate local models against what the
machine can actually run. Every probe is wrapped: a failed command or file
read appends a note to the profile instead of propagating.
"""

from __future__ import annotations

import json
import logging
import os
import platform
import re
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

_CMD_TIMEOUT_S = 5.0

_VRAM_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(GB|GiB|MB|MiB)", re.IGNORECASE)


class HardwareProfile(BaseModel):
    """Snapshot of the host machine's compute resources."""

    scanned_at: str = ""
    os: str = ""
    cpu_model: str = ""
    cpu_cores: int = 0
    ram_gb: float = 0.0
    gpu_name: str | None = None
    vram_gb: float | None = None
    # True on Apple Silicon, where the GPU shares system RAM (no separate VRAM).
    unified_memory: bool = False
    notes: list[str] = Field(default_factory=list)


def scan_hardware() -> HardwareProfile:
    """Probe the host hardware. Best-effort; never raises."""
    try:
        if sys.platform == "darwin":
            return _scan_darwin()
        if sys.platform.startswith("linux"):
            return _scan_linux()
        return _scan_fallback()
    except Exception:
        logger.warning("Hardware scan failed; returning minimal profile", exc_info=True)
        return HardwareProfile(
            scanned_at=_now_iso(),
            os=sys.platform,
            cpu_cores=os.cpu_count() or 0,
            notes=["scan failed; minimal fallback profile"],
        )


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _run(cmd: list[str], notes: list[str]) -> str | None:
    """Run a command, returning stripped stdout or None (with a note) on failure."""
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=_CMD_TIMEOUT_S,
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        notes.append(f"{cmd[0]} unavailable: {exc.__class__.__name__}")
        return None
    if result.returncode != 0:
        notes.append(f"{cmd[0]} exited with status {result.returncode}")
        return None
    return result.stdout.strip()


def _read(path: Path, notes: list[str]) -> str | None:
    """Read a text file, returning None (with a note) on failure."""
    try:
        return path.read_text()
    except OSError as exc:
        notes.append(f"{path} unreadable: {exc.__class__.__name__}")
        return None


def _parse_capacity_gb(raw: str | None) -> float | None:
    """Parse a '8 GB' / '24576 MiB' style capacity string into GB."""
    if not raw:
        return None
    match = _VRAM_RE.search(raw)
    if match is None:
        return None
    value = float(match.group(1))
    if match.group(2).lower().startswith("m"):
        value /= 1024
    return round(value, 1)


# -- macOS ---------------------------------------------------------------------


def _scan_darwin() -> HardwareProfile:
    """Scan via sysctl + system_profiler (both best-effort)."""
    notes: list[str] = []
    cpu_model = _run(["sysctl", "-n", "machdep.cpu.brand_string"], notes) or platform.machine()

    mem_raw = _run(["sysctl", "-n", "hw.memsize"], notes)
    ram_gb = round(int(mem_raw) / 1024**3, 1) if mem_raw and mem_raw.isdigit() else 0.0

    cores_raw = _run(["sysctl", "-n", "hw.ncpu"], notes)
    cpu_cores = int(cores_raw) if cores_raw and cores_raw.isdigit() else (os.cpu_count() or 0)

    gpu_name, vram_gb = _darwin_gpu(notes)
    unified = platform.machine() == "arm64" or bool(gpu_name and gpu_name.startswith("Apple"))

    return HardwareProfile(
        scanned_at=_now_iso(),
        os=f"macOS {platform.mac_ver()[0]} {platform.machine()}".strip(),
        cpu_model=cpu_model,
        cpu_cores=cpu_cores,
        ram_gb=ram_gb,
        gpu_name=gpu_name,
        vram_gb=vram_gb,
        unified_memory=unified,
        notes=notes,
    )


def _darwin_gpu(notes: list[str]) -> tuple[str | None, float | None]:
    """Best-effort GPU name + VRAM from system_profiler's JSON output."""
    raw = _run(["system_profiler", "SPDisplaysDataType", "-json"], notes)
    if raw is None:
        return None, None
    try:
        data = json.loads(raw)
        displays = data.get("SPDisplaysDataType") or []
        first = displays[0] if isinstance(displays, list) and displays else {}
    except (json.JSONDecodeError, AttributeError, TypeError):
        notes.append("could not parse system_profiler output")
        return None, None
    if not isinstance(first, dict):
        return None, None
    name = first.get("sppci_model")
    vram_raw = first.get("spdisplays_vram") or first.get("spdisplays_vram_shared")
    return (
        str(name) if name else None,
        _parse_capacity_gb(str(vram_raw)) if vram_raw else None,
    )


# -- Linux ---------------------------------------------------------------------


def _scan_linux() -> HardwareProfile:
    """Scan via /proc/cpuinfo, /proc/meminfo, and nvidia-smi (best-effort)."""
    notes: list[str] = []
    cpuinfo = _read(Path("/proc/cpuinfo"), notes) or ""
    cpu_model = (
        next(
            (
                line.split(":", 1)[1].strip()
                for line in cpuinfo.splitlines()
                if line.lower().startswith("model name") and ":" in line
            ),
            "",
        )
        or platform.machine()
    )
    cpu_cores = sum(1 for line in cpuinfo.splitlines() if line.startswith("processor")) or (
        os.cpu_count() or 0
    )

    meminfo = _read(Path("/proc/meminfo"), notes) or ""
    ram_gb = 0.0
    for line in meminfo.splitlines():
        if line.startswith("MemTotal"):
            parts = line.split()
            if len(parts) >= 2 and parts[1].isdigit():
                ram_gb = round(int(parts[1]) / 1024**2, 1)
            break

    gpu_name, vram_gb = _linux_gpu(notes)

    return HardwareProfile(
        scanned_at=_now_iso(),
        os=f"Linux {platform.release()} {platform.machine()}".strip(),
        cpu_model=cpu_model,
        cpu_cores=cpu_cores,
        ram_gb=ram_gb,
        gpu_name=gpu_name,
        vram_gb=vram_gb,
        unified_memory=False,
        notes=notes,
    )


def _linux_gpu(notes: list[str]) -> tuple[str | None, float | None]:
    """Best-effort NVIDIA GPU name + VRAM via nvidia-smi."""
    raw = _run(
        ["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader"],
        notes,
    )
    if not raw:
        return None, None
    first_line = raw.splitlines()[0]
    name, _, mem = first_line.rpartition(",")
    if not name:
        return first_line.strip() or None, None
    return name.strip() or None, _parse_capacity_gb(mem)


# -- Fallback ------------------------------------------------------------------


def _scan_fallback() -> HardwareProfile:
    """Generic scan for platforms without a dedicated probe."""
    return HardwareProfile(
        scanned_at=_now_iso(),
        os=platform.platform(),
        cpu_model=platform.processor() or platform.machine(),
        cpu_cores=os.cpu_count() or 0,
        ram_gb=0.0,
        notes=["generic scan: platform module only (RAM/GPU unknown)"],
    )
