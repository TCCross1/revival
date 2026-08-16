/** Expert kitchen layout engine — NKBA guidelines plus professional design practice. */

import {
  HOUSE_STANDARD_DEFAULTS, applyWallCabinetDrawerRule, defaultCabinetConfig, defaultFuel, isCabinetObject,
  isCountertopObject, isIslandObject, isWallCabinetObject, libraryById,
} from "./library";
import { fitCabinetFillers, objectFootprint, placeFlush, snapCabinetToWall, wallInterior } from "./cabinetRun";
import { fitCountertops } from "./countertops";
import { evaluateProfessionalLayout, pantryBlocksSink } from "./professionalLayout";
import { dist, formatFtIn, inches, round2, uid } from "./units";

const BASE_WIDTHS = [36, 33, 30, 27, 24, 21, 18, 15, 12, 9];
const MIN_WALK_ONE = 42;
const MIN_WALK_TWO = 48;
const WALKWAY = 36;
const U_SHAPE_CLEAR = 60;
const CORNER = 36;
const CORNER_FILLER = 3;
const MAX_TRIANGLE = 26 * 12;
const MIN_TRIANGLE_LEG = 4 * 12;
const MAX_TRIANGLE_LEG = 9 * 12;
const ISLAND_CROSS_MAX = 12;
const SINK_LAND_A = 24;
const SINK_LAND_B = 18;
const SINK_PREP = 36;
const DW_MAX_FROM_SINK = 36;
const DW_STANDING = 21;
const FRIDGE_LAND = 15;
const FRIDGE_ACROSS = 48;
const RANGE_LAND_A = 12;
const RANGE_LAND_B = 15;
const RANGE_BEHIND_ISLAND = 9;
const HOOD_CLEAR = 24;
const COMBUSTIBLE_CLEAR = 30;
const ENTRY_DOOR_MIN = 32;
const WINDOW_TRIM = 3;
const OPERABLE = new Set(["casement", "awning", "double-hung", "single-hung", "slider", "sliding"]);

export function emptyKitchenDesign() {
  return {
    ceiling_height: 96,
    soffit_in: 0,
    fuel: "electric",
    range_width: 30,
    fridge_width: 36,
    sink_width: 36,
    cooks: 1,
    handedness: "right",
    dw_side: "left",
    seed: 0,
    island_enabled: true,
    style: {
      door_style: "shaker",
      finish: "white",
      species: "painted",
      hardware_finish: "brass",
      hardware_style: "bar",
      hardware_size: "5",
      wall_glass: false,
      glass: "clear",
      counter_material: "quartz",
    },
  };
}

export function kitchenDesignOf(doc) {
  const base = emptyKitchenDesign();
  const raw = doc?.kitchen_design || {};
  const handedness = raw.handedness || base.handedness;
  return {
    ...base,
    ...raw,
    handedness,
    dw_side: raw.dw_side || (handedness === "left" ? "right" : "left"),
    style: { ...base.style, ...(raw.style || {}) },
  };
}

export function kitchenRoom(level) {
  const rooms = level?.rooms || [];
  return rooms.find((room) => /kitchen|kit\b/i.test(String(room.name || ""))) || rooms[0] || null;
}

function libOr(id, fallbackId) {
  return libraryById(id) || libraryById(fallbackId);
}

function rangeLib(design) {
  const w = Number(design.range_width) === 36 ? 36 : 30;
  if (design.fuel === "induction") return libOr(`range-induction-${w}`, "range-30");
  if (design.fuel === "electric") return libOr(`range-${w}`, "range-30");
  return libOr(`range-gas-${w}`, "range-30");
}

function fridgeLib(design) {
  const w = Number(design.fridge_width) || 36;
  return libOr(`fridge-${w}`, "fridge-36");
}

function sinkLib(design) {
  const w = [42, 36, 33, 30, 24].includes(Number(design.sink_width)) ? Number(design.sink_width) : 36;
  return libOr(`cab-sink-${w}`, "cab-sink-36");
}

function makeItem(lib, x, y, extra, standards) {
  const house = { ...HOUSE_STANDARD_DEFAULTS, ...(standards || {}) };
  const tags = lib.tags || [];
  return {
    id: uid(),
    library_id: lib.id,
    name: extra?.name || lib.name,
    group: lib.group || "Kitchen",
    tags,
    x: round2(x),
    y: round2(y),
    width: extra?.width ?? lib.width,
    depth: extra?.depth ?? lib.depth,
    height: extra?.height ?? lib.height,
    rotation: 0,
    front: extra?.front || "south",
    wall_id: extra?.wall_id || "",
    finish: extra?.finish || house.finish || "white",
    work: "new",
    note: extra?.note || "",
    door_style: extra?.door_style || house.door_style || "shaker",
    glass: extra?.glass || "",
    species: extra?.species || house.species || "painted",
    config: extra?.config || defaultCabinetConfig(lib),
    hardware_finish: extra?.hardware_finish || house.hardware_finish || "brass",
    hardware_style: extra?.hardware_style || house.hardware_style || "bar",
    hardware_size: extra?.hardware_size || house.hardware_size || "5",
    counter_material: extra?.counter_material || house.counter_material || "carrara",
    appliance_finish: extra?.appliance_finish || house.appliance_finish || "stainless",
    fuel: extra?.fuel || defaultFuel(lib) || "",
    auto: Boolean(extra?.auto_fill),
    auto_fill: Boolean(extra?.auto_fill),
    locked: Boolean(extra?.locked),
    anchor: extra?.anchor || "",
    ...extra,
  };
}

function rotate(list, seed) {
  const n = Math.abs(Number(seed) || 0) % Math.max(list.length, 1);
  return [...list.slice(n), ...list.slice(0, n)];
}

function packWidths(gap, seed = 0, prefer = []) {
  const pieces = [];
  let remain = round2(Math.max(gap, 0));
  prefer.forEach((pref) => {
    if (pref.width <= remain + 0.05) {
      pieces.push(pref);
      remain = round2(remain - pref.width);
    }
  });
  const order = rotate(BASE_WIDTHS, seed);
  let guard = 0;
  while (remain >= 9 && guard < 24) {
    guard += 1;
    const fit = order.find((w) => w <= remain);
    if (!fit) break;
    pieces.push({ kind: "base", width: fit, library_id: `cab-base-${fit}` });
    remain = round2(remain - fit);
  }
  if (remain >= 9) {
    pieces.push({ kind: "base", width: 9, library_id: "cab-base-9" });
    remain = round2(remain - 9);
  }
  return { pieces, remainder: remain };
}

