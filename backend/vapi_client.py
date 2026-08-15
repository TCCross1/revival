"""Place outbound phone calls through the Vapi API. Never log the API key."""
import asyncio
import logging
import os
from pathlib import Path

import httpx
from dotenv import load_dotenv
from phone import digits_only as _digits, to_e164 as normalize_e164

_HERE = Path(__file__).resolve().parent
load_dotenv(_HERE.parent / ".env")
load_dotenv(_HERE / ".env")

logger = logging.getLogger(__name__)

VAPI_BASE = "https://api.vapi.ai"
PREFERRED_ASSISTANT = "Riley — Revival Home Remodeling"
DEFAULT_FROM_NUMBER = "+18599978212"

_lock = asyncio.Lock()
_cache = {
    "assistant_id": None,
    "assistant_name": None,
    "phone_number_id": None,
    "from_number": None,
}


class VapiConfigError(Exception):
    """Missing or unusable Vapi configuration."""


class VapiRequestError(Exception):
    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


def to_e164(phone: str) -> str:
    raw = (phone or "").strip()
    if not raw:
        raise ValueError("A phone number is required to place a call.")
    return normalize_e164(raw, required=True)


def _mask_phone(e164: str) -> str:
    digits = _digits(e164)
    if len(digits) < 4:
        return "***"
    return f"***{digits[-4:]}"


def _api_key() -> str:
    key = (os.environ.get("VAPI_API_KEY") or "").strip()
    if not key:
        raise VapiConfigError(
            "Outbound calling is not configured. Set VAPI_API_KEY on the server."
        )
    return key


def _as_list(data) -> list:
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in ("results", "data", "items"):
            if isinstance(data.get(key), list):
                return data[key]
    return []


def _assistant_score(name: str) -> int:
    n = (name or "").lower().replace("—", "-").replace("–", "-")
    preferred = PREFERRED_ASSISTANT.lower().replace("—", "-")
    if n == preferred:
        return 100
    if "riley" in n and "revival" in n and "remodel" in n:
        return 90
    if "riley" in n and "outbound" in n:
        return 80
    if "riley" in n and "revival" in n:
        return 70
    if "riley" in n:
        return 40
    return 0


def _extract_vapi_message(body) -> str:
    if isinstance(body, str) and body.strip():
        return body.strip()
    if isinstance(body, list):
        parts = [_extract_vapi_message(item) for item in body]
        return " ".join(part for part in parts if part).strip()
    if not isinstance(body, dict):
        return ""
    for key in ("message", "error", "detail", "msg"):
        nested = _extract_vapi_message(body.get(key))
        if nested:
            return nested
    return ""


def _vapi_error_body(resp: httpx.Response) -> str:
    text = (resp.text or "").strip()
    return text if text else "(empty body)"


def _vapi_message(resp: httpx.Response) -> str:
    try:
        extracted = _extract_vapi_message(resp.json())
        if extracted:
            return extracted
    except Exception as ex:
        logger.warning("Could not parse Vapi error JSON: %s", ex)
    text = (resp.text or "").strip()
    return text or f"Vapi request failed (HTTP {resp.status_code})"


def _log_vapi_http_error(action: str, resp: httpx.Response) -> str:
    message = _vapi_message(resp)
    logger.error(
        "%s status=%s content_type=%s body=%s",
        action,
        resp.status_code,
        resp.headers.get("content-type") or "-",
        _vapi_error_body(resp),
    )
    return message


async def _vapi_get(path: str) -> list:
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{VAPI_BASE}{path}",
            headers={"Authorization": f"Bearer {_api_key()}"},
            params={"limit": 100},
        )
    if resp.status_code >= 400:
        message = _log_vapi_http_error(f"Vapi GET {path} failed", resp)
        raise VapiRequestError(f"Could not load Vapi assistants or phone numbers: {message}")
    return _as_list(resp.json())


async def _resolve_assistant_id() -> tuple:
    assistants = await _vapi_get("/assistant")
    if not assistants:
        raise VapiConfigError("No Vapi assistants were found for this API key.")
    configured = (os.environ.get("VAPI_ASSISTANT_ID") or "").strip()
    wanted = (os.environ.get("VAPI_ASSISTANT_NAME") or PREFERRED_ASSISTANT).strip()
    by_id = next((a for a in assistants if a.get("id") == configured), None) if configured else None
    exact = next(
        (a for a in assistants if (a.get("name") or "").strip().lower() == wanted.lower()),
        None,
    )
    ranked = sorted(assistants, key=lambda a: _assistant_score(a.get("name") or ""), reverse=True)
    best = ranked[0]
    score = _assistant_score(best.get("name") or "")
    if by_id and _assistant_score(by_id.get("name") or "") >= 40:
        chosen = by_id
    else:
        chosen = exact or (best if score >= 40 else None)
        if configured and by_id and chosen and by_id.get("id") != chosen.get("id"):
            logger.warning(
                "Ignoring VAPI_ASSISTANT_ID=%s name=%r; using Riley assistant id=%s name=%r",
                configured,
                by_id.get("name"),
                chosen.get("id"),
                chosen.get("name"),
            )
    if not chosen or not chosen.get("id"):
        raise VapiConfigError(
            f'Could not find Vapi assistant "{PREFERRED_ASSISTANT}". Set VAPI_ASSISTANT_ID.'
        )
    name = (chosen.get("name") or wanted).strip()
    logger.info("Resolved Vapi assistant name=%r id=%s", name, chosen["id"])
    return chosen["id"], name


