"""Debt reminders on WhatsApp.

Automatic sending uses the WhatsApp Business Cloud API (Meta). It needs a WhatsApp Business
account, a phone number ID, an access token and an approved message template. Until those are
set, nothing is sent automatically; the app shows one-tap "Remind on WhatsApp" buttons instead.

The template (create it in Meta Business Manager, category "Utility") must have four body
variables, in this order: {{1}} school name, {{2}} amount owed, {{3}} date, {{4}} business name.
Example body: "Hello {{1}}, this is a reminder that UGX {{2}} for exams is due on {{3}}. Thank you. {{4}}"
"""
import logging
import re

import requests
from django.conf import settings

log = logging.getLogger(__name__)


def whatsapp_enabled():
    return bool(settings.WHATSAPP_TOKEN and settings.WHATSAPP_PHONE_ID and settings.WHATSAPP_TEMPLATE)


def intl(phone):
    digits = re.sub(r"\D", "", phone or "")
    if digits.startswith("0") and len(digits) == 10:
        digits = "256" + digits[1:]
    return digits


def reminder_text(school, amount, due, overdue):
    when = due.strftime("%d %b %Y") if due else "soon"
    if overdue:
        return (f"Hello {school}, this is {settings.BUSINESS_NAME}. Our records show UGX {amount:,} for exams was due on {when} "
                f"and is still unpaid. Please arrange payment. Thank you.")
    return f"Hello {school}, this is {settings.BUSINESS_NAME}. A friendly reminder that UGX {amount:,} for exams is due on {when}. Thank you."


def send_debt_reminder(school, amount, due, kind, key=""):
    """Send the approved template to the school's phone. Returns (ok, error)."""
    from .models import WhatsAppMessage
    to = intl(school.phone)
    if not to:
        return False, "no phone number"
    if not whatsapp_enabled():
        return False, "WhatsApp Business is not set up"
    if key and WhatsAppMessage.objects.filter(key=key, status="sent").exists():
        return True, ""  # already sent
    body = {
        "messaging_product": "whatsapp", "to": to, "type": "template",
        "template": {"name": settings.WHATSAPP_TEMPLATE, "language": {"code": settings.WHATSAPP_TEMPLATE_LANG},
                     "components": [{"type": "body", "parameters": [
                         {"type": "text", "text": school.name}, {"type": "text", "text": f"{amount:,}"},
                         {"type": "text", "text": due.strftime("%d %b %Y") if due else "-"}, {"type": "text", "text": settings.BUSINESS_NAME}]}]},
    }
    try:
        r = requests.post(f"https://graph.facebook.com/{settings.WHATSAPP_API_VERSION}/{settings.WHATSAPP_PHONE_ID}/messages",
                          json=body, headers={"Authorization": f"Bearer {settings.WHATSAPP_TOKEN}"}, timeout=20)
        ok, error = r.status_code < 300, "" if r.status_code < 300 else r.text[:300]
    except requests.RequestException as e:
        ok, error = False, str(e)[:300]
    WhatsAppMessage.objects.create(school=school, kind=kind, key=key, phone=to, amount=amount, status="sent" if ok else "failed", error=error)
    if not ok:
        log.warning("WhatsApp reminder to %s failed: %s", school.name, error)
    return ok, error
