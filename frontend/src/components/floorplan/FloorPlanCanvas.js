import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { formatFtIn, inches } from "@/lib/floorPlan/units";
import { nearestWall, wallLength } from "@/lib/floorPlan/model";
import { DoorSwing, FloorHatchDefs, flooringFill, ObjectSymbol, WindowLite, CasedOpening } from "./symbols";
import { libraryById, isIslandObject } from "@/lib/floorPlan/library";
import { isFillerObject, objectFootprint } from "@/lib/floorPlan/cabinetRun";
import { visibleForPhase, workOf } from "@/lib/floorPlan/scope";
import { DEFAULT_LAYERS, layerOn, objectVisible, sortObjectsByLayer } from "@/lib/floorPlan/layers";

const PX = 1.7;
const DIM_ENVELOPE = 78;
const DIM_ROOM = 54;
const DIM_OPENING = 40;

function DimString({ x1, y1, x2, y2, offset = 48, label, interior = false }) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const ax = x1 * PX + nx * offset;
  const ay = y1 * PX + ny * offset;
  const bx = x2 * PX + nx * offset;
  const by = y2 * PX + ny * offset;
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const tick = 2.4;
  const ink = interior ? "#5C5C5C" : "#222222";
  const weight = interior ? 0.38 : 0.5;
  return (
    <g fill="none" stroke={ink} strokeWidth={weight}>
      <line x1={ax} y1={ay} x2={bx} y2={by} />
      <line x1={ax - nx * tick} y1={ay - ny * tick} x2={ax + nx * tick} y2={ay + ny * tick} />
      <line x1={bx - nx * tick} y1={by - ny * tick} x2={bx + nx * tick} y2={by + ny * tick} />
      <text x={mx + nx * 9} y={my + ny * 9} textAnchor="middle" fill={ink} stroke="none" fontFamily="Times, serif" fontSize="8.5">
        {label || formatFtIn(len)}
      </text>
    </g>
  );
}

function envelopeOf(rooms) {
  if (!rooms.length) return null;
  return {
    x1: Math.min(...rooms.map((room) => room.x)),
    y1: Math.min(...rooms.map((room) => room.y)),
    x2: Math.max(...rooms.map((room) => room.x + room.width)),
    y2: Math.max(...rooms.map((room) => room.y + room.depth)),
  };
}

function onEnvelope(room, env, side, tol = 2) {
  if (!room || !env) return false;
  if (side === "north") return Math.abs(room.y - env.y1) < tol;
  if (side === "west") return Math.abs(room.x - env.x1) < tol;
  if (side === "south") return Math.abs(room.y + room.depth - env.y2) < tol;
  if (side === "east") return Math.abs(room.x + room.width - env.x2) < tol;
  return false;
}

function offsetOutside(x1, y1, x2, y2, env, mag) {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const nx = -(y2 - y1) / len;
  const ny = (x2 - x1) / len;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const cx = (env.x1 + env.x2) / 2;
  const cy = (env.y1 + env.y2) / 2;
  const wx = mx + nx * (mag / PX);
  const wy = my + ny * (mag / PX);
  const outside = Math.hypot(wx - cx, wy - cy) >= Math.hypot(mx - cx, my - cy);
  return outside ? mag : -mag;
}

function objectSymbolOrient(front, width, depth) {
  const w = inches(width);
  const d = inches(depth);
  if (front === "east") return { tf: "matrix(0 1 1 0 0 0)", sw: w, sd: d };
  if (front === "west") return { tf: `matrix(0 1 -1 0 ${d} 0)`, sw: w, sd: d };
  if (front === "north") return { tf: `rotate(180 ${w / 2} ${d / 2})`, sw: w, sd: d };
  return { tf: "", sw: w, sd: d };
}

function wallAngle(wall) {
  return (Math.atan2(wall.y2 - wall.y1, wall.x2 - wall.x1) * 180) / Math.PI;
}

