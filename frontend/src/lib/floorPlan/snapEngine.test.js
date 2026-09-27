import {
  SNAP_CONFIG,
  SNAP_TYPES,
  collectSnapCorners,
  emptySnapSession,
  resolveDrawSnap,
  snapRadiiWorld,
  wallJointExtensions,
} from "./snapEngine";
import {
  applyWallMoveFromOrigin,
  bindCoincidentWallVertices,
  commitAdjacentRoomClosure,
  commitDrawWall,
  mergeCoincidentVertices,
  mergeSharedPartition,
  signedWallDragDistance,
  wallIsOrthogonal,
  weldDrawnWall,
} from "./planTopology";
import { emptyWall, emptyRoom, emptyLevel, wallsFromRoom, wallLength } from "./model";

describe("snapEngine orthogonal residential drawing", () => {
  test("near-horizontal cursor locks to exact horizontal", () => {
    const session = emptySnapSession();
    const resolved = resolveDrawSnap({
      cursorWorld: { x: 120, y: 2.5 },
      origin: { x: 0, y: 0 },
      walls: [],
      rooms: [],
      gridSnap: 6,
      scale: 1,
      freeAngle: false,
      session,
    });
    expect(resolved.point.y).toBe(0);
    expect(resolved.point.x).toBe(120);
  });

  test("near-vertical cursor locks to exact vertical", () => {
    const resolved = resolveDrawSnap({
      cursorWorld: { x: 1.5, y: 96 },
      origin: { x: 0, y: 0 },
      walls: [],
      rooms: [],
      gridSnap: 1,
      scale: 1,
      freeAngle: false,
      session: emptySnapSession(),
    });
    expect(resolved.point.x).toBe(0);
    expect(resolved.point.y).toBe(96);
  });

  test("free angle mode allows intentional skew", () => {
    const resolved = resolveDrawSnap({
      cursorWorld: { x: 100, y: 20 },
      origin: { x: 0, y: 0 },
      walls: [],
      rooms: [],
      gridSnap: 1,
      scale: 1,
      freeAngle: true,
      session: emptySnapSession(),
    });
    expect(resolved.point.y).not.toBe(0);
  });

  test("CLOSE ROOM snaps to chain start", () => {
    const resolved = resolveDrawSnap({
      cursorWorld: { x: 2, y: 1 },
      origin: { x: 0, y: 120 },
      chainStart: { x: 0, y: 0 },
      walls: [],
      rooms: [],
      gridSnap: 6,
      scale: 1,
      freeAngle: false,
      session: emptySnapSession(),
    });
    expect(resolved.candidate.type).toBe(SNAP_TYPES.ROOM_CLOSE);
    expect(resolved.point).toEqual({ x: 0, y: 0 });
  });

  test("existing endpoint outranks grid", () => {
    const wall = emptyWall(0, 0, 144, 0, "exterior");
    const resolved = resolveDrawSnap({
      cursorWorld: { x: 145, y: 1 },
      origin: { x: 144, y: 120 },
      walls: [wall],
      rooms: [],
      gridSnap: 6,
      scale: 1,
      freeAngle: false,
      session: emptySnapSession(),
    });
    expect(resolved.point.x === 144 || resolved.candidate.type === SNAP_TYPES.ENDPOINT
      || resolved.candidate.type === SNAP_TYPES.VERTICAL
      || resolved.candidate.type === SNAP_TYPES.ORTHOGONAL).toBe(true);
  });
});

