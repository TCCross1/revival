"""Lead speed-dial settings and call-log helpers (Mongo-backed)."""
from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

logger = logging.getLogger(__name__)

CALLING_SETTINGS_KEY = "calling"
DEFAULT_FROM_NUMBER = (os.environ.get("VAPI_OUTBOUND_NUMBER") or "+18599978212").strip()

DEFAULT_CALLING_SETTINGS = {
    "auto_call_enabled": True,
    "auto_call_thumbtack": True,
    "auto_call_google_ads": True,
    "auto_call_angi": True,
    "from_number": DEFAULT_FROM_NUMBER,
    "notify_emails": ["revivalhomeremodelingllc@gmail.com"],
    "notify_phones": [],
    "owner_fallback_phones": [],
    "notes": "Riley auto-dials new marketplace leads. Edit contacts here anytime.",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_calling_settings(raw: Optional[dict]) -> dict:
    base = dict(DEFAULT_CALLING_SETTINGS)
    if not isinstance(raw, dict):
        return base
    base["auto_call_enabled"] = bool(raw.get("auto_call_enabled", True))
    base["auto_call_thumbtack"] = bool(raw.get("auto_call_thumbtack", True))
    base["auto_call_google_ads"] = bool(raw.get("auto_call_google_ads", True))
    base["auto_call_angi"] = bool(raw.get("auto_call_angi", True))
    from_number = str(raw.get("from_number") or DEFAULT_FROM_NUMBER).strip()
    base["from_number"] = from_number or DEFAULT_FROM_NUMBER

    def _list(key: str) -> list:
        val = raw.get(key)
        if isinstance(val, str):
            parts = [p.strip() for p in val.replace(";", ",").split(",")]
            return [p for p in parts if p]
        if isinstance(val, list):
            return [str(x).strip() for x in val if str(x).strip()]
        return list(base.get(key) or [])

    base["notify_emails"] = _list("notify_emails") or list(DEFAULT_CALLING_SETTINGS["notify_emails"])
    base["notify_phones"] = _list("notify_phones")
    base["owner_fallback_phones"] = _list("owner_fallback_phones")
    base["notes"] = str(raw.get("notes") or DEFAULT_CALLING_SETTINGS["notes"])[:2000]
    return base


def auto_call_allowed_for_source(settings: dict, source: str) -> bool:
    if not settings.get("auto_call_enabled"):
        return False
    src = (source or "").strip().lower()
    if src == "thumbtack":
        return bool(settings.get("auto_call_thumbtack"))
    if src in {"google", "google ads", "google_ads"}:
        return bool(settings.get("auto_call_google_ads"))
    if src in {"angi", "angie's", "angies", "homeadvisor"}:
        return bool(settings.get("auto_call_angi"))
    return bool(settings.get("auto_call_enabled"))


def new_call_log_id() -> str:
    return f"clog_{uuid.uuid4().hex[:12]}"


def build_call_log(
    *,
    lead_id: str,
    source: str,
    trigger: str,
    status: str,
    to_number: str = "",
    from_number: str = "",
    vapi_call_id: str = "",
    attempt: int = 1,
    summary: str = "",
    transcript: str = "",
    collected: Optional[dict] = None,
    error: str = "",
    actor: str = "system",
) -> dict:
    return {
        "id": new_call_log_id(),
        "lead_id": lead_id,
        "source": source or "",
        "trigger": trigger or "manual",
        "status": status,
        "to_number": to_number or "",
        "from_number": from_number or "",
        "vapi_call_id": vapi_call_id or "",
        "attempt": int(attempt or 1),
        "summary": (summary or "")[:4000],
        "transcript": (transcript or "")[:50000],
        "collected": collected if isinstance(collected, dict) else {},
        "error": (error or "")[:2000],
        "actor": actor or "system",
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }


def merge_vapi_end_of_call(message: Any) -> dict:
    """Pull useful fields from a Vapi end-of-call-report style payload."""
    msg = message if isinstance(message, dict) else {}
    call = msg.get("call") if isinstance(msg.get("call"), dict) else {}
    artifact = msg.get("artifact") if isinstance(msg.get("artifact"), dict) else {}
    analysis = msg.get("analysis") if isinstance(msg.get("analysis"), dict) else {}
    call_id = str(call.get("id") or msg.get("callId") or msg.get("id") or "").strip()
    transcript = (
        artifact.get("transcript")
        or msg.get("transcript")
        or analysis.get("transcript")
        or ""
    )
    summary = (
        analysis.get("summary")
        or msg.get("summary")
        or artifact.get("summary")
        or ""
    )
    status = str(
        call.get("status")
        or msg.get("endedReason")
        or msg.get("status")
        or "completed"
    ).strip()
    collected = {}
    for key in ("structuredData", "structured_data", "successEvaluation"):
        if isinstance(analysis.get(key), dict):
            collected.update(analysis.get(key) or {})
    customer = call.get("customer") if isinstance(call.get("customer"), dict) else {}
    return {
        "vapi_call_id": call_id,
        "status": status[:80],
        "summary": str(summary)[:4000],
        "transcript": str(transcript)[:50000],
        "collected": collected,
        "to_number": str(customer.get("number") or ""),
    }
