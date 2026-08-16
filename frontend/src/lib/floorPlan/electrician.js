import { inches } from "./units";

export const ELEC_DISCLAIMER = "Field guidance from typical NEC residential practice. Confirm nameplate, local amendments, and the AHJ.";

const BY_ID = {
  "outlet-duplex": { circuit: "General lighting / receptacle", amps: 15, wire: "14-2 NM-B or 12-2", volts: 120, dedicated: false, gfci: "if wet", afci: true, home: "Home-run to nearest AFCI breaker. 12-2 is the safer remodel default." },
  "outlet-gfci": { circuit: "GFCI receptacle", amps: 20, wire: "12-2 NM-B", volts: 120, dedicated: false, gfci: true, afci: "often both", home: "Kitchen, bath, laundry, garage, and outdoor need GFCI. Use 12-2 on a 20A." },
  "outlet-afci": { circuit: "AFCI-protected receptacle", amps: 15, wire: "12-2 NM-B", volts: 120, dedicated: false, gfci: false, afci: true, home: "Bedrooms, living, and similar rooms need combination AFCI protection at the breaker." },
  "switch": { circuit: "Lighting", amps: 15, wire: "14-2 / 12-2", volts: 120, dedicated: false, gfci: false, afci: true, home: "Switch loop: 12-2 from panel to switch, then to light. Use 12-3 for 3-way." },
  "switch-dimmer": { circuit: "Dimmed lighting", amps: 15, wire: "12-2 NM-B", volts: 120, dedicated: false, gfci: false, afci: true, home: "Match dimmer to LED load. Neutral required on most modern dimmers — pull 12-2, not a switch loop." },
  "switch-3way": { circuit: "3-way lighting", amps: 15, wire: "12-3 NM-B", volts: 120, dedicated: false, gfci: false, afci: true, home: "12-3 between the two 3-ways (black + red travelers, white neutral). Ground throughout." },
  "switch-gfci": { circuit: "GFCI switch / spa", amps: 20, wire: "12-2 NM-B", volts: 120, dedicated: true, gfci: true, afci: false, home: "Wet-location switch. Keep the box accessible. 20A / 12-2." },
  "panel": { circuit: "Service / subpanel", amps: 200, wire: "per load calc", volts: 240, dedicated: true, gfci: false, afci: false, home: "Keep 36\" clear in front. Label every breaker. New kitchen/bath circuits should land here as home-runs, not piggybacks." },
  "smoke": { circuit: "Smoke / CO interconnect", amps: 15, wire: "14-3 NM-B", volts: 120, dedicated: false, gfci: false, afci: true, home: "14-3 so alarms interconnect (red). Battery backup required. Do not GFCI this circuit." },
  "fan-ceiling": { circuit: "Ceiling fan", amps: 15, wire: "14-2 or 12-2", volts: 120, dedicated: false, gfci: false, afci: true, home: "Rated fan box. If you want separate fan/light control later, pull 12-3 now." },
  "fan-light": { circuit: "Fan + light", amps: 15, wire: "12-3 NM-B", volts: 120, dedicated: false, gfci: false, afci: true, home: "12-3 from switch: black fan, red light, white neutral, ground." },
  "range-30": { circuit: "Electric range", amps: 40, wire: "8-3 or 6-3", volts: 240, dedicated: true, gfci: "2023 often yes", afci: false, home: "Dedicated 40A/240V. 8-3 copper typical; confirm nameplate. 4-wire (two hots, neutral, ground)." },
  "range-36": { circuit: "Electric range 36\"", amps: 50, wire: "6-3 NM-B / SER", volts: 240, dedicated: true, gfci: "2023 often yes", afci: false, home: "Dedicated 50A/240V. 6-3 copper. Do not share with oven or cooktop." },
  "fridge-36": { circuit: "Refrigerator", amps: 15, wire: "12-2 NM-B", volts: 120, dedicated: true, gfci: "avoid if allowed", afci: true, home: "Dedicated 15A or 20A. Many jurisdictions still keep the fridge off GFCI so food does not spoil on a trip — check the AHJ." },
  "dw-24": { circuit: "Dishwasher", amps: 15, wire: "12-2 NM-B", volts: 120, dedicated: true, gfci: true, afci: true, home: "Dedicated 15A. GFCI + AFCI typical. Air-gap or high loop on the drain." },
  "micro-24": { circuit: "Microwave", amps: 20, wire: "12-2 NM-B", volts: 120, dedicated: true, gfci: "if over sink", afci: true, home: "Dedicated 20A for over-range or built-in. Do not share with the small-appliance circuits." },
  "wh-40": { circuit: "Electric tank water heater", amps: 30, wire: "10-2 NM-B", volts: 240, dedicated: true, gfci: false, afci: false, home: "Dedicated 30A/240V, 10-2 with ground. Disconnect in sight. No neutral needed on most tanks." },
  "wh-50": { circuit: "Electric tank water heater 50", amps: 30, wire: "10-2 NM-B", volts: 240, dedicated: true, gfci: false, afci: false, home: "Same as 40-gal unless nameplate says 4500W+ on a 30A — then confirm 10 AWG." },
  "wh-tankless": { circuit: "Electric tankless", amps: 60, wire: "6 AWG or larger, often multiple", volts: 240, dedicated: true, gfci: false, afci: false, home: "Often 2–3 double-pole breakers (60–150A total). Confirm nameplate before rough-in. Gas tankless is 120V / 15A instead." },
  "hvac-ah": { circuit: "Air handler", amps: 20, wire: "12-2 or 10-2", volts: 120, dedicated: true, gfci: false, afci: false, home: "Dedicated per nameplate. Disconnect at the unit. Do not share with receptacles." },
  "hvac-condenser": { circuit: "Condenser / heat pump", amps: 30, wire: "10-2 or 8-2", volts: 240, dedicated: true, gfci: false, afci: false, home: "Size from MCA/MOP on the data plate. Fused disconnect within sight. Whip to the unit." },
  "washer": { circuit: "Laundry receptacle", amps: 20, wire: "12-2 NM-B", volts: 120, dedicated: true, gfci: true, afci: true, home: "One 20A laundry circuit. GFCI required. Do not feed the dryer from this." },
  "dryer": { circuit: "Electric dryer", amps: 30, wire: "10-3 NM-B", volts: 240, dedicated: true, gfci: "2023 often yes", afci: false, home: "Dedicated 30A/240V, 10-3 (two hots, neutral, ground). 4-prong receptacle." },
  "disposal": { circuit: "Disposal", amps: 15, wire: "12-2 NM-B", volts: 120, dedicated: true, gfci: true, afci: true, home: "Dedicated 15A. Switch above the sink. GFCI protection required." },
};