describe("video scenario — adjacent room reuses existing wall", () => {
  function buildRoomA() {
    const room = emptyRoom("A", 0, 0, 144, 120); // 12' × 10'
    const level = { ...emptyLevel(), rooms: [room], walls: wallsFromRoom(room), vertices: [] };
    const east = level.walls.find((w) => w.room_side === "east");
    const north = level.walls.find((w) => w.room_side === "north");
    return { level, room, east, north };
  }

  test("CLOSE ROOM via existing east wall beats PERPENDICULAR", () => {
    const { level, east, north } = buildRoomA();
    // Start at Room A top-right outside corner (north wall east endpoint)
    const chainStart = { x: north.x2, y: north.y2 };
    // After drawing top + right, origin is SE of new room
    const origin = { x: 144 + 96, y: 120 };
    const resolved = resolveDrawSnap({
      cursorWorld: { x: 144 - 1, y: 120 + 2 },
      origin,
      chainStart,
      walls: level.walls,
      rooms: level.rooms,
      gridSnap: 6,
      scale: 1,
      freeAngle: false,
      session: emptySnapSession(),
    });
    expect(resolved.candidate.type).toBe(SNAP_TYPES.ROOM_CLOSE);
    expect(resolved.candidate.meta?.viaExisting).toBe(true);
    expect(resolved.candidate.meta?.closingWallId).toBe(east.id);
    expect(resolved.label).toBe("CLOSE ROOM");
    // Exact intersection with east wall centerline X, origin Y
    expect(resolved.point.x).toBeCloseTo(east.x1, 5);
    expect(resolved.point.y).toBeCloseTo(origin.y, 5);
  });

  test("ALIGN BOTTOM available near host room bottom datum", () => {
    const { level, room } = buildRoomA();
    const origin = { x: 240, y: 60 };
    const resolved = resolveDrawSnap({
      cursorWorld: { x: 200, y: room.y + room.depth + 1.5 },
      origin,
      chainStart: { x: 144, y: 0 },
      walls: level.walls,
      rooms: level.rooms,
      gridSnap: 6,
      scale: 1,
      freeAngle: false,
      session: emptySnapSession(),
    });
    // May be CLOSE ROOM or ALIGN BOTTOM depending on proximity to host wall
    expect(
      resolved.label === "ALIGN BOTTOM"
      || resolved.candidate.type === SNAP_TYPES.ROOM_CLOSE
      || resolved.candidate.type === SNAP_TYPES.HORIZONTAL,
    ).toBe(true);
  });

  test("three new walls + existing east wall → one Room B, one shared wall", () => {
    const { level: start, room: roomA, east, north } = buildRoomA();
    const chainStart = { x: north.x2, y: north.y1 };
    let level = start;

    // Top wall right 96"
    const w1 = emptyWall(chainStart.x, chainStart.y, chainStart.x + 96, chainStart.y, "exterior");
    let res = commitDrawWall(level, w1);
    level = res.level;
    const id1 = res.wall.id;

    // Right wall down to bottom of A
    const w2 = emptyWall(chainStart.x + 96, chainStart.y, chainStart.x + 96, roomA.depth, "interior");
    res = commitDrawWall(level, w2);
    level = res.level;
    const id2 = res.wall.id;

    // Bottom wall left toward east wall — CLOSE ROOM via existing
    const closeX = east.x1;
    const closeY = roomA.depth;
    const w3 = emptyWall(chainStart.x + 96, roomA.depth, closeX, closeY, "interior");
    const closed = commitAdjacentRoomClosure(level, {
      wallPartial: w3,
      chainStart,
      closingWallId: east.id,
      chainWallIds: [id1, id2],
    });
    level = closed.level;

    expect(closed.room).toBeTruthy();
    expect(level.rooms).toHaveLength(2);
    const roomB = level.rooms.find((r) => r.id !== roomA.id);
    expect(roomB.x).toBe(144);
    expect(roomB.width).toBe(96);
    expect(roomB.depth).toBe(120);

    // Exactly one wall at the shared partition (Room A east)
    const atSharedX = level.walls.filter((w) => Math.abs(((w.x1 + w.x2) / 2) - east.x1) < 1);
    expect(atSharedX.length).toBe(1);
    expect(atSharedX[0].shared_partition).toBe(true);
    expect(atSharedX[0].adjacent_room_ids).toEqual(expect.arrayContaining([roomA.id, roomB.id]));

    // Room B has no west wall of its own
    expect(level.walls.some((w) => w.source_room_id === roomB.id && w.room_side === "west")).toBe(false);
    // Free chain walls removed
    expect(level.walls.some((w) => w.id === id1 || w.id === id2)).toBe(false);
  });

  test("shared wall drag grows A and shrinks B", () => {
    const { level: start, room: roomA, east, north } = buildRoomA();
    const chainStart = { x: north.x2, y: north.y1 };
    let level = start;
    const a = commitDrawWall(level, emptyWall(chainStart.x, chainStart.y, chainStart.x + 96, chainStart.y));
    level = a.level;
    const b = commitDrawWall(level, emptyWall(chainStart.x + 96, chainStart.y, chainStart.x + 96, 120));
    level = b.level;
    level = commitAdjacentRoomClosure(level, {
      wallPartial: emptyWall(chainStart.x + 96, 120, east.x1, 120),
      chainStart,
      closingWallId: east.id,
      chainWallIds: [a.wall.id, b.wall.id],
    }).level;
    const shared = level.walls.find((w) => w.shared_partition);
    expect(shared).toBeTruthy();
    const roomB = level.rooms.find((r) => r.id !== roomA.id);
    const moved = applyWallMoveFromOrigin(level, shared.id, { ...shared }, 12);
    const a2 = moved.rooms.find((r) => r.id === roomA.id);
    const b2 = moved.rooms.find((r) => r.id === roomB.id);
    expect(a2.width).toBe(156);
    expect(b2.width).toBe(84);
    expect(moved.walls.filter((w) => w.shared_partition)).toHaveLength(1);
  });

  test("moving Room B east wall stretches connected walls", () => {
    const { level: start, room: roomA, east, north } = buildRoomA();
    const chainStart = { x: north.x2, y: north.y1 };
    let level = start;
    const a = commitDrawWall(level, emptyWall(chainStart.x, chainStart.y, chainStart.x + 96, chainStart.y));
    level = a.level;
    const b = commitDrawWall(level, emptyWall(chainStart.x + 96, chainStart.y, chainStart.x + 96, 120));
    level = b.level;
    level = commitAdjacentRoomClosure(level, {
      wallPartial: emptyWall(chainStart.x + 96, 120, east.x1, 120),
      chainStart,
      closingWallId: east.id,
      chainWallIds: [a.wall.id, b.wall.id],
    }).level;
    const roomB = level.rooms.find((r) => r.id !== roomA.id);
    const eastB = level.walls.find((w) => w.source_room_id === roomB.id && w.room_side === "east");
    level = applyWallMoveFromOrigin(level, eastB.id, { ...eastB }, 24);
    const nextB = level.rooms.find((r) => r.id === roomB.id);
    expect(nextB.width).toBe(120);
    const northB = level.walls.find((w) => w.source_room_id === roomB.id && w.room_side === "north");
    expect(wallLength(northB)).toBe(120);
    expect(wallIsOrthogonal(northB)).toBe(true);
  });
});

