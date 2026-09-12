import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  APPLIANCE_FUELS, CABINET_DOOR_STYLES, CABINET_GLASS, COUNTER_MATERIALS,
  FINISH_VARIANTS, HARDWARE_FINISHES, HARDWARE_SIZES, HARDWARE_STYLES, WOOD_SPECIES,
} from "@/lib/floorPlan/library";
import { kitchenAnchorStatus, siteConditionReport } from "@/lib/floorPlan/kitchenDesign";
import { formatFtIn, parseFtIn } from "@/lib/floorPlan/units";

const ANCHORS = [
  { id: "range", label: "Range / cooktop", hint: "Gas shutoff or 240V" },
  { id: "fridge", label: "Refrigerator", hint: "Dedicated outlet" },
  { id: "sink", label: "Sink / plumbing", hint: "Existing rough-in" },
  { id: "dishwasher", label: "Dishwasher", hint: "Snaps beside sink" },
];

export default function KitchenDesignPanel({
  level,
  design,
  warnings = [],
  islandHint,
  placingAnchor,
  onDesignPatch,
  onPlaceAnchor,
  onAutoGenerate,
  onConfirmWalls,
  onCancelWalls,
  pickingWalls = false,
  selectedWallCount = 0,
  onCounters,
  onApplyStyle,
}) {
  const status = kitchenAnchorStatus(level);
  const site = siteConditionReport(level, design);
  const ready = Boolean(site.ready);
  const style = design.style || {};

  const patchHandedness = (handedness) => {
    onDesignPatch({
      handedness,
      dw_side: handedness === "left" ? "right" : "left",
    });
  };

  return (
    <div className="p-3 border-b border-slate-200 space-y-3" data-testid="kitchen-design-panel">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-[#0B3A8F]">Kitchen design intelligence</div>
        <p className="text-[11px] text-[#4B6370] mt-0.5">Place the range, refrigerator, sink, dishwasher, and corners first. Auto Generator fills only the walls you select and never moves those locked items.</p>
      </div>

      <div className="rounded-lg border border-[#0B3A8F]/15 bg-[#F4F7F8] p-2 space-y-2" data-testid="kitchen-site-conditions">
        <div className="text-[11px] font-semibold text-[#0B3A8F]">1. Site conditions</div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-[10px]">Ceiling height</Label>
            <Input className="h-8 text-xs" defaultValue={formatFtIn(design.ceiling_height)} key={`ceil-${design.ceiling_height}`} onBlur={(e) => {
              const next = parseFtIn(e.target.value);
              if (next >= 84) onDesignPatch({ ceiling_height: next });
            }} />
          </div>
          <div>
            <Label className="text-[10px]">Soffit / bulkhead</Label>
            <Input className="h-8 text-xs" defaultValue={String(design.soffit_in || 0)} onBlur={(e) => onDesignPatch({ soffit_in: Math.max(0, Number(e.target.value) || 0) })} />
          </div>
          <div>
            <Label className="text-[10px]">Range fuel</Label>
            <select className="h-8 w-full rounded-md border border-slate-200 px-2 text-xs bg-white" value={design.fuel} onChange={(e) => onDesignPatch({ fuel: e.target.value })}>
              {APPLIANCE_FUELS.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-[10px]">Cooks</Label>
            <select className="h-8 w-full rounded-md border border-slate-200 px-2 text-xs bg-white" value={String(design.cooks || 1)} onChange={(e) => onDesignPatch({ cooks: Number(e.target.value) })}>
              <option value="1">One cook · 42&quot; aisle</option>
              <option value="2">Two cooks · 48&quot; aisle</option>
            </select>
          </div>
          <div>
            <Label className="text-[10px]">Primary cook</Label>
            <select className="h-8 w-full rounded-md border border-slate-200 px-2 text-xs bg-white" value={design.handedness || "right"} onChange={(e) => patchHandedness(e.target.value)}>
              <option value="right">Right-handed · DW left of sink</option>
              <option value="left">Left-handed · DW right of sink</option>
            </select>
          </div>
          <div>
            <Label className="text-[10px]">Sink base</Label>
            <select className="h-8 w-full rounded-md border border-slate-200 px-2 text-xs bg-white" value={String(design.sink_width)} onChange={(e) => onDesignPatch({ sink_width: Number(e.target.value) })}>
              {[30, 33, 36].map((w) => <option key={w} value={w}>{w}&quot;</option>)}
            </select>
          </div>
          <div>
            <Label className="text-[10px]">Range width</Label>
            <select className="h-8 w-full rounded-md border border-slate-200 px-2 text-xs bg-white" value={String(design.range_width)} onChange={(e) => onDesignPatch({ range_width: Number(e.target.value) })}>
              {[30, 36].map((w) => <option key={w} value={w}>{w}&quot;</option>)}
            </select>
          </div>
          <div>
            <Label className="text-[10px]">Refrigerator</Label>
            <select className="h-8 w-full rounded-md border border-slate-200 px-2 text-xs bg-white" value={String(design.fridge_width || 36)} onChange={(e) => onDesignPatch({ fridge_width: Number(e.target.value) })}>
              {[30, 36, 42].map((w) => <option key={w} value={w}>{w}&quot;</option>)}
            </select>
          </div>
        </div>
        <div className="text-[10px] text-[#4B6370] space-y-0.5">
          <div>{site.room ? `Room ${site.room.name}: ${formatFtIn(site.room.width)} × ${formatFtIn(site.room.depth)}` : "Draw the kitchen room first."}</div>
          <div>{site.windows.length ? `${site.windows.length} window${site.windows.length === 1 ? "" : "s"} · ${site.windows.map((w) => `${formatFtIn(w.width)} × ${formatFtIn(w.height)}`).join(", ")}` : "No windows on kitchen walls yet."}</div>
          <div>{site.doors.length ? `${site.doors.length} door/cased opening${site.doors.length === 1 ? "" : "s"}` : "No doors captured on kitchen walls yet."}</div>
        </div>
      </div>

      <div>
        <div className="text-[11px] font-semibold text-[#0B3A8F] mb-1">2. Lock utility anchors</div>
        <div className="grid grid-cols-2 gap-1">
          {ANCHORS.map((row) => (
            <button
              key={row.id}
              type="button"
              data-testid={`kitchen-anchor-${row.id}`}
              onClick={() => onPlaceAnchor(row.id)}
              className={`rounded-md border px-2 py-1.5 text-[11px] text-left ${placingAnchor === row.id ? "border-[#C9A227] bg-[#C9A227]/15 text-[#061A23]" : status[row.id] ? "border-[#2E7D32]/40 bg-[#2E7D32]/10 text-[#2E7D32]" : "border-slate-200 text-[#4B6370]"}`}
            >
              <div>{status[row.id] ? "✓ " : ""}{row.label}</div>
              <div className="text-[10px] opacity-80">{row.hint}</div>
            </button>
          ))}
        </div>
        {placingAnchor ? (
          <div className="mt-1 text-[11px] text-[#C9A227]">Tap the exact {placingAnchor} utility on the plan. Dishwasher snaps beside the sink and stays locked.</div>
        ) : (
          <div className="mt-1 text-[10px] text-[#4B6370]">Tap a button, then tap the rough-in. These stay locked through Auto Generator.</div>
        )}
      </div>

      <div className="space-y-1">
        <div className="text-[11px] font-semibold text-[#0B3A8F]">3. Auto Generator</div>
        {pickingWalls ? (
          <div className="rounded-md border border-[#C9A227]/50 bg-[#FBF6E8] p-2 space-y-2" data-testid="auto-generator-wall-prompt">
            <p className="text-[11px] text-[#061A23]">Which walls need cabinets? Click each wall on the plan, then Done.</p>
            <p className="text-[10px] text-[#4B6370]">{selectedWallCount ? `${selectedWallCount} wall${selectedWallCount === 1 ? "" : "s"} selected` : "No walls selected yet."}</p>
            <div className="grid grid-cols-2 gap-1">
              <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={onCancelWalls} data-testid="auto-generator-cancel">
                Cancel
              </Button>
              <Button type="button" size="sm" className="h-8 text-xs bg-[#C9A227] hover:bg-[#B8911F] text-[#061A23]" onClick={onConfirmWalls} data-testid="auto-generator-done">
                Done
              </Button>
            </div>
          </div>
        ) : (
          <>
            <Button type="button" size="sm" className="h-8 w-full text-xs bg-[#0B3A8F] hover:bg-[#082C73]" onClick={onAutoGenerate} data-testid="kitchen-auto-generator">
              Auto Generator
            </Button>
            <p className="text-[10px] text-[#4B6370]">Fills measured gaps with 12–36&quot; cabinets and fillers up to 4&quot;. Fixed appliances and corners do not move.</p>
          </>
        )}
        {islandHint ? <div className="text-[10px] text-[#4B6370]">{islandHint}</div> : null}
      </div>

      <div className="space-y-1">
        <div className="text-[11px] font-semibold text-[#0B3A8F]">4. Counters, then style</div>
        <select className="h-8 w-full rounded-md border border-slate-200 px-2 text-xs bg-white" value={style.counter_material || "quartz"} onChange={(e) => onDesignPatch({ style: { ...style, counter_material: e.target.value } })}>
          {COUNTER_MATERIALS.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
        </select>
        <Button type="button" size="sm" variant="outline" className="h-8 w-full text-xs" onClick={onCounters} data-testid="kitchen-counters">
          Generate countertop silhouette
        </Button>
        <select className="h-8 w-full rounded-md border border-slate-200 px-2 text-xs bg-white" value={style.door_style || "shaker"} onChange={(e) => onDesignPatch({ style: { ...style, door_style: e.target.value } })}>
          {CABINET_DOOR_STYLES.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
        </select>
        <select className="h-8 w-full rounded-md border border-slate-200 px-2 text-xs bg-white" value={style.species || "painted"} onChange={(e) => onDesignPatch({ style: { ...style, species: e.target.value } })}>
          {WOOD_SPECIES.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
        </select>
        <select className="h-8 w-full rounded-md border border-slate-200 px-2 text-xs bg-white" value={style.finish || "white"} onChange={(e) => onDesignPatch({ style: { ...style, finish: e.target.value } })}>
          {FINISH_VARIANTS.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
        </select>
        <div className="grid grid-cols-2 gap-1">
          <select className="h-8 w-full rounded-md border border-slate-200 px-2 text-xs bg-white" value={style.hardware_style || "bar"} onChange={(e) => onDesignPatch({ style: { ...style, hardware_style: e.target.value } })}>
            {HARDWARE_STYLES.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
          <select className="h-8 w-full rounded-md border border-slate-200 px-2 text-xs bg-white" value={style.hardware_finish || "brass"} onChange={(e) => onDesignPatch({ style: { ...style, hardware_finish: e.target.value } })}>
            {HARDWARE_FINISHES.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
        </div>
        <select className="h-8 w-full rounded-md border border-slate-200 px-2 text-xs bg-white" value={style.hardware_size || "5"} onChange={(e) => onDesignPatch({ style: { ...style, hardware_size: e.target.value } })}>
          {HARDWARE_SIZES.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
        </select>
        <label className="flex items-center gap-2 text-[11px] text-[#4B6370]">
          <input type="checkbox" checked={Boolean(style.wall_glass)} onChange={(e) => onDesignPatch({ style: { ...style, wall_glass: e.target.checked } })} />
          Glass doors on wall cabinets
        </label>
        {style.wall_glass ? (
          <select className="h-8 w-full rounded-md border border-slate-200 px-2 text-xs bg-white" value={style.glass || "clear"} onChange={(e) => onDesignPatch({ style: { ...style, glass: e.target.value } })}>
            {CABINET_GLASS.filter((row) => row.id).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
        ) : null}
        <Button type="button" size="sm" className="h-8 w-full text-xs bg-[#C9A227] hover:bg-[#B89120] text-[#061A23]" onClick={onApplyStyle} data-testid="kitchen-apply-style">
          Apply style to all cabinets
        </Button>
      </div>

      {warnings.length ? (
        <div className="space-y-1" data-testid="kitchen-warnings">
          <div className="text-[11px] font-semibold text-[#0B3A8F]">NKBA + professional checks</div>
          {warnings.map((row, idx) => (
            <div key={`${row.code || row.text}-${idx}`} className={`text-[11px] rounded-md px-2 py-1 ${row.severity === "error" ? "bg-red-50 text-red-700" : row.severity === "warn" ? "bg-amber-50 text-amber-800" : "bg-slate-50 text-[#4B6370]"}`}>
              {row.text}
            </div>
          ))}
        </div>
      ) : ready ? (
        <div className="text-[11px] rounded-md px-2 py-1 bg-[#2E7D32]/10 text-[#2E7D32]" data-testid="kitchen-warnings-clear">
          No NKBA violations on the current layout.
        </div>
      ) : null}
    </div>
  );
}
