import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import { usd, usdCents, fmtDate } from "@/lib/format";
import StatusBadge from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, Receipt } from "lucide-react";
import { toast } from "sonner";

const INV_STATUSES = ["Draft", "Sent", "Partial", "Paid", "Overdue"];

const StatBox = ({ label, value, color }) => (
  <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
    <div className="text-sm text-[#4B6370]">{label}</div>
    <div className={`text-2xl font-semibold font-['Outfit'] mt-1 ${color}`}>{value}</div>
  </div>
);

export default function Invoices() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(null);

  const { data: invoices = [], isLoading } = useQuery({ queryKey: ["invoices"], queryFn: async () => (await api.get("/invoices")).data });
  const { data: clients = [] } = useQuery({ queryKey: ["clients"], queryFn: async () => (await api.get("/clients")).data });

  const save = useMutation({
    mutationFn: async (payload) => editing ? api.put(`/invoices/${editing.id}`, payload) : api.post("/invoices", payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(editing ? "Invoice updated" : "Invoice created");
      setOpen(false);
    },
    onError: () => toast.error("Something went wrong"),
  });

  const remove = useMutation({
    mutationFn: async (id) => api.delete(`/invoices/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["invoices"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); toast.success("Invoice deleted"); },
  });

  const openNew = () => { setEditing(null); setForm({ client_name: "", status: "Draft", amount: 0, amount_paid: 0, due_date: "", estimate_id: "", line_items: [] }); setOpen(true); };
  const openEdit = (inv) => { setEditing(inv); setForm({ client_name: inv.client_name, status: inv.status, amount: inv.amount, amount_paid: inv.amount_paid, due_date: inv.due_date ? inv.due_date.slice(0, 10) : "", estimate_id: inv.estimate_id, line_items: inv.line_items || [] }); setOpen(true); };

  const submit = (e) => {
    e.preventDefault();
    if (!form.client_name.trim()) return toast.error("Client is required");
    save.mutate({
      ...form,
      amount: Number(form.amount || 0),
      amount_paid: Number(form.amount_paid || 0),
      due_date: form.due_date ? new Date(form.due_date).toISOString() : "",
    });
  };

  const totalBilled = invoices.reduce((s, i) => s + (i.amount || 0), 0);
  const totalPaid = invoices.reduce((s, i) => s + (i.amount_paid || 0), 0);
  const outstanding = totalBilled - totalPaid;

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
          <DialogContent className="bg-white max-w-lg">
            <DialogHeader><DialogTitle className="font-['Outfit'] text-2xl">{editing ? `Edit ${editing.invoice_number}` : "New Invoice"}</DialogTitle></DialogHeader>
            {form && (
              <form onSubmit={submit} className="space-y-4">
                <div>
                  <Label>Client</Label>
                  <Select value={form.client_name} onValueChange={(v) => setForm({ ...form, client_name: v })}>
                    <SelectTrigger data-testid="invoice-client-select"><SelectValue placeholder="Select client" /></SelectTrigger>
                    <SelectContent className="bg-white">{clients.map((c) => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}</SelectContent>
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
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button data-testid="save-invoice-btn" type="submit" className="bg-[#0A4D68] hover:bg-[#083D53]">Save Invoice</Button>
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
                <th className="p-4 font-medium">Due</th>
                <th className="p-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={7} className="p-6 text-[#4B6370]">Loading…</td></tr>}
              {!isLoading && invoices.length === 0 && (
                <tr><td colSpan={7} className="p-6 text-[#4B6370]">No invoices yet. Create one or convert a won estimate.</td></tr>
              )}
              {invoices.map((inv) => (
                <tr key={inv.id} data-testid={`invoice-row-${inv.id}`} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="p-4 font-medium text-[#0A4D68] flex items-center gap-2"><Receipt size={15} />{inv.invoice_number}</td>
                  <td className="p-4">{inv.client_name}</td>
                  <td className="p-4"><StatusBadge status={inv.status} /></td>
                  <td className="p-4 text-right font-semibold font-['Outfit']">{usdCents(inv.amount)}</td>
                  <td className="p-4 text-right text-emerald-600">{usdCents(inv.amount_paid)}</td>
                  <td className="p-4 text-[#4B6370]">{fmtDate(inv.due_date)}</td>
                  <td className="p-4">
                    <div className="flex items-center justify-end gap-1">
                      <Button data-testid={`edit-invoice-${inv.id}`} onClick={() => openEdit(inv)} variant="outline" size="sm" className="h-8">Record payment</Button>
                      <button data-testid={`delete-invoice-${inv.id}`} onClick={() => { if (window.confirm(`Delete ${inv.invoice_number}?`)) remove.mutate(inv.id); }} className="p-2 rounded-md hover:bg-red-50 text-red-500"><Trash2 size={16} /></button>
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
