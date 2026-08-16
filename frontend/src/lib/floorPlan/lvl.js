import { inches, round2, uid } from "./units";
import { pointOnWall, wallLength } from "./model";

export const LVL_DISCLAIMER = "Preliminary – verify with a licensed engineer / local code.";
export const CASED_BEAM_MIN_IN = 36;
export const WIDE_DOOR_BEAM_MIN_IN = 36;
export const PLY_IN = 1.75;
export const LVL_DEPTHS = [5.5, 7.25, 9.25, 11.25, 14, 16, 18];
export const ABOVE_OPTIONS = [
  { id: "empty", name: "Empty / attic" },
  { id: "bedroom", name: "Bedroom" },
  { id: "bathroom", name: "Bathroom" },
  { id: "kitchen", name: "Kitchen" },
  { id: "living", name: "Living / hall" },
  { id: "roof", name: "Roof only" },
];

const OCC = {
  empty: { dl: 10, ll: 20 },
  bedroom: { dl: 12, ll: 40 },
  bathroom: { dl: 18, ll: 40 },
  kitchen: { dl: 18, ll: 40 },
  living: { dl: 12, ll: 40 },
  roof: { dl: 18, ll: 25 },
};

const FB = 2600;
const FV = 285;
const E = 2.0e6;
const CONSERVATIVE = 0.9;
const LOAD_BUMP = 1.15;

function occLoads(above) {
  return OCC[above] || OCC.bedroom;
}

export function needsBeamForOpening(opening) {
  const width = inches(opening?.width);
  const type = String(opening?.type || "");
  const style = String(opening?.style || "");
  if (style.includes("french") || Number(opening?.leafs) === 2) return width >= 36;
  if (type === "cased") return width >= CASED_BEAM_MIN_IN;
  if (type === "door") return width >= WIDE_DOOR_BEAM_MIN_IN;
  return false;
}

export function computeLoads({ span_in, tributary_in, wall_kind, above, stories_above }) {
  const spanIn = Math.max(inches(span_in), 12);
  const tribFt = Math.max(inches(tributary_in) / 12, 2);
  const stories = Math.max(0, Math.min(3, Number(stories_above) || 0));
  const exterior = wall_kind === "exterior";
  const kind = above || "bedroom";
  const occ = occLoads(kind === "roof" ? "roof" : kind);
  let floorPsf = 10;
  if (kind === "roof" && stories === 0) {
    floorPsf = 10;
  } else if (kind === "empty" && stories === 0 && !exterior) {
    floorPsf = occ.dl;
  } else {
    floorPsf = (occ.dl + occ.ll) * Math.max(stories, 1);
  }
  let roofPlf = 0;
  if (exterior || kind === "roof") {
    const roof = OCC.roof;
    roofPlf = (roof.dl + roof.ll) * tribFt * 0.55;
  }
  const wPlf = round2((floorPsf * tribFt + roofPlf) * LOAD_BUMP);
  const spanFt = spanIn / 12;
  const momentFtlb = round2((wPlf * spanFt * spanFt) / 8);
  const shearLb = round2((wPlf * spanFt) / 2);
  const liveShare = occ.ll / Math.max(occ.dl + occ.ll, 1);
  return {
    dead_psf: occ.dl,
    live_psf: occ.ll,
    floor_psf: round2(floorPsf),
    w_plf: wPlf,
    moment_ftlb: momentFtlb,
    shear_lb: shearLb,
    span_ft: round2(spanFt),
    tributary_ft: round2(tribFt),
    live_share: round2(liveShare),
  };
}

function sectionOk(plies, depth, loads) {
  const I = plies * ((PLY_IN * (depth ** 3)) / 12);
  const S = plies * ((PLY_IN * (depth ** 2)) / 6);
  const A = plies * PLY_IN * depth;
  const fb = (loads.moment_ftlb * 12) / Math.max(S, 0.01);
  const fv = (1.5 * loads.shear_lb) / Math.max(A, 0.01);
  const wPerIn = loads.w_plf / 12;
  const L = loads.span_ft * 12;
  const delta = (5 * wPerIn * (L ** 4)) / (384 * E * I);
  const deltaLive = delta * loads.live_share;
  const ok = fb <= FB * CONSERVATIVE && fv <= FV * CONSERVATIVE && delta <= L / 240 && deltaLive <= L / 360;
  return { ok, fb: round2(fb), fv: round2(fv), delta: round2(delta), I: round2(I), S: round2(S) };
}

export function jackStudsFor(spanIn, plies, exterior) {
  const ft = inches(spanIn) / 12;
  let jacks = 1;
  if (ft > 6) jacks = 2;
  if (ft > 10) jacks = 3;
  if (ft > 16) jacks = 4;
  if (plies >= 3 || ft > 14) jacks += 1;
  if (exterior) jacks += 1;
  return Math.min(jacks, 6);
}

