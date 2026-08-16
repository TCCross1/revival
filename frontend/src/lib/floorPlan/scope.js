import { formatFtIn, inches, round2 } from "./units";
import { wallLength } from "./model";
import { FLOORING, FINISH_VARIANTS } from "./library";
import { computeTakeoffs } from "./calc";
import {
  lineAmount, priceAppliance, priceBath, priceCabinet, priceCounter,
  priceFiller, priceFlooring, priceLight, priceOpening, priceStructural,
} from "./priceBook";

export const WORK_KINDS = [
  { id: "existing", name: "Existing", color: "#0A4D68" },
  { id: "demo", name: "Demolition", color: "#C62828" },
  { id: "new", name: "New work", color: "#2E7D32" },
];

export const WALL_FINISHES = [
  { id: "", name: "Unspecified" },
  { id: "paint", name: "Paint" },
  { id: "tile", name: "Tile" },
  { id: "shiplap", name: "Shiplap" },
  { id: "wainscot", name: "Wainscot" },
  { id: "wallpaper", name: "Wallpaper" },
];

export function workOf(item) {
  return item?.work || "existing";
}

export function visibleForPhase(item, phase) {
  const work = workOf(item);
  if (phase === "before") return work !== "new";
  if (phase === "after") return work !== "demo";
  return true;
}

export function finishName(id, obj) {
  if (obj?.finish === "custom" && obj?.color) return `Custom ${obj.color}`;
  if (obj?.species && obj.species !== "painted") {
    const wood = (obj.species || "").replace("-", " ");
    return `${wood} · ${(FINISH_VARIANTS.find((f) => f.id === (id || "")) || FINISH_VARIANTS[0]).name}`;
  }
  return (FINISH_VARIANTS.find((f) => f.id === (id || "")) || FINISH_VARIANTS[0]).name;
}

export function flooringName(id) {
  return (FLOORING.find((f) => f.id === id) || FLOORING[0]).name;
}

function roomNameFor(obj, rooms) {
  const x = inches(obj.x) + inches(obj.width) / 2;
  const y = inches(obj.y) + inches(obj.depth) / 2;
  const room = (rooms || []).find((r) => x >= inches(r.x) && x <= inches(r.x) + inches(r.width) && y >= inches(r.y) && y <= inches(r.y) + inches(r.depth));
  return room?.name || "";
}

function addQty(map, key, row) {
  const prev = map.get(key);
  if (prev) {
    prev.quantity = round2(prev.quantity + row.quantity);
    return;
  }
  map.set(key, { ...row });
}

