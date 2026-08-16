/** 20/20-style 2D kitchen CAD — black ink on paper, plan view. */

import { isWallCabinetObject, professionalDoorCount, resolvedCabinetConfig } from "@/lib/floorPlan/library";

const INK = "#111111";
const PAPER = "#FFFFFF";
const WASH = "#F4F4F4";
/** Floor grain only — pale enough that cabinet/dimension ink stays the working line. */
const FLOOR_JOINT = "#E4E0D8";
const FLOOR_GRAIN = "#EDE9E2";
const FLOOR_DOT = "#E8E4DC";

function facingOf(item) {
  if (item?.front === "east" || item?.front === "west" || item?.front === "north" || item?.front === "south") {
    return item.front;
  }
  return "south";
}

function OrientedSymbol({ w, d, front, render }) {
  const angle = front === "east" ? -90 : front === "west" ? 90 : front === "north" ? 180 : 0;
  const iw = angle % 180 === 0 ? w : d;
  const ih = angle % 180 === 0 ? d : w;
  if (angle === 0) return render(iw, ih);
  return (
    <g transform={`translate(${w / 2} ${d / 2}) rotate(${angle}) translate(${-iw / 2} ${-ih / 2})`}>
      {render(iw, ih)}
    </g>
  );
}

function libId(item) {
  return String(item?.library_id || item?.id || "");
}

function configOf(item) {
  return resolvedCabinetConfig(item);
}

function doorCount(item, w, config) {
  if (config === "single" && w > 24) return professionalDoorCount(w, "doors");
  return professionalDoorCount(w, config);
}

function idIncludes(item, part) {
  return libId(item).includes(part);
}

function hatchId(item, kind) {
  const raw = `${item?.instance_id || libId(item)}-${kind}-${item?.counter_material || item?.flooring || ""}`;
  return `h-${String(raw).replace(/[^a-z0-9-]/gi, "")}`;
}

export function FloorHatchDefs() {
  return (
    <>
      <pattern id="fp-floor-lvp" width="10" height="42" patternUnits="userSpaceOnUse">
        <rect width="10" height="42" fill={PAPER} />
        <rect x="0" y="0" width="10" height="42" fill="none" stroke={FLOOR_JOINT} strokeWidth="0.16" />
        <path d="M 2 3 C 3 12, 1.5 22, 2.5 32 C 3 36, 2 39, 2.2 41" fill="none" stroke={FLOOR_GRAIN} strokeWidth="0.08" />
        <path d="M 6.5 2 C 7.2 14, 5.8 24, 6.8 40" fill="none" stroke={FLOOR_GRAIN} strokeWidth="0.07" />
      </pattern>
      <pattern id="fp-floor-oak" width="12" height="48" patternUnits="userSpaceOnUse">
        <rect width="12" height="48" fill={PAPER} />
        <rect width="12" height="48" fill="none" stroke={FLOOR_JOINT} strokeWidth="0.18" />
        <path d="M 2.2 2 C 3.4 16, 1.6 28, 3 46" fill="none" stroke={FLOOR_GRAIN} strokeWidth="0.09" />
        <path d="M 7.8 1 C 8.4 18, 6.6 30, 8.2 47" fill="none" stroke={FLOOR_GRAIN} strokeWidth="0.08" />
        <line x1="0" y1="24" x2="12" y2="24" stroke={FLOOR_JOINT} strokeWidth="0.14" />
      </pattern>
      <pattern id="fp-floor-hardwood" width="14" height="56" patternUnits="userSpaceOnUse">
        <rect width="14" height="56" fill={PAPER} />
        <rect width="14" height="56" fill="none" stroke={FLOOR_JOINT} strokeWidth="0.18" />
        <path d="M 3 2 C 4.5 20, 2 36, 4 54" fill="none" stroke={FLOOR_GRAIN} strokeWidth="0.09" />
        <path d="M 9 3 C 10 22, 8 40, 10 54" fill="none" stroke={FLOOR_GRAIN} strokeWidth="0.08" />
        <ellipse cx="6" cy="18" rx="1.1" ry="0.45" fill="none" stroke={FLOOR_GRAIN} strokeWidth="0.07" />
        <line x1="0" y1="28" x2="14" y2="28" stroke={FLOOR_JOINT} strokeWidth="0.14" />
      </pattern>
      <pattern id="fp-floor-tile" width="24" height="24" patternUnits="userSpaceOnUse">
        <rect width="24" height="24" fill={PAPER} />
        <rect x="0.6" y="0.6" width="22.8" height="22.8" fill="none" stroke={FLOOR_JOINT} strokeWidth="0.2" />
        <path d="M 4 6 C 10 8, 14 12, 20 9" fill="none" stroke={FLOOR_GRAIN} strokeWidth="0.07" />
        <path d="M 5 16 C 11 14, 16 18, 19 17" fill="none" stroke={FLOOR_GRAIN} strokeWidth="0.06" />
      </pattern>
      <pattern id="fp-floor-carpet" width="8" height="8" patternUnits="userSpaceOnUse">
        <rect width="8" height="8" fill={PAPER} />
        <circle cx="2" cy="2" r="0.28" fill={FLOOR_DOT} />
        <circle cx="6" cy="3.2" r="0.22" fill={FLOOR_DOT} />
        <circle cx="4" cy="6" r="0.26" fill={FLOOR_DOT} />
        <circle cx="7.2" cy="6.8" r="0.18" fill={FLOOR_DOT} />
      </pattern>
    </>
  );
}

export function flooringFill(id) {
  if (id === "tile") return "url(#fp-floor-tile)";
  if (id === "carpet") return "url(#fp-floor-carpet)";
  if (id === "solid_hardwood") return "url(#fp-floor-hardwood)";
  if (id === "lvp") return "url(#fp-floor-lvp)";
  return "url(#fp-floor-oak)";
}

function CounterDefs({ uid, material }) {
  const mat = String(material || "quartz");
  if (mat === "butcher") {
    return (
      <pattern id={uid} width="3.2" height="3.2" patternUnits="userSpaceOnUse">
        <rect width="3.2" height="3.2" fill={PAPER} />
        <rect width="3.2" height="3.2" fill="none" stroke={INK} strokeWidth="0.28" />
        <line x1="0" y1="1.6" x2="3.2" y2="1.6" stroke={INK} strokeWidth="0.12" opacity="0.35" />
        <line x1="1.6" y1="0" x2="1.6" y2="3.2" stroke={INK} strokeWidth="0.12" opacity="0.35" />
      </pattern>
    );
  }
  if (mat === "granite" || mat === "soapstone") {
    return (
      <pattern id={uid} width="8" height="8" patternUnits="userSpaceOnUse">
        <rect width="8" height="8" fill={PAPER} />
        <circle cx="1.4" cy="2" r="0.28" fill={INK} />
        <circle cx="4.2" cy="1.1" r="0.18" fill={INK} opacity="0.7" />
        <circle cx="6.6" cy="3.4" r="0.32" fill={INK} />
        <circle cx="2.8" cy="5.6" r="0.22" fill={INK} opacity="0.8" />
        <circle cx="7.1" cy="6.8" r="0.2" fill={INK} />
        <circle cx="5" cy="4.8" r="0.15" fill={INK} opacity="0.55" />
      </pattern>
    );
  }
  if (mat === "concrete") {
    return (
      <pattern id={uid} width="7" height="7" patternUnits="userSpaceOnUse">
        <rect width="7" height="7" fill={PAPER} />
        <circle cx="1.2" cy="1.6" r="0.18" fill={INK} opacity="0.28" />
        <circle cx="4.4" cy="2.2" r="0.14" fill={INK} opacity="0.22" />
        <circle cx="2.8" cy="5.1" r="0.2" fill={INK} opacity="0.25" />
        <circle cx="5.8" cy="5.8" r="0.12" fill={INK} opacity="0.2" />
      </pattern>
    );
  }
  if (mat === "formica" || mat === "solid") {
    return (
      <pattern id={uid} width="6" height="6" patternUnits="userSpaceOnUse">
        <rect width="6" height="6" fill={PAPER} />
        <circle cx="1.5" cy="1.8" r="0.12" fill={INK} opacity="0.35" />
        <circle cx="4.4" cy="3.2" r="0.1" fill={INK} opacity="0.3" />
        <circle cx="2.8" cy="4.8" r="0.12" fill={INK} opacity="0.28" />
      </pattern>
    );
  }
  if (mat === "carrara" || mat === "marble" || mat === "calacatta") {
    return (
      <pattern id={uid} width="28" height="18" patternUnits="userSpaceOnUse">
        <rect width="28" height="18" fill={PAPER} />
        <path d="M -2 4 C 6 2, 10 9, 18 6 C 22 4, 26 10, 30 8" fill="none" stroke={INK} strokeWidth="0.32" />
        <path d="M -1 12 C 8 10, 12 16, 20 13 C 24 11, 28 16, 32 14" fill="none" stroke={INK} strokeWidth="0.22" opacity="0.7" />
        <path d="M 4 0 C 8 6, 6 12, 12 18" fill="none" stroke={INK} strokeWidth="0.18" opacity="0.45" />
      </pattern>
    );
  }
  return (
    <pattern id={uid} width="10" height="10" patternUnits="userSpaceOnUse">
      <rect width="10" height="10" fill={PAPER} />
      <circle cx="2" cy="3" r="0.16" fill={INK} opacity="0.4" />
      <circle cx="6.4" cy="1.8" r="0.12" fill={INK} opacity="0.32" />
      <circle cx="8.2" cy="6.1" r="0.18" fill={INK} opacity="0.38" />
      <circle cx="4.1" cy="7.4" r="0.11" fill={INK} opacity="0.28" />
      <circle cx="1.2" cy="8.5" r="0.13" fill={INK} opacity="0.3" />
    </pattern>
  );
}

