"""Field & crew operations: roles, geofence math, labor, mileage."""
from __future__ import annotations

import math
from datetime import datetime, timezone

ROLES = ("admin", "manager", "field")
ROLE_LABELS = {
    "admin": "Owner / Admin",
    "manager": "Project Manager",
    "field": "Field Worker / Crew",
    "member": "Project Manager",
}

FEATURES = [
    {"id": "dashboard", "name": "Dashboard", "group": "Office"},
    {"id": "leads", "name": "Leads", "group": "Office"},
    {"id": "clients", "name": "Clients", "group": "Office"},
    {"id": "estimates", "name": "Estimates", "group": "Office"},
    {"id": "jobs", "name": "Jobs & job sheets", "group": "Office"},
    {"id": "floor_plans", "name": "Floor Plan Studio", "group": "Office"},
    {"id": "invoices", "name": "Invoices", "group": "Office"},
    {"id": "financials", "name": "Financials", "group": "Office"},
    {"id": "contracts", "name": "Contracts", "group": "Office"},
    {"id": "team", "name": "Team & permissions", "group": "Office"},
    {"id": "settings", "name": "Company profile", "group": "Office"},
    {"id": "field_home", "name": "Field home", "group": "Field"},
    {"id": "receipts", "name": "Receipt capture", "group": "Field"},
    {"id": "time_clock", "name": "Time clock", "group": "Field"},
    {"id": "mileage", "name": "Mileage tracking", "group": "Field"},
    {"id": "job_notes", "name": "Daily crew notes", "group": "Field"},
    {"id": "material_requests", "name": "Material requests", "group": "Field"},
    {"id": "tasks", "name": "Job tasks", "group": "Field"},
    {"id": "crew_schedule", "name": "Crew schedule", "group": "Field"},
    {"id": "notifications", "name": "Notifications", "group": "Field"},
]

OFFICE_FEATURES = [f["id"] for f in FEATURES if f["group"] == "Office"]
FIELD_FEATURES = [f["id"] for f in FEATURES if f["group"] == "Field"]
ALL_FEATURES = [f["id"] for f in FEATURES]

DEFAULT_MATRIX = {
    "admin": {key: True for key in ALL_FEATURES},
    "manager": {key: True for key in ALL_FEATURES if key != "team"},
    "field": {
        **{key: False for key in OFFICE_FEATURES},
        "jobs": True,
        **{key: True for key in FIELD_FEATURES},
        "team": False,
        "settings": False,
        "financials": False,
        "leads": False,
        "clients": False,
        "estimates": False,
        "invoices": False,
        "contracts": False,
        "floor_plans": False,
        "dashboard": False,
    },
}

DEFAULT_MILEAGE_RATE = 0.70
DEFAULT_GEOFENCE_RADIUS_M = 150.0


def normalize_role(role: str) -> str:
    raw = (role or "manager").strip().lower()
    if raw in ("owner", "admin"):
        return "admin"
    if raw in ("member", "pm", "project_manager", "manager"):
        return "manager"
    if raw in ("field", "crew", "worker", "field_worker"):
        return "field"
    return "manager"


def default_matrix() -> dict:
    return {role: dict(flags) for role, flags in DEFAULT_MATRIX.items()}


def merge_matrix(stored) -> dict:
    base = default_matrix()
    if not isinstance(stored, dict):
        return base
    roles = stored.get("roles") if isinstance(stored.get("roles"), dict) else stored
    for role in ROLES:
        incoming = roles.get(role) if isinstance(roles.get(role), dict) else {}
        for key in ALL_FEATURES:
            if key in incoming:
                base[role][key] = bool(incoming[key])
        base[role]["team"] = True if role == "admin" else bool(base[role].get("team"))
    base["admin"] = {key: True for key in ALL_FEATURES}
    return base


def can(role: str, feature: str, matrix: dict | None = None) -> bool:
    resolved = normalize_role(role)
    if resolved == "admin":
        return True
    flags = merge_matrix(matrix).get(resolved) or {}
    return bool(flags.get(feature))


def haversine_m(lat1, lng1, lat2, lng2) -> float:
    try:
        a1, b1, a2, b2 = float(lat1), float(lng1), float(lat2), float(lng2)
    except (TypeError, ValueError):
        return float("inf")
    r = 6371000.0
    p1, p2 = math.radians(a1), math.radians(a2)
    dp = math.radians(a2 - a1)
    dl = math.radians(b2 - b1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(h)))


def miles_between(lat1, lng1, lat2, lng2) -> float:
    return round(haversine_m(lat1, lng1, lat2, lng2) / 1609.344, 2)


def inside_geofence(geofence: dict | None, lat, lng) -> dict:
    if not geofence or geofence.get("lat") in (None, "") or geofence.get("lng") in (None, ""):
        return {"configured": False, "inside": True, "distance_m": None, "radius_m": None}
    try:
        radius = float(geofence.get("radius_m") or DEFAULT_GEOFENCE_RADIUS_M)
    except (TypeError, ValueError):
        radius = DEFAULT_GEOFENCE_RADIUS_M
    dist = haversine_m(geofence.get("lat"), geofence.get("lng"), lat, lng)
    return {
        "configured": True,
        "inside": dist <= radius,
        "distance_m": round(dist, 1),
        "radius_m": radius,
    }


def parse_iso(raw) -> datetime | None:
    if not raw:
        return None
    if isinstance(raw, datetime):
        return raw if raw.tzinfo else raw.replace(tzinfo=timezone.utc)
    try:
        text = str(raw).replace("Z", "+00:00")
        dt = datetime.fromisoformat(text)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def minutes_between(start, end) -> float:
    a, b = parse_iso(start), parse_iso(end)
    if not a or not b or b <= a:
        return 0.0
    return round((b - a).total_seconds() / 60.0, 2)


def labor_amount(minutes: float, hourly_rate: float) -> float:
    try:
        hours = max(float(minutes or 0), 0.0) / 60.0
        rate = max(float(hourly_rate or 0), 0.0)
    except (TypeError, ValueError):
        return 0.0
    return round(hours * rate, 2)


def job_visible_to(user_id: str, role: str, job: dict) -> bool:
    if normalize_role(role) != "field":
        return True
    crew = job.get("crew_ids") or []
    return user_id in crew


def normalize_geofence(raw) -> dict:
    data = raw if isinstance(raw, dict) else {}
    try:
        lat = float(data.get("lat"))
        lng = float(data.get("lng"))
    except (TypeError, ValueError):
        return {}
    try:
        radius = float(data.get("radius_m") or DEFAULT_GEOFENCE_RADIUS_M)
    except (TypeError, ValueError):
        radius = DEFAULT_GEOFENCE_RADIUS_M
    return {
        "lat": lat,
        "lng": lng,
        "radius_m": max(25.0, min(radius, 2000.0)),
        "label": str(data.get("label") or "").strip(),
    }
