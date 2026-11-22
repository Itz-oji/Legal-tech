"""Consultas de usuarios, contratos, hitos, evidencias y reclamos.
Toda consulta de contratos filtra por usuario: un dueño nunca ve datos ajenos."""
from __future__ import annotations

import json
import uuid
from datetime import date, datetime, timezone

from .db import DB


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _id() -> str:
    return uuid.uuid4().hex


# ---- usuarios --------------------------------------------------------------
def crear_usuario(db: DB, email: str, nombre: str, password_hash: str) -> dict:
    uid = _id()
    db.execute("INSERT INTO users (id,email,name,password_hash,created_at) VALUES (?,?,?,?,?)",
               (uid, email, nombre, password_hash, _now()))
    return {"id": uid, "email": email, "nombre": nombre}


def usuario_por_email(db: DB, email: str) -> dict | None:
    return db.one("SELECT * FROM users WHERE email = ?", (email,))


def usuario_por_id(db: DB, uid: str) -> dict | None:
    return db.one("SELECT id,email,name FROM users WHERE id = ?", (uid,))


# ---- contratos -------------------------------------------------------------
def _contrato(row: dict | None) -> dict | None:
    if not row:
        return None
    return {
        "id": row["id"], "vehiculo": row["vehicle"], "patente": row["plate"], "automotora": row["dealer"],
        "precio": int(row["price"]), "comision_pct": row["commission_bp"] / 100,
        "dias_pago": row["payment_days"], "tipo_dias": row["day_type"],
        "texto": row["contract_text"], "creado": row["created_at"], "user_id": row["user_id"],
    }


def crear_contrato(db: DB, user_id: str, d: dict) -> dict:
    cid = _id()
    db.execute(
        "INSERT INTO contracts (id,user_id,vehicle,plate,dealer,price,commission_bp,payment_days,day_type,contract_text,created_at)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (cid, user_id, d["vehiculo"], d["patente"], d["automotora"], d["precio"], d["comision_bp"],
         d["dias_pago"], d["tipo_dias"], d.get("texto", ""), _now()))
    return obtener_contrato(db, user_id, cid)


def listar_contratos(db: DB, user_id: str) -> list[dict]:
    rows = db.query("SELECT * FROM contracts WHERE user_id = ? ORDER BY created_at DESC", (user_id,))
    return [_contrato(r) for r in rows]


def obtener_contrato(db: DB, user_id: str, cid: str) -> dict | None:
    return _contrato(db.one("SELECT * FROM contracts WHERE id = ? AND user_id = ?", (cid, user_id)))


def borrar_contrato(db: DB, user_id: str, cid: str) -> list[tuple[str, str]]:
    """Devuelve los archivos de evidencia a eliminar del disco."""
    with db.tx() as t:
        if not t.one("SELECT id FROM contracts WHERE id = ? AND user_id = ?", (cid, user_id)):
            return []
        files = [(r["user_id"], r["stored_name"]) for r in t.query("SELECT stored_name,user_id FROM evidences WHERE contract_id = ?", (cid,))]
        for tabla in ("alerts_sent", "claims", "milestones", "evidences"):
            t.execute(f"DELETE FROM {tabla} WHERE contract_id = ?", (cid,))
        t.execute("DELETE FROM contracts WHERE id = ?", (cid,))
    return files


# ---- hitos y evidencias ----------------------------------------------------
def _hito(r: dict) -> dict:
    return {"id": r["id"], "tipo": r["kind"], "fecha": date.fromisoformat(r["occurred_on"]),
            "monto": None if r["amount"] is None else int(r["amount"]), "nota": r["note"],
            "evidencia_id": r["evidence_id"]}


def hitos_de(db: DB, cid: str) -> list[dict]:
    rows = db.query("SELECT * FROM milestones WHERE contract_id = ? ORDER BY occurred_on, created_at", (cid,))
    return [_hito(r) for r in rows]


def crear_hito(db: DB, cid: str, tipo: str, fecha: date, monto: int | None, nota: str, evidencia_id: str | None) -> dict:
    hid = _id()
    db.execute("INSERT INTO milestones (id,contract_id,kind,occurred_on,amount,note,evidence_id,created_at) VALUES (?,?,?,?,?,?,?,?)",
               (hid, cid, tipo, fecha.isoformat(), monto, nota, evidencia_id, _now()))
    return {"id": hid, "tipo": tipo, "fecha": fecha, "monto": monto, "nota": nota, "evidencia_id": evidencia_id}


def crear_evidencia(db: DB, user_id: str, cid: str, meta: dict) -> dict:
    eid = _id()
    db.execute("INSERT INTO evidences (id,contract_id,user_id,filename,mime,size,sha256,stored_name,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
               (eid, cid, user_id, meta["filename"], meta["mime"], meta["size"], meta["sha256"], meta["stored_name"], _now()))
    return {"id": eid, **{k: meta[k] for k in ("filename", "mime", "size", "sha256")}}


def obtener_evidencia(db: DB, user_id: str, eid: str) -> dict | None:
    return db.one("SELECT * FROM evidences WHERE id = ? AND user_id = ?", (eid, user_id))


def evidencias_de(db: DB, cid: str) -> list[dict]:
    return db.query("SELECT id,filename,mime,size,sha256,created_at FROM evidences WHERE contract_id = ?", (cid,))


# ---- reclamos --------------------------------------------------------------
def guardar_reclamo(db: DB, cid: str, audiencia: str, cuerpo: str, hechos: dict) -> str:
    rid = _id()
    db.execute("INSERT INTO claims (id,contract_id,audience,body,facts,created_at) VALUES (?,?,?,?,?,?)",
               (rid, cid, audiencia, cuerpo, json.dumps(hechos, ensure_ascii=False, default=str), _now()))
    return rid
