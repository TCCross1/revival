import { emptyLevel, emptyObject, emptyOpening, emptyRoom, emptyWall, nearestWall, wallsFromRoom } from "./model";
import { libraryById } from "./library";
import { inches, round2, uid } from "./units";

export const SCAN_VERIFY_NOTE = "from scan – verify";
const METERS_TO_INCHES = 39.3701;
const BASE_WIDTHS = [9, 12, 15, 18, 21, 24, 27, 30, 33, 36, 42, 48];
const WALL_WIDTHS = [12, 15, 18, 21, 24, 27, 30, 33, 36, 42, 48];
const SINK_WIDTHS = [24, 30, 33, 36, 42];
const TALL_WIDTHS = [12, 15, 18, 24, 30, 36];
const VANITY_WIDTHS = [24, 30, 36, 42, 48];
const VANITY_FLOAT_WIDTHS = [36, 48, 60];
const SHOWER_SIZES = [36, 48, 60];
const SKIP = new Set(["bed", "sofa", "chair", "television", "tv", "stairs", "fireplace", "washerdryer", "washer", "dryer"]);
const BATH_SIGNAL = new Set(["toilet", "bathtub", "tub"]);
const OBJECT_INT = {
  0: "storage", 1: "refrigerator", 2: "stove", 3: "bed", 4: "sink", 5: "washerDryer",
  6: "toilet", 7: "bathtub", 8: "oven", 9: "dishwasher", 10: "table", 11: "sofa",
  12: "chair", 13: "fireplace", 14: "television", 15: "stairs",
};
const SURFACE_INT = { 0: "wall", 1: "door", 2: "window", 3: "opening", 4: "floor" };

export function hasNativeRoomPlan() {
  try {
    return Boolean(window.webkit?.messageHandlers?.roomPlan);
  } catch {
    return false;
  }
}

export function isIPhone() {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function requestNativeScan() {
  if (!hasNativeRoomPlan()) return false;
  window.webkit.messageHandlers.roomPlan.postMessage({ action: "scan" });
  return true;
}

export function installRoomPlanListener(onScan) {
  const receive = (payload, err) => {
    if (err) {
      onScan(null, typeof err === "string" ? new Error(err) : err);
      return;
    }
    try {
      const data = typeof payload === "string" ? JSON.parse(payload) : payload;
      onScan(data);
    } catch (parseErr) {
      console.error("RoomPlan callback could not be read", parseErr);
      onScan(null, parseErr);
    }
  };
  window.revivalReceiveScan = receive;
  window.revivalRoomPlan = { receive };
  return () => {
    if (window.revivalReceiveScan === receive) delete window.revivalReceiveScan;
  };
}

export function scanKitchenPath(jobId, plans = []) {
  const existing = (plans || []).find((plan) => plan?.id && !plan.showcase);
  if (existing?.id) return `/floor-plans/${existing.id}?scan=1`;
  return `/floor-plans/new?job=${jobId}&scan=1`;
}

export const scanRoomPath = scanKitchenPath;

export function needsScanVerify(item) {
  return Boolean(item?.from_scan || item?.scan_verify);
}

export function markVerified(item) {
  if (!item) return item;
  const note = String(item.note || "").replace(/\s*·?\s*from scan – verify/gi, "").trim();
  return { ...item, from_scan: false, scan_verify: false, note };
}

function markFromScan(entity) {
  const note = String(entity.note || entity.notes || "").trim();
  const nextNote = note.toLowerCase().includes("from scan") ? note : (note ? `${note} · ${SCAN_VERIFY_NOTE}` : SCAN_VERIFY_NOTE);
  return { ...entity, from_scan: true, scan_verify: true, work: entity.work || "existing", note: nextNote };
}

function nearestChoice(value, choices) {
  const number = Number(value || 0);
  return choices.reduce((best, choice) => (Math.abs(choice - number) < Math.abs(best - number) ? choice : best), choices[0]);
}

function categoryName(raw, lookup) {
  if (raw == null) return "";
  if (typeof raw === "object") return categoryName(raw.category || raw.identifier || raw.name, lookup);
  if (typeof raw === "number") return lookup[raw] || "";
  const text = String(raw).trim();
  if (/^\d+$/.test(text)) return lookup[Number(text)] || text;
  return text;
}

function flattenMatrix(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    if (Array.isArray(value[0])) return value.flat().map(Number);
    return value.map(Number);
  }
  if (typeof value === "object" && value.columns) return flattenMatrix(value.columns);
  return [];
}

