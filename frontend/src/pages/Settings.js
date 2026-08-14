import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Building2, Save } from "lucide-react";
import { toast } from "sonner";

export default function Settings() {
  const qc = useQueryClient();
  const [form, setForm] = useState(null);
  const { data, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => (await api.get("/settings")).data,
  });
  useEffect(() => { if (data) setForm(data); }, [data]);

  const save = useMutation({
    mutationFn: async (payload) => (await api.put("/settings", payload)).data,
    onSuccess: (res) => {
      setForm(res);
      qc.invalidateQueries({ queryKey: ["settings"] });
      toast.success("Company profile saved");
    },
    onError: () => toast.error("Could not save"),
  });

  if (isLoading || !form) return <div className="text-[#4B6370]">Loading…</div>;
  const set = (k, v) => setForm({ ...form, [k]: v });

  return (
    <div className="space-y-6 max-w-2xl" data-testid="settings-page">
      <div>
        <h1 className="text-3xl sm:text-4xl font-semibold font-['Outfit'] tracking-tight">Company Profile</h1>
        <p className="text-[#4B6370] mt-1">These details appear on your contracts. Set them once.</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 px-6 py-4 bg-[#0A4D68]">
          <Building2 size={18} className="text-[#C9A227]" />
          <h2 className="text-white font-['Outfit'] font-semibold">Contractor Details</h2>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <Label className="text-xs text-[#4B6370]">Business name</Label>
            <Input className="mt-1" data-testid="company-name" value={form.name || ""} onChange={(e) => set("name", e.target.value)} placeholder="Revival Pro" />
          </div>
          <div>
            <Label className="text-xs text-[#4B6370]">Address</Label>
            <Input className="mt-1" data-testid="company-address" value={form.address || ""} onChange={(e) => set("address", e.target.value)} placeholder="123 Main St, Austin, TX 78701" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label className="text-xs text-[#4B6370]">Phone</Label>
              <Input className="mt-1" data-testid="company-phone" value={form.phone || ""} onChange={(e) => set("phone", e.target.value)} placeholder="(512) 555-0100" />
            </div>
            <div>
              <Label className="text-xs text-[#4B6370]">Contact email</Label>
              <Input className="mt-1" data-testid="company-email" value={form.email || ""} onChange={(e) => set("email", e.target.value)} placeholder="you@company.com" />
            </div>
          </div>
          <div>
            <Label className="text-xs text-[#4B6370]">License info</Label>
            <Input className="mt-1" data-testid="company-license" value={form.license || ""} onChange={(e) => set("license", e.target.value)} placeholder="TX Lic. #RRC-000000" />
          </div>
          <div className="pt-2">
            <Button data-testid="save-settings-btn" onClick={() => save.mutate({ name: form.name, address: form.address, phone: form.phone, license: form.license, email: form.email })} disabled={save.isPending} className="gap-1.5 bg-[#0A4D68] hover:bg-[#083D53]">
              <Save size={16} /> {save.isPending ? "Saving…" : "Save Profile"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
