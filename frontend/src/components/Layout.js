import { useEffect } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { BRAND } from "@/lib/format";
import { can, isFieldOnly } from "@/lib/permissions";
import NotificationBell from "@/components/NotificationBell";
import {
  IconDashboard,
  IconLeads,
  IconClients,
  IconJobs,
  IconPlans,
  IconEstimates,
  IconInvoices,
  IconFinancials,
  IconContracts,
  IconTeam,
  IconField,
  IconClock,
  IconCamera,
  IconSchedule,
} from "@/components/nav/NavIcons";
import { LogOut, Building2, KeyRound, UserCog } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

const MAIN_NAV = [
  { to: "/", label: "Dashboard", icon: IconDashboard, end: true, testid: "nav-dashboard", feature: "dashboard" },
  { to: "/leads", label: "Leads", icon: IconLeads, testid: "nav-leads", feature: "leads" },
  { to: "/clients", label: "Clients", icon: IconClients, testid: "nav-clients", feature: "clients" },
  { to: "/jobs", label: "Jobs", icon: IconJobs, testid: "nav-jobs", feature: "jobs" },
  { to: "/floor-plans", label: "Plans", icon: IconPlans, testid: "nav-floor-plans", feature: "floor_plans" },
  { to: "/estimates", label: "Estimates", icon: IconEstimates, testid: "nav-estimates", feature: "estimates" },
  { to: "/invoices", label: "Invoices", icon: IconInvoices, testid: "nav-invoices", feature: "invoices" },
  { to: "/financials", label: "Financials", icon: IconFinancials, testid: "nav-financials", feature: "financials" },
  { to: "/contracts", label: "Contracts", icon: IconContracts, testid: "nav-contracts", feature: "contracts" },
  { to: "/team", label: "Team", icon: IconTeam, testid: "nav-team", feature: "team" },
  { to: "/field", label: "Field", icon: IconField, testid: "nav-field", feature: "field_home" },
];

const FIELD_NAV = [
  { to: "/field", label: "Today", icon: IconField, testid: "nav-field", feature: "field_home", end: true },
  { to: "/field/time", label: "Clock", icon: IconClock, testid: "nav-field-time", feature: "time_clock" },
  { to: "/field/receipt", label: "Camera", icon: IconCamera, testid: "nav-field-receipt", feature: "receipts" },
  { to: "/field/schedule", label: "Schedule", icon: IconSchedule, testid: "nav-field-schedule", feature: "crew_schedule" },
];

