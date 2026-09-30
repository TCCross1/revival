/**
 * Plan topology: shared vertices + wall operators + room-face closure.
 * Walls keep x1,y1,x2,y2 synced from vertices for compatibility with existing systems.
 */

import { dist, inches, round2, uid } from "./units";
import { SNAP_CONFIG } from "./snapEngine";
import {
  createRoomFromOutsideBounds,
  emptyWall,
  fitRoofToRooms,
  regenerateRoomWalls,
  roomOutsideBounds,
  wallsFromRoom,
} from "./model";

export function emptyVertex(x, y, partial = {}) {
  return {
    id: partial.id || uid(),
    x: round2(x),
    y: round2(y),
  };
}

export function ensureLevelVertices(level) {
  if (Array.isArray(level?.vertices)) return level;
  return { ...level, vertices: [] };
}

export function indexVertices(level) {
  const map = {};
  (level.vertices || []).forEach((v) => { map[v.id] = v; });
  return map;
}

/** Find existing vertex near (x,y) or create one. */
export function ensureVertex(level, x, y, tol = SNAP_CONFIG.vertexMergeIn) {
  const next = ensureLevelVertices(level);
  const px = round2(inches(x));
  const py = round2(inches(y));
  const found = (next.vertices || []).find((v) => dist(v.x, v.y, px, py) <= tol);
  if (found) return { level: next, vertex: found, created: false };
  const vertex = emptyVertex(px, py);
  return {
    level: { ...next, vertices: [...(next.vertices || []), vertex] },
    vertex,
    created: true,
  };
}

export function syncWallFromVertices(wall, verticesById) {
  const a = verticesById[wall.startVertexId];
  const b = verticesById[wall.endVertexId];
  if (!a || !b) return wall;
  return { ...wall, x1: a.x, y1: a.y, x2: b.x, y2: b.y };
}

export function wallAxis(wall) {
  const x1 = inches(wall.x1);
  const y1 = inches(wall.y1);
  const x2 = inches(wall.x2);
  const y2 = inches(wall.y2);
  const len = dist(x1, y1, x2, y2) || 1;
  return {
    x1, y1, x2, y2, len,
    ux: (x2 - x1) / len,
    uy: (y2 - y1) / len,
    nx: -(y2 - y1) / len,
    ny: (x2 - x1) / len,
  };
}

/** Attach start/end vertex ids; merge nearby endpoints into shared vertices. */
export function linkWallVertices(level, wall, tol = SNAP_CONFIG.vertexMergeIn) {
  let next = ensureLevelVertices(level);
  const s = ensureVertex(next, wall.x1, wall.y1, tol);
  next = s.level;
  const e = ensureVertex(next, wall.x2, wall.y2, tol);
  next = e.level;
  const linked = {
    ...wall,
    startVertexId: s.vertex.id,
    endVertexId: e.vertex.id,
    x1: s.vertex.x,
    y1: s.vertex.y,
    x2: e.vertex.x,
    y2: e.vertex.y,
  };
  const has = (next.walls || []).some((w) => w.id === linked.id);
  const walls = has
    ? (next.walls || []).map((w) => (w.id === linked.id ? linked : w))
    : [...(next.walls || []), linked];
  return { level: { ...next, walls }, wall: linked };
}

/** Ensure every wall endpoint that coincides with another shares a vertex id. */
export function bindCoincidentWallVertices(level, tol = SNAP_CONFIG.vertexMergeIn * 2) {
  let next = ensureLevelVertices(level);
  (next.walls || []).forEach((wall) => {
    const res = linkWallVertices(next, wall, tol);
    next = res.level;
  });
  const verts = indexVertices(next);
  next = {
    ...next,
    walls: (next.walls || []).map((w) => syncWallFromVertices(w, verts)),
  };
  return next;
}

/**
 * Commit a Point & Line wall with shared vertices.
 * closeTo: chain-start point for CLOSE ROOM (reuse exact vertex).
 */
export function commitDrawWall(level, wallPartial, { closeTo } = {}) {
  let next = ensureLevelVertices(level);
  const start = ensureVertex(next, wallPartial.x1, wallPartial.y1);
  next = start.level;
  const endTarget = closeTo || { x: wallPartial.x2, y: wallPartial.y2 };
  const end = ensureVertex(next, endTarget.x, endTarget.y);
  next = end.level;
  const wall = {
    ...wallPartial,
    startVertexId: start.vertex.id,
    endVertexId: end.vertex.id,
    x1: start.vertex.x,
    y1: start.vertex.y,
    x2: end.vertex.x,
    y2: end.vertex.y,
  };
  next = { ...next, walls: [...(next.walls || []), wall] };
  if (closeTo) next = maybeDetectOrthogonalRoom(next);
  return { level: next, wall, closed: Boolean(closeTo) };
}

/**
 * Merge vertices closer than `tol` into one survivor and rewire every wall to it,
 * so coincident endpoints become one topological joint.
 */
