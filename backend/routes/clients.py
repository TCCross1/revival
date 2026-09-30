"""Client CRUD and Google Drive HTTP routes.
Attached from server.py after models and helpers exist.
"""
import asyncio
import base64
import json
import logging
import os
import secrets
from datetime import datetime, timedelta, timezone
import requests
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

import google_drive as gdrive
from fastapi.responses import RedirectResponse


def attach_client_routes(api_router: APIRouter):
    from server import (
        Client,
        ClientCreate,
        DriveCredentialsIn,
        DriveCryptoError,
        Contract,
        Estimate,
        Invoice,
        Job,
        User,
        _encrypt_secret,
        apply_stored_drive_oauth,
        assert_user_feature,
        client_drive_payload,
        db,
        docs_for_client,
        drive_connection_status,
        ensure_client_drive_folder,
        gdrive,
        get_current_user,
        handle_client_drive_upload,
        load_drive_settings,
        logger,
        normalize_phone_field,
        now_iso,
        parse_iso_dt,
        require_admin,
        require_drive_service,
        save_drive_settings,
        tokens_from_settings,
    )

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
        contracts = await db.contracts.find({"client_id": client_id}, {"_id": 0}).sort("created_at", -1).to_list(200)

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
            "contracts": [Contract(**c).model_dump() for c in contracts],
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
            try:
                wrapped = _encrypt_secret(secret)
            except DriveCryptoError:
                raise HTTPException(
                    status_code=500,
                    detail="Server is missing JWT_SECRET, so Google Drive keys cannot be stored.",
                )
            gdrive.set_runtime_oauth(client_id, secret)
            await save_drive_settings({
                "oauth_client_id": client_id,
                "oauth_client_secret_enc": wrapped,
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
