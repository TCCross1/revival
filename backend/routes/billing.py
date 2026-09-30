"""Estimates, invoices, and contracts HTTP routes.
Attached from server.py after models and helpers exist.
"""
import base64
import json
import logging
import os
from datetime import datetime, timedelta, timezone
from html import escape
from io import BytesIO
from typing import List, Optional

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Cookie,
    Depends,
    File,
    Form,
    HTTPException,
    Request,
    Response,
    UploadFile,
)
from fastapi.responses import RedirectResponse, StreamingResponse
from pydantic import BaseModel

logger = logging.getLogger(__name__)

from email_pdf import (
    EMAIL_FROM_NAME,
    build_contract_pdf,
    build_estimate_pdf,
    build_invoice_pdf,
    money,
    send_email,
)


def attach_billing_routes(api_router: APIRouter):
    from server import (
        Contract,
        ContractUpdate,
        Estimate,
        EstimateCreate,
        Invoice,
        InvoiceCreate,
        InvoicePaymentBody,
        Job,
        LineItem,
        OWNER_EMAIL,
        PaymentMilestone,
        User,
        apply_smart_estimate_totals,
        assert_user_feature,
        compute_totals,
        db,
        estimate_pricing_for,
        get_company,
        get_current_user,
        logger,
        new_id,
        next_number,
        parse_exclusion_lines,
        push_contract_to_drive,
        push_estimate_to_drive,
        push_invoice_to_drive,
        push_job_docs_to_drive,
        resolve_client_ref,
        uses_smart_pricing,
    )

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
            f'<tr><td style="background:#0B3A8F;padding:24px 28px;font-family:Arial,sans-serif">'
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
            f'<tr style="background:#0B3A8F">'
            f'<td style="padding:8px 10px;color:#fff;font-family:Arial,sans-serif;font-size:12px;font-weight:bold">Description</td>'
            f'<td align="right" style="padding:8px 10px;color:#fff;font-family:Arial,sans-serif;font-size:12px;font-weight:bold">Qty</td>'
            f'<td align="right" style="padding:8px 10px;color:#fff;font-family:Arial,sans-serif;font-size:12px;font-weight:bold">Unit</td>'
            f'<td align="right" style="padding:8px 10px;color:#fff;font-family:Arial,sans-serif;font-size:12px;font-weight:bold">Amount</td>'
            f'</tr>{rows}</table>'
            f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td></td>'
            f'<td align="right" style="font-family:Arial,sans-serif;font-size:13px;color:#4B6370;padding:2px 10px">Subtotal: {escape(money(est.get("subtotal",0)))}</td></tr>'
            f'<tr><td></td><td align="right" style="font-family:Arial,sans-serif;font-size:13px;color:#4B6370;padding:2px 10px">Tax ({est.get("tax_rate",0)}%): {escape(money(est.get("tax_amount",0)))}</td></tr>'
            f'<tr><td></td><td align="right" style="font-family:Arial,sans-serif;font-size:17px;color:#0B3A8F;font-weight:bold;padding:6px 10px;border-top:2px solid #0B3A8F">Total: {escape(money(est.get("total",0)))}</td></tr>'
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
                f'<tr><td style="background:#0B3A8F;padding:24px 28px;font-family:Arial,sans-serif">'
                f'<div style="color:#ffffff;font-size:22px;font-weight:bold;letter-spacing:1px">REVIVAL PRO</div>'
                f'<div style="color:#C9A227;font-size:12px;margin-top:2px">Residential Remodeling</div>'
                f'</td></tr>'
                f'<tr><td style="padding:28px;font-family:Arial,sans-serif;color:#061A23">'
                f'<p style="font-size:15px;margin:0 0 12px">Hi {client_name},</p>'
                f'<p style="font-size:14px;color:#4B6370;line-height:1.5;margin:0 0 20px">'
                f'Please find invoice <strong>{escape(number)}</strong> below. '
                f'A PDF copy is attached for your records. Payment is due by <strong>{escape(due)}</strong>.</p>'
                f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:8px">'
                f'<tr style="background:#0B3A8F">'
                f'<td style="padding:8px 10px;color:#fff;font-family:Arial,sans-serif;font-size:12px;font-weight:bold">Description</td>'
                f'<td align="right" style="padding:8px 10px;color:#fff;font-family:Arial,sans-serif;font-size:12px;font-weight:bold">Qty</td>'
                f'<td align="right" style="padding:8px 10px;color:#fff;font-family:Arial,sans-serif;font-size:12px;font-weight:bold">Unit</td>'
                f'<td align="right" style="padding:8px 10px;color:#fff;font-family:Arial,sans-serif;font-size:12px;font-weight:bold">Amount</td>'
                f'</tr>{rows}</table>'
                f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td></td>'
                f'<td align="right" style="font-family:Arial,sans-serif;font-size:13px;color:#4B6370;padding:2px 10px">Amount: {escape(money(amount))}</td></tr>'
                f'<tr><td></td><td align="right" style="font-family:Arial,sans-serif;font-size:13px;color:#4B6370;padding:2px 10px">Paid: {escape(money(paid))}</td></tr>'
                f'<tr><td></td><td align="right" style="font-family:Arial,sans-serif;font-size:17px;color:#0B3A8F;font-weight:bold;padding:6px 10px;border-top:2px solid #0B3A8F">Balance due: {escape(money(balance))}</td></tr>'
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
            f'<tr><td style="background:#0B3A8F;padding:24px 28px;font-family:Arial,sans-serif">'
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
            f'<tr><td style="background:#0B3A8F;padding:24px 28px;font-family:Arial,sans-serif">'
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
            f'<tr><td style="background:#0B3A8F;padding:24px 28px;font-family:Arial,sans-serif">'
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
