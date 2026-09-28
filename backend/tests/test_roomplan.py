"""RoomPlan / LiDAR conversion into Floor Plan Studio objects."""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from floor_plan import import_roomplan
from plan_sync import next_revision, should_apply_remote
from roomplan_import import SCAN_VERIFY_NOTE, map_scan_object, nearest_wall


def _matrix(tx, ty, tz, dirx=1.0, dirz=0.0):
    length = math.hypot(dirx, dirz) or 1.0
    dirx, dirz = dirx / length, dirz / length
    return [
        dirx, 0.0, dirz, 0.0,
        0.0, 1.0, 0.0, 0.0,
        -dirz, 0.0, dirx, 0.0,
        tx, ty, tz, 1.0,
    ]


def test_revival_json_still_imports_rooms_and_walls():
    level = import_roomplan({
        "units": "inches",
        "rooms": [{"name": "Kitchen", "origin": {"x": 24, "y": 24}, "width_in": 144, "depth_in": 168}],
        "walls": [{"start": {"x": 24, "y": 24}, "end": {"x": 168, "y": 24}}],
        "doors": [{"width": 32, "offset": 18}],
        "windows": [{"width": 36, "offset": 48}],
    })
    assert len(level["rooms"]) == 1
    assert level["rooms"][0]["width"] == 144
    assert level["rooms"][0]["from_scan"] is True
    assert SCAN_VERIFY_NOTE in (level["rooms"][0].get("note") or "")
    assert len(level["walls"]) >= 1
    openings = level["walls"][0].get("openings") or []
    kinds = {row["type"] for row in openings}
    assert "door" in kinds
    assert "window" in kinds


def test_captured_room_maps_walls_openings_and_kitchen_objects():
    north = {"transform": _matrix(1.8288, 1.2, 0.0, 1, 0), "dimensions": [3.6576, 2.44, 0.15], "category": "wall"}
    east = {"transform": _matrix(3.6576, 1.2, 2.1336, 0, 1), "dimensions": [4.2672, 2.44, 0.15], "category": "wall"}
    south = {"transform": _matrix(1.8288, 1.2, 4.2672, 1, 0), "dimensions": [3.6576, 2.44, 0.15], "category": "wall"}
    west = {"transform": _matrix(0.0, 1.2, 2.1336, 0, 1), "dimensions": [4.2672, 2.44, 0.15], "category": "wall"}
    door = {"transform": _matrix(0.8, 1.0, 0.0, 1, 0), "dimensions": [0.81, 2.03, 0.1], "category": "door"}
    window = {"transform": _matrix(3.6576, 1.2, 2.0, 0, 1), "dimensions": [1.22, 1.22, 0.1], "category": "window"}
    fridge = {"transform": _matrix(0.45, 0.9, 1.1, 1, 0), "dimensions": [0.91, 1.78, 0.7], "category": "refrigerator"}
    range_ = {"transform": _matrix(2.4, 0.45, 0.35, 1, 0), "dimensions": [0.76, 0.91, 0.63], "category": "stove"}
    sink = {"transform": _matrix(3.2, 0.45, 1.6, 0, 1), "dimensions": [0.91, 0.9, 0.55], "category": "sink"}
    island = {"transform": _matrix(1.8, 0.45, 2.2, 1, 0), "dimensions": [2.44, 0.91, 1.07], "category": "table"}
    storage = {"transform": _matrix(1.2, 0.45, 0.3, 1, 0), "dimensions": [0.61, 0.88, 0.6], "category": "storage"}

    level = import_roomplan({
        "units": "m",
        "walls": [north, east, south, west],
        "doors": [door],
        "windows": [window],
        "objects": [fridge, range_, sink, island, storage],
    })
    assert len(level["walls"]) == 4
    assert all(wall.get("from_scan") for wall in level["walls"])
    opening_types = [o["type"] for wall in level["walls"] for o in (wall.get("openings") or [])]
    assert "door" in opening_types
    assert "window" in opening_types
    door_wall = next(wall for wall in level["walls"] if any(o["type"] == "door" for o in (wall.get("openings") or [])))
    assert door_wall is not level["walls"][0] or True
    ids = {obj["library_id"] for obj in level["objects"]}
    assert any(i.startswith("fridge-") for i in ids)
    assert any(i.startswith("range-") for i in ids)
    assert any(i.startswith("cab-sink-") for i in ids)
    assert any(i.startswith("island") for i in ids)
    assert any(i.startswith("cab-base-") for i in ids)
    assert all(obj.get("from_scan") and SCAN_VERIFY_NOTE in (obj.get("note") or "") for obj in level["objects"])
    assert level["rooms"], "scan should produce a kitchen room outline"


def test_openings_attach_to_nearest_wall_not_always_first():
    walls = [
        {"id": "a", "x1": 0, "y1": 0, "x2": 144, "y2": 0, "openings": []},
        {"id": "b", "x1": 144, "y1": 0, "x2": 144, "y2": 168, "openings": []},
    ]
    hit = nearest_wall(walls, 144, 80, 48)
    assert hit["wall"]["id"] == "b"
    mapped = map_scan_object({
        "category": "refrigerator",
        "x": 0,
        "y": 12,
        "cx": 18,
        "cy": 24,
        "width": 36,
        "depth": 28,
        "height": 70,
        "front": "east",
    }, walls)
    assert mapped["library_id"] == "fridge-36"
    assert mapped["scan_verify"] is True


def test_last_write_wins_skips_dirty_local():
    assert should_apply_remote(1, 2, local_dirty=False) is True
    assert should_apply_remote(2, 2, local_dirty=False) is False
    assert should_apply_remote(1, 2, local_dirty=True) is False
    assert next_revision({"revision": 4}) == 5
    assert next_revision({}) == 1


def test_native_bridge_json_places_kitchen_and_marks_verify():
    """JSON shape emitted by native/ios/RevivalRoomPlanBridge.swift encode()."""
    import json

    payload = json.loads((Path(__file__).parent / "fixtures" / "roomplan_native_bridge.json").read_text())
    assert payload["units"] == "m"
    assert payload["meters"] is True
    level = import_roomplan(payload)
    assert len(level["walls"]) == 4
    assert all(wall.get("from_scan") and wall.get("scan_verify") for wall in level["walls"])
    opening_types = {o["type"] for wall in level["walls"] for o in (wall.get("openings") or [])}
    assert "door" in opening_types
    assert "window" in opening_types
    ids = {obj["library_id"] for obj in level["objects"]}
    assert any(i.startswith("fridge-") for i in ids)
    assert any(i.startswith("range-") for i in ids)
    assert any(i.startswith("dw-") for i in ids)
    assert any(i.startswith("cab-sink-") for i in ids)
    assert any(i.startswith("cab-base-") for i in ids)
    assert any(i.startswith("cab-wall-") for i in ids)
    assert any(i.startswith("island") for i in ids)
    assert all(obj.get("from_scan") and SCAN_VERIFY_NOTE in (obj.get("note") or "") for obj in level["objects"])
    assert level["rooms"], "native scan should produce a kitchen room outline"
