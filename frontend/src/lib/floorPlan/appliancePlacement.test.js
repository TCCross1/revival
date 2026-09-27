import { requiresWallHost, snapApplianceToWall, objectFootprint } from "./cabinetRun";
import { emptyLevel, emptyObject, emptyRoom, emptyWall, wallsFromRoom } from "./model";
import { libraryById } from "./library";
import { kitchenDesignOf, placeKitchenAnchor } from "./kitchenDesign";

function kitchen() {
  const room = emptyRoom("Kitchen", 0, 0, 144, 120); // 3 1/2" walls, interior faces at 3.5 / 140.5 / 116.5
  const walls = wallsFromRoom(room);
  return { room, walls, level: { ...emptyLevel(), rooms: [room], walls, objects: [], vertices: [] } };
}

function centeredAt(libId, x, y) {
  const lib = libraryById(libId);
  const draft = emptyObject(lib, x, y);
  return { ...draft, x: x - draft.width / 2, y: y - draft.depth / 2 };
}

describe("appliances only place on an interior or exterior wall", () => {
  test("appliances require a wall host; islands and cabinets do not", () => {
    expect(requiresWallHost(emptyObject(libraryById("fridge-36"), 0, 0))).toBe(true);
    expect(requiresWallHost(emptyObject(libraryById("range-30"), 0, 0))).toBe(true);
    expect(requiresWallHost(emptyObject(libraryById("dw-24"), 0, 0))).toBe(true);
    expect(requiresWallHost(emptyObject(libraryById("micro-24"), 0, 0))).toBe(true);
    const island = (libraryById("island-72") || libraryById("island-96"));
    if (island) expect(requiresWallHost(emptyObject(island, 0, 0))).toBe(false);
  });

  test("tap in the middle of the room is rejected with a wall message", () => {
    const { level } = kitchen();
    const res = snapApplianceToWall(centeredAt("fridge-36", 72, 60), level, 6);
    expect(res.onWall).toBe(false);
    expect(res.reason).toMatch(/wall/i);
  });

  test("tap inside the room next to the north wall snaps the fridge flush to the interior face", () => {
    const { level, walls } = kitchen();
    const north = walls.find((w) => w.room_side === "north");
    const res = snapApplianceToWall(centeredAt("fridge-36", 72, 16), level, 6);
    expect(res.onWall).toBe(true);
    expect(res.object.wall_id).toBe(north.id);
    expect(res.object.front).toBe("south");
    expect(res.object.y).toBe(3.5);
    const fp = objectFootprint(res.object);
    expect(fp.x).toBeGreaterThanOrEqual(0);
    expect(fp.x + fp.w).toBeLessThanOrEqual(144);
  });

  test("non-run appliance (microwave) also sits flush on the east wall", () => {
    const { level, walls } = kitchen();
    const east = walls.find((w) => w.room_side === "east");
    const res = snapApplianceToWall(centeredAt("micro-24", 130, 60), level, 6);
    expect(res.onWall).toBe(true);
    expect(res.object.wall_id).toBe(east.id);
    expect(res.object.front).toBe("west");
    const fp = objectFootprint(res.object);
    expect(fp.x + fp.w).toBeCloseTo(140.5, 5);
  });

  test("a Point & line interior wall counts as a host wall", () => {
    const { level } = kitchen();
    const partition = emptyWall(72, 3.5, 72, 116.5, "interior");
    const withWall = { ...level, walls: [...level.walls, partition] };
    const res = snapApplianceToWall(centeredAt("dw-24", 86, 60), withWall, 6);
    expect(res.onWall).toBe(true);
    expect(res.object.wall_id).toBe(partition.id);
  });

  test("kitchen anchor (Range) off-wall returns an error and leaves the plan unchanged", () => {
    const { level } = kitchen();
    const next = placeKitchenAnchor(level, "range", { x: 72, y: 60 }, kitchenDesignOf({}), {});
    expect(next._kitchenError).toMatch(/wall/i);
    expect(next.objects).toEqual([]);
  });

  test("kitchen anchor (Refrigerator) next to a wall is placed on that wall", () => {
    const { level, walls } = kitchen();
    const west = walls.find((w) => w.room_side === "west");
    const next = placeKitchenAnchor(level, "fridge", { x: 14, y: 60 }, kitchenDesignOf({}), {});
    expect(next._kitchenError).toBeUndefined();
    const fridge = next.objects.find((o) => o.anchor === "fridge");
    expect(fridge).toBeTruthy();
    expect(fridge.wall_id).toBe(west.id);
    expect(fridge.front).toBe("east");
  });
});