function wallRuns(level, room) {
  const walls = (level?.walls || []).filter((wall) => !room || wall.source_room_id === room.id);
  return walls.map((wall) => ({ wall, interior: wallInterior(wall, level?.rooms || []) })).filter((row) => row.interior.horizontal || row.interior.vertical);
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

function occupiedSpans(level, interior, wall) {
  const spans = [];
  (wall.openings || []).forEach((op) => {
    if (op.type !== "door" && op.type !== "cased") return;
    const lo = inches(op.offset);
    spans.push({ lo, hi: lo + inches(op.width), kind: "door" });
  });
  (level?.objects || []).forEach((obj) => {
    if (!obj || isCountertopObject(obj)) return;
    if (obj.auto && (obj.tags || []).includes("filler")) return;
    if (obj.auto_fill && !obj.locked && !obj.anchor) return;
    const fp = objectFootprint(obj);
    const cx = fp.x + fp.w / 2;
    const cy = fp.y + fp.h / 2;
    const into = (cx - interior.fx1) * interior.nx + (cy - interior.fy1) * interior.ny;
    if (into < -2 || into > inches(obj.depth) + 14) return;
    const along = alongOf(interior, cx, cy);
    if (along < -4 || along > interior.len + 4) return;
    const span = spanOf(obj, interior);
    spans.push({ lo: span.lo, hi: span.hi, kind: obj.anchor || obj.library_id || "object", obj });
  });
  return spans.sort((a, b) => a.lo - b.lo);
}

function gapsFromSpans(len, spans) {
  const gaps = [];
  let cursor = 0;
  spans.forEach((span) => {
    const lo = Math.max(span.lo, 0);
    const hi = Math.min(span.hi, len);
    if (lo - cursor >= 9) gaps.push({ lo: cursor, hi: lo });
    cursor = Math.max(cursor, hi);
  });
  if (len - cursor >= 9) gaps.push({ lo: cursor, hi: len });
  return gaps;
}

function windowSpans(wall) {
  return (wall.openings || []).filter((op) => op && op.type === "window" && !op.dimension && inches(op.width) >= 12).map((op) => ({
    lo: inches(op.offset),
    hi: inches(op.offset) + inches(op.width),
    height: inches(op.height || 48),
    sill: inches(op.sill || 24),
    style: String(op.style || "double-hung"),
    operable: OPERABLE.has(String(op.style || "double-hung")),
  }));
}

function overlapsSpan(a, b) {
  return Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo) > 1;
}

function isOperableWindow(op) {
  return OPERABLE.has(String(op?.style || "double-hung"));
}

function pickBaseLib(piece, hints) {
  if (piece.library_id && libraryById(piece.library_id)) return libraryById(piece.library_id);
  const w = piece.width;
  if (hints?.nearRange && (w === 12 || w === 15 || w === 18 || w === 21 || w === 24)) {
    return libOr(`cab-utensil-${w}`, libOr(`cab-drawers-3-${w}`, `cab-base-${w}`));
  }
  if (hints?.pots && w >= 24) return libOr(`cab-drawers-3-${w}`, `cab-base-${w}`);
  if (hints?.nearFridge && w >= 18) return libOr(`cab-tall-${Math.min(w, 24)}`, `cab-base-${w}`);
  return libOr(`cab-base-${w}`, w < 24 ? "cab-base-18" : "cab-base-24");
}

function placeOnRun(lib, interior, start, extra, standards) {
  const stub = makeItem(lib, 0, 0, extra, standards);
  return placeFlush(stub, interior, start);
}

function centerOf(obj) {
  const fp = objectFootprint(obj);
  return { x: fp.x + fp.w / 2, y: fp.y + fp.h / 2 };
}

function findAnchor(objects, kind, test) {
  return (objects || []).find((obj) => obj.anchor === kind || test(String(obj.library_id || "")));
}

function kitchenObjects(level) {
  const objects = level?.objects || [];
  return {
    range: findAnchor(objects, "range", (id) => id.startsWith("range") || id.startsWith("cooktop")),
    fridge: findAnchor(objects, "fridge", (id) => id.startsWith("fridge")),
    sink: findAnchor(objects, "sink", (id) => id.startsWith("cab-sink") || id.includes("sink")),
    dw: findAnchor(objects, "dishwasher", (id) => id.startsWith("dw-")),
    island: objects.find(isIslandObject) || null,
    hood: objects.find((obj) => String(obj.library_id || "").startsWith("hood")) || null,
  };
}

function hoodNearCooking(level, range) {
  if (!range) return false;
  return (level?.objects || []).some((obj) => {
    const id = String(obj.library_id || "");
    if (!id.startsWith("hood") && !(obj.tags || []).includes("hood")) return false;
    return dist(centerOf(obj).x, centerOf(obj).y, centerOf(range).x, centerOf(range).y) < inches(range.width) / 2 + 20;
  });
}

function runForObject(level, obj) {
  if (!obj) return null;
  const wall = (level?.walls || []).find((w) => w.id && w.id === obj.wall_id)
    || (level?.walls || []).find((w) => {
      const interior = wallInterior(w, level?.rooms || []);
      const fp = objectFootprint(obj);
      const cx = fp.x + fp.w / 2;
      const cy = fp.y + fp.h / 2;
      const into = (cx - interior.fx1) * interior.nx + (cy - interior.fy1) * interior.ny;
      const along = alongOf(interior, cx, cy);
      return into > -2 && into < inches(obj.depth) + 16 && along > -4 && along < interior.len + 4;
    });
  if (!wall) return null;
  return { wall, interior: wallInterior(wall, level?.rooms || []) };
}

function landingsAlongRun(obj, level) {
  const run = runForObject(level, obj);
  if (!run) return { left: 0, right: 0 };
  const self = spanOf(obj, run.interior);
  const others = (level.objects || []).filter((other) => {
    if (!other || other.id === obj.id) return false;
    if (isWallCabinetObject(other) || isCountertopObject(other) || isIslandObject(other)) return false;
    if (String(other.library_id || "").startsWith("hood")) return false;
    const fp = objectFootprint(other);
    const cx = fp.x + fp.w / 2;
    const cy = fp.y + fp.h / 2;
    const into = (cx - run.interior.fx1) * run.interior.nx + (cy - run.interior.fy1) * run.interior.ny;
    if (into < -2 || into > inches(other.depth) + 14) return false;
    return true;
  }).map((other) => spanOf(other, run.interior));
  const leftHit = others.filter((s) => s.hi <= self.lo + 0.5).sort((a, b) => b.hi - a.hi)[0];
  const rightHit = others.filter((s) => s.lo >= self.hi - 0.5).sort((a, b) => a.lo - b.lo)[0];
  return {
    left: round2(self.lo - (leftHit ? leftHit.hi : 0)),
    right: round2((rightHit ? rightHit.lo : run.interior.len) - self.hi),
    run,
    self,
  };
}

