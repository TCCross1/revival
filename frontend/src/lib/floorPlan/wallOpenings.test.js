import {
  assertOpeningSpanInvariant,
  buildOpeningDimensionChain,
  openingPositionSpans,
  rehostOpening,
  setOpeningEndSpan,
  setOpeningStartSpan,
  slideOpening,
  wallInteriorClear,
} from "./wallOpenings";
import { assertLaneOrder, exteriorLaneOffsets } from "./dimensionLanes";
import { createRoomFromOutsideBounds, emptyOpening, wallsFromRoom } from "./model";
import { parseFtIn } from "./units";
import { createHistory } from "./history";

function levelWithDoor({ width = 198, depth = 138, doorOffset = 3.5 + 72, doorWidth = 32 } = {}) {
  const room = createRoomFromOutsideBounds("Room", 0, 0, width, depth);
  const walls = wallsFromRoom(room);
  const north = walls.find((w) => w.room_side === "north");
  const door = { ...emptyOpening("door"), width: doorWidth, offset: doorOffset };
  north.openings = [door];
  return {
    level: { rooms: [room], walls },
    room,
    north,
    door,
    east: walls.find((w) => w.room_side === "east"),
  };
}

describe("wall-hosted openings + spans", () => {
  test("TEST1: startSpan + door + endSpan = interior clear (15'11\")", () => {
    // 16'6" outside, 3.5" walls → clear 191" = 15'11"
    const { level, north, door } = levelWithDoor({
      width: 198,
      doorOffset: 3.5 + 72, // 6' from interior start
      doorWidth: 32,
    });
    const clear = wallInteriorClear(level, north);
    expect(clear.clearLength).toBe(191);
    expect(assertOpeningSpanInvariant(level, north, door)).toBe(true);
    const spans = openingPositionSpans(level, north, door);
    expect(spans.startSpan).toBe(72);
    expect(spans.openingWidth).toBe(32);
    expect(spans.endSpan).toBe(87); // 191 - 72 - 32
    expect(spans.startSpan + spans.openingWidth + spans.endSpan).toBe(191);
  });

  test("TEST2: set left span to 5' → right becomes 8'3\"", () => {
    const { level, north, door } = levelWithDoor({ width: 198, doorOffset: 3.5 + 72, doorWidth: 32 });
    const result = setOpeningStartSpan(level, north.id, door.id, 60); // 5'
    expect(result.ok).toBe(true);
    const wall = result.level.walls.find((w) => w.id === north.id);
    const opening = wall.openings.find((o) => o.id === door.id);
    const spans = openingPositionSpans(result.level, wall, opening);
    expect(spans.startSpan).toBe(60);
    expect(spans.openingWidth).toBe(32);
    expect(spans.endSpan).toBe(99); // 191 - 60 - 32 = 99 = 8'3"
    expect(opening.offset).toBe(63.5); // 3.5 + 60
  });

  test("TEST3: set right span to 4' → left becomes 9'3\"", () => {
    const { level, north, door } = levelWithDoor({ width: 198, doorOffset: 3.5 + 72, doorWidth: 32 });
    const result = setOpeningEndSpan(level, north.id, door.id, 48); // 4'
    expect(result.ok).toBe(true);
    const wall = result.level.walls.find((w) => w.id === north.id);
    const opening = wall.openings.find((o) => o.id === door.id);
    const spans = openingPositionSpans(result.level, wall, opening);
    expect(spans.endSpan).toBe(48);
    expect(spans.startSpan).toBe(111); // 191 - 32 - 48 = 111 = 9'3"
    expect(spans.openingWidth).toBe(32);
  });

  test("TEST4: drag right increases startSpan, decreases endSpan", () => {
    const { level, north, door } = levelWithDoor({ width: 198, doorOffset: 3.5 + 60, doorWidth: 32 });
    const before = openingPositionSpans(level, north, door);
    const moved = slideOpening(level, north.id, door.id, door.offset + 12, 1);
    const wall = moved.level.walls.find((w) => w.id === north.id);
    const opening = wall.openings.find((o) => o.id === door.id);
    const after = openingPositionSpans(moved.level, wall, opening);
    expect(after.startSpan).toBeGreaterThan(before.startSpan);
    expect(after.endSpan).toBeLessThan(before.endSpan);
    expect(after.openingWidth).toBe(32);
    expect(after.clear.clearLength).toBe(before.clear.clearLength);
  });

  test("TEST5: drag left decreases startSpan, increases endSpan", () => {
    const { level, north, door } = levelWithDoor({ width: 198, doorOffset: 3.5 + 80, doorWidth: 32 });
    const before = openingPositionSpans(level, north, door);
    const moved = slideOpening(level, north.id, door.id, door.offset - 10, 1);
    const wall = moved.level.walls.find((w) => w.id === north.id);
    const opening = wall.openings.find((o) => o.id === door.id);
    const after = openingPositionSpans(moved.level, wall, opening);
    expect(after.startSpan).toBeLessThan(before.startSpan);
    expect(after.endSpan).toBeGreaterThan(before.endSpan);
  });

  test("TEST6: rehost door from north to east wall", () => {
    const { level, north, east, door } = levelWithDoor({ width: 198, depth: 138, doorOffset: 3.5 + 72, doorWidth: 32 });
    const mid = {
      x: (east.x1 + east.x2) / 2,
      y: (east.y1 + east.y2) / 2,
    };
    const result = rehostOpening(level, north.id, door.id, east.id, mid.x, mid.y, 1);
    expect(result.ok).toBe(true);
    expect(result.wallId).toBe(east.id);
    const oldWall = result.level.walls.find((w) => w.id === north.id);
    const newWall = result.level.walls.find((w) => w.id === east.id);
    expect(oldWall.openings.find((o) => o.id === door.id)).toBeFalsy();
    const moved = newWall.openings.find((o) => o.id === door.id);
    expect(moved).toBeTruthy();
    expect(moved.width).toBe(32);
    const chainOld = buildOpeningDimensionChain(result.level, oldWall);
    const chainNew = buildOpeningDimensionChain(result.level, newWall);
    expect(chainOld.segments.some((s) => s.openingId === door.id && s.kind === "opening")).toBe(false);
    expect(chainNew.segments.some((s) => s.openingId === door.id && s.kind === "opening")).toBe(true);
  });

  test("TEST7: feature dims take nearest lane; overall pushed out", () => {
    const none = exteriorLaneOffsets({ hasFeatureChain: false });
    const withDoor = exteriorLaneOffsets({ hasFeatureChain: true });
    expect(none.mode).toBe("combined");
    expect(withDoor.mode).toBe("stacked");
    expect(withDoor.openingChain).toBeLessThan(withDoor.roomAssembly);
    expect(withDoor.roomAssembly).toBeLessThan(withDoor.overall);
    expect(withDoor.overall).toBeGreaterThan(none.roomAssembly);
    expect(assertLaneOrder(withDoor)).toBe(true);
    expect(withDoor.groups.map((g) => g.type)).toEqual([
      "opening-chain",
      "room-assembly",
      "overall",
    ]);
  });

  test("TEST8: multiple openings chain sums to clear length", () => {
    const room = createRoomFromOutsideBounds("Room", 0, 0, 198, 138);
    const walls = wallsFromRoom(room);
    const north = walls.find((w) => w.room_side === "north");
    const door = { ...emptyOpening("door"), id: "d1", width: 32, offset: 3.5 + 24 };
    const win = { ...emptyOpening("window"), id: "w1", width: 36, offset: 3.5 + 24 + 32 + 40 };
    north.openings = [door, win];
    const level = { rooms: [room], walls };
    const chain = buildOpeningDimensionChain(level, north);
    expect(chain.invariantOk).toBe(true);
    expect(chain.sum).toBe(191);
    expect(chain.segments.filter((s) => s.kind === "opening")).toHaveLength(2);
  });

  test("TEST9: zoom does not change numeric spans", () => {
    const { level, north, door } = levelWithDoor();
    const a = openingPositionSpans(level, north, door);
    // Zoom is a view transform — geometry values are view-independent.
    const b = openingPositionSpans(level, north, door);
    expect(a.startSpan).toBe(b.startSpan);
    expect(a.endSpan).toBe(b.endSpan);
    expect(a.openingWidth).toBe(b.openingWidth);
  });

  test("TEST10: editing span text drives geometry via parseFtIn", () => {
    const { level, north, door } = levelWithDoor({ doorOffset: 3.5 + 72 });
    const inchesVal = parseFtIn("5'");
    expect(inchesVal).toBe(60);
    const result = setOpeningStartSpan(level, north.id, door.id, inchesVal);
    const wall = result.level.walls.find((w) => w.id === north.id);
    const opening = wall.openings.find((o) => o.id === door.id);
    expect(opening.offset).not.toBe(door.offset);
    expect(openingPositionSpans(result.level, wall, opening).startSpan).toBe(60);
  });

  test("TEST11: undo restores previous door location", () => {
    const history = createHistory();
    const { level, north, door } = levelWithDoor({ doorOffset: 3.5 + 72 });
    history.beginGesture(level);
    const moved = slideOpening(level, north.id, door.id, 3.5 + 100, 1);
    expect(moved.ok).toBe(true);
    history.endGesture();
    const undone = history.undo(moved.level);
    const wall = undone.walls.find((w) => w.id === north.id);
    const opening = wall.openings.find((o) => o.id === door.id);
    expect(opening.offset).toBe(door.offset);
  });

  test("rejects impossible left span", () => {
    const { level, north, door } = levelWithDoor({ width: 198, doorWidth: 32 });
    const result = setOpeningStartSpan(level, north.id, door.id, 200);
    expect(result.ok).toBe(false);
  });

  test("parseFtIn accepts architectural variants", () => {
    expect(parseFtIn("5'")).toBe(60);
    expect(parseFtIn("5'3\"")).toBe(63);
    expect(parseFtIn("5' 3\"")).toBe(63);
    expect(parseFtIn("5-3")).toBe(63);
    expect(parseFtIn("63\"")).toBe(63);
    expect(parseFtIn("5' 3 1/2\"")).toBe(63.5);
    expect(parseFtIn("3½\"")).toBe(3.5);
  });

  test("complete invariant: wall + spans + door + wall = overall", () => {
    const { level, north, door, room } = levelWithDoor({ width: 198, doorOffset: 3.5 + 60, doorWidth: 32 });
    const clear = wallInteriorClear(level, north);
    const spans = openingPositionSpans(level, north, door);
    const t = 3.5;
    expect(t + spans.startSpan + spans.openingWidth + spans.endSpan + t).toBeCloseTo(room.width, 2);
    expect(clear.clearLength).toBe(room.width - 7);
  });
});
