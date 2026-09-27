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
from showcase_kitchen import SHOWCASE_PLAN_ID, build_showcase_plan, should_replace_showcase
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
    call_attempts: int = 0
    thumbtack_lead_id: str = ""
    google_ads_lead_id: str = ""
    angi_lead_id: str = ""
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
    google_ads_lead_id: str = ""
    angi_lead_id: str = ""


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
    square_savings_folder_id: str = ""
    square_savings_folder_name: str = ""
    square_folder_link_status: str = ""
    job_funds_total_deposits: float = 0.0
    job_funds_remaining_on_contract: float = 0.0
    job_funds_folder_balance: float = 0.0
    job_funds_updated_at: str = ""
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
    revision: int = 0
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
    job_fund_folder_name_pattern: str = "{client_name} – {job_short_name}"


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
async def resolve_user_from_token(token: Optional[str]):
    """Resolve a session cookie, bearer session, or access JWT. Never log the token."""
    if not token:
        return None
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
    try:
        payload = jwt.decode(token, os.environ["JWT_SECRET"], algorithms=[JWT_ALGORITHM])
        if payload.get("type") == "access":
            user_doc = await db.users.find_one({"user_id": payload.get("sub")}, {"_id": 0})
            if user_doc:
                return User(**user_doc)
    except jwt.PyJWTError:
        return None
    return None


async def get_current_user(
    request: Request,
    session_token: Optional[str] = Cookie(default=None),
    access_token: Optional[str] = Cookie(default=None),
):
    bearer = None
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        bearer = auth[7:]

    user = await resolve_user_from_token(session_token or bearer)
    if user:
        return user
    user = await resolve_user_from_token(access_token)
    if user:
        return user
    raise HTTPException(status_code=401, detail="Not authenticated")


# --- extracted to routes/auth.py ---

