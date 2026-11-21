"""End-of-day closing, exam closing, phone push alerts and QR copy verification."""
import hashlib
import hmac
import math

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle

from .models import CopyScan, DayClose, Exam, Method, Notification, PushSubscription, StoreReceipt
from .notify import OWNER, STORE, people, tell
from .permissions import SALES, role_of, roles
from .services import Ledger, parse_serials, ugx


# ---------- end-of-day closing ----------
def close_row(c, L):
    name = lambda k: L.exams[int(k)].name if int(k) in L.exams else "Exam"  # noqa: E731
    return {
        "id": c.id, "date": c.date, "sales": L.name(c.sales_id), "sales_id": c.sales_id,
        "copies": [{"exam": name(k), "declared": int(c.copies_declared.get(k, 0)), "expected": int(c.copies_expected.get(k, 0))}
                   for k in sorted(set(c.copies_declared) | set(c.copies_expected))],
        "cash_declared": c.cash_declared, "cash_expected": c.cash_expected, "cash_gap": c.cash_gap,
        "copy_gaps": sum(abs(v) for v in c.copy_gaps.values()), "note": c.note, "created_at": c.created_at,
        "confirmed_at": c.confirmed_at, "confirmed_by": L.name(c.confirmed_by_id) if c.confirmed_by_id else "",
        "store_result": c.store_result, "store_note": c.store_note,
    }


@api_view(["GET", "POST"])
@permission_classes([roles(SALES, read=(OWNER, STORE))])
def day_close(request):
    L = Ledger()
    today = timezone.localdate()
    if request.method == "GET":
        qs = DayClose.objects.order_by("-date", "-created_at")
        if role_of(request) == SALES:
            qs = qs.filter(sales=request.user)
        rows = [close_row(c, L) for c in qs[:40]]
        mine = None
        if role_of(request) == SALES:
            st = L.sales_stats(request.user.id)
            mine = {"holding": [{"exam": k, "name": L.exams[k].name, "qty": v} for k, v in st["per_exam"].items() if v > 0 and k in L.exams],
                    "today": next((r for r in rows if r["date"] == today), None)}
        return Response({"closes": rows, "mine": mine})

    st = L.sales_stats(request.user.id)
    expected = {str(k): v for k, v in st["per_exam"].items() if v != 0}
    declared = {}
    for k, v in (request.data.get("copies") or {}).items():
        try:
            declared[str(int(k))] = max(0, int(v))
        except (TypeError, ValueError):
            return Response({"copies": "Enter a number of copies for each exam."}, status=400)
    try:
        cash = max(0, int(request.data.get("cash", 0)))
    except (TypeError, ValueError):
        return Response({"cash": "Enter the cash you have as a number."}, status=400)
    existing = DayClose.objects.filter(sales=request.user, date=today).first()
    if existing and existing.confirmed_at:
        return Response({"detail": "Today's close is already confirmed by the store keeper."}, status=400)
    with transaction.atomic():
        c = existing or DayClose(sales=request.user, date=today, created_by=request.user)
        c.copies_declared, c.copies_expected = declared, expected
        c.cash_declared, c.cash_expected = cash, st["cash_held"]
        c.note = str(request.data.get("note", ""))[:300]
        c.save()
    gaps = c.copy_gaps
    tell(people(STORE), f"{request.user.display_name} closed the day", "Check their copies and cash, then confirm.", "/store", Notification.Level.ACTION)
    if gaps or c.cash_gap:
        parts = [f"{abs(v):,} copies {'more' if v > 0 else 'missing'} ({L.exams[int(k)].name if int(k) in L.exams else 'exam'})" for k, v in gaps.items()]
        if c.cash_gap:
            parts.append(f"cash {ugx(abs(c.cash_gap))} {'more' if c.cash_gap > 0 else 'short'}")
        tell(people(OWNER), f"{request.user.display_name}'s day close doesn't match", "; ".join(parts) + ".", "/store", Notification.Level.URGENT)
    return Response(close_row(c, Ledger()))


@api_view(["POST"])
@permission_classes([roles(OWNER, STORE)])
def confirm_close(request, close_id):
    c = DayClose.objects.filter(pk=close_id).first()
    if not c:
        return Response(status=404)
    result = request.data.get("result")
    if result not in ("match", "mismatch"):
        return Response({"detail": "Choose whether it matches."}, status=400)
    c.confirmed_by, c.confirmed_at, c.store_result = request.user, timezone.now(), result
    c.store_note = str(request.data.get("note", ""))[:300]
    c.save(update_fields=["confirmed_by", "confirmed_at", "store_result", "store_note"])
    if result == "mismatch":
        tell(people(OWNER), f"{request.user.display_name} says {c.sales.display_name}'s day close does not match",
             c.store_note, "/store", Notification.Level.URGENT)
    tell([c.sales], f"Your day close was {'confirmed' if result == 'match' else 'marked as not matching'} by {request.user.display_name}",
         c.store_note, "/field", Notification.Level.INFO if result == "match" else Notification.Level.ACTION)
    return Response(close_row(c, Ledger()))


# ---------- closing an exam ----------
@api_view(["POST"])
@permission_classes([roles(OWNER)])
def close_exam(request, exam_id):
    exam = Exam.objects.filter(pk=exam_id).first()
    if not exam:
        return Response(status=404)
    reopen = request.data.get("reopen") is True
    exam.closed_at, exam.closed_by = (None, None) if reopen else (timezone.now(), request.user)
    exam.save(update_fields=["closed_at", "closed_by"])
    st = Ledger().exam_stats(exam)
    return Response({"closed": not reopen, "in_store": st["in_store"], "with_sales": st["with_sales"]})


