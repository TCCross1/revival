"""LVL recommendation engine tests."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from lvl_engine import jack_studs_for, needs_beam_for_opening, recommend_lvl


def test_cased_opening_triggers_beam():
    assert needs_beam_for_opening({"type": "cased", "width": 48}) is True
    assert needs_beam_for_opening({"type": "cased", "width": 36}) is False
    assert needs_beam_for_opening({"type": "door", "width": 60}) is True
    assert needs_beam_for_opening({"type": "door", "width": 32}) is False


def test_typical_interior_header_is_conservative_single_or_double():
    rec = recommend_lvl({
        "span_in": 96,
        "tributary_in": 96,
        "wall_kind": "interior",
        "above": "bedroom",
        "stories_above": 1,
    })
    assert rec["plies"] in (1, 2, 3)
    assert rec["depth_in"] >= 7.25
    assert rec["jack_studs"] >= 2
    assert rec["king_studs"] >= 1
    assert rec["loads"]["w_plf"] > 0
    assert "Preliminary" in rec["disclaimer"]
    assert rec["engineer_required"] is False


def test_long_heavy_span_steps_up_plies_or_flags_engineer():
    rec = recommend_lvl({
        "span_in": 216,
        "tributary_in": 192,
        "wall_kind": "exterior",
        "above": "kitchen",
        "stories_above": 2,
    })
    assert rec["plies"] >= 2
    assert rec["jack_studs"] >= 3
    assert rec["width_in"] == rec["plies"] * 1.75


def test_jack_studs_scale_with_span():
    assert jack_studs_for(48, 1, False) == 1
    assert jack_studs_for(120, 1, False) >= 2
    assert jack_studs_for(180, 3, True) >= 4


if __name__ == "__main__":
    test_cased_opening_triggers_beam()
    test_typical_interior_header_is_conservative_single_or_double()
    test_long_heavy_span_steps_up_plies_or_flags_engineer()
    test_jack_studs_scale_with_span()
    print("LVL_ENGINE_OK")
