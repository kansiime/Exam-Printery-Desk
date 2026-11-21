"""Automatic reminders for work that is stuck or forgotten.

Each reminder has a fixed key, so a person is reminded once per stage (or once
per day for daily ones) however often this runs. It runs every few minutes
while anyone has the app open (see maybe_run), and can also be run by a
scheduler with `python manage.py run_reminders`.
"""
import logging
from datetime import timedelta

from django.core.cache import cache
from django.utils import timezone

from accounts.models import User

from .models import CashHandover, DayClose, Notification, OwnerHandover
from .notify import OWNER, SALES, STORE, people, tell
from .services import Ledger, ugx

log = logging.getLogger(__name__)
H = timedelta(hours=1)
ACTION, URGENT = Notification.Level.ACTION, Notification.Level.URGENT

# How long before each reminder goes out.
PRINT_POST_REMIND, PRINT_POST_OWNER = 3 * H, 6 * H
COUNT_REMIND, COUNT_OWNER = 24 * H, 48 * H
ACCEPT_REMIND, ACCEPT_OWNER = 24 * H, 48 * H
CASH_HELD = 48 * H
DAY_CLOSE_HOUR, DAY_CLOSE_OWNER_HOUR = 19, 21  # Kampala time


def hours(td):
    return int(td.total_seconds() // 3600)


def run_reminders(now=None):
    now = now or timezone.now()
    local = timezone.localtime(now)
    today = local.date()
    L = Ledger()
    owners = people(OWNER)
    store = people(STORE)
    sent = 0

    def send(recipients, title, body, link, level, key):
        nonlocal sent
        tell(recipients, title, body, link, level, key=key)
        sent += 1

    # 1. Printing started but not posted
    for p in L.prints:
        if p.done_at or p.exam_id not in L.exams:
            continue
        exam, age = L.exams[p.exam_id], now - p.started_at
        if age > PRINT_POST_REMIND and p.created_by_id:
            send([L.users[p.created_by_id]], f"Post the count for {exam.name}",
                 f"You started printing {hours(age)} hours ago. Tap “Post printed and send to store” so the store can count it.",
                 "/print", ACTION, f"rem:print:{p.id}:1")
        if age > PRINT_POST_OWNER:
            send(owners, f"{exam.name}: printing not posted after {hours(age)} hours",
                 f"{L.name(p.created_by_id)} started at meter {p.meter_before:,} but has not posted the count.",
                 "/print", URGENT, f"rem:print:{p.id}:2")

    # 2. Printed but not counted by the store
    for exam in L.exams.values():
        p, r = L.print_for(exam.id), L.receipt_for(exam.id)
        if not p or r or exam.closed_at:
            continue
        age = now - p.done_at
        if age > COUNT_REMIND:
            send(store, f"Count {exam.name}", f"It was printed {hours(age)} hours ago and is waiting for you to fold and count.",
                 "/store", ACTION, f"rem:count:{p.id}:1")
        if age > COUNT_OWNER:
            send(owners, f"{exam.name}: printed but not counted after {hours(age)} hours", "The store has not confirmed its count.",
                 "/store", URGENT, f"rem:count:{p.id}:2")

    # 3. Issued copies not accepted
    for x in L.issues:
        if x.accepted_at:
            continue
        age, exam = now - x.created_at, L.exams.get(x.exam_id)
        name = exam.name if exam else "an exam"
        if age > ACCEPT_REMIND:
            send([L.users[x.sales_id]], f"Accept the {x.qty:,} copies of {name}",
                 "Count them and tap “I received” on your field screen. If the number is wrong, tell the store keeper.",
                 "/field", ACTION, f"rem:issue:{x.id}:1")
        if age > ACCEPT_OWNER:
            recipients = owners + ([L.users[x.created_by_id]] if x.created_by_id in L.users else [])
            send(recipients, f"{L.name(x.sales_id)} has not accepted {x.qty:,} copies of {name}",
                 f"Issued {hours(age)} hours ago.", "/store", URGENT, f"rem:issue:{x.id}:2")

    # 4. Cash held too long (sales people and store keepers), once a day
    for u in L.sales_people():
        st = L.sales_stats(u.id)
        if st["cash_held"] <= 0:
            continue
        last = CashHandover.objects.filter(sales=u).order_by("-created_at").values_list("created_at", flat=True).first()
        since = last or min([v.created_at for v in L.visits if v.sales_id == u.id and v.paid] or [now])
        if now - since > CASH_HELD:
            send([u] + owners, f"{u.display_name} is holding {ugx(st['cash_held'])} cash",
                 f"No cash handed to the store for {hours(now - since) // 24} days. Hand it in today.",
                 "/cash", URGENT, f"rem:cash:{u.id}:{today}")
    for k in [u for u in L.users.values() if u.role == User.Role.STORE and u.is_active]:
        held = L.store_cash(k.id)["held"]
        if held <= 0:
            continue
        last = OwnerHandover.objects.filter(created_by=k).order_by("-created_at").values_list("created_at", flat=True).first()
        since = last or min([c.created_at for c in L.cash if c.created_by_id == k.id] or [now])
        if now - since > CASH_HELD:
            send([k] + owners, f"{k.display_name} is holding {ugx(held)} store cash",
                 f"Nothing handed to the owner for {hours(now - since) // 24} days.", "/cash", URGENT, f"rem:storecash:{k.id}:{today}")

    # 5. Promised payment date passed (reminded again each week)
    week = today.strftime("%G-%V")
    for v in L.visits:
        debt = L.visit_debt(v)
        if v.due and v.due < today and debt > 0:
            send([L.users[v.sales_id]] + owners, f"{v.school.name} owes {ugx(debt)}: payment overdue",
                 f"They promised to pay by {v.due:%d %b}. {v.school.contact} {v.school.phone}".strip(), "/debts", ACTION,
                 f"rem:due:{v.id}:{week}")

    # 6. End-of-day close not done
    if local.hour >= DAY_CLOSE_HOUR:
        start = local.replace(hour=0, minute=0, second=0, microsecond=0)
        closed = set(DayClose.objects.filter(date=today).values_list("sales_id", flat=True))
        for u in L.sales_people():
            active = any(v.sales_id == u.id and v.created_at >= start for v in L.visits) or \
                any(x.sales_id == u.id and x.created_at >= start for x in L.issues) or L.sales_stats(u.id)["holding"] > 0
            if not active or u.id in closed:
                continue
            send([u], "Close your day", "Count the copies and cash you have and tap “Close my day” on your field screen.",
                 "/field", ACTION, f"rem:close:{u.id}:{today}")
            if local.hour >= DAY_CLOSE_OWNER_HOUR:
                send(owners, f"{u.display_name} has not closed the day", "Their copies and cash for today are not confirmed.",
                     "/owner", ACTION, f"rem:close-owner:{u.id}:{today}")

    # 7. Exams long past their date with copies still out
    for exam in L.exams.values():
        if exam.closed_at or not exam.exam_date or exam.exam_date > today - timedelta(days=7):
            continue
        st = L.exam_stats(exam)
        if st["with_sales"] > 0 or st["in_store"] > 0:
            send(owners, f"Close {exam.name}?", f"The exam was on {exam.exam_date:%d %b}. {st['in_store']:,} copies in store, "
                 f"{st['with_sales']:,} with sales people. Collect them, then close the exam to lock its records.",
                 "/owner", ACTION, f"rem:examclose:{exam.id}")
    return sent


def maybe_run(every_seconds=300):
    """Run at most every few minutes, triggered by people using the app (works without a scheduler)."""
    if cache.get("reminders-ran"):
        return
    cache.set("reminders-ran", True, every_seconds)
    try:
        run_reminders()
    except Exception:
        log.exception("reminders failed")
