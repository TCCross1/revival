import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import api from "@/lib/api";
import { BRAND } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KeyRound, ArrowLeft, Loader2, CheckCircle2 } from "lucide-react";

function formatApiErrorDetail(detail) {
  if (detail == null) return "Something went wrong. Please try again.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((e) => (e && typeof e.msg === "string" ? e.msg : "")).filter(Boolean).join(" ");
  if (detail && typeof detail.msg === "string") return detail.msg;
  return String(detail);
}

export default function ChangePassword() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: "", current_password: "", new_password: "", confirm: "" });
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const set = (k, v) => setForm({ ...form, [k]: v });

  useEffect(() => {
    if (done) {
      const t = setTimeout(() => navigate("/login"), 2500);
      return () => clearTimeout(t);
    }
  }, [done, navigate]);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.email || !form.current_password || !form.new_password) { setError("Please fill in all fields."); return; }
    if (form.new_password !== form.confirm) { setError("New passwords do not match."); return; }
    if (form.new_password.length < 6) { setError("New password must be at least 6 characters."); return; }
    setSubmitting(true);
    try {
      await api.post("/auth/change-password", { email: form.email, current_password: form.current_password, new_password: form.new_password });
      setDone(true);
    } catch (err) {
      setError(formatApiErrorDetail(err.response?.data?.detail) || "Could not change password.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F4F7F8] p-6 font-['Work_Sans']">
      <div className="w-full max-w-md">
        <img src={BRAND.logo} alt="Revival Pro" className="h-16 w-auto mx-auto mb-6" />
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8" data-testid="change-password-page">
          {done ? (
            <div className="text-center" data-testid="change-password-success">
              <div className="flex justify-center mb-4"><span className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600"><CheckCircle2 size={30} /></span></div>
              <h2 className="text-2xl font-semibold font-['Outfit']">Password updated</h2>
              <p className="text-[#4B6370] mt-2 mb-6">You can now sign in with your new password.</p>
              <Button onClick={() => navigate("/login")} className="w-full h-11 bg-[#0A4D68] hover:bg-[#083D53]">Back to sign in</Button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-1">
                <KeyRound className="text-[#0A4D68]" size={22} />
                <h2 className="text-2xl font-semibold text-[#061A23] font-['Outfit'] tracking-tight">Change password</h2>
              </div>
              <p className="text-[#4B6370] mb-6 text-sm">Enter your email and current password, then set a new one.</p>
              <form onSubmit={submit} className="space-y-4">
                <div>
                  <Label>Email</Label>
                  <Input type="email" data-testid="cp-email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="you@company.com" className="mt-1 h-11" />
                </div>
                <div>
                  <Label>Current password</Label>
                  <Input type="password" data-testid="cp-current" value={form.current_password} onChange={(e) => set("current_password", e.target.value)} className="mt-1 h-11" />
                </div>
                <div>
                  <Label>New password</Label>
                  <Input type="password" data-testid="cp-new" value={form.new_password} onChange={(e) => set("new_password", e.target.value)} className="mt-1 h-11" />
                </div>
                <div>
                  <Label>Confirm new password</Label>
                  <Input type="password" data-testid="cp-confirm" value={form.confirm} onChange={(e) => set("confirm", e.target.value)} className="mt-1 h-11" />
                </div>
                {error && <div data-testid="cp-error" className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{error}</div>}
                <Button type="submit" data-testid="cp-submit-btn" disabled={submitting} className="w-full h-12 text-base bg-[#0A4D68] hover:bg-[#083D53] gap-2">
                  {submitting ? <Loader2 className="animate-spin" size={18} /> : <KeyRound size={18} />}
                  {submitting ? "Updating…" : "Update Password"}
                </Button>
              </form>
              <div className="text-center mt-4">
                <Link to="/login" className="text-sm font-medium text-[#0A4D68] hover:underline inline-flex items-center gap-1"><ArrowLeft size={14} /> Back to sign in</Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