const TAG_FALLBACK = {
  appliance: { circuit: "Appliance", amps: 20, wire: "12-2 NM-B", volts: 120, dedicated: true, gfci: "if wet", afci: true, home: "Give major appliances their own home-run. Read the nameplate before pulling wire." },
  electrical: { circuit: "Branch circuit", amps: 15, wire: "12-2 NM-B", volts: 120, dedicated: false, gfci: "if wet", afci: true, home: "12-2 on 15A or 20A is the remodel default. Home-run to the panel — avoid fishing through old boxes." },
  light: { circuit: "Lighting", amps: 15, wire: "14-2 or 12-2", volts: 120, dedicated: false, gfci: false, afci: true, home: "Lighting can share a 15A AFCI circuit. Keep baths on their own 20A if you can." },
};

function roomContext(obj, rooms, projectType) {
  const x = inches(obj?.x) + inches(obj?.width) / 2;
  const y = inches(obj?.y) + inches(obj?.depth) / 2;
  const room = (rooms || []).find((r) => x >= inches(r.x) && x <= inches(r.x) + inches(r.width) && y >= inches(r.y) && y <= inches(r.y) + inches(r.depth));
  const name = `${room?.name || ""} ${projectType || ""}`.toLowerCase();
  return {
    room,
    wet: /bath|kitchen|laundry|garage|outdoor|deck|patio|bar/.test(name),
    kitchen: /kitchen/.test(name),
    bath: /bath/.test(name),
    bedroom: /bed/.test(name),
  };
}