function Faucet({ cx, y, reach = 6.2 }) {
  return (
    <g stroke={INK} fill="none">
      <rect x={cx - 1.7} y={y} width="3.4" height="0.95" rx="0.12" fill={PAPER} strokeWidth="0.32" />
      <circle cx={cx - 1.15} cy={y + 0.48} r="0.28" fill={PAPER} strokeWidth="0.28" />
      <circle cx={cx + 1.15} cy={y + 0.48} r="0.28" fill={PAPER} strokeWidth="0.28" />
      <path d={`M ${cx} ${y + 0.95} V ${y + reach * 0.55} C ${cx} ${y + reach * 0.82}, ${cx} ${y + reach}, ${cx} ${y + reach + 0.1}`} strokeWidth="0.55" strokeLinecap="round" />
      <circle cx={cx} cy={y + reach + 0.2} r="0.38" fill={PAPER} strokeWidth="0.28" />
      <rect x={cx + 1.75} y={y + 0.12} width="0.7" height="1.35" rx="0.2" fill={PAPER} strokeWidth="0.26" />
    </g>
  );
}

function KitchenSink({ w, d, item, farm = false, inset = false }) {
  const pad = inset ? 2.2 : 1.2;
  const basinX = pad;
  const basinY = inset ? 3.6 : 3.4;
  const basinW = w - pad * 2;
  const basinH = Math.max(d - basinY - (farm ? 3.2 : 2.2), 6);
  const double = String(item?.sink_type || "") === "double" || libId(item).includes("double") || (w >= 36 && libId(item).includes("sink") && !farm);
  const oval = String(item?.sink_type || "").includes("oval") || libId(item).includes("oval");
  const vessel = String(item?.sink_type || "").includes("vessel") || libId(item).includes("vessel");
  return (
    <g>
      {farm ? (
        <rect x={1.1} y={d - 3.05} width={w - 2.2} height="2.25" fill={PAPER} stroke={INK} strokeWidth="0.4" />
      ) : null}
      {double ? (
        <g>
          <rect x={basinX} y={basinY} width={basinW * 0.47} height={basinH} rx="0.9" fill={WASH} stroke={INK} strokeWidth="0.4" />
          <rect x={basinX + basinW * 0.53} y={basinY} width={basinW * 0.47} height={basinH} rx="0.9" fill={WASH} stroke={INK} strokeWidth="0.4" />
          <rect x={basinX + 0.65} y={basinY + 0.65} width={basinW * 0.47 - 1.3} height={basinH - 1.3} rx="0.55" fill="none" stroke={INK} strokeWidth="0.22" />
          <rect x={basinX + basinW * 0.53 + 0.65} y={basinY + 0.65} width={basinW * 0.47 - 1.3} height={basinH - 1.3} rx="0.55" fill="none" stroke={INK} strokeWidth="0.22" />
          <circle cx={basinX + basinW * 0.235} cy={basinY + basinH * 0.62} r="0.55" fill={PAPER} stroke={INK} strokeWidth="0.28" />
          <circle cx={basinX + basinW * 0.765} cy={basinY + basinH * 0.62} r="0.55" fill={PAPER} stroke={INK} strokeWidth="0.28" />
        </g>
      ) : oval || vessel ? (
        <g>
          <ellipse cx={w / 2} cy={basinY + basinH / 2} rx={basinW / 2} ry={basinH / 2} fill={WASH} stroke={INK} strokeWidth="0.42" />
          <ellipse cx={w / 2} cy={basinY + basinH / 2} rx={basinW / 2 - 0.85} ry={basinH / 2 - 0.75} fill="none" stroke={INK} strokeWidth="0.22" />
          <circle cx={w / 2} cy={basinY + basinH * 0.62} r="0.55" fill={PAPER} stroke={INK} strokeWidth="0.28" />
        </g>
      ) : (
        <g>
          <rect x={basinX} y={basinY} width={basinW} height={basinH} rx="0.95" fill={WASH} stroke={INK} strokeWidth="0.42" />
          <rect x={basinX + 0.75} y={basinY + 0.7} width={basinW - 1.5} height={basinH - 1.4} rx="0.6" fill="none" stroke={INK} strokeWidth="0.22" />
          {Array.from({ length: 3 }).map((_, i) => (
            <line key={i} x1={basinX + 1.3} y1={basinY + basinH * 0.34 + i * 1.05} x2={basinX + basinW - 1.3} y2={basinY + basinH * 0.34 + i * 1.05} stroke={INK} strokeWidth="0.14" opacity="0.35" />
          ))}
          <circle cx={w / 2} cy={basinY + basinH * 0.62} r="0.58" fill={PAPER} stroke={INK} strokeWidth="0.28" />
        </g>
      )}
      <Faucet cx={w / 2} y={inset ? 1.7 : 0.65} reach={Math.min(6.4, d * 0.38)} />
    </g>
  );
}

function HardwareTick({ x, y, style, vertical = true }) {
  if (style === "none") return null;
  if (style === "knob") return <circle cx={x} cy={y} r="0.32" fill={PAPER} stroke={INK} strokeWidth="0.28" />;
  if (style === "cup") return <path d={`M ${x - 0.7} ${y} Q ${x} ${y + 0.55} ${x + 0.7} ${y}`} fill="none" stroke={INK} strokeWidth="0.32" />;
  if (vertical) return <rect x={x - 0.16} y={y - 0.9} width="0.32" height="1.8" rx="0.12" fill={PAPER} stroke={INK} strokeWidth="0.26" />;
  return <rect x={x - 0.9} y={y - 0.16} width="1.8" height="0.32" rx="0.12" fill={PAPER} stroke={INK} strokeWidth="0.26" />;
}

