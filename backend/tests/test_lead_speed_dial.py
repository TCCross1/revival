"""Unit tests for marketplace lead parsers and calling settings."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from calling_settings import auto_call_allowed_for_source, normalize_calling_settings
from lead_ingest_webhooks import parse_angi_payload, parse_google_ads_payload


def test_google_ads_flat_and_column_shapes():
    flat = parse_google_ads_payload(
        {
            "full_name": "Alex Rivera",
            "phone_number": "8595550111",
            "email": "alex@example.com",
            "lead_id": "gads-1",
        }
    )
    assert flat["name"] == "Alex Rivera"
    assert flat["phone"] == "8595550111"
    assert flat["source"] == "Google"
    assert flat["external_id"] == "gads-1"

    cols = parse_google_ads_payload(
        {
            "user_column_data": [
                {"column_id": "FULL_NAME", "string_value": "Sam Lee"},
                {"column_id": "PHONE_NUMBER", "string_value": "5125550198"},
            ],
            "lead_id": "gads-2",
        }
    )
    assert cols["name"] == "Sam Lee"
    assert cols["phone"] == "5125550198"


def test_angi_parser():
    parsed = parse_angi_payload(
        {
            "lead": {
                "leadId": "angi-9",
                "customer": {"name": "Pat Ng", "phone": "8595550144", "email": "pat@example.com"},
                "taskName": "Bathroom Remodel",
            }
        }
    )
    assert parsed["name"] == "Pat Ng"
    assert parsed["source"] == "Angi"
    assert parsed["external_id"] == "angi-9"
    assert parsed["project_type"] == "Bathroom Remodel"


def test_calling_settings_source_gates():
    settings = normalize_calling_settings(
        {"auto_call_enabled": True, "auto_call_thumbtack": True, "auto_call_google_ads": False, "auto_call_angi": True}
    )
    assert auto_call_allowed_for_source(settings, "Thumbtack") is True
    assert auto_call_allowed_for_source(settings, "Google") is False
    assert auto_call_allowed_for_source(settings, "Angi") is True
    settings["auto_call_enabled"] = False
    assert auto_call_allowed_for_source(settings, "Thumbtack") is False
