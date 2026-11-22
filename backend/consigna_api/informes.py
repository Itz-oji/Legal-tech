"""Módulo C: informe de incumplimiento, borradores de reclamo y PDF."""
from __future__ import annotations

import io
from datetime import date

from . import plazos
from .hitos import clp

MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
TIPO_HITO = {"entrega": "Entrega del vehículo", "venta": "Venta informada", "pago": "Pago recibido", "traspaso": "Traspaso"}
AUDIENCIAS = ("automotora", "sernac")
# Solo se citan las normaS, deben verificarse antes de presentar.
FUNDAMENTOS = [
    "Código Civil, art. 1545: todo contrato legalmente celebrado es una ley para los contratantes.",
    "Código de Comercio, art. 279: obligaciones del comisionista tras evacuar la negociación (rendición de cuentas y entrega del saldo), cuando la operación se configure como comisión comercial.",
]
AVISO = ("Documento de orientación. No constituye asesoría jurídica ni presenta el reclamo: revísalo, verifica los fundamentos "
         "y adjunta los comprobantes antes de presentarlo.")


def fecha_larga(d: date) -> str:
    return f"{d.day} de {MESES[d.month - 1]} de {d.year}"


def estado_de(contrato: dict, hitos: list[dict], hoy: date) -> dict | None:
    venta = next((h for h in hitos if h["tipo"] == "venta"), None)
    if not venta:
        return None
    traspaso = next((h for h in hitos if h["tipo"] == "traspaso"), None)
    return plazos.estado_consignacion(
        fecha_venta=venta["fecha"], dias_pago=contrato["dias_pago"], tipo_dias=contrato["tipo_dias"],
        precio=contrato["precio"], comision_pct=contrato["comision_pct"],
        pagos=[(h["fecha"], h["monto"] or 0) for h in hitos if h["tipo"] == "pago"],
        fecha_traspaso=traspaso["fecha"] if traspaso else None, hoy=hoy)


def construir_informe(contrato: dict, hitos: list[dict], evidencias: list[dict], hoy: date) -> dict:
    """Devuelve los hechos del informe. `reclamable` es False si no hay incumplimiento."""
    est = estado_de(contrato, hitos, hoy)
    por_id = {e["id"]: e for e in evidencias}
    cronologia = [{
        "fecha": h["fecha"], "tipo": h["tipo"], "titulo": TIPO_HITO[h["tipo"]], "monto": h["monto"], "nota": h["nota"],
        "evidencia": por_id.get(h["evidencia_id"], {}).get("filename") if h["evidencia_id"] else None,
    } for h in sorted(hitos, key=lambda h: h["fecha"])]
    if est is None:
        return {"reclamable": False, "motivo": "Aún no se registra la venta: no hay plazo de pago que evaluar.",
                "contrato": contrato, "cronologia": cronologia, "estado": None, "generado": hoy}
    motivo = None
    if not est["reclamable"]:
        motivo = ("El pago está completo; no hay incumplimiento." if est["pagado"]
                  else "El plazo de pago aún no vence; no hay incumplimiento.")
    return {"reclamable": est["reclamable"], "motivo": motivo, "contrato": contrato, "cronologia": cronologia,
            "estado": est, "generado": hoy}


