/**
 * Magicplan-style room reshape: add corners, offset wall section (bump/inset), move corner.
 * All mutations are canonical topology (vertices + walls). AABB rooms are promoted to
 * polygonal free walls on first reshape so regenerateRoomWalls cannot wipe freeform.
 */

import { dist, inches, round2, uid } from "./units";
import { SNAP_CONFIG } from "./snapEngine";
import {
  ensureLevelVertices,
  ensureVertex,
  indexVertices,
  linkWallVertices,
  syncWallFromVertices,
  wallAxis,
  bindCoincidentWallVertices,
} from "./planTopology";
import { emptyWall, roomOutsideBounds, wallLength } from "./model";

const COLLINEAR_DOT = 0.985; // ~10°

function cloneOpenings(list) {
  return (list || []).map((o) => ({ ...o }));
}

function wallPropsFrom(source) {
  return {
    kind: source.kind,
    thickness: source.thickness,
    height: source.height,
    work: source.work,
    note: source.note || "",
    plumbing: source.plumbing,
    bearing: source.bearing,
    stud_spacing: source.stud_spacing,
    foundation_contact: source.foundation_contact,
    bottom_plate_treatment: source.bottom_plate_treatment,
    source_room_id: source.source_room_id,
    parent_wall_id: source.parent_wall_id || source.id,
    lineage_root: source.lineage_root || source.parent_wall_id || source.id,
    shared_partition: source.shared_partition,
    adjacent_room_ids: source.adjacent_room_ids ? [...source.adjacent_room_ids] : undefined,
  };
}

function projectT(wall, x, y) {
  const axis = wallAxis(wall);
  const t = ((x - axis.x1) * axis.ux + (y - axis.y1) * axis.uy) / axis.len;
  const tc = Math.max(0, Math.min(1, t));
  return {
    t: tc,
    x: round2(axis.x1 + tc * (axis.x2 - axis.x1)),
    y: round2(axis.y1 + tc * (axis.y2 - axis.y1)),
    along: round2(tc * axis.len),
    len: axis.len,
    axis,
  };
}

/** True if proposed split point falls inside a hosted opening span. */
export function openingConflictAt(wall, alongInches, pad = 1) {
  const hits = [];
  (wall.openings || []).forEach((op) => {
    const start = inches(op.offset);
    const end = start + inches(op.width);
    if (alongInches >= start - pad && alongInches <= end + pad) {
      hits.push(op);
    }
  });
  return hits;
}

/**
 * Promote an AABB room's owned walls into vertex-linked polygonal walls.
 * Idempotent when room.geometry === "polygon".
 */
export function ensureRoomPolygonal(level, roomId) {
  const room = (level.rooms || []).find((r) => r.id === roomId);
  if (!room) return level;
  if (room.geometry === "polygon") {
    return bindCoincidentWallVertices(level);
  }

  let next = ensureLevelVertices(level);
  const owned = (next.walls || []).filter((w) => w.source_room_id === roomId);
  if (!owned.length) {
    return {
      ...next,
      rooms: (next.rooms || []).map((r) => (
        r.id === roomId ? { ...r, geometry: "polygon", boundaryVertexIds: r.boundaryVertexIds || [] } : r
      )),
    };
  }

  owned.forEach((wall) => {
    const linked = linkWallVertices(next, {
      ...wall,
      room_side: undefined,
      polygonal: true,
    });
    next = linked.level;
  });

  // Collect ordered boundary from wall loop (best-effort for rectangle)
  const verts = indexVertices(next);
  const boundary = [];
  const seen = new Set();
  owned.forEach((w) => {
    const live = (next.walls || []).find((row) => row.id === w.id) || w;
    [live.startVertexId, live.endVertexId].forEach((id) => {
      if (id && !seen.has(id)) {
        seen.add(id);
        boundary.push(id);
      }
    });
  });

  next = {
    ...next,
    rooms: (next.rooms || []).map((r) => (
      r.id === roomId
        ? {
          ...r,
          geometry: "polygon",
          boundaryVertexIds: boundary,
          shared_sides: undefined,
        }
        : r
    )),
    walls: (next.walls || []).map((w) => (
      w.source_room_id === roomId
        ? { ...w, room_side: undefined, polygonal: true }
        : w
    )),
  };
  return syncRoomBoundsFromPolygon(next, roomId);
}

