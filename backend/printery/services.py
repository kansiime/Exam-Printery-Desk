"""Business arithmetic and fraud checks.

Ledger loads every active record once and answers questions about stock,
cash and debts. At the size of a printery (thousands of rows a term) this is
fast and keeps every rule in plain, testable Python.
"""
from collections import defaultdict
from datetime import timedelta

from django.utils import timezone

from accounts.models import User

from .models import (
    CashHandover, CorrectionRequest, Exam, Issue, Method, MomoLine, OtherPrint, OwnerHandover,
    PaperIssue, Payment, PrintRun, Return, School, SchoolCheck, StockCount, StoreReceipt, Visit,
)


def parse_serials(text):
    """'001-040, 45, 50 to 52' -> sorted list of ints. Empty -> []. Unreadable -> None."""
    if not text or not str(text).strip():
        return []
    import re
    cleaned = re.sub(r"\s*(?:-|–|—|to)\s*", "-", str(text), flags=re.I)
    out = []
    for part in [p for p in re.split(r"[,;\s]+", cleaned) if p]:
        m = re.fullmatch(r"(\d+)(?:-(\d+))?", part)
        if not m:
            return None
        a = int(m.group(1))
        b = int(m.group(2)) if m.group(2) else a
        if b < a or b - a > 20000:
            return None
        out.extend(range(a, b + 1))
    return out


def list_nums(nums, limit=12):
    nums = sorted(nums)
    text = ", ".join(str(n) for n in nums[:limit])
    return text + (f" and {len(nums) - limit} more" if len(nums) > limit else "")


def ugx(amount):
    return f"UGX {round(amount):,}"


