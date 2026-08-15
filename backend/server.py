from fastapi import FastAPI, APIRouter, Depends, HTTPException, Request, Response, Cookie
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import re
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
import requests
import base64
import bcrypt
import jwt
import secrets
from html import escape
from datetime import datetime, timezone, timedelta
from fastapi.responses import StreamingResponse
from io import BytesIO
from pymongo import ReturnDocument
from email_pdf import build_estimate_pdf, build_invoice_pdf, build_contract_pdf, send_email, EMAIL_FROM_NAME, money

ROOT_DIR = Path(__file__).parent
# interpolate=False so passwords containing `$` (e.g. Cmc0103$$) are stored verbatim.
load_dotenv(ROOT_DIR.parent / ".env", interpolate=False)
load_dotenv(ROOT_DIR / ".env", interpolate=False)

from vapi_client import place_outbound_call, VapiConfigError, VapiRequestError
from phone import to_e164 as phone_to_e164

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

OWNER_EMAIL = "tccrossmusic@gmail.com"

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# ---------------- Helpers ----------------
def now_iso():
    return datetime.now(timezone.utc).isoformat()


def new_id():
    return str(uuid.uuid4())


def normalize_phone_field(phone: str, *, required: bool = False) -> str:
    try:
        return phone_to_e164(phone, required=required)
    except ValueError as ex:
        raise HTTPException(status_code=400, detail=str(ex))


DEFAULT_EXCLUSIONS = [
    "Any work not specifically listed in the Scope of Work.",
    "Concealed or hidden conditions (rot, mold, damaged framing, or plumbing/electrical inside walls) that were not visible at the time of the estimate.",
    "Permit fees and inspections not specifically listed in the estimate.",
    "Landscaping, appliances, furniture, and window treatments unless specifically included.",
    "Code-required upgrades that were not visible or known at the time of the estimate.",
    "Removal or remediation of hazardous materials (asbestos, lead-based paint, etc.).",
]


# ---------------- Models ----------------
class LineItem(BaseModel):
    description: str = ""
    quantity: float = 1
    unit_price: float = 0.0
    amount: float = 0.0


class Client(BaseModel):
    id: str = Field(default_factory=new_id)
    name: str
    phone: str = ""
    email: str = ""
    address: str = ""
    source: str = "Referral"
    status: str = "Lead"
    notes: str = ""
    lead_id: str = ""
    created_at: str = Field(default_factory=now_iso)


class ClientCreate(BaseModel):
    name: str
    phone: str = ""
    email: str = ""
    address: str = ""
    source: str = "Referral"
    status: str = "Lead"
    notes: str = ""


class Lead(BaseModel):
    id: str = Field(default_factory=new_id)
    name: str
    phone: str = ""
    email: str = ""
    address: str = ""
    project_type: str = "Kitchen Remodel"
    source: str = "Thumbtack"
    status: str = "New"
    notes: str = ""
    first_response_at: str = ""
    client_id: str = ""
    job_id: str = ""
    converted_at: str = ""
    last_vapi_call_id: str = ""
    last_called_at: str = ""
    created_at: str = Field(default_factory=now_iso)


class LeadCreate(BaseModel):
    name: str
    phone: str = ""
    email: str = ""
    address: str = ""
    project_type: str = "Kitchen Remodel"
    source: str = "Thumbtack"
    status: str = "New"
    notes: str = ""
    first_response_at: str = ""
    client_id: str = ""
    job_id: str = ""
    converted_at: str = ""


class Estimate(BaseModel):
    id: str = Field(default_factory=new_id)
    estimate_number: str = ""
    client_id: str = ""
    client_name: str = ""
    category: str = "Kitchen"
    status: str = "Draft"
    line_items: List[LineItem] = []
    subtotal: float = 0.0
    tax_rate: float = 0.0
    tax_amount: float = 0.0
    total: float = 0.0
    notes: str = ""
    created_at: str = Field(default_factory=now_iso)


class EstimateCreate(BaseModel):
    client_id: str = ""
    client_name: str = ""
    category: str = "Kitchen"
    status: str = "Draft"
    line_items: List[LineItem] = []
    tax_rate: float = 0.0
    notes: str = ""


class Expense(BaseModel):
    id: str = Field(default_factory=new_id)
    category: str = "Materials"
    description: str = ""
    amount: float = 0.0
    kind: str = "actual"  # committed | actual
    date: str = Field(default_factory=now_iso)


class Job(BaseModel):
    id: str = Field(default_factory=new_id)
    job_number: str = ""
    name: str = ""
    estimate_id: str = ""
    lead_id: str = ""
    client_id: str = ""
    client_name: str = ""
    status: str = "Active"
    budget: float = 0.0
    expenses: List[Expense] = []
    created_at: str = Field(default_factory=now_iso)


class JobCreate(BaseModel):
    name: str
    estimate_id: str = ""
    client_id: str = ""
    client_name: str = ""
    status: str = "Active"
    budget: float = 0.0


class Invoice(BaseModel):
    id: str = Field(default_factory=new_id)
    invoice_number: str = ""
    estimate_id: str = ""
    client_id: str = ""
    client_name: str = ""
    status: str = "Draft"
    line_items: List[LineItem] = []
    amount: float = 0.0
    amount_paid: float = 0.0
    due_date: str = ""
    created_at: str = Field(default_factory=now_iso)


class InvoiceCreate(BaseModel):
    estimate_id: str = ""
    client_id: str = ""
    client_name: str = ""
    status: str = "Draft"
    line_items: List[LineItem] = []
    amount: float = 0.0
    amount_paid: float = 0.0
    due_date: str = ""


class InvoicePaymentBody(BaseModel):
    amount: float


class OverheadCategory(BaseModel):
    id: str = Field(default_factory=new_id)
    name: str
    sort_order: int = 0
    created_at: str = Field(default_factory=now_iso)


class OverheadCategoryCreate(BaseModel):
    name: str
    sort_order: Optional[int] = None


class OverheadCategoryUpdate(BaseModel):
    name: Optional[str] = None
    sort_order: Optional[int] = None


class OverheadExpense(BaseModel):
    id: str = Field(default_factory=new_id)
    category_id: str
    description: str = ""
    amount: float = 0.0
    date: str = ""
    notes: str = ""
    created_at: str = Field(default_factory=now_iso)


class OverheadExpenseCreate(BaseModel):
    category_id: str
    description: str = ""
    amount: float = 0.0
    date: str = ""
    notes: str = ""


class OtherIncome(BaseModel):
    id: str = Field(default_factory=new_id)
    description: str = ""
    amount: float = 0.0
    date: str = ""
    notes: str = ""
    source: str = "other"
    created_at: str = Field(default_factory=now_iso)


class OtherIncomeCreate(BaseModel):
    description: str = ""
    amount: float = 0.0
    date: str = ""
    notes: str = ""
    source: str = "other"


class TaxClassification(BaseModel):
    id: str = Field(default_factory=new_id)
    year: int = 0
    source: str = "overhead"
    source_id: str = ""
    job_id: str = ""
    category_name: str = ""
    description: str = ""
    amount: float = 0.0
    date: str = ""
    tax_category: str = "unclassified"
    deductibility: str = "unclassified"
    deductible_amount: float = 0.0
    status: str = "pending"
    confidence: float = 0.0
    classified_by: str = ""
    notes: str = ""
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)


class TaxClassificationCreate(BaseModel):
    year: Optional[int] = None
    source: str = "overhead"
    source_id: str = ""
    job_id: str = ""
    category_name: str = ""
    description: str = ""
    amount: float = 0.0
    date: str = ""
    tax_category: str = "unclassified"
    deductibility: str = "unclassified"
    deductible_amount: float = 0.0
    status: str = "pending"
    confidence: float = 0.0
    classified_by: str = ""
    notes: str = ""


class TaxClassificationUpdate(BaseModel):
    tax_category: Optional[str] = None
    deductibility: Optional[str] = None
    deductible_amount: Optional[float] = None
    status: Optional[str] = None
    confidence: Optional[float] = None
    classified_by: Optional[str] = None
    notes: Optional[str] = None


class TaxQuestion(BaseModel):
    id: str = Field(default_factory=new_id)
    classification_id: str = ""
    question: str
    answer: str = ""
    status: str = "open"
    asked_by: str = "ai"
    created_at: str = Field(default_factory=now_iso)
    answered_at: str = ""


class TaxQuestionCreate(BaseModel):
    classification_id: str = ""
    question: str
    asked_by: str = "ai"


class TaxQuestionAnswer(BaseModel):
    answer: str


class TaxSummary(BaseModel):
    id: str = Field(default_factory=new_id)
    year: int
    income_total: float = 0.0
    deductions_total: float = 0.0
    estimated_tax: float = 0.0
    estimated_rate: float = 0.0
    pending_count: int = 0
    classified_count: int = 0
    open_questions: int = 0
    updated_at: str = Field(default_factory=now_iso)


class PaymentMilestone(BaseModel):
    label: str = ""
    amount: float = 0.0
    note: str = ""


class Contract(BaseModel):
    id: str = Field(default_factory=new_id)
    contract_number: str = ""
    estimate_id: str = ""
    invoice_id: str = ""
    client_id: str = ""
    contractor_name: str = ""
    contractor_address: str = ""
    contractor_phone: str = ""
    contractor_license: str = ""
    client_name: str = ""
    client_address: str = ""
    client_phone: str = ""
    client_email: str = ""
    project_address: str = ""
    project_description: str = ""
    line_items: List[LineItem] = []
    total: float = 0.0
    payment_schedule: List[PaymentMilestone] = []
    exclusions: List[str] = []
    change_order_markup: float = 20.0
    client_signature: str = ""
    client_signed_date: str = ""
    client_signed_by: str = ""
    contractor_signature: str = ""
    contractor_signed_date: str = ""
    contractor_signed_by: str = ""
    status: str = "Draft"
    sign_token: str = ""
    contractor_sign_token: str = ""
    signed_copies_sent: bool = False
    created_at: str = Field(default_factory=now_iso)


class ContractUpdate(BaseModel):
    contractor_name: Optional[str] = None
    contractor_address: Optional[str] = None
    contractor_phone: Optional[str] = None
    contractor_license: Optional[str] = None
    client_name: Optional[str] = None
    client_address: Optional[str] = None
    client_phone: Optional[str] = None
    client_email: Optional[str] = None
    project_address: Optional[str] = None
    project_description: Optional[str] = None
    payment_schedule: Optional[List[PaymentMilestone]] = None
    exclusions: Optional[List[str]] = None
    change_order_markup: Optional[float] = None
    client_signature: Optional[str] = None
    client_signed_date: Optional[str] = None
    contractor_signature: Optional[str] = None
    contractor_signed_date: Optional[str] = None
    status: Optional[str] = None


class CompanySettings(BaseModel):
    name: str = "Revival Pro"
    address: str = ""
    phone: str = ""
    license: str = ""
    email: str = ""


class User(BaseModel):
    user_id: str
    email: str
    name: str
    picture: str = ""
    role: str = "member"


class LoginBody(BaseModel):
    email: str
    password: str


class ChangePasswordBody(BaseModel):
    email: str
    current_password: str
    new_password: str


class TeamCreate(BaseModel):
    name: str = ""
    email: str
    password: str
    role: str = "member"


class SetPasswordBody(BaseModel):
    password: str


class ForgotPasswordBody(BaseModel):
    email: str
    base_url: str = ""


class ResetPasswordBody(BaseModel):
    token: str
    new_password: str


class UpdateProfileBody(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    current_password: Optional[str] = None
    new_password: Optional[str] = None


# ---------------- Password + JWT helpers ----------------
JWT_ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def create_access_token(user_id: str, email: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "type": "access",
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
    }
    return jwt.encode(payload, os.environ["JWT_SECRET"], algorithm=JWT_ALGORITHM)


# ---------------- Auth ----------------
async def get_current_user(
    request: Request,
    session_token: Optional[str] = Cookie(default=None),
    access_token: Optional[str] = Cookie(default=None),
):
    bearer = None
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        bearer = auth[7:]

    # 1) Google/session-token flow (cookie or bearer)
    token = session_token or bearer
    if token:
        session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
        if session:
            expires_at = session["expires_at"]
            if isinstance(expires_at, str):
                expires_at = datetime.fromisoformat(expires_at)
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)
            if expires_at >= datetime.now(timezone.utc):
                user_doc = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
                if user_doc:
                    return User(**user_doc)

    # 2) JWT flow (access_token cookie or bearer)
    jwt_token = access_token or bearer
    if jwt_token:
        try:
            payload = jwt.decode(jwt_token, os.environ["JWT_SECRET"], algorithms=[JWT_ALGORITHM])
            if payload.get("type") == "access":
                user_doc = await db.users.find_one({"user_id": payload.get("sub")}, {"_id": 0})
                if user_doc:
                    return User(**user_doc)
        except jwt.PyJWTError:
            pass

    raise HTTPException(status_code=401, detail="Not authenticated")


@api_router.post("/auth/login")
async def login(body: LoginBody, response: Response):
    email = body.email.strip().lower()
    try:
        user = await db.users.find_one({"email": email}, {"_id": 0})
        if not user or not user.get("password_hash") or not verify_password(body.password, user["password_hash"]):
            logger.warning("Login failed for %s", email)
            raise HTTPException(status_code=401, detail="Invalid email or password")
        token = create_access_token(user["user_id"], email)
        response.set_cookie("access_token", token, httponly=True, secure=True, samesite="none",
                            path="/", max_age=7 * 24 * 60 * 60)
        logger.info("Login succeeded for %s role=%s", email, user.get("role"))
        return {**User(**user).model_dump(), "session_token": token}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Login error for %s", email)
        raise HTTPException(status_code=503, detail="Sign-in is temporarily unavailable. Please try again.")


@api_router.post("/auth/change-password")
async def change_password(body: ChangePasswordBody):
    email = body.email.strip().lower()
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="No account found for that email.")
    if not user.get("password_hash"):
        raise HTTPException(status_code=400, detail="This account has no password yet. Sign in with Google, then set one.")
    if not verify_password(body.current_password, user["password_hash"]):
        raise HTTPException(status_code=400, detail="Your current password is incorrect.")
    if len(body.new_password) < 6:
        raise HTTPException(status_code=400, detail="New password must be at least 6 characters.")
    await db.users.update_one({"email": email}, {"$set": {"password_hash": hash_password(body.new_password)}})
    return {"status": "success"}


