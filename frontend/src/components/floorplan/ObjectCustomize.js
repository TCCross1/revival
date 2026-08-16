import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LibraryThumb } from "@/components/floorplan/symbols";
import {
  APPLIANCE_FINISHES, APPLIANCE_FUELS, CABINET_CROWNS, CABINET_DOOR_STYLES, CABINET_GLASS,
  COUNTER_MATERIALS, EDGE_PROFILES, FAUCET_FINISHES, FAUCET_STYLES, FINISH_VARIANTS,
  HARDWARE_FINISHES, HARDWARE_SIZES, HARDWARE_STYLES, HOOD_TYPES, MIRROR_SHAPES,
  SHOWER_DOORS, SHOWER_GLASS, SHOWER_TYPES, SINK_TYPES, TOILET_TYPES, TUB_TYPES, VANITY_MOUNTS, WOOD_SPECIES,
  applyWallCabinetDrawerRule, cabinetConfigOptions, isApplianceFinishObject, isBaseRunObject, isCabinetObject, isCountertopObject, isFaucetObject,
  isHoodObject, isMirrorObject, isShowerObject, isSinkObject, isToiletObject, isTubObject, isWallCabinetObject,
  resolvedCabinetConfig, wallCabinetAllowsDrawer,
} from "@/lib/floorPlan/library";
import { WORK_KINDS, workOf } from "@/lib/floorPlan/scope";
import { formatFtIn, parseFtIn } from "@/lib/floorPlan/units";

