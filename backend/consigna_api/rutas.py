"""Endpoints de usuarios, contratos, hitos, evidencias, informes y alertas."""
from __future__ import annotations

import json
import sqlite3
from datetime import date

from flask import Blueprint, current_app, g, jsonify, request, send_file
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from . import alertas, auth, engine, informes, plazos, repos
from .evidencias import EvidenciaInvalida
from .hitos import HitoError, validar_hito

bp = Blueprint("api_v2", __name__)


def S():
    return current_app.extensions["services"]


def error(msg: str, status: int = 400, **extra):
    return jsonify(error=msg, **extra), status


def cuerpo() -> dict:
    if request.mimetype == "multipart/form-data":
        return request.form.to_dict()
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


def verdadero(v) -> bool:
    return v is True or str(v).lower() in ("1", "true", "si", "sí", "on")


class ContratoIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="ignore")
    vehiculo: str = Field(min_length=2, max_length=120)
    patente: str = Field(min_length=3, max_length=12)
    automotora: str = Field(min_length=2, max_length=160)
    precio: int = Field(ge=1, le=10**12)
    comision_pct: float = Field(ge=0, le=100)
    dias_pago: int = Field(ge=0, le=365)
    tipo_dias: str = "habiles"
    texto: str = Field(default="", max_length=100_000)

    @field_validator("tipo_dias")
    @classmethod
    def _tipo(cls, v):
        if v not in ("habiles", "corridos"):
            raise ValueError("debe ser 'habiles' o 'corridos'")
        return v


def errores_pydantic(e: ValidationError):
    campos = [{"campo": ".".join(str(x) for x in err["loc"]), "mensaje": err["msg"]} for err in e.errors()]
    return error("Revisa los datos ingresados.", 422, detalles=campos)


# ---- usuarios --------------------------------------------------------------
@bp.post("/api/auth/register")
def register():
    d = cuerpo()
    problema = auth.validar_registro(d.get("email"), d.get("nombre"), d.get("password"))
    if problema:
        return error(problema, 422)
    email = d["email"].strip().lower()
    try:
        u = repos.crear_usuario(S().db, email, d["nombre"].strip(), auth.hash_password(d["password"]))
    except Exception as e:  # correo repetido (UNIQUE) en SQLite o PostgreSQL
        if "unique" in str(e).lower() or isinstance(e, sqlite3.IntegrityError):
            return error("No se pudo crear la cuenta con ese correo.", 409)
        raise
    return jsonify(token=auth.emitir_token(u["id"]), usuario=u), 201


@bp.post("/api/auth/login")
def login():
    d = cuerpo()
    email = str(d.get("email", "")).strip().lower()
    clave = f"{request.remote_addr}|{email}"
    if auth.bloqueado(clave):
        return error("Demasiados intentos. Espera unos minutos.", 429)
    u = repos.usuario_por_email(S().db, email)
    if not u or not auth.verificar_password(u["password_hash"], str(d.get("password", ""))):
        auth.registrar_fallo(clave)
        return error("Correo o contraseña incorrectos.", 401)
    auth.limpiar_fallos(clave)
    return jsonify(token=auth.emitir_token(u["id"]), usuario={"id": u["id"], "email": u["email"], "nombre": u["name"]})


@bp.get("/api/me")
@auth.login_required
def me():
    u = repos.usuario_por_id(S().db, g.user_id)
    return jsonify(id=u["id"], email=u["email"], nombre=u["name"]) if u else error("Usuario no encontrado.", 404)


# ---- contratos -------------------------------------------------------------
def _contrato_o_404(cid):
    c = repos.obtener_contrato(S().db, g.user_id, cid)
    return c, (None if c else error("Contrato no encontrado.", 404))


def _salida(c: dict) -> dict:
    return {k: v for k, v in c.items() if k != "user_id"}


@bp.post("/api/contracts")
@auth.login_required
def crear_contrato():
    try:
        d = ContratoIn(**cuerpo())
    except ValidationError as e:
        return errores_pydantic(e)
    except TypeError:
        return error("Datos inválidos.", 422)
    try:
        bp_ = plazos.puntos_base(d.comision_pct)
    except ValueError as e:
        return error(str(e), 422)
    c = repos.crear_contrato(S().db, g.user_id, {**d.model_dump(), "comision_bp": bp_})
    return jsonify(_salida(c)), 201


@bp.get("/api/contracts")
@auth.login_required
def listar():
    return jsonify(contratos=[_salida(c) for c in repos.listar_contratos(S().db, g.user_id)])


@bp.get("/api/contracts/<cid>")
@auth.login_required
def detalle(cid):
    c, err = _contrato_o_404(cid)
    if err:
        return err
    hitos = repos.hitos_de(S().db, cid)
    est = informes.estado_de(c, hitos, S().hoy())
    return jsonify(contrato=_salida(c), hitos=hitos, estado=est)


@bp.delete("/api/contracts/<cid>")
@auth.login_required
def borrar(cid):
    c, err = _contrato_o_404(cid)
    if err:
        return err
    for uid, nombre in repos.borrar_contrato(S().db, g.user_id, cid):
        S().almacen.borrar(uid, nombre)
    return "", 204


