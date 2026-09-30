"""Financials / books HTTP routes.
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

from overhead_catalog import OVERHEAD_CATALOG, OVERHEAD_CATEGORY_RENAMES
from pricing import month_label, parse_year_month, year_month_of


def attach_financial_routes(api_router: APIRouter):
    from server import (
        OtherIncome,
        OtherIncomeCreate,
        OverheadCategory,
        OverheadCategoryCreate,
        OverheadCategoryUpdate,
        OverheadExpense,
        OverheadExpenseCreate,
        OverheadLineItem,
        OverheadLineItemCreate,
        OverheadLineItemUpdate,
        OverheadMonthValueUpdate,
        SquareStatement,
        TaxClassification,
        TaxClassificationCreate,
        TaxClassificationUpdate,
        TaxQuestion,
        TaxQuestionAnswer,
        TaxQuestionCreate,
        TaxSummary,
        User,
        assert_user_feature,
        build_jobs_profit,
        company_month_folder_name,
        db,
        gdrive,
        get_current_user,
        get_or_create_month_value,
        job_actual_costs,
        list_overhead_categories_with_expenses,
        logger,
        monthly_overhead_snapshot,
        new_id,
        now_iso,
        parse_money,
        parse_money_nonneg,
        read_drive_upload,
        save_company_drive_file,
        seed_overhead_catalog,
        year_of,
    )

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
            deposit_income_ytd = 0.0
            try:
                for dep in await db.job_deposits.find({"status": "received"}, {"_id": 0, "amount": 1, "received_at": 1, "created_at": 1}).to_list(5000):
                    if year_of(dep.get("received_at") or dep.get("created_at")) == year:
                        deposit_income_ytd += float(dep.get("amount") or 0)
            except Exception:
                logger.exception("Could not sum job deposits for financials overview")
            deposit_income_ytd = round(deposit_income_ytd, 2)
            square_status = {
                "connected": False,
                "status": "disconnected",
                "note": "Connect Square in Company Profile to collect deposits and park them in job Savings folders.",
                "unmapped_payments": 0,
            }
            try:
                from routes.job_funds import SQUARE_SETTINGS_KEY
                square_doc = await db.settings.find_one({"key": SQUARE_SETTINGS_KEY}, {"_id": 0}) or {}
                connected = bool((square_doc.get("access_token_enc") or os.environ.get("SQUARE_ACCESS_TOKEN") or "").strip())
                unmapped = 0
                try:
                    unmapped = await db.square_payments.count_documents({"job_id": {"$in": ["", None]}})
                except Exception:
                    unmapped = 0
                square_status = {
                    "connected": connected,
                    "status": "connected" if connected else "disconnected",
                    "environment": square_doc.get("environment") or os.environ.get("SQUARE_ENVIRONMENT") or "production",
                    "unmapped_payments": unmapped,
                    "note": "Job deposits park into each job’s Square Savings folder. Unmapped Square payments appear in reconciliation.",
                }
            except Exception:
                logger.exception("Could not load Square status for financials overview")
            return {
                "year": year,
                "income_ytd": income_ytd,
                "invoice_income_ytd": invoice_income_ytd,
                "other_income_ytd": other_income_ytd,
                "deposit_income_ytd": deposit_income_ytd,
                "expenses_ytd": expenses_ytd,
                "overhead_ytd": overhead_ytd,
                "job_costs_ytd": job_costs_ytd,
                "net_profit": round(income_ytd - expenses_ytd, 2),
                "outstanding": round(outstanding, 2),
                "outstanding_count": outstanding_count,
                "jobs_profit": build_jobs_profit(jobs, invoices),
                "month_overhead": await monthly_overhead_snapshot(),
                "square": square_status,
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

        for dep in await db.job_deposits.find({"status": "received"}, {"_id": 0}).to_list(8000):
            dep_year = year_of(dep.get("received_at") or dep.get("created_at"), year)
            if dep_year != year:
                continue
            key = ("deposit", dep.get("id"))
            if key in seen:
                continue
            to_insert.append(TaxClassification(
                year=year,
                source="deposit",
                source_id=dep.get("id", ""),
                job_id=dep.get("job_id", ""),
                category_name="Job deposit",
                description="Client job deposit",
                amount=float(dep.get("amount") or 0),
                date=(dep.get("received_at") or dep.get("created_at") or "")[:10],
                status="pending",
                tax_category="income",
                deductibility="nontaxable_basis",
                notes="Job-allocated client deposit. Tax AI should treat this as job income, not a deduction.",
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
        try:
            for dep in await db.job_deposits.find({"status": "received"}, {"_id": 0, "amount": 1, "received_at": 1, "created_at": 1}).to_list(8000):
                if year_of(dep.get("received_at") or dep.get("created_at")) == year:
                    income_total += float(dep.get("amount") or 0)
        except Exception:
            logger.exception("Could not include job deposits in tax income")

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
