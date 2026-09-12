import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { formatFtIn, inches } from "@/lib/floorPlan/units";
import { nearestWall, wallLength } from "@/lib/floorPlan/model";
import { segmentedDepthForRoom, segmentedWidthForRoom } from "@/lib/floorPlan/segmentedRoomDimension";
import { exteriorLaneOffsets } from "@/lib/floorPlan/dimensionLanes";
import { wallAxis } from "@/lib/floorPlan/wallOpenings";
import { DoorSwing, FloorHatchDefs, flooringFill, ObjectSymbol, WindowLite, CasedOpening } from "./symbols";
import { libraryById, isIslandObject } from "@/lib/floorPlan/library";
import { isFillerObject, objectFootprint, objectOrientTransform } from "@/lib/floorPlan/cabinetRun";
import { visibleForPhase, workOf } from "@/lib/floorPlan/scope";
import { DEFAULT_LAYERS, layerOn, objectVisible, sortObjectsByLayer } from "@/lib/floorPlan/layers";
import SegmentedRoomDimension from "./SegmentedRoomDimension";
import OpeningDimensionChain from "./OpeningDimensionChain";

const PX = 1.7;
const DIM_ENVELOPE = 78;
const DIM_ROOM = 54;
const DIM_OPENING = 40;
const HANDLE_PX = 10;
const HANDLE_INSET_PX = 8;

