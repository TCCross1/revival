"""Pull Google Calendar events into Revival office calendar_events."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from google.auth.transport.requests import Request as GoogleRequest
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

from google_drive import (
    TOKEN_URI,
    oauth_client_id,
    oauth_client_secret,
    refreshed_token_fields,
)

logger = logging.getLogger(__name__)

CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly"
BASE_SCOPES = [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/drive.file",
    CALENDAR_SCOPE,
]


def calendar_scopes() -> list:
    return list(BASE_SCOPES)


def _ymd_from_google(value: dict) -> tuple:
    """Return (start_date, end_date) as YYYY-MM-DD. All-day end is exclusive in Google."""
    if not isinstance(value, dict):
        return "", ""
    start = value.get("start") or {}
    end = value.get("end") or {}
    start_day = (start.get("date") or "")[:10]
    end_day = (end.get("date") or "")[:10]
    if start_day:
        if end_day and end_day > start_day:
            try:
                d = datetime.strptime(end_day, "%Y-%m-%d") - timedelta(days=1)
                end_day = d.strftime("%Y-%m-%d")
            except Exception:
                end_day = start_day
        else:
            end_day = start_day
        return start_day, end_day

    start_dt = start.get("dateTime") or ""
    end_dt = end.get("dateTime") or ""
    try:
        s = datetime.fromisoformat(str(start_dt).replace("Z", "+00:00"))
        e = datetime.fromisoformat(str(end_dt).replace("Z", "+00:00")) if end_dt else s
        return s.date().isoformat(), e.date().isoformat()
    except Exception:
        return "", ""


def build_calendar_service(tokens: dict) -> tuple:
    expiry = None
    raw = (tokens or {}).get("token_expiry") or ""
    if raw:
        try:
            expiry = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
            if expiry.tzinfo is None:
                expiry = expiry.replace(tzinfo=timezone.utc)
            expiry = expiry.replace(tzinfo=None)
        except Exception:
            expiry = None
    creds = Credentials(
        token=(tokens or {}).get("access_token") or None,
        refresh_token=(tokens or {}).get("refresh_token") or None,
        token_uri=TOKEN_URI,
        client_id=oauth_client_id(),
        client_secret=oauth_client_secret(),
        scopes=calendar_scopes(),
        expiry=expiry,
    )
    refreshed = None
    try:
        if creds.refresh_token and (not creds.valid or creds.expired):
            creds.refresh(GoogleRequest())
            refreshed = refreshed_token_fields(creds)
    except Exception:
        logger.exception("Google Calendar token refresh failed")
        raise RuntimeError(
            "Google Calendar sign-in expired or is missing Calendar permission. "
            "Reconnect Google in Company Profile (Calendar access will be requested)."
        )
    service = build("calendar", "v3", credentials=creds, cache_discovery=False)
    return service, refreshed


def list_primary_events(service, time_min: str, time_max: str) -> list:
    items = []
    page_token = None
    while True:
        result = (
            service.events()
            .list(
                calendarId="primary",
                timeMin=time_min,
                timeMax=time_max,
                singleEvents=True,
                orderBy="startTime",
                maxResults=250,
                pageToken=page_token,
            )
            .execute()
        )
        items.extend(result.get("items") or [])
        page_token = result.get("nextPageToken")
        if not page_token:
            break
    return items


def google_event_to_office(event: dict) -> Optional[dict]:
    if not isinstance(event, dict):
        return None
    if event.get("status") == "cancelled":
        return None
    gid = str(event.get("id") or "").strip()
    if not gid:
        return None
    start_date, end_date = _ymd_from_google(event)
    if not start_date:
        return None
    title = str(event.get("summary") or "Google Calendar event").strip()[:200]
    notes_parts = [
        str(event.get("description") or "").strip(),
        f"Location: {event.get('location')}" if event.get("location") else "",
        "Synced from Google Calendar (Vapi / office Gmail).",
    ]
    return {
        "google_event_id": gid,
        "category": "consultation",
        "title": title or "Google Calendar event",
        "notes": "\n".join([p for p in notes_parts if p])[:4000],
        "start_date": start_date,
        "end_date": end_date or start_date,
        "recurrence": "none",
        "recurrence_until": None,
        "source": "google",
        "lead_id": None,
        "job_id": None,
    }