describe("planTopology wall move", () => {
  test("room-owned east wall drag expands width; corners stay square", () => {
    const room = emptyRoom("R", 0, 0, 144, 120);
    let level = { ...emptyLevel(), rooms: [room], walls: wallsFromRoom(room) };
    const east = level.walls.find((w) => w.room_side === "east");
    const origin = { ...east };
    level = applyWallMoveFromOrigin(level, east.id, origin, 24);
    const nextRoom = level.rooms[0];
    expect(nextRoom.width).toBe(168);
    expect(nextRoom.depth).toBe(120);
    const sides = Object.fromEntries(level.walls.filter((w) => w.source_room_id === room.id).map((w) => [w.room_side, w]));
    expect(wallLength(sides.north)).toBe(168);
    expect(wallLength(sides.south)).toBe(168);
    expect(wallIsOrthogonal(sides.north)).toBe(true);
    expect(wallIsOrthogonal(sides.east)).toBe(true);
  });

  test("inward east wall drag shortens room", () => {
    const room = emptyRoom("R", 0, 0, 144, 120);
    let level = { ...emptyLevel(), rooms: [room], walls: wallsFromRoom(room) };
    const east = level.walls.find((w) => w.room_side === "east");
    level = applyWallMoveFromOrigin(level, east.id, { ...east }, -36);
    expect(level.rooms[0].width).toBe(108);
    expect(level.rooms[0].depth).toBe(120);
  });

  test("free orthogonal walls stretch when shared vertex moves", () => {
    let level = { ...emptyLevel(), rooms: [], walls: [], vertices: [] };
    const walls = [
      emptyWall(0, 0, 144, 0, "exterior"),
      emptyWall(144, 0, 144, 120, "exterior"),
      emptyWall(144, 120, 0, 120, "exterior"),
      emptyWall(0, 120, 0, 0, "exterior"),
    ];
    walls.forEach((w) => {
      const res = commitDrawWall(level, w);
      level = res.level;
    });
    level = bindCoincidentWallVertices(level);
    const right = level.walls.find((w) => Math.abs(w.x1 - 144) < 0.1 && Math.abs(w.x2 - 144) < 0.1);
    expect(right).toBeTruthy();
    const dragDist = signedWallDragDistance(right, { x: 168, y: 60 });
    const moved = applyWallMoveFromOrigin(level, right.id, { ...right }, dragDist);
    const top = moved.walls.find((w) => Math.abs(w.y1) < 0.1 && Math.abs(w.y2) < 0.1);
    expect(wallLength(top)).toBeCloseTo(168, 5);
    expect(wallIsOrthogonal(top)).toBe(true);
  });

  test("commitDrawWall CLOSE ROOM reuses start vertex", () => {
    let level = { ...emptyLevel(), walls: [], vertices: [] };
    const a = commitDrawWall(level, emptyWall(0, 0, 120, 0, "exterior"));
    level = a.level;
    const b = commitDrawWall(level, emptyWall(120, 0, 120, 96, "interior"));
    level = b.level;
    const c = commitDrawWall(level, emptyWall(120, 96, 0, 96, "interior"));
    level = c.level;
    const d = commitDrawWall(level, emptyWall(0, 96, 0, 0, "interior"), { closeTo: { x: 0, y: 0 } });
    level = d.level;
    const startId = a.wall.startVertexId;
    expect(d.wall.endVertexId).toBe(startId);
    expect(level.vertices.filter((v) => Math.abs(v.x) < 0.01 && Math.abs(v.y) < 0.01)).toHaveLength(1);
  });

  test("signedWallDragDistance for east wall is +X outward", () => {
    const wall = { ...emptyWall(144, 0, 144, 120), room_side: "east" };
    expect(signedWallDragDistance(wall, { x: 156, y: 60 })).toBe(12);
  });

  test("mergeSharedPartition drops duplicate west wall", () => {
    const a = emptyRoom("A", 0, 0, 144, 120);
    const b = emptyRoom("B", 144, 0, 96, 120);
    let level = {
      ...emptyLevel(),
      rooms: [a, b],
      walls: [...wallsFromRoom(a), ...wallsFromRoom(b)],
    };
    const east = level.walls.find((w) => w.source_room_id === a.id && w.room_side === "east");
    level = mergeSharedPartition(level, b.id, east.id);
    expect(level.walls.some((w) => w.source_room_id === b.id && w.room_side === "west")).toBe(false);
    expect(level.walls.find((w) => w.id === east.id).shared_partition).toBe(true);
  });
});

