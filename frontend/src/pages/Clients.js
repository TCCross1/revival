import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import { fmtDate } from "@/lib/format";
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
import { Plus, Search, Pencil, Trash2, Phone, Mail, MapPin, Eye } from "lucide-react";
import { toast } from "sonner";

const SOURCES = ["Thumbtack", "Angi", "Referral", "Website", "Google", "Facebook", "Walk-in", "Other"];
const STATUSES = ["Lead", "Active", "Won", "Lost"];
const EMPTY = { name: "", phone: "", email: "", address: "", source: "Referral", status: "Lead", notes: "" };

export default function Clients() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [search, setSearch] = useState("");

  const { data: clients = [], isLoading } = useQuery({
    queryKey: ["clients"],
    queryFn: async () => (await api.get("/clients")).data,
  });

  const save = useMutation({
    mutationFn: async (payload) =>
      editing ? api.put(`/clients/${editing.id}`, payload) : api.post("/clients", payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clients"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(editing ? "Client updated" : "Client added");
      setOpen(false);
    },
    onError: () => toast.error("Something went wrong"),
  });

  const remove = useMutation({
    mutationFn: async (id) => api.delete(`/clients/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clients"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Client deleted");
    },
  });

  const openNew = () => { setEditing(null); setForm(EMPTY); setOpen(true); };
  const openEdit = (c) => { setEditing(c); setForm({ ...EMPTY, ...c }); setOpen(true); };

  const submit = (e) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.error("Name is required");
    save.mutate(form);
  };

  const filtered = clients.filter((c) =>
    [c.name, c.email, c.phone, c.source].join(" ").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6" data-testid="clients-page">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-semibold font-['Outfit'] tracking-tight">Clients</h1>
          <p className="text-[#4B6370] mt-1">Your simple contact book for leads and customers.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="add-client-btn" onClick={openNew} className="bg-[#0A4D68] hover:bg-[#083D53] gap-2">
              <Plus size={18} /> Add Client
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-white max-w-lg">
            <DialogHeader>
              <DialogTitle className="font-['Outfit'] text-2xl">{editing ? "Edit Client" : "Add Client"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={submit} className="space-y-4">
              <div>
                <Label>Full name</Label>
                <Input data-testid="client-name-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Sarah Mitchell" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Phone</Label>
                  <Input data-testid="client-phone-input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="(512) 555-0100" />
                </div>
                <div>
                  <Label>Email</Label>
                  <Input data-testid="client-email-input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@email.com" />
                </div>
              </div>
              <div>
                <Label>Address</Label>
                <Input data-testid="client-address-input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Street, City, State" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Lead source</Label>
                  <Select value={form.source} onValueChange={(v) => setForm({ ...form, source: v })}>
                    <SelectTrigger data-testid="client-source-select"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-white">
                      {SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Status</Label>
                  <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                    <SelectTrigger data-testid="client-status-select"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-white">
                      {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>Notes</Label>
                <Textarea data-testid="client-notes-input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Project details, preferences…" />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button data-testid="save-client-btn" type="submit" disabled={save.isPending} className="bg-[#0A4D68] hover:bg-[#083D53]">
                  {save.isPending ? "Saving…" : "Save Client"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
        <Input data-testid="client-search-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search clients…" className="pl-10 bg-white" />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[#4B6370]">
                <th className="p-4 font-medium">Name</th>
                <th className="p-4 font-medium">Contact</th>
                <th className="p-4 font-medium">Source</th>
                <th className="p-4 font-medium">Status</th>
                <th className="p-4 font-medium">Added</th>
                <th className="p-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={6} className="p-6 text-[#4B6370]">Loading…</td></tr>}
              {!isLoading && filtered.length === 0 && (
                <tr><td colSpan={6} className="p-6 text-[#4B6370]">No clients yet. Add your first client to get started.</td></tr>
              )}
              {filtered.map((c) => (
                <tr key={c.id} data-testid={`client-row-${c.id}`} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="p-4">
                    <button onClick={() => navigate(`/clients/${c.id}`)} data-testid={`open-client-${c.id}`} className="font-medium text-[#0A4D68] hover:underline text-left">{c.name}</button>
                    {c.address && <div className="text-xs text-[#4B6370] flex items-center gap-1 mt-0.5"><MapPin size={12} />{c.address}</div>}
                  </td>
                  <td className="p-4 text-[#4B6370]">
                    {c.phone && <div className="flex items-center gap-1"><Phone size={13} />{c.phone}</div>}
                    {c.email && <div className="flex items-center gap-1 mt-0.5"><Mail size={13} />{c.email}</div>}
                  </td>
                  <td className="p-4"><span className="text-[#0A4D68] font-medium">{c.source}</span></td>
                  <td className="p-4"><StatusBadge status={c.status} /></td>
                  <td className="p-4 text-[#4B6370]">{fmtDate(c.created_at)}</td>
                  <td className="p-4">
                    <div className="flex items-center justify-end gap-1">
                      <button data-testid={`view-client-${c.id}`} onClick={() => navigate(`/clients/${c.id}`)} title="View timeline" className="p-2 rounded-md hover:bg-slate-100 text-[#0A4D68]"><Eye size={16} /></button>
                      <button data-testid={`edit-client-${c.id}`} onClick={() => openEdit(c)} className="p-2 rounded-md hover:bg-slate-100 text-[#0A4D68]"><Pencil size={16} /></button>
                      <button data-testid={`delete-client-${c.id}`} onClick={() => { if (window.confirm(`Delete ${c.name}?`)) remove.mutate(c.id); }} className="p-2 rounded-md hover:bg-red-50 text-red-500"><Trash2 size={16} /></button>
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
