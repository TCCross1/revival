import { adviseElectrician, findPanel, homeRunPath, isElectricalObject } from "./electrician";
import { completeElectricalDesign, receptacleStations, switchKindForEntries, wireForAmps } from "./electricalDesign";
import { emptyLevel, emptyObject, emptyOpening, emptyRoom, wallsFromRoom } from "./model";
import { libraryById } from "./library";

function kitchenLevel() {
  const level = emptyLevel("1st Floor", 0);
  const room = emptyRoom("Kitchen", 24, 24, 180, 156);
  const walls = wallsFromRoom(room, "interior");
  walls[2].openings = [{ ...emptyOpening("door"), offset: 40, width: 32 }];
  walls[0].openings = [{ ...emptyOpening("cased"), offset: 20, width: 36 }];
  const can = libraryById("light-recessed");
  const light = { ...emptyObject(can, 80, 80), light_room_id: room.id };
  return {
    ...level,
    rooms: [room],
    walls,
    objects: [light],
  };
}

describe("Kentucky electrical design engine", () => {
  test("3-way vs 4-way from entry count", () => {
    expect(switchKindForEntries(1)).toBe("switch");
    expect(switchKindForEntries(2)).toBe("switch-3way");
    expect(switchKindForEntries(3)).toBe("switch-4way");
  });

  test("wire gauge matches breaker", () => {
    expect(wireForAmps(15).awg).toBe(14);
    expect(wireForAmps(20).awg).toBe(12);
    expect(wireForAmps(30).awg).toBe(10);
  });

  test("12-foot receptacle rule", () => {
    const pts = receptacleStations(168);
    expect(pts[0]).toBeLessThanOrEqual(72);
    expect(168 - pts[pts.length - 1]).toBeLessThanOrEqual(72.5);
  });

  test("complete design places GFCI, 3-ways, panel, and schedule", () => {
    const { level, report } = completeElectricalDesign(kitchenLevel(), { projectType: "Kitchen" });
    const ids = (level.objects || []).map((o) => o.library_id);
    expect(ids).toContain("outlet-gfci");
    expect(ids).toContain("panel");
    expect(ids.filter((id) => id === "switch-3way").length).toBeGreaterThanOrEqual(2);
    expect(report.circuits.length).toBeGreaterThanOrEqual(2);
    expect(report.circuits.some((c) => /Small Appliance/i.test(c.description))).toBe(true);
    expect(report.circuits.every((c) => c.amps && c.cable)).toBe(true);
    expect(level.electrical.disclaimer).toMatch(/Kentucky/i);
  });

  test("adviseElectrician still returns home-run guidance", () => {
    const gfci = libraryById("outlet-gfci");
    const obj = emptyObject(gfci, 40, 40);
    const advice = adviseElectrician(obj, { rooms: [emptyRoom("Kitchen")], projectType: "Kitchen" });
    expect(advice.gfci).toBe(true);
    expect(advice.amps).toBe(20);
    expect(findPanel([])).toBeFalsy();
    expect(homeRunPath(obj, obj).length).toBe(3);
    expect(isElectricalObject(obj)).toBe(true);
  });
});
