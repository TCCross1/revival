import os
import re
import ipaddress
import logging
import base64
import httpx
from io import BytesIO
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse
from xml.sax.saxutils import escape
from datetime import datetime
from dotenv import load_dotenv
from fastapi import HTTPException

from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.units import inch
from reportlab.lib.enums import TA_RIGHT, TA_CENTER
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Image,
    ListFlowable, ListItem, Flowable,
)

_HERE = Path(__file__).resolve().parent
load_dotenv(_HERE.parent / ".env", interpolate=False)
load_dotenv(_HERE / ".env", interpolate=False)
logger = logging.getLogger(__name__)

EMAIL_BASE_URL = "https://integrations.emergentagent.com"
EMAIL_KEY = os.environ["EMERGENT_EMAIL_KEY"]
EMAIL_FROM_NAME = os.environ["EMAIL_FROM_NAME"]
EMAIL_REPLY_TO = os.environ.get("EMAIL_REPLY_TO")

TEAL = colors.HexColor("#0A4D68")
TEAL_DEEP = colors.HexColor("#083D53")
GOLD = colors.HexColor("#C9A227")
DARK = colors.HexColor("#061A23")
GREY = colors.HexColor("#4B6370")
CREAM = colors.HexColor("#F2F1EC")
LINE = colors.HexColor("#D5D0C6")
PEACH = colors.HexColor("#E8D3B3")
GREEN = colors.HexColor("#2E8B3A")
WHITE = colors.white

LOGO_PATH = _HERE / "assets" / "revival-brand-logo.png"
DOC_PHONE = "859-227-0340"
DOC_EMAIL = "revivalhomeremodelingllc@gmail.com"
DOC_WEBSITE = "revivalhr.com"
PAGE_W, PAGE_H = letter
CONTENT_W = 7.34 * inch
TOP_BAR = 22
FOOTER_H = 0.50 * inch


def money(n):
    return "${:,.2f}".format(float(n or 0))


def _xml(text):
    return escape(str(text or "")).replace("\n", "<br/>")


def _fmt_date(raw):
    if not raw:
        return "—"
    text = str(raw).strip()
    for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f"):
        try:
            return datetime.strptime(text[:26].replace("Z", ""), fmt).strftime("%b %d, %Y")
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(text.replace("Z", "")).strftime("%b %d, %Y")
    except Exception:
        return text[:10]


def _status_color(status):
    s = (status or "").strip().lower()
    if s in ("paid", "won", "signed", "complete", "completed", "active"):
        return GREEN
    if s in ("partial", "sent", "approved"):
        return TEAL
    if s in ("overdue", "void", "cancelled", "canceled"):
        return colors.HexColor("#B42318")
    return DARK


def _contacts(company):
    return DOC_PHONE, DOC_EMAIL, DOC_WEBSITE


def _logo_image():
    try:
        if LOGO_PATH.exists():
            return Image(str(LOGO_PATH), width=2.08 * inch, height=2.12 * inch, kind="proportional")
    except Exception:
        logger.warning("Could not load the Revival logo for a PDF; using text fallback.")
    return None


class CircleIcon(Flowable):
    """Small teal (or peach) badge with a simple white glyph."""

    def __init__(self, kind="dot", size=14, fill=None, ink=None):
        super().__init__()
        self.kind = kind
        self.size = float(size)
        self.fill = fill or TEAL
        self.ink = ink or WHITE
        self.width = self.size
        self.height = self.size

    def wrap(self, aw, ah):
        return self.width, self.height

    def draw(self):
        c = self.canv
        s = self.size
        r = s / 2.0
        c.setFillColor(self.fill)
        c.circle(r, r, r, fill=1, stroke=0)
        c.setStrokeColor(self.ink)
        c.setFillColor(self.ink)
        c.setLineWidth(max(0.75, s / 13.0))
        c.setLineCap(1)
        c.setLineJoin(1)
        k = self.kind
        if k == "calendar":
            c.roundRect(s * 0.28, s * 0.22, s * 0.44, s * 0.46, 1, fill=0, stroke=1)
            c.line(s * 0.28, s * 0.52, s * 0.72, s * 0.52)
            c.line(s * 0.40, s * 0.66, s * 0.40, s * 0.58)
            c.line(s * 0.60, s * 0.66, s * 0.60, s * 0.58)
        elif k == "clock":
            c.circle(r, r, s * 0.28, fill=0, stroke=1)
            c.line(r, r, r, r + s * 0.18)
            c.line(r, r, r + s * 0.14, r - s * 0.04)
        elif k == "check":
            c.line(s * 0.28, s * 0.50, s * 0.44, s * 0.34)
            c.line(s * 0.44, s * 0.34, s * 0.74, s * 0.66)
        elif k == "handshake":
            c.setLineWidth(max(0.9, s / 12.0))
            c.roundRect(s * 0.16, s * 0.40, s * 0.28, s * 0.18, 1.4, fill=0, stroke=1)
            c.roundRect(s * 0.56, s * 0.40, s * 0.28, s * 0.18, 1.4, fill=0, stroke=1)
            c.roundRect(s * 0.34, s * 0.36, s * 0.32, s * 0.26, 2.0, fill=1, stroke=0)
        elif k == "phone":
            c.roundRect(s * 0.38, s * 0.22, s * 0.24, s * 0.56, 1.4, fill=0, stroke=1)
            c.line(s * 0.44, s * 0.30, s * 0.56, s * 0.30)
        elif k == "mail":
            c.rect(s * 0.24, s * 0.32, s * 0.52, s * 0.34, fill=0, stroke=1)
            c.line(s * 0.24, s * 0.66, r, s * 0.46)
            c.line(r, s * 0.46, s * 0.76, s * 0.66)
        elif k == "globe":
            c.circle(r, r, s * 0.26, fill=0, stroke=1)
            c.ellipse(r - s * 0.12, r - s * 0.26, r + s * 0.12, r + s * 0.26, fill=0, stroke=1)
            c.line(r - s * 0.26, r, r + s * 0.26, r)
        elif k == "stack":
            c.rect(s * 0.30, s * 0.28, s * 0.40, s * 0.12, fill=1, stroke=0)
            c.rect(s * 0.30, s * 0.44, s * 0.40, s * 0.12, fill=1, stroke=0)
            c.rect(s * 0.30, s * 0.60, s * 0.40, s * 0.12, fill=1, stroke=0)
        elif k == "brush":
            c.line(s * 0.32, s * 0.28, s * 0.68, s * 0.64)
            c.circle(s * 0.70, s * 0.68, s * 0.08, fill=1, stroke=0)
        elif k == "ladder":
            c.line(s * 0.36, s * 0.24, s * 0.36, s * 0.76)
            c.line(s * 0.64, s * 0.24, s * 0.64, s * 0.76)
            c.line(s * 0.36, s * 0.38, s * 0.64, s * 0.38)
            c.line(s * 0.36, s * 0.52, s * 0.64, s * 0.52)
            c.line(s * 0.36, s * 0.66, s * 0.64, s * 0.66)
        elif k == "list":
            c.rect(s * 0.28, s * 0.28, s * 0.44, s * 0.44, fill=0, stroke=1)
            c.line(s * 0.28, s * 0.42, s * 0.72, s * 0.42)
            c.line(s * 0.28, s * 0.56, s * 0.72, s * 0.56)
            c.line(s * 0.42, s * 0.28, s * 0.42, s * 0.72)
        elif k == "cube":
            c.rect(s * 0.30, s * 0.28, s * 0.32, s * 0.32, fill=0, stroke=1)
            c.line(s * 0.30, s * 0.60, s * 0.42, s * 0.70)
            c.line(s * 0.62, s * 0.60, s * 0.74, s * 0.70)
            c.line(s * 0.62, s * 0.28, s * 0.74, s * 0.38)
            c.line(s * 0.42, s * 0.70, s * 0.74, s * 0.70)
            c.line(s * 0.74, s * 0.70, s * 0.74, s * 0.38)
        elif k == "tag":
            p = c.beginPath()
            p.moveTo(s * 0.30, s * 0.50)
            p.lineTo(s * 0.48, s * 0.28)
            p.lineTo(s * 0.74, s * 0.28)
            p.lineTo(s * 0.74, s * 0.54)
            p.lineTo(s * 0.56, s * 0.72)
            p.close()
            c.drawPath(p, fill=0, stroke=1)
            c.circle(s * 0.64, s * 0.38, s * 0.05, fill=1, stroke=0)
        elif k == "dollar":
            c.circle(r, r, s * 0.26, fill=0, stroke=1)
            c.setFont("Helvetica-Bold", max(6, s * 0.42))
            c.drawCentredString(r, r - s * 0.16, "$")
        else:
            c.circle(r, r, s * 0.12, fill=1, stroke=0)


