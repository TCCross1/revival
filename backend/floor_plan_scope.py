"""Quantity, schedule, and finish take-offs from a floor-plan document."""
from __future__ import annotations

from floor_plan import format_ft_in, inches, round2, wall_length, compute_takeoffs
from floor_plan import FLOORING_OPTIONS
from price_book import (
    line_amount, price_appliance, price_bath, price_cabinet, price_counter,
    price_filler, price_flooring, price_light, price_opening, price_row, price_structural,
)

FINISH_NAMES = {
    "": "Natural oak",
    "walnut": "Walnut",
    "white": "Painted white",
    "navy": "Painted navy",
    "stone": "Honed stone",
}
WALL_FINISH_NAMES = {
    "": "Unspecified",
    "paint": "Paint",
    "tile": "Tile",
    "shiplap": "Shiplap",
    "wainscot": "Wainscot",
    "wallpaper": "Wallpaper",
}


def _flooring_name(fid):
    for row in FLOORING_OPTIONS:
        if row["id"] == (fid or "lvp"):
            return row["name"]
    return "LVP"


def _room_name(obj, rooms):
    x = inches(obj.get("x")) + inches(obj.get("width")) / 2.0
    y = inches(obj.get("y")) + inches(obj.get("depth")) / 2.0
    for room in rooms or []:
        if inches(room.get("x")) <= x <= inches(room.get("x")) + inches(room.get("width")) and inches(room.get("y")) <= y <= inches(room.get("y")) + inches(room.get("depth")):
            return room.get("name") or ""
    return ""


def _add(bucket, key, row):
    if key in bucket:
        bucket[key]["quantity"] = round2(bucket[key]["quantity"] + row["quantity"])
        return
    bucket[key] = dict(row)


