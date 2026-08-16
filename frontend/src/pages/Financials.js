import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api, { formatApiError } from "@/lib/api";
import { usd, usdCents, fmtDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, TrendingUp, TrendingDown, Wallet, Receipt, HardHat, Scale, MessageCircleQuestion } from "lucide-react";
import StatusBadge from "@/components/StatusBadge";
import OverheadLedger from "@/components/OverheadLedger";
import SquareStatements from "@/components/SquareStatements";
import { toast } from "sonner";

const todayDate = () => new Date().toISOString().slice(0, 10);
const currentYear = () => new Date().getFullYear();
const currentMonth = () => new Date().getMonth() + 1;
const padMonth = (month) => String(month).padStart(2, "0");
const monthDate = (year, month) => {
  const today = todayDate();
  const prefix = `${year}-${padMonth(month)}`;
  return today.startsWith(prefix) ? today : `${prefix}-01`;
};

const taxStatusLabel = (status) => ({ pending: "Pending", classified: "Classified", needs_review: "Needs review" }[status] || status);

const emptyExpense = (categoryId = "") => ({
  category_id: categoryId,
  description: "",
  amount: "",
  date: todayDate(),
  notes: "",
});

const MixBar = ({ leftValue, rightValue, leftColor, rightColor }) => {
  const left = Math.max(Number(leftValue || 0), 0);
  const right = Math.max(Number(rightValue || 0), 0);
  const total = left + right;
  const leftPct = total > 0 ? (left / total) * 100 : 50;
  return (
    <div className="h-2.5 w-full rounded-full bg-slate-100 overflow-hidden flex">
      <div className={`${leftColor} h-full`} style={{ width: `${leftPct}%` }} />
      <div className={`${rightColor} h-full`} style={{ width: `${100 - leftPct}%` }} />
    </div>
  );
};

