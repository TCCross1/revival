import { dist, inches, round2, snapTo, uid } from "./units";
import { DEFAULT_WALL_HEIGHT, EXT_THICKNESS, INT_THICKNESS } from "./units";
import {
  HOUSE_STANDARD_DEFAULTS,
  defaultCabinetConfig,
  defaultFuel,
  defaultHoodType,
  defaultMirrorShape,
  defaultShowerDoor,
  defaultTubType,
} from "./library";
import { snapCabinetToWall, planSymbolDepth } from "./cabinetRun";
import { emptyKitchenDesign } from "./kitchenDesign";

export function emptyOpening(kind = "door") {
  const widths = { door: 32, window: 36, cased: 36 };
  const heights = { door: 80, window: 48, cased: 80 };
  const styles = { door: "six-panel", window: "double-hung", cased: "cased" };
  return {
    id: uid(),
    type: kind,
    offset: 12,
    width: widths[kind] || 32,
    height: heights[kind] || 80,
    sill: kind === "window" ? 24 : 0,
    swing: "left",
    direction: "in",
    storm: false,
    style: styles[kind] || "standard",
    exterior: kind === "door",
    material: kind === "window" ? "vinyl" : "",
    install: kind === "window" ? "new-construction" : "",
    extension_jambs: kind === "window",
    lites: 0,
    leafs: kind === "door" ? 1 : 0,
    model_number: "",
    manufacturer: "",
    description: "",
    finish: "",
    note: "",
  };
}

export function emptyWall(x1, y1, x2, y2, kind = "exterior") {
  return {
    id: uid(),
    kind,
    x1: round2(x1),
    y1: round2(y1),
    x2: round2(x2),
    y2: round2(y2),
    thickness: kind === "exterior" ? EXT_THICKNESS : INT_THICKNESS,
    height: DEFAULT_WALL_HEIGHT,
    openings: [],
    work: "existing",
    note: "",
  };
}

export function emptyRoom(name = "Room", x = 24, y = 24, width = 144, depth = 132) {
  return {
    id: uid(),
    name,
    kind: "room",
    x: round2(x),
    y: round2(y),
    width: round2(width),
    depth: round2(depth),
    rotation: 0,
    wall_height: DEFAULT_WALL_HEIGHT,
    ceiling_height: DEFAULT_WALL_HEIGHT,
    flooring: "lvp",
    wall_finish: "",
    notes: "",
    note: "",
    work: "existing",
  };
}

export function wallsFromRoom(room, kind = "exterior") {
  const x = inches(room.x);
  const y = inches(room.y);
  const w = inches(room.width);
  const d = inches(room.depth);
  return [
    { ...emptyWall(x, y, x + w, y, kind), source_room_id: room.id },
    { ...emptyWall(x + w, y, x + w, y + d, kind), source_room_id: room.id },
    { ...emptyWall(x + w, y + d, x, y + d, kind), source_room_id: room.id },
    { ...emptyWall(x, y + d, x, y, kind), source_room_id: room.id },
  ];
}

export function fitRoofToRooms(level) {
  const rooms = level?.rooms || [];
  if (!rooms.length) return level;
  const minX = Math.min(...rooms.map((r) => inches(r.x)));
  const minY = Math.min(...rooms.map((r) => inches(r.y)));
  const maxX = Math.max(...rooms.map((r) => inches(r.x) + inches(r.width)));
  const maxY = Math.max(...rooms.map((r) => inches(r.y) + inches(r.depth)));
  const roof = (level.roofs && level.roofs[0]) || emptyRoof();
  return {
    ...level,
    roofs: [{
      ...roof,
      x: round2(minX),
      y: round2(minY),
      width: round2(maxX - minX),
      depth: round2(maxY - minY),
    }],
  };
}

