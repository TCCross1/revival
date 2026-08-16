import { useEffect, useRef, useState } from "react";
import {
  AppWindow, Box, BoxSelect, Copy, DoorOpen, Frame, Hand, Layers3, MoreVertical,
  RotateCw, ScanLine, Square, Trash2, Lock, Unlock, Ruler, Refrigerator,
  Columns3, Minus, MousePointer2, Flame, Lightbulb,
} from "lucide-react";
import { PLAN_LAYERS, layerOn } from "@/lib/floorPlan/layers";

const POS_KEY = "revival-fp-layer-pos";
const PANE_KEY = "revival-fp-dock-pane";
const DEFAULT_POS = { x: 12, y: 108 };

const EDIT_GROUPS = [
  {
    id: "pointer",
    label: "Pointer",
    tools: [
      { id: "select", label: "Select / move", hint: "Click to select, drag along the wall", icon: MousePointer2 },
      { id: "pan", label: "Pan", hint: "Drag the drawing without changing items", icon: Hand },
    ],
  },
  {
    id: "draw",
    label: "Draw",
    tools: [
      { id: "room", label: "Room block", hint: "Tap to drop a room, then drag to size", icon: Square },
      { id: "draw", label: "Point & line", hint: "Click wall endpoints, double-click to finish", icon: Layers3 },
    ],
  },
  {
    id: "openings",
    label: "Openings",
    tools: [
      { id: "door", label: "Door", hint: "Click a wall — cabinets slide clear", icon: DoorOpen },
      { id: "window", label: "Window", hint: "Click a wall to cut a window", icon: AppWindow },
      { id: "cased", label: "Cased opening", hint: "Click a wall for a C.O.", icon: Frame },
      { id: "french-48", label: "French 48 · 4 lites", hint: "48\" interior pair, 4 vertical lites each", icon: Columns3 },
    ],
  },
  {
    id: "place",
    label: "Place",
    tools: [
      { id: "place:cab-base-24", label: "Base 24", hint: "Tap the plan to place a 24\" base", icon: Square },
      { id: "place:cab-wall-30", label: "Wall 30", hint: "Tap the plan to place a 30\" wall cabinet", icon: Columns3 },
      { id: "place:fridge-36", label: "Fridge 36", hint: "24\" deep 2D fridge, flush to the run", icon: Refrigerator },
      { id: "place:range-36", label: "Range 36", hint: "Tap the cooking wall", icon: Flame },
      { id: "place:dw-24", label: "Dishwasher", hint: "24\" dishwasher on the sink run", icon: BoxSelect },
      { id: "place:island-96", label: "Island 96", hint: "8' working island", icon: Lightbulb },
      { id: "place:lvl-double", label: "LVL", hint: "Click a wall, or drop over an opening", icon: Minus },
    ],
  },
  {
    id: "modify",
    label: "Modify",
    tools: [
      { id: "rotate", label: "Rotate 90°", hint: "Turn the selected item", icon: RotateCw, needs: "item" },
      { id: "duplicate", label: "Duplicate", hint: "Copy the selected item beside it", icon: Copy, needs: "item" },
      { id: "specs", label: "Properties", hint: "Same as double-click — edit specs", icon: Ruler, needs: "any" },
      { id: "lock", label: "Lock / unlock", hint: "Pin so auto-fill will not replace it", icon: Lock, needs: "item" },
      { id: "delete", label: "Delete", hint: "Remove the selection", icon: Trash2, needs: "any" },
    ],
  },
  {
    id: "finish",
    label: "Finish",
    tools: [
      { id: "counters", label: "Snap counters", hint: "Rebuild countertops on the base run", icon: Ruler },
      { id: "lidar", label: "LiDAR scan", hint: "Import a RoomPlan scan", icon: ScanLine },
      { id: "3d", label: "3D view", hint: "Open the 3D walkthrough", icon: Box },
    ],
  },
];

