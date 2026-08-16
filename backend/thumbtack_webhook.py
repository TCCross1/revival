"""Parse and authenticate Thumbtack lead webhooks. Never logs secrets.

Public URL format for ngrok (paste this into Thumbtack, swapping in your tunnel host):
    https://YOUR-NGROK-URL.ngrok-free.app/api/webhooks/thumbtack

Optional shared secret: THUMBTACK_WEBHOOK_SECRET in backend/.env
"""
from __future__ import annotations

import base64
import logging
import os
import secrets
from typing import Any, Optional

NGROK_WEBHOOK_URL_FORMAT = "https://YOUR-NGROK-URL.ngrok-free.app/api/webhooks/thumbtack"

logger = logging.getLogger(__name__)

MESSAGE_EVENT_MARKERS = ("messagecreated", "message_created", "message.created")


def configured_webhook_secret() -> str:
    return (os.environ.get("THUMBTACK_WEBHOOK_SECRET") or "").strip()


def _safe_compare(candidate: str, expected: str) -> bool:
    if not candidate or not expected:
        return False
    try:
        return secrets.compare_digest(candidate, expected)
    except Exception:
        return False


def extract_provided_secrets(headers: dict) -> list[str]:
    """Collect candidate secrets from headers. Never include the Authorization scheme prefix."""
    values: list[str] = []
    lowered = {str(k).lower(): str(v) for k, v in (headers or {}).items()}
    for key in ("x-thumbtack-webhook-secret", "x-webhook-secret"):
        raw = (lowered.get(key) or "").strip()
        if raw:
            values.append(raw)
    auth = (lowered.get("authorization") or "").strip()
    if auth.lower().startswith("bearer "):
        token = auth[7:].strip()
        if token:
            values.append(token)
    elif auth.lower().startswith("basic "):
        try:
            decoded = base64.b64decode(auth[6:].strip()).decode("utf-8")
            user, _, password = decoded.partition(":")
            if user.strip():
                values.append(user.strip())
            if password.strip():
                values.append(password.strip())
        except Exception:
            logger.warning("Thumbtack webhook Basic auth header could not be decoded.")
    return values


def webhook_authorized(headers: dict) -> bool:
    expected = configured_webhook_secret()
    if not expected:
        return True
    for candidate in extract_provided_secrets(headers):
        if _safe_compare(candidate, expected):
            return True
    return False


def _as_dict(value: Any) -> dict:
    return value if isinstance(value, dict) else {}


def _as_list(value: Any) -> list:
    return value if isinstance(value, list) else []


def _text(*parts: Any) -> str:
    for part in parts:
        if part is None:
            continue
        text = str(part).strip()
        if text:
            return text
    return ""


def _format_address(location: dict, fallback: str = "") -> str:
    loc = _as_dict(location)
    bits = [
        _text(loc.get("address1"), loc.get("address"), loc.get("street")),
        _text(loc.get("address2")),
        _text(loc.get("city")),
        _text(loc.get("state"), loc.get("region")),
        _text(loc.get("zipCode"), loc.get("zip"), loc.get("postal_code")),
    ]
    line = ", ".join([b for b in bits if b])
    return line or fallback


def _details_notes(details: Any, extra: str = "") -> str:
    lines = []
    extra_text = _text(extra)
    if extra_text:
        lines.append(extra_text)
    for item in _as_list(details):
        row = _as_dict(item)
        question = _text(row.get("question"), row.get("label"))
        answer = _text(row.get("answer"), row.get("value"))
        if question and answer:
            lines.append(f"{question}: {answer}")
        elif answer:
            lines.append(answer)
    return "\n".join(lines).strip()


def _event_type(body: dict) -> str:
    return _text(
        body.get("eventType"),
        body.get("event_type"),
        body.get("type"),
        body.get("reviewEventType"),
    )


def _is_ignored_event(event_type: str) -> Optional[str]:
    lowered = event_type.lower().replace("-", "").replace("_", "").replace(".", "")
    if not lowered:
        return None
    if any(marker.replace("_", "").replace(".", "") in lowered for marker in MESSAGE_EVENT_MARKERS):
        return f"Ignored Thumbtack event '{event_type}' (messages are not ingested)."
    if "review" in lowered:
        return f"Ignored Thumbtack event '{event_type}' (reviews are not ingested)."
    return None