function navItemClass(active) {
  return [
    "rp-nav-item group flex flex-col items-center justify-center gap-0.5",
    "text-[10px] font-semibold tracking-[0.06em] uppercase font-['Outfit'] whitespace-nowrap transition-all duration-200",
    active ? "is-active text-white" : "text-white/80 hover:text-white",
  ].join(" ");
}

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const studio = /^\/floor-plans\/[^/]+/.test(location.pathname);
  const presenting = studio && new URLSearchParams(location.search).get("present") === "1";
  const fieldOnly = isFieldOnly(user);
  const fieldShell = fieldOnly || location.pathname.startsWith("/field");
  const items = (fieldOnly ? FIELD_NAV : MAIN_NAV).filter((it) => can(user, it.feature));
  const homeTo = fieldOnly ? "/field" : can(user, "dashboard") ? "/" : "/jobs";

  useEffect(() => {
    const el = document.querySelector(".rp-nav-scroll [aria-current='page']");
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
    }
  }, [location.pathname]);

  if (presenting) {
    return (
      <div className="min-h-screen font-['Work_Sans'] text-[#061A23] bg-[#F4F7F8]">
        <Outlet />
      </div>
    );
  }

  return (
    <div className={`${studio ? "h-dvh overflow-hidden" : "min-h-dvh"} flex flex-col font-['Work_Sans'] ${fieldShell ? "text-white" : "text-[#061A23]"}`}>
      {!fieldShell ? (
        <>
          <div
            className="fixed inset-0 -z-10"
            style={{ backgroundImage: `url(${BRAND.bg})`, backgroundSize: "cover", backgroundPosition: "center", backgroundAttachment: "fixed" }}
          />
          <div className="fixed inset-0 -z-10 bg-[#F4F7F8]/95" />
        </>
      ) : (
        <div className="fixed inset-0 -z-10 bg-[#061A23]" />
      )}

      <header className="rp-topbar shrink-0 sticky top-0 z-30" data-testid="app-topbar">
        <div className="rp-banner-hero">
          <div
            className="rp-banner-art"
            aria-hidden="true"
            style={{ backgroundImage: "url(/brand/revival-header-banner.png)" }}
          />
          <button
            type="button"
            onClick={() => navigate(homeTo)}
            className="rp-banner-home"
            data-testid="logo-home-btn"
            aria-label="Revival Home Remodeling home"
          />
          <div className="rp-banner-frame">
            <div className="rp-topbar-tools flex items-center justify-end gap-1.5 px-4 sm:px-6 lg:px-8 pt-3">
              {can(user, "notifications") ? (
                <NotificationBell className="text-white hover:bg-white/12 hover:text-[#C9A227]" />
              ) : null}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center gap-2.5 rounded-full outline-none pl-1" data-testid="user-menu-btn">
                    <Avatar className="h-10 w-10 ring-2 ring-[#C9A227]/70 shadow-[0_0_0_3px_rgba(10,77,104,0.35)]">
                      <AvatarImage src={user?.picture} alt={user?.name} />
                      <AvatarFallback className="bg-[#0A4D68] text-white text-sm">
                        {user?.name?.charAt(0) || "U"}
                      </AvatarFallback>
                    </Avatar>
                    <span className="hidden sm:block text-sm font-medium text-white/92 max-w-[140px] truncate">{user?.name}</span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 bg-white">
                  <DropdownMenuLabel>
                    <div className="font-semibold">{user?.name}</div>
                    <div className="text-xs text-[#4B6370] font-normal truncate">{user?.email}</div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem data-testid="my-profile-btn" onClick={() => navigate("/profile")} className="gap-2 cursor-pointer">
                    <UserCog size={16} /> My Profile
                  </DropdownMenuItem>
                  {can(user, "settings") ? (
                    <DropdownMenuItem data-testid="company-profile-btn" onClick={() => navigate("/settings")} className="gap-2 cursor-pointer">
                      <Building2 size={16} /> Company Profile
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem data-testid="change-password-menu-btn" onClick={() => navigate("/change-password")} className="gap-2 cursor-pointer">
                    <KeyRound size={16} /> Change Password
                  </DropdownMenuItem>
                  <DropdownMenuItem data-testid="logout-btn" onClick={logout} className="text-red-600 focus:text-red-600 gap-2 cursor-pointer">
                    <LogOut size={16} /> Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>

        <div className="rp-nav-fade">
          <nav className="rp-nav-scroll" data-testid="app-main-nav" aria-label="Main">
            {items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                data-testid={item.testid}
                className={({ isActive }) => navItemClass(isActive)}
              >
                {({ isActive }) => (
                  <>
                    <span className={`rp-nav-glyph ${isActive ? "is-active" : ""}`}>
                        <item.icon active={isActive} size={22} />
                    </span>
                    <span className={isActive ? "text-[#F0D078]" : "text-white/86"}>{item.label}</span>
                  </>
                )}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      {user?.dev_bypass ? (
        <div
          className="shrink-0 px-4 py-1.5 text-center text-[11px] font-semibold tracking-[0.12em] uppercase font-['Outfit'] bg-[#C9A227] text-[#061A23]"
          data-testid="dev-bypass-banner"
        >
          Design mode — login skipped on this Mac only
        </div>
      ) : null}

      <main className={studio ? "rp-studio-main flex-1 min-h-0 overflow-hidden w-full px-0 pb-0" : fieldShell ? "flex-1 max-w-lg mx-auto w-full px-4 py-6" : "flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8"}>
        <Outlet />
      </main>
    </div>
  );
}
