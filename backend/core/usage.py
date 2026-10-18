"""Small durable counters for policy limits.

Reservations are intentionally made before an external provider call.  A
failed call can therefore consume a reservation, but a process crash cannot
silently exceed a configured ceiling.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path


class UsageLedger:
    def __init__(self, vault_root: Path) -> None:
        self.path = vault_root / ".loom" / "usage.sqlite"

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute(
            "CREATE TABLE IF NOT EXISTS captures (day TEXT, source TEXT, count INTEGER NOT NULL, "
            "PRIMARY KEY(day, source))"
        )
        conn.execute(
            "CREATE TABLE IF NOT EXISTS tokens (day TEXT, provider TEXT, tokens INTEGER NOT NULL, "
            "estimated INTEGER NOT NULL, PRIMARY KEY(day, provider))"
        )
        conn.execute(
            "CREATE TABLE IF NOT EXISTS outputs (day TEXT, provider TEXT, tokens INTEGER NOT NULL, PRIMARY KEY(day,provider))"
        )
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    @staticmethod
    def _day() -> str:
        return datetime.now(UTC).date().isoformat()

    def reserve_capture(self, source: str, limit: int) -> bool:
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            current = conn.execute(
                "SELECT count FROM captures WHERE day=? AND source=?", (self._day(), source.lower())
            ).fetchone()
            if limit > 0 and current is not None and int(current[0]) >= limit:
                conn.execute("ROLLBACK")
                return False
            conn.execute(
                "INSERT INTO captures(day, source, count) VALUES (?, ?, 1) "
                "ON CONFLICT(day, source) DO UPDATE SET count=count+1",
                (self._day(), source.lower()),
            )
            conn.execute("COMMIT")
            return True

    def reserve_tokens(
        self, provider: str, tokens: int, limit: int, *, estimated: bool = True
    ) -> bool:
        tokens = max(1, tokens)
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            used = int(
                conn.execute(
                    "SELECT COALESCE(SUM(tokens), 0) FROM tokens WHERE day=?", (self._day(),)
                ).fetchone()[0]
            )
            if limit > 0 and used + tokens > limit:
                conn.execute("ROLLBACK")
                return False
            conn.execute(
                "INSERT INTO tokens(day, provider, tokens, estimated) VALUES (?, ?, ?, ?) "
                "ON CONFLICT(day, provider) DO UPDATE SET tokens=tokens+excluded.tokens, "
                "estimated=estimated OR excluded.estimated",
                (self._day(), provider.lower(), tokens, int(estimated)),
            )
            conn.execute("COMMIT")
            return True

    def record_output(self, provider: str, tokens: int) -> None:
        if tokens <= 0:
            return
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO outputs(day,provider,tokens) VALUES(?,?,?) ON CONFLICT(day,provider) DO UPDATE SET tokens=tokens+excluded.tokens",
                (self._day(), provider.lower(), tokens),
            )

    def summary(self, prices: dict[str, float] | None = None) -> dict[str, object]:
        with self._connect() as conn:
            captures = {
                str(source): int(count)
                for source, count in conn.execute(
                    "SELECT source, count FROM captures WHERE day=?", (self._day(),)
                )
            }
            token_rows = conn.execute(
                "SELECT provider, tokens, estimated FROM tokens WHERE day=?", (self._day(),)
            ).fetchall()
            outputs = dict(
                conn.execute(
                    "SELECT provider,tokens FROM outputs WHERE day=?", (self._day(),)
                ).fetchall()
            )
        costs = {
            str(provider): round(
                (int(tokens) + int(outputs.get(provider, 0)))
                * (prices or {})[str(provider)]
                / 1000,
                6,
            )
            for provider, tokens, _ in token_rows
            if str(provider) in (prices or {})
        }
        return {
            "day": self._day(),
            "captures_by_source": captures,
            "tokens_by_provider": {
                str(provider): {
                    "tokens": int(tokens) + int(outputs.get(provider, 0)),
                    "input_tokens": int(tokens),
                    "output_tokens": int(outputs.get(provider, 0)),
                    "estimated": bool(estimated),
                }
                for provider, tokens, estimated in token_rows
            },
            "total_tokens": sum(int(row[1]) for row in token_rows)
            + sum(int(value) for value in outputs.values()),
            "estimated_cost_by_provider": costs,
            "priced_total": round(sum(costs.values()), 6) if costs else None,
        }
