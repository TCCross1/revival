/**
 * Kentucky residential electrical design engine for Floor Plan Studio.
 *
 * Defaults to current dwelling-unit practice (NEC 2020/2023 AFCI, GFCI,
 * tamper-resistant, and spacing). Kentucky adopts the NEC through the
 * Kentucky Building Code; when editions differ we take the more protective
 * option and note it for the AHJ / licensed electrician.
 *
 * This module never logs addresses, tokens, or file bytes.
 */
import { inches, round2, uid } from "./units";
import { emptyObject, wallLength, wallsFromRoom } from "./model";
import { libraryById, RANGE_SIX_BURNER_MIN } from "./library";

export const ELEC_DISCLAIMER = "Kentucky dwelling design from typical NEC practice (protective default). Confirm nameplate ratings, the adopted NEC edition, Kentucky amendments, and the AHJ. A licensed electrician must review before rough-in.";

export const KY_CODE = {
  jurisdiction: "Commonwealth of Kentucky",
  nec: "NEC dwelling-unit rules (2020/2023 protective default)",
  note: "Kentucky adopts the NEC through the Kentucky Building Code. Revival Pro uses the more protective current dwelling requirements (combination AFCI, expanded GFCI, tamper-resistant receptacles). Field verify the edition the AHJ enforces.",
};

const HABITABLE = new Set(["kitchen", "bath", "bedroom", "living", "hallway", "dining", "office"]);

export function classifyRoom(name = "", projectType = "") {
  const n = `${name} ${projectType}`.toLowerCase();
  if (/kitchen|pantry|butlers?/.test(n)) return "kitchen";
  if (/bath|powder|toilet/.test(n)) return "bath";
  if (/laundry|mud/.test(n)) return "laundry";
  if (/garage/.test(n)) return "garage";
  if (/closet|wardrobe/.test(n)) return "closet";
  if (/hall|corridor|foyer/.test(n)) return "hallway";
  if (/stair/.test(n)) return "stair";
  if (/bed/.test(n)) return "bedroom";
  if (/unfinished|crawl/.test(n)) return "basement";
  if (/basement/.test(n)) return "basement";
  if (/outdoor|patio|deck|porch|exterior/.test(n)) return "outdoor";
  if (/dining/.test(n)) return "dining";
  if (/office|den|study/.test(n)) return "office";
  if (/living|great|family|nook|hearth/.test(n)) return "living";
  if (/util|mech|mechanical/.test(n)) return "utility";
  return "living";
}

export function switchKindForEntries(entryCount) {
  const n = Math.max(0, Number(entryCount) || 0);
  if (n <= 1) return "switch";
  if (n === 2) return "switch-3way";
  return "switch-4way";
}

export function wireForAmps(amps, { travelers = false, volts = 120 } = {}) {
  const a = Number(amps) || 15;
  const v = Number(volts) || 120;
  if (a <= 15) {
    return {
      amps: 15,
      awg: 14,
      breaker: 15,
      cable: travelers ? "14-3 NM-B" : "14-2 NM-B",
      volts: v,
    };
  }
  if (a <= 20) {
    return {
      amps: 20,
      awg: 12,
      breaker: 20,
      cable: travelers ? "12-3 NM-B" : (v >= 240 ? "12-2 NM-B" : "12-2 NM-B"),
      volts: v,
    };
  }
  if (a <= 30) {
    return {
      amps: 30,
      awg: 10,
      breaker: 30,
      cable: v >= 240 ? (travelers ? "10-3 NM-B" : "10-3 NM-B") : "10-2 NM-B",
      volts: v,
    };
  }
  if (a <= 40) return { amps: 40, awg: 8, breaker: 40, cable: "8-3 copper", volts: v };
  if (a <= 50) return { amps: 50, awg: 6, breaker: 50, cable: "6-3 copper", volts: v };
  if (a <= 60) return { amps: 60, awg: 6, breaker: 60, cable: "6 AWG copper or per nameplate", volts: v };
  return { amps: a, awg: 4, breaker: a, cable: "per nameplate / load calculation", volts: v };
}

export function dimmerAllowed(libraryId) {
  const id = String(libraryId || "");
  if (id.startsWith("fan-") && id !== "fan-light") return false;
  if (id === "fan-ceiling") return false;
  if (id.startsWith("switch-fan")) return false;
  return id.startsWith("light-") || id === "fan-light" || id.includes("undercab") || id.includes("vanity") || id.includes("pendant") || id.includes("recessed") || id.includes("chandelier") || id.includes("sconce");
}

export function gfciRequired(kind, { nearSink = false, outdoor = false } = {}) {
  if (nearSink || outdoor) return true;
  return ["kitchen", "bath", "laundry", "garage", "basement", "outdoor", "utility"].includes(kind);
}

export function afciRequired(kind) {
  return !["garage", "outdoor"].includes(kind);
}

export function receptacleStations(lengthIn, { maxFromAny = 72, minWall = 24 } = {}) {
  const length = Number(lengthIn) || 0;
  if (length < minWall) return [];
  const maxSpacing = maxFromAny * 2;
  const first = Math.min(maxFromAny, length / 2);
  const pts = [round2(first)];
  let x = first;
  let guard = 0;
  while (length - x > maxFromAny + 0.5 && guard < 40) {
    guard += 1;
    const next = x + maxSpacing;
    const endCover = length - Math.min(maxFromAny, length / 2);
    x = round2(Math.min(next, endCover));
    if (x - pts[pts.length - 1] < 8) break;
    pts.push(x);
  }
  if (length - pts[pts.length - 1] > maxFromAny + 0.5) {
    pts.push(round2(length - Math.min(maxFromAny, length / 2)));
  }
  return pts;
}

