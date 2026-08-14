"""Backend API tests for Revival Pro."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://project-revival-43.preview.emergentagent.com").rstrip("/")
TOKEN = "test_session_verify"


@pytest.fixture(scope="session")
def client():
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def anon():
    return requests.Session()


# ---------------- Auth ----------------
class TestAuth:
    def test_me_requires_auth(self, anon):
        r = anon.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 401

    def test_me_ok_with_bearer(self, client):
        r = client.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 200
        data = r.json()
        assert "email" in data and "user_id" in data

    def test_me_ok_with_cookie(self):
        r = requests.get(f"{BASE_URL}/api/auth/me", cookies={"session_token": TOKEN})
        assert r.status_code == 200


# ---------------- Dashboard ----------------
class TestDashboard:
    def test_dashboard(self, client):
        r = client.get(f"{BASE_URL}/api/dashboard")
        assert r.status_code == 200
        d = r.json()
        for k in ["pipeline_value", "open_estimates_count", "active_jobs",
                  "ytd_revenue", "win_rate", "total_clients", "follow_ups"]:
            assert k in d, f"missing {k}"
        assert isinstance(d["follow_ups"], list)
        assert isinstance(d["pipeline_value"], (int, float))


# ---------------- Clients ----------------
class TestClients:
    def test_list(self, client):
        r = client.get(f"{BASE_URL}/api/clients")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_crud(self, client):
        payload = {"name": "TEST_Client_X", "phone": "555", "email": "t@t.com",
                   "address": "1 St", "source": "Website", "status": "Lead"}
        r = client.post(f"{BASE_URL}/api/clients", json=payload)
        assert r.status_code == 200
        cid = r.json()["id"]
        assert r.json()["name"] == "TEST_Client_X"

        # verify persistence via list
        listed = client.get(f"{BASE_URL}/api/clients").json()
        assert any(c["id"] == cid for c in listed)

        # update
        payload["status"] = "Active"
        r2 = client.put(f"{BASE_URL}/api/clients/{cid}", json=payload)
        assert r2.status_code == 200 and r2.json()["status"] == "Active"

        # delete
        rd = client.delete(f"{BASE_URL}/api/clients/{cid}")
        assert rd.status_code == 200
        listed = client.get(f"{BASE_URL}/api/clients").json()
        assert not any(c["id"] == cid for c in listed)


# ---------------- Estimates ----------------
class TestEstimates:
    def test_create_computes_totals(self, client):
        payload = {
            "client_name": "TEST_Estimate_Client",
            "category": "Kitchen",
            "status": "Draft",
            "line_items": [
                {"description": "A", "quantity": 2, "unit_price": 100},
                {"description": "B", "quantity": 1, "unit_price": 50},
            ],
            "tax_rate": 10.0,
        }
        r = client.post(f"{BASE_URL}/api/estimates", json=payload)
        assert r.status_code == 200
        e = r.json()
        assert e["subtotal"] == 250.0
        assert e["tax_amount"] == 25.0
        assert e["total"] == 275.0
        assert e["estimate_number"].startswith("EST-")
        # cleanup
        client.delete(f"{BASE_URL}/api/estimates/{e['id']}")

    def test_convert_won_estimate_idempotent(self, client):
        # create Won estimate
        payload = {
            "client_name": "TEST_Convert_Client",
            "category": "Bathroom",
            "status": "Won",
            "line_items": [{"description": "X", "quantity": 1, "unit_price": 500}],
            "tax_rate": 0,
        }
        r = client.post(f"{BASE_URL}/api/estimates", json=payload)
        assert r.status_code == 200
        eid = r.json()["id"]

        r1 = client.post(f"{BASE_URL}/api/estimates/{eid}/convert")
        assert r1.status_code == 200
        inv1 = r1.json()
        assert inv1["estimate_id"] == eid
        assert inv1["amount"] == 500.0

        r2 = client.post(f"{BASE_URL}/api/estimates/{eid}/convert")
        assert r2.status_code == 200
        assert r2.json()["id"] == inv1["id"]  # idempotent

        # cleanup
        client.delete(f"{BASE_URL}/api/invoices/{inv1['id']}")
        client.delete(f"{BASE_URL}/api/estimates/{eid}")


# ---------------- Jobs ----------------
class TestJobs:
    def test_job_and_expense_flow(self, client):
        r = client.post(f"{BASE_URL}/api/jobs", json={"name": "TEST_Job", "budget": 1000})
        assert r.status_code == 200
        jid = r.json()["id"]
        assert r.json()["job_number"].startswith("JOB-")

        # add expense
        exp = {"category": "Materials", "description": "wood", "amount": 100, "kind": "actual"}
        r2 = client.post(f"{BASE_URL}/api/jobs/{jid}/expenses", json=exp)
        assert r2.status_code == 200
        exps = r2.json()["expenses"]
        assert len(exps) == 1
        exp_id = exps[0]["id"]

        # delete expense
        r3 = client.delete(f"{BASE_URL}/api/jobs/{jid}/expenses/{exp_id}")
        assert r3.status_code == 200
        assert len(r3.json()["expenses"]) == 0

        client.delete(f"{BASE_URL}/api/jobs/{jid}")


# ---------------- Invoices ----------------
class TestInvoices:
    def test_invoice_payment_update(self, client):
        payload = {"client_name": "TEST_Inv", "status": "Sent", "amount": 500, "amount_paid": 0}
        r = client.post(f"{BASE_URL}/api/invoices", json=payload)
        assert r.status_code == 200
        iid = r.json()["id"]

        payload["amount_paid"] = 500
        payload["status"] = "Paid"
        r2 = client.put(f"{BASE_URL}/api/invoices/{iid}", json=payload)
        assert r2.status_code == 200
        assert r2.json()["status"] == "Paid"
        assert r2.json()["amount_paid"] == 500

        client.delete(f"{BASE_URL}/api/invoices/{iid}")


# ---------------- New: PDF ----------------
class TestEstimatePDF:
    def test_pdf_requires_auth(self, anon, client):
        estimates = client.get(f"{BASE_URL}/api/estimates").json()
        assert len(estimates) > 0
        eid = estimates[0]["id"]
        r = anon.get(f"{BASE_URL}/api/estimates/{eid}/pdf")
        assert r.status_code == 401

    def test_pdf_download_ok(self, client):
        estimates = client.get(f"{BASE_URL}/api/estimates").json()
        assert len(estimates) > 0
        eid = estimates[0]["id"]
        r = client.get(f"{BASE_URL}/api/estimates/{eid}/pdf")
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert r.content.startswith(b"%PDF"), "response body is not a PDF"
        assert len(r.content) > 800
        cd = r.headers.get("content-disposition", "")
        assert "attachment" in cd and ".pdf" in cd

    def test_pdf_404_for_missing(self, client):
        r = client.get(f"{BASE_URL}/api/estimates/nonexistent-id-xyz/pdf")
        assert r.status_code == 404


# ---------------- New: Email ----------------
class TestEstimateEmail:
    def test_email_400_when_client_has_no_email(self, client):
        # Create client with no email, estimate for that client
        c = client.post(f"{BASE_URL}/api/clients", json={
            "name": "TEST_NoEmailClient", "phone": "", "email": "", "address": "",
            "source": "Referral", "status": "Lead"
        }).json()
        e = client.post(f"{BASE_URL}/api/estimates", json={
            "client_id": c["id"], "client_name": c["name"], "category": "Kitchen",
            "status": "Draft",
            "line_items": [{"description": "X", "quantity": 1, "unit_price": 100}],
            "tax_rate": 0,
        }).json()
        r = client.post(f"{BASE_URL}/api/estimates/{e['id']}/send-email")
        assert r.status_code == 400
        assert "no email" in r.json().get("detail", "").lower()
        # cleanup
        client.delete(f"{BASE_URL}/api/estimates/{e['id']}")
        client.delete(f"{BASE_URL}/api/clients/{c['id']}")

    def test_email_502_for_undeliverable(self, client):
        # Fake seed client should be blocked by proxy
        c = client.post(f"{BASE_URL}/api/clients", json={
            "name": "TEST_FakeEmailClient", "phone": "", "email": "dpark@email.com",
            "address": "", "source": "Referral", "status": "Lead"
        }).json()
        e = client.post(f"{BASE_URL}/api/estimates", json={
            "client_id": c["id"], "client_name": c["name"], "category": "Kitchen",
            "status": "Draft",
            "line_items": [{"description": "X", "quantity": 1, "unit_price": 100}],
            "tax_rate": 0,
        }).json()
        r = client.post(f"{BASE_URL}/api/estimates/{e['id']}/send-email")
        # Accept 502 (undeliverable, friendly) or 500 fallback; must NOT be 200
        assert r.status_code in (502, 500), f"expected error status, got {r.status_code}: {r.text[:300]}"
        try:
            body = r.json()
            assert "detail" in body
        except Exception:
            # Some ingresses may swallow the JSON body on 502
            pass
        client.delete(f"{BASE_URL}/api/estimates/{e['id']}")
        client.delete(f"{BASE_URL}/api/clients/{c['id']}")

    def test_email_success_with_resend_test_address(self, client):
        c = client.post(f"{BASE_URL}/api/clients", json={
            "name": "TEST_DeliverableClient", "phone": "", "email": "delivered@resend.dev",
            "address": "", "source": "Referral", "status": "Lead"
        }).json()
        e = client.post(f"{BASE_URL}/api/estimates", json={
            "client_id": c["id"], "client_name": c["name"], "category": "Kitchen",
            "status": "Draft",
            "line_items": [{"description": "Cabinets", "quantity": 1, "unit_price": 1000}],
            "tax_rate": 8.25,
        }).json()
        r = client.post(f"{BASE_URL}/api/estimates/{e['id']}/send-email")
        assert r.status_code == 200, f"expected 200, got {r.status_code}: {r.text}"
        body = r.json()
        assert body.get("status") == "success"
        assert body.get("sent_to") == "delivered@resend.dev"
        assert "email_id" in body
        # Draft -> Sent status transition
        after = client.get(f"{BASE_URL}/api/estimates").json()
        found = next((x for x in after if x["id"] == e["id"]), None)
        assert found and found["status"] == "Sent"
        client.delete(f"{BASE_URL}/api/estimates/{e['id']}")
        client.delete(f"{BASE_URL}/api/clients/{c['id']}")


# ---------------- New: Client Detail ----------------
class TestClientDetail:
    def test_client_detail_shape_and_filtering(self, client):
        clients = client.get(f"{BASE_URL}/api/clients").json()
        # Prefer a seed client that has estimates/jobs (Sarah Mitchell - Won kitchen)
        target = next((c for c in clients if c["name"] == "Sarah Mitchell"), clients[0])
        r = client.get(f"{BASE_URL}/api/clients/{target['id']}/detail")
        assert r.status_code == 200
        d = r.json()
        for k in ["client", "estimates", "jobs", "invoices", "summary"]:
            assert k in d, f"missing {k}"
        assert d["client"]["id"] == target["id"]
        # All estimates must belong to this client_id
        for e in d["estimates"]:
            assert e["client_id"] == target["id"]
        # Jobs/invoices filtered by name
        for j in d["jobs"]:
            assert j["client_name"] == target["name"]
        for inv in d["invoices"]:
            assert inv["client_name"] == target["name"]
        s = d["summary"]
        for k in ["estimates_count", "open_pipeline", "won_value", "jobs_count",
                  "billed", "collected", "outstanding"]:
            assert k in s

    def test_client_detail_404(self, client):
        r = client.get(f"{BASE_URL}/api/clients/nonexistent-xyz/detail")
        assert r.status_code == 404

    def test_client_detail_requires_auth(self, anon):
        r = anon.get(f"{BASE_URL}/api/clients/anything/detail")
        assert r.status_code == 401


# ---------------- Logout ----------------
class TestLogout:
    def test_logout_endpoint(self):
        # Use a throw-away token so we don't invalidate the shared session
        # Just verify endpoint accepts and returns success
        r = requests.post(f"{BASE_URL}/api/auth/logout",
                          headers={"Authorization": "Bearer nonexistent_token"})
        assert r.status_code == 200
        assert r.json().get("success") is True
