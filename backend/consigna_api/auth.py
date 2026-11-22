"""Registro, inicio de sesión y token. Contraseñas con scrypt (Werkzeug), sesión con JWT."""
from __future__ import annotations

import re
import time
from datetime import datetime, timedelta, timezone
from functools import wraps

import jwt
from flask import current_app, g, jsonify, request
from werkzeug.security import check_password_hash, generate_password_hash

EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,255}\.[^@\s]{2,}$")
TOKEN_HORAS = 12
_FALLOS: dict[str, list[float]] = {}
MAX_FALLOS, VENTANA = 5, 15 * 60


def hash_password(p: str) -> str:
    return generate_password_hash(p)


def verificar_password(h: str, p: str) -> bool:
    return check_password_hash(h, p)


def validar_registro(email, nombre, password) -> str | None:
    if not isinstance(email, str) or not EMAIL_RE.match(email.strip()):
        return "Ingresa un correo válido."
    if not isinstance(nombre, str) or not 2 <= len(nombre.strip()) <= 120:
        return "Ingresa tu nombre (entre 2 y 120 caracteres)."
    if not isinstance(password, str) or not 10 <= len(password) <= 200:
        return "La contraseña debe tener entre 10 y 200 caracteres."
    return None


def emitir_token(user_id: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(hours=TOKEN_HORAS)
    return jwt.encode({"sub": user_id, "exp": exp}, current_app.config["JWT_SECRET"], algorithm="HS256")


def bloqueado(clave: str) -> bool:
    ahora = time.time()
    _FALLOS[clave] = [t for t in _FALLOS.get(clave, []) if ahora - t < VENTANA]
    return len(_FALLOS[clave]) >= MAX_FALLOS


def registrar_fallo(clave: str) -> None:
    _FALLOS.setdefault(clave, []).append(time.time())


def limpiar_fallos(clave: str) -> None:
    _FALLOS.pop(clave, None)


def login_required(f):
    @wraps(f)
    def wrapper(*a, **k):
        header = request.headers.get("Authorization", "")
        if not header.startswith("Bearer "):
            return jsonify(error="Inicia sesión para continuar."), 401
        try:
            payload = jwt.decode(header[7:], current_app.config["JWT_SECRET"], algorithms=["HS256"])
        except jwt.PyJWTError:
            return jsonify(error="Tu sesión expiró. Inicia sesión nuevamente."), 401
        g.user_id = payload["sub"]
        return f(*a, **k)
    return wrapper
