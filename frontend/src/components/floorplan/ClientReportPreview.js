export default function ClientReportPreview({
  meta,
  scope,
  takeoffs,
  onClose,
  onGenerate,
  busy,
  pdfUrl,
  estimates = [],
  contracts = [],
  attach,
  onAttachChange,
}) {
  const totals = takeoffs?.totals || {};
  const cabinets = scope.cabinets || [];
  const appliances = scope.appliances || [];
  const doors = scope.doors || [];
  const windows = scope.windows || [];
  const finishes = scope.finishes || [];
  const notes = scope.notes || [];
  const special = scope.special_order || [];

  return (
    <div className="fixed inset-0 z-40 bg-[#061A23]/50 flex items-end sm:items-center justify-center p-3" data-testid="client-report-preview">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[92dvh] overflow-y-auto">
        <div className="bg-[#0A4D68] text-white px-4 py-3 flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-[0.16em] text-[#C9A227]">Revival Home Remodeling</div>
            <div className="font-['Outfit'] font-semibold text-lg">Design Proposal</div>
          </div>
          <button type="button" className="text-white/80 text-sm" onClick={onClose}>Close</button>
        </div>
        <div className="p-4 space-y-4 text-sm">
          <div className="border-b border-[#C9A227]/40 pb-3">
            <div className="font-['Outfit'] font-semibold text-[#0A4D68] text-lg">{meta.client_name || "Homeowner"}</div>
            <div className="text-[#4B6370]">{meta.address || "Address to be confirmed"}</div>
            <div className="text-xs text-[#8AA0AB]">{meta.project_type} · {(meta.version_kind || "existing") === "proposed" ? "Proposed" : "Existing"} · {new Date().toLocaleDateString()}</div>
          </div>
          <div className="grid grid-cols-4 gap-2 text-center">
            <div className="rounded-lg bg-[#F4F7F8] p-2"><div className="text-[10px] text-[#8AA0AB]">Floor</div><div className="font-semibold text-[#0A4D68]">{Number(totals.floor_sf || 0).toFixed(0)} SF</div></div>
            <div className="rounded-lg bg-[#F4F7F8] p-2"><div className="text-[10px] text-[#8AA0AB]">Cabinets</div><div className="font-semibold text-[#0A4D68]">{cabinets.length}</div></div>
            <div className="rounded-lg bg-[#F4F7F8] p-2"><div className="text-[10px] text-[#8AA0AB]">Openings</div><div className="font-semibold text-[#0A4D68]">{doors.length + windows.length}</div></div>
            <div className="rounded-lg bg-[#F4F7F8] p-2"><div className="text-[10px] text-[#8AA0AB]">Line items</div><div className="font-semibold text-[#0A4D68]">{scope.line_items?.length || 0}</div></div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-[#0A4D68] mb-1">The proposal includes</div>
            <ul className="text-xs text-[#4B6370] space-y-0.5 list-disc pl-4">
              <li>Cover page with your name, address, and project type</li>
              <li>Clean 2D plans and 3D views for each level</li>
              <li>Before / proposed comparison when demolition and new work are marked</li>
              <li>LVL and load-bearing notes, plus cabinet, appliance, door, window, lighting, and finish schedules</li>
              <li>Preliminary quantities ready to send to the estimate</li>
            </ul>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-[#0A4D68] mb-1">Preliminary quantities</div>
            <div className="space-y-1 max-h-36 overflow-y-auto">
              {(scope.line_items || []).slice(0, 16).map((row) => (
                <div key={row.description} className="flex justify-between text-xs text-[#4B6370]">
                  <span className="truncate pr-2">{row.description.replace("[Plan] ", "")}</span>
                  <span>{Number(row.quantity).toFixed(1)} {row.unit}</span>
                </div>
              ))}
            </div>
          </div>
          {cabinets.length ? (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-[#0A4D68] mb-1">Cabinet schedule</div>
              {cabinets.slice(0, 8).map((c) => (
                <div key={`${c.name}-${c.location}-${c.size}`} className="text-xs text-[#4B6370]">{c.name} · {c.size} · {c.location} · {c.finish}</div>
              ))}
            </div>
          ) : null}
          {appliances.length ? (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-[#0A4D68] mb-1">Appliances</div>
              {appliances.slice(0, 6).map((a) => (
                <div key={`${a.name}-${a.location}`} className="text-xs text-[#4B6370]">{a.name} · {a.location}{a.note ? ` · ${a.note}` : ""}</div>
              ))}
            </div>
          ) : null}
          {finishes.length ? (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-[#0A4D68] mb-1">Finishes</div>
              {finishes.slice(0, 8).map((f) => (
                <div key={`${f.location}-${f.item}`} className="text-xs text-[#4B6370]">{f.location} · {f.item} · {f.finish}</div>
              ))}
            </div>
          ) : null}
          {special.length ? (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-[#8A7018] mb-1">Special order / packages</div>
              {special.slice(0, 6).map((row) => (
                <div key={row.description} className="text-xs text-[#4B6370]">{row.description.replace("[Plan] ", "")} · {Number(row.quantity).toFixed(1)} {row.unit}</div>
              ))}
            </div>
          ) : null}
          {notes.length ? (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-[#0A4D68] mb-1">Notes &amp; selections</div>
              {notes.slice(0, 6).map((n) => (
                <div key={`${n.target}-${n.text}`} className="text-xs text-[#4B6370]">{n.target}: {n.text}</div>
              ))}
            </div>
          ) : null}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <div className="text-[11px] text-[#8AA0AB] mb-1">Attach to estimate</div>
              <select
                className="h-9 w-full rounded-md border border-slate-200 px-2 text-xs"
                value={attach?.estimate_id || ""}
                onChange={(e) => onAttachChange?.({ ...attach, estimate_id: e.target.value })}
                data-testid="report-attach-estimate"
              >
                <option value="">None — PDF only</option>
                {estimates.map((est) => (
                  <option key={est.id} value={est.id}>{est.estimate_number || est.id}</option>
                ))}
              </select>
            </div>
            <div>
              <div className="text-[11px] text-[#8AA0AB] mb-1">Attach to contract</div>
              <select
                className="h-9 w-full rounded-md border border-slate-200 px-2 text-xs"
                value={attach?.contract_id || ""}
                onChange={(e) => onAttachChange?.({ ...attach, contract_id: e.target.value })}
                data-testid="report-attach-contract"
              >
                <option value="">None — PDF only</option>
                {contracts.map((c) => (
                  <option key={c.id} value={c.id}>{c.contract_number || c.id}</option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-[11px] text-[#8B2E0E]">Structural sizes are preliminary and must be verified by a licensed engineer and the building official.</p>
          <p className="text-[11px] text-[#8AA0AB]">The PDF saves to the client’s Google Drive folder when Drive is connected. You can email, text, or present it in person.</p>
          {pdfUrl ? (
            <iframe title="Client report PDF" src={pdfUrl} className="w-full h-72 rounded-md border border-slate-200" />
          ) : null}
          <div className="flex gap-2">
            <button
              type="button"
              className="flex-1 h-11 rounded-md bg-[#0A4D68] text-white text-sm font-medium"
              onClick={onGenerate}
              disabled={busy}
              data-testid="generate-client-report-confirm"
            >
              {busy ? "Building PDF…" : pdfUrl ? "Download again" : "Generate PDF"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