export function moveRoom(level, roomId, x, y) {
  const room = (level.rooms || []).find((r) => r.id === roomId);
  if (!room) return level;
  const nx = round2(x);
  const ny = round2(y);
  const dx = nx - inches(room.x);
  const dy = ny - inches(room.y);
  return fitRoofToRooms({
    ...level,
    rooms: level.rooms.map((r) => (r.id === roomId ? { ...r, x: nx, y: ny } : r)),
    walls: (level.walls || []).map((w) => (
      w.source_room_id === roomId
        ? { ...w, x1: round2(w.x1 + dx), y1: round2(w.y1 + dy), x2: round2(w.x2 + dx), y2: round2(w.y2 + dy) }
        : w
    )),
  });
}

export function resizeRoom(level, roomId, width, depth) {
  const room = (level.rooms || []).find((r) => r.id === roomId);
  if (!room) return level;
  const next = {
    ...room,
    width: Math.max(36, round2(width)),
    depth: Math.max(36, round2(depth)),
  };
  const kept = (level.walls || []).filter((w) => w.source_room_id !== roomId);
  return fitRoofToRooms({
    ...level,
    rooms: level.rooms.map((r) => (r.id === roomId ? next : r)),
    walls: [...kept, ...wallsFromRoom(next)],
  });
}

export function emptyRoof(kind = "gable", width = 240, depth = 180) {
  return {
    id: uid(),
    kind,
    pitch_rise: 6,
    pitch_run: 12,
    overhang: 12,
    width: round2(width),
    depth: round2(depth),
    x: 0,
    y: 0,
    ridge_along: "length",
  };
}

export function emptyLevel(name = "1st Floor", sortOrder = 0) {
  return {
    id: uid(),
    name,
    sort_order: sortOrder,
    elevation_in: sortOrder === 0 ? 0 : 108 * sortOrder,
    rooms: [],
    walls: [],
    objects: [],
    roofs: [],
    decks: [],
    stairs: [],
    beams: [],
    notes: "",
  };
}

const PLUMBING_HINT = /wh-|sink|toilet|tub|shower|vanity|disposal|washer|hose-bib|supply|drain/;

export function flagPlumbingWalls(level) {
  const objects = level?.objects || [];
  const walls = (level?.walls || []).map((wall) => {
    const near = objects.some((obj) => {
      const id = String(obj.library_id || obj.id || "");
      const tags = obj.tags || [];
      const plumbing = tags.includes("plumbing") || tags.includes("shower") || tags.includes("tub") || PLUMBING_HINT.test(id);
      if (!plumbing) return false;
      const hit = nearestWall([wall], inches(obj.x) + inches(obj.width) / 2, inches(obj.y) + inches(obj.depth) / 2, 20);
      return Boolean(hit);
    });
    if (!near && !wall.plumbing) return wall;
    return {
      ...wall,
      plumbing: near || Boolean(wall.plumbing),
      thickness: (near || wall.plumbing) ? Math.max(inches(wall.thickness), 5.5) : wall.thickness,
    };
  });
  return { ...level, walls };
}

export function emptyDocument() {
  const level = emptyLevel("1st Floor", 0);
  return {
    units: "inches",
    grid: 12,
    snap: 6,
    active_level_id: level.id,
    foundation: "slab",
    levels: [level],
    lidar: { sessions: [], last_import: "" },
    asbuilt: { dataUrl: "", opacity: 0.35, x: 0, y: 0, scale: 1 },
    client_notes: "",
    special_conditions: "",
    kitchen_design: emptyKitchenDesign(),
    house_standards: {
      favorites: [],
      defaults: { ...HOUSE_STANDARD_DEFAULTS },
    },
  };
}

