import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import api from "@/lib/api";
import { usd, usdCents } from "@/lib/format";
import StatusBadge from "@/components/StatusBadge";
import { DollarSign, FileText, HardHat, TrendingUp, ArrowRight, Trophy, Users } from "lucide-react";

const StatCard = ({ icon: Icon, label, value, sub, accent, testid }) => (
  <div data-testid={testid} className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
    <div className="flex items-center justify-between">
      <span className="text-sm font-medium text-[#4B6370]">{label}</span>
      <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${accent}`}>
        <Icon size={18} />
      </span>
    </div>
    <div className="mt-4 text-3xl font-semibold font-['Outfit'] tracking-tight text-[#061A23]">{value}</div>
    {sub && <div className="mt-1 text-sm text-[#4B6370]">{sub}</div>}
  </div>
);

export default function Dashboard() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => (await api.get("/dashboard")).data,
  });

  if (isLoading || !data) {
    return <div className="text-[#4B6370]">Loading dashboard…</div>;
  }

  return (
    <div className="space-y-8" data-testid="dashboard-page">
      <div>
        <h1 className="text-3xl sm:text-4xl font-semibold font-['Outfit'] tracking-tight">Dashboard</h1>
        <p className="text-[#4B6370] mt-1">Here's the health of your remodeling business at a glance.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard testid="kpi-pipeline" icon={DollarSign} label="Pipeline Value" value={usd(data.pipeline_value)} sub="Total in open estimates" accent="bg-[#0A4D68]/10 text-[#0A4D68]" />
        <StatCard testid="kpi-open-estimates" icon={FileText} label="Open Estimates" value={data.open_estimates_count} sub="Awaiting a decision" accent="bg-blue-100 text-blue-600" />
        <StatCard testid="kpi-active-jobs" icon={HardHat} label="Active Jobs" value={data.active_jobs} sub="Currently in progress" accent="bg-amber-100 text-amber-600" />
        <StatCard testid="kpi-ytd-revenue" icon={TrendingUp} label="YTD Revenue" value={usd(data.ytd_revenue)} sub="Collected this year" accent="bg-emerald-100 text-emerald-600" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Follow-up list */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between p-6 border-b border-slate-200">
            <div>
              <h2 className="text-lg font-semibold font-['Outfit']">Needs Follow-up</h2>
              <p className="text-sm text-[#4B6370]">Estimates waiting on a reply — chase the biggest first.</p>
            </div>
            <button data-testid="view-all-estimates-btn" onClick={() => navigate("/estimates")} className="text-sm font-medium text-[#0A4D68] hover:underline flex items-center gap-1">
              View all <ArrowRight size={14} />
            </button>
          </div>
          <div className="divide-y divide-slate-100">
            {data.follow_ups.length === 0 && (
              <div className="p-6 text-[#4B6370] text-sm">You're all caught up — no estimates need follow-up.</div>
            )}
            {data.follow_ups.map((e) => (
              <div key={e.id} data-testid={`followup-row-${e.id}`} className="flex items-center justify-between p-4 hover:bg-slate-50 cursor-pointer" onClick={() => navigate("/estimates")}>
                <div className="min-w-0">
                  <div className="font-medium truncate">{e.client_name || "Unnamed client"}</div>
                  <div className="text-sm text-[#4B6370]">{e.estimate_number} · {e.category}</div>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  <span className="font-semibold font-['Outfit']">{usd(e.total)}</span>
                  <StatusBadge status={e.status} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Side stats */}
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#C9A227]/15 text-[#C9A227]"><Trophy size={20} /></span>
              <div>
                <div className="text-sm text-[#4B6370]">Win Rate</div>
                <div className="text-2xl font-semibold font-['Outfit']">{data.win_rate}%</div>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#0A4D68]/10 text-[#0A4D68]"><Users size={20} /></span>
              <div>
                <div className="text-sm text-[#4B6370]">Total Clients</div>
                <div className="text-2xl font-semibold font-['Outfit']">{data.total_clients}</div>
              </div>
            </div>
          </div>
          <div className="bg-[#0A4D68] rounded-xl shadow-sm p-6 text-white">
            <div className="text-sm text-white/70">Collected YTD</div>
            <div className="text-3xl font-semibold font-['Outfit'] mt-1">{usdCents(data.ytd_revenue)}</div>
            <button onClick={() => navigate("/invoices")} className="mt-4 text-sm font-medium text-[#C9A227] hover:underline flex items-center gap-1">
              Go to invoices <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