function translation(raw, matrix) {
  const origin = raw.origin || raw.position || raw.center || raw.translation || {};
  if (origin && typeof origin === "object" && !Array.isArray(origin) && (origin.x != null || origin.z != null)) {
    return [Number(origin.x || 0), Number(origin.y || 0), Number(origin.z != null ? origin.z : origin.y || 0)];
  }
  if (Array.isArray(origin) && origin.length >= 2) {
    return [Number(origin[0]), Number(origin[1]), Number(origin[2] != null ? origin[2] : origin[1])];
  }
  if (matrix.length >= 15) return [Number(matrix[12] || 0), Number(matrix[13] || 0), Number(matrix[14] || 0)];
  return [0, 0, 0];
}

function dimensionsOf(raw) {
  const dims = raw.dimensions || raw.size || {};
  if (Array.isArray(dims)) {
    return [Number(dims[0] || 0), Number(dims[1] || 0), Number(dims[2] != null ? dims[2] : dims[1] || 0)];
  }
  if (dims && typeof dims === "object") {
    return [
      Number(dims.width || dims.x || raw.width || 0),
      Number(dims.height || dims.y || raw.height || 0),
      Number(dims.depth || dims.length || dims.z || raw.depth || raw.length || 0),
    ];
  }
  return [Number(raw.width || 0), Number(raw.height || 0), Number(raw.depth || raw.length || 0)];
}

function axisXz(matrix, column) {
  const base = column * 4;
  const dx = Number(matrix[base] || 0);
  const dz = Number(matrix[base + 2] || 0);
  const length = Math.hypot(dx, dz);
  if (length < 1e-6) return [1, 0];
  return [dx / length, dz / length];
}

function frontFromNormal(nx, nz) {
  if (Math.abs(nx) >= Math.abs(nz)) return nx >= 0 ? "east" : "west";
  return nz >= 0 ? "south" : "north";
}

function looksLikeMeters(payload, samples) {
  const units = String(payload?.units || "").toLowerCase();
  if (units.startsWith("m") || payload?.meters === true) return true;
  if (units.startsWith("in") || payload?.inches === true) return false;
  const finite = (samples || []).filter((n) => n && n > 0);
  if (!finite.length) return false;
  return Math.max(...finite) < 40;
}

function pointOf(value, scale) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const x = Number(value.x || 0);
    const z = Number(value.z != null ? value.z : value.y || 0);
    return [x * scale, z * scale];
  }
  if (Array.isArray(value) && value.length >= 2) {
    const z = value.length > 2 ? Number(value[2]) : Number(value[1]);
    return [Number(value[0]) * scale, z * scale];
  }
  return [0, 0];
}

function segmentFromSurface(raw, scale) {
  const matrix = flattenMatrix(raw.transform || raw.matrix);
  const [width, height, depth] = dimensionsOf(raw);
  if (raw.start && raw.end) {
    const [x1, y1] = pointOf(raw.start, scale);
    const [x2, y2] = pointOf(raw.end, scale);
    return { x1, y1, x2, y2, height: height * scale, thickness: depth ? depth * scale : null };
  }
  if (raw.x1 != null && raw.x2 != null) {
    return {
      x1: Number(raw.x1) * scale,
      y1: Number(raw.y1) * scale,
      x2: Number(raw.x2) * scale,
      y2: Number(raw.y2) * scale,
      height: height * scale,
      thickness: depth ? depth * scale : null,
    };
  }
  const [tx, ty, tz] = translation(raw, matrix);
  const length = width || 0;
  if (length <= 0) return null;
  const [dirx, dirz] = axisXz(matrix, 0);
  const half = length / 2;
  return {
    x1: (tx - dirx * half) * scale,
    y1: (tz - dirz * half) * scale,
    x2: (tx + dirx * half) * scale,
    y2: (tz + dirz * half) * scale,
    height: height * scale,
    thickness: (depth && depth < length ? depth : 0.1) * scale,
    center: [tx * scale, tz * scale],
  };
}

