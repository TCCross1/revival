import { Button } from "@/components/ui/button";
import { ELEC_DISCLAIMER } from "@/lib/floorPlan/electricalDesign";

export default function ElectricianAdvice({ advice, report, onComplete, completing }) {
  const circuits = report?.circuits || [];
  const warnings = report?.warnings || advice?.warnings || [];
  return (
    <div className="rounded-lg border border-[#0B3A8F]/20 bg-[#F4F7F8] p-2 space-y-2" data-testid="electrician-panel">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-[#0B3A8F]">AI Electrician · Kentucky</div>
      {advice ? (
        <>
          <div className="text-sm font-medium">
            {advice.circuit_id ? `${advice.circuit_id} · ` : ""}{advice.circuit} · {advice.amps}A / {advice.volts}V
          </div>
          <div className="text-xs">{advice.wire}{advice.dedicated ? " · dedicated" : ""}{advice.awg ? ` · ${advice.awg} AWG Cu` : ""}</div>
          <div className="flex flex-wrap gap-1">
            {(advice.colors || []).map((c) => (
              <span key={c.role} className="text-[10px] rounded-full px-2 py-0.5 border border-slate-200" style={{ background: c.color, color: c.role === "white" || c.role === "ground" ? "#061A23" : "#fff" }}>{c.name}</span>
            ))}
          </div>
          <p className="text-[11px] text-[#4B6370]">{advice.home_run}</p>
          {advice.gfci === true ? <p className="text-[11px] font-medium text-[#0B3A8F]">GFCI required</p> : null}
          {advice.afci ? <p className="text-[11px] font-medium text-[#0B3A8F]">AFCI at the breaker</p> : null}
          {advice.tamper_resistant ? <p className="text-[11px] text-[#0B3A8F]">Tamper-resistant dwelling receptacle</p> : null}
          {advice.weather_resistant ? <p className="text-[11px] text-[#0B3A8F]">Weather-resistant (damp/wet)</p> : null}
        </>
      ) : (
        <p className="text-[11px] text-[#4B6370]">Place lights and appliances, then complete the electrical design. The engine sizes circuits, places required devices, and builds a panel schedule.</p>
      )}
      {typeof onComplete === "function" ? (
        <Button
          type="button"
          size="sm"
          className="h-8 w-full text-xs bg-[#C9A227] hover:bg-[#B8911F] text-[#061A23]"
          disabled={completing}
          onClick={onComplete}
          data-testid="complete-electrical-btn"
        >
          {completing ? "Designing…" : "Complete electrical design"}
        </Button>
      ) : null}
      {(warnings || []).length ? (
        <div className="space-y-1">
          {(warnings || []).slice(0, 8).map((w) => (
            <p key={typeof w === "string" ? w : w.text} className="text-[11px] text-[#8B2E0E]">• {typeof w === "string" ? w : w.text}</p>
          ))}
        </div>
      ) : null}
      {circuits.length ? (
        <div className="overflow-x-auto rounded-md border border-slate-200 bg-white" data-testid="panel-schedule">
          <table className="w-full text-[10px] min-w-[280px]">
            <thead>
              <tr className="bg-[#0B3A8F] text-white text-left">
                <th className="p-1.5">Brk</th>
                <th className="p-1.5">A</th>
                <th className="p-1.5">Circuit</th>
                <th className="p-1.5">Wire</th>
                <th className="p-1.5">Prot.</th>
              </tr>
            </thead>
            <tbody>
              {circuits.map((c) => (
                <tr key={c.id} className={`border-t border-slate-100 ${c.overloaded ? "bg-red-50" : ""}`}>
                  <td className="p-1.5 font-semibold">{c.breaker}{c.poles === 2 ? "–" + (c.breaker + 1) : ""}</td>
                  <td className="p-1.5">{c.amps}</td>
                  <td className="p-1.5">{c.description}</td>
                  <td className="p-1.5 whitespace-nowrap">{c.cable}</td>
                  <td className="p-1.5">{c.protection}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {(report?.instructions || []).slice(0, 4).map((row) => (
        <div key={row.circuit_id} className="text-[10px] text-[#4B6370]">
          <div className="font-semibold text-[#0B3A8F]">{row.title}</div>
          {(row.body || []).map((line) => <p key={line}>{line}</p>)}
        </div>
      ))}
      {report?.instructions?.length > 4 ? (
        <p className="text-[10px] text-[#8AA0AB]">{report.instructions.length - 4} more home-run notes in the panel schedule above.</p>
      ) : null}
      <p className="text-[10px] text-[#8AA0AB]">{advice?.disclaimer || report?.disclaimer || ELEC_DISCLAIMER}</p>
    </div>
  );
}
