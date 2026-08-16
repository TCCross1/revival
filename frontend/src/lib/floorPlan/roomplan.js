import { emptyLevel, emptyRoom, emptyWall, emptyOpening } from "./model";

function metersToInches(value) {
  return Number(value || 0) * 39.3701;
}

export function hasNativeRoomPlan() {
  try {
    return Boolean(window.webkit?.messageHandlers?.roomPlan);
  } catch {
    return false;
  }
}

export function isIPhone() {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function requestNativeScan() {
  if (!hasNativeRoomPlan()) return false;
  window.webkit.messageHandlers.roomPlan.postMessage({ action: "scan" });
  return true;
}

export function importRoomPlan(payload, existingLevel) {
  const data = payload || {};
  const metric = String(data.units || "").toLowerCase().startsWith("m") || data.meters === true;
  const scale = metric ? 39.3701 : 1;
  const target = existingLevel ? { ...existingLevel, rooms: [...(existingLevel.rooms || [])], walls: [...(existingLevel.walls || [])] } : emptyLevel("LiDAR Scan", 0);

  const pt = (value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return [Number(value.x || 0) * scale, Number(value.y || 0) * scale];
    }
    if (Array.isArray(value) && value.length >= 2) return [Number(value[0]) * scale, Number(value[1]) * scale];
    return [0, 0];
  };

  (data.rooms || []).forEach((raw) => {
    const [x, y] = pt(raw.origin || raw);
    const w = raw.width_in ? Number(raw.width_in) : Number(raw.width || raw.dimensions?.width || 120) * (raw.width_in ? 1 : scale);
    const d = raw.depth_in ? Number(raw.depth_in) : Number(raw.depth || raw.length || raw.dimensions?.depth || 120) * (raw.depth_in ? 1 : scale);
    target.rooms.push(emptyRoom(raw.name || "Scanned room", x, y, w, d));
  });

  (data.walls || []).forEach((raw) => {
    let x1;
    let y1;
    let x2;
    let y2;
    if (raw.start && raw.end) {
      [x1, y1] = pt(raw.start);
      [x2, y2] = pt(raw.end);
    } else if (raw.x1 != null) {
      x1 = Number(raw.x1) * scale;
      y1 = Number(raw.y1) * scale;
      x2 = Number(raw.x2) * scale;
      y2 = Number(raw.y2) * scale;
    } else {
      return;
    }
    target.walls.push(emptyWall(x1, y1, x2, y2, raw.kind || "exterior"));
  });

  const addOpening = (kind, raw) => {
    if (!target.walls.length) return;
    const opening = emptyOpening(kind);
    const w = Number(raw.width || opening.width);
    opening.width = w > 20 ? w : w * (metric ? metersToInches(1) / 39.3701 : 1);
    opening.offset = Number(raw.offset || 12);
    target.walls[0] = { ...target.walls[0], openings: [...(target.walls[0].openings || []), opening] };
  };
  (data.doors || []).forEach((raw) => addOpening("door", raw));
  (data.windows || []).forEach((raw) => addOpening("window", raw));

  if (!target.rooms.length && !target.walls.length) {
    throw new Error("That scan did not include rooms or walls we could read.");
  }
  return target;
}