def require_admin(user: User = Depends(get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


async def assert_user_feature(user: User, feature: str):
    from field_ops import can
    doc = await db.settings.find_one({"key": "permissions"}, {"_id": 0}) or {}
    if not can(user.role, feature, doc.get("roles")):
        raise HTTPException(status_code=403, detail="You do not have access to that.")


# --- extracted to routes/auth.py ---

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


class DriveCryptoError(RuntimeError):
    """JWT_SECRET is missing or too weak to wrap Google Drive secrets."""


def _drive_fernet():
    secret = (os.environ.get("JWT_SECRET") or "").strip()
    if len(secret) < 16:
        raise DriveCryptoError("JWT_SECRET is required to encrypt Google Drive secrets.")
    digest = hashlib.sha256(secret.encode("utf-8")).digest()
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


async def apply_stored_drive_oauth():
    """Load Company Profile keys into process memory (not .env). Never log values."""
    try:
        if gdrive.oauth_configured():
            return
        doc = await load_drive_settings()
        client_id = (doc.get("oauth_client_id") or "").strip()
        secret = _decrypt_secret(doc.get("oauth_client_secret_enc") or "")
        if client_id and secret:
            gdrive.set_runtime_oauth(client_id, secret)
            logger.info("Loaded Google Drive OAuth keys from Company Profile")
    except DriveCryptoError:
        logger.error("Cannot load Google Drive keys: JWT_SECRET is missing or too short.")
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
    "magicplan": "Magicplan / Plan screenshot",
    "site_video": "Site walkthrough video",
    "client_report": "Client design proposal",
    "permit_details": "Permit details",
    "materials_list": "Materials list",
    "vendor_quote": "Vendor quote",
    "photo_before": "Photo — Before",
    "photo_during": "Photo — During",
    "photo_after": "Photo — After",
    "bid_pdf": "Subcontractor bid PDF",
    "bid_asset": "Bid package file",
    "deposit_receipt": "Job deposit receipt",
    "other": "Other",
}
UPLOAD_KINDS = [
    "floor_plan", "magicplan", "site_video", "materials_list", "vendor_quote",
    "photo_before", "photo_during", "photo_after",
    "bid_pdf", "bid_asset",
    "receipt", "other",
]
# iPhone walkthrough videos need headroom beyond typical PDF/photo uploads.
MAX_DRIVE_UPLOAD_BYTES = 80 * 1024 * 1024
ALLOWED_DRIVE_UPLOAD_TYPES = {
    "application/pdf",
    "image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif", "image/gif",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "text/csv",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
    "application/octet-stream",
    "video/mp4",
    "video/quicktime",
    "video/webm",
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
    "mp4": "video/mp4",
    "mov": "video/quicktime",
    "webm": "video/webm",
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
# --- extracted to routes/clients.py ---

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


# --- extracted to routes/leads.py ---

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



def _project_type_from_job(job: dict, lead: dict | None) -> str:
    if lead and (lead.get("project_type") or "").strip():
        return lead["project_type"].strip()
    name = (job.get("name") or "").strip()
    if " - " in name:
        return name.split(" - ", 1)[0].strip() or "Project"
    return name or "Project"


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


def _safe_lead_phone(raw: str) -> str:
    try:
        return phone_to_e164(raw or "", required=False)
    except ValueError:
        logger.warning("Stored a lead with an unparseable phone; leaving phone blank.")
        return ""


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
            if value and not existing.get(key):
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


# --- extracted to routes/billing.py ---

# ---------------- Jobs ----------------
# --- extracted to routes/jobs.py ---

# --- extracted to routes/floor_plans.py ---

# --- extracted to routes/jobs.py ---
# ---------------- Invoices ----------------
# --- extracted to routes/billing.py ---

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
            "job_fund_folder_name_pattern",
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


# --- extracted to routes/billing.py ---

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


# --- extracted to routes/financials.py ---

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
        existing = await db.floor_plans.find_one({"id": SHOWCASE_PLAN_ID}, {"_id": 0})
        if not should_replace_showcase(existing):
            doc = (existing or {}).get("document") or {}
            level = ((doc.get("levels") or [{}])[0]) if doc else {}
            logger.info(
                "Showcase kitchen kept (shop edits preserved) rooms=%s objects=%s",
                len(level.get("rooms") or []),
                len(level.get("objects") or []),
            )
            return
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
            logger.warning(
                "THUMBTACK_WEBHOOK_SECRET is not set; unsigned webhooks are rejected except on localhost."
            )
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


async def init_bid_indexes():
    try:
        await db.bid_packages.create_index("job_id", name="bid_packages_job_id")
        await db.bid_invitations.create_index("package_id", name="bid_invitations_package_id")
        await db.bid_invitations.create_index("token_hash", unique=True, name="bid_invitations_token_hash")
        await db.bids.create_index("package_id", name="bids_package_id")
        await db.bids.create_index("invitation_id", name="bids_invitation_id")
        await db.bid_messages.create_index("package_id", name="bid_messages_package_id")
        await db.subcontractors.create_index("email", name="subcontractors_email")
    except Exception:
        logger.exception("Failed to initialize bid portal indexes.")


async def init_job_fund_indexes():
    try:
        await db.job_deposits.create_index("job_id", name="job_deposits_job_id")
        await db.job_deposits.create_index("idempotency_key", unique=True, name="job_deposits_idempotency")
        await db.job_deposits.create_index(
            "square_payment_id",
            unique=True,
            name="job_deposits_square_payment",
            partialFilterExpression={"square_payment_id": {"$type": "string", "$gt": ""}},
        )
        await db.job_deposits.create_index("square_checkout_id", name="job_deposits_checkout")
        await db.job_fund_transfers.create_index("job_id", name="job_fund_transfers_job_id")
        await db.job_fund_transfers.create_index("deposit_id", name="job_fund_transfers_deposit_id")
        await db.job_fund_audit.create_index("job_id", name="job_fund_audit_job_id")
        await db.job_fund_audit.create_index("created_at", name="job_fund_audit_created")
        await db.square_payments.create_index("square_payment_id", unique=True, name="square_payments_payment_id")
        await db.square_payments.create_index("job_id", name="square_payments_job_id")
        await db.webhook_events.create_index(
            [("source", 1), ("event_id", 1)],
            unique=True,
            name="webhook_events_source_event",
            partialFilterExpression={"event_id": {"$type": "string", "$gt": ""}},
        )
    except Exception:
        logger.exception("Failed to initialize job fund indexes.")


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
        await init_bid_indexes()
        await init_job_fund_indexes()
        await seed_leads()
        await seed_showcase_kitchen()
        await init_thumbtack_indexes()
        await apply_stored_drive_oauth()
        try:
            from subcontractors import seed_lexington_subcontractors
            n = await seed_lexington_subcontractors(db)
            if n:
                logger.info("Seeded %s Lexington subcontractors into the directory.", n)
        except Exception:
            logger.exception("Subcontractor directory seed failed at startup.")
    except Exception:
        logger.exception("Startup initialization failed; API will still serve requests.")


from field_routes import attach_field_routes
attach_field_routes(api_router)

from routes.auth import attach_auth_routes
from routes.clients import attach_client_routes
from routes.leads import attach_lead_routes
from routes.jobs import attach_job_routes
from routes.floor_plans import attach_floor_plan_routes
from routes.billing import attach_billing_routes
from routes.financials import attach_financial_routes
from routes.subcontractors import attach_subcontractor_routes
from routes.job_funds import attach_job_fund_routes
from routes.calendar import attach_calendar_routes
from routes.lead_speed_dial import attach_lead_speed_dial_routes

attach_auth_routes(api_router)
attach_client_routes(api_router)
attach_lead_speed_dial_routes(api_router)  # before /leads/{id} so calling-settings/call-logs match
attach_lead_routes(api_router)
attach_job_routes(api_router)
attach_floor_plan_routes(api_router)
attach_billing_routes(api_router)
attach_financial_routes(api_router)
attach_subcontractor_routes(api_router)
attach_job_fund_routes(api_router)
attach_calendar_routes(api_router)


app.include_router(api_router)

from http_security import cors_allow_origins

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=cors_allow_origins(),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
