"""Account lock, change history and receipts."""
from io import BytesIO

import pytest
from django.core.cache import cache
from rest_framework.test import APIClient

from accounts.models import User
from printery.models import Notification, Payment
from printery.receipts import check_code
from printery.tests.test_flow import full_flow, post, sell
from printery.tests.test_team_and_notifications import api, team  # noqa: F401  (fixtures)

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def clear_throttle():
    cache.clear()


def login(c, username, password):
    return c.post("/api/auth/login/", {"username": username, "password": password}, format="json")


def test_account_locks_after_five_wrong_passwords(team, api, django_capture_on_commit_callbacks):
    c = APIClient()
    with django_capture_on_commit_callbacks(execute=True):
        for i in range(4):
            assert login(c, "musa", "wrong").status_code == 400
        r = login(c, "musa", "wrong")
    assert "locked" in r.data["detail"]
    assert "locked" in login(c, "musa", "secret-pass-1").data["detail"]  # even the right password waits
    assert Notification.objects.filter(recipient=team["owner"], title__contains="account was locked").exists()
    assert api["owner"].get("/api/users/").data and any(u["locked_until"] for u in api["owner"].get("/api/users/").data)
    post(api["owner"], f"/api/users/{team['sales'].id}/unlock/", {})
    assert login(c, "musa", "secret-pass-1").status_code == 200


def test_wrong_password_warns_before_locking_and_resets_on_success(team):
    c = APIClient()
    for _ in range(3):
        r = login(c, "musa", "wrong")
    assert "2 tries left" in r.data["detail"]
    assert login(c, "musa", "secret-pass-1").status_code == 200
    assert User.objects.get(username="musa").failed_logins == 0
    assert login(APIClient(), "nobody", "x").data["detail"] == "Wrong username or password."


def test_change_history_shows_who_changed_what(api, team):
    exam = full_flow(api, team)
    api["owner"].patch(f"/api/exams/{exam['id']}/", {"price": 2500}, format="json")
    sale = sell(api, exam).data
    post(api["owner"], "/api/cancel/", {"type": "visit", "id": sale["id"], "reason": "wrong school"})
    h = api["owner"].get("/api/history/").data
    changed = next(i for i in h["items"] if i["kind"] == "Print order" and i["action"] == "changed")
    assert {"field": "Price", "old": "2,000", "new": "2,500"} in changed["changes"]
    cancel = next(i for i in h["items"] if i["kind"] == "Sale" and i["action"] == "cancelled")
    assert cancel["by"] == "Owner" and any(c["new"] == "wrong school" for c in cancel["changes"])
    api["owner"].patch(f"/api/users/{team['sales'].id}/", {"phone": "0700999888"}, format="json")
    acct = api["owner"].get("/api/history/?kind=Account").data["items"]
    assert any(i["label"] == "Musa (Sales person)" and i["action"] == "changed" for i in acct)
    only_musa = api["owner"].get(f"/api/history/?person={team['sales'].id}").data["items"]
    assert only_musa and all(i["by"] == "Musa" for i in only_musa)
    assert api["sales"].get("/api/history/").status_code == 403


def test_sale_and_payment_receipts(api, team):
    exam = full_flow(api, team)
    sale = sell(api, exam).data
    info = api["sales"].get(f"/api/receipts/sale/{sale['id']}/").data
    assert info["number"] == f"S-{sale['id']:06d}" and info["phone"] == "256772000000" and "{link}" in info["whatsapp_text"]
    assert "30 copies" in info["whatsapp_text"] and "balance UGX 20,000" in info["whatsapp_text"]
    assert api["sales2"].get(f"/api/receipts/sale/{sale['id']}/").status_code == 404  # not their sale
    anon = APIClient()
    r = anon.get(info["path"])
    assert r.status_code == 200 and r["Content-Type"] == "application/pdf" and r.content.startswith(b"%PDF")
    assert anon.get(f"/api/r/sale/{sale['id']}/{'0' * 12}/").status_code == 404  # wrong check code
    pay = post(api["sales"], "/api/payments/", {"visit": sale["id"], "amount": 5000, "method": "cash"})
    pinfo = api["owner"].get(f"/api/receipts/payment/{pay['id']}/").data
    assert pinfo["number"] == f"P-{pay['id']:06d}" and "balance now UGX 15,000" in pinfo["whatsapp_text"]
    assert anon.get(f"/api/r/payment/{pay['id']}/{check_code('payment', pay['id'])}/").content.startswith(b"%PDF")
