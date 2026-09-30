"""Owner-only login gate for Revival Pro.

Allowed emails and the optional bypass code come from environment variables so
passwords and codes are never committed to git.
"""
from __future__ import annotations

import os


DEFAULT_ALLOWED_EMAILS = (
    "christycross969@gmail.com",
    "tccross1179@gmail.com",
)


def allowed_login_emails() -> set[str]:
    raw = (os.environ.get("ALLOWED_LOGIN_EMAILS") or "").strip()
    if raw:
        return {part.strip().lower() for part in raw.split(",") if part.strip()}
    return {email.lower() for email in DEFAULT_ALLOWED_EMAILS}


def login_allowed(email: str) -> bool:
    wanted = (email or "").strip().lower()
    if not wanted:
        return False
    return wanted in allowed_login_emails()


def login_bypass_code() -> str:
    return (os.environ.get("LOGIN_BYPASS_CODE") or "").strip()


def bypass_code_matches(code: str) -> bool:
    expected = login_bypass_code()
    if not expected:
        return False
    return (code or "").strip() == expected


def admin_seed_accounts() -> list[tuple[str, str, str]]:
    """Return (email, password, display_name) pairs to seed as admins."""
    accounts: list[tuple[str, str, str]] = []
    primary_email = (os.environ.get("ADMIN_EMAIL") or "").strip().lower()
    primary_password = os.environ.get("ADMIN_PASSWORD") or ""
    if primary_email and primary_password:
        accounts.append((primary_email, primary_password, os.environ.get("ADMIN_NAME") or "Tim"))

    second_email = (os.environ.get("ADMIN_EMAIL_2") or "").strip().lower()
    second_password = os.environ.get("ADMIN_PASSWORD_2") or primary_password
    if second_email and second_password:
        accounts.append((second_email, second_password, os.environ.get("ADMIN_NAME_2") or "Christy"))

    # Ensure the default owner pair is present when env uses the shared password.
    shared = os.environ.get("ADMIN_SHARED_PASSWORD") or ""
    for email, name in (
        ("tccross1179@gmail.com", "Tim"),
        ("christycross969@gmail.com", "Christy"),
    ):
        if email in {a[0] for a in accounts}:
            continue
        password = shared or primary_password
        if password and email in allowed_login_emails():
            accounts.append((email, password, name))
    return accounts
