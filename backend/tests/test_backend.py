import io
import json
import pytest
from consigna_api.app import create_app

DEFAULT = (
    "Precio mínimo de venta: $12.900.000. Comisión: 5% del precio de venta. El pago se realizará a 60 días hábiles "
    "desde la venta. La automotora puede rebajar el precio sin autorización del propietario. El traspaso queda a cargo "
    "de la automotora antes del pago. No se establecen penalidades."
)
PAGES = {}


def fetcher(src):
    return PAGES[src["id"]]


@pytest.fixture
def app(tmp_path):
    for s in ["ley-19496", "sernac-publicacion-84008", "sernac-circulares", "sernac-dictamenes", "sernac-vehiculos"]:
        PAGES[s] = f"Contenido inicial de {s}\nLínea estable"
    return create_app({"DATA_DIR": str(tmp_path), "ADMIN_TOKEN": "secreto", "SYNC_INTERVAL_HOURS": 0, "ALERT_INTERVAL_MINUTES": 0, "FETCHER": fetcher})


@pytest.fixture
def client(app):
    return app.test_client()


def analyze(client, text):
    r = client.post("/api/analyze", json={"text": text})
    assert r.status_code == 200, r.get_data(as_text=True)
    return {f["id"]: f for f in r.get_json()["findings"]}


def test_omissions_are_explicit(client):
    f = analyze(client, "Un vehículo entregado en consignación a una automotora.")
    required = [x for x in f.values() if x["omitted"]]
    assert len(required) == 7 and all(x["level"] == "alto" for x in required)
    assert f["unilateral-modification"]["level"] == "bajo" and not f["unilateral-modification"]["omitted"]


def test_parity_with_frontend_rules(client):
    assert analyze(client, "Pago a 15 días hábiles. " * 3)["payment-term"]["level"] == "medio"
    f = analyze(client, DEFAULT)
    for cid in ["payment-term", "price-reduction", "transfer"]:
        assert f[cid]["level"] == "alto" and not f[cid]["omitted"]
    before = analyze(client, "La automotora realizará el traspaso antes del pago completo.")
    after = analyze(client, "El propietario realizará el traspaso después del pago completo.")
    mixed = analyze(client, "El traspaso será después del pago completo, aunque podrá realizarse antes del pago.")
    assert (before["transfer"]["level"], after["transfer"]["level"], mixed["transfer"]["level"]) == ("alto", "bajo", "alto")
    f = analyze(client, "La comisión podrá variar unilateralmente. Toda rebaja requiere autorización escrita del propietario. El traspaso ocurrirá después del pago completo.")
    assert (f["commission"]["level"], f["price-reduction"]["level"], f["transfer"]["level"]) == ("alto", "bajo", "bajo")
    forbidden = analyze(client, "No se podrá rebajar el precio sin autorización del propietario. No se podrá realizar el traspaso antes del pago completo.")
    allowed = analyze(client, "Se podrá rebajar el precio sin autorización del propietario. Se podrá realizar el traspaso antes del pago completo.")
    assert (forbidden["price-reduction"]["level"], forbidden["transfer"]["level"]) == ("medio", "bajo")
    assert (allowed["price-reduction"]["level"], allowed["transfer"]["level"]) == ("alto", "alto")


def test_new_sernac_criteria(client):
    f = analyze(client, "Este contrato podrá ser modificado sin previo aviso por la automotora. La automotora no se hace responsable por robos o hurtos del vehículo.")
    assert f["unilateral-modification"]["level"] == "alto"
    assert f["liability-limitation"]["level"] == "alto"
    assert f["liability-limitation"]["references"][0]["url"].startswith("https://")


def test_input_validation(client):
    assert client.post("/api/analyze", json={"text": "corto"}).status_code == 422
    assert client.post("/api/analyze", json={}).status_code == 400
    assert client.post("/api/analyze", json={"text": "x" * 100_001}).status_code == 422


def minimal_pdf(text):
    stream = f"BT /F1 12 Tf 20 100 Td ({text}) Tj ET".encode()
    objs = [b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
            b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream",
            b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    out, offs = b"%PDF-1.4\n", []
    for i, o in enumerate(objs, 1):
        offs.append(len(out)); out += b"%d 0 obj\n" % i + o + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1) + b"".join(b"%010d 00000 n \n" % o for o in offs)
    return out + b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF" % (len(objs) + 1, xref)


