from __future__ import annotations

import re
import unicodedata
from functools import lru_cache


def normalize(text: str) -> str:
    decomposed = unicodedata.normalize("NFD", text)
    return "".join(c for c in decomposed if not unicodedata.combining(c)).lower()


def split_clauses(text: str) -> list[str]:
    """Divide el texto original en cláusulas (punto y punto y coma) y devuelve cada una normalizada.
    Un salto de línea que solo parte una oración (texto copiado de un PDF) se une con la línea siguiente
    si la anterior no termina en puntuación y la siguiente empieza en minúscula o la anterior es larga.
    Los títulos cortos y los párrafos separados por línea en blanco siguen siendo cláusulas distintas."""
    parrafos: list[str] = []
    actual, largo_ultima = "", 0
    for linea in text.split("\n"):
        s = linea.strip()
        if not s:
            if actual:
                parrafos.append(actual)
            actual, largo_ultima = "", 0
            continue
        if actual and not actual.rstrip().endswith((".", ";", ":")) and (s[0].islower() or largo_ultima >= 60):
            actual += " " + s
        else:
            if actual:
                parrafos.append(actual)
            actual = s
        largo_ultima = len(s)
    if actual:
        parrafos.append(actual)
    return [c for p in parrafos for c in (normalize(x).strip() for x in re.split(r"[.;]+", p)) if c]


@lru_cache(maxsize=2048)
def _rx(pattern: str) -> re.Pattern[str]:
    return re.compile(pattern, re.IGNORECASE)


def _rule_hits(rule: dict, clauses: list[str]) -> bool:
    for clause in clauses:
        if "number_gt" in rule:
            spec = rule["number_gt"]
            m = _rx(spec["pattern"]).search(clause)
            if m and int(m.group(1)) > spec["threshold"]:
                return True
            continue
        if _rx(rule["match"]).search(clause):
            unless = rule.get("unless")
            if not (unless and _rx(unless).search(clause)):
                return True
    return False


def evaluate_criterion(criterion: dict, clauses: list[str]) -> dict:
    relevant = [c for c in clauses if any(_rx(p).search(c) for p in criterion["detect"])]
    present = bool(relevant)
    level = criterion["default_level"]
    explanation = criterion["explanation"]
    if not present:
        required = criterion.get("required", True)
        level = criterion.get("absent_level", "alto") if required else "bajo"
        explanation = criterion.get(
            "absent_explanation",
            "No se identificó este término en el texto. Su ausencia debe revisarse expresamente antes de firmar.",
        )
    else:
        for rule in criterion.get("rules", []):
            if _rule_hits(rule, relevant):
                level = rule["level"]
                explanation = rule.get("explanation", explanation)
                break
    return {
        "id": criterion["id"],
        "title": criterion["title"],
        "level": level,
        "explanation": explanation,
        "alternative": criterion["alternative"],
        "omitted": (not present) and criterion.get("required", True),
        "present": present,
        "criterion_status": criterion.get("review_status", "pending_legal_review"),
    }


def analyze(text: str, document: dict, review_flags: dict[str, list[str]] | None = None) -> list[dict]:
    """review_flags maps criterion id -> ids of monitored sources that changed
    since the criterion was last reviewed."""
    sources = {s["id"]: s for s in document.get("sources", [])}
    clauses = split_clauses(text)
    findings = []
    for criterion in document["criteria"]:
        if not criterion.get("enabled", True):
            continue
        finding = evaluate_criterion(criterion, clauses)
        finding["references"] = [
            {
                "source_id": r["source_id"],
                "label": r["label"],
                "title": sources.get(r["source_id"], {}).get("title", r["source_id"]),
                "url": sources.get(r["source_id"], {}).get("url"),
            }
            for r in criterion.get("references", [])
        ]
        changed = (review_flags or {}).get(criterion["id"], [])
        finding["source_changed"] = bool(changed)
        finding["changed_sources"] = changed
        findings.append(finding)
    return findings
