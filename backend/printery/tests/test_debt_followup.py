"""Debt notes and promises, promise-based reminders, broken promises and WhatsApp reminders."""
from datetime import timedelta

import pytest
from django.utils import timezone

from printery.models import Notification, School, Visit, WhatsAppMessage
from printery.reminders import run_reminders
from printery.tests.test_flow import full_flow, post, sell
from printery.tests.test_team_and_notifications import api, team  # noqa: F401  (fixtures)

pytestmark = pytest.mark.django_db
TODAY = lambda: timezone.localdate()  # noqa: E731


def setup_debt(api, team):
    exam = full_flow(api, team)
    assert sell(api, exam).status_code == 201  # St Mary's owes 20,000
    return School.objects.get()


def test_promise_note_shows_on_debts_and_tells_owner(api, team, django_capture_on_commit_callbacks):
    school = setup_debt(api, team)
    with django_capture_on_commit_callbacks(execute=True):
        post(api["sales"], "/api/debt-notes/", {"school": school.id, "text": "Bursar will pay on Friday", "promised_amount": 20000,
                                                "promised_date": (TODAY() + timedelta(days=3)).isoformat()})
    row = api["owner"].get("/api/summary/debts/").data["schools"][0]
    assert row["notes"][0]["text"] == "Bursar will pay on Friday" and row["chase_date"] == TODAY() + timedelta(days=3)
    assert row["wa_phone"] == "256772000000" and "UGX 20,000" in row["reminder_text"]
    assert Notification.objects.filter(recipient=team["owner"], title__contains="promised to pay UGX 20,000").exists()
    assert api["sales2"].post("/api/debt-notes/", {"school": school.id, "text": "x"}).status_code == 403  # not their school
    assert api["sales"].post("/api/debt-notes/", {"school": school.id, "text": "x", "promised_date": "2020-01-01"}).status_code == 400


def test_broken_promise_alerts_owner(api, team, django_capture_on_commit_callbacks):
    school = setup_debt(api, team)
    post(api["sales"], "/api/debt-notes/", {"school": school.id, "text": "Will pay all", "promised_amount": 20000,
                                            "promised_date": (TODAY() + timedelta(days=1)).isoformat()})
    from printery.models import DebtNote
    DebtNote.objects.update(promised_date=TODAY() - timedelta(days=1))
    with django_capture_on_commit_callbacks(execute=True):
        run_reminders()
    assert Notification.objects.filter(recipient=team["owner"], title__contains="broke its promise", level="urgent").exists()
    assert api["owner"].get("/api/summary/debts/").data["schools"][0]["broken_promise"]


def test_whatsapp_sent_automatically_once(api, team, settings, monkeypatch, django_capture_on_commit_callbacks):
    settings.WHATSAPP_TOKEN, settings.WHATSAPP_PHONE_ID, settings.WHATSAPP_TEMPLATE = "token", "123", "debt_reminder"
    calls = []

    class Resp:
        status_code, text = 200, "{}"

    monkeypatch.setattr("printery.whatsapp.requests.post", lambda url, json=None, headers=None, timeout=None: calls.append((url, json)) or Resp())
    setup_debt(api, team)
    Visit.objects.update(due=TODAY() - timedelta(days=2))
    with django_capture_on_commit_callbacks(execute=True):
        run_reminders()
        run_reminders()
    assert len(calls) == 1
    url, body = calls[0]
    assert url.endswith("/123/messages") and body["to"] == "256772000000" and body["template"]["name"] == "debt_reminder"
    assert [p["text"] for p in body["template"]["components"][0]["parameters"]][:2] == ["St Mary's SS", "20,000"]
    assert WhatsAppMessage.objects.get().status == "sent"
    assert api["owner"].get("/api/summary/debts/").data["schools"][0]["whatsapp_sent"][0]["kind"] == "overdue"


def test_no_whatsapp_account_means_buttons_only(api, team, django_capture_on_commit_callbacks):
    setup_debt(api, team)
    Visit.objects.update(due=TODAY() + timedelta(days=1))
    with django_capture_on_commit_callbacks(execute=True):
        run_reminders()
    assert WhatsAppMessage.objects.count() == 0
    n = Notification.objects.get(recipient=team["sales"], title__contains="due")
    assert "Remind on WhatsApp" in n.body
    assert api["owner"].get("/api/summary/debts/").data["auto_whatsapp"] is False
