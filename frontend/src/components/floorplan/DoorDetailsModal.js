import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatFtInTight, parseFtIn } from "@/lib/floorPlan/units";
import {
  DOOR_MATERIALS,
  DOOR_PANEL_STYLES,
  HINGE_TYPES,
  applyAutoRoughOpening,
  normalizeDoorSpec,
  syncRoughOpeningOnSizeChange,
  swingLabel,
} from "@/lib/floorPlan/doorSpec";
import DoorProductPreview from "./DoorProductPreview";

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
 * Door Details / Specification modal opened by clicking a door in the 2D plan.
 */
export default function DoorDetailsModal({
  open,
  door,
  wallId,
  openingId,
  onSave,
  onClose,
}) {
  const [draft, setDraft] = useState(() => normalizeDoorSpec(door || {}));
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setDraft(normalizeDoorSpec(door || {}));
      setError("");
    }
  }, [open, door, openingId]);

  const dirty = useMemo(() => JSON.stringify(normalizeDoorSpec(door || {})) !== JSON.stringify(draft), [door, draft]);

  const patch = (partial) => {
    setDraft((prev) => ({ ...prev, ...partial }));
    setError("");
  };

  const setSize = (width, height) => {
    setDraft((prev) => syncRoughOpeningOnSizeChange(prev, width, height));
    setError("");
  };

  const handleClose = () => {
    if (dirty && !window.confirm("Discard unsaved door changes?")) return;
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
      onSave?.({
        wallId,
        openingId,
        data: draft,
      });
    } catch (err) {
      console.error("Door details save failed", err);
      setError(err?.message || "Could not save door details.");
    }
  };

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) handleClose(); }}>
      <DialogContent
        data-testid="door-details-modal"
        className="max-h-[92vh] w-[min(960px,96vw)] max-w-5xl overflow-y-auto border-[#0B3A8F]/30 bg-[#f7f5f0] p-0 text-slate-900 shadow-2xl"
      >
        <DialogHeader className="border-b border-slate-200 bg-[#0B3A8F] px-5 py-4 text-white">
          <DialogTitle className="text-left text-lg font-semibold tracking-wide text-white">
            Exterior Door Details
          </DialogTitle>
          <p className="text-left text-sm text-blue-100">
            Exterior Entry Door · {swingLabel(draft)}
          </p>
        </DialogHeader>

        <div className="grid gap-5 p-5 md:grid-cols-[minmax(240px,0.9fr)_1.2fr]">
          <div className="space-y-3">
            <DoorProductPreview
              width={draft.width}
              height={draft.height}
              material={draft.material}
              style={draft.style}
              boreCount={draft.bore_count}
              hingeCount={draft.hinges?.count}
              hingeType={draft.hinges?.type}
              handing={draft.handing}
              swingDirection={draft.swingDirection}
              className="aspect-[3/5] min-h-[320px] w-full"
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
                  <DimInput valueInches={draft.width} testid="door-width-input" onCommit={(n) => setSize(n, draft.height)} />
                </div>
                <div>
                  <Label className="text-xs">Door Height</Label>
                  <DimInput valueInches={draft.height} testid="door-height-input" onCommit={(n) => setSize(draft.width, n)} />
                </div>
              </div>
              <div className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-sm">
                <span className="text-slate-500">Door Size </span>
                <span className="font-semibold" data-testid="door-size-display">{formatFtInTight(draft.width)} × {formatFtInTight(draft.height)}</span>
              </div>

              <div className="mt-4 flex items-center justify-between gap-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600">Rough Opening</h4>
                <div className="flex items-center gap-2">
                  <select
                    className="h-8 rounded-md border border-slate-200 px-2 text-xs"
                    value={draft.rough_opening_mode}
                    onChange={(e) => {
                      if (e.target.value === "auto") patch(applyAutoRoughOpening(draft));
                      else patch({ rough_opening_mode: "manual" });
                    }}
                    data-testid="door-ro-mode"
                  >
                    <option value="auto">Auto (+1.5&quot; / +2&quot;)</option>
                    <option value="manual">Manual</option>
                  </select>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => patch(applyAutoRoughOpening(draft))}
                  >
                    Use default RO
                  </Button>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">RO Width</Label>
                  <DimInput
                    valueInches={draft.rough_opening_width}
                    testid="door-ro-width-input"
                    onCommit={(n) => patch({ rough_opening_mode: "manual", rough_opening_width: n })}
                  />
                </div>
                <div>
                  <Label className="text-xs">RO Height</Label>
                  <DimInput
                    valueInches={draft.rough_opening_height}
                    testid="door-ro-height-input"
                    onCommit={(n) => patch({ rough_opening_mode: "manual", rough_opening_height: n })}
                  />
                </div>
              </div>
              <div className="mt-2 rounded-md bg-[#0B3A8F]/5 px-3 py-2 text-sm" data-testid="door-ro-display">
                <span className="text-slate-500">Rough Opening </span>
                <span className="font-semibold">{formatFtInTight(draft.rough_opening_width)} × {formatFtInTight(draft.rough_opening_height)}</span>
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-[#0B3A8F]">Material & Style</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Material</Label>
                  <select
                    className="h-9 w-full rounded-md border border-slate-200 px-2 text-sm"
                    value={draft.material}
                    data-testid="door-material"
                    onChange={(e) => patch({ material: e.target.value, door_material: e.target.value })}
                  >
                    {DOOR_MATERIALS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>
                <div>
                  <Label className="text-xs">Style</Label>
                  <select
                    className="h-9 w-full rounded-md border border-slate-200 px-2 text-sm"
                    value={draft.style}
                    data-testid="door-style"
                    onChange={(e) => patch({ style: e.target.value })}
                  >
                    {DOOR_PANEL_STYLES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-[#0B3A8F]">Operation</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Handing</Label>
                  <select
                    className="h-9 w-full rounded-md border border-slate-200 px-2 text-sm"
                    value={draft.handing}
                    data-testid="door-handing"
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
                    data-testid="door-swing"
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
              <div className="mt-2 text-sm font-medium text-slate-800">{swingLabel(draft)}</div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-[#0B3A8F]">Hardware</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Bores</Label>
                  <select
                    className="h-9 w-full rounded-md border border-slate-200 px-2 text-sm"
                    value={String(draft.bore_count)}
                    data-testid="door-bore-count"
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
                    data-testid="door-hinge-count"
                    onChange={(e) => patch({ hinges: { ...draft.hinges, count: Number(e.target.value) } })}
                  >
                    {[2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <div>
                  <Label className="text-xs">Hinge Size</Label>
                  <select
                    className="h-9 w-full rounded-md border border-slate-200 px-2 text-sm"
                    value={`${draft.hinges?.width || 4}x${draft.hinges?.height || 4}`}
                    onChange={(e) => {
                      const [hw, hh] = e.target.value.split("x").map(Number);
                      patch({ hinges: { ...draft.hinges, width: hw, height: hh } });
                    }}
                  >
                    <option value="3.5x3.5">3.5&quot; × 3.5&quot;</option>
                    <option value="4x4">4&quot; × 4&quot;</option>
                    <option value="4.5x4.5">4.5&quot; × 4.5&quot;</option>
                  </select>
                </div>
                <div>
                  <Label className="text-xs">Hinge Type</Label>
                  <select
                    className="h-9 w-full rounded-md border border-slate-200 px-2 text-sm"
                    value={draft.hinges?.type || "ball-bearing"}
                    data-testid="door-hinge-type"
                    onChange={(e) => patch({ hinges: { ...draft.hinges, type: e.target.value } })}
                  >
                    {HINGE_TYPES.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="mt-2 text-xs text-slate-600">
                {draft.bore_count === 2 ? "Lockset + Deadbolt" : draft.bore_count === 1 ? "Lockset" : "No standard bore"}
                {" · "}
                {draft.hinges?.count || 3} × {draft.hinges?.width || 4}&quot; × {draft.hinges?.height || 4}&quot;
              </div>
            </section>

            {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
          </div>
        </div>

        <DialogFooter className="border-t border-slate-200 bg-white px-5 py-4">
          <Button type="button" variant="outline" onClick={handleClose} data-testid="door-details-cancel">Cancel</Button>
          <Button type="button" className="bg-[#0B3A8F] hover:bg-[#082C73]" onClick={handleSave} data-testid="door-details-save">
            Save / Accept
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
