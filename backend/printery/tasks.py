from celery import shared_task
from django.conf import settings
from django.utils import timezone

from .models import Method, PrintRun, StoreReceipt, Visit
from .services import Ledger, audit, ugx
from .sms import send_sms


@shared_task
def send_visit_confirmation(visit_id):
    """Ask the school to confirm the sale, so every school checks every delivery."""
    visit = Visit.objects.select_related("school", "exam").filter(pk=visit_id).first()
    if not visit or not visit.school.phone:
        return False
    balance = visit.copies * visit.price - visit.paid
    msg = (f"{settings.BUSINESS_NAME}: you received {visit.copies} copies of {visit.exam.name} "
           f"(delivery note {visit.note_no}), paid {ugx(visit.paid)}, balance {ugx(max(balance, 0))}. "
           f"Reply 1 if correct, 2 if not.")
    return send_sms(visit.school.phone, msg)


def build_daily_summary():
    L = Ledger()
    today = timezone.localdate()
    is_today = lambda dt: dt and timezone.localtime(dt).date() == today  # noqa: E731
    printed = sum(p.qty or 0 for p in PrintRun.objects.filter(done_at__isnull=False) if is_today(p.done_at))
    counted = sum(r.qty for r in StoreReceipt.objects.all() if is_today(r.created_at))
    todays = [v for v in L.visits if is_today(v.created_at)]
    sold = sum(v.copies for v in todays)
    cash = sum(v.paid for v in todays if v.method == Method.CASH)
    momo = sum(v.paid for v in todays if v.method == Method.MOMO)
    k = L.overview()["kpis"]
    findings = audit(L)["findings"]
    lines = [f"{settings.BUSINESS_NAME} {today:%d %b}",
             f"Today: printed {printed}, counted {counted}, sold {sold}, cash {ugx(cash)}, MoMo {ugx(momo)}.",
             f"Schools owe {ugx(k['debt'])}. Cash not with you {ugx(k['cash_not_with_owner'])}."]
    serious = [f for f in findings if f["level"] == "bad"]
    if serious:
        lines.append(f"{len(serious)} warning(s): " + serious[0]["text"][:200])
    return "\n".join(lines)


@shared_task
def send_daily_summary():
    if not settings.OWNER_PHONE:
        return False
    return send_sms(settings.OWNER_PHONE, build_daily_summary())
