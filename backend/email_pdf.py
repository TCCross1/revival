import os
import re
import ipaddress
import logging
import base64
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
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Image, ListFlowable, ListItem

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


def build_invoice_pdf(inv: dict, client: dict | None) -> bytes:
    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, topMargin=0.7 * inch, bottomMargin=0.7 * inch,
                            leftMargin=0.75 * inch, rightMargin=0.75 * inch)
    styles = getSampleStyleSheet()
    h_brand = ParagraphStyle("inv_brand", parent=styles["Title"], textColor=TEAL, fontSize=26, leading=30, spaceAfter=0)
    h_tag = ParagraphStyle("inv_tag", parent=styles["Normal"], textColor=GOLD, fontSize=10, spaceAfter=0)
    label = ParagraphStyle("inv_label", parent=styles["Normal"], textColor=GREY, fontSize=8, leading=11)
    val = ParagraphStyle("inv_val", parent=styles["Normal"], textColor=DARK, fontSize=10, leading=14)
    footer = ParagraphStyle("inv_footer", parent=styles["Normal"], textColor=GREY, fontSize=8, leading=11)

    elems = []
    header = Table([[
        Paragraph("REVIVAL PRO", h_brand),
        Paragraph(f"<b>INVOICE</b><br/>{inv.get('invoice_number','')}", ParagraphStyle("inv_meta", parent=val, alignment=2)),
    ]], colWidths=[3.7 * inch, 3.3 * inch])
    header.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    elems.append(header)
    elems.append(Paragraph("Residential Remodeling · Capture. Organize. Close.", h_tag))
    elems.append(Spacer(1, 16))

    client = client or {}
    bill_name = client.get("name") or inv.get("client_name") or "—"
    bill = f"<b>{bill_name}</b>"
    if client.get("address"):
        bill += f"<br/>{client['address']}"
    if client.get("phone"):
        bill += f"<br/>{client['phone']}"
    if client.get("email"):
        bill += f"<br/>{client['email']}"

    created = (inv.get("created_at", "") or "")[:10]
    due = (inv.get("due_date", "") or "")[:10]
    status = inv.get("status") or "Draft"
    meta = Table([[
        [Paragraph("BILL TO", label), Paragraph(bill, val)],
        [Paragraph("STATUS", label), Paragraph(status, val),
         Spacer(1, 6), Paragraph("INVOICE DATE", label), Paragraph(created or "—", val),
         Spacer(1, 6), Paragraph("DUE DATE", label), Paragraph(due or "—", val)],
    ]], colWidths=[3.7 * inch, 3.3 * inch])
    meta.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    elems.append(meta)
    elems.append(Spacer(1, 18))

    data = [["Description", "Qty", "Unit Price", "Amount"]]
    line_items = inv.get("line_items") or []
    if line_items:
        for li in line_items:
            data.append([
                li.get("description", ""),
                "{:g}".format(float(li.get("quantity", 0) or 0)),
                money(li.get("unit_price", 0)),
                money(li.get("amount", 0)),
            ])
    else:
        data.append(["Services", "1", money(inv.get("amount", 0)), money(inv.get("amount", 0))])

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

    amount = float(inv.get("amount", 0) or 0)
    paid = float(inv.get("amount_paid", 0) or 0)
    balance = round(max(amount - paid, 0), 2)
    totals = Table([
        ["Amount", money(amount)],
        ["Amount paid", money(paid)],
        ["BALANCE DUE", money(balance)],
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

    if balance <= 0 and amount > 0:
        elems.append(Spacer(1, 10))
        paid_style = ParagraphStyle("inv_paid", parent=val, textColor=TEAL, alignment=2, fontName="Helvetica-Bold")
        elems.append(Paragraph("PAID IN FULL", paid_style))

    elems.append(Spacer(1, 30))
    elems.append(Paragraph(
        "Thank you for your business. Please remit payment by the due date. "
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


# ---------------- Contract PDF ----------------
def _sig_image(data_url, width=2.4 * inch, height=0.75 * inch):
    try:
        if not data_url or "," not in data_url:
            return None
        raw = base64.b64decode(data_url.split(",", 1)[1])
        return Image(BytesIO(raw), width=width, height=height, kind="proportional")
    except Exception:
        return None


def build_contract_pdf(c: dict, company: dict | None = None) -> bytes:
    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, topMargin=0.7 * inch, bottomMargin=0.7 * inch,
                            leftMargin=0.8 * inch, rightMargin=0.8 * inch, title="Construction Contract")
    styles = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=styles["Title"], textColor=TEAL, fontSize=22, leading=26, spaceAfter=2)
    tag = ParagraphStyle("tag", parent=styles["Normal"], textColor=GOLD, fontSize=10)
    sec = ParagraphStyle("sec", parent=styles["Normal"], textColor=colors.white, fontSize=11, leading=14, fontName="Helvetica-Bold")
    body = ParagraphStyle("body", parent=styles["Normal"], textColor=DARK, fontSize=9.5, leading=14)
    small = ParagraphStyle("small", parent=styles["Normal"], textColor=GREY, fontSize=8, leading=11)
    label = ParagraphStyle("label", parent=styles["Normal"], textColor=GREY, fontSize=8, leading=11)

    def section(title):
        t = Table([[Paragraph(title, sec)]], colWidths=[6.9 * inch])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), TEAL),
            ("LEFTPADDING", (0, 0), (-1, -1), 10), ("RIGHTPADDING", (0, 0), (-1, -1), 10),
            ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ]))
        return t

    e = []
    e.append(Paragraph("CONSTRUCTION CONTRACT", h1))
    e.append(Paragraph(f"Revival Pro &nbsp;·&nbsp; {c.get('contract_number','')}", tag))
    e.append(Spacer(1, 14))

    # 1. Parties
    e.append(section("1. Parties"))
    e.append(Spacer(1, 6))
    parties = Table([[
        [Paragraph("CONTRACTOR", label),
         Paragraph(f"<b>{c.get('contractor_name','')}</b><br/>{c.get('contractor_address','')}<br/>{c.get('contractor_phone','')}<br/>{c.get('contractor_license','')}", body)],
        [Paragraph("CLIENT (HOMEOWNER)", label),
         Paragraph(f"<b>{c.get('client_name','')}</b><br/>{c.get('client_address','')}<br/>{c.get('client_phone','')}<br/>{c.get('client_email','')}", body)],
    ]], colWidths=[3.45 * inch, 3.45 * inch])
    parties.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    e.append(parties)
    e.append(Spacer(1, 12))

    # 2. Project Information
    e.append(section("2. Project Information"))
    e.append(Spacer(1, 6))
    e.append(Paragraph(f"<b>Job Address:</b> {c.get('project_address','')}", body))
    e.append(Spacer(1, 3))
    e.append(Paragraph(f"<b>Description of Project:</b> {c.get('project_description','')}", body))
    e.append(Spacer(1, 12))

    # 3. Scope of Work
    e.append(section("3. Scope of Work"))
    e.append(Spacer(1, 6))
    data = [["Description", "Qty", "Unit Price", "Amount"]]
    for li in c.get("line_items", []):
        data.append([li.get("description", ""), "{:g}".format(float(li.get("quantity", 0))),
                     money(li.get("unit_price", 0)), money(li.get("amount", 0))])
    tbl = Table(data, colWidths=[3.8 * inch, 0.7 * inch, 1.2 * inch, 1.2 * inch], repeatRows=1)
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), TEAL), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"), ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"), ("ALIGN", (0, 0), (0, -1), "LEFT"),
        ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 10), ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F4F7F8")]),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, colors.HexColor("#E2E8F0")),
    ]))
    e.append(tbl)
    e.append(Spacer(1, 12))

    # 4. Contract Price and Payment Terms
    e.append(section("4. Contract Price and Payment Terms"))
    e.append(Spacer(1, 6))
    e.append(Paragraph(f"<b>Total Contract Price:</b> <font color='#0A4D68'><b>{money(c.get('total',0))}</b></font>", body))
    e.append(Spacer(1, 6))
    e.append(Paragraph("Payment Schedule", label))
    ps = [["Milestone", "Amount"]]
    for m in c.get("payment_schedule", []):
        lbl = m.get("label", "")
        if m.get("note"):
            lbl += f"  —  {m['note']}"
        ps.append([Paragraph(lbl, body), money(m.get("amount", 0))])
    pst = Table(ps, colWidths=[5.4 * inch, 1.5 * inch], repeatRows=1)
    pst.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E9EEF1")),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"), ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 10), ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, colors.HexColor("#E2E8F0")),
    ]))
    e.append(pst)
    e.append(Spacer(1, 12))

    # 5. Exclusions
    e.append(section("5. Exclusions"))
    e.append(Spacer(1, 6))
    e.append(Paragraph("The following are <b>not</b> included in this contract unless specifically added in writing:", body))
    e.append(Spacer(1, 4))
    e.append(ListFlowable([ListItem(Paragraph(x, body), leftIndent=6) for x in c.get("exclusions", [])],
                          bulletType="bullet", start="•", leftIndent=16))
    e.append(Spacer(1, 12))

    # 6. Change Orders
    e.append(section("6. Change Orders"))
    e.append(Spacer(1, 6))
    markup = c.get("change_order_markup", 20)
    co = [
        "Any change to the scope of work, price, or timeline must be put in writing.",
        "Both the Client and the Contractor must sign the change order before the additional work begins.",
        "Verbal agreements are not binding.",
        "Each change order will state the description of the change, the price adjustment, and any effect on the schedule.",
        f"Change order work will be priced with a standard markup of {markup:g}% over cost.",
    ]
    e.append(ListFlowable([ListItem(Paragraph(x, body)) for x in co], bulletType="bullet", start="•", leftIndent=16))
    e.append(Spacer(1, 16))

    # 7. Signatures
    e.append(section("7. Signatures"))
    e.append(Spacer(1, 12))

    def sig_cell(title, img, name, date):
        return [
            Paragraph(title, label), Spacer(1, 4),
            (img if img else Paragraph("<i>Awaiting signature</i>", small)),
            Table([[""]], colWidths=[2.8 * inch], style=[("LINEBELOW", (0, 0), (-1, -1), 0.8, DARK), ("TOPPADDING", (0, 0), (-1, -1), 2)]),
            Paragraph(name or "", small),
            Paragraph(f"Date: {date or '_______________'}", small),
        ]
    cs = _sig_image(c.get("client_signature"))
    ks = _sig_image(c.get("contractor_signature"))
    sig = Table([[sig_cell("CLIENT", cs, c.get("client_name", ""), c.get("client_signed_date", "")),
                  sig_cell("CONTRACTOR", ks, c.get("contractor_name", ""), c.get("contractor_signed_date", ""))]],
                colWidths=[3.45 * inch, 3.45 * inch])
    sig.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    e.append(sig)
    e.append(Spacer(1, 18))
    e.append(Paragraph("This agreement represents the entire understanding between the parties. Revival Pro will never ask for payment details by email.", small))

    doc.build(e)
    return buf.getvalue()
