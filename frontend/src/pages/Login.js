import { useState } from "react";
import { Navigate, useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { BRAND } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import api from "@/lib/api";
import { LogIn, ClipboardList, Users, TrendingUp, Loader2 } from "lucide-react";

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
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (loading) return null;
  if (user) return <Navigate to="/" replace />;

  const handleGoogle = () => {
    // REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
    const redirectUrl = window.location.origin + "/";
    window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    if (!email || !password) { setError("Please enter your email and password."); return; }
    setSubmitting(true);
    try {
      const { data } = await api.post("/auth/login", { email, password });
      if (data.session_token) localStorage.setItem("session_token", data.session_token);
      setUser(data);
      navigate("/", { replace: true });
    } catch (err) {
      setError(formatApiErrorDetail(err.response?.data?.detail) || "Could not sign in.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 font-['Work_Sans']">
      {/* Left brand panel */}
      <div className="relative hidden lg:flex flex-col justify-between p-12 overflow-hidden">
        <div className="absolute inset-0 z-0" style={{ backgroundImage: `url(${BRAND.bg})`, backgroundSize: "cover", backgroundPosition: "center" }} />
        <div className="absolute inset-0 z-0 bg-[#062B3A]/80" />
        <div className="relative z-10">
          <img src={BRAND.logo} alt="Revival Pro" className="h-24 w-auto bg-white/95 rounded-xl p-3 shadow-lg" />
        </div>
        <div className="relative z-10 space-y-8 max-w-md">
          <h1 className="text-4xl lg:text-5xl font-semibold text-white font-['Outfit'] tracking-tight leading-tight">Capture. Organize. Close.</h1>
          <p className="text-white/80 text-lg">The all-in-one command center for your remodeling business — from first lead to final invoice.</p>
          <div className="space-y-4">
            {[
              { icon: TrendingUp, text: "Track your entire estimate pipeline in dollars" },
              { icon: Users, text: "Keep every client and lead in one simple place" },
              { icon: ClipboardList, text: "Run job costing and invoicing without spreadsheets" },
            ].map((f, i) => (
              <div key={i} className="flex items-center gap-3 text-white/90">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#C9A227] text-[#061A23]"><f.icon size={20} /></span>
                <span>{f.text}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="relative z-10 text-white/50 text-sm">© 2026 Revival Pro</div>
      </div>

      {/* Right login panel */}
      <div className="flex items-center justify-center p-8 bg-[#F4F7F8]">
        <div className="w-full max-w-md">
          <img src={BRAND.logo} alt="Revival Pro" className="h-20 w-auto mx-auto mb-8 lg:hidden" />
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
            <h2 className="text-3xl font-semibold text-[#061A23] font-['Outfit'] tracking-tight">Welcome back</h2>
            <p className="text-[#4B6370] mt-2 mb-6">Sign in to manage your estimates, jobs, and invoices.</p>

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
              <Button type="submit" data-testid="login-submit-btn" disabled={submitting} className="w-full h-12 text-base bg-[#0A4D68] hover:bg-[#083D53] text-white gap-2">
                {submitting ? <Loader2 className="animate-spin" size={18} /> : <LogIn size={18} />}
                {submitting ? "Signing in…" : "Sign In"}
              </Button>
            </form>

            <div className="text-center mt-3">
              <Link to="/change-password" data-testid="change-password-link" className="text-sm font-medium text-[#0A4D68] hover:underline">Change password</Link>
            </div>

            <div className="flex items-center gap-3 my-6">
              <div className="h-px flex-1 bg-slate-200" />
              <span className="text-xs text-[#4B6370]">or</span>
              <div className="h-px flex-1 bg-slate-200" />
            </div>

            <Button type="button" data-testid="google-login-btn" onClick={handleGoogle} variant="outline" className="w-full h-12 text-base gap-2 bg-white">
              <LogIn size={20} /> Continue with Google
            </Button>
            <p className="text-xs text-[#4B6370] text-center mt-6">Secure sign-in for the owner and your team.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
