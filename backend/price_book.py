"""Shop-default installed prices for Revival Pro takeoffs (KY remodeler ballpark)."""
from __future__ import annotations

from floor_plan import inches, round2

FLOORING = {
    "lvp": 5.25,
    "tile": 9.50,
    "carpet": 4.25,
    "engineered_hardwood": 8.75,
    "solid_hardwood": 11.50,
}
COUNTERTOPS = {
    "quartz": 78.0,
    "granite": 68.0,
    "marble": 95.0,
    "formica": 28.0,
    "butcher": 42.0,
    "solid": 55.0,
    "soapstone": 88.0,
}
APPLIANCES = {
    "range-30": 1299.0,
    "range-36": 1899.0,
    "fridge-36": 2199.0,
    "dw-24": 649.0,
    "micro-24": 329.0,
    "washer": 799.0,
    "dryer": 749.0,
    "disposal": 189.0,
    "sink-33": 425.0,
}
LIGHTING = {
    "light-recessed": 85.0,
    "light-flush": 72.0,
    "light-layout": 85.0,
    "light-pendant": 145.0,
    "light-chandelier": 420.0,
    "light-vanity": 165.0,
    "light-sconce": 95.0,
    "light-undercab": 48.0,
    "fan-ceiling": 285.0,
    "fan-light": 345.0,
}
WINDOW_MATERIALS = {
    "vinyl": 425.0,
    "vinyl-clad": 545.0,
    "wood": 685.0,
    "aluminum-clad": 625.0,
}
DOOR_STYLES = {
    "six-panel": 285.0,
    "flush": 195.0,
    "french": 890.0,
    "sliding": 780.0,
    "bi-fold": 240.0,
    "pocket": 410.0,
}
GROUP_DEFAULTS = {
    "Flooring": 5.25,
    "Cabinets": 420.0,
    "Countertops": 78.0,
    "Appliances": 899.0,
    "Lighting / electrical": 85.0,
    "Openings": 385.0,
    "Bath": 1650.0,
    "Structural": 28.0,
    "General": 125.0,
}


def _width(obj) -> float:
    try:
        return max(inches((obj or {}).get("width") or 24), 6.0)
    except Exception:
        return 24.0


def price_filler(obj: dict | None = None) -> float:
    try:
        width = max(inches((obj or {}).get("width") or 3), 0.5)
    except Exception:
        width = 3.0
    return round2(max(28.0, width * 9.5))


def price_cabinet(obj: dict | None = None, library_id: str = "") -> float:
    oid = str(library_id or (obj or {}).get("library_id") or "")
    tags = (obj or {}).get("tags") or []
    if oid.startswith("filler") or "filler" in tags:
        return price_filler(obj)
    width = _width(obj)
    if "corner" in oid:
        base = 785.0
    elif "tall" in oid or "pantry" in oid or "micro" in oid:
        base = round2(width * 16.0)
    elif "wall" in oid:
        base = round2(width * 9.75)
    elif "island" in oid or "peninsula" in oid:
        base = round2(width * 14.0)
    elif "vanity" in oid:
        base = round2(width * 18.0)
    else:
        base = round2(width * 11.5)
    if (obj or {}).get("glass"):
        base = round2(base * 1.15)
    if (obj or {}).get("crown"):
        base = round2(base + 45.0)
    return base


def price_appliance(library_id: str = "", finish: str = "") -> float:
    base = APPLIANCES.get(library_id) or GROUP_DEFAULTS["Appliances"]
    if finish == "panel":
        return round2(base + 400.0)
    if finish == "black-stainless":
        return round2(base + 120.0)
    return float(base)


def price_flooring(floor_id: str = "") -> float:
    return float(FLOORING.get(floor_id or "lvp") or FLOORING["lvp"])


def price_counter(material: str = "") -> float:
    return float(COUNTERTOPS.get(material or "quartz") or COUNTERTOPS["quartz"])


def price_light(library_id: str = "") -> float:
    return float(LIGHTING.get(library_id) or GROUP_DEFAULTS["Lighting / electrical"])


def price_opening(kind: str = "window", style: str = "", material: str = "", install: str = "") -> float:
    if kind == "window":
        base = WINDOW_MATERIALS.get(material or "vinyl") or WINDOW_MATERIALS["vinyl"]
        if install == "replacement":
            return round2(base - 40.0)
        return float(base)
    if kind == "cased":
        return 265.0
    return float(DOOR_STYLES.get(style or "six-panel") or DOOR_STYLES["six-panel"])


def price_bath(library_id: str = "") -> float:
    oid = str(library_id or "")
    if "shower" in oid:
        return 2850.0
    if "tub" in oid:
        return 1650.0
    if "vanity" in oid:
        return 980.0
    if "toilet" in oid:
        return 425.0
    return float(GROUP_DEFAULTS["Bath"])


def price_structural() -> float:
    return float(GROUP_DEFAULTS["Structural"])


def price_row(row: dict) -> float:
    """Fallback if a takeoff row was built without a unit price."""
    try:
        existing = float(row.get("unit_price") or 0)
    except (TypeError, ValueError):
        existing = 0.0
    if existing > 0:
        return round2(existing)
    group = row.get("group") or "General"
    return float(GROUP_DEFAULTS.get(group) or GROUP_DEFAULTS["General"])


def line_amount(quantity, unit_price) -> float:
    try:
        return round2(float(quantity or 0) * float(unit_price or 0))
    except (TypeError, ValueError):
        return 0.0
