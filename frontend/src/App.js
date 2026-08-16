import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams } from "react-router-dom";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import AuthCallback from "@/pages/AuthCallback";
import Login from "@/pages/Login";
import Layout from "@/components/Layout";
import Dashboard from "@/pages/Dashboard";
import Leads from "@/pages/Leads";
import Clients from "@/pages/Clients";
import ClientDetail from "@/pages/ClientDetail";
import Estimates from "@/pages/Estimates";
import Jobs from "@/pages/Jobs";
import JobWorkspace from "@/pages/JobWorkspace";
import FloorPlans from "@/pages/FloorPlans";
import FloorPlanStudio from "@/pages/FloorPlanStudio";
import Invoices from "@/pages/Invoices";
import Financials from "@/pages/Financials";
import Contracts from "@/pages/Contracts";
import ContractDetail from "@/pages/ContractDetail";
import Settings from "@/pages/Settings";
import Profile from "@/pages/Profile";
import PublicSign from "@/pages/PublicSign";
import ChangePassword from "@/pages/ChangePassword";
import ForgotPassword from "@/pages/ForgotPassword";
import ResetPassword from "@/pages/ResetPassword";
import Team from "@/pages/Team";
import FieldHome from "@/pages/FieldHome";
import FieldReceipt from "@/pages/FieldReceipt";
import FieldTime from "@/pages/FieldTime";
import FieldMileage from "@/pages/FieldMileage";
import FieldJob from "@/pages/FieldJob";
import FieldSchedule from "@/pages/FieldSchedule";
import Permissions from "@/pages/Permissions";
import { Toaster } from "@/components/ui/sonner";
import { BRAND } from "@/lib/format";
import { can, isFieldOnly } from "@/lib/permissions";

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

function FeatureRoute({ feature, children }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (!can(user, feature)) return <Navigate to={isFieldOnly(user) ? "/field" : "/"} replace />;
  return children;
}

function JobSheetRedirect() {
  const { id } = useParams();
  return <Navigate to={`/jobs/${id}?room=money`} replace />;
}

function HomeRoute() {
  const { user } = useAuth();
  if (isFieldOnly(user) || !can(user, "dashboard")) return <Navigate to="/field" replace />;
  return <Dashboard />;
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
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/sign/:token" element={<PublicSign />} />
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<HomeRoute />} />
        <Route path="/field" element={<FeatureRoute feature="field_home"><FieldHome /></FeatureRoute>} />
        <Route path="/field/receipt" element={<FeatureRoute feature="receipts"><FieldReceipt /></FeatureRoute>} />
        <Route path="/field/time" element={<FeatureRoute feature="time_clock"><FieldTime /></FeatureRoute>} />
        <Route path="/field/mileage" element={<FeatureRoute feature="mileage"><FieldMileage /></FeatureRoute>} />
        <Route path="/field/schedule" element={<FeatureRoute feature="crew_schedule"><FieldSchedule /></FeatureRoute>} />
        <Route path="/field/jobs/:id" element={<FeatureRoute feature="jobs"><FieldJob /></FeatureRoute>} />
        <Route path="/leads" element={<Leads />} />
        <Route path="/clients" element={<Clients />} />
        <Route path="/clients/:id" element={<ClientDetail />} />
        <Route path="/estimates" element={<Estimates />} />
        <Route path="/jobs" element={<Jobs />} />
        <Route path="/jobs/:id" element={<JobWorkspace />} />
        <Route path="/jobs/:id/sheet" element={<JobSheetRedirect />} />
        <Route path="/floor-plans" element={<FloorPlans />} />
        <Route path="/floor-plans/:id" element={<FloorPlanStudio />} />
        <Route path="/invoices" element={<Invoices />} />
        <Route path="/financials" element={<Financials />} />
        <Route path="/contracts" element={<Contracts />} />
        <Route path="/contracts/:id" element={<ContractDetail />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/team" element={<Team />} />
        <Route path="/permissions" element={<FeatureRoute feature="team"><Permissions /></FeatureRoute>} />
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
