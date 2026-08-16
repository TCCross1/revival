"""Permit-ready architectural detail sheets (ReportLab canvas).

Mostly black-and-white construction-document style. Dimensions and labels
come from extract_permit_model(). This module never logs addresses.
"""
from __future__ import annotations

import logging
import math
from io import BytesIO

from reportlab.lib.colors import Color, HexColor, black, white
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas as pdfcanvas

from floor_plan import format_ft_in, inches
from permit_model import extract_permit_model

logger = logging.getLogger(__name__)

PAGE_W, PAGE_H = letter
INK = HexColor("#111111")
MUTED = HexColor("#555555")
LIGHT = HexColor("#D0D0D0")
FILL = HexColor("#E8E8E8")
CONCRETE = HexColor("#C8C8C8")
WOOD = HexColor("#E6DFD2")
WRAP = HexColor("#D5DCE3")
SOIL = HexColor("#B9B3A8")


def _clip_rect(c, x, y, w, h):
    p = c.beginPath()
    p.rect(x, y, w, h)
    c.clipPath(p, stroke=0, fill=0)


def hatch_diag(c, x, y, w, h, step=7, color=MUTED, weight=0.25):
    if w <= 0 or h <= 0:
        return
    c.saveState()
    _clip_rect(c, x, y, w, h)
    c.setStrokeColor(color)
    c.setLineWidth(weight)
    start = x - h
    while start < x + w + h:
        c.line(start, y, start + h, y + h)
        start += step
    c.restoreState()


def stipple(c, x, y, w, h, gap=5):
    if w <= 0 or h <= 0:
        return
    c.saveState()
    _clip_rect(c, x, y, w, h)
    c.setFillColor(MUTED)
    col = 0
    yy = y + 2
    while yy < y + h:
        xx = x + 2 + (3 if col % 2 else 0)
        while xx < x + w:
            c.circle(xx, yy, 0.35, fill=1, stroke=0)
            xx += gap
        yy += gap
        col += 1
    c.restoreState()


def batt(c, x, y, w, h):
    if w <= 2 or h <= 4:
        return
    c.saveState()
    _clip_rect(c, x, y, w, h)
    c.setFillColor(Color(0.93, 0.90, 0.90))
    c.rect(x, y, w, h, fill=1, stroke=0)
    c.setStrokeColor(HexColor("#8A6A6A"))
    c.setLineWidth(0.45)
    mid = x + w / 2.0
    yy = y + 3
    while yy < y + h - 2:
        c.line(x + 1, yy, mid, yy + 3)
        c.line(mid, yy + 3, x + w - 1, yy)
        yy += 7
    c.restoreState()


def arrow(c, x, y, dx, dy, size=4):
    length = math.hypot(dx, dy) or 1
    ux, uy = dx / length, dy / length
    px, py = -uy, ux
    c.setFillColor(INK)
    path = c.beginPath()
    path.moveTo(x, y)
    path.lineTo(x - ux * size + px * size * 0.35, y - uy * size + py * size * 0.35)
    path.lineTo(x - ux * size - px * size * 0.35, y - uy * size - py * size * 0.35)
    path.close()
    c.drawPath(path, fill=1, stroke=0)


def leader(c, x1, y1, x2, y2, text, size=6.2, align="left"):
    c.setStrokeColor(INK)
    c.setLineWidth(0.4)
    c.line(x1, y1, x2, y2)
    arrow(c, x1, y1, x1 - x2, y1 - y2, 3.4)
    c.setFillColor(INK)
    c.setFont("Helvetica", size)
    label = str(text or "").upper()
    if align == "right":
        c.drawRightString(x2 - 2, y2 - 2, label)
    else:
        c.drawString(x2 + 3, y2 - 2, label)


def dim_v(c, x, y0, y1, label):
    lo, hi = (y0, y1) if y0 <= y1 else (y1, y0)
    c.setStrokeColor(INK)
    c.setLineWidth(0.35)
    c.line(x, lo, x, hi)
    c.line(x - 3.5, lo, x + 3.5, lo)
    c.line(x - 3.5, hi, x + 3.5, hi)
    c.saveState()
    c.translate(x - 5.5, (lo + hi) / 2.0)
    c.rotate(90)
    c.setFillColor(INK)
    c.setFont("Helvetica", 7)
    c.drawCentredString(0, 0, str(label))
    c.restoreState()


def dim_h(c, y, x0, x1, label):
    lo, hi = (x0, x1) if x0 <= x1 else (x1, x0)
    c.setStrokeColor(INK)
    c.setLineWidth(0.35)
    c.line(lo, y, hi, y)
    c.line(lo, y - 3.5, lo, y + 3.5)
    c.line(hi, y - 3.5, hi, y + 3.5)
    c.setFillColor(INK)
    c.setFont("Helvetica", 7)
    c.drawCentredString((lo + hi) / 2.0, y + 4.5, str(label))


def box(c, x, y, w, h, fill=None, stroke=True, weight=0.8):
    if fill is not None:
        c.setFillColor(fill)
        c.rect(x, y, w, h, fill=1, stroke=0)
    if stroke:
        c.setStrokeColor(INK)
        c.setLineWidth(weight)
        c.rect(x, y, w, h, fill=0, stroke=1)


