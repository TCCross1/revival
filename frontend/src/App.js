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
import PublicBid from "@/pages/PublicBid";
import SubcontractorDirectory from "@/pages/SubcontractorDirectory";
import BidPackageDetail from "@/pages/BidPackageDetail";
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
import OfficeCalendar from "@/pages/OfficeCalendar";
import { Toaster } from "@/components/ui/sonner";
import DollyAssistant from "@/components/DollyAssistant";
import { BRAND } from "@/lib/format";
import { can, isFieldOnly } from "@/lib/permissions";

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0B3A8F]">
      <img src={BRAND.logo} alt={BRAND.name} className="h-24 w-auto animate-pulse drop-shadow-[0_8px_24px_rgba(201,162,39,0.45)]" />
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
      <Route path="/sub/:token" element={<PublicBid />} />
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
        <Route path="/leads" element={<FeatureRoute feature="leads"><Leads /></FeatureRoute>} />
        <Route path="/clients" element={<FeatureRoute feature="clients"><Clients /></FeatureRoute>} />
        <Route path="/clients/:id" element={<FeatureRoute feature="clients"><ClientDetail /></FeatureRoute>} />
        <Route path="/estimates" element={<FeatureRoute feature="estimates"><Estimates /></FeatureRoute>} />
        <Route path="/jobs" element={<FeatureRoute feature="jobs"><Jobs /></FeatureRoute>} />
        <Route path="/jobs/:id" element={<FeatureRoute feature="jobs"><JobWorkspace /></FeatureRoute>} />
        <Route path="/jobs/:id/sheet" element={<FeatureRoute feature="jobs"><JobSheetRedirect /></FeatureRoute>} />
        <Route path="/subcontractors" element={<FeatureRoute feature="subcontractors"><SubcontractorDirectory /></FeatureRoute>} />
        <Route path="/bid-packages/:id" element={<FeatureRoute feature="jobs"><BidPackageDetail /></FeatureRoute>} />
        <Route path="/floor-plans" element={<FeatureRoute feature="floor_plans"><FloorPlans /></FeatureRoute>} />
        <Route path="/floor-plans/:id" element={<FeatureRoute feature="floor_plans"><FloorPlanStudio /></FeatureRoute>} />
        <Route path="/invoices" element={<FeatureRoute feature="invoices"><Invoices /></FeatureRoute>} />
        <Route path="/financials" element={<FeatureRoute feature="financials"><Financials /></FeatureRoute>} />
        <Route path="/contracts" element={<FeatureRoute feature="contracts"><Contracts /></FeatureRoute>} />
        <Route path="/contracts/:id" element={<FeatureRoute feature="contracts"><ContractDetail /></FeatureRoute>} />
        <Route path="/calendar" element={<FeatureRoute feature="calendar"><OfficeCalendar /></FeatureRoute>} />
        <Route path="/settings" element={<FeatureRoute feature="settings"><Settings /></FeatureRoute>} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/team" element={<FeatureRoute feature="team"><Team /></FeatureRoute>} />
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
        <DollyAssistant />
        <Toaster position="top-right" richColors />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
