"""Unit tests for Google Drive folder naming and routing (no live Google calls)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from google_drive import (
    CLIENT_SUBFOLDERS,
    JOB_SHEETS_FOLDER,
    build_auth_url,
    client_folder_name,
    folder_structure_labels,
    folder_web_url,
    oauth_configured,
    sanitize_filename,
    sanitize_folder_name,
    set_runtime_oauth,
    subfolder_name_for_kind,
)


def test_folder_name_uses_client_name():
    assert client_folder_name({"name": "Linda Garcia"}) == "Linda Garcia"


def test_folder_name_adds_short_address():
    assert client_folder_name({
        "name": "Linda Garcia",
        "address": "123 Main St, Austin, TX 78701",
    }) == "Linda Garcia — 123 Main St"


def test_folder_url():
    assert folder_web_url("abc123") == "https://drive.google.com/drive/folders/abc123"
    assert folder_web_url("") == ""


def test_sanitize_strips_slashes():
    assert "/" not in sanitize_folder_name("A / B")


def test_sanitize_filename_keeps_extension():
    assert sanitize_filename("EST-1 Estimate.pdf") == "EST-1 Estimate.pdf"
    assert "/" not in sanitize_filename("bad/name.pdf")
    assert sanitize_filename("plan.pdf").endswith(".pdf")


def test_folder_structure_matches_spec():
    labels = folder_structure_labels()
    assert labels[0] == "Revival Pro"
    assert labels[1] == "Clients"
    assert "{Client Name}" in labels[2]
    for name in ("Floor Plans", "Receipts", "Reports", "Job Sheets", "Permit Details"):
        assert name in labels[3]
    assert "Permit Details" in CLIENT_SUBFOLDERS


def test_kind_routes_to_client_subfolder():
    assert subfolder_name_for_kind("floor_plan") == "Floor Plans"
    assert subfolder_name_for_kind("receipt") == "Receipts"
    assert subfolder_name_for_kind("receipts") == "Receipts"
    assert subfolder_name_for_kind("client_report") == "Reports"
    assert subfolder_name_for_kind("permit_details") == "Permit Details"
    assert subfolder_name_for_kind("job_sheet") == "Job Sheets"
    assert subfolder_name_for_kind("unknown") == JOB_SHEETS_FOLDER


def test_runtime_oauth_marks_configured():
    set_runtime_oauth("", "")
    before = oauth_configured()
    set_runtime_oauth("test-client.apps.googleusercontent.com", "test-secret-value")
    try:
        assert oauth_configured() is True
    finally:
        set_runtime_oauth("", "")
    assert oauth_configured() is before


def test_client_subfolders_match_owner_tree():
    assert CLIENT_SUBFOLDERS == (
        "Floor Plans",
        "Receipts",
        "Reports",
        "Permit Details",
        "Job Sheets",
    )


def test_auth_url_asks_for_offline_consent():
    set_runtime_oauth("test-client.apps.googleusercontent.com", "test-secret-value")
    try:
        url = build_auth_url("state-xyz")
        assert "access_type=offline" in url
        assert "prompt=consent" in url
        assert "include_granted_scopes" not in url
        assert "revivalhomeremodelingllc" in url
        assert "state-xyz" in url
    finally:
        set_runtime_oauth("", "")
