/**
 * Dimension lane manager — whole groups move together between lanes.
 *
 * Lane 0 (nearest wall): opening-chain
 * Lane 1: room-assembly (wall | clear | wall)
 * Lane 2 (farthest): overall exterior
 *
 * Offsets are SVG pixels along the exterior normal.
 * LABEL_BAND_PX is reserved on each group's preferred label side so text
 * stays owned by that group and does not drift into a neighboring lane.
 */

export const LANE_BASE_PX = 44;
export const LANE_STEP_PX = 42;
/** Max label offset from a group's dimension line (must be < LANE_STEP/2). */
export const LABEL_BAND_PX = 12;

export const DIM_GROUP = {
  OPENING_CHAIN: "opening-chain",
  ROOM_ASSEMBLY: "room-assembly",
  OVERALL: "overall",
};

/**
 * @param {{ hasFeatureChain?: boolean }} opts
 * @returns {{
 *   openingChain: number | null,
 *   roomAssembly: number,
 *   overall: number | null,
 *   mode: "stacked" | "combined",
 *   groups: Array<{ type: string, lane: number, offsetPx: number }>
 * }}
 */
export function exteriorLaneOffsets({ hasFeatureChain = false } = {}) {
  if (!hasFeatureChain) {
    // Combined room-assembly + overall on one near string (no opening lane).
    const roomAssembly = LANE_BASE_PX + 8;
    return {
      openingChain: null,
      roomAssembly,
      overall: null,
      mode: "combined",
      // Back-compat aliases used by older call sites
      feature: null,
      segments: roomAssembly,
      groups: [
        { type: DIM_GROUP.ROOM_ASSEMBLY, lane: 0, offsetPx: roomAssembly },
      ],
    };
  }

  const openingChain = LANE_BASE_PX;
  const roomAssembly = LANE_BASE_PX + LANE_STEP_PX;
  const overall = LANE_BASE_PX + LANE_STEP_PX * 2;

  return {
    openingChain,
    roomAssembly,
    overall,
    mode: "stacked",
    feature: openingChain,
    segments: roomAssembly,
    groups: [
      { type: DIM_GROUP.OPENING_CHAIN, lane: 0, offsetPx: openingChain },
      { type: DIM_GROUP.ROOM_ASSEMBLY, lane: 1, offsetPx: roomAssembly },
      { type: DIM_GROUP.OVERALL, lane: 2, offsetPx: overall },
    ],
  };
}

export function assertLaneOrder(offsets) {
  if (offsets.mode === "combined") return true;
  const vals = [offsets.openingChain ?? offsets.feature, offsets.roomAssembly ?? offsets.segments, offsets.overall]
    .filter((n) => n != null);
  for (let i = 1; i < vals.length; i += 1) {
    if (!(vals[i] > vals[i - 1])) return false;
  }
  return true;
}

/** Labels for a group stay on this side of the group's line (never cross into another lane). */
export function labelSideForGroup(groupType, exteriorToward) {
  const roomToward = -exteriorToward;
  if (groupType === DIM_GROUP.OPENING_CHAIN) {
    // Closest lane: labels sit toward the wall, under/inside the opening line.
    return roomToward;
  }
  // Room-assembly + overall: labels sit toward the exterior of their own line
  // so 3½" stays with the assembly group and cannot drift into the opening band.
  return exteriorToward;
}