function CabinetPlan({ w, d, item, wall = false, showSink = false }) {
  const uid = hatchId(item, "ct");
  const config = configOf(item);
  const id = libId(item);
  const style = item?.hardware_style || "bar";
  const glass = item?.glass || String(item?.door_style || "").startsWith("glass") || config === "glass";
  const overhang = Math.max(0, Number(item?.overhang) || 0);
  const bodyD = wall ? d : Math.max(d - overhang, d * 0.72);
  const frontY = bodyD;
  const doors = doorCount(item, w, config);
  const doorW = w / doors;
  const counterMat = item?.counter_material || "quartz";
  const isIsland = id.startsWith("island") || (item?.tags || []).includes("island");
  const isShelf = config === "shelf" || id.includes("shelf");
  const isCorner = config === "lazy-susan" || id.includes("corner");
  const isBlind = config === "blind" || id.includes("blind");
  const basinW = isIsland ? Math.min(33, Math.max(24, w - 24)) : w;
  const basinX = isIsland ? (w - basinW) / 2 : 0;

  if (isCorner && !wall) {
    const cut = Math.min(w, d) * 0.48;
    const cx = cut * 0.52;
    const cy = cut * 0.52;
    const r = Math.min(cut * 0.38, 9);
    return (
      <g>
        <path d={`M 0.35 0.35 H ${w - 0.35} V ${cut} H ${cut} V ${d - 0.35} H 0.35 Z`} fill={PAPER} stroke={INK} strokeWidth="0.55" />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={INK} strokeWidth="0.45" />
        <circle cx={cx} cy={cy} r={r * 0.62} fill="none" stroke={INK} strokeWidth="0.32" />
        <circle cx={cx} cy={cy} r={r * 0.28} fill="none" stroke={INK} strokeWidth="0.28" />
        <path d={`M ${cx} ${cy - r} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke={INK} strokeWidth="0.32" />
        <text x={w * 0.62} y={d * 0.62} textAnchor="middle" fontSize="2.05" fill={INK} fontFamily="Times, serif">L.S.</text>
      </g>
    );
  }

  if (isCorner && wall) {
    const leg = Math.min(w, d, 12);
    return (
      <g>
        <path d={`M 0.3 0.3 H ${w - 0.3} V ${leg} H ${leg} V ${d - 0.3} H 0.3 Z`} fill={PAPER} stroke={INK} strokeWidth="0.5" strokeDasharray="1.8 1.1" />
        <line x1={leg * 0.45} y1={leg * 0.45} x2={leg * 0.45} y2={d * 0.7} stroke={INK} strokeWidth="0.28" />
        <line x1={leg * 0.45} y1={leg * 0.45} x2={w * 0.7} y2={leg * 0.45} stroke={INK} strokeWidth="0.28" />
        <text x={w * 0.55} y={d * 0.55} textAnchor="middle" fontSize="1.9" fill={INK} fontFamily="Times, serif">W.COR.</text>
      </g>
    );
  }

  if (isBlind) {
    return (
      <g>
        <rect x="0.3" y="0.3" width={w - 0.6} height={d - 0.6} fill={PAPER} stroke={INK} strokeWidth="0.5" />
        <rect x="0.3" y={d - 6.2} width={w * 0.42} height="5.9" fill={PAPER} stroke={INK} strokeWidth="0.4" />
        <line x1={w * 0.42} y1="0.3" x2={w * 0.42} y2={d - 0.3} stroke={INK} strokeWidth="0.28" strokeDasharray="1.4 0.9" />
        <text x={w * 0.7} y={d / 2} textAnchor="middle" fontSize="2.1" fill={INK} fontFamily="Times, serif">BLIND</text>
      </g>
    );
  }

  return (
    <g>
      <defs>
        {!wall ? <CounterDefs uid={uid} material={counterMat} /> : null}
      </defs>
      <rect x="0.25" y="0.25" width={w - 0.5} height={d - 0.5} fill={wall ? PAPER : `url(#${uid})`} stroke={INK} strokeWidth="0.55" />
      {wall ? (
        <rect x="0.25" y="0.25" width={w - 0.5} height={d - 0.5} fill="none" stroke={INK} strokeWidth="0.4" strokeDasharray="1.8 1.05" />
      ) : (
        <rect x="0.25" y="0.25" width={w - 0.5} height={bodyD - 0.25} fill="none" stroke={INK} strokeWidth="0.35" />
      )}
      {overhang > 0.5 ? (
        <rect x="0.25" y={bodyD} width={w - 0.5} height={d - bodyD - 0.25} fill={`url(#${uid})`} stroke={INK} strokeWidth="0.32" strokeDasharray="1.5 0.9" />
      ) : null}

      {isShelf ? (
        <g>
          {[0.28, 0.5, 0.72].map((t) => (
            <line key={t} x1="0.9" y1={d * t} x2={w - 0.9} y2={d * t} stroke={INK} strokeWidth="0.38" />
          ))}
          <line x1="0.9" y1="0.7" x2="0.9" y2={d - 0.7} stroke={INK} strokeWidth="0.4" />
          <line x1={w - 0.9} y1="0.7" x2={w - 0.9} y2={d - 0.7} stroke={INK} strokeWidth="0.4" />
        </g>
      ) : config === "drawers-3" || config === "drawers-4" ? (
        <g>
          {Array.from({ length: config === "drawers-4" ? 4 : 3 }).map((_, i, arr) => {
            const h = (frontY - 0.7) / arr.length;
            const y = 0.45 + i * h;
            return (
              <g key={i}>
                <rect x="0.7" y={y} width={w - 1.4} height={h - 0.2} fill="none" stroke={INK} strokeWidth="0.38" />
                <HardwareTick x={w / 2} y={y + h / 2} style={style} vertical={false} />
              </g>
            );
          })}
        </g>
      ) : config === "drawer-doors" ? (
        <g>
          <rect x="0.7" y="0.55" width={w - 1.4} height="4.7" fill="none" stroke={INK} strokeWidth="0.38" />
          <HardwareTick x={w / 2} y="2.9" style={style} vertical={false} />
          {Array.from({ length: doors }).map((_, i) => {
            const x = 0.7 + i * ((w - 1.4) / doors);
            const dw = (w - 1.4) / doors;
            const doorY = 5.45;
            const doorH = Math.max(frontY - 6.15, 4);
            return (
              <g key={i}>
                <rect x={x} y={doorY} width={dw - 0.15} height={doorH} fill="none" stroke={INK} strokeWidth="0.35" />
                <HardwareTick x={x + dw * (i === 0 ? 0.78 : 0.22)} y={doorY + doorH / 2} style={style} />
              </g>
            );
          })}
        </g>
      ) : config === "trash" ? (
        <g>
          <rect x="0.8" y="0.7" width={w - 1.6} height={frontY - 1.2} fill="none" stroke={INK} strokeWidth="0.4" />
          <path d={`M ${w * 0.28} ${frontY - 1.4} L ${w * 0.28} 1.4 L ${w * 0.72} 1.4 L ${w * 0.72} ${frontY - 1.4}`} fill="none" stroke={INK} strokeWidth="0.32" markerEnd="url(#arrow)" />
          <polygon points={`${w * 0.22},${frontY - 2.1} ${w * 0.28},${frontY - 1.2} ${w * 0.34},${frontY - 2.1}`} fill={INK} />
          <text x={w / 2} y={d * 0.48} textAnchor="middle" fontSize="2.2" fill={INK} fontFamily="Times, serif">TRASH</text>
        </g>
      ) : config === "fridge-wall" ? (
        <g>
          <rect x="0.7" y="0.7" width={w - 1.4} height={d - 1.4} fill="none" stroke={INK} strokeWidth="0.35" />
          <text x={w / 2} y={d / 2 + 0.8} textAnchor="middle" fontSize="2.15" fill={INK} fontFamily="Times, serif">OVER FRIDGE</text>
        </g>
      ) : config === "hood-wall" ? (
        <g>
          <rect x="0.7" y="0.7" width={w - 1.4} height={d - 1.4} fill="none" stroke={INK} strokeWidth="0.35" />
          <line x1={w * 0.18} y1={d * 0.55} x2={w * 0.82} y2={d * 0.55} stroke={INK} strokeWidth="0.3" />
          <text x={w / 2} y={d / 2 - 0.4} textAnchor="middle" fontSize="2.15" fill={INK} fontFamily="Times, serif">OVER RANGE</text>
        </g>
      ) : (
        <g>
          {Array.from({ length: doors }).map((_, i) => {
            const x = 0.7 + i * ((w - 1.4) / doors);
            const dw = (w - 1.4) / doors;
            return (
              <g key={i}>
                <rect x={x} y="0.55" width={dw - 0.15} height={frontY - 1.0} fill="none" stroke={INK} strokeWidth="0.38" />
                {glass ? (
                  <g>
                    <rect x={x + 0.55} y="1.15" width={dw - 1.25} height={frontY - 2.3} fill="none" stroke={INK} strokeWidth="0.28" />
                    {String(item?.door_style || "").includes("mullion") ? (
                      <>
                        <line x1={x + dw / 2} y1="1.15" x2={x + dw / 2} y2={frontY - 1.15} stroke={INK} strokeWidth="0.22" />
                        <line x1={x + 0.55} y1={(frontY) / 2} x2={x + dw - 0.7} y2={(frontY) / 2} stroke={INK} strokeWidth="0.22" />
                      </>
                    ) : (
                      <line x1={x + 0.7} y1="1.4" x2={x + dw - 0.85} y2={frontY - 1.4} stroke={INK} strokeWidth="0.18" opacity="0.45" />
                    )}
                  </g>
                ) : String(item?.door_style || "") === "slab" ? null : String(item?.door_style || "") === "beadboard" ? (
                  <g>
                    {Array.from({ length: 4 }).map((_, b) => (
                      <line key={b} x1={x + 0.7 + b * ((dw - 1.4) / 3)} y1="1.15" x2={x + 0.7 + b * ((dw - 1.4) / 3)} y2={frontY - 1.2} stroke={INK} strokeWidth="0.18" />
                    ))}
                  </g>
                ) : (
                  <rect
                    x={x + (String(item?.door_style || "") === "raised" ? 0.7 : 0.45)}
                    y={String(item?.door_style || "") === "raised" ? 1.25 : 1.05}
                    width={dw - (String(item?.door_style || "") === "raised" ? 1.55 : 1.05)}
                    height={frontY - (String(item?.door_style || "") === "raised" ? 2.45 : 2.05)}
                    fill="none"
                    stroke={INK}
                    strokeWidth={String(item?.door_style || "") === "recessed" ? 0.28 : 0.22}
                  />
                )}
                <HardwareTick x={x + dw * (doors === 1 ? 0.78 : i === 0 ? 0.78 : 0.22)} y={frontY * 0.52} style={style} />
              </g>
            );
          })}
        </g>
      )}

      {showSink || config === "sink" ? (
        <g transform={`translate(${basinX} 0)`}>
          <KitchenSink
            w={basinW}
            d={Math.min(isIsland ? 22 : d, bodyD)}
            item={item}
            farm={!isIsland && (String(item?.sink_type || "").includes("farm") || id.includes("farm"))}
            inset
          />
        </g>
      ) : null}
      {isIsland && overhang > 0.5 ? (
        <text x={w / 2} y={bodyD + overhang * 0.62} textAnchor="middle" fontSize="1.9" fill={INK} fontFamily="Times, serif" opacity="0.7">SEATING</text>
      ) : null}
    </g>
  );
}

function Burner({ cx, cy, r }) {
  return (
    <g fill="none" stroke={INK}>
      <circle cx={cx} cy={cy} r={r} strokeWidth="0.38" />
      <circle cx={cx} cy={cy} r={r * 0.68} strokeWidth="0.28" />
      <circle cx={cx} cy={cy} r={r * 0.38} strokeWidth="0.24" />
      <circle cx={cx} cy={cy} r={r * 0.12} fill={INK} strokeWidth="0" />
      <line x1={cx - r * 0.92} y1={cy} x2={cx + r * 0.92} y2={cy} strokeWidth="0.22" />
      <line x1={cx} y1={cy - r * 0.92} x2={cx} y2={cy + r * 0.92} strokeWidth="0.22" />
      <line x1={cx - r * 0.65} y1={cy - r * 0.65} x2={cx + r * 0.65} y2={cy + r * 0.65} strokeWidth="0.2" />
      <line x1={cx + r * 0.65} y1={cy - r * 0.65} x2={cx - r * 0.65} y2={cy + r * 0.65} strokeWidth="0.2" />
    </g>
  );
}

function RangePlan({ w, d, item }) {
  const six = w >= 35;
  const cols = six ? 3 : 2;
  const rows = 2;
  const rail = Math.min(3.2, Math.max(2.5, d * 0.14));
  const knobs = six ? 6 : 4;
  const cookY = 0.8;
  const cookH = Math.max(d - rail - 1.15, 8);
  const insetX = Math.max(1.6, w * 0.1);
  const insetY = Math.max(1.2, cookH * 0.12);
  const cellW = (w - insetX * 2) / cols;
  const cellH = (cookH - insetY * 2) / rows;
  const r = Math.min(cellW, cellH) * 0.32;
  const cooktop = libId(item).includes("cooktop");
  return (
    <g>
      <rect x="0.3" y="0.3" width={w - 0.6} height={d - 0.6} fill={PAPER} stroke={INK} strokeWidth="0.55" />
      <rect x="0.7" y={cookY} width={w - 1.4} height={cookH} fill={PAPER} stroke={INK} strokeWidth="0.4" />
      {Array.from({ length: rows }).map((_, row) => (
        Array.from({ length: cols }).map((__, col) => {
          const cx = insetX + cellW * (col + 0.5);
          const cy = cookY + insetY + cellH * (row + 0.5);
          return <Burner key={`${row}-${col}`} cx={cx} cy={cy} r={r} />;
        })
      ))}
      {!cooktop ? (
        <g>
          <rect x="0.3" y={d - rail} width={w - 0.6} height={rail - 0.25} fill={PAPER} stroke={INK} strokeWidth="0.4" />
          {Array.from({ length: knobs }).map((_, i) => (
            <g key={i}>
              <circle cx={1.55 + ((w - 3.1) / Math.max(knobs - 1, 1)) * i} cy={d - rail / 2 - 0.05} r="0.58" fill={PAPER} stroke={INK} strokeWidth="0.32" />
              <line
                x1={1.55 + ((w - 3.1) / Math.max(knobs - 1, 1)) * i}
                y1={d - rail / 2 - 0.45}
                x2={1.55 + ((w - 3.1) / Math.max(knobs - 1, 1)) * i}
                y2={d - rail / 2 + 0.12}
                stroke={INK}
                strokeWidth="0.22"
              />
            </g>
          ))}
        </g>
      ) : (
        <g>
          {Array.from({ length: 4 }).map((_, i) => (
            <rect key={i} x={w * 0.22 + i * 2.1} y={d - 1.55} width="1.6" height="0.7" fill="none" stroke={INK} strokeWidth="0.22" />
          ))}
        </g>
      )}
    </g>
  );
}

function FridgePlan({ w, d }) {
  const swing = Math.min(w * 0.92, d * 0.95);
  return (
    <g>
      <rect x="0.3" y="0.3" width={w - 0.6} height={d - 0.6} fill={PAPER} stroke={INK} strokeWidth="0.55" />
      <line x1={w / 2} y1="0.3" x2={w / 2} y2={d - 5.2} stroke={INK} strokeWidth="0.4" />
      <rect x="0.3" y={d - 5.2} width={w - 0.6} height="4.9" fill={PAPER} stroke={INK} strokeWidth="0.4" />
      <rect x={w * 0.08} y={d * 0.22} width={w * 0.16} height={d * 0.22} fill={PAPER} stroke={INK} strokeWidth="0.32" />
      <rect x={w * 0.1} y={d * 0.26} width={w * 0.12} height={d * 0.06} fill="none" stroke={INK} strokeWidth="0.2" />
      <rect x={w * 0.42} y={d * 0.18} width="0.42" height={d * 0.38} rx="0.16" fill={PAPER} stroke={INK} strokeWidth="0.28" />
      <rect x={w * 0.56} y={d * 0.18} width="0.42" height={d * 0.38} rx="0.16" fill={PAPER} stroke={INK} strokeWidth="0.28" />
      <rect x={w * 0.18} y={d - 3.35} width={w * 0.64} height="0.55" rx="0.16" fill={PAPER} stroke={INK} strokeWidth="0.26" />
      <path d={`M 0.35 ${d - 0.35} A ${swing} ${swing} 0 0 1 ${Math.min(w - 0.4, swing * 0.82)} ${Math.max(0.7, d - swing * 0.4)}`} fill="none" stroke={INK} strokeWidth="0.32" />
    </g>
  );
}

function DishwasherPlan({ w, d }) {
  return (
    <g>
      <rect x="0.3" y="0.3" width={w - 0.6} height={d - 0.6} fill={PAPER} stroke={INK} strokeWidth="0.55" />
      <rect x="0.85" y="0.85" width={w - 1.7} height={d * 0.2} fill="none" stroke={INK} strokeWidth="0.32" />
      {Array.from({ length: 4 }).map((_, i) => (
        <rect key={i} x={1.4 + i * ((w - 3.4) / 3.2)} y="1.15" width="1.05" height="0.55" fill="none" stroke={INK} strokeWidth="0.2" />
      ))}
      <rect x={w * 0.18} y={d * 0.72} width={w * 0.64} height="0.55" rx="0.14" fill={PAPER} stroke={INK} strokeWidth="0.28" />
      <text x={w / 2} y={d * 0.48} textAnchor="middle" fontSize="2.4" fill={INK} fontFamily="Times, serif">DW</text>
    </g>
  );
}

function LaundryPlan({ w, d, kind }) {
  const label = kind === "washer" ? "W" : kind === "dryer" ? "D" : "MW";
  return (
    <g>
      <rect x="0.3" y="0.3" width={w - 0.6} height={d - 0.6} fill={PAPER} stroke={INK} strokeWidth="0.5" />
      {kind === "micro" ? (
        <g>
          <rect x="0.85" y="0.8" width={w - 2.5} height={d - 1.7} fill="none" stroke={INK} strokeWidth="0.35" />
          <rect x={w - 1.45} y={d * 0.28} width="0.55" height={d * 0.42} fill="none" stroke={INK} strokeWidth="0.28" />
        </g>
      ) : (
        <g>
          <circle cx={w / 2} cy={d * 0.52} r={Math.min(w, d) * 0.24} fill="none" stroke={INK} strokeWidth="0.45" />
          <circle cx={w / 2} cy={d * 0.52} r={Math.min(w, d) * 0.16} fill="none" stroke={INK} strokeWidth="0.28" />
        </g>
      )}
      <text x={w / 2} y={d - 1.2} textAnchor="middle" fontSize="2.3" fill={INK} fontFamily="Times, serif">{label}</text>
    </g>
  );
}

function HoodPlan({ w, d }) {
  return (
    <g>
      <rect x="0.35" y="0.35" width={w - 0.7} height={d - 0.7} fill={PAPER} stroke={INK} strokeWidth="0.5" strokeDasharray="1.6 1" />
      <rect x={w * 0.28} y="0.5" width={w * 0.44} height={d * 0.34} fill="none" stroke={INK} strokeWidth="0.35" />
      {Array.from({ length: 3 }).map((_, i) => (
        <rect key={i} x={1.3 + i * ((w - 2.8) / 3)} y={d * 0.52} width={(w - 3.2) / 3} height={d * 0.28} fill="none" stroke={INK} strokeWidth="0.28" />
      ))}
    </g>
  );
}

export function ObjectSymbol({ item, width, depth }) {
  const w = Math.max(Number(width || item?.width || 24), 4);
  const d = Math.max(Number(depth || item?.depth || 24), 2);
  const id = libId(item);
  const tags = item?.tags || [];
  const wallCab = isWallCabinetObject(item) || id.includes("cab-wall") || id.includes("shelf");
  const note = String(item?.note || "");

  if (id.startsWith("counter") || tags.includes("countertop")) {
    const uid = hatchId(item, "run");
    return (
      <g>
        <defs><CounterDefs uid={uid} material={item?.counter_material || item?.finish || "quartz"} /></defs>
        <rect x="0.25" y="0.25" width={w - 0.5} height={d - 0.5} fill={`url(#${uid})`} stroke={INK} strokeWidth="0.5" />
        <rect x="0.8" y="0.8" width={w - 1.6} height={d - 1.6} fill="none" stroke={INK} strokeWidth="0.18" opacity="0.35" />
      </g>
    );
  }

  if (id.startsWith("filler") || tags.includes("filler")) {
    return (
      <g>
        <rect x="0.2" y="0.2" width={w - 0.4} height={d - 0.4} fill={WASH} stroke={INK} strokeWidth="0.45" />
        <line x1="0.35" y1="0.35" x2={w - 0.35} y2={d - 0.35} stroke={INK} strokeWidth="0.22" />
        <line x1={w - 0.35} y1="0.35" x2="0.35" y2={d - 0.35} stroke={INK} strokeWidth="0.22" />
        {w >= 2.5 ? (
          <text x={w / 2} y={d / 2 + 0.7} textAnchor="middle" fontSize={Math.min(2.1, Math.max(1.2, w * 0.55))} fill={INK} fontFamily="Times, serif">F</text>
        ) : null}
      </g>
    );
  }

  if (id.startsWith("cab-") || id.startsWith("island") || id.startsWith("peninsula") || id.includes("vanity") || tags.includes("cabinet") || tags.includes("island") || tags.includes("peninsula") || tags.includes("vanity")) {
    return (
      <OrientedSymbol
        w={w}
        d={d}
        front={facingOf(item)}
        render={(iw, ih) => (
          <CabinetPlan w={iw} d={ih} item={item} wall={wallCab} showSink={id.includes("sink") || id.includes("vanity") || id.includes("farm")} />
        )}
      />
    );
  }

  if (id.startsWith("mirror")) {
    const shape = item?.mirror_shape || (id.includes("round") ? "round" : id.includes("arch") ? "arch" : "rect");
    const lighted = item?.lighted || id.includes("lighted");
    return (
      <g>
        {shape === "round" ? (
          <circle cx={w / 2} cy={d / 2} r={Math.min(w, d) / 2 - 0.35} fill={PAPER} stroke={INK} strokeWidth="0.5" />
        ) : shape === "arch" ? (
          <path d={`M 0.5 ${d - 0.35} V ${d * 0.45} Q ${w / 2} 0.2 ${w - 0.5} ${d * 0.45} V ${d - 0.35} Z`} fill={PAPER} stroke={INK} strokeWidth="0.5" />
        ) : (
          <rect x="0.35" y="0.25" width={w - 0.7} height={d - 0.5} fill={PAPER} stroke={INK} strokeWidth="0.5" />
        )}
        <line x1="1.1" y1={d * 0.25} x2={w * 0.55} y2={d * 0.78} stroke={INK} strokeWidth="0.28" />
        {lighted ? <rect x="0.15" y="0.1" width={w - 0.3} height={d - 0.2} fill="none" stroke={INK} strokeWidth="0.22" strokeDasharray="0.8 0.6" /> : null}
      </g>
    );
  }

  if (id.startsWith("range") || id.startsWith("cooktop")) {
    return <OrientedSymbol w={w} d={d} front={facingOf(item)} render={(iw, ih) => <RangePlan w={iw} d={ih} item={item} />} />;
  }
  if (id.startsWith("fridge") || id.startsWith("wine-fridge")) {
    return <OrientedSymbol w={w} d={d} front={facingOf(item)} render={(iw, ih) => <FridgePlan w={iw} d={ih} />} />;
  }
  if (id.startsWith("dw-")) {
    return <OrientedSymbol w={w} d={d} front={facingOf(item)} render={(iw, ih) => <DishwasherPlan w={iw} d={ih} />} />;
  }
  if (id.startsWith("micro")) {
    return <OrientedSymbol w={w} d={d} front={facingOf(item)} render={(iw, ih) => <LaundryPlan w={iw} d={ih} kind="micro" />} />;
  }
  if (id === "washer") return <LaundryPlan w={w} d={d} kind="washer" />;
  if (id === "dryer") return <LaundryPlan w={w} d={d} kind="dryer" />;
  if (id.startsWith("ice-maker") || id.startsWith("oven-wall")) {
    return (
      <g>
        <rect x="0.3" y="0.3" width={w - 0.6} height={d - 0.6} fill={PAPER} stroke={INK} strokeWidth="0.5" />
        <rect x="0.9" y="0.9" width={w - 1.8} height={d - 2.4} fill="none" stroke={INK} strokeWidth="0.35" />
        <rect x={w * 0.22} y={d * 0.72} width={w * 0.56} height="0.5" fill={PAPER} stroke={INK} strokeWidth="0.26" />
        <text x={w / 2} y={d * 0.48} textAnchor="middle" fontSize="2.2" fill={INK} fontFamily="Times, serif">{id.startsWith("ice-maker") ? "ICE" : id.includes("double") ? "OVEN×2" : "OVEN"}</text>
      </g>
    );
  }

  if (id.startsWith("sink-") || (id.includes("sink") && tags.includes("plumbing"))) {
    const farm = String(item?.sink_type || "").includes("farm") || /apron|fireclay|farm|copper/i.test(note + id);
    return <OrientedSymbol w={w} d={d} front={facingOf(item)} render={(iw, ih) => <KitchenSink w={iw} d={ih} item={{ ...item, id }} farm={farm} />} />;
  }

  if (id.startsWith("hood") || id.startsWith("vent")) {
    if (id.startsWith("vent")) {
      return (
        <g>
          <rect x="0.4" y="0.4" width={w - 0.8} height={d - 0.8} fill={PAPER} stroke={INK} strokeWidth="0.45" strokeDasharray="1.6 1" />
          {Array.from({ length: 4 }).map((_, i) => (
            <line key={i} x1="1" y1={1.2 + i * ((d - 2.4) / 3)} x2={w - 1} y2={1.2 + i * ((d - 2.4) / 3)} stroke={INK} strokeWidth="0.25" />
          ))}
        </g>
      );
    }
    return <OrientedSymbol w={w} d={d} front={facingOf(item)} render={(iw, ih) => <HoodPlan w={iw} d={ih} />} />;
  }

  if (id.startsWith("shower") || tags.includes("glass") || tags.includes("shower")) {
    const door = item?.shower_door || (id.includes("pivot") ? "pivot" : id.includes("slide") ? "sliding" : id.includes("bifold") ? "bifold" : id.includes("frameless") ? "frameless" : id.includes("framed") || id.includes("black-frame") ? "framed" : "frameless");
    const neo = item?.shower_type === "neo" || id.includes("neo");
    const corner = item?.shower_type === "corner" || id.includes("corner");
    const heavy = door === "framed";
    return (
      <g>
        {neo ? (
          <path d={`M 0.4 ${d - 0.4} H ${w * 0.58} L ${w - 0.4} ${d * 0.42} V 0.4 H 0.4 Z`} fill={PAPER} stroke={INK} strokeWidth="0.55" />
        ) : corner ? (
          <path d={`M 0.4 0.4 H ${w - 0.4} V ${d * 0.55} L ${w * 0.55} ${d - 0.4} H 0.4 Z`} fill={PAPER} stroke={INK} strokeWidth="0.55" />
        ) : (
          <rect x="0.4" y="0.4" width={w - 0.8} height={d - 0.8} fill={PAPER} stroke={INK} strokeWidth="0.55" />
        )}
        <rect x="1.1" y="1.1" width={w - 2.2} height={d - 2.2} fill="none" stroke={INK} strokeWidth={heavy ? 0.75 : door === "frameless" ? 0.28 : 0.5} />
        {door === "pivot" ? (
          <path d={`M 0.8 ${d - 0.8} A ${w - 1.6} ${w - 1.6} 0 0 1 ${w - 0.8} 0.8`} fill="none" stroke={INK} strokeWidth="0.35" />
        ) : null}
        {door === "sliding" ? <line x1={w / 2} y1="0.6" x2={w / 2} y2={d - 0.6} stroke={INK} strokeWidth="0.4" /> : null}
        {door === "bifold" ? (
          <path d={`M 0.8 ${d - 0.8} L ${w * 0.32} ${d * 0.45} L ${w * 0.55} ${d - 0.8}`} fill="none" stroke={INK} strokeWidth="0.35" />
        ) : null}
        <rect x={w * 0.18} y={d * 0.72} width={w * 0.28} height={d * 0.12} fill="none" stroke={INK} strokeWidth="0.3" />
      </g>
    );
  }

  if (id.startsWith("tub") || id.startsWith("toilet") || id.startsWith("niche") || id.startsWith("bench") || id.startsWith("drain") || id.startsWith("rain") || id.startsWith("handheld") || id.startsWith("faucet") || id.startsWith("body-spray") || id.startsWith("shower-valve") || id.startsWith("towel") || id.startsWith("robe") || id.startsWith("tp-")) {
    const soak = item?.tub_type === "soaking" || id.includes("japanese") || id.includes("soak");
    const jetted = item?.tub_type === "jetted" || id.includes("jetted");
    const rx = id.startsWith("toilet") ? Math.min(w, d) / 3.2 : soak ? 1.1 : 6.2;
    return (
      <g>
        <rect x="0.4" y="0.4" width={w - 0.8} height={d - 0.8} rx={rx} fill={PAPER} stroke={INK} strokeWidth="0.5" />
        {id.startsWith("toilet") ? (
          <g>
            <rect x={w * 0.22} y="0.8" width={w * 0.56} height={d * 0.26} rx="0.5" fill={PAPER} stroke={INK} strokeWidth="0.35" />
            <ellipse cx={w / 2} cy={d * 0.62} rx={w * 0.26} ry={d * 0.18} fill={PAPER} stroke={INK} strokeWidth="0.35" />
            {item?.toilet_type === "wall" || id.includes("wall") ? <line x1="0.5" y1="0.5" x2={w - 0.5} y2="0.5" stroke={INK} strokeWidth="0.4" /> : null}
          </g>
        ) : id.startsWith("niche") ? (
          <g>
            <line x1="0.9" y1={d / 3} x2={w - 0.9} y2={d / 3} stroke={INK} strokeWidth="0.28" />
            <line x1="0.9" y1={(d * 2) / 3} x2={w - 0.9} y2={(d * 2) / 3} stroke={INK} strokeWidth="0.28" />
          </g>
        ) : id.startsWith("drain") ? (
          <g>
            {Array.from({ length: 6 }).map((_, i) => (
              <line key={i} x1={1 + i * ((w - 2) / 5)} y1="0.7" x2={1 + i * ((w - 2) / 5) + 1.2} y2={d - 0.7} stroke={INK} strokeWidth="0.22" />
            ))}
          </g>
        ) : id.startsWith("rain") || id.startsWith("body-spray") ? (
          <g>
            <circle cx={w / 2} cy={d / 2} r={Math.min(w, d) / 2 - 0.5} fill="none" stroke={INK} strokeWidth="0.4" />
            {Array.from({ length: 8 }).map((_, i) => (
              <line key={i} x1={w / 2} y1={d / 2} x2={w / 2 + Math.cos((i / 8) * Math.PI * 2) * (Math.min(w, d) / 2 - 0.8)} y2={d / 2 + Math.sin((i / 8) * Math.PI * 2) * (Math.min(w, d) / 2 - 0.8)} stroke={INK} strokeWidth="0.2" />
            ))}
          </g>
        ) : id.startsWith("faucet") || id.startsWith("shower-valve") ? (
          <Faucet cx={w / 2} y={0.6} reach={Math.min(d - 1.4, 6)} />
        ) : id.startsWith("bench") ? (
          <rect x="0.7" y="0.7" width={w - 1.4} height={d - 1.4} fill="none" stroke={INK} strokeWidth="0.35" />
        ) : id.startsWith("towel") || id.startsWith("robe") || id.startsWith("tp-") ? (
          <line x1="0.8" y1={d / 2} x2={w - 0.8} y2={d / 2} stroke={INK} strokeWidth="0.4" />
        ) : (
          <g>
            <ellipse cx={w / 2} cy={d * 0.52} rx={w * 0.32} ry={d * 0.22} fill={PAPER} stroke={INK} strokeWidth="0.35" />
            {jetted ? Array.from({ length: 6 }).map((_, i) => (
              <circle key={i} cx={1.6 + (i % 3) * ((w - 3.2) / 2)} cy={1.4 + Math.floor(i / 3) * (d - 2.8)} r="0.35" fill="none" stroke={INK} strokeWidth="0.22" />
            )) : null}
          </g>
        )}
      </g>
    );
  }

  if (id.startsWith("fp-")) {
    const boxX = w * 0.12;
    const boxW = w * 0.76;
    const boxY = d * 0.18;
    const boxH = d * 0.52;
    return (
      <g>
        <rect x="0.35" y="0.35" width={w - 0.7} height={d - 0.7} fill={PAPER} stroke={INK} strokeWidth="0.55" />
        <rect x={boxX} y={boxY} width={boxW} height={boxH} fill={PAPER} stroke={INK} strokeWidth="0.45" />
        <rect x={boxX + boxW * 0.08} y={boxY + boxH * 0.16} width={boxW * 0.84} height={boxH * 0.62} fill={PAPER} stroke={INK} strokeWidth="0.32" />
        <line x1={boxX + boxW * 0.2} y1={boxY + boxH * 0.78} x2={boxX + boxW * 0.8} y2={boxY + boxH * 0.78} stroke={INK} strokeWidth="0.28" />
        <text x={w / 2} y={d - 1.15} textAnchor="middle" fontSize="2.1" fill={INK} fontFamily="Times, serif">GAS F.P.</text>
      </g>
    );
  }

  if (id.startsWith("stairs") || id === "deck-stairs") {
    if (id.includes("spiral")) {
      const r = Math.min(w, d) / 2 - 0.5;
      return (
        <g>
          <circle cx={w / 2} cy={d / 2} r={r} fill={PAPER} stroke={INK} strokeWidth="0.5" />
          {Array.from({ length: 8 }).map((_, i) => {
            const a = (i / 8) * Math.PI * 2;
            return <line key={i} x1={w / 2} y1={d / 2} x2={w / 2 + Math.cos(a) * r} y2={d / 2 + Math.sin(a) * r} stroke={INK} strokeWidth="0.28" />;
          })}
        </g>
      );
    }
    const steps = 8;
    return (
      <g>
        <rect x="0.4" y="0.4" width={w - 0.8} height={d - 0.8} fill={PAPER} stroke={INK} strokeWidth="0.5" />
        {Array.from({ length: steps }).map((_, i) => (
          <line key={i} x1="0.4" y1={(d / steps) * i} x2={w - 0.4} y2={(d / steps) * i} stroke={INK} strokeWidth="0.28" />
        ))}
        <polygon points={`${w * 0.42},${d * 0.16} ${w * 0.58},${d * 0.16} ${w * 0.5},${d * 0.08}`} fill={INK} />
      </g>
    );
  }

  if (id.startsWith("deck") || id.startsWith("patio") || id.startsWith("railing") || id.startsWith("addition")) {
    return (
      <g>
        <rect x="0.4" y="0.4" width={w - 0.8} height={d - 0.8} fill={PAPER} stroke={INK} strokeWidth="0.5" />
        {Array.from({ length: 6 }).map((_, i) => (
          <line key={i} x1="0.8" y1={(d / 6) * i} x2={w - 0.8} y2={(d / 6) * i} stroke={INK} strokeWidth="0.22" />
        ))}
      </g>
    );
  }

  if (id.startsWith("fan-")) {
    const r = Math.min(w, d) / 2 - 0.35;
    return (
      <g>
        <circle cx={w / 2} cy={d / 2} r={r * 0.22} fill={PAPER} stroke={INK} strokeWidth="0.4" />
        {Array.from({ length: 4 }).map((_, i) => {
          const a = (i / 4) * Math.PI * 2;
          return (
            <ellipse
              key={i}
              cx={w / 2 + Math.cos(a) * r * 0.52}
              cy={d / 2 + Math.sin(a) * r * 0.52}
              rx={r * 0.4}
              ry={r * 0.14}
              transform={`rotate(${(a * 180) / Math.PI} ${w / 2} ${d / 2})`}
              fill={PAPER}
              stroke={INK}
              strokeWidth="0.28"
            />
          );
        })}
      </g>
    );
  }

  if (id.startsWith("light-")) {
    const r = Math.min(3.1, Math.min(w, d) / 2 - 0.2);
    const cx = w / 2;
    const cy = d / 2;
    return (
      <g>
        <circle cx={cx} cy={cy} r={r} fill={PAPER} stroke={INK} strokeWidth="0.4" />
        <line x1={cx - r * 0.7} y1={cy} x2={cx + r * 0.7} y2={cy} stroke={INK} strokeWidth="0.28" />
        <line x1={cx} y1={cy - r * 0.7} x2={cx} y2={cy + r * 0.7} stroke={INK} strokeWidth="0.28" />
        {id.includes("pendant") ? (
          <text x={cx} y={cy + r + 2.1} textAnchor="middle" fontSize="2" fill={INK} fontFamily="Times, serif">P</text>
        ) : null}
        {id.includes("chandelier") ? <circle cx={cx} cy={cy} r={r * 1.45} fill="none" stroke={INK} strokeWidth="0.3" /> : null}
      </g>
    );
  }

  if (id.startsWith("door-") || tags.includes("door")) {
    return (
      <g>
        <rect x="0.35" y="0.3" width={w - 0.7} height={d - 0.6} fill={PAPER} stroke={INK} strokeWidth="0.5" />
        <path d={`M 0.4 ${d - 0.3} A ${w - 0.8} ${w - 0.8} 0 0 1 ${w - 0.4} ${Math.min(d * 4, w)}`} fill="none" stroke={INK} strokeWidth="0.4" />
      </g>
    );
  }

  if (id.startsWith("win-") || tags.includes("window") || tags.includes("cased")) {
    return (
      <g>
        <rect x="0.35" y="0.3" width={w - 0.7} height={d - 0.6} fill={PAPER} stroke={INK} strokeWidth="0.5" />
        <line x1={w / 2} y1="0.3" x2={w / 2} y2={d - 0.3} stroke={INK} strokeWidth="0.32" />
      </g>
    );
  }

  if (id.startsWith("outlet-") || id.startsWith("switch") || id === "panel" || id === "smoke") {
    const cx = w / 2;
    const cy = d / 2;
    const mark = Math.min(2.4, Math.min(w, d) * 0.28);
    if (id === "panel") {
      return (
        <g>
          <rect x="0.4" y="0.4" width={w - 0.8} height={d - 0.8} fill={PAPER} stroke={INK} strokeWidth="0.5" />
          <text x={w / 2} y={d / 2 + 1.1} textAnchor="middle" fontSize="2.4" fill={INK} fontFamily="Times, serif">PNL</text>
        </g>
      );
    }
    return (
      <g>
        {id.startsWith("outlet") ? (
          <g>
            <circle cx={cx} cy={cy} r={mark} fill="none" stroke={INK} strokeWidth="0.45" />
            <line x1={cx - mark * 0.35} y1={cy - mark * 0.2} x2={cx - mark * 0.35} y2={cy + mark * 0.2} stroke={INK} strokeWidth="0.35" />
            <line x1={cx + mark * 0.35} y1={cy - mark * 0.2} x2={cx + mark * 0.35} y2={cy + mark * 0.2} stroke={INK} strokeWidth="0.35" />
            {id.includes("gfci") ? (
              <text x={cx} y={cy + mark + 1.8} textAnchor="middle" fontSize="1.7" fill={INK} fontFamily="Times, serif">GFI</text>
            ) : null}
          </g>
        ) : (
          <g>
            <circle cx={cx} cy={cy} r={mark} fill="none" stroke={INK} strokeWidth="0.45" />
            <text x={cx} y={cy + mark * 0.38} textAnchor="middle" fontSize={mark * 1.05} fill={INK} fontFamily="Times, serif">
              {id.includes("dimmer") ? "SD" : id.includes("3way") ? "S3" : id === "smoke" ? "SM" : "S"}
            </text>
          </g>
        )}
      </g>
    );
  }

  if (id.startsWith("wh-")) {
    return (
      <g>
        <rect x="0.45" y="0.45" width={w - 0.9} height={d - 0.9} rx={id.includes("tankless") ? 0.6 : Math.min(w, d) / 2.3} fill={PAPER} stroke={INK} strokeWidth="0.5" />
        <text x={w / 2} y={d / 2 + 1.1} textAnchor="middle" fontSize="2.4" fill={INK} fontFamily="Times, serif">{id.includes("tankless") ? "TL" : "WH"}</text>
      </g>
    );
  }

  if (id.startsWith("hvac-")) {
    return (
      <g>
        <rect x="0.45" y="0.45" width={w - 0.9} height={d - 0.9} fill={PAPER} stroke={INK} strokeWidth="0.5" />
        <circle cx={w / 2} cy={d / 2} r={Math.min(w, d) * 0.22} fill="none" stroke={INK} strokeWidth="0.4" />
      </g>
    );
  }

  if (id === "disposal") {
    return (
      <g>
        <circle cx={w / 2} cy={d / 2} r={Math.min(w, d) / 2 - 0.3} fill={PAPER} stroke={INK} strokeWidth="0.5" />
        <text x={w / 2} y={d / 2 + 1} textAnchor="middle" fontSize="2" fill={INK} fontFamily="Times, serif">DISP</text>
      </g>
    );
  }

  if (id.startsWith("lvl-") || tags.includes("lvl")) {
    const plies = id.includes("triple") ? 3 : id.includes("double") ? 2 : 1;
    return (
      <g>
        {Array.from({ length: plies }).map((_, i) => (
          <rect
            key={i}
            x="0.35"
            y={0.35 + i * ((d - 0.7) / plies)}
            width={w - 0.7}
            height={(d - 0.8) / plies}
            fill={PAPER}
            stroke={INK}
            strokeWidth="0.4"
            strokeDasharray="1.4 0.8"
          />
        ))}
      </g>
    );
  }

  if (tags.includes("electrical") || tags.includes("plumbing") || tags.includes("trim") || tags.includes("finish") || tags.includes("hvac")) {
    const mark = tags.includes("plumbing") ? "P" : tags.includes("hvac") ? "H" : tags.includes("electrical") ? "E" : "T";
    const r = Math.max(Math.min(2.6, Math.min(w, d) / 2 - 0.2), 1.4);
    return (
      <g>
        <circle cx={w / 2} cy={d / 2} r={r} fill={PAPER} stroke={INK} strokeWidth="0.45" />
        <text x={w / 2} y={d / 2 + r * 0.38} textAnchor="middle" fontSize={r * 1.05} fill={INK} fontFamily="Times, serif">{mark}</text>
      </g>
    );
  }

  return (
    <g>
      <rect x="0.4" y="0.4" width={w - 0.8} height={d - 0.8} fill={PAPER} stroke={INK} strokeWidth="0.5" />
    </g>
  );
}

function CabinetElevation({ w, h, item }) {
  const config = configOf(item);
  const id = libId(item);
  const style = item?.hardware_style || "bar";
  const glass = item?.glass || String(item?.door_style || "").startsWith("glass") || config === "glass";
  const wall = isWallCabinetObject(item) || id.includes("cab-wall") || id.includes("shelf");
  const tall = (item?.tags || []).includes("tall") || id.includes("tall") || id.includes("oven") || id.includes("fridge-panel");
  const doors = doorCount(item, w, config);
  const toe = wall || tall ? 0 : Math.min(4.5, h * 0.13);
  const top = 0.45;
  const faceBottom = h - toe - 0.3;
  const innerX = 0.7;
  const innerW = w - 1.4;
  const drawerH = Math.min(6.4, Math.max(4.2, (faceBottom - top) * 0.2));

  const doorFaces = (y, dh) => Array.from({ length: doors }).map((_, i) => {
    const x = innerX + i * (innerW / doors);
    const dw = innerW / doors;
    return (
      <g key={`door-${i}`}>
        <rect x={x} y={y} width={dw - 0.15} height={dh} fill="none" stroke={INK} strokeWidth="0.38" />
        {glass ? (
          <rect x={x + 0.45} y={y + 0.55} width={dw - 1.05} height={Math.max(dh - 1.1, 2)} fill="none" stroke={INK} strokeWidth="0.26" />
        ) : String(item?.door_style || "") === "slab" ? null : (
          <rect x={x + 0.4} y={y + 0.5} width={dw - 0.95} height={Math.max(dh - 1.0, 2)} fill="none" stroke={INK} strokeWidth="0.22" />
        )}
        <HardwareTick x={x + dw * (doors === 1 ? 0.78 : i === 0 ? 0.78 : 0.22)} y={y + dh * 0.52} style={style} />
      </g>
    );
  });

  return (
    <g>
      <rect x="0.3" y="0.3" width={w - 0.6} height={h - 0.6} fill={PAPER} stroke={INK} strokeWidth="0.5" />
      {toe > 0.4 ? <rect x="0.3" y={h - toe - 0.3} width={w - 0.6} height={toe} fill={WASH} stroke={INK} strokeWidth="0.32" /> : null}
      {config === "drawers-3" || config === "drawers-4" ? (
        Array.from({ length: config === "drawers-4" ? 4 : 3 }).map((_, i, arr) => {
          const dh = (faceBottom - top) / arr.length;
          const y = top + i * dh;
          return (
            <g key={i}>
              <rect x={innerX} y={y} width={innerW} height={dh - 0.15} fill="none" stroke={INK} strokeWidth="0.38" />
              <HardwareTick x={w / 2} y={y + dh / 2} style={style} vertical={false} />
            </g>
          );
        })
      ) : config === "drawer-doors" || (config === "sink" && !wall) ? (
        <g>
          <rect x={innerX} y={top} width={innerW} height={drawerH} fill="none" stroke={INK} strokeWidth="0.38" />
          <HardwareTick x={w / 2} y={top + drawerH / 2} style={style} vertical={false} />
          {doorFaces(top + drawerH + 0.15, Math.max(faceBottom - top - drawerH - 0.15, 6))}
        </g>
      ) : config === "shelf" ? (
        <g>
          {[0.28, 0.5, 0.72].map((t) => (
            <line key={t} x1={innerX} y1={h * t} x2={w - innerX} y2={h * t} stroke={INK} strokeWidth="0.38" />
          ))}
        </g>
      ) : config === "trash" ? (
        <g>
          <rect x={innerX} y={top} width={innerW} height={faceBottom - top} fill="none" stroke={INK} strokeWidth="0.38" />
          <text x={w / 2} y={h * 0.48} textAnchor="middle" fontSize={Math.min(3.2, w / 6)} fill={INK} fontFamily="Times, serif">TRASH</text>
        </g>
      ) : config === "lazy-susan" || config === "blind" ? (
        <g>
          <rect x={innerX} y={top} width={innerW} height={faceBottom - top} fill="none" stroke={INK} strokeWidth="0.38" />
          <text x={w / 2} y={h * 0.52} textAnchor="middle" fontSize={Math.min(3, w / 7)} fill={INK} fontFamily="Times, serif">{config === "blind" ? "BLIND" : "CORNER"}</text>
        </g>
      ) : (
        doorFaces(top, faceBottom - top)
      )}
    </g>
  );
}

export function LibraryThumb({ item }) {
  const id = libId(item);
  const tags = item?.tags || [];
  const cabinet = id.startsWith("cab-") || id.startsWith("island") || id.startsWith("peninsula") || id.startsWith("vanity")
    || tags.includes("cabinet") || tags.includes("island") || tags.includes("peninsula") || tags.includes("vanity");
  if (cabinet && !String(id).startsWith("vanity-top") && !tags.includes("countertop")) {
    const w = Math.max(Number(item?.width || 24), 10);
    const h = Math.max(Number(item?.height || 34.5), 12);
    return (
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-20 bg-white" preserveAspectRatio="xMidYMid meet" aria-hidden>
        <rect width={w} height={h} fill={PAPER} />
        <CabinetElevation w={w} h={h} item={item} />
      </svg>
    );
  }
  const w = Math.max(Number(item?.width || 24), 10);
  const d = Math.max(Number(item?.depth || 12), 8);
  return (
    <svg viewBox={`0 0 ${w} ${d}`} className="w-full h-16 bg-white" preserveAspectRatio="xMidYMid meet" aria-hidden>
      <rect width={w} height={d} fill={PAPER} />
      <ObjectSymbol item={item} width={item.width} depth={item.depth} />
    </svg>
  );
}

export function WindowLite({ opening, thickness, scale = 1 }) {
  const width = Number(opening.width || 36) * scale;
  const offset = Number(opening.offset || 0) * scale;
  const style = opening.style || "double-hung";
  const t = Math.max(thickness, 4);
  const glassY = -t / 2 + t * 0.18;
  const glassH = t * 0.64;
  return (
    <g>
      <rect x={offset} y={-t / 2} width={width} height={t} fill={PAPER} stroke={INK} strokeWidth="0.85" />
      <rect x={offset + 1.1} y={glassY} width={width - 2.2} height={glassH} fill={PAPER} stroke={INK} strokeWidth="0.4" />
      <line x1={offset} y1="0" x2={offset + width} y2="0" stroke={INK} strokeWidth="0.55" />
      {style === "slider" || style === "picture" || style === "double-hung" || style === "single-hung" ? (
        <line x1={offset + width / 2} y1={-t / 2} x2={offset + width / 2} y2={t / 2} stroke={INK} strokeWidth="0.4" />
      ) : null}
      {style === "casement" || style === "awning" ? (
        <path d={`M ${offset + 1.4} 0 L ${offset + width * 0.38} ${style === "awning" ? t * 0.42 : -t * 0.42}`} fill="none" stroke={INK} strokeWidth="0.4" />
      ) : null}
      {opening.install === "replacement" ? (
        <rect x={offset + 0.6} y={-t / 2 + 0.4} width={width - 1.2} height={Math.max(t - 0.8, 0.8)} fill="none" stroke={INK} strokeWidth="0.35" strokeDasharray="1.2 0.8" />
      ) : null}
      <text x={offset + width / 2} y={t / 2 + 7.5} textAnchor="middle" fontSize="7" fill={INK} fontFamily="Times, serif">W</text>
    </g>
  );
}

export function CasedOpening({ opening, thickness, scale = 1 }) {
  const width = Number(opening.width || 36) * scale;
  const offset = Number(opening.offset || 0) * scale;
  const t = Math.max(thickness, 4);
  return (
    <g>
      <rect x={offset} y={-t / 2} width={width} height={t} fill={PAPER} stroke="none" />
      <line x1={offset} y1={-t / 2 - 3.5} x2={offset} y2={t / 2 + 3.5} stroke={INK} strokeWidth="1.15" />
      <line x1={offset + width} y1={-t / 2 - 3.5} x2={offset + width} y2={t / 2 + 3.5} stroke={INK} strokeWidth="1.15" />
      <line x1={offset} y1={-t / 2} x2={offset + width} y2={-t / 2} stroke={INK} strokeWidth="0.45" />
      <line x1={offset} y1={t / 2} x2={offset + width} y2={t / 2} stroke={INK} strokeWidth="0.45" />
      <text x={offset + width / 2} y={-t / 2 - 5.5} textAnchor="middle" fontSize="7.5" fill={INK} fontFamily="Times, serif">C.O.</text>
    </g>
  );
}

export function DoorSwing({ opening, thickness, scale = 1 }) {
  const width = Number(opening.width || 32) * scale;
  const offset = Number(opening.offset || 0) * scale;
  const french = String(opening.style || "").includes("french") || Number(opening.leafs) === 2;
  const leafs = french ? 2 : Math.max(1, Number(opening.leafs) || 1);
  const lites = Math.max(0, Number(opening.lites) || (french ? 4 : 0));
  const left = opening.swing !== "right";
  const inward = opening.direction !== "out";
  const storm = width * 0.72;
  const leafW = width / leafs;
  const sign = inward ? 1 : -1;
  const liteH = Math.max(thickness * 0.55, 2.2);

  const swingPath = (hinge, leafWidth, sweepLeft) => {
    const sweep = sweepLeft ? (inward ? 1 : 0) : (inward ? 0 : 1);
    const endX = sweepLeft ? hinge + leafWidth : hinge - leafWidth;
    return `M ${hinge} 0 A ${leafWidth} ${leafWidth} 0 0 ${sweep} ${endX} ${sign * leafWidth}`;
  };

  const liteMarks = (x0, leafWidth) => {
    if (lites < 2) return null;
    return Array.from({ length: lites }).map((_, i) => {
      const x = x0 + ((i + 0.5) * leafWidth) / lites;
      return (
        <rect
          key={`lite-${x0}-${i}`}
          x={x - leafWidth / lites / 2 + 0.35}
          y={-liteH / 2}
          width={Math.max(1.1, leafWidth / lites - 0.7)}
          height={liteH}
          fill={PAPER}
          stroke={INK}
          strokeWidth="0.28"
        />
      );
    });
  };

  return (
    <g>
      <rect x={offset} y={-thickness / 2} width={width} height={thickness} fill={PAPER} stroke={INK} strokeWidth="0.6" />
      {leafs === 2 ? (
        <g>
          <line x1={offset + leafW} y1={-thickness / 2 - 1.2} x2={offset + leafW} y2={thickness / 2 + 1.2} stroke={INK} strokeWidth="0.55" />
          {liteMarks(offset, leafW)}
          {liteMarks(offset + leafW, leafW)}
          <path d={swingPath(offset, leafW, true)} fill="none" stroke={INK} strokeWidth="0.5" />
          <path d={swingPath(offset + width, leafW, false)} fill="none" stroke={INK} strokeWidth="0.5" />
          <text x={offset + width / 2} y={sign * (leafW * 0.42 + 7)} textAnchor="middle" fill={INK} stroke="none" fontFamily="Times, serif" fontSize="6.5">
            {lites ? `${lites} LITES / LEAF` : "FRENCH"}
          </text>
        </g>
      ) : (
        <g>
          <path
            d={swingPath(offset + (left ? 0 : width), width, left)}
            fill="none"
            stroke={INK}
            strokeWidth="0.5"
          />
          {opening.storm ? (
            <path
              d={`M ${offset + (left ? 0 : width)} 0 A ${storm} ${storm} 0 0 ${left ? (inward ? 1 : 0) : (inward ? 0 : 1)} ${offset + (left ? storm : width - storm)} ${inward ? storm : -storm}`}
              fill="none"
              stroke={INK}
              strokeWidth="0.4"
              strokeDasharray="1.5 1"
            />
          ) : null}
        </g>
      )}
    </g>
  );
}