function clipSegLen(x1, y1, x2, y2, rect) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  let t0 = 0;
  let t1 = 1;
  const clips = [
    [-dx, x1 - rect.x],
    [dx, rect.x + rect.w - x1],
    [-dy, y1 - rect.y],
    [dy, rect.y + rect.h - y1],
  ];
  for (let i = 0; i < clips.length; i += 1) {
    const [p, q] = clips[i];
    if (Math.abs(p) < 0.001) {
      if (q < 0) return 0;
    } else {
      const r = q / p;
      if (p < 0) {
        if (r > t1) return 0;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return 0;
        if (r < t1) t1 = r;
      }
    }
  }
  if (t1 < t0) return 0;
  return dist(x1 + dx * t0, y1 + dy * t0, x1 + dx * t1, y1 + dy * t1);
}

function triangleCrossesIsland(a, b, c, island) {
  if (!island) return 0;
  const fp = objectFootprint(island);
  const rect = { x: fp.x, y: fp.y, w: fp.w, h: fp.h };
  return Math.max(
    clipSegLen(a.x, a.y, b.x, b.y, rect),
    clipSegLen(b.x, b.y, c.x, c.y, rect),
    clipSegLen(c.x, c.y, a.x, a.y, rect),
  );
}

function doorCutsTriangle(level, a, b, c) {
  const room = kitchenRoom(level);
  if (!room) return false;
  const cx = inches(room.x) + inches(room.width) / 2;
  const cy = inches(room.y) + inches(room.depth) / 2;
  return (level.walls || []).some((wall) => (wall.openings || []).some((op) => {
    if (op.type !== "door") return false;
    if (inches(op.width) < 30) return false;
    const interior = wallInterior(wall, level.rooms || []);
    const mid = inches(op.offset) + inches(op.width) / 2;
    const dx = interior.fx1 + interior.ux * mid;
    const dy = interior.fy1 + interior.uy * mid;
    const ix = dx + interior.nx * 48;
    const iy = dy + interior.ny * 48;
    const path = clipSegLen(dx, dy, cx, cy, {
      x: Math.min(a.x, b.x, c.x) - 4,
      y: Math.min(a.y, b.y, c.y) - 4,
      w: Math.max(a.x, b.x, c.x) - Math.min(a.x, b.x, c.x) + 8,
      h: Math.max(a.y, b.y, c.y) - Math.min(a.y, b.y, c.y) + 8,
    });
    return path > 18 && dist(dx, dy, ix, iy) > 1;
  }));
}

export function siteConditionReport(level, design) {
  const cfg = { ...emptyKitchenDesign(), ...design };
  const room = kitchenRoom(level);
  const walls = (level?.walls || []).filter((wall) => !room || wall.source_room_id === room.id);
  const windows = [];
  const doors = [];
  walls.forEach((wall) => {
    (wall.openings || []).forEach((op) => {
      const row = {
        id: op.id,
        type: op.type,
        width: inches(op.width),
        height: inches(op.height || (op.type === "window" ? 48 : 80)),
        sill: inches(op.sill || 0),
        style: op.style || "",
        wall_id: wall.id,
        operable: op.type === "window" && isOperableWindow(op),
      };
      if (op.type === "window") windows.push(row);
      if (op.type === "door" || op.type === "cased") doors.push(row);
    });
  });
  const anchors = kitchenAnchorStatus(level);
  return {
    room: room ? { id: room.id, name: room.name, width: inches(room.width), depth: inches(room.depth) } : null,
    anchors,
    windows,
    doors,
    ceiling_height: cfg.ceiling_height,
    soffit_in: cfg.soffit_in,
    fuel: cfg.fuel,
    cooks: cfg.cooks,
    ready: Boolean(room && anchors.range && anchors.fridge && anchors.sink),
  };
}

export function placeKitchenAnchor(level, kind, world, design, standards) {
  try {
    const cfg = kitchenDesignOf({ kitchen_design: design });
    const others = (level.objects || []).filter((obj) => obj.anchor !== kind);
    let lib;
    const extra = { locked: true, anchor: kind, auto_fill: false, work: "new" };
    if (kind === "range") {
      lib = rangeLib(cfg);
      extra.fuel = cfg.fuel === "induction" ? "induction" : cfg.fuel === "electric" ? "electric" : "gas";
      extra.width = Number(cfg.range_width) === 36 ? 36 : 30;
      extra.depth = 24;
    } else if (kind === "fridge") {
      lib = fridgeLib(cfg);
      extra.width = Number(cfg.fridge_width) || 36;
      extra.depth = 24;
    } else if (kind === "sink") {
      lib = sinkLib(cfg);
      extra.width = Number(cfg.sink_width) || 36;
      extra.config = "sink";
      extra.depth = 24;
    } else if (kind === "dishwasher") {
      lib = libOr("dw-24", "dw-24");
      extra.width = 24;
      extra.depth = 24;
    } else {
      return { ...level, objects: others };
    }
    const draft = makeItem(lib, world.x - lib.width / 2, world.y - lib.depth / 2, extra, standards);
    if (pantryBlocksSink({ ...level, objects: others.concat(draft) }, draft)) {
      return {
        ...level,
        objects: others,
        _kitchenError: "A pantry may contain only cabinets, shelves, and storage — never a sink.",
      };
    }
    if (kind === "dishwasher") {
      const sink = others.find((obj) => obj.anchor === "sink");
      if (sink) {
        const side = cfg.dw_side === "left" ? -1 : 1;
        draft.x = round2(sink.x + (side > 0 ? inches(sink.width) : -inches(lib.width)));
        draft.y = sink.y;
        draft.front = sink.front;
        draft.wall_id = sink.wall_id || "";
      }
    }
    const snapped = snapCabinetToWall(draft, { ...level, objects: others }, 1).object;
    let objects = [...others, snapped];
    if (kind === "sink") {
      const dwLib = libOr("dw-24", "dw-24");
      const side = cfg.dw_side === "left" ? -1 : 1;
      const dw = makeItem(dwLib, snapped.x + (side > 0 ? inches(snapped.width) : -inches(dwLib.width)), snapped.y, {
        locked: true, anchor: "dishwasher", auto_fill: false, front: snapped.front, wall_id: snapped.wall_id || "", width: 24, depth: 24,
      }, standards);
      objects = objects.filter((obj) => obj.anchor !== "dishwasher").concat(snapCabinetToWall(dw, { ...level, objects }, 1).object);
    }
    return finishKitchenLevel({ ...level, objects }, standards);
  } catch (err) {
    console.error("Kitchen anchor placement failed", err);
    return level;
  }
}