/** Update AABB x/y/width/depth from polygonal wall endpoints (compat for hit-test/labels). */
export function syncRoomBoundsFromPolygon(level, roomId) {
  const room = (level.rooms || []).find((r) => r.id === roomId);
  if (!room) return level;
  const walls = (level.walls || []).filter((w) => w.source_room_id === roomId);
  if (!walls.length) return level;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  walls.forEach((w) => {
    minX = Math.min(minX, w.x1, w.x2);
    minY = Math.min(minY, w.y1, w.y2);
    maxX = Math.max(maxX, w.x1, w.x2);
    maxY = Math.max(maxY, w.y1, w.y2);
  });
  if (!Number.isFinite(minX)) return level;
  // Approximate outside bounds: wall centerlines are inset by t/2 — expand slightly
  const t = Math.max(inches(room.wall_thickness) || 3.5, 1);
  const half = t / 2;
  return {
    ...level,
    rooms: (level.rooms || []).map((r) => (
      r.id === roomId
        ? {
          ...r,
          x: round2(minX - half),
          y: round2(minY - half),
          width: round2((maxX - minX) + t),
          depth: round2((maxY - minY) + t),
        }
        : r
    )),
  };
}

export function polygonAreaFromWalls(walls = []) {
  // Shoelace from ordered edges is hard without loop order; use AABB of endpoints as fallback
  // Prefer actual polygon if we can walk the loop.
  const pts = [];
  const used = new Set();
  if (!walls.length) return 0;
  let cur = walls[0];
  let atEnd = false;
  let guard = 0;
  while (cur && guard < walls.length + 2) {
    guard += 1;
    const x = atEnd ? cur.x2 : cur.x1;
    const y = atEnd ? cur.y2 : cur.y1;
    const vid = atEnd ? cur.endVertexId : cur.startVertexId;
    pts.push({ x: inches(x), y: inches(y) });
    used.add(cur.id);
    const nextVid = atEnd ? cur.startVertexId : cur.endVertexId;
    // Actually walk: leave via the far endpoint
    const leaveId = atEnd ? cur.startVertexId : cur.endVertexId;
    void nextVid;
    const next = walls.find((w) => (
      !used.has(w.id)
      && (w.startVertexId === leaveId || w.endVertexId === leaveId)
    ));
    if (!next) break;
    atEnd = next.startVertexId === leaveId;
    cur = next;
  }
  if (pts.length < 3) {
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    walls.forEach((w) => {
      minX = Math.min(minX, w.x1, w.x2);
      minY = Math.min(minY, w.y1, w.y2);
      maxX = Math.max(maxX, w.x1, w.x2);
      maxY = Math.max(maxY, w.y1, w.y2);
    });
    return round2(Math.max(0, maxX - minX) * Math.max(0, maxY - minY));
  }
  let sum = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const j = (i + 1) % pts.length;
    sum += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return round2(Math.abs(sum) / 2);
}

/**
 * Insert a canonical vertex on a wall and split into two segments.
 * Openings redistributed by wall-local offset. Rejects splits through openings.
 */