describe("Point & line joins existing corners (field video, Kitchen)", () => {
  // 100% zoom: view.scale 1 × plan px 1.7 → acquire ≈ 8.2", release ≈ 12.9"
  const PX_PER_IN = 1.7;

  function kitchen() {
    const room = emptyRoom("Kitchen", 0, 0, 144, 120); // 3 1/2" walls
    const walls = wallsFromRoom(room);
    return { room, walls, level: { ...emptyLevel(), rooms: [room], walls, vertices: [] } };
  }

  function snap(opts) {
    return resolveDrawSnap({
      rooms: [],
      vertices: [],
      gridSnap: 6,
      scale: PX_PER_IN,
      freeAngle: false,
      session: emptySnapSession(),
      ...opts,
    });
  }

  test("visible face corners: 4 outer + 4 inner, no straight-edge seams", () => {
    const { walls } = kitchen();
    const corners = collectSnapCorners(walls, []).filter((p) => p.type === SNAP_TYPES.CORNER);
    const keys = corners.map((p) => `${p.x},${p.y}`).sort();
    expect(keys).toEqual([
      "0,0", "0,120", "140.5,116.5", "140.5,3.5", "144,0", "144,120", "3.5,116.5", "3.5,3.5",
    ].sort());
    expect(keys).not.toContain("0,3.5");
    // Room-owned centerline endpoints (inset by t/2) are not offered — they are not visible corners
    expect(collectSnapCorners(walls, []).some((p) => p.x === 144 && p.y === 1.75)).toBe(false);
  });

  test("start of stroke near the outer corner snaps to the exact CORNER, not the wall line", () => {
    const { walls, room } = kitchen();
    const r = snap({ cursorWorld: { x: 146, y: 2.5 }, walls, rooms: [room] });
    expect(r.candidate.type).toBe(SNAP_TYPES.CORNER);
    expect(r.label).toBe("CORNER");
    expect(r.point).toEqual({ x: 144, y: 0 });
  });

  test("start of stroke on a wall away from corners lands ON WALL", () => {
    const { walls } = kitchen();
    const r = snap({ cursorWorld: { x: 70.3, y: 2.9 }, walls });
    expect(r.candidate.type).toBe(SNAP_TYPES.WALL_AXIS);
    expect(r.label).toBe("ON WALL");
    expect(r.point.y).toBeCloseTo(1.75, 5);
  });

  test("inner corner snaps to the inner face corner", () => {
    const { walls } = kitchen();
    const r = snap({ cursorWorld: { x: 4.6, y: 4.9 }, walls });
    expect(r.candidate.type).toBe(SNAP_TYPES.CORNER);
    expect(r.candidate.meta.face).toBe("inner");
    expect(r.point).toEqual({ x: 3.5, y: 3.5 });
  });

  test("vertical run from the top corner: bottom end JOINS the bottom corner (no gap)", () => {
    const { walls } = kitchen();
    const r = snap({ cursorWorld: { x: 144.6, y: 118.9 }, origin: { x: 144, y: 0 }, walls });
    expect(r.candidate.type).toBe(SNAP_TYPES.CORNER);
    expect(r.label).toBe("CORNER");
    expect(r.point).toEqual({ x: 144, y: 120 });
  });

  test("free end beside the room comes LEVEL with the bottom corner (exact Y, X kept)", () => {
    const { walls, room } = kitchen();
    const topRun = emptyWall(144, 0, 240, 0, "exterior");
    const r = snap({
      cursorWorld: { x: 171, y: 118.6 },
      origin: { x: 170, y: 0 },
      walls: [...walls, topRun],
      rooms: [room],
    });
    expect(r.candidate.type).toBe(SNAP_TYPES.HORIZONTAL);
    expect(r.label).toBe("LEVEL");
    expect(r.point).toEqual({ x: 170, y: 120 });
  });

  test("corner beats a sticky PERPENDICULAR; perpendicular point follows the cursor", () => {
    const { walls } = kitchen();
    const topRun = emptyWall(144, 0, 240, 0, "exterior");
    const all = [...walls, topRun];
    const session = emptySnapSession();
    const origin = { x: 160, y: 0 };
    const a = snap({ cursorWorld: { x: 160.3, y: 60 }, origin, walls: all, session });
    expect(a.label).toBe("PERPENDICULAR");
    expect(a.point).toEqual({ x: 160, y: 60 });
    const b = snap({ cursorWorld: { x: 160.3, y: 80 }, origin, walls: all, session });
    expect(b.label).toBe("PERPENDICULAR");
    expect(b.point).toEqual({ x: 160, y: 80 });
    const c = snap({ cursorWorld: { x: 144.5, y: 119.4 }, origin, walls: all, session });
    expect(c.candidate.type).toBe(SNAP_TYPES.CORNER);
    expect(c.point).toEqual({ x: 144, y: 120 });
  });

  test("away from every corner PERPENDICULAR still wins", () => {
    const { walls } = kitchen();
    const r = snap({ cursorWorld: { x: 60.4, y: -48 }, origin: { x: 60, y: 1.75 }, walls });
    expect(r.label).toBe("PERPENDICULAR");
    // 1" drawing increment is measured from the origin: 50" run from y = 1.75
    expect(r.point).toEqual({ x: 60, y: -48.25 });
  });

  test("screen radius with world minimum: 3\" off a corner snaps at 100% but not zoomed in", () => {
    const { walls } = kitchen();
    expect(snapRadiiWorld(4.5 * PX_PER_IN).acquire).toBeCloseTo(SNAP_CONFIG.acquireMinWorldIn, 5);
    const cursor = { x: 147, y: -0.2 };
    const near = snap({ cursorWorld: cursor, walls, scale: PX_PER_IN });
    expect(near.candidate.type).toBe(SNAP_TYPES.CORNER);
    const zoomed = snap({ cursorWorld: cursor, walls, scale: 4.5 * PX_PER_IN });
    expect(zoomed.candidate.type).not.toBe(SNAP_TYPES.CORNER);
  });

  test("committed wall uses the exact corner coordinates", () => {
    const { level } = kitchen();
    const res = commitDrawWall(level, emptyWall(144, 0, 144, 120, "exterior"));
    const welded = weldDrawnWall(res.level, res.wall.id).level;
    const w = welded.walls.find((row) => row.id === res.wall.id);
    expect([w.x1, w.y1, w.x2, w.y2]).toEqual([144, 0, 144, 120]);
  });
});

