import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api, { formatApiError } from "@/lib/api";
import { formatPhone } from "@/lib/format";
import StatusBadge from "@/components/StatusBadge";
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
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, Search, Pencil, Trash2, Phone, Eye, RefreshCw, Activity, MoreVertical, MapPin, Mail, UserPlus, Briefcase, User, PhoneCall } from "lucide-react";
import { toast } from "sonner";

const SOURCES = ["Thumbtack", "Angi", "Referral", "Website", "Google", "Facebook", "Walk-in", "Other"];
const STATUSES = ["New", "Hot", "Warm", "Contacted", "Booked", "Completed", "Not Interested"];
const PROJECT_TYPES = ["Kitchen Remodel", "Bathroom Remodel", "Roof Replacement", "Deck Build", "Addition", "Exterior", "Basement", "Flooring", "Other"];
const PAGE_SIZE = 7;
const EMPTY = {
  name: "", phone: "", email: "", address: "",
  project_type: "Kitchen Remodel", source: "Thumbtack", status: "New", notes: "",
};

const sourceBadge = (source) => {
  if (source === "Angi") return "bg-[#0A4D68]/10 text-[#0A4D68]";
  if (source === "Thumbtack") return "bg-[#C9A227]/20 text-[#8a6f17]";
  return "bg-slate-100 text-[#4B6370]";
};

const isConverted = (lead) => Boolean(lead?.converted || (lead?.client_id && lead?.job_id));

