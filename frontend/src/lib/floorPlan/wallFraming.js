/**
 * Wall framing anatomy — ONE coordinated wall system.
 *
 * Pipeline:
 *   Wall → sorted openings → RO extents → support zones (from recommendLvl)
 *   → reconcile neighbors → wall-wide stud datum → members → conflicts → render
 *
 * Header sizing ALWAYS comes from recommendLvl (existing engine). Never invent loads here.
 */

import { inches, round2 } from "./units";
import { recommendLvl } from "./lvl";
import {
  OPENING_CATEGORY,
  classifyOpening,
  computeAutoRoughOpening,
} from "./openingSpec";

/** Nominal plate / stud face width (inches). */
export const STUD_FACE = 1.5;
export const PLATE_THICKNESS = 1.5;
export const DEFAULT_STUD_SPACING = 16;

export const CONFLICT_STATUS = {
  VALID: "VALID",
  TIGHT: "TIGHT_BUT_VALID",
  REVIEW: "ENGINEERING_REVIEW_REQUIRED",
  INVALID: "INVALID_INSUFFICIENT_SPACE",
  RO_OVERLAP: "INVALID_RO_OVERLAP",
};

/**
 * Resolve stud size from wall thickness / plumbing (canonical inference).
 * 2x6 when plumbing or thickness ≥ 5.5; else 2x4.
 */
export function resolveStudSpec(wall = {}) {
  const thick = inches(wall.thickness);
  const plumbing = Boolean(wall.plumbing);
  const is2x6 = plumbing || thick >= 5.5 || (wall.stud_size === "2x6");
  const nominal = is2x6 ? "2x6" : "2x4";
  const depth = is2x6 ? 5.5 : 3.5;
  const spacing = Math.max(12, inches(wall.stud_spacing) || DEFAULT_STUD_SPACING);
  return {
    nominal,
    face: STUD_FACE,
    depth,
    spacing,
    label: `${nominal} @ ${spacing}" O.C.`,
  };
}

/**
 * PT bottom plate only when explicitly foundation-contact.
 * Do NOT infer solely from exterior kind.
 */
export function resolveBottomPlateTreatment(wall = {}, foundation = "") {
  if (wall.foundation_contact === true) return "pressure-treated";
  if (wall.foundation_contact === false) return "standard";
  if (wall.bottom_plate_treatment === "pressure-treated") return "pressure-treated";
  if (wall.bottom_plate_treatment === "standard") return "standard";
  void foundation;
  return "standard";
}

/** Rough opening geometry for framing (not finished unit size). */
export function openingRoughGeometry(opening = {}, wall = {}) {
  const category = classifyOpening(opening, wall);
  const finishedW = Math.max(1, inches(opening.width) || 32);
  const finishedH = Math.max(1, inches(opening.height) || 80);
  let roW = inches(opening.rough_opening_width);
  let roH = inches(opening.rough_opening_height);
  const mode = opening.rough_opening_mode || "auto";

  if (opening.type === "cased") {
    roW = finishedW;
    roH = finishedH || Math.max(12, inches(wall.height) - PLATE_THICKNESS * 3);
  } else if (mode === "auto" || !(roW > 0) || !(roH > 0)) {
    const auto = computeAutoRoughOpening(
      finishedW,
      finishedH,
      category === OPENING_CATEGORY.CASED ? OPENING_CATEGORY.WINDOW : category,
      opening,
    );
    if (!(roW > 0) || mode === "auto") roW = auto.width;
    if (!(roH > 0) || mode === "auto") roH = auto.height;
  }

  roW = Math.max(finishedW, round2(roW));
  roH = Math.max(12, round2(roH));

  const finishedStart = inches(opening.offset);
  const center = finishedStart + finishedW / 2;
  const roStart = round2(center - roW / 2);

  const isDoor = opening.type === "door" || opening.type === "cased";
  const isWindow = opening.type === "window";
  const sillAboveFloor = isWindow
    ? (inches(opening.sill_height_above_floor ?? opening.sill) || 36)
    : 0;
  const roBottom = isWindow ? sillAboveFloor : 0;
  const roTop = round2(roBottom + roH);

  return {
    openingId: opening.id,
    type: opening.type || "door",
    category,
    finishedWidth: finishedW,
    finishedHeight: finishedH,
    finishedStart,
    roWidth: roW,
    roHeight: roH,
    roStart,
    roEnd: round2(roStart + roW),
    roBottom,
    roTop,
    isDoor,
    isWindow,
    cutBottomPlate: isDoor && opening.type !== "cased" ? true : opening.type === "door",
  };
}

