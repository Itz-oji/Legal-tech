from __future__ import annotations

import json
import os
import re
import shutil
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

LEVELS = {"bajo", "medio", "alto"}
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,48}$")
MAX_PATTERN = 400
MAX_CRITERIA = 60
NESTED_QUANTIFIER = re.compile(r"\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)[+*{]")


class ValidationError(ValueError):
    pass


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _check_pattern(value, where: str) -> None:
    if not isinstance(value, str) or not value or len(value) > MAX_PATTERN:
        raise ValidationError(f"{where}: patrón vacío o demasiado largo")
    if NESTED_QUANTIFIER.search(value):
        raise ValidationError(f"{where}: patrón con cuantificadores anidados")
    try:
        re.compile(value, re.IGNORECASE)
    except re.error as e:
        raise ValidationError(f"{where}: expresión regular inválida ({e})") from e


def _text(value, where: str, limit: int = 2000) -> None:
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise ValidationError(f"{where}: texto requerido (máx. {limit} caracteres)")


def validate_document(doc: dict, allowed_hosts: set[str]) -> None:
    if not isinstance(doc, dict):
        raise ValidationError("El documento debe ser un objeto JSON")
    sources = doc.get("sources")
    criteria = doc.get("criteria")
    if not isinstance(sources, list) or not isinstance(criteria, list):
        raise ValidationError("Se requieren las listas 'sources' y 'criteria'")
    if not 1 <= len(criteria) <= MAX_CRITERIA:
        raise ValidationError(f"Debe haber entre 1 y {MAX_CRITERIA} criterios")
    source_ids: set[str] = set()
    for s in sources:
        sid = s.get("id") if isinstance(s, dict) else None
        if not isinstance(sid, str) or not ID_RE.match(sid) or sid in source_ids:
            raise ValidationError(f"Fuente con id inválido o repetido: {sid!r}")
        source_ids.add(sid)
        _text(s.get("title"), f"fuente {sid}.title", 300)
        url = urlparse(s.get("url") or "")
        if url.scheme != "https" or (url.hostname or "") not in allowed_hosts:
            raise ValidationError(f"Fuente {sid}: la URL debe ser https y de un dominio permitido")
    ids: set[str] = set()
    for c in criteria:
        cid = c.get("id") if isinstance(c, dict) else None
        if not isinstance(cid, str) or not ID_RE.match(cid) or cid in ids:
            raise ValidationError(f"Criterio con id inválido o repetido: {cid!r}")
        ids.add(cid)
        w = f"criterio {cid}"
        _text(c.get("title"), f"{w}.title", 200)
        _text(c.get("explanation"), f"{w}.explanation")
        _text(c.get("alternative"), f"{w}.alternative")
        if not isinstance(c.get("detect"), list) or not c["detect"]:
            raise ValidationError(f"{w}: 'detect' debe ser una lista no vacía")
        for p in c["detect"]:
            _check_pattern(p, f"{w}.detect")
        for key in ("default_level", "absent_level"):
            if key in c and c[key] not in LEVELS:
                raise ValidationError(f"{w}.{key}: use bajo, medio o alto")
        if "default_level" not in c:
            raise ValidationError(f"{w}: falta default_level")
        for i, rule in enumerate(c.get("rules", [])):
            rw = f"{w}.rules[{i}]"
            if rule.get("level") not in LEVELS:
                raise ValidationError(f"{rw}.level: use bajo, medio o alto")
            if "number_gt" in rule:
                spec = rule["number_gt"]
                _check_pattern(spec.get("pattern"), f"{rw}.number_gt.pattern")
                if not isinstance(spec.get("threshold"), int):
                    raise ValidationError(f"{rw}.number_gt.threshold debe ser entero")
                if re.compile(spec["pattern"]).groups < 1:
                    raise ValidationError(f"{rw}.number_gt.pattern necesita un grupo de captura")
            else:
                _check_pattern(rule.get("match"), f"{rw}.match")
            if rule.get("unless") is not None:
                _check_pattern(rule["unless"], f"{rw}.unless")
        for r in c.get("references", []):
            if r.get("source_id") not in source_ids:
                raise ValidationError(f"{w}: referencia a una fuente inexistente ({r.get('source_id')!r})")
            _text(r.get("label"), f"{w}.references.label", 300)


class CriteriaStore:
    def __init__(self, data_dir: Path, seed_path: Path, allowed_hosts: set[str]):
        self.dir = Path(data_dir)
        self.dir.mkdir(parents=True, exist_ok=True)
        self.history_dir = self.dir / "history"
        self.history_dir.mkdir(exist_ok=True)
        self.path = self.dir / "criteria.json"
        self.allowed_hosts = allowed_hosts
        self.load_error: str | None = None
        self._lock = threading.RLock()
        self._cache: dict | None = None
        self._mtime: int | None = None
        if not self.path.exists():
            shutil.copyfile(seed_path, self.path)
        else:
            self._actualizar_semilla(Path(seed_path))

    def _actualizar_semilla(self, seed_path: Path) -> None:
        """Si la copia de trabajo sigue siendo la semilla (nadie publicó una versión revisada) y la
        semilla del código es más nueva, la reemplaza. Una versión publicada por una persona nunca se toca."""
        try:
            actual = json.loads(self.path.read_text(encoding="utf-8"))
            semilla = json.loads(seed_path.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            return
        rev_actual, rev_semilla = actual.get("seed_revision", 1), semilla.get("seed_revision", 1)
        if actual.get("status") == "seed" and rev_actual < rev_semilla:
            shutil.copyfile(self.path, self.history_dir / f"criteria-seed-r{rev_actual}.json")
            shutil.copyfile(seed_path, self.path)

    def current(self) -> dict:
        with self._lock:
            mtime = self.path.stat().st_mtime_ns
            if self._cache is None or mtime != self._mtime:
                try:
                    doc = json.loads(self.path.read_text(encoding="utf-8"))
                    validate_document(doc, self.allowed_hosts)
                    self._cache, self._mtime, self.load_error = doc, mtime, None
                except (ValueError, OSError) as e:
                    if self._cache is None:
                        raise
                    self.load_error = str(e)
            return self._cache

    def publish(self, doc: dict, note: str = "", author: str = "admin") -> dict:
        with self._lock:
            previous = self.current()
            validate_document(doc, self.allowed_hosts)
            new = {
                **doc,
                "version": int(previous["version"]) + 1,
                "published_at": now(),
                "status": "published",
                "notes": note or doc.get("notes", ""),
                "published_by": author,
            }
            shutil.copyfile(self.path, self.history_dir / f"criteria-v{previous['version']}.json")
            self._atomic_write(self.path, new)
            self._cache, self._mtime = new, self.path.stat().st_mtime_ns
            return new

    def history(self) -> list[dict]:
        out = []
        for p in sorted(self.history_dir.glob("criteria-v*.json")):
            try:
                d = json.loads(p.read_text(encoding="utf-8"))
                out.append({k: d.get(k) for k in ("version", "published_at", "status", "notes", "published_by")})
            except ValueError:
                continue
        return out

    @staticmethod
    def _atomic_write(path: Path, data: dict) -> None:
        fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