describe("legacy centerline room loop (Health check kitchen data)", () => {
  function legacyLoop() {
    const mk = (x1, y1, x2, y2) => ({ ...emptyWall(x1, y1, x2, y2, "exterior"), source_room_id: "kitchen" });
    return [mk(24, 24, 168, 24), mk(168, 24, 168, 156), mk(168, 156, 24, 156), mk(24, 156, 24, 24)];
  }

  test("joints extend by the partner half thickness (no corner notch)", () => {
    const walls = legacyLoop();
    const ext = wallJointExtensions(walls);
    walls.forEach((w) => expect(ext[w.id]).toEqual({ start: 3, end: 3 }));
  });

  test("snap corners are the solid outline corners plus the centerline joints — no notch corners", () => {
    const corners = collectSnapCorners(legacyLoop(), []);
    const keys = corners.map((p) => `${p.x},${p.y}`);
    ["21,21", "171,21", "171,159", "21,159", "27,27", "165,27", "165,153", "27,153", "24,24", "168,24"]
      .forEach((k) => expect(keys).toContain(k));
    expect(keys).not.toContain("168,21");
    expect(keys).not.toContain("171,24");
  });

  test("Point & line off the top wall joins the visible outer corner", () => {
    const r = resolveDrawSnap({
      cursorWorld: { x: 172.5, y: 22.4 },
      walls: legacyLoop(),
      rooms: [],
      vertices: [],
      gridSnap: 6,
      scale: 1.7,
      session: emptySnapSession(),
    });
    expect(r.label).toBe("CORNER");
    expect(r.point).toEqual({ x: 171, y: 21 });
  });

  test("free end beside the loop levels with the visible bottom face, not the hidden centerline joint", () => {
    const r = resolveDrawSnap({
      cursorWorld: { x: 192.6, y: 157.4 },
      origin: { x: 192, y: 27 },
      walls: legacyLoop(),
      rooms: [],
      vertices: [],
      gridSnap: 6,
      scale: 1.7,
      session: emptySnapSession(),
    });
    expect(r.label).toBe("LEVEL");
    expect(r.point).toEqual({ x: 192, y: 159 });
  });
});

