import {
  OPENING_CATEGORY,
  WINDOW_GENERIC_RO,
  EXTERIOR_DOOR_RO,
  INTERIOR_HINGED_RO,
  classifyOpening,
  computeAutoRoughOpening,
  interiorDoorSpecToOpeningPatch,
  normalizeInteriorDoorSpec,
  normalizeWindowSpec,
  windowSpecToOpeningPatch,
} from "./openingSpec";
import { applyDoorOpeningPatch, assertOpeningSpanInvariant, openingPositionSpans } from "./wallOpenings";
import { applyInteriorDoorDefaults, createRoomFromOutsideBounds, emptyOpening, wallsFromRoom } from "./model";
import { formatFtInTight } from "./units";

describe("openingSpec classification + RO profiles", () => {
  test("classify exterior / interior / window", () => {
    expect(classifyOpening({ type: "window" })).toBe(OPENING_CATEGORY.WINDOW);
    expect(classifyOpening({ type: "door", exterior: true })).toBe(OPENING_CATEGORY.EXTERIOR_DOOR);
    expect(classifyOpening({ type: "door", exterior: false })).toBe(OPENING_CATEGORY.INTERIOR_DOOR);
    expect(classifyOpening({ type: "door" }, { kind: "interior" })).toBe(OPENING_CATEGORY.INTERIOR_DOOR);
    expect(classifyOpening({ type: "door" }, { kind: "exterior" })).toBe(OPENING_CATEGORY.EXTERIOR_DOOR);
    expect(classifyOpening({ type: "door", opening_category: "interior-door" }, { kind: "exterior" }))
      .toBe(OPENING_CATEGORY.INTERIOR_DOOR);
  });

  test("exterior RO stays +1.5 / +2", () => {
    const ro = computeAutoRoughOpening(32, 80, OPENING_CATEGORY.EXTERIOR_DOOR);
    expect(ro.width).toBe(33.5);
    expect(ro.height).toBe(82);
    expect(ro.profile).toEqual(EXTERIOR_DOOR_RO);
    expect(formatFtInTight(33.5)).toBe("2'9½\"");
  });

  test("interior hinged RO is not exterior formula", () => {
    const ro = computeAutoRoughOpening(30, 80, OPENING_CATEGORY.INTERIOR_DOOR, { operation_type: "hinged" });
    expect(ro.width).toBe(32);
    expect(ro.height).toBe(82.5);
    expect(ro.profile).toEqual(INTERIOR_HINGED_RO);
    expect(ro.width - 30).not.toBe(EXTERIOR_DOOR_RO.widthAdd);
  });

  test("pocket / bifold / barn use distinct RO profiles", () => {
    expect(computeAutoRoughOpening(30, 80, OPENING_CATEGORY.INTERIOR_DOOR, { operation_type: "pocket" }).width).toBe(31);
    expect(computeAutoRoughOpening(30, 80, OPENING_CATEGORY.INTERIOR_DOOR, { operation_type: "bifold" }).width).toBe(31.5);
    expect(computeAutoRoughOpening(30, 80, OPENING_CATEGORY.INTERIOR_DOOR, { operation_type: "barn" }).width).toBe(30.5);
  });

  test("window RO uses generic +1/+1 — not exterior door formula", () => {
    const ro = computeAutoRoughOpening(36, 48, OPENING_CATEGORY.WINDOW);
    expect(ro.width).toBe(37);
    expect(ro.height).toBe(49);
    expect(ro.profile).toEqual(WINDOW_GENERIC_RO);
    expect(ro.width - 36).not.toBe(EXTERIOR_DOOR_RO.widthAdd);
    expect(ro.height - 48).not.toBe(EXTERIOR_DOOR_RO.heightAdd);
  });

  test("normalize + patch interior door preserves category and resizes plan width", () => {
    const room = createRoomFromOutsideBounds("Room", 0, 0, 198, 138);
    const walls = wallsFromRoom(room);
    const wall = walls.find((w) => w.room_side === "north");
    wall.kind = "interior";
    const door = applyInteriorDoorDefaults({ ...emptyOpening("door"), width: 30, height: 80, offset: 3.5 + 40 });
    wall.openings = [door];
    const level = { rooms: [room], walls };
    const center = door.offset + door.width / 2;
    const patch = interiorDoorSpecToOpeningPatch(normalizeInteriorDoorSpec({ ...door, width: 32 }));
    expect(patch.opening_category).toBe(OPENING_CATEGORY.INTERIOR_DOOR);
    expect(patch.exterior).toBe(false);
    expect(patch.rough_opening_width).toBe(34);
    const result = applyDoorOpeningPatch(level, wall.id, door.id, patch);
    expect(result.ok).toBe(true);
    const opening = result.level.walls.find((w) => w.id === wall.id).openings[0];
    expect(opening.width).toBe(32);
    expect(opening.width).not.toBe(opening.rough_opening_width);
    expect(opening.offset + opening.width / 2).toBeCloseTo(center, 0);
    expect(assertOpeningSpanInvariant(result.level, wall, opening)).toBe(true);
  });

  test("normalize + patch window resizes plan width and keeps window RO", () => {
    const room = createRoomFromOutsideBounds("Room", 0, 0, 198, 138);
    const walls = wallsFromRoom(room);
    const wall = walls.find((w) => w.room_side === "north");
    const win = { ...emptyOpening("window"), width: 36, height: 48, offset: 3.5 + 24 };
    wall.openings = [win];
    const level = { rooms: [room], walls };
    const before = openingPositionSpans(level, wall, win);
    const center = win.offset + win.width / 2;
    const patch = windowSpecToOpeningPatch(normalizeWindowSpec({
      ...win,
      width: 42,
      window_type: "double-hung",
      grid_pattern: "colonial",
      glass: { paneCount: 2, lowE: true, gridPattern: "colonial" },
    }));
    expect(patch.opening_category).toBe(OPENING_CATEGORY.WINDOW);
    expect(patch.rough_opening_width).toBe(43);
    expect(patch.grid_pattern).toBe("colonial");
    const result = applyDoorOpeningPatch(level, wall.id, win.id, patch);
    expect(result.ok).toBe(true);
    const opening = result.level.walls.find((w) => w.id === wall.id).openings[0];
    expect(opening.width).toBe(42);
    expect(opening.rough_opening_width).toBe(43);
    expect(opening.offset + opening.width / 2).toBeCloseTo(center, 0);
    const after = openingPositionSpans(result.level, wall, opening);
    expect(after.startSpan + after.openingWidth + after.endSpan).toBe(before.clear.clearLength);
  });

  test("empty window defaults do not use exterior door RO adds", () => {
    const win = emptyOpening("window");
    expect(win.rough_opening_width - win.width).toBe(1);
    expect(win.rough_opening_height - win.height).toBe(1);
  });
});
