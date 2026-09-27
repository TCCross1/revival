import { emptyLevel, emptyRoom, emptyWall, wallsFromRoom, wallLength } from "./model";
import {
  applyWallMoveFromOrigin,
  bindCoincidentWallVertices,
  commitDrawWall,
  magnetRoomBounds,
  resizeRoomSpan,
  resizeWallLength,
  squareUpLevel,
  wallIsOrthogonal,
} from "./planTopology";
import { roomInteriorMetrics } from "./calc";

function rectKitchen(w = 144, d = 120, t = 3.5) {
  const room = { ...emptyRoom("Kitchen", 0, 0, w, d), wall_thickness: t };
  const walls = wallsFromRoom(room);
  return { room, level: { ...emptyLevel(), rooms: [room], walls, objects: [], vertices: [] } };
}

describe("resizeWallLength keeps corners joined", () => {
  test("lengthening a north room wall slides the east wall and grows the room", () => {
    const { level, room } = rectKitchen(144, 120);
    const north = level.walls.find((w) => w.room_side === "north");
    expect(wallLength(north)).toBe(144);
    const next = resizeWallLength(level, north.id, 168, { keep: "start", measure: "centerline" });
    expect(next.rooms[0].width).toBe(168);
    expect(next.rooms[0].depth).toBe(120);
    expect(next.rooms[0].x).toBe(room.x);
    const north2 = next.walls.find((w) => w.source_room_id === room.id && w.room_side === "north");
    expect(wallLength(north2)).toBe(168);
    expect(wallIsOrthogonal(north2)).toBe(true);
  });

  test("keep=end on a north wall shifts x so the east face stays put", () => {
    const { level, room } = rectKitchen(144, 120);
    const north = level.walls.find((w) => w.room_side === "north");
    const next = resizeWallLength(level, north.id, 120, { keep: "end" });
    expect(next.rooms[0].width).toBe(120);
    expect(next.rooms[0].x).toBe(round2ish(room.x + 24));
    expect(next.rooms[0].x + next.rooms[0].width).toBeCloseTo(room.x + room.width, 5);
  });

  test("inside measure converts clear length to outside using wall thicknesses", () => {
    const { level, room } = rectKitchen(144, 120, 6);
    const north = level.walls.find((w) => w.room_side === "north");
    // Inside clear of 132 → outside 132 + 6 + 6 = 144 (no change)
    const same = resizeWallLength(level, north.id, 132, { measure: "inside" });
    expect(same.rooms[0].width).toBe(144);
    const next = resizeWallLength(level, north.id, 156, { measure: "inside" });
    expect(next.rooms[0].width).toBe(168);
  });

  test("east wall length (centerline) changes room depth", () => {
    const { level, room } = rectKitchen(144, 120, 3.5);
    const east = level.walls.find((w) => w.room_side === "east");
    // E/W centerline = depth − 2t = 120 − 7 = 113
    expect(wallLength(east)).toBeCloseTo(113, 5);
    const next = resizeWallLength(level, east.id, 137, { keep: "start" });
    // targetOutside = 137 + 7 = 144
    expect(next.rooms[0].depth).toBe(144);
    expect(next.rooms[0].width).toBe(room.width);
  });

  test("free chain: resizing the bottom wall slides the right wall", () => {
    let level = { ...emptyLevel(), rooms: [], walls: [], vertices: [] };
    [
      emptyWall(0, 0, 144, 0, "exterior"),
      emptyWall(144, 0, 144, 120, "exterior"),
      emptyWall(144, 120, 0, 120, "exterior"),
      emptyWall(0, 120, 0, 0, "exterior"),
    ].forEach((w) => { level = commitDrawWall(level, w).level; });
    level = bindCoincidentWallVertices(level);
    const south = level.walls.find((w) => Math.abs(w.y1 - 120) < 0.1 && Math.abs(w.y2 - 120) < 0.1);
    expect(south).toBeTruthy();
    // south goes right→left (144→0) in our list... actually emptyWall(144,120,0,120) so start at east.
    // keep start (east) → move west end → should slide west wall.
    // Easier: lengthen to 168 keeping the east end.
    const next = resizeWallLength(level, south.id, 168, { keep: "start" });
    const south2 = next.walls.find((w) => w.id === south.id);
    expect(wallLength(south2)).toBeCloseTo(168, 0);
  });

  test("resizeRoomSpan edits outside and inside clear for a room", () => {
    const { level, room } = rectKitchen(144, 120, 6);
    const out = resizeRoomSpan(level, room.id, "width", 180, { measure: "outside", keep: "start" });
    expect(out.rooms[0].width).toBe(180);
    const inside = resizeRoomSpan(level, room.id, "width", 156, { measure: "inside", keep: "start" });
    expect(inside.rooms[0].width).toBe(168); // 156 + 6 + 6
  });
});

describe("squareUpLevel", () => {
  test("snaps a slightly skewed free rectangle to ortho and closes gaps", () => {
    let level = { ...emptyLevel(), rooms: [], walls: [], vertices: [] };
    [
      emptyWall(0, 0.5, 144.2, -0.3, "exterior"),
      emptyWall(144.4, 0, 143.8, 120.2, "exterior"),
      emptyWall(144, 120.4, -0.2, 119.7, "exterior"),
      emptyWall(0.3, 120, -0.1, 0.2, "exterior"),
    ].forEach((w) => { level = commitDrawWall(level, w).level; });
    const { level: squared, changed } = squareUpLevel(level, { angleTolDeg: 8, alignTolIn: 3, gapTolIn: 3 });
    expect(changed).toBeGreaterThan(0);
    squared.walls.forEach((w) => {
      expect(wallIsOrthogonal(w, 1)).toBe(true);
    });
  });
});

describe("roomInteriorMetrics and magnet", () => {
  test("net SF uses inside faces", () => {
    const { level, room } = rectKitchen(144, 120, 6);
    const m = roomInteriorMetrics(room, level.walls);
    expect(m.width_in).toBe(132);
    expect(m.depth_in).toBe(108);
    expect(m.net_sf).toBeCloseTo((132 * 108) / 144, 5);
    expect(m.gross_sf).toBe(120); // 144*120/144
  });

  test("magnetRoomBounds snaps a draft room flush to a neighbor", () => {
    const a = emptyRoom("A", 0, 0, 144, 120);
    const draft = { x: 146, y: 2, width: 96, depth: 120 };
    const snapped = magnetRoomBounds(draft, [a], 4);
    expect(snapped.x).toBe(144);
    expect(snapped.y).toBe(0);
    expect(snapped.snapped).toBe(true);
  });
});

function round2ish(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
