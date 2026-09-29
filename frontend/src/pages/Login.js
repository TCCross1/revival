import { useState } from "react";
import { Navigate, useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import AuthSplitLayout from "@/components/brand/AuthSplitLayout";
import DollyAssistant from "@/components/DollyAssistant";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import api from "@/lib/api";
import { KeyRound, LogIn, Loader2 } from "lucide-react";

function formatApiErrorDetail(detail) {
  if (detail == null) return "Something went wrong. Please try again.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((e) => (e && typeof e.msg === "string" ? e.msg : "")).filter(Boolean).join(" ");
  if (detail && typeof detail.msg === "string") return detail.msg;
  return String(detail);
}

export default function Login() {
  const { user, loading, setUser } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [bypassCode, setBypassCode] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (loading) return null;
  if (user) return <Navigate to="/" replace />;

  const finishLogin = (data) => {
    if (data.session_token) localStorage.setItem("session_token", data.session_token);
    setUser(data);
    navigate("/", { replace: true });
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    if (!email || !password) { setError("Please enter your email and password."); return; }
    setSubmitting(true);
    try {
      const { data } = await api.post("/auth/login", { email, password });
      finishLogin(data);
    } catch (err) {
      setError(formatApiErrorDetail(err.response?.data?.detail) || "Could not sign in.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleBypass = async (e) => {
    e.preventDefault();
    setError("");
    if (!bypassCode.trim()) { setError("Enter the owner code."); return; }
    setSubmitting(true);
    try {
      const { data } = await api.post("/auth/bypass-code", { code: bypassCode.trim() });
      finishLogin(data);
    } catch (err) {
      setError(formatApiErrorDetail(err.response?.data?.detail) || "That code did not work.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <AuthSplitLayout pitch>
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
          <h2 className="text-3xl font-semibold text-[#061A23] font-['Outfit'] tracking-tight">Welcome back</h2>
          <p className="text-[#4B6370] mt-2 mb-6">Owner sign-in for Tim and Christy — or use your private shop code.</p>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" data-testid="login-email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" className="mt-1 h-11" autoComplete="username" />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" data-testid="login-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Your password" className="mt-1 h-11" autoComplete="current-password" />
            </div>
            {error && <div data-testid="login-error" className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{error}</div>}
            <Button type="submit" data-testid="login-submit-btn" disabled={submitting} className="w-full h-12 text-base bg-[#0B3A8F] hover:bg-[#082C73] text-white gap-2">
              {submitting ? <Loader2 className="animate-spin" size={18} /> : <LogIn size={18} />}
              {submitting ? "Signing in…" : "Sign In"}
            </Button>
          </form>

          <div className="flex items-center gap-3 my-6">
            <div className="h-px flex-1 bg-slate-200" />
            <span className="text-xs text-[#4B6370]">or owner code</span>
            <div className="h-px flex-1 bg-slate-200" />
          </div>

          <form onSubmit={handleBypass} className="space-y-3">
            <div>
              <Label htmlFor="bypass-code">Shop bypass code</Label>
              <Input id="bypass-code" data-testid="login-bypass-code" value={bypassCode} onChange={(e) => setBypassCode(e.target.value)} placeholder="Enter code" className="mt-1 h-11" autoComplete="one-time-code" />
            </div>
            <Button type="submit" data-testid="login-bypass-btn" disabled={submitting} variant="outline" className="w-full h-11 border-[#0B3A8F]/30 text-[#0B3A8F] gap-2">
              <KeyRound size={18} />
              Enter with code
            </Button>
          </form>

          <div className="text-center mt-4 flex items-center justify-center gap-4">
            <Link to="/change-password" data-testid="change-password-link" className="text-sm font-medium text-[#0B3A8F] hover:underline">Change password</Link>
            <Link to="/forgot-password" data-testid="forgot-password-link" className="text-sm font-medium text-[#0B3A8F] hover:underline">Forgot password?</Link>
          </div>
          <p className="text-xs text-[#4B6370] text-center mt-6">Secure sign-in for Tim and Christy only. Dolly is here if you need a hand.</p>
        </div>
      </AuthSplitLayout>
      <DollyAssistant openByDefault />
    </>
  );
}
