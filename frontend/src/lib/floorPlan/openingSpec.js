import { inches, round2 } from "./units";

/**
 * Shared wall-opening specification helpers.
 * Plan symbols keep type: "door" | "window" | "cased".
 * Product category drives which details modal / RO profile is used.
 */

export const OPENING_CATEGORY = {
  EXTERIOR_DOOR: "exterior-door",
  INTERIOR_DOOR: "interior-door",
  WINDOW: "window",
  CASED: "cased",
};

/** Exterior hinged door (approved): +1.5" W / +2" H */
export const EXTERIOR_DOOR_RO = { widthAdd: 1.5, heightAdd: 2 };

/** Standard hinged interior door profile (distinct from exterior). */
export const INTERIOR_HINGED_RO = { widthAdd: 2, heightAdd: 2.5 };

/** Generic window profile when no manufacturer data exists. */
export const WINDOW_GENERIC_RO = { widthAdd: 1, heightAdd: 1 };

export const INTERIOR_OPERATION_TYPES = [
  { id: "hinged", name: "Hinged" },
  { id: "pocket", name: "Pocket" },
  { id: "bifold", name: "Bifold" },
  { id: "bypass", name: "Bypass / Sliding" },
  { id: "barn", name: "Barn" },
  { id: "french", name: "French Pair" },
];

export const INTERIOR_CONSTRUCTIONS = [
  { id: "hollow-core", name: "Hollow Core" },
  { id: "solid-core", name: "Solid Core" },
  { id: "solid-wood", name: "Solid Wood" },
  { id: "mdf-composite", name: "MDF / Composite" },
];

export const INTERIOR_DOOR_MATERIALS = [
  { id: "wood", name: "Wood" },
  { id: "painted-composite", name: "Painted Composite" },
  { id: "solid-wood", name: "Solid Wood" },
  { id: "mdf", name: "MDF" },
];

export const WINDOW_TYPES = [
  { id: "single-hung", name: "Single Hung" },
  { id: "double-hung", name: "Double Hung" },
  { id: "casement", name: "Casement" },
  { id: "awning", name: "Awning" },
  { id: "slider", name: "Slider" },
  { id: "fixed", name: "Fixed / Picture" },
  { id: "bay", name: "Bay" },
  { id: "bow", name: "Bow" },
  { id: "hopper", name: "Hopper" },
  { id: "garden", name: "Garden" },
  { id: "specialty", name: "Specialty / Custom" },
];

export const WINDOW_MATERIALS = [
  { id: "vinyl", name: "Vinyl" },
  { id: "fiberglass", name: "Fiberglass" },
  { id: "wood", name: "Wood" },
  { id: "aluminum", name: "Aluminum" },
  { id: "wood-clad", name: "Wood-Clad" },
  { id: "composite", name: "Composite" },
];

export const WINDOW_GRID_PATTERNS = [
  { id: "none", name: "No Grid" },
  { id: "colonial", name: "Colonial" },
  { id: "prairie", name: "Prairie" },
  { id: "craftsman", name: "Craftsman" },
  { id: "custom", name: "Custom" },
];

export function classifyOpening(opening, hostWall) {
  if (!opening) return OPENING_CATEGORY.CASED;
  if (opening.type === "window") return OPENING_CATEGORY.WINDOW;
  if (opening.type === "cased") return OPENING_CATEGORY.CASED;
  if (opening.type === "door") {
    if (opening.opening_category === OPENING_CATEGORY.INTERIOR_DOOR) return OPENING_CATEGORY.INTERIOR_DOOR;
    if (opening.opening_category === OPENING_CATEGORY.EXTERIOR_DOOR) return OPENING_CATEGORY.EXTERIOR_DOOR;
    if (opening.exterior === false) return OPENING_CATEGORY.INTERIOR_DOOR;
    if (opening.exterior === true) return OPENING_CATEGORY.EXTERIOR_DOOR;
    if (hostWall?.kind === "interior") return OPENING_CATEGORY.INTERIOR_DOOR;
    return OPENING_CATEGORY.EXTERIOR_DOOR;
  }
  return OPENING_CATEGORY.CASED;
}

