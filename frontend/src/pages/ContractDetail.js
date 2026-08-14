import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import { usd, usdCents } from "@/lib/format";
import StatusBadge from "@/components/StatusBadge";
import SignaturePad from "@/components/SignaturePad";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Download, Save, Plus, Trash2, FileSignature, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

const todayISO = () => new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

const SectionCard = ({ n, title, children, right }) => (
  <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
    <div className="flex items-center justify-between gap-3 px-6 py-4 bg-[#0A4D68]">
      <h2 className="text-white font-['Outfit'] font-semibold flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#C9A227] text-[#061A23] text-xs font-bold">{n}</span>
        {title}
      </h2>
      {right}
    </div>
    <div className="p-6">{children}</div>
  </div>
);

const Field = ({ label, ...props }) => (
  <div>
    <Label className="text-xs text-[#4B6370]">{label}</Label>
    <Input className="mt-1" {...props} />
  </div>
);

export default function ContractDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["contract", id],
    queryFn: async () => (await api.get(`/contracts/${id}`)).data,
  });

  useEffect(() => { if (data) setForm(data); }, [data]);

  const save = useMutation({
    mutationFn: async (payload) => (await api.put(`/contracts/${id}`, payload)).data,
    onSuccess: (res) => {
      setForm(res);
      qc.invalidateQueries({ queryKey: ["contracts"] });
      qc.invalidateQueries({ queryKey: ["contract", id] });
      toast.success("Contract saved");
    },
    onError: () => toast.error("Could not save contract"),
  });

  if (isLoading || !form) return <div className="text-[#4B6370]">Loading contract…</div>;
  if (isError) return <div className="text-[#4B6370]">Contract not found.</div>;

  const set = (k, v) => setForm({ ...form, [k]: v });

  const payload = () => ({
    contractor_name: form.contractor_name, contractor_address: form.contractor_address,
    contractor_phone: form.contractor_phone, contractor_license: form.contractor_license,
    client_name: form.client_name, client_address: form.client_address,
    client_phone: form.client_phone, client_email: form.client_email,
    project_address: form.project_address, project_description: form.project_description,
    payment_schedule: form.payment_schedule, exclusions: form.exclusions,
    change_order_markup: Number(form.change_order_markup || 0),
    client_signature: form.client_signature, client_signed_date: form.client_signed_date,
    contractor_signature: form.contractor_signature, contractor_signed_date: form.contractor_signed_date,
    status: form.status,
  });

  const doSave = () => save.mutate(payload());

  const markSigned = () => {
    if (!form.client_signature || !form.contractor_signature) {
      return toast.error("Both parties must sign before marking as signed.");
    }
    const next = { ...form, status: "Signed" };
    setForm(next);
    save.mutate({ ...payload(), status: "Signed" });
  };

  const downloadPdf = async () => {
    try {
      const res = await api.get(`/contracts/${id}/pdf`, { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url; a.download = `${form.contract_number}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
      toast.success("Contract PDF downloaded");
    } catch { toast.error("Could not generate PDF"); }
  };

  // Payment schedule helpers
  const setMs = (i, k, v) => {
    const ps = [...form.payment_schedule];
    ps[i] = { ...ps[i], [k]: v };
    set("payment_schedule", ps);
  };
  const addMs = () => set("payment_schedule", [...form.payment_schedule, { label: "", amount: 0, note: "" }]);
  const rmMs = (i) => set("payment_schedule", form.payment_schedule.filter((_, x) => x !== i));

  // Exclusions helpers
  const setEx = (i, v) => { const ex = [...form.exclusions]; ex[i] = v; set("exclusions", ex); };
  const addEx = () => set("exclusions", [...form.exclusions, ""]);
  const rmEx = (i) => set("exclusions", form.exclusions.filter((_, x) => x !== i));

  const markup = Number(form.change_order_markup || 0);
  const scheduleTotal = form.payment_schedule.reduce((s, m) => s + Number(m.amount || 0), 0);

  return (
    <div className="space-y-6 max-w-5xl mx-auto" data-testid="contract-detail-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button onClick={() => navigate("/contracts")} className="flex items-center gap-1.5 text-sm font-medium text-[#0A4D68] hover:underline" data-testid="back-to-contracts-btn">
          <ArrowLeft size={16} /> Back to Contracts
        </button>
        <div className="flex items-center gap-2">
          <Button data-testid="contract-pdf-btn" onClick={downloadPdf} variant="outline" className="gap-1.5"><Download size={16} /> Download PDF</Button>
          <Button data-testid="save-contract-btn" onClick={doSave} disabled={save.isPending} className="gap-1.5 bg-[#0A4D68] hover:bg-[#083D53]"><Save size={16} /> {save.isPending ? "Saving…" : "Save"}</Button>
        </div>
      </div>

      {/* Title banner */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#C9A227]/15 text-[#C9A227]"><FileSignature size={24} /></span>
          <div>
            <h1 className="text-2xl font-semibold font-['Outfit'] tracking-tight">Construction Contract</h1>
            <div className="text-sm text-[#4B6370]">{form.contract_number} · {usd(form.total)}</div>
          </div>
        </div>
        <StatusBadge status={form.status} />
      </div>

      {/* 1. Parties */}
      <SectionCard n="1" title="Parties">
        <div className="grid md:grid-cols-2 gap-6">
          <div className="space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-[#0A4D68]">Contractor</div>
            <Field label="Company name" data-testid="contractor-name" value={form.contractor_name} onChange={(e) => set("contractor_name", e.target.value)} />
            <Field label="Address" data-testid="contractor-address" value={form.contractor_address} onChange={(e) => set("contractor_address", e.target.value)} />
            <Field label="Phone" data-testid="contractor-phone" value={form.contractor_phone} onChange={(e) => set("contractor_phone", e.target.value)} />
            <Field label="License info" data-testid="contractor-license" value={form.contractor_license} onChange={(e) => set("contractor_license", e.target.value)} />
          </div>
          <div className="space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-[#0A4D68]">Client (Homeowner)</div>
            <Field label="Full name" data-testid="contract-client-name" value={form.client_name} onChange={(e) => set("client_name", e.target.value)} />
            <Field label="Address" value={form.client_address} onChange={(e) => set("client_address", e.target.value)} />
            <Field label="Phone" value={form.client_phone} onChange={(e) => set("client_phone", e.target.value)} />
            <Field label="Email" value={form.client_email} onChange={(e) => set("client_email", e.target.value)} />
          </div>
        </div>
      </SectionCard>

      {/* 2. Project Info */}
      <SectionCard n="2" title="Project Information">
        <div className="space-y-3">
          <Field label="Job address" data-testid="project-address" value={form.project_address} onChange={(e) => set("project_address", e.target.value)} />
          <div>
            <Label className="text-xs text-[#4B6370]">Description of the project</Label>
            <Textarea className="mt-1" data-testid="project-description" value={form.project_description} onChange={(e) => set("project_description", e.target.value)} />
          </div>
        </div>
      </SectionCard>

      {/* 3. Scope of Work */}
      <SectionCard n="3" title="Scope of Work" right={<span className="text-xs text-white/70">Pulled from the won estimate</span>}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[#4B6370] border-b border-slate-200">
                <th className="py-2 pr-3 font-medium">Description</th>
                <th className="py-2 px-3 font-medium text-right">Qty</th>
                <th className="py-2 px-3 font-medium text-right">Unit Price</th>
                <th className="py-2 pl-3 font-medium text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {form.line_items.map((li, i) => (
                <tr key={i} className="border-b border-slate-100" data-testid={`scope-item-${i}`}>
                  <td className="py-2 pr-3">{li.description}</td>
                  <td className="py-2 px-3 text-right text-[#4B6370]">{li.quantity}</td>
                  <td className="py-2 px-3 text-right text-[#4B6370]">{usdCents(li.unit_price)}</td>
                  <td className="py-2 pl-3 text-right font-medium">{usdCents(li.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {/* 4. Price & Payment */}
      <SectionCard n="4" title="Contract Price and Payment Terms">
        <div className="flex items-center justify-between rounded-lg bg-[#0A4D68]/5 px-4 py-3 mb-5">
          <span className="text-sm text-[#4B6370]">Total Contract Price</span>
          <span className="text-2xl font-semibold font-['Outfit'] text-[#0A4D68]" data-testid="contract-total">{usdCents(form.total)}</span>
        </div>
        <div className="flex items-center justify-between mb-2">
          <Label className="text-sm font-medium">Payment Schedule</Label>
          <button onClick={addMs} data-testid="add-milestone-btn" className="text-xs font-medium text-[#0A4D68] hover:underline flex items-center gap-1"><Plus size={13} /> Add milestone</button>
        </div>
        <div className="space-y-2">
          {form.payment_schedule.map((m, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-start" data-testid={`milestone-${i}`}>
              <div className="col-span-12 sm:col-span-5">
                <Input placeholder="Milestone" value={m.label} onChange={(e) => setMs(i, "label", e.target.value)} data-testid={`milestone-label-${i}`} />
              </div>
              <div className="col-span-7 sm:col-span-4">
                <Input placeholder="Note (optional)" value={m.note} onChange={(e) => setMs(i, "note", e.target.value)} />
              </div>
              <div className="col-span-4 sm:col-span-2">
                <Input type="number" step="any" placeholder="Amount" value={m.amount} onChange={(e) => setMs(i, "amount", Number(e.target.value))} data-testid={`milestone-amount-${i}`} />
              </div>
              <button onClick={() => rmMs(i)} className="col-span-1 mt-2 text-red-500 hover:bg-red-50 rounded p-1 flex justify-center"><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
        <div className="text-right text-xs text-[#4B6370] mt-2">
          Scheduled total: <span className={Math.abs(scheduleTotal - form.total) > 0.5 ? "text-amber-600 font-semibold" : "text-emerald-600 font-semibold"}>{usdCents(scheduleTotal)}</span>
          {Math.abs(scheduleTotal - form.total) > 0.5 && <span className="text-amber-600"> (doesn’t match contract total)</span>}
        </div>
      </SectionCard>

      {/* 5. Exclusions */}
      <SectionCard n="5" title="Exclusions">
        <p className="text-sm text-[#4B6370] mb-3">These items are <strong>not</strong> included unless added in writing.</p>
        <div className="space-y-2">
          {form.exclusions.map((x, i) => (
            <div key={i} className="flex gap-2 items-start" data-testid={`exclusion-${i}`}>
              <span className="mt-3 h-1.5 w-1.5 rounded-full bg-[#C9A227] shrink-0" />
              <Textarea rows={1} className="min-h-[42px]" value={x} onChange={(e) => setEx(i, e.target.value)} />
              <button onClick={() => rmEx(i)} className="mt-2 text-red-500 hover:bg-red-50 rounded p-1"><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
        <button onClick={addEx} data-testid="add-exclusion-btn" className="mt-3 text-xs font-medium text-[#0A4D68] hover:underline flex items-center gap-1"><Plus size={13} /> Add exclusion</button>
      </SectionCard>

      {/* 6. Change Orders */}
      <SectionCard n="6" title="Change Orders">
        <ul className="space-y-2 text-sm text-[#061A23]">
          {[
            "Any change to the scope of work, price, or timeline must be put in writing.",
            "Both parties must sign the change order before the additional work begins.",
            "Verbal agreements are not binding.",
            "Each change order will state the description of the change, the price adjustment, and any effect on the schedule.",
          ].map((t, i) => (
            <li key={i} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 rounded-full bg-[#0A4D68] shrink-0" />{t}</li>
          ))}
          <li className="flex gap-2 items-center flex-wrap">
            <span className="mt-2 h-1.5 w-1.5 rounded-full bg-[#0A4D68] shrink-0" />
            Change order work will be priced with a standard markup of
            <Input type="number" step="any" data-testid="markup-input" className="w-20 h-8 mx-1 inline-block" value={form.change_order_markup} onChange={(e) => set("change_order_markup", e.target.value)} />
            % over cost.
          </li>
        </ul>
        <p className="text-xs text-[#4B6370] mt-3">Current markup: <strong>{markup}%</strong></p>
      </SectionCard>

      {/* 7. Signatures */}
      <SectionCard n="7" title="Signatures">
        <p className="text-sm text-[#4B6370] mb-4">Sign directly on the screen — works great on phones and tablets.</p>
        <div className="grid md:grid-cols-2 gap-8">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-[#0A4D68] mb-2">Client — {form.client_name}</div>
            <SignaturePad testid="client-signature-pad" value={form.client_signature}
              onChange={(v) => setForm({ ...form, client_signature: v, client_signed_date: v ? todayISO() : "" })} />
            <div className="mt-2 text-sm text-[#4B6370]">Date: <span className="text-[#061A23] font-medium">{form.client_signed_date || "—"}</span></div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-[#0A4D68] mb-2">Contractor — {form.contractor_name}</div>
            <SignaturePad testid="contractor-signature-pad" value={form.contractor_signature}
              onChange={(v) => setForm({ ...form, contractor_signature: v, contractor_signed_date: v ? todayISO() : "" })} />
            <div className="mt-2 text-sm text-[#4B6370]">Date: <span className="text-[#061A23] font-medium">{form.contractor_signed_date || "—"}</span></div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mt-6 pt-4 border-t border-slate-200">
          <Button data-testid="save-signatures-btn" onClick={doSave} disabled={save.isPending} variant="outline" className="gap-1.5"><Save size={16} /> Save signatures</Button>
          <Button data-testid="mark-signed-btn" onClick={markSigned} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700"><CheckCircle2 size={16} /> Mark as Signed</Button>
        </div>
      </SectionCard>
    </div>
  );
}