class GoldMark(Flowable):
    def __init__(self, size=7):
        super().__init__()
        self.size = float(size)
        self.width = self.size
        self.height = self.size

    def wrap(self, aw, ah):
        return self.width, self.height

    def draw(self):
        s = self.size
        p = self.canv.beginPath()
        p.moveTo(s / 2, s)
        p.lineTo(s, s / 2)
        p.lineTo(s / 2, 0)
        p.lineTo(0, s / 2)
        p.close()
        self.canv.setFillColor(GOLD)
        self.canv.drawPath(p, fill=1, stroke=0)


class HeaderGlyph(Flowable):
    """White line icon for teal table headers (no circle)."""

    def __init__(self, kind, size=9):
        super().__init__()
        self.kind = kind
        self.size = float(size)
        self.width = self.size
        self.height = self.size

    def wrap(self, aw, ah):
        return self.width, self.height

    def draw(self):
        icon = CircleIcon(self.kind, self.size, fill=TEAL, ink=WHITE)
        icon.canv = self.canv
        self.canv.saveState()
        self.canv.setFillColor(TEAL)
        self.canv.rect(0, 0, self.size, self.size, fill=1, stroke=0)
        icon.draw()
        self.canv.restoreState()


class TitleRule(Flowable):
    """Gold title underline with a thicker cap on the right, matching the prototype."""

    def __init__(self, width):
        super().__init__()
        self.width = float(width)
        self.height = 10

    def wrap(self, aw, ah):
        return self.width, self.height

    def draw(self):
        c = self.canv
        y = 5
        c.setStrokeColor(GOLD)
        c.setLineCap(1)
        c.setLineWidth(1.15)
        c.line(0, y, self.width, y)
        c.setLineWidth(3.4)
        c.line(self.width - 34, y, self.width - 6, y)


def _draw_footer_icon(c, kind, x, y, s=7.5):
    c.saveState()
    c.setStrokeColor(WHITE)
    c.setFillColor(WHITE)
    c.setLineWidth(0.95)
    c.setLineCap(1)
    c.setLineJoin(1)
    if kind == "phone":
        c.roundRect(x, y - 1.2, s * 0.55, s, 1.1, fill=0, stroke=1)
        c.line(x + s * 0.12, y - 0.2, x + s * 0.43, y - 0.2)
    elif kind == "mail":
        c.rect(x, y, s, s * 0.68, fill=0, stroke=1)
        c.line(x, y + s * 0.68, x + s / 2, y + s * 0.28)
        c.line(x + s / 2, y + s * 0.28, x + s, y + s * 0.68)
    else:
        c.circle(x + s / 2, y + s * 0.38, s * 0.38, fill=0, stroke=1)
        c.ellipse(x + s * 0.28, y, x + s * 0.72, y + s * 0.76, fill=0, stroke=1)
        c.line(x + s * 0.08, y + s * 0.38, x + s * 0.92, y + s * 0.38)
    c.restoreState()