function objectPose(raw, scale) {
  const matrix = flattenMatrix(raw.transform || raw.matrix);
  const [width, height, depth] = dimensionsOf(raw);
  const [tx, ty, tz] = translation(raw, matrix);
  const cx = tx * scale;
  const cy = tz * scale;
  const widthIn = (width || 0.6) * scale;
  const depthIn = (depth || width || 0.6) * scale;
  const [nx, nz] = axisXz(matrix, 2);
  return {
    cx,
    cy,
    x: cx - widthIn / 2,
    y: cy - depthIn / 2,
    width: widthIn,
    depth: depthIn,
    height: (height || 0.9) * scale,
    front: frontFromNormal(nx, nz),
    category: categoryName(raw.category || raw.type || raw.identifier, OBJECT_INT),
  };
}

function placeholder(libraryId, x, y, width, depth, front, name) {
  const lib = libraryById(libraryId);
  if (!lib) {
    return markFromScan({
      id: uid(),
      library_id: libraryId,
      name: name || "Scanned item",
      x: round2(x),
      y: round2(y),
      width: round2(width || 24),
      depth: round2(depth || 24),
      front: front || "south",
      work: "existing",
      tags: [],
    });
  }
  const obj = emptyObject(lib, x, y);
  obj.width = round2(width != null ? width : obj.width);
  obj.depth = round2(depth != null ? depth : obj.depth);
  obj.front = front || obj.front || "south";
  obj.name = name || obj.name;
  obj.description = "LiDAR placeholder — verify size and position";
  return markFromScan(obj);
}

function mapVanity(width, height, x, y, front) {
  if (width >= 66) return placeholder("vanity-double-72", x, y, 72, 22, front, "Double vanity 72 (scan)");
  if (width >= 54) return placeholder("vanity-double-60", x, y, 60, 21, front, "Double vanity 60 (scan)");
  if (height && height >= 14 && height <= 24) {
    const w = nearestChoice(width, VANITY_FLOAT_WIDTHS);
    return placeholder(`vanity-float-${w}`, x, y, w, 18, front, `Floating vanity ${w} (scan)`);
  }
  const w = nearestChoice(Math.max(width, 24), VANITY_WIDTHS);
  return placeholder(`vanity-single-${w}`, x, y, w, 21, front, `Single vanity ${w} (scan)`);
}

function mapBathtub(width, depth, x, y, front, far) {
  const short = Math.min(width, depth);
  const long = Math.max(width, depth);
  if (short >= 34 && long <= 52 && Math.abs(width - depth) < 14) {
    const side = nearestChoice(Math.max(short, long), SHOWER_SIZES);
    if (side >= 54) return placeholder("shower-walk-60", x, y, 60, 36, front, "Walk-in shower 60 (scan)");
    if (side >= 42) return placeholder("shower-walk-48", x, y, 48, 36, front, "Walk-in shower 48 (scan)");
    return placeholder("shower-walk-36", x, y, 36, 36, front, "Walk-in shower 36 (scan)");
  }
  if (far && long >= 54) return placeholder("tub-free", x, y, 66, 32, front, "Freestanding tub (scan)");
  return placeholder("tub-60", x, y, 60, 32, front, "Alcove tub 60 (scan)");
}

function mapToilet(width, depth, x, y, front) {
  if (depth <= 22 && width <= 16) return placeholder("toilet-wall", x, y, 15, 22, front, "Wall-hung toilet (scan)");
  if (width <= 16) return placeholder("toilet-compact", x, y, 16, 26, front, "Compact toilet (scan)");
  if (depth >= 29) return placeholder("toilet-elongated", x, y, 18, 30, front, "Elongated toilet (scan)");
  return placeholder("toilet", x, y, 18, 28, front, "Toilet (scan)");
}

export function bathroomContext(objectRows = [], roomNames = []) {
  for (const raw of objectRows || []) {
    const category = String(categoryName(raw?.category || raw?.type || raw?.identifier, OBJECT_INT) || "")
      .replace(/\s|_/g, "")
      .toLowerCase();
    if (BATH_SIGNAL.has(category)) return true;
  }
  const text = (roomNames || []).join(" ").toLowerCase();
  return text.includes("bath") || text.includes("powder");
}

