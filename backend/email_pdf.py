import os
import re
import ipaddress
import logging
import httpx
from io import BytesIO
from html.parser import HTMLParser
from urllib.parse import urlparse
from dotenv import load_dotenv
from fastapi import HTTPException

from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.units import inch
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer

load_dotenv()
logger = logging.getLogger(__name__)

EMAIL_BASE_URL = "https://integrations.emergentagent.com"
EMAIL_KEY = os.environ["EMERGENT_EMAIL_KEY"]
EMAIL_FROM_NAME = os.environ["EMAIL_FROM_NAME"]
EMAIL_REPLY_TO = os.environ.get("EMAIL_REPLY_TO")

TEAL = colors.HexColor("#0A4D68")
GOLD = colors.HexColor("#C9A227")
DARK = colors.HexColor("#061A23")
GREY = colors.HexColor("#4B6370")


def money(n):
    return "${:,.2f}".format(float(n or 0))


# ---------------- PDF ----------------
def build_estimate_pdf(est: dict, client: dict | None) -> bytes:
    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, topMargin=0.7 * inch, bottomMargin=0.7 * inch,
                            leftMargin=0.75 * inch, rightMargin=0.75 * inch)
    styles = getSampleStyleSheet()
    h_brand = ParagraphStyle("brand", parent=styles["Title"], textColor=TEAL, fontSize=26, leading=30, spaceAfter=0)
    h_tag = ParagraphStyle("tag", parent=styles["Normal"], textColor=GOLD, fontSize=10, spaceAfter=0)
    label = ParagraphStyle("label", parent=styles["Normal"], textColor=GREY, fontSize=8, leading=11)
    val = ParagraphStyle("val", parent=styles["Normal"], textColor=DARK, fontSize=10, leading=14)
    note = ParagraphStyle("note", parent=styles["Normal"], textColor=GREY, fontSize=9, leading=13)
    footer = ParagraphStyle("footer", parent=styles["Normal"], textColor=GREY, fontSize=8, leading=11)

    elems = []
    # Header row: brand + estimate meta
    header = Table([[
        Paragraph("REVIVAL PRO", h_brand),
        Paragraph(f"<b>ESTIMATE</b><br/>{est.get('estimate_number','')}", ParagraphStyle("meta", parent=val, alignment=2)),
    ]], colWidths=[3.7 * inch, 3.3 * inch])
    header.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    elems.append(header)
    elems.append(Paragraph("Residential Remodeling · Capture. Organize. Close.", h_tag))
    elems.append(Spacer(1, 16))

    # Bill-to + details
    client = client or {}
    bill = f"<b>{client.get('name','—')}</b>"
    if client.get("address"):
        bill += f"<br/>{client['address']}"
    if client.get("phone"):
        bill += f"<br/>{client['phone']}"
    if client.get("email"):
        bill += f"<br/>{client['email']}"
    created = (est.get("created_at", "") or "")[:10]
    meta = Table([[
        [Paragraph("PREPARED FOR", label), Paragraph(bill, val)],
        [Paragraph("PROJECT", label), Paragraph(est.get("category", "—"), val),
         Spacer(1, 6), Paragraph("DATE", label), Paragraph(created or "—", val)],
    ]], colWidths=[3.7 * inch, 3.3 * inch])
    meta.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    elems.append(meta)
    elems.append(Spacer(1, 18))

    # Line items table
    data = [["Description", "Qty", "Unit Price", "Amount"]]
    for li in est.get("line_items", []):
        data.append([
            li.get("description", ""),
            "{:g}".format(float(li.get("quantity", 0))),
            money(li.get("unit_price", 0)),
            money(li.get("amount", 0)),
        ])
    tbl = Table(data, colWidths=[3.7 * inch, 0.8 * inch, 1.25 * inch, 1.25 * inch], repeatRows=1)
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), TEAL),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
        ("ALIGN", (0, 0), (0, -1), "LEFT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F4F7F8")]),
        ("LINEBELOW", (0, 0), (-1, -1), 0.5, colors.HexColor("#E2E8F0")),
    ]))
    elems.append(tbl)
    elems.append(Spacer(1, 12))

    # Totals
    totals = Table([
        ["Subtotal", money(est.get("subtotal", 0))],
        [f"Tax ({est.get('tax_rate', 0)}%)", money(est.get("tax_amount", 0))],
        ["TOTAL", money(est.get("total", 0))],
    ], colWidths=[1.5 * inch, 1.25 * inch], hAlign="RIGHT")
    totals.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("ALIGN", (0, 0), (-1, -1), "RIGHT"),
        ("TEXTCOLOR", (0, 0), (-1, 1), GREY),
        ("FONTNAME", (0, 2), (-1, 2), "Helvetica-Bold"),
        ("FONTSIZE", (0, 2), (-1, 2), 12),
        ("TEXTCOLOR", (0, 2), (-1, 2), TEAL),
        ("LINEABOVE", (0, 2), (-1, 2), 1, TEAL),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
    ]))
    elems.append(totals)

    if est.get("notes"):
        elems.append(Spacer(1, 18))
        elems.append(Paragraph("NOTES", label))
        elems.append(Paragraph(str(est["notes"]).replace("\n", "<br/>"), note))

    elems.append(Spacer(1, 30))
    elems.append(Paragraph(
        "Thank you for the opportunity. This estimate is valid for 30 days. "
        "Prepared by Revival Pro — we never ask for payment details by email.", footer))

    doc.build(elems)
    return buf.getvalue()


