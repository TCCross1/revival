import { useEffect, useRef, useState } from "react";
import { segmentedLabels } from "@/lib/floorPlan/segmentedRoomDimension";
import { DIM_GROUP, LABEL_BAND_PX, labelSideForGroup } from "@/lib/floorPlan/dimensionLanes";
import { formatFtInTight, parseFtIn } from "@/lib/floorPlan/units";

/**
 * Room dimension group(s):
 * - "full": combined overall + wall|clear|wall (no opening lane)
 * - "segments": room-assembly only (wall | clear | wall) — entire group in one lane
 * - "overall": outside-to-outside only — entire group in one lane
 *
 * Line, ticks, and labels always share the same lane offset (move as one unit).
 * Overall and interior-clear labels are tap-to-edit when onEditSpan is provided.
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
  roomId = "",
  axis = "horizontal",
  onEditSpan = null,
}) {
  const [editing, setEditing] = useState(null); // { kind: "overall"|"interior", text }
  const inputRef = useRef(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  if (!dim) return null;
  const labels = segmentedLabels(dim);
  const horizontal = dim.orientation !== "vertical";
  const marks = [dim.outsideStart, dim.insideStart, dim.insideEnd, dim.outsideEnd];
  const ink = "#222222";
  const tick = 3.2;
  const showSegments = variant === "full" || variant === "segments";
  const showOverall = variant === "full" || variant === "overall";
  const overallLane = overallOffsetPx != null ? overallOffsetPx : offsetPx;
  const editable = typeof onEditSpan === "function" && roomId;

  const groupType = variant === "overall"
    ? DIM_GROUP.OVERALL
    : DIM_GROUP.ROOM_ASSEMBLY;

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
      kind: "startWall",
    },
    {
      along: (dim.insideStart + dim.insideEnd) / 2,
      label: labels.interior,
      worldLen: dim.interiorClearLength,
      wallish: false,
      kind: "interior",
    },
    {
      along: (dim.insideEnd + dim.outsideEnd) / 2,
      label: labels.endWall,
      worldLen: dim.endWallThickness,
      wallish: true,
      kind: "endWall",
    },
  ];

  const minLabelPx = 20;
  const screenSegPx = (worldIn) => Math.abs(worldIn) * scalePx * Math.max(viewScale, 0.35);

  const commitEdit = () => {
    if (!editing) return;
    try {
      const next = parseFtIn(editing.text);
      if (!(next >= 24)) {
        setEditing(null);
        return;
      }
      onEditSpan?.({
        roomId,
        axis: axis === "vertical" || axis === "depth" ? "depth" : "width",
        measure: editing.kind === "interior" ? "inside" : "outside",
        length: next,
      });
    } catch (err) {
      console.error("[RoomDim] could not parse length", err);
    }
    setEditing(null);
  };

  const editField = (kind, text, placed) => (
    <foreignObject key={`edit-${kind}`} x={placed.x - 36} y={placed.y - 12} width={72} height={24}>
      <input
        ref={inputRef}
        data-testid={`room-dim-edit-${kind}`}
        value={editing?.text || ""}
        onChange={(e) => setEditing({ ...editing, text: e.target.value })}
        onBlur={commitEdit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitEdit();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            setEditing(null);
          }
        }}
        style={{
          width: "68px",
          height: "20px",
          fontFamily: "Times, serif",
          fontSize: "11px",
          textAlign: "center",
          border: "1px solid #1e3a5f",
          borderRadius: "2px",
          padding: "0 2px",
          background: "#fff",
        }}
      />
    </foreignObject>
  );

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
            if (editing?.kind === seg.kind) {
              return editField(seg.kind, seg.label, placed);
            }
            const canEdit = editable && seg.kind === "interior" && (variant === "full" || variant === "segments");
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
                  style={{ cursor: canEdit ? "text" : "default" }}
                  onClick={(e) => {
                    if (!canEdit) return;
                    e.stopPropagation();
                    setEditing({ kind: "interior", text: formatFtInTight(seg.worldLen) });
                  }}
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
        editing?.kind === "overall" ? editField("overall", labels.overall, overallLabel) : (
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
            style={{ cursor: editable ? "text" : "default" }}
            onClick={(e) => {
              if (!editable) return;
              e.stopPropagation();
              setEditing({ kind: "overall", text: formatFtInTight(dim.overallLength) });
            }}
          >
            {labels.overall}
          </text>
        )
      ) : null}
    </g>
  );
}
