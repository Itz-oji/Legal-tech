"""Almacén de evidencias (contratos y comprobantes) en disco, referenciadas desde la base de datos."""
from __future__ import annotations

import hashlib
import uuid
from pathlib import Path

MAX_BYTES = 10 * 1024 * 1024
TIPOS = {  # extensión -> (mime, firma inicial)
    ".pdf": ("application/pdf", (b"%PDF-",)),
    ".png": ("image/png", (b"\x89PNG\r\n\x1a\n",)),
    ".jpg": ("image/jpeg", (b"\xff\xd8\xff",)),
    ".jpeg": ("image/jpeg", (b"\xff\xd8\xff",)),
    ".txt": ("text/plain", ()),
}


class EvidenciaInvalida(ValueError):
    pass


class Almacen:
    def __init__(self, base: Path):
        self.base = Path(base)
        self.base.mkdir(parents=True, exist_ok=True)

    def guardar(self, user_id: str, nombre: str, datos: bytes) -> dict:
        if not datos:
            raise EvidenciaInvalida("El archivo está vacío.")
        if len(datos) > MAX_BYTES:
            raise EvidenciaInvalida("El archivo supera el límite de 10 MB.")
        ext = Path(nombre or "").suffix.lower()
        if ext not in TIPOS:
            raise EvidenciaInvalida("Formato no permitido. Usa PDF, PNG, JPG o TXT.")
        mime, firmas = TIPOS[ext]
        if firmas and not any(datos.startswith(f) for f in firmas):
            raise EvidenciaInvalida("El contenido del archivo no corresponde a su extensión.")
        stored = uuid.uuid4().hex + ext  # nunca se usa el nombre que envía el cliente en disco
        carpeta = self.base / user_id
        carpeta.mkdir(exist_ok=True)
        (carpeta / stored).write_bytes(datos)
        return {"filename": Path(nombre).name[:200], "mime": mime, "size": len(datos),
                "sha256": hashlib.sha256(datos).hexdigest(), "stored_name": stored}

    def ruta(self, user_id: str, stored_name: str) -> Path:
        p = (self.base / user_id / stored_name).resolve()
        if self.base.resolve() not in p.parents:
            raise EvidenciaInvalida("Ruta no válida.")
        return p

    def borrar(self, user_id: str, stored_name: str) -> None:
        try:
            self.ruta(user_id, stored_name).unlink(missing_ok=True)
        except EvidenciaInvalida:
            pass
