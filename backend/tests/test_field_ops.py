"""Unit tests for field operations: roles, geofence, labor, mileage."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from field_ops import (
    can,
    haversine_m,
    inside_geofence,
    job_visible_to,
    labor_amount,
    merge_matrix,
    miles_between,
    minutes_between,
    normalize_geofence,
    normalize_role,
)


def test_role_aliases():
    assert normalize_role("admin") == "admin"
    assert normalize_role("owner") == "admin"
    assert normalize_role("member") == "manager"
    assert normalize_role("crew") == "field"


def test_field_cannot_see_financials_by_default():
    assert can("admin", "financials") is True
    assert can("manager", "financials") is True
    assert can("field", "financials") is False
    assert can("field", "receipts") is True
    assert can("field", "time_clock") is True


def test_permission_override():
    matrix = merge_matrix({"field": {"financials": True, "receipts": False}})
    assert can("field", "financials", matrix) is True
    assert can("field", "receipts", matrix) is False
    assert can("admin", "team", matrix) is True


def test_geofence_inside_and_out():
    fence = {"lat": 38.04, "lng": -84.5, "radius_m": 120}
    inside = inside_geofence(fence, 38.0402, -84.5001)
    assert inside["configured"] is True
    assert inside["inside"] is True
    far = inside_geofence(fence, 38.05, -84.52)
    assert far["inside"] is False
    assert haversine_m(38.04, -84.5, 38.05, -84.52) > 120


def test_miles_and_labor():
    assert miles_between(38.04, -84.5, 38.04, -84.5) == 0
    assert labor_amount(90, 40) == 60.0
    assert labor_amount(0, 40) == 0.0
    assert minutes_between("2026-08-15T12:00:00+00:00", "2026-08-15T13:30:00+00:00") == 90.0


def test_job_visibility():
    job = {"crew_ids": ["u1"]}
    assert job_visible_to("u1", "field", job) is True
    assert job_visible_to("u2", "field", job) is False
    assert job_visible_to("u2", "admin", job) is True
    assert job_visible_to("u2", "manager", job) is True


def test_normalize_geofence():
    fence = normalize_geofence({"lat": "38.1", "lng": "-84.5", "radius_m": 80, "label": "Site"})
    assert fence["lat"] == 38.1
    assert fence["radius_m"] == 80
    assert normalize_geofence({}) == {}


if __name__ == "__main__":
    test_role_aliases()
    test_field_cannot_see_financials_by_default()
    test_permission_override()
    test_geofence_inside_and_out()
    test_miles_and_labor()
    test_job_visibility()
    test_normalize_geofence()
    print("FIELD_OPS_OK")
