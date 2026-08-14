import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import { usd, usdCents, fmtDate } from "@/lib/format";
import StatusBadge from "@/components/StatusBadge";
import { ArrowLeft, Phone, Mail, MapPin, FileText, HardHat, Receipt, User as UserIcon } from "lucide-react";

const Stat = ({ label, value, color }) => (
  <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
    <div className="text-sm text-[#4B6370]">{label}</div>
    <div className={`text-2xl font-semibold font-['Outfit'] mt-1 ${color || "text-[#061A23]"}`}>{value}</div>
  </div>
);

export default function ClientDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["client-detail", id],
    queryFn: async () => (await api.get(`/clients/${id}/detail`)).data,
  });

  if (isLoading) return <div className="text-[#4B6370]">Loading client…</div>;
  if (isError || !data) return <div className="text-[#4B6370]">Client not found.</div>;

  const { client, estimates, jobs, invoices, summary } = data;

  return (
    <div className="space-y-6" data-testid="client-detail-page">
      <button onClick={() => navigate("/clients")} className="flex items-center gap-1.5 text-sm font-medium text-[#0A4D68] hover:underline" data-testid="back-to-clients-btn">
        <ArrowLeft size={16} /> Back to Clients
      </button>

      {/* Header card */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-[#0A4D68]/10 text-[#0A4D68] shrink-0">
              <UserIcon size={26} />
            </span>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-3xl font-semibold font-['Outfit'] tracking-tight">{client.name}</h1>
                <StatusBadge status={client.status} />
              </div>
              <div className="text-sm text-[#4B6370] mt-1">Lead source: <span className="text-[#0A4D68] font-medium">{client.source}</span></div>
              <div className="flex flex-wrap gap-4 mt-3 text-sm text-[#4B6370]">
                {client.phone && <span className="flex items-center gap-1"><Phone size={14} />{client.phone}</span>}
                {client.email && <span className="flex items-center gap-1"><Mail size={14} />{client.email}</span>}
                {client.address && <span className="flex items-center gap-1"><MapPin size={14} />{client.address}</span>}
              </div>
            </div>
          </div>
        </div>
        {client.notes && <p className="mt-4 text-sm text-[#4B6370] bg-slate-50 rounded-lg p-3">{client.notes}</p>}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Open Pipeline" value={usd(summary.open_pipeline)} color="text-[#0A4D68]" />
        <Stat label="Won Value" value={usd(summary.won_value)} color="text-emerald-600" />
        <Stat label="Collected" value={usd(summary.collected)} color="text-emerald-600" />
        <Stat label="Outstanding" value={usd(summary.outstanding)} color="text-amber-600" />
      </div>

      {/* Estimates */}
      <Section icon={FileText} title="Estimates" count={estimates.length}>
        {estimates.length === 0 ? (
          <Empty text="No estimates for this client yet." />
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[#4B6370] border-b border-slate-200">
              <th className="p-3 font-medium">Estimate #</th><th className="p-3 font-medium">Category</th>
              <th className="p-3 font-medium">Status</th><th className="p-3 font-medium text-right">Total</th>
              <th className="p-3 font-medium">Created</th>
            </tr></thead>
            <tbody>
              {estimates.map((e) => (
                <tr key={e.id} data-testid={`detail-estimate-${e.id}`} className="border-b border-slate-100">
                  <td className="p-3 font-medium text-[#0A4D68]">{e.estimate_number}</td>
                  <td className="p-3 text-[#4B6370]">{e.category}</td>
                  <td className="p-3"><StatusBadge status={e.status} /></td>
                  <td className="p-3 text-right font-semibold font-['Outfit']">{usd(e.total)}</td>
                  <td className="p-3 text-[#4B6370]">{fmtDate(e.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* Jobs */}
      <Section icon={HardHat} title="Jobs" count={jobs.length}>
        {jobs.length === 0 ? (
          <Empty text="No jobs for this client yet." />
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[#4B6370] border-b border-slate-200">
              <th className="p-3 font-medium">Job #</th><th className="p-3 font-medium">Name</th>
              <th className="p-3 font-medium">Status</th><th className="p-3 font-medium text-right">Budget</th>
            </tr></thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} data-testid={`detail-job-${j.id}`} className="border-b border-slate-100">
                  <td className="p-3 font-medium text-[#0A4D68]">{j.job_number}</td>
                  <td className="p-3">{j.name}</td>
                  <td className="p-3"><StatusBadge status={j.status} /></td>
                  <td className="p-3 text-right font-semibold font-['Outfit']">{usd(j.budget)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* Invoices */}
      <Section icon={Receipt} title="Invoices" count={invoices.length}>
        {invoices.length === 0 ? (
          <Empty text="No invoices for this client yet." />
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[#4B6370] border-b border-slate-200">
              <th className="p-3 font-medium">Invoice #</th><th className="p-3 font-medium">Status</th>
              <th className="p-3 font-medium text-right">Amount</th><th className="p-3 font-medium text-right">Paid</th>
              <th className="p-3 font-medium">Due</th>
            </tr></thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} data-testid={`detail-invoice-${inv.id}`} className="border-b border-slate-100">
                  <td className="p-3 font-medium text-[#0A4D68]">{inv.invoice_number}</td>
                  <td className="p-3"><StatusBadge status={inv.status} /></td>
                  <td className="p-3 text-right font-semibold font-['Outfit']">{usdCents(inv.amount)}</td>
                  <td className="p-3 text-right text-emerald-600">{usdCents(inv.amount_paid)}</td>
                  <td className="p-3 text-[#4B6370]">{fmtDate(inv.due_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  );
}

const Section = ({ icon: Icon, title, count, children }) => (
  <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
    <div className="flex items-center gap-2 px-6 py-4 border-b border-slate-200">
      <Icon size={18} className="text-[#0A4D68]" />
      <h2 className="text-lg font-semibold font-['Outfit']">{title}</h2>
      <span className="text-xs bg-slate-100 text-[#4B6370] rounded-full px-2 py-0.5">{count}</span>
    </div>
    <div className="overflow-x-auto">{children}</div>
  </div>
);

const Empty = ({ text }) => <div className="p-6 text-sm text-[#4B6370]">{text}</div>;