def notes_block(c, x, y, w, h, title, lines):
    box(c, x, y, w, h, fill=white, weight=0.9)
    c.setFillColor(INK)
    c.setFont("Helvetica-Bold", 8)
    c.drawString(x + 6, y + h - 14, title.upper())
    c.setFont("Helvetica", 6.4)
    text = c.beginText(x + 6, y + h - 26)
    text.setLeading(8.4)
    for i, line in enumerate(lines, 1):
        text.textLine(f"{i}.  {line}")
    c.drawText(text)


def schedule_table(c, x, y, w, rows, col_w, headers):
    row_h = 12
    header_h = 14
    h = header_h + row_h * max(len(rows), 1)
    box(c, x, y, w, h, fill=white, weight=0.8)
    c.setFillColor(INK)
    c.rect(x, y + h - header_h, w, header_h, fill=1, stroke=0)
    c.setFillColor(white)
    c.setFont("Helvetica-Bold", 6.4)
    cx = x + 4
    for i, head in enumerate(headers):
        c.drawString(cx, y + h - 10, str(head).upper())
        cx += col_w[i] if i < len(col_w) else 60
    c.setFillColor(INK)
    c.setFont("Helvetica", 6.3)
    for r, row in enumerate(rows or [["—", "—", "—", "—"]]):
        yy = y + h - header_h - (r + 1) * row_h + 3.5
        if r % 2 == 1:
            c.setFillColor(FILL)
            c.rect(x, y + h - header_h - (r + 1) * row_h, w, row_h, fill=1, stroke=0)
            c.setFillColor(INK)
        cx = x + 4
        for i, cell in enumerate(row):
            c.drawString(cx, yy, str(cell)[:42])
            cx += col_w[i] if i < len(col_w) else 60
    c.setStrokeColor(INK)
    c.setLineWidth(0.4)
    c.rect(x, y, w, h, fill=0, stroke=1)
    return h


def title_block(c, model, sheet_no, title, scale):
    project = (model or {}).get("project") or {}
    y = 22
    h = 46
    box(c, 28, y, PAGE_W - 56, h, fill=white, weight=1.1)
    splits = [28, 210, 430, 520, PAGE_W - 28]
    c.setStrokeColor(INK)
    c.setLineWidth(0.6)
    for x in splits[1:-1]:
        c.line(x, y, x, y + h)
    labels = ["PROJECT", "DRAWING", "SHEET", "DATE"]
    values = [
        f"{project.get('client_name') or 'HOMEOWNER'}\n{project.get('address') or ''}",
        title,
        sheet_no,
        project.get("date") or "",
    ]
    c.setFont("Helvetica", 6)
    c.setFillColor(MUTED)
    for i, lab in enumerate(labels):
        c.drawString(splits[i] + 6, y + h - 11, lab)
    c.setFillColor(INK)
    c.setFont("Helvetica-Bold", 7.2)
    c.drawString(splits[0] + 6, y + 18, (project.get("company_name") or "REVIVAL HOME REMODELING")[:38])
    c.setFont("Helvetica", 6.4)
    addr = (project.get("address") or "")[:48]
    c.drawString(splits[0] + 6, y + 8, addr)
    c.setFont("Helvetica-Bold", 7.4)
    c.drawString(splits[1] + 6, y + 20, title[:36])
    c.setFont("Helvetica", 6.2)
    c.drawString(splits[1] + 6, y + 9, f"SCALE: {scale}")
    c.setFont("Helvetica-Bold", 11)
    c.drawCentredString((splits[2] + splits[3]) / 2.0, y + 16, sheet_no)
    c.setFont("Helvetica", 7)
    c.drawCentredString((splits[3] + splits[4]) / 2.0, y + 16, project.get("date") or "")
    c.setFont("Helvetica", 6)
    c.setFillColor(MUTED)
    c.drawString(28, 12, "CONTRACTOR TO VERIFY ALL DIMENSIONS AND CONDITIONS IN THE FIELD. STRUCTURAL DESIGN BY OTHERS AS REQUIRED.")


def sheet_header(c, title, scale):
    c.setFillColor(INK)
    c.setFont("Helvetica-Bold", 11)
    c.drawCentredString(PAGE_W / 2.0, PAGE_H - 28, title.upper())
    c.setFont("Helvetica", 7)
    c.setFillColor(MUTED)
    c.drawString(32, PAGE_H - 28, f"SCALE: {scale}")
    c.setStrokeColor(INK)
    c.setLineWidth(1.0)
    c.line(28, PAGE_H - 34, PAGE_W - 28, PAGE_H - 34)


def new_page(c, model, sheet_no, title, scale):
    c.setFillColor(white)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    sheet_header(c, title, scale)
    title_block(c, model, sheet_no, title, scale)