export function mergeCoincidentVertices(level, tol = SNAP_CONFIG.weldTolIn) {
  const next = ensureLevelVertices(level);
  const survivors = [];
  const remap = {};
  (next.vertices || []).forEach((v) => {
    const keep = survivors.find((s) => dist(s.x, s.y, v.x, v.y) <= tol);
    if (keep) remap[v.id] = keep.id;
    else survivors.push(v);
  });
  if (!Object.keys(remap).length) return next;
  const byId = {};
  survivors.forEach((v) => { byId[v.id] = v; });
  return {
    ...next,
    vertices: survivors,
    walls: (next.walls || []).map((w) => {
      const startVertexId = remap[w.startVertexId] || w.startVertexId;
      const endVertexId = remap[w.endVertexId] || w.endVertexId;
      if (startVertexId === w.startVertexId && endVertexId === w.endVertexId) return w;
      return syncWallFromVertices({ ...w, startVertexId, endVertexId }, byId);
    }),
  };
}

/** Split a free wall at `vertex` (on its span); openings keep their positions. */
function splitFreeWallAtVertex(level, host, vertex) {
  const a = wallAxis(host);
  const along = (inches(vertex.x) - a.x1) * a.ux + (inches(vertex.y) - a.y1) * a.uy;
  const openings = (host.openings || []).map((op) => ({ ...op }));
  const crossing = openings.some((op) => {
    const start = inches(op.offset);
    const end = start + inches(op.width);
    return along > start + 0.05 && along < end - 0.05;
  });
  if (crossing) return { level, split: false };
  const left = {
    ...host,
    x2: vertex.x,
    y2: vertex.y,
    endVertexId: vertex.id,
    openings: openings.filter((op) => inches(op.offset) + inches(op.width) <= along + 0.05),
  };
  const right = {
    ...host,
    id: uid(),
    x1: vertex.x,
    y1: vertex.y,
    startVertexId: vertex.id,
    openings: openings
      .filter((op) => inches(op.offset) >= along - 0.05)
      .map((op) => ({ ...op, offset: round2(inches(op.offset) - along) })),
  };
  const walls = [];
  (level.walls || []).forEach((w) => {
    if (w.id === host.id) walls.push(left, right);
    else walls.push(w);
  });
  return { level: { ...level, walls }, split: true, rightId: right.id };
}

/**
 * Post-commit weld for a Point & Line wall so the plan is topologically connected:
 * 1) vertices within `tol` (1/16") merge into one joint
 * 2) free walls whose endpoint sits on the new wall's vertex adopt that vertex id
 * 3) a new endpoint landing on another free wall's span splits it (T) at a shared vertex
 * Room-owned walls are never split here; they regenerate from their room rectangle.
 */
export function weldDrawnWall(level, wallId, tol = SNAP_CONFIG.weldTolIn) {
  let next = mergeCoincidentVertices(ensureLevelVertices(level), tol);
  const wall = (next.walls || []).find((w) => w.id === wallId);
  if (!wall) return { level: next, splitWallIds: [], joinedWallIds: [] };
  const verts = indexVertices(next);
  const splitWallIds = [];
  const joinedWallIds = [];

  [wall.startVertexId, wall.endVertexId].forEach((vid) => {
    const v = verts[vid];
    if (!v) return;

    next = {
      ...next,
      walls: (next.walls || []).map((w) => {
        if (w.id === wallId || w.source_room_id) return w;
        let patched = w;
        if (w.startVertexId !== vid && dist(w.x1, w.y1, v.x, v.y) <= tol) {
          patched = { ...patched, startVertexId: vid, x1: v.x, y1: v.y };
        }
        if (w.endVertexId !== vid && dist(w.x2, w.y2, v.x, v.y) <= tol) {
          patched = { ...patched, endVertexId: vid, x2: v.x, y2: v.y };
        }
        if (patched !== w) joinedWallIds.push(w.id);
        return patched;
      }),
    };

    const host = (next.walls || []).find((w) => {
      if (w.id === wallId || w.source_room_id) return false;
      if (w.startVertexId === vid || w.endVertexId === vid) return false;
      const a = wallAxis(w);
      const along = (v.x - a.x1) * a.ux + (v.y - a.y1) * a.uy;
      if (along < 1 || along > a.len - 1) return false;
      const perp = Math.abs((v.x - a.x1) * a.nx + (v.y - a.y1) * a.ny);
      return perp <= SNAP_CONFIG.vertexMergeIn;
    });
    if (!host) return;
    const res = splitFreeWallAtVertex(next, host, v);
    if (res.split) {
      next = res.level;
      splitWallIds.push(host.id, res.rightId);
    }
  });

  return { level: next, splitWallIds, joinedWallIds };
}

/**
 * Commit closing segment that lands on an existing wall and form Room B
 * using that wall as the shared fourth boundary (no duplicate wall).
 */