def _styles():
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle("doc_title", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=26, leading=28, textColor=TEAL, alignment=TA_RIGHT, spaceAfter=0),
        "number": ParagraphStyle("doc_number", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=10, leading=13, textColor=GOLD, alignment=TA_RIGHT),
        "gold_label": ParagraphStyle("gold_label", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=8.5, leading=11, textColor=GOLD),
        "label": ParagraphStyle("muted_label", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=7.2, leading=9, textColor=TEAL),
        "body": ParagraphStyle("body", parent=base["Normal"], fontName="Helvetica", fontSize=9.5, leading=13, textColor=DARK),
        "name": ParagraphStyle("client_name", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=12.5, leading=16, textColor=DARK),
        "meta": ParagraphStyle("meta_val", parent=base["Normal"], fontName="Helvetica", fontSize=9.5, leading=12, textColor=DARK),
        "meta_b": ParagraphStyle("meta_b", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=10, leading=12, textColor=DARK),
        "th": ParagraphStyle("th", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=7.8, leading=10, textColor=WHITE),
        "td": ParagraphStyle("td", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=9, leading=12, textColor=DARK),
        "td_right": ParagraphStyle("td_right", parent=base["Normal"], fontName="Helvetica", fontSize=9, leading=12, textColor=DARK, alignment=TA_RIGHT),
        "td_center": ParagraphStyle("td_center", parent=base["Normal"], fontName="Helvetica", fontSize=9, leading=12, textColor=DARK, alignment=TA_CENTER),
        "note": ParagraphStyle("note", parent=base["Normal"], fontName="Helvetica", fontSize=8, leading=11.5, textColor=GREY),
        "note_i": ParagraphStyle("note_i", parent=base["Normal"], fontName="Helvetica-Oblique", fontSize=8, leading=11.5, textColor=GREY),
        "thanks": ParagraphStyle("thanks", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=10.5, leading=13, textColor=TEAL),
        "section": ParagraphStyle("section", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=10, leading=13, textColor=WHITE),
        "brand_fallback": ParagraphStyle("brand_fallback", parent=base["Normal"], fontName="Times-Bold", fontSize=18, leading=20, textColor=TEAL),
        "tag": ParagraphStyle("tag", parent=base["Normal"], fontName="Helvetica", fontSize=6.5, leading=9, textColor=TEAL, alignment=TA_CENTER),
        "paid": ParagraphStyle("paid", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=8.5, leading=11, textColor=GREEN, alignment=TA_RIGHT),
        "small": ParagraphStyle("small", parent=base["Normal"], fontName="Helvetica", fontSize=8, leading=11, textColor=GREY),
        "tot_label": ParagraphStyle("tot_label", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=7.4, leading=10, textColor=GREY),
        "tot_val": ParagraphStyle("tot_val", parent=base["Normal"], fontName="Helvetica", fontSize=9, leading=12, textColor=DARK, alignment=TA_RIGHT),
    }


def _paint_page(canvas, doc):
    canvas.saveState()
    try:
        canvas.setFillColor(CREAM)
        canvas.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)

        canvas.setFillColor(TEAL)
        canvas.rect(0, PAGE_H - TOP_BAR, PAGE_W, TOP_BAR, fill=1, stroke=0)

        canvas.setFillColor(GOLD)
        corner = canvas.beginPath()
        corner.moveTo(PAGE_W - 1.35 * inch, PAGE_H)
        corner.lineTo(PAGE_W, PAGE_H)
        corner.lineTo(PAGE_W, PAGE_H - TOP_BAR)
        corner.lineTo(PAGE_W - 0.42 * inch, PAGE_H - TOP_BAR)
        corner.close()
        canvas.drawPath(corner, fill=1, stroke=0)

        canvas.setStrokeColor(GOLD)
        canvas.setLineCap(1)
        canvas.setLineWidth(2.0)
        canvas.line(PAGE_W - 1.55 * inch, PAGE_H - TOP_BAR, PAGE_W, PAGE_H - TOP_BAR)
        canvas.setLineWidth(3.6)
        canvas.line(PAGE_W - 0.62 * inch, PAGE_H - TOP_BAR, PAGE_W - 0.18 * inch, PAGE_H - TOP_BAR)

        canvas.setFillColor(TEAL)
        canvas.rect(0, 0, PAGE_W, FOOTER_H, fill=1, stroke=0)
        canvas.setStrokeColor(GOLD)
        canvas.setLineWidth(2.0)
        canvas.line(0, FOOTER_H, PAGE_W * 0.38, FOOTER_H)

        phone, email, site = _contacts(getattr(doc, "company", {}) or {})
        canvas.setFillColor(WHITE)
        canvas.setFont("Helvetica", 8)
        mid_y = FOOTER_H / 2 - 2.5
        sep = "    |    "
        parts = [("phone", phone), ("mail", email), ("globe", site)]
        icon_w = 11
        widths = [icon_w + canvas.stringWidth(text, "Helvetica", 8) for _, text in parts]
        total = sum(widths) + 2 * canvas.stringWidth(sep, "Helvetica", 8)
        x = (PAGE_W - total) / 2
        for i, (kind, text) in enumerate(parts):
            _draw_footer_icon(canvas, kind, x, mid_y - 1)
            x += icon_w
            canvas.setFillColor(WHITE)
            canvas.setFont("Helvetica", 8)
            canvas.drawString(x, mid_y, text)
            x += canvas.stringWidth(text, "Helvetica", 8)
            if i < 2:
                canvas.drawString(x, mid_y, sep)
                x += canvas.stringWidth(sep, "Helvetica", 8)
    except Exception:
        logger.exception("PDF page chrome failed")
    canvas.restoreState()


def _make_doc(buf, company, title):
    doc = SimpleDocTemplate(
        buf,
        pagesize=letter,
        topMargin=0.52 * inch,
        bottomMargin=0.78 * inch,
        leftMargin=0.52 * inch,
        rightMargin=0.52 * inch,
        title=title,
        author="Revival Home Remodeling",
    )
    doc.company = company or {}
    return doc


def _render(elems, company, title):
    buf = BytesIO()
    doc = _make_doc(buf, company, title)
    try:
        doc.build(elems, onFirstPage=_paint_page, onLaterPages=_paint_page)
    except Exception:
        logger.exception("PDF build failed title=%s", title)
        raise
    return buf.getvalue()


