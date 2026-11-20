"""Send text messages. Uses Africa's Talking when configured, otherwise logs them."""
import logging
import re

import requests
from django.conf import settings

log = logging.getLogger(__name__)


def normalise(phone):
    """07XXXXXXXX or 2567XXXXXXXX -> +2567XXXXXXXX (Uganda)."""
    digits = re.sub(r"\D", "", phone or "")
    if digits.startswith("0") and len(digits) == 10:
        digits = "256" + digits[1:]
    return "+" + digits if digits else ""


def send_sms(to, message):
    to = normalise(to)
    if not to:
        return False
    if settings.SMS_PROVIDER != "africastalking" or not settings.AT_API_KEY:
        log.info("SMS (not sent, console mode) to %s: %s", to, message)
        return True
    host = "api.sandbox.africastalking.com" if settings.AT_USERNAME == "sandbox" else "api.africastalking.com"
    data = {"username": settings.AT_USERNAME, "to": to, "message": message}
    if settings.AT_SENDER_ID:
        data["from"] = settings.AT_SENDER_ID
    try:
        r = requests.post(f"https://{host}/version1/messaging", data=data, timeout=20,
                          headers={"apiKey": settings.AT_API_KEY, "Accept": "application/json"})
        r.raise_for_status()
        return True
    except requests.RequestException:
        log.exception("SMS to %s failed", to)
        return False
