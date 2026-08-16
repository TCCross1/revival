import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api, { formatApiError } from "@/lib/api";
import { getPosition, insideFence, watchPosition } from "@/lib/geo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";

export default function FieldTime() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [jobId, setJobId] = useState("");
  const [notes, setNotes] = useState("");
  const [pos, setPos] = useState(null);
  const [auto, setAuto] = useState(() => localStorage.getItem("field-auto-clock") === "1");
  const autoLock = useRef(0);

  const { data: jobs = [] } = useQuery({ queryKey: ["field-jobs"], queryFn: async () => (await api.get("/field/jobs")).data });
  const { data: status } = useQuery({ queryKey: ["time-status"], queryFn: async () => (await api.get("/field/time/status")).data, refetchInterval: 20000 });
  const { data: entries = [] } = useQuery({ queryKey: ["time-entries"], queryFn: async () => (await api.get("/field/time/entries")).data });

  useEffect(() => {
    getPosition().then(setPos).catch(() => {});
    return watchPosition(setPos, () => {});
  }, []);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["time-status"] });
    qc.invalidateQueries({ queryKey: ["time-entries"] });
    qc.invalidateQueries({ queryKey: ["field-me"] });
    qc.invalidateQueries({ queryKey: ["job-sheet"] });
    qc.invalidateQueries({ queryKey: ["financials-overview"] });
  };

  const clockIn = useMutation({
    mutationFn: async (source = "manual") => {
      const here = pos || await getPosition();
      return (await api.post("/field/time/clock-in", { job_id: jobId || jobs[0]?.id, lat: here.lat, lng: here.lng, notes, source })).data;
    },
    onSuccess: () => { toast.success("Clocked in"); setNotes(""); invalidate(); },
    onError: async (err) => toast.error(await formatApiError(err, "Could not clock in. Please try again.")),
  });

  const clockOut = useMutation({
    mutationFn: async () => {
      const here = pos || await getPosition();
      return (await api.post("/field/time/clock-out", { lat: here.lat, lng: here.lng, notes })).data;
    },
    onSuccess: (data) => {
      toast.success(data.labor_amount ? `Clocked out · $${Number(data.labor_amount).toFixed(2)} labor on the job` : "Clocked out");
      setNotes("");
      invalidate();
    },
    onError: async (err) => toast.error(await formatApiError(err, "Could not clock out. Please try again.")),
  });

  useEffect(() => {
    if (!auto || !pos || !jobs.length) return;
    if (Date.now() - autoLock.current < 60000) return;
    const open = status?.open;
    if (open) {
      const job = jobs.find((j) => j.id === open.job_id);
      const check = insideFence(job?.geofence, pos);
      if (check.configured && !check.inside && !clockOut.isPending) {
        autoLock.current = Date.now();
        clockOut.mutate();
      }
      return;
    }
    const onSite = jobs.find((j) => {
      const check = insideFence(j.geofence, pos);
      return check.configured && check.inside;
    });
    if (onSite && !clockIn.isPending) {
      autoLock.current = Date.now();
      setJobId(onSite.id);
      clockIn.mutate("auto");
    }
  }, [auto, pos, jobs, status]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = status?.open;
  const selected = jobs.find((j) => j.id === (open?.job_id || jobId));
  const fence = insideFence(selected?.geofence, pos);

  return (
    <div className="space-y-4 max-w-lg mx-auto" data-testid="field-time-page">
      <button type="button" onClick={() => navigate("/field")} className="flex items-center gap-1 text-sm text-[#C9A227]">
        <ArrowLeft size={16} /> Field
      </button>
      <h1 className="text-3xl font-['Outfit'] font-semibold text-white">Time clock</h1>
      <p className="text-white/70">Hours land on the job as labor when you have a pay rate on your profile.</p>

      {open ? (
        <div className="rounded-2xl bg-[#0A4D68] text-white p-5">
          <div className="text-[11px] uppercase tracking-wide text-[#C9A227]">On the clock</div>
          <div className="font-['Outfit'] font-semibold text-2xl">{open.job_name}</div>
          <div className="text-white/80 text-sm mt-1">In since {new Date(open.clock_in).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</div>
        </div>
      ) : (
        <select className="h-12 w-full rounded-md border border-slate-200 bg-white text-[#061A23] px-3 text-base" value={jobId} onChange={(e) => setJobId(e.target.value)} data-testid="time-job">
          <option value="">Choose the job</option>
          {jobs.map((j) => <option key={j.id} value={j.id}>{j.job_number} · {j.name}</option>)}
        </select>
      )}

      {fence.configured ? (
        <div className={`rounded-xl px-3 py-2 text-sm ${fence.inside ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
          {fence.inside ? "Inside the job-site fence" : `Outside the fence · ${Math.round(fence.distance_m)}m away`}
        </div>
      ) : (
        <div className="text-xs text-white/50">No geo-fence on this job yet. You can still clock in with a note.</div>
      )}

      <Input className="h-12" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Note — late, pickup, leftover work…" />

      {open ? (
        <Button type="button" className="w-full h-14 bg-[#C45C26] hover:bg-[#A3481C] text-base" disabled={clockOut.isPending} onClick={() => clockOut.mutate()} data-testid="clock-out-btn">
          {clockOut.isPending ? "Clocking out…" : "Clock out"}
        </Button>
      ) : (
        <Button type="button" className="w-full h-14 bg-[#0A4D68] hover:bg-[#083D53] text-base" disabled={clockIn.isPending || (!jobId && !jobs[0])} onClick={() => clockIn.mutate("manual")} data-testid="clock-in-btn">
          {clockIn.isPending ? "Clocking in…" : "Clock in"}
        </Button>
      )}

      <label className="flex items-center gap-2 text-sm text-white/70">
        <input
          type="checkbox"
          checked={auto}
          onChange={(e) => {
            setAuto(e.target.checked);
            localStorage.setItem("field-auto-clock", e.target.checked ? "1" : "0");
          }}
        />
        Auto clock when I enter or leave the fence
      </label>

      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-[#0A4D68] mb-2">Recent time</div>
        <div className="space-y-2">
          {entries.slice(0, 12).map((row) => (
            <div key={row.id} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
              <div className="font-medium">{row.job_name}</div>
              <div className="text-[#4B6370] text-xs">
                {new Date(row.clock_in).toLocaleString()} · {row.clock_out ? `${row.minutes} min` : "Open"}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