export function ensureRangeHood(level, standards) {
  try {
    const { range } = kitchenObjects(level);
    if (!range) return level;
    const covered = (level.objects || []).some((obj) => {
      const id = String(obj.library_id || "");
      if (!id.startsWith("hood") && !(obj.tags || []).includes("hood")) return false;
      return dist(centerOf(obj).x, centerOf(obj).y, centerOf(range).x, centerOf(range).y) < inches(range.width) / 2 + 20;
    });
    if (covered) return level;
    const w = inches(range.width) >= 36 ? 36 : 30;
    const lib = libOr(`hood-wall-${w}`, libOr("hood-under-30", "hood-wall-30"));
    if (!lib) return level;
    const hood = makeItem(lib, range.x, range.y, {
      auto_fill: true,
      locked: false,
      front: range.front,
      wall_id: range.wall_id || "",
      width: w,
      depth: lib.depth || 20,
    }, standards);
    return { ...level, objects: [...(level.objects || []), hood] };
  } catch (err) {
    console.error("Range hood placement failed", err);
    return level;
  }
}

function finishKitchenLevel(level, standards) {
  const withHood = ensureRangeHood(level, standards);
  const objects = (withHood.objects || []).map((obj) => applyWallCabinetDrawerRule(obj, withHood));
  return fitCabinetFillers({ ...withHood, objects });
}

function addUtensilHint(gap, interior, level) {
  const { range, fridge, sink } = kitchenObjects(level);
  const near = (obj) => {
    if (!obj) return false;
    const span = spanOf(obj, interior);
    return Math.abs(gap.lo - span.hi) < 2 || Math.abs(gap.hi - span.lo) < 2;
  };
  return {
    nearRange: near(range),
    pots: range ? Math.abs(gap.lo - spanOf(range, interior).hi) < 20 || Math.abs(gap.hi - spanOf(range, interior).lo) < 20 : false,
    nearFridge: near(fridge),
    nearSink: sink ? Math.abs(gap.lo - spanOf(sink, interior).hi) < 8 || Math.abs(gap.hi - spanOf(sink, interior).lo) < 8 : false,
  };
}

function fillBaseGap(level, run, gap, design, standards, seed) {
  const placed = [];
  const hints = addUtensilHint(gap, run.interior, level);
  const prefer = [];
  if (hints.nearRange) prefer.push({ kind: "base", width: 18, library_id: "cab-utensil-18" });
  if (hints.pots && gap.hi - gap.lo >= 36) prefer.push({ kind: "base", width: 36, library_id: "cab-drawers-3-36" });
  if (hints.nearFridge && gap.hi - gap.lo >= 21) prefer.push({ kind: "base", width: 18, library_id: "cab-tall-18" });
  const packed = packWidths(gap.hi - gap.lo, seed, prefer);
  let cursor = gap.lo;
  packed.pieces.forEach((piece) => {
    const lib = pickBaseLib(piece, hints);
    if (!lib) return;
    const obj = placeOnRun(lib, run.interior, cursor, {
      auto_fill: true,
      locked: false,
      width: piece.width,
      depth: 24,
      config: defaultCabinetConfig(lib),
    }, standards);
    placed.push(obj);
    cursor += piece.width;
  });
  return placed;
}

function placeCorners(level, runs, standards) {
  const placed = [];
  const claimed = new Set();
  const lib = libOr("cab-corner-36", "cab-corner-33");
  const wallLib = libOr("cab-wall-corner-24", "cab-wall-corner-36");
  if (!lib) return placed;
  runs.forEach((run, idx) => {
    const next = runs[(idx + 1) % runs.length];
    if (!next || run.wall.id === next.wall.id) return;
    const join = dist(run.wall.x2, run.wall.y2, next.wall.x1, next.wall.y1) < 4;
    if (!join) return;
    const key = [run.wall.id, next.wall.id].sort().join(":");
    if (claimed.has(key)) return;
    if (run.interior.len < CORNER + CORNER_FILLER + 12 || next.interior.len < CORNER + CORNER_FILLER + 12) return;
    const occA = occupiedSpans(level, run.interior, run.wall);
    const occB = occupiedSpans(level, next.interior, next.wall);
    const startClear = !occA.some((s) => s.lo < CORNER && s.hi > 1);
    const nextClear = !occB.some((s) => s.lo < CORNER && s.hi > 1);
    if (!startClear || !nextClear) return;
    const atEnd = dist(run.wall.x2, run.wall.y2, next.wall.x1, next.wall.y1) < 4;
    const start = atEnd ? Math.max(0, run.interior.len - CORNER) : 0;
    placed.push(placeOnRun(lib, run.interior, start, {
      auto_fill: true, locked: false, width: CORNER, depth: CORNER, config: "lazy-susan",
    }, standards));
    if (wallLib) {
      placed.push(placeOnRun(wallLib, run.interior, start, {
        auto_fill: true, locked: false, width: 24, depth: 24, height: 30, config: "lazy-susan",
      }, standards));
    }
    claimed.add(key);
  });
  return placed;
}

function wallSkipZones(run, level) {
  const { sink, range, fridge } = kitchenObjects(level);
  const windows = windowSpans(run.wall).map((w) => ({ lo: w.lo - WINDOW_TRIM, hi: w.hi + WINDOW_TRIM, kind: "window" }));
  const skip = [...windows];
  if (range && range.wall_id === run.wall.id) skip.push({ ...spanOf(range, run.interior), kind: "range" });
  if (fridge && fridge.wall_id === run.wall.id) skip.push({ ...spanOf(fridge, run.interior), kind: "fridge" });
  if (sink && sink.wall_id === run.wall.id) {
    const ss = spanOf(sink, run.interior);
    const overWindow = windowSpans(run.wall).some((w) => overlapsSpan(ss, w));
    if (overWindow) skip.push({ lo: ss.lo - WINDOW_TRIM, hi: ss.hi + WINDOW_TRIM, kind: "sink-window" });
  }
  return skip;
}