def _masthead(styles, doc_title, number, client, heading, meta_rows):
    """Logo + bill-to on the left; title, number, and date/status on the right — matching the prototype."""
    client = client or {}
    logo = _logo_image()
    gold_bar = Table([[""]], colWidths=[0.58 * inch])
    gold_bar.setStyle(TableStyle([
        ("LINEBELOW", (0, 0), (-1, -1), 2.4, GOLD),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("BACKGROUND", (0, 0), (-1, -1), CREAM),
    ]))
    left = [logo if logo else Paragraph("REVIVAL<br/>HOME REMODELING", styles["brand_fallback"])]
    left += [
        Spacer(1, 10),
        Paragraph(_xml(heading), styles["gold_label"]),
        gold_bar,
        Spacer(1, 6),
        Paragraph(_xml(client.get("name") or "—"), styles["name"]),
    ]
    for key in ("address", "phone", "email"):
        if client.get(key):
            left.append(Paragraph(_xml(client.get(key)), styles["body"]))

    right = [
        Spacer(1, 6),
        Paragraph(_xml(doc_title), styles["title"]),
        TitleRule(3.22 * inch),
        Paragraph(_xml(number), styles["number"]),
        Spacer(1, 16),
        _meta_panel(styles, meta_rows),
    ]
    tbl = Table([[left, right]], colWidths=[4.12 * inch, 3.22 * inch])
    tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (0, 0), 16),
        ("RIGHTPADDING", (1, 0), (1, 0), 0),
        ("LINEAFTER", (0, 0), (0, 0), 0.55, LINE),
        ("BACKGROUND", (0, 0), (-1, -1), CREAM),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    return tbl


def _meta_panel(styles, rows):
    data = []
    for kind, label, value, color in rows:
        val_style = ParagraphStyle(
            f"meta_val_{kind}_{id(value)}",
            parent=styles["meta_b"] if color else styles["meta"],
            textColor=color or DARK,
            alignment=TA_RIGHT,
        )
        data.append([
            CircleIcon(kind, 15),
            Paragraph(_xml(label), styles["label"]),
            Paragraph(_xml(value), val_style),
        ])
    tbl = Table(data, colWidths=[22, 1.28 * inch, 1.62 * inch])
    tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("LINEBELOW", (0, 0), (-1, -2), 0.45, LINE),
        ("BACKGROUND", (0, 0), (-1, -1), CREAM),
    ]))
    return tbl


def _icon_row(styles, kind, label, value, value_color=None):
    return _meta_panel(styles, [(kind, label, value, value_color)])


def _bill_block(styles, client, extra_right=None, heading="BILL TO"):
    client = client or {}
    name = client.get("name") or "—"
    gold_bar = Table([[""]], colWidths=[0.58 * inch])
    gold_bar.setStyle(TableStyle([
        ("LINEBELOW", (0, 0), (-1, -1), 2.4, GOLD),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("BACKGROUND", (0, 0), (-1, -1), CREAM),
    ]))
    lines = [
        Paragraph(_xml(heading), styles["gold_label"]),
        gold_bar,
        Spacer(1, 6),
        Paragraph(_xml(name), styles["name"]),
    ]
    for key in ("address", "phone", "email"):
        if client.get(key):
            lines.append(Paragraph(_xml(client.get(key)), styles["body"]))
    right = extra_right or []
    tbl = Table([[lines, right]], colWidths=[4.12 * inch, 3.22 * inch])
    tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (0, 0), 16),
        ("RIGHTPADDING", (1, 0), (1, 0), 0),
        ("LINEAFTER", (0, 0), (0, 0), 0.6, LINE),
        ("BACKGROUND", (0, 0), (-1, -1), CREAM),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    return tbl


def _th(styles, text, icon):
    cell = Table([[HeaderGlyph(icon, 10), Paragraph(_xml(text), styles["th"])]], colWidths=[14, None])
    cell.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("BACKGROUND", (0, 0), (-1, -1), TEAL),
    ]))
    return cell


def _item_kind(description):
    d = (description or "").lower()
    if any(k in d for k in ("paint", "stain", "brush")):
        return "brush"
    if any(k in d for k in ("siding", "cement", "material", "lumber", "tile", "fixture", "cabinet")):
        return "stack"
    if any(k in d for k in ("trim", "ladder", "labor", "install", "crew")):
        return "ladder"
    return "dot"


def _desc_cell(styles, text):
    inner = Table([
        [CircleIcon(_item_kind(text), 12), Paragraph(_xml(text or "—"), styles["td"])],
    ], colWidths=[18, 3.55 * inch])
    inner.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("BACKGROUND", (0, 0), (-1, -1), WHITE),
    ]))
    return inner


def _line_table(styles, line_items, fallback_amount=None):
    data = [[
        _th(styles, "DESCRIPTION", "list"),
        _th(styles, "QTY", "cube"),
        _th(styles, "UNIT PRICE", "tag"),
        _th(styles, "AMOUNT", "dollar"),
    ]]
    items = list(line_items or [])
    if items:
        for li in items:
            data.append([
                _desc_cell(styles, li.get("description", "")),
                Paragraph(_xml("{:g}".format(float(li.get("quantity", 0) or 0))), styles["td_center"]),
                Paragraph(_xml(money(li.get("unit_price", 0))), styles["td_right"]),
                Paragraph(_xml(money(li.get("amount", 0))), styles["td_right"]),
            ])
    else:
        data.append([
            _desc_cell(styles, "Services"),
            Paragraph("1", styles["td_center"]),
            Paragraph(_xml(money(fallback_amount or 0)), styles["td_right"]),
            Paragraph(_xml(money(fallback_amount or 0)), styles["td_right"]),
        ])
    tbl = Table(data, colWidths=[3.95 * inch, 0.78 * inch, 1.36 * inch, 1.37 * inch], repeatRows=1)
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), TEAL),
        ("BACKGROUND", (0, 1), (-1, -1), WHITE),
        ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("ALIGN", (1, 0), (1, -1), "CENTER"),
        ("ALIGN", (2, 0), (-1, -1), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, 0), 10),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 10),
        ("TOPPADDING", (0, 1), (-1, -1), 9),
        ("BOTTOMPADDING", (0, 1), (-1, -1), 9),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("LINEBELOW", (0, 0), (-1, 0), 1.8, GOLD),
        ("LINEBELOW", (0, 1), (-1, -1), 0.4, LINE),
    ]))
    return tbl


