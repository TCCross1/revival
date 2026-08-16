import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api, { formatApiError } from "@/lib/api";
import { usd, usdCents } from "@/lib/format";
import StatusBadge from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, HardHat, Pencil, ClipboardList, PenTool } from "lucide-react";
import { toast } from "sonner";

const EXP_CATEGORIES = ["Materials", "Labor", "Subcontractors", "Overhead", "Other"];
const JOB_STATUSES = ["Active", "On Hold", "Completed"];

const emptyJobForm = () => ({ name: "", estimate_id: "", client_id: "", client_name: "", status: "Active", budget: 0 });

export default function Jobs() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const highlight = searchParams.get("highlight") || "";
  const highlightRef = useRef(null);
  const [jobOpen, setJobOpen] = useState(false);
  const [editingJob, setEditingJob] = useState(null);
  const [expOpen, setExpOpen] = useState(false);
  const [activeJob, setActiveJob] = useState(null);
  const [jobForm, setJobForm] = useState(emptyJobForm());
  const [expForm, setExpForm] = useState({ category: "Materials", description: "", amount: 0, kind: "actual" });

  const { data: jobs = [], isLoading } = useQuery({ queryKey: ["jobs"], queryFn: async () => (await api.get("/jobs")).data });
  const { data: estimates = [] } = useQuery({ queryKey: ["estimates"], queryFn: async () => (await api.get("/estimates")).data });
  const wonEstimates = estimates.filter((e) => e.status === "Won");

  useEffect(() => {
    if (!highlight || !highlightRef.current) return;
    highlightRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlight, jobs]);

  const saveJob = useMutation({
    mutationFn: async (payload) => editingJob ? api.put(`/jobs/${editingJob.id}`, payload) : api.post("/jobs", payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["financials-overview"] });
      toast.success(editingJob ? "Job updated" : "Job created");
      setJobOpen(false);
      setEditingJob(null);
    },
    onError: async (err) => toast.error(await formatApiError(err, editingJob ? "Could not update the job. Please try again." : "Could not create the job. Please try again.")),
  });

  const removeJob = useMutation({
    mutationFn: async (id) => api.delete(`/jobs/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["jobs"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); qc.invalidateQueries({ queryKey: ["financials-overview"] }); toast.success("Job deleted"); },
    onError: async (err) => toast.error(await formatApiError(err, "Could not delete the job. Please try again.")),
  });

  const addExpense = useMutation({
    mutationFn: async ({ jobId, payload }) => api.post(`/jobs/${jobId}/expenses`, payload),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["jobs"] }); qc.invalidateQueries({ queryKey: ["financials-overview"] }); qc.invalidateQueries({ queryKey: ["tax-summary"] }); qc.invalidateQueries({ queryKey: ["tax-classifications"] }); toast.success("Expense logged"); setExpOpen(false); },
    onError: async (err) => toast.error(await formatApiError(err, "Could not log the expense. Please try again.")),
  });

  const delExpense = useMutation({
    mutationFn: async ({ jobId, expId }) => api.delete(`/jobs/${jobId}/expenses/${expId}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["jobs"] }); qc.invalidateQueries({ queryKey: ["financials-overview"] }); toast.success("Expense removed"); },
    onError: async (err) => toast.error(await formatApiError(err, "Could not remove the expense. Please try again.")),
  });

  const openNewJob = () => {
    setEditingJob(null);
    setJobForm(emptyJobForm());
    setJobOpen(true);
  };
  const openEditJob = (job) => {
    setEditingJob(job);
    setJobForm({
      name: job.name || "",
      estimate_id: job.estimate_id || "",
      client_id: job.client_id || "",
      client_name: job.client_name || "",
      status: job.status || "Active",
      budget: job.budget || 0,
    });
    setJobOpen(true);
  };
  const onEstimatePick = (id) => {
    const e = wonEstimates.find((x) => x.id === id);
    setJobForm({
      ...jobForm,
      estimate_id: id,
      client_id: e ? e.client_id : "",
      client_name: e ? e.client_name : "",
      name: e ? `${e.category} - ${e.client_name}` : jobForm.name,
      budget: e ? e.total : jobForm.budget,
    });
  };
  const submitJob = (e) => {
    e.preventDefault();
    if (!jobForm.name.trim()) return toast.error("Job name is required");
    saveJob.mutate({ ...jobForm, budget: Number(jobForm.budget || 0) });
  };
  const openExpense = (job) => { setActiveJob(job); setExpForm({ category: "Materials", description: "", amount: 0, kind: "actual" }); setExpOpen(true); };
  const submitExpense = (e) => {
    e.preventDefault();
    if (!Number(expForm.amount) || Number(expForm.amount) <= 0) return toast.error("Enter an amount greater than zero");
    addExpense.mutate({ jobId: activeJob.id, payload: { ...expForm, amount: Number(expForm.amount) } });
  };

  const totals = (job) => {
    const committed = (job.expenses || []).filter((e) => e.kind === "committed").reduce((s, e) => s + e.amount, 0);
    const actual = (job.expenses || []).filter((e) => e.kind === "actual").reduce((s, e) => s + e.amount, 0);
    return { committed, actual, spentPct: job.budget ? Math.min((actual / job.budget) * 100, 100) : 0 };
  };

  return (
    <div className="space-y-6" data-testid="jobs-page">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-semibold font-['Outfit'] tracking-tight">Jobs</h1>
          <p className="text-[#4B6370] mt-1">Track budget vs. committed vs. actual on every project.</p>
        </div>
        <Dialog open={jobOpen} onOpenChange={(v) => { setJobOpen(v); if (!v) setEditingJob(null); }}>
          <DialogTrigger asChild>
            <Button data-testid="add-job-btn" onClick={openNewJob} className="bg-[#0A4D68] hover:bg-[#083D53] gap-2"><Plus size={18} /> New Job</Button>
          </DialogTrigger>
          <DialogContent className="bg-white max-w-lg">
            <DialogHeader><DialogTitle className="font-['Outfit'] text-2xl">{editingJob ? "Edit Job" : "New Job"}</DialogTitle></DialogHeader>
            <form onSubmit={submitJob} className="space-y-4">
              {!editingJob && (
                <div>
                  <Label>Link a won estimate (optional)</Label>
                  <Select value={jobForm.estimate_id} onValueChange={onEstimatePick}>
                    <SelectTrigger data-testid="job-estimate-select"><SelectValue placeholder="Choose won estimate" /></SelectTrigger>
                    <SelectContent className="bg-white">
                      {wonEstimates.length === 0 && <div className="px-3 py-2 text-sm text-[#4B6370]">No won estimates yet</div>}
                      {wonEstimates.map((e) => <SelectItem key={e.id} value={e.id}>{e.estimate_number} · {e.client_name} · {usd(e.total)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div>
                <Label>Job name</Label>
                <Input data-testid="job-name-input" value={jobForm.name} onChange={(e) => setJobForm({ ...jobForm, name: e.target.value })} placeholder="e.g. Kitchen - Sarah Mitchell" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Budget ($)</Label>
                  <Input data-testid="job-budget-input" type="number" step="any" value={jobForm.budget} onChange={(e) => setJobForm({ ...jobForm, budget: e.target.value })} />
                </div>
                <div>
                  <Label>Status</Label>
                  <Select value={jobForm.status} onValueChange={(v) => setJobForm({ ...jobForm, status: v })}>
                    <SelectTrigger data-testid="job-status-select"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-white">{JOB_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setJobOpen(false)} disabled={saveJob.isPending}>Cancel</Button>
                <Button data-testid="save-job-btn" type="submit" disabled={saveJob.isPending} className="bg-[#0A4D68] hover:bg-[#083D53]">
                  {saveJob.isPending ? "Saving…" : editingJob ? "Save Changes" : "Create Job"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading && <div className="text-[#4B6370]">Loading…</div>}
      {!isLoading && jobs.length === 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-10 text-center text-[#4B6370]">
          <HardHat className="mx-auto mb-3 text-slate-300" size={40} />
          No jobs yet. Create a job from a won estimate to start tracking costs.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {jobs.map((job) => {
          const { committed, actual, spentPct } = totals(job);
          const expBusy = addExpense.isPending && addExpense.variables?.jobId === job.id;
          return (
            <div
              key={job.id}
              ref={job.id === highlight ? highlightRef : undefined}
              data-testid={`job-card-${job.id}`}
              className={`bg-white rounded-xl border shadow-sm p-6 ${job.id === highlight ? "border-[#0A4D68] ring-2 ring-[#C9A227]/70" : "border-slate-200"}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-semibold font-['Outfit']">{job.name}</h3>
                    <StatusBadge status={job.status} />
                  </div>
                  <div className="text-sm text-[#4B6370] mt-0.5">{job.job_number} · {job.client_name}</div>
                </div>
                <div className="flex items-center gap-1">
                  <button data-testid={`open-job-sheet-${job.id}`} onClick={() => navigate(`/jobs/${job.id}`)} title="Open job" className="p-2 rounded-md hover:bg-slate-100 text-[#0A4D68]">
                    <ClipboardList size={16} />
                  </button>
                  <button data-testid={`open-job-floorplan-${job.id}`} onClick={() => navigate(`/floor-plans/new?job=${job.id}`)} title="Floor plan" className="p-2 rounded-md hover:bg-slate-100 text-[#0A4D68]">
                    <PenTool size={16} />
                  </button>
                  <button data-testid={`edit-job-${job.id}`} onClick={() => openEditJob(job)} title="Edit job" className="p-2 rounded-md hover:bg-slate-100 text-[#0A4D68]">
                    <Pencil size={16} />
                  </button>
                  <button data-testid={`delete-job-${job.id}`} onClick={() => { if (window.confirm("Delete this job?")) removeJob.mutate(job.id); }} className="p-2 rounded-md hover:bg-red-50 text-red-500"><Trash2 size={16} /></button>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 mt-5">
                <div className="rounded-lg bg-slate-50 p-3">
                  <div className="text-xs text-[#4B6370]">Budget</div>
                  <div className="font-semibold font-['Outfit'] text-[#0A4D68]">{usd(job.budget)}</div>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <div className="text-xs text-[#4B6370]">Committed</div>
                  <div className="font-semibold font-['Outfit'] text-amber-600">{usd(committed)}</div>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <div className="text-xs text-[#4B6370]">Actual</div>
                  <div className="font-semibold font-['Outfit'] text-emerald-600">{usd(actual)}</div>
                </div>
              </div>

              <div className="mt-4">
                <div className="flex justify-between text-xs text-[#4B6370] mb-1">
                  <span>Spent vs budget</span>
                  <span className={actual > job.budget ? "text-red-600 font-semibold" : ""}>{Math.round(spentPct)}%</span>
                </div>
                <Progress value={spentPct} className="h-2" />
                <div className="text-xs text-[#4B6370] mt-1">Remaining: {usdCents(Math.max(job.budget - actual, 0))}</div>
              </div>

              {(job.expenses || []).length > 0 && (
                <div className="mt-4 border-t border-slate-100 pt-3 space-y-2 max-h-40 overflow-y-auto">
                  {job.expenses.map((exp) => (
                    <div key={exp.id} className="flex items-center justify-between text-sm">
                      <div className="min-w-0">
                        <span className="font-medium">{exp.category}</span>
                        <span className="text-[#4B6370]"> · {exp.description || "—"}</span>
                        <span className={`ml-2 text-xs rounded px-1.5 py-0.5 ${exp.kind === "committed" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>{exp.kind}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-medium">{usdCents(exp.amount)}</span>
                        <button onClick={() => delExpense.mutate({ jobId: job.id, expId: exp.id })} disabled={delExpense.isPending} className="text-red-400 hover:text-red-600 disabled:opacity-50"><Trash2 size={13} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-4 grid grid-cols-2 gap-2">
                <Button data-testid={`open-sheet-${job.id}`} onClick={() => navigate(`/jobs/${job.id}`)} variant="outline" size="sm" className="gap-1 border-[#0A4D68]/30 text-[#0A4D68] hover:bg-[#0A4D68]/5">
                  <ClipboardList size={14} /> Open job
                </Button>
                <Button data-testid={`log-expense-${job.id}`} onClick={() => openExpense(job)} disabled={expBusy} variant="outline" size="sm" className="gap-1 border-[#0A4D68]/30 text-[#0A4D68] hover:bg-[#0A4D68]/5">
                  <Plus size={14} /> {expBusy ? "Saving…" : "Log expense"}
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <Dialog open={expOpen} onOpenChange={setExpOpen}>
        <DialogContent className="bg-white max-w-md">
          <DialogHeader><DialogTitle className="font-['Outfit'] text-2xl">Log Expense</DialogTitle></DialogHeader>
          <form onSubmit={submitExpense} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Category</Label>
                <Select value={expForm.category} onValueChange={(v) => setExpForm({ ...expForm, category: v })}>
                  <SelectTrigger data-testid="expense-category-select"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-white">{EXP_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Type</Label>
                <Select value={expForm.kind} onValueChange={(v) => setExpForm({ ...expForm, kind: v })}>
                  <SelectTrigger data-testid="expense-kind-select"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-white">
                    <SelectItem value="committed">Committed</SelectItem>
                    <SelectItem value="actual">Actual (spent)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Description</Label>
              <Input data-testid="expense-desc-input" value={expForm.description} onChange={(e) => setExpForm({ ...expForm, description: e.target.value })} placeholder="e.g. Lumber order" />
            </div>
            <div>
              <Label>Amount ($)</Label>
              <Input data-testid="expense-amount-input" type="number" step="any" value={expForm.amount} onChange={(e) => setExpForm({ ...expForm, amount: e.target.value })} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setExpOpen(false)} disabled={addExpense.isPending}>Cancel</Button>
              <Button data-testid="save-expense-btn" type="submit" disabled={addExpense.isPending} className="bg-[#0A4D68] hover:bg-[#083D53]">
                {addExpense.isPending ? "Saving…" : "Save Expense"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
