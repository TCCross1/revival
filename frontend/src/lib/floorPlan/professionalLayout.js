/** Professional architectural kitchen rules — prevent amateur / incomplete layouts. */

import {
  isCabinetObject, isCountertopObject, isFillerObject, isIslandObject, isSinkObject,
  isWallCabinetObject, isBaseRunObject,
} from "./library";
import { objectFootprint, wallInterior } from "./cabinetRun";
import { dist, formatFtIn, inches } from "./units";

const WINDOW_TRIM = 3;
const MAX_KITCHEN_WINDOWS = 2;
const MIN_FLANK = 12;
const FLOAT_GAP = 3;
const VOID_MIN = 9;
const VOID_MAX = 48;
const CENTER_TOL = 6;

export function roomContaining(level, x, y) {
  const px = inches(x);
  const py = inches(y);
  return (level?.rooms || []).find((room) => (
    px >= inches(room.x) - 1
    && py >= inches(room.y) - 1
    && px <= inches(room.x) + inches(room.width) + 1
    && py <= inches(room.y) + inches(room.depth) + 1
  )) || null;
}

export function roomOfObject(level, obj) {
  if (!obj) return null;
  const fp = objectFootprint(obj);
  return roomContaining(level, fp.x + fp.w / 2, fp.y + fp.h / 2);
}

export function isPantryRoom(room) {
  return /pantry/i.test(String(room?.name || ""));
}

export function isLaundryRoom(room) {
  return /laundry|mud/i.test(String(room?.name || ""));
}

export function isNookRoom(room) {
  return /nook|breakfast|morning|sunroom|keeping/i.test(String(room?.name || ""));
}

export function isKitchenRoomName(room) {
  return /kitchen|kit\b/i.test(String(room?.name || ""));
}

export function isSinkLike(obj) {
  if (!obj) return false;
  const id = String(obj.library_id || "");
  if (obj.config === "sink") return true;
  if (id.startsWith("cab-sink") || id.startsWith("cab-farm") || id.includes("farm-sink")) return true;
  return isSinkObject(obj);
}

export function isSinkFixture(obj) {
  const id = String(obj?.library_id || "");
  return id.startsWith("sink") && !id.startsWith("cab-sink");
}

export function isSinkBase(obj) {
  const id = String(obj?.library_id || "");
  return id.startsWith("cab-sink") || id.startsWith("cab-farm") || obj?.config === "sink" || (isIslandObject(obj) && obj?.config === "sink");
}

function boxesOverlap(a, b, pad = 0) {
  return a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
}

function alongOf(interior, x, y) {
  return (x - interior.fx1) * interior.ux + (y - interior.fy1) * interior.uy;
}

function spanOf(obj, interior) {
  const fp = objectFootprint(obj);
  const pts = [[fp.x, fp.y], [fp.x + fp.w, fp.y], [fp.x, fp.y + fp.h], [fp.x + fp.w, fp.y + fp.h]];
  const alongs = pts.map(([x, y]) => alongOf(interior, x, y));
  return { lo: Math.min(...alongs), hi: Math.max(...alongs) };
}

function named(obj) {
  return obj?.name || obj?.library_id || "Cabinet";
}

function overlapsSpan(a, b) {
  return Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo) > 1;
}

function windowSpans(wall) {
  return (wall.openings || []).filter((op) => op.type === "window").map((op) => ({
    lo: inches(op.offset),
    hi: inches(op.offset) + inches(op.width),
    width: inches(op.width),
    height: inches(op.height || 48),
  }));
}

function caseworkOf(level) {
  return (level?.objects || []).filter((obj) => {
    if (obj.work === "demo") return false;
    if (isCountertopObject(obj) || isFillerObject(obj)) return false;
    const id = String(obj.library_id || "");
    if (/^(outlet|switch|light|smoke|vent-|disposal|faucet|hose|supply|drain)/.test(id)) return false;
    return isCabinetObject(obj) || isIslandObject(obj) || isBaseRunObject(obj)
      || /^(range|fridge|dw-|washer|dryer|cooktop)/.test(id)
      || id.startsWith("fp-") || id.startsWith("vanity");
  });
}

