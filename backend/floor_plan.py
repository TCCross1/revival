"""Floor Plan Studio — geometry, catalog, and live take-offs.

All coordinates and sizes are stored in inches. Display as feet + inches.
This module never logs plan payloads or client addresses.
"""
from __future__ import annotations

import math
import uuid
from copy import deepcopy
from datetime import datetime, timezone

INCH = 1.0
FOOT = 12.0
DEFAULT_WALL_HEIGHT = 96.0
DEFAULT_CEILING = 96.0
EXT_THICKNESS = 6.0
INT_THICKNESS = 4.5
SNAP_INCH = 1.0

PROJECT_TYPES = [
    "Kitchen",
    "Bath",
    "Addition",
    "Whole House",
    "Deck",
    "Patio",
    "Basement",
    "Exterior",
    "Flooring",
    "Other",
]

LEVEL_PRESETS = [
    "1st Floor",
    "2nd Floor",
    "3rd Floor",
    "Basement",
    "Attic",
    "Garage",
    "Outdoor",
]

VERSION_KINDS = ("existing", "proposed")

FLOORING_OPTIONS = [
    {"id": "lvp", "name": "LVP", "color": "#C4A574"},
    {"id": "tile", "name": "Tile", "color": "#D8D3C8"},
    {"id": "carpet", "name": "Carpet", "color": "#A8B5A2"},
    {"id": "engineered_hardwood", "name": "Engineered hardwood", "color": "#B57A4A"},
    {"id": "solid_hardwood", "name": "Solid hardwood", "color": "#8B5A2B"},
]

FOUNDATION_OPTIONS = [
    {"id": "slab", "name": "Slab on grade"},
    {"id": "crawl", "name": "Crawl space"},
    {"id": "basement", "name": "Full basement"},
    {"id": "pier", "name": "Pier and beam"},
]

ROOF_KINDS = [
    {"id": "gable", "name": "Gable"},
    {"id": "hip", "name": "Hip"},
    {"id": "shed", "name": "Shed"},
    {"id": "flat", "name": "Flat / low slope"},
    {"id": "gambrel", "name": "Gambrel"},
]


def new_id() -> str:
    return str(uuid.uuid4())


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def round2(value) -> float:
    try:
        return round(float(value or 0), 2)
    except (TypeError, ValueError):
        return 0.0


