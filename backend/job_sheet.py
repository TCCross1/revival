"""Job Financial Sheet helpers. Matches the Revival Numbers workbook spirit.

PDF / Excel export is still stubbed. Client Google Drive folders are live;
saving those PDFs into the folder comes next.
"""
from __future__ import annotations

JOB_SHEET_CATEGORIES = ["Materials", "Labor", "Subcontractors", "Overhead", "Other"]

CATEGORY_ALIASES = {
    "materials": "Materials",
    "labor": "Labor",
    "add on labor": "Labor",
    "addon labor": "Labor",
    "subcontractors": "Subcontractors",
    "subs": "Subcontractors",
    "sub": "Subcontractors",
    "overhead": "Overhead",
    "other": "Other",
    "permits": "Other",
    "equipment": "Other",
    "tools": "Other",
    "rentals": "Other",
    "hauling": "Other",
    "dumping": "Other",
    "travel": "Other",
    "travel expense": "Other",
    "food": "Other",
    "auto": "Other",
    "startup": "Other",
    "add on materials": "Materials",
    "under table": "Other",
}


def normalize_sheet_category(name: str) -> str:
    raw = (name or "").strip()
    if not raw:
        return "Other"
    return CATEGORY_ALIASES.get(raw.lower(), raw if raw in JOB_SHEET_CATEGORIES else "Other")


def empty_category_budgets() -> dict:
    return {name: 0.0 for name in JOB_SHEET_CATEGORIES}


def coerce_category_budgets(raw) -> dict:
    budgets = empty_category_budgets()
    if isinstance(raw, dict):
        for key, value in raw.items():
            cat = normalize_sheet_category(str(key))
            try:
                amount = round(float(value or 0), 2)
            except (TypeError, ValueError):
                amount = 0.0
            budgets[cat] = round(budgets.get(cat, 0.0) + max(amount, 0.0), 2)
    return budgets


def money(value) -> float:
    try:
        return round(float(value or 0), 2)
    except (TypeError, ValueError):
        return 0.0


def compute_job_sheet_totals(sheet: dict, job: dict) -> dict:
    expenses = list(job.get("expenses") or [])
    by_cat = {name: {"budget": money((sheet.get("category_budgets") or {}).get(name)), "committed": 0.0, "actual": 0.0, "expenses": []} for name in JOB_SHEET_CATEGORIES}
    committed = 0.0
    actual = 0.0
    for exp in expenses:
        cat = normalize_sheet_category(exp.get("category") or "")
        amount = money(exp.get("amount"))
        kind = (exp.get("kind") or "actual").strip().lower()
        row = dict(exp)
        row["category"] = cat
        by_cat.setdefault(cat, {"budget": 0.0, "committed": 0.0, "actual": 0.0, "expenses": []})
        by_cat[cat]["expenses"].append(row)
        if kind == "committed":
            by_cat[cat]["committed"] = round(by_cat[cat]["committed"] + amount, 2)
            committed += amount
        else:
            by_cat[cat]["actual"] = round(by_cat[cat]["actual"] + amount, 2)
            actual += amount
    budget = money(sheet.get("budget") if sheet.get("budget") not in (None, "") else job.get("budget"))
    if budget <= 0:
        budget = money(job.get("budget"))
    income = money(sheet.get("income"))
    if income <= 0:
        income = budget
    actual = round(actual, 2)
    committed = round(committed, 2)
    remaining = round(budget - actual, 2)
    gross_profit = round(income - actual, 2)
    gp_pct = round((gross_profit / income) * 100, 1) if income else 0.0
    categories = []
    for name in JOB_SHEET_CATEGORIES:
        item = by_cat[name]
        categories.append({
            "name": name,
            "budget": money(item["budget"]),
            "committed": money(item["committed"]),
            "actual": money(item["actual"]),
            "difference": round(money(item["budget"]) - money(item["actual"]), 2),
            "expenses": sorted(item["expenses"], key=lambda e: e.get("date") or "", reverse=True),
        })
    return {
        "budget": budget,
        "committed": committed,
        "actual": actual,
        "remaining": remaining,
        "income": income,
        "expense": actual,
        "gross_profit": gross_profit,
        "gp_pct": gp_pct,
        "categories": categories,
    }


def export_foundation(sheet: dict, client_name: str, drive: dict | None = None) -> dict:
    """Placeholder contract for PDF / Excel export. Google Drive folders are live; file upload comes next."""
    folder = (client_name or sheet.get("client_name") or "Client").strip() or "Client"
    drive = drive or {}
    folder_id = drive.get("folder_id") or sheet.get("google_drive_folder_id") or ""
    return {
        "ready": False,
        "formats": ["pdf", "xlsx"],
        "google_drive": {
            "enabled": bool(drive.get("connected")),
            "connected": bool(drive.get("connected")),
            "upload_ready": bool(drive.get("connected") and folder_id),
            "folder_name": drive.get("folder_name") or folder,
            "folder_id": folder_id,
            "folder_url": drive.get("folder_url") or "",
            "file_id": sheet.get("google_drive_file_id") or "",
        },
        "message": "Job Sheet PDF export will be added next. Client Google Drive folders can be created today.",
    }
