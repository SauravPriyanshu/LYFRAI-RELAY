"""SQLite storage. One short-lived connection per operation (thread-safe), WAL mode."""
from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime, timezone
from typing import Optional

SCHEMA = """
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    metadata TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, id);
CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    system_prompt TEXT,
    created_at TEXT NOT NULL
);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Database:
    def __init__(self, path: str) -> None:
        self.path = path

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA busy_timeout=10000")
        return conn

    def init(self) -> None:
        folder = os.path.dirname(os.path.abspath(self.path))
        os.makedirs(folder, exist_ok=True)
        conn = self._connect()
        try:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.executescript(SCHEMA)
        finally:
            conn.close()

    def ping(self) -> bool:
        conn = self._connect()
        try:
            conn.execute("SELECT 1").fetchone()
            return True
        finally:
            conn.close()

    def load_context(self, session_id: str, limit: int) -> dict:
        """Stored system prompt + the last `limit` messages (oldest first)."""
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT system_prompt FROM sessions WHERE session_id = ?", (session_id,)
            ).fetchone()
            rows = conn.execute(
                "SELECT role, content FROM ("
                " SELECT id, role, content FROM messages WHERE session_id = ?"
                " ORDER BY id DESC LIMIT ?"
                ") ORDER BY id ASC",
                (session_id, max(1, limit)),
            ).fetchall()
            return {
                "system_prompt": row["system_prompt"] if row else None,
                "history": [{"role": r["role"], "content": r["content"]} for r in rows],
            }
        finally:
            conn.close()

    def save_exchange(
        self,
        session_id: str,
        system_prompt: Optional[str],
        user_content: str,
        assistant_content: str,
        metadata: dict,
    ) -> None:
        """Atomically persist the user + assistant messages (only called on success)."""
        conn = self._connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            try:
                now = _now()
                conn.execute(
                    "INSERT INTO sessions(session_id, system_prompt, created_at) VALUES(?,?,?) "
                    "ON CONFLICT(session_id) DO UPDATE SET "
                    "system_prompt = COALESCE(excluded.system_prompt, sessions.system_prompt)",
                    (session_id, system_prompt, now),
                )
                conn.execute(
                    "INSERT INTO messages(session_id, role, content, metadata, created_at) "
                    "VALUES(?,?,?,?,?)",
                    (session_id, "user", user_content, None, now),
                )
                conn.execute(
                    "INSERT INTO messages(session_id, role, content, metadata, created_at) "
                    "VALUES(?,?,?,?,?)",
                    (session_id, "assistant", assistant_content, json.dumps(metadata), _now()),
                )
                conn.execute("COMMIT")
            except Exception:
                conn.execute("ROLLBACK")
                raise
        finally:
            conn.close()

    def get_messages(self, session_id: str) -> Optional[list]:
        """Full history oldest first, or None if the session does not exist."""
        conn = self._connect()
        try:
            rows = conn.execute(
                "SELECT role, content, metadata FROM messages WHERE session_id = ? ORDER BY id ASC",
                (session_id,),
            ).fetchall()
        finally:
            conn.close()
        if not rows:
            return None
        out = []
        for r in rows:
            item = {"role": r["role"], "content": r["content"]}
            if r["role"] == "assistant" and r["metadata"]:
                try:
                    item["metadata"] = json.loads(r["metadata"])
                except (TypeError, ValueError):
                    pass
            out.append(item)
        return out