def draw_cover(c, model):
    new_page(c, model, "G-001", "PERMIT DETAIL SET — COVER", "N.T.S.")
    project = model.get("project") or {}
    wall = model.get("wall") or {}
    roof = model.get("roof") or {}
    foundation = model.get("foundation") or {}
    opening = wall.get("opening") or {}
    c.setFillColor(INK)
    c.setFont("Helvetica-Bold", 16)
    c.drawString(48, PAGE_H - 70, (project.get("company_name") or "REVIVAL HOME REMODELING").upper())
    c.setFont("Helvetica", 9)
    c.setFillColor(MUTED)
    c.drawString(48, PAGE_H - 86, f"{project.get('jurisdiction')}  ·  {project.get('code')}")
    c.setFillColor(INK)
    c.setFont("Helvetica-Bold", 11)
    c.drawString(48, PAGE_H - 118, "PROJECT")
    c.setFont("Helvetica", 9)
    lines = [
        f"CLIENT:  {project.get('client_name') or '—'}",
        f"ADDRESS:  {project.get('address') or '—'}",
        f"TYPE:  {project.get('project_type') or '—'}",
        f"PLAN:  {project.get('plan_name') or '—'}",
        f"DATE:  {project.get('date') or '—'}",
    ]
    y = PAGE_H - 136
    for line in lines:
        c.drawString(48, y, line)
        y -= 14

    facts = [
        ["WALL HEIGHT", wall.get("height") or "8'-0\"", "PROJECT"],
        ["WALL FRAMING", f"{wall.get('stud')} @ {wall.get('spacing')}", "PROJECT / TYP."],
        ["INSULATION", wall.get("insulation") or "", "TYP. KY ENERGY"],
        ["FOUNDATION", foundation.get("label") or "", "PROJECT"],
        ["FOOTING", f'{int(foundation.get("footing_w_in") or 16)}" W x {int(foundation.get("footing_d_in") or 24)}" D', "TYP. C. KY"],
        ["ROOF", f"{(roof.get('kind') or 'gable').upper()}  {roof.get('pitch')}", roof.get("source", "typical").upper()],
        ["SPAN / RIDGE", f"{roof.get('span')}  /  {roof.get('ridge')}", "CALCULATED"],
        ["PRIMARY OPENING", f"{(opening.get('type') or '').upper()}  {format_ft_in(opening.get('width_in'))} x {format_ft_in(opening.get('height_in'))}", opening.get("source", "").upper()],
        ["HEADER", (opening.get("header") or {}).get("label") or "", "PRELIMINARY"],
        ["BEAMS / LVLS", str(len(model.get("beams") or [])), "FROM PLAN"],
    ]
    schedule_table(c, 48, 210, PAGE_W - 96, facts, [130, 250, 90], ["ITEM", "VALUE", "SOURCE"])

    sheets = [
        "G-001  COVER / PROJECT DATA",
        "A-201  EXTERIOR WALL SECTION",
        "S-101  FOUNDATION / SLAB / FOOTING",
        "A-301  ROOF FRAMING / GABLE SECTION" if (model.get("sheets") or {}).get("roof") else "",
        "S-201  BEAM / HEADER DETAIL" if (model.get("sheets") or {}).get("beam") else "",
    ]
    notes_block(c, 48, 78, PAGE_W - 96, 118, "SHEET INDEX + GENERAL NOTES", [
        "Sheet index: " + "  ·  ".join([s for s in sheets if s]),
        model.get("disclaimer") or "",
        "Concrete min. 3,000 PSI @ 28 days unless noted. Reinforcing ASTM A615 Grade 60.",
        "All lumber #2 SPF or better, dressed and dry. Pressure-treated in contact with concrete.",
        "Provide continuous soffit ventilation, weather-resistive barrier, and flashing per manufacturer and code.",
    ])


def _scale(real_in, in_per_ft):
    return (inches(real_in) / 12.0) * in_per_ft * 72.0


