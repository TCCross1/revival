import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import { usd, fmtDate } from "@/lib/format";
import StatusBadge from "@/components/StatusBadge";
import { FileSignature, Trash2, Eye } from "lucide-react";
import { toast } from "sonner";

export default function Contracts() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: contracts = [], isLoading } = useQuery({
    queryKey: ["contracts"],
    queryFn: async () => (await api.get("/contracts")).data,
  });

  const remove = useMutation({
    mutationFn: async (id) => api.delete(`/contracts/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["contracts"] }); toast.success("Contract deleted"); },
  });

  return (
    <div className="space-y-6" data-testid="contracts-page">
      <div>
        <h1 className="text-3xl sm:text-4xl font-semibold font-['Outfit'] tracking-tight">Contracts</h1>
        <p className="text-[#4B6370] mt-1">Construction contracts generated from your won estimates.</p>
      </div>

      {!isLoading && contracts.length === 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-10 text-center text-[#4B6370]">
          <FileSignature className="mx-auto mb-3 text-slate-300" size={40} />
          No contracts yet. Mark an estimate as <strong>Won</strong>, then click “Generate Contract &amp; Invoice”.
        </div>
      )}

      {contracts.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[#4B6370]">
                  <th className="p-4 font-medium">Contract #</th>
                  <th className="p-4 font-medium">Client</th>
                  <th className="p-4 font-medium">Project</th>
                  <th className="p-4 font-medium">Status</th>
                  <th className="p-4 font-medium text-right">Amount</th>
                  <th className="p-4 font-medium">Created</th>
                  <th className="p-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {contracts.map((c) => (
                  <tr key={c.id} data-testid={`contract-row-${c.id}`} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="p-4">
                      <button onClick={() => navigate(`/contracts/${c.id}`)} data-testid={`open-contract-${c.id}`} className="font-medium text-[#0A4D68] hover:underline flex items-center gap-2">
                        <FileSignature size={15} />{c.contract_number}
                      </button>
                    </td>
                    <td className="p-4">{c.client_name}</td>
                    <td className="p-4 text-[#4B6370] max-w-[240px] truncate">{c.project_description}</td>
                    <td className="p-4"><StatusBadge status={c.status} /></td>
                    <td className="p-4 text-right font-semibold font-['Outfit']">{usd(c.total)}</td>
                    <td className="p-4 text-[#4B6370]">{fmtDate(c.created_at)}</td>
                    <td className="p-4">
                      <div className="flex items-center justify-end gap-1">
                        <button data-testid={`view-contract-${c.id}`} onClick={() => navigate(`/contracts/${c.id}`)} title="Open" className="p-2 rounded-md hover:bg-slate-100 text-[#0A4D68]"><Eye size={16} /></button>
                        <button data-testid={`delete-contract-${c.id}`} onClick={() => { if (window.confirm(`Delete ${c.contract_number}?`)) remove.mutate(c.id); }} className="p-2 rounded-md hover:bg-red-50 text-red-500"><Trash2 size={16} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
