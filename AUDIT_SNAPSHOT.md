# Revival Pro — Audit Snapshot

Captured **16 August 2026** from the `main` working tree at `~/revival` (`https://github.com/TCCross1/revival.git`).

Revival Pro is the office + field command center for Revival Home Remodeling. Local shop: FastAPI on **http://127.0.0.1:8001**, React on **http://localhost:3000**. Canvas in Floor Plan Studio stays light paper; luxury-dark chrome is for UI chrome only.

---

## 1. Major features

### Auth, team, and permissions

Email/password JWT login plus Google OAuth (Emergent session). Owner seeded from env. Change password, forgot/reset (Resend link), profile edits. Team invite / reset / remove. Roles: admin, manager, field. Per-role feature matrix. Local-only design-mode login skip (`/auth/dev-bypass`).

**Files:** `frontend/src/context/AuthContext.js`, `frontend/src/pages/Login.js`, `AuthCallback.js`, `ChangePassword.js`, `ForgotPassword.js`, `ResetPassword.js`, `Profile.js`, `Team.js`, `Permissions.js`, `frontend/src/lib/permissions.js`, `backend/server.py` (auth/team routes), `backend/field_ops.py`, `backend/field_routes.py`

### Dashboard

KPIs: pipeline, open estimates, active jobs, YTD revenue, win rate, follow-ups, clients.

**Files:** `frontend/src/pages/Dashboard.js`, `backend/server.py` (`GET /api/dashboard`)

### Leads, Thumbtack, outbound calling

Lead CRM (Thumbtack / Angi / referral / etc.), convert to client + job. Thumbtack webhook ingest. Vapi outbound calls from a lead.

**Files:** `frontend/src/pages/Leads.js`, `backend/server.py` (leads + webhook + Vapi routes), `backend/thumbtack_webhook.py`, `backend/vapi_client.py`

### Clients (CRM)

Client list, source/status, detail timeline (estimates, jobs, invoices). Per-client Google Drive folder and uploads.

**Files:** `frontend/src/pages/Clients.js`, `ClientDetail.js`, `frontend/src/components/ClientDriveCard.js`, `backend/server.py` (clients + Drive), `backend/google_drive.py`

### Estimates

Line items, categories, tax, statuses, pipeline. Won → invoice. PDF download + email. Generate contract + job from a won estimate. Merge floor-plan takeoff into an estimate.

**Files:** `frontend/src/pages/Estimates.js`, `frontend/src/components/PricingBreakdown.js`, `backend/server.py` (estimates), `backend/email_pdf.py`, `backend/pricing.py`

### Jobs, job sheet, workspace

Job list with costing (budget / committed / actual) and expenses. Workspace rooms: Overview, Design, Scope, Money, Crew, Docs, Closeout. Job sheet export/PDF. Receipts PDF. Drive uploads on the job.

**Files:** `frontend/src/pages/Jobs.js`, `JobWorkspace.js`, `JobSheet.js`, `frontend/src/components/JobFieldOps.js`, `backend/server.py` (jobs/sheet/workspace), `backend/job_sheet.py`

### Floor Plan Studio (20/20-style CAD)

Plan list + studio: rooms, walls, openings, LVL beams, cabinets, appliances, layers, kitchen design panel, fillers, countertops, takeoffs, permit details, client report, present mode, 3D cutaway (software-projected canvas). Catalog + Lexington Estate Kitchen showcase. 2D appliances draw 24" deep. Double-click spec dialog. Keyboard delete. Drag along wall.

**Files:** `frontend/src/pages/FloorPlans.js`, `FloorPlanStudio.js`, `frontend/src/components/floorplan/*`, `frontend/src/lib/floorPlan/*`, `frontend/public/library/`, `backend/floor_plan.py`, `floor_plan_scope.py`, `floor_plan_report.py`, `lvl_engine.py`, `permit_model.py`, `permit_report.py`, `price_book.py`, `showcase_kitchen.py`, `backend/server.py` (`/api/floor-plans*`)

### Invoices

Statuses, payments, PDF, email to client.

**Files:** `frontend/src/pages/Invoices.js`, `backend/server.py` (invoices), `backend/email_pdf.py`

