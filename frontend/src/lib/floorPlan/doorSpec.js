import { inches, round2 } from "./units";
import {
  OPENING_CATEGORY,
  EXTERIOR_DOOR_RO,
} from "./openingSpec";

/** @deprecated Prefer EXTERIOR_DOOR_RO — kept for existing exterior-door tests. */
export const RO_WIDTH_ADD_IN = EXTERIOR_DOOR_RO.widthAdd;
export const RO_HEIGHT_ADD_IN = EXTERIOR_DOOR_RO.heightAdd;

export const DOOR_MATERIALS = [
  { id: "steel", name: "Steel" },
  { id: "fiberglass", name: "Fiberglass" },
  { id: "wood", name: "Wood" },
  { id: "solid-core-wood", name: "Solid-Core Wood" },
];

export const DOOR_PANEL_STYLES = [
  { id: "flush", name: "Flush" },
  { id: "two-panel", name: "2 Panel" },
  { id: "four-panel", name: "4 Panel" },
  { id: "six-panel", name: "6 Panel" },
  { id: "craftsman", name: "Craftsman" },
  { id: "shaker", name: "Shaker" },
  { id: "half-lite", name: "Half Lite" },
  { id: "full-lite", name: "Full Lite" },
  { id: "french", name: "French" },
  { id: "modern", name: "Modern Slab" },
];

export const HINGE_TYPES = [
  { id: "standard-butt", name: "Standard Butt Hinge" },
  { id: "ball-bearing", name: "Ball Bearing" },
  { id: "heavy-duty-ball-bearing", name: "Heavy-Duty Ball Bearing" },
  { id: "spring", name: "Spring Hinge" },
  { id: "concealed", name: "Concealed Hinge" },
];

export function defaultRoughOpening(widthIn, heightIn) {
  return {
    width: round2(inches(widthIn) + EXTERIOR_DOOR_RO.widthAdd),
    height: round2(inches(heightIn) + EXTERIOR_DOOR_RO.heightAdd),
  };
}

export function defaultHingeCount(heightIn) {
  return inches(heightIn) >= 96 ? 4 : 3;
}

export function defaultBores(boreCount = 2) {
  const n = Math.max(0, Math.min(2, Math.round(Number(boreCount) || 0)));
  if (n <= 0) return [];
  if (n === 1) {
    return [{ type: "lockset", diameter: 2.125, centerHeight: 36 }];
  }
  return [
    { type: "lockset", diameter: 2.125, centerHeight: 36 },
    { type: "deadbolt", diameter: 2.125, centerHeight: 44 },
  ];
}

