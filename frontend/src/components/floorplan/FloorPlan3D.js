import { useEffect, useMemo, useRef, useState } from "react";
import { FLOORING, applianceFill, cabinetFill, counterFill, isApplianceFinishObject, isBaseRunObject, isCabinetObject, isCountertopObject, isWallCabinetObject } from "@/lib/floorPlan/library";
import { objectFootprint } from "@/lib/floorPlan/cabinetRun";
import { DEFAULT_LAYERS, layerOn, objectLayer, objectVisible } from "@/lib/floorPlan/layers";
import { visibleForPhase } from "@/lib/floorPlan/scope";
import { toast } from "sonner";

const LIGHT = { x: 0.28, y: 0.92, z: -0.18 };
const CUTAWAY_INTERIOR_H = 26;
const CUTAWAY_EXTERIOR_H = 34;

function flooringColor(id) {
  return (FLOORING.find((f) => f.id === id) || FLOORING[0]).color;
}

function mixHex(hex, amount) {
  const raw = String(hex || "#8A8F93").replace("#", "");
  if (raw.length < 6) return "#8A8F93";
  const n = parseInt(raw.slice(0, 6), 16);
  const r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 255) * amount)));
  const g = Math.max(0, Math.min(255, Math.round(((n >> 8) & 255) * amount)));
  const b = Math.max(0, Math.min(255, Math.round((n & 255) * amount)));
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

function clampPitch(pitch) {
  return Math.max(0.22, Math.min(1.48, Number(pitch) || 0.22));
}

function project(x, y, z, cam) {
  const dx = x - cam.tx;
  const dz = z - cam.tz;
  const cos = Math.cos(cam.yaw);
  const sin = Math.sin(cam.yaw);
  const rx = dx * cos - dz * sin;
  const rz = dx * sin + dz * cos;
  const pitch = clampPitch(cam.pitch);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const ry = (y - cam.ty) * cp + rz * sp;
  const depth = rz * cp - (y - cam.ty) * sp + cam.dist;
  const f = 520 / Math.max(depth, 40);
  return { x: 400 + rx * f, y: 268 - ry * f, depth };
}

function cameraPos(cam) {
  const pitch = clampPitch(cam.pitch);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  return {
    x: cam.tx - Math.sin(cam.yaw) * cp * cam.dist,
    y: cam.ty + sp * cam.dist,
    z: cam.tz - Math.cos(cam.yaw) * cp * cam.dist,
  };
}

function wallBlocksView(wall, cam) {
  if (!cam) return false;
  const midX = (Number(wall.x1) + Number(wall.x2)) / 2;
  const midZ = (Number(wall.y1) + Number(wall.y2)) / 2;
  const pos = cameraPos(cam);
  const nx = -(Number(wall.y2) - Number(wall.y1));
  const nz = Number(wall.x2) - Number(wall.x1);
  const camSide = nx * (pos.x - midX) + nz * (pos.z - midZ);
  const tgtSide = nx * (cam.tx - midX) + nz * (cam.tz - midZ);
  return camSide * tgtSide < 0;
}

