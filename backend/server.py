from fastapi import FastAPI, APIRouter, Depends, HTTPException, Request, Response, Cookie
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
import requests
import base64
from html import escape
from datetime import datetime, timezone, timedelta
from fastapi.responses import StreamingResponse
from io import BytesIO
from email_pdf import build_estimate_pdf, build_contract_pdf, send_email, EMAIL_FROM_NAME, money


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

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
    created_at: str = Field(default_factory=now_iso)


class ClientCreate(BaseModel):
    name: str
    phone: str = ""
    email: str = ""
    address: str = ""
    source: str = "Referral"
    status: str = "Lead"
    notes: str = ""


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
    client_name: str = ""
    status: str = "Active"
    budget: float = 0.0
    expenses: List[Expense] = []
    created_at: str = Field(default_factory=now_iso)


class JobCreate(BaseModel):
    name: str
    estimate_id: str = ""
    client_name: str = ""
    status: str = "Active"
    budget: float = 0.0


class Invoice(BaseModel):
    id: str = Field(default_factory=new_id)
    invoice_number: str = ""
    estimate_id: str = ""
    client_name: str = ""
    status: str = "Draft"
    line_items: List[LineItem] = []
    amount: float = 0.0
    amount_paid: float = 0.0
    due_date: str = ""
    created_at: str = Field(default_factory=now_iso)


class InvoiceCreate(BaseModel):
    estimate_id: str = ""
    client_name: str = ""
    status: str = "Draft"
    line_items: List[LineItem] = []
    amount: float = 0.0
    amount_paid: float = 0.0
    due_date: str = ""


class PaymentMilestone(BaseModel):
    label: str = ""
    amount: float = 0.0
    note: str = ""


class Contract(BaseModel):
    id: str = Field(default_factory=new_id)
    contract_number: str = ""
    estimate_id: str = ""
    invoice_id: str = ""
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


# ---------------- Auth ----------------
async def get_current_user(request: Request, session_token: Optional[str] = Cookie(default=None)):
    token = session_token
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")

    expires_at = session["expires_at"]
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Session expired")

    user_doc = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
    if not user_doc:
        raise HTTPException(status_code=401, detail="User not found")
    return User(**user_doc)


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
async def next_number(collection, field, prefix):
    count = await collection.count_documents({})
    year = datetime.now(timezone.utc).year
    return f"{prefix}-{year}-{count + 1:04d}"


# ---------------- Clients ----------------
@api_router.get("/clients", response_model=List[Client])
async def list_clients(user: User = Depends(get_current_user)):
    docs = await db.clients.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return [Client(**d) for d in docs]


@api_router.post("/clients", response_model=Client)
async def create_client(payload: ClientCreate, user: User = Depends(get_current_user)):
    obj = Client(**payload.model_dump())
    await db.clients.insert_one(obj.model_dump())
    return obj


