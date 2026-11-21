"""Business reports: profit, sales people and commission, schools, expenses; Excel download."""
from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal
from io import BytesIO

from django.http import HttpResponse
from django.utils import timezone
from rest_framework import mixins, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.response import Response

from . import serializers as S
from .models import Expense, Feedback, Method, Notification
from .notify import OWNER, people, tell
from .permissions import roles
from .services import Ledger


def period(request):
    """?from=YYYY-MM-DD&to=YYYY-MM-DD (both optional). Sales count by visit date, costs by expense date."""
    def parse(name):
        v = request.query_params.get(name)
        try:
            return datetime.strptime(v, "%Y-%m-%d").date() if v else None
        except ValueError:
            return None
    return parse("from"), parse("to")


def within(d, start, end):
    return (start is None or d >= start) and (end is None or d <= end)


def build_report(start=None, end=None):
    L = Ledger()
    today = timezone.localdate()
    visits = [v for v in L.visits if within(v.date, start, end)]
    payments = [p for p in L.payments if within(timezone.localtime(p.created_at).date(), start, end)]
    expenses = [e for e in Expense.objects.select_related("exam") if within(e.date, start, end)]
    visit_by_id = {v.id: v for v in L.visits}

    def collected(vs, pays):
        return sum(v.paid for v in vs) + sum(p.amount for p in pays)

    # Exams
    exams = []
    for e in sorted(L.exams.values(), key=lambda x: x.created_at, reverse=True):
        vs = [v for v in visits if v.exam_id == e.id]
        pays = [p for p in payments if visit_by_id.get(p.visit_id) and visit_by_id[p.visit_id].exam_id == e.id]
        costs = sum(x.amount for x in expenses if x.exam_id == e.id)
        value = sum(L.visit_value(v) for v in vs)
        if not vs and not costs:
            continue
        exams.append({"id": e.id, "name": e.name, "sold": sum(v.copies for v in vs), "value": value, "collected": collected(vs, pays),
                      "debt": sum(L.visit_debt(v) for v in vs), "costs": costs, "profit": value - costs, "closed": bool(e.closed_at)})

    # Sales people
    sales = []
    for u in L.sales_people():
        vs = [v for v in visits if v.sales_id == u.id]
        pays = [p for p in payments if p.sales_id == u.id]
        coll = collected(vs, pays)
        rate = Decimal(u.commission_percent or 0)
        open_debt = sum(L.visit_debt(v) for v in L.visits if v.sales_id == u.id)
        overdue = sum(L.visit_debt(v) for v in L.visits if v.sales_id == u.id and v.due and v.due < today)
        sales.append({"id": u.id, "name": u.display_name, "schools": len({v.school_id for v in vs}), "sold": sum(v.copies for v in vs),
                      "value": sum(L.visit_value(v) for v in vs), "collected": coll, "commission_percent": float(rate),
                      "commission": int(rate * coll / 100), "open_debt": open_debt, "overdue_debt": overdue,
                      "momo_share": round(100 * (sum(v.paid for v in vs if v.method == Method.MOMO) / sum(v.paid for v in vs))) if sum(v.paid for v in vs) else 0})
    sales.sort(key=lambda r: r["value"], reverse=True)

    # Schools
    by_school = defaultdict(lambda: {"value": 0, "copies": 0, "debt": 0, "oldest_debt_days": 0, "overdue": False})
    for v in L.visits:
        row = by_school[v.school_id]
        row["name"], row["district"], row["phone"] = v.school.name, v.school.district, v.school.phone
        if within(v.date, start, end):
            row["value"] += L.visit_value(v)
            row["copies"] += v.copies
        d = L.visit_debt(v)
        if d > 0:
            row["debt"] += d
            row["oldest_debt_days"] = max(row["oldest_debt_days"], (today - v.date).days)
            row["overdue"] = row["overdue"] or bool(v.due and v.due < today)
    schools = [dict(id=k, **r) for k, r in by_school.items()]
    top_schools = sorted([s for s in schools if s["value"]], key=lambda s: s["value"], reverse=True)[:10]
    slow_payers = sorted([s for s in schools if s["debt"] > 0], key=lambda s: (not s["overdue"], -s["oldest_debt_days"], -s["debt"]))[:10]

    by_cat = defaultdict(int)
    for x in expenses:
        by_cat[x.get_category_display()] += x.amount
    value = sum(L.visit_value(v) for v in visits)
    total_costs = sum(x.amount for x in expenses)
    commission = sum(r["commission"] for r in sales)
    return {
        "from": start, "to": end,
        "totals": {"value": value, "collected": collected(visits, payments), "costs": total_costs, "commission": commission,
                   "profit": value - total_costs - commission, "debt": sum(L.visit_debt(v) for v in L.visits),
                   "copies": sum(v.copies for v in visits), "schools": len({v.school_id for v in visits})},
        "exams": exams, "best_exams": sorted(exams, key=lambda r: r["sold"], reverse=True)[:5],
        "sales": sales, "top_schools": top_schools, "slow_payers": slow_payers,
        "expenses_by_category": [{"category": k, "amount": v} for k, v in sorted(by_cat.items(), key=lambda kv: -kv[1])],
        "visits": visits, "payments": payments, "expenses": expenses, "ledger": L,
    }