/**
 * Assign stable human plan labels (D01, W01, …) by type + wall-local order.
 * Prefer opening.plan_label / schedule_id when already set.
 */
export function assignOpeningPlanLabels(openings = []) {
  const list = [...(openings || [])].sort((a, b) => inches(a.offset) - inches(b.offset));
  const counters = { door: 0, window: 0, cased: 0, other: 0 };
  const map = {};
  list.forEach((op) => {
    const existing = String(op.plan_label || op.schedule_id || op.tag || "").trim();
    if (existing) {
      map[op.id] = existing.toUpperCase();
      return;
    }
    const kind = op.type === "window" ? "window"
      : op.type === "door" ? "door"
        : op.type === "cased" ? "cased"
          : "other";
    counters[kind] += 1;
    const n = String(counters[kind]).padStart(2, "0");
    const prefix = kind === "window" ? "W" : kind === "door" ? "D" : kind === "cased" ? "C" : "O";
    map[op.id] = `${prefix}${n}`;
  });
  return map;
}

export function shortHeaderLabel(rec) {
  if (!rec) return "HEADER";
  if (rec.engineer_required) return "ENG. REVIEW";
  const raw = String(rec.label || "");
  // "Twin 2x8 SPF #2 header" → "Twin 2x8"
  let s = raw.replace(/\s+header$/i, "").replace(/\s+SPF.*$/i, "").trim();
  if (rec.header_kind === "dimensional" && rec.plies && rec.product) {
    const twin = rec.plies === 2 ? "Twin" : rec.plies === 3 ? "Triple" : "Single";
    s = `${twin} ${rec.product}`;
  }
  if (rec.header_kind === "lvl" && !rec.engineer_required) {
    s = raw.replace(/\s*2\.0E.*$/i, "").trim() || s;
  }
  return s || "HEADER";
}

function memberId(role, key) {
  return `${role}-${key}`;
}

function headerRecForAsm(wall, opening, rg, headerDefaults, ov) {
  const span_in = Math.max(12, inches(ov.header_span) || rg.roWidth);
  const tributary_in = Math.max(24, inches(ov.header_trib ?? headerDefaults.header_trib) || 144);
  const above = ov.header_above || headerDefaults.header_above || "bedroom";
  const stories_above = Number(ov.header_stories ?? headerDefaults.header_stories ?? 1);
  const bearing = wall?.bearing ?? wall?.kind === "exterior";

  let rec;
  if (bearing === false && wall?.kind === "interior" && !opening.header_engineering) {
    rec = recommendLvl({
      span_in,
      tributary_in: Math.min(tributary_in, 48),
      wall_kind: "interior",
      wall_thickness: wall?.thickness,
      above: "empty",
      stories_above: 0,
    });
  } else {
    rec = recommendLvl({
      span_in,
      tributary_in,
      wall_kind: wall?.kind === "exterior" ? "exterior" : "interior",
      wall_thickness: wall?.thickness,
      above,
      stories_above,
    });
  }
  return { rec, span_in, tributary_in, above, stories_above };
}

/**
 * Build OpeningSupportZone from RO + existing header-engineering jack/king counts.
 */