function faceNormal(pts) {
  const a = pts[0];
  const b = pts[1];
  const c = pts[2];
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

function shadeOf(pts, hex) {
  const [nx, ny, nz] = faceNormal(pts);
  const lit = Math.max(0, nx * LIGHT.x + ny * LIGHT.y + nz * LIGHT.z);
  return mixHex(hex, 0.48 + 0.52 * lit);
}

function rotateY(x, z, cx, cz, deg) {
  const r = ((Number(deg) || 0) * Math.PI) / 180;
  const dx = x - cx;
  const dz = z - cz;
  return [cx + dx * Math.cos(r) - dz * Math.sin(r), cz + dx * Math.sin(r) + dz * Math.cos(r)];
}

function pushFace(faces, pts, color, opacity = 1, bias = 0) {
  if (!pts || pts.length < 3) return;
  faces.push({ pts, color, opacity, bias });
}

function addBox(faces, x, z, w, d, y0, h, color, rotation = 0, opacity = 1, bias = 0) {
  const cx = x + w / 2;
  const cz = z + d / 2;
  const corner = (px, pz) => rotateY(px, pz, cx, cz, rotation);
  const [x0, z0] = corner(x, z);
  const [x1, z1] = corner(x + w, z);
  const [x2, z2] = corner(x + w, z + d);
  const [x3, z3] = corner(x, z + d);
  addPrism(faces, [x0, z0], [x1, z1], [x2, z2], [x3, z3], y0, h, color, opacity, bias);
}

function addPrism(faces, p0, p1, p2, p3, y0, h, color, opacity = 1, bias = 0) {
  const y1 = y0 + h;
  pushFace(faces, [[p0[0], y1, p0[1]], [p1[0], y1, p1[1]], [p2[0], y1, p2[1]], [p3[0], y1, p3[1]]], color, opacity, bias);
  pushFace(faces, [[p0[0], y0, p0[1]], [p1[0], y0, p1[1]], [p1[0], y1, p1[1]], [p0[0], y1, p0[1]]], color, opacity, bias);
  pushFace(faces, [[p1[0], y0, p1[1]], [p2[0], y0, p2[1]], [p2[0], y1, p2[1]], [p1[0], y1, p1[1]]], color, opacity, bias);
  pushFace(faces, [[p2[0], y0, p2[1]], [p3[0], y0, p3[1]], [p3[0], y1, p3[1]], [p2[0], y1, p2[1]]], color, opacity, bias);
  pushFace(faces, [[p3[0], y0, p3[1]], [p0[0], y0, p0[1]], [p0[0], y1, p0[1]], [p3[0], y1, p3[1]]], color, opacity, bias);
}

function addWallRun(faces, a, b, thick, y0, h, color, opacity = 1) {
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  const nx = (-(b.z - a.z) / len) * (thick / 2);
  const nz = ((b.x - a.x) / len) * (thick / 2);
  addPrism(
    faces,
    [a.x + nx, a.z + nz],
    [b.x + nx, b.z + nz],
    [b.x - nx, b.z - nz],
    [a.x - nx, a.z - nz],
    y0,
    h,
    color,
    opacity,
    6,
  );
}

function wallPoint(wall, t) {
  const len = Math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1) || 1;
  return {
    x: wall.x1 + ((wall.x2 - wall.x1) * t) / len,
    z: wall.y1 + ((wall.y2 - wall.y1) * t) / len,
  };
}

function doorCuts(wall) {
  const len = Math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1) || 1;
  const cuts = (wall.openings || [])
    .filter((opening) => opening.type === "door" || opening.type === "cased")
    .map((opening) => ({
      a: Math.max(0, Number(opening.offset) || 0),
      b: Math.min(len, (Number(opening.offset) || 0) + (Number(opening.width) || 32)),
    }))
    .sort((left, right) => left.a - right.a);
  const segs = [];
  let cursor = 0;
  cuts.forEach((cut) => {
    if (cut.a > cursor + 0.4) segs.push({ a: cursor, b: cut.a });
    cursor = Math.max(cursor, cut.b);
  });
  if (cursor < len - 0.4) segs.push({ a: cursor, b: len });
  if (!segs.length) segs.push({ a: 0, b: len });
  return segs;
}

function objectMass(obj) {
  const layer = objectLayer(obj);
  const id = String(obj.library_id || obj.id || "");
  const rawH = Number(obj.height) || 36;
  if (layer === "lighting") return { y0: 92, h: 3 };
  if (layer === "electrical") return { y0: 42, h: 3 };
  if (layer === "countertops" || isCountertopObject(obj)) return { y0: 34.5, h: Math.max(1.25, Math.min(rawH, 2)) };
  if (id.startsWith("sink")) return { y0: 32.2, h: 8 };
  if (id.startsWith("hood") || isWallCabinetObject(obj)) return { y0: 54, h: Math.min(rawH || 30, 42) };
  if (id.startsWith("vent")) return { y0: 94, h: 2 };
  if (layer === "structure") return { y0: 90, h: Math.min(rawH || 12, 16) };
  return { y0: 0, h: Math.min(rawH || 36, 96) };
}

function applianceBodyColor(obj) {
  const finish = obj.appliance_finish || obj.finish || "stainless";
  if (finish === "panel") return cabinetFill({ ...obj, finish: obj.finish || "navy" });
  if (finish === "stainless") return "#D4DBE1";
  if (finish === "black-stainless") return "#3E454C";
  return applianceFill(obj);
}

