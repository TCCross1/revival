/**
 * Realistic layered SVG window product preview.
 * Reflects type, material, glass package, grids, and operable sash cues.
 */
export default function WindowProductPreview({
  width = 36,
  height = 48,
  windowType = "double-hung",
  material = "vinyl",
  glass = {},
  gridPattern = "none",
  operation = {},
  className = "",
}) {
  const w = Math.max(18, Number(width) || 36);
  const h = Math.max(18, Number(height) || 48);
  const aspect = w / h;
  const viewH = 360;
  const viewW = Math.round(Math.max(220, Math.min(420, viewH * aspect * 1.15)));
  const frame = materialPalette(material);
  const paneCount = Number(glass.paneCount) || 2;
  const lowE = glass.lowE !== false;
  const obscured = Boolean(glass.obscured);
  const grid = gridPattern || glass.gridPattern || "none";
  const type = String(windowType || "double-hung");
  const uid = `wp-${Math.round(w)}-${Math.round(h)}-${material}-${type}-${grid}`;

  const fx = 28;
  const fy = 22;
  const fw = viewW - 56;
  const fh = viewH - 52;
  const sashGap = 3;
  const midY = fy + fh / 2;

  const glassFill = obscured
    ? `url(#${uid}-obscured)`
    : lowE
      ? `url(#${uid}-lowe)`
      : `url(#${uid}-glass)`;

  return (
    <div className={`relative overflow-hidden rounded-lg border border-slate-200 bg-gradient-to-b from-slate-100 to-slate-300 ${className}`}>
      <svg viewBox={`0 0 ${viewW} ${viewH}`} className="h-full w-full" role="img" aria-label={`${material} ${type} window preview`}>
        <defs>
          <linearGradient id={`${uid}-frame`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={frame.hi} />
            <stop offset="45%" stopColor={frame.mid} />
            <stop offset="100%" stopColor={frame.lo} />
          </linearGradient>
          <linearGradient id={`${uid}-glass`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#d7eefc" />
            <stop offset="40%" stopColor="#7eb6d9" />
            <stop offset="100%" stopColor="#3a6f96" />
          </linearGradient>
          <linearGradient id={`${uid}-lowe`} x1="0" y1="0" x2="0.8" y2="1">
            <stop offset="0%" stopColor="#e8f4ff" />
            <stop offset="35%" stopColor="#9ec9e8" />
            <stop offset="100%" stopColor="#4a7fa8" />
          </linearGradient>
          <pattern id={`${uid}-obscured`} width="6" height="6" patternUnits="userSpaceOnUse">
            <rect width="6" height="6" fill="#9eb4c4" />
            <path d="M0 6 L6 0" stroke="#c5d5e0" strokeWidth="0.8" />
          </pattern>
          <linearGradient id={`${uid}-shine`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <filter id={`${uid}-soft`} x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="2" dy="4" stdDeviation="3.5" floodColor="#000" floodOpacity="0.28" />
          </filter>
        </defs>

        <rect x="0" y="0" width={viewW} height={viewH} fill="#e6e2da" />
        <rect x="10" y="10" width={viewW - 20} height={viewH - 20} fill="#d4cfc4" stroke="#b8b0a2" strokeWidth="1" />

        <g filter={`url(#${uid}-soft)`}>
          <rect x={fx - 12} y={fy - 12} width={fw + 24} height={fh + 28} rx="2" fill={`url(#${uid}-frame)`} />
          <rect x={fx - 7} y={fy - 7} width={fw + 14} height={fh + 18} fill="#1c1a16" opacity="0.28" />
        </g>

        <rect x={fx} y={fy} width={fw} height={fh} fill={`url(#${uid}-frame)`} stroke={frame.edge} strokeWidth="1.2" />
        <rect x={fx + 8} y={fy + 8} width={fw - 16} height={fh - 16} fill="#2a3036" opacity="0.35" />

        {type === "double-hung" || type === "single-hung" ? (
          <>
            <Sash x={fx + 10} y={fy + 10} w={fw - 20} h={fh / 2 - 8} glassFill={glassFill} shine={`url(#${uid}-shine)`} grid={grid} frame={frame} operable={type === "double-hung"} />
            <Sash x={fx + 10} y={midY - 2} w={fw - 20} h={fh / 2 - 6} glassFill={glassFill} shine={`url(#${uid}-shine)`} grid={grid} frame={frame} operable meetingRail />
          </>
        ) : type === "slider" ? (
          <>
            <Sash x={fx + 10} y={fy + 10} w={(fw - 20 - sashGap) / 2} h={fh - 20} glassFill={glassFill} shine={`url(#${uid}-shine)`} grid={grid} frame={frame} operable={String(operation.configuration || "XO").startsWith("X")} />
            <Sash x={fx + 10 + (fw - 20 - sashGap) / 2 + sashGap} y={fy + 10} w={(fw - 20 - sashGap) / 2} h={fh - 20} glassFill={glassFill} shine={`url(#${uid}-shine)`} grid={grid} frame={frame} operable={String(operation.configuration || "XO").endsWith("X")} />
          </>
        ) : type === "casement" || type === "awning" || type === "hopper" ? (
          <Sash
            x={fx + 10}
            y={fy + 10}
            w={fw - 20}
            h={fh - 20}
            glassFill={glassFill}
            shine={`url(#${uid}-shine)`}
            grid={grid}
            frame={frame}
            operable
            hingeSide={type === "casement" ? (operation.hinge || "left") : type === "awning" ? "bottom" : "top"}
          />
        ) : (
          <Sash x={fx + 10} y={fy + 10} w={fw - 20} h={fh - 20} glassFill={glassFill} shine={`url(#${uid}-shine)`} grid={grid} frame={frame} />
        )}

        <rect x={fx - 14} y={fy + fh + 2} width={fw + 28} height={10} rx="1.5" fill={`url(#${uid}-frame)`} stroke={frame.edge} strokeWidth="0.8" />
        <rect x={fx - 10} y={fy + fh + 4} width={fw + 20} height={3} fill="#000" opacity="0.18" />

        <g>
          <rect x="12" y={viewH - 28} width="118" height="18" rx="3" fill="#0B3A8F" opacity="0.9" />
          <text x="71" y={viewH - 15} textAnchor="middle" fill="#fff" fontSize="8" fontFamily="system-ui,sans-serif">
            {paneCount}-pane{lowE ? " Low-E" : ""}{obscured ? " privacy" : ""}
          </text>
        </g>
      </svg>
    </div>
  );
}

function Sash({ x, y, w, h, glassFill, shine, grid, frame, operable = false, meetingRail = false, hingeSide }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill={frame.mid} stroke={frame.edge} strokeWidth="1" />
      <rect x={x + 5} y={y + 5} width={w - 10} height={h - 10} fill={glassFill} stroke="#4a6275" strokeWidth="0.6" />
      <rect x={x + 5} y={y + 5} width={(w - 10) * 0.38} height={h - 10} fill={shine} opacity="0.4" />
      {gridLines(grid, x + 5, y + 5, w - 10, h - 10)}
      {meetingRail ? (
        <rect x={x + 4} y={y - 3} width={w - 8} height={6} rx="1" fill={frame.hi} stroke={frame.edge} strokeWidth="0.7" />
      ) : null}
      {operable && hingeSide === "left" ? (
        <circle cx={x + 3} cy={y + h / 2} r="2.2" fill="#c9a227" stroke="#7a5c12" strokeWidth="0.5" />
      ) : null}
      {operable && hingeSide === "right" ? (
        <circle cx={x + w - 3} cy={y + h / 2} r="2.2" fill="#c9a227" stroke="#7a5c12" strokeWidth="0.5" />
      ) : null}
      {operable && (hingeSide === "bottom" || hingeSide === "top") ? (
        <rect x={x + w / 2 - 8} y={hingeSide === "bottom" ? y + h - 7 : y + 2} width="16" height="4" rx="1" fill="#c9a227" />
      ) : null}
      {operable && !hingeSide ? (
        <rect x={x + w / 2 - 10} y={y + h - 12} width="20" height="5" rx="1.5" fill={frame.lo} stroke={frame.edge} strokeWidth="0.5" />
      ) : null}
    </g>
  );
}

function gridLines(pattern, x, y, w, h) {
  const p = String(pattern || "none");
  if (p === "none") return null;
  const stroke = "#e8eef4";
  const sw = 1.4;
  const lines = [];
  if (p === "colonial" || p === "custom") {
    for (let c = 1; c < 2; c += 1) {
      const gx = x + (w * c) / 2;
      lines.push(<line key={`vc-${c}`} x1={gx} y1={y} x2={gx} y2={y + h} stroke={stroke} strokeWidth={sw} />);
    }
    for (let r = 1; r < 2; r += 1) {
      const gy = y + (h * r) / 2;
      lines.push(<line key={`hr-${r}`} x1={x} y1={gy} x2={x + w} y2={gy} stroke={stroke} strokeWidth={sw} />);
    }
  } else if (p === "prairie") {
    const m = Math.min(w, h) * 0.22;
    lines.push(
      <rect key="pr" x={x + m} y={y + m} width={w - m * 2} height={h - m * 2} fill="none" stroke={stroke} strokeWidth={sw} />,
      <line key="pv" x1={x + w / 2} y1={y} x2={x + w / 2} y2={y + h} stroke={stroke} strokeWidth={sw} />,
      <line key="ph" x1={x} y1={y + h / 2} x2={x + w} y2={y + h / 2} stroke={stroke} strokeWidth={sw} />,
    );
  } else if (p === "craftsman") {
    const top = y + h * 0.28;
    lines.push(
      <line key="ct" x1={x} y1={top} x2={x + w} y2={top} stroke={stroke} strokeWidth={sw} />,
      <line key="cv1" x1={x + w / 3} y1={y} x2={x + w / 3} y2={top} stroke={stroke} strokeWidth={sw} />,
      <line key="cv2" x1={x + (2 * w) / 3} y1={y} x2={x + (2 * w) / 3} y2={top} stroke={stroke} strokeWidth={sw} />,
    );
  }
  return <g>{lines}</g>;
}

function materialPalette(material) {
  if (material === "wood" || material === "wood-clad") {
    return { hi: "#d2a46c", mid: "#9a6840", lo: "#6a4224", edge: "#3d2612" };
  }
  if (material === "aluminum") {
    return { hi: "#e8ecef", mid: "#b0b7bf", lo: "#7a828c", edge: "#555c66" };
  }
  if (material === "fiberglass") {
    return { hi: "#f0ebe3", mid: "#cfc4b4", lo: "#9a8c78", edge: "#6a5e4e" };
  }
  if (material === "composite") {
    return { hi: "#f5f2ec", mid: "#d8d2c6", lo: "#a89f90", edge: "#6f675c" };
  }
  return { hi: "#ffffff", mid: "#e8ecf0", lo: "#c5ccd4", edge: "#8a939e" };
}