export function commitAdjacentRoomClosure(level, {
  wallPartial,
  chainStart,
  closingWallId,
  chainWallIds = [],
} = {}) {
  const closingWall = (level.walls || []).find((w) => w.id === closingWallId);
  if (!closingWall) {
    return commitDrawWall(level, wallPartial, { closeTo: { x: wallPartial.x2, y: wallPartial.y2 } });
  }

  // Do not run standalone 4-wall room detect — adjacent closure owns room creation.
  const committed = commitDrawWall(level, wallPartial);
  let next = committed.level;
  const newWallIds = [...chainWallIds, committed.wall.id].filter(Boolean);

  const pts = [];
  if (chainStart) pts.push({ x: inches(chainStart.x), y: inches(chainStart.y) });
  pts.push({ x: inches(wallPartial.x1), y: inches(wallPartial.y1) });
  pts.push({ x: inches(wallPartial.x2), y: inches(wallPartial.y2) });
  newWallIds.forEach((id) => {
    const w = (next.walls || []).find((row) => row.id === id);
    if (!w) return;
    pts.push({ x: inches(w.x1), y: inches(w.y1) });
    pts.push({ x: inches(w.x2), y: inches(w.y2) });
  });

  let left = Math.min(...pts.map((p) => p.x));
  let right = Math.max(...pts.map((p) => p.x));
  let top = Math.min(...pts.map((p) => p.y));
  let bottom = Math.max(...pts.map((p) => p.y));

  if (closingWall.source_room_id) {
    const hostRoom = (next.rooms || []).find((r) => r.id === closingWall.source_room_id);
    if (hostRoom) {
      const b = roomOutsideBounds(hostRoom);
      const side = closingWall.room_side;
      if (side === "east") left = b.right;
      else if (side === "west") right = b.left;
      else if (side === "south") top = b.bottom;
      else if (side === "north") bottom = b.top;

      if (side === "east" || side === "west") {
        if (Math.abs(top - b.top) <= 3) top = b.top;
        if (Math.abs(bottom - b.bottom) <= 3) bottom = b.bottom;
      }
      if (side === "north" || side === "south") {
        if (Math.abs(left - b.left) <= 3) left = b.left;
        if (Math.abs(right - b.right) <= 3) right = b.right;
      }
    }
  }

  const width = round2(right - left);
  const depth = round2(bottom - top);
  if (width < 24 || depth < 24) {
    return { level: next, wall: committed.wall, closed: true, room: null };
  }

  const removeIds = new Set(newWallIds);
  next = {
    ...next,
    walls: (next.walls || []).filter((w) => !removeIds.has(w.id)),
  };

  const room = createRoomFromOutsideBounds("Room", left, top, right, bottom);
  room.from_point_line = true;
  next = fitRoofToRooms({
    ...next,
    rooms: [...(next.rooms || []), room],
    walls: [...(next.walls || []), ...wallsFromRoom(room)],
  });

  next = mergeSharedPartition(next, room.id, closingWall.id);

  return {
    level: next,
    wall: committed.wall,
    closed: true,
    room,
    sharedWallId: closingWall.id,
  };
}

/**
 * Remove the new room's duplicate side wall and mark the existing wall as shared.
 * Existing thicker walls remain dominant (keep their thickness / specs).
 */
export function mergeSharedPartition(level, newRoomId, existingWallId) {
  const existing = (level.walls || []).find((w) => w.id === existingWallId);
  const newRoom = (level.rooms || []).find((r) => r.id === newRoomId);
  if (!existing || !newRoom) return level;

  const sharedSide = inferSharedSideForRoom(newRoom, existing);
  if (!sharedSide) {
    return removeCoincidentDuplicateWall(level, newRoomId, existing);
  }

  const ownerIds = uniqueIds([
    existing.source_room_id,
    ...(existing.adjacent_room_ids || []),
    newRoomId,
  ]);

  const shared = {
    ...existing,
    shared_partition: true,
    adjacent_room_ids: ownerIds,
  };

  return {
    ...level,
    walls: (level.walls || [])
      .filter((w) => !(w.source_room_id === newRoomId && w.room_side === sharedSide))
      .map((w) => (w.id === existingWallId ? shared : w)),
    rooms: (level.rooms || []).map((r) => {
      if (r.id !== newRoomId) return r;
      return {
        ...r,
        shared_sides: {
          ...(r.shared_sides || {}),
          [sharedSide]: existingWallId,
        },
      };
    }),
  };
}

function inferSharedSideForRoom(room, wall) {
  const b = roomOutsideBounds(room);
  const mx = (inches(wall.x1) + inches(wall.x2)) / 2;
  const my = (inches(wall.y1) + inches(wall.y2)) / 2;
  const t = Math.max(inches(wall.thickness) || 3.5, 1);
  const scores = {
    west: Math.min(Math.abs(mx - (b.left + t / 2)), Math.abs(mx - b.left)),
    east: Math.min(Math.abs(mx - (b.right - t / 2)), Math.abs(mx - b.right)),
    north: Math.min(Math.abs(my - (b.top + t / 2)), Math.abs(my - b.top)),
    south: Math.min(Math.abs(my - (b.bottom - t / 2)), Math.abs(my - b.bottom)),
  };
  const best = Object.entries(scores).sort((a, c) => a[1] - c[1])[0];
  return best && best[1] <= t + 2 ? best[0] : null;
}

function removeCoincidentDuplicateWall(level, newRoomId, existing) {
  const ex = wallAxis(existing);
  const nextWalls = (level.walls || []).filter((w) => {
    if (w.source_room_id !== newRoomId) return true;
    const a = wallAxis(w);
    const midDist = dist(
      (a.x1 + a.x2) / 2,
      (a.y1 + a.y2) / 2,
      (ex.x1 + ex.x2) / 2,
      (ex.y1 + ex.y2) / 2,
    );
    const parallel = Math.abs(a.ux * ex.uy - a.uy * ex.ux) < 0.08;
    return !(parallel && midDist < 6);
  });
  const ownerIds = uniqueIds([
    existing.source_room_id,
    ...(existing.adjacent_room_ids || []),
    newRoomId,
  ]);
  return {
    ...level,
    walls: nextWalls.map((w) => (
      w.id === existing.id
        ? { ...w, shared_partition: true, adjacent_room_ids: ownerIds }
        : w
    )),
  };
}

