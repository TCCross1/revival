"""Job Fund Engine domain: deposits, Square Savings folder links, and audit.

Revival Pro is the source of truth for client deposits and job-level money.
Amounts are stored as USD dollars (2 decimal places) to match the rest of the
app; Square API calls convert to integer cents.
"""
from __future__ import annotations

from typing import Any

DEPOSIT_STATUSES = ("pending", "received", "failed", "refunded")
TRANSFER_DIRECTIONS = ("balance_to_folder", "folder_to_checking", "folder_to_folder")
TRANSFER_STATUSES = ("pending", "completed", "failed")
PAYMENT_METHODS = (
    "card_reader",
    "card_keyed",
    "payment_link",
    "cash",
    "check",
    "other",
)
FOLDER_LINK_STATUSES = ("unlinked", "pending_create", "linked")
DEFAULT_FOLDER_NAME_PATTERN = "{client_name} – {job_short_name}"
JOB_SHORT_NAME_MAX = 40
BANKING_UNAVAILABLE_CODE = "SQUARE_BANKING_UNAVAILABLE"
BANKING_UNAVAILABLE_MESSAGE = (
    "The card payment was recorded. Square Savings folder transfer is not available "
    "on this Square account yet. Park the net amount in Square Dashboard, or retry "
    "from this job after Banking is enabled."
)


def money(value: Any) -> float:
    try:
        return round(float(value or 0), 2)
    except (TypeError, ValueError):
        return 0.0


def dollars_to_cents(value: Any) -> int:
    return int(round(money(value) * 100))


def cents_to_dollars(value: Any) -> float:
    try:
        return round(int(value or 0) / 100.0, 2)
    except (TypeError, ValueError):
        return 0.0


def job_short_name(job: dict | None) -> str:
    name = str((job or {}).get("name") or "").strip() or "Job"
    if len(name) <= JOB_SHORT_NAME_MAX:
        return name
    return name[: JOB_SHORT_NAME_MAX - 1].rstrip() + "…"


def folder_name_from_pattern(pattern: str, job: dict | None, client: dict | None = None) -> str:
    raw = (pattern or "").strip() or DEFAULT_FOLDER_NAME_PATTERN
    job = job or {}
    client = client or {}
    client_name = (
        str(client.get("name") or "").strip()
        or str(job.get("client_name") or "").strip()
        or "Client"
    )
    filled = raw.format(
        client_name=client_name,
        job_short_name=job_short_name(job),
        job_name=str(job.get("name") or "").strip() or "Job",
        job_number=str(job.get("job_number") or "").strip() or "JOB",
    )
    return " ".join(filled.split())[:120]


def next_deposit_status(current: str, event: str) -> str:
    """Immutable-friendly status machine. Unknown events keep the current status."""
    now = (current or "pending").strip().lower()
    if now not in DEPOSIT_STATUSES:
        now = "pending"
    action = (event or "").strip().lower()
    transitions = {
        ("pending", "received"): "received",
        ("pending", "failed"): "failed",
        ("pending", "refunded"): "refunded",
        ("received", "refunded"): "refunded",
        ("received", "failed"): "received",
        ("failed", "received"): "received",
        ("failed", "failed"): "failed",
        ("refunded", "refunded"): "refunded",
    }
    return transitions.get((now, action), now)


def next_transfer_status(current: str, event: str) -> str:
    now = (current or "pending").strip().lower()
    if now not in TRANSFER_STATUSES:
        now = "pending"
    action = (event or "").strip().lower()
    transitions = {
        ("pending", "completed"): "completed",
        ("pending", "failed"): "failed",
        ("failed", "pending"): "pending",
        ("failed", "completed"): "completed",
        ("completed", "completed"): "completed",
    }
    return transitions.get((now, action), now)


def normalize_payment_method(raw: str) -> str:
    value = (raw or "").strip().lower().replace("-", "_").replace(" ", "_")
    aliases = {
        "reader": "card_reader",
        "terminal": "card_reader",
        "card": "card_reader",
        "keyed": "card_keyed",
        "link": "payment_link",
        "checkout": "payment_link",
    }
    value = aliases.get(value, value)
    return value if value in PAYMENT_METHODS else "other"


def net_from_square_payment(payment: dict | None, gross: float | None = None) -> float:
    """Net = approved amount minus Square processing fees."""
    payment = payment or {}
    amount_money = payment.get("amount_money") or {}
    approved = cents_to_dollars(amount_money.get("amount"))
    if approved <= 0 and gross is not None:
        approved = money(gross)
    fees = 0.0
    for fee in payment.get("processing_fee") or []:
        fee_money = fee.get("amount_money") or {}
        fees += cents_to_dollars(fee_money.get("amount"))
    net = round(approved - abs(fees), 2)
    return net if net > 0 else 0.0


def suggested_deposit_amount(income: float, budget: float, total_received: float) -> float:
    """Prefill Collect Deposit from the job sheet. Remaining contract balance, else 50% of income."""
    contract = money(income) if money(income) > 0 else money(budget)
    received = money(total_received)
    remaining = round(max(0.0, contract - received), 2)
    if remaining > 0:
        if received <= 0 and contract > 0:
            half = round(contract * 0.5, 2)
            return half if half > 0 else remaining
        return remaining
    return 0.0


