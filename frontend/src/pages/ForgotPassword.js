import { useState } from "react";
import { Link } from "react-router-dom";
import api from "@/lib/api";
import { BRAND } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mail, ArrowLeft, Loader2, CheckCircle2 } from "lucide-react";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.post("/auth/forgot-password", { email, base_url: window.location.origin });
    } catch {}
    setSubmitting(false);
    setSent(true);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F4F7F8] p-6 font-['Work_Sans']">
      <div className="w-full max-w-md">
        <img src={BRAND.logo} alt="Revival Pro" className="h-16 w-auto mx-auto mb-6" />
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8" data-testid="forgot-password-page">
          {sent ? (
            <div className="text-center" data-testid="forgot-success">
              <div className="flex justify-center mb-4"><span className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600"><CheckCircle2 size={30} /></span></div>
              <h2 className="text-2xl font-semibold font-['Outfit']">Check your email</h2>
              <p className="text-[#4B6370] mt-2 mb-6">If an account exists for <strong>{email}</strong>, we've sent a secure link to reset your password. It expires in 1 hour.</p>
              <Link to="/login"><Button className="w-full h-11 bg-[#0A4D68] hover:bg-[#083D53]">Back to sign in</Button></Link>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-1"><Mail className="text-[#0A4D68]" size={22} /><h2 className="text-2xl font-semibold text-[#061A23] font-['Outfit'] tracking-tight">Forgot password</h2></div>
              <p className="text-[#4B6370] mb-6 text-sm">Enter your email and we'll send you a link to reset it.</p>
              <form onSubmit={submit} className="space-y-4">
                <div><Label>Email</Label><Input type="email" required data-testid="forgot-email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" className="mt-1 h-11" /></div>
                <Button type="submit" data-testid="forgot-submit-btn" disabled={submitting} className="w-full h-12 text-base bg-[#0A4D68] hover:bg-[#083D53] gap-2">{submitting ? <Loader2 className="animate-spin" size={18} /> : <Mail size={18} />}{submitting ? "Sending…" : "Send reset link"}</Button>
              </form>
              <div className="text-center mt-4"><Link to="/login" className="text-sm font-medium text-[#0A4D68] hover:underline inline-flex items-center gap-1"><ArrowLeft size={14} /> Back to sign in</Link></div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
