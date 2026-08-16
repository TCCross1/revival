import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api, { formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { can } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { ArrowLeft, Camera, Mic } from "lucide-react";
import { startVoiceNote } from "@/lib/voiceNote";
import { enqueueOffline } from "@/lib/offlineQueue";

export default function FieldJob() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [note, setNote] = useState("");
  const [task, setTask] = useState("");
  const [material, setMaterial] = useState({ item: "", quantity: "1" });

  const { data: jobs = [] } = useQuery({ queryKey: ["field-jobs"], queryFn: async () => (await api.get("/field/jobs")).data });
  const job = jobs.find((j) => j.id === id);
  const { data: logs = [] } = useQuery({ queryKey: ["job-logs", id], enabled: Boolean(id) && can(user, "job_notes"), queryFn: async () => (await api.get(`/jobs/${id}/logs`)).data });
  const { data: tasks = [] } = useQuery({ queryKey: ["job-tasks", id], enabled: Boolean(id) && can(user, "tasks"), queryFn: async () => (await api.get(`/jobs/${id}/tasks`)).data });
  const { data: materials = [] } = useQuery({ queryKey: ["job-materials", id], enabled: Boolean(id) && can(user, "material_requests"), queryFn: async () => (await api.get(`/jobs/${id}/materials`)).data });

  const addNote = useMutation({
    mutationFn: async () => (await api.post(`/jobs/${id}/logs`, { text: note })).data,
    onSuccess: () => { setNote(""); qc.invalidateQueries({ queryKey: ["job-logs", id] }); toast.success("Note saved to the job"); },
    onError: async (err) => toast.error(await formatApiError(err, "Could not save that note.")),
  });
  const addTask = useMutation({
    mutationFn: async () => (await api.post(`/jobs/${id}/tasks`, { title: task })).data,
    onSuccess: () => { setTask(""); qc.invalidateQueries({ queryKey: ["job-tasks", id] }); },
    onError: async (err) => toast.error(await formatApiError(err, "Could not add that task.")),
  });
  const toggleTask = useMutation({
    mutationFn: async (row) => (await api.put(`/jobs/${id}/tasks/${row.id}`, { status: row.status === "done" ? "open" : "done" })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["job-tasks", id] }),
  });
  const addMat = useMutation({
    mutationFn: async () => (await api.post(`/jobs/${id}/materials`, material)).data,
    onSuccess: () => { setMaterial({ item: "", quantity: "1" }); qc.invalidateQueries({ queryKey: ["job-materials", id] }); toast.success("Office was notified"); },
    onError: async (err) => toast.error(await formatApiError(err, "Could not send that request.")),
  });

  const onPhoto = async (logId, file) => {
    if (!file) return;
    const body = new FormData();
    body.append("photo", file);
    try {
      await api.post(`/jobs/${id}/logs/${logId}/photos`, body, { headers: { "Content-Type": "multipart/form-data" } });
      qc.invalidateQueries({ queryKey: ["job-logs", id] });
      toast.success("Photo attached");
    } catch (err) {
      toast.error(await formatApiError(err, "Could not attach that photo."));
    }
  };

  return (
    <div className="space-y-4 max-w-lg mx-auto" data-testid="field-job-page">
      <button type="button" onClick={() => navigate("/field")} className="flex items-center gap-1 text-sm text-[#C9A227]">
        <ArrowLeft size={16} /> Field
      </button>
      <div>
        <div className="text-[11px] text-white/50">{job?.job_number}</div>
        <h1 className="text-3xl font-['Outfit'] font-semibold text-white">{job?.name || "Job"}</h1>
        <p className="text-white/70">{job?.client_name}</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" className="h-12 bg-[#0A4D68]" onClick={() => navigate("/field/receipt")}>Receipt</Button>
        <Button type="button" variant="outline" className="h-12" onClick={() => navigate("/field/time")}>Time clock</Button>
      </div>

      {can(user, "tasks") ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2">
          <div className="text-xs font-semibold uppercase text-[#0A4D68]">Tasks</div>
          {tasks.map((row) => (
            <label key={row.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={row.status === "done"} onChange={() => toggleTask.mutate(row)} />
              <span className={row.status === "done" ? "line-through text-[#8AA0AB]" : ""}>{row.title}</span>
            </label>
          ))}
          <div className="flex gap-2">
            <Input className="h-11" value={task} onChange={(e) => setTask(e.target.value)} placeholder="Add a task" />
            <Button type="button" className="h-11 bg-[#0A4D68]" onClick={() => addTask.mutate()} disabled={!task.trim()}>Add</Button>
          </div>
        </section>
      ) : null}

      {can(user, "job_notes") ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2">
          <div className="text-xs font-semibold uppercase text-[#0A4D68]">Daily note</div>
          <Input className="h-11" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What happened on site today?" />
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Button type="button" className="w-full h-11 bg-[#0A4D68]" disabled={!note.trim() || addNote.isPending} onClick={() => addNote.mutate()}>
              Save note
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11 px-3"
              data-testid="field-job-voice"
              onClick={() => startVoiceNote({
                onText: (text) => {
                  const next = `Voice: ${text}`;
                  if (!navigator.onLine) {
                    enqueueOffline({ type: "note", job_id: id, text: next });
                    toast.message("Note saved on this phone.");
                    return;
                  }
                  setNote(next);
                },
                onError: (err) => toast.error(err.message),
              })}
            >
              <Mic size={16} />
            </Button>
          </div>
          {logs.slice(0, 6).map((row) => (
            <div key={row.id} className="rounded-lg bg-[#F4F7F8] p-2 text-sm">
              <div className="text-[11px] text-[#8AA0AB]">{row.user_name} · {new Date(row.created_at).toLocaleString()}</div>
              <div>{row.text}</div>
              <label className="mt-1 inline-flex items-center gap-1 text-xs text-[#0A4D68]">
                <Camera size={12} /> Add photo
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onPhoto(row.id, e.target.files?.[0])} />
              </label>
            </div>
          ))}
        </section>
      ) : null}

      {can(user, "material_requests") ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2">
          <div className="text-xs font-semibold uppercase text-[#0A4D68]">Need material</div>
          <Input className="h-11" value={material.item} onChange={(e) => setMaterial({ ...material, item: e.target.value })} placeholder="What do you need?" />
          <Input className="h-11" value={material.quantity} onChange={(e) => setMaterial({ ...material, quantity: e.target.value })} placeholder="Qty" />
          <Button type="button" className="w-full h-11 bg-[#0A4D68]" disabled={!material.item.trim() || addMat.isPending} onClick={() => addMat.mutate()}>
            Send to office
          </Button>
          {materials.slice(0, 5).map((row) => (
            <div key={row.id} className="text-sm text-[#4B6370]">{row.quantity} × {row.item} · {row.status}</div>
          ))}
        </section>
      ) : null}
    </div>
  );
}
