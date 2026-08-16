"""Priced catalog, scope totals, and job workspace helpers."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from floor_plan import empty_room
from floor_plan_scope import build_scope
from price_book import (
    line_amount, price_appliance, price_cabinet, price_counter,
    price_flooring, price_opening, price_row,
)


def _kitchen_doc():
    room = empty_room("Kitchen", 24, 24, 168, 144)
    room["flooring"] = "lvp"
    return {
        "levels": [{
            "name": "1st Floor",
            "rooms": [room],
            "walls": [{
                "kind": "exterior",
                "openings": [{
                    "type": "window", "style": "casement", "width": 24, "height": 48,
                    "material": "aluminum-clad", "install": "replacement",
                }],
            }],
            "objects": [
                {
                    "library_id": "cab-wall-corner-36", "name": "Corner wall", "tags": ["cabinet", "wall", "corner"],
                    "width": 36, "depth": 36, "x": 30, "y": 30, "finish": "navy",
                    "door_style": "glass-mullion", "glass": "frosted", "crown": "crown-45", "species": "painted",
                },
                {
                    "library_id": "range-36", "name": "Range 36", "tags": ["appliance"],
                    "width": 36, "depth": 27, "x": 70, "y": 30, "appliance_finish": "stainless",
                },
                {
                    "library_id": "counter-run", "name": "Countertop", "tags": ["countertop"],
                    "width": 72, "depth": 25, "x": 30, "y": 54, "counter_material": "quartz",
                },
            ],
        }],
    }


def test_price_book_matches_shop_defaults():
    assert price_flooring("lvp") == 5.25
    assert price_counter("quartz") == 78.0
    assert price_appliance("range-36", "stainless") == 1899.0
    assert price_appliance("range-36", "panel") == 2299.0
    cab = price_cabinet({"width": 36, "glass": "frosted", "crown": "crown-45"}, "cab-wall-corner-36")
    assert cab == 947.75
    assert price_opening("window", "casement", "aluminum-clad", "replacement") == 585.0
    assert line_amount(12.5, 78) == 975.0


def test_scope_line_items_are_priced():
    scope = build_scope(_kitchen_doc())
    items = scope["line_items"]
    assert items, "expected takeoff lines"
    assert all(float(row["unit_price"]) > 0 for row in items), items
    assert all(float(row["amount"]) > 0 for row in items)
    total = round(sum(float(row["amount"]) for row in items), 2)
    assert total > 2000
    quartz = next(row for row in items if "quartz" in row["description"])
    assert quartz["unit_price"] == 78.0
    range_row = next(row for row in items if "Range" in row["description"])
    assert range_row["unit_price"] == 1899.0
    window = next(row for row in items if "aluminum-clad" in row["description"])
    assert window["unit_price"] == 585.0


def test_price_row_keeps_existing_unit_price():
    assert price_row({"unit_price": 42, "group": "Cabinets"}) == 42
    assert price_row({"group": "Cabinets"}) == 420.0


if __name__ == "__main__":
    test_price_book_matches_shop_defaults()
    test_scope_line_items_are_priced()
    test_price_row_keeps_existing_unit_price()
    print("WORKSHOP_SPINE_OK")
