import { useEffect, useRef, useState } from "react";
import { formatFtInTight } from "@/lib/floorPlan/units";
import { buildOpeningDimensionChain, pointAlongWall, wallExteriorFace } from "@/lib/floorPlan/wallOpenings";
import { DIM_GROUP, LABEL_BAND_PX, labelSideForGroup } from "@/lib/floorPlan/dimensionLanes";

/**
 * Opening-position dimension group (lane 0).
 * Spans ONLY the interior clear: inside-left → openings → inside-right.
 * Does not include wall-thickness segments (those belong to room-assembly).
 */
export default function OpeningDimensionChain({
  level,
  wall,
  offsetPx = 34,
  scalePx = 1.7,
  editable = true,
  onEditSpan,
  testid,
}) {
  const chain = buildOpeningDimensionChain(level, wall);
  const face = wallExteriorFace(level, wall);
  const [editing, setEditing] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  if (!chain.segments.length || !face) return null;

  const ink = "#222222";
  const tick = 3.0;
  const horizontal = face.orientation !== "vertical";
  const labelToward = labelSideForGroup(DIM_GROUP.OPENING_CHAIN, face.exteriorToward);
  const labelOff = Math.min(LABEL_BAND_PX, 11);

  const toScreen = (alongParam) => {
    const pt = pointAlongWall(wall, alongParam);
    if (horizontal) {
      return {
        x: pt.x * scalePx,
        y: face.faceWorld * scalePx + face.exteriorToward * offsetPx,
      };
    }
    return {
      x: face.faceWorld * scalePx + face.exteriorToward * offsetPx,
      y: pt.y * scalePx,
    };
  };

  const marks = [];
  chain.segments.forEach((seg, idx) => {
    if (idx === 0) marks.push(seg.start);
    marks.push(seg.end);
  });

  const a = toScreen(marks[0]);
  const b = toScreen(marks[marks.length - 1]);

  const commitEdit = () => {
    if (!editing) return;
    const seg = chain.segments[editing.segIndex];
    if (!seg || !onEditSpan) {
      setEditing(null);
      return;
    }
    onEditSpan({
      wallId: wall.id,
      segment: seg,
      text: editing.text,
    });
    setEditing(null);
  };

  const placeLabel = (pt) => {
    if (horizontal) {
      return {
        x: pt.x,
        y: pt.y + labelToward * labelOff,
        baseline: labelToward < 0 ? "auto" : "hanging",
        rotate: null,
      };
    }
    const lx = pt.x + labelToward * labelOff;
    const ly = pt.y;
    return {
      x: lx,
      y: ly,
      baseline: "middle",
      rotate: `rotate(-90 ${lx} ${ly})`,
    };
  };

  return (
    <g
      data-testid={testid || `opening-dim-chain-${wall.id}`}
      data-dim-group={DIM_GROUP.OPENING_CHAIN}
      fill="none"
      stroke={ink}
      strokeWidth="0.5"
    >
      <g data-dim-part="opening-geometry">
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
        {marks.map((along, idx) => {
          const pt = toScreen(along);
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

      {chain.segments.map((seg, idx) => {
        const mid = toScreen((seg.start + seg.end) / 2);
        const label = formatFtInTight(seg.length);
        // One representation for opening width — avoid DR + bare width collision.
        const full = seg.kind === "opening" ? label : label;
        const placed = placeLabel(mid);

        const canEdit = editable && seg.kind === "span" && seg.openingId && (seg.role === "start" || seg.role === "end");
        const isEditing = editing?.segIndex === idx;

        if (isEditing) {
          const fox = horizontal ? placed.x - 36 : placed.x - 40;
          const foy = horizontal ? placed.y - 12 : placed.y - 12;
          return (
            <foreignObject key={`edit-${idx}`} x={fox} y={foy} width={72} height={24}>
              <input
                ref={inputRef}
                data-testid={`opening-dim-edit-${seg.role}`}
                value={editing.text}
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
        }

        return (
          <text
            key={`olab-${idx}`}
            data-dim-part={seg.kind === "opening" ? "opening-width-label" : "opening-span-label"}
            x={placed.x}
            y={placed.y}
            textAnchor="middle"
            dominantBaseline={placed.baseline}
            fill={ink}
            stroke="none"
            fontFamily="Times, serif"
            fontSize={seg.kind === "opening" ? "8" : "8.5"}
            fontWeight={seg.kind === "opening" ? 600 : 400}
            transform={placed.rotate || undefined}
            style={{ cursor: canEdit ? "text" : "default" }}
            onClick={(e) => {
              if (!canEdit) return;
              e.stopPropagation();
              setEditing({ segIndex: idx, text: label });
            }}
          >
            {full}
          </text>
        );
      })}
    </g>
  );
}
