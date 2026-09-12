import { segmentedLabels } from "@/lib/floorPlan/segmentedRoomDimension";
import { DIM_GROUP, LABEL_BAND_PX, labelSideForGroup } from "@/lib/floorPlan/dimensionLanes";

/**
 * Room dimension group(s):
 * - "full": combined overall + wall|clear|wall (no opening lane)
 * - "segments": room-assembly only (wall | clear | wall) — entire group in one lane
 * - "overall": outside-to-outside only — entire group in one lane
 *
 * Line, ticks, and labels always share the same lane offset (move as one unit).
 */
export default function SegmentedRoomDimension({
  dim,
  faceWorld,
  offsetPx = 54,
  overallOffsetPx = null,
  variant = "full",
  exteriorToward = -1,
  scalePx = 1.7,
  viewScale = 1,
  testid = "segmented-room-dim",
}) {
  if (!dim) return null;
  const labels = segmentedLabels(dim);
  const horizontal = dim.orientation !== "vertical";
  const marks = [dim.outsideStart, dim.insideStart, dim.insideEnd, dim.outsideEnd];
  const ink = "#222222";
  const tick = 3.2;
  const showSegments = variant === "full" || variant === "segments";
  const showOverall = variant === "full" || variant === "overall";
  const overallLane = overallOffsetPx != null ? overallOffsetPx : offsetPx;

  const groupType = variant === "overall"
    ? DIM_GROUP.OVERALL
    : DIM_GROUP.ROOM_ASSEMBLY;

  // Stacked segments: keep labels in this group's band (toward wall / opening).
  // Combined full mode: overall exterior, segments room-facing (classic string).
  const segmentLabelToward = variant === "segments"
    ? labelSideForGroup(DIM_GROUP.ROOM_ASSEMBLY, exteriorToward)
    : -exteriorToward;
  const overallLabelToward = labelSideForGroup(DIM_GROUP.OVERALL, exteriorToward);
  const labelOff = Math.min(LABEL_BAND_PX, 11);

  const alongToScreen = (along, lanePx) => {
    if (horizontal) {
      return {
        x: along * scalePx,
        y: faceWorld * scalePx + exteriorToward * lanePx,
      };
    }
    return {
      x: faceWorld * scalePx + exteriorToward * lanePx,
      y: along * scalePx,
    };
  };

  const placeLabel = (pt, toward) => {
    if (horizontal) {
      return {
        x: pt.x,
        y: pt.y + toward * labelOff,
        baseline: toward < 0 ? "auto" : "hanging",
        rotate: null,
      };
    }
    const lx = pt.x + toward * labelOff;
    const ly = pt.y;
    return {
      x: lx,
      y: ly,
      baseline: "middle",
      rotate: `rotate(-90 ${lx} ${ly})`,
    };
  };

  const a = alongToScreen(dim.outsideStart, offsetPx);
  const b = alongToScreen(dim.outsideEnd, offsetPx);
  const midAlong = (dim.outsideStart + dim.outsideEnd) / 2;
  const midOverall = alongToScreen(midAlong, overallLane);
  const oa = alongToScreen(dim.outsideStart, overallLane);
  const ob = alongToScreen(dim.outsideEnd, overallLane);

  const overallLabel = placeLabel(
    midOverall,
    variant === "overall" ? overallLabelToward : exteriorToward,
  );

  const segments = [
    {
      along: (dim.outsideStart + dim.insideStart) / 2,
      label: labels.startWall,
      worldLen: dim.startWallThickness,
      wallish: true,
    },
    {
      along: (dim.insideStart + dim.insideEnd) / 2,
      label: labels.interior,
      worldLen: dim.interiorClearLength,
      wallish: false,
    },
    {
      along: (dim.insideEnd + dim.outsideEnd) / 2,
      label: labels.endWall,
      worldLen: dim.endWallThickness,
      wallish: true,
    },
  ];

  const minLabelPx = 20;
  const screenSegPx = (worldIn) => Math.abs(worldIn) * scalePx * Math.max(viewScale, 0.35);

  return (
    <g
      data-testid={testid}
      data-dim-group={groupType}
      data-dim-variant={variant}
      fill="none"
      stroke={ink}
      strokeWidth="0.5"
    >
      {showSegments ? (
        <g data-dim-part="assembly-geometry">
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
          {marks.map((along, idx) => {
            const pt = alongToScreen(along, offsetPx);
            const dx = horizontal ? 0 : tick;
            const dy = horizontal ? tick : 0;
            return (
              <line
                key={`tick-${idx}`}
                x1={pt.x - dx}
                y1={pt.y - dy}
                x2={pt.x + dx}
                y2={pt.y + dy}
                strokeWidth={idx === 0 || idx === 3 ? 0.55 : 0.45}
              />
            );
          })}
          {segments.map((seg, idx) => {
            const pt = alongToScreen(seg.along, offsetPx);
            // Cramped wall-thickness text stays in this group's label band —
            // nudge further along the group's label side, never into another lane.
            const cramped = seg.wallish && screenSegPx(seg.worldLen) < minLabelPx;
            const toward = segmentLabelToward;
            const extra = cramped ? 4 : 0;
            const placed = placeLabel(
              {
                x: pt.x,
                y: horizontal ? pt.y + toward * extra : pt.y,
              },
              toward,
            );
            if (!horizontal && cramped) {
              placed.x = pt.x + toward * (labelOff + extra);
              placed.rotate = `rotate(-90 ${placed.x} ${placed.y})`;
            }
            return (
              <g key={`seg-${idx}`} data-dim-part="assembly-label">
                {cramped ? (
                  <line
                    x1={pt.x}
                    y1={pt.y}
                    x2={placed.x}
                    y2={placed.y}
                    stroke={ink}
                    strokeWidth="0.35"
                    strokeDasharray="1.5 1.5"
                    opacity="0.55"
                  />
                ) : null}
                <text
                  x={placed.x}
                  y={placed.y}
                  textAnchor="middle"
                  dominantBaseline={placed.baseline}
                  fill={ink}
                  stroke="none"
                  fontFamily="Times, serif"
                  fontSize={seg.wallish ? "7.5" : "8.5"}
                  transform={placed.rotate || undefined}
                >
                  {seg.label}
                </text>
              </g>
            );
          })}
        </g>
      ) : null}

      {showOverall && variant === "overall" ? (
        <g data-dim-part="overall-geometry">
          <line x1={oa.x} y1={oa.y} x2={ob.x} y2={ob.y} />
          {[dim.outsideStart, dim.outsideEnd].map((along, idx) => {
            const pt = alongToScreen(along, overallLane);
            const dx = horizontal ? 0 : tick;
            const dy = horizontal ? tick : 0;
            return (
              <line
                key={`otick-${idx}`}
                x1={pt.x - dx}
                y1={pt.y - dy}
                x2={pt.x + dx}
                y2={pt.y + dy}
              />
            );
          })}
        </g>
      ) : null}

      {showOverall ? (
        <text
          data-dim-part="overall-label"
          x={overallLabel.x}
          y={overallLabel.y}
          textAnchor="middle"
          dominantBaseline={overallLabel.baseline}
          fill={ink}
          stroke="none"
          fontFamily="Times, serif"
          fontSize="9"
          fontWeight="600"
          transform={overallLabel.rotate || undefined}
        >
          {labels.overall}
        </text>
      ) : null}
    </g>
  );
}
