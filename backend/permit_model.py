"""Extract permit-ready facts from a floor plan using Central Kentucky defaults.

Values that come from the plan are marked project-specific. Conservative
IRC / 2018 Kentucky Residential Code defaults are marked typical.
This module never logs addresses or client names.
"""
from __future__ import annotations

from datetime import datetime, timezone

from floor_plan import (
    DEFAULT_WALL_HEIGHT,
    inches,
    format_ft_in,
    wall_length,
)

CODE_LABEL = "2018 Kentucky Residential Code (2015 IRC with KY amendments)"
JURISDICTION = "Central Kentucky"
DISCLAIMER = (
    "THESE DETAILS ARE TYPICAL AND PROJECT-SPECIFIC PLANNING DOCUMENTS FOR PERMIT REVIEW. "
    "CONTRACTOR SHALL VERIFY ALL DIMENSIONS AND CONDITIONS IN THE FIELD. "
    "FINAL STRUCTURAL DESIGN, LVL / BEAM SIZING, AND LOAD-BEARING CHANGES SHALL BE "
    "VERIFIED BY A LICENSED PROFESSIONAL ENGINEER AND THE LOCAL BUILDING OFFICIAL "
    "BEFORE CONSTRUCTION. REVIVAL PRO DOES NOT REPLACE STAMPED ENGINEERING."
)

FOUNDATION_DEFAULTS = {
    "slab": {
        "label": "SLAB ON GRADE",
        "slab_in": 4.0,
        "stem_in": 0.0,
        "footing_w_in": 16.0,
        "footing_d_in": 24.0,
        "aggregate_in": 4.0,
        "vapor_mil": 6,
        "concrete_psi": 3000,
        "rebar_top": "#4 CONTINUOUS (TOP)",
        "rebar_bot": "#4 CONTINUOUS (BOTTOM)",
        "dowels": "#4 VERTICAL DOWELS @ 24\" O.C.",
    },
    "crawl": {
        "label": "CRAWL SPACE / STEM WALL",
        "slab_in": 0.0,
        "stem_in": 24.0,
        "footing_w_in": 16.0,
        "footing_d_in": 24.0,
        "aggregate_in": 4.0,
        "vapor_mil": 6,
        "concrete_psi": 3000,
        "rebar_top": "#4 CONTINUOUS (TOP)",
        "rebar_bot": "#4 CONTINUOUS (BOTTOM)",
        "dowels": "#4 VERTICAL DOWELS @ 24\" O.C.",
    },
    "basement": {
        "label": "FULL BASEMENT FOUNDATION WALL",
        "slab_in": 4.0,
        "stem_in": 96.0,
        "footing_w_in": 16.0,
        "footing_d_in": 24.0,
        "aggregate_in": 4.0,
        "vapor_mil": 6,
        "concrete_psi": 3000,
        "rebar_top": "#4 CONTINUOUS (TOP)",
        "rebar_bot": "#4 CONTINUOUS (BOTTOM)",
        "dowels": "#4 VERTICAL DOWELS @ 24\" O.C.",
    },
    "pier": {
        "label": "PIER AND BEAM (TYPICAL)",
        "slab_in": 0.0,
        "stem_in": 24.0,
        "footing_w_in": 24.0,
        "footing_d_in": 24.0,
        "aggregate_in": 4.0,
        "vapor_mil": 6,
        "concrete_psi": 3000,
        "rebar_top": "#4 CONTINUOUS (TOP)",
        "rebar_bot": "#4 CONTINUOUS (BOTTOM)",
        "dowels": "#4 VERTICAL DOWELS @ 24\" O.C.",
    },
}


def _now_date() -> str:
    return datetime.now(timezone.utc).strftime("%m/%d/%Y")


def typical_header(width_in: float, stud: str = "2x6") -> dict:
    width = max(inches(width_in), 24.0)
    if width <= 36:
        label = "2-2x6 HEADER (MIN.)" if stud == "2x4" else "2-2x8 HEADER (MIN.)"
        depth = 5.5 if stud == "2x4" else 7.25
        return {"label": label, "plies": 2, "depth_in": depth, "typical": True, "engineer_required": False}
    if width <= 48:
        label = "2-2x8 HEADER (MIN.)" if stud == "2x4" else "2-2x10 HEADER (MIN.)"
        depth = 7.25 if stud == "2x4" else 9.25
        return {"label": label, "plies": 2, "depth_in": depth, "typical": True, "engineer_required": False}
    if width <= 72:
        return {
            "label": 'DOUBLE 9.25" 2.0E LVL (PRELIMINARY)',
            "plies": 2,
            "depth_in": 9.25,
            "typical": False,
            "engineer_required": True,
        }
    return {
        "label": 'DOUBLE 11.25" 2.0E LVL (PRELIMINARY — ENGINEER VERIFY)',
        "plies": 2,
        "depth_in": 11.25,
        "typical": False,
        "engineer_required": True,
    }


