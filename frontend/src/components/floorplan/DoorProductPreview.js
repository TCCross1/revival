/**
 * Realistic layered SVG door product preview.
 * Responds to width/height proportions, material, style, bores, hinges, handing.
 */
export default function DoorProductPreview({
  width = 32,
  height = 80,
  material = "fiberglass",
  style = "six-panel",
  boreCount = 2,
  hingeCount = 3,
  hingeType = "ball-bearing",
  handing = "left",
  swingDirection = "inswing",
  className = "",
}) {
  const w = Math.max(18, Number(width) || 32);
  const h = Math.max(48, Number(height) || 80);
  const aspect = w / h;
  const viewH = 420;
  const viewW = Math.round(viewH * aspect * 1.08);
  const slabX = 28;
  const slabY = 18;
  const slabW = viewW - 56;
  const slabH = viewH - 48;
  const leftHinge = handing !== "right";
  const mats = materialPalette(material);
  const panels = panelLayout(style, slabX, slabY, slabW, slabH);
  const hinges = hingePositions(hingeCount, slabY, slabH, leftHinge, slabX, slabW);
  const bores = borePositions(boreCount, slabX, slabY, slabW, slabH, leftHinge);

  const uid = `dp-${Math.round(w)}-${Math.round(h)}-${material}-${style}`;

  return (
    <div className={`relative overflow-hidden rounded-lg border border-slate-200 bg-gradient-to-b from-slate-100 to-slate-200 ${className}`}>
      <svg viewBox={`0 0 ${viewW} ${viewH}`} className="h-full w-full" role="img" aria-label={`${material} ${style} door preview`}>
        <defs>
          <linearGradient id={`${uid}-jamb`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#6b5a45" />
            <stop offset="40%" stopColor="#a89070" />
            <stop offset="100%" stopColor="#5a4a38" />
          </linearGradient>
          <linearGradient id={`${uid}-slab`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={mats.hi} />
            <stop offset="45%" stopColor={mats.mid} />
            <stop offset="100%" stopColor={mats.lo} />
          </linearGradient>
          <linearGradient id={`${uid}-bevel`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="rgba(255,255,255,0.35)" />
            <stop offset="50%" stopColor="rgba(255,255,255,0)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0.28)" />
          </linearGradient>
          <pattern id={`${uid}-grain`} width="8" height="24" patternUnits="userSpaceOnUse">
            <path d="M1 0 C2 8 0 16 2 24" fill="none" stroke={mats.grain} strokeWidth="0.6" opacity="0.35" />
            <path d="M5 0 C4 10 6 14 5 24" fill="none" stroke={mats.grain} strokeWidth="0.45" opacity="0.25" />
          </pattern>
          <filter id={`${uid}-soft`} x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="2" dy="4" stdDeviation="3.5" floodColor="#000" floodOpacity="0.28" />
          </filter>
          <radialGradient id={`${uid}-knob`} cx="35%" cy="30%" r="65%">
            <stop offset="0%" stopColor="#f5efdf" />
            <stop offset="55%" stopColor="#c9a227" />
            <stop offset="100%" stopColor="#7a5c12" />
          </radialGradient>
        </defs>

        {/* Room wall backdrop */}
        <rect x="0" y="0" width={viewW} height={viewH} fill="#e8e4dc" />
        <rect x="8" y="8" width={viewW - 16} height={viewH - 16} fill="#d9d3c8" stroke="#b7ae9f" strokeWidth="1" />

        {/* Jamb / casing */}
        <g filter={`url(#${uid}-soft)`}>
          <rect x={slabX - 10} y={slabY - 10} width={slabW + 20} height={slabH + 22} rx="2" fill={`url(#${uid}-jamb)`} />
          <rect x={slabX - 6} y={slabY - 6} width={slabW + 12} height={slabH + 14} fill="#2a241c" opacity="0.35" />
        </g>

        {/* Door slab */}
        <g filter={`url(#${uid}-soft)`}>
          <rect x={slabX} y={slabY} width={slabW} height={slabH} rx="1.5" fill={`url(#${uid}-slab)`} stroke={mats.edge} strokeWidth="1.2" />
          {(material === "wood" || material === "solid-core-wood" || material === "solid-wood" || material === "fiberglass") ? (
            <rect x={slabX} y={slabY} width={slabW} height={slabH} fill={`url(#${uid}-grain)`} opacity={material === "fiberglass" ? 0.22 : 0.55} />
          ) : null}
          <rect x={slabX} y={slabY} width={slabW} height={slabH} fill={`url(#${uid}-bevel)`} opacity="0.55" />
          {material === "solid-core-wood" ? (
            <rect x={slabX + 3} y={slabY + 3} width={slabW - 6} height={slabH - 6} fill="none" stroke="rgba(0,0,0,0.18)" strokeWidth="3" />
          ) : null}
        </g>

        {/* Panel / lite geometry */}
        {panels.map((p, i) => (
          <g key={`panel-${i}`}>
            {p.glass ? (
              <>
                <rect x={p.x} y={p.y} width={p.w} height={p.h} rx="1" fill="#9ec9e8" stroke={mats.edge} strokeWidth="1" opacity="0.92" />
                <rect x={p.x + 3} y={p.y + 3} width={p.w - 6} height={p.h - 6} fill="url(#glass-shine)" opacity="0.35" />
                {p.mullions?.map((m, mi) => (
                  <line key={`m-${mi}`} x1={m.x1} y1={m.y1} x2={m.x2} y2={m.y2} stroke={mats.edge} strokeWidth="1.4" />
                ))}
              </>
            ) : (
              <>
                <rect x={p.x} y={p.y} width={p.w} height={p.h} rx="1" fill={mats.panelInset} stroke={mats.edge} strokeWidth="0.9" />
                <rect x={p.x + 2.5} y={p.y + 2.5} width={p.w - 5} height={p.h - 5} rx="0.8" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="1.1" />
                <rect x={p.x + 4} y={p.y + 4} width={p.w - 8} height={p.h - 8} rx="0.6" fill={mats.panelFace} stroke={mats.edge} strokeWidth="0.6" opacity="0.95" />
                <rect x={p.x + 4} y={p.y + 4} width={p.w - 8} height={(p.h - 8) * 0.35} fill="rgba(255,255,255,0.12)" />
              </>
            )}
          </g>
        ))}

        {/* Hinges */}
        {hinges.map((hg, i) => (
          <g key={`hinge-${i}`} opacity={hingeType === "concealed" ? 0.25 : 1}>
            <rect
              x={hg.x}
              y={hg.y}
              width={hg.w}
              height={hg.h}
              rx="1"
              fill={hingeType.includes("ball") ? "#8a9098" : "#6d737b"}
              stroke="#3d434a"
              strokeWidth="0.6"
            />
            <circle cx={hg.x + (leftHinge ? hg.w - 2.2 : 2.2)} cy={hg.y + hg.h / 2} r="1.6" fill="#b8c0c8" stroke="#3d434a" strokeWidth="0.4" />
            {[0.28, 0.5, 0.72].map((t, si) => (
              <circle key={`screw-${i}-${si}`} cx={hg.x + hg.w * (leftHinge ? 0.35 : 0.65)} cy={hg.y + hg.h * t} r="0.7" fill="#2f343a" />
            ))}
          </g>
        ))}

        {/* Lock / deadbolt hardware */}
        {bores.map((b, i) => (
          <g key={`bore-${i}`}>
            <circle cx={b.x} cy={b.y} r="5.2" fill="#1f2430" opacity="0.18" />
            {b.type === "lockset" ? (
              <>
                <circle cx={b.x} cy={b.y} r="4.4" fill={`url(#${uid}-knob)`} stroke="#6b5210" strokeWidth="0.7" />
                <circle cx={b.x - 0.8} cy={b.y - 1} r="1.5" fill="rgba(255,255,255,0.35)" />
                <rect x={b.x - 11} y={b.y - 1.4} width="8" height="2.8" rx="1" fill="#c9a227" stroke="#6b5210" strokeWidth="0.4" />
              </>
            ) : (
              <>
                <circle cx={b.x} cy={b.y} r="3.2" fill="#d7dde5" stroke="#5a6270" strokeWidth="0.7" />
                <circle cx={b.x} cy={b.y} r="1.1" fill="#2a3038" />
              </>
            )}
          </g>
        ))}

        {/* Threshold for exterior feel */}
        <rect x={slabX - 8} y={slabY + slabH + 2} width={slabW + 16} height="8" rx="1" fill="#5c5348" />
        <rect x={slabX - 8} y={slabY + slabH + 2} width={slabW + 16} height="2.5" fill="rgba(255,255,255,0.12)" />

        {/* Swing badge */}
        <g transform={`translate(${viewW - 70}, 14)`}>
          <rect width="58" height="28" rx="4" fill="rgba(11,58,143,0.92)" />
          <text x="29" y="12" textAnchor="middle" fill="#fff" fontSize="7.5" fontFamily="system-ui,sans-serif">
            {leftHinge ? "LH" : "RH"}
          </text>
          <text x="29" y="22" textAnchor="middle" fill="#dce8ff" fontSize="7" fontFamily="system-ui,sans-serif">
            {swingDirection === "outswing" ? "Outswing" : "Inswing"}
          </text>
        </g>

        <defs>
          <linearGradient id="glass-shine" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}

function materialPalette(material) {
  if (material === "steel") {
    return {
      hi: "#d8dee6",
      mid: "#9aa3ae",
      lo: "#6b7380",
      edge: "#4a525c",
      panelInset: "#7b8490",
      panelFace: "#a7b0bb",
      grain: "#8a929c",
    };
  }
  if (material === "wood") {
    return {
      hi: "#c9a06e",
      mid: "#8b5a2b",
      lo: "#5c3a1a",
      edge: "#3d2612",
      panelInset: "#6e4520",
      panelFace: "#a06a38",
      grain: "#4a2f14",
    };
  }
  if (material === "solid-core-wood" || material === "solid-wood") {
    return {
      hi: "#b07a45",
      mid: "#7a4a24",
      lo: "#4a2c14",
      edge: "#2f1a0c",
      panelInset: "#5c3618",
      panelFace: "#8f5a30",
      grain: "#3a210f",
    };
  }
  if (material === "painted-composite" || material === "mdf") {
    return {
      hi: "#f4f6f8",
      mid: "#e4e8ec",
      lo: "#c5ccd4",
      edge: "#8a939e",
      panelInset: "#b8c0c9",
      panelFace: "#eceff2",
      grain: "#d0d5db",
    };
  }
  // fiberglass default
  return {
    hi: "#e7d3b4",
    mid: "#c4a07a",
    lo: "#8f6b48",
    edge: "#5c4632",
    panelInset: "#9b7650",
    panelFace: "#d2b08a",
    grain: "#7a5a3a",
  };
}

function panelLayout(style, x, y, w, h) {
  const inset = 14;
  const gap = 10;
  const innerX = x + inset;
  const innerY = y + inset;
  const innerW = w - inset * 2;
  const innerH = h - inset * 2;
  const s = String(style || "six-panel");

  if (s === "flush" || s === "modern") return [];

  if (s === "half-lite") {
    return [
      {
        glass: true,
        x: innerX,
        y: innerY,
        w: innerW,
        h: innerH * 0.42,
        mullions: [
          { x1: innerX + innerW / 2, y1: innerY + 4, x2: innerX + innerW / 2, y2: innerY + innerH * 0.42 - 4 },
          { x1: innerX + 4, y1: innerY + innerH * 0.21, x2: innerX + innerW - 4, y2: innerY + innerH * 0.21 },
        ],
      },
      { x: innerX, y: innerY + innerH * 0.48, w: innerW, h: innerH * 0.44 },
    ];
  }

  if (s === "full-lite" || s === "french") {
    const cols = s === "french" ? 2 : 1;
    const rows = s === "french" ? 2 : 1;
    const mullions = [];
    for (let c = 1; c < cols; c += 1) {
      const mx = innerX + (innerW * c) / cols;
      mullions.push({ x1: mx, y1: innerY + 4, x2: mx, y2: innerY + innerH - 4 });
    }
    for (let r = 1; r < Math.max(rows, 3); r += 1) {
      const my = innerY + (innerH * r) / Math.max(rows, 3);
      mullions.push({ x1: innerX + 4, y1: my, x2: innerX + innerW - 4, y2: my });
    }
    return [{ glass: true, x: innerX, y: innerY, w: innerW, h: innerH, mullions }];
  }

  if (s === "two-panel") {
    const ph = (innerH - gap) / 2;
    return [
      { x: innerX, y: innerY, w: innerW, h: ph },
      { x: innerX, y: innerY + ph + gap, w: innerW, h: ph },
    ];
  }

  if (s === "four-panel") {
    const pw = (innerW - gap) / 2;
    const ph = (innerH - gap) / 2;
    return [
      { x: innerX, y: innerY, w: pw, h: ph },
      { x: innerX + pw + gap, y: innerY, w: pw, h: ph },
      { x: innerX, y: innerY + ph + gap, w: pw, h: ph },
      { x: innerX + pw + gap, y: innerY + ph + gap, w: pw, h: ph },
    ];
  }

  if (s === "craftsman") {
    const topH = innerH * 0.28;
    const botH = innerH - topH - gap;
    const pw = (innerW - gap) / 2;
    return [
      { x: innerX, y: innerY, w: innerW, h: topH },
      { x: innerX, y: innerY + topH + gap, w: pw, h: botH },
      { x: innerX + pw + gap, y: innerY + topH + gap, w: pw, h: botH },
    ];
  }

  if (s === "shaker") {
    return [{ x: innerX, y: innerY, w: innerW, h: innerH }];
  }

  // six-panel default
  const pw = (innerW - gap) / 2;
  const ph = (innerH - gap * 2) / 3;
  const out = [];
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 2; c += 1) {
      out.push({
        x: innerX + c * (pw + gap),
        y: innerY + r * (ph + gap),
        w: pw,
        h: ph,
      });
    }
  }
  return out;
}

function hingePositions(count, slabY, slabH, leftHinge, slabX, slabW) {
  const n = Math.max(2, Math.min(5, Number(count) || 3));
  const h = 18;
  const w = 7;
  const top = slabY + 28;
  const bot = slabY + slabH - 28 - h;
  const xs = leftHinge ? slabX - 1 : slabX + slabW - w + 1;
  return Array.from({ length: n }).map((_, i) => {
    const t = n === 1 ? 0.5 : i / (n - 1);
    return { x: xs, y: top + (bot - top) * t, w, h };
  });
}

function borePositions(count, slabX, slabY, slabW, slabH, leftHinge) {
  const n = Math.max(0, Math.min(2, Number(count) || 0));
  if (n === 0) return [];
  const x = leftHinge ? slabX + slabW * 0.78 : slabX + slabW * 0.22;
  const lockY = slabY + slabH * 0.52;
  if (n === 1) return [{ type: "lockset", x, y: lockY }];
  return [
    { type: "lockset", x, y: lockY },
    { type: "deadbolt", x, y: lockY - 34 },
  ];
}
