import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api, { formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { can } from "@/lib/permissions";
import { getPosition, insideFence, watchPosition } from "@/lib/geo";
import { enqueueOffline, flushOfflineQueue, queueLength } from "@/lib/offlineQueue";
import { startVoiceNote, voiceSupported } from "@/lib/voiceNote";
import { Camera, Clock, MapPin, Mic, NotebookPen, Package, Car, CheckSquare, CalendarDays, WifiOff } from "lucide-react";
import { toast } from "sonner";

const ACTIONS = [
  { to: "/field/receipt", id: "receipts", label: "Camera", hint: "Snap a receipt", icon: Camera, testid: "field-receipt" },
  { to: "/field/time", id: "time_clock", label: "Time", hint: "Full time clock", icon: Clock, testid: "field-time" },
  { to: "/field/mileage", id: "mileage", label: "Mileage", hint: "Trip for the job", icon: Car, testid: "field-mileage" },
  { to: "/field/schedule", id: "crew_schedule", label: "Schedule", hint: "Where you’re going", icon: CalendarDays, testid: "field-schedule" },
];

export default function FieldHome() {
  const { user, refreshField } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [pos, setPos] = useState(null);
  const [fencePrompt, setFencePrompt] = useState(null);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [queued, setQueued] = useState(queueLength());
  const [listening, setListening] = useState(false);
  const [clockJobId, setClockJobId] = useState("");

  const { data: jobs = [] } = useQuery({
    queryKey: ["field-jobs"],
    queryFn: async () => (await api.get("/field/jobs")).data,
  });
  const { data: me } = useQuery({
    queryKey: ["field-me"],
    queryFn: async () => (await api.get("/field/me")).data,
    refetchInterval: 30000,
  });

  useEffect(() => {
    const stop = watchPosition(setPos, () => {});
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
    const onOnline = async () => {
      setOnline(true);
      try {
        const sent = await flushOfflineQueue(api);
        setQueued(queueLength());
        if (sent) {
          qc.invalidateQueries({ queryKey: ["field-me"] });
          qc.invalidateQueries({ queryKey: ["job-logs"] });
          toast.success(`Sent ${sent} saved item${sent === 1 ? "" : "s"}`);
        }
      } catch {
        setQueued(queueLength());
      }
    };
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    if (navigator.onLine) onOnline();
    return () => {
      stop?.();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [qc]);

  useEffect(() => {
    if (!pos || !jobs.length) return;
    const open = me?.open_clock;
    if (open) {
      const job = jobs.find((j) => j.id === open.job_id);
      const check = insideFence(job?.geofence, pos);
      if (check.configured && !check.inside) {
        setFencePrompt({ type: "leave", job });
        return;
      }
    } else {
      const onSite = jobs.find((j) => insideFence(j.geofence, pos).inside && insideFence(j.geofence, pos).configured);
      if (onSite) {
        setFencePrompt({ type: "arrive", job: onSite });
        setClockJobId((cur) => cur || onSite.id);
        return;
      }
    }
    setFencePrompt(null);
  }, [pos, jobs, me]);

  const open = me?.open_clock;
  const todayJob = jobs.find((j) => j.id === (open?.job_id || clockJobId || jobs[0]?.id));

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["field-me"] });
    qc.invalidateQueries({ queryKey: ["time-status"] });
    qc.invalidateQueries({ queryKey: ["time-entries"] });
    qc.invalidateQueries({ queryKey: ["job-sheet"] });
  };

  const clockIn = useMutation({
    mutationFn: async () => {
      const here = pos || await getPosition().catch(() => ({ lat: null, lng: null }));
      const jobId = clockJobId || todayJob?.id || jobs[0]?.id;
      if (!jobId) throw new Error("Ask the office to put you on a job first.");
      if (!navigator.onLine) {
        enqueueOffline({ type: "clock-in", job_id: jobId, lat: here.lat, lng: here.lng });
        setQueued(queueLength());
        return { offline: true };
      }
      return (await api.post("/field/time/clock-in", { job_id: jobId, lat: here.lat, lng: here.lng, source: "today" })).data;
    },
    onSuccess: (data) => {
      if (data?.offline) toast.message("Saved on this phone. It will clock in when you’re back online.");
      else toast.success("Clocked in");
      invalidate();
    },
    onError: async (err) => toast.error(err.message || await formatApiError(err, "Could not clock in.")),
  });

  const clockOut = useMutation({
    mutationFn: async () => {
      const here = pos || await getPosition().catch(() => ({ lat: null, lng: null }));
      if (!navigator.onLine) {
        enqueueOffline({ type: "clock-out", lat: here.lat, lng: here.lng });
        setQueued(queueLength());
        return { offline: true };
      }
      return (await api.post("/field/time/clock-out", { lat: here.lat, lng: here.lng })).data;
    },
    onSuccess: (data) => {
      if (data?.offline) toast.message("Clock-out saved on this phone.");
      else toast.success(data.labor_amount ? `Clocked out · $${Number(data.labor_amount).toFixed(2)} labor` : "Clocked out");
      invalidate();
    },
    onError: async (err) => toast.error(await formatApiError(err, "Could not clock out.")),
  });

  const saveVoice = async (text) => {
    const jobId = todayJob?.id;
    if (!jobId) {
      toast.error("Open a job first, then save the note.");
      return;
    }
    const note = `Voice: ${text}`;
    if (!navigator.onLine) {
      enqueueOffline({ type: "note", job_id: jobId, text: note });
      setQueued(queueLength());
      toast.message("Note saved on this phone. It will send when you’re online.");
      return;
    }
    try {
      await api.post(`/jobs/${jobId}/logs`, { text: note });
      qc.invalidateQueries({ queryKey: ["job-logs", jobId] });
      toast.success("Voice note is on the job");
    } catch (err) {
      enqueueOffline({ type: "note", job_id: jobId, text: note });
      setQueued(queueLength());
      toast.error(await formatApiError(err, "Saved on this phone instead."));
    }
  };

  const onVoice = () => {
    if (listening) return;
    setListening(true);
    startVoiceNote({
      onText: (text) => saveVoice(text),
      onError: (err) => toast.error(err.message),
      onEnd: () => setListening(false),
    });
  };

  return (
    <div className="space-y-5 pb-8 text-[#F4F7F8]" data-testid="field-home">
      <div>
        <div className="text-[11px] uppercase tracking-[0.16em] text-[#C9A227] font-semibold">Today</div>
        <h1 className="text-3xl font-['Outfit'] font-semibold">Hey {user?.name?.split(" ")[0] || "there"}</h1>
        <p className="text-white/70 mt-1">Clock. Camera. Voice. That’s the day.</p>
      </div>

      {!online || queued ? (
        <div className="rounded-2xl border border-[#C9A227]/40 bg-[#C9A227]/10 px-4 py-3 text-sm flex items-center gap-2" data-testid="field-offline-banner">
          <WifiOff size={16} className="text-[#C9A227]" />
          {!online ? "You’re offline. Clock and notes save on this phone." : `${queued} item${queued === 1 ? "" : "s"} waiting to send.`}
        </div>
      ) : null}

      {can(user, "time_clock") ? (
        <div className="rounded-3xl bg-[#0A4D68] border border-white/10 p-5 shadow-lg" data-testid="field-today-clock">
          <div className="text-[11px] uppercase tracking-wide text-[#C9A227]">{open ? "On the clock" : "Not on the clock"}</div>
          <div className="mt-1 font-['Outfit'] font-semibold text-2xl">{open?.job_name || todayJob?.name || "Pick a job"}</div>
          {!open && jobs.length > 1 ? (
            <select
              className="mt-3 w-full h-11 rounded-xl bg-white/10 border border-white/20 px-3 text-sm"
              value={clockJobId || todayJob?.id || ""}
              onChange={(e) => setClockJobId(e.target.value)}
              data-testid="field-clock-job"
            >
              {jobs.map((job) => <option key={job.id} value={job.id}>{job.name}</option>)}
            </select>
          ) : null}
          <button
            type="button"
            data-testid="field-clock-toggle"
            onClick={() => (open ? clockOut.mutate() : clockIn.mutate())}
            disabled={clockIn.isPending || clockOut.isPending}
            className="mt-4 w-full h-16 rounded-2xl bg-[#C9A227] text-[#061A23] font-['Outfit'] font-semibold text-xl active:scale-[0.99]"
          >
            {clockIn.isPending || clockOut.isPending ? "Saving…" : open ? "Clock out" : "Clock in"}
          </button>
        </div>
      ) : null}

      {fencePrompt ? (
        <div className="rounded-2xl border border-[#C9A227]/50 bg-[#C9A227]/10 p-4" data-testid="geofence-prompt">
          <div className="flex items-start gap-2">
            <MapPin size={18} className="text-[#C9A227] mt-0.5" />
            <div>
              <div className="font-semibold">{fencePrompt.type === "arrive" ? "You’re on site" : "You’ve left the site"}</div>
              <div className="text-sm text-white/70">{fencePrompt.job?.name}</div>
              <button
                type="button"
                className="mt-2 h-10 px-4 rounded-md bg-[#C9A227] text-[#061A23] text-sm font-semibold"
                onClick={() => (fencePrompt.type === "arrive" ? clockIn.mutate() : clockOut.mutate())}
              >
                {fencePrompt.type === "arrive" ? "Clock in" : "Clock out"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        {ACTIONS.filter((a) => can(user, a.id)).map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.to}
              type="button"
              data-testid={item.testid}
              onClick={() => navigate(item.to)}
              className="rounded-2xl bg-white/5 border border-white/10 p-4 text-left min-h-[112px] active:bg-white/10"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#C9A227] text-[#061A23]">
                <Icon size={18} />
              </span>
              <div className="mt-3 font-['Outfit'] font-semibold">{item.label}</div>
              <div className="text-xs text-white/55">{item.hint}</div>
            </button>
          );
        })}
        {can(user, "job_notes") ? (
          <button
            type="button"
            data-testid="field-voice"
            onClick={onVoice}
            className="rounded-2xl bg-white/5 border border-white/10 p-4 text-left min-h-[112px] active:bg-white/10"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#C9A227] text-[#061A23]">
              <Mic size={18} />
            </span>
            <div className="mt-3 font-['Outfit'] font-semibold">{listening ? "Listening…" : "Voice note"}</div>
            <div className="text-xs text-white/55">{voiceSupported() ? "Talk, it hits the job" : "Type a note on the job"}</div>
          </button>
        ) : null}
      </div>

      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-[#C9A227] mb-2">Your jobs</div>
        <div className="space-y-2">
          {jobs.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">No jobs assigned yet. Ask the office to put you on a crew.</div>
          ) : jobs.map((job) => (
            <button
              key={job.id}
              type="button"
              onClick={() => navigate(`/field/jobs/${job.id}`)}
              className="w-full text-left rounded-xl border border-white/10 bg-white/5 p-4"
            >
              <div className="flex justify-between gap-2">
                <div>
                  <div className="text-[11px] text-white/50">{job.job_number}</div>
                  <div className="font-semibold">{job.name}</div>
                  <div className="text-sm text-white/70">{job.client_name}</div>
                </div>
                <div className="text-right text-xs text-white/50">
                  {job.open_tasks ? `${job.open_tasks} open` : "Caught up"}
                </div>
              </div>
              <div className="mt-2 flex gap-2 text-[11px] text-[#C9A227]">
                {can(user, "job_notes") ? <span className="inline-flex items-center gap-1"><NotebookPen size={12} /> Note</span> : null}
                {can(user, "material_requests") ? <span className="inline-flex items-center gap-1"><Package size={12} /> Materials</span> : null}
                {can(user, "tasks") ? <span className="inline-flex items-center gap-1"><CheckSquare size={12} /> Tasks</span> : null}
              </div>
            </button>
          ))}
        </div>
      </div>
      <button type="button" className="text-xs text-white/40" onClick={() => refreshField?.()}>Refresh status</button>
    </div>
  );
}