function objectColor(obj) {
  const id = String(obj.library_id || obj.id || "");
  if (isCountertopObject(obj)) return counterFill(obj);
  if (id.startsWith("sink")) return /apron|fireclay|farm/i.test(String(obj.note || "")) ? "#F4F1EA" : "#C5CCD1";
  if (isApplianceFinishObject(obj)) return applianceBodyColor(obj);
  if (isCabinetObject(obj)) return cabinetFill(obj);
  const layer = objectLayer(obj);
  if (layer === "lighting") return "#F3D56A";
  if (layer === "plumbing") return "#D7E3E8";
  if (layer === "hvac") return "#C5CCD1";
  if (layer === "structure") return "#C45C26";
  return "#D8C4A4";
}

function fixtureLabel(obj) {
  const id = String(obj.library_id || obj.id || "");
  if (id.startsWith("range")) return "Range";
  if (id.startsWith("fridge")) return "Fridge";
  if (id.startsWith("sink")) return "Sink";
  if (id.startsWith("dw-")) return "DW";
  if (id.startsWith("micro")) return "Micro";
  if (id.startsWith("island") || /island/i.test(String(obj.name || ""))) return "Island";
  if (id === "washer") return "Washer";
  if (id === "dryer") return "Dryer";
  if (/tub|shower/.test(id)) return obj.name || "Bath";
  return "";
}

function hideInCutaway(obj) {
  const id = String(obj.library_id || obj.id || "");
  const layer = objectLayer(obj);
  if (isWallCabinetObject(obj) || id.startsWith("cab-wall")) return true;
  if (id.startsWith("hood") || id.startsWith("vent")) return true;
  if (layer === "lighting" || layer === "electrical" || layer === "structure") return true;
  return false;
}

export function cameraForLevel(level) {
  const rooms = level?.rooms || [];
  let minX = 0;
  let minZ = 0;
  let maxX = 240;
  let maxZ = 240;
  if (rooms.length) {
    minX = Math.min(...rooms.map((room) => room.x));
    minZ = Math.min(...rooms.map((room) => room.y));
    maxX = Math.max(...rooms.map((room) => room.x + room.width));
    maxZ = Math.max(...rooms.map((room) => room.y + room.depth));
  }
  const span = Math.max(maxX - minX, maxZ - minZ, 160);
  return {
    yaw: 0.62,
    pitch: 1.28,
    dist: Math.min(1200, Math.max(260, span * 1.85)),
    tx: (minX + maxX) / 2,
    ty: 18,
    tz: (minZ + maxZ) / 2,
  };
}