def jack_studs_for(width_in: float, exterior: bool = True) -> int:
    ft = max(inches(width_in), 12.0) / 12.0
    jacks = 1
    if ft > 4:
        jacks = 2
    if ft > 8:
        jacks = 3
    if ft > 12:
        jacks = 4
    if exterior and ft > 6:
        jacks = max(jacks, 3)
    return min(jacks, 6)


def typical_rafter(span_in: float) -> str:
    half = max(inches(span_in), 96.0) / 2.0
    if half <= 120:
        return '2x8 RAFTERS @ 16" O.C.'
    if half <= 156:
        return '2x10 RAFTERS @ 16" O.C.'
    return '2x12 RAFTERS @ 16" O.C.'


def typical_ceiling_joist(span_in: float) -> str:
    span = max(inches(span_in), 96.0)
    if span <= 144:
        return '2x8 CEILING JOISTS @ 16" O.C.'
    if span <= 192:
        return '2x10 CEILING JOISTS @ 16" O.C.'
    return '2x12 CEILING JOISTS @ 16" O.C.'


def _stud_from_wall(wall: dict) -> str:
    thick = inches(wall.get("thickness") or 0)
    if wall.get("plumbing") or thick >= 5.5:
        return "2x6"
    if (wall.get("kind") or "exterior") == "exterior" and thick >= 5.0:
        return "2x6"
    return "2x4"


def _primary_opening(levels: list) -> dict | None:
    best = None
    best_score = -1
    for level in levels:
        for wall in level.get("walls") or []:
            exterior = (wall.get("kind") or "exterior") == "exterior"
            for opening in wall.get("openings") or []:
                width = inches(opening.get("width"))
                kind = (opening.get("type") or "window").lower()
                score = width
                if kind == "window":
                    score += 80
                elif kind == "door":
                    score += 30
                if exterior:
                    score += 10
                if score > best_score:
                    best_score = score
                    header = typical_header(width, _stud_from_wall(wall))
                    best = {
                        "type": kind,
                        "width_in": width,
                        "height_in": inches(opening.get("height") or (80 if kind != "window" else 48)),
                        "sill_in": inches(opening.get("sill") if kind == "window" else 0) or (24.0 if kind == "window" else 0.0),
                        "style": opening.get("style") or ("double-hung" if kind == "window" else "six-panel"),
                        "wall_kind": wall.get("kind") or "exterior",
                        "level_name": level.get("name") or "1st Floor",
                        "header": header,
                        "jack_studs": jack_studs_for(width, exterior),
                        "king_studs": 1,
                        "source": "project",
                    }
    return best


def _collect_openings(levels: list) -> list:
    rows = []
    for level in levels:
        for wall in level.get("walls") or []:
            for opening in wall.get("openings") or []:
                kind = (opening.get("type") or "opening").lower()
                width = inches(opening.get("width"))
                height = inches(opening.get("height"))
                rows.append({
                    "level": level.get("name") or "",
                    "type": kind,
                    "width_in": width,
                    "height_in": height,
                    "sill_in": inches(opening.get("sill") or 0),
                    "style": opening.get("style") or "",
                    "rough_opening": f'{format_ft_in(width + 2)} x {format_ft_in(height + 2)}',
                    "size": f"{format_ft_in(width)} x {format_ft_in(height)}",
                    "needs_beam": (kind == "cased" and width >= 48) or (kind == "door" and width >= 60),
                })
    return rows


def _collect_beams(levels: list) -> list:
    rows = []
    for level in levels:
        for beam in level.get("beams") or []:
            span = inches(beam.get("span_in"))
            if span <= 0:
                span = wall_length(beam) or 0
            rows.append({
                "level": level.get("name") or "",
                "label": beam.get("label") or "LVL",
                "span_in": span,
                "span": format_ft_in(span),
                "plies": int(beam.get("plies") or 2),
                "depth_in": inches(beam.get("depth_in") or 11.25),
                "jack_studs": int(beam.get("jack_studs") or jack_studs_for(span, True)),
                "king_studs": int(beam.get("king_studs") or 1),
                "above": beam.get("above") or "bedroom",
                "species": beam.get("species") or "2.0E LVL",
                "engineer_required": bool(beam.get("engineer_required")),
                "notes": beam.get("notes") or beam.get("disclaimer") or "",
                "loads": beam.get("loads") or {},
                "source": "project",
            })
    return rows


