import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api, { formatApiError, downloadAuthenticatedPdf } from "@/lib/api";
import { usd, usdCents, fmtDate } from "@/lib/format";
import StatusBadge from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Pencil, Trash2, FileText, Receipt, Download, Send, FileSignature } from "lucide-react";
import { toast } from "sonner";
import PricingBreakdown from "@/components/PricingBreakdown";
import { computePricing } from "@/lib/pricing";

const CATEGORIES = ["Kitchen", "Bathroom", "Roofing", "Addition", "Exterior", "Basement", "Flooring", "Other"];
const STATUSES = ["Draft", "Sent", "Follow-up", "Won", "Lost"];
const emptyItem = () => ({ description: "", quantity: 1, unit_price: 0 });

export default function Estimates() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(null);
  const [filter, setFilter] = useState("All");
  const [pdfBusyId, setPdfBusyId] = useState(null);

  const { data: estimates = [], isLoading } = useQuery({
    queryKey: ["estimates"],
    queryFn: async () => (await api.get("/estimates")).data,
  });
  const { data: clients = [] } = useQuery({
    queryKey: ["clients"],
    queryFn: async () => (await api.get("/clients")).data,
  });
  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => (await api.get("/settings")).data,
  });
  const { data: monthlyOverhead } = useQuery({
    queryKey: ["financials-monthly-now"],
    queryFn: async () => (await api.get("/financials/monthly-overhead")).data,
  });

  const save = useMutation({
    mutationFn: async (payload) =>
      editing ? api.put(`/estimates/${editing.id}`, payload) : api.post("/estimates", payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["estimates"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(editing ? "Estimate updated" : "Estimate created");
      setOpen(false);
    },
    onError: () => toast.error("Something went wrong"),
  });

  const remove = useMutation({
    mutationFn: async (id) => api.delete(`/estimates/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["estimates"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Estimate deleted");
    },
  });

  const convert = useMutation({
    mutationFn: async (id) => api.post(`/estimates/${id}/convert`),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(`Invoice ${res.data.invoice_number} created`);
      navigate("/invoices");
    },
    onError: async (err) => toast.error(await formatApiError(err, "Could not convert this estimate to an invoice. Please try again.")),
  });

  const downloadPdf = async (e) => {
    if (pdfBusyId) return;
    setPdfBusyId(e.id);
    try {
      await downloadAuthenticatedPdf(`/estimates/${e.id}/pdf`, `${e.estimate_number}.pdf`, "Could not generate the estimate PDF. Please try again.");
      toast.success("PDF downloaded");
    } catch (err) {
      toast.error(await formatApiError(err, "Could not generate the estimate PDF. Please try again."));
    } finally {
      setPdfBusyId(null);
    }
  };

  const sendEmail = useMutation({
    mutationFn: async (id) => api.post(`/estimates/${id}/send-email`),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["estimates"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(`Estimate emailed to ${res.data.sent_to}`);
    },
    onError: async (err) => toast.error(await formatApiError(err, "Could not send the estimate. Please try again.")),
  });

  const generate = useMutation({
    mutationFn: async (id) => api.post(`/estimates/${id}/generate`),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["contracts"] });
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Contract, invoice, and job created");
      navigate(`/contracts/${res.data.contract.id}`);
    },
    onError: async (err) => toast.error(await formatApiError(err, "Could not generate the contract, invoice, and job. Please try again.")),
  });

  const openNew = () => {
    setEditing(null);
    setForm({
      client_id: "", client_name: "", category: "Kitchen", status: "Draft", tax_rate: 0, notes: "",
      terms: settings?.estimate_terms || "",
      line_items: [emptyItem()],
      materials_cost: "", labor_cost: "", subcontractors_cost: "", other_cost: "",
      estimated_days: "", profit_margin: settings?.default_profit_margin ?? 20,
      apply_optional_tax: false,
    });
    setOpen(true);
  };
  const openEdit = (e) => {
    setEditing(e);
    setForm({
      client_id: e.client_id, client_name: e.client_name, category: e.category, status: e.status,
      tax_rate: e.tax_rate, notes: e.notes || "", terms: e.terms || settings?.estimate_terms || "",
      line_items: (e.line_items || []).map((i) => ({ description: i.description, quantity: i.quantity, unit_price: i.unit_price })),
      materials_cost: e.materials_cost || "",
      labor_cost: e.labor_cost || "",
      subcontractors_cost: e.subcontractors_cost || "",
      other_cost: e.other_cost || "",
      estimated_days: e.estimated_days || "",
      profit_margin: e.profit_margin ?? settings?.default_profit_margin ?? 20,
      apply_optional_tax: Boolean(e.apply_optional_tax),
    });
    setOpen(true);
  };

  const setItem = (idx, key, val) => {
    const items = [...form.line_items];
    items[idx] = { ...items[idx], [key]: val };
    setForm({ ...form, line_items: items });
  };
  const addItem = () => setForm({ ...form, line_items: [...form.line_items, emptyItem()] });
  const removeItem = (idx) => setForm({ ...form, line_items: form.line_items.filter((_, i) => i !== idx) });

  const subtotal = form ? form.line_items.reduce((s, i) => s + Number(i.quantity || 0) * Number(i.unit_price || 0), 0) : 0;
  const taxAmount = form ? subtotal * (Number(form.tax_rate || 0) / 100) : 0;
  const lineTotal = subtotal + taxAmount;
  const smartPricing = form ? computePricing({
    materials: form.materials_cost,
    labor: form.labor_cost,
    subcontractors: form.subcontractors_cost,
    other: form.other_cost,
    monthlyOverhead: monthlyOverhead?.total || 0,
    daysInMonth: monthlyOverhead?.days_in_month || 30,
    estimatedDays: form.estimated_days,
    profitMarginPct: form.profit_margin ?? settings?.default_profit_margin ?? 20,
    ccFeePct: settings?.credit_card_fee_pct ?? 3,
    salesTaxPct: settings?.sales_tax_pct ?? 6,
    optionalTaxPct: settings?.optional_tax_pct ?? 5,
    applyOptionalTax: form.apply_optional_tax,
  }) : null;
  const displayTotal = smartPricing?.smart ? smartPricing.final_price : lineTotal;

  const submit = (e) => {
    e.preventDefault();
    if (!form.client_name.trim()) return toast.error("Please select a client");
    let items = form.line_items
      .filter((i) => i.description.trim())
      .map((i) => ({ description: i.description, quantity: Number(i.quantity || 0), unit_price: Number(i.unit_price || 0), amount: 0 }));
    if (items.length === 0 && smartPricing?.smart) {
      items = [{ description: form.category || "Project", quantity: 1, unit_price: 0, amount: 0 }];
    }
    if (items.length === 0) return toast.error("Add at least one line item or enter job costs");
    const payload = {
      ...form,
      tax_rate: Number(form.tax_rate || 0),
      materials_cost: Number(form.materials_cost || 0),
      labor_cost: Number(form.labor_cost || 0),
      subcontractors_cost: Number(form.subcontractors_cost || 0),
      other_cost: Number(form.other_cost || 0),
      estimated_days: Number(form.estimated_days || 0),
      profit_margin: form.profit_margin === "" || form.profit_margin == null ? null : Number(form.profit_margin),
      apply_optional_tax: Boolean(form.apply_optional_tax),
      line_items: items,
    };
    save.mutate(payload);
  };

  const onClientChange = (id) => {
    const c = clients.find((x) => x.id === id);
    setForm({ ...form, client_id: id, client_name: c ? c.name : "" });
  };

  const filtered = filter === "All" ? estimates : estimates.filter((e) => e.status === filter);

  return (
    <div className="space-y-6" data-testid="estimates-page">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-semibold font-['Outfit'] tracking-tight">Estimates</h1>
          <p className="text-[#4B6370] mt-1">Build professional estimates and track your pipeline.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="add-estimate-btn" onClick={openNew} className="bg-[#0A4D68] hover:bg-[#083D53] gap-2">
              <Plus size={18} /> New Estimate
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-white max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="font-['Outfit'] text-2xl">{editing ? "Edit Estimate" : "New Estimate"}</DialogTitle>
            </DialogHeader>
            {form && (
              <form onSubmit={submit} className="space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <Label>Client</Label>
                    <Select value={form.client_id} onValueChange={onClientChange}>
                      <SelectTrigger data-testid="estimate-client-select"><SelectValue placeholder="Select client" /></SelectTrigger>
                      <SelectContent className="bg-white">
                        {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Category</Label>
                    <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                      <SelectTrigger data-testid="estimate-category-select"><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-white">
                        {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Status</Label>
                    <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                      <SelectTrigger data-testid="estimate-status-select"><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-white">
                        {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="rounded-xl border border-[#0A4D68]/20 bg-[#F4F7F8] p-4 space-y-3" data-testid="estimate-cost-worksheet">
                  <div>
                    <div className="font-['Outfit'] font-semibold text-[#061A23]">What will this job cost us?</div>
                    <p className="text-xs text-[#4B6370] mt-0.5">
                      Revival Pro adds this month’s overhead ({monthlyOverhead?.month_label || "this month"} · {monthlyOverhead?.days_in_month || "—"} days) using estimated days, then profit, card fee, and tax.
                    </p>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <Label>Materials $</Label>
                      <Input type="number" step="any" min="0" value={form.materials_cost} onChange={(e) => setForm({ ...form, materials_cost: e.target.value })} data-testid="est-materials" />
                    </div>
                    <div>
                      <Label>Labor $</Label>
                      <Input type="number" step="any" min="0" value={form.labor_cost} onChange={(e) => setForm({ ...form, labor_cost: e.target.value })} data-testid="est-labor" />
                    </div>
                    <div>
                      <Label>Subcontractors $</Label>
                      <Input type="number" step="any" min="0" value={form.subcontractors_cost} onChange={(e) => setForm({ ...form, subcontractors_cost: e.target.value })} data-testid="est-subs" />
                    </div>
                    <div>
                      <Label>Other $</Label>
                      <Input type="number" step="any" min="0" value={form.other_cost} onChange={(e) => setForm({ ...form, other_cost: e.target.value })} data-testid="est-other" />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <Label>Estimated days to complete</Label>
                      <Input type="number" step="any" min="0" value={form.estimated_days} onChange={(e) => setForm({ ...form, estimated_days: e.target.value })} data-testid="est-days" />
                    </div>
                    <div>
                      <Label>Profit margin (%)</Label>
                      <Input type="number" step="any" min="0" value={form.profit_margin} onChange={(e) => setForm({ ...form, profit_margin: e.target.value })} data-testid="est-margin" />
                    </div>
                    <label className="flex items-end gap-2 pb-2 text-sm text-[#061A23]">
                      <input type="checkbox" checked={Boolean(form.apply_optional_tax)} onChange={(e) => setForm({ ...form, apply_optional_tax: e.target.checked })} data-testid="est-optional-tax" />
                      Add {settings?.optional_tax_pct ?? 5}% federal + state tax
                    </label>
                  </div>
                  <PricingBreakdown
                    pricing={smartPricing ? { ...smartPricing, month_name: monthlyOverhead?.month_name } : null}
                    emptyHint="Fill in costs and days above. Enter this month’s overhead in Financials so the job can carry its share of rent, insurance, and trucks."
                  />
                </div>

                <div>
                  <Label>Line items</Label>
                  <div className="space-y-2 mt-1">
                    <div className="hidden sm:grid grid-cols-12 gap-2 text-xs text-[#4B6370] px-1">
                      <span className="col-span-6">Description</span>
                      <span className="col-span-2 text-right">Qty</span>
                      <span className="col-span-2 text-right">Unit $</span>
                      <span className="col-span-2 text-right">Amount</span>
                    </div>
                    {form.line_items.map((item, idx) => (
                      <div key={idx} className="grid grid-cols-12 gap-2 items-center" data-testid={`line-item-${idx}`}>
                        <Input className="col-span-12 sm:col-span-6" placeholder="e.g. Custom cabinets" value={item.description} onChange={(e) => setItem(idx, "description", e.target.value)} data-testid={`item-desc-${idx}`} />
                        <Input type="number" step="any" className="col-span-4 sm:col-span-2 text-right" value={item.quantity} onChange={(e) => setItem(idx, "quantity", e.target.value)} data-testid={`item-qty-${idx}`} />
                        <Input type="number" step="any" className="col-span-4 sm:col-span-2 text-right" value={item.unit_price} onChange={(e) => setItem(idx, "unit_price", e.target.value)} data-testid={`item-price-${idx}`} />
                        <div className="col-span-3 sm:col-span-1 text-right text-sm font-medium">{usd(Number(item.quantity || 0) * Number(item.unit_price || 0))}</div>
                        <button type="button" onClick={() => removeItem(idx)} className="col-span-1 text-red-500 hover:bg-red-50 rounded p-1 flex justify-center" data-testid={`remove-item-${idx}`}><Trash2 size={15} /></button>
                      </div>
                    ))}
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={addItem} className="mt-2 gap-1" data-testid="add-line-item-btn">
                    <Plus size={14} /> Add line item
                  </Button>
                </div>

                <div className="flex flex-col sm:flex-row justify-between gap-4 border-t border-slate-200 pt-4">
                  {!smartPricing?.smart ? (
                    <div className="w-40">
                      <Label>Tax rate (%)</Label>
                      <Input type="number" step="any" value={form.tax_rate} onChange={(e) => setForm({ ...form, tax_rate: e.target.value })} data-testid="estimate-tax-input" />
                    </div>
                  ) : (
                    <p className="text-sm text-[#4B6370] max-w-sm">Sales tax is 6% on materials only. Line items are the scope of work; the price comes from the worksheet.</p>
                  )}
                  <div className="sm:w-64 space-y-1 text-sm">
                    {!smartPricing?.smart ? (
                      <>
                        <div className="flex justify-between"><span className="text-[#4B6370]">Subtotal</span><span>{usdCents(subtotal)}</span></div>
                        <div className="flex justify-between"><span className="text-[#4B6370]">Tax</span><span>{usdCents(taxAmount)}</span></div>
                      </>
                    ) : null}
                    <div className="flex justify-between text-lg font-semibold font-['Outfit'] border-t border-slate-200 pt-1"><span>Total</span><span data-testid="estimate-total">{usdCents(displayTotal)}</span></div>
                  </div>
                </div>

                <div>
                  <Label>Terms of estimate</Label>
                  <p className="text-xs text-[#4B6370] mt-1 mb-1">Prints on the PDF. Starts from Company Profile — change it for this job if you need to.</p>
                  <Textarea data-testid="estimate-terms-field" rows={6} value={form.terms || ""} onChange={(e) => setForm({ ...form, terms: e.target.value })} />
                </div>

                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button data-testid="save-estimate-btn" type="submit" disabled={save.isPending} className="bg-[#0A4D68] hover:bg-[#083D53]">
                    {save.isPending ? "Saving…" : "Save Estimate"}
                  </Button>
                </DialogFooter>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </div>

      {/* Status filters */}
      <div className="flex flex-wrap gap-2">
        {["All", ...STATUSES].map((s) => (
          <button key={s} data-testid={`filter-${s}`} onClick={() => setFilter(s)}
            className={`px-3.5 py-1.5 rounded-full text-sm font-medium border ${filter === s ? "bg-[#0A4D68] text-white border-[#0A4D68]" : "bg-white text-[#4B6370] border-slate-200 hover:border-[#0A4D68]"}`}>
            {s}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[#4B6370]">
                <th className="p-4 font-medium">Estimate #</th>
                <th className="p-4 font-medium">Client</th>
                <th className="p-4 font-medium">Category</th>
                <th className="p-4 font-medium">Status</th>
                <th className="p-4 font-medium text-right">Total</th>
                <th className="p-4 font-medium">Created</th>
                <th className="p-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={7} className="p-6 text-[#4B6370]">Loading…</td></tr>}
              {!isLoading && filtered.length === 0 && (
                <tr><td colSpan={7} className="p-6 text-[#4B6370]">No estimates here. Create your first estimate.</td></tr>
              )}
              {filtered.map((e) => (
                <tr key={e.id} data-testid={`estimate-row-${e.id}`} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="p-4 font-medium text-[#0A4D68] flex items-center gap-2"><FileText size={15} />{e.estimate_number}</td>
                  <td className="p-4">{e.client_name}</td>
                  <td className="p-4 text-[#4B6370]">{e.category}</td>
                  <td className="p-4"><StatusBadge status={e.status} /></td>
                  <td className="p-4 text-right font-semibold font-['Outfit']">{usd(e.total)}</td>
                  <td className="p-4 text-[#4B6370]">{fmtDate(e.created_at)}</td>
                  <td className="p-4">
                    <div className="flex items-center justify-end gap-1 flex-wrap">
                      {e.status === "Won" && (
                        <>
                          <button data-testid={`convert-estimate-${e.id}`} onClick={() => convert.mutate(e.id)} disabled={convert.isPending || generate.isPending} title="Convert to invoice"
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-[#0A4D68] hover:bg-[#083D53] text-white text-xs font-semibold disabled:opacity-50 disabled:pointer-events-none">
                            <Receipt size={14} /> {convert.isPending && convert.variables === e.id ? "Converting…" : "Convert to Invoice"}
                          </button>
                          <button data-testid={`generate-estimate-${e.id}`} onClick={() => generate.mutate(e.id)} disabled={generate.isPending || convert.isPending} title="Generate contract, invoice, and job"
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-[#C9A227] hover:bg-[#B38F22] text-[#061A23] text-xs font-semibold disabled:opacity-50 disabled:pointer-events-none">
                            <FileSignature size={14} /> {generate.isPending && generate.variables === e.id ? "Generating…" : "Contract & Invoice"}
                          </button>
                        </>
                      )}
                      <button data-testid={`pdf-estimate-${e.id}`} onClick={() => downloadPdf(e)} disabled={!!pdfBusyId} title="Download PDF" className="p-2 rounded-md hover:bg-slate-100 text-[#0A4D68] disabled:opacity-50 disabled:pointer-events-none"><Download size={16} /></button>
                      <button data-testid={`email-estimate-${e.id}`} onClick={() => sendEmail.mutate(e.id)} disabled={sendEmail.isPending} title="Email to client" className="p-2 rounded-md hover:bg-slate-100 text-[#0A4D68] disabled:opacity-50 disabled:pointer-events-none"><Send size={16} /></button>
                      <button data-testid={`edit-estimate-${e.id}`} onClick={() => openEdit(e)} className="p-2 rounded-md hover:bg-slate-100 text-[#0A4D68]"><Pencil size={16} /></button>
                      <button data-testid={`delete-estimate-${e.id}`} onClick={() => { if (window.confirm(`Delete ${e.estimate_number}?`)) remove.mutate(e.id); }} className="p-2 rounded-md hover:bg-red-50 text-red-500"><Trash2 size={16} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