def test_pdf_and_txt_upload(client):
    pdf = minimal_pdf("Comision de 5 por ciento del precio de venta y plazo de pago de 60 dias")
    r = client.post("/api/analyze", data={"file": (io.BytesIO(pdf), "c.pdf")}, content_type="multipart/form-data")
    assert r.status_code == 200
    assert {f["id"]: f for f in r.get_json()["findings"]}["payment-term"]["level"] == "alto"
    r = client.post("/api/analyze", data={"file": (io.BytesIO(DEFAULT.encode()), "c.txt")}, content_type="multipart/form-data")
    assert r.status_code == 200
    r = client.post("/api/analyze", data={"file": (io.BytesIO(minimal_pdf("")), "v.pdf")}, content_type="multipart/form-data")
    assert r.status_code == 422 and "texto seleccionable" in r.get_json()["error"]


def test_source_change_flags_criteria_until_reviewed(client, app):
    admin = {"Authorization": "Bearer secreto"}
    assert client.post("/api/admin/sync", headers=admin).status_code == 200  # baseline
    assert client.get("/api/criteria").get_json()["review_pending"] is False
    PAGES["sernac-dictamenes"] += "\nNuevo dictamen sobre cláusulas penales"
    report = client.post("/api/admin/sync", headers=admin).get_json()["report"]
    assert {r["source_id"]: r["result"] for r in report}["sernac-dictamenes"] == "changed"
    meta = client.get("/api/criteria").get_json()
    assert meta["review_pending"] and next(s for s in meta["sources"] if s["id"] == "sernac-dictamenes")["status"] == "changed"
    f = analyze(client, DEFAULT)
    assert f["penalties"]["source_changed"] is True and f["commission"]["source_changed"] is False
    events = client.get("/api/admin/events", headers=admin).get_json()["pending_events"]
    assert "Nuevo dictamen sobre cláusulas penales" in events[0]["added"]
    # A reviewer publishes a new version and acknowledges the alert.
    doc = client.get("/api/admin/criteria", headers=admin).get_json()
    r = client.put("/api/admin/criteria", headers=admin, json={"criteria": doc["criteria"], "sources": doc["sources"], "note": "Revisado", "acknowledge": ["sernac-dictamenes"]})
    assert r.status_code == 200 and r.get_json()["version"] == 2 and r.get_json()["alerts_cleared"] == 1
    assert client.get("/api/criteria").get_json()["review_pending"] is False


def test_fetch_errors_keep_last_state(client, app):
    admin = {"Authorization": "Bearer secreto"}
    client.post("/api/admin/sync", headers=admin)
    def boom(src): raise RuntimeError("403")
    app.extensions["monitor"].fetcher = boom
    report = client.post("/api/admin/sync", headers=admin).get_json()["report"]
    assert all(r["result"] == "error" for r in report)
    meta = client.get("/api/criteria").get_json()
    assert meta["review_pending"] is False and meta["sources"][0]["status"] == "error"


def test_criteria_change_takes_effect_without_restart(client):
    admin = {"Authorization": "Bearer secreto"}
    doc = client.get("/api/admin/criteria", headers=admin).get_json()
    doc["criteria"].append({
        "id": "arbitration", "title": "Arbitraje obligatorio", "detect": ["arbitr"], "required": False,
        "default_level": "alto", "rules": [], "explanation": "Revisa la cláusula de arbitraje.",
        "alternative": "Las controversias podrán llevarse a los tribunales competentes.",
        "references": [{"source_id": "ley-19496", "label": "Cláusulas abusivas"}]})
    assert client.put("/api/admin/criteria", headers=admin, json=doc).status_code == 200
    f = analyze(client, DEFAULT + " Toda controversia se resolverá por arbitraje obligatorio.")
    assert f["arbitration"]["level"] == "alto"
    assert client.get("/api/health").get_json()["criteria_version"] == 2


def test_admin_security_and_validation(client):
    assert client.put("/api/admin/criteria", json={}).status_code == 401
    assert client.post("/api/admin/sync", headers={"Authorization": "Bearer mal"}).status_code == 401
    admin = {"Authorization": "Bearer secreto"}
    doc = client.get("/api/admin/criteria", headers=admin).get_json()
    bad = json.loads(json.dumps(doc)); bad["criteria"][0]["detect"] = ["(a+)+$"]
    assert client.put("/api/admin/criteria", headers=admin, json=bad).status_code == 422
    bad = json.loads(json.dumps(doc)); bad["sources"][0]["url"] = "https://evil.example/x"
    assert client.put("/api/admin/criteria", headers=admin, json=bad).status_code == 422
    bad = json.loads(json.dumps(doc)); bad["criteria"][0]["references"] = [{"source_id": "nope", "label": "x"}]
    assert client.put("/api/admin/criteria", headers=admin, json=bad).status_code == 422
    assert client.get("/api/criteria").get_json()["version"] == 1


def test_admin_disabled_without_token(tmp_path):
    c = create_app({"DATA_DIR": str(tmp_path), "ADMIN_TOKEN": "", "SYNC_INTERVAL_HOURS": 0, "ALERT_INTERVAL_MINUTES": 0}).test_client()
    assert c.post("/api/admin/sync").status_code == 503
