"""Leads, Vapi, and Thumbtack HTTP routes.
Attached from server.py after models and helpers exist.
"""
import base64
import json
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from html import escape
from io import BytesIO
from typing import List, Optional

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Cookie,
    Depends,
    File,
    Form,
    HTTPException,
    Request,
    Response,
    UploadFile,
)
from fastapi.responses import RedirectResponse, StreamingResponse
from pydantic import BaseModel

logger = logging.getLogger(__name__)

from vapi_client import VapiConfigError, VapiRequestError, place_outbound_call
from phone import to_e164 as phone_to_e164
from thumbtack_webhook import (
    NGROK_WEBHOOK_URL_FORMAT,
    configured_webhook_secret,
    is_local_test_delivery,
    is_loopback_request,
    parse_thumbtack_payload,
    redact_headers,
    webhook_authorized,
)
from lead_auto_call import auto_dial_lead, record_outbound_attempt
from lead_ingest_webhooks import parse_angi_payload, parse_google_ads_payload


def attach_lead_routes(api_router: APIRouter):
    from server import (
        Client,
        Job,
        LIVE_LEAD_STATUSES,
        Lead,
        LeadCreate,
        User,
        _ensure_job_sheet,
        assert_user_feature,
        db,
        get_current_user,
        logger,
        new_id,
        next_number,
        normalize_phone_field,
        now_iso,
        require_admin,
        seed_leads,
        serialize_lead,
    )

    @api_router.get("/leads")
    async def list_leads(user: User = Depends(get_current_user), source: str = "", status: str = "", q: str = ""):
        try:
            await assert_user_feature(user, "leads")
            await seed_leads()
            query = {}
            if source and source != "All":
                query["source"] = source
            if status and status != "All":
                query["status"] = status
            docs = await db.leads.find(query, {"_id": 0}).sort("created_at", -1).to_list(2000)
            needle = (q or "").strip().lower()
            if needle:
                docs = [d for d in docs if needle in " ".join([
                    d.get("name", ""), d.get("phone", ""), d.get("email", ""),
                    d.get("project_type", ""), d.get("address", ""), d.get("notes", ""),
                ]).lower()]
            return [serialize_lead(d) for d in docs]
        except Exception as ex:
            logger.error(f"List leads failed: {ex}")
            raise HTTPException(status_code=500, detail="Could not load leads. Please try again.")


    @api_router.get("/leads/stats")
    async def lead_stats(user: User = Depends(get_current_user)):
        try:
            await seed_leads()
            docs = await db.leads.find({}, {"_id": 0, "status": 1}).to_list(2000)
            live = len([d for d in docs if (d.get("status") or "") in LIVE_LEAD_STATUSES])
            return {"total": len(docs), "live": live}
        except Exception as ex:
            logger.error(f"Lead stats failed: {ex}")
            raise HTTPException(status_code=500, detail="Could not load lead stats. Please try again.")


    @api_router.post("/leads")
    async def create_lead(payload: LeadCreate, user: User = Depends(get_current_user)):
        try:
            name = (payload.name or "").strip()
            if not name:
                raise HTTPException(status_code=400, detail="Lead name is required.")
            data = payload.model_dump()
            data["name"] = name
            data["phone"] = normalize_phone_field(data.get("phone") or "")
            if data.get("status") in {"Contacted", "Booked", "Completed"} and not data.get("first_response_at"):
                data["first_response_at"] = now_iso()
            obj = Lead(**data)
            await db.leads.insert_one(obj.model_dump())
            logger.info(f"Created lead {obj.id} user={user.user_id}")
            return serialize_lead(obj.model_dump())
        except HTTPException:
            raise
        except Exception as ex:
            logger.error(f"Create lead failed: {ex}")
            raise HTTPException(status_code=500, detail="Could not create the lead. Please try again.")


    @api_router.get("/leads/{lead_id}")
    async def get_lead(lead_id: str, user: User = Depends(get_current_user)):
        doc = await db.leads.find_one({"id": lead_id}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Lead not found")
        return serialize_lead(doc)


    @api_router.put("/leads/{lead_id}")
    async def update_lead(lead_id: str, payload: LeadCreate, user: User = Depends(get_current_user)):
        try:
            existing = await db.leads.find_one({"id": lead_id}, {"_id": 0})
            if not existing:
                raise HTTPException(status_code=404, detail="Lead not found")
            name = (payload.name or "").strip()
            if not name:
                raise HTTPException(status_code=400, detail="Lead name is required.")
            data = payload.model_dump()
            data["name"] = name
            data["phone"] = normalize_phone_field(data.get("phone") or "")
            if data.get("status") in {"Contacted", "Booked", "Completed"} and not (data.get("first_response_at") or existing.get("first_response_at")):
                data["first_response_at"] = now_iso()
            elif not data.get("first_response_at"):
                data["first_response_at"] = existing.get("first_response_at", "")
            for keep in ("client_id", "job_id", "converted_at", "last_vapi_call_id", "last_called_at", "thumbtack_lead_id"):
                if not data.get(keep):
                    data[keep] = existing.get(keep, "")
            updated = {**existing, **data}
            await db.leads.update_one({"id": lead_id}, {"$set": updated})
            logger.info(f"Updated lead {lead_id} user={user.user_id}")
            return serialize_lead(updated)
        except HTTPException:
            raise
        except Exception as ex:
            logger.error(f"Update lead failed lead_id={lead_id}: {ex}")
            raise HTTPException(status_code=500, detail="Could not update the lead. Please try again.")


    @api_router.delete("/leads/{lead_id}")
    async def delete_lead(lead_id: str, user: User = Depends(get_current_user)):
        try:
            existing = await db.leads.find_one({"id": lead_id}, {"_id": 0})
            if not existing:
                raise HTTPException(status_code=404, detail="Lead not found")
            await db.leads.delete_one({"id": lead_id})
            logger.info(f"Deleted lead {lead_id} user={user.user_id}")
            return {"success": True}
        except HTTPException:
            raise
        except Exception as ex:
            logger.error(f"Delete lead failed lead_id={lead_id}: {ex}")
            raise HTTPException(status_code=500, detail="Could not delete the lead. Please try again.")


    def _safe_lead_phone(raw: str) -> str:
        try:
            return phone_to_e164(raw or "", required=False)
        except ValueError:
            logger.warning("Stored a lead with an unparseable phone; leaving phone blank.")
            return ""


    async def _convert_lead(lead_id: str, actor: str = "system"):
        """Create (or reuse) a Client and Job from this lead. Safe to call more than once."""
        lead = await db.leads.find_one({"id": lead_id}, {"_id": 0})
        if not lead:
            raise HTTPException(status_code=404, detail="Lead not found")

        created_client = False
        created_job = False

        client = None
        if lead.get("client_id"):
            client = await db.clients.find_one({"id": lead["client_id"]}, {"_id": 0})
        if not client and lead.get("id"):
            client = await db.clients.find_one({"lead_id": lead_id}, {"_id": 0})
        if not client:
            client_obj = Client(
                name=(lead.get("name") or "").strip() or "New Client",
                phone=_safe_lead_phone(lead.get("phone") or ""),
                email=lead.get("email") or "",
                address=lead.get("address") or "",
                source=lead.get("source") or "Referral",
                status="Active",
                notes=(lead.get("notes") or "").strip(),
                lead_id=lead_id,
            )
            await db.clients.insert_one(client_obj.model_dump())
            client = client_obj.model_dump()
            created_client = True
            logger.info(f"Converted lead {lead_id} created client {client['id']} actor={actor}")
        elif not client.get("lead_id"):
            await db.clients.update_one({"id": client["id"]}, {"$set": {"lead_id": lead_id}})
            client["lead_id"] = lead_id

        job = None
        if lead.get("job_id"):
            job = await db.jobs.find_one({"id": lead["job_id"]}, {"_id": 0})
        if not job:
            job = await db.jobs.find_one({"lead_id": lead_id}, {"_id": 0})
        if not job:
            project = (lead.get("project_type") or "Project").strip() or "Project"
            job_name = f"{project} - {client.get('name', '')}".strip(" -")
            job_obj = Job(
                job_number=await next_number("JOB"),
                name=job_name,
                lead_id=lead_id,
                client_id=client["id"],
                client_name=client.get("name") or "",
                status="Active",
                budget=0.0,
                expenses=[],
            )
            await db.jobs.insert_one(job_obj.model_dump())
            job = job_obj.model_dump()
            created_job = True
            logger.info(f"Converted lead {lead_id} created job {job['job_number']} actor={actor}")
        else:
            patch = {}
            if not job.get("lead_id"):
                patch["lead_id"] = lead_id
            if not job.get("client_id"):
                patch["client_id"] = client["id"]
                patch["client_name"] = client.get("name") or job.get("client_name", "")
            if patch:
                await db.jobs.update_one({"id": job["id"]}, {"$set": patch})
                job = {**job, **patch}

        lead_patch = {
            "client_id": client["id"],
            "job_id": job["id"],
            "converted_at": lead.get("converted_at") or now_iso(),
        }
        if (lead.get("status") or "New") in {"New", "Hot", "Warm", "Contacted"}:
            lead_patch["status"] = "Booked"
            if not lead.get("first_response_at"):
                lead_patch["first_response_at"] = now_iso()
        await db.leads.update_one({"id": lead_id}, {"$set": lead_patch})
        fresh = await db.leads.find_one({"id": lead_id}, {"_id": 0})
        logger.info(f"Lead {lead_id} converted client={client['id']} job={job['id']} actor={actor}")
        try:
            await _ensure_job_sheet(job, client=client, lead=lead)
        except Exception:
            logger.exception("Could not create job sheet for converted job %s", job.get("id"))
        return {
            "lead": serialize_lead(fresh),
            "client": Client(**client).model_dump(),
            "job": Job(**job).model_dump(),
            "created": {"client": created_client, "job": created_job},
        }


    @api_router.post("/leads/{lead_id}/convert")
    async def convert_lead(lead_id: str, user: User = Depends(get_current_user)):
        """Create (or reuse) a Client and Job from this lead. Safe to call more than once."""
        try:
            return await _convert_lead(lead_id, actor=user.user_id)
        except HTTPException:
            raise
        except Exception as ex:
            logger.error(f"Convert lead failed lead_id={lead_id}: {ex}")
            raise HTTPException(status_code=500, detail="Could not convert this lead to a client and job. Please try again.")


    async def _log_thumbtack_webhook(*, payload, headers, status, thumbtack_lead_id="", lead_id="", detail=""):
        try:
            await db.webhook_events.insert_one({
                "id": new_id(),
                "source": "thumbtack",
                "received_at": datetime.now(timezone.utc),
                "status": status,
                "thumbtack_lead_id": thumbtack_lead_id or "",
                "lead_id": lead_id or "",
                "detail": detail or "",
                "event_type": (payload or {}).get("eventType") or (payload or {}).get("event_type") or "",
                "headers": redact_headers(headers),
                "payload": payload if isinstance(payload, dict) else {"raw": str(payload)},
            })
        except Exception as ex:
            logger.error(f"Could not persist Thumbtack webhook log: {ex}")


    def _announce_thumbtack_result(kind: str, parsed: dict, headers: dict, actor: str, extra: str = ""):
        """Loud, grep-friendly console line when Thumbtack traffic is handled. Does not log secrets."""
        test = is_local_test_delivery(parsed, headers, actor)
        label = "THUMBTACK TEST LEAD" if test else "THUMBTACK REAL LEAD ARRIVED"
        logger.info(
            "%s status=%s name=%s project=%s phone=%s email=%s address=%s tt_id=%s %s",
            label,
            kind,
            parsed.get("name") or "-",
            parsed.get("project_type") or "-",
            parsed.get("phone") or "-",
            parsed.get("email") or "-",
            parsed.get("address") or "-",
            parsed.get("thumbtack_lead_id") or "-",
            extra,
        )


    async def _ingest_thumbtack_webhook(
        payload: dict,
        headers: dict,
        actor: str = "thumbtack-webhook",
        background_tasks: BackgroundTasks = None,
    ):
        parsed = parse_thumbtack_payload(payload)
        tt_id = parsed.get("thumbtack_lead_id") or ""
        logger.info(
            "Thumbtack webhook parsed event=%s tt_id=%s name=%s ignored=%s keys=%s",
            parsed.get("event_type") or "-",
            tt_id or "-",
            parsed.get("name") or "-",
            parsed.get("ignored"),
            ",".join(sorted(payload.keys())[:20]) if isinstance(payload, dict) else "-",
        )
        if parsed.get("ignored"):
            await _log_thumbtack_webhook(
                payload=payload, headers=headers, status="ignored",
                thumbtack_lead_id=tt_id, detail=parsed.get("ignore_reason") or "",
            )
            logger.info("Thumbtack webhook ignored event=%s reason=%s", parsed.get("event_type") or "-", parsed.get("ignore_reason") or "")
            return {"status": "ignored", "reason": parsed.get("ignore_reason") or "Event ignored."}

        name = (parsed.get("name") or "").strip()
        if not name:
            await _log_thumbtack_webhook(
                payload=payload, headers=headers, status="error",
                thumbtack_lead_id=tt_id, detail="Lead name is required.",
            )
            logger.warning("Thumbtack webhook missing lead name tt_id=%s keys=%s", tt_id or "-", ",".join(sorted(payload.keys())[:20]))
            raise HTTPException(status_code=400, detail="Lead name is required.")

        if tt_id:
            existing = await db.leads.find_one({"thumbtack_lead_id": tt_id}, {"_id": 0})
            if existing:
                converted = await _convert_lead(existing["id"], actor=actor)
                await _log_thumbtack_webhook(
                    payload=payload, headers=headers, status="duplicate",
                    thumbtack_lead_id=tt_id, lead_id=existing["id"],
                    detail="Existing Thumbtack lead reused; convert is idempotent.",
                )
                _announce_thumbtack_result(
                    "duplicate", parsed, headers, actor,
                    extra=f"lead={existing['id']} client={converted['client']['id']} job={converted['job']['id']}",
                )
                return {"status": "duplicate", "thumbtack_lead_id": tt_id, **converted}

        lead_doc = Lead(
            name=name,
            phone=_safe_lead_phone(parsed.get("phone") or ""),
            email=parsed.get("email") or "",
            address=parsed.get("address") or "",
            project_type=parsed.get("project_type") or "Kitchen Remodel",
            source="Thumbtack",
            status="New",
            notes=parsed.get("notes") or "",
            thumbtack_lead_id=tt_id,
        ).model_dump()
        if not tt_id:
            lead_doc.pop("thumbtack_lead_id", None)
        try:
            await db.leads.insert_one(lead_doc)
        except Exception as ex:
            if tt_id:
                raced = await db.leads.find_one({"thumbtack_lead_id": tt_id}, {"_id": 0})
                if raced:
                    converted = await _convert_lead(raced["id"], actor=actor)
                    await _log_thumbtack_webhook(
                        payload=payload, headers=headers, status="duplicate",
                        thumbtack_lead_id=tt_id, lead_id=raced["id"],
                        detail=f"Insert raced; reused existing lead. {ex}",
                    )
                    _announce_thumbtack_result(
                        "duplicate", parsed, headers, actor,
                        extra=f"lead={raced['id']} client={converted['client']['id']} job={converted['job']['id']}",
                    )
                    return {"status": "duplicate", "thumbtack_lead_id": tt_id, **converted}
            logger.exception("Thumbtack webhook failed to insert lead tt_id=%s", tt_id)
            await _log_thumbtack_webhook(
                payload=payload, headers=headers, status="error",
                thumbtack_lead_id=tt_id, detail="Could not create the lead.",
            )
            raise HTTPException(status_code=500, detail="Could not create the Thumbtack lead. Please try again.")

        # Convert into CRM, then auto-dial Riley in the background (skipped for tests).
        converted = await _convert_lead(lead_doc["id"], actor=actor)
        should_dial = not is_local_test_delivery(parsed, headers, actor)
        if should_dial and background_tasks is not None:
            background_tasks.add_task(
                auto_dial_lead,
                db=db,
                lead_id=lead_doc["id"],
                trigger="thumbtack_webhook",
                actor=actor,
                serialize_lead=serialize_lead,
                headers=headers,
            )
            dial_note = "Vapi auto-dial queued"
        elif should_dial:
            await auto_dial_lead(
                db=db,
                lead_id=lead_doc["id"],
                trigger="thumbtack_webhook",
                actor=actor,
                serialize_lead=serialize_lead,
                headers=headers,
            )
            dial_note = "Vapi auto-dial attempted"
        else:
            dial_note = "Vapi skipped (test lead)"
        await _log_thumbtack_webhook(
            payload=payload, headers=headers, status="created",
            thumbtack_lead_id=tt_id, lead_id=lead_doc["id"],
            detail=f"Lead created and converted to client + job. {dial_note}.",
        )
        _announce_thumbtack_result(
            "created", parsed, headers, actor,
            extra=(
                f"lead={lead_doc['id']} client={converted['client']['id']} "
                f"job={converted['job']['id']} ({dial_note})"
            ),
        )
        return {"status": "created", "thumbtack_lead_id": tt_id, "auto_dial": dial_note, **converted}


    @api_router.post("/webhooks/thumbtack")
    @api_router.post("/webhooks/thumbtack/", include_in_schema=False)
    async def thumbtack_webhook(request: Request, background_tasks: BackgroundTasks):
        """Public Thumbtack endpoint. Requires THUMBTACK_WEBHOOK_SECRET except on localhost.

        Paste this URL into Thumbtack after starting ngrok (`ngrok http 8001`):
            https://YOUR-NGROK-URL.ngrok-free.app/api/webhooks/thumbtack
        """
        try:
            headers = dict(request.headers)
            host = headers.get("host") or headers.get("Host") or "-"
            content_type = headers.get("content-type") or headers.get("Content-Type") or "-"
            secret_configured = bool(configured_webhook_secret())
            peer = request.client.host if request.client else ""
            secret_ok = webhook_authorized(headers, client_host=peer, http_host=host)
            logger.info(
                "Thumbtack webhook HIT host=%s path=%s content_type=%s secret_configured=%s secret_ok=%s public_url_format=%s",
                host, request.url.path, content_type, secret_configured, secret_ok, NGROK_WEBHOOK_URL_FORMAT,
            )
            if not secret_ok:
                logger.warning("Thumbtack webhook rejected: missing or invalid shared secret. host=%s", host)
                await _log_thumbtack_webhook(
                    payload={}, headers=headers, status="unauthorized",
                    detail="Invalid or missing webhook secret.",
                )
                raise HTTPException(status_code=401, detail="Invalid webhook secret.")
            try:
                payload = await request.json()
            except Exception:
                logger.warning("Thumbtack webhook received a non-JSON body. host=%s content_type=%s", host, content_type)
                await _log_thumbtack_webhook(
                    payload={}, headers=headers, status="error",
                    detail="Request body must be JSON.",
                )
                raise HTTPException(status_code=400, detail="Request body must be JSON.")
            if not isinstance(payload, dict):
                logger.warning("Thumbtack webhook body was JSON but not an object. host=%s", host)
                raise HTTPException(status_code=400, detail="Request body must be a JSON object.")
            return await _ingest_thumbtack_webhook(payload, headers, background_tasks=background_tasks)
        except HTTPException:
            raise
        except Exception:
            logger.exception("Thumbtack webhook failed unexpectedly.")
            raise HTTPException(status_code=500, detail="Could not process the Thumbtack webhook. Please try again.")


    @api_router.post("/webhooks/thumbtack/test")
    async def thumbtack_webhook_test(user: User = Depends(get_current_user)):
        """Logged-in helper: inject a sample Thumbtack lead through the same pipeline (no Vapi call)."""
        try:
            sample_id = f"TEST-TT-{uuid.uuid4().hex[:10]}"
            payload = {
                "eventType": "NegotiationCreatedV4",
                "negotiation": {
                    "negotiationID": sample_id,
                    "category": {"name": "Kitchen Remodel"},
                    "customer": {
                        "displayName": "Taylor Test",
                        "name": "Taylor Test",
                        "phone": "5125550199",
                        "email": "taylor.test@example.com",
                        "location": {
                            "address1": "100 Webhook Way",
                            "city": "Austin",
                            "state": "TX",
                            "zipCode": "78704",
                        },
                    },
                    "details": [
                        {"question": "Project scope", "answer": "Local webhook test — do not call the customer."},
                    ],
                },
            }
            logger.info("Thumbtack webhook test triggered by %s sample_id=%s", user.user_id, sample_id)
            result = await _ingest_thumbtack_webhook(payload, {"x-revival-test": "1"}, actor=f"test:{user.user_id}")
            return result
        except HTTPException:
            raise
        except Exception:
            logger.exception("Thumbtack webhook test failed user=%s", user.user_id)
            raise HTTPException(status_code=500, detail="Could not run the Thumbtack webhook test. Please try again.")


    @api_router.get("/webhooks/thumbtack/events")
    async def list_thumbtack_webhook_events(admin: User = Depends(require_admin), limit: int = 50):
        """Recent Thumbtack webhook deliveries for debugging. Admin only."""
        try:
            cap = max(1, min(int(limit or 50), 200))
            docs = await db.webhook_events.find(
                {"source": "thumbtack"},
                {"_id": 0, "payload": 1, "headers": 1, "status": 1, "thumbtack_lead_id": 1,
                 "lead_id": 1, "detail": 1, "event_type": 1, "received_at": 1, "id": 1},
            ).sort("received_at", -1).to_list(cap)
            out = []
            for d in docs:
                received = d.get("received_at")
                if hasattr(received, "isoformat"):
                    d["received_at"] = received.isoformat()
                out.append(d)
            return out
        except Exception:
            logger.exception("List Thumbtack webhook events failed")
            raise HTTPException(status_code=500, detail="Could not load webhook events. Please try again.")


    class OutboundCallRequest(BaseModel):
        phone: str
        name: str
        project_type: str = ""
        address: str = ""
        email: str = ""
        source: str = ""
        notes: str = ""
        lead_id: str = ""


    async def _place_and_record_call(payload: dict, user: User) -> dict:
        try:
            result = await place_outbound_call(payload)
        except ValueError as ex:
            raise HTTPException(status_code=400, detail=str(ex))
        except VapiConfigError as ex:
            raise HTTPException(status_code=503, detail=str(ex))
        except VapiRequestError as ex:
            raise HTTPException(status_code=ex.status_code, detail=str(ex))

        lead_id = (payload.get("lead_id") or "").strip()
        lead = {"id": lead_id, "phone": payload.get("phone"), "source": payload.get("source") or ""}
        if lead_id:
            existing = await db.leads.find_one({"id": lead_id}, {"_id": 0})
            if existing:
                lead = existing
        return await record_outbound_attempt(
            db=db,
            lead=lead,
            trigger="manual",
            actor=getattr(user, "user_id", None) or "user",
            serialize_lead=serialize_lead,
            result=result,
        )


    @api_router.post("/vapi/outbound-call")
    async def create_outbound_call(payload: OutboundCallRequest, user: User = Depends(get_current_user)):
        """Place a Vapi outbound call using Riley and the Revival caller ID."""
        try:
            data = payload.model_dump()
            logger.info(f"Outbound call requested name={data.get('name')!r} lead_id={data.get('lead_id') or '-'} user={user.user_id}")
            return await _place_and_record_call(data, user)
        except HTTPException:
            raise
        except Exception as ex:
            logger.error(f"Outbound call failed: {ex}")
            raise HTTPException(status_code=500, detail="Could not place the outbound call. Please try again.")


    @api_router.post("/leads/{lead_id}/call")
    async def call_lead(lead_id: str, user: User = Depends(get_current_user)):
        """Place a Vapi outbound call using the stored lead record."""
        try:
            lead = await db.leads.find_one({"id": lead_id}, {"_id": 0})
            if not lead:
                raise HTTPException(status_code=404, detail="Lead not found")
            payload = {
                "phone": lead.get("phone") or "",
                "name": lead.get("name") or "",
                "project_type": lead.get("project_type") or "",
                "address": lead.get("address") or "",
                "email": lead.get("email") or "",
                "source": lead.get("source") or "",
                "notes": lead.get("notes") or "",
                "lead_id": lead_id,
            }
            logger.info(f"Lead call requested lead_id={lead_id} user={user.user_id}")
            return await _place_and_record_call(payload, user)
        except HTTPException:
            raise
        except Exception as ex:
            logger.error(f"Lead call failed lead_id={lead_id}: {ex}")
            raise HTTPException(status_code=500, detail="Could not place the outbound call. Please try again.")

    def _marketplace_secret_ok(headers: dict, peer: str, host: str, env_name: str) -> bool:
        secret = (os.environ.get(env_name) or "").strip()
        if not secret:
            return is_loopback_request(client_host=peer, http_host=host)
        lowered = {str(k).lower(): v for k, v in (headers or {}).items()}
        for key in ("x-webhook-secret", "x-revival-webhook-secret", "authorization"):
            val = (lowered.get(key) or "").strip()
            if key == "authorization" and val.lower().startswith("bearer "):
                val = val[7:].strip()
            if val == secret:
                return True
        return False

    async def _ingest_marketplace_lead(
        *,
        parsed: dict,
        headers: dict,
        actor: str,
        background_tasks: BackgroundTasks,
        trigger: str,
        id_field: str,
    ):
        name = (parsed.get("name") or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="Lead name is required.")
        external_id = (parsed.get("external_id") or "").strip()
        if external_id:
            existing = await db.leads.find_one({id_field: external_id}, {"_id": 0})
            if existing:
                converted = await _convert_lead(existing["id"], actor=actor)
                return {"status": "duplicate", id_field: external_id, **converted}

        lead_kwargs = dict(
            name=name,
            phone=_safe_lead_phone(parsed.get("phone") or ""),
            email=parsed.get("email") or "",
            address=parsed.get("address") or "",
            project_type=parsed.get("project_type") or "Kitchen Remodel",
            source=parsed.get("source") or "Other",
            status="New",
            notes=parsed.get("notes") or "",
        )
        if external_id:
            lead_kwargs[id_field] = external_id
        lead_doc = Lead(**lead_kwargs).model_dump()
        await db.leads.insert_one(lead_doc)
        converted = await _convert_lead(lead_doc["id"], actor=actor)
        background_tasks.add_task(
            auto_dial_lead,
            db=db,
            lead_id=lead_doc["id"],
            trigger=trigger,
            actor=actor,
            serialize_lead=serialize_lead,
            headers=headers,
        )
        logger.info(
            "MARKETPLACE LEAD CREATED source=%s lead=%s trigger=%s",
            lead_doc.get("source"),
            lead_doc["id"],
            trigger,
        )
        return {"status": "created", id_field: external_id, "auto_dial": "queued", **converted}

    @api_router.post("/webhooks/google-ads")
    async def google_ads_webhook(request: Request, background_tasks: BackgroundTasks):
        try:
            headers = dict(request.headers)
            peer = request.client.host if request.client else ""
            host = headers.get("host") or ""
            if not _marketplace_secret_ok(headers, peer, host, "GOOGLE_ADS_WEBHOOK_SECRET"):
                raise HTTPException(status_code=401, detail="Invalid Google Ads webhook secret.")
            payload = await request.json()
            if not isinstance(payload, dict):
                raise HTTPException(status_code=400, detail="JSON object required.")
            parsed = parse_google_ads_payload(payload)
            return await _ingest_marketplace_lead(
                parsed=parsed,
                headers=headers,
                actor="google-ads-webhook",
                background_tasks=background_tasks,
                trigger="google_ads_webhook",
                id_field="google_ads_lead_id",
            )
        except HTTPException:
            raise
        except Exception:
            logger.exception("Google Ads webhook failed")
            raise HTTPException(status_code=500, detail="Could not process Google Ads lead.")

    @api_router.post("/webhooks/angi")
    async def angi_webhook(request: Request, background_tasks: BackgroundTasks):
        try:
            headers = dict(request.headers)
            peer = request.client.host if request.client else ""
            host = headers.get("host") or ""
            if not _marketplace_secret_ok(headers, peer, host, "ANGI_WEBHOOK_SECRET"):
                raise HTTPException(status_code=401, detail="Invalid Angi webhook secret.")
            payload = await request.json()
            if not isinstance(payload, dict):
                raise HTTPException(status_code=400, detail="JSON object required.")
            parsed = parse_angi_payload(payload)
            return await _ingest_marketplace_lead(
                parsed=parsed,
                headers=headers,
                actor="angi-webhook",
                background_tasks=background_tasks,
                trigger="angi_webhook",
                id_field="angi_lead_id",
            )
        except HTTPException:
            raise
        except Exception:
            logger.exception("Angi webhook failed")
            raise HTTPException(status_code=500, detail="Could not process Angi lead.")
