"""Reminders, end-of-day closing, exam locking, QR verification, GPS checks and push subscriptions."""
from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from printery.extras import copy_sig
from printery.models import DayClose, Exam, Notification, PrintRun, PushSubscription
from printery.reminders import run_reminders
from printery.tests.test_flow import full_flow, photo, post, sell
from printery.tests.test_team_and_notifications import api, team  # noqa: F401  (fixtures)

pytestmark = pytest.mark.django_db


def notes(user, **kw):
    return Notification.objects.filter(recipient=user, **kw)


def test_stuck_printing_reminds_printer_then_owner(api, team, django_capture_on_commit_callbacks):
    exam = post(api["owner"], "/api/exams/", {"name": "S.3 Chem", "ordered_qty": 40, "price": 1500, "pages": 4, "sides": 1, "numbered": False})
    post(api["printer"], "/api/prints/", {"exam": exam["id"], "meter_before": 100, "photo_before": photo()}, fmt="multipart")
    PrintRun.objects.update(started_at=timezone.now() - timedelta(hours=4))
    with django_capture_on_commit_callbacks(execute=True):
        run_reminders()
        run_reminders()  # running again doesn't repeat
    assert notes(team["printer"], title__startswith="Post the count").count() == 1
    assert not notes(team["owner"], title__contains="not posted").exists()
    PrintRun.objects.update(started_at=timezone.now() - timedelta(hours=7))
    with django_capture_on_commit_callbacks(execute=True):
        run_reminders()
    assert notes(team["owner"], title__contains="not posted", level="urgent").count() == 1


def test_unaccepted_issue_and_overdue_debt_reminders(api, team, django_capture_on_commit_callbacks):
    exam = full_flow(api, team)
    post(api["store"], "/api/issues/", {"exam": exam["id"], "sales": team["sales2"].id, "qty": 10, "serials": "41-50"})
    from printery.models import Issue
    Issue.objects.filter(sales=team["sales2"]).update(created_at=timezone.now() - timedelta(hours=25))
    r = sell(api, exam, due=(timezone.localdate() - timedelta(days=1)).isoformat())
    assert r.status_code == 201, r.data
    with django_capture_on_commit_callbacks(execute=True):
        run_reminders()
    assert notes(team["sales2"], title__startswith="Accept the 10 copies").exists()
    assert notes(team["sales"], title__contains="payment overdue").exists()


def test_day_close_flags_gaps_and_store_confirms(api, team, django_capture_on_commit_callbacks):
    exam = full_flow(api, team)
    sell(api, exam)  # Musa holds 10 copies and 40,000 cash
    with django_capture_on_commit_callbacks(execute=True):
        r = api["sales"].post("/api/day-close/", {"copies": {str(exam["id"]): 9}, "cash": 35000}, format="json")
    assert r.status_code == 200, r.data
    assert r.data["cash_gap"] == -5000 and r.data["copy_gaps"] == 1
    owner_note = notes(team["owner"], title__contains="day close doesn't match").get()
    assert "1 copies missing" in owner_note.body and "UGX 5,000 short" in owner_note.body
    assert notes(team["store"], title__contains="closed the day").exists()
    close_id = r.data["id"]
    assert api["sales"].post(f"/api/day-close/{close_id}/confirm/", {"result": "match"}).status_code == 403
    with django_capture_on_commit_callbacks(execute=True):
        post(api["store"], f"/api/day-close/{close_id}/confirm/", {"result": "mismatch", "note": "only 9 copies"})
    assert notes(team["owner"], title__contains="does not match").exists()
    assert api["sales"].post("/api/day-close/", {"copies": {}, "cash": 0}, format="json").status_code == 400  # already confirmed
    assert DayClose.objects.count() == 1


def test_closed_exam_is_locked_until_reopened(api, team):
    exam = full_flow(api, team)
    post(api["owner"], f"/api/exams/{exam['id']}/close/", {})
    assert sell(api, exam).status_code == 400
    assert api["store"].post("/api/issues/", {"exam": exam["id"], "sales": team["sales"].id, "qty": 1, "serials": "41"}).status_code == 400
    visit_issue = api["owner"].get("/api/issues/").data[0]["id"]
    assert api["owner"].post("/api/cancel/", {"type": "issue", "id": visit_issue, "reason": "x"}).status_code == 400
    post(api["owner"], f"/api/exams/{exam['id']}/close/", {"reopen": True}, fmt="json")
    assert sell(api, exam).status_code == 201