def _unwrap_lead_object(body: dict) -> dict:
    """Thumbtack may send the negotiation at the top level or nested under several keys."""
    for key in ("negotiation", "lead", "data", "payload", "request"):
        nested = body.get(key)
        if isinstance(nested, dict) and (
            nested.get("negotiationID")
            or nested.get("leadID")
            or nested.get("customer")
            or nested.get("name")
            or nested.get("category")
        ):
            merged = {**nested}
            if key == "request" and not merged.get("customer"):
                merged["customer"] = body.get("customer")
            if key == "data":
                inner = nested.get("negotiation") or nested.get("lead")
                if isinstance(inner, dict):
                    merged = {**inner, **{k: v for k, v in nested.items() if k not in ("negotiation", "lead")}}
            return merged
    return body


def parse_thumbtack_payload(body: Any) -> dict:
    """Normalize Thumbtack and local test payloads into Revival lead fields.

    Returns keys: ignored, ignore_reason, name, phone, email, address,
    project_type, notes, thumbtack_lead_id, event_type.
    """
    raw = _as_dict(body)
    event_type = _event_type(raw)
    ignored = _is_ignored_event(event_type)
    if ignored:
        return {
            "ignored": True,
            "ignore_reason": ignored,
            "name": "",
            "phone": "",
            "email": "",
            "address": "",
            "project_type": "Kitchen Remodel",
            "notes": "",
            "thumbtack_lead_id": "",
            "event_type": event_type,
        }

    lead = _unwrap_lead_object(raw)
    customer = _as_dict(lead.get("customer") or raw.get("customer"))
    request = _as_dict(lead.get("request") or raw.get("request"))
    category = lead.get("category") or request.get("category") or raw.get("category")
    if isinstance(category, dict):
        project_type = _text(category.get("name"), category.get("category"), "Kitchen Remodel")
    else:
        project_type = _text(category, lead.get("project_type"), raw.get("project_type"), "Kitchen Remodel")

    location = (
        _as_dict(customer.get("location"))
        or _as_dict(request.get("location"))
        or _as_dict(lead.get("location"))
        or _as_dict(raw.get("location"))
    )
    address = _text(
        lead.get("address"),
        raw.get("address"),
        _format_address(location),
    )
    name = _text(
        lead.get("name"),
        raw.get("name"),
        customer.get("name"),
        customer.get("displayName"),
        customer.get("firstName") and f"{customer.get('firstName', '')} {customer.get('lastName', '')}".strip(),
    )
    phone = _text(
        lead.get("phone"),
        raw.get("phone"),
        customer.get("phone"),
        customer.get("phoneNumber"),
        customer.get("mobile"),
    )
    email = _text(
        lead.get("email"),
        raw.get("email"),
        customer.get("email"),
        customer.get("emailAddress"),
    )
    notes = _details_notes(
        lead.get("details") or request.get("details") or raw.get("details"),
        extra=_text(lead.get("notes"), raw.get("notes"), request.get("description"), lead.get("description")),
    )
    thumbtack_lead_id = _text(
        lead.get("thumbtack_lead_id"),
        raw.get("thumbtack_lead_id"),
        lead.get("negotiationID"),
        raw.get("negotiationID"),
        lead.get("leadID"),
        raw.get("leadID"),
        lead.get("id") if str(lead.get("id") or "").isdigit() else "",
    )
    return {
        "ignored": False,
        "ignore_reason": "",
        "name": name,
        "phone": phone,
        "email": email,
        "address": address,
        "project_type": project_type or "Kitchen Remodel",
        "notes": notes,
        "thumbtack_lead_id": thumbtack_lead_id,
        "event_type": event_type,
    }


def is_local_test_delivery(parsed: dict, headers: dict, actor: str = "") -> bool:
    """True for /webhooks/thumbtack/test and TEST-TT- ids, so logs can highlight real leads."""
    tt_id = str((parsed or {}).get("thumbtack_lead_id") or "")
    if tt_id.startswith("TEST-TT-") or tt_id.startswith("TEST_"):
        return True
    if str(actor or "").startswith("test:"):
        return True
    lowered = {str(k).lower(): str(v) for k, v in (headers or {}).items()}
    return bool(lowered.get("x-revival-test"))


def redact_headers(headers: dict) -> dict:
    """Persist request metadata without secrets."""
    safe = {}
    for key, value in (headers or {}).items():
        lowered = str(key).lower()
        if lowered in {"authorization", "x-thumbtack-webhook-secret", "x-webhook-secret", "cookie"}:
            safe[key] = "[redacted]"
        else:
            safe[key] = value
    return safe
