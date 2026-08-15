"""Shared US phone normalization. Store E.164; display separately in the UI."""
import re

INVALID_PHONE_MESSAGE = "Enter a valid US phone number, like (512) 555-0100."


def digits_only(value: str) -> str:
    return re.sub(r"\D", "", value or "")


def to_e164(phone: str, *, required: bool = False) -> str:
    """Strip non-digits, add +1 for 10-digit US numbers, return E.164 or ''."""
    raw = (phone or "").strip()
    if not raw:
        if required:
            raise ValueError("A phone number is required.")
        return ""
    digits = digits_only(raw)
    if raw.startswith("+"):
        if 8 <= len(digits) <= 15:
            return "+" + digits
        raise ValueError(INVALID_PHONE_MESSAGE)
    if len(digits) == 10:
        return "+1" + digits
    if len(digits) == 11 and digits.startswith("1"):
        return "+" + digits
    raise ValueError(INVALID_PHONE_MESSAGE)


def format_display(phone: str) -> str:
    """Readable US format, e.g. (859) 227-0340. Falls back to the original value."""
    raw = (phone or "").strip()
    if not raw:
        return ""
    try:
        e164 = to_e164(raw)
    except ValueError:
        return raw
    digits = digits_only(e164)
    if len(digits) == 11 and digits.startswith("1"):
        return f"({digits[1:4]}) {digits[4:7]}-{digits[7:11]}"
    return e164