/** Normalize legacy opening fields into a full door specification. */
export function normalizeDoorSpec(opening = {}) {
  const width = Math.max(12, inches(opening.width) || 32);
  const height = Math.max(24, inches(opening.height) || 80);
  const mode = opening.rough_opening_mode === "manual" ? "manual" : "auto";
  const auto = defaultRoughOpening(width, height);
  const material = ["steel", "fiberglass", "wood", "solid-core-wood"].includes(opening.material)
    ? opening.material
    : (opening.door_material || "fiberglass");
  const styleRaw = String(opening.style || "six-panel");
  const styleMap = {
    "six-panel": "six-panel",
    six_panel: "six-panel",
    flush: "flush",
    french: "french",
    "two-panel": "two-panel",
    "2-panel": "two-panel",
    "four-panel": "four-panel",
    "4-panel": "four-panel",
    craftsman: "craftsman",
    shaker: "shaker",
    "half-lite": "half-lite",
    "full-lite": "full-lite",
    modern: "modern",
    sliding: "flush",
    "bi-fold": "flush",
    pocket: "flush",
  };
  const style = styleMap[styleRaw] || "six-panel";
  const boreCount = Number.isFinite(Number(opening.bore_count))
    ? Math.max(0, Math.min(2, Math.round(Number(opening.bore_count))))
    : 2;
  const hingeCount = Number.isFinite(Number(opening.hinges?.count ?? opening.hinge_count))
    ? Math.max(2, Math.min(5, Math.round(Number(opening.hinges?.count ?? opening.hinge_count))))
    : defaultHingeCount(height);
  const hingeType = opening.hinges?.type || opening.hinge_type || "ball-bearing";
  const hingeW = inches(opening.hinges?.width ?? opening.hinge_width ?? 4) || 4;
  const hingeH = inches(opening.hinges?.height ?? opening.hinge_height ?? 4) || 4;

  const handing = opening.handing === "right" || opening.swing === "right" ? "right" : "left";
  const swingDirection = opening.swingDirection === "outswing" || opening.direction === "out"
    ? "outswing"
    : "inswing";

  return {
    ...opening,
    type: "door",
    opening_category: OPENING_CATEGORY.EXTERIOR_DOOR,
    width: round2(width),
    height: round2(height),
    material,
    door_material: material,
    construction: opening.construction
      || (material === "solid-core-wood" ? "solid-core" : material === "steel" || material === "fiberglass" ? "insulated-exterior" : "solid-wood"),
    style,
    swing: handing,
    direction: swingDirection === "outswing" ? "out" : "in",
    swingDirection,
    handing,
    bore_count: boreCount,
    bores: Array.isArray(opening.bores) && opening.bores.length ? opening.bores : defaultBores(boreCount),
    hinges: {
      count: hingeCount,
      width: hingeW,
      height: hingeH,
      type: HINGE_TYPES.some((h) => h.id === hingeType) ? hingeType : "ball-bearing",
    },
    rough_opening_mode: mode,
    rough_opening_width: mode === "manual" && inches(opening.rough_opening_width) > 0
      ? round2(inches(opening.rough_opening_width))
      : auto.width,
    rough_opening_height: mode === "manual" && inches(opening.rough_opening_height) > 0
      ? round2(inches(opening.rough_opening_height))
      : auto.height,
    exterior: true,
  };
}

export function applyAutoRoughOpening(spec) {
  const auto = defaultRoughOpening(spec.width, spec.height);
  return {
    ...spec,
    rough_opening_mode: "auto",
    rough_opening_width: auto.width,
    rough_opening_height: auto.height,
  };
}

export function syncRoughOpeningOnSizeChange(spec, nextWidth, nextHeight) {
  const width = Math.max(12, inches(nextWidth));
  const height = Math.max(24, inches(nextHeight));
  const next = { ...spec, width: round2(width), height: round2(height) };
  if (next.rough_opening_mode !== "manual") {
    const auto = defaultRoughOpening(width, height);
    next.rough_opening_width = auto.width;
    next.rough_opening_height = auto.height;
  }
  return next;
}

export function swingLabel(spec) {
  const hand = (spec.handing || spec.swing) === "right" ? "Right-Hand" : "Left-Hand";
  const swing = (spec.swingDirection || (spec.direction === "out" ? "outswing" : "inswing")) === "outswing"
    ? "Outswing"
    : "Inswing";
  return `${hand} ${swing}`;
}

/** Commit modal draft fields onto a wall opening (canonical stored shape). */
export function doorSpecToOpeningPatch(spec) {
  const normalized = normalizeDoorSpec(spec);
  return {
    type: "door",
    opening_category: OPENING_CATEGORY.EXTERIOR_DOOR,
    exterior: true,
    width: normalized.width,
    height: normalized.height,
    style: normalized.style,
    material: normalized.material,
    door_material: normalized.material,
    construction: normalized.construction,
    swing: normalized.handing === "right" ? "right" : "left",
    direction: normalized.swingDirection === "outswing" ? "out" : "in",
    bore_count: normalized.bore_count,
    bores: defaultBores(normalized.bore_count),
    hinges: { ...normalized.hinges },
    rough_opening_mode: normalized.rough_opening_mode,
    rough_opening_width: round2(normalized.rough_opening_width),
    rough_opening_height: round2(normalized.rough_opening_height),
    leafs: normalized.style === "french" ? 2 : (normalized.leafs || 1),
    lites: ["half-lite", "full-lite", "french"].includes(normalized.style)
      ? Math.max(Number(normalized.lites) || 0, normalized.style === "french" ? 4 : 1)
      : (normalized.lites || 0),
  };
}
