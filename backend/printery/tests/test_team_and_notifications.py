"""Several people per role, notifications, and photo links."""
import pytest
from rest_framework.test import APIClient

from accounts.models import User
from printery.models import Notification
from printery.tests.test_flow import full_flow, photo, post, sell

pytestmark = pytest.mark.django_db


@pytest.fixture
def team():
    mk = lambda u, r: User.objects.create_user(u, password="secret-pass-1", role=r, first_name=u.title())  # noqa: E731
    return {"owner": mk("owner", "owner"), "printer": mk("peter", "printer"), "printer2": mk("paul", "printer"),
            "store": mk("sam", "store"), "store2": mk("susan", "store"), "sales": mk("musa", "sales"), "sales2": mk("sarah", "sales")}


@pytest.fixture
def api(team):
    out = {}
    for k, u in team.items():
        c = APIClient()
        c.force_authenticate(u)
        out[k] = c
    return out


def titles(user):
    return [n.title for n in Notification.objects.filter(recipient=user)]


def test_everyone_in_the_chain_is_told(api, team, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        exam = full_flow(api, team)
        sell(api, exam)
    assert any("New print order" in t for t in titles(team["printer"])) and any("New print order" in t for t in titles(team["printer2"]))
    owner = titles(team["owner"])
    assert any("started printing" in t for t in owner) and any("printed 98 copies" in t for t in owner)
    assert any("counted 98" in t for t in owner) and any("sold 30 copies" in t for t in owner)
    printed = Notification.objects.get(recipient=team["owner"], title__contains="printed 98")
    assert "Meter 1,000 → 1,786" in printed.body and len(printed.photos) == 2 and printed.photos[0].startswith("/media/")
    assert any("is printed" in t for t in titles(team["store"])) and any("is printed" in t for t in titles(team["store2"]))
    assert any("issued you 40" in t for t in titles(team["sales"])) and titles(team["sales2"]) == []


def test_extra_pages_ring_the_owner_once(api, team, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        full_flow(api, team, meter_after=1000 + 130 * 8 + 2)
    urgent = Notification.objects.filter(recipient=team["owner"], level="urgent")
    assert urgent.filter(title__contains="printed 98").exists()
    warnings = urgent.filter(title="Fraud warning", body__contains="extra pages")
    assert warnings.count() == 1


def test_only_the_printer_who_started_can_post(api, team):
    exam = post(api["owner"], "/api/exams/", {"name": "S.3 English", "ordered_qty": 50, "price": 1500, "pages": 4, "sides": 1, "numbered": False})
    run = post(api["printer"], "/api/prints/", {"exam": exam["id"], "meter_before": 5000, "photo_before": photo()}, fmt="multipart")
    r = api["printer2"].post(f"/api/prints/{run['id']}/finish/", {"qty": 50, "spoilt": 0, "meter_after": 5200, "photo_after": photo()}, format="multipart")
    assert r.status_code == 403 and "Peter started this job" in r.data["detail"]


def test_cash_is_tracked_per_store_keeper(api, team):
    exam = full_flow(api, team)
    sell(api, exam)
    post(api["store"], "/api/cash/", {"sales": team["sales"].id, "amount": 30000})
    post(api["store2"], "/api/cash/", {"sales": team["sales"].id, "amount": 10000})
    post(api["store2"], "/api/handovers/", {"amount": 10000})
    keepers = {k["name"]: k for k in api["owner"].get("/api/summary/cash/").data["keepers"]}
    assert keepers["Sam"]["held"] == 30000 and keepers["Susan"]["held"] == 0
    assert api["store"].get("/api/summary/cash/").data["store"]["held"] == 30000


def test_notifications_are_private_and_can_be_marked_read(api, team, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        full_flow(api, team)
    mine = api["sales"].get("/api/notifications/").data
    assert mine["unread"] == 1 and "issued you" in mine["items"][0]["title"]
    assert api["sales"].post("/api/notifications/read/", {}, format="json").status_code == 200
    assert api["sales"].get("/api/notifications/").data["unread"] == 0
    assert api["owner"].get("/api/notifications/").data["unread"] > 0


def test_photo_links_are_relative(api, team):
    full_flow(api, team)
    run = api["owner"].get("/api/prints/").data[0]
    assert run["photo_before"].startswith("/media/")
