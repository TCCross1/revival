function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function computePricing({
  materials = 0,
  labor = 0,
  subcontractors = 0,
  other = 0,
  monthlyOverhead = 0,
  daysInMonth = 30,
  estimatedDays = 0,
  profitMarginPct = 20,
  ccFeePct = 3,
  salesTaxPct = 6,
  optionalTaxPct = 5,
  applyOptionalTax = false,
} = {}) {
  const mat = money(materials);
  const lab = money(labor);
  const sub = money(subcontractors);
  const oth = money(other);
  const monthly = money(monthlyOverhead);
  const days = Number(daysInMonth) > 0 ? Number(daysInMonth) : 0;
  const jobDays = money(estimatedDays);
  const margin = Math.max(Number(profitMarginPct) || 0, 0);
  const ccPct = Math.max(Number(ccFeePct) || 0, 0);
  const salesPct = Math.max(Number(salesTaxPct) || 0, 0);
  const optPct = Math.max(Number(optionalTaxPct) || 0, 0);
  const direct = money(mat + lab + sub + oth);
  const allocated = days > 0 && jobDays > 0 && monthly > 0 ? money((jobDays / days) * monthly) : 0;
  const trueJobCost = money(direct + allocated);
  const profit = money(trueJobCost * (margin / 100));
  const basePrice = money(trueJobCost * (1 + margin / 100));
  const ccFee = money(basePrice * (ccPct / 100));
  const salesTax = money(mat * (salesPct / 100));
  const optionalTax = applyOptionalTax ? money(basePrice * (optPct / 100)) : 0;
  const finalPrice = money(basePrice + ccFee + salesTax + optionalTax);
  return {
    materials: mat,
    labor: lab,
    subcontractors: sub,
    other: oth,
    direct_costs: direct,
    monthly_overhead: monthly,
    days_in_month: days,
    daily_overhead_rate: days > 0 ? money(monthly / days) : 0,
    estimated_days: jobDays,
    allocated_overhead: allocated,
    true_job_cost: trueJobCost,
    profit_margin_pct: margin,
    profit,
    base_price: basePrice,
    cc_fee_pct: ccPct,
    cc_fee: ccFee,
    sales_tax_pct: salesPct,
    sales_tax: salesTax,
    optional_tax_pct: optPct,
    apply_optional_tax: Boolean(applyOptionalTax),
    optional_tax: optionalTax,
    fees_and_tax: money(ccFee + salesTax + optionalTax),
    final_price: finalPrice,
    smart: direct > 0 || allocated > 0,
  };
}
