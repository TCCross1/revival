import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ArrowLeft, Camera } from "lucide-react";

const CATEGORIES = ["Materials", "Labor", "Subcontractors", "Overhead", "Other"];

export default function FieldReceipt() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fileRef = useRef(null);
  const [preview, setPreview] = useState("");
  const [file, setFile] = useState(null);
  const [jobId, setJobId] = useState("");
  const [category, setCategory] = useState("Materials");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");

  const { data: jobs = [] } = useQuery({
    queryKey: ["field-jobs"],
    queryFn: async () => (await api.get("/field/jobs")).data,
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Take a photo of the receipt first.");
      if (!jobId) throw new Error("Choose the job this belongs to.");
      if (!amount) throw new Error("Type the total on the receipt.");
      const body = new FormData();
      body.append("job_id", jobId);
      body.append("category", category);
      body.append("amount", amount);
      body.append("notes", notes);
      body.append("photo", file);
      return (await api.post("/field/receipts", body, { headers: { "Content-Type": "multipart/form-data" } })).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["job-sheet"] });
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["financials-overview"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
      toast.success("Receipt is on the job sheet");
      navigate("/field");
    },
    onError: async (err) => toast.error(err.message || await formatApiError(err, "Could not save that receipt. Please try again.")),
  });

  const onFile = (chosen) => {
    if (!chosen) return;
    setFile(chosen);
    const reader = new FileReader();
    reader.onload = () => setPreview(String(reader.result || ""));
    reader.readAsDataURL(chosen);
  };

  return (
    <div className="space-y-4 max-w-lg mx-auto" data-testid="field-receipt-page">
      <button type="button" onClick={() => navigate("/field")} className="flex items-center gap-1 text-sm text-[#C9A227]">
        <ArrowLeft size={16} /> Field
      </button>
      <h1 className="text-3xl font-['Outfit'] font-semibold text-white">Snap a receipt</h1>
      <p className="text-white/70">Photo, job, what it was, total. It hits the job sheet and the books right away.</p>

      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="w-full rounded-2xl border-2 border-dashed border-[#0A4D68]/30 bg-white min-h-[220px] flex flex-col items-center justify-center overflow-hidden"
        data-testid="receipt-camera"
      >
        {preview ? (
          <img src={preview} alt="Receipt" className="w-full h-56 object-cover" />
        ) : (
          <>
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#0A4D68] text-white">
              <Camera size={26} />
            </span>
            <div className="mt-3 font-semibold text-[#0A4D68]">Take photo</div>
            <div className="text-xs text-[#8AA0AB]">Uses the iPhone camera</div>
          </>
        )}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0])}
      />

      <div>
        <Label>Job</Label>
        <select className="mt-1 h-12 w-full rounded-md border border-slate-200 px-3 text-base" value={jobId} onChange={(e) => setJobId(e.target.value)} data-testid="receipt-job">
          <option value="">Which job?</option>
          {jobs.map((j) => <option key={j.id} value={j.id}>{j.job_number} · {j.name}</option>)}
        </select>
      </div>
      <div>
        <Label>What was it?</Label>
        <select className="mt-1 h-12 w-full rounded-md border border-slate-200 px-3 text-base" value={category} onChange={(e) => setCategory(e.target.value)} data-testid="receipt-category">
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div>
        <Label>Total on the receipt</Label>
        <Input className="mt-1 h-12 text-lg" inputMode="decimal" type="number" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" data-testid="receipt-amount" />
      </div>
      <div>
        <Label>Note (optional)</Label>
        <Input className="mt-1 h-12" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Home Depot — shims and adhesive" data-testid="receipt-notes" />
      </div>
      <Button type="button" className="w-full h-12 bg-[#0A4D68] hover:bg-[#083D53] text-base" disabled={save.isPending} onClick={() => save.mutate()} data-testid="receipt-save">
        {save.isPending ? "Saving…" : "Save to job"}
      </Button>
    </div>
  );
}