def borrador(audiencia: str, informe: dict) -> str:
    if audiencia not in AUDIENCIAS:
        raise ValueError("La audiencia debe ser 'automotora' o 'sernac'.")
    c, e = informe["contrato"], informe["estado"]
    dest = f"A {c['automotora']}" if audiencia == "automotora" else "Al Servicio Nacional del Consumidor (SERNAC)"
    partes = [
        f"{dest}:",
        f"Por medio de este documento, dejo constancia de los antecedentes relacionados con la consignación de mi vehículo "
        f"{c['vehiculo']}, patente {c['patente']}, registrada con {c['automotora']}.",
        f"El precio de venta registrado es {clp(c['precio'])}, con una comisión de {c['comision_pct']:g}% ({clp(e['comision'])}), "
        f"lo que corresponde a un monto neto de {clp(e['neto'])}. A la fecha, los pagos registrados suman {clp(e['total_pagado'])}, "
        f"con un saldo pendiente de {clp(e['saldo'])}. La fecha de vencimiento del pago es el {fecha_larga(e['vencimiento'])}.",
    ]
    if e["traspaso_inseguro"]:
        partes.append("En la cronología se registra un traspaso previo al pago completo. Solicito aclarar esta situación y entregar los comprobantes correspondientes.")
    partes.append("Solicito informar por escrito el estado de la operación y, si corresponde, regularizar el saldo pendiente mediante el medio de pago acordado.")
    partes.append("Fundamentos citados (verificar antes de presentar):\n" + "\n".join(f"- {f}" for f in FUNDAMENTOS))
    partes.append("Adjunto la cronología y las referencias a los comprobantes disponibles. Solicito una respuesta por escrito a este requerimiento.")
    partes.append(f"Nombre del propietario: ____________________\nFecha: {fecha_larga(informe['generado'])}\nDatos de contacto: ____________________")
    return "\n\n".join(partes)


def pasos_recomendados(audiencia: str) -> list[str]:
    base = ["Revisa el borrador y completa tus datos.", "Reúne los comprobantes registrados en la plataforma.",
            "Presenta el reclamo tú mismo: la plataforma no lo envía."]
    return base + (["Si la automotora no responde, puedes presentar el reclamo ante el SERNAC."] if audiencia == "automotora" else [])


def generar_pdf(informe: dict, texto_borrador: str, audiencia: str) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib.units import cm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
    from xml.sax.saxutils import escape

    st = getSampleStyleSheet()
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=2 * cm, rightMargin=2 * cm, topMargin=2 * cm, bottomMargin=2 * cm,
                            title="Informe de consignación", author="Consigna")
    c, e = informe["contrato"], informe["estado"]
    P = lambda t, s="BodyText": Paragraph(escape(t).replace("\n", "<br/>"), st[s])
    historia = [P("Informe de incumplimiento", "Title"),
                P(f"{c['vehiculo']} · patente {c['patente']} · {c['automotora']}"),
                P(f"Generado el {fecha_larga(informe['generado'])}"), Spacer(1, 10), P(AVISO, "Italic"), Spacer(1, 10),
                P("Resumen financiero", "Heading2")]
    filas = [["Precio de venta", clp(c["precio"])], [f"Comisión ({c['comision_pct']:g}%)", clp(e["comision"])],
             ["Monto neto al propietario", clp(e["neto"])], ["Pagos recibidos", clp(e["total_pagado"])],
             ["Saldo adeudado", clp(e["saldo"])], ["Vencimiento del pago", fecha_larga(e["vencimiento"])]]
    t = Table(filas, colWidths=[9 * cm, 6 * cm])
    t.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.4, colors.grey), ("FONTNAME", (0, 4), (-1, 4), "Helvetica-Bold"),
                           ("ALIGN", (1, 0), (1, -1), "RIGHT")]))
    historia += [t, Spacer(1, 10), P("Cronología", "Heading2")]
    for h in informe["cronologia"]:
        linea = f"{fecha_larga(h['fecha'])} — {h['titulo']}" + (f" ({clp(h['monto'])})" if h["monto"] else "")
        if h["nota"]:
            linea += f". {h['nota']}"
        if h["evidencia"]:
            linea += f" [comprobante: {h['evidencia']}]"
        historia.append(P("• " + linea))
    historia += [Spacer(1, 10), P("Pasos recomendados", "Heading2")] + [P(f"{i}. {p}") for i, p in enumerate(pasos_recomendados(audiencia), 1)]
    historia += [Spacer(1, 10), P("Borrador de reclamo", "Heading2"), P(texto_borrador)]
    doc.build(historia)
    return buf.getvalue()