export function insertVertexOnWall(level, wallId, worldX, worldY) {
  let next = ensureLevelVertices(level);
  const wall = (next.walls || []).find((w) => w.id === wallId);
  if (!wall) return { level: next, error: "Wall not found" };

  // Promote owning room(s) first
  if (wall.source_room_id) {
    next = ensureRoomPolygonal(next, wall.source_room_id);
  }
  (wall.adjacent_room_ids || []).forEach((rid) => {
    if (rid && rid !== wall.source_room_id) next = ensureRoomPolygonal(next, rid);
  });

  const live = (next.walls || []).find((w) => w.id === wallId) || wall;
  const linked = linkWallVertices(next, live);
  next = linked.level;
  const w = linked.wall;

  const hit = projectT(w, worldX, worldY);
  if (hit.along < 3 || hit.along > hit.len - 3) {
    return { level: next, error: "Corner too close to wall end", vertex: null };
  }
  const conflicts = openingConflictAt(w, hit.along, 1);
  if (conflicts.length) {
    return {
      level: next,
      error: "CORNER CONFLICT — move outside the opening",
      conflictOpenings: conflicts,
      vertex: null,
    };
  }

  const made = ensureVertex(next, hit.x, hit.y);
  next = made.level;
  const vertex = made.vertex;

  // Already a vertex at this station?
  if (w.startVertexId === vertex.id || w.endVertexId === vertex.id) {
    return { level: next, wall: w, vertex, created: false };
  }

  const props = wallPropsFrom(w);
  const openings = cloneOpenings(w.openings);
  const leftOpenings = [];
  const rightOpenings = [];
  openings.forEach((op) => {
    const start = inches(op.offset);
    const end = start + inches(op.width);
    if (end <= hit.along + 0.05) leftOpenings.push(op);
    else if (start >= hit.along - 0.05) {
      rightOpenings.push({ ...op, offset: round2(start - hit.along) });
    } else {
      // Should have been caught by conflict check
      leftOpenings.push(op);
    }
  });

  const left = {
    ...emptyWall(w.x1, w.y1, vertex.x, vertex.y, w.kind),
    ...props,
    id: w.id, // keep original id on left segment for lineage continuity
    startVertexId: w.startVertexId,
    endVertexId: vertex.id,
    x1: w.x1,
    y1: w.y1,
    x2: vertex.x,
    y2: vertex.y,
    openings: leftOpenings,
    polygonal: true,
    reshape_span: false,
  };
  const right = {
    ...emptyWall(vertex.x, vertex.y, w.x2, w.y2, w.kind),
    ...props,
    id: uid(),
    startVertexId: vertex.id,
    endVertexId: w.endVertexId,
    x1: vertex.x,
    y1: vertex.y,
    x2: w.x2,
    y2: w.y2,
    openings: rightOpenings,
    polygonal: true,
    reshape_span: false,
  };

  next = {
    ...next,
    walls: (next.walls || []).map((row) => (row.id === w.id ? left : row)).concat([right]),
  };

  if (props.source_room_id) next = syncRoomBoundsFromPolygon(next, props.source_room_id);

  return {
    level: next,
    wallLeft: left,
    wallRight: right,
    vertex,
    created: true,
    along: hit.along,
  };
}

/**
 * Commit two corners on a wall; returns the middle segment id (P1–P2).
 * Order of clicks does not matter.
 */
export function addTwoCornersOnWall(level, wallId, pointA, pointB) {
  const first = insertVertexOnWall(level, wallId, pointA.x, pointA.y);
  if (first.error) return first;

  // After first split, original wall id is left segment — find which segment contains pointB
  let next = first.level;
  const candidates = (next.walls || []).filter((w) => (
    w.id === wallId || w.parent_wall_id === wallId || w.lineage_root === (first.wallLeft?.lineage_root)
    || w.id === first.wallRight?.id
  ));
  // Prefer wall under pointB
  let host = null;
  let bestD = 1e9;
  candidates.forEach((w) => {
    const hit = projectT(w, pointB.x, pointB.y);
    const d = dist(pointB.x, pointB.y, hit.x, hit.y);
    if (d < bestD && hit.t > 0.02 && hit.t < 0.98) {
      bestD = d;
      host = w;
    }
  });
  if (!host) {
    // Fallback: the right piece from first split
    host = first.wallRight || (next.walls || []).find((w) => w.id === first.wallRight?.id);
  }
  if (!host) return { level: next, error: "Could not place second corner" };

  const second = insertVertexOnWall(next, host.id, pointB.x, pointB.y);
  if (second.error) return { ...second, level: next };

  next = second.level;

  // Middle segment: wall whose endpoints are the two new vertices
  const v1 = first.vertex?.id;
  const v2 = second.vertex?.id;
  let mid = (next.walls || []).find((w) => (
    (w.startVertexId === v1 && w.endVertexId === v2)
    || (w.startVertexId === v2 && w.endVertexId === v1)
  ));

  // If first vertex was on left of host and second split host, mid might be left of second
  if (!mid && v1 && v2) {
    mid = (next.walls || []).find((w) => (
      [w.startVertexId, w.endVertexId].includes(v1)
      && [w.startVertexId, w.endVertexId].includes(v2)
    ));
  }

  if (mid) {
    next = {
      ...next,
      walls: (next.walls || []).map((w) => (
        w.id === mid.id
          ? { ...w, reshape_span: true, is_reshape_span: true }
          : w
      )),
    };
    mid = (next.walls || []).find((w) => w.id === mid.id);
  }

  return {
    level: next,
    midWall: mid,
    midWallId: mid?.id || null,
    vertexIds: [v1, v2].filter(Boolean),
  };
}

