"""Subcontractor portal domain tests."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from subcontractors import (
    hash_invite_token,
    next_invite_status,
    normalize_scope,
    public_job,
    template_for,
    unanswered_count,
    valid_email,
)


def test_invite_status_machine():
    assert next_invite_status("invited", "view") == "viewed"
    assert next_invite_status("viewed", "submit") == "submitted"
    assert next_invite_status("submitted", "submit") == "submitted"
    assert next_invite_status("viewed", "decline") == "declined"
    assert next_invite_status("awarded", "decline") == "awarded"
    assert next_invite_status("declined", "award") == "declined"
    assert next_invite_status("submitted", "award") == "awarded"


def test_token_hash_is_stable_and_not_plaintext():
    raw = "abc123-invite-token-value"
    digest = hash_invite_token(raw)
    assert digest == hash_invite_token(raw)
    assert digest != raw
    assert len(digest) == 64


def test_scope_templates_and_email():
    assert normalize_scope("cabinetry") == "Cabinetry"
    assert normalize_scope("foundations") == "Foundations"
    assert "cabinet" in template_for("Cabinetry").lower()
    assert "foundation" in template_for("Foundations").lower()
    assert valid_email("trade@example.com")
    assert not valid_email("not-an-email")


def test_ranking_prefers_review_volume_then_stars():
    from subcontractors import ranking_key
    high_volume = ranking_key({"company_name": "A", "review_count": 500, "rating": 4.5})
    low_volume_high_stars = ranking_key({"company_name": "B", "review_count": 20, "rating": 5.0})
    assert high_volume < low_volume_high_stars


def test_public_job_hides_client_and_money():
    shown = public_job({
        "id": "j1",
        "name": "Lexington kitchen",
        "job_number": "JOB-1",
        "client_name": "Secret Client",
        "budget": 88000,
        "address": "12 Main",
    })
    assert shown["name"] == "Lexington kitchen"
    assert shown["client_name"] == ""
    assert "budget" not in shown
    assert unanswered_count([
        {"question": True, "answered": False},
        {"question": True, "answered": True},
        {"question": False},
    ]) == 1


def test_publicize_blob_uses_token_path_not_gc_auth():
    from subcontractors import publicize_file_ref
    shown = publicize_file_ref({"file_id": "f1", "filename": "site.mp4"}, "secret-token-value")
    assert shown["url"].endswith("/api/public/sub/secret-token-value/files/f1")
    assert "bid-files" not in shown["url"]
    drive = publicize_file_ref({"web_view_link": "https://drive.google.com/file/x", "file_id": "f1"}, "secret-token-value")
    assert drive["web_view_link"].startswith("https://")
