import {
  MIN_DRAW_WALL_IN,
  canCommitSegment,
  clearDrawChain,
  nextChainPointsAfterCommit,
} from "./wallDraw";

describe("wallDraw Phase 1 — transient vs committed", () => {
  test("after commit, only end point remains for chain continuation", () => {
    const next = nextChainPointsAfterCommit({ x: 100, y: 40 });
    expect(next).toEqual([{ x: 100, y: 40 }]);
    expect(next).toHaveLength(1);
  });

  test("clearDrawChain empties transient points", () => {
    expect(clearDrawChain()).toEqual([]);
  });

  test("canCommitSegment rejects zero-length and short segments", () => {
    expect(canCommitSegment({ x: 0, y: 0 }, { x: 0, y: 0 })).toBe(false);
    expect(canCommitSegment({ x: 0, y: 0 }, { x: 3, y: 0 })).toBe(false);
    expect(canCommitSegment({ x: 0, y: 0 }, { x: MIN_DRAW_WALL_IN, y: 0 })).toBe(true);
  });
});