function wallsAtVertex(level, vertexId) {
  return (level.walls || []).filter((w) => (
    w.startVertexId === vertexId || w.endVertexId === vertexId
  ));
}

function isCollinear(a, b) {
  const aa = wallAxis(a);
  const bb = wallAxis(b);
  return Math.abs(aa.ux * bb.ux + aa.uy * bb.uy) >= COLLINEAR_DOT;
}

/** True when mid span still lies on the original straight wall (needs connector creation). */
export function isReshapeSpanPending(level, wallId) {
  const wall = (level.walls || []).find((w) => w.id === wallId);
  if (!wall?.startVertexId || !wall?.endVertexId) return false;
  if (wall.is_reshape_span || wall.reshape_span) return true;
  const startN = wallsAtVertex(level, wall.startVertexId).filter((w) => w.id !== wallId);
  const endN = wallsAtVertex(level, wall.endVertexId).filter((w) => w.id !== wallId);
  if (startN.length !== 1 || endN.length !== 1) return false;
  return isCollinear(wall, startN[0]) && isCollinear(wall, endN[0]);
}

/**
 * Offset middle wall section perpendicular by distance (inches).
 * Positive distance follows wall right-hand normal.
 * Creates P1' / P2' + connector walls on first offset; subsequent calls move the face.
 */
export function offsetWallSection(level, wallId, distanceInches, { outwardNormal = null } = {}) {
  let next = bindCoincidentWallVertices(level);
  const wall = (next.walls || []).find((w) => w.id === wallId);
  if (!wall) return next;
  const distance = inches(distanceInches);
  if (Math.abs(distance) < 1e-6) return next;

  const axis = wallAxis(wall);
  let nx = axis.nx;
  let ny = axis.ny;
  if (outwardNormal && Number.isFinite(outwardNormal.x) && Number.isFinite(outwardNormal.y)) {
    // Flip so positive distance matches requested outward sense
    const dot = nx * outwardNormal.x + ny * outwardNormal.y;
    if (dot < 0) {
      nx = -nx;
      ny = -ny;
    }
  }

  if (isReshapeSpanPending(next, wallId)) {
    return createBumpFromSpan(next, wall, distance, nx, ny);
  }

  // Already a bump face — move its two vertices
  const dx = nx * distance;
  const dy = ny * distance;
  const sId = wall.startVertexId;
  const eId = wall.endVertexId;
  next = {
    ...next,
    vertices: (next.vertices || []).map((v) => {
      if (v.id === sId) return { ...v, x: round2(v.x + dx), y: round2(v.y + dy) };
      if (v.id === eId) return { ...v, x: round2(v.x + dx), y: round2(v.y + dy) };
      return v;
    }),
  };
  const verts = indexVertices(next);
  next = {
    ...next,
    walls: (next.walls || []).map((w) => syncWallFromVertices(w, verts)),
  };
  if (wall.source_room_id) next = syncRoomBoundsFromPolygon(next, wall.source_room_id);
  (wall.adjacent_room_ids || []).forEach((rid) => {
    if (rid) next = syncRoomBoundsFromPolygon(next, rid);
  });
  return next;
}

