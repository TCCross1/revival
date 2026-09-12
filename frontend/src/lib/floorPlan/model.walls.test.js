import { emptyLevel, emptyRoom, moveRoom, regenerateRoomWalls, resizeRoom, roomWallPolygons, setRoomWallThickness, wallLength, wallsFromRoom } from "./model";
import { STUD_THICKNESS } from "./units";

function bySide(walls) {
  return Object.fromEntries(walls.map((wall) => [wall.room_side, wall]));
}

function polygonsTouch(a, b, axis) {
  // Zero geometric gap: shared edge between N and E at the NE interior corner.
  if (axis === "ne") {
    return Math.abs(a.x2 - b.x2) < 1e-6 && Math.abs(a.y2 - b.y1) < 1e-6;
  }
  if (axis === "nw") {
    return Math.abs(a.x1 - b.x1) < 1e-6 && Math.abs(a.y2 - b.y1) < 1e-6;
  }
  if (axis === "se") {
    return Math.abs(a.x2 - b.x2) < 1e-6 && Math.abs(a.y1 - b.y2) < 1e-6;
  }
  if (axis === "sw") {
    return Math.abs(a.x1 - b.x1) < 1e-6 && Math.abs(a.y1 - b.y2) < 1e-6;
  }
  return false;
}

test("12' × 11' room with 3.5\" studs — vertical walls are 10' 5\"", () => {
  const room = emptyRoom("Demo", 0, 0, 144, 132); // 12' × 11'
  expect(room.wall_thickness).toBe(STUD_THICKNESS);
  expect(STUD_THICKNESS).toBe(3.5);

  const walls = wallsFromRoom(room);
  const sides = bySide(walls);
  expect(wallLength(sides.north)).toBe(144);
  expect(wallLength(sides.south)).toBe(144);
  expect(wallLength(sides.east)).toBe(132 - 7); // 10' 5"
  expect(wallLength(sides.west)).toBe(125);
  expect(sides.east.thickness).toBe(3.5);

  // Outside-to-outside centerlines (inset by t/2).
  expect(sides.north.y1).toBeCloseTo(1.75, 5);
  expect(sides.north.x1).toBe(0);
  expect(sides.north.x2).toBe(144);
  expect(sides.east.x1).toBeCloseTo(144 - 1.75, 5);
  expect(sides.east.y1).toBeCloseTo(3.5, 5);
  expect(sides.east.y2).toBeCloseTo(132 - 3.5, 5);
});

test("butt-joint polygons have zero corner gaps", () => {
  const room = emptyRoom("Box", 10, 20, 144, 132);
  const poly = roomWallPolygons(room);
  expect(poly.thickness).toBe(3.5);
  expect(poly.north.x2 - poly.north.x1).toBe(144);
  expect(poly.east.y2 - poly.east.y1).toBe(125);
  expect(polygonsTouch(poly.north, poly.east, "ne")).toBe(true);
  expect(polygonsTouch(poly.north, poly.west, "nw")).toBe(true);
  expect(polygonsTouch(poly.south, poly.east, "se")).toBe(true);
  expect(polygonsTouch(poly.south, poly.west, "sw")).toBe(true);
});

test("resizing the room regenerates correct joints", () => {
  const room = emptyRoom("Resize", 0, 0, 120, 96);
  let level = { ...emptyLevel(), rooms: [room], walls: wallsFromRoom(room), roofs: [{ id: "r1", x: 0, y: 0, width: 120, depth: 96 }] };
  level = resizeRoom(level, room.id, 144, 132);
  const sides = bySide(level.walls.filter((w) => w.source_room_id === room.id));
  expect(wallLength(sides.north)).toBe(144);
  expect(wallLength(sides.east)).toBe(125);
  expect(level.rooms[0].width).toBe(144);
  expect(level.rooms[0].depth).toBe(132);
});

test("changing wall thickness recalculates joints", () => {
  const room = emptyRoom("Thick", 0, 0, 144, 132);
  let level = { ...emptyLevel(), rooms: [room], walls: wallsFromRoom(room), roofs: [{ id: "r1", x: 0, y: 0, width: 144, depth: 132 }] };
  level = setRoomWallThickness(level, room.id, 5.5);
  const sides = bySide(level.walls.filter((w) => w.source_room_id === room.id));
  expect(sides.north.thickness).toBe(5.5);
  expect(wallLength(sides.east)).toBeCloseTo(132 - 11, 5);
  expect(sides.east.y1).toBeCloseTo(5.5, 5);
  expect(level.rooms[0].wall_thickness).toBe(5.5);
});

test("dragging the room preserves wall connections", () => {
  const room = emptyRoom("Move", 12, 24, 144, 132);
  let level = { ...emptyLevel(), rooms: [room], walls: wallsFromRoom(room), roofs: [{ id: "r1", x: 12, y: 24, width: 144, depth: 132 }] };
  level = moveRoom(level, room.id, 40, 60);
  const sides = bySide(level.walls.filter((w) => w.source_room_id === room.id));
  expect(sides.north.x1).toBeCloseTo(40, 5);
  expect(sides.north.y1).toBeCloseTo(60 + 1.75, 5);
  expect(wallLength(sides.east)).toBe(125);
  expect(sides.east.x1).toBeCloseTo(40 + 144 - 1.75, 5);
});

test("editing one dimension regenerates all four walls", () => {
  const room = emptyRoom("Edit", 0, 0, 120, 120);
  let level = { ...emptyLevel(), rooms: [room], walls: wallsFromRoom(room), roofs: [{ id: "r1", x: 0, y: 0, width: 120, depth: 120 }] };
  level = regenerateRoomWalls({
    ...level,
    rooms: level.rooms.map((r) => ({ ...r, width: 144 })),
  }, room.id);
  const owned = level.walls.filter((w) => w.source_room_id === room.id);
  expect(owned).toHaveLength(4);
  expect(wallLength(bySide(owned).north)).toBe(144);
  expect(wallLength(bySide(owned).west)).toBe(120 - 7);
});

test("centerline rendering maps onto outside polygons (zoom-invariant geometry)", () => {
  const room = emptyRoom("Render", 0, 0, 144, 132);
  const walls = bySide(wallsFromRoom(room));
  const poly = roomWallPolygons(room);
  const t = 3.5;
  // North strip from centerline ± t/2
  expect(walls.north.y1 - t / 2).toBeCloseTo(poly.north.y1, 5);
  expect(walls.north.y1 + t / 2).toBeCloseTo(poly.north.y2, 5);
  expect(walls.east.x1 - t / 2).toBeCloseTo(poly.east.x1, 5);
  expect(walls.east.x1 + t / 2).toBeCloseTo(poly.east.x2, 5);
});