export function roughOpeningProfile(category, opening = {}) {
  if (category === OPENING_CATEGORY.EXTERIOR_DOOR) return EXTERIOR_DOOR_RO;
  if (category === OPENING_CATEGORY.WINDOW) return WINDOW_GENERIC_RO;
  if (category === OPENING_CATEGORY.INTERIOR_DOOR) {
    const op = opening.operation_type || opening.operationType || "hinged";
    if (op === "pocket") return { widthAdd: 1, heightAdd: 2 };
    if (op === "bifold" || op === "bypass") return { widthAdd: 1.5, heightAdd: 2 };
    if (op === "barn") return { widthAdd: 0.5, heightAdd: 1 };
    return INTERIOR_HINGED_RO;
  }
  return { widthAdd: 1, heightAdd: 1 };
}

export function computeAutoRoughOpening(widthIn, heightIn, category, opening = {}) {
  const profile = roughOpeningProfile(category, opening);
  return {
    width: round2(inches(widthIn) + profile.widthAdd),
    height: round2(inches(heightIn) + profile.heightAdd),
    profile,
  };
}

export function applyCategoryAutoRoughOpening(spec, category) {
  const auto = computeAutoRoughOpening(spec.width, spec.height, category, spec);
  return {
    ...spec,
    rough_opening_mode: "auto",
    rough_opening_width: auto.width,
    rough_opening_height: auto.height,
  };
}

export function syncCategoryRoughOpening(spec, nextWidth, nextHeight, category) {
  const width = Math.max(12, inches(nextWidth));
  const height = Math.max(12, inches(nextHeight));
  const next = { ...spec, width: round2(width), height: round2(height) };
  if (next.rough_opening_mode === "manual" || next.rough_opening_mode === "manufacturer") {
    return next;
  }
  const auto = computeAutoRoughOpening(width, height, category, next);
  next.rough_opening_width = auto.width;
  next.rough_opening_height = auto.height;
  return next;
}

/** Normalize window product fields while preserving legacy style/install. */
export function normalizeWindowSpec(opening = {}) {
  const width = Math.max(12, inches(opening.width) || 36);
  const height = Math.max(12, inches(opening.height) || 48);
  const category = OPENING_CATEGORY.WINDOW;
  const mode = ["manual", "manufacturer"].includes(opening.rough_opening_mode)
    ? opening.rough_opening_mode
    : "auto";
  const auto = computeAutoRoughOpening(width, height, category, opening);
  const styleRaw = String(opening.style || opening.window_type || "double-hung");
  const typeMap = {
    "double-hung": "double-hung",
    "single-hung": "single-hung",
    casement: "casement",
    awning: "awning",
    slider: "slider",
    picture: "fixed",
    fixed: "fixed",
    bay: "bay",
    bow: "bow",
    hopper: "hopper",
    garden: "garden",
    specialty: "specialty",
  };
  const windowType = typeMap[styleRaw] || opening.window_type || "double-hung";
  const material = WINDOW_MATERIALS.some((m) => m.id === opening.material)
    ? opening.material
    : "vinyl";

  return {
    ...opening,
    type: "window",
    opening_category: category,
    width: round2(width),
    height: round2(height),
    style: windowType === "fixed" ? "picture" : windowType,
    window_type: windowType,
    material,
    install: opening.install || "new-construction",
    sill: inches(opening.sill) || 24,
    sill_height_above_floor: inches(opening.sill_height_above_floor ?? opening.sill) || 36,
    glass: {
      paneCount: Number(opening.glass?.paneCount) || 2,
      lowE: opening.glass?.lowE !== false,
      tempered: Boolean(opening.glass?.tempered),
      laminated: Boolean(opening.glass?.laminated),
      obscured: Boolean(opening.glass?.obscured),
      gridPattern: opening.glass?.gridPattern || opening.grid_pattern || "none",
    },
    grid_pattern: opening.glass?.gridPattern || opening.grid_pattern || "none",
    operation: opening.operation || defaultWindowOperation(windowType),
    rough_opening_mode: mode,
    rough_opening_width: mode !== "auto" && inches(opening.rough_opening_width) > 0
      ? round2(inches(opening.rough_opening_width))
      : auto.width,
    rough_opening_height: mode !== "auto" && inches(opening.rough_opening_height) > 0
      ? round2(inches(opening.rough_opening_height))
      : auto.height,
  };
}

function defaultWindowOperation(windowType) {
  if (windowType === "casement") return { hinge: "left", label: "Left-hinged casement" };
  if (windowType === "slider") return { configuration: "XO", label: "XO slider" };
  if (windowType === "awning") return { label: "Awning — bottom swings out" };
  if (windowType === "hopper") return { label: "Hopper — top swings in" };
  if (windowType === "fixed") return { label: "Fixed / non-operable" };
  if (windowType === "single-hung") return { label: "Single hung — lower sash operable" };
  return { label: "Double hung — upper & lower sash" };
}