function createBumpFromSpan(level, wall, distance, nx, ny) {
  let next = level;
  const p1 = { x: inches(wall.x1), y: inches(wall.y1), id: wall.startVertexId };
  const p2 = { x: inches(wall.x2), y: inches(wall.y2), id: wall.endVertexId };
  const p1p = { x: round2(p1.x + nx * distance), y: round2(p1.y + ny * distance) };
  const p2p = { x: round2(p2.x + nx * distance), y: round2(p2.y + ny * distance) };

  const a = ensureVertex(next, p1p.x, p1p.y);
  next = a.level;
  const b = ensureVertex(next, p2p.x, p2p.y);
  next = b.level;
  const v1p = a.vertex;
  const v2p = b.vertex;

  const props = wallPropsFrom(wall);
  // Move face wall to P1'–P2', keep openings
  const face = {
    ...wall,
    startVertexId: v1p.id,
    endVertexId: v2p.id,
    x1: v1p.x,
    y1: v1p.y,
    x2: v2p.x,
    y2: v2p.y,
    reshape_span: false,
    is_reshape_span: false,
    is_bump_face: true,
    polygonal: true,
  };

  const side1 = {
    ...emptyWall(p1.x, p1.y, v1p.x, v1p.y, wall.kind),
    ...props,
    id: uid(),
    startVertexId: p1.id,
    endVertexId: v1p.id,
    openings: [],
    polygonal: true,
    is_bump_connector: true,
  };
  const side2 = {
    ...emptyWall(v2p.x, v2p.y, p2.x, p2.y, wall.kind),
    ...props,
    id: uid(),
    startVertexId: v2p.id,
    endVertexId: p2.id,
    openings: [],
    polygonal: true,
    is_bump_connector: true,
  };

  next = {
    ...next,
    walls: (next.walls || []).map((w) => (w.id === wall.id ? face : w)).concat([side1, side2]),
  };

  if (props.source_room_id) next = syncRoomBoundsFromPolygon(next, props.source_room_id);
  (props.adjacent_room_ids || []).forEach((rid) => {
    if (rid) next = syncRoomBoundsFromPolygon(next, rid);
  });
  return next;
}

/** Apply section offset from a frozen base level (live drag). Distance is absolute from origin. */
export function applySectionOffsetFromOrigin(baseLevel, wallId, originWall, distanceInches, outwardNormal) {
  const distance = inches(distanceInches);
  if (isReshapeSpanPending(baseLevel, wallId)) {
    return offsetWallSection(baseLevel, wallId, distance, { outwardNormal });
  }
  // Absolute relocate face endpoints from origin wall + distance along normal
  let next = bindCoincidentWallVertices(baseLevel);
  const wall = (next.walls || []).find((w) => w.id === wallId) || originWall;
  if (!wall) return next;
  const axis = wallAxis(originWall || wall);
  let nx = axis.nx;
  let ny = axis.ny;
  if (outwardNormal && Number.isFinite(outwardNormal.x)) {
    const dot = nx * outwardNormal.x + ny * outwardNormal.y;
    if (dot < 0) {
      nx = -nx;
      ny = -ny;
    }
  }
  const ox1 = inches(originWall.x1);
  const oy1 = inches(originWall.y1);
  const ox2 = inches(originWall.x2);
  const oy2 = inches(originWall.y2);
  const sId = wall.startVertexId;
  const eId = wall.endVertexId;
  next = {
    ...next,
    vertices: (next.vertices || []).map((v) => {
      if (v.id === sId) return { ...v, x: round2(ox1 + nx * distance), y: round2(oy1 + ny * distance) };
      if (v.id === eId) return { ...v, x: round2(ox2 + nx * distance), y: round2(oy2 + ny * distance) };
      return v;
    }),
  };
  const verts = indexVertices(next);
  next = {
    ...next,
    walls: (next.walls || []).map((w) => syncWallFromVertices(w, verts)),
  };
  if (wall.source_room_id) next = syncRoomBoundsFromPolygon(next, wall.source_room_id);
  return next;
}

