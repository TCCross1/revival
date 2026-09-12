"""Conservative residential LVL header sizing for Floor Plan Studio.

Recommendations are preliminary. Never treat this as stamped engineering.
"""
from __future__ import annotations

from floor_plan import inches, round2

LVL_DISCLAIMER = "Preliminary – verify with a licensed engineer / local code."
CASED_BEAM_MIN_IN = 48.0
WIDE_DOOR_BEAM_MIN_IN = 60.0
PLY_IN = 1.75
LVL_DEPTHS = (5.5, 7.25, 9.25, 11.25, 14.0, 16.0, 18.0)
FB = 2600.0
FV = 285.0
E = 2.0e6
CONSERVATIVE = 0.9
LOAD_BUMP = 1.15
DIM_B = 1.5
DIM_FB = 850.0
DIM_FV = 135.0
DIM_E = 1.4e6
DIM_SIZES = (
    {"id": "2x6", "depth": 5.5},
    {"id": "2x8", "depth": 7.25},
    {"id": "2x10", "depth": 9.25},
    {"id": "2x12", "depth": 11.25},
)

OCC = {
    "empty": {"dl": 10.0, "ll": 20.0},
    "bedroom": {"dl": 12.0, "ll": 40.0},
    "bathroom": {"dl": 18.0, "ll": 40.0},
    "kitchen": {"dl": 18.0, "ll": 40.0},
    "living": {"dl": 12.0, "ll": 40.0},
    "roof": {"dl": 18.0, "ll": 25.0},
}


def needs_beam_for_opening(opening: dict) -> bool:
    width = inches(opening.get("width") if opening else 0)
    kind = str((opening or {}).get("type") or "")
    if kind == "cased":
        return width >= CASED_BEAM_MIN_IN
    if kind == "door":
        return width >= WIDE_DOOR_BEAM_MIN_IN
    return False


def compute_loads(span_in, tributary_in, wall_kind="interior", above="bedroom", stories_above=1) -> dict:
    span_in = max(inches(span_in), 12.0)
    trib_ft = max(inches(tributary_in) / 12.0, 2.0)
    stories = max(0, min(3, int(stories_above or 0)))
    exterior = wall_kind == "exterior"
    kind = above if above in OCC else "bedroom"
    occ = OCC["roof"] if kind == "roof" else OCC[kind]
    if kind == "roof" and stories == 0:
        floor_psf = 10.0
    elif kind == "empty" and stories == 0 and not exterior:
        floor_psf = occ["dl"]
    else:
        floor_psf = (occ["dl"] + occ["ll"]) * max(stories, 1)
    roof_plf = 0.0
    if exterior or kind == "roof":
        roof = OCC["roof"]
        roof_plf = (roof["dl"] + roof["ll"]) * trib_ft * 0.55
    w_plf = round2((floor_psf * trib_ft + roof_plf) * LOAD_BUMP)
    span_ft = span_in / 12.0
    return {
        "dead_psf": occ["dl"],
        "live_psf": occ["ll"],
        "floor_psf": round2(floor_psf),
        "w_plf": w_plf,
        "moment_ftlb": round2((w_plf * span_ft * span_ft) / 8.0),
        "shear_lb": round2((w_plf * span_ft) / 2.0),
        "span_ft": round2(span_ft),
        "tributary_ft": round2(trib_ft),
        "live_share": round2(occ["ll"] / max(occ["dl"] + occ["ll"], 1.0)),
    }


def _section_ok(plies: int, depth: float, loads: dict, ply_in: float = PLY_IN, fb_allow: float = FB, fv_allow: float = FV, e_mod: float = E) -> dict:
    i = plies * (ply_in * (depth ** 3) / 12.0)
    s = plies * (ply_in * (depth ** 2) / 6.0)
    a = plies * ply_in * depth
    fb = (loads["moment_ftlb"] * 12.0) / max(s, 0.01)
    fv = (1.5 * loads["shear_lb"]) / max(a, 0.01)
    w_per_in = loads["w_plf"] / 12.0
    length = loads["span_ft"] * 12.0
    delta = (5.0 * w_per_in * (length ** 4)) / (384.0 * e_mod * i)
    delta_live = delta * loads["live_share"]
    ok = fb <= fb_allow * CONSERVATIVE and fv <= fv_allow * CONSERVATIVE and delta <= length / 240.0 and delta_live <= length / 360.0
    return {"ok": ok, "fb": round2(fb), "fv": round2(fv), "delta": round2(delta)}


