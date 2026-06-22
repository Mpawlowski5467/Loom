"""Live agent activity tracker — driven by execute_with_chain + provider calls."""

from __future__ import annotations

import threading
import time
from collections import defaultdict, deque
from typing import Any, Literal

State = Literal["running", "idle"]

_MAX_PULSE_POINTS = 60


class AgentActivity:
    """Per-agent live state.

    ``state`` reflects whether the agent is actively doing work right now.
    ``last_started`` / ``last_finished`` are monotonic timestamps used by
    the UI to render fade-outs.
    ``pulse`` is a small ring buffer of recent activity intensities (0..1),
    sampled per ~250ms — drives the live sparkline.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._inflight: dict[str, int] = defaultdict(int)
        self._last_started: dict[str, float] = {}
        self._last_finished: dict[str, float] = {}
        self._action_counts: dict[str, int] = defaultdict(int)
        self._pulses: dict[str, deque[float]] = defaultdict(
            lambda: deque([0.0] * _MAX_PULSE_POINTS, maxlen=_MAX_PULSE_POINTS)
        )
        self._last_sample_at: float = time.time()

    def begin(self, agent: str) -> None:
        with self._lock:
            self._inflight[agent] += 1
            self._last_started[agent] = time.time()

    def end(self, agent: str) -> None:
        with self._lock:
            self._inflight[agent] = max(0, self._inflight[agent] - 1)
            self._last_finished[agent] = time.time()
            self._action_counts[agent] += 1

    def state_of(self, agent: str) -> State:
        with self._lock:
            return "running" if self._inflight.get(agent, 0) > 0 else "idle"

    def snapshot(self) -> dict[str, dict[str, Any]]:
        """Return the public view of every agent's activity."""
        self._sample_pulses_if_due()
        now = time.time()
        with self._lock:
            agents = set(self._inflight) | set(self._last_finished) | set(self._last_started)
            out: dict[str, dict[str, Any]] = {}
            for a in agents:
                inflight = self._inflight.get(a, 0)
                last_started = self._last_started.get(a)
                last_finished = self._last_finished.get(a)
                out[a] = {
                    "state": "running" if inflight > 0 else "idle",
                    "inflight": inflight,
                    "action_count": self._action_counts.get(a, 0),
                    "last_started_age_s": (now - last_started) if last_started else None,
                    "last_finished_age_s": (now - last_finished) if last_finished else None,
                    "pulse": list(self._pulses[a]),
                }
            return out

    def _sample_pulses_if_due(self) -> None:
        """Append a pulse sample (0..1) to each agent's ring on a ~250ms cadence."""
        now = time.time()
        if now - self._last_sample_at < 0.25:
            return
        with self._lock:
            self._last_sample_at = now
            agents = set(self._inflight) | set(self._pulses)
            for a in agents:
                inflight = self._inflight.get(a, 0)
                last_fin = self._last_finished.get(a)
                if inflight > 0:
                    intensity = 1.0
                elif last_fin and (now - last_fin) < 2.0:
                    intensity = max(0.0, 1.0 - (now - last_fin) / 2.0)
                else:
                    intensity = 0.0
                self._pulses[a].append(intensity)


_activity = AgentActivity()


def get_activity() -> AgentActivity:
    return _activity
