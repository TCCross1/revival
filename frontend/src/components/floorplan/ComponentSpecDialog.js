import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import ObjectCustomize from "@/components/floorplan/ObjectCustomize";
import {
  DOOR_STYLES, FLOORING, WINDOW_INSTALLS, WINDOW_MATERIALS, WINDOW_STYLES,
} from "@/lib/floorPlan/library";
import { isPlanAppliance } from "@/lib/floorPlan/cabinetRun";
import { formatFtIn, parseFtIn } from "@/lib/floorPlan/units";
import { ABOVE_OPTIONS } from "@/lib/floorPlan/lvl";
import { WALL_FINISHES } from "@/lib/floorPlan/scope";

function Field({ label, children }) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] uppercase tracking-wide text-[#4B6370]">{label}</Label>
      {children}
    </div>
  );
}

function TextField({ label, value, onChange, placeholder }) {
  return (
    <Field label={label}>
      <Input className="h-9 text-xs" value={value || ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder || ""} />
    </Field>
  );
}

function DimField({ label, value, onChange }) {
  return (
    <Field label={label}>
      <Input
        className="h-9 text-xs"
        defaultValue={formatFtIn(value)}
        key={`${label}-${value}`}
        onBlur={(e) => onChange(parseFtIn(e.target.value))}
      />
    </Field>
  );
}

