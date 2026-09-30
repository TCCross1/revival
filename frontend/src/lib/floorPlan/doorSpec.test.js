import {
  RO_HEIGHT_ADD_IN,
  RO_WIDTH_ADD_IN,
  applyAutoRoughOpening,
  defaultRoughOpening,
  doorSpecToOpeningPatch,
  normalizeDoorSpec,
  syncRoughOpeningOnSizeChange,
} from "./doorSpec";
import { applyDoorOpeningPatch, assertOpeningSpanInvariant, openingPositionSpans } from "./wallOpenings";
import { createRoomFromOutsideBounds, emptyOpening, wallsFromRoom } from "./model";
import { formatFtInTight } from "./units";

function levelWithDoor(doorWidth = 32) {
  const room = createRoomFromOutsideBounds("Room", 0, 0, 198, 138);
  const walls = wallsFromRoom(room);
  const north = walls.find((w) => w.room_side === "north");
  const door = {
    ...emptyOpening("door"),
    width: doorWidth,
    height: 80,
    offset: 3.5 + 60,
  };
  north.openings = [door];
  return { level: { rooms: [room], walls }, north, door };
}

describe("doorSpec + rough opening", () => {
  test("2'8\" × 6'8\" door → RO 2'9½\" × 6'10\"", () => {
    const ro = defaultRoughOpening(32, 80);
    expect(ro.width).toBe(33.5);
    expect(ro.height).toBe(82);
    expect(ro.width - 32).toBe(RO_WIDTH_ADD_IN);
    expect(ro.height - 80).toBe(RO_HEIGHT_ADD_IN);
    expect(formatFtInTight(32)).toBe("2'8\"");
    expect(formatFtInTight(80)).toBe("6'8\"");
    expect(formatFtInTight(33.5)).toBe("2'9½\"");
    expect(formatFtInTight(82)).toBe("6'10\"");
  });

  test("3' × 6'8\" door → RO 3'1½\" × 6'10\"", () => {
    const ro = defaultRoughOpening(36, 80);
    expect(ro.width).toBe(37.5);
    expect(ro.height).toBe(82);
    expect(formatFtInTight(36)).toBe("3'");
    expect(formatFtInTight(37.5)).toBe("3'1½\"");
  });

  test("AUTO / MANUAL rough opening", () => {
    let spec = normalizeDoorSpec({ width: 32, height: 80 });
    expect(spec.rough_opening_mode).toBe("auto");
    expect(spec.rough_opening_width).toBe(33.5);
    spec = { ...spec, rough_opening_mode: "manual", rough_opening_width: 34, rough_opening_height: 83 };
    spec = syncRoughOpeningOnSizeChange(spec, 32, 80);
    expect(spec.rough_opening_width).toBe(34); // manual preserved through size sync of same size
    spec = syncRoughOpeningOnSizeChange(spec, 36, 80);
    expect(spec.rough_opening_width).toBe(34); // still manual
    spec = applyAutoRoughOpening(spec);
    expect(spec.rough_opening_mode).toBe("auto");
    expect(spec.rough_opening_width).toBe(37.5);
    expect(spec.rough_opening_height).toBe(82);
  });

  test("width change preserves centerline and span invariant; RO does not become plan width", () => {
    const { level, north, door } = levelWithDoor(32);
    const before = openingPositionSpans(level, north, door);
    const center = door.offset + door.width / 2;
    const patch = doorSpecToOpeningPatch(normalizeDoorSpec({
      ...door,
      width: 36,
      height: 80,
      rough_opening_mode: "auto",
    }));
    expect(patch.rough_opening_width).toBe(37.5);
    expect(patch.width).toBe(36);

    const result = applyDoorOpeningPatch(level, north.id, door.id, patch);
    expect(result.ok).toBe(true);
    const wall = result.level.walls.find((w) => w.id === north.id);
    const opening = wall.openings.find((o) => o.id === door.id);
    expect(opening.width).toBe(36);
    expect(opening.width).not.toBe(opening.rough_opening_width);
    expect(opening.rough_opening_width).toBe(37.5);
    const after = openingPositionSpans(result.level, wall, opening);
    expect(assertOpeningSpanInvariant(result.level, wall, opening)).toBe(true);
    expect(after.startSpan + after.openingWidth + after.endSpan).toBe(before.clear.clearLength);
    expect(opening.offset + opening.width / 2).toBeCloseTo(center, 0);
  });

  test("normalize maps swing/handing for plan symbol", () => {
    const patch = doorSpecToOpeningPatch(normalizeDoorSpec({
      width: 32,
      height: 80,
      handing: "right",
      swingDirection: "outswing",
      style: "six-panel",
      material: "steel",
      bore_count: 2,
      hinges: { count: 3, width: 4, height: 4, type: "ball-bearing" },
    }));
    expect(patch.swing).toBe("right");
    expect(patch.direction).toBe("out");
    expect(patch.material).toBe("steel");
    expect(patch.bore_count).toBe(2);
  });
});