def compute_job_funds(
    job: dict | None,
    deposits: list | None,
    transfers: list | None,
    *,
    folder_balance: float | None = None,
    income: float = 0.0,
    actual_spent: float = 0.0,
) -> dict:
    job = job or {}
    deposits = list(deposits or [])
    transfers = list(transfers or [])
    received = [d for d in deposits if (d.get("status") or "") == "received"]
    total_deposits = round(sum(money(d.get("amount")) for d in received), 2)
    total_net = round(sum(money(d.get("net_amount") if d.get("net_amount") not in (None, "") else d.get("amount")) for d in received), 2)
    parked = round(sum(
        money(t.get("amount"))
        for t in transfers
        if (t.get("direction") or "") == "balance_to_folder" and (t.get("status") or "") == "completed"
    ), 2)
    spent_from_funds = round(sum(
        money(t.get("amount"))
        for t in transfers
        if (t.get("direction") or "") == "folder_to_checking" and (t.get("status") or "") == "completed"
    ), 2)
    job_actual = money(actual_spent)
    if folder_balance is None:
        folder_balance = round(max(0.0, parked - spent_from_funds), 2)
    else:
        folder_balance = money(folder_balance)
    contract = money(income)
    if contract <= 0:
        contract = money(job.get("budget"))
    remaining_on_contract = round(max(0.0, contract - total_deposits), 2)
    remaining_available = folder_balance
    folder_id = str(job.get("square_savings_folder_id") or "").strip()
    folder_name = str(job.get("square_savings_folder_name") or "").strip()
    link_status = str(job.get("square_folder_link_status") or "").strip()
    if not link_status:
        link_status = "linked" if folder_id else ("pending_create" if folder_name else "unlinked")
    return {
        "job_id": job.get("id") or "",
        "folder_id": folder_id,
        "folder_name": folder_name,
        "folder_link_status": link_status,
        "folder_balance": folder_balance,
        "total_deposits": total_deposits,
        "total_net_deposits": total_net,
        "total_spent": round(job_actual + spent_from_funds, 2),
        "total_allocated": job_actual,
        "spent_from_funds": spent_from_funds,
        "parked": parked,
        "remaining_available": remaining_available,
        "remaining_on_contract": remaining_on_contract,
        "contract_value": contract,
        "suggested_deposit": suggested_deposit_amount(contract, money(job.get("budget")), total_deposits),
        "deposit_count": len(received),
        "pending_deposit_count": sum(1 for d in deposits if (d.get("status") or "") == "pending"),
    }


def public_deposit(doc: dict | None) -> dict:
    row = dict(doc or {})
    row.pop("_id", None)
    return {
        "id": row.get("id") or "",
        "job_id": row.get("job_id") or "",
        "client_id": row.get("client_id") or "",
        "amount": money(row.get("amount")),
        "net_amount": money(row.get("net_amount")),
        "square_payment_id": row.get("square_payment_id") or "",
        "square_checkout_id": row.get("square_checkout_id") or "",
        "payment_method": normalize_payment_method(row.get("payment_method") or ""),
        "status": row.get("status") or "pending",
        "created_at": row.get("created_at") or "",
        "received_at": row.get("received_at") or "",
        "folder_transfer_id": row.get("folder_transfer_id") or "",
        "notes": row.get("notes") or "",
        "receipt_url": row.get("receipt_url") or "",
        "receipt_drive_file_id": row.get("receipt_drive_file_id") or "",
        "park": bool(row.get("park", True)),
        "send_receipt": bool(row.get("send_receipt", False)),
        "error_message": row.get("error_message") or "",
        "checkout_url": row.get("checkout_url") or "",
    }


def public_transfer(doc: dict | None) -> dict:
    row = dict(doc or {})
    row.pop("_id", None)
    return {
        "id": row.get("id") or "",
        "job_id": row.get("job_id") or "",
        "deposit_id": row.get("deposit_id") or "",
        "direction": row.get("direction") or "",
        "amount": money(row.get("amount")),
        "from_account_id": row.get("from_account_id") or "",
        "to_account_id": row.get("to_account_id") or "",
        "square_transfer_id": row.get("square_transfer_id") or "",
        "status": row.get("status") or "pending",
        "actor_user_id": row.get("actor_user_id") or "",
        "created_at": row.get("created_at") or "",
        "completed_at": row.get("completed_at") or "",
        "notes": row.get("notes") or "",
        "error_code": row.get("error_code") or "",
        "error_message": row.get("error_message") or "",
    }


def public_audit(doc: dict | None) -> dict:
    row = dict(doc or {})
    row.pop("_id", None)
    return {
        "id": row.get("id") or "",
        "kind": row.get("kind") or "",
        "entity_id": row.get("entity_id") or "",
        "job_id": row.get("job_id") or "",
        "actor_user_id": row.get("actor_user_id") or "",
        "created_at": row.get("created_at") or "",
        "summary": row.get("summary") or "",
        "before": row.get("before") or {},
        "after": row.get("after") or {},
    }


def square_payment_status(payment: dict | None) -> str:
    status = str((payment or {}).get("status") or "").upper()
    if status in ("COMPLETED", "APPROVED"):
        return "received"
    if status in ("FAILED", "CANCELED", "CANCELLED"):
        return "failed"
    return "pending"


def checkout_is_complete(checkout: dict | None) -> bool:
    status = str((checkout or {}).get("status") or "").upper()
    return status in ("COMPLETED", "COMPLETE")


def checkout_is_failed(checkout: dict | None) -> bool:
    status = str((checkout or {}).get("status") or "").upper()
    return status in ("CANCELED", "CANCELLED", "CANCEL_REQUESTED")
