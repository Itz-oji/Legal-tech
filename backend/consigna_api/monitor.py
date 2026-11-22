# NORMATIVA DEL SERNAC, BCN
from __future__ import annotations

import difflib
import hashlib
import json
import os
import re
import tempfile
import threading
import uuid
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

from .store import CriteriaStore, now

MAX_BYTES = 2_000_000
USER_AGENT = "ConsignaCriteriaMonitor/1.0 (+revision periodica de fuentes publicas)"
DROP_TAGS = ["script", "style", "noscript", "nav", "header", "footer", "form", "svg", "iframe"]


def extract_text(html: str, selector: str | None = None) -> str:
    soup = BeautifulSoup(html, "lxml")
    for tag in soup(DROP_TAGS):
        tag.decompose()
    node = (soup.select_one(selector) if selector else None) or soup.find("main") or soup.find("article") or soup.body or soup
    lines: list[str] = []
    for raw in node.get_text("\n").splitlines():
        line = re.sub(r"\s+", " ", raw).strip()
        if line and (not lines or lines[-1] != line):
            lines.append(line)
    return "\n".join(lines)


def fetch_text(source: dict, allowed_hosts: set[str], timeout: int = 20) -> str:
    url = source["url"]
    for _ in range(4):
        host = urlparse(url).hostname or ""
        if urlparse(url).scheme != "https" or host not in allowed_hosts:
            raise RuntimeError(f"Dominio no permitido: {host}")
        r = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=timeout, stream=True, allow_redirects=False)
        if 300 <= r.status_code < 400 and r.headers.get("Location"):
            url = urljoin(url, r.headers["Location"])
            continue
        r.raise_for_status()
        body = r.raw.read(MAX_BYTES + 1, decode_content=True)
        if len(body) > MAX_BYTES:
            raise RuntimeError("La fuente supera el tamaño máximo permitido")
        r.encoding = r.encoding or r.apparent_encoding or "utf-8"
        return extract_text(body.decode(r.encoding, errors="replace"), source.get("selector"))
    raise RuntimeError("Demasiadas redirecciones")


class SourceMonitor:
    def __init__(self, store: CriteriaStore, fetcher=None):
        self.store = store
        self.fetcher = fetcher or (lambda src: fetch_text(src, store.allowed_hosts))
        self.state_path = store.dir / "state.json"
        self.snap_dir = store.dir / "snapshots"
        self.snap_dir.mkdir(exist_ok=True)
        self._lock = threading.RLock()

    def state(self) -> dict:
        with self._lock:
            if self.state_path.exists():
                return json.loads(self.state_path.read_text(encoding="utf-8"))
            return {"sources": {}, "pending_events": [], "last_sync": None}

    def _save(self, st: dict) -> None:
        fd, tmp = tempfile.mkstemp(dir=self.state_path.parent, suffix=".tmp")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(st, f, ensure_ascii=False, indent=2)
        os.replace(tmp, self.state_path)

    def review_flags(self) -> dict[str, list[str]]:
        """criterion id -> source ids with unreviewed changes."""
        flags: dict[str, list[str]] = {}
        for ev in self.state()["pending_events"]:
            for cid in ev["affected_criteria"]:
                flags.setdefault(cid, [])
                if ev["source_id"] not in flags[cid]:
                    flags[cid].append(ev["source_id"])
        return flags

    def acknowledge(self, source_ids: list[str] | None) -> int:
        """Called when a person publishes a reviewed criteria version."""
        with self._lock:
            st = self.state()
            before = len(st["pending_events"])
            keep = [e for e in st["pending_events"] if source_ids is not None and e["source_id"] not in source_ids]
            st["pending_events"] = keep
            self._save(st)
            return before - len(keep)

    def sync(self) -> list[dict]:
        doc = self.store.current()
        report = []
        for src in doc["sources"]:
            if src.get("monitor", True):
                report.append(self._sync_one(doc, src))
        with self._lock:
            st = self.state()
            st["last_sync"] = now()
            self._save(st)
        return report

    def _sync_one(self, doc: dict, src: dict) -> dict:
        sid = src["id"]
        try:
            text = self.fetcher(src)
            if not text.strip():
                raise RuntimeError("La página no devolvió contenido legible")
        except Exception as e:  # network, HTTP, parsing: keep last known state
            with self._lock:
                st = self.state()
                entry = st["sources"].setdefault(sid, {})
                entry.update(status="error", error=str(e)[:300], last_checked=now())
                self._save(st)
            return {"source_id": sid, "result": "error", "error": str(e)[:300]}
        digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
        snap = self.snap_dir / f"{sid}.txt"
        with self._lock:
            st = self.state()
            entry = st["sources"].get(sid, {})
            result = "unchanged"
            if "hash" not in entry:
                result = "baseline"
            elif entry["hash"] != digest:
                result = "changed"
                old = snap.read_text(encoding="utf-8").splitlines() if snap.exists() else []
                new = text.splitlines()
                added = [l for l in new if l not in set(old)][:10]
                removed = [l for l in old if l not in set(new)][:10]
                st["pending_events"].append({
                    "id": uuid.uuid4().hex[:12],
                    "source_id": sid,
                    "detected_at": now(),
                    "added": [l[:200] for l in added],
                    "removed": [l[:200] for l in removed],
                    "affected_criteria": [
                        c["id"] for c in doc["criteria"]
                        if any(r["source_id"] == sid for r in c.get("references", []))
                    ],
                })
                entry["last_changed"] = now()
            entry.update(hash=digest, status="ok", error=None, last_checked=now())
            if result == "baseline":
                entry["last_changed"] = None
            st["sources"][sid] = entry
            snap.write_text(text, encoding="utf-8")
            self._save(st)
        return {"source_id": sid, "result": result}

    def status(self) -> dict:
        doc = self.store.current()
        st = self.state()
        pending = {e["source_id"] for e in st["pending_events"]}
        return {
            "last_sync": st["last_sync"],
            "review_pending": bool(st["pending_events"]),
            "sources": [
                {
                    "id": s["id"], "title": s["title"], "url": s["url"],
                    "status": ("changed" if s["id"] in pending else st["sources"].get(s["id"], {}).get("status", "unchecked")),
                    "last_checked": st["sources"].get(s["id"], {}).get("last_checked"),
                    "last_changed": st["sources"].get(s["id"], {}).get("last_changed"),
                    "error": st["sources"].get(s["id"], {}).get("error"),
                }
                for s in doc["sources"]
            ],
            "pending_events": st["pending_events"],
        }


class Scheduler:
    def __init__(self, monitor: SourceMonitor, interval_hours: float, log=print):
        self.monitor, self.interval, self.log = monitor, interval_hours * 3600, log
        self._stop = threading.Event()

    def start(self) -> None:
        threading.Thread(target=self._loop, daemon=True, name="criteria-sync").start()

    def stop(self) -> None:
        self._stop.set()

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                self.monitor.sync()
            except Exception as e:
                self.log(f"[criteria-sync] error: {e}")
            self._stop.wait(self.interval)
