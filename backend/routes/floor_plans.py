"""Floor plan HTTP routes.
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
    WebSocket,
    WebSocketDisconnect,
    Body,
)
from fastapi.responses import RedirectResponse, StreamingResponse
from pydantic import BaseModel

logger = logging.getLogger(__name__)

import google_drive as gdrive
from floor_plan import (
    compute_takeoffs as floor_compute_takeoffs,
    empty_document as floor_empty_document,
    import_roomplan as floor_import_roomplan,
    public_catalog as floor_public_catalog,
)
from floor_plan_scope import build_scope as floor_build_scope
from floor_plan_report import build_client_report
from permit_model import extract_permit_model, public_preview
from permit_report import build_permit_report
from plan_sync import hub as plan_hub, issue_ticket, next_revision, read_ticket, sync_payload


def attach_floor_plan_routes(api_router: APIRouter):
    from server import (
        Estimate,
        FloorPlan,
        FloorPlanAttach,
        FloorPlanCreate,
        FloorPlanPermitIn,
        FloorPlanReportIn,
        FloorPlanUpdate,
        LineItem,
        User,
        assert_user_feature,
        compute_totals,
        db,
        get_company,
        get_current_user,
        logger,
        maybe_save_drive_file,
        new_id,
        next_number,
        now_iso,
        push_estimate_to_drive,
        resolve_client_ref,
    )

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
            "revision": int(plan.get("revision") or 0),
        }


    async def _persist_floor_plan(plan: dict, *, push_drive: bool = True, origin: str = "") -> dict:
        document = plan.get("document") or floor_empty_document()
        plan["document"] = document
        plan["takeoffs"] = floor_compute_takeoffs(document, project_type=plan.get("project_type") or "")
        plan["updated_at"] = now_iso()
        plan["revision"] = next_revision(plan)
        if plan.get("showcase"):
            plan["user_edited"] = True
            plan["preserve_edits"] = True
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
        try:
            await plan_hub.broadcast(plan["id"], sync_payload(plan, origin=origin or ""))
        except Exception:
            logger.exception("Plan sync broadcast failed plan_id=%s", plan.get("id"))
        return plan


    def _sync_origin(request: Request) -> str:
        return str(request.headers.get("X-Revival-Sync-Origin") or "")[:80]


    def _apply_roomplan_to_plan(found: dict, payload: dict) -> dict:
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
        lidar = document.get("lidar") if isinstance(document.get("lidar"), dict) else {"sessions": [], "last_import": ""}
        lidar["last_import"] = now_iso()
        sessions = list(lidar.get("sessions") or [])
        sessions.append({
            "id": new_id(),
            "imported_at": lidar["last_import"],
            "rooms": len(scanned.get("rooms") or []),
            "walls": len(scanned.get("walls") or []),
            "objects": len(scanned.get("objects") or []),
        })
        lidar["sessions"] = sessions[-20:]
        document["lidar"] = lidar
        found["document"] = document
        return found


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
    async def create_floor_plan(payload: FloorPlanCreate, request: Request, user: User = Depends(get_current_user)):
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
            saved = await _persist_floor_plan(obj, origin=_sync_origin(request))
            logger.info("Created floor plan %s user=%s revision=%s", saved.get("id"), user.user_id, saved.get("revision"))
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
    async def update_floor_plan(plan_id: str, payload: FloorPlanUpdate, request: Request, user: User = Depends(get_current_user)):
        try:
            found = await db.floor_plans.find_one({"id": plan_id}, {"_id": 0})
            if not found:
                raise HTTPException(status_code=404, detail="Floor plan not found")
            data = payload.model_dump(exclude_unset=True)
            updated = {**found, **data}
            saved = await _persist_floor_plan(updated, origin=_sync_origin(request))
            logger.info("Updated floor plan %s user=%s revision=%s", plan_id, user.user_id, saved.get("revision"))
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
    async def import_floor_plan_roomplan(plan_id: str, payload: dict, request: Request, user: User = Depends(get_current_user)):
        try:
            found = await db.floor_plans.find_one({"id": plan_id}, {"_id": 0})
            if not found:
                raise HTTPException(status_code=404, detail="Floor plan not found")
            found = _apply_roomplan_to_plan(found, payload or {})
            saved = await _persist_floor_plan(found, origin=_sync_origin(request))
            logger.info(
                "Imported RoomPlan into floor plan %s user=%s revision=%s rooms=%s objects=%s",
                plan_id,
                user.user_id,
                saved.get("revision"),
                len(((saved.get("document") or {}).get("levels") or [{}])[0].get("rooms") or []),
                len(((saved.get("document") or {}).get("levels") or [{}])[0].get("objects") or []),
            )
            return saved
        except ValueError as ex:
            raise HTTPException(status_code=400, detail=str(ex))
        except HTTPException:
            raise
        except Exception:
            logger.exception("Import RoomPlan failed plan_id=%s", plan_id)
            raise HTTPException(status_code=500, detail="Could not import that LiDAR scan. Please try again.")


    @api_router.post("/jobs/{job_id}/kitchen-scan")
    async def kitchen_scan_for_job(job_id: str, request: Request, user: User = Depends(get_current_user), payload: Optional[dict] = Body(default=None)):
        try:
            await assert_user_feature(user, "floor_plans")
            job = await db.jobs.find_one({"id": job_id}, {"_id": 0})
            if not job:
                raise HTTPException(status_code=404, detail="Job not found")
            body = payload or {}
            scan = body.get("roomplan") if isinstance(body.get("roomplan"), dict) else body
            has_scan = bool(scan.get("walls") or scan.get("rooms") or scan.get("objects") or scan.get("capturedRooms") or scan.get("doors"))
            existing = await db.floor_plans.find(
                {"job_id": job_id, "showcase": {"$ne": True}},
                {"_id": 0},
            ).sort("updated_at", -1).to_list(1)
            found = existing[0] if existing else None
            if not found:
                found = FloorPlan(
                    name=f"{job.get('client_name') or job.get('name') or 'Job'} kitchen scan",
                    client_id=job.get("client_id") or "",
                    client_name=job.get("client_name") or "",
                    job_id=job_id,
                    address=job.get("address") or "",
                    project_type=job.get("project_type") or "Kitchen",
                    version_kind="existing",
                    document=floor_empty_document(),
                ).model_dump()
            if has_scan:
                found = _apply_roomplan_to_plan(found, scan)
            saved = await _persist_floor_plan(found, origin=_sync_origin(request))
            logger.info("Kitchen scan ready job=%s plan=%s imported=%s user=%s", job_id, saved.get("id"), has_scan, user.user_id)
            return {**saved, "scan_imported": has_scan, "drive": {"web_view_link": saved.get("google_drive_url") or ""}}
        except ValueError as ex:
            raise HTTPException(status_code=400, detail=str(ex))
        except HTTPException:
            raise
        except Exception:
            logger.exception("Kitchen scan failed job_id=%s", job_id)
            raise HTTPException(status_code=500, detail="Could not start that kitchen scan. Please try again.")


    @api_router.post("/floor-plans/{plan_id}/sync-ticket")
    async def floor_plan_sync_ticket(plan_id: str, user: User = Depends(get_current_user)):
        try:
            found = await db.floor_plans.find_one({"id": plan_id}, {"_id": 0, "id": 1})
            if not found:
                raise HTTPException(status_code=404, detail="Floor plan not found")
            issued = issue_ticket(user.user_id, plan_id)
            logger.info("Issued plan sync ticket plan_id=%s user=%s", plan_id, user.user_id)
            return issued
        except HTTPException:
            raise
        except Exception:
            logger.exception("Plan sync ticket failed plan_id=%s", plan_id)
            raise HTTPException(status_code=500, detail="Could not open live sync. Please try again.")


    @api_router.get("/floor-plans/{plan_id}/sync")
    async def floor_plan_sync_state(plan_id: str, since: int = 0, user: User = Depends(get_current_user)):
        try:
            found = await db.floor_plans.find_one({"id": plan_id}, {"_id": 0})
            if not found:
                raise HTTPException(status_code=404, detail="Floor plan not found")
            revision = int(found.get("revision") or 0)
            if since >= revision:
                return {"changed": False, "revision": revision, "updated_at": found.get("updated_at") or ""}
            return {"changed": True, **sync_payload(found)}
        except HTTPException:
            raise
        except Exception:
            logger.exception("Plan sync poll failed plan_id=%s", plan_id)
            raise HTTPException(status_code=500, detail="Could not check for plan updates. Please try again.")


    @api_router.websocket("/ws/floor-plans/{plan_id}")
    async def floor_plan_ws(websocket: WebSocket, plan_id: str):
        ticket = websocket.query_params.get("ticket") or ""
        rec = read_ticket(ticket, plan_id)
        if not rec:
            logger.info("Plan websocket rejected plan_id=%s (missing or expired ticket)", plan_id)
            await websocket.close(code=4401)
            return
        found = await db.floor_plans.find_one({"id": plan_id}, {"_id": 0})
        if not found:
            await websocket.close(code=4404)
            return
        await websocket.accept()
        await plan_hub.connect(plan_id, websocket)
        try:
            await websocket.send_json({**sync_payload(found), "type": "hello"})
            while True:
                raw = await websocket.receive_text()
                if not raw:
                    continue
                try:
                    msg = json.loads(raw)
                except Exception:
                    continue
                if msg.get("type") == "ping":
                    latest = await db.floor_plans.find_one({"id": plan_id}, {"_id": 0, "revision": 1, "updated_at": 1})
                    await websocket.send_json({
                        "type": "pong",
                        "revision": int((latest or found).get("revision") or 0),
                        "updated_at": (latest or found).get("updated_at") or "",
                    })
        except WebSocketDisconnect:
            plan_hub.disconnect(plan_id, websocket)
        except Exception:
            logger.exception("Plan websocket failed plan_id=%s", plan_id)
            plan_hub.disconnect(plan_id, websocket)


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
            scope = floor_build_scope(found.get("document") or {}, found.get("project_type") or "")
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