function oppositeSide(side) {
  return ({ north: "south", south: "north", east: "west", west: "east" })[side] || null;
}

function uniqueIds(ids) {
  return [...new Set(ids.filter(Boolean))];
}

/** Detect axis-aligned 4-wall rectangle and add a room label/AABB (standalone loops). */
export function maybeDetectOrthogonalRoom(level) {
  const walls = (level.walls || []).filter((w) => w.startVertexId && w.endVertexId && !w.source_room_id);
  const verts = indexVertices(level);
  if (walls.length < 4) return level;

  const adj = {};
  walls.forEach((w) => {
    adj[w.startVertexId] = adj[w.startVertexId] || new Set();
    adj[w.endVertexId] = adj[w.endVertexId] || new Set();
    adj[w.startVertexId].add(w.endVertexId);
    adj[w.endVertexId].add(w.startVertexId);
  });

  const visited = new Set();
  let next = level;
  Object.keys(adj).forEach((startId) => {
    if (visited.has(startId)) return;
    const component = [];
    const stack = [startId];
    while (stack.length) {
      const id = stack.pop();
      if (visited.has(id)) continue;
      visited.add(id);
      component.push(id);
      (adj[id] || []).forEach((n) => stack.push(n));
    }
    if (component.length !== 4) return;
    const xs = component.map((id) => verts[id]?.x).filter((n) => Number.isFinite(n));
    const ys = component.map((id) => verts[id]?.y).filter((n) => Number.isFinite(n));
    const uniqX = [...new Set(xs.map((v) => round2(v)))].sort((a, b) => a - b);
    const uniqY = [...new Set(ys.map((v) => round2(v)))].sort((a, b) => a - b);
    if (uniqX.length !== 2 || uniqY.length !== 2) return;
    const x = uniqX[0];
    const y = uniqY[0];
    const width = round2(uniqX[1] - uniqX[0]);
    const depth = round2(uniqY[1] - uniqY[0]);
    if (width < 24 || depth < 24) return;
    const exists = (next.rooms || []).some((r) => (
      Math.abs(r.x - x) < 0.75
      && Math.abs(r.y - y) < 0.75
      && Math.abs(r.width - width) < 0.75
      && Math.abs(r.depth - depth) < 0.75
    ));
    if (exists) return;
    // Prefer the thickness of the walls that closed this loop (exterior 6" / interior 4.5"),
    // not a hard-coded stud depth that drifts from the drawn walls.
    const loopWalls = walls.filter((w) => (
      component.includes(w.startVertexId) && component.includes(w.endVertexId)
    ));
    const avgT = loopWalls.length
      ? loopWalls.reduce((s, w) => s + Math.max(1, inches(w.thickness) || 3.5), 0) / loopWalls.length
      : 3.5;
    next = {
      ...next,
      rooms: [...(next.rooms || []), {
        id: uid(),
        name: "Room",
        kind: "room",
        x,
        y,
        width,
        depth,
        wall_thickness: round2(avgT),
        flooring: "lvp",
        wall_finish: "",
        note: "",
        from_point_line: true,
      }],
    };
  });
  return next;
}

/**
 * Move wall perpendicular by distance (inches) along right-hand normal of originWall.
 */
export function moveWallPerpendicular(level, wallId, distanceInches, originWall = null) {
  const wall = (level.walls || []).find((w) => w.id === wallId);
  if (!wall) return level;
  const distance = inches(distanceInches);
  if (Math.abs(distance) < 1e-9) return level;

  if (wall.shared_partition || (wall.adjacent_room_ids || []).length >= 2) {
    const room = (level.rooms || []).find((r) => r.id === wall.source_room_id);
    if (room?.geometry === "polygon" || wall.polygonal || wall.is_bump_face) {
      return moveFreeWallPerpendicular(level, wall, distance, originWall || wall);
    }
    return moveSharedPartitionWall(level, wall, distance);
  }
  if (wall.source_room_id && wall.room_side) {
    const room = (level.rooms || []).find((r) => r.id === wall.source_room_id);
    if (room?.geometry === "polygon" || wall.polygonal) {
      return moveFreeWallPerpendicular(level, wall, distance, originWall || wall);
    }
    return moveRoomOwnedWall(level, wall, distance);
  }
  return moveFreeWallPerpendicular(level, wall, distance, originWall || wall);
}

/**
 * Shared partition between two rooms: move once, resize both.
 */