def _totals_box(styles, rows, paid_in_full=False):
    data = []
    paid_idx = None
    balance_idx = None
    for i, row in enumerate(rows):
        label, value, kind = row[0], row[1], row[2] if len(row) > 2 else "normal"
        if kind == "paid":
            paid_idx = i
            data.append([
                Paragraph(f"<font color='white'><b>{_xml(label)}</b></font>", styles["td"]),
                Paragraph(f"<font color='white'><b>{_xml(value)}</b></font>", styles["td_right"]),
            ])
        elif kind == "balance":
            balance_idx = i
            big = ParagraphStyle("bal", parent=styles["name"], alignment=TA_RIGHT, fontSize=14, textColor=TEAL)
            data.append([
                Paragraph(f"<b>{_xml(label)}</b>", ParagraphStyle("bal_l", parent=styles["name"], fontSize=10, textColor=TEAL)),
                Paragraph(_xml(value), big),
            ])
        else:
            data.append([
                Paragraph(_xml(label), styles["tot_label"]),
                Paragraph(_xml(value), styles["tot_val"]),
            ])
    if paid_in_full:
        check = Table([[CircleIcon("check", 12, fill=GREEN), Paragraph("PAID IN FULL", styles["paid"])]], colWidths=[16, 1.9 * inch])
        check.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("ALIGN", (1, 0), (1, 0), "RIGHT"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("BACKGROUND", (0, 0), (-1, -1), CREAM),
        ]))
        data.append([check, ""])

    tbl = Table(data, colWidths=[1.55 * inch, 1.55 * inch])
    cmds = [
        ("BACKGROUND", (0, 0), (-1, -1), CREAM),
        ("BOX", (0, 0), (-1, -1), 0.6, LINE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("SPAN", (0, len(data) - 1), (-1, len(data) - 1)) if paid_in_full else ("TOPPADDING", (0, 0), (0, 0), 6),
    ]
    if paid_idx is not None:
        cmds += [
            ("BACKGROUND", (0, paid_idx), (-1, paid_idx), TEAL),
            ("TEXTCOLOR", (0, paid_idx), (-1, paid_idx), WHITE),
        ]
    if balance_idx is not None:
        cmds.append(("TOPPADDING", (0, balance_idx), (-1, balance_idx), 8))
    tbl.setStyle(TableStyle(cmds))
    return tbl


def _thanks_block(styles, headline, note, italic=""):
    icon = CircleIcon("handshake", 24, fill=PEACH, ink=TEAL)
    copy = [Paragraph(_xml(headline), styles["thanks"]), Spacer(1, 4), Paragraph(_xml(note), styles["note"])]
    if italic:
        copy += [Spacer(1, 2), Paragraph(_xml(italic), styles["note_i"])]
    tbl = Table([[icon, copy]], colWidths=[0.46 * inch, 3.5 * inch])
    tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("BACKGROUND", (0, 0), (-1, -1), CREAM),
    ]))
    return tbl


def _bottom_row(styles, thanks, totals):
    tbl = Table([[thanks, totals]], colWidths=[4.05 * inch, 3.29 * inch])
    tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN", (1, 0), (1, 0), "RIGHT"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("BACKGROUND", (0, 0), (-1, -1), CREAM),
    ]))
    return tbl


def _section_bar(styles, title):
    t = Table([[Paragraph(_xml(title), styles["section"])]], colWidths=[CONTENT_W])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), TEAL),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("LINEBELOW", (0, 0), (-1, -1), 1.5, GOLD),
    ]))
    return t


def _pick_terms(doc, company, field, company_field=""):
    text = str((doc or {}).get(field) or "").strip()
    if text:
        return text
    return str((company or {}).get(company_field or field) or "").strip()


def _fill_markup(text, markup):
    try:
        pct = f"{float(markup or 0):g}"
    except (TypeError, ValueError):
        pct = "20"
    return (text or "").replace("{markup}", pct)


def _terms_section(styles, title, text):
    text = (text or "").strip()
    if not text:
        return []
    bits = [_section_bar(styles, title), Spacer(1, 8)]
    for para in text.split("\n\n"):
        chunk = para.strip()
        if not chunk:
            continue
        bits.append(Paragraph(_xml(chunk), styles["body"]))
        bits.append(Spacer(1, 6))
    bits.append(Spacer(1, 6))
    return bits


def _client_from(client, fallback_name=""):
    client = dict(client or {})
    if not client.get("name"):
        client["name"] = fallback_name or "—"
    return client


# ---------------- PDF ----------------
def build_estimate_pdf(est: dict, client: dict | None, company: dict | None = None) -> bytes:
    styles = _styles()
    client = _client_from(client, est.get("client_name"))
    created = _fmt_date(est.get("created_at"))
    status = est.get("status") or "Draft"
    elems = [
        _masthead(styles, "ESTIMATE", est.get("estimate_number") or "", client, "PREPARED FOR", [
            ("calendar", "ESTIMATE DATE", created, None),
            ("stack", "PROJECT", est.get("category") or "—", None),
            ("check", "STATUS", status, _status_color(status)),
        ]),
        Spacer(1, 18),
        _line_table(styles, est.get("line_items") or [], est.get("total")),
        Spacer(1, 16),
    ]
    totals_rows = [
        ["SUBTOTAL", money(est.get("subtotal", 0)), "normal"],
        [f"TAX ({est.get('tax_rate', 0)}%)", money(est.get("tax_amount", 0)), "normal"],
        ["TOTAL", money(est.get("total", 0)), "balance"],
    ]
    pricing = est.get("pricing") or {}
    if pricing.get("smart"):
        totals_rows = [
            ["Direct costs", money(pricing.get("direct_costs", 0)), "normal"],
            ["Allocated overhead", money(pricing.get("allocated_overhead", 0)), "normal"],
            ["True job cost", money(pricing.get("true_job_cost", 0)), "normal"],
            [f"Profit ({pricing.get('profit_margin_pct', 0)}%)", money(pricing.get("profit", 0)), "normal"],
            ["Price before fees", money(pricing.get("base_price", 0)), "normal"],
            [f"Card fee ({pricing.get('cc_fee_pct', 0)}%)", money(pricing.get("cc_fee", 0)), "normal"],
            [f"Sales tax on materials ({pricing.get('sales_tax_pct', 0)}%)", money(pricing.get("sales_tax", 0)), "normal"],
        ]
        if pricing.get("apply_optional_tax"):
            totals_rows.append([f"Federal + state tax ({pricing.get('optional_tax_pct', 0)}%)", money(pricing.get("optional_tax", 0)), "normal"])
        totals_rows.append(["TOTAL", money(pricing.get("final_price", est.get("total", 0))), "balance"])
    totals = _totals_box(styles, totals_rows)
    thanks = _thanks_block(
        styles,
        "Thank you for the opportunity!",
        "This estimate is valid for 30 days. Prepared by Revival Pro —",
        "we never ask for payment details by email.",
    )
    elems.append(_bottom_row(styles, thanks, totals))
    if est.get("notes"):
        elems += [Spacer(1, 14), Paragraph("NOTES", styles["gold_label"]), Spacer(1, 4), Paragraph(_xml(est.get("notes")), styles["note"])]
    elems += _terms_section(styles, "TERMS OF ESTIMATE", _pick_terms(est, company, "terms", "estimate_terms"))
    return _render(elems, company, f"Estimate {est.get('estimate_number') or ''}".strip())


