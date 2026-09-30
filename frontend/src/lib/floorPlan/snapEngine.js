/**
 * Unified residential snap / inference engine (Magicplan-style UX target).
 * Screen pixels drive acquire/release; results are exact world coordinates.
 *
 * Priority tiers during Point & Line (higher tier always wins when in range):
 * CLOSE ROOM > corner / endpoint / vertex > align·level (same X or Y as a corner,
 * combined with perpendicular / ortho) > intersection with an existing wall >
 * midpoint > perpendicular > match size > ortho > grid > free.
 * Within a tier the nearest candidate wins. Hysteresis never lets a sticky
 * lower-tier snap block a higher-tier snap that is inside the acquire radius.
 */

import { dist, inches, round2, snapTo } from "./units";

export const SNAP_CONFIG = {
  /** Screen px — enter sticky snap */
  acquireRadiusPx: 14,
  /** Screen px — leave sticky snap (hysteresis) */
  releaseRadiusPx: 22,
  /** World inches — minimum acquire radius so snaps still work zoomed in */
  acquireMinWorldIn: 2.5,
  /** World inches — minimum release radius */
  releaseMinWorldIn: 3.5,
  /** Degrees — lock to ortho axis */
  orthoAcquireDeg: 6,
  /** Degrees — release ortho lock */
  orthoReleaseDeg: 10,
  /** World inches — merge / equal-coordinate tolerance */
  vertexMergeIn: 0.5,
  /** World inches — post-commit weld of coincident endpoints (1/16") */
  weldTolIn: 0.0625,
  /** Default drawing increment for free ortho segments (not geometry snaps) */
  drawingIncrementIn: 1,
  /** Prefer perpendicular when starting from a wall */
  wallStartPerpAcquireDeg: 12,
  /** World inches — treat point as on an existing wall for chain-start / closure */
  wallHostTolIn: 4,
};

export const SNAP_TYPES = {
  VERTEX: "VERTEX",
  ENDPOINT: "ENDPOINT",
  CORNER: "CORNER",
  INTERSECTION: "INTERSECTION",
  MIDPOINT: "MIDPOINT",
  HORIZONTAL: "HORIZONTAL",
  VERTICAL: "VERTICAL",
  PERPENDICULAR: "PERPENDICULAR",
  WALL_AXIS: "WALL_AXIS",
  WALL_FACE: "WALL_FACE",
  ROOM_CLOSE: "ROOM_CLOSE",
  MATCH_WIDTH: "MATCH_WIDTH",
  MATCH_HEIGHT: "MATCH_HEIGHT",
  GRID: "GRID",
  ORTHOGONAL: "ORTHOGONAL",
  FREE: "FREE",
};

const TYPE_PRIORITY = {
  [SNAP_TYPES.ROOM_CLOSE]: 100,
  [SNAP_TYPES.CORNER]: 95,
  [SNAP_TYPES.VERTEX]: 95,
  [SNAP_TYPES.ENDPOINT]: 95,
  [SNAP_TYPES.HORIZONTAL]: 85,
  [SNAP_TYPES.VERTICAL]: 85,
  [SNAP_TYPES.INTERSECTION]: 80,
  [SNAP_TYPES.MIDPOINT]: 75,
  [SNAP_TYPES.PERPENDICULAR]: 70,
  [SNAP_TYPES.WALL_AXIS]: 66,
  [SNAP_TYPES.WALL_FACE]: 65,
  [SNAP_TYPES.MATCH_WIDTH]: 60,
  [SNAP_TYPES.MATCH_HEIGHT]: 60,
  [SNAP_TYPES.ORTHOGONAL]: 50,
  [SNAP_TYPES.GRID]: 20,
  [SNAP_TYPES.FREE]: 0,
};

/** Start-of-stroke "on wall" outranks align so the first click lands on the wall. */
const START_ON_WALL_TIER = 90;

/** Point snap types that represent a real join target (corner / endpoint). */
export const CORNER_SNAP_TYPES = new Set([
  SNAP_TYPES.CORNER,
  SNAP_TYPES.VERTEX,
  SNAP_TYPES.ENDPOINT,
]);

export function snapPriority(type) {
  return TYPE_PRIORITY[type] ?? 0;
}

export function emptySnapSession() {
  return {
    locked: null, // { type, key, x, y, label, meta }
    orthoLocked: null, // "h" | "v" | null
  };
}

/**
 * World-inch snap radii from screen px per world inch.
 * The screen radius is primary; the world minimum keeps snapping usable zoomed in.
 */
export function snapRadiiWorld(pxPerInch, config = SNAP_CONFIG) {
  const cfg = { ...SNAP_CONFIG, ...(config || {}) };
  const s = Math.max(Number(pxPerInch) || 1, 0.01);
  return {
    acquire: Math.max(cfg.acquireRadiusPx / s, cfg.acquireMinWorldIn),
    release: Math.max(cfg.releaseRadiusPx / s, cfg.releaseMinWorldIn),
  };
}