export function buildSupportZone(rg, stud, rec, planLabel) {
  const jacks = Math.max(1, Number(rec.jack_studs) || 1);
  const kings = Math.max(1, Number(rec.king_studs) || 1);
  const requiredLeftWidth = round2((jacks + kings) * stud.face);
  const requiredRightWidth = requiredLeftWidth;
  return {
    openingId: rg.openingId,
    planLabel,
    type: rg.type,
    isDoor: rg.isDoor,
    isWindow: rg.isWindow,
    roughStart: rg.roStart,
    roughEnd: rg.roEnd,
    leftJackCount: jacks,
    rightJackCount: jacks,
    leftKingCount: kings,
    rightKingCount: kings,
    requiredLeftWidth,
    requiredRightWidth,
    supportLeftStart: round2(rg.roStart - requiredLeftWidth),
    supportRightEnd: round2(rg.roEnd + requiredRightWidth),
    jacks,
    kings,
  };
}

/**
 * Reconcile neighboring support zones using RO edges + required pack widths.
 * Does NOT invent shared kings/jacks — classifies geometry only.
 */
export function reconcileAdjacentSupportZones(zones = [], studFace = STUD_FACE) {
  const sorted = [...zones].sort((a, b) => a.roughStart - b.roughStart);
  const conflicts = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const clearWallBetween = round2(cur.roughStart - prev.roughEnd);
    const requiredSupport = round2(prev.requiredRightWidth + cur.requiredLeftWidth);

    if (clearWallBetween < -0.05) {
      conflicts.push({
        type: "ro-overlap",
        status: CONFLICT_STATUS.RO_OVERLAP,
        openingIds: [prev.openingId, cur.openingId],
        planLabels: [prev.planLabel, cur.planLabel],
        available: clearWallBetween,
        required: requiredSupport,
        shortBy: round2(Math.abs(clearWallBetween) + requiredSupport),
        message: `${prev.planLabel} ↔ ${cur.planLabel}`,
        detail: `Rough openings overlap by ${formatInches(Math.abs(clearWallBetween))}.`,
      });
      continue;
    }

    if (clearWallBetween + 0.05 >= requiredSupport) {
      // VALID — enough clear wall for both independent packs
      continue;
    }

    const shortBy = round2(requiredSupport - clearWallBetween);
    // Packs touch / nearly touch within one stud face — tight but physically placeable as abutting packs
    if (shortBy <= studFace + 0.05) {
      conflicts.push({
        type: "framing-tight",
        status: CONFLICT_STATUS.TIGHT,
        openingIds: [prev.openingId, cur.openingId],
        planLabels: [prev.planLabel, cur.planLabel],
        available: clearWallBetween,
        required: requiredSupport,
        shortBy,
        message: `${prev.planLabel} ↔ ${cur.planLabel}`,
        detail: `Only ${formatInches(clearWallBetween)} between rough openings; support packs abut (${formatInches(requiredSupport)} required).`,
        severity: "warn",
      });
      continue;
    }

    conflicts.push({
      type: "framing-overlap",
      status: CONFLICT_STATUS.INVALID,
      openingIds: [prev.openingId, cur.openingId],
      planLabels: [prev.planLabel, cur.planLabel],
      available: clearWallBetween,
      required: requiredSupport,
      shortBy,
      message: `${prev.planLabel} ↔ ${cur.planLabel}`,
      detail: `Only ${formatInches(clearWallBetween)} of wall is available between these rough openings. Calculated support framing requires ${formatInches(requiredSupport)}. Short by ${formatInches(shortBy)}.`,
      severity: "error",
    });
  }
  return { zones: sorted, conflicts };
}

function formatInches(n) {
  const v = round2(Math.abs(Number(n) || 0));
  if (Math.abs(v - Math.round(v)) < 0.05) return `${Math.round(v)}"`;
  return `${v}"`;
}

/**
 * Build derived framing members for a wall elevation as ONE coordinated system.
 */