def draw_wall_section(c, model):
    scale = '1/2" = 1\'-0"'
    new_page(c, model, "A-201", "EXTERIOR WALL SECTION", scale)
    wall = model.get("wall") or {}
    opening = wall.get("opening") or {}
    foundation = model.get("foundation") or {}
    s = 0.5
    def u(v):
        return _scale(v, s)

    base_x = 210
    floor_y = 210
    stud_w = u(5.5 if wall.get("stud") == "2x6" else 3.5)
    osb = u(0.4375)
    wrap = u(0.2)
    siding = u(0.75)
    gypsum = u(0.5)
    height = u(wall.get("height_in") or 96)
    sill = u(opening.get("sill_in") or 24)
    oh = u(opening.get("height_in") or 48)
    header_d = u((opening.get("header") or {}).get("depth_in") or 7.25)
    slab = u(foundation.get("slab_in") or 4)
    foot_d = u(min(foundation.get("footing_d_in") or 24, 24))
    foot_w = u(foundation.get("footing_w_in") or 16)
    stem = u(min(foundation.get("stem_in") or 0, 18))

    ext_x = base_x - siding - wrap - osb
    stud_x = base_x
    gyp_x = base_x + stud_w

    # soil + footing
    box(c, ext_x - 36, floor_y - slab - stem - foot_d - 8, 220, foot_d + 8, fill=SOIL, weight=0.3)
    hatch_diag(c, ext_x - 36, floor_y - slab - stem - foot_d - 8, 220, foot_d + 8, 8, MUTED, 0.2)
    box(c, ext_x - 10, floor_y - slab - stem - foot_d, foot_w + 18, foot_d, fill=CONCRETE, weight=0.9)
    stipple(c, ext_x - 10, floor_y - slab - stem - foot_d, foot_w + 18, foot_d, 6)
    if stem:
        box(c, stud_x - osb - 4, floor_y - slab - stem, stud_w + osb + 10, stem, fill=CONCRETE, weight=0.8)
        stipple(c, stud_x - osb - 4, floor_y - slab - stem, stud_w + osb + 10, stem, 6)
    if slab:
        box(c, gyp_x - 4, floor_y - slab, 90, slab, fill=CONCRETE, weight=0.7)
        stipple(c, gyp_x - 4, floor_y - slab, 90, slab, 6)
        c.setStrokeColor(INK)
        c.setDash(2, 2)
        c.setLineWidth(0.6)
        c.line(gyp_x - 4, floor_y - slab + 1.2, gyp_x + 86, floor_y - slab + 1.2)
        c.setDash()

    # wall layers
    box(c, ext_x, floor_y, siding, height, fill=FILL, weight=0.6)
    for i in range(int(height / 7)):
        c.setStrokeColor(INK)
        c.setLineWidth(0.35)
        c.line(ext_x, floor_y + 4 + i * 7, ext_x + siding, floor_y + 8 + i * 7)
    box(c, ext_x + siding, floor_y, wrap, height, fill=WRAP, weight=0.4)
    box(c, ext_x + siding + wrap, floor_y, osb, height, fill=WOOD, weight=0.5)
    box(c, stud_x, floor_y, stud_w, height, fill=white, weight=0.8)
    batt(c, stud_x + 1, floor_y + 4, stud_w - 2, height - 10)
    box(c, gyp_x, floor_y, gypsum, height, fill=white, weight=0.6)

    # plates
    box(c, stud_x, floor_y, stud_w, u(1.5), fill=WOOD, weight=0.8)
    box(c, stud_x, floor_y + height - u(3), stud_w, u(1.5), fill=WOOD, weight=0.8)
    box(c, stud_x, floor_y + height - u(1.5), stud_w, u(1.5), fill=WOOD, weight=0.8)

    # opening
    win_y = floor_y + sill
    box(c, ext_x - 2, win_y, siding + wrap + osb + stud_w + gypsum + 4, oh, fill=white, weight=1.0)
    c.setStrokeColor(INK)
    c.setLineWidth(0.7)
    c.rect(stud_x + 2, win_y + 4, stud_w - 4, oh - 8, fill=0, stroke=1)
    c.line(stud_x + 2, win_y + oh / 2, stud_x + stud_w - 2, win_y + oh / 2)
    box(c, stud_x, win_y + oh, stud_w, header_d, fill=WOOD, weight=1.0)
    hatch_diag(c, stud_x, win_y + oh, stud_w, header_d, 4, INK, 0.35)
    # king / jack marks
    c.setFillColor(WOOD)
    c.rect(stud_x - 3, floor_y, 3, height, fill=1, stroke=1)
    c.rect(gyp_x, floor_y, 3, height, fill=1, stroke=1)

    # anchor bolt
    c.setStrokeColor(INK)
    c.setLineWidth(0.8)
    c.line(stud_x + stud_w / 2, floor_y + u(1.5), stud_x + stud_w / 2, floor_y - u(7))
    c.circle(stud_x + stud_w / 2, floor_y + u(0.6), 1.4, fill=0, stroke=1)

    dim_v(c, ext_x - 28, floor_y, floor_y + height, wall.get("height") or "8'-0\"")
    dim_v(c, gyp_x + 28, win_y, win_y + oh, format_ft_in(opening.get("height_in")))
    dim_v(c, gyp_x + 28, floor_y, win_y, format_ft_in(opening.get("sill_in")))
    dim_h(c, floor_y - slab - stem - foot_d - 16, ext_x - 10, ext_x - 10 + foot_w + 18, f'{int(foundation.get("footing_w_in") or 16)}" FOOTING')

    leader(c, stud_x + stud_w / 2, floor_y + height - 4, 400, floor_y + height + 8, wall.get("top_plate"))
    leader(c, stud_x + 2, floor_y + height * 0.72, 400, floor_y + height * 0.78, f"{wall.get('insulation')} (TYP.)")
    leader(c, gyp_x + 1, floor_y + height * 0.62, 400, floor_y + height * 0.64, wall.get("gypsum"))
    leader(c, ext_x + 1, floor_y + height * 0.55, 36, floor_y + height * 0.58, wall.get("siding"), align="right")
    leader(c, ext_x + siding + 0.5, floor_y + height * 0.48, 36, floor_y + height * 0.50, "BUILDING WRAP", align="right")
    leader(c, ext_x + siding + wrap + 0.4, floor_y + height * 0.40, 36, floor_y + height * 0.42, wall.get("sheathing"), align="right")
    leader(c, stud_x + stud_w / 2, win_y + oh + header_d / 2, 400, win_y + oh + header_d + 14, (opening.get("header") or {}).get("label") or "HEADER")
    leader(c, stud_x + 4, win_y + oh / 2, 400, win_y + 10, f'{(opening.get("type") or "WINDOW").upper()} {format_ft_in(opening.get("width_in"))} x {format_ft_in(opening.get("height_in"))}')
    leader(c, stud_x + 2, floor_y + 6, 400, floor_y - 6, wall.get("sill_plate"))
    leader(c, stud_x + stud_w / 2, floor_y - 8, 400, floor_y - 22, "1/2\" ANCHOR BOLT (TYP.)")
    leader(c, ext_x + 20, floor_y - slab - stem - foot_d / 2, 36, floor_y - slab - stem - foot_d - 4, "CONCRETE FOOTING (TYP.)", align="right")

    jacks = int(opening.get("jack_studs") or 2)
    kings = int(opening.get("king_studs") or 1)
    rows = [
        ["STUDS", wall.get("stud") or "2x6", wall.get("spacing") or '16" O.C.', "#2 SPF OR BETTER"],
        ["TOP PLATE", wall.get("top_plate") or "", "CONT.", "STAGGER SPLICES 4'-0\" MIN."],
        ["SILL PLATE", wall.get("sill_plate") or "", "CONT.", "PRESSURE TREATED"],
        ["HEADER", (opening.get("header") or {}).get("label") or "", "EACH OPENING", "PRELIMINARY — VERIFY"],
        ["JACK / KING", f"{jacks} JACK  /  {kings} KING EA. SIDE", "TYP.", "AT EACH JAMB"],
        ["SHEATHING", '7/16" OSB', "WALLS", "PANEL EDGES BLOCKED"],
    ]
    schedule_table(c, 28, 78, 300, rows, [70, 110, 55, 60], ["MEMBER", "SIZE", "SPACING", "NOTES"])
    notes_block(c, 338, 78, 248, 118, "WALL SECTION NOTES", [
        f"Wall height {wall.get('height')} is taken from this floor plan.",
        f"Primary opening is a {(opening.get('type') or 'window')} from the plan" if opening.get("source") == "project" else "Opening shown is a typical residential window for this wall height.",
        f"{wall.get('insulation')} in {wall.get('stud')} cavity. Vapor retarder per energy code.",
        "Provide weep screed and flashing at base of siding. Tape all wrap seams.",
        wall.get("anchor") or "",
        "Header and LVL sizes are conservative / preliminary. Engineer as required.",
    ])


