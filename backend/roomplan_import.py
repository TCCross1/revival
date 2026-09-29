"""Convert Apple RoomPlan / LiDAR JSON into a Floor Plan Studio level.

Measurements from a scan are approximate. Every imported wall, opening, and
object is marked `from_scan` with note "from scan – verify".
This module never logs scan payloads or client addresses.
"""
from __future__ import annotations

import logging
import math
from copy import deepcopy

logger = logging.getLogger(__name__)

from floor_plan import (
    catalog,
    dist,
    empty_level,
    empty_opening,
    empty_room,
    empty_wall,
    inches,
    new_id,
    round2,
    walls_from_room,
)

METERS_TO_INCHES = 39.3701
SCAN_VERIFY_NOTE = "from scan – verify"
SKIP_OBJECT_CATEGORIES = {
    "bed", "sofa", "chair", "television", "tv",
    "stairs", "fireplace", "washerdryer", "washer", "dryer",
}

OBJECT_CATEGORY_BY_INT = {
    0: "storage",
    1: "refrigerator",
    2: "stove",
    3: "bed",
    4: "sink",
    5: "washerDryer",
    6: "toilet",
    7: "bathtub",
    8: "oven",
    9: "dishwasher",
    10: "table",
    11: "sofa",
    12: "chair",
    13: "fireplace",
    14: "television",
    15: "stairs",
}

SURFACE_CATEGORY_BY_INT = {
    0: "wall",
    1: "door",
    2: "window",
    3: "opening",
    4: "floor",
}

BASE_WIDTHS = (9, 12, 15, 18, 21, 24, 27, 30, 33, 36, 42, 48)
WALL_WIDTHS = (12, 15, 18, 21, 24, 27, 30, 33, 36, 42, 48)
SINK_WIDTHS = (24, 30, 33, 36, 42)
TALL_WIDTHS = (12, 15, 18, 24, 30, 36)
ISLAND_WIDTHS = (72, 84, 96, 108)
VANITY_WIDTHS = (24, 30, 36, 42, 48)
VANITY_FLOAT_WIDTHS = (36, 48, 60)
SHOWER_SIZES = (36, 48, 60)
BATH_SIGNAL_CATEGORIES = {"toilet", "bathtub", "tub"}

_CATALOG_INDEX = None


def catalog_item(item_id: str) -> dict:
    global _CATALOG_INDEX
    if _CATALOG_INDEX is None:
        _CATALOG_INDEX = {row["id"]: row for row in catalog()}
    return _CATALOG_INDEX.get(item_id) or {}


def nearest_choice(value, choices) -> int:
    try:
        number = float(value or 0)
    except (TypeError, ValueError):
        number = 0.0
    return min(choices, key=lambda choice: abs(choice - number))


def mark_from_scan(entity: dict) -> dict:
    entity["from_scan"] = True
    entity["scan_verify"] = True
    entity["work"] = entity.get("work") or "existing"
    note = str(entity.get("note") or entity.get("notes") or "").strip()
    if SCAN_VERIFY_NOTE not in note.lower() and "from scan" not in note.lower():
        entity["note"] = SCAN_VERIFY_NOTE if not note else f"{note} · {SCAN_VERIFY_NOTE}"
    if "notes" in entity and not str(entity.get("notes") or "").strip():
        entity["notes"] = SCAN_VERIFY_NOTE
    return entity


def _as_list(value):
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def _category_name(raw, lookup) -> str:
    if raw is None:
        return ""
    if isinstance(raw, dict):
        raw = raw.get("category") or raw.get("identifier") or raw.get("name") or ""
    if isinstance(raw, int):
        return str(lookup.get(raw) or "")
    text = str(raw).strip()
    if text.isdigit():
        return str(lookup.get(int(text)) or text)
    return text


