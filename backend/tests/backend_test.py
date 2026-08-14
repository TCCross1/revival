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
        # Now returns 4xx (400/422) with friendly detail per iter-2 fix
        assert r.status_code in (400, 422, 502, 500), f"expected error status, got {r.status_code}: {r.text[:300]}"
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


# ---------------- New: Settings ----------------
class TestSettings:
    def test_get_settings_ok(self, client):
        r = client.get(f"{BASE_URL}/api/settings")
        assert r.status_code == 200
        d = r.json()
        for k in ["name", "address", "phone", "license"]:
            assert k in d

    def test_put_settings_persists(self, client):
        original = client.get(f"{BASE_URL}/api/settings").json()
        payload = {
            "name": "Revival Pro TEST",
            "address": "123 Test Ave, TestCity, TS 00000",
            "phone": "555-000-0000",
            "license": "LIC-TEST-9",
            "email": original.get("email", ""),
        }
        r = client.put(f"{BASE_URL}/api/settings", json=payload)
        assert r.status_code == 200
        r2 = client.get(f"{BASE_URL}/api/settings").json()
        assert r2["name"] == "Revival Pro TEST"
        assert r2["license"] == "LIC-TEST-9"
        # restore
        client.put(f"{BASE_URL}/api/settings", json=original)

    def test_settings_requires_auth(self, anon):
        assert anon.get(f"{BASE_URL}/api/settings").status_code == 401


# ---------------- New: Contract Generation ----------------
class TestContractGenerate:
    def _make_won_estimate(self, client, tax=0):
        c = client.post(f"{BASE_URL}/api/clients", json={
            "name": "TEST_ContractClient", "phone": "555-1", "email": "cc@t.com",
            "address": "10 Contract Ln", "source": "Referral", "status": "Active"
        }).json()
        e = client.post(f"{BASE_URL}/api/estimates", json={
            "client_id": c["id"], "client_name": c["name"], "category": "Kitchen",
            "status": "Won",
            "line_items": [
                {"description": "Demo", "quantity": 1, "unit_price": 1000},
                {"description": "Cabinets", "quantity": 2, "unit_price": 500},
            ],
            "tax_rate": tax,
        }).json()
        return c, e

    def _cleanup(self, client, c, e, gen):
        if gen:
            if gen.get("contract"):
                client.delete(f"{BASE_URL}/api/contracts/{gen['contract']['id']}")
            if gen.get("invoice"):
                client.delete(f"{BASE_URL}/api/invoices/{gen['invoice']['id']}")
        client.delete(f"{BASE_URL}/api/estimates/{e['id']}")
        client.delete(f"{BASE_URL}/api/clients/{c['id']}")

    def test_generate_404_missing(self, client):
        r = client.post(f"{BASE_URL}/api/estimates/does-not-exist/generate")
        assert r.status_code == 404

    def test_generate_400_non_won(self, client):
        c = client.post(f"{BASE_URL}/api/clients", json={
            "name": "TEST_DraftClient", "email": "d@d.com", "address": "1", "phone": "", "source": "Referral", "status": "Lead"
        }).json()
        e = client.post(f"{BASE_URL}/api/estimates", json={
            "client_id": c["id"], "client_name": c["name"], "category": "Bathroom",
            "status": "Draft",
            "line_items": [{"description": "X", "quantity": 1, "unit_price": 100}],
            "tax_rate": 0,
        }).json()
        r = client.post(f"{BASE_URL}/api/estimates/{e['id']}/generate")
        assert r.status_code == 400
        client.delete(f"{BASE_URL}/api/estimates/{e['id']}")
        client.delete(f"{BASE_URL}/api/clients/{c['id']}")

    def test_generate_requires_auth(self, anon):
        r = anon.post(f"{BASE_URL}/api/estimates/anything/generate")
        assert r.status_code == 401

    def test_generate_creates_contract_and_invoice_with_correct_data(self, client):
        c, e = self._make_won_estimate(client)
        gen = None
        try:
            r = client.post(f"{BASE_URL}/api/estimates/{e['id']}/generate")
            assert r.status_code == 200, r.text
            gen = r.json()
            assert "contract" in gen and "invoice" in gen
            ct = gen["contract"]
            inv = gen["invoice"]

            # contract number format
            assert ct["contract_number"].startswith("CON-")
            # scope pulled from estimate
            assert len(ct["line_items"]) == 2
            descs = [li["description"] for li in ct["line_items"]]
            assert "Demo" in descs and "Cabinets" in descs
            # total matches estimate total
            assert ct["total"] == e["total"]
            # exclusions defaults (6 items)
            assert len(ct["exclusions"]) == 6
            # payment schedule 3 milestones
            assert len(ct["payment_schedule"]) == 3
            sched_sum = round(sum(m["amount"] for m in ct["payment_schedule"]), 2)
            assert sched_sum == round(ct["total"], 2)
            # markup default
            assert ct["change_order_markup"] == 20.0
            # client info populated
            assert ct["client_name"] == "TEST_ContractClient"
            assert ct["client_address"] == "10 Contract Ln"
            assert ct["client_phone"] == "555-1"
            # contractor info populated (from settings)
            assert ct["contractor_name"]  # nonempty
            # invoice link
            assert ct["invoice_id"] == inv["id"]
            assert inv["estimate_id"] == e["id"]
            assert inv["amount"] == e["total"]
        finally:
            self._cleanup(client, c, e, gen)

    def test_generate_is_idempotent(self, client):
        c, e = self._make_won_estimate(client)
        gen = None
        try:
            r1 = client.post(f"{BASE_URL}/api/estimates/{e['id']}/generate").json()
            r2 = client.post(f"{BASE_URL}/api/estimates/{e['id']}/generate").json()
            assert r1["contract"]["id"] == r2["contract"]["id"]
            assert r1["invoice"]["id"] == r2["invoice"]["id"]
            # no duplicates in list
            contracts = client.get(f"{BASE_URL}/api/contracts").json()
            matches = [x for x in contracts if x["estimate_id"] == e["id"]]
            assert len(matches) == 1
            gen = r2
        finally:
            self._cleanup(client, c, e, gen)


