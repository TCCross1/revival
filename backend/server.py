from fastapi import FastAPI, APIRouter, Depends, HTTPException, Request, Response, Cookie, BackgroundTasks, File, Form, UploadFile
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
import hashlib
import asyncio
import bcrypt
import jwt
import secrets
from html import escape
import calendar
import json
from datetime import datetime, timezone, timedelta
from fastapi.responses import StreamingResponse, RedirectResponse
from io import BytesIO
from pymongo import ReturnDocument

ROOT_DIR = Path(__file__).parent
# Load env before any local module that also calls load_dotenv.
# interpolate=False so passwords containing `$` (e.g. Cmc0103$$) are stored verbatim.
load_dotenv(ROOT_DIR.parent / ".env", interpolate=False)
load_dotenv(ROOT_DIR / ".env", interpolate=False)

from email_pdf import (
    build_estimate_pdf, build_invoice_pdf, build_contract_pdf,
    build_job_sheet_pdf, build_job_receipts_pdf,
    send_email, EMAIL_FROM_NAME, money,
)
from vapi_client import place_outbound_call, VapiConfigError, VapiRequestError
from phone import to_e164 as phone_to_e164
from thumbtack_webhook import (
    parse_thumbtack_payload,
    webhook_authorized,
    configured_webhook_secret,
    redact_headers,
    is_local_test_delivery,
    NGROK_WEBHOOK_URL_FORMAT,
)
from job_sheet import (
    JOB_SHEET_CATEGORIES,
    coerce_category_budgets,
    compute_job_sheet_totals,
    empty_category_budgets,
    export_foundation,
    money as sheet_money,
    normalize_sheet_category,
)
import google_drive as gdrive
from cryptography.fernet import Fernet
from overhead_catalog import OVERHEAD_CATALOG, OVERHEAD_CATEGORY_RENAMES
from floor_plan import (
    compute_takeoffs as floor_compute_takeoffs,
    empty_document as floor_empty_document,
    import_roomplan as floor_import_roomplan,
    public_catalog as floor_public_catalog,
)
from floor_plan_scope import build_scope as floor_build_scope
from showcase_kitchen import SHOWCASE_PLAN_ID, build_showcase_plan
from floor_plan_report import build_client_report
from permit_model import extract_permit_model, public_preview
from permit_report import build_permit_report
from pricing import (
    DEFAULT_CC_FEE_PCT,
    DEFAULT_OPTIONAL_TAX_PCT,
    DEFAULT_PROFIT_MARGIN_PCT,
    DEFAULT_SALES_TAX_PCT,
    compute_pricing_breakdown,
    days_in_month as month_day_count,
    job_sheet_direct_costs,
    month_label,
    parse_year_month,
    uses_smart_pricing,
    year_month_of,
)

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(
    mongo_url,
    serverSelectionTimeoutMS=8000,
    connectTimeoutMS=8000,
)
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

DEFAULT_ESTIMATE_TERMS = (
    "This estimate is valid for 30 days from the date above.\n\n"
    "The price covers only the work listed. Anything not listed is extra.\n\n"
    "If we find hidden issues (rot, mold, outdated wiring, or plumbing inside walls), we will stop and give you a written change order before doing that work.\n\n"
    "A signed estimate or contract is required before we order materials or schedule the crew.\n\n"
    "Revival Home Remodeling never asks for payment details by email."
)

DEFAULT_INVOICE_TERMS = (
    "Payment is due by the due date shown on this invoice.\n\n"
    "Please make checks payable to Revival Home Remodeling, LLC.\n\n"
    "Unpaid balances may pause remaining work until the account is current.\n\n"
    "Questions about this invoice? Call 859-227-0340 or email revivalhomeremodelingllc@gmail.com.\n\n"
    "We never ask for passwords or payment details by email."
)

DEFAULT_CONTRACT_TERMS = (
    "This contract is between the Client and Revival Home Remodeling, LLC (the Contractor) for the work described in the Scope of Work.\n\n"
    "The Contractor will perform the work in a professional manner consistent with standard remodeling practices.\n\n"
    "The Client will provide reasonable access to the property, keep the work area reasonably clear, and make timely decisions on selections so the job is not delayed.\n\n"
    "The contract price covers only the work listed. The Client is responsible for utilities (water, electric, and HVAC as needed) during construction unless noted otherwise.\n\n"
    "The Contractor is not responsible for delays caused by weather, material shortages, permit offices, or other events outside our control.\n\n"
    "This written contract, including the payment schedule, exclusions, and change-order terms, is the full agreement. Verbal promises are not binding."
)

DEFAULT_CHANGE_ORDER_TERMS = (
    "Any change to the scope of work, price, or timeline must be put in writing.\n"
    "Both the Client and the Contractor must sign the change order before the additional work begins.\n"
    "Verbal agreements are not binding.\n"
    "Each change order will state the description of the change, the price adjustment, and any effect on the schedule.\n"
    "Change order work will be priced at cost plus a standard markup of {markup}% unless a lump-sum price is agreed in writing."
)

DEFAULT_EXCLUSIONS_TEXT = "\n".join(DEFAULT_EXCLUSIONS)


def parse_exclusion_lines(text):
    lines = []
    for raw in str(text or "").splitlines():
        line = raw.strip().lstrip("•-").strip()
        if line:
            lines.append(line)
    return lines or list(DEFAULT_EXCLUSIONS)


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
    google_drive_folder_id: str = ""
    google_drive_folder_name: str = ""
    google_drive_folder_url: str = ""
    google_drive_synced_at: str = ""
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
    thumbtack_lead_id: str = ""
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
    thumbtack_lead_id: str = ""


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
    terms: str = ""
    materials_cost: float = 0.0
    labor_cost: float = 0.0
    subcontractors_cost: float = 0.0
    other_cost: float = 0.0
    estimated_days: float = 0.0
    profit_margin: Optional[float] = None
    apply_optional_tax: bool = False
    pricing: Optional[dict] = None
    floor_plan_id: str = ""
    created_at: str = Field(default_factory=now_iso)


class EstimateCreate(BaseModel):
    client_id: str = ""
    client_name: str = ""
    category: str = "Kitchen"
    status: str = "Draft"
    line_items: List[LineItem] = []
    tax_rate: float = 0.0
    notes: str = ""
    terms: str = ""
    materials_cost: float = 0.0
    labor_cost: float = 0.0
    subcontractors_cost: float = 0.0
    other_cost: float = 0.0
    estimated_days: float = 0.0
    profit_margin: Optional[float] = None
    apply_optional_tax: bool = False
    floor_plan_id: str = ""


class Expense(BaseModel):
    id: str = Field(default_factory=new_id)
    category: str = "Materials"
    description: str = ""
    amount: float = 0.0
    kind: str = "actual"  # committed | actual
    date: str = Field(default_factory=now_iso)
    notes: str = ""
    receipt_url: str = ""
    receipt_drive_file_id: str = ""
    created_by: str = ""
    created_by_name: str = ""


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
    crew_ids: List[str] = []
    geofence: Optional[dict] = None
    created_at: str = Field(default_factory=now_iso)


class JobCreate(BaseModel):
    name: str
    estimate_id: str = ""
    client_id: str = ""
    client_name: str = ""
    status: str = "Active"
    budget: float = 0.0


class JobSheetUpdate(BaseModel):
    client_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    project_type: Optional[str] = None
    source: Optional[str] = None
    budget: Optional[float] = None
    income: Optional[float] = None
    notes: Optional[str] = None
    category_budgets: Optional[dict] = None
    estimated_days: Optional[float] = None
    profit_margin: Optional[float] = None
    apply_optional_tax: Optional[bool] = None


class FloorPlan(BaseModel):
    id: str = Field(default_factory=new_id)
    name: str = "Floor plan"
    client_id: str = ""
    client_name: str = ""
    job_id: str = ""
    address: str = ""
    project_type: str = "Kitchen"
    version_kind: str = "existing"
    parent_id: str = ""
    version: int = 1
    document: dict = Field(default_factory=dict)
    takeoffs: dict = Field(default_factory=dict)
    google_drive_file_id: str = ""
    google_drive_url: str = ""
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)


class FloorPlanCreate(BaseModel):
    name: str = "Floor plan"
    client_id: str = ""
    client_name: str = ""
    job_id: str = ""
    address: str = ""
    project_type: str = "Kitchen"
    version_kind: str = "existing"
    parent_id: str = ""
    document: Optional[dict] = None


class FloorPlanUpdate(BaseModel):
    name: Optional[str] = None
    client_id: Optional[str] = None
    client_name: Optional[str] = None
    job_id: Optional[str] = None
    address: Optional[str] = None
    project_type: Optional[str] = None
    version_kind: Optional[str] = None
    document: Optional[dict] = None


class FloorPlanAttach(BaseModel):
    estimate_id: str = ""
    contract_id: str = ""


class FloorPlanReportIn(BaseModel):
    snapshots: dict = {}
    estimate_id: str = ""
    contract_id: str = ""


class FloorPlanPermitIn(BaseModel):
    sheets: dict = {}


class ExpenseUpdate(BaseModel):
    category: Optional[str] = None
    description: Optional[str] = None
    amount: Optional[float] = None
    kind: Optional[str] = None
    date: Optional[str] = None


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
    terms: str = ""
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
    terms: str = ""


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


class OverheadLineItem(BaseModel):
    id: str = Field(default_factory=new_id)
    category_id: str
    name: str
    sort_order: int = 0
    created_at: str = Field(default_factory=now_iso)


class OverheadLineItemCreate(BaseModel):
    category_id: str
    name: str
    sort_order: Optional[int] = None


class OverheadLineItemUpdate(BaseModel):
    name: Optional[str] = None
    sort_order: Optional[int] = None
    category_id: Optional[str] = None


class OverheadMonthValueUpdate(BaseModel):
    year: Optional[int] = None
    month: Optional[int] = None
    projected: Optional[float] = None
    actual: Optional[float] = None
    notes: Optional[str] = None


class SquareStatement(BaseModel):
    id: str = Field(default_factory=new_id)
    year: int
    month: int
    filename: str = ""
    mime_type: str = ""
    google_drive_file_id: str = ""
    web_view_link: str = ""
    folder_url: str = ""
    uploaded_at: str = Field(default_factory=now_iso)


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
    terms: str = ""
    change_order_terms: str = ""
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
    floor_plan_id: str = ""
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
    terms: Optional[str] = None
    change_order_terms: Optional[str] = None
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
    estimate_terms: str = DEFAULT_ESTIMATE_TERMS
    invoice_terms: str = DEFAULT_INVOICE_TERMS
    contract_terms: str = DEFAULT_CONTRACT_TERMS
    change_order_terms: str = DEFAULT_CHANGE_ORDER_TERMS
    exclusions_text: str = DEFAULT_EXCLUSIONS_TEXT
    default_change_order_markup: float = 20.0
    default_profit_margin: float = DEFAULT_PROFIT_MARGIN_PCT
    credit_card_fee_pct: float = DEFAULT_CC_FEE_PCT
    sales_tax_pct: float = DEFAULT_SALES_TAX_PCT
    optional_tax_pct: float = DEFAULT_OPTIONAL_TAX_PCT


class User(BaseModel):
    user_id: str
    email: str
    name: str
    picture: str = ""
    role: str = "member"
    hourly_rate: float = 0.0


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
    role: str = "manager"
    hourly_rate: float = 0.0


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


def _loopback_client(request: Request) -> bool:
    host = (request.client.host if request.client else "") or ""
    return host in ("127.0.0.1", "::1", "localhost")


def _dev_bypass_auth_enabled() -> bool:
    flag = (os.environ.get("DEV_BYPASS_AUTH") or "").strip().lower()
    return flag in ("1", "true", "yes", "on")


def _header_hostname(value: str) -> str:
    raw = (value or "").strip()
    if not raw:
        return ""
    if "://" not in raw:
        raw = "http://" + raw
    try:
        from urllib.parse import urlparse
        return (urlparse(raw).hostname or "").lower()
    except Exception:
        return ""


def _dev_bypass_allowed(request: Request) -> bool:
    """Local CRA only. Loopback is not enough while ngrok proxies 8001."""
    if not _dev_bypass_auth_enabled():
        return False
    if not _loopback_client(request):
        return False
    page_host = _header_hostname(request.headers.get("origin") or "") or _header_hostname(
        request.headers.get("referer") or ""
    )
    return page_host in ("127.0.0.1", "localhost")


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


async def assert_user_feature(user: User, feature: str):
    from field_ops import can
    doc = await db.settings.find_one({"key": "permissions"}, {"_id": 0}) or {}
    if not can(user.role, feature, doc.get("roles")):
        raise HTTPException(status_code=403, detail="You do not have access to that.")


