import { recommendLvl } from "./lvl";
import {
  assignOpeningPlanLabels,
  buildWallFraming,
  CONFLICT_STATUS,
  openingRoughGeometry,
  reconcileAdjacentSupportZones,
  resolveBottomPlateTreatment,
  resolveStudSpec,
  shortHeaderLabel,
} from "./wallFraming";
import { emptyOpening, emptyWall } from "./model";
import { normalizeDoorSpec, doorSpecToOpeningPatch } from "./doorSpec";
import { normalizeWindowSpec, windowSpecToOpeningPatch } from "./openingSpec";

describe("wallFraming anatomy", () => {
  test("blank 12' 2x4 wall — plates + common studs, no headers", () => {
    const wall = { ...emptyWall(0, 0, 144, 0, "interior"), thickness: 4.5, height: 96, stud_spacing: 16 };
    const framing = buildWallFraming({ wall, length: 144, openings: [] });
    expect(framing.members.filter((m) => m.role === "top-plate")).toHaveLength(2);
    expect(framing.members.filter((m) => m.role === "bottom-plate").length).toBeGreaterThanOrEqual(1);
    expect(framing.members.some((m) => m.role === "header")).toBe(false);
    expect(framing.members.some((m) => m.role === "king-stud")).toBe(false);
    expect(framing.summary.commonStuds).toBeGreaterThan(5);
    expect(framing.stud.nominal).toBe("2x4");
    expect(framing.stud.depth).toBe(3.5);
    expect(framing.plateTreatment).toBe("standard");
  });

  test("foundation contact → PT bottom plate only", () => {
    const wall = { ...emptyWall(0, 0, 144, 0, "exterior"), foundation_contact: true };
    expect(resolveBottomPlateTreatment(wall)).toBe("pressure-treated");
    expect(resolveBottomPlateTreatment({ ...wall, foundation_contact: false, kind: "exterior" })).toBe("standard");
    const framing = buildWallFraming({ wall, length: 144, openings: [] });
    const bottoms = framing.members.filter((m) => m.role === "bottom-plate");
    expect(bottoms.every((b) => b.treatment === "pressure-treated")).toBe(true);
    expect(framing.members.filter((m) => m.role === "common-stud").every((s) => s.treatment === "standard")).toBe(true);
  });

  test("2x6 exterior stud depth differs from 2x4", () => {
    expect(resolveStudSpec({ thickness: 6 }).nominal).toBe("2x6");
    expect(resolveStudSpec({ thickness: 6 }).depth).toBe(5.5);
    expect(resolveStudSpec({ thickness: 4.5 }).depth).toBe(3.5);
  });

  test("exterior door uses RO width+1.5 / height+2 for framing", () => {
    const door = doorSpecToOpeningPatch(normalizeDoorSpec({
      ...emptyOpening("door"),
      width: 32,
      height: 80,
      offset: 40,
    }));
    door.id = "d1";
    door.offset = 40;
    const rough = openingRoughGeometry(door, { kind: "exterior" });
    expect(rough.roWidth).toBe(33.5);
    expect(rough.roHeight).toBe(82);
    expect(rough.roWidth).not.toBe(32);
  });

  test("window RO does not use exterior door formula", () => {
    const win = {
      ...windowSpecToOpeningPatch(normalizeWindowSpec({
        ...emptyOpening("window"),
        width: 36,
        height: 48,
        sill_height_above_floor: 36,
      })),
      id: "w1",
      offset: 60,
    };
    const rough = openingRoughGeometry(win, { kind: "exterior" });
    expect(rough.roWidth).toBe(37);
    expect(rough.roHeight).toBe(49);
    expect(rough.roBottom).toBe(36);
  });

  test("door framing creates kings, jacks, header matching recommendLvl", () => {
    const wall = { ...emptyWall(0, 0, 192, 0, "exterior"), thickness: 6, height: 96, bearing: true };
    const door = {
      ...doorSpecToOpeningPatch(normalizeDoorSpec({ width: 32, height: 80 })),
      id: "d1",
      offset: 48,
      type: "door",
    };
    const framing = buildWallFraming({
      wall,
      length: 192,
      openings: [door],
      headerDefaults: { header_trib: 144, header_above: "bedroom", header_stories: 1 },
    });
    const asm = framing.openings[0];
    const expected = recommendLvl({
      span_in: asm.roWidth,
      tributary_in: 144,
      wall_kind: "exterior",
      wall_thickness: 6,
      above: "bedroom",
      stories_above: 1,
    });
    expect(asm.rec.label).toBe(expected.label);
    expect(asm.jacks).toBe(expected.jack_studs);
    expect(asm.kings).toBe(expected.king_studs);
    const leftJacks = framing.members.filter((m) => m.role === "jack-stud" && m.openingId === "d1" && m.side === "left");
    const rightJacks = framing.members.filter((m) => m.role === "jack-stud" && m.openingId === "d1" && m.side === "right");
    expect(leftJacks).toHaveLength(expected.jack_studs);
    expect(rightJacks).toHaveLength(expected.jack_studs);
    expect(framing.members.some((m) => m.role === "header" && (m.fullLabel === expected.label || m.label))).toBe(true);
    expect(framing.members.some((m) => m.role === "common-stud" && m.centerline > asm.roStart && m.centerline < asm.roEnd)).toBe(false);
  });

  test("window framing includes sill and lower cripples; door does not", () => {
    const wall = { ...emptyWall(0, 0, 192, 0, "exterior"), thickness: 6, height: 96 };
    const win = {
      ...windowSpecToOpeningPatch(normalizeWindowSpec({
        width: 36,
        height: 48,
        sill_height_above_floor: 36,
      })),
      id: "w1",
      offset: 60,
      type: "window",
    };
    const framing = buildWallFraming({ wall, length: 192, openings: [win] });
    expect(framing.members.some((m) => m.role === "window-sill")).toBe(true);
    expect(framing.members.some((m) => m.role === "cripple" && m.zone === "below")).toBe(true);
    expect(framing.members.some((m) => m.role === "header")).toBe(true);
  });

  test("truly overlapping packs produce INVALID with available/required numbers — no UUIDs", () => {
    const wall = { ...emptyWall(0, 0, 120, 0, "exterior"), thickness: 6, height: 96 };
    const d1 = { ...doorSpecToOpeningPatch(normalizeDoorSpec({ width: 36, height: 80 })), id: "door-uuid-aaa", offset: 20, type: "door" };
    const d2 = { ...doorSpecToOpeningPatch(normalizeDoorSpec({ width: 36, height: 80 })), id: "door-uuid-bbb", offset: 40, type: "door" };
    const framing = buildWallFraming({ wall, length: 120, openings: [d1, d2] });
    expect(framing.conflicts.length).toBeGreaterThan(0);
    const c = framing.conflicts[0];
    expect([CONFLICT_STATUS.INVALID, CONFLICT_STATUS.RO_OVERLAP]).toContain(c.status);
    expect(c.planLabels).toEqual(["D01", "D02"]);
    expect(c.message).toMatch(/D01 ↔ D02/);
    expect(c.message).not.toMatch(/uuid|door-uuid/i);
    expect(c.available).toBeDefined();
    expect(c.required).toBeDefined();
    expect(String(c.detail || c.message)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
  });

  test("engineering input change updates header via same recommendLvl engine", () => {
    const wall = { ...emptyWall(0, 0, 192, 0, "exterior"), thickness: 6, height: 96 };
    const door = {
      ...doorSpecToOpeningPatch(normalizeDoorSpec({ width: 48, height: 80 })),
      id: "d1",
      offset: 40,
      type: "door",
    };
    const a = buildWallFraming({
      wall,
      length: 192,
      openings: [door],
      headerDefaults: { header_trib: 48, header_above: "empty", header_stories: 0 },
    });
    const b = buildWallFraming({
      wall,
      length: 192,
      openings: [door],
      headerDefaults: { header_trib: 192, header_above: "kitchen", header_stories: 2 },
    });
    expect(a.openings[0].rec.label).toBe(
      recommendLvl({
        span_in: a.openings[0].roWidth,
        tributary_in: 48,
        wall_kind: "exterior",
        wall_thickness: 6,
        above: "empty",
        stories_above: 0,
      }).label,
    );
    expect(b.openings[0].rec.label).toBe(
      recommendLvl({
        span_in: b.openings[0].roWidth,
        tributary_in: 192,
        wall_kind: "exterior",
        wall_thickness: 6,
        above: "kitchen",
        stories_above: 2,
      }).label,
    );
  });
});

describe("multi-opening coordinated wall — 14' W+D+W", () => {
  function buildFourteenFootWall(offsets = { w1: 12, d: 60, w2: 118 }) {
    const wall = {
      ...emptyWall(0, 0, 168, 0, "exterior"),
      id: "wall-14",
      thickness: 6,
      height: 96,
      stud_spacing: 16,
      bearing: true,
    };
    const w1 = {
      ...windowSpecToOpeningPatch(normalizeWindowSpec({
        width: 36,
        height: 48,
        sill_height_above_floor: 36,
      })),
      id: "win-left-uuid",
      offset: offsets.w1,
      type: "window",
    };
    const door = {
      ...doorSpecToOpeningPatch(normalizeDoorSpec({ width: 32, height: 80 })),
      id: "door-center-uuid",
      offset: offsets.d,
      type: "door",
    };
    const w2 = {
      ...windowSpecToOpeningPatch(normalizeWindowSpec({
        width: 36,
        height: 48,
        sill_height_above_floor: 40,
      })),
      id: "win-right-uuid",
      offset: offsets.w2,
      type: "window",
    };
    return {
      wall,
      openings: [w1, door, w2],
      framing: buildWallFraming({
        wall,
        length: 168,
        openings: [w1, door, w2],
        headerDefaults: { header_trib: 144, header_above: "bedroom", header_stories: 1 },
      }),
    };
  }

  test("sorted labels W01 D01 W02 — door has no sill/lower cripples", () => {
    const { framing } = buildFourteenFootWall();
    expect(framing.openings.map((o) => o.planLabel)).toEqual(["W01", "D01", "W02"]);
    expect(framing.openings[0].roStart).toBeLessThan(framing.openings[1].roStart);
    expect(framing.openings[1].roStart).toBeLessThan(framing.openings[2].roStart);

    const doorId = framing.openings.find((o) => o.planLabel === "D01").openingId;
    expect(framing.members.some((m) => m.role === "window-sill" && m.openingId === doorId)).toBe(false);
    expect(framing.members.some((m) => m.role === "cripple" && m.zone === "below" && m.openingId === doorId)).toBe(false);

    const w1 = framing.openings.find((o) => o.planLabel === "W01");
    const w2 = framing.openings.find((o) => o.planLabel === "W02");
    expect(framing.members.some((m) => m.role === "window-sill" && m.openingId === w1.openingId)).toBe(true);
    expect(framing.members.some((m) => m.role === "window-sill" && m.openingId === w2.openingId)).toBe(true);
    expect(w1.roBottom).toBe(36);
    expect(w2.roBottom).toBe(40);
  });

  test("adequately spaced 14' W+D+W has no INVALID false-positive conflicts", () => {
    // Generous spacing so independent packs fit without overlapping RO support zones
    const { framing } = buildFourteenFootWall({ w1: 8, d: 64, w2: 120 });
    const invalid = framing.conflicts.filter((c) => (
      c.status === CONFLICT_STATUS.INVALID || c.status === CONFLICT_STATUS.RO_OVERLAP
    ));
    // Report classification: with this spacing, packs should clear
    if (invalid.length) {
      // eslint-disable-next-line no-console
      console.log("UNEXPECTED INVALID", JSON.stringify(invalid, null, 2));
    }
    expect(invalid).toHaveLength(0);
    // No UUID leakage
    framing.conflicts.forEach((c) => {
      expect(c.message).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
    });
  });

  test("tight spacing reports real AVAILABLE vs REQUIRED — not duplicated-package noise", () => {
    const { framing } = buildFourteenFootWall({ w1: 10, d: 48, w2: 90 });
    const invalid = framing.conflicts.filter((c) => c.status === CONFLICT_STATUS.INVALID);
    expect(invalid.length).toBeGreaterThan(0);
    invalid.forEach((c) => {
      expect(c.available).toBeLessThan(c.required);
      expect(c.shortBy).toBeCloseTo(c.required - c.available, 5);
      expect(c.planLabels.every((l) => /^[WD]\d{2}$/.test(l))).toBe(true);
    });
  });

  test("bottom plate interrupted only at door RO", () => {
    const { framing } = buildFourteenFootWall({ w1: 8, d: 64, w2: 120 });
    const door = framing.openings.find((o) => o.planLabel === "D01");
    const bottoms = framing.members.filter((m) => m.role === "bottom-plate");
    expect(bottoms.length).toBeGreaterThanOrEqual(2);
    // No bottom plate segment covering the door RO mid-point
    const doorMid = door.roStart + door.roWidth / 2;
    expect(bottoms.some((b) => doorMid >= b.x && doorMid <= b.x + b.w)).toBe(false);
  });

  test("moving door regenerates coordinated framing (no stale studs at old offset)", () => {
    const a = buildFourteenFootWall({ w1: 8, d: 64, w2: 120 });
    const b = buildFourteenFootWall({ w1: 8, d: 48, w2: 120 });
    const doorA = a.framing.openings.find((o) => o.planLabel === "D01");
    const doorB = b.framing.openings.find((o) => o.planLabel === "D01");
    expect(doorB.roStart).toBeLessThan(doorA.roStart);
    // New jack pack tracks the new RO — left jacks sit immediately left of new roStart
    const leftJacksB = b.framing.members.filter((m) => (
      m.role === "jack-stud" && m.openingId === doorB.openingId && m.side === "left"
    ));
    expect(leftJacksB.length).toBeGreaterThan(0);
    leftJacksB.forEach((j) => {
      expect(j.x + j.w).toBeLessThanOrEqual(doorB.roStart + 0.05);
      expect(j.x + j.w).toBeGreaterThan(doorB.roStart - 8);
    });
    // Old RO left edge no longer hosts this door's left jacks
    const stale = leftJacksB.filter((j) => Math.abs((j.x + j.w) - doorA.roStart) < 0.2);
    expect(stale).toHaveLength(0);
  });

  test("removing one window drops its assembly members", () => {
    const { wall, openings } = buildFourteenFootWall({ w1: 8, d: 64, w2: 120 });
    const without = openings.filter((o) => o.type !== "window" || o.offset < 50);
    const framing = buildWallFraming({ wall, length: 168, openings: without });
    expect(framing.openings.map((o) => o.planLabel)).toEqual(["W01", "D01"]);
    expect(framing.members.filter((m) => m.role === "window-sill")).toHaveLength(1);
  });

  test("assignOpeningPlanLabels prefers existing plan_label", () => {
    const map = assignOpeningPlanLabels([
      { id: "a", type: "window", offset: 10, plan_label: "W99" },
      { id: "b", type: "door", offset: 40 },
    ]);
    expect(map.a).toBe("W99");
    expect(map.b).toBe("D01");
  });

  test("shortHeaderLabel is concise", () => {
    expect(shortHeaderLabel({ label: "Twin 2x8 SPF #2 header", header_kind: "dimensional", plies: 2, product: "2x8" })).toBe("Twin 2x8");
    expect(shortHeaderLabel({ engineer_required: true, label: "needs review" })).toBe("ENG. REVIEW");
  });

  test("reconcileAdjacentSupportZones VALID when clear ≥ required", () => {
    const { conflicts } = reconcileAdjacentSupportZones([
      {
        openingId: "a", planLabel: "W01", roughStart: 0, roughEnd: 36,
        requiredLeftWidth: 6, requiredRightWidth: 6,
      },
      {
        openingId: "b", planLabel: "D01", roughStart: 50, roughEnd: 84,
        requiredLeftWidth: 6, requiredRightWidth: 6,
      },
    ]);
    expect(conflicts).toHaveLength(0);
  });
});
