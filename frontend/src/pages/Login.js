import { Navigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { BRAND } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { LogIn, ClipboardList, Users, TrendingUp } from "lucide-react";

export default function Login() {
  const { user, loading } = useAuth();

  if (loading) return null;
  if (user) return <Navigate to="/" replace />;

  const handleLogin = () => {
    // REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
    const redirectUrl = window.location.origin + "/";
    window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 font-['Work_Sans']">
      {/* Left brand panel */}
      <div className="relative hidden lg:flex flex-col justify-between p-12 overflow-hidden">
        <div
          className="absolute inset-0 z-0"
          style={{
            backgroundImage: `url(${BRAND.bg})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
        <div className="absolute inset-0 z-0 bg-[#062B3A]/80" />
        <div className="relative z-10">
          <img src={BRAND.logo} alt="Revival Pro" className="h-24 w-auto bg-white/95 rounded-xl p-3 shadow-lg" />
        </div>
        <div className="relative z-10 space-y-8 max-w-md">
          <h1 className="text-4xl lg:text-5xl font-semibold text-white font-['Outfit'] tracking-tight leading-tight">
            Capture. Organize. Close.
          </h1>
          <p className="text-white/80 text-lg">
            The all-in-one command center for your remodeling business — from first lead to final invoice.
          </p>
          <div className="space-y-4">
            {[
              { icon: TrendingUp, text: "Track your entire estimate pipeline in dollars" },
              { icon: Users, text: "Keep every client and lead in one simple place" },
              { icon: ClipboardList, text: "Run job costing and invoicing without spreadsheets" },
            ].map((f, i) => (
              <div key={i} className="flex items-center gap-3 text-white/90">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#C9A227] text-[#061A23]">
                  <f.icon size={20} />
                </span>
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
            <h2 className="text-3xl font-semibold text-[#061A23] font-['Outfit'] tracking-tight">
              Welcome back
            </h2>
            <p className="text-[#4B6370] mt-2 mb-8">
              Sign in to manage your estimates, jobs, and invoices.
            </p>
            <Button
              data-testid="google-login-btn"
              onClick={handleLogin}
              className="w-full h-12 text-base bg-[#0A4D68] hover:bg-[#083D53] text-white gap-2"
            >
              <LogIn size={20} />
              Continue with Google
            </Button>
            <p className="text-xs text-[#4B6370] text-center mt-6">
              Secure sign-in for the owner and your team.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
