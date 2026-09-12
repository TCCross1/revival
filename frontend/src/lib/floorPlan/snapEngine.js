/**
 * Unified residential snap / inference engine (Magicplan-style UX target).
 * Screen pixels drive acquire/release; results are exact world coordinates.
 *
 * Priority during an active wall chain:
 * CLOSE ROOM / topology closure > vertex > endpoint > intersection >
 * projected align > perpendicular > wall face > match size > ortho > grid > free.
 */

import { dist, inches, round2, snapTo } from "./units";

export const SNAP_CONFIG = {
  /** Screen px — enter sticky snap */
  acquireRadiusPx: 12,
  /** Screen px — leave sticky snap (hysteresis) */
  releaseRadiusPx: 20,
  /** Degrees — lock to ortho axis */
  orthoAcquireDeg: 6,
  /** Degrees — release ortho lock */
  orthoReleaseDeg: 10,
  /** World inches — merge / equal-coordinate tolerance */
  vertexMergeIn: 0.5,
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
  INTERSECTION: "INTERSECTION",
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
  [SNAP_TYPES.VERTEX]: 95,
  [SNAP_TYPES.ENDPOINT]: 90,
  [SNAP_TYPES.INTERSECTION]: 85,
  [SNAP_TYPES.PERPENDICULAR]: 80,
  [SNAP_TYPES.HORIZONTAL]: 75,
  [SNAP_TYPES.VERTICAL]: 75,
  [SNAP_TYPES.WALL_AXIS]: 70,
  [SNAP_TYPES.WALL_FACE]: 68,
  [SNAP_TYPES.MATCH_WIDTH]: 60,
  [SNAP_TYPES.MATCH_HEIGHT]: 60,
  [SNAP_TYPES.ORTHOGONAL]: 50,
  [SNAP_TYPES.GRID]: 20,
  [SNAP_TYPES.FREE]: 0,
};

export function emptySnapSession() {
  return {
    locked: null, // { type, x, y, label, score, meta }
    orthoLocked: null, // "h" | "v" | null
  };
}

