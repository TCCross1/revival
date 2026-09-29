"""Public Dolly assistant routes (landing / login page)."""
import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)


def attach_dolly_routes(api_router: APIRouter):
    from dolly import SYSTEM_PROMPT, dolly_reply

    class DollyChatBody(BaseModel):
        message: str = ""
        session_id: str = "landing"

    @api_router.get("/public/dolly")
    async def dolly_hello():
        return {
            "name": "Dolly",
            "title": "Your Revival Pro guide",
            "greeting": (
                "Hey honey — I'm Dolly. Ask me anything about Revival Pro: importing a proposal, "
                "job sheets, Plans scanning, invoices, or Financials."
            ),
            "avatar_url": "/brand/dolly.png",
            "topics": [
                "Import a proposal",
                "Job sheet & budget",
                "Scan a kitchen or bath",
                "Financials & outstanding",
                "Who can sign in",
            ],
        }

    @api_router.post("/public/dolly/chat")
    async def dolly_chat(body: DollyChatBody):
        try:
            result = await dolly_reply(body.message, session_id=body.session_id or "landing")
            logger.info("Dolly replied source=%s chars=%s", result.get("source"), len(result.get("reply") or ""))
            return result
        except Exception:
            logger.exception("Dolly chat failed")
            raise HTTPException(status_code=500, detail="Dolly hit a snag. Please try again.")

    @api_router.get("/public/dolly/system-prompt")
    async def dolly_system_prompt():
        # Helpful for debugging; not secret business data.
        return {"prompt": SYSTEM_PROMPT}