export function recommendLvl(input) {
  const span_in = Math.max(inches(input.span_in), 12);
  const tributary_in = Math.max(inches(input.tributary_in) || 144, 24);
  const wall_kind = input.wall_kind === "exterior" ? "exterior" : "interior";
  const above = ABOVE_OPTIONS.some((o) => o.id === input.above) ? input.above : "bedroom";
  const stories_above = Math.max(0, Math.min(3, Number(input.stories_above) || 0));
  const loads = computeLoads({ span_in, tributary_in, wall_kind, above, stories_above });
  let pick = null;
  for (const plies of [1, 2, 3]) {
    for (const depth of LVL_DEPTHS) {
      const check = sectionOk(plies, depth, loads);
      if (!check.ok) continue;
      const score = plies * 10 + depth + (depth > 14 ? 6 : 0);
      if (!pick || score < pick.score) {
        pick = { plies, depth, score, ...check };
      }
    }
    if (pick && pick.plies === 1 && pick.depth <= 14) break;
  }
  const engineer = !pick;
  const plies = pick?.plies || 3;
  const depth = pick?.depth || 18;
  const jacks = jackStudsFor(span_in, plies, wall_kind === "exterior");
  const kings = wall_kind === "exterior" || span_in / 12 > 12 ? 2 : 1;
  const label = `${plies === 1 ? "Single" : plies === 2 ? "Double" : "Triple"} ${depth}" 2.0E LVL`;
  return {
    span_in: round2(span_in),
    tributary_in: round2(tributary_in),
    wall_kind,
    above,
    stories_above,
    loads,
    plies,
    depth_in: depth,
    width_in: round2(plies * PLY_IN),
    jack_studs: jacks,
    king_studs: kings,
    label,
    species: "2.0E 2600Fb LVL",
    engineer_required: engineer,
    disclaimer: LVL_DISCLAIMER,
    notes: engineer
      ? "This span/load is outside a conservative residential LVL chart. Do not proceed without an engineer."
      : `Use ${jacks} jack stud(s) and ${kings} king stud(s) each end. Bearing min 3" on each jack pack.`,
  };
}

export function emptyBeam(partial = {}) {
  const rec = recommendLvl({
    span_in: partial.span_in || 96,
    tributary_in: partial.tributary_in || 144,
    wall_kind: partial.wall_kind || "interior",
    above: partial.above || "bedroom",
    stories_above: partial.stories_above ?? 1,
  });
  return {
    id: uid(),
    wall_id: partial.wall_id || "",
    opening_id: partial.opening_id || "",
    x1: round2(partial.x1 || 0),
    y1: round2(partial.y1 || 0),
    x2: round2(partial.x2 || rec.span_in),
    y2: round2(partial.y2 || 0),
    ...rec,
  };
}

export function beamFromOpening(wall, opening, extras = {}) {
  const len = wallLength(wall);
  const start = Math.max(0, inches(opening.offset) / Math.max(len, 1));
  const end = Math.min(1, (inches(opening.offset) + inches(opening.width)) / Math.max(len, 1));
  const a = pointOnWall(wall, start);
  const b = pointOnWall(wall, end);
  return emptyBeam({
    wall_id: wall.id,
    opening_id: opening.id,
    x1: a.x,
    y1: a.y,
    x2: b.x,
    y2: b.y,
    span_in: inches(opening.width),
    tributary_in: extras.tributary_in,
    wall_kind: wall.kind === "exterior" ? "exterior" : "interior",
    above: extras.above,
    stories_above: extras.stories_above,
  });
}

export function beamFromWall(wall, extras = {}) {
  return emptyBeam({
    wall_id: wall.id,
    opening_id: "",
    x1: wall.x1,
    y1: wall.y1,
    x2: wall.x2,
    y2: wall.y2,
    span_in: wallLength(wall),
    tributary_in: extras.tributary_in,
    wall_kind: wall.kind === "exterior" ? "exterior" : "interior",
    above: extras.above,
    stories_above: extras.stories_above,
  });
}

export function refreshBeam(beam) {
  const rec = recommendLvl(beam);
  return { ...beam, ...rec, id: beam.id, wall_id: beam.wall_id, opening_id: beam.opening_id, x1: beam.x1, y1: beam.y1, x2: beam.x2, y2: beam.y2 };
}

export function syncOpeningBeams(level) {
  const kept = (level.beams || []).filter((beam) => !beam.opening_id);
  const next = [...kept];
  (level.walls || []).forEach((wall) => {
    (wall.openings || []).forEach((op) => {
      if (!needsBeamForOpening(op)) return;
      const prev = (level.beams || []).find((beam) => beam.opening_id === op.id);
      const created = beamFromOpening(wall, op, prev || { stories_above: 1 });
      next.push(prev ? refreshBeam({
        ...created,
        id: prev.id,
        tributary_in: prev.tributary_in,
        above: prev.above,
        stories_above: prev.stories_above,
      }) : created);
    });
  });
  return { ...level, beams: next };
}