export function windowSpecToOpeningPatch(spec) {
  const n = normalizeWindowSpec(spec);
  return {
    type: "window",
    opening_category: OPENING_CATEGORY.WINDOW,
    width: n.width,
    height: n.height,
    style: n.style,
    window_type: n.window_type,
    material: n.material,
    install: n.install,
    sill: n.sill,
    sill_height_above_floor: n.sill_height_above_floor,
    glass: { ...n.glass },
    grid_pattern: n.grid_pattern,
    operation: n.operation,
    rough_opening_mode: n.rough_opening_mode,
    rough_opening_width: n.rough_opening_width,
    rough_opening_height: n.rough_opening_height,
  };
}

export function normalizeInteriorDoorSpec(opening = {}) {
  const width = Math.max(12, inches(opening.width) || 30);
  const height = Math.max(24, inches(opening.height) || 80);
  const category = OPENING_CATEGORY.INTERIOR_DOOR;
  const mode = ["manual", "manufacturer"].includes(opening.rough_opening_mode)
    ? opening.rough_opening_mode
    : "auto";
  const operationType = opening.operation_type || opening.operationType || "hinged";
  const auto = computeAutoRoughOpening(width, height, category, { ...opening, operation_type: operationType });
  const material = INTERIOR_DOOR_MATERIALS.some((m) => m.id === opening.material)
    ? opening.material
    : (opening.door_material === "wood" ? "wood" : "painted-composite");
  const construction = INTERIOR_CONSTRUCTIONS.some((c) => c.id === opening.construction)
    ? opening.construction
    : "hollow-core";
  const styleRaw = String(opening.style || "six-panel");
  const style = ["flush", "two-panel", "four-panel", "six-panel", "shaker", "craftsman", "french", "modern", "half-lite", "full-lite"].includes(styleRaw)
    ? styleRaw
    : "six-panel";
  const handing = opening.handing === "right" || opening.swing === "right" ? "right" : "left";
  const swingDirection = opening.swingDirection === "outswing" || opening.direction === "out" ? "outswing" : "inswing";
  const boreCount = Number.isFinite(Number(opening.bore_count))
    ? Math.max(0, Math.min(2, Math.round(Number(opening.bore_count))))
    : 1;
  const hingeCount = Number.isFinite(Number(opening.hinges?.count))
    ? Math.max(2, Math.min(5, Math.round(Number(opening.hinges.count))))
    : 3;

  return {
    ...opening,
    type: "door",
    opening_category: category,
    exterior: false,
    width: round2(width),
    height: round2(height),
    operation_type: operationType,
    construction,
    material,
    door_material: material,
    style,
    swing: handing,
    direction: swingDirection === "outswing" ? "out" : "in",
    swingDirection,
    handing,
    bore_count: boreCount,
    hinges: {
      count: hingeCount,
      width: inches(opening.hinges?.width) || 3.5,
      height: inches(opening.hinges?.height) || 3.5,
      type: opening.hinges?.type || "standard-butt",
    },
    rough_opening_mode: mode,
    rough_opening_width: mode !== "auto" && inches(opening.rough_opening_width) > 0
      ? round2(inches(opening.rough_opening_width))
      : auto.width,
    rough_opening_height: mode !== "auto" && inches(opening.rough_opening_height) > 0
      ? round2(inches(opening.rough_opening_height))
      : auto.height,
  };
}

export function interiorDoorSpecToOpeningPatch(spec) {
  const n = normalizeInteriorDoorSpec(spec);
  return {
    type: "door",
    opening_category: OPENING_CATEGORY.INTERIOR_DOOR,
    exterior: false,
    width: n.width,
    height: n.height,
    operation_type: n.operation_type,
    construction: n.construction,
    material: n.material,
    door_material: n.material,
    style: n.style,
    swing: n.handing,
    direction: n.swingDirection === "outswing" ? "out" : "in",
    bore_count: n.bore_count,
    hinges: { ...n.hinges },
    rough_opening_mode: n.rough_opening_mode,
    rough_opening_width: n.rough_opening_width,
    rough_opening_height: n.rough_opening_height,
    leafs: n.operation_type === "french" || n.style === "french" ? 2 : 1,
  };
}
