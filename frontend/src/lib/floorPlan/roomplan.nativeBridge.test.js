import { importRoomPlan, needsScanVerify, SCAN_VERIFY_NOTE } from "./roomplan";
import { emptyLevel } from "./model";
import nativeBridge from "./fixtures/roomplan_native_bridge.json";

describe("native RoomPlan bridge handoff", () => {
  it("places walls, openings, cabinets, and appliances marked for measurement check", () => {
    const level = importRoomPlan(nativeBridge, emptyLevel("LiDAR Scan", 0));
    expect(level.walls.length).toBe(4);
    expect(level.walls.every((wall) => needsScanVerify(wall))).toBe(true);

    const openingTypes = new Set(
      level.walls.flatMap((wall) => (wall.openings || []).map((opening) => opening.type)),
    );
    expect(openingTypes.has("door")).toBe(true);
    expect(openingTypes.has("window")).toBe(true);

    const ids = level.objects.map((obj) => obj.library_id);
    expect(ids.some((id) => id.startsWith("fridge-"))).toBe(true);
    expect(ids.some((id) => id.startsWith("range-"))).toBe(true);
    expect(ids.some((id) => id.startsWith("dw-"))).toBe(true);
    expect(ids.some((id) => id.startsWith("cab-sink-"))).toBe(true);
    expect(ids.some((id) => id.startsWith("cab-base-"))).toBe(true);
    expect(ids.some((id) => id.startsWith("cab-wall-"))).toBe(true);
    expect(ids.some((id) => id.startsWith("island"))).toBe(true);
    expect(level.objects.every((obj) => needsScanVerify(obj))).toBe(true);
    expect(level.objects.every((obj) => String(obj.note || "").includes(SCAN_VERIFY_NOTE))).toBe(true);
    expect(level.rooms.length).toBeGreaterThan(0);
  });
});
