"""Parse a Revival remodeling proposal (.docx) into a job-sheet breakdown.

The parser reads paragraph text only. It does not call external services.
"""
from __future__ import annotations

import hashlib
import re
import zipfile
from datetime import datetime
from io import BytesIO
from xml.etree import ElementTree as ET

W_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
AMOUNT_LINE = re.compile(r"^\(?\$[\d,]+\.\d{2}\)?$")
MONEY_TOKEN = re.compile(r"\(?\$[\d,]+\.\d{2}\)?")
DURATION = re.compile(r"(\d+)\s*[-–]\s*(\d+)\s+working days", re.I)
DATE_FORMATS = ("%B %d, %Y", "%b %d, %Y", "%B %d %Y", "%m/%d/%Y")
TABLE_HEADERS = {
    "budget category",
    "amount",
    "material / allowance",
    "material/allowance",
}


class ProposalParseError(ValueError):
    """The document is not a recognizable Revival proposal."""


def file_sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def docx_paragraphs(data: bytes) -> list[str]:
    try:
        archive = zipfile.ZipFile(BytesIO(data))
        xml = archive.read("word/document.xml")
    except (zipfile.BadZipFile, KeyError) as exc:
        raise ProposalParseError("Upload a Word proposal (.docx).") from exc
    try:
        root = ET.fromstring(xml)
    except ET.ParseError as exc:
        raise ProposalParseError("That Word file could not be read.") from exc
    paragraphs = []
    for para in root.iter(f"{W_NS}p"):
        parts = []
        for node in para.iter(f"{W_NS}t"):
            if node.text:
                parts.append(node.text)
            if node.tail:
                parts.append(node.tail)
        line = re.sub(r"\s+", " ", "".join(parts)).strip()
        if line:
            paragraphs.append(line)
    if not paragraphs:
        raise ProposalParseError("That Word file has no readable text.")
    return paragraphs


def _money(token: str) -> float:
    negative = token.startswith("(") or token.endswith(")")
    number = float(token.strip("()$").replace(",", ""))
    return round(-number if negative else number, 2)


def _is_amount_line(line: str) -> bool:
    return bool(AMOUNT_LINE.fullmatch(line.strip()))


def _find_index(paragraphs: list[str], predicate) -> int:
    for index, line in enumerate(paragraphs):
        if predicate(line):
            return index
    return -1


def _parse_date(label: str) -> str:
    text = label.strip()
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue
    return ""


def _labeled_value(paragraphs: list[str], prefix: str) -> str:
    needle = prefix.lower()
    for line in paragraphs:
        if line.lower().startswith(needle):
            return line.split(":", 1)[1].strip()
    return ""


def _table_rows(paragraphs: list[str], start: int, end: int) -> tuple[list[dict], float | None]:
    rows = []
    label = ""
    stated_total = None
    for line in paragraphs[start:end]:
        lowered = line.lower().strip()
        if lowered in TABLE_HEADERS:
            continue
        if lowered.startswith("total "):
            label = line
            continue
        if _is_amount_line(line):
            amount = _money(line.strip())
            if label.lower().startswith("total "):
                stated_total = abs(amount)
                label = ""
                continue
            if label:
                rows.append({"label": label, "amount": amount})
                label = ""
            continue
        label = line
    return rows, stated_total


def _payment_schedule(paragraphs: list[str]) -> list[dict]:
    start = _find_index(paragraphs, lambda line: line.lower().startswith("payment schedule"))
    end = _find_index(paragraphs, lambda line: line.lower().startswith("terms"))
    window = paragraphs[start + 1:end] if start >= 0 and end > start else paragraphs
    rows = []
    seen = set()
    for line in window:
        lowered = line.lower()
        if "due" not in lowered and "deposit" not in lowered:
            continue
        match = MONEY_TOKEN.search(line)
        if not match:
            continue
        amount = abs(_money(match.group(0)))
        if amount <= 0:
            continue
        note = MONEY_TOKEN.sub("", line).strip(" .")
        key = (amount, note.lower()[:48])
        if key in seen:
            continue
        if "deposit" in lowered:
            label = "Deposit due up front"
        elif "completion" in lowered or "walkthrough" in lowered:
            label = "Due upon completion"
        elif "demolition" in lowered or "materials are on" in lowered:
            label = "Due when demolition is complete and materials are on site"
        else:
            continue
        seen.add(key)
        rows.append({"label": label, "amount": amount, "note": note})
    return rows