function collectScene(level, layers = DEFAULT_LAYERS, phase = "all", cam = null, cutaway = true) {
  const faces = [];
  const labels = [];
  try {
    if (layerOn(layers, "rooms")) {
      (level?.rooms || []).filter((room) => visibleForPhase(room, phase)).forEach((room) => {
        const x = Number(room.x) || 0;
        const z = Number(room.y) || 0;
        const w = Number(room.width) || 24;
        const d = Number(room.depth) || 24;
        const floor = flooringColor(room.flooring);
        pushFace(faces, [[x, 0, z], [x + w, 0, z], [x + w, 0, z + d], [x, 0, z + d]], mixHex(floor, 0.72), 1, 28);
        pushFace(faces, [[x + 2, 0.2, z + 2], [x + w - 2, 0.2, z + 2], [x + w - 2, 0.2, z + d - 2], [x + 2, 0.2, z + d - 2]], floor, 1, 24);
        labels.push({
          kind: "room",
          text: room.name || "Room",
          x: x + w / 2,
          y: cutaway ? 8 : 40,
          z: z + d / 2,
        });
      });
    }

    if (layerOn(layers, "walls")) {
      (level?.walls || []).filter((wall) => visibleForPhase(wall, phase)).forEach((wall) => {
        if (cutaway && wallBlocksView(wall, cam)) return;
        const thick = wall.thickness || 6;
        const fullH = wall.height || 96;
        const height = cutaway
          ? (wall.kind === "exterior" ? CUTAWAY_EXTERIOR_H : CUTAWAY_INTERIOR_H)
          : fullH;
        const color = wall.kind === "exterior" ? "#1E4F63" : "#C9D2D6";
        doorCuts(wall).forEach((seg) => {
          addWallRun(faces, wallPoint(wall, seg.a), wallPoint(wall, seg.b), thick, 0, height, color, cutaway ? 0.92 : (wall.kind === "exterior" ? 1 : 0.94));
        });
        if (!cutaway) {
          (wall.openings || []).filter((opening) => opening.type === "window").forEach((opening) => {
            const start = wallPoint(wall, Number(opening.offset) || 0);
            const end = wallPoint(wall, (Number(opening.offset) || 0) + (Number(opening.width) || 36));
            const len = Math.hypot(end.x - start.x, end.z - start.z) || 1;
            const nx = (-(end.z - start.z) / len) * 1.2;
            const nz = ((end.x - start.x) / len) * 1.2;
            const sill = Number(opening.sill) || 36;
            const head = Math.min(fullH - 6, sill + (Number(opening.height) || 48));
            pushFace(faces, [
              [start.x + nx, sill, start.z + nz],
              [end.x + nx, sill, end.z + nz],
              [end.x + nx, head, end.z + nz],
              [start.x + nx, head, start.z + nz],
            ], "#9EC4D4", 0.55, 4);
          });
        }
      });
    }

    if (!cutaway && layerOn(layers, "structure")) {
      (level?.beams || []).filter((beam) => visibleForPhase(beam, phase)).forEach((beam) => {
        const minX = Math.min(beam.x1, beam.x2);
        const minZ = Math.min(beam.y1, beam.y2);
        const w = Math.max(Math.abs(beam.x2 - beam.x1), 4);
        const d = Math.max(Math.abs(beam.y2 - beam.y1), 4);
        addBox(faces, minX, minZ, w || 4, d || 4, 90, 12, "#C45C26", 0, 0.92, -4);
      });
    }

    (level?.objects || [])
      .filter((obj) => visibleForPhase(obj, phase) && objectVisible(obj, layers))
      .forEach((obj) => {
        const layer = objectLayer(obj);
        if (layer === "electrical") return;
        if (cutaway && hideInCutaway(obj)) return;
        const id = String(obj.library_id || "");
        const mass = objectMass(obj);
        const color = objectColor(obj);
        const rot = obj.rotation || 0;
        const fp = objectFootprint(obj);
        addBox(faces, fp.x, fp.y, fp.w, fp.h, mass.y0, mass.h, color, rot, layer === "lighting" ? 0.88 : 1, -14);
        if (cutaway && isBaseRunObject(obj) && !isCountertopObject(obj) && !id.startsWith("sink") && !isApplianceFinishObject(obj)) {
          addBox(faces, fp.x - 0.4, fp.y - 0.4, fp.w + 0.8, fp.h + 0.8, 34.5, 1.5, obj.counter_material ? counterFill(obj) : "#E6E0D4", rot, 1, -16);
        }
        if (id.startsWith("range") || id.startsWith("cooktop")) {
          addBox(faces, obj.x + 1.2, obj.y + 1.1, Math.max(obj.width - 2.4, 8), Math.max(obj.depth - 5.2, 8), mass.y0 + mass.h, 1.15, obj.fuel === "induction" ? "#1A1C1E" : "#16181B", rot, 1, -18);
          const cols = obj.width >= 36 ? 3 : 2;
          const rows = 2;
          for (let row = 0; row < rows; row += 1) {
            for (let col = 0; col < cols; col += 1) {
              const bx = obj.x + (obj.width / (cols + 1)) * (col + 1) - 1.3;
              const bz = obj.y + 2.2 + ((obj.depth - 6) / (rows + 1)) * (row + 1);
              addBox(faces, bx, bz, 2.6, 2.6, mass.y0 + mass.h + 1.1, 0.7, obj.fuel === "induction" ? "#2A3036" : "#8A9198", rot, 1, -18);
            }
          }
          if (!id.startsWith("cooktop")) {
            addBox(faces, obj.x + 0.4, obj.y + obj.depth - 3.4, obj.width - 0.8, 3.1, mass.y0 + mass.h - 0.2, 2.2, color, rot, 1, -18);
          }
        }
        if (id.startsWith("fridge") || id.startsWith("wine-fridge")) {
          addBox(faces, obj.x + 0.6, obj.y + 0.5, obj.width * 0.46 - 0.4, obj.depth - 1, mass.y0 + 4, mass.h - 6, color, rot, 1, -16);
          addBox(faces, obj.x + obj.width * 0.52, obj.y + 0.5, obj.width * 0.46 - 0.4, obj.depth - 1, mass.y0 + 4, mass.h - 6, color, rot, 1, -16);
          addBox(faces, obj.x + obj.width * 0.42, obj.y + obj.depth - 1.1, 0.7, 0.7, mass.y0 + 18, 22, "#2A2E32", rot, 1, -16);
          addBox(faces, obj.x + obj.width * 0.56, obj.y + obj.depth - 1.1, 0.7, 0.7, mass.y0 + 18, 22, "#2A2E32", rot, 1, -16);
        }
        if (id.startsWith("dw-")) {
          addBox(faces, obj.x + obj.width * 0.18, obj.y + obj.depth - 1.2, obj.width * 0.64, 0.8, mass.y0 + 28, 0.7, "#2A2E32", rot, 1, -16);
        }
        if (id.startsWith("sink") || (id.includes("vanity") && !id.startsWith("vanity-top") && !id.startsWith("mirror"))) {
          addBox(faces, obj.x + 2.2, obj.y + 4.2, Math.max(obj.width - 4.4, 8), Math.max(obj.depth - 7, 6), mass.y0 + mass.h - 1.2, 1.1, "#A9BCC6", rot, 1, -18);
          addBox(faces, obj.x + obj.width / 2 - 0.45, obj.y + 1.1, 0.9, 0.9, mass.y0 + mass.h, 8.5, "#C9D2D8", rot, 1, -18);
        }
        if (id.startsWith("shower")) {
          const glass = obj.shower_glass === "bronze" ? "#C4A574" : obj.shower_glass === "frosted" ? "#E8EEF0" : "#C5D8E2";
          addBox(faces, obj.x + 0.6, obj.y + 0.6, Math.max(obj.width - 1.2, 8), 1.1, 2, Math.min(mass.h, 78), glass, rot, 0.38, -12);
          addBox(faces, obj.x + 0.6, obj.y + obj.depth - 1.7, Math.max(obj.width - 1.2, 8), 1.1, 2, Math.min(mass.h, 78), glass, rot, obj.shower_door === "framed" ? 0.55 : 0.32, -12);
        }
        if (id.startsWith("tub")) {
          addBox(faces, obj.x + 2.4, obj.y + 3.2, Math.max(obj.width - 4.8, 12), Math.max(obj.depth - 6.4, 10), mass.y0 + 4, Math.max(mass.h - 8, 8), "#D7E3E8", rot, 1, -18);
        }
        if (cutaway && (id.startsWith("island") || ((obj.tags || []).includes("island"))) && Number(obj.overhang) > 0.5) {
          addBox(faces, obj.x - 0.4, obj.y + obj.depth - Number(obj.overhang) - 0.4, obj.width + 0.8, Number(obj.overhang) + 0.8, 34.5, 1.5, obj.counter_material ? counterFill(obj) : "#E6E0D4", rot, 1, -16);
        }
        if (!cutaway && id.startsWith("hood")) {
          addBox(faces, obj.x + obj.width * 0.28, obj.y + 1, obj.width * 0.44, Math.max(obj.depth * 0.45, 6), mass.y0 + mass.h, 18, "#D4DBE1", rot, 1, -10);
        }
        if (id === "washer" || id === "dryer") {
          addBox(faces, obj.x + obj.width * 0.28, obj.y + obj.depth * 0.42, obj.width * 0.44, obj.depth * 0.2, mass.y0 + 14, 16, "#1A1C1E", rot, 1, -16);
        }
        const tag = fixtureLabel(obj);
        if (tag) {
          labels.push({
            kind: "object",
            text: tag,
            x: obj.x + obj.width / 2,
            y: mass.y0 + mass.h + 6,
            z: obj.y + obj.depth / 2,
          });
        }
      });
  } catch (err) {
    console.error("3D massing failed", err);
  }
  return { faces, labels };
}

