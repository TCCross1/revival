"""Lexington Estate Kitchen — seeded Studio showcase.

Builds one large proposed kitchen using only catalog objects, openings,
finishes, MEP, and LVL fields the floor-plan shop already supports.
Never logs addresses or plan payloads.
"""
from __future__ import annotations

from copy import deepcopy

from floor_plan import (
    catalog,
    compute_takeoffs,
    empty_document,
    empty_level,
    empty_opening,
    empty_roof,
    empty_room,
    empty_wall,
    new_id,
    now_iso,
    walls_from_room,
)

SHOWCASE_PLAN_ID = "showcase-lexington-kitchen"
SHOWCASE_NAME = "SHOWCASE — Lexington Estate Kitchen"

_CAT = {row["id"]: row for row in catalog()}


def _opening(kind, offset, width=None, **extra):
    row = empty_opening(kind)
    row["offset"] = float(offset)
    if width is not None:
        row["width"] = float(width)
    row.update(extra)
    return row


def _obj(library_id, x, y, **extra):
    lib = _CAT.get(library_id) or {"id": library_id, "name": library_id, "width": 24, "depth": 24, "height": 36, "tags": [], "group": "Kitchen"}
    tags = list(lib.get("tags") or [])
    cabinet = any(t in tags for t in ("cabinet", "island", "peninsula", "vanity"))
    appliance = "appliance" in tags
    counter = "countertop" in tags
    light = "light" in tags
    row = {
        "id": new_id(),
        "library_id": library_id,
        "name": extra.pop("name", None) or lib.get("name") or library_id,
        "group": lib.get("group") or "Kitchen",
        "tags": tags,
        "x": float(x),
        "y": float(y),
        "width": float(extra.pop("width", lib.get("width") or 24)),
        "depth": float(extra.pop("depth", lib.get("depth") or 24)),
        "height": float(extra.pop("height", lib.get("height") or 36)),
        "rotation": float(extra.pop("rotation", 0)),
        "finish": extra.pop("finish", "navy" if cabinet else ""),
        "variant": extra.pop("variant", ""),
        "work": extra.pop("work", "new"),
        "note": extra.pop("note", ""),
        "door_style": extra.pop("door_style", "shaker" if cabinet else ""),
        "glass": extra.pop("glass", ""),
        "species": extra.pop("species", "painted" if cabinet else ""),
        "crown": extra.pop("crown", "crown-45" if "wall" in tags else ""),
        "color": extra.pop("color", ""),
        "appliance_finish": extra.pop("appliance_finish", "stainless" if appliance else ""),
        "counter_material": extra.pop("counter_material", "quartz" if counter else ""),
        "light_mount": extra.pop("light_mount", "flush" if "flush" in tags else ("recessed" if light else "")),
        "auto": False,
    }
    row.update(extra)
    return row


def _find_wall(walls, room_id, side):
    room_walls = [w for w in walls if w.get("source_room_id") == room_id]
    if side == "north":
        return min(room_walls, key=lambda w: (w["y1"] + w["y2"]) / 2)
    if side == "south":
        return max(room_walls, key=lambda w: (w["y1"] + w["y2"]) / 2)
    if side == "west":
        return min(room_walls, key=lambda w: (w["x1"] + w["x2"]) / 2)
    return max(room_walls, key=lambda w: (w["x1"] + w["x2"]) / 2)


def _colinear_overlap(a, b, tol=1.25):
    ax1, ay1, ax2, ay2 = float(a["x1"]), float(a["y1"]), float(a["x2"]), float(a["y2"])
    bx1, by1, bx2, by2 = float(b["x1"]), float(b["y1"]), float(b["x2"]), float(b["y2"])
    a_horiz = abs(ay1 - ay2) < tol
    b_horiz = abs(by1 - by2) < tol
    a_vert = abs(ax1 - ax2) < tol
    b_vert = abs(bx1 - bx2) < tol
    if a_horiz and b_horiz and abs(((ay1 + ay2) / 2) - ((by1 + by2) / 2)) < tol:
        alo, ahi = sorted([ax1, ax2])
        blo, bhi = sorted([bx1, bx2])
        return min(ahi, bhi) - max(alo, blo) > 12
    if a_vert and b_vert and abs(((ax1 + ax2) / 2) - ((bx1 + bx2) / 2)) < tol:
        alo, ahi = sorted([ay1, ay2])
        blo, bhi = sorted([by1, by2])
        return min(ahi, bhi) - max(alo, blo) > 12
    return False