# ---------------- Email gate (from playbook) ----------------
_SHORTENERS = ("bit.ly", "tinyurl.com", "t.co", "is.gd", "cutt.ly", "goo.gl", "rebrand.ly")
_CRED_ASK = ("reply with your password", "reply with the code", "send your password", "cvv",
             "send us your password", "enter your password below", "confirm your card number",
             "your full card number", "seed phrase", "recovery phrase", "verify your card",
             "social security number", "confirm your bank details")
_HOSTISH = re.compile(r"\b(?:https?://)?((?:[a-z0-9-]+\.)+[a-z]{2,})", re.I)


def _host_ok(host: str) -> bool:
    if not host or "xn--" in host:
        return False
    try:
        ipaddress.ip_address(host)
        return False
    except ValueError:
        pass
    return not any(host == s or host.endswith("." + s) for s in _SHORTENERS)


def _same_site(shown: str, real: str) -> bool:
    return shown == real or real.endswith("." + shown) or shown.endswith("." + real)


class _EmailScan(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags, self.urls, self.anchors = set(), [], []
        self._href, self._text = None, []

    def handle_starttag(self, tag, attrs):
        self.tags.add(tag.lower())
        self.urls += [v for k, v in attrs if k.lower() in ("href", "src") and v]
        if tag.lower() == "a":
            self._href = dict((k.lower(), v) for k, v in attrs).get("href")
            self._text = []

    def handle_data(self, data):
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "a" and self._href is not None:
            self.anchors.append((self._href, "".join(self._text)))
            self._href, self._text = None, []


def _assert_safe_email(subject: str, html: str) -> None:
    scan = _EmailScan()
    scan.feed(html)
    if scan.tags & {"form", "input", "textarea", "select"}:
        raise ValueError("No forms or input fields in email (G2)")
    body = f"{subject}\n{html}".lower()
    for p in _CRED_ASK:
        if p in body:
            raise ValueError(f"Email asks the recipient for credentials: {p!r} (G2)")
    for url in scan.urls:
        low = url.strip().lower()
        if low.startswith(("mailto:", "tel:", "cid:", "#")):
            continue
        if not low.startswith("https://"):
            raise ValueError(f"Email links/assets must be absolute https: {url!r} (G3)")
        host = urlparse(low).hostname or ""
        if not _host_ok(host) or urlparse(low).username is not None:
            raise ValueError(f"Shortened, numeric-host or credential-bearing URL: {url!r} (G3)")
    for href, text in scan.anchors:
        real = urlparse(href.strip().lower()).hostname or ""
        if not real:
            continue
        for m in _HOSTISH.finditer(text):
            if not _same_site(m.group(1).lower(), real):
                raise ValueError(f"Anchor text {m.group(1)!r} != real link host {real!r} (G3)")


async def send_email(*, to: str, subject: str, html: str, attachments=None, reply_to=None):
    _assert_safe_email(subject, html)
    payload = {"to": [to], "subject": subject, "html": html, "from_name": EMAIL_FROM_NAME}
    if attachments:
        payload["attachments"] = attachments
    if reply_to or EMAIL_REPLY_TO:
        payload["contact_email"] = reply_to or EMAIL_REPLY_TO
    try:
        async with httpx.AsyncClient(timeout=45) as client:
            resp = await client.post(
                f"{EMAIL_BASE_URL}/api/v1/email/send",
                headers={"X-Email-Key": EMAIL_KEY},
                json=payload,
            )
        resp.raise_for_status()
        return resp.json().get("id")
    except httpx.HTTPStatusError as e:
        logger.error(f"Email send failed: {e.response.status_code} {e.response.text}")
        detail = "Failed to send email"
        try:
            body = e.response.json()
            if e.response.status_code == 422 or body.get("code") == "undeliverable_recipient":
                detail = "That client's email address looks undeliverable. Please check the email on file."
            elif body.get("message"):
                detail = body["message"]
        except Exception:
            pass
        # Use 4xx for client-fixable errors (e.g. bad recipient) so the JSON body
        # is not rewritten by the ingress/CDN the way 5xx responses are.
        code = 400 if e.response.status_code < 500 else 502
        raise HTTPException(status_code=code, detail=detail)
    except Exception as e:
        logger.error(f"Email send error: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to send email")