def build_invoice_pdf(inv: dict, client: dict | None, company: dict | None = None) -> bytes:
    styles = _styles()
    client = _client_from(client, inv.get("client_name"))
    created = _fmt_date(inv.get("created_at"))
    due = _fmt_date(inv.get("due_date"))
    status = inv.get("status") or "Draft"
    line_items = inv.get("line_items") or []
    amount = float(inv.get("amount", 0) or 0)
    paid = float(inv.get("amount_paid", 0) or 0)
    balance = round(max(amount - paid, 0), 2)
    subtotal = round(sum(float(li.get("amount", 0) or 0) for li in line_items), 2) if line_items else amount
    tax = round(max(amount - subtotal, 0), 2) if line_items else 0

    rows = [["SUBTOTAL", money(subtotal), "normal"]]
    if tax > 0 and subtotal > 0:
        rate = round(tax / subtotal * 100, 2)
        rows.append([f"TAX ({rate:g}%)", money(tax), "normal"])
    rows.append(["AMOUNT PAID", money(paid), "paid"])
    rows.append(["BALANCE DUE", money(balance), "balance"])

    elems = [
        _masthead(styles, "INVOICE", inv.get("invoice_number") or "", client, "BILL TO", [
            ("calendar", "INVOICE DATE", created, None),
            ("clock", "DUE DATE", due, None),
            ("check", "STATUS", status.upper(), _status_color(status)),
        ]),
        Spacer(1, 18),
        _line_table(styles, line_items, amount),
        Spacer(1, 16),
        _bottom_row(
            styles,
            _thanks_block(
                styles,
                "Thank you for your business!",
                "Please remit payment by the due date. Prepared by Revival Pro —",
                "we never ask for payment details by email.",
            ),
            _totals_box(styles, rows, paid_in_full=(balance <= 0 and amount > 0)),
        ),
    ]
    elems += _terms_section(styles, "TERMS OF INVOICE", _pick_terms(inv, company, "terms", "invoice_terms"))
    return _render(elems, company, f"Invoice {inv.get('invoice_number') or ''}".strip())


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
        logger.warning("Could not render a signature image on the contract PDF.")
        return None


