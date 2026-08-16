"""Monthly overhead allocation and smart estimate pricing.

True Job Cost = Materials + Labor + Subcontractors + Other + allocated overhead
Allocated overhead = (estimated days / days in month) × monthly overhead
Base Price = True Job Cost × (1 + profit margin)
Final Price = Base Price + 3% card fee (on base) + 6% sales tax (materials only) + optional 5% tax
"""
from __future__ import annotations

import calendar
from datetime import datetime, timezone

DEFAULT_PROFIT_MARGIN_PCT = 20.0
DEFAULT_CC_FEE_PCT = 3.0
DEFAULT_SALES_TAX_PCT = 6.0
DEFAULT_OPTIONAL_TAX_PCT = 5.0
DIRECT_COST_CATEGORIES = ("Materials", "Labor", "Subcontractors", "Other")


def money(value) -> float:
    try:
        return round(float(value or 0), 2)
    except (TypeError, ValueError):
        return 0.0


def pct(value, fallback=0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = fallback
    if number < 0:
        return 0.0
    return number


def parse_year_month(year=None, month=None) -> tuple[int, int]:
    now = datetime.now(timezone.utc)
    try:
        y = int(year) if year not in (None, "") else now.year
    except (TypeError, ValueError):
        y = now.year
    try:
        m = int(month) if month not in (None, "") else now.month
    except (TypeError, ValueError):
        m = now.month
    if y < 2000 or y > 2100:
        y = now.year
    if m < 1 or m > 12:
        m = now.month
    return y, m


def days_in_month(year: int, month: int) -> int:
    y, m = parse_year_month(year, month)
    return calendar.monthrange(y, m)[1]


def month_label(year: int, month: int) -> str:
    y, m = parse_year_month(year, month)
    return f"{calendar.month_name[m]} {y}"


def year_month_of(value) -> tuple[int | None, int | None]:
    if not value:
        return None, None
    text = str(value).strip()
    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.year, dt.month
    except Exception:
        try:
            parts = text[:10].split("-")
            return int(parts[0]), int(parts[1])
        except Exception:
            return None, None


def allocated_overhead(monthly_overhead, month_days, estimated_days) -> float:
    """(job days / days in month) × monthly overhead. February example: (7/28)×4000 = 1000."""
    monthly = money(monthly_overhead)
    try:
        days = int(month_days or 0)
    except (TypeError, ValueError):
        days = 0
    job_days = money(estimated_days)
    if days <= 0 or job_days <= 0 or monthly <= 0:
        return 0.0
    return round((job_days / days) * monthly, 2)


def daily_overhead_rate(monthly_overhead, month_days) -> float:
    monthly = money(monthly_overhead)
    try:
        days = int(month_days or 0)
    except (TypeError, ValueError):
        days = 0
    if days <= 0 or monthly <= 0:
        return 0.0
    return round(monthly / days, 2)


def uses_smart_pricing(breakdown: dict | None) -> bool:
    if not breakdown:
        return False
    return money(breakdown.get("direct_costs")) > 0 or money(breakdown.get("allocated_overhead")) > 0


def job_sheet_direct_costs(sheet: dict | None, totals: dict | None = None) -> dict:
    """Materials + Labor + Subs + Other. Prefer category budgets; otherwise actual + committed."""
    sheet = sheet or {}
    budgets = sheet.get("category_budgets") or {}
    planned = {key: money(budgets.get(name)) for key, name in (
        ("materials", "Materials"),
        ("labor", "Labor"),
        ("subcontractors", "Subcontractors"),
        ("other", "Other"),
    )}
    if sum(planned.values()) > 0:
        return planned
    by_name = {row.get("name"): row for row in (totals or {}).get("categories") or []}

    def spent(name: str) -> float:
        row = by_name.get(name) or {}
        return round(money(row.get("actual")) + money(row.get("committed")), 2)

    return {
        "materials": spent("Materials"),
        "labor": spent("Labor"),
        "subcontractors": spent("Subcontractors"),
        "other": spent("Other"),
    }


def compute_pricing_breakdown(
    *,
    materials=0,
    labor=0,
    subcontractors=0,
    other=0,
    monthly_overhead=0,
    days_in_month_count=None,
    estimated_days=0,
    profit_margin_pct=DEFAULT_PROFIT_MARGIN_PCT,
    cc_fee_pct=DEFAULT_CC_FEE_PCT,
    sales_tax_pct=DEFAULT_SALES_TAX_PCT,
    optional_tax_pct=DEFAULT_OPTIONAL_TAX_PCT,
    apply_optional_tax=False,
    year=None,
    month=None,
) -> dict:
    y, m = parse_year_month(year, month)
    month_days = int(days_in_month_count) if days_in_month_count not in (None, "") else days_in_month(y, m)
    if month_days <= 0:
        month_days = days_in_month(y, m)

    materials = money(materials)
    labor = money(labor)
    subcontractors = money(subcontractors)
    other = money(other)
    monthly = money(monthly_overhead)
    job_days = money(estimated_days)
    margin = pct(profit_margin_pct, DEFAULT_PROFIT_MARGIN_PCT)
    cc_pct = pct(cc_fee_pct, DEFAULT_CC_FEE_PCT)
    sales_pct = pct(sales_tax_pct, DEFAULT_SALES_TAX_PCT)
    optional_pct = pct(optional_tax_pct, DEFAULT_OPTIONAL_TAX_PCT)
    optional_on = bool(apply_optional_tax)

    direct = round(materials + labor + subcontractors + other, 2)
    allocated = allocated_overhead(monthly, month_days, job_days)
    true_job_cost = round(direct + allocated, 2)
    profit = round(true_job_cost * (margin / 100.0), 2)
    base_price = round(true_job_cost * (1 + margin / 100.0), 2)
    cc_fee = round(base_price * (cc_pct / 100.0), 2)
    sales_tax = round(materials * (sales_pct / 100.0), 2)
    optional_tax = round(base_price * (optional_pct / 100.0), 2) if optional_on else 0.0
    final_price = round(base_price + cc_fee + sales_tax + optional_tax, 2)

    return {
        "year": y,
        "month": m,
        "month_name": calendar.month_name[m],
        "month_label": month_label(y, m),
        "materials": materials,
        "labor": labor,
        "subcontractors": subcontractors,
        "other": other,
        "direct_costs": direct,
        "monthly_overhead": monthly,
        "days_in_month": month_days,
        "daily_overhead_rate": daily_overhead_rate(monthly, month_days),
        "estimated_days": job_days,
        "allocated_overhead": allocated,
        "true_job_cost": true_job_cost,
        "profit_margin_pct": margin,
        "profit": profit,
        "base_price": base_price,
        "cc_fee_pct": cc_pct,
        "cc_fee": cc_fee,
        "sales_tax_pct": sales_pct,
        "sales_tax": sales_tax,
        "optional_tax_pct": optional_pct,
        "apply_optional_tax": optional_on,
        "optional_tax": optional_tax,
        "fees_and_tax": round(cc_fee + sales_tax + optional_tax, 2),
        "final_price": final_price,
        "smart": uses_smart_pricing({
            "direct_costs": direct,
            "allocated_overhead": allocated,
        }),
    }
