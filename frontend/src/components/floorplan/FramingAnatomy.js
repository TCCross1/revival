import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatFtInTight } from "@/lib/floorPlan/units";
import { buildWallFraming, CONFLICT_STATUS } from "@/lib/floorPlan/wallFraming";

/**
 * Interactive wall framing elevation — renders ONE coordinated FramingMember[] from buildWallFraming.
 * LOD: Fit Wall shows overview; zoom reveals member/RO detail. Selected Member panel holds specs.
 */
export default function FramingAnatomy({
  wall,
  length,
  openings = [],
  foundation = "",
  headerDefaults = {},
  openingHeaderOverrides = {},
  selectedMemberId,
  selectedOpeningId,
  onSelectMember,
  onSelectHeader,
  onSelectOpening,
  className = "",
}) {
  const framing = useMemo(
    () => buildWallFraming({
      wall,
      length,
      openings,
      foundation,
      headerDefaults,
      openingHeaderOverrides,
    }),
    [wall, length, openings, foundation, headerDefaults, openingHeaderOverrides],
  );

  const wrapRef = useRef(null);
  const [view, setView] = useState({ scale: 1, panX: 0, panY: 0 });
  const [focusConflict, setFocusConflict] = useState(null);
  const drag = useRef(null);

  const padL = 36;
  const padR = 20;
  const padTop = 42;
  const padBot = 28;
  const svgW = Math.max(520, framing.length + padL + padR);
  const svgH = Math.max(260, framing.height + padTop + padBot);

  // LOD from scale relative to fit-wall scale
  const lod = view.scale < 0.55 ? "low" : view.scale < 1.15 ? "medium" : "high";

  useEffect(() => {
    fitWall();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [framing.wallId, framing.length, framing.height]);

  const fitWall = () => {
    const node = wrapRef.current;
    if (!node) return;
    const bw = Math.max(320, node.clientWidth || 640);
    const bh = Math.max(220, node.clientHeight || 340);
    const sx = (bw - 8) / svgW;
    const sy = (bh - 8) / svgH;
    const scale = Math.max(0.2, Math.min(3.5, Math.min(sx, sy) * 0.98));
    setView({
      scale,
      panX: (bw - svgW * scale) / 2,
      panY: (bh - svgH * scale) / 2,
    });
    setFocusConflict(null);
  };

  const fitOpenings = () => {
    if (!framing.openings.length) return fitWall();
    const node = wrapRef.current;
    if (!node) return;
    const bw = node.clientWidth || 640;
    const bh = node.clientHeight || 340;
    const minX = Math.min(...framing.openings.map((o) => o.asmStart));
    const maxX = Math.max(...framing.openings.map((o) => o.asmEnd));
    const ow = Math.max(36, maxX - minX);
    const scale = Math.max(0.35, Math.min(3.2, (bw * 0.88) / (ow + padL)));
    setView({
      scale,
      panX: bw / 2 - (padL + (minX + maxX) / 2) * scale,
      panY: (bh - svgH * scale) / 2,
    });
  };

  const fitOpening = (openingId) => {
    const asm = framing.openings.find((o) => o.openingId === openingId);
    if (!asm) return;
    const node = wrapRef.current;
    if (!node) return;
    const bw = node.clientWidth || 640;
    const bh = node.clientHeight || 340;
    const ox = padL + asm.asmStart;
    const ow = Math.max(24, asm.asmEnd - asm.asmStart);
    const scale = Math.max(0.45, Math.min(3.5, (bw * 0.72) / ow));
    setView({
      scale,
      panX: bw / 2 - (ox + ow / 2) * scale,
      panY: (bh - svgH * scale) / 2,
    });
  };

  const focusConflictPair = (conflict) => {
    setFocusConflict(conflict);
    const ids = conflict.openingIds || [];
    const asms = framing.openings.filter((o) => ids.includes(o.openingId));
    if (!asms.length) return;
    const node = wrapRef.current;
    if (!node) return;
    const bw = node.clientWidth || 640;
    const bh = node.clientHeight || 340;
    const minX = Math.min(...asms.map((o) => o.roStart));
    const maxX = Math.max(...asms.map((o) => o.roEnd));
    const gapMid = (minX + maxX) / 2;
    const ow = Math.max(48, maxX - minX + 24);
    const scale = Math.max(0.5, Math.min(3.5, (bw * 0.75) / ow));
    setView({
      scale,
      panX: bw / 2 - (padL + gapMid) * scale,
      panY: (bh - svgH * scale) / 2,
    });
    if (ids[0]) onSelectOpening?.(ids[0]);
  };

  useEffect(() => {
    if (selectedOpeningId) fitOpening(selectedOpeningId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOpeningId]);

  const toSvgY = (yFromBottom, h = 0) => padTop + (framing.height - yFromBottom - h);

  const onWheel = (e) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    setView((v) => ({ ...v, scale: Math.max(0.18, Math.min(4.5, v.scale * factor)) }));
  };

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, panX: view.panX, panY: view.panY, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    if (Math.hypot(dx, dy) > 4) drag.current.moved = true;
    if (drag.current.moved) {
      setView((v) => ({ ...v, panX: drag.current.panX + dx, panY: drag.current.panY + dy }));
    }
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const selected = framing.members.find((m) => m.id === selectedMemberId);
  const selectedAsm = framing.openings.find((o) => o.openingId === selectedOpeningId);
  const uid = `fa-${framing.wallId || "w"}`;

  const errors = framing.conflicts.filter((c) => c.status === CONFLICT_STATUS.INVALID || c.status === CONFLICT_STATUS.RO_OVERLAP);
  const warns = framing.conflicts.filter((c) => c.status === CONFLICT_STATUS.TIGHT || c.status === CONFLICT_STATUS.REVIEW);

  // Annotation lanes: one header label per opening above double top plate — never stacked on lumber
  const headerAnnotations = framing.openings.map((asm) => ({
    id: asm.openingId,
    planLabel: asm.planLabel,
    short: asm.headerShort,
    x: padL + asm.roStart + asm.roWidth / 2,
    y: 12,
  }));

  return (
    <div className={`space-y-2 ${className}`} data-testid="framing-anatomy">
      <div className="flex flex-wrap items-center gap-1.5">
        <Button type="button" size="sm" variant="outline" className="h-7 text-[10px]" onClick={fitWall}>Fit Wall</Button>
        <Button type="button" size="sm" variant="outline" className="h-7 text-[10px]" onClick={fitOpenings}>Fit Openings</Button>
        <Button type="button" size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => setView((v) => ({ ...v, scale: Math.min(4.5, v.scale * 1.2) }))}>Zoom In</Button>
        <Button type="button" size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => setView((v) => ({ ...v, scale: Math.max(0.18, v.scale * 0.8) }))}>Zoom Out</Button>
        {selectedOpeningId ? (
          <Button type="button" size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => fitOpening(selectedOpeningId)}>Fit Opening</Button>
        ) : null}
        <span className="ml-auto text-[9px] uppercase tracking-wide text-[#8AA0AB]">
          LOD {lod} · pan drag · scroll zoom
        </span>
      </div>

      {errors.length || warns.length ? (
        <div className="space-y-1.5" data-testid="framing-conflict">
          {errors.map((c, i) => (
            <button
              key={`err-${i}`}
              type="button"
              className="block w-full rounded-md border border-red-300 bg-red-50 px-2 py-1.5 text-left text-[11px] text-red-800 hover:bg-red-100"
              onClick={() => focusConflictPair(c)}
            >
              <div className="font-semibold">FRAMING CONFLICT · {c.message}</div>
              <div className="mt-0.5 text-[10px]">{c.detail}</div>
              <div className="mt-0.5 font-mono text-[10px]">
                AVAILABLE {c.available}&quot; · REQUIRED {c.required}&quot; · SHORT BY {c.shortBy}&quot;
              </div>
            </button>
          ))}
          {warns.map((c, i) => (
            <button
              key={`warn-${i}`}
              type="button"
              className="block w-full rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-left text-[11px] text-amber-900 hover:bg-amber-100"
              onClick={() => focusConflictPair(c)}
            >
              <div className="font-semibold">TIGHT FRAMING · {c.message}</div>
              <div className="mt-0.5 text-[10px]">{c.detail}</div>
            </button>
          ))}
        </div>
      ) : null}

      <div
        ref={wrapRef}
        className="relative h-[min(52vh,420px)] min-h-[300px] overflow-hidden rounded-lg border border-[#0B3A8F]/20 bg-[#ebe6dc]"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        data-testid="framing-anatomy-viewport"
      >
        <svg
          width={svgW}
          height={svgH}
          style={{ transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.scale})`, transformOrigin: "0 0" }}
          className="select-none"
        >
          <defs>
            <linearGradient id={`${uid}-lumber`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#c4a574" />
              <stop offset="35%" stopColor="#e2c89a" />
              <stop offset="70%" stopColor="#b8925c" />
              <stop offset="100%" stopColor="#8a6838" />
            </linearGradient>
            <linearGradient id={`${uid}-king`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#b8894e" />
              <stop offset="50%" stopColor="#d4ad6e" />
              <stop offset="100%" stopColor="#7a5528" />
            </linearGradient>
            <linearGradient id={`${uid}-jack`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#a87840" />
              <stop offset="50%" stopColor="#c99a58" />
              <stop offset="100%" stopColor="#6e4a22" />
            </linearGradient>
            <linearGradient id={`${uid}-plate`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#d8b87e" />
              <stop offset="100%" stopColor="#9a7240" />
            </linearGradient>
            <linearGradient id={`${uid}-pt`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#8fbc8f" />
              <stop offset="40%" stopColor="#5f9a6a" />
              <stop offset="100%" stopColor="#3d6b45" />
            </linearGradient>
            <linearGradient id={`${uid}-header`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#c9a227" />
              <stop offset="50%" stopColor="#a87e18" />
              <stop offset="100%" stopColor="#6e5210" />
            </linearGradient>
            <linearGradient id={`${uid}-lvl`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#d2b48c" />
              <stop offset="50%" stopColor="#a67c52" />
              <stop offset="100%" stopColor="#6b4423" />
            </linearGradient>
            <pattern id={`${uid}-grain`} width="4" height="12" patternUnits="userSpaceOnUse">
              <path d="M1 0 C1.5 4 0.5 8 1.2 12" fill="none" stroke="#6a4a28" strokeWidth="0.35" opacity="0.35" />
            </pattern>
            <filter id={`${uid}-shadow`} x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0.6" dy="0.8" stdDeviation="0.7" floodColor="#000" floodOpacity="0.28" />
            </filter>
          </defs>

          <rect x="0" y="0" width={svgW} height={svgH} fill="#ebe6dc" />

          {/* Header annotation lane (above wall) */}
          {headerAnnotations.map((ann) => (
            <g key={`ann-${ann.id}`} className="cursor-pointer" onClick={(e) => {
              e.stopPropagation();
              const asm = framing.openings.find((o) => o.openingId === ann.id);
              onSelectHeader?.(ann.id, asm?.rec);
              onSelectOpening?.(ann.id);
            }}
            >
              <text x={ann.x} y={ann.y} textAnchor="middle" fill="#0B3A8F" fontSize="8" fontFamily="Outfit,sans-serif" fontWeight="700">
                {ann.planLabel}
              </text>
              <text x={ann.x} y={ann.y + 10} textAnchor="middle" fill="#8A6A14" fontSize="6.5" fontFamily="Outfit,sans-serif" fontWeight="600">
                {ann.short}
              </text>
            </g>
          ))}

          <text x={padL} y={padTop - 4} fill="#4B6370" fontSize="6.5" fontFamily="Outfit,sans-serif">
            {formatFtInTight(framing.length)} × {formatFtInTight(framing.height)} · {framing.stud.label}
          </text>

          {/* Conflict highlight band */}
          {focusConflict ? (() => {
            const ids = focusConflict.openingIds || [];
            const asms = framing.openings.filter((o) => ids.includes(o.openingId)).sort((a, b) => a.roStart - b.roStart);
            if (asms.length < 2) return null;
            const x1 = padL + asms[0].roEnd;
            const x2 = padL + asms[1].roStart;
            return (
              <rect
                x={Math.min(x1, x2)}
                y={toSvgY(framing.height)}
                width={Math.max(2, Math.abs(x2 - x1))}
                height={framing.height}
                fill="rgba(196,92,38,0.18)"
                stroke="#C45C26"
                strokeWidth="1"
                strokeDasharray="4 3"
                pointerEvents="none"
              />
            );
          })() : null}

          {/* Opening voids — door vs window visually distinct */}
          {framing.members.filter((m) => m.role === "opening").map((m) => {
            const isSel = m.openingId === selectedOpeningId;
            const isDoor = m.isDoor || m.type === "door";
            return (
              <g key={m.id}>
                <rect
                  x={padL + m.x}
                  y={toSvgY(m.y, m.h)}
                  width={m.w}
                  height={m.h}
                  fill={isDoor ? "#c5d4e8" : "#dce8f5"}
                  stroke={isSel ? "#C45C26" : "#0B3A8F"}
                  strokeWidth={isSel ? 1.6 : 0.7}
                  strokeDasharray={isDoor ? undefined : "3 2"}
                  opacity="0.92"
                  className="cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectOpening?.(m.openingId);
                  }}
                />
                {/* Ghost opening type mark */}
                <text
                  x={padL + m.x + m.w / 2}
                  y={toSvgY(m.y + m.h * 0.55)}
                  textAnchor="middle"
                  fill={isDoor ? "#0B3A8F" : "#4B6370"}
                  fontSize={lod === "low" ? 7 : 8}
                  fontFamily="Outfit,sans-serif"
                  fontWeight="700"
                  opacity="0.55"
                  pointerEvents="none"
                >
                  {m.planLabel}
                </text>
                {lod !== "low" ? (
                  <text
                    x={padL + m.x + m.w / 2}
                    y={toSvgY(m.y + m.h * 0.55) + 10}
                    textAnchor="middle"
                    fill="#0B3A8F"
                    fontSize="6"
                    fontFamily="Outfit,sans-serif"
                    fontWeight="600"
                    opacity="0.7"
                    pointerEvents="none"
                  >
                    {isDoor ? "DOOR RO" : "WINDOW RO"}
                  </text>
                ) : null}
              </g>
            );
          })}

          {framing.members.filter((m) => m.role !== "opening").map((m) => {
            const isSel = m.id === selectedMemberId
              || (selectedOpeningId && m.openingId === selectedOpeningId && ["header", "king-stud", "jack-stud", "cripple", "window-sill"].includes(m.role));
            const isHeader = m.role === "header";
            const isPt = m.role === "bottom-plate" && m.treatment === "pressure-treated";
            let fill = `url(#${uid}-lumber)`;
            if (m.role === "king-stud") fill = `url(#${uid}-king)`;
            else if (m.role === "jack-stud") fill = `url(#${uid}-jack)`;
            else if (m.role === "top-plate" || (m.role === "bottom-plate" && !isPt)) fill = `url(#${uid}-plate)`;
            else if (isPt) fill = `url(#${uid}-pt)`;
            else if (isHeader && m.header_kind === "lvl") fill = `url(#${uid}-lvl)`;
            else if (isHeader && m.header_kind === "engineer") fill = "none";
            else if (isHeader) fill = `url(#${uid}-header)`;
            else if (m.role === "window-sill") fill = `url(#${uid}-plate)`;

            return (
              <g key={m.id} filter={isSel ? `url(#${uid}-shadow)` : undefined}>
                <rect
                  x={padL + m.x}
                  y={toSvgY(m.y, m.h)}
                  width={Math.max(0.4, m.w)}
                  height={Math.max(0.4, m.h)}
                  fill={fill}
                  stroke={isSel ? "#0B3A8F" : (isHeader && m.header_kind === "engineer" ? "#C45C26" : "#5a4030")}
                  strokeWidth={isSel ? 1.4 : (isHeader ? 1.1 : 0.45)}
                  strokeDasharray={isHeader && m.header_kind === "engineer" ? "3 2" : undefined}
                  className="cursor-pointer"
                  data-testid={isHeader ? `framing-header-${m.openingId}` : `framing-member-${m.role}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectMember?.(m);
                    if (isHeader) onSelectHeader?.(m.openingId, m.rec);
                    else if (m.openingId) onSelectOpening?.(m.openingId);
                  }}
                />
                {(m.role === "common-stud" || m.role === "king-stud" || m.role === "jack-stud" || m.role === "cripple") ? (
                  <rect
                    x={padL + m.x}
                    y={toSvgY(m.y, m.h)}
                    width={Math.max(0.4, m.w)}
                    height={Math.max(0.4, m.h)}
                    fill={`url(#${uid}-grain)`}
                    opacity="0.45"
                    pointerEvents="none"
                  />
                ) : null}
              </g>
            );
          })}

          {/* Pack group labels at medium+ LOD — one label per side pack, not per stud */}
          {lod !== "low" ? framing.openings.map((asm) => {
            const leftJacks = framing.members.filter((m) => m.role === "jack-stud" && m.openingId === asm.openingId && m.side === "left");
            if (!leftJacks.length) return null;
            const x = padL + leftJacks[0].x + (leftJacks.length * studFace(framing) / 2);
            const y = toSvgY(asm.headerBottom * 0.45);
            return (
              <text
                key={`pack-L-${asm.openingId}`}
                x={x}
                y={y}
                textAnchor="middle"
                fill="#5a4030"
                fontSize="5.5"
                fontFamily="Outfit,sans-serif"
                fontWeight="600"
                opacity="0.85"
                pointerEvents="none"
              >
                {asm.jacks > 1 ? `${asm.jacks}J` : "J"}/{asm.kings > 1 ? `${asm.kings}K` : "K"}
              </text>
            );
          }) : null}

          {/* Plate labels — low clutter */}
          <text x={padL + 4} y={toSvgY(framing.height - 1.5) + 3} fill="#0B3A8F" fontSize="6.5" fontFamily="Outfit,sans-serif">
            DOUBLE TOP PLATE — {framing.stud.nominal}
          </text>
          {lod !== "low" ? (
            <text x={padL + 4} y={toSvgY(0) + 10} fill={framing.plateTreatment === "pressure-treated" ? "#2E7D32" : "#0B3A8F"} fontSize="6.5" fontFamily="Outfit,sans-serif">
              {framing.plateTreatment === "pressure-treated" ? `PT ${framing.stud.nominal} BOTTOM PLATE` : `BOTTOM / SOLE PLATE · ${framing.stud.nominal}`}
            </text>
          ) : null}

          {/* Dimensions */}
          <line x1={padL} y1={svgH - 12} x2={padL + framing.length} y2={svgH - 12} stroke="#0B3A8F" strokeWidth="0.7" />
          <text x={padL + framing.length / 2} y={svgH - 3} textAnchor="middle" fill="#0B3A8F" fontSize="7" fontFamily="Outfit,sans-serif">
            {formatFtInTight(framing.length)}
          </text>
          <line x1={10} y1={toSvgY(0)} x2={10} y2={toSvgY(framing.height)} stroke="#0B3A8F" strokeWidth="0.7" />
          <text x="6" y={toSvgY(framing.height / 2)} fill="#0B3A8F" fontSize="7" fontFamily="Outfit,sans-serif" transform={`rotate(-90 6 ${toSvgY(framing.height / 2)})`}>
            {formatFtInTight(framing.height)}
          </text>

          {/* O.C. sample — medium+ and only outside openings */}
          {lod !== "low" ? (() => {
            const commons = framing.members.filter((m) => m.role === "common-stud" && m.centerline != null).slice(0, 2);
            if (commons.length < 2) return null;
            const a = commons[0];
            const b = commons[1];
            const y = toSvgY(framing.height * 0.62);
            return (
              <g>
                <line x1={padL + a.centerline} y1={y} x2={padL + b.centerline} y2={y} stroke="#C45C26" strokeWidth="0.55" />
                <text x={padL + (a.centerline + b.centerline) / 2} y={y - 2} textAnchor="middle" fill="#C45C26" fontSize="6" fontFamily="Outfit,sans-serif">
                  {framing.stud.spacing}&quot; O.C.
                </text>
              </g>
            );
          })() : null}

          {/* RO dims — medium for selected / high for all */}
          {framing.openings.map((asm) => {
            const show = lod === "high" || (lod === "medium" && asm.openingId === selectedOpeningId);
            if (!show) return null;
            return (
              <g key={`dim-${asm.openingId}`}>
                <text
                  x={padL + asm.roStart + asm.roWidth / 2}
                  y={toSvgY(asm.roBottom + asm.roHeight * 0.28)}
                  textAnchor="middle"
                  fill="#0B3A8F"
                  fontSize="6"
                  fontFamily="Outfit,sans-serif"
                  fontWeight="600"
                >
                  RO {formatFtInTight(asm.roWidth)} × {formatFtInTight(asm.roHeight)}
                </text>
                {asm.isWindow ? (
                  <text
                    x={padL + asm.roStart + asm.roWidth / 2}
                    y={toSvgY(asm.roBottom) + 9}
                    textAnchor="middle"
                    fill="#4B6370"
                    fontSize="5.5"
                    fontFamily="Outfit,sans-serif"
                  >
                    Sill {formatFtInTight(asm.roBottom)}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        <div className="rounded-md border border-slate-200 bg-white p-2 text-[11px]" data-testid="framing-member-detail">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-[#0B3A8F]">Selected member</div>
          {selected ? (
            <div className="mt-1 space-y-0.5 text-[#061A23]">
              <div className="font-semibold">{selected.label || selected.role}</div>
              {selected.planLabel ? <div>Opening: {selected.planLabel}</div> : null}
              <div>{selected.nominalSize} {selected.species || ""}</div>
              {selected.length != null ? <div>Length: {formatFtInTight(selected.length)}</div> : null}
              {selected.centerline != null ? <div>Centerline: {formatFtInTight(selected.centerline)} from wall datum</div> : null}
              {selected.spacing != null ? <div>Layout: {selected.spacing}&quot; O.C.</div> : null}
              {selected.packCount > 1 ? <div>Pack: {selected.packIndex + 1} of {selected.packCount} ({selected.side})</div> : null}
              {selected.treatment === "pressure-treated" ? <div className="text-[#2E7D32] font-medium">Pressure-treated</div> : null}
              {selected.role === "header" && selected.rec ? (
                <div className="mt-1 space-y-0.5 rounded bg-[#FFF8F4] px-1.5 py-1 text-[10px] text-[#8B2E0E]">
                  <div className="font-semibold">{selected.fullLabel || selected.rec.label}</div>
                  <div>Jacks: {selected.rec.jack_studs} · Kings: {selected.rec.king_studs}</div>
                  <div>Span: {formatFtInTight(selected.rec.span_in)}</div>
                  <div className="opacity-80">{selected.rec.disclaimer}</div>
                </div>
              ) : null}
            </div>
          ) : selectedAsm ? (
            <div className="mt-1 space-y-0.5 text-[#061A23]">
              <div className="font-semibold">{selectedAsm.planLabel} · {selectedAsm.isWindow ? "WINDOW" : "DOOR"}</div>
              <div>RO {formatFtInTight(selectedAsm.roWidth)} × {formatFtInTight(selectedAsm.roHeight)}</div>
              <div>Header: {selectedAsm.rec?.label}</div>
              <div>Support: {selectedAsm.jacks} jack / {selectedAsm.kings} king each end · {framing.stud.nominal}</div>
              <div className="text-[#4B6370]">Click a lumber member for cut length details.</div>
            </div>
          ) : (
            <div className="mt-1 text-[#4B6370]">Click a stud, plate, header, sill, opening, or cripple.</div>
          )}
        </div>

        <div className="rounded-md border border-slate-200 bg-white p-2 text-[11px]" data-testid="framing-summary">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-[#0B3A8F]">Wall framing summary</div>
          <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[#061A23]">
            <span>Common studs</span><span>{framing.summary.studNominal} × {framing.summary.commonStuds}</span>
            <span>King studs</span><span>{framing.summary.studNominal} × {framing.summary.kingStuds}</span>
            <span>Jack studs</span><span>{framing.summary.studNominal} × {framing.summary.jackStuds}</span>
            <span>Cripples</span><span>{framing.summary.studNominal} × {framing.summary.cripples}</span>
            <span>Double top plate</span><span>{framing.summary.studNominal} · {formatFtInTight(framing.summary.topPlateLf)}</span>
            <span>Bottom plate</span>
            <span>
              {framing.summary.bottomPlateTreatment === "pressure-treated" ? "PT " : ""}
              {framing.summary.studNominal} · {formatFtInTight(framing.summary.bottomPlateLf)}
            </span>
          </div>
          {framing.summary.headers?.length ? (
            <div className="mt-1.5 border-t border-slate-100 pt-1 space-y-0.5">
              {framing.summary.headers.map((h) => (
                <button
                  key={h.openingId}
                  type="button"
                  className="block w-full text-left text-[10px] text-[#C45C26] hover:underline"
                  onClick={() => onSelectHeader?.(h.openingId, framing.openings.find((o) => o.openingId === h.openingId)?.rec)}
                >
                  {h.planLabel} · {String(h.type || "opening").toUpperCase()} · {h.shortLabel || h.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-[9px] text-[#4B6370]">
        {[
          ["Common", "#c4a574"],
          ["King", "#b8894e"],
          ["Jack", "#a87840"],
          ["Header", "#c9a227"],
          ["Door RO", "#c5d4e8"],
          ["Window RO", "#dce8f5"],
          ["PT plate", "#5f9a6a"],
        ].map(([name, color]) => (
          <span key={name} className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm border border-black/20" style={{ background: color }} />
            {name}
          </span>
        ))}
      </div>
    </div>
  );
}

function studFace(framing) {
  return framing?.stud?.face || 1.5;
}