function placeWallCabinets(level, run, design, standards) {
  const placed = [];
  const skip = wallSkipZones(run, level);
  const { range, fridge, sink } = kitchenObjects(level);
  const bases = (level.objects || []).filter((obj) => obj.wall_id === run.wall.id && !isIslandObject(obj) && !isWallCabinetObject(obj) && !isCountertopObject(obj));
  bases.forEach((base) => {
    const span = spanOf(base, run.interior);
    if (skip.some((s) => overlapsSpan(span, s))) return;
    if (String(base.library_id || "").includes("tall") || String(base.library_id || "").includes("corner")) return;
    const w = inches(base.width);
    const lib = libOr(`cab-wall-${w >= 36 ? (w > 42 ? 48 : w > 36 ? 42 : 36) : w}`, w >= 24 ? "cab-wall-30" : "cab-wall-18");
    if (!lib) return;
    const height = design.soffit_in > 0 ? Math.max(18, (design.ceiling_height || 96) - 54 - design.soffit_in) : lib.height;
    placed.push(placeOnRun({ ...lib, width: w, depth: 12, height }, run.interior, span.lo, {
      auto_fill: true, locked: false, width: w, depth: 12, height, config: "doors",
    }, standards));
  });
  if (sink && sink.wall_id === run.wall.id) {
    const ss = spanOf(sink, run.interior);
    const win = windowSpans(run.wall).find((w) => overlapsSpan(ss, w));
    if (win) {
      const shelf = libOr("cab-shelf-36", "cab-shelf-30");
      if (shelf && win.height <= 30) {
        placed.push(placeOnRun(shelf, run.interior, ss.lo, {
          auto_fill: true, locked: false, width: Math.min(inches(sink.width), 36), depth: 12, height: 12, config: "shelf",
          note: "Bridge shelf only — window over sink, no full-height wall cabinet",
        }, standards));
      }
    }
  }
  if (range && range.wall_id === run.wall.id) {
    const w = inches(range.width) >= 36 ? 36 : 30;
    const hood = libOr(`hood-under-${w}`, libOr("hood-under-30", "hood-wall-30"));
    const span = spanOf(range, run.interior);
    placed.push(placeOnRun(hood, run.interior, span.lo, {
      auto_fill: true, locked: false, width: w, depth: hood.depth, height: hood.height,
    }, standards));
  }
  if (fridge && fridge.wall_id === run.wall.id) {
    const w = inches(fridge.width) >= 36 ? 36 : 30;
    const over = libOr(`cab-wall-fridge-${w}`, "cab-wall-fridge-36");
    const span = spanOf(fridge, run.interior);
    placed.push(placeOnRun(over, run.interior, span.lo, {
      auto_fill: true, locked: false, width: w, depth: 12, height: 18, config: "fridge-wall",
    }, standards));
  }
  return placed;
}

export function autoFillKitchen(level, design, standards) {
  try {
    const cfg = kitchenDesignOf({ kitchen_design: design });
    const room = kitchenRoom(level);
    if (!room) return { level, warnings: [{ severity: "error", code: "room", text: "Draw the kitchen room first, then mark the four utility locations." }], island: null };
    const kept = (level.objects || []).filter((obj) => obj.locked || obj.anchor || !obj.auto_fill);
    let next = { ...level, objects: kept };
    const runs = wallRuns(next, room);
    if (!runs.length) return { level: next, warnings: [{ severity: "error", code: "walls", text: "This kitchen has no walls to fill." }], island: null };

    const corners = placeCorners(next, runs, standards);
    next = { ...next, objects: [...next.objects, ...corners] };

    runs.forEach((run, i) => {
      const occ = occupiedSpans(next, run.interior, run.wall);
      gapsFromSpans(run.interior.len, occ).forEach((gap) => {
        const filled = fillBaseGap(next, run, gap, cfg, standards, cfg.seed + i);
        next = { ...next, objects: [...next.objects, ...filled] };
      });
    });

    const walls = [];
    runs.forEach((run) => {
      walls.push(...placeWallCabinets(next, run, cfg, standards));
    });
    next = { ...next, objects: [...next.objects, ...walls] };

    const island = cfg.island_enabled ? suggestIsland(next, cfg, standards) : null;
    if (island?.object) next = { ...next, objects: [...next.objects, island.object] };

    next = finishKitchenLevel(next, standards);
    const warnings = evaluateKitchen(next, cfg);
    return { level: next, warnings, island };
  } catch (err) {
    console.error("Kitchen auto-fill failed", err);
    return { level, warnings: [{ severity: "error", code: "autofill", text: "Auto-fill failed. Check the room walls and try again." }], island: null };
  }
}

export function suggestIsland(level, design, standards) {
  try {
    const cfg = kitchenDesignOf({ kitchen_design: design });
    const room = kitchenRoom(level);
    if (!room) return { ok: false, reason: "No kitchen room.", object: null };
    const minWalk = Number(cfg.cooks) >= 2 ? MIN_WALK_TWO : MIN_WALK_ONE;
    const bases = (level.objects || []).filter((obj) => !isIslandObject(obj) && (isCabinetObject(obj) || obj.anchor) && !isWallCabinetObject(obj) && !isCountertopObject(obj));
    const pad = minWalk + 24;
    const x1 = inches(room.x) + pad;
    const y1 = inches(room.y) + pad;
    const x2 = inches(room.x) + inches(room.width) - pad;
    const y2 = inches(room.y) + inches(room.depth) - pad;
    const freeW = x2 - x1;
    const freeD = y2 - y1;
    if (freeW < 36 || freeD < 24) {
      return { ok: false, reason: `Not enough clear floor for an island. Need ${formatFtIn(minWalk)} work aisles on all sides.`, object: null };
    }
    const width = freeW >= 96 ? 96 : freeW >= 84 ? 84 : freeW >= 72 ? 72 : Math.floor(freeW / 6) * 6;
    const depth = freeD >= 42 ? 42 : 36;
    if (width < 48) return { ok: false, reason: "The remaining floor is too tight for a useful island.", object: null };
    const lib = libOr(width >= 96 ? "island-96" : width >= 84 ? "island-seat-84" : "island-72", "island-72");
    const obj = makeItem(lib, round2((x1 + x2) / 2 - width / 2), round2((y1 + y2) / 2 - depth / 2), {
      auto_fill: true,
      locked: false,
      width,
      depth,
      overhang: depth >= 42 ? 15 : 0,
    }, standards);
    const blocked = bases.some((other) => {
      const a = objectFootprint(obj);
      const b = objectFootprint(other);
      const gapX = Math.max(a.x, b.x) < Math.min(a.x + a.w, b.x + b.w) ? 0 : Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w);
      const gapY = Math.max(a.y, b.y) < Math.min(a.y + a.h, b.y + b.h) ? 0 : Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h);
      return gapX < minWalk && gapY < minWalk;
    });
    if (blocked) return { ok: false, reason: `An island here would pinch a work aisle under ${formatFtIn(minWalk)}.`, object: null };
    return {
      ok: true,
      reason: `${formatFtIn(width)} × ${formatFtIn(depth)} island with ${formatFtIn(minWalk)} work aisles.`,
      object: obj,
    };
  } catch (err) {
    console.error("Island feasibility failed", err);
    return { ok: false, reason: "Could not evaluate an island.", object: null };
  }
}