function moveSharedPartitionWall(level, wall, distance) {
  const ownerId = wall.source_room_id;
  const otherIds = (wall.adjacent_room_ids || []).filter((id) => id && id !== ownerId);
  if (!ownerId || !otherIds.length) {
    return moveRoomOwnedWall(level, wall, distance);
  }

  let next = moveRoomOwnedWall(level, wall, distance);
  const owner = (next.rooms || []).find((r) => r.id === ownerId);
  if (!owner) return next;
  const ob = roomOutsideBounds(owner);
  const side = wall.room_side;

  otherIds.forEach((rid) => {
    const room = (next.rooms || []).find((r) => r.id === rid);
    if (!room) return;
    let { x, y, width, depth } = room;
    if (side === "east") {
      const newLeft = ob.right;
      const right = inches(room.x) + inches(room.width);
      x = newLeft;
      width = Math.max(36, round2(right - newLeft));
    } else if (side === "west") {
      const newRight = ob.left;
      width = Math.max(36, round2(newRight - inches(room.x)));
    } else if (side === "south") {
      const newTop = ob.bottom;
      const bottom = inches(room.y) + inches(room.depth);
      y = newTop;
      depth = Math.max(36, round2(bottom - newTop));
    } else if (side === "north") {
      const newBottom = ob.top;
      depth = Math.max(36, round2(newBottom - inches(room.y)));
    }
    next = {
      ...next,
      rooms: (next.rooms || []).map((r) => (
        r.id === rid
          ? { ...r, x: round2(x), y: round2(y), width: round2(width), depth: round2(depth) }
          : r
      )),
    };
    next = regenerateRoomWallsPreservingShared(next, rid);
  });

  const shared = (next.walls || []).find((w) => (
    w.source_room_id === ownerId && w.room_side === side
  ));
  if (shared) {
    next = {
      ...next,
      walls: (next.walls || []).map((w) => (
        w.id === shared.id
          ? {
            ...w,
            shared_partition: true,
            adjacent_room_ids: uniqueIds([ownerId, ...otherIds]),
          }
          : w
      )),
      rooms: (next.rooms || []).map((r) => {
        if (!otherIds.includes(r.id)) return r;
        const drop = oppositeSide(side);
        if (!drop) return r;
        return {
          ...r,
          shared_sides: { ...(r.shared_sides || {}), [drop]: shared.id },
        };
      }),
    };
    otherIds.forEach((rid) => {
      const drop = oppositeSide(side);
      next = {
        ...next,
        walls: (next.walls || []).filter((w) => !(w.source_room_id === rid && w.room_side === drop)),
      };
    });
  }
  return next;
}

function moveRoomOwnedWall(level, wall, distance) {
  const room = (level.rooms || []).find((r) => r.id === wall.source_room_id);
  if (!room) return level;
  let { x, y, width, depth } = room;
  const side = wall.room_side;
  if (side === "east") width = Math.max(36, round2(width + distance));
  else if (side === "west") {
    const nw = Math.max(36, round2(width - distance));
    x = round2(x + (width - nw));
    width = nw;
  } else if (side === "south") depth = Math.max(36, round2(depth + distance));
  else if (side === "north") {
    const nd = Math.max(36, round2(depth - distance));
    y = round2(y + (depth - nd));
    depth = nd;
  } else return level;

  let next = {
    ...level,
    rooms: (level.rooms || []).map((r) => (r.id === room.id ? { ...r, x, y, width, depth } : r)),
  };
  return regenerateRoomWallsPreservingShared(next, room.id);
}

/** regenerateRoomWalls but skip sides listed in room.shared_sides. */
export function regenerateRoomWallsPreservingShared(level, roomId, thickness) {
  const room = (level.rooms || []).find((r) => r.id === roomId);
  if (!room) return level;
  const sharedSides = room.shared_sides || {};
  const sharedIds = new Set(Object.values(sharedSides));

  const base = regenerateRoomWalls(level, roomId, thickness);
  const nextRoom = (base.rooms || []).find((r) => r.id === roomId) || room;
  const withSharedMeta = {
    ...nextRoom,
    shared_sides: sharedSides,
  };

  let walls = (base.walls || []).filter((w) => {
    if (w.source_room_id !== roomId) return true;
    if (sharedSides[w.room_side]) return false;
    return true;
  });

  walls = walls.map((w) => {
    if (!sharedIds.has(w.id) && !(w.shared_partition && (w.adjacent_room_ids || []).includes(roomId))) {
      return w;
    }
    return {
      ...w,
      shared_partition: true,
      adjacent_room_ids: uniqueIds([...(w.adjacent_room_ids || []), roomId, w.source_room_id]),
    };
  });

  return {
    ...base,
    rooms: (base.rooms || []).map((r) => (r.id === roomId ? withSharedMeta : r)),
    walls,
  };
}

function moveFreeWallPerpendicular(level, wall, distance, originWall) {
  let next = bindCoincidentWallVertices(level);
  const live = (next.walls || []).find((w) => w.id === wall.id) || wall;
  const axis = wallAxis(originWall);
  const dx = axis.nx * distance;
  const dy = axis.ny * distance;
  const startId = live.startVertexId;
  const endId = live.endVertexId;
  if (!startId || !endId) return level;

  const ox1 = inches(originWall.x1);
  const oy1 = inches(originWall.y1);
  const ox2 = inches(originWall.x2);
  const oy2 = inches(originWall.y2);
  next = {
    ...next,
    vertices: (next.vertices || []).map((v) => {
      if (v.id === startId) return { ...v, x: round2(ox1 + dx), y: round2(oy1 + dy) };
      if (v.id === endId) return { ...v, x: round2(ox2 + dx), y: round2(oy2 + dy) };
      return v;
    }),
  };

  const verts = indexVertices(next);
  next = {
    ...next,
    walls: (next.walls || []).map((w) => syncWallFromVertices(w, verts)),
  };
  return next;
}

/** Live drag helper: always apply distance against a frozen base level + origin wall. */
export function applyWallMoveFromOrigin(baseLevel, wallId, originWall, distanceInches) {
  const prepared = bindCoincidentWallVertices(baseLevel);
  return moveWallPerpendicular(prepared, wallId, distanceInches, originWall);
}

/**
 * Signed perpendicular distance for wall-body drag.
 */
