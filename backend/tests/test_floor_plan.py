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
    take = compute_level_takeoffs(level)
    assert take["floor_sf"] == 132.0
    assert take["ceiling_sf"] == 132.0
    assert take["rooms"][0]["sf"] == 132.0


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
    take = compute_level_takeoffs(level)
    assert take["floor_sf"] == 300.0
    assert take["pitch"] == "6/12"
    assert take["roof_sf"] > take["floor_sf"]
    assert take["ridge_lf"] > 0
    assert take["gutter_lf"] > 0
    assert take["gable_lf"] > 0


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
    assert wall_length(walls[1]) == 48
    assert all(w.get("source_room_id") == room["id"] for w in walls)


if __name__ == "__main__":
    test_format_and_parse_feet_inches()
    test_room_square_footage()
    test_wall_length_and_surface()
    test_gable_roof_live_numbers()
    test_multi_story_totals()
    test_walls_from_room_close()
    print("FLOOR_PLAN_UNIT_OK")