function mapScanObject(pose, walls, bathroom = false) {
  const category = String(pose.category || "").replace(/\s|_/g, "").toLowerCase();
  if (SKIP.has(category)) return null;
  const width = Math.max(9, Number(pose.width || 0));
  const depth = Math.max(8, Number(pose.depth || 0));
  const height = Number(pose.height || 0);
  const near = nearestWall(walls, pose.cx, pose.cy, 42);
  const far = !near || Number(near.dist) > 30;
  if (category === "toilet") return mapToilet(width, depth, pose.x, pose.y, pose.front);
  if (["bathtub", "tub", "shower"].includes(category)) return mapBathtub(width, depth, pose.x, pose.y, pose.front, far);
  if (category === "refrigerator" || category === "fridge") {
    const w = nearestChoice(width, [30, 36, 42]);
    return placeholder(`fridge-${w}`, pose.x, pose.y, w, 24, pose.front, `Refrigerator ${w} (scan)`);
  }
  if (["stove", "oven", "range", "cooktop"].includes(category)) {
    const w = width >= 33 ? 36 : 30;
    return placeholder(`range-${w}`, pose.x, pose.y, w, 24, pose.front, `Range ${w} (scan)`);
  }
  if (category === "dishwasher" || category === "dw") {
    return placeholder("dw-24", pose.x, pose.y, 24, 24, pose.front, "Dishwasher (scan)");
  }
  if (category === "sink") {
    if (bathroom) return mapVanity(width, height, pose.x, pose.y, pose.front);
    const w = nearestChoice(Math.max(width, 30), SINK_WIDTHS);
    return placeholder(`cab-sink-${w}`, pose.x, pose.y, w, 24, pose.front, `Sink base ${w} (scan)`);
  }
  if (category === "table" || category === "island" || (far && width >= 48 && depth >= 24 && !bathroom)) {
    const w = nearestChoice(Math.max(width, 72), [72, 84, 96, 108]);
    const islandId = w >= 90 ? "island-96" : w < 80 ? "island-72" : "island-oak";
    return placeholder(islandId, pose.x, pose.y, w, w >= 84 ? 42 : 36, pose.front, `Island ${Math.round(w)} (scan)`);
  }
  if (["storage", "cabinet", "shelf", "vanity", ""].includes(category)) {
    if (bathroom) {
      if (height >= 70 || (height >= 60 && depth >= 18)) {
        const w = nearestChoice(width, TALL_WIDTHS);
        return placeholder(`cab-tall-${w}`, pose.x, pose.y, w, 24, pose.front, `Linen / tall cabinet ${w} (scan)`);
      }
      if (depth <= 16 || (height >= 48 && depth <= 18)) {
        const w = width >= 27 ? 30 : 24;
        return placeholder(`cab-wall-toilet-${w}`, pose.x, pose.y, w, 12, pose.front, `Over-toilet wall ${w} (scan)`);
      }
      return mapVanity(width, height, pose.x, pose.y, pose.front);
    }
    if (height >= 70 || (height >= 60 && depth >= 18)) {
      const w = nearestChoice(width, TALL_WIDTHS);
      return placeholder(`cab-tall-${w}`, pose.x, pose.y, w, 24, pose.front, `Tall pantry ${w} (scan)`);
    }
    if (depth <= 16 || (height >= 48 && depth <= 18)) {
      const w = nearestChoice(width, WALL_WIDTHS);
      return placeholder(`cab-wall-${w}`, pose.x, pose.y, w, 12, pose.front, `Wall cabinet ${w} (scan)`);
    }
    const w = nearestChoice(width, BASE_WIDTHS);
    return placeholder(`cab-base-${w}`, pose.x, pose.y, w, 24, pose.front, `Base cabinet ${w} (scan)`);
  }
  return null;
}

function collectNodes(payload) {
  const nodes = [payload];
  ["rooms", "capturedRooms", "captured_rooms"].forEach((key) => {
    (payload[key] || []).forEach((row) => nodes.push(row));
  });
  const story = payload.story || payload.structure || {};
  (story.rooms || []).forEach((row) => nodes.push(row));
  return nodes.filter((row) => row && typeof row === "object");
}

