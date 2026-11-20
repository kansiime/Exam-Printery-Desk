"""Data model for the printery.

Stock moves through: Exam (print order) -> PrintRun (printer) -> StoreReceipt
(store keeper folds and counts) -> Issue (store gives a sales person copies)
-> Visit (sale to a school) / Return (unsold copies back to the store).

Money moves through: Visit.paid / Payment -> CashHandover (sales person to
store keeper) -> OwnerHandover (store keeper to owner, confirmed by owner).
Mobile money goes straight to the business number and is matched against
MomoLine rows from the owner's statement.

Nothing is deleted. Business records are cancelled with a reason
(Cancellable) and every change is kept by django-simple-history.
"""
import uuid

from django.conf import settings
from django.db import models
from simple_history.models import HistoricalRecords

USER = settings.AUTH_USER_MODEL


class ActiveManager(models.Manager):
    def get_queryset(self):
        return super().get_queryset().filter(cancelled_at__isnull=True)


class Base(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(USER, on_delete=models.PROTECT, null=True, blank=True, related_name="+")

    class Meta:
        abstract = True
        ordering = ["-created_at"]


class Cancellable(Base):
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancelled_by = models.ForeignKey(USER, on_delete=models.PROTECT, null=True, blank=True, related_name="+")
    cancel_reason = models.CharField(max_length=300, blank=True)

    objects = ActiveManager()
    all_objects = models.Manager()

    class Meta(Base.Meta):
        abstract = True
        base_manager_name = "all_objects"


class Exam(Cancellable):
    """A print order posted by the owner."""

    name = models.CharField(max_length=200)
    ordered_qty = models.PositiveIntegerField()
    price = models.PositiveIntegerField(help_text="Selling price per copy in UGX")
    pages = models.PositiveIntegerField(help_text="Printed pages per copy")
    sides = models.PositiveSmallIntegerField(default=1, choices=[(1, "One side"), (2, "Both sides")])
    numbered = models.BooleanField(default=True, help_text="Copies carry serial numbers")
    note = models.CharField(max_length=300, blank=True)
    exam_date = models.DateField(null=True, blank=True)
    history = HistoricalRecords()

    def __str__(self):
        return self.name


class PrintRun(Cancellable):
    """One printing of an exam, with copier meter readings and photos."""

    exam = models.ForeignKey(Exam, on_delete=models.PROTECT, related_name="print_runs")
    machine = models.CharField(max_length=60, default="Main copier")
    meter_before = models.PositiveIntegerField()
    photo_before = models.ImageField(upload_to="meter/%Y/%m/", null=True, blank=True)
    started_at = models.DateTimeField(auto_now_add=True)
    qty = models.PositiveIntegerField(null=True, blank=True)
    spoilt = models.PositiveIntegerField(default=0, help_text="Spoilt sheets")
    meter_after = models.PositiveIntegerField(null=True, blank=True)
    photo_after = models.ImageField(upload_to="meter/%Y/%m/", null=True, blank=True)
    done_at = models.DateTimeField(null=True, blank=True)
    history = HistoricalRecords()

    @property
    def meter_pages(self):
        if self.meter_after is None:
            return None
        return self.meter_after - self.meter_before


class OtherPrint(Cancellable):
    """Non-exam work on a copier, so every meter page is accounted for."""

    description = models.CharField(max_length=200)
    machine = models.CharField(max_length=60, default="Main copier")
    meter_before = models.PositiveIntegerField()
    meter_after = models.PositiveIntegerField()
    photo_before = models.ImageField(upload_to="meter/%Y/%m/", null=True, blank=True)
    photo_after = models.ImageField(upload_to="meter/%Y/%m/", null=True, blank=True)
    history = HistoricalRecords()


class StoreReceipt(Cancellable):
    """The store keeper's own fold-and-count of a printed exam."""

    exam = models.ForeignKey(Exam, on_delete=models.PROTECT, related_name="receipts")
    qty = models.PositiveIntegerField()
    serial_from = models.PositiveIntegerField(null=True, blank=True)
    serial_to = models.PositiveIntegerField(null=True, blank=True)
    history = HistoricalRecords()


class School(Base):
    name = models.CharField(max_length=200)
    district = models.CharField(max_length=100, blank=True)
    contact = models.CharField(max_length=120, blank=True)
    phone = models.CharField(max_length=20, blank=True)
    candidates = models.PositiveIntegerField(default=0)
    merged_into = models.ForeignKey("self", on_delete=models.PROTECT, null=True, blank=True, related_name="+")
    history = HistoricalRecords()

    class Meta(Base.Meta):
        ordering = ["name"]

    def __str__(self):
        return self.name


class Issue(Cancellable):
    """Copies the store keeper hands to a sales person."""

    exam = models.ForeignKey(Exam, on_delete=models.PROTECT, related_name="issues")
    sales = models.ForeignKey(USER, on_delete=models.PROTECT, related_name="issues")
    qty = models.PositiveIntegerField()
    serials = models.CharField(max_length=500, blank=True)
    accepted_at = models.DateTimeField(null=True, blank=True)
    history = HistoricalRecords()


class Return(Cancellable):
    """Unsold copies a sales person brings back to the store."""

    exam = models.ForeignKey(Exam, on_delete=models.PROTECT, related_name="returns")
    sales = models.ForeignKey(USER, on_delete=models.PROTECT, related_name="returns")
    qty = models.PositiveIntegerField()
    serials = models.CharField(max_length=500, blank=True)
    history = HistoricalRecords()


class Method(models.TextChoices):
    CASH = "cash", "Cash"
    MOMO = "momo", "Mobile money"
    UNPAID = "unpaid", "Not paid yet"


class Visit(Cancellable):
    """A sale to a school, recorded by the sales person."""

    class PriceStatus(models.TextChoices):
        OK = "ok", "At set price"
        PENDING = "pending", "Waiting for owner"
        APPROVED = "approved", "Discount approved"
        REJECTED = "rejected", "Discount rejected"

    client_id = models.UUIDField(default=uuid.uuid4, unique=True, help_text="Made on the phone so offline retries never duplicate")
    exam = models.ForeignKey(Exam, on_delete=models.PROTECT, related_name="visits")
    sales = models.ForeignKey(USER, on_delete=models.PROTECT, related_name="visits")
    school = models.ForeignKey(School, on_delete=models.PROTECT, related_name="visits")
    date = models.DateField()
    copies = models.PositiveIntegerField()
    price = models.PositiveIntegerField()
    price_reason = models.CharField(max_length=300, blank=True)
    price_status = models.CharField(max_length=10, choices=PriceStatus.choices, default=PriceStatus.OK)
    price_decided_by = models.ForeignKey(USER, on_delete=models.PROTECT, null=True, blank=True, related_name="+")
    paid = models.PositiveIntegerField(default=0)
    method = models.CharField(max_length=10, choices=Method.choices, default=Method.CASH)
    momo_id = models.CharField(max_length=60, blank=True)
    note_no = models.CharField(max_length=40, help_text="Delivery note number")
    note_photo = models.ImageField(upload_to="notes/%Y/%m/", null=True, blank=True)
    serials = models.CharField(max_length=500, blank=True)
    due = models.DateField(null=True, blank=True, help_text="Date the school promised to pay")
    notes = models.TextField(blank=True)
    latitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    longitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    confirmation = models.CharField(max_length=20, blank=True, help_text="School's SMS reply: confirmed / disputed")
    history = HistoricalRecords()

    @property
    def value(self):
        price = self.exam.price if self.price_status == self.PriceStatus.REJECTED else self.price
        return self.copies * price


class Payment(Cancellable):
    """Money a school pays later against a debt."""

    visit = models.ForeignKey(Visit, on_delete=models.PROTECT, related_name="payments")
    amount = models.PositiveIntegerField()
    method = models.CharField(max_length=10, choices=Method.choices[:2], default=Method.CASH)
    momo_id = models.CharField(max_length=60, blank=True)
    sales = models.ForeignKey(USER, on_delete=models.PROTECT, null=True, blank=True, related_name="payments_collected",
                              help_text="Set when a sales person collected the cash")
    history = HistoricalRecords()


class CashHandover(Cancellable):
    """Cash a sales person hands to the store keeper."""

    sales = models.ForeignKey(USER, on_delete=models.PROTECT, related_name="cash_handovers")
    amount = models.PositiveIntegerField()
    history = HistoricalRecords()


class OwnerHandover(Cancellable):
    """Cash the store keeper hands to the owner; the owner confirms it."""

    amount = models.PositiveIntegerField()
    method = models.CharField(max_length=30, default="Cash in hand")
    ref = models.CharField(max_length=80, blank=True)
    confirmed_at = models.DateTimeField(null=True, blank=True)
    confirmed_by = models.ForeignKey(USER, on_delete=models.PROTECT, null=True, blank=True, related_name="+")
    history = HistoricalRecords()


class PaperIssue(Cancellable):
    """Reams of paper the owner gives the printer."""

    reams = models.PositiveIntegerField()
    sheets_per_ream = models.PositiveIntegerField(default=500)
    history = HistoricalRecords()

    @property
    def sheets(self):
        return self.reams * self.sheets_per_ream


class StockCount(Cancellable):
    """An unannounced count by the owner. Expected figures are frozen at save time."""

    paper_counted = models.PositiveIntegerField(null=True, blank=True)
    paper_expected = models.IntegerField(null=True, blank=True)
    history = HistoricalRecords()


class StockCountItem(models.Model):
    count = models.ForeignKey(StockCount, on_delete=models.CASCADE, related_name="items")
    exam = models.ForeignKey(Exam, on_delete=models.PROTECT, related_name="+")
    counted = models.PositiveIntegerField()
    expected = models.IntegerField()


class SchoolCheck(Cancellable):
    class Kind(models.TextChoices):
        CALL = "call", "Owner phoned the school"
        SMS = "sms", "School replied to SMS"
        LEAK = "leak", "School has our exams but is not in the records"

    class Result(models.TextChoices):
        MATCH = "match", "Matches records"
        MISMATCH = "mismatch", "Does not match"
        NOREACH = "noreach", "Could not reach"

    kind = models.CharField(max_length=10, choices=Kind.choices, default=Kind.CALL)
    school = models.ForeignKey(School, on_delete=models.PROTECT, null=True, blank=True, related_name="checks")
    school_name = models.CharField(max_length=200, blank=True)
    visit = models.ForeignKey(Visit, on_delete=models.PROTECT, null=True, blank=True, related_name="checks")
    result = models.CharField(max_length=10, choices=Result.choices, blank=True)
    note = models.CharField(max_length=300, blank=True)
    history = HistoricalRecords()


class MomoLine(Base):
    """One payment from the owner's mobile money statement (pasted or webhook)."""

    tx_id = models.CharField(max_length=60, unique=True)
    amount = models.PositiveIntegerField()
    payer = models.CharField(max_length=60, blank=True)
    received_at = models.DateTimeField(null=True, blank=True)
    source = models.CharField(max_length=20, default="statement")


class CorrectionRequest(Base):
    """A worker reports a mistake; only the owner can cancel the record."""

    target_type = models.CharField(max_length=40)
    target_id = models.PositiveBigIntegerField()
    reason = models.CharField(max_length=300)
    resolved_at = models.DateTimeField(null=True, blank=True)
    resolution = models.CharField(max_length=20, blank=True)
    history = HistoricalRecords()


# Records the owner may cancel through the API, by short name.
CANCELLABLE = {
    "exam": Exam,
    "print": PrintRun,
    "other": OtherPrint,
    "receipt": StoreReceipt,
    "issue": Issue,
    "return": Return,
    "visit": Visit,
    "payment": Payment,
    "cash": CashHandover,
    "handover": OwnerHandover,
    "paper": PaperIssue,
    "count": StockCount,
    "check": SchoolCheck,
}
