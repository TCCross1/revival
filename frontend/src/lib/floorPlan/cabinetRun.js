/** Snap cabinets flush to interior wall faces and fill leftover run gaps. */

import { dist, formatFtIn, inches, round2, snapTo, uid } from "./units";
import {
  isCabinetObject, isFillerObject, isIslandObject, isWallCabinetObject, libraryById,
} from "./library";

export const MIN_FILLER = 0.5;
export const MAX_FILLER = 6;
const OVERLAP_EPS = 0.35;
const WALL_SNAP_IN = 42;

export { isFillerObject, isIslandObject };

export function isRunOccupant(obj) {
  if (!obj || isFillerObject(obj) || isIslandObject(obj)) return false;
  if (isCabinetObject(obj)) return true;
  const id = String(obj?.library_id || "");
  return /^(range|fridge|dw-|wine|ice|washer|dryer)/.test(id);
}

export function isRunCabinet(obj) {
  return isRunOccupant(obj) && isCabinetObject(obj);
}

export function runBand(obj) {
  if (isWallCabinetObject(obj)) return "wall";
  const id = String(obj?.library_id || "");
  if ((obj?.tags || []).includes("tall") || id.includes("tall") || id.includes("fridge-panel") || id.includes("cab-oven")) return "tall";
  return "base";
}

export function objectFootprint(obj) {
  const x = inches(obj?.x);
  const y = inches(obj?.y);
  const w = inches(obj?.width);
  const d = inches(obj?.depth);
  const front = obj?.front || "south";
  if (front === "east" || front === "west") {
    return { x, y, w: d, h: w, front };
  }
  return { x, y, w, h: d, front };
}