function hitsSeHandle(world, box, viewScale) {
  const slop = 14 / (viewScale * PX);
  const hx = box.x + box.w - HANDLE_INSET_PX / PX;
  const hy = box.y + box.h - HANDLE_INSET_PX / PX;
  const size = HANDLE_PX / PX;
  return (
    world.x >= hx - slop
    && world.x <= hx + size + slop
    && world.y >= hy - slop
    && world.y <= hy + size + slop
  );
}

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
  if (item?.from_scan || item?.scan_verify) return { color: "#C45C26", width: 1.5, dash: "4 3" };
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
  onRoomMoveStart,
  onRoomMoveEnd,
  onRoomResize,
  onRoomDraw,
  onObjectMove,
  onObjectResize,
  onOpeningMove,
  onOpeningMoveStart,
  onOpeningMoveEnd,
  onOpeningRehost,
  onOpeningSpanEdit,
  onOpeningClick,
  onWallMove,
  onWallMoveStart,
  onWallMoveEnd,
  onVertexMove,
  onVertexMoveStart,
  onVertexMoveEnd,
  reshapeMode = null,
  addCornerDraft = [],
  onAddCornerClick,
  onBeamMove,
  onDoubleClick,
  placingAnchor = null,
  pickingWalls = false,
  highlightedWallIds = [],
  placingItem,
  drawPoints,
  drawSnap = null,
  onDrawCursor,
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
  const [cursorWorld, setCursorWorld] = useState(null);

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
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch (err) {
      // Synthetic / non-primary pointers can throw NotFoundError — ignore.
      console.warn("Pointer capture unavailable", err?.message || err);
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const pts = [...pointers.current.values()];
      const room = selected?.type === "room" ? (level.rooms || []).find((r) => r.id === selected.id) : null;
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
      if (!insertOpening && !pickingWalls) {
        const hitObj = [...visibleObjects].reverse().find((obj) => {
          const fp = objectFootprint(obj);
          return world.x >= fp.x && world.x <= fp.x + fp.w && world.y >= fp.y && world.y <= fp.y + fp.h;
        });
        if (hitObj) {
          const fp = objectFootprint(hitObj);
          const alreadySelected = selected?.type === "object" && selected.id === hitObj.id;
          const grabHandle = alreadySelected && hitsSeHandle(world, { x: fp.x, y: fp.y, w: fp.w, h: fp.h }, view.scale);
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
            kind: grabHandle ? "resize-object" : "object",
            id: hitObj.id,
            dx: world.x - fp.x,
            dy: world.y - fp.y,
            sx: e.clientX,
            sy: e.clientY,
          });
          return;
        }
      }
      if (layerOn(layers, "walls")) {
        const openingHit = !pickingWalls ? hitOpeningAt(level.walls || [], world, 12 / view.scale) : null;
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
            width: inches(openingHit.opening.width),
            previewWallId: null,
            previewAlong: null,
            sx: e.clientX,
            sy: e.clientY,
            gestureStarted: false,
          });
          dragMoved.current = false;
          return;
        }
        const wallHit = nearestWall(level.walls || [], world.x, world.y, (pickingWalls ? 28 : 10) / view.scale);
        if (wallHit) {
          // Add-corners mode: place topology points on the selected wall
          if (reshapeMode === "add-corners" && selected?.type === "wall" && selected.id === wallHit.wall.id) {
            onAddCornerClick?.(wallHit.wall.id, { x: wallHit.x, y: wallHit.y, t: wallHit.t });
            setDrag(null);
            return;
          }
          if (reshapeMode === "add-corners" && selected?.type === "wall" && selected.id !== wallHit.wall.id) {
            // Allow switching host wall while placing
            onSelect({ type: "wall", id: wallHit.wall.id, doubled: false, t: wallHit.t });
            onAddCornerClick?.(wallHit.wall.id, { x: wallHit.x, y: wallHit.y, t: wallHit.t });
            setDrag(null);
            return;
          }

          // Vertex / corner hit when move-corner mode or select near endpoint
          if (mode === "select" && (reshapeMode === "move-corner" || reshapeMode == null)) {
            const endpointTol = 10 / Math.max(view.scale, 0.35);
            const ends = [
              { x: wallHit.wall.x1, y: wallHit.wall.y1, vertexId: wallHit.wall.startVertexId },
              { x: wallHit.wall.x2, y: wallHit.wall.y2, vertexId: wallHit.wall.endVertexId },
            ];
            const nearEnd = ends.find((p) => Math.hypot(world.x - p.x, world.y - p.y) <= endpointTol);
            if (nearEnd?.vertexId && (reshapeMode === "move-corner" || Math.hypot(world.x - nearEnd.x, world.y - nearEnd.y) <= endpointTol * 0.85)) {
              onSelect({ type: "vertex", id: nearEnd.vertexId, wallId: wallHit.wall.id });
              if (reshapeMode === "move-corner" || mode === "select") {
                setDrag({
                  kind: "vertex-move",
                  id: nearEnd.vertexId,
                  sx: e.clientX,
                  sy: e.clientY,
                  gestureStarted: false,
                });
              }
              return;
            }
          }

          onSelect({ type: "wall", id: wallHit.wall.id, doubled, t: wallHit.t });
          if (doubled) {
            onDoubleClick?.({ type: "wall", id: wallHit.wall.id, t: wallHit.t });
            return;
          }
          if (insertOpening) {
            onCanvasTap?.(world, { doubled, clientX: e.clientX, clientY: e.clientY });
            return;
          }
          // Wall-body drag (perpendicular move) in select mode
          if (mode === "select" && reshapeMode !== "add-corners") {
            setDrag({
              kind: "wall-move",
              id: wallHit.wall.id,
              sx: e.clientX,
              sy: e.clientY,
              gestureStarted: false,
            });
          }
          return;
        }
      }
      if (pickingWalls) {
        setDrag(null);
        return;
      }
      if (!insertOpening && layerOn(layers, "rooms")) {
        const hitRoom = [...(level.rooms || [])].reverse().find((room) => (
          visibleForPhase(room, phase) && world.x >= room.x && world.x <= room.x + room.width && world.y >= room.y && world.y <= room.y + room.depth
        ));
        if (hitRoom) {
          const alreadySelected = selected?.type === "room" && selected.id === hitRoom.id;
          const grabHandle = alreadySelected && hitsSeHandle(world, {
            x: hitRoom.x,
            y: hitRoom.y,
            w: hitRoom.width,
            h: hitRoom.depth,
          }, view.scale);
          onSelect({ type: "room", id: hitRoom.id, doubled });
          if (doubled) {
            onDoubleClick?.({ type: "room", id: hitRoom.id });
            setDrag(null);
            return;
          }
          setDrag({
            kind: grabHandle ? "resize-room" : "room",
            id: hitRoom.id,
            dx: world.x - hitRoom.x,
            dy: world.y - hitRoom.y,
            sx: e.clientX,
            sy: e.clientY,
            gestureStarted: false,
          });
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
    if (mode === "room") {
      // Click-drag creates one outside rectangle; walls are derived on commit.
      setDrag({ kind: "draw-room", x0: world.x, y0: world.y, x1: world.x, y1: world.y });
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
      const nextScale = Math.min(4.5, Math.max(0.35, pinch.current.scale * factor));
      onViewChange({ ...view, scale: nextScale });
      return;
    }
    if (!drag) {
      if (mode === "draw") {
        const w = toWorld(e.clientX, e.clientY);
        setCursorWorld(w);
        onDrawCursor?.(w);
      }
      return;
    }
    const world = toWorld(e.clientX, e.clientY);
    if (mode === "draw") {
      setCursorWorld(world);
      onDrawCursor?.(world);
    }
    if (drag.kind === "pan") {
      onViewChange({ ...view, x: drag.vx + (e.clientX - drag.x), y: drag.vy + (e.clientY - drag.y) });
      return;
    }
    if (drag.kind === "wall-move") {
      if (!dragMoved.current) {
        if (Math.hypot(e.clientX - (drag.sx || e.clientX), e.clientY - (drag.sy || e.clientY)) < 6) return;
        dragMoved.current = true;
        if (!drag.gestureStarted) {
          onWallMoveStart?.(drag.id);
          setDrag((prev) => (prev ? { ...prev, gestureStarted: true } : prev));
        }
      }
      onWallMove?.(drag.id, world);
      return;
    }
    if (drag.kind === "vertex-move") {
      if (!dragMoved.current) {
        if (Math.hypot(e.clientX - (drag.sx || e.clientX), e.clientY - (drag.sy || e.clientY)) < 6) return;
        dragMoved.current = true;
        if (!drag.gestureStarted) {
          onVertexMoveStart?.(drag.id);
          setDrag((prev) => (prev ? { ...prev, gestureStarted: true } : prev));
        }
      }
      onVertexMove?.(drag.id, world, { freeAngle: e.altKey });
      return;
    }
    if (drag.kind === "room") {
      if (!dragMoved.current) {
        if (Math.hypot(e.clientX - (drag.sx || e.clientX), e.clientY - (drag.sy || e.clientY)) < 6) return;
        dragMoved.current = true;
        if (!drag.gestureStarted) {
          onRoomMoveStart?.(drag.id);
          setDrag((prev) => (prev ? { ...prev, gestureStarted: true } : prev));
        }
      }
      onRoomMove?.(drag.id, world.x - drag.dx, world.y - drag.dy);
    }
    if (drag.kind === "resize-room") onRoomResize?.(drag.id, world.x, world.y);
    if (drag.kind === "draw-room") {
      setDrag((prev) => (prev ? { ...prev, x1: world.x, y1: world.y } : prev));
      return;
    }
    if (drag.kind === "object") {
      if (!dragMoved.current) {
        if (Math.hypot(e.clientX - (drag.sx || e.clientX), e.clientY - (drag.sy || e.clientY)) < 6) return;
        dragMoved.current = true;
      }
      onObjectMove?.(drag.id, world.x - drag.dx, world.y - drag.dy);
    }
    if (drag.kind === "opening") {
      if (!dragMoved.current) {
        if (Math.hypot(e.clientX - (drag.sx || e.clientX), e.clientY - (drag.sy || e.clientY)) < 6) return;
        dragMoved.current = true;
        if (!drag.gestureStarted) {
          onOpeningMoveStart?.(drag.wallId, drag.id);
          setDrag((prev) => (prev ? { ...prev, gestureStarted: true } : prev));
        }
      }
      const hostWall = (level.walls || []).find((w) => w.id === drag.wallId);
      const opening = hostWall?.openings?.find((o) => o.id === drag.id);
      const width = inches(opening?.width ?? drag.width ?? 32);
      const rehostHit = nearestWall(
        (level.walls || []).filter((w) => w.id !== drag.wallId),
        world.x,
        world.y,
        22 / view.scale,
      );
      if (rehostHit && rehostHit.dist <= 18 / view.scale) {
        const axis = wallAxis(rehostHit.wall);
        const along = (world.x - axis.x1) * axis.ux + (world.y - axis.y1) * axis.uy - width / 2;
        setDrag((prev) => (prev ? {
          ...prev,
          previewWallId: rehostHit.wall.id,
          previewAlong: along,
        } : prev));
        return;
      }
      if (hostWall) {
        const axis = wallAxis(hostWall);
        const along = (world.x - axis.x1) * axis.ux + (world.y - axis.y1) * axis.uy;
        setDrag((prev) => (prev ? { ...prev, previewWallId: null, previewAlong: null } : prev));
        onOpeningMove?.(drag.wallId, drag.id, along - (drag.grab || 0));
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
    if (drag?.kind === "draw-room") {
      const x1 = drag.x0;
      const y1 = drag.y0;
      const x2 = drag.x1;
      const y2 = drag.y1;
      const w = Math.abs(x2 - x1);
      const d = Math.abs(y2 - y1);
      if (w >= 24 && d >= 24) {
        onRoomDraw?.({
          x1: Math.min(x1, x2),
          y1: Math.min(y1, y2),
          x2: Math.max(x1, x2),
          y2: Math.max(y1, y2),
        });
      }
    }
    if (drag?.kind === "opening") {
      if (drag.previewWallId && drag.previewAlong != null && dragMoved.current) {
        const world = toWorld(e.clientX, e.clientY);
        onOpeningRehost?.(drag.wallId, drag.id, drag.previewWallId, world.x, world.y);
      } else if (!dragMoved.current) {
        onOpeningClick?.({
          type: "opening",
          id: drag.id,
          wallId: drag.wallId,
        });
      }
      if (dragMoved.current || drag.gestureStarted) {
        onOpeningMoveEnd?.(drag.wallId, drag.id);
      }
    }
    if (drag?.kind === "room") {
      if (dragMoved.current || drag.gestureStarted) {
        onRoomMoveEnd?.(drag.id);
      }
    }
    if (drag?.kind === "wall-move") {
      if (dragMoved.current || drag.gestureStarted) {
        onWallMoveEnd?.(drag.id);
      }
    }
    if (drag?.kind === "vertex-move") {
      if (dragMoved.current || drag.gestureStarted) {
        onVertexMoveEnd?.(drag.id);
      }
    }
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
      const worldX = (cx - view.x) / (Math.max(view.scale, 0.01) * PX);
      const worldY = (cy - view.y) / (Math.max(view.scale, 0.01) * PX);
      onViewChange({
        ...view,
        scale: nextScale,
        x: cx - worldX * nextScale * PX,
        y: cy - worldY * nextScale * PX,
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
                {room.from_scan || room.scan_verify ? (
                  <text x={(room.width * PX) / 2} y={(room.depth * PX) / 2 + 22} textAnchor="middle" fill="#C45C26" fontFamily="Times, serif" fontSize="8">
                    from scan – verify
                  </text>
                ) : null}
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
            const picked = (highlightedWallIds || []).includes(wall.id);
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
                  stroke={picked ? "#C9A227" : active ? "#C9A227" : "#111111"}
                  strokeWidth={picked ? 2.4 : active || wall.plumbing ? 1.6 : 0.7}
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
                {active || picked ? (
                  <text x={(len * PX) / 2} y={-10} textAnchor="middle" fill={picked ? "#0B3A8F" : "#111111"} fontFamily="Times, serif" fontSize="9">
                    {picked ? "Cabinets" : formatFtIn(len)}
                  </text>
                ) : null}
              </g>
            );
          }) : null}

          {drag?.kind === "opening" && drag.previewWallId ? (() => {
            const target = (level.walls || []).find((w) => w.id === drag.previewWallId);
            const source = (level.walls || []).find((w) => w.id === drag.wallId);
            const opening = source?.openings?.find((o) => o.id === drag.id);
            if (!target || !opening) return null;
            const ghost = { ...opening, offset: drag.previewAlong };
            const len = wallLength(target);
            return (
              <g
                key="opening-rehost-preview"
                data-testid="opening-rehost-preview"
                transform={`translate(${target.x1 * PX} ${target.y1 * PX}) rotate(${wallAngle(target)})`}
                opacity="0.55"
              >
                <rect
                  x={0}
                  y={-(target.thickness * PX) / 2 - 2}
                  width={len * PX}
                  height={target.thickness * PX + 4}
                  fill="none"
                  stroke="#C9A227"
                  strokeWidth="1.2"
                  strokeDasharray="4 3"
                />
                {ghost.type === "door" ? (
                  <DoorSwing opening={ghost} thickness={target.thickness * PX} scale={PX} />
                ) : ghost.type === "window" ? (
                  <WindowLite opening={ghost} thickness={target.thickness * PX} scale={PX} />
                ) : (
                  <CasedOpening opening={ghost} thickness={target.thickness * PX} scale={PX} />
                )}
              </g>
            );
          })() : null}

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
            const orient = objectOrientTransform(fp.front, fp.width, fp.depth);
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
                <g transform={`scale(${PX})${orient ? ` ${orient}` : ""}`}>
                  <ObjectSymbol
                    item={{
                      ...lib,
                      ...obj,
                      width: fp.width,
                      depth: fp.depth,
                      finish: obj.finish,
                      id: obj.library_id || lib.id,
                      library_id: obj.library_id || lib.id,
                      instance_id: obj.id,
                    }}
                    width={fp.width}
                    depth={fp.depth}
                  />
                </g>
                {!clientView && active ? <rect x={fp.w * PX - 8} y={fp.h * PX - 8} width="10" height="10" rx="1" fill="#C9A227" /> : null}
                {obj.from_scan || obj.scan_verify ? (
                  <text x={fp.w * PX / 2} y={-3} textAnchor="middle" fill="#C45C26" fontFamily="Times, serif" fontSize="7">
                    VERIFY
                  </text>
                ) : null}
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
                const wallOnSide = (room, side) => (level.walls || []).find(
                  (w) => w.source_room_id === room.id && w.room_side === side,
                );
                const hasOpenings = (wall) => (wall?.openings || []).some(
                  (o) => o.type === "door" || o.type === "window" || o.type === "cased",
                );
                const renderRoomSide = (room, side, dim, faceWorld, exteriorToward) => {
                  if (!onEnvelope(room, env, side)) return null;
                  const wall = wallOnSide(room, side);
                  const feature = hasOpenings(wall);
                  const lanes = exteriorLaneOffsets({ hasFeatureChain: feature });
                  return (
                    <g key={`dim-room-${room.id}-${side}`} data-dim-stack={side}>
                      {lanes.mode === "stacked" && wall ? (
                        <OpeningDimensionChain
                          level={level}
                          wall={wall}
                          offsetPx={lanes.openingChain}
                          scalePx={PX}
                          onEditSpan={onOpeningSpanEdit}
                          testid={`opening-dim-chain-${side}-${room.id}`}
                        />
                      ) : null}
                      {lanes.mode === "combined" ? (
                        <SegmentedRoomDimension
                          dim={dim}
                          faceWorld={faceWorld}
                          offsetPx={lanes.roomAssembly}
                          exteriorToward={exteriorToward}
                          scalePx={PX}
                          viewScale={view.scale}
                          variant="full"
                          testid={`segmented-room-dim-${side}-${room.id}`}
                        />
                      ) : (
                        <>
                          <SegmentedRoomDimension
                            dim={dim}
                            faceWorld={faceWorld}
                            offsetPx={lanes.roomAssembly}
                            exteriorToward={exteriorToward}
                            scalePx={PX}
                            viewScale={view.scale}
                            variant="segments"
                            testid={`segmented-room-dim-${side}-${room.id}`}
                          />
                          <SegmentedRoomDimension
                            dim={dim}
                            faceWorld={faceWorld}
                            offsetPx={lanes.overall}
                            overallOffsetPx={lanes.overall}
                            exteriorToward={exteriorToward}
                            scalePx={PX}
                            viewScale={view.scale}
                            variant="overall"
                            testid={`overall-room-dim-${side}-${room.id}`}
                          />
                        </>
                      )}
                    </g>
                  );
                };
                return (
                  <g>
                    {rooms.length > 1 ? (
                      <>
                        <DimString x1={env.x1} y1={env.y1} x2={env.x2} y2={env.y1} offset={-DIM_ENVELOPE} />
                        <DimString x1={env.x1} y1={env.y1} x2={env.x1} y2={env.y2} offset={-DIM_ENVELOPE} />
                      </>
                    ) : null}
                    {rooms.map((room) => {
                      const widthDim = segmentedWidthForRoom(level, room);
                      const depthDim = segmentedDepthForRoom(level, room);
                      return (
                        <g key={`dim-room-${room.id}`}>
                          {renderRoomSide(room, "north", widthDim, room.y, -1)}
                          {renderRoomSide(room, "west", depthDim, room.x, -1)}
                          {renderRoomSide(room, "south", widthDim, room.y + room.depth, 1)}
                          {renderRoomSide(room, "east", depthDim, room.x + room.width, 1)}
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
            <g key={`draw-pt-${idx}`} data-testid="draw-transient-point">
              <circle cx={pt.x * PX} cy={pt.y * PX} r="3.2" fill="#C9A227" stroke="#0B3A8F" strokeWidth="1" />
            </g>
          ))}
          {(addCornerDraft || []).map((pt, idx) => (
            <g key={`corner-draft-${idx}`} data-testid="add-corner-draft">
              <circle cx={pt.x * PX} cy={pt.y * PX} r="4.5" fill="#C45C26" stroke="#fff" strokeWidth="1.2" />
              <text x={pt.x * PX + 6} y={pt.y * PX - 6} fill="#C45C26" fontSize="8" fontFamily="Outfit,sans-serif" fontWeight="700">
                P{idx + 1}
              </text>
            </g>
          ))}
          {selected?.type === "vertex" ? (() => {
            const v = (level.vertices || []).find((row) => row.id === selected.id);
            if (!v) return null;
            return (
              <g data-testid="selected-vertex-handle">
                <circle cx={v.x * PX} cy={v.y * PX} r="5.5" fill="#0B3A8F" stroke="#C9A227" strokeWidth="2" />
              </g>
            );
          })() : null}
          {selected?.type === "wall" ? (() => {
            const wall = (level.walls || []).find((w) => w.id === selected.id);
            if (!wall || !(wall.is_reshape_span || wall.reshape_span || wall.is_bump_face)) return null;
            return (
              <line
                x1={wall.x1 * PX}
                y1={wall.y1 * PX}
                x2={wall.x2 * PX}
                y2={wall.y2 * PX}
                stroke="#C45C26"
                strokeWidth="4"
                opacity="0.55"
                strokeLinecap="round"
                pointerEvents="none"
              />
            );
          })() : null}
          {mode === "draw" && (drawPoints || []).length === 1 && (drawSnap?.point || cursorWorld) ? (() => {
            const end = drawSnap?.point || cursorWorld;
            const start = drawPoints[0];
            const label = drawSnap?.label || "";
            return (
              <g data-testid="draw-rubberband" pointerEvents="none">
                {(drawSnap?.guides || []).map((g, i) => {
                  if (g.kind === "h") {
                    return <line key={`gh-${i}`} x1={-2000} y1={g.y * PX} x2={8000} y2={g.y * PX} stroke="#0B3A8F" strokeWidth="0.7" strokeDasharray="4 4" opacity="0.45" />;
                  }
                  if (g.kind === "v") {
                    return <line key={`gv-${i}`} x1={g.x * PX} y1={-2000} x2={g.x * PX} y2={8000} stroke="#0B3A8F" strokeWidth="0.7" strokeDasharray="4 4" opacity="0.45" />;
                  }
                  if (g.kind === "point") {
                    return <circle key={`gp-${i}`} cx={g.x * PX} cy={g.y * PX} r="5" fill="none" stroke="#C45C26" strokeWidth="1.2" />;
                  }
                  if (g.kind === "wall") {
                    return (
                      <line
                        key={`gw-${i}`}
                        x1={g.x1 * PX}
                        y1={g.y1 * PX}
                        x2={g.x2 * PX}
                        y2={g.y2 * PX}
                        stroke="#C45C26"
                        strokeWidth="3.2"
                        opacity="0.85"
                      />
                    );
                  }
                  return null;
                })}
                <line
                  x1={start.x * PX}
                  y1={start.y * PX}
                  x2={end.x * PX}
                  y2={end.y * PX}
                  stroke="#C9A227"
                  strokeWidth="2.2"
                  strokeDasharray="5 4"
                  opacity="0.95"
                />
                <circle cx={end.x * PX} cy={end.y * PX} r="2.8" fill="#C9A227" />
                {label ? (
                  <text x={end.x * PX + 8} y={end.y * PX - 8} fill="#0B3A8F" fontSize="9" fontFamily="Outfit,sans-serif" fontWeight="600">
                    {label}
                  </text>
                ) : null}
                {drawSnap?.point && start ? (() => {
                  const len = Math.hypot(end.x - start.x, end.y - start.y);
                  if (len < 6) return null;
                  const mx = ((start.x + end.x) / 2) * PX;
                  const my = ((start.y + end.y) / 2) * PX;
                  const ft = Math.floor(len / 12);
                  const inch = Math.round(len % 12);
                  const dim = inch ? `${ft}'${inch}"` : `${ft}'`;
                  return (
                    <text x={mx} y={my - 6} fill="#1a1a1a" fontSize="8" fontFamily="Outfit,sans-serif" textAnchor="middle">
                      {dim}
                    </text>
                  );
                })() : null}
              </g>
            );
          })() : null}

          {drag?.kind === "draw-room" ? (() => {
            const x = Math.min(drag.x0, drag.x1);
            const y = Math.min(drag.y0, drag.y1);
            const w = Math.abs(drag.x1 - drag.x0);
            const d = Math.abs(drag.y1 - drag.y0);
            return (
              <g data-testid="room-draw-rubberband">
                <rect
                  x={x * PX}
                  y={y * PX}
                  width={w * PX}
                  height={d * PX}
                  fill="rgba(11,58,143,0.08)"
                  stroke="#0B3A8F"
                  strokeWidth="1.6"
                  strokeDasharray="6 4"
                />
                <text x={(x + w / 2) * PX} y={(y + d / 2) * PX} textAnchor="middle" fill="#0B3A8F" fontFamily="Times, serif" fontSize="11" fontWeight="600">
                  {formatFtIn(w)} × {formatFtIn(d)} outside
                </text>
              </g>
            );
          })() : null}

          {placingItem ? (
            <text x="16" y="22" fill="#0B3A8F" fontFamily="Outfit" fontSize="11">Tap to place {placingItem.name}</text>
          ) : null}
        </g>
      </svg>
          {clientView ? null : (
        <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-white/90 border border-slate-200 px-2 py-1 text-[10px] text-[#4B6370] font-['Outfit']">
          {["door", "window", "cased"].includes(mode)
            ? "Click a wall to cut that opening. Cabinets slide clear. A header is sized over wide openings (twin 2x10 / 2x12 if it checks, otherwise LVL)."
            : `⋮ Layers / Edit · Drag to slide · Double-click specs · Grid 1' · ${Math.round(view.scale * 100)}%`}
        </div>
      )}
    </div>
  );
});

export default FloorPlanCanvas;
