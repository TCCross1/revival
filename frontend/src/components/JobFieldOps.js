import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api, { formatApiError } from "@/lib/api";
import { getPosition } from "@/lib/geo";
import { useAuth } from "@/context/AuthContext";
import { isFieldOnly } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export default function JobFieldOps({ jobId, job }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const field = isFieldOnly(user);
  const [radius, setRadius] = useState(job?.geofence?.radius_m || 150);
  const [crewIds, setCrewIds] = useState(job?.crew_ids || []);

  const { data: crew = [] } = useQuery({
    queryKey: ["field-crew"],
    enabled: !field,
    queryFn: async () => (await api.get("/field/crew")).data,
  });
  const { data: entries = [] } = useQuery({
    queryKey: ["time-entries", jobId],
    queryFn: async () => (await api.get(`/field/time/entries?job_id=${jobId}`)).data,
  });
  const { data: materials = [] } = useQuery({
    queryKey: ["job-materials", jobId],
    queryFn: async () => (await api.get(`/jobs/${jobId}/materials`)).data,
  });
  const { data: tasks = [] } = useQuery({
    queryKey: ["job-tasks", jobId],
    queryFn: async () => (await api.get(`/jobs/${jobId}/tasks`)).data,
  });
  const { data: logs = [] } = useQuery({
    queryKey: ["job-logs", jobId],
    queryFn: async () => (await api.get(`/jobs/${jobId}/logs`)).data,
  });

  const saveCrew = useMutation({
    mutationFn: async (ids) => (await api.put(`/jobs/${jobId}/crew`, { crew_ids: ids })).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["jobs"] }); toast.success("Crew updated"); },
    onError: async (err) => toast.error(await formatApiError(err, "Could not update the crew.")),
  });
  const saveFence = useMutation({
    mutationFn: async () => {
      const here = await getPosition();
      return (await api.put(`/jobs/${jobId}/geofence`, { ...here, radius_m: Number(radius), label: job?.name || "" })).data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["job-sheet", jobId] }); toast.success("Job-site fence set from this phone"); },
    onError: async (err) => toast.error(err.message || await formatApiError(err, "Could not set the fence.")),
  });
  const matStatus = useMutation({
    mutationFn: async ({ id, status }) => (await api.put(`/jobs/${jobId}/materials/${id}`, { status })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["job-materials", jobId] }),
  });

  const hours = entries.reduce((sum, row) => sum + Number(row.minutes || 0), 0) / 60;

  return (
    <div className="space-y-4" data-testid="job-field-ops">
      <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-4 py-3 bg-[#0A4D68] text-white font-['Outfit'] font-semibold">Field & crew</div>
        <div className="p-4 space-y-4">
          {!field ? (
            <div>
              <div className="text-xs font-semibold uppercase text-[#0A4D68] mb-2">Assigned crew</div>
              <div className="flex flex-wrap gap-2">
                {crew.map((person) => {
                  const on = crewIds.includes(person.user_id);
                  return (
                    <button
                      key={person.user_id}
                      type="button"
                      onClick={() => {
                        const next = on ? crewIds.filter((id) => id !== person.user_id) : [...crewIds, person.user_id];
                        setCrewIds(next);
                        saveCrew.mutate(next);
                      }}
                      className={`rounded-full px-3 py-1 text-xs ${on ? "bg-[#0A4D68] text-white" : "bg-slate-100 text-[#4B6370]"}`}
                    >
                      {person.name}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {!field ? (
            <div className="rounded-xl bg-[#F4F7F8] p-3 space-y-2">
              <div className="text-xs font-semibold uppercase text-[#0A4D68]">Geo-fence</div>
              <p className="text-sm text-[#4B6370]">Stand at the job site and set the fence. Crew can auto clock when they arrive.</p>
              <div className="flex items-center gap-2">
                <Input className="h-10 w-28" type="number" value={radius} onChange={(e) => setRadius(e.target.value)} />
                <span className="text-xs text-[#8AA0AB]">meters</span>
                <Button type="button" className="h-10 bg-[#0A4D68]" onClick={() => saveFence.mutate()} disabled={saveFence.isPending}>
                  {saveFence.isPending ? "Setting…" : "Use my location"}
                </Button>
              </div>
              {job?.geofence?.lat ? <div className="text-xs text-[#4B6370]">Fence is on · {job.geofence.radius_m}m</div> : null}
            </div>
          ) : null}

          <div className="text-sm text-[#4B6370]">Labor on the clock: <span className="font-semibold text-[#0A4D68]">{hours.toFixed(1)} hrs</span></div>
          {entries.slice(0, 6).map((row) => (
            <div key={row.id} className="text-xs text-[#4B6370]">{row.user_name} · {row.minutes || 0} min {row.clock_out ? "" : "(open)"}</div>
          ))}

          {logs.length ? (
            <div>
              <div className="text-xs font-semibold uppercase text-[#0A4D68] mb-1">Crew notes</div>
              {logs.slice(0, 5).map((row) => (
                <div key={row.id} className="text-sm text-[#4B6370]">{row.user_name}: {row.text}</div>
              ))}
            </div>
          ) : null}

          {materials.length ? (
            <div>
              <div className="text-xs font-semibold uppercase text-[#0A4D68] mb-1">Material requests</div>
              {materials.map((row) => (
                <div key={row.id} className="flex items-center justify-between gap-2 text-sm">
                  <span>{row.quantity} × {row.item}</span>
                  {!field ? (
                    <select className="h-8 rounded border px-1 text-xs" value={row.status} onChange={(e) => matStatus.mutate({ id: row.id, status: e.target.value })}>
                      <option value="open">Open</option>
                      <option value="ordered">Ordered</option>
                      <option value="delivered">Delivered</option>
                    </select>
                  ) : <span className="text-xs text-[#8AA0AB]">{row.status}</span>}
                </div>
              ))}
            </div>
          ) : null}

          {tasks.length ? (
            <div>
              <div className="text-xs font-semibold uppercase text-[#0A4D68] mb-1">Tasks</div>
              {tasks.map((row) => (
                <div key={row.id} className="text-sm text-[#4B6370]">{row.status === "done" ? "✓" : "○"} {row.title}</div>
              ))}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
