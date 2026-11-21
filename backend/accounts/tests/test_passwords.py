import re

import pytest
from django.core.cache import cache
from rest_framework.test import APIClient

from accounts.models import PasswordResetCode, User

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def clear_throttle():
    cache.clear()


@pytest.fixture
def sms(monkeypatch):
    sent = []
    monkeypatch.setattr("accounts.passwords.send_sms", lambda to, msg: sent.append((to, msg)) or True)
    return sent


@pytest.fixture
def musa():
    return User.objects.create_user("musa", password="old-pass-123", role="sales", phone="0772000000")


def test_forgot_and_reset_with_sms_code(sms, musa):
    c = APIClient()
    r = c.post("/api/auth/password/forgot/", {"username": "Musa"})
    assert r.status_code == 200 and len(sms) == 1 and sms[0][0] == "0772000000"
    code = re.search(r"\b(\d{6})\b", sms[0][1]).group(1)
    assert c.post("/api/auth/password/reset/", {"username": "musa", "code": "000000" if code != "000000" else "111111", "new_password": "brand-new-pass-9"}).status_code == 400
    r = c.post("/api/auth/password/reset/", {"username": "musa", "code": code, "new_password": "brand-new-pass-9"})
    assert r.status_code == 200, r.data
    musa.refresh_from_db()
    assert musa.check_password("brand-new-pass-9")
    # a code works only once
    assert c.post("/api/auth/password/reset/", {"username": "musa", "code": code, "new_password": "another-pass-77"}).status_code == 400


def test_unknown_user_gets_same_answer_and_no_sms(sms):
    r = APIClient().post("/api/auth/password/forgot/", {"username": "nobody"})
    assert r.status_code == 200 and sms == []


def test_code_locks_after_five_wrong_tries(sms, musa):
    c = APIClient()
    c.post("/api/auth/password/forgot/", {"username": "musa"})
    code = re.search(r"\b(\d{6})\b", sms[0][1]).group(1)
    wrong = "123456" if code != "123456" else "654321"
    for _ in range(PasswordResetCode.MAX_ATTEMPTS):
        c.post("/api/auth/password/reset/", {"username": "musa", "code": wrong, "new_password": "brand-new-pass-9"})
    assert c.post("/api/auth/password/reset/", {"username": "musa", "code": code, "new_password": "brand-new-pass-9"}).status_code == 400


def test_weak_new_password_refused(sms, musa):
    c = APIClient()
    c.post("/api/auth/password/forgot/", {"username": "musa"})
    code = re.search(r"\b(\d{6})\b", sms[0][1]).group(1)
    r = c.post("/api/auth/password/reset/", {"username": "musa", "code": code, "new_password": "123"})
    assert r.status_code == 400 and "new_password" in r.data


def test_change_password(musa):
    c = APIClient()
    c.force_login(musa)
    c.get("/api/auth/me/")
    assert c.post("/api/auth/password/change/", {"current_password": "wrong", "new_password": "brand-new-pass-9"}).status_code == 400
    r = c.post("/api/auth/password/change/", {"current_password": "old-pass-123", "new_password": "brand-new-pass-9"})
    assert r.status_code == 200
    assert c.get("/api/auth/me/").status_code == 200  # still signed in on this phone
    musa.refresh_from_db()
    assert musa.check_password("brand-new-pass-9")


def test_people_set_their_own_name_but_not_their_role(musa):
    c = APIClient()
    c.force_login(musa)
    r = c.patch("/api/auth/me/", {"first_name": "Musa", "last_name": "Okello", "phone": "0700111222", "role": "owner"}, format="json")
    assert r.status_code == 200 and r.data["name"] == "Musa Okello" and r.data["role"] == "sales"
    assert c.patch("/api/auth/me/", {"first_name": "  "}, format="json").status_code == 400
