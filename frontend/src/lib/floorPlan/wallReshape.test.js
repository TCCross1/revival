import {
  addTwoCornersOnWall,
  ensureRoomPolygonal,
  isReshapeSpanPending,
  movePlanVertex,
  offsetWallSection,
  openingConflictAt,
  polygonAreaFromWalls,
  roomOutwardNormal,
} from "./wallReshape";
import { emptyLevel, emptyOpening, emptyRoom, wallsFromRoom, wallLength } from "./model";

function sqRoom() {
  const room = emptyRoom("R", 0, 0, 144, 144); // 12×12
  return {
    room,
    level: { ...emptyLevel(), rooms: [room], walls: wallsFromRoom(room), vertices: [] },
  };
}

describe("wallReshape — add corners + bump-out", () => {
  test("ensureRoomPolygonal converts AABB room walls to vertex-linked", () => {
    const { room, level } = sqRoom();
    const next = ensureRoomPolygonal(level, room.id);
    const r = next.rooms[0];
    expect(r.geometry).toBe("polygon");
    expect((next.vertices || []).length).toBeGreaterThanOrEqual(4);
    expect(next.walls.every((w) => w.source_room_id !== room.id || w.startVertexId)).toBe(true);
  });

  test("openingConflictAt detects corner through door", () => {
    const wall = {
      x1: 0, y1: 0, x2: 144, y2: 0,
      openings: [{ ...emptyOpening("door"), offset: 40, width: 32 }],
    };
    expect(openingConflictAt(wall, 50).length).toBeGreaterThan(0);
    expect(openingConflictAt(wall, 10).length).toBe(0);
  });

  test("add two corners + outward offset creates bump and increases area", () => {
    const { room, level: start } = sqRoom();
    // North wall (top): y = t/2 ≈ 1.75, from x=0 to 144
    const north = start.walls.find((w) => w.room_side === "north");
    expect(north).toBeTruthy();

    const withCorners = addTwoCornersOnWall(start, north.id, { x: 36, y: north.y1 }, { x: 108, y: north.y1 });
    expect(withCorners.error).toBeFalsy();
    expect(withCorners.midWallId).toBeTruthy();
    let level = withCorners.level;
    expect(isReshapeSpanPending(level, withCorners.midWallId)).toBe(true);

    const mid = level.walls.find((w) => w.id === withCorners.midWallId);
    const beforeArea = polygonAreaFromWalls(level.walls.filter((w) => w.source_room_id === room.id));
    const outward = roomOutwardNormal(level, mid);
    // North wall outward is −Y (up). Right-hand normal of L→R north wall is also −Y.
    level = offsetWallSection(level, mid.id, 24, { outwardNormal: outward });
    expect(isReshapeSpanPending(level, mid.id)).toBe(false);

    const face = level.walls.find((w) => w.id === mid.id);
    expect(face.is_bump_face).toBe(true);
    expect(wallLength(face)).toBeCloseTo(72, 0); // 108-36

    const connectors = level.walls.filter((w) => w.is_bump_connector);
    expect(connectors.length).toBe(2);
    connectors.forEach((c) => expect(wallLength(c)).toBeCloseTo(24, 5));

    const afterArea = polygonAreaFromWalls(level.walls.filter((w) => w.source_room_id === room.id));
    // 6' × 2' = 12 sq ft = 1728 sq in — allow centerline vs outside discrepancy
    expect(afterArea - beforeArea).toBeGreaterThan(1000);
  });

  test("inward offset creates notch connectors of correct depth", () => {
    const { level: start } = sqRoom();
    const north = start.walls.find((w) => w.room_side === "north");
    const withCorners = addTwoCornersOnWall(start, north.id, { x: 36, y: north.y1 }, { x: 108, y: north.y1 });
    let level = withCorners.level;
    const mid = level.walls.find((w) => w.id === withCorners.midWallId);
    const outward = roomOutwardNormal(level, mid);
    const yBefore = mid.y1;
    level = offsetWallSection(level, mid.id, -24, { outwardNormal: outward });
    const face = level.walls.find((w) => w.id === mid.id);
    expect(face.is_bump_face).toBe(true);
    // Inward = opposite of outward (−Y for north) → face moves +Y into room
    expect(face.y1).toBeGreaterThan(yBefore + 10);
    const connectors = level.walls.filter((w) => w.is_bump_connector);
    expect(connectors).toHaveLength(2);
    connectors.forEach((c) => expect(wallLength(c)).toBeCloseTo(24, 5));
  });

  test("door on mid section moves with bump face", () => {
    const { level: start } = sqRoom();
    const north = start.walls.find((w) => w.room_side === "north");
    // Place door in middle third
    const withDoor = {
      ...start,
      walls: start.walls.map((w) => (
        w.id === north.id
          ? { ...w, openings: [{ ...emptyOpening("door"), id: "door1", offset: 56, width: 32, height: 80 }] }
          : w
      )),
    };
    const withCorners = addTwoCornersOnWall(withDoor, north.id, { x: 36, y: north.y1 }, { x: 108, y: north.y1 });
    let level = withCorners.level;
    const mid = level.walls.find((w) => w.id === withCorners.midWallId);
    expect((mid.openings || []).some((o) => o.id === "door1")).toBe(true);
    level = offsetWallSection(level, mid.id, 24, { outwardNormal: roomOutwardNormal(level, mid) });
    const face = level.walls.find((w) => w.id === mid.id);
    expect((face.openings || []).some((o) => o.id === "door1")).toBe(true);
    // Door should not remain on a stub segment
    const stubs = level.walls.filter((w) => w.id !== face.id && (w.parent_wall_id === north.id || w.lineage_root === north.id));
    stubs.forEach((s) => {
      expect((s.openings || []).some((o) => o.id === "door1")).toBe(false);
    });
  });

  test("reject corner through opening", () => {
    const { level: start } = sqRoom();
    const north = start.walls.find((w) => w.room_side === "north");
    const withDoor = {
      ...start,
      walls: start.walls.map((w) => (
        w.id === north.id
          ? { ...w, openings: [{ ...emptyOpening("door"), offset: 40, width: 36 }] }
          : w
      )),
    };
    const res = addTwoCornersOnWall(withDoor, north.id, { x: 50, y: north.y1 }, { x: 108, y: north.y1 });
    expect(res.error).toMatch(/CORNER CONFLICT|opening/i);
  });

  test("movePlanVertex updates connected walls", () => {
    const { room, level: start } = sqRoom();
    let level = ensureRoomPolygonal(start, room.id);
    const north = level.walls.find((w) => Math.abs(w.y1 - w.y2) < 0.5 && w.x1 < w.x2);
    const cornerId = north.endVertexId;
    const beforeLen = wallLength(north);
    level = movePlanVertex(level, cornerId, north.x2 + 24, north.y2 - 12);
    const nextNorth = level.walls.find((w) => w.id === north.id);
    expect(wallLength(nextNorth)).not.toBe(beforeLen);
    expect(nextNorth.x2).toBeCloseTo(north.x2 + 24, 5);
  });
});
