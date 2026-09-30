"""Normalize Google Ads and Angi lead webhook payloads into Revival lead fields."""
from __future__ import annotations

from typing import Any


def _text(*values) -> str:
    for value in values:
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return ""


def _dig(data: Any, *path):
    cur = data
    for key in path:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(key)
    return cur


def parse_google_ads_payload(body: Any) -> dict:
    """Accept Google Ads Lead Form webhooks and common Zapier/Make shapes."""
    raw = body if isinstance(body, dict) else {}
    user_cols = raw.get("user_column_data") or raw.get("userColumnData") or []
    col_map = {}
    if isinstance(user_cols, list):
        for row in user_cols:
            if not isinstance(row, dict):
                continue
            key = _text(row.get("column_id"), row.get("columnId"), row.get("id")).upper()
            val = _text(row.get("string_value"), row.get("stringValue"), row.get("value"))
            if key:
                col_map[key] = val

    name = _text(
        raw.get("name"),
        raw.get("full_name"),
        raw.get("fullName"),
        " ".join([_text(raw.get("first_name"), raw.get("firstName")), _text(raw.get("last_name"), raw.get("lastName"))]).strip(),
        col_map.get("FULL_NAME"),
        " ".join([col_map.get("FIRST_NAME", ""), col_map.get("LAST_NAME", "")]).strip(),
    )
    phone = _text(
        raw.get("phone"),
        raw.get("phone_number"),
        raw.get("phoneNumber"),
        col_map.get("PHONE_NUMBER"),
        col_map.get("PHONE"),
    )
    email = _text(raw.get("email"), raw.get("email_address"), col_map.get("EMAIL"))
    address = _text(
        raw.get("address"),
        raw.get("street_address"),
        col_map.get("STREET_ADDRESS"),
        ", ".join(
            [
                x
                for x in [
                    col_map.get("CITY", ""),
                    col_map.get("REGION", "") or col_map.get("STATE", ""),
                    col_map.get("POSTAL_CODE", "") or col_map.get("ZIP", ""),
                ]
                if x
            ]
        ),
    )
    project_type = _text(
        raw.get("project_type"),
        raw.get("projectType"),
        raw.get("service"),
        col_map.get("PROJECT_TYPE"),
        "Kitchen Remodel",
    ) or "Kitchen Remodel"
    external_id = _text(
        raw.get("lead_id"),
        raw.get("leadId"),
        raw.get("gclid"),
        raw.get("id"),
        _dig(raw, "google_key"),
    )
    notes_bits = [
        "Source: Google Ads lead form",
        f"Campaign: {_text(raw.get('campaign_id'), raw.get('campaignId'))}" if _text(raw.get("campaign_id"), raw.get("campaignId")) else "",
        f"Form: {_text(raw.get('form_id'), raw.get('formId'))}" if _text(raw.get("form_id"), raw.get("formId")) else "",
        _text(raw.get("notes"), raw.get("message"), raw.get("comments")),
    ]
    return {
        "name": name,
        "phone": phone,
        "email": email,
        "address": address,
        "project_type": project_type,
        "source": "Google",
        "notes": "\n".join([b for b in notes_bits if b]),
        "external_id": external_id,
        "external_id_field": "google_ads_lead_id",
    }


def parse_angi_payload(body: Any) -> dict:
    """Accept Angi/HomeAdvisor lead webhooks and Zapier/email-bridge JSON."""
    raw = body if isinstance(body, dict) else {}
    lead = raw.get("lead") if isinstance(raw.get("lead"), dict) else raw
    customer = lead.get("customer") if isinstance(lead.get("customer"), dict) else {}
    name = _text(
        lead.get("name"),
        lead.get("customerName"),
        customer.get("name"),
        customer.get("displayName"),
        " ".join([_text(customer.get("firstName")), _text(customer.get("lastName"))]).strip(),
    )
    phone = _text(
        lead.get("phone"),
        lead.get("phoneNumber"),
        customer.get("phone"),
        customer.get("primaryPhone"),
    )
    email = _text(lead.get("email"), customer.get("email"))
    address = _text(
        lead.get("address"),
        lead.get("serviceAddress"),
        customer.get("address"),
        ", ".join(
            [
                x
                for x in [
                    _text(_dig(customer, "location", "address1"), customer.get("address1")),
                    _text(_dig(customer, "location", "city"), customer.get("city")),
                    _text(_dig(customer, "location", "state"), customer.get("state")),
                    _text(_dig(customer, "location", "zipCode"), customer.get("zip")),
                ]
                if x
            ]
        ),
    )
    project_type = _text(
        lead.get("project_type"),
        lead.get("taskName"),
        lead.get("category"),
        _dig(lead, "category", "name"),
        "Kitchen Remodel",
    ) or "Kitchen Remodel"
    external_id = _text(
        lead.get("leadId"),
        lead.get("lead_id"),
        lead.get("srOid"),
        lead.get("id"),
        raw.get("id"),
    )
    notes = _text(lead.get("notes"), lead.get("description"), lead.get("comments"), raw.get("notes"))
    return {
        "name": name,
        "phone": phone,
        "email": email,
        "address": address,
        "project_type": project_type,
        "source": "Angi",
        "notes": notes or "Source: Angi lead",
        "external_id": external_id,
        "external_id_field": "angi_lead_id",
    }