function projectedFaces(faces, cam) {
  return faces.map((face) => {
    const pts = face.pts.map((pt) => project(pt[0], pt[1], pt[2], cam));
    const depth = pts.reduce((sum, pt) => sum + pt.depth, 0) / pts.length;
    return {
      points: pts.map((pt) => `${pt.x},${pt.y}`).join(" "),
      fill: shadeOf(face.pts, face.color),
      opacity: face.opacity,
      depth: depth + (face.bias || 0),
    };
  }).sort((a, b) => b.depth - a.depth);
}

function projectedLabels(labels, cam) {
  return labels.map((label) => {
    const pt = project(label.x, label.y, label.z, cam);
    return { ...label, sx: pt.x, sy: pt.y, depth: pt.depth };
  }).sort((a, b) => b.depth - a.depth);
}

function appendLabel(svg, ns, label) {
  const text = document.createElementNS(ns, "text");
  text.setAttribute("x", String(label.sx));
  text.setAttribute("y", String(label.sy));
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("font-family", "Outfit, Work Sans, sans-serif");
  text.setAttribute("font-size", label.kind === "room" ? "13" : "10");
  text.setAttribute("font-weight", label.kind === "room" ? "600" : "500");
  text.setAttribute("fill", label.kind === "room" ? "#0A4D68" : "#061A23");
  text.setAttribute("stroke", "#F4F7F8");
  text.setAttribute("stroke-width", "3.4");
  text.setAttribute("paint-order", "stroke");
  text.textContent = label.text;
  svg.appendChild(text);
}

