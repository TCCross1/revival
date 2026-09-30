"""Office calendar events (consultations, jobs, reminders, time off, etc.)."""
import logging
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

CATEGORIES = {
    "consultation",
    "job",
    "reminder",
    "todo",
    "time_off",
    "custom",
}

RECURRENCE = {"none", "daily", "monthly", "yearly"}


class CalendarEventCreate(BaseModel):
    category: str
    title: str
    notes: str = ""
    start_date: str
    end_date: str
    recurrence: str = "none"
    recurrence_until: Optional[str] = None
    lead_id: Optional[str] = None
    job_id: Optional[str] = None
    source: str = "manual"


class CalendarEventUpdate(BaseModel):
    category: Optional[str] = None
    title: Optional[str] = None
    notes: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    recurrence: Optional[str] = None
    recurrence_until: Optional[str] = None
    lead_id: Optional[str] = None
    job_id: Optional[str] = None


class CalendarEvent(BaseModel):
    id: str
    category: str
    title: str
    notes: str = ""
    start_date: str
    end_date: str
    recurrence: str = "none"
    recurrence_until: Optional[str] = None
    lead_id: Optional[str] = None
    job_id: Optional[str] = None
    source: str = "manual"
    google_event_id: Optional[str] = None
    created_by: Optional[str] = None
    created_at: str
    updated_at: str


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _valid_ymd(value: str) -> bool:
    try:
        datetime.strptime((value or "").strip()[:10], "%Y-%m-%d")
        return True
    except Exception:
        return False


