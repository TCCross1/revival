"""Unit tests for Floor Plan Studio take-offs."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from floor_plan import (
    compute_level_takeoffs,
    compute_takeoffs,
    empty_level,
    empty_room,
    empty_roof,
    empty_wall,
    format_ft_in,
    parse_ft_in,
    refit_room_wall_joints,
    walls_from_room,
    wall_length,
)


def test_format_and_parse_feet_inches():
    assert format_ft_in(144) == "12'"
    assert format_ft_in(32) == "2' 8\""
    assert parse_ft_in("10' 6\"") == 126.0
    assert parse_ft_in("8'") == 96.0


def test_room_square_footage():
    room = empty_room("Kitchen", 0, 0, 144, 132)  # 12' x 11'
    level = empty_level()
    level["rooms"] = [room]
    take = compute_level_takeoffs(level, project_type="Kitchen")
    assert take["floor_sf"] == 132.0
    assert take["ceiling_sf"] == 132.0
    assert take["rooms"][0]["sf"] == 132.0
    assert take["roof_sf"] == 0
    assert take["roof_in_scope"] is False


def test_wall_length_and_surface():
    wall = empty_wall(0, 0, 144, 0)  # 12' long, 8' high
    wall["openings"] = [{"width": 32, "height": 80}]
    level = empty_level()
    level["walls"] = [wall]
    take = compute_level_takeoffs(level)
    assert wall_length(wall) == 144.0
    # (144*96 - 32*80) / 144 = 78.22
    assert take["wall_sf"] == 78.22
    assert take["wall_lf"] == 12.0


def test_gable_roof_live_numbers():
    level = empty_level()
    level["rooms"] = [empty_room("Great room", 0, 0, 240, 180)]
    level["roofs"] = [empty_roof("gable", 240, 180)]
    take = compute_level_takeoffs(level, project_type="Addition")
    assert take["floor_sf"] == 300.0
    assert take["pitch"] == "6/12"
    assert take["roof_in_scope"] is True
    assert take["roof_sf"] > take["floor_sf"]
    assert take["ridge_lf"] > 0
    assert take["gutter_lf"] > 0
    assert take["gable_lf"] > 0


def test_kitchen_ignores_leftover_roof():
    level = empty_level()
    level["rooms"] = [empty_room("Kitchen", 0, 0, 144, 132)]
    level["roofs"] = [empty_roof("hip", 144, 132)]
    take = compute_level_takeoffs(level, project_type="Kitchen")
    assert take["floor_sf"] == 132.0
    assert take["roof_sf"] == 0
    assert take["roof_perimeter_lf"] == 0
    assert take["ridge_lf"] == 0
    assert take["roof_in_scope"] is False
    opted = compute_level_takeoffs(level, project_type="Kitchen", roof_in_takeoff=True)
    assert opted["roof_in_scope"] is True
    assert opted["roof_sf"] > 0


def test_addition_infers_roof_from_rooms():
    level = empty_level()
    level["rooms"] = [empty_room("New family room", 0, 0, 240, 180)]
    take = compute_level_takeoffs(level, project_type="Addition")
    assert take["roof_in_scope"] is True
    assert take["roof_sf"] > take["floor_sf"]
    assert take["pitch"] == "6/12"


def test_multi_story_totals():
    first = empty_level("1st Floor", 0)
    first["rooms"] = [empty_room("Kitchen", 0, 0, 144, 144)]
    second = empty_level("2nd Floor", 1)
    second["rooms"] = [empty_room("Bath", 0, 0, 96, 96)]
    doc = {"levels": [first, second]}
    take = compute_takeoffs(doc)
    assert take["totals"]["floor_sf"] == 208.0
    assert take["totals"]["level_count"] == 2
    assert take["totals"]["room_count"] == 2


def test_walls_from_room_close():
    room = empty_room("Bath", 10, 20, 60, 48)
    walls = walls_from_room(room)
    assert len(walls) == 4
    assert wall_length(walls[0]) == 60
    # Default 2x4 studs (3.5") — verticals butt into N/S and lose 3.5" at each end.
    assert abs(wall_length(walls[1]) - (48 - 7)) < 0.01
    assert abs(wall_length(walls[3]) - (48 - 7)) < 0.01
    assert abs(walls[1]["y1"] - (room["y"] + 3.5)) < 0.01
    assert abs(walls[0]["y1"] - (room["y"] + 1.75)) < 0.01
    assert all(w.get("source_room_id") == room["id"] for w in walls)

    box = empty_room("Box", 0, 0, 144, 132)  # 12' × 11'
    walls = walls_from_room(box)
    assert wall_length(walls[0]) == 144
    assert abs(wall_length(walls[1]) - 125.0) < 0.01  # 10' 5"
    assert abs(wall_length(walls[3]) - 125.0) < 0.01


def test_walls_from_room_thickness_change_refits_joints():
    room = empty_room("Box", 0, 0, 144, 132)
    walls = walls_from_room(room)
    for wall in walls:
        wall["thickness"] = 5.5
    room["wall_thickness"] = 5.5
    refit_room_wall_joints(walls, room)
    east = next(w for w in walls if w.get("room_side") == "east")
    assert abs(wall_length(east) - (132 - 11)) < 0.01
    assert abs(east["y1"] - 5.5) < 0.01


if __name__ == "__main__":
    test_format_and_parse_feet_inches()
    test_room_square_footage()
    test_wall_length_and_surface()
    test_gable_roof_live_numbers()
    test_kitchen_ignores_leftover_roof()
    test_addition_infers_roof_from_rooms()
    test_multi_story_totals()
    test_walls_from_room_close()
    print("FLOOR_PLAN_UNIT_OK")