class Ledger:
    def __init__(self):
        self.exams = {e.id: e for e in Exam.objects.all()}
        self.prints = list(PrintRun.objects.all())
        self.receipts = list(StoreReceipt.objects.all())
        self.issues = list(Issue.objects.all())
        self.returns = list(Return.objects.all())
        self.visits = list(Visit.objects.select_related("exam", "school"))
        self.payments = list(Payment.objects.all())
        self.cash = list(CashHandover.objects.all())
        self.handovers = list(OwnerHandover.objects.all())
        self.paper = list(PaperIssue.objects.all())
        self.others = list(OtherPrint.objects.all())
        self.users = {u.id: u for u in User.objects.all()}
        self._payments_by_visit = defaultdict(list)
        for p in self.payments:
            self._payments_by_visit[p.visit_id].append(p)

    # ---- lookups ----
    def name(self, user_id):
        user = self.users.get(user_id)
        return user.display_name if user else "Someone"

    def print_for(self, exam_id, finished_only=True):
        runs = [p for p in self.prints if p.exam_id == exam_id and (p.done_at or not finished_only)]
        return max(runs, key=lambda p: p.started_at) if runs else None

    def receipt_for(self, exam_id):
        rs = [r for r in self.receipts if r.exam_id == exam_id]
        return max(rs, key=lambda r: r.created_at) if rs else None

    def sales_people(self):
        return sorted((u for u in self.users.values() if u.role == User.Role.SALES and u.is_active), key=lambda u: u.display_name.lower())

    # ---- money per visit ----
    def visit_value(self, v):
        price = v.exam.price if v.price_status == Visit.PriceStatus.REJECTED else v.price
        return v.copies * price

    def visit_debt(self, v):
        return self.visit_value(v) - v.paid - sum(p.amount for p in self._payments_by_visit[v.id])

    # ---- stock ----
    def exam_stats(self, exam):
        p, r = self.print_for(exam.id), self.receipt_for(exam.id)
        issued = sum(x.qty for x in self.issues if x.exam_id == exam.id)
        returned = sum(x.qty for x in self.returns if x.exam_id == exam.id)
        vs = [v for v in self.visits if v.exam_id == exam.id]
        sold = sum(v.copies for v in vs)
        value = sum(self.visit_value(v) for v in vs)
        collected = sum(v.paid for v in vs) + sum(p2.amount for v in vs for p2 in self._payments_by_visit[v.id])
        in_store = (r.qty - issued + returned) if r else 0
        with_sales = issued - returned - sold
        if not p:
            status = "To print" if not self.print_for(exam.id, finished_only=False) else "Printing"
        elif not r:
            status = "At store"
        elif in_store <= 0 and with_sales <= 0 and sold > 0:
            status = "Sold out"
        else:
            status = "Selling"
        return {
            "printed": p.qty if p else None, "counted": r.qty if r else None,
            "issued": issued, "returned": returned, "sold": sold, "in_store": in_store,
            "with_sales": with_sales, "value": value, "collected": collected,
            "debt": value - collected, "status": status,
        }

    def sales_stats(self, user_id):
        iss = [x for x in self.issues if x.sales_id == user_id]
        ret = [x for x in self.returns if x.sales_id == user_id]
        vs = [v for v in self.visits if v.sales_id == user_id]
        per_exam = defaultdict(int)
        for x in iss:
            per_exam[x.exam_id] += x.qty
        for x in ret:
            per_exam[x.exam_id] -= x.qty
        for v in vs:
            per_exam[v.exam_id] -= v.copies
        cash_collected = sum(v.paid for v in vs if v.method == Method.CASH) + sum(
            p.amount for p in self.payments if p.sales_id == user_id and p.method == Method.CASH)
        momo = sum(v.paid for v in vs if v.method == Method.MOMO) + sum(
            p.amount for p in self.payments if p.sales_id == user_id and p.method == Method.MOMO)
        handed = sum(c.amount for c in self.cash if c.sales_id == user_id)
        return {
            "issued": sum(x.qty for x in iss), "returned": sum(x.qty for x in ret), "sold": sum(v.copies for v in vs),
            "holding": sum(per_exam.values()), "per_exam": dict(per_exam),
            "cash_collected": cash_collected, "momo": momo, "handed": handed,
            "cash_held": cash_collected - handed, "debt": sum(self.visit_debt(v) for v in vs),
            "pending_issues": [x.id for x in iss if not x.accepted_at],
        }

    def store_cash(self):
        received = sum(c.amount for c in self.cash)
        handed = sum(h.amount for h in self.handovers)
        return {"received": received, "handed": handed, "held": received - handed,
                "unconfirmed": sum(h.amount for h in self.handovers if not h.confirmed_at),
                "confirmed": sum(h.amount for h in self.handovers if h.confirmed_at)}

    def paper_stats(self):
        issued = sum(p.sheets for p in self.paper)
        used = 0.0
        for p in self.prints:
            if p.done_at and p.meter_after is not None:
                used += (p.meter_after - p.meter_before) / (self.exams[p.exam_id].sides or 1) if p.exam_id in self.exams else 0
        used += sum(o.meter_after - o.meter_before for o in self.others)
        return {"issued": issued, "used": round(used), "left": round(issued - used)}

    def momo_records(self):
        recs = []
        for v in self.visits:
            if v.method == Method.MOMO and v.paid > 0:
                recs.append({"id": v.momo_id.strip().upper(), "amount": v.paid, "label": f"{v.school.name} (sale by {self.name(v.sales_id)})"})
        for p in self.payments:
            if p.method == Method.MOMO:
                v = next((x for x in self.visits if x.id == p.visit_id), None)
                recs.append({"id": p.momo_id.strip().upper(), "amount": p.amount,
                             "label": f"{v.school.name if v else 'debt'} (debt payment)"})
        return recs

    # ---- summaries ----
    def overview(self):
        exams = sorted(self.exams.values(), key=lambda e: e.created_at, reverse=True)
        rows = [{"id": e.id, "name": e.name, "ordered_qty": e.ordered_qty, "price": e.price, "pages": e.pages,
                 "created_at": e.created_at, **self.exam_stats(e)} for e in exams]
        sales = [{"id": u.id, "name": u.display_name, **{k: v for k, v in self.sales_stats(u.id).items() if k != "per_exam"}}
                 for u in self.sales_people()]
        cash_total = sum(v.paid for v in self.visits if v.method == Method.CASH) + sum(
            p.amount for p in self.payments if p.sales_id and p.method == Method.CASH)
        sc = self.store_cash()
        return {
            "kpis": {
                "sold": sum(r["sold"] for r in rows), "collected": sum(r["collected"] for r in rows),
                "debt": sum(r["debt"] for r in rows), "cash_not_with_owner": cash_total - sc["confirmed"],
            },
            "exams": rows, "sales": sales, "store_cash": sc, "paper": self.paper_stats(),
        }


