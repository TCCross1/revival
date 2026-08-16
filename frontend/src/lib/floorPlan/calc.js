import { inches, round2 } from "./units";
import { wallLength } from "./model";

const DEFAULT_H = 96;

function roomSf(room) {
  return round2((inches(room.width) * inches(room.depth)) / 144);
}

function computeRoof(level) {
  const roofs = level.roofs || [];
  const rooms = level.rooms || [];
  let width;
  let depth;
  let rise = 6;
  let run = 12;
  let overhang = 12;
  let kind = "gable";
  if (roofs[0]) {
    const roof = roofs[0];
    width = inches(roof.width);
    depth = inches(roof.depth);
    rise = Math.max(inches(roof.pitch_rise) || 6, 0.01);
    run = Math.max(inches(roof.pitch_run) || 12, 0.01);
    overhang = inches(roof.overhang);
    kind = (roof.kind || "gable").toLowerCase();
  } else if (rooms.length) {
    const minX = Math.min(...rooms.map((r) => inches(r.x)));
    const minY = Math.min(...rooms.map((r) => inches(r.y)));
    const maxX = Math.max(...rooms.map((r) => inches(r.x) + inches(r.width)));
    const maxY = Math.max(...rooms.map((r) => inches(r.y) + inches(r.depth)));
    width = maxX - minX;
    depth = maxY - minY;
  } else {
    return {
      roof_sf: 0, roof_perimeter_lf: 0, ridge_lf: 0, gable_lf: 0, valley_lf: 0, gutter_lf: 0, pitch: "6/12", pitch_deg: 0,
    };
  }
  const pitchRad = Math.atan(rise / run);
  const pitchDeg = round2((pitchRad * 180) / Math.PI);
  const fw = width + 2 * overhang;
  const fd = depth + 2 * overhang;
  const footprintSf = (fw * fd) / 144;
  const slope = 1 / Math.max(Math.cos(pitchRad), 0.15);
  const perimeter = round2((2 * (fw + fd)) / 12);
  if (kind === "flat") {
    return { roof_sf: round2(footprintSf), roof_perimeter_lf: perimeter, ridge_lf: 0, gable_lf: 0, valley_lf: 0, gutter_lf: perimeter, pitch: `${Math.round(rise)}/${Math.round(run)}`, pitch_deg: pitchDeg };
  }
  if (kind === "hip") {
    const hip = Math.hypot(fd / 2, (fd / 2) * (rise / run));
    return {
      roof_sf: round2(footprintSf * slope),
      roof_perimeter_lf: perimeter,
      ridge_lf: round2(Math.max(fw - fd, 0) / 12),
      gable_lf: 0,
      valley_lf: round2((4 * hip) / 12),
      gutter_lf: perimeter,
      pitch: `${Math.round(rise)}/${Math.round(run)}`,
      pitch_deg: pitchDeg,
    };
  }
  if (kind === "shed") {
    return {
      roof_sf: round2(footprintSf * slope),
      roof_perimeter_lf: perimeter,
      ridge_lf: 0,
      gable_lf: round2((2 * (fd / Math.max(Math.cos(pitchRad), 0.15))) / 12),
      valley_lf: 0,
      gutter_lf: round2((2 * fw + 2 * fd) / 12),
      pitch: `${Math.round(rise)}/${Math.round(run)}`,
      pitch_deg: pitchDeg,
    };
  }
  const alongLength = fw >= fd;
  const ridgeIn = alongLength ? fw : fd;
  const spanIn = alongLength ? fd : fw;
  const rafter = (spanIn / 2) / Math.max(Math.cos(pitchRad), 0.15);
  return {
    roof_sf: round2(footprintSf * slope),
    roof_perimeter_lf: perimeter,
    ridge_lf: round2(ridgeIn / 12),
    gable_lf: round2((4 * rafter) / 12),
    valley_lf: 0,
    gutter_lf: round2((2 * ridgeIn) / 12),
    pitch: `${Math.round(rise)}/${Math.round(run)}`,
    pitch_deg: pitchDeg,
  };
}

export function computeLevelTakeoffs(level) {
  const rooms = level?.rooms || [];
  const walls = level?.walls || [];
  const objects = level?.objects || [];
  const roomRows = rooms.map((room) => {
    const perim = 2 * (inches(room.width) + inches(room.depth));
    return {
      id: room.id,
      name: room.name || "Room",
      sf: roomSf(room),
      perimeter_lf: round2(perim / 12),
      wall_height: inches(room.wall_height || DEFAULT_H),
      ceiling_height: inches(room.ceiling_height || DEFAULT_H),
      flooring: room.flooring || "lvp",
    };
  });
  const floorSf = round2(roomRows.reduce((s, r) => s + r.sf, 0));
  let wallSf = 0;
  let wallLf = 0;
  let openingSf = 0;
  walls.forEach((wall) => {
    const length = wallLength(wall);
    const height = inches(wall.height || DEFAULT_H);
    let holes = 0;
    (wall.openings || []).forEach((op) => {
      holes += inches(op.width) * inches(op.height);
    });
    openingSf += holes;
    wallSf += Math.max(length * height - holes, 0);
    wallLf += length;
  });
  const roof = computeRoof(level || {});
  const baseboard = round2(roomRows.reduce((s, r) => s + r.perimeter_lf, 0));
  const plumbingLf = round2((walls.filter((w) => w.plumbing).reduce((s, w) => s + wallLength(w), 0)) / 12);
  const beamLf = round2(((level?.beams || []).reduce((s, b) => s + wallLength(b), 0)) / 12);
  const lvlLf = round2(((level?.beams || []).reduce((s, b) => s + wallLength(b) * (b.plies || 1), 0)) / 12);
  return {
    level_id: level?.id,
    name: level?.name || "Level",
    rooms: roomRows,
    room_count: rooms.length,
    floor_sf: floorSf,
    ceiling_sf: floorSf,
    wall_sf: round2(wallSf / 144),
    wall_lf: round2(wallLf / 12),
    plumbing_wall_lf: plumbingLf,
    beam_lf: beamLf,
    lvl_lf: lvlLf,
    opening_sf: round2(openingSf / 144),
    baseboard_lf: baseboard,
    crown_lf: baseboard,
    toekick_lf: round2(objects.filter((o) => String(o.library_id || "").startsWith("cab-base")).reduce((s, o) => s + inches(o.width) / 12, 0)),
    object_count: objects.length,
    ...roof,
  };
}

export function computeTakeoffs(document) {
  const levels = (document?.levels || []).map(computeLevelTakeoffs);
  const sum = (key) => round2(levels.reduce((s, r) => s + (r[key] || 0), 0));
  return {
    levels,
    totals: {
      floor_sf: sum("floor_sf"),
      ceiling_sf: sum("ceiling_sf"),
      wall_sf: sum("wall_sf"),
      wall_lf: sum("wall_lf"),
      roof_sf: sum("roof_sf"),
      roof_perimeter_lf: sum("roof_perimeter_lf"),
      ridge_lf: sum("ridge_lf"),
      gable_lf: sum("gable_lf"),
      valley_lf: sum("valley_lf"),
      gutter_lf: sum("gutter_lf"),
      baseboard_lf: sum("baseboard_lf"),
      crown_lf: sum("crown_lf"),
      plumbing_wall_lf: sum("plumbing_wall_lf"),
      beam_lf: sum("beam_lf"),
      lvl_lf: sum("lvl_lf"),
      level_count: levels.length,
      room_count: levels.reduce((s, r) => s + r.room_count, 0),
    },
    pitch: levels.find((l) => l.roof_sf)?.pitch || "6/12",
  };
}
