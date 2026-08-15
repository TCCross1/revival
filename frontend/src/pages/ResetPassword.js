import { useState, useEffect } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import api from "@/lib/api";
import { BRAND } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KeyRound, Loader2, CheckCircle2, ArrowLeft } from "lucide-react";

function fmtErr(detail) {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((e) => e?.msg || "").filter(Boolean).join(" ");
  return "Something went wrong.";
}

export default function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") || "";
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { if (done) { const t = setTimeout(() => navigate("/login"), 2500); return () => clearTimeout(t); } }, [done, navigate]);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (pw.length < 6) { setError("Password must be at least 6 characters."); return; }
    if (pw !== confirm) { setError("Passwords do not match."); return; }
    setSubmitting(true);
    try {
      await api.post("/auth/reset-password", { token, new_password: pw });
      setDone(true);
    } catch (err) {
      setError(fmtErr(err.response?.data?.detail));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F4F7F8] p-6 font-['Work_Sans']">
      <div className="w-full max-w-md">
        <img src={BRAND.logo} alt="Revival Pro" className="h-16 w-auto mx-auto mb-6" />
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8" data-testid="reset-password-page">
          {done ? (
            <div className="text-center" data-testid="reset-success">
              <div className="flex justify-center mb-4"><span className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600"><CheckCircle2 size={30} /></span></div>
              <h2 className="text-2xl font-semibold font-['Outfit']">Password reset</h2>
              <p className="text-[#4B6370] mt-2">You can now sign in with your new password. Redirecting…</p>
            </div>
          ) : !token ? (
            <div className="text-center" data-testid="reset-no-token">
              <h2 className="text-2xl font-semibold font-['Outfit']">Invalid link</h2>
              <p className="text-[#4B6370] mt-2 mb-6">This reset link is missing or invalid. Please request a new one.</p>
              <Link to="/forgot-password"><Button className="w-full h-11 bg-[#0A4D68] hover:bg-[#083D53]">Request a new link</Button></Link>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-1"><KeyRound className="text-[#0A4D68]" size={22} /><h2 className="text-2xl font-semibold text-[#061A23] font-['Outfit'] tracking-tight">Set a new password</h2></div>
              <p className="text-[#4B6370] mb-6 text-sm">Choose a new password for your account.</p>
              <form onSubmit={submit} className="space-y-4">
                <div><Label>New password</Label><Input type="password" data-testid="reset-new" value={pw} onChange={(e) => setPw(e.target.value)} className="mt-1 h-11" /></div>
                <div><Label>Confirm new password</Label><Input type="password" data-testid="reset-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="mt-1 h-11" /></div>
                {error && <div data-testid="reset-error" className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{error}</div>}
                <Button type="submit" data-testid="reset-submit-btn" disabled={submitting} className="w-full h-12 text-base bg-[#0A4D68] hover:bg-[#083D53] gap-2">{submitting ? <Loader2 className="animate-spin" size={18} /> : <KeyRound size={18} />}{submitting ? "Saving…" : "Reset Password"}</Button>
              </form>
              <div className="text-center mt-4"><Link to="/login" className="text-sm font-medium text-[#0A4D68] hover:underline inline-flex items-center gap-1"><ArrowLeft size={14} /> Back to sign in</Link></div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
