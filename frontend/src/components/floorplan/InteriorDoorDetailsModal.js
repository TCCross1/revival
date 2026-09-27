import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatFtInTight, parseFtIn } from "@/lib/floorPlan/units";
import { DOOR_PANEL_STYLES, HINGE_TYPES } from "@/lib/floorPlan/doorSpec";
import {
  INTERIOR_CONSTRUCTIONS,
  INTERIOR_DOOR_MATERIALS,
  INTERIOR_OPERATION_TYPES,
  OPENING_CATEGORY,
  applyCategoryAutoRoughOpening,
  normalizeInteriorDoorSpec,
  syncCategoryRoughOpening,
} from "@/lib/floorPlan/openingSpec";
import InteriorDoorProductPreview from "./InteriorDoorProductPreview";

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
 * Interior Door Details modal — click-to-open from 2D plan.
 */
export default function InteriorDoorDetailsModal({
  open,
  door,
  wallId,
  openingId,
  onSave,
  onClose,
}) {
  const [draft, setDraft] = useState(() => normalizeInteriorDoorSpec(door || {}));
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setDraft(normalizeInteriorDoorSpec(door || {}));
      setError("");
    }
  }, [open, door, openingId]);

  const dirty = useMemo(
    () => JSON.stringify(normalizeInteriorDoorSpec(door || {})) !== JSON.stringify(draft),
    [door, draft],
  );

  const patch = (partial) => {
    setDraft((prev) => ({ ...prev, ...partial }));
    setError("");
  };

  const setSize = (width, height) => {
    setDraft((prev) => syncCategoryRoughOpening(prev, width, height, OPENING_CATEGORY.INTERIOR_DOOR));
    setError("");
  };

  const handleClose = () => {
    if (dirty && !window.confirm("Discard unsaved interior door changes?")) return;
    onClose?.();
  };

  const handleSave = () => {
    try {
      if (!(draft.width > 0) || !(draft.height > 0)) {
        setError("Door width and height must be positive.");
        return;
      }
      if (!(draft.rough_opening_width > 0) || !(draft.rough_opening_height > 0)) {
        setError("Rough opening dimensions must be positive.");
        return;
      }
      onSave?.({ wallId, openingId, data: draft });
    } catch (err) {
      console.error("Interior door details save failed", err);
      setError(err?.message || "Could not save interior door details.");
    }
  };

  if (!open) return null;

  const hinged = draft.operation_type === "hinged" || draft.operation_type === "french";

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) handleClose(); }}>
      <DialogContent
        data-testid="interior-door-details-modal"
        className="max-h-[92vh] w-[min(960px,96vw)] max-w-5xl overflow-y-auto border-[#0B3A8F]/30 bg-[#f7f5f0] p-0 text-slate-900 shadow-2xl"
      >
        <DialogHeader className="border-b border-slate-200 bg-[#0B3A8F] px-5 py-4 text-white">
          <DialogTitle className="text-left text-lg font-semibold tracking-wide text-white">
            Interior Door Details
          </DialogTitle>
          <p className="text-left text-sm text-blue-100">
            {INTERIOR_OPERATION_TYPES.find((o) => o.id === draft.operation_type)?.name || "Hinged"}
            {" · "}
            {INTERIOR_CONSTRUCTIONS.find((c) => c.id === draft.construction)?.name || "Hollow Core"}
          </p>
        </DialogHeader>

        <div className="grid gap-5 p-5 md:grid-cols-[minmax(240px,0.9fr)_1.2fr]">
          <div className="space-y-3">
            <InteriorDoorProductPreview
              width={draft.width}
              height={draft.height}
              material={draft.material}
              style={draft.style}
              construction={draft.construction}
              operationType={draft.operation_type}
              boreCount={draft.bore_count}
              hingeCount={draft.hinges?.count}
              hingeType={draft.hinges?.type}
              handing={draft.handing}
              swingDirection={draft.swingDirection}
              className="w-full"
            />
            <div className="rounded-md border border-slate-200 bg-white p-3 text-xs text-slate-600">
              <div className="font-semibold text-slate-800">Plan opening</div>
              <div>Uses actual door width <span className="font-medium text-slate-900">{formatFtInTight(draft.width)}</span> — not the rough opening.</div>
            </div>
          </div>

          <div className="space-y-4">
            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-[#0B3A8F]">Dimensions</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Door Width</Label>
                  <DimInput valueInches={draft.width} testid="interior-door-width-input" onCommit={(n) => setSize(n, draft.height)} />
                </div>
                <div>
                  <Label className="text-xs">Door Height</Label>
                  <DimInput valueInches={draft.height} testid="interior-door-height-input" onCommit={(n) => setSize(draft.width, n)} />
                </div>
              </div>
              <div className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-sm">
                <span className="text-slate-500">Door Size </span>
                <span className="font-semibold" data-testid="interior-door-size-display">{formatFtInTight(draft.width)} × {formatFtInTight(draft.height)}</span>
              </div>

              <div className="mt-4 flex items-center justify-between gap-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600">Rough Opening</h4>
                <div className="flex items-center gap-2">
                  <select
                    className="h-8 rounded-md border border-slate-200 px-2 text-xs"
                    value={draft.rough_opening_mode}
                    onChange={(e) => {
                      const mode = e.target.value;
                      if (mode === "auto") patch(applyCategoryAutoRoughOpening(draft, OPENING_CATEGORY.INTERIOR_DOOR));
                      else patch({ rough_opening_mode: mode });
                    }}
                    data-testid="interior-door-ro-mode"
                  >
                    <option value="auto">Auto (type profile)</option>
                    <option value="manual">Manual</option>
                    <option value="manufacturer">Manufacturer Override</option>
                  </select>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">RO Width</Label>
                  <DimInput
                    valueInches={draft.rough_opening_width}
                    testid="interior-door-ro-width-input"
                    onCommit={(n) => patch({ rough_opening_mode: "manual", rough_opening_width: n })}
                  />
                </div>
                <div>
                  <Label className="text-xs">RO Height</Label>
                  <DimInput
                    valueInches={draft.rough_opening_height}
                    testid="interior-door-ro-height-input"
                    onCommit={(n) => patch({ rough_opening_mode: "manual", rough_opening_height: n })}
                  />
                </div>
              </div>
              <div className="mt-2 rounded-md bg-[#0B3A8F]/5 px-3 py-2 text-sm" data-testid="interior-door-ro-display">
                <span className="text-slate-500">Rough Opening </span>
                <span className="font-semibold">{formatFtInTight(draft.rough_opening_width)} × {formatFtInTight(draft.rough_opening_height)}</span>
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-[#0B3A8F]">Operation & Construction</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Operation Type</Label>
                  <select
                    className="h-9 w-full rounded-md border border-slate-200 px-2 text-sm"
                    value={draft.operation_type}
                    data-testid="interior-door-operation"
                    onChange={(e) => {
                      const operation_type = e.target.value;
                      const next = { ...draft, operation_type };
                      patch(draft.rough_opening_mode === "auto"
                        ? applyCategoryAutoRoughOpening(next, OPENING_CATEGORY.INTERIOR_DOOR)
                        : next);
                    }}
                  >
                    {INTERIOR_OPERATION_TYPES.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </div>
                <div>
                  <Label className="text-xs">Construction</Label>
                  <select
                    className="h-9 w-full rounded-md border border-slate-200 px-2 text-sm"
                    value={draft.construction}
                    data-testid="interior-door-construction"
                    onChange={(e) => patch({ construction: e.target.value })}
                  >
                    {INTERIOR_CONSTRUCTIONS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <Label className="text-xs">Material / Finish</Label>
                  <select
                    className="h-9 w-full rounded-md border border-slate-200 px-2 text-sm"
                    value={draft.material}
                    data-testid="interior-door-material"
                    onChange={(e) => patch({ material: e.target.value, door_material: e.target.value })}
                  >
                    {INTERIOR_DOOR_MATERIALS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>
                <div>
                  <Label className="text-xs">Style</Label>
                  <select
                    className="h-9 w-full rounded-md border border-slate-200 px-2 text-sm"
                    value={draft.style}
                    data-testid="interior-door-style"
                    onChange={(e) => patch({ style: e.target.value })}
                  >
                    {DOOR_PANEL_STYLES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              </div>
            </section>

            {hinged ? (
              <section className="rounded-lg border border-slate-200 bg-white p-4">
                <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-[#0B3A8F]">Handing & Swing</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Handing</Label>
                    <select
                      className="h-9 w-full rounded-md border border-slate-200 px-2 text-sm"
                      value={draft.handing}
                      data-testid="interior-door-handing"
                      onChange={(e) => patch({ handing: e.target.value, swing: e.target.value })}
                    >
                      <option value="left">Left Hand</option>
                      <option value="right">Right Hand</option>
                    </select>
                  </div>
                  <div>
                    <Label className="text-xs">Swing</Label>
                    <select
                      className="h-9 w-full rounded-md border border-slate-200 px-2 text-sm"
                      value={draft.swingDirection}
                      data-testid="interior-door-swing"
                      onChange={(e) => patch({
                        swingDirection: e.target.value,
                        direction: e.target.value === "outswing" ? "out" : "in",
                      })}
                    >
                      <option value="inswing">Inswing</option>
                      <option value="outswing">Outswing</option>
                    </select>
                  </div>
                </div>
              </section>
            ) : null}

            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-[#0B3A8F]">Hardware</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Bores / Lockset</Label>
                  <select
                    className="h-9 w-full rounded-md border border-slate-200 px-2 text-sm"
                    value={String(draft.bore_count)}
                    data-testid="interior-door-bore-count"
                    onChange={(e) => patch({ bore_count: Number(e.target.value) })}
                  >
                    <option value="0">0 — none</option>
                    <option value="1">1 — lockset</option>
                    <option value="2">2 — lockset + deadbolt</option>
                  </select>
                </div>
                <div>
                  <Label className="text-xs">Hinge Count</Label>
                  <select
                    className="h-9 w-full rounded-md border border-slate-200 px-2 text-sm"
                    value={String(draft.hinges?.count || 3)}
                    data-testid="interior-door-hinge-count"
                    onChange={(e) => patch({ hinges: { ...draft.hinges, count: Number(e.target.value) } })}
                  >
                    {[2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <div>
                  <Label className="text-xs">Hinge Size</Label>
                  <select
                    className="h-9 w-full rounded-md border border-slate-200 px-2 text-sm"
                    value={`${draft.hinges?.width || 3.5}x${draft.hinges?.height || 3.5}`}
                    onChange={(e) => {
                      const [hw, hh] = e.target.value.split("x").map(Number);
                      patch({ hinges: { ...draft.hinges, width: hw, height: hh } });
                    }}
                  >
                    <option value="3.5x3.5">3.5&quot; × 3.5&quot;</option>
                    <option value="4x4">4&quot; × 4&quot;</option>
                  </select>
                </div>
                <div>
                  <Label className="text-xs">Hinge Type</Label>
                  <select
                    className="h-9 w-full rounded-md border border-slate-200 px-2 text-sm"
                    value={draft.hinges?.type || "standard-butt"}
                    data-testid="interior-door-hinge-type"
                    onChange={(e) => patch({ hinges: { ...draft.hinges, type: e.target.value } })}
                  >
                    {HINGE_TYPES.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
                  </select>
                </div>
              </div>
            </section>

            {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
          </div>
        </div>

        <DialogFooter className="border-t border-slate-200 bg-white px-5 py-4">
          <Button type="button" variant="outline" onClick={handleClose} data-testid="interior-door-details-cancel">Cancel</Button>
          <Button type="button" className="bg-[#0B3A8F] hover:bg-[#082C73]" onClick={handleSave} data-testid="interior-door-details-save">
            Save / Accept
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