function svgToPng(svg, width, height) {
  return new Promise((resolve) => {
    try {
      const xml = new XMLSerializer().serializeToString(svg);
      const blob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#E4ECF0";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = () => resolve("");
      img.src = url;
    } catch (err) {
      console.error("3D PNG export failed", err);
      resolve("");
    }
  });
}

function paintScene(svg, faces, labels, cam) {
  const ns = "http://www.w3.org/2000/svg";
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const sky = document.createElementNS(ns, "rect");
  sky.setAttribute("width", "800");
  sky.setAttribute("height", "520");
  sky.setAttribute("fill", "#D5E2E8");
  svg.appendChild(sky);
  projectedFaces(faces, cam).forEach((face) => {
    const poly = document.createElementNS(ns, "polygon");
    poly.setAttribute("points", face.points);
    poly.setAttribute("fill", face.fill);
    poly.setAttribute("opacity", String(face.opacity));
    poly.setAttribute("stroke", "rgba(10,77,104,0.22)");
    poly.setAttribute("stroke-width", "0.35");
    svg.appendChild(poly);
  });
  projectedLabels(labels, cam).forEach((label) => appendLabel(svg, ns, label));
}

export function renderLevel3dPng(level, cam, layers = DEFAULT_LAYERS, phase = "after") {
  const view = cam || cameraForLevel(level);
  const scene = collectScene(level, layers, phase, view, true);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svg.setAttribute("viewBox", "0 0 800 520");
  svg.setAttribute("width", "800");
  svg.setAttribute("height", "520");
  paintScene(svg, scene.faces, scene.labels, view);
  return svgToPng(svg, 1600, 1040);
}

