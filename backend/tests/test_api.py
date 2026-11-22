import io
import json
from datetime import date, timedelta

import pytest
from pypdf import PdfReader

from consigna_api.alertas import calcular_alertas, ejecutar_alertas
from consigna_api.app import create_app

HOY = {"d": date(2026, 11, 30)}


class Correo:
    configurado = True

    def __init__(self):
        self.enviados = []

    def enviar(self, destino, asunto, cuerpo):
        self.enviados.append((destino, asunto))
        return True


@pytest.fixture
def ctx(tmp_path):
    HOY["d"] = date(2026, 11, 30)
    correo = Correo()
    app = create_app({"DATA_DIR": str(tmp_path), "ADMIN_TOKEN": "adm", "SYNC_INTERVAL_HOURS": 0, "ALERT_INTERVAL_MINUTES": 0,
                      "JWT_SECRET": "x" * 40, "TODAY": lambda: HOY["d"], "SENDER": correo})
    return app, app.test_client(), correo


def registrar(client, email="ana@example.com"):
    r = client.post("/api/auth/register", json={"email": email, "nombre": "Ana Pérez", "password": "una-clave-larga-1"})
    assert r.status_code == 201, r.get_data(as_text=True)
    return {"Authorization": "Bearer " + r.get_json()["token"]}


CONTRATO = dict(vehiculo="Mazda CX-5", patente="RTHC64", automotora="Automotora Sur", precio=9_000_000,
                comision_pct=5, dias_pago=15, tipo_dias="habiles", texto="Pago a 60 días hábiles. " * 3)


def nuevo_contrato(client, h):
    r = client.post("/api/contracts", json=CONTRATO, headers=h)
    assert r.status_code == 201, r.get_data(as_text=True)
    return r.get_json()["id"]


def hito(client, h, cid, tipo, fecha, **extra):
    return client.post(f"/api/contracts/{cid}/milestones", json={"tipo": tipo, "fecha": fecha, **extra}, headers=h)


def venta_y_entrega(client, h, cid):
    assert hito(client, h, cid, "entrega", "2026-10-28").status_code == 201
    assert hito(client, h, cid, "venta", "2026-11-02").status_code == 201


def test_usuarios_y_autorizacion(ctx):
    app, c, *_ = ctx
    assert c.get("/api/contracts").status_code == 401
    assert c.post("/api/auth/register", json={"email": "x@y.cl", "nombre": "Ana", "password": "corta"}).status_code == 422
    h = registrar(c)
    assert c.post("/api/auth/register", json={"email": "ANA@example.com", "nombre": "Otra", "password": "una-clave-larga-1"}).status_code == 409
    assert c.post("/api/auth/login", json={"email": "ana@example.com", "password": "mala"}).status_code == 401
    assert c.post("/api/auth/login", json={"email": "ana@example.com", "password": "una-clave-larga-1"}).status_code == 200
    assert c.get("/api/me", headers=h).get_json()["email"] == "ana@example.com"
    cid = nuevo_contrato(c, h)
    otro = registrar(c, "beto@example.com")
    assert c.get(f"/api/contracts/{cid}", headers=otro).status_code == 404
    assert c.get("/api/contracts", headers=otro).get_json()["contratos"] == []
    assert hito(c, otro, cid, "entrega", "2026-10-28").status_code == 404


def test_validacion_de_contrato(ctx):
    _, c, *_ = ctx
    h = registrar(c)
    assert c.post("/api/contracts", json={**CONTRATO, "precio": -5}, headers=h).status_code == 422
    assert c.post("/api/contracts", json={**CONTRATO, "comision_pct": 150}, headers=h).status_code == 422
    assert c.post("/api/contracts", json={**CONTRATO, "tipo_dias": "x"}, headers=h).status_code == 422


def test_reglas_de_hitos(ctx):
    _, c, *_ = ctx
    h = registrar(c)
    cid = nuevo_contrato(c, h)
    assert hito(c, h, cid, "venta", "2026-11-02").get_json()["codigo"] == "falta_entrega"
    assert hito(c, h, cid, "entrega", "2026-12-15").get_json()["codigo"] == "fecha_futura"
    venta_y_entrega(c, h, cid)
    assert hito(c, h, cid, "venta", "2026-11-03").status_code == 409
    assert hito(c, h, cid, "pago", "2026-11-05", monto=0).status_code == 422
    assert hito(c, h, cid, "pago", "2026-11-05", monto=9_000_000).get_json()["codigo"] == "pago_excede_saldo"
    r = hito(c, h, cid, "pago", "2026-11-05", monto=3_000_000)
    assert r.status_code == 201 and r.get_json()["estado"]["saldo"] == 5_550_000
    assert r.get_json()["hito"]["fecha"] == "2026-11-05"  # fechas ISO, no formato HTTP
    det = c.get(f"/api/contracts/{cid}", headers=h).get_json()
    assert det["estado"]["vencimiento"] == "2026-11-23" and det["hitos"][0]["fecha"] == "2026-10-28"


