import { useState } from "react";
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
import { Plus, Trash2, Receipt, Download, Send, Pencil, DollarSign } from "lucide-react";
import { toast } from "sonner";

const INV_STATUSES = ["Draft", "Sent", "Partial", "Paid", "Overdue"];

const remainingBalance = (inv) => Math.max(Number(inv.amount || 0) - Number(inv.amount_paid || 0), 0);

const StatBox = ({ label, value, color }) => (
  <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
    <div className="text-sm text-[#4B6370]">{label}</div>
    <div className={`text-2xl font-semibold font-['Outfit'] mt-1 ${color}`}>{value}</div>
  </div>
);

export default function Invoices() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [paying, setPaying] = useState(null);
  const [form, setForm] = useState(null);
  const [payAmount, setPayAmount] = useState("");
  const [pdfBusyId, setPdfBusyId] = useState(null);

  const { data: invoices = [], isLoading } = useQuery({ queryKey: ["invoices"], queryFn: async () => (await api.get("/invoices")).data });
  const { data: clients = [] } = useQuery({ queryKey: ["clients"], queryFn: async () => (await api.get("/clients")).data });
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: async () => (await api.get("/settings")).data });

  const save = useMutation({
    mutationFn: async (payload) => editing ? api.put(`/invoices/${editing.id}`, payload) : api.post("/invoices", payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["financials-overview"] });
      toast.success(editing ? "Invoice updated" : "Invoice created");
      setOpen(false);
    },
    onError: async (err) => toast.error(await formatApiError(err, "Could not save the invoice. Please try again.")),
  });

  const remove = useMutation({
    mutationFn: async (id) => api.delete(`/invoices/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["invoices"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); qc.invalidateQueries({ queryKey: ["financials-overview"] }); toast.success("Invoice deleted"); },
    onError: async (err) => toast.error(await formatApiError(err, "Could not delete the invoice. Please try again.")),
  });

  const sendEmail = useMutation({
    mutationFn: async (id) => api.post(`/invoices/${id}/send-email`),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(`Invoice emailed to ${res.data.sent_to}`);
    },
    onError: async (err) => toast.error(await formatApiError(err, "Could not send the invoice. Please try again.")),
  });

  const recordPayment = useMutation({
    mutationFn: async ({ id, amount }) => api.post(`/invoices/${id}/payments`, { amount }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["financials-overview"] });
      toast.success(`Payment recorded — ${res.data.invoice_number} is now ${res.data.status}`);
      setPayOpen(false);
      setPaying(null);
      setPayAmount("");
    },
    onError: async (err) => toast.error(await formatApiError(err, "Could not record the payment. Please try again.")),
  });

  const downloadPdf = async (inv) => {
    if (pdfBusyId) return;
    setPdfBusyId(inv.id);
    try {
      await downloadAuthenticatedPdf(`/invoices/${inv.id}/pdf`, `${inv.invoice_number}.pdf`, "Could not generate the invoice PDF. Please try again.");
      toast.success("PDF downloaded");
    } catch (err) {
      toast.error(await formatApiError(err, "Could not generate the invoice PDF. Please try again."));
    } finally {
      setPdfBusyId(null);
    }
  };

  const openNew = () => { setEditing(null); setForm({ client_id: "", client_name: "", status: "Draft", amount: 0, amount_paid: 0, due_date: "", estimate_id: "", line_items: [], terms: settings?.invoice_terms || "" }); setOpen(true); };
  const openEdit = (inv) => { setEditing(inv); setForm({ client_id: inv.client_id || "", client_name: inv.client_name, status: inv.status, amount: inv.amount, amount_paid: inv.amount_paid, due_date: inv.due_date ? inv.due_date.slice(0, 10) : "", estimate_id: inv.estimate_id, line_items: inv.line_items || [], terms: inv.terms || settings?.invoice_terms || "" }); setOpen(true); };
  const openPay = (inv) => {
    setPaying(inv);
    const due = remainingBalance(inv);
    setPayAmount(due > 0 ? String(due) : "");
    setPayOpen(true);
  };

  const onClientChange = (id) => {
    const c = clients.find((x) => x.id === id);
    setForm({ ...form, client_id: id, client_name: c ? c.name : "" });
  };

  const submit = (e) => {
    e.preventDefault();
    if (!form.client_id && !form.client_name.trim()) return toast.error("Client is required");
    save.mutate({
      ...form,
      amount: Number(form.amount || 0),
      amount_paid: Number(form.amount_paid || 0),
      due_date: form.due_date ? new Date(form.due_date).toISOString() : "",
    });
  };

  const submitPayment = (e) => {
    e.preventDefault();
    if (!paying) return;
    const amount = Number(payAmount);
    if (!amount || amount <= 0) return toast.error("Enter a payment amount greater than zero");
    recordPayment.mutate({ id: paying.id, amount });
  };

  const totalBilled = invoices.reduce((s, i) => s + (i.amount || 0), 0);
  const totalPaid = invoices.reduce((s, i) => s + (i.amount_paid || 0), 0);
  const outstanding = totalBilled - totalPaid;
  const emailBusyId = sendEmail.isPending ? sendEmail.variables : null;
  const payBusyId = recordPayment.isPending ? recordPayment.variables?.id : null;

  return (
    <div className="space-y-6" data-testid="invoices-page">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-semibold font-['Outfit'] tracking-tight">Invoices</h1>
          <p className="text-[#4B6370] mt-1">Bill clients and track what's been paid.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="add-invoice-btn" onClick={openNew} className="bg-[#0A4D68] hover:bg-[#083D53] gap-2"><Plus size={18} /> New Invoice</Button>
          </DialogTrigger>
          <DialogContent className="bg-white max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle className="font-['Outfit'] text-2xl">{editing ? `Edit ${editing.invoice_number}` : "New Invoice"}</DialogTitle></DialogHeader>
            {form && (
              <form onSubmit={submit} className="space-y-4">
                <div>
                  <Label>Client</Label>
                  <Select value={form.client_id} onValueChange={onClientChange}>
                    <SelectTrigger data-testid="invoice-client-select"><SelectValue placeholder="Select client" /></SelectTrigger>
                    <SelectContent className="bg-white">{clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Amount ($)</Label>
                    <Input data-testid="invoice-amount-input" type="number" step="any" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                  </div>
                  <div>
                    <Label>Amount paid ($)</Label>
                    <Input data-testid="invoice-paid-input" type="number" step="any" value={form.amount_paid} onChange={(e) => setForm({ ...form, amount_paid: e.target.value })} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Status</Label>
                    <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                      <SelectTrigger data-testid="invoice-status-select"><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-white">{INV_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Due date</Label>
                    <Input data-testid="invoice-due-input" type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
                  </div>
                </div>
                <div>
                  <Label>Terms of invoice</Label>
                  <p className="text-xs text-[#4B6370] mt-1 mb-1">Prints on the PDF. Starts from Company Profile — change it for this invoice if you need to.</p>
                  <Textarea data-testid="invoice-terms-field" rows={6} value={form.terms || ""} onChange={(e) => setForm({ ...form, terms: e.target.value })} />
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={save.isPending}>Cancel</Button>
                  <Button data-testid="save-invoice-btn" type="submit" disabled={save.isPending} className="bg-[#0A4D68] hover:bg-[#083D53]">{save.isPending ? "Saving…" : "Save Invoice"}</Button>
                </DialogFooter>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <StatBox label="Total Billed" value={usd(totalBilled)} color="text-[#0A4D68]" />
        <StatBox label="Collected" value={usd(totalPaid)} color="text-emerald-600" />
        <StatBox label="Outstanding" value={usd(outstanding)} color="text-amber-600" />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[#4B6370]">
                <th className="p-4 font-medium">Invoice #</th>
                <th className="p-4 font-medium">Client</th>
                <th className="p-4 font-medium">Status</th>
                <th className="p-4 font-medium text-right">Amount</th>
                <th className="p-4 font-medium text-right">Paid</th>
                <th className="p-4 font-medium text-right">Balance</th>
                <th className="p-4 font-medium">Due</th>
                <th className="p-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={8} className="p-6 text-[#4B6370]">Loading…</td></tr>}
              {!isLoading && invoices.length === 0 && (
                <tr><td colSpan={8} className="p-6 text-[#4B6370]">No invoices yet. Create one or convert a won estimate.</td></tr>
              )}
              {invoices.map((inv) => {
                const balance = remainingBalance(inv);
                const rowBusy = pdfBusyId === inv.id || emailBusyId === inv.id || payBusyId === inv.id;
                return (
                  <tr key={inv.id} data-testid={`invoice-row-${inv.id}`} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="p-4 font-medium text-[#0A4D68] flex items-center gap-2"><Receipt size={15} />{inv.invoice_number}</td>
                    <td className="p-4">{inv.client_name}</td>
                    <td className="p-4"><StatusBadge status={inv.status} /></td>
                    <td className="p-4 text-right font-semibold font-['Outfit']">{usdCents(inv.amount)}</td>
                    <td className="p-4 text-right text-emerald-600">{usdCents(inv.amount_paid)}</td>
                    <td className={`p-4 text-right font-semibold font-['Outfit'] ${balance > 0 ? "text-amber-600" : "text-emerald-600"}`} data-testid={`invoice-balance-${inv.id}`}>
                      {usdCents(balance)}
                    </td>
                    <td className="p-4 text-[#4B6370]">{fmtDate(inv.due_date)}</td>
                    <td className="p-4">
                      <div className="flex items-center justify-end gap-1 flex-wrap">
                        <button data-testid={`pdf-invoice-${inv.id}`} onClick={() => downloadPdf(inv)} disabled={rowBusy} title="Download PDF" className="p-2 rounded-md hover:bg-slate-100 text-[#0A4D68] disabled:opacity-50 disabled:pointer-events-none">
                          <Download size={16} />
                        </button>
                        <button data-testid={`email-invoice-${inv.id}`} onClick={() => sendEmail.mutate(inv.id)} disabled={rowBusy} title="Email to client" className="p-2 rounded-md hover:bg-slate-100 text-[#0A4D68] disabled:opacity-50 disabled:pointer-events-none">
                          <Send size={16} />
                        </button>
                        <Button data-testid={`pay-invoice-${inv.id}`} onClick={() => openPay(inv)} disabled={rowBusy || balance <= 0} variant="outline" size="sm" className="h-8 gap-1 border-[#0A4D68]/30 text-[#0A4D68]">
                          <DollarSign size={14} /> {payBusyId === inv.id ? "Recording…" : "Record Payment"}
                        </Button>
                        <button data-testid={`edit-invoice-${inv.id}`} onClick={() => openEdit(inv)} disabled={rowBusy} title="Edit invoice" className="p-2 rounded-md hover:bg-slate-100 text-[#0A4D68] disabled:opacity-50 disabled:pointer-events-none">
                          <Pencil size={16} />
                        </button>
                        <button data-testid={`delete-invoice-${inv.id}`} onClick={() => { if (window.confirm(`Delete ${inv.invoice_number}?`)) remove.mutate(inv.id); }} disabled={rowBusy} className="p-2 rounded-md hover:bg-red-50 text-red-500 disabled:opacity-50 disabled:pointer-events-none">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="bg-white max-w-md">
          <DialogHeader>
            <DialogTitle className="font-['Outfit'] text-2xl">Record Payment</DialogTitle>
          </DialogHeader>
          {paying && (
            <form onSubmit={submitPayment} className="space-y-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-[#4B6370]">Invoice</span>
                  <span className="font-semibold text-[#0A4D68]">{paying.invoice_number}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-[#4B6370]">Total</span>
                  <span className="font-semibold font-['Outfit']">{usdCents(paying.amount)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-[#4B6370]">Already paid</span>
                  <span className="font-semibold text-emerald-600">{usdCents(paying.amount_paid)}</span>
                </div>
                <div className="flex justify-between text-sm border-t border-slate-200 pt-2">
                  <span className="text-[#4B6370]">Remaining balance</span>
                  <span className="font-semibold font-['Outfit'] text-amber-600" data-testid="payment-remaining">{usdCents(remainingBalance(paying))}</span>
                </div>
              </div>
              <div>
                <Label>Payment amount ($)</Label>
                <Input
                  data-testid="payment-amount-input"
                  type="number"
                  step="any"
                  min="0.01"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  placeholder="0.00"
                  autoFocus
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setPayOpen(false)} disabled={recordPayment.isPending}>Cancel</Button>
                <Button data-testid="save-payment-btn" type="submit" disabled={recordPayment.isPending} className="bg-[#0A4D68] hover:bg-[#083D53]">
                  {recordPayment.isPending ? "Recording…" : "Record Payment"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
