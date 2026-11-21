import hmac
import re

from django.conf import settings
from django.contrib.auth import authenticate, login, logout
from django.db import IntegrityError, transaction
from django.utils import timezone
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action, api_view, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle

from accounts.models import User

from . import serializers as S
from .models import (
    CANCELLABLE, CashHandover, CorrectionRequest, Exam, Issue, Method, MomoLine, OtherPrint, OwnerHandover,
    PaperIssue, Payment, PrintRun, Return, School, SchoolCheck, StockCount, StockCountItem, StoreReceipt, Visit,
)
from .permissions import OWNER, PRINTER, SALES, STORE, role_of, roles
from .services import Ledger, audit, weekly_schools
from .tasks import send_visit_confirmation
from . import notify as N
from .models import Notification


# ---------- health and photos ----------
@api_view(["GET"])
@permission_classes([AllowAny])
def health(request):
    from django.db import connection
    connection.ensure_connection()
    return Response({"ok": True})


def protected_media(request, path):
    from django.http import HttpResponseForbidden
    from django.views.static import serve
    if not request.user.is_authenticated:
        return HttpResponseForbidden("Sign in to see photos.")
    return serve(request, path, document_root=settings.MEDIA_ROOT)


# ---------- auth ----------
class LoginThrottle(ScopedRateThrottle):
    scope = "login"


def me_payload(user):
    return {"id": user.id, "username": user.username, "name": user.display_name,
            "first_name": user.first_name, "last_name": user.last_name, "phone": user.phone,
            "role": OWNER if user.is_superuser else user.role, "business": settings.BUSINESS_NAME}


@api_view(["GET"])
@permission_classes([AllowAny])
@ensure_csrf_cookie
def csrf(request):
    return Response({"ok": True})


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([LoginThrottle])
def login_view(request):
    user = authenticate(request, username=request.data.get("username", "").strip(), password=request.data.get("password", ""))
    if not user:
        return Response({"detail": "Wrong username or password."}, status=400)
    login(request, user)
    return Response(me_payload(user))


@api_view(["POST"])
def logout_view(request):
    logout(request)
    return Response({"ok": True})


@api_view(["GET", "PATCH"])
def me(request):
    """GET: who is signed in. PATCH: change your own name and phone (not your role)."""
    user = request.user
    if request.method == "PATCH":
        first = str(request.data.get("first_name", user.first_name)).strip()[:150]
        if not first:
            return Response({"first_name": "Enter your first name."}, status=400)
        user.first_name = first
        user.last_name = str(request.data.get("last_name", user.last_name)).strip()[:150]
        user.phone = str(request.data.get("phone", user.phone)).strip()[:20]
        user.save(update_fields=["first_name", "last_name", "phone"])
    return Response(me_payload(user))