def test_qr_verification(api, team, django_capture_on_commit_callbacks):
    exam = full_flow(api, team)
    sell(api, exam, serials="1-30")
    anon = APIClient()
    eid = exam["id"]
    codes = api["owner"].get(f"/api/exams/{eid}/qr-codes/").data["codes"]
    assert len(codes) == 98 and codes[0]["serial"] == 1
    assert api["sales"].get(f"/api/exams/{eid}/qr-codes/").status_code == 403
    r = anon.get(f"/api/verify/{eid}/5/{copy_sig(eid, 5)}/")
    assert r.data["result"] == "sold" and "St Mary's SS" in r.data["message"]
    with django_capture_on_commit_callbacks(execute=True):
        assert anon.get(f"/api/verify/{eid}/50/{copy_sig(eid, 50)}/").data["result"] == "unsold"
        assert anon.get(f"/api/verify/{eid}/150/{copy_sig(eid, 150)}/").data["result"] == "extra"
        assert anon.get(f"/api/verify/{eid}/5/deadbeef00/").data["result"] == "fake"
    owner = notes(team["owner"], level="urgent")
    assert owner.filter(title__startswith="Unsold copy").exists() and owner.filter(title__startswith="Extra copy").exists()
    assert owner.filter(title__startswith="A fake QR").exists()


def test_gps_far_from_school_is_flagged(api, team):
    exam = full_flow(api, team)
    assert sell(api, exam, copies=5, serials="1-5", latitude="0.347596", longitude="32.582520").status_code == 201  # sets school location
    from printery.models import School
    r = sell(api, exam, copies=5, serials="6-10", note_no="0013", latitude="0.450000", longitude="32.700000", school=School.objects.get().id)
    assert r.status_code == 201, r.data
    text = "\n".join(f["text"] for f in api["owner"].get("/api/summary/audit/").data["findings"])
    assert "km away from the school" in text


def test_push_subscription(api, team, settings):
    sub = {"subscription": {"endpoint": "https://push.example.com/abc", "keys": {"p256dh": "x" * 20, "auth": "y" * 10}}}
    settings.VAPID_PUBLIC_KEY, settings.VAPID_PRIVATE_KEY = "", ""
    made = api["sales"].get("/api/push/key/").data["key"]  # server makes its own keys once
    assert len(made) > 80 and api["owner"].get("/api/push/key/").data["key"] == made
    settings.VAPID_PUBLIC_KEY, settings.VAPID_PRIVATE_KEY = "pub", "priv"
    assert api["sales"].get("/api/push/key/").data["key"] == "pub"
    assert api["sales"].post("/api/push/subscribe/", sub, format="json").status_code == 200
    assert PushSubscription.objects.get().user == team["sales"]


def test_push_message_is_encrypted_and_signed(team, settings, monkeypatch):
    """Builds a real Web Push request (encryption + VAPID signature); only the push service is faked."""
    import base64
    import threading

    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec

    from printery.notify import push
    settings.VAPID_PUBLIC_KEY, settings.VAPID_PRIVATE_KEY = "", ""
    phone = ec.generate_private_key(ec.SECP256R1())
    b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()  # noqa: E731
    PushSubscription.objects.create(user=team["owner"], endpoint="https://fcm.googleapis.com/fcm/send/abc",
                                    p256dh=b64(phone.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)),
                                    auth=b64(b"0123456789abcdef"))
    sent = []

    class Resp:
        status_code = 201
        text = ""

    monkeypatch.setattr("requests.post", lambda url, data=None, headers=None, timeout=None, **kw: sent.append((url, headers, data)) or Resp())
    monkeypatch.setattr(threading, "Thread", lambda target, daemon: type("T", (), {"start": lambda self: target()})())
    push(team["owner"], "Fraud warning", "Extra pages", "/owner/fraud", "urgent")
    url, headers, body = sent[0]
    assert url.startswith("https://fcm.googleapis.com/") and headers["Urgency"] == "high"
    assert headers["Authorization"].startswith("vapid t=") and headers["Content-Encoding"] in ("aes128gcm", "aesgcm")
    assert b"Fraud warning" not in body  # the message is encrypted
