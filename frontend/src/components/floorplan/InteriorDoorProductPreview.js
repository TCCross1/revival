import DoorProductPreview from "./DoorProductPreview";

/**
 * Realistic interior-door product preview.
 * Reuses the door slab renderer with interior finish mapping + casing cue.
 */
export default function InteriorDoorProductPreview({
  width = 30,
  height = 80,
  material = "painted-composite",
  style = "six-panel",
  construction = "hollow-core",
  boreCount = 1,
  hingeCount = 3,
  hingeType = "standard-butt",
  handing = "left",
  swingDirection = "inswing",
  operationType = "hinged",
  className = "",
}) {
  const previewMaterial = material === "wood" || material === "solid-wood"
    ? (material === "solid-wood" ? "solid-wood" : "wood")
    : material === "mdf"
      ? "mdf"
      : "painted-composite";

  return (
    <div className={`relative ${className}`}>
      <DoorProductPreview
        width={width}
        height={height}
        material={previewMaterial}
        style={style}
        boreCount={boreCount}
        hingeCount={hingeCount}
        hingeType={hingeType}
        handing={handing}
        swingDirection={swingDirection}
        className="aspect-[3/5] min-h-[320px] w-full"
      />
      <div className="pointer-events-none absolute bottom-2 left-2 right-2 flex flex-wrap gap-1.5">
        <span className="rounded bg-black/55 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white">
          {String(construction || "hollow-core").replace(/-/g, " ")}
        </span>
        <span className="rounded bg-[#0B3A8F]/85 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white">
          {String(operationType || "hinged")}
        </span>
      </div>
    </div>
  );
}