function roomCenter(room) {
  return {
    x: inches(room.x) + inches(room.width) / 2,
    y: inches(room.y) + inches(room.depth) / 2,
  };
}

function frontFromNormal(nx, ny) {
  if (Math.abs(nx) > Math.abs(ny)) return nx > 0 ? "east" : "west";
  return ny > 0 ? "south" : "north";
}

function inwardNormal(wall, room) {
  const len = Math.max(wallLength(wall), 0.01);
  let nx = -((inches(wall.y2) - inches(wall.y1)) / len);
  let ny = (inches(wall.x2) - inches(wall.x1)) / len;
  const c = roomCenter(room);
  const mid = {
    x: (inches(wall.x1) + inches(wall.x2)) / 2,
    y: (inches(wall.y1) + inches(wall.y2)) / 2,
  };
  if ((c.x - mid.x) * nx + (c.y - mid.y) * ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  return { nx, ny, len };
}

function pointOnWallAt(wall, distance) {
  const len = Math.max(wallLength(wall), 0.01);
  const t = Math.max(0, Math.min(1, distance / len));
  return {
    x: inches(wall.x1) + (inches(wall.x2) - inches(wall.x1)) * t,
    y: inches(wall.y1) + (inches(wall.y2) - inches(wall.y1)) * t,
  };
}

function placeOnWall(wall, distance, room, size = 6) {
  const { nx, ny } = inwardNormal(wall, room);
  const pt = pointOnWallAt(wall, distance);
  const inset = inches(wall.thickness || 4) / 2 + 1.5;
  return {
    x: round2(pt.x + nx * inset - size / 2),
    y: round2(pt.y + ny * inset - size / 2),
    front: frontFromNormal(nx, ny),
    wall_id: wall.id || "",
  };
}

function usableSegments(wall) {
  const len = wallLength(wall);
  const cuts = (wall.openings || [])
    .filter((o) => o.type === "door" || o.type === "cased")
    .map((o) => ({
      start: Math.max(0, inches(o.offset) - 6),
      end: Math.min(len, inches(o.offset) + inches(o.width) + 6),
    }))
    .sort((a, b) => a.start - b.start);
  const segs = [];
  let cursor = 0;
  cuts.forEach((cut) => {
    if (cut.start > cursor + 8) segs.push({ start: cursor, end: cut.start, wall });
    cursor = Math.max(cursor, cut.end);
  });
  if (len - cursor > 8) segs.push({ start: cursor, end: len, wall });
  if (!segs.length && len >= 24) segs.push({ start: 0, end: len, wall });
  return segs;
}

function roomWalls(level, room) {
  const owned = (level.walls || []).filter((w) => w.source_room_id === room.id);
  if (owned.length) return owned;
  return wallsFromRoom(room, "interior");
}

function entriesForRoom(level, room) {
  const walls = roomWalls(level, room);
  const entries = [];
  walls.forEach((wall) => {
    (wall.openings || []).forEach((op) => {
      if (op.type === "door" || op.type === "cased") {
        entries.push({ wall, opening: op });
      }
    });
  });
  return entries;
}

function makeDevice(libraryId, x, y, extras = {}) {
  const lib = libraryById(libraryId) || {
    id: libraryId,
    name: libraryId,
    width: 6,
    depth: 6,
    height: 4,
    tags: ["electrical"],
    group: "MEP",
  };
  return {
    ...emptyObject(lib, x, y),
    elec_auto: true,
    auto: true,
    tamper_resistant: !String(libraryId).includes("240"),
    ...extras,
  };
}

function outletIdForKind(kind) {
  if (kind === "kitchen" || kind === "bath" || kind === "laundry") return "outlet-gfci";
  if (kind === "garage" || kind === "outdoor" || kind === "basement") return "outlet-gfci-wr";
  if (kind === "utility") return "outlet-gfci";
  return "outlet-duplex";
}

function lightsInRoom(objects, room) {
  return (objects || []).filter((obj) => {
    const id = String(obj.library_id || "");
    const tags = obj.tags || [];
    if (!(tags.includes("light") || tags.includes("fan") || id.startsWith("light-") || id.startsWith("fan-"))) return false;
    if (obj.light_room_id && obj.light_room_id === room.id) return true;
    const x = inches(obj.x) + inches(obj.width) / 2;
    const y = inches(obj.y) + inches(obj.depth) / 2;
    return x >= inches(room.x) && x <= inches(room.x) + inches(room.width)
      && y >= inches(room.y) && y <= inches(room.y) + inches(room.depth);
  });
}

function objectsInRoom(objects, room) {
  return (objects || []).filter((obj) => {
    const x = inches(obj.x) + inches(obj.width) / 2;
    const y = inches(obj.y) + inches(obj.depth) / 2;
    return x >= inches(room.x) - 4 && x <= inches(room.x) + inches(room.width) + 4
      && y >= inches(room.y) - 4 && y <= inches(room.y) + inches(room.depth) + 4;
  });
}

function isIsland(obj) {
  const id = String(obj?.library_id || "");
  const tags = obj?.tags || [];
  return tags.includes("island") || id.startsWith("island");
}

function isSink(obj) {
  const id = String(obj?.library_id || "");
  const tags = obj?.tags || [];
  return tags.includes("sink") || id.includes("sink") || tags.includes("vanity");
}

function applianceSpec(obj) {
  const id = String(obj?.library_id || "");
  if (id.startsWith("range")) return { amps: (Number(obj?.width) || 0) >= RANGE_SIX_BURNER_MIN || id.includes("36") ? 50 : 40, volts: 240, dedicated: true, label: "Range", gfci: true, afci: false, library: "outlet-240" };
  if (id.startsWith("dryer")) return { amps: 30, volts: 240, dedicated: true, label: "Electric dryer", gfci: true, afci: false, library: "outlet-240" };
  if (id.startsWith("fridge")) return { amps: 15, volts: 120, dedicated: true, label: "Refrigerator", gfci: false, afci: true, library: "outlet-duplex" };
  if (id.startsWith("dw-")) return { amps: 15, volts: 120, dedicated: true, label: "Dishwasher", gfci: true, afci: true, library: "outlet-gfci" };
  if (id.startsWith("micro")) return { amps: 20, volts: 120, dedicated: true, label: "Microwave", gfci: false, afci: true, library: "outlet-duplex" };
  if (id === "disposal") return { amps: 15, volts: 120, dedicated: true, label: "Disposal", gfci: true, afci: true, library: "outlet-gfci" };
  if (id === "washer") return { amps: 20, volts: 120, dedicated: true, label: "Washer", gfci: true, afci: true, library: "outlet-gfci" };
  if (id.startsWith("wh-tankless")) return { amps: 60, volts: 240, dedicated: true, label: "Tankless WH", gfci: false, afci: false, library: "outlet-240" };
  if (id.startsWith("wh-")) return { amps: 30, volts: 240, dedicated: true, label: "Water heater", gfci: false, afci: false, library: "outlet-240" };
  if (id === "hvac-condenser") return { amps: 30, volts: 240, dedicated: true, label: "Condenser", gfci: false, afci: false, library: "outlet-240" };
  if (id === "hvac-ah") return { amps: 20, volts: 120, dedicated: true, label: "Air handler", gfci: false, afci: false, library: "outlet-duplex" };
  return null;
}

function findPanel(objects) {
  return (objects || []).find((o) => String(o.library_id || "") === "panel");
}

function placePanel(level, rooms) {
  const existing = findPanel(level.objects);
  if (existing) return { panel: existing, added: false };
  const prefer = rooms.find((r) => ["laundry", "garage", "utility", "basement"].includes(classifyRoom(r.name))) || rooms[0];
  if (!prefer) return { panel: null, added: false };
  const walls = roomWalls(level, prefer);
  const wall = walls[0];
  if (!wall) return { panel: null, added: false };
  const spot = placeOnWall(wall, Math.min(24, wallLength(wall) / 2), prefer, 14);
  const panel = {
    ...makeDevice("panel", spot.x, spot.y, { front: spot.front, wall_id: spot.wall_id, note: "200A house panel — keep 36\" clear in front" }),
    width: 14,
    depth: 4,
  };
  return { panel, added: true };
}

function placeRoomDevices(level, room, projectType) {
  const kind = classifyRoom(room.name, projectType);
  const added = [];
  const warnings = [];
  const walls = roomWalls(level, room);
  const existing = objectsInRoom(level.objects, room);
  const hasUserOutlet = existing.some((o) => String(o.library_id || "").startsWith("outlet") && !o.elec_auto);
  const maxFromAny = kind === "kitchen" ? 24 : 72;
  const minWall = kind === "kitchen" ? 12 : 24;
  const outletLib = outletIdForKind(kind);

  if (!hasUserOutlet && kind !== "closet") {
    walls.forEach((wall) => {
      usableSegments(wall).forEach((seg) => {
        const span = seg.end - seg.start;
        receptacleStations(span, { maxFromAny, minWall }).forEach((local) => {
          const dist = seg.start + local;
          const spot = placeOnWall(wall, dist, room, outletLib === "outlet-quad" ? 8 : 6);
          added.push(makeDevice(outletLib, spot.x, spot.y, {
            front: spot.front,
            wall_id: spot.wall_id,
            note: kind === "kitchen"
              ? "Countertop GFCI · 20A small-appliance circuit · TR"
              : kind === "bath"
                ? "Bathroom GFCI · within 3' of basin where required · TR"
                : "Tamper-resistant dwelling receptacle",
            elec_kind: kind,
          }));
        });
      });
    });
  }

  existing.filter(isIsland).forEach((island) => {
    added.push(makeDevice("outlet-gfci", round2(inches(island.x) + inches(island.width) / 2 - 3), round2(inches(island.y) + inches(island.depth) / 2 - 3), {
      note: "Island / peninsula GFCI (KY protective default — still provide even where 2023 island rules are narrower)",
      elec_kind: kind,
    }));
  });

  if (kind === "bath") {
    existing.filter(isSink).forEach((sink) => {
      added.push(makeDevice("outlet-gfci", round2(inches(sink.x) + inches(sink.width) + 4), round2(inches(sink.y) + 2), {
        note: "Basin GFCI — required within 3 feet of the lavatory",
        elec_kind: "bath",
      }));
    });
  }

  existing.forEach((obj) => {
    const spec = applianceSpec(obj);
    if (!spec) return;
    added.push(makeDevice(spec.library, round2(inches(obj.x) - 2), round2(inches(obj.y) + inches(obj.depth) / 2 - 3), {
      note: `Dedicated ${spec.amps}A / ${spec.volts}V — ${spec.label}`,
      elec_kind: kind,
      dedicated: true,
      nameplate_amps: spec.amps,
      nameplate_volts: spec.volts,
    }));
  });

  const lights = lightsInRoom(level.objects, room);
  const fans = lights.filter((o) => String(o.library_id || "").startsWith("fan-"));
  const lighting = lights.filter((o) => !String(o.library_id || "").startsWith("fan-") || String(o.library_id || "") === "fan-light");
  const entries = entriesForRoom(level, room);
  const entryCount = kind === "stair" ? Math.max(2, entries.length) : entries.length;
  const needSwitch = HABITABLE.has(kind) || kind === "stair" || kind === "garage" || kind === "closet" || lighting.length || fans.length;

  if (needSwitch && !existing.some((o) => String(o.library_id || "").startsWith("switch") && !o.elec_auto)) {
    const switchLib = (() => {
      if (fans.length && lighting.length) return entryCount >= 2 ? "switch-3way" : "switch-fan-light";
      if (fans.length && !lighting.length) return "switch-fan";
      if (entryCount >= 3) return "switch-4way";
      if (entryCount === 2 || kind === "stair" || kind === "hallway") return lighting.every((l) => dimmerAllowed(l.library_id)) && lighting.length ? "switch-3way" : "switch-3way";
      if (lighting.length && lighting.every((l) => dimmerAllowed(l.library_id)) && !fans.length) return "switch-dimmer";
      return "switch";
    })();

    const spots = [];
    if (entries.length) {
      entries.forEach((entry, idx) => {
        const wall = entry.wall;
        const off = inches(entry.opening.offset) + inches(entry.opening.width) + 8;
        const along = Math.min(Math.max(off, 8), Math.max(wallLength(wall) - 8, 8));
        let lib = switchLib;
        if (entryCount >= 3) lib = idx === 0 || idx === entries.length - 1 ? "switch-3way" : "switch-4way";
        else if (entryCount === 2) lib = "switch-3way";
        spots.push({ wall, along, lib });
      });
    } else {
      const wall = walls[0];
      if (wall) spots.push({ wall, along: Math.min(18, wallLength(wall) / 2), lib: switchLib });
    }

    spots.forEach((spot) => {
      const pos = placeOnWall(spot.wall, spot.along, room, 6);
      const fanWarn = fans.length && String(spot.lib).includes("dimmer");
      if (fanWarn) warnings.push(`${room.name}: do not put a lighting dimmer on the fan motor — use a fan/light dual control.`);
      added.push(makeDevice(fanWarn ? "switch-fan-light" : spot.lib, pos.x, pos.y, {
        front: pos.front,
        wall_id: pos.wall_id,
        note: spot.lib.includes("3way")
          ? "3-way — travelers in 12-3 / 14-3 between boxes"
          : spot.lib.includes("4way")
            ? "4-way between the 3-ways"
            : spot.lib.includes("dimmer")
              ? "LED-rated dimmer with neutral"
              : spot.lib.includes("fan-light")
                ? "Separate switched hots for fan and light (12-3)"
                : "Single-pole lighting switch",
        elec_kind: kind,
      }));
    });

    if (kind === "stair" && spots.length < 2) {
      warnings.push(`${room.name}: stairways need a switch at each floor/landing (3-way or 4-way). Add the second landing if it is not drawn.`);
    }
    if ((HABITABLE.has(kind) || kind === "stair") && !lighting.length && !fans.length) {
      warnings.push(`${room.name}: habitable rooms, halls, and stairs need a wall-switch-controlled lighting outlet. Place lights, then re-run the electrician.`);
    }
  }

  if (kind === "closet" && lighting.some((l) => String(l.library_id || "").includes("pendant") || String(l.library_id || "").includes("chandelier"))) {
    warnings.push(`${room.name}: closet luminaires must be LED/fluorescent or fully enclosed and keep NEC shelf clearances. Avoid bare pendants near storage.`);
  }

  if (kind === "bedroom" && !existing.some((o) => String(o.library_id || "") === "smoke") && !added.some((o) => o.library_id === "smoke")) {
    added.push(makeDevice("smoke", round2(inches(room.x) + inches(room.width) / 2 - 3), round2(inches(room.y) + 10), {
      note: "Smoke/CO interconnect — 14-3, battery backup, not GFCI",
      elec_kind: kind,
    }));
  }

  return { added, warnings, kind };
}

function vaForDevice(obj) {
  const id = String(obj.library_id || "");
  if (id === "panel") return 0;
  if (id === "smoke") return 50;
  if (id.startsWith("switch")) return 0;
  if (id.startsWith("light") || id.startsWith("fan")) return 100;
  if (id === "outlet-quad") return 360;
  if (id.startsWith("outlet-240")) return 0;
  if (obj.dedicated) return 0;
  return 180;
}

function protectionLabel({ gfci, afci, dual }) {
  if (dual || (gfci && afci)) return "Dual-function CAFCI/GFCI";
  if (gfci) return "GFCI";
  if (afci) return "Combination AFCI";
  return "Standard";
}

function groupCircuits(objects, rooms, projectType) {
  const circuits = [];
  const warnings = [];
  const byRoom = new Map();
  rooms.forEach((room) => byRoom.set(room.id, { room, kind: classifyRoom(room.name, projectType), devices: [] }));

  const unassigned = [];
  (objects || []).forEach((obj) => {
    const id = String(obj.library_id || "");
    if (id === "panel") return;
    const room = rooms.find((r) => {
      const x = inches(obj.x) + inches(obj.width) / 2;
      const y = inches(obj.y) + inches(obj.depth) / 2;
      return x >= inches(r.x) - 8 && x <= inches(r.x) + inches(r.width) + 8
        && y >= inches(r.y) - 8 && y <= inches(r.y) + inches(r.depth) + 8;
    });
    if (!room) {
      unassigned.push(obj);
      return;
    }
    byRoom.get(room.id).devices.push(obj);
  });

  let breaker = 1;
  const pushCircuit = (partial) => {
    const wire = wireForAmps(partial.amps, { travelers: partial.travelers, volts: partial.volts || 120 });
    const poles = (partial.volts || 120) >= 240 ? 2 : 1;
    const id = `C${String(breaker).padStart(2, "0")}`;
    const circuit = {
      id,
      breaker,
      poles,
      amps: wire.breaker,
      volts: wire.volts,
      awg: wire.awg,
      cable: wire.cable,
      description: partial.description,
      protection: protectionLabel(partial),
      gfci: Boolean(partial.gfci),
      afci: Boolean(partial.afci),
      dual: Boolean(partial.dual || (partial.gfci && partial.afci)),
      va: round2(partial.va || 0),
      device_ids: (partial.devices || []).map((d) => d.id),
      instructions: partial.instructions || [],
    };
    const budget = circuit.amps * 120 * 0.8;
    if (circuit.volts < 240 && circuit.va > budget) {
      warnings.push(`${circuit.description} is overloaded (${circuit.va} VA on a ${circuit.amps}A breaker). Split the run.`);
      circuit.overloaded = true;
    }
    circuits.push(circuit);
    breaker += poles;
    return circuit;
  };

  const kitchenRooms = [...byRoom.values()].filter((row) => row.kind === "kitchen");
  kitchenRooms.forEach((row) => {
    const gfcis = row.devices.filter((d) => String(d.library_id || "").includes("gfci") && !d.dedicated);
    const mid = Math.ceil(gfcis.length / 2) || 1;
    const a = gfcis.slice(0, mid);
    const b = gfcis.slice(mid);
    if (!a.length) warnings.push(`${row.room.name}: kitchen needs at least two 20A small-appliance branch circuits for countertop receptacles.`);
    pushCircuit({
      description: `${row.room.name} Small Appliance 1`,
      amps: 20,
      gfci: true,
      afci: true,
      dual: true,
      devices: a,
      va: a.reduce((s, d) => s + vaForDevice(d), 0),
      instructions: [
        "Home-run 12-2 NM-B to a 20A dual-function (CAFCI/GFCI) breaker.",
        "Serve only kitchen/pantry/dining countertop and similar receptacles — no lighting, no disposal, no dishwasher.",
        "All countertop devices are GFCI and tamper-resistant.",
      ],
    });
    pushCircuit({
      description: `${row.room.name} Small Appliance 2`,
      amps: 20,
      gfci: true,
      afci: true,
      dual: true,
      devices: b.length ? b : [],
      va: b.reduce((s, d) => s + vaForDevice(d), 0),
      instructions: [
        "Second 20A small-appliance home-run, same rules as SABC 1.",
        "Split island and opposite-wall GFCIs so a trip does not kill the whole kitchen.",
      ],
    });
  });

  [...byRoom.values()].forEach((row) => {
    row.devices.forEach((obj) => {
      const id = String(obj.library_id || "");
      const app = applianceSpec(obj);
      if (app && !id.startsWith("outlet") && id !== "disposal") return;
      const spec = app || (obj.dedicated || id.startsWith("outlet-240") ? {
        amps: obj.nameplate_amps || 20,
        volts: obj.nameplate_volts || (id.includes("240") ? 240 : 120),
        label: obj.note || obj.name || "Dedicated load",
        gfci: Boolean(obj.note && /GFCI|gfci/.test(obj.note)) || id.includes("gfci"),
        afci: true,
      } : null);
      if (!spec) return;
      const already = circuits.some((c) => (c.device_ids || []).includes(obj.id));
      if (already) return;
      const mates = row.devices.filter((d) => d.dedicated && d !== obj && String(d.note || "").includes(spec.label));
      pushCircuit({
        description: `${spec.label} — ${row.room.name}`,
        amps: spec.amps,
        volts: spec.volts,
        gfci: Boolean(spec.gfci),
        afci: Boolean(spec.afci),
        devices: [obj, ...mates],
        va: 0,
        instructions: [
          `Dedicated ${spec.amps}A / ${spec.volts}V home-run. ${wireForAmps(spec.amps, { volts: spec.volts }).cable}.`,
          spec.volts >= 240 ? "Two-pole breaker. 4-wire (two hots, neutral if required, equipment ground)." : "Do not share this home-run with lighting or general receptacles.",
          spec.gfci ? "GFCI protection required (device or breaker). Confirm 2020/2023 kitchen appliance GFCI with the AHJ." : "Keep the refrigerator off GFCI if the AHJ still allows it so food is not lost on a trip.",
        ],
      });
    });
  });

  [...byRoom.values()].forEach((row) => {
    const lighting = row.devices.filter((d) => {
      const id = String(d.library_id || "");
      return id.startsWith("light") || id.startsWith("fan") || id.startsWith("switch") || id === "smoke";
    });
    const recs = row.devices.filter((d) => {
      const id = String(d.library_id || "");
      if (!id.startsWith("outlet")) return false;
      if (d.dedicated) return false;
      if (row.kind === "kitchen" && id.includes("gfci")) return false;
      return true;
    });
    if (!lighting.length && !recs.length) return;
    if (row.kind === "kitchen" && lighting.length) {
      const travelers = lighting.some((d) => String(d.library_id || "").includes("3way") || String(d.library_id || "").includes("4way"));
      pushCircuit({
        description: `${row.room.name} Lighting`,
        amps: 15,
        afci: true,
        gfci: false,
        travelers,
        devices: lighting,
        va: lighting.reduce((s, d) => s + vaForDevice(d), 0),
        instructions: [
          "15A combination AFCI lighting home-run. Do not land kitchen lights on the small-appliance circuits.",
          travelers ? "Pull 14-3 (or 12-3) between 3-way/4-way boxes; keep a dedicated hot and a neutral in each box." : "Switch loop with a neutral in the switch box (NEC 404.2). LED-rated dimmer if used.",
          "Fan/light combos: 14-3 or 12-3 so fan and light are separately switched. Never a standard lighting dimmer on the fan motor.",
        ],
      });
      return;
    }
    if (row.kind === "bath") {
      pushCircuit({
        description: `${row.room.name} GFCI Receptacles`,
        amps: 20,
        gfci: true,
        afci: true,
        dual: true,
        devices: recs,
        va: recs.reduce((s, d) => s + vaForDevice(d), 0),
        instructions: [
          "20A bathroom receptacle circuit. Dual-function breaker is the cleanest KY-protective method.",
          "At least one receptacle within 3 feet of each basin. All bathroom receptacles GFCI.",
        ],
      });
      if (lighting.length) {
        pushCircuit({
          description: `${row.room.name} Lighting`,
          amps: 15,
          afci: true,
          devices: lighting,
          va: lighting.reduce((s, d) => s + vaForDevice(d), 0),
          instructions: [
            "Keep bath lighting off the 20A receptacle circuit unless this is a single bathroom and the AHJ allows sharing.",
            "Vanity lighting on an LED dimmer is acceptable. Exhaust fans may share this lighting circuit.",
          ],
        });
      }
      return;
    }
    if (row.kind === "laundry") {
      pushCircuit({
        description: `${row.room.name} Laundry GFCI`,
        amps: 20,
        gfci: true,
        afci: true,
        dual: true,
        devices: recs,
        va: recs.reduce((s, d) => s + vaForDevice(d), 0),
        instructions: ["One 20A laundry circuit. GFCI required. Do not feed the dryer from this run."],
      });
      if (lighting.length) {
        pushCircuit({
          description: `${row.room.name} Lighting`,
          amps: 15,
          afci: true,
          devices: lighting,
          va: lighting.reduce((s, d) => s + vaForDevice(d), 0),
          instructions: ["Laundry lighting on a 15A CAFCI. Separate from the laundry receptacle circuit."],
        });
      }
      return;
    }
    if (row.kind === "garage" || row.kind === "outdoor") {
      pushCircuit({
        description: `${row.room.name} GFCI`,
        amps: 20,
        gfci: true,
        afci: row.kind !== "outdoor",
        devices: [...recs, ...lighting],
        va: [...recs, ...lighting].reduce((s, d) => s + vaForDevice(d), 0),
        instructions: [
          "20A GFCI. Weather-resistant and in-use covers outdoors and in damp locations.",
          "Garage receptacle circuits are GFCI; lighting may share only if load allows.",
        ],
      });
      return;
    }
    const travelers = lighting.some((d) => /3way|4way/.test(String(d.library_id || "")));
    const all = [...lighting, ...recs];
    const chunks = [];
    let bucket = [];
    let va = 0;
    all.forEach((d) => {
      const add = vaForDevice(d);
      if (va + add > 1440 && bucket.length) {
        chunks.push(bucket);
        bucket = [d];
        va = add;
      } else {
        bucket.push(d);
        va += add;
      }
    });
    if (bucket.length) chunks.push(bucket);
    chunks.forEach((chunk, idx) => {
      pushCircuit({
        description: chunks.length > 1 ? `${row.room.name} Lights & Receptacles ${idx + 1}` : `${row.room.name} Lights & Receptacles`,
        amps: 15,
        afci: afciRequired(row.kind),
        gfci: gfciRequired(row.kind),
        travelers,
        devices: chunk,
        va: chunk.reduce((s, d) => s + vaForDevice(d), 0),
        instructions: [
          "15A combination AFCI breaker (dwelling living areas). Tamper-resistant receptacles.",
          travelers ? "3-way/4-way: 14-3 travelers between boxes; 4-way sits between the two 3-ways." : "Home-run 14-2 to the first device, then daisy-chain. Neutral in every switch box.",
          gfciRequired(row.kind) ? "Add GFCI (dual-function breaker or feed-through device) — unfinished basement, within 6' of a sink, etc." : "General living-area receptacles follow the 6-foot / 12-foot wall spacing rule.",
        ],
      });
    });
  });

  if (unassigned.length) {
    warnings.push(`${unassigned.length} device(s) sit outside a room. Drag them into a room or add a room block, then re-run the electrician.`);
  }

  const smokes = (objects || []).filter((o) => String(o.library_id || "") === "smoke");
  if (smokes.length) {
    const existing = circuits.find((c) => (c.device_ids || []).some((id) => smokes.some((s) => s.id === id)));
    if (!existing) {
      pushCircuit({
        description: "Smoke / CO interconnect",
        amps: 15,
        afci: true,
        devices: smokes,
        va: smokes.length * 50,
        instructions: ["14-3 interconnect (red). Battery backup. Do not GFCI this circuit. Place in each bedroom and outside sleeping rooms."],
      });
    }
  }

  return { circuits, warnings, nextBreaker: breaker };
}

export function auditElectricalDesign(level, { projectType = "" } = {}) {
  const warnings = [];
  const rooms = level?.rooms || [];
  const objects = level?.objects || [];
  rooms.forEach((room) => {
    const kind = classifyRoom(room.name, projectType);
    const inRoom = objectsInRoom(objects, room);
    const outlets = inRoom.filter((o) => String(o.library_id || "").startsWith("outlet"));
    const switches = inRoom.filter((o) => String(o.library_id || "").startsWith("switch"));
    const lights = lightsInRoom(objects, room);
    if (kind === "kitchen") {
      const gfcis = outlets.filter((o) => String(o.library_id || "").includes("gfci"));
      if (gfcis.length < 2) warnings.push({ severity: "error", code: "kitchen-sabc", text: `${room.name}: countertop work needs two or more 20A small-appliance circuits, all GFCI.` });
      outlets.filter((o) => !String(o.library_id || "").includes("gfci") && !o.dedicated).forEach((o) => {
        warnings.push({ severity: "error", code: "kitchen-gfci", text: `${room.name}: ${o.name} should be GFCI (override violates NEC 210.8).` });
      });
    }
    if (kind === "bath") {
      if (!outlets.some((o) => String(o.library_id || "").includes("gfci"))) {
        warnings.push({ severity: "error", code: "bath-gfci", text: `${room.name}: at least one 20A GFCI receptacle is required, within 3 feet of each basin.` });
      }
    }
    if ((HABITABLE.has(kind) || kind === "stair") && !lights.length) {
      warnings.push({ severity: "warn", code: "switched-light", text: `${room.name}: needs a wall-switch-controlled lighting outlet (NEC 210.70).` });
    }
    if ((kind === "hallway" || kind === "stair") && switches.length < 2 && entriesForRoom(level, room).length >= 2) {
      warnings.push({ severity: "warn", code: "3way", text: `${room.name}: two common entries — use 3-way switching (4-way if three or more locations).` });
    }
    switches.filter((s) => String(s.library_id || "").includes("dimmer")).forEach((s) => {
      if (lights.some((l) => String(l.library_id || "") === "fan-ceiling")) {
        warnings.push({ severity: "error", code: "fan-dimmer", text: `${room.name}: a standard dimmer is on a ceiling-fan motor circuit. Use a dual-rated fan/light control.` });
      }
    });
  });
  if (!findPanel(objects)) {
    warnings.push({ severity: "warn", code: "panel", text: "No electrical panel is on this plan. The electrician placed a 200A panel symbol so home-runs have a destination." });
  }
  return warnings;
}

export function completeElectricalDesign(level, { projectType = "", roomId = "" } = {}) {
  const rooms = (level.rooms || []).filter((r) => !roomId || r.id === roomId);
  const notes = [];
  if (!rooms.length) {
    return {
      level,
      report: {
        code: KY_CODE,
        circuits: [],
        warnings: [{ severity: "error", code: "rooms", text: "Draw rooms first, then run Complete electrical design." }],
        instructions: [],
        disclaimer: ELEC_DISCLAIMER,
      },
    };
  }

  const targetIds = new Set(rooms.map((r) => r.id));
  const pointRoom = (obj) => (level.rooms || []).find((r) => {
    const x = inches(obj.x) + inches(obj.width) / 2;
    const y = inches(obj.y) + inches(obj.depth) / 2;
    return x >= inches(r.x) - 8 && x <= inches(r.x) + inches(r.width) + 8
      && y >= inches(r.y) - 8 && y <= inches(r.y) + inches(r.depth) + 8;
  });
  const kept = (level.objects || []).filter((obj) => {
    if (!obj.elec_auto) return true;
    if (!roomId) return false;
    const owner = pointRoom(obj);
    return owner ? !targetIds.has(owner.id) : false;
  });
  let working = { ...level, objects: kept };
  const extra = [];
  rooms.forEach((room) => {
    const result = placeRoomDevices(working, room, projectType);
    extra.push(...result.added);
    notes.push(...result.warnings);
  });

  const withDevices = { ...working, objects: [...kept, ...extra] };
  const panelResult = placePanel(withDevices, rooms.length ? (level.rooms || rooms) : rooms);
  const objects = panelResult.added && panelResult.panel
    ? [...withDevices.objects, panelResult.panel]
    : withDevices.objects;

  const grouped = groupCircuits(objects, level.rooms || rooms, projectType);
  const assigned = objects.map((obj) => {
    const circuit = grouped.circuits.find((c) => (c.device_ids || []).includes(obj.id));
    return circuit ? { ...obj, circuit_id: circuit.id, circuit_label: circuit.description } : obj;
  });

  const audit = auditElectricalDesign({ ...level, objects: assigned }, { projectType });
  const warnings = [
    ...notes.map((text) => ({ severity: "warn", code: "place", text })),
    ...grouped.warnings.map((text) => ({ severity: "error", code: "load", text })),
    ...audit,
  ];

  const instructions = grouped.circuits.map((c) => ({
    circuit_id: c.id,
    title: `${c.id} · ${c.amps}A ${c.poles === 2 ? "2-pole " : ""}${c.cable} · ${c.protection}`,
    body: [`Breaker ${c.breaker}: ${c.description}.`, ...(c.instructions || [])],
  }));

  const report = {
    code: KY_CODE,
    generated_at: new Date().toISOString(),
    circuits: grouped.circuits.map(({ instructions: _i, ...rest }) => rest),
    warnings,
    instructions,
    disclaimer: ELEC_DISCLAIMER,
    device_count: assigned.filter((o) => o.elec_auto).length,
  };

  return {
    level: {
      ...level,
      objects: assigned,
      electrical: report,
    },
    report,
  };
}

export function adviseDevice(obj, { rooms = [], projectType = "" } = {}) {
  const id = String(obj?.library_id || "");
  const room = (rooms || []).find((r) => {
    const x = inches(obj?.x) + inches(obj?.width) / 2;
    const y = inches(obj?.y) + inches(obj?.depth) / 2;
    return x >= inches(r.x) && x <= inches(r.x) + inches(r.width)
      && y >= inches(r.y) && y <= inches(r.y) + inches(r.depth);
  });
  const kind = classifyRoom(room?.name || "", projectType);
  const spec = applianceSpec(obj);
  const travelers = /3way|4way|fan-light/.test(id);
  const amps = spec?.amps || (gfciRequired(kind) && id.startsWith("outlet") ? 20 : 15);
  const volts = spec?.volts || (id.includes("240") ? 240 : 120);
  const wire = wireForAmps(amps, { travelers, volts });
  const gfci = spec ? spec.gfci : gfciRequired(kind) || id.includes("gfci");
  const afci = spec ? spec.afci : afciRequired(kind);
  const warnings = [];
  if (kind === "kitchen" && id.startsWith("outlet") && !id.includes("gfci") && !spec && !obj?.dedicated) {
    warnings.push("Kitchen countertop receptacles must be GFCI on 20A small-appliance circuits.");
  }
  if ((obj?.elec_override || (id.startsWith("outlet-duplex") && gfciRequired(kind))) && !obj?.dedicated && !spec) {
    warnings.push("This device type may not meet the required protection for this room. The panel schedule will flag it.");
  }
  return {
    name: obj?.name || "Device",
    circuit: obj?.circuit_label || spec?.label || (id.startsWith("switch") ? "Lighting" : "Branch circuit"),
    circuit_id: obj?.circuit_id || "",
    amps: wire.breaker,
    volts: wire.volts,
    wire: wire.cable,
    awg: wire.awg,
    dedicated: Boolean(spec?.dedicated || obj?.dedicated),
    gfci,
    afci,
    tamper_resistant: id.startsWith("outlet") && !id.includes("240"),
    weather_resistant: id.includes("wr") || kind === "outdoor" || kind === "garage",
    home_run: obj?.circuit_id
      ? `Assigned to ${obj.circuit_id}. Home-run ${wire.cable} to the panel.`
      : `Home-run ${wire.cable} to a ${wire.breaker}A ${protectionLabel({ gfci, afci })} breaker.`,
    colors: wire.volts >= 240
      ? [
        { name: "Hot 1", color: "#111111", role: "black" },
        { name: "Hot 2", color: "#C62828", role: "red" },
        { name: "Neutral", color: "#F4F1EA", role: "white" },
        { name: "Ground", color: "#2E7D32", role: "ground" },
      ]
      : [
        { name: "Hot", color: "#111111", role: "black" },
        { name: "Neutral", color: "#F4F1EA", role: "white" },
        { name: "Traveler / switched", color: "#C62828", role: "red" },
        { name: "Ground", color: "#2E7D32", role: "ground" },
      ],
    warnings,
    room: room?.name || "",
    kind,
    disclaimer: ELEC_DISCLAIMER,
  };
}

export function homeRunPath(from, to) {
  if (!from || !to) return [];
  const ax = inches(from.x) + inches(from.width) / 2;
  const ay = inches(from.y) + inches(from.depth) / 2;
  const bx = inches(to.x) + inches(to.width) / 2;
  const by = inches(to.y) + inches(to.depth) / 2;
  return [{ x: ax, y: ay }, { x: bx, y: ay }, { x: bx, y: by }];
}

export function findPanelObject(objects) {
  return findPanel(objects);
}

export function isElectricalObject(obj) {
  const tags = obj?.tags || [];
  const id = String(obj?.library_id || "");
  return tags.includes("electrical") || tags.includes("appliance") || tags.includes("light")
    || id.startsWith("outlet") || id.startsWith("switch") || id.startsWith("fan") || id.startsWith("panel")
    || id.startsWith("range") || id.startsWith("fridge") || id.startsWith("dw-") || id.startsWith("micro")
    || id.startsWith("wh-") || id.startsWith("hvac") || id.startsWith("washer") || id.startsWith("dryer")
    || id === "disposal" || id.startsWith("light");
}
