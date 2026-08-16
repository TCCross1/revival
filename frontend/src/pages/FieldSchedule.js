import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api, { formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { isFieldOnly } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";

export default function FieldSchedule() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const field = isFieldOnly(user);
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ job_id: "", user_id: "", date: today, start: "07:00", end: "16:00", notes: "" });

  const { data: shifts = [] } = useQuery({ queryKey: ["crew-schedule"], queryFn: async () => (await api.get(`/field/schedule?from_date=${today}`)).data });
  const { data: jobs = [] } = useQuery({ queryKey: ["field-jobs"], queryFn: async () => (await api.get("/field/jobs")).data });
  const { data: crew = [] } = useQuery({ queryKey: ["field-crew"], enabled: !field, queryFn: async () => (await api.get("/field/crew")).data });

  const add = useMutation({
    mutationFn: async () => (await api.post("/field/schedule", form)).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["crew-schedule"] }); toast.success("Shift added"); },
    onError: async (err) => toast.error(await formatApiError(err, "Could not add that shift.")),
  });
  const remove = useMutation({
    mutationFn: async (id) => api.delete(`/field/schedule/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["crew-schedule"] }),
  });

  return (
    <div className="space-y-4 max-w-lg mx-auto" data-testid="field-schedule-page">
      <button type="button" onClick={() => navigate("/field")} className="flex items-center gap-1 text-sm text-[#C9A227]">
        <ArrowLeft size={16} /> Field
      </button>
      <h1 className="text-3xl font-['Outfit'] font-semibold text-white">Crew schedule</h1>
      <div className="space-y-2">
        {shifts.length === 0 ? <div className="text-sm text-white/70">Nothing on the board yet.</div> : null}
        {shifts.map((s) => (
          <div key={s.id} className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="font-semibold">{s.date} · {s.start}–{s.end}</div>
            <div className="text-sm text-[#4B6370]">{s.user_name} · {s.job_number} {s.job_name}</div>
            {!field ? <button type="button" className="text-xs text-red-500 mt-1" onClick={() => remove.mutate(s.id)}>Remove</button> : null}
          </div>
        ))}
      </div>
      {!field ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2">
          <div className="text-xs font-semibold uppercase text-[#0A4D68]">Add a shift</div>
          <select className="h-11 w-full rounded-md border px-2" value={form.job_id} onChange={(e) => setForm({ ...form, job_id: e.target.value })}>
            <option value="">Job</option>
            {jobs.map((j) => <option key={j.id} value={j.id}>{j.job_number} · {j.name}</option>)}
          </select>
          <select className="h-11 w-full rounded-md border px-2" value={form.user_id} onChange={(e) => setForm({ ...form, user_id: e.target.value })}>
            <option value="">Crew member</option>
            {crew.map((c) => <option key={c.user_id} value={c.user_id}>{c.name}</option>)}
          </select>
          <Input type="date" className="h-11" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          <div className="grid grid-cols-2 gap-2">
            <Input type="time" className="h-11" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
            <Input type="time" className="h-11" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} />
          </div>
          <Button type="button" className="w-full h-11 bg-[#0A4D68]" disabled={add.isPending || !form.job_id || !form.user_id} onClick={() => add.mutate()}>
            Add shift
          </Button>
        </div>
      ) : null}
    </div>
  );
}