def build_scope(document: dict) -> dict:
    takeoffs = compute_takeoffs(document or {})
    qty = {}
    cabinets, appliances, lighting, doors, windows, finishes, notes = [], [], [], [], [], [], []
    for level in (document or {}).get("levels") or []:
        rooms = level.get("rooms") or []
        level_name = level.get("name") or "Level"
        for room in rooms:
            sf = round2((inches(room.get("width")) * inches(room.get("depth"))) / 144.0)
            floor_id = room.get("flooring") or "lvp"
            _add(qty, f"floor:{floor_id}:{level_name}", {
                "description": f"{_flooring_name(floor_id)} flooring — {level_name}",
                "quantity": sf,
                "unit": "SF",
                "unit_price": price_flooring(floor_id),
                "group": "Flooring",
            })
            finishes.append({"location": f"{room.get('name') or 'Room'} · {level_name}", "item": "Floor", "finish": _flooring_name(floor_id)})
            if room.get("wall_finish"):
                finishes.append({
                    "location": f"{room.get('name') or 'Room'} · {level_name}",
                    "item": "Walls",
                    "finish": WALL_FINISH_NAMES.get(room.get("wall_finish"), room.get("wall_finish")),
                })
            text = room.get("note") or room.get("notes") or ""
            if text:
                notes.append({"target": room.get("name") or "Room", "text": text, "level": level_name})
        for obj in level.get("objects") or []:
            loc = _room_name(obj, rooms) or level_name
            size = f"{format_ft_in(obj.get('width'))} × {format_ft_in(obj.get('depth'))}"
            tags = obj.get("tags") or []
            oid = str(obj.get("library_id") or "")
            name = obj.get("name") or "Item"
            if "filler" in tags or oid.startswith("filler"):
                finish = FINISH_NAMES.get(obj.get("finish") or "", obj.get("color") or "Natural oak")
                cabinets.append({
                    "name": name, "size": size, "location": loc,
                    "finish": finish,
                    "work": obj.get("work") or "existing",
                    "note": obj.get("note") or "Cabinet filler",
                })
                _add(qty, f"filler:{round2(inches(obj.get('width')))}:{obj.get('finish') or ''}", {
                    "description": f"{name} ({format_ft_in(obj.get('width'))} wide)",
                    "quantity": 1, "unit": "EA",
                    "unit_price": price_filler(obj),
                    "group": "Cabinets",
                })
            elif "countertop" in tags or oid.startswith("counter"):
                _add(qty, f"top:{obj.get('counter_material') or 'quartz'}:{obj.get('width')}x{obj.get('depth')}", {
                    "description": f"{name} · {obj.get('counter_material') or 'quartz'} ({size})",
                    "quantity": round2((inches(obj.get("width")) * inches(obj.get("depth"))) / 144.0),
                    "unit": "SF",
                    "unit_price": price_counter(obj.get("counter_material") or "quartz"),
                    "group": "Countertops",
                })
            elif "cabinet" in tags or oid.startswith("cab-") or oid.startswith("island") or oid.startswith("vanity") or oid.startswith("peninsula"):
                finish = FINISH_NAMES.get(obj.get("finish") or "", obj.get("color") or "Natural oak")
                cabinets.append({
                    "name": name, "size": size, "location": loc,
                    "finish": finish,
                    "work": obj.get("work") or "existing",
                    "note": " · ".join([x for x in (obj.get("door_style"), obj.get("glass"), obj.get("crown")) if x]) or obj.get("note") or "",
                })
                finishes.append({
                    "location": loc,
                    "item": name,
                    "finish": finish,
                })
                _add(qty, f"cab:{oid}:{obj.get('finish') or ''}:{obj.get('door_style') or ''}", {
                    "description": f"{name} ({size}) {obj.get('door_style') or ''} {finish}".strip(),
                    "quantity": 1, "unit": "EA",
                    "unit_price": price_cabinet(obj, oid),
                    "group": "Cabinets",
                })
            elif "appliance" in tags or oid.startswith(("range", "fridge", "dw-", "micro", "washer", "dryer", "disposal")):
                appliances.append({"name": name, "size": size, "location": loc, "note": obj.get("appliance_finish") or obj.get("note") or ""})
                _add(qty, f"app:{oid}:{obj.get('appliance_finish') or ''}", {
                    "description": f"{name} {obj.get('appliance_finish') or ''}".strip(),
                    "quantity": 1, "unit": "EA",
                    "unit_price": price_appliance(oid, obj.get("appliance_finish") or ""),
                    "group": "Appliances",
                })
            elif "light" in tags or "electrical" in tags or oid.startswith("fan-") or oid.startswith("light-"):
                lighting.append({"name": name, "location": loc, "note": obj.get("note") or ""})
                _add(qty, f"lt:{oid}", {
                    "description": name, "quantity": 1, "unit": "EA",
                    "unit_price": price_light(oid),
                    "group": "Lighting / electrical",
                })
            elif "shower" in tags or "tub" in tags or oid.startswith("shower") or oid.startswith("tub"):
                _add(qty, f"bath:{oid}", {
                    "description": f"{name} ({size})", "quantity": 1, "unit": "EA",
                    "unit_price": price_bath(oid),
                    "group": "Bath",
                })
            if obj.get("note"):
                notes.append({"target": name, "text": obj.get("note"), "level": loc})
        for wall in level.get("walls") or []:
            for op in wall.get("openings") or []:
                size = f"{format_ft_in(op.get('width'))} × {format_ft_in(op.get('height') or (48 if op.get('type') == 'window' else 80))}"
                row = {
                    "type": op.get("type"),
                    "style": op.get("style") or "",
                    "size": size,
                    "swing": f"{op.get('swing') or 'left'} / {op.get('direction') or 'in'}" if op.get("type") == "door" else "—",
                    "material": op.get("material") or op.get("style") or "—",
                    "level": level_name,
                }
                if op.get("type") == "window":
                    windows.append(row)
                else:
                    doors.append(row)
                install = "box replacement" if op.get("install") == "replacement" else ("new construction / extension jambs" if op.get("install") == "new-construction" else "")
                _add(qty, f"{op.get('type')}:{op.get('style')}:{op.get('material') or ''}:{op.get('install') or ''}:{op.get('width')}", {
                    "description": f"{(op.get('type') or 'opening').title()} {size} {op.get('style') or ''} {op.get('material') or ''} {install}".strip(),
                    "quantity": 1, "unit": "EA",
                    "unit_price": price_opening(op.get("type") or "window", op.get("style") or "", op.get("material") or "", op.get("install") or ""),
                    "group": "Openings",
                })
            if wall.get("note"):
                notes.append({"target": f"{wall.get('kind')} wall", "text": wall.get("note"), "level": level_name})
        for beam in level.get("beams") or []:
            _add(qty, f"lvl:{beam.get('plies')}:{beam.get('depth_in')}", {
                "description": f"{beam.get('label') or 'LVL'} · {format_ft_in(beam.get('span_in'))} span",
                "quantity": round2(wall_length(beam) / 12.0),
                "unit": "LF",
                "unit_price": price_structural(),
                "group": "Structural",
            })
    line_items = [{
        "description": f"[Plan] {row['description']}",
        "quantity": row["quantity"],
        "unit_price": price_row(row),
        "amount": line_amount(row["quantity"], price_row(row)),
        "unit": row.get("unit") or "EA",
        "group": row.get("group") or "General",
    } for row in qty.values()]
    return {
        "line_items": line_items,
        "cabinets": cabinets,
        "appliances": appliances,
        "lighting": lighting,
        "doors": doors,
        "windows": windows,
        "finishes": finishes,
        "notes": notes,
        "takeoffs": takeoffs,
        "special_order": [i for i in line_items if any(k in i["description"].lower() for k in ("cabinet", "appliance", "lvl", "shower", "range", "fridge", "filler"))],
    }