@api_router.get("/team")
async def list_team(admin: User = Depends(require_admin)):
    docs = await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(1000)
    return [{
        "user_id": d["user_id"], "email": d["email"], "name": d.get("name", ""),
        "role": d.get("role", "member"), "hourly_rate": float(d.get("hourly_rate") or 0),
        "created_at": d.get("created_at", ""),
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
    from field_ops import normalize_role
    role = normalize_role(body.role)
    if role not in ("admin", "manager", "field"):
        role = "manager"
    doc = {
        "user_id": f"user_{uuid.uuid4().hex[:12]}", "email": email,
        "name": body.name.strip() or email, "picture": "", "role": role,
        "hourly_rate": max(0.0, float(body.hourly_rate or 0)),
        "password_hash": hash_password(body.password), "created_at": now_iso(),
    }
    await db.users.insert_one(doc)
    return {"user_id": doc["user_id"], "email": email, "name": doc["name"], "role": role, "hourly_rate": doc["hourly_rate"]}


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


@api_router.post("/auth/dev-bypass")
async def auth_dev_bypass(request: Request, response: Response):
    """Mint a local owner JWT for design work. Disabled unless DEV_BYPASS_AUTH=1 and the caller is loopback."""
    try:
        if not _dev_bypass_auth_enabled():
            raise HTTPException(status_code=404, detail="Not found")
        if not _dev_bypass_allowed(request):
            logger.warning(
                "Rejected dev auth bypass from client=%s origin=%s",
                request.client.host if request.client else "unknown",
                request.headers.get("origin"),
            )
            raise HTTPException(status_code=403, detail="Dev bypass is localhost only")
        email = (os.environ.get("ADMIN_EMAIL") or "").strip().lower()
        user = None
        if email:
            user = await db.users.find_one({"email": email}, {"_id": 0})
        if not user:
            user = await db.users.find_one({"role": "admin"}, {"_id": 0})
        if not user:
            raise HTTPException(
                status_code=503,
                detail="No local owner account is seeded yet. Start MongoDB and restart the API.",
            )
        token = create_access_token(user["user_id"], user["email"])
        response.set_cookie(
            "access_token",
            token,
            httponly=True,
            secure=False,
            samesite="lax",
            path="/",
            max_age=7 * 24 * 60 * 60,
        )
        logger.warning(
            "DEV AUTH BYPASS issued for %s from %s",
            user.get("email"),
            request.client.host if request.client else "unknown",
        )
        return {**User(**user).model_dump(), "session_token": token, "dev_bypass": True}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Dev auth bypass failed")
        raise HTTPException(status_code=503, detail="Could not start a local design session.")


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


DRIVE_SETTINGS_KEY = "google_drive"


class DriveCredentialsIn(BaseModel):
    client_id: str = ""
    client_secret: str = ""


def _drive_fernet():
    secret = (os.environ.get("JWT_SECRET") or "revival-drive-local-key").encode("utf-8")
    digest = hashlib.sha256(secret).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def _encrypt_secret(value: str) -> str:
    raw = (value or "").strip()
    if not raw:
        return ""
    return _drive_fernet().encrypt(raw.encode("utf-8")).decode("utf-8")


def _decrypt_secret(value: str) -> str:
    raw = (value or "").strip()
    if not raw:
        return ""
    try:
        return _drive_fernet().decrypt(raw.encode("utf-8")).decode("utf-8")
    except Exception:
        logger.exception("Could not decrypt a stored Google Drive token")
        return ""


async def load_drive_settings() -> dict:
    try:
        doc = await db.settings.find_one({"key": DRIVE_SETTINGS_KEY}, {"_id": 0})
        return doc or {}
    except Exception:
        logger.exception("Could not load Google Drive settings")
        return {}


def persist_drive_oauth_env(client_id: str, client_secret: str):
    """Keep backend/.env in sync so a server restart still has the keys. Never log values."""
    path = ROOT_DIR / ".env"
    try:
        text = path.read_text() if path.exists() else ""
        def upsert(body: str, key: str, value: str) -> str:
            pattern = re.compile(rf"^{re.escape(key)}=.*$", re.M)
            line = f"{key}={value}"
            if pattern.search(body):
                return pattern.sub(lambda _m: line, body)
            suffix = "" if body.endswith("\n") or not body else "\n"
            return f"{body}{suffix}{line}\n"
        text = upsert(text, "GOOGLE_DRIVE_CLIENT_ID", client_id)
        text = upsert(text, "GOOGLE_DRIVE_CLIENT_SECRET", client_secret)
        path.write_text(text)
    except Exception:
        logger.exception("Could not write Google Drive keys to the local environment file")


async def apply_stored_drive_oauth():
    """Load Company Profile keys into memory when .env is still empty."""
    try:
        if gdrive.oauth_configured():
            return
        doc = await load_drive_settings()
        client_id = (doc.get("oauth_client_id") or "").strip()
        secret = _decrypt_secret(doc.get("oauth_client_secret_enc") or "")
        if client_id and secret:
            gdrive.set_runtime_oauth(client_id, secret)
            os.environ["GOOGLE_DRIVE_CLIENT_ID"] = client_id
            os.environ["GOOGLE_DRIVE_CLIENT_SECRET"] = secret
            logger.info("Loaded Google Drive OAuth keys from Company Profile")
    except Exception:
        logger.exception("Could not apply stored Google Drive OAuth keys")


def tokens_from_settings(doc: dict) -> dict:
    return {
        "access_token": _decrypt_secret((doc or {}).get("access_token_enc") or ""),
        "refresh_token": _decrypt_secret((doc or {}).get("refresh_token_enc") or ""),
        "token_expiry": (doc or {}).get("token_expiry") or "",
        "email": (doc or {}).get("email") or "",
    }


async def save_drive_settings(updates: dict):
    await db.settings.update_one(
        {"key": DRIVE_SETTINGS_KEY},
        {"$set": {**updates, "key": DRIVE_SETTINGS_KEY}},
        upsert=True,
    )


def _client_id_hint(client_id: str) -> str:
    raw = (client_id or "").strip()
    if len(raw) < 12:
        return ""
    return f"…{raw[-18:]}"


async def drive_connection_status() -> dict:
    await apply_stored_drive_oauth()
    configured = gdrive.oauth_configured()
    doc = await load_drive_settings()
    tokens = tokens_from_settings(doc)
    has_refresh = bool(tokens.get("refresh_token"))
    connected = bool(configured and has_refresh)
    email = ((doc.get("email") if connected else "") or "").strip().lower()
    expected = gdrive.expected_email()
    parent_id = doc.get("parent_folder_id") or "" if connected else ""
    root_id = doc.get("root_folder_id") or "" if connected else ""
    keys_saved = bool((doc.get("oauth_client_id") or "").strip() or configured)
    if configured and connected:
        setup_step = "done"
    elif configured or keys_saved:
        setup_step = "connect"
    else:
        setup_step = "save_keys"
    last_error = "" if connected else str(doc.get("last_error") or "")
    return {
        "configured": configured,
        "connected": connected,
        "keys_saved": keys_saved,
        "client_id_hint": _client_id_hint(doc.get("oauth_client_id") or gdrive.oauth_client_id()),
        "email": email,
        "expected_email": expected,
        "email_mismatch": bool(connected and email and email != expected),
        "parent_folder_id": parent_id,
        "parent_folder_url": gdrive.folder_web_url(parent_id) if parent_id else "",
        "root_folder_id": root_id,
        "root_folder_url": gdrive.folder_web_url(root_id) if root_id else "",
        "folders_ready": bool(connected and parent_id and root_id),
        "redirect_uri": gdrive.oauth_redirect_uri(),
        "folder_structure": gdrive.folder_structure_labels(),
        "setup_step": setup_step,
        "last_error": last_error,
    }


def client_drive_fields(client: dict, status: dict | None = None) -> dict:
    folder_id = (client or {}).get("google_drive_folder_id") or ""
    folder_url = (client or {}).get("google_drive_folder_url") or gdrive.folder_web_url(folder_id)
    payload = {
        "folder_id": folder_id,
        "folder_name": (client or {}).get("google_drive_folder_name") or "",
        "folder_url": folder_url,
        "synced_at": (client or {}).get("google_drive_synced_at") or "",
        "has_folder": bool(folder_id),
        "suggested_name": gdrive.client_folder_name(client or {}),
    }
    if status:
        payload.update({
            "configured": bool(status.get("configured")),
            "connected": bool(status.get("connected")),
            "account_email": status.get("email") or "",
            "expected_email": status.get("expected_email") or "",
            "email_mismatch": bool(status.get("email_mismatch")),
        })
    return payload


async def persist_client_folder(client: dict, folder: dict) -> dict:
    folder_id = folder.get("id") or ""
    patch = {
        "google_drive_folder_id": folder_id,
        "google_drive_folder_name": folder.get("name") or "",
        "google_drive_folder_url": folder.get("webViewLink") or gdrive.folder_web_url(folder_id),
        "google_drive_synced_at": now_iso(),
    }
    await db.clients.update_one({"id": client["id"]}, {"$set": patch})
    try:
        await db.job_sheets.update_many(
            {"client_id": client["id"]},
            {"$set": {"google_drive_folder_id": folder_id, "updated_at": now_iso()}},
        )
    except Exception:
        logger.exception("Could not stamp job sheets with Drive folder client_id=%s", client.get("id"))
    return {**client, **patch}


DRIVE_KIND_LABELS = {
    "estimate": "Estimate",
    "invoice": "Invoice",
    "contract": "Contract",
    "job_sheet": "Job Financial Sheet",
    "receipts": "Job Receipts",
    "receipt": "Receipt",
    "floor_plan": "Floor plan",
    "client_report": "Client design proposal",
    "permit_details": "Permit details",
    "materials_list": "Materials list",
    "vendor_quote": "Vendor quote",
    "photo_before": "Photo — Before",
    "photo_during": "Photo — During",
    "photo_after": "Photo — After",
    "other": "Other",
}
UPLOAD_KINDS = [
    "floor_plan", "materials_list", "vendor_quote",
    "photo_before", "photo_during", "photo_after",
    "receipt", "other",
]
MAX_DRIVE_UPLOAD_BYTES = 15 * 1024 * 1024
ALLOWED_DRIVE_UPLOAD_TYPES = {
    "application/pdf",
    "image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif", "image/gif",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "text/csv",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
    "application/octet-stream",
}


def drive_upload_kind_options():
    return [{"id": k, "label": DRIVE_KIND_LABELS[k]} for k in UPLOAD_KINDS]


DRIVE_UPLOAD_EXT_MIME = {
    "pdf": "application/pdf",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "webp": "image/webp",
    "heic": "image/heic",
    "heif": "image/heif",
    "gif": "image/gif",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "xls": "application/vnd.ms-excel",
    "csv": "text/csv",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "doc": "application/msword",
}


async def list_drive_files(client_id: str, job_id: str = "") -> list:
    if not client_id:
        return []
    docs = await db.drive_files.find({"client_id": client_id}, {"_id": 0}).sort("uploaded_at", -1).to_list(500)
    if job_id:
        docs = [
            d for d in docs
            if not d.get("job_id") or d.get("job_id") == job_id or d.get("kind") in ("estimate", "invoice", "contract")
        ]
    return docs


async def client_drive_payload(client: dict | None, job_id: str = "") -> dict:
    client = client or {}
    status = await drive_connection_status()
    payload = client_drive_fields(client, status)
    files = await list_drive_files(client.get("id") or "", job_id=job_id)
    payload["files"] = files
    payload["file_count"] = len(files)
    payload["upload_kinds"] = drive_upload_kind_options()
    return payload


async def maybe_save_drive_file(
    client: dict,
    kind: str,
    source_id: str,
    filename: str,
    content: bytes,
    mime_type: str = "application/pdf",
    job_id: str = "",
    strict: bool = False,
):
    """Save a copy into the client Drive folder. Auto-save never raises; manual upload can."""
    if not client or not content:
        if strict:
            raise HTTPException(status_code=400, detail="Choose a file to upload.")
        return None
    try:
        status = await drive_connection_status()
        if not status.get("connected"):
            if strict:
                raise HTTPException(
                    status_code=400,
                    detail="Google Drive is not connected. Open Company Profile and connect the company Gmail.",
                )
            return None
        updated = await ensure_client_drive_folder(client)
        folder_id = updated.get("google_drive_folder_id") or ""
        existing = None
        if source_id:
            existing = await db.drive_files.find_one(
                {"client_id": updated["id"], "kind": kind, "source_id": source_id},
                {"_id": 0},
            )
        service, _doc = await require_drive_service()
        target = await asyncio.to_thread(gdrive.ensure_kind_folder, service, folder_id, kind)
        target_id = target.get("id") or folder_id
        result = await asyncio.to_thread(
            gdrive.upsert_bytes,
            service,
            target_id,
            filename,
            content,
            mime_type,
            (existing or {}).get("google_drive_file_id") or "",
        )
        record = {
            "id": (existing or {}).get("id") or new_id(),
            "client_id": updated["id"],
            "job_id": job_id or (existing or {}).get("job_id") or "",
            "kind": kind,
            "kind_label": DRIVE_KIND_LABELS.get(kind, kind.replace("_", " ").title()),
            "source_id": source_id or "",
            "filename": result.get("name") or filename,
            "mime_type": mime_type,
            "google_drive_file_id": result.get("id") or "",
            "web_view_link": result.get("webViewLink") or "",
            "uploaded_at": now_iso(),
        }
        await db.drive_files.update_one({"id": record["id"]}, {"$set": record}, upsert=True)
        logger.info("Saved %s to Drive client_id=%s", kind, updated.get("id"))
        return record
    except HTTPException:
        if strict:
            raise
        logger.info("Drive auto-save skipped kind=%s (Drive not ready)", kind)
        return None
    except Exception:
        logger.exception("Drive auto-save failed kind=%s", kind)
        if strict:
            raise HTTPException(status_code=500, detail="Could not save the file to Google Drive. Please try again.")
        return None


async def load_client_for_drive(client_id: str = "", client_name: str = "") -> dict | None:
    cid = (client_id or "").strip()
    if cid:
        found = await db.clients.find_one({"id": cid}, {"_id": 0})
        if found:
            return found
    name = (client_name or "").strip()
    if name:
        return await db.clients.find_one({"name": name}, {"_id": 0})
    return None


async def push_estimate_to_drive(est: dict, pdf_bytes: bytes | None = None):
    try:
        client = await load_client_for_drive(est.get("client_id") or "", est.get("client_name") or "")
        if not client:
            return
        if not pdf_bytes:
            company = await get_company()
            pdf_bytes = build_estimate_pdf(est, client, company)
        filename = f"{est.get('estimate_number') or 'Estimate'} Estimate.pdf"
        await maybe_save_drive_file(client, "estimate", est.get("id") or "", filename, pdf_bytes)
    except Exception:
        logger.exception("Push estimate to Drive failed estimate_id=%s", (est or {}).get("id"))


async def push_invoice_to_drive(inv: dict, pdf_bytes: bytes | None = None):
    try:
        client = await load_client_for_drive(inv.get("client_id") or "", inv.get("client_name") or "")
        if not client:
            client = await resolve_invoice_client(inv)
        if not client:
            return
        if not pdf_bytes:
            company = await get_company()
            pdf_bytes = build_invoice_pdf(inv, client, company)
        filename = f"{inv.get('invoice_number') or 'Invoice'} Invoice.pdf"
        await maybe_save_drive_file(client, "invoice", inv.get("id") or "", filename, pdf_bytes)
    except Exception:
        logger.exception("Push invoice to Drive failed invoice_id=%s", (inv or {}).get("id"))


async def push_contract_to_drive(contract: dict, pdf_bytes: bytes | None = None):
    try:
        client = await load_client_for_drive(contract.get("client_id") or "", contract.get("client_name") or "")
        if not client:
            return
        if not pdf_bytes:
            company = await get_company()
            pdf_bytes = build_contract_pdf(contract, company)
        filename = f"{contract.get('contract_number') or 'Contract'} Contract.pdf"
        await maybe_save_drive_file(client, "contract", contract.get("id") or "", filename, pdf_bytes)
    except Exception:
        logger.exception("Push contract to Drive failed contract_id=%s", (contract or {}).get("id"))


async def push_job_docs_to_drive(job: dict, sheet: dict | None = None):
    try:
        client = await load_client_for_drive(job.get("client_id") or "", job.get("client_name") or "")
        if not client:
            return
        if sheet is None:
            sheet = await db.job_sheets.find_one({"job_id": job.get("id")}, {"_id": 0}) or {}
        company = await get_company()
        totals = compute_job_sheet_totals(sheet or {}, job)
        number = job.get("job_number") or "JOB"
        sheet_pdf = build_job_sheet_pdf(sheet or {}, job, totals, client, company)
        receipts_pdf = build_job_receipts_pdf(job, client, company)
        job_id = job.get("id") or ""
        await maybe_save_drive_file(client, "job_sheet", job_id, f"{number} Financial Sheet.pdf", sheet_pdf, job_id=job_id)
        await maybe_save_drive_file(client, "receipts", job_id, f"{number} Receipts.pdf", receipts_pdf, job_id=job_id)
    except Exception:
        logger.exception("Push job docs to Drive failed job_id=%s", (job or {}).get("id"))


def guess_drive_upload_mime(filename: str, declared: str) -> str:
    declared = (declared or "").split(";")[0].strip().lower()
    if declared in ALLOWED_DRIVE_UPLOAD_TYPES and declared != "application/octet-stream":
        return declared
    ext = ""
    if filename and "." in filename:
        ext = filename.rsplit(".", 1)[-1].lower().strip()
    guessed = DRIVE_UPLOAD_EXT_MIME.get(ext, "")
    if guessed:
        return guessed
    if declared in ALLOWED_DRIVE_UPLOAD_TYPES:
        return declared
    return ""


async def read_drive_upload(upload: UploadFile) -> tuple[str, str, bytes]:
    filename = gdrive.sanitize_filename(upload.filename or "upload.bin")
    raw = await upload.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Choose a file to upload.")
    if len(raw) > MAX_DRIVE_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="That file is too large. Use a file under 15 MB.")
    mime = guess_drive_upload_mime(upload.filename or filename, upload.content_type or "")
    if mime not in ALLOWED_DRIVE_UPLOAD_TYPES:
        raise HTTPException(
            status_code=400,
            detail="That file type is not supported. Use a PDF, photo, Excel, CSV, or Word file.",
        )
    return filename, mime, raw


async def handle_client_drive_upload(client: dict, kind: str, upload: UploadFile, job_id: str = "") -> dict:
    kind = (kind or "").strip().lower()
    if kind not in UPLOAD_KINDS:
        raise HTTPException(status_code=400, detail="Choose a document type.")
    filename, mime, content = await read_drive_upload(upload)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")
    labeled = gdrive.sanitize_filename(f"{DRIVE_KIND_LABELS.get(kind, kind)} {stamp} {filename}")
    return await maybe_save_drive_file(
        client,
        kind,
        new_id(),
        labeled,
        content,
        mime_type=mime,
        job_id=job_id or "",
        strict=True,
    )


async def upload_document_to_client_drive(client: dict, filename: str, content: bytes, mime_type: str = "application/pdf") -> dict:
    """Used by generated PDFs and manual uploads."""
    record = await maybe_save_drive_file(client, "other", "", filename, content, mime_type=mime_type, strict=True)
    return record


async def require_drive_service():
    await apply_stored_drive_oauth()
    if not gdrive.oauth_configured():
        raise HTTPException(
            status_code=400,
            detail="Google Drive is not set up yet. Add the Google client ID and secret, then connect the company Gmail in Company Profile.",
        )
    doc = await load_drive_settings()
    tokens = tokens_from_settings(doc)
    if not tokens.get("refresh_token"):
        raise HTTPException(
            status_code=400,
            detail="Google Drive is not connected. Open Company Profile and connect revivalhomeremodelingllc@gmail.com.",
        )
    try:
        service, refreshed = await asyncio.to_thread(gdrive.build_service, tokens)
    except RuntimeError as ex:
        raise HTTPException(status_code=400, detail=str(ex))
    except Exception:
        logger.exception("Could not build Google Drive client")
        raise HTTPException(status_code=500, detail="Could not reach Google Drive. Please try again.")
    if refreshed:
        patch = {
            "access_token_enc": _encrypt_secret(refreshed.get("access_token") or ""),
            "token_expiry": refreshed.get("token_expiry") or "",
        }
        if refreshed.get("refresh_token"):
            patch["refresh_token_enc"] = _encrypt_secret(refreshed["refresh_token"])
        await save_drive_settings(patch)
        doc = {**doc, **patch}
    return service, doc


async def ensure_client_drive_folder(client: dict) -> dict:
    service, doc = await require_drive_service()
    try:
        tree = await asyncio.to_thread(gdrive.ensure_company_tree, service)
        parent = tree.get("clients") or {}
        company = tree.get("company") or {}
        patch = {}
        if parent.get("id") and parent.get("id") != doc.get("parent_folder_id"):
            patch["parent_folder_id"] = parent["id"]
        if company.get("id") and company.get("id") != doc.get("root_folder_id"):
            patch["root_folder_id"] = company["id"]
        if patch:
            await save_drive_settings(patch)
        folder = await asyncio.to_thread(
            gdrive.ensure_client_folder, service, client, parent.get("id") or ""
        )
    except RuntimeError as ex:
        raise HTTPException(status_code=400, detail=str(ex))
    except HTTPException:
        raise
    except Exception:
        logger.exception("Ensure client Drive folder failed client_id=%s", client.get("id"))
        raise HTTPException(status_code=500, detail="Could not create the Google Drive folder. Please try again.")
    return await persist_client_folder(client, folder)


def company_month_folder_name(year, month) -> str:
    y, m = parse_year_month(year, month)
    return calendar.month_name[m]


async def save_company_drive_file(path_parts: list, filename: str, content: bytes, mime_type: str) -> dict:
    """Save a company file under Revival Pro / nested folders. Never logs file bytes."""
    service, _doc = await require_drive_service()
    try:
        folder = await asyncio.to_thread(gdrive.ensure_folder_path, service, path_parts)
        result = await asyncio.to_thread(
            gdrive.upload_bytes,
            service,
            folder.get("id") or "",
            filename,
            content,
            mime_type,
        )
    except RuntimeError as ex:
        raise HTTPException(status_code=400, detail=str(ex))
    except HTTPException:
        raise
    except Exception:
        logger.exception("Company Drive upload failed path=%s", "/".join(str(p) for p in path_parts))
        raise HTTPException(status_code=500, detail="Could not save the file to Google Drive. Please try again.")
    return {
        "google_drive_file_id": result.get("id") or "",
        "web_view_link": result.get("webViewLink") or "",
        "filename": result.get("name") or filename,
        "folder_id": folder.get("id") or "",
        "folder_url": folder.get("webViewLink") or gdrive.folder_web_url(folder.get("id") or ""),
        "folder_name": folder.get("name") or "",
    }


async def resolve_client_for_job(job: dict, sheet: dict | None = None) -> dict:
    cid = (job or {}).get("client_id") or (sheet or {}).get("client_id") or ""
    if cid:
        found = await db.clients.find_one({"id": cid}, {"_id": 0})
        if found:
            return found
    name = ((sheet or {}).get("client_name") or (job or {}).get("client_name") or "").strip()
    if name:
        found = await db.clients.find_one({"name": name}, {"_id": 0})
        if found:
            return found
    raise HTTPException(status_code=400, detail="This job is not linked to a client, so a Drive folder cannot be created yet.")


# ---------------- Clients ----------------
@api_router.get("/clients", response_model=List[Client])
async def list_clients(user: User = Depends(get_current_user)):
    await assert_user_feature(user, "clients")
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
        "drive": await client_drive_payload(client),
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


# ---------------- Google Drive ----------------
@api_router.get("/google-drive/status")
async def google_drive_status(user: User = Depends(get_current_user)):
    try:
        return await drive_connection_status()
    except Exception:
        logger.exception("Google Drive status failed")
        raise HTTPException(status_code=500, detail="Could not check Google Drive. Please try again.")


@api_router.post("/google-drive/credentials")
async def save_google_drive_credentials(body: DriveCredentialsIn, admin: User = Depends(require_admin)):
    try:
        client_id = (body.client_id or "").strip()
        secret = (body.client_secret or "").strip()
        if len(client_id) < 12 or len(secret) < 8:
            raise HTTPException(
                status_code=400,
                detail="Paste both the Google Client ID and Client Secret from Google Cloud → Credentials.",
            )
        persist_drive_oauth_env(client_id, secret)
        os.environ["GOOGLE_DRIVE_CLIENT_ID"] = client_id
        os.environ["GOOGLE_DRIVE_CLIENT_SECRET"] = secret
        gdrive.set_runtime_oauth(client_id, secret)
        await save_drive_settings({
            "oauth_client_id": client_id,
            "oauth_client_secret_enc": _encrypt_secret(secret),
            "oauth_saved_at": now_iso(),
            "oauth_saved_by": admin.user_id,
        })
        logger.info("Saved Google Drive OAuth keys user=%s", admin.user_id)
        return await drive_connection_status()
    except HTTPException:
        raise
    except Exception:
        logger.exception("Saving Google Drive credentials failed")
        raise HTTPException(status_code=500, detail="Could not save the Google Drive keys. Please try again.")


@api_router.post("/google-drive/bootstrap")
async def bootstrap_google_drive(admin: User = Depends(require_admin)):
    """Create Revival Pro / Clients after a successful connection."""
    try:
        service, doc = await require_drive_service()
        tree = await asyncio.to_thread(gdrive.ensure_company_tree, service)
        parent = tree.get("clients") or {}
        company = tree.get("company") or {}
        await save_drive_settings({
            "parent_folder_id": parent.get("id") or doc.get("parent_folder_id") or "",
            "root_folder_id": company.get("id") or doc.get("root_folder_id") or "",
        })
        logger.info("Bootstrapped Google Drive folder tree user=%s", admin.user_id)
        return await drive_connection_status()
    except HTTPException:
        raise
    except Exception:
        logger.exception("Google Drive bootstrap failed")
        raise HTTPException(status_code=500, detail="Could not create the Revival Pro Drive folders. Please try again.")


@api_router.get("/google-drive/connect")
async def google_drive_connect(admin: User = Depends(require_admin)):
    try:
        await apply_stored_drive_oauth()
        if not gdrive.oauth_configured():
            raise HTTPException(
                status_code=400,
                detail="Save the Google Client ID and Client Secret in Company Profile first.",
            )
        state = secrets.token_urlsafe(32)
        cutoff = (datetime.now(timezone.utc) - timedelta(minutes=20)).isoformat()
        try:
            await db.oauth_states.delete_many({"kind": "google_drive", "created_at": {"$lt": cutoff}})
        except Exception:
            logger.exception("Could not prune old Google Drive OAuth states")
        await db.oauth_states.insert_one({
            "kind": "google_drive",
            "state": state,
            "user_id": admin.user_id,
            "created_at": now_iso(),
        })
        logger.info("Google Drive connect started user=%s", admin.user_id)
        return {"auth_url": gdrive.build_auth_url(state)}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Google Drive connect URL failed")
        raise HTTPException(status_code=500, detail="Could not start Google Drive sign-in. Please try again.")


@api_router.get("/google-drive/callback")
async def google_drive_callback(code: str = "", state: str = "", error: str = ""):
    fail = f"{gdrive.frontend_url()}/settings?drive=error"
    try:
        await apply_stored_drive_oauth()
        if error:
            why = "denied" if "access_denied" in str(error) else "google"
            logger.warning("Google Drive OAuth returned error=%s", error)
            await save_drive_settings({"last_error": "Google cancelled the sign-in. Choose revivalhomeremodelingllc@gmail.com and tap Allow."})
            return RedirectResponse(f"{fail}&why={why}", status_code=302)
        pending = await db.oauth_states.find_one({"kind": "google_drive", "state": state})
        if not pending or not code:
            logger.warning("Google Drive OAuth callback missing state or code")
            await save_drive_settings({"last_error": "That Google sign-in expired. Click Connect Google Drive again."})
            return RedirectResponse(f"{fail}&why=state", status_code=302)
        await db.oauth_states.delete_one({"kind": "google_drive", "state": state})
        created = parse_iso_dt(pending.get("created_at") or "")
        if created and datetime.now(timezone.utc) - created > timedelta(minutes=20):
            logger.warning("Google Drive OAuth state expired")
            await save_drive_settings({"last_error": "That Google sign-in expired. Click Connect Google Drive again."})
            return RedirectResponse(f"{fail}&why=expired", status_code=302)
        tokens = await asyncio.to_thread(gdrive.exchange_code, code)
        if not tokens.get("refresh_token"):
            await save_drive_settings({"last_error": "Google did not send a lasting sign-in. Remove Revival Pro from Third-party access, then connect again."})
            return RedirectResponse(f"{fail}&why=token", status_code=302)
        await save_drive_settings({
            "connected": True,
            "email": tokens.get("email") or "",
            "access_token_enc": _encrypt_secret(tokens.get("access_token") or ""),
            "refresh_token_enc": _encrypt_secret(tokens.get("refresh_token") or ""),
            "token_expiry": tokens.get("token_expiry") or "",
            "connected_at": now_iso(),
            "connected_by": pending.get("user_id") or "",
            "last_error": "",
        })
        try:
            service, doc = await require_drive_service()
            info = await asyncio.to_thread(gdrive.verify_account, service)
            tree = await asyncio.to_thread(gdrive.ensure_company_tree, service)
            parent = tree.get("clients") or {}
            company = tree.get("company") or {}
            await save_drive_settings({
                "email": info.get("email") or tokens.get("email") or "",
                "parent_folder_id": parent.get("id") or "",
                "root_folder_id": company.get("id") or "",
                "last_error": "",
            })
        except Exception:
            logger.exception("Connected Google Drive but could not create the parent folder yet")
            await save_drive_settings({"last_error": "Signed in, but the Revival Pro folder tree could not be created yet. Click Verify Drive."})
        logger.info("Google Drive connected email=%s", tokens.get("email") or "-")
        return RedirectResponse(f"{gdrive.frontend_url()}/settings?drive=connected", status_code=302)
    except Exception:
        logger.exception("Google Drive OAuth callback failed")
        try:
            await save_drive_settings({"last_error": "Google Drive sign-in failed. Check the redirect URI and try Connect again."})
        except Exception:
            logger.exception("Could not store Google Drive callback error")
        return RedirectResponse(f"{fail}&why=unknown", status_code=302)


@api_router.post("/google-drive/verify")
async def google_drive_verify(admin: User = Depends(require_admin)):
    try:
        service, _doc = await require_drive_service()
        info = await asyncio.to_thread(gdrive.verify_account, service)
        tree = await asyncio.to_thread(gdrive.ensure_company_tree, service)
        parent = tree.get("clients") or {}
        company = tree.get("company") or {}
        await save_drive_settings({
            "email": info.get("email") or "",
            "parent_folder_id": parent.get("id") or "",
            "root_folder_id": company.get("id") or "",
            "last_error": "",
            "verified_at": now_iso(),
        })
        status = await drive_connection_status()
        logger.info("Verified Google Drive email=%s connected=%s user=%s", status.get("email") or "-", status.get("connected"), admin.user_id)
        return status
    except HTTPException:
        raise
    except Exception:
        logger.exception("Google Drive verify failed")
        raise HTTPException(status_code=500, detail="Could not verify Google Drive. Connect again in Company Profile.")


@api_router.post("/google-drive/disconnect")
async def google_drive_disconnect(admin: User = Depends(require_admin)):
    try:
        doc = await load_drive_settings()
        tokens = tokens_from_settings(doc)
        revoke = tokens.get("refresh_token") or tokens.get("access_token")
        if revoke:
            try:
                await asyncio.to_thread(
                    lambda: requests.post("https://oauth2.googleapis.com/revoke", params={"token": revoke}, timeout=15)
                )
            except Exception:
                logger.exception("Could not revoke Google Drive token at Google")
        await save_drive_settings({
            "connected": False,
            "email": "",
            "access_token_enc": "",
            "refresh_token_enc": "",
            "token_expiry": "",
            "parent_folder_id": "",
            "root_folder_id": "",
            "connected_at": "",
            "connected_by": "",
            "verified_at": "",
            "last_error": "",
        })
        logger.info("Google Drive disconnected user=%s", admin.user_id)
        return await drive_connection_status()
    except Exception:
        logger.exception("Google Drive disconnect failed")
        raise HTTPException(status_code=500, detail="Could not disconnect Google Drive. Please try again.")


@api_router.get("/clients/{client_id}/drive")
async def get_client_drive(client_id: str, user: User = Depends(get_current_user)):
    try:
        client_doc = await db.clients.find_one({"id": client_id}, {"_id": 0})
        if not client_doc:
            raise HTTPException(status_code=404, detail="Client not found")
        return await client_drive_payload(client_doc)
    except HTTPException:
        raise
    except Exception:
        logger.exception("Get client Drive failed client_id=%s", client_id)
        raise HTTPException(status_code=500, detail="Could not check the Google Drive folder. Please try again.")


@api_router.post("/clients/{client_id}/drive/folder")
async def create_client_drive_folder(client_id: str, user: User = Depends(get_current_user)):
    try:
        client_doc = await db.clients.find_one({"id": client_id}, {"_id": 0})
        if not client_doc:
            raise HTTPException(status_code=404, detail="Client not found")
        updated = await ensure_client_drive_folder(client_doc)
        payload = await client_drive_payload(updated)
        payload["created"] = not bool(client_doc.get("google_drive_folder_id"))
        logger.info("Client Drive folder ready client_id=%s user=%s", client_id, user.user_id)
        return payload
    except HTTPException:
        raise
    except Exception:
        logger.exception("Create client Drive folder failed client_id=%s", client_id)
        raise HTTPException(status_code=500, detail="Could not create the Google Drive folder. Please try again.")


@api_router.post("/clients/{client_id}/drive/files")
async def upload_client_drive_file(
    client_id: str,
    kind: str = Form(...),
    job_id: str = Form(""),
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
):
    try:
        client_doc = await db.clients.find_one({"id": client_id}, {"_id": 0})
        if not client_doc:
            raise HTTPException(status_code=404, detail="Client not found")
        record = await handle_client_drive_upload(client_doc, kind, file, job_id=job_id or "")
        fresh = await db.clients.find_one({"id": client_id}, {"_id": 0})
        payload = await client_drive_payload(fresh)
        payload["uploaded"] = record
        logger.info("Uploaded Drive file kind=%s client_id=%s user=%s", kind, client_id, user.user_id)
        return payload
    except HTTPException:
        raise
    except Exception:
        logger.exception("Client Drive upload failed client_id=%s", client_id)
        raise HTTPException(status_code=500, detail="Could not upload the file to Google Drive. Please try again.")


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


async def _ingest_thumbtack_webhook(payload: dict, headers: dict, actor: str = "thumbtack-webhook"):
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

    # Intentionally do not place a Vapi call here.
    converted = await _convert_lead(lead_doc["id"], actor=actor)
    await _log_thumbtack_webhook(
        payload=payload, headers=headers, status="created",
        thumbtack_lead_id=tt_id, lead_id=lead_doc["id"],
        detail="Lead created and converted to client + job. Vapi not triggered.",
    )
    _announce_thumbtack_result(
        "created", parsed, headers, actor,
        extra=(
            f"lead={lead_doc['id']} client={converted['client']['id']} "
            f"job={converted['job']['id']} (no Vapi call)"
        ),
    )
    return {"status": "created", "thumbtack_lead_id": tt_id, **converted}


@api_router.post("/webhooks/thumbtack")
@api_router.post("/webhooks/thumbtack/", include_in_schema=False)
async def thumbtack_webhook(request: Request):
    """Public Thumbtack endpoint. Secured by optional THUMBTACK_WEBHOOK_SECRET. Does not call Vapi.

    Paste this URL into Thumbtack after starting ngrok (`ngrok http 8001`):
        https://YOUR-NGROK-URL.ngrok-free.app/api/webhooks/thumbtack
    """
    try:
        headers = dict(request.headers)
        host = headers.get("host") or headers.get("Host") or "-"
        content_type = headers.get("content-type") or headers.get("Content-Type") or "-"
        secret_configured = bool(configured_webhook_secret())
        secret_ok = webhook_authorized(headers)
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
        return await _ingest_thumbtack_webhook(payload, headers)
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


def pricing_rates_from_company(company: dict | None) -> dict:
    company = company or {}
    return {
        "profit_margin_pct": company.get("default_profit_margin") if company.get("default_profit_margin") is not None else DEFAULT_PROFIT_MARGIN_PCT,
        "cc_fee_pct": company.get("credit_card_fee_pct") if company.get("credit_card_fee_pct") is not None else DEFAULT_CC_FEE_PCT,
        "sales_tax_pct": company.get("sales_tax_pct") if company.get("sales_tax_pct") is not None else DEFAULT_SALES_TAX_PCT,
        "optional_tax_pct": company.get("optional_tax_pct") if company.get("optional_tax_pct") is not None else DEFAULT_OPTIONAL_TAX_PCT,
    }


async def monthly_overhead_snapshot(year=None, month=None) -> dict:
    y, m = parse_year_month(year, month)
    days = month_day_count(y, m)
    expenses = await db.overhead_expenses.find({}, {"_id": 0}).to_list(5000)
    month_items = []
    expense_actual = 0.0
    ytd_expense_actual = 0.0
    for exp in expenses:
        ey, em = year_month_of(exp.get("date") or exp.get("created_at"))
        amount = float(exp.get("amount") or 0)
        if ey == y:
            ytd_expense_actual += amount
        if ey == y and em == m:
            expense_actual += amount
            month_items.append(exp)

    month_values = await db.overhead_month_values.find({"year": y, "month": m}, {"_id": 0}).to_list(5000)
    projected_total = round(sum(float(v.get("projected") or 0) for v in month_values), 2)
    ledger_actual = round(sum(float(v.get("actual") or 0) for v in month_values), 2)

    ytd_values = await db.overhead_month_values.find({"year": y}, {"_id": 0}).to_list(8000)
    ytd_projected = round(sum(float(v.get("projected") or 0) for v in ytd_values), 2)
    ytd_ledger_actual = round(sum(float(v.get("actual") or 0) for v in ytd_values), 2)

    actual_total = round(ledger_actual + expense_actual, 2)
    ytd_actual = round(ytd_ledger_actual + ytd_expense_actual, 2)
    total = actual_total
    daily = round(total / days, 2) if days else 0.0
    return {
        "year": y,
        "month": m,
        "month_name": month_label(y, m).split(" ")[0],
        "month_label": month_label(y, m),
        "days_in_month": days,
        "total": total,
        "actual_total": actual_total,
        "projected_total": projected_total,
        "difference": round(actual_total - projected_total, 2),
        "daily_rate": daily,
        "ytd_projected": ytd_projected,
        "ytd_actual": ytd_actual,
        "ytd_difference": round(ytd_actual - ytd_projected, 2),
        "expense_count": len(month_items),
        "expenses": month_items,
    }


def pricing_from_inputs(company: dict, overhead: dict, materials=0, labor=0, subcontractors=0, other=0, estimated_days=0, profit_margin=None, apply_optional_tax=False) -> dict:
    rates = pricing_rates_from_company(company)
    margin = rates["profit_margin_pct"] if profit_margin is None else profit_margin
    return compute_pricing_breakdown(
        materials=materials,
        labor=labor,
        subcontractors=subcontractors,
        other=other,
        monthly_overhead=(overhead or {}).get("total") or 0,
        days_in_month_count=(overhead or {}).get("days_in_month"),
        estimated_days=estimated_days,
        profit_margin_pct=margin,
        cc_fee_pct=rates["cc_fee_pct"],
        sales_tax_pct=rates["sales_tax_pct"],
        optional_tax_pct=rates["optional_tax_pct"],
        apply_optional_tax=apply_optional_tax,
        year=(overhead or {}).get("year"),
        month=(overhead or {}).get("month"),
    )


async def estimate_pricing_for(payload) -> dict:
    company = await get_company()
    overhead = await monthly_overhead_snapshot()
    data = payload if isinstance(payload, dict) else payload.model_dump()
    return pricing_from_inputs(
        company,
        overhead,
        materials=data.get("materials_cost") or 0,
        labor=data.get("labor_cost") or 0,
        subcontractors=data.get("subcontractors_cost") or 0,
        other=data.get("other_cost") or 0,
        estimated_days=data.get("estimated_days") or 0,
        profit_margin=data.get("profit_margin"),
        apply_optional_tax=bool(data.get("apply_optional_tax")),
    )


def apply_smart_estimate_totals(items, subtotal, tax_amount, total, pricing: dict):
    if not uses_smart_pricing(pricing):
        return subtotal, tax_amount, total, pricing
    return subtotal, round(float(pricing.get("sales_tax") or 0), 2), round(float(pricing.get("final_price") or 0), 2), pricing


@api_router.get("/estimates", response_model=List[Estimate])
async def list_estimates(user: User = Depends(get_current_user)):
    await assert_user_feature(user, "estimates")
    docs = await db.estimates.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return [Estimate(**d) for d in docs]


@api_router.post("/estimates", response_model=Estimate)
async def create_estimate(payload: EstimateCreate, background: BackgroundTasks, user: User = Depends(get_current_user)):
    items, subtotal, tax_amount, total = compute_totals(payload.line_items, payload.tax_rate)
    pricing = await estimate_pricing_for(payload)
    subtotal, tax_amount, total, pricing = apply_smart_estimate_totals(items, subtotal, tax_amount, total, pricing)
    number = await next_number("EST")
    cid, cname = await resolve_client_ref(payload.client_id, payload.client_name)
    margin = payload.profit_margin
    obj = Estimate(
        estimate_number=number,
        client_id=cid,
        client_name=cname,
        category=payload.category,
        status=payload.status,
        line_items=[LineItem(**i) for i in items],
        subtotal=subtotal,
        tax_rate=payload.tax_rate if not uses_smart_pricing(pricing) else float(pricing.get("sales_tax_pct") or 0),
        tax_amount=tax_amount,
        total=total,
        notes=payload.notes,
        terms=(payload.terms or "").strip() or (await get_company()).get("estimate_terms") or "",
        materials_cost=float(payload.materials_cost or 0),
        labor_cost=float(payload.labor_cost or 0),
        subcontractors_cost=float(payload.subcontractors_cost or 0),
        other_cost=float(payload.other_cost or 0),
        estimated_days=float(payload.estimated_days or 0),
        profit_margin=margin,
        apply_optional_tax=bool(payload.apply_optional_tax),
        pricing=pricing,
    )
    dumped = obj.model_dump()
    await db.estimates.insert_one(dumped)
    background.add_task(push_estimate_to_drive, dumped)
    return obj


@api_router.put("/estimates/{estimate_id}", response_model=Estimate)
async def update_estimate(estimate_id: str, payload: EstimateCreate, background: BackgroundTasks, user: User = Depends(get_current_user)):
    existing = await db.estimates.find_one({"id": estimate_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Estimate not found")
    items, subtotal, tax_amount, total = compute_totals(payload.line_items, payload.tax_rate)
    pricing = await estimate_pricing_for(payload)
    subtotal, tax_amount, total, pricing = apply_smart_estimate_totals(items, subtotal, tax_amount, total, pricing)
    cid, cname = await resolve_client_ref(payload.client_id, payload.client_name)
    updated = {
        **existing,
        "client_id": cid,
        "client_name": cname,
        "category": payload.category,
        "status": payload.status,
        "line_items": items,
        "subtotal": subtotal,
        "tax_rate": payload.tax_rate if not uses_smart_pricing(pricing) else float(pricing.get("sales_tax_pct") or 0),
        "tax_amount": tax_amount,
        "total": total,
        "notes": payload.notes,
        "terms": payload.terms if payload.terms is not None else existing.get("terms", ""),
        "materials_cost": float(payload.materials_cost or 0),
        "labor_cost": float(payload.labor_cost or 0),
        "subcontractors_cost": float(payload.subcontractors_cost or 0),
        "other_cost": float(payload.other_cost or 0),
        "estimated_days": float(payload.estimated_days or 0),
        "profit_margin": payload.profit_margin,
        "apply_optional_tax": bool(payload.apply_optional_tax),
        "pricing": pricing,
    }
    await db.estimates.update_one({"id": estimate_id}, {"$set": updated})
    background.add_task(push_estimate_to_drive, updated)
    return Estimate(**updated)


@api_router.delete("/estimates/{estimate_id}")
async def delete_estimate(estimate_id: str, user: User = Depends(get_current_user)):
    await db.estimates.delete_one({"id": estimate_id})
    return {"success": True}


@api_router.post("/estimates/{estimate_id}/convert", response_model=Invoice)
async def convert_estimate(estimate_id: str, background: BackgroundTasks, user: User = Depends(get_current_user)):
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
            terms=(await get_company()).get("invoice_terms") or "",
        )
        dumped = obj.model_dump()
        await db.invoices.insert_one(dumped)
        logger.info(f"Converted estimate {estimate_id} to invoice {obj.invoice_number} user={user.user_id}")
        background.add_task(push_invoice_to_drive, dumped)
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
    company = await get_company()
    try:
        est["pricing"] = await estimate_pricing_for(est)
    except Exception:
        logger.exception("Could not refresh estimate pricing for PDF estimate_id=%s", estimate_id)
    pdf_bytes = build_estimate_pdf(est, client, company)
    filename = f"{est.get('estimate_number', 'estimate')}.pdf"
    await push_estimate_to_drive(est, pdf_bytes)
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

        company = await get_company()
    try:
        est["pricing"] = await estimate_pricing_for(est)
    except Exception:
        logger.exception("Could not refresh estimate pricing for email estimate_id=%s", estimate_id)
    pdf_bytes = build_estimate_pdf(est, client, company)
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
    await push_estimate_to_drive(est, pdf_bytes)
    return {"status": "success", "email_id": email_id, "sent_to": to}


# ---------------- Jobs ----------------
@api_router.get("/jobs", response_model=List[Job])
async def list_jobs(user: User = Depends(get_current_user)):
    await assert_user_feature(user, "jobs")
    from field_ops import job_visible_to
    docs = await db.jobs.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return [Job(**d) for d in docs if job_visible_to(user.user_id, user.role, d)]


@api_router.post("/jobs", response_model=Job)
async def create_job(payload: JobCreate, background: BackgroundTasks, user: User = Depends(get_current_user)):
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
    dumped = obj.model_dump()
    await db.jobs.insert_one(dumped)
    try:
        client_doc = await db.clients.find_one({"id": dumped.get("client_id")}, {"_id": 0}) if dumped.get("client_id") else None
        await _ensure_job_sheet(dumped, client=client_doc, lead=None)
    except Exception:
        logger.exception("Could not create job sheet for job %s", dumped.get("id"))
    background.add_task(push_job_docs_to_drive, dumped)
    return obj


@api_router.put("/jobs/{job_id}", response_model=Job)
async def update_job(job_id: str, payload: JobCreate, background: BackgroundTasks, user: User = Depends(get_current_user)):
    existing = await db.jobs.find_one({"id": job_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Job not found")
    cid, cname = await resolve_client_ref(payload.client_id or existing.get("client_id", ""), payload.client_name or existing.get("client_name", ""))
    data = payload.model_dump()
    data["client_id"] = cid
    data["client_name"] = cname
    updated = {**existing, **data}
    await db.jobs.update_one({"id": job_id}, {"$set": updated})
    background.add_task(push_job_docs_to_drive, updated)
    return Job(**updated)


@api_router.delete("/jobs/{job_id}")
async def delete_job(job_id: str, user: User = Depends(get_current_user)):
    await db.jobs.delete_one({"id": job_id})
    await db.job_sheets.delete_one({"id": job_id})
    logger.info("Deleted job %s and its job sheet", job_id)
    return {"success": True}


def _floor_plan_summary(plan: dict) -> dict:
    take = plan.get("takeoffs") or {}
    totals = take.get("totals") or {}
    doc = plan.get("document") or {}
    return {
        "id": plan.get("id"),
        "name": plan.get("name") or "Floor plan",
        "client_id": plan.get("client_id") or "",
        "client_name": plan.get("client_name") or "",
        "job_id": plan.get("job_id") or "",
        "address": plan.get("address") or "",
        "project_type": plan.get("project_type") or "Kitchen",
        "version_kind": plan.get("version_kind") or "existing",
        "parent_id": plan.get("parent_id") or "",
        "level_count": len((doc.get("levels") or [])),
        "floor_sf": totals.get("floor_sf") or 0,
        "google_drive_url": plan.get("google_drive_url") or "",
        "showcase": bool(plan.get("showcase")),
        "created_at": plan.get("created_at"),
        "updated_at": plan.get("updated_at"),
    }


async def _persist_floor_plan(plan: dict, *, push_drive: bool = True) -> dict:
    document = plan.get("document") or floor_empty_document()
    plan["document"] = document
    plan["takeoffs"] = floor_compute_takeoffs(document)
    plan["updated_at"] = now_iso()
    await db.floor_plans.update_one({"id": plan["id"]}, {"$set": plan}, upsert=True)
    if push_drive and plan.get("client_id"):
        try:
            client = await db.clients.find_one({"id": plan["client_id"]}, {"_id": 0})
            if client:
                filename = gdrive.sanitize_filename(f"{plan.get('name') or 'Floor plan'} {plan.get('version_kind') or 'existing'}.json")
                payload = json.dumps({
                    "id": plan["id"],
                    "name": plan.get("name"),
                    "client_name": plan.get("client_name"),
                    "address": plan.get("address"),
                    "project_type": plan.get("project_type"),
                    "version_kind": plan.get("version_kind"),
                    "document": document,
                    "takeoffs": plan.get("takeoffs"),
                }).encode("utf-8")
                saved = await maybe_save_drive_file(
                    client,
                    "floor_plan",
                    plan["id"],
                    filename,
                    payload,
                    mime_type="application/json",
                    job_id=plan.get("job_id") or "",
                    strict=False,
                )
                if saved:
                    plan["google_drive_file_id"] = saved.get("google_drive_file_id") or ""
                    plan["google_drive_url"] = saved.get("web_view_link") or ""
                    await db.floor_plans.update_one({"id": plan["id"]}, {"$set": {
                        "google_drive_file_id": plan["google_drive_file_id"],
                        "google_drive_url": plan["google_drive_url"],
                    }})
        except Exception:
            logger.exception("Floor plan Drive save failed plan_id=%s", plan.get("id"))
    return plan


@api_router.get("/floor-plans/library")
async def floor_plan_library(user: User = Depends(get_current_user)):
    return floor_public_catalog()


@api_router.get("/floor-plans")
async def list_floor_plans(job_id: str = "", client_id: str = "", user: User = Depends(get_current_user)):
    try:
        await assert_user_feature(user, "floor_plans")
        query = {}
        if job_id:
            query["job_id"] = job_id
        if client_id:
            query["client_id"] = client_id
        docs = await db.floor_plans.find(query, {"_id": 0}).sort("updated_at", -1).to_list(500)
        return [_floor_plan_summary(d) for d in docs]
    except Exception:
        logger.exception("List floor plans failed")
        raise HTTPException(status_code=500, detail="Could not load floor plans. Please try again.")


@api_router.post("/floor-plans")
async def create_floor_plan(payload: FloorPlanCreate, user: User = Depends(get_current_user)):
    try:
        obj = FloorPlan(
            name=(payload.name or "Floor plan").strip() or "Floor plan",
            client_id=payload.client_id or "",
            client_name=payload.client_name or "",
            job_id=payload.job_id or "",
            address=payload.address or "",
            project_type=payload.project_type or "Kitchen",
            version_kind=payload.version_kind or "existing",
            parent_id=payload.parent_id or "",
            document=payload.document or floor_empty_document(),
        ).model_dump()
        saved = await _persist_floor_plan(obj)
        logger.info("Created floor plan %s user=%s", saved.get("id"), user.user_id)
        return {**saved, "drive": {"web_view_link": saved.get("google_drive_url") or ""}}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Create floor plan failed")
        raise HTTPException(status_code=500, detail="Could not create the floor plan. Please try again.")


@api_router.get("/floor-plans/{plan_id}")
async def get_floor_plan(plan_id: str, user: User = Depends(get_current_user)):
    try:
        found = await db.floor_plans.find_one({"id": plan_id}, {"_id": 0})
        if not found:
            raise HTTPException(status_code=404, detail="Floor plan not found")
        return found
    except HTTPException:
        raise
    except Exception:
        logger.exception("Get floor plan failed plan_id=%s", plan_id)
        raise HTTPException(status_code=500, detail="Could not load the floor plan. Please try again.")


@api_router.put("/floor-plans/{plan_id}")
async def update_floor_plan(plan_id: str, payload: FloorPlanUpdate, user: User = Depends(get_current_user)):
    try:
        found = await db.floor_plans.find_one({"id": plan_id}, {"_id": 0})
        if not found:
            raise HTTPException(status_code=404, detail="Floor plan not found")
        data = payload.model_dump(exclude_unset=True)
        updated = {**found, **data}
        saved = await _persist_floor_plan(updated)
        logger.info("Updated floor plan %s user=%s", plan_id, user.user_id)
        return {**saved, "drive": {"web_view_link": saved.get("google_drive_url") or ""}}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Update floor plan failed plan_id=%s", plan_id)
        raise HTTPException(status_code=500, detail="Could not save the floor plan. Please try again.")


@api_router.delete("/floor-plans/{plan_id}")
async def delete_floor_plan(plan_id: str, user: User = Depends(get_current_user)):
    try:
        found = await db.floor_plans.find_one({"id": plan_id}, {"_id": 0})
        if not found:
            raise HTTPException(status_code=404, detail="Floor plan not found")
        await db.floor_plans.delete_one({"id": plan_id})
        logger.info("Deleted floor plan %s user=%s", plan_id, user.user_id)
        return {"success": True}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Delete floor plan failed plan_id=%s", plan_id)
        raise HTTPException(status_code=500, detail="Could not delete the floor plan. Please try again.")


@api_router.post("/floor-plans/{plan_id}/duplicate")
async def duplicate_floor_plan(plan_id: str, payload: FloorPlanUpdate, user: User = Depends(get_current_user)):
    try:
        found = await db.floor_plans.find_one({"id": plan_id}, {"_id": 0})
        if not found:
            raise HTTPException(status_code=404, detail="Floor plan not found")
        kind = payload.version_kind or ("proposed" if found.get("version_kind") != "proposed" else "existing")
        copy = {**found, "id": new_id(), "parent_id": found["id"], "version_kind": kind, "version": int(found.get("version") or 1) + 1, "name": f"{found.get('name') or 'Floor plan'} ({kind})", "created_at": now_iso(), "google_drive_file_id": "", "google_drive_url": ""}
        saved = await _persist_floor_plan(copy)
        logger.info("Duplicated floor plan %s -> %s user=%s", plan_id, saved["id"], user.user_id)
        return saved
    except HTTPException:
        raise
    except Exception:
        logger.exception("Duplicate floor plan failed plan_id=%s", plan_id)
        raise HTTPException(status_code=500, detail="Could not copy this floor plan. Please try again.")


@api_router.post("/floor-plans/{plan_id}/import-roomplan")
async def import_floor_plan_roomplan(plan_id: str, payload: dict, user: User = Depends(get_current_user)):
    try:
        found = await db.floor_plans.find_one({"id": plan_id}, {"_id": 0})
        if not found:
            raise HTTPException(status_code=404, detail="Floor plan not found")
        document = found.get("document") or floor_empty_document()
        levels = document.get("levels") or []
        current = next((l for l in levels if l.get("id") == document.get("active_level_id")), levels[0] if levels else None)
        scanned = floor_import_roomplan(payload, current)
        if current:
            scanned["id"] = current.get("id")
            scanned["name"] = current.get("name") or scanned.get("name")
            document["levels"] = [scanned if l.get("id") == current.get("id") else l for l in levels]
        else:
            document["levels"] = [scanned]
            document["active_level_id"] = scanned["id"]
        found["document"] = document
        saved = await _persist_floor_plan(found)
        logger.info("Imported RoomPlan into floor plan %s user=%s", plan_id, user.user_id)
        return saved
    except ValueError as ex:
        raise HTTPException(status_code=400, detail=str(ex))
    except HTTPException:
        raise
    except Exception:
        logger.exception("Import RoomPlan failed plan_id=%s", plan_id)
        raise HTTPException(status_code=500, detail="Could not import that LiDAR scan. Please try again.")


@api_router.post("/floor-plans/{plan_id}/attach")
async def attach_floor_plan(plan_id: str, payload: FloorPlanAttach, user: User = Depends(get_current_user)):
    try:
        found = await db.floor_plans.find_one({"id": plan_id}, {"_id": 0})
        if not found:
            raise HTTPException(status_code=404, detail="Floor plan not found")
        if payload.estimate_id:
            est = await db.estimates.find_one({"id": payload.estimate_id}, {"_id": 0})
            if not est:
                raise HTTPException(status_code=404, detail="Estimate not found")
            await db.estimates.update_one({"id": payload.estimate_id}, {"$set": {"floor_plan_id": plan_id}})
        if payload.contract_id:
            con = await db.contracts.find_one({"id": payload.contract_id}, {"_id": 0})
            if not con:
                raise HTTPException(status_code=404, detail="Contract not found")
            await db.contracts.update_one({"id": payload.contract_id}, {"$set": {"floor_plan_id": plan_id}})
        if not payload.estimate_id and not payload.contract_id:
            raise HTTPException(status_code=400, detail="Choose an estimate or contract to attach.")
        logger.info("Attached floor plan %s estimate=%s contract=%s user=%s", plan_id, payload.estimate_id, payload.contract_id, user.user_id)
        return {"success": True}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Attach floor plan failed plan_id=%s", plan_id)
        raise HTTPException(status_code=500, detail="Could not attach the floor plan. Please try again.")


@api_router.post("/floor-plans/{plan_id}/send-to-estimate")
async def send_floor_plan_to_estimate(plan_id: str, payload: FloorPlanAttach, background: BackgroundTasks, user: User = Depends(get_current_user)):
    try:
        found = await db.floor_plans.find_one({"id": plan_id}, {"_id": 0})
        if not found:
            raise HTTPException(status_code=404, detail="Floor plan not found")
        scope = floor_build_scope(found.get("document") or {})
        items = [{
            "description": row.get("description") or "",
            "quantity": float(row.get("quantity") or 1),
            "unit_price": float(row.get("unit_price") or 0),
            "amount": round(float(row.get("quantity") or 1) * float(row.get("unit_price") or 0), 2),
        } for row in scope.get("line_items") or []]
        if not items:
            raise HTTPException(status_code=400, detail="Add rooms or objects before sending quantities to an estimate.")
        notes = f"Preliminary quantities from Floor Plan Studio — {found.get('name') or 'floor plan'}. Confirm in the field before ordering."
        if payload.estimate_id:
            est = await db.estimates.find_one({"id": payload.estimate_id}, {"_id": 0})
            if not est:
                raise HTTPException(status_code=404, detail="Estimate not found")
            existing_items = [i for i in (est.get("line_items") or []) if not str(i.get("description") or "").startswith("[Plan]")]
            merged = existing_items + items
            computed, subtotal, tax_amount, total = compute_totals(merged, est.get("tax_rate") or 0)
            await db.estimates.update_one({"id": est["id"]}, {"$set": {
                "line_items": computed,
                "subtotal": subtotal,
                "tax_amount": tax_amount,
                "total": total,
                "floor_plan_id": plan_id,
                "notes": ((est.get("notes") or "") + "\n" + notes).strip(),
            }})
            priced_total = round(sum(float(i.get("amount") or 0) for i in computed), 2)
            logger.info("Merged floor-plan quantities into estimate %s plan=%s items=%s total=%s user=%s", est.get("estimate_number"), plan_id, len(items), priced_total, user.user_id)
            return {"estimate_id": est["id"], "estimate_number": est.get("estimate_number") or "", "item_count": len(items), "priced_total": priced_total}
        number = await next_number("EST")
        cid, cname = await resolve_client_ref(found.get("client_id") or "", found.get("client_name") or "")
        computed, subtotal, tax_amount, total = compute_totals(items, 0)
        obj = Estimate(
            estimate_number=number,
            client_id=cid,
            client_name=cname,
            category=found.get("project_type") or "Kitchen",
            status="Draft",
            line_items=[LineItem(**i) for i in computed],
            subtotal=subtotal,
            tax_amount=tax_amount,
            total=total,
            notes=notes,
            floor_plan_id=plan_id,
        ).model_dump()
        await db.estimates.insert_one(obj)
        background.add_task(push_estimate_to_drive, obj)
        logger.info("Created estimate %s from floor plan %s items=%s total=%s user=%s", number, plan_id, len(items), total, user.user_id)
        return {"estimate_id": obj["id"], "estimate_number": number, "item_count": len(items), "priced_total": total}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Send floor plan to estimate failed plan_id=%s", plan_id)
        raise HTTPException(status_code=500, detail="Could not send those quantities to an estimate. Please try again.")


@api_router.post("/floor-plans/{plan_id}/report")
async def floor_plan_client_report(plan_id: str, payload: FloorPlanReportIn, user: User = Depends(get_current_user)):
    try:
        found = await db.floor_plans.find_one({"id": plan_id}, {"_id": 0})
        if not found:
            raise HTTPException(status_code=404, detail="Floor plan not found")
        client = None
        if found.get("client_id"):
            client = await db.clients.find_one({"id": found["client_id"]}, {"_id": 0})
        company = await get_company()
        pdf_bytes = build_client_report(found, client, company, payload.snapshots or {})
        if client:
            try:
                filename = gdrive.sanitize_filename(f"{found.get('client_name') or client.get('name') or 'Client'} Design Proposal.pdf")
                saved = await maybe_save_drive_file(
                    client,
                    "client_report",
                    plan_id,
                    filename,
                    pdf_bytes,
                    mime_type="application/pdf",
                    job_id=found.get("job_id") or "",
                    strict=False,
                )
                if saved:
                    await db.floor_plans.update_one({"id": plan_id}, {"$set": {
                        "report_drive_url": saved.get("web_view_link") or "",
                        "report_drive_file_id": saved.get("google_drive_file_id") or "",
                    }})
            except Exception:
                logger.exception("Client report Drive save failed plan_id=%s", plan_id)
        attach_note = f"Client design proposal attached from Floor Plan Studio — {found.get('name') or 'floor plan'}."
        if payload.estimate_id:
            est = await db.estimates.find_one({"id": payload.estimate_id}, {"_id": 0})
            if est:
                await db.estimates.update_one({"id": payload.estimate_id}, {"$set": {
                    "floor_plan_id": plan_id,
                    "notes": ((est.get("notes") or "") + "\n" + attach_note).strip(),
                }})
        if payload.contract_id:
            await db.contracts.update_one({"id": payload.contract_id}, {"$set": {"floor_plan_id": plan_id}})
        logger.info("Built client report for floor plan %s user=%s", plan_id, user.user_id)
        return StreamingResponse(BytesIO(pdf_bytes), media_type="application/pdf", headers={
            "Content-Disposition": f'attachment; filename="design-proposal.pdf"',
        })
    except HTTPException:
        raise
    except Exception:
        logger.exception("Client report failed plan_id=%s", plan_id)
        raise HTTPException(status_code=500, detail="Could not build the client report. Please try again.")


@api_router.get("/floor-plans/{plan_id}/permit-details")
async def floor_plan_permit_preview(plan_id: str, user: User = Depends(get_current_user)):
    try:
        found = await db.floor_plans.find_one({"id": plan_id}, {"_id": 0})
        if not found:
            raise HTTPException(status_code=404, detail="Floor plan not found")
        client = None
        if found.get("client_id"):
            client = await db.clients.find_one({"id": found["client_id"]}, {"_id": 0})
        company = await get_company()
        model = extract_permit_model(found, client, company)
        return public_preview(model)
    except HTTPException:
        raise
    except Exception:
        logger.exception("Permit detail preview failed plan_id=%s", plan_id)
        raise HTTPException(status_code=500, detail="Could not read permit data from this floor plan. Please try again.")


@api_router.post("/floor-plans/{plan_id}/permit-details")
async def floor_plan_permit_report(plan_id: str, payload: FloorPlanPermitIn, user: User = Depends(get_current_user)):
    try:
        found = await db.floor_plans.find_one({"id": plan_id}, {"_id": 0})
        if not found:
            raise HTTPException(status_code=404, detail="Floor plan not found")
        client = None
        if found.get("client_id"):
            client = await db.clients.find_one({"id": found["client_id"]}, {"_id": 0})
        company = await get_company()
        pdf_bytes = build_permit_report(found, client, company, payload.sheets or {})
        if client:
            try:
                filename = gdrive.sanitize_filename(
                    f"{found.get('client_name') or client.get('name') or 'Client'} Permit Details.pdf"
                )
                saved = await maybe_save_drive_file(
                    client,
                    "permit_details",
                    f"{plan_id}-permit",
                    filename,
                    pdf_bytes,
                    mime_type="application/pdf",
                    job_id=found.get("job_id") or "",
                    strict=False,
                )
                if saved:
                    await db.floor_plans.update_one({"id": plan_id}, {"$set": {
                        "permit_drive_url": saved.get("web_view_link") or "",
                        "permit_drive_file_id": saved.get("google_drive_file_id") or "",
                    }})
            except Exception:
                logger.exception("Permit details Drive save failed plan_id=%s", plan_id)
        logger.info("Built permit details for floor plan %s user=%s", plan_id, user.user_id)
        return StreamingResponse(BytesIO(pdf_bytes), media_type="application/pdf", headers={
            "Content-Disposition": 'attachment; filename="permit-details.pdf"',
        })
    except HTTPException:
        raise
    except Exception:
        logger.exception("Permit details failed plan_id=%s", plan_id)
        raise HTTPException(status_code=500, detail="Could not build the permit details. Please try again.")


@api_router.post("/jobs/{job_id}/expenses", response_model=Job)
async def add_expense(job_id: str, expense: Expense, background: BackgroundTasks, user: User = Depends(get_current_user)):
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
        exp["category"] = normalize_sheet_category(exp.get("category") or "Other")
        kind = (exp.get("kind") or "actual").strip().lower()
        if kind not in ("committed", "actual"):
            raise HTTPException(status_code=400, detail="Type must be Committed or Actual.")
        exp["kind"] = kind
        exp["created_by"] = user.user_id
        exp["created_by_name"] = user.name
        existing.setdefault("expenses", []).append(exp)
        await db.jobs.update_one({"id": job_id}, {"$set": {"expenses": existing["expenses"]}})
        logger.info(f"Logged expense job_id={job_id} amount={amount} user={user.user_id}")
        background.add_task(push_job_docs_to_drive, existing)
        return Job(**existing)
    except HTTPException:
        raise
    except Exception as ex:
        logger.error(f"Add expense failed job_id={job_id}: {ex}")
        raise HTTPException(status_code=500, detail="Could not log the expense. Please try again.")


@api_router.delete("/jobs/{job_id}/expenses/{expense_id}", response_model=Job)
async def delete_expense(job_id: str, expense_id: str, background: BackgroundTasks, user: User = Depends(get_current_user)):
    existing = await db.jobs.find_one({"id": job_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Job not found")
    existing["expenses"] = [e for e in existing.get("expenses", []) if e.get("id") != expense_id]
    await db.jobs.update_one({"id": job_id}, {"$set": {"expenses": existing["expenses"]}})
    background.add_task(push_job_docs_to_drive, existing)
    return Job(**existing)


@api_router.put("/jobs/{job_id}/expenses/{expense_id}", response_model=Job)
async def update_expense(job_id: str, expense_id: str, payload: ExpenseUpdate, background: BackgroundTasks, user: User = Depends(get_current_user)):
    try:
        existing = await db.jobs.find_one({"id": job_id}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="Job not found")
        expenses = list(existing.get("expenses") or [])
        found = None
        for exp in expenses:
            if exp.get("id") == expense_id:
                found = exp
                break
        if not found:
            raise HTTPException(status_code=404, detail="Expense not found")
        data = payload.model_dump(exclude_unset=True)
        if "category" in data and data["category"] is not None:
            found["category"] = normalize_sheet_category(data["category"])
        if "description" in data and data["description"] is not None:
            found["description"] = str(data["description"]).strip()
        if "kind" in data and data["kind"] is not None:
            kind = str(data["kind"]).strip().lower()
            if kind not in ("committed", "actual"):
                raise HTTPException(status_code=400, detail="Type must be Committed or Actual.")
            found["kind"] = kind
        if "date" in data and data["date"] is not None:
            found["date"] = str(data["date"]).strip()
        if "amount" in data and data["amount"] is not None:
            try:
                amount = float(data["amount"])
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail="Expense amount must be a valid number.")
            if amount <= 0:
                raise HTTPException(status_code=400, detail="Expense amount must be greater than zero.")
            found["amount"] = round(amount, 2)
        await db.jobs.update_one({"id": job_id}, {"$set": {"expenses": expenses}})
        existing["expenses"] = expenses
        logger.info("Updated expense %s on job %s user=%s", expense_id, job_id, user.user_id)
        background.add_task(push_job_docs_to_drive, existing)
        return Job(**existing)
    except HTTPException:
        raise
    except Exception as ex:
        logger.error(f"Update expense failed job_id={job_id} expense_id={expense_id}: {ex}")
        raise HTTPException(status_code=500, detail="Could not update the expense. Please try again.")


def _project_type_from_job(job: dict, lead: dict | None) -> str:
    if lead and (lead.get("project_type") or "").strip():
        return lead["project_type"].strip()
    name = (job.get("name") or "").strip()
    if " - " in name:
        return name.split(" - ", 1)[0].strip() or "Project"
    return name or "Project"


async def _ensure_job_sheet(job: dict, client: dict | None = None, lead: dict | None = None) -> dict:
    """Create a Job Financial Sheet for this job if one does not exist. Idempotent."""
    job_id = job.get("id") or ""
    if not job_id:
        raise ValueError("Job id is required to create a job sheet.")
    existing = await db.job_sheets.find_one({"job_id": job_id}, {"_id": 0})
    client = client or {}
    lead = lead or {}
    prefill = {
        "client_name": (client.get("name") or job.get("client_name") or "").strip(),
        "phone": (client.get("phone") or lead.get("phone") or "").strip(),
        "email": (client.get("email") or lead.get("email") or "").strip(),
        "address": (client.get("address") or lead.get("address") or "").strip(),
        "project_type": _project_type_from_job(job, lead),
        "source": (client.get("source") or lead.get("source") or "").strip(),
        "budget": sheet_money(job.get("budget")),
        "income": sheet_money(job.get("budget")),
    }
    if existing:
        fills = {}
        for key, value in prefill.items():
            if value and not (existing.get(key) not in (None, "", 0, 0.0) and existing.get(key)):
                if not existing.get(key):
                    fills[key] = value
        if fills:
            fills["updated_at"] = now_iso()
            await db.job_sheets.update_one({"job_id": job_id}, {"$set": fills})
            existing = {**existing, **fills}
            logger.info("Backfilled job sheet fields job_id=%s keys=%s", job_id, sorted(fills.keys()))
        return existing
    doc = {
        "id": new_id(),
        "job_id": job_id,
        "client_id": job.get("client_id") or client.get("id") or "",
        "client_name": prefill["client_name"],
        "phone": prefill["phone"],
        "email": prefill["email"],
        "address": prefill["address"],
        "project_type": prefill["project_type"],
        "source": prefill["source"],
        "budget": prefill["budget"],
        "income": prefill["income"],
        "notes": "",
        "category_budgets": empty_category_budgets(),
        "estimated_days": 0.0,
        "profit_margin": None,
        "apply_optional_tax": False,
        "google_drive_file_id": "",
        "google_drive_folder_id": "",
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.job_sheets.insert_one(doc)
    logger.info("Created job sheet %s for job %s client=%s", doc["id"], job_id, doc["client_name"] or "-")
    return {k: v for k, v in doc.items()}


def _serialize_job_sheet(sheet: dict, job: dict, drive: dict | None = None) -> dict:
    totals = compute_job_sheet_totals(sheet, job)
    public_sheet = {k: v for k, v in sheet.items() if k != "_id"}
    public_sheet["category_budgets"] = coerce_category_budgets(public_sheet.get("category_budgets"))
    drive = drive or {
        "configured": False,
        "connected": False,
        "has_folder": False,
        "folder_id": public_sheet.get("google_drive_folder_id") or "",
        "folder_name": "",
        "folder_url": "",
        "suggested_name": public_sheet.get("client_name") or job.get("client_name") or "",
    }
    return {
        "sheet": public_sheet,
        "job": Job(**job).model_dump(),
        "totals": totals,
        "categories": JOB_SHEET_CATEGORIES,
        "drive": drive,
        "export": export_foundation(public_sheet, public_sheet.get("client_name") or job.get("client_name") or "", drive=drive),
    }


async def _job_sheet_payload(sheet: dict, job: dict, client: dict | None = None) -> dict:
    try:
        drive = await client_drive_payload(client or {}, job_id=job.get("id") or "")
        if not client:
            drive["unlinked"] = True
    except Exception:
        logger.exception("Could not attach Drive status to job sheet job_id=%s", job.get("id"))
        drive = {
            "configured": gdrive.oauth_configured(),
            "connected": False,
            "has_folder": False,
            "folder_id": (sheet or {}).get("google_drive_folder_id") or "",
            "folder_name": "",
            "folder_url": "",
            "suggested_name": (sheet or {}).get("client_name") or job.get("client_name") or "",
            "files": [],
            "file_count": 0,
            "upload_kinds": drive_upload_kind_options(),
        }
    payload = _serialize_job_sheet(sheet, job, drive=drive)
    return await attach_job_pricing(payload, sheet, job)


async def attach_job_pricing(payload: dict, sheet: dict, job: dict) -> dict:
    try:
        company = await get_company()
        overhead = await monthly_overhead_snapshot()
        totals = payload.get("totals") or {}
        costs = job_sheet_direct_costs(sheet, totals)
        margin = sheet.get("profit_margin")
        pricing = pricing_from_inputs(
            company,
            overhead,
            materials=costs.get("materials") or 0,
            labor=costs.get("labor") or 0,
            subcontractors=costs.get("subcontractors") or 0,
            other=costs.get("other") or 0,
            estimated_days=sheet.get("estimated_days") or 0,
            profit_margin=margin,
            apply_optional_tax=bool(sheet.get("apply_optional_tax")),
        )
        payload["pricing"] = pricing
        payload["overhead_month"] = {
            "year": overhead.get("year"),
            "month": overhead.get("month"),
            "month_label": overhead.get("month_label"),
            "days_in_month": overhead.get("days_in_month"),
            "total": overhead.get("total"),
            "daily_rate": overhead.get("daily_rate"),
        }
    except Exception:
        logger.exception("Could not attach pricing to job sheet job_id=%s", (job or {}).get("id"))
        payload["pricing"] = None
        payload["overhead_month"] = None
    return payload


@api_router.get("/jobs/{job_id}/sheet")
async def get_job_sheet(job_id: str, user: User = Depends(get_current_user)):
    try:
        job = await db.jobs.find_one({"id": job_id}, {"_id": 0})
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        from field_ops import job_visible_to
        if not job_visible_to(user.user_id, user.role, job):
            raise HTTPException(status_code=403, detail="That job is not assigned to you.")
        client = await db.clients.find_one({"id": job.get("client_id")}, {"_id": 0}) if job.get("client_id") else None
        lead = await db.leads.find_one({"id": job.get("lead_id")}, {"_id": 0}) if job.get("lead_id") else None
        sheet = await _ensure_job_sheet(job, client=client, lead=lead)
        return await _job_sheet_payload(sheet, job, client=client)
    except HTTPException:
        raise
    except Exception:
        logger.exception("Get job sheet failed job_id=%s", job_id)
        raise HTTPException(status_code=500, detail="Could not load the job sheet. Please try again.")


def _workspace_card(doc: dict, number_key: str) -> dict:
    return {
        "id": doc.get("id") or "",
        "number": doc.get(number_key) or "",
        "status": doc.get("status") or "",
        "total": doc.get("total") or doc.get("amount") or 0,
        "client_name": doc.get("client_name") or "",
    }


@api_router.get("/jobs/{job_id}/workspace")
async def get_job_workspace(job_id: str, user: User = Depends(get_current_user)):
    try:
        job = await db.jobs.find_one({"id": job_id}, {"_id": 0})
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        from field_ops import job_visible_to
        if not job_visible_to(user.user_id, user.role, job):
            raise HTTPException(status_code=403, detail="That job is not assigned to you.")
        client = await db.clients.find_one({"id": job.get("client_id")}, {"_id": 0}) if job.get("client_id") else None
        lead = await db.leads.find_one({"id": job.get("lead_id")}, {"_id": 0}) if job.get("lead_id") else None
        sheet = await _ensure_job_sheet(job, client=client, lead=lead)
        payload = await _job_sheet_payload(sheet, job, client=client)
        plans = await db.floor_plans.find({"job_id": job_id}, {"_id": 0}).sort("updated_at", -1).to_list(50)
        plan_rows = []
        for plan in plans:
            try:
                scope = floor_build_scope(plan.get("document") or {})
                priced = round(sum(float(i.get("amount") or 0) for i in (scope.get("line_items") or [])), 2)
            except Exception:
                logger.exception("Workspace scope failed plan_id=%s job_id=%s", plan.get("id"), job_id)
                scope = {"line_items": []}
                priced = 0.0
            plan_rows.append({**_floor_plan_summary(plan), "scope": scope, "priced_total": priced})
        cid = job.get("client_id") or ""
        eid = job.get("estimate_id") or ""
        estimates = []
        seen_est = set()
        if eid:
            est = await db.estimates.find_one({"id": eid}, {"_id": 0})
            if est:
                estimates.append(_workspace_card(est, "estimate_number"))
                seen_est.add(est.get("id"))
        if cid:
            for est in await db.estimates.find({"client_id": cid}, {"_id": 0}).sort("created_at", -1).to_list(20):
                if est.get("id") in seen_est:
                    continue
                estimates.append(_workspace_card(est, "estimate_number"))
                seen_est.add(est.get("id"))
        related = []
        if eid:
            related.append({"estimate_id": eid})
        if cid:
            related.append({"client_id": cid})
        invoices = []
        contracts = []
        if related:
            invoices = [_workspace_card(inv, "invoice_number") for inv in await db.invoices.find({"$or": related}, {"_id": 0}).sort("created_at", -1).to_list(20)]
            contracts = [_workspace_card(con, "contract_number") for con in await db.contracts.find({"$or": related}, {"_id": 0}).sort("created_at", -1).to_list(20)]
        tasks = await db.job_tasks.find({"job_id": job_id}, {"_id": 0}).sort("created_at", 1).to_list(100)
        logs = await db.job_logs.find({"job_id": job_id}, {"_id": 0}).sort("created_at", -1).to_list(12)
        open_tasks = sum(1 for t in tasks if (t.get("status") or "open") != "done")
        priced_total = round(sum(float(p.get("priced_total") or 0) for p in plan_rows), 2)
        logger.info("Loaded job workspace job_id=%s plans=%s user=%s", job_id, len(plan_rows), user.user_id)
        return {
            **payload,
            "plans": plan_rows,
            "estimates": estimates,
            "invoices": invoices,
            "contracts": contracts,
            "tasks": tasks,
            "recent_logs": logs,
            "open_tasks": open_tasks,
            "priced_total": priced_total,
        }
    except HTTPException:
        raise
    except Exception:
        logger.exception("Get job workspace failed job_id=%s", job_id)
        raise HTTPException(status_code=500, detail="Could not load the job workspace. Please try again.")


@api_router.put("/jobs/{job_id}/sheet")
async def update_job_sheet(job_id: str, payload: JobSheetUpdate, background: BackgroundTasks, user: User = Depends(get_current_user)):
    try:
        job = await db.jobs.find_one({"id": job_id}, {"_id": 0})
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        client = await db.clients.find_one({"id": job.get("client_id")}, {"_id": 0}) if job.get("client_id") else None
        lead = await db.leads.find_one({"id": job.get("lead_id")}, {"_id": 0}) if job.get("lead_id") else None
        sheet = await _ensure_job_sheet(job, client=client, lead=lead)
        data = payload.model_dump(exclude_unset=True)
        updates = {}
        if "client_name" in data and data["client_name"] is not None:
            updates["client_name"] = str(data["client_name"]).strip()
        if "email" in data and data["email"] is not None:
            updates["email"] = str(data["email"]).strip()
        if "address" in data and data["address"] is not None:
            updates["address"] = str(data["address"]).strip()
        if "project_type" in data and data["project_type"] is not None:
            updates["project_type"] = str(data["project_type"]).strip()
        if "source" in data and data["source"] is not None:
            updates["source"] = str(data["source"]).strip()
        if "notes" in data and data["notes"] is not None:
            updates["notes"] = str(data["notes"])
        if "phone" in data and data["phone"] is not None:
            raw = str(data["phone"]).strip()
            updates["phone"] = _safe_lead_phone(raw) if raw else ""
        if "budget" in data and data["budget"] is not None:
            updates["budget"] = max(sheet_money(data["budget"]), 0.0)
        if "income" in data and data["income"] is not None:
            updates["income"] = max(sheet_money(data["income"]), 0.0)
        if "category_budgets" in data and data["category_budgets"] is not None:
            updates["category_budgets"] = coerce_category_budgets(data["category_budgets"])
        if "estimated_days" in data and data["estimated_days"] is not None:
            try:
                days = float(data["estimated_days"])
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail="Estimated days must be a valid number.")
            if days < 0:
                raise HTTPException(status_code=400, detail="Estimated days cannot be negative.")
            updates["estimated_days"] = round(days, 2)
        if "profit_margin" in data:
            if data["profit_margin"] is None:
                updates["profit_margin"] = None
            else:
                try:
                    margin = float(data["profit_margin"])
                except (TypeError, ValueError):
                    raise HTTPException(status_code=400, detail="Profit margin must be a valid number.")
                if margin < 0:
                    raise HTTPException(status_code=400, detail="Profit margin cannot be negative.")
                updates["profit_margin"] = round(margin, 2)
        if "apply_optional_tax" in data and data["apply_optional_tax"] is not None:
            updates["apply_optional_tax"] = bool(data["apply_optional_tax"])
        if not updates:
            return await _job_sheet_payload(sheet, job, client=client)
        updates["updated_at"] = now_iso()
        await db.job_sheets.update_one({"job_id": job_id}, {"$set": updates})
        job_patch = {}
        if "client_name" in updates:
            job_patch["client_name"] = updates["client_name"]
        if "budget" in updates:
            job_patch["budget"] = updates["budget"]
        if job_patch:
            await db.jobs.update_one({"id": job_id}, {"$set": job_patch})
            job = {**job, **job_patch}
        fresh = await db.job_sheets.find_one({"job_id": job_id}, {"_id": 0})
        logger.info("Updated job sheet job_id=%s fields=%s user=%s", job_id, sorted(updates.keys()), user.user_id)
        background.add_task(push_job_docs_to_drive, job, fresh)
        return await _job_sheet_payload(fresh, job, client=client)
    except HTTPException:
        raise
    except Exception:
        logger.exception("Update job sheet failed job_id=%s", job_id)
        raise HTTPException(status_code=500, detail="Could not save the job sheet. Please try again.")


@api_router.get("/jobs/{job_id}/sheet/export")
async def export_job_sheet(job_id: str, user: User = Depends(get_current_user)):
    """Foundation for PDF / Excel / Google Drive export. Not generating files yet."""
    try:
        payload = await get_job_sheet(job_id, user)
        logger.info("Job sheet export requested job_id=%s user=%s (not generated yet)", job_id, user.user_id)
        return payload["export"]
    except HTTPException:
        raise
    except Exception:
        logger.exception("Job sheet export stub failed job_id=%s", job_id)
        raise HTTPException(status_code=500, detail="Could not prepare the job sheet export. Please try again.")


@api_router.get("/jobs/{job_id}/sheet/pdf")
async def job_sheet_pdf(job_id: str, user: User = Depends(get_current_user)):
    try:
        job = await db.jobs.find_one({"id": job_id}, {"_id": 0})
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        client = await db.clients.find_one({"id": job.get("client_id")}, {"_id": 0}) if job.get("client_id") else None
        lead = await db.leads.find_one({"id": job.get("lead_id")}, {"_id": 0}) if job.get("lead_id") else None
        sheet = await _ensure_job_sheet(job, client=client, lead=lead)
        company = await get_company()
        totals = compute_job_sheet_totals(sheet, job)
        priced = await attach_job_pricing({"totals": totals}, sheet, job)
        pdf_bytes = build_job_sheet_pdf(sheet, job, totals, client, company, pricing=priced.get("pricing"))
        await push_job_docs_to_drive(job, sheet)
        filename = f"{job.get('job_number', 'job')}-financial-sheet.pdf"
        logger.info("Job sheet PDF generated job_id=%s user=%s", job_id, user.user_id)
        return StreamingResponse(
            BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except HTTPException:
        raise
    except Exception:
        logger.exception("Job sheet PDF failed job_id=%s", job_id)
        raise HTTPException(status_code=500, detail="Could not generate the job sheet PDF. Please try again.")


@api_router.get("/jobs/{job_id}/receipts/pdf")
async def job_receipts_pdf(job_id: str, user: User = Depends(get_current_user)):
    try:
        job = await db.jobs.find_one({"id": job_id}, {"_id": 0})
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        client = await db.clients.find_one({"id": job.get("client_id")}, {"_id": 0}) if job.get("client_id") else None
        pdf_bytes = build_job_receipts_pdf(job, client, await get_company())
        await push_job_docs_to_drive(job)
        filename = f"{job.get('job_number', 'job')}-receipts.pdf"
        logger.info("Job receipts PDF generated job_id=%s user=%s", job_id, user.user_id)
        return StreamingResponse(
            BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except HTTPException:
        raise
    except Exception:
        logger.exception("Job receipts PDF failed job_id=%s", job_id)
        raise HTTPException(status_code=500, detail="Could not generate the receipts PDF. Please try again.")


@api_router.post("/jobs/{job_id}/sheet/drive/folder")
async def create_job_sheet_drive_folder(job_id: str, user: User = Depends(get_current_user)):
    try:
        job = await db.jobs.find_one({"id": job_id}, {"_id": 0})
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        sheet = await db.job_sheets.find_one({"job_id": job_id}, {"_id": 0})
        client_doc = await resolve_client_for_job(job, sheet)
        updated = await ensure_client_drive_folder(client_doc)
        payload = await client_drive_payload(updated, job_id=job_id)
        logger.info("Job sheet Drive folder ready job_id=%s client_id=%s user=%s", job_id, client_doc.get("id"), user.user_id)
        return payload
    except HTTPException:
        raise
    except Exception:
        logger.exception("Job sheet Drive folder failed job_id=%s", job_id)
        raise HTTPException(status_code=500, detail="Could not create the Google Drive folder. Please try again.")


@api_router.post("/jobs/{job_id}/drive/files")
async def upload_job_drive_file(
    job_id: str,
    kind: str = Form(...),
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
):
    try:
        job = await db.jobs.find_one({"id": job_id}, {"_id": 0})
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        sheet = await db.job_sheets.find_one({"job_id": job_id}, {"_id": 0})
        client_doc = await resolve_client_for_job(job, sheet)
        record = await handle_client_drive_upload(client_doc, kind, file, job_id=job_id)
        fresh = await db.clients.find_one({"id": client_doc["id"]}, {"_id": 0})
        payload = await client_drive_payload(fresh, job_id=job_id)
        payload["uploaded"] = record
        logger.info("Uploaded Drive file kind=%s job_id=%s user=%s", kind, job_id, user.user_id)
        return payload
    except HTTPException:
        raise
    except Exception:
        logger.exception("Job Drive upload failed job_id=%s", job_id)
        raise HTTPException(status_code=500, detail="Could not upload the file to Google Drive. Please try again.")


# ---------------- Invoices ----------------
@api_router.get("/invoices", response_model=List[Invoice])
async def list_invoices(user: User = Depends(get_current_user)):
    await assert_user_feature(user, "invoices")
    docs = await db.invoices.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return [Invoice(**d) for d in docs]


@api_router.post("/invoices", response_model=Invoice)
async def create_invoice(payload: InvoiceCreate, background: BackgroundTasks, user: User = Depends(get_current_user)):
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
    if not str(obj.terms or "").strip():
        obj.terms = (await get_company()).get("invoice_terms") or ""
    await db.invoices.insert_one(obj.model_dump())
    background.add_task(push_invoice_to_drive, obj.model_dump())
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
async def update_invoice(invoice_id: str, payload: InvoiceCreate, background: BackgroundTasks, user: User = Depends(get_current_user)):
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
    background.add_task(push_invoice_to_drive, updated)
    return Invoice(**updated)


@api_router.post("/invoices/{invoice_id}/payments", response_model=Invoice)
async def record_invoice_payment(invoice_id: str, payload: InvoicePaymentBody, background: BackgroundTasks, user: User = Depends(get_current_user)):
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
        background.add_task(push_invoice_to_drive, fresh)
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
        company = await get_company()
        pdf_bytes = build_invoice_pdf(inv, client, company)
        filename = f"{inv.get('invoice_number', 'invoice')}.pdf"
        await push_invoice_to_drive(inv, pdf_bytes)
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

        company = await get_company()
        pdf_bytes = build_invoice_pdf(inv, client, company)
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
        await push_invoice_to_drive(inv, pdf_bytes)
        return {"status": "success", "email_id": email_id, "sent_to": to}
    except HTTPException:
        raise
    except Exception as ex:
        logger.error(f"Invoice email failed invoice_id={invoice_id}: {ex}")
        raise HTTPException(status_code=500, detail="Could not send the invoice. Please try again.")


# ---------------- Company Settings ----------------
async def get_company():
    defaults = CompanySettings(
        name="Revival Pro", address="Austin, TX 78701",
        phone="859-227-0340", license="TX Lic. #RRC-000000", email=OWNER_EMAIL,
    ).model_dump()
    try:
        doc = await db.settings.find_one({"key": "company"}, {"_id": 0})
        if not doc:
            await db.settings.insert_one({"key": "company", **defaults})
            return defaults
        merged = {**defaults, **{k: v for k, v in doc.items() if k != "key" and v is not None}}
        term_keys = (
            "estimate_terms", "invoice_terms", "contract_terms",
            "change_order_terms", "exclusions_text", "default_change_order_markup",
            "default_profit_margin", "credit_card_fee_pct", "sales_tax_pct", "optional_tax_pct",
        )
        for key in term_keys:
            if key not in doc or doc.get(key) is None:
                merged[key] = defaults[key]
        merged.pop("key", None)
        return merged
    except Exception:
        logger.exception("Could not load company settings; using defaults.")
        return defaults


@api_router.get("/settings")
async def read_settings(user: User = Depends(get_current_user)):
    return await get_company()


@api_router.put("/settings")
async def write_settings(payload: CompanySettings, user: User = Depends(get_current_user)):
    try:
        await assert_user_feature(user, "settings")
        await db.settings.update_one({"key": "company"}, {"$set": payload.model_dump()}, upsert=True)
        logger.info("Company settings saved user=%s", user.user_id)
        return await get_company()
    except HTTPException:
        raise
    except Exception:
        logger.exception("Could not save company settings user=%s", user.user_id)
        raise HTTPException(status_code=500, detail="Could not save company settings. Please try again.")


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
        exclusions=parse_exclusion_lines(company.get("exclusions_text")),
        change_order_markup=float(company.get("default_change_order_markup") or 20),
        terms=company.get("contract_terms") or "",
        change_order_terms=company.get("change_order_terms") or "",
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
async def generate_contract_invoice(estimate_id: str, background: BackgroundTasks, user: User = Depends(get_current_user)):
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
                terms=(await get_company()).get("invoice_terms") or "",
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
        background.add_task(push_estimate_to_drive, est)
        background.add_task(push_invoice_to_drive, invoice.model_dump())
        background.add_task(push_contract_to_drive, contract.model_dump())
        background.add_task(push_job_docs_to_drive, job.model_dump())
        return {"contract": contract.model_dump(), "invoice": invoice.model_dump(), "job": job.model_dump()}
    except HTTPException:
        raise
    except Exception as ex:
        logger.error(f"Generate contract failed estimate_id={estimate_id}: {ex}")
        raise HTTPException(status_code=500, detail="Could not generate the contract, invoice, and job. Please try again.")


@api_router.get("/contracts", response_model=List[Contract])
async def list_contracts(user: User = Depends(get_current_user)):
    await assert_user_feature(user, "contracts")
    docs = await db.contracts.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return [Contract(**d) for d in docs]


@api_router.get("/contracts/{contract_id}", response_model=Contract)
async def get_contract(contract_id: str, user: User = Depends(get_current_user)):
    doc = await db.contracts.find_one({"id": contract_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Contract not found")
    return Contract(**doc)


@api_router.put("/contracts/{contract_id}", response_model=Contract)
async def update_contract(contract_id: str, payload: ContractUpdate, background: BackgroundTasks, user: User = Depends(get_current_user)):
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
    background.add_task(push_contract_to_drive, fresh)
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
    await push_contract_to_drive(doc, pdf_bytes)
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
    await push_contract_to_drive(contract, pdf)


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
    dumped = Contract(**doc).model_dump()
    try:
        company = await get_company()
        if not str(dumped.get("terms") or "").strip():
            dumped["terms"] = company.get("contract_terms") or ""
        if not str(dumped.get("change_order_terms") or "").strip():
            dumped["change_order_terms"] = company.get("change_order_terms") or ""
    except Exception:
        logger.exception("Could not attach company terms to public contract token=%s", token)
    return {**dumped, "sign_role": role}


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
    merged = {**doc, **updates}
    if new_status == "Signed":
        await activate_signed_contract_work(merged)
        await maybe_send_signed_copies(merged)
    else:
        await push_contract_to_drive(merged)
    return {"status": "success", "contract_status": new_status, "signed_date": signed_date, "role": role}


# ---------------- Financials / Books ----------------
DEFAULT_OVERHEAD_CATEGORIES = [
    "Insurance",
    "Vehicles & Fuel",
    "Shop / Storage / Office",
    "Software & Technology",
    "Marketing & Leads",
    "Professional Services",
    "Payroll",
    "Tools & Equipment",
    "Miscellaneous",
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


def parse_money_nonneg(value, field="Amount"):
    try:
        amount = float(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f"{field} must be a valid number.")
    if amount < 0:
        raise HTTPException(status_code=400, detail=f"{field} cannot be negative.")
    return round(amount, 2)


async def seed_overhead_catalog():
    """Create or refresh the default category + line-item catalog. Never deletes user extras."""
    try:
        for old_name, new_name in OVERHEAD_CATEGORY_RENAMES.items():
            old_doc = await db.overhead_categories.find_one({"name": old_name}, {"_id": 0})
            if not old_doc:
                continue
            clash = await db.overhead_categories.find_one({"name": new_name}, {"_id": 0})
            if clash:
                continue
            await db.overhead_categories.update_one({"id": old_doc["id"]}, {"$set": {"name": new_name}})
            logger.info("Renamed overhead category %s -> %s", old_name, new_name)

        now = now_iso()
        for i, group in enumerate(OVERHEAD_CATALOG):
            name = group["name"]
            cat = await db.overhead_categories.find_one({"name": name}, {"_id": 0})
            if not cat:
                cat = OverheadCategory(name=name, sort_order=i, created_at=now).model_dump()
                await db.overhead_categories.insert_one(cat)
            else:
                await db.overhead_categories.update_one({"id": cat["id"]}, {"$set": {"sort_order": i}})
                cat["sort_order"] = i
            existing = await db.overhead_line_items.find({"category_id": cat["id"]}, {"_id": 0}).to_list(200)
            by_name = {(item.get("name") or "").strip(): item for item in existing}
            for j, item_name in enumerate(group.get("items") or []):
                if item_name in by_name:
                    await db.overhead_line_items.update_one(
                        {"id": by_name[item_name]["id"]},
                        {"$set": {"sort_order": j}},
                    )
                    continue
                row = OverheadLineItem(
                    category_id=cat["id"],
                    name=item_name,
                    sort_order=j,
                    created_at=now,
                ).model_dump()
                await db.overhead_line_items.insert_one(row)
        logger.info("Overhead catalog ready.")
    except Exception:
        logger.exception("seed_overhead_catalog failed")


async def seed_overhead_categories():
    await seed_overhead_catalog()


async def list_line_items_by_category():
    items = await db.overhead_line_items.find({}, {"_id": 0}).to_list(5000)
    items.sort(key=lambda i: (i.get("sort_order", 0), (i.get("name") or "").lower()))
    by_cat = {}
    for item in items:
        try:
            dumped = OverheadLineItem(**item).model_dump()
        except Exception:
            continue
        by_cat.setdefault(dumped.get("category_id"), []).append(dumped)
    return by_cat


async def get_or_create_month_value(line_item: dict, year: int, month: int) -> dict:
    y, m = parse_year_month(year, month)
    existing = await db.overhead_month_values.find_one(
        {"line_item_id": line_item["id"], "year": y, "month": m},
        {"_id": 0},
    )
    if existing:
        return existing
    row = {
        "id": new_id(),
        "line_item_id": line_item["id"],
        "category_id": line_item.get("category_id") or "",
        "year": y,
        "month": m,
        "projected": 0.0,
        "actual": 0.0,
        "notes": "",
        "receipts": [],
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.overhead_month_values.insert_one(row)
    return {k: v for k, v in row.items() if k != "_id"}


async def list_overhead_categories_with_expenses():
    await seed_overhead_catalog()
    categories = await db.overhead_categories.find({}, {"_id": 0}).to_list(500)
    expenses = await db.overhead_expenses.find({}, {"_id": 0}).to_list(5000)
    by_cat = {}
    for exp in expenses:
        by_cat.setdefault(exp.get("category_id"), []).append(OverheadExpense(**exp).model_dump())
    line_by_cat = await list_line_items_by_category()
    categories.sort(key=lambda c: (c.get("sort_order", 0), (c.get("name") or "").lower()))
    result = []
    for cat in categories:
        items = sorted(by_cat.get(cat["id"], []), key=lambda e: e.get("date") or "", reverse=True)
        result.append({
            **OverheadCategory(**cat).model_dump(),
            "total": round(sum(float(e.get("amount") or 0) for e in items), 2),
            "expenses": items,
            "line_items": line_by_cat.get(cat["id"], []),
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
        await assert_user_feature(user, "financials")
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
        ledger_docs = await db.overhead_month_values.find({"year": year}, {"_id": 0, "actual": 1}).to_list(8000)
        for row in ledger_docs:
            overhead_ytd += float(row.get("actual") or 0)

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
            "month_overhead": await monthly_overhead_snapshot(),
            "square": {
                "connected": False,
                "status": "coming_soon",
                "note": "Square payout sync coming next. Monthly statements can be uploaded in the Square tab.",
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


@api_router.get("/financials/monthly-overhead")
async def monthly_overhead(year: int | None = None, month: int | None = None, user: User = Depends(get_current_user)):
    try:
        y, m = parse_year_month(year, month)
        snap = await monthly_overhead_snapshot(y, m)
        categories = await list_overhead_categories_with_expenses()
        values = await db.overhead_month_values.find({"year": y, "month": m}, {"_id": 0}).to_list(5000)
        by_item = {v.get("line_item_id"): v for v in values}
        month_cats = []
        for cat in categories:
            items = []
            for exp in cat.get("expenses") or []:
                ey, em = year_month_of(exp.get("date") or exp.get("created_at"))
                if ey == y and em == m:
                    items.append(exp)
            extra_actual = round(sum(float(e.get("amount") or 0) for e in items), 2)
            line_rows = []
            for line in cat.get("line_items") or []:
                val = by_item.get(line["id"]) or {}
                projected = round(float(val.get("projected") or 0), 2)
                actual = round(float(val.get("actual") or 0), 2)
                line_rows.append({
                    **line,
                    "projected": projected,
                    "actual": actual,
                    "difference": round(actual - projected, 2),
                    "notes": val.get("notes") or "",
                    "receipts": val.get("receipts") or [],
                })
            projected = round(sum(float(row.get("projected") or 0) for row in line_rows), 2)
            ledger_actual = round(sum(float(row.get("actual") or 0) for row in line_rows), 2)
            actual = round(ledger_actual + extra_actual, 2)
            month_cats.append({
                **{k: v for k, v in cat.items() if k not in ("expenses", "line_items", "total")},
                "projected": projected,
                "actual": actual,
                "difference": round(actual - projected, 2),
                "total": actual,
                "line_items": line_rows,
                "expenses": items,
            })
        snap.pop("expenses", None)
        snap["categories"] = month_cats
        logger.info(
            "Monthly overhead loaded %s days=%s projected=%s actual=%s user=%s",
            snap.get("month_label"),
            snap.get("days_in_month"),
            snap.get("projected_total"),
            snap.get("actual_total"),
            user.user_id,
        )
        return snap
    except HTTPException:
        raise
    except Exception:
        logger.exception("Monthly overhead failed")
        raise HTTPException(status_code=500, detail="Could not load this month’s overhead. Please try again.")


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
        await db.overhead_line_items.delete_many({"category_id": category_id})
        await db.overhead_month_values.delete_many({"category_id": category_id})
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


@api_router.post("/financials/line-items")
async def create_overhead_line_item(payload: OverheadLineItemCreate, user: User = Depends(get_current_user)):
    try:
        name = (payload.name or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="Line item name is required.")
        category = await db.overhead_categories.find_one({"id": payload.category_id}, {"_id": 0})
        if not category:
            raise HTTPException(status_code=400, detail="Choose a valid overhead category.")
        clash = await db.overhead_line_items.find_one(
            {"category_id": payload.category_id, "name": name},
            {"_id": 0},
        )
        if clash:
            raise HTTPException(status_code=400, detail="That line item already exists in this category.")
        last = await db.overhead_line_items.find(
            {"category_id": payload.category_id},
            {"_id": 0, "sort_order": 1},
        ).sort("sort_order", -1).to_list(1)
        sort_order = payload.sort_order if payload.sort_order is not None else ((last[0]["sort_order"] + 1) if last else 0)
        obj = OverheadLineItem(category_id=payload.category_id, name=name, sort_order=sort_order)
        await db.overhead_line_items.insert_one(obj.model_dump())
        logger.info("Created overhead line item %s category=%s user=%s", obj.id, payload.category_id, user.user_id)
        return obj.model_dump()
    except HTTPException:
        raise
    except Exception:
        logger.exception("Create overhead line item failed")
        raise HTTPException(status_code=500, detail="Could not add the line item. Please try again.")


@api_router.put("/financials/line-items/{item_id}")
async def update_overhead_line_item(item_id: str, payload: OverheadLineItemUpdate, user: User = Depends(get_current_user)):
    try:
        existing = await db.overhead_line_items.find_one({"id": item_id}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="Line item not found")
        updates = {}
        if payload.name is not None:
            name = payload.name.strip()
            if not name:
                raise HTTPException(status_code=400, detail="Line item name is required.")
            clash = await db.overhead_line_items.find_one(
                {"category_id": existing["category_id"], "name": name, "id": {"$ne": item_id}},
                {"_id": 0},
            )
            if clash:
                raise HTTPException(status_code=400, detail="That line item already exists in this category.")
            updates["name"] = name
        if payload.sort_order is not None:
            updates["sort_order"] = int(payload.sort_order)
        if payload.category_id:
            category = await db.overhead_categories.find_one({"id": payload.category_id}, {"_id": 0})
            if not category:
                raise HTTPException(status_code=400, detail="Choose a valid overhead category.")
            updates["category_id"] = payload.category_id
        if updates:
            await db.overhead_line_items.update_one({"id": item_id}, {"$set": updates})
            if updates.get("category_id"):
                await db.overhead_month_values.update_many(
                    {"line_item_id": item_id},
                    {"$set": {"category_id": updates["category_id"]}},
                )
        fresh = await db.overhead_line_items.find_one({"id": item_id}, {"_id": 0})
        logger.info("Updated overhead line item %s user=%s", item_id, user.user_id)
        return OverheadLineItem(**fresh).model_dump()
    except HTTPException:
        raise
    except Exception:
        logger.exception("Update overhead line item failed item_id=%s", item_id)
        raise HTTPException(status_code=500, detail="Could not update the line item. Please try again.")


@api_router.delete("/financials/line-items/{item_id}")
async def delete_overhead_line_item(item_id: str, user: User = Depends(get_current_user)):
    try:
        existing = await db.overhead_line_items.find_one({"id": item_id}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="Line item not found")
        await db.overhead_month_values.delete_many({"line_item_id": item_id})
        await db.overhead_line_items.delete_one({"id": item_id})
        logger.info("Deleted overhead line item %s user=%s", item_id, user.user_id)
        return {"success": True}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Delete overhead line item failed item_id=%s", item_id)
        raise HTTPException(status_code=500, detail="Could not delete the line item. Please try again.")


@api_router.put("/financials/line-items/{item_id}/month")
async def upsert_overhead_month_value(item_id: str, payload: OverheadMonthValueUpdate, user: User = Depends(get_current_user)):
    try:
        line = await db.overhead_line_items.find_one({"id": item_id}, {"_id": 0})
        if not line:
            raise HTTPException(status_code=404, detail="Line item not found")
        y, m = parse_year_month(payload.year, payload.month)
        if payload.projected is None and payload.actual is None and payload.notes is None:
            raise HTTPException(status_code=400, detail="Enter a projected amount, actual amount, or a note.")
        row = await get_or_create_month_value(line, y, m)
        updates = {"updated_at": now_iso(), "category_id": line.get("category_id") or ""}
        if payload.projected is not None:
            updates["projected"] = parse_money_nonneg(payload.projected, "Projected amount")
        if payload.actual is not None:
            updates["actual"] = parse_money_nonneg(payload.actual, "Actual amount")
        if payload.notes is not None:
            updates["notes"] = (payload.notes or "").strip()
        await db.overhead_month_values.update_one({"id": row["id"]}, {"$set": updates})
        fresh = await db.overhead_month_values.find_one({"id": row["id"]}, {"_id": 0})
        logger.info(
            "Saved overhead month value item=%s %s-%s projected=%s actual=%s user=%s",
            item_id,
            y,
            m,
            fresh.get("projected"),
            fresh.get("actual"),
            user.user_id,
        )
        return {
            **fresh,
            "difference": round(float(fresh.get("actual") or 0) - float(fresh.get("projected") or 0), 2),
        }
    except HTTPException:
        raise
    except Exception:
        logger.exception("Upsert overhead month value failed item_id=%s", item_id)
        raise HTTPException(status_code=500, detail="Could not save the monthly amounts. Please try again.")


@api_router.post("/financials/line-items/{item_id}/receipts")
async def upload_overhead_receipt(
    item_id: str,
    year: int | None = None,
    month: int | None = None,
    upload: UploadFile = File(...),
    user: User = Depends(get_current_user),
):
    try:
        line = await db.overhead_line_items.find_one({"id": item_id}, {"_id": 0})
        if not line:
            raise HTTPException(status_code=404, detail="Line item not found")
        category = await db.overhead_categories.find_one({"id": line.get("category_id")}, {"_id": 0})
        y, m = parse_year_month(year, month)
        filename, mime, content = await read_drive_upload(upload)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")
        labeled = gdrive.sanitize_filename(f"{line.get('name') or 'Receipt'} {stamp} {filename}")
        saved = await save_company_drive_file(
            [
                gdrive.COMPANY_ROOT_NAME,
                gdrive.OVERHEAD_ROOT_NAME,
                str(y),
                company_month_folder_name(y, m),
                (category or {}).get("name") or "Overhead",
            ],
            labeled,
            content,
            mime,
        )
        row = await get_or_create_month_value(line, y, m)
        receipt = {
            "id": new_id(),
            "filename": saved.get("filename") or labeled,
            "mime_type": mime,
            "google_drive_file_id": saved.get("google_drive_file_id") or "",
            "web_view_link": saved.get("web_view_link") or "",
            "folder_url": saved.get("folder_url") or "",
            "uploaded_at": now_iso(),
        }
        await db.overhead_month_values.update_one(
            {"id": row["id"]},
            {"$push": {"receipts": receipt}, "$set": {"updated_at": now_iso()}},
        )
        logger.info("Uploaded overhead receipt item=%s year=%s month=%s user=%s", item_id, y, m, user.user_id)
        return receipt
    except HTTPException:
        raise
    except Exception:
        logger.exception("Upload overhead receipt failed item_id=%s", item_id)
        raise HTTPException(status_code=500, detail="Could not upload the receipt. Please try again.")


@api_router.delete("/financials/line-items/{item_id}/receipts/{receipt_id}")
async def delete_overhead_receipt(item_id: str, receipt_id: str, user: User = Depends(get_current_user)):
    try:
        row = await db.overhead_month_values.find_one({"line_item_id": item_id, "receipts.id": receipt_id}, {"_id": 0})
        if not row:
            raise HTTPException(status_code=404, detail="Receipt not found")
        await db.overhead_month_values.update_one(
            {"id": row["id"]},
            {"$pull": {"receipts": {"id": receipt_id}}, "$set": {"updated_at": now_iso()}},
        )
        logger.info("Removed overhead receipt %s item=%s user=%s", receipt_id, item_id, user.user_id)
        return {"success": True}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Delete overhead receipt failed item_id=%s receipt_id=%s", item_id, receipt_id)
        raise HTTPException(status_code=500, detail="Could not remove the receipt. Please try again.")


@api_router.get("/financials/square-statements")
async def list_square_statements(year: int | None = None, month: int | None = None, user: User = Depends(get_current_user)):
    try:
        query = {}
        if year is not None:
            query["year"] = int(year)
        if month is not None:
            query["month"] = int(month)
        docs = await db.square_statements.find(query, {"_id": 0}).sort([("year", -1), ("month", -1), ("uploaded_at", -1)]).to_list(500)
        return [SquareStatement(**d).model_dump() for d in docs]
    except HTTPException:
        raise
    except Exception:
        logger.exception("List Square statements failed")
        raise HTTPException(status_code=500, detail="Could not load Square statements. Please try again.")


@api_router.post("/financials/square-statements")
async def upload_square_statement(
    year: int = Form(...),
    month: int = Form(...),
    upload: UploadFile = File(...),
    user: User = Depends(get_current_user),
):
    try:
        y, m = parse_year_month(year, month)
        filename, mime, content = await read_drive_upload(upload)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")
        labeled = gdrive.sanitize_filename(f"Square {company_month_folder_name(y, m)} {y} {stamp} {filename}")
        saved = await save_company_drive_file(
            [
                gdrive.COMPANY_ROOT_NAME,
                gdrive.SQUARE_ROOT_NAME,
                str(y),
                company_month_folder_name(y, m),
            ],
            labeled,
            content,
            mime,
        )
        obj = SquareStatement(
            year=y,
            month=m,
            filename=saved.get("filename") or labeled,
            mime_type=mime,
            google_drive_file_id=saved.get("google_drive_file_id") or "",
            web_view_link=saved.get("web_view_link") or "",
            folder_url=saved.get("folder_url") or "",
        )
        await db.square_statements.insert_one(obj.model_dump())
        logger.info("Uploaded Square statement %s-%s user=%s", y, m, user.user_id)
        return obj.model_dump()
    except HTTPException:
        raise
    except Exception:
        logger.exception("Upload Square statement failed")
        raise HTTPException(status_code=500, detail="Could not upload the Square statement. Please try again.")


@api_router.delete("/financials/square-statements/{statement_id}")
async def delete_square_statement(statement_id: str, user: User = Depends(get_current_user)):
    try:
        existing = await db.square_statements.find_one({"id": statement_id}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="Square statement not found")
        await db.square_statements.delete_one({"id": statement_id})
        logger.info("Deleted Square statement %s user=%s", statement_id, user.user_id)
        return {"success": True}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Delete Square statement failed statement_id=%s", statement_id)
        raise HTTPException(status_code=500, detail="Could not delete the Square statement. Please try again.")


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
    await assert_user_feature(user, "dashboard")
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
async def seed_showcase_kitchen():
    """Keep the Lexington Estate Kitchen example in Plans so the shop has a full demo."""
    try:
        client = await db.clients.find_one({"name": "Sarah Mitchell"}, {"_id": 0}) or {}
        job = {}
        if client.get("id"):
            job = await db.jobs.find_one({"client_id": client["id"]}, {"_id": 0}) or {}
        plan = build_showcase_plan(
            client_id=client.get("id") or "",
            client_name=client.get("name") or "Lexington Estate (example)",
            job_id=job.get("id") or "",
            address=client.get("address") or "1200 Lexington Pike, Lexington, KY",
        )
        existing = await db.floor_plans.find_one({"id": SHOWCASE_PLAN_ID}, {"_id": 0})
        if existing:
            plan["created_at"] = existing.get("created_at") or plan["created_at"]
            plan["google_drive_file_id"] = existing.get("google_drive_file_id") or ""
            plan["google_drive_url"] = existing.get("google_drive_url") or ""
        await db.floor_plans.update_one({"id": SHOWCASE_PLAN_ID}, {"$set": plan}, upsert=True)
        totals = (plan.get("takeoffs") or {}).get("totals") or {}
        logger.info(
            "Showcase kitchen ready rooms=%s objects=%s floor_sf=%s",
            len(((plan.get("document") or {}).get("levels") or [{}])[0].get("rooms") or []),
            len(((plan.get("document") or {}).get("levels") or [{}])[0].get("objects") or []),
            totals.get("floor_sf") or 0,
        )
    except Exception:
        logger.exception("Could not seed the showcase kitchen floor plan")


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


async def init_thumbtack_indexes():
    try:
        await db.leads.create_index(
            "thumbtack_lead_id",
            unique=True,
            name="thumbtack_lead_id_unique",
            partialFilterExpression={"thumbtack_lead_id": {"$type": "string", "$gt": ""}},
        )
        await db.webhook_events.create_index("received_at", expireAfterSeconds=60 * 60 * 24 * 30)
        await db.webhook_events.create_index("source")
        await db.job_sheets.create_index("job_id", unique=True, name="job_sheet_job_id_unique")
        await db.drive_files.create_index("client_id", name="drive_files_client_id")
        await db.drive_files.create_index(
            [("client_id", 1), ("kind", 1), ("source_id", 1)],
            name="drive_files_client_kind_source",
        )
        if configured_webhook_secret():
            logger.info("Thumbtack webhook secret is configured.")
        else:
            logger.warning("THUMBTACK_WEBHOOK_SECRET is not set; the webhook will accept unsigned requests.")
        logger.info("Thumbtack public URL format: %s", NGROK_WEBHOOK_URL_FORMAT)
    except Exception:
        logger.exception("Failed to initialize Thumbtack webhook indexes.")


async def init_overhead_indexes():
    try:
        await db.overhead_line_items.create_index("category_id", name="overhead_line_items_category")
        await db.overhead_month_values.create_index(
            [("line_item_id", 1), ("year", 1), ("month", 1)],
            unique=True,
            name="overhead_month_values_item_month",
        )
        await db.square_statements.create_index(
            [("year", -1), ("month", -1)],
            name="square_statements_year_month",
        )
    except Exception:
        logger.exception("Failed to initialize overhead indexes.")


async def init_floor_plan_indexes():
    try:
        await db.floor_plans.create_index("job_id", name="floor_plans_job_id")
        await db.floor_plans.create_index("client_id", name="floor_plans_client_id")
        await db.floor_plans.create_index("updated_at", name="floor_plans_updated")
    except Exception:
        logger.exception("Failed to initialize floor plan indexes.")


@app.on_event("startup")
async def on_startup():
    try:
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
        await init_overhead_indexes()
        await init_floor_plan_indexes()
        await seed_leads()
        await seed_showcase_kitchen()
        await init_thumbtack_indexes()
        await apply_stored_drive_oauth()
    except Exception:
        logger.exception("Startup initialization failed; API will still serve requests.")


from field_routes import attach_field_routes
attach_field_routes(api_router)

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
