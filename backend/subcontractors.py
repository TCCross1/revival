"""Subcontractor portal domain: scopes, status, tokens, public sanitization.

Invite tokens are hashed at rest. This module never logs tokens, emails, or file bytes.
"""
from __future__ import annotations

import hashlib
import re
from datetime import datetime, timezone

SCOPES = [
    "Entire job",
    "Cabinetry",
    "Countertops",
    "Plumbing",
    "Electrical",
    "HVAC",
    "Flooring",
    "Painting",
    "Tile",
    "Drywall",
    "Framing",
    "Foundations",
    "Roofing",
    "Windows & doors",
    "Demolition",
    "Insulation",
    "Other",
]

INVITE_STATUSES = ("invited", "viewed", "submitted", "declined", "awarded")
PACKAGE_STATUSES = ("draft", "open", "awarded", "closed")
MEDIA_REQUEST_TYPES = ("photo", "video", "walkthrough", "measurement", "other")

SCOPE_TEMPLATES = {
    "Entire job": "Please review the full bid package — floor plans, 3D views, job-site photos, and specs — and return a complete bid with timeline, exclusions, and your official bid PDF.",
    "Cabinetry": "Bid cabinet supply and install from the Floor Plan Studio layout. Confirm box sizes, finish, hardware, and any field verification before you order.",
    "Countertops": "Bid fabrication and install from the plan and photos. Include template, sink cutouts, edge, and splash. Note any seams or unsupported spans.",
    "Plumbing": "Bid rough and/or finish plumbing for this kitchen/bath. Use the plan for fixture locations. Ask in-app if you need extra photos or measurements.",
    "Electrical": "Bid electrical from the plan (appliance circuits, lighting, panel notes). Request additional photos in the thread rather than a second site visit if possible.",
    "HVAC": "Bid HVAC work shown in the package. Call out access, equipment, and any work that is excluded.",
    "Flooring": "Bid flooring from the room sizes on the plan plus job-site photos. Include prep, transitions, and waste.",
    "Painting": "Bid prep and paint for the rooms in this package. Note sheen, colors TBD, and protection of existing work.",
    "Tile": "Bid tile supply and install from the plan and photos. Include substrate prep, waterproofing, pattern, and trim.",
    "Drywall": "Bid drywall hang, tape, finish, and texture match for the rooms in this package.",
    "Framing": "Bid framing / carpentry from the plans. Note load-bearing assumptions and any engineering you need from us.",
    "Foundations": "Bid foundation, crawlspace, or slab work from the package. Include repair method, waterproofing, drainage, and access notes. Request photos, video, or a walkthrough in-app if anything is unclear.",
    "Roofing": "Bid roofing from the photos and notes. Include tear-off, underlayment, ventilation, and disposal.",
    "Windows & doors": "Bid windows/doors supply and install. Confirm rough openings from the plan and request field measurements if needed.",
    "Demolition": "Bid selective demo and haul-off. Protect remaining finishes and coordinate dumpster / disposal.",
    "Insulation": "Bid insulation for the areas shown. Note R-value, vapor retarder, and access.",
    "Other": "Review the bid package and return pricing for the scope described. Ask questions in-app before you visit if possible.",
}

