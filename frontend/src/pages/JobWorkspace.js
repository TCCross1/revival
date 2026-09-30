import { useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api, { formatApiError } from "@/lib/api";
import { usd, usdCents } from "@/lib/format";
import StatusBadge from "@/components/StatusBadge";
import JobFieldOps from "@/components/JobFieldOps";
import ClientDriveCard from "@/components/ClientDriveCard";
import JobSiteMediaCard from "@/components/JobSiteMediaCard";
import JobSheet from "@/pages/JobSheet";
import JobFundsCard from "@/components/JobFundsCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  ArrowLeft, ClipboardList, FileSignature, FileText, HardHat,
  PenTool, Receipt, CheckSquare, Presentation, ScanLine, Gavel,
} from "lucide-react";
import { scanKitchenPath } from "@/lib/floorPlan/roomplan";

const ROOMS = [
  { id: "overview", label: "Overview" },
  { id: "design", label: "Design" },
  { id: "scope", label: "Scope" },
  { id: "bids", label: "Bids" },
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
          <button type="button" onClick={() => navigate("/jobs")} className="flex items-center gap-1.5 text-sm font-medium text-[#0B3A8F] hover:underline" data-testid="workspace-back">
            <ArrowLeft size={16} /> Jobs
          </button>
          <h1 className="mt-2 text-2xl sm:text-4xl font-semibold font-['Outfit'] tracking-tight text-[#061A23]">
            {job?.name || "Job"}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-[#4B6370]">
            <span className="font-medium text-[#0B3A8F]">{job?.job_number}</span>
            <span>{job?.client_name}</span>
            <StatusBadge status={job?.status} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" className="h-10 bg-[#C9A227] hover:bg-[#B8911F] text-[#061A23]" onClick={() => navigate(scanKitchenPath(id, plans))} data-testid="workspace-scan-kitchen">
            <ScanLine size={16} className="mr-1" /> Scan room
          </Button>
          <Button type="button" variant="outline" className="h-10 border-[#0B3A8F]/25 text-[#0B3A8F]" onClick={() => navigate(`/floor-plans/new?job=${id}`)} data-testid="workspace-new-plan">
            <PenTool size={16} className="mr-1" /> New plan
          </Button>
          <Button type="button" className="h-10 bg-[#0B3A8F] hover:bg-[#082C73]" onClick={() => setRoom("money")} data-testid="workspace-open-money">
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
                room === item.id ? "bg-[#0B3A8F] text-white" : "bg-white border border-slate-200 text-[#4B6370]"
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
      {room === "bids" ? <BidsRoom jobId={id} job={job} navigate={navigate} drive={data.drive} /> : null}
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
      <JobFundsCard jobId={jobId} />
      <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <button type="button" onClick={() => onRoom("design")} className="text-left rounded-2xl border border-slate-200 bg-white p-5 hover:border-[#0B3A8F]/40">
          <div className="flex items-center gap-2 text-[#0B3A8F] font-semibold font-['Outfit']"><PenTool size={16} /> Design</div>
          <p className="mt-1 text-sm text-[#4B6370]">{plans[0] ? plans[0].name : "Draw the kitchen, then send priced quantities to the estimate."}</p>
        </button>
        <button type="button" onClick={() => onRoom("scope")} className="text-left rounded-2xl border border-slate-200 bg-white p-5 hover:border-[#0B3A8F]/40">
          <div className="flex items-center gap-2 text-[#0B3A8F] font-semibold font-['Outfit']"><FileText size={16} /> Scope</div>
          <p className="mt-1 text-sm text-[#4B6370]">{pricedTotal ? `${usd(pricedTotal)} shop catalog on the takeoff` : "Prices land here after you place cabinets and tops."}</p>
        </button>
        <button type="button" onClick={() => onRoom("money")} className="text-left rounded-2xl border border-slate-200 bg-white p-5 hover:border-[#0B3A8F]/40">
          <div className="flex items-center gap-2 text-[#0B3A8F] font-semibold font-['Outfit']"><ClipboardList size={16} /> Money</div>
          <p className="mt-1 text-sm text-[#4B6370]">{estimate ? `${estimate.number} · ${usd(estimate.total)}` : "Job sheet, estimate, and what the client is paying."}</p>
        </button>
        <button type="button" onClick={() => onRoom("crew")} className="text-left rounded-2xl border border-slate-200 bg-white p-5 hover:border-[#0B3A8F]/40">
          <div className="flex items-center gap-2 text-[#0B3A8F] font-semibold font-['Outfit']"><HardHat size={16} /> Crew</div>
          <p className="mt-1 text-sm text-[#4B6370]">{data.open_tasks ? `${data.open_tasks} open task${data.open_tasks === 1 ? "" : "s"}` : "Assign crew, fence the site, and watch the clock."}</p>
        </button>
        <button type="button" onClick={() => onRoom("bids")} className="text-left rounded-2xl border border-slate-200 bg-white p-5 hover:border-[#0B3A8F]/40">
          <div className="flex items-center gap-2 text-[#0B3A8F] font-semibold font-['Outfit']"><Gavel size={16} /> Bids</div>
          <p className="mt-1 text-sm text-[#4B6370]">Create a bid package with this job’s floor plans, 3D views, and photos — then invite trades.</p>
        </button>
      </section>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" className="border-[#0B3A8F]/25 text-[#0B3A8F]" onClick={() => navigate(`/field/jobs/${jobId}`)}>Open field view</Button>
        {job?.client_id ? (
          <Button type="button" variant="outline" className="border-[#0B3A8F]/25 text-[#0B3A8F]" onClick={() => navigate(`/clients/${job.client_id}`)}>Client file</Button>
        ) : null}
      </div>
    </div>
  );
}

function DesignRoom({ plans, jobId, navigate }) {
  return (
    <div className="space-y-3" data-testid="workspace-design">
      <Button type="button" className="h-11 w-full sm:w-auto bg-[#C9A227] hover:bg-[#B8911F] text-[#061A23]" onClick={() => navigate(scanKitchenPath(jobId, plans))} data-testid="design-scan-kitchen">
        <ScanLine size={16} className="mr-1" /> Scan room
      </Button>
      {plans.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#0B3A8F]/30 bg-white p-8 text-center">
          <PenTool className="mx-auto text-[#C9A227]" size={28} />
          <p className="mt-2 text-[#4B6370]">No floor plan on this job yet. Scan the kitchen on iPhone, or start a blank plan.</p>
          <Button type="button" className="mt-3 bg-[#0B3A8F] hover:bg-[#082C73]" onClick={() => navigate(`/floor-plans/new?job=${jobId}`)}>Start a plan</Button>
        </div>
      ) : plans.map((plan) => (
        <div key={plan.id} className="rounded-2xl border border-slate-200 bg-white p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="font-['Outfit'] font-semibold text-[#061A23]">{plan.name}</div>
            <div className="text-sm text-[#4B6370]">{plan.version_kind === "proposed" ? "Proposed" : "Existing"} · {plan.level_count} level{plan.level_count === 1 ? "" : "s"} · {usd(plan.priced_total)}</div>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="border-[#0B3A8F]/25 text-[#0B3A8F]" onClick={() => navigate(`/floor-plans/${plan.id}?scan=1`)}>Scan</Button>
            <Button type="button" variant="outline" className="border-[#0B3A8F]/25 text-[#0B3A8F]" onClick={() => navigate(`/floor-plans/${plan.id}`)}>Edit</Button>
            <Button type="button" className="bg-[#0B3A8F] hover:bg-[#082C73] gap-1" onClick={() => navigate(`/floor-plans/${plan.id}?present=1`)} data-testid={`present-plan-${plan.id}`}>
              <Presentation size={14} /> Present
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function BidsRoom({ jobId, job, navigate }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: "", scope: "Entire job", due_at: "", description: "" });

  const { data: meta } = useQuery({
    queryKey: ["sub-meta"],
    queryFn: async () => (await api.get("/subcontractor-meta")).data,
  });
  const { data: packages = [], isLoading } = useQuery({
    queryKey: ["job-bid-packages", jobId],
    enabled: Boolean(jobId),
    refetchInterval: 4000,
    queryFn: async () => (await api.get(`/jobs/${jobId}/bid-packages`)).data,
  });

  const create = useMutation({
    mutationFn: async () => (await api.post("/bid-packages", {
      job_id: jobId,
      name: form.name,
      scope: form.scope,
      due_at: form.due_at,
      description: form.description,
      pull_assets: true,
    })).data,
    onSuccess: (doc) => {
      qc.invalidateQueries({ queryKey: ["job-bid-packages", jobId] });
      toast.success("Bid package created with this job’s plans and files.");
      navigate(`/bid-packages/${doc.id}`);
    },
    onError: async (err) => toast.error(await formatApiError(err, "Could not create that bid package.")),
  });

  const scopes = meta?.scopes || ["Entire job"];
  const onScope = (scope) => {
    const template = meta?.templates?.[scope] || form.description;
    setForm((prev) => ({
      ...prev,
      scope,
      description: prev.description && prev.description !== (meta?.templates?.[prev.scope] || "") ? prev.description : template,
    }));
  };

  return (
    <div className="space-y-4" data-testid="workspace-bids">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-['Outfit'] font-semibold text-[#0B3A8F]">Create a bid package</h2>
        <p className="mt-1 text-sm text-[#4B6370]">
          Floor Plan Studio drawings and 3D views for {job?.job_number || "this job"} are attached automatically. Add job-site photos and videos next.
        </p>
        <div className="mt-4 grid sm:grid-cols-2 gap-3">
          <div>
            <Label>Scope</Label>
            <select
              className="h-10 w-full rounded-md border border-slate-200 px-2 text-sm bg-white"
              value={form.scope}
              onChange={(e) => onScope(e.target.value)}
              data-testid="bid-scope"
            >
              {scopes.map((scope) => (
                <option key={scope} value={scope}>{scope}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>Due date</Label>
            <Input type="datetime-local" value={form.due_at} onChange={(e) => setForm({ ...form, due_at: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <Label>Package name</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={`${job?.name || "Job"} · ${form.scope}`} />
          </div>
          <div className="sm:col-span-2">
            <Label>Scope notes</Label>
            <textarea
              className="mt-1 w-full min-h-[88px] rounded-md border border-slate-200 px-3 py-2 text-sm"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="What the trade should bid, plus any exclusions."
            />
          </div>
        </div>
        <Button type="button" className="mt-4 bg-[#C9A227] hover:bg-[#B8911F] text-[#061A23]" disabled={create.isPending} onClick={() => create.mutate()} data-testid="create-bid-package">
          Create package & pull assets
        </Button>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
        <div className="px-4 py-3 bg-[#0B3A8F] text-white font-['Outfit'] font-semibold">Packages on this job</div>
        {isLoading ? (
          <div className="p-5 text-sm text-[#4B6370]">Loading packages…</div>
        ) : packages.length === 0 ? (
          <div className="p-8 text-center text-[#4B6370]">
            <Gavel className="mx-auto text-[#C9A227]" size={28} />
            <p className="mt-2">No bid packages yet. Create one for the whole job or a single trade.</p>
          </div>
        ) : packages.map((pkg) => (
          <button
            key={pkg.id}
            type="button"
            onClick={() => navigate(`/bid-packages/${pkg.id}`)}
            className="w-full text-left px-4 py-3 border-t border-slate-100 hover:bg-[#F4F7F8]"
            data-testid={`bid-package-${pkg.id}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-['Outfit'] font-semibold text-[#061A23]">{pkg.name}</span>
              <span className="rounded-full bg-[#F4F7F8] px-2 py-0.5 text-[11px] text-[#0B3A8F]">{pkg.scope}</span>
              <span className="text-[11px] uppercase tracking-wide text-[#8AA0AB]">{pkg.status}</span>
            </div>
            <div className="mt-1 text-sm text-[#4B6370]">
              {pkg.invite_count || 0} invited · {pkg.bid_count || 0} bid{pkg.bid_count === 1 ? "" : "s"}
              {pkg.unanswered ? ` · ${pkg.unanswered} unanswered` : ""}
              {pkg.due_at ? ` · due ${new Date(pkg.due_at).toLocaleString()}` : ""}
            </div>
          </button>
        ))}
      </section>
    </div>
  );
}

function ScopeRoom({ lineItems, pricedTotal, plans }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden" data-testid="workspace-scope">
      <div className="px-4 py-3 bg-[#0B3A8F] flex items-center justify-between">
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
  const qc = useQueryClient();
  const clientId = data.job?.client_id || data.sheet?.client_id || "";
  const refreshDrive = () => {
    qc.invalidateQueries({ queryKey: ["job-workspace", jobId] });
  };
  return (
    <div className="space-y-4" data-testid="workspace-docs">
      <JobSiteMediaCard
        jobId={jobId}
        clientId={clientId}
        drive={data.drive}
        onRefresh={refreshDrive}
      />
      <ClientDriveCard
        drive={data.drive}
        clientId={clientId}
        jobId={jobId}
        onRefresh={refreshDrive}
      />
      <DocList title="Estimates" icon={FileText} rows={data.estimates} empty="No estimate on this job yet." onOpen={() => navigate("/estimates")} />
      <DocList title="Invoices" icon={Receipt} rows={data.invoices} empty="No invoice yet." onOpen={() => navigate("/invoices")} />
      <DocList title="Contracts" icon={FileSignature} rows={data.contracts} empty="No contract yet." onOpen={() => navigate("/contracts")} />
      <BidPdfList files={(data.drive?.files || []).filter((row) => row.kind === "bid_pdf")} onOpen={() => navigate(`/jobs/${jobId}?room=bids`)} />
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
        <h2 className="font-['Outfit'] font-semibold text-[#0B3A8F]">Ready to close?</h2>
        <ul className="mt-3 space-y-2 text-sm text-[#4B6370]">
          <li>{open.length === 0 ? "All punch items are checked." : `${open.length} punch item${open.length === 1 ? "" : "s"} still open.`}</li>
          <li>{remaining <= 0 ? "Budget is spent or over — review Money before you close." : `${usdCents(remaining)} left in the job budget.`}</li>
          <li>{(data.invoices || []).length ? "Invoice is on file." : "No invoice yet — generate one from the won estimate."}</li>
        </ul>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" variant="outline" className="border-[#0B3A8F]/25 text-[#0B3A8F]" onClick={() => onRoom("crew")}>
            <CheckSquare size={14} className="mr-1" /> Punch list
          </Button>
          <Button type="button" className="bg-[#0B3A8F] hover:bg-[#082C73]" onClick={() => onRoom("money")}>Review money</Button>
        </div>
      </section>
    </div>
  );
}

function StatCard({ label, value, gold, warn, hint }) {
  return (
    <div className={`rounded-2xl border bg-white p-4 ${gold ? "border-[#C9A227]/45" : "border-slate-200"}`}>
      <div className={`text-[11px] uppercase tracking-wide font-semibold ${gold ? "text-[#C9A227]" : "text-[#0B3A8F]"}`}>{label}</div>
      <div className={`mt-1 font-['Outfit'] text-2xl font-semibold ${warn ? "text-red-600" : "text-[#061A23]"}`}>{value}</div>
      {hint ? <div className="text-[11px] text-[#8AA0AB] mt-0.5">{hint}</div> : null}
    </div>
  );
}

function DocList({ title, icon: Icon, rows, empty, onOpen }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
      <div className="px-4 py-3 bg-[#0B3A8F] flex items-center justify-between">
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

function BidPdfList({ files, onOpen }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
      <div className="px-4 py-3 bg-[#0B3A8F] flex items-center justify-between">
        <h2 className="text-white font-['Outfit'] font-semibold flex items-center gap-2"><Gavel size={16} /> Bid PDFs</h2>
        <button type="button" onClick={onOpen} className="text-[#C9A227] text-xs">Open bids</button>
      </div>
      {(files || []).length === 0 ? (
        <div className="p-4 text-sm text-[#4B6370]">Official subcontractor bid PDFs land here and in the job’s Google Drive Bid Packages folder.</div>
      ) : files.map((row) => (
        <div key={row.id} className="flex items-center justify-between px-4 py-2.5 border-t border-slate-100 text-sm">
          <div className="min-w-0">
            <div className="font-medium truncate">{row.filename || "Bid PDF"}</div>
            <div className="text-[11px] text-[#8AA0AB]">{row.kind} {row.uploaded_at ? `· ${new Date(row.uploaded_at).toLocaleString()}` : ""}</div>
          </div>
          {row.web_view_link ? (
            <a className="text-[#0B3A8F] hover:underline shrink-0" href={row.web_view_link} target="_blank" rel="noreferrer">Open</a>
          ) : null}
        </div>
      ))}
    </section>
  );
}
