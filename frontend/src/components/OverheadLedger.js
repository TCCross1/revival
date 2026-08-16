import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import api, { formatApiError } from "@/lib/api";
import { usdCents } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { ExternalLink, FolderPlus, Paperclip, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const currentYear = () => new Date().getFullYear();

const moneyClass = (value) => {
  const n = Number(value || 0);
  if (n > 0.009) return "text-red-600";
  if (n < -0.009) return "text-emerald-600";
  return "text-[#4B6370]";
};

function MoneyField({ value, onSave, testid, disabled }) {
  const [draft, setDraft] = useState(value === 0 || value ? String(value) : "");
  useEffect(() => {
    setDraft(value === 0 || value ? String(value) : "");
  }, [value]);
  const commit = () => {
    const next = draft === "" ? 0 : Number(draft);
    if (!Number.isFinite(next) || next < 0) {
      setDraft(value === 0 || value ? String(value) : "");
      toast.error("Enter an amount of zero or more.");
      return;
    }
    if (Number(value || 0) === next) return;
    onSave(next);
  };
  return (
    <Input
      type="number"
      min="0"
      step="any"
      className="h-9 text-right font-['Outfit']"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
      data-testid={testid}
      disabled={disabled}
    />
  );
}

function LineItemRow({ item, onRename, onDelete, saveMonth, uploading, onUpload, onDeleteReceipt }) {
  const receipts = item.receipts || [];
  return (
    <tr data-testid={`overhead-line-${item.id}`} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
      <td className="px-4 sm:px-5 py-3 font-medium min-w-[180px]">{item.name}</td>
      <td className="px-3 py-3 w-[130px]">
        <MoneyField
          value={item.projected}
          onSave={(projected) => saveMonth({ itemId: item.id, projected })}
          testid={`line-projected-${item.id}`}
        />
      </td>
      <td className="px-3 py-3 w-[130px]">
        <MoneyField
          value={item.actual}
          onSave={(actual) => saveMonth({ itemId: item.id, actual })}
          testid={`line-actual-${item.id}`}
        />
      </td>
      <td className={`px-4 py-3 text-right font-semibold font-['Outfit'] whitespace-nowrap ${moneyClass(item.difference)}`} data-testid={`line-diff-${item.id}`}>
        {usdCents(item.difference)}
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap items-center justify-end gap-1">
          {receipts.map((receipt) => (
            <a
              key={receipt.id}
              href={receipt.web_view_link}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] text-[#0A4D68] hover:bg-slate-50 max-w-[140px]"
              title={receipt.filename}
              data-testid={`receipt-link-${receipt.id}`}
            >
              <ExternalLink size={12} />
              <span className="truncate">{receipt.filename || "Receipt"}</span>
            </a>
          ))}
          <label className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-[#0A4D68] hover:bg-[#0A4D68]/10 cursor-pointer">
            <Paperclip size={13} />
            <span className="hidden sm:inline">{uploading === item.id ? "Uploading…" : "Receipt"}</span>
            <input
              type="file"
              className="hidden"
              accept="application/pdf,image/*"
              data-testid={`receipt-upload-${item.id}`}
              disabled={uploading === item.id}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) onUpload(item, file);
              }}
            />
          </label>
          {receipts.map((receipt) => (
            <button
              key={`del-${receipt.id}`}
              type="button"
              className="p-1.5 rounded-md hover:bg-red-50 text-red-500"
              title="Remove receipt from this month"
              onClick={() => { if (window.confirm("Remove this receipt from the month?")) onDeleteReceipt(item.id, receipt.id); }}
            >
              <Trash2 size={13} />
            </button>
          ))}
          <button type="button" data-testid={`edit-line-${item.id}`} onClick={() => onRename(item)} className="p-1.5 rounded-md hover:bg-slate-100 text-[#0A4D68]" title="Rename line item">
            <Pencil size={14} />
          </button>
          <button
            type="button"
            data-testid={`delete-line-${item.id}`}
            onClick={() => { if (window.confirm(`Delete “${item.name}”?`)) onDelete(item.id); }}
            className="p-1.5 rounded-md hover:bg-red-50 text-red-500"
            title="Delete line item"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </td>
    </tr>
  );
}