def inches(value) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def format_ft_in(total_inches) -> str:
    total = inches(total_inches)
    sign = "-" if total < 0 else ""
    total = abs(total)
    feet = int(total // 12)
    rem = round(total - feet * 12, 2)
    if rem >= 11.999:
        feet += 1
        rem = 0.0
    if rem == 0:
        return f"{sign}{feet}'"
    if rem == int(rem):
        return f"{sign}{feet}' {int(rem)}\""
    return f"{sign}{feet}' {rem}\""


def parse_ft_in(text) -> float:
    raw = str(text or "").strip().lower().replace("ft", "'").replace("in", '"')
    if not raw:
        return 0.0
    try:
        if "'" in raw or '"' in raw:
            feet = 0.0
            inch = 0.0
            if "'" in raw:
                left, right = raw.split("'", 1)
                feet = float(left.strip() or 0)
                raw = right
            inch_txt = raw.replace('"', "").strip()
            if inch_txt:
                inch = float(inch_txt)
            return round2(feet * 12 + inch)
        return round2(float(raw))
    except (TypeError, ValueError):
        return 0.0


def dist(x1, y1, x2, y2) -> float:
    return math.hypot(inches(x2) - inches(x1), inches(y2) - inches(y1))


def wall_length(wall: dict) -> float:
    return dist(wall.get("x1"), wall.get("y1"), wall.get("x2"), wall.get("y2"))


def polygon_area(points) -> float:
    pts = [(inches(p.get("x") if isinstance(p, dict) else p[0]), inches(p.get("y") if isinstance(p, dict) else p[1])) for p in (points or [])]
    if len(pts) < 3:
        return 0.0
    acc = 0.0
    for i, (x1, y1) in enumerate(pts):
        x2, y2 = pts[(i + 1) % len(pts)]
        acc += x1 * y2 - x2 * y1
    return abs(acc) / 2.0


def rectangle_points(x, y, width, depth) -> list:
    x, y, w, d = inches(x), inches(y), inches(width), inches(depth)
    return [{"x": x, "y": y}, {"x": x + w, "y": y}, {"x": x + w, "y": y + d}, {"x": x, "y": y + d}]


def empty_opening(kind="door") -> dict:
    styles = {
        "door": "six-panel",
        "window": "double-hung",
        "cased": "cased",
    }
    widths = {"door": 32.0, "window": 36.0, "cased": 36.0}
    heights = {"door": 80.0, "window": 48.0, "cased": 80.0}
    return {
        "id": new_id(),
        "type": kind,
        "offset": 12.0,
        "width": widths.get(kind, 32.0),
        "height": heights.get(kind, 80.0),
        "sill": 0.0 if kind != "window" else 24.0,
        "swing": "left",
        "direction": "in",
        "storm": False,
        "style": styles.get(kind, "standard"),
        "exterior": kind == "door",
        "material": "vinyl" if kind == "window" else "",
        "install": "new-construction" if kind == "window" else "",
        "extension_jambs": kind == "window",
        "lites": 0,
        "leafs": 1,
        "model_number": "",
        "manufacturer": "",
        "description": "",
        "finish": "",
        "note": "",
    }


def empty_wall(x1=0, y1=0, x2=FOOT * 12, y2=0, kind="exterior") -> dict:
    return {
        "id": new_id(),
        "kind": kind,
        "x1": round2(x1),
        "y1": round2(y1),
        "x2": round2(x2),
        "y2": round2(y2),
        "thickness": EXT_THICKNESS if kind == "exterior" else INT_THICKNESS,
        "height": DEFAULT_WALL_HEIGHT,
        "openings": [],
    }


def empty_room(name="Room", x=24, y=24, width=144, depth=132) -> dict:
    return {
        "id": new_id(),
        "name": name,
        "kind": "room",
        "x": round2(x),
        "y": round2(y),
        "width": round2(width),
        "depth": round2(depth),
        "rotation": 0.0,
        "wall_height": DEFAULT_WALL_HEIGHT,
        "ceiling_height": DEFAULT_CEILING,
        "flooring": "lvp",
        "notes": "",
    }


def walls_from_room(room: dict, kind="exterior") -> list:
    x, y, w, d = inches(room.get("x")), inches(room.get("y")), inches(room.get("width")), inches(room.get("depth"))
    room_id = room.get("id") or ""
    walls = [
        empty_wall(x, y, x + w, y, kind),
        empty_wall(x + w, y, x + w, y + d, kind),
        empty_wall(x + w, y + d, x, y + d, kind),
        empty_wall(x, y + d, x, y, kind),
    ]
    for wall in walls:
        wall["source_room_id"] = room_id
    return walls


def empty_roof(kind="gable", width=240, depth=180) -> dict:
    return {
        "id": new_id(),
        "kind": kind,
        "pitch_rise": 6.0,
        "pitch_run": 12.0,
        "overhang": 12.0,
        "width": round2(width),
        "depth": round2(depth),
        "x": 0.0,
        "y": 0.0,
        "ridge_along": "length",
    }


def empty_level(name="1st Floor", sort_order=0) -> dict:
    return {
        "id": new_id(),
        "name": name,
        "sort_order": sort_order,
        "elevation_in": 0.0 if sort_order == 0 else 108.0 * sort_order,
        "rooms": [],
        "walls": [],
        "objects": [],
        "roofs": [],
        "decks": [],
        "stairs": [],
        "beams": [],
        "notes": "",
    }


def empty_document() -> dict:
    level = empty_level("1st Floor", 0)
    return {
        "units": "inches",
        "grid": 12.0,
        "snap": 6.0,
        "active_level_id": level["id"],
        "foundation": "slab",
        "levels": [level],
        "lidar": {"sessions": [], "last_import": ""},
        "house_standards": {"favorites": [], "defaults": {}},
    }


def empty_plan_meta() -> dict:
    return {
        "name": "Floor plan",
        "client_id": "",
        "client_name": "",
        "job_id": "",
        "address": "",
        "project_type": "Kitchen",
        "version_kind": "existing",
        "parent_id": "",
        "version": 1,
        "document": empty_document(),
    }


def catalog() -> list:
    """Elite remodeling object library. Sizes in inches (W × D × H)."""
    def item(group, subgroup, item_id, name, w, d, h, tags=None):
        return {
            "id": item_id,
            "group": group,
            "subgroup": subgroup,
            "name": name,
            "width": w,
            "depth": d,
            "height": h,
            "tags": tags or [],
            "resizable": True,
            "rotatable": True,
        }

    kitchen = [
        *[item("Kitchen", "Base", f"cab-base-{w}", f"Single door base {w}", w, 24, 34.5, ["cabinet", "base"]) for w in (9, 12, 15, 18, 21)],
        *[item("Kitchen", "Base", f"cab-base-{w}", f"Double door base {w}", w, 24, 34.5, ["cabinet", "base"]) for w in (24, 27, 30, 33, 36, 42, 48)],
        item("Kitchen", "Base", "cab-base-custom", "Custom base cabinet", 27, 24, 34.5, ["cabinet", "base", "custom"]),
        item("Kitchen", "Drawers", "cab-utensil-12", "Utensil 3-drawer 12", 12, 24, 34.5, ["cabinet", "base", "drawers"]),
        item("Kitchen", "Drawers", "cab-utensil-15", "Utensil 3-drawer 15", 15, 24, 34.5, ["cabinet", "base", "drawers"]),
        item("Kitchen", "Drawers", "cab-utensil-18", "Utensil 3-drawer 18", 18, 24, 34.5, ["cabinet", "base", "drawers"]),
        item("Kitchen", "Drawers", "cab-utensil-21", "Utensil 3-drawer 21", 21, 24, 34.5, ["cabinet", "base", "drawers"]),
        *[item("Kitchen", "Drawers", f"cab-drawers-3-{w}", f"3-drawer base {w}", w, 24, 34.5, ["cabinet", "base", "drawers"]) for w in (12, 15, 18, 21, 24, 30, 36)],
        *[item("Kitchen", "Drawers", f"cab-drawers-4-{w}", f"4-drawer stack {w}", w, 24, 34.5, ["cabinet", "base", "drawers"]) for w in (12, 15, 18, 21, 24, 30, 36)],
        *[item("Kitchen", "Drawers", f"cab-drawer-doors-{w}", f"Drawer over doors {w}", w, 24, 34.5, ["cabinet", "base"]) for w in (18, 21, 24, 30, 36, 42)],
        *[item("Kitchen", "Sink bases", f"cab-sink-{w}", f"Sink base {w}", w, 24, 34.5, ["cabinet", "sink", "base"]) for w in (24, 30, 33, 36, 42)],
        item("Kitchen", "Sink bases", "cab-farm-30", "Farm sink base 30", 30, 24, 34.5, ["cabinet", "sink", "base", "farm"]),
        item("Kitchen", "Sink bases", "cab-farm-36", "Farm sink base 36", 36, 24, 34.5, ["cabinet", "sink", "base", "farm"]),
        item("Kitchen", "Sink bases", "cab-farm-42", "Farm sink base 42", 42, 24, 34.5, ["cabinet", "sink", "base", "farm"]),
        *[item("Kitchen", "Sink bases", f"cab-trash-{w}", f"Trash pull-out {w}", w, 24, 34.5, ["cabinet", "trash", "base"]) for w in (12, 15, 18, 21)],
        item("Kitchen", "Corners", "cab-corner-33", "Corner lazy Susan 33", 33, 33, 34.5, ["cabinet", "corner", "base"]),
        item("Kitchen", "Corners", "cab-corner-36", "Corner lazy Susan 36", 36, 36, 34.5, ["cabinet", "corner", "base"]),
        item("Kitchen", "Corners", "cab-corner-42", "Corner lazy Susan 42", 42, 42, 34.5, ["cabinet", "corner", "base"]),
        item("Kitchen", "Corners", "cab-blind-36", "Blind corner 36", 36, 24, 34.5, ["cabinet", "corner", "base"]),
        item("Kitchen", "Corners", "cab-blind-39", "Blind corner 39", 39, 24, 34.5, ["cabinet", "corner", "base"]),
        item("Kitchen", "Corners", "cab-blind-42", "Blind corner 42", 42, 24, 34.5, ["cabinet", "corner", "base"]),
        item("Kitchen", "Corners", "cab-blind-45", "Blind corner 45", 45, 24, 34.5, ["cabinet", "corner", "base"]),
        item("Kitchen", "Corners", "cab-wall-corner-24", "Corner wall 24", 24, 24, 30, ["cabinet", "wall", "corner"]),
        item("Kitchen", "Corners", "cab-wall-corner-36", "Corner wall 36", 36, 36, 42, ["cabinet", "wall", "corner"]),
        item("Kitchen", "Corners", "cab-wall-diag-24", "Diagonal corner wall 24", 24, 24, 30, ["cabinet", "wall", "corner"]),
        *[item("Kitchen", "Wall", f"cab-wall-{w}", f"Wall cabinet {w}", w, 12, 42 if w >= 36 else 30, ["cabinet", "wall"]) for w in (12, 15, 18, 21, 24, 27, 30, 33, 36, 42, 48)],
        item("Kitchen", "Wall", "cab-wall-custom", "Custom wall cabinet", 27, 12, 30, ["cabinet", "wall", "custom"]),
        *[item("Kitchen", "Wall", f"cab-wall-glass-{w}", f"Glass wall cabinet {w}", w, 12, 30, ["cabinet", "wall", "glass"]) for w in (18, 24, 27, 30, 36, 42, 48)],
        item("Kitchen", "Wall", "cab-wall-fridge-30", "Over-refrigerator wall 30", 30, 12, 18, ["cabinet", "wall"]),
        item("Kitchen", "Wall", "cab-wall-fridge-33", "Over-refrigerator wall 33", 33, 12, 18, ["cabinet", "wall"]),
        item("Kitchen", "Wall", "cab-wall-fridge-36", "Over-refrigerator wall 36", 36, 12, 18, ["cabinet", "wall"]),
        item("Kitchen", "Wall", "cab-wall-hood-30", "Over-range wall 30", 30, 12, 18, ["cabinet", "wall"]),
        item("Kitchen", "Wall", "cab-wall-hood-36", "Over-range wall 36", 36, 12, 18, ["cabinet", "wall"]),
        *[item("Kitchen", "Shelves", f"cab-shelf-{w}", f"Open wall shelf {w}", w, 12, 12, ["cabinet", "wall", "shelf"]) for w in (18, 24, 30, 36, 42)],
        item("Kitchen", "Shelves", "cab-shelf-corner-24", "Corner wall shelf 24", 24, 24, 12, ["cabinet", "wall", "shelf", "corner"]),
        *[item("Kitchen", "Tall", f"cab-tall-{w}", f"Tall pantry {w}", w, 24, 84, ["cabinet", "tall"]) for w in (12, 15, 18, 24, 30, 36)],
        item("Kitchen", "Tall", "cab-oven-27", "Oven housing 27", 27, 24, 84, ["cabinet", "tall"]),
        item("Kitchen", "Tall", "cab-oven-30", "Oven housing 30", 30, 24, 84, ["cabinet", "tall"]),
        item("Kitchen", "Tall", "cab-fridge-panel-30", "Refrigerator panel 30", 30, 24, 84, ["cabinet", "tall"]),
        item("Kitchen", "Tall", "cab-fridge-panel-36", "Refrigerator panel 36", 36, 24, 84, ["cabinet", "tall"]),
        item("Kitchen", "Tall", "cab-fridge-panel-42", "Refrigerator panel 42", 42, 24, 84, ["cabinet", "tall"]),
        item("Kitchen", "Tall", "cab-micro-30", "Microwave cabinet 30", 30, 24, 84, ["cabinet", "microwave", "tall"]),
        item("Kitchen", "Tall", "cab-specialty", "Specialty cabinet", 18, 24, 34.5, ["cabinet"]),
        item("Kitchen", "Islands", "island-72", "Kitchen island 72", 72, 36, 36, ["island", "base"]),
        item("Kitchen", "Islands", "island-96", "Kitchen island 96", 96, 42, 36, ["island", "base"]),
        item("Kitchen", "Islands", "island-white-marble", "White marble island", 72, 36, 36, ["island", "base"]),
        item("Kitchen", "Islands", "island-classic-white", "Classic white island", 72, 36, 36, ["island", "base"]),
        item("Kitchen", "Islands", "island-walnut", "Walnut marble island", 72, 36, 36, ["island", "base"]),
        item("Kitchen", "Islands", "island-navy", "Navy brass island", 72, 36, 36, ["island", "base"]),
        item("Kitchen", "Islands", "island-oak", "Oak quartz island", 84, 42, 36, ["island", "base"]),
        item("Kitchen", "Islands", "island-black-waterfall", "Black waterfall island", 84, 42, 36, ["island", "base"]),
        item("Kitchen", "Islands", "island-seat-84", "Seating island 84", 84, 42, 36, ["island", "base"]),
        item("Kitchen", "Islands", "island-sink-72", "Island with sink 72", 72, 36, 36, ["island", "base", "sink"]),
        item("Kitchen", "Islands", "island-cooktop-84", "Island with cooktop 84", 84, 42, 36, ["island", "base"]),
        item("Kitchen", "Islands", "island-double-108", "Double-depth island 108", 108, 48, 36, ["island", "base"]),
        item("Kitchen", "Islands", "peninsula-84", "Peninsula 84", 84, 24, 36, ["peninsula", "base"]),
        item("Kitchen", "Countertops", "counter-run", "Countertop run", 36, 25, 1.5, ["countertop"]),
        item("Kitchen", "Countertops", "counter-quartz", "Quartz counter run", 48, 25.5, 1.5, ["countertop"]),
        item("Kitchen", "Countertops", "counter-marble", "Marble counter run", 48, 25.5, 1.5, ["countertop"]),
        item("Kitchen", "Countertops", "counter-granite", "Granite counter run", 48, 25.5, 1.5, ["countertop"]),
        item("Kitchen", "Countertops", "counter-butcher", "Butcher-block run", 48, 25, 1.5, ["countertop"]),
        item("Kitchen", "Countertops", "counter-concrete", "Concrete-look run", 48, 25.5, 1.5, ["countertop"]),
        item("Kitchen", "Countertops", "counter-island-top", "Island countertop", 72, 42, 1.5, ["countertop"]),
        item("Kitchen", "Hoods", "hood-wall-30", "Wall range hood", 30, 20, 18, ["hood"]),
        item("Kitchen", "Hoods", "hood-island-36", "Island range hood", 36, 24, 18, ["hood"]),
        item("Kitchen", "Hoods", "hood-island-42", "Island hood 42", 42, 27, 18, ["hood"]),
        item("Kitchen", "Hoods", "hood-insert", "Cabinet-insert hood", 30, 18, 10, ["hood"]),
        item("Kitchen", "Hoods", "hood-under-30", "Under-cabinet hood 30", 30, 18, 8, ["hood"]),
        item("Kitchen", "Hoods", "hood-chimney-30", "Chimney hood 30", 30, 20, 28, ["hood"]),
        item("Kitchen", "Hoods", "hood-chimney-36", "Chimney hood 36", 36, 20, 32, ["hood"]),
        item("Kitchen", "Vents", "vent-ceiling", "Ceiling vent", 12, 12, 2, ["vent"]),
        item("Kitchen", "Vents", "vent-wall", "Wall vent", 12, 4, 8, ["vent"]),
        item("Kitchen", "Vents", "vent-cabinet", "Cabinet vent", 6, 12, 4, ["vent"]),
        item("Kitchen", "Appliances", "range-30", "Range 30", 30, 24, 36, ["appliance"]),
        item("Kitchen", "Appliances", "range-36", "Range 36 stainless", 36, 24, 36, ["appliance"]),
        item("Kitchen", "Appliances", "range-black-ss", "Black stainless range", 36, 24, 36, ["appliance"]),
        item("Kitchen", "Appliances", "range-white", "White enamel range", 30, 24, 36, ["appliance"]),
        item("Kitchen", "Appliances", "range-gas-30", "Gas range 30", 30, 24, 36, ["appliance"]),
        item("Kitchen", "Appliances", "range-gas-36", "Gas range 36", 36, 24, 36, ["appliance"]),
        item("Kitchen", "Appliances", "range-induction-30", "Induction range 30", 30, 24, 36, ["appliance"]),
        item("Kitchen", "Appliances", "range-induction-36", "Induction range 36", 36, 24, 36, ["appliance"]),
        item("Kitchen", "Appliances", "cooktop-30", "Cooktop 30", 30, 21, 3, ["appliance"]),
        item("Kitchen", "Appliances", "cooktop-36", "Induction cooktop 36", 36, 21, 3, ["appliance"]),
        item("Kitchen", "Appliances", "cooktop-gas-30", "Gas cooktop 30", 30, 21, 3, ["appliance"]),
        item("Kitchen", "Appliances", "cooktop-gas-36", "Gas cooktop 36", 36, 21, 3, ["appliance"]),
        item("Kitchen", "Appliances", "oven-wall", "Wall oven", 30, 24, 29, ["appliance"]),
        item("Kitchen", "Appliances", "oven-wall-double", "Double wall oven", 30, 24, 52, ["appliance"]),
        item("Kitchen", "Appliances", "fridge-30", "Refrigerator 30", 30, 24, 68, ["appliance"]),
        item("Kitchen", "Appliances", "fridge-36", "Refrigerator 36 stainless", 36, 24, 70, ["appliance"]),
        item("Kitchen", "Appliances", "fridge-42", "Refrigerator 42", 42, 24, 72, ["appliance"]),
        item("Kitchen", "Appliances", "fridge-french-36", "French-door fridge 36", 36, 24, 70, ["appliance"]),
        item("Kitchen", "Appliances", "fridge-bottom-36", "Bottom-freezer fridge 36", 36, 24, 70, ["appliance"]),
        item("Kitchen", "Appliances", "fridge-panel", "Panel-ready refrigerator", 36, 24, 70, ["appliance"]),
        item("Kitchen", "Appliances", "wine-fridge", "Wine fridge", 24, 24, 34, ["appliance"]),
        item("Kitchen", "Appliances", "wine-fridge-15", "Wine fridge 15", 15, 24, 34, ["appliance"]),
        item("Kitchen", "Appliances", "ice-maker", "Ice maker", 15, 24, 34, ["appliance"]),
        item("Kitchen", "Appliances", "dw-18", "Dishwasher 18", 18, 24, 34, ["appliance"]),
        item("Kitchen", "Appliances", "dw-24", "Dishwasher 24 stainless", 24, 24, 34, ["appliance"]),
        item("Kitchen", "Appliances", "dw-panel", "Panel-ready dishwasher", 24, 24, 34, ["appliance"]),
        item("Kitchen", "Appliances", "micro-24", "Microwave 24", 24, 16, 14, ["appliance"]),
        item("Kitchen", "Appliances", "micro-drawer", "Microwave drawer", 24, 24, 16, ["appliance"]),
        item("Kitchen", "Appliances", "micro-over-30", "Over-range microwave 30", 30, 16, 17, ["appliance"]),
        item("Kitchen", "Sinks", "sink-33", "Kitchen sink 33", 33, 22, 10, ["plumbing"]),
        item("Kitchen", "Sinks", "sink-farm-33", "Farmhouse apron sink", 33, 22, 10, ["plumbing", "farm"]),
        item("Kitchen", "Sinks", "sink-double-33", "Double basin sink", 33, 22, 10, ["plumbing"]),
        item("Kitchen", "Sinks", "sink-composite-33", "Black composite sink", 33, 22, 10, ["plumbing"]),
        item("Kitchen", "Sinks", "sink-copper-33", "Copper farmhouse sink", 33, 22, 10, ["plumbing", "farm"]),
        item("Kitchen", "Sinks", "sink-work-36", "Workstation sink 36", 36, 22, 10, ["plumbing"]),
        item("Kitchen", "Sinks", "sink-vessel-white", "White vessel sink", 18, 18, 7, ["plumbing"]),
        item("Kitchen", "Sinks", "sink-vessel-black", "Black vessel sink", 18, 18, 7, ["plumbing"]),
        item("Kitchen", "Sinks", "sink-undermount-oval", "Undermount oval sink", 20, 16, 8, ["plumbing"]),
        item("Kitchen", "Sinks", "sink-undermount-rect", "Undermount rectangular sink", 21, 16, 8, ["plumbing"]),
        item("Kitchen", "Sinks", "sink-topmount-33", "Top-mount sink 33", 33, 22, 10, ["plumbing"]),
        item("Kitchen", "Sinks", "sink-corner-32", "Corner sink 32", 32, 32, 10, ["plumbing"]),
        item("Kitchen", "Sinks", "sink-bar-15", "Bar / prep sink 15", 15, 15, 8, ["plumbing"]),
        item("Kitchen", "Faucets", "faucet-pulldown", "Pull-down kitchen faucet", 8, 8, 16, ["plumbing"]),
        item("Kitchen", "Faucets", "faucet-bridge", "Bridge kitchen faucet", 10, 8, 12, ["plumbing"]),
        item("Kitchen", "Faucets", "faucet-potfiller", "Pot filler", 4, 18, 10, ["plumbing"]),
        item("Kitchen", "Appliances", "disposal", "Disposal", 8, 8, 12, ["appliance", "plumbing"]),
        item("Kitchen", "Appliances", "washer", "Washer", 27, 24, 39, ["appliance", "plumbing"]),
        item("Kitchen", "Appliances", "dryer", "Electric dryer", 27, 24, 39, ["appliance"]),
    ]
    bath = [
        item("Bath", "Vanities", "vanity-single-24", "Single vanity 24", 24, 21, 34, ["vanity"]),
        item("Bath", "Vanities", "vanity-single-30", "Single vanity 30", 30, 21, 34, ["vanity"]),
        item("Bath", "Vanities", "vanity-single-36", "Single vanity 36", 36, 21, 34, ["vanity"]),
        item("Bath", "Vanities", "vanity-single-42", "Single vanity 42", 42, 21, 34, ["vanity"]),
        item("Bath", "Vanities", "vanity-single-48", "Single vanity 48", 48, 21, 34, ["vanity"]),
        item("Bath", "Vanities", "vanity-double-60", "Double vanity 60", 60, 21, 34, ["vanity"]),
        item("Bath", "Vanities", "vanity-double-72", "Double vanity 72", 72, 22, 34, ["vanity"]),
        item("Bath", "Vanities", "vanity-float-36", "Floating vanity 36", 36, 18, 20, ["vanity"]),
        item("Bath", "Vanities", "vanity-float-48", "Floating vanity 48", 48, 18, 20, ["vanity"]),
        item("Bath", "Vanities", "vanity-float-60", "Floating vanity 60", 60, 18, 20, ["vanity"]),
        item("Bath", "Vanities", "vanity-oak-float", "Floating oak vanity", 48, 18, 20, ["vanity"]),
        item("Bath", "Vanities", "vanity-walnut-double", "Dark walnut double vanity", 60, 22, 34, ["vanity"]),
        item("Bath", "Vanities", "vanity-black-marble", "Black cabinet marble vanity", 36, 21, 34, ["vanity"]),
        item("Bath", "Vanities", "vanity-gray-shaker", "Gray shaker vanity", 60, 21, 34, ["vanity"]),
        item("Bath", "Vanities", "vanity-concrete", "Concrete floating vanity", 36, 18, 18, ["vanity"]),
        item("Bath", "Vanities", "vanity-furniture-36", "Furniture vanity 36", 36, 21, 34, ["vanity"]),
        item("Bath", "Vanities", "vanity-furniture-white", "White furniture vanity", 36, 21, 34, ["vanity"]),
        item("Bath", "Vanities", "vanity-black-modern", "Black modern vanity", 36, 18, 20, ["vanity"]),
        item("Bath", "Vanities", "vanity-classic", "Classic traditional vanity", 36, 21, 34, ["vanity"]),
        item("Bath", "Vanities", "vanity-midcentury", "Mid-century vanity", 36, 21, 32, ["vanity"]),
        item("Bath", "Cabinets", "cab-wall-toilet-24", "Over-toilet wall 24", 24, 12, 30, ["cabinet", "wall", "bath", "over-toilet"]),
        item("Bath", "Cabinets", "cab-wall-toilet-30", "Over-toilet wall 30", 30, 12, 30, ["cabinet", "wall", "bath", "over-toilet"]),
        item("Bath", "Tops", "vanity-top-36", "Vanity top 36", 36, 22, 1.25, ["countertop", "vanity"]),
        item("Bath", "Tops", "vanity-top-60", "Vanity top 60", 60, 22, 1.25, ["countertop", "vanity"]),
        item("Bath", "Mirrors", "mirror-36", "Vanity mirror 36", 36, 2, 36, ["mirror"]),
        item("Bath", "Mirrors", "mirror-60", "Vanity mirror 60", 60, 2, 36, ["mirror"]),
        item("Bath", "Mirrors", "mirror-round-30", "Round mirror 30", 30, 2, 30, ["mirror"]),
        item("Bath", "Mirrors", "mirror-arch-36", "Arched mirror 36", 36, 2, 42, ["mirror"]),
        item("Bath", "Mirrors", "mirror-lighted-36", "Lighted mirror 36", 36, 2, 36, ["mirror", "light"]),
        item("Bath", "Mirrors", "mirror-lighted-60", "Lighted mirror 60", 60, 2, 36, ["mirror", "light"]),
        item("Bath", "Showers", "shower-walk-36", "Walk-in shower 36×36", 36, 36, 80, ["shower"]),
        item("Bath", "Showers", "shower-walk-48", "Walk-in shower 48×36", 48, 36, 80, ["shower"]),
        item("Bath", "Showers", "shower-walk-60", "Walk-in shower 60×36", 60, 36, 80, ["shower"]),
        item("Bath", "Showers", "shower-corner-36", "Corner shower 36×36", 36, 36, 80, ["shower"]),
        item("Bath", "Showers", "shower-neo-42", "Neo-angle shower 42", 42, 42, 80, ["shower"]),
        item("Bath", "Showers", "shower-frameless", "Frameless glass shower", 48, 36, 80, ["shower"]),
        item("Bath", "Showers", "shower-framed-48", "Framed glass shower 48", 48, 36, 80, ["shower"]),
        item("Bath", "Showers", "shower-black-frame", "Black-frame walk-in shower", 36, 36, 80, ["shower"]),
        item("Bath", "Showers", "shower-bifold-60", "Bi-fold tub/shower door 60", 60, 2, 58, ["glass", "shower"]),
        item("Bath", "Showers", "shower-steam", "Steam shower", 48, 48, 84, ["shower"]),
        item("Bath", "Showers", "shower-glass-pivot", "Pivot glass door", 30, 2, 78, ["glass"]),
        item("Bath", "Showers", "shower-glass-slide", "Sliding glass door", 48, 2, 78, ["glass"]),
        item("Bath", "Showers", "shower-glass-fixed", "Fixed glass panel", 30, 2, 78, ["glass"]),
        item("Bath", "Showers", "niche-12", "Shower niche", 12, 4, 12, ["niche"]),
        item("Bath", "Showers", "niche-mosaic", "Mosaic niche", 16, 4, 8, ["niche"]),
        item("Bath", "Showers", "niche-steam", "Steam niche", 16, 4, 8, ["niche"]),
        item("Bath", "Showers", "bench-48", "Shower bench", 48, 14, 18, ["bench"]),
        item("Bath", "Showers", "bench-corner", "Corner shower bench", 24, 24, 18, ["bench"]),
        item("Bath", "Showers", "drain-linear", "Linear drain", 36, 3, 1, ["plumbing"]),
        item("Bath", "Showers", "rain-head", "Rain shower head", 12, 12, 4, ["plumbing"]),
        item("Bath", "Showers", "rain-head-16", "Rain head 16", 16, 16, 4, ["plumbing"]),
        item("Bath", "Showers", "handheld", "Handheld shower combo", 6, 4, 24, ["plumbing"]),
        item("Bath", "Showers", "body-spray", "Body spray", 4, 4, 4, ["plumbing"]),
        item("Bath", "Showers", "shower-valve", "Shower valve trim", 8, 4, 8, ["plumbing"]),
        item("Bath", "Fixtures", "tub-60", "Alcove tub 60", 60, 32, 18, ["tub"]),
        item("Bath", "Fixtures", "tub-free", "Freestanding tub", 66, 32, 24, ["tub"]),
        item("Bath", "Fixtures", "tub-dropin-60", "Drop-in tub 60", 60, 32, 20, ["tub"]),
        item("Bath", "Fixtures", "tub-jetted-60", "Jetted tub 60", 60, 32, 22, ["tub"]),
        item("Bath", "Fixtures", "tub-soak-66", "Soaking tub 66", 66, 32, 24, ["tub"]),
        item("Bath", "Fixtures", "tub-japanese", "Japanese soaking tub", 48, 48, 28, ["tub"]),
        item("Bath", "Fixtures", "tub-black", "Matte black soaking tub", 66, 32, 24, ["tub"]),
        item("Bath", "Fixtures", "toilet", "Toilet", 18, 28, 30, ["plumbing"]),
        item("Bath", "Fixtures", "toilet-elongated", "Elongated toilet", 18, 30, 30, ["plumbing"]),
        item("Bath", "Fixtures", "toilet-compact", "Compact toilet", 16, 26, 28, ["plumbing"]),
        item("Bath", "Fixtures", "toilet-comfort", "Comfort-height toilet", 18, 30, 31, ["plumbing"]),
        item("Bath", "Fixtures", "toilet-wall", "Wall-hung toilet", 15, 22, 22, ["plumbing"]),
        item("Bath", "Fixtures", "faucet-wall", "Wall-mount faucet", 8, 4, 6, ["plumbing"]),
        item("Bath", "Fixtures", "faucet-widespread", "Widespread faucet", 8, 4, 8, ["plumbing"]),
        item("Bath", "Fixtures", "faucet-black", "Matte black faucet", 8, 4, 8, ["plumbing"]),
        item("Bath", "Fixtures", "faucet-gold", "Brushed gold faucet", 8, 4, 8, ["plumbing"]),
        item("Bath", "Accessories", "towel-bar-24", "Towel bar 24", 24, 3, 2, ["trim"]),
        item("Bath", "Accessories", "towel-ring", "Towel ring", 8, 3, 8, ["trim"]),
        item("Bath", "Accessories", "robe-hook", "Robe hook", 3, 3, 3, ["trim"]),
        item("Bath", "Accessories", "tp-holder", "Toilet paper holder", 8, 3, 3, ["trim"]),
    ]
    lighting = [
        item("Lighting", "Ceiling", "light-recessed", "Recessed can", 6, 6, 4, ["light", "recessed"]),
        item("Lighting", "Ceiling", "light-flush", "Flush mount", 12, 12, 4, ["light", "flush"]),
        item("Lighting", "Ceiling", "light-layout", "Auto room lighting", 8, 8, 4, ["light", "layout"]),
        item("Lighting", "Ceiling", "light-pendant", "Pendant", 8, 8, 18, ["light"]),
        item("Lighting", "Ceiling", "light-linear", "Linear pendant", 36, 6, 8, ["light"]),
        item("Lighting", "Ceiling", "light-chandelier", "Chandelier point", 20, 20, 24, ["light"]),
        item("Lighting", "Wall", "light-vanity", "Vanity light", 24, 4, 6, ["light"]),
        item("Lighting", "Wall", "light-vanity-36", "Vanity bar 36", 36, 4, 6, ["light"]),
        item("Lighting", "Wall", "light-sconce", "Wall sconce", 6, 4, 12, ["light"]),
        item("Lighting", "Wall", "light-sconce-pair", "Sconce pair", 6, 4, 12, ["light"]),
        item("Lighting", "Cabinet", "light-undercab", "Under-cabinet light", 24, 2, 1, ["light"]),
        item("Lighting", "Ceiling", "fan-ceiling", "Ceiling fan", 42, 42, 14, ["electrical", "fan"]),
        item("Lighting", "Ceiling", "fan-light", "Ceiling fan with light", 42, 42, 16, ["electrical", "fan", "light"]),
    ]
    living = [
        item("Architectural", "Fireplace", "fp-gas", "Gas fireplace", 48, 18, 42, ["fireplace"]),
        item("Architectural", "Fireplace", "fp-wood", "Wood fireplace", 48, 24, 48, ["fireplace"]),
        item("Architectural", "Fireplace", "fp-electric", "Electric fireplace", 50, 8, 20, ["fireplace"]),
        item("Architectural", "Fireplace", "fp-modern", "Modern linear fireplace", 72, 12, 16, ["fireplace"]),
        item("Architectural", "Stairs", "stairs-straight", "Straight stairs", 36, 120, 108, ["stairs"]),
        item("Architectural", "Stairs", "stairs-l", "L stairs", 96, 96, 108, ["stairs"]),
        item("Architectural", "Stairs", "stairs-u", "U stairs", 96, 120, 108, ["stairs"]),
        item("Architectural", "Stairs", "stairs-spiral", "Spiral stairs", 60, 60, 108, ["stairs"]),
        item("Architectural", "Deck", "deck-12x12", "Deck 12×12", 144, 144, 36, ["deck"]),
        item("Architectural", "Deck", "deck-16x20", "Deck 16×20", 192, 240, 36, ["deck"]),
        item("Architectural", "Deck", "patio-cover", "Covered patio", 192, 144, 108, ["patio"]),
        item("Architectural", "Deck", "railing-8", "Deck railing 8'", 96, 4, 36, ["railing"]),
        item("Architectural", "Deck", "deck-stairs", "Deck stairs", 36, 48, 36, ["stairs"]),
        item("Architectural", "Addition", "addition-room", "Room addition", 168, 144, 108, ["addition"]),
    ]
    finishes = [
        item("Finishes", "Trim", "baseboard", "Baseboard run", 96, 1, 5.25, ["trim"]),
        item("Finishes", "Trim", "crown", "Crown molding", 96, 1, 4.5, ["trim"]),
        item("Finishes", "Trim", "cove", "Cove molding", 96, 1, 2.5, ["trim"]),
        item("Finishes", "Trim", "toekick", "Kick plate / toe kick", 96, 4, 4.5, ["trim"]),
        item("Finishes", "Trim", "filler", "Filler strip", 3, 24, 34.5, ["trim", "filler"]),
        item("Finishes", "Trim", "touchup", "Touch-up kit", 8, 6, 2, ["finish"]),
    ]
    mep = [
        item("MEP", "Electrical", "outlet-duplex", "Duplex outlet", 6, 6, 4, ["electrical"]),
        item("MEP", "Electrical", "outlet-gfci", "GFCI outlet", 6, 6, 4, ["electrical"]),
        item("MEP", "Electrical", "outlet-afci", "AFCI receptacle", 6, 6, 4, ["electrical"]),
        item("MEP", "Electrical", "switch", "Light switch", 6, 6, 4, ["electrical"]),
        item("MEP", "Electrical", "switch-dimmer", "Dimmer switch", 6, 6, 4, ["electrical"]),
        item("MEP", "Electrical", "switch-3way", "3-way switch", 6, 6, 4, ["electrical"]),
        item("MEP", "Electrical", "switch-gfci", "GFCI switch", 6, 6, 4, ["electrical"]),
        item("MEP", "Electrical", "panel", "Electrical panel", 14, 4, 30, ["electrical"]),
        item("MEP", "Electrical", "smoke", "Smoke / CO", 6, 6, 2, ["electrical"]),
        item("MEP", "HVAC", "hvac-ah", "Air handler", 24, 24, 48, ["hvac"]),
        item("MEP", "HVAC", "hvac-condenser", "Condenser / heat pump", 36, 36, 36, ["hvac"]),
        item("MEP", "Plumbing", "supply", "Water supply", 4, 4, 4, ["plumbing"]),
        item("MEP", "Plumbing", "drain", "Floor drain", 6, 6, 2, ["plumbing"]),
        item("MEP", "Plumbing", "hose-bib", "Hose bib", 4, 4, 6, ["plumbing"]),
        item("MEP", "Plumbing", "wh-40", "Water heater 40 gal", 22, 22, 60, ["plumbing"]),
        item("MEP", "Plumbing", "wh-50", "Water heater 50 gal", 24, 24, 62, ["plumbing"]),
        item("MEP", "Plumbing", "wh-tankless", "Tankless water heater", 18, 10, 30, ["plumbing"]),
    ]
    structural = [
        item("Structural", "Beams", "lvl-single", "Single LVL", 96, 4, 12, ["lvl"]),
        item("Structural", "Beams", "lvl-double", "Double LVL", 96, 6, 12, ["lvl"]),
        item("Structural", "Beams", "lvl-triple", "Triple LVL", 96, 8, 14, ["lvl"]),
    ]
    openings = [
        item("Openings", "Doors", "door-int-32", "Interior door 32", 32, 6, 80, ["door"]),
        item("Openings", "Doors", "door-ext-36", "Exterior door 36", 36, 6, 80, ["door"]),
        item("Openings", "Doors", "door-french", "French door pair 60", 60, 6, 80, ["door"]),
        item("Openings", "Doors", "door-french-48", "Interior French pair 48 · 4 lites each", 48, 6, 80, ["door"]),
        item("Openings", "Windows", "win-dh-36", "Double-hung 36", 36, 6, 48, ["window"]),
        item("Openings", "Windows", "win-sh-36", "Single-hung 36", 36, 6, 48, ["window"]),
        item("Openings", "Windows", "win-slider-60", "Slider 60", 60, 6, 48, ["window"]),
        item("Openings", "Windows", "win-picture-48", "Picture window 48", 48, 6, 48, ["window"]),
        item("Openings", "Windows", "win-casement", "Crank-out casement 24", 24, 6, 48, ["window"]),
        item("Openings", "Windows", "win-awning", "Crank-out awning 36", 36, 6, 24, ["window"]),
        item("Openings", "Openings", "cased-36", "Cased opening 36", 36, 6, 80, ["cased"]),
        item("Openings", "Openings", "cased-72", "Cased opening 6'", 72, 6, 80, ["cased"]),
    ]
    return kitchen + bath + lighting + living + finishes + mep + structural + openings


def _room_sf(room: dict) -> float:
    return round2((inches(room.get("width")) * inches(room.get("depth"))) / 144.0)


def _opening_area(opening: dict) -> float:
    return inches(opening.get("width")) * inches(opening.get("height"))


def compute_roof(level: dict) -> dict:
    roofs = level.get("roofs") or []
    rooms = level.get("rooms") or []
    if roofs:
        roof = roofs[0]
        width = inches(roof.get("width"))
        depth = inches(roof.get("depth"))
        rise = max(inches(roof.get("pitch_rise")) or 6.0, 0.01)
        run = max(inches(roof.get("pitch_run")) or 12.0, 0.01)
        overhang = inches(roof.get("overhang"))
        kind = (roof.get("kind") or "gable").lower()
    else:
        if not rooms:
            return {
                "roof_sf": 0.0,
                "roof_perimeter_lf": 0.0,
                "ridge_lf": 0.0,
                "gable_lf": 0.0,
                "valley_lf": 0.0,
                "gutter_lf": 0.0,
                "pitch": "6/12",
                "pitch_deg": 0.0,
            }
        min_x = min(inches(r.get("x")) for r in rooms)
        min_y = min(inches(r.get("y")) for r in rooms)
        max_x = max(inches(r.get("x")) + inches(r.get("width")) for r in rooms)
        max_y = max(inches(r.get("y")) + inches(r.get("depth")) for r in rooms)
        width = max_x - min_x
        depth = max_y - min_y
        rise, run, overhang, kind = 6.0, 12.0, 12.0, "gable"

    pitch_ratio = rise / run
    pitch_rad = math.atan(pitch_ratio)
    pitch_deg = round2(math.degrees(pitch_rad))
    footprint_w = width + 2 * overhang
    footprint_d = depth + 2 * overhang
    footprint_sf = (footprint_w * footprint_d) / 144.0
    slope_factor = 1.0 / max(math.cos(pitch_rad), 0.15)

    if kind == "flat":
        roof_sf = round2(footprint_sf)
        ridge_lf = 0.0
        gable_lf = 0.0
        valley_lf = 0.0
        gutter_lf = round2((2 * (footprint_w + footprint_d)) / 12.0)
    elif kind == "shed":
        roof_sf = round2(footprint_sf * slope_factor)
        ridge_lf = 0.0
        gable_lf = round2((2 * (footprint_d / max(math.cos(pitch_rad), 0.15))) / 12.0)
        valley_lf = 0.0
        gutter_lf = round2((2 * footprint_w + 2 * footprint_d) / 12.0)
    elif kind == "hip":
        roof_sf = round2(footprint_sf * slope_factor)
        ridge_lf = round2(max(footprint_w - footprint_d, 0) / 12.0)
        gable_lf = 0.0
        hip = math.hypot(footprint_d / 2.0, (footprint_d / 2.0) * pitch_ratio)
        valley_lf = round2((4 * hip) / 12.0)
        gutter_lf = round2((2 * (footprint_w + footprint_d)) / 12.0)
    else:
        # gable / gambrel
        roof_sf = round2(footprint_sf * slope_factor)
        ridge_along_length = footprint_w >= footprint_d
        ridge_in = footprint_w if ridge_along_length else footprint_d
        span_in = footprint_d if ridge_along_length else footprint_w
        rafter = (span_in / 2.0) / max(math.cos(pitch_rad), 0.15)
        ridge_lf = round2(ridge_in / 12.0)
        gable_lf = round2((4 * rafter) / 12.0)
        valley_lf = 0.0
        gutter_lf = round2((2 * ridge_in) / 12.0)

    perimeter_lf = round2((2 * (footprint_w + footprint_d)) / 12.0)
    return {
        "roof_sf": roof_sf,
        "roof_perimeter_lf": perimeter_lf,
        "ridge_lf": ridge_lf,
        "gable_lf": gable_lf,
        "valley_lf": valley_lf,
        "gutter_lf": gutter_lf,
        "pitch": f"{int(rise)}/{int(run)}",
        "pitch_deg": pitch_deg,
    }


def compute_level_takeoffs(level: dict) -> dict:
    rooms = level.get("rooms") or []
    walls = level.get("walls") or []
    objects = level.get("objects") or []
    room_rows = []
    floor_sf = 0.0
    for room in rooms:
        sf = _room_sf(room)
        floor_sf += sf
        perim = 2 * (inches(room.get("width")) + inches(room.get("depth")))
        room_rows.append({
            "id": room.get("id"),
            "name": room.get("name") or "Room",
            "sf": sf,
            "perimeter_lf": round2(perim / 12.0),
            "wall_height": inches(room.get("wall_height") or DEFAULT_WALL_HEIGHT),
            "ceiling_height": inches(room.get("ceiling_height") or DEFAULT_CEILING),
            "flooring": room.get("flooring") or "lvp",
        })
    floor_sf = round2(floor_sf)
    ceiling_sf = floor_sf

    wall_sf = 0.0
    wall_lf = 0.0
    opening_sf = 0.0
    for wall in walls:
        length = wall_length(wall)
        height = inches(wall.get("height") or DEFAULT_WALL_HEIGHT)
        gross = length * height
        holes = 0.0
        for opening in wall.get("openings") or []:
            holes += _opening_area(opening)
        opening_sf += holes
        wall_sf += max(gross - holes, 0.0)
        wall_lf += length
    wall_sf = round2(wall_sf / 144.0)
    wall_lf = round2(wall_lf / 12.0)
    opening_sf = round2(opening_sf / 144.0)

    baseboard_lf = round2(sum(row["perimeter_lf"] for row in room_rows))
    crown_lf = baseboard_lf
    toekick_lf = round2(sum(
        (inches(obj.get("width")) / 12.0)
        for obj in objects
        if "cabinet" in (obj.get("tags") or []) or str(obj.get("library_id") or "").startswith("cab-base")
    ))
    roof = compute_roof(level)
    plumbing_lf = round2(sum(wall_length(w) for w in walls if w.get("plumbing")) / 12.0)
    beams = level.get("beams") or []
    beam_lf = round2(sum(wall_length(b) for b in beams) / 12.0)
    lvl_lf = round2(sum(wall_length(b) * float(b.get("plies") or 1) for b in beams) / 12.0)
    return {
        "level_id": level.get("id"),
        "name": level.get("name") or "Level",
        "rooms": room_rows,
        "room_count": len(rooms),
        "floor_sf": floor_sf,
        "ceiling_sf": ceiling_sf,
        "wall_sf": wall_sf,
        "wall_lf": wall_lf,
        "opening_sf": opening_sf,
        "baseboard_lf": baseboard_lf,
        "crown_lf": crown_lf,
        "toekick_lf": toekick_lf,
        "plumbing_wall_lf": plumbing_lf,
        "beam_lf": beam_lf,
        "lvl_lf": lvl_lf,
        "object_count": len(objects),
        **roof,
    }


def compute_takeoffs(document: dict) -> dict:
    doc = document or {}
    levels = doc.get("levels") or []
    level_rows = [compute_level_takeoffs(level) for level in levels]
    totals = {
        "floor_sf": round2(sum(r["floor_sf"] for r in level_rows)),
        "ceiling_sf": round2(sum(r["ceiling_sf"] for r in level_rows)),
        "wall_sf": round2(sum(r["wall_sf"] for r in level_rows)),
        "wall_lf": round2(sum(r["wall_lf"] for r in level_rows)),
        "roof_sf": round2(sum(r["roof_sf"] for r in level_rows)),
        "roof_perimeter_lf": round2(sum(r["roof_perimeter_lf"] for r in level_rows)),
        "ridge_lf": round2(sum(r["ridge_lf"] for r in level_rows)),
        "gable_lf": round2(sum(r["gable_lf"] for r in level_rows)),
        "valley_lf": round2(sum(r["valley_lf"] for r in level_rows)),
        "gutter_lf": round2(sum(r["gutter_lf"] for r in level_rows)),
        "baseboard_lf": round2(sum(r["baseboard_lf"] for r in level_rows)),
        "crown_lf": round2(sum(r["crown_lf"] for r in level_rows)),
        "plumbing_wall_lf": round2(sum(r.get("plumbing_wall_lf") or 0 for r in level_rows)),
        "beam_lf": round2(sum(r.get("beam_lf") or 0 for r in level_rows)),
        "lvl_lf": round2(sum(r.get("lvl_lf") or 0 for r in level_rows)),
        "level_count": len(level_rows),
        "room_count": sum(r["room_count"] for r in level_rows),
    }
    pitch = next((r["pitch"] for r in level_rows if r.get("roof_sf")), "6/12")
    return {"levels": level_rows, "totals": totals, "pitch": pitch, "computed_at": now_iso()}


def split_wall_at(wall: dict, x, y, tolerance=8.0) -> tuple:
    """Split a wall at a point if it lies on the segment. Returns (a, b) or (wall, None)."""
    x1, y1, x2, y2 = inches(wall.get("x1")), inches(wall.get("y1")), inches(wall.get("x2")), inches(wall.get("y2"))
    px, py = inches(x), inches(y)
    length = dist(x1, y1, x2, y2)
    if length < 1:
        return wall, None
    t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / (length * length)
    if t <= 0.04 or t >= 0.96:
        return wall, None
    proj_x = x1 + t * (x2 - x1)
    proj_y = y1 + t * (y2 - y1)
    if dist(px, py, proj_x, proj_y) > tolerance:
        return wall, None
    left = deepcopy(wall)
    right = deepcopy(wall)
    left["id"] = new_id()
    right["id"] = new_id()
    left["x2"], left["y2"] = round2(proj_x), round2(proj_y)
    right["x1"], right["y1"] = round2(proj_x), round2(proj_y)
    left["openings"] = []
    right["openings"] = []
    return left, right


def apply_t_intersections(walls: list, new_wall: dict) -> list:
    """Insert a wall and split any walls it T-intersects."""
    result = []
    for wall in walls:
        a, b = split_wall_at(wall, new_wall.get("x1"), new_wall.get("y1"))
        if b:
            result.extend([a, b])
            continue
        a, b = split_wall_at(wall, new_wall.get("x2"), new_wall.get("y2"))
        if b:
            result.extend([a, b])
            continue
        result.append(wall)
    result.append(new_wall)
    return result


def import_roomplan(payload: dict, level: dict | None = None) -> dict:
    """Accept Apple RoomPlan / native-bridge JSON and map into a level.

    Supported shapes:
    - Revival native: { rooms, walls, openings }
    - RoomPlan-ish: { walls: [{start, end, thickness}], doors, windows, rooms }
    Coordinates in meters are converted to inches (× 39.3701).
    """
    data = payload or {}
    scale = 39.3701 if str(data.get("units") or "").lower().startswith("m") else 1.0
    if data.get("meters") is True:
        scale = 39.3701
    target = deepcopy(level) if level else empty_level("LiDAR Scan", 0)

    def pt(value, key_x="x", key_y="y"):
        if isinstance(value, dict):
            return inches(value.get(key_x)) * scale, inches(value.get(key_y)) * scale
        if isinstance(value, (list, tuple)) and len(value) >= 2:
            return inches(value[0]) * scale, inches(value[1]) * scale
        return 0.0, 0.0

    for raw in data.get("rooms") or []:
        x, y = pt(raw.get("origin") or raw)
        w = inches(raw.get("width") or raw.get("dimensions", {}).get("width") or 120) * (scale if not raw.get("width_in") else 1)
        d = inches(raw.get("depth") or raw.get("length") or raw.get("dimensions", {}).get("depth") or 120) * (scale if not raw.get("depth_in") else 1)
        if raw.get("width_in"):
            w = inches(raw.get("width_in"))
        if raw.get("depth_in"):
            d = inches(raw.get("depth_in"))
        room = empty_room(raw.get("name") or "Scanned room", x, y, w, d)
        target["rooms"].append(room)

    for raw in data.get("walls") or []:
        if raw.get("start") and raw.get("end"):
            x1, y1 = pt(raw["start"])
            x2, y2 = pt(raw["end"])
        elif raw.get("x1") is not None:
            x1, y1, x2, y2 = inches(raw["x1"]) * scale, inches(raw["y1"]) * scale, inches(raw["x2"]) * scale, inches(raw["y2"]) * scale
        else:
            continue
        wall = empty_wall(x1, y1, x2, y2, raw.get("kind") or "exterior")
        if raw.get("thickness"):
            wall["thickness"] = inches(raw["thickness"]) * (scale if scale != 1 else 1)
        target["walls"].append(wall)

    def add_opening(kind, raw):
        walls = target.get("walls") or []
        if not walls:
            return
        wall = walls[0]
        opening = empty_opening(kind)
        opening["width"] = inches(raw.get("width") or opening["width"]) * (scale if scale != 1 and inches(raw.get("width") or 0) < 20 else 1)
        if inches(raw.get("width") or 0) > 20:
            opening["width"] = inches(raw.get("width"))
        opening["offset"] = inches(raw.get("offset") or 12)
        wall.setdefault("openings", []).append(opening)

    for raw in data.get("doors") or []:
        add_opening("door", raw)
    for raw in data.get("windows") or []:
        add_opening("window", raw)

    if not target["rooms"] and not target["walls"]:
        raise ValueError("That scan did not include rooms or walls we could read.")
    return target


def public_catalog() -> dict:
    return {
        "objects": catalog(),
        "project_types": PROJECT_TYPES,
        "levels": LEVEL_PRESETS,
        "flooring": FLOORING_OPTIONS,
        "foundations": FOUNDATION_OPTIONS,
        "roofs": ROOF_KINDS,
        "version_kinds": list(VERSION_KINDS),
        "window_styles": ["double-hung", "single-hung", "casement", "awning", "slider", "picture"],
        "window_materials": ["vinyl", "vinyl-clad", "wood", "aluminum-clad"],
        "window_installs": ["new-construction", "replacement"],
        "cabinet_door_styles": ["shaker", "slab", "raised", "recessed", "beadboard", "glass", "glass-frosted", "glass-mullion"],
        "cabinet_glass": ["", "clear", "frosted", "seeded"],
        "wood_species": ["oak", "red-oak", "maple", "cherry", "walnut", "hickory", "alder", "painted"],
        "cabinet_crowns": ["", "cove-2", "crown-35", "crown-45", "crown-525", "built-up"],
        "appliance_finishes": ["stainless", "black-stainless", "white", "black", "panel"],
        "appliance_fuels": ["electric", "gas", "induction", "dual"],
        "counter_materials": ["quartz", "carrara", "calacatta", "marble", "granite", "formica", "butcher", "solid", "soapstone", "concrete"],
        "cabinet_configs": ["single", "doors", "drawer-doors", "drawers-3", "drawers-4", "trash", "sink", "lazy-susan", "blind", "shelf", "glass", "fridge-wall", "hood-wall"],
        "hardware_finishes": ["nickel", "brass", "gold", "black", "chrome"],
        "hardware_styles": ["bar", "knob", "cup", "none"],
        "hardware_sizes": ["3", "4", "5", "6", "8", "12"],
        "sink_types": ["undermount-rect", "undermount-oval", "double", "farm", "vessel", "workstation", "top-mount", "corner", "integrated"],
        "faucet_finishes": ["nickel", "brass", "gold", "black", "chrome", "bronze"],
        "faucet_styles": ["gooseneck", "pulldown", "bridge", "widespread", "wall", "pot-filler"],
        "hood_types": ["wall", "island", "under", "insert", "chimney"],
        "shower_types": ["walk-in", "corner", "neo", "alcove", "steam"],
        "shower_doors": ["pivot", "sliding", "frameless", "framed", "bifold", "fixed"],
        "tub_types": ["alcove", "freestanding", "drop-in", "jetted", "soaking"],
        "mirror_shapes": ["rect", "round", "arch"],
        "toilet_types": ["floor", "compact", "comfort", "wall"],
    }
