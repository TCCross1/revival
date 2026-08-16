import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import api from "@/lib/api";
import { usd, usdCents } from "@/lib/format";
import { BRAND } from "@/lib/format";
import SignaturePad from "@/components/SignaturePad";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle2, ShieldCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";

const Block = ({ title, children }) => (
  <div className="border-b border-slate-100 py-5">
    <h3 className="text-xs font-semibold uppercase tracking-wide text-[#0A4D68] mb-2">{title}</h3>
    {children}
  </div>
);

const fillMarkup = (text, markup) => (text || "").split("{markup}").join(String(markup ?? 20));

const TermsText = ({ text }) => {
  const parts = (text || "").split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  return (
    <div className="space-y-2 text-sm whitespace-pre-wrap">
      {parts.map((p, i) => <p key={i}>{p}</p>)}
    </div>
  );
};

export default function PublicSign() {
  const { token } = useParams();
  const [signature, setSignature] = useState("");
  const [name, setName] = useState("");
  const [done, setDone] = useState(false);

  const { data: c, isLoading, isError } = useQuery({
    queryKey: ["public-contract", token],
    queryFn: async () => (await api.get(`/public/contracts/${token}`)).data,
    retry: false,
  });

  const role = c?.sign_role === "contractor" ? "contractor" : "client";
  const signerName = role === "contractor" ? c?.contractor_name : c?.client_name;
  const roleLabel = role === "contractor" ? "Contractor" : "Client";

  const sign = useMutation({
    mutationFn: async () => (await api.post(`/public/contracts/${token}/sign`, { signature, signed_name: name })).data,
    onSuccess: () => { setDone(true); window.scrollTo({ top: 0, behavior: "smooth" }); },
    onError: (err) => toast.error(err?.response?.data?.detail || "Could not submit signature"),
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0A4D68]">
        <Loader2 className="animate-spin text-white" size={32} />
      </div>
    );
  }
  if (isError || !c) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#F4F7F8] p-6 text-center font-['Work_Sans']">
        <img src={BRAND.logo} alt="Revival Pro" className="h-16 mb-6" />
        <h1 className="text-2xl font-semibold font-['Outfit'] text-[#061A23]">Link not found</h1>
        <p className="text-[#4B6370] mt-2">This signing link is invalid or has expired. Please contact Revival Pro.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F4F7F8] font-['Work_Sans'] pb-16">
      <div className="bg-[#0A4D68] text-white">
        <div className="max-w-3xl mx-auto px-5 py-5 flex items-center gap-3">
          <img src={BRAND.logo} alt="Revival Pro" className="h-11 w-auto bg-white/95 rounded-lg p-1.5" />
          <div>
            <div className="font-['Outfit'] font-semibold text-lg leading-tight">Construction Contract</div>
            <div className="text-white/70 text-sm">{c.contract_number}</div>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-5">
        {done ? (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 mt-8 text-center" data-testid="sign-success">
            <div className="flex justify-center mb-4"><span className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600"><CheckCircle2 size={34} /></span></div>
            <h1 className="text-2xl font-semibold font-['Outfit']">Thank you, it's signed!</h1>
            <p className="text-[#4B6370] mt-2">Your signature has been received for contract {c.contract_number}. Revival Pro has been notified and will be in touch about next steps.</p>
          </div>
        ) : (
          <>
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm mt-8 px-6">
              <Block title="1. Parties">
                <div className="grid sm:grid-cols-2 gap-4 text-sm">
                  <div>
                    <div className="text-[#4B6370] text-xs">Contractor</div>
                    <div className="font-medium">{c.contractor_name}</div>
                    <div className="text-[#4B6370]">{c.contractor_address}</div>
                    <div className="text-[#4B6370]">{c.contractor_phone}</div>
                    <div className="text-[#4B6370]">{c.contractor_license}</div>
                  </div>
                  <div>
                    <div className="text-[#4B6370] text-xs">Client</div>
                    <div className="font-medium">{c.client_name}</div>
                    <div className="text-[#4B6370]">{c.client_address}</div>
                    <div className="text-[#4B6370]">{c.client_phone}</div>
                  </div>
                </div>
              </Block>

              <Block title="2. Project Information">
                <div className="text-sm"><span className="text-[#4B6370]">Job address:</span> {c.project_address}</div>
                <div className="text-sm mt-1"><span className="text-[#4B6370]">Description:</span> {c.project_description}</div>
              </Block>

              <Block title="3. Scope of Work">
                <div className="space-y-1.5">
                  {c.line_items.map((li, i) => (
                    <div key={i} className="flex justify-between text-sm">
                      <span>{li.description} <span className="text-[#4B6370]">× {li.quantity}</span></span>
                      <span className="font-medium">{usdCents(li.amount)}</span>
                    </div>
                  ))}
                </div>
              </Block>

              <Block title="4. Contract Price & Payment Terms">
                <div className="flex justify-between items-center bg-[#0A4D68]/5 rounded-lg px-4 py-2.5 mb-3">
                  <span className="text-sm text-[#4B6370]">Total Contract Price</span>
                  <span className="text-xl font-semibold font-['Outfit'] text-[#0A4D68]">{usdCents(c.total)}</span>
                </div>
                <div className="space-y-1.5">
                  {c.payment_schedule.map((m, i) => (
                    <div key={i} className="flex justify-between text-sm">
                      <span>{m.label}{m.note ? <span className="text-[#4B6370]"> — {m.note}</span> : null}</span>
                      <span className="font-medium">{usdCents(m.amount)}</span>
                    </div>
                  ))}
                </div>
              </Block>

              <Block title="5. General Terms">
                <TermsText text={c.terms} />
              </Block>

              <Block title="6. Exclusions">
                <ul className="space-y-1.5 text-sm">
                  {(c.exclusions || []).map((x, i) => (
                    <li key={i} className="flex gap-2"><span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-[#C9A227] shrink-0" />{x}</li>
                  ))}
                </ul>
              </Block>

              <Block title="7. Change Orders">
                {c.change_order_terms ? (
                  <ul className="space-y-1.5 text-sm">
                    {fillMarkup(c.change_order_terms, c.change_order_markup).split("\n").map((line) => line.trim()).filter(Boolean).map((line, i) => (
                      <li key={i} className="flex gap-2"><span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-[#0A4D68] shrink-0" />{line}</li>
                    ))}
                  </ul>
                ) : (
                  <ul className="space-y-1.5 text-sm">
                    <li className="flex gap-2"><span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-[#0A4D68] shrink-0" />Any change to the scope, price, or timeline must be put in writing.</li>
                    <li className="flex gap-2"><span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-[#0A4D68] shrink-0" />Both parties must sign the change order before extra work begins.</li>
                    <li className="flex gap-2"><span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-[#0A4D68] shrink-0" />Verbal agreements are not binding.</li>
                    <li className="flex gap-2"><span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-[#0A4D68] shrink-0" />Change order work is priced with a standard markup of {c.change_order_markup}% over cost.</li>
                  </ul>
                )}
              </Block>
            </div>

            {/* Signature */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm mt-6 p-6" data-testid="public-sign-box">
              <h3 className="text-lg font-semibold font-['Outfit'] mb-1">{roleLabel} Signature</h3>
              <p className="text-sm text-[#4B6370] mb-4">By signing below you agree to the terms of this contract.</p>
              <div className="mb-4">
                <Label className="text-xs text-[#4B6370]">Your full name</Label>
                <Input className="mt-1" data-testid="public-sign-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={signerName} />
              </div>
              <SignaturePad testid="public-signature-pad" value={signature} onChange={setSignature} />
              <Button data-testid="public-submit-sign" onClick={() => sign.mutate()} disabled={sign.isPending || !signature}
                className="w-full mt-5 h-12 text-base bg-emerald-600 hover:bg-emerald-700 gap-2">
                {sign.isPending ? <Loader2 className="animate-spin" size={18} /> : <CheckCircle2 size={18} />}
                {sign.isPending ? "Submitting…" : "Sign & Submit"}
              </Button>
              <p className="text-xs text-[#8AA0AB] text-center mt-4 flex items-center justify-center gap-1">
                <ShieldCheck size={13} /> Secure signing by Revival Pro
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
