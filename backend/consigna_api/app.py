from __future__ import annotations

import hmac
import io
import logging
import os
import secrets
from datetime import date, datetime
from pathlib import Path
from types import SimpleNamespace

from flask import Flask, jsonify, request
from flask.json.provider import DefaultJSONProvider
from pypdf import PdfReader
from pypdf.errors import PdfReadError

from . import alertas, engine, plazos, rutas
from .db import DB
from .evidencias import Almacen
from .monitor import SourceMonitor
from .store import CriteriaStore, ValidationError, now

ROOT = Path(__file__).resolve().parent.parent
MIN_CHARS, MAX_CHARS = 40, 100_000
MAX_UPLOAD = 10 * 1024 * 1024
DEFAULT_HOSTS = "sernac.cl,www.sernac.cl,bcn.cl,www.bcn.cl"
DISCLAIMER = (
    "Orientación automática basada en criterios versionados. No reemplaza asesoría jurídica; "
    "los criterios marcados como pendientes aún no tienen validación de un abogado."
)


def extract_pdf_text(data: bytes) -> str:
    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            raise ValueError("El PDF está protegido. Sube una versión sin contraseña.")
        text = "\n".join((page.extract_text() or "") for page in reader.pages)
    except PdfReadError as e:
        raise ValueError("No se pudo leer el PDF.") from e
    if not text.strip():
        raise ValueError("El PDF no contiene texto seleccionable (¿es un documento escaneado?).")
    return text


def _json_default(o):
    """Fechas en formato ISO (AAAA-MM-DD) en todas las respuestas."""
    if isinstance(o, (date, datetime)):
        return o.isoformat()
    return DefaultJSONProvider.default(o)


