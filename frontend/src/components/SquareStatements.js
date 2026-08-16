import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import api, { formatApiError } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { CreditCard, ExternalLink, FileText, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const currentYear = () => new Date().getFullYear();
const currentMonth = () => new Date().getMonth() + 1;

export default function SquareStatements() {
  const [year, setYear] = useState(currentYear());
  const [month, setMonth] = useState(currentMonth());
  const [uploading, setUploading] = useState(false);
  const { data: drive } = useQuery({
    queryKey: ["google-drive-status"],
    queryFn: async () => (await api.get("/google-drive/status")).data,
  });
  const { data: statements = [], isLoading, refetch } = useQuery({
    queryKey: ["square-statements"],
    queryFn: async () => (await api.get("/financials/square-statements")).data,
    staleTime: 0,
    refetchOnMount: "always",
  });

  const remove = useMutation({
    mutationFn: async (id) => api.delete(`/financials/square-statements/${id}`),
    onSuccess: () => {
      refetch();
      toast.success("Statement removed");
    },
    onError: async (err) => toast.error(await formatApiError(err, "Could not delete the statement. Please try again.")),
  });

  const uploadFile = async (file) => {
    setUploading(true);
    try {
      const body = new FormData();
      body.append("year", String(year));
      body.append("month", String(month));
      body.append("upload", file);
      await api.post("/financials/square-statements", body);
      await refetch();
      toast.success(`Saved ${MONTHS[month - 1]} ${year} Square statement to Google Drive`);
    } catch (err) {
      toast.error(await formatApiError(err, "Could not upload the Square statement. Connect Google Drive in Company Profile if it is not connected."));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="square-statements">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        <div className="flex flex-col lg:flex-row lg:items-start gap-5">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#0A4D68]/10 text-[#0A4D68]">
            <FileText size={22} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-semibold font-['Outfit']">Square monthly statements</h2>
            <p className="text-sm text-[#4B6370] mt-1 max-w-2xl leading-relaxed">
              Upload each month’s Square statement. Revival Pro saves a copy to Google Drive under Revival Pro → Square Statements → Year → Month, using revivalhomeremodelingllc@gmail.com.
            </p>
            {!drive?.connected ? (
              <div className="mt-3 rounded-lg border border-[#C9A227]/40 bg-[#FBF6E8] px-3 py-2 text-sm">
                Connect the company Gmail in Company Profile before uploading.
              </div>
            ) : null}
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <label className="text-sm">
                <span className="block text-xs text-[#4B6370] mb-1">Month</span>
                <select className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm" value={month} onChange={(e) => setMonth(Number(e.target.value))} data-testid="square-statement-month">
                  {MONTHS.map((name, idx) => <option key={name} value={idx + 1}>{name}</option>)}
                </select>
              </label>
              <label className="text-sm">
                <span className="block text-xs text-[#4B6370] mb-1">Year</span>
                <select className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm" value={year} onChange={(e) => setYear(Number(e.target.value))} data-testid="square-statement-year">
                  {[currentYear(), currentYear() - 1, currentYear() - 2].map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </label>
              <label>
                <input
                  type="file"
                  className="hidden"
                  accept="application/pdf,image/*"
                  data-testid="square-statement-upload"
                  disabled={uploading}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) uploadFile(file);
                  }}
                />
                <span className="inline-flex">
                  <Button type="button" disabled={uploading} className="bg-[#0A4D68] hover:bg-[#083D53] gap-2 pointer-events-none">
                    <Upload size={16} /> {uploading ? "Uploading…" : "Upload statement"}
                  </Button>
                </span>
              </label>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200">
          <h3 className="font-semibold font-['Outfit']">Uploaded statements</h3>
        </div>
        {isLoading && <div className="p-5 text-[#4B6370]">Loading statements…</div>}
        {!isLoading && statements.length === 0 && (
          <div className="p-5 text-sm text-[#4B6370]" data-testid="square-statements-empty">No Square statements uploaded yet.</div>
        )}
        {statements.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[#4B6370]">
                  <th className="px-5 py-3 font-medium">Month</th>
                  <th className="px-5 py-3 font-medium">File</th>
                  <th className="px-5 py-3 font-medium">Uploaded</th>
                  <th className="px-5 py-3 font-medium text-right"> </th>
                </tr>
              </thead>
              <tbody>
                {statements.map((row) => (
                  <tr key={row.id} data-testid={`square-statement-${row.id}`} className="border-b border-slate-100 last:border-0">
                    <td className="px-5 py-3 font-medium">{MONTHS[(row.month || 1) - 1]} {row.year}</td>
                    <td className="px-5 py-3">
                      {row.web_view_link ? (
                        <a href={row.web_view_link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[#0A4D68] hover:underline">
                          <ExternalLink size={14} /> {row.filename || "Open statement"}
                        </a>
                      ) : (row.filename || "—")}
                    </td>
                    <td className="px-5 py-3 text-[#4B6370]">{fmtDate(row.uploaded_at)}</td>
                    <td className="px-5 py-3 text-right">
                      <button
                        type="button"
                        className="p-2 rounded-md hover:bg-red-50 text-red-500"
                        onClick={() => { if (window.confirm("Remove this statement from Revival Pro?")) remove.mutate(row.id); }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 sm:p-8" data-testid="square-reconciliation">
        <div className="flex flex-col sm:flex-row sm:items-start gap-5">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#C9A227]/15 text-[#C9A227]">
            <CreditCard size={22} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold font-['Outfit']">Square Reconciliation</h2>
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-[#4B6370]">Not connected</span>
            </div>
            <p className="text-[#4B6370] mt-2 max-w-2xl leading-relaxed">
              Square payout sync coming next. This section will match card payments from Square against Revival Pro invoices so you can see what’s settled, what’s missing, and what still needs to be recorded.
            </p>
            <Button type="button" disabled className="mt-5 bg-[#0A4D68]/40 text-white cursor-not-allowed">
              Connect Square (coming next)
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
