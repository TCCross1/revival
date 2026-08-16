/** BIM-style drawing layers. Plan and 3D both honor the same set. */

import { objectTags } from "@/lib/floorPlan/library";

export const PLAN_LAYERS = [
  { id: "rooms", label: "Floors", hint: "Room fills and names" },
  { id: "walls", label: "Walls", hint: "Walls, doors, windows" },
  { id: "cabinets", label: "Cabinets", hint: "Base, wall, tall, island, fillers" },
  { id: "countertops", label: "Countertops", hint: "Quartz, stone, butcher" },
  { id: "appliances", label: "Appliances", hint: "Range, fridge, DW" },
  { id: "plumbing", label: "Plumbing", hint: "Sinks, supply, drains" },
  { id: "lighting", label: "Lighting", hint: "Cans, pendants, fans" },
  { id: "electrical", label: "Electrical", hint: "Outlets, switches, panel" },
  { id: "structure", label: "Structure", hint: "LVLs and beams" },
  { id: "dimensions", label: "Dimensions", hint: "Architectural measurements" },
  { id: "hvac", label: "HVAC", hint: "Vents, hoods, air handler" },
  { id: "trim", label: "Notes / trim", hint: "Crown, base, fillers" },
];

export const DEFAULT_LAYERS = {
  rooms: true,
  walls: true,
  cabinets: true,
  countertops: false,
  appliances: true,
  plumbing: true,
  lighting: false,
  electrical: false,
  structure: true,
  dimensions: true,
  hvac: false,
  trim: false,
};

const LAYER_ORDER = PLAN_LAYERS.map((row) => row.id);

export function defaultLayers() {
  return { ...DEFAULT_LAYERS };
}

export function layerOn(layers, id) {
  if (!layers) return DEFAULT_LAYERS[id] !== false;
  return layers[id] !== false;
}

export function objectLayer(obj) {
  const id = String(obj?.library_id || obj?.id || "");
  const tags = objectTags(obj);

  if (tags.includes("countertop") || id.startsWith("counter")) return "countertops";
  if (tags.includes("light") || tags.includes("fan") || id.startsWith("light-") || id.startsWith("fan-")) return "lighting";
  if (
    id.startsWith("outlet")
    || id.startsWith("switch")
    || id === "panel"
    || id === "smoke"
    || (tags.includes("electrical") && !tags.includes("fan") && !tags.includes("light"))
  ) {
    return "electrical";
  }
  if (
    id.startsWith("hood")
    || id.startsWith("vent")
    || id.startsWith("hvac")
    || tags.includes("hvac")
    || tags.includes("hood")
    || tags.includes("vent")
  ) {
    return "hvac";
  }
  if (id.startsWith("lvl-") || tags.includes("lvl")) return "structure";
  if (
    tags.includes("appliance")
    || /^(range|fridge|dw-|micro|washer|dryer)/.test(id)
  ) {
    return "appliances";
  }
  if (
    tags.includes("plumbing")
    || tags.includes("tub")
    || tags.includes("shower")
    || id.startsWith("sink")
    || id === "disposal"
    || id.startsWith("toilet")
    || id.startsWith("supply")
    || id.startsWith("drain")
    || id.startsWith("hose")
    || id.startsWith("wh-")
    || id.startsWith("tub")
    || id.startsWith("shower")
  ) {
    return "plumbing";
  }
  if (
    tags.includes("filler")
    || id.startsWith("filler")
    || tags.includes("cabinet")
    || tags.includes("island")
    || tags.includes("peninsula")
    || tags.includes("vanity")
    || id.startsWith("cab-")
    || id.startsWith("island")
    || id.startsWith("peninsula")
    || id.startsWith("vanity")
  ) {
    return "cabinets";
  }
  if (
    tags.includes("stairs")
    || tags.includes("fireplace")
    || tags.includes("deck")
    || tags.includes("patio")
    || tags.includes("addition")
    || tags.includes("railing")
    || id.startsWith("fp-")
    || id.startsWith("stairs")
    || id.startsWith("deck")
    || id.startsWith("patio")
    || id.startsWith("addition")
  ) {
    return "rooms";
  }
  if (tags.includes("door") || tags.includes("window") || tags.includes("cased") || id.startsWith("door-") || id.startsWith("win-") || id.startsWith("cased")) {
    return "walls";
  }
  if (
    tags.includes("trim")
    || tags.includes("finish")
    || tags.includes("mirror")
    || tags.includes("niche")
    || tags.includes("bench")
    || id.startsWith("baseboard")
    || id.startsWith("crown")
    || id.startsWith("cove")
    || id.startsWith("toekick")
    || id.startsWith("filler")
    || id.startsWith("touchup")
    || id.startsWith("mirror")
  ) {
    return "trim";
  }
  return "trim";
}

export function objectVisible(obj, layers) {
  return layerOn(layers, objectLayer(obj));
}

export function sortObjectsByLayer(objects) {
  return [...(objects || [])].sort((a, b) => LAYER_ORDER.indexOf(objectLayer(a)) - LAYER_ORDER.indexOf(objectLayer(b)));
}

export function toggleLayer(layers, id) {
  return { ...layers, [id]: !layerOn(layers, id) };
}
