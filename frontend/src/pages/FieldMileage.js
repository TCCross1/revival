import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api, { formatApiError } from "@/lib/api";
import { getPosition } from "@/lib/geo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { usd } from "@/lib/format";

export default function FieldMileage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const year = new Date().getFullYear();
  const [jobId, setJobId] = useState("");
  const [miles, setMiles] = useState("");
  const [notes, setNotes] = useState("");

  const { data: jobs = [] } = useQuery({ queryKey: ["field-jobs"], queryFn: async () => (await api.get("/field/jobs")).data });
  const { data: me } = useQuery({ queryKey: ["field-me"], queryFn: async () => (await api.get("/field/me")).data });
  const { data: report } = useQuery({ queryKey: ["mileage-report", year], queryFn: async () => (await api.get(`/field/mileage/report?year=${year}`)).data });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["field-me"] });
    qc.invalidateQueries({ queryKey: ["mileage-report"] });
  };

  const start = useMutation({
    mutationFn: async () => {
      const here = await getPosition();
      return (await api.post("/field/mileage/start", { job_id: jobId, purpose: jobId ? "job" : "business", lat: here.lat, lng: here.lng, notes })).data;
    },
    onSuccess: () => { toast.success("Trip started — drive, then stop when you park"); invalidate(); },
    onError: async (err) => toast.error(await formatApiError(err, "Could not start the trip. Please try again.")),
  });

  const stop = useMutation({
    mutationFn: async () => {
      const here = await getPosition();
      return (await api.post("/field/mileage/stop", { lat: here.lat, lng: here.lng, notes })).data;
    },
    onSuccess: (trip) => { toast.success(`${trip.miles} miles saved`); setNotes(""); invalidate(); },
    onError: async (err) => toast.error(await formatApiError(err, "Could not stop the trip. Please try again.")),
  });

  const manual = useMutation({
    mutationFn: async () => (await api.post("/field/mileage", { job_id: jobId, purpose: jobId ? "job" : "business", miles: Number(miles), notes })).data,
    onSuccess: () => { toast.success("Miles saved"); setMiles(""); setNotes(""); invalidate(); },
    onError: async (err) => toast.error(await formatApiError(err, "Could not save those miles. Please try again.")),
  });

  const active = me?.active_trip;

  return (
    <div className="space-y-4 max-w-lg mx-auto" data-testid="field-mileage-page">
      <button type="button" onClick={() => navigate("/field")} className="flex items-center gap-1 text-sm text-[#C9A227]">
        <ArrowLeft size={16} /> Field
      </button>
      <h1 className="text-3xl font-['Outfit'] font-semibold text-white">Mileage</h1>
      <p className="text-white/70">Track job trips and general business miles for tax time.</p>

      {report ? (
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-white border border-slate-200 p-3 text-center">
            <div className="text-[10px] text-[#8AA0AB]">Job miles</div>
            <div className="font-['Outfit'] font-semibold text-[#0A4D68]">{report.job_miles}</div>
          </div>
          <div className="rounded-xl bg-white border border-slate-200 p-3 text-center">
            <div className="text-[10px] text-[#8AA0AB]">Business</div>
            <div className="font-['Outfit'] font-semibold text-[#0A4D68]">{report.business_miles}</div>
          </div>
          <div className="rounded-xl bg-[#FBF6E8] border border-[#C9A227]/40 p-3 text-center">
            <div className="text-[10px] text-[#8AA0AB]">{year} deduction</div>
            <div className="font-['Outfit'] font-semibold text-[#8A7018]">{usd(report.deduction)}</div>
          </div>
        </div>
      ) : null}

      <select className="h-12 w-full rounded-md border border-slate-200 px-3" value={jobId} onChange={(e) => setJobId(e.target.value)}>
        <option value="">General business (no job)</option>
        {jobs.map((j) => <option key={j.id} value={j.id}>{j.job_number} · {j.name}</option>)}
      </select>
      <Input className="h-12" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Note — dump run, supplier, office" />

      {active ? (
        <div className="rounded-2xl bg-[#0A4D68] text-white p-4">
          <div className="text-[11px] uppercase tracking-wide text-[#C9A227]">Trip running</div>
          <div className="font-semibold">{active.job_name || "Business miles"}</div>
          <Button type="button" className="mt-3 w-full h-12 bg-[#C9A227] text-[#061A23] hover:bg-[#B89120]" disabled={stop.isPending} onClick={() => stop.mutate()}>
            {stop.isPending ? "Stopping…" : "Stop trip"}
          </Button>
        </div>
      ) : (
        <Button type="button" className="w-full h-12 bg-[#0A4D68] hover:bg-[#083D53]" disabled={start.isPending} onClick={() => start.mutate()} data-testid="mileage-start">
          {start.isPending ? "Starting…" : "Start trip from here"}
        </Button>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2">
        <div className="text-xs font-semibold uppercase text-[#0A4D68]">Or type miles</div>
        <Label>Miles</Label>
        <Input className="h-12" inputMode="decimal" type="number" step="any" value={miles} onChange={(e) => setMiles(e.target.value)} />
        <Button type="button" variant="outline" className="w-full h-11" disabled={manual.isPending} onClick={() => manual.mutate()}>
          {manual.isPending ? "Saving…" : "Save miles"}
        </Button>
      </div>

      <div className="text-xs text-[#8AA0AB]">Uses the IRS-style rate set by the owner ({report?.rate || 0.7}/mile). Confirm with your tax pro.</div>
    </div>
  );
}