export function buildWallFraming({
  wall,
  length: lengthIn,
  openings = [],
  foundation = "",
  headerDefaults = {},
  openingHeaderOverrides = {},
} = {}) {
  const length = Math.max(24, inches(lengthIn ?? wall?.length) || 120);
  const height = Math.max(48, inches(wall?.height) || 96);
  const stud = resolveStudSpec(wall);
  const plateTreatment = resolveBottomPlateTreatment(wall, foundation);
  const plateThick = PLATE_THICKNESS;
  const doubleTop = plateThick * 2;
  const studLength = round2(height - doubleTop - plateThick);
  const members = [];
  const openingFrames = [];
  const wallId = wall?.id || "wall";
  const species = "SPF #2";

  const planLabels = assignOpeningPlanLabels(openings);

  // PHASE 1 — Sort openings, build canonical RO intervals
  const roughList = (openings || [])
    .map((op) => openingRoughGeometry(op, wall))
    .sort((a, b) => a.roStart - b.roStart);

  // Double top plates
  members.push({
    id: memberId("top-plate", "1"),
    wallId,
    role: "top-plate",
    nominalSize: stud.nominal,
    face: stud.face,
    depth: stud.depth,
    species,
    treatment: "standard",
    length,
    x: 0,
    y: height - plateThick,
    w: length,
    h: plateThick,
    label: "TOP PLATE #1",
    ply: 1,
  });
  members.push({
    id: memberId("top-plate", "2"),
    wallId,
    role: "top-plate",
    nominalSize: stud.nominal,
    face: stud.face,
    depth: stud.depth,
    species,
    treatment: "standard",
    length,
    x: 0,
    y: height - doubleTop,
    w: length,
    h: plateThick,
    label: "TOP PLATE #2",
    ply: 2,
  });

  // Bottom plate segments (interrupted at doors)
  const doorCuts = roughList
    .filter((rg) => rg.cutBottomPlate)
    .map((rg) => ({ start: Math.max(0, rg.roStart), end: Math.min(length, rg.roEnd) }))
    .filter((c) => c.end > c.start)
    .sort((a, b) => a.start - b.start);
  {
    let x0 = 0;
    const segs = [];
    doorCuts.forEach((c) => {
      if (c.start > x0 + 0.05) segs.push({ x: x0, w: round2(c.start - x0) });
      x0 = Math.max(x0, c.end);
    });
    if (x0 < length - 0.05) segs.push({ x: x0, w: round2(length - x0) });
    if (!segs.length) segs.push({ x: 0, w: length });
    segs.forEach((seg, i) => {
      members.push({
        id: memberId("bottom-plate", String(i)),
        wallId,
        role: "bottom-plate",
        nominalSize: stud.nominal,
        face: stud.face,
        depth: stud.depth,
        species,
        treatment: plateTreatment,
        length: seg.w,
        x: seg.x,
        y: 0,
        w: seg.w,
        h: plateThick,
        label: plateTreatment === "pressure-treated" ? `PT ${stud.nominal} BOTTOM PLATE` : "BOTTOM / SOLE PLATE",
      });
    });
  }

  // PHASE 2 — Support zones from EXISTING header engineering
  const assemblies = [];
  const zones = [];
  roughList.forEach((rg) => {
    const opening = (openings || []).find((o) => o.id === rg.openingId) || {};
    const ov = openingHeaderOverrides[rg.openingId] || opening.header_engineering || {};
    const { rec, span_in, tributary_in, above, stories_above } = headerRecForAsm(
      wall, opening, rg, headerDefaults, ov,
    );
    const planLabel = planLabels[rg.openingId] || rg.openingId;
    const zone = buildSupportZone(rg, stud, rec, planLabel);
    zones.push(zone);

    const headerDepth = Math.max(3.5, inches(rec.depth_in) || 9.25);
    const headerBottom = rg.roTop;
    const headerTop = round2(Math.min(height - doubleTop, headerBottom + headerDepth));

    assemblies.push({
      ...rg,
      ...zone,
      planLabel,
      rec,
      asmStart: zone.supportLeftStart,
      asmEnd: zone.supportRightEnd,
      packLeft: zone.requiredLeftWidth,
      packRight: zone.requiredRightWidth,
      headerBottom,
      headerTop,
      headerDepth: round2(headerTop - headerBottom),
      span_in,
      tributary_in,
      above,
      stories_above,
      sillThickness: rg.isWindow ? plateThick : 0,
      headerShort: shortHeaderLabel(rec),
    });
  });

  // PHASE 3 — Reconcile neighbors (real geometry, not independent package collision hacks)
  const { conflicts } = reconcileAdjacentSupportZones(zones, stud.face);

  // Occupancy map for intentional packs vs accidental duplicates
  // key = `${role}@${x}` for single studs; packs share openingId+side+role+idx
  const occupiedStudX = new Map(); // xRounded -> { role, openingId, side }

  const claimStudX = (x, role, openingId, side) => {
    const key = round2(x);
    const prev = occupiedStudX.get(key);
    if (prev && prev.openingId !== openingId && prev.role === role) {
      // Accidental duplicate at same station from neighboring generators — skip
      return false;
    }
    if (prev && prev.openingId === openingId && prev.role === role && prev.side === side) {
      return false;
    }
    occupiedStudX.set(key, { role, openingId, side });
    return true;
  };

  // PHASE 4/5 — Generate members from assemblies (coordinated occupancy)
  assemblies.forEach((asm) => {
    openingFrames.push(asm);
    const { jacks, kings, rec } = asm;

    // Kings (full height between plates) — outward from jack pack
    for (let i = 0; i < kings; i += 1) {
      const xL = round2(asm.roStart - (jacks + i + 1) * stud.face);
      const xR = round2(asm.roEnd + (jacks + i) * stud.face);
      [
        { x: xL, side: "left", idx: i },
        { x: xR, side: "right", idx: i },
      ].forEach(({ x, side, idx }) => {
        if (x < -0.5 || x + stud.face > length + 0.5) return;
        if (!claimStudX(x, "king-stud", asm.openingId, side)) return;
        members.push({
          id: memberId("king-stud", `${asm.openingId}-${side}-${idx}`),
          wallId,
          openingId: asm.openingId,
          planLabel: asm.planLabel,
          role: "king-stud",
          side,
          packIndex: idx,
          packCount: kings,
          nominalSize: stud.nominal,
          face: stud.face,
          depth: stud.depth,
          species,
          treatment: "standard",
          length: studLength,
          x: Math.max(0, x),
          y: plateThick,
          w: stud.face,
          h: studLength,
          label: kings > 1 ? `${kings} KINGS` : "KING STUD",
        });
      });
    }

    // Jacks (support header)
    const jackBottom = asm.cutBottomPlate ? 0 : plateThick;
    const jackTop = asm.headerBottom;
    const jackLen = round2(Math.max(0, jackTop - jackBottom));
    for (let i = 0; i < jacks; i += 1) {
      const xL = round2(asm.roStart - (i + 1) * stud.face);
      const xR = round2(asm.roEnd + i * stud.face);
      [
        { x: xL, side: "left", idx: i },
        { x: xR, side: "right", idx: i },
      ].forEach(({ x, side, idx }) => {
        if (!claimStudX(x, "jack-stud", asm.openingId, side)) return;
        members.push({
          id: memberId("jack-stud", `${asm.openingId}-${side}-${idx}`),
          wallId,
          openingId: asm.openingId,
          planLabel: asm.planLabel,
          role: "jack-stud",
          side,
          packIndex: idx,
          packCount: jacks,
          nominalSize: stud.nominal,
          face: stud.face,
          depth: stud.depth,
          species,
          treatment: "standard",
          length: jackLen,
          x: Math.max(0, x),
          y: jackBottom,
          w: stud.face,
          h: jackLen,
          label: jacks > 1 ? `${jacks} JACKS` : "JACK / TRIMMER",
        });
      });
    }

    // Header plies
    const plies = Math.max(1, Number(rec.plies) || 2);
    const plyFace = rec.header_kind === "lvl" ? 1.75 : STUD_FACE;
    for (let p = 0; p < plies; p += 1) {
      const plyH = round2(asm.headerDepth / plies);
      members.push({
        id: memberId("header", `${asm.openingId}-p${p}`),
        wallId,
        openingId: asm.openingId,
        planLabel: asm.planLabel,
        role: "header",
        nominalSize: rec.product === "lvl" ? "LVL" : rec.product,
        face: plyFace,
        depth: stud.depth,
        species: rec.species,
        treatment: "standard",
        length: asm.roWidth,
        x: asm.roStart,
        y: round2(asm.headerBottom + p * plyH),
        w: asm.roWidth,
        h: plyH,
        label: asm.headerShort,
        fullLabel: rec.label,
        header_kind: rec.header_kind,
        engineer_required: rec.engineer_required,
        ply: p + 1,
        plies,
        rec,
      });
    }

    // Window sill + lower cripples (doors: none)
    if (asm.isWindow) {
      members.push({
        id: memberId("window-sill", asm.openingId),
        wallId,
        openingId: asm.openingId,
        planLabel: asm.planLabel,
        role: "window-sill",
        nominalSize: stud.nominal,
        face: stud.face,
        depth: stud.depth,
        species,
        treatment: "standard",
        length: asm.roWidth,
        x: asm.roStart,
        y: round2(asm.roBottom - asm.sillThickness),
        w: asm.roWidth,
        h: asm.sillThickness,
        label: "WINDOW SILL",
      });

      const crippleTop = round2(asm.roBottom - asm.sillThickness);
      const crippleBottom = plateThick;
      const crippleLen = round2(Math.max(0, crippleTop - crippleBottom));
      if (crippleLen > 0.5) {
        const crippleXs = wallStudCentersInRange(length, stud.spacing, stud.face, asm.roStart, asm.roEnd);
        crippleXs.forEach((cx, idx) => {
          const x = round2(cx - stud.face / 2);
          members.push({
            id: memberId("cripple", `${asm.openingId}-lo-${idx}`),
            wallId,
            openingId: asm.openingId,
            planLabel: asm.planLabel,
            role: "cripple",
            zone: "below",
            nominalSize: stud.nominal,
            face: stud.face,
            depth: stud.depth,
            species,
            treatment: "standard",
            length: crippleLen,
            x,
            y: crippleBottom,
            w: stud.face,
            h: crippleLen,
            label: "CRIPPLE",
            centerline: round2(cx),
          });
        });
      }
    }

    // Upper cripples (header to top plates) — wall-wide stud datum through RO
    const upperBottom = asm.headerTop;
    const upperTop = height - doubleTop;
    const upperLen = round2(Math.max(0, upperTop - upperBottom));
    if (upperLen > 0.75) {
      const crippleXs = wallStudCentersInRange(length, stud.spacing, stud.face, asm.roStart, asm.roEnd);
      crippleXs.forEach((cx, idx) => {
        members.push({
          id: memberId("cripple", `${asm.openingId}-hi-${idx}`),
          wallId,
          openingId: asm.openingId,
          planLabel: asm.planLabel,
          role: "cripple",
          zone: "above",
          nominalSize: stud.nominal,
          face: stud.face,
          depth: stud.depth,
          species,
          treatment: "standard",
          length: upperLen,
          x: round2(cx - stud.face / 2),
          y: upperBottom,
          w: stud.face,
          h: upperLen,
          label: "CRIPPLE",
          centerline: round2(cx),
        });
      });
    }

    // Opening void marker
    members.push({
      id: memberId("opening", asm.openingId),
      wallId,
      openingId: asm.openingId,
      planLabel: asm.planLabel,
      role: "opening",
      type: asm.type,
      isDoor: asm.isDoor,
      isWindow: asm.isWindow,
      x: asm.roStart,
      y: asm.roBottom,
      w: asm.roWidth,
      h: asm.roHeight,
      label: asm.isWindow ? "WINDOW RO" : asm.type === "cased" ? "CASED RO" : "DOOR RO",
      rec,
    });
  });

  // PHASE 4 continued — ONE wall-wide stud grid for common studs
  const supportBlocked = assemblies.map((a) => ({ start: a.asmStart, end: a.asmEnd }));
  const roBlocked = assemblies.map((a) => ({ start: a.roStart, end: a.roEnd }));
  const centers = layoutStudCenters(length, stud.spacing, stud.face);
  centers.forEach((cx, idx) => {
    if (supportBlocked.some((b) => cx >= b.start - 0.05 && cx <= b.end + 0.05)) return;
    if (roBlocked.some((b) => cx > b.start + 0.05 && cx < b.end - 0.05)) return;
    const x = round2(cx - stud.face / 2);
    // Skip if a king already occupies this station
    if (occupiedStudX.has(round2(x))) return;
    members.push({
      id: memberId("common-stud", String(idx)),
      wallId,
      role: "common-stud",
      nominalSize: stud.nominal,
      face: stud.face,
      depth: stud.depth,
      species,
      treatment: "standard",
      length: studLength,
      x,
      y: plateThick,
      w: stud.face,
      h: studLength,
      label: "COMMON STUD",
      centerline: round2(cx),
      spacing: stud.spacing,
    });
  });

  const summary = summarizeFraming(members, assemblies, stud, length, plateTreatment);

  return {
    wallId,
    length,
    height,
    stud,
    plateTreatment,
    members,
    openings: openingFrames,
    supportZones: zones,
    conflicts,
    planLabels,
    summary,
    studLength,
  };
}

