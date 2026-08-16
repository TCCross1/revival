import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api, { formatApiError, downloadAuthenticatedPdf } from "@/lib/api";
import { usdCents } from "@/lib/format";
import { computePricing } from "@/lib/pricing";
import StatusBadge from "@/components/StatusBadge";
import ClientDriveCard from "@/components/ClientDriveCard";
import JobFieldOps from "@/components/JobFieldOps";
import PricingBreakdown from "@/components/PricingBreakdown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft, Download, FolderOpen, Hammer, HardHat, MoreHorizontal,
  Plus, Save, Trash2, Truck, Users, PenTool, FileText,
} from "lucide-react";
import { toast } from "sonner";

const TOTAL_CARDS = [
  { key: "budget", title: "Budget", hint: "What you planned to spend", editable: true, accent: "gold" },
  { key: "committed", title: "Committed", hint: "Promised, not yet paid", editable: false, accent: "teal" },
  { key: "actual", title: "Actual", hint: "Already spent", editable: false, accent: "gold" },
  { key: "remaining", title: "Remaining", hint: "Budget minus actual", editable: false, accent: "teal" },
];

const CATEGORY_META = {
  Materials: { icon: Hammer, blurb: "Lumber, tile, fixtures, supplies" },
  Labor: { icon: Users, blurb: "Crew time and wages" },
  Subcontractors: { icon: HardHat, blurb: "Electrician, plumber, other trades" },
  Overhead: { icon: Truck, blurb: "Insurance, fuel, job overhead" },
  Other: { icon: MoreHorizontal, blurb: "Anything that doesn’t fit above" },
};

const emptyExpense = (category = "Materials") => ({
  category,
  description: "",
  amount: "",
  kind: "actual",
});

