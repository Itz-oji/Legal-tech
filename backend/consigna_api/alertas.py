"""Alertas por correo: vencimiento próximo, plazo vencido y traspaso sin pago confirmado."""
from __future__ import annotations

import logging
import smtplib
import threading
from dataclasses import dataclass
from datetime import date, datetime
from zoneinfo import ZoneInfo
from email.message import EmailMessage

from . import informes, repos
from .hitos import clp

log = logging.getLogger("consigna.alertas")
AVISOS_ANTICIPADOS = (3, 1, 0)  # días corridos antes del vencimiento


@dataclass
class Alerta:
    tipo: str
    clave: str  # evita enviar dos veces la misma alerta
    asunto: str
    cuerpo: str


def calcular_alertas(contrato: dict, hitos: list[dict], hoy: date) -> list[Alerta]:
    est = informes.estado_de(contrato, hitos, hoy)
    if est is None or est["pagado"]:
        return []
    nombre = f"{contrato['vehiculo']} ({contrato['patente']})"
    alertas: list[Alerta] = []
    faltan = (est["vencimiento"] - hoy).days
    if est["traspaso_inseguro"]:
        alertas.append(Alerta("traspaso_sin_pago", "traspaso", f"Traspaso sin pago completo: {nombre}",
            f"Se registró un traspaso de {nombre} antes de confirmar el pago completo. Saldo pendiente: {clp(est['saldo'])}. "
            "Revisa la cronología y conserva tus comprobantes."))
    if est["vencido"]:
        alertas.append(Alerta("vencido", est["vencimiento"].isoformat(), f"Plazo de pago vencido: {nombre}",
            f"El plazo de pago venció el {informes.fecha_larga(est['vencimiento'])} y quedan {clp(est['saldo'])} por recibir. "
            "Ya puedes generar el informe y el borrador de reclamo desde la plataforma."))
    elif faltan in AVISOS_ANTICIPADOS:
        cuando = "vence hoy" if faltan == 0 else f"vence en {faltan} día(s)"
        alertas.append(Alerta("vence_pronto", f"d{faltan}", f"El pago de {nombre} {cuando}",
            f"El plazo de pago {cuando} ({informes.fecha_larga(est['vencimiento'])}). Saldo pendiente: {clp(est['saldo'])}."))
    return alertas


class EnviadorSMTP:
    def __init__(self, host: str, port: int = 587, usuario: str = "", clave: str = "", remitente: str = "", starttls: bool = True):
        self.host, self.port, self.usuario, self.clave = host, port, usuario, clave
        self.remitente, self.starttls = remitente or usuario, starttls

    @property
    def configurado(self) -> bool:
        return bool(self.host and self.remitente)

    def enviar(self, destino: str, asunto: str, cuerpo: str) -> bool:
        if not self.configurado:
            return False
        msg = EmailMessage()
        msg["From"], msg["To"], msg["Subject"] = self.remitente, destino, asunto
        msg.set_content(cuerpo + "\n\n—\nOrientación automática; no reemplaza asesoría jurídica.")
        with smtplib.SMTP(self.host, self.port, timeout=20) as s:
            if self.starttls:
                s.starttls()
            if self.usuario:
                s.login(self.usuario, self.clave)
            s.send_message(msg)
        return True


def ejecutar_alertas(db, enviador, hoy: date) -> dict:
    """Envía las alertas pendientes. Solo marca como enviada la que salió bien; el resto se reintenta."""
    enviadas = fallidas = 0
    filas = db.query("SELECT c.id AS cid, u.id AS uid, u.email AS email FROM contracts c JOIN users u ON u.id = c.user_id")
    for fila in filas:
        contrato = repos.obtener_contrato(db, fila["uid"], fila["cid"])
        for a in calcular_alertas(contrato, repos.hitos_de(db, fila["cid"]), hoy):
            if db.one("SELECT 1 AS x FROM alerts_sent WHERE contract_id = ? AND kind = ? AND dedupe_key = ?", (fila["cid"], a.tipo, a.clave)):
                continue
            try:
                if enviador.enviar(fila["email"], a.asunto, a.cuerpo):
                    db.execute("INSERT INTO alerts_sent (contract_id,kind,dedupe_key,sent_at) VALUES (?,?,?,?)",
                               (fila["cid"], a.tipo, a.clave, repos._now()))
                    enviadas += 1
            except Exception as e:  # SMTP caído: no se pierde nada, se reintenta en la próxima ejecución
                log.warning("No se pudo enviar la alerta %s: %s", a.tipo, e)
                fallidas += 1
    return {"enviadas": enviadas, "fallidas": fallidas, "smtp_configurado": enviador.configurado}


class Programador:
    """APScheduler si está instalado; si no, hilos simples con el mismo comportamiento."""

    def __init__(self):
        self._tareas: list[tuple[callable, float]] = []
        self._stop = threading.Event()
        self._aps = None

    def cada(self, segundos: float, fn) -> None:
        self._tareas.append((fn, segundos))

    def iniciar(self) -> None:
        try:
            from apscheduler.schedulers.background import BackgroundScheduler
        except ImportError:
            for fn, seg in self._tareas:
                threading.Thread(target=self._bucle, args=(fn, seg), daemon=True).start()
            return
        self._aps = BackgroundScheduler(timezone="America/Santiago")
        for fn, seg in self._tareas:
            self._aps.add_job(fn, "interval", seconds=seg, max_instances=1, coalesce=True,
                              next_run_time=datetime.now(ZoneInfo("America/Santiago")))
        self._aps.start()

    def _bucle(self, fn, seg: float) -> None:
        while not self._stop.is_set():
            try:
                fn()
            except Exception as e:
                log.warning("Tarea programada falló: %s", e)
            self._stop.wait(seg)

    def detener(self) -> None:
        self._stop.set()
        if self._aps:
            self._aps.shutdown(wait=False)