@bp.post("/api/contracts/<cid>/analyze")
@auth.login_required
def analizar_guardado(cid):
    c, err = _contrato_o_404(cid)
    if err:
        return err
    if len(c["texto"].strip()) < 40:
        return error("El contrato no tiene texto suficiente para evaluar.", 422)
    doc = current_app.extensions["store"].current()
    flags = current_app.extensions["monitor"].review_flags()
    return jsonify(criteria_version=doc["version"], findings=engine.analyze(c["texto"], doc, flags), review_pending=bool(flags))


# ---- hitos y evidencias ----------------------------------------------------
@bp.get("/api/contracts/<cid>/milestones")
@auth.login_required
def listar_hitos(cid):
    c, err = _contrato_o_404(cid)
    return err or jsonify(hitos=repos.hitos_de(S().db, cid))


@bp.post("/api/contracts/<cid>/milestones")
@auth.login_required
def crear_hito(cid):
    c, err = _contrato_o_404(cid)
    if err:
        return err
    d = cuerpo()
    try:
        fecha = date.fromisoformat(str(d.get("fecha", "")))
    except ValueError:
        return error("La fecha debe usar el formato AAAA-MM-DD.", 422)
    monto = d.get("monto")
    if monto not in (None, ""):
        try:
            monto = int(monto) if not isinstance(monto, bool) and float(monto) == int(float(monto)) else None
        except (TypeError, ValueError):
            monto = None
    else:
        monto = None
    tipo = str(d.get("tipo", ""))
    hitos = repos.hitos_de(S().db, cid)
    try:
        avisos = validar_hito(c, hitos, tipo=tipo, fecha=fecha, monto=monto, hoy=S().hoy(), confirmar=verdadero(d.get("confirmar")))
    except HitoError as e:
        return error(e.mensaje, e.status, codigo=e.codigo, **e.extra)
    evidencia, guardado = None, None
    archivo = request.files.get("archivo")
    try:
        if archivo:
            meta = S().almacen.guardar(g.user_id, archivo.filename or "", archivo.read())
            guardado = meta["stored_name"]
            evidencia = repos.crear_evidencia(S().db, g.user_id, cid, meta)
        h = repos.crear_hito(S().db, cid, tipo, fecha, monto if tipo == "pago" else None, str(d.get("nota", ""))[:500], evidencia["id"] if evidencia else None)
    except EvidenciaInvalida as e:
        return error(str(e), 422)
    except Exception:
        if guardado:
            S().almacen.borrar(g.user_id, guardado)
        raise
    est = informes.estado_de(c, repos.hitos_de(S().db, cid), S().hoy())
    return jsonify(hito=h, evidencia=evidencia, advertencias=avisos, estado=est), 201


@bp.get("/api/evidences/<eid>")
@auth.login_required
def descargar(eid):
    e = repos.obtener_evidencia(S().db, g.user_id, eid)
    if not e:
        return error("Archivo no encontrado.", 404)
    ruta = S().almacen.ruta(g.user_id, e["stored_name"])
    if not ruta.exists():
        return error("El archivo ya no está disponible.", 404)
    return send_file(ruta, mimetype=e["mime"], as_attachment=True, download_name=e["filename"])


# ---- informe y reclamo -----------------------------------------------------
def _informe(cid):
    c, err = _contrato_o_404(cid)
    if err:
        return None, err
    hitos = repos.hitos_de(S().db, cid)
    return informes.construir_informe(c, hitos, repos.evidencias_de(S().db, cid), S().hoy()), None


@bp.get("/api/contracts/<cid>/report")
@auth.login_required
def informe(cid):
    inf, err = _informe(cid)
    if err:
        return err
    inf = json.loads(json.dumps(inf, default=str))
    inf["contrato"].pop("user_id", None)
    return jsonify(inf)


@bp.post("/api/contracts/<cid>/claims")
@auth.login_required
def reclamo(cid):
    inf, err = _informe(cid)
    if err:
        return err
    d = cuerpo()
    audiencia = str(d.get("audiencia", "automotora"))
    if audiencia not in informes.AUDIENCIAS:
        return error("La audiencia debe ser 'automotora' o 'sernac'.", 422)
    if not inf["reclamable"]:
        return error(inf["motivo"], 409, reclamable=False)
    texto = informes.borrador(audiencia, inf)
    rid = repos.guardar_reclamo(S().db, cid, audiencia, texto, {"saldo": inf["estado"]["saldo"], "estado": inf["estado"]["estado"]})
    return jsonify(id=rid, audiencia=audiencia, borrador=texto, pasos=informes.pasos_recomendados(audiencia), aviso=informes.AVISO), 201


@bp.get("/api/contracts/<cid>/report.pdf")
@auth.login_required
def informe_pdf(cid):
    inf, err = _informe(cid)
    if err:
        return err
    audiencia = request.args.get("audiencia", "automotora")
    if audiencia not in informes.AUDIENCIAS:
        return error("La audiencia debe ser 'automotora' o 'sernac'.", 422)
    if not inf["reclamable"]:
        return error(inf["motivo"], 409, reclamable=False)
    texto = informes.borrador(audiencia, inf)
    import io
    pdf = informes.generar_pdf(inf, texto, audiencia)
    return send_file(io.BytesIO(pdf), mimetype="application/pdf", as_attachment=True, download_name=f"informe-{audiencia}.pdf")


# ---- administración --------------------------------------------------------
@bp.post("/api/admin/alerts/run")
def correr_alertas():
    denegado = current_app.extensions["admin_only"]()
    if denegado:
        return denegado
    return jsonify(alertas.ejecutar_alertas(S().db, S().enviador, S().hoy()))