def require_admin(user: User = Depends(get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


@api_router.get("/team")
async def list_team(admin: User = Depends(require_admin)):
    docs = await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(1000)
    return [{
        "user_id": d["user_id"], "email": d["email"], "name": d.get("name", ""),
        "role": d.get("role", "member"), "created_at": d.get("created_at", ""),
    } for d in docs]


@api_router.post("/team")
async def create_team_member(body: TeamCreate, admin: User = Depends(require_admin)):
    email = body.email.strip().lower()
    if not email or not body.password:
        raise HTTPException(status_code=400, detail="Email and password are required.")
    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
        raise HTTPException(status_code=400, detail="Please enter a valid email address.")
    if len(body.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters.")
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="A user with that email already exists.")
    role = body.role if body.role in ("admin", "member") else "member"
    doc = {
        "user_id": f"user_{uuid.uuid4().hex[:12]}", "email": email,
        "name": body.name.strip() or email, "picture": "", "role": role,
        "password_hash": hash_password(body.password), "created_at": now_iso(),
    }
    await db.users.insert_one(doc)
    return {"user_id": doc["user_id"], "email": email, "name": doc["name"], "role": role}


@api_router.post("/team/{user_id}/set-password")
async def set_member_password(user_id: str, body: SetPasswordBody, admin: User = Depends(require_admin)):
    if len(body.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters.")
    res = await db.users.update_one({"user_id": user_id}, {"$set": {"password_hash": hash_password(body.password)}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"status": "success"}


@api_router.delete("/team/{user_id}")
async def delete_team_member(user_id: str, admin: User = Depends(require_admin)):
    if user_id == admin.user_id:
        raise HTTPException(status_code=400, detail="You can't remove your own account.")
    await db.users.delete_one({"user_id": user_id})
    return {"status": "success"}


@api_router.post("/auth/forgot-password")
async def forgot_password(body: ForgotPasswordBody):
    email = body.email.strip().lower()
    base = (body.base_url or "").rstrip("/")
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if user and base.startswith("https://"):
        token = secrets.token_urlsafe(32)
        await db.password_reset_tokens.insert_one({
            "token": token, "user_id": user["user_id"], "email": email,
            "expires_at": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(), "used": False,
        })
        link = f"{base}/reset-password?token={token}"
        html = (
            f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F7F8;padding:24px 0"><tr><td align="center">'
            f'<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #E2E8F0">'
            f'<tr><td style="background:#0A4D68;padding:24px 28px;font-family:Arial,sans-serif">'
            f'<div style="color:#ffffff;font-size:22px;font-weight:bold;letter-spacing:1px">REVIVAL PRO</div></td></tr>'
            f'<tr><td style="padding:28px;font-family:Arial,sans-serif;color:#061A23">'
            f'<p style="font-size:15px;margin:0 0 12px">Reset your password</p>'
            f'<p style="font-size:14px;color:#4B6370;line-height:1.6;margin:0 0 22px">We received a request to reset your Revival Pro password. This link expires in 1 hour. If you didn\'t ask for this, you can safely ignore this email.</p>'
            f'<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 22px"><tr><td style="border-radius:10px;background:#C9A227">'
            f'<a href="{link}" style="display:inline-block;padding:14px 28px;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;color:#061A23;text-decoration:none">Reset Password</a>'
            f'</td></tr></table>'
            f'<p style="font-size:12px;color:#8AA0AB;line-height:1.5;margin:0">Or paste this secure link into your browser:<br/>{escape(link)}</p>'
            f'</td></tr></table></td></tr></table>'
        )
        try:
            await send_email(to=email, subject="Reset your Revival Pro password", html=html)
        except Exception as ex:
            logger.error(f"Forgot-password email failed: {ex}")
    return {"status": "success"}


@api_router.post("/auth/reset-password")
async def reset_password(body: ResetPasswordBody):
    rec = await db.password_reset_tokens.find_one({"token": body.token}, {"_id": 0})
    if not rec or rec.get("used"):
        raise HTTPException(status_code=400, detail="This reset link is invalid or has already been used.")
    exp = datetime.fromisoformat(rec["expires_at"])
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    if exp < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="This reset link has expired. Please request a new one.")
    if len(body.new_password) < 6:
        raise HTTPException(status_code=400, detail="New password must be at least 6 characters.")
    await db.users.update_one({"user_id": rec["user_id"]}, {"$set": {"password_hash": hash_password(body.new_password)}})
    await db.password_reset_tokens.update_one({"token": body.token}, {"$set": {"used": True}})
    return {"status": "success"}


@api_router.post("/auth/update-profile")
async def update_profile(body: UpdateProfileBody, response: Response, user: User = Depends(get_current_user)):
    udoc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0})
    if not udoc:
        raise HTTPException(status_code=404, detail="User not found")
    updates = {}
    if body.name is not None and body.name.strip():
        updates["name"] = body.name.strip()
    if body.email:
        new_email = body.email.strip().lower()
        if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", new_email):
            raise HTTPException(status_code=400, detail="Please enter a valid email address.")
        if new_email != udoc["email"]:
            clash = await db.users.find_one({"email": new_email})
            if clash and clash.get("user_id") != user.user_id:
                raise HTTPException(status_code=400, detail="That email is already in use.")
            updates["email"] = new_email
    if body.new_password:
        if len(body.new_password) < 6:
            raise HTTPException(status_code=400, detail="New password must be at least 6 characters.")
        ph = udoc.get("password_hash")
        if ph and (not body.current_password or not verify_password(body.current_password, ph)):
            raise HTTPException(status_code=400, detail="Your current password is incorrect.")
        updates["password_hash"] = hash_password(body.new_password)
    if updates:
        await db.users.update_one({"user_id": user.user_id}, {"$set": updates})
    fresh = await db.users.find_one({"user_id": user.user_id}, {"_id": 0})
    token = create_access_token(fresh["user_id"], fresh["email"])
    response.set_cookie("access_token", token, httponly=True, secure=True, samesite="none",
                        path="/", max_age=7 * 24 * 60 * 60)
    return {**User(**fresh).model_dump(), "session_token": token}


@api_router.post("/auth/session")
async def process_session(request: Request, response: Response):
    body = await request.json()
    session_id = body.get("session_id")
    if not session_id:
        raise HTTPException(status_code=400, detail="Missing session_id")

    resp = requests.get(
        "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
        headers={"X-Session-ID": session_id},
        timeout=15,
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid session_id")
    data = resp.json()

    email = data["email"]
    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {"name": data.get("name", existing.get("name", "")), "picture": data.get("picture", "")}},
        )
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({
            "user_id": user_id,
            "email": email,
            "name": data.get("name", ""),
            "picture": data.get("picture", ""),
            "created_at": now_iso(),
        })

    session_token = data["session_token"]
    expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    await db.user_sessions.insert_one({
        "user_id": user_id,
        "session_token": session_token,
        "expires_at": expires_at.isoformat(),
        "created_at": now_iso(),
    })

    response.set_cookie(
        key="session_token",
        value=session_token,
        httponly=True,
        secure=True,
        samesite="none",
        path="/",
        max_age=7 * 24 * 60 * 60,
    )
    user_doc = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    # Return session_token in body as a Bearer fallback (proxied preview envs can block cookies)
    return {**user_doc, "session_token": session_token}


@api_router.get("/auth/me", response_model=User)
async def auth_me(user: User = Depends(get_current_user)):
    return user


@api_router.post("/auth/logout")
async def logout(request: Request, response: Response, session_token: Optional[str] = Cookie(default=None)):
    token = session_token
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if token:
        await db.user_sessions.delete_one({"session_token": token})
    response.delete_cookie("session_token", path="/")
    return {"success": True}


