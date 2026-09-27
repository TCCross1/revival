import { inches, round2 } from "./units";
import rawShopPrices from "./shopPrices.json";

const shopPrices = rawShopPrices?.flooring
  ? rawShopPrices
  : (rawShopPrices?.default || {});

export const FLOORING_PRICES = shopPrices.flooring || {};
export const COUNTER_PRICES = shopPrices.countertops || {};
export const APPLIANCE_PRICES = shopPrices.appliances || {};
export const LIGHT_PRICES = shopPrices.lighting || {};
export const WINDOW_MATERIAL_PRICES = shopPrices.window_materials || {};
export const DOOR_STYLE_PRICES = shopPrices.door_styles || {};
export const GROUP_DEFAULTS = shopPrices.group_defaults || {
  Flooring: 5.25,
  Cabinets: 420,
  Countertops: 78,
  Appliances: 899,
  "Lighting / electrical": 85,
  Openings: 385,
  Bath: 1650,
  Structural: 28,
  General: 125,
};

function widthOf(obj) {
  const w = inches(obj?.width || 24);
  return Number.isFinite(w) && w > 0 ? w : 24;
}

export function priceFiller(obj = {}) {
  const width = Math.max(inches(obj?.width || 3), 0.5);
  return round2(Math.max(28, width * 9.5));
}

export function priceCabinet(obj = {}, libraryId = "") {
  const oid = String(libraryId || obj.library_id || "");
  if (oid.startsWith("filler") || (obj.tags || []).includes("filler")) return priceFiller(obj);
  const width = widthOf(obj);
  let base = 0;
  if (oid.includes("corner")) base = 785;
  else if (oid.includes("tall") || oid.includes("pantry") || oid.includes("micro")) base = round2(width * 16);
  else if (oid.includes("wall")) base = round2(width * 9.75);
  else if (oid.includes("island") || oid.includes("peninsula")) base = round2(width * 14);
  else if (oid.includes("vanity")) base = round2(width * 18);
  else base = round2(width * 11.5);
  if (obj.glass) base = round2(base * 1.15);
  if (obj.crown) base = round2(base + 45);
  return base;
}

export function priceAppliance(libraryId = "", finish = "") {
  const base = APPLIANCE_PRICES[libraryId] || GROUP_DEFAULTS.Appliances;
  if (finish === "panel") return round2(base + 400);
  if (finish === "black-stainless") return round2(base + 120);
  return base;
}

export function priceFlooring(floorId = "") {
  return FLOORING_PRICES[floorId || "lvp"] || FLOORING_PRICES.lvp;
}

export function priceCounter(material = "") {
  return COUNTER_PRICES[material || "quartz"] || COUNTER_PRICES.quartz;
}

export function priceLight(libraryId = "") {
  return LIGHT_PRICES[libraryId] || GROUP_DEFAULTS["Lighting / electrical"];
}

export function priceOpening(kind = "window", style = "", material = "", install = "") {
  if (kind === "window") {
    const base = WINDOW_MATERIAL_PRICES[material || "vinyl"] || WINDOW_MATERIAL_PRICES.vinyl;
    return install === "replacement" ? round2(base - 40) : base;
  }
  if (kind === "cased") return 265;
  return DOOR_STYLE_PRICES[style || "six-panel"] || DOOR_STYLE_PRICES["six-panel"];
}

export function priceBath(libraryId = "") {
  const oid = String(libraryId || "");
  if (oid.includes("shower")) return 2850;
  if (oid.includes("tub")) return 1650;
  if (oid.includes("vanity")) return 980;
  if (oid.includes("toilet")) return 425;
  return GROUP_DEFAULTS.Bath;
}

export function priceStructural() {
  return GROUP_DEFAULTS.Structural;
}

export function priceLibraryItem(item) {
  const id = String(item?.id || item?.library_id || "");
  const tags = item?.tags || [];
  if (tags.includes("countertop") || id.startsWith("counter") || id.startsWith("vanity-top")) return priceCounter(item?.counter_material);
  if (tags.includes("filler") || id.startsWith("filler")) return priceFiller(item);
  if (tags.includes("cabinet") || tags.includes("island") || tags.includes("peninsula") || tags.includes("vanity") || id.startsWith("cab-")) {
    return priceCabinet(item, id);
  }
  if (tags.includes("appliance") || /^(range|fridge|dw-|micro|washer|dryer|disposal)/.test(id)) return priceAppliance(id, item?.appliance_finish);
  if (tags.includes("light") || tags.includes("electrical") || id.startsWith("light-") || id.startsWith("fan-")) return priceLight(id);
  if (tags.includes("shower") || tags.includes("tub") || id.startsWith("shower") || id.startsWith("tub")) return priceBath(id);
  if (tags.includes("window") || id.startsWith("win-")) return priceOpening("window", "", "vinyl", "new-construction");
  if (tags.includes("door") || id.startsWith("door-")) return priceOpening("door", "six-panel");
  return GROUP_DEFAULTS[item?.group] || GROUP_DEFAULTS.General;
}

export function lineAmount(quantity, unitPrice) {
  return round2(Number(quantity || 0) * Number(unitPrice || 0));
}

export function scopeTotal(lineItems) {
  return round2((lineItems || []).reduce((sum, row) => sum + lineAmount(row.quantity, row.unit_price), 0));
}