export default function FloorPlan3D({
  level,
  onClose,
  walkMode = false,
  layers = DEFAULT_LAYERS,
  phase = "all",
}) {
  const [cam, setCam] = useState(() => cameraForLevel(level));
  const [walk, setWalk] = useState(Boolean(walkMode));
  const [cutaway, setCutaway] = useState(true);
  const drag = useRef(null);
  const pointers = useRef(new Map());
  const pinch = useRef(null);
  const svgRef = useRef(null);

  useEffect(() => {
    setCam(cameraForLevel(level));
  }, [level]);

  useEffect(() => {
    const node = svgRef.current;
    if (!node) return undefined;
    const onWheel = (event) => {
      event.preventDefault();
      setCam((prev) => ({
        ...prev,
        dist: Math.min(1400, Math.max(90, prev.dist + event.deltaY * 0.45)),
      }));
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, []);

  const scene = useMemo(
    () => collectScene(level, layers, phase, cam, cutaway),
    [level, layers, phase, cam, cutaway],
  );
  const drawn = useMemo(() => projectedFaces(scene.faces, cam), [scene.faces, cam]);
  const labels = useMemo(() => projectedLabels(scene.labels, cam), [scene.labels, cam]);

  const lookDown = () => {
    setCam((prev) => ({
      ...prev,
      pitch: 1.42,
      ty: 16,
      dist: Math.min(prev.dist, 780),
    }));
    setCutaway(true);
  };

  const onDown = (e) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (pointers.current.size === 2) {
      const pts = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y), dist0: cam.dist };
      drag.current = null;
      return;
    }
    drag.current = { x: e.clientX, y: e.clientY, cam: { ...cam } };
  };

  const onMove = (e) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const pts = [...pointers.current.values()];
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      setCam((prev) => ({ ...prev, dist: Math.min(1400, Math.max(90, pinch.current.dist0 * (pinch.current.dist / Math.max(dist, 1)))) }));
      return;
    }
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    if (walk) {
      setCam({
        ...drag.current.cam,
        tx: drag.current.cam.tx - dx * 0.35,
        tz: drag.current.cam.tz - dy * 0.35,
        yaw: drag.current.cam.yaw + dx * 0.004,
      });
      return;
    }
    setCam({
      ...drag.current.cam,
      yaw: drag.current.cam.yaw + dx * 0.008,
      pitch: clampPitch(drag.current.cam.pitch + dy * 0.008),
    });
  };

  const onUp = (e) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    drag.current = null;
  };

  const exportPng = async () => {
    try {
      const svg = svgRef.current;
      if (!svg) return;
      const png = await svgToPng(svg, 1600, 1040);
      if (!png) {
        toast.error("Could not export that 3D view. Please try again.");
        return;
      }
      const a = document.createElement("a");
      a.href = png;
      a.download = `${(level?.name || "floor-plan").replace(/\s+/g, "-")}-3d.png`;
      a.click();
      toast.success("3D image saved to Photos / Files");
    } catch (err) {
      console.error("3D export failed", err);
      toast.error("Could not export that 3D view. Please try again.");
    }
  };

  return (
    <div className="absolute inset-0 z-30 bg-[#E4ECF0]" data-testid="floorplan-3d">
      <div className="absolute top-3 left-3 right-3 z-10 flex items-center justify-between gap-2">
        <div className="rounded-full bg-white/92 border border-[#0A4D68]/15 px-3 py-1.5 text-sm font-['Outfit'] font-semibold text-[#0A4D68]">
          3D rooms · {level?.name}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          <button
            type="button"
            onClick={() => setCutaway((v) => !v)}
            className={`rounded-md px-3 py-1.5 text-sm ${cutaway ? "bg-[#C9A227] text-[#061A23]" : "bg-white/90 text-[#0A4D68] border border-slate-200"}`}
          >
            {cutaway ? "See inside" : "Full walls"}
          </button>
          <button type="button" onClick={() => setWalk((v) => !v)} className={`rounded-md px-3 py-1.5 text-sm ${walk ? "bg-[#C9A227] text-[#061A23]" : "bg-white/90 text-[#0A4D68] border border-slate-200"}`}>
            {walk ? "Walk" : "Orbit"}
          </button>
          <button type="button" onClick={lookDown} className="rounded-md bg-white/90 text-[#0A4D68] border border-slate-200 px-3 py-1.5 text-sm">
            Look down
          </button>
          <button type="button" onClick={exportPng} className="rounded-md bg-white/90 text-[#0A4D68] border border-slate-200 px-3 py-1.5 text-sm" data-testid="floorplan-3d-export">
            Export image
          </button>
          <button type="button" onClick={onClose} className="rounded-md bg-[#0A4D68] text-white px-3 py-1.5 text-sm" data-testid="floorplan-3d-close">
            Back to 2D
          </button>
        </div>
      </div>
      <svg
        ref={svgRef}
        className="h-full w-full touch-none"
        viewBox="0 0 800 520"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#C5D7E0" />
            <stop offset="100%" stopColor="#E8EEF1" />
          </linearGradient>
        </defs>
        <rect width="800" height="520" fill="url(#sky)" />
        {drawn.map((face, i) => (
          <polygon
            key={`f${i}`}
            points={face.points}
            fill={face.fill}
            opacity={face.opacity}
            stroke="rgba(10,77,104,0.22)"
            strokeWidth="0.35"
          />
        ))}
        {labels.map((label, i) => (
          <text
            key={`lb${i}`}
            x={label.sx}
            y={label.sy}
            textAnchor="middle"
            fontFamily="Outfit, Work Sans, sans-serif"
            fontSize={label.kind === "room" ? 13 : 10}
            fontWeight={label.kind === "room" ? 600 : 500}
            fill={label.kind === "room" ? "#0A4D68" : "#061A23"}
            stroke="#F4F7F8"
            strokeWidth="3.4"
            paintOrder="stroke"
            style={{ pointerEvents: "none" }}
          >
            {label.text}
          </text>
        ))}
      </svg>
      <div className="absolute bottom-4 left-0 right-0 text-center text-[#4B6370] text-xs font-['Outfit']">
        {cutaway
          ? "Near walls are cut away so you can see into each room · drag to orbit · scroll to zoom"
          : "Full-height walls · switch to See inside to look into the rooms"}
      </div>
    </div>
  );
}
