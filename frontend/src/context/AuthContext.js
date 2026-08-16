import { createContext, useContext, useState, useEffect, useCallback } from "react";
import api from "@/lib/api";

const AuthContext = createContext(null);

const DEV_BYPASS_AUTH =
  process.env.NODE_ENV === "development" &&
  String(process.env.REACT_APP_DEV_BYPASS_AUTH || "").trim() === "1";

async function loadFieldExtras() {
  try {
    return (await api.get("/field/me")).data || {};
  } catch {
    return {};
  }
}

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const checkAuth = useCallback(async () => {
    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Auth check timed out")), 8000);
    });
    try {
      const res = await Promise.race([api.get("/auth/me"), timeout]);
      const extra = await loadFieldExtras();
      setUser({ ...res.data, ...extra, role: extra.role || res.data.role });
    } catch (err) {
      if (DEV_BYPASS_AUTH) {
        try {
          const bypass = await Promise.race([api.post("/auth/dev-bypass"), timeout]);
          if (bypass.data?.session_token) {
            localStorage.setItem("session_token", bypass.data.session_token);
          }
          const extra = await loadFieldExtras();
          setUser({
            ...bypass.data,
            ...extra,
            role: extra.role || bypass.data?.role || "admin",
            dev_bypass: true,
          });
          return;
        } catch (bypassErr) {
          console.error("Dev auth bypass failed", bypassErr);
        }
      }
      console.error("Auth check failed", err);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshField = useCallback(async () => {
    try {
      const extra = (await api.get("/field/me")).data;
      setUser((prev) => (prev ? { ...prev, ...extra, role: extra.role || prev.role } : prev));
    } catch {
      /* keep existing session */
    }
  }, []);

  useEffect(() => {
    // CRITICAL: If returning from OAuth callback, skip the /me check.
    // AuthCallback will exchange the session_id and establish the session first.
    if (window.location.hash?.includes("session_id=")) {
      setLoading(false);
      return;
    }
    checkAuth();
  }, [checkAuth]);

  const logout = async () => {
    try {
      await api.post("/auth/logout");
    } catch {}
    localStorage.removeItem("session_token");
    setUser(null);
    window.location.href = "/login";
  };

  return (
    <AuthContext.Provider value={{ user, setUser, loading, logout, checkAuth, refreshField }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
