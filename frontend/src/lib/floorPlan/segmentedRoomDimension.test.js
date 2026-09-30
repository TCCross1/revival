import {
  assertSegmentedInvariant,
  buildSegmentedRoomDimension,
  segmentedDepthForRoom,
  segmentedLabels,
  segmentedWidthForRoom,
} from "./segmentedRoomDimension";
import { formatArchInches, formatFtInTight } from "./units";
import { createRoomFromOutsideBounds, wallsFromRoom } from "./model";

describe("segmentedRoomDimension", () => {
  test("2x4 width: 16' outside → 3½\" | 15'5\" | 3½\"", () => {
    const dim = buildSegmentedRoomDimension({
      orientation: "horizontal",
      outsideStart: 0,
      outsideEnd: 192,
      startWallThickness: 3.5,
      endWallThickness: 3.5,
    });
    expect(dim.overallLength).toBe(192);
    expect(dim.startWallThickness).toBe(3.5);
    expect(dim.interiorClearLength).toBe(185);
    expect(dim.endWallThickness).toBe(3.5);
    expect(assertSegmentedInvariant(dim)).toBe(true);
    expect(dim.insideStart).toBe(3.5);
    expect(dim.insideEnd).toBe(188.5);
    const labels = segmentedLabels(dim);
    expect(labels.overall).toBe("16'");
    expect(labels.startWall).toBe("3½\"");
    expect(labels.interior).toBe("15'5\"");
    expect(labels.endWall).toBe("3½\"");
  });

  test("2x6 width: 16' outside → 5½\" | 15'1\" | 5½\"", () => {
    const dim = buildSegmentedRoomDimension({
      orientation: "horizontal",
      outsideStart: 0,
      outsideEnd: 192,
      startWallThickness: 5.5,
      endWallThickness: 5.5,
    });
    expect(dim.interiorClearLength).toBe(181);
    expect(assertSegmentedInvariant(dim)).toBe(true);
    const labels = segmentedLabels(dim);
    expect(labels.overall).toBe("16'");
    expect(labels.startWall).toBe("5½\"");
    expect(labels.interior).toBe("15'1\"");
    expect(labels.endWall).toBe("5½\"");
  });

  test("unequal wall thicknesses", () => {
    const dim = buildSegmentedRoomDimension({
      orientation: "horizontal",
      outsideStart: 0,
      outsideEnd: 192,
      startWallThickness: 3.5,
      endWallThickness: 5.5,
    });
    expect(dim.interiorClearLength).toBe(183);
    expect(assertSegmentedInvariant(dim)).toBe(true);
    const labels = segmentedLabels(dim);
    expect(labels.startWall).toBe("3½\"");
    expect(labels.interior).toBe("15'3\"");
    expect(labels.endWall).toBe("5½\"");
  });

  test("2x4 height: 11'10\" outside → 3½\" | 11'3\" | 3½\"", () => {
    const dim = buildSegmentedRoomDimension({
      orientation: "vertical",
      outsideStart: 0,
      outsideEnd: 142,
      startWallThickness: 3.5,
      endWallThickness: 3.5,
    });
    expect(dim.overallLength).toBe(142);
    expect(dim.interiorClearLength).toBe(135);
    expect(assertSegmentedInvariant(dim)).toBe(true);
    const labels = segmentedLabels(dim);
    expect(labels.overall).toBe("11'10\"");
    expect(labels.startWall).toBe("3½\"");
    expect(labels.interior).toBe("11'3\"");
    expect(labels.endWall).toBe("3½\"");
  });

  test("WALL + INTERIOR + WALL always equals OVERALL", () => {
    const cases = [
      [192, 3.5, 3.5],
      [192, 5.5, 5.5],
      [192, 3.5, 5.5],
      [144, 3.5, 3.5],
      [142, 3.5, 3.5],
      [120, 5.5, 3.5],
    ];
    cases.forEach(([overall, startT, endT]) => {
      const dim = buildSegmentedRoomDimension({
        orientation: "horizontal",
        outsideStart: 10,
        outsideEnd: 10 + overall,
        startWallThickness: startT,
        endWallThickness: endT,
      });
      expect(assertSegmentedInvariant(dim)).toBe(true);
      expect(dim.startWallThickness + dim.interiorClearLength + dim.endWallThickness).toBeCloseTo(dim.overallLength, 2);
    });
  });

  test("segmented dims derive from room + owned wall faces", () => {
    const room = createRoomFromOutsideBounds("Test", 24, 36, 24 + 192, 36 + 142);
    const walls = wallsFromRoom(room);
    // Make east wall 2x6 while west stays 2x4
    const patched = walls.map((w) => (w.room_side === "east" ? { ...w, thickness: 5.5 } : w));
    const level = { rooms: [room], walls: patched };
    const widthDim = segmentedWidthForRoom(level, room);
    expect(widthDim.startWallThickness).toBe(3.5);
    expect(widthDim.endWallThickness).toBe(5.5);
    expect(widthDim.interiorClearLength).toBe(183);
    expect(widthDim.outsideStart).toBe(24);
    expect(widthDim.outsideEnd).toBe(216);
    expect(widthDim.insideStart).toBe(27.5);
    expect(widthDim.insideEnd).toBe(210.5);
    expect(assertSegmentedInvariant(widthDim)).toBe(true);

    const depthDim = segmentedDepthForRoom(level, room);
    expect(depthDim.overallLength).toBe(142);
    expect(depthDim.interiorClearLength).toBe(135);
    expect(assertSegmentedInvariant(depthDim)).toBe(true);
  });

  test("format helpers", () => {
    expect(formatArchInches(3.5)).toBe("3½\"");
    expect(formatArchInches(5.5)).toBe("5½\"");
    expect(formatArchInches(7.25)).toBe("7¼\"");
    expect(formatFtInTight(185)).toBe("15'5\"");
    expect(formatFtInTight(142)).toBe("11'10\"");
  });
});
