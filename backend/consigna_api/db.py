"""Acceso a datos: PostgreSQL en producción, SQLite para desarrollo y pruebas.

El SQL se escribe con marcadores `?` y se adapta a PostgreSQL (`%s`). El esquema
usa solo tipos comunes a ambos motores (ids UUID como texto, fechas ISO como texto).
"""
from __future__ import annotations

import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS contracts (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  vehicle TEXT NOT NULL, plate TEXT NOT NULL, dealer TEXT NOT NULL,
  price BIGINT NOT NULL, commission_bp INTEGER NOT NULL, payment_days INTEGER NOT NULL,
  day_type TEXT NOT NULL, contract_text TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_contracts_user ON contracts(user_id);
CREATE TABLE IF NOT EXISTS evidences (
  id TEXT PRIMARY KEY, contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id), filename TEXT NOT NULL, mime TEXT NOT NULL,
  size BIGINT NOT NULL, sha256 TEXT NOT NULL, stored_name TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS milestones (
  id TEXT PRIMARY KEY, contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, occurred_on TEXT NOT NULL, amount BIGINT, note TEXT NOT NULL DEFAULT '',
  evidence_id TEXT REFERENCES evidences(id), created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_milestones_contract ON milestones(contract_id);
CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY, contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  audience TEXT NOT NULL, body TEXT NOT NULL, facts TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS alerts_sent (
  contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, dedupe_key TEXT NOT NULL, sent_at TEXT NOT NULL,
  PRIMARY KEY (contract_id, kind, dedupe_key));
"""


class Tx:
    def __init__(self, cur, pg: bool):
        self.cur, self.pg = cur, pg

    def _sql(self, sql: str) -> str:
        return sql.replace("?", "%s") if self.pg else sql

    def execute(self, sql: str, params=()) -> int:
        self.cur.execute(self._sql(sql), tuple(params))
        return self.cur.rowcount

    def query(self, sql: str, params=()) -> list[dict]:
        self.cur.execute(self._sql(sql), tuple(params))
        cols = [c[0] for c in self.cur.description]
        return [dict(zip(cols, row)) for row in self.cur.fetchall()]

    def one(self, sql: str, params=()) -> dict | None:
        rows = self.query(sql, params)
        return rows[0] if rows else None


class DB:
    def __init__(self, url: str):
        self.url = url
        self.pg = url.startswith(("postgres://", "postgresql://"))
        self._lock = threading.RLock()
        if self.pg:
            import psycopg  # noqa: F401  (se instala con requirements.txt)
        else:
            path = url.removeprefix("sqlite:///")
            if path != ":memory:":
                Path(path).parent.mkdir(parents=True, exist_ok=True)
            self._conn = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
            self._conn.execute("PRAGMA foreign_keys = ON")
        with self.tx() as t:
            for stmt in SCHEMA.split(";"):
                if stmt.strip():
                    t.execute(stmt)

    @contextmanager
    def tx(self):
        if self.pg:
            import psycopg
            with psycopg.connect(self.url) as conn:  # confirma al salir, revierte si hay error
                with conn.cursor() as cur:
                    yield Tx(cur, True)
            return
        with self._lock:
            cur = self._conn.cursor()
            cur.execute("BEGIN")
            try:
                yield Tx(cur, False)
                cur.execute("COMMIT")
            except BaseException:
                cur.execute("ROLLBACK")
                raise
            finally:
                cur.close()

    def query(self, sql, params=()):
        with self.tx() as t:
            return t.query(sql, params)

    def one(self, sql, params=()):
        with self.tx() as t:
            return t.one(sql, params)

    def execute(self, sql, params=()):
        with self.tx() as t:
            return t.execute(sql, params)
