"""Live floor-plan sync across iPhone and Mac/web.

Last-write-wins by monotonic revision. Tickets are short-lived and never logged.
"""
from __future__ import annotations

import logging
import secrets
import time
from typing import Optional

from fastapi import WebSocket

logger = logging.getLogger(__name__)

TICKET_TTL_SEC = 120
POLL_HINT_SEC = 4

_tickets: dict[str, dict] = {}


class PlanHub:
    def __init__(self):
        self._rooms: dict[str, set[WebSocket]] = {}

    async def connect(self, plan_id: str, ws: WebSocket) -> None:
        self._rooms.setdefault(plan_id, set()).add(ws)
        logger.info("Plan sync connected plan_id=%s listeners=%s", plan_id, len(self._rooms.get(plan_id) or []))

    def disconnect(self, plan_id: str, ws: WebSocket) -> None:
        room = self._rooms.get(plan_id)
        if not room:
            return
        room.discard(ws)
        if not room:
            self._rooms.pop(plan_id, None)
        logger.info("Plan sync disconnected plan_id=%s listeners=%s", plan_id, len(self._rooms.get(plan_id) or []))

    async def broadcast(self, plan_id: str, message: dict, exclude: Optional[WebSocket] = None) -> int:
        room = list(self._rooms.get(plan_id) or [])
        sent = 0
        for ws in room:
            if ws is exclude:
                continue
            try:
                await ws.send_json(message)
                sent += 1
            except Exception:
                logger.exception("Plan sync broadcast failed plan_id=%s", plan_id)
                self.disconnect(plan_id, ws)
        if sent:
            logger.info("Plan sync broadcast plan_id=%s revision=%s listeners=%s", plan_id, message.get("revision"), sent)
        return sent


hub = PlanHub()


def next_revision(plan: dict) -> int:
    try:
        current = int(plan.get("revision") or 0)
    except (TypeError, ValueError):
        current = 0
    return current + 1


def should_apply_remote(local_revision: int, remote_revision: int, local_dirty: bool) -> bool:
    """Last-write-wins: apply a newer server revision only when this device has no unsaved edits."""
    try:
        local = int(local_revision or 0)
        remote = int(remote_revision or 0)
    except (TypeError, ValueError):
        return False
    if remote <= local:
        return False
    if local_dirty:
        return False
    return True


def issue_ticket(user_id: str, plan_id: str) -> dict:
    _purge_tickets()
    ticket = secrets.token_urlsafe(32)
    _tickets[ticket] = {
        "user_id": user_id,
        "plan_id": plan_id,
        "exp": time.time() + TICKET_TTL_SEC,
    }
    return {"ticket": ticket, "expires_in": TICKET_TTL_SEC}


def read_ticket(ticket: str, plan_id: str) -> Optional[dict]:
    if not ticket:
        return None
    rec = _tickets.get(ticket)
    if not rec:
        return None
    if rec.get("exp", 0) < time.time():
        _tickets.pop(ticket, None)
        return None
    if rec.get("plan_id") != plan_id:
        return None
    return rec


def _purge_tickets() -> None:
    now = time.time()
    stale = [key for key, rec in _tickets.items() if rec.get("exp", 0) < now]
    for key in stale:
        _tickets.pop(key, None)


def sync_payload(plan: dict, origin: str = "") -> dict:
    return {
        "type": "plan",
        "plan_id": plan.get("id"),
        "revision": int(plan.get("revision") or 0),
        "updated_at": plan.get("updated_at") or "",
        "origin": origin or "",
        "document": plan.get("document") or {},
        "meta": {
            "name": plan.get("name") or "Floor plan",
            "client_id": plan.get("client_id") or "",
            "client_name": plan.get("client_name") or "",
            "job_id": plan.get("job_id") or "",
            "address": plan.get("address") or "",
            "project_type": plan.get("project_type") or "Kitchen",
            "version_kind": plan.get("version_kind") or "existing",
        },
    }
