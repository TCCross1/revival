"""Subcontractor directory, bid packages, public sub portal, messaging."""
from __future__ import annotations

import logging
import secrets
from datetime import datetime, timezone
from html import escape
from typing import Optional

from bson.binary import Binary
from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    UploadFile,
)
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class SubcontractorIn(BaseModel):
    company_name: str
    contact_name: str = ""
    email: str = ""
    phone: str = ""
    categories: list[str] = Field(default_factory=list)
    license_number: str = ""
    insurance_expires: str = ""
    insurance_status: str = "unknown"
    notes: str = ""
    rating: float = 0
    review_count: int = 0
    city: str = ""
    website: str = ""


class BidPackageIn(BaseModel):
    job_id: str
    name: str = ""
    scope: str = "Entire job"
    description: str = ""
    due_at: str = ""
    pull_assets: bool = True


class EstimateBidRequestIn(BaseModel):
    scope: str = "Entire job"
    description: str = ""
    due_at: str = ""
    subcontractor_ids: list[str] = Field(default_factory=list)
    invite_all_in_trade: bool = False


class BidPackageUpdate(BaseModel):
    name: Optional[str] = None
    scope: Optional[str] = None
    description: Optional[str] = None
    due_at: Optional[str] = None
    status: Optional[str] = None


class InviteIn(BaseModel):
    subcontractor_id: str = ""
    email: str = ""
    name: str = ""
    company_name: str = ""


class BidSubmitIn(BaseModel):
    amount: float
    notes: str = ""
    exclusions: str = ""
    timeline: str = ""


class MessageIn(BaseModel):
    body: str = ""
    question: bool = False
    answer_to: str = ""
    request_kind: str = ""  # photo | video | walkthrough | measurement | other


class AwardIn(BaseModel):
    invitation_id: str