def test_informe_reclamo_y_pdf(ctx):
    _, c, _ = ctx
    h = registrar(c)
    cid = nuevo_contrato(c, h)
    assert c.post(f"/api/contracts/{cid}/claims", json={}, headers=h).status_code == 409  # sin venta
    venta_y_entrega(c, h, cid)
    HOY["d"] = date(2026, 11, 10)  # el plazo (23-nov) aún no vence
    r = c.post(f"/api/contracts/{cid}/claims", json={}, headers=h)
    assert r.status_code == 409 and "aún no vence" in r.get_json()["error"]
    HOY["d"] = date(2026, 11, 30)
    hito(c, h, cid, "pago", "2026-11-05", monto=3_000_000)
    inf = c.get(f"/api/contracts/{cid}/report", headers=h).get_json()
    assert inf["reclamable"] and inf["estado"]["saldo"] == 5_550_000 and inf["estado"]["vencimiento"] == "2026-11-23"
    r = c.post(f"/api/contracts/{cid}/claims", json={"audiencia": "sernac"}, headers=h).get_json()
    assert "$5.550.000" in r["borrador"] and "SERNAC" in r["borrador"] and "Código Civil, art. 1545" in r["borrador"]
    pdf = c.get(f"/api/contracts/{cid}/report.pdf?audiencia=automotora", headers=h)
    assert pdf.status_code == 200 and pdf.data.startswith(b"%PDF")
    texto = "".join(p.extract_text() for p in PdfReader(io.BytesIO(pdf.data)).pages)
    assert "5.550.000" in texto and "Cronolog" in texto
    hito(c, h, cid, "pago", "2026-11-20", monto=5_550_000)  # pago completo: ya no hay reclamo
    assert c.post(f"/api/contracts/{cid}/claims", json={}, headers=h).status_code == 409
    assert c.get(f"/api/contracts/{cid}/report.pdf", headers=h).status_code == 409


def test_traspaso_sin_pago_exige_confirmacion(ctx):
    _, c, *_ = ctx
    h = registrar(c)
    cid = nuevo_contrato(c, h)
    venta_y_entrega(c, h, cid)
    r = hito(c, h, cid, "traspaso", "2026-11-06")
    assert r.status_code == 409 and r.get_json()["codigo"] == "traspaso_sin_pago" and r.get_json()["saldo_pendiente"] == 8_550_000
    r = hito(c, h, cid, "traspaso", "2026-11-06", confirmar=True)
    assert r.status_code == 201 and r.get_json()["estado"]["estado"] == "traspaso_inseguro" and r.get_json()["advertencias"]


def test_traspaso_con_pago_completo_no_advierte(ctx):
    _, c, *_ = ctx
    h = registrar(c)
    cid = nuevo_contrato(c, h)
    venta_y_entrega(c, h, cid)
    hito(c, h, cid, "pago", "2026-11-05", monto=8_550_000)
    r = hito(c, h, cid, "traspaso", "2026-11-06")
    assert r.status_code == 201 and r.get_json()["advertencias"] == []


def test_evidencias(ctx):
    _, c, *_ = ctx
    h = registrar(c)
    cid = nuevo_contrato(c, h)
    pdf = b"%PDF-1.4 comprobante"
    r = c.post(f"/api/contracts/{cid}/milestones", headers=h, content_type="multipart/form-data",
               data={"tipo": "entrega", "fecha": "2026-10-28", "archivo": (io.BytesIO(pdf), "acta.pdf")})
    assert r.status_code == 201
    eid = r.get_json()["evidencia"]["id"]
    d = c.get(f"/api/evidences/{eid}", headers=h)
    assert d.status_code == 200 and d.data == pdf
    assert c.get(f"/api/evidences/{eid}", headers=registrar(c, "otro@example.com")).status_code == 404
    malo = c.post(f"/api/contracts/{cid}/milestones", headers=h, content_type="multipart/form-data",
                  data={"tipo": "venta", "fecha": "2026-11-02", "archivo": (io.BytesIO(b"MZ binario"), "virus.exe")})
    assert malo.status_code == 422
    falso = c.post(f"/api/contracts/{cid}/milestones", headers=h, content_type="multipart/form-data",
                   data={"tipo": "venta", "fecha": "2026-11-02", "archivo": (io.BytesIO(b"no soy pdf"), "x.pdf")})
    assert falso.status_code == 422
    assert c.delete(f"/api/contracts/{cid}", headers=h).status_code == 204
    assert c.get(f"/api/evidences/{eid}", headers=h).status_code == 404


