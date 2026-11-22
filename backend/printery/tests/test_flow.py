"""End-to-end tests of the printery process through the API, with the fraud checks."""
import io
import uuid

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image
from rest_framework.test import APIClient

from accounts.models import User
from printery.models import MomoLine, Visit

pytestmark = pytest.mark.django_db


def photo(name="p.jpg"):
    buf = io.BytesIO()
    Image.new("RGB", (8, 8), "white").save(buf, "JPEG")
    return SimpleUploadedFile(name, buf.getvalue(), content_type="image/jpeg")


def client_for(user):
    c = APIClient()
    c.force_authenticate(user)
    return c


@pytest.fixture
def team():
    mk = lambda u, r: User.objects.create_user(u, password="secret-pass-1", role=r, first_name=u.title())  # noqa: E731
    return {"owner": mk("owner", "owner"), "printer": mk("peter", "printer"), "store": mk("sam", "store"),
            "sales": mk("musa", "sales"), "sales2": mk("sarah", "sales")}


@pytest.fixture
def api(team):
    return {k: client_for(u) for k, u in team.items()}


def post(c, url, data, fmt="json", ok=(200, 201)):
    r = c.post(url, data, format=fmt)
    assert r.status_code in ok, (url, r.status_code, r.data)
    return r.data


def full_flow(api, team, printed=98, counted=98, meter_after=None):
    exam = post(api["owner"], "/api/exams/", {"name": "S.4 Maths Mock", "ordered_qty": 100, "price": 2000, "pages": 8, "sides": 1, "numbered": True})
    run = post(api["printer"], "/api/prints/", {"exam": exam["id"], "machine": "Main copier", "meter_before": 1000, "photo_before": photo()}, fmt="multipart")
    meter_after = meter_after if meter_after is not None else 1000 + printed * 8 + 2
    post(api["printer"], f"/api/prints/{run['id']}/finish/", {"qty": printed, "spoilt": 2, "meter_after": meter_after, "photo_after": photo()}, fmt="multipart")
    post(api["store"], "/api/receipts/", {"exam": exam["id"], "qty": counted, "serial_from": 1, "serial_to": counted})
    issue = post(api["store"], "/api/issues/", {"exam": exam["id"], "sales": team["sales"].id, "qty": 40, "serials": "1-40"})
    post(api["sales"], f"/api/issues/{issue['id']}/accept/", {})
    return exam


def sell(api, exam, **over):
    data = {"client_id": str(uuid.uuid4()), "exam": exam["id"], "new_school.name": "St Mary's SS", "new_school.phone": "0772000000",
            "new_school.candidates": 40, "date": "2026-11-20", "copies": 30, "price": 2000, "paid": 40000, "method": "cash",
            "note_no": "0012", "note_photo": photo("note.jpg"), "serials": "1-30"}
    data.update(over)
    if "school" in over:  # an existing school: don't also send a new one
        data = {k: v for k, v in data.items() if not k.startswith("new_school.")}
    return api["sales"].post("/api/visits/", data, format="multipart")


def findings(api):
    return [f["text"] for f in api["owner"].get("/api/summary/audit/").data["findings"]]


def test_clean_flow_balances(api, team):
    exam = full_flow(api, team)
    r = sell(api, exam)
    assert r.status_code == 201, r.data
    post(api["store"], "/api/returns/", {"exam": exam["id"], "sales": team["sales"].id, "qty": 10, "serials": "31-40"})
    post(api["store"], "/api/cash/", {"sales": team["sales"].id, "amount": 40000})
    post(api["store"], "/api/handovers/", {"amount": 40000, "method": "Cash in hand"})

    ov = api["owner"].get("/api/summary/overview/").data
    row = ov["exams"][0]
    assert (row["printed"], row["counted"], row["issued"], row["sold"], row["returned"]) == (98, 98, 40, 30, 10)
    assert row["in_store"] == 68 and row["with_sales"] == 0
    assert row["value"] == 60000 and row["collected"] == 40000 and row["debt"] == 20000
    musa = next(s for s in ov["sales"] if s["name"] == "Musa")
    assert musa["holding"] == 0 and musa["cash_held"] == 0
    assert ov["store_cash"]["held"] == 0 and ov["store_cash"]["unconfirmed"] == 40000
    bad = [f for f in findings(api) if "copier" in f or "serial" in f or "store counted" in f]
    assert bad == []


def test_collusion_caught_by_meter_and_serials(api, team):
    # Printer and store keeper both say 98, but the copier printed 130 copies' worth.
    exam = full_flow(api, team, printed=98, counted=98, meter_after=1000 + 130 * 8 + 2)
    r = sell(api, exam, serials="1-29, 120")
    assert r.status_code == 201, r.data
    text = "\n".join(findings(api))
    assert "256 extra pages" in text and "about 32 extra copies" in text
    assert "outside the counted range 1–98" in text
    assert "never issued them" in text


def test_meter_gap_between_jobs(api, team):
    exam = full_flow(api, team)
    e2 = post(api["owner"], "/api/exams/", {"name": "S.3 English", "ordered_qty": 50, "price": 1500, "pages": 4, "sides": 2, "numbered": False})
    post(api["printer"], "/api/prints/", {"exam": e2["id"], "meter_before": 1000 + 98 * 8 + 2 + 100, "photo_before": photo()}, fmt="multipart")
    assert any("100 pages printed between" in f for f in findings(api))


def test_store_count_differs_from_printer(api, team):
    full_flow(api, team, printed=98, counted=97)
    assert any("printer posted 98, store counted 97" in f for f in findings(api))