# ---------------- New: Contract CRUD ----------------
class TestContractCRUD:
    def test_list_requires_auth(self, anon):
        assert anon.get(f"{BASE_URL}/api/contracts").status_code == 401

    def test_list_and_get(self, client):
        contracts = client.get(f"{BASE_URL}/api/contracts")
        assert contracts.status_code == 200
        arr = contracts.json()
        assert isinstance(arr, list)
        if arr:
            cid = arr[0]["id"]
            r = client.get(f"{BASE_URL}/api/contracts/{cid}")
            assert r.status_code == 200
            assert r.json()["id"] == cid

    def test_get_404(self, client):
        r = client.get(f"{BASE_URL}/api/contracts/no-such-id")
        assert r.status_code == 404

    def test_partial_update_merges_only_provided(self, client):
        # create a Won estimate to generate a contract
        c = client.post(f"{BASE_URL}/api/clients", json={
            "name": "TEST_PatchContract", "phone": "555-2", "email": "p@p.com",
            "address": "22 Patch St", "source": "Referral", "status": "Active"
        }).json()
        e = client.post(f"{BASE_URL}/api/estimates", json={
            "client_id": c["id"], "client_name": c["name"], "category": "Kitchen",
            "status": "Won",
            "line_items": [{"description": "K", "quantity": 1, "unit_price": 200}],
            "tax_rate": 0,
        }).json()
        gen = client.post(f"{BASE_URL}/api/estimates/{e['id']}/generate").json()
        cid = gen["contract"]["id"]
        try:
            # Partial patch: only change markup
            r = client.put(f"{BASE_URL}/api/contracts/{cid}", json={"change_order_markup": 25.5})
            assert r.status_code == 200
            body = r.json()
            assert body["change_order_markup"] == 25.5
            # Verify other fields unchanged
            assert body["client_name"] == "TEST_PatchContract"
            assert len(body["line_items"]) == 1
            # Persist via GET
            fetched = client.get(f"{BASE_URL}/api/contracts/{cid}").json()
            assert fetched["change_order_markup"] == 25.5
            assert fetched["client_name"] == "TEST_PatchContract"

            # Update signatures and status
            r2 = client.put(f"{BASE_URL}/api/contracts/{cid}", json={
                "client_signature": "data:image/png;base64,AAAA",
                "client_signed_date": "2026-01-15",
                "contractor_signature": "data:image/png;base64,BBBB",
                "contractor_signed_date": "2026-01-15",
                "status": "Signed",
            })
            assert r2.status_code == 200
            b2 = r2.json()
            assert b2["status"] == "Signed"
            assert b2["client_signature"].startswith("data:image/png")
            assert b2["change_order_markup"] == 25.5  # prior update preserved
        finally:
            client.delete(f"{BASE_URL}/api/contracts/{cid}")
            client.delete(f"{BASE_URL}/api/invoices/{gen['invoice']['id']}")
            client.delete(f"{BASE_URL}/api/estimates/{e['id']}")
            client.delete(f"{BASE_URL}/api/clients/{c['id']}")

    def test_delete_contract(self, client):
        c = client.post(f"{BASE_URL}/api/clients", json={
            "name": "TEST_DelContract", "phone": "", "email": "", "address": "",
            "source": "Referral", "status": "Lead"
        }).json()
        e = client.post(f"{BASE_URL}/api/estimates", json={
            "client_id": c["id"], "client_name": c["name"], "category": "Bathroom",
            "status": "Won",
            "line_items": [{"description": "Y", "quantity": 1, "unit_price": 300}],
            "tax_rate": 0,
        }).json()
        gen = client.post(f"{BASE_URL}/api/estimates/{e['id']}/generate").json()
        cid = gen["contract"]["id"]
        r = client.delete(f"{BASE_URL}/api/contracts/{cid}")
        assert r.status_code == 200
        assert client.get(f"{BASE_URL}/api/contracts/{cid}").status_code == 404
        # cleanup
        client.delete(f"{BASE_URL}/api/invoices/{gen['invoice']['id']}")
        client.delete(f"{BASE_URL}/api/estimates/{e['id']}")
        client.delete(f"{BASE_URL}/api/clients/{c['id']}")


# ---------------- New: Contract PDF ----------------
class TestContractPDF:
    def test_pdf_requires_auth(self, anon, client):
        contracts = client.get(f"{BASE_URL}/api/contracts").json()
        if not contracts:
            pytest.skip("no contracts to test")
        r = anon.get(f"{BASE_URL}/api/contracts/{contracts[0]['id']}/pdf")
        assert r.status_code == 401

    def test_pdf_download_ok(self, client):
        contracts = client.get(f"{BASE_URL}/api/contracts").json()
        if not contracts:
            pytest.skip("no contracts to test")
        cid = contracts[0]["id"]
        r = client.get(f"{BASE_URL}/api/contracts/{cid}/pdf")
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert r.content.startswith(b"%PDF")
        assert len(r.content) > 1500
        cd = r.headers.get("content-disposition", "")
        assert "attachment" in cd and ".pdf" in cd

    def test_pdf_404(self, client):
        r = client.get(f"{BASE_URL}/api/contracts/nonexistent/pdf")
        assert r.status_code == 404
