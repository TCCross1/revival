/** Exact catalog thumbs and plan sprites from the uploaded kitchen/bath photos. */

export const MATERIAL_URLS = {
  oak: "/library/materials/oak.jpg",
  walnut: "/library/materials/walnut.jpg",
  butcher: "/library/materials/butcher.jpg",
  white: "/library/materials/white.jpg",
  navy: "/library/materials/navy.jpg",
  gray: "/library/materials/gray.jpg",
  black: "/library/materials/black.jpg",
  greige: "/library/materials/greige.jpg",
  marble: "/library/materials/marble.jpg",
  carrara: "/library/materials/carrara.jpg",
  calacatta: "/library/materials/calacatta.jpg",
  quartz: "/library/materials/quartz.jpg",
  stainless: "/library/materials/stainless.jpg",
  "black-stainless": "/library/materials/black-stainless.jpg",
  tile: "/library/materials/tile.jpg",
  soapstone: "/library/materials/soapstone.jpg",
  concrete: "/library/materials/concrete.jpg",
  "tile-subway": "/library/materials/tile-subway.jpg",
  "tile-hex": "/library/materials/tile-hex.jpg",
  "tile-black": "/library/materials/tile-black.jpg",
  "tile-herringbone": "/library/materials/tile-herringbone.jpg",
  "tile-penny": "/library/materials/tile-penny.jpg",
  "tile-terrazzo": "/library/materials/tile-terrazzo.jpg",
};

const PHOTO_IDS = new Set([
  "bench-48", "bench-corner",
  "cab-base-24", "cab-base-36", "cab-corner-36", "cab-sink-36", "cab-tall-24", "cab-wall-30", "cab-wall-36",
  "cab-finish-black", "cab-finish-gray", "cab-finish-navy", "cab-finish-oak", "cab-finish-walnut", "cab-finish-white",
  "cooktop-36", "disposal", "drain-linear", "dryer",
  "dw-24", "dw-panel",
  "faucet-black", "faucet-gold", "faucet-wall", "faucet-widespread",
  "fridge-36", "fridge-panel",
  "handheld", "hood-insert", "hood-island-36", "hood-wall-30", "ice-maker",
  "island-72", "island-96", "island-black-waterfall", "island-classic-white", "island-navy", "island-oak", "island-walnut", "island-white-marble",
  "light-chandelier", "light-flush", "light-linear", "light-pendant", "light-recessed", "light-sconce", "light-undercab",
  "micro-24", "micro-drawer", "mirror-36",
  "niche-12", "niche-mosaic", "niche-steam",
  "oven-wall", "rain-head",
  "range-30", "range-36", "range-black-ss", "range-white",
  "shower-black-frame", "shower-frameless", "shower-glass-fixed", "shower-glass-pivot", "shower-glass-slide", "shower-steam", "shower-walk-36", "shower-walk-48",
  "sink-33", "sink-composite-33", "sink-copper-33", "sink-double-33", "sink-farm-33", "sink-undermount-oval", "sink-undermount-rect", "sink-vessel-black", "sink-vessel-white", "sink-work-36",
  "toilet", "tub-60", "tub-black", "tub-free", "tub-japanese",
  "vanity-black-marble", "vanity-black-modern", "vanity-classic", "vanity-concrete", "vanity-double-60", "vanity-float-48", "vanity-furniture-36", "vanity-furniture-white", "vanity-gray-shaker", "vanity-midcentury", "vanity-oak-float", "vanity-single-36", "vanity-walnut-double",
  "washer", "wine-fridge",
]);

const FINISH_CABINET = {
  white: "cab-finish-white",
  navy: "cab-finish-navy",
  gray: "cab-finish-gray",
  stone: "cab-finish-gray",
  greige: "cab-finish-gray",
  black: "cab-finish-black",
  walnut: "cab-finish-walnut",
  sage: "cab-finish-oak",
};

const DOOR_STYLE_THUMB = {
  shaker: "door-shaker",
  slab: "door-slab",
  raised: "door-raised",
  beadboard: "door-beadboard",
  glass: "door-glass",
  "glass-frosted": "door-frosted",
  "glass-mullion": "door-mullion",
};

const ALIAS = {
  "mirror-60": "mirror-36",
  "light-vanity": "light-sconce",
  "light-layout": "light-recessed",
  "peninsula-84": "island-oak",
  "cab-wall-corner-24": "cab-corner-36",
  "cab-wall-corner-36": "cab-corner-36",
  "cab-base-custom": "cab-base-36",
  "cab-wall-custom": "cab-wall-30",
  "cab-trash-18": "cab-base-24",
  "cab-micro-30": "cab-tall-24",
  "cab-specialty": "cab-base-24",
};

