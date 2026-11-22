"""Días hábiles de Chile.

Usa la biblioteca `holidays` (fuente autoritativa, como pide el diseño del
proyecto) cuando está instalada. Si no lo está, usa un calendario nacional de
referencia 2026-2027 y se niega a calcular fuera de ese rango.
"""
from __future__ import annotations

from datetime import date, timedelta
from functools import lru_cache

try:  # pragma: no cover - depende del entorno
    import holidays as _holidays
except ImportError:  # pragma: no cover
    _holidays = None

_FIJOS = {"01-01", "05-01", "05-21", "07-16", "08-15", "09-18", "09-19", "10-31", "11-01", "12-08", "12-25"}
_REFERENCIA = {
    "2026-04-03", "2026-04-04", "2026-06-21", "2026-06-29", "2026-10-12",
    "2027-03-26", "2027-03-27", "2027-06-21", "2027-06-28", "2027-09-17", "2027-10-11",
}


class CalendarioNoSoportado(ValueError):
    pass


def fuente() -> str:
    return "holidays" if _holidays else "referencia-2026-2027"


@lru_cache(maxsize=32)
def _feriados(anio: int):
    return _holidays.country_holidays("CL", years=anio)


def es_feriado(d: date) -> bool:
    if _holidays:
        return d in _feriados(d.year)
    if d.year not in (2026, 2027):
        raise CalendarioNoSoportado(
            "Sin la biblioteca 'holidays' el calendario solo cubre 2026 y 2027. Instálala para otras fechas."
        )
    return d.strftime("%m-%d") in _FIJOS or d.isoformat() in _REFERENCIA


def es_habil(d: date) -> bool:
    return d.weekday() < 5 and not es_feriado(d)


def sumar_dias_habiles(inicio: date, dias: int) -> date:
    """El día 1 es el primer día hábil POSTERIOR a la fecha de inicio."""
    es_habil(inicio)  # valida que el calendario cubra la fecha, incluso con 0 días
    actual, restantes = inicio, dias
    while restantes > 0:
        actual += timedelta(days=1)
        if es_habil(actual):
            restantes -= 1
    return actual


def sumar_dias_corridos(inicio: date, dias: int) -> date:
    return inicio + timedelta(days=dias)