function worldFromPx(px, scale) {
  return px / Math.max(scale || 1, 0.01);
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

function collectEndpoints(walls = [], vertices = []) {
  const pts = [];
  (vertices || []).forEach((v) => {
    pts.push({
      x: inches(v.x),
      y: inches(v.y),
      type: SNAP_TYPES.VERTEX,
      label: "VERTEX",
      id: v.id,
    });
  });
  (walls || []).forEach((wall) => {
    pts.push({
      x: inches(wall.x1),
      y: inches(wall.y1),
      type: SNAP_TYPES.ENDPOINT,
      label: "ENDPOINT",
      wallId: wall.id,
    });
    pts.push({
      x: inches(wall.x2),
      y: inches(wall.y2),
      type: SNAP_TYPES.ENDPOINT,
      label: "ENDPOINT",
      wallId: wall.id,
    });
  });
  return pts;
}

function uniquePoints(pts, tol = 0.25) {
  const out = [];
  pts.forEach((p) => {
    if (out.some((q) => dist(p.x, p.y, q.x, q.y) <= tol)) return;
    out.push(p);
  });
  return out;
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
    // Horizontal-ish segment vs vertical wall
    if (Math.abs(dy) < 1e-9) {
      if (Math.abs(oy - g.y1) > 0.05 && Math.abs(oy - g.y2) > 0.05) return null;
      ix = g.x1;
      iy = oy;
    } else if (Math.abs(dx) < 1e-6) {
      // Both vertical — only if collinear
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
    // General segment–segment intersection
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

/**
 * Resolve a drawing cursor into a snapped world point + guides.
 */
export function resolveDrawSnap(opts = {}) {
  const cfg = { ...SNAP_CONFIG, ...(opts.config || {}) };
  const scale = Number(opts.scale) || 1;
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

  const acquireWorld = worldFromPx(cfg.acquireRadiusPx, scale);
  const releaseWorld = worldFromPx(cfg.releaseRadiusPx, scale);

  // --- CLOSE ROOM via chain-start vertex (full 4-wall loop) ---
  if (origin && chainStart && dist(chainStart.x, chainStart.y, origin.x, origin.y) > 1) {
    const dClose = dist(cursor.x, cursor.y, chainStart.x, chainStart.y);
    if (dClose <= acquireWorld * 1.35 || (session.locked?.type === SNAP_TYPES.ROOM_CLOSE && !session.locked?.meta?.viaExisting && dClose <= releaseWorld * 1.5)) {
      const candidate = {
        type: SNAP_TYPES.ROOM_CLOSE,
        x: round2(chainStart.x),
        y: round2(chainStart.y),
        label: "CLOSE ROOM",
        score: TYPE_PRIORITY[SNAP_TYPES.ROOM_CLOSE],
        guides: [{ kind: "point", x: chainStart.x, y: chainStart.y }],
        meta: { viaExisting: false },
        dist: dClose,
      };
      return finalize(candidate, session);
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
        const lockedDelta = orthoDeltaDeg(angleDeg(dx, dy));
        if (lockedDelta.axis === lock && lockedDelta.delta <= cfg.orthoReleaseDeg) {
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
      const raw = working.x - origin.x;
      working.x = origin.x + Math.round(raw / inc) * inc;
    } else if (orthoAxis === "v") {
      const raw = working.y - origin.y;
      working.y = origin.y + Math.round(raw / inc) * inc;
    }
  }

  const candidates = [];

  // --- CLOSE ROOM via existing host wall (3 new walls + 1 existing) ---
  if (origin && chainStart && dist(chainStart.x, chainStart.y, origin.x, origin.y) > 12) {
    const hostWalls = findChainHostWalls(walls, chainStart, cfg.wallHostTolIn);
    const closureWalls = hostWalls.length
      ? hostWalls
      : (walls || []).filter((w) => !chainWallIds.has(w.id));

    closureWalls.forEach((wall) => {
      if (chainWallIds.has(wall.id)) return;
      // Prefer walls that actually host the chain start (corner / edge start).
      const hostsStart = Boolean(pointNearWall(wall, chainStart.x, chainStart.y, cfg.wallHostTolIn));
      if (!hostsStart && hostWalls.length) return;

      const hit = intersectSegmentWithWall(origin, working, wall, cfg.wallHostTolIn);
      if (!hit) return;
      // Must not collapse onto origin
      if (dist(hit.x, hit.y, origin.x, origin.y) < 6) return;
      const d = dist(working.x, working.y, hit.x, hit.y);
      const sticky = session.locked?.type === SNAP_TYPES.ROOM_CLOSE
        && session.locked?.meta?.viaExisting
        && session.locked?.meta?.closingWallId === wall.id
        && dist(session.locked.x, session.locked.y, hit.x, hit.y) <= releaseWorld;
      if (d > acquireWorld * 1.6 && !sticky) return;

      candidates.push({
        type: SNAP_TYPES.ROOM_CLOSE,
        x: hit.x,
        y: hit.y,
        label: "CLOSE ROOM",
        score: TYPE_PRIORITY[SNAP_TYPES.ROOM_CLOSE] + (hostsStart ? 5 : 0) - d * 0.01,
        guides: [
          { kind: "point", x: hit.x, y: hit.y },
          { kind: "wall", wallId: wall.id, x1: wall.x1, y1: wall.y1, x2: wall.x2, y2: wall.y2 },
        ],
        meta: {
          viaExisting: true,
          closingWallId: wall.id,
          chainStart: { x: chainStart.x, y: chainStart.y },
        },
        dist: sticky ? Math.min(d, acquireWorld * 0.5) : d,
      });
    });

    // Corner endpoints of host walls as closure targets
    hostWalls.forEach((wall) => {
      [[wall.x1, wall.y1], [wall.x2, wall.y2]].forEach(([ex, ey]) => {
        const px = inches(ex);
        const py = inches(ey);
        if (dist(px, py, chainStart.x, chainStart.y) < 1) return;
        // Prefer when ortho segment would land near this corner
        let target = { x: px, y: py };
        if (orthoAxis === "h") target = { x: px, y: origin.y };
        if (orthoAxis === "v") target = { x: origin.x, y: py };
        // Only if target still lands on the wall
        if (!pointNearWall(wall, target.x, target.y, cfg.wallHostTolIn + 1)) return;
        if (Math.abs(target.x - px) > 0.75 && Math.abs(target.y - py) > 0.75) {
          target = { x: px, y: py };
        }
        const d = dist(working.x, working.y, target.x, target.y);
        if (d > acquireWorld * 1.6) return;
        candidates.push({
          type: SNAP_TYPES.ROOM_CLOSE,
          x: round2(target.x),
          y: round2(target.y),
          label: "CLOSE ROOM",
          score: TYPE_PRIORITY[SNAP_TYPES.ROOM_CLOSE] + 2 - d * 0.01,
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

  // Geometry endpoints / vertices
  uniquePoints(collectEndpoints(walls, vertices)).forEach((p) => {
    const d = dist(working.x, working.y, p.x, p.y);
    if (d <= releaseWorld * 1.25) {
      const startLabel = !origin && d <= acquireWorld ? "START FROM CORNER" : p.label;
      candidates.push({
        type: p.type,
        x: round2(p.x),
        y: round2(p.y),
        label: startLabel,
        score: TYPE_PRIORITY[p.type] - d,
        guides: [{ kind: "point", x: p.x, y: p.y }],
        dist: d,
        meta: p.wallId ? { wallId: p.wallId } : (p.id ? { vertexId: p.id } : undefined),
      });
    }
  });

  // Projected H/V alignment to important points + room edge datums
  uniquePoints(collectEndpoints(walls, vertices)).forEach((p) => {
    const dx = Math.abs(working.x - p.x);
    const dy = Math.abs(working.y - p.y);
    if (dx <= acquireWorld * 1.2) {
      candidates.push({
        type: SNAP_TYPES.VERTICAL,
        x: round2(p.x),
        y: round2(working.y),
        label: "ALIGN",
        score: TYPE_PRIORITY[SNAP_TYPES.VERTICAL] - dx,
        guides: [{ kind: "v", x: p.x }],
        dist: dx,
      });
    }
    if (dy <= acquireWorld * 1.2) {
      candidates.push({
        type: SNAP_TYPES.HORIZONTAL,
        x: round2(working.x),
        y: round2(p.y),
        label: "ALIGN",
        score: TYPE_PRIORITY[SNAP_TYPES.HORIZONTAL] - dy,
        guides: [{ kind: "h", y: p.y }],
        dist: dy,
      });
    }
  });

  // Room outside-edge datums (ALIGN TOP / BOTTOM / LEFT / RIGHT)
  rooms.forEach((room) => {
    const left = inches(room.x);
    const top = inches(room.y);
    const right = left + inches(room.width);
    const bottom = top + inches(room.depth);
    const edges = [
      { axis: "h", y: top, label: "ALIGN TOP" },
      { axis: "h", y: bottom, label: "ALIGN BOTTOM" },
      { axis: "v", x: left, label: "ALIGN LEFT" },
      { axis: "v", x: right, label: "ALIGN RIGHT" },
    ];
    edges.forEach((edge) => {
      if (edge.axis === "h") {
        const dy = Math.abs(working.y - edge.y);
        if (dy <= acquireWorld * 1.35) {
          candidates.push({
            type: SNAP_TYPES.HORIZONTAL,
            x: round2(working.x),
            y: round2(edge.y),
            label: edge.label,
            score: TYPE_PRIORITY[SNAP_TYPES.HORIZONTAL] + 1 - dy,
            guides: [{ kind: "h", y: edge.y }],
            dist: dy,
          });
        }
      } else {
        const dx = Math.abs(working.x - edge.x);
        if (dx <= acquireWorld * 1.35) {
          candidates.push({
            type: SNAP_TYPES.VERTICAL,
            x: round2(edge.x),
            y: round2(working.y),
            label: edge.label,
            score: TYPE_PRIORITY[SNAP_TYPES.VERTICAL] + 1 - dx,
            guides: [{ kind: "v", x: edge.x }],
            dist: dx,
          });
        }
      }
    });
  });

  // Room edge match (width / height equality when drawing from origin)
  if (origin && orthoAxis) {
    rooms.forEach((room) => {
      const w = inches(room.width);
      const d = inches(room.depth);
      if (orthoAxis === "h") {
        const target = origin.x + Math.sign(working.x - origin.x || 1) * w;
        const dd = Math.abs(working.x - target);
        if (dd <= acquireWorld * 1.5) {
          candidates.push({
            type: SNAP_TYPES.MATCH_WIDTH,
            x: round2(target),
            y: round2(origin.y),
            label: `MATCH ${formatRough(w)}`,
            score: TYPE_PRIORITY[SNAP_TYPES.MATCH_WIDTH] - dd,
            guides: [{ kind: "v", x: target }],
            dist: dd,
          });
        }
      }
      if (orthoAxis === "v") {
        const target = origin.y + Math.sign(working.y - origin.y || 1) * d;
        const dd = Math.abs(working.y - target);
        if (dd <= acquireWorld * 1.5) {
          candidates.push({
            type: SNAP_TYPES.MATCH_HEIGHT,
            x: round2(origin.x),
            y: round2(target),
            label: `MATCH HEIGHT ${formatRough(d)}`,
            score: TYPE_PRIORITY[SNAP_TYPES.MATCH_HEIGHT] - dd,
            guides: [{ kind: "h", y: target }],
            dist: dd,
          });
        }
      }
    });
  }

  // Perpendicular from wall when origin sits on a wall
  if (origin && !freeAngle) {
    const host = nearestPointOnWalls(walls, origin.x, origin.y, acquireWorld);
    if (host) {
      const { ux, uy } = host;
      const nx = -uy;
      const ny = ux;
      const along = (working.x - origin.x) * nx + (working.y - origin.y) * ny;
      const px = origin.x + nx * along;
      const py = origin.y + ny * along;
      const dPerp = dist(working.x, working.y, px, py);
      if (dPerp <= acquireWorld * 1.4) {
        candidates.push({
          type: SNAP_TYPES.PERPENDICULAR,
          x: round2(px),
          y: round2(py),
          label: "PERPENDICULAR",
          score: TYPE_PRIORITY[SNAP_TYPES.PERPENDICULAR] - dPerp,
          guides: [{ kind: "segment", x1: origin.x, y1: origin.y, x2: px, y2: py }],
          dist: dPerp,
        });
      }
    }
  }

  // Grid (lowest geometry-adjacent priority)
  const gx = snapTo(working.x, grid);
  const gy = snapTo(working.y, grid);
  const gd = dist(working.x, working.y, gx, gy);
  if (gd <= acquireWorld) {
    candidates.push({
      type: SNAP_TYPES.GRID,
      x: round2(gx),
      y: round2(gy),
      label: "GRID",
      score: TYPE_PRIORITY[SNAP_TYPES.GRID] - gd,
      guides: [],
      dist: gd,
    });
  }

  // Ortho point as candidate
  if (origin && orthoAxis) {
    candidates.push({
      type: SNAP_TYPES.ORTHOGONAL,
      x: round2(working.x),
      y: round2(working.y),
      label: orthoAxis === "h" ? "HORIZONTAL" : "VERTICAL",
      score: TYPE_PRIORITY[SNAP_TYPES.ORTHOGONAL],
      guides: orthoGuide ? [orthoGuide] : [],
      dist: dist(cursor.x, cursor.y, working.x, working.y),
    });
  }

  // Pick best with hysteresis against locked
  let best = null;
  candidates.sort((a, b) => b.score - a.score);
  if (session.locked) {
    const still = candidates.find((c) => (
      c.type === session.locked.type
      && dist(c.x, c.y, session.locked.x, session.locked.y) <= 0.05
    )) || candidates.find((c) => dist(c.x, c.y, session.locked.x, session.locked.y) <= releaseWorld);
    if (still && (still.dist == null || still.dist <= releaseWorld)) {
      best = {
        ...still,
        x: session.locked.x,
        y: session.locked.y,
        label: session.locked.label || still.label,
        meta: session.locked.meta || still.meta,
      };
    }
  }
  if (!best) {
    best = candidates.find((c) => (c.dist == null ? true : c.dist <= acquireWorld)) || null;
  }
  if (!best) {
    best = {
      type: SNAP_TYPES.FREE,
      x: round2(working.x),
      y: round2(working.y),
      label: freeAngle ? "FREE ANGLE" : (orthoAxis ? (orthoAxis === "h" ? "HORIZONTAL" : "VERTICAL") : ""),
      score: 0,
      guides: orthoGuide ? [orthoGuide] : [],
    };
  }

  // Combine ortho guide
  if (orthoGuide && !(best.guides || []).some((g) => g.kind === orthoGuide.kind)) {
    best.guides = [...(best.guides || []), orthoGuide];
  }

  return finalize(best, session);
}

function finalize(candidate, session) {
  session.locked = {
    type: candidate.type,
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