export function signedWallDragDistance(originWall, cursorWorld) {
  const cx = inches(cursorWorld.x);
  const cy = inches(cursorWorld.y);
  const x1 = inches(originWall.x1);
  const y1 = inches(originWall.y1);
  const x2 = inches(originWall.x2);
  const y2 = inches(originWall.y2);
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  const side = originWall.room_side;
  if (side === "east") return round2(cx - midX);
  if (side === "west") return round2(midX - cx);
  if (side === "south") return round2(cy - midY);
  if (side === "north") return round2(midY - cy);
  const axis = wallAxis(originWall);
  return round2((cx - midX) * axis.nx + (cy - midY) * axis.ny);
}

export function wallIsOrthogonal(wall, tolDeg = 1.5) {
  const axis = wallAxis(wall);
  const deg = Math.abs((Math.atan2(axis.uy, axis.ux) * 180) / Math.PI);
  const n = deg % 90;
  return n <= tolDeg || Math.abs(n - 90) <= tolDeg;
}

export function makeDrawWallPartial(x1, y1, x2, y2, kind = "interior") {
  return emptyWall(x1, y1, x2, y2, kind);
}

/** Which room face sits at a wall's start or end endpoint (N/S/E/W room walls). */
function roomFaceAtEndpoint(wall, which) {
  const side = wall.room_side;
  if (side === "north") return which === "start" ? "west" : "east";
  if (side === "south") return which === "start" ? "east" : "west";
  if (side === "east") return which === "start" ? "north" : "south";
  if (side === "west") return which === "start" ? "south" : "north";
  return null;
}

function thicknessForSide(level, room, side) {
  const owned = (level.walls || []).find((w) => w.source_room_id === room.id && w.room_side === side);
  if (owned) return Math.max(1, inches(owned.thickness));
  return Math.max(1, inches(room.wall_thickness) || 3.5);
}

/**
 * Resize a wall's length so connected corners stay joined.
 * Room walls resize the room (and shared partitions) via moveWallPerpendicular.
 * Free walls slide the neighbor at the moving end, or extend a free tip.
 *
 * @param {"start"|"end"} options.keep  Fixed endpoint (default "start")
 * @param {"centerline"|"inside"} options.measure  How to interpret newLen (default "centerline")
 */
export function resizeWallLength(level, wallId, newLenInches, options = {}) {
  try {
    const keep = options.keep === "end" ? "end" : "start";
    const measure = options.measure === "inside" ? "inside" : "centerline";
    const wall = (level.walls || []).find((w) => w.id === wallId);
    if (!wall) return level;
    const targetRaw = Math.max(6, inches(newLenInches));
    if (!Number.isFinite(targetRaw)) return level;

    if (wall.source_room_id && wall.room_side) {
      return resizeRoomOwnedWallLength(level, wall, targetRaw, keep, measure);
    }
    return resizeFreeWallLength(level, wall, targetRaw, keep);
  } catch (err) {
    console.error("[resizeWallLength] failed", { wallId, error: err?.message || err });
    return level;
  }
}

function resizeRoomOwnedWallLength(level, wall, targetRaw, keep, measure) {
  const room = (level.rooms || []).find((r) => r.id === wall.source_room_id);
  if (!room) return level;
  const side = wall.room_side;
  const horizontal = side === "north" || side === "south";
  const westT = thicknessForSide(level, room, "west");
  const eastT = thicknessForSide(level, room, "east");
  const northT = thicknessForSide(level, room, "north");
  const southT = thicknessForSide(level, room, "south");

  let targetOutside;
  if (horizontal) {
    // N/S centerline spans the outside width.
    targetOutside = measure === "inside" ? targetRaw + westT + eastT : targetRaw;
  } else {
    // E/W centerline = outside depth − N/S thicknesses; inside face ≈ same.
    const tSum = northT + southT;
    targetOutside = measure === "inside" ? targetRaw + tSum : targetRaw + tSum;
  }
  targetOutside = Math.max(36, round2(targetOutside));

  const currentOutside = horizontal ? inches(room.width) : inches(room.depth);
  const delta = round2(targetOutside - currentOutside);
  if (Math.abs(delta) < 0.05) return level;

  const keepFace = roomFaceAtEndpoint(wall, keep);
  const moveFace = oppositeSide(keepFace);
  if (!moveFace) return level;

  // Slide the face opposite the kept endpoint. Sign matches moveRoomOwnedWall:
  // east/south positive = grow; west/north positive = shrink (move inward).
  let signed = delta;
  if (moveFace === "west" || moveFace === "north") signed = -delta;

  const mover = (level.walls || []).find((w) => w.source_room_id === room.id && w.room_side === moveFace)
    || (level.walls || []).find((w) => (
      w.shared_partition
      && (w.adjacent_room_ids || []).includes(room.id)
      && w.room_side === oppositeSide(moveFace)
    ));
  if (mover) {
    return moveWallPerpendicular(level, mover.id, signed, mover);
  }

  // No dedicated mover wall (shared side): adjust room AABB directly.
  let { x, y, width, depth } = room;
  if (horizontal) {
    width = targetOutside;
    if (keepFace === "east") x = round2(inches(room.x) + inches(room.width) - width);
  } else {
    depth = targetOutside;
    if (keepFace === "south") y = round2(inches(room.y) + inches(room.depth) - depth);
  }
  const next = {
    ...level,
    rooms: (level.rooms || []).map((r) => (
      r.id === room.id
        ? { ...r, x: round2(x), y: round2(y), width: round2(width), depth: round2(depth) }
        : r
    )),
  };
  return regenerateRoomWallsPreservingShared(next, room.id);
}

