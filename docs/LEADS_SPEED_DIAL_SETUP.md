# Lead speed-dial & Google Calendar — simple setup

This guide gets **Thumbtack**, **Google Ads**, and **Angi** leads into Revival Pro, triggers **Riley (Vapi)** to call immediately, stores **call logs**, and syncs the **Vapi Google Calendar** onto the Office Calendar.

---

## What Revival does automatically now

1. A lead webhook arrives (Thumbtack / Google Ads / Angi).
2. Revival creates the **Lead**, converts to **Client + Job**, and **queues Riley** to dial the customer’s phone.
3. Each dial attempt is stored in **Call logs** (status, attempt #, Vapi call id, summary/transcript when Vapi reports back).
4. On the **Leads** page you can edit the **from-number** and **notify emails/phones** used for this sequence.
5. On **Calendar**, click **Sync Google Calendar** to pull appointments from `revivalhomeremodelingllc@gmail.com` (the calendar Vapi uses).

---

## 1. Server env vars (backend `.env`)

| Variable | Purpose |
|----------|---------|
| `VAPI_API_KEY` | Required for Riley outbound calls |
| `VAPI_OUTBOUND_NUMBER` | Optional; default `+18599978212` until custom number |
| `VAPI_PHONE_NUMBER_ID` | Optional Vapi phone number id |
| `VAPI_WEBHOOK_SECRET` | Shared secret for Vapi end-of-call webhook |
| `THUMBTACK_WEBHOOK_SECRET` | Thumbtack webhook auth |
| `GOOGLE_ADS_WEBHOOK_SECRET` | Google Ads / Zapier webhook auth |
| `ANGI_WEBHOOK_SECRET` | Angi / Zapier webhook auth |
| Google Drive OAuth vars | Already used for Drive; reconnect once for Calendar scope |

Public webhook base (production or ngrok):

```text
https://YOUR-PUBLIC-HOST/api/webhooks/thumbtack
https://YOUR-PUBLIC-HOST/api/webhooks/google-ads
https://YOUR-PUBLIC-HOST/api/webhooks/angi
https://YOUR-PUBLIC-HOST/api/webhooks/vapi
```

Local tunnel example:

```bash
ngrok http 8001
```

---

## 2. Thumbtack

1. In Thumbtack business settings, open **Webhooks / Instant leads**.
2. Set URL to: `https://YOUR-PUBLIC-HOST/api/webhooks/thumbtack`
3. Set the same shared secret as `THUMBTACK_WEBHOOK_SECRET`.
4. Send a real lead (or use Revival’s authenticated test endpoint carefully — test leads **do not** auto-dial).
5. Confirm in Leads: lead appears, Client/Job created, call log shows a queued attempt, Riley rings the customer.

---

## 3. Google Ads (Lead Form → instant call)

Google Lead Form Extensions can post JSON to a webhook. Easiest reliable path:

### Option A — Google Ads Lead Form webhook (if available in your Ads account)

1. In Google Ads, open the lead form asset / extension.
2. Add a webhook URL: `https://YOUR-PUBLIC-HOST/api/webhooks/google-ads`
3. Add header `x-webhook-secret: YOUR_GOOGLE_ADS_WEBHOOK_SECRET` (same value as env).
4. Map name, phone, email fields in the form.
5. Submit a test lead → Revival creates Lead (source **Google**) → Riley dials.

### Option B — Zapier / Make (recommended if Ads UI is limited)

1. Trigger: **Google Ads → New Lead Form Entry** (or Google Sheets if Ads dumps there).
2. Action: **Webhooks by Zapier → POST**.
3. URL: `https://YOUR-PUBLIC-HOST/api/webhooks/google-ads`
4. Headers: `x-webhook-secret` = your `GOOGLE_ADS_WEBHOOK_SECRET`
5. JSON body example:

```json
{
  "full_name": "{{name}}",
  "phone_number": "{{phone}}",
  "email": "{{email}}",
  "street_address": "{{address}}",
  "lead_id": "{{lead_id}}",
  "campaign_id": "{{campaign_id}}"
}
```

Revival accepts both Ads `user_column_data` shapes and this flat Zapier shape.

---

## 4. Angi / Angie’s List

Angi partner APIs vary by account. Practical path for most remodelers:

### Zapier / email bridge

1. When Angi emails or pushes a new lead, use Zapier **Email Parser** or Angi app trigger.
2. POST JSON to: `https://YOUR-PUBLIC-HOST/api/webhooks/angi`
3. Header: `x-webhook-secret: YOUR_ANGI_WEBHOOK_SECRET`
4. Body example:

```json
{
  "name": "Jordan Lee",
  "phone": "8595550100",
  "email": "jordan@example.com",
  "address": "12 Oak St, Lexington, KY",
  "project_type": "Kitchen Remodel",
  "lead_id": "angi-12345",
  "notes": "Wants cabinets and countertops"
}
```

Same result: Lead (source **Angi**) → Client/Job → Riley auto-dial → call log.

---

## 5. Vapi call logs (attempts, transcript, collected info)

1. In Vapi dashboard → Assistant **Riley** → **Server URL / Webhook**:
   `https://YOUR-PUBLIC-HOST/api/webhooks/vapi`
2. Set header/secret to match `VAPI_WEBHOOK_SECRET`.
3. Enable **end-of-call-report** (and analysis/summary if available).
4. Revival updates **call logs** and appends Riley’s summary / collected fields onto the lead **notes**.

View recent attempts on the **Leads** page under **Speed dial & notify contacts**.

---

## 6. Editable calling contacts (Leads page)

On **Leads → Speed dial & notify contacts**:

- Turn **Auto-call** on/off
- Toggle per platform: Thumbtack / Google Ads / Angi
- Edit **From number** (current Riley caller ID)
- Edit **Notify emails** and **Notify phones**
- Optional **Owner fallback phones** (stored for the next escalation step)

Save with **Save contacts**.

---

## 7. Google Calendar → Office Calendar

Vapi is tied to `revivalhomeremodelingllc@gmail.com`. To mirror those appointments:

1. Open **Settings → Company Profile → Google Drive**.
2. **Disconnect** if already connected, then **Connect** again so Google asks for **Calendar (read)** permission in addition to Drive.
3. Sign in as `revivalhomeremodelingllc@gmail.com`.
4. Open **Calendar** in Revival → click **Sync Google Calendar**.
5. Events appear as consultations (source `google`). Re-sync anytime; updates are matched by Google event id.

Tip: after Riley books an appointment on that Gmail calendar, hit Sync (or we can add automatic polling later).

---

## 8. Quick checklist

- [ ] `VAPI_API_KEY` set; Riley assistant visible in Vapi
- [ ] Public HTTPS (ngrok or production) pointing at API port `8001`
- [ ] Thumbtack webhook URL + secret
- [ ] Google Ads webhook or Zapier → `/api/webhooks/google-ads`
- [ ] Angi Zapier/email → `/api/webhooks/angi`
- [ ] Vapi end-of-call webhook → `/api/webhooks/vapi`
- [ ] Leads page: auto-call ON, from-number + notify emails saved
- [ ] Google reconnect with Calendar scope; Calendar → Sync Google Calendar

---

## Support notes

- Test Thumbtack injects (`TEST-TT-…`) **never** auto-dial (safe for practice).
- Duplicate marketplace ids do not create double dials.
- If Google sync says permission is missing, reconnect Google in Company Profile once.
