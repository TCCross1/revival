import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { BRAND } from "@/lib/format";

export default function AuthCallback() {
  const navigate = useNavigate();
  const { setUser } = useAuth();
  const hasProcessed = useRef(false);

  useEffect(() => {
    if (hasProcessed.current) return;
    hasProcessed.current = true;

    const hash = window.location.hash;
    const match = hash.match(/session_id=([^&]+)/);
    const sessionId = match ? match[1] : null;

    const run = async () => {
      if (!sessionId) {
        navigate("/login");
        return;
      }
      try {
        const res = await api.post("/auth/session", { session_id: sessionId });
        if (res.data.session_token) {
          localStorage.setItem("session_token", res.data.session_token);
        }
        setUser(res.data);
        window.history.replaceState(null, "", "/");
        navigate("/", { replace: true, state: { user: res.data } });
      } catch {
        navigate("/login");
      }
    };
    run();
  }, [navigate, setUser]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0B3A8F]">
      <div className="flex flex-col items-center gap-4">
        <img src={BRAND.logo} alt={BRAND.name} className="h-20 w-auto animate-pulse drop-shadow-[0_8px_24px_rgba(201,162,39,0.45)]" />
        <p className="text-white/80 font-['Work_Sans']">Signing you in…</p>
      </div>
    </div>
  );
}