export function evaluateKitchen(level, design) {
  const warnings = [];
  try {
    const cfg = kitchenDesignOf({ kitchen_design: design });
    const minWalk = Number(cfg.cooks) >= 2 ? MIN_WALK_TWO : MIN_WALK_ONE;
    const { range, fridge, sink, dw, island } = kitchenObjects(level);
    const site = siteConditionReport(level, cfg);

    if (!site.room) warnings.push({ severity: "error", code: "room", text: "Draw the kitchen room before placing cabinets." });
    if (!range) warnings.push({ severity: "warn", code: "anchor-range", text: "Mark the range / cooktop utility (gas shutoff or 240V) before auto-fill." });
    if (!fridge) warnings.push({ severity: "warn", code: "anchor-fridge", text: "Mark the refrigerator location and its dedicated outlet." });
    if (!sink) warnings.push({ severity: "warn", code: "anchor-sink", text: "Mark the sink over the existing plumbing rough-in." });
    if (sink && !dw) warnings.push({ severity: "warn", code: "anchor-dw", text: "Place a 24\" dishwasher immediately beside the sink." });

    if (sink && dw) {
      const edge = Math.max(0, Math.min(
        Math.abs((centerOf(sink).x - inches(sink.width) / 2) - (centerOf(dw).x + inches(dw.width) / 2)),
        Math.abs((centerOf(dw).x - inches(dw.width) / 2) - (centerOf(sink).x + inches(sink.width) / 2)),
        dist(centerOf(sink).x, centerOf(sink).y, centerOf(dw).x, centerOf(dw).y) - (inches(sink.width) + inches(dw.width)) / 2,
      ));
      if (edge > DW_MAX_FROM_SINK) {
        warnings.push({ severity: "error", code: "dw-distance", text: `Dishwasher nearest edge must be within 36\" of the sink. It is ${formatFtIn(edge)} away.` });
      }
      const dwRun = runForObject(level, dw);
      if (dwRun) {
        const standing = landingsAlongRun(dw, level);
        const rightAngle = (level.objects || []).filter((obj) => obj.id !== dw.id && !isWallCabinetObject(obj) && !isCountertopObject(obj));
        const tight = rightAngle.some((obj) => {
          if (obj.wall_id && obj.wall_id === dw.wall_id) return false;
          const a = objectFootprint(dw);
          const b = objectFootprint(obj);
          const gapX = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w));
          const gapY = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h));
          const orthogonal = (gapX < 2 && gapY > 0 && gapY < DW_STANDING) || (gapY < 2 && gapX > 0 && gapX < DW_STANDING);
          return orthogonal;
        });
        if (tight) warnings.push({ severity: "warn", code: "dw-standing", text: "Keep at least 21\" of standing space between the dishwasher and any cabinet or appliance at a right angle to it." });
        if (standing.left < 1 && standing.right < 1) {
          warnings.push({ severity: "info", code: "dw-beside", text: "Prefer the dishwasher immediately left or right of the sink base." });
        }
      }
    }

    if (sink) {
      const land = landingsAlongRun(sink, level);
      const sides = [land.left, land.right].sort((a, b) => b - a);
      if (!(sides[0] >= SINK_LAND_A && sides[1] >= SINK_LAND_B)) {
        warnings.push({ severity: "warn", code: "sink-landing", text: `Sink landing should be at least 24\" on one side and 18\" on the other (now ${formatFtIn(land.left)} / ${formatFtIn(land.right)}).` });
      }
      const prep = Math.max(land.left, land.right);
      if (prep < SINK_PREP) {
        warnings.push({ severity: "warn", code: "sink-prep", text: "Provide at least 36\" of continuous prep counter next to the sink." });
      }
      const run = runForObject(level, sink);
      if (run) {
        const ss = spanOf(sink, run.interior);
        const wins = windowSpans(run.wall);
        const over = wins.find((w) => overlapsSpan(ss, w));
        if (over) {
          warnings.push({ severity: "info", code: "sink-window", text: "Sink is under a window — full-height wall cabinets are suppressed there. Use open space, a short bridge shelf, or nothing above the faucet." });
          if ((over.sill || 0) > 0 && over.sill < 42) {
            warnings.push({ severity: "warn", code: "sink-faucet", text: `Window sill is ${formatFtIn(over.sill)} AFF. Keep faucet height and sash operation clear of the glass (typical sill is 42").` });
          }
          const overCab = (level.objects || []).find((obj) => {
            if (!isWallCabinetObject(obj) || obj.wall_id !== run.wall.id) return false;
            if (String(obj.library_id || "").includes("shelf") || inches(obj.height) <= 12) return false;
            return overlapsSpan(spanOf(obj, run.interior), { lo: ss.lo - WINDOW_TRIM, hi: ss.hi + WINDOW_TRIM });
          });
          if (overCab) {
            warnings.push({ severity: "error", code: "wall-over-sink", text: "Do not place full-height wall cabinets over a sink that sits under a window. Leave the zone open, use a short bridge shelf, or open shelving." });
          }
          const sinkMid = (ss.lo + ss.hi) / 2;
          const winMid = (over.lo + over.hi) / 2;
          if (Math.abs(sinkMid - winMid) > 6) {
            warnings.push({ severity: "info", code: "sink-window-center", text: "Center the sink under the window when the plumbing rough-in allows." });
          }
        } else if (wins.length) {
          warnings.push({ severity: "info", code: "sink-window-prefer", text: "A window exists on this wall. Professional practice is to center the sink under it when plumbing allows." });
        }
      }
    }

    if (sink && range && fridge) {
      const sinkRun = runForObject(level, sink);
      const rangeRun = runForObject(level, range);
      const fridgeRun = runForObject(level, fridge);
      const related = (objA, runA, objB, runB) => {
        if (!runA || !runB) return true;
        if (runA.wall.id === runB.wall.id) return true;
        const opp = { south: "north", north: "south", east: "west", west: "east" };
        if (opp[objA.front] === objB.front) return true;
        return dist(runA.wall.x2, runA.wall.y2, runB.wall.x1, runB.wall.y1) < 8
          || dist(runA.wall.x1, runA.wall.y1, runB.wall.x2, runB.wall.y2) < 8;
      };
      if (!related(sink, sinkRun, range, rangeRun) || !related(sink, sinkRun, fridge, fridgeRun)) {
        warnings.push({ severity: "warn", code: "sink-adjacent", text: "The sink should be adjacent to or across from the range and refrigerator so the work triangle stays efficient." });
      }
    }

    if (fridge) {
      const land = landingsAlongRun(fridge, level);
      const handleSide = land.right;
      const fp = objectFootprint(fridge);
      const blockedAcross = (level.objects || []).some((obj) => {
        if (obj.id === fridge.id || isWallCabinetObject(obj) || isCountertopObject(obj)) return false;
        const other = objectFootprint(obj);
        let facing = 999;
        if (fridge.front === "south") facing = other.y - (fp.y + fp.h);
        else if (fridge.front === "north") facing = fp.y - (other.y + other.h);
        else if (fridge.front === "east") facing = other.x - (fp.x + fp.w);
        else facing = fp.x - (other.x + other.w);
        const overlap = fridge.front === "east" || fridge.front === "west"
          ? Math.min(fp.y + fp.h, other.y + other.h) - Math.max(fp.y, other.y) > 4
          : Math.min(fp.x + fp.w, other.x + other.w) - Math.max(fp.x, other.x) > 4;
        return overlap && facing >= 0 && facing < FRIDGE_ACROSS;
      });
      if (handleSide < FRIDGE_LAND && land.left < FRIDGE_LAND && blockedAcross) {
        warnings.push({ severity: "warn", code: "fridge-landing", text: "Give the refrigerator at least 15\" of landing on the handle side, or 48\" of clear counter directly across from the door." });
      }
      if (inches(fridge.depth) > 24.25) {
        warnings.push({ severity: "error", code: "fridge-depth", text: "On the 2D working drawing every appliance — including the refrigerator — must be 24\" deep and flush with the base run." });
      }
    }

    if (range) {
      const land = landingsAlongRun(range, level);
      const sides = [land.left, land.right].sort((a, b) => b - a);
      if (!(sides[0] >= RANGE_LAND_B && sides[1] >= RANGE_LAND_A) && !(sides[0] >= RANGE_LAND_A && sides[1] >= RANGE_LAND_B)) {
        warnings.push({ severity: "warn", code: "range-landing", text: `Range landing should be at least 12\" on one side and 15\" on the other (now ${formatFtIn(land.left)} / ${formatFtIn(land.right)}).` });
      }
      if (isIslandObject(range) || (island && dist(centerOf(range).x, centerOf(range).y, centerOf(island).x, centerOf(island).y) < 8)) {
        const behind = inches(island?.depth || range.depth) - 24;
        if (behind < RANGE_BEHIND_ISLAND) {
          warnings.push({ severity: "warn", code: "range-behind", text: "On an island or peninsula, the countertop must extend at least 9\" behind the cooking surface." });
        }
      }
      const run = runForObject(level, range);
      if (run) {
        const rs = spanOf(range, run.interior);
        const overOp = windowSpans(run.wall).find((w) => w.operable && overlapsSpan(rs, w));
        if (overOp) warnings.push({ severity: "error", code: "range-window", text: "Never locate the cooking surface under an operable window." });
      }
      if (!hoodNearCooking(level, range)) {
        warnings.push({ severity: "error", code: "range-hood", text: `Every range or cooktop must have a vent hood shown above it (${formatFtIn(HOOD_CLEAR)} to a protected surface, or ${formatFtIn(COMBUSTIBLE_CLEAR)} to combustible).` });
      }
      const nearUtensil = (level.objects || []).some((obj) => {
        const id = String(obj.library_id || "");
        return (id.includes("utensil") || id.includes("drawers-3")) && dist(centerOf(obj).x, centerOf(obj).y, centerOf(range).x, centerOf(range).y) < inches(range.width) / 2 + 24;
      });
      if (!nearUtensil) warnings.push({ severity: "info", code: "range-storage", text: "Prefer a utensil/spice drawer immediately beside the range and pots-and-pans storage on that run." });
    }

    if (range && fridge) {
      const d = dist(centerOf(range).x, centerOf(range).y, centerOf(fridge).x, centerOf(fridge).y);
      if (d < 30) warnings.push({ severity: "error", code: "range-fridge", text: "Range and refrigerator are too close for clearance and door swing." });
    }

    if (range && sink && fridge) {
      const a = dist(centerOf(sink).x, centerOf(sink).y, centerOf(range).x, centerOf(range).y);
      const b = dist(centerOf(range).x, centerOf(range).y, centerOf(fridge).x, centerOf(fridge).y);
      const c = dist(centerOf(fridge).x, centerOf(fridge).y, centerOf(sink).x, centerOf(sink).y);
      const total = a + b + c;
      if ([a, b, c].some((leg) => leg < MIN_TRIANGLE_LEG)) warnings.push({ severity: "warn", code: "triangle-min", text: "A work-triangle leg is under 4'. Prep space will feel cramped." });
      if ([a, b, c].some((leg) => leg > MAX_TRIANGLE_LEG)) warnings.push({ severity: "warn", code: "triangle-max", text: "A work-triangle leg is over 9'. The kitchen will feel inefficient." });
      if (total > MAX_TRIANGLE) warnings.push({ severity: "warn", code: "triangle-total", text: `Work triangle is ${formatFtIn(total)} — over the 26' NKBA guideline.` });
      const cross = triangleCrossesIsland(centerOf(sink), centerOf(range), centerOf(fridge), island);
      if (cross > ISLAND_CROSS_MAX) {
        warnings.push({ severity: "warn", code: "triangle-island", text: `A work-triangle leg crosses the island by ${formatFtIn(cross)} (limit 12").` });
      }
      if (doorCutsTriangle(level, centerOf(sink), centerOf(range), centerOf(fridge))) {
        warnings.push({ severity: "warn", code: "triangle-traffic", text: "Major traffic from an entry door appears to cut through the work triangle." });
      }
    }

    site.doors.filter((op) => op.type === "door").forEach((op) => {
      if (op.width < ENTRY_DOOR_MIN) {
        warnings.push({ severity: "warn", code: "door-width", text: `Kitchen entry opening is ${formatFtIn(op.width)} — NKBA prefers at least 32\".` });
      }
    });
    (level?.walls || []).forEach((wall) => {
      const doors = (wall.openings || []).filter((op) => op.type === "door");
      doors.forEach((op) => {
        const along = inches(op.offset) + inches(op.width) / 2;
        (level.objects || []).forEach((obj) => {
          if (!obj.wall_id || obj.wall_id !== wall.id) return;
          if (isWallCabinetObject(obj)) return;
          const interior = wallInterior(wall, level.rooms || []);
          const span = spanOf(obj, interior);
          if (along >= span.lo && along <= span.hi) {
            warnings.push({ severity: "error", code: "door-conflict", text: `${obj.name} conflicts with a door swing on that wall.` });
          }
        });
      });
      doors.forEach((a, i) => {
        doors.slice(i + 1).forEach((b) => {
          const gap = Math.abs(inches(a.offset) - inches(b.offset)) - Math.min(inches(a.width), inches(b.width));
          if (gap < 2) warnings.push({ severity: "warn", code: "door-door", text: "Two doors on the same wall interfere with each other." });
        });
      });
    });

    (level?.walls || []).forEach((wall) => {
      const interior = wallInterior(wall, level.rooms || []);
      windowSpans(wall).forEach((win) => {
        const zone = { lo: win.lo - WINDOW_TRIM, hi: win.hi + WINDOW_TRIM };
        const cabs = (level.objects || []).filter((obj) => obj.wall_id === wall.id && isWallCabinetObject(obj) && !String(obj.library_id || "").includes("hood"));
        const leftW = cabs.filter((obj) => spanOf(obj, interior).hi <= zone.lo + 1 && spanOf(obj, interior).hi > zone.lo - 48).reduce((sum, obj) => sum + inches(obj.width), 0);
        const rightW = cabs.filter((obj) => spanOf(obj, interior).lo >= zone.hi - 1 && spanOf(obj, interior).lo < zone.hi + 48).reduce((sum, obj) => sum + inches(obj.width), 0);
        if (leftW > 9 && rightW > 9 && Math.abs(leftW - rightW) > 12) {
          warnings.push({ severity: "info", code: "window-balance", text: `Balance wall cabinets on either side of the ${formatFtIn(win.hi - win.lo)} window and keep about 3\" off the trim.` });
        }
        const overlapping = cabs.find((obj) => overlapsSpan(spanOf(obj, interior), zone) && inches(obj.height) > 18 && !String(obj.library_id || "").includes("shelf"));
        if (overlapping) {
          warnings.push({ severity: "error", code: "wall-over-window", text: "Standard wall cabinets overlap a window. Hold 3\" off the casing, or use a short cabinet / open shelf / leave the opening clear." });
        }
      });
    });

    if (island && site.room) {
      const fp = objectFootprint(island);
      const room = kitchenRoom(level);
      const gaps = [
        fp.x - inches(room.x),
        inches(room.x) + inches(room.width) - (fp.x + fp.w),
        fp.y - inches(room.y),
        inches(room.y) + inches(room.depth) - (fp.y + fp.h),
      ];
      if (gaps.some((v) => v < minWalk)) {
        warnings.push({ severity: "error", code: "aisle-island", text: `Island work aisle is under ${formatFtIn(minWalk)} (${Number(cfg.cooks) >= 2 ? "two cooks" : "one cook"}).` });
      }
      if (gaps.some((v) => v < WALKWAY)) {
        warnings.push({ severity: "warn", code: "walkway", text: "Keep general walkways at least 36\"." });
      }
    }

    const room = kitchenRoom(level);
    if (room) {
      const runs = wallRuns(level, room).filter((run) => (level.objects || []).some((obj) => obj.wall_id === run.wall.id && !isWallCabinetObject(obj) && (isCabinetObject(obj) || obj.anchor)));
      if (runs.length >= 3) {
        const horiz = runs.filter((r) => r.interior.horizontal);
        const vert = runs.filter((r) => r.interior.vertical);
        if (horiz.length >= 2) {
          const clear = Math.abs((horiz[0].interior.fy1 + horiz[0].interior.ny * 24) - (horiz[1].interior.fy1 + horiz[1].interior.ny * 24));
          if (clear < U_SHAPE_CLEAR) warnings.push({ severity: "warn", code: "u-shape", text: `U-shaped kitchens should have about 60\" between opposing counters (now ${formatFtIn(clear)}).` });
        } else if (vert.length >= 2) {
          const clear = Math.abs((vert[0].interior.fx1 + vert[0].interior.nx * 24) - (vert[1].interior.fx1 + vert[1].interior.nx * 24));
          if (clear < U_SHAPE_CLEAR) warnings.push({ severity: "warn", code: "u-shape", text: `U-shaped kitchens should have about 60\" between opposing counters (now ${formatFtIn(clear)}).` });
        }
      }
    }

    if ((cfg.ceiling_height || 96) < 90) warnings.push({ severity: "warn", code: "ceiling", text: "Ceiling under 7'-6\" — confirm wall-cabinet and hood heights." });
    if ((cfg.soffit_in || 0) > 0) warnings.push({ severity: "info", code: "soffit", text: `Soffit/bulkhead ${formatFtIn(cfg.soffit_in)} is reserved above wall cabinets.` });
    if (cfg.fuel === "gas" && range) warnings.push({ severity: "info", code: "gas", text: "Gas range locked to the utility. Confirm shutoff, make-up air, and hood CFM." });
    warnings.push(...evaluateProfessionalLayout(level));
  } catch (err) {
    console.error("Kitchen evaluation failed", err);
    warnings.push({ severity: "error", code: "eval", text: "Could not finish the NKBA check. Review the room and anchors." });
  }
  return warnings;
}

