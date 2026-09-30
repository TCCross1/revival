"""Calling settings, call logs, and Vapi end-of-call webhook."""
from __future__ import annotations

import logging
import os

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from calling_settings import build_call_log, merge_vapi_end_of_call, now_iso
from lead_auto_call import load_calling_settings, save_calling_settings
from thumbtack_webhook import is_loopback_request

logger = logging.getLogger(__name__)


def _secret_match(headers: dict, secret: str) -> bool:
    if not secret:
        return False
    lowered = {str(k).lower(): v for k, v in (headers or {}).items()}
    for key in ("x-webhook-secret", "x-revival-webhook-secret", "x-vapi-secret"):
        if (lowered.get(key) or "").strip() == secret:
            return True
    auth = (lowered.get("authorization") or "").strip()
    if auth.lower().startswith("bearer ") and auth[7:].strip() == secret:
        return True
    return False


class CallingSettingsUpdate(BaseModel):
    auto_call_enabled: bool = True
    auto_call_thumbtack: bool = True
    auto_call_google_ads: bool = True
    auto_call_angi: bool = True
    from_number: str = ""
    notify_emails: list = Field(default_factory=list)
    notify_phones: list = Field(default_factory=list)
    owner_fallback_phones: list = Field(default_factory=list)
    notes: str = ""


def attach_lead_speed_dial_routes(api_router: APIRouter):
    from server import User, assert_user_feature, db, get_current_user

    @api_router.get("/leads/calling-settings")
    async def get_calling_settings(user: User = Depends(get_current_user)):
        try:
            await assert_user_feature(user, "leads")
            return await load_calling_settings(db)
        except HTTPException:
            raise
        except Exception:
            logger.exception("Load calling settings failed")
            raise HTTPException(status_code=503, detail="Could not load calling settings.")

    @api_router.put("/leads/calling-settings")
    async def put_calling_settings(body: CallingSettingsUpdate, user: User = Depends(get_current_user)):
        try:
            await assert_user_feature(user, "leads")
            saved = await save_calling_settings(db, body.model_dump())
            logger.info("Calling settings saved user=%s auto=%s", user.user_id, saved.get("auto_call_enabled"))
            return saved
        except HTTPException:
            raise
        except Exception:
            logger.exception("Save calling settings failed")
            raise HTTPException(status_code=503, detail="Could not save calling settings.")

    @api_router.get("/leads/call-logs")
    async def list_call_logs(user: User = Depends(get_current_user), lead_id: str = "", limit: int = 100):
        try:
            await assert_user_feature(user, "leads")
            query = {}
            if lead_id.strip():
                query["lead_id"] = lead_id.strip()
            cap = max(1, min(int(limit or 100), 500))
            return await db.call_logs.find(query, {"_id": 0}).sort("created_at", -1).to_list(cap)
        except HTTPException:
            raise
        except Exception:
            logger.exception("List call logs failed")
            raise HTTPException(status_code=503, detail="Could not load call logs.")

    @api_router.post("/webhooks/vapi")
    async def vapi_status_webhook(request: Request):
        """Receive Vapi end-of-call reports and update call logs + lead notes."""
        try:
            secret = (os.environ.get("VAPI_WEBHOOK_SECRET") or "").strip()
            headers = dict(request.headers)
            peer = request.client.host if request.client else ""
            host = headers.get("host") or ""
            if secret:
                if not _secret_match(headers, secret):
                    raise HTTPException(status_code=401, detail="Invalid Vapi webhook secret.")
            elif not is_loopback_request(client_host=peer, http_host=host):
                raise HTTPException(status_code=401, detail="VAPI_WEBHOOK_SECRET is required.")

            body = await request.json()
            message = body.get("message") if isinstance(body, dict) and isinstance(body.get("message"), dict) else body
            parsed = merge_vapi_end_of_call(message if isinstance(message, dict) else {})
            call_id = parsed.get("vapi_call_id") or ""
            if not call_id:
                return {"status": "ignored", "reason": "No call id"}

            log = await db.call_logs.find_one({"vapi_call_id": call_id}, {"_id": 0})
            patch = {
                "status": parsed.get("status") or "completed",
                "summary": parsed.get("summary") or "",
                "transcript": parsed.get("transcript") or "",
                "collected": parsed.get("collected") or {},
                "updated_at": now_iso(),
            }
            lead_id = ""
            if log:
                await db.call_logs.update_one({"id": log["id"]}, {"$set": patch})
                lead_id = log.get("lead_id") or ""
            else:
                lead = await db.leads.find_one({"last_vapi_call_id": call_id}, {"_id": 0})
                lead_id = (lead or {}).get("id") or ""
                row = build_call_log(
                    lead_id=lead_id,
                    source=(lead or {}).get("source") or "",
                    trigger="vapi_webhook",
                    status=patch["status"],
                    to_number=parsed.get("to_number") or "",
                    vapi_call_id=call_id,
                    summary=patch["summary"],
                    transcript=patch["transcript"],
                    collected=patch["collected"],
                    actor="vapi-webhook",
                )
                await db.call_logs.insert_one(row)

            if lead_id and (patch.get("summary") or patch.get("collected")):
                note_bits = []
                if patch.get("summary"):
                    note_bits.append(f"Riley call summary: {patch['summary']}")
                collected = patch.get("collected") or {}
                if collected:
                    note_bits.append(
                        "Collected: " + ", ".join(f"{k}={v}" for k, v in list(collected.items())[:12])
                    )
                if note_bits:
                    lead = await db.leads.find_one({"id": lead_id}, {"_id": 0})
                    prior = (lead or {}).get("notes") or ""
                    addition = "\n".join(note_bits)
                    if addition not in prior:
                        await db.leads.update_one(
                            {"id": lead_id},
                            {"$set": {"notes": (prior + "\n\n" + addition).strip()[:4000]}},
                        )
            logger.info("Vapi webhook processed call_id=%s status=%s", call_id, patch.get("status"))
            return {"status": "ok", "vapi_call_id": call_id}
        except HTTPException:
            raise
        except Exception:
            logger.exception("Vapi webhook failed")
            raise HTTPException(status_code=500, detail="Could not process Vapi webhook.")