TRADE_CATEGORIES = SCOPES[1:]

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MAX_BID_BLOB_BYTES = 12 * 1024 * 1024
BID_ALLOWED_MIME = {
    "application/pdf",
    "image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif", "image/gif",
    "video/mp4", "video/quicktime", "video/webm",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "text/csv",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def hash_invite_token(raw: str) -> str:
    return hashlib.sha256(str(raw or "").encode("utf-8")).hexdigest()


def valid_email(value: str) -> bool:
    return bool(EMAIL_RE.match(str(value or "").strip().lower()))


def normalize_scope(value: str) -> str:
    text = (value or "").strip()
    if text in SCOPES:
        return text
    for scope in SCOPES:
        if scope.lower() == text.lower():
            return scope
    return text or "Entire job"


def template_for(scope: str) -> str:
    return SCOPE_TEMPLATES.get(normalize_scope(scope) or "Entire job") or SCOPE_TEMPLATES["Entire job"]


def next_invite_status(current: str, action: str) -> str:
    """Safe status transitions for an invitation."""
    cur = current if current in INVITE_STATUSES else "invited"
    act = (action or "").strip().lower()
    if cur == "awarded":
        return "awarded"
    if act == "view":
        if cur in ("invited",):
            return "viewed"
        return cur
    if act == "submit":
        if cur in ("declined", "awarded"):
            return cur
        return "submitted"
    if act == "decline":
        if cur == "awarded":
            return cur
        return "declined"
    if act == "award":
        if cur == "declined":
            return cur
        return "awarded"
    return cur


def public_job(job: dict) -> dict:
    job = job or {}
    return {
        "id": job.get("id") or "",
        "job_number": job.get("job_number") or "",
        "name": job.get("name") or "Job",
        "address": job.get("address") or "",
        "client_name": "",
        "status": job.get("status") or "",
    }


def public_plan(plan: dict) -> dict:
    plan = plan or {}
    return {
        "id": plan.get("id") or "",
        "name": plan.get("name") or "Floor plan",
        "project_type": plan.get("project_type") or "Kitchen",
        "document": plan.get("document") or {},
    }


def strip_invitation(doc: dict, *, include_token: bool = False) -> dict:
    row = dict(doc or {})
    row.pop("token_hash", None)
    row.pop("_id", None)
    if not include_token:
        row.pop("token", None)
    return row


def unanswered_count(messages: list) -> int:
    n = 0
    for msg in messages or []:
        if msg.get("question") and not msg.get("answered"):
            n += 1
    return n


def public_blob_path(token: str, file_id: str) -> str:
    """Public file URL. Caller must not log token."""
    fid = str(file_id or "").strip()
    tok = str(token or "").strip()
    if not fid or not tok:
        return ""
    return f"/api/public/sub/{tok}/files/{fid}"


def publicize_file_ref(row: dict, token: str) -> dict:
    """Rewrite blob fallback URLs so a sub can open files without a Revival login."""
    item = dict(row or {})
    remote = str(item.get("web_view_link") or item.get("url") or "")
    if remote.startswith("http"):
        return item
    fid = str(item.get("file_id") or "").strip()
    if not fid and "/bid-files/" in remote:
        fid = remote.rstrip("/").split("/")[-1]
    path = public_blob_path(token, fid)
    if path:
        item["url"] = path
        item["web_view_link"] = path
    return item


def ranking_key(row: dict) -> tuple:
    """Higher review volume first, then higher star rating, then name."""
    try:
        reviews = int(row.get("review_count") or 0)
    except (TypeError, ValueError):
        reviews = 0
    try:
        rating = float(row.get("rating") or 0)
    except (TypeError, ValueError):
        rating = 0.0
    name = str(row.get("company_name") or "").lower()
    return (-reviews, -rating, name)


async def seed_lexington_subcontractors(db) -> int:
    """Upsert Central KY trade directory seed (idempotent by company_name)."""
    import json
    from pathlib import Path

    path = Path(__file__).resolve().parent / "data" / "lexington_subcontractors_seed.json"
    if not path.exists():
        return 0
    try:
        rows = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return 0
    if not isinstance(rows, list):
        return 0
    inserted = 0
    now = now_iso()
    for raw in rows:
        if not isinstance(raw, dict):
            continue
        name = str(raw.get("company_name") or "").strip()
        if not name:
            continue
        existing = await db.subcontractors.find_one({"company_name": name}, {"_id": 0})
        if existing:
            # Keep user edits; only fill missing ranking fields.
            patch = {}
            if not existing.get("rating") and raw.get("rating"):
                patch["rating"] = float(raw.get("rating") or 0)
            if not existing.get("review_count") and raw.get("review_count"):
                patch["review_count"] = int(raw.get("review_count") or 0)
            if patch:
                patch["updated_at"] = now
                await db.subcontractors.update_one({"id": existing["id"]}, {"$set": patch})
            continue
        import uuid

        doc = {
            "id": f"sub_{uuid.uuid4().hex[:12]}",
            "company_name": name,
            "contact_name": str(raw.get("contact_name") or "").strip(),
            "email": str(raw.get("email") or "").strip().lower(),
            "phone": str(raw.get("phone") or "").strip(),
            "categories": [c for c in (raw.get("categories") or []) if c in TRADE_CATEGORIES or c],
            "license_number": str(raw.get("license_number") or "").strip(),
            "insurance_expires": "",
            "insurance_status": "unknown",
            "notes": str(raw.get("notes") or "").strip(),
            "rating": float(raw.get("rating") or 0),
            "review_count": int(raw.get("review_count") or 0),
            "city": str(raw.get("city") or "Lexington, KY").strip(),
            "website": str(raw.get("website") or "").strip(),
            "seeded": True,
            "created_at": now,
            "updated_at": now,
        }
        await db.subcontractors.insert_one(doc)
        inserted += 1
    return inserted