def _largest_span(levels: list, roof: dict) -> float:
    width = inches((roof or {}).get("width"))
    if width >= 72:
        return width
    best = 0.0
    for level in levels:
        for room in level.get("rooms") or []:
            best = max(best, inches(room.get("width")), inches(room.get("depth")))
        for wall in level.get("walls") or []:
            if (wall.get("kind") or "") == "exterior":
                best = max(best, wall_length(wall))
    return best or 144.0


def _wall_height(levels: list) -> float:
    heights = []
    for level in levels:
        for room in level.get("rooms") or []:
            heights.append(inches(room.get("wall_height") or room.get("ceiling_height") or DEFAULT_WALL_HEIGHT))
        for wall in level.get("walls") or []:
            heights.append(inches(wall.get("height") or DEFAULT_WALL_HEIGHT))
    return max(heights) if heights else DEFAULT_WALL_HEIGHT


def _primary_wall(levels: list) -> dict:
    for level in levels:
        for wall in level.get("walls") or []:
            if (wall.get("kind") or "exterior") == "exterior":
                return wall
        if level.get("walls"):
            return level["walls"][0]
    return {"kind": "exterior", "thickness": 6.0, "height": DEFAULT_WALL_HEIGHT}


def _primary_roof(levels: list) -> dict:
    for level in levels:
        roofs = level.get("roofs") or []
        if roofs:
            return roofs[0]
    return {}


def recommended_sheets(model: dict) -> dict:
    roof = model.get("roof") or {}
    beams = model.get("beams") or []
    openings = model.get("openings") or []
    project_type = (model.get("project") or {}).get("project_type") or ""
    roof_wanted = bool(roof.get("present")) or project_type in ("Addition", "Whole House", "Exterior")
    beam_wanted = bool(beams) or any(o.get("needs_beam") for o in openings)
    return {
        "cover": True,
        "wall": True,
        "foundation": True,
        "roof": roof_wanted,
        "beam": beam_wanted,
    }


