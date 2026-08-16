"""Unit tests for overhead allocation and smart estimate pricing."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pricing import (
    allocated_overhead,
    compute_pricing_breakdown,
    days_in_month,
    job_sheet_direct_costs,
    uses_smart_pricing,
)


def test_february_has_28_days():
    assert days_in_month(2026, 2) == 28


def test_allocated_overhead_february_example():
    assert allocated_overhead(4000, 28, 7) == 1000.0


def test_smart_pricing_full_example():
    # $4,000 Feb overhead, 7-day job, $1,000 materials + $500 labor, 20% margin
    p = compute_pricing_breakdown(
        materials=1000,
        labor=500,
        monthly_overhead=4000,
        days_in_month_count=28,
        estimated_days=7,
        profit_margin_pct=20,
        cc_fee_pct=3,
        sales_tax_pct=6,
        optional_tax_pct=5,
        apply_optional_tax=False,
        year=2026,
        month=2,
    )
    assert p["allocated_overhead"] == 1000.0
    assert p["direct_costs"] == 1500.0
    assert p["true_job_cost"] == 2500.0
    assert p["profit"] == 500.0
    assert p["base_price"] == 3000.0
    assert p["cc_fee"] == 90.0
    assert p["sales_tax"] == 60.0  # 6% of materials only
    assert p["optional_tax"] == 0.0
    assert p["final_price"] == 3150.0
    assert p["smart"] is True
    assert p["days_in_month"] == 28
    assert p["daily_overhead_rate"] == round(4000 / 28, 2)


def test_optional_tax_adds_five_percent_of_base():
    p = compute_pricing_breakdown(
        materials=1000,
        monthly_overhead=0,
        estimated_days=0,
        profit_margin_pct=20,
        apply_optional_tax=True,
        optional_tax_pct=5,
        cc_fee_pct=3,
        sales_tax_pct=6,
    )
    assert p["true_job_cost"] == 1000.0
    assert p["base_price"] == 1200.0
    assert p["optional_tax"] == 60.0
    assert p["cc_fee"] == 36.0
    assert p["sales_tax"] == 60.0
    assert p["final_price"] == 1356.0


def test_zero_costs_are_not_smart():
    p = compute_pricing_breakdown()
    assert p["smart"] is False
    assert uses_smart_pricing(p) is False
    assert p["final_price"] == 0.0


def test_job_sheet_prefers_budgets():
    costs = job_sheet_direct_costs(
        {"category_budgets": {"Materials": 200, "Labor": 100, "Subcontractors": 50, "Other": 25, "Overhead": 999}},
        {"categories": [{"name": "Materials", "actual": 1, "committed": 1}]},
    )
    assert costs == {"materials": 200.0, "labor": 100.0, "subcontractors": 50.0, "other": 25.0}
