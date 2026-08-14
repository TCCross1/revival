# Revival Pro — PRD

## Original Problem Statement
Full-stack web app "Revival Pro" for a residential remodeling contractor. Branding: deep teal (#0A4D68) + gold (#C9A227), clean/professional/spacious, easy for non-technical users, logo top-left of nav. Modules: Dashboard, Clients (CRM), Estimates (line items, categories, statuses, convert Won→Invoice, pipeline $), Jobs (costing: Budget vs Committed vs Actual, log expenses), Invoices (statuses). Basic auth for owner/team. Brightened silky teal image as background; visible Revival Pro logo.

## User Choices
- Auth: Emergent-managed Google sign-in
- Seed demo data: Yes
- Currency: USD
- Build all 5 modules now
- Estimate tax: simple subtotal + optional tax % + total

## Architecture
- Backend: FastAPI (`/app/backend/server.py`), all routes `/api` prefixed. Session-based Google OAuth (cookie `session_token` httpOnly + Bearer fallback). MongoDB via MONGO_URL. Auto-seeds demo data on startup.
- Frontend: React + React Router + @tanstack/react-query + shadcn/ui + Tailwind. Axios (`lib/api.js`) with withCredentials + Authorization Bearer interceptor (localStorage `session_token`). Pages under `src/pages/`, top nav in `components/Layout.js`.
- Fonts: Outfit (headings) + Work Sans (body). Brand bg = silky teal image with light overlay; logo in nav.

## User Personas
- Business owner (tccrossmusic@gmail.com) and small team — non-technical, need clarity and speed.

## Core Requirements (static)
1. Dashboard KPIs: pipeline value, open estimates, active jobs, YTD revenue, follow-up list, win rate, total clients.
2. Clients CRM with source + status.
3. Estimates with line items, categories, statuses, tax, pipeline, convert Won→Invoice.
4. Jobs costing (Budget/Committed/Actual) + expense logging by category.
5. Invoices with statuses and payment tracking.
6. Google auth.

## Implemented (2026-08-14)
- All 5 modules + Google auth + dashboard aggregates + demo seed. Verified: backend pytest, frontend 100% critical flows.
- Convert endpoint restricted to Won estimates (spec compliance).
- Estimate PDF (reportlab) — download + email to client via Emergent Resend (attachment supported); friendly 400 error for undeliverable emails.
- Client Timeline — /clients/:id detail page with per-client estimates, jobs, invoices + summary stats.
- Construction Contracts — "Generate Contract & Invoice" on Won estimates; contract has Parties, Project Info, Scope (from estimate), Price & Payment schedule, standard Exclusions, Change Orders (editable markup, default 20%), and touch/mouse signature pads for client + contractor. Contract PDF export + editable Contracts module.
- Company Profile — /settings screen (also in user menu) to edit contractor name/address/phone/license/email via /api/settings; used when generating contracts.
- Contract E-Sign — "Send for e-signature" emails the client a secure link (/sign/:token, no login) to review the full contract on mobile and sign; public endpoints GET/POST /api/public/contracts/{token}. Client signing marks Signed when contractor has also signed, else Sent.

## Backlog / Remaining
- P1: Estimate PDF export / send to client; invoice PDF.
- P1: Concurrency-safe numbering (counters collection) instead of count-based.
- P2: DialogDescription for a11y; split server.py by domain as it grows.
- P2: Client detail view with linked estimates/jobs/invoices timeline.

## Next Tasks
- Await user review of the 4 initial + Jobs/Invoices modules; iterate on requested refinements.