def extract_permit_model(plan: dict, client: dict | None = None, company: dict | None = None) -> dict:
    plan = plan or {}
    client = client or {}
    company = company or {}
    document = plan.get("document") or {}
    levels = list(document.get("levels") or [])
    foundation_id = (document.get("foundation") or "slab").strip().lower()
    if foundation_id not in FOUNDATION_DEFAULTS:
        foundation_id = "slab"
    found = dict(FOUNDATION_DEFAULTS[foundation_id])
    found["type"] = foundation_id
    found["source"] = "typical"

    wall = _primary_wall(levels)
    stud = _stud_from_wall(wall)
    height_in = _wall_height(levels)
    opening = _primary_opening(levels) or {
        "type": "window",
        "width_in": 36.0,
        "height_in": 48.0,
        "sill_in": 24.0,
        "style": "double-hung",
        "wall_kind": "exterior",
        "level_name": (levels[0].get("name") if levels else "1st Floor") or "1st Floor",
        "header": typical_header(36.0, stud),
        "jack_studs": 2,
        "king_studs": 1,
        "source": "typical",
    }

    roof_raw = _primary_roof(levels)
    span_in = _largest_span(levels, roof_raw)
    pitch_rise = inches(roof_raw.get("pitch_rise") or 6)
    pitch_run = inches(roof_raw.get("pitch_run") or 12) or 12.0
    overhang = inches(roof_raw.get("overhang") or 12) or 12.0
    rise_in = (span_in / 2.0) * (pitch_rise / pitch_run)
    ridge_in = height_in + rise_in
    roof = {
        "present": bool(roof_raw),
        "kind": (roof_raw.get("kind") or "gable").lower(),
        "pitch_rise": pitch_rise,
        "pitch_run": pitch_run,
        "pitch": f"{int(pitch_rise) if pitch_rise == int(pitch_rise) else pitch_rise}/{int(pitch_run)}",
        "overhang_in": overhang,
        "span_in": span_in,
        "span": format_ft_in(span_in),
        "rise_in": rise_in,
        "ridge_in": ridge_in,
        "ridge": format_ft_in(ridge_in),
        "rafter": typical_rafter(span_in),
        "ceiling_joist": typical_ceiling_joist(span_in),
        "collar": '2x6 COLLAR TIES @ 48" O.C. (UPPER THIRD)',
        "ridge_board": "2x8 RIDGE BOARD" if span_in / 2 <= 120 else "2x10 RIDGE BOARD",
        "sheathing": '7/16" OSB OR PLYWOOD',
        "source": "project" if roof_raw else "typical",
    }

    beams = _collect_beams(levels)
    openings = _collect_openings(levels)
    if not beams:
        for row in openings:
            if row.get("needs_beam"):
                header = typical_header(row["width_in"], stud)
                beams.append({
                    "level": row.get("level") or "",
                    "label": header["label"],
                    "span_in": row["width_in"],
                    "span": format_ft_in(row["width_in"]),
                    "plies": header["plies"],
                    "depth_in": header["depth_in"],
                    "jack_studs": jack_studs_for(row["width_in"], True),
                    "king_studs": 1,
                    "above": "roof" if (wall.get("kind") or "exterior") == "exterior" else "bedroom",
                    "species": "2.0E LVL",
                    "engineer_required": header["engineer_required"],
                    "notes": "Synthesized from a wide opening on the plan. Verify with a licensed engineer.",
                    "loads": {},
                    "source": "derived",
                })

    insulation = "R-19 FIBERGLASS BATT" if stud == "2x6" else "R-13 FIBERGLASS BATT"
    model = {
        "project": {
            "plan_name": plan.get("name") or "Floor plan",
            "client_name": plan.get("client_name") or client.get("name") or "Homeowner",
            "address": plan.get("address") or client.get("address") or "Address to be confirmed",
            "project_type": plan.get("project_type") or "Remodel",
            "company_name": company.get("name") or "Revival Home Remodeling",
            "company_phone": company.get("phone") or "",
            "company_email": company.get("email") or "",
            "license": company.get("license") or "",
            "date": _now_date(),
            "code": CODE_LABEL,
            "jurisdiction": JURISDICTION,
            "version_kind": plan.get("version_kind") or "existing",
        },
        "wall": {
            "height_in": height_in,
            "height": format_ft_in(height_in),
            "stud": stud,
            "spacing": '16" O.C.',
            "thickness_in": inches(wall.get("thickness") or (6 if stud == "2x6" else 3.5)),
            "insulation": insulation,
            "sheathing": '7/16" OSB SHEATHING',
            "wrap": "BUILDING WRAP (WEATHER-RESISTIVE BARRIER)",
            "siding": "VINYL SIDING (HORIZONTAL)",
            "gypsum": '1/2" GYPSUM BOARD',
            "ceiling_gypsum": '5/8" GYPSUM BOARD',
            "top_plate": f"(2) {stud} TOP PLATE",
            "bottom_plate": f"{stud} BOTTOM PLATE",
            "sill_plate": f"{stud} PRESSURE-TREATED SILL PLATE",
            "anchor": '1/2" DIA. ANCHOR BOLTS @ 6\'-0" O.C. MAX., WITHIN 12" OF PLATE ENDS, 7" MIN. EMBEDMENT',
            "opening": opening,
            "source": "project",
        },
        "foundation": found,
        "roof": roof,
        "beams": beams,
        "openings": openings,
        "disclaimer": DISCLAIMER,
    }
    model["sheets"] = recommended_sheets(model)
    return model


def public_preview(model: dict) -> dict:
    """Safe JSON for the Studio preview modal."""
    project = (model or {}).get("project") or {}
    wall = (model or {}).get("wall") or {}
    opening = wall.get("opening") or {}
    roof = (model or {}).get("roof") or {}
    foundation = (model or {}).get("foundation") or {}
    beams = (model or {}).get("beams") or []
    return {
        "project": {
            "client_name": project.get("client_name") or "",
            "address": project.get("address") or "",
            "project_type": project.get("project_type") or "",
            "date": project.get("date") or "",
            "code": project.get("code") or CODE_LABEL,
            "jurisdiction": project.get("jurisdiction") or JURISDICTION,
        },
        "wall_height": wall.get("height") or "",
        "stud": wall.get("stud") or "",
        "insulation": wall.get("insulation") or "",
        "opening": {
            "type": opening.get("type") or "",
            "size": f"{format_ft_in(opening.get('width_in'))} x {format_ft_in(opening.get('height_in'))}",
            "header": (opening.get("header") or {}).get("label") or "",
            "source": opening.get("source") or "",
        },
        "foundation": foundation.get("label") or "",
        "footing": f'{int(foundation.get("footing_w_in") or 16)}" x {int(foundation.get("footing_d_in") or 24)}"',
        "roof_pitch": roof.get("pitch") or "",
        "roof_span": roof.get("span") or "",
        "ridge": roof.get("ridge") or "",
        "beam_count": len(beams),
        "opening_count": len((model or {}).get("openings") or []),
        "sheets": (model or {}).get("sheets") or recommended_sheets(model or {}),
        "disclaimer": "Preliminary permit details. Engineer and building official must verify structural sizes.",
    }