export default function OverheadLedger({
  year,
  month,
  onYearChange,
  onMonthChange,
  monthly,
  loading,
  onAddCategory,
  onEditCategory,
  onDeleteCategory,
  onAddExtraExpense,
  onEditExpense,
  onDeleteExpense,
  invalidate,
}) {
  const [lineOpen, setLineOpen] = useState(false);
  const [editingLine, setEditingLine] = useState(null);
  const [lineName, setLineName] = useState("");
  const [lineCategoryId, setLineCategoryId] = useState("");
  const [uploading, setUploading] = useState("");
  const { data: drive } = useQuery({
    queryKey: ["google-drive-status"],
    queryFn: async () => (await api.get("/google-drive/status")).data,
  });

  const saveMonth = useMutation({
    mutationFn: async ({ itemId, projected, actual }) => {
      const payload = { year, month };
      if (projected !== undefined) payload.projected = projected;
      if (actual !== undefined) payload.actual = actual;
      return (await api.put(`/financials/line-items/${itemId}/month`, payload)).data;
    },
    onSuccess: () => invalidate(),
    onError: async (err) => toast.error(await formatApiError(err, "Could not save that amount. Please try again.")),
  });

  const saveLine = useMutation({
    mutationFn: async (payload) =>
      editingLine
        ? api.put(`/financials/line-items/${editingLine.id}`, payload)
        : api.post("/financials/line-items", payload),
    onSuccess: () => {
      invalidate();
      toast.success(editingLine ? "Line item renamed" : "Line item added");
      setLineOpen(false);
      setEditingLine(null);
      setLineName("");
    },
    onError: async (err) => toast.error(await formatApiError(err, "Could not save the line item. Please try again.")),
  });

  const removeLine = useMutation({
    mutationFn: async (id) => api.delete(`/financials/line-items/${id}`),
    onSuccess: () => {
      invalidate();
      toast.success("Line item deleted");
    },
    onError: async (err) => toast.error(await formatApiError(err, "Could not delete the line item. Please try again.")),
  });

  const removeReceipt = useMutation({
    mutationFn: async ({ itemId, receiptId }) => api.delete(`/financials/line-items/${itemId}/receipts/${receiptId}`),
    onSuccess: () => {
      invalidate();
      toast.success("Receipt removed");
    },
    onError: async (err) => toast.error(await formatApiError(err, "Could not remove the receipt. Please try again.")),
  });

  const uploadReceipt = async (item, file) => {
    setUploading(item.id);
    try {
      const body = new FormData();
      body.append("upload", file);
      await api.post(`/financials/line-items/${item.id}/receipts`, body, {
        params: { year, month },
      });
      invalidate();
      toast.success("Receipt saved to Google Drive");
    } catch (err) {
      toast.error(await formatApiError(err, "Could not upload the receipt. Connect Google Drive in Company Profile if it is not connected."));
    } finally {
      setUploading("");
    }
  };

  const openNewLine = (categoryId) => {
    setEditingLine(null);
    setLineCategoryId(categoryId);
    setLineName("");
    setLineOpen(true);
  };
  const openEditLine = (item) => {
    setEditingLine(item);
    setLineCategoryId(item.category_id);
    setLineName(item.name);
    setLineOpen(true);
  };
  const submitLine = (e) => {
    e.preventDefault();
    if (!lineName.trim()) return toast.error("Line item name is required");
    if (editingLine) saveLine.mutate({ name: lineName.trim() });
    else saveLine.mutate({ category_id: lineCategoryId, name: lineName.trim() });
  };

  const categories = monthly?.categories || [];
  const over = Number(monthly?.difference || 0) > 0.009;

  return (
    <div className="space-y-6" data-testid="overhead-ledger">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold font-['Outfit']">Monthly overhead</h2>
          <p className="text-sm text-[#4B6370] mt-0.5">
            Enter projected (budgeted) and actual amounts for each bill. Job sheets use this month’s actual total to share overhead across jobs.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm" value={month} onChange={(e) => onMonthChange(Number(e.target.value))} data-testid="overhead-month">
            {MONTHS.map((name, idx) => <option key={name} value={idx + 1}>{name}</option>)}
          </select>
          <select className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm" value={year} onChange={(e) => onYearChange(Number(e.target.value))} data-testid="overhead-year">
            {[currentYear(), currentYear() - 1, currentYear() - 2].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <Button data-testid="add-category-btn" onClick={onAddCategory} variant="outline" className="gap-2 border-[#0A4D68]/30 text-[#0A4D68]">
            <FolderPlus size={16} /> Add Category
          </Button>
        </div>
      </div>

      {!drive?.connected ? (
        <div className="rounded-xl border border-[#C9A227]/40 bg-[#FBF6E8] px-4 py-3 text-sm text-[#061A23]" data-testid="overhead-drive-hint">
          Connect <span className="font-medium">revivalhomeremodelingllc@gmail.com</span> in Company Profile to store receipts in Google Drive → Revival Pro → Overhead → Year → Month → Category.
        </div>
      ) : null}

      {monthly && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4" data-testid="monthly-overhead-cards">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <div className="text-sm text-[#4B6370]">Days in {monthly.month_name}</div>
            <div className="mt-2 text-3xl font-semibold font-['Outfit'] text-[#061A23]" data-testid="month-days">{monthly.days_in_month}</div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <div className="text-sm text-[#4B6370]">Projected this month</div>
            <div className="mt-2 text-3xl font-semibold font-['Outfit'] text-[#0A4D68]" data-testid="month-projected-total">{usdCents(monthly.projected_total)}</div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <div className="text-sm text-[#4B6370]">Actual this month</div>
            <div className="mt-2 text-3xl font-semibold font-['Outfit'] text-[#0A4D68]" data-testid="month-overhead-total">{usdCents(monthly.actual_total ?? monthly.total)}</div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <div className="text-sm text-[#4B6370]">Difference</div>
            <div className={`mt-2 text-3xl font-semibold font-['Outfit'] ${moneyClass(monthly.difference)}`} data-testid="month-difference">
              {usdCents(monthly.difference)}
            </div>
            <div className="text-xs text-[#4B6370] mt-1">{over ? "Over budget" : Number(monthly.difference || 0) < 0 ? "Under budget" : "On budget"}</div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <div className="text-sm text-[#4B6370]">Daily overhead rate</div>
            <div className="mt-2 text-3xl font-semibold font-['Outfit'] text-[#8A7018]" data-testid="month-daily-rate">{usdCents(monthly.daily_rate)}</div>
            <div className="text-xs text-[#4B6370] mt-1">Actual ÷ {monthly.days_in_month} days</div>
          </div>
        </div>
      )}

      {monthly && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 grid grid-cols-1 sm:grid-cols-3 gap-4" data-testid="overhead-ytd-cards">
          <div>
            <div className="text-xs uppercase tracking-wide text-[#4B6370]">Year projected</div>
            <div className="mt-1 text-xl font-semibold font-['Outfit'] text-[#0A4D68]" data-testid="ytd-projected">{usdCents(monthly.ytd_projected)}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-[#4B6370]">Year actual</div>
            <div className="mt-1 text-xl font-semibold font-['Outfit'] text-[#0A4D68]" data-testid="ytd-actual">{usdCents(monthly.ytd_actual)}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-[#4B6370]">Year difference</div>
            <div className={`mt-1 text-xl font-semibold font-['Outfit'] ${moneyClass(monthly.ytd_difference)}`} data-testid="ytd-difference">{usdCents(monthly.ytd_difference)}</div>
          </div>
        </div>
      )}

      {loading && <div className="text-[#4B6370]">Loading categories…</div>}
      {!loading && categories.length === 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-10 text-center text-[#4B6370]">
          No expense categories yet. Add a section like Insurance or Vehicles to get started.
        </div>
      )}

      <div className="space-y-4">
        {categories.map((cat) => (
          <div key={cat.id} data-testid={`overhead-category-${cat.id}`} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 bg-[#0A4D68]">
              <div>
                <h3 className="text-white font-['Outfit'] font-semibold">{cat.name}</h3>
                <div className="text-xs text-white/70">
                  {(cat.line_items || []).length} line item{(cat.line_items || []).length === 1 ? "" : "s"}
                  {(cat.expenses || []).length ? ` · ${(cat.expenses || []).length} extra` : ""}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-white/80 text-xs hidden sm:inline">Projected {usdCents(cat.projected)}</span>
                <span className="text-[#C9A227] font-semibold font-['Outfit']" data-testid={`category-total-${cat.id}`}>{usdCents(cat.actual ?? cat.total)}</span>
                <button data-testid={`add-line-${cat.id}`} onClick={() => openNewLine(cat.id)} className="inline-flex items-center gap-1 rounded-md bg-[#C9A227] px-2.5 py-1.5 text-xs font-semibold text-[#061A23] hover:bg-[#B38F22]">
                  <Plus size={13} /> Add line
                </button>
                <button data-testid={`add-expense-${cat.id}`} onClick={() => onAddExtraExpense(cat.id)} className="inline-flex items-center gap-1 rounded-md bg-white/10 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-white/20">
                  Extra
                </button>
                <button data-testid={`edit-category-${cat.id}`} onClick={() => onEditCategory(cat)} className="p-1.5 rounded-md text-white/80 hover:bg-white/10" title="Rename category">
                  <Pencil size={14} />
                </button>
                <button
                  data-testid={`delete-category-${cat.id}`}
                  onClick={() => { if (window.confirm(`Delete “${cat.name}” and all of its line items?`)) onDeleteCategory(cat.id); }}
                  className="p-1.5 rounded-md text-white/70 hover:bg-red-500/20 hover:text-red-100"
                  title="Delete category"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>

            {(cat.line_items || []).length === 0 && (cat.expenses || []).length === 0 ? (
              <div className="p-5 text-sm text-[#4B6370]">No line items in this section yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-[#4B6370]">
                      <th className="px-5 py-3 font-medium">Line item</th>
                      <th className="px-3 py-3 font-medium text-right">Projected</th>
                      <th className="px-3 py-3 font-medium text-right">Actual</th>
                      <th className="px-4 py-3 font-medium text-right">Difference</th>
                      <th className="px-4 py-3 font-medium text-right">Receipts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(cat.line_items || []).map((item) => (
                      <LineItemRow
                        key={item.id}
                        item={item}
                        onRename={openEditLine}
                        onDelete={(id) => removeLine.mutate(id)}
                        saveMonth={(payload) => saveMonth.mutate(payload)}
                        uploading={uploading}
                        onUpload={uploadReceipt}
                        onDeleteReceipt={(itemId, receiptId) => removeReceipt.mutate({ itemId, receiptId })}
                      />
                    ))}
                    {(cat.expenses || []).map((exp) => (
                      <tr key={exp.id} data-testid={`overhead-expense-${exp.id}`} className="border-b border-slate-100 last:border-0 bg-slate-50/70">
                        <td className="px-5 py-3">
                          <div className="font-medium">{exp.description}</div>
                          <div className="text-xs text-[#4B6370]">Extra expense</div>
                        </td>
                        <td className="px-3 py-3 text-right text-[#4B6370]">—</td>
                        <td className="px-3 py-3 text-right font-semibold font-['Outfit']">{usdCents(exp.amount)}</td>
                        <td className="px-4 py-3 text-right text-red-600 font-semibold font-['Outfit']">{usdCents(exp.amount)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button data-testid={`edit-expense-${exp.id}`} onClick={() => onEditExpense(exp)} className="p-2 rounded-md hover:bg-slate-100 text-[#0A4D68]">
                              <Pencil size={14} />
                            </button>
                            <button
                              data-testid={`delete-expense-${exp.id}`}
                              onClick={() => { if (window.confirm("Delete this expense?")) onDeleteExpense(exp.id); }}
                              className="p-2 rounded-md hover:bg-red-50 text-red-500"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>

      <Dialog open={lineOpen} onOpenChange={setLineOpen}>
        <DialogContent className="bg-white max-w-md">
          <DialogHeader>
            <DialogTitle className="font-['Outfit'] text-2xl">{editingLine ? "Rename line item" : "New line item"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitLine} className="space-y-4">
            <div>
              <Label>Name</Label>
              <Input data-testid="line-item-name-input" value={lineName} onChange={(e) => setLineName(e.target.value)} placeholder="e.g. Fuel" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setLineOpen(false)} disabled={saveLine.isPending}>Cancel</Button>
              <Button data-testid="save-line-item-btn" type="submit" disabled={saveLine.isPending} className="bg-[#0A4D68] hover:bg-[#083D53]">
                {saveLine.isPending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