function hitOpeningAt(walls, world, tol) {
  let best = null;
  (walls || []).forEach((wall) => {
    const len = Math.hypot(inches(wall.x2) - inches(wall.x1), inches(wall.y2) - inches(wall.y1)) || 1;
    const x1 = inches(wall.x1);
    const y1 = inches(wall.y1);
    const x2 = inches(wall.x2);
    const y2 = inches(wall.y2);
    const t = Math.max(0, Math.min(1, ((world.x - x1) * (x2 - x1) + (world.y - y1) * (y2 - y1)) / (len * len)));
    const px = x1 + t * (x2 - x1);
    const py = y1 + t * (y2 - y1);
    const dist = Math.hypot(world.x - px, world.y - py);
    const along = t * len;
    if (dist > Math.max(inches(wall.thickness || 4.5) / 2 + 6, tol)) return;
    (wall.openings || []).forEach((opening) => {
      const a = inches(opening.offset);
      const b = a + inches(opening.width);
      if (along < a - 4 || along > b + 4) return;
      if (!best || dist < best.dist) best = { wall, opening, dist, along };
    });
  });
  return best;
}

function outlineFor(item, active, phase) {
  if (active) return { color: "#C9A227", width: 2, dash: undefined };
  if (workOf(item) === "demo") return { color: "#C62828", width: 1.6, dash: "5 3" };
  if (phase !== "all" && workOf(item) === "new") return { color: "#2E7D32", width: 1.4, dash: undefined };
  return { color: "transparent", width: 0, dash: undefined };
}

