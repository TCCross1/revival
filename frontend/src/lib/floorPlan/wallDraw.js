/**
 * Point & Line wall drawing — transient vs committed geometry (Phase 1).
 *
 * ARCHITECTURE ASSESSMENT (2026-09)
 * ---------------------------------
 * ALREADY OK:
 * - drawPoints live in React UI state (not document history) — correct for transient.
 * - createHistory snapshots full plan documents; openings use beginGesture/endGesture.
 * - Walls are emptyWall(x1,y1,x2,y2); openings hosted via wall.openings + offset.
 * - Room Block owns AABB + wallsFromRoom (source_room_id); Point & Line creates free walls.
 *
 * PARTIAL / DONE (residential wall dynamics):
 * - Magnetic snap + hysteresis + ortho (snapEngine)
 * - Shared vertices + wall-body perpendicular move (planTopology)
 * - Adjacent CLOSE ROOM reuses existing wall as shared partition
 * - Room Block flush create also merges coincident shared walls
 *
 * STILL LATER:
 * - Dedicated Move Room toolbar + merge-on-drop polish
 * - Non-rectangular topology faces
 * - Endpoint-handle drag as distinct gesture UX
 */

import { dist, round2 } from "./units";

/** Minimum wall length (inches) to commit a Point & Line segment. */
export const MIN_DRAW_WALL_IN = 6;

/**
 * After committing a wall from A→B, the chain continues from B only.
 * Prior points are discarded so Undo cannot leave orphan handles.
 */
export function nextChainPointsAfterCommit(committedEnd) {
  if (!committedEnd || !Number.isFinite(Number(committedEnd.x)) || !Number.isFinite(Number(committedEnd.y))) {
    return [];
  }
  return [{ x: round2(committedEnd.x), y: round2(committedEnd.y) }];
}

export function canCommitSegment(a, b, minIn = MIN_DRAW_WALL_IN) {
  if (!a || !b) return false;
  return dist(a.x, a.y, b.x, b.y) >= minIn;
}

/** Finish the active Point & Line chain (clear all transient points). */
export function clearDrawChain() {
  return [];
}
