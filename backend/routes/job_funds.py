"""Job Fund Engine HTTP routes: Square folders, deposits, transfers, webhooks."""
from __future__ import annotations

import base64
import hashlib
import logging
import os
import secrets
from datetime import datetime, timedelta, timezone
from html import escape
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

SQUARE_SETTINGS_KEY = "square"
SQUARE_OAUTH_KIND = "square"


class SquareCredentialsIn(BaseModel):
    access_token: str = ""
    location_id: str = ""
    application_id: str = ""
    application_secret: str = ""
    environment: str = "production"
    webhook_signature_key: str = ""
    terminal_device_id: str = ""
    checking_account_id: str = ""
    balance_account_id: str = ""


class FolderLinkIn(BaseModel):
    action: str = "create"
    folder_id: str = ""
    name: str = ""


class CollectDepositIn(BaseModel):
    amount: float
    notes: str = ""
    park: bool = True
    send_receipt: bool = True
    method: str = "terminal"
    device_id: str = ""
    idempotency_key: str = ""


class CompleteDepositIn(BaseModel):
    source_id: str = ""
    square_payment_id: str = ""


class SpendFundsIn(BaseModel):
    amount: float
    notes: str = ""


class MapPaymentIn(BaseModel):
    job_id: str
    notes: str = ""


class CreateFolderIn(BaseModel):
    name: str


