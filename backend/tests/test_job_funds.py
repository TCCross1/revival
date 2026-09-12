"""Job Fund Engine domain tests — money math, naming, status machines, summaries."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from job_funds import (
    BANKING_UNAVAILABLE_CODE,
    DEFAULT_FOLDER_NAME_PATTERN,
    cents_to_dollars,
    compute_job_funds,
    dollars_to_cents,
    folder_name_from_pattern,
    money,
    net_from_square_payment,
    next_deposit_status,
    next_transfer_status,
    normalize_payment_method,
    suggested_deposit_amount,
)
from square_webhook import verify_signature, event_type, object_payload


def test_money_and_cents():
    assert money("12.345") == 12.35
    assert money(None) == 0.0
    assert dollars_to_cents(10.5) == 1050
    assert cents_to_dollars(1050) == 10.5


def test_folder_name_pattern():
    job = {"name": "Kitchen remodel at 123 Oak", "job_number": "JOB-2026-0001", "client_name": "Linda Garcia"}
    assert folder_name_from_pattern(DEFAULT_FOLDER_NAME_PATTERN, job) == "Linda Garcia – Kitchen remodel at 123 Oak"
    custom = folder_name_from_pattern("{job_number} / {client_name}", job)
    assert custom == "JOB-2026-0001 / Linda Garcia"


def test_suggested_deposit_prefers_remaining_then_half():
    assert suggested_deposit_amount(20000, 0, 0) == 10000.0
    assert suggested_deposit_amount(20000, 0, 10000) == 10000.0
    assert suggested_deposit_amount(20000, 0, 20000) == 0.0
    assert suggested_deposit_amount(0, 8000, 0) == 4000.0


def test_deposit_status_machine():
    assert next_deposit_status("pending", "received") == "received"
    assert next_deposit_status("pending", "failed") == "failed"
    assert next_deposit_status("received", "refunded") == "refunded"
    assert next_deposit_status("received", "failed") == "received"
    assert next_deposit_status("refunded", "received") == "refunded"


def test_transfer_status_machine():
    assert next_transfer_status("pending", "completed") == "completed"
    assert next_transfer_status("pending", "failed") == "failed"
    assert next_transfer_status("failed", "pending") == "pending"


def test_net_from_square_payment_subtracts_fees():
    payment = {
        "amount_money": {"amount": 10000, "currency": "USD"},
        "processing_fee": [{"amount_money": {"amount": 290}}],
    }
    assert net_from_square_payment(payment) == 97.10


def test_compute_job_funds_summary():
    job = {"id": "j1", "budget": 20000, "square_savings_folder_id": "fold_1", "square_savings_folder_name": "Linda – Kitchen"}
    deposits = [
        {"status": "received", "amount": 5000, "net_amount": 4850},
        {"status": "pending", "amount": 1000, "net_amount": 0},
        {"status": "failed", "amount": 50, "net_amount": 0},
    ]
    transfers = [
        {"direction": "balance_to_folder", "status": "completed", "amount": 4850},
        {"direction": "folder_to_checking", "status": "completed", "amount": 400},
    ]
    summary = compute_job_funds(job, deposits, transfers, income=20000, actual_spent=1200)
    assert summary["total_deposits"] == 5000
    assert summary["total_net_deposits"] == 4850
    assert summary["folder_balance"] == 4450
    assert summary["remaining_on_contract"] == 15000
    assert summary["remaining_available"] == 4450
    assert summary["spent_from_funds"] == 400
    assert summary["suggested_deposit"] == 15000
    assert summary["folder_link_status"] == "linked"


def test_payment_method_aliases():
    assert normalize_payment_method("terminal") == "card_reader"
    assert normalize_payment_method("payment_link") == "payment_link"
    assert normalize_payment_method("weird") == "other"


def test_square_webhook_signature():
    key = "test-signature-key"
    url = "https://example.com/api/webhooks/square"
    body = b'{"type":"payment.updated"}'
    import base64
    import hashlib
    import hmac
    digest = hmac.new(key.encode(), url.encode() + body, hashlib.sha256).digest()
    sig = base64.b64encode(digest).decode()
    assert verify_signature(body=body, signature=sig, notification_url=url, signature_key=key) is True
    assert verify_signature(body=body, signature="nope", notification_url=url, signature_key=key) is False


def test_webhook_event_payload():
    payload = {"type": "terminal.checkout.updated", "data": {"object": {"checkout": {"id": "c1"}}}}
    assert event_type(payload) == "terminal.checkout.updated"
    assert object_payload(payload)["checkout"]["id"] == "c1"


def test_banking_unavailable_code():
    assert BANKING_UNAVAILABLE_CODE == "SQUARE_BANKING_UNAVAILABLE"