PUBLIC = ("from", "to", "totals", "exams", "best_exams", "sales", "top_schools", "slow_payers", "expenses_by_category")


@api_view(["GET"])
@permission_classes([roles(OWNER)])
def report(request):
    r = build_report(*period(request))
    return Response({k: r[k] for k in PUBLIC})


@api_view(["GET"])
@permission_classes([roles(OWNER)])
def report_excel(request):
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill
    from openpyxl.utils import get_column_letter

    start, end = period(request)
    r = build_report(start, end)
    L = r["ledger"]
    wb = Workbook()
    bold, head_fill = Font(bold=True, color="FFFFFF"), PatternFill("solid", fgColor="2153E0")

    def sheet(title, headers, rows, first=False):
        ws = wb.active if first else wb.create_sheet()
        ws.title = title
        ws.append(headers)
        for c in ws[1]:
            c.font, c.fill = bold, head_fill
        for row in rows:
            ws.append(row)
        for i, h in enumerate(headers, 1):
            width = max([len(str(h))] + [len(str(row[i - 1])) for row in rows if i - 1 < len(row)] + [8])
            ws.column_dimensions[get_column_letter(i)].width = min(width + 2, 60)
        ws.freeze_panes = "A2"
        return ws

    t = r["totals"]
    label = f"{start or 'start'} to {end or date.today()}"
    sheet("Summary", ["Item", "Value"], [["Period", label], ["Copies sold", t["copies"]], ["Sales value (UGX)", t["value"]],
                                         ["Money collected (UGX)", t["collected"]], ["Expenses (UGX)", t["costs"]],
                                         ["Commission (UGX)", t["commission"]], ["Profit (UGX)", t["profit"]], ["Schools owe now (UGX)", t["debt"]]], first=True)
    sheet("Exams", ["Exam", "Copies sold", "Sales value", "Collected", "Debt", "Direct costs", "Profit", "Closed"],
          [[e["name"], e["sold"], e["value"], e["collected"], e["debt"], e["costs"], e["profit"], "Yes" if e["closed"] else "No"] for e in r["exams"]])
    sheet("Sales people", ["Name", "Schools", "Copies sold", "Sales value", "Collected", "Commission %", "Commission", "Debts open", "Debts overdue"],
          [[s["name"], s["schools"], s["sold"], s["value"], s["collected"], s["commission_percent"], s["commission"], s["open_debt"], s["overdue_debt"]] for s in r["sales"]])
    sheet("Slow payers", ["School", "District", "Phone", "Owes", "Oldest debt (days)", "Overdue"],
          [[s["name"], s["district"], s["phone"], s["debt"], s["oldest_debt_days"], "Yes" if s["overdue"] else "No"] for s in r["slow_payers"]])
    sheet("Sales", ["Date", "School", "Exam", "Sold by", "Copies", "Price", "Value", "Paid", "Method", "MoMo ID", "Delivery note", "Debt"],
          [[v.date, v.school.name, v.exam.name, L.name(v.sales_id), v.copies, v.price, L.visit_value(v), v.paid, v.get_method_display(),
            v.momo_id, v.note_no, L.visit_debt(v)] for v in sorted(r["visits"], key=lambda v: v.date)])
    sheet("Debt payments", ["Date", "School", "Amount", "Method", "MoMo ID"],
          [[timezone.localtime(p.created_at).date(), L.visits and next((v.school.name for v in L.visits if v.id == p.visit_id), ""), p.amount,
            p.get_method_display(), p.momo_id] for p in r["payments"]])
    sheet("Expenses", ["Date", "Category", "Amount", "Exam", "Note"],
          [[x.date, x.get_category_display(), x.amount, x.exam.name if x.exam else "", x.note] for x in sorted(r["expenses"], key=lambda x: x.date)])
    buf = BytesIO()
    wb.save(buf)
    resp = HttpResponse(buf.getvalue(), content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    resp["Content-Disposition"] = f'attachment; filename="printery-report-{label.replace(" ", "_")}.xlsx"'
    return resp


class ExpenseViewSet(mixins.CreateModelMixin, mixins.ListModelMixin, viewsets.GenericViewSet):
    serializer_class = S.ExpenseSerializer
    permission_classes = [roles(OWNER)]

    def get_queryset(self):
        return Expense.objects.select_related("exam").order_by("-date", "-created_at")[:100]

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)