def build_contract_pdf(c: dict, company: dict | None = None) -> bytes:
    styles = _styles()
    client = {
        "name": c.get("client_name") or "—",
        "address": c.get("client_address") or "",
        "phone": c.get("client_phone") or "",
        "email": c.get("client_email") or "",
    }
    created = _fmt_date(c.get("created_at"))
    status = c.get("status") or "Draft"
    e = [
        _masthead(styles, "CONTRACT", c.get("contract_number") or "", client, "CLIENT", [
            ("calendar", "CONTRACT DATE", created, None),
            ("check", "STATUS", status, _status_color(status)),
        ]),
        Spacer(1, 14),
        _section_bar(styles, "1. Parties"),
        Spacer(1, 8),
    ]
    parties = Table([[
        [Paragraph("CONTRACTOR", styles["gold_label"]), Spacer(1, 4),
         Paragraph(f"<b>{_xml(c.get('contractor_name',''))}</b><br/>{_xml(c.get('contractor_address',''))}<br/>{_xml(c.get('contractor_phone',''))}<br/>{_xml(c.get('contractor_license',''))}", styles["body"])],
        [Paragraph("CLIENT (HOMEOWNER)", styles["gold_label"]), Spacer(1, 4),
         Paragraph(f"<b>{_xml(c.get('client_name',''))}</b><br/>{_xml(c.get('client_address',''))}<br/>{_xml(c.get('client_phone',''))}<br/>{_xml(c.get('client_email',''))}", styles["body"])],
    ]], colWidths=[3.67 * inch, 3.67 * inch])
    parties.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BACKGROUND", (0, 0), (-1, -1), CREAM),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (0, 0), 12),
    ]))
    e += [
        parties, Spacer(1, 12),
        _section_bar(styles, "2. Project Information"), Spacer(1, 8),
        Paragraph(f"<b>Job Address:</b> {_xml(c.get('project_address',''))}", styles["body"]), Spacer(1, 3),
        Paragraph(f"<b>Description of Project:</b> {_xml(c.get('project_description',''))}", styles["body"]), Spacer(1, 12),
        _section_bar(styles, "3. Scope of Work"), Spacer(1, 8),
        _line_table(styles, c.get("line_items") or [], c.get("total")), Spacer(1, 12),
        _section_bar(styles, "4. Contract Price and Payment Terms"), Spacer(1, 8),
        Paragraph(f"<b>Total Contract Price:</b> <font color='#0A4D68'><b>{money(c.get('total',0))}</b></font>", styles["body"]),
        Spacer(1, 8),
        Paragraph("PAYMENT SCHEDULE", styles["gold_label"]), Spacer(1, 4),
    ]
    ps = [[Paragraph("MILESTONE", styles["th"]), Paragraph("AMOUNT", styles["th"])]]
    for m in c.get("payment_schedule", []):
        lbl = m.get("label", "")
        if m.get("note"):
            lbl += f"  —  {m['note']}"
        ps.append([Paragraph(_xml(lbl), styles["td"]), Paragraph(money(m.get("amount", 0)), styles["td_right"])])
    pst = Table(ps, colWidths=[5.7 * inch, 1.64 * inch], repeatRows=1)
    pst.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), TEAL),
        ("BACKGROUND", (0, 1), (-1, -1), CREAM),
        ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("LINEBELOW", (0, 0), (-1, 0), 1.5, GOLD),
        ("LINEBELOW", (0, 1), (-1, -1), 0.4, LINE),
    ]))
    e += [pst, Spacer(1, 12)]
    e += _terms_section(styles, "5. General Terms", _pick_terms(c, company, "terms", "contract_terms"))
    e += [_section_bar(styles, "6. Exclusions"), Spacer(1, 8),
          Paragraph("The following are <b>not</b> included in this contract unless specifically added in writing:", styles["body"]),
          Spacer(1, 4),
          ListFlowable([ListItem(Paragraph(_xml(x), styles["body"]), leftIndent=6) for x in (c.get("exclusions") or [])],
                       bulletType="bullet", start="•", leftIndent=16),
          Spacer(1, 12), _section_bar(styles, "7. Change Orders"), Spacer(1, 8)]
    markup = c.get("change_order_markup", 20)
    co_text = _fill_markup(_pick_terms(c, company, "change_order_terms", "change_order_terms"), markup)
    if co_text:
        co_lines = [ln.strip() for ln in co_text.split("\n") if ln.strip()]
        e.append(ListFlowable([ListItem(Paragraph(_xml(x), styles["body"])) for x in co_lines], bulletType="bullet", start="•", leftIndent=16))
    else:
        co = [
            "Any change to the scope of work, price, or timeline must be put in writing.",
            "Both the Client and the Contractor must sign the change order before the additional work begins.",
            "Verbal agreements are not binding.",
            "Each change order will state the description of the change, the price adjustment, and any effect on the schedule.",
            f"Change order work will be priced with a standard markup of {markup:g}% over cost.",
        ]
        e.append(ListFlowable([ListItem(Paragraph(_xml(x), styles["body"])) for x in co], bulletType="bullet", start="•", leftIndent=16))
    e += [Spacer(1, 14), _section_bar(styles, "8. Signatures"), Spacer(1, 12)]

    def sig_cell(title, img, name, date):
        return [
            Paragraph(_xml(title), styles["gold_label"]), Spacer(1, 4),
            (img if img else Paragraph("<i>Awaiting signature</i>", styles["small"])),
            Table([[""]], colWidths=[2.8 * inch], style=[("LINEBELOW", (0, 0), (-1, -1), 0.8, DARK), ("TOPPADDING", (0, 0), (-1, -1), 2)]),
            Paragraph(_xml(name or ""), styles["small"]),
            Paragraph(f"Date: {_xml(date or '_______________')}", styles["small"]),
        ]

    cs = _sig_image(c.get("client_signature"))
    ks = _sig_image(c.get("contractor_signature"))
    sig = Table([[sig_cell("CLIENT", cs, c.get("client_name", ""), c.get("client_signed_date", "")),
                  sig_cell("CONTRACTOR", ks, c.get("contractor_name", ""), c.get("contractor_signed_date", ""))]],
                colWidths=[3.67 * inch, 3.67 * inch])
    sig.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("BACKGROUND", (0, 0), (-1, -1), CREAM)]))
    e += [
        sig, Spacer(1, 16),
        _thanks_block(
            styles,
            "Thank you for trusting Revival Home Remodeling.",
            "This agreement represents the entire understanding between the parties. Revival Pro —",
            "will never ask for payment details by email.",
        ),
    ]
    return _render(e, company, f"Contract {c.get('contract_number') or ''}".strip())