function evaluateIslands(level, warnings) {
  const objects = (level?.objects || []).filter((obj) => obj.work !== "demo");
  const islands = objects.filter(isIslandObject);
  const counters = objects.filter(isCountertopObject);
  const sinks = objects.filter(isSinkLike);

  islands.forEach((island) => {
    const fp = objectFootprint(island);
    const onIsland = sinks.filter((sink) => sink.id !== island.id && boxesOverlap(fp, objectFootprint(sink), 2));
    const islandIsSink = island.config === "sink" || String(island.library_id || "").includes("sink");
    if (islandIsSink || onIsland.length) {
      const sink = onIsland[0] || null;
      const sinkW = sink ? inches(sink.width) : Math.min(36, Math.max(24, fp.w * 0.35));
      const leftFlank = sink ? (objectFootprint(sink).x - fp.x) : (fp.w - sinkW) / 2;
      const rightFlank = sink ? (fp.x + fp.w - (objectFootprint(sink).x + objectFootprint(sink).w)) : (fp.w - sinkW) / 2;
      if (leftFlank < MIN_FLANK || rightFlank < MIN_FLANK || fp.w < sinkW + MIN_FLANK * 2) {
        warnings.push({ severity: "error", code: "island-flank", text: `${named(island)} needs a proper sink base with at least 12\" of cabinet or a finished panel on both sides of the sink.` });
      }
      if (sink && inches(sink.width) > 36) {
        warnings.push({ severity: "error", code: "island-sink-size", text: "Island sinks should be a defined 24–33\" prep bowl in a sink base — not an oversized basin across the whole island." });
      }
    }
    if (fp.w < 24 || fp.h < 12) {
      warnings.push({ severity: "error", code: "island-incomplete", text: `${named(island)} is too thin to read as casework. Islands cannot be a countertop with no cabinets beneath.` });
    }
  });

  counters.forEach((top) => {
    const fp = objectFootprint(top);
    const supported = objects.some((obj) => {
      if (obj.id === top.id || isCountertopObject(obj) || isWallCabinetObject(obj)) return false;
      if (!isCabinetObject(obj) && !isIslandObject(obj) && !isBaseRunObject(obj) && !/^(range|fridge|dw-)/.test(String(obj.library_id || ""))) return false;
      return boxesOverlap(fp, objectFootprint(obj), 4);
    });
    if (!supported) {
      warnings.push({ severity: "error", code: "island-incomplete", text: `${named(top)} is a floating countertop with no cabinets beneath it.` });
    }
  });

  sinks.filter(isSinkFixture).forEach((sink) => {
    const fp = objectFootprint(sink);
    const base = objects.find((obj) => (
      obj.id !== sink.id && (isSinkBase(obj) || isIslandObject(obj) || String(obj.library_id || "").startsWith("cab-sink"))
      && boxesOverlap(fp, objectFootprint(obj), 4)
    ));
    if (!base) {
      warnings.push({ severity: "error", code: "sink-base", text: `${named(sink)} must sit in a proper sink base cabinet — never a bowl on an empty counter.` });
    }
  });
}

function evaluateDoors(level, warnings) {
  (level?.objects || []).forEach((obj) => {
    if (obj.work === "demo") return;
    if (!isCabinetObject(obj) && !isIslandObject(obj)) return;
    const w = inches(obj.width);
    if (w > 24 && obj.config === "single") {
      warnings.push({ severity: "error", code: "double-doors", text: `${named(obj)} is ${formatFtIn(w)} and must be drawn with double doors or a proper drawer stack — a single door over 24\" is not allowed.` });
    }
  });
}

function evaluateWindows(level, warnings) {
  (level?.rooms || []).filter(isKitchenRoomName).forEach((room) => {
    const walls = (level.walls || []).filter((wall) => wall.source_room_id === room.id);
    const windows = [];
    walls.forEach((wall) => {
      windowSpans(wall).forEach((win) => windows.push({ wall, ...win }));
    });
    if (windows.length > MAX_KITCHEN_WINDOWS) {
      warnings.push({ severity: "warn", code: "window-count", text: `This kitchen has ${windows.length} windows. Limit openings so upper cabinets can run continuously — typically one window over the sink, not a wall of small punched openings.` });
    }
    walls.forEach((wall) => {
      const wins = windowSpans(wall).sort((a, b) => a.lo - b.lo);
      if (wins.length < 2) return;
      const segments = [];
      let cursor = 0;
      const interior = wallInterior(wall, level.rooms || []);
      wins.forEach((win) => {
        const lo = Math.max(0, win.lo - WINDOW_TRIM);
        if (lo - cursor >= 9) segments.push(lo - cursor);
        cursor = Math.max(cursor, win.hi + WINDOW_TRIM);
      });
      if (interior.len - cursor >= 9) segments.push(interior.len - cursor);
      const tiny = segments.filter((len) => len > 0 && len < 18);
      if (tiny.length) {
        warnings.push({ severity: "warn", code: "window-fragment", text: "Windows are breaking this wall into tiny, unusable wall-cabinet segments. Combine or reduce openings so uppers can land in standard widths." });
      }
    });
  });
}