export default function ComponentSpecDialog({
  spec,
  level,
  onAccept,
  onClose,
  onDelete,
  onVoice,
  counterMaterial,
  onCounterMaterial,
  onSnapCounters,
  onSaveStandard,
}) {
  const [draft, setDraft] = useState(spec?.data || null);

  useEffect(() => {
    setDraft(spec?.data ? { ...spec.data } : null);
  }, [spec]);

  if (!spec || !draft) return null;

  const patch = (next) => setDraft((current) => ({ ...current, ...next }));
  const title = spec.type === "object" ? (draft.name || "Component")
    : spec.type === "opening" ? `${draft.type === "cased" ? "Cased opening" : draft.type === "window" ? "Window" : "Door"} specs`
      : spec.type === "wall" ? "Wall specs"
        : spec.type === "beam" ? "LVL / beam specs"
          : spec.type === "room" ? (draft.name || "Room")
            : "Component specs";

  const accept = () => {
    try {
      onAccept({ ...spec, data: draft });
    } catch (err) {
      console.error("Could not apply component specs", err);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose?.(); }}>
      <DialogContent className="bg-white max-w-lg max-h-[86vh] overflow-y-auto" data-testid="component-spec-dialog">
        <DialogHeader>
          <DialogTitle className="font-['Outfit'] text-[#0A4D68]">{title}</DialogTitle>
          <DialogDescription className="text-xs text-[#4B6370]">
            Edit the working drawing. Accept applies size, finish, and catalog data to the plan at scale.
          </DialogDescription>
        </DialogHeader>

        {spec.type === "object" ? (
          <div className="space-y-3">
            <TextField label="Name" value={draft.name} onChange={(name) => patch({ name })} />
            <div className="grid grid-cols-2 gap-2">
              <TextField label="Manufacturer" value={draft.manufacturer} onChange={(manufacturer) => patch({ manufacturer })} />
              <TextField label="Model number" value={draft.model_number} onChange={(model_number) => patch({ model_number })} />
              <TextField label="SKU" value={draft.sku} onChange={(sku) => patch({ sku })} />
              <TextField label="Catalog ID" value={draft.library_id} onChange={(library_id) => patch({ library_id })} />
            </div>
            {isPlanAppliance(draft) ? (
              <div className="rounded-md border border-[#0A4D68]/15 bg-[#F4F7F8] px-2 py-1.5 text-[11px] text-[#4B6370]">
                2D appliances are always 24&quot; deep and flush with the base run. Use actual depth for ordering only.
              </div>
            ) : null}
            {isPlanAppliance(draft) ? (
              <DimField label="Actual / spec depth" value={draft.actual_depth || 24} onChange={(actual_depth) => patch({ actual_depth })} />
            ) : null}
            <TextField label="Description" value={draft.description} onChange={(description) => patch({ description })} />
            <ObjectCustomize
              obj={draft}
              level={level}
              onPatch={patch}
              onRotate={() => {
                const order = ["south", "west", "north", "east"];
                setDraft((current) => {
                  const front = order[(order.indexOf(current.front || "south") + 1) % order.length];
                  return { ...current, front, rotation: ((current.rotation || 0) + 90) % 360 };
                });
              }}
              onDelete={onDelete}
              onVoice={onVoice}
              counterMaterial={counterMaterial}
              onCounterMaterial={onCounterMaterial}
              onSnapCounters={onSnapCounters}
              onSaveStandard={onSaveStandard}
            />
          </div>
        ) : null}

        {spec.type === "opening" ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <DimField label="Width" value={draft.width} onChange={(width) => patch({ width: Math.max(12, width) })} />
              <DimField label="Height" value={draft.height} onChange={(height) => patch({ height: Math.max(12, height) })} />
              {draft.type === "window" ? <DimField label="Sill" value={draft.sill} onChange={(sill) => patch({ sill })} /> : null}
              <DimField label="Offset on wall" value={draft.offset} onChange={(offset) => patch({ offset: Math.max(0, offset) })} />
            </div>
            <Field label="Style">
              <select className="h-9 w-full rounded-md border border-slate-200 px-2 text-xs bg-white" value={draft.style || ""} onChange={(e) => {
                const style = e.target.value;
                patch({
                  style,
                  leafs: style === "french" ? 2 : draft.leafs || 1,
                  lites: style === "french" ? (draft.lites || 4) : draft.lites,
                });
              }}>
                {(draft.type === "window" ? WINDOW_STYLES : DOOR_STYLES).map((row) => (
                  <option key={row.id} value={row.id}>{row.name}</option>
                ))}
              </select>
            </Field>
            {draft.type === "door" || draft.style === "french" ? (
              <div className="grid grid-cols-2 gap-2">
                <Field label="Leaves">
                  <Input className="h-9 text-xs" type="number" min="1" max="2" value={draft.leafs || 1} onChange={(e) => patch({ leafs: Number(e.target.value) || 1 })} />
                </Field>
                <Field label="Vertical lites per leaf">
                  <Input className="h-9 text-xs" type="number" min="0" max="8" value={draft.lites || 0} onChange={(e) => patch({ lites: Number(e.target.value) || 0 })} />
                </Field>
              </div>
            ) : null}
            {draft.type === "window" ? (
              <div className="grid grid-cols-2 gap-2">
                <Field label="Frame material">
                  <select className="h-9 w-full rounded-md border border-slate-200 px-2 text-xs bg-white" value={draft.material || "vinyl"} onChange={(e) => patch({ material: e.target.value })}>
                    {WINDOW_MATERIALS.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                  </select>
                </Field>
                <Field label="Install">
                  <select className="h-9 w-full rounded-md border border-slate-200 px-2 text-xs bg-white" value={draft.install || "new-construction"} onChange={(e) => patch({ install: e.target.value, extension_jambs: e.target.value === "new-construction" })}>
                    {WINDOW_INSTALLS.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                  </select>
                </Field>
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-2">
              <TextField label="Manufacturer" value={draft.manufacturer} onChange={(manufacturer) => patch({ manufacturer })} />
              <TextField label="Model number" value={draft.model_number} onChange={(model_number) => patch({ model_number })} />
              <TextField label="Finish" value={draft.finish} onChange={(finish) => patch({ finish })} />
              <TextField label="Material" value={draft.material} onChange={(material) => patch({ material })} />
            </div>
            <TextField label="Description" value={draft.description} onChange={(description) => patch({ description })} />
            <TextField label="Side notes" value={draft.note} onChange={(note) => patch({ note })} />
          </div>
        ) : null}

        {spec.type === "wall" ? (
          <div className="space-y-3">
            <DimField label="Length" value={draft.length} onChange={(length) => patch({ length })} />
            <DimField label="Thickness" value={draft.thickness} onChange={(thickness) => patch({ thickness: Math.max(3.5, thickness) })} />
            <DimField label="Height" value={draft.height} onChange={(height) => patch({ height })} />
            <Field label="Kind">
              <select className="h-9 w-full rounded-md border border-slate-200 px-2 text-xs bg-white" value={draft.kind || "interior"} onChange={(e) => patch({ kind: e.target.value })}>
                <option value="interior">Interior</option>
                <option value="exterior">Exterior</option>
              </select>
            </Field>
            <TextField label="Notes" value={draft.note} onChange={(note) => patch({ note })} />
          </div>
        ) : null}

        {spec.type === "beam" ? (
          <div className="space-y-3">
            <TextField label="Label" value={draft.label} onChange={(label) => patch({ label })} />
            <div className="grid grid-cols-2 gap-2">
              <DimField label="Span" value={draft.span_in} onChange={(span_in) => patch({ span_in: Math.max(12, span_in) })} />
              <DimField label="Tributary" value={draft.tributary_in} onChange={(tributary_in) => patch({ tributary_in: Math.max(24, tributary_in) })} />
            </div>
            <Field label="Above">
              <select className="h-9 w-full rounded-md border border-slate-200 px-2 text-xs bg-white" value={draft.above || "bedroom"} onChange={(e) => patch({ above: e.target.value })}>
                {ABOVE_OPTIONS.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
            </Field>
            <TextField label="Species / grade" value={draft.species} onChange={(species) => patch({ species })} />
            <TextField label="Notes" value={draft.notes || draft.note} onChange={(notes) => patch({ notes, note: notes })} />
          </div>
        ) : null}

        {spec.type === "room" ? (
          <div className="space-y-3">
            <TextField label="Name" value={draft.name} onChange={(name) => patch({ name })} />
            <div className="grid grid-cols-2 gap-2">
              <DimField label="Width" value={draft.width} onChange={(width) => patch({ width: Math.max(36, width) })} />
              <DimField label="Depth" value={draft.depth} onChange={(depth) => patch({ depth: Math.max(36, depth) })} />
            </div>
            <Field label="Flooring">
              <select className="h-9 w-full rounded-md border border-slate-200 px-2 text-xs bg-white" value={draft.flooring || "lvp"} onChange={(e) => patch({ flooring: e.target.value })}>
                {FLOORING.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
            </Field>
            <Field label="Wall finish">
              <select className="h-9 w-full rounded-md border border-slate-200 px-2 text-xs bg-white" value={draft.wall_finish || ""} onChange={(e) => patch({ wall_finish: e.target.value })}>
                {WALL_FINISHES.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
            </Field>
            <TextField label="Notes" value={draft.note || draft.notes} onChange={(note) => patch({ note, notes: note })} />
          </div>
        ) : null}

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" className="bg-[#0A4D68] hover:bg-[#083D53]" data-testid="spec-accept" onClick={accept}>Accept</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