/**
 * Resize a room's outside or inside clear span on one axis.
 * Used when the user taps an exterior dimension string.
 */
export function resizeRoomSpan(level, roomId, axis, newLenInches, options = {}) {
  try {
    const room = (level.rooms || []).find((r) => r.id === roomId);
    if (!room) return level;
    const keep = options.keep === "end" ? "end" : "start";
    const measure = options.measure === "inside" ? "inside" : "outside";
    const horizontal = axis === "width" || axis === "horizontal";
    const westT = thicknessForSide(level, room, "west");
    const eastT = thicknessForSide(level, room, "east");
    const northT = thicknessForSide(level, room, "north");
    const southT = thicknessForSide(level, room, "south");
    const raw = Math.max(24, inches(newLenInches));
    let targetOutside;
    if (horizontal) {
      targetOutside = measure === "inside" ? raw + westT + eastT : raw;
    } else {
      targetOutside = measure === "inside" ? raw + northT + southT : raw;
    }
    targetOutside = Math.max(36, round2(targetOutside));
    const current = horizontal ? inches(room.width) : inches(room.depth);
    if (Math.abs(targetOutside - current) < 0.05) return level;

    let { x, y, width, depth } = room;
    if (horizontal) {
      width = targetOutside;
      // keep=start → keep west; keep=end → keep east
      if (keep === "end") x = round2(inches(room.x) + inches(room.width) - width);
    } else {
      depth = targetOutside;
      if (keep === "end") y = round2(inches(room.y) + inches(room.depth) - depth);
    }
    const next = {
      ...level,
      rooms: (level.rooms || []).map((r) => (
        r.id === room.id
          ? { ...r, x: round2(x), y: round2(y), width: round2(width), depth: round2(depth) }
          : r
      )),
    };
    return regenerateRoomWallsPreservingShared(next, room.id);
  } catch (err) {
    console.error("[resizeRoomSpan] failed", { roomId, error: err?.message || err });
    return level;
  }
}

function resizeFreeWallLength(level, wall, target, keep) {
  let next = bindCoincidentWallVertices(level);
  const live = (next.walls || []).find((w) => w.id === wall.id) || wall;
  const axis = wallAxis(live);
  const delta = round2(target - axis.len);
  if (Math.abs(delta) < 0.05) return next;

  const moveVertexId = keep === "start" ? live.endVertexId : live.startVertexId;
  if (!moveVertexId) {
    // No topology — stretch the free tip.
    const sized = {
      ...live,
      ...(keep === "start"
        ? { x2: round2(axis.x1 + axis.ux * target), y2: round2(axis.y1 + axis.uy * target) }
        : { x1: round2(axis.x2 - axis.ux * target), y1: round2(axis.y2 - axis.uy * target) }),
    };
    return { ...next, walls: (next.walls || []).map((w) => (w.id === live.id ? sized : w)) };
  }

  const dx = axis.ux * delta * (keep === "start" ? 1 : -1);
  const dy = axis.uy * delta * (keep === "start" ? 1 : -1);

  const neighbors = (next.walls || []).filter((w) => (
    w.id !== live.id
    && (w.startVertexId === moveVertexId || w.endVertexId === moveVertexId)
  ));
  const perp = neighbors.find((w) => {
    const a = wallAxis(w);
    const dot = Math.abs(a.ux * axis.ux + a.uy * axis.uy);
    return dot < 0.4;
  }) || neighbors[0];

  if (perp) {
    const nAxis = wallAxis(perp);
    const moveDist = round2(dx * nAxis.nx + dy * nAxis.ny);
    if (Math.abs(moveDist) >= 0.05) {
      return moveWallPerpendicular(next, perp.id, moveDist, perp);
    }
  }

  const verts = (next.vertices || []).map((v) => (
    v.id === moveVertexId ? { ...v, x: round2(v.x + dx), y: round2(v.y + dy) } : v
  ));
  const byId = {};
  verts.forEach((v) => { byId[v.id] = v; });
  return {
    ...next,
    vertices: verts,
    walls: (next.walls || []).map((w) => syncWallFromVertices(w, byId)),
  };
}

/**
 * Straighten nearly-orthogonal walls, cluster near-equal coordinates, and close gaps.
 * Returns { level, changed } where changed is the number of walls adjusted.
 */