function evaluateVoids(level, warnings) {
  const walls = level?.walls || [];
  walls.forEach((wall) => {
    const interior = wallInterior(wall, level.rooms || []);
    if (!interior.horizontal && !interior.vertical) return;
    const occupants = caseworkOf(level).filter((obj) => {
      if (isWallCabinetObject(obj) || isIslandObject(obj)) return false;
      if (obj.wall_id && obj.wall_id !== wall.id) return false;
      const fp = objectFootprint(obj);
      const cx = fp.x + fp.w / 2;
      const cy = fp.y + fp.h / 2;
      const into = (cx - interior.fx1) * interior.nx + (cy - interior.fy1) * interior.ny;
      const along = alongOf(interior, cx, cy);
      return into > -2 && into < 40 && along > -4 && along < interior.len + 4;
    }).map((obj) => ({ obj, ...spanOf(obj, interior) })).sort((a, b) => a.lo - b.lo);
    occupants.forEach((row, idx) => {
      const next = occupants[idx + 1];
      if (!next) return;
      const gap = next.lo - row.hi;
      if (gap > VOID_MIN && gap < VOID_MAX) {
        const major = [row.obj, next.obj].some((obj) => isSinkLike(obj) || /^(range|fridge|dw-|washer|dryer)/.test(String(obj.library_id || "")));
        if (major) {
          warnings.push({ severity: "warn", code: "void-run", text: `${formatFtIn(gap)} unexplained gap next to ${named(row.obj)}. Fill with a standard cabinet, a drawer base, or a filler — do not leave a hole in the run.` });
        }
      }
    });
  });
}

function isRealWindow(op) {
  return Boolean(op) && op.type === "window" && !op.dimension && inches(op.width) >= 12;
}

function evaluatePantry(level, warnings) {
  (level?.objects || []).filter((obj) => obj.work !== "demo" && isSinkLike(obj)).forEach((obj) => {
    const room = roomOfObject(level, obj);
    if (isPantryRoom(room)) {
      warnings.push({ severity: "error", code: "pantry-sink", text: `Remove ${named(obj)} from ${room.name}. A pantry (including a butler’s pantry) may contain only cabinets, shelves, and storage — never a sink.` });
    }
  });

  const pantryRooms = (level?.rooms || []).filter(isPantryRoom);
  const kitchen = (level?.rooms || []).find(isKitchenRoomName);
  pantryRooms.forEach((room) => {
    (level.walls || []).forEach((wall) => {
      const interior = wallInterior(wall, level.rooms || []);
      const wins = (wall.openings || []).filter(isRealWindow).map((op) => ({
        lo: inches(op.offset) - WINDOW_TRIM,
        hi: inches(op.offset) + inches(op.width) + WINDOW_TRIM,
      }));
      if (!wins.length) return;
      (level.objects || []).filter((obj) => obj.work !== "demo" && isWallCabinetObject(obj)).forEach((obj) => {
        if (roomOfObject(level, obj)?.id !== room.id) return;
        const span = spanOf(obj, interior);
        if (wins.some((win) => overlapsSpan(span, win))) {
          warnings.push({ severity: "error", code: "pantry-window", text: `Do not place wall cabinets over a window in ${room.name}. Leave the window clear and run cabinets on solid walls.` });
        }
      });
    });

    const access = (level.walls || []).some((wall) => {
      const len = Math.hypot(inches(wall.x2) - inches(wall.x1), inches(wall.y2) - inches(wall.y1)) || 1;
      const ux = (inches(wall.x2) - inches(wall.x1)) / len;
      const uy = (inches(wall.y2) - inches(wall.y1)) / len;
      return (wall.openings || []).some((op) => {
        if (op.type !== "door" && op.type !== "cased") return false;
        const mid = inches(op.offset) + inches(op.width) / 2;
        const x = inches(wall.x1) + ux * mid;
        const y = inches(wall.y1) + uy * mid;
        const inPantry = x >= inches(room.x) - 10 && x <= inches(room.x) + inches(room.width) + 10
          && y >= inches(room.y) - 10 && y <= inches(room.y) + inches(room.depth) + 10;
        if (!kitchen) return inPantry;
        const inKitchen = x >= inches(kitchen.x) - 10 && x <= inches(kitchen.x) + inches(kitchen.width) + 10
          && y >= inches(kitchen.y) - 10 && y <= inches(kitchen.y) + inches(kitchen.depth) + 10;
        return inPantry && inKitchen;
      });
    });
    if (!access) {
      warnings.push({ severity: "error", code: "pantry-access", text: `Add a clear doorway or cased opening from the kitchen into ${room.name}.` });
    }
  });
}

