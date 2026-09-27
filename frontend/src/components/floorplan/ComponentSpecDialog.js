import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import ObjectCustomize from "@/components/floorplan/ObjectCustomize";
import FramingAnatomy from "@/components/floorplan/FramingAnatomy";
import {
  DOOR_STYLES, FLOORING, WINDOW_INSTALLS, WINDOW_MATERIALS, WINDOW_STYLES,
} from "@/lib/floorPlan/library";
import { isPlanAppliance } from "@/lib/floorPlan/cabinetRun";
import { formatFtIn, parseFtIn } from "@/lib/floorPlan/units";
import { ABOVE_OPTIONS, recommendLvl } from "@/lib/floorPlan/lvl";
import WallDetail from "@/components/floorplan/WallDetail";
import { WALL_FINISHES, WORK_KINDS } from "@/lib/floorPlan/scope";
import { openingRoughGeometry } from "@/lib/floorPlan/wallFraming";

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

/** Shared Header Engineering UI — always calls recommendLvl (existing engine). */
function HeaderEngineeringPanel({ draft, patch, selectedOpeningId, openings = [], compact = false }) {
  const selected = openings.find((o) => o.id === selectedOpeningId);
  const rec = recommendLvl({
    span_in: draft.header_span || 48,
    tributary_in: draft.header_trib || 144,
    wall_kind: draft.kind === "exterior" ? "exterior" : "interior",
    wall_thickness: draft.thickness,
    above: draft.header_above || "bedroom",
    stories_above: draft.header_stories ?? 1,
  });

  return (
    <div className="rounded-lg border border-[#C45C26]/25 bg-[#FFF8F4] p-2 space-y-2" data-testid="wall-header-engineer">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-[#C45C26]">
        Header engineering
        {selected ? (
          <span className="ml-2 font-normal text-[#8B2E0E]">
            · Selected {selected.type} {formatFtIn(selected.width)}
          </span>
        ) : null}
      </div>
      <div className="text-[10px] text-[#8B2E0E] font-medium">PRELIMINARY HEADER RECOMMENDATION</div>
      <div className="grid grid-cols-2 gap-2">
        <DimField label="Header span" value={draft.header_span || 48} onChange={(header_span) => patch({ header_span: Math.max(12, header_span) })} />
        <DimField label="Tributary width" value={draft.header_trib || 144} onChange={(header_trib) => patch({ header_trib: Math.max(24, header_trib) })} />
      </div>
      <Field label="What is above">
        <select className="h-9 w-full rounded-md border border-slate-200 px-2 text-xs bg-white" value={draft.header_above || "bedroom"} onChange={(e) => patch({ header_above: e.target.value })}>
          {ABOVE_OPTIONS.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
        </select>
      </Field>
      <Field label="Stories above">
        <select className="h-9 w-full rounded-md border border-slate-200 px-2 text-xs bg-white" value={String(draft.header_stories ?? 1)} onChange={(e) => patch({ header_stories: Number(e.target.value) })}>
          <option value="0">None — this is the top plate / roof</option>
          <option value="1">1 story above</option>
          <option value="2">2 stories above</option>
        </select>
      </Field>
      <div className="space-y-1">
        <div className="text-sm font-['Outfit'] font-semibold text-[#0B3A8F]" data-testid="header-rec-label">{rec.label}</div>
        <div className="text-[11px] text-[#4B6370]">{rec.notes}</div>
        <div className="text-[11px] text-[#4B6370]">
          Jack studs: {rec.jack_studs} each end · King studs: {rec.king_studs} each end
        </div>
        {rec.header_kind === "dimensional" ? (
          <div className="text-[11px] text-[#2E7D32] font-medium">Twin dimensional lumber is enough — LVL not required.</div>
        ) : rec.engineer_required ? (
          <div className="text-[11px] text-red-600 font-medium">Engineer required. Do not cut this opening on a guess.</div>
        ) : (
          <div className="text-[11px] text-[#C45C26] font-medium">2x10 / 2x12 will not carry this load. Use the LVL shown.</div>
        )}
        {!compact ? <WallDetail rec={rec} /> : null}
        {compact ? <p className="text-[10px] text-[#8B2E0E] leading-snug">{rec.disclaimer}</p> : null}
      </div>
    </div>
  );
}

export default function ComponentSpecDialog({
  spec,
  level,
  foundation,
  onAccept,
  onClose,
  onDelete,
  onVoice,
  onAddOpening,
  onAddHeader,
  onEditOpening,
  counterMaterial,
  onCounterMaterial,
  onSnapCounters,
  onSaveStandard,
}) {
  const [draft, setDraft] = useState(spec?.data || null);
  const [wallTab, setWallTab] = useState("specs");
  const [selectedMemberId, setSelectedMemberId] = useState(null);
  const [selectedOpeningId, setSelectedOpeningId] = useState(null);

  useEffect(() => {
    setDraft(spec?.data ? { ...spec.data } : null);
    setWallTab("specs");
    setSelectedMemberId(null);
    setSelectedOpeningId(null);
  }, [spec]);

  const headerDefaults = useMemo(() => ({
    header_span: draft?.header_span || 48,
    header_trib: draft?.header_trib || 144,
    header_above: draft?.header_above || "bedroom",
    header_stories: draft?.header_stories ?? 1,
  }), [draft?.header_span, draft?.header_trib, draft?.header_above, draft?.header_stories]);

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

  const hostWallOpenings = ((level?.walls || []).find((w) => w.id === spec.id)?.openings || []);

  const bindHeaderToOpening = (openingId) => {
    const op = hostWallOpenings.find((o) => o.id === openingId);
    if (!op) return;
    const rough = openingRoughGeometry(op, draft);
    setSelectedOpeningId(openingId);
    setWallTab("framing");
    patch({
      header_span: Number(op.header_engineering?.header_span) || rough.roWidth,
      header_trib: Number(op.header_engineering?.header_trib) || draft.header_trib || 144,
      header_above: op.header_engineering?.header_above || draft.header_above || "bedroom",
      header_stories: op.header_engineering?.header_stories ?? draft.header_stories ?? 1,
      selected_header_opening_id: openingId,
    });
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose?.(); }}>
      <DialogContent className={`bg-white max-h-[90vh] overflow-y-auto ${spec.type === "wall" ? "max-w-4xl" : "max-w-lg"}`} data-testid="component-spec-dialog">
        <DialogHeader>
          <DialogTitle className="font-['Outfit'] text-[#0B3A8F]">{title}</DialogTitle>
          <DialogDescription className="text-xs text-[#4B6370]">
            {spec.type === "wall"
              ? "Wall specs, openings, framing anatomy, and a preliminary header size. Twin 2x10 / 2x12 is used when it checks; otherwise an LVL. Not a stamped engineering drawing."
              : "Edit the working drawing. Accept applies size, finish, and catalog data to the plan at scale."}
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
              <div className="rounded-md border border-[#0B3A8F]/15 bg-[#F4F7F8] px-2 py-1.5 text-[11px] text-[#4B6370]">
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
          <div className="space-y-3" data-testid="wall-spec-dialog">
            <div className="flex gap-1 rounded-md border border-slate-200 bg-slate-50 p-0.5" data-testid="wall-spec-tabs">
              {[
                { id: "specs", label: "Wall Specs" },
                { id: "framing", label: "Framing Anatomy" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={`flex-1 rounded px-2 py-1.5 text-xs font-medium ${wallTab === tab.id ? "bg-[#0B3A8F] text-white" : "text-[#4B6370] hover:bg-white"}`}
                  data-testid={`wall-tab-${tab.id}`}
                  onClick={() => setWallTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {wallTab === "specs" ? (
              <>
            <div className="grid grid-cols-2 gap-2">
              <DimField label="Length" value={draft.length} onChange={(length) => patch({ length })} />
              <DimField label="Thickness" value={draft.thickness} onChange={(thickness) => patch({ thickness: Math.max(3.5, thickness) })} />
              <DimField label="Height" value={draft.height} onChange={(height) => patch({ height })} />
              <Field label="Kind">
                <select className="h-9 w-full rounded-md border border-slate-200 px-2 text-xs bg-white" value={draft.kind || "interior"} onChange={(e) => patch({ kind: e.target.value, bearing: e.target.value === "exterior" ? true : draft.bearing })}>
                  <option value="interior">Interior</option>
                  <option value="exterior">Exterior</option>
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Work">
                <select className="h-9 w-full rounded-md border border-slate-200 px-2 text-xs bg-white" value={draft.work || "existing"} onChange={(e) => patch({ work: e.target.value })}>
                  {WORK_KINDS.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </select>
              </Field>
              <Field label="Stud / plumbing">
                <select className="h-9 w-full rounded-md border border-slate-200 px-2 text-xs bg-white" value={draft.plumbing ? "2x6" : "std"} onChange={(e) => {
                  const plumbing = e.target.value === "2x6";
                  patch({ plumbing, thickness: plumbing ? Math.max(Number(draft.thickness) || 0, 5.5) : (draft.kind === "exterior" ? 6 : 4.5) });
                }}>
                  <option value="std">{draft.kind === "exterior" ? "2x6 exterior" : "2x4 interior"}</option>
                  <option value="2x6">2x6 plumbing wall</option>
                </select>
              </Field>
              <Field label="Stud spacing">
                <select
                  className="h-9 w-full rounded-md border border-slate-200 px-2 text-xs bg-white"
                  value={String(draft.stud_spacing || 16)}
                  data-testid="wall-stud-spacing"
                  onChange={(e) => patch({ stud_spacing: Number(e.target.value) })}
                >
                  <option value="16">16&quot; O.C.</option>
                  <option value="24">24&quot; O.C.</option>
                </select>
              </Field>
            </div>
            <label className="flex items-center gap-2 text-xs text-[#061A23]">
              <input type="checkbox" checked={Boolean(draft.bearing ?? draft.kind === "exterior")} onChange={(e) => patch({ bearing: e.target.checked })} />
              Load-bearing (headers required at openings)
            </label>
            <label className="flex items-center gap-2 text-xs text-[#061A23]">
              <input
                type="checkbox"
                checked={Boolean(draft.foundation_contact)}
                data-testid="wall-foundation-contact"
                onChange={(e) => patch({
                  foundation_contact: e.target.checked,
                  bottom_plate_treatment: e.target.checked ? "pressure-treated" : "standard",
                })}
              />
              Foundation contact (pressure-treated bottom plate)
            </label>
            <TextField label="Notes" value={draft.note} onChange={(note) => patch({ note })} />
            {onVoice ? <Button type="button" variant="outline" className="h-8 text-xs" onClick={onVoice}>Voice note</Button> : null}

            <div className="rounded-lg border border-[#0B3A8F]/15 bg-[#F4F7F8] p-2 space-y-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-[#0B3A8F]">Add at this click</div>
              <div className="text-[11px] text-[#4B6370]">
                Offset {formatFtIn(Math.max(0, (Number(spec.clickT) || 0.5) * (Number(draft.length) || 0)))} along this {formatFtIn(draft.length)} wall.
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { id: "window", label: "Window" },
                  { id: "door", label: "Door" },
                  { id: "cased", label: "Cased opening" },
                ].map((row) => (
                  <Button
                    key={row.id}
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-9 text-xs"
                    data-testid={`wall-add-${row.id}`}
                    onClick={() => {
                      try {
                        onAddOpening?.(row.id, Number(spec.clickT) || 0.5);
                      } catch (err) {
                        console.error("Could not add opening to wall", err);
                      }
                    }}
                  >
                    {row.label}
                  </Button>
                ))}
                <Button
                  type="button"
                  size="sm"
                  className="h-9 text-xs bg-[#C45C26] hover:bg-[#A3481C] text-white"
                  data-testid="wall-add-header"
                  onClick={() => {
                    try {
                      onAddHeader?.({
                        t: Number(spec.clickT) || 0.5,
                        span_in: Number(draft.header_span) || 48,
                        tributary_in: Number(draft.header_trib) || 144,
                        above: draft.header_above || "bedroom",
                        stories_above: Number(draft.header_stories ?? 1),
                      });
                    } catch (err) {
                      console.error("Could not size a header on that wall", err);
                    }
                  }}
                >
                  Add header / beam
                </Button>
              </div>
            </div>

            <HeaderEngineeringPanel draft={draft} patch={patch} selectedOpeningId={selectedOpeningId} openings={hostWallOpenings} />

            {hostWallOpenings.length ? (
              <div className="space-y-1">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-[#0B3A8F]">Openings on this wall</div>
                {hostWallOpenings.map((op) => (
                  <div key={op.id} className="flex items-center justify-between gap-2 text-[11px] text-[#4B6370] rounded border border-slate-200 px-2 py-1">
                    <button
                      type="button"
                      className="text-left capitalize hover:text-[#0B3A8F]"
                      onClick={() => {
                        setSelectedOpeningId(op.id);
                        bindHeaderToOpening(op.id);
                      }}
                    >
                      {op.type} · {formatFtIn(op.width)} · at {formatFtIn(op.offset)}
                    </button>
                    <div className="flex gap-1">
                      <Button type="button" size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => bindHeaderToOpening(op.id)}>Frame</Button>
                      {onEditOpening ? (
                        <Button type="button" size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => onEditOpening(spec.id, op.id)}>Edit</Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
              </>
            ) : (
              <div className="space-y-3">
                <FramingAnatomy
                  wall={draft}
                  length={draft.length}
                  openings={hostWallOpenings}
                  foundation={foundation}
                  headerDefaults={headerDefaults}
                  openingHeaderOverrides={selectedOpeningId ? {
                    [selectedOpeningId]: {
                      header_span: draft.header_span,
                      header_trib: draft.header_trib,
                      header_above: draft.header_above,
                      header_stories: draft.header_stories,
                    },
                  } : {}}
                  selectedMemberId={selectedMemberId}
                  selectedOpeningId={selectedOpeningId}
                  onSelectMember={(m) => setSelectedMemberId(m?.id || null)}
                  onSelectOpening={(id) => setSelectedOpeningId(id)}
                  onSelectHeader={(openingId) => {
                    bindHeaderToOpening(openingId);
                    setSelectedMemberId(`header-${openingId}-p0`);
                  }}
                />
                <HeaderEngineeringPanel
                  draft={draft}
                  patch={patch}
                  selectedOpeningId={selectedOpeningId}
                  openings={hostWallOpenings}
                  compact
                />
              </div>
            )}
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
              <DimField label="Outside width" value={draft.width} onChange={(width) => patch({ width: Math.max(36, width) })} />
              <DimField label="Outside depth" value={draft.depth} onChange={(depth) => patch({ depth: Math.max(36, depth) })} />
            </div>
            <DimField label="Wall thickness" value={draft.wall_thickness ?? 3.5} onChange={(wall_thickness) => patch({ wall_thickness: Math.max(2, wall_thickness) })} />
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
          <Button type="button" className="bg-[#0B3A8F] hover:bg-[#082C73]" data-testid="spec-accept" onClick={accept}>Accept</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