function readSavedPos() {
  try {
    const raw = window.localStorage.getItem(POS_KEY);
    if (!raw) return { ...DEFAULT_POS };
    const parsed = JSON.parse(raw);
    const x = Number(parsed?.x);
    const y = Number(parsed?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { ...DEFAULT_POS };
    return { x, y };
  } catch (err) {
    console.error("Could not read saved layer panel position", err);
    return { ...DEFAULT_POS };
  }
}

function writeSavedPos(pos) {
  try {
    window.localStorage.setItem(POS_KEY, JSON.stringify(pos));
  } catch (err) {
    console.error("Could not save layer panel position", err);
  }
}

function readSavedPane() {
  try {
    const pane = window.localStorage.getItem(PANE_KEY);
    return pane === "edit" ? "edit" : "layers";
  } catch (err) {
    console.error("Could not read dock pane", err);
    return "layers";
  }
}

function writeSavedPane(pane) {
  try {
    window.localStorage.setItem(PANE_KEY, pane);
  } catch (err) {
    console.error("Could not save dock pane", err);
  }
}

function clampPos(x, y, panel) {
  const parent = panel?.parentElement;
  if (!parent) return { x, y };
  const bound = parent.getBoundingClientRect();
  const box = panel.getBoundingClientRect();
  const maxX = Math.max(8, bound.width - box.width - 8);
  const maxY = Math.max(8, bound.height - box.height - 8);
  return {
    x: Math.min(maxX, Math.max(8, x)),
    y: Math.min(maxY, Math.max(8, y)),
  };
}

export default function LayerPanel({
  layers,
  onToggle,
  compact = false,
  mode = "select",
  placingId = "",
  selectedKind = "",
  locked = false,
  onAction,
}) {
  const panelRef = useRef(null);
  const menuRef = useRef(null);
  const drag = useRef(null);
  const [pos, setPos] = useState(readSavedPos);
  const [pane, setPane] = useState(readSavedPane);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return undefined;
    setPos((current) => clampPos(current.x, current.y, panel));
    const onResize = () => {
      setPos((current) => clampPos(current.x, current.y, panelRef.current));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [compact, pane]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const close = (event) => {
      if (menuRef.current?.contains(event.target)) return;
      setMenuOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [menuOpen]);

  const onHandleDown = (e) => {
    if (e.button != null && e.button !== 0) return;
    if (e.target?.closest?.("[data-dock-menu]")) return;
    const panel = panelRef.current;
    if (!panel) return;
    e.preventDefault();
    e.stopPropagation();
    panel.setPointerCapture?.(e.pointerId);
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
  };

  const onHandleMove = (e) => {
    if (!drag.current) return;
    const next = clampPos(e.clientX - drag.current.dx, e.clientY - drag.current.dy, panelRef.current);
    setPos(next);
  };

  const onHandleUp = (e) => {
    if (!drag.current) return;
    drag.current = null;
    panelRef.current?.releasePointerCapture?.(e.pointerId);
    setPos((current) => {
      const next = clampPos(current.x, current.y, panelRef.current);
      writeSavedPos(next);
      return next;
    });
  };

  const switchPane = (next) => {
    setPane(next);
    writeSavedPane(next);
    setMenuOpen(false);
  };

  const toolActive = (tool) => {
    if (tool.id === "3d") return false;
    if (tool.id.startsWith("place:")) return placingId === tool.id.slice(6);
      if (tool.id === "french-48") return placingId === "door-french-48";
    return mode === tool.id;
  };

  const toolDisabled = (tool) => {
    if (!tool.needs) return false;
    if (tool.needs === "item") return selectedKind !== "object";
    if (tool.needs === "any") return !selectedKind;
    return false;
  };

  const showEdit = !compact && pane === "edit";

  return (
    <aside
      ref={panelRef}
      className={`fp-layer-panel${compact ? " is-compact" : ""}${showEdit ? " is-edit" : ""}`}
      data-testid="layer-panel"
      data-pane={compact ? "layers" : pane}
      style={{ left: pos.x, top: pos.y }}
    >
      <div
        className="fp-layer-panel__title"
        data-testid="layer-panel-handle"
        onPointerDown={onHandleDown}
        onPointerMove={onHandleMove}
        onPointerUp={onHandleUp}
        onPointerCancel={onHandleUp}
      >
        <span className="fp-layer-grip" aria-hidden>
          <span />
          <span />
          <span />
        </span>
        <span className="fp-layer-panel__name">{showEdit ? "Edit" : "Layers"}</span>
        {compact ? null : (
          <button
            type="button"
            className="fp-layer-panel__dots"
            data-testid="dock-menu-btn"
            data-dock-menu="1"
            aria-label="Switch Layers or Edit tools"
            aria-expanded={menuOpen}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setMenuOpen((open) => !open);
            }}
          >
            <MoreVertical size={14} />
          </button>
        )}
      </div>

      {menuOpen && !compact ? (
        <div ref={menuRef} className="fp-layer-panel__menu" data-testid="dock-menu" data-dock-menu="1">
          <button type="button" className={pane === "layers" ? "is-on" : ""} onClick={() => switchPane("layers")}>
            <Layers3 size={13} /> Layers
          </button>
          <button type="button" className={pane === "edit" ? "is-on" : ""} onClick={() => switchPane("edit")}>
            <MousePointer2 size={13} /> Edit tools
          </button>
        </div>
      ) : null}

      {showEdit ? (
        <div className="fp-layer-panel__body fp-edit-tools" data-testid="edit-tools">
          {EDIT_GROUPS.map((group) => (
            <div key={group.id} className="fp-edit-group">
              <div className="fp-edit-group__label">{group.label}</div>
              {group.tools.map((tool) => {
                const Icon = tool.id === "lock" && !locked ? Unlock : tool.icon;
                const on = toolActive(tool);
                const disabled = toolDisabled(tool);
                return (
                  <button
                    key={tool.id}
                    type="button"
                    data-testid={`edit-tool-${tool.id}`}
                    className={on ? "is-on" : "is-off"}
                    title={tool.hint}
                    disabled={disabled}
                    onClick={() => {
                      try {
                        onAction?.(tool.id);
                      } catch (err) {
                        console.error("Edit tool failed", err);
                      }
                    }}
                  >
                    <Icon size={13} />
                    {tool.id === "lock" ? (locked ? "Unlock" : "Lock") : tool.label}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      ) : (
        <div className="fp-layer-panel__body">
        {PLAN_LAYERS.map((row) => {
          const on = layerOn(layers, row.id);
          return (
            <button
              key={row.id}
              type="button"
              data-testid={`layer-${row.id}`}
              className={on ? "is-on" : "is-off"}
              title={on ? `Hide ${row.hint}` : `Show ${row.hint}`}
              aria-pressed={on}
              onClick={() => onToggle(row.id)}
            >
              <span className="fp-layer-dot" aria-hidden />
              {row.label}
            </button>
          );
        })
        }
        </div>
      )}
    </aside>
  );
}