def test_alertas_por_correo_sin_duplicados(ctx):
    app, c, correo = ctx
    h = registrar(c)
    cid = nuevo_contrato(c, h)
    venta_y_entrega(c, h, cid)  # vence el 23-nov
    services = app.extensions["services"]
    HOY["d"] = date(2026, 11, 20)  # faltan 3 días
    assert ejecutar_alertas(services.db, correo, HOY["d"])["enviadas"] == 1
    assert ejecutar_alertas(services.db, correo, HOY["d"])["enviadas"] == 0  # misma alerta: no se repite
    HOY["d"] = date(2026, 11, 30)
    assert ejecutar_alertas(services.db, correo, HOY["d"])["enviadas"] == 1
    assert [a for _, a in correo.enviados][-1].startswith("Plazo de pago vencido")

    class Roto:
        configurado = True
        def enviar(self, *a): raise OSError("smtp caído")
    cid2 = nuevo_contrato(c, registrar(c, "luz@example.com"))
    h2 = {"Authorization": "Bearer " + c.post("/api/auth/login", json={"email": "luz@example.com", "password": "una-clave-larga-1"}).get_json()["token"]}
    venta_y_entrega(c, h2, cid2)
    r = ejecutar_alertas(services.db, Roto(), HOY["d"])
    assert r["enviadas"] == 0 and r["fallidas"] == 1  # el fallo no rompe ni marca la alerta como enviada
    assert ejecutar_alertas(services.db, correo, HOY["d"])["enviadas"] == 1  # se reintenta y sale


def test_alertas_puras():
    contrato = dict(vehiculo="Auto", patente="AB1234", dias_pago=15, tipo_dias="habiles", precio=9_000_000, comision_pct=5)
    assert calcular_alertas(contrato, [], date(2026, 11, 30)) == []
    venta = [dict(tipo="venta", fecha=date(2026, 11, 2), monto=None, nota="", evidencia_id=None)]
    assert calcular_alertas(contrato, venta, date(2026, 11, 10)) == []
    assert calcular_alertas(contrato, venta, date(2026, 11, 22))[0].tipo == "vence_pronto"
    pago = venta + [dict(tipo="pago", fecha=date(2026, 11, 5), monto=8_550_000, nota="", evidencia_id=None)]
    assert calcular_alertas(contrato, pago, date(2026, 11, 30)) == []


def test_analizar_contrato_guardado(ctx):
    _, c, *_ = ctx
    h = registrar(c)
    cid = nuevo_contrato(c, h)
    r = c.post(f"/api/contracts/{cid}/analyze", headers=h).get_json()
    assert {f["id"]: f for f in r["findings"]}["payment-term"]["level"] == "alto"


def test_modo_demo(tmp_path):
    def app_con(demo):
        return create_app({"DATA_DIR": str(tmp_path / str(demo)), "SYNC_INTERVAL_HOURS": 0, "ALERT_INTERVAL_MINUTES": 0,
                           "JWT_SECRET": "x" * 40, "TODAY": lambda: date(2026, 11, 30), "DEMO_MODE": demo})
    assert app_con(False).test_client().post("/api/auth/demo").status_code == 404
    c = app_con(True).test_client()
    a, b = c.post("/api/auth/demo"), c.post("/api/auth/demo")
    assert a.status_code == b.status_code == 200
    assert a.get_json()["usuario"]["id"] == b.get_json()["usuario"]["id"]  # misma cuenta compartida
    h = {"Authorization": "Bearer " + a.get_json()["token"]}
    assert c.get("/api/me", headers=h).status_code == 200


def test_listado_completo_y_contrato_original(ctx):
    app, c, *_ = ctx
    h = registrar(c)
    cid = nuevo_contrato(c, h)
    venta_y_entrega(c, h, cid)
    r = c.post(f"/api/contracts/{cid}/milestones", headers=h, data={
        "tipo": "pago", "fecha": "2026-11-10", "monto": "1000000", "archivo": (io.BytesIO(b"%PDF-1.4 pago"), "pago.pdf")},
        content_type="multipart/form-data")
    assert r.status_code == 201, r.get_data(as_text=True)
    assert c.get("/api/contracts", headers=h).get_json()["contratos"][0].get("hitos") is None  # sin ?completo=1
    assert c.put(f"/api/contracts/{cid}/original", headers=h).status_code == 422
    for nombre in ("v1.txt", "v2.txt"):  # reemplazar deja un solo original
        r = c.put(f"/api/contracts/{cid}/original", headers=h, data={"archivo": (io.BytesIO(b"Contrato de prueba " + nombre.encode()), nombre)},
                  content_type="multipart/form-data")
        assert r.status_code == 201, r.get_data(as_text=True)
    lista = c.get("/api/contracts?completo=1", headers=h).get_json()["contratos"]
    assert len(lista) == 1
    k = lista[0]
    assert [x["tipo"] for x in k["hitos"]] == ["entrega", "venta", "pago"]
    assert k["original"]["filename"] == "v2.txt"            # el comprobante del pago no se confunde con el original
    assert len(k["evidencias"]) == 2
    assert k["estado"]["saldo"] == 7_550_000                  # 9.000.000 - 5 % - 1.000.000
    d = c.get(f"/api/contracts/{cid}", headers=h).get_json()
    assert d["original"]["filename"] == "v2.txt" and len(d["evidencias"]) == 2
    assert c.get(f"/api/evidences/{k['original']['id']}", headers=h).status_code == 200
