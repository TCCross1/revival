import { emptyLevel, emptyObject, emptyRoom, wallsFromRoom } from "./model";
import { isBaseRunObject, isDrawerStackCabinet, isFillerObject, isWallCabinetObject, libraryById } from "./library";
import { objectFootprint } from "./cabinetRun";
import {
  AUTO_MAX_FILLER,
  STANDARD_CABINET_WIDTHS,
  STANDARD_WALL_HEIGHT,
  autoGenerateCabinets,
  measureOpenRuns,
  packCabinetWidths,
} from "./kitchenDesign";

function kitchenFixture(level) {
  const room = emptyRoom("Kitchen", 24, 24, 180, 144);
  const walls = wallsFromRoom(room, "interior");
  const north = walls[0];
  const rangeLib = libraryById("range-30");
  const fridgeLib = libraryById("fridge-36");
  const sinkLib = libraryById("cab-sink-36");
  const cornerLib = libraryById("cab-corner-36");
  const range = {
    ...emptyObject(rangeLib, 24 + 60, 24),
    locked: true,
    anchor: "range",
    wall_id: north.id,
    front: "south",
    width: 30,
    depth: 24,
    auto_fill: false,
  };
  const fridge = {
    ...emptyObject(fridgeLib, 24, 24),
    locked: true,
    anchor: "fridge",
    wall_id: north.id,
    front: "south",
    width: 36,
    depth: 24,
    auto_fill: false,
  };
  const sink = {
    ...emptyObject(sinkLib, 24 + 120, 24),
    locked: true,
    anchor: "sink",
    wall_id: north.id,
    front: "south",
    width: 36,
    depth: 24,
    auto_fill: false,
  };
  const corner = {
    ...emptyObject(cornerLib, 24 + 180 - 36, 24),
    locked: true,
    wall_id: north.id,
    front: "south",
    width: 36,
    depth: 36,
    config: "lazy-susan",
    tags: ["cabinet", "base", "corner"],
    auto_fill: false,
  };
  return {
    ...level,
    rooms: [room],
    walls,
    objects: [fridge, range, sink, corner],
    north,
  };
}

test("standard widths exclude odd sizes and packing is deterministic", () => {
  expect(STANDARD_CABINET_WIDTHS).toEqual([12, 15, 18, 21, 24, 27, 30, 33, 36]);
  const a = packCabinetWidths(54);
  const b = packCabinetWidths(54);
  expect(a).toEqual(b);
  expect(a.unfilled).toBe(0);
  expect(a.filler).toBeLessThanOrEqual(AUTO_MAX_FILLER);
  expect(a.pieces.reduce((sum, w) => sum + w, 0) + a.filler).toBeCloseTo(54, 5);
  a.pieces.forEach((w) => expect(STANDARD_CABINET_WIDTHS).toContain(w));
});

test("pack prefers a clean filler instead of a leftover over 4 inches", () => {
  const packed = packCabinetWidths(47);
  expect(packed.unfilled).toBe(0);
  expect(packed.filler).toBeGreaterThan(0);
  expect(packed.filler).toBeLessThanOrEqual(AUTO_MAX_FILLER);
  expect(packed.pieces.reduce((sum, w) => sum + w, 0) + packed.filler).toBeCloseTo(47, 5);
});

test("gaps under 12 and over 4 inches stay unfilled rather than using a 9 inch cabinet", () => {
  const packed = packCabinetWidths(11);
  expect(packed.pieces).toEqual([]);
  expect(packed.unfilled).toBeCloseTo(11, 5);
});

test("auto generator fills only selected walls and never moves locked appliances or corners", () => {
  const level = emptyLevel("1st Floor", 0);
  const fixture = kitchenFixture(level);
  const before = fixture.objects.map((obj) => ({ id: obj.id, x: obj.x, y: obj.y, library_id: obj.library_id }));
  const result = autoGenerateCabinets(fixture, {}, {}, [fixture.north.id]);
  before.forEach((row) => {
    const live = (result.level.objects || []).find((obj) => obj.id === row.id);
    expect(live).toBeTruthy();
    expect(live.x).toBe(row.x);
    expect(live.y).toBe(row.y);
    expect(live.library_id).toBe(row.library_id);
  });
  const generated = (result.level.objects || []).filter((obj) => !before.some((row) => row.id === obj.id));
  expect(generated.length).toBeGreaterThan(0);
  generated.forEach((obj) => {
    expect(before.some((row) => row.id === obj.id)).toBe(false);
  });
  const otherWalls = fixture.walls.filter((wall) => wall.id !== fixture.north.id);
  const stray = generated.filter((obj) => otherWalls.some((wall) => obj.wall_id === wall.id));
  expect(stray).toEqual([]);
});

