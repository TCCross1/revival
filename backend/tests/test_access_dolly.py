"""Owner login allow-list, bypass code, and Dolly FAQ."""
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from access_control import (
    admin_seed_accounts,
    allowed_login_emails,
    bypass_code_matches,
    login_allowed,
)
from dolly import dolly_reply, faq_reply


def test_default_allow_list_is_tim_and_christy(monkeypatch):
    monkeypatch.delenv("ALLOWED_LOGIN_EMAILS", raising=False)
    emails = allowed_login_emails()
    assert "christycross969@gmail.com" in emails
    assert "tccross1179@gmail.com" in emails
    assert login_allowed("TCCross1179@gmail.com")
    assert login_allowed("ChristyCross969@gmail.com")
    assert not login_allowed("stranger@example.com")


def test_bypass_code_from_env(monkeypatch):
    monkeypatch.setenv("LOGIN_BYPASS_CODE", "220122")
    assert bypass_code_matches("220122")
    assert not bypass_code_matches("000000")
    assert not bypass_code_matches("")


def test_admin_seed_accounts_include_both_owners(monkeypatch):
    monkeypatch.setenv("ADMIN_EMAIL", "tccross1179@gmail.com")
    monkeypatch.setenv("ADMIN_PASSWORD", "secret-pass")
    monkeypatch.setenv("ADMIN_EMAIL_2", "christycross969@gmail.com")
    monkeypatch.setenv("ADMIN_PASSWORD_2", "secret-pass")
    monkeypatch.setenv("ALLOWED_LOGIN_EMAILS", "christycross969@gmail.com,tccross1179@gmail.com")
    accounts = admin_seed_accounts()
    emails = {a[0] for a in accounts}
    assert "tccross1179@gmail.com" in emails
    assert "christycross969@gmail.com" in emails


def test_dolly_faq_covers_core_topics():
    assert "Import" in (faq_reply("How do I import a proposal?") or "")
    assert "Job sheet" in (faq_reply("What is the job sheet budget?") or "") or "job" in (faq_reply("What is the job sheet?") or "").lower()
    assert "Scan" in (faq_reply("How do I scan a kitchen?") or "") or "LiDAR" in (faq_reply("How do I scan a kitchen?") or "")
    assert "Tim" in (faq_reply("Who can login?") or "")


def test_dolly_reply_falls_back_without_llm_key(monkeypatch):
    import asyncio

    monkeypatch.delenv("EMERGENT_LLM_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    result = asyncio.run(dolly_reply("How do I import a proposal?"))
    assert result["source"] == "faq"
    assert "Clients" in result["reply"] or "Import" in result["reply"]
