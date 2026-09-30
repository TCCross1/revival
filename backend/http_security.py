"""HTTP security helpers. Never log secrets."""
from __future__ import annotations

import logging
import os

logger = logging.getLogger(__name__)

LOCAL_CORS_ORIGINS = (
    "http://localhost:3000",
    "http://127.0.0.1:3000",
)


def cors_allow_origins(raw: str | None = None) -> list[str]:
    """Explicit origin list only. A wildcard is never valid with credentialed cookies."""
    text = (raw if raw is not None else os.environ.get("CORS_ORIGINS") or "").strip()
    parts = [p.strip().rstrip("/") for p in text.split(",") if p.strip()]
    cleaned = [p for p in parts if p != "*"]
    if "*" in parts or not cleaned:
        if raw is None:
            logger.warning("CORS_ORIGINS was empty or contained *; using localhost origins only.")
        return list(LOCAL_CORS_ORIGINS)
    seen: list[str] = []
    for origin in cleaned:
        if origin not in seen:
            seen.append(origin)
    return seen
