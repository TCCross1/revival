import { formatArchInches, formatFtInTight, inches, round2 } from "./units";
import { roomOutsideBounds, roomWallThickness } from "./model";

/**
 * Build a segmented outside / wall / clear / wall room dimension from real faces.
 * All values are inches in world space.
 */
export function buildSegmentedRoomDimension({
  orientation,
  outsideStart,
  outsideEnd,
  startWallThickness,
  endWallThickness,
}) {
  const overallLength = round2(inches(outsideEnd) - inches(outsideStart));
  const startT = round2(Math.max(0, inches(startWallThickness)));
  const endT = round2(Math.max(0, inches(endWallThickness)));
  const insideStart = round2(inches(outsideStart) + startT);
  const insideEnd = round2(inches(outsideEnd) - endT);
  const interiorClearLength = round2(insideEnd - insideStart);
  const sum = round2(startT + interiorClearLength + endT);
  if (Math.abs(sum - overallLength) > 0.05) {
    throw new Error(
      `Segmented room dimension invariant failed: ${startT} + ${interiorClearLength} + ${endT} = ${sum}, expected ${overallLength}`,
    );
  }
  return {
    orientation: orientation === "vertical" ? "vertical" : "horizontal",
    outsideStart: round2(inches(outsideStart)),
    insideStart,
    insideEnd,
    outsideEnd: round2(inches(outsideEnd)),
    startWallThickness: startT,
    interiorClearLength,
    endWallThickness: endT,
    overallLength,
  };
}

export function assertSegmentedInvariant(dim) {
  const sum = round2(dim.startWallThickness + dim.interiorClearLength + dim.endWallThickness);
  return Math.abs(sum - dim.overallLength) <= 0.05;
}

/** Resolve thickness for a room side from owned walls, falling back to room.wall_thickness. */
export function thicknessForRoomSide(level, room, side) {
  const owned = (level?.walls || []).filter((wall) => wall.source_room_id === room.id);
  const match = owned.find((wall) => wall.room_side === side)
    || owned.find((wall) => inferRoomSide(wall, room) === side);
  if (match) return Math.max(1, inches(match.thickness));
  return Math.max(1, roomWallThickness(room));
}

function inferRoomSide(wall, room) {
  const { left, top, right, bottom } = roomOutsideBounds(room);
  const mx = (inches(wall.x1) + inches(wall.x2)) / 2;
  const my = (inches(wall.y1) + inches(wall.y2)) / 2;
  const scores = {
    north: Math.abs(my - top),
    south: Math.abs(my - bottom),
    west: Math.abs(mx - left),
    east: Math.abs(mx - right),
  };
  return Object.entries(scores).sort((a, b) => a[1] - b[1])[0][0];
}

/**
 * Horizontal width string for a room (outside left → outside right).
 * Uses west/east wall face thicknesses when present.
 */
export function segmentedWidthForRoom(level, room) {
  const { left, right } = roomOutsideBounds(room);
  return buildSegmentedRoomDimension({
    orientation: "horizontal",
    outsideStart: left,
    outsideEnd: right,
    startWallThickness: thicknessForRoomSide(level, room, "west"),
    endWallThickness: thicknessForRoomSide(level, room, "east"),
  });
}

/**
 * Vertical depth/height string for a room (outside top → outside bottom).
 * Uses north/south wall face thicknesses when present.
 */
export function segmentedDepthForRoom(level, room) {
  const { top, bottom } = roomOutsideBounds(room);
  return buildSegmentedRoomDimension({
    orientation: "vertical",
    outsideStart: top,
    outsideEnd: bottom,
    startWallThickness: thicknessForRoomSide(level, room, "north"),
    endWallThickness: thicknessForRoomSide(level, room, "south"),
  });
}

export function segmentedLabels(dim) {
  return {
    overall: formatFtInTight(dim.overallLength),
    startWall: formatArchInches(dim.startWallThickness),
    interior: formatFtInTight(dim.interiorClearLength),
    endWall: formatArchInches(dim.endWallThickness),
  };
}