def _coalesce_shared_walls(walls):
    """One wall per shared room edge so openings are not punched through a second black wall."""
    keep = list(walls)
    drop = set()
    for i, a in enumerate(keep):
        if a["id"] in drop:
            continue
        for b in keep[i + 1:]:
            if b["id"] in drop:
                continue
            if not _colinear_overlap(a, b):
                continue
            a_score = (len(a.get("openings") or []), 1 if a.get("kind") == "interior" else 0, 1 if a.get("plumbing") else 0)
            b_score = (len(b.get("openings") or []), 1 if b.get("kind") == "interior" else 0, 1 if b.get("plumbing") else 0)
            winner, loser = (a, b) if a_score >= b_score else (b, a)
            winner["kind"] = "interior"
            winner["thickness"] = 4.5
            loser_openings = list(loser.get("openings") or [])
            if loser_openings:
                winner["openings"] = list(winner.get("openings") or []) + loser_openings
            drop.add(loser["id"])
    return [w for w in keep if w["id"] not in drop]


def build_showcase_document() -> dict:
    kitchen = empty_room("Kitchen", 36, 36, 264, 216)
    kitchen["ceiling_height"] = 108
    kitchen["wall_height"] = 108
    kitchen["flooring"] = "tile"
    kitchen["wall_finish"] = "painted"
    kitchen["work"] = "new"
    kitchen["notes"] = "22' × 18' chef’s kitchen. 9' ceiling. Perimeter navy shaker, walnut island, Calacatta quartz."

    pantry = empty_room("Butler's pantry", 300, 36, 120, 108)
    pantry["ceiling_height"] = 96
    pantry["flooring"] = "tile"
    pantry["work"] = "new"
    pantry["notes"] = "10' × 9' butler’s pantry — cabinets, shelves, and dry storage only. No sink."

    nook = empty_room("Breakfast nook", 36, 252, 180, 144)
    nook["ceiling_height"] = 108
    nook["flooring"] = "engineered_hardwood"
    nook["work"] = "new"
    nook["notes"] = "15' × 12' morning room. French doors to the terrace."

    laundry = empty_room("Laundry / mud", 216, 252, 84, 144)
    laundry["ceiling_height"] = 96
    laundry["flooring"] = "lvp"
    laundry["work"] = "new"
    laundry["notes"] = "7' × 12' mudroom with washer, dryer, and the house panel."

    rooms = [kitchen, pantry, nook, laundry]
    walls = []
    for room, kind in ((kitchen, "exterior"), (pantry, "exterior"), (nook, "exterior"), (laundry, "exterior")):
        walls.extend(walls_from_room(room, kind))

    kn = _find_wall(walls, kitchen["id"], "north")
    ke = _find_wall(walls, kitchen["id"], "east")
    ks = _find_wall(walls, kitchen["id"], "south")
    kw = _find_wall(walls, kitchen["id"], "west")
    kn["height"] = 108
    ke["height"] = 108
    ks["height"] = 108
    kw["height"] = 108
    kn["openings"] = [
        _opening("window", 75, 36, style="picture", material="aluminum-clad", install="new-construction", height=36, sill=42, note="36×36 picture over the sink — no wall cabinets in this zone"),
    ]
    kn["note"] = "North garden wall. One window centered on the sink so upper cabinets can run continuously."
    kw["openings"] = []
    kw["note"] = "Range wall. Keep 18\" clearance each side of the 36\" range. No windows on the cooking wall."
    ke["kind"] = "interior"
    ke["thickness"] = 4.5
    ke["plumbing"] = True
    ke["openings"] = [
        _opening("door", 36, 32, style="six-panel", swing="right", direction="in", exterior=False, height=80, note="Kitchen to butler’s pantry"),
    ]
    ke["note"] = "32\" door centered on the butler’s pantry — swing into the pantry."
    ks["kind"] = "interior"
    ks["thickness"] = 4.5
    ks["openings"] = [
        _opening("cased", 24, 72, style="cased", height=96),
        _opening("door", 180, 32, style="pocket", swing="left", direction="in", exterior=False),
    ]
    ks["note"] = "6' cased opening to the breakfast nook — double LVL above. Pocket door to laundry."

    pn = _find_wall(walls, pantry["id"], "north")
    pe = _find_wall(walls, pantry["id"], "east")
    pn["openings"] = []
    pn["note"] = "Solid north wall for a continuous pantry cabinet run — no window over the uppers."
    pe["openings"] = [
        _opening("window", 18, 36, style="casement", material="vinyl-clad", install="new-construction", height=42, sill=36),
    ]

    ns = _find_wall(walls, nook["id"], "south")
    nw = _find_wall(walls, nook["id"], "west")
    ns["openings"] = [
        _opening("door", 48, 60, style="french", swing="left", direction="out", exterior=True, storm=True, height=80),
        _opening("window", 120, 48, style="picture", material="aluminum-clad", install="new-construction", height=54, sill=24),
    ]
    ns["note"] = "French pair to the terrace with storm panels."
    nw["openings"] = [
        _opening("window", 42, 60, style="slider", material="aluminum-clad", install="new-construction", height=48, sill=30),
    ]

    ls = _find_wall(walls, laundry["id"], "south")
    le = _find_wall(walls, laundry["id"], "east")
    ls["openings"] = [
        _opening("door", 18, 36, style="six-panel", swing="right", direction="in", exterior=True, storm=True),
    ]
    le["openings"] = [
        _opening("window", 40, 36, style="awning", material="vinyl", install="replacement", height=24, sill=48, extension_jambs=False),
    ]

    walls = _coalesce_shared_walls(walls)

    objects = []

    # Interior faces: exterior 6" walls, interior 4.5" walls. Cabinets sit on the inside face.
    ni, wi = 39.0, 39.0
    ei = 297.75
    base_d, wall_d, app_d, fridge_d = 24.0, 12.0, 24.0, 24.0

    # --- Demo existing north run (Before only) ---
    objects += [
        _obj("cab-base-36", 75, ni, work="demo", finish="greige", species="oak", door_style="raised", front="south", depth=base_d, note="Existing builder-grade oak — remove"),
        _obj("cab-base-36", 111, ni, work="demo", finish="greige", species="oak", door_style="raised", front="south", depth=base_d, note="Existing sink base — remove"),
        _obj("range-30", 147, ni, work="demo", appliance_finish="white", front="south", width=30, depth=app_d, note="Existing 30\" electric range — salvage for donation"),
    ]

    # --- NW lazy Susan + north perimeter bases flush to the garden wall ---
    objects += [
        _obj("cab-corner-36", wi, ni, finish="navy", door_style="shaker", species="painted", front="south", width=36, depth=36, config="lazy-susan", note="36\" corner lazy Susan, flush to both interior faces"),
        _obj("cab-base-36", 75, ni, finish="navy", front="south", width=36, depth=base_d, config="drawers-3", note="Pot-and-pan drawers"),
        _obj("cab-sink-36", 111, ni, finish="navy", front="south", width=36, depth=base_d, config="sink", note="Farm sink base, plumbing wall"),
        _obj("dw-24", 147, ni, appliance_finish="panel", front="south", width=24, depth=app_d, note="Panel-ready dishwasher, integrated navy door"),
        _obj("cab-base-30", 171, ni, finish="navy", front="south", width=30, depth=base_d, config="drawers-3", note="Utensil drawers"),
        _obj("cab-trash-18", 201, ni, finish="navy", front="south", width=18, depth=base_d, config="trash", note="Double trash / recycle pull-out"),
        _obj("cab-base-36", 219, ni, finish="navy", front="south", width=36, depth=base_d, note="Bakeware drawers"),
    ]

    # --- North wall cabinets (12\" deep, dashed) including corner wall ---
    objects += [
        _obj("cab-wall-corner-24", wi, ni, finish="navy", door_style="glass-mullion", glass="seeded", crown="built-up", height=42, front="south", width=24, depth=24, config="lazy-susan", note="Corner wall cabinet over the lazy Susan"),
        _obj("cab-wall-36", 75, ni, finish="navy", door_style="glass-mullion", glass="clear", crown="crown-525", height=42, front="south", width=36, depth=wall_d),
        _obj("cab-wall-30", 171, ni, finish="navy", door_style="shaker", crown="crown-525", height=42, front="south", width=30, depth=wall_d),
        _obj("cab-wall-36", 219, ni, finish="navy", door_style="glass-mullion", glass="clear", crown="crown-525", height=42, front="south", width=36, depth=wall_d),
    ]

    # --- West range wall: 24\" deep bases, 36\" range, 18\"+ landings ---
    objects += [
        _obj("cab-base-24", wi, 75, width=24, depth=base_d, finish="navy", front="east", note="Landing left of range"),
        _obj("range-36", wi, 99, width=36, depth=app_d, appliance_finish="black-stainless", front="east", note="36\" dual-fuel range, black stainless"),
        _obj("hood-wall-30", wi, 99, width=36, depth=20, front="east", note="Pro wall hood, 600 CFM, make-up air"),
        _obj("vent-wall", wi - 2, 113, width=8, depth=4, front="east", note="Hood wall vent to exterior"),
        _obj("cab-base-30", wi, 135, width=30, depth=base_d, finish="navy", front="east", note="Landing right of range"),
        _obj("cab-base-36", wi, 165, width=36, depth=base_d, finish="navy", front="east"),
        _obj("cab-base-24", wi, 201, width=24, depth=base_d, finish="navy", front="east"),
        _obj("cab-wall-30", wi, 135, width=30, depth=wall_d, finish="navy", door_style="shaker", crown="crown-45", height=42, front="east"),
        _obj("cab-wall-36", wi, 165, width=36, depth=wall_d, finish="navy", door_style="shaker", crown="crown-45", height=42, front="east"),
    ]

    # --- North fridge butted to the last base (no filler). 36\" along the wall, 24\" into the room ---
    fridge_x = 219.0 + 36.0
    east_x = ei - app_d
    east_y = ni + fridge_d
    objects += [
        _obj("fridge-36", fridge_x, ni, width=36, depth=fridge_d, appliance_finish="stainless", front="south", note="36\" refrigerator butted to the north run, doors facing south, 24\" depth into the kitchen"),
        _obj("cab-wall-fridge-36", fridge_x, ni, width=36, depth=wall_d, finish="navy", door_style="shaker", crown="crown-525", height=18, front="south", note="Over-refrigerator wall, 12\" deep"),
        _obj("cab-micro-30", east_x, east_y, width=30, depth=base_d, finish="navy", front="west", note="Speed-oven / microwave garage"),
        _obj("micro-24", east_x + 4, east_y + 3, width=24, depth=16, appliance_finish="black-stainless", front="west", note="Built-in microwave in the garage"),
        _obj("cab-tall-24", east_x, east_y + 30, width=24, depth=base_d, finish="navy", door_style="shaker", species="painted", front="west", note="Floor-to-ceiling pantry, pull-out trays"),
        _obj("cab-tall-24", east_x, east_y + 54, width=24, depth=base_d, finish="navy", front="west", note="Second tall pantry"),
        _obj("cab-base-18", east_x, east_y + 78, width=18, depth=base_d, finish="navy", front="west"),
    ]

    # --- Working island: 8' x 42\" sink base with cabinets both sides, 15\" seating ---
    objects += [
        _obj("island-96", 118, 105, width=96, depth=42, overhang=15, finish="walnut", species="walnut", door_style="slab", crown="", front="south", config="sink", sink_type="undermount-rect", note="8' walnut island: 33\" prep sink in a sink base with cabinets both sides, 15\" seating overhang"),
        _obj("disposal", 146, 118, note="3/4 HP island disposal"),
    ]

    # --- Countertops (25.5\" including 1.5\" overhang) ---
    objects += [
        _obj("counter-run", 75, ni, width=180, depth=25.5, counter_material="quartz", note="Calacatta quartz, 1-1/4\" eased edge, north run"),
        _obj("counter-run", wi, 75, width=25.5, depth=150, counter_material="quartz", note="West run at the range"),
        _obj("counter-run", 118, 103, width=96, depth=44, counter_material="butcher", note="Walnut butcher-block island top, oiled"),
        _obj("counter-run", 303, 39, width=108, depth=25.5, counter_material="quartz", note="Butler’s pantry coffee bar"),
    ]

    # --- Butler's pantry ---
    objects += [
        _obj("cab-base-36", 303, 39, finish="greige", species="painted", door_style="shaker", front="south", width=36, depth=base_d, note="Coffee / beverage base — storage only"),
        _obj("cab-base-36", 339, 39, finish="greige", door_style="shaker", front="south", width=36, depth=base_d),
        _obj("cab-base-30", 375, 39, finish="greige", door_style="shaker", front="south", width=30, depth=base_d),
        _obj("cab-wall-36", 303, 39, finish="greige", door_style="glass-mullion", glass="clear", crown="crown-35", height=42, front="south", width=36, depth=wall_d, note="Stemware wall"),
        _obj("cab-wall-36", 339, 39, finish="greige", door_style="glass-mullion", glass="seeded", crown="crown-35", height=42, front="south", width=36, depth=wall_d),
        _obj("cab-wall-30", 375, 39, finish="greige", door_style="glass", glass="frosted", crown="crown-35", height=42, front="south", width=30, depth=wall_d),
        _obj("cab-tall-24", 393, 96, finish="greige", front="west", width=24, depth=base_d, note="Dry-goods pantry, clear of the east window"),
        _obj("cab-specialty", 303, 75, finish="greige", door_style="beadboard", front="south", width=18, depth=base_d, note="Tray divider"),
    ]

    # --- Breakfast nook: labeled gas fireplace on the west wall, not a black bar ---
    objects += [
        _obj("light-chandelier", 108, 300, note="8-light aged-brass chandelier on a dimmer"),
        _obj("fp-modern", wi, 288, width=72, depth=12, front="east", finish="stone", note="72\" linear gas fireplace, centered on the west window"),
        _obj("light-sconce", 52, 280, note="Picture light over the fireplace"),
        _obj("light-sconce", 52, 336),
        _obj("fan-light", 150, 320, note="Quiet ceiling fan with light for summer mornings"),
    ]

    # --- Laundry / mud ---
    objects += [
        _obj("washer", 219, 254.25, appliance_finish="white", front="south", width=27, depth=24, note="Front-load washer, pedestal, flush to north interior"),
        _obj("dryer", 246, 254.25, appliance_finish="white", front="south", width=27, depth=24, note="Electric dryer, moisture sensor, flush to north interior"),
        _obj("cab-base-36", 219, 369, finish="sage", species="painted", door_style="shaker", front="north", width=36, depth=24, note="Mud bench / drop zone, flush to south wall"),
        _obj("cab-wall-36", 219, 381, finish="sage", door_style="shaker", crown="cove-2", front="north", width=36, depth=12, note="Cubbies over the bench, on the south interior face"),
        _obj("panel", 293, 348, front="west", width=14, depth=4, note="200A house panel — home-run from kitchen GFCIs"),
        _obj("wh-tankless", 287, 300, front="west", width=18, depth=10, note="Interior tankless, condensing, on the east plumbing wall"),
        _obj("hvac-ah", 249, 318, note="Air handler closet — keep 30\" service clearance"),
    ]

    # --- Lighting ---
    for x in (72, 120, 168, 216, 258):
        for y in (84, 150, 210):
            objects.append(_obj("light-recessed", x, y, light_mount="recessed", note="6\" LED recessed, 3000K"))
    objects += [
        _obj("light-pendant", 124, 128, note="Island pendant 1 of 3"),
        _obj("light-pendant", 148, 128, note="Island pendant 2 of 3"),
        _obj("light-pendant", 172, 128, note="Island pendant 3 of 3"),
        _obj("light-undercab", 78, 50, width=36, note="North under-cabinet LED"),
        _obj("light-undercab", 114, 50, width=36),
        _obj("light-undercab", 174, 50, width=30),
        _obj("light-undercab", 222, 50, width=36),
        _obj("light-flush", 348, 90, light_mount="flush", note="Butler’s pantry flush mount"),
        _obj("light-vanity", 330, 44, note="Coffee-bar accent"),
        _obj("light-recessed", 240, 300, note="Laundry recessed"),
        _obj("light-recessed", 270, 340),
        _obj("smoke", 180, 160, note="Kitchen smoke / CO, interconnected"),
        _obj("smoke", 120, 320, note="Nook smoke / CO"),
    ]

    # --- Electrical ---
    for x, y, note in (
        (90, 78, "GFCI — north counter, left of sink"),
        (140, 78, "GFCI — sink"),
        (190, 78, "GFCI — north counter, right"),
        (250, 78, "GFCI — north end"),
        (70, 120, "GFCI — range left"),
        (70, 160, "GFCI — range right"),
        (70, 200, "GFCI — west run"),
        (160, 160, "Island GFCI"),
        (190, 160, "Island USB / GFCI"),
        (330, 70, "Pantry GFCI"),
        (370, 70, "Coffee-bar GFCI"),
        (240, 290, "Laundry GFCI"),
    ):
        objects.append(_obj("outlet-gfci", x, y, note=note))
    objects += [
        _obj("outlet-duplex", 100, 300, note="Nook convenience"),
        _obj("outlet-duplex", 160, 380, note="Nook south wall"),
        _obj("outlet-afci", 90, 240, note="AFCI living/nook circuit"),
        _obj("switch-dimmer", 50, 240, note="Kitchen recessed dimmer"),
        _obj("switch-dimmer", 100, 248, note="Island pendant dimmer"),
        _obj("switch-3way", 50, 248, note="3-way with the laundry door"),
        _obj("switch-3way", 220, 256, note="3-way at laundry"),
        _obj("switch", 300, 150, note="Pantry light"),
        _obj("switch-gfci", 230, 256, note="Laundry GFCI switch"),
        _obj("outlet-duplex", 48, 88, note="Range 240V home-run — marked on panel"),
    ]

    # --- Plumbing / vents / trim ---
    objects += [
        _obj("sink-33", 116, 56, note="33\" fireclay apron sink"),
        _obj("disposal", 128, 62, note="Main sink disposal"),
        _obj("supply", 128, 58, note="Hot/cold supply, shutoffs in the sink base"),
        _obj("drain", 132, 64, note="Island and main sink drain to the north plumbing wall"),
        _obj("vent-ceiling", 180, 140, note="Return / supply grille"),
        _obj("vent-cabinet", 42, 168, note="Range cabinet vent at the south landing"),
        _obj("vent-ceiling", 348, 100),
        _obj("baseboard", 42, 246, width=252, note="5-1/4\" painted base, kitchen"),
        _obj("crown", 42, 40, width=252, note="Built-up crown to the 9' ceiling"),
        _obj("toekick", 39, 63, width=216, note="Navy toe-kick, kitchen perimeter"),
        _obj("filler", fridge_x + 36.0, ni, width=ei - (fridge_x + 36.0), depth=base_d, note="End filler to the pantry partition, east of the fridge"),
        _obj("touchup", 288, 80, note="Touch-up kit stays with the client"),
        _obj("hose-bib", 40, 400, note="Terrace hose bib off the nook"),
        _obj("drain", 240, 390, note="Laundry floor drain"),
        _obj("supply", 236, 270, note="Washer box"),
    ]

    # Structural LVLs live on the beam layer — do not also drop a solid object on the nook opening.

    beams = [
        {
            "id": new_id(),
            "kind": "lvl",
            "x1": 60.0,
            "y1": 252.0,
            "x2": 144.0,
            "y2": 252.0,
            "plies": 2,
            "depth": 11.25,
            "above": "bedroom",
            "stories_above": 1,
            "tributary_in": 144,
            "label": "Double 11.25\" 2.0E LVL",
            "note": "Preliminary – verify with a licensed engineer / local code. 6' cased opening, kitchen to nook.",
            "wall_kind": "interior",
        },
        {
            "id": new_id(),
            "kind": "lvl",
            "x1": 300.0,
            "y1": 150.0,
            "x2": 300.0,
            "y2": 186.0,
            "plies": 1,
            "depth": 9.25,
            "above": "empty",
            "stories_above": 1,
            "tributary_in": 72,
            "label": "Single 9.25\" 2.0E LVL",
            "note": "Pantry door header.",
            "wall_kind": "interior",
        },
    ]

    roof = empty_roof("hip", 384, 360)
    roof["x"] = 36
    roof["y"] = 36
    roof["pitch_rise"] = 8
    roof["pitch_run"] = 12
    roof["overhang"] = 16

    level = empty_level("1st Floor", 0)
    level["id"] = new_id()
    level["rooms"] = rooms
    level["walls"] = walls
    level["objects"] = objects
    level["roofs"] = [roof]
    level["beams"] = beams
    level["notes"] = (
        "Lexington Estate Kitchen — proposed. Navy perimeter, walnut island, Calacatta quartz, "
        "black-stainless range, panel-ready fridge and dishwasher. 9' kitchen ceiling. "
        "Double LVL over the 6' cased opening. All GFCIs home-run to the laundry panel."
    )

    doc = empty_document()
    doc["active_level_id"] = level["id"]
    doc["foundation"] = "crawl"
    doc["grid"] = 12
    doc["snap"] = 6
    doc["levels"] = [level]
    doc["client_notes"] = (
        "The owners cook every night and entertain on weekends. Target: a working chef’s kitchen "
        "that still photographs like a showroom. Keep the garden view on the north wall. "
        "Island seats four. Butler’s pantry hides the coffee station and overflow china."
    )
    doc["special_conditions"] = (
        "Load-bearing wall between kitchen and nook — do not demo the 6' opening until the double LVL "
        "is set. Confirm make-up air for the 600 CFM hood. Panel-ready fridge and dishwasher need "
        "finished doors from the cabinet shop. Terrace French doors are egress — keep the swing clear. "
        "Washer box and tankless share the east plumbing wall. Engineer to stamp the LVL ticket."
    )
    return doc


def build_showcase_plan(*, client_id="", client_name="", job_id="", address="") -> dict:
    document = build_showcase_document()
    takeoffs = compute_takeoffs(document)
    return {
        "id": SHOWCASE_PLAN_ID,
        "name": SHOWCASE_NAME,
        "client_id": client_id or "",
        "client_name": client_name or "Lexington Estate (example)",
        "job_id": job_id or "",
        "address": address or "1200 Lexington Pike, Lexington, KY",
        "project_type": "Kitchen",
        "version_kind": "proposed",
        "parent_id": "",
        "version": 1,
        "document": document,
        "takeoffs": takeoffs,
        "google_drive_file_id": "",
        "google_drive_url": "",
        "showcase": True,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }


def showcase_stats(document=None) -> dict:
    doc = document or build_showcase_document()
    level = (doc.get("levels") or [{}])[0]
    return {
        "rooms": len(level.get("rooms") or []),
        "walls": len(level.get("walls") or []),
        "objects": len(level.get("objects") or []),
        "beams": len(level.get("beams") or []),
        "openings": sum(len(w.get("openings") or []) for w in (level.get("walls") or [])),
    }
