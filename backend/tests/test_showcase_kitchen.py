"""Lexington Estate Kitchen showcase — no live Google or Mongo calls."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from floor_plan import catalog, compute_takeoffs
from showcase_kitchen import SHOWCASE_NAME, SHOWCASE_PLAN_ID, build_showcase_document, build_showcase_plan, showcase_stats


def test_showcase_uses_only_catalog_ids():
    ids = {row["id"] for row in catalog()}
    doc = build_showcase_document()
    level = doc["levels"][0]
    for obj in level["objects"]:
        assert obj["library_id"] in ids, obj["library_id"]


def test_showcase_is_a_large_proposed_kitchen():
    plan = build_showcase_plan()
    assert plan["id"] == SHOWCASE_PLAN_ID
    assert plan["name"] == SHOWCASE_NAME
    assert plan["project_type"] == "Kitchen"
    assert plan["version_kind"] == "proposed"
    assert plan["showcase"] is True
    stats = showcase_stats(plan["document"])
    assert stats["rooms"] >= 4
    assert stats["objects"] >= 80
    assert stats["openings"] >= 10
    assert stats["beams"] >= 1
    names = {r["name"] for r in plan["document"]["levels"][0]["rooms"]}
    assert "Kitchen" in names
    assert "Butler's pantry" in names
    assert "Breakfast nook" in names
    assert "Laundry / mud" in names


def test_showcase_takeoffs_and_finishes():
    doc = build_showcase_document()
    take = compute_takeoffs(doc)
    assert take["totals"]["floor_sf"] > 400
    assert take["totals"]["wall_lf"] > 80
    objects = doc["levels"][0]["objects"]
    assert any(o["library_id"] == "range-36" and o["appliance_finish"] == "black-stainless" for o in objects)
    assert any(o["library_id"] == "island-96" and o["finish"] == "walnut" for o in objects)
    assert any(o["work"] == "demo" for o in objects)
    assert any(o["library_id"] == "outlet-gfci" for o in objects)
    assert any(o["library_id"] == "fridge-36" and o["appliance_finish"] == "stainless" for o in objects)
    assert "engineer" in (doc.get("special_conditions") or "").lower()


def _aabb(obj):
    return obj["x"], obj["y"], obj["x"] + obj["width"], obj["y"] + obj["depth"]


def _overlaps(a, b):
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def test_showcase_appliances_sit_on_the_correct_walls():
    objects = build_showcase_document()["levels"][0]["objects"]
    proposed_ranges = [o for o in objects if str(o.get("library_id") or "").startswith("range") and o.get("work") != "demo"]
    demo_ranges = [o for o in objects if str(o.get("library_id") or "").startswith("range") and o.get("work") == "demo"]
    micros = [o for o in objects if o.get("library_id") == "micro-24"]
    hoods = [o for o in objects if str(o.get("library_id") or "").startswith("hood-wall")]
    assert len(proposed_ranges) == 1
    assert len(demo_ranges) == 1
    assert len(micros) == 1
    assert len(hoods) == 1

    rng = proposed_ranges[0]
    assert rng["front"] == "east"
    assert rng["width"] == 36
    assert rng["depth"] == 24
    assert rng["x"] == 39
    assert 96 <= rng["y"] <= 110
    assert not _overlaps(_aabb(rng), _aabb(demo_ranges[0]))
    assert demo_ranges[0]["y"] < 80

    fridge = next(o for o in objects if o.get("library_id") == "fridge-36")
    last_north = next(
        o for o in objects
        if o.get("library_id") == "cab-base-36" and o.get("front") == "south" and o.get("work") != "demo" and o.get("x") == 219
    )
    assert fridge["front"] == "south"
    assert fridge["width"] == 36
    assert fridge["depth"] == 24
    assert fridge["y"] == 39
    assert fridge["x"] == last_north["x"] + last_north["width"]
    filler = next(o for o in objects if o.get("library_id") == "filler")
    assert filler["x"] == fridge["x"] + fridge["width"]
    assert filler["y"] == fridge["y"]
    assert abs(filler["x"] + filler["width"] - 297.75) < 0.05
    assert not _overlaps(_aabb(fridge), _aabb(last_north))
    assert not _overlaps(_aabb(fridge), _aabb(filler))
    north_bases = [
        o for o in objects
        if str(o.get("library_id") or "").startswith("cab-base")
        and o.get("work") != "demo"
        and o.get("front") == "south"
        and o.get("x", 0) < 255
    ]
    for cab in north_bases:
        assert cab["y"] == 39
        assert cab["depth"] == 24
        assert not _overlaps(_aabb(fridge), _aabb(cab)), cab.get("library_id")

    cab = next(o for o in objects if o.get("library_id") == "cab-micro-30")
    micro = micros[0]
    assert micro["x"] >= cab["x"] - 1
    assert micro["y"] >= cab["y"] - 1
    assert micro["x"] + micro["width"] <= cab["x"] + cab["width"] + 1
    assert micro["y"] + micro["depth"] <= cab["y"] + cab["depth"] + 1
    assert hoods[0]["x"] == rng["x"]
    assert hoods[0]["y"] == rng["y"]


def test_showcase_follows_2020_kitchen_rules():
    objects = build_showcase_document()["levels"][0]["objects"]
    corner = next(o for o in objects if o.get("library_id") == "cab-corner-36")
    wall_corner = next(o for o in objects if o.get("library_id") == "cab-wall-corner-24")
    island = next(o for o in objects if o.get("library_id") == "island-96")
    fireplace = next(o for o in objects if o.get("library_id") == "fp-modern")
    assert corner["x"] == 39 and corner["y"] == 39
    assert corner.get("config") == "lazy-susan"
    assert wall_corner["x"] == 39 and wall_corner["y"] == 39
    assert island["width"] == 96 and island["depth"] == 42
    assert island.get("overhang") == 15
    assert fireplace["front"] == "east"
    assert fireplace["depth"] == 12
    assert not any(str(o.get("library_id") or "").startswith("lvl-") for o in objects)
    run_ids = ("cab-base", "cab-sink", "cab-trash", "cab-tall", "cab-micro", "range-", "dw-")
    for obj in objects:
        if obj.get("work") == "demo":
            continue
        lid = str(obj.get("library_id") or "")
        if any(lid.startswith(prefix) for prefix in run_ids):
            assert obj["depth"] == 24, lid
    fridge = next(o for o in objects if o.get("library_id") == "fridge-36")
    assert fridge["depth"] == 24
    assert fridge["front"] == "south"
    assert fridge["width"] == 36


def _in_room(obj, room):
    cx = obj["x"] + obj["width"] / 2
    cy = obj["y"] + obj["depth"] / 2
    return room["x"] <= cx <= room["x"] + room["width"] and room["y"] <= cy <= room["y"] + room["depth"]


def test_showcase_professional_kitchen_standards():
    doc = build_showcase_document()
    level = doc["levels"][0]
    rooms = {r["name"]: r for r in level["rooms"]}
    objects = [o for o in level["objects"] if o.get("work") != "demo"]
    pantry = rooms["Butler's pantry"]
    laundry = rooms["Laundry / mud"]
    kitchen = rooms["Kitchen"]

    pantry_sinks = [
        o for o in objects
        if _in_room(o, pantry) and (
            str(o.get("library_id") or "").startswith("cab-sink")
            or str(o.get("library_id") or "").startswith("sink")
            or o.get("config") == "sink"
        )
    ]
    assert pantry_sinks == []

    island = next(o for o in objects if o.get("library_id") == "island-96")
    assert island.get("config") == "sink"
    assert island["width"] >= 96
    fixtures = [o for o in objects if str(o.get("library_id") or "").startswith("sink-")]
    assert fixtures
    for fixture in fixtures:
        host = [
            o for o in objects
            if o["id"] != fixture["id"] and (
                str(o.get("library_id") or "").startswith("cab-sink")
                or o.get("config") == "sink"
                or str(o.get("library_id") or "").startswith("island")
            ) and _overlaps(_aabb(fixture), _aabb(o))
        ]
        assert host, fixture.get("library_id")

    kn = next(w for w in level["walls"] if w.get("source_room_id") == kitchen["id"] and abs(w["y1"] - kitchen["y"]) < 1 and abs(w["y2"] - kitchen["y"]) < 1)
    kitchen_north_windows = [op for op in (kn.get("openings") or []) if op.get("type") == "window"]
    assert len(kitchen_north_windows) == 1
    assert kitchen_north_windows[0]["width"] == 36

    sink = next(o for o in objects if o.get("library_id") == "cab-sink-36" and o.get("front") == "south")
    over_sink = [
        o for o in objects
        if str(o.get("library_id") or "").startswith("cab-wall")
        and o.get("front") == "south"
        and o["x"] < sink["x"] + sink["width"]
        and o["x"] + o["width"] > sink["x"]
        and abs(o["y"] - sink["y"]) < 2
    ]
    assert over_sink == []

    bench = next(o for o in objects if o.get("library_id") == "cab-base-36" and o.get("front") == "north")
    assert abs(bench["y"] + bench["depth"] - (laundry["y"] + laundry["depth"] - 3)) < 1.5
    wall_cab = next(o for o in objects if o.get("library_id") == "cab-wall-36" and o.get("front") == "north")
    assert abs(wall_cab["y"] + wall_cab["depth"] - (laundry["y"] + laundry["depth"] - 3)) < 1.5

    fireplace = next(o for o in objects if o.get("library_id") == "fp-modern")
    nook = rooms["Breakfast nook"]
    nw = next(w for w in level["walls"] if w.get("source_room_id") == nook["id"] and abs(w["x1"] - nook["x"]) < 1 and abs(w["x2"] - nook["x"]) < 1)
    win = next(op for op in (nw.get("openings") or []) if op.get("type") == "window")
    win_mid = nook["y"] + win["offset"] + win["width"] / 2
    fp_mid = fireplace["y"] + fireplace["width"] / 2
    assert abs(fp_mid - win_mid) <= 6

    ke = next(
        w for w in level["walls"]
        if w.get("source_room_id") == kitchen["id"]
        and abs(w["x1"] - (kitchen["x"] + kitchen["width"])) < 2
        and abs(w["x2"] - (kitchen["x"] + kitchen["width"])) < 2
    )
    pantry_door = next(op for op in (ke.get("openings") or []) if op.get("type") == "door")
    assert pantry_door["width"] >= 32
    door_y = kitchen["y"] + pantry_door["offset"] + pantry_door["width"] / 2
    assert pantry["y"] < door_y < pantry["y"] + pantry["depth"]

    pn = next(
        w for w in level["walls"]
        if w.get("source_room_id") == pantry["id"]
        and abs(w["y1"] - pantry["y"]) < 1
        and abs(w["y2"] - pantry["y"]) < 1
    )
    assert not any(op.get("type") == "window" for op in (pn.get("openings") or []))
    assert any(str(o.get("library_id") or "").startswith("hood") for o in objects)

