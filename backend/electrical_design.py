"""Kentucky / NEC dwelling electrical rules used by Floor Plan Studio.

Mirrors frontend/src/lib/floorPlan/electricalDesign.js for the code engine.
This module never logs addresses or secrets.
"""
from __future__ import annotations

import re

KY_NOTE = (
    "Kentucky adopts the NEC through the Kentucky Building Code. "
    "Revival Pro defaults to the more protective current dwelling-unit requirements."
)

HABITABLE = {"kitchen", "bath", "bedroom", "living", "hallway", "dining", "office"}


def classify_room(name: str = "", project_type: str = "") -> str:
    n = f"{name} {project_type}".lower()
    if re.search(r"kitchen|pantry|butlers?", n):
        return "kitchen"
    if re.search(r"bath|powder|toilet", n):
        return "bath"
    if re.search(r"laundry|mud", n):
        return "laundry"
    if re.search(r"garage", n):
        return "garage"
    if re.search(r"closet|wardrobe", n):
        return "closet"
    if re.search(r"hall|corridor|foyer", n):
        return "hallway"
    if re.search(r"stair", n):
        return "stair"
    if re.search(r"bed", n):
        return "bedroom"
    if re.search(r"unfinished|crawl|basement", n):
        return "basement"
    if re.search(r"outdoor|patio|deck|porch|exterior", n):
        return "outdoor"
    if re.search(r"dining", n):
        return "dining"
    if re.search(r"office|den|study", n):
        return "office"
    if re.search(r"living|great|family|nook|hearth", n):
        return "living"
    if re.search(r"util|mech|mechanical", n):
        return "utility"
    return "living"


def switch_kind_for_entries(entry_count) -> str:
    n = max(0, int(entry_count or 0))
    if n <= 1:
        return "switch"
    if n == 2:
        return "switch-3way"
    return "switch-4way"


def wire_for_amps(amps, travelers: bool = False, volts: int = 120) -> dict:
    a = float(amps or 15)
    v = int(volts or 120)
    if a <= 15:
        return {"amps": 15, "awg": 14, "breaker": 15, "cable": "14-3 NM-B" if travelers else "14-2 NM-B", "volts": v}
    if a <= 20:
        return {"amps": 20, "awg": 12, "breaker": 20, "cable": "12-3 NM-B" if travelers else "12-2 NM-B", "volts": v}
    if a <= 30:
        return {"amps": 30, "awg": 10, "breaker": 30, "cable": "10-3 NM-B" if v >= 240 else "10-2 NM-B", "volts": v}
    if a <= 40:
        return {"amps": 40, "awg": 8, "breaker": 40, "cable": "8-3 copper", "volts": v}
    if a <= 50:
        return {"amps": 50, "awg": 6, "breaker": 50, "cable": "6-3 copper", "volts": v}
    return {"amps": int(a), "awg": 4, "breaker": int(a), "cable": "per nameplate / load calculation", "volts": v}


def dimmer_allowed(library_id: str) -> bool:
    lid = str(library_id or "")
    if lid.startswith("fan-") and lid != "fan-light":
        return False
    if lid == "fan-ceiling":
        return False
    if lid.startswith("switch-fan"):
        return False
    return lid.startswith("light-") or lid == "fan-light"


def gfci_required(kind: str, near_sink: bool = False, outdoor: bool = False) -> bool:
    if near_sink or outdoor:
        return True
    return kind in {"kitchen", "bath", "laundry", "garage", "basement", "outdoor", "utility"}


def afci_required(kind: str) -> bool:
    return kind not in {"garage", "outdoor"}


def receptacle_stations(length_in, max_from_any: float = 72, min_wall: float = 24) -> list:
    length = float(length_in or 0)
    if length < min_wall:
        return []
    max_spacing = max_from_any * 2
    first = min(max_from_any, length / 2)
    pts = [round(first, 2)]
    x = first
    guard = 0
    while length - x > max_from_any + 0.5 and guard < 40:
        guard += 1
        nxt = x + max_spacing
        end_cover = length - min(max_from_any, length / 2)
        x = round(min(nxt, end_cover), 2)
        if x - pts[-1] < 8:
            break
        pts.append(x)
    if length - pts[-1] > max_from_any + 0.5:
        pts.append(round(length - min(max_from_any, length / 2), 2))
    return pts


def protection_for(kind: str, library_id: str = "") -> dict:
    lid = str(library_id or "")
    gfci = gfci_required(kind) or "gfci" in lid
    afci = afci_required(kind)
    dual = gfci and afci
    if dual:
        label = "Dual-function CAFCI/GFCI"
    elif gfci:
        label = "GFCI"
    elif afci:
        label = "Combination AFCI"
    else:
        label = "Standard"
    return {"gfci": gfci, "afci": afci, "dual": dual, "label": label, "tamper_resistant": lid.startswith("outlet") and "240" not in lid}


def kitchen_small_appliance_circuits_required() -> int:
    return 2


def bathroom_receptacle_circuit_amps() -> int:
    return 20
