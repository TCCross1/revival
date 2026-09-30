"""Jobs, expenses, sheets, and workspace HTTP routes.
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

from job_sheet import (
    coerce_category_budgets,
    compute_job_sheet_totals,
    empty_category_budgets,
    export_foundation,
    money as sheet_money,
    normalize_sheet_category,
)
from pricing import job_sheet_direct_costs, uses_smart_pricing


def attach_job_routes(api_router: APIRouter):
    from server import (
        Expense,
        ExpenseUpdate,
        JOB_SHEET_CATEGORIES,
        Job,
        JobCreate,
        JobSheetUpdate,
        User,
        _ensure_job_sheet,
        _floor_plan_summary,
        _safe_lead_phone,
        assert_user_feature,
        build_job_receipts_pdf,
        build_job_sheet_pdf,
        client_drive_payload,
        db,
        drive_upload_kind_options,
        ensure_client_drive_folder,
        gdrive,
        get_company,
        get_current_user,
        handle_client_drive_upload,
        logger,
        monthly_overhead_snapshot,
        new_id,
        next_number,
        now_iso,
        pricing_from_inputs,
        push_job_docs_to_drive,
        resolve_client_for_job,
        resolve_client_ref,
        floor_build_scope,
    )

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
                    scope = floor_build_scope(plan.get("document") or {}, plan.get("project_type") or "")
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
