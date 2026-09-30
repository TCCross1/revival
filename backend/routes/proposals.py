"""Import a Revival proposal / contract into the client, job sheet, and books."""
import logging
from datetime import datetime, timezone

from bson.binary import Binary
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response

from proposal_ingest import (
    ProposalParseError,
    address_key,
    file_sha256,
    master_file_summary,
    parse_proposal,
    sheet_notes,
)

logger = logging.getLogger(__name__)

IMPORTED_EXPENSE_NOTE = "Imported from the proposal"
MAX_UPLOAD_BYTES = 15 * 1024 * 1024


def attach_proposal_routes(api_router: APIRouter):
    from server import (
        Client,
        Contract,
        Estimate,
        Expense,
        Invoice,
        Job,
        LineItem,
        PaymentMilestone,
        User,
        assert_user_feature,
        db,
        get_company,
        get_current_user,
        new_id,
        next_number,
        now_iso,
    )

    def _line_items(parsed: dict) -> list[LineItem]:
        items = []
        for row in parsed["materials"]:
            if not row.get("billed"):
                continue
            amount = round(float(row["amount"]), 2)
            items.append(LineItem(description=row["description"], quantity=1, unit_price=amount, amount=amount))
        remainder = round(float(parsed["labor_remainder"]), 2)
        if remainder > 0:
            items.append(LineItem(
                description="Labor, overhead, and profit included in the lump-sum contract",
                quantity=1,
                unit_price=remainder,
                amount=remainder,
            ))
        return items

    def _category_budgets(parsed: dict) -> dict:
        return {
            "Materials": round(float(parsed["itemized_materials_total"]), 2),
            "Labor": round(float(parsed["labor_remainder"]), 2),
            "Subcontractors": 0.0,
            "Overhead": 0.0,
            "Other": 0.0,
        }

    def _expenses(parsed: dict) -> list[Expense]:
        stamp = parsed.get("proposal_date") or now_iso()
        if stamp and "T" not in stamp:
            stamp = f"{stamp}T00:00:00+00:00"
        rows = []
        for row in parsed["materials"]:
            if not row.get("billed"):
                continue
            rows.append(Expense(
                category="Materials",
                description=row["description"],
                amount=round(float(row["amount"]), 2),
                kind="committed",
                date=stamp,
                notes=IMPORTED_EXPENSE_NOTE,
            ))
        return rows

    def _master_note(parsed: dict) -> str:
        when = parsed.get("proposal_date_label") or "the proposal date"
        return (
            f"Master file imported from the revised remodeling proposal dated {when}. "
            f"Remaining contract balance ${parsed['remaining_balance']:,.2f}."
        )

    async def _find_client(parsed: dict, client_name: str) -> dict | None:
        key = address_key(parsed["project_address"])
        if not key:
            return None
        docs = await db.clients.find({}, {"_id": 0}).to_list(2000)
        for doc in docs:
            if address_key(doc.get("address") or "") == key:
                return doc
        wanted = client_name.strip().lower()
        for doc in docs:
            if (doc.get("name") or "").strip().lower() == wanted:
                return doc
        return None

    async def _store_document(client_id: str, filename: str, digest: str, data: bytes):
        await db.client_master_files.update_one(
            {"client_id": client_id},
            {"$set": {
                "client_id": client_id,
                "filename": filename,
                "sha256": digest,
                "content_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "data": Binary(data),
                "updated_at": now_iso(),
            }},
            upsert=True,
        )

    @api_router.post("/proposals/ingest")
    async def ingest_proposal(
        file: UploadFile = File(...),
        client_name: str = Form(""),
        user: User = Depends(get_current_user),
    ):
        try:
            await assert_user_feature(user, "clients")
            await assert_user_feature(user, "jobs")
            filename = (file.filename or "proposal.docx").strip()
            if not filename.lower().endswith(".docx"):
                raise HTTPException(status_code=400, detail="Upload the proposal as a .docx Word file.")
            payload = await file.read()
            if not payload:
                raise HTTPException(status_code=400, detail="That file is empty.")
            if len(payload) > MAX_UPLOAD_BYTES:
                raise HTTPException(status_code=400, detail="That proposal is larger than 15 MB.")
            try:
                parsed = parse_proposal(payload)
            except ProposalParseError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
            digest = file_sha256(payload)
            display_name = (client_name or "").strip() or parsed["client_name"]
            logger.info(
                "Ingesting proposal file=%s client=%s balance=%s user=%s",
                filename, display_name, parsed["remaining_balance"], user.user_id,
            )
            existing_import = await db.proposal_imports.find_one({"sha256": digest}, {"_id": 0})
            if not existing_import:
                existing_import = await db.proposal_imports.find_one({
                    "address_key": address_key(parsed["project_address"]),
                    "proposal_date": parsed.get("proposal_date") or "",
                    "remaining_balance": parsed["remaining_balance"],
                }, {"_id": 0})

            client_doc = None
            if existing_import and existing_import.get("client_id"):
                client_doc = await db.clients.find_one({"id": existing_import["client_id"]}, {"_id": 0})
            if not client_doc:
                client_doc = await _find_client(parsed, display_name)

            summary = master_file_summary(parsed, filename, digest)
            summary["imported_at"] = (existing_import or {}).get("imported_at") or now_iso()
            summary["updated_at"] = now_iso()
            note = _master_note(parsed)
            if client_doc:
                await db.clients.update_one({"id": client_doc["id"]}, {"$set": {
                    "name": display_name,
                    "address": parsed["project_address"],
                    "status": "Active",
                    "notes": note,
                    "master_file": summary,
                }})
                client_doc = await db.clients.find_one({"id": client_doc["id"]}, {"_id": 0})
            else:
                client = Client(
                    name=display_name,
                    address=parsed["project_address"],
                    source="Other",
                    status="Active",
                    notes=note,
                    master_file=summary,
                )
                client_doc = client.model_dump()
                await db.clients.insert_one(client_doc)
                logger.info("Created client %s from proposal user=%s", client_doc["id"], user.user_id)

            await _store_document(client_doc["id"], filename, digest, payload)
            items = _line_items(parsed)
            total = round(sum(item.amount for item in items), 2)
            notes = sheet_notes(parsed)
            company = await get_company()
            due = parsed.get("proposal_date") or datetime.now(timezone.utc).date().isoformat()

            estimate_doc = None
            if existing_import and existing_import.get("estimate_id"):
                estimate_doc = await db.estimates.find_one({"id": existing_import["estimate_id"]}, {"_id": 0})
            if estimate_doc:
                await db.estimates.update_one({"id": estimate_doc["id"]}, {"$set": {
                    "client_id": client_doc["id"],
                    "client_name": display_name,
                    "category": parsed["category"],
                    "status": "Won",
                    "line_items": [item.model_dump() for item in items],
                    "subtotal": total,
                    "tax_rate": 0,
                    "tax_amount": 0,
                    "total": total,
                    "notes": notes,
                    "terms": parsed.get("terms") or company.get("estimate_terms") or "",
                    "materials_cost": parsed["itemized_materials_total"],
                    "labor_cost": parsed["labor_remainder"],
                    "estimated_days": parsed.get("estimated_days") or 0,
                }})
                estimate_doc = await db.estimates.find_one({"id": estimate_doc["id"]}, {"_id": 0})
            else:
                estimate = Estimate(
                    estimate_number=await next_number("EST"),
                    client_id=client_doc["id"],
                    client_name=display_name,
                    category=parsed["category"],
                    status="Won",
                    line_items=items,
                    subtotal=total,
                    tax_rate=0,
                    tax_amount=0,
                    total=total,
                    notes=notes,
                    terms=parsed.get("terms") or company.get("estimate_terms") or "",
                    materials_cost=parsed["itemized_materials_total"],
                    labor_cost=parsed["labor_remainder"],
                    estimated_days=parsed.get("estimated_days") or 0,
                )
                estimate_doc = estimate.model_dump()
                await db.estimates.insert_one(estimate_doc)

            schedule = [
                PaymentMilestone(label=row["label"], amount=row["amount"], note=row.get("note") or "")
                for row in parsed["payment_schedule"]
            ]
            contract_doc = None
            if existing_import and existing_import.get("contract_id"):
                contract_doc = await db.contracts.find_one({"id": existing_import["contract_id"]}, {"_id": 0})
            contract_fields = {
                "client_id": client_doc["id"],
                "client_name": display_name,
                "client_address": parsed["project_address"],
                "project_address": parsed["project_address"],
                "project_description": parsed.get("summary") or f"Remodel at {parsed['project_address']}",
                "line_items": [item.model_dump() for item in items],
                "total": total,
                "payment_schedule": [row.model_dump() for row in schedule],
                "exclusions": parsed.get("exclusions") or [],
                "terms": parsed.get("terms") or company.get("contract_terms") or "",
                "status": "Sent",
                "estimate_id": estimate_doc["id"],
            }
            if contract_doc:
                await db.contracts.update_one({"id": contract_doc["id"]}, {"$set": contract_fields})
                contract_doc = await db.contracts.find_one({"id": contract_doc["id"]}, {"_id": 0})
            else:
                contract = Contract(
                    contract_number=await next_number("CON"),
                    contractor_name=company.get("name") or "Revival Home Remodeling",
                    contractor_address=company.get("address") or "",
                    contractor_phone=company.get("phone") or "",
                    contractor_license=company.get("license") or "",
                    change_order_markup=float(company.get("default_change_order_markup") or 20),
                    change_order_terms=company.get("change_order_terms") or "",
                    **contract_fields,
                )
                contract_doc = contract.model_dump()
                await db.contracts.insert_one(contract_doc)

            invoice_doc = None
            if existing_import and existing_import.get("invoice_id"):
                invoice_doc = await db.invoices.find_one({"id": existing_import["invoice_id"]}, {"_id": 0})
            invoice_fields = {
                "estimate_id": estimate_doc["id"],
                "client_id": client_doc["id"],
                "client_name": display_name,
                "status": "Sent",
                "line_items": [item.model_dump() for item in items],
                "amount": total,
                "due_date": f"{due}T00:00:00+00:00" if "T" not in due else due,
                "terms": parsed.get("terms") or company.get("invoice_terms") or "",
            }
            if invoice_doc:
                invoice_fields["amount_paid"] = float(invoice_doc.get("amount_paid") or 0)
                await db.invoices.update_one({"id": invoice_doc["id"]}, {"$set": invoice_fields})
                invoice_doc = await db.invoices.find_one({"id": invoice_doc["id"]}, {"_id": 0})
            else:
                invoice = Invoice(
                    invoice_number=await next_number("INV"),
                    amount_paid=0,
                    **invoice_fields,
                )
                invoice_doc = invoice.model_dump()
                await db.invoices.insert_one(invoice_doc)
            if contract_doc.get("invoice_id") != invoice_doc["id"]:
                await db.contracts.update_one({"id": contract_doc["id"]}, {"$set": {"invoice_id": invoice_doc["id"]}})
                contract_doc["invoice_id"] = invoice_doc["id"]

            job_doc = None
            if existing_import and existing_import.get("job_id"):
                job_doc = await db.jobs.find_one({"id": existing_import["job_id"]}, {"_id": 0})
            fresh_expenses = _expenses(parsed)
            if job_doc:
                kept = [
                    exp for exp in (job_doc.get("expenses") or [])
                    if (exp.get("notes") or "") != IMPORTED_EXPENSE_NOTE
                ]
                expenses = kept + [exp.model_dump() for exp in fresh_expenses]
                await db.jobs.update_one({"id": job_doc["id"]}, {"$set": {
                    "name": f"Remodel - {display_name}",
                    "estimate_id": estimate_doc["id"],
                    "client_id": client_doc["id"],
                    "client_name": display_name,
                    "status": "Active",
                    "budget": total,
                    "expenses": expenses,
                }})
                job_doc = await db.jobs.find_one({"id": job_doc["id"]}, {"_id": 0})
            else:
                job = Job(
                    job_number=await next_number("JOB"),
                    name=f"Remodel - {display_name}",
                    estimate_id=estimate_doc["id"],
                    client_id=client_doc["id"],
                    client_name=display_name,
                    status="Active",
                    budget=total,
                    expenses=fresh_expenses,
                )
                job_doc = job.model_dump()
                await db.jobs.insert_one(job_doc)

            sheet_doc = await db.job_sheets.find_one({"job_id": job_doc["id"]}, {"_id": 0})
            sheet_fields = {
                "job_id": job_doc["id"],
                "client_id": client_doc["id"],
                "client_name": display_name,
                "address": parsed["project_address"],
                "project_type": parsed["project_type"],
                "source": client_doc.get("source") or "Other",
                "budget": total,
                "income": total,
                "notes": notes,
                "category_budgets": _category_budgets(parsed),
                "estimated_days": parsed.get("estimated_days") or 0,
                "updated_at": now_iso(),
            }
            if sheet_doc:
                await db.job_sheets.update_one({"job_id": job_doc["id"]}, {"$set": sheet_fields})
            else:
                sheet_fields.update({
                    "id": new_id(),
                    "phone": client_doc.get("phone") or "",
                    "email": client_doc.get("email") or "",
                    "profit_margin": None,
                    "apply_optional_tax": False,
                    "google_drive_file_id": "",
                    "google_drive_folder_id": "",
                    "created_at": now_iso(),
                })
                await db.job_sheets.insert_one(sheet_fields)
                logger.info("Created job sheet for job %s from proposal", job_doc["id"])

            import_doc = {
                "sha256": digest,
                "address_key": address_key(parsed["project_address"]),
                "proposal_date": parsed.get("proposal_date") or "",
                "remaining_balance": parsed["remaining_balance"],
                "client_id": client_doc["id"],
                "estimate_id": estimate_doc["id"],
                "contract_id": contract_doc["id"],
                "invoice_id": invoice_doc["id"],
                "job_id": job_doc["id"],
                "filename": filename,
                "imported_at": summary["imported_at"],
                "updated_at": now_iso(),
                "user_id": user.user_id,
            }
            if existing_import and existing_import.get("id"):
                await db.proposal_imports.update_one({"id": existing_import["id"]}, {"$set": import_doc})
            else:
                import_doc["id"] = new_id()
                await db.proposal_imports.insert_one(import_doc)

            logger.info(
                "Proposal ingested client=%s estimate=%s contract=%s invoice=%s job=%s balance=%s user=%s",
                client_doc["id"], estimate_doc.get("estimate_number"), contract_doc.get("contract_number"),
                invoice_doc.get("invoice_number"), job_doc.get("job_number"), total, user.user_id,
            )
            return {
                "client": Client(**{k: v for k, v in client_doc.items() if k != "_id"}).model_dump(),
                "estimate": Estimate(**estimate_doc).model_dump(),
                "contract": Contract(**contract_doc).model_dump(),
                "invoice": Invoice(**invoice_doc).model_dump(),
                "job": Job(**job_doc).model_dump(),
                "breakdown": summary,
            }
        except HTTPException:
            raise
        except Exception:
            logger.exception("Proposal ingest failed user=%s", getattr(user, "user_id", ""))
            raise HTTPException(status_code=500, detail="Could not import that proposal. Please try again.")

    @api_router.get("/clients/{client_id}/master-file")
    async def download_master_file(client_id: str, user: User = Depends(get_current_user)):
        try:
            await assert_user_feature(user, "clients")
            doc = await db.client_master_files.find_one({"client_id": client_id})
            if not doc or not doc.get("data"):
                raise HTTPException(status_code=404, detail="This client does not have an imported proposal yet.")
            filename = (doc.get("filename") or "proposal.docx").replace('"', "")
            logger.info("Downloaded master file client=%s user=%s", client_id, user.user_id)
            return Response(
                content=bytes(doc["data"]),
                media_type=doc.get("content_type") or "application/octet-stream",
                headers={"Content-Disposition": f'attachment; filename="{filename}"'},
            )
        except HTTPException:
            raise
        except Exception:
            logger.exception("Master file download failed client=%s", client_id)
            raise HTTPException(status_code=500, detail="Could not download the client master file. Please try again.")