def draw_foundation(c, model):
    scale = '1" = 1\'-0"'
    new_page(c, model, "S-101", "CONCRETE SLAB / FOOTING DETAIL", scale)
    fnd = model.get("foundation") or {}
    wall = model.get("wall") or {}
    s = 1.0
    def u(v):
        return _scale(v, s)

    slab = u(fnd.get("slab_in") or 4)
    agg = u(fnd.get("aggregate_in") or 4)
    foot_w = u(fnd.get("footing_w_in") or 16)
    foot_d = u(fnd.get("footing_d_in") or 24)
    stem = u(min(fnd.get("stem_in") or 0, 16))
    origin_x = 160
    grade_y = 320

    # soil
    box(c, 70, grade_y - foot_d - 30, 420, foot_d + 40, fill=SOIL, weight=0.2)
    hatch_diag(c, 70, grade_y - foot_d - 30, 420, foot_d + 40, 9, MUTED, 0.2)

    # footing
    foot_x = origin_x
    foot_y = grade_y - foot_d
    box(c, foot_x, foot_y, foot_w, foot_d + stem, fill=CONCRETE, weight=1.1)
    stipple(c, foot_x, foot_y, foot_w, foot_d + stem, 5)

    # slab
    if (fnd.get("slab_in") or 0) > 0:
        box(c, foot_x + foot_w - 8, grade_y, 260, slab, fill=CONCRETE, weight=0.9)
        stipple(c, foot_x + foot_w - 8, grade_y, 260, slab, 5)
        c.setStrokeColor(INK)
        c.setDash(3, 2)
        c.setLineWidth(0.8)
        c.line(foot_x + 8, grade_y + 1.5, foot_x + foot_w + 250, grade_y + 1.5)
        c.setDash()
        box(c, foot_x + foot_w - 4, grade_y - agg, 250, agg, fill=FILL, weight=0.5)
        c.setFillColor(MUTED)
        for i in range(18):
            c.circle(foot_x + foot_w + 8 + i * 12, grade_y - agg / 2, 2.2, fill=0, stroke=1)

    # rebar
    c.setFillColor(INK)
    c.circle(foot_x + 14, foot_y + foot_d - 16, 3.2, fill=1, stroke=0)
    c.circle(foot_x + foot_w - 14, foot_y + foot_d - 16, 3.2, fill=1, stroke=0)
    c.circle(foot_x + 14, foot_y + 16, 3.2, fill=1, stroke=0)
    c.circle(foot_x + foot_w - 14, foot_y + 16, 3.2, fill=1, stroke=0)
    c.setStrokeColor(INK)
    c.setLineWidth(0.9)
    c.line(foot_x + 14, foot_y + 16, foot_x + 14, foot_y + foot_d - 16)
    c.line(foot_x + foot_w - 14, foot_y + 16, foot_x + foot_w - 14, foot_y + foot_d - 16)

    # sill + stud
    plate_h = u(1.5)
    box(c, foot_x + 10, grade_y + stem + slab, u(5.5), plate_h, fill=WOOD, weight=0.8)
    box(c, foot_x + 10, grade_y + stem + slab + plate_h, u(5.5), u(16), fill=WOOD, weight=0.7)
    c.setLineWidth(1.0)
    c.line(foot_x + 10 + u(2.75), grade_y + stem + slab + plate_h + 4, foot_x + 10 + u(2.75), grade_y + stem + slab - u(7))
    c.setFont("Helvetica", 5.5)
    c.drawCentredString(foot_x + 10 + u(2.75), grade_y + stem + slab + plate_h + 2, "BOLT")

    # grade slope
    c.setStrokeColor(INK)
    c.setLineWidth(0.8)
    c.line(70, grade_y + 10, foot_x, grade_y + 2)
    c.setFont("Helvetica", 6)
    c.drawString(78, grade_y + 14, "FINISHED GRADE SLOPE AWAY 5% MIN.")

    dim_v(c, foot_x - 22, foot_y, foot_y + foot_d, f'{int(fnd.get("footing_d_in") or 24)}" DEEP')
    dim_h(c, foot_y - 16, foot_x, foot_x + foot_w, f'{int(fnd.get("footing_w_in") or 16)}" WIDE')
    if (fnd.get("slab_in") or 0) > 0:
        dim_v(c, foot_x + foot_w + 270, grade_y, grade_y + slab, f'{int(fnd.get("slab_in") or 4)}" SLAB')
        dim_v(c, foot_x + foot_w + 270, grade_y - agg, grade_y, f'{int(fnd.get("aggregate_in") or 4)}" AGG.')

    leader(c, foot_x + 14, foot_y + foot_d - 16, 400, grade_y + 70, fnd.get("rebar_top") or "#4 TOP")
    leader(c, foot_x + 14, foot_y + 16, 400, grade_y - 50, fnd.get("rebar_bot") or "#4 BOTTOM")
    leader(c, foot_x + 14, foot_y + foot_d / 2, 400, grade_y + 40, fnd.get("dowels") or "VERTICAL DOWELS")
    leader(c, foot_x + 16, grade_y + stem + slab + 2, 400, grade_y + 90, wall.get("sill_plate") or "PT SILL PLATE")
    leader(c, foot_x + 18, grade_y + 2, 400, grade_y + 110, f'{int(fnd.get("vapor_mil") or 6)} MIL VAPOR BARRIER')
    leader(c, foot_x + foot_w + 40, grade_y - agg / 2, 400, grade_y - 70, "COMPACTED AGGREGATE BASE")

    # enlarged rebar
    c.setStrokeColor(INK)
    c.setLineWidth(0.8)
    c.circle(470, 430, 52, fill=0, stroke=1)
    c.setFont("Helvetica-Bold", 6)
    c.drawCentredString(470, 490, "FOOTING REINFORCING (ENLARGED)")
    c.setFillColor(CONCRETE)
    c.rect(448, 408, 44, 44, fill=1, stroke=1)
    c.setFillColor(INK)
    c.circle(456, 440, 3, fill=1, stroke=0)
    c.circle(484, 440, 3, fill=1, stroke=0)
    c.circle(456, 416, 3, fill=1, stroke=0)
    c.circle(484, 416, 3, fill=1, stroke=0)
    c.setFont("Helvetica", 5.5)
    c.drawString(430, 398, '3" MIN. CONCRETE COVER')

    rows = [
        ["SLAB", f'{int(fnd.get("slab_in") or 0)}"' if fnd.get("slab_in") else "N/A", "PROJECT / TYP."],
        ["AGGREGATE", f'{int(fnd.get("aggregate_in") or 4)}" MIN.', "TYPICAL"],
        ["VAPOR BARRIER", f'{int(fnd.get("vapor_mil") or 6)} MIL POLY', "TYPICAL"],
        ["FOOTING", f'{int(fnd.get("footing_w_in") or 16)}" W x {int(fnd.get("footing_d_in") or 24)}" D', "TYP. C. KY"],
        ["CONCRETE", f"f'c = {int(fnd.get('concrete_psi') or 3000)} PSI MIN.", "TYPICAL"],
        ["ANCHOR BOLTS", "1/2\" @ 6'-0\" O.C. MAX.", "IRC / KY"],
    ]
    schedule_table(c, 28, 78, 280, rows, [90, 100, 80], ["ITEM", "SIZE", "SOURCE"])
    notes_block(c, 318, 78, 268, 118, "FOUNDATION NOTES — CENTRAL KENTUCKY", [
        f"Typical residential {fnd.get('label', 'slab').lower()} detail for Central Kentucky.",
        "Lexington / Central Kentucky residential work generally follows the 2018 Kentucky Residential Code.",
        f"Exterior footing shown as {int(fnd.get('footing_w_in') or 16)}\" x {int(fnd.get('footing_d_in') or 24)}\" deep; verify bearing and frost with the jurisdiction.",
        f"Concrete min. {int(fnd.get('concrete_psi') or 3000)} PSI. Use air-entrained concrete where freeze-thaw exposure requires it.",
        "Provide 6 mil poly vapor barrier over min. 4\" compacted aggregate. Lap seams 6\" min.",
        "Verify local frost depth, soil conditions, and all site-specific requirements prior to construction.",
    ])