def _looks_like_meters(payload: dict, sample_lengths: list[float]) -> bool:
    units = str(payload.get("units") or "").lower()
    if units.startswith("m") or payload.get("meters") is True:
        return True
    if units.startswith("in") or payload.get("inches") is True:
        return False
    finite = [n for n in sample_lengths if n and n > 0]
    if not finite:
        return False
    return max(finite) < 40


def _flatten_matrix(value) -> list[float]:
    if value is None:
        return []
    if isinstance(value, dict):
        cols = value.get("columns") or value.get("m") or value.get("matrix")
        if cols:
            return _flatten_matrix(cols)
        if "m00" in value:
            return [
                inches(value.get("m00")), inches(value.get("m10")), inches(value.get("m20")), inches(value.get("m30")),
                inches(value.get("m01")), inches(value.get("m11")), inches(value.get("m21")), inches(value.get("m31")),
                inches(value.get("m02")), inches(value.get("m12")), inches(value.get("m22")), inches(value.get("m32")),
                inches(value.get("m03")), inches(value.get("m13")), inches(value.get("m23")), inches(value.get("m33")),
            ]
        return []
    if isinstance(value, (list, tuple)):
        if value and isinstance(value[0], (list, tuple)):
            out = []
            for col in value:
                out.extend([inches(n) for n in list(col)[:4]])
            return out
        return [inches(n) for n in value]
    return []


def _translation(raw: dict, matrix: list[float]) -> tuple[float, float, float]:
    origin = raw.get("origin") or raw.get("position") or raw.get("center") or raw.get("translation") or {}
    if isinstance(origin, dict) and (origin.get("x") is not None or origin.get("z") is not None):
        x = inches(origin.get("x"))
        y = inches(origin.get("y"))
        z = inches(origin.get("z") if origin.get("z") is not None else origin.get("y"))
        return x, y, z
    if isinstance(origin, (list, tuple)) and len(origin) >= 2:
        x = inches(origin[0])
        y = inches(origin[1]) if len(origin) == 2 else inches(origin[1])
        z = inches(origin[2]) if len(origin) > 2 else inches(origin[1])
        return x, y, z
    if len(matrix) >= 15:
        return inches(matrix[12]), inches(matrix[13]), inches(matrix[14])
    return 0.0, 0.0, 0.0


def _plan_point(x: float, y: float, z: float) -> tuple[float, float]:
    """RoomPlan / ARKit is Y-up. Floor plan is X (east) and Z (south)."""
    return x, z


def _dimensions(raw: dict) -> tuple[float, float, float]:
    dims = raw.get("dimensions") or raw.get("size") or {}
    if isinstance(dims, dict):
        width = inches(dims.get("width") or dims.get("x") or raw.get("width") or 0)
        height = inches(dims.get("height") or dims.get("y") or raw.get("height") or 0)
        depth = inches(dims.get("depth") or dims.get("length") or dims.get("z") or raw.get("depth") or raw.get("length") or 0)
        return width, height, depth
    if isinstance(dims, (list, tuple)) and len(dims) >= 2:
        width = inches(dims[0])
        height = inches(dims[1]) if len(dims) > 1 else 0.0
        depth = inches(dims[2]) if len(dims) > 2 else inches(dims[1])
        return width, height, depth
    return inches(raw.get("width")), inches(raw.get("height")), inches(raw.get("depth") or raw.get("length"))


def _axis_xz(matrix: list[float], column: int) -> tuple[float, float]:
    base = column * 4
    if len(matrix) < base + 3:
        return 1.0, 0.0
    dx = inches(matrix[base])
    dz = inches(matrix[base + 2])
    length = math.hypot(dx, dz)
    if length < 1e-6:
        return 1.0, 0.0
    return dx / length, dz / length


def _front_from_normal(nx: float, nz: float) -> str:
    if abs(nx) >= abs(nz):
        return "east" if nx >= 0 else "west"
    return "south" if nz >= 0 else "north"