const StatCard = ({ icon: Icon, label, value, sub, accent, valueColor, testid, onClick }) => (
  <button
    type="button"
    data-testid={testid}
    onClick={onClick}
    className={`bg-white rounded-xl border border-slate-200 shadow-sm p-6 text-left w-full ${onClick ? "hover:border-[#0A4D68]/30 transition-colors" : ""}`}
  >
    <div className="flex items-center justify-between">
      <span className="text-sm font-medium text-[#4B6370]">{label}</span>
      <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${accent}`}>
        <Icon size={18} />
      </span>
    </div>
    <div className={`mt-4 text-3xl font-semibold font-['Outfit'] tracking-tight ${valueColor || "text-[#061A23]"}`}>{value}</div>
    {sub && <div className="mt-1 text-sm text-[#4B6370]">{sub}</div>}
  </button>
);

export default function Financials() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [tab, setTab] = useState("overview");
  const [catOpen, setCatOpen] = useState(false);
  const [expOpen, setExpOpen] = useState(false);
  const [editingCat, setEditingCat] = useState(null);
  const [editingExp, setEditingExp] = useState(null);
  const [catName, setCatName] = useState("");
  const [expForm, setExpForm] = useState(emptyExpense());
  const [otherOpen, setOtherOpen] = useState(false);
  const [otherForm, setOtherForm] = useState({ description: "", amount: "", date: todayDate(), notes: "" });
  const [answerDrafts, setAnswerDrafts] = useState({});
  const [ohYear, setOhYear] = useState(currentYear());
  const [ohMonth, setOhMonth] = useState(currentMonth());

  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ["financials-overview"],
    queryFn: async () => (await api.get("/financials/overview")).data,
    staleTime: 0,
    refetchOnMount: "always",
  });
  const { data: categories = [], isLoading: catsLoading } = useQuery({
    queryKey: ["financials-categories"],
    queryFn: async () => (await api.get("/financials/categories")).data,
    staleTime: 0,
    refetchOnMount: "always",
  });
  const { data: monthly, isLoading: monthlyLoading } = useQuery({
    queryKey: ["financials-monthly", ohYear, ohMonth],
    queryFn: async () => (await api.get("/financials/monthly-overhead", { params: { year: ohYear, month: ohMonth } })).data,
    staleTime: 0,
    refetchOnMount: "always",
    enabled: tab === "overhead",
  });
  const { data: taxSummary, isLoading: taxSummaryLoading } = useQuery({
    queryKey: ["tax-summary"],
    queryFn: async () => (await api.get("/financials/tax/summary")).data,
    staleTime: 0,
    refetchOnMount: "always",
    enabled: tab === "tax",
  });
  const { data: taxClassifications = [], isLoading: taxClassLoading } = useQuery({
    queryKey: ["tax-classifications"],
    queryFn: async () => (await api.get("/financials/tax/classifications")).data,
    staleTime: 0,
    refetchOnMount: "always",
    enabled: tab === "tax",
  });
  const { data: taxQuestions = [], isLoading: taxQuestionsLoading } = useQuery({
    queryKey: ["tax-questions"],
    queryFn: async () => (await api.get("/financials/tax/questions")).data,
    staleTime: 0,
    refetchOnMount: "always",
    enabled: tab === "tax",
  });

  const invalidateBooks = () => {
    qc.invalidateQueries({ queryKey: ["financials-overview"] });
    qc.invalidateQueries({ queryKey: ["financials-categories"] });
    qc.invalidateQueries({ queryKey: ["financials-monthly"] });
    qc.invalidateQueries({ queryKey: ["tax-summary"] });
    qc.invalidateQueries({ queryKey: ["tax-classifications"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const saveCategory = useMutation({
    mutationFn: async (payload) =>
      editingCat ? api.put(`/financials/categories/${editingCat.id}`, payload) : api.post("/financials/categories", payload),
    onSuccess: () => {
      invalidateBooks();
      toast.success(editingCat ? "Category updated" : "Category added");
      setCatOpen(false);
      setEditingCat(null);
      setCatName("");
    },
    onError: async (err) => toast.error(await formatApiError(err, "Could not save the category. Please try again.")),
  });

  const removeCategory = useMutation({
    mutationFn: async (id) => api.delete(`/financials/categories/${id}`),
    onSuccess: () => {
      invalidateBooks();
      toast.success("Category deleted");
    },
    onError: async (err) => toast.error(await formatApiError(err, "Could not delete the category. Please try again.")),
  });

  const saveExpense = useMutation({
    mutationFn: async (payload) =>
      editingExp ? api.put(`/financials/expenses/${editingExp.id}`, payload) : api.post("/financials/expenses", payload),
    onSuccess: () => {
      invalidateBooks();
      toast.success(editingExp ? "Expense updated" : "Expense added");
      setExpOpen(false);
      setEditingExp(null);
      setExpForm(emptyExpense());
    },
    onError: async (err) => toast.error(await formatApiError(err, "Could not save the expense. Please try again.")),
  });

  const removeExpense = useMutation({
    mutationFn: async (id) => api.delete(`/financials/expenses/${id}`),
    onSuccess: () => {
      invalidateBooks();
      toast.success("Expense deleted");
    },
    onError: async (err) => toast.error(await formatApiError(err, "Could not delete the expense. Please try again.")),
  });

  const answerQuestion = useMutation({
    mutationFn: async ({ id, answer }) => api.post(`/financials/tax/questions/${id}/answer`, { answer }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tax-questions"] });
      qc.invalidateQueries({ queryKey: ["tax-summary"] });
      toast.success("Answer saved");
    },
    onError: async (err) => toast.error(await formatApiError(err, "Could not save the answer. Please try again.")),
  });

  const saveOtherIncome = useMutation({
    mutationFn: async (payload) => api.post("/financials/other-income", payload),
    onSuccess: () => {
      invalidateBooks();
      toast.success("Other income added");
      setOtherOpen(false);
      setOtherForm({ description: "", amount: "", date: todayDate(), notes: "" });
    },
    onError: async (err) => toast.error(await formatApiError(err, "Could not add other income. Please try again.")),
  });

  const openNewCategory = () => {
    setEditingCat(null);
    setCatName("");
    setCatOpen(true);
  };
  const openEditCategory = (cat) => {
    setEditingCat(cat);
    setCatName(cat.name);
    setCatOpen(true);
  };
  const openNewExpense = (categoryId = "") => {
    setEditingExp(null);
    setExpForm({ ...emptyExpense(categoryId || (categories[0]?.id || "")), date: monthDate(ohYear, ohMonth) });
    setExpOpen(true);
  };
  const openEditExpense = (exp) => {
    setEditingExp(exp);
    setExpForm({
      category_id: exp.category_id,
      description: exp.description || "",
      amount: exp.amount,
      date: (exp.date || "").slice(0, 10),
      notes: exp.notes || "",
    });
    setExpOpen(true);
  };

  const submitCategory = (e) => {
    e.preventDefault();
    if (!catName.trim()) return toast.error("Category name is required");
    saveCategory.mutate({ name: catName.trim() });
  };
  const submitExpense = (e) => {
    e.preventDefault();
    if (!expForm.category_id) return toast.error("Choose a category");
    if (!expForm.description.trim()) return toast.error("Description is required");
    const amount = Number(expForm.amount);
    if (!amount || amount <= 0) return toast.error("Enter an amount greater than zero");
    saveExpense.mutate({
      category_id: expForm.category_id,
      description: expForm.description.trim(),
      amount,
      date: expForm.date || todayDate(),
      notes: expForm.notes.trim(),
    });
  };
  const submitOtherIncome = (e) => {
    e.preventDefault();
    if (!otherForm.description.trim()) return toast.error("Description is required");
    const amount = Number(otherForm.amount);
    if (!amount || amount <= 0) return toast.error("Enter an amount greater than zero");
    saveOtherIncome.mutate({
      description: otherForm.description.trim(),
      amount,
      date: otherForm.date || todayDate(),
      notes: otherForm.notes.trim(),
      source: "other",
    });
  };

  const year = overview?.year || new Date().getFullYear();
  const netPositive = (overview?.net_profit || 0) >= 0;

  return (
    <div className="space-y-6" data-testid="financials-page">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-semibold font-['Outfit'] tracking-tight">Financials</h1>
          <p className="text-[#4B6370] mt-1">Your books at a glance — income, overhead, and what’s still outstanding.</p>
        </div>
        <Button data-testid="add-overhead-expense-btn" onClick={() => { setTab("overhead"); openNewExpense(); }} className="bg-[#0A4D68] hover:bg-[#083D53] gap-2">
          <Plus size={18} /> Add Expense
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="space-y-6">
        <TabsList className="bg-white border border-slate-200 h-11 p-1 w-full sm:w-auto flex flex-wrap">
          <TabsTrigger value="overview" data-testid="financials-overview-tab" className="px-4 data-[state=active]:bg-[#0A4D68] data-[state=active]:text-white">Overview</TabsTrigger>
          <TabsTrigger value="overhead" data-testid="financials-overhead-tab" className="px-4 data-[state=active]:bg-[#0A4D68] data-[state=active]:text-white">Overhead</TabsTrigger>
          <TabsTrigger value="square" data-testid="financials-square-tab" className="px-4 data-[state=active]:bg-[#0A4D68] data-[state=active]:text-white">Square</TabsTrigger>
          <TabsTrigger value="tax" data-testid="financials-tax-tab" className="px-4 data-[state=active]:bg-[#0A4D68] data-[state=active]:text-white">Tax Assistant</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6 mt-0">
          {overviewLoading && <div className="text-[#4B6370]">Loading financials…</div>}
          {overview && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                <StatCard
                  testid="fin-income-ytd"
                  icon={TrendingUp}
                  label={`Total Income (${year})`}
                  value={usd(overview.income_ytd)}
                  sub="Collected from invoices"
                  accent="bg-emerald-100 text-emerald-600"
                  onClick={() => navigate("/invoices")}
                />
                <StatCard
                  testid="fin-expenses-ytd"
                  icon={TrendingDown}
                  label={`Total Expenses (${year})`}
                  value={usd(overview.expenses_ytd)}
                  sub="Overhead + job costs"
                  accent="bg-amber-100 text-amber-700"
                  onClick={() => setTab("overhead")}
                />
                <StatCard
                  testid="fin-net-profit"
                  icon={Wallet}
                  label="Net Profit"
                  value={usd(overview.net_profit)}
                  sub={netPositive ? "Income minus expenses" : "Expenses currently exceed income"}
                  accent="bg-[#0A4D68]/10 text-[#0A4D68]"
                  valueColor={netPositive ? "text-[#0A4D68]" : "text-red-600"}
                />
                <StatCard
                  testid="fin-outstanding"
                  icon={Receipt}
                  label="Outstanding Invoices"
                  value={usd(overview.outstanding)}
                  sub={`${overview.outstanding_count} unpaid or partial`}
                  accent="bg-[#C9A227]/15 text-[#C9A227]"
                  onClick={() => navigate("/invoices")}
                />
              </div>

              {overview.month_overhead ? (
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 sm:p-6" data-testid="month-overhead-summary">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold font-['Outfit']">{overview.month_overhead.month_label} overhead</h2>
                      <p className="text-sm text-[#4B6370] mt-0.5">
                        {overview.month_overhead.days_in_month} days this month · daily rate {usdCents(overview.month_overhead.daily_rate)} from actuals. A 7-day job would carry {usdCents((overview.month_overhead.actual_total ?? overview.month_overhead.total ?? 0) * (7 / (overview.month_overhead.days_in_month || 1)))} of overhead.
                      </p>
                    </div>
                    <button type="button" onClick={() => setTab("overhead")} className="text-sm font-medium text-[#0A4D68] hover:underline">
                      Enter this month’s bills →
                    </button>
                  </div>
                  <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <div className="text-xs uppercase tracking-wide text-[#4B6370]">Projected</div>
                      <div className="text-2xl font-semibold font-['Outfit'] text-[#0A4D68]">{usdCents(overview.month_overhead.projected_total)}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-[#4B6370]">Actual</div>
                      <div className="text-2xl font-semibold font-['Outfit'] text-[#0A4D68]">{usdCents(overview.month_overhead.actual_total ?? overview.month_overhead.total)}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-[#4B6370]">Difference</div>
                      <div className="text-2xl font-semibold font-['Outfit'] text-[#8A7018]">{usdCents(overview.month_overhead.difference)}</div>
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold font-['Outfit']">Income breakdown</h2>
                      <p className="text-sm text-[#4B6370]">Collected from invoices vs everything else</p>
                    </div>
                    <Button data-testid="add-other-income-btn" variant="outline" size="sm" className="h-8 border-[#0A4D68]/30 text-[#0A4D68]" onClick={() => setOtherOpen(true)}>
                      <Plus size={14} /> Other
                    </Button>
                  </div>
                  <div className="mt-4">
                    <MixBar leftValue={overview.invoice_income_ytd} rightValue={overview.other_income_ytd} leftColor="bg-emerald-500" rightColor="bg-[#C9A227]" />
                  </div>
                  <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button type="button" onClick={() => navigate("/invoices")} className="rounded-lg bg-slate-50 p-4 text-left hover:bg-slate-100">
                      <div className="text-xs text-[#4B6370]">Collected from invoices</div>
                      <div className="text-xl font-semibold font-['Outfit'] text-emerald-600" data-testid="fin-invoice-income">{usdCents(overview.invoice_income_ytd)}</div>
                    </button>
                    <div className="rounded-lg bg-slate-50 p-4">
                      <div className="text-xs text-[#4B6370]">Other income</div>
                      <div className="text-xl font-semibold font-['Outfit'] text-[#C9A227]" data-testid="fin-other-income">{usdCents(overview.other_income_ytd)}</div>
                      <div className="text-xs text-[#4B6370] mt-1">Cash, refunds, or Square later</div>
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold font-['Outfit']">Expense breakdown</h2>
                      <p className="text-sm text-[#4B6370]">Overhead vs actual job costs</p>
                    </div>
                    <button type="button" onClick={() => setTab("overhead")} className="text-sm font-medium text-[#0A4D68] hover:underline" data-testid="goto-overhead-btn">
                      Manage overhead →
                    </button>
                  </div>
                  <div className="mt-4">
                    <MixBar leftValue={overview.overhead_ytd} rightValue={overview.job_costs_ytd} leftColor="bg-[#0A4D68]" rightColor="bg-amber-500" />
                  </div>
                  <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button type="button" onClick={() => setTab("overhead")} className="rounded-lg bg-slate-50 p-4 text-left hover:bg-slate-100">
                      <div className="text-xs text-[#4B6370]">Overhead</div>
                      <div className="text-xl font-semibold font-['Outfit'] text-[#0A4D68]" data-testid="fin-overhead-ytd">{usdCents(overview.overhead_ytd)}</div>
                      <div className="text-xs text-[#4B6370] mt-1">Insurance, rent, vehicles…</div>
                    </button>
                    <button type="button" onClick={() => navigate("/jobs")} className="rounded-lg bg-slate-50 p-4 text-left hover:bg-slate-100">
                      <div className="text-xs text-[#4B6370]">Job costs</div>
                      <div className="text-xl font-semibold font-['Outfit'] text-amber-600" data-testid="fin-job-costs-ytd">{usdCents(overview.job_costs_ytd)}</div>
                      <div className="text-xs text-[#4B6370] mt-1">Actual expenses from Jobs</div>
                    </button>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 p-6 border-b border-slate-200">
                  <div>
                    <h2 className="text-lg font-semibold font-['Outfit']">Profit by Job</h2>
                    <p className="text-sm text-[#4B6370]">Collected invoice payments minus actual job costs</p>
                  </div>
                  <button type="button" onClick={() => navigate("/jobs")} className="text-sm font-medium text-[#0A4D68] hover:underline">
                    Open Jobs →
                  </button>
                </div>
                {(overview.jobs_profit || []).length === 0 ? (
                  <div className="p-6 text-sm text-[#4B6370] flex items-center gap-2">
                    <HardHat size={16} className="text-slate-300" />
                    No job profit yet. Log actual expenses on a job or collect an invoice linked to that job.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm" data-testid="profit-by-job-table">
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-[#4B6370]">
                          <th className="px-5 py-3 font-medium">Job</th>
                          <th className="px-5 py-3 font-medium">Client</th>
                          <th className="px-5 py-3 font-medium">Status</th>
                          <th className="px-5 py-3 font-medium text-right">Income</th>
                          <th className="px-5 py-3 font-medium text-right">Costs</th>
                          <th className="px-5 py-3 font-medium text-right">Profit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {overview.jobs_profit.map((row) => (
                          <tr key={row.id} data-testid={`job-profit-${row.id}`} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                            <td className="px-5 py-3">
                              <div className="font-medium">{row.name}</div>
                              <div className="text-xs text-[#4B6370]">{row.job_number}</div>
                            </td>
                            <td className="px-5 py-3 text-[#4B6370]">{row.client_name || "—"}</td>
                            <td className="px-5 py-3">{row.status ? <StatusBadge status={row.status} /> : "—"}</td>
                            <td className="px-5 py-3 text-right text-emerald-600">{usdCents(row.income)}</td>
                            <td className="px-5 py-3 text-right text-amber-600">{usdCents(row.costs)}</td>
                            <td className={`px-5 py-3 text-right font-semibold font-['Outfit'] ${row.profit >= 0 ? "text-[#0A4D68]" : "text-red-600"}`}>
                              {usdCents(row.profit)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="overhead" className="space-y-6 mt-0">
          <OverheadLedger
            year={ohYear}
            month={ohMonth}
            onYearChange={setOhYear}
            onMonthChange={setOhMonth}
            monthly={monthly}
            loading={catsLoading || monthlyLoading}
            onAddCategory={openNewCategory}
            onEditCategory={openEditCategory}
            onDeleteCategory={(id) => removeCategory.mutate(id)}
            onAddExtraExpense={openNewExpense}
            onEditExpense={openEditExpense}
            onDeleteExpense={(id) => removeExpense.mutate(id)}
            invalidate={invalidateBooks}
          />
        </TabsContent>

        <TabsContent value="square" className="mt-0">
          <SquareStatements />
        </TabsContent>

        <TabsContent value="tax" className="space-y-6 mt-0" data-testid="tax-assistant-section">
          <div className="bg-[#0A4D68] rounded-xl shadow-sm p-6 text-white">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#C9A227]/20 text-[#C9A227]"><Scale size={20} /></span>
              <div>
                <h2 className="text-lg font-semibold font-['Outfit']">Tax Assistant</h2>
                <p className="text-sm text-white/80 mt-1 max-w-3xl leading-relaxed">
                  This is the foundation for Revival Pro’s accounting expert. Totals and expense history are ready. The agent is not connected yet — it will classify write-offs, estimate tax, and ask follow-up questions here.
                </p>
              </div>
            </div>
          </div>

          {taxSummaryLoading && <div className="text-[#4B6370]">Loading tax summary…</div>}
          {taxSummary && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              <StatCard
                testid="tax-income-total"
                icon={TrendingUp}
                label={`Income (${taxSummary.year})`}
                value={usd(taxSummary.income_total)}
                sub="From invoices and other income"
                accent="bg-emerald-100 text-emerald-600"
              />
              <StatCard
                testid="tax-deductions-total"
                icon={Receipt}
                label="Deductions / Write-offs"
                value={usd(taxSummary.deductions_total)}
                sub={`${taxSummary.classified_count} classified · ${taxSummary.pending_count} waiting`}
                accent="bg-amber-100 text-amber-700"
              />
              <StatCard
                testid="tax-estimated-total"
                icon={Scale}
                label="Estimated Tax"
                value={usd(taxSummary.estimated_tax)}
                sub="Not calculated yet — agent coming next"
                accent="bg-[#C9A227]/15 text-[#C9A227]"
              />
            </div>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="xl:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-6 border-b border-slate-200">
                <h3 className="text-lg font-semibold font-['Outfit']">Classified expenses</h3>
                <p className="text-sm text-[#4B6370] mt-0.5">History of book expenses waiting for or already given a tax category.</p>
              </div>
              {taxClassLoading && <div className="p-6 text-[#4B6370]">Loading classifications…</div>}
              {!taxClassLoading && taxClassifications.length === 0 && (
                <div className="p-6 text-sm text-[#4B6370]">No expenses to classify yet. Log overhead or job costs and they will show up here.</div>
              )}
              {taxClassifications.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" data-testid="tax-classifications-table">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-[#4B6370]">
                        <th className="px-5 py-3 font-medium">Description</th>
                        <th className="px-5 py-3 font-medium">Source</th>
                        <th className="px-5 py-3 font-medium">Date</th>
                        <th className="px-5 py-3 font-medium">Category</th>
                        <th className="px-5 py-3 font-medium text-right">Amount</th>
                        <th className="px-5 py-3 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {taxClassifications.map((row) => (
                        <tr key={row.id} data-testid={`tax-class-${row.id}`} className="border-b border-slate-100 last:border-0">
                          <td className="px-5 py-3 font-medium">{row.description}</td>
                          <td className="px-5 py-3 text-[#4B6370] capitalize">{row.source}{row.category_name ? ` · ${row.category_name}` : ""}</td>
                          <td className="px-5 py-3 text-[#4B6370]">{fmtDate(row.date)}</td>
                          <td className="px-5 py-3 text-[#4B6370]">{row.tax_category === "unclassified" ? "—" : row.tax_category}</td>
                          <td className="px-5 py-3 text-right font-semibold font-['Outfit']">{usdCents(row.amount)}</td>
                          <td className="px-5 py-3"><StatusBadge status={taxStatusLabel(row.status)} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-6 border-b border-slate-200">
                <h3 className="text-lg font-semibold font-['Outfit']">Assistant questions</h3>
                <p className="text-sm text-[#4B6370] mt-0.5">When a write-off is unclear, the agent will ask here.</p>
              </div>
              {taxQuestionsLoading && <div className="p-6 text-[#4B6370]">Loading questions…</div>}
              {!taxQuestionsLoading && taxQuestions.length === 0 && (
                <div className="p-6 text-sm text-[#4B6370] flex gap-2" data-testid="tax-questions-empty">
                  <MessageCircleQuestion size={18} className="shrink-0 text-[#C9A227] mt-0.5" />
                  <span>No questions yet. The Tax Assistant will post clarifying questions here when it is unsure about a classification.</span>
                </div>
              )}
              <div className="divide-y divide-slate-100">
                {taxQuestions.map((q) => (
                  <div key={q.id} data-testid={`tax-question-${q.id}`} className="p-5 space-y-3">
                    <div className="text-sm font-medium">{q.question}</div>
                    {q.status === "answered" ? (
                      <div className="rounded-lg bg-slate-50 p-3 text-sm text-[#4B6370]">
                        <span className="font-medium text-[#0A4D68]">Your answer: </span>{q.answer}
                      </div>
                    ) : (
                      <form
                        className="space-y-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const answer = (answerDrafts[q.id] || "").trim();
                          if (!answer) return toast.error("Enter an answer");
                          answerQuestion.mutate({ id: q.id, answer });
                        }}
                      >
                        <Textarea
                          data-testid={`tax-answer-${q.id}`}
                          value={answerDrafts[q.id] || ""}
                          onChange={(e) => setAnswerDrafts({ ...answerDrafts, [q.id]: e.target.value })}
                          placeholder="Type your answer…"
                          rows={3}
                        />
                        <Button type="submit" size="sm" disabled={answerQuestion.isPending} className="bg-[#0A4D68] hover:bg-[#083D53]">
                          {answerQuestion.isPending ? "Saving…" : "Save answer"}
                        </Button>
                      </form>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={otherOpen} onOpenChange={setOtherOpen}>
        <DialogContent className="bg-white max-w-md">
          <DialogHeader>
            <DialogTitle className="font-['Outfit'] text-2xl">Add Other Income</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitOtherIncome} className="space-y-4">
            <div>
              <Label>Description</Label>
              <Input data-testid="other-income-desc-input" value={otherForm.description} onChange={(e) => setOtherForm({ ...otherForm, description: e.target.value })} placeholder="e.g. Cash deposit, refund" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Amount ($)</Label>
                <Input data-testid="other-income-amount-input" type="number" step="any" value={otherForm.amount} onChange={(e) => setOtherForm({ ...otherForm, amount: e.target.value })} />
              </div>
              <div>
                <Label>Date</Label>
                <Input data-testid="other-income-date-input" type="date" value={otherForm.date} onChange={(e) => setOtherForm({ ...otherForm, date: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea data-testid="other-income-notes-input" value={otherForm.notes} onChange={(e) => setOtherForm({ ...otherForm, notes: e.target.value })} placeholder="Optional" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOtherOpen(false)} disabled={saveOtherIncome.isPending}>Cancel</Button>
              <Button data-testid="save-other-income-btn" type="submit" disabled={saveOtherIncome.isPending} className="bg-[#0A4D68] hover:bg-[#083D53]">
                {saveOtherIncome.isPending ? "Saving…" : "Save Income"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={catOpen} onOpenChange={setCatOpen}>
        <DialogContent className="bg-white max-w-md">
          <DialogHeader>
            <DialogTitle className="font-['Outfit'] text-2xl">{editingCat ? "Rename Category" : "New Category"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitCategory} className="space-y-4">
            <div>
              <Label>Section name</Label>
              <Input data-testid="category-name-input" value={catName} onChange={(e) => setCatName(e.target.value)} placeholder="e.g. Insurance" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCatOpen(false)} disabled={saveCategory.isPending}>Cancel</Button>
              <Button data-testid="save-category-btn" type="submit" disabled={saveCategory.isPending} className="bg-[#0A4D68] hover:bg-[#083D53]">
                {saveCategory.isPending ? "Saving…" : "Save Category"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={expOpen} onOpenChange={setExpOpen}>
        <DialogContent className="bg-white max-w-md">
          <DialogHeader>
            <DialogTitle className="font-['Outfit'] text-2xl">{editingExp ? "Edit Expense" : "Add Expense"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitExpense} className="space-y-4">
            <div>
              <Label>Category</Label>
              <Select value={expForm.category_id} onValueChange={(v) => setExpForm({ ...expForm, category_id: v })}>
                <SelectTrigger data-testid="expense-category-select"><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent className="bg-white">
                  {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Description</Label>
              <Input data-testid="overhead-desc-input" value={expForm.description} onChange={(e) => setExpForm({ ...expForm, description: e.target.value })} placeholder="e.g. General liability premium" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Amount ($)</Label>
                <Input data-testid="overhead-amount-input" type="number" step="any" value={expForm.amount} onChange={(e) => setExpForm({ ...expForm, amount: e.target.value })} />
              </div>
              <div>
                <Label>Date</Label>
                <Input data-testid="overhead-date-input" type="date" value={expForm.date} onChange={(e) => setExpForm({ ...expForm, date: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea data-testid="overhead-notes-input" value={expForm.notes} onChange={(e) => setExpForm({ ...expForm, notes: e.target.value })} placeholder="Optional details" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setExpOpen(false)} disabled={saveExpense.isPending}>Cancel</Button>
              <Button data-testid="save-overhead-expense-btn" type="submit" disabled={saveExpense.isPending} className="bg-[#0A4D68] hover:bg-[#083D53]">
                {saveExpense.isPending ? "Saving…" : "Save Expense"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