def jack_studs_for(span_in, plies, exterior=False) -> int:
    ft = inches(span_in) / 12.0
    jacks = 1
    if ft > 6:
        jacks = 2
    if ft > 10:
        jacks = 3
    if ft > 16:
        jacks = 4
    if plies >= 3 or ft > 14:
        jacks += 1
    if exterior:
        jacks += 1
    return min(jacks, 6)


def recommend_lvl(payload: dict) -> dict:
    span_in = max(inches(payload.get("span_in")), 12.0)
    tributary_in = max(inches(payload.get("tributary_in") or 144), 24.0)
    wall_kind = "exterior" if payload.get("wall_kind") == "exterior" else "interior"
    above = payload.get("above") if payload.get("above") in OCC else "bedroom"
    stories_above = max(0, min(3, int(payload.get("stories_above") or 0)))
    thick = inches(payload.get("wall_thickness") or 0)
    loads = compute_loads(span_in, tributary_in, wall_kind, above, stories_above)

    dim_pick = None
    for plies in ((2, 3) if thick >= 5.5 else (2,)):
        for size in DIM_SIZES:
            check = _section_ok(plies, size["depth"], loads, DIM_B, DIM_FB, DIM_FV, DIM_E)
            if not check["ok"]:
                continue
            score = plies * 8 + size["depth"]
            if dim_pick is None or score < dim_pick["score"]:
                dim_pick = {"plies": plies, "depth": size["depth"], "product": size["id"], "score": score, **check}
    if dim_pick:
        jacks = jack_studs_for(span_in, dim_pick["plies"], wall_kind == "exterior")
        kings = 2 if wall_kind == "exterior" or span_in / 12.0 > 12 else 1
        twin = "Twin" if dim_pick["plies"] == 2 else "Triple" if dim_pick["plies"] == 3 else "Single"
        return {
            "span_in": round2(span_in),
            "tributary_in": round2(tributary_in),
            "wall_kind": wall_kind,
            "above": above,
            "stories_above": stories_above,
            "loads": loads,
            "plies": dim_pick["plies"],
            "depth_in": dim_pick["depth"],
            "width_in": round2(dim_pick["plies"] * DIM_B),
            "jack_studs": jacks,
            "king_studs": kings,
            "label": f"{twin} {dim_pick['product']} SPF #2 header",
            "product": dim_pick["product"],
            "header_kind": "dimensional",
            "species": "SPF No.2",
            "engineer_required": False,
            "disclaimer": LVL_DISCLAIMER,
            "notes": (
                f"{twin} {dim_pick['product']} dimensional lumber is enough for this span/load. "
                f"Use {jacks} jack stud(s) and {kings} king stud(s) each end. Bearing min 1.5\" on each jack pack."
            ),
        }

    pick = None
    for plies in (1, 2, 3):
        for depth in LVL_DEPTHS:
            check = _section_ok(plies, depth, loads)
            if not check["ok"]:
                continue
            score = plies * 10 + depth + (6 if depth > 14 else 0)
            if pick is None or score < pick["score"]:
                pick = {"plies": plies, "depth": depth, "score": score, **check}
        if pick and pick["plies"] == 1 and pick["depth"] <= 14:
            break
    engineer = pick is None
    plies = pick["plies"] if pick else 3
    depth = pick["depth"] if pick else 18.0
    jacks = jack_studs_for(span_in, plies, wall_kind == "exterior")
    kings = 2 if wall_kind == "exterior" or span_in / 12.0 > 12 else 1
    label = f"{'Single' if plies == 1 else 'Double' if plies == 2 else 'Triple'} {int(depth) if depth == int(depth) else depth}\" 2.0E LVL"
    return {
        "span_in": round2(span_in),
        "tributary_in": round2(tributary_in),
        "wall_kind": wall_kind,
        "above": above,
        "stories_above": stories_above,
        "loads": loads,
        "plies": plies,
        "depth_in": depth,
        "width_in": round2(plies * PLY_IN),
        "jack_studs": jacks,
        "king_studs": kings,
        "label": label,
        "product": "lvl",
        "header_kind": "engineer" if engineer else "lvl",
        "species": "2.0E 2600Fb LVL",
        "engineer_required": engineer,
        "disclaimer": LVL_DISCLAIMER,
        "notes": (
            "This span/load is outside a conservative residential header chart. Twin 2x10 / 2x12 will not work. Do not proceed without an engineer."
            if engineer
            else f"Dimensional 2x10 / 2x12 is not enough. Use {label}. {jacks} jack stud(s) and {kings} king stud(s) each end. Bearing min 3\" on each jack pack."
        ),
    }


recommend_header = recommend_lvl