function thumbUrl(id) {
  return `/library/thumbs/${id}.jpg`;
}

function spriteUrl(id) {
  return `/library/sprites/${id}.png`;
}

function itemId(item) {
  return String(item?.library_id || item?.id || "");
}

function resolvePhotoId(item) {
  const id = itemId(item);
  if (!id) return "";
  if (PHOTO_IDS.has(id)) return id;
  if (ALIAS[id] && PHOTO_IDS.has(ALIAS[id])) return ALIAS[id];

  if (id.startsWith("cab-base-") || id === "cab-sink-36") {
    const width = Number(item?.width || String(id).split("-").pop());
    return width <= 24 ? "cab-base-24" : "cab-base-36";
  }
  if (id.startsWith("cab-wall-")) {
    const width = Number(item?.width || String(id).split("-").pop());
    return width <= 30 ? "cab-wall-30" : "cab-wall-36";
  }
  if (id.startsWith("cab-tall")) return "cab-tall-24";

  const finish = String(item?.finish || "");
  if ((id.startsWith("cab-") || id.startsWith("island") || id.startsWith("peninsula")) && finish && finish !== "white" && FINISH_CABINET[finish] && PHOTO_IDS.has(FINISH_CABINET[finish])) {
    return FINISH_CABINET[finish];
  }
  const door = String(item?.door_style || "");
  if (id.startsWith("cab-") && door && door !== "shaker" && DOOR_STYLE_THUMB[door] && PHOTO_IDS.has(DOOR_STYLE_THUMB[door])) {
    return DOOR_STYLE_THUMB[door];
  }
  return "";
}

export function catalogImageFor(item) {
  const id = resolvePhotoId(item);
  return id ? thumbUrl(id) : "";
}

export function planSpriteFor(item) {
  const id = resolvePhotoId(item);
  return id ? spriteUrl(id) : "";
}

export function usesPlanPhoto(item) {
  const id = itemId(item);
  const tags = item?.tags || [];
  if (!id) return false;
  if (tags.includes("electrical") && !id.startsWith("light") && !id.startsWith("fan")) return false;
  if (id.startsWith("outlet") || id.startsWith("switch") || id === "panel" || id === "smoke") return false;
  if (id.startsWith("lvl-") || id.startsWith("wh-") || id.startsWith("hvac-") || id.startsWith("vent")) return false;
  if (id.startsWith("door-") || id.startsWith("win-") || id.startsWith("cased") || tags.includes("door") || tags.includes("window")) return false;
  if (tags.includes("trim") || tags.includes("lvl") || id.startsWith("stairs") || id.startsWith("deck") || id.startsWith("fp-") || id.startsWith("railing") || id.startsWith("addition") || id.startsWith("patio")) return false;
  return Boolean(planSpriteFor(item));
}

export function photoMeet(item) {
  const id = itemId(item);
  return /^(tub|toilet|sink-|light-|faucet-|rain-|handheld|disposal|niche)/.test(id) || (item?.tags || []).includes("tub");
}

export function cabinetMaterialKey(obj) {
  const finish = String(obj?.finish || "");
  const species = String(obj?.species || "");
  if (finish === "custom") return "";
  if (finish === "navy") return "navy";
  if (finish === "white") return "white";
  if (finish === "black") return "black";
  if (finish === "greige") return "greige";
  if (finish === "gray" || finish === "stone") return "gray";
  if (finish === "walnut" || species === "walnut") return "walnut";
  if (finish === "sage") return "greige";
  if (species === "painted") return finish || "white";
  if (species === "oak" || species === "red-oak" || !finish) return "oak";
  return finish || "oak";
}

export function counterMaterialKey(obj) {
  const mat = String(obj?.counter_material || obj?.finish || "quartz");
  if (MATERIAL_URLS[mat]) return mat;
  if (mat === "granite") return "soapstone";
  if (mat === "formica" || mat === "solid") return "quartz";
  return "quartz";
}

export function materialUrl(key) {
  return MATERIAL_URLS[key] || "";
}

export function hardwareColor(finish) {
  if (finish === "black") return "#1A1C1E";
  if (finish === "brass" || finish === "gold") return "#C9A227";
  if (finish === "chrome") return "#D8DEE2";
  return "#8A9198";
}
