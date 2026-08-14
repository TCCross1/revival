import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { BRAND } from "@/lib/format";
import { LayoutDashboard, Users, FileText, HardHat, Receipt, LogOut } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true, testid: "nav-dashboard" },
  { to: "/clients", label: "Clients", icon: Users, testid: "nav-clients" },
  { to: "/estimates", label: "Estimates", icon: FileText, testid: "nav-estimates" },
  { to: "/jobs", label: "Jobs", icon: HardHat, testid: "nav-jobs" },
  { to: "/invoices", label: "Invoices", icon: Receipt, testid: "nav-invoices" },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen font-['Work_Sans'] text-[#061A23]">
      {/* Brightened silky background layer */}
      <div
        className="fixed inset-0 -z-10"
        style={{ backgroundImage: `url(${BRAND.bg})`, backgroundSize: "cover", backgroundPosition: "center", backgroundAttachment: "fixed" }}
      />
      <div className="fixed inset-0 -z-10 bg-[#F4F7F8]/92" />

      {/* Top navigation */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between gap-4">
            <div className="flex items-center gap-8">
              <button onClick={() => navigate("/")} className="flex items-center shrink-0" data-testid="logo-home-btn">
                <img src={BRAND.logo} alt="Revival Pro" className="h-10 w-auto" />
              </button>
              <nav className="hidden md:flex items-center gap-1">
                {NAV.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    data-testid={item.testid}
                    className={({ isActive }) =>
                      `flex items-center gap-2 px-3.5 py-2 rounded-md text-sm font-medium transition-colors ${
                        isActive
                          ? "bg-[#0A4D68] text-white"
                          : "text-[#4B6370] hover:bg-slate-100 hover:text-[#0A4D68]"
                      }`
                    }
                  >
                    <item.icon size={18} />
                    {item.label}
                  </NavLink>
                ))}
              </nav>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 rounded-full outline-none" data-testid="user-menu-btn">
                  <Avatar className="h-9 w-9 border border-slate-200">
                    <AvatarImage src={user?.picture} alt={user?.name} />
                    <AvatarFallback className="bg-[#0A4D68] text-white text-sm">
                      {user?.name?.charAt(0) || "U"}
                    </AvatarFallback>
                  </Avatar>
                  <span className="hidden sm:block text-sm font-medium max-w-[140px] truncate">{user?.name}</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 bg-white">
                <DropdownMenuLabel>
                  <div className="font-semibold">{user?.name}</div>
                  <div className="text-xs text-[#4B6370] font-normal truncate">{user?.email}</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem data-testid="logout-btn" onClick={logout} className="text-red-600 focus:text-red-600 gap-2 cursor-pointer">
                  <LogOut size={16} /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Mobile nav */}
          <nav className="md:hidden flex items-center gap-1 overflow-x-auto pb-2 -mt-1">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap ${
                    isActive ? "bg-[#0A4D68] text-white" : "text-[#4B6370] bg-slate-100"
                  }`
                }
              >
                <item.icon size={16} />
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Outlet />
      </main>
    </div>
  );
}