function addOpening(walls, kind, raw, scale) {
  if (!walls.length) return;
  const opening = markFromScan(emptyOpening(kind === "opening" || kind === "open" ? "cased" : kind));
  const [width, height] = dimensionsOf(raw);
  let widthIn = opening.width;
  if (width) widthIn = width < 20 ? width * scale : width;
  opening.width = round2(Math.max(18, widthIn));
  if (height) opening.height = round2(height < 20 ? height * scale : height);
  let target = null;
  try {
    const pose = objectPose(raw, scale);
    target = nearestWall(walls, pose.cx, pose.cy, 72);
  } catch (err) {
    console.error("Could not locate a wall for a scanned opening", err);
  }
  if (!target && raw.offset != null) {
    opening.offset = Number(raw.offset || 12);
    walls[0].openings = [...(walls[0].openings || []), opening];
    return;
  }
  if (!target) {
    const w = walls[0];
    target = { wall: w, offset: 12, length: Math.hypot(inches(w.x2) - inches(w.x1), inches(w.y2) - inches(w.y1)) };
  }
  const length = Number(target.length || 120);
  opening.offset = round2(Math.max(0, Math.min(Math.max(0, length - opening.width), Number(target.offset || 12) - opening.width / 2)));
  target.wall.openings = [...(target.wall.openings || []), opening];
}

export function importRoomPlan(payload, existingLevel) {
  const data = payload || {};
  const nodes = collectNodes(data);
  const samples = [];
  const objectRows = [];
  const roomNames = [];
  nodes.forEach((room) => {
    roomNames.push(room.name || room.label || "");
    [...(room.walls || []), ...(room.doors || []), ...(room.windows || []), ...(room.objects || [])].forEach((raw) => {
      const [width, , depth] = dimensionsOf(raw || {});
      samples.push(width, depth);
      if (raw?.x1 != null) samples.push(Math.abs(Number(raw.x2) - Number(raw.x1)));
    });
    (room.objects || []).forEach((raw) => objectRows.push(raw));
  });
  const scale = looksLikeMeters(data, samples) ? METERS_TO_INCHES : 1;
  const isBath = bathroomContext(objectRows, roomNames);
  const defaultRoomName = isBath ? "Scanned bathroom" : "Scanned kitchen";
  const target = existingLevel
    ? { ...existingLevel, rooms: [...(existingLevel.rooms || [])], walls: [...(existingLevel.walls || [])], objects: [...(existingLevel.objects || [])] }
    : emptyLevel("LiDAR Scan", 0);

  nodes.forEach((room) => {
    const explicitW = room.width_in || room.width || room.dimensions?.width;
    const explicitD = room.depth_in || room.depth || room.length || room.dimensions?.depth;
    if ((room.width_in || room.depth_in || (explicitW && Number(explicitW) > 40)) && !room.transform) {
      const [x, y] = pointOf(room.origin || room, room.width_in ? 1 : scale);
      let w = Number(room.width_in || explicitW || 144);
      let d = Number(room.depth_in || explicitD || 132);
      if (!room.width_in && Number(explicitW || 0) < 40) {
        w = Number(explicitW) * scale;
        d = Number(explicitD || 0) * scale;
      }
      target.rooms.push(markFromScan(emptyRoom(room.name || room.label || defaultRoomName, x, y, Math.max(36, w), Math.max(36, d))));
    }
    (room.walls || []).forEach((raw) => {
      const category = categoryName(raw.category, SURFACE_INT).toLowerCase();
      if (["door", "window", "opening", "floor"].includes(category)) {
        addOpening(target.walls, category === "opening" ? "cased" : category, raw, scale);
        return;
      }
      const seg = segmentFromSurface(raw, scale);
      if (!seg) return;
      const wall = emptyWall(seg.x1, seg.y1, seg.x2, seg.y2, raw.kind || "exterior");
      if (seg.thickness) wall.thickness = round2(Math.max(3.5, Math.min(12, seg.thickness)));
      target.walls.push(markFromScan(wall));
    });
    (room.doors || []).forEach((raw) => addOpening(target.walls, "door", raw, scale));
    (room.windows || []).forEach((raw) => addOpening(target.walls, "window", raw, scale));
    (room.openings || []).forEach((raw) => addOpening(target.walls, "cased", raw, scale));
    (room.objects || []).forEach((raw) => {
      try {
        const mapped = mapScanObject(objectPose(raw, scale), target.walls, isBath);
        if (mapped) target.objects.push(mapped);
      } catch (err) {
        console.error("Skipping a scanned object that could not be mapped", err);
      }
    });
  });

  if (target.rooms.length && !target.walls.length) {
    target.rooms.forEach((room) => {
      wallsFromRoom(room).forEach((wall) => target.walls.push(markFromScan(wall)));
    });
  }
  if (!target.rooms.length && target.walls.length) {
    const xs = target.walls.flatMap((w) => [Number(w.x1), Number(w.x2)]);
    const ys = target.walls.flatMap((w) => [Number(w.y1), Number(w.y2)]);
    target.rooms.push(markFromScan(emptyRoom(defaultRoomName, Math.min(...xs), Math.min(...ys), Math.max(36, Math.max(...xs) - Math.min(...xs)), Math.max(36, Math.max(...ys) - Math.min(...ys)))));
  }
  if (!target.rooms.length && !target.walls.length) {
    throw new Error("That scan did not include rooms or walls we could read.");
  }
  target.notes = `${String(target.notes || "").trim()} Rough layout from LiDAR — verify every dimension.`.trim();
  return target;
}

