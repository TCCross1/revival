import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api, { formatApiError } from "@/lib/api";
import { fmtDate, formatPhone } from "@/lib/format";
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
import { Plus, Search, Pencil, Trash2, Phone, Mail, MapPin, Eye, FileUp } from "lucide-react";
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
  const [importOpen, setImportOpen] = useState(false);
  const [importName, setImportName] = useState("");
  const [importFile, setImportFile] = useState(null);
  const [importing, setImporting] = useState(false);

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
    onError: async (err) => toast.error(await formatApiError(err, "Could not save the client. Please try again.")),
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
  const openEdit = (c) => { setEditing(c); setForm({ ...EMPTY, ...c, phone: formatPhone(c.phone) || c.phone || "" }); setOpen(true); };

  const submit = (e) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.error("Name is required");
    save.mutate(form);
  };

  const importProposal = async (e) => {
    e.preventDefault();
    if (!importFile) return toast.error("Choose the Word proposal first.");
    if (!importFile.name.toLowerCase().endsWith(".docx")) return toast.error("Upload a .docx Word file.");
    setImporting(true);
    try {
      const body = new FormData();
      body.append("file", importFile);
      if (importName.trim()) body.append("client_name", importName.trim());
      const { data } = await api.post("/proposals/ingest", body, { timeout: 60000 });
      qc.invalidateQueries({ queryKey: ["clients"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["financials-overview"] });
      toast.success(`Imported ${data.client.name}`);
      setImportOpen(false);
      setImportFile(null);
      setImportName("");
      navigate(`/clients/${data.client.id}`);
    } catch (err) {
      toast.error(await formatApiError(err, "Could not import that proposal. Please try again."));
    } finally {
      setImporting(false);
    }
  };

  const filtered = clients.filter((c) =>
    [c.name, c.email, c.phone, formatPhone(c.phone), c.source].join(" ").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6" data-testid="clients-page">
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center sm:justify-between gap-3 sm:gap-4">
        <div>
          <h1 className="text-2xl sm:text-4xl font-semibold font-['Outfit'] tracking-tight">Clients</h1>
          <p className="text-[#4B6370] mt-1 text-sm sm:text-base">Your simple contact book for leads and customers.</p>
        </div>
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
          <Button type="button" data-testid="import-proposal-btn" variant="outline" className="border-[#0B3A8F]/30 text-[#0B3A8F] gap-2 h-11" onClick={() => setImportOpen(true)}>
            <FileUp size={18} /> Import
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="add-client-btn" onClick={openNew} className="bg-[#0B3A8F] hover:bg-[#082C73] gap-2 h-11">
              <Plus size={18} /> Add
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
                <Button data-testid="save-client-btn" type="submit" disabled={save.isPending} className="bg-[#0B3A8F] hover:bg-[#082C73]">
                  {save.isPending ? "Saving…" : "Save Client"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="bg-white max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-['Outfit'] text-2xl">Import a proposal</DialogTitle>
          </DialogHeader>
          <form onSubmit={importProposal} className="space-y-4">
            <p className="text-sm text-[#4B6370]">Upload a Revival estimate or contract. Revival creates the client master file, the job sheet, the contract, and the invoice so the sale shows on the client, the job, and Financials.</p>
            <div>
              <Label htmlFor="proposal-file">Word proposal (.docx)</Label>
              <Input id="proposal-file" data-testid="proposal-file-input" type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="mt-1" onChange={(e) => setImportFile(e.target.files?.[0] || null)} />
            </div>
            <div>
              <Label htmlFor="proposal-client-name">Client name</Label>
              <Input id="proposal-client-name" data-testid="proposal-client-name" value={importName} onChange={(e) => setImportName(e.target.value)} placeholder="Leave blank to use the name in the proposal" className="mt-1" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setImportOpen(false)}>Cancel</Button>
              <Button data-testid="proposal-import-submit" type="submit" disabled={importing} className="bg-[#0B3A8F] hover:bg-[#082C73]">
                {importing ? "Importing…" : "Import"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
        <Input data-testid="client-search-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search clients…" className="pl-10 bg-white" />
      </div>

      {/* Phone card list */}
      <div className="md:hidden space-y-3" data-testid="clients-phone-list">
        {isLoading && <div className="rounded-2xl border border-slate-200 bg-white p-5 text-[#4B6370]">Loading…</div>}
        {!isLoading && filtered.length === 0 && (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 text-[#4B6370]">No clients yet. Add your first client to get started.</div>
        )}
        {filtered.map((c) => (
          <article
            key={c.id}
            data-testid={`client-card-${c.id}`}
            className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <button
                type="button"
                onClick={() => navigate(`/clients/${c.id}`)}
                data-testid={`open-client-card-${c.id}`}
                className="text-left min-w-0"
              >
                <div className="font-semibold text-[#0B3A8F] font-['Outfit'] text-lg leading-tight truncate">{c.name}</div>
                {c.address ? (
                  <div className="text-xs text-[#4B6370] flex items-center gap-1 mt-1"><MapPin size={12} /><span className="truncate">{c.address}</span></div>
                ) : null}
              </button>
              <StatusBadge status={c.status} />
            </div>
            <div className="mt-3 space-y-1 text-sm text-[#4B6370]">
              {c.phone ? <div className="flex items-center gap-1.5"><Phone size={13} />{formatPhone(c.phone)}</div> : null}
              {c.email ? <div className="flex items-center gap-1.5 truncate"><Mail size={13} />{c.email}</div> : null}
            </div>
            <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
              <span className="text-xs text-[#4B6370]">{c.source || "—"} · {fmtDate(c.created_at)}</span>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => navigate(`/clients/${c.id}`)} title="View timeline" className="p-2 rounded-md hover:bg-slate-100 text-[#0B3A8F]"><Eye size={16} /></button>
                <button type="button" onClick={() => openEdit(c)} className="p-2 rounded-md hover:bg-slate-100 text-[#0B3A8F]"><Pencil size={16} /></button>
                <button type="button" onClick={() => { if (window.confirm(`Delete ${c.name}?`)) remove.mutate(c.id); }} className="p-2 rounded-md hover:bg-red-50 text-red-500"><Trash2 size={16} /></button>
              </div>
            </div>
          </article>
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
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
                    <button onClick={() => navigate(`/clients/${c.id}`)} data-testid={`open-client-${c.id}`} className="font-medium text-[#0B3A8F] hover:underline text-left">{c.name}</button>
                    {c.address && <div className="text-xs text-[#4B6370] flex items-center gap-1 mt-0.5"><MapPin size={12} />{c.address}</div>}
                  </td>
                  <td className="p-4 text-[#4B6370]">
                    {c.phone && <div className="flex items-center gap-1"><Phone size={13} />{formatPhone(c.phone)}</div>}
                    {c.email && <div className="flex items-center gap-1 mt-0.5"><Mail size={13} />{c.email}</div>}
                  </td>
                  <td className="p-4"><span className="text-[#0B3A8F] font-medium">{c.source}</span></td>
                  <td className="p-4"><StatusBadge status={c.status} /></td>
                  <td className="p-4 text-[#4B6370]">{fmtDate(c.created_at)}</td>
                  <td className="p-4">
                    <div className="flex items-center justify-end gap-1">
                      <button data-testid={`view-client-${c.id}`} onClick={() => navigate(`/clients/${c.id}`)} title="View timeline" className="p-2 rounded-md hover:bg-slate-100 text-[#0B3A8F]"><Eye size={16} /></button>
                      <button data-testid={`edit-client-${c.id}`} onClick={() => openEdit(c)} className="p-2 rounded-md hover:bg-slate-100 text-[#0B3A8F]"><Pencil size={16} /></button>
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
