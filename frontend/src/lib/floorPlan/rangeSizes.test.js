import { snapApplianceToWall } from "./cabinetRun";
import { emptyLevel, emptyObject, emptyRoom, wallsFromRoom } from "./model";
import {
  RANGE_SIZE_OPTIONS, burnerOptionsFor, libraryById, normalizeRangeSpec, rangeBurnerCount, rangeLibraryIdFor,
} from "./library";
import { ensureRangeHood, kitchenDesignOf, placeKitchenAnchor } from "./kitchenDesign";

function kitchen() {
  const room = emptyRoom("Kitchen", 0, 0, 144, 120);
  const walls = wallsFromRoom(room);
  return { walls, level: { ...emptyLevel(), rooms: [room], walls, objects: [], vertices: [] } };
}

function centeredAt(libId, x, y, extra = {}) {
  const draft = { ...emptyObject(libraryById(libId), x, y), ...extra };
  return { ...draft, x: x - draft.width / 2, y: y - draft.depth / 2 };
}

describe("range sizes: 30/33 four-burner standard, 35–40 six-burner option", () => {
  test("catalog has the standard and wide ranges with burner counts in the name", () => {
    ["range-30", "range-33", "range-gas-30", "range-gas-33"].forEach((id) => {
      expect(libraryById(id).name).toMatch(/4 burner/);
      expect(rangeBurnerCount(libraryById(id))).toBe(4);
    });
    ["range-35", "range-36", "range-40", "range-gas-35", "range-gas-36", "range-gas-40"].forEach((id) => {
      expect(libraryById(id).name).toMatch(/6 burner/);
      expect(rangeBurnerCount(libraryById(id))).toBe(6);
    });
    expect(RANGE_SIZE_OPTIONS.map((row) => row.id)).toEqual(["30", "33", "35", "36", "40"]);
  });

  test("four burners under 35 inches; wide ranges default to six but can pick four", () => {
    expect(rangeBurnerCount({ width: 33, burners: 6 })).toBe(4);
    expect(rangeBurnerCount({ width: 35 })).toBe(6);
    expect(rangeBurnerCount({ width: 40, burners: 4 })).toBe(4);
    expect(burnerOptionsFor(33).map((row) => row.id)).toEqual(["4"]);
    expect(burnerOptionsFor(36).map((row) => row.id)).toEqual(["6", "4"]);
  });

  test("normalize clamps range width to 30–40 and drops burner picks on narrow ranges", () => {
    const base = emptyObject(libraryById("range-30"), 0, 0);
    expect(normalizeRangeSpec({ ...base, width: 48 }).width).toBe(40);
    expect(normalizeRangeSpec({ ...base, width: 24 }).width).toBe(30);
    expect("burners" in normalizeRangeSpec({ ...base, width: 33, burners: 6 })).toBe(false);
    expect(normalizeRangeSpec({ ...base, width: 36, burners: 4 }).burners).toBe(4);
    const fridge = emptyObject(libraryById("fridge-36"), 0, 0);
    expect(normalizeRangeSpec(fridge)).toBe(fridge);
  });

  test("resizing keeps the same range family when the catalog has that width", () => {
    expect(rangeLibraryIdFor("range-30", 40)).toBe("range-40");
    expect(rangeLibraryIdFor("range-gas-30", 35)).toBe("range-gas-35");
    expect(rangeLibraryIdFor("range-induction-30", 33)).toBe("range-induction-30");
    expect(rangeLibraryIdFor("range-white", 36)).toBe("range-white");
  });

  test("an oversized range placed on a wall is trimmed to 40 inches, flush to the wall", () => {
    const { level, walls } = kitchen();
    const north = walls.find((w) => w.room_side === "north");
    const res = snapApplianceToWall(centeredAt("range-30", 72, 16, { width: 52 }), level, 6);
    expect(res.onWall).toBe(true);
    expect(res.object.wall_id).toBe(north.id);
    expect(res.object.width).toBe(40);
    expect(rangeBurnerCount(res.object)).toBe(6);
  });

  test("Kitchen panel 33 inch anchor places a 4-burner 33 inch range; 40 inch can be set to 4 burners", () => {
    const { level } = kitchen();
    const at33 = placeKitchenAnchor(level, "range", { x: 72, y: 16 }, kitchenDesignOf({ kitchen_design: { range_width: 33, fuel: "gas" } }), {});
    const r33 = at33.objects.find((o) => o.anchor === "range");
    expect(r33.width).toBe(33);
    expect(r33.library_id).toBe("range-gas-33");
    expect(rangeBurnerCount(r33)).toBe(4);

    const at40 = placeKitchenAnchor(level, "range", { x: 72, y: 16 }, kitchenDesignOf({ kitchen_design: { range_width: 40, range_burners: 4 } }), {});
    const r40 = at40.objects.find((o) => o.anchor === "range");
    expect(r40.width).toBe(40);
    expect(r40.library_id).toBe("range-40");
    expect(rangeBurnerCount(r40)).toBe(4);
  });

  test("the auto hood matches a 33 inch range width", () => {
    const { level } = kitchen();
    const placed = placeKitchenAnchor(level, "range", { x: 72, y: 16 }, kitchenDesignOf({ kitchen_design: { range_width: 33 } }), {});
    const withHood = ensureRangeHood(placed, {});
    const hood = withHood.objects.find((o) => String(o.library_id).startsWith("hood"));
    expect(hood).toBeTruthy();
    expect(hood.width).toBe(33);
  });
});