export function emptyObject(libItem, x, y, standards = {}) {
  const tags = libItem.tags || [];
  const cabinet = (tags.includes("cabinet") || tags.includes("island") || tags.includes("peninsula") || tags.includes("vanity")) && !tags.includes("countertop");
  const appliance = tags.includes("appliance");
  const counter = tags.includes("countertop");
  const light = tags.includes("light");
  const id = String(libItem.id || "");
  const farm = tags.includes("farm") || id.includes("farm") || id.includes("copper");
  const house = { ...HOUSE_STANDARD_DEFAULTS, ...(standards || {}) };
  const seating = tags.includes("island") && (id.includes("seat") || Number(libItem.overhang) > 0 || id.includes("96") || id.includes("double") || id.includes("black-waterfall") || id.includes("oak"));
  return {
    id: uid(),
    library_id: libItem.id,
    name: libItem.name,
    group: libItem.group,
    tags,
    x: round2(x),
    y: round2(y),
    width: libItem.width,
    depth: planSymbolDepth({ library_id: libItem.id, tags, depth: libItem.depth, width: libItem.width }),
    height: libItem.height,
    rotation: 0,
    front: "south",
    wall_id: "",
    finish: cabinet ? (house.finish || "white") : "",
    variant: "",
    work: "new",
    note: "",
    door_style: cabinet ? (house.door_style || "shaker") : "",
    glass: tags.includes("glass") || id.includes("glass") ? "clear" : "",
    species: cabinet ? (house.species || "painted") : "",
    crown: tags.includes("wall") ? "crown-35" : "",
    color: "",
    config: cabinet ? defaultCabinetConfig(libItem) : "",
    hardware_finish: cabinet || tags.includes("shower") || tags.includes("glass") ? (house.hardware_finish || "brass") : "",
    hardware_style: cabinet ? (house.hardware_style || "bar") : "",
    hardware_size: cabinet ? (house.hardware_size || "5") : "",
    overhang: seating || tags.includes("island") ? (id.includes("seat") || id.includes("double") ? 14 : 12) : 0,
    counter_material: counter || cabinet ? (id.includes("butcher") ? "butcher" : id.includes("concrete") ? "concrete" : id.includes("granite") ? "granite" : id.includes("quartz") || id.includes("oak") ? "quartz" : house.counter_material || "carrara") : "",
    edge_profile: counter || tags.includes("island") ? (id.includes("waterfall") ? "waterfall" : house.edge_profile || "eased") : "",
    sink_type: id.includes("sink") || tags.includes("vanity") || tags.includes("sink") ? (farm ? "farm" : id.includes("double") || id.includes("vanity-double") ? "double" : id.includes("vessel") ? "vessel" : id.includes("topmount") ? "top-mount" : id.includes("corner") && id.startsWith("sink") ? "corner" : "undermount-rect") : "",
    faucet_finish: id.includes("sink") || tags.includes("vanity") || id.startsWith("faucet") ? (id.includes("gold") ? "gold" : id.includes("black") ? "black" : house.faucet_finish || "nickel") : "",
    faucet_style: id.includes("sink") || tags.includes("vanity") || id.startsWith("faucet") ? (id.includes("pulldown") ? "pulldown" : id.includes("bridge") ? "bridge" : id.includes("potfiller") ? "pot-filler" : id.includes("wall") ? "wall" : id.includes("widespread") ? "widespread" : house.faucet_style || "pulldown") : "",
    vanity_mount: id.includes("float") ? "floating" : tags.includes("vanity") ? "floor" : "",
    appliance_finish: appliance ? (id.includes("panel") ? "panel" : id.includes("white") ? "white" : id.includes("black-ss") || id.includes("black-ss") ? "black-stainless" : house.appliance_finish || "stainless") : "",
    fuel: defaultFuel(libItem),
    hood_type: defaultHoodType(libItem),
    shower_type: id.includes("neo") ? "neo" : id.includes("corner") && tags.includes("shower") ? "corner" : id.includes("steam") ? "steam" : tags.includes("shower") ? "walk-in" : "",
    shower_door: defaultShowerDoor(libItem),
    shower_glass: tags.includes("shower") || tags.includes("glass") ? "clear" : "",
    tub_type: defaultTubType(libItem),
    mirror_shape: tags.includes("mirror") ? defaultMirrorShape(libItem) : "",
    lighted: id.includes("lighted") || (tags.includes("mirror") && tags.includes("light")),
    toilet_type: id.startsWith("toilet") ? (id.includes("wall") ? "wall" : id.includes("compact") ? "compact" : id.includes("comfort") ? "comfort" : "floor") : "",
    light_mount: tags.includes("flush") ? "flush" : light ? "recessed" : "",
    auto: false,
    locked: false,
    anchor: "",
    model_number: libItem.sku || "",
    manufacturer: libItem.manufacturer || "",
    description: libItem.description || libItem.line || "",
    sku: libItem.sku || "",
    actual_depth: tags.includes("appliance") ? (libItem.depth || 24) : "",
  };
}

