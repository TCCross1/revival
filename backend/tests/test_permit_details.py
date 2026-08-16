"""Unit tests for permit detail extraction and PDF generation."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from floor_plan import empty_level, empty_opening, empty_roof, empty_room, empty_wall
from permit_model import extract_permit_model, public_preview, typical_header, jack_studs_for
from permit_report import build_permit_report


def _addition_plan():
    room = empty_room("Addition", 0, 0, 144, 240)
    room["wall_height"] = 108
    wall = empty_wall(0, 0, 144, 0, "exterior")
    wall["thickness"] = 6
    wall["height"] = 108
    window = empty_opening("window")
    window["width"] = 36
    window["height"] = 60
    window["sill"] = 32
    cased = empty_opening("cased")
    cased["width"] = 96
    cased["height"] = 80
    wall["openings"] = [window, cased]
    roof = empty_roof("gable", 144, 240)
    roof["pitch_rise"] = 6
    roof["pitch_run"] = 12
    roof["overhang"] = 12
    beam = {
        "label": 'DOUBLE 11.25" 2.0E LVL',
        "span_in": 96,
        "plies": 2,
        "depth_in": 11.25,
        "jack_studs": 3,
        "king_studs": 1,
        "above": "roof",
        "engineer_required": True,
        "loads": {"w_plf": 240},
    }
    level = empty_level("1st Floor", 0)
    level["rooms"] = [room]
    level["walls"] = [wall]
    level["roofs"] = [roof]
    level["beams"] = [beam]
    return {
        "name": "Room addition",
        "client_name": "Test Client",
        "address": "100 Oak St, Lexington, KY",
        "project_type": "Addition",
        "document": {"foundation": "slab", "levels": [level]},
    }


def test_header_grows_with_span():
    small = typical_header(32, "2x6")
    wide = typical_header(96, "2x6")
    assert small["typical"] is True
    assert wide["engineer_required"] is True
    assert wide["depth_in"] >= small["depth_in"]
    assert jack_studs_for(96, True) >= jack_studs_for(32, True)


def test_extract_uses_plan_wall_height_and_opening():
    model = extract_permit_model(_addition_plan(), {"name": "Test Client"}, {"name": "Revival Home Remodeling"})
    assert model["wall"]["height_in"] == 108
    assert "9'" in model["wall"]["height"]
    opening = model["wall"]["opening"]
    assert opening["source"] == "project"
    assert opening["width_in"] == 36
    assert opening["height_in"] == 60
    assert model["foundation"]["type"] == "slab"
    assert model["roof"]["pitch"] == "6/12"
    assert model["roof"]["present"] is True
    assert model["sheets"]["roof"] is True
    assert model["sheets"]["beam"] is True
    assert len(model["beams"]) >= 1


def test_preview_has_no_empty_required_fields():
    preview = public_preview(extract_permit_model(_addition_plan(), {}, {}))
    assert preview["wall_height"]
    assert preview["foundation"]
    assert preview["roof_pitch"]
    assert preview["opening"]["header"]
    assert "cover" in preview["sheets"]


def test_permit_pdf_is_valid_and_multi_page():
    pdf = build_permit_report(_addition_plan(), {"name": "Test Client"}, {"name": "Revival Home Remodeling"})
    assert pdf[:5] == b"%PDF-"
    assert len(pdf) > 4000
    pages = pdf.count(b"/Type /Page")
    assert pages >= 4


def test_permit_pdf_respects_sheet_checklist():
    pdf = build_permit_report(
        _addition_plan(),
        {},
        {},
        {"cover": True, "wall": True, "foundation": False, "roof": False, "beam": False},
    )
    assert pdf[:5] == b"%PDF-"
    pages = pdf.count(b"/Type /Page")
    assert 2 <= pages <= 3
