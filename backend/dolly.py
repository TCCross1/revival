"""Dolly — Revival Pro's friendly in-app guide.

Answers Tim and Christy's questions about how the app works. Uses an LLM when
EMERGENT_LLM_KEY or OPENAI_API_KEY is set; otherwise a built-in FAQ so Dolly
still helps offline.
"""
from __future__ import annotations

import logging
import os
import re
from typing import Optional

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """
You are Dolly, the warm, witty in-app guide for Revival Pro — Revival Home Remodeling's
business app for Tim and Christy Cross. Speak like a kind Southern friend: clear,
encouraging, never condescending. Keep answers short (2–6 sentences) unless they ask
for steps. You are an expert on THIS app only.

What Revival Pro does:
- Clients: contact book; Import proposal uploads a Revival Word estimate/contract and
  creates the client master file, won estimate, sent contract, invoice, and job sheet.
- Jobs / Job sheet: budget, income, materials/labor categories, committed vs actual costs.
- Plans / Scan room: draw or LiDAR-scan kitchens and bathrooms; verify measurements marked
  from scan – verify before ordering.
- Estimates, Contracts, Invoices, Financials: pipeline, outstanding invoices, YTD collected
  cash (paid amounts only — unpaid invoices do not inflate income).
- Leads, Calendar, Team, Field tools for the crew.

Login: only Christy (christycross969@gmail.com) and Tim (tccross1179@gmail.com) may sign in.
There is also an owner bypass code configured by the shop (do not invent or reveal codes).

If you do not know something, say so and suggest where in the app to look. Never invent
pricing for a real client job. Never ask for credit cards or social security numbers.
""".strip()

FAQ = [
    (
        re.compile(r"import|proposal|docx|word|contract.*upload|vickie|brooks", re.I),
        "Sugar, go to Clients and tap Import proposal. Upload the Revival Word file — "
        "Revival builds the client master file, a Won estimate, the contract, the invoice, "
        "and the job sheet so the sale shows on the client, the job, and Financials. "
        "Deposits that are only due (not paid) stay unpaid so cash YTD does not jump.",
    ),
    (
        re.compile(r"job sheet|budget|materials|labor|committed|actual", re.I),
        "Open the job, then Job sheet (Money). Income is what the client pays. Materials and "
        "Labor budgets break down the lump sum. Committed lines are planned buys; Actual is "
        "money spent. Only Actual hits job costs and expenses YTD.",
    ),
    (
        re.compile(r"scan|lidar|roomplan|floor plan|plans|bathroom|kitchen scan", re.I),
        "In a job, tap Scan room (or open Plans). On the iPhone app with LiDAR, walk the "
        "kitchen or bath slowly. Plans drops walls, doors, windows, cabinets or bath fixtures "
        "marked from scan – verify — you double-check sizes before anyone orders.",
    ),
    (
        re.compile(r"financial|outstanding|ytd|income|invoice|paid|cash", re.I),
        "Financials Income YTD is money collected (invoice amount_paid). Outstanding is what "
        "clients still owe. A Sent invoice with $0 paid raises Outstanding and Won value, but "
        "not collected cash until you record a payment.",
    ),
    (
        re.compile(r"login|password|sign in|bypass|who can|admin|christy|tim", re.I),
        "Only Tim and Christy's admin emails can sign in. If you use the shop bypass code on "
        "the login screen, it lets an owner in without typing the password — keep that code "
        "private between the two of you.",
    ),
    (
        re.compile(r"client|crm|lead", re.I),
        "Clients is your contact book. Open a client to see estimates, contracts, jobs, "
        "invoices, and the master file after a proposal import. Leads holds Thumbtack and "
        "other inbound work before it becomes a client.",
    ),
    (
        re.compile(r"estimate|quote|bid", re.I),
        "Estimates hold priced scopes. Mark one Won when the client agrees — then you can "
        "generate a contract and invoice, or Import proposal can create the Won estimate for you.",
    ),
    (
        re.compile(r"hello|hi\b|hey|who are you|dolly", re.I),
        "Hey honey — I'm Dolly, your Revival Pro guide. Ask me about Clients, importing a "
        "proposal, job sheets, Plans scanning, invoices, or Financials and I'll point you right.",
    ),
]


def _llm_api_key() -> str:
    return (
        (os.environ.get("EMERGENT_LLM_KEY") or "").strip()
        or (os.environ.get("OPENAI_API_KEY") or "").strip()
    )


def faq_reply(message: str) -> Optional[str]:
    text = (message or "").strip()
    if not text:
        return "Ask me anything about Revival Pro — Clients, jobs, Plans, or the books."
    for pattern, answer in FAQ:
        if pattern.search(text):
            return answer
    return None


async def dolly_reply(message: str, session_id: str = "landing") -> dict:
    text = (message or "").strip()
    if not text:
        return {
            "reply": "Ask me anything about Revival Pro — Clients, jobs, Plans, or the books.",
            "source": "faq",
        }
    key = _llm_api_key()
    if key:
        try:
            from emergentintegrations.llm.chat import LlmChat, UserMessage

            chat = LlmChat(api_key=key, session_id=session_id or "landing", system_message=SYSTEM_PROMPT)
            chat.with_model("openai", "gpt-4o-mini")
            result = await chat.send_message(UserMessage(text=text))
            reply = (result or "").strip() if isinstance(result, str) else str(result or "").strip()
            if reply:
                return {"reply": reply, "source": "llm"}
        except Exception:
            logger.exception("Dolly LLM reply failed; falling back to FAQ")
    hit = faq_reply(text)
    if hit:
        return {"reply": hit, "source": "faq"}
    return {
        "reply": (
            "I'm not sure on that one, sugar. Try Clients for people and imports, Jobs for the "
            "job sheet, Plans for drawing or scanning a room, and Financials for money. Ask me "
            "again with one of those words and I'll dig in."
        ),
        "source": "faq",
    }
