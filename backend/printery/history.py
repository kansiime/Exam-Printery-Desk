"""Change history: who created, changed or cancelled what, and when, across the whole system.

django-simple-history keeps a copy of every record each time it is saved; this turns those
copies into one readable list with the fields that changed (old value → new value).
"""
from datetime import datetime

from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from accounts.models import User

from . import models as m
from .permissions import OWNER, roles

# What appears in the history, with a plain name for each kind of record.
TRACKED = [
    (m.Exam, "Print order"), (m.PrintRun, "Printing"), (m.OtherPrint, "Other printing"), (m.StoreReceipt, "Store count"),
    (m.Issue, "Copies issued"), (m.Return, "Copies returned"), (m.School, "School"), (m.Visit, "Sale"), (m.Payment, "Debt payment"),
    (m.CashHandover, "Cash to store"), (m.OwnerHandover, "Cash to owner"), (m.PaperIssue, "Paper"), (m.StockCount, "Surprise count"),
    (m.SchoolCheck, "School check"), (m.DayClose, "Day close"), (m.Expense, "Expense"), (m.DebtNote, "Debt note"),
    (m.CorrectionRequest, "Mistake report"), (User, "Account"),
]
HIDDEN_FIELDS = {"password", "last_login", "failed_logins", "history_change_reason", "client_id", "code_hash"}
ACTION = {"+": "created", "~": "changed", "-": "deleted"}


def describe(kind, h):
    """A short label for the record as it was at that moment."""
    g = lambda name: getattr(h, name, None)  # noqa: E731
    try:
        if kind == "Account":
            name = f"{h.first_name} {h.last_name}".strip() or h.username
            roles = {"owner": "Owner", "printer": "Printer", "store": "Store keeper", "sales": "Sales person"}
            return f"{name} ({roles.get(h.role, h.role)})"
        if kind in ("Print order", "School"):
            return h.name
        if kind == "Sale":
            return f"{g('copies')} copies to {h.school.name} ({h.exam.name}), delivery note {g('note_no')}"
        if kind == "Debt payment":
            return f"UGX {g('amount'):,} from {h.visit.school.name}"
        if kind in ("Printing", "Store count", "Copies issued", "Copies returned"):
            extra = f" to {h.sales.display_name}" if kind == "Copies issued" else f" from {h.sales.display_name}" if kind == "Copies returned" else ""
            return f"{h.exam.name}: {g('qty') if g('qty') is not None else '–'} copies{extra}"
        if kind in ("Cash to store", "Cash to owner", "Expense"):
            return f"UGX {g('amount'):,}" + (f" from {h.sales.display_name}" if kind == "Cash to store" else "")
        if kind == "Day close":
            return f"{h.sales.display_name}, {g('date')}"
        if kind == "Debt note":
            return f"{h.school.name}: {g('text')[:60]}"
    except Exception:
        pass
    return f"#{h.id}"


def field_label(model, name):
    try:
        return str(model._meta.get_field(name).verbose_name).capitalize()
    except Exception:
        return name.replace("_", " ").capitalize()


def show(value):
    if value is None or value == "":
        return "–"
    if isinstance(value, datetime):
        return timezone.localtime(value).strftime("%d %b %Y %H:%M")
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, int) and abs(value) >= 1000:
        return f"{value:,}"
    return str(value)[:120]


@api_view(["GET"])
@permission_classes([roles(OWNER)])
def history(request):
    """?person=<user id>&kind=<Sale|Printing|…>&before=<ISO time>&limit=<n>"""
    person = request.query_params.get("person")
    kind_filter = request.query_params.get("kind")
    before = request.query_params.get("before")
    limit = min(int(request.query_params.get("limit") or 60), 200)
    rows = []
    for model, kind in TRACKED:
        if kind_filter and kind != kind_filter:
            continue
        qs = model.history.select_related("history_user").order_by("-history_date")
        if person and person.isdigit():
            qs = qs.filter(history_user_id=int(person))
        if before:
            try:
                qs = qs.filter(history_date__lt=datetime.fromisoformat(before.replace("Z", "+00:00")))
            except ValueError:
                pass
        for h in qs[:limit]:
            changes = []
            if h.history_type == "~":
                prev = h.prev_record
                if prev is not None:
                    for c in h.diff_against(prev).changes:
                        if c.field in HIDDEN_FIELDS:
                            continue
                        changes.append({"field": field_label(model, c.field), "old": show(c.old), "new": show(c.new)})
                if not changes:
                    continue  # saved with nothing visible changed
            cancelled = any(c["field"].lower().startswith("cancelled at") and c["old"] == "–" for c in changes)
            rows.append({
                "at": h.history_date, "kind": kind, "record_id": h.id, "label": describe(kind, h),
                "action": "cancelled" if cancelled else ACTION.get(h.history_type, "changed"),
                "by": (h.history_user.get_full_name() or h.history_user.username) if h.history_user else "System",
                "by_id": h.history_user_id, "changes": changes,
            })
    rows.sort(key=lambda r: r["at"], reverse=True)
    rows = rows[:limit]
    return Response({"items": rows, "kinds": [k for _, k in TRACKED],
                     "people": [{"id": u.id, "name": u.get_full_name() or u.username} for u in User.objects.order_by("first_name")],
                     "next_before": rows[-1]["at"] if len(rows) == limit else None})