@api_router.put("/clients/{client_id}", response_model=Client)
async def update_client(client_id: str, payload: ClientCreate, user: User = Depends(get_current_user)):
    existing = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Client not found")
    updated = {**existing, **payload.model_dump()}
    await db.clients.update_one({"id": client_id}, {"$set": updated})
    return Client(**updated)


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
    jobs = await db.jobs.find({"client_name": client["name"]}, {"_id": 0}).sort("created_at", -1).to_list(500)
    invoices = await db.invoices.find({"client_name": client["name"]}, {"_id": 0}).sort("created_at", -1).to_list(500)

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
    number = await next_number(db.estimates, "estimate_number", "EST")
    obj = Estimate(
        estimate_number=number,
        client_id=payload.client_id,
        client_name=payload.client_name,
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
    updated = {
        **existing,
        "client_id": payload.client_id,
        "client_name": payload.client_name,
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
    est = await db.estimates.find_one({"id": estimate_id}, {"_id": 0})
    if not est:
        raise HTTPException(status_code=404, detail="Estimate not found")
    if est.get("status") != "Won":
        raise HTTPException(status_code=400, detail="Only Won estimates can be converted to an invoice")
    existing_inv = await db.invoices.find_one({"estimate_id": estimate_id}, {"_id": 0})
    if existing_inv:
        return Invoice(**existing_inv)
    number = await next_number(db.invoices, "invoice_number", "INV")
    due = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
    obj = Invoice(
        invoice_number=number,
        estimate_id=estimate_id,
        client_name=est.get("client_name", ""),
        status="Draft",
        line_items=[LineItem(**i) for i in est.get("line_items", [])],
        amount=est.get("total", 0.0),
        amount_paid=0.0,
        due_date=due,
    )
    await db.invoices.insert_one(obj.model_dump())
    return obj


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
    number = await next_number(db.jobs, "job_number", "JOB")
    obj = Job(job_number=number, **payload.model_dump())
    await db.jobs.insert_one(obj.model_dump())
    return obj


@api_router.put("/jobs/{job_id}", response_model=Job)
async def update_job(job_id: str, payload: JobCreate, user: User = Depends(get_current_user)):
    existing = await db.jobs.find_one({"id": job_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Job not found")
    updated = {**existing, **payload.model_dump()}
    await db.jobs.update_one({"id": job_id}, {"$set": updated})
    return Job(**updated)


@api_router.delete("/jobs/{job_id}")
async def delete_job(job_id: str, user: User = Depends(get_current_user)):
    await db.jobs.delete_one({"id": job_id})
    return {"success": True}


@api_router.post("/jobs/{job_id}/expenses", response_model=Job)
async def add_expense(job_id: str, expense: Expense, user: User = Depends(get_current_user)):
    existing = await db.jobs.find_one({"id": job_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Job not found")
    exp = expense.model_dump()
    if not exp.get("id"):
        exp["id"] = new_id()
    existing.setdefault("expenses", []).append(exp)
    await db.jobs.update_one({"id": job_id}, {"$set": {"expenses": existing["expenses"]}})
    return Job(**existing)


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
    number = await next_number(db.invoices, "invoice_number", "INV")
    amount = payload.amount
    if payload.line_items:
        _, subtotal, _, total = compute_totals(payload.line_items, 0)
        amount = total if not amount else amount
    obj = Invoice(invoice_number=number, **payload.model_dump())
    obj.amount = amount
    await db.invoices.insert_one(obj.model_dump())
    return obj


@api_router.put("/invoices/{invoice_id}", response_model=Invoice)
async def update_invoice(invoice_id: str, payload: InvoiceCreate, user: User = Depends(get_current_user)):
    existing = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Invoice not found")
    updated = {**existing, **payload.model_dump()}
    await db.invoices.update_one({"id": invoice_id}, {"$set": updated})
    return Invoice(**updated)


@api_router.delete("/invoices/{invoice_id}")
async def delete_invoice(invoice_id: str, user: User = Depends(get_current_user)):
    await db.invoices.delete_one({"id": invoice_id})
    return {"success": True}


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
    number = await next_number(db.contracts, "contract_number", "CON")
    total = est.get("total", 0.0)
    desc = f"{est.get('category','')} remodeling project"
    if est.get("notes"):
        desc += f" — {est['notes']}"
    return Contract(
        contract_number=number,
        estimate_id=est["id"],
        contractor_name=company.get("name", "Revival Pro"),
        contractor_address=company.get("address", ""),
        contractor_phone=company.get("phone", ""),
        contractor_license=company.get("license", ""),
        client_name=(client or {}).get("name", est.get("client_name", "")),
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


@api_router.post("/estimates/{estimate_id}/generate")
async def generate_contract_invoice(estimate_id: str, user: User = Depends(get_current_user)):
    est = await db.estimates.find_one({"id": estimate_id}, {"_id": 0})
    if not est:
        raise HTTPException(status_code=404, detail="Estimate not found")
    if est.get("status") != "Won":
        raise HTTPException(status_code=400, detail="Only Won estimates can generate a contract and invoice")

    inv_doc = await db.invoices.find_one({"estimate_id": estimate_id}, {"_id": 0})
    if inv_doc:
        invoice = Invoice(**inv_doc)
    else:
        invoice = Invoice(
            invoice_number=await next_number(db.invoices, "invoice_number", "INV"),
            estimate_id=estimate_id,
            client_name=est.get("client_name", ""),
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
        if not contract.invoice_id:
            contract.invoice_id = invoice.id
            await db.contracts.update_one({"id": contract.id}, {"$set": {"invoice_id": invoice.id}})
    else:
        client = await db.clients.find_one({"id": est.get("client_id")}, {"_id": 0}) if est.get("client_id") else None
        company = await get_company()
        contract = await build_contract_from_estimate(est, client, company)
        contract.invoice_id = invoice.id
        await db.contracts.insert_one(contract.model_dump())

    return {"contract": contract.model_dump(), "invoice": invoice.model_dump()}


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
        await maybe_send_signed_copies(merged)
    return {"status": "success", "contract_status": new_status, "signed_date": signed_date, "role": role}


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
        Client(name="Sarah Mitchell", phone="(512) 555-0134", email="sarah.mitchell@email.com", address="4820 Oak Ridge Dr, Austin, TX", source="Thumbtack", status="Active", notes="Full kitchen remodel."),
        Client(name="James Rodriguez", phone="(512) 555-0198", email="jrodriguez@email.com", address="912 Maple Ave, Round Rock, TX", source="Angi", status="Active", notes="Master bath renovation."),
        Client(name="Emily Chen", phone="(512) 555-0176", email="emily.chen@email.com", address="228 Cedar Ln, Cedar Park, TX", source="Referral", status="Lead", notes="Interested in roofing."),
        Client(name="Michael Thompson", phone="(512) 555-0142", email="mthompson@email.com", address="1560 Sunset Blvd, Austin, TX", source="Website", status="Active", notes="Home addition project."),
        Client(name="Linda Garcia", phone="(512) 555-0109", email="linda.g@email.com", address="770 Birch St, Georgetown, TX", source="Referral", status="Won", notes="Exterior siding & paint."),
        Client(name="David Park", phone="(512) 555-0155", email="dpark@email.com", address="345 Willow Way, Pflugerville, TX", source="Thumbtack", status="Lead", notes="Deck build inquiry."),
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
            client_name=est2.client_name,
            status="Paid",
            line_items=est2.line_items,
            amount=est2.total,
            amount_paid=est2.total,
            due_date=(datetime.now(timezone.utc) - timedelta(days=5)).isoformat(),
        )
        await db.invoices.insert_one(inv2.model_dump())
    logger.info("Seed complete.")


@app.on_event("startup")
async def on_startup():
    await seed_data()
    await get_company()


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
