import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatFtInTight, parseFtIn } from "@/lib/floorPlan/units";
import {
  OPENING_CATEGORY,
  WINDOW_GRID_PATTERNS,
  WINDOW_MATERIALS,
  WINDOW_TYPES,
  applyCategoryAutoRoughOpening,
  normalizeWindowSpec,
  syncCategoryRoughOpening,
} from "@/lib/floorPlan/openingSpec";
import WindowProductPreview from "./WindowProductPreview";

function DimInput({ valueInches, onCommit, testid }) {
  const [text, setText] = useState(formatFtInTight(valueInches));
  useEffect(() => {
    setText(formatFtInTight(valueInches));
  }, [valueInches]);
  return (
    <Input
      data-testid={testid}
      className="h-9"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const n = parseFtIn(text);
        if (Number.isFinite(n) && n > 0) onCommit(n);
        else setText(formatFtInTight(valueInches));
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}

/**
 * Window Details modal — click-to-open from 2D plan.
 */
export default function WindowDetailsModal({
  open,
  windowSpec,
  wallId,
  openingId,
  onSave,
  onClose,
}) {
  const [draft, setDraft] = useState(() => normalizeWindowSpec(windowSpec || {}));
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setDraft(normalizeWindowSpec(windowSpec || {}));
      setError("");
    }
  }, [open, windowSpec, openingId]);

  const dirty = useMemo(
    () => JSON.stringify(normalizeWindowSpec(windowSpec || {})) !== JSON.stringify(draft),
    [windowSpec, draft],
  );

  const patch = (partial) => {
    setDraft((prev) => ({ ...prev, ...partial }));
    setError("");
  };

  const setSize = (width, height) => {
    setDraft((prev) => syncCategoryRoughOpening(prev, width, height, OPENING_CATEGORY.WINDOW));
    setError("");
  };

  const setWindowType = (window_type) => {
    setDraft((prev) => {
      const next = {
        ...prev,
        window_type,
        style: window_type === "fixed" ? "picture" : window_type,
        operation: defaultOp(window_type, prev.operation),
      };
      return prev.rough_opening_mode === "auto"
        ? applyCategoryAutoRoughOpening(next, OPENING_CATEGORY.WINDOW)
        : next;
    });
    setError("");
  };

  const handleClose = () => {
    if (dirty && !window.confirm("Discard unsaved window changes?")) return;
    onClose?.();
  };

  const handleSave = () => {
    try {
      if (!(draft.width > 0) || !(draft.height > 0)) {
        setError("Window width and height must be positive.");
        return;
      }
      if (!(draft.rough_opening_width > 0) || !(draft.rough_opening_height > 0)) {
        setError("Rough opening dimensions must be positive.");
        return;
      }
      onSave?.({ wallId, openingId, data: draft });
    } catch (err) {
      console.error("Window details save failed", err);
      setError(err?.message || "Could not save window details.");
    }
  };

  if (!open) return null;

  const opLabel = draft.operation?.label
    || WINDOW_TYPES.find((t) => t.id === draft.window_type)?.name
    || "Window";

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) handleClose(); }}>
      <DialogContent
        data-testid="window-details-modal"
        className="max-h-[92vh] w-[min(960px,96vw)] max-w-5xl overflow-y-auto border-[#0B3A8F]/30 bg-[#f7f5f0] p-0 text-slate-900 shadow-2xl"
      >
        <DialogHeader className="border-b border-slate-200 bg-[#0B3A8F] px-5 py-4 text-white">
          <DialogTitle className="text-left text-lg font-semibold tracking-wide text-white">
            Window Details
          </DialogTitle>
          <p className="text-left text-sm text-blue-100">
            {WINDOW_TYPES.find((t) => t.id === draft.window_type)?.name || "Window"} · {opLabel}
          </p>
        </DialogHeader>

        <div className="grid gap-5 p-5 md:grid-cols-[minmax(240px,0.9fr)_1.2fr]">
          <div className="space-y-3">
            <WindowProductPreview
              width={draft.width}
              height={draft.height}
              windowType={draft.window_type}
              material={draft.material}
              glass={draft.glass}
              gridPattern={draft.grid_pattern}
              operation={draft.operation}
              className="aspect-[4/5] min-h-[280px] w-full"
            />
            <div className="rounded-md border border-slate-200 bg-white p-3 text-xs text-slate-600">
              <div className="font-semibold text-slate-800">Plan opening</div>
              <div>Uses actual unit width <span className="font-medium text-slate-900">{formatFtInTight(draft.width)}</span> — not the rough opening.</div>
            </div>
          </div>

          <div className="space-y-4">
            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-[#0B3A8F]">Unit Size</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Width</Label>
                  <DimInput valueInches={draft.width} testid="window-width-input" onCommit={(n) => setSize(n, draft.height)} />
                </div>
                <div>
                  <Label className="text-xs">Height</Label>
                  <DimInput valueInches={draft.height} testid="window-height-input" onCommit={(n) => setSize(draft.width, n)} />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">Sill Height Above Floor</Label>
                  <DimInput
                    valueInches={draft.sill_height_above_floor}
                    testid="window-sill-input"
                    onCommit={(n) => patch({ sill_height_above_floor: n, sill: n })}
                  />
                </div>
              </div>
              <div className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-sm">
                <span className="text-slate-500">Unit Size </span>
                <span className="font-semibold" data-testid="window-size-display">{formatFtInTight(draft.width)} × {formatFtInTight(draft.height)}</span>
                <span className="text-slate-500"> · Head </span>
                <span className="font-semibold">{formatFtInTight((draft.sill_height_above_floor || 0) + (draft.height || 0))}</span>
              </div>

              <div className="mt-4 flex items-center justify-between gap-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600">Rough Opening</h4>
                <select
                  className="h-8 rounded-md border border-slate-200 px-2 text-xs"
                  value={draft.rough_opening_mode}
                  onChange={(e) => {
                    const mode = e.target.value;
                    if (mode === "auto") patch(applyCategoryAutoRoughOpening(draft, OPENING_CATEGORY.WINDOW));
                    else patch({ rough_opening_mode: mode });
                  }}
                  data-testid="window-ro-mode"
                >
                  <option value="auto">Auto (window profile)</option>
                  <option value="manual">Manual</option>
                  <option value="manufacturer">Manufacturer</option>
                </select>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">RO Width</Label>
                  <DimInput
                    valueInches={draft.rough_opening_width}
                    testid="window-ro-width-input"
                    onCommit={(n) => patch({ rough_opening_mode: "manual", rough_opening_width: n })}
                  />
                </div>
                <div>
                  <Label className="text-xs">RO Height</Label>
                  <DimInput
                    valueInches={draft.rough_opening_height}
                    testid="window-ro-height-input"
                    onCommit={(n) => patch({ rough_opening_mode: "manual", rough_opening_height: n })}
                  />
                </div>
              </div>
              <div className="mt-2 rounded-md bg-[#0B3A8F]/5 px-3 py-2 text-sm" data-testid="window-ro-display">
                <span className="text-slate-500">Rough Opening </span>
                <span className="font-semibold">{formatFtInTight(draft.rough_opening_width)} × {formatFtInTight(draft.rough_opening_height)}</span>
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-[#0B3A8F]">Type & Material</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Window Type</Label>
                  <select
                    className="h-9 w-full rounded-md border border-slate-200 px-2 text-sm"
                    value={draft.window_type}
                    data-testid="window-type"
                    onChange={(e) => setWindowType(e.target.value)}
                  >
                    {WINDOW_TYPES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                <div>
                  <Label className="text-xs">Frame Material</Label>
                  <select
                    className="h-9 w-full rounded-md border border-slate-200 px-2 text-sm"
                    value={draft.material}
                    data-testid="window-material"
                    onChange={(e) => patch({ material: e.target.value })}
                  >
                    {WINDOW_MATERIALS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>
              </div>
              {draft.window_type === "casement" ? (
                <div className="mt-3">
                  <Label className="text-xs">Casement Hinge</Label>
                  <select
                    className="h-9 w-full rounded-md border border-slate-200 px-2 text-sm"
                    value={draft.operation?.hinge || "left"}
                    onChange={(e) => patch({
                      operation: { hinge: e.target.value, label: `${e.target.value === "right" ? "Right" : "Left"}-hinged casement` },
                    })}
                  >
                    <option value="left">Left-hinged</option>
                    <option value="right">Right-hinged</option>
                  </select>
                </div>
              ) : null}
              {draft.window_type === "slider" ? (
                <div className="mt-3">
                  <Label className="text-xs">Slider Configuration</Label>
                  <select
                    className="h-9 w-full rounded-md border border-slate-200 px-2 text-sm"
                    value={draft.operation?.configuration || "XO"}
                    onChange={(e) => patch({
                      operation: { configuration: e.target.value, label: `${e.target.value} slider` },
                    })}
                  >
                    <option value="XO">XO</option>
                    <option value="OX">OX</option>
                    <option value="XOX">XOX</option>
                  </select>
                </div>
              ) : null}
              <div className="mt-2 text-sm text-slate-700">{opLabel}</div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-[#0B3A8F]">Glass & Grids</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Pane Count</Label>
                  <select
                    className="h-9 w-full rounded-md border border-slate-200 px-2 text-sm"
                    value={String(draft.glass?.paneCount || 2)}
                    data-testid="window-pane-count"
                    onChange={(e) => patch({ glass: { ...draft.glass, paneCount: Number(e.target.value) } })}
                  >
                    <option value="1">Single pane</option>
                    <option value="2">Double pane</option>
                    <option value="3">Triple pane</option>
                  </select>
                </div>
                <div>
                  <Label className="text-xs">Grid / Grille</Label>
                  <select
                    className="h-9 w-full rounded-md border border-slate-200 px-2 text-sm"
                    value={draft.grid_pattern || "none"}
                    data-testid="window-grid"
                    onChange={(e) => patch({
                      grid_pattern: e.target.value,
                      glass: { ...draft.glass, gridPattern: e.target.value },
                    })}
                  >
                    {WINDOW_GRID_PATTERNS.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-3 text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={draft.glass?.lowE !== false} onChange={(e) => patch({ glass: { ...draft.glass, lowE: e.target.checked } })} />
                  Low-E
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={Boolean(draft.glass?.tempered)} onChange={(e) => patch({ glass: { ...draft.glass, tempered: e.target.checked } })} />
                  Tempered
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={Boolean(draft.glass?.laminated)} onChange={(e) => patch({ glass: { ...draft.glass, laminated: e.target.checked } })} />
                  Laminated
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={Boolean(draft.glass?.obscured)} onChange={(e) => patch({ glass: { ...draft.glass, obscured: e.target.checked } })} />
                  Obscured / Privacy
                </label>
              </div>
            </section>

            {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
          </div>
        </div>

        <DialogFooter className="border-t border-slate-200 bg-white px-5 py-4">
          <Button type="button" variant="outline" onClick={handleClose} data-testid="window-details-cancel">Cancel</Button>
          <Button type="button" className="bg-[#0B3A8F] hover:bg-[#082C73]" onClick={handleSave} data-testid="window-details-save">
            Save / Accept
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function defaultOp(windowType, prev) {
  if (windowType === "casement") return { hinge: prev?.hinge || "left", label: "Left-hinged casement" };
  if (windowType === "slider") return { configuration: prev?.configuration || "XO", label: "XO slider" };
  if (windowType === "awning") return { label: "Awning — bottom swings out" };
  if (windowType === "hopper") return { label: "Hopper — top swings in" };
  if (windowType === "fixed") return { label: "Fixed / non-operable" };
  if (windowType === "single-hung") return { label: "Single hung — lower sash operable" };
  return { label: "Double hung — upper & lower sash" };
}
