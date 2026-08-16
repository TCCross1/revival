import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { fmtDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UserPlus, Trash2, KeyRound, ShieldCheck, User as UserIcon } from "lucide-react";
import { toast } from "sonner";

const EMPTY = { name: "", email: "", password: "", role: "field", hourly_rate: "" };

export default function Team() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [pwOpen, setPwOpen] = useState(false);
  const [pwTarget, setPwTarget] = useState(null);
  const [newPw, setNewPw] = useState("");

  const isAdmin = user?.role === "admin";

  const { data: members = [], isLoading } = useQuery({
    queryKey: ["team"],
    queryFn: async () => (await api.get("/team")).data,
    enabled: isAdmin,
  });

  const create = useMutation({
    mutationFn: async (payload) => api.post("/team", payload),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["team"] }); toast.success("Teammate invited"); setOpen(false); setForm(EMPTY); },
    onError: (err) => toast.error(err?.response?.data?.detail || "Could not add teammate"),
  });
  const remove = useMutation({
    mutationFn: async (id) => api.delete(`/team/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["team"] }); toast.success("Teammate removed"); },
    onError: (err) => toast.error(err?.response?.data?.detail || "Could not remove"),
  });
  const setRole = useMutation({
    mutationFn: async ({ id, role, hourly_rate }) => api.put(`/team/${id}/role`, { role, hourly_rate }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["team"] }); toast.success("Role updated"); },
    onError: (err) => toast.error(err?.response?.data?.detail || "Could not update role"),
  });
  const setPw = useMutation({
    mutationFn: async ({ id, password }) => api.post(`/team/${id}/set-password`, { password }),
    onSuccess: () => { toast.success("Password updated"); setPwOpen(false); setNewPw(""); },
    onError: (err) => toast.error(err?.response?.data?.detail || "Could not update password"),
  });

  if (!isAdmin) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-10 text-center text-[#4B6370]" data-testid="team-not-admin">
        <ShieldCheck className="mx-auto mb-3 text-slate-300" size={40} />
        Only admins can manage team members.
      </div>
    );
  }

  const submit = (e) => {
    e.preventDefault();
    if (!form.email.trim() || !form.password.trim()) return toast.error("Email and password are required");
    if (form.password.length < 6) return toast.error("Password must be at least 6 characters");
    create.mutate({ ...form, email: form.email.trim(), hourly_rate: Number(form.hourly_rate || 0) });
  };

  return (
    <div className="space-y-6" data-testid="team-page">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-semibold font-['Outfit'] tracking-tight">Team Members</h1>
          <p className="text-[#4B6370] mt-1">Invite the office and the crew. Field workers only see the jobs you assign.</p>
        </div>
        <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => navigate("/permissions")}>Roles & permissions</Button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="invite-teammate-btn" onClick={() => setForm(EMPTY)} className="bg-[#0A4D68] hover:bg-[#083D53] gap-2"><UserPlus size={18} /> Invite Teammate</Button>
          </DialogTrigger>
          <DialogContent className="bg-white max-w-md">
            <DialogHeader><DialogTitle className="font-['Outfit'] text-2xl">Invite Teammate</DialogTitle></DialogHeader>
            <form onSubmit={submit} className="space-y-4">
              <div><Label>Full name</Label><Input data-testid="team-name" className="mt-1" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Jamie Carpenter" /></div>
              <div><Label>Email</Label><Input data-testid="team-email" type="email" className="mt-1" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="jamie@company.com" /></div>
              <div><Label>Temporary password</Label><Input data-testid="team-password" type="text" className="mt-1" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="At least 6 characters" /></div>
              <div>
                <Label>Role</Label>
                <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                  <SelectTrigger data-testid="team-role" className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-white">
                    <SelectItem value="field">Field Worker / Crew</SelectItem>
                    <SelectItem value="manager">Project Manager</SelectItem>
                    <SelectItem value="admin">Owner / Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Hourly rate (labor costing)</Label>
                <Input data-testid="team-rate" className="mt-1" type="number" step="any" value={form.hourly_rate} onChange={(e) => setForm({ ...form, hourly_rate: e.target.value })} placeholder="0" />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" data-testid="save-teammate-btn" disabled={create.isPending} className="bg-[#0A4D68] hover:bg-[#083D53]">{create.isPending ? "Inviting…" : "Send Invite"}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[#4B6370]">
                <th className="p-4 font-medium">Name</th><th className="p-4 font-medium">Email</th>
                <th className="p-4 font-medium">Role</th><th className="p-4 font-medium">Rate</th><th className="p-4 font-medium">Added</th>
                <th className="p-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={6} className="p-6 text-[#4B6370]">Loading…</td></tr>}
              {members.map((m) => (
                <tr key={m.user_id} data-testid={`team-row-${m.user_id}`} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="p-4 font-medium flex items-center gap-2"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0A4D68]/10 text-[#0A4D68]"><UserIcon size={15} /></span>{m.name}</td>
                  <td className="p-4 text-[#4B6370]">{m.email}</td>
                  <td className="p-4">
                    <select
                      className="h-8 rounded-md border border-slate-200 px-2 text-xs"
                      value={m.role === "member" ? "manager" : m.role}
                      onChange={(e) => setRole.mutate({ id: m.user_id, role: e.target.value, hourly_rate: m.hourly_rate })}
                    >
                      <option value="admin">Owner / Admin</option>
                      <option value="manager">Project Manager</option>
                      <option value="field">Field Worker</option>
                    </select>
                  </td>
                  <td className="p-4">
                    <Input
                      className="h-8 w-20 text-xs"
                      defaultValue={m.hourly_rate || ""}
                      onBlur={(e) => {
                        const rate = Number(e.target.value || 0);
                        if (rate === Number(m.hourly_rate || 0)) return;
                        setRole.mutate({ id: m.user_id, role: m.role === "member" ? "manager" : m.role, hourly_rate: rate });
                      }}
                    />
                  </td>
                  <td className="p-4 text-[#4B6370]">{fmtDate(m.created_at)}</td>
                  <td className="p-4">
                    <div className="flex items-center justify-end gap-1">
                      <button data-testid={`reset-pw-${m.user_id}`} onClick={() => { setPwTarget(m); setNewPw(""); setPwOpen(true); }} title="Set password" className="p-2 rounded-md hover:bg-slate-100 text-[#0A4D68]"><KeyRound size={16} /></button>
                      {m.user_id !== user.user_id && (
                        <button data-testid={`delete-member-${m.user_id}`} onClick={() => { if (window.confirm(`Remove ${m.name}?`)) remove.mutate(m.user_id); }} className="p-2 rounded-md hover:bg-red-50 text-red-500"><Trash2 size={16} /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={pwOpen} onOpenChange={setPwOpen}>
        <DialogContent className="bg-white max-w-sm">
          <DialogHeader><DialogTitle className="font-['Outfit'] text-xl">Set password for {pwTarget?.name}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>New password</Label><Input data-testid="member-new-password" type="text" className="mt-1" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="At least 6 characters" /></div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPwOpen(false)}>Cancel</Button>
              <Button data-testid="save-member-password-btn" onClick={() => { if (newPw.length < 6) return toast.error("At least 6 characters"); setPw.mutate({ id: pwTarget.user_id, password: newPw }); }} className="bg-[#0A4D68] hover:bg-[#083D53]">Set Password</Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
