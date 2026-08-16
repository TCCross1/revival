import { useMemo } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import { usd, usdCents } from "@/lib/format";
import StatusBadge from "@/components/StatusBadge";
import JobFieldOps from "@/components/JobFieldOps";
import ClientDriveCard from "@/components/ClientDriveCard";
import JobSheet from "@/pages/JobSheet";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft, ClipboardList, FileSignature, FileText, HardHat,
  PenTool, Receipt, CheckSquare, Presentation,
} from "lucide-react";

const ROOMS = [
  { id: "overview", label: "Overview" },
  { id: "design", label: "Design" },
  { id: "scope", label: "Scope" },
  { id: "money", label: "Money" },
  { id: "crew", label: "Crew" },
  { id: "docs", label: "Docs" },
  { id: "closeout", label: "Closeout" },
];

export default function JobWorkspace() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const room = ROOMS.some((r) => r.id === params.get("room")) ? params.get("room") : "overview";

  const { data, isLoading, isError } = useQuery({
    queryKey: ["job-workspace", id],
    enabled: Boolean(id),
    queryFn: async () => (await api.get(`/jobs/${id}/workspace`)).data,
  });

  const setRoom = (next) => {
    const copy = new URLSearchParams(params);
    if (next === "overview") copy.delete("room");
    else copy.set("room", next);
    setParams(copy, { replace: true });
  };

  const job = data?.job;
  const totals = data?.totals;
  const plans = useMemo(() => data?.plans || [], [data?.plans]);
  const lineItems = useMemo(
    () => plans.flatMap((plan) => (plan.scope?.line_items || []).map((row) => ({ ...row, plan_name: plan.name }))),
    [plans],
  );
  const pricedTotal = Number(data?.priced_total || 0);

  if (isLoading) return <div className="text-[#4B6370]" data-testid="job-workspace-loading">Loading the job…</div>;
  if (isError || !data) return <div className="text-[#4B6370]">This job could not be found.</div>;

  return (
    <div className="space-y-5" data-testid="job-workspace">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <button type="button" onClick={() => navigate("/jobs")} className="flex items-center gap-1.5 text-sm font-medium text-[#0A4D68] hover:underline" data-testid="workspace-back">
            <ArrowLeft size={16} /> Jobs
          </button>
          <h1 className="mt-2 text-2xl sm:text-4xl font-semibold font-['Outfit'] tracking-tight text-[#061A23]">
            {job?.name || "Job"}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-[#4B6370]">
            <span className="font-medium text-[#0A4D68]">{job?.job_number}</span>
            <span>{job?.client_name}</span>
            <StatusBadge status={job?.status} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" className="h-10 border-[#0A4D68]/25 text-[#0A4D68]" onClick={() => navigate(`/floor-plans/new?job=${id}`)} data-testid="workspace-new-plan">
            <PenTool size={16} className="mr-1" /> New plan
          </Button>
          <Button type="button" className="h-10 bg-[#0A4D68] hover:bg-[#083D53]" onClick={() => setRoom("money")} data-testid="workspace-open-money">
            <ClipboardList size={16} className="mr-1" /> Job sheet
          </Button>
        </div>
      </div>

      <nav className="sticky top-16 z-20 -mx-4 sm:mx-0 px-4 sm:px-0 bg-[#F4F7F8]/95 backdrop-blur border-b border-slate-200 sm:border-0 sm:bg-transparent sm:static">
        <div className="flex gap-1 overflow-x-auto py-2 sm:py-0" data-testid="workspace-rooms">
          {ROOMS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setRoom(item.id)}
              data-testid={`workspace-room-${item.id}`}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium ${
                room === item.id ? "bg-[#0A4D68] text-white" : "bg-white border border-slate-200 text-[#4B6370]"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </nav>

      {room === "overview" ? (
        <OverviewRoom data={data} pricedTotal={pricedTotal} onRoom={setRoom} navigate={navigate} jobId={id} />
      ) : null}
      {room === "design" ? <DesignRoom plans={plans} jobId={id} navigate={navigate} /> : null}
      {room === "scope" ? <ScopeRoom lineItems={lineItems} pricedTotal={pricedTotal} plans={plans} /> : null}
      {room === "money" ? <JobSheet embedded /> : null}
      {room === "crew" ? <JobFieldOps jobId={id} job={job} /> : null}
      {room === "docs" ? (
        <DocsRoom data={data} jobId={id} navigate={navigate} />
      ) : null}
      {room === "closeout" ? <CloseoutRoom data={data} totals={totals} onRoom={setRoom} /> : null}
    </div>
  );
}

function OverviewRoom({ data, pricedTotal, onRoom, navigate, jobId }) {
  const job = data.job;
  const totals = data.totals || {};
  const plans = data.plans || [];
  const estimate = (data.estimates || [])[0];
  return (
    <div className="space-y-4" data-testid="workspace-overview">
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Budget" value={usdCents(totals.budget)} gold />
        <StatCard label="Actual" value={usdCents(totals.actual)} />
        <StatCard label="Remaining" value={usdCents(totals.remaining)} warn={Number(totals.remaining) < 0} />
        <StatCard label="Plan takeoff" value={usd(pricedTotal)} hint={plans.length ? `${plans.length} plan${plans.length === 1 ? "" : "s"}` : "No plan yet"} />
      </section>
      <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <button type="button" onClick={() => onRoom("design")} className="text-left rounded-2xl border border-slate-200 bg-white p-5 hover:border-[#0A4D68]/40">
          <div className="flex items-center gap-2 text-[#0A4D68] font-semibold font-['Outfit']"><PenTool size={16} /> Design</div>
          <p className="mt-1 text-sm text-[#4B6370]">{plans[0] ? plans[0].name : "Draw the kitchen, then send priced quantities to the estimate."}</p>
        </button>
        <button type="button" onClick={() => onRoom("scope")} className="text-left rounded-2xl border border-slate-200 bg-white p-5 hover:border-[#0A4D68]/40">
          <div className="flex items-center gap-2 text-[#0A4D68] font-semibold font-['Outfit']"><FileText size={16} /> Scope</div>
          <p className="mt-1 text-sm text-[#4B6370]">{pricedTotal ? `${usd(pricedTotal)} shop catalog on the takeoff` : "Prices land here after you place cabinets and tops."}</p>
        </button>
        <button type="button" onClick={() => onRoom("money")} className="text-left rounded-2xl border border-slate-200 bg-white p-5 hover:border-[#0A4D68]/40">
          <div className="flex items-center gap-2 text-[#0A4D68] font-semibold font-['Outfit']"><ClipboardList size={16} /> Money</div>
          <p className="mt-1 text-sm text-[#4B6370]">{estimate ? `${estimate.number} · ${usd(estimate.total)}` : "Job sheet, estimate, and what the client is paying."}</p>
        </button>
        <button type="button" onClick={() => onRoom("crew")} className="text-left rounded-2xl border border-slate-200 bg-white p-5 hover:border-[#0A4D68]/40">
          <div className="flex items-center gap-2 text-[#0A4D68] font-semibold font-['Outfit']"><HardHat size={16} /> Crew</div>
          <p className="mt-1 text-sm text-[#4B6370]">{data.open_tasks ? `${data.open_tasks} open task${data.open_tasks === 1 ? "" : "s"}` : "Assign crew, fence the site, and watch the clock."}</p>
        </button>
      </section>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" className="border-[#0A4D68]/25 text-[#0A4D68]" onClick={() => navigate(`/field/jobs/${jobId}`)}>Open field view</Button>
        {job?.client_id ? (
          <Button type="button" variant="outline" className="border-[#0A4D68]/25 text-[#0A4D68]" onClick={() => navigate(`/clients/${job.client_id}`)}>Client file</Button>
        ) : null}
      </div>
    </div>
  );
}

function DesignRoom({ plans, jobId, navigate }) {
  return (
    <div className="space-y-3" data-testid="workspace-design">
      {plans.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#0A4D68]/30 bg-white p-8 text-center">
          <PenTool className="mx-auto text-[#C9A227]" size={28} />
          <p className="mt-2 text-[#4B6370]">No floor plan on this job yet.</p>
          <Button type="button" className="mt-3 bg-[#0A4D68] hover:bg-[#083D53]" onClick={() => navigate(`/floor-plans/new?job=${jobId}`)}>Start a plan</Button>
        </div>
      ) : plans.map((plan) => (
        <div key={plan.id} className="rounded-2xl border border-slate-200 bg-white p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="font-['Outfit'] font-semibold text-[#061A23]">{plan.name}</div>
            <div className="text-sm text-[#4B6370]">{plan.version_kind === "proposed" ? "Proposed" : "Existing"} · {plan.level_count} level{plan.level_count === 1 ? "" : "s"} · {usd(plan.priced_total)}</div>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="border-[#0A4D68]/25 text-[#0A4D68]" onClick={() => navigate(`/floor-plans/${plan.id}`)}>Edit</Button>
            <Button type="button" className="bg-[#0A4D68] hover:bg-[#083D53] gap-1" onClick={() => navigate(`/floor-plans/${plan.id}?present=1`)} data-testid={`present-plan-${plan.id}`}>
              <Presentation size={14} /> Present
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function ScopeRoom({ lineItems, pricedTotal, plans }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden" data-testid="workspace-scope">
      <div className="px-4 py-3 bg-[#0A4D68] flex items-center justify-between">
        <h2 className="text-white font-['Outfit'] font-semibold">Priced takeoff</h2>
        <span className="text-[#C9A227] font-semibold">{usd(pricedTotal)}</span>
      </div>
      {lineItems.length === 0 ? (
        <div className="p-6 text-sm text-[#4B6370]">{plans.length ? "This plan does not have rooms or objects yet." : "Link a floor plan to price cabinets, tops, and openings."}</div>
      ) : (
        <div className="divide-y divide-slate-100">
          {lineItems.map((row, idx) => (
            <div key={`${row.description}-${idx}`} className="grid grid-cols-[1fr_auto_auto] gap-3 px-4 py-2.5 text-sm">
              <div className="min-w-0">
                <div className="font-medium truncate">{row.description}</div>
                <div className="text-[11px] text-[#8AA0AB]">{row.group} · {row.plan_name}</div>
              </div>
              <div className="text-[#4B6370] whitespace-nowrap">{row.quantity} {row.unit}</div>
              <div className="font-['Outfit'] font-semibold text-right">{usdCents(row.amount || (Number(row.quantity || 0) * Number(row.unit_price || 0)))}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DocsRoom({ data, jobId, navigate }) {
  return (
    <div className="space-y-4" data-testid="workspace-docs">
      <ClientDriveCard
        drive={data.drive}
        clientId={data.job?.client_id || data.sheet?.client_id || ""}
        jobId={jobId}
      />
      <DocList title="Estimates" icon={FileText} rows={data.estimates} empty="No estimate on this job yet." onOpen={() => navigate("/estimates")} />
      <DocList title="Invoices" icon={Receipt} rows={data.invoices} empty="No invoice yet." onOpen={() => navigate("/invoices")} />
      <DocList title="Contracts" icon={FileSignature} rows={data.contracts} empty="No contract yet." onOpen={() => navigate("/contracts")} />
    </div>
  );
}

function CloseoutRoom({ data, totals, onRoom }) {
  const tasks = data.tasks || [];
  const open = tasks.filter((t) => (t.status || "open") !== "done");
  const remaining = Number(totals?.remaining || 0);
  return (
    <div className="space-y-4" data-testid="workspace-closeout">
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-['Outfit'] font-semibold text-[#0A4D68]">Ready to close?</h2>
        <ul className="mt-3 space-y-2 text-sm text-[#4B6370]">
          <li>{open.length === 0 ? "All punch items are checked." : `${open.length} punch item${open.length === 1 ? "" : "s"} still open.`}</li>
          <li>{remaining <= 0 ? "Budget is spent or over — review Money before you close." : `${usdCents(remaining)} left in the job budget.`}</li>
          <li>{(data.invoices || []).length ? "Invoice is on file." : "No invoice yet — generate one from the won estimate."}</li>
        </ul>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" variant="outline" className="border-[#0A4D68]/25 text-[#0A4D68]" onClick={() => onRoom("crew")}>
            <CheckSquare size={14} className="mr-1" /> Punch list
          </Button>
          <Button type="button" className="bg-[#0A4D68] hover:bg-[#083D53]" onClick={() => onRoom("money")}>Review money</Button>
        </div>
      </section>
    </div>
  );
}

function StatCard({ label, value, gold, warn, hint }) {
  return (
    <div className={`rounded-2xl border bg-white p-4 ${gold ? "border-[#C9A227]/45" : "border-slate-200"}`}>
      <div className={`text-[11px] uppercase tracking-wide font-semibold ${gold ? "text-[#C9A227]" : "text-[#0A4D68]"}`}>{label}</div>
      <div className={`mt-1 font-['Outfit'] text-2xl font-semibold ${warn ? "text-red-600" : "text-[#061A23]"}`}>{value}</div>
      {hint ? <div className="text-[11px] text-[#8AA0AB] mt-0.5">{hint}</div> : null}
    </div>
  );
}

function DocList({ title, icon: Icon, rows, empty, onOpen }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
      <div className="px-4 py-3 bg-[#0A4D68] flex items-center justify-between">
        <h2 className="text-white font-['Outfit'] font-semibold flex items-center gap-2"><Icon size={16} /> {title}</h2>
        <button type="button" onClick={onOpen} className="text-[#C9A227] text-xs">Open list</button>
      </div>
      {(rows || []).length === 0 ? (
        <div className="p-4 text-sm text-[#4B6370]">{empty}</div>
      ) : (rows || []).map((row) => (
        <div key={row.id} className="flex items-center justify-between px-4 py-2.5 border-t border-slate-100 text-sm">
          <div>
            <div className="font-medium">{row.number || title}</div>
            <div className="text-[11px] text-[#8AA0AB]">{row.status}</div>
          </div>
          <div className="font-['Outfit'] font-semibold">{usd(row.total)}</div>
        </div>
      ))}
    </section>
  );
}