export function buildScope(document) {
  const takeoffs = computeTakeoffs(document);
  const items = new Map();
  const cabinets = [];
  const appliances = [];
  const lighting = [];
  const notes = [];
  const finishes = [];
  const doors = [];
  const windows = [];

  (document?.levels || []).forEach((level) => {
    const rooms = level.rooms || [];
    rooms.forEach((room) => {
      const sf = round2((inches(room.width) * inches(room.depth)) / 144);
      addQty(items, `floor:${room.flooring || "lvp"}`, {
        description: `${flooringName(room.flooring)} flooring — ${level.name}`,
        quantity: sf,
        unit: "SF",
        unit_price: priceFlooring(room.flooring),
        group: "Flooring",
      });
      if (room.wall_finish) {
        finishes.push({
          location: `${room.name} · ${level.name}`,
          item: "Walls",
          finish: WALL_FINISHES.find((f) => f.id === room.wall_finish)?.name || room.wall_finish,
        });
      }
      finishes.push({
        location: `${room.name} · ${level.name}`,
        item: "Floor",
        finish: flooringName(room.flooring),
      });
      if (room.note || room.notes) notes.push({ target: room.name, text: room.note || room.notes, level: level.name });
    });

    (level.objects || []).forEach((obj) => {
      const loc = roomNameFor(obj, rooms) || level.name;
      const size = `${formatFtIn(obj.width)} × ${formatFtIn(obj.depth)}`;
      const tags = obj.tags || [];
      const id = String(obj.library_id || "");
      if (tags.includes("filler") || id.startsWith("filler")) {
        cabinets.push({
          name: obj.name,
          size,
          location: loc,
          finish: finishName(obj.finish, obj),
          work: workOf(obj),
          note: obj.note || "Cabinet filler",
        });
        addQty(items, `filler:${round2(inches(obj.width))}:${obj.finish || ""}`, {
          description: `${obj.name || "Cabinet filler"} (${formatFtIn(obj.width)} wide)`,
          quantity: 1,
          unit: "EA",
          unit_price: priceFiller(obj),
          group: "Cabinets",
        });
      } else if (tags.includes("cabinet") || id.startsWith("cab-") || id.startsWith("island") || id.startsWith("vanity") || id.startsWith("peninsula")) {
        cabinets.push({
          name: obj.name,
          size,
          location: loc,
          finish: finishName(obj.finish, obj),
          work: workOf(obj),
          note: [obj.door_style, obj.glass, obj.crown].filter(Boolean).join(" · ") || obj.note || "",
        });
        addQty(items, `cab:${obj.library_id}:${obj.finish || ""}:${obj.door_style || ""}`, {
          description: `${obj.name} (${size})${obj.door_style ? ` · ${obj.door_style}` : ""}${obj.finish ? ` · ${finishName(obj.finish, obj)}` : ""}`,
          quantity: 1,
          unit: "EA",
          unit_price: priceCabinet(obj, id),
          group: "Cabinets",
        });
      } else if (tags.includes("countertop") || id.startsWith("counter")) {
        addQty(items, `top:${obj.counter_material || obj.finish || "quartz"}:${obj.width}x${obj.depth}`, {
          description: `${obj.name || "Countertop"} · ${obj.counter_material || "quartz"} (${size})`,
          quantity: round2((inches(obj.width) * inches(obj.depth)) / 144),
          unit: "SF",
          unit_price: priceCounter(obj.counter_material),
          group: "Countertops",
        });
      } else if (tags.includes("appliance") || /^(range|fridge|dw-|micro|washer|dryer|disposal)/.test(id)) {
        appliances.push({ name: obj.name, size, location: loc, note: obj.appliance_finish || obj.note || "", work: workOf(obj) });
        addQty(items, `app:${obj.library_id}:${obj.appliance_finish || ""}`, {
          description: `${obj.name}${obj.appliance_finish ? ` · ${obj.appliance_finish}` : ""}`,
          quantity: 1,
          unit: "EA",
          unit_price: priceAppliance(id, obj.appliance_finish),
          group: "Appliances",
        });
      } else if (tags.includes("light") || tags.includes("electrical") || id.startsWith("fan-") || id.startsWith("light-")) {
        lighting.push({ name: obj.name, location: loc, note: obj.note || "" });
        addQty(items, `lt:${obj.library_id}`, {
          description: obj.name,
          quantity: 1,
          unit: "EA",
          unit_price: priceLight(id),
          group: "Lighting / electrical",
        });
      } else if (tags.includes("shower") || tags.includes("tub") || id.startsWith("shower") || id.startsWith("tub")) {
        addQty(items, `bath:${obj.library_id}`, {
          description: `${obj.name} (${size})`,
          quantity: 1,
          unit: "EA",
          unit_price: priceBath(id),
          group: "Bath",
        });
      } else if (workOf(obj) === "new" || tags.includes("lvl")) {
        addQty(items, `obj:${obj.library_id}`, {
          description: obj.name,
          quantity: 1,
          unit: "EA",
          unit_price: 125,
          group: obj.group || "General",
        });
      }
      if (obj.note) notes.push({ target: obj.name, text: obj.note, level: loc });
      if (obj.finish && (tags.includes("cabinet") || id.startsWith("cab-") || id.startsWith("vanity"))) {
        finishes.push({ location: loc, item: obj.name, finish: finishName(obj.finish) });
      }
    });

    (level.walls || []).forEach((wall) => {
      (wall.openings || []).forEach((op) => {
        const row = {
          type: op.type,
          style: op.style || "",
          size: `${formatFtIn(op.width)} × ${formatFtIn(op.height || (op.type === "window" ? 48 : 80))}`,
          swing: op.type === "door" ? `${op.swing || "left"} / ${op.direction || "in"}` : "—",
          material: op.material || op.style || "—",
          work: workOf(wall),
          level: level.name,
        };
        if (op.type === "window") windows.push(row);
        else doors.push(row);
        addQty(items, `${op.type}:${op.style}:${op.material || ""}:${op.install || ""}:${op.width}`, {
          description: `${op.type === "window" ? "Window" : op.type === "cased" ? "Cased opening" : "Door"} ${row.size} ${op.style || ""} ${op.material || ""} ${op.install === "replacement" ? "box replacement" : op.install === "new-construction" ? "new construction / extension jambs" : ""}`.trim(),
          quantity: 1,
          unit: "EA",
          unit_price: priceOpening(op.type, op.style, op.material, op.install),
          group: "Openings",
        });
      });
      if (wall.note) notes.push({ target: `${wall.kind} wall`, text: wall.note, level: level.name });
    });

    (level.beams || []).forEach((beam) => {
      addQty(items, `lvl:${beam.plies}:${beam.depth_in}`, {
        description: `${beam.label || "LVL"} · ${formatFtIn(beam.span_in)} span`,
        quantity: round2(wallLength(beam) / 12),
        unit: "LF",
        unit_price: priceStructural(),
        group: "Structural",
      });
    });
  });

  const line_items = [...items.values()].map((row) => ({
    description: `[Plan] ${row.description}`,
    quantity: row.quantity,
    unit_price: row.unit_price || 0,
    amount: lineAmount(row.quantity, row.unit_price),
    unit: row.unit,
    group: row.group,
  }));

  return {
    line_items,
    cabinets,
    appliances,
    lighting,
    doors,
    windows,
    finishes,
    notes,
    takeoffs,
    special_order: line_items.filter((i) => /cabinet|appliance|lvl|shower|range|fridge|filler/i.test(i.description)),
  };
}

export function estimatePayloadFromScope(scope, meta) {
  return {
    client_id: meta.client_id || "",
    client_name: meta.client_name || "",
    category: meta.project_type || "Kitchen",
    status: "Draft",
    line_items: (scope.line_items || []).map((i) => ({
      description: i.description,
      quantity: i.quantity,
      unit_price: i.unit_price || 0,
      amount: lineAmount(i.quantity, i.unit_price),
    })),
    notes: `Preliminary quantities from Floor Plan Studio${meta.address ? ` — ${meta.address}` : ""}. Confirm in the field before ordering.`,
    floor_plan_id: meta.plan_id || "",
  };
}
