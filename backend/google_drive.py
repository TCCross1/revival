"""Google Drive helpers for Revival Pro client folders.

OAuth tokens are stored encrypted in Mongo by the API layer. This module never
logs tokens, client secrets, or file contents.
"""
from __future__ import annotations

import logging
import os
import re
from datetime import datetime, timezone
from urllib.parse import urlencode
from typing import Optional

import requests
from google.auth.transport.requests import Request as GoogleRequest
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from googleapiclient.http import MediaInMemoryUpload

logger = logging.getLogger(__name__)

DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder"
PARENT_FOLDER_NAME = "Clients"
COMPANY_ROOT_NAME = "Revival Pro"
CLIENTS_ROOT_NAME = "Clients"
OVERHEAD_ROOT_NAME = "Overhead"
SQUARE_ROOT_NAME = "Square Statements"
FLOOR_PLANS_FOLDER = "Floor Plans"
RECEIPTS_FOLDER = "Receipts"
REPORTS_FOLDER = "Reports"
JOB_SHEETS_FOLDER = "Job Sheets"
PERMIT_DETAILS_FOLDER = "Permit Details"
CLIENT_SUBFOLDERS = (FLOOR_PLANS_FOLDER, RECEIPTS_FOLDER, REPORTS_FOLDER, PERMIT_DETAILS_FOLDER, JOB_SHEETS_FOLDER)
KIND_TO_SUBFOLDER = {
    "floor_plan": FLOOR_PLANS_FOLDER,
    "receipt": RECEIPTS_FOLDER,
    "receipts": RECEIPTS_FOLDER,
    "client_report": REPORTS_FOLDER,
    "permit_details": PERMIT_DETAILS_FOLDER,
    "estimate": REPORTS_FOLDER,
    "contract": REPORTS_FOLDER,
    "job_sheet": JOB_SHEETS_FOLDER,
    "invoice": JOB_SHEETS_FOLDER,
    "materials_list": JOB_SHEETS_FOLDER,
    "vendor_quote": JOB_SHEETS_FOLDER,
    "photo_before": JOB_SHEETS_FOLDER,
    "photo_during": JOB_SHEETS_FOLDER,
    "photo_after": JOB_SHEETS_FOLDER,
    "other": JOB_SHEETS_FOLDER,
}
EXPECTED_EMAIL_DEFAULT = "revivalhomeremodelingllc@gmail.com"
AUTH_URI = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URI = "https://oauth2.googleapis.com/token"
USERINFO_URI = "https://www.googleapis.com/oauth2/v2/userinfo"
SCOPES = [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/drive.file",
]
_runtime_client_id = ""
_runtime_client_secret = ""


def expected_email() -> str:
    return (os.environ.get("GOOGLE_DRIVE_EXPECTED_EMAIL") or EXPECTED_EMAIL_DEFAULT).strip().lower()


def frontend_url() -> str:
    return (os.environ.get("FRONTEND_URL") or "http://localhost:3000").rstrip("/")


def set_runtime_oauth(client_id: str, client_secret: str) -> None:
    """Use keys saved in Company Profile when .env is still empty. Never log these."""
    global _runtime_client_id, _runtime_client_secret
    _runtime_client_id = (client_id or "").strip()
    _runtime_client_secret = (client_secret or "").strip()


def oauth_client_id() -> str:
    return (os.environ.get("GOOGLE_DRIVE_CLIENT_ID") or _runtime_client_id or "").strip()


def oauth_client_secret() -> str:
    return (os.environ.get("GOOGLE_DRIVE_CLIENT_SECRET") or _runtime_client_secret or "").strip()


def oauth_redirect_uri() -> str:
    return (
        os.environ.get("GOOGLE_DRIVE_REDIRECT_URI")
        or "http://localhost:8001/api/google-drive/callback"
    ).strip()


def oauth_configured() -> bool:
    return bool(oauth_client_id() and oauth_client_secret())


def folder_web_url(folder_id: str) -> str:
    fid = (folder_id or "").strip()
    if not fid:
        return ""
    return f"https://drive.google.com/drive/folders/{fid}"


def sanitize_folder_name(name: str) -> str:
    text = re.sub(r"[\x00-\x1f\\/]", "-", (name or "").strip())
    text = re.sub(r"\s+", " ", text).strip(" .")
    return (text or "Client")[:120]


