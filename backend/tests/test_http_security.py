"""Unit tests for CORS allow-list and Thumbtack webhook fail-closed rules."""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from http_security import LOCAL_CORS_ORIGINS, cors_allow_origins
from thumbtack_webhook import is_loopback_request, webhook_authorized


def test_cors_rejects_wildcard():
    assert cors_allow_origins("*") == list(LOCAL_CORS_ORIGINS)
    assert cors_allow_origins("") == list(LOCAL_CORS_ORIGINS)
    assert "*" not in cors_allow_origins("*,http://localhost:3000")


def test_cors_keeps_explicit_origins():
    got = cors_allow_origins("https://app.revivalhr.com, http://localhost:3000")
    assert got == ["https://app.revivalhr.com", "http://localhost:3000"]
    assert "*" not in got


def test_unsigned_webhook_only_on_true_localhost():
    prev = os.environ.get("THUMBTACK_WEBHOOK_SECRET")
    os.environ["THUMBTACK_WEBHOOK_SECRET"] = ""
    try:
        assert webhook_authorized({}, client_host="127.0.0.1", http_host="127.0.0.1:8001") is True
        assert webhook_authorized({}, client_host="127.0.0.1", http_host="localhost:8001") is True
        assert webhook_authorized({}, client_host="127.0.0.1", http_host="abc.ngrok-free.app") is False
        assert webhook_authorized({}, client_host="203.0.113.9", http_host="localhost:8001") is False
        assert webhook_authorized({}, client_host="203.0.113.9", http_host="api.example.com") is False
    finally:
        if prev is None:
            os.environ.pop("THUMBTACK_WEBHOOK_SECRET", None)
        else:
            os.environ["THUMBTACK_WEBHOOK_SECRET"] = prev


def test_configured_secret_always_required():
    prev = os.environ.get("THUMBTACK_WEBHOOK_SECRET")
    os.environ["THUMBTACK_WEBHOOK_SECRET"] = "unit-test-thumbtack-secret"
    try:
        assert webhook_authorized({}, client_host="127.0.0.1", http_host="127.0.0.1:8001") is False
        assert webhook_authorized(
            {"X-Thumbtack-Webhook-Secret": "unit-test-thumbtack-secret"},
            client_host="203.0.113.9",
            http_host="abc.ngrok-free.app",
        ) is True
        assert webhook_authorized(
            {"X-Thumbtack-Webhook-Secret": "wrong"},
            client_host="127.0.0.1",
            http_host="127.0.0.1:8001",
        ) is False
    finally:
        if prev is None:
            os.environ.pop("THUMBTACK_WEBHOOK_SECRET", None)
        else:
            os.environ["THUMBTACK_WEBHOOK_SECRET"] = prev


def test_ngrok_peer_is_not_treated_as_local():
    assert is_loopback_request("127.0.0.1", "xyz.ngrok-free.app") is False
    assert is_loopback_request("127.0.0.1", "127.0.0.1:8001") is True