function Select({ value, onChange, options, testid }) {
  return (
    <select className="h-9 w-full rounded-md border border-slate-200 px-2 text-xs bg-white" value={value || ""} onChange={(e) => onChange(e.target.value)} data-testid={testid}>
      {options.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
    </select>
  );
}

export default function ObjectCustomize({
  obj,
  level,
  onPatch,
  onRotate,
  onDelete,
  onVoice,
  counterMaterial,
  onCounterMaterial,
  onSnapCounters,
  onSaveStandard,
}) {
  const cabinet = isCabinetObject(obj);
  const vanity = String(obj.library_id || "").includes("vanity") || (obj.tags || []).includes("vanity");
  const island = String(obj.library_id || "").startsWith("island") || (obj.tags || []).includes("island");
  const sinky = isSinkObject(obj) || vanity || String(obj.library_id || "").includes("sink");
  const work = WORK_KINDS.find((w) => w.id === workOf(obj));
  const preview = { ...obj, id: obj.library_id || obj.id };
  const configOptions = cabinetConfigOptions(obj, level);
  const configValue = resolvedCabinetConfig(obj, level);
  const wallAllowsDrawer = wallCabinetAllowsDrawer(obj, level);

  const dim = (label, key) => (
    <div key={key}>
      <Label className="text-[10px]">{label}</Label>
      <Input
        className="h-9 text-xs"
        defaultValue={formatFtIn(obj[key])}
        key={`${obj.id}-${key}-${obj[key]}`}
        onBlur={(e) => {
          const next = parseFtIn(e.target.value);
          if (next < 1 && key !== "overhang") return;
          onPatch({ [key]: next });
        }}
      />
    </div>
  );

  return (
    <div className="space-y-2 text-sm" data-testid="object-customize">
      <div className="rounded-lg border border-slate-200 bg-white px-2 pt-2">
        <LibraryThumb item={preview} />
      </div>
      <div className="font-medium leading-tight">{obj.name}</div>
      <div className="text-xs text-[#4B6370]">{formatFtIn(obj.width)} × {formatFtIn(obj.depth)} × {formatFtIn(obj.height)}</div>
      <div className="flex gap-1">
        <button type="button" className="text-[11px] rounded px-2 py-1.5 text-white" style={{ background: work?.color }} onClick={() => {
          const order = ["existing", "demo", "new"];
          onPatch({ work: order[(order.indexOf(workOf(obj)) + 1) % order.length] });
        }}>
          {work?.name}
        </button>
        <button
          type="button"
          className={`text-[11px] rounded px-2 py-1.5 border ${obj.locked ? "bg-[#C9A227] text-[#061A23] border-[#C9A227]" : "border-slate-200 text-[#4B6370]"}`}
          onClick={() => onPatch({ locked: !obj.locked })}
        >
          {obj.locked ? "Locked" : "Lock"}
        </button>
      </div>

      <div className="grid grid-cols-3 gap-1">{[["W", "width"], ["D", "depth"], ["H", "height"]].map(([label, key]) => dim(label, key))}</div>
      {String(obj.library_id || "").startsWith("fridge") || (obj.tags || []).includes("appliance") ? (
        <div className="text-[10px] text-[#4B6370]">2D plan depth for appliances is 24&quot; — flush with the base cabinets.</div>
      ) : null}
      <Select
        value={obj.front || "south"}
        onChange={(front) => onPatch({ front })}
        options={[{ id: "south", name: "Front south" }, { id: "north", name: "Front north" }, { id: "east", name: "Front east" }, { id: "west", name: "Front west" }]}
      />

      {cabinet ? (
        <div className="space-y-1.5">
          <Select
            value={configValue}
            onChange={(config) => {
              const next = applyWallCabinetDrawerRule({ ...obj, config }, level);
              onPatch({ config: next.config, over_toilet: next.over_toilet });
            }}
            options={configOptions}
          />
          {isWallCabinetObject(obj) && !wallAllowsDrawer ? (
            <div className="text-[10px] text-[#4B6370]">Wall cabinets are doors only. A drawer is allowed over a toilet in a bath.</div>
          ) : null}
          <Select value={obj.door_style || "shaker"} onChange={(door_style) => onPatch({ door_style, glass: door_style.startsWith("glass") ? (obj.glass || (door_style.includes("frosted") ? "frosted" : "clear")) : obj.glass })} options={CABINET_DOOR_STYLES} />
          <Select value={obj.glass || ""} onChange={(glass) => onPatch({ glass, door_style: glass && !String(obj.door_style || "").startsWith("glass") ? "glass" : obj.door_style })} options={CABINET_GLASS} />
          <Select value={obj.species || "painted"} onChange={(species) => onPatch({ species, finish: species === "painted" ? (obj.finish || "white") : obj.finish })} options={WOOD_SPECIES} />
          <Select value={obj.finish || ""} onChange={(finish) => onPatch({ finish })} options={FINISH_VARIANTS} />
          {obj.finish === "custom" ? (
            <div className="flex items-center gap-2">
              <input type="color" className="h-9 w-12 rounded border border-slate-200" value={obj.color || "#C9A227"} onChange={(e) => onPatch({ color: e.target.value })} />
              <Input className="h-9 text-xs" value={obj.color || ""} onChange={(e) => onPatch({ color: e.target.value })} placeholder="#C9A227" />
            </div>
          ) : null}
          <Select value={obj.hardware_finish || "brass"} onChange={(hardware_finish) => onPatch({ hardware_finish })} options={HARDWARE_FINISHES} />
          <Select value={obj.hardware_style || "bar"} onChange={(hardware_style) => onPatch({ hardware_style })} options={HARDWARE_STYLES} />
          <Select value={obj.hardware_size || "5"} onChange={(hardware_size) => onPatch({ hardware_size })} options={HARDWARE_SIZES} />
          {isWallCabinetObject(obj) || String(obj.library_id || "").includes("tall") ? (
            <Select value={obj.crown || ""} onChange={(crown) => onPatch({ crown })} options={CABINET_CROWNS} />
          ) : null}
          {isBaseRunObject(obj) || island || vanity ? (
            <div className="space-y-1">
              <Select value={obj.counter_material || counterMaterial || "carrara"} onChange={(counter_material) => { onPatch({ counter_material }); onCounterMaterial?.(counter_material); }} options={COUNTER_MATERIALS} />
              <Select value={obj.edge_profile || "eased"} onChange={(edge_profile) => onPatch({ edge_profile })} options={EDGE_PROFILES} />
            </div>
          ) : null}
          {island ? (
            <div>
              <Label className="text-[10px]">Seating overhang</Label>
              <Input className="h-9 text-xs" defaultValue={formatFtIn(obj.overhang || 0)} key={`oh-${obj.id}-${obj.overhang || 0}`} onBlur={(e) => onPatch({ overhang: Math.max(0, parseFtIn(e.target.value)) })} />
            </div>
          ) : null}
          {vanity ? <Select value={obj.vanity_mount || "floor"} onChange={(vanity_mount) => onPatch({ vanity_mount, height: vanity_mount === "floating" ? 20 : 34 })} options={VANITY_MOUNTS} /> : null}
        </div>
      ) : isApplianceFinishObject(obj) ? (
        <div className="space-y-1.5">
          <Select value={obj.appliance_finish || "stainless"} onChange={(appliance_finish) => onPatch({ appliance_finish, finish: appliance_finish })} options={APPLIANCE_FINISHES} />
          {/range|cooktop/.test(String(obj.library_id || "")) ? (
            <Select value={obj.fuel || "electric"} onChange={(fuel) => onPatch({ fuel })} options={APPLIANCE_FUELS} />
          ) : null}
        </div>
      ) : isCountertopObject(obj) ? (
        <div className="space-y-1.5">
          <Select value={obj.counter_material || "quartz"} onChange={(counter_material) => onPatch({ counter_material, finish: counter_material })} options={COUNTER_MATERIALS} />
          <Select value={obj.edge_profile || "eased"} onChange={(edge_profile) => onPatch({ edge_profile })} options={EDGE_PROFILES} />
        </div>
      ) : isHoodObject(obj) ? (
        <div className="space-y-1.5">
          <Select value={obj.hood_type || "wall"} onChange={(hood_type) => onPatch({ hood_type })} options={HOOD_TYPES} />
          <Select value={obj.appliance_finish || obj.finish || "stainless"} onChange={(appliance_finish) => onPatch({ appliance_finish, finish: appliance_finish })} options={APPLIANCE_FINISHES} />
        </div>
      ) : isShowerObject(obj) ? (
        <div className="space-y-1.5">
          <Select value={obj.shower_type || "walk-in"} onChange={(shower_type) => onPatch({ shower_type })} options={SHOWER_TYPES} />
          <Select value={obj.shower_door || "frameless"} onChange={(shower_door) => onPatch({ shower_door })} options={SHOWER_DOORS} />
          <Select value={obj.shower_glass || "clear"} onChange={(shower_glass) => onPatch({ shower_glass })} options={SHOWER_GLASS} />
          <Select value={obj.hardware_finish || "nickel"} onChange={(hardware_finish) => onPatch({ hardware_finish })} options={HARDWARE_FINISHES} />
        </div>
      ) : isTubObject(obj) ? (
        <Select value={obj.tub_type || "alcove"} onChange={(tub_type) => onPatch({ tub_type })} options={TUB_TYPES} />
      ) : isMirrorObject(obj) ? (
        <div className="space-y-1.5">
          <Select value={obj.mirror_shape || "rect"} onChange={(mirror_shape) => onPatch({ mirror_shape })} options={MIRROR_SHAPES} />
          <Select
            value={obj.lighted ? "yes" : "no"}
            onChange={(lighted) => onPatch({ lighted: lighted === "yes" })}
            options={[{ id: "no", name: "No lighting" }, { id: "yes", name: "Integrated lighting" }]}
          />
        </div>
      ) : isToiletObject(obj) ? (
        <Select value={obj.toilet_type || "floor"} onChange={(toilet_type) => onPatch({ toilet_type })} options={TOILET_TYPES} />
      ) : isFaucetObject(obj) ? (
        <div className="space-y-1.5">
          <Select value={obj.faucet_style || "pulldown"} onChange={(faucet_style) => onPatch({ faucet_style })} options={FAUCET_STYLES} />
          <Select value={obj.faucet_finish || "nickel"} onChange={(faucet_finish) => onPatch({ faucet_finish })} options={FAUCET_FINISHES} />
        </div>
      ) : (
        <Select value={obj.finish || ""} onChange={(finish) => onPatch({ finish })} options={FINISH_VARIANTS} />
      )}

      {sinky ? (
        <div className="space-y-1.5">
          <Select value={obj.sink_type || "undermount-rect"} onChange={(sink_type) => onPatch({ sink_type })} options={SINK_TYPES} />
          <Select value={obj.faucet_finish || "nickel"} onChange={(faucet_finish) => onPatch({ faucet_finish })} options={FAUCET_FINISHES} />
          <Select value={obj.faucet_style || "pulldown"} onChange={(faucet_style) => onPatch({ faucet_style })} options={FAUCET_STYLES} />
        </div>
      ) : null}

      {isBaseRunObject(obj) ? (
        <Button type="button" size="sm" className="h-9 w-full text-xs bg-[#0A4D68] hover:bg-[#083D53]" onClick={onSnapCounters}>Snap countertops to bases</Button>
      ) : null}

      {cabinet || isApplianceFinishObject(obj) || sinky ? (
        <Button type="button" size="sm" variant="outline" className="h-9 w-full text-xs" onClick={() => onSaveStandard?.({
          door_style: obj.door_style,
          finish: obj.finish,
          species: obj.species,
          hardware_finish: obj.hardware_finish,
          hardware_style: obj.hardware_style,
          hardware_size: obj.hardware_size,
          counter_material: obj.counter_material,
          edge_profile: obj.edge_profile,
          faucet_finish: obj.faucet_finish,
          faucet_style: obj.faucet_style,
          appliance_finish: obj.appliance_finish,
        })}>Save as house standard</Button>
      ) : null}

      <div className="flex gap-1">
        <Input className="h-9 text-xs" placeholder="Client / field note" value={obj.note || ""} onChange={(e) => onPatch({ note: e.target.value })} />
        <Button type="button" size="sm" variant="outline" className="h-9 text-xs" onClick={onVoice}>Voice</Button>
      </div>
      <div className="flex gap-1">
        <Button type="button" size="sm" variant="outline" className="h-9" onClick={onRotate}>Rotate 90°</Button>
        <Button type="button" size="sm" variant="outline" className="h-9 text-red-600" onClick={onDelete}>Delete</Button>
      </div>
    </div>
  );
}