export function adviseElectrician(obj, { rooms = [], projectType = "" } = {}) {
  const id = String(obj?.library_id || obj?.id || "");
  const tags = obj?.tags || [];
  const base = BY_ID[id] || (tags.includes("appliance") ? TAG_FALLBACK.appliance : tags.includes("light") ? TAG_FALLBACK.light : TAG_FALLBACK.electrical);
  const ctx = roomContext(obj, rooms, projectType);
  const warnings = [];
  let gfci = base.gfci;
  let wire = base.wire;
  let amps = base.amps;
  if (ctx.wet && (id.startsWith("outlet") || tags.includes("electrical"))) {
    gfci = true;
    if (amps < 20 && (ctx.kitchen || ctx.bath)) {
      amps = 20;
      wire = "12-2 NM-B";
    }
    warnings.push("GFCI required in kitchens, baths, laundry, garages, and outdoors.");
  }
  if (ctx.kitchen && id.startsWith("outlet") && !id.includes("gfci")) {
    warnings.push("Kitchen countertop receptacles: two or more 20A small-appliance circuits, all GFCI. No lighting on those circuits.");
  }
  if (ctx.bath && (id.startsWith("outlet") || id.startsWith("switch"))) {
    warnings.push("At least one 20A bathroom receptacle circuit. A single 20A may serve one bathroom’s outlets and lights if local code allows.");
  }
  if (ctx.bedroom && base.afci) {
    warnings.push("AFCI protection required for bedrooms and most living areas.");
  }
  if (base.dedicated) {
    warnings.push(`Dedicated ${amps}A / ${base.volts}V circuit — do not share this home-run.`);
  }
  if (base.volts === 240) {
    warnings.push("240V: black and red (or black/black) are hots, white is neutral if present, bare/green is ground. Land on a double-pole breaker.");
  }
  return {
    name: obj?.name || "Device",
    circuit: base.circuit,
    amps,
    volts: base.volts,
    wire,
    dedicated: Boolean(base.dedicated),
    gfci,
    afci: base.afci,
    home_run: base.home,
    colors: base.volts === 240
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
    room: ctx.room?.name || "",
    disclaimer: ELEC_DISCLAIMER,
  };
}

export function isElectricalObject(obj) {
  const tags = obj?.tags || [];
  const id = String(obj?.library_id || "");
  return tags.includes("electrical") || tags.includes("appliance") || tags.includes("light")
    || id.startsWith("outlet") || id.startsWith("switch") || id.startsWith("fan") || id.startsWith("panel")
    || id.startsWith("range") || id.startsWith("fridge") || id.startsWith("dw-") || id.startsWith("micro")
    || id.startsWith("wh-") || id.startsWith("hvac") || id.startsWith("washer") || id.startsWith("dryer") || id === "disposal";
}

export function isApplianceObject(obj) {
  const tags = obj?.tags || [];
  const id = String(obj?.library_id || "");
  return tags.includes("appliance") || /^(range|fridge|dw-|micro|wh-|hvac|washer|dryer|disposal)/.test(id);
}

export function findPanel(objects) {
  return (objects || []).find((o) => String(o.library_id || "") === "panel" || /panel/i.test(o.name || ""));
}

export function homeRunPath(from, to) {
  if (!from || !to) return [];
  const ax = inches(from.x) + inches(from.width) / 2;
  const ay = inches(from.y) + inches(from.depth) / 2;
  const bx = inches(to.x) + inches(to.width) / 2;
  const by = inches(to.y) + inches(to.depth) / 2;
  return [{ x: ax, y: ay }, { x: bx, y: ay }, { x: bx, y: by }];
}