def _scope_sections(paragraphs: list[str]) -> list[dict]:
    start = _find_index(paragraphs, lambda line: line.lower().startswith("detailed scope"))
    end = _find_index(paragraphs, lambda line: line.lower().startswith("itemized materials"))
    if start < 0:
        return []
    if end < 0 or end <= start:
        end = len(paragraphs)
    sections = []
    current = None
    for line in paragraphs[start + 1:end]:
        if _is_amount_line(line) or line.lower() in TABLE_HEADERS:
            continue
        is_heading = (
            len(line) <= 60
            and not line.endswith(".")
            and not line.endswith(":")
            and line[:1].isupper()
            and " " not in line[:1]
        )
        if is_heading and not line.lower().startswith("the "):
            current = {"title": line, "items": []}
            sections.append(current)
            continue
        if current is None:
            current = {"title": "Scope", "items": []}
            sections.append(current)
        current["items"].append(line)
    return [section for section in sections if section["items"]]


def _exclusions(paragraphs: list[str], sections: list[dict]) -> list[str]:
    found = []
    seen = set()
    candidates = []
    for section in sections:
        candidates.extend(section["items"])
    candidates.extend(paragraphs)
    markers = ("not included", "excluded", "not billed", "will purchase", "will provide and install", "are not ")
    for line in candidates:
        lowered = line.lower()
        if not any(marker in lowered for marker in markers):
            continue
        cleaned = line.strip()
        key = cleaned.lower()
        if key in seen:
            continue
        seen.add(key)
        found.append(cleaned)
    return found[:12]


def _duration_days(paragraphs: list[str]) -> tuple[float, str]:
    for line in paragraphs:
        match = DURATION.search(line)
        if not match:
            continue
        low = int(match.group(1))
        high = int(match.group(2))
        return round((low + high) / 2, 1), f"{low}-{high} working days"
    return 0.0, ""


def _terms(paragraphs: list[str]) -> str:
    start = _find_index(paragraphs, lambda line: line.lower().startswith("terms"))
    end = _find_index(paragraphs, lambda line: line.lower().startswith("concept images") or line.lower() == "acceptance")
    if start < 0:
        return ""
    if end < 0 or end <= start:
        end = min(len(paragraphs), start + 12)
    return "\n\n".join(paragraphs[start:end]).strip()


def parse_proposal(data: bytes) -> dict:
    paragraphs = docx_paragraphs(data)
    client_name = _labeled_value(paragraphs, "client:")
    address = _labeled_value(paragraphs, "project address:")
    date_label = _labeled_value(paragraphs, "date:")
    if not client_name or not address:
        raise ProposalParseError("The proposal needs a client name and a project address.")

    price_start = _find_index(paragraphs, lambda line: "original quoted contract price" in line.lower() or line.lower().startswith("contract price"))
    materials_start = _find_index(paragraphs, lambda line: line.lower().startswith("itemized materials"))
    if price_start < 0 or materials_start < 0:
        raise ProposalParseError("The proposal needs a contract price and an itemized materials list.")
    price_rows, _price_total = _table_rows(paragraphs, price_start, materials_start)
    payment_start = _find_index(paragraphs, lambda line: line.lower().startswith("payment schedule"))
    materials_end = payment_start if payment_start > materials_start else len(paragraphs)
    material_rows, stated_materials = _table_rows(paragraphs, materials_start, materials_end)

    original = 0.0
    remaining = 0.0
    adjustments = []
    for row in price_rows:
        label = row["label"]
        amount = row["amount"]
        lowered = label.lower()
        if "remaining" in lowered:
            remaining = abs(amount)
        elif "original" in lowered:
            original = abs(amount)
        else:
            adjustments.append({"label": label, "amount": amount if amount < 0 else -abs(amount)})
    if remaining <= 0 and original:
        remaining = round(original + sum(item["amount"] for item in adjustments), 2)
    if remaining <= 0:
        raise ProposalParseError("The proposal does not include a remaining contract balance.")

    materials = []
    for row in material_rows:
        label = row["label"]
        amount = abs(row["amount"])
        billed = amount > 0 and "not billed" not in label.lower()
        materials.append({"description": label, "amount": amount, "billed": billed})
    itemized = round(sum(item["amount"] for item in materials if item["billed"]), 2)
    stated = round(float(stated_materials or 0), 2)
    variance = round(itemized - stated, 2) if stated else 0.0
    labor_remainder = round(remaining - itemized, 2)
    if labor_remainder < -0.05:
        raise ProposalParseError("The itemized materials are higher than the remaining contract balance.")

    payments = _payment_schedule(paragraphs)
    payment_total = round(sum(item["amount"] for item in payments), 2)
    sections = _scope_sections(paragraphs)
    days, duration_label = _duration_days(paragraphs)
    summary = ""
    summary_at = _find_index(paragraphs, lambda line: line.lower() == "project summary")
    if summary_at >= 0 and summary_at + 1 < len(paragraphs):
        summary = paragraphs[summary_at + 1]

    return {
        "client_name": client_name,
        "project_address": address,
        "proposal_date": _parse_date(date_label),
        "proposal_date_label": date_label,
        "summary": summary,
        "original_contract_price": original,
        "adjustments": adjustments,
        "remaining_balance": remaining,
        "stated_materials_total": stated,
        "materials": materials,
        "itemized_materials_total": itemized,
        "materials_variance": variance,
        "labor_remainder": labor_remainder,
        "payment_schedule": payments,
        "payment_total": payment_total,
        "scope": sections,
        "exclusions": _exclusions(paragraphs, sections),
        "estimated_days": days,
        "duration_label": duration_label,
        "terms": _terms(paragraphs),
        "category": "Remodel",
        "project_type": "Remodel",
    }


