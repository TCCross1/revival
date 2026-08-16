import { inches, round2, uid } from "./units";

const CAN = 6;
const FLUSH = 12;

function gridAxes(length, count, inset) {
  const n = Math.max(1, count);
  if (n === 1) return [round2(length / 2)];
  const usable = Math.max(length - inset * 2, 8);
  const step = usable / (n - 1);
  return Array.from({ length: n }, (_, i) => round2(inset + step * i));
}

function bestGrid(count, width, depth) {
  const total = Math.max(1, count);
  let cols = Math.max(1, Math.round(Math.sqrt(total * (width / Math.max(depth, 1)))));
  cols = Math.min(total, Math.max(1, cols));
  let rows = Math.ceil(total / cols);
  if (rows * cols < total) cols = Math.ceil(total / rows);
  return { cols, rows };
}

export function lightingCountForRoom(room, spacingIn = 48) {
  const width = inches(room?.width);
  const depth = inches(room?.depth);
  const inset = Math.max(24, spacingIn / 2);
  const cols = Math.max(1, Math.round((width - inset * 2) / spacingIn) + 1);
  const rows = Math.max(1, Math.round((depth - inset * 2) / spacingIn) + 1);
  if (width < 72 && depth < 72) return 1;
  return cols * rows;
}

export function lightingPoints(room, options = {}) {
  const width = inches(room?.width);
  const depth = inches(room?.depth);
  const ceiling = inches(options.ceilingHeight || room?.ceiling_height || 96);
  const spacing = Math.max(36, Math.min(inches(options.spacing) || ceiling * 0.55 || 48, 72));
  const inset = Math.max(24, Math.min(spacing / 2, Math.min(width, depth) / 4));
  const mode = options.mode === "quantity" ? "quantity" : "auto";
  const wanted = mode === "quantity"
    ? Math.max(1, Math.min(Number(options.quantity) || 1, 36))
    : lightingCountForRoom(room, spacing);
  const { cols, rows } = bestGrid(wanted, width, depth);
  const xs = gridAxes(width, cols, inset);
  const ys = gridAxes(depth, rows, inset);
  const points = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (points.length >= wanted) break;
      points.push({
        x: round2(inches(room.x) + xs[c] - (options.mount === "flush" ? FLUSH : CAN) / 2),
        y: round2(inches(room.y) + ys[r] - (options.mount === "flush" ? FLUSH : CAN) / 2),
      });
    }
  }
  return points;
}

export function emptyLight(point, options = {}) {
  const flush = options.mount === "flush";
  const size = flush ? FLUSH : CAN;
  return {
    id: uid(),
    library_id: flush ? "light-flush" : "light-recessed",
    name: flush ? "Flush mount" : "Recessed can",
    group: "Lighting",
    tags: ["light", flush ? "flush" : "recessed"],
    x: round2(point.x),
    y: round2(point.y),
    width: size,
    depth: size,
    height: 4,
    rotation: 0,
    work: "new",
    note: options.note || "",
    auto: Boolean(options.auto),
    light_mount: flush ? "flush" : "recessed",
  };
}

export function placeRoomLights(level, room, options = {}) {
  if (!room) return level;
  const mount = options.mount === "flush" ? "flush" : "recessed";
  const keep = (level.objects || []).filter((obj) => {
    const autoLight = obj.auto && (obj.tags || []).includes("light") && obj.light_room_id === room.id;
    return !autoLight;
  });
  const points = lightingPoints(room, { ...options, mount });
  const lights = points.map((pt) => ({
    ...emptyLight(pt, { mount, auto: true, note: options.note || "" }),
    light_room_id: room.id,
  }));
  return { ...level, objects: [...keep, ...lights] };
}

export function placeSinkLight(level, sink, options = {}) {
  if (!sink) return level;
  const mount = options.mount === "flush" ? "flush" : "recessed";
  const size = mount === "flush" ? FLUSH : CAN;
  const light = {
    ...emptyLight({
      x: inches(sink.x) + inches(sink.width) / 2 - size / 2,
      y: inches(sink.y) + inches(sink.depth) / 2 - size / 2,
    }, { mount, auto: false, note: "Over sink" }),
  };
  return { ...level, objects: [...(level.objects || []), light] };
}
