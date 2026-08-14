export const STATUS_STYLES = {
  // Estimates
  Draft: "bg-slate-100 text-slate-700",
  Sent: "bg-blue-100 text-blue-700",
  "Follow-up": "bg-amber-100 text-amber-800",
  Won: "bg-emerald-100 text-emerald-700",
  Lost: "bg-red-100 text-red-700",
  // Clients
  Lead: "bg-slate-100 text-slate-700",
  Active: "bg-blue-100 text-blue-700",
  // Jobs
  Completed: "bg-emerald-100 text-emerald-700",
  "On Hold": "bg-amber-100 text-amber-800",
  // Invoices
  Partial: "bg-amber-100 text-amber-800",
  Paid: "bg-emerald-100 text-emerald-700",
  Overdue: "bg-red-100 text-red-700",
  // Contracts
  Signed: "bg-emerald-100 text-emerald-700",
};

export default function StatusBadge({ status }) {
  const cls = STATUS_STYLES[status] || "bg-slate-100 text-slate-700";
  return (
    <span
      data-testid={`status-badge-${status}`}
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}
    >
      {status}
    </span>
  );
}