def short_address(address: str) -> str:
    raw = (address or "").strip()
    if not raw:
        return ""
    first = raw.split(",")[0].strip()
    first = re.sub(r"\s+", " ", first)
    return first[:80]


def client_folder_name(client: dict, job_number: str = "") -> str:
    """Name the Drive folder after the client; add a short address when it helps uniqueness."""
    name = sanitize_folder_name((client or {}).get("name") or "Client")
    extra = short_address((client or {}).get("address") or "")
    if extra and extra.lower() not in name.lower():
        return sanitize_folder_name(f"{name} — {extra}")
    return name


def build_auth_url(state: str) -> str:
    if not oauth_configured():
        raise RuntimeError("Google Drive OAuth is not configured.")
    params = {
        "client_id": oauth_client_id(),
        "redirect_uri": oauth_redirect_uri(),
        "response_type": "code",
        "scope": " ".join(SCOPES),
        "access_type": "offline",
        "prompt": "consent select_account",
        "login_hint": expected_email(),
        "state": state,
    }
    return f"{AUTH_URI}?{urlencode(params)}"


def exchange_code(code: str) -> dict:
    if not oauth_configured():
        raise RuntimeError("Google Drive OAuth is not configured.")
    try:
        res = requests.post(
            TOKEN_URI,
            data={
                "code": code,
                "client_id": oauth_client_id(),
                "client_secret": oauth_client_secret(),
                "redirect_uri": oauth_redirect_uri(),
                "grant_type": "authorization_code",
            },
            timeout=30,
        )
        payload = res.json() if res.content else {}
        if res.status_code >= 400:
            logger.error("Google OAuth token exchange failed status=%s", res.status_code)
            raise RuntimeError("Google did not accept the sign-in. Please try connecting again.")
        access = payload.get("access_token") or ""
        refresh = payload.get("refresh_token") or ""
        if not access:
            raise RuntimeError("Google did not return an access token. Please try connecting again.")
        if not refresh:
            raise RuntimeError(
                "Google did not send a lasting sign-in. In Google Account → Security → Third-party access, "
                "remove Revival Pro, then connect again and tap Allow."
            )
        email = _email_from_access_token(access) or ""
        expiry = _expiry_from_seconds(payload.get("expires_in"))
        return {
            "access_token": access,
            "refresh_token": refresh,
            "token_expiry": expiry,
            "email": email,
            "scopes": payload.get("scope") or " ".join(SCOPES),
        }
    except RuntimeError:
        raise
    except Exception:
        logger.exception("Google OAuth token exchange crashed")
        raise RuntimeError("Could not finish Google Drive sign-in. Please try again.")


def _email_from_access_token(access_token: str) -> str:
    try:
        res = requests.get(
            USERINFO_URI,
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=20,
        )
        if res.status_code >= 400:
            logger.error("Google userinfo failed status=%s", res.status_code)
            return ""
        return str((res.json() or {}).get("email") or "").strip().lower()
    except Exception:
        logger.exception("Google userinfo request failed")
        return ""


def _expiry_from_seconds(expires_in) -> str:
    try:
        seconds = int(expires_in or 0)
    except (TypeError, ValueError):
        seconds = 0
    if seconds <= 0:
        seconds = 3500
    dt = datetime.now(timezone.utc).timestamp() + seconds
    return datetime.fromtimestamp(dt, tz=timezone.utc).isoformat()


def verify_account(service) -> dict:
    """Confirm the Drive API accepts this sign-in. Never logs tokens."""
    data = _execute(service.about().get(fields="user(emailAddress,displayName)"))
    if not data:
        raise RuntimeError("Google Drive did not confirm the account. Connect again in Company Profile.")
    user = data.get("user") or {}
    email = str(user.get("emailAddress") or "").strip().lower()
    if not email:
        raise RuntimeError("Google Drive signed in but did not return the Gmail address. Connect again.")
    return {"email": email, "name": user.get("displayName") or ""}


def credentials_from_tokens(tokens: dict) -> Credentials:
    expiry = None
    raw = (tokens or {}).get("token_expiry") or ""
    if raw:
        try:
            expiry = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
            if expiry.tzinfo is None:
                expiry = expiry.replace(tzinfo=timezone.utc)
            expiry = expiry.replace(tzinfo=None)
        except Exception:
            expiry = None
    return Credentials(
        token=(tokens or {}).get("access_token") or None,
        refresh_token=(tokens or {}).get("refresh_token") or None,
        token_uri=TOKEN_URI,
        client_id=oauth_client_id(),
        client_secret=oauth_client_secret(),
        scopes=SCOPES,
        expiry=expiry,
    )


