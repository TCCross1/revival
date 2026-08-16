import { useEffect } from "react";

export default function PermitDetailsPreview({
  preview,
  sheets,
  onSheetsChange,
  onClose,
  onGenerate,
  busy,
  pdfUrl,
}) {
  const data = preview || {};
  const opening = data.opening || {};
  const wanted = sheets || {};
  const toggle = (key) => onSheetsChange?.({ ...wanted, [key]: !wanted[key] });

  useEffect(() => {
    const next = preview?.sheets;
    if (!next) return;
    onSheetsChange?.({
      cover: true,
      wall: true,
      foundation: true,
      roof: Boolean(next.roof),
      beam: Boolean(next.beam),
    });
  }, [preview, onSheetsChange]);

  const items = [
    { id: "cover", label: "Cover / project data", always: true },
    { id: "wall", label: "Wall section", always: true },
    { id: "foundation", label: "Foundation / slab / footing", always: true },
    { id: "roof", label: "Roof framing / gable", always: false },
    { id: "beam", label: "Beam / header", always: false },
  ];

  return (
    <div className="fixed inset-0 z-40 bg-[#061A23]/50 flex items-end sm:items-center justify-center p-3" data-testid="permit-details-preview">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[92dvh] overflow-y-auto">
        <div className="bg-[#0A4D68] text-white px-4 py-3 flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-[0.16em] text-[#C9A227]">Permit set</div>
            <div className="font-['Outfit'] font-semibold text-lg">Generate Permit Details</div>
          </div>
          <button type="button" className="text-white/80 text-sm" onClick={onClose}>Close</button>
        </div>
        <div className="p-4 space-y-4 text-sm">
          <div className="border-b border-[#C9A227]/40 pb-3">
            <div className="font-['Outfit'] font-semibold text-[#0A4D68] text-lg">{data.project?.client_name || "Homeowner"}</div>
            <div className="text-[#4B6370]">{data.project?.address || "Address to be confirmed"}</div>
            <div className="text-xs text-[#8AA0AB]">{data.project?.project_type} · {data.project?.jurisdiction} · {data.project?.date}</div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
            <div className="rounded-lg bg-[#F4F7F8] p-2"><div className="text-[10px] text-[#8AA0AB]">Wall</div><div className="font-semibold text-[#0A4D68]">{data.wall_height || "—"}</div></div>
            <div className="rounded-lg bg-[#F4F7F8] p-2"><div className="text-[10px] text-[#8AA0AB]">Foundation</div><div className="font-semibold text-[#0A4D68] text-[12px] leading-tight">{data.foundation || "—"}</div></div>
            <div className="rounded-lg bg-[#F4F7F8] p-2"><div className="text-[10px] text-[#8AA0AB]">Roof</div><div className="font-semibold text-[#0A4D68]">{data.roof_pitch || "—"}</div></div>
            <div className="rounded-lg bg-[#F4F7F8] p-2"><div className="text-[10px] text-[#8AA0AB]">Beams</div><div className="font-semibold text-[#0A4D68]">{data.beam_count ?? 0}</div></div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-[#4B6370] space-y-1">
            <div><span className="font-medium text-[#061A23]">Studs:</span> {data.stud || "—"} · {data.insulation || ""}</div>
            <div><span className="font-medium text-[#061A23]">Opening:</span> {(opening.type || "window").toUpperCase()} {opening.size || ""} · {opening.header || ""}</div>
            <div><span className="font-medium text-[#061A23]">Footing:</span> {data.footing || "16\" x 24\""} typical Central Kentucky</div>
            <div><span className="font-medium text-[#061A23]">Code:</span> {data.project?.code || "2018 Kentucky Residential Code"}</div>
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-[#0A4D68] mb-2">Sheets to include</div>
            <div className="space-y-1.5">
              {items.map((item) => (
                <label key={item.id} className="flex items-center gap-2 text-sm text-[#061A23]">
                  <input
                    type="checkbox"
                    checked={Boolean(wanted[item.id])}
                    disabled={item.always}
                    onChange={() => toggle(item.id)}
                    data-testid={`permit-sheet-${item.id}`}
                  />
                  <span>{item.label}{item.always ? " (required)" : ""}</span>
                </label>
              ))}
            </div>
          </div>

          <p className="text-[11px] text-[#8B2E0E]">{data.disclaimer}</p>
          <p className="text-[11px] text-[#8AA0AB]">The PDF downloads immediately and saves to the client’s Google Drive → Permit Details folder when Drive is connected.</p>

          {pdfUrl ? (
            <iframe title="Permit details PDF" src={pdfUrl} className="w-full h-72 rounded-md border border-slate-200" />
          ) : null}

          <button
            type="button"
            className="w-full h-11 rounded-md bg-[#0A4D68] text-white text-sm font-medium"
            onClick={onGenerate}
            disabled={busy}
            data-testid="generate-permit-details-confirm"
          >
            {busy ? "Building permit set…" : pdfUrl ? "Download again" : "Generate PDF"}
          </button>
        </div>
      </div>
    </div>
  );
}