async def _resolve_phone_number_id() -> tuple:
    wanted = to_e164(os.environ.get("VAPI_OUTBOUND_NUMBER") or DEFAULT_FROM_NUMBER)
    numbers = await _vapi_get("/phone-number")
    configured = (os.environ.get("VAPI_PHONE_NUMBER_ID") or "").strip()
    by_id = next((n for n in numbers if n.get("id") == configured), None) if configured else None
    by_number = next((n for n in numbers if _digits(n.get("number") or "") == _digits(wanted)), None)
    if by_id and _digits(by_id.get("number") or "") == _digits(wanted):
        chosen = by_id
    else:
        chosen = by_number
        if configured and by_id and chosen and by_id.get("id") != chosen.get("id"):
            logger.warning(
                "Ignoring VAPI_PHONE_NUMBER_ID=%s number=%s; using Revival number %s id=%s",
                configured,
                by_id.get("number"),
                wanted,
                chosen.get("id"),
            )
    if not chosen or not chosen.get("id"):
        raise VapiConfigError(
            f"Could not find Vapi phone number {wanted}. Set VAPI_PHONE_NUMBER_ID."
        )
    actual = to_e164(chosen.get("number") or wanted)
    logger.info(
        "Resolved Vapi from-number name=%r number=%s id=%s",
        chosen.get("name") or "",
        actual,
        chosen["id"],
    )
    return chosen["id"], actual


async def resolve_vapi_ids(force: bool = False) -> dict:
    async with _lock:
        if not force and _cache["assistant_id"] and _cache["phone_number_id"]:
            return dict(_cache)
        assistant_id, assistant_name = await _resolve_assistant_id()
        phone_number_id, from_number = await _resolve_phone_number_id()
        _cache.update({
            "assistant_id": assistant_id,
            "assistant_name": assistant_name,
            "phone_number_id": phone_number_id,
            "from_number": from_number,
        })
        return dict(_cache)


def _variable_values(lead: dict) -> dict:
    values = {
        "customerName": lead.get("name") or "",
        "leadName": lead.get("name") or "",
        "projectType": lead.get("project_type") or "",
        "address": lead.get("address") or "",
        "email": lead.get("email") or "",
        "source": lead.get("source") or "",
        "notes": lead.get("notes") or "",
        "phone": lead.get("phone") or "",
        "leadId": lead.get("lead_id") or "",
    }
    return {k: v for k, v in values.items() if str(v).strip()}


async def place_outbound_call(lead: dict) -> dict:
    """Create a Vapi outbound call for one lead. `lead` must include name and phone."""
    name = (lead.get("name") or "").strip()
    if not name:
        raise ValueError("A lead name is required to place a call.")
    customer_number = to_e164(lead.get("phone") or "")
    ids = await resolve_vapi_ids()
    payload = {
        "assistantId": ids["assistant_id"],
        "phoneNumberId": ids["phone_number_id"],
        "name": f"Revival outbound — {name}",
        "customer": {
            "number": customer_number,
            "name": name,
            "externalId": (lead.get("lead_id") or "").strip() or None,
        },
        "assistantOverrides": {
            "variableValues": _variable_values({**lead, "phone": customer_number}),
        },
    }
    if not payload["customer"]["externalId"]:
        payload["customer"].pop("externalId", None)

    logger.info(
        "Placing Vapi outbound call to=%s assistantId=%s assistantName=%r "
        "phoneNumberId=%s fromNumber=%s lead_id=%s",
        _mask_phone(customer_number),
        ids["assistant_id"],
        ids["assistant_name"],
        ids["phone_number_id"],
        ids["from_number"],
        lead.get("lead_id") or "-",
    )
    try:
        async with httpx.AsyncClient(timeout=45) as client:
            resp = await client.post(
                f"{VAPI_BASE}/call",
                headers={
                    "Authorization": f"Bearer {_api_key()}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
    except httpx.TimeoutException:
        logger.error("Vapi outbound call timed out")
        raise VapiRequestError("Vapi did not respond in time. Please try again.")
    except httpx.RequestError as ex:
        logger.error("Vapi outbound call network error: %s", ex)
        raise VapiRequestError("Could not reach Vapi. Please try again.")

    if resp.status_code in (401, 403):
        message = _log_vapi_http_error("Vapi auth failed", resp)
        raise VapiConfigError(f"Vapi rejected the API key. {message}")
    if resp.status_code == 404:
        async with _lock:
            _cache.update({k: None for k in _cache})
        message = _log_vapi_http_error("Vapi resource missing", resp)
        raise VapiConfigError(
            f"Vapi could not find the Riley assistant or outbound number. {message}"
        )
    if resp.status_code >= 400:
        message = _log_vapi_http_error("Vapi create call failed", resp)
        raise VapiRequestError(
            f"Vapi could not place this call: {message}",
            status_code=400 if resp.status_code < 500 else 502,
        )

    body = resp.json() if resp.content else {}
    call_id = body.get("id") or ""
    logger.info(f"Vapi outbound call queued id={call_id} status={body.get('status')}")
    return {
        "call_id": call_id,
        "status": body.get("status") or "queued",
        "assistant_id": ids["assistant_id"],
        "assistant_name": ids["assistant_name"],
        "phone_number_id": ids["phone_number_id"],
        "from_number": ids["from_number"],
        "to_number": customer_number,
    }
