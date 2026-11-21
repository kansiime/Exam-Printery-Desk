"""Reports, Excel download, expenses, commission, feedback and the pilot comparison."""
from io import BytesIO

import pytest
from openpyxl import load_workbook

from printery.models import Notification
from printery.tests.test_flow import full_flow, post, sell
from printery.tests.test_team_and_notifications import api, team  # noqa: F401  (fixtures)

pytestmark = pytest.mark.django_db


def test_profit_commission_and_lists(api, team):
    team["sales"].commission_percent = 10
    team["sales"].save()
    exam = full_flow(api, team)
    sell(api, exam)  # 30 copies × 2,000 = 60,000; paid 40,000
    post(api["owner"], "/api/expenses/", {"date": "2026-11-20", "category": "paper", "amount": 15000, "exam": exam["id"], "note": "4 reams"})
    post(api["owner"], "/api/expenses/", {"date": "2026-11-20", "category": "transport", "amount": 5000})
    r = api["owner"].get("/api/reports/").data
    t = r["totals"]
    assert (t["value"], t["collected"], t["costs"], t["commission"]) == (60000, 40000, 20000, 4000)
    assert t["profit"] == 60000 - 20000 - 4000 and t["debt"] == 20000
    assert r["exams"][0]["costs"] == 15000 and r["exams"][0]["profit"] == 45000
    musa = next(s for s in r["sales"] if s["name"] == "Musa")
    assert musa["commission"] == 4000 and musa["open_debt"] == 20000
    assert r["slow_payers"][0]["name"] == "St Mary's SS" and r["top_schools"][0]["value"] == 60000
    assert {c["category"] for c in r["expenses_by_category"]} == {"Paper", "Transport"}


def test_period_filter(api, team):
    exam = full_flow(api, team)
    sell(api, exam)  # dated 2026-11-20
    assert api["owner"].get("/api/reports/?from=2026-12-01").data["totals"]["value"] == 0
    assert api["owner"].get("/api/reports/?from=2026-11-01&to=2026-11-30").data["totals"]["value"] == 60000


def test_excel_download(api, team):
    exam = full_flow(api, team)
    sell(api, exam)
    r = api["owner"].get("/api/reports/excel/")
    assert r.status_code == 200 and "spreadsheetml" in r["Content-Type"]
    wb = load_workbook(BytesIO(r.content))
    assert wb.sheetnames == ["Summary", "Exams", "Sales people", "Slow payers", "Sales", "Debt payments", "Expenses"]
    assert wb["Sales"]["B2"].value == "St Mary's SS"


def test_reports_are_owner_only(api, team):
    for who in ("printer", "store", "sales"):
        assert api[who].get("/api/reports/").status_code == 403
        assert api[who].get("/api/reports/excel/").status_code == 403
        assert api[who].post("/api/expenses/", {"date": "2026-11-20", "amount": 1}).status_code == 403


def test_feedback_reaches_owner(api, team, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        post(api["printer"], "/api/feedback/", {"text": "The meter photo button is hard to find", "page": "/print"})
    assert Notification.objects.filter(recipient=team["owner"], title__contains="sent a problem or idea").exists()
    assert len(api["owner"].get("/api/feedback/").data) == 1
    assert api["sales"].get("/api/feedback/").data == []  # others only see their own


def test_pilot_comparison(api, team):
    exam = full_flow(api, team)
    sell(api, exam)
    figs = {f["key"]: f["system"] for f in api["owner"].get(f"/api/pilot/compare/?exam={exam['id']}").data["figures"]}
    assert (figs["printed"], figs["counted"], figs["issued"], figs["sold"], figs["collected"]) == (98, 98, 40, 30, 40000)


def test_expense_can_be_cancelled(api, team):
    e = post(api["owner"], "/api/expenses/", {"date": "2026-11-20", "category": "other", "amount": 1000})
    post(api["owner"], "/api/cancel/", {"type": "expense", "id": e["id"], "reason": "typed twice"})
    assert api["owner"].get("/api/reports/").data["totals"]["costs"] == 0