def refreshed_token_fields(creds: Credentials) -> dict:
    expiry = ""
    if creds.expiry:
        dt = creds.expiry
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        expiry = dt.astimezone(timezone.utc).isoformat()
    return {
        "access_token": creds.token or "",
        "refresh_token": creds.refresh_token or "",
        "token_expiry": expiry,
    }


def build_service(tokens: dict) -> tuple:
    """Return (service, refreshed_token_fields_or_none)."""
    creds = credentials_from_tokens(tokens)
    refreshed = None
    try:
        if creds.refresh_token and (not creds.valid or creds.expired):
            creds.refresh(GoogleRequest())
            refreshed = refreshed_token_fields(creds)
    except Exception:
        logger.exception("Google Drive token refresh failed")
        raise RuntimeError("Google Drive sign-in expired. Reconnect Google Drive in Company Profile.")
    service = build("drive", "v3", credentials=creds, cache_discovery=False)
    return service, refreshed


def _escape_query_value(value: str) -> str:
    return (value or "").replace("\\", "\\\\").replace("'", "\\'")


def _execute(request):
    try:
        return request.execute()
    except HttpError as ex:
        status = getattr(getattr(ex, "resp", None), "status", None)
        if status == 404:
            return None
        logger.error("Google Drive API error status=%s", status)
        raise RuntimeError("Google Drive could not complete that request. Please try again.")
    except Exception:
        logger.exception("Google Drive API request failed")
        raise RuntimeError("Google Drive could not complete that request. Please try again.")


def get_file(service, file_id: str) -> Optional[dict]:
    if not file_id:
        return None
    req = service.files().get(
        fileId=file_id,
        fields="id,name,mimeType,trashed,webViewLink",
        supportsAllDrives=True,
    )
    data = _execute(req)
    if not data or data.get("trashed"):
        return None
    return data


def find_child_folder(service, parent_id: str, name: str) -> Optional[dict]:
    q = (
        f"'{_escape_query_value(parent_id)}' in parents and "
        f"name = '{_escape_query_value(name)}' and "
        f"mimeType = '{DRIVE_FOLDER_MIME}' and trashed = false"
    )
    req = service.files().list(
        q=q,
        spaces="drive",
        fields="files(id,name,webViewLink)",
        pageSize=5,
        supportsAllDrives=True,
        includeItemsFromAllDrives=True,
    )
    data = _execute(req) or {}
    files = data.get("files") or []
    return files[0] if files else None


def create_folder(service, name: str, parent_id: str = "") -> dict:
    body = {"name": name, "mimeType": DRIVE_FOLDER_MIME}
    if parent_id:
        body["parents"] = [parent_id]
    req = service.files().create(
        body=body,
        fields="id,name,webViewLink",
        supportsAllDrives=True,
    )
    data = _execute(req)
    if not data or not data.get("id"):
        raise RuntimeError("Google Drive did not create the folder. Please try again.")
    return data


def rename_folder(service, folder_id: str, name: str) -> dict:
    req = service.files().update(
        fileId=folder_id,
        body={"name": name},
        fields="id,name,webViewLink",
        supportsAllDrives=True,
    )
    data = _execute(req)
    if not data or not data.get("id"):
        raise RuntimeError("Could not rename the Google Drive folder. Please try again.")
    return data


def find_named_folder(service, name: str) -> Optional[dict]:
    q = (
        f"name = '{_escape_query_value(name)}' and "
        f"mimeType = '{DRIVE_FOLDER_MIME}' and trashed = false"
    )
    req = service.files().list(
        q=q,
        spaces="drive",
        fields="files(id,name,webViewLink)",
        pageSize=5,
        supportsAllDrives=True,
        includeItemsFromAllDrives=True,
    )
    data = _execute(req) or {}
    files = data.get("files") or []
    return files[0] if files else None


