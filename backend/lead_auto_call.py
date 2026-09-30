"""Auto-dial marketplace leads through Vapi and persist call logs."""
from __future__ import annotations

import logging
from typing import Callable, Optional

from calling_settings import (
    auto_call_allowed_for_source,
    build_call_log,
    normalize_calling_settings,
    now_iso,
)
from thumbtack_webhook import is_local_test_delivery
from vapi_client import VapiConfigError, VapiRequestError, place_outbound_call

logger = logging.getLogger(__name__)

CALLING_SETTINGS_KEY = "calling"


async def load_calling_settings(db) -> dict:
    try:
        doc = await db.settings.find_one({"key": CALLING_SETTINGS_KEY}, {"_id": 0}) or {}
        return normalize_calling_settings(doc)
    except Exception:
        logger.exception("Could not load calling settings")
        return normalize_calling_settings({})


async def save_calling_settings(db, payload: dict) -> dict:
    clean = normalize_calling_settings(payload)
    await db.settings.update_one(
        {"key": CALLING_SETTINGS_KEY},
        {"$set": {"key": CALLING_SETTINGS_KEY, **clean}},
        upsert=True,
    )
    return clean


async def insert_call_log(db, log: dict) -> dict:
    await db.call_logs.insert_one(dict(log))
    return {k: v for k, v in log.items() if k != "_id"}


async def record_outbound_attempt(
    *,
    db,
    lead: dict,
    trigger: str,
    actor: str,
    serialize_lead: Callable,
    result: Optional[dict] = None,
    error: str = "",
) -> dict:
    """Stamp the lead and write a call_logs row after a dial attempt."""
    lead_id = str((lead or {}).get("id") or "")
    attempt = 1
    try:
        attempt = int(await db.call_logs.count_documents({"lead_id": lead_id})) + 1
    except Exception:
        attempt = 1

    status = "queued" if result else "failed"
    log = build_call_log(
        lead_id=lead_id,
        source=(lead or {}).get("source") or "",
        trigger=trigger,
        status=status,
        to_number=(result or {}).get("to_number") or (lead or {}).get("phone") or "",
        from_number=(result or {}).get("from_number") or "",
        vapi_call_id=(result or {}).get("call_id") or "",
        attempt=attempt,
        summary="" if result else (error or "Call failed"),
        error=error,
        actor=actor,
    )
    try:
        await insert_call_log(db, log)
    except Exception:
        logger.exception("Could not insert call log lead_id=%s", lead_id)

    lead_doc = None
    if lead_id and result:
        try:
            stamp = {
                "last_vapi_call_id": result.get("call_id"),
                "last_called_at": now_iso(),
                "call_attempts": attempt,
            }
            existing = await db.leads.find_one({"id": lead_id}, {"_id": 0})
            if existing:
                if (existing.get("status") or "New") in {"New", "Hot", "Warm"}:
                    stamp["status"] = "Contacted"
                    if not existing.get("first_response_at"):
                        stamp["first_response_at"] = now_iso()
                await db.leads.update_one({"id": lead_id}, {"$set": stamp})
                fresh = await db.leads.find_one({"id": lead_id}, {"_id": 0})
                lead_doc = serialize_lead(fresh) if fresh else None
        except Exception:
            logger.exception("Could not stamp lead after call lead_id=%s", lead_id)
    return {"call": result, "lead": lead_doc, "log": log}


async def auto_dial_lead(
    *,
    db,
    lead_id: str,
    trigger: str,
    actor: str,
    serialize_lead: Callable,
    headers: Optional[dict] = None,
) -> Optional[dict]:
    """Place an outbound Vapi call for a newly ingested lead when settings allow it."""
    lead = await db.leads.find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        logger.warning("Auto-dial skipped: lead not found id=%s", lead_id)
        return None

    if is_local_test_delivery(
        {"thumbtack_lead_id": lead.get("thumbtack_lead_id") or lead.get("google_ads_lead_id") or lead.get("angi_lead_id") or ""},
        headers or {},
        actor,
    ):
        logger.info("Auto-dial skipped for test lead id=%s", lead_id)
        return None

    if lead.get("last_vapi_call_id"):
        logger.info("Auto-dial skipped: already called lead_id=%s", lead_id)
        return None

    phone = (lead.get("phone") or "").strip()
    if not phone:
        logger.warning("Auto-dial skipped: no phone lead_id=%s", lead_id)
        await insert_call_log(
            db,
            build_call_log(
                lead_id=lead_id,
                source=lead.get("source") or "",
                trigger=trigger,
                status="skipped",
                error="Lead has no phone number.",
                actor=actor,
            ),
        )
        return None

    settings = await load_calling_settings(db)
    if not auto_call_allowed_for_source(settings, lead.get("source") or ""):
        logger.info(
            "Auto-dial disabled for source=%s lead_id=%s",
            lead.get("source"),
            lead_id,
        )
        return None

    payload = {
        "phone": phone,
        "name": lead.get("name") or "",
        "project_type": lead.get("project_type") or "",
        "address": lead.get("address") or "",
        "email": lead.get("email") or "",
        "source": lead.get("source") or "",
        "notes": lead.get("notes") or "",
        "lead_id": lead_id,
    }
    try:
        result = await place_outbound_call(payload)
        out = await record_outbound_attempt(
            db=db,
            lead=lead,
            trigger=trigger,
            actor=actor,
            serialize_lead=serialize_lead,
            result=result,
        )
        logger.info(
            "AUTO DIAL QUEUED lead_id=%s source=%s call_id=%s to=%s",
            lead_id,
            lead.get("source"),
            result.get("call_id"),
            result.get("to_number"),
        )
        return out
    except (ValueError, VapiConfigError, VapiRequestError) as ex:
        logger.error("Auto-dial failed lead_id=%s err=%s", lead_id, ex)
        await record_outbound_attempt(
            db=db,
            lead=lead,
            trigger=trigger,
            actor=actor,
            serialize_lead=serialize_lead,
            error=str(ex),
        )
        return None
    except Exception as ex:
        # Network/proxy failures talking to Vapi should still leave a call log.
        logger.exception("Auto-dial unexpected failure lead_id=%s", lead_id)
        await record_outbound_attempt(
            db=db,
            lead=lead,
            trigger=trigger,
            actor=actor,
            serialize_lead=serialize_lead,
            error=str(ex)[:500] or "Unexpected auto-dial failure.",
        )
        return None
