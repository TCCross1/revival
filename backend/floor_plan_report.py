"""Branded client proposal PDF for Floor Plan Studio."""
from __future__ import annotations

import base64
import logging
from io import BytesIO

from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, Spacer, Table, TableStyle, Image, PageBreak, KeepTogether
from reportlab.lib import colors

from email_pdf import (
    CREAM, DARK, GOLD, GREY, TEAL, WHITE, LINE,
    _fmt_date, _logo_image, _render, _styles, _xml,
)
from floor_plan import format_ft_in
from floor_plan_scope import build_scope

logger = logging.getLogger(__name__)

DISCLAIMER = (
    "This proposal is a design and planning document for discussion. "
    "Structural sizes, LVL headers, and load-bearing changes are preliminary and must be "
    "verified by a licensed professional engineer and the local building official before construction."
)


def _section(styles, title):
    bar = Table([[Paragraph(_xml(title), styles["section"])]], colWidths=[7.34 * inch])
    bar.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), TEAL),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return bar


def _table(styles, headers, rows, col_widths=None):
    data = [[Paragraph(_xml(h), styles["th"]) for h in headers]]
    for row in rows:
        data.append([Paragraph(_xml(c), styles["td"]) for c in row])
    if not rows:
        data.append([Paragraph("None noted on this plan.", styles["note"])] + [""] * (len(headers) - 1))
    tbl = Table(data, colWidths=col_widths or [7.34 * inch / len(headers)] * len(headers), repeatRows=1)
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), TEAL),
        ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
        ("BACKGROUND", (0, 1), (-1, -1), WHITE),
        ("GRID", (0, 0), (-1, -1), 0.4, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]
    for i in range(1, len(data)):
        if i % 2 == 0:
            style.append(("BACKGROUND", (0, i), (-1, i), CREAM))
    tbl.setStyle(TableStyle(style))
    return tbl


def _image_from_b64(raw, width=7.2 * inch, height=4.4 * inch):
    if not raw:
        return None
    try:
        text = str(raw)
        if "," in text and text.strip().startswith("data:"):
            text = text.split(",", 1)[1]
        blob = base64.b64decode(text)
        img = Image(BytesIO(blob), width=width, height=height, kind="proportional")
        return img
    except Exception:
        logger.exception("Could not embed a floor-plan snapshot in the client report")
        return None


