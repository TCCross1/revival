import { inches, round2 } from "./units";

export const FLOORING_PRICES = {
  lvp: 5.25,
  tile: 9.5,
  carpet: 4.25,
  engineered_hardwood: 8.75,
  solid_hardwood: 11.5,
};
export const COUNTER_PRICES = {
  quartz: 78,
  granite: 68,
  marble: 95,
  carrara: 95,
  calacatta: 110,
  formica: 28,
  butcher: 42,
  solid: 55,
  soapstone: 88,
  concrete: 62,
};
export const APPLIANCE_PRICES = {
  "range-30": 1299,
  "range-36": 1899,
  "range-black-ss": 2099,
  "range-white": 1199,
  "range-gas-30": 1499,
  "range-gas-36": 2199,
  "range-induction-30": 1899,
  "range-induction-36": 2499,
  "fridge-36": 2199,
  "fridge-30": 1799,
  "fridge-42": 3299,
  "fridge-french-36": 2699,
  "fridge-bottom-36": 1999,
  "fridge-panel": 2499,
  "dw-18": 749,
  "dw-24": 649,
  "dw-panel": 799,
  "micro-24": 329,
  "micro-drawer": 689,
  "micro-over-30": 429,
  cooktop: 1499,
  "cooktop-30": 1199,
  "cooktop-36": 1499,
  "cooktop-gas-30": 1299,
  "cooktop-gas-36": 1699,
  "oven-wall": 1699,
  "oven-wall-double": 2899,
  "wine-fridge": 1299,
  "wine-fridge-15": 899,
  "ice-maker": 899,
  washer: 799,
  dryer: 749,
  disposal: 189,
  "sink-33": 425,
  "sink-farm-33": 685,
  "sink-double-33": 495,
  "sink-composite-33": 545,
  "sink-copper-33": 795,
  "sink-work-36": 890,
};
export const LIGHT_PRICES = {
  "light-recessed": 85,
  "light-flush": 72,
  "light-layout": 85,
  "light-pendant": 145,
  "light-chandelier": 420,
  "light-vanity": 165,
  "light-sconce": 95,
  "light-undercab": 48,
  "fan-ceiling": 285,
  "fan-light": 345,
};
export const WINDOW_MATERIAL_PRICES = {
  vinyl: 425,
  "vinyl-clad": 545,
  wood: 685,
  "aluminum-clad": 625,
};
export const DOOR_STYLE_PRICES = {
  "six-panel": 285,
  flush: 195,
  french: 890,
  sliding: 780,
  "bi-fold": 240,
  pocket: 410,
};
export const GROUP_DEFAULTS = {
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