export function applyKitchenStyle(level, style) {
  try {
    const next = { ...emptyKitchenDesign().style, ...style };
    return {
      ...level,
      objects: (level.objects || []).map((obj) => {
        if (!isCabinetObject(obj) && !String(obj.library_id || "").startsWith("filler")) return obj;
        const wallGlass = isWallCabinetObject(obj) && next.wall_glass && !String(obj.library_id || "").includes("hood") && !String(obj.library_id || "").includes("fridge");
        return {
          ...obj,
          door_style: wallGlass ? (String(obj.door_style || "").startsWith("glass") ? obj.door_style : "glass") : next.door_style,
          glass: wallGlass ? (next.glass || "clear") : obj.glass,
          finish: next.finish,
          species: next.species,
          hardware_finish: next.hardware_finish,
          hardware_style: next.hardware_style,
          hardware_size: next.hardware_size,
        };
      }),
    };
  } catch (err) {
    console.error("Kitchen style apply failed", err);
    return level;
  }
}

export function generateKitchenCounters(level, material = "quartz") {
  try {
    return fitCountertops(level, { snap: 1, material: material || "quartz", overhang: 1 });
  } catch (err) {
    console.error("Kitchen countertop silhouette failed", err);
    return level;
  }
}

export function toggleObjectLock(level, objectId) {
  return {
    ...level,
    objects: (level.objects || []).map((obj) => (obj.id === objectId ? { ...obj, locked: !obj.locked } : obj)),
  };
}

export function kitchenAnchorStatus(level) {
  const objects = level?.objects || [];
  const has = (kind, test) => objects.some((obj) => obj.anchor === kind || test(String(obj.library_id || "")));
  return {
    range: has("range", (id) => id.startsWith("range") || id.startsWith("cooktop")),
    fridge: has("fridge", (id) => id.startsWith("fridge")),
    sink: has("sink", (id) => id.startsWith("cab-sink") || id.startsWith("sink")),
    dishwasher: has("dishwasher", (id) => id.startsWith("dw-")),
  };
}