def draw_roof(c, model):
    scale = '3/8" = 1\'-0"'
    new_page(c, model, "A-301", "WALL / CEILING / GABLE ROOF FRAMING DETAIL", scale)
    wall = model.get("wall") or {}
    roof = model.get("roof") or {}
    fnd = model.get("foundation") or {}
    s = 0.375
    def u(v):
        return _scale(v, s)

    span = u(roof.get("span_in") or 144)
    rise = u(roof.get("rise_in") or 36)
    height = u(wall.get("height_in") or 96)
    over = u(roof.get("overhang_in") or 12)
    stud_w = u(5.5 if wall.get("stud") == "2x6" else 3.5)
    origin_x = 90
    floor_y = 200
    left = origin_x
    right = origin_x + span
    ridge_x = (left + right) / 2.0
    plate_y = floor_y + height
    ridge_y = plate_y + rise

    # walls
    box(c, left, floor_y, stud_w, height, fill=WOOD, weight=0.8)
    batt(c, left + 1, floor_y + 4, stud_w - 2, height - 8)
    box(c, right - stud_w, floor_y, stud_w, height, fill=WOOD, weight=0.8)
    batt(c, right - stud_w + 1, floor_y + 4, stud_w - 2, height - 8)
    box(c, left, plate_y - u(3), stud_w, u(3), fill=WOOD, weight=0.7)
    box(c, right - stud_w, plate_y - u(3), stud_w, u(3), fill=WOOD, weight=0.7)

    # footing ticks
    box(c, left - 6, floor_y - u(12), stud_w + 12, u(12), fill=CONCRETE, weight=0.6)
    box(c, right - stud_w - 6, floor_y - u(12), stud_w + 12, u(12), fill=CONCRETE, weight=0.6)
    stipple(c, left - 6, floor_y - u(12), stud_w + 12, u(12), 5)

    # ceiling joist
    c.setStrokeColor(INK)
    c.setLineWidth(2.2)
    c.line(left, plate_y, right, plate_y)
    # rafters
    c.setLineWidth(2.0)
    c.line(left - over, plate_y - 4, ridge_x, ridge_y)
    c.line(right + over, plate_y - 4, ridge_x, ridge_y)
    # ridge
    c.setLineWidth(2.4)
    c.line(ridge_x, ridge_y - 6, ridge_x, ridge_y + 8)
    # collar
    collar_y = plate_y + rise * 0.62
    c.setLineWidth(1.4)
    c.line(ridge_x - span * 0.18, collar_y, ridge_x + span * 0.18, collar_y)
    # sheathing
    c.setLineWidth(0.7)
    c.line(left - over - 3, plate_y - 1, ridge_x, ridge_y + 6)
    c.line(right + over + 3, plate_y - 1, ridge_x, ridge_y + 6)
    # soffit
    c.setLineWidth(0.6)
    c.line(left - over, plate_y - 4, left - over, plate_y - 10)
    c.line(left - over, plate_y - 10, left, plate_y - 10)
    c.line(right + over, plate_y - 4, right + over, plate_y - 10)
    c.line(right + over, plate_y - 10, right, plate_y - 10)

    # pitch triangle
    tx, ty = ridge_x + 28, plate_y + 10
    c.setLineWidth(0.6)
    c.line(tx, ty, tx + 28, ty)
    c.line(tx + 28, ty, tx + 28, ty + 14)
    c.line(tx, ty, tx + 28, ty + 14)
    c.setFont("Helvetica", 6)
    c.drawString(tx + 30, ty + 6, f"{roof.get('pitch')} PITCH")

    dim_h(c, floor_y - 22, left, right, f"{roof.get('span')} ROOM WIDTH")
    dim_v(c, left - 24, floor_y, plate_y, wall.get("height") or "8'-0\"")
    dim_v(c, right + 26, floor_y, ridge_y, f"RIDGE {roof.get('ridge')}")
    dim_h(c, plate_y - 16, left - over, left, f'{int(roof.get("overhang_in") or 12)}" OH')

    leader(c, ridge_x, ridge_y, 430, ridge_y + 8, roof.get("ridge_board") or "RIDGE BOARD")
    leader(c, ridge_x - span * 0.22, (plate_y + ridge_y) / 2, 430, (plate_y + ridge_y) / 2 + 6, roof.get("rafter"))
    leader(c, ridge_x, collar_y, 430, collar_y - 12, roof.get("collar"))
    leader(c, left + span * 0.35, plate_y, 430, plate_y - 18, roof.get("ceiling_joist"))
    leader(c, left - over + 4, plate_y - 8, 36, plate_y - 28, "VENTED SOFFIT (CONT.)", align="right")
    leader(c, left + 2, plate_y - 2, 36, plate_y + 16, "BIRDSMOUTH SEAT CUT", align="right")
    leader(c, left + stud_w / 2, floor_y + height * 0.4, 36, floor_y + height * 0.5, f"{wall.get('stud')} STUD WALL @ 16\" O.C.", align="right")

    rows = [
        ["RAFTERS", roof.get("rafter") or "", roof.get("pitch") or "", "#2 SPF OR BETTER"],
        ["CEILING JOISTS", roof.get("ceiling_joist") or "", '16" O.C.', "RAFTER TIES"],
        ["COLLAR TIES", "2x6", '48" O.C.', "UPPER THIRD"],
        ["WALL STUDS", wall.get("stud") or "2x6", '16" O.C.', "#2 SPF OR BETTER"],
        ["TOP PLATES", wall.get("top_plate") or "", "CONT.", "DOUBLE"],
        ["SHEATHING", roof.get("sheathing") or '7/16" OSB', "ROOF / WALL", "TYPICAL"],
    ]
    schedule_table(c, 28, 78, 310, rows, [80, 100, 50, 70], ["MEMBER", "SIZE", "SPACING", "NOTES"])
    notes_block(c, 348, 78, 238, 118, "ROOF FRAMING NOTES", [
        f"Typical residential {(roof.get('kind') or 'gable')} roof for Central Kentucky.",
        f"Pitch {roof.get('pitch')} and span {roof.get('span')} are taken from this floor plan." if roof.get("source") == "project" else f"Typical {roof.get('pitch')} gable shown over the largest room span. Confirm roof geometry on site.",
        "Rafter and joist sizes are conservative defaults. Verify spans, species, and snow load with the jurisdiction.",
        "Provide approved uplift connectors / hurricane ties at each rafter-to-plate bearing.",
        "Weather-resistive barrier, underlayment, and flashing per manufacturer and code.",
        "Contractor to verify all field dimensions before construction.",
    ])