def attach_subcontractor_routes(api_router: APIRouter):
    from server import (
        User,
        assert_user_feature,
        db,
        get_company,
        get_current_user,
        load_client_for_drive,
        maybe_save_drive_file,
        new_id,
        now_iso,
        read_drive_upload,
        send_email,
    )
    from field_ops import job_visible_to
    from google_drive import frontend_url
    from subcontractors import (
        BID_ALLOWED_MIME,
        MAX_BID_BLOB_BYTES,
        MEDIA_REQUEST_TYPES,
        PACKAGE_STATUSES,
        SCOPES,
        TRADE_CATEGORIES,
        hash_invite_token,
        next_invite_status,
        normalize_scope,
        public_job,
        public_plan,
        publicize_file_ref,
        ranking_key,
        seed_lexington_subcontractors,
        strip_invitation,
        template_for,
        unanswered_count,
        valid_email,
    )

    async def require_jobs(user: User):
        await assert_user_feature(user, "jobs")
        return user

    async def require_directory(user: User):
        await assert_user_feature(user, "subcontractors")
        return user

    async def load_job(job_id: str, user: User) -> dict:
        job = await db.jobs.find_one({"id": job_id}, {"_id": 0})
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        if not job_visible_to(user.user_id, user.role, job):
            raise HTTPException(status_code=403, detail="That job is not assigned to you.")
        return job

    async def load_package_for_user(package_id: str, user: User) -> dict:
        pkg = await db.bid_packages.find_one({"id": package_id}, {"_id": 0})
        if not pkg:
            raise HTTPException(status_code=404, detail="Bid package not found")
        await load_job(pkg.get("job_id") or "", user)
        return pkg

    async def invitation_from_token(raw: str) -> dict:
        token = (raw or "").strip()
        if not token or len(token) < 16:
            raise HTTPException(status_code=404, detail="That bid link is invalid or has expired.")
        digest = hash_invite_token(token)
        found = await db.bid_invitations.find_one({"token_hash": digest}, {"_id": 0})
        if not found:
            raise HTTPException(status_code=404, detail="That bid link is invalid or has expired.")
        return found

    async def add_activity(package_id: str, job_id: str, kind: str, text: str, actor: str = ""):
        try:
            await db.bid_activity.insert_one({
                "id": new_id(),
                "package_id": package_id,
                "job_id": job_id,
                "kind": kind,
                "text": text,
                "actor": actor,
                "created_at": now_iso(),
            })
        except Exception:
            logger.exception("Bid activity write failed package_id=%s", package_id)

    async def collect_job_assets(job: dict) -> list:
        job_id = job.get("id") or ""
        assets = []
        plans = await db.floor_plans.find({"job_id": job_id, "showcase": {"$ne": True}}, {"_id": 0}).sort("updated_at", -1).to_list(20)
        for plan in plans:
            assets.append({
                "id": new_id(),
                "kind": "floor_plan",
                "name": plan.get("name") or "Floor plan",
                "source": "floor_plan",
                "source_id": plan.get("id") or "",
                "plan_id": plan.get("id") or "",
                "studio_url": f"/floor-plans/{plan.get('id')}",
                "drive_url": plan.get("google_drive_url") or "",
                "note": "2D working plan and 3D walkthrough in Floor Plan Studio",
            })
            assets.append({
                "id": new_id(),
                "kind": "floor_plan_3d",
                "name": f"{plan.get('name') or 'Floor plan'} — 3D",
                "source": "floor_plan",
                "source_id": plan.get("id") or "",
                "plan_id": plan.get("id") or "",
                "studio_url": f"/floor-plans/{plan.get('id')}",
                "note": "Open the 3D walkthrough from this plan",
            })
        client_id = job.get("client_id") or ""
        if client_id:
            files = await db.drive_files.find({"client_id": client_id}, {"_id": 0}).sort("uploaded_at", -1).to_list(200)
            for row in files:
                if row.get("job_id") and row.get("job_id") != job_id:
                    continue
                kind = row.get("kind") or "other"
                if kind in ("estimate", "invoice", "contract", "job_sheet", "receipts", "receipt"):
                    continue
                assets.append({
                    "id": new_id(),
                    "kind": kind,
                    "name": row.get("filename") or kind,
                    "source": "drive",
                    "source_id": row.get("id") or "",
                    "drive_file_id": row.get("google_drive_file_id") or "",
                    "url": row.get("web_view_link") or "",
                    "mime_type": row.get("mime_type") or "",
                })
        return assets

    async def persist_upload(job: dict, kind: str, filename: str, mime: str, content: bytes, source_id: str, package_id: str = "") -> dict:
        client = await load_client_for_drive(job.get("client_id") or "", job.get("client_name") or "")
        drive = None
        if client:
            try:
                stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")
                labeled = f"{kind.replace('_', ' ').title()} {stamp} {filename}"
                drive = await maybe_save_drive_file(
                    client,
                    kind if kind in ("bid_pdf", "bid_asset", "photo_before", "photo_during", "photo_after", "materials_list", "other") else "bid_asset",
                    source_id,
                    labeled,
                    content,
                    mime_type=mime,
                    job_id=job.get("id") or "",
                    strict=False,
                )
            except Exception:
                logger.exception("Bid Drive save failed job_id=%s", job.get("id"))
        file_id = new_id()
        stored = bool(drive)
        if not drive:
            if len(content) > MAX_BID_BLOB_BYTES:
                raise HTTPException(
                    status_code=400,
                    detail="That file is too large to keep without Google Drive. Connect Drive or upload a smaller file.",
                )
            await db.bid_file_blobs.insert_one({
                "id": file_id,
                "job_id": job.get("id") or "",
                "package_id": package_id,
                "filename": filename,
                "mime_type": mime,
                "content": Binary(content),
                "created_at": now_iso(),
            })
            stored = True
        if not stored:
            raise HTTPException(status_code=500, detail="Could not save that file. Please try again.")
        return {
            "id": (drive or {}).get("id") or file_id,
            "file_id": file_id if not drive else "",
            "filename": filename,
            "mime_type": mime,
            "kind": kind,
            "drive_file_id": (drive or {}).get("google_drive_file_id") or "",
            "url": (drive or {}).get("web_view_link") or (f"/api/bid-files/{file_id}" if not drive else ""),
            "web_view_link": (drive or {}).get("web_view_link") or "",
        }

    async def invite_email(invitation: dict, package: dict, job: dict, raw_token: str):
        company = await get_company()
        link = f"{frontend_url()}/sub/{raw_token}"
        due = package.get("due_at") or "See the package"
        html = (
            f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F7F8;padding:24px 0"><tr><td align="center">'
            f'<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #E2E8F0">'
            f'<tr><td style="background:#0B3A8F;padding:20px 28px;color:#ffffff;font-family:Georgia,serif">'
            f'<div style="font-size:18px;font-weight:700">{escape((company or {}).get("name") or "Revival Home Remodeling")}</div>'
            f'<div style="color:#C9A227;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;margin-top:4px">Bid invitation</div>'
            f'</td></tr>'
            f'<tr><td style="padding:28px;font-family:Georgia,serif;color:#061A23;font-size:15px;line-height:1.55">'
            f'<p>Hello {escape(invitation.get("name") or "there")},</p>'
            f'<p>You are invited to bid <strong>{escape(package.get("scope") or "this scope")}</strong> on '
            f'<strong>{escape(job.get("name") or "a Revival job")}</strong> ({escape(job.get("job_number") or "")}).</p>'
            f'<p>The package includes the floor plan, 3D views, job-site photos, and specs for this job only. Due: {escape(str(due))}.</p>'
            f'<p style="text-align:center;margin:28px 0"><a href="{escape(link)}" style="background:#C9A227;color:#061A23;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700">Open bid package</a></p>'
            f'<p style="font-size:13px;color:#4B6370">If the button does not work, paste this link into your browser:<br>{escape(link)}</p>'
            f'</td></tr></table></td></tr></table>'
        )
        await send_email(
            to=invitation["email"],
            subject=f"Bid invitation · {job.get('job_number') or 'Job'} · {package.get('scope') or 'Scope'}",
            html=html,
        )

    def package_summary(pkg: dict, invites: list, bids: list, messages: list) -> dict:
        return {
            **{k: pkg.get(k) for k in ("id", "job_id", "client_id", "name", "scope", "description", "due_at", "status", "created_at", "updated_at", "awarded_invitation_id")},
            "asset_count": len(pkg.get("assets") or []),
            "invite_count": len(invites),
            "bid_count": len(bids),
            "unanswered": unanswered_count(messages),
            "invites": [strip_invitation(i) for i in invites],
        }

    @api_router.get("/subcontractor-meta")
    async def subcontractor_meta(user: User = Depends(get_current_user)):
        await require_jobs(user)
        return {
            "scopes": SCOPES,
            "categories": TRADE_CATEGORIES,
            "templates": {s: template_for(s) for s in SCOPES},
            "media_request_types": list(MEDIA_REQUEST_TYPES),
        }

    @api_router.get("/subcontractors")
    async def list_subcontractors(category: str = "", user: User = Depends(get_current_user)):
        await require_directory(user)
        try:
            await seed_lexington_subcontractors(db)
        except Exception:
            logger.exception("Subcontractor directory seed failed")
        query = {}
        if category:
            query["categories"] = category
        rows = await db.subcontractors.find(query, {"_id": 0}).to_list(1000)
        rows.sort(key=ranking_key)
        return rows

    @api_router.post("/subcontractors")
    async def create_subcontractor(payload: SubcontractorIn, user: User = Depends(get_current_user)):
        try:
            await require_directory(user)
            email = (payload.email or "").strip().lower()
            if email and not valid_email(email):
                raise HTTPException(status_code=400, detail="Enter a valid email address.")
            name = (payload.company_name or "").strip()
            if not name:
                raise HTTPException(status_code=400, detail="Enter the company name.")
            doc = {
                "id": new_id(),
                "company_name": name,
                "contact_name": (payload.contact_name or "").strip(),
                "email": email,
                "phone": (payload.phone or "").strip(),
                "categories": [c for c in (payload.categories or []) if c],
                "license_number": (payload.license_number or "").strip(),
                "insurance_expires": (payload.insurance_expires or "").strip(),
                "insurance_status": payload.insurance_status or "unknown",
                "notes": (payload.notes or "").strip(),
                "rating": float(payload.rating or 0),
                "review_count": int(payload.review_count or 0),
                "city": (payload.city or "").strip(),
                "website": (payload.website or "").strip(),
                "created_at": now_iso(),
                "updated_at": now_iso(),
            }
            await db.subcontractors.insert_one(doc)
            logger.info("Created subcontractor %s user=%s", doc["id"], user.user_id)
            doc.pop("_id", None)
            return doc
        except HTTPException:
            raise
        except Exception:
            logger.exception("Create subcontractor failed")
            raise HTTPException(status_code=500, detail="Could not save that subcontractor. Please try again.")

    @api_router.put("/subcontractors/{sub_id}")
    async def update_subcontractor(sub_id: str, payload: SubcontractorIn, user: User = Depends(get_current_user)):
        try:
            await require_directory(user)
            found = await db.subcontractors.find_one({"id": sub_id}, {"_id": 0})
            if not found:
                raise HTTPException(status_code=404, detail="Subcontractor not found")
            email = (payload.email or "").strip().lower()
            if email and not valid_email(email):
                raise HTTPException(status_code=400, detail="Enter a valid email address.")
            patch = {
                "company_name": (payload.company_name or found.get("company_name") or "").strip(),
                "contact_name": (payload.contact_name or "").strip(),
                "email": email,
                "phone": (payload.phone or "").strip(),
                "categories": [c for c in (payload.categories or []) if c],
                "license_number": (payload.license_number or "").strip(),
                "insurance_expires": (payload.insurance_expires or "").strip(),
                "insurance_status": payload.insurance_status or found.get("insurance_status") or "unknown",
                "notes": (payload.notes or "").strip(),
                "rating": float(payload.rating if payload.rating is not None else found.get("rating") or 0),
                "review_count": int(payload.review_count if payload.review_count is not None else found.get("review_count") or 0),
                "city": (payload.city or found.get("city") or "").strip(),
                "website": (payload.website or found.get("website") or "").strip(),
                "updated_at": now_iso(),
            }
            await db.subcontractors.update_one({"id": sub_id}, {"$set": patch})
            return {**found, **patch}
        except HTTPException:
            raise
        except Exception:
            logger.exception("Update subcontractor failed sub_id=%s", sub_id)
            raise HTTPException(status_code=500, detail="Could not update that subcontractor. Please try again.")

    @api_router.delete("/subcontractors/{sub_id}")
    async def delete_subcontractor(sub_id: str, user: User = Depends(get_current_user)):
        await require_directory(user)
        await db.subcontractors.delete_one({"id": sub_id})
        logger.info("Deleted subcontractor %s user=%s", sub_id, user.user_id)
        return {"success": True}

    @api_router.get("/jobs/{job_id}/bid-packages")
    async def list_job_bid_packages(job_id: str, user: User = Depends(get_current_user)):
        await load_job(job_id, user)
        packages = await db.bid_packages.find({"job_id": job_id}, {"_id": 0}).sort("updated_at", -1).to_list(100)
        out = []
        for pkg in packages:
            invites = await db.bid_invitations.find({"package_id": pkg["id"]}, {"_id": 0, "token_hash": 0}).to_list(100)
            bids = await db.bids.find({"package_id": pkg["id"]}, {"_id": 0}).to_list(100)
            messages = await db.bid_messages.find({"package_id": pkg["id"]}, {"_id": 0}).to_list(200)
            out.append(package_summary(pkg, invites, bids, messages))
        return out

    @api_router.post("/bid-packages")
    async def create_bid_package(payload: BidPackageIn, user: User = Depends(get_current_user)):
        try:
            job = await load_job(payload.job_id, user)
            scope = normalize_scope(payload.scope)
            name = (payload.name or "").strip() or f"{job.get('name') or 'Job'} · {scope}"
            description = (payload.description or "").strip() or template_for(scope)
            assets = await collect_job_assets(job) if payload.pull_assets else []
            doc = {
                "id": new_id(),
                "job_id": job["id"],
                "client_id": job.get("client_id") or "",
                "name": name,
                "scope": scope,
                "description": description,
                "due_at": (payload.due_at or "").strip(),
                "status": "open",
                "assets": assets,
                "awarded_invitation_id": "",
                "awarded_bid_id": "",
                "created_by": user.user_id,
                "created_at": now_iso(),
                "updated_at": now_iso(),
            }
            await db.bid_packages.insert_one(doc)
            await add_activity(doc["id"], job["id"], "created", f"Bid package opened for {scope}.", user.name)
            logger.info("Created bid package %s job=%s scope=%s assets=%s user=%s", doc["id"], job["id"], scope, len(assets), user.user_id)
            doc.pop("_id", None)
            return doc
        except HTTPException:
            raise
        except Exception:
            logger.exception("Create bid package failed")
            raise HTTPException(status_code=500, detail="Could not create that bid package. Please try again.")

    @api_router.post("/estimates/{estimate_id}/request-bid")
    async def request_bid_from_estimate(
        estimate_id: str,
        payload: EstimateBidRequestIn,
        background: BackgroundTasks,
        user: User = Depends(get_current_user),
    ):
        """Create/find the job for this estimate, open a bid package, and invite trades."""
        try:
            await assert_user_feature(user, "estimates")
            await assert_user_feature(user, "jobs")
            from server import Job, next_number, resolve_client_ref

            est = await db.estimates.find_one({"id": estimate_id}, {"_id": 0})
            if not est:
                raise HTTPException(status_code=404, detail="Estimate not found")

            job_doc = await db.jobs.find_one({"estimate_id": estimate_id}, {"_id": 0})
            if not job_doc:
                category = (est.get("category") or "").strip() or "Project"
                cid, cname = await resolve_client_ref(est.get("client_id", ""), est.get("client_name", ""))
                name = f"{category} - {cname}".strip(" -") or "New Job"
                obj = Job(
                    job_number=await next_number("JOB"),
                    name=name,
                    estimate_id=estimate_id,
                    client_id=cid,
                    client_name=cname,
                    status="Active",
                    budget=float(est.get("total", 0.0) or 0.0),
                    expenses=[],
                )
                await db.jobs.insert_one(obj.model_dump())
                job_doc = obj.model_dump()
                logger.info("Auto-created job %s for estimate bid request %s", obj.job_number, estimate_id)

            scope = normalize_scope(payload.scope)
            description = (payload.description or "").strip() or template_for(scope)
            # Append estimate snapshot so the sub sees pricing context without private margins.
            lines = est.get("line_items") or []
            if lines:
                preview = "; ".join(
                    f"{(i.get('description') or i.get('name') or 'Item')[:60]}"
                    for i in lines[:12]
                )
                description = (
                    f"{description}\n\nEstimate {est.get('estimate_number') or estimate_id} "
                    f"· {est.get('category') or 'Project'} · client total ${float(est.get('total') or 0):,.2f}.\n"
                    f"Line items: {preview}"
                ).strip()

            assets = await collect_job_assets(job_doc)
            pkg = {
                "id": new_id(),
                "job_id": job_doc["id"],
                "client_id": job_doc.get("client_id") or "",
                "estimate_id": estimate_id,
                "name": f"{job_doc.get('name') or 'Job'} · {scope}",
                "scope": scope,
                "description": description,
                "due_at": (payload.due_at or "").strip(),
                "status": "open",
                "assets": assets,
                "awarded_invitation_id": "",
                "awarded_bid_id": "",
                "created_by": user.user_id,
                "created_at": now_iso(),
                "updated_at": now_iso(),
            }
            await db.bid_packages.insert_one(pkg)
            await add_activity(pkg["id"], job_doc["id"], "created", f"Bid request from estimate for {scope}.", user.name)

            invite_ids = list(payload.subcontractor_ids or [])
            if payload.invite_all_in_trade:
                if scope == "Entire job":
                    trade_rows = await db.subcontractors.find({}, {"_id": 0, "id": 1}).to_list(500)
                else:
                    trade_rows = await db.subcontractors.find({"categories": scope}, {"_id": 0, "id": 1}).to_list(200)
                invite_ids.extend([r["id"] for r in trade_rows if r.get("id")])
            # de-dupe
            seen = set()
            invites_out = []
            for sid in invite_ids:
                if not sid or sid in seen:
                    continue
                seen.add(sid)
                sub = await db.subcontractors.find_one({"id": sid}, {"_id": 0})
                if not sub:
                    continue
                email = (sub.get("email") or "").strip().lower()
                if not email or not valid_email(email):
                    # Still create invite shell without email send when directory lacks email
                    raw = secrets.token_urlsafe(24)
                    invite = {
                        "id": new_id(),
                        "package_id": pkg["id"],
                        "job_id": job_doc["id"],
                        "subcontractor_id": sid,
                        "email": email,
                        "name": sub.get("contact_name") or "",
                        "company_name": sub.get("company_name") or "",
                        "token_hash": hash_invite_token(raw),
                        "status": "invited",
                        "created_at": now_iso(),
                        "updated_at": now_iso(),
                    }
                    await db.bid_invitations.insert_one(invite)
                    public = strip_invitation(invite)
                    public["invite_url"] = f"{frontend_url()}/sub/{raw}"
                    public["email_sent"] = False
                    invites_out.append(public)
                    continue
                # Reuse invite endpoint logic inline
                raw = secrets.token_urlsafe(24)
                invite = {
                    "id": new_id(),
                    "package_id": pkg["id"],
                    "job_id": job_doc["id"],
                    "subcontractor_id": sid,
                    "email": email,
                    "name": sub.get("contact_name") or "",
                    "company_name": sub.get("company_name") or "",
                    "token_hash": hash_invite_token(raw),
                    "status": "invited",
                    "created_at": now_iso(),
                    "updated_at": now_iso(),
                }
                await db.bid_invitations.insert_one(invite)
                try:
                    await invite_email(invite, pkg, job_doc, raw)
                    emailed = True
                except Exception:
                    logger.exception("Invite email failed for %s", email)
                    emailed = False
                public = strip_invitation(invite)
                public["invite_url"] = f"{frontend_url()}/sub/{raw}"
                public["email_sent"] = emailed
                invites_out.append(public)

            pkg.pop("_id", None)
            logger.info(
                "Estimate bid request estimate=%s package=%s scope=%s invites=%s user=%s",
                estimate_id,
                pkg["id"],
                scope,
                len(invites_out),
                user.user_id,
            )
            return {
                "package": pkg,
                "job": {"id": job_doc["id"], "job_number": job_doc.get("job_number"), "name": job_doc.get("name")},
                "invitations": invites_out,
            }
        except HTTPException:
            raise
        except Exception:
            logger.exception("Estimate bid request failed estimate_id=%s", estimate_id)
            raise HTTPException(status_code=500, detail="Could not create that bid request. Please try again.")

    @api_router.get("/bid-packages/{package_id}")
    async def get_bid_package(package_id: str, since: str = "", user: User = Depends(get_current_user)):
        pkg = await load_package_for_user(package_id, user)
        job = await db.jobs.find_one({"id": pkg["job_id"]}, {"_id": 0})
        invites = await db.bid_invitations.find({"package_id": package_id}, {"_id": 0, "token_hash": 0}).to_list(200)
        bids = await db.bids.find({"package_id": package_id}, {"_id": 0}).sort("updated_at", -1).to_list(200)
        msg_q = {"package_id": package_id}
        if since:
            msg_q["created_at"] = {"$gt": since}
        messages = await db.bid_messages.find(msg_q, {"_id": 0}).sort("created_at", 1).to_list(400)
        activity = await db.bid_activity.find({"package_id": package_id}, {"_id": 0}).sort("created_at", -1).to_list(80)
        plans = await db.floor_plans.find({"job_id": pkg["job_id"], "showcase": {"$ne": True}}, {"_id": 0}).to_list(20)
        return {
            "package": pkg,
            "job": {
                "id": job.get("id"),
                "name": job.get("name"),
                "job_number": job.get("job_number"),
                "client_name": job.get("client_name"),
                "address": job.get("address") or "",
                "client_id": job.get("client_id") or "",
            },
            "invitations": [strip_invitation(i) for i in invites],
            "bids": bids,
            "messages": messages,
            "activity": activity,
            "unanswered": unanswered_count(messages if not since else await db.bid_messages.find({"package_id": package_id}, {"_id": 0}).to_list(400)),
            "plans": [{"id": p.get("id"), "name": p.get("name"), "project_type": p.get("project_type")} for p in plans],
        }

    @api_router.put("/bid-packages/{package_id}")
    async def update_bid_package(package_id: str, payload: BidPackageUpdate, user: User = Depends(get_current_user)):
        pkg = await load_package_for_user(package_id, user)
        data = payload.model_dump(exclude_unset=True)
        if "scope" in data:
            data["scope"] = normalize_scope(data["scope"])
        if data.get("status") and data["status"] not in PACKAGE_STATUSES:
            raise HTTPException(status_code=400, detail="That package status is not valid.")
        data["updated_at"] = now_iso()
        await db.bid_packages.update_one({"id": package_id}, {"$set": data})
        return {**pkg, **data}

    @api_router.post("/bid-packages/{package_id}/assets")
    async def upload_package_asset(
        package_id: str,
        kind: str = Form("bid_asset"),
        file: UploadFile = File(...),
        user: User = Depends(get_current_user),
    ):
        try:
            pkg = await load_package_for_user(package_id, user)
            job = await db.jobs.find_one({"id": pkg["job_id"]}, {"_id": 0})
            filename, mime, content = await read_drive_upload(file)
            if mime not in BID_ALLOWED_MIME and not str(mime).startswith("image/") and mime != "application/pdf":
                raise HTTPException(status_code=400, detail="Upload a photo, video, PDF, or document.")
            saved = await persist_upload(job, kind or "bid_asset", filename, mime, content, new_id(), package_id)
            asset = {
                "id": new_id(),
                "kind": kind or "bid_asset",
                "name": filename,
                "source": "upload",
                "mime_type": mime,
                **{k: saved.get(k) for k in ("url", "web_view_link", "drive_file_id", "file_id", "filename")},
            }
            assets = list(pkg.get("assets") or [])
            assets.append(asset)
            await db.bid_packages.update_one({"id": package_id}, {"$set": {"assets": assets, "updated_at": now_iso()}})
            await add_activity(package_id, pkg["job_id"], "asset", f"Added {filename}.", user.name)
            logger.info("Bid asset uploaded package=%s user=%s", package_id, user.user_id)
            return asset
        except HTTPException:
            raise
        except Exception:
            logger.exception("Bid asset upload failed package_id=%s", package_id)
            raise HTTPException(status_code=500, detail="Could not attach that file. Please try again.")

    @api_router.post("/bid-packages/{package_id}/invite")
    async def invite_subcontractor(package_id: str, payload: InviteIn, background: BackgroundTasks, user: User = Depends(get_current_user)):
        try:
            pkg = await load_package_for_user(package_id, user)
            job = await db.jobs.find_one({"id": pkg["job_id"]}, {"_id": 0})
            email = (payload.email or "").strip().lower()
            name = (payload.name or "").strip()
            company_name = (payload.company_name or "").strip()
            sub_id = (payload.subcontractor_id or "").strip()
            if sub_id:
                sub = await db.subcontractors.find_one({"id": sub_id}, {"_id": 0})
                if not sub:
                    raise HTTPException(status_code=404, detail="That subcontractor is not in the directory.")
                email = email or (sub.get("email") or "").strip().lower()
                name = name or sub.get("contact_name") or sub.get("company_name") or ""
                company_name = company_name or sub.get("company_name") or ""
            if not valid_email(email):
                raise HTTPException(status_code=400, detail="Enter a valid email to invite.")
            raw = secrets.token_urlsafe(32)
            invite = {
                "id": new_id(),
                "package_id": package_id,
                "job_id": pkg["job_id"],
                "subcontractor_id": sub_id,
                "email": email,
                "name": name or email,
                "company_name": company_name or name or email,
                "token_hash": hash_invite_token(raw),
                "status": "invited",
                "viewed_at": "",
                "created_at": now_iso(),
                "updated_at": now_iso(),
            }
            await db.bid_invitations.insert_one(invite)
            try:
                await invite_email(invite, pkg, job, raw)
            except HTTPException as ex:
                await db.bid_invitations.delete_one({"id": invite["id"]})
                raise ex
            await add_activity(package_id, pkg["job_id"], "invite", f"Invited {invite['company_name']}.", user.name)
            logger.info("Invited subcontractor package=%s invite=%s user=%s", package_id, invite["id"], user.user_id)
            public = strip_invitation(invite)
            public["invite_url"] = f"{frontend_url()}/sub/{raw}"
            return public
        except HTTPException:
            raise
        except Exception:
            logger.exception("Invite subcontractor failed package_id=%s", package_id)
            raise HTTPException(status_code=500, detail="Could not send that invitation. Please try again.")

    @api_router.post("/bid-packages/{package_id}/messages")
    async def gc_post_message(package_id: str, payload: MessageIn, user: User = Depends(get_current_user)):
        pkg = await load_package_for_user(package_id, user)
        body = (payload.body or "").strip()
        if not body:
            raise HTTPException(status_code=400, detail="Write a message first.")
        msg = {
            "id": new_id(),
            "package_id": package_id,
            "job_id": pkg["job_id"],
            "invitation_id": "",
            "author_kind": "gc",
            "author_name": user.name,
            "author_email": user.email,
            "body": body,
            "question": False,
            "request_kind": (payload.request_kind or "").strip().lower(),
            "answered": True if payload.answer_to else False,
            "answer_to": payload.answer_to or "",
            "attachments": [],
            "created_at": now_iso(),
        }
        await db.bid_messages.insert_one(msg)
        if payload.answer_to:
            await db.bid_messages.update_one({"id": payload.answer_to, "package_id": package_id}, {"$set": {"answered": True}})
        msg.pop("_id", None)
        return msg

    @api_router.post("/bid-packages/{package_id}/message-file")
    async def gc_message_file(
        package_id: str,
        file: UploadFile = File(...),
        note: str = Form(""),
        answer_to: str = Form(""),
        user: User = Depends(get_current_user),
    ):
        try:
            pkg = await load_package_for_user(package_id, user)
            job = await db.jobs.find_one({"id": pkg["job_id"]}, {"_id": 0})
            filename, mime, content = await read_drive_upload(file)
            saved = await persist_upload(job, "bid_asset", filename, mime, content, new_id(), package_id)
            body = (note or "").strip() or f"Attached {filename}"
            msg = {
                "id": new_id(),
                "package_id": package_id,
                "job_id": pkg["job_id"],
                "invitation_id": "",
                "author_kind": "gc",
                "author_name": user.name,
                "author_email": user.email,
                "body": body,
                "question": False,
                "answered": True if answer_to else False,
                "answer_to": answer_to or "",
                "attachments": [saved],
                "created_at": now_iso(),
            }
            await db.bid_messages.insert_one(msg)
            if answer_to:
                await db.bid_messages.update_one({"id": answer_to, "package_id": package_id}, {"$set": {"answered": True}})
            await add_activity(package_id, pkg["job_id"], "message", f"{user.name} attached {filename}.", user.name)
            logger.info("GC bid message file package=%s user=%s", package_id, user.user_id)
            msg.pop("_id", None)
            return msg
        except HTTPException:
            raise
        except Exception:
            logger.exception("GC bid message file failed package_id=%s", package_id)
            raise HTTPException(status_code=500, detail="Could not attach that file. Please try again.")

    @api_router.post("/bid-packages/{package_id}/award")
    async def award_bid(package_id: str, payload: AwardIn, user: User = Depends(get_current_user)):
        try:
            pkg = await load_package_for_user(package_id, user)
            invite = await db.bid_invitations.find_one({"id": payload.invitation_id, "package_id": package_id}, {"_id": 0})
            if not invite:
                raise HTTPException(status_code=404, detail="That invitation was not found.")
            nxt = next_invite_status(invite.get("status"), "award")
            if nxt != "awarded":
                raise HTTPException(status_code=400, detail="A declined invitation cannot be awarded.")
            bid = await db.bids.find_one({"invitation_id": invite["id"]}, {"_id": 0}, sort=[("revision", -1)])
            await db.bid_invitations.update_one({"id": invite["id"]}, {"$set": {"status": "awarded", "updated_at": now_iso()}})
            await db.bid_packages.update_one({"id": package_id}, {"$set": {
                "status": "awarded",
                "awarded_invitation_id": invite["id"],
                "awarded_bid_id": (bid or {}).get("id") or "",
                "updated_at": now_iso(),
            }})
            await add_activity(package_id, pkg["job_id"], "award", f"Awarded to {invite.get('company_name') or invite.get('name')}.", user.name)
            logger.info("Awarded bid package=%s invite=%s user=%s", package_id, invite["id"], user.user_id)
            return {"success": True, "invitation_id": invite["id"], "bid": bid}
        except HTTPException:
            raise
        except Exception:
            logger.exception("Award bid failed package_id=%s", package_id)
            raise HTTPException(status_code=500, detail="Could not award that bid. Please try again.")

    @api_router.get("/bid-files/{file_id}")
    async def get_bid_file(file_id: str, user: User = Depends(get_current_user)):
        blob = await db.bid_file_blobs.find_one({"id": file_id})
        if not blob:
            raise HTTPException(status_code=404, detail="File not found")
        await load_job(blob.get("job_id") or "", user)
        from fastapi.responses import Response
        return Response(content=bytes(blob.get("content") or b""), media_type=blob.get("mime_type") or "application/octet-stream")

    # ----- Public sub portal (token in path; never logged) -----

    async def public_bundle(raw_token: str, mark_viewed: bool = True) -> dict:
        invite = await invitation_from_token(raw_token)
        pkg = await db.bid_packages.find_one({"id": invite["package_id"]}, {"_id": 0})
        if not pkg:
            raise HTTPException(status_code=404, detail="That bid package is no longer available.")
        job = await db.jobs.find_one({"id": pkg["job_id"]}, {"_id": 0}) or {}
        if mark_viewed:
            nxt = next_invite_status(invite.get("status"), "view")
            if nxt != invite.get("status"):
                await db.bid_invitations.update_one({"id": invite["id"]}, {"$set": {"status": nxt, "viewed_at": now_iso(), "updated_at": now_iso()}})
                invite["status"] = nxt
                await add_activity(pkg["id"], pkg["job_id"], "viewed", f"{invite.get('company_name') or 'Subcontractor'} opened the package.")
        bids = await db.bids.find({"invitation_id": invite["id"]}, {"_id": 0}).sort("revision", -1).to_list(20)
        messages = await db.bid_messages.find(
            {"package_id": pkg["id"], "$or": [{"invitation_id": invite["id"]}, {"invitation_id": ""}, {"author_kind": "gc"}]},
            {"_id": 0},
        ).sort("created_at", 1).to_list(300)
        plans = await db.floor_plans.find({"job_id": pkg["job_id"], "showcase": {"$ne": True}}, {"_id": 0}).to_list(10)
        company = await get_company()
        return {
            "company": {"name": (company or {}).get("name") or "Revival Home Remodeling"},
            "job": public_job(job),
            "package": {
                "id": pkg["id"],
                "name": pkg.get("name"),
                "scope": pkg.get("scope"),
                "description": pkg.get("description"),
                "due_at": pkg.get("due_at"),
                "status": pkg.get("status"),
                "assets": [publicize_file_ref(a, raw_token) for a in (pkg.get("assets") or [])],
            },
            "invitation": {
                "id": invite["id"],
                "status": invite.get("status"),
                "name": invite.get("name"),
                "company_name": invite.get("company_name"),
                "email": invite.get("email"),
            },
            "my_bid": (
                {**bids[0], "pdf": publicize_file_ref(bids[0].get("pdf") or {}, raw_token)}
                if bids else None
            ),
            "bid_history": [
                {**b, "pdf": publicize_file_ref(b.get("pdf") or {}, raw_token)}
                for b in bids
            ],
            "messages": [
                {**m, "attachments": [publicize_file_ref(a, raw_token) for a in (m.get("attachments") or [])]}
                for m in messages
            ],
            "plans": [public_plan(p) for p in plans],
        }

    @api_router.get("/public/sub/{token}")
    async def public_sub_package(token: str):
        try:
            return await public_bundle(token, mark_viewed=True)
        except HTTPException:
            raise
        except Exception:
            logger.exception("Public bid package load failed")
            raise HTTPException(status_code=500, detail="Could not open that bid package. Please try again.")

    @api_router.post("/public/sub/{token}/bid")
    async def public_submit_bid(token: str, payload: BidSubmitIn):
        try:
            invite = await invitation_from_token(token)
            nxt = next_invite_status(invite.get("status"), "submit")
            if nxt != "submitted":
                raise HTTPException(status_code=400, detail="This invitation can no longer accept a bid.")
            amount = float(payload.amount)
            if amount <= 0:
                raise HTTPException(status_code=400, detail="Enter a bid amount greater than zero.")
            existing = await db.bids.find_one({"invitation_id": invite["id"]}, {"_id": 0}, sort=[("revision", -1)])
            revision = int((existing or {}).get("revision") or 0) + 1
            bid = {
                "id": new_id(),
                "package_id": invite["package_id"],
                "invitation_id": invite["id"],
                "job_id": invite["job_id"],
                "subcontractor_id": invite.get("subcontractor_id") or "",
                "company_name": invite.get("company_name") or "",
                "amount": round(amount, 2),
                "notes": (payload.notes or "").strip(),
                "exclusions": (payload.exclusions or "").strip(),
                "timeline": (payload.timeline or "").strip(),
                "pdf": (existing or {}).get("pdf") or {},
                "revision": revision,
                "created_at": now_iso(),
                "updated_at": now_iso(),
            }
            await db.bids.insert_one(bid)
            await db.bid_invitations.update_one({"id": invite["id"]}, {"$set": {"status": "submitted", "updated_at": now_iso()}})
            await add_activity(invite["package_id"], invite["job_id"], "bid", f"{invite.get('company_name') or 'Subcontractor'} submitted bid rev {revision}.")
            logger.info("Bid submitted invite=%s revision=%s", invite["id"], revision)
            bid.pop("_id", None)
            return bid
        except HTTPException:
            raise
        except Exception:
            logger.exception("Public bid submit failed")
            raise HTTPException(status_code=500, detail="Could not save that bid. Please try again.")

    @api_router.post("/public/sub/{token}/decline")
    async def public_decline(token: str):
        invite = await invitation_from_token(token)
        nxt = next_invite_status(invite.get("status"), "decline")
        await db.bid_invitations.update_one({"id": invite["id"]}, {"$set": {"status": nxt, "updated_at": now_iso()}})
        await add_activity(invite["package_id"], invite["job_id"], "declined", f"{invite.get('company_name') or 'Subcontractor'} declined.")
        return {"status": nxt}

    @api_router.post("/public/sub/{token}/bid-pdf")
    async def public_bid_pdf(token: str, file: UploadFile = File(...)):
        try:
            invite = await invitation_from_token(token)
            job = await db.jobs.find_one({"id": invite["job_id"]}, {"_id": 0})
            filename, mime, content = await read_drive_upload(file)
            if mime != "application/pdf":
                raise HTTPException(status_code=400, detail="Upload an official bid PDF.")
            saved = await persist_upload(job, "bid_pdf", filename, mime, content, invite["id"], invite["package_id"])
            pdf_meta = {
                "filename": filename,
                "drive_file_id": saved.get("drive_file_id") or "",
                "web_view_link": saved.get("web_view_link") or saved.get("url") or "",
                "file_id": saved.get("file_id") or "",
                "uploaded_at": now_iso(),
            }
            latest = await db.bids.find_one({"invitation_id": invite["id"]}, {"_id": 0}, sort=[("revision", -1)])
            if latest:
                await db.bids.update_one({"id": latest["id"]}, {"$set": {"pdf": pdf_meta, "updated_at": now_iso()}})
            else:
                await db.bids.insert_one({
                    "id": new_id(),
                    "package_id": invite["package_id"],
                    "invitation_id": invite["id"],
                    "job_id": invite["job_id"],
                    "subcontractor_id": invite.get("subcontractor_id") or "",
                    "company_name": invite.get("company_name") or "",
                    "amount": 0,
                    "notes": "",
                    "exclusions": "",
                    "timeline": "",
                    "pdf": pdf_meta,
                    "revision": 0,
                    "created_at": now_iso(),
                    "updated_at": now_iso(),
                })
            await add_activity(invite["package_id"], invite["job_id"], "pdf", f"{invite.get('company_name') or 'Subcontractor'} uploaded a bid PDF.")
            logger.info("Bid PDF saved invite=%s drive=%s", invite["id"], bool(saved.get("drive_file_id")))
            return pdf_meta
        except HTTPException:
            raise
        except Exception:
            logger.exception("Public bid PDF failed")
            raise HTTPException(status_code=500, detail="Could not save that bid PDF. Please try again.")

    @api_router.post("/public/sub/{token}/messages")
    async def public_post_message(token: str, payload: MessageIn):
        invite = await invitation_from_token(token)
        body = (payload.body or "").strip()
        if not body:
            raise HTTPException(status_code=400, detail="Write a message first.")
        request_kind = (payload.request_kind or "").strip().lower()
        if request_kind and request_kind not in MEDIA_REQUEST_TYPES:
            request_kind = "other"
        msg = {
            "id": new_id(),
            "package_id": invite["package_id"],
            "job_id": invite["job_id"],
            "invitation_id": invite["id"],
            "author_kind": "sub",
            "author_name": invite.get("company_name") or invite.get("name") or "Subcontractor",
            "author_email": invite.get("email") or "",
            "body": body,
            "question": bool(payload.question or request_kind or "?" in body),
            "request_kind": request_kind,
            "answered": False,
            "answer_to": "",
            "attachments": [],
            "created_at": now_iso(),
        }
        await db.bid_messages.insert_one(msg)
        await add_activity(invite["package_id"], invite["job_id"], "message", f"{msg['author_name']} sent a message.")
        msg.pop("_id", None)
        return msg

    @api_router.post("/public/sub/{token}/message-file")
    async def public_message_file(token: str, file: UploadFile = File(...), note: str = Form("")):
        invite = await invitation_from_token(token)
        job = await db.jobs.find_one({"id": invite["job_id"]}, {"_id": 0})
        filename, mime, content = await read_drive_upload(file)
        saved = await persist_upload(job, "bid_asset", filename, mime, content, new_id(), invite["package_id"])
        msg = {
            "id": new_id(),
            "package_id": invite["package_id"],
            "job_id": invite["job_id"],
            "invitation_id": invite["id"],
            "author_kind": "sub",
            "author_name": invite.get("company_name") or "Subcontractor",
            "author_email": invite.get("email") or "",
            "body": (note or "").strip() or f"Attached {filename}",
            "question": True,
            "answered": False,
            "answer_to": "",
            "attachments": [saved],
            "created_at": now_iso(),
        }
        await db.bid_messages.insert_one(msg)
        msg.pop("_id", None)
        return msg

    @api_router.get("/public/sub/{token}/files/{file_id}")
    async def public_bid_file(token: str, file_id: str):
        invite = await invitation_from_token(token)
        blob = await db.bid_file_blobs.find_one({"id": file_id, "job_id": invite["job_id"]})
        if not blob:
            raise HTTPException(status_code=404, detail="File not found")
        from fastapi.responses import Response
        return Response(content=bytes(blob.get("content") or b""), media_type=blob.get("mime_type") or "application/octet-stream")