def audit(ledger=None):
    """Every fraud and mismatch check. Returns findings, most serious first."""
    L = ledger or Ledger()
    bad, warn = [], []
    today = timezone.localdate()

    # 1. Copier meter vs copies posted
    meter_rows = []
    for p in L.prints:
        if not p.done_at or p.exam_id not in L.exams:
            continue
        e = L.exams[p.exam_id]
        meter = p.meter_pages
        expected = e.pages * (p.qty or 0) + p.spoilt * e.sides
        extra = None if meter is None else meter - expected
        meter_rows.append({"exam": e.name, "exam_id": e.id, "machine": p.machine, "qty": p.qty, "pages": e.pages,
                           "meter_before": p.meter_before, "meter_after": p.meter_after, "meter_pages": meter,
                           "expected": expected, "extra": extra,
                           "photo_before": p.photo_before.url if p.photo_before else None,
                           "photo_after": p.photo_after.url if p.photo_after else None})
        if extra is not None and extra > max(e.pages, 1):
            bad.append(f"{e.name}: the copier counted {meter:,} pages, but {p.qty:,} copies × {e.pages} pages + spoilt "
                       f"sheets should be {expected:,}. {extra:,} extra pages, about {extra // max(e.pages, 1):,} extra copies.")
        elif extra is not None and extra < -max(e.pages, 1):
            warn.append(f"{e.name}: the copier counted fewer pages ({meter:,}) than the copies posted need ({expected:,}). Check the meter photos.")
        if not p.photo_before or not p.photo_after:
            warn.append(f"{e.name}: meter photo missing ({'before' if not p.photo_before else 'after'}).")
        if e.ordered_qty and (p.qty or 0) < e.ordered_qty:
            warn.append(f"{e.name}: ordered {e.ordered_qty:,}, printer posted {p.qty:,}.")

    # 2. Meter continuity: every page must belong to a recorded job
    events = [(p.machine, p.meter_before, p.meter_after, L.exams[p.exam_id].name if p.exam_id in L.exams else "exam")
              for p in L.prints] + [(o.machine, o.meter_before, o.meter_after, f"Other: {o.description}") for o in L.others]
    gaps = []
    by_machine = defaultdict(list)
    for ev in events:
        by_machine[ev[0]].append(ev)
    for machine, evs in by_machine.items():
        evs.sort(key=lambda x: x[1])
        for prev, cur in zip(evs, evs[1:]):
            if prev[2] is None:
                continue
            if cur[1] > prev[2]:
                gaps.append({"machine": machine, "pages": cur[1] - prev[2], "after": prev[3], "before": cur[3]})
                bad.append(f"{machine}: {cur[1] - prev[2]:,} pages printed between “{prev[3]}” and “{cur[3]}” with no record "
                           f"(meter {prev[2]:,} → {cur[1]:,}).")
            elif cur[1] < prev[2]:
                bad.append(f"{machine}: meter readings overlap between “{prev[3]}” and “{cur[3]}”. One reading is wrong.")

    # 3. Printer count vs store count, store balance
    for e in L.exams.values():
        p, r, s = L.print_for(e.id), L.receipt_for(e.id), L.exam_stats(e)
        if p and r and p.qty != r.qty:
            bad.append(f"{e.name}: printer posted {p.qty:,}, store counted {r.qty:,}. Difference {abs(p.qty - r.qty):,}.")
        if s["in_store"] < 0:
            bad.append(f"{e.name}: the store issued {-s['in_store']:,} more copies than it counted.")

    # 4. Sales people
    for u in L.sales_people():
        st = L.sales_stats(u.id)
        for exam_id, q in st["per_exam"].items():
            if q < 0:
                bad.append(f"{u.display_name} recorded {-q:,} more copies sold or returned than issued for {L.exams[exam_id].name if exam_id in L.exams else 'an exam'}.")
        if st["pending_issues"]:
            n = sum(x.qty for x in L.issues if x.id in st["pending_issues"])
            warn.append(f"{u.display_name} has not yet accepted {n:,} issued copies.")

    # 5. Debts past promised date, school SMS disputes
    for v in L.visits:
        d = L.visit_debt(v)
        if v.due and v.due < today and d > 0:
            bad.append(f"{v.school.name} promised to pay {ugx(d)} by {v.due:%d %b}. Sold by {L.name(v.sales_id)}.")
        if v.confirmation == "disputed":
            bad.append(f"{v.school.name} replied that the sale of {v.copies:,} copies (delivery note {v.note_no}) is NOT correct.")
        if v.price_status == Visit.PriceStatus.REJECTED and d > 0:
            warn.append(f"Discount rejected for {v.school.name}: {L.name(v.sales_id)} must collect {ugx(d)}.")

    # 6. Serial numbers
    for e in [x for x in L.exams.values() if x.numbered]:
        r = L.receipt_for(e.id)
        lo = hi = None
        if r and r.serial_from is not None and r.serial_to is not None:
            lo, hi = r.serial_from, r.serial_to
            if hi - lo + 1 != r.qty:
                bad.append(f"{e.name}: store counted {r.qty:,} copies but recorded serials {lo}–{hi} ({hi - lo + 1:,} numbers).")
        held, seen, dup, out, not_issued, no_serial = defaultdict(set), set(), set(), set(), set(), 0
        for x in [i for i in L.issues if i.exam_id == e.id]:
            for k in parse_serials(x.serials) or []:
                held[x.sales_id].add(k)
                if lo is not None and not lo <= k <= hi:
                    out.add(k)
        for x in [i for i in L.returns if i.exam_id == e.id]:
            for k in parse_serials(x.serials) or []:
                held[x.sales_id].discard(k)
        for v in [x for x in L.visits if x.exam_id == e.id]:
            ns = parse_serials(v.serials)
            if ns is None:
                warn.append(f"{v.school.name}: serial numbers “{v.serials}” can't be read.")
                continue
            if not ns:
                no_serial += 1
                continue
            if len(ns) != v.copies:
                bad.append(f"{v.school.name} ({e.name}): {v.copies:,} copies sold but {len(ns):,} serial numbers recorded.")
            for k in ns:
                if k in seen:
                    dup.add(k)
                seen.add(k)
                if lo is not None and not lo <= k <= hi:
                    out.add(k)
                if held[v.sales_id] and k not in held[v.sales_id]:
                    not_issued.add(k)
        if dup:
            bad.append(f"{e.name}: serial numbers sold to more than one school: {list_nums(dup)}.")
        if out:
            bad.append(f"{e.name}: serials {list_nums(out)} are outside the counted range {lo}–{hi}. These copies were printed beyond the count.")
        if not_issued:
            bad.append(f"{e.name}: serials {list_nums(not_issued)} were sold by someone who was never issued them.")
        if no_serial:
            warn.append(f"{e.name}: {no_serial} school visit(s) have no serial numbers recorded.")

    # 7. Latest surprise count
    last = StockCount.objects.order_by("-created_at").prefetch_related("items__exam").first()
    if last:
        for item in last.items.all():
            d = item.counted - item.expected
            if d:
                (bad if d < 0 else warn).append(
                    f"Surprise count {timezone.localtime(last.created_at):%d %b}: {item.exam.name} had {item.counted:,} in store, records said {item.expected:,} ({d:+,}).")
        if last.paper_counted is not None and (last.paper_expected or 0) - last.paper_counted > 20:
            bad.append(f"Surprise count: {(last.paper_expected or 0) - last.paper_counted:,} sheets of paper missing "
                       f"(counted {last.paper_counted:,}, expected {last.paper_expected:,}).")

    # 8. School checks in the last 90 days
    since = timezone.now() - timedelta(days=90)
    for c in SchoolCheck.objects.filter(created_at__gte=since).select_related("school"):
        name = c.school.name if c.school else c.school_name
        if c.kind == SchoolCheck.Kind.LEAK:
            bad.append(f"{name} has our exams but is not in the sales records. {c.note}".strip())
        elif c.result == SchoolCheck.Result.MISMATCH:
            bad.append(f"School check {timezone.localtime(c.created_at):%d %b}: {name} does not match the records. {c.note}".strip())

    # 9. Delivery notes
    notes = defaultdict(list)
    for v in L.visits:
        key = v.note_no.strip()
        if key:
            notes[key].append(v)
            if not v.note_photo:
                warn.append(f"{v.school.name}: delivery note {key} has no photo.")
    for key, vs in notes.items():
        if len(vs) > 1:
            bad.append(f"Delivery note {key} is used for {len(vs)} sales ({', '.join(v.school.name for v in vs)}).")

    # 10. Mobile money vs owner's statement
    recs = L.momo_records()
    counts = defaultdict(int)
    for r in recs:
        if r["id"]:
            counts[r["id"]] += 1
    for tx, c in counts.items():
        if c > 1:
            bad.append(f"Mobile money ID {tx} is used for {c} payments.")
    statement = {m.tx_id.upper(): m for m in MomoLine.objects.all()}
    if statement:
        for r in recs:
            m = statement.get(r["id"])
            if not m:
                bad.append(f"Mobile money {r['id'] or '(no ID)'} ({ugx(r['amount'])}, {r['label']}) is not on your statement.")
            elif m.amount != r["amount"]:
                bad.append(f"Mobile money {r['id']}: recorded {ugx(r['amount'])} but your statement shows {ugx(m.amount)} ({r['label']}).")

    # 11. Candidates vs copies bought
    for s in School.objects.filter(candidates__gt=0, merged_into__isnull=True):
        per = defaultdict(int)
        for v in L.visits:
            if v.school_id == s.id:
                per[v.exam_id] += v.copies
        for exam_id, c in per.items():
            if c < s.candidates * 0.6:
                warn.append(f"{s.name} has {s.candidates:,} candidates but bought only {c:,} copies of "
                            f"{L.exams[exam_id].name if exam_id in L.exams else 'an exam'}. It may be photocopying, or buying from someone else.")

    # 12. Things waiting for the owner
    pending = [v for v in L.visits if v.price_status == Visit.PriceStatus.PENDING]
    if pending:
        warn.append(f"{len(pending)} sale(s) below your set price are waiting for your approval.")
    unconfirmed = [h for h in L.handovers if not h.confirmed_at]
    if unconfirmed:
        warn.append(f"The store keeper says they handed you {ugx(sum(h.amount for h in unconfirmed))}. Confirm it on the Cash screen.")
    open_corrections = CorrectionRequest.objects.filter(resolved_at__isnull=True).count()
    if open_corrections:
        warn.append(f"{open_corrections} mistake report(s) are waiting for you.")

    findings = [{"level": "bad", "text": t} for t in bad] + [{"level": "warn", "text": t} for t in warn]
    return {"findings": findings, "meter": meter_rows, "gaps": gaps}


def weekly_schools(limit=5):
    """A different handful of schools to phone each week, skipping recent checks."""
    import hashlib
    week = timezone.localdate().strftime("%G-%V")
    recent = set(SchoolCheck.objects.filter(kind=SchoolCheck.Kind.CALL, created_at__gte=timezone.now() - timedelta(days=30))
                 .values_list("school_id", flat=True))
    sold_to = School.objects.filter(visits__cancelled_at__isnull=True, merged_into__isnull=True).distinct()
    candidates = [s for s in sold_to if s.id not in recent]
    candidates.sort(key=lambda s: hashlib.sha1(f"{week}-{s.id}".encode()).hexdigest())
    return candidates[:limit]