def sheet_notes(parsed: dict) -> str:
    lines = [
        f"Imported from the revised remodeling proposal dated {parsed.get('proposal_date_label') or 'the proposal date'}.",
        f"Original quoted contract price ${parsed['original_contract_price']:,.2f}.",
    ]
    for adjustment in parsed.get("adjustments") or []:
        lines.append(f"{adjustment['label']}: ${adjustment['amount']:,.2f}")
    lines.append(f"Remaining contract balance (what the client pays) ${parsed['remaining_balance']:,.2f}.")
    lines.append(f"Itemized contractor-furnished materials ${parsed['itemized_materials_total']:,.2f}.")
    stated = float(parsed.get("stated_materials_total") or 0)
    if stated:
        lines.append(f"The proposal prints a materials total of ${stated:,.2f}.")
    variance = float(parsed.get("materials_variance") or 0)
    if abs(variance) >= 0.01:
        direction = "higher" if variance > 0 else "lower"
        lines.append(
            f"The itemized allowances are ${abs(variance):,.2f} {direction} than that printed total. "
            "The job sheet follows the itemized allowances."
        )
    lines.append(
        f"Labor, overhead, and profit left inside the lump sum: ${parsed['labor_remainder']:,.2f}. "
        "The proposal does not split that remainder into wages."
    )
    if parsed.get("duration_label"):
        lines.append(f"Estimated duration {parsed['duration_label']}.")
    if parsed.get("payment_schedule"):
        lines.append("Payment schedule:")
        for item in parsed["payment_schedule"]:
            lines.append(f"- {item['label']}: ${item['amount']:,.2f}")
    if parsed.get("scope"):
        lines.append("Scope:")
        for section in parsed["scope"]:
            lines.append(section["title"])
            for item in section["items"]:
                lines.append(f"- {item}")
    return "\n".join(lines)


def master_file_summary(parsed: dict, filename: str, digest: str) -> dict:
    return {
        "filename": filename,
        "sha256": digest,
        "proposal_date": parsed.get("proposal_date") or "",
        "proposal_date_label": parsed.get("proposal_date_label") or "",
        "source_client": parsed.get("client_name") or "",
        "original_contract_price": parsed.get("original_contract_price") or 0,
        "adjustments": parsed.get("adjustments") or [],
        "remaining_balance": parsed.get("remaining_balance") or 0,
        "stated_materials_total": parsed.get("stated_materials_total") or 0,
        "itemized_materials_total": parsed.get("itemized_materials_total") or 0,
        "materials_variance": parsed.get("materials_variance") or 0,
        "labor_remainder": parsed.get("labor_remainder") or 0,
        "materials": parsed.get("materials") or [],
        "payment_schedule": parsed.get("payment_schedule") or [],
        "payment_total": parsed.get("payment_total") or 0,
        "scope": parsed.get("scope") or [],
        "exclusions": parsed.get("exclusions") or [],
        "estimated_days": parsed.get("estimated_days") or 0,
        "duration_label": parsed.get("duration_label") or "",
        "summary": parsed.get("summary") or "",
        "has_document": True,
    }


def address_key(address: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (address or "").lower())