export const SAMPLE_KITCHEN_SCAN = {
  units: "inches",
  rooms: [{ name: "Kitchen", origin: { x: 24, y: 24 }, width_in: 168, depth_in: 156 }],
  walls: [
    { start: { x: 24, y: 24 }, end: { x: 192, y: 24 }, kind: "exterior" },
    { start: { x: 192, y: 24 }, end: { x: 192, y: 180 }, kind: "exterior" },
    { start: { x: 192, y: 180 }, end: { x: 24, y: 180 }, kind: "exterior" },
    { start: { x: 24, y: 180 }, end: { x: 24, y: 24 }, kind: "exterior" },
  ],
  doors: [{ width: 32, transform: { columns: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [24, 0, 48, 1]] } }],
  windows: [{ width: 36, transform: { columns: [[0, 0, 1, 0], [0, 1, 0, 0], [-1, 0, 0, 0], [192, 0, 96, 1]] } }],
  objects: [
    { category: "refrigerator", origin: { x: 42, y: 36 }, dimensions: { width: 36, height: 70, depth: 24 } },
    { category: "stove", origin: { x: 96, y: 36 }, dimensions: { width: 30, height: 36, depth: 24 } },
    { category: "sink", origin: { x: 150, y: 36 }, dimensions: { width: 36, height: 36, depth: 24 } },
    { category: "dishwasher", origin: { x: 174, y: 36 }, dimensions: { width: 24, height: 34, depth: 24 } },
    { category: "storage", origin: { x: 66, y: 36 }, dimensions: { width: 24, height: 34.5, depth: 24 } },
    { category: "table", origin: { x: 96, y: 96 }, dimensions: { width: 96, height: 36, depth: 42 } },
  ],
};

export const SAMPLE_BATHROOM_SCAN = {
  units: "inches",
  rooms: [{ name: "Bathroom", origin: { x: 24, y: 24 }, width_in: 96, depth_in: 84 }],
  walls: [
    { start: { x: 24, y: 24 }, end: { x: 120, y: 24 }, kind: "interior" },
    { start: { x: 120, y: 24 }, end: { x: 120, y: 108 }, kind: "interior" },
    { start: { x: 120, y: 108 }, end: { x: 24, y: 108 }, kind: "interior" },
    { start: { x: 24, y: 108 }, end: { x: 24, y: 24 }, kind: "interior" },
  ],
  doors: [{ width: 28, transform: { columns: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [24, 0, 48, 1]] } }],
  windows: [{ width: 24, transform: { columns: [[0, 0, 1, 0], [0, 1, 0, 0], [-1, 0, 0, 0], [120, 0, 60, 1]] } }],
  objects: [
    { category: "toilet", origin: { x: 36, y: 36 }, dimensions: { width: 18, height: 30, depth: 28 } },
    { category: "bathtub", origin: { x: 72, y: 30 }, dimensions: { width: 60, height: 18, depth: 32 } },
    { category: "sink", origin: { x: 42, y: 78 }, dimensions: { width: 36, height: 34, depth: 21 } },
    { category: "storage", origin: { x: 36, y: 70 }, dimensions: { width: 24, height: 30, depth: 12 } },
  ],
};