def _segment_from_surface(raw: dict, scale: float) -> dict | None:
    matrix = _flatten_matrix(raw.get("transform") or raw.get("matrix"))
    width, height, depth = _dimensions(raw)
    if raw.get("start") and raw.get("end"):
        x1, y1 = _point(raw["start"], scale)
        x2, y2 = _point(raw["end"], scale)
        return {"x1": x1, "y1": y1, "x2": x2, "y2": y2, "height": height * scale, "thickness": max(depth, 0.08) * scale if depth else None}
    if raw.get("x1") is not None and raw.get("x2") is not None:
        return {
            "x1": inches(raw["x1"]) * scale,
            "y1": inches(raw.get("y1")) * scale,
            "x2": inches(raw["x2"]) * scale,
            "y2": inches(raw.get("y2")) * scale,
            "height": height * scale,
            "thickness": (depth * scale) if depth else None,
        }
    tx, ty, tz = _translation(raw, matrix)
    px, pz = _plan_point(tx, ty, tz)
    length = width or dist(0, 0, depth, 0) or 0
    if length <= 0:
        return None
    dirx, dirz = _axis_xz(matrix, 0)
    half = length / 2.0
    x1 = (px - dirx * half) * scale
    y1 = (pz - dirz * half) * scale
    x2 = (px + dirx * half) * scale
    y2 = (pz + dirz * half) * scale
    thickness = depth if depth and depth < length else 0.1
    return {
        "x1": x1,
        "y1": y1,
        "x2": x2,
        "y2": y2,
        "height": height * scale,
        "thickness": thickness * scale,
        "center": (px * scale, pz * scale),
    }


def _point(value, scale: float) -> tuple[float, float]:
    if isinstance(value, dict):
        x = inches(value.get("x"))
        z = inches(value.get("z") if value.get("z") is not None else value.get("y"))
        return x * scale, z * scale
    if isinstance(value, (list, tuple)) and len(value) >= 2:
        x = inches(value[0])
        z = inches(value[2] if len(value) > 2 else value[1])
        return x * scale, z * scale
    return 0.0, 0.0


def _object_pose(raw: dict, scale: float) -> dict:
    matrix = _flatten_matrix(raw.get("transform") or raw.get("matrix"))
    width, height, depth = _dimensions(raw)
    tx, ty, tz = _translation(raw, matrix)
    cx, cy = _plan_point(tx, ty, tz)
    cx *= scale
    cy *= scale
    width_in = (width or 0.6) * scale
    depth_in = (depth or width or 0.6) * scale
    height_in = (height or 0.9) * scale
    nx, nz = _axis_xz(matrix, 2)
    front = _front_from_normal(nx, nz)
    return {
        "cx": cx,
        "cy": cy,
        "x": cx - width_in / 2.0,
        "y": cy - depth_in / 2.0,
        "width": width_in,
        "depth": depth_in,
        "height": height_in,
        "front": front,
        "category": _category_name(raw.get("category") or raw.get("type") or raw.get("identifier"), OBJECT_CATEGORY_BY_INT),
    }


