"""Plazos, montos y secuencia segura. Todo se calcula en código: nunca con un LLM."""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from zoneinfo import ZoneInfo

from . import calendario

MAX_MONTO = 10**12


def hoy_santiago() -> date:
    return datetime.now(ZoneInfo("America/Santiago")).date()


def _entero(valor, nombre: str, minimo: int = 0) -> int:
    if isinstance(valor, bool) or not isinstance(valor, int) or valor < minimo or valor > MAX_MONTO:
        raise ValueError(f"{nombre} debe ser un entero en pesos, mayor o igual a {minimo}.")
    return valor


def calcular_vencimiento(fecha_venta: date, dias: int, tipo: str = "habiles") -> date:
    if isinstance(dias, bool) or not isinstance(dias, int) or not 0 <= dias <= 365:
        raise ValueError("El plazo debe ser un entero entre 0 y 365 días.")
    if tipo == "corridos":
        return calendario.sumar_dias_corridos(fecha_venta, dias)
    if tipo != "habiles":
        raise ValueError("El tipo de días debe ser 'habiles' o 'corridos'.")
    return calendario.sumar_dias_habiles(fecha_venta, dias)


def puntos_base(comision_pct) -> int:
    """Porcentaje con hasta dos decimales -> puntos base (5 % = 500)."""
    try:
        pct = Decimal(str(comision_pct))
    except InvalidOperation as e:
        raise ValueError("La comisión debe estar entre 0 y 100 %.") from e
    if isinstance(comision_pct, bool) or not pct.is_finite() or pct < 0 or pct > 100:
        raise ValueError("La comisión debe estar entre 0 y 100 %.")
    return int((pct * 100).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def calcular_saldo(precio: int, comision_pct, pagos: list[int]) -> dict:
    precio = _entero(precio, "El precio")
    bp = puntos_base(comision_pct)
    pagos = [_entero(p, "Cada pago") for p in pagos]
    comision = (precio * bp * 2 + 10_000) // 20_000  # redondeo al peso, mitades hacia arriba
    neto = precio - comision
    total = sum(pagos)
    return {"comision": comision, "neto": neto, "total_pagado": total, "saldo": max(0, neto - total)}


def estado_consignacion(
    *, fecha_venta: date, dias_pago: int, tipo_dias: str, precio: int, comision_pct,
    pagos: list[tuple[date, int]], fecha_traspaso: date | None = None, hoy: date | None = None,
) -> dict:
    hoy = hoy or hoy_santiago()
    vencimiento = calcular_vencimiento(fecha_venta, dias_pago, tipo_dias)
    fin = calcular_saldo(precio, comision_pct, [m for _, m in pagos])
    pagado = fin["saldo"] == 0
    vencido = (not pagado) and hoy > vencimiento  # pagar el último día NO es vencido
    parcial = fin["total_pagado"] > 0 and not pagado
    inseguro = False
    if fecha_traspaso:
        pagado_al_traspaso = sum(m for f, m in pagos if f <= fecha_traspaso)
        inseguro = pagado_al_traspaso < fin["neto"]  # un pago posterior no borra el hecho
    avisos = []
    if inseguro:
        avisos.append("Se registró un traspaso antes de confirmar el pago completo.")
    if vencido:
        avisos.append("El plazo de pago venció y existe un saldo pendiente.")
    elif parcial:
        avisos.append("El pago es parcial. Confirma el saldo antes de autorizar el traspaso.")
    estado = (
        "traspaso_inseguro" if inseguro else "pagado" if pagado else "vencido" if vencido
        else "parcial" if parcial else "pendiente"
    )
    return {
        **fin, "vencimiento": vencimiento, "pagado": pagado, "vencido": vencido, "parcial": parcial,
        "traspaso_inseguro": inseguro, "estado": estado,
        "reclamable": (not pagado) and (vencido or inseguro), "avisos": avisos,
        "calendario": calendario.fuente(),
    }
