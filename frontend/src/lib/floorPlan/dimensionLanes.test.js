import {
  assertLaneOrder,
  DIM_GROUP,
  exteriorLaneOffsets,
  labelSideForGroup,
  LABEL_BAND_PX,
  LANE_STEP_PX,
} from "./dimensionLanes";

describe("dimension lane ownership", () => {
  test("stacked groups keep opening < assembly < overall", () => {
    const lanes = exteriorLaneOffsets({ hasFeatureChain: true });
    expect(lanes.mode).toBe("stacked");
    expect(assertLaneOrder(lanes)).toBe(true);
    expect(lanes.openingChain).toBeLessThan(lanes.roomAssembly);
    expect(lanes.roomAssembly).toBeLessThan(lanes.overall);
    // Label bands must fit between lanes so groups don't collide.
    expect(LABEL_BAND_PX * 2).toBeLessThan(LANE_STEP_PX);
  });

  test("opening labels face the wall; assembly + overall face exterior", () => {
    expect(labelSideForGroup(DIM_GROUP.OPENING_CHAIN, -1)).toBe(1); // north → toward room
    expect(labelSideForGroup(DIM_GROUP.ROOM_ASSEMBLY, -1)).toBe(-1); // north → exterior
    expect(labelSideForGroup(DIM_GROUP.OVERALL, -1)).toBe(-1);
    expect(labelSideForGroup(DIM_GROUP.OPENING_CHAIN, 1)).toBe(-1); // south → toward room
    expect(labelSideForGroup(DIM_GROUP.ROOM_ASSEMBLY, 1)).toBe(1);
    expect(labelSideForGroup(DIM_GROUP.OVERALL, 1)).toBe(1);
  });

  test("without openings, only combined room-assembly lane exists", () => {
    const lanes = exteriorLaneOffsets({ hasFeatureChain: false });
    expect(lanes.mode).toBe("combined");
    expect(lanes.openingChain).toBeNull();
    expect(lanes.overall).toBeNull();
    expect(lanes.groups).toHaveLength(1);
    expect(lanes.groups[0].type).toBe(DIM_GROUP.ROOM_ASSEMBLY);
  });
});
