"""Field & crew API routes. Attached from server.py after models exist."""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from field_ops import (
    ALL_FEATURES,
    DEFAULT_MILEAGE_RATE,
    FEATURES,
    ROLE_LABELS,
    ROLES,
    can,
    inside_geofence,
    job_visible_to,
    labor_amount,
    merge_matrix,
    miles_between,
    minutes_between,
    normalize_geofence,
    normalize_role,
)
from job_sheet import normalize_sheet_category

logger = logging.getLogger(__name__)


class RoleUpdate(BaseModel):
    role: str
    hourly_rate: float | None = None


class PermissionMatrixIn(BaseModel):
    roles: dict = {}
    mileage_rate: float | None = None


class GeofenceIn(BaseModel):
    lat: float
    lng: float
    radius_m: float = 150
    label: str = ""


class CrewIn(BaseModel):
    crew_ids: list[str] = []


class ClockIn(BaseModel):
    job_id: str
    lat: float | None = None
    lng: float | None = None
    notes: str = ""
    source: str = "manual"


class ClockOut(BaseModel):
    lat: float | None = None
    lng: float | None = None
    notes: str = ""


class MileageStart(BaseModel):
    job_id: str = ""
    purpose: str = "job"
    lat: float
    lng: float
    notes: str = ""


class MileageStop(BaseModel):
    lat: float
    lng: float
    notes: str = ""


class MileageManual(BaseModel):
    job_id: str = ""
    purpose: str = "business"
    miles: float
    date: str = ""
    notes: str = ""
    start_label: str = ""
    end_label: str = ""


class LogIn(BaseModel):
    text: str = ""


class MaterialIn(BaseModel):
    item: str
    quantity: str = "1"
    notes: str = ""
    needed_by: str = ""


class MaterialStatusIn(BaseModel):
    status: str


class TaskIn(BaseModel):
    title: str
    assigned_to: str = ""


class TaskStatusIn(BaseModel):
    status: str


class ShiftIn(BaseModel):
    job_id: str
    user_id: str
    date: str
    start: str = "07:00"
    end: str = "16:00"
    notes: str = ""