class FeedbackViewSet(mixins.CreateModelMixin, mixins.ListModelMixin, viewsets.GenericViewSet):
    """Anyone can send a problem or idea; only the owner reads them."""

    serializer_class = S.FeedbackSerializer

    def get_queryset(self):
        qs = Feedback.objects.select_related("created_by").order_by("-created_at")
        is_owner = self.request.user.is_superuser or self.request.user.role == OWNER
        return qs if is_owner else qs.filter(created_by=self.request.user)

    def perform_create(self, serializer):
        f = serializer.save(created_by=self.request.user)
        tell(people(OWNER), f"{self.request.user.display_name} sent a problem or idea", f.text[:200], "/owner/pilot",
             Notification.Level.ACTION, exclude=self.request.user)

    @action(detail=True, methods=["post"])
    def resolve(self, request, pk=None):
        if not (request.user.is_superuser or request.user.role == OWNER):
            return Response(status=403)
        Feedback.objects.filter(pk=pk).update(resolved_at=timezone.now())
        return Response({"ok": True})


@api_view(["GET"])
@permission_classes([roles(OWNER)])
def pilot_compare(request):
    """The system's figures for one exam, for comparing with the paper records during the pilot."""
    L = Ledger()
    try:
        exam = L.exams[int(request.query_params.get("exam", 0))]
    except (KeyError, ValueError):
        return Response({"detail": "Choose an exam."}, status=400)
    st = L.exam_stats(exam)
    vs = [v for v in L.visits if v.exam_id == exam.id]
    return Response({"exam": exam.name, "figures": [
        {"key": "printed", "label": "Copies printed", "system": st["printed"] or 0},
        {"key": "counted", "label": "Copies counted by store", "system": st["counted"] or 0},
        {"key": "issued", "label": "Copies issued to sales", "system": st["issued"]},
        {"key": "returned", "label": "Copies returned", "system": st["returned"]},
        {"key": "sold", "label": "Copies sold to schools", "system": st["sold"]},
        {"key": "schools", "label": "Schools sold to", "system": len({v.school_id for v in vs})},
        {"key": "value", "label": "Sales value (UGX)", "system": st["value"]},
        {"key": "collected", "label": "Money collected (UGX)", "system": st["collected"]},
        {"key": "debt", "label": "Schools still owe (UGX)", "system": st["debt"]},
    ]})