# ---------------- Numbering ----------------
async def next_number(prefix: str) -> str:
    """Atomically allocate PREFIX-YEAR-0001 via the counters collection."""
    year = datetime.now(timezone.utc).year
    key = f"{prefix}-{year}"
    try:
        rec = await db.counters.find_one_and_update(
            {"_id": key},
            {"$inc": {"seq": 1}},
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
        seq = int((rec or {}).get("seq") or 1)
        return f"{prefix}-{year}-{seq:04d}"
    except Exception as ex:
        logger.error(f"Atomic numbering failed prefix={prefix}: {ex}")
        raise HTTPException(status_code=500, detail="Could not assign the next document number. Please try again.")


async def init_counters():
    """Raise each yearly counter to the max existing number so we never reuse."""
    year = datetime.now(timezone.utc).year
    mapping = [
        ("EST", db.estimates, "estimate_number"),
        ("INV", db.invoices, "invoice_number"),
        ("CON", db.contracts, "contract_number"),
        ("JOB", db.jobs, "job_number"),
    ]
    for prefix, coll, field in mapping:
        key = f"{prefix}-{year}"
        try:
            docs = await coll.find(
                {field: {"$regex": f"^{re.escape(prefix)}-{year}-"}},
                {field: 1, "_id": 0},
            ).to_list(10000)
            max_seq = 0
            for d in docs:
                try:
                    max_seq = max(max_seq, int(str(d.get(field, "")).rsplit("-", 1)[-1]))
                except (TypeError, ValueError):
                    pass
            existing = await db.counters.find_one({"_id": key})
            current = int((existing or {}).get("seq") or 0)
            if max_seq > current:
                await db.counters.update_one({"_id": key}, {"$set": {"seq": max_seq}}, upsert=True)
                logger.info(f"Counter {key} initialized to {max_seq}")
        except Exception as ex:
            logger.error(f"init_counters failed for {key}: {ex}")


async def resolve_client_ref(client_id: str = "", client_name: str = ""):
    """Return (client_id, client_name) with id as the source of truth."""
    cid = (client_id or "").strip()
    name = (client_name or "").strip()
    if cid:
        doc = await db.clients.find_one({"id": cid}, {"_id": 0})
        if doc:
            return doc["id"], doc.get("name", name)
    if name:
        doc = await db.clients.find_one({"name": name}, {"_id": 0})
        if doc:
            return doc["id"], doc.get("name", name)
    return cid, name


async def backfill_client_ids():
    """Attach client_id on legacy jobs/invoices/contracts that only stored a name."""
    try:
        clients = await db.clients.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(10000)
        by_name = {c.get("name"): c.get("id") for c in clients if c.get("name") and c.get("id")}
        for coll_name in ("jobs", "invoices", "contracts"):
            coll = db[coll_name]
            orphans = await coll.find(
                {"$or": [{"client_id": {"$exists": False}}, {"client_id": ""}]},
                {"_id": 0, "id": 1, "client_name": 1, "estimate_id": 1},
            ).to_list(5000)
            for doc in orphans:
                cid = ""
                if doc.get("estimate_id"):
                    est = await db.estimates.find_one({"id": doc["estimate_id"]}, {"_id": 0, "client_id": 1})
                    if est:
                        cid = (est.get("client_id") or "").strip()
                if not cid:
                    cid = by_name.get(doc.get("client_name", ""), "")
                if cid:
                    await coll.update_one({"id": doc["id"]}, {"$set": {"client_id": cid}})
        logger.info("Client-id backfill complete.")
    except Exception as ex:
        logger.error(f"backfill_client_ids failed: {ex}")


async def docs_for_client(coll, client_id: str, client_name: str):
    """Load related docs by client_id; name is only a fallback for legacy rows."""
    clauses = [{"client_id": client_id}]
    if client_name:
        clauses.append({
            "$and": [
                {"$or": [{"client_id": {"$exists": False}}, {"client_id": ""}]},
                {"client_name": client_name},
            ]
        })
    return await coll.find({"$or": clauses}, {"_id": 0}).sort("created_at", -1).to_list(500)


# ---------------- Clients ----------------
@api_router.get("/clients", response_model=List[Client])
async def list_clients(user: User = Depends(get_current_user)):
    docs = await db.clients.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return [Client(**d) for d in docs]


@api_router.post("/clients", response_model=Client)
async def create_client(payload: ClientCreate, user: User = Depends(get_current_user)):
    try:
        data = payload.model_dump()
        data["phone"] = normalize_phone_field(data.get("phone") or "")
        obj = Client(**data)
        await db.clients.insert_one(obj.model_dump())
        logger.info(f"Created client {obj.id} user={user.user_id}")
        return obj
    except HTTPException:
        raise
    except Exception as ex:
        logger.error(f"Create client failed: {ex}")
        raise HTTPException(status_code=500, detail="Could not create the client. Please try again.")


@api_router.put("/clients/{client_id}", response_model=Client)
async def update_client(client_id: str, payload: ClientCreate, user: User = Depends(get_current_user)):
    try:
        existing = await db.clients.find_one({"id": client_id}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="Client not found")
        data = payload.model_dump()
        data["phone"] = normalize_phone_field(data.get("phone") or "")
        updated = {**existing, **data}
        await db.clients.update_one({"id": client_id}, {"$set": updated})
        new_name = (payload.name or "").strip()
        if new_name and new_name != existing.get("name"):
            try:
                await db.estimates.update_many({"client_id": client_id}, {"$set": {"client_name": new_name}})
                await db.jobs.update_many({"client_id": client_id}, {"$set": {"client_name": new_name}})
                await db.invoices.update_many({"client_id": client_id}, {"$set": {"client_name": new_name}})
                await db.contracts.update_many({"client_id": client_id}, {"$set": {"client_name": new_name}})
            except Exception as ex:
                logger.error(f"Failed to sync denormalized client_name for {client_id}: {ex}")
        logger.info(f"Updated client {client_id} user={user.user_id}")
        return Client(**updated)
    except HTTPException:
        raise
    except Exception as ex:
        logger.error(f"Update client failed client_id={client_id}: {ex}")
        raise HTTPException(status_code=500, detail="Could not update the client. Please try again.")


@api_router.delete("/clients/{client_id}")
async def delete_client(client_id: str, user: User = Depends(get_current_user)):
    await db.clients.delete_one({"id": client_id})
    return {"success": True}


@api_router.get("/clients/{client_id}/detail")
async def client_detail(client_id: str, user: User = Depends(get_current_user)):
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    estimates = await db.estimates.find({"client_id": client_id}, {"_id": 0}).sort("created_at", -1).to_list(500)
    jobs = await docs_for_client(db.jobs, client_id, client.get("name", ""))
    invoices = await docs_for_client(db.invoices, client_id, client.get("name", ""))

    est_open = [e for e in estimates if e.get("status") in {"Draft", "Sent", "Follow-up"}]
    won_value = round(sum(e.get("total", 0) for e in estimates if e.get("status") == "Won"), 2)
    billed = round(sum(i.get("amount", 0) for i in invoices), 2)
    paid = round(sum(i.get("amount_paid", 0) for i in invoices), 2)

    return {
        "client": Client(**client).model_dump(),
        "estimates": [Estimate(**e).model_dump() for e in estimates],
        "jobs": [Job(**j).model_dump() for j in jobs],
        "invoices": [Invoice(**i).model_dump() for i in invoices],
        "summary": {
            "estimates_count": len(estimates),
            "open_pipeline": round(sum(e.get("total", 0) for e in est_open), 2),
            "won_value": won_value,
            "jobs_count": len(jobs),
            "billed": billed,
            "collected": paid,
            "outstanding": round(billed - paid, 2),
        },
    }


# ---------------- Leads ----------------
LIVE_LEAD_STATUSES = {"New", "Hot", "Warm", "Contacted"}


def parse_iso_dt(value):
    if not value:
        return None
    try:
        text = str(value).replace("Z", "+00:00")
        dt = datetime.fromisoformat(text)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def lead_wait_meta(doc: dict):
    created = parse_iso_dt(doc.get("created_at")) or datetime.now(timezone.utc)
    responded = parse_iso_dt(doc.get("first_response_at"))
    end = responded or datetime.now(timezone.utc)
    seconds = max(int((end - created).total_seconds()), 0)
    mins, secs = divmod(seconds, 60)
    hours, mins = divmod(mins, 60)
    days, hours = divmod(hours, 24)
    if days > 0:
        label = f"{days}d {hours}h ago" if hours else f"{days}d ago"
    elif hours > 0:
        label = f"{hours}h {mins:02d}m ago" if mins else f"{hours}h ago"
    elif mins > 0:
        label = f"{mins}m ago"
    else:
        label = f"{secs}s ago"
    if responded:
        label = label.replace(" ago", "") + " to first reply"
    urgent = (not responded) and seconds < 15 * 60
    return seconds, label, urgent


def serialize_lead(doc: dict):
    lead = Lead(**doc).model_dump()
    seconds, label, urgent = lead_wait_meta(doc)
    lead["wait_seconds"] = seconds
    lead["wait_label"] = label
    lead["is_urgent"] = urgent
    lead["is_live"] = (lead.get("status") or "") in LIVE_LEAD_STATUSES
    lead["converted"] = bool(lead.get("client_id") and lead.get("job_id"))
    return lead


async def seed_leads():
    try:
        if await db.leads.count_documents({}) > 0:
            return
        now = datetime.now(timezone.utc)
        samples = [
            ("James Carter", "(512) 555-0144", "james.carter@email.com", "1423 Oakridge Drive, Austin, TX 78704", "Kitchen Remodel", "Angi", "New", 2, "Wants a full kitchen refresh this fall."),
            ("Lisa Montano", "(512) 555-0188", "lisa.m@email.com", "880 Barton Hills Dr, Austin, TX", "Roof Replacement", "Thumbtack", "Contacted", 65, "Storm damage on the south slope."),
            ("Marcus Hale", "(512) 555-0112", "mhale@email.com", "2100 South Lamar, Austin, TX", "Bathroom Remodel", "Angi", "Hot", 8, "Master bath leak — wants someone this week."),
            ("Priya Shah", "(512) 555-0160", "priya.shah@email.com", "44 Willow Creek, Round Rock, TX", "Deck Build", "Referral", "Booked", 180, "Estimate booked for Saturday morning."),
            ("Evan Brooks", "(512) 555-0191", "evan.b@email.com", "901 Congress Ave, Austin, TX", "Addition", "Website", "Warm", 95, "Considering a backyard ADU."),
            ("Sofia Alvarez", "(512) 555-0133", "sofia.a@email.com", "12 Lakeview Ct, Cedar Park, TX", "Exterior", "Thumbtack", "New", 18, "Siding and paint quote."),
            ("Noah Patel", "(512) 555-0177", "noah.p@email.com", "5500 Burnet Rd, Austin, TX", "Basement", "Google", "Contacted", 240, "Unfinished basement to living space."),
            ("Hannah Kim", "(512) 555-0104", "hannah.k@email.com", "77 Spicewood Springs, Austin, TX", "Flooring", "Angi", "Completed", 1440, "Install finished last week."),
        ]
        docs = []
        for name, phone, email, address, project, source, status, mins_ago, notes in samples:
            created = (now - timedelta(minutes=mins_ago)).isoformat()
            first = ""
            if status in {"Contacted", "Booked", "Completed"}:
                first = (now - timedelta(minutes=max(mins_ago - 4, 1))).isoformat()
            docs.append(Lead(
                name=name, phone=phone_to_e164(phone), email=email, address=address,
                project_type=project, source=source, status=status, notes=notes,
                first_response_at=first, created_at=created,
            ).model_dump())
        await db.leads.insert_many(docs)
        logger.info(f"Seeded {len(docs)} demo leads.")
    except Exception as ex:
        logger.error(f"seed_leads failed: {ex}")


@api_router.get("/leads")
async def list_leads(user: User = Depends(get_current_user), source: str = "", status: str = "", q: str = ""):
    try:
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
        for keep in ("client_id", "job_id", "converted_at", "last_vapi_call_id", "last_called_at"):
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


@api_router.post("/leads/{lead_id}/convert")
async def convert_lead(lead_id: str, user: User = Depends(get_current_user)):
    """Create (or reuse) a Client and Job from this lead. Safe to call more than once."""
    try:
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
                phone=normalize_phone_field(lead.get("phone") or ""),
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
            logger.info(f"Converted lead {lead_id} created client {client['id']} user={user.user_id}")
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
            logger.info(f"Converted lead {lead_id} created job {job['job_number']} user={user.user_id}")
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
        logger.info(f"Lead {lead_id} converted client={client['id']} job={job['id']} user={user.user_id}")
        return {
            "lead": serialize_lead(fresh),
            "client": Client(**client).model_dump(),
            "job": Job(**job).model_dump(),
            "created": {"client": created_client, "job": created_job},
        }
    except HTTPException:
        raise
    except Exception as ex:
        logger.error(f"Convert lead failed lead_id={lead_id}: {ex}")
        raise HTTPException(status_code=500, detail="Could not convert this lead to a client and job. Please try again.")


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
    lead_doc = None
    if lead_id:
        try:
            stamp = {
                "last_vapi_call_id": result["call_id"],
                "last_called_at": now_iso(),
            }
            existing = await db.leads.find_one({"id": lead_id}, {"_id": 0})
            if existing:
                if (existing.get("status") or "New") in {"New", "Hot", "Warm"}:
                    stamp["status"] = "Contacted"
                    if not existing.get("first_response_at"):
                        stamp["first_response_at"] = now_iso()
                await db.leads.update_one({"id": lead_id}, {"$set": stamp})
                fresh = await db.leads.find_one({"id": lead_id}, {"_id": 0})
                lead_doc = serialize_lead(fresh)
                logger.info(
                    f"Recorded Vapi call {result['call_id']} on lead {lead_id} user={user.user_id}"
                )
        except Exception as ex:
            logger.error(f"Could not record Vapi call on lead {lead_id}: {ex}")
    return {"call": result, "lead": lead_doc}


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


# ---------------- Estimates ----------------
def compute_totals(line_items, tax_rate):
    items = []
    subtotal = 0.0
    for li in line_items:
        d = li if isinstance(li, dict) else li.model_dump()
        amount = round(float(d.get("quantity", 1)) * float(d.get("unit_price", 0)), 2)
        d["amount"] = amount
        subtotal += amount
        items.append(d)
    subtotal = round(subtotal, 2)
    tax_amount = round(subtotal * (float(tax_rate) / 100.0), 2)
    total = round(subtotal + tax_amount, 2)
    return items, subtotal, tax_amount, total


@api_router.get("/estimates", response_model=List[Estimate])
async def list_estimates(user: User = Depends(get_current_user)):
    docs = await db.estimates.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return [Estimate(**d) for d in docs]


@api_router.post("/estimates", response_model=Estimate)
async def create_estimate(payload: EstimateCreate, user: User = Depends(get_current_user)):
    items, subtotal, tax_amount, total = compute_totals(payload.line_items, payload.tax_rate)
    number = await next_number("EST")
    cid, cname = await resolve_client_ref(payload.client_id, payload.client_name)
    obj = Estimate(
        estimate_number=number,
        client_id=cid,
        client_name=cname,
        category=payload.category,
        status=payload.status,
        line_items=[LineItem(**i) for i in items],
        subtotal=subtotal,
        tax_rate=payload.tax_rate,
        tax_amount=tax_amount,
        total=total,
        notes=payload.notes,
    )
    await db.estimates.insert_one(obj.model_dump())
    return obj


@api_router.put("/estimates/{estimate_id}", response_model=Estimate)
async def update_estimate(estimate_id: str, payload: EstimateCreate, user: User = Depends(get_current_user)):
    existing = await db.estimates.find_one({"id": estimate_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Estimate not found")
    items, subtotal, tax_amount, total = compute_totals(payload.line_items, payload.tax_rate)
    cid, cname = await resolve_client_ref(payload.client_id, payload.client_name)
    updated = {
        **existing,
        "client_id": cid,
        "client_name": cname,
        "category": payload.category,
        "status": payload.status,
        "line_items": items,
        "subtotal": subtotal,
        "tax_rate": payload.tax_rate,
        "tax_amount": tax_amount,
        "total": total,
        "notes": payload.notes,
    }
    await db.estimates.update_one({"id": estimate_id}, {"$set": updated})
    return Estimate(**updated)


@api_router.delete("/estimates/{estimate_id}")
async def delete_estimate(estimate_id: str, user: User = Depends(get_current_user)):
    await db.estimates.delete_one({"id": estimate_id})
    return {"success": True}


@api_router.post("/estimates/{estimate_id}/convert", response_model=Invoice)
async def convert_estimate(estimate_id: str, user: User = Depends(get_current_user)):
    try:
        est = await db.estimates.find_one({"id": estimate_id}, {"_id": 0})
        if not est:
            raise HTTPException(status_code=404, detail="Estimate not found")
        if est.get("status") != "Won":
            raise HTTPException(status_code=400, detail="Only Won estimates can be converted to an invoice")
        existing_inv = await db.invoices.find_one({"estimate_id": estimate_id}, {"_id": 0})
        if existing_inv:
            return Invoice(**existing_inv)
        number = await next_number("INV")
        due = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
        cid, cname = await resolve_client_ref(est.get("client_id", ""), est.get("client_name", ""))
        obj = Invoice(
            invoice_number=number,
            estimate_id=estimate_id,
            client_id=cid,
            client_name=cname,
            status="Draft",
            line_items=[LineItem(**i) for i in est.get("line_items", [])],
            amount=est.get("total", 0.0),
            amount_paid=0.0,
            due_date=due,
        )
        await db.invoices.insert_one(obj.model_dump())
        logger.info(f"Converted estimate {estimate_id} to invoice {obj.invoice_number} user={user.user_id}")
        return obj
    except HTTPException:
        raise
    except Exception as ex:
        logger.error(f"Convert estimate failed estimate_id={estimate_id}: {ex}")
        raise HTTPException(status_code=500, detail="Could not convert this estimate to an invoice. Please try again.")


@api_router.get("/estimates/{estimate_id}/pdf")
async def estimate_pdf(estimate_id: str, user: User = Depends(get_current_user)):
    est = await db.estimates.find_one({"id": estimate_id}, {"_id": 0})
    if not est:
        raise HTTPException(status_code=404, detail="Estimate not found")
    client = await db.clients.find_one({"id": est.get("client_id")}, {"_id": 0}) if est.get("client_id") else None
    pdf_bytes = build_estimate_pdf(est, client)
    filename = f"{est.get('estimate_number', 'estimate')}.pdf"
    return StreamingResponse(
        BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@api_router.post("/estimates/{estimate_id}/send-email")
async def send_estimate_email(estimate_id: str, user: User = Depends(get_current_user)):
    est = await db.estimates.find_one({"id": estimate_id}, {"_id": 0})
    if not est:
        raise HTTPException(status_code=404, detail="Estimate not found")
    client = await db.clients.find_one({"id": est.get("client_id")}, {"_id": 0}) if est.get("client_id") else None
    to = (client or {}).get("email", "").strip()
    if not to:
        raise HTTPException(status_code=400, detail="This client has no email address on file. Add one first.")

    pdf_bytes = build_estimate_pdf(est, client)
    b64 = base64.b64encode(pdf_bytes).decode()
    number = est.get("estimate_number", "")

    rows = ""
    for li in est.get("line_items", []):
        rows += (
            f'<tr>'
            f'<td style="padding:8px 10px;border-bottom:1px solid #E2E8F0;font-family:Arial,sans-serif;font-size:13px;color:#061A23">{escape(str(li.get("description","")))}</td>'
            f'<td align="right" style="padding:8px 10px;border-bottom:1px solid #E2E8F0;font-family:Arial,sans-serif;font-size:13px;color:#4B6370">{("{:g}".format(float(li.get("quantity",0))))}</td>'
            f'<td align="right" style="padding:8px 10px;border-bottom:1px solid #E2E8F0;font-family:Arial,sans-serif;font-size:13px;color:#4B6370">{escape(money(li.get("unit_price",0)))}</td>'
            f'<td align="right" style="padding:8px 10px;border-bottom:1px solid #E2E8F0;font-family:Arial,sans-serif;font-size:13px;color:#061A23">{escape(money(li.get("amount",0)))}</td>'
            f'</tr>'
        )

    client_name = escape((client or {}).get("name", "there"))
    subject = f"Your estimate from {EMAIL_FROM_NAME} — {number}"
    html = (
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F7F8;padding:24px 0">'
        f'<tr><td align="center">'
        f'<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #E2E8F0">'
        f'<tr><td style="background:#0A4D68;padding:24px 28px;font-family:Arial,sans-serif">'
        f'<div style="color:#ffffff;font-size:22px;font-weight:bold;letter-spacing:1px">REVIVAL PRO</div>'
        f'<div style="color:#C9A227;font-size:12px;margin-top:2px">Residential Remodeling</div>'
        f'</td></tr>'
        f'<tr><td style="padding:28px;font-family:Arial,sans-serif;color:#061A23">'
        f'<p style="font-size:15px;margin:0 0 12px">Hi {client_name},</p>'
        f'<p style="font-size:14px;color:#4B6370;line-height:1.5;margin:0 0 20px">'
        f'Thank you for the opportunity to work with you. Please find your estimate '
        f'<strong>{escape(number)}</strong> for your <strong>{escape(est.get("category",""))}</strong> project below. '
        f'A PDF copy is attached for your records.</p>'
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:8px">'
        f'<tr style="background:#0A4D68">'
        f'<td style="padding:8px 10px;color:#fff;font-family:Arial,sans-serif;font-size:12px;font-weight:bold">Description</td>'
        f'<td align="right" style="padding:8px 10px;color:#fff;font-family:Arial,sans-serif;font-size:12px;font-weight:bold">Qty</td>'
        f'<td align="right" style="padding:8px 10px;color:#fff;font-family:Arial,sans-serif;font-size:12px;font-weight:bold">Unit</td>'
        f'<td align="right" style="padding:8px 10px;color:#fff;font-family:Arial,sans-serif;font-size:12px;font-weight:bold">Amount</td>'
        f'</tr>{rows}</table>'
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td></td>'
        f'<td align="right" style="font-family:Arial,sans-serif;font-size:13px;color:#4B6370;padding:2px 10px">Subtotal: {escape(money(est.get("subtotal",0)))}</td></tr>'
        f'<tr><td></td><td align="right" style="font-family:Arial,sans-serif;font-size:13px;color:#4B6370;padding:2px 10px">Tax ({est.get("tax_rate",0)}%): {escape(money(est.get("tax_amount",0)))}</td></tr>'
        f'<tr><td></td><td align="right" style="font-family:Arial,sans-serif;font-size:17px;color:#0A4D68;font-weight:bold;padding:6px 10px;border-top:2px solid #0A4D68">Total: {escape(money(est.get("total",0)))}</td></tr>'
        f'</table>'
        f'<p style="font-size:13px;color:#4B6370;line-height:1.5;margin:22px 0 0">This estimate is valid for 30 days. '
        f'Just reply to this email if you have any questions or would like to move forward.</p>'
        f'</td></tr>'
        f'<tr><td style="padding:16px 28px;background:#F4F7F8;font-family:Arial,sans-serif;font-size:11px;color:#8AA0AB">'
        f'Sent by {escape(EMAIL_FROM_NAME)}. We never ask for your password or payment details by email.'
        f'</td></tr>'
        f'</table></td></tr></table>'
    )

    email_id = await send_email(
        to=to,
        subject=subject,
        html=html,
        attachments=[{"filename": f"{number}.pdf", "content": b64}],
    )
    if est.get("status") == "Draft":
        await db.estimates.update_one({"id": estimate_id}, {"$set": {"status": "Sent"}})
    return {"status": "success", "email_id": email_id, "sent_to": to}


# ---------------- Jobs ----------------
@api_router.get("/jobs", response_model=List[Job])
async def list_jobs(user: User = Depends(get_current_user)):
    docs = await db.jobs.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return [Job(**d) for d in docs]


@api_router.post("/jobs", response_model=Job)
async def create_job(payload: JobCreate, user: User = Depends(get_current_user)):
    number = await next_number("JOB")
    cid, cname = await resolve_client_ref(payload.client_id, payload.client_name)
    if payload.estimate_id and not cid:
        est = await db.estimates.find_one({"id": payload.estimate_id}, {"_id": 0})
        if est:
            cid, cname = await resolve_client_ref(est.get("client_id", ""), est.get("client_name", "") or cname)
    data = payload.model_dump()
    data["client_id"] = cid
    data["client_name"] = cname
    obj = Job(job_number=number, **data)
    await db.jobs.insert_one(obj.model_dump())
    return obj


@api_router.put("/jobs/{job_id}", response_model=Job)
async def update_job(job_id: str, payload: JobCreate, user: User = Depends(get_current_user)):
    existing = await db.jobs.find_one({"id": job_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Job not found")
    cid, cname = await resolve_client_ref(payload.client_id or existing.get("client_id", ""), payload.client_name or existing.get("client_name", ""))
    data = payload.model_dump()
    data["client_id"] = cid
    data["client_name"] = cname
    updated = {**existing, **data}
    await db.jobs.update_one({"id": job_id}, {"$set": updated})
    return Job(**updated)


@api_router.delete("/jobs/{job_id}")
async def delete_job(job_id: str, user: User = Depends(get_current_user)):
    await db.jobs.delete_one({"id": job_id})
    return {"success": True}


@api_router.post("/jobs/{job_id}/expenses", response_model=Job)
async def add_expense(job_id: str, expense: Expense, user: User = Depends(get_current_user)):
    try:
        existing = await db.jobs.find_one({"id": job_id}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="Job not found")
        exp = expense.model_dump()
        if not exp.get("id"):
            exp["id"] = new_id()
        try:
            amount = float(exp.get("amount") or 0)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="Expense amount must be a valid number.")
        if amount <= 0:
            raise HTTPException(status_code=400, detail="Expense amount must be greater than zero.")
        exp["amount"] = amount
        existing.setdefault("expenses", []).append(exp)
        await db.jobs.update_one({"id": job_id}, {"$set": {"expenses": existing["expenses"]}})
        logger.info(f"Logged expense job_id={job_id} amount={amount} user={user.user_id}")
        return Job(**existing)
    except HTTPException:
        raise
    except Exception as ex:
        logger.error(f"Add expense failed job_id={job_id}: {ex}")
        raise HTTPException(status_code=500, detail="Could not log the expense. Please try again.")


@api_router.delete("/jobs/{job_id}/expenses/{expense_id}", response_model=Job)
async def delete_expense(job_id: str, expense_id: str, user: User = Depends(get_current_user)):
    existing = await db.jobs.find_one({"id": job_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Job not found")
    existing["expenses"] = [e for e in existing.get("expenses", []) if e.get("id") != expense_id]
    await db.jobs.update_one({"id": job_id}, {"$set": {"expenses": existing["expenses"]}})
    return Job(**existing)


# ---------------- Invoices ----------------
@api_router.get("/invoices", response_model=List[Invoice])
async def list_invoices(user: User = Depends(get_current_user)):
    docs = await db.invoices.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return [Invoice(**d) for d in docs]


@api_router.post("/invoices", response_model=Invoice)
async def create_invoice(payload: InvoiceCreate, user: User = Depends(get_current_user)):
    number = await next_number("INV")
    amount = payload.amount
    if payload.line_items:
        _, subtotal, _, total = compute_totals(payload.line_items, 0)
        amount = total if not amount else amount
    cid, cname = await resolve_client_ref(payload.client_id, payload.client_name)
    data = payload.model_dump()
    data["client_id"] = cid
    data["client_name"] = cname
    obj = Invoice(invoice_number=number, **data)
    obj.amount = amount
    await db.invoices.insert_one(obj.model_dump())
    return obj


def apply_invoice_payment_status(amount, amount_paid, current_status: str) -> str:
    """Paid when fully collected, Partial when something has been collected."""
    try:
        total = float(amount or 0)
        paid = float(amount_paid or 0)
    except (TypeError, ValueError):
        return current_status or "Draft"
    if paid <= 0:
        return current_status or "Draft"
    if total > 0 and paid + 1e-9 >= total:
        return "Paid"
    return "Partial"


@api_router.put("/invoices/{invoice_id}", response_model=Invoice)
async def update_invoice(invoice_id: str, payload: InvoiceCreate, user: User = Depends(get_current_user)):
    existing = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Invoice not found")
    cid, cname = await resolve_client_ref(payload.client_id or existing.get("client_id", ""), payload.client_name or existing.get("client_name", ""))
    data = payload.model_dump()
    data["client_id"] = cid
    data["client_name"] = cname
    updated = {**existing, **data}
    updated["status"] = apply_invoice_payment_status(
        updated.get("amount"), updated.get("amount_paid"), updated.get("status") or existing.get("status") or "Draft"
    )
    await db.invoices.update_one({"id": invoice_id}, {"$set": updated})
    return Invoice(**updated)


@api_router.post("/invoices/{invoice_id}/payments", response_model=Invoice)
async def record_invoice_payment(invoice_id: str, payload: InvoicePaymentBody, user: User = Depends(get_current_user)):
    try:
        existing = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="Invoice not found")
        try:
            payment = float(payload.amount)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="Payment amount must be a valid number.")
        if payment <= 0:
            raise HTTPException(status_code=400, detail="Payment amount must be greater than zero.")
        new_paid = round(float(existing.get("amount_paid") or 0) + payment, 2)
        new_status = apply_invoice_payment_status(
            existing.get("amount") or 0, new_paid, existing.get("status") or "Sent"
        )
        await db.invoices.update_one(
            {"id": invoice_id},
            {"$set": {"amount_paid": new_paid, "status": new_status}},
        )
        logger.info(
            f"Recorded payment invoice_id={invoice_id} amount={payment} "
            f"paid={new_paid} status={new_status} user={user.user_id}"
        )
        fresh = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
        return Invoice(**fresh)
    except HTTPException:
        raise
    except Exception as ex:
        logger.error(f"Record payment failed invoice_id={invoice_id}: {ex}")
        raise HTTPException(status_code=500, detail="Could not record the payment. Please try again.")


@api_router.delete("/invoices/{invoice_id}")
async def delete_invoice(invoice_id: str, user: User = Depends(get_current_user)):
    await db.invoices.delete_one({"id": invoice_id})
    return {"success": True}


async def resolve_invoice_client(inv: dict):
    """Resolve the client document using client_id first."""
    try:
        cid = (inv.get("client_id") or "").strip()
        if cid:
            by_id = await db.clients.find_one({"id": cid}, {"_id": 0})
            if by_id:
                return by_id
        if inv.get("estimate_id"):
            est = await db.estimates.find_one({"id": inv["estimate_id"]}, {"_id": 0})
            if est and est.get("client_id"):
                by_est = await db.clients.find_one({"id": est["client_id"]}, {"_id": 0})
                if by_est:
                    return by_est
        name = (inv.get("client_name") or "").strip()
        if name:
            return await db.clients.find_one({"name": name}, {"_id": 0})
    except Exception as ex:
        logger.error(f"resolve_invoice_client failed for invoice {inv.get('id')}: {ex}")
    return None


@api_router.get("/invoices/{invoice_id}/pdf")
async def invoice_pdf(invoice_id: str, user: User = Depends(get_current_user)):
    try:
        inv = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
        if not inv:
            raise HTTPException(status_code=404, detail="Invoice not found")
        client = await resolve_invoice_client(inv)
        pdf_bytes = build_invoice_pdf(inv, client)
        filename = f"{inv.get('invoice_number', 'invoice')}.pdf"
        logger.info(f"Invoice PDF generated invoice_id={invoice_id} user={user.user_id}")
        return StreamingResponse(
            BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except HTTPException:
        raise
    except Exception as ex:
        logger.error(f"Invoice PDF failed invoice_id={invoice_id}: {ex}")
        raise HTTPException(status_code=500, detail="Could not generate the invoice PDF. Please try again.")


@api_router.post("/invoices/{invoice_id}/send-email")
async def send_invoice_email(invoice_id: str, user: User = Depends(get_current_user)):
    try:
        inv = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
        if not inv:
            raise HTTPException(status_code=404, detail="Invoice not found")
        client = await resolve_invoice_client(inv)
        to = (client or {}).get("email", "").strip()
        if not to:
            raise HTTPException(status_code=400, detail="This client has no email address on file. Add one first.")

        pdf_bytes = build_invoice_pdf(inv, client)
        b64 = base64.b64encode(pdf_bytes).decode()
        number = inv.get("invoice_number", "")
        amount = float(inv.get("amount", 0) or 0)
        paid = float(inv.get("amount_paid", 0) or 0)
        balance = round(max(amount - paid, 0), 2)
        due = (inv.get("due_date", "") or "")[:10] or "—"

        rows = ""
        line_items = inv.get("line_items") or []
        if line_items:
            for li in line_items:
                rows += (
                    f'<tr>'
                    f'<td style="padding:8px 10px;border-bottom:1px solid #E2E8F0;font-family:Arial,sans-serif;font-size:13px;color:#061A23">{escape(str(li.get("description","")))}</td>'
                    f'<td align="right" style="padding:8px 10px;border-bottom:1px solid #E2E8F0;font-family:Arial,sans-serif;font-size:13px;color:#4B6370">{("{:g}".format(float(li.get("quantity",0) or 0)))}</td>'
                    f'<td align="right" style="padding:8px 10px;border-bottom:1px solid #E2E8F0;font-family:Arial,sans-serif;font-size:13px;color:#4B6370">{escape(money(li.get("unit_price",0)))}</td>'
                    f'<td align="right" style="padding:8px 10px;border-bottom:1px solid #E2E8F0;font-family:Arial,sans-serif;font-size:13px;color:#061A23">{escape(money(li.get("amount",0)))}</td>'
                    f'</tr>'
                )
        else:
            rows = (
                f'<tr>'
                f'<td style="padding:8px 10px;border-bottom:1px solid #E2E8F0;font-family:Arial,sans-serif;font-size:13px;color:#061A23">Services</td>'
                f'<td align="right" style="padding:8px 10px;border-bottom:1px solid #E2E8F0;font-family:Arial,sans-serif;font-size:13px;color:#4B6370">1</td>'
                f'<td align="right" style="padding:8px 10px;border-bottom:1px solid #E2E8F0;font-family:Arial,sans-serif;font-size:13px;color:#4B6370">{escape(money(amount))}</td>'
                f'<td align="right" style="padding:8px 10px;border-bottom:1px solid #E2E8F0;font-family:Arial,sans-serif;font-size:13px;color:#061A23">{escape(money(amount))}</td>'
                f'</tr>'
            )

        client_name = escape((client or {}).get("name") or inv.get("client_name") or "there")
        subject = f"Invoice from {EMAIL_FROM_NAME} — {number}"
        html = (
            f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F7F8;padding:24px 0">'
            f'<tr><td align="center">'
            f'<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #E2E8F0">'
            f'<tr><td style="background:#0A4D68;padding:24px 28px;font-family:Arial,sans-serif">'
            f'<div style="color:#ffffff;font-size:22px;font-weight:bold;letter-spacing:1px">REVIVAL PRO</div>'
            f'<div style="color:#C9A227;font-size:12px;margin-top:2px">Residential Remodeling</div>'
            f'</td></tr>'
            f'<tr><td style="padding:28px;font-family:Arial,sans-serif;color:#061A23">'
            f'<p style="font-size:15px;margin:0 0 12px">Hi {client_name},</p>'
            f'<p style="font-size:14px;color:#4B6370;line-height:1.5;margin:0 0 20px">'
            f'Please find invoice <strong>{escape(number)}</strong> below. '
            f'A PDF copy is attached for your records. Payment is due by <strong>{escape(due)}</strong>.</p>'
            f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:8px">'
            f'<tr style="background:#0A4D68">'
            f'<td style="padding:8px 10px;color:#fff;font-family:Arial,sans-serif;font-size:12px;font-weight:bold">Description</td>'
            f'<td align="right" style="padding:8px 10px;color:#fff;font-family:Arial,sans-serif;font-size:12px;font-weight:bold">Qty</td>'
            f'<td align="right" style="padding:8px 10px;color:#fff;font-family:Arial,sans-serif;font-size:12px;font-weight:bold">Unit</td>'
            f'<td align="right" style="padding:8px 10px;color:#fff;font-family:Arial,sans-serif;font-size:12px;font-weight:bold">Amount</td>'
            f'</tr>{rows}</table>'
            f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td></td>'
            f'<td align="right" style="font-family:Arial,sans-serif;font-size:13px;color:#4B6370;padding:2px 10px">Amount: {escape(money(amount))}</td></tr>'
            f'<tr><td></td><td align="right" style="font-family:Arial,sans-serif;font-size:13px;color:#4B6370;padding:2px 10px">Paid: {escape(money(paid))}</td></tr>'
            f'<tr><td></td><td align="right" style="font-family:Arial,sans-serif;font-size:17px;color:#0A4D68;font-weight:bold;padding:6px 10px;border-top:2px solid #0A4D68">Balance due: {escape(money(balance))}</td></tr>'
            f'</table>'
            f'<p style="font-size:13px;color:#4B6370;line-height:1.5;margin:22px 0 0">'
            f'Just reply to this email if you have any questions about this invoice.</p>'
            f'</td></tr>'
            f'<tr><td style="padding:16px 28px;background:#F4F7F8;font-family:Arial,sans-serif;font-size:11px;color:#8AA0AB">'
            f'Sent by {escape(EMAIL_FROM_NAME)}. We never ask for your password or payment details by email.'
            f'</td></tr>'
            f'</table></td></tr></table>'
        )

        email_id = await send_email(
            to=to,
            subject=subject,
            html=html,
            attachments=[{"filename": f"{number}.pdf", "content": b64}],
        )
        if inv.get("status") == "Draft":
            await db.invoices.update_one({"id": invoice_id}, {"$set": {"status": "Sent"}})
        logger.info(f"Invoice emailed invoice_id={invoice_id} user={user.user_id}")
        return {"status": "success", "email_id": email_id, "sent_to": to}
    except HTTPException:
        raise
    except Exception as ex:
        logger.error(f"Invoice email failed invoice_id={invoice_id}: {ex}")
        raise HTTPException(status_code=500, detail="Could not send the invoice. Please try again.")


# ---------------- Company Settings ----------------
async def get_company():
    doc = await db.settings.find_one({"key": "company"}, {"_id": 0})
    if not doc:
        default = {"key": "company", **CompanySettings(
            name="Revival Pro", address="Austin, TX 78701",
            phone="(512) 555-0100", license="TX Lic. #RRC-000000", email=OWNER_EMAIL,
        ).model_dump()}
        await db.settings.insert_one(default)
        doc = default
    doc.pop("key", None)
    return doc


@api_router.get("/settings")
async def read_settings(user: User = Depends(get_current_user)):
    return await get_company()


@api_router.put("/settings")
async def write_settings(payload: CompanySettings, user: User = Depends(get_current_user)):
    await db.settings.update_one({"key": "company"}, {"$set": payload.model_dump()}, upsert=True)
    return await get_company()


# ---------------- Contracts ----------------
def default_schedule(total):
    deposit = round(total * 0.5, 2)
    progress = round(total * 0.3, 2)
    final = round(total - deposit - progress, 2)
    return [
        PaymentMilestone(label="Deposit due at signing", amount=deposit, note="50% to reserve your spot and order materials"),
        PaymentMilestone(label="Progress payment at project midpoint", amount=progress, note="30% once work is underway"),
        PaymentMilestone(label="Final payment upon completion", amount=final, note="20% when the work is finished and approved"),
    ]


async def build_contract_from_estimate(est, client, company):
    number = await next_number("CON")
    total = est.get("total", 0.0)
    desc = f"{est.get('category','')} remodeling project"
    if est.get("notes"):
        desc += f" — {est['notes']}"
    cid, cname = await resolve_client_ref(
        (client or {}).get("id") or est.get("client_id", ""),
        (client or {}).get("name") or est.get("client_name", ""),
    )
    return Contract(
        contract_number=number,
        estimate_id=est["id"],
        client_id=cid,
        contractor_name=company.get("name", "Revival Pro"),
        contractor_address=company.get("address", ""),
        contractor_phone=company.get("phone", ""),
        contractor_license=company.get("license", ""),
        client_name=cname,
        client_address=(client or {}).get("address", ""),
        client_phone=(client or {}).get("phone", ""),
        client_email=(client or {}).get("email", ""),
        project_address=(client or {}).get("address", ""),
        project_description=desc,
        line_items=[LineItem(**i) for i in est.get("line_items", [])],
        total=total,
        payment_schedule=default_schedule(total),
        exclusions=list(DEFAULT_EXCLUSIONS),
        change_order_markup=20.0,
    )


async def get_or_create_job_for_estimate(est):
    existing = await db.jobs.find_one({"estimate_id": est["id"]}, {"_id": 0})
    if existing:
        return Job(**existing)
    category = (est.get("category") or "").strip() or "Project"
    cid, cname = await resolve_client_ref(est.get("client_id", ""), est.get("client_name", ""))
    name = f"{category} - {cname}".strip(" -") or "New Job"
    obj = Job(
        job_number=await next_number("JOB"),
        name=name,
        estimate_id=est["id"],
        client_id=cid,
        client_name=cname,
        status="Active",
        budget=float(est.get("total", 0.0) or 0.0),
        expenses=[],
    )
    await db.jobs.insert_one(obj.model_dump())
    logger.info(f"Auto-created job {obj.job_number} from estimate {est.get('id')}")
    return obj


@api_router.post("/estimates/{estimate_id}/generate")
async def generate_contract_invoice(estimate_id: str, user: User = Depends(get_current_user)):
    try:
        est = await db.estimates.find_one({"id": estimate_id}, {"_id": 0})
        if not est:
            raise HTTPException(status_code=404, detail="Estimate not found")
        if est.get("status") != "Won":
            raise HTTPException(status_code=400, detail="Only Won estimates can generate a contract and invoice")

        cid, cname = await resolve_client_ref(est.get("client_id", ""), est.get("client_name", ""))
        inv_doc = await db.invoices.find_one({"estimate_id": estimate_id}, {"_id": 0})
        if inv_doc:
            invoice = Invoice(**inv_doc)
            if not invoice.client_id and cid:
                invoice.client_id = cid
                invoice.client_name = cname or invoice.client_name
                await db.invoices.update_one({"id": invoice.id}, {"$set": {"client_id": cid, "client_name": invoice.client_name}})
        else:
            invoice = Invoice(
                invoice_number=await next_number("INV"),
                estimate_id=estimate_id,
                client_id=cid,
                client_name=cname,
                status="Draft",
                line_items=[LineItem(**i) for i in est.get("line_items", [])],
                amount=est.get("total", 0.0),
                amount_paid=0.0,
                due_date=(datetime.now(timezone.utc) + timedelta(days=30)).isoformat(),
            )
            await db.invoices.insert_one(invoice.model_dump())

        con_doc = await db.contracts.find_one({"estimate_id": estimate_id}, {"_id": 0})
        if con_doc:
            contract = Contract(**con_doc)
            patch = {}
            if not contract.invoice_id:
                contract.invoice_id = invoice.id
                patch["invoice_id"] = invoice.id
            if not contract.client_id and cid:
                contract.client_id = cid
                patch["client_id"] = cid
            if patch:
                await db.contracts.update_one({"id": contract.id}, {"$set": patch})
        else:
            client = await db.clients.find_one({"id": cid}, {"_id": 0}) if cid else None
            company = await get_company()
            contract = await build_contract_from_estimate(est, client, company)
            contract.invoice_id = invoice.id
            await db.contracts.insert_one(contract.model_dump())

        job = await get_or_create_job_for_estimate(est)
        logger.info(
            f"Generated contract={contract.contract_number} invoice={invoice.invoice_number} "
            f"job={job.job_number} estimate_id={estimate_id} user={user.user_id}"
        )
        return {"contract": contract.model_dump(), "invoice": invoice.model_dump(), "job": job.model_dump()}
    except HTTPException:
        raise
    except Exception as ex:
        logger.error(f"Generate contract failed estimate_id={estimate_id}: {ex}")
        raise HTTPException(status_code=500, detail="Could not generate the contract, invoice, and job. Please try again.")


@api_router.get("/contracts", response_model=List[Contract])
async def list_contracts(user: User = Depends(get_current_user)):
    docs = await db.contracts.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return [Contract(**d) for d in docs]


@api_router.get("/contracts/{contract_id}", response_model=Contract)
async def get_contract(contract_id: str, user: User = Depends(get_current_user)):
    doc = await db.contracts.find_one({"id": contract_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Contract not found")
    return Contract(**doc)


@api_router.put("/contracts/{contract_id}", response_model=Contract)
async def update_contract(contract_id: str, payload: ContractUpdate, user: User = Depends(get_current_user)):
    existing = await db.contracts.find_one({"id": contract_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Contract not found")
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    merged = {**existing, **updates}
    if updates:
        await db.contracts.update_one({"id": contract_id}, {"$set": updates})
    await activate_signed_contract_work(merged)
    await maybe_send_signed_copies(merged)
    fresh = await db.contracts.find_one({"id": contract_id}, {"_id": 0})
    return Contract(**fresh)


@api_router.delete("/contracts/{contract_id}")
async def delete_contract(contract_id: str, user: User = Depends(get_current_user)):
    await db.contracts.delete_one({"id": contract_id})
    return {"success": True}


@api_router.get("/contracts/{contract_id}/pdf")
async def contract_pdf(contract_id: str, user: User = Depends(get_current_user)):
    doc = await db.contracts.find_one({"id": contract_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Contract not found")
    company = await get_company()
    pdf_bytes = build_contract_pdf(doc, company)
    filename = f"{doc.get('contract_number', 'contract')}.pdf"
    return StreamingResponse(BytesIO(pdf_bytes), media_type="application/pdf",
                             headers={"Content-Disposition": f'attachment; filename="{filename}"'})


class SignRequestBody(BaseModel):
    base_url: str = ""


class PublicSignBody(BaseModel):
    signature: str
    signed_name: str = ""


async def find_contract_by_token(token: str):
    doc = await db.contracts.find_one(
        {"$or": [{"sign_token": token}, {"contractor_sign_token": token}]}, {"_id": 0}
    )
    if not doc:
        return None, None
    role = "contractor" if doc.get("contractor_sign_token") == token else "client"
    return doc, role


async def activate_signed_contract_work(contract: dict):
    """When both parties have signed, send a draft invoice and activate the linked job."""
    if not (contract.get("client_signature") and contract.get("contractor_signature")):
        return
    try:
        invoice = None
        if contract.get("invoice_id"):
            invoice = await db.invoices.find_one({"id": contract["invoice_id"]}, {"_id": 0})
        if not invoice and contract.get("estimate_id"):
            invoice = await db.invoices.find_one({"estimate_id": contract["estimate_id"]}, {"_id": 0})
        if invoice and invoice.get("status") == "Draft":
            await db.invoices.update_one({"id": invoice["id"]}, {"$set": {"status": "Sent"}})
            logger.info(
                f"Invoice {invoice.get('invoice_number')} marked Sent after contract "
                f"{contract.get('contract_number')} signed"
            )

        job = None
        if contract.get("estimate_id"):
            job = await db.jobs.find_one({"estimate_id": contract["estimate_id"]}, {"_id": 0})
        if job and job.get("status") not in ("Active", "Completed"):
            await db.jobs.update_one({"id": job["id"]}, {"$set": {"status": "Active"}})
            logger.info(
                f"Job {job.get('job_number')} set Active after contract "
                f"{contract.get('contract_number')} signed"
            )
    except Exception as ex:
        logger.error(f"Post-sign invoice/job update failed contract={contract.get('id')}: {ex}")


async def maybe_send_signed_copies(contract: dict):
    """When both parties have signed, email a signed PDF copy to both (best effort, once)."""
    if not (contract.get("client_signature") and contract.get("contractor_signature")):
        return
    if contract.get("signed_copies_sent"):
        return
    company = await get_company()
    number = contract.get("contract_number", "")
    try:
        pdf = build_contract_pdf(contract, company)
        b64 = base64.b64encode(pdf).decode()
    except Exception as ex:
        logger.error(f"Signed copy PDF build failed: {ex}")
        return
    recipients = []
    if contract.get("client_email"):
        recipients.append(contract["client_email"])
    contractor_email = (company.get("email") or OWNER_EMAIL or "").strip()
    if contractor_email:
        recipients.append(contractor_email)
    subject = f"Signed contract {number} — {EMAIL_FROM_NAME}"
    html = (
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F7F8;padding:24px 0"><tr><td align="center">'
        f'<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #E2E8F0">'
        f'<tr><td style="background:#0A4D68;padding:24px 28px;font-family:Arial,sans-serif">'
        f'<div style="color:#ffffff;font-size:22px;font-weight:bold;letter-spacing:1px">REVIVAL PRO</div>'
        f'<div style="color:#C9A227;font-size:12px;margin-top:2px">Residential Remodeling</div></td></tr>'
        f'<tr><td style="padding:28px;font-family:Arial,sans-serif;color:#061A23">'
        f'<p style="font-size:15px;margin:0 0 12px">Good news — it\'s official!</p>'
        f'<p style="font-size:14px;color:#4B6370;line-height:1.6;margin:0 0 8px">'
        f'Contract <strong>{escape(number)}</strong> has now been signed by both parties. '
        f'A copy of the fully signed contract is attached for your records.</p>'
        f'</td></tr>'
        f'<tr><td style="padding:16px 28px;background:#F4F7F8;font-family:Arial,sans-serif;font-size:11px;color:#8AA0AB">'
        f'Sent by {escape(EMAIL_FROM_NAME)}. We never ask for your password or payment details by email.</td></tr>'
        f'</table></td></tr></table>'
    )
    sent_any = False
    for to in list(dict.fromkeys(recipients)):
        try:
            await send_email(to=to, subject=subject, html=html,
                             attachments=[{"filename": f"{number}.pdf", "content": b64}])
            sent_any = True
        except Exception as ex:
            logger.error(f"Signed copy email to {to} failed: {ex}")
    if sent_any:
        await db.contracts.update_one({"id": contract["id"]}, {"$set": {"signed_copies_sent": True}})


@api_router.post("/contracts/{contract_id}/send-signature-request")
async def send_signature_request(contract_id: str, body: SignRequestBody, user: User = Depends(get_current_user)):
    doc = await db.contracts.find_one({"id": contract_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Contract not found")
    to = (doc.get("client_email") or "").strip()
    if not to:
        raise HTTPException(status_code=400, detail="Add the client's email to the contract first.")
    base = (body.base_url or "").rstrip("/")
    if not base.startswith("https://"):
        raise HTTPException(status_code=400, detail="Invalid signing link.")
    token = doc.get("sign_token") or new_id()
    link = f"{base}/sign/{token}"
    client_name = escape(doc.get("client_name", "there"))
    number = escape(doc.get("contract_number", ""))
    subject = f"Please review and sign your contract from {EMAIL_FROM_NAME} — {doc.get('contract_number','')}"
    html = (
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F7F8;padding:24px 0">'
        f'<tr><td align="center">'
        f'<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #E2E8F0">'
        f'<tr><td style="background:#0A4D68;padding:24px 28px;font-family:Arial,sans-serif">'
        f'<div style="color:#ffffff;font-size:22px;font-weight:bold;letter-spacing:1px">REVIVAL PRO</div>'
        f'<div style="color:#C9A227;font-size:12px;margin-top:2px">Residential Remodeling</div></td></tr>'
        f'<tr><td style="padding:28px;font-family:Arial,sans-serif;color:#061A23">'
        f'<p style="font-size:15px;margin:0 0 12px">Hi {client_name},</p>'
        f'<p style="font-size:14px;color:#4B6370;line-height:1.6;margin:0 0 22px">'
        f'Your construction contract <strong>{number}</strong> is ready for your review and signature. '
        f'You can read the full contract and sign it right from your phone — no account needed.</p>'
        f'<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 22px">'
        f'<tr><td style="border-radius:10px;background:#C9A227">'
        f'<a href="{link}" style="display:inline-block;padding:14px 28px;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;color:#061A23;text-decoration:none">Review &amp; Sign the Contract</a>'
        f'</td></tr></table>'
        f'<p style="font-size:12px;color:#8AA0AB;line-height:1.5;margin:0">If the button doesn\'t work, copy and paste this secure link into your browser:<br/>{escape(link)}</p>'
        f'</td></tr>'
        f'<tr><td style="padding:16px 28px;background:#F4F7F8;font-family:Arial,sans-serif;font-size:11px;color:#8AA0AB">'
        f'Sent by {escape(EMAIL_FROM_NAME)}. We never ask for your password or payment details by email.</td></tr>'
        f'</table></td></tr></table>'
    )
    email_id = await send_email(to=to, subject=subject, html=html)
    await db.contracts.update_one({"id": contract_id}, {"$set": {"sign_token": token, "status": "Sent"}})
    return {"status": "success", "email_id": email_id, "sent_to": to, "link": link}


@api_router.post("/contracts/{contract_id}/send-countersign-request")
async def send_countersign_request(contract_id: str, body: SignRequestBody, user: User = Depends(get_current_user)):
    doc = await db.contracts.find_one({"id": contract_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Contract not found")
    company = await get_company()
    to = (company.get("email") or OWNER_EMAIL or "").strip()
    if not to:
        raise HTTPException(status_code=400, detail="Add your company email in Company Profile first.")
    base = (body.base_url or "").rstrip("/")
    if not base.startswith("https://"):
        raise HTTPException(status_code=400, detail="Invalid signing link.")
    token = doc.get("contractor_sign_token") or new_id()
    link = f"{base}/sign/{token}"
    number = escape(doc.get("contract_number", ""))
    subject = f"Countersign contract {doc.get('contract_number','')} — {EMAIL_FROM_NAME}"
    html = (
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F7F8;padding:24px 0"><tr><td align="center">'
        f'<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #E2E8F0">'
        f'<tr><td style="background:#0A4D68;padding:24px 28px;font-family:Arial,sans-serif">'
        f'<div style="color:#ffffff;font-size:22px;font-weight:bold;letter-spacing:1px">REVIVAL PRO</div>'
        f'<div style="color:#C9A227;font-size:12px;margin-top:2px">Residential Remodeling</div></td></tr>'
        f'<tr><td style="padding:28px;font-family:Arial,sans-serif;color:#061A23">'
        f'<p style="font-size:15px;margin:0 0 12px">Your turn to sign.</p>'
        f'<p style="font-size:14px;color:#4B6370;line-height:1.6;margin:0 0 22px">'
        f'Contract <strong>{number}</strong> is ready for you to countersign. '
        f'Open the link on any device and add your signature.</p>'
        f'<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 22px"><tr>'
        f'<td style="border-radius:10px;background:#C9A227">'
        f'<a href="{link}" style="display:inline-block;padding:14px 28px;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;color:#061A23;text-decoration:none">Review &amp; Countersign</a>'
        f'</td></tr></table>'
        f'<p style="font-size:12px;color:#8AA0AB;line-height:1.5;margin:0">Or paste this secure link into your browser:<br/>{escape(link)}</p>'
        f'</td></tr>'
        f'<tr><td style="padding:16px 28px;background:#F4F7F8;font-family:Arial,sans-serif;font-size:11px;color:#8AA0AB">'
        f'Sent by {escape(EMAIL_FROM_NAME)}.</td></tr>'
        f'</table></td></tr></table>'
    )
    email_id = await send_email(to=to, subject=subject, html=html)
    await db.contracts.update_one({"id": contract_id}, {"$set": {"contractor_sign_token": token}})
    return {"status": "success", "email_id": email_id, "sent_to": to, "link": link}


@api_router.get("/public/contracts/{token}")
async def public_get_contract(token: str):
    doc, role = await find_contract_by_token(token)
    if not doc:
        raise HTTPException(status_code=404, detail="This signing link is invalid or has expired.")
    return {**Contract(**doc).model_dump(), "sign_role": role}


@api_router.post("/public/contracts/{token}/sign")
async def public_sign_contract(token: str, body: PublicSignBody):
    doc, role = await find_contract_by_token(token)
    if not doc:
        raise HTTPException(status_code=404, detail="This signing link is invalid or has expired.")
    if not body.signature or not body.signature.startswith("data:image/"):
        raise HTTPException(status_code=400, detail="Please add your signature before submitting.")
    signed_date = datetime.now(timezone.utc).strftime("%B %d, %Y")
    prefix = "contractor" if role == "contractor" else "client"
    default_name = doc.get("contractor_name", "") if role == "contractor" else doc.get("client_name", "")
    updates = {
        f"{prefix}_signature": body.signature,
        f"{prefix}_signed_date": signed_date,
        f"{prefix}_signed_by": body.signed_name.strip() or default_name,
    }
    other_sig = doc.get("client_signature") if role == "contractor" else doc.get("contractor_signature")
    new_status = "Signed" if other_sig else "Sent"
    updates["status"] = new_status
    await db.contracts.update_one({"id": doc["id"]}, {"$set": updates})
    if new_status == "Signed":
        merged = {**doc, **updates}
        await activate_signed_contract_work(merged)
        await maybe_send_signed_copies(merged)
    return {"status": "success", "contract_status": new_status, "signed_date": signed_date, "role": role}


# ---------------- Financials / Books ----------------
DEFAULT_OVERHEAD_CATEGORIES = [
    "Insurance",
    "Rent & Shop",
    "Vehicles",
    "Marketing",
    "Software & Subscriptions",
    "Office",
    "Utilities",
    "Professional Services",
    "Other",
]


def year_of(value, fallback=None):
    if not value:
        return fallback
    text = str(value).strip()
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).year
    except Exception:
        try:
            return int(text[:4])
        except Exception:
            return fallback


def parse_money(value, field="Amount"):
    try:
        amount = float(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f"{field} must be a valid number.")
    if amount <= 0:
        raise HTTPException(status_code=400, detail=f"{field} must be greater than zero.")
    return round(amount, 2)


async def seed_overhead_categories():
    try:
        if await db.overhead_categories.count_documents({}) > 0:
            return
        now = now_iso()
        docs = [
            OverheadCategory(name=name, sort_order=i, created_at=now).model_dump()
            for i, name in enumerate(DEFAULT_OVERHEAD_CATEGORIES)
        ]
        await db.overhead_categories.insert_many(docs)
        logger.info("Seeded default overhead categories.")
    except Exception as ex:
        logger.error(f"seed_overhead_categories failed: {ex}")


async def list_overhead_categories_with_expenses():
    await seed_overhead_categories()
    categories = await db.overhead_categories.find({}, {"_id": 0}).to_list(500)
    expenses = await db.overhead_expenses.find({}, {"_id": 0}).to_list(5000)
    by_cat = {}
    for exp in expenses:
        by_cat.setdefault(exp.get("category_id"), []).append(OverheadExpense(**exp).model_dump())
    categories.sort(key=lambda c: (c.get("sort_order", 0), (c.get("name") or "").lower()))
    result = []
    for cat in categories:
        items = sorted(by_cat.get(cat["id"], []), key=lambda e: e.get("date") or "", reverse=True)
        result.append({
            **OverheadCategory(**cat).model_dump(),
            "total": round(sum(float(e.get("amount") or 0) for e in items), 2),
            "expenses": items,
        })
    return result


def job_actual_costs(job: dict, year=None) -> float:
    total = 0.0
    for exp in job.get("expenses") or []:
        if exp.get("kind") and exp.get("kind") != "actual":
            continue
        if year is not None and year_of(exp.get("date") or exp.get("created_at")) != year:
            continue
        total += float(exp.get("amount") or 0)
    return round(total, 2)


def build_jobs_profit(jobs, invoices):
    paid_by_estimate = {}
    for inv in invoices:
        eid = inv.get("estimate_id") or ""
        if not eid:
            continue
        paid_by_estimate[eid] = paid_by_estimate.get(eid, 0.0) + float(inv.get("amount_paid") or 0)
    rows = []
    for job in jobs:
        income = round(paid_by_estimate.get(job.get("estimate_id") or "", 0.0), 2)
        costs = job_actual_costs(job)
        if income <= 0 and costs <= 0:
            continue
        rows.append({
            "id": job.get("id"),
            "name": job.get("name") or "Untitled job",
            "job_number": job.get("job_number") or "",
            "client_name": job.get("client_name") or "",
            "status": job.get("status") or "",
            "income": income,
            "costs": costs,
            "profit": round(income - costs, 2),
        })
    rows.sort(key=lambda r: r["profit"], reverse=True)
    return rows


@api_router.get("/financials/overview")
async def financials_overview(user: User = Depends(get_current_user)):
    try:
        year = datetime.now(timezone.utc).year
        invoices = await db.invoices.find({}, {"_id": 0}).to_list(2000)
        jobs = await db.jobs.find({}, {"_id": 0}).to_list(2000)
        overhead = await db.overhead_expenses.find({}, {"_id": 0}).to_list(5000)
        other_docs = await db.other_income.find({}, {"_id": 0}).to_list(2000)

        invoice_income_ytd = 0.0
        outstanding = 0.0
        outstanding_count = 0
        for inv in invoices:
            paid = float(inv.get("amount_paid") or 0)
            amount = float(inv.get("amount") or 0)
            if year_of(inv.get("created_at")) == year:
                invoice_income_ytd += paid
            due = max(amount - paid, 0)
            if due > 0.009:
                outstanding += due
                outstanding_count += 1

        other_income_ytd = 0.0
        for item in other_docs:
            if year_of(item.get("date") or item.get("created_at")) == year:
                other_income_ytd += float(item.get("amount") or 0)

        overhead_ytd = 0.0
        for exp in overhead:
            if year_of(exp.get("date") or exp.get("created_at")) == year:
                overhead_ytd += float(exp.get("amount") or 0)

        job_costs_ytd = 0.0
        for job in jobs:
            job_costs_ytd += job_actual_costs(job, year)

        invoice_income_ytd = round(invoice_income_ytd, 2)
        other_income_ytd = round(other_income_ytd, 2)
        income_ytd = round(invoice_income_ytd + other_income_ytd, 2)
        overhead_ytd = round(overhead_ytd, 2)
        job_costs_ytd = round(job_costs_ytd, 2)
        expenses_ytd = round(overhead_ytd + job_costs_ytd, 2)
        return {
            "year": year,
            "income_ytd": income_ytd,
            "invoice_income_ytd": invoice_income_ytd,
            "other_income_ytd": other_income_ytd,
            "expenses_ytd": expenses_ytd,
            "overhead_ytd": overhead_ytd,
            "job_costs_ytd": job_costs_ytd,
            "net_profit": round(income_ytd - expenses_ytd, 2),
            "outstanding": round(outstanding, 2),
            "outstanding_count": outstanding_count,
            "jobs_profit": build_jobs_profit(jobs, invoices),
            "square": {
                "connected": False,
                "status": "coming_soon",
                "note": "Square sync coming next",
            },
        }
    except Exception as ex:
        logger.error(f"Financials overview failed: {ex}")
        raise HTTPException(status_code=500, detail="Could not load financials. Please try again.")


@api_router.get("/financials/categories")
async def list_financial_categories(user: User = Depends(get_current_user)):
    try:
        return await list_overhead_categories_with_expenses()
    except Exception as ex:
        logger.error(f"List overhead categories failed: {ex}")
        raise HTTPException(status_code=500, detail="Could not load expense categories. Please try again.")


@api_router.post("/financials/categories")
async def create_financial_category(payload: OverheadCategoryCreate, user: User = Depends(get_current_user)):
    try:
        name = (payload.name or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="Category name is required.")
        existing = await db.overhead_categories.find_one({"name": name}, {"_id": 0})
        if existing:
            raise HTTPException(status_code=400, detail="A category with that name already exists.")
        last = await db.overhead_categories.find({}, {"_id": 0, "sort_order": 1}).sort("sort_order", -1).to_list(1)
        sort_order = payload.sort_order if payload.sort_order is not None else ((last[0]["sort_order"] + 1) if last else 0)
        obj = OverheadCategory(name=name, sort_order=sort_order)
        await db.overhead_categories.insert_one(obj.model_dump())
        logger.info(f"Created overhead category {obj.id} name={name} user={user.user_id}")
        return {**obj.model_dump(), "total": 0.0, "expenses": []}
    except HTTPException:
        raise
    except Exception as ex:
        logger.error(f"Create overhead category failed: {ex}")
        raise HTTPException(status_code=500, detail="Could not create the category. Please try again.")


@api_router.put("/financials/categories/{category_id}")
async def update_financial_category(category_id: str, payload: OverheadCategoryUpdate, user: User = Depends(get_current_user)):
    try:
        existing = await db.overhead_categories.find_one({"id": category_id}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="Category not found")
        updates = {k: v for k, v in payload.model_dump().items() if v is not None}
        if "name" in updates:
            name = updates["name"].strip()
            if not name:
                raise HTTPException(status_code=400, detail="Category name is required.")
            clash = await db.overhead_categories.find_one({"name": name, "id": {"$ne": category_id}}, {"_id": 0})
            if clash:
                raise HTTPException(status_code=400, detail="A category with that name already exists.")
            updates["name"] = name
        if updates:
            await db.overhead_categories.update_one({"id": category_id}, {"$set": updates})
        fresh = await db.overhead_categories.find_one({"id": category_id}, {"_id": 0})
        logger.info(f"Updated overhead category {category_id} user={user.user_id}")
        return OverheadCategory(**fresh).model_dump()
    except HTTPException:
        raise
    except Exception as ex:
        logger.error(f"Update overhead category failed category_id={category_id}: {ex}")
        raise HTTPException(status_code=500, detail="Could not update the category. Please try again.")


@api_router.delete("/financials/categories/{category_id}")
async def delete_financial_category(category_id: str, user: User = Depends(get_current_user)):
    try:
        existing = await db.overhead_categories.find_one({"id": category_id}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="Category not found")
        await db.overhead_expenses.delete_many({"category_id": category_id})
        await db.overhead_categories.delete_one({"id": category_id})
        logger.info(f"Deleted overhead category {category_id} user={user.user_id}")
        return {"success": True}
    except HTTPException:
        raise
    except Exception as ex:
        logger.error(f"Delete overhead category failed category_id={category_id}: {ex}")
        raise HTTPException(status_code=500, detail="Could not delete the category. Please try again.")


@api_router.get("/financials/expenses")
async def list_financial_expenses(user: User = Depends(get_current_user), category_id: str = ""):
    try:
        query = {"category_id": category_id} if category_id else {}
        docs = await db.overhead_expenses.find(query, {"_id": 0}).sort("date", -1).to_list(5000)
        return [OverheadExpense(**d).model_dump() for d in docs]
    except Exception as ex:
        logger.error(f"List overhead expenses failed: {ex}")
        raise HTTPException(status_code=500, detail="Could not load expenses. Please try again.")


@api_router.post("/financials/expenses")
async def create_financial_expense(payload: OverheadExpenseCreate, user: User = Depends(get_current_user)):
    try:
        category = await db.overhead_categories.find_one({"id": payload.category_id}, {"_id": 0})
        if not category:
            raise HTTPException(status_code=400, detail="Choose a valid expense category.")
        description = (payload.description or "").strip()
        if not description:
            raise HTTPException(status_code=400, detail="Expense description is required.")
        amount = parse_money(payload.amount, "Expense amount")
        date = (payload.date or "").strip() or now_iso()[:10]
        obj = OverheadExpense(
            category_id=payload.category_id,
            description=description,
            amount=amount,
            date=date,
            notes=(payload.notes or "").strip(),
        )
        await db.overhead_expenses.insert_one(obj.model_dump())
        logger.info(f"Created overhead expense {obj.id} amount={amount} user={user.user_id}")
        return obj.model_dump()
    except HTTPException:
        raise
    except Exception as ex:
        logger.error(f"Create overhead expense failed: {ex}")
        raise HTTPException(status_code=500, detail="Could not add the expense. Please try again.")


@api_router.put("/financials/expenses/{expense_id}")
async def update_financial_expense(expense_id: str, payload: OverheadExpenseCreate, user: User = Depends(get_current_user)):
    try:
        existing = await db.overhead_expenses.find_one({"id": expense_id}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="Expense not found")
        category = await db.overhead_categories.find_one({"id": payload.category_id}, {"_id": 0})
        if not category:
            raise HTTPException(status_code=400, detail="Choose a valid expense category.")
        description = (payload.description or "").strip()
        if not description:
            raise HTTPException(status_code=400, detail="Expense description is required.")
        amount = parse_money(payload.amount, "Expense amount")
        updated = {
            **existing,
            "category_id": payload.category_id,
            "description": description,
            "amount": amount,
            "date": (payload.date or "").strip() or existing.get("date") or now_iso()[:10],
            "notes": (payload.notes or "").strip(),
        }
        await db.overhead_expenses.update_one({"id": expense_id}, {"$set": updated})
        logger.info(f"Updated overhead expense {expense_id} user={user.user_id}")
        return OverheadExpense(**updated).model_dump()
    except HTTPException:
        raise
    except Exception as ex:
        logger.error(f"Update overhead expense failed expense_id={expense_id}: {ex}")
        raise HTTPException(status_code=500, detail="Could not update the expense. Please try again.")


@api_router.delete("/financials/expenses/{expense_id}")
async def delete_financial_expense(expense_id: str, user: User = Depends(get_current_user)):
    try:
        existing = await db.overhead_expenses.find_one({"id": expense_id}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="Expense not found")
        await db.overhead_expenses.delete_one({"id": expense_id})
        logger.info(f"Deleted overhead expense {expense_id} user={user.user_id}")
        return {"success": True}
    except HTTPException:
        raise
    except Exception as ex:
        logger.error(f"Delete overhead expense failed expense_id={expense_id}: {ex}")
        raise HTTPException(status_code=500, detail="Could not delete the expense. Please try again.")


@api_router.get("/financials/other-income")
async def list_other_income(user: User = Depends(get_current_user)):
    try:
        docs = await db.other_income.find({}, {"_id": 0}).sort("date", -1).to_list(2000)
        return [OtherIncome(**d).model_dump() for d in docs]
    except Exception as ex:
        logger.error(f"List other income failed: {ex}")
        raise HTTPException(status_code=500, detail="Could not load other income. Please try again.")


@api_router.post("/financials/other-income")
async def create_other_income(payload: OtherIncomeCreate, user: User = Depends(get_current_user)):
    try:
        description = (payload.description or "").strip()
        if not description:
            raise HTTPException(status_code=400, detail="Description is required.")
        amount = parse_money(payload.amount, "Income amount")
        obj = OtherIncome(
            description=description,
            amount=amount,
            date=(payload.date or "").strip() or now_iso()[:10],
            notes=(payload.notes or "").strip(),
            source=(payload.source or "other").strip() or "other",
        )
        await db.other_income.insert_one(obj.model_dump())
        logger.info(f"Created other income {obj.id} amount={amount} user={user.user_id}")
        return obj.model_dump()
    except HTTPException:
        raise
    except Exception as ex:
        logger.error(f"Create other income failed: {ex}")
        raise HTTPException(status_code=500, detail="Could not add other income. Please try again.")


@api_router.delete("/financials/other-income/{income_id}")
async def delete_other_income(income_id: str, user: User = Depends(get_current_user)):
    try:
        existing = await db.other_income.find_one({"id": income_id}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="Other income not found")
        await db.other_income.delete_one({"id": income_id})
        logger.info(f"Deleted other income {income_id} user={user.user_id}")
        return {"success": True}
    except HTTPException:
        raise
    except Exception as ex:
        logger.error(f"Delete other income failed income_id={income_id}: {ex}")
        raise HTTPException(status_code=500, detail="Could not delete other income. Please try again.")


async def sync_pending_tax_classifications(year: int):
    """Mirror book expenses into pending tax rows so the assistant has a queue. No AI."""
    existing = await db.tax_classifications.find({}, {"_id": 0, "source": 1, "source_id": 1}).to_list(8000)
    seen = {(d.get("source"), d.get("source_id")) for d in existing if d.get("source_id")}
    to_insert = []

    categories = {c["id"]: c.get("name", "") for c in await db.overhead_categories.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(500)}
    for exp in await db.overhead_expenses.find({}, {"_id": 0}).to_list(5000):
        exp_year = year_of(exp.get("date") or exp.get("created_at"), year)
        if exp_year != year:
            continue
        key = ("overhead", exp.get("id"))
        if key in seen:
            continue
        to_insert.append(TaxClassification(
            year=year,
            source="overhead",
            source_id=exp.get("id", ""),
            category_name=categories.get(exp.get("category_id"), ""),
            description=exp.get("description") or "Overhead expense",
            amount=float(exp.get("amount") or 0),
            date=exp.get("date") or "",
            status="pending",
            tax_category="unclassified",
            deductibility="unclassified",
        ).model_dump())

    for job in await db.jobs.find({}, {"_id": 0}).to_list(2000):
        for exp in job.get("expenses") or []:
            if exp.get("kind") and exp.get("kind") != "actual":
                continue
            exp_year = year_of(exp.get("date") or exp.get("created_at"), year)
            if exp_year != year:
                continue
            key = ("job", exp.get("id"))
            if key in seen:
                continue
            to_insert.append(TaxClassification(
                year=year,
                source="job",
                source_id=exp.get("id", ""),
                job_id=job.get("id", ""),
                category_name=exp.get("category") or job.get("name") or "Job",
                description=exp.get("description") or "Job expense",
                amount=float(exp.get("amount") or 0),
                date=exp.get("date") or "",
                status="pending",
                tax_category="unclassified",
                deductibility="unclassified",
            ).model_dump())

    if to_insert:
        await db.tax_classifications.insert_many(to_insert)
        logger.info(f"Synced {len(to_insert)} pending tax classifications for {year}")


async def compute_tax_summary(year: int) -> dict:
    invoices = await db.invoices.find({}, {"_id": 0}).to_list(2000)
    other_docs = await db.other_income.find({}, {"_id": 0}).to_list(2000)
    income_total = 0.0
    for inv in invoices:
        if year_of(inv.get("created_at")) == year:
            income_total += float(inv.get("amount_paid") or 0)
    for item in other_docs:
        if year_of(item.get("date") or item.get("created_at")) == year:
            income_total += float(item.get("amount") or 0)

    rows = await db.tax_classifications.find({"year": year}, {"_id": 0}).to_list(8000)
    deductions_total = 0.0
    pending_count = 0
    classified_count = 0
    for row in rows:
        status = row.get("status") or "pending"
        if status == "pending":
            pending_count += 1
        elif status in ("classified", "needs_review"):
            classified_count += 1
        if row.get("deductibility") in ("deductible", "partial"):
            deductions_total += float(row.get("deductible_amount") or 0)

    open_questions = await db.tax_questions.count_documents({"status": "open"})
    summary = TaxSummary(
        year=year,
        income_total=round(income_total, 2),
        deductions_total=round(deductions_total, 2),
        estimated_tax=0.0,
        estimated_rate=0.0,
        pending_count=pending_count,
        classified_count=classified_count,
        open_questions=open_questions,
    ).model_dump()
    await db.tax_summaries.update_one(
        {"year": year},
        {"$set": {k: v for k, v in summary.items() if k != "id"}},
        upsert=True,
    )
    stored = await db.tax_summaries.find_one({"year": year}, {"_id": 0})
    return TaxSummary(**stored).model_dump() if stored else summary


@api_router.get("/financials/tax/summary")
async def tax_summary(user: User = Depends(get_current_user)):
    try:
        year = datetime.now(timezone.utc).year
        await sync_pending_tax_classifications(year)
        data = await compute_tax_summary(year)
        logger.info(f"Tax summary loaded year={year} user={user.user_id}")
        return data
    except Exception as ex:
        logger.error(f"Tax summary failed: {ex}")
        raise HTTPException(status_code=500, detail="Could not load the tax summary. Please try again.")


@api_router.get("/financials/tax/classifications")
async def list_tax_classifications(user: User = Depends(get_current_user)):
    try:
        year = datetime.now(timezone.utc).year
        await sync_pending_tax_classifications(year)
        docs = await db.tax_classifications.find({"year": year}, {"_id": 0}).sort("date", -1).to_list(8000)
        return [TaxClassification(**d).model_dump() for d in docs]
    except Exception as ex:
        logger.error(f"List tax classifications failed: {ex}")
        raise HTTPException(status_code=500, detail="Could not load tax classifications. Please try again.")


@api_router.post("/financials/tax/classifications")
async def create_tax_classification(payload: TaxClassificationCreate, user: User = Depends(get_current_user)):
    try:
        year = payload.year or datetime.now(timezone.utc).year
        obj = TaxClassification(
            year=year,
            source=payload.source or "overhead",
            source_id=payload.source_id or "",
            job_id=payload.job_id or "",
            category_name=(payload.category_name or "").strip(),
            description=(payload.description or "").strip() or "Expense",
            amount=round(float(payload.amount or 0), 2),
            date=(payload.date or "").strip() or now_iso()[:10],
            tax_category=payload.tax_category or "unclassified",
            deductibility=payload.deductibility or "unclassified",
            deductible_amount=round(float(payload.deductible_amount or 0), 2),
            status=payload.status or "pending",
            confidence=float(payload.confidence or 0),
            classified_by=payload.classified_by or "",
            notes=(payload.notes or "").strip(),
        )
        await db.tax_classifications.insert_one(obj.model_dump())
        logger.info(f"Created tax classification {obj.id} user={user.user_id}")
        return obj.model_dump()
    except HTTPException:
        raise
    except Exception as ex:
        logger.error(f"Create tax classification failed: {ex}")
        raise HTTPException(status_code=500, detail="Could not save the tax classification. Please try again.")


@api_router.put("/financials/tax/classifications/{classification_id}")
async def update_tax_classification(classification_id: str, payload: TaxClassificationUpdate, user: User = Depends(get_current_user)):
    try:
        existing = await db.tax_classifications.find_one({"id": classification_id}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="Tax classification not found")
        updates = {k: v for k, v in payload.model_dump().items() if v is not None}
        updates["updated_at"] = now_iso()
        await db.tax_classifications.update_one({"id": classification_id}, {"$set": updates})
        fresh = await db.tax_classifications.find_one({"id": classification_id}, {"_id": 0})
        logger.info(f"Updated tax classification {classification_id} user={user.user_id}")
        return TaxClassification(**fresh).model_dump()
    except HTTPException:
        raise
    except Exception as ex:
        logger.error(f"Update tax classification failed classification_id={classification_id}: {ex}")
        raise HTTPException(status_code=500, detail="Could not update the tax classification. Please try again.")


@api_router.get("/financials/tax/questions")
async def list_tax_questions(user: User = Depends(get_current_user)):
    try:
        docs = await db.tax_questions.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
        return [TaxQuestion(**d).model_dump() for d in docs]
    except Exception as ex:
        logger.error(f"List tax questions failed: {ex}")
        raise HTTPException(status_code=500, detail="Could not load tax questions. Please try again.")


@api_router.post("/financials/tax/questions")
async def create_tax_question(payload: TaxQuestionCreate, user: User = Depends(get_current_user)):
    try:
        question = (payload.question or "").strip()
        if not question:
            raise HTTPException(status_code=400, detail="Question text is required.")
        obj = TaxQuestion(
            classification_id=payload.classification_id or "",
            question=question,
            asked_by=(payload.asked_by or "ai").strip() or "ai",
        )
        await db.tax_questions.insert_one(obj.model_dump())
        logger.info(f"Created tax question {obj.id} user={user.user_id}")
        return obj.model_dump()
    except HTTPException:
        raise
    except Exception as ex:
        logger.error(f"Create tax question failed: {ex}")
        raise HTTPException(status_code=500, detail="Could not save the tax question. Please try again.")


@api_router.post("/financials/tax/questions/{question_id}/answer")
async def answer_tax_question(question_id: str, payload: TaxQuestionAnswer, user: User = Depends(get_current_user)):
    try:
        existing = await db.tax_questions.find_one({"id": question_id}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="Question not found")
        answer = (payload.answer or "").strip()
        if not answer:
            raise HTTPException(status_code=400, detail="An answer is required.")
        updates = {"answer": answer, "status": "answered", "answered_at": now_iso()}
        await db.tax_questions.update_one({"id": question_id}, {"$set": updates})
        fresh = await db.tax_questions.find_one({"id": question_id}, {"_id": 0})
        logger.info(f"Answered tax question {question_id} user={user.user_id}")
        return TaxQuestion(**fresh).model_dump()
    except HTTPException:
        raise
    except Exception as ex:
        logger.error(f"Answer tax question failed question_id={question_id}: {ex}")
        raise HTTPException(status_code=500, detail="Could not save the answer. Please try again.")


# ---------------- Dashboard ----------------
@api_router.get("/dashboard")
async def dashboard(user: User = Depends(get_current_user)):
    estimates = await db.estimates.find({}, {"_id": 0}).to_list(1000)
    jobs = await db.jobs.find({}, {"_id": 0}).to_list(1000)
    invoices = await db.invoices.find({}, {"_id": 0}).to_list(1000)

    open_statuses = {"Draft", "Sent", "Follow-up"}
    open_estimates = [e for e in estimates if e.get("status") in open_statuses]
    pipeline_value = round(sum(e.get("total", 0) for e in open_estimates), 2)
    active_jobs = len([j for j in jobs if j.get("status") == "Active"])

    year = datetime.now(timezone.utc).year
    ytd_revenue = 0.0
    for inv in invoices:
        created = inv.get("created_at", "")
        try:
            dt = datetime.fromisoformat(created)
            if dt.year == year:
                ytd_revenue += inv.get("amount_paid", 0)
        except Exception:
            pass
    ytd_revenue = round(ytd_revenue, 2)

    follow_ups = [e for e in estimates if e.get("status") in {"Follow-up", "Sent"}]
    follow_ups = sorted(follow_ups, key=lambda x: x.get("total", 0), reverse=True)[:10]

    won_count = len([e for e in estimates if e.get("status") == "Won"])
    total_estimates = len(estimates)
    win_rate = round((won_count / total_estimates * 100), 1) if total_estimates else 0

    return {
        "pipeline_value": pipeline_value,
        "open_estimates_count": len(open_estimates),
        "active_jobs": active_jobs,
        "ytd_revenue": ytd_revenue,
        "win_rate": win_rate,
        "total_clients": await db.clients.count_documents({}),
        "follow_ups": [Estimate(**e).model_dump() for e in follow_ups],
    }


# ---------------- Seed ----------------
async def seed_data():
    if await db.clients.count_documents({}) > 0:
        return
    logger.info("Seeding demo data...")

    clients = [
        Client(name="Sarah Mitchell", phone=phone_to_e164("(512) 555-0134"), email="sarah.mitchell@email.com", address="4820 Oak Ridge Dr, Austin, TX", source="Thumbtack", status="Active", notes="Full kitchen remodel."),
        Client(name="James Rodriguez", phone=phone_to_e164("(512) 555-0198"), email="jrodriguez@email.com", address="912 Maple Ave, Round Rock, TX", source="Angi", status="Active", notes="Master bath renovation."),
        Client(name="Emily Chen", phone=phone_to_e164("(512) 555-0176"), email="emily.chen@email.com", address="228 Cedar Ln, Cedar Park, TX", source="Referral", status="Lead", notes="Interested in roofing."),
        Client(name="Michael Thompson", phone=phone_to_e164("(512) 555-0142"), email="mthompson@email.com", address="1560 Sunset Blvd, Austin, TX", source="Website", status="Active", notes="Home addition project."),
        Client(name="Linda Garcia", phone=phone_to_e164("(512) 555-0109"), email="linda.g@email.com", address="770 Birch St, Georgetown, TX", source="Referral", status="Won", notes="Exterior siding & paint."),
        Client(name="David Park", phone=phone_to_e164("(512) 555-0155"), email="dpark@email.com", address="345 Willow Way, Pflugerville, TX", source="Thumbtack", status="Lead", notes="Deck build inquiry."),
    ]
    for c in clients:
        await db.clients.insert_one(c.model_dump())

    def li(desc, qty, price):
        return LineItem(description=desc, quantity=qty, unit_price=price, amount=round(qty * price, 2))

    est_specs = [
        {"client": clients[0], "category": "Kitchen", "status": "Won", "items": [li("Custom cabinets", 1, 14500), li("Quartz countertops", 45, 85), li("Tile backsplash & labor", 1, 3200), li("Appliance install", 1, 1800)], "tax": 8.25},
        {"client": clients[1], "category": "Bathroom", "status": "Sent", "items": [li("Walk-in shower & glass", 1, 6800), li("Vanity & fixtures", 1, 2400), li("Tile flooring", 90, 12), li("Plumbing labor", 1, 2200)], "tax": 8.25},
        {"client": clients[2], "category": "Roofing", "status": "Follow-up", "items": [li("Architectural shingles", 28, 420), li("Tear-off & disposal", 1, 2400), li("Underlayment & flashing", 1, 1600)], "tax": 8.25},
        {"client": clients[3], "category": "Addition", "status": "Follow-up", "items": [li("Foundation & framing", 1, 38000), li("Roofing & siding", 1, 14500), li("Electrical & HVAC", 1, 12000), li("Interior finish", 1, 18500)], "tax": 8.25},
        {"client": clients[4], "category": "Exterior", "status": "Won", "items": [li("Fiber cement siding", 1, 16800), li("Exterior paint", 1, 4200), li("Trim & soffit", 1, 3100)], "tax": 8.25},
        {"client": clients[5], "category": "Exterior", "status": "Draft", "items": [li("Composite deck 300 sqft", 300, 32), li("Railing system", 1, 2800), li("Stairs & footings", 1, 1900)], "tax": 8.25},
    ]
    won_estimates = []
    for i, spec in enumerate(est_specs):
        items = spec["items"]
        subtotal = round(sum(x.amount for x in items), 2)
        tax_amount = round(subtotal * spec["tax"] / 100, 2)
        total = round(subtotal + tax_amount, 2)
        est = Estimate(
            estimate_number=f"EST-2026-{i+1:04d}",
            client_id=spec["client"].id,
            client_name=spec["client"].name,
            category=spec["category"],
            status=spec["status"],
            line_items=items,
            subtotal=subtotal,
            tax_rate=spec["tax"],
            tax_amount=tax_amount,
            total=total,
            notes="",
        )
        await db.estimates.insert_one(est.model_dump())
        if spec["status"] == "Won":
            won_estimates.append(est)

    # Jobs from won estimates
    for j, est in enumerate(won_estimates):
        expenses = [
            Expense(category="Materials", description="Initial material order", amount=round(est.total * 0.30, 2), kind="actual"),
            Expense(category="Subcontractors", description="Labor crew", amount=round(est.total * 0.20, 2), kind="committed"),
            Expense(category="Overhead", description="Permits & dumpster", amount=round(est.total * 0.05, 2), kind="actual"),
        ]
        job = Job(
            job_number=f"JOB-2026-{j+1:04d}",
            name=f"{est.category} - {est.client_name}",
            estimate_id=est.id,
            client_id=est.client_id,
            client_name=est.client_name,
            status="Active" if j == 0 else "Completed",
            budget=round(est.total * 0.70, 2),
            expenses=expenses,
        )
        await db.jobs.insert_one(job.model_dump())

    # Invoice from first won estimate
    if won_estimates:
        est = won_estimates[0]
        inv = Invoice(
            invoice_number="INV-2026-0001",
            estimate_id=est.id,
            client_id=est.client_id,
            client_name=est.client_name,
            status="Partial",
            line_items=est.line_items,
            amount=est.total,
            amount_paid=round(est.total * 0.5, 2),
            due_date=(datetime.now(timezone.utc) + timedelta(days=15)).isoformat(),
        )
        await db.invoices.insert_one(inv.model_dump())
        est2 = won_estimates[1] if len(won_estimates) > 1 else est
        inv2 = Invoice(
            invoice_number="INV-2026-0002",
            estimate_id=est2.id,
            client_id=est2.client_id,
            client_name=est2.client_name,
            status="Paid",
            line_items=est2.line_items,
            amount=est2.total,
            amount_paid=est2.total,
            due_date=(datetime.now(timezone.utc) - timedelta(days=5)).isoformat(),
        )
        await db.invoices.insert_one(inv2.model_dump())
    logger.info("Seed complete.")


async def seed_admin():
    email = (os.environ.get("ADMIN_EMAIL") or "").strip().lower()
    password = os.environ.get("ADMIN_PASSWORD") or ""
    if not email:
        logger.warning("ADMIN_EMAIL is not set; skipping owner seed.")
        return
    if not password:
        logger.warning("ADMIN_PASSWORD is not set; cannot seed or reset owner account.")
        return
    try:
        existing = await db.users.find_one({"email": email})
        if not existing:
            await db.users.insert_one({
                "user_id": f"user_{uuid.uuid4().hex[:12]}",
                "email": email,
                "name": "Owner",
                "picture": "",
                "role": "admin",
                "password_hash": hash_password(password),
                "created_at": now_iso(),
            })
            logger.info("Seeded owner account for %s.", email)
            return
        updates = {}
        stored_hash = existing.get("password_hash") or ""
        if not stored_hash or not verify_password(password, stored_hash):
            updates["password_hash"] = hash_password(password)
        if existing.get("role") != "admin":
            updates["role"] = "admin"
        if updates:
            await db.users.update_one({"email": email}, {"$set": updates})
            logger.info("Reset owner account for %s (fields=%s).", email, sorted(updates.keys()))
        else:
            logger.info("Owner account already matches env credentials for %s.", email)
    except Exception:
        logger.exception("Failed to seed or reset owner account.")
        raise


@app.on_event("startup")
async def on_startup():
    key = (os.environ.get("VAPI_API_KEY") or "").strip()
    if key:
        logger.info(f"Vapi API key loaded (ends with {key[-4:]})")
    else:
        logger.warning("Vapi API key is not loaded; outbound calling is disabled.")
    await seed_data()
    await get_company()
    await seed_admin()
    await backfill_client_ids()
    await init_counters()
    await seed_overhead_categories()
    await seed_leads()


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