const FloorPlanCanvas = forwardRef(function FloorPlanCanvas({
  level,
  mode,
  view,
  onViewChange,
  selected,
  onSelect,
  onCanvasTap,
  onRoomMove,
  onRoomResize,
  onObjectMove,
  onObjectResize,
  onOpeningMove,
  onBeamMove,
  onDoubleClick,
  placingAnchor = null,
  placingItem,
  drawPoints,
  wirePath,
  phase = "all",
  clientView = false,
  asbuilt,
  layers = DEFAULT_LAYERS,
  testid = "floorplan-canvas",
}, ref) {
  const wrapRef = useRef(null);
  const svgRef = useRef(null);
  const pointers = useRef(new Map());
  const pinch = useRef(null);
  const lastTap = useRef({ t: 0, x: 0, y: 0 });
  const dragMoved = useRef(false);
  const [drag, setDrag] = useState(null);

  useImperativeHandle(ref, () => ({
    capturePng: () => new Promise((resolve, reject) => {
      try {
        const svg = svgRef.current;
        if (!svg) return resolve("");
        const xml = new XMLSerializer().serializeToString(svg);
        const blob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = 1400;
          canvas.height = 900;
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#F3F1EC";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          URL.revokeObjectURL(url);
          resolve(canvas.toDataURL("image/png"));
        };
        img.onerror = () => resolve("");
        img.src = url;
      } catch (err) {
        console.error("Floor plan PNG capture failed", err);
        reject(err);
      }
    }),
  }));

  const visibleObjects = useMemo(
    () => sortObjectsByLayer((level.objects || []).filter((obj) => visibleForPhase(obj, phase) && objectVisible(obj, layers))),
    [level.objects, phase, layers],
  );

  const toWorld = (clientX, clientY) => {
    const rect = wrapRef.current.getBoundingClientRect();
    const x = (clientX - rect.left - view.x) / (view.scale * PX);
    const y = (clientY - rect.top - view.y) / (view.scale * PX);
    return { x, y };
  };

  const onPointerDown = (e) => {
    if (e.button === 1 || e.button === 2) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const pts = [...pointers.current.values()];
      const room = selected?.type === "room" ? (level.rooms || []).find((r) => r.id === selected.id) : null;
      const obj = selected?.type === "object" ? (level.objects || []).find((o) => o.id === selected.id) : null;
      pinch.current = {
        dist: Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y),
        scale: view.scale,
        cx: (pts[0].x + pts[1].x) / 2,
        cy: (pts[0].y + pts[1].y) / 2,
        vx: view.x,
        vy: view.y,
        roomId: room?.id || "",
        roomW: room?.width || 0,
        roomD: room?.depth || 0,
        objId: obj?.id || "",
        objW: obj?.width || 0,
        objD: obj?.depth || 0,
      };
      setDrag(null);
      return;
    }
    const world = toWorld(e.clientX, e.clientY);
    const now = Date.now();
    const doubled = now - lastTap.current.t < 280 && Math.hypot(e.clientX - lastTap.current.x, e.clientY - lastTap.current.y) < 28;
    lastTap.current = { t: now, x: e.clientX, y: e.clientY };
    dragMoved.current = false;
    const insertOpening = ["door", "window", "cased"].includes(mode);

    if (mode !== "draw" && mode !== "lidar" && !placingAnchor) {
      if (!insertOpening) {
        const hitObj = [...visibleObjects].reverse().find((obj) => {
          const fp = objectFootprint(obj);
          return world.x >= fp.x && world.x <= fp.x + fp.w && world.y >= fp.y && world.y <= fp.y + fp.h;
        });
        if (hitObj) {
          const fp = objectFootprint(hitObj);
          const nearE = Math.abs(world.x - (fp.x + fp.w)) < 10 / view.scale;
          const nearS = Math.abs(world.y - (fp.y + fp.h)) < 10 / view.scale;
          onSelect({ type: "object", id: hitObj.id, doubled });
          if (doubled) {
            onDoubleClick?.({ type: "object", id: hitObj.id });
            setDrag(null);
            return;
          }
          if (hitObj.auto && isFillerObject(hitObj)) {
            setDrag(null);
            return;
          }
          setDrag({
            kind: nearE || nearS ? "resize-object" : "object",
            id: hitObj.id,
            dx: world.x - fp.x,
            dy: world.y - fp.y,
            sx: e.clientX,
            sy: e.clientY,
          });
          return;
        }
      }
      if (!insertOpening && layerOn(layers, "rooms")) {
        const hitRoom = [...(level.rooms || [])].reverse().find((room) => (
          visibleForPhase(room, phase) && world.x >= room.x && world.x <= room.x + room.width && world.y >= room.y && world.y <= room.y + room.depth
        ));
        if (hitRoom) {
          const nearE = Math.abs(world.x - (hitRoom.x + hitRoom.width)) < 10 / view.scale;
          const nearS = Math.abs(world.y - (hitRoom.y + hitRoom.depth)) < 10 / view.scale;
          onSelect({ type: "room", id: hitRoom.id, doubled });
          if (doubled) {
            onDoubleClick?.({ type: "room", id: hitRoom.id });
            setDrag(null);
            return;
          }
          setDrag({
            kind: nearE || nearS ? "resize-room" : "room",
            id: hitRoom.id,
            dx: world.x - hitRoom.x,
            dy: world.y - hitRoom.y,
          });
          return;
        }
      }
      if (layerOn(layers, "walls")) {
        const openingHit = hitOpeningAt(level.walls || [], world, 12 / view.scale);
        if (openingHit && !insertOpening) {
          onSelect({ type: "opening", id: openingHit.opening.id, wallId: openingHit.wall.id, doubled });
          if (doubled) {
            onDoubleClick?.({ type: "opening", id: openingHit.opening.id, wallId: openingHit.wall.id });
            setDrag(null);
            return;
          }
          setDrag({
            kind: "opening",
            wallId: openingHit.wall.id,
            id: openingHit.opening.id,
            grab: openingHit.along - inches(openingHit.opening.offset),
          });
          return;
        }
        const wallHit = nearestWall(level.walls || [], world.x, world.y, 10 / view.scale);
        if (wallHit) {
          onSelect({ type: "wall", id: wallHit.wall.id, doubled, t: wallHit.t });
          if (doubled) {
            onDoubleClick?.({ type: "wall", id: wallHit.wall.id });
            return;
          }
          if (insertOpening) {
            onCanvasTap?.(world, { doubled, clientX: e.clientX, clientY: e.clientY });
          }
          return;
        }
      }
      if (!insertOpening && layerOn(layers, "structure")) {
        const beamHit = nearestWall(level.beams || [], world.x, world.y, 12 / view.scale);
        if (beamHit) {
          onSelect({ type: "beam", id: beamHit.wall.id, doubled });
          if (doubled) {
            onDoubleClick?.({ type: "beam", id: beamHit.wall.id });
            setDrag(null);
            return;
          }
          setDrag({
            kind: "beam",
            id: beamHit.wall.id,
            dx: world.x - inches(beamHit.wall.x1),
            dy: world.y - inches(beamHit.wall.y1),
            spanX: inches(beamHit.wall.x2) - inches(beamHit.wall.x1),
            spanY: inches(beamHit.wall.y2) - inches(beamHit.wall.y1),
          });
          return;
        }
      }
    }
    onSelect(null);
    if (mode === "pan" || e.altKey) {
      setDrag({ kind: "pan", x: e.clientX, y: e.clientY, vx: view.x, vy: view.y });
      return;
    }
    onCanvasTap?.(world, { doubled, clientX: e.clientX, clientY: e.clientY });
  };

  const onPointerMove = (e) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const pts = [...pointers.current.values()];
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      const factor = dist / Math.max(pinch.current.dist, 1);
      if (pinch.current.roomId && onRoomResize) {
        const room = (level.rooms || []).find((r) => r.id === pinch.current.roomId);
        if (room) onRoomResize(room.id, room.x + pinch.current.roomW * factor, room.y + pinch.current.roomD * factor);
        return;
      }
      if (pinch.current.objId && onObjectResize) {
        onObjectResize(pinch.current.objId, Math.max(6, pinch.current.objW * factor), Math.max(4, pinch.current.objD * factor));
        return;
      }
      const nextScale = Math.min(4.5, Math.max(0.35, pinch.current.scale * factor));
      onViewChange({ ...view, scale: nextScale });
      return;
    }
    if (!drag) return;
    const world = toWorld(e.clientX, e.clientY);
    if (drag.kind === "pan") {
      onViewChange({ ...view, x: drag.vx + (e.clientX - drag.x), y: drag.vy + (e.clientY - drag.y) });
      return;
    }
    if (drag.kind === "room") onRoomMove?.(drag.id, world.x - drag.dx, world.y - drag.dy);
    if (drag.kind === "resize-room") onRoomResize?.(drag.id, world.x, world.y);
    if (drag.kind === "object") {
      if (!dragMoved.current) {
        if (Math.hypot(e.clientX - (drag.sx || e.clientX), e.clientY - (drag.sy || e.clientY)) < 6) return;
        dragMoved.current = true;
      }
      onObjectMove?.(drag.id, world.x - drag.dx, world.y - drag.dy);
    }
    if (drag.kind === "opening") {
      const wall = (level.walls || []).find((w) => w.id === drag.wallId);
      if (wall) {
        const len = Math.hypot(inches(wall.x2) - inches(wall.x1), inches(wall.y2) - inches(wall.y1)) || 1;
        const t = Math.max(0, Math.min(1, ((world.x - inches(wall.x1)) * (inches(wall.x2) - inches(wall.x1)) + (world.y - inches(wall.y1)) * (inches(wall.y2) - inches(wall.y1))) / (len * len)));
        onOpeningMove?.(drag.wallId, drag.id, t * len - (drag.grab || 0));
      }
    }
    if (drag.kind === "beam") {
      onBeamMove?.(drag.id, world.x - drag.dx, world.y - drag.dy, drag.spanX, drag.spanY);
    }
    if (drag.kind === "resize-object") {
      const obj = (level.objects || []).find((o) => o.id === drag.id);
      if (obj) {
        const fp = objectFootprint(obj);
        const nextW = Math.max(6, world.x - fp.x);
        const nextH = Math.max(4, world.y - fp.y);
        if (obj.front === "east" || obj.front === "west") {
          onObjectResize?.(drag.id, nextH, nextW);
        } else {
          onObjectResize?.(drag.id, nextW, nextH);
        }
      }
    }
  };

  const onPointerUp = (e) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    setDrag(null);
  };

  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return undefined;
    const onWheel = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const factor = ev.deltaY > 0 ? 0.92 : 1.08;
      const nextScale = Math.min(4.5, Math.max(0.35, view.scale * factor));
      const rect = node.getBoundingClientRect();
      const cx = ev.clientX - rect.left;
      const cy = ev.clientY - rect.top;
      const worldX = (cx - view.x) / Math.max(view.scale, 0.01);
      const worldY = (cy - view.y) / Math.max(view.scale, 0.01);
      onViewChange({
        ...view,
        scale: nextScale,
        x: cx - worldX * nextScale,
        y: cy - worldY * nextScale,
      });
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [view, onViewChange]);

  const gridSize = 12 * PX * view.scale;
  const patternId = useMemo(() => "fp-grid", []);

  return (
    <div
      ref={wrapRef}
      data-testid={testid}
      className="relative h-full w-full overflow-hidden touch-none select-none bg-[#F3F1EC]"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      <svg ref={svgRef} className="absolute inset-0 h-full w-full">
        <defs>
          <pattern id={patternId} width={gridSize} height={gridSize} patternUnits="userSpaceOnUse" x={view.x % gridSize} y={view.y % gridSize}>
            <path d={`M ${gridSize} 0 L 0 0 0 ${gridSize}`} fill="none" stroke="#D7D2C8" strokeWidth="1" />
            <path d={`M ${gridSize / 2} 0 L ${gridSize / 2} ${gridSize} M 0 ${gridSize / 2} L ${gridSize} ${gridSize / 2}`} fill="none" stroke="#E8E4DC" strokeWidth="0.6" />
          </pattern>
          <pattern id="fp-plumb" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="#111111" strokeWidth="1.2" />
          </pattern>
          <FloorHatchDefs />
        </defs>
        <rect width="100%" height="100%" fill={`url(#${patternId})`} />
        <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
          {asbuilt?.dataUrl ? (
            <image
              href={asbuilt.dataUrl}
              x={(asbuilt.x || 0) * PX}
              y={(asbuilt.y || 0) * PX}
              width={480 * (asbuilt.scale || 1)}
              height={320 * (asbuilt.scale || 1)}
              opacity={asbuilt.opacity ?? 0.35}
              preserveAspectRatio="xMidYMid meet"
            />
          ) : null}
          {layerOn(layers, "rooms") ? (level.rooms || []).filter((room) => visibleForPhase(room, phase)).map((room) => {
            const outline = outlineFor(room, selected?.type === "room" && selected.id === room.id, phase);
            return (
              <g key={room.id} transform={`translate(${room.x * PX} ${room.y * PX})`}>
                <rect
                  width={room.width * PX}
                  height={room.depth * PX}
                  fill={flooringFill(room.flooring)}
                  stroke={outline.color === "transparent" ? "#111111" : outline.color}
                  strokeWidth={outline.width || 1.1}
                  strokeDasharray={outline.dash}
                />
                <text x={(room.width * PX) / 2} y={(room.depth * PX) / 2 - 6} textAnchor="middle" fill="#111111" fontFamily="Times, serif" fontSize="12" fontWeight="600">
                  {room.name}
                </text>
                <text x={(room.width * PX) / 2} y={(room.depth * PX) / 2 + 10} textAnchor="middle" fill="#111111" fontFamily="Times, serif" fontSize="9">
                  {formatFtIn(room.width)} × {formatFtIn(room.depth)}
                </text>
                {!clientView && selected?.type === "room" && selected.id === room.id ? (
                  <rect x={room.width * PX - 8} y={room.depth * PX - 8} width="10" height="10" rx="1" fill="#C9A227" />
                ) : null}
                {room.note ? <circle cx={8} cy={8} r="3" fill="#C9A227" /> : null}
              </g>
            );
          }) : null}

          {layerOn(layers, "walls") ? (level.walls || []).filter((wall) => visibleForPhase(wall, phase)).map((wall) => {
            const len = wallLength(wall);
            const active = selected?.type === "wall" && selected.id === wall.id;
            const demo = workOf(wall) === "demo";
            const fill = demo
              ? "#FFFFFF"
              : wall.plumbing
                ? "url(#fp-plumb)"
                : wall.kind === "exterior"
                  ? "#111111"
                  : "#6A6A6A";
            return (
              <g key={wall.id} transform={`translate(${wall.x1 * PX} ${wall.y1 * PX}) rotate(${wallAngle(wall)})`}>
                <rect
                  x="0"
                  y={-(wall.thickness * PX) / 2}
                  width={len * PX}
                  height={wall.thickness * PX}
                  fill={fill}
                  stroke={active ? "#C9A227" : "#111111"}
                  strokeWidth={active || wall.plumbing ? 1.6 : 0.7}
                  strokeDasharray={demo ? "5 3" : undefined}
                  opacity={demo ? 0.85 : 1}
                />
                {wall.plumbing ? (
                  <text x={(len * PX) / 2} y={(wall.thickness * PX) / 2 + 10} textAnchor="middle" fill="#111111" fontFamily="Times, serif" fontSize="8">2x6 PLUMB</text>
                ) : null}
                {(wall.openings || []).map((opening) => (
                  <g key={opening.id}>
                    {opening.type === "door" ? (
                      <DoorSwing opening={opening} thickness={wall.thickness * PX} scale={PX} />
                    ) : opening.type === "window" ? (
                      <WindowLite opening={opening} thickness={wall.thickness * PX} scale={PX} />
                    ) : opening.type === "cased" ? (
                      <CasedOpening opening={opening} thickness={wall.thickness * PX} scale={PX} />
                    ) : (
                      <rect
                        x={inches(opening.offset) * PX}
                        y={-(wall.thickness * PX) / 2}
                        width={inches(opening.width) * PX}
                        height={wall.thickness * PX}
                        fill="#FFFFFF"
                        stroke="#111111"
                        strokeWidth="0.8"
                      />
                    )}
                  </g>
                ))}
                {active ? (
                  <text x={(len * PX) / 2} y={-10} textAnchor="middle" fill="#111111" fontFamily="Times, serif" fontSize="9">
                    {formatFtIn(len)}
                  </text>
                ) : null}
              </g>
            );
          }) : null}

          {layerOn(layers, "structure") ? (level.beams || []).filter((beam) => visibleForPhase(beam, phase)).map((beam) => {
            const active = selected?.type === "beam" && selected.id === beam.id;
            const plies = Math.max(1, Number(beam.plies) || 1);
            return (
              <g key={beam.id} transform={`translate(${beam.x1 * PX} ${beam.y1 * PX}) rotate(${wallAngle(beam)})`}>
                {Array.from({ length: plies }).map((_, i) => (
                  <line
                    key={i}
                    x1="0"
                    y1={(i - (plies - 1) / 2) * 3.2}
                    x2={wallLength(beam) * PX}
                    y2={(i - (plies - 1) / 2) * 3.2}
                    stroke="#C45C26"
                    strokeWidth={active ? 2.4 : 1.8}
                    strokeDasharray="7 4"
                  />
                ))}
                <text x={(wallLength(beam) * PX) / 2} y={-8 - plies} textAnchor="middle" fill="#C45C26" fontFamily="Outfit" fontSize="8" fontWeight="600">
                  {beam.label || `${plies} LVL`}
                </text>
              </g>
            );
          }) : null}

          {(wirePath || []).length > 1 ? (
            <g>
              <polyline points={wirePath.map((p) => `${p.x * PX},${p.y * PX}`).join(" ")} fill="none" stroke="#2E7D32" strokeWidth="3.2" strokeLinecap="round" opacity="0.35" />
              <polyline points={wirePath.map((p) => `${p.x * PX},${p.y * PX}`).join(" ")} fill="none" stroke="#111111" strokeWidth="1.5" strokeLinecap="round" />
              <polyline points={wirePath.map((p) => `${p.x * PX},${p.y * PX - 2}`).join(" ")} fill="none" stroke="#F4F1EA" strokeWidth="1.1" strokeLinecap="round" />
              <polyline points={wirePath.map((p) => `${p.x * PX},${p.y * PX + 2}`).join(" ")} fill="none" stroke="#C62828" strokeWidth="1.1" strokeDasharray="4 3" strokeLinecap="round" />
            </g>
          ) : null}

          {visibleObjects.map((obj) => {
            const lib = libraryById(obj.library_id) || obj;
            const active = selected?.type === "object" && selected.id === obj.id;
            const outline = outlineFor(obj, active, phase);
            const fp = objectFootprint(obj);
            const ori = objectSymbolOrient(obj.front || "south", obj.width, obj.depth);
            return (
              <g key={obj.id} transform={`translate(${fp.x * PX} ${fp.y * PX})`}>
                <rect
                  width={fp.w * PX}
                  height={fp.h * PX}
                  fill="transparent"
                  stroke={outline.color}
                  strokeWidth={outline.width}
                  strokeDasharray={outline.dash}
                />
                <g transform={`scale(${PX}) ${ori.tf}`}>
                  <svg width={ori.sw} height={ori.sd} viewBox={`0 0 ${ori.sw} ${ori.sd}`} overflow="visible">
                    <ObjectSymbol
                      item={{
                        ...lib,
                        ...obj,
                        finish: obj.finish,
                        id: obj.library_id || lib.id,
                        library_id: obj.library_id || lib.id,
                        instance_id: obj.id,
                      }}
                      width={ori.sw}
                      depth={ori.sd}
                    />
                  </svg>
                </g>
                {!clientView && active ? <rect x={fp.w * PX - 8} y={fp.h * PX - 8} width="10" height="10" rx="1" fill="#C9A227" /> : null}
                {obj.note ? <circle cx={4} cy={4} r="2.4" fill="#C9A227" /> : null}
              </g>
            );
          })}

          {layerOn(layers, "dimensions") ? (
            <g data-testid="plan-dimensions">
              {(() => {
                const rooms = (level.rooms || []).filter((room) => visibleForPhase(room, phase));
                const env = envelopeOf(rooms);
                if (!env) return null;
                const islands = (level.objects || []).filter((obj) => isIslandObject(obj) && visibleForPhase(obj, phase));
                return (
                  <g>
                    <DimString x1={env.x1} y1={env.y1} x2={env.x2} y2={env.y1} offset={-DIM_ENVELOPE} />
                    <DimString x1={env.x1} y1={env.y1} x2={env.x1} y2={env.y2} offset={-DIM_ENVELOPE} />
                    {rooms.map((room) => (
                      <g key={`dim-room-${room.id}`}>
                        {onEnvelope(room, env, "north") ? (
                          <DimString x1={room.x} y1={room.y} x2={room.x + room.width} y2={room.y} offset={-DIM_ROOM} />
                        ) : null}
                        {onEnvelope(room, env, "west") ? (
                          <DimString x1={room.x} y1={room.y} x2={room.x} y2={room.y + room.depth} offset={-DIM_ROOM} />
                        ) : null}
                        {onEnvelope(room, env, "south") ? (
                          <DimString x1={room.x} y1={room.y + room.depth} x2={room.x + room.width} y2={room.y + room.depth} offset={DIM_ROOM} />
                        ) : null}
                        {onEnvelope(room, env, "east") ? (
                          <DimString x1={room.x + room.width} y1={room.y} x2={room.x + room.width} y2={room.y + room.depth} offset={DIM_ROOM} />
                        ) : null}
                      </g>
                    ))}
                    {(level.walls || []).filter((wall) => visibleForPhase(wall, phase) && wall.kind === "exterior").map((wall) => {
                      const len = wallLength(wall);
                      const ux = (wall.x2 - wall.x1) / Math.max(len, 1);
                      const uy = (wall.y2 - wall.y1) / Math.max(len, 1);
                      const off = offsetOutside(wall.x1, wall.y1, wall.x2, wall.y2, env, DIM_OPENING);
                      return (
                        <g key={`dim-wall-${wall.id}`}>
                          {(wall.openings || []).filter((op) => op.type === "window" || op.type === "door" || op.type === "cased").map((opening) => {
                            const a = inches(opening.offset);
                            const b = a + inches(opening.width);
                            return (
                              <DimString
                                key={opening.id}
                                x1={wall.x1 + ux * a}
                                y1={wall.y1 + uy * a}
                                x2={wall.x1 + ux * b}
                                y2={wall.y1 + uy * b}
                                offset={off}
                                label={`${opening.type === "window" ? "W" : opening.type === "cased" ? "C.O." : "DR"} ${formatFtIn(opening.width)}`}
                              />
                            );
                          })}
                        </g>
                      );
                    })}
                    {islands.map((obj, idx) => {
                      const fp = objectFootprint(obj);
                      return (
                        <text
                          key={`dim-island-${obj.id}`}
                          x={env.x1 * PX}
                          y={env.y2 * PX + DIM_ENVELOPE + 16 + idx * 12}
                          fill="#222222"
                          stroke="none"
                          fontFamily="Times, serif"
                          fontSize="8.5"
                        >
                          {`ISLAND ${formatFtIn(fp.w)} × ${formatFtIn(fp.h)}`}
                        </text>
                      );
                    })}
                  </g>
                );
              })()}
            </g>
          ) : null}

          {(drawPoints || []).map((pt, idx) => (
            <g key={`${pt.x}-${pt.y}-${idx}`}>
              <circle cx={pt.x * PX} cy={pt.y * PX} r="3.2" fill="#C9A227" stroke="#0A4D68" strokeWidth="1" />
              {idx > 0 ? (
                <line x1={drawPoints[idx - 1].x * PX} y1={drawPoints[idx - 1].y * PX} x2={pt.x * PX} y2={pt.y * PX} stroke="#C9A227" strokeWidth="2" />
              ) : null}
            </g>
          ))}

          {placingItem ? (
            <text x="16" y="22" fill="#0A4D68" fontFamily="Outfit" fontSize="11">Tap to place {placingItem.name}</text>
          ) : null}
        </g>
      </svg>
          {clientView ? null : (
        <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-white/90 border border-slate-200 px-2 py-1 text-[10px] text-[#4B6370] font-['Outfit']">
          {["door", "window", "cased"].includes(mode)
            ? "Click a wall to cut that opening. Cabinets slide clear. An LVL drops in over wide openings."
            : `⋮ Layers / Edit · Drag to slide · Double-click specs · Grid 1' · ${Math.round(view.scale * 100)}%`}
        </div>
      )}
    </div>
  );
});

export default FloorPlanCanvas;
