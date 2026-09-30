import InteriorDoorProductPreview from "./InteriorDoorProductPreview";
import DoorProductPreview from "./DoorProductPreview";
import WindowProductPreview from "./WindowProductPreview";
import { OPENING_CATEGORY, classifyOpening } from "@/lib/floorPlan/openingSpec";

/**
 * Routes to the specialized realistic product preview for a wall opening.
 */
export default function OpeningProductPreview({ opening, hostWall, className = "" }) {
  const category = classifyOpening(opening, hostWall);
  if (category === OPENING_CATEGORY.WINDOW) {
    return (
      <WindowProductPreview
        width={opening.width}
        height={opening.height}
        windowType={opening.window_type || opening.style}
        material={opening.material}
        glass={opening.glass}
        gridPattern={opening.grid_pattern}
        operation={opening.operation}
        className={className}
      />
    );
  }
  if (category === OPENING_CATEGORY.INTERIOR_DOOR) {
    return (
      <InteriorDoorProductPreview
        width={opening.width}
        height={opening.height}
        material={opening.material}
        style={opening.style}
        construction={opening.construction}
        operationType={opening.operation_type}
        boreCount={opening.bore_count}
        hingeCount={opening.hinges?.count}
        hingeType={opening.hinges?.type}
        handing={opening.handing || opening.swing}
        swingDirection={opening.swingDirection || (opening.direction === "out" ? "outswing" : "inswing")}
        className={className}
      />
    );
  }
  return (
    <DoorProductPreview
      width={opening.width}
      height={opening.height}
      material={opening.material}
      style={opening.style}
      boreCount={opening.bore_count}
      hingeCount={opening.hinges?.count}
      hingeType={opening.hinges?.type}
      handing={opening.handing || opening.swing}
      swingDirection={opening.swingDirection || (opening.direction === "out" ? "outswing" : "inswing")}
      className={className}
    />
  );
}