export default function Leads() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [source, setSource] = useState("All");
  const [status, setStatus] = useState("All");
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [form, setForm] = useState(EMPTY);

  const { data: leads = [], isLoading, isFetching, refetch } = useQuery({
    queryKey: ["leads"],
    queryFn: async () => (await api.get("/leads")).data,
    staleTime: 0,
    refetchOnMount: "always",
  });

  const save = useMutation({
    mutationFn: async (payload) => editing ? api.put(`/leads/${editing.id}`, payload) : api.post("/leads", payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      toast.success(editing ? "Lead updated" : "Lead added");
      setFormOpen(false);
      setEditing(null);
    },
    onError: async (err) => toast.error(await formatApiError(err, "Could not save the lead. Please try again.")),
  });

  const remove = useMutation({
    mutationFn: async (id) => api.delete(`/leads/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      toast.success("Lead deleted");
    },
    onError: async (err) => toast.error(await formatApiError(err, "Could not delete the lead. Please try again.")),
  });

  const convert = useMutation({
    mutationFn: async (id) => (await api.post(`/leads/${id}/convert`)).data,
    onSuccess: (data, id) => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["clients"] });
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Converted to client and job");
      if (data?.lead) {
        setViewing((current) => (current && current.id === id ? data.lead : current));
      }
    },
    onError: async (err) => toast.error(await formatApiError(err, "Could not convert this lead. Please try again.")),
  });

  const callLead = useMutation({
    mutationFn: async (lead) => (await api.post(`/leads/${lead.id}/call`)).data,
    onSuccess: (data, lead) => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      toast.success(`Riley is calling ${lead.name}`);
      if (data?.lead) {
        setViewing((current) => (current && current.id === lead.id ? data.lead : current));
      }
    },
    onError: async (err) => toast.error(await formatApiError(err, "Could not place the outbound call. Please try again.")),
  });

  const requestCall = (lead) => {
    if (!lead?.phone) return toast.error("This lead needs a phone number first.");
    if (!window.confirm(`Have Riley call ${lead.name} at ${formatPhone(lead.phone) || lead.phone}?`)) return;
    callLead.mutate(lead);
  };

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return leads.filter((l) => {
      if (source !== "All" && l.source !== source) return false;
      if (status !== "All" && l.status !== status) return false;
      if (!needle) return true;
      return [l.name, l.phone, formatPhone(l.phone), l.email, l.project_type, l.address, l.notes].join(" ").toLowerCase().includes(needle);
    });
  }, [leads, search, source, status]);

  const liveCount = leads.filter((l) => l.is_live).length;
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const openNew = () => { setEditing(null); setForm(EMPTY); setFormOpen(true); };
  const openEdit = (lead) => {
    setEditing(lead);
    setForm({
      name: lead.name || "",
      phone: formatPhone(lead.phone) || lead.phone || "",
      email: lead.email || "",
      address: lead.address || "",
      project_type: lead.project_type || "Kitchen Remodel",
      source: lead.source || "Thumbtack",
      status: lead.status || "New",
      notes: lead.notes || "",
    });
    setFormOpen(true);
    setViewOpen(false);
  };
  const openView = (lead) => { setViewing(lead); setViewOpen(true); };

  const submit = (e) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.error("Name is required");
    save.mutate({ ...form, name: form.name.trim() });
  };

  const onFilter = (setter) => (value) => {
    setter(value);
    setPage(1);
  };

  return (
    <div className="space-y-6" data-testid="leads-page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-semibold font-['Outfit'] tracking-tight">
            Leads <span className="text-[#4B6370] font-normal">– Capture the Opportunity</span>
          </h1>
          <div className="mt-2 h-1 w-28 rounded-full bg-[#C9A227]" />
          <p className="text-[#4B6370] mt-2">New opportunities from Thumbtack, Angi, and everywhere else — before they go cold.</p>
        </div>
        <Button data-testid="add-lead-btn" onClick={openNew} className="bg-[#0A4D68] hover:bg-[#083D53] gap-2">
          <Plus size={18} /> Add Lead
        </Button>
      </div>

      <div className="flex flex-col xl:flex-row xl:items-center gap-3">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <Input
            data-testid="lead-search-input"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search leads by name, phone, or project..."
            className="pl-10 bg-white h-11"
          />
        </div>
        <Select value={source} onValueChange={onFilter(setSource)}>
          <SelectTrigger data-testid="lead-source-filter" className="bg-white h-11 w-full sm:w-[170px]">
            <SelectValue placeholder="Source: All" />
          </SelectTrigger>
          <SelectContent className="bg-white">
            <SelectItem value="All">Source: All</SelectItem>
            {SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={onFilter(setStatus)}>
          <SelectTrigger data-testid="lead-status-filter" className="bg-white h-11 w-full sm:w-[170px]">
            <SelectValue placeholder="Status: All" />
          </SelectTrigger>
          <SelectContent className="bg-white">
            <SelectItem value="All">Status: All</SelectItem>
            {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <div
          data-testid="live-leads-counter"
          className="flex items-center gap-3 rounded-xl bg-[#0A4D68] px-4 py-2.5 min-w-[150px] shadow-sm"
        >
          <Activity size={18} className="text-[#C9A227]" />
          <div>
            <div className="text-[10px] font-semibold tracking-[0.14em] text-[#C9A227]">LIVE LEADS</div>
            <div className="text-2xl font-semibold font-['Outfit'] text-[#C9A227] leading-none">{liveCount}</div>
          </div>
        </div>
        <Button
          data-testid="refresh-leads-btn"
          type="button"
          variant="outline"
          onClick={() => refetch()}
          disabled={isFetching}
          className="h-11 gap-2 border-[#C9A227]/50 text-[#8a6f17] hover:bg-[#C9A227]/10"
        >
          <RefreshCw size={16} className={isFetching ? "animate-spin" : ""} /> Refresh
        </Button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[#4B6370]">
                <th className="p-4 font-medium">Name</th>
                <th className="p-4 font-medium">Source</th>
                <th className="p-4 font-medium">Project Type</th>
                <th className="p-4 font-medium">Phone</th>
                <th className="p-4 font-medium">Status</th>
                <th className="p-4 font-medium">Response Time</th>
                <th className="p-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={7} className="p-6 text-[#4B6370]">Loading leads…</td></tr>}
              {!isLoading && pageRows.length === 0 && (
                <tr><td colSpan={7} className="p-6 text-[#4B6370]">No leads match these filters. Add a lead or clear the search.</td></tr>
              )}
              {pageRows.map((lead, idx) => (
                <tr
                  key={lead.id}
                  data-testid={`lead-row-${lead.id}`}
                  className={`border-b border-slate-100 hover:bg-slate-50 ${idx % 2 === 1 ? "bg-slate-50/60" : "bg-white"}`}
                >
                  <td className="p-4 font-medium text-[#061A23]">{lead.name}</td>
                  <td className="p-4">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${sourceBadge(lead.source)}`}>
                      {lead.source}
                    </span>
                  </td>
                  <td className="p-4 text-[#4B6370]">{lead.project_type}</td>
                  <td className="p-4 text-[#4B6370] whitespace-nowrap">{formatPhone(lead.phone) || "—"}</td>
                  <td className="p-4"><StatusBadge status={lead.status} /></td>
                  <td className="p-4">
                    <span className="inline-flex items-center gap-2 text-[#4B6370]">
                      <span className={`h-2 w-2 rounded-full ${lead.is_urgent ? "bg-[#C9A227]" : "bg-slate-300"}`} />
                      {lead.wait_label}
                    </span>
                  </td>
                  <td className="p-4">
                    <div className="flex items-center justify-end gap-1">
                      {!isConverted(lead) ? (
                        <Button
                          data-testid={`convert-lead-${lead.id}`}
                          type="button"
                          size="sm"
                          disabled={convert.isPending && convert.variables === lead.id}
                          onClick={() => convert.mutate(lead.id)}
                          className="h-8 px-2.5 bg-[#0A4D68] hover:bg-[#083D53] text-white gap-1.5 whitespace-nowrap"
                        >
                          <UserPlus size={14} />
                          {convert.isPending && convert.variables === lead.id ? "Converting…" : "Convert to Client & Job"}
                        </Button>
                      ) : (
                        <div className="flex items-center gap-1">
                          <Link
                            data-testid={`view-client-${lead.id}`}
                            to={`/clients/${lead.client_id}`}
                            className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-[#0A4D68]/30 text-[#0A4D68] text-xs font-medium hover:bg-[#0A4D68]/5 whitespace-nowrap"
                          >
                            <User size={13} /> View Client
                          </Link>
                          <Link
                            data-testid={`view-job-${lead.id}`}
                            to={`/jobs?highlight=${encodeURIComponent(lead.job_id)}`}
                            className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-[#C9A227]/50 text-[#8a6f17] text-xs font-medium hover:bg-[#C9A227]/10 whitespace-nowrap"
                          >
                            <Briefcase size={13} /> View Job
                          </Link>
                        </div>
                      )}
                      <button data-testid={`view-lead-${lead.id}`} onClick={() => openView(lead)} title="View lead" className="p-2 rounded-md hover:bg-slate-100 text-[#0A4D68]">
                        <Eye size={16} />
                      </button>
                      <Button
                        data-testid={`call-lead-${lead.id}`}
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={!lead.phone || (callLead.isPending && callLead.variables?.id === lead.id)}
                        onClick={() => requestCall(lead)}
                        className="h-8 px-2.5 border-[#C9A227]/60 text-[#8a6f17] hover:bg-[#C9A227]/10 gap-1.5 whitespace-nowrap"
                      >
                        <PhoneCall size={14} />
                        {callLead.isPending && callLead.variables?.id === lead.id ? "Calling…" : "Call Lead"}
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button data-testid={`more-lead-${lead.id}`} className="p-2 rounded-md hover:bg-slate-100 text-[#0A4D68]" title="More">
                            <MoreVertical size={16} />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="bg-white">
                          {!isConverted(lead) && (
                            <DropdownMenuItem
                              disabled={convert.isPending && convert.variables === lead.id}
                              onClick={() => convert.mutate(lead.id)}
                              className="gap-2 cursor-pointer"
                            >
                              <UserPlus size={14} /> Convert to Client & Job
                            </DropdownMenuItem>
                          )}
                          {isConverted(lead) && (
                            <>
                              <DropdownMenuItem asChild className="gap-2 cursor-pointer">
                                <Link to={`/clients/${lead.client_id}`}><User size={14} /> View Client</Link>
                              </DropdownMenuItem>
                              <DropdownMenuItem asChild className="gap-2 cursor-pointer">
                                <Link to={`/jobs?highlight=${encodeURIComponent(lead.job_id)}`}><Briefcase size={14} /> View Job</Link>
                              </DropdownMenuItem>
                            </>
                          )}
                          <DropdownMenuItem onClick={() => openEdit(lead)} className="gap-2 cursor-pointer">
                            <Pencil size={14} /> Edit
                          </DropdownMenuItem>
                          {lead.phone && (
                            <DropdownMenuItem asChild className="gap-2 cursor-pointer">
                              <a href={`tel:${lead.phone}`}><Phone size={14} /> Call on this device</a>
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            disabled={!lead.phone || (callLead.isPending && callLead.variables?.id === lead.id)}
                            onClick={() => requestCall(lead)}
                            className="gap-2 cursor-pointer"
                          >
                            <PhoneCall size={14} /> Call Lead
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => { if (window.confirm(`Delete ${lead.name}?`)) remove.mutate(lead.id); }}
                            className="gap-2 cursor-pointer text-red-600 focus:text-red-600"
                          >
                            <Trash2 size={14} /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-slate-200 text-sm text-[#4B6370]">
          <div data-testid="leads-page-info">
            {filtered.length === 0
              ? "Showing 0 leads"
              : `Showing ${(safePage - 1) * PAGE_SIZE + 1} to ${Math.min(safePage * PAGE_SIZE, filtered.length)} of ${filtered.length} leads`}
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="h-8 w-8 rounded-md border border-slate-200 disabled:opacity-40 hover:bg-slate-50"
            >
              ‹
            </button>
            {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setPage(n)}
                className={`h-8 w-8 rounded-md text-sm font-medium ${n === safePage ? "bg-[#C9A227] text-[#061A23]" : "border border-slate-200 hover:bg-slate-50"}`}
              >
                {n}
              </button>
            ))}
            <button
              type="button"
              disabled={safePage >= pageCount}
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              className="h-8 w-8 rounded-md border border-slate-200 disabled:opacity-40 hover:bg-slate-50"
            >
              ›
            </button>
          </div>
        </div>
      </div>

      <Dialog open={viewOpen} onOpenChange={setViewOpen}>
        <DialogContent className="bg-white max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-['Outfit'] text-2xl">Lead details</DialogTitle>
          </DialogHeader>
          {viewing && (
            <div className="space-y-3 text-sm" data-testid="lead-detail-dialog">
              <div className="flex items-center justify-between gap-3">
                <div className="text-lg font-semibold font-['Outfit']">{viewing.name}</div>
                <StatusBadge status={viewing.status} />
              </div>
              <div className="text-[#4B6370]">{viewing.project_type} · {viewing.source}</div>
              {viewing.phone && <div className="flex items-center gap-2"><Phone size={14} className="text-[#0A4D68]" />{formatPhone(viewing.phone)}</div>}
              {viewing.email && <div className="flex items-center gap-2"><Mail size={14} className="text-[#0A4D68]" />{viewing.email}</div>}
              {viewing.address && <div className="flex items-center gap-2"><MapPin size={14} className="text-[#0A4D68]" />{viewing.address}</div>}
              <div className="rounded-lg bg-slate-50 p-3 text-[#4B6370]">{viewing.notes || "No notes yet."}</div>
              <div className="text-xs text-[#4B6370]">Response time: {viewing.wait_label}</div>
              <Button
                data-testid="detail-call-lead"
                type="button"
                variant="outline"
                disabled={!viewing.phone || (callLead.isPending && callLead.variables?.id === viewing.id)}
                onClick={() => requestCall(viewing)}
                className="w-full border-[#C9A227]/60 text-[#8a6f17] hover:bg-[#C9A227]/10 gap-2"
              >
                <PhoneCall size={16} />
                {callLead.isPending && callLead.variables?.id === viewing.id ? "Calling…" : "Call Lead"}
              </Button>
              {isConverted(viewing) ? (
                <div className="flex flex-wrap gap-2">
                  <Link
                    data-testid="detail-view-client"
                    to={`/clients/${viewing.client_id}`}
                    className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-[#0A4D68]/30 text-[#0A4D68] text-sm font-medium hover:bg-[#0A4D68]/5"
                  >
                    <User size={14} /> View Client
                  </Link>
                  <Link
                    data-testid="detail-view-job"
                    to={`/jobs?highlight=${encodeURIComponent(viewing.job_id)}`}
                    className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-[#C9A227]/50 text-[#8a6f17] text-sm font-medium hover:bg-[#C9A227]/10"
                  >
                    <Briefcase size={14} /> View Job
                  </Link>
                </div>
              ) : (
                <Button
                  data-testid="detail-convert-lead"
                  type="button"
                  disabled={convert.isPending && convert.variables === viewing.id}
                  onClick={() => convert.mutate(viewing.id)}
                  className="w-full bg-[#0A4D68] hover:bg-[#083D53] gap-2"
                >
                  <UserPlus size={16} />
                  {convert.isPending && convert.variables === viewing.id ? "Converting…" : "Convert to Client & Job"}
                </Button>
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setViewOpen(false)}>Close</Button>
                <Button type="button" onClick={() => openEdit(viewing)} className="bg-[#0A4D68] hover:bg-[#083D53]">Edit Lead</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="bg-white max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-['Outfit'] text-2xl">{editing ? "Edit Lead" : "Add Lead"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label>Full name</Label>
              <Input data-testid="lead-name-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. James Carter" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Phone</Label>
                <Input data-testid="lead-phone-input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="(512) 555-0100" />
              </div>
              <div>
                <Label>Email</Label>
                <Input data-testid="lead-email-input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@email.com" />
              </div>
            </div>
            <div>
              <Label>Address</Label>
              <Input data-testid="lead-address-input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Street, City, State" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <Label>Project type</Label>
                <Select value={form.project_type} onValueChange={(v) => setForm({ ...form, project_type: v })}>
                  <SelectTrigger data-testid="lead-project-select"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-white">{PROJECT_TYPES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Source</Label>
                <Select value={form.source} onValueChange={(v) => setForm({ ...form, source: v })}>
                  <SelectTrigger data-testid="lead-source-select"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-white">{SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger data-testid="lead-status-select"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-white">{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea data-testid="lead-notes-input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="What they need, timeline, budget…" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setFormOpen(false)} disabled={save.isPending}>Cancel</Button>
              <Button data-testid="save-lead-btn" type="submit" disabled={save.isPending} className="bg-[#0A4D68] hover:bg-[#083D53]">
                {save.isPending ? "Saving…" : "Save Lead"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