/** Wall-wide O.C. centers that fall inside [start, end]. */
export function wallStudCentersInRange(length, spacing, face, start, end) {
  const all = layoutStudCenters(length, spacing, face);
  const inside = all.filter((cx) => cx >= start + face * 0.25 && cx <= end - face * 0.25);
  if (inside.length) return inside;
  return [round2((start + end) / 2)];
}

export function layoutStudCenters(length, spacing, face) {
  const first = face / 2;
  const last = length - face / 2;
  const out = [round2(first)];
  if (last - first < 0.5) return out;
  let x = first + spacing;
  while (x < last - 0.25) {
    out.push(round2(x));
    x += spacing;
  }
  if (Math.abs(out[out.length - 1] - last) > 0.4) out.push(round2(last));
  return out;
}

export function summarizeFraming(members, assemblies, stud, length, plateTreatment) {
  const count = (role) => members.filter((m) => m.role === role).length;
  const headers = (assemblies || []).map((a) => ({
    openingId: a.openingId,
    planLabel: a.planLabel,
    type: a.type,
    label: a.rec?.label,
    shortLabel: a.headerShort,
    header_kind: a.rec?.header_kind,
    jack_studs: a.jacks,
    king_studs: a.kings,
  }));
  return {
    commonStuds: count("common-stud"),
    kingStuds: count("king-stud"),
    jackStuds: count("jack-stud"),
    cripples: count("cripple"),
    windowSills: count("window-sill"),
    topPlateLf: round2(length * 2),
    bottomPlateLf: round2(
      members.filter((m) => m.role === "bottom-plate").reduce((s, m) => s + (m.length || m.w || 0), 0),
    ),
    bottomPlateTreatment: plateTreatment,
    studNominal: stud.nominal,
    studSpacing: stud.spacing,
    headers,
  };
}

/** Header recommendation for a selected opening — ALWAYS via recommendLvl. */
export function headerRecForOpening(wall, opening, headerDefaults = {}, override = {}) {
  const rg = openingRoughGeometry(opening, wall);
  const span_in = Math.max(12, inches(override.header_span) || rg.roWidth);
  return {
    rough: rg,
    rec: recommendLvl({
      span_in,
      tributary_in: Math.max(24, inches(override.header_trib ?? headerDefaults.header_trib) || 144),
      wall_kind: wall?.kind === "exterior" ? "exterior" : "interior",
      wall_thickness: wall?.thickness,
      above: override.header_above || headerDefaults.header_above || "bedroom",
      stories_above: Number(override.header_stories ?? headerDefaults.header_stories ?? 1),
    }),
  };
}