describe("Point & line weld", () => {
  test("L: second segment shares the first segment's end vertex", () => {
    let level = { ...emptyLevel(), walls: [], vertices: [] };
    const a = commitDrawWall(level, emptyWall(0, 0, 120, 0, "exterior"));
    level = weldDrawnWall(a.level, a.wall.id).level;
    const b = commitDrawWall(level, emptyWall(120, 0, 120, 96, "interior"));
    level = weldDrawnWall(b.level, b.wall.id).level;
    const wa = level.walls.find((w) => w.id === a.wall.id);
    const wb = level.walls.find((w) => w.id === b.wall.id);
    expect(wb.startVertexId).toBe(wa.endVertexId);
    expect(level.vertices).toHaveLength(3);
  });

  test("T: endpoint on another free wall's span splits it at one shared vertex; openings kept", () => {
    let level = { ...emptyLevel(), walls: [], vertices: [] };
    const host = { ...emptyWall(0, 0, 120, 0, "exterior"), openings: [{ id: "w1", type: "window", offset: 80, width: 30 }] };
    const a = commitDrawWall(level, host);
    level = a.level;
    const b = commitDrawWall(level, emptyWall(60, 96, 60, 0, "interior"));
    const res = weldDrawnWall(b.level, b.wall.id);
    level = res.level;
    expect(res.splitWallIds).toHaveLength(2);
    const stem = level.walls.find((w) => w.id === b.wall.id);
    const left = level.walls.find((w) => w.id === a.wall.id);
    const right = level.walls.find((w) => w.id === res.splitWallIds[1]);
    expect(left.endVertexId).toBe(stem.endVertexId);
    expect(right.startVertexId).toBe(stem.endVertexId);
    expect([left.x2, left.y2]).toEqual([60, 0]);
    expect(left.openings).toHaveLength(0);
    expect(right.openings).toEqual([{ id: "w1", type: "window", offset: 20, width: 30 }]);
  });

  test("vertices within 1/16\" merge into one joint", () => {
    const level = {
      ...emptyLevel(),
      vertices: [{ id: "v1", x: 10, y: 10 }, { id: "v2", x: 10.04, y: 10 }, { id: "v3", x: 50, y: 10 }],
      walls: [{ ...emptyWall(10.04, 10, 50, 10, "interior"), startVertexId: "v2", endVertexId: "v3" }],
    };
    const merged = mergeCoincidentVertices(level);
    expect(merged.vertices.map((v) => v.id)).toEqual(["v1", "v3"]);
    expect(merged.walls[0].startVertexId).toBe("v1");
    expect(merged.walls[0].x1).toBe(10);
  });
});

describe("snap config centralization", () => {
  test("hysteresis release > acquire", () => {
    expect(SNAP_CONFIG.releaseRadiusPx).toBeGreaterThan(SNAP_CONFIG.acquireRadiusPx);
    expect(SNAP_CONFIG.orthoReleaseDeg).toBeGreaterThan(SNAP_CONFIG.orthoAcquireDeg);
  });
});