def test_sales_cannot_oversell_or_reuse_notes_and_momo(api, team):
    exam = full_flow(api, team)
    assert sell(api, exam, copies=41, serials="").status_code == 400
    assert sell(api, exam, method="momo", momo_id="").status_code == 400
    assert sell(api, exam, method="momo", momo_id="ab123456").status_code == 201
    r = sell(api, exam, copies=5, serials="31-35", note_no="0012", **{"new_school.name": "Kisubi High"})
    assert r.status_code == 400 and "note_no" in r.data
    r = sell(api, exam, copies=5, serials="31-35", note_no="0013", method="momo", momo_id="AB123456", **{"new_school.name": "Kisubi High"})
    assert r.status_code == 400 and "momo_id" in r.data


def test_offline_retry_does_not_duplicate(api, team):
    exam = full_flow(api, team)
    cid = str(uuid.uuid4())
    assert sell(api, exam, client_id=cid).status_code == 201
    assert sell(api, exam, client_id=cid).status_code == 200
    assert Visit.objects.count() == 1


def test_momo_statement_matching(api, team):
    exam = full_flow(api, team)
    sell(api, exam, method="momo", momo_id="TX12345678", paid=40000)
    post(api["owner"], "/api/momo/paste/", {"text": "TX12345678, 30,000\nZZ99999999 5000"})
    assert MomoLine.objects.count() == 2
    assert any("recorded UGX 40,000 but your statement shows UGX 30,000" in f for f in findings(api))


def test_sales_cannot_change_the_price(api, team):
    exam = full_flow(api, team)
    r = sell(api, exam, price=500, price_reason="my friend", paid=0)  # even a hand-made request with a lower price
    assert r.status_code == 201 and r.data["price"] == 2000 and r.data["price_status"] == "ok"
    assert api["owner"].get("/api/summary/debts/").data["total"] == 30 * 2000
    assert api["owner"].get("/api/summary/overview/").data["pending_prices"] == []

def test_cancel_keeps_history_and_removes_from_totals(api, team):
    exam = full_flow(api, team)
    r = sell(api, exam)
    assert api["sales"].post("/api/cancel/", {"type": "visit", "id": r.data["id"], "reason": "x"}).status_code == 403
    post(api["sales"], "/api/corrections/", {"target_type": "visit", "target_id": r.data["id"], "reason": "wrong copies"})
    post(api["owner"], "/api/cancel/", {"type": "visit", "id": r.data["id"], "reason": "wrong copies"})
    assert Visit.objects.count() == 0 and Visit.all_objects.count() == 1
    assert api["owner"].get("/api/summary/overview/").data["exams"][0]["sold"] == 0
    assert api["owner"].get("/api/corrections/").data == []
    assert len(api["owner"].get("/api/cancelled/").data) == 1


def test_roles_are_enforced(api, team):
    exam = full_flow(api, team)
    assert api["printer"].post("/api/exams/", {"name": "x", "ordered_qty": 1, "price": 1, "pages": 1}).status_code == 403
    assert api["store"].get("/api/prints/").status_code == 403  # blind count: store never sees printer figures
    assert api["sales"].get("/api/summary/overview/").status_code == 403
    assert api["printer"].get("/api/summary/debts/").status_code == 403
    assert api["store"].post("/api/paper/", {"reams": 2}).status_code == 403
    sell(api, exam)
    assert api["sales2"].get("/api/visits/").data == []  # sales see only their own sales
    store_view = api["store"].get("/api/summary/store/").data
    assert "printed" not in store_view["exams"][0]


def test_surprise_count_freezes_expected(api, team):
    exam = full_flow(api, team)
    post(api["owner"], "/api/paper/", {"reams": 2, "sheets_per_ream": 500})
    post(api["owner"], "/api/counts/", {"items": [{"exam": exam["id"], "counted": 50}], "paper_counted": 100})
    text = "\n".join(findings(api))
    assert "had 50 in store, records said 58 (-8)" in text
    assert "sheets of paper missing" in text


def test_sms_reply_dispute(api, team, settings):
    settings.SMS_WEBHOOK_TOKEN = "t0ken"
    exam = full_flow(api, team)
    sell(api, exam)
    anon = APIClient()
    assert anon.post("/api/webhooks/sms/", {"from": "+256772000000", "text": "2"}).status_code == 403
    r = anon.post("/api/webhooks/sms/?token=t0ken", {"from": "+256772000000", "text": "2"})
    assert r.data["matched"] is True
    assert any("NOT correct" in f for f in findings(api))


def test_health_and_photos_need_login(api, team):
    exam = full_flow(api, team)
    assert APIClient().get("/api/health/").status_code == 200
    url = api["owner"].get("/api/prints/").data[0]["photo_before"]
    path = url[url.index("/media/"):]
    assert APIClient().get(path).status_code == 403
    c = APIClient()
    c.force_login(team["owner"])
    assert c.get(path).status_code == 200


def test_database_url_parsing():
    from config.settings import database_from_url
    d = database_from_url("postgresql://print%40er:p%3Ass@db.internal/printery")
    assert d == {"NAME": "printery", "USER": "print@er", "PASSWORD": "p:ss", "HOST": "db.internal", "PORT": "5432"}
    neon = database_from_url("postgresql://neondb_owner:secret@ep-cool-sun-a1b2c3-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require")
    assert neon["OPTIONS"] == {"sslmode": "require", "channel_binding": "require"}
    assert neon["DISABLE_SERVER_SIDE_CURSORS"] is True and neon["NAME"] == "neondb"


def test_ensure_owner(monkeypatch):
    from django.core.management import call_command
    monkeypatch.setenv("OWNER_USERNAME", "boss")
    monkeypatch.setenv("OWNER_PASSWORD", "long-enough-pass")
    call_command("ensure_owner")
    call_command("ensure_owner")
    assert User.objects.get(username="boss").role == "owner"
