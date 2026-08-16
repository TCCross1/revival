"""Unit tests for Floor Plan Studio scope, schedules, and client report."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from floor_plan import empty_level, empty_room, empty_wall
from floor_plan_scope import build_scope
from floor_plan_report import build_client_report


def _kitchen_doc():
    room = empty_room("Kitchen", 0, 0, 144, 132)
    room["flooring"] = "lvp"
    room["wall_finish"] = "paint"
    room["note"] = "Keep the window over the sink"
    wall = empty_wall(0, 0, 144, 0, "exterior")
    wall["openings"] = [{
        "type": "door",
        "width": 32,
        "height": 80,
        "style": "six-panel",
        "swing": "left",
        "direction": "in",
    }]
    cabinet = {
        "library_id": "cab-base-24",
        "name": "24\" Base cabinet",
        "tags": ["cabinet"],
        "width": 24,
        "depth": 24,
        "x": 12,
        "y": 12,
        "finish": "navy",
        "note": "Soft-close, no lazy susan",
        "work": "new",
    }
    fridge = {
        "library_id": "fridge-36",
        "name": "36\" Fridge",
        "tags": ["appliance"],
        "width": 36,
        "depth": 30,
        "x": 40,
        "y": 12,
        "note": "",
        "work": "new",
    }
    filler = {
        "library_id": "filler",
        "name": "Cabinet filler 3\"",
        "tags": ["trim", "filler"],
        "width": 3,
        "depth": 24,
        "x": 36,
        "y": 12,
        "finish": "navy",
        "work": "new",
        "auto": True,
        "note": "Auto filler for cabinet run",
    }
    beam = {
        "label": "2-1.75x11.875 LVL",
        "span_in": 144,
        "plies": 2,
        "depth_in": 11.875,
        "jack_studs": 2,
        "king_studs": 1,
        "above": "bedroom",
        "x1": 0,
        "y1": 60,
        "x2": 144,
        "y2": 60,
    }
    level = empty_level("1st Floor", 0)
    level["rooms"] = [room]
    level["walls"] = [wall]
    level["objects"] = [cabinet, fridge, filler]
    level["beams"] = [beam]
    return {"levels": [level], "client_notes": "Client wants warmer lighting.", "special_conditions": "Protect hardwood in the hall."}


def test_kitchen_flooring_quantity():
    scope = build_scope(_kitchen_doc())
    floors = [i for i in scope["line_items"] if "flooring" in i["description"].lower()]
    assert floors, scope["line_items"]
    assert abs(floors[0]["quantity"] - 132.0) < 0.05
    assert floors[0]["unit"] == "SF"
    assert floors[0]["description"].startswith("[Plan]")


def test_schedules_and_notes():
    scope = build_scope(_kitchen_doc())
    assert len(scope["cabinets"]) == 2
    assert "navy" in scope["cabinets"][0]["finish"].lower()
    assert scope["cabinets"][0]["location"] == "Kitchen"
    assert len(scope["appliances"]) == 1
    assert scope["appliances"][0]["name"] == "36\" Fridge"
    assert len(scope["doors"]) == 1
    assert any(f["item"] == "Walls" and f["finish"] == "Paint" for f in scope["finishes"])
    assert any("sink" in n["text"].lower() for n in scope["notes"])
    assert any("soft-close" in n["text"].lower() for n in scope["notes"])
    assert any("lvl" in i["description"].lower() for i in scope["line_items"])
    assert any("cabinet" in i["description"].lower() for i in scope["special_order"])
    fillers = [i for i in scope["line_items"] if "filler" in i["description"].lower()]
    assert fillers, scope["line_items"]
    assert fillers[0]["group"] == "Cabinets"
    assert fillers[0]["quantity"] == 1
    assert abs(fillers[0]["unit_price"] - 28.5) < 0.05


def test_client_report_pdf_bytes():
    plan = {
        "id": "plan-test",
        "name": "Kitchen remodel",
        "client_name": "Jane Homeowner",
        "address": "100 Oak Street",
        "project_type": "Kitchen",
        "version_kind": "proposed",
        "document": _kitchen_doc(),
    }
    pdf = build_client_report(plan, {"name": "Jane Homeowner"}, {"name": "Revival Home Remodeling"}, {})
    assert pdf.startswith(b"%PDF")
    assert len(pdf) > 2000


if __name__ == "__main__":
    test_kitchen_flooring_quantity()
    test_schedules_and_notes()
    test_client_report_pdf_bytes()
    print("FLOOR_PLAN_SCOPE_OK")