def build_client_report(plan: dict, client: dict | None, company: dict | None, snapshots: dict | None = None) -> bytes:
    styles = _styles()
    snapshots = snapshots or {}
    document = plan.get("document") or {}
    scope = build_scope(document)
    take = scope.get("takeoffs") or {}
    totals = take.get("totals") or {}
    client = client or {}
    name = plan.get("client_name") or client.get("name") or "Homeowner"
    address = plan.get("address") or client.get("address") or "—"
    project = plan.get("project_type") or "Remodel"
    date = _fmt_date(plan.get("updated_at") or plan.get("created_at"))
    logo = _logo_image()

    cover_meta = Table([
        [Paragraph("PREPARED FOR", styles["tot_label"]), Paragraph(_xml(name), styles["meta_b"])],
        [Paragraph("PROJECT ADDRESS", styles["tot_label"]), Paragraph(_xml(address), styles["td"])],
        [Paragraph("PROJECT TYPE", styles["tot_label"]), Paragraph(_xml(project), styles["td"])],
        [Paragraph("DATE", styles["tot_label"]), Paragraph(_xml(date), styles["td"])],
        [Paragraph("VERSION", styles["tot_label"]), Paragraph(_xml((plan.get("version_kind") or "existing").title()), styles["td"])],
    ], colWidths=[1.8 * inch, 5.4 * inch])
    cover_meta.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), WHITE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("LINEBELOW", (0, 0), (-1, -2), 0.4, LINE),
    ]))

    elems = [
        logo if logo else Paragraph("REVIVAL HOME REMODELING", styles["brand_fallback"]),
        Spacer(1, 10),
        Paragraph("Design Proposal", styles["thanks"]),
        Paragraph(_xml(plan.get("name") or "Floor Plan Studio"), styles["meta_b"]),
        Spacer(1, 8),
        Paragraph(
            "A clear look at the existing home, the proposed remodel, and the materials we will use — "
            "prepared so you can review it on your phone or at the kitchen table.",
            styles["note"],
        ),
        Spacer(1, 16),
        cover_meta,
        Spacer(1, 18),
        Paragraph(
            f"Living area on plan: <b>{totals.get('floor_sf') or 0:.0f} SF</b> across "
            f"<b>{int(totals.get('level_count') or 1)}</b> level(s).",
            styles["td"],
        ),
        PageBreak(),
    ]

    before = _image_from_b64(snapshots.get("before"))
    after = _image_from_b64(snapshots.get("after"))
    if before or after:
        elems += [_section(styles, "Before & proposed"), Spacer(1, 8)]
        pair = []
        if before:
            pair.append([Paragraph("EXISTING", styles["tot_label"]), before])
        if after:
            pair.append([Paragraph("PROPOSED", styles["tot_label"]), after])
        if len(pair) == 2:
            elems.append(Table([
                [pair[0][0], pair[1][0]],
                [pair[0][1], pair[1][1]],
            ], colWidths=[3.6 * inch, 3.6 * inch]))
        else:
            elems += [pair[0][0], Spacer(1, 4), pair[0][1]]
        elems.append(PageBreak())

    for level in document.get("levels") or []:
        lid = level.get("id")
        snap = (snapshots.get("levels") or {}).get(lid) or {}
        elems += [_section(styles, f"Floor plan · {level.get('name') or 'Level'}"), Spacer(1, 8)]
        img = _image_from_b64(snap.get("png_2d"))
        if img:
            elems += [img, Spacer(1, 8)]
        else:
            elems.append(Paragraph("Open Floor Plan Studio and generate the report again to embed this level’s drawing.", styles["note_i"]))
        img3 = _image_from_b64(snap.get("png_3d"), width=7.2 * inch, height=3.6 * inch)
        if img3:
            elems += [Paragraph("3D view", styles["tot_label"]), Spacer(1, 4), img3]
        elems.append(PageBreak())

    beams = []
    for level in document.get("levels") or []:
        for beam in level.get("beams") or []:
            beams.append([
                level.get("name") or "Level",
                beam.get("label") or "LVL",
                format_ft_in(beam.get("span_in")),
                f"{beam.get('plies')} ply · {beam.get('depth_in')}\"",
                f"{beam.get('jack_studs')} jack / {beam.get('king_studs')} king",
                (beam.get("above") or "").title(),
            ])
    elems += [
        _section(styles, "Structural details"),
        Spacer(1, 8),
        Paragraph(DISCLAIMER, styles["note_i"]),
        Spacer(1, 8),
        _table(styles, ["Level", "Beam", "Span", "Size", "Studs", "Above"], beams, [1.1 * inch, 1.7 * inch, 0.9 * inch, 1.2 * inch, 1.3 * inch, 1.14 * inch]),
        PageBreak(),
        _section(styles, "Cabinet schedule"),
        Spacer(1, 8),
        _table(styles, ["Cabinet", "Size", "Location", "Finish"], [[c.get("name"), c.get("size"), c.get("location"), c.get("finish")] for c in scope.get("cabinets") or []], [2.1 * inch, 1.5 * inch, 2.0 * inch, 1.74 * inch]),
        Spacer(1, 14),
        _section(styles, "Appliance schedule"),
        Spacer(1, 8),
        _table(styles, ["Appliance", "Size", "Location", "Notes"], [[a.get("name"), a.get("size"), a.get("location"), a.get("note")] for a in scope.get("appliances") or []], [2.0 * inch, 1.4 * inch, 1.8 * inch, 2.14 * inch]),
        PageBreak(),
        _section(styles, "Door schedule"),
        Spacer(1, 8),
        _table(styles, ["Type", "Size", "Swing", "Style", "Level"], [[d.get("type"), d.get("size"), d.get("swing"), d.get("style"), d.get("level")] for d in scope.get("doors") or []], [1.2 * inch, 1.6 * inch, 1.4 * inch, 1.5 * inch, 1.64 * inch]),
        Spacer(1, 14),
        _section(styles, "Window schedule"),
        Spacer(1, 8),
        _table(styles, ["Style", "Size", "Level"], [[w.get("style"), w.get("size"), w.get("level")] for w in scope.get("windows") or []], [2.4 * inch, 2.4 * inch, 2.54 * inch]),
        PageBreak(),
        _section(styles, "Lighting schedule"),
        Spacer(1, 8),
        _table(styles, ["Fixture", "Location", "Notes"], [[L.get("name"), L.get("location"), L.get("note")] for L in scope.get("lighting") or []], [2.4 * inch, 2.2 * inch, 2.74 * inch]),
        Spacer(1, 14),
        _section(styles, "Finish schedule"),
        Spacer(1, 8),
        _table(styles, ["Location", "Item", "Finish"], [[f.get("location"), f.get("item"), f.get("finish")] for f in scope.get("finishes") or []], [2.8 * inch, 2.0 * inch, 2.54 * inch]),
        PageBreak(),
        _section(styles, "Typical wall section"),
        Spacer(1, 8),
        Paragraph(
            "New interior partitions: 2x4 studs at 16\" O.C., 1/2\" drywall each side, paint or finish as scheduled. "
            "Plumbing walls are 2x6 as hatched on the plan. Exterior work matches the existing assembly unless noted. "
            "Headers and LVL sizes are shown on the structural page and must be confirmed by a licensed engineer.",
            styles["td"],
        ),
        Spacer(1, 10),
        Paragraph(
            "Load-bearing walls marked for demolition are shown in red. Do not remove them until the LVL (or other "
            "approved header) and jack/king studs are in place and the engineer’s drawing is on site.",
            styles["note"],
        ),
        PageBreak(),
        _section(styles, "Special-order items & packages"),
        Spacer(1, 8),
        Paragraph("These items typically have long lead times. We will confirm selections before we order.", styles["note"]),
        Spacer(1, 8),
        _table(
            styles,
            ["Item", "Qty", "Unit"],
            [[i.get("description"), f"{i.get('quantity') or 0:.1f}", i.get("unit") or ""] for i in scope.get("special_order") or []],
            [5.4 * inch, 0.9 * inch, 1.04 * inch],
        ),
        PageBreak(),
        _section(styles, "Materials & preliminary quantities"),
        Spacer(1, 8),
        Paragraph("These counts come directly from the plan. They are a starting point for the estimate — not a final order.", styles["note"]),
        Spacer(1, 8),
        _table(
            styles,
            ["Item", "Qty", "Unit"],
            [[i.get("description"), f"{i.get('quantity') or 0:.1f}", i.get("unit") or ""] for i in scope.get("line_items") or []],
            [5.4 * inch, 0.9 * inch, 1.04 * inch],
        ),
        Spacer(1, 12),
        Paragraph(
            f"Floor {totals.get('floor_sf') or 0:.0f} SF · Walls {totals.get('wall_sf') or 0:.0f} SF · "
            f"Roof {totals.get('roof_sf') or 0:.0f} SF · LVL {totals.get('lvl_lf') or 0:.1f} LF · "
            f"Plumbing walls {totals.get('plumbing_wall_lf') or 0:.1f} LF",
            styles["td"],
        ),
        PageBreak(),
        _section(styles, "Notes & client selections"),
        Spacer(1, 8),
    ]
    if document.get("client_notes"):
        elems += [Paragraph(_xml(document.get("client_notes")), styles["td"]), Spacer(1, 8)]
    note_rows = [[n.get("target"), n.get("level"), n.get("text")] for n in scope.get("notes") or []]
    elems.append(_table(styles, ["Item", "Location", "Note"], note_rows, [1.8 * inch, 1.6 * inch, 3.94 * inch]))
    elems += [
        Spacer(1, 12),
        _section(styles, "Special conditions"),
        Spacer(1, 8),
        Paragraph(_xml(document.get("special_conditions") or "None recorded. Selections may change after material samples are approved."), styles["td"]),
        Spacer(1, 16),
        Paragraph(DISCLAIMER, styles["note_i"]),
        Spacer(1, 14),
        _section(styles, "Next steps"),
        Spacer(1, 8),
        Paragraph("1. Review this proposal together — finishes, appliances, and any notes on the plan.", styles["td"]),
        Paragraph("2. We price the quantities in a formal estimate. Special-order items are confirmed before we buy.", styles["td"]),
        Paragraph("3. A licensed professional verifies structural sizes before any load-bearing wall is opened.", styles["td"]),
        Paragraph("4. When you are ready, we attach this proposal to the estimate or contract and schedule the work.", styles["td"]),
        Spacer(1, 16),
        Paragraph("Revival Home Remodeling  ·  revivalhr.com  ·  859-227-0340", styles["thanks"]),
    ]
    try:
        return _render(elems, company or {}, f"{name} Design Proposal")
    except Exception:
        logger.exception("Client report PDF failed plan_id=%s", plan.get("id"))
        raise