def draw_beam(c, model):
    scale = '3/4" = 1\'-0"'
    new_page(c, model, "S-201", "BEAM / HEADER DETAIL", scale)
    beams = list(model.get("beams") or [])
    beam = beams[0] if beams else {
        "label": 'DOUBLE 11.25" 2.0E LVL (PRELIMINARY)',
        "span_in": 96,
        "span": "8'-0\"",
        "plies": 2,
        "depth_in": 11.25,
        "jack_studs": 2,
        "king_studs": 1,
        "above": "bedroom",
        "engineer_required": True,
        "loads": {},
        "source": "typical",
    }
    wall = model.get("wall") or {}
    s = 0.75
    def u(v):
        return _scale(v, s)

    span = u(min(beam.get("span_in") or 96, 192))
    depth = u(beam.get("depth_in") or 11.25)
    height = u(min(wall.get("height_in") or 96, 108))
    stud = u(3.5)
    origin_x = 90
    floor_y = 190
    left = origin_x
    right = origin_x + span
    jacks = int(beam.get("jack_studs") or 2)
    kings = int(beam.get("king_studs") or 1)

    # king / jack packs
    pack = stud * (jacks + kings)
    box(c, left - pack, floor_y, pack, height, fill=WOOD, weight=0.9)
    box(c, right, floor_y, pack, height, fill=WOOD, weight=0.9)
    c.setStrokeColor(INK)
    c.setLineWidth(0.4)
    for i in range(jacks + kings):
        c.line(left - pack + (i + 1) * stud, floor_y, left - pack + (i + 1) * stud, floor_y + height)
        c.line(right + i * stud, floor_y, right + i * stud, floor_y + height)

    # opening
    box(c, left, floor_y, span, height - depth - u(3), fill=white, weight=0.5)
    # beam
    box(c, left - 4, floor_y + height - depth, span + 8, depth, fill=WOOD, weight=1.2)
    hatch_diag(c, left - 4, floor_y + height - depth, span + 8, depth, 5, INK, 0.4)
    # plates
    box(c, left - pack, floor_y + height - u(3), span + pack * 2, u(3), fill=WOOD, weight=0.7)

    dim_h(c, floor_y - 18, left, right, f"CLEAR SPAN {beam.get('span')}")
    dim_v(c, left - pack - 20, floor_y + height - depth, floor_y + height, format_ft_in(beam.get("depth_in")))
    dim_v(c, right + pack + 18, floor_y, floor_y + height, wall.get("height") or "8'-0\"")

    leader(c, left + span / 2, floor_y + height - depth / 2, 430, floor_y + height + 10, beam.get("label") or "LVL")
    leader(c, left - pack + stud / 2, floor_y + height * 0.45, 36, floor_y + height * 0.55, f"{kings} KING + {jacks} JACK STUDS", align="right")
    leader(c, right + pack - stud / 2, floor_y + height * 0.45, 430, floor_y + height * 0.35, "BEARING ON JACK STUDS (TYP.)")
    loads = beam.get("loads") or {}
    if loads.get("w_plf"):
        leader(c, left + span / 2, floor_y + height + 4, 430, floor_y + height + 28, f"PRELIM. w = {loads.get('w_plf')} PLF")

    rows = []
    for item in (beams or [beam])[:6]:
        rows.append([
            item.get("level") or "—",
            item.get("label") or "LVL",
            item.get("span") or "",
            f"{item.get('jack_studs')} / {item.get('king_studs')}",
            "ENGINEER" if item.get("engineer_required") else item.get("source", "").upper(),
        ])
    schedule_table(c, 28, 78, 360, rows, [70, 130, 55, 45, 50], ["LEVEL", "BEAM / HEADER", "SPAN", "J/K", "NOTE"])
    notes_block(c, 398, 78, 188, 118, "LOAD / DESIGN NOTES", [
        f"Above condition: {(beam.get('above') or 'bedroom').replace('_', ' ')}.",
        "LVL size is preliminary from Floor Plan Studio span/tributary math or a conservative header table.",
        "Do not cut, notch, or bore LVL except as allowed by the manufacturer.",
        "Provide full bearing on jack studs. King studs each side of opening.",
        "Licensed engineer shall verify all load-bearing removals and headers over 6'-0\".",
        "Building official may require stamped calculations before permit issuance.",
    ])


