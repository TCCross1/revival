"""Square Payments, Terminal, Bank Accounts, and Banking HTTP client.

Never logs access tokens, webhook keys, payment nonces, or card data.
Sandbox host: connect.squareupsandbox.com
Production host: connect.squareup.com
"""
from __future__ import annotations

import logging
import os
import uuid
from typing import Any, Optional
from urllib.parse import urlencode

import httpx

logger = logging.getLogger(__name__)

SQUARE_VERSION = "2026-07-16"
PRODUCTION_HOST = "https://connect.squareup.com"
SANDBOX_HOST = "https://connect.squareupsandbox.com"
OAUTH_AUTHORIZE = "https://squareup.com/oauth2/authorize"
OAUTH_SANDBOX_AUTHORIZE = "https://squareupsandbox.com/oauth2/authorize"

# Square Savings folders are a Banking product. Public REST coverage is limited;
# we call the documented Banking paths and record a clear failure if Square
# returns 404 / NOT_FOUND so deposits are never dropped.
BANKING_ACCOUNT_PATHS = (
    "/v2/banking/accounts",
    "/v2/financial-accounts",
)
BANKING_TRANSFER_PATHS = (
    "/v2/banking/transfers",
    "/v2/transfers",
)

BANKING_SCOPES = (
    "PAYMENTS_READ",
    "PAYMENTS_WRITE",
    "PAYMENTS_WRITE_IN_PERSON",
    "ORDERS_READ",
    "ORDERS_WRITE",
    "MERCHANT_PROFILE_READ",
    "BANK_ACCOUNTS_READ",
    "BANK_ACCOUNTS_WRITE",
    "DEVICE_CREDENTIAL_MANAGEMENT",
    "PAYOUTS_READ",
)


class SquareClientError(RuntimeError):
    def __init__(self, message: str, *, status_code: int = 0, code: str = "", body: Any = None):
        super().__init__(message)
        self.status_code = status_code
        self.code = code or ""
        self.body = body


def environment_name(raw: str = "") -> str:
    value = (raw or os.environ.get("SQUARE_ENVIRONMENT") or "production").strip().lower()
    return "sandbox" if value in ("sandbox", "sand", "test") else "production"


def api_base(env: str = "") -> str:
    return SANDBOX_HOST if environment_name(env) == "sandbox" else PRODUCTION_HOST


def _error_message(payload: Any, fallback: str) -> str:
    if isinstance(payload, dict):
        errors = payload.get("errors") or []
        if errors and isinstance(errors[0], dict):
            detail = (errors[0].get("detail") or errors[0].get("code") or "").strip()
            if detail:
                return detail
        message = (payload.get("message") or "").strip()
        if message:
            return message
    return fallback


def _error_code(payload: Any) -> str:
    if isinstance(payload, dict):
        errors = payload.get("errors") or []
        if errors and isinstance(errors[0], dict):
            return str(errors[0].get("code") or "").strip()
    return ""