test("auto generator refuses to run without selected walls", () => {
  const level = emptyLevel("1st Floor", 0);
  const fixture = kitchenFixture(level);
  const result = autoGenerateCabinets(fixture, {}, {}, []);
  expect(result.level.objects).toHaveLength(fixture.objects.length);
  expect(result.warnings[0].code).toBe("walls");
});

test("two runs with the same walls produce the same cabinet widths", () => {
  const level = emptyLevel("1st Floor", 0);
  const fixture = kitchenFixture(level);
  const first = autoGenerateCabinets(fixture, {}, {}, [fixture.north.id]);
  const second = autoGenerateCabinets(fixture, {}, {}, [fixture.north.id]);
  const widths = (doc) => (doc.level.objects || [])
    .filter((obj) => obj.auto_fill)
    .map((obj) => `${obj.library_id}:${obj.width}`)
    .sort();
  expect(widths(first)).toEqual(widths(second));
});

function fillableGaps(level, wall) {
  return measureOpenRuns(level, wall).filter((gap) => gap.length >= 12);
}

function emptyKitchenWithRange() {
  const level = emptyLevel("1st Floor", 0);
  const room = emptyRoom("Kitchen", 24, 24, 192, 144);
  const walls = wallsFromRoom(room, "interior");
  const north = walls[0];
  const east = walls[1];
  const south = walls[2];
  const west = walls[3];
  const rangeLib = libraryById("range-30");
  const fridgeLib = libraryById("fridge-36");
  const sinkLib = libraryById("cab-sink-36");
  const dwLib = libraryById("dw-24");
  const cornerLib = libraryById("cab-corner-36");
  const range = {
    ...emptyObject(rangeLib, 24 + 72, 24),
    locked: true,
    anchor: "range",
    wall_id: north.id,
    front: "south",
    width: 30,
    depth: 24,
    auto_fill: false,
  };
  const fridge = {
    ...emptyObject(fridgeLib, 24, 24),
    locked: true,
    anchor: "fridge",
    wall_id: north.id,
    front: "south",
    width: 36,
    depth: 24,
    auto_fill: false,
  };
  const sink = {
    ...emptyObject(sinkLib, 24 + 192 - 36 - 24 - 36, 24 + 144 - 24),
    locked: true,
    anchor: "sink",
    wall_id: south.id,
    front: "north",
    width: 36,
    depth: 24,
    auto_fill: false,
  };
  const dw = {
    ...emptyObject(dwLib, 24 + 192 - 36 - 24, 24 + 144 - 24),
    locked: true,
    anchor: "dishwasher",
    wall_id: south.id,
    front: "north",
    width: 24,
    depth: 24,
    auto_fill: false,
  };
  const nw = {
    ...emptyObject(cornerLib, 24, 24),
    locked: true,
    wall_id: west.id,
    front: "east",
    width: 36,
    depth: 36,
    config: "lazy-susan",
    tags: ["cabinet", "base", "corner"],
    auto_fill: false,
  };
  const ne = {
    ...emptyObject(cornerLib, 24 + 192 - 36, 24),
    locked: true,
    wall_id: east.id,
    front: "west",
    width: 36,
    depth: 36,
    config: "lazy-susan",
    tags: ["cabinet", "base", "corner"],
    auto_fill: false,
  };
  return {
    ...level,
    rooms: [room],
    walls,
    objects: [fridge, range, sink, dw, nw, ne],
    north,
    east,
    south,
    west,
    room,
  };
}

test("packing never leaves a 12 inch or larger hole for typical run lengths", () => {
  for (let gap = 12; gap <= 144; gap += 1) {
    const packed = packCabinetWidths(gap);
    const covered = packed.pieces.reduce((sum, width) => sum + width, 0) + packed.filler;
    expect(packed.pieces.length).toBeGreaterThan(0);
    expect(packed.filler).toBeLessThanOrEqual(AUTO_MAX_FILLER);
    expect(gap - covered).toBeLessThan(12);
  }
});

test("auto generator fills selected empty walls instead of leaving cabinet-sized gaps", () => {
  const fixture = emptyKitchenWithRange();
  const result = autoGenerateCabinets(fixture, {}, {}, [fixture.north.id, fixture.east.id, fixture.west.id, fixture.south.id]);
  [fixture.north, fixture.east, fixture.west, fixture.south].forEach((wall) => {
    expect(fillableGaps(result.level, wall)).toEqual([]);
  });
  const generated = (result.level.objects || []).filter((obj) => obj.auto_fill && !isFillerObject(obj));
  expect(generated.length).toBeGreaterThan(6);
  const wallCabs = generated.filter((obj) => isWallCabinetObject(obj) || String(obj.library_id || "").startsWith("hood"));
  expect(wallCabs.length).toBeGreaterThan(2);
});