export function activeLevel(doc) {
  const levels = doc?.levels || [];
  return levels.find((l) => l.id === doc.active_level_id) || levels[0] || emptyLevel();
}

export function updateLevel(doc, levelId, updater) {
  return {
    ...doc,
    levels: (doc.levels || []).map((level) => (level.id === levelId ? updater(level) : level)),
  };
}

export function wallLength(wall) {
  return dist(wall.x1, wall.y1, wall.x2, wall.y2);
}

export function setWallLength(wall, lengthInches) {
  const len = dist(wall.x1, wall.y1, wall.x2, wall.y2);
  if (len < 0.01) return wall;
  const nx = (wall.x2 - wall.x1) / len;
  const ny = (wall.y2 - wall.y1) / len;
  const next = Math.max(inches(lengthInches), 6);
  return { ...wall, x2: round2(wall.x1 + nx * next), y2: round2(wall.y1 + ny * next) };
}

export function pointOnWall(wall, t) {
  return {
    x: wall.x1 + (wall.x2 - wall.x1) * t,
    y: wall.y1 + (wall.y2 - wall.y1) * t,
  };
}

export function splitWallAt(wall, x, y, tolerance = 8) {
  const x1 = inches(wall.x1);
  const y1 = inches(wall.y1);
  const x2 = inches(wall.x2);
  const y2 = inches(wall.y2);
  const length = dist(x1, y1, x2, y2);
  if (length < 1) return [wall, null];
  const t = ((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / (length * length);
  if (t <= 0.04 || t >= 0.96) return [wall, null];
  const px = x1 + t * (x2 - x1);
  const py = y1 + t * (y2 - y1);
  if (dist(x, y, px, py) > tolerance) return [wall, null];
  const left = { ...wall, id: uid(), x2: round2(px), y2: round2(py), openings: [] };
  const right = { ...wall, id: uid(), x1: round2(px), y1: round2(py), openings: [] };
  return [left, right];
}

export function applyTIntersections(walls, newWall) {
  const next = [];
  walls.forEach((wall) => {
    let [a, b] = splitWallAt(wall, newWall.x1, newWall.y1);
    if (b) {
      next.push(a, b);
      return;
    }
    [a, b] = splitWallAt(wall, newWall.x2, newWall.y2);
    if (b) {
      next.push(a, b);
      return;
    }
    next.push(wall);
  });
  next.push(newWall);
  return next;
}

export function nearestWall(walls, x, y, maxDist = 18) {
  let best = null;
  let bestD = maxDist;
  (walls || []).forEach((wall) => {
    const x1 = inches(wall.x1);
    const y1 = inches(wall.y1);
    const x2 = inches(wall.x2);
    const y2 = inches(wall.y2);
    const length = dist(x1, y1, x2, y2);
    if (length < 1) return;
    const t = Math.max(0, Math.min(1, ((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / (length * length)));
    const px = x1 + t * (x2 - x1);
    const py = y1 + t * (y2 - y1);
    const d = dist(x, y, px, py);
    if (d < bestD) {
      bestD = d;
      best = { wall, t, x: px, y: py, dist: d };
    }
  });
  return best;
}

export function snapPoint(x, y, snap, walls = []) {
  let sx = snapTo(x, snap);
  let sy = snapTo(y, snap);
  (walls || []).forEach((wall) => {
    [[wall.x1, wall.y1], [wall.x2, wall.y2]].forEach(([wx, wy]) => {
      if (dist(sx, sy, wx, wy) < Math.max(snap, 8)) {
        sx = wx;
        sy = wy;
      }
    });
  });
  return { x: sx, y: sy };
}

export function snapObjectPlacement(obj, level, snap = 6) {
  return snapCabinetToWall(obj, level, snap).object;
}