def create_app(config: dict | None = None) -> Flask:
    cfg = {
        "DATA_DIR": os.environ.get("DATA_DIR", str(ROOT / "var")),
        "ADMIN_TOKEN": os.environ.get("ADMIN_TOKEN", ""),
        "SYNC_INTERVAL_HOURS": float(os.environ.get("SYNC_INTERVAL_HOURS", "24")),
        "CORS_ORIGINS": os.environ.get("CORS_ORIGINS", ""),
        "ALLOWED_HOSTS": os.environ.get("SOURCE_ALLOWED_HOSTS", DEFAULT_HOSTS),
        "FETCHER": None,
        "DATABASE_URL": os.environ.get("DATABASE_URL", ""),
        "EVIDENCE_DIR": os.environ.get("EVIDENCE_DIR", ""),
        "JWT_SECRET": os.environ.get("JWT_SECRET", ""),
        "SMTP_HOST": os.environ.get("SMTP_HOST", ""),
        "SMTP_PORT": int(os.environ.get("SMTP_PORT", "587")),
        "SMTP_USER": os.environ.get("SMTP_USER", ""),
        "SMTP_PASSWORD": os.environ.get("SMTP_PASSWORD", ""),
        "SMTP_FROM": os.environ.get("SMTP_FROM", ""),
        "ALERT_INTERVAL_MINUTES": float(os.environ.get("ALERT_INTERVAL_MINUTES", "60")),
        # Modo demostración: la interfaz entra sola con una cuenta compartida, sin pantalla de login.
        "DEMO_MODE": os.environ.get("DEMO_MODE", "0").lower() in ("1", "true", "si", "sí", "on"),
        "DEMO_EMAIL": os.environ.get("DEMO_EMAIL", "demo@consigna.local"),
        "TODAY": None, "SENDER": None,
    }
    cfg.update(config or {})
    app = Flask(__name__)
    app.config["DEMO_MODE"], app.config["DEMO_EMAIL"] = bool(cfg["DEMO_MODE"]), cfg["DEMO_EMAIL"]
    app.json.default = _json_default
    app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD + 1024 * 1024
    hosts = {h.strip() for h in cfg["ALLOWED_HOSTS"].split(",") if h.strip()}
    store = CriteriaStore(Path(cfg["DATA_DIR"]), ROOT / "seed" / "criteria.json", hosts)
    monitor = SourceMonitor(store, cfg["FETCHER"])
    app.extensions["store"], app.extensions["monitor"] = store, monitor
    if not cfg["JWT_SECRET"]:
        if os.environ.get("APP_ENV") == "production":
            raise RuntimeError("Define JWT_SECRET: sin él las sesiones no son seguras.")
        cfg["JWT_SECRET"] = secrets.token_urlsafe(32)  # desarrollo: las sesiones se pierden al reiniciar
        logging.getLogger("consigna").warning("JWT_SECRET no definido: se generó uno temporal.")
    app.config["JWT_SECRET"] = cfg["JWT_SECRET"]
    data_dir = Path(cfg["DATA_DIR"])
    db = DB(cfg["DATABASE_URL"] or f"sqlite:///{data_dir / 'consigna.db'}")
    enviador = cfg["SENDER"] or alertas.EnviadorSMTP(cfg["SMTP_HOST"], cfg["SMTP_PORT"], cfg["SMTP_USER"], cfg["SMTP_PASSWORD"], cfg["SMTP_FROM"])
    services = SimpleNamespace(
        db=db, almacen=Almacen(Path(cfg["EVIDENCE_DIR"] or data_dir / "evidencias")),
        enviador=enviador, hoy=cfg["TODAY"] or plazos.hoy_santiago)
    app.extensions["services"] = services
    if cfg["SYNC_INTERVAL_HOURS"] > 0 or cfg["ALERT_INTERVAL_MINUTES"] > 0:
        prog = alertas.Programador()
        if cfg["SYNC_INTERVAL_HOURS"] > 0:
            prog.cada(cfg["SYNC_INTERVAL_HOURS"] * 3600, monitor.sync)
        if cfg["ALERT_INTERVAL_MINUTES"] > 0:
            prog.cada(cfg["ALERT_INTERVAL_MINUTES"] * 60, lambda: alertas.ejecutar_alertas(db, enviador, services.hoy()))
        prog.iniciar()
        app.extensions["programador"] = prog

    origins = {o.strip() for o in cfg["CORS_ORIGINS"].split(",") if o.strip()}

    @app.after_request
    def headers(resp):
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["Cache-Control"] = "no-store"
        origin = request.headers.get("Origin")
        if origin and origin in origins:
            resp.headers["Access-Control-Allow-Origin"] = origin
            resp.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
            resp.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
            resp.headers["Vary"] = "Origin"
        return resp

    @app.errorhandler(413)
    def too_big(_):
        return jsonify(error="El archivo supera el límite de 10 MB."), 413

    def admin_only():
        token = cfg["ADMIN_TOKEN"]
        if not token:
            return jsonify(error="La administración está deshabilitada (falta ADMIN_TOKEN)."), 503
        sent = request.headers.get("Authorization", "").removeprefix("Bearer ").strip()
        if not hmac.compare_digest(sent.encode(), token.encode()):
            return jsonify(error="No autorizado."), 401
        return None

    def public_criteria(doc):
        return [
            {k: c.get(k) for k in ("id", "title", "required", "review_status", "references")}
            for c in doc["criteria"] if c.get("enabled", True)
        ]

    @app.get("/api/health")
    def health():
        return jsonify(status="ok", criteria_version=store.current()["version"])

    @app.get("/api/criteria")
    def criteria():
        doc, status = store.current(), monitor.status()
        return jsonify(
            version=doc["version"], published_at=doc["published_at"], status=doc["status"],
            notes=doc.get("notes", ""), criteria=public_criteria(doc),
            sources=status["sources"], last_sync=status["last_sync"],
            review_pending=status["review_pending"], load_error=store.load_error,
        )

    @app.post("/api/analyze")
    def analyze():
        if request.files.get("file"):
            f = request.files["file"]
            data = f.read()
            if len(data) > MAX_UPLOAD:
                return jsonify(error="El archivo supera el límite de 10 MB."), 413
            try:
                if (f.filename or "").lower().endswith(".pdf") or data[:5] == b"%PDF-":
                    text = extract_pdf_text(data)
                else:
                    text = data.decode("utf-8", errors="replace")
            except ValueError as e:
                return jsonify(error=str(e)), 422
        else:
            body = request.get_json(silent=True) or {}
            text = body.get("text")
            if not isinstance(text, str):
                return jsonify(error="Envía el contrato en 'text' o como archivo 'file'."), 400
        if len(text.strip()) < MIN_CHARS:
            return jsonify(error=f"Ingresa al menos {MIN_CHARS} caracteres para revisar los términos del contrato."), 422
        if len(text) > MAX_CHARS:
            return jsonify(error=f"El texto supera {MAX_CHARS:,} caracteres.".replace(",", ".")), 422
        doc = store.current()
        flags = monitor.review_flags()
        findings = engine.analyze(text, doc, flags)
        status = monitor.status()
        # The contract text is analyzed in memory only: never stored or logged.
        return jsonify(
            analyzed_at=now(), criteria_version=doc["version"], criteria_published_at=doc["published_at"],
            findings=findings, review_pending=bool(flags), sources_last_checked=status["last_sync"],
            disclaimer=DISCLAIMER,
        )

    # ---- administration ------------------------------------------------
    @app.post("/api/admin/sync")
    def admin_sync():
        if (denied := admin_only()):
            return denied
        report = monitor.sync()
        return jsonify(report=report, status=monitor.status())

    @app.get("/api/admin/events")
    def admin_events():
        if (denied := admin_only()):
            return denied
        return jsonify(**monitor.status(), history=store.history())

    @app.get("/api/admin/criteria")
    def admin_get():
        if (denied := admin_only()):
            return denied
        return jsonify(store.current())

    @app.put("/api/admin/criteria")
    def admin_publish():
        """Body: {criteria, sources, note, acknowledge: [source ids] | "all"}.
        Publishing a reviewed version clears the matching change alerts."""
        if (denied := admin_only()):
            return denied
        body = request.get_json(silent=True)
        if not isinstance(body, dict):
            return jsonify(error="Cuerpo JSON requerido."), 400
        try:
            new = store.publish(
                {"criteria": body.get("criteria"), "sources": body.get("sources")},
                note=str(body.get("note", ""))[:500],
            )
        except ValidationError as e:
            return jsonify(error=str(e)), 422
        ack = body.get("acknowledge")
        cleared = monitor.acknowledge(None if ack == "all" else (ack if isinstance(ack, list) else []))
        return jsonify(version=new["version"], published_at=new["published_at"], alerts_cleared=cleared)

    app.extensions["admin_only"] = admin_only
    app.register_blueprint(rutas.bp)
    return app