def build_job_sheet_pdf(sheet: dict, job: dict, totals: dict | None = None, client: dict | None = None, company: dict | None = None, pricing: dict | None = None) -> bytes:
    styles = _styles()
    sheet = sheet or {}
    job = job or {}
    totals = totals or {}
    client = _client_from(client, sheet.get("client_name") or job.get("client_name"))
    number = job.get("job_number") or "JOB"
    elems = [
        _masthead(styles, "JOB SHEET", number, client, "CLIENT", [
            ("stack", "PROJECT", sheet.get("project_type") or job.get("name") or "—", None),
            ("check", "STATUS", job.get("status") or "Active", _status_color(job.get("status"))),
            ("calendar", "UPDATED", _fmt_date(sheet.get("updated_at") or sheet.get("created_at") or job.get("created_at")), None),
        ]),
        Spacer(1, 16),
        _section_bar(styles, "Totals"),
        Spacer(1, 8),
    ]
    summary = [
        ["Budget", money(totals.get("budget", sheet.get("budget", 0))), "normal"],
        ["Committed", money(totals.get("committed", 0)), "normal"],
        ["Actual spent", money(totals.get("actual", 0)), "normal"],
        ["Remaining", money(totals.get("remaining", 0)), "normal"],
        ["Client is paying", money(totals.get("income", sheet.get("income", 0))), "normal"],
        ["Gross profit", money(totals.get("gross_profit", 0)), "balance"],
    ]
    elems += [_totals_box(styles, summary), Spacer(1, 14)]
    if (pricing or {}).get("smart"):
        elems += [_section_bar(styles, "Suggested price"), Spacer(1, 8)]
        price_rows = [
            ["Direct costs", money(pricing.get("direct_costs", 0)), "normal"],
            ["Allocated overhead", money(pricing.get("allocated_overhead", 0)), "normal"],
            ["True job cost", money(pricing.get("true_job_cost", 0)), "normal"],
            [f"Profit ({pricing.get('profit_margin_pct', 0)}%)", money(pricing.get("profit", 0)), "normal"],
            [f"Card fee ({pricing.get('cc_fee_pct', 0)}%)", money(pricing.get("cc_fee", 0)), "normal"],
            ["Sales tax on materials", money(pricing.get("sales_tax", 0)), "normal"],
        ]
        if pricing.get("apply_optional_tax"):
            price_rows.append(["Federal + state tax", money(pricing.get("optional_tax", 0)), "normal"])
        price_rows.append(["Suggested price", money(pricing.get("final_price", 0)), "balance"])
        elems += [_totals_box(styles, price_rows), Spacer(1, 14)]
    elems += [_section_bar(styles, "Categories"), Spacer(1, 8)]
    cat_rows = [[
        _th(styles, "CATEGORY", "list"),
        _th(styles, "BUDGET", "dollar"),
        _th(styles, "COMMITTED", "tag"),
        _th(styles, "ACTUAL", "cube"),
    ]]
    for cat in totals.get("categories") or []:
        cat_rows.append([
            Paragraph(_xml(cat.get("name") or ""), styles["td"]),
            Paragraph(money(cat.get("budget", 0)), styles["td_right"]),
            Paragraph(money(cat.get("committed", 0)), styles["td_right"]),
            Paragraph(money(cat.get("actual", 0)), styles["td_right"]),
        ])
    cat_tbl = Table(cat_rows, colWidths=[2.6 * inch, 1.58 * inch, 1.58 * inch, 1.58 * inch], repeatRows=1)
    cat_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), TEAL),
        ("BACKGROUND", (0, 1), (-1, -1), WHITE),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("LINEBELOW", (0, 0), (-1, 0), 1.8, GOLD),
        ("LINEBELOW", (0, 1), (-1, -1), 0.4, LINE),
    ]))
    elems += [cat_tbl, Spacer(1, 14), _section_bar(styles, "Costs"), Spacer(1, 8)]
    exp_rows = [[
        _th(styles, "DESCRIPTION", "list"),
        _th(styles, "CATEGORY", "cube"),
        _th(styles, "TYPE", "tag"),
        _th(styles, "AMOUNT", "dollar"),
    ]]
    expenses = []
    for cat in totals.get("categories") or []:
        expenses.extend(cat.get("expenses") or [])
    if not expenses:
        expenses = list(job.get("expenses") or [])
    if expenses:
        for exp in expenses:
            exp_rows.append([
                Paragraph(_xml(exp.get("description") or "No description"), styles["td"]),
                Paragraph(_xml(exp.get("category") or "Other"), styles["td_right"]),
                Paragraph(_xml("Committed" if exp.get("kind") == "committed" else "Actual"), styles["td_right"]),
                Paragraph(money(exp.get("amount", 0)), styles["td_right"]),
            ])
    else:
        exp_rows.append([
            Paragraph("No costs logged yet.", styles["td"]),
            Paragraph("—", styles["td_right"]),
            Paragraph("—", styles["td_right"]),
            Paragraph(money(0), styles["td_right"]),
        ])
    exp_tbl = Table(exp_rows, colWidths=[3.2 * inch, 1.4 * inch, 1.3 * inch, 1.44 * inch], repeatRows=1)
    exp_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), TEAL),
        ("BACKGROUND", (0, 1), (-1, -1), WHITE),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("LINEBELOW", (0, 0), (-1, 0), 1.8, GOLD),
        ("LINEBELOW", (0, 1), (-1, -1), 0.4, LINE),
    ]))
    elems.append(exp_tbl)
    if sheet.get("notes"):
        elems += [Spacer(1, 14), Paragraph("NOTES", styles["gold_label"]), Spacer(1, 4), Paragraph(_xml(sheet.get("notes")), styles["note"])]
    elems += [
        Spacer(1, 16),
        _thanks_block(styles, "Job financial sheet", "Saved in Revival Pro. A copy is kept in the client Google Drive folder when Drive is connected.", "Revival Pro never asks for payment details by email."),
    ]
    return _render(elems, company, f"Job Sheet {number}".strip())


def build_job_receipts_pdf(job: dict, client: dict | None = None, company: dict | None = None) -> bytes:
    styles = _styles()
    job = job or {}
    client = _client_from(client, job.get("client_name"))
    number = job.get("job_number") or "JOB"
    expenses = list(job.get("expenses") or [])
    elems = [
        _masthead(styles, "RECEIPTS", number, client, "CLIENT", [
            ("stack", "JOB", job.get("name") or "—", None),
            ("check", "STATUS", job.get("status") or "Active", _status_color(job.get("status"))),
            ("dollar", "RECEIPTS", str(len(expenses)), None),
        ]),
        Spacer(1, 16),
        _section_bar(styles, "All receipts for this job"),
        Spacer(1, 8),
    ]
    rows = [[
        _th(styles, "DATE", "calendar"),
        _th(styles, "DESCRIPTION", "list"),
        _th(styles, "CATEGORY", "cube"),
        _th(styles, "TYPE", "tag"),
        _th(styles, "AMOUNT", "dollar"),
    ]]
    total = 0.0
    if expenses:
        for exp in expenses:
            try:
                amount = float(exp.get("amount") or 0)
            except (TypeError, ValueError):
                amount = 0.0
            total += amount
            rows.append([
                Paragraph(_xml(_fmt_date(exp.get("date"))), styles["td"]),
                Paragraph(_xml(exp.get("description") or "No description"), styles["td"]),
                Paragraph(_xml(exp.get("category") or "Other"), styles["td_right"]),
                Paragraph(_xml("Committed" if exp.get("kind") == "committed" else "Actual"), styles["td_right"]),
                Paragraph(money(amount), styles["td_right"]),
            ])
    else:
        rows.append([
            Paragraph("—", styles["td"]),
            Paragraph("No receipts logged yet.", styles["td"]),
            Paragraph("—", styles["td_right"]),
            Paragraph("—", styles["td_right"]),
            Paragraph(money(0), styles["td_right"]),
        ])
    tbl = Table(rows, colWidths=[1.15 * inch, 2.35 * inch, 1.2 * inch, 1.1 * inch, 1.54 * inch], repeatRows=1)
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), TEAL),
        ("BACKGROUND", (0, 1), (-1, -1), WHITE),
        ("ALIGN", (2, 0), (-1, -1), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("LINEBELOW", (0, 0), (-1, 0), 1.8, GOLD),
        ("LINEBELOW", (0, 1), (-1, -1), 0.4, LINE),
    ]))
    elems += [tbl, Spacer(1, 12), _totals_box(styles, [["Receipts total", money(total), "balance"]])]
    elems += [
        Spacer(1, 16),
        _thanks_block(styles, "Keep every receipt with the job", "This file updates whenever costs are added or changed on the job sheet.", "Store vendor quotes and photo receipts in the same client Drive folder."),
    ]
    return _render(elems, company, f"Receipts {number}".strip())
