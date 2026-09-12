"""Keep JS and Python shop prices and catalog IDs from drifting."""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from floor_plan import catalog
from price_book import APPLIANCES, COUNTERTOPS, FLOORING, GROUP_DEFAULTS

ROOT = Path(__file__).resolve().parents[2]
FRONTEND_PRICES = ROOT / "frontend" / "src" / "lib" / "floorPlan" / "shopPrices.json"
BACKEND_PRICES = ROOT / "backend" / "data" / "shop_prices.json"
LIBRARY_JS = ROOT / "frontend" / "src" / "lib" / "floorPlan" / "library.js"


def test_python_loads_the_shared_shop_prices():
    frontend = json.loads(FRONTEND_PRICES.read_text())
    assert FLOORING == frontend["flooring"]
    assert COUNTERTOPS == frontend["countertops"]
    assert APPLIANCES == frontend["appliances"]
    assert GROUP_DEFAULTS["Cabinets"] == frontend["group_defaults"]["Cabinets"]
    assert "concrete" in COUNTERTOPS
    assert "fridge-panel" in APPLIANCES
    if BACKEND_PRICES.exists():
        assert json.loads(BACKEND_PRICES.read_text()) == frontend


def test_python_catalog_ids_are_unique():
    ids = [row["id"] for row in catalog()]
    assert ids
    assert len(ids) == len(set(ids))


def test_frontend_library_covers_backend_catalog_ids():
    text = LIBRARY_JS.read_text()
    explicit = set(re.findall(r'item\(\s*"[^"]+"\s*,\s*"[^"]+"\s*,\s*"([^"]+)"', text))
    prefixes = re.findall(r'sized\(\s*"[^"]+"\s*,\s*"[^"]+"\s*,\s*"([^"]+)"', text)
    prefixes += re.findall(r"`([a-z0-9-]+)-\$\{w\}`", text)
    missing = []
    for row in catalog():
        item_id = row["id"]
        if item_id in explicit:
            continue
        if any(item_id == prefix or item_id.startswith(f"{prefix}-") for prefix in prefixes):
            continue
        missing.append(item_id)
    assert missing == [], f"Backend catalog IDs missing from library.js: {missing[:20]}"