def nearest_wall(walls: list, x: float, y: float, max_dist: float = 48.0) -> dict | None:
    best = None
    best_d = max_dist
    for wall in walls or []:
        x1, y1 = inches(wall.get("x1")), inches(wall.get("y1"))
        x2, y2 = inches(wall.get("x2")), inches(wall.get("y2"))
        length = dist(x1, y1, x2, y2)
        if length < 1:
            continue
        t = max(0.0, min(1.0, ((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / (length * length)))
        px = x1 + t * (x2 - x1)
        py = y1 + t * (y2 - y1)
        d = dist(x, y, px, py)
        if d < best_d:
            best_d = d
            best = {"wall": wall, "t": t, "x": px, "y": py, "dist": d, "length": length, "offset": t * length}
    return best


def _iter_rooms(payload: dict) -> list[dict]:
    rooms = []
    for key in ("rooms", "capturedRooms", "captured_rooms"):
        rooms.extend(_as_list(payload.get(key)))
    story = payload.get("story") or payload.get("structure") or {}
    if isinstance(story, dict):
        rooms.extend(_as_list(story.get("rooms")))
    if payload.get("walls") or payload.get("objects") or payload.get("doors"):
        rooms.append(payload)
    seen = []
    out = []
    for room in rooms:
        if not isinstance(room, dict):
            continue
        marker = id(room)
        if marker in seen:
            continue
        seen.append(marker)
        out.append(room)
    return out


def _surfaces(room: dict, *keys: str) -> list:
    rows = []
    for key in keys:
        rows.extend(_as_list(room.get(key)))
    return [row for row in rows if isinstance(row, dict)]


def _room_bounds_from_walls(walls: list) -> tuple[float, float, float, float] | None:
    if not walls:
        return None
    xs = []
    ys = []
    for wall in walls:
        xs.extend([inches(wall.get("x1")), inches(wall.get("x2"))])
        ys.extend([inches(wall.get("y1")), inches(wall.get("y2"))])
    if not xs:
        return None
    return min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)


def scanned_placeholder(library_id: str, x: float, y: float, width=None, depth=None, front="south", name="") -> dict:
    lib = catalog_item(library_id)
    tags = list(lib.get("tags") or [])
    obj = {
        "id": new_id(),
        "library_id": library_id,
        "name": name or lib.get("name") or "Scanned item",
        "group": lib.get("group") or "Kitchen",
        "tags": tags,
        "x": round2(x),
        "y": round2(y),
        "width": round2(width if width is not None else lib.get("width") or 24),
        "depth": round2(depth if depth is not None else lib.get("depth") or 24),
        "height": lib.get("height") or 34.5,
        "rotation": 0,
        "front": front or "south",
        "wall_id": "",
        "finish": "",
        "work": "existing",
        "note": SCAN_VERIFY_NOTE,
        "from_scan": True,
        "scan_verify": True,
        "auto": False,
        "locked": False,
        "config": "",
        "model_number": "",
        "manufacturer": "",
        "description": "LiDAR placeholder — verify size and position",
        "sku": "",
    }
    return obj


def _normalize_object_category(raw) -> str:
    return str(_category_name(raw, OBJECT_CATEGORY_BY_INT) or "").replace(" ", "").replace("_", "").lower()


def bathroom_context(object_rows: list, room_names: list | None = None) -> bool:
    """True when the scan looks like a bath (toilet/tub present or room named bath/powder)."""
    for raw in object_rows or []:
        if not isinstance(raw, dict):
            continue
        if _normalize_object_category(raw) in BATH_SIGNAL_CATEGORIES:
            return True
    text = " ".join(str(name or "") for name in (room_names or [])).lower()
    return "bath" in text or "powder" in text


def _map_vanity(width: float, height: float, x: float, y: float, front: str) -> dict:
    if width >= 66:
        return scanned_placeholder("vanity-double-72", x, y, 72, 22, front, "Double vanity 72 (scan)")
    if width >= 54:
        return scanned_placeholder("vanity-double-60", x, y, 60, 21, front, "Double vanity 60 (scan)")
    if height and 14 <= height <= 24:
        w = nearest_choice(width, VANITY_FLOAT_WIDTHS)
        return scanned_placeholder(f"vanity-float-{w}", x, y, w, 18, front, f"Floating vanity {w} (scan)")
    w = nearest_choice(max(width, 24), VANITY_WIDTHS)
    return scanned_placeholder(f"vanity-single-{w}", x, y, w, 21, front, f"Single vanity {w} (scan)")


def _map_bathtub(width: float, depth: float, x: float, y: float, front: str, far_from_walls: bool) -> dict:
    short, long = sorted((width, depth))
    # Square-ish stalls read as showers; long alcoves / free-standing read as tubs.
    if short >= 34 and long <= 52 and abs(width - depth) < 14:
        side = nearest_choice(max(short, long), SHOWER_SIZES)
        if side >= 54:
            return scanned_placeholder("shower-walk-60", x, y, 60, 36, front, "Walk-in shower 60 (scan)")
        if side >= 42:
            return scanned_placeholder("shower-walk-48", x, y, 48, 36, front, "Walk-in shower 48 (scan)")
        return scanned_placeholder("shower-walk-36", x, y, 36, 36, front, "Walk-in shower 36 (scan)")
    if far_from_walls and long >= 54:
        return scanned_placeholder("tub-free", x, y, 66, 32, front, "Freestanding tub (scan)")
    return scanned_placeholder("tub-60", x, y, 60, 32, front, "Alcove tub 60 (scan)")


def _map_toilet(width: float, depth: float, x: float, y: float, front: str) -> dict:
    if depth <= 22 and width <= 16:
        return scanned_placeholder("toilet-wall", x, y, 15, 22, front, "Wall-hung toilet (scan)")
    if width <= 16:
        return scanned_placeholder("toilet-compact", x, y, 16, 26, front, "Compact toilet (scan)")
    if depth >= 29:
        return scanned_placeholder("toilet-elongated", x, y, 18, 30, front, "Elongated toilet (scan)")
    return scanned_placeholder("toilet", x, y, 18, 28, front, "Toilet (scan)")


def map_scan_object(pose: dict, walls: list, bathroom: bool = False) -> dict | None:
    category = str(pose.get("category") or "").replace(" ", "").replace("_", "").lower()
    if category in SKIP_OBJECT_CATEGORIES or category in {"washerdryer", "fireplace"}:
        return None
    width = max(9.0, inches(pose.get("width")))
    depth = max(8.0, inches(pose.get("depth")))
    height = inches(pose.get("height"))
    x = inches(pose.get("x"))
    y = inches(pose.get("y"))
    front = pose.get("front") or "south"
    near = nearest_wall(walls, inches(pose.get("cx")), inches(pose.get("cy")), 42.0)
    far_from_walls = not near or inches(near.get("dist")) > 30

    if category in {"toilet"}:
        return _map_toilet(width, depth, x, y, front)
    if category in {"bathtub", "tub", "shower"}:
        return _map_bathtub(width, depth, x, y, front, far_from_walls)
    if category in {"refrigerator", "fridge"}:
        w = nearest_choice(width, (30, 36, 42))
        return scanned_placeholder(f"fridge-{w}", x, y, w, 24, front, f"Refrigerator {w} (scan)")
    if category in {"stove", "oven", "range", "cooktop"}:
        w = 36 if width >= 33 else 30
        return scanned_placeholder(f"range-{w}", x, y, w, 24, front, f"Range {w} (scan)")
    if category in {"dishwasher", "dw"}:
        return scanned_placeholder("dw-24", x, y, 24, 24, front, "Dishwasher (scan)")
    if category in {"sink"}:
        if bathroom:
            return _map_vanity(width, height, x, y, front)
        w = nearest_choice(max(width, 30), SINK_WIDTHS)
        return scanned_placeholder(f"cab-sink-{w}", x, y, w, 24, front, f"Sink base {w} (scan)")
    if category in {"table", "island"} or (far_from_walls and width >= 48 and depth >= 24 and not bathroom):
        w = nearest_choice(max(width, 72), ISLAND_WIDTHS)
        island_id = "island-96" if w >= 90 else "island-72" if w < 80 else "island-oak"
        d = 42 if depth >= 38 or w >= 84 else 36
        return scanned_placeholder(island_id, x, y, w, d, front, f"Island {int(w)} (scan)")
    if category in {"storage", "cabinet", "shelf", "vanity"} or not category:
        if bathroom:
            if height >= 70 or (height >= 60 and depth >= 18):
                w = nearest_choice(width, TALL_WIDTHS)
                return scanned_placeholder(f"cab-tall-{w}", x, y, w, 24, front, f"Linen / tall cabinet {w} (scan)")
            if depth <= 16 or (height >= 48 and depth <= 18):
                w = 30 if width >= 27 else 24
                return scanned_placeholder(f"cab-wall-toilet-{w}", x, y, w, 12, front, f"Over-toilet wall {w} (scan)")
            return _map_vanity(width, height, x, y, front)
        if height >= 70 or (height >= 60 and depth >= 18):
            w = nearest_choice(width, TALL_WIDTHS)
            return scanned_placeholder(f"cab-tall-{w}", x, y, w, 24, front, f"Tall pantry {w} (scan)")
        if depth <= 16 or (height >= 48 and depth <= 18):
            w = nearest_choice(width, WALL_WIDTHS)
            return scanned_placeholder(f"cab-wall-{w}", x, y, w, 12, front, f"Wall cabinet {w} (scan)")
        w = nearest_choice(width, BASE_WIDTHS)
        return scanned_placeholder(f"cab-base-{w}", x, y, w, 24, front, f"Base cabinet {w} (scan)")
    return None


def _add_opening(walls: list, kind: str, raw: dict, scale: float) -> None:
    if not walls:
        return
    opening = empty_opening("cased" if kind in {"opening", "cased", "open"} else kind)
    width, height, _depth = _dimensions(raw)
    width_in = width * scale if width and width < 20 else (width if width else opening["width"])
    if width and width < 20:
        width_in = width * scale
    elif width:
        width_in = width if width > 8 else width * scale
    opening["width"] = round2(max(18, width_in or opening["width"]))
    if height:
        opening["height"] = round2(height * scale if height < 20 else height)
    if kind == "window":
        opening["sill"] = 24.0
    pose = None
    try:
        pose = _object_pose(raw, scale)
    except Exception:
        pose = None
    target = None
    if pose:
        target = nearest_wall(walls, pose["cx"], pose["cy"], 72.0)
    if not target and raw.get("offset") is not None:
        walls[0].setdefault("openings", []).append(mark_from_scan({**opening, "offset": inches(raw.get("offset") or 12)}))
        return
    if not target:
        target = {"wall": walls[0], "offset": 12.0, "length": dist(walls[0].get("x1"), walls[0].get("y1"), walls[0].get("x2"), walls[0].get("y2"))}
    offset = inches(target.get("offset")) - opening["width"] / 2.0
    offset = max(0.0, min(max(0.0, inches(target.get("length")) - opening["width"]), offset))
    opening["offset"] = round2(offset)
    mark_from_scan(opening)
    wall = target["wall"]
    wall.setdefault("openings", []).append(opening)


def import_roomplan(payload: dict, level: dict | None = None) -> dict:
    """Accept Apple RoomPlan / native-bridge JSON and map into a level.

    Supported shapes:
    - Revival native: { rooms, walls, doors, windows, objects }
    - Apple CapturedRoom: walls/doors/windows/objects with transform + dimensions (meters, Y-up)
    Coordinates in meters are converted to inches (× 39.3701).
    """
    data = payload or {}
    rooms_in = _iter_rooms(data)
    sample = []
    for room in rooms_in:
        for raw in _surfaces(room, "walls", "doors", "windows", "objects"):
            width, _h, depth = _dimensions(raw)
            sample.extend([width, depth])
            if raw.get("x1") is not None:
                sample.append(abs(inches(raw.get("x2")) - inches(raw.get("x1"))))
    scale = METERS_TO_INCHES if _looks_like_meters(data, sample) else 1.0
    target = deepcopy(level) if level else empty_level("LiDAR Scan", 0)
    target["rooms"] = list(target.get("rooms") or [])
    target["walls"] = list(target.get("walls") or [])
    target["objects"] = list(target.get("objects") or [])

    imported_walls = []
    opening_rows = []
    object_rows = []
    named_rooms = []

    for room in rooms_in:
        room_name = room.get("name") or room.get("label") or ""
        origin = room.get("origin") or room
        explicit_w = room.get("width_in") or room.get("width") or (room.get("dimensions") or {}).get("width")
        explicit_d = room.get("depth_in") or room.get("depth") or room.get("length") or (room.get("dimensions") or {}).get("depth")
        if (room.get("width_in") or room.get("depth_in") or (explicit_w and inches(explicit_w) > 40)) and not room.get("transform"):
            x, y = _point(origin if isinstance(origin, dict) else room, 1.0 if room.get("width_in") else scale)
            w = inches(room.get("width_in") or explicit_w or 144)
            d = inches(room.get("depth_in") or explicit_d or 132)
            if not room.get("width_in") and inches(explicit_w or 0) < 40:
                w = inches(explicit_w) * scale
                d = inches(explicit_d or 0) * scale
            named_rooms.append(mark_from_scan(empty_room(room_name or "Scanned room", x, y, max(36, w), max(36, d))))

        for raw in _surfaces(room, "walls"):
            category = _category_name(raw.get("category"), SURFACE_CATEGORY_BY_INT).lower()
            if category in {"door", "window", "opening", "floor"}:
                opening_rows.append((category if category != "opening" else "cased", raw))
                continue
            seg = _segment_from_surface(raw, scale)
            if not seg:
                continue
            wall = empty_wall(seg["x1"], seg["y1"], seg["x2"], seg["y2"], raw.get("kind") or "exterior")
            if seg.get("thickness"):
                wall["thickness"] = round2(max(3.5, min(12, seg["thickness"])))
            if seg.get("height"):
                wall["height"] = round2(seg["height"] if seg["height"] > 24 else 96)
            imported_walls.append(mark_from_scan(wall))

        for raw in _surfaces(room, "doors"):
            opening_rows.append(("door", raw))
        for raw in _surfaces(room, "windows"):
            opening_rows.append(("window", raw))
        for raw in _surfaces(room, "openings"):
            opening_rows.append(("cased", raw))
        for raw in _surfaces(room, "objects"):
            object_rows.append(raw)

    target["walls"].extend(imported_walls)
    room_names = [room.get("name") or room.get("label") or "" for room in named_rooms]
    room_names.extend([room.get("name") or room.get("label") or "" for room in rooms_in])
    is_bath = bathroom_context(object_rows, room_names)
    default_room_name = "Scanned bathroom" if is_bath else "Scanned kitchen"

    if named_rooms:
        for room in named_rooms:
            if not (room.get("name") or "").strip() or room.get("name") == "Scanned room":
                room["name"] = default_room_name
        target["rooms"].extend(named_rooms)
        if not imported_walls:
            for room in named_rooms:
                generated = [mark_from_scan(wall) for wall in walls_from_room(room)]
                target["walls"].extend(generated)

    if not target["rooms"] and target["walls"]:
        bounds = _room_bounds_from_walls(target["walls"])
        if bounds:
            x, y, w, d = bounds
            target["rooms"].append(mark_from_scan(empty_room(default_room_name, x, y, max(36, w), max(36, d))))

    for kind, raw in opening_rows:
        _add_opening(target["walls"], kind, raw, scale)

    for raw in object_rows:
        try:
            pose = _object_pose(raw, scale)
            mapped = map_scan_object(pose, target["walls"], bathroom=is_bath)
            if mapped:
                target["objects"].append(mapped)
        except Exception:
            logger.exception("Skipping a scanned object that could not be mapped")

    if not target["rooms"] and not target["walls"]:
        raise ValueError("That scan did not include rooms or walls we could read.")

    target["notes"] = (str(target.get("notes") or "").strip() + " Rough layout from LiDAR — verify every dimension.").strip()
    return target
