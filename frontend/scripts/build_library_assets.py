#!/usr/bin/env python3
"""Crop uploaded catalog/room photos into 1:1 library thumbs and plan sprites."""
from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageEnhance, ImageFilter

SRC = Path("/Users/anthonycross/.cursor/projects/Users-anthonycross-Desktop/assets")
OUT = Path("/Users/anthonycross/revival/frontend/public/library")
THUMBS = OUT / "thumbs"
SPRITES = OUT / "sprites"
MATERIALS = OUT / "materials"
HEROES = OUT / "heroes"
PREVIEW = Path("/tmp/lib-preview/crops")


def src_file(stem: str) -> Path:
    hits = sorted(SRC.glob(f"{stem}*"))
    if not hits:
        raise FileNotFoundError(stem)
    return hits[0]


def load(stem: str) -> Image.Image:
    return Image.open(src_file(stem)).convert("RGB")


def save_jpg(im: Image.Image, path: Path, size=520):
    path.parent.mkdir(parents=True, exist_ok=True)
    out = im.copy()
    out.thumbnail((size, size), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", out.size, (252, 249, 244))
    canvas.paste(out)
    canvas.save(path, "JPEG", quality=90, optimize=True)


def save_png(im: Image.Image, path: Path, size=640, alpha=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    out = im.convert("RGBA")
    out.thumbnail((size, size), Image.Resampling.LANCZOS)
    if alpha:
        px = out.load()
        w, h = out.size
        for y in range(h):
            for x in range(w):
                r, g, b, a = px[x, y]
                if r > 244 and g > 244 and b > 240:
                    px[x, y] = (r, g, b, 0)
    out.save(path, "PNG", optimize=True)


def frac_box(im: Image.Image, box):
    w, h = im.size
    x0, y0, x1, y1 = box
    return im.crop((int(w * x0), int(h * y0), int(w * x1), int(h * y1)))


def trim_product(im: Image.Image, pad=10, min_keep=0.28):
    """Trim near-white padding around a studio product shot."""
    w, h = im.size
    px = im.load()
    minx, miny, maxx, maxy = w, h, 0, 0
    found = False
    for y in range(0, h, 2):
        for x in range(0, w, 2):
            r, g, b = px[x, y]
            if r < 236 or g < 236 or b < 230:
                found = True
                if x < minx:
                    minx = x
                if y < miny:
                    miny = y
                if x > maxx:
                    maxx = x
                if y > maxy:
                    maxy = y
    if not found:
        return im
    minx = max(0, minx - pad)
    miny = max(0, miny - pad)
    maxx = min(w, maxx + pad + 2)
    maxy = min(h, maxy + pad + 2)
    area = (maxx - minx) * (maxy - miny)
    if area < min_keep * w * h:
        return im
    return im.crop((minx, miny, maxx, maxy))


def grid_photos(im, cols, rows, header, footer, left, right, gap_x, gap_y, label, skip=()):
    w, h = im.size
    x0 = int(w * left)
    x1 = int(w * (1 - right))
    y0 = int(h * header)
    y1 = int(h * (1 - footer))
    gw = gap_x * w
    gh = gap_y * h
    cw = (x1 - x0 - gw * (cols - 1)) / cols
    ch = (y1 - y0 - gh * (rows - 1)) / rows
    cells = []
    idx = 0
    for r in range(rows):
        for c in range(cols):
            if idx in skip:
                idx += 1
                continue
            cx = x0 + c * (cw + gw)
            cy = y0 + r * (ch + gh)
            photo_h = ch * (1.0 - label)
            cells.append(im.crop((int(cx + 4), int(cy + 4), int(cx + cw - 4), int(cy + photo_h - 2))))
            idx += 1
    return cells


# Explicit catalog recipes: product photos only, labels/chrome excluded.
CATALOGS = [
    {
        "stem": "IMG_6473",
        "cols": 3, "rows": 4, "header": 0.128, "footer": 0.055,
        "left": 0.055, "right": 0.045, "gap_x": 0.028, "gap_y": 0.018, "label": 0.24,
        "studio": True,
        "ids": [
            "cab-base-24", "cab-base-36", "cab-sink-36",
            "cab-wall-30", "cab-wall-36", "cab-corner-36",
            "island-72", "range-36", "fridge-36",
            "dw-24", "micro-24", "hood-wall-30",
        ],
    },
    {
        "stem": "IMG_6474",
        "cols": 2, "rows": 5, "header": 0.118, "footer": 0.03,
        "left": 0.05, "right": 0.04, "gap_x": 0.03, "gap_y": 0.012, "label": 0.22,
        "studio": False,
        "ids": [
            "vanity-single-36", "vanity-double-60",
            "vanity-float-48", "shower-walk-36",
            "tub-free", "tub-60",
            "toilet", "niche-12",
            "shower-glass-pivot", "mirror-36",
        ],
    },
    {
        "stem": "IMG_6475",
        "cols": 3, "rows": 3, "header": 0.125, "footer": 0.04,
        "left": 0.05, "right": 0.04, "gap_x": 0.028, "gap_y": 0.03, "label": 0.22,
        "studio": True,
        "ids": [
            "range-30", "range-36-front", "fridge-36-front",
            "dw-24-front", "micro-24", "sink-33",
            "hood-wall-30", "hood-island-36", "disposal",
        ],
    },
    {
        "stem": "IMG_6476",
        "cols": 3, "rows": 2, "header": 0.105, "footer": 0.05,
        "left": 0.04, "right": 0.04, "gap_x": 0.025, "gap_y": 0.04, "label": 0.18,
        "studio": False,
        "ids": [
            "cab-finish-white", "cab-finish-navy", "cab-finish-oak",
            "cab-finish-walnut", "cab-finish-gray", "cab-finish-black",
        ],
    },
    {
        "stem": "IMG_6477",
        "cols": 3, "rows": 2, "header": 0.095, "footer": 0.12,
        "left": 0.04, "right": 0.04, "gap_x": 0.022, "gap_y": 0.06, "label": 0.28,
        "studio": False,
        "ids": [
            "island-white-marble", "island-walnut", "island-navy",
            "island-oak", "island-black-waterfall", "island-classic-white",
        ],
    },
    {
        "stem": "IMG_6478",
        "cols": 3, "rows": 2, "header": 0.155, "footer": 0.09,
        "left": 0.04, "right": 0.04, "gap_x": 0.022, "gap_y": 0.05, "label": 0.26,
        "studio": False,
        "ids": [
            "vanity-oak-float", "vanity-walnut-double", "vanity-black-marble",
            "vanity-gray-shaker", "vanity-concrete", "vanity-furniture-36",
        ],
    },
    {
        "stem": "IMG_6479",
        "cols": 3, "rows": 3, "header": 0.155, "footer": 0.04,
        "left": 0.04, "right": 0.04, "gap_x": 0.02, "gap_y": 0.035, "label": 0.26,
        "skip": (7, 8),
        "studio": False,
        "ids": [
            "shower-walk-36", "shower-frameless", "tub-free",
            "tub-black", "tub-60", "tub-japanese",
            "shower-steam",
        ],
    },
    {
        "stem": "IMG_6480",
        "cols": 3, "rows": 3, "header": 0.108, "footer": 0.06,
        "left": 0.045, "right": 0.04, "gap_x": 0.025, "gap_y": 0.04, "label": 0.24,
        "skip": (7, 8),
        "studio": True,
        "ids": [
            "range-30", "range-black-ss", "range-white",
            "fridge-panel", "fridge-36", "dw-24",
            "dw-panel",
        ],
    },
    {
        "stem": "IMG_6481",
        "cols": 3, "rows": 3, "header": 0.105, "footer": 0.06,
        "left": 0.04, "right": 0.04, "gap_x": 0.025, "gap_y": 0.04, "label": 0.26,
        "skip": (7, 8),
        "studio": False,
        "ids": [
            "light-recessed", "light-pendant", "light-linear",
            "light-undercab", "light-chandelier", "light-sconce",
            "light-flush",
        ],
    },
    {
        "stem": "IMG_6482",
        "cols": 3, "rows": 3, "header": 0.12, "footer": 0.05,
        "left": 0.04, "right": 0.04, "gap_x": 0.025, "gap_y": 0.05, "label": 0.28,
        "skip": (7, 8),
        "studio": True,
        "ids": [
            "door-shaker", "door-glass", "door-frosted",
            "door-mullion", "door-slab", "door-beadboard",
            "door-raised",
        ],
    },
    {
        "stem": "IMG_6483",
        "cols": 2, "rows": 3, "header": 0.075, "footer": 0.04,
        "left": 0.045, "right": 0.04, "gap_x": 0.03, "gap_y": 0.04, "label": 0.24,
        "studio": False,
        "ids": [
            "sink-farm-33", "sink-double-33",
            "sink-composite-33", "sink-copper-33",
            "sink-33", "sink-work-36",
        ],
    },
    {
        "stem": "IMG_6484",
        "cols": 4, "rows": 2, "header": 0.14, "footer": 0.06,
        "left": 0.04, "right": 0.04, "gap_x": 0.02, "gap_y": 0.04, "label": 0.16,
        "studio": False,
        "kind": "material",
        "ids": [
            "carrara", "calacatta", "granite-black", "quartz",
            "gray-quartz", "butcher", "concrete", "green-marble",
        ],
    },
    {
        "stem": "IMG_6485",
        "cols": 3, "rows": 3, "header": 0.112, "footer": 0.08,
        "left": 0.04, "right": 0.04, "gap_x": 0.022, "gap_y": 0.04, "label": 0.26,
        "studio": False,
        "ids": [
            "range-36", "cooktop-36", "oven-wall",
            "wine-fridge", "ice-maker", "micro-drawer",
            "hood-wall-30", "hood-island-36", "hood-insert",
        ],
    },
    {
        "stem": "IMG_6486",
        "cols": 4, "rows": 2, "header": 0.155, "footer": 0.08,
        "left": 0.04, "right": 0.04, "gap_x": 0.02, "gap_y": 0.05, "label": 0.28,
        "studio": False,
        "kind": "material",
        "ids": [
            "tile-subway", "tile-porcelain", "tile-hex", "tile-black",
            "tile-herringbone", "tile-penny", "oak", "tile-terrazzo",
        ],
    },
    {
        "stem": "IMG_6487",
        "cols": 2, "rows": 3, "header": 0.09, "footer": 0.12,
        "left": 0.05, "right": 0.04, "gap_x": 0.03, "gap_y": 0.04, "label": 0.32,
        "skip": (5,),
        "studio": False,
        "ids": [
            "shower-frameless", "shower-glass-pivot",
            "shower-glass-slide", "shower-glass-fixed",
            "shower-black-frame",
        ],
    },
    {
        "stem": "IMG_6488",
        "cols": 3, "rows": 3, "header": 0.125, "footer": 0.07,
        "left": 0.035, "right": 0.035, "gap_x": 0.02, "gap_y": 0.035, "label": 0.28,
        "skip": (8,),
        "studio": False,
        "ids": [
            "vanity-oak-float", "vanity-walnut-double", "vanity-furniture-white",
            "vanity-black-modern", "vanity-gray-shaker", "vanity-concrete",
            "vanity-classic", "vanity-midcentury",
        ],
    },
    {
        "stem": "IMG_6490",
        "cols": 2, "rows": 4, "header": 0.09, "footer": 0.03,
        "left": 0.05, "right": 0.04, "gap_x": 0.04, "gap_y": 0.03, "label": 0.28,
        "studio": False,
        "ids": [
            "bench-48", "bench-corner",
            "niche-12", "drain-linear",
            "rain-head", "handheld",
            "niche-mosaic", "niche-steam",
        ],
    },
]

# Irregular 6489 bathroom sinks & faucets.
SINK_FAUCET_BOXES = [
    ("sink-vessel-white", (0.04, 0.175, 0.34, 0.355)),
    ("sink-vessel-black", (0.35, 0.175, 0.65, 0.355)),
    ("sink-undermount-oval", (0.66, 0.175, 0.96, 0.355)),
    ("sink-undermount-rect", (0.04, 0.43, 0.49, 0.60)),
    ("faucet-wall", (0.51, 0.43, 0.96, 0.60)),
    ("faucet-widespread", (0.04, 0.675, 0.34, 0.85)),
    ("faucet-black", (0.35, 0.675, 0.65, 0.85)),
    ("faucet-gold", (0.66, 0.675, 0.96, 0.85)),
]

# Top-down room object crops (plan sprites). Fractions of full image.
PLAN_CROPS = {
    "IMG_6458": [  # white shaker kitchen
        ("island-72", (0.20, 0.38, 0.78, 0.70), False),
        ("island-white-marble", (0.20, 0.38, 0.78, 0.70), False),
        ("island-classic-white", (0.20, 0.38, 0.78, 0.70), False),
        ("range-36", (0.18, 0.05, 0.40, 0.30), False),
        ("fridge-36", (0.04, 0.05, 0.20, 0.34), False),
        ("dw-24", (0.40, 0.05, 0.52, 0.24), False),
        ("sink-33", (0.50, 0.05, 0.70, 0.26), False),
        ("cab-base-36", (0.70, 0.08, 0.92, 0.28), False),
    ],
    "IMG_6459": [  # navy kitchen
        ("island-navy", (0.30, 0.34, 0.70, 0.70), False),
        ("island-walnut", (0.30, 0.34, 0.70, 0.70), False),
        ("sink-farm-33", (0.05, 0.40, 0.22, 0.60), False),
        ("range-30", (0.12, 0.08, 0.34, 0.30), False),
        ("cooktop-36", (0.40, 0.10, 0.62, 0.28), False),
        ("fridge-36", (0.66, 0.07, 0.86, 0.34), False),
        ("cab-finish-navy", (0.05, 0.30, 0.22, 0.72), False),
    ],
    "IMG_6460": [  # dark wood kitchen
        ("island-96", (0.28, 0.34, 0.72, 0.70), False),
        ("range-36", (0.38, 0.08, 0.58, 0.30), False),
        ("fridge-36", (0.70, 0.06, 0.90, 0.38), False),
        ("dw-24", (0.72, 0.40, 0.90, 0.58), False),
        ("sink-double-33", (0.08, 0.10, 0.28, 0.32), False),
        ("cab-finish-walnut", (0.70, 0.38, 0.92, 0.72), False),
    ],
    "IMG_6457": [  # oak open kitchen
        ("island-oak", (0.34, 0.40, 0.62, 0.68), False),
        ("range-36", (0.40, 0.06, 0.56, 0.24), False),
        ("fridge-36", (0.62, 0.38, 0.78, 0.64), False),
        ("sink-double-33", (0.18, 0.32, 0.34, 0.50), False),
        ("washer", (0.02, 0.36, 0.14, 0.52), False),
        ("dryer", (0.02, 0.52, 0.14, 0.68), False),
        ("hood-wall-30", (0.40, 0.00, 0.58, 0.10), False),
    ],
    "IMG_6461": [  # luxury bath
        ("tub-free", (0.28, 0.16, 0.50, 0.54), False),
        ("vanity-double-60", (0.48, 0.48, 0.82, 0.80), False),
        ("shower-frameless", (0.03, 0.08, 0.32, 0.62), False),
        ("toilet", (0.80, 0.56, 0.95, 0.84), False),
        ("cab-tall-24", (0.80, 0.08, 0.95, 0.50), False),
        ("mirror-36", (0.52, 0.42, 0.78, 0.52), False),
        ("light-sconce", (0.48, 0.42, 0.54, 0.58), False),
    ],
    "IMG_6462": [  # modern bath
        ("vanity-float-48", (0.07, 0.22, 0.27, 0.76), False),
        ("vanity-oak-float", (0.07, 0.22, 0.27, 0.76), False),
        ("shower-walk-48", (0.36, 0.04, 0.72, 0.52), False),
        ("tub-free", (0.58, 0.58, 0.90, 0.90), False),
        ("rain-head", (0.48, 0.12, 0.62, 0.28), False),
        ("drain-linear", (0.38, 0.44, 0.70, 0.52), False),
        ("bench-48", (0.38, 0.18, 0.50, 0.32), False),
    ],
}

# Prefer these top-down sprites on the plan (later writes win if overwrite=False first-wins).
SPRITE_PRIORITY = [
    "IMG_6458", "IMG_6459", "IMG_6460", "IMG_6457", "IMG_6461", "IMG_6462",
]


def boost(im: Image.Image) -> Image.Image:
    im = ImageEnhance.Contrast(im).enhance(1.06)
    im = ImageEnhance.Color(im).enhance(1.04)
    im = ImageEnhance.Sharpness(im).enhance(1.12)
    return im.filter(ImageFilter.UnsharpMask(radius=1.1, percent=80, threshold=2))


def main():
    for folder in (THUMBS, SPRITES, MATERIALS, HEROES, PREVIEW):
        folder.mkdir(parents=True, exist_ok=True)

    mapping = {}
    written_thumbs = set()
    written_sprites = set()

    # Heroes: full catalog pages + full room renders.
    hero_map = {
        "IMG_6473": "kitchen-components",
        "IMG_6474": "bath-components",
        "IMG_6475": "appliances",
        "IMG_6476": "cabinets-styles",
        "IMG_6477": "islands",
        "IMG_6478": "vanities-luxury",
        "IMG_6479": "showers-tubs",
        "IMG_6481": "lighting",
        "IMG_6483": "sinks",
        "IMG_6485": "appliances-premium",
        "IMG_6488": "vanities-lib",
        "IMG_6458": "ref-white-kitchen",
        "IMG_6459": "ref-navy-kitchen",
        "IMG_6457": "ref-oak-kitchen",
        "IMG_6460": "ref-walnut-kitchen",
        "IMG_6461": "ref-bath-luxury",
        "IMG_6462": "ref-bath-modern",
    }
    for stem, name in hero_map.items():
        im = load(stem)
        im.resize((960, int(960 * im.size[1] / im.size[0])), Image.Resampling.LANCZOS).save(
            HEROES / f"{name}.jpg", "JPEG", quality=86, optimize=True
        )

    for recipe in CATALOGS:
        im = load(recipe["stem"])
        skip = tuple(recipe.get("skip") or ())
        cells = grid_photos(
            im, recipe["cols"], recipe["rows"], recipe["header"], recipe["footer"],
            recipe["left"], recipe["right"], recipe["gap_x"], recipe["gap_y"],
            recipe["label"], skip,
        )
        ids = recipe["ids"]
        if len(cells) < len(ids):
            print(f"WARN {recipe['stem']}: got {len(cells)} cells for {len(ids)} ids")
        kind = recipe.get("kind", "thumb")
        studio = recipe.get("studio", False)
        for i, item_id in enumerate(ids):
            if i >= len(cells):
                break
            crop = cells[i]
            if studio:
                crop = trim_product(crop)
            crop = boost(crop)
            if kind == "material":
                save_jpg(crop, MATERIALS / f"{item_id}.jpg", size=512)
                mapping.setdefault(item_id, {})["material"] = f"/library/materials/{item_id}.jpg"
            else:
                # First catalog hit wins for thumbs so kitchen-components keeps exact labeled products.
                if item_id not in written_thumbs:
                    save_jpg(crop, THUMBS / f"{item_id}.jpg")
                    written_thumbs.add(item_id)
                    mapping.setdefault(item_id, {})["thumb"] = f"/library/thumbs/{item_id}.jpg"
                    if item_id not in written_sprites:
                        save_png(crop, SPRITES / f"{item_id}.png", alpha=studio)
                        written_sprites.add(item_id)
                        mapping[item_id]["sprite"] = f"/library/sprites/{item_id}.png"
                crop.resize((180, 180), Image.Resampling.LANCZOS).save(
                    PREVIEW / f"{item_id}.jpg", "JPEG", quality=80
                )
        print(f"catalog {recipe['stem']}: {len(ids)} items")

    # 6489 irregular sink/faucet cards
    im = load("IMG_6489")
    for item_id, box in SINK_FAUCET_BOXES:
        crop = boost(trim_product(frac_box(im, box), min_keep=0.18))
        if item_id not in written_thumbs:
            save_jpg(crop, THUMBS / f"{item_id}.jpg")
            written_thumbs.add(item_id)
            mapping.setdefault(item_id, {})["thumb"] = f"/library/thumbs/{item_id}.jpg"
        if item_id not in written_sprites:
            save_png(crop, SPRITES / f"{item_id}.png", alpha=True)
            written_sprites.add(item_id)
            mapping[item_id]["sprite"] = f"/library/sprites/{item_id}.png"
        crop.resize((180, 180), Image.Resampling.LANCZOS).save(PREVIEW / f"{item_id}.jpg", "JPEG", quality=80)
    print("catalog IMG_6489: 8 items")

    # Top-down plan sprites overwrite the placeholder sprite (keep catalog thumb).
    for stem in SPRITE_PRIORITY:
        im = load(stem)
        for item_id, box, studio in PLAN_CROPS[stem]:
            crop = boost(frac_box(im, box))
            save_png(crop, SPRITES / f"{item_id}.png", alpha=False)
            written_sprites.add(item_id)
            mapping.setdefault(item_id, {})["sprite"] = f"/library/sprites/{item_id}.png"
            if "thumb" not in mapping[item_id]:
                save_jpg(crop, THUMBS / f"{item_id}.jpg")
                mapping[item_id]["thumb"] = f"/library/thumbs/{item_id}.jpg"
            crop.resize((180, 180), Image.Resampling.LANCZOS).save(
                PREVIEW / f"plan-{item_id}.jpg", "JPEG", quality=80
            )
        print(f"plan {stem}: {len(PLAN_CROPS[stem])} sprites")

    # Alias extra catalog-only names onto family ids used by the library.
    aliases = {
        "range-36-front": "range-36",
        "fridge-36-front": "fridge-36",
        "dw-24-front": "dw-24",
        "granite-black": "soapstone",
        "gray-quartz": "gray",
        "tile-porcelain": "tile",
        "tile-subway": "white",
    }
    for src_id, dest_id in aliases.items():
        src = mapping.get(src_id) or {}
        if not src:
            continue
        mapping.setdefault(dest_id, {})
        for key in ("thumb", "sprite", "material"):
            if key in src and key not in mapping[dest_id]:
                mapping[dest_id][key] = src[key]

    # Copy common material aliases used by the app.
    material_alias = {
        "marble": "carrara",
        "navy": "cab-finish-navy",
        "black": "cab-finish-black",
        "walnut": "cab-finish-walnut",
        "stainless": "range-36",
        "black-stainless": "range-black-ss",
        "greige": "cab-finish-gray",
    }
    for dest, src_id in material_alias.items():
        src_path = MATERIALS / f"{src_id}.jpg"
        thumb = THUMBS / f"{src_id}.jpg"
        pick = src_path if src_path.exists() else thumb
        if pick.exists():
            Image.open(pick).convert("RGB").save(MATERIALS / f"{dest}.jpg", "JPEG", quality=88)

    (OUT / "asset-map.json").write_text(json.dumps(mapping, indent=2))
    print(f"wrote {len(mapping)} mapped assets")
    print("THUMBS", len(list(THUMBS.glob('*.jpg'))), "SPRITES", len(list(SPRITES.glob('*.png'))))


if __name__ == "__main__":
    main()