export function squareUpLevel(level, options = {}) {
  const angleTolDeg = Number(options.angleTolDeg) || 8;
  const alignTolIn = Number(options.alignTolIn) || 3;
  const gapTolIn = Number(options.gapTolIn) || 3;
  try {
    let next = bindCoincidentWallVertices(level);
    let changed = 0;
    const verts = [...(next.vertices || [])].map((v) => ({ ...v }));
    const byId = {};
    verts.forEach((v) => { byId[v.id] = v; });

    // 1. Force near-ortho walls onto exact H/V by snapping the moving tip to the axis.
    (next.walls || []).forEach((wall) => {
      if (!wall.startVertexId || !wall.endVertexId) return;
      if (!wallIsOrthogonal(wall, angleTolDeg)) return;
      if (wallIsOrthogonal(wall, 0.4)) return;
      const a = byId[wall.startVertexId];
      const b = byId[wall.endVertexId];
      if (!a || !b) return;
      const dx = Math.abs(b.x - a.x);
      const dy = Math.abs(b.y - a.y);
      if (dx >= dy) {
        // Prefer horizontal: equalize y to the midpoint.
        const y = round2((a.y + b.y) / 2);
        if (Math.abs(a.y - y) > 0.01 || Math.abs(b.y - y) > 0.01) {
          a.y = y;
          b.y = y;
          changed += 1;
        }
      } else {
        const x = round2((a.x + b.x) / 2);
        if (Math.abs(a.x - x) > 0.01 || Math.abs(b.x - x) > 0.01) {
          a.x = x;
          b.x = x;
          changed += 1;
        }
      }
    });

    // 2. Cluster nearly-equal X and Y coordinates across the plan.
    const clusterAxis = (key) => {
      const values = verts.map((v) => v[key]).sort((a, b) => a - b);
      const groups = [];
      values.forEach((val) => {
        const group = groups.find((g) => Math.abs(g.mean - val) <= alignTolIn);
        if (group) {
          group.values.push(val);
          group.mean = group.values.reduce((s, n) => s + n, 0) / group.values.length;
        } else {
          groups.push({ mean: val, values: [val] });
        }
      });
      const snap = {};
      groups.forEach((g) => {
        const target = round2(g.mean);
        g.values.forEach((v) => { snap[round2(v)] = target; });
      });
      verts.forEach((v) => {
        const nextVal = snap[round2(v[key])];
        if (nextVal != null && Math.abs(nextVal - v[key]) > 0.01) {
          v[key] = nextVal;
          changed += 1;
        }
      });
    };
    clusterAxis("x");
    clusterAxis("y");

    next = {
      ...next,
      vertices: verts,
      walls: (next.walls || []).map((w) => syncWallFromVertices(w, byId)),
    };
    next = mergeCoincidentVertices(next, gapTolIn);
    next = bindCoincidentWallVertices(next, gapTolIn);

    // 3. Sync axis-aligned room AABBs from their owned walls so labels match geometry.
    (next.rooms || []).forEach((room) => {
      const owned = (next.walls || []).filter((w) => w.source_room_id === room.id && w.room_side);
      if (owned.length < 2) return;
      const xs = [];
      const ys = [];
      owned.forEach((w) => {
        xs.push(inches(w.x1), inches(w.x2));
        ys.push(inches(w.y1), inches(w.y2));
        const half = inches(w.thickness) / 2;
        if (w.room_side === "west") xs.push(inches(w.x1) - half);
        if (w.room_side === "east") xs.push(inches(w.x1) + half);
        if (w.room_side === "north") ys.push(inches(w.y1) - half);
        if (w.room_side === "south") ys.push(inches(w.y1) + half);
      });
      if (!xs.length || !ys.length) return;
      const left = Math.min(...xs);
      const right = Math.max(...xs);
      const top = Math.min(...ys);
      const bottom = Math.max(...ys);
      const width = round2(right - left);
      const depth = round2(bottom - top);
      if (width < 24 || depth < 24) return;
      if (
        Math.abs(left - inches(room.x)) > 0.1
        || Math.abs(top - inches(room.y)) > 0.1
        || Math.abs(width - inches(room.width)) > 0.1
        || Math.abs(depth - inches(room.depth)) > 0.1
      ) {
        next = {
          ...next,
          rooms: (next.rooms || []).map((r) => (
            r.id === room.id
              ? { ...r, x: round2(left), y: round2(top), width, depth }
              : r
          )),
        };
        next = regenerateRoomWallsPreservingShared(next, room.id);
        changed += 1;
      }
    });

    return { level: next, changed };
  } catch (err) {
    console.error("[squareUpLevel] failed", err);
    return { level, changed: 0 };
  }
}

/**
 * Snap a dragged room-block rectangle flush to nearby room faces.
 * Returns { x, y, width, depth, snapped } in outside-bounds inches.
 */
export function magnetRoomBounds(bounds, rooms, tolIn = 4) {
  try {
    let { x, y, width, depth } = bounds;
    let snapped = false;
    const right = x + width;
    const bottom = y + depth;
    const tol = Math.max(0.5, inches(tolIn));
    (rooms || []).forEach((room) => {
      const b = roomOutsideBounds(room);
      // Flush left/right edges
      if (Math.abs(x - b.right) <= tol) { x = b.right; snapped = true; }
      if (Math.abs(x - b.left) <= tol) { x = b.left; snapped = true; }
      if (Math.abs(right - b.left) <= tol) { x = b.left - width; snapped = true; }
      if (Math.abs(right - b.right) <= tol) { x = b.right - width; snapped = true; }
      // Flush top/bottom edges
      if (Math.abs(y - b.bottom) <= tol) { y = b.bottom; snapped = true; }
      if (Math.abs(y - b.top) <= tol) { y = b.top; snapped = true; }
      if (Math.abs(bottom - b.top) <= tol) { y = b.top - depth; snapped = true; }
      if (Math.abs(bottom - b.bottom) <= tol) { y = b.bottom - depth; snapped = true; }
    });
    return { x: round2(x), y: round2(y), width: round2(width), depth: round2(depth), snapped };
  } catch (err) {
    console.error("[magnetRoomBounds] failed", err);
    return { ...bounds, snapped: false };
  }
}