### Contracts and e-sign

Generate from won estimate. PDF. Client sign link + contractor countersign. Signed copies emailed to both parties.

**Files:** `frontend/src/pages/Contracts.js`, `ContractDetail.js`, `PublicSign.js`, `backend/server.py` (contracts + `/api/public/contracts/{token}`), `backend/email_pdf.py`

### Financials and overhead

Overview, overhead ledger, expense categories, tax questions/classifications, other income. Square **statement upload** to Google Drive. Estimate pricing uses allocated overhead + profit + card fee + tax.

**Files:** `frontend/src/pages/Financials.js`, `frontend/src/components/OverheadLedger.js`, `SquareStatements.js`, `frontend/src/lib/pricing.js`, `backend/server.py` (`/api/financials*`), `backend/pricing.py`, `backend/overhead_catalog.py`

### Field ops

Field home, clock in/out (optional geofence), receipt camera, GPS/manual mileage, crew schedule, per-job notes/photos, material requests, punch tasks, in-app notifications.

**Files:** `frontend/src/pages/FieldHome.js`, `FieldJob.js`, `FieldTime.js`, `FieldReceipt.js`, `FieldMileage.js`, `FieldSchedule.js`, `frontend/src/components/NotificationBell.js`, `frontend/src/lib/offlineQueue.js`, `frontend/src/lib/geo.js`, `frontend/src/lib/voiceNote.js`, `backend/field_ops.py`, `backend/field_routes.py`

### Company settings and Google Drive

Company name/address/phone/license/email, estimate/invoice terms. Drive OAuth connect, client + job folders, Square statement folder.

**Files:** `frontend/src/pages/Settings.js`, `backend/server.py` (settings + Drive), `backend/google_drive.py`

### Branding and PDFs

Teal/gold office UI, field dark shell, branded estimate/invoice/job-sheet PDFs.

**Files:** `frontend/src/index.css`, `frontend/src/components/Layout.js`, `frontend/src/lib/format.js`, `frontend/public/brand/`, `backend/email_pdf.py`, `backend/assets/`

---

## 2. Feature → files (quick index)

| Feature | Frontend | Backend |
| --- | --- | --- |
| Routing / shell | `App.js`, `Layout.js` | `server.py` |
| Auth / profile / team | `AuthContext.js`, `Login.js`, `Profile.js`, `Team.js`, `Permissions.js` | `server.py`, `field_ops.py`, `field_routes.py` |
| Dashboard | `Dashboard.js` | `server.py` |
| Leads / Thumbtack / Vapi | `Leads.js` | `server.py`, `thumbtack_webhook.py`, `vapi_client.py` |
| Clients / Drive | `Clients.js`, `ClientDetail.js`, `ClientDriveCard.js` | `server.py`, `google_drive.py` |
| Estimates / pricing | `Estimates.js`, `PricingBreakdown.js`, `lib/pricing.js` | `server.py`, `pricing.py`, `email_pdf.py` |
| Jobs / sheet / workspace | `Jobs.js`, `JobWorkspace.js`, `JobSheet.js`, `JobFieldOps.js` | `server.py`, `job_sheet.py` |
| Floor plans / CAD | `FloorPlans.js`, `FloorPlanStudio.js`, `components/floorplan/`, `lib/floorPlan/` | `floor_plan.py`, `floor_plan_scope.py`, `lvl_engine.py`, `showcase_kitchen.py`, `price_book.py`, `permit_*` |
| Invoices | `Invoices.js` | `server.py`, `email_pdf.py` |
| Contracts / e-sign | `Contracts.js`, `ContractDetail.js`, `PublicSign.js` | `server.py`, `email_pdf.py` |
| Financials | `Financials.js`, `OverheadLedger.js`, `SquareStatements.js` | `server.py`, `pricing.py`, `overhead_catalog.py` |
| Field | `Field*.js`, `NotificationBell.js` | `field_ops.py`, `field_routes.py` |
| Settings | `Settings.js` | `server.py`, `google_drive.py` |

Tests live under `backend/tests/` (`backend_test.py` plus feature modules: floor plan, showcase kitchen, field ops, pricing, LVL, permits, Drive helpers, workshop spine).