def attach_job_fund_routes(api_router: APIRouter):
    from email_pdf import build_deposit_receipt_pdf, send_email
    from field_ops import job_visible_to, normalize_role
    from job_funds import (
        BANKING_UNAVAILABLE_CODE,
        BANKING_UNAVAILABLE_MESSAGE,
        DEFAULT_FOLDER_NAME_PATTERN,
        compute_job_funds,
        cents_to_dollars,
        checkout_is_complete,
        checkout_is_failed,
        dollars_to_cents,
        folder_name_from_pattern,
        money,
        net_from_square_payment,
        next_deposit_status,
        next_transfer_status,
        normalize_payment_method,
        public_audit,
        public_deposit,
        public_transfer,
        square_payment_status,
    )
    from square_client import (
        SquareClient,
        SquareClientError,
        environment_name,
        new_idempotency_key,
        oauth_authorize_url,
        oauth_exchange_code,
    )
    from square_webhook import (
        configured_signature_key,
        event_id as square_event_id,
        event_type as square_event_type,
        extract_signature,
        object_payload,
        verify_signature,
    )
    from server import (
        User,
        _encrypt_secret,
        _decrypt_secret,
        DriveCryptoError,
        assert_user_feature,
        db,
        get_company,
        get_current_user,
        maybe_save_drive_file,
        new_id,
        now_iso,
        require_admin,
    )

    def _frontend_url() -> str:
        return (os.environ.get("FRONTEND_URL") or "http://localhost:3000").rstrip("/")

    def _api_public_url() -> str:
        return (os.environ.get("PUBLIC_API_URL") or os.environ.get("API_PUBLIC_URL") or "http://localhost:8001").rstrip("/")

    async def load_square_settings() -> dict:
        try:
            doc = await db.settings.find_one({"key": SQUARE_SETTINGS_KEY}, {"_id": 0})
            return doc or {}
        except Exception:
            logger.exception("Could not load Square settings")
            return {}

    async def save_square_settings(patch: dict) -> dict:
        patch = {k: v for k, v in (patch or {}).items() if k != "key"}
        patch["updated_at"] = now_iso()
        await db.settings.update_one({"key": SQUARE_SETTINGS_KEY}, {"$set": patch, "$setOnInsert": {"key": SQUARE_SETTINGS_KEY}}, upsert=True)
        return await load_square_settings()

    def _token_from_doc(doc: dict) -> str:
        enc = (doc.get("access_token_enc") or "").strip()
        if enc:
            return _decrypt_secret(enc)
        return (os.environ.get("SQUARE_ACCESS_TOKEN") or "").strip()

    def _square_client(doc: dict | None = None) -> SquareClient:
        data = doc or {}
        token = _token_from_doc(data)
        env = data.get("environment") or os.environ.get("SQUARE_ENVIRONMENT") or "production"
        location = (data.get("location_id") or os.environ.get("SQUARE_LOCATION_ID") or "").strip()
        app_id = (data.get("application_id") or os.environ.get("SQUARE_APPLICATION_ID") or "").strip()
        return SquareClient(token, environment=env, location_id=location, application_id=app_id)

    async def square_status_payload() -> dict:
        doc = await load_square_settings()
        token = _token_from_doc(doc)
        env = environment_name(doc.get("environment") or os.environ.get("SQUARE_ENVIRONMENT") or "")
        location_id = (doc.get("location_id") or os.environ.get("SQUARE_LOCATION_ID") or "").strip()
        app_id = (doc.get("application_id") or os.environ.get("SQUARE_APPLICATION_ID") or "").strip()
        device_id = (doc.get("terminal_device_id") or os.environ.get("SQUARE_TERMINAL_DEVICE_ID") or "").strip()
        connected = bool(token)
        merchant = (doc.get("merchant_id") or "").strip()
        last_error = (doc.get("last_error") or "").strip()
        banking = doc.get("banking_available")
        unmapped = 0
        try:
            unmapped = await db.square_payments.count_documents({"job_id": {"$in": ["", None]}})
        except Exception:
            logger.exception("Could not count unmapped Square payments")
        return {
            "connected": connected,
            "status": "connected" if connected else "disconnected",
            "environment": env,
            "location_id": location_id,
            "application_id": app_id,
            "merchant_id": merchant,
            "terminal_device_id": device_id,
            "checking_account_id": (doc.get("checking_account_id") or "").strip(),
            "balance_account_id": (doc.get("balance_account_id") or "").strip(),
            "banking_available": banking if banking is not None else None,
            "last_error": last_error,
            "unmapped_payments": unmapped,
            "webhook_url": f"{_api_public_url()}/api/webhooks/square",
            "oauth_configured": bool((doc.get("application_id") or os.environ.get("SQUARE_APPLICATION_ID") or "").strip() and (doc.get("application_secret_enc") or os.environ.get("SQUARE_APPLICATION_SECRET") or "").strip()),
            "note": "Revival Pro records every job deposit, then parks the net amount in that job’s Square Savings folder.",
        }

    async def require_square_client() -> tuple[SquareClient, dict]:
        doc = await load_square_settings()
        client = _square_client(doc)
        if not client.configured():
            raise HTTPException(status_code=400, detail="Square is not connected. Add the access token in Company Profile.")
        return client, doc

    async def load_job_or_404(job_id: str, user: User) -> dict:
        job = await db.jobs.find_one({"id": job_id}, {"_id": 0})
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        if not job_visible_to(user.user_id, user.role, job):
            raise HTTPException(status_code=403, detail="That job is not assigned to you.")
        return job

    def _office_only(user: User) -> bool:
        return normalize_role(user.role) != "field"

    async def _sheet_income(job: dict) -> tuple[float, float]:
        sheet = await db.job_sheets.find_one({"job_id": job.get("id")}, {"_id": 0}) or {}
        income = money(sheet.get("income"))
        budget = money(sheet.get("budget") if sheet.get("budget") not in (None, "") else job.get("budget"))
        if income <= 0:
            income = budget
        actual = 0.0
        for exp in job.get("expenses") or []:
            if (exp.get("kind") or "actual") == "committed":
                continue
            actual += money(exp.get("amount"))
        return income, round(actual, 2)

    async def append_audit(*, kind: str, entity_id: str, job_id: str, actor_user_id: str, summary: str, before: dict | None = None, after: dict | None = None):
        row = {
            "id": new_id(),
            "kind": kind,
            "entity_id": entity_id,
            "job_id": job_id,
            "actor_user_id": actor_user_id or "",
            "created_at": now_iso(),
            "summary": summary,
            "before": before or {},
            "after": after or {},
        }
        try:
            await db.job_fund_audit.insert_one(row)
        except Exception:
            logger.exception("Job fund audit insert failed kind=%s entity_id=%s", kind, entity_id)
        return row

    async def list_job_deposits(job_id: str) -> list[dict]:
        return await db.job_deposits.find({"job_id": job_id}, {"_id": 0}).sort("created_at", -1).to_list(500)

    async def list_job_transfers(job_id: str) -> list[dict]:
        return await db.job_fund_transfers.find({"job_id": job_id}, {"_id": 0}).sort("created_at", -1).to_list(500)

    async def persist_job_financials(job: dict, summary: dict) -> None:
        try:
            await db.jobs.update_one({"id": job.get("id")}, {"$set": {
                "job_funds_total_deposits": summary.get("total_deposits") or 0,
                "job_funds_remaining_on_contract": summary.get("remaining_on_contract") or 0,
                "job_funds_folder_balance": summary.get("folder_balance") or 0,
                "job_funds_updated_at": now_iso(),
            }})
        except Exception:
            logger.exception("Could not cache job fund totals job_id=%s", job.get("id"))

    async def build_funds_payload(job: dict, *, live_balance: bool = True) -> dict:
        deposits = await list_job_deposits(job.get("id") or "")
        transfers = await list_job_transfers(job.get("id") or "")
        income, actual = await _sheet_income(job)
        folder_balance = None
        banking_error = ""
        if live_balance and (job.get("square_savings_folder_id") or "").strip():
            try:
                client, _doc = await require_square_client()
                folder = await client.get_savings_folder(job["square_savings_folder_id"])
                folder_balance = client.folder_balance_dollars(folder)
                await save_square_settings({"banking_available": True, "last_error": ""})
            except HTTPException:
                pass
            except SquareClientError as exc:
                banking_error = str(exc)
                if exc.code == BANKING_UNAVAILABLE_CODE or exc.status_code in (404, 405):
                    await save_square_settings({"banking_available": False, "last_error": banking_error})
                logger.warning("Live folder balance unavailable job_id=%s code=%s", job.get("id"), exc.code)
            except Exception:
                logger.exception("Live folder balance failed job_id=%s", job.get("id"))
        summary = compute_job_funds(
            job, deposits, transfers,
            folder_balance=folder_balance,
            income=income,
            actual_spent=actual,
        )
        await persist_job_financials(job, summary)
        status = await square_status_payload()
        company = await get_company()
        return {
            **summary,
            "square": status,
            "folder_name_pattern": company.get("job_fund_folder_name_pattern") or DEFAULT_FOLDER_NAME_PATTERN,
            "deposits": [public_deposit(d) for d in deposits],
            "transfers": [public_transfer(t) for t in transfers],
            "banking_error": banking_error,
        }

    def _classify_account(item: dict) -> str:
        blob = " ".join([
            str(item.get("type") or ""),
            str(item.get("raw_type") or ""),
            str(item.get("name") or ""),
        ]).upper()
        if "CHECKING" in blob:
            return "checking"
        if "SAVING" in blob or "FOLDER" in blob:
            return "savings"
        if "BALANCE" in blob or "PAYMENT" in blob:
            return "balance"
        return "other"

    async def refresh_banking_accounts(client: SquareClient, doc: dict) -> dict:
        patch: dict = {}
        try:
            folders = await client.list_savings_folders()
            patch["banking_available"] = True
            patch["last_error"] = ""
            if not doc.get("balance_account_id") or not doc.get("checking_account_id"):
                for item in folders:
                    kind = _classify_account(item)
                    if kind == "checking" and not doc.get("checking_account_id"):
                        patch["checking_account_id"] = item.get("id") or ""
                    if kind == "balance" and not doc.get("balance_account_id"):
                        patch["balance_account_id"] = item.get("id") or ""
            if patch:
                await save_square_settings(patch)
            return folders
        except SquareClientError as exc:
            await save_square_settings({"banking_available": False, "last_error": str(exc)})
            raise

    async def ensure_job_folder(job: dict, user: User, *, create: bool = True, folder_id: str = "", name: str = "") -> dict:
        existing_id = (folder_id or job.get("square_savings_folder_id") or "").strip()
        existing_name = (name or job.get("square_savings_folder_name") or "").strip()
        company = await get_company()
        client_doc = await db.clients.find_one({"id": job.get("client_id")}, {"_id": 0}) if job.get("client_id") else None
        display = existing_name or folder_name_from_pattern(
            company.get("job_fund_folder_name_pattern") or DEFAULT_FOLDER_NAME_PATTERN,
            job,
            client_doc,
        )
        if existing_id and existing_name:
            if existing_id != (job.get("square_savings_folder_id") or "") or display != (job.get("square_savings_folder_name") or ""):
                await db.jobs.update_one({"id": job["id"]}, {"$set": {
                    "square_savings_folder_id": existing_id,
                    "square_savings_folder_name": display,
                    "square_folder_link_status": "linked",
                }})
                job["square_savings_folder_id"] = existing_id
                job["square_savings_folder_name"] = display
                job["square_folder_link_status"] = "linked"
            return job
        if existing_id and not create:
            await db.jobs.update_one({"id": job["id"]}, {"$set": {
                "square_savings_folder_id": existing_id,
                "square_savings_folder_name": display,
                "square_folder_link_status": "linked",
            }})
            job["square_savings_folder_id"] = existing_id
            job["square_savings_folder_name"] = display
            job["square_folder_link_status"] = "linked"
            await append_audit(
                kind="folder_link", entity_id=existing_id, job_id=job["id"],
                actor_user_id=user.user_id, summary=f"Linked Square Savings folder {display}",
                after={"folder_id": existing_id, "folder_name": display},
            )
            return job
        if not create:
            return job
        square, _doc = await require_square_client()
        try:
            created = await square.create_savings_folder(name=display, idempotency_key=new_idempotency_key())
            folder_id = str(created.get("id") or "").strip()
            folder_name = str(created.get("name") or created.get("display_name") or display).strip()
            if not folder_id:
                raise SquareClientError("Square did not return a folder id.", code=BANKING_UNAVAILABLE_CODE)
            await db.jobs.update_one({"id": job["id"]}, {"$set": {
                "square_savings_folder_id": folder_id,
                "square_savings_folder_name": folder_name,
                "square_folder_link_status": "linked",
            }})
            job["square_savings_folder_id"] = folder_id
            job["square_savings_folder_name"] = folder_name
            job["square_folder_link_status"] = "linked"
            await save_square_settings({"banking_available": True, "last_error": ""})
            await append_audit(
                kind="folder_create", entity_id=folder_id, job_id=job["id"],
                actor_user_id=user.user_id, summary=f"Created Square Savings folder {folder_name}",
                after={"folder_id": folder_id, "folder_name": folder_name},
            )
            logger.info("Created Square Savings folder job_id=%s", job.get("id"))
            return job
        except SquareClientError as exc:
            await db.jobs.update_one({"id": job["id"]}, {"$set": {
                "square_savings_folder_name": display,
                "square_folder_link_status": "pending_create",
            }})
            job["square_savings_folder_name"] = display
            job["square_folder_link_status"] = "pending_create"
            await save_square_settings({"banking_available": False, "last_error": str(exc)})
            await append_audit(
                kind="folder_create", entity_id=job["id"], job_id=job["id"],
                actor_user_id=user.user_id,
                summary="Square Savings folder create is pending — Banking API unavailable",
                after={"folder_name": display, "error": str(exc)},
            )
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Could not create the Square Savings folder yet ({exc}). "
                    "Link an existing folder ID from Square Dashboard, then collect the deposit."
                ),
            )

    async def insert_transfer(
        *,
        job: dict,
        amount: float,
        direction: str,
        from_account_id: str,
        to_account_id: str,
        actor_user_id: str,
        deposit_id: str = "",
        notes: str = "",
    ) -> dict:
        row = {
            "id": new_id(),
            "job_id": job.get("id") or "",
            "deposit_id": deposit_id or "",
            "direction": direction,
            "amount": money(amount),
            "from_account_id": from_account_id or "",
            "to_account_id": to_account_id or "",
            "square_transfer_id": "",
            "status": "pending",
            "actor_user_id": actor_user_id or "",
            "created_at": now_iso(),
            "completed_at": "",
            "notes": (notes or "").strip(),
            "error_code": "",
            "error_message": "",
            "idempotency_key": new_idempotency_key(),
        }
        await db.job_fund_transfers.insert_one(row)
        await append_audit(
            kind="transfer", entity_id=row["id"], job_id=row["job_id"],
            actor_user_id=actor_user_id, summary=f"Queued {direction} transfer of {money(amount):.2f}",
            after=public_transfer(row),
        )
        return row

    async def execute_transfer(row: dict, square: SquareClient) -> dict:
        try:
            result = await square.transfer(
                from_account_id=row.get("from_account_id") or "",
                to_account_id=row.get("to_account_id") or "",
                amount_cents=dollars_to_cents(row.get("amount")),
                idempotency_key=row.get("idempotency_key") or new_idempotency_key(),
                note=row.get("notes") or "",
            )
            transfer_id = str(result.get("id") or result.get("transfer_id") or "").strip()
            status = next_transfer_status(row.get("status") or "pending", "completed")
            patch = {
                "status": status,
                "square_transfer_id": transfer_id,
                "completed_at": now_iso(),
                "error_code": "",
                "error_message": "",
            }
            await db.job_fund_transfers.update_one({"id": row["id"]}, {"$set": patch})
            row = {**row, **patch}
            await append_audit(
                kind="transfer", entity_id=row["id"], job_id=row.get("job_id") or "",
                actor_user_id=row.get("actor_user_id") or "",
                summary=f"Completed {row.get('direction')} transfer",
                after=public_transfer(row),
            )
            logger.info("Job fund transfer completed transfer_id=%s job_id=%s", row.get("id"), row.get("job_id"))
            return row
        except SquareClientError as exc:
            patch = {
                "status": next_transfer_status(row.get("status") or "pending", "failed"),
                "error_code": exc.code or BANKING_UNAVAILABLE_CODE,
                "error_message": str(exc) if exc.code != BANKING_UNAVAILABLE_CODE else BANKING_UNAVAILABLE_MESSAGE,
            }
            await db.job_fund_transfers.update_one({"id": row["id"]}, {"$set": patch})
            row = {**row, **patch}
            await append_audit(
                kind="transfer", entity_id=row["id"], job_id=row.get("job_id") or "",
                actor_user_id=row.get("actor_user_id") or "",
                summary=f"Transfer failed: {patch['error_code']}",
                after=public_transfer(row),
            )
            logger.warning("Job fund transfer failed transfer_id=%s code=%s", row.get("id"), exc.code)
            return row

    async def park_deposit(deposit: dict, job: dict, actor_user_id: str) -> dict | None:
        if not deposit.get("park", True):
            return None
        if (deposit.get("status") or "") != "received":
            return None
        if deposit.get("folder_transfer_id"):
            existing = await db.job_fund_transfers.find_one({"id": deposit.get("folder_transfer_id")}, {"_id": 0})
            return existing
        folder_id = (job.get("square_savings_folder_id") or "").strip()
        if not folder_id:
            logger.info("Skip park — no Square folder on job_id=%s deposit_id=%s", job.get("id"), deposit.get("id"))
            return None
        square_doc = await load_square_settings()
        from_id = (square_doc.get("balance_account_id") or square_doc.get("checking_account_id") or "").strip()
        amount = money(deposit.get("net_amount") if deposit.get("net_amount") not in (None, 0, 0.0, "") else deposit.get("amount"))
        if amount <= 0:
            return None
        row = await insert_transfer(
            job=job,
            amount=amount,
            direction="balance_to_folder",
            from_account_id=from_id or "SQUARE_BALANCE",
            to_account_id=folder_id,
            actor_user_id=actor_user_id,
            deposit_id=deposit.get("id") or "",
            notes=f"Park net deposit {deposit.get('id')}",
        )
        try:
            square, _doc = await require_square_client()
            if not from_id:
                try:
                    await refresh_banking_accounts(square, square_doc)
                    square_doc = await load_square_settings()
                    from_id = (square_doc.get("balance_account_id") or square_doc.get("checking_account_id") or "").strip()
                    if from_id:
                        await db.job_fund_transfers.update_one({"id": row["id"]}, {"$set": {"from_account_id": from_id}})
                        row["from_account_id"] = from_id
                except SquareClientError:
                    pass
            row = await execute_transfer(row, square)
        except HTTPException:
            patch = {"status": "failed", "error_code": "NOT_CONNECTED", "error_message": "Square is not connected."}
            await db.job_fund_transfers.update_one({"id": row["id"]}, {"$set": patch})
            row = {**row, **patch}
        await db.job_deposits.update_one({"id": deposit["id"]}, {"$set": {
            "folder_transfer_id": row.get("id") or "",
            "park_status": row.get("status") or "",
        }})
        return row

    async def issue_receipt(deposit: dict, job: dict) -> dict:
        client = await db.clients.find_one({"id": job.get("client_id")}, {"_id": 0}) if job.get("client_id") else None
        company = await get_company()
        pdf_bytes = build_deposit_receipt_pdf(deposit, job, client, company)
        drive = None
        try:
            drive = await maybe_save_drive_file(
                client or {"id": job.get("client_id") or "", "name": job.get("client_name") or ""},
                "deposit_receipt",
                deposit.get("id") or "",
                f"{job.get('job_number') or 'JOB'} Deposit Receipt.pdf",
                pdf_bytes,
                job_id=job.get("id") or "",
            )
        except Exception:
            logger.exception("Deposit receipt Drive save failed deposit_id=%s", deposit.get("id"))
        receipt_url = (drive or {}).get("web_view_link") or ""
        to = ((client or {}).get("email") or "").strip()
        emailed = False
        if deposit.get("send_receipt") and to:
            html = (
                f"<p>Hi {escape((client or {}).get('name') or 'there')},</p>"
                f"<p>We received your deposit of <strong>${money(deposit.get('amount')):.2f}</strong> "
                f"for {escape(job.get('name') or 'your project')} ({escape(job.get('job_number') or '')}).</p>"
                "<p>A PDF receipt is attached. Thank you for trusting Revival Home Remodeling.</p>"
            )
            try:
                await send_email(
                    to=to,
                    subject=f"Deposit receipt — {job.get('job_number') or 'your job'}",
                    html=html,
                    attachments=[{
                        "filename": f"{job.get('job_number') or 'JOB'} Deposit Receipt.pdf",
                        "content": base64.b64encode(pdf_bytes).decode("ascii"),
                    }],
                )
                emailed = True
            except HTTPException:
                logger.warning("Deposit receipt email failed deposit_id=%s", deposit.get("id"))
            except Exception:
                logger.exception("Deposit receipt email failed deposit_id=%s", deposit.get("id"))
        patch = {
            "receipt_url": receipt_url,
            "receipt_drive_file_id": (drive or {}).get("google_drive_file_id") or "",
            "receipt_emailed": emailed,
        }
        await db.job_deposits.update_one({"id": deposit["id"]}, {"$set": patch})
        return {**deposit, **patch}

    async def mark_deposit_from_payment(deposit: dict, payment: dict, actor_user_id: str = "square-webhook") -> dict:
        if not deposit:
            return deposit
        current = deposit.get("status") or "pending"
        mapped = square_payment_status(payment)
        next_status = next_deposit_status(current, mapped)
        gross = cents_to_dollars((payment.get("amount_money") or {}).get("amount")) or money(deposit.get("amount"))
        net = net_from_square_payment(payment, gross)
        receipt_url = payment.get("receipt_url") or deposit.get("receipt_url") or ""
        method = deposit.get("payment_method") or "card_reader"
        source = str(payment.get("source_type") or "").upper()
        if "CARD" in source and payment.get("card_details", {}).get("entry_method") == "KEYED":
            method = "card_keyed"
        patch = {
            "status": next_status,
            "amount": gross,
            "net_amount": net,
            "square_payment_id": payment.get("id") or deposit.get("square_payment_id") or "",
            "receipt_url": receipt_url,
            "payment_method": normalize_payment_method(method),
        }
        if next_status == "received" and not deposit.get("received_at"):
            patch["received_at"] = now_iso()
        if next_status == "failed":
            patch["error_message"] = "Square did not complete this payment."
        await db.job_deposits.update_one({"id": deposit["id"]}, {"$set": patch})
        fresh = await db.job_deposits.find_one({"id": deposit["id"]}, {"_id": 0})
        await append_audit(
            kind="deposit", entity_id=deposit["id"], job_id=deposit.get("job_id") or "",
            actor_user_id=actor_user_id,
            summary=f"Deposit {next_status}",
            before={"status": current},
            after=public_deposit(fresh),
        )
        logger.info("Deposit %s job_id=%s status=%s", deposit.get("id"), deposit.get("job_id"), next_status)
        return fresh

    async def upsert_square_payment(payment: dict, *, job_id: str = "", deposit_id: str = "") -> None:
        pid = str((payment or {}).get("id") or "").strip()
        if not pid:
            return
        amount = cents_to_dollars((payment.get("amount_money") or {}).get("amount"))
        row = {
            "id": pid,
            "square_payment_id": pid,
            "status": payment.get("status") or "",
            "amount": amount,
            "net_amount": net_from_square_payment(payment, amount),
            "source_type": payment.get("source_type") or "",
            "receipt_url": payment.get("receipt_url") or "",
            "created_at": payment.get("created_at") or now_iso(),
            "updated_at": now_iso(),
            "location_id": payment.get("location_id") or "",
            "reference_id": payment.get("reference_id") or "",
            "job_id": job_id or "",
            "deposit_id": deposit_id or "",
        }
        existing = await db.square_payments.find_one({"square_payment_id": pid}, {"_id": 0})
        if existing:
            keep_job = existing.get("job_id") or job_id
            keep_dep = existing.get("deposit_id") or deposit_id
            row["job_id"] = keep_job
            row["deposit_id"] = keep_dep
        await db.square_payments.update_one({"square_payment_id": pid}, {"$set": row}, upsert=True)

    async def finish_received_deposit(deposit: dict, actor_user_id: str) -> dict:
        if (deposit.get("status") or "") != "received":
            return deposit
        job = await db.jobs.find_one({"id": deposit.get("job_id")}, {"_id": 0})
        if not job:
            return deposit
        income, actual = await _sheet_income(job)
        summary = compute_job_funds(job, await list_job_deposits(job["id"]), await list_job_transfers(job["id"]), income=income, actual_spent=actual)
        await persist_job_financials(job, summary)
        try:
            await park_deposit(deposit, job, actor_user_id)
        except Exception:
            logger.exception("Park deposit failed deposit_id=%s", deposit.get("id"))
        try:
            if deposit.get("send_receipt") and not deposit.get("receipt_drive_file_id"):
                await issue_receipt(deposit, job)
        except Exception:
            logger.exception("Issue deposit receipt failed deposit_id=%s", deposit.get("id"))
        return await db.job_deposits.find_one({"id": deposit["id"]}, {"_id": 0}) or deposit

    @api_router.get("/square/status")
    async def square_status(user: User = Depends(get_current_user)):
        try:
            await assert_user_feature(user, "settings")
            return await square_status_payload()
        except HTTPException:
            raise
        except Exception:
            logger.exception("Square status failed")
            raise HTTPException(status_code=500, detail="Could not check Square. Please try again.")

    @api_router.post("/square/credentials")
    async def save_square_credentials(body: SquareCredentialsIn, admin: User = Depends(require_admin)):
        try:
            token = (body.access_token or "").strip()
            secret = (body.application_secret or "").strip()
            webhook_key = (body.webhook_signature_key or "").strip()
            patch = {
                "location_id": (body.location_id or "").strip(),
                "application_id": (body.application_id or "").strip(),
                "environment": environment_name(body.environment),
                "terminal_device_id": (body.terminal_device_id or "").strip(),
                "checking_account_id": (body.checking_account_id or "").strip(),
                "balance_account_id": (body.balance_account_id or "").strip(),
                "last_error": "",
            }
            try:
                if token:
                    patch["access_token_enc"] = _encrypt_secret(token)
                    patch["connected_at"] = now_iso()
                    patch["connected_by"] = admin.user_id
                if secret:
                    patch["application_secret_enc"] = _encrypt_secret(secret)
                if webhook_key:
                    patch["webhook_signature_key_enc"] = _encrypt_secret(webhook_key)
            except DriveCryptoError:
                raise HTTPException(status_code=500, detail="Server is missing JWT_SECRET, so Square secrets cannot be stored.")
            await save_square_settings(patch)
            logger.info("Saved Square credentials user=%s", admin.user_id)
            if token:
                client = _square_client(await load_square_settings())
                try:
                    locations = await client.list_locations()
                    if locations and not patch.get("location_id"):
                        await save_square_settings({"location_id": locations[0].get("id") or ""})
                    merchant = (locations[0] or {}).get("merchant_id") if locations else ""
                    if merchant:
                        await save_square_settings({"merchant_id": merchant})
                except SquareClientError as exc:
                    await save_square_settings({"last_error": str(exc)})
                    logger.warning("Square credential probe failed code=%s", exc.code)
            return await square_status_payload()
        except HTTPException:
            raise
        except Exception:
            logger.exception("Saving Square credentials failed")
            raise HTTPException(status_code=500, detail="Could not save Square credentials. Please try again.")

    @api_router.post("/square/disconnect")
    async def disconnect_square(admin: User = Depends(require_admin)):
        try:
            await save_square_settings({
                "access_token_enc": "",
                "last_error": "",
                "connected_at": "",
                "merchant_id": "",
            })
            logger.info("Disconnected Square user=%s", admin.user_id)
            return await square_status_payload()
        except Exception:
            logger.exception("Disconnect Square failed")
            raise HTTPException(status_code=500, detail="Could not disconnect Square. Please try again.")

    @api_router.get("/square/connect")
    async def square_connect(admin: User = Depends(require_admin)):
        try:
            doc = await load_square_settings()
            client_id = (doc.get("application_id") or os.environ.get("SQUARE_APPLICATION_ID") or "").strip()
            if not client_id:
                raise HTTPException(status_code=400, detail="Save the Square Application ID in Company Profile first.")
            state = secrets.token_urlsafe(32)
            redirect_uri = f"{_api_public_url()}/api/square/callback"
            cutoff = (datetime.now(timezone.utc) - timedelta(minutes=20)).isoformat()
            try:
                await db.oauth_states.delete_many({"kind": SQUARE_OAUTH_KIND, "created_at": {"$lt": cutoff}})
            except Exception:
                logger.exception("Could not prune Square OAuth states")
            await db.oauth_states.insert_one({
                "kind": SQUARE_OAUTH_KIND,
                "state": state,
                "created_at": now_iso(),
                "user_id": admin.user_id,
            })
            env = environment_name(doc.get("environment") or "")
            url = oauth_authorize_url(client_id=client_id, redirect_uri=redirect_uri, state=state, environment=env)
            return {"auth_url": url, "redirect_uri": redirect_uri}
        except HTTPException:
            raise
        except Exception:
            logger.exception("Square OAuth start failed")
            raise HTTPException(status_code=500, detail="Could not start Square sign-in. Please try again.")

    @api_router.get("/square/callback")
    async def square_callback(request: Request):
        from fastapi.responses import RedirectResponse
        flag = "error"
        why = "unknown"
        try:
            params = dict(request.query_params)
            state = (params.get("state") or "").strip()
            code = (params.get("code") or "").strip()
            if not state or not code:
                why = "state"
                raise HTTPException(status_code=400, detail="Missing Square OAuth state.")
            stored = await db.oauth_states.find_one({"kind": SQUARE_OAUTH_KIND, "state": state})
            if not stored:
                why = "expired"
                raise HTTPException(status_code=400, detail="Square sign-in expired.")
            await db.oauth_states.delete_one({"kind": SQUARE_OAUTH_KIND, "state": state})
            doc = await load_square_settings()
            client_id = (doc.get("application_id") or os.environ.get("SQUARE_APPLICATION_ID") or "").strip()
            secret = _decrypt_secret(doc.get("application_secret_enc") or "") or (os.environ.get("SQUARE_APPLICATION_SECRET") or "").strip()
            if not client_id or not secret:
                why = "token"
                raise HTTPException(status_code=400, detail="Square application secret is missing.")
            tokens = await oauth_exchange_code(
                client_id=client_id,
                client_secret=secret,
                code=code,
                redirect_uri=f"{_api_public_url()}/api/square/callback",
                environment=doc.get("environment") or "",
            )
            access = (tokens.get("access_token") or "").strip()
            if not access:
                why = "token"
                raise HTTPException(status_code=400, detail="Square did not return an access token.")
            patch = {
                "access_token_enc": _encrypt_secret(access),
                "merchant_id": tokens.get("merchant_id") or "",
                "connected_at": now_iso(),
                "last_error": "",
            }
            refresh = (tokens.get("refresh_token") or "").strip()
            if refresh:
                patch["refresh_token_enc"] = _encrypt_secret(refresh)
            await save_square_settings(patch)
            flag = "connected"
            why = ""
            logger.info("Square OAuth connected merchant=%s", patch.get("merchant_id") or "-")
        except HTTPException:
            logger.warning("Square OAuth callback rejected why=%s", why)
        except Exception:
            logger.exception("Square OAuth callback failed")
        dest = f"{_frontend_url()}/settings?square={flag}"
        if why:
            dest += f"&why={why}"
        return RedirectResponse(dest, status_code=302)

    @api_router.get("/square/folders")
    async def list_square_folders(user: User = Depends(get_current_user)):
        try:
            await assert_user_feature(user, "jobs")
            square, doc = await require_square_client()
            try:
                folders = await refresh_banking_accounts(square, doc)
            except SquareClientError as exc:
                raise HTTPException(status_code=409, detail=str(exc) if exc.code != BANKING_UNAVAILABLE_CODE else BANKING_UNAVAILABLE_MESSAGE)
            return {"folders": folders, "square": await square_status_payload()}
        except HTTPException:
            raise
        except Exception:
            logger.exception("List Square folders failed")
            raise HTTPException(status_code=500, detail="Could not list Square Savings folders. Please try again.")

    @api_router.post("/square/folders")
    async def create_square_folder(body: CreateFolderIn, user: User = Depends(get_current_user)):
        try:
            await assert_user_feature(user, "jobs")
            if not _office_only(user):
                raise HTTPException(status_code=403, detail="Field crew cannot create Square Savings folders.")
            name = (body.name or "").strip()
            if not name:
                raise HTTPException(status_code=400, detail="Folder name is required.")
            square, _doc = await require_square_client()
            try:
                created = await square.create_savings_folder(name=name, idempotency_key=new_idempotency_key())
            except SquareClientError as exc:
                raise HTTPException(status_code=409, detail=str(exc))
            logger.info("Created Square folder user=%s", user.user_id)
            return created
        except HTTPException:
            raise
        except Exception:
            logger.exception("Create Square folder failed")
            raise HTTPException(status_code=500, detail="Could not create the Square Savings folder. Please try again.")

    @api_router.get("/jobs/{job_id}/funds")
    async def get_job_funds(job_id: str, user: User = Depends(get_current_user)):
        try:
            await assert_user_feature(user, "jobs")
            job = await load_job_or_404(job_id, user)
            return await build_funds_payload(job)
        except HTTPException:
            raise
        except Exception:
            logger.exception("Get job funds failed job_id=%s", job_id)
            raise HTTPException(status_code=500, detail="Could not load job funds. Please try again.")

    @api_router.post("/jobs/{job_id}/funds/folder")
    async def link_job_folder(job_id: str, body: FolderLinkIn, user: User = Depends(get_current_user)):
        try:
            await assert_user_feature(user, "jobs")
            if not _office_only(user):
                raise HTTPException(status_code=403, detail="Field crew cannot change the job’s Square Savings folder.")
            job = await load_job_or_404(job_id, user)
            action = (body.action or "create").strip().lower()
            if action == "link":
                folder_id = (body.folder_id or "").strip()
                if not folder_id:
                    raise HTTPException(status_code=400, detail="Paste the Square Savings folder ID to link.")
                job = await ensure_job_folder(job, user, create=False, folder_id=folder_id, name=(body.name or "").strip())
            else:
                try:
                    job = await ensure_job_folder(job, user, create=True, name=(body.name or "").strip())
                except HTTPException:
                    raise
            return await build_funds_payload(await db.jobs.find_one({"id": job_id}, {"_id": 0}))
        except HTTPException:
            raise
        except Exception:
            logger.exception("Link job folder failed job_id=%s", job_id)
            raise HTTPException(status_code=500, detail="Could not link the Square Savings folder. Please try again.")

    @api_router.post("/jobs/{job_id}/deposits/collect")
    async def collect_deposit(job_id: str, body: CollectDepositIn, background: BackgroundTasks, user: User = Depends(get_current_user)):
        try:
            await assert_user_feature(user, "jobs")
            job = await load_job_or_404(job_id, user)
            amount = money(body.amount)
            if amount <= 0:
                raise HTTPException(status_code=400, detail="Enter a deposit amount greater than zero.")
            square, square_doc = await require_square_client()
            method = (body.method or "terminal").strip().lower()
            if method not in ("terminal", "payment_link", "native"):
                method = "terminal"
            deposit_id = new_id()
            idem = (body.idempotency_key or "").strip() or new_idempotency_key()
            existing = await db.job_deposits.find_one({"idempotency_key": idem}, {"_id": 0})
            if existing:
                return {
                    "deposit": public_deposit(existing),
                    "checkout": {"id": existing.get("square_checkout_id") or "", "url": existing.get("checkout_url") or ""},
                    "native": (existing.get("payment_method") or "") == "card_reader" and not existing.get("square_checkout_id"),
                    "funds": await build_funds_payload(job, live_balance=False),
                }
            payment_method = "card_reader" if method in ("terminal", "native") else "payment_link"
            deposit = {
                "id": deposit_id,
                "job_id": job_id,
                "client_id": job.get("client_id") or "",
                "amount": amount,
                "net_amount": 0.0,
                "square_checkout_id": "",
                "payment_method": payment_method,
                "status": "pending",
                "created_at": now_iso(),
                "received_at": "",
                "folder_transfer_id": "",
                "notes": (body.notes or "").strip(),
                "receipt_url": "",
                "receipt_drive_file_id": "",
                "park": bool(body.park),
                "send_receipt": bool(body.send_receipt),
                "idempotency_key": idem,
                "checkout_url": "",
                "error_message": "",
                "actor_user_id": user.user_id,
            }
            await db.job_deposits.insert_one(deposit)
            await append_audit(
                kind="deposit", entity_id=deposit_id, job_id=job_id,
                actor_user_id=user.user_id, summary=f"Started deposit collection of {amount:.2f}",
                after=public_deposit(deposit),
            )
            checkout: dict = {}
            native = False
            if method == "native":
                native = True
            elif method == "payment_link":
                try:
                    link = await square.create_payment_link(
                        amount_cents=dollars_to_cents(amount),
                        idempotency_key=new_idempotency_key(),
                        name=f"{job.get('job_number') or 'JOB'} deposit",
                        reference_id=deposit_id,
                        redirect_url=f"{_frontend_url()}/jobs/{job_id}?room=money&deposit={deposit_id}",
                    )
                    checkout = {
                        "id": link.get("id") or "",
                        "url": link.get("url") or link.get("long_url") or "",
                    }
                    await db.job_deposits.update_one({"id": deposit_id}, {"$set": {
                        "square_checkout_id": checkout.get("id") or "",
                        "checkout_url": checkout.get("url") or "",
                    }})
                    deposit["square_checkout_id"] = checkout.get("id") or ""
                    deposit["checkout_url"] = checkout.get("url") or ""
                except SquareClientError as exc:
                    await db.job_deposits.update_one({"id": deposit_id}, {"$set": {
                        "status": "failed",
                        "error_message": str(exc),
                    }})
                    raise HTTPException(status_code=409, detail=f"Could not create a Square payment link. {exc}")
            else:
                device_id = (body.device_id or square_doc.get("terminal_device_id") or os.environ.get("SQUARE_TERMINAL_DEVICE_ID") or "").strip()
                if not device_id:
                    logger.info("No Terminal device — falling back to payment link job_id=%s", job_id)
                    try:
                        link = await square.create_payment_link(
                            amount_cents=dollars_to_cents(amount),
                            idempotency_key=new_idempotency_key(),
                            name=f"{job.get('job_number') or 'JOB'} deposit",
                            reference_id=deposit_id,
                            redirect_url=f"{_frontend_url()}/jobs/{job_id}?room=money&deposit={deposit_id}",
                        )
                        checkout = {
                            "id": link.get("id") or "",
                            "url": link.get("url") or link.get("long_url") or "",
                            "fallback": "payment_link",
                        }
                        await db.job_deposits.update_one({"id": deposit_id}, {"$set": {
                            "square_checkout_id": checkout.get("id") or "",
                            "checkout_url": checkout.get("url") or "",
                            "payment_method": "payment_link",
                        }})
                        deposit["payment_method"] = "payment_link"
                        deposit["checkout_url"] = checkout.get("url") or ""
                    except SquareClientError as exc:
                        await db.job_deposits.update_one({"id": deposit_id}, {"$set": {
                            "status": "failed",
                            "error_message": str(exc),
                        }})
                        raise HTTPException(
                            status_code=409,
                            detail=(
                                "No Square Reader / Terminal device is configured, and a payment link could not be created. "
                                f"{exc}"
                            ),
                        )
                else:
                    try:
                        created = await square.create_terminal_checkout(
                            amount_cents=dollars_to_cents(amount),
                            idempotency_key=new_idempotency_key(),
                            device_id=device_id,
                            reference_id=deposit_id,
                            note=f"{job.get('job_number') or 'JOB'} deposit",
                        )
                        checkout = {
                            "id": created.get("id") or "",
                            "status": created.get("status") or "PENDING",
                            "device_id": device_id,
                        }
                        await db.job_deposits.update_one({"id": deposit_id}, {"$set": {
                            "square_checkout_id": checkout.get("id") or "",
                        }})
                        deposit["square_checkout_id"] = checkout.get("id") or ""
                    except SquareClientError as exc:
                        await db.job_deposits.update_one({"id": deposit_id}, {"$set": {
                            "status": "failed",
                            "error_message": str(exc),
                        }})
                        raise HTTPException(status_code=409, detail=f"Square Reader / Terminal checkout failed. {exc}")
            logger.info("Collect deposit started deposit_id=%s job_id=%s method=%s user=%s", deposit_id, job_id, method, user.user_id)
            return {
                "deposit": public_deposit(deposit),
                "checkout": checkout,
                "native": native,
                "funds": await build_funds_payload(job, live_balance=False),
            }
        except HTTPException:
            raise
        except Exception:
            logger.exception("Collect deposit failed job_id=%s", job_id)
            raise HTTPException(status_code=500, detail="Could not start deposit collection. Please try again.")

    @api_router.get("/jobs/{job_id}/deposits/{deposit_id}")
    async def get_deposit(job_id: str, deposit_id: str, user: User = Depends(get_current_user)):
        try:
            await assert_user_feature(user, "jobs")
            await load_job_or_404(job_id, user)
            deposit = await db.job_deposits.find_one({"id": deposit_id, "job_id": job_id}, {"_id": 0})
            if not deposit:
                raise HTTPException(status_code=404, detail="Deposit not found")
            transfer = None
            if deposit.get("folder_transfer_id"):
                transfer = await db.job_fund_transfers.find_one({"id": deposit["folder_transfer_id"]}, {"_id": 0})
            return {
                "deposit": public_deposit(deposit),
                "transfer": public_transfer(transfer) if transfer else None,
            }
        except HTTPException:
            raise
        except Exception:
            logger.exception("Get deposit failed deposit_id=%s", deposit_id)
            raise HTTPException(status_code=500, detail="Could not load that deposit. Please try again.")

    @api_router.post("/jobs/{job_id}/deposits/{deposit_id}/complete")
    async def complete_deposit(job_id: str, deposit_id: str, body: CompleteDepositIn, background: BackgroundTasks, user: User = Depends(get_current_user)):
        try:
            await assert_user_feature(user, "jobs")
            job = await load_job_or_404(job_id, user)
            deposit = await db.job_deposits.find_one({"id": deposit_id, "job_id": job_id}, {"_id": 0})
            if not deposit:
                raise HTTPException(status_code=404, detail="Deposit not found")
            if (deposit.get("status") or "") == "received":
                return {"deposit": public_deposit(deposit), "already_complete": True}
            square, _doc = await require_square_client()
            payment = {}
            source_id = (body.source_id or "").strip()
            payment_id = (body.square_payment_id or "").strip()
            try:
                if source_id:
                    payment = await square.create_payment(
                        source_id=source_id,
                        amount_cents=dollars_to_cents(deposit.get("amount")),
                        idempotency_key=deposit.get("idempotency_key") or new_idempotency_key(),
                        reference_id=deposit_id,
                        note=f"{job.get('job_number') or 'JOB'} deposit",
                    )
                elif payment_id:
                    payment = await square.get_payment(payment_id)
                elif deposit.get("square_checkout_id"):
                    checkout = await square.get_terminal_checkout(deposit["square_checkout_id"])
                    payment_ids = checkout.get("payment_ids") or []
                    if payment_ids:
                        payment = await square.get_payment(payment_ids[0])
                    elif checkout_is_failed(checkout):
                        await db.job_deposits.update_one({"id": deposit_id}, {"$set": {
                            "status": next_deposit_status(deposit.get("status"), "failed"),
                            "error_message": "The Square Reader checkout was canceled.",
                        }})
                        deposit = await db.job_deposits.find_one({"id": deposit_id}, {"_id": 0})
                        return {"deposit": public_deposit(deposit)}
                    elif not checkout_is_complete(checkout):
                        return {"deposit": public_deposit(deposit), "checkout": {"status": checkout.get("status")}}
                else:
                    raise HTTPException(status_code=400, detail="Provide the Square payment id or Reader nonce to complete this deposit.")
            except SquareClientError as exc:
                raise HTTPException(status_code=409, detail=f"Square could not complete this payment. {exc}")
            if not payment:
                raise HTTPException(status_code=409, detail="Square has not finished this payment yet.")
            deposit = await mark_deposit_from_payment(deposit, payment, actor_user_id=user.user_id)
            await upsert_square_payment(payment, job_id=job_id, deposit_id=deposit_id)
            if (deposit.get("status") or "") == "received":
                background.add_task(_safe_finish, deposit, user.user_id)
            return {"deposit": public_deposit(deposit)}
        except HTTPException:
            raise
        except Exception:
            logger.exception("Complete deposit failed deposit_id=%s", deposit_id)
            raise HTTPException(status_code=500, detail="Could not complete that deposit. Please try again.")

    async def _safe_finish(deposit: dict, actor_user_id: str):
        try:
            await finish_received_deposit(deposit, actor_user_id)
        except Exception:
            logger.exception("Background deposit finish failed deposit_id=%s", (deposit or {}).get("id"))

    @api_router.post("/jobs/{job_id}/deposits/{deposit_id}/park")
    async def retry_park(job_id: str, deposit_id: str, user: User = Depends(get_current_user)):
        try:
            await assert_user_feature(user, "jobs")
            job = await load_job_or_404(job_id, user)
            deposit = await db.job_deposits.find_one({"id": deposit_id, "job_id": job_id}, {"_id": 0})
            if not deposit:
                raise HTTPException(status_code=404, detail="Deposit not found")
            if (deposit.get("status") or "") != "received":
                raise HTTPException(status_code=409, detail="Only received deposits can be parked in the Savings folder.")
            await db.job_deposits.update_one({"id": deposit_id}, {"$set": {"folder_transfer_id": "", "park": True}})
            deposit["folder_transfer_id"] = ""
            deposit["park"] = True
            transfer = await park_deposit(deposit, job, user.user_id)
            return {
                "deposit": public_deposit(await db.job_deposits.find_one({"id": deposit_id}, {"_id": 0})),
                "transfer": public_transfer(transfer) if transfer else None,
                "funds": await build_funds_payload(job),
            }
        except HTTPException:
            raise
        except Exception:
            logger.exception("Retry park failed deposit_id=%s", deposit_id)
            raise HTTPException(status_code=500, detail="Could not park that deposit. Please try again.")

    @api_router.post("/jobs/{job_id}/deposits/{deposit_id}/receipt")
    async def send_deposit_receipt(job_id: str, deposit_id: str, user: User = Depends(get_current_user)):
        try:
            await assert_user_feature(user, "jobs")
            job = await load_job_or_404(job_id, user)
            deposit = await db.job_deposits.find_one({"id": deposit_id, "job_id": job_id}, {"_id": 0})
            if not deposit:
                raise HTTPException(status_code=404, detail="Deposit not found")
            if (deposit.get("status") or "") != "received":
                raise HTTPException(status_code=409, detail="Send a receipt after the deposit is received.")
            deposit["send_receipt"] = True
            updated = await issue_receipt(deposit, job)
            return {"deposit": public_deposit(updated)}
        except HTTPException:
            raise
        except Exception:
            logger.exception("Send deposit receipt failed deposit_id=%s", deposit_id)
            raise HTTPException(status_code=500, detail="Could not send the deposit receipt. Please try again.")

    @api_router.post("/jobs/{job_id}/funds/spend")
    async def spend_from_job_funds(job_id: str, body: SpendFundsIn, user: User = Depends(get_current_user)):
        try:
            await assert_user_feature(user, "jobs")
            if not _office_only(user):
                raise HTTPException(status_code=403, detail="Field crew cannot move job funds into Square Checking.")
            job = await load_job_or_404(job_id, user)
            amount = money(body.amount)
            if amount <= 0:
                raise HTTPException(status_code=400, detail="Enter an amount greater than zero.")
            folder_id = (job.get("square_savings_folder_id") or "").strip()
            if not folder_id:
                raise HTTPException(status_code=409, detail="Link a Square Savings folder to this job before spending from its funds.")
            square, square_doc = await require_square_client()
            to_id = (square_doc.get("checking_account_id") or "").strip()
            if not to_id:
                try:
                    await refresh_banking_accounts(square, square_doc)
                    square_doc = await load_square_settings()
                    to_id = (square_doc.get("checking_account_id") or "").strip()
                except SquareClientError:
                    to_id = ""
            if not to_id:
                to_id = "SQUARE_CHECKING"
            row = await insert_transfer(
                job=job,
                amount=amount,
                direction="folder_to_checking",
                from_account_id=folder_id,
                to_account_id=to_id,
                actor_user_id=user.user_id,
                notes=(body.notes or "").strip() or "Spend from job funds — move to Square Checking first",
            )
            row = await execute_transfer(row, square)
            if (row.get("status") or "") == "failed":
                raise HTTPException(
                    status_code=409,
                    detail=row.get("error_message") or "Could not transfer from the job folder into Square Checking.",
                )
            logger.info("Spend from job funds transfer_id=%s job_id=%s user=%s", row.get("id"), job_id, user.user_id)
            return {
                "transfer": public_transfer(row),
                "funds": await build_funds_payload(await db.jobs.find_one({"id": job_id}, {"_id": 0})),
            }
        except HTTPException:
            raise
        except Exception:
            logger.exception("Spend from job funds failed job_id=%s", job_id)
            raise HTTPException(status_code=500, detail="Could not move funds into Square Checking. Please try again.")

    @api_router.get("/jobs/{job_id}/funds/audit")
    async def job_fund_audit(job_id: str, user: User = Depends(get_current_user)):
        try:
            await assert_user_feature(user, "jobs")
            await load_job_or_404(job_id, user)
            rows = await db.job_fund_audit.find({"job_id": job_id}, {"_id": 0}).sort("created_at", -1).to_list(500)
            return [public_audit(r) for r in rows]
        except HTTPException:
            raise
        except Exception:
            logger.exception("Job fund audit failed job_id=%s", job_id)
            raise HTTPException(status_code=500, detail="Could not load the job fund audit log. Please try again.")

    @api_router.get("/financials/square/reconciliation")
    async def square_reconciliation(user: User = Depends(get_current_user)):
        try:
            await assert_user_feature(user, "financials")
            square = None
            try:
                square, _doc = await require_square_client()
            except HTTPException:
                square = None
            if square:
                try:
                    begin = (datetime.now(timezone.utc) - timedelta(days=45)).strftime("%Y-%m-%dT%H:%M:%SZ")
                    payload = await square.list_payments(begin_time=begin, limit=100)
                    for payment in payload.get("payments") or []:
                        pid = payment.get("id") or ""
                        existing = await db.square_payments.find_one({"square_payment_id": pid}, {"_id": 0})
                        deposit = await db.job_deposits.find_one({"square_payment_id": pid}, {"_id": 0}) if pid else None
                        await upsert_square_payment(
                            payment,
                            job_id=(deposit or existing or {}).get("job_id") or "",
                            deposit_id=(deposit or existing or {}).get("id") or (deposit or {}).get("id") or "",
                        )
                except SquareClientError as exc:
                    logger.warning("Square payment list for recon failed code=%s", exc.code)
            payments = await db.square_payments.find({}, {"_id": 0}).sort("created_at", -1).to_list(400)
            jobs = {j["id"]: j for j in await db.jobs.find({}, {"_id": 0, "id": 1, "name": 1, "job_number": 1, "client_name": 1}).to_list(2000)}
            mapped, unmapped = [], []
            for row in payments:
                job = jobs.get(row.get("job_id") or "")
                item = {
                    **row,
                    "job_number": (job or {}).get("job_number") or "",
                    "job_name": (job or {}).get("name") or "",
                    "client_name": (job or {}).get("client_name") or "",
                    "mapped": bool(row.get("job_id")),
                }
                (mapped if item["mapped"] else unmapped).append(item)
            status = await square_status_payload()
            return {
                "square": status,
                "mapped": mapped,
                "unmapped": unmapped,
                "mapped_count": len(mapped),
                "unmapped_count": len(unmapped),
            }
        except HTTPException:
            raise
        except Exception:
            logger.exception("Square reconciliation failed")
            raise HTTPException(status_code=500, detail="Could not load Square reconciliation. Please try again.")

    @api_router.post("/financials/square/reconciliation/{payment_id}/map")
    async def map_square_payment(payment_id: str, body: MapPaymentIn, user: User = Depends(get_current_user)):
        try:
            await assert_user_feature(user, "financials")
            job = await db.jobs.find_one({"id": body.job_id}, {"_id": 0})
            if not job:
                raise HTTPException(status_code=404, detail="Job not found")
            payment = await db.square_payments.find_one({"square_payment_id": payment_id}, {"_id": 0})
            if not payment:
                square, _doc = await require_square_client()
                try:
                    fetched = await square.get_payment(payment_id)
                except SquareClientError as exc:
                    raise HTTPException(status_code=404, detail=f"Square payment not found. {exc}")
                await upsert_square_payment(fetched, job_id=job["id"])
                payment = await db.square_payments.find_one({"square_payment_id": payment_id}, {"_id": 0})
            existing = await db.job_deposits.find_one({"square_payment_id": payment_id}, {"_id": 0})
            if existing:
                await db.job_deposits.update_one({"id": existing["id"]}, {"$set": {"job_id": job["id"], "notes": (body.notes or existing.get("notes") or "").strip()}})
                deposit = await db.job_deposits.find_one({"id": existing["id"]}, {"_id": 0})
            else:
                deposit = {
                    "id": new_id(),
                    "job_id": job["id"],
                    "client_id": job.get("client_id") or "",
                    "amount": money(payment.get("amount")),
                    "net_amount": money(payment.get("net_amount")),
                    "square_payment_id": payment_id,
                    "square_checkout_id": "",
                    "payment_method": "other",
                    "status": "received" if str(payment.get("status") or "").upper() in ("COMPLETED", "APPROVED") else "pending",
                    "created_at": now_iso(),
                    "received_at": now_iso(),
                    "folder_transfer_id": "",
                    "notes": (body.notes or "Mapped from Square reconciliation").strip(),
                    "receipt_url": payment.get("receipt_url") or "",
                    "receipt_drive_file_id": "",
                    "park": True,
                    "send_receipt": False,
                    "idempotency_key": f"map-{payment_id}",
                    "actor_user_id": user.user_id,
                }
                await db.job_deposits.insert_one(deposit)
            await db.square_payments.update_one({"square_payment_id": payment_id}, {"$set": {
                "job_id": job["id"],
                "deposit_id": deposit.get("id") or "",
            }})
            await append_audit(
                kind="reconciliation", entity_id=payment_id, job_id=job["id"],
                actor_user_id=user.user_id, summary="Mapped Square payment to job",
                after={"payment_id": payment_id, "deposit_id": deposit.get("id")},
            )
            if (deposit.get("status") or "") == "received":
                await finish_received_deposit(deposit, user.user_id)
            logger.info("Mapped Square payment payment_id=%s job_id=%s user=%s", payment_id, job["id"], user.user_id)
            return {"deposit": public_deposit(await db.job_deposits.find_one({"id": deposit["id"]}, {"_id": 0})), "job_id": job["id"]}
        except HTTPException:
            raise
        except Exception:
            logger.exception("Map Square payment failed payment_id=%s", payment_id)
            raise HTTPException(status_code=500, detail="Could not map that Square payment to a job. Please try again.")

    @api_router.post("/webhooks/square")
    @api_router.post("/webhooks/square/", include_in_schema=False)
    async def square_webhook(request: Request, background: BackgroundTasks):
        try:
            body = await request.body()
            headers = dict(request.headers)
            peer = request.client.host if request.client else ""
            notification_url = str(request.url)
            doc = await load_square_settings()
            key = _decrypt_secret(doc.get("webhook_signature_key_enc") or "") or configured_signature_key()
            signature = extract_signature(headers)
            loopback = peer in ("127.0.0.1", "::1", "localhost")
            if key:
                if not verify_signature(body=body, signature=signature, notification_url=notification_url, signature_key=key):
                    logger.warning("Square webhook rejected: invalid signature")
                    raise HTTPException(status_code=401, detail="Invalid Square webhook signature.")
            elif not loopback:
                logger.warning("Square webhook rejected: signature key is not configured")
                raise HTTPException(status_code=401, detail="Square webhook signature is not configured.")
            try:
                payload = await request.json()
            except Exception:
                raise HTTPException(status_code=400, detail="Request body must be JSON.")
            if not isinstance(payload, dict):
                raise HTTPException(status_code=400, detail="Request body must be a JSON object.")
            eid = square_event_id(payload) or hashlib.sha256(body or b"").hexdigest()[:32]
            etype = square_event_type(payload)
            existing = await db.webhook_events.find_one({"source": "square", "event_id": eid}, {"_id": 0})
            if existing:
                logger.info("Square webhook duplicate event_id=%s type=%s", eid, etype)
                return {"ok": True, "duplicate": True}
            await db.webhook_events.insert_one({
                "id": new_id(),
                "source": "square",
                "event_id": eid,
                "event_type": etype,
                "created_at": now_iso(),
                "status": "received",
            })
            obj = object_payload(payload)
            payment = obj.get("payment") if isinstance(obj.get("payment"), dict) else None
            checkout = obj.get("checkout") if isinstance(obj.get("checkout"), dict) else None
            if etype.startswith("payment.") and not payment:
                payment = obj if obj.get("id") and obj.get("amount_money") else None
            if etype.startswith("terminal.checkout") and not checkout:
                checkout = obj if obj.get("id") else None
            deposit = None
            if checkout:
                checkout_id = checkout.get("id") or ""
                deposit = await db.job_deposits.find_one({"square_checkout_id": checkout_id}, {"_id": 0}) if checkout_id else None
                payment_ids = checkout.get("payment_ids") or []
                if payment_ids and not payment:
                    try:
                        square, _doc = await require_square_client()
                        payment = await square.get_payment(payment_ids[0])
                    except Exception:
                        logger.exception("Square webhook could not fetch payment for checkout")
                if checkout_is_failed(checkout) and deposit and (deposit.get("status") or "") == "pending":
                    await db.job_deposits.update_one({"id": deposit["id"]}, {"$set": {
                        "status": "failed",
                        "error_message": "The Square Reader checkout was canceled.",
                    }})
            if payment:
                pid = payment.get("id") or ""
                ref = payment.get("reference_id") or ""
                if not deposit and pid:
                    deposit = await db.job_deposits.find_one({"square_payment_id": pid}, {"_id": 0})
                if not deposit and ref:
                    deposit = await db.job_deposits.find_one({"id": ref}, {"_id": 0})
                job_id = (deposit or {}).get("job_id") or ""
                await upsert_square_payment(payment, job_id=job_id, deposit_id=(deposit or {}).get("id") or "")
                if deposit:
                    deposit = await mark_deposit_from_payment(deposit, payment, actor_user_id="square-webhook")
                    if (deposit.get("status") or "") == "received":
                        background.add_task(_safe_finish, deposit, "square-webhook")
            logger.info("Square webhook processed type=%s event_id=%s", etype, eid)
            return {"ok": True}
        except HTTPException:
            raise
        except Exception:
            logger.exception("Square webhook failed")
            raise HTTPException(status_code=500, detail="Could not process the Square webhook. Please try again.")
