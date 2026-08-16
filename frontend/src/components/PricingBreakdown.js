import { usdCents } from "@/lib/format";

const Row = ({ label, value, hint, strong, gold, testid }) => (
  <div className={`flex items-start justify-between gap-3 py-1.5 ${strong ? "border-t border-slate-200 mt-1 pt-2" : ""}`}>
    <div className="min-w-0">
      <div className={`text-sm ${strong ? "font-semibold text-[#061A23]" : "text-[#4B6370]"}`}>{label}</div>
      {hint ? <div className="text-xs text-[#8AA0AB] mt-0.5">{hint}</div> : null}
    </div>
    <div
      data-testid={testid}
      className={`text-sm tabular-nums shrink-0 ${strong ? "font-semibold font-['Outfit'] text-[#0A4D68] text-base" : gold ? "font-medium text-[#8A7018]" : "text-[#061A23]"}`}
    >
      {usdCents(value)}
    </div>
  </div>
);

export default function PricingBreakdown({ pricing, emptyHint }) {
  if (!pricing) return null;
  if (!pricing.smart) {
    return (
      <p className="text-sm text-[#4B6370]" data-testid="pricing-empty">
        {emptyHint || "Enter job costs and estimated days to see the price."}
      </p>
    );
  }
  return (
    <div className="rounded-xl border border-slate-200 bg-[#F4F7F8] p-4" data-testid="pricing-breakdown">
      <div className="text-xs font-semibold uppercase tracking-wide text-[#0A4D68] mb-2">How this price is built</div>
      <Row label="Materials + labor + subs + other" value={pricing.direct_costs} hint="What this job costs us directly" testid="price-direct" />
      <Row
        label="This job’s share of monthly overhead"
        value={pricing.allocated_overhead}
        hint={
          pricing.estimated_days > 0
            ? `${pricing.estimated_days} day${pricing.estimated_days === 1 ? "" : "s"} × ${usdCents(pricing.daily_overhead_rate)} daily rate (${usdCents(pricing.monthly_overhead)} actual ÷ ${pricing.days_in_month} days in ${pricing.month_name || "this month"})`
            : "Add estimated days to share rent, insurance, and trucks"
        }
        testid="price-overhead"
      />
      <Row label="True job cost" value={pricing.true_job_cost} hint="Direct costs + overhead share" gold testid="price-true-cost" />
      <Row
        label={`Profit (${pricing.profit_margin_pct}%)`}
        value={pricing.profit}
        hint="So the business keeps a healthy margin"
        testid="price-profit"
      />
      <Row label="Price before fees" value={pricing.base_price} testid="price-base" />
      <Row label={`Card fee (${pricing.cc_fee_pct}%)`} value={pricing.cc_fee} hint="On the priced total, so Square does not eat the profit" testid="price-cc" />
      <Row label={`Sales tax (${pricing.sales_tax_pct}% on materials)`} value={pricing.sales_tax} testid="price-sales-tax" />
      {pricing.apply_optional_tax ? (
        <Row label={`Federal + state tax (${pricing.optional_tax_pct}%)`} value={pricing.optional_tax} testid="price-optional-tax" />
      ) : null}
      <Row label="Final price" value={pricing.final_price} strong testid="price-final" />
    </div>
  );
}