---

## 3. Incomplete or broken areas

These are product gaps or environment caveats, not a claim that the listed modules are unused.

- **Square payout sync is not built.** Monthly statement upload to Drive works. The Financials “Square Reconciliation” panel is an explicit stub (“coming next”). No live Square API pull.
- **Stripe is unused.** `stripe` is in `backend/requirements.txt`; nothing in the app charges cards.
- **Native LiDAR is not in this repo.** Studio can import RoomPlan JSON (and talk to a WKWebView `roomPlan` bridge if an iPhone wrapper injects it). There is no iOS app here. Live scan from Safari is not available.
- **3D is a canvas cutaway**, not a BIM/Three.js engine. Fine for client walkthroughs; not a construction modeler.
- **Photoreal catalog photos do not draw on the 2D plan.** Working drawings are black-and-white 20/20-style by design. Photos are catalog/thumbs only.
- **Angi is a lead-source label only** — no Angi API.
- **Thumbtack ingest needs a public HTTPS URL** (typically ngrok) and, in production, `THUMBTACK_WEBHOOK_SECRET`. Without that, leads must be entered by hand.
- **Vapi outbound needs `VAPI_API_KEY`.** Calls fail closed if the key is missing.
- **Google Drive needs OAuth client id/secret + a connected Google account.** Uploads and Square statement storage no-op or error until connected.
- **Outbound email (PDF, e-sign, password reset) depends on Emergent Resend.** Past test runs have hit rate limits; that is an external flake, not a UI bug.
- **`server.py` is still a monolith** (~6k lines). Field routes were split out; most office APIs were not.
- **No mobile apps in this repository.** Field UI is a responsive web shell.
- **Offline queue exists for field posts** (`offlineQueue.js`) but is not a full offline replica of the office.
- **Dev bypass is local-Mac only** and must never be treated as production auth.
- **GitHub push from this Mac previously failed** (no `gh` CLI, HTTPS username prompt, SSH host-key). Product code is committed; remote publish depends on machine credentials.

Recently verified as working (not gaps): Lexington showcase fridge sits **against the last north-run cabinet** (replacing the filler that looked like a partition); leftover filler is east of the fridge at the pantry wall. Showcase kitchen tests pass.

---

## 4. Current tech stack versions

Declared in lockfiles / requirements, plus what this Mac was running on the audit date.

### Application (declared)

| Layer | Package | Version |
| --- | --- | --- |
| Backend API | FastAPI | 0.110.1 |
| ASGI | uvicorn | 0.25.0 |
| ASGI kit | Starlette | 0.37.2 |
| Data | Motor / PyMongo | 3.3.1 / 4.6.3 |
| Models | Pydantic | 2.13.4 |
| Auth | PyJWT / bcrypt / passlib | 2.13.0 / 4.1.3 / 1.7.4 |
| PDF | ReportLab / PyMuPDF | 5.0.0 / 1.28.2 |
| HTTP | httpx | 0.28.1 |
| Tests | pytest | 9.1.1 |
| Frontend | React / React DOM | 19.0.0 |
| Router | react-router-dom | 7.15.0 |
| Build | react-scripts / CRACO | 5.0.1 / 7.1.0 |
| Data fetching | @tanstack/react-query | 5.56.2 |
| HTTP client | axios | 1.18.0 |
| CSS | Tailwind CSS | 3.4.17 |
| UI kit | Radix + shadcn-style components | various 1.x / 2.x |
| Charts | recharts | 3.6.0 |
| Package manager | Yarn | 1.22.22 |

### This machine (runtime)

| Tool | Version |
| --- | --- |
| Python (venv) | 3.14.6 |
| Node.js | 20.20.2 |
| MongoDB | 8.3.7 |

### Local ports and data

- API: `8001` (`python -m uvicorn server:app --reload --port 8001`)
- UI: `3000` (`npm start` / CRACO)
- Mongo: `127.0.0.1:27017`
- Showcase plan id: `showcase-lexington-kitchen` (re-seeded on API startup)
- Frontend talks to the API via `REACT_APP_BACKEND_URL` or `http://127.0.0.1:8001`

Secrets stay in gitignored `.env` files. Do not commit them.