/**
 * Move a canonical plan vertex. Connected walls lengthen/rotate automatically.
 */
export function movePlanVertex(level, vertexId, x, y, { snapOrtho = false, orthoFrom = null } = {}) {
  let next = ensureLevelVertices(level);
  let tx = round2(inches(x));
  let ty = round2(inches(y));

  if (snapOrtho && orthoFrom) {
    const dx = Math.abs(tx - orthoFrom.x);
    const dy = Math.abs(ty - orthoFrom.y);
    if (dx < dy) tx = round2(orthoFrom.x);
    else ty = round2(orthoFrom.y);
  }

  next = {
    ...next,
    vertices: (next.vertices || []).map((v) => (
      v.id === vertexId ? { ...v, x: tx, y: ty } : v
    )),
  };
  const verts = indexVertices(next);
  next = {
    ...next,
    walls: (next.walls || []).map((w) => syncWallFromVertices(w, verts)),
  };

  const roomIds = new Set();
  (next.walls || []).forEach((w) => {
    if ((w.startVertexId === vertexId || w.endVertexId === vertexId) && w.source_room_id) {
      roomIds.add(w.source_room_id);
    }
  });
  roomIds.forEach((rid) => {
    next = syncRoomBoundsFromPolygon(next, rid);
  });
  return next;
}

/** Signed perpendicular distance for section drag (right-hand normal of origin wall). */
export function signedSectionDragDistance(originWall, cursorWorld, roomOutward = null) {
  const axis = wallAxis(originWall);
  const midX = (axis.x1 + axis.x2) / 2;
  const midY = (axis.y1 + axis.y2) / 2;
  const cx = inches(cursorWorld.x);
  const cy = inches(cursorWorld.y);
  let nx = axis.nx;
  let ny = axis.ny;
  if (roomOutward) {
    const dot = nx * roomOutward.x + ny * roomOutward.y;
    if (dot < 0) {
      nx = -nx;
      ny = -ny;
    }
  }
  return round2((cx - midX) * nx + (cy - midY) * ny);
}

/** Outward normal for a room relative to a wall (from wall mid toward outside of room AABB/poly). */
export function roomOutwardNormal(level, wall) {
  if (!wall?.source_room_id) return null;
  const room = (level.rooms || []).find((r) => r.id === wall.source_room_id);
  if (!room) return null;
  const b = roomOutsideBounds(room);
  const axis = wallAxis(wall);
  const midX = (axis.x1 + axis.x2) / 2;
  const midY = (axis.y1 + axis.y2) / 2;
  const rcx = b.left + b.width / 2;
  const rcy = b.top + b.depth / 2;
  // Vector from room center to wall mid points outward for exterior walls
  let ox = midX - rcx;
  let oy = midY - rcy;
  const len = Math.hypot(ox, oy) || 1;
  ox /= len;
  oy /= len;
  return { x: ox, y: oy };
}

export function setSectionOffsetExact(level, wallId, targetOffsetInches, baseSpanWall) {
  // For a bump face, connector length ≈ offset. Measure current connector length.
  const wall = (level.walls || []).find((w) => w.id === wallId);
  if (!wall) return level;
  const connectors = (level.walls || []).filter((w) => (
    w.is_bump_connector
    && (w.startVertexId === wall.startVertexId || w.endVertexId === wall.startVertexId
      || w.startVertexId === wall.endVertexId || w.endVertexId === wall.endVertexId)
  ));
  const current = connectors.length
    ? wallLength(connectors[0])
    : 0;
  const delta = inches(targetOffsetInches) - current;
  if (Math.abs(delta) < 1e-6) return level;
  const outward = roomOutwardNormal(level, wall);
  // Determine sign: if face is already outward, positive delta increases offset along outward
  return offsetWallSection(level, wallId, delta, { outwardNormal: outward });
}

export function projectPointOnWall(wall, x, y) {
  return projectT(wall, x, y);
}

export { wallLength };