# ---------- phone alerts when the app is closed (Web Push) ----------
def vapid_keys():
    """(public, private) for Web Push: from the environment if set, otherwise made once and kept in the database."""
    if settings.VAPID_PUBLIC_KEY and settings.VAPID_PRIVATE_KEY:
        return settings.VAPID_PUBLIC_KEY, settings.VAPID_PRIVATE_KEY
    from .models import PushKeys
    keys = PushKeys.objects.first()
    if not keys:
        from printery.management.commands.generate_vapid_keys import new_keys
        public, private = new_keys()
        keys = PushKeys.objects.create(public_key=public, private_key=private)
    return keys.public_key, keys.private_key


def push_enabled():
    return True


@api_view(["GET"])
def push_key(request):
    return Response({"key": vapid_keys()[0]})


@api_view(["POST"])
def push_subscribe(request):
    if not push_enabled():
        return Response({"detail": "Phone alerts are not set up on the server yet."}, status=400)
    sub = request.data.get("subscription") or {}
    keys = sub.get("keys") or {}
    if not sub.get("endpoint") or not keys.get("p256dh") or not keys.get("auth"):
        return Response({"detail": "This phone did not give a valid subscription."}, status=400)
    PushSubscription.objects.update_or_create(endpoint=sub["endpoint"], defaults={"user": request.user, "p256dh": keys["p256dh"], "auth": keys["auth"]})
    return Response({"ok": True})


@api_view(["POST"])
def push_unsubscribe(request):
    PushSubscription.objects.filter(user=request.user, endpoint=request.data.get("endpoint", "")).delete()
    return Response({"ok": True})


# ---------- QR codes on copies ----------
def copy_sig(exam_id, serial):
    msg = f"copy:{exam_id}:{serial}".encode()
    return hmac.new(settings.SECRET_KEY.encode(), msg, hashlib.sha256).hexdigest()[:10]


@api_view(["GET"])
@permission_classes([roles(OWNER, "printer")])
def qr_codes(request, exam_id):
    exam = Exam.objects.filter(pk=exam_id).first()
    if not exam:
        return Response(status=404)
    receipt = StoreReceipt.objects.filter(exam=exam).order_by("-created_at").first()
    try:
        lo = int(request.query_params.get("from") or (receipt.serial_from if receipt and receipt.serial_from else 1))
        hi = int(request.query_params.get("to") or (receipt.serial_to if receipt and receipt.serial_to else exam.ordered_qty))
    except ValueError:
        return Response({"detail": "Serial numbers must be whole numbers."}, status=400)
    if hi < lo or hi - lo >= 1000:
        return Response({"detail": "Choose a range of up to 1,000 copies."}, status=400)
    return Response({"exam": exam.name, "codes": [{"serial": n, "sig": copy_sig(exam.id, n)} for n in range(lo, hi + 1)]})


class VerifyThrottle(ScopedRateThrottle):
    scope = "verify"


@api_view(["GET"])
@permission_classes([AllowAny])
@throttle_classes([VerifyThrottle])
def verify_copy(request, exam_id, serial, sig):
    """Public: anyone who scans a copy's QR code sees whether it is genuine and who it was sold to."""
    exam = Exam.all_objects.filter(pk=exam_id).first()
    ip = request.META.get("REMOTE_ADDR")
    if not exam or not hmac.compare_digest(sig, copy_sig(exam_id, serial)):
        tell(people(OWNER), "A fake QR code was scanned", f"Someone scanned a code that this system never made (exam {exam_id}, copy {serial}).",
             "/owner/fraud", Notification.Level.URGENT, key=f"scan:fake:{exam_id}:{serial}")
        return Response({"result": "fake", "message": "This is NOT a genuine copy. The code was not made by the printery."})
    L = Ledger()
    r = L.receipt_for(exam.id)
    sold = next((v for v in L.visits if v.exam_id == exam.id and serial in (parse_serials(v.serials) or [])), None)
    if r and r.serial_from is not None and not r.serial_from <= serial <= r.serial_to:
        result, message = "extra", "This copy was printed beyond the official count. Please report it to the printery."
        tell(people(OWNER), f"Extra copy scanned: {exam.name} #{serial}", f"Outside the counted range {r.serial_from}–{r.serial_to}. Copies were printed beyond the count.",
             "/owner/fraud", Notification.Level.URGENT, key=f"scan:extra:{exam.id}:{serial}")
    elif sold:
        result, message = "sold", f"Genuine copy #{serial} of {exam.name}, supplied to {sold.school.name} on {sold.date:%d %b %Y}."
    else:
        result, message = "unsold", f"Genuine copy #{serial} of {exam.name}, but it is not recorded as sold to any school. Please tell the printery where you got it."
        tell(people(OWNER), f"Unsold copy scanned: {exam.name} #{serial}", "A school or someone else has a copy that no sale records. It may have been sold without being recorded.",
             "/owner/fraud", Notification.Level.URGENT, key=f"scan:unsold:{exam.id}:{serial}")
    CopyScan.objects.create(exam=exam, serial=serial, result=result, ip=ip)
    return Response({"result": result, "message": message, "business": settings.BUSINESS_NAME})


# ---------- GPS distance ----------
def km_between(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(float(lat1)), math.radians(float(lat2))
    dp, dl = p2 - p1, math.radians(float(lon2) - float(lon1))
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(a))