function angleDeg(dx, dy) {
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

function orthoDeltaDeg(deg) {
  const n = ((deg % 180) + 180) % 180; // 0..180
  const toH = Math.min(n, 180 - n);
  const toV = Math.abs(n - 90);
  if (toH <= toV) return { axis: "h", delta: toH };
  return { axis: "v", delta: toV };
}

function wallGeom(wall) {
  const x1 = inches(wall.x1);
  const y1 = inches(wall.y1);
  const x2 = inches(wall.x2);
  const y2 = inches(wall.y2);
  const len = dist(x1, y1, x2, y2) || 1;
  return {
    x1, y1, x2, y2, len,
    ux: (x2 - x1) / len,
    uy: (y2 - y1) / len,
    vertical: Math.abs(x2 - x1) <= 0.05,
    horizontal: Math.abs(y2 - y1) <= 0.05,
  };
}

function wallHalfThickness(wall) {
  return Math.max(inches(wall?.thickness), 0) / 2;
}

function pointInWallBody(g, half, x, y) {
  const rx = x - g.x1;
  const ry = y - g.y1;
  const along = rx * g.ux + ry * g.uy;
  if (along < 0 || along > g.len) return false;
  const perp = Math.abs(-rx * g.uy + ry * g.ux);
  return perp <= half;
}

/** Perpendicular distance + clamped projection of point onto wall segment. */
export function projectPointOnWall(wall, x, y) {
  const g = wallGeom(wall);
  const t = Math.max(0, Math.min(1, ((x - g.x1) * g.ux + (y - g.y1) * g.uy) / g.len));
  const px = g.x1 + t * (g.x2 - g.x1);
  const py = g.y1 + t * (g.y2 - g.y1);
  return { x: px, y: py, t, d: dist(x, y, px, py), ...g };
}

export function pointNearWall(wall, x, y, tol) {
  const hit = projectPointOnWall(wall, x, y);
  return hit.d <= tol ? hit : null;
}

/**
 * Exact intersection of an orthogonal (or free) segment origin→target with a wall axis,
 * clamped to the wall segment (with tiny endpoint pad).
 */
export function intersectSegmentWithWall(origin, target, wall, pad = 0.5) {
  const g = wallGeom(wall);
  const ox = inches(origin.x);
  const oy = inches(origin.y);
  const tx = inches(target.x);
  const ty = inches(target.y);
  const dx = tx - ox;
  const dy = ty - oy;

  let ix;
  let iy;
  if (g.vertical && Math.abs(dy) >= Math.abs(dx) * 0.15) {
    if (Math.abs(dy) < 1e-9) {
      if (Math.abs(oy - g.y1) > 0.05 && Math.abs(oy - g.y2) > 0.05) return null;
      ix = g.x1;
      iy = oy;
    } else if (Math.abs(dx) < 1e-6) {
      if (Math.abs(ox - g.x1) > 0.75) return null;
      ix = g.x1;
      iy = ty;
    } else {
      const t = (g.x1 - ox) / dx;
      if (t < -0.02 || t > 1.05) return null;
      ix = g.x1;
      iy = oy + t * dy;
    }
  } else if (g.horizontal && Math.abs(dx) >= Math.abs(dy) * 0.15) {
    if (Math.abs(dx) < 1e-9) {
      if (Math.abs(ox - g.x1) > 0.05 && Math.abs(ox - g.x2) > 0.05) return null;
      ix = ox;
      iy = g.y1;
    } else if (Math.abs(dy) < 1e-6) {
      if (Math.abs(oy - g.y1) > 0.75) return null;
      ix = tx;
      iy = g.y1;
    } else {
      const t = (g.y1 - oy) / dy;
      if (t < -0.02 || t > 1.05) return null;
      iy = g.y1;
      ix = ox + t * dx;
    }
  } else {
    const wx = g.x2 - g.x1;
    const wy = g.y2 - g.y1;
    const den = dx * wy - dy * wx;
    if (Math.abs(den) < 1e-9) return null;
    const t = ((g.x1 - ox) * wy - (g.y1 - oy) * wx) / den;
    const u = ((g.x1 - ox) * dy - (g.y1 - oy) * dx) / den;
    if (t < -0.02 || t > 1.05 || u < -0.02 || u > 1.05) return null;
    ix = ox + t * dx;
    iy = oy + t * dy;
  }

  const along = ((ix - g.x1) * g.ux + (iy - g.y1) * g.uy);
  if (along < -pad || along > g.len + pad) return null;
  return { x: round2(ix), y: round2(iy), wallId: wall.id };
}

/**
 * Walls that can complete a room for a chain that started on existing geometry.
 * Prefer walls that host chainStart (corner / wall start).
 */
export function findChainHostWalls(walls, chainStart, tol = SNAP_CONFIG.wallHostTolIn) {
  if (!chainStart) return [];
  const x = inches(chainStart.x);
  const y = inches(chainStart.y);
  return (walls || []).filter((w) => pointNearWall(w, x, y, tol));
}

const cornerCache = new WeakMap();
const jointCache = new WeakMap();

/**
 * Centerline walls render as square-ended rectangles. Where two non-collinear walls
 * meet endpoint-to-endpoint (shared vertex or coincident within weld tolerance), each
 * end extends by the partner's half thickness so the joint is solid (no corner notch).
 * Returns { [wallId]: { start, end } } in inches. Used by rendering and snapping.
 */
export function wallJointExtensions(walls = []) {
  const wallList = walls || [];
  const cached = jointCache.get(wallList);
  if (cached) return cached;
  const ends = [];
  wallList.forEach((w) => {
    const g = wallGeom(w);
    if (dist(g.x1, g.y1, g.x2, g.y2) < 0.5) return;
    const half = wallHalfThickness(w);
    ends.push({ id: w.id, end: "start", x: g.x1, y: g.y1, ux: g.ux, uy: g.uy, vid: w.startVertexId, half });
    ends.push({ id: w.id, end: "end", x: g.x2, y: g.y2, ux: g.ux, uy: g.uy, vid: w.endVertexId, half });
  });
  const map = {};
  ends.forEach((a) => {
    let ext = 0;
    ends.forEach((b) => {
      if (b.id === a.id) return;
      const joined = (a.vid && a.vid === b.vid) || dist(a.x, a.y, b.x, b.y) <= SNAP_CONFIG.weldTolIn;
      if (!joined) return;
      if (Math.abs(a.ux * b.uy - a.uy * b.ux) < 0.05) return;
      ext = Math.max(ext, b.half);
    });
    if (ext > 0) {
      map[a.id] = map[a.id] || { start: 0, end: 0 };
      map[a.id][a.end] = ext;
    }
  });
  jointCache.set(wallList, map);
  return map;
}

/** Wall geometry with joint extensions applied (the solid body the user sees). */
function extendedWallGeom(wall, joints) {
  const g = wallGeom(wall);
  const j = joints[wall.id];
  if (!j) return g;
  const x1 = g.x1 - g.ux * j.start;
  const y1 = g.y1 - g.uy * j.start;
  const x2 = g.x2 + g.ux * j.end;
  const y2 = g.y2 + g.uy * j.end;
  return { ...g, x1, y1, x2, y2, len: g.len + j.start + j.end };
}

/**
 * Every join target on existing geometry:
 * - shared vertices (CORNER when ≥2 walls meet, else ENDPOINT)
 * - centerline endpoints of free walls, and of room walls where two walls actually
 *   meet endpoint-to-endpoint (legacy centerline room loops)
 * - visible face corners of room-owned (thick) walls — outer and inner corners of
 *   the solid wall union, found by quadrant occupancy (1 = convex, 3 = concave).
 *   Straight-edge seams (2 occupied quadrants) are not corners.
 */
export function collectSnapCorners(walls = [], vertices = []) {
  const wallList = walls || [];
  const vertexList = vertices || [];
  const cached = cornerCache.get(wallList);
  if (cached && cached.vertices === vertexList) return cached.points;

  const joints = wallJointExtensions(wallList);
  const geoms = wallList
    .map((wall) => ({ wall, g: wallGeom(wall), body: extendedWallGeom(wall, joints), half: wallHalfThickness(wall) }))
    .filter((row) => dist(row.g.x1, row.g.y1, row.g.x2, row.g.y2) > 0.5);

  const vertexDegree = {};
  wallList.forEach((w) => {
    if (w.startVertexId) vertexDegree[w.startVertexId] = (vertexDegree[w.startVertexId] || 0) + 1;
    if (w.endVertexId) vertexDegree[w.endVertexId] = (vertexDegree[w.endVertexId] || 0) + 1;
  });

  const pts = [];
  vertexList.forEach((v) => {
    const degree = vertexDegree[v.id] || 0;
    pts.push({
      x: inches(v.x),
      y: inches(v.y),
      type: SNAP_TYPES.VERTEX,
      label: degree >= 2 ? "CORNER" : "ENDPOINT",
      vertexId: v.id,
    });
  });

  const endpointHits = [];
  geoms.forEach(({ wall, g }) => {
    endpointHits.push({ x: g.x1, y: g.y1, wallId: wall.id, vertexId: wall.startVertexId || null, room: Boolean(wall.source_room_id) });
    endpointHits.push({ x: g.x2, y: g.y2, wallId: wall.id, vertexId: wall.endVertexId || null, room: Boolean(wall.source_room_id) });
  });
  endpointHits.forEach((p) => {
    const shared = endpointHits.filter((q) => dist(p.x, p.y, q.x, q.y) <= SNAP_CONFIG.weldTolIn).length;
    // Room-rectangle walls are inset by t/2, so a lone room endpoint is not a visible corner.
    if (p.room && shared < 2) return;
    pts.push({
      x: p.x,
      y: p.y,
      type: SNAP_TYPES.ENDPOINT,
      label: shared >= 2 ? "CORNER" : "ENDPOINT",
      wallId: p.wallId,
      vertexId: p.vertexId,
      // A room-wall centerline joint sits hidden inside the solid wall; level/align
      // to the visible face corners instead.
      alignSource: !p.room,
    });
  });

  // Face-corner candidates: body rectangle corners, plus face-line crossings of
  // neighbouring room walls (inner corners where joined bodies overlap).
  const faceRows = geoms.filter(({ wall, half }) => wall.source_room_id && half >= 0.25);
  const faceCandidates = [];
  faceRows.forEach(({ wall, body, half }) => {
    const nx = -body.uy * half;
    const ny = body.ux * half;
    faceCandidates.push(
      { x: body.x1 + nx, y: body.y1 + ny, wallId: wall.id },
      { x: body.x1 - nx, y: body.y1 - ny, wallId: wall.id },
      { x: body.x2 + nx, y: body.y2 + ny, wallId: wall.id },
      { x: body.x2 - nx, y: body.y2 - ny, wallId: wall.id },
    );
  });
  const withinBody = (b, half, x, y) => {
    const along = (x - b.x1) * b.ux + (y - b.y1) * b.uy;
    const perp = Math.abs(-(x - b.x1) * b.uy + (y - b.y1) * b.ux);
    return along >= -0.01 && along <= b.len + 0.01 && perp <= half + 0.01;
  };
  for (let i = 0; i < faceRows.length; i += 1) {
    for (let j = i + 1; j < faceRows.length; j += 1) {
      const a = faceRows[i];
      const b = faceRows[j];
      if (Math.abs(a.body.ux * b.body.uy - a.body.uy * b.body.ux) < 0.05) continue;
      [1, -1].forEach((sa) => {
        [1, -1].forEach((sb) => {
          const hit = lineIntersection(
            { x: a.body.x1 - a.body.uy * a.half * sa, y: a.body.y1 + a.body.ux * a.half * sa },
            { x: a.body.ux, y: a.body.uy },
            { x: b.body.x1 - b.body.uy * b.half * sb, y: b.body.y1 + b.body.ux * b.half * sb },
            { x: b.body.ux, y: b.body.uy },
          );
          if (!hit) return;
          if (!withinBody(a.body, a.half, hit.x, hit.y) || !withinBody(b.body, b.half, hit.x, hit.y)) return;
          faceCandidates.push({ x: hit.x, y: hit.y, wallId: a.wall.id });
        });
      });
    }
  }

  const eps = 0.15;
  const occupied = (x, y) => geoms.some(({ body, half }) => half > 0 && pointInWallBody(body, half, x, y));
  faceCandidates.forEach(({ x: cx, y: cy, wallId }) => {
    let count = 0;
    if (occupied(cx + eps, cy + eps)) count += 1;
    if (occupied(cx - eps, cy + eps)) count += 1;
    if (occupied(cx + eps, cy - eps)) count += 1;
    if (occupied(cx - eps, cy - eps)) count += 1;
    if (count !== 1 && count !== 3) return;
    pts.push({
      x: round2(cx),
      y: round2(cy),
      type: SNAP_TYPES.CORNER,
      label: "CORNER",
      wallId,
      face: count === 1 ? "outer" : "inner",
    });
  });

  const unique = [];
  pts.forEach((p) => {
    if (unique.some((q) => dist(p.x, p.y, q.x, q.y) <= 0.05)) return;
    unique.push(p);
  });
  cornerCache.set(wallList, { vertices: vertexList, points: unique });
  return unique;
}

/** Point where the ray origin→through meets a segment (a→b); null when parallel / off-segment. */
function rayHitSegment(origin, through, ax, ay, bx, by) {
  const dx = through.x - origin.x;
  const dy = through.y - origin.y;
  const wx = bx - ax;
  const wy = by - ay;
  const den = dx * wy - dy * wx;
  if (Math.abs(den) < 1e-9) return null;
  const s = ((ax - origin.x) * wy - (ay - origin.y) * wx) / den;
  const u = ((ax - origin.x) * dy - (ay - origin.y) * dx) / den;
  if (s <= 0 || u < -0.005 || u > 1.005) return null;
  return { x: origin.x + s * dx, y: origin.y + s * dy };
}

/** Intersection of two infinite lines given as point + direction. */
function lineIntersection(p, d, q, e) {
  const den = d.x * e.y - d.y * e.x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((q.x - p.x) * e.y - (q.y - p.y) * e.x) / den;
  return { x: p.x + t * d.x, y: p.y + t * d.y };
}

function candidateTier(c) {
  return c.tier != null ? c.tier : snapPriority(c.type);
}

/**
 * Resolve a drawing cursor into a snapped world point + guides.
 * `scale` is screen px per world inch (view zoom × plan px factor).
 */
export function resolveDrawSnap(opts = {}) {
  const cfg = { ...SNAP_CONFIG, ...(opts.config || {}) };
  const radii = snapRadiiWorld(opts.scale, cfg);
  const acquireWorld = radii.acquire;
  const releaseWorld = radii.release;
  const cursor = { x: inches(opts.cursorWorld?.x), y: inches(opts.cursorWorld?.y) };
  const origin = opts.origin ? { x: inches(opts.origin.x), y: inches(opts.origin.y) } : null;
  const chainStart = opts.chainStart ? { x: inches(opts.chainStart.x), y: inches(opts.chainStart.y) } : null;
  const freeAngle = Boolean(opts.freeAngle);
  const grid = Math.max(0.125, inches(opts.gridSnap) || 6);
  const session = opts.session || emptySnapSession();
  const walls = opts.walls || [];
  const rooms = opts.rooms || [];
  const vertices = opts.vertices || [];
  const chainWallIds = new Set(opts.chainWallIds || []);

  // --- CLOSE ROOM via chain-start vertex (full 4-wall loop) ---
  if (origin && chainStart && dist(chainStart.x, chainStart.y, origin.x, origin.y) > 1) {
    const dClose = dist(cursor.x, cursor.y, chainStart.x, chainStart.y);
    const lockedLoop = session.locked?.type === SNAP_TYPES.ROOM_CLOSE && !session.locked?.meta?.viaExisting;
    if (dClose <= acquireWorld * 1.35 || (lockedLoop && dClose <= releaseWorld * 1.5)) {
      return finalize({
        type: SNAP_TYPES.ROOM_CLOSE,
        key: "RC:loop",
        x: round2(chainStart.x),
        y: round2(chainStart.y),
        label: "CLOSE ROOM",
        score: snapPriority(SNAP_TYPES.ROOM_CLOSE),
        guides: [{ kind: "point", x: chainStart.x, y: chainStart.y }],
        meta: { viaExisting: false },
        dist: dClose,
      }, session);
    }
  }

  // --- Ortho lock from origin ---
  let working = { ...cursor };
  let orthoAxis = null;
  let orthoGuide = null;
  if (origin && !freeAngle) {
    const dx = cursor.x - origin.x;
    const dy = cursor.y - origin.y;
    const len = Math.hypot(dx, dy) || 0;
    if (len > 0.5) {
      const od = orthoDeltaDeg(angleDeg(dx, dy));
      let lock = session.orthoLocked;
      if (lock) {
        if (od.axis === lock && od.delta <= cfg.orthoReleaseDeg) {
          // keep
        } else if (od.delta <= cfg.orthoAcquireDeg) {
          lock = od.axis;
        } else {
          lock = null;
        }
      } else if (od.delta <= cfg.orthoAcquireDeg) {
        lock = od.axis;
      }
      session.orthoLocked = lock;
      orthoAxis = lock;
      if (lock === "h") {
        working = { x: cursor.x, y: origin.y };
        orthoGuide = { kind: "h", y: origin.y, label: "0°" };
      } else if (lock === "v") {
        working = { x: origin.x, y: cursor.y };
        orthoGuide = { kind: "v", x: origin.x, label: "90°" };
      }
    }
  } else {
    session.orthoLocked = null;
  }

  // Apply drawing increment along free ortho run (before geometry snaps)
  if (origin && orthoAxis && !freeAngle) {
    const inc = cfg.drawingIncrementIn;
    if (orthoAxis === "h") {
      working.x = origin.x + Math.round((working.x - origin.x) / inc) * inc;
    } else if (orthoAxis === "v") {
      working.y = origin.y + Math.round((working.y - origin.y) / inc) * inc;
    }
  }

  const candidates = [];
  const push = (c) => {
    candidates.push({
      range: acquireWorld,
      releaseRange: releaseWorld,
      ...c,
      score: c.score != null ? c.score : candidateTier(c) - Math.min(c.dist / acquireWorld, 1.99),
    });
  };
  const awayFromOrigin = (x, y, min = 1) => !origin || dist(x, y, origin.x, origin.y) >= min;

  // --- CLOSE ROOM via existing host wall (3 new walls + 1 existing) ---
  if (origin && chainStart && dist(chainStart.x, chainStart.y, origin.x, origin.y) > 12) {
    const hostWalls = findChainHostWalls(walls, chainStart, cfg.wallHostTolIn);
    const closureWalls = hostWalls.length
      ? hostWalls
      : walls.filter((w) => !chainWallIds.has(w.id));

    closureWalls.forEach((wall) => {
      if (chainWallIds.has(wall.id)) return;
      const hostsStart = Boolean(pointNearWall(wall, chainStart.x, chainStart.y, cfg.wallHostTolIn));
      if (!hostsStart && hostWalls.length) return;
      const hit = intersectSegmentWithWall(origin, working, wall, cfg.wallHostTolIn);
      if (!hit) return;
      if (dist(hit.x, hit.y, origin.x, origin.y) < 6) return;
      const d = dist(working.x, working.y, hit.x, hit.y);
      if (d > releaseWorld * 1.6) return;
      push({
        type: SNAP_TYPES.ROOM_CLOSE,
        key: `RC:${wall.id}`,
        x: hit.x,
        y: hit.y,
        label: "CLOSE ROOM",
        score: snapPriority(SNAP_TYPES.ROOM_CLOSE) + (hostsStart ? 5 : 0) - Math.min(d / acquireWorld, 1.99),
        range: acquireWorld * 1.6,
        releaseRange: releaseWorld * 1.6,
        guides: [
          { kind: "point", x: hit.x, y: hit.y },
          { kind: "wall", wallId: wall.id, x1: wall.x1, y1: wall.y1, x2: wall.x2, y2: wall.y2 },
        ],
        meta: {
          viaExisting: true,
          closingWallId: wall.id,
          chainStart: { x: chainStart.x, y: chainStart.y },
        },
        dist: d,
      });
    });

    hostWalls.forEach((wall) => {
      [[wall.x1, wall.y1], [wall.x2, wall.y2]].forEach(([ex, ey]) => {
        const px = inches(ex);
        const py = inches(ey);
        if (dist(px, py, chainStart.x, chainStart.y) < 1) return;
        let target = { x: px, y: py };
        if (orthoAxis === "h") target = { x: px, y: origin.y };
        if (orthoAxis === "v") target = { x: origin.x, y: py };
        if (!pointNearWall(wall, target.x, target.y, cfg.wallHostTolIn + 1)) return;
        if (Math.abs(target.x - px) > 0.75 && Math.abs(target.y - py) > 0.75) {
          target = { x: px, y: py };
        }
        const d = dist(working.x, working.y, target.x, target.y);
        if (d > releaseWorld * 1.6) return;
        push({
          type: SNAP_TYPES.ROOM_CLOSE,
          key: `RC:${wall.id}:${round2(target.x)}:${round2(target.y)}`,
          x: round2(target.x),
          y: round2(target.y),
          label: "CLOSE ROOM",
          score: snapPriority(SNAP_TYPES.ROOM_CLOSE) + 2 - Math.min(d / acquireWorld, 1.99),
          range: acquireWorld * 1.6,
          releaseRange: releaseWorld * 1.6,
          guides: [
            { kind: "point", x: target.x, y: target.y },
            { kind: "wall", wallId: wall.id, x1: wall.x1, y1: wall.y1, x2: wall.x2, y2: wall.y2 },
          ],
          meta: {
            viaExisting: true,
            closingWallId: wall.id,
            chainStart: { x: chainStart.x, y: chainStart.y },
          },
          dist: d,
        });
      });
    });
  }

  // --- Corners / endpoints / vertices (join targets) ---
  const corners = collectSnapCorners(walls, vertices);
  corners.forEach((p) => {
    if (!awayFromOrigin(p.x, p.y, 0.5)) return;
    const d = Math.min(
      dist(cursor.x, cursor.y, p.x, p.y),
      dist(working.x, working.y, p.x, p.y),
    );
    if (d > releaseWorld) return;
    push({
      type: p.type,
      key: `C:${round2(p.x)}:${round2(p.y)}`,
      x: round2(p.x),
      y: round2(p.y),
      label: p.label,
      guides: [{ kind: "point", x: p.x, y: p.y }],
      dist: d,
      meta: {
        join: true,
        ...(p.vertexId ? { vertexId: p.vertexId } : {}),
        ...(p.wallId ? { wallId: p.wallId } : {}),
        ...(p.face ? { face: p.face } : {}),
      },
    });
  });

  // --- Start of stroke: nearest point ON an existing wall ---
  if (!origin) {
    const host = nearestPointOnWalls(walls, cursor.x, cursor.y, releaseWorld);
    if (host) {
      push({
        type: SNAP_TYPES.WALL_AXIS,
        key: `W:${host.wall.id}`,
        tier: START_ON_WALL_TIER,
        x: round2(host.x),
        y: round2(host.y),
        label: "ON WALL",
        guides: [
          { kind: "point", x: host.x, y: host.y },
          { kind: "wall", wallId: host.wall.id, x1: host.wall.x1, y1: host.wall.y1, x2: host.wall.x2, y2: host.wall.y2 },
        ],
        dist: host.d,
        meta: { wallId: host.wall.id },
      });
    }
  }

  // --- Intersection of the rubber-band axis with existing walls (centerline + faces) ---
  const rubberLen = origin ? dist(origin.x, origin.y, working.x, working.y) : 0;
  if (origin && rubberLen > 1) {
    walls.forEach((wall) => {
      if (chainWallIds.has(wall.id)) return;
      const g = wallGeom(wall);
      const half = wallHalfThickness(wall);
      const nx = -g.uy;
      const ny = g.ux;
      const lines = [{ face: "center", off: 0 }];
      if (half >= 0.25) {
        lines.push({ face: "a", off: half }, { face: "b", off: -half });
      }
      lines.forEach(({ face, off }) => {
        const hit = rayHitSegment(
          origin,
          working,
          g.x1 + nx * off,
          g.y1 + ny * off,
          g.x2 + nx * off,
          g.y2 + ny * off,
        );
        if (!hit || !awayFromOrigin(hit.x, hit.y, 1)) return;
        const d = dist(working.x, working.y, hit.x, hit.y);
        if (d > releaseWorld) return;
        push({
          type: SNAP_TYPES.INTERSECTION,
          key: `I:${wall.id}:${face}`,
          x: round2(hit.x),
          y: round2(hit.y),
          label: "INTERSECTION",
          guides: [
            { kind: "point", x: hit.x, y: hit.y },
            { kind: "wall", wallId: wall.id, x1: wall.x1, y1: wall.y1, x2: wall.x2, y2: wall.y2 },
          ],
          dist: d,
          meta: { wallId: wall.id, face },
        });
      });
    });
  }

  // --- Wall midpoints ---
  walls.forEach((wall) => {
    const g = wallGeom(wall);
    if (g.len < 12) return;
    const mx = (g.x1 + g.x2) / 2;
    const my = (g.y1 + g.y2) / 2;
    if (!awayFromOrigin(mx, my, 1)) return;
    const d = Math.min(dist(cursor.x, cursor.y, mx, my), dist(working.x, working.y, mx, my));
    if (d > releaseWorld) return;
    push({
      type: SNAP_TYPES.MIDPOINT,
      key: `M:${wall.id}`,
      x: round2(mx),
      y: round2(my),
      label: "MIDPOINT",
      guides: [{ kind: "point", x: mx, y: my }],
      dist: d,
      meta: { wallId: wall.id },
    });
  });

  // --- Align / level with a corner (same X or same Y) ---
  const alignKeys = new Set();
  const pushAlign = (axis, value, label, source) => {
    const key = `${axis === "h" ? "H" : "V"}:${round2(value)}`;
    if (alignKeys.has(key)) return;
    if (axis === "h") {
      if (orthoAxis === "h") return; // would bend a horizontal ortho run
      const d = Math.abs(working.y - value);
      if (d > releaseWorld) return;
      const x = working.x;
      if (!awayFromOrigin(x, value, 1)) return;
      alignKeys.add(key);
      push({
        type: SNAP_TYPES.HORIZONTAL,
        key,
        x: round2(x),
        y: round2(value),
        label,
        guides: [
          { kind: "h", y: value },
          ...(source ? [{ kind: "point", x: source.x, y: source.y }] : []),
        ],
        dist: d,
        meta: { alignAxis: "h", alignValue: value, source: source || null },
      });
    } else {
      if (orthoAxis === "v") return; // would bend a vertical ortho run
      const d = Math.abs(working.x - value);
      if (d > releaseWorld) return;
      const y = working.y;
      if (!awayFromOrigin(value, y, 1)) return;
      alignKeys.add(key);
      push({
        type: SNAP_TYPES.VERTICAL,
        key,
        x: round2(value),
        y: round2(y),
        label,
        guides: [
          { kind: "v", x: value },
          ...(source ? [{ kind: "point", x: source.x, y: source.y }] : []),
        ],
        dist: d,
        meta: { alignAxis: "v", alignValue: value, source: source || null },
      });
    }
  };
  // Nearest corners claim a datum first so the guide marker points at the closest source.
  corners
    .filter((p) => p.alignSource !== false)
    .sort((a, b) => dist(working.x, working.y, a.x, a.y) - dist(working.x, working.y, b.x, b.y))
    .forEach((p) => {
      pushAlign("h", p.y, "LEVEL", { x: p.x, y: p.y });
      pushAlign("v", p.x, "ALIGN", { x: p.x, y: p.y });
    });
  rooms.forEach((room) => {
    const left = inches(room.x);
    const top = inches(room.y);
    const right = left + inches(room.width);
    const bottom = top + inches(room.depth);
    pushAlign("h", top, "ALIGN TOP", null);
    pushAlign("h", bottom, "ALIGN BOTTOM", null);
    pushAlign("v", left, "ALIGN LEFT", null);
    pushAlign("v", right, "ALIGN RIGHT", null);
  });

  // --- Room size match (width / height equality when drawing from origin) ---
  if (origin && orthoAxis) {
    rooms.forEach((room) => {
      const w = inches(room.width);
      const dRoom = inches(room.depth);
      if (orthoAxis === "h") {
        const target = origin.x + Math.sign(working.x - origin.x || 1) * w;
        const dd = Math.abs(working.x - target);
        if (dd <= releaseWorld * 1.5) {
          push({
            type: SNAP_TYPES.MATCH_WIDTH,
            key: `MW:${round2(target)}`,
            x: round2(target),
            y: round2(origin.y),
            label: `MATCH ${formatRough(w)}`,
            range: acquireWorld * 1.5,
            releaseRange: releaseWorld * 1.5,
            guides: [{ kind: "v", x: target }],
            dist: dd,
          });
        }
      }
      if (orthoAxis === "v") {
        const target = origin.y + Math.sign(working.y - origin.y || 1) * dRoom;
        const dd = Math.abs(working.y - target);
        if (dd <= releaseWorld * 1.5) {
          push({
            type: SNAP_TYPES.MATCH_HEIGHT,
            key: `MH:${round2(target)}`,
            x: round2(origin.x),
            y: round2(target),
            label: `MATCH HEIGHT ${formatRough(dRoom)}`,
            range: acquireWorld * 1.5,
            releaseRange: releaseWorld * 1.5,
            guides: [{ kind: "h", y: target }],
            dist: dd,
          });
        }
      }
    });
  }

  // --- Perpendicular from the wall hosting the origin ---
  let perpLine = null;
  if (origin && !freeAngle) {
    const host = nearestPointOnWalls(walls, origin.x, origin.y, Math.max(acquireWorld, cfg.wallHostTolIn));
    if (host) {
      const nx = -host.uy;
      const ny = host.ux;
      const along = (working.x - origin.x) * nx + (working.y - origin.y) * ny;
      const px = origin.x + nx * along;
      const py = origin.y + ny * along;
      const dPerp = dist(working.x, working.y, px, py);
      perpLine = { p: { x: origin.x, y: origin.y }, d: { x: nx, y: ny }, dPerp, wallId: host.wall.id };
      if (dPerp <= releaseWorld * 1.4 && Math.abs(along) >= 1) {
        push({
          type: SNAP_TYPES.PERPENDICULAR,
          key: `P:${host.wall.id}`,
          x: round2(px),
          y: round2(py),
          label: "PERPENDICULAR",
          range: acquireWorld * 1.4,
          releaseRange: releaseWorld * 1.4,
          guides: [{ kind: "segment", x1: origin.x, y1: origin.y, x2: px, y2: py }],
          dist: dPerp,
          meta: { wallId: host.wall.id },
        });
      }
    }
  }

  // --- Grid (lowest geometry-adjacent priority) ---
  const gx = snapTo(working.x, grid);
  const gy = snapTo(working.y, grid);
  const gd = dist(working.x, working.y, gx, gy);
  if (gd <= acquireWorld) {
    push({
      type: SNAP_TYPES.GRID,
      key: null,
      x: round2(gx),
      y: round2(gy),
      label: "GRID",
      guides: [],
      dist: gd,
    });
  }

  // --- Ortho point as candidate ---
  if (origin && orthoAxis) {
    push({
      type: SNAP_TYPES.ORTHOGONAL,
      key: null,
      x: round2(working.x),
      y: round2(working.y),
      label: orthoAxis === "h" ? "HORIZONTAL" : "VERTICAL",
      score: snapPriority(SNAP_TYPES.ORTHOGONAL),
      guides: orthoGuide ? [orthoGuide] : [],
      dist: 0,
    });
  }

  // --- Pick: best fresh candidate in acquire range; sticky lock only if not outranked ---
  candidates.sort((a, b) => b.score - a.score);
  const fresh = candidates.find((c) => c.dist <= c.range) || null;
  let sticky = null;
  if (session.locked?.key) {
    sticky = candidates.find((c) => c.key === session.locked.key && c.dist <= c.releaseRange) || null;
  }
  let best = fresh;
  if (sticky && (!fresh || candidateTier(fresh) <= candidateTier(sticky))) best = sticky;

  if (best && (best.type === SNAP_TYPES.HORIZONTAL || best.type === SNAP_TYPES.VERTICAL)) {
    best = combineAlign(best, { candidates, perpLine, orthoAxis, working, releaseWorld });
  }

  if (!best) {
    best = {
      type: SNAP_TYPES.FREE,
      key: null,
      x: round2(working.x),
      y: round2(working.y),
      label: freeAngle ? "FREE ANGLE" : (orthoAxis ? (orthoAxis === "h" ? "HORIZONTAL" : "VERTICAL") : ""),
      score: 0,
      guides: orthoGuide ? [orthoGuide] : [],
    };
  }

  if (orthoGuide && !(best.guides || []).some((g) => g.kind === orthoGuide.kind)) {
    best = { ...best, guides: [...(best.guides || []), orthoGuide] };
  }

  return finalize(best, session);
}

/**
 * Align (same X / same Y as a corner) also honours the other constraint in play:
 * perpendicular to the start wall, or a second align on the other axis.
 */
function combineAlign(best, { candidates, perpLine, orthoAxis, working, releaseWorld }) {
  const axis = best.meta?.alignAxis;
  const value = best.meta?.alignValue;
  if (!axis || value == null) return best;
  const alignPoint = axis === "h" ? { x: 0, y: value } : { x: value, y: 0 };
  const alignDir = axis === "h" ? { x: 1, y: 0 } : { x: 0, y: 1 };

  if (!orthoAxis && perpLine && perpLine.dPerp <= releaseWorld * 1.4) {
    const hit = lineIntersection(perpLine.p, perpLine.d, alignPoint, alignDir);
    if (hit && dist(hit.x, hit.y, working.x, working.y) <= releaseWorld * 1.5) {
      return {
        ...best,
        x: round2(hit.x),
        y: round2(hit.y),
        guides: [
          ...(best.guides || []),
          { kind: "segment", x1: perpLine.p.x, y1: perpLine.p.y, x2: hit.x, y2: hit.y },
        ],
        meta: { ...best.meta, perpendicularWallId: perpLine.wallId },
      };
    }
  }

  if (!orthoAxis) {
    const otherType = axis === "h" ? SNAP_TYPES.VERTICAL : SNAP_TYPES.HORIZONTAL;
    const other = candidates.find((c) => c.type === otherType && c.dist <= c.range);
    if (other) {
      const x = axis === "h" ? other.meta.alignValue : best.x;
      const y = axis === "h" ? best.y : other.meta.alignValue;
      return {
        ...best,
        x: round2(x),
        y: round2(y),
        guides: [...(best.guides || []), ...(other.guides || [])],
        meta: { ...best.meta, secondAlign: other.meta },
      };
    }
  }
  return best;
}

function finalize(candidate, session) {
  session.locked = {
    type: candidate.type,
    key: candidate.key || null,
    x: candidate.x,
    y: candidate.y,
    label: candidate.label,
    meta: candidate.meta || null,
  };
  return {
    point: { x: candidate.x, y: candidate.y },
    candidate,
    session,
    label: candidate.label || "",
    guides: candidate.guides || [],
  };
}

function formatRough(inchesVal) {
  const n = Math.round(inches(inchesVal));
  if (n % 12 === 0) return `${n / 12}'`;
  return `${Math.floor(n / 12)}'${n % 12}"`;
}

function nearestPointOnWalls(walls, x, y, maxDist) {
  let best = null;
  (walls || []).forEach((wall) => {
    const hit = projectPointOnWall(wall, x, y);
    if (hit.d <= maxDist && (!best || hit.d < best.d)) {
      best = { wall, ...hit, ux: hit.ux, uy: hit.uy, len: hit.len };
    }
  });
  return best;
}

export function projectOntoWall(wall, x, y) {
  return nearestPointOnWalls([wall], x, y, 1e9);
}

/**
 * Resolve wall-body drag snap: keep ortho, snap distance to increment / alignments.
 */
export function resolveWallMoveDistance({
  originWall,
  cursorWorld,
  config = {},
}) {
  const cfg = { ...SNAP_CONFIG, drawingIncrementIn: 1, ...config };
  const x1 = inches(originWall.x1);
  const y1 = inches(originWall.y1);
  const x2 = inches(originWall.x2);
  const y2 = inches(originWall.y2);
  const len = dist(x1, y1, x2, y2) || 1;
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  const nx = -uy;
  const ny = ux;
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  const cx = inches(cursorWorld.x);
  const cy = inches(cursorWorld.y);
  let distance = (cx - midX) * nx + (cy - midY) * ny;
  const inc = cfg.drawingIncrementIn;
  distance = Math.round(distance / inc) * inc;
  return { distance: round2(distance), nx, ny };
}
