import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api, { formatApiError } from "@/lib/api";
import { usdCents, fmtDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { CreditCard } from "lucide-react";

export default function SquareReconciliation() {
  const qc = useQueryClient();
  const [jobId, setJobId] = useState("");
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["square-reconciliation"],
    queryFn: async () => (await api.get("/financials/square/reconciliation")).data,
  });
  const { data: jobs = [] } = useQuery({
    queryKey: ["jobs"],
    queryFn: async () => (await api.get("/jobs")).data,
  });

  const mapPayment = useMutation({
    mutationFn: async (paymentId) => (await api.post(`/financials/square/reconciliation/${paymentId}/map`, { job_id: jobId })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["square-reconciliation"] });
      toast.success("Square payment mapped to the job and recorded as a deposit.");
    },
    onError: async (err) => toast.error(await formatApiError(err, "Could not map that payment.")),
  });

  const square = data?.square || {};
  const unmapped = data?.unmapped || [];
  const mapped = data?.mapped || [];

  return (
    <div className="space-y-6" data-testid="square-reconciliation">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        <div className="flex items-start gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#0B3A8F]/10 text-[#0B3A8F]">
            <CreditCard size={22} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-semibold font-['Outfit']">Square reconciliation</h2>
            <p className="text-sm text-[#4B6370] mt-1 max-w-2xl leading-relaxed">
              Every Square payment is mapped to a job deposit, or left unmapped until you attach it. Tax AI reads job-allocated deposits from this same ledger.
            </p>
            <div className="mt-3 flex flex-wrap gap-3 text-sm">
              <span className={`px-2.5 py-1 rounded-full ${square.connected ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-[#4B6370]"}`}>
                {square.connected ? "Square connected" : "Square not connected"}
              </span>
              <span className="px-2.5 py-1 rounded-full bg-[#FBF6E8] text-[#061A23]">{data?.unmapped_count || 0} unmapped</span>
              <span className="px-2.5 py-1 rounded-full bg-slate-100">{data?.mapped_count || 0} mapped</span>
            </div>
          </div>
        </div>
      </div>

      {isLoading ? <div className="text-[#4B6370]">Loading Square payments…</div> : null}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        <h3 className="font-['Outfit'] font-semibold text-[#0B3A8F]">Unmapped Square payments</h3>
        <p className="text-sm text-[#4B6370] mt-1">Attach a payment to a job. Revival Pro creates the deposit and parks net funds when Banking is available.</p>
        <div className="mt-3 flex flex-wrap gap-2 items-end">
          <label className="text-sm">
            <span className="block text-xs text-[#4B6370] mb-1">Job</span>
            <select className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm min-w-[220px]" value={jobId} onChange={(e) => setJobId(e.target.value)} data-testid="recon-job-select">
              <option value="">Select a job…</option>
              {jobs.map((job) => (
                <option key={job.id} value={job.id}>{job.job_number} · {job.name}</option>
              ))}
            </select>
          </label>
          <Button type="button" variant="outline" onClick={() => refetch()}>Refresh from Square</Button>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[#4B6370]">
                <th className="py-2 font-medium">Date</th>
                <th className="py-2 font-medium">Amount</th>
                <th className="py-2 font-medium">Status</th>
                <th className="py-2 font-medium">Payment</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {unmapped.length === 0 ? (
                <tr><td className="py-4 text-[#4B6370]" colSpan={5}>No unmapped Square payments.</td></tr>
              ) : unmapped.map((row) => (
                <tr key={row.square_payment_id} className="border-t border-slate-100">
                  <td className="py-2">{fmtDate(row.created_at)}</td>
                  <td>{usdCents(row.amount)}</td>
                  <td>{row.status || "—"}</td>
                  <td className="font-mono text-xs">{row.square_payment_id}</td>
                  <td className="text-right">
                    <Button
                      type="button"
                      size="sm"
                      className="bg-[#0B3A8F] hover:bg-[#082C73]"
                      disabled={!jobId || mapPayment.isPending}
                      onClick={() => {
                        if (!window.confirm("Record this Square payment as a deposit on the selected job?")) return;
                        mapPayment.mutate(row.square_payment_id);
                      }}
                    >
                      Map to job
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        <h3 className="font-['Outfit'] font-semibold text-[#0B3A8F]">Mapped to jobs</h3>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[#4B6370]">
                <th className="py-2 font-medium">Date</th>
                <th className="py-2 font-medium">Job</th>
                <th className="py-2 font-medium">Client</th>
                <th className="py-2 font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {mapped.length === 0 ? (
                <tr><td className="py-4 text-[#4B6370]" colSpan={4}>No mapped payments yet.</td></tr>
              ) : mapped.slice(0, 40).map((row) => (
                <tr key={row.square_payment_id} className="border-t border-slate-100">
                  <td className="py-2">{fmtDate(row.created_at)}</td>
                  <td>{row.job_number} · {row.job_name}</td>
                  <td>{row.client_name || "—"}</td>
                  <td>{usdCents(row.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