test("an island in the room does not keep selected walls empty", () => {
  const fixture = emptyKitchenWithRange();
  const islandLib = libraryById("island-96") || libraryById("island-base-96") || {
    id: "island-96", name: "Island", width: 96, depth: 42, height: 36, tags: ["island", "cabinet"],
  };
  fixture.objects.push({
    ...emptyObject(islandLib, 24 + 48, 24 + 48),
    width: 96,
    depth: 42,
    auto_fill: false,
    tags: ["island", "cabinet"],
  });
  const result = autoGenerateCabinets(fixture, {}, {}, [fixture.east.id]);
  expect(fillableGaps(result.level, fixture.east)).toEqual([]);
});

test("existing wall cabinets do not block base cabinets on the same wall", () => {
  const fixture = emptyKitchenWithRange();
  const wallLib = libraryById("cab-wall-30");
  fixture.objects.push({
    ...emptyObject(wallLib, 24 + 192 - 12, 24 + 48),
    wall_id: fixture.east.id,
    front: "west",
    width: 30,
    depth: 12,
    auto_fill: false,
    tags: ["cabinet", "wall"],
  });
  const result = autoGenerateCabinets(fixture, {}, {}, [fixture.east.id]);
  expect(fillableGaps(result.level, fixture.east)).toEqual([]);
  const bases = (result.level.objects || []).filter((obj) => (
    obj.auto_fill && isBaseRunObject(obj) && !isWallCabinetObject(obj)
  ));
  expect(bases.length).toBeGreaterThan(0);
});

test("wall cabinets continue over the sink and dishwasher when there is no window", () => {
  const fixture = emptyKitchenWithRange();
  const result = autoGenerateCabinets(fixture, {}, {}, [fixture.south.id]);
  const sink = fixture.objects.find((obj) => obj.anchor === "sink");
  const dw = fixture.objects.find((obj) => obj.anchor === "dishwasher");
  const wallCabs = (result.level.objects || []).filter((obj) => obj.auto_fill && isWallCabinetObject(obj));
  const covers = (host) => wallCabs.some((cab) => {
    const overlap = Math.min(cab.x + cab.width, host.x + host.width) - Math.max(cab.x, host.x);
    return overlap > 10;
  });
  expect(covers(sink)).toBe(true);
  expect(covers(dw)).toBe(true);
});

function boxesOverlap(a, b) {
  return a.x < b.x + b.w - 0.4 && a.x + a.w - 0.4 > b.x && a.y < b.y + b.h - 0.4 && a.y + a.h - 0.4 > b.y;
}

test("auto generator never stacks cabinets onto corner cabinets", () => {
  const fixture = emptyKitchenWithRange();
  const cornerWall = libraryById("cab-wall-corner-24");
  fixture.objects.push({
    ...emptyObject(cornerWall, 24 + 192 - 24, 24),
    wall_id: fixture.east.id,
    front: "west",
    width: 24,
    depth: 24,
    locked: true,
    tags: ["cabinet", "wall", "corner"],
    config: "lazy-susan",
    auto_fill: false,
  });
  const result = autoGenerateCabinets(fixture, {}, {}, [fixture.north.id, fixture.east.id, fixture.west.id, fixture.south.id]);
  const corners = (result.level.objects || []).filter((obj) => (obj.tags || []).includes("corner") || String(obj.library_id || "").includes("corner"));
  const generated = (result.level.objects || []).filter((obj) => obj.auto_fill && !corners.some((corner) => corner.id === obj.id));
  generated.forEach((obj) => {
    corners.forEach((corner) => {
      expect(boxesOverlap(objectFootprint(obj), objectFootprint(corner))).toBe(false);
    });
  });
});

test("open space beside the sink receives base cabinets", () => {
  const fixture = emptyKitchenWithRange();
  const result = autoGenerateCabinets(fixture, {}, {}, [fixture.south.id]);
  const sink = (result.level.objects || []).find((obj) => obj.anchor === "sink");
  const bases = (result.level.objects || []).filter((obj) => (
    obj.auto_fill && obj.wall_id === fixture.south.id && isBaseRunObject(obj) && !isWallCabinetObject(obj) && !isFillerObject(obj)
  ));
  const beside = bases.filter((obj) => obj.x + obj.width <= sink.x + 1 || obj.x >= sink.x + sink.width - 1);
  expect(beside.length).toBeGreaterThan(0);
  expect(fillableGaps(result.level, fixture.south)).toEqual([]);
});

