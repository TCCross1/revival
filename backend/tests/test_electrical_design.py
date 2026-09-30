"""Kentucky / NEC electrical design engine tests."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from electrical_design import (
    afci_required,
    bathroom_receptacle_circuit_amps,
    classify_room,
    dimmer_allowed,
    gfci_required,
    kitchen_small_appliance_circuits_required,
    protection_for,
    receptacle_stations,
    switch_kind_for_entries,
    wire_for_amps,
)


def test_room_classification():
    assert classify_room("Kitchen") == "kitchen"
    assert classify_room("Master Bath") == "bath"
    assert classify_room("Hall") == "hallway"
    assert classify_room("Front stairs") == "stair"
    assert classify_room("Garage") == "garage"
    assert classify_room("Bedroom 2") == "bedroom"
    assert classify_room("Great room") == "living"


def test_switching_logic():
    assert switch_kind_for_entries(1) == "switch"
    assert switch_kind_for_entries(2) == "switch-3way"
    assert switch_kind_for_entries(3) == "switch-4way"
    assert switch_kind_for_entries(4) == "switch-4way"


def test_wire_and_breaker_match():
    assert wire_for_amps(15)["awg"] == 14 and wire_for_amps(15)["breaker"] == 15
    assert wire_for_amps(20)["awg"] == 12 and wire_for_amps(20)["breaker"] == 20
    assert wire_for_amps(30)["awg"] == 10 and wire_for_amps(30)["breaker"] == 30
    assert wire_for_amps(40, volts=240)["awg"] == 8
    three = wire_for_amps(15, travelers=True)
    assert "14-3" in three["cable"]


def test_dimmer_never_on_fan_motor():
    assert dimmer_allowed("light-recessed") is True
    assert dimmer_allowed("fan-ceiling") is False
    assert dimmer_allowed("fan-light") is True
    assert dimmer_allowed("switch-fan") is False


def test_gfci_and_afci_locations():
    assert gfci_required("kitchen") is True
    assert gfci_required("bath") is True
    assert gfci_required("laundry") is True
    assert gfci_required("garage") is True
    assert gfci_required("living", near_sink=True) is True
    assert gfci_required("bedroom") is False
    assert afci_required("bedroom") is True
    assert afci_required("living") is True
    assert afci_required("garage") is False
    kit = protection_for("kitchen", "outlet-gfci")
    assert kit["dual"] is True
    assert kit["tamper_resistant"] is True


def test_twelve_foot_and_kitchen_two_foot_rules():
    general = receptacle_stations(168, max_from_any=72, min_wall=24)
    assert general
    assert general[0] <= 72
    assert all(general[i] - general[i - 1] <= 144 + 0.5 for i in range(1, len(general)))
    assert 168 - general[-1] <= 72 + 0.5
    assert receptacle_stations(18) == []
    kitchen = receptacle_stations(96, max_from_any=24, min_wall=12)
    assert kitchen
    assert kitchen[0] <= 24
    assert 96 - kitchen[-1] <= 24 + 0.5


def test_kitchen_and_bath_branch_rules():
    assert kitchen_small_appliance_circuits_required() == 2
    assert bathroom_receptacle_circuit_amps() == 20


if __name__ == "__main__":
    test_room_classification()
    test_switching_logic()
    test_wire_and_breaker_match()
    test_dimmer_never_on_fan_motor()
    test_gfci_and_afci_locations()
    test_twelve_foot_and_kitchen_two_foot_rules()
    test_kitchen_and_bath_branch_rules()
    print("ELECTRICAL_DESIGN_OK")
