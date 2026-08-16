import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api, { formatApiError } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Plus, PenTool, Trash2 } from "lucide-react";
import { toast } from "sonner";

export default function FloorPlans() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: plans = [], isLoading } = useQuery({
    queryKey: ["floor-plans"],
    queryFn: async () => (await api.get("/floor-plans")).data,
    staleTime: 0,
    refetchOnMount: "always",
  });
  const remove = useMutation({
    mutationFn: async (id) => api.delete(`/floor-plans/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["floor-plans"] });
      toast.success("Floor plan deleted");
    },
    onError: async (err) => toast.error(await formatApiError(err, "Could not delete that floor plan. Please try again.")),
  });

  return (
    <div className="space-y-6" data-testid="floor-plans-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl sm:text-4xl font-semibold font-['Outfit'] tracking-tight">Floor Plan Studio</h1>
          <p className="text-[#4B6370] mt-1">Draft, scan, and take off every remodel — linked to the job and saved to the client’s Drive folder.</p>
        </div>
        <Button className="bg-[#0A4D68] hover:bg-[#083D53] gap-2" onClick={() => navigate("/floor-plans/new")} data-testid="new-floorplan-btn">
          <Plus size={18} /> New floor plan
        </Button>
      </div>

      {isLoading && <div className="text-[#4B6370]">Loading floor plans…</div>}
      {!isLoading && plans.length === 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-10 text-center">
          <PenTool className="mx-auto text-[#C9A227] mb-3" size={36} />
          <p className="text-[#4B6370]">No floor plans yet. Start from a job, drop room blocks, or import an iPhone LiDAR scan.</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {plans.map((plan) => (
          <div key={plan.id} className={`bg-white rounded-xl border shadow-sm p-5 ${plan.showcase ? "border-[#C9A227] ring-1 ring-[#C9A227]/30" : "border-slate-200"}`} data-testid={`floorplan-card-${plan.id}`}>
            <div className="flex items-start justify-between gap-3">
              <button type="button" className="text-left min-w-0" onClick={() => navigate(`/floor-plans/${plan.id}`)}>
                {plan.showcase ? (
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#C9A227] mb-1">Studio example</div>
                ) : null}
                <div className="font-['Outfit'] font-semibold text-lg text-[#061A23] truncate">{plan.name}</div>
                <div className="text-sm text-[#4B6370] truncate">{plan.client_name || "No client"} · {plan.address || "No address"}</div>
                <div className="mt-1 text-xs text-[#8AA0AB]">
                  {plan.project_type} · {plan.version_kind === "proposed" ? "Proposed" : "Existing"} · {plan.level_count || 1} level{(plan.level_count || 1) === 1 ? "" : "s"} · {Number(plan.floor_sf || 0).toFixed(0)} SF
                </div>
              </button>
              <button type="button" className="p-2 text-red-500 hover:bg-red-50 rounded-md" onClick={() => { if (window.confirm("Delete this floor plan?")) remove.mutate(plan.id); }}>
                <Trash2 size={16} />
              </button>
            </div>
            <div className="mt-3 text-xs text-[#8AA0AB]">Updated {fmtDate(plan.updated_at || plan.created_at)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