def attach_field_routes(api_router: APIRouter):
    from server import (
        Expense,
        Job,
        User,
        db,
        get_current_user,
        maybe_save_drive_file,
        new_id,
        now_iso,
        push_job_docs_to_drive,
        read_drive_upload,
        require_admin,
        resolve_client_for_job,
    )

    async def load_perm_settings() -> dict:
        doc = await db.settings.find_one({"key": "permissions"}, {"_id": 0}) or {}
        return {
            "roles": merge_matrix(doc),
            "mileage_rate": float(doc.get("mileage_rate") or DEFAULT_MILEAGE_RATE),
        }

    async def user_can(user: User, feature: str) -> bool:
        settings = await load_perm_settings()
        return can(user.role, feature, settings["roles"])

    async def require_feature(feature: str):
        async def _inner(user: User = Depends(get_current_user)):
            if not await user_can(user, feature):
                raise HTTPException(status_code=403, detail="You do not have access to that.")
            return user
        return _inner

    async def assert_feature(user: User, feature: str):
        if not await user_can(user, feature):
            raise HTTPException(status_code=403, detail="You do not have access to that.")

    async def get_job_or_404(job_id: str, user: User, feature: str = "jobs"):
        await assert_feature(user, feature)
        job = await db.jobs.find_one({"id": job_id}, {"_id": 0})
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        if not job_visible_to(user.user_id, user.role, job):
            raise HTTPException(status_code=403, detail="That job is not assigned to you.")
        return job

    async def notify_office(kind: str, title: str, body: str, job_id: str = "", source_user: str = ""):
        try:
            settings = await load_perm_settings()
            users = await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(500)
            rows = []
            for person in users:
                role = normalize_role(person.get("role"))
                if role == "field":
                    continue
                if person.get("user_id") == source_user:
                    continue
                if not can(role, "notifications", settings["roles"]) and role != "admin":
                    continue
                rows.append({
                    "id": new_id(),
                    "user_id": person.get("user_id"),
                    "kind": kind,
                    "title": title,
                    "body": body,
                    "job_id": job_id,
                    "read": False,
                    "created_at": now_iso(),
                })
            if rows:
                await db.notifications.insert_many(rows)
        except Exception:
            logger.exception("Field notification failed kind=%s", kind)

    def public_user(doc: dict) -> dict:
        return {
            "user_id": doc.get("user_id"),
            "name": doc.get("name") or "",
            "email": doc.get("email") or "",
            "role": normalize_role(doc.get("role")),
            "role_label": ROLE_LABELS.get(normalize_role(doc.get("role")), "Team"),
            "hourly_rate": float(doc.get("hourly_rate") or 0),
            "picture": doc.get("picture") or "",
        }

    @api_router.get("/field/me")
    async def field_me(user: User = Depends(get_current_user)):
        try:
            settings = await load_perm_settings()
            role = normalize_role(user.role)
            perms = settings["roles"].get(role) or {}
            if role == "admin":
                perms = {key: True for key in ALL_FEATURES}
            open_clock = await db.time_entries.find_one(
                {"user_id": user.user_id, "clock_out": ""},
                {"_id": 0},
            )
            active_trip = await db.mileage_trips.find_one(
                {"user_id": user.user_id, "ended_at": ""},
                {"_id": 0},
            )
            unread = await db.notifications.count_documents({"user_id": user.user_id, "read": False})
            stored = await db.users.find_one({"user_id": user.user_id}, {"_id": 0}) or {}
            return {
                "user_id": user.user_id,
                "name": user.name,
                "email": user.email,
                "role": role,
                "role_label": ROLE_LABELS.get(role, "Team"),
                "hourly_rate": float(stored.get("hourly_rate") or 0),
                "permissions": perms,
                "features": FEATURES,
                "open_clock": open_clock,
                "active_trip": active_trip,
                "unread": unread,
                "mileage_rate": settings["mileage_rate"],
            }
        except Exception:
            logger.exception("field/me failed user=%s", user.user_id)
            raise HTTPException(status_code=500, detail="Could not load field access. Please try again.")

    @api_router.get("/permissions/matrix")
    async def get_permission_matrix(admin: User = Depends(require_admin)):
        settings = await load_perm_settings()
        return {
            "roles": settings["roles"],
            "features": FEATURES,
            "role_labels": {k: ROLE_LABELS[k] for k in ROLES},
            "mileage_rate": settings["mileage_rate"],
        }

    @api_router.put("/permissions/matrix")
    async def save_permission_matrix(payload: PermissionMatrixIn, admin: User = Depends(require_admin)):
        try:
            roles = merge_matrix({"roles": payload.roles})
            rate = DEFAULT_MILEAGE_RATE
            if payload.mileage_rate is not None:
                rate = max(0.0, min(float(payload.mileage_rate), 5.0))
            else:
                existing = await db.settings.find_one({"key": "permissions"}, {"_id": 0}) or {}
                rate = float(existing.get("mileage_rate") or DEFAULT_MILEAGE_RATE)
            await db.settings.update_one(
                {"key": "permissions"},
                {"$set": {"key": "permissions", "roles": roles, "mileage_rate": rate, "updated_at": now_iso()}},
                upsert=True,
            )
            logger.info("Permission matrix updated by %s", admin.user_id)
            return {"roles": roles, "features": FEATURES, "role_labels": {k: ROLE_LABELS[k] for k in ROLES}, "mileage_rate": rate}
        except HTTPException:
            raise
        except Exception:
            logger.exception("Save permission matrix failed")
            raise HTTPException(status_code=500, detail="Could not save permissions. Please try again.")

    @api_router.put("/team/{user_id}/role")
    async def set_team_role(user_id: str, payload: RoleUpdate, admin: User = Depends(require_admin)):
        try:
            role = normalize_role(payload.role)
            if role not in ROLES:
                raise HTTPException(status_code=400, detail="Choose Owner, Project Manager, or Field Worker.")
            if user_id == admin.user_id and role != "admin":
                raise HTTPException(status_code=400, detail="You cannot remove your own owner access.")
            updates = {"role": role}
            if payload.hourly_rate is not None:
                updates["hourly_rate"] = max(0.0, float(payload.hourly_rate))
            res = await db.users.update_one({"user_id": user_id}, {"$set": updates})
            if res.matched_count == 0:
                raise HTTPException(status_code=404, detail="Teammate not found")
            logger.info("Set role user=%s role=%s by=%s", user_id, role, admin.user_id)
            return {"user_id": user_id, **updates, "role_label": ROLE_LABELS[role]}
        except HTTPException:
            raise
        except Exception:
            logger.exception("Set team role failed user_id=%s", user_id)
            raise HTTPException(status_code=500, detail="Could not update that teammate. Please try again.")

    @api_router.get("/field/jobs")
    async def field_jobs(user: User = Depends(get_current_user)):
        await assert_feature(user, "jobs")
        docs = await db.jobs.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
        visible = [d for d in docs if job_visible_to(user.user_id, user.role, d)]
        today = datetime.now(timezone.utc).date().isoformat()
        out = []
        for job in visible:
            tasks = await db.job_tasks.find({"job_id": job["id"]}, {"_id": 0}).to_list(100)
            shifts = await db.crew_shifts.find({"job_id": job["id"], "date": today}, {"_id": 0}).to_list(20)
            out.append({
                "id": job.get("id"),
                "job_number": job.get("job_number"),
                "name": job.get("name"),
                "client_name": job.get("client_name"),
                "status": job.get("status"),
                "geofence": job.get("geofence") or {},
                "crew_ids": job.get("crew_ids") or [],
                "open_tasks": len([t for t in tasks if t.get("status") != "done"]),
                "today_shift": next((s for s in shifts if s.get("user_id") == user.user_id), None),
            })
        return out

    @api_router.put("/jobs/{job_id}/crew")
    async def set_job_crew(job_id: str, payload: CrewIn, user: User = Depends(get_current_user)):
        if normalize_role(user.role) == "field":
            raise HTTPException(status_code=403, detail="Ask a project manager to assign the crew.")
        job = await db.jobs.find_one({"id": job_id}, {"_id": 0})
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        ids = [str(i) for i in (payload.crew_ids or []) if i]
        await db.jobs.update_one({"id": job_id}, {"$set": {"crew_ids": ids}})
        logger.info("Updated crew job=%s count=%s user=%s", job_id, len(ids), user.user_id)
        job["crew_ids"] = ids
        return Job(**job)

    @api_router.put("/jobs/{job_id}/geofence")
    async def set_job_geofence(job_id: str, payload: GeofenceIn, user: User = Depends(get_current_user)):
        if normalize_role(user.role) == "field":
            raise HTTPException(status_code=403, detail="Ask a project manager to set the job-site fence.")
        job = await db.jobs.find_one({"id": job_id}, {"_id": 0})
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        fence = normalize_geofence(payload.model_dump())
        if not fence:
            raise HTTPException(status_code=400, detail="Drop a pin or use the phone’s location for this job site.")
        await db.jobs.update_one({"id": job_id}, {"$set": {"geofence": fence}})
        logger.info("Set geofence job=%s user=%s", job_id, user.user_id)
        job["geofence"] = fence
        return {"job_id": job_id, "geofence": fence}

    @api_router.post("/field/receipts")
    async def capture_receipt(
        background: BackgroundTasks,
        job_id: str = Form(...),
        category: str = Form("Materials"),
        amount: str = Form(...),
        notes: str = Form(""),
        photo: UploadFile = File(...),
        user: User = Depends(get_current_user),
    ):
        try:
            job = await get_job_or_404(job_id, user, "receipts")
            try:
                dollars = float(amount)
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail="Enter the receipt total.")
            if dollars <= 0:
                raise HTTPException(status_code=400, detail="Receipt total must be greater than zero.")
            filename, mime, content = await read_drive_upload(photo)
            if not str(mime).startswith("image/"):
                raise HTTPException(status_code=400, detail="Take or choose a photo of the receipt.")
            note = (notes or "").strip()
            cat = normalize_sheet_category(category)
            exp = Expense(
                category=cat,
                description=note or f"{cat} receipt",
                amount=round(dollars, 2),
                kind="actual",
                notes=note,
                created_by=user.user_id,
                created_by_name=user.name,
            ).model_dump()
            sheet = await db.job_sheets.find_one({"job_id": job_id}, {"_id": 0})
            client = await resolve_client_for_job(job, sheet)
            saved = None
            if client:
                try:
                    labeled = f"Receipt {job.get('job_number') or 'job'} {datetime.now(timezone.utc).strftime('%Y%m%d-%H%M')} {filename}"
                    saved = await maybe_save_drive_file(
                        client,
                        "receipt",
                        exp["id"],
                        labeled,
                        content,
                        mime_type=mime,
                        job_id=job_id,
                        strict=False,
                    )
                except Exception:
                    logger.exception("Receipt Drive save failed job_id=%s", job_id)
            if saved:
                exp["receipt_url"] = saved.get("web_view_link") or ""
                exp["receipt_drive_file_id"] = saved.get("google_drive_file_id") or ""
            job.setdefault("expenses", []).append(exp)
            await db.jobs.update_one({"id": job_id}, {"$set": {"expenses": job["expenses"]}})
            background.add_task(push_job_docs_to_drive, job)
            await notify_office(
                "receipt",
                f"Receipt · {job.get('job_number') or 'Job'}",
                f"{user.name} logged ${dollars:.2f} {cat.lower()} — {note or 'no note'}.",
                job_id=job_id,
                source_user=user.user_id,
            )
            logger.info("Field receipt job=%s amount=%s user=%s", job_id, dollars, user.user_id)
            return {"expense": exp, "job_id": job_id, "drive": saved or {}}
        except HTTPException:
            raise
        except Exception:
            logger.exception("Field receipt failed job_id=%s", job_id)
            raise HTTPException(status_code=500, detail="Could not save that receipt. Please try again.")

    @api_router.get("/field/time/status")
    async def time_status(user: User = Depends(get_current_user)):
        await assert_feature(user, "time_clock")
        open_clock = await db.time_entries.find_one({"user_id": user.user_id, "clock_out": ""}, {"_id": 0})
        job = None
        fence = {}
        if open_clock:
            job = await db.jobs.find_one({"id": open_clock.get("job_id")}, {"_id": 0})
            fence = (job or {}).get("geofence") or {}
        return {"open": open_clock, "job": {"id": (job or {}).get("id"), "name": (job or {}).get("name"), "job_number": (job or {}).get("job_number")} if job else None, "geofence": fence}

    @api_router.post("/field/time/clock-in")
    async def clock_in(payload: ClockIn, user: User = Depends(get_current_user)):
        try:
            job = await get_job_or_404(payload.job_id, user, "time_clock")
            existing = await db.time_entries.find_one({"user_id": user.user_id, "clock_out": ""}, {"_id": 0})
            if existing:
                raise HTTPException(status_code=400, detail="You are already clocked in. Clock out first.")
            fence = inside_geofence(job.get("geofence"), payload.lat, payload.lng)
            if fence["configured"] and payload.lat is not None and not fence["inside"] and payload.source == "auto":
                raise HTTPException(status_code=400, detail="You are outside the job-site fence.")
            entry = {
                "id": new_id(),
                "user_id": user.user_id,
                "user_name": user.name,
                "job_id": job["id"],
                "job_number": job.get("job_number") or "",
                "job_name": job.get("name") or "",
                "clock_in": now_iso(),
                "clock_out": "",
                "minutes": 0.0,
                "lat_in": payload.lat,
                "lng_in": payload.lng,
                "lat_out": None,
                "lng_out": None,
                "source": payload.source if payload.source in ("auto", "manual") else "manual",
                "notes": (payload.notes or "").strip(),
                "inside_geofence": fence.get("inside"),
                "distance_m": fence.get("distance_m"),
                "labor_expense_id": "",
                "created_at": now_iso(),
            }
            await db.time_entries.insert_one(entry)
            await notify_office(
                "clock_in",
                f"Clock in · {job.get('job_number') or 'Job'}",
                f"{user.name} clocked in at {job.get('name') or 'the job'}.",
                job_id=job["id"],
                source_user=user.user_id,
            )
            logger.info("Clock in job=%s user=%s source=%s", job["id"], user.user_id, entry["source"])
            entry.pop("_id", None)
            return {"entry": entry, "geofence": fence}
        except HTTPException:
            raise
        except Exception:
            logger.exception("Clock in failed user=%s", user.user_id)
            raise HTTPException(status_code=500, detail="Could not clock in. Please try again.")

    @api_router.post("/field/time/clock-out")
    async def clock_out(payload: ClockOut, background: BackgroundTasks, user: User = Depends(get_current_user)):
        try:
            await assert_feature(user, "time_clock")
            entry = await db.time_entries.find_one({"user_id": user.user_id, "clock_out": ""}, {"_id": 0})
            if not entry:
                raise HTTPException(status_code=400, detail="You are not clocked in.")
            ended = now_iso()
            mins = minutes_between(entry.get("clock_in"), ended)
            stored = await db.users.find_one({"user_id": user.user_id}, {"_id": 0}) or {}
            rate = float(stored.get("hourly_rate") or 0)
            amount = labor_amount(mins, rate)
            job = await db.jobs.find_one({"id": entry.get("job_id")}, {"_id": 0})
            fence = inside_geofence((job or {}).get("geofence"), payload.lat, payload.lng)
            labor_id = ""
            if job and amount > 0:
                exp = Expense(
                    category="Labor",
                    description=f"Time clock — {user.name} — {round(mins / 60.0, 2)} hrs",
                    amount=amount,
                    kind="actual",
                    notes=(payload.notes or "").strip(),
                    created_by=user.user_id,
                    created_by_name=user.name,
                ).model_dump()
                labor_id = exp["id"]
                job.setdefault("expenses", []).append(exp)
                await db.jobs.update_one({"id": job["id"]}, {"$set": {"expenses": job["expenses"]}})
                background.add_task(push_job_docs_to_drive, job)
            updates = {
                "clock_out": ended,
                "minutes": mins,
                "lat_out": payload.lat,
                "lng_out": payload.lng,
                "notes": ((entry.get("notes") or "") + ((" · " + payload.notes) if payload.notes else "")).strip(" ·"),
                "labor_expense_id": labor_id,
                "outside_on_out": fence.get("configured") and not fence.get("inside"),
            }
            await db.time_entries.update_one({"id": entry["id"]}, {"$set": updates})
            await notify_office(
                "clock_out",
                f"Clock out · {entry.get('job_number') or 'Job'}",
                f"{user.name} clocked out after {round(mins / 60.0, 2)} hours.",
                job_id=entry.get("job_id") or "",
                source_user=user.user_id,
            )
            logger.info("Clock out entry=%s minutes=%s labor=%s user=%s", entry["id"], mins, amount, user.user_id)
            return {"entry": {**entry, **updates}, "labor_amount": amount, "geofence": fence}
        except HTTPException:
            raise
        except Exception:
            logger.exception("Clock out failed user=%s", user.user_id)
            raise HTTPException(status_code=500, detail="Could not clock out. Please try again.")

    @api_router.get("/field/time/entries")
    async def list_time_entries(job_id: str = "", user: User = Depends(get_current_user)):
        await assert_feature(user, "time_clock")
        query = {}
        if normalize_role(user.role) == "field":
            query["user_id"] = user.user_id
        if job_id:
            query["job_id"] = job_id
            if job_id:
                await get_job_or_404(job_id, user, "time_clock")
        docs = await db.time_entries.find(query, {"_id": 0}).sort("clock_in", -1).to_list(400)
        return docs

    @api_router.get("/field/mileage")
    async def list_mileage(year: int = 0, user: User = Depends(get_current_user)):
        await assert_feature(user, "mileage")
        query = {}
        if normalize_role(user.role) == "field":
            query["user_id"] = user.user_id
        docs = await db.mileage_trips.find(query, {"_id": 0}).sort("started_at", -1).to_list(800)
        if year:
            docs = [d for d in docs if str(d.get("started_at") or "").startswith(str(year))]
        return docs

    @api_router.get("/field/mileage/report")
    async def mileage_report(year: int = 0, user: User = Depends(get_current_user)):
        await assert_feature(user, "mileage")
        settings = await load_perm_settings()
        y = year or datetime.now(timezone.utc).year
        query = {}
        if normalize_role(user.role) == "field":
            query["user_id"] = user.user_id
        docs = await db.mileage_trips.find(query, {"_id": 0}).to_list(2000)
        rows = [d for d in docs if str(d.get("started_at") or d.get("date") or "").startswith(str(y)) and d.get("ended_at") != ""]
        job_miles = round(sum(float(d.get("miles") or 0) for d in rows if d.get("purpose") == "job"), 2)
        business_miles = round(sum(float(d.get("miles") or 0) for d in rows if d.get("purpose") != "job"), 2)
        total = round(job_miles + business_miles, 2)
        rate = settings["mileage_rate"]
        return {
            "year": y,
            "trips": len(rows),
            "job_miles": job_miles,
            "business_miles": business_miles,
            "total_miles": total,
            "rate": rate,
            "deduction": round(total * rate, 2),
            "entries": rows,
        }

    @api_router.post("/field/mileage/start")
    async def mileage_start(payload: MileageStart, user: User = Depends(get_current_user)):
        try:
            await assert_feature(user, "mileage")
            open_trip = await db.mileage_trips.find_one({"user_id": user.user_id, "ended_at": ""}, {"_id": 0})
            if open_trip:
                raise HTTPException(status_code=400, detail="You already have a trip running. Stop it first.")
            job = None
            if payload.job_id:
                job = await get_job_or_404(payload.job_id, user, "mileage")
            purpose = "job" if payload.job_id else ("business" if payload.purpose != "job" else "business")
            trip = {
                "id": new_id(),
                "user_id": user.user_id,
                "user_name": user.name,
                "job_id": (job or {}).get("id") or "",
                "job_name": (job or {}).get("name") or "",
                "purpose": purpose,
                "start_lat": payload.lat,
                "start_lng": payload.lng,
                "end_lat": None,
                "end_lng": None,
                "miles": 0.0,
                "started_at": now_iso(),
                "ended_at": "",
                "notes": (payload.notes or "").strip(),
                "created_at": now_iso(),
            }
            await db.mileage_trips.insert_one(trip)
            trip.pop("_id", None)
            logger.info("Mileage start user=%s job=%s", user.user_id, trip["job_id"])
            return trip
        except HTTPException:
            raise
        except Exception:
            logger.exception("Mileage start failed user=%s", user.user_id)
            raise HTTPException(status_code=500, detail="Could not start that trip. Please try again.")

    @api_router.post("/field/mileage/stop")
    async def mileage_stop(payload: MileageStop, user: User = Depends(get_current_user)):
        try:
            await assert_feature(user, "mileage")
            trip = await db.mileage_trips.find_one({"user_id": user.user_id, "ended_at": ""}, {"_id": 0})
            if not trip:
                raise HTTPException(status_code=400, detail="No trip is running.")
            miles = miles_between(trip.get("start_lat"), trip.get("start_lng"), payload.lat, payload.lng)
            updates = {
                "end_lat": payload.lat,
                "end_lng": payload.lng,
                "miles": miles,
                "ended_at": now_iso(),
                "notes": ((trip.get("notes") or "") + ((" · " + payload.notes) if payload.notes else "")).strip(" ·"),
            }
            await db.mileage_trips.update_one({"id": trip["id"]}, {"$set": updates})
            logger.info("Mileage stop user=%s miles=%s", user.user_id, miles)
            return {**trip, **updates}
        except HTTPException:
            raise
        except Exception:
            logger.exception("Mileage stop failed user=%s", user.user_id)
            raise HTTPException(status_code=500, detail="Could not stop that trip. Please try again.")

    @api_router.post("/field/mileage")
    async def mileage_manual(payload: MileageManual, user: User = Depends(get_current_user)):
        try:
            await assert_feature(user, "mileage")
            try:
                miles = float(payload.miles)
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail="Enter the miles for this trip.")
            if miles <= 0:
                raise HTTPException(status_code=400, detail="Miles must be greater than zero.")
            job = None
            if payload.job_id:
                job = await get_job_or_404(payload.job_id, user, "mileage")
            when = payload.date.strip() or now_iso()
            trip = {
                "id": new_id(),
                "user_id": user.user_id,
                "user_name": user.name,
                "job_id": (job or {}).get("id") or "",
                "job_name": (job or {}).get("name") or "",
                "purpose": "job" if payload.job_id else (payload.purpose or "business"),
                "miles": round(miles, 2),
                "started_at": when,
                "ended_at": when,
                "notes": (payload.notes or "").strip(),
                "start_label": payload.start_label,
                "end_label": payload.end_label,
                "manual": True,
                "created_at": now_iso(),
            }
            await db.mileage_trips.insert_one(trip)
            trip.pop("_id", None)
            return trip
        except HTTPException:
            raise
        except Exception:
            logger.exception("Manual mileage failed user=%s", user.user_id)
            raise HTTPException(status_code=500, detail="Could not save those miles. Please try again.")

    @api_router.get("/jobs/{job_id}/logs")
    async def list_logs(job_id: str, user: User = Depends(get_current_user)):
        await get_job_or_404(job_id, user, "job_notes")
        return await db.job_logs.find({"job_id": job_id}, {"_id": 0}).sort("created_at", -1).to_list(200)

    @api_router.post("/jobs/{job_id}/logs")
    async def add_log(job_id: str, payload: LogIn, user: User = Depends(get_current_user)):
        try:
            await get_job_or_404(job_id, user, "job_notes")
            text = (payload.text or "").strip()
            if not text:
                raise HTTPException(status_code=400, detail="Write a short note for the crew.")
            row = {
                "id": new_id(),
                "job_id": job_id,
                "user_id": user.user_id,
                "user_name": user.name,
                "text": text,
                "photos": [],
                "created_at": now_iso(),
            }
            await db.job_logs.insert_one(row)
            row.pop("_id", None)
            return row
        except HTTPException:
            raise
        except Exception:
            logger.exception("Add job log failed job_id=%s", job_id)
            raise HTTPException(status_code=500, detail="Could not save that note. Please try again.")

    @api_router.post("/jobs/{job_id}/logs/{log_id}/photos")
    async def add_log_photo(
        job_id: str,
        log_id: str,
        photo: UploadFile = File(...),
        user: User = Depends(get_current_user),
    ):
        try:
            job = await get_job_or_404(job_id, user, "job_notes")
            row = await db.job_logs.find_one({"id": log_id, "job_id": job_id}, {"_id": 0})
            if not row:
                raise HTTPException(status_code=404, detail="Note not found")
            filename, mime, content = await read_drive_upload(photo)
            if not str(mime).startswith("image/"):
                raise HTTPException(status_code=400, detail="Choose a photo from the job.")
            sheet = await db.job_sheets.find_one({"job_id": job_id}, {"_id": 0})
            client = await resolve_client_for_job(job, sheet)
            saved = None
            if client:
                saved = await maybe_save_drive_file(
                    client,
                    "photo_during",
                    log_id,
                    f"Field photo {datetime.now(timezone.utc).strftime('%Y%m%d-%H%M')} {filename}",
                    content,
                    mime_type=mime,
                    job_id=job_id,
                    strict=False,
                )
            photo_row = {
                "id": new_id(),
                "url": (saved or {}).get("web_view_link") or "",
                "filename": filename,
            }
            photos = list(row.get("photos") or []) + [photo_row]
            await db.job_logs.update_one({"id": log_id}, {"$set": {"photos": photos}})
            return {**row, "photos": photos}
        except HTTPException:
            raise
        except Exception:
            logger.exception("Job log photo failed job_id=%s", job_id)
            raise HTTPException(status_code=500, detail="Could not attach that photo. Please try again.")

    @api_router.get("/jobs/{job_id}/materials")
    async def list_materials(job_id: str, user: User = Depends(get_current_user)):
        await get_job_or_404(job_id, user, "material_requests")
        return await db.material_requests.find({"job_id": job_id}, {"_id": 0}).sort("created_at", -1).to_list(200)

    @api_router.post("/jobs/{job_id}/materials")
    async def add_material(job_id: str, payload: MaterialIn, user: User = Depends(get_current_user)):
        try:
            job = await get_job_or_404(job_id, user, "material_requests")
            item = (payload.item or "").strip()
            if not item:
                raise HTTPException(status_code=400, detail="What material do you need?")
            row = {
                "id": new_id(),
                "job_id": job_id,
                "user_id": user.user_id,
                "user_name": user.name,
                "item": item,
                "quantity": (payload.quantity or "1").strip(),
                "notes": (payload.notes or "").strip(),
                "needed_by": (payload.needed_by or "").strip(),
                "status": "open",
                "created_at": now_iso(),
            }
            await db.material_requests.insert_one(row)
            await notify_office(
                "material",
                f"Material request · {job.get('job_number') or 'Job'}",
                f"{user.name} needs {row['quantity']} × {item}.",
                job_id=job_id,
                source_user=user.user_id,
            )
            row.pop("_id", None)
            return row
        except HTTPException:
            raise
        except Exception:
            logger.exception("Material request failed job_id=%s", job_id)
            raise HTTPException(status_code=500, detail="Could not send that material request. Please try again.")

    @api_router.put("/jobs/{job_id}/materials/{req_id}")
    async def update_material(job_id: str, req_id: str, payload: MaterialStatusIn, user: User = Depends(get_current_user)):
        await get_job_or_404(job_id, user, "material_requests")
        status = (payload.status or "").strip().lower()
        if status not in ("open", "ordered", "delivered"):
            raise HTTPException(status_code=400, detail="Status must be open, ordered, or delivered.")
        res = await db.material_requests.update_one({"id": req_id, "job_id": job_id}, {"$set": {"status": status}})
        if res.matched_count == 0:
            raise HTTPException(status_code=404, detail="Request not found")
        return await db.material_requests.find_one({"id": req_id}, {"_id": 0})

    @api_router.get("/jobs/{job_id}/tasks")
    async def list_tasks(job_id: str, user: User = Depends(get_current_user)):
        await get_job_or_404(job_id, user, "tasks")
        return await db.job_tasks.find({"job_id": job_id}, {"_id": 0}).sort("created_at", 1).to_list(200)

    @api_router.post("/jobs/{job_id}/tasks")
    async def add_task(job_id: str, payload: TaskIn, user: User = Depends(get_current_user)):
        await get_job_or_404(job_id, user, "tasks")
        title = (payload.title or "").strip()
        if not title:
            raise HTTPException(status_code=400, detail="Name the task.")
        row = {
            "id": new_id(),
            "job_id": job_id,
            "title": title,
            "assigned_to": payload.assigned_to or "",
            "status": "open",
            "completed_at": "",
            "completed_by": "",
            "created_at": now_iso(),
        }
        await db.job_tasks.insert_one(row)
        row.pop("_id", None)
        return row

    @api_router.put("/jobs/{job_id}/tasks/{task_id}")
    async def update_task(job_id: str, task_id: str, payload: TaskStatusIn, user: User = Depends(get_current_user)):
        await get_job_or_404(job_id, user, "tasks")
        status = (payload.status or "").strip().lower()
        if status not in ("open", "done"):
            raise HTTPException(status_code=400, detail="Mark the task open or done.")
        updates = {"status": status}
        if status == "done":
            updates["completed_at"] = now_iso()
            updates["completed_by"] = user.user_id
            updates["completed_by_name"] = user.name
        else:
            updates["completed_at"] = ""
            updates["completed_by"] = ""
        res = await db.job_tasks.update_one({"id": task_id, "job_id": job_id}, {"$set": updates})
        if res.matched_count == 0:
            raise HTTPException(status_code=404, detail="Task not found")
        return await db.job_tasks.find_one({"id": task_id}, {"_id": 0})

    @api_router.get("/field/schedule")
    async def list_schedule(from_date: str = "", user: User = Depends(get_current_user)):
        await assert_feature(user, "crew_schedule")
        query = {}
        if normalize_role(user.role) == "field":
            query["user_id"] = user.user_id
        if from_date:
            query["date"] = {"$gte": from_date}
        return await db.crew_shifts.find(query, {"_id": 0}).sort("date", 1).to_list(400)

    @api_router.post("/field/schedule")
    async def add_shift(payload: ShiftIn, user: User = Depends(get_current_user)):
        if normalize_role(user.role) == "field":
            raise HTTPException(status_code=403, detail="Ask a project manager to set the schedule.")
        await assert_feature(user, "crew_schedule")
        job = await db.jobs.find_one({"id": payload.job_id}, {"_id": 0})
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        person = await db.users.find_one({"user_id": payload.user_id}, {"_id": 0})
        if not person:
            raise HTTPException(status_code=404, detail="Teammate not found")
        row = {
            "id": new_id(),
            "job_id": job["id"],
            "job_name": job.get("name") or "",
            "job_number": job.get("job_number") or "",
            "user_id": person["user_id"],
            "user_name": person.get("name") or "",
            "date": payload.date,
            "start": payload.start or "07:00",
            "end": payload.end or "16:00",
            "notes": (payload.notes or "").strip(),
            "created_at": now_iso(),
        }
        await db.crew_shifts.insert_one(row)
        row.pop("_id", None)
        return row

    @api_router.delete("/field/schedule/{shift_id}")
    async def delete_shift(shift_id: str, user: User = Depends(get_current_user)):
        if normalize_role(user.role) == "field":
            raise HTTPException(status_code=403, detail="Ask a project manager to change the schedule.")
        await db.crew_shifts.delete_one({"id": shift_id})
        return {"success": True}

    @api_router.get("/notifications")
    async def list_notifications(user: User = Depends(get_current_user)):
        await assert_feature(user, "notifications")
        return await db.notifications.find({"user_id": user.user_id}, {"_id": 0}).sort("created_at", -1).to_list(80)

    @api_router.post("/notifications/{note_id}/read")
    async def read_notification(note_id: str, user: User = Depends(get_current_user)):
        await db.notifications.update_one({"id": note_id, "user_id": user.user_id}, {"$set": {"read": True}})
        return {"success": True}

    @api_router.post("/notifications/read-all")
    async def read_all_notifications(user: User = Depends(get_current_user)):
        await db.notifications.update_many({"user_id": user.user_id}, {"$set": {"read": True}})
        return {"success": True}

    @api_router.get("/field/crew")
    async def field_crew(user: User = Depends(get_current_user)):
        if normalize_role(user.role) == "field":
            raise HTTPException(status_code=403, detail="Crew list is for managers.")
        docs = await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(200)
        return [public_user(d) for d in docs]
