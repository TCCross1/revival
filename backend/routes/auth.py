"""Auth and team HTTP routes.
Attached from server.py after models and helpers exist.
"""
import base64
import json
import logging
import os
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
import requests
from html import escape
from io import BytesIO
from typing import List, Optional

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Cookie,
    Depends,
    File,
    Form,
    HTTPException,
    Request,
    Response,
    UploadFile,
)
from fastapi.responses import RedirectResponse, StreamingResponse
from pydantic import BaseModel

logger = logging.getLogger(__name__)



def attach_auth_routes(api_router: APIRouter):
    from server import (
        ChangePasswordBody,
        ForgotPasswordBody,
        LoginBody,
        ResetPasswordBody,
        SetPasswordBody,
        TeamCreate,
        UpdateProfileBody,
        User,
        _dev_bypass_allowed,
        _dev_bypass_auth_enabled,
        create_access_token,
        db,
        get_current_user,
        hash_password,
        logger,
        now_iso,
        require_admin,
        send_email,
        verify_password,
    )

    @api_router.post("/auth/login")
    async def login(body: LoginBody, response: Response):
        from access_control import login_allowed

        email = body.email.strip().lower()
        try:
            if not login_allowed(email):
                logger.warning("Login blocked for non-owner email=%s", email)
                raise HTTPException(status_code=403, detail="Only Tim and Christy’s owner accounts can sign in.")
            user = await db.users.find_one({"email": email}, {"_id": 0})
            if not user or not user.get("password_hash") or not verify_password(body.password, user["password_hash"]):
                logger.warning("Login failed for %s", email)
                raise HTTPException(status_code=401, detail="Invalid email or password")
            token = create_access_token(user["user_id"], email)
            response.set_cookie("access_token", token, httponly=True, secure=True, samesite="none",
                                path="/", max_age=7 * 24 * 60 * 60)
            logger.info("Login succeeded for %s role=%s", email, user.get("role"))
            return {**User(**user).model_dump(), "session_token": token}
        except HTTPException:
            raise
        except Exception:
            logger.exception("Login error for %s", email)
            raise HTTPException(status_code=503, detail="Sign-in is temporarily unavailable. Please try again.")


    class BypassCodeBody(BaseModel):
        code: str = ""


    @api_router.post("/auth/bypass-code")
    async def login_bypass_code(body: BypassCodeBody, response: Response):
        """Owner shortcut: correct LOGIN_BYPASS_CODE signs in as the primary admin."""
        from access_control import admin_seed_accounts, bypass_code_matches

        try:
            if not bypass_code_matches(body.code):
                logger.warning("Login bypass rejected")
                raise HTTPException(status_code=401, detail="That code is not correct.")
            accounts = admin_seed_accounts()
            email = accounts[0][0] if accounts else (os.environ.get("ADMIN_EMAIL") or "").strip().lower()
            user = await db.users.find_one({"email": email}, {"_id": 0}) if email else None
            if not user:
                user = await db.users.find_one({"role": "admin"}, {"_id": 0})
            if not user:
                raise HTTPException(status_code=503, detail="No owner account is ready yet. Restart the API after seeding.")
            token = create_access_token(user["user_id"], user["email"])
            response.set_cookie(
                "access_token",
                token,
                httponly=True,
                secure=True,
                samesite="none",
                path="/",
                max_age=7 * 24 * 60 * 60,
            )
            logger.info("Login bypass succeeded for %s", user.get("email"))
            return {**User(**user).model_dump(), "session_token": token, "bypass": True}
        except HTTPException:
            raise
        except Exception:
            logger.exception("Login bypass failed")
            raise HTTPException(status_code=503, detail="Could not use that code. Please try again.")


    @api_router.post("/auth/change-password")
    async def change_password(body: ChangePasswordBody):
        email = body.email.strip().lower()
        user = await db.users.find_one({"email": email}, {"_id": 0})
        if not user:
            raise HTTPException(status_code=404, detail="No account found for that email.")
        if not user.get("password_hash"):
            raise HTTPException(status_code=400, detail="This account has no password yet. Sign in with Google, then set one.")
        if not verify_password(body.current_password, user["password_hash"]):
            raise HTTPException(status_code=400, detail="Your current password is incorrect.")
        if len(body.new_password) < 6:
            raise HTTPException(status_code=400, detail="New password must be at least 6 characters.")
        await db.users.update_one({"email": email}, {"$set": {"password_hash": hash_password(body.new_password)}})
        return {"status": "success"}

    @api_router.get("/team")
    async def list_team(admin: User = Depends(require_admin)):
        docs = await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(1000)
        return [{
            "user_id": d["user_id"], "email": d["email"], "name": d.get("name", ""),
            "role": d.get("role", "member"), "hourly_rate": float(d.get("hourly_rate") or 0),
            "created_at": d.get("created_at", ""),
        } for d in docs]


    @api_router.post("/team")
    async def create_team_member(body: TeamCreate, admin: User = Depends(require_admin)):
        from access_control import login_allowed

        email = body.email.strip().lower()
        if not email or not body.password:
            raise HTTPException(status_code=400, detail="Email and password are required.")
        if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
            raise HTTPException(status_code=400, detail="Please enter a valid email address.")
        if not login_allowed(email):
            raise HTTPException(status_code=403, detail="This shop only allows Tim and Christy’s owner logins.")
        if len(body.password) < 6:
            raise HTTPException(status_code=400, detail="Password must be at least 6 characters.")
        if await db.users.find_one({"email": email}):
            raise HTTPException(status_code=400, detail="A user with that email already exists.")
        from field_ops import normalize_role
        role = normalize_role(body.role)
        if role not in ("admin", "manager", "field"):
            role = "manager"
        doc = {
            "user_id": f"user_{uuid.uuid4().hex[:12]}", "email": email,
            "name": body.name.strip() or email, "picture": "", "role": role,
            "hourly_rate": max(0.0, float(body.hourly_rate or 0)),
            "password_hash": hash_password(body.password), "created_at": now_iso(),
        }
        await db.users.insert_one(doc)
        return {"user_id": doc["user_id"], "email": email, "name": doc["name"], "role": role, "hourly_rate": doc["hourly_rate"]}


    @api_router.post("/team/{user_id}/set-password")
    async def set_member_password(user_id: str, body: SetPasswordBody, admin: User = Depends(require_admin)):
        if len(body.password) < 6:
            raise HTTPException(status_code=400, detail="Password must be at least 6 characters.")
        res = await db.users.update_one({"user_id": user_id}, {"$set": {"password_hash": hash_password(body.password)}})
        if res.matched_count == 0:
            raise HTTPException(status_code=404, detail="User not found")
        return {"status": "success"}


    @api_router.delete("/team/{user_id}")
    async def delete_team_member(user_id: str, admin: User = Depends(require_admin)):
        if user_id == admin.user_id:
            raise HTTPException(status_code=400, detail="You can't remove your own account.")
        await db.users.delete_one({"user_id": user_id})
        return {"status": "success"}


    @api_router.post("/auth/forgot-password")
    async def forgot_password(body: ForgotPasswordBody):
        email = body.email.strip().lower()
        base = (body.base_url or "").rstrip("/")
        user = await db.users.find_one({"email": email}, {"_id": 0})
        if user and base.startswith("https://"):
            token = secrets.token_urlsafe(32)
            await db.password_reset_tokens.insert_one({
                "token": token, "user_id": user["user_id"], "email": email,
                "expires_at": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(), "used": False,
            })
            link = f"{base}/reset-password?token={token}"
            html = (
                f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F7F8;padding:24px 0"><tr><td align="center">'
                f'<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #E2E8F0">'
                f'<tr><td style="background:#0B3A8F;padding:24px 28px;font-family:Arial,sans-serif">'
                f'<div style="color:#ffffff;font-size:22px;font-weight:bold;letter-spacing:1px">REVIVAL PRO</div></td></tr>'
                f'<tr><td style="padding:28px;font-family:Arial,sans-serif;color:#061A23">'
                f'<p style="font-size:15px;margin:0 0 12px">Reset your password</p>'
                f'<p style="font-size:14px;color:#4B6370;line-height:1.6;margin:0 0 22px">We received a request to reset your Revival Pro password. This link expires in 1 hour. If you didn\'t ask for this, you can safely ignore this email.</p>'
                f'<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 22px"><tr><td style="border-radius:10px;background:#C9A227">'
                f'<a href="{link}" style="display:inline-block;padding:14px 28px;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;color:#061A23;text-decoration:none">Reset Password</a>'
                f'</td></tr></table>'
                f'<p style="font-size:12px;color:#8AA0AB;line-height:1.5;margin:0">Or paste this secure link into your browser:<br/>{escape(link)}</p>'
                f'</td></tr></table></td></tr></table>'
            )
            try:
                await send_email(to=email, subject="Reset your Revival Pro password", html=html)
            except Exception as ex:
                logger.error(f"Forgot-password email failed: {ex}")
        return {"status": "success"}


    @api_router.post("/auth/reset-password")
    async def reset_password(body: ResetPasswordBody):
        rec = await db.password_reset_tokens.find_one({"token": body.token}, {"_id": 0})
        if not rec or rec.get("used"):
            raise HTTPException(status_code=400, detail="This reset link is invalid or has already been used.")
        exp = datetime.fromisoformat(rec["expires_at"])
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        if exp < datetime.now(timezone.utc):
            raise HTTPException(status_code=400, detail="This reset link has expired. Please request a new one.")
        if len(body.new_password) < 6:
            raise HTTPException(status_code=400, detail="New password must be at least 6 characters.")
        await db.users.update_one({"user_id": rec["user_id"]}, {"$set": {"password_hash": hash_password(body.new_password)}})
        await db.password_reset_tokens.update_one({"token": body.token}, {"$set": {"used": True}})
        return {"status": "success"}


    @api_router.post("/auth/update-profile")
    async def update_profile(body: UpdateProfileBody, response: Response, user: User = Depends(get_current_user)):
        udoc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0})
        if not udoc:
            raise HTTPException(status_code=404, detail="User not found")
        updates = {}
        if body.name is not None and body.name.strip():
            updates["name"] = body.name.strip()
        if body.email:
            new_email = body.email.strip().lower()
            if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", new_email):
                raise HTTPException(status_code=400, detail="Please enter a valid email address.")
            if new_email != udoc["email"]:
                clash = await db.users.find_one({"email": new_email})
                if clash and clash.get("user_id") != user.user_id:
                    raise HTTPException(status_code=400, detail="That email is already in use.")
                updates["email"] = new_email
        if body.new_password:
            if len(body.new_password) < 6:
                raise HTTPException(status_code=400, detail="New password must be at least 6 characters.")
            ph = udoc.get("password_hash")
            if ph and (not body.current_password or not verify_password(body.current_password, ph)):
                raise HTTPException(status_code=400, detail="Your current password is incorrect.")
            updates["password_hash"] = hash_password(body.new_password)
        if updates:
            await db.users.update_one({"user_id": user.user_id}, {"$set": updates})
        fresh = await db.users.find_one({"user_id": user.user_id}, {"_id": 0})
        token = create_access_token(fresh["user_id"], fresh["email"])
        response.set_cookie("access_token", token, httponly=True, secure=True, samesite="none",
                            path="/", max_age=7 * 24 * 60 * 60)
        return {**User(**fresh).model_dump(), "session_token": token}


    @api_router.post("/auth/session")
    async def process_session(request: Request, response: Response):
        from access_control import login_allowed

        body = await request.json()
        session_id = body.get("session_id")
        if not session_id:
            raise HTTPException(status_code=400, detail="Missing session_id")

        resp = requests.get(
            "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
            headers={"X-Session-ID": session_id},
            timeout=15,
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=401, detail="Invalid session_id")
        data = resp.json()

        email = (data.get("email") or "").strip().lower()
        if not login_allowed(email):
            logger.warning("Google session blocked for non-owner email=%s", email)
            raise HTTPException(status_code=403, detail="Only Tim and Christy’s owner accounts can sign in.")
        existing = await db.users.find_one({"email": email}, {"_id": 0})
        if existing:
            user_id = existing["user_id"]
            await db.users.update_one(
                {"user_id": user_id},
                {"$set": {
                    "name": data.get("name", existing.get("name", "")),
                    "picture": data.get("picture", ""),
                    "role": "admin",
                }},
            )
        else:
            user_id = f"user_{uuid.uuid4().hex[:12]}"
            await db.users.insert_one({
                "user_id": user_id,
                "email": email,
                "name": data.get("name", ""),
                "picture": data.get("picture", ""),
                "role": "admin",
                "created_at": now_iso(),
            })

        session_token = data["session_token"]
        expires_at = datetime.now(timezone.utc) + timedelta(days=7)
        await db.user_sessions.insert_one({
            "user_id": user_id,
            "session_token": session_token,
            "expires_at": expires_at.isoformat(),
            "created_at": now_iso(),
        })

        response.set_cookie(
            key="session_token",
            value=session_token,
            httponly=True,
            secure=True,
            samesite="none",
            path="/",
            max_age=7 * 24 * 60 * 60,
        )
        user_doc = await db.users.find_one({"user_id": user_id}, {"_id": 0})
        # Return session_token in body as a Bearer fallback (proxied preview envs can block cookies)
        return {**user_doc, "session_token": session_token}


    @api_router.get("/auth/me", response_model=User)
    async def auth_me(user: User = Depends(get_current_user)):
        return user


    @api_router.post("/auth/logout")
    async def logout(request: Request, response: Response, session_token: Optional[str] = Cookie(default=None)):
        token = session_token
        if not token:
            auth = request.headers.get("Authorization", "")
            if auth.startswith("Bearer "):
                token = auth[7:]
        if token:
            await db.user_sessions.delete_one({"session_token": token})
        response.delete_cookie("session_token", path="/")
        return {"success": True}


    @api_router.post("/auth/dev-bypass")
    async def auth_dev_bypass(request: Request, response: Response):
        """Mint a local owner JWT for design work. Disabled unless DEV_BYPASS_AUTH=1 and the caller is loopback."""
        try:
            if not _dev_bypass_auth_enabled():
                raise HTTPException(status_code=404, detail="Not found")
            if not _dev_bypass_allowed(request):
                logger.warning(
                    "Rejected dev auth bypass from client=%s origin=%s",
                    request.client.host if request.client else "unknown",
                    request.headers.get("origin"),
                )
                raise HTTPException(status_code=403, detail="Dev bypass is localhost only")
            email = (os.environ.get("ADMIN_EMAIL") or "").strip().lower()
            user = None
            if email:
                user = await db.users.find_one({"email": email}, {"_id": 0})
            if not user:
                user = await db.users.find_one({"role": "admin"}, {"_id": 0})
            if not user:
                raise HTTPException(
                    status_code=503,
                    detail="No local owner account is seeded yet. Start MongoDB and restart the API.",
                )
            token = create_access_token(user["user_id"], user["email"])
            response.set_cookie(
                "access_token",
                token,
                httponly=True,
                secure=False,
                samesite="lax",
                path="/",
                max_age=7 * 24 * 60 * 60,
            )
            logger.warning(
                "DEV AUTH BYPASS issued for %s from %s",
                user.get("email"),
                request.client.host if request.client else "unknown",
            )
            return {**User(**user).model_dump(), "session_token": token, "dev_bypass": True}
        except HTTPException:
            raise
        except Exception:
            logger.exception("Dev auth bypass failed")
            raise HTTPException(status_code=503, detail="Could not start a local design session.")
