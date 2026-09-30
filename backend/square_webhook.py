"""Verify Square webhook signatures. Never logs the signature key or raw card data.

Square signs `notification_url + body` with HMAC-SHA256 and sends
`x-square-hmacsha256-signature`.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)


def configured_signature_key(override: str = "") -> str:
    return (override or os.environ.get("SQUARE_WEBHOOK_SIGNATURE_KEY") or "").strip()


def notification_url_from_request(url: str) -> str:
    return (url or "").split("?", 1)[0]


def verify_signature(*, body: bytes, signature: str, notification_url: str, signature_key: str) -> bool:
    key = (signature_key or "").strip()
    sig = (signature or "").strip()
    url = notification_url_from_request(notification_url)
    if not key or not sig or not url:
        return False
    try:
        digest = hmac.new(
            key.encode("utf-8"),
            (url.encode("utf-8") + (body or b"")),
            hashlib.sha256,
        ).digest()
        expected = base64.b64encode(digest).decode("utf-8")
        return hmac.compare_digest(expected, sig)
    except Exception:
        logger.exception("Square webhook signature compare failed")
        return False


def extract_signature(headers: dict) -> str:
    lowered = {str(k).lower(): str(v) for k, v in (headers or {}).items()}
    return (lowered.get("x-square-hmacsha256-signature") or "").strip()


def event_type(payload: dict | None) -> str:
    data = payload or {}
    return str(data.get("type") or data.get("event_type") or "").strip()


def event_id(payload: dict | None) -> str:
    data = payload or {}
    return str(data.get("event_id") or data.get("id") or "").strip()


def object_payload(payload: dict | None) -> dict:
    data = (payload or {}).get("data") or {}
    obj = data.get("object") if isinstance(data, dict) else {}
    return obj if isinstance(obj, dict) else {}