function evaluateLaundry(level, warnings) {
  caseworkOf(level).forEach((obj) => {
    const room = roomOfObject(level, obj);
    if (!isLaundryRoom(room)) return;
    if (isIslandObject(obj)) {
      warnings.push({ severity: "warn", code: "laundry-float", text: `${named(obj)} in ${room.name} should be wall-run casework, not a floating island.` });
      return;
    }
    const fp = objectFootprint(obj);
    const cx = fp.x + fp.w / 2;
    const cy = fp.y + fp.h / 2;
    let best = 999;
    (level.walls || []).forEach((wall) => {
      const interior = wallInterior(wall, level.rooms || []);
      const corners = [[fp.x, fp.y], [fp.x + fp.w, fp.y], [fp.x, fp.y + fp.h], [fp.x + fp.w, fp.y + fp.h]];
      const back = Math.min(...corners.map(([x, y]) => (x - interior.fx1) * interior.nx + (y - interior.fy1) * interior.ny));
      const along = alongOf(interior, cx, cy);
      if (along < -8 || along > interior.len + 8) return;
      if (back < best) best = back;
    });
    if (best > FLOAT_GAP) {
      warnings.push({ severity: "error", code: "laundry-float", text: `${named(obj)} in ${room.name} is ${formatFtIn(best)} off the wall. Laundry and mud-room cabinets must sit on the interior face — no floating boxes or unexplained gaps.` });
    }
  });
}

function evaluateNook(level, warnings) {
  (level?.rooms || []).filter(isNookRoom).forEach((room) => {
    const walls = (level.walls || []).filter((wall) => wall.source_room_id === room.id);
    walls.forEach((wall) => {
      const wins = windowSpans(wall);
      if (!wins.length) return;
      const interior = wallInterior(wall, level.rooms || []);
      const builtIns = caseworkOf(level).filter((obj) => {
        const fp = objectFootprint(obj);
        const cx = fp.x + fp.w / 2;
        const cy = fp.y + fp.h / 2;
        const into = (cx - interior.fx1) * interior.nx + (cy - interior.fy1) * interior.ny;
        const along = alongOf(interior, cx, cy);
        return into > -2 && into < 48 && along > -4 && along < interior.len + 4;
      });
      builtIns.forEach((obj) => {
        const mid = (spanOf(obj, interior).lo + spanOf(obj, interior).hi) / 2;
        const centered = wins.some((win) => Math.abs(mid - (win.lo + win.hi) / 2) <= CENTER_TOL);
        const balanced = wins.some((win) => {
          const left = Math.abs(spanOf(obj, interior).hi - win.lo);
          const right = Math.abs(spanOf(obj, interior).lo - win.hi);
          return Math.abs(left - right) <= CENTER_TOL && left < 60;
        });
        if (!centered && !balanced) {
          warnings.push({ severity: "warn", code: "nook-align", text: `${named(obj)} on the ${room.name} window wall is off-center. Center it on the window or balance matching pieces on both sides.` });
        }
      });
    });
  });
}

export function pantryBlocksSink(level, obj) {
  if (!isSinkLike(obj)) return false;
  const fp = objectFootprint(obj);
  const room = roomContaining(level, fp.x + fp.w / 2, fp.y + fp.h / 2);
  return isPantryRoom(room);
}

export function shouldDimensionObject(obj) {
  if (!obj || obj.work === "demo") return false;
  const id = String(obj.library_id || "");
  if (isCountertopObject(obj) || isFillerObject(obj)) return false;
  if (/^(outlet|switch|light|smoke|co-|vent-|disposal|faucet|hose|supply|drain|panel$)/.test(id)) return false;
  if (id.startsWith("light") || id.startsWith("outlet") || id.startsWith("switch")) return false;
  return isCabinetObject(obj) || isIslandObject(obj) || isBaseRunObject(obj)
    || /^(range|fridge|dw-|washer|dryer|cooktop|oven|micro|hood)/.test(id)
    || id.startsWith("fp-") || id.startsWith("vanity") || id.startsWith("tub") || id.startsWith("shower") || id.startsWith("toilet");
}

export function evaluateProfessionalLayout(level) {
  const warnings = [];
  try {
    evaluateIslands(level, warnings);
    evaluateDoors(level, warnings);
    evaluateWindows(level, warnings);
    evaluateVoids(level, warnings);
    evaluatePantry(level, warnings);
    evaluateLaundry(level, warnings);
    evaluateNook(level, warnings);
  } catch (err) {
    console.error("Professional layout evaluation failed", err);
    warnings.push({ severity: "error", code: "pro-eval", text: "Could not finish the professional layout check." });
  }
  return warnings;
}
