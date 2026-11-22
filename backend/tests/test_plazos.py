from datetime import date, timedelta

import pytest

from consigna_api import calendario
from consigna_api.plazos import calcular_saldo, calcular_vencimiento, estado_consignacion


def test_saldo_del_ejemplo_del_paper():
    assert calcular_saldo(9_000_000, 5, [3_000_000]) == {
        "comision": 450_000, "neto": 8_550_000, "total_pagado": 3_000_000, "saldo": 5_550_000}
    assert calcular_saldo(1_234_567, 2.75, [])["comision"] == 33_951
    with pytest.raises(ValueError):
        calcular_saldo(9_000_000, 105, [])
    with pytest.raises(ValueError):
        calcular_saldo(-1, 5, [])
    with pytest.raises(ValueError):
        calcular_saldo(1000, 5, [1.5])


def test_dias_habiles_excluyen_fines_de_semana_y_feriados():
    assert calcular_vencimiento(date(2026, 9, 17), 1) == date(2026, 9, 21)
    assert calcular_vencimiento(date(2026, 12, 24), 1) == date(2026, 12, 28)
    assert calcular_vencimiento(date(2026, 9, 17), 1, "corridos") == date(2026, 9, 18)
    with pytest.raises(ValueError):
        calcular_vencimiento(date(2026, 9, 17), 400)


@pytest.mark.skipif(calendario._holidays is not None, reason="usa la biblioteca holidays")
def test_calendario_de_referencia_2027_y_limites():
    assert calcular_vencimiento(date(2027, 6, 25), 1) == date(2027, 6, 29)
    assert calcular_vencimiento(date(2027, 9, 16), 1) == date(2027, 9, 20)
    with pytest.raises(calendario.CalendarioNoSoportado):
        calcular_vencimiento(date(2030, 1, 4), 1)


BASE = dict(fecha_venta=date(2026, 11, 2), dias_pago=15, tipo_dias="habiles", precio=9_000_000, comision_pct=5)


def test_casos_limite_de_estado():
    venc = calcular_vencimiento(date(2026, 11, 2), 15)
    ultimo_dia = estado_consignacion(**BASE, pagos=[(venc, 8_550_000)], hoy=venc)
    assert ultimo_dia["estado"] == "pagado" and not ultimo_dia["reclamable"]
    sin_vencer = estado_consignacion(**BASE, pagos=[(date(2026, 11, 5), 3_000_000)], hoy=venc)
    assert sin_vencer["estado"] == "parcial" and not sin_vencer["reclamable"]
    vencido = estado_consignacion(**BASE, pagos=[(date(2026, 11, 5), 3_000_000)], hoy=venc + timedelta(days=1))
    assert vencido["estado"] == "vencido" and vencido["reclamable"] and vencido["saldo"] == 5_550_000
    inseguro = estado_consignacion(**BASE, pagos=[], fecha_traspaso=date(2026, 11, 6), hoy=date(2026, 11, 7))
    assert inseguro["estado"] == "traspaso_inseguro" and inseguro["reclamable"]
    tarde = estado_consignacion(**BASE, pagos=[(date(2026, 11, 10), 8_550_000)], fecha_traspaso=date(2026, 11, 6), hoy=date(2026, 11, 11))
    assert tarde["traspaso_inseguro"] is True  # el pago posterior no borra el hecho