def build_permit_report(plan: dict, client: dict | None = None, company: dict | None = None, sheets: dict | None = None) -> bytes:
    model = extract_permit_model(plan, client, company)
    wanted = dict(model.get("sheets") or {})
    for key, value in (sheets or {}).items():
        if key in ("cover", "wall", "foundation", "roof", "beam"):
            wanted[key] = bool(value)
    if not any(wanted.get(k) for k in ("cover", "wall", "foundation", "roof", "beam")):
        wanted["cover"] = True
        wanted["wall"] = True
        wanted["foundation"] = True

    buf = BytesIO()
    c = pdfcanvas.Canvas(buf, pagesize=letter)
    project = model.get("project") or {}
    c.setTitle(f"{project.get('client_name') or 'Project'} Permit Details")
    c.setAuthor(project.get("company_name") or "Revival Home Remodeling")
    first = True

    def add(fn):
        nonlocal first
        if not first:
            c.showPage()
        first = False
        fn(c, model)

    try:
        if wanted.get("cover", True):
            add(draw_cover)
        if wanted.get("wall", True):
            add(draw_wall_section)
        if wanted.get("foundation", True):
            add(draw_foundation)
        if wanted.get("roof"):
            add(draw_roof)
        if wanted.get("beam"):
            add(draw_beam)
        c.save()
        return buf.getvalue()
    except Exception:
        logger.exception("Permit detail PDF failed")
        raise