def attach_calendar_routes(api_router: APIRouter):
    from server import User, assert_user_feature, db, get_current_user

    def _normalize(payload: dict) -> dict:
        category = str(payload.get("category") or "").strip().lower()
        if category not in CATEGORIES:
            raise HTTPException(status_code=400, detail="Choose a valid calendar category.")
        title = str(payload.get("title") or "").strip()
        if not title:
            raise HTTPException(status_code=400, detail="A title is required.")
        start = str(payload.get("start_date") or "").strip()[:10]
        end = str(payload.get("end_date") or start).strip()[:10]
        if not _valid_ymd(start) or not _valid_ymd(end):
            raise HTTPException(status_code=400, detail="Use dates like 2026-10-15.")
        if end < start:
            raise HTTPException(status_code=400, detail="End date must be on or after the start date.")
        recurrence = str(payload.get("recurrence") or "none").strip().lower()
        if recurrence not in RECURRENCE:
            raise HTTPException(status_code=400, detail="Recurrence must be none, daily, monthly, or yearly.")
        until_raw = payload.get("recurrence_until")
        until = str(until_raw).strip()[:10] if until_raw else None
        if until and not _valid_ymd(until):
            raise HTTPException(status_code=400, detail="Recurrence end date is invalid.")
        if until and until < start:
            raise HTTPException(status_code=400, detail="Recurrence end must be on or after the start date.")
        if recurrence == "none":
            until = None
        return {
            "category": category,
            "title": title[:200],
            "notes": str(payload.get("notes") or "")[:4000],
            "start_date": start,
            "end_date": end,
            "recurrence": recurrence,
            "recurrence_until": until,
            "lead_id": (payload.get("lead_id") or None),
            "job_id": (payload.get("job_id") or None),
            "source": str(payload.get("source") or "manual")[:40],
            "google_event_id": (payload.get("google_event_id") or None),
        }

    def _to_event(doc: dict) -> CalendarEvent:
        data = {
            **doc,
            "recurrence": doc.get("recurrence") or "none",
            "recurrence_until": doc.get("recurrence_until"),
            "notes": doc.get("notes") or "",
            "source": doc.get("source") or "manual",
        }
        return CalendarEvent(**{k: v for k, v in data.items() if k != "_id"})

    @api_router.get("/calendar/events", response_model=List[CalendarEvent])
    async def list_calendar_events(
        start: Optional[str] = None,
        end: Optional[str] = None,
        user: User = Depends(get_current_user),
    ):
        try:
            await assert_user_feature(user, "calendar")
            query = {}
            if start and end and _valid_ymd(start) and _valid_ymd(end):
                # Include one-off overlaps plus recurring masters that may expand into the window.
                query = {
                    "$or": [
                        {"start_date": {"$lte": end[:10]}, "end_date": {"$gte": start[:10]}},
                        {"recurrence": {"$in": ["daily", "monthly", "yearly"]}, "start_date": {"$lte": end[:10]}},
                    ]
                }
            docs = await db.calendar_events.find(query, {"_id": 0}).sort("start_date", 1).to_list(5000)
            return [_to_event(d) for d in docs]
        except HTTPException:
            raise
        except Exception:
            logger.exception("Failed to list calendar events")
            raise HTTPException(status_code=503, detail="Could not load calendar events.")

    @api_router.post("/calendar/events", response_model=CalendarEvent)
    async def create_calendar_event(body: CalendarEventCreate, user: User = Depends(get_current_user)):
        try:
            await assert_user_feature(user, "calendar")
            data = _normalize(body.model_dump())
            now = _now()
            doc = {
                "id": f"cevt_{uuid.uuid4().hex[:12]}",
                **data,
                "created_by": getattr(user, "user_id", None) or getattr(user, "id", None),
                "created_at": now,
                "updated_at": now,
            }
            await db.calendar_events.insert_one(doc)
            logger.info(
                "Calendar event created id=%s category=%s recurrence=%s start=%s",
                doc["id"],
                doc["category"],
                doc["recurrence"],
                doc["start_date"],
            )
            return _to_event(doc)
        except HTTPException:
            raise
        except Exception:
            logger.exception("Failed to create calendar event")
            raise HTTPException(status_code=503, detail="Could not save the calendar event.")

    @api_router.put("/calendar/events/{event_id}", response_model=CalendarEvent)
    async def update_calendar_event(
        event_id: str,
        body: CalendarEventUpdate,
        user: User = Depends(get_current_user),
    ):
        try:
            await assert_user_feature(user, "calendar")
            existing = await db.calendar_events.find_one({"id": event_id}, {"_id": 0})
            if not existing:
                raise HTTPException(status_code=404, detail="Calendar event not found.")
            patch = {k: v for k, v in body.model_dump().items() if v is not None}
            # Allow clearing recurrence_until explicitly with empty string → None via normalize
            if "recurrence_until" in body.model_dump() and body.recurrence_until is None and "recurrence_until" in patch:
                pass
            merged = {**existing, **patch}
            data = _normalize(merged)
            data["updated_at"] = _now()
            await db.calendar_events.update_one({"id": event_id}, {"$set": data})
            fresh = await db.calendar_events.find_one({"id": event_id}, {"_id": 0})
            logger.info("Calendar event updated id=%s", event_id)
            return _to_event(fresh)
        except HTTPException:
            raise
        except Exception:
            logger.exception("Failed to update calendar event %s", event_id)
            raise HTTPException(status_code=503, detail="Could not update the calendar event.")

    @api_router.delete("/calendar/events/{event_id}")
    async def delete_calendar_event(event_id: str, user: User = Depends(get_current_user)):
        try:
            await assert_user_feature(user, "calendar")
            result = await db.calendar_events.delete_one({"id": event_id})
            if result.deleted_count == 0:
                raise HTTPException(status_code=404, detail="Calendar event not found.")
            logger.info("Calendar event deleted id=%s", event_id)
            return {"success": True}
        except HTTPException:
            raise
        except Exception:
            logger.exception("Failed to delete calendar event %s", event_id)
            raise HTTPException(status_code=503, detail="Could not delete the calendar event.")

    @api_router.post("/calendar/sync-google")
    async def sync_google_calendar(user: User = Depends(get_current_user)):
        """Pull primary Google Calendar (Vapi Gmail) into office calendar_events."""
        try:
            await assert_user_feature(user, "calendar")
            from datetime import timedelta, timezone
            from server import load_drive_settings, save_drive_settings, tokens_from_settings
            from google_calendar_sync import build_calendar_service, google_event_to_office, list_primary_events

            doc = await load_drive_settings()
            tokens = tokens_from_settings(doc)
            if not tokens.get("refresh_token") and not tokens.get("access_token"):
                raise HTTPException(
                    status_code=400,
                    detail="Connect Google in Company Profile first (Calendar permission required).",
                )
            service, refreshed = build_calendar_service(tokens)
            if refreshed:
                await save_drive_settings(refreshed)

            now = datetime.now(timezone.utc)
            time_min = (now - timedelta(days=30)).isoformat().replace("+00:00", "Z")
            time_max = (now + timedelta(days=120)).isoformat().replace("+00:00", "Z")
            items = list_primary_events(service, time_min, time_max)
            created = 0
            updated = 0
            for item in items:
                mapped = google_event_to_office(item)
                if not mapped:
                    continue
                gid = mapped["google_event_id"]
                existing = await db.calendar_events.find_one({"google_event_id": gid}, {"_id": 0})
                now_s = _now()
                if existing:
                    patch = {
                        "title": mapped["title"],
                        "notes": mapped["notes"],
                        "start_date": mapped["start_date"],
                        "end_date": mapped["end_date"],
                        "category": mapped["category"],
                        "source": "google",
                        "updated_at": now_s,
                    }
                    await db.calendar_events.update_one({"id": existing["id"]}, {"$set": patch})
                    updated += 1
                else:
                    doc = {
                        "id": f"cevt_{uuid.uuid4().hex[:12]}",
                        **mapped,
                        "created_by": getattr(user, "user_id", None),
                        "created_at": now_s,
                        "updated_at": now_s,
                    }
                    await db.calendar_events.insert_one(doc)
                    created += 1
            logger.info(
                "Google Calendar sync user=%s fetched=%s created=%s updated=%s",
                user.user_id,
                len(items),
                created,
                updated,
            )
            return {"fetched": len(items), "created": created, "updated": updated}
        except HTTPException:
            raise
        except RuntimeError as ex:
            raise HTTPException(status_code=400, detail=str(ex))
        except Exception:
            logger.exception("Google Calendar sync failed")
            raise HTTPException(status_code=503, detail="Could not sync Google Calendar.")
