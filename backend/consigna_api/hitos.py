"""Reglas de los hitos y de la secuencia segura (entrega, venta, pago, traspaso)."""
from __future__ import annotations

from datetime import date

from . import calendario, plazos

TIPOS = ("entrega", "venta", "pago", "traspaso")


class HitoError(Exception):
    def __init__(self, codigo: str, mensaje: str, status: int = 422, extra: dict | None = None):
        super().__init__(mensaje)
        self.codigo, self.mensaje, self.status, self.extra = codigo, mensaje, status, extra or {}


def clp(n: int) -> str:
    return "$" + f"{n:,}".replace(",", ".")


def validar_hito(contrato: dict, hitos: list[dict], *, tipo: str, fecha: date, monto, hoy: date, confirmar: bool) -> list[str]:
    """Lanza HitoError si el hito no es válido. Devuelve las advertencias a mostrar."""
    if tipo not in TIPOS:
        raise HitoError("tipo_invalido", "El tipo de hito debe ser entrega, venta, pago o traspaso.")
    if fecha > hoy:
        raise HitoError("fecha_futura", "Los hitos deben corresponder a hechos ocurridos, no a fechas futuras.")
    if tipo != "entrega" and not any(h["tipo"] == "entrega" and h["fecha"] <= fecha for h in hitos):
        raise HitoError("falta_entrega", "Registra primero la entrega del vehículo con una fecha anterior o igual a este hito.")
    if tipo in ("pago", "traspaso") and not any(h["tipo"] == "venta" and h["fecha"] <= fecha for h in hitos):
        raise HitoError("falta_venta", "Registra primero la venta informada para esa fecha.")
    if tipo != "pago" and any(h["tipo"] == tipo for h in hitos):
        raise HitoError("duplicado", "Este hito ya está registrado en el contrato.", 409)
    avisos: list[str] = []
    if tipo == "venta":
        try:
            plazos.calcular_vencimiento(fecha, contrato["dias_pago"], contrato["tipo_dias"])
        except (calendario.CalendarioNoSoportado, ValueError) as e:
            raise HitoError("calendario", str(e)) from e
    pagos = [(h["fecha"], h["monto"] or 0) for h in hitos if h["tipo"] == "pago"]
    if tipo == "pago":
        if isinstance(monto, bool) or not isinstance(monto, int) or monto < 1:
            raise HitoError("monto_invalido", "Ingresa un pago válido en pesos enteros.")
        saldo = plazos.calcular_saldo(contrato["precio"], contrato["comision_pct"], [m for _, m in pagos])["saldo"]
        if monto > saldo:
            raise HitoError("pago_excede_saldo", f"El pago supera el saldo pendiente de {clp(saldo)}.")
    if tipo == "traspaso":
        pendiente = plazos.calcular_saldo(
            contrato["precio"], contrato["comision_pct"], [m for f, m in pagos if f <= fecha])["saldo"]
        if pendiente > 0:
            aviso = (f"La secuencia segura no se ha cumplido: al {fecha.isoformat()} faltan {clp(pendiente)} "
                     "para completar el pago. Registrar un traspaso no lo autoriza.")
            if not confirmar:
                raise HitoError("traspaso_sin_pago", aviso, 409, {"saldo_pendiente": pendiente, "requiere_confirmacion": True})
            avisos.append(aviso)
    return avisos