function nearestWall(walls, x, y, maxDist = 1e9) {
  let best = null;
  let bestD = maxDist;
  (walls || []).forEach((wall) => {
    const x1 = inches(wall.x1);
    const y1 = inches(wall.y1);
    const x2 = inches(wall.x2);
    const y2 = inches(wall.y2);
    const length = Math.hypot(x2 - x1, y2 - y1);
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

function interiorNormal(wall, rooms) {
  const x1 = inches(wall.x1);
  const y1 = inches(wall.y1);
  const x2 = inches(wall.x2);
  const y2 = inches(wall.y2);
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  const nClock = { x: -uy, y: ux };
  const nCounter = { x: uy, y: -ux };
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  let best = nClock;
  let score = -Infinity;
  const list = rooms || [];
  if (!list.length) return { ux, uy, nx: nClock.x, ny: nClock.y, len, x1, y1, x2, y2 };
  list.forEach((room) => {
    const cx = inches(room.x) + inches(room.width) / 2;
    const cy = inches(room.y) + inches(room.depth) / 2;
    const sClock = (cx - mx) * nClock.x + (cy - my) * nClock.y;
    const sCounter = (cx - mx) * nCounter.x + (cy - my) * nCounter.y;
    if (sClock > score) {
      score = sClock;
      best = nClock;
    }
    if (sCounter > score) {
      score = sCounter;
      best = nCounter;
    }
  });
  return { ux, uy, nx: best.x, ny: best.y, len, x1, y1, x2, y2 };
}

export function wallInterior(wall, rooms) {
  const frame = interiorNormal(wall, rooms);
  const half = inches(wall.thickness || 4.5) / 2;
  return {
    ...frame,
    id: wall.id,
    thick: inches(wall.thickness || 4.5),
    fx1: frame.x1 + frame.nx * half,
    fy1: frame.y1 + frame.ny * half,
    fx2: frame.x2 + frame.nx * half,
    fy2: frame.y2 + frame.ny * half,
    horizontal: Math.abs(frame.uy) < 0.35,
    vertical: Math.abs(frame.ux) < 0.35,
  };
}

function frontFromInterior(interior) {
  if (interior.horizontal) return interior.ny >= 0 ? "south" : "north";
  if (interior.vertical) return interior.nx >= 0 ? "east" : "west";
  if (Math.abs(interior.nx) >= Math.abs(interior.ny)) return interior.nx >= 0 ? "east" : "west";
  return interior.ny >= 0 ? "south" : "north";
}

function alongOf(interior, x, y) {
  return (x - interior.fx1) * interior.ux + (y - interior.fy1) * interior.uy;
}

function overlap1d(a0, a1, b0, b1) {
  return Math.min(a1, b1) - Math.max(a0, b0) > OVERLAP_EPS;
}

function overlaps(a, b) {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return ox > OVERLAP_EPS && oy > OVERLAP_EPS;
}

function spanOf(obj, interior) {
  const fp = objectFootprint(obj);
  const corners = [
    [fp.x, fp.y],
    [fp.x + fp.w, fp.y],
    [fp.x, fp.y + fp.h],
    [fp.x + fp.w, fp.y + fp.h],
  ];
  const alongs = corners.map(([x, y]) => alongOf(interior, x, y));
  return { lo: Math.min(...alongs), hi: Math.max(...alongs) };
}

function occupantsOnWall(level, interior, band, exceptId) {
  return (level?.objects || []).filter((obj) => {
    if (!obj || obj.id === exceptId) return false;
    if (!isRunOccupant(obj)) return false;
    if (runBand(obj) !== band) return false;
    if (obj.wall_id && obj.wall_id === interior.id) return true;
    const fp = objectFootprint(obj);
    const cx = fp.x + fp.w / 2;
    const cy = fp.y + fp.h / 2;
    const along = alongOf(interior, cx, cy);
    if (along < -2 || along > interior.len + 2) return false;
    const intoRoom = (cx - interior.fx1) * interior.nx + (cy - interior.fy1) * interior.ny;
    return intoRoom > -2 && intoRoom < inches(obj.depth) + 10;
  });
}

export function placeFlush(obj, interior, startAlong) {
  const alongW = inches(obj.width);
  const off = inches(obj.depth);
  const t = startAlong;
  const front = frontFromInterior(interior);
  let x;
  let y;
  if (interior.horizontal) {
    const xA = interior.fx1 + interior.ux * t;
    const xB = interior.fx1 + interior.ux * (t + alongW);
    x = Math.min(xA, xB);
    y = interior.ny >= 0 ? interior.fy1 : interior.fy1 - off;
  } else if (interior.vertical) {
    const yA = interior.fy1 + interior.uy * t;
    const yB = interior.fy1 + interior.uy * (t + alongW);
    y = Math.min(yA, yB);
    x = interior.nx >= 0 ? interior.fx1 : interior.fx1 - off;
  } else {
    x = interior.fx1 + interior.ux * t + interior.nx * 0;
    y = interior.fy1 + interior.uy * t;
  }
  return {
    ...obj,
    front,
    wall_id: interior.id,
    x: round2(x),
    y: round2(y),
  };
}

function pickAlongStart(preferred, alongW, wallLen, others, fromStart = null) {
  const maxStart = Math.max(0, wallLen - alongW);
  const clamped = Math.max(0, Math.min(preferred, maxStart));
  const blocked = (start) => others.some((occ) => overlap1d(start, start + alongW, occ.lo, occ.hi));
  if (!blocked(clamped)) return clamped;

  const overlapping = others.filter((occ) => overlap1d(clamped, clamped + alongW, occ.lo, occ.hi));
  const origin = fromStart == null ? clamped : fromStart;
  const dir = clamped >= origin - 0.05 ? 1 : -1;
  if (overlapping.length) {
    if (dir >= 0) {
      const first = [...overlapping].sort((a, b) => a.lo - b.lo)[0];
      const stop = round2(Math.max(0, first.lo - alongW));
      if (!blocked(stop)) return stop;
    } else {
      const last = [...overlapping].sort((a, b) => b.hi - a.hi)[0];
      const stop = round2(Math.min(maxStart, last.hi));
      if (!blocked(stop)) return stop;
    }
  }

  const slots = [];
  let cursor = 0;
  others.forEach((occ) => {
    const gap = occ.lo - cursor;
    if (gap >= alongW - OVERLAP_EPS) {
      slots.push(Math.max(cursor, Math.min(clamped, occ.lo - alongW)));
      slots.push(cursor);
      slots.push(occ.lo - alongW);
    }
    cursor = Math.max(cursor, occ.hi);
  });
  if (wallLen - cursor >= alongW - OVERLAP_EPS) {
    slots.push(Math.max(cursor, Math.min(clamped, maxStart)));
    slots.push(cursor);
  }

  const unique = [...new Set(slots.map((s) => round2(Math.max(0, Math.min(s, maxStart)))))];
  const open = unique.filter((start) => !blocked(start));
  if (!open.length) return clamped;
  open.sort((a, b) => Math.abs(a - clamped) - Math.abs(b - clamped));
  return open[0];
}

function gridSnapOnly(obj, grid) {
  return {
    ...obj,
    x: round2(snapTo(inches(obj.x), grid)),
    y: round2(snapTo(inches(obj.y), grid)),
  };
}

export function isPlanAppliance(obj) {
  const id = String(obj?.library_id || "");
  const tags = obj?.tags || [];
  return tags.includes("appliance") || /^(range|fridge|dw-|washer|dryer|oven-wall|ice)/.test(id);
}

export function planSymbolDepth(obj) {
  if (isWallCabinetObject(obj)) return 12;
  if (isIslandObject(obj)) return inches(obj.depth) || 42;
  const id = String(obj?.library_id || "");
  if (id.startsWith("hood")) return inches(obj.depth) || 20;
  if (id.startsWith("cooktop") || (id.startsWith("micro") && !id.includes("drawer"))) {
    return Math.min(Math.max(inches(obj.depth) || 16, 2), 24);
  }
  if (isPlanAppliance(obj)) return 24;
  if (isRunOccupant(obj)) {
    const depth = inches(obj.depth);
    return depth > 0 ? Math.min(depth, 36) : 24;
  }
  return inches(obj.depth);
}

function standardRunDepth(obj) {
  return planSymbolDepth(obj);
}

function openingSpans(wall, band) {
  return (wall?.openings || []).filter((op) => {
    const type = String(op?.type || "");
    if (type === "window") return band === "wall";
    return type === "door" || type === "cased";
  }).map((op) => ({
    lo: inches(op.offset),
    hi: inches(op.offset) + inches(op.width),
    opening: true,
  }));
}

export function snapCabinetToWall(obj, level, snap = 6) {
  try {
    if (!obj) return { object: obj, fit: true, reason: "" };
    const grid = Math.max(Number(snap) || 6, 1);
    if (isIslandObject(obj) || isFillerObject(obj) || !isRunOccupant(obj)) {
      return { object: gridSnapOnly(obj, grid), fit: true, reason: "" };
    }

    const normalized = { ...obj, depth: standardRunDepth(obj) };
    const fp = objectFootprint(normalized);
    const tapX = fp.x + fp.w / 2;
    const tapY = fp.y + fp.h / 2;
    const hit = nearestWall(level?.walls || [], tapX, tapY, WALL_SNAP_IN);
    if (!hit || hit.dist > WALL_SNAP_IN) {
      return { object: gridSnapOnly(normalized, grid), fit: true, reason: "" };
    }

    const interior = wallInterior(hit.wall, level?.rooms || []);
    if (!interior.horizontal && !interior.vertical) {
      return { object: gridSnapOnly(normalized, grid), fit: true, reason: "" };
    }

    const alongW = inches(normalized.width);
    if (alongW > interior.len + 0.5) {
      return {
        object: gridSnapOnly(normalized, grid),
        fit: false,
        reason: "This cabinet is wider than the wall. Customize the size or pick a smaller cabinet.",
      };
    }

    const tapAlong = alongOf(interior, tapX, tapY);
    const preferred = snapTo(tapAlong - alongW / 2, grid);
    const band = runBand(normalized);
    const neighbors = occupantsOnWall(level, interior, band, normalized.id)
      .map((other) => ({ obj: other, ...spanOf(other, interior) }));
    const others = [...neighbors, ...openingSpans(hit.wall, band)].sort((a, b) => a.lo - b.lo);
    const currentSpan = spanOf(obj, interior);
    const start = pickAlongStart(preferred, alongW, interior.len, others, currentSpan.lo);
    const placed = placeFlush(normalized, interior, start);
    const placedFp = objectFootprint(placed);
    const blocked = occupantsOnWall(level, interior, band, normalized.id).some((other) => overlaps(placedFp, objectFootprint(other)));
    return {
      object: placed,
      fit: !blocked,
      reason: blocked ? "That cabinet is against the next item on the run. Drag it into a clear bay or resize it." : "",
    };
  } catch (err) {
    console.error("Cabinet wall snap failed", err);
    return { object: obj, fit: true, reason: "" };
  }
}

function hasReturn(wall, walls, atStart) {
  const px = atStart ? inches(wall.x1) : inches(wall.x2);
  const py = atStart ? inches(wall.y1) : inches(wall.y2);
  return (walls || []).some((other) => {
    if (!other || other.id === wall.id) return false;
    return [[other.x1, other.y1], [other.x2, other.y2]].some(([ox, oy]) => dist(px, py, inches(ox), inches(oy)) < 3);
  });
}

function fillerFromGap(host, interior, lo, hi) {
  const gap = round2(hi - lo);
  if (gap < MIN_FILLER || gap > MAX_FILLER) return null;
  const lib = libraryById("filler") || {
    id: "filler", group: "Finishes", name: "Filler strip", width: 3, depth: 24, height: 34.5, tags: ["trim", "filler"],
  };
  const stub = {
    library_id: "filler",
    name: `Cabinet filler ${formatFtIn(gap)}`,
    group: "Finishes",
    tags: ["trim", "filler"],
    width: gap,
    depth: inches(host.depth) || lib.depth,
    height: inches(host.height) || lib.height,
    finish: host.finish || "",
    species: host.species || "",
    door_style: host.door_style || "",
    work: "new",
    auto: true,
    note: "Auto filler for cabinet run",
  };
  return {
    ...placeFlush(stub, interior, lo),
    id: uid(),
    library_id: "filler",
    name: stub.name,
    tags: stub.tags,
    group: stub.group,
    width: gap,
    depth: stub.depth,
    height: stub.height,
    finish: stub.finish,
    species: stub.species,
    door_style: stub.door_style,
    work: "new",
    auto: true,
    note: stub.note,
  };
}

export function fitCabinetFillers(level) {
  try {
    const walls = level?.walls || [];
    const rooms = level?.rooms || [];
    const kept = (level?.objects || []).filter((obj) => !(isFillerObject(obj) && obj.auto));
    const fillers = [];
    const groups = new Map();
    kept.forEach((obj) => {
      if (!isRunOccupant(obj)) return;
      const fp = objectFootprint(obj);
      const cx = fp.x + fp.w / 2;
      const cy = fp.y + fp.h / 2;
      const wall = obj.wall_id
        ? walls.find((w) => w.id === obj.wall_id)
        : nearestWall(walls, cx, cy, WALL_SNAP_IN)?.wall;
      if (!wall) return;
      const key = `${wall.id}:${runBand(obj)}`;
      if (!groups.has(key)) groups.set(key, { wall, band: runBand(obj), items: [] });
      groups.get(key).items.push(obj);
    });

    groups.forEach((group) => {
      const interior = wallInterior(group.wall, rooms);
      if (!interior.horizontal && !interior.vertical) return;
      const rows = group.items
        .map((obj) => ({ obj, ...spanOf(obj, interior) }))
        .sort((a, b) => a.lo - b.lo);
      if (!rows.length) return;
      if (hasReturn(group.wall, walls, true)) {
        const first = fillerFromGap(rows[0].obj, interior, 0, rows[0].lo);
        if (first) fillers.push(first);
      }
      rows.forEach((row, i) => {
        const next = rows[i + 1];
        if (!next) return;
        const mid = fillerFromGap(row.obj, interior, row.hi, next.lo);
        if (mid) fillers.push(mid);
      });
      if (hasReturn(group.wall, walls, false)) {
        const last = rows[rows.length - 1];
        const end = fillerFromGap(last.obj, interior, last.hi, interior.len);
        if (end) fillers.push(end);
      }
    });

    if (fillers.length) {
      console.info(`Cabinet run: placed ${fillers.length} filler strip${fillers.length === 1 ? "" : "s"}`);
    }
    return { ...level, objects: [...kept, ...fillers] };
  } catch (err) {
    console.error("Cabinet filler layout failed", err);
    return level;
  }
}

export function clearRunForOpening(level, wall, opening) {
  try {
    if (!level || !wall || !opening) return level;
    const interior = wallInterior(wall, level.rooms || []);
    if (!interior.horizontal && !interior.vertical) return level;
    const lo = inches(opening.offset);
    const hi = lo + inches(opening.width);
    const windowOnly = String(opening.type || "") === "window";
    let objects = [...(level.objects || [])];
    objects = objects.map((obj) => {
      if (!isRunOccupant(obj) || isFillerObject(obj) || isIslandObject(obj)) return obj;
      const band = runBand(obj);
      if (windowOnly && band !== "wall") return obj;
      if (!windowOnly && band === "wall") return obj;
      if (obj.wall_id && obj.wall_id !== wall.id) {
        const fp = objectFootprint(obj);
        const cx = fp.x + fp.w / 2;
        const cy = fp.y + fp.h / 2;
        const along = alongOf(interior, cx, cy);
        const intoRoom = (cx - interior.fx1) * interior.nx + (cy - interior.fy1) * interior.ny;
        if (along < -2 || along > interior.len + 2 || intoRoom < -2 || intoRoom > inches(obj.depth) + 10) return obj;
      }
      const span = spanOf(obj, interior);
      if (!overlap1d(span.lo, span.hi, lo, hi)) return obj;
      const alongW = inches(obj.width);
      const leftStart = lo - alongW;
      const rightStart = hi;
      const leftOk = leftStart >= -0.25;
      const rightOk = rightStart + alongW <= interior.len + 0.25;
      const preferLeft = Math.abs(span.lo - Math.max(0, leftStart)) <= Math.abs(span.lo - rightStart);
      let start = preferLeft && leftOk ? leftStart : rightOk ? rightStart : leftOk ? leftStart : span.lo;
      start = Math.max(0, Math.min(start, Math.max(0, interior.len - alongW)));
      return placeFlush({ ...obj, depth: planSymbolDepth(obj) }, interior, start);
    });
    console.info(`Cabinet run: cleared ${opening.type || "opening"} ${formatFtIn(inches(opening.width))} on the wall`);
    return { ...level, objects };
  } catch (err) {
    console.error("Could not slide cabinets off the opening", err);
    return level;
  }
}