def ensure_child_folder(service, parent_id: str, name: str) -> dict:
    wanted = sanitize_folder_name(name)
    if parent_id:
        found = find_child_folder(service, parent_id, wanted)
        if found:
            return {
                "id": found.get("id"),
                "name": found.get("name") or wanted,
                "webViewLink": found.get("webViewLink") or folder_web_url(found.get("id")),
            }
        created = create_folder(service, wanted, parent_id)
        logger.info("Created Google Drive folder name=%s", wanted)
        return {
            "id": created.get("id"),
            "name": created.get("name") or wanted,
            "webViewLink": created.get("webViewLink") or folder_web_url(created.get("id")),
        }
    found = find_named_folder(service, wanted)
    if found:
        return {
            "id": found.get("id"),
            "name": found.get("name") or wanted,
            "webViewLink": found.get("webViewLink") or folder_web_url(found.get("id")),
        }
    created = create_folder(service, wanted)
    logger.info("Created Google Drive root folder name=%s", wanted)
    return {
        "id": created.get("id"),
        "name": created.get("name") or wanted,
        "webViewLink": created.get("webViewLink") or folder_web_url(created.get("id")),
    }


def ensure_folder_path(service, parts: list) -> dict:
    """Create nested folders (app-owned) and return the leaf."""
    parent_id = ""
    last = {"id": "", "name": "", "webViewLink": ""}
    for part in parts:
        last = ensure_child_folder(service, parent_id, part)
        parent_id = last.get("id") or ""
    if not last.get("id"):
        raise RuntimeError("Could not create the Google Drive folder path. Please try again.")
    return last


def folder_structure_labels() -> list:
    return [
        COMPANY_ROOT_NAME,
        CLIENTS_ROOT_NAME,
        "{Client Name}",
        " · ".join(CLIENT_SUBFOLDERS),
    ]


def subfolder_name_for_kind(kind: str) -> str:
    return KIND_TO_SUBFOLDER.get((kind or "").strip().lower(), JOB_SHEETS_FOLDER)


def ensure_company_tree(service) -> dict:
    """Revival Pro / Clients (plus company roots used by overhead and Square)."""
    company = ensure_child_folder(service, "", COMPANY_ROOT_NAME)
    clients = ensure_child_folder(service, company.get("id") or "", CLIENTS_ROOT_NAME)
    return {"company": company, "clients": clients}


def ensure_parent_folder(service, existing_id: str = "") -> dict:
    """Return the Clients folder under Revival Pro, creating the tree if needed."""
    if existing_id:
        found = get_file(service, existing_id)
        name = (found or {}).get("name") or ""
        if found and name in (CLIENTS_ROOT_NAME, PARENT_FOLDER_NAME, "Revival Pro Clients"):
            ensure_child_folder(service, "", COMPANY_ROOT_NAME)
            return {
                "id": found.get("id"),
                "name": found.get("name") or CLIENTS_ROOT_NAME,
                "webViewLink": found.get("webViewLink") or folder_web_url(found.get("id")),
            }
    tree = ensure_company_tree(service)
    return tree["clients"]


def ensure_client_subfolders(service, client_folder_id: str) -> dict:
    created = {}
    for name in CLIENT_SUBFOLDERS:
        key = name.lower().replace(" ", "_")
        created[key] = ensure_child_folder(service, client_folder_id, name)
    return created


def ensure_kind_folder(service, client_folder_id: str, kind: str) -> dict:
    if not client_folder_id:
        raise RuntimeError("A client Google Drive folder is required before saving a file.")
    return ensure_child_folder(service, client_folder_id, subfolder_name_for_kind(kind))


