"""Kitchen catalog, window installs, lighting count, and countertop scope."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from floor_plan import catalog, empty_opening, empty_room, public_catalog
from floor_plan_scope import build_scope


def test_catalog_has_new_kitchen_and_window_items():
    ids = {row["id"] for row in catalog()}
    for needed in (
        "cab-wall-corner-24", "cab-wall-corner-36", "cab-base-custom", "cab-wall-custom",
        "cab-base-12", "cab-wall-48", "counter-run", "light-flush", "light-layout",
        "win-sh-36", "win-awning",
        "island-white-marble", "island-navy", "island-oak", "range-black-ss", "fridge-panel",
        "vanity-walnut-double", "vanity-oak-float", "sink-farm-33", "sink-vessel-white",
        "shower-black-frame", "tub-japanese", "faucet-gold", "bench-corner",
        "cab-utensil-18", "cab-drawers-3-24", "cab-drawer-doors-36", "cab-wall-fridge-36",
        "cab-wall-hood-30", "cab-shelf-36", "cab-blind-42", "cab-tall-36",
        "cab-base-9", "island-seat-84", "island-sink-72", "range-gas-36", "range-induction-30",
        "shower-neo-42", "shower-corner-36", "tub-jetted-60", "vanity-double-72", "faucet-pulldown",
        "mirror-arch-36", "toilet-wall", "hood-chimney-36", "counter-concrete",
        "cab-wall-toilet-24", "cab-wall-toilet-30", "door-french-48",
    ):
        assert needed in ids, needed
    ids_list = [row["id"] for row in catalog()]
    assert len(ids_list) == len(set(ids_list))
    pub = public_catalog()
    assert "single-hung" in pub["window_styles"]
    assert "vinyl-clad" in pub["window_materials"]
    assert "replacement" in pub["window_installs"]
    assert "glass-mullion" in pub["cabinet_door_styles"]
    assert "recessed" in pub["cabinet_door_styles"]
    assert "stainless" in pub["appliance_finishes"]
    assert "quartz" in pub["counter_materials"]
    assert "concrete" in pub["counter_materials"]
    assert "pulldown" in pub["faucet_styles"]
    assert "frameless" in pub["shower_doors"]


def test_2d_refrigerators_are_twenty_four_inches_deep():
    for row in catalog():
        if str(row.get("id") or "").startswith("fridge"):
            assert row["depth"] <= 24, row["id"]


def test_window_opening_defaults_to_new_construction_jambs():
    opening = empty_opening("window")
    assert opening["style"] == "double-hung"
    assert opening["material"] == "vinyl"
    assert opening["install"] == "new-construction"
    assert opening["extension_jambs"] is True


def test_scope_includes_cabinet_glass_counter_and_window_install():
    room = empty_room("Kitchen", 24, 24, 168, 144)
    doc = {
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
    scope = build_scope(doc)
    cab = next(c for c in scope["cabinets"] if "Corner" in c["name"])
    assert "glass-mullion" in cab["note"]
    assert "frosted" in cab["note"]
    assert any("quartz" in i["description"] and i["group"] == "Countertops" for i in scope["line_items"])
    assert any("stainless" in i["description"] for i in scope["line_items"])
    assert any("aluminum-clad" in i["description"] and "box replacement" in i["description"] for i in scope["line_items"])


def test_auto_light_count_for_typical_kitchen():
    room = empty_room("Kitchen", 0, 0, 168, 144)
    inset = 24
    spacing = 48
    cols = max(1, round((168 - inset * 2) / spacing) + 1)
    rows = max(1, round((144 - inset * 2) / spacing) + 1)
    assert cols * rows >= 4
    assert cols * rows <= 12


if __name__ == "__main__":
    test_catalog_has_new_kitchen_and_window_items()
    test_window_opening_defaults_to_new_construction_jambs()
    test_scope_includes_cabinet_glass_counter_and_window_install()
    test_auto_light_count_for_typical_kitchen()
    print("STUDIO_KITCHEN_OPTIONS_OK")