export default function JobSheet({ embedded = false }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState(null);
  const [expOpen, setExpOpen] = useState(false);
  const [expForm, setExpForm] = useState(emptyExpense());
  const [driveBusy, setDriveBusy] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["job-sheet", id],
    queryFn: async () => (await api.get(`/jobs/${id}/sheet`)).data,
  });
  const { data: jobPlans = [] } = useQuery({
    queryKey: ["floor-plans", { job_id: id }],
    enabled: Boolean(id),
    queryFn: async () => (await api.get("/floor-plans", { params: { job_id: id } })).data,
  });

  useEffect(() => {
    if (!data?.sheet) return;
    setForm({
      client_name: data.sheet.client_name || "",
      phone: data.sheet.phone || "",
      email: data.sheet.email || "",
      address: data.sheet.address || "",
      project_type: data.sheet.project_type || "",
      source: data.sheet.source || "",
      budget: data.sheet.budget ?? 0,
      income: data.sheet.income ?? 0,
      notes: data.sheet.notes || "",
      category_budgets: { ...(data.sheet.category_budgets || {}) },
      estimated_days: data.sheet.estimated_days ?? 0,
      profit_margin: data.sheet.profit_margin ?? "",
      apply_optional_tax: Boolean(data.sheet.apply_optional_tax),
    });
  }, [data]);

  const save = useMutation({
    mutationFn: async (payload) => (await api.put(`/jobs/${id}/sheet`, payload)).data,
    onSuccess: (res) => {
      qc.setQueryData(["job-sheet", id], res);
      qc.invalidateQueries({ queryKey: ["jobs"] });
      toast.success("Job sheet saved");
    },
    onError: async (err) => toast.error(await formatApiError(err, "Could not save the job sheet. Please try again.")),
  });

  const addExpense = useMutation({
    mutationFn: async (payload) => (await api.post(`/jobs/${id}/expenses`, payload)).data,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["job-sheet", id] });
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["financials-overview"] });
      toast.success("Cost added");
      setExpOpen(false);
    },
    onError: async (err) => toast.error(await formatApiError(err, "Could not add that cost. Please try again.")),
  });

  const delExpense = useMutation({
    mutationFn: async (expId) => api.delete(`/jobs/${id}/expenses/${expId}`),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["job-sheet", id] });
      qc.invalidateQueries({ queryKey: ["jobs"] });
      toast.success("Cost removed");
    },
    onError: async (err) => toast.error(await formatApiError(err, "Could not remove that cost. Please try again.")),
  });

  const totals = data?.totals;
  const categories = useMemo(() => data?.totals?.categories || [], [data]);
  const job = data?.job;
  const livePricing = useMemo(() => {
    if (!form) return data?.pricing;
    const oh = data?.overhead_month || {};
    const saved = data?.pricing || {};
    const budgets = form.category_budgets || {};
    return computePricing({
      materials: budgets.Materials,
      labor: budgets.Labor,
      subcontractors: budgets.Subcontractors,
      other: budgets.Other,
      monthlyOverhead: oh.actual_total ?? oh.total ?? saved.monthly_overhead,
      daysInMonth: oh.days_in_month ?? saved.days_in_month,
      estimatedDays: form.estimated_days,
      profitMarginPct: form.profit_margin === "" || form.profit_margin == null ? (saved.profit_margin_pct ?? 20) : form.profit_margin,
      ccFeePct: saved.cc_fee_pct ?? 3,
      salesTaxPct: saved.sales_tax_pct ?? 6,
      optionalTaxPct: saved.optional_tax_pct ?? 5,
      applyOptionalTax: form.apply_optional_tax,
    });
  }, [form, data]);

  const onSave = (e) => {
    e.preventDefault();
    if (!form) return;
    save.mutate({
      ...form,
      budget: Number(form.budget || 0),
      income: Number(form.income || 0),
      category_budgets: Object.fromEntries(
        Object.entries(form.category_budgets || {}).map(([k, v]) => [k, Number(v || 0)]),
      ),
      estimated_days: Number(form.estimated_days || 0),
      profit_margin: form.profit_margin === "" || form.profit_margin == null ? null : Number(form.profit_margin),
      apply_optional_tax: Boolean(form.apply_optional_tax),
    });
  };

  const openExpense = (category) => {
    setExpForm(emptyExpense(category || "Materials"));
    setExpOpen(true);
  };

  const submitExpense = (e) => {
    e.preventDefault();
    const amount = Number(expForm.amount);
    if (!amount || amount <= 0) return toast.error("Enter an amount greater than zero.");
    addExpense.mutate({ ...expForm, amount });
  };

  const downloadPdf = async () => {
    try {
      await downloadAuthenticatedPdf(`/jobs/${id}/sheet/pdf`, `${job?.job_number || "job"}-financial-sheet.pdf`, "Could not generate the job sheet PDF. Please try again.");
      toast.success("Job sheet PDF downloaded");
    } catch (err) {
      toast.error(err?.message || "Could not generate the job sheet PDF. Please try again.");
    }
  };

  const downloadReceipts = async () => {
    try {
      await downloadAuthenticatedPdf(`/jobs/${id}/receipts/pdf`, `${job?.job_number || "job"}-receipts.pdf`, "Could not generate the receipts PDF. Please try again.");
      toast.success("Receipts PDF downloaded");
    } catch (err) {
      toast.error(err?.message || "Could not generate the receipts PDF. Please try again.");
    }
  };

  const openDrive = async () => {
    const drive = data?.drive || {};
    if (!drive.connected) {
      toast.error("Connect Google Drive in Company Profile first.");
      navigate("/settings");
      return;
    }
    if (drive.folder_url) {
      window.open(drive.folder_url, "_blank", "noopener,noreferrer");
      return;
    }
    if (driveBusy) return;
    setDriveBusy(true);
    try {
      const res = (await api.post(`/jobs/${id}/sheet/drive/folder`)).data;
      qc.setQueryData(["job-sheet", id], (old) => (old ? { ...old, drive: { ...(old.drive || {}), ...res } } : old));
      if (res.folder_url) window.open(res.folder_url, "_blank", "noopener,noreferrer");
      toast.success("Google Drive folder is ready");
    } catch (err) {
      toast.error(await formatApiError(err, "Could not open Google Drive. Please try again."));
    } finally {
      setDriveBusy(false);
    }
  };

  if (isLoading || !form) return <div className="text-[#4B6370]">Loading job sheet…</div>;
  if (isError || !data) return <div className="text-[#4B6370]">This job sheet could not be found.</div>;

  return (
    <div className={`space-y-5 ${embedded ? "pb-8" : "pb-28 sm:pb-8"}`} data-testid="job-sheet-page">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          {embedded ? null : (
            <button onClick={() => navigate("/jobs")} className="flex items-center gap-1.5 text-sm font-medium text-[#0A4D68] hover:underline" data-testid="back-to-jobs-btn">
              <ArrowLeft size={16} /> Back to Jobs
            </button>
          )}
          {embedded ? null : (
            <>
              <h1 className="mt-2 text-2xl sm:text-4xl font-semibold font-['Outfit'] tracking-tight text-[#061A23]">
                Job Financial Sheet
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-[#4B6370]">
                <span className="font-medium text-[#0A4D68]">{job?.job_number}</span>
                <span className="hidden sm:inline">·</span>
                <span className="truncate max-w-[220px] sm:max-w-none">{job?.name}</span>
                <StatusBadge status={job?.status} />
              </div>
            </>
          )}
        </div>
        <div className="hidden sm:flex flex-wrap gap-2 shrink-0">
          {embedded ? null : (
            <>
          <Button type="button" variant="outline" className="gap-2 border-[#0A4D68]/25 text-[#0A4D68]" onClick={() => navigate(`/floor-plans/new?job=${id}`)} data-testid="job-sheet-floorplan-btn">
            <PenTool size={16} /> Floor plan
          </Button>
          <Button
            type="button"
            variant="outline"
            className="gap-2 border-[#0A4D68]/25 text-[#0A4D68]"
            data-testid="job-sheet-permit-btn"
            onClick={() => {
              const plan = Array.isArray(jobPlans) ? jobPlans[0] : null;
              if (plan?.id) navigate(`/floor-plans/${plan.id}?permit=1`);
              else {
                toast.message("Open or create a floor plan for this job first, then generate permit details.");
                navigate(`/floor-plans/new?job=${id}`);
              }
            }}
          >
            <FileText size={16} /> Permit Details
          </Button>
            </>
          )}
          <Button type="button" variant="outline" className="gap-2 border-[#0A4D68]/25 text-[#0A4D68]" onClick={downloadPdf} data-testid="job-sheet-pdf-btn">
            <Download size={16} /> PDF
          </Button>
          <Button type="button" variant="outline" className="gap-2 border-[#0A4D68]/25 text-[#0A4D68]" onClick={downloadReceipts} data-testid="job-sheet-receipts-btn">
            <Download size={16} /> Receipts
          </Button>
          <Button type="button" variant="outline" className="gap-2 border-[#0A4D68]/25 text-[#0A4D68]" onClick={openDrive} disabled={driveBusy} data-testid="job-sheet-drive-btn">
            <FolderOpen size={16} /> {driveBusy ? "Opening…" : (data?.drive?.has_folder ? "Open Drive" : "Drive")}
          </Button>
          <Button type="submit" form="job-sheet-form" disabled={save.isPending} className="bg-[#0A4D68] hover:bg-[#083D53] gap-2" data-testid="save-job-sheet-btn">
            <Save size={16} /> {save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      <form id="job-sheet-form" onSubmit={onSave} className="space-y-5">
        <section className="rounded-2xl border border-[#0A4D68]/20 bg-white shadow-sm overflow-hidden">
          <div className="px-4 sm:px-5 py-2.5 bg-gradient-to-r from-[#0A4D68] to-[#083D53]">
            <h2 className="text-white font-['Outfit'] font-semibold text-sm tracking-wide">Client</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-100">
            <SheetCell label="Name" value={form.client_name} onChange={(v) => setForm({ ...form, client_name: v })} testid="sheet-name" />
            <SheetCell label="Phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} testid="sheet-phone" placeholder="(512) 555-0100" />
            <SheetCell label="Email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} testid="sheet-email" />
            <SheetCell label="Address" value={form.address} onChange={(v) => setForm({ ...form, address: v })} testid="sheet-address" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-slate-100 border-t border-slate-100">
            <SheetCell label="Project type" value={form.project_type} onChange={(v) => setForm({ ...form, project_type: v })} testid="sheet-project-type" />
            <SheetCell label="Source" value={form.source} onChange={(v) => setForm({ ...form, source: v })} testid="sheet-source" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-slate-100 border-t border-slate-100">
            <SheetCell label="Estimated days to complete" value={form.estimated_days} onChange={(v) => setForm({ ...form, estimated_days: v })} testid="sheet-estimated-days" placeholder="e.g. 7" />
            <div className="px-4 py-3">
              <Label className="text-[11px] uppercase tracking-wide text-[#4B6370]">Optional 5% tax</Label>
              <label className="mt-2 flex items-center gap-2 text-sm text-[#061A23]">
                <input type="checkbox" checked={Boolean(form.apply_optional_tax)} onChange={(e) => setForm({ ...form, apply_optional_tax: e.target.checked })} data-testid="sheet-optional-tax" />
                Add federal + state tax on this job’s price
              </label>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {TOTAL_CARDS.map((card) => {
            const value = card.key === "budget" ? Number(form.budget || 0) : Number(totals?.[card.key] || 0);
            const over = card.key === "remaining" && value < 0;
            const gold = card.accent === "gold";
            return (
              <div
                key={card.key}
                data-testid={`sheet-total-${card.key}`}
                className={`rounded-2xl overflow-hidden border shadow-sm bg-white ${gold ? "border-[#C9A227]/45" : "border-[#0A4D68]/25"}`}
              >
                <div className={`h-1.5 ${gold ? "bg-[#C9A227]" : "bg-[#0A4D68]"}`} />
                <div className="p-3.5 sm:p-5">
                  <div className={`text-[11px] sm:text-xs font-semibold uppercase tracking-[0.14em] ${gold ? "text-[#C9A227]" : "text-[#0A4D68]"}`}>
                    {card.title}
                  </div>
                  <div className="text-[11px] text-[#8AA0AB] mt-0.5 hidden sm:block">{card.hint}</div>
                  {card.editable ? (
                    <Input
                      className="mt-3 h-12 sm:h-14 font-['Outfit'] text-xl sm:text-3xl font-semibold text-[#0A4D68] border-[#C9A227]/50 bg-[#FBF6E8] px-3"
                      type="number"
                      step="any"
                      min="0"
                      data-testid="sheet-budget"
                      value={form.budget}
                      onChange={(e) => setForm({ ...form, budget: e.target.value })}
                    />
                  ) : (
                    <div className={`mt-3 font-['Outfit'] text-[1.55rem] sm:text-3xl font-semibold leading-none tracking-tight ${over ? "text-red-600" : gold ? "text-[#8A7018]" : "text-[#0A4D68]"}`}>
                      {usdCents(value)}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
          <div className="px-4 sm:px-5 py-3 bg-[#0A4D68] flex items-center justify-between gap-3">
            <h2 className="text-white font-['Outfit'] font-semibold text-sm sm:text-base">Gross profit</h2>
            <span className="text-[#C9A227] text-sm font-semibold whitespace-nowrap">GP {totals?.gp_pct ?? 0}%</span>
          </div>
          <div className="p-4 sm:p-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <Label className="text-[11px] uppercase tracking-wide text-[#4B6370]">Client is paying</Label>
              <Input className="mt-1 h-10" type="number" step="any" min="0" data-testid="sheet-income" value={form.income} onChange={(e) => setForm({ ...form, income: e.target.value })} />
            </div>
            <StatChip label="Income" value={usdCents(totals?.income)} />
            <StatChip label="Spent" value={usdCents(totals?.expense)} />
            <StatChip label="Profit" value={usdCents(totals?.gross_profit)} gold />
          </div>
          <div className="px-4 sm:px-5 pb-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-[11px] uppercase tracking-wide text-[#4B6370]">Desired profit margin (%)</Label>
              <Input className="mt-1 h-10" type="number" step="any" min="0" data-testid="sheet-profit-margin" value={form.profit_margin} onChange={(e) => setForm({ ...form, profit_margin: e.target.value })} placeholder="20" />
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm" data-testid="sheet-overhead-allocation">
          <div className="px-4 sm:px-5 py-3 bg-[#0A4D68] flex items-center justify-between gap-3">
            <h2 className="text-white font-['Outfit'] font-semibold text-sm sm:text-base">Job overhead</h2>
            {data?.overhead_month?.month_label ? (
              <span className="text-white/80 text-xs">{data.overhead_month.month_label} · {data.overhead_month.days_in_month} days</span>
            ) : null}
          </div>
          <div className="p-4 sm:p-5 space-y-4">
            <p className="text-sm text-[#4B6370]">
              Daily rate = this month’s actual overhead ÷ days in the month. Allocated overhead = daily rate × estimated days to complete.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-xl border border-slate-200 bg-[#F4F7F8] p-4">
                <div className="text-[11px] uppercase tracking-wide text-[#4B6370]">Direct job costs</div>
                <div className="mt-1 text-2xl font-semibold font-['Outfit'] text-[#0A4D68]" data-testid="sheet-direct-costs">{usdCents(livePricing?.direct_costs)}</div>
                <div className="text-xs text-[#8AA0AB] mt-1">Materials + labor + subs + other</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-[#F4F7F8] p-4">
                <div className="text-[11px] uppercase tracking-wide text-[#4B6370]">Allocated overhead</div>
                <div className="mt-1 text-2xl font-semibold font-['Outfit'] text-[#8A7018]" data-testid="sheet-allocated-overhead">{usdCents(livePricing?.allocated_overhead)}</div>
                <div className="text-xs text-[#8AA0AB] mt-1">
                  {usdCents(livePricing?.daily_overhead_rate)} / day × {livePricing?.estimated_days || 0} days
                </div>
              </div>
              <div className="rounded-xl border border-[#C9A227]/40 bg-[#FBF6E8] p-4">
                <div className="text-[11px] uppercase tracking-wide text-[#8A7018]">True job cost</div>
                <div className="mt-1 text-2xl font-semibold font-['Outfit'] text-[#0A4D68]" data-testid="sheet-true-job-cost">{usdCents(livePricing?.true_job_cost)}</div>
                <div className="text-xs text-[#8AA0AB] mt-1">Direct + allocated overhead</div>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm" data-testid="sheet-pricing">
          <div className="px-4 sm:px-5 py-3 bg-[#0A4D68] flex items-center justify-between gap-3">
            <h2 className="text-white font-['Outfit'] font-semibold text-sm sm:text-base">Suggested price</h2>
            {data?.overhead_month?.month_label ? (
              <span className="text-white/80 text-xs">{data.overhead_month.month_label} · {data.overhead_month.days_in_month} days</span>
            ) : null}
          </div>
          <div className="p-4 sm:p-5 space-y-3">
            <p className="text-sm text-[#4B6370]">
              Direct costs come from Materials, Labor, Subcontractors, and Other. Allocated overhead is this job’s share of this month’s actual overhead in Financials.
            </p>
            <PricingBreakdown
              pricing={livePricing ? { ...livePricing, month_name: data?.overhead_month?.month_name || livePricing.month_name } : null}
              emptyHint="Set category budgets and estimated days to see a suggested price. Add this month’s overhead in Financials if the overhead share is $0."
            />
            {livePricing?.smart ? (
              <Button
                type="button"
                variant="outline"
                className="border-[#0A4D68]/30 text-[#0A4D68]"
                data-testid="sheet-use-price-btn"
                onClick={() => setForm({ ...form, income: livePricing.final_price, budget: livePricing.final_price })}
              >
                Use {usdCents(livePricing.final_price)} as what the client pays
              </Button>
            ) : null}
          </div>
        </section>

        <div className="space-y-4">
          {categories.map((cat) => {
            const meta = CATEGORY_META[cat.name] || CATEGORY_META.Other;
            const Icon = meta.icon;
            const budget = Number(form.category_budgets?.[cat.name] ?? cat.budget ?? 0);
            const actual = Number(cat.actual || 0);
            const pct = budget > 0 ? Math.min(100, (actual / budget) * 100) : (actual > 0 ? 100 : 0);
            const over = budget > 0 && actual > budget;
            return (
              <section key={cat.name} className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden" data-testid={`sheet-cat-${cat.name}`}>
                <div className="px-4 sm:px-5 py-3.5 bg-gradient-to-r from-[#0A4D68] to-[#083D53] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#C9A227] text-[#061A23] shrink-0">
                      <Icon size={16} />
                    </span>
                    <div className="min-w-0">
                      <h2 className="text-white font-['Outfit'] font-semibold leading-tight">{cat.name}</h2>
                      <p className="text-white/70 text-xs truncate hidden sm:block">{meta.blurb}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4 sm:gap-6 shrink-0">
                    <div className="text-left sm:text-right">
                      <div className="text-[10px] uppercase tracking-wide text-white/60">Budget</div>
                      <div className="text-white font-['Outfit'] font-semibold text-base sm:text-lg leading-tight">{usdCents(budget)}</div>
                    </div>
                    <div className="text-left sm:text-right">
                      <div className="text-[10px] uppercase tracking-wide text-white/60">Actual</div>
                      <div className="text-[#C9A227] font-['Outfit'] font-semibold text-base sm:text-lg leading-tight">{usdCents(actual)}</div>
                    </div>
                  </div>
                </div>

                <div className="p-4 sm:p-5 space-y-4">
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <div>
                      <Label className="text-[11px] uppercase tracking-wide text-[#4B6370]">Set category budget</Label>
                      <Input
                        className="mt-1 h-10 bg-[#FBF6E8] border-[#C9A227]/40"
                        type="number"
                        step="any"
                        min="0"
                        data-testid={`sheet-cat-budget-${cat.name}`}
                        value={form.category_budgets?.[cat.name] ?? 0}
                        onChange={(e) => setForm({ ...form, category_budgets: { ...form.category_budgets, [cat.name]: e.target.value } })}
                      />
                    </div>
                    <MiniStat label="Committed" value={usdCents(cat.committed)} />
                    <MiniStat label="Actual spent" value={usdCents(actual)} />
                    <MiniStat label="Left in category" value={usdCents(budget - actual)} warn={over} />
                  </div>

                  <div>
                    <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div className={`h-full rounded-full ${over ? "bg-red-500" : "bg-[#C9A227]"}`} style={{ width: `${pct}%` }} />
                    </div>
                    {over ? (
                      <div className="mt-1 text-[11px] text-red-600 font-medium">Over budget for this category</div>
                    ) : null}
                  </div>

                  <div className="rounded-xl border border-slate-200 overflow-hidden" data-testid={`sheet-exp-group-${cat.name}`}>
                    <div className="hidden sm:grid grid-cols-[1fr_110px_100px_40px] gap-2 px-3 py-2 bg-[#F4F7F8] text-[11px] font-semibold uppercase tracking-wide text-[#4B6370]">
                      <span>Description</span>
                      <span>Type</span>
                      <span className="text-right">Amount</span>
                      <span />
                    </div>
                    {(cat.expenses || []).length === 0 ? (
                      <div className="px-3 py-5 text-sm text-[#4B6370] text-center">No {cat.name.toLowerCase()} costs yet. Add one below.</div>
                    ) : (
                      (cat.expenses || []).map((exp) => (
                        <div key={exp.id} className="flex sm:grid sm:grid-cols-[1fr_110px_100px_40px] items-center gap-2 px-3 py-2.5 border-t border-slate-100 first:border-t-0 sm:first:border-t">
                          <div className="min-w-0 font-medium text-sm truncate">
                            {exp.description || "No description"}
                            {exp.receipt_url ? <a href={exp.receipt_url} target="_blank" rel="noreferrer" className="ml-2 text-[11px] text-[#0A4D68] underline">Receipt</a> : null}
                          </div>
                          <span className={`inline-flex w-fit text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5 ${exp.kind === "committed" ? "bg-amber-100 text-amber-800" : "bg-[#0A4D68]/10 text-[#0A4D68]"}`}>
                            {exp.kind === "committed" ? "Committed" : "Actual"}
                          </span>
                          <span className="font-['Outfit'] font-semibold text-sm sm:text-right ml-auto sm:ml-0">{usdCents(exp.amount)}</span>
                          <button type="button" onClick={() => { if (window.confirm("Remove this cost?")) delExpense.mutate(exp.id); }} className="p-2 rounded-md text-red-400 hover:text-red-600 hover:bg-red-50 justify-self-end" aria-label="Remove cost">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))
                    )}
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => openExpense(cat.name)}
                    className="w-full h-11 border-dashed border-[#0A4D68]/40 text-[#0A4D68] hover:bg-[#0A4D68]/5 hover:text-[#0A4D68] gap-2"
                    data-testid={cat.name === "Materials" ? "sheet-add-expense-btn" : `sheet-add-${cat.name}`}
                  >
                    <Plus size={16} /> Add a {cat.name.toLowerCase()} cost
                  </Button>
                </div>
              </section>
            );
          })}
        </div>

        <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
          <div className="px-4 sm:px-5 py-3 bg-[#0A4D68]">
            <h2 className="text-white font-['Outfit'] font-semibold text-sm sm:text-base">Notes</h2>
          </div>
          <div className="p-4 sm:p-5">
            <Textarea data-testid="sheet-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Anything the crew should remember about this job…" rows={3} />
          </div>
        </section>
      </form>

      {embedded ? null : <JobFieldOps jobId={id} job={job} />}

      {embedded ? null : (
      <ClientDriveCard
        drive={data?.drive}
        clientId={job?.client_id || data?.sheet?.client_id || ""}
        jobId={id}
        onCreate={openDrive}
        creating={driveBusy}
        onRefresh={(next) => qc.setQueryData(["job-sheet", id], (old) => (old ? { ...old, drive: { ...(old.drive || {}), ...next } } : old))}
      />
      )}

      <div className={`sm:hidden ${embedded ? "static" : "fixed bottom-0 inset-x-0 z-20"} border-t border-slate-200 bg-white/95 backdrop-blur px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] flex gap-2`}>
        <Button type="button" variant="outline" className="flex-1 border-[#0A4D68]/25 text-[#0A4D68]" onClick={downloadPdf}>PDF</Button>
        <Button type="button" variant="outline" className="flex-1 border-[#0A4D68]/25 text-[#0A4D68]" onClick={openDrive} disabled={driveBusy}>Drive</Button>
        <Button type="submit" form="job-sheet-form" disabled={save.isPending} className="flex-[2] bg-[#0A4D68] hover:bg-[#083D53] gap-2">
          <Save size={16} /> {save.isPending ? "Saving…" : "Save sheet"}
        </Button>
      </div>

      <Dialog open={expOpen} onOpenChange={setExpOpen}>
        <DialogContent className="bg-white max-w-md mx-4">
          <DialogHeader>
            <DialogTitle className="font-['Outfit'] text-2xl">Add a {expForm.category.toLowerCase()} cost</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitExpense} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Category</Label>
                <Select value={expForm.category} onValueChange={(v) => setExpForm({ ...expForm, category: v })}>
                  <SelectTrigger data-testid="sheet-expense-category"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-white">
                    {(data.categories || []).map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Type</Label>
                <Select value={expForm.kind} onValueChange={(v) => setExpForm({ ...expForm, kind: v })}>
                  <SelectTrigger data-testid="sheet-expense-kind"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-white">
                    <SelectItem value="committed">Committed (promised)</SelectItem>
                    <SelectItem value="actual">Actual (spent)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>What was it?</Label>
              <Input data-testid="sheet-expense-desc" value={expForm.description} onChange={(e) => setExpForm({ ...expForm, description: e.target.value })} placeholder="e.g. Cabinets from Home Depot" />
            </div>
            <div>
              <Label>Amount ($)</Label>
              <Input data-testid="sheet-expense-amount" type="number" step="any" inputMode="decimal" value={expForm.amount} onChange={(e) => setExpForm({ ...expForm, amount: e.target.value })} />
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setExpOpen(false)} disabled={addExpense.isPending}>Cancel</Button>
              <Button type="submit" disabled={addExpense.isPending} className="bg-[#0A4D68] hover:bg-[#083D53]" data-testid="sheet-save-expense-btn">
                {addExpense.isPending ? "Saving…" : "Add cost"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SheetCell({ label, value, onChange, testid, placeholder }) {
  return (
    <label className="block px-4 py-3 min-w-0">
      <span className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-[#0A4D68]">{label}</span>
      <Input
        className="mt-1 h-10 border-0 px-0 rounded-none focus-visible:ring-0 text-[#061A23] font-medium placeholder:text-slate-300"
        data-testid={testid}
        value={value}
        placeholder={placeholder || ""}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function MiniStat({ label, value, warn }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-[#4B6370]">{label}</div>
      <div className={`font-['Outfit'] font-semibold text-base mt-0.5 ${warn ? "text-red-600" : "text-[#061A23]"}`}>{value}</div>
    </div>
  );
}

function StatChip({ label, value, gold }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-[#4B6370]">{label}</div>
      <div className={`font-['Outfit'] font-semibold text-lg mt-0.5 ${gold ? "text-[#C9A227]" : "text-[#061A23]"}`}>{value}</div>
    </div>
  );
}