class SquareClient:
    def __init__(
        self,
        access_token: str,
        *,
        environment: str = "",
        location_id: str = "",
        application_id: str = "",
        timeout: float = 30.0,
    ):
        self.access_token = (access_token or "").strip()
        self.environment = environment_name(environment)
        self.location_id = (location_id or "").strip()
        self.application_id = (application_id or "").strip()
        self.timeout = timeout
        self.base = api_base(self.environment)
        self.banking_available: Optional[bool] = None
        self.last_banking_error = ""

    def configured(self) -> bool:
        return bool(self.access_token)

    def _headers(self, idempotency_key: str = "") -> dict:
        headers = {
            "Authorization": f"Bearer {self.access_token}",
            "Square-Version": SQUARE_VERSION,
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        return headers

    async def request(
        self,
        method: str,
        path: str,
        *,
        json: Any = None,
        params: dict | None = None,
        idempotency_key: str = "",
    ) -> dict:
        if not self.access_token:
            raise SquareClientError("Square is not connected. Add an access token in Company Profile.", code="NOT_CONNECTED")
        url = path if path.startswith("http") else f"{self.base}{path}"
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.request(
                    method.upper(),
                    url,
                    headers=self._headers(idempotency_key),
                    json=json,
                    params=params or None,
                )
        except httpx.TimeoutException:
            logger.warning("Square API timeout method=%s path=%s", method, path)
            raise SquareClientError("Square did not respond in time. Try again.", code="TIMEOUT")
        except Exception:
            logger.exception("Square API transport failed method=%s path=%s", method, path)
            raise SquareClientError("Could not reach Square. Try again.", code="NETWORK")
        payload: Any = {}
        try:
            payload = resp.json() if resp.content else {}
        except Exception:
            payload = {}
        if resp.status_code >= 400:
            code = _error_code(payload) or f"HTTP_{resp.status_code}"
            message = _error_message(payload, f"Square request failed ({resp.status_code}).")
            logger.warning(
                "Square API error method=%s path=%s status=%s code=%s",
                method, path, resp.status_code, code,
            )
            raise SquareClientError(message, status_code=resp.status_code, code=code, body=payload)
        return payload if isinstance(payload, dict) else {}

    async def list_locations(self) -> list[dict]:
        data = await self.request("GET", "/v2/locations")
        return list(data.get("locations") or [])

    async def list_bank_accounts(self) -> list[dict]:
        data = await self.request("GET", "/v2/bank-accounts")
        return list(data.get("bank_accounts") or [])

    async def list_devices(self) -> list[dict]:
        try:
            data = await self.request("GET", "/v2/devices")
            return list(data.get("devices") or [])
        except SquareClientError as exc:
            if exc.status_code in (404, 403):
                return []
            raise

    async def get_payment(self, payment_id: str) -> dict:
        data = await self.request("GET", f"/v2/payments/{payment_id}")
        return data.get("payment") or {}

    async def list_payments(self, *, begin_time: str = "", cursor: str = "", limit: int = 100) -> dict:
        params: dict[str, Any] = {"limit": max(1, min(int(limit or 100), 100))}
        if begin_time:
            params["begin_time"] = begin_time
        if cursor:
            params["cursor"] = cursor
        if self.location_id:
            params["location_id"] = self.location_id
        return await self.request("GET", "/v2/payments", params=params)

    async def create_payment(
        self,
        *,
        source_id: str,
        amount_cents: int,
        idempotency_key: str,
        reference_id: str = "",
        note: str = "",
        autocomplete: bool = True,
    ) -> dict:
        body: dict[str, Any] = {
            "idempotency_key": idempotency_key,
            "source_id": source_id,
            "amount_money": {"amount": int(amount_cents), "currency": "USD"},
            "autocomplete": autocomplete,
        }
        if self.location_id:
            body["location_id"] = self.location_id
        if reference_id:
            body["reference_id"] = reference_id
        if note:
            body["note"] = note[:500]
        data = await self.request("POST", "/v2/payments", json=body, idempotency_key=idempotency_key)
        return data.get("payment") or {}

    async def create_terminal_checkout(
        self,
        *,
        amount_cents: int,
        idempotency_key: str,
        device_id: str,
        reference_id: str = "",
        note: str = "",
    ) -> dict:
        body = {
            "idempotency_key": idempotency_key,
            "checkout": {
                "amount_money": {"amount": int(amount_cents), "currency": "USD"},
                "device_options": {"device_id": device_id, "skip_receipt_screen": False},
                "payment_type": "CARD_PRESENT",
            },
        }
        if reference_id:
            body["checkout"]["reference_id"] = reference_id
        if note:
            body["checkout"]["note"] = note[:500]
        data = await self.request("POST", "/v2/terminals/checkouts", json=body, idempotency_key=idempotency_key)
        return data.get("checkout") or {}

    async def get_terminal_checkout(self, checkout_id: str) -> dict:
        data = await self.request("GET", f"/v2/terminals/checkouts/{checkout_id}")
        return data.get("checkout") or {}

    async def create_payment_link(
        self,
        *,
        amount_cents: int,
        idempotency_key: str,
        name: str,
        reference_id: str = "",
        redirect_url: str = "",
    ) -> dict:
        body: dict[str, Any] = {
            "idempotency_key": idempotency_key,
            "quick_pay": {
                "name": (name or "Job deposit")[:255],
                "price_money": {"amount": int(amount_cents), "currency": "USD"},
            },
        }
        if self.location_id:
            body["quick_pay"]["location_id"] = self.location_id
        checkout_opts: dict[str, Any] = {}
        if redirect_url:
            checkout_opts["redirect_url"] = redirect_url
        if reference_id:
            checkout_opts["redirect_url"] = redirect_url or checkout_opts.get("redirect_url") or ""
        payment_note = {"reference_id": reference_id} if reference_id else {}
        if checkout_opts:
            body["checkout_options"] = checkout_opts
        if payment_note:
            body["payment_note"] = reference_id
        data = await self.request("POST", "/v2/online-checkout/payment-links", json=body, idempotency_key=idempotency_key)
        return data.get("payment_link") or {}

    async def _first_working_get(self, paths: tuple[str, ...]) -> tuple[str, dict]:
        last: Optional[SquareClientError] = None
        for path in paths:
            try:
                payload = await self.request("GET", path)
                return path, payload
            except SquareClientError as exc:
                last = exc
                if exc.status_code in (404, 405) or exc.code in ("NOT_FOUND", "NOT_FOUND_ERROR"):
                    continue
                if exc.status_code == 403:
                    continue
                raise
        if last:
            raise last
        raise SquareClientError("Square Banking is not available on this account.", code="SQUARE_BANKING_UNAVAILABLE")

    async def list_savings_folders(self) -> list[dict]:
        try:
            _path, payload = await self._first_working_get(BANKING_ACCOUNT_PATHS)
            self.banking_available = True
            self.last_banking_error = ""
            folders = (
                payload.get("accounts")
                or payload.get("financial_accounts")
                or payload.get("banking_accounts")
                or payload.get("savings_folders")
                or []
            )
            rows = []
            for item in folders:
                if not isinstance(item, dict):
                    continue
                kind = str(item.get("type") or item.get("account_type") or "").upper()
                rows.append({
                    "id": item.get("id") or "",
                    "name": item.get("name") or item.get("display_name") or "Savings",
                    "type": kind or "SAVINGS",
                    "balance": item.get("available_balance") or item.get("balance") or item.get("available_money") or {},
                    "raw_type": kind,
                })
            return [r for r in rows if r.get("id")]
        except SquareClientError as exc:
            self.banking_available = False
            self.last_banking_error = str(exc)
            logger.warning("Square Savings folder list unavailable code=%s", exc.code)
            raise

    async def get_savings_folder(self, folder_id: str) -> dict:
        last: Optional[SquareClientError] = None
        for base in BANKING_ACCOUNT_PATHS:
            try:
                payload = await self.request("GET", f"{base}/{folder_id}")
                self.banking_available = True
                account = payload.get("account") or payload.get("financial_account") or payload
                return account if isinstance(account, dict) else {}
            except SquareClientError as exc:
                last = exc
                if exc.status_code in (404, 405):
                    continue
                raise
        if last:
            raise last
        return {}

    async def create_savings_folder(self, *, name: str, idempotency_key: str) -> dict:
        body = {
            "idempotency_key": idempotency_key,
            "name": name,
            "display_name": name,
            "type": "SAVINGS_FOLDER",
            "account_type": "SAVINGS_FOLDER",
        }
        last: Optional[SquareClientError] = None
        for path in BANKING_ACCOUNT_PATHS:
            try:
                payload = await self.request("POST", path, json=body, idempotency_key=idempotency_key)
                self.banking_available = True
                account = payload.get("account") or payload.get("financial_account") or payload
                if isinstance(account, dict) and account.get("id"):
                    return account
                if payload.get("id"):
                    return payload
            except SquareClientError as exc:
                last = exc
                if exc.status_code in (404, 405) or exc.code in ("NOT_FOUND", "METHOD_NOT_ALLOWED"):
                    continue
                raise
        self.banking_available = False
        message = str(last) if last else "Square Savings folders cannot be created via API on this account."
        raise SquareClientError(message, code="SQUARE_BANKING_UNAVAILABLE", status_code=getattr(last, "status_code", 404))

    async def transfer(
        self,
        *,
        from_account_id: str,
        to_account_id: str,
        amount_cents: int,
        idempotency_key: str,
        note: str = "",
    ) -> dict:
        body: dict[str, Any] = {
            "idempotency_key": idempotency_key,
            "from_account_id": from_account_id,
            "to_account_id": to_account_id,
            "source_id": from_account_id,
            "destination_id": to_account_id,
            "amount_money": {"amount": int(amount_cents), "currency": "USD"},
        }
        if note:
            body["note"] = note[:500]
        last: Optional[SquareClientError] = None
        for path in BANKING_TRANSFER_PATHS:
            try:
                payload = await self.request("POST", path, json=body, idempotency_key=idempotency_key)
                self.banking_available = True
                transfer = payload.get("transfer") or payload
                return transfer if isinstance(transfer, dict) else payload
            except SquareClientError as exc:
                last = exc
                if exc.status_code in (404, 405) or exc.code in ("NOT_FOUND", "METHOD_NOT_ALLOWED"):
                    continue
                raise
        self.banking_available = False
        message = str(last) if last else "Square Banking transfers are not available on this account."
        raise SquareClientError(message, code="SQUARE_BANKING_UNAVAILABLE", status_code=getattr(last, "status_code", 404))

    def folder_balance_dollars(self, folder: dict | None) -> Optional[float]:
        folder = folder or {}
        money = folder.get("available_balance") or folder.get("balance") or folder.get("available_money") or {}
        if isinstance(money, dict) and money.get("amount") is not None:
            try:
                return round(int(money.get("amount") or 0) / 100.0, 2)
            except (TypeError, ValueError):
                return None
        if isinstance(money, (int, float)):
            return round(float(money) / (100.0 if money > 1000 else 1.0), 2)
        return None


def oauth_authorize_url(*, client_id: str, redirect_uri: str, state: str, environment: str = "") -> str:
    host = OAUTH_SANDBOX_AUTHORIZE if environment_name(environment) == "sandbox" else OAUTH_AUTHORIZE
    params = {
        "client_id": client_id,
        "scope": " ".join(BANKING_SCOPES),
        "session": "false",
        "state": state,
        "redirect_uri": redirect_uri,
    }
    return f"{host}?{urlencode(params)}"


async def oauth_exchange_code(
    *,
    client_id: str,
    client_secret: str,
    code: str,
    redirect_uri: str,
    environment: str = "",
) -> dict:
    base = api_base(environment)
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"{base}/oauth2/token",
            json={
                "client_id": client_id,
                "client_secret": client_secret,
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": redirect_uri,
            },
            headers={"Square-Version": SQUARE_VERSION, "Content-Type": "application/json"},
        )
    payload = {}
    try:
        payload = resp.json() if resp.content else {}
    except Exception:
        payload = {}
    if resp.status_code >= 400:
        raise SquareClientError(
            _error_message(payload, "Square did not complete sign-in."),
            status_code=resp.status_code,
            code=_error_code(payload),
        )
    return payload if isinstance(payload, dict) else {}


def new_idempotency_key() -> str:
    return str(uuid.uuid4())