# ---------- base ----------
class CreateListViewSet(mixins.CreateModelMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Business records are created and read, never edited or deleted. The owner cancels them."""

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)


class UserViewSet(viewsets.ModelViewSet):
    serializer_class = S.UserSerializer
    permission_classes = [roles(OWNER)]
    queryset = User.objects.order_by("role", "first_name")
    http_method_names = ["get", "post", "patch"]


class ExamViewSet(CreateListViewSet, mixins.UpdateModelMixin):
    serializer_class = S.ExamSerializer
    permission_classes = [roles(OWNER, read=(PRINTER, STORE, SALES))]
    queryset = Exam.objects.all()
    http_method_names = ["get", "post", "patch"]

    def perform_create(self, serializer):
        e = serializer.save(created_by=self.request.user)
        N.tell_roles([PRINTER], f"New print order: {e.name}", f"Print {e.ordered_qty:,} copies ({e.pages} pages each). {e.note}".strip(),
                     "/print", Notification.Level.ACTION)


class PrintViewSet(CreateListViewSet):
    permission_classes = [roles(OWNER, PRINTER)]
    queryset = PrintRun.objects.select_related("exam", "created_by")

    def get_serializer_class(self):
        return S.PrintStartSerializer if self.action == "create" else S.PrintRunSerializer

    def perform_create(self, serializer):
        run = serializer.save(created_by=self.request.user)
        N.tell_roles([OWNER], f"{self.request.user.display_name} started printing {run.exam.name}",
                     f"Meter before: {run.meter_before:,} on {run.machine}.", "/owner/fraud", photos=[N.photo_url(run.photo_before)],
                     exclude=self.request.user)

    @action(detail=True, methods=["post"])
    def finish(self, request, pk=None):
        run = self.get_object()
        # With several printers, only the person who started a job (or the owner) may post it.
        if run.created_by_id and run.created_by_id != request.user.id and role_of(request) != OWNER:
            return Response({"detail": f"{run.created_by.display_name} started this job, so they must post it. Ask the owner if they can't."}, status=403)
        ser = S.PrintFinishSerializer(run, data=request.data)
        ser.is_valid(raise_exception=True)
        ser.save(done_at=timezone.now())
        e = run.exam
        expected = e.pages * run.qty + run.spoilt * e.sides
        extra = run.meter_pages - expected
        N.tell_roles([OWNER], f"{request.user.display_name} printed {run.qty:,} copies of {e.name}",
                     f"Meter {run.meter_before:,} → {run.meter_after:,} = {run.meter_pages:,} pages. Expected {expected:,} "
                     f"({run.qty:,} × {e.pages} + {run.spoilt} spoilt). " + (f"{extra:,} pages too many!" if extra > max(e.pages, 1) else "Meter matches."),
                     "/owner/fraud", Notification.Level.URGENT if extra > max(e.pages, 1) else Notification.Level.INFO,
                     photos=[N.photo_url(run.photo_before), N.photo_url(run.photo_after)], exclude=request.user)
        N.tell_roles([STORE], f"{e.name} is printed", "Fold and count the copies, then confirm the count.", "/store", Notification.Level.ACTION)
        N.check_findings()
        return Response(S.PrintRunSerializer(run, context={"request": request}).data)


class OtherPrintViewSet(CreateListViewSet):
    serializer_class = S.OtherPrintSerializer
    permission_classes = [roles(OWNER, PRINTER)]
    queryset = OtherPrint.objects.all()

    def perform_create(self, serializer):
        o = serializer.save(created_by=self.request.user)
        N.tell_roles([OWNER], f"{self.request.user.display_name} recorded other printing", f"{o.description}: meter {o.meter_before:,} → {o.meter_after:,}.",
                     "/print", photos=[N.photo_url(o.photo_before), N.photo_url(o.photo_after)], exclude=self.request.user)
        N.check_findings()


class ReceiptViewSet(CreateListViewSet):
    serializer_class = S.ReceiptSerializer
    permission_classes = [roles(OWNER, STORE)]
    queryset = StoreReceipt.objects.select_related("exam")

    def perform_create(self, serializer):
        r = serializer.save(created_by=self.request.user)
        printed = PrintRun.objects.filter(exam=r.exam, done_at__isnull=False).order_by("-done_at").first()
        differs = printed and printed.qty != r.qty
        N.tell_roles([OWNER], f"{self.request.user.display_name} counted {r.qty:,} copies of {r.exam.name}",
                     f"Printer posted {printed.qty:,}. " + ("The counts don't match!" if differs else "Counts match.") if printed else "",
                     "/owner", Notification.Level.URGENT if differs else Notification.Level.INFO, exclude=self.request.user)
        N.check_findings()


class IssueViewSet(CreateListViewSet):
    serializer_class = S.IssueSerializer
    permission_classes = [roles(OWNER, STORE, read=(SALES,)) ]

    def get_queryset(self):
        qs = Issue.objects.select_related("exam", "sales", "created_by")
        return qs.filter(sales=self.request.user) if role_of(self.request) == SALES else qs

    def get_permissions(self):
        if self.action == "accept":
            return [roles(SALES)()]
        return super().get_permissions()

    def perform_create(self, serializer):
        x = serializer.save(created_by=self.request.user)
        N.tell([x.sales], f"{self.request.user.display_name} issued you {x.qty:,} copies of {x.exam.name}",
               "Count them, then tap “I received” to accept.", "/field", Notification.Level.ACTION)
        N.check_findings()

    @action(detail=True, methods=["post"])
    def accept(self, request, pk=None):
        issue = self.get_object()
        if not issue.accepted_at:
            issue.accepted_at = timezone.now()
            issue.save(update_fields=["accepted_at"])
            if issue.created_by:
                N.tell([issue.created_by], f"{request.user.display_name} accepted {issue.qty:,} copies of {issue.exam.name}", "", "/store")
        return Response(S.IssueSerializer(issue).data)


class ReturnViewSet(CreateListViewSet):
    serializer_class = S.ReturnSerializer
    permission_classes = [roles(OWNER, STORE)]
    queryset = Return.objects.select_related("exam", "sales")

    def perform_create(self, serializer):
        x = serializer.save(created_by=self.request.user)
        N.tell([x.sales], f"{self.request.user.display_name} received {x.qty:,} copies of {x.exam.name} back from you", "", "/field")
        N.check_findings()


class SchoolViewSet(CreateListViewSet, mixins.UpdateModelMixin):
    serializer_class = S.SchoolSerializer
    permission_classes = [roles(OWNER, SALES, read=(STORE,))]
    queryset = School.objects.filter(merged_into__isnull=True)
    http_method_names = ["get", "post", "patch"]

    def get_permissions(self):
        if self.action in ("partial_update", "update", "merge"):
            return [roles(OWNER)()]
        return super().get_permissions()

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def merge(self, request, pk=None):
        school = self.get_object()
        target = School.objects.filter(pk=request.data.get("into"), merged_into__isnull=True).exclude(pk=school.pk).first()
        if not target:
            return Response({"detail": "Choose the school to merge into."}, status=400)
        Visit.all_objects.filter(school=school).update(school=target)
        SchoolCheck.all_objects.filter(school=school).update(school=target)
        school.merged_into = target
        school.save(update_fields=["merged_into"])
        return Response({"ok": True, "into": target.name})


class VisitViewSet(CreateListViewSet):
    serializer_class = S.VisitSerializer
    permission_classes = [roles(SALES, read=(OWNER,))]

    def get_queryset(self):
        qs = Visit.objects.select_related("exam", "school", "sales").prefetch_related("payments")
        return qs.filter(sales=self.request.user) if role_of(self.request) == SALES else qs

    def create(self, request, *args, **kwargs):
        # Offline phones retry with the same client_id; answer with the saved visit instead of a duplicate.
        client_id = request.data.get("client_id")

        def existing():
            v = Visit.all_objects.filter(client_id=client_id, sales=request.user).first() if client_id else None
            return Response(self.get_serializer(v).data, status=200) if v else None

        if (found := existing()) is not None:
            return found
        try:
            with transaction.atomic():
                return super().create(request, *args, **kwargs)
        except (IntegrityError, serializers.ValidationError):
            # Two sends of the same offline visit arrived together: the first one won.
            if (found := existing()) is not None:
                return found
            raise

    def perform_create(self, serializer):
        visit = serializer.save(created_by=self.request.user, sales=self.request.user)
        transaction.on_commit(lambda: send_visit_confirmation.delay(visit.id))
        owes = visit.copies * visit.price - visit.paid
        N.tell_roles([OWNER], f"{visit.sales.display_name} sold {visit.copies:,} copies to {visit.school.name}",
                     f"{visit.exam.name}: paid UGX {visit.paid:,}" + (f", owes UGX {owes:,}" if owes > 0 else "") + f". Delivery note {visit.note_no}.",
                     "/owner/fraud", photos=[N.photo_url(visit.note_photo)])
        if visit.price_status == Visit.PriceStatus.PENDING:
            N.tell_roles([OWNER], f"Discount needs your approval: {visit.school.name}",
                         f"{visit.sales.display_name} sold at UGX {visit.price:,} instead of {visit.exam.price:,}. Reason: {visit.price_reason}",
                         "/owner", Notification.Level.ACTION)
        N.check_findings()

    def get_permissions(self):
        if self.action == "decide_price":
            return [roles(OWNER)()]
        return super().get_permissions()

    @action(detail=True, methods=["post"], url_path="decide-price")
    def decide_price(self, request, pk=None):
        visit = self.get_object()
        decision = request.data.get("status")
        if decision not in (Visit.PriceStatus.APPROVED, Visit.PriceStatus.REJECTED):
            return Response({"detail": "Status must be approved or rejected."}, status=400)
        visit.price_status, visit.price_decided_by = decision, request.user
        visit.save(update_fields=["price_status", "price_decided_by"])
        N.tell([visit.sales], f"Discount {'approved' if decision == Visit.PriceStatus.APPROVED else 'rejected'} for {visit.school.name}",
               "" if decision == Visit.PriceStatus.APPROVED else f"Collect the school's debt at the set price of UGX {visit.exam.price:,} a copy.",
               "/field", Notification.Level.INFO if decision == Visit.PriceStatus.APPROVED else Notification.Level.ACTION)
        return Response(self.get_serializer(visit).data)


class PaymentViewSet(CreateListViewSet):
    serializer_class = S.PaymentSerializer
    permission_classes = [roles(OWNER, SALES)]

    def get_queryset(self):
        qs = Payment.objects.select_related("visit__school", "created_by")
        return qs.filter(visit__sales=self.request.user) if role_of(self.request) == SALES else qs

    def perform_create(self, serializer):
        visit = serializer.validated_data["visit"]
        is_sales = role_of(self.request) == SALES
        if is_sales and visit.sales_id != self.request.user.id:
            raise serializers.ValidationError("You can only record payments for your own schools.")
        p = serializer.save(created_by=self.request.user, sales=self.request.user if is_sales else None)
        N.tell_roles([OWNER], f"{p.visit.school.name} paid UGX {p.amount:,} of its debt", f"Recorded by {self.request.user.display_name}.", "/debts",
                     exclude=self.request.user)


class CashViewSet(CreateListViewSet):
    serializer_class = S.CashSerializer
    permission_classes = [roles(OWNER, STORE, read=(SALES,))]

    def get_queryset(self):
        qs = CashHandover.objects.select_related("sales", "created_by")
        return qs.filter(sales=self.request.user) if role_of(self.request) == SALES else qs

    def perform_create(self, serializer):
        c = serializer.save(created_by=self.request.user)
        N.tell([c.sales], f"{self.request.user.display_name} recorded UGX {c.amount:,} cash from you", "If that's not what you handed over, tell the owner.", "/field")


class HandoverViewSet(CreateListViewSet):
    serializer_class = S.OwnerHandoverSerializer
    permission_classes = [roles(STORE, read=(OWNER,))]
    queryset = OwnerHandover.objects.select_related("created_by")

    def get_permissions(self):
        if self.action == "confirm":
            return [roles(OWNER)()]
        return super().get_permissions()

    def perform_create(self, serializer):
        h = serializer.save(created_by=self.request.user)
        N.tell_roles([OWNER], f"{self.request.user.display_name} says they handed you UGX {h.amount:,}",
                     f"{h.method}{' · ' + h.ref if h.ref else ''}. Confirm once you have it.", "/cash", Notification.Level.ACTION)

    @action(detail=True, methods=["post"])
    def confirm(self, request, pk=None):
        h = self.get_object()
        if not h.confirmed_at:
            h.confirmed_at, h.confirmed_by = timezone.now(), request.user
            h.save(update_fields=["confirmed_at", "confirmed_by"])
            if h.created_by:
                N.tell([h.created_by], f"The owner confirmed receiving UGX {h.amount:,}", "", "/cash")
        return Response(self.get_serializer(h).data)


class PaperViewSet(CreateListViewSet):
    serializer_class = S.PaperSerializer
    permission_classes = [roles(OWNER)]
    queryset = PaperIssue.objects.all()


class SchoolCheckViewSet(CreateListViewSet):
    serializer_class = S.SchoolCheckSerializer
    permission_classes = [roles(OWNER)]
    queryset = SchoolCheck.objects.select_related("school")


class MomoViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    serializer_class = S.MomoLineSerializer
    permission_classes = [roles(OWNER)]
    queryset = MomoLine.objects.all()

    @action(detail=False, methods=["post"])
    def paste(self, request):
        """One payment per line: transaction ID, then amount (any separator)."""
        added = skipped = 0
        for line in str(request.data.get("text", "")).splitlines():
            line = re.sub(r"(?<=\d),(?=\d{3}\b)", "", line)  # 30,000 -> 30000
            toks = [t for t in re.split(r"[\s,;\t|]+", line.strip()) if t]
            if not toks:
                continue
            tx = next((t for t in toks if re.search(r"\d", t) and not re.fullmatch(r"[\d,]+(\.\d+)?", t) and len(re.sub(r"[^0-9A-Za-z]", "", t)) >= 6), None) \
                or next((t for t in toks if re.fullmatch(r"\d{8,}", t)), None)
            amount = next((t.replace(",", "") for t in toks if t != tx and re.fullmatch(r"\d+(\.\d+)?", t.replace(",", ""))), None)
            if not tx or not amount:
                continue
            _, created = MomoLine.objects.get_or_create(tx_id=tx.upper(), defaults={"amount": int(float(amount)), "created_by": request.user})
            added, skipped = added + created, skipped + (not created)
        if not added and not skipped:
            return Response({"detail": "No lines read. Put one payment per line: transaction ID, then amount."}, status=400)
        return Response({"added": added, "already_there": skipped})


class CorrectionViewSet(CreateListViewSet):
    serializer_class = S.CorrectionSerializer

    def get_queryset(self):
        qs = CorrectionRequest.objects.filter(resolved_at__isnull=True).select_related("created_by")
        return qs if role_of(self.request) == OWNER else qs.filter(created_by=self.request.user)

    def get_permissions(self):
        if self.action == "dismiss":
            return [roles(OWNER)()]
        return [IsAuthenticated()]

    def perform_create(self, serializer):
        c = serializer.save(created_by=self.request.user)
        N.tell_roles([OWNER], f"{self.request.user.display_name} reported a mistake", c.reason, "/owner", Notification.Level.ACTION, exclude=self.request.user)

    @action(detail=True, methods=["post"])
    def dismiss(self, request, pk=None):
        c = self.get_object()
        c.resolved_at, c.resolution = timezone.now(), "dismissed"
        c.save(update_fields=["resolved_at", "resolution"])
        return Response({"ok": True})


# ---------- owner actions ----------
@api_view(["POST"])
@permission_classes([roles(OWNER)])
def cancel_record(request):
    model = CANCELLABLE.get(request.data.get("type"))
    reason = str(request.data.get("reason", "")).strip()
    if not model or not reason:
        return Response({"detail": "Give the record type, id and a reason."}, status=400)
    obj = model.objects.filter(pk=request.data.get("id")).first()
    if not obj:
        return Response({"detail": "That record is already cancelled or does not exist."}, status=404)
    obj.cancelled_at, obj.cancelled_by, obj.cancel_reason = timezone.now(), request.user, reason[:300]
    obj.save(update_fields=["cancelled_at", "cancelled_by", "cancel_reason"])
    CorrectionRequest.objects.filter(target_type=request.data.get("type"), target_id=obj.pk, resolved_at__isnull=True) \
        .update(resolved_at=timezone.now(), resolution="cancelled")
    return Response({"ok": True})


@api_view(["GET"])
@permission_classes([roles(OWNER)])
def cancelled_records(request):
    rows = []
    for key, model in CANCELLABLE.items():
        for obj in model.all_objects.filter(cancelled_at__isnull=False).order_by("-cancelled_at")[:20]:
            rows.append({"type": key, "id": obj.pk, "label": str(obj) if key == "exam" else f"{model._meta.verbose_name} #{obj.pk}",
                         "reason": obj.cancel_reason, "cancelled_at": obj.cancelled_at,
                         "by": obj.cancelled_by.display_name if obj.cancelled_by else ""})
    rows.sort(key=lambda r: r["cancelled_at"], reverse=True)
    return Response(rows[:40])


@api_view(["GET", "POST"])
@permission_classes([roles(OWNER)])
def stock_counts(request):
    if request.method == "POST":
        L = Ledger()
        items = [i for i in request.data.get("items", []) if str(i.get("counted", "")).strip() != ""]
        paper = request.data.get("paper_counted")
        if not items and paper in (None, ""):
            return Response({"detail": "Enter at least one count."}, status=400)
        with transaction.atomic():
            count = StockCount.objects.create(
                created_by=request.user,
                paper_counted=int(paper) if paper not in (None, "") else None,
                paper_expected=L.paper_stats()["left"] if paper not in (None, "") else None)
            for i in items:
                exam = Exam.objects.get(pk=i["exam"])
                StockCountItem.objects.create(count=count, exam=exam, counted=int(i["counted"]), expected=L.exam_stats(exam)["in_store"])
    data = [{"id": c.id, "created_at": c.created_at, "paper_counted": c.paper_counted, "paper_expected": c.paper_expected,
             "items": [{"exam": it.exam.name, "counted": it.counted, "expected": it.expected} for it in c.items.all()]}
            for c in StockCount.objects.prefetch_related("items__exam")[:10]]
    return Response(data)


# ---------- summaries for each screen ----------
@api_view(["GET"])
@permission_classes([roles(OWNER)])
def overview(request):
    L = Ledger()
    data = L.overview()
    data["pending_prices"] = S.VisitSerializer(
        Visit.objects.filter(price_status=Visit.PriceStatus.PENDING).select_related("exam", "school", "sales").prefetch_related("payments"),
        many=True, context={"request": request}).data
    data["corrections"] = S.CorrectionSerializer(CorrectionRequest.objects.filter(resolved_at__isnull=True), many=True).data
    data["findings"] = audit(L)["findings"]
    return Response(data)


@api_view(["GET"])
@permission_classes([roles(OWNER)])
def audit_view(request):
    L = Ledger()
    result = audit(L)
    result["paper"] = L.paper_stats()
    recs = L.momo_records()
    ids = {r["id"] for r in recs}
    result["momo"] = {"statement_count": MomoLine.objects.count(), "recorded_count": len(recs),
                      "unmatched_statement": S.MomoLineSerializer(MomoLine.objects.exclude(tx_id__in=ids)[:20], many=True).data}
    result["weekly_schools"] = []
    for s in weekly_schools():
        vs = [v for v in L.visits if v.school_id == s.id]
        result["weekly_schools"].append({
            "id": s.id, "name": s.name, "contact": " · ".join(x for x in [s.contact, s.phone, s.district] if x),
            "copies": sum(v.copies for v in vs), "value": sum(L.visit_value(v) for v in vs),
            "paid": sum(v.paid for v in vs) + sum(p.amount for p in L.payments if p.visit_id in {v.id for v in vs}),
            "sellers": ", ".join(sorted({L.name(v.sales_id) for v in vs})),
            "serials": "; ".join(v.serials for v in vs if v.serials)})
    result["recent_sales"] = S.VisitSerializer(Visit.objects.select_related("exam", "school", "sales").prefetch_related("payments")[:15],
                                               many=True, context={"request": request}).data
    return Response(result)


@api_view(["GET"])
@permission_classes([roles(OWNER, STORE)])
def store_summary(request):
    L = Ledger()
    exams = []
    for e in sorted(L.exams.values(), key=lambda x: x.created_at, reverse=True):
        st = L.exam_stats(e)
        printed = L.print_for(e.id)
        exams.append({"id": e.id, "name": e.name, "numbered": e.numbered, "counted": st["counted"], "issued": st["issued"],
                      "returned": st["returned"], "in_store": st["in_store"],
                      # Blind count: the store keeper never sees the printer's figure.
                      "to_count": bool(printed) and st["counted"] is None,
                      "printed_at": printed.done_at if printed else None})
    sales = []
    for u in L.sales_people():
        st = L.sales_stats(u.id)
        sales.append({"id": u.id, "name": u.display_name, "cash_held": st["cash_held"],
                      "holding": {str(k): v for k, v in st["per_exam"].items() if v > 0}})
    return Response({"exams": exams, "sales": sales, "store_cash": L.store_cash()})


@api_view(["GET"])
@permission_classes([roles(SALES)])
def field_summary(request):
    L = Ledger()
    st = L.sales_stats(request.user.id)
    holding = [{"exam": k, "name": L.exams[k].name, "qty": v, "price": L.exams[k].price, "numbered": L.exams[k].numbered}
               for k, v in st["per_exam"].items() if v > 0 and k in L.exams]
    pending = S.IssueSerializer(Issue.objects.filter(id__in=st["pending_issues"]).select_related("exam", "sales", "created_by"), many=True).data
    return Response({**{k: v for k, v in st.items() if k not in ("per_exam", "pending_issues")},
                     "holding_by_exam": holding, "pending_issues": pending})


@api_view(["GET"])
@permission_classes([roles(OWNER, SALES)])
def debts(request):
    L = Ledger()
    visits = L.visits if role_of(request) == OWNER else [v for v in L.visits if v.sales_id == request.user.id]
    today = timezone.localdate()
    by_school = {}
    for v in visits:
        d = L.visit_debt(v)
        if d <= 0:
            continue
        row = by_school.setdefault(v.school_id, {"school": v.school.name, "district": v.school.district, "contact": v.school.contact,
                                                 "phone": v.school.phone, "total": 0, "visits": []})
        row["total"] += d
        age = (today - v.date).days
        row["visits"].append({"id": v.id, "exam": v.exam.name, "copies": v.copies, "price": v.price, "debt": d, "date": v.date,
                              "due": v.due, "overdue": bool(v.due and v.due < today), "age_days": age, "sales": L.name(v.sales_id)})
    rows = sorted(by_school.values(), key=lambda r: r["total"], reverse=True)
    ageing = {"under_30": 0, "30_60": 0, "over_60": 0}
    for r in rows:
        for v in r["visits"]:
            ageing["under_30" if v["age_days"] < 30 else "30_60" if v["age_days"] <= 60 else "over_60"] += v["debt"]
    return Response({"schools": rows, "total": sum(r["total"] for r in rows), "ageing": ageing})


@api_view(["GET"])
@permission_classes([roles(OWNER, STORE)])
def cash_summary(request):
    L = Ledger()
    mine = role_of(request) == STORE
    return Response({
        "store": L.store_cash(request.user.id if mine else None),
        "keepers": [] if mine else L.store_keepers(),
        "sales": [{"id": u.id, "name": u.display_name, **{k: L.sales_stats(u.id)[k] for k in ("cash_collected", "handed", "cash_held")}}
                  for u in L.sales_people()],
    })


# ---------- webhooks (no login; protected by shared tokens) ----------
def _token_ok(request, expected):
    given = request.headers.get("X-Webhook-Token") or request.query_params.get("token", "")
    return bool(expected) and hmac.compare_digest(given, expected)


@api_view(["POST"])
@permission_classes([AllowAny])
def momo_webhook(request):
    """Payment provider calls this for each payment into the business number."""
    if not _token_ok(request, settings.MOMO_WEBHOOK_TOKEN):
        return Response(status=status.HTTP_403_FORBIDDEN)
    tx, amount = str(request.data.get("transaction_id", "")).strip().upper(), request.data.get("amount")
    if not tx or amount in (None, ""):
        return Response({"detail": "transaction_id and amount are required"}, status=400)
    MomoLine.objects.get_or_create(tx_id=tx, defaults={"amount": int(float(amount)), "payer": str(request.data.get("payer", ""))[:60],
                                                       "received_at": timezone.now(), "source": "webhook"})
    return Response({"ok": True})


@api_view(["POST"])
@permission_classes([AllowAny])
def sms_inbound(request):
    """Africa's Talking forwards school replies here: '1' = correct, '2' = not correct."""
    if not _token_ok(request, settings.SMS_WEBHOOK_TOKEN):
        return Response(status=status.HTTP_403_FORBIDDEN)
    phone, text = str(request.data.get("from", "")), str(request.data.get("text", "")).strip()
    digits = re.sub(r"\D", "", phone)[-9:]
    visit = next((v for v in Visit.objects.select_related("school").order_by("-created_at")[:300]
                  if digits and re.sub(r"\D", "", v.school.phone)[-9:] == digits and not v.confirmation), None)
    if not visit:
        return Response({"ok": True, "matched": False})
    answer = "confirmed" if text.startswith("1") else "disputed" if text.startswith("2") else ""
    if answer:
        visit.confirmation = answer
        visit.save(update_fields=["confirmation"])
        SchoolCheck.objects.create(kind=SchoolCheck.Kind.SMS, school=visit.school, visit=visit,
                                   result=SchoolCheck.Result.MATCH if answer == "confirmed" else SchoolCheck.Result.MISMATCH,
                                   note=f"SMS reply: {text[:100]}")
    return Response({"ok": True, "matched": True})


# ---------- in-app notifications ----------
@api_view(["GET"])
def notifications(request):
    qs = Notification.objects.filter(recipient=request.user)
    after = request.query_params.get("after")
    items = list((qs.filter(id__gt=after) if after and after.isdigit() else qs)[:50])
    return Response({
        "unread": qs.filter(read_at__isnull=True).count(),
        "items": [{"id": n.id, "level": n.level, "title": n.title, "body": n.body, "link": n.link, "photos": n.photos,
                   "created_at": n.created_at, "read": bool(n.read_at)} for n in items],
    })


@api_view(["POST"])
def notifications_read(request):
    qs = Notification.objects.filter(recipient=request.user, read_at__isnull=True)
    ids = request.data.get("ids")
    if isinstance(ids, list):
        qs = qs.filter(id__in=[i for i in ids if isinstance(i, int)])
    qs.update(read_at=timezone.now())
    return Response({"ok": True})
