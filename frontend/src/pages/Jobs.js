import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import { usd, usdCents, fmtDate } from "@/lib/format";
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
import { Plus, Trash2, HardHat, Receipt } from "lucide-react";
import { toast } from "sonner";

const EXP_CATEGORIES = ["Materials", "Subcontractors", "Labor", "Overhead", "Permits", "Equipment", "Other"];
const JOB_STATUSES = ["Active", "On Hold", "Completed"];

export default function Jobs() {
  const qc = useQueryClient();
  const [newOpen, setNewOpen] = useState(false);
  const [expOpen, setExpOpen] = useState(false);
  const [activeJob, setActiveJob] = useState(null);
  const [jobForm, setJobForm] = useState({ name: "", estimate_id: "", client_name: "", status: "Active", budget: 0 });
  const [expForm, setExpForm] = useState({ category: "Materials", description: "", amount: 0, kind: "actual" });

  const { data: jobs = [], isLoading } = useQuery({ queryKey: ["jobs"], queryFn: async () => (await api.get("/jobs")).data });
  const { data: estimates = [] } = useQuery({ queryKey: ["estimates"], queryFn: async () => (await api.get("/estimates")).data });
  const wonEstimates = estimates.filter((e) => e.status === "Won");

  const createJob = useMutation({
    mutationFn: async (payload) => api.post("/jobs", payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Job created");
      setNewOpen(false);
    },
  });

  const removeJob = useMutation({
    mutationFn: async (id) => api.delete(`/jobs/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["jobs"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); toast.success("Job deleted"); },
  });

  const addExpense = useMutation({
    mutationFn: async ({ jobId, payload }) => api.post(`/jobs/${jobId}/expenses`, payload),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["jobs"] }); toast.success("Expense logged"); setExpOpen(false); },
  });

  const delExpense = useMutation({
    mutationFn: async ({ jobId, expId }) => api.delete(`/jobs/${jobId}/expenses/${expId}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["jobs"] }); toast.success("Expense removed"); },
  });

  const openNewJob = () => { setJobForm({ name: "", estimate_id: "", client_name: "", status: "Active", budget: 0 }); setNewOpen(true); };
  const onEstimatePick = (id) => {
    const e = wonEstimates.find((x) => x.id === id);
    setJobForm({ ...jobForm, estimate_id: id, client_name: e ? e.client_name : "", name: e ? `${e.category} - ${e.client_name}` : jobForm.name, budget: e ? e.total : jobForm.budget });
  };
  const submitJob = (e) => {
    e.preventDefault();
    if (!jobForm.name.trim()) return toast.error("Job name is required");
    createJob.mutate({ ...jobForm, budget: Number(jobForm.budget || 0) });
  };
  const openExpense = (job) => { setActiveJob(job); setExpForm({ category: "Materials", description: "", amount: 0, kind: "actual" }); setExpOpen(true); };
  const submitExpense = (e) => {
    e.preventDefault();
    if (!Number(expForm.amount)) return toast.error("Enter an amount");
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
        <Dialog open={newOpen} onOpenChange={setNewOpen}>
          <DialogTrigger asChild>
            <Button data-testid="add-job-btn" onClick={openNewJob} className="bg-[#0A4D68] hover:bg-[#083D53] gap-2"><Plus size={18} /> New Job</Button>
          </DialogTrigger>
          <DialogContent className="bg-white max-w-lg">
            <DialogHeader><DialogTitle className="font-['Outfit'] text-2xl">New Job</DialogTitle></DialogHeader>
            <form onSubmit={submitJob} className="space-y-4">
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
                <Button type="button" variant="outline" onClick={() => setNewOpen(false)}>Cancel</Button>
                <Button data-testid="save-job-btn" type="submit" className="bg-[#0A4D68] hover:bg-[#083D53]">Create Job</Button>
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
          return (
            <div key={job.id} data-testid={`job-card-${job.id}`} className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-semibold font-['Outfit']">{job.name}</h3>
                    <StatusBadge status={job.status} />
                  </div>
                  <div className="text-sm text-[#4B6370] mt-0.5">{job.job_number} · {job.client_name}</div>
                </div>
                <button data-testid={`delete-job-${job.id}`} onClick={() => { if (window.confirm("Delete this job?")) removeJob.mutate(job.id); }} className="p-2 rounded-md hover:bg-red-50 text-red-500"><Trash2 size={16} /></button>
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
                        <button onClick={() => delExpense.mutate({ jobId: job.id, expId: exp.id })} className="text-red-400 hover:text-red-600"><Trash2 size={13} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <Button data-testid={`log-expense-${job.id}`} onClick={() => openExpense(job)} variant="outline" size="sm" className="mt-4 gap-1 w-full border-[#0A4D68]/30 text-[#0A4D68] hover:bg-[#0A4D68]/5">
                <Plus size={14} /> Log expense
              </Button>
            </div>
          );
        })}
      </div>

      {/* Expense dialog */}
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
              <Button type="button" variant="outline" onClick={() => setExpOpen(false)}>Cancel</Button>
              <Button data-testid="save-expense-btn" type="submit" className="bg-[#0A4D68] hover:bg-[#083D53]">Save Expense</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
