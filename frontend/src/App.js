import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import AuthCallback from "@/pages/AuthCallback";
import Login from "@/pages/Login";
import Layout from "@/components/Layout";
import Dashboard from "@/pages/Dashboard";
import Clients from "@/pages/Clients";
import ClientDetail from "@/pages/ClientDetail";
import Estimates from "@/pages/Estimates";
import Jobs from "@/pages/Jobs";
import Invoices from "@/pages/Invoices";
import Contracts from "@/pages/Contracts";
import ContractDetail from "@/pages/ContractDetail";
import Settings from "@/pages/Settings";
import PublicSign from "@/pages/PublicSign";
import ChangePassword from "@/pages/ChangePassword";
import { Toaster } from "@/components/ui/sonner";
import { BRAND } from "@/lib/format";

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0A4D68]">
      <img src={BRAND.logo} alt="Revival Pro" className="h-20 w-auto animate-pulse bg-white/95 rounded-xl p-3" />
    </div>
  );
}

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function AppRouter() {
  const location = useLocation();
  if (location.hash?.includes("session_id=")) {
    return <AuthCallback />;
  }
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/change-password" element={<ChangePassword />} />
      <Route path="/sign/:token" element={<PublicSign />} />
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/clients" element={<Clients />} />
        <Route path="/clients/:id" element={<ClientDetail />} />
        <Route path="/estimates" element={<Estimates />} />
        <Route path="/jobs" element={<Jobs />} />
        <Route path="/invoices" element={<Invoices />} />
        <Route path="/contracts" element={<Contracts />} />
        <Route path="/contracts/:id" element={<ContractDetail />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRouter />
        <Toaster position="top-right" richColors />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