def ensure_client_folder(service, client: dict, parent_id: str, job_number: str = "") -> dict:
    """Create or reuse the client's folder and the five working subfolders."""
    wanted = client_folder_name(client, job_number=job_number)
    stored_id = (client or {}).get("google_drive_folder_id") or ""
    folder = None
    created = False
    if stored_id:
        found = get_file(service, stored_id)
        if found:
            if found.get("name") != wanted:
                try:
                    found = rename_folder(service, stored_id, wanted)
                except Exception:
                    logger.exception("Could not rename Drive folder id=%s", stored_id)
            folder = {
                "id": found.get("id") or stored_id,
                "name": found.get("name") or wanted,
                "webViewLink": found.get("webViewLink") or folder_web_url(stored_id),
                "created": False,
            }
    if folder is None:
        existing = find_child_folder(service, parent_id, wanted)
        if existing:
            folder = {
                "id": existing.get("id"),
                "name": existing.get("name") or wanted,
                "webViewLink": existing.get("webViewLink") or folder_web_url(existing.get("id")),
                "created": False,
            }
        else:
            created_folder = create_folder(service, wanted, parent_id=parent_id)
            logger.info("Created Google Drive client folder name=%s", wanted)
            folder = {
                "id": created_folder.get("id"),
                "name": created_folder.get("name") or wanted,
                "webViewLink": created_folder.get("webViewLink") or folder_web_url(created_folder.get("id")),
                "created": True,
            }
            created = True
    try:
        ensure_client_subfolders(service, folder.get("id") or "")
    except Exception:
        logger.exception("Could not create client Drive subfolders name=%s", wanted)
    folder["created"] = created or bool(folder.get("created"))
    return folder


def sanitize_filename(name: str) -> str:
    raw = (name or "document").strip() or "document"
    if "." in raw:
        base, ext = raw.rsplit(".", 1)
        clean_base = sanitize_folder_name(base) or "document"
        clean_ext = re.sub(r"[^A-Za-z0-9]+", "", ext)[:12] or "bin"
        return f"{clean_base}.{clean_ext}"
    return sanitize_folder_name(raw) or "document"


def find_file_in_folder(service, folder_id: str, name: str) -> Optional[dict]:
    q = (
        f"'{_escape_query_value(folder_id)}' in parents and "
        f"name = '{_escape_query_value(name)}' and trashed = false"
    )
    req = service.files().list(
        q=q,
        spaces="drive",
        fields="files(id,name,webViewLink,mimeType)",
        pageSize=5,
        supportsAllDrives=True,
        includeItemsFromAllDrives=True,
    )
    data = _execute(req) or {}
    files = data.get("files") or []
    return files[0] if files else None


def update_bytes(service, file_id: str, filename: str, content: bytes, mime_type: str = "application/pdf") -> dict:
    safe_name = sanitize_filename(filename)
    media = MediaInMemoryUpload(content or b"", mimetype=mime_type or "application/pdf", resumable=False)
    req = service.files().update(
        fileId=file_id,
        body={"name": safe_name},
        media_body=media,
        fields="id,name,webViewLink",
        supportsAllDrives=True,
    )
    data = _execute(req)
    if not data or not data.get("id"):
        raise RuntimeError("Google Drive did not update the file. Please try again.")
    return {
        "id": data.get("id"),
        "name": data.get("name") or safe_name,
        "webViewLink": data.get("webViewLink") or "",
        "folder_id": "",
    }


def upsert_bytes(service, folder_id: str, filename: str, content: bytes, mime_type: str = "application/pdf", existing_file_id: str = "") -> dict:
    """Create or replace a file in the client folder so updates do not duplicate."""
    safe_name = sanitize_filename(filename)
    if existing_file_id:
        found = get_file(service, existing_file_id)
        if found:
            result = update_bytes(service, existing_file_id, safe_name, content, mime_type)
            result["folder_id"] = folder_id
            return result
    named = find_file_in_folder(service, folder_id, safe_name)
    if named and named.get("id"):
        result = update_bytes(service, named["id"], safe_name, content, mime_type)
        result["folder_id"] = folder_id
        return result
    return upload_bytes(service, folder_id, safe_name, content, mime_type)


def upload_bytes(service, folder_id: str, filename: str, content: bytes, mime_type: str = "application/pdf") -> dict:
    if not folder_id:
        raise RuntimeError("A Google Drive folder is required before uploading a file.")
    safe_name = sanitize_filename(filename)
    media = MediaInMemoryUpload(content or b"", mimetype=mime_type or "application/pdf", resumable=False)
    body = {"name": safe_name, "parents": [folder_id]}
    req = service.files().create(
        body=body,
        media_body=media,
        fields="id,name,webViewLink",
        supportsAllDrives=True,
    )
    data = _execute(req)
    if not data or not data.get("id"):
        raise RuntimeError("Google Drive did not save the file. Please try again.")
    logger.info("Uploaded file to Google Drive name=%s", safe_name)
    return {
        "id": data.get("id"),
        "name": data.get("name") or safe_name,
        "webViewLink": data.get("webViewLink") or "",
        "folder_id": folder_id,
    }