test("range gets a utensil drawer beside it and a hood above it", () => {
  const fixture = emptyKitchenWithRange();
  const result = autoGenerateCabinets(fixture, {}, {}, [fixture.north.id]);
  const range = (result.level.objects || []).find((obj) => obj.anchor === "range");
  const utensil = (result.level.objects || []).find((obj) => /utensil|spice/i.test(String(obj.library_id || "") + String(obj.note || "")));
  expect(utensil).toBeTruthy();
  const gap = Math.min(
    Math.abs((utensil.x + utensil.width) - range.x),
    Math.abs((range.x + range.width) - utensil.x),
  );
  expect(gap).toBeLessThan(2.5);
  const hood = (result.level.objects || []).find((obj) => String(obj.library_id || "").startsWith("hood"));
  expect(hood).toBeTruthy();
});

test("standard auto bases use a drawer over doors instead of full drawer banks", () => {
  const fixture = emptyKitchenWithRange();
  const result = autoGenerateCabinets(fixture, {}, {}, [fixture.south.id, fixture.east.id]);
  const bases = (result.level.objects || []).filter((obj) => (
    obj.auto_fill && isBaseRunObject(obj) && !isWallCabinetObject(obj) && !isFillerObject(obj)
  ));
  const specialty = bases.filter((obj) => /utensil|spice|tray|baking|pots/i.test(String(obj.note || "")));
  const standard = bases.filter((obj) => !specialty.includes(obj));
  expect(standard.length).toBeGreaterThan(0);
  const stacks = standard.filter((obj) => isDrawerStackCabinet(obj));
  expect(stacks.length).toBe(0);
  const drawerDoors = standard.filter((obj) => String(obj.library_id || "").includes("drawer-doors") || obj.config === "drawer-doors");
  expect(drawerDoors.length).toBeGreaterThan(0);
});

function leftWallRangeKitchen() {
  const level = emptyLevel("1st Floor", 0);
  const room = emptyRoom("Kitchen", 24, 24, 192, 144);
  const walls = wallsFromRoom(room, "interior");
  const west = walls[3];
  const cornerLib = libraryById("cab-corner-36");
  const range = {
    ...emptyObject(libraryById("range-30"), 24, 24 + 54),
    locked: true,
    anchor: "range",
    wall_id: west.id,
    front: "east",
    width: 30,
    depth: 24,
    auto_fill: false,
  };
  const nw = {
    ...emptyObject(cornerLib, 24, 24),
    locked: true,
    wall_id: west.id,
    front: "east",
    width: 36,
    depth: 36,
    config: "lazy-susan",
    tags: ["cabinet", "base", "corner"],
    auto_fill: false,
  };
  const sw = {
    ...emptyObject(cornerLib, 24, 24 + 144 - 36),
    locked: true,
    wall_id: west.id,
    front: "east",
    width: 36,
    depth: 36,
    config: "lazy-susan",
    tags: ["cabinet", "base", "corner"],
    auto_fill: false,
  };
  return { ...level, rooms: [room], walls, objects: [range, nw, sw], west };
}

test("range wall gets one hood, a utensil base, and no stacked wall-cabinet tower", () => {
  const fixture = leftWallRangeKitchen();
  const result = autoGenerateCabinets(fixture, {}, {}, [fixture.west.id]);
  const onWall = (result.level.objects || []).filter((obj) => obj.wall_id === fixture.west.id);
  const hoods = onWall.filter((obj) => String(obj.library_id || "").startsWith("hood"));
  expect(hoods).toHaveLength(1);
  const utensil = onWall.find((obj) => /utensil/i.test(String(obj.library_id || "") + String(obj.note || "")));
  expect(utensil).toBeTruthy();
  const wallLayer = onWall.filter((obj) => isWallCabinetObject(obj) || String(obj.library_id || "").startsWith("hood"));
  wallLayer.forEach((obj) => {
    if (isWallCabinetObject(obj) && !String(obj.library_id || "").includes("corner") && !String(obj.library_id || "").includes("fridge")) {
      expect(obj.height).toBe(STANDARD_WALL_HEIGHT);
    }
  });
  const overlaps = [];
  wallLayer.forEach((a, i) => {
    wallLayer.slice(i + 1).forEach((b) => {
      const fa = objectFootprint(a);
      const fb = objectFootprint(b);
      const along = Math.min(fa.y + fa.h, fb.y + fb.h) - Math.max(fa.y, fb.y);
      if (along > 4) overlaps.push([a.library_id, b.library_id, along]);
    });
  });
  expect(overlaps).toEqual([]);
  const specialties = onWall.filter((obj) => /utensil|spice|tray|baking/i.test(String(obj.note || "")));
  expect(specialties.length).toBeLessThanOrEqual(2);
});
