from django.db import models as djm
from django.db import transaction
from rest_framework import serializers


class RelativeImageField(serializers.ImageField):
    """Photos as /media/... paths, so they load through whichever address the person signed in on."""

    def to_representation(self, value):
        return value.url if value else None


serializers.ModelSerializer.serializer_field_mapping[djm.ImageField] = RelativeImageField

from accounts.models import User

from .models import (
    CashHandover, CorrectionRequest, Exam, Expense, Feedback, Issue, Method, MomoLine, OtherPrint, OwnerHandover,
    PaperIssue, Payment, PrintRun, Return, School, SchoolCheck, StoreReceipt, Visit,
)
from .services import Ledger, parse_serials


def check_serials(exam, text, qty):
    nums = parse_serials(text)
    if nums is None:
        raise serializers.ValidationError({"serials": "Write serial numbers like 001-040 or 5, 7, 9-12."})
    if exam.numbered and not nums:
        raise serializers.ValidationError({"serials": "This exam is numbered. Enter the serial numbers."})
    if nums and len(nums) != qty:
        raise serializers.ValidationError({"serials": f"You entered {len(nums)} serial numbers for {qty} copies."})


def not_closed(exam):
    if exam.closed_at:
        raise serializers.ValidationError(f"{exam.name} is closed, so its records are locked. The owner can reopen it.")


def momo_id_used(tx):
    tx = tx.strip().upper()
    return Visit.objects.filter(momo_id__iexact=tx).exists() or Payment.objects.filter(momo_id__iexact=tx).exists()


class UserSerializer(serializers.ModelSerializer):
    name = serializers.CharField(source="display_name", read_only=True)
    password = serializers.CharField(write_only=True, required=False, min_length=8)

    class Meta:
        model = User
        fields = ["id", "username", "first_name", "last_name", "name", "role", "phone", "is_active", "password", "commission_percent"]

    def create(self, data):
        password = data.pop("password", None)
        if not password:
            raise serializers.ValidationError({"password": "Set a starting password (8+ characters)."})
        user = User(**data)
        user.set_password(password)
        user.save()
        return user

    def update(self, user, data):
        password = data.pop("password", None)
        for k, v in data.items():
            setattr(user, k, v)
        if password:
            user.set_password(password)
        user.save()
        return user


class ExamSerializer(serializers.ModelSerializer):
    class Meta:
        model = Exam
        fields = ["id", "name", "ordered_qty", "price", "pages", "sides", "numbered", "note", "exam_date", "created_at", "closed_at"]
        read_only_fields = ["closed_at"]


class PrintStartSerializer(serializers.ModelSerializer):
    class Meta:
        model = PrintRun
        fields = ["id", "exam", "machine", "meter_before", "photo_before", "started_at"]
        read_only_fields = ["started_at"]

    def validate(self, data):
        not_closed(data["exam"])
        if PrintRun.objects.filter(exam=data["exam"]).exists():
            raise serializers.ValidationError("This exam has already been started. Cancel the old run first.")
        if not data.get("photo_before"):
            raise serializers.ValidationError({"photo_before": "Take a photo of the meter before printing."})
        return data


class PrintFinishSerializer(serializers.ModelSerializer):
    class Meta:
        model = PrintRun
        fields = ["qty", "spoilt", "meter_after", "photo_after"]
        extra_kwargs = {"qty": {"required": True}, "meter_after": {"required": True}}

    def validate(self, data):
        if self.instance.done_at:
            raise serializers.ValidationError("This printing is already posted.")
        not_closed(self.instance.exam)
        if data["meter_after"] < self.instance.meter_before:
            raise serializers.ValidationError({"meter_after": f"The reading after can't be lower than before ({self.instance.meter_before:,})."})
        if not data.get("photo_after"):
            raise serializers.ValidationError({"photo_after": "Take a photo of the meter after printing."})
        return data


class PrintRunSerializer(serializers.ModelSerializer):
    exam_name = serializers.CharField(source="exam.name", read_only=True)
    by = serializers.CharField(source="created_by.display_name", read_only=True, default="")

    class Meta:
        model = PrintRun
        fields = ["id", "exam", "exam_name", "machine", "meter_before", "meter_after", "qty", "spoilt",
                  "photo_before", "photo_after", "started_at", "done_at", "by", "created_by"]


class OtherPrintSerializer(serializers.ModelSerializer):
    class Meta:
        model = OtherPrint
        fields = ["id", "description", "machine", "meter_before", "meter_after", "photo_before", "photo_after", "created_at"]

    def validate(self, data):
        if data["meter_after"] < data["meter_before"]:
            raise serializers.ValidationError({"meter_after": "The reading after can't be lower than before."})
        return data


class ReceiptSerializer(serializers.ModelSerializer):
    exam_name = serializers.CharField(source="exam.name", read_only=True)

    class Meta:
        model = StoreReceipt
        fields = ["id", "exam", "exam_name", "qty", "serial_from", "serial_to", "created_at"]

    def validate(self, data):
        exam = data["exam"]
        not_closed(exam)
        if not PrintRun.objects.filter(exam=exam, done_at__isnull=False).exists():
            raise serializers.ValidationError("The printer has not posted this exam yet.")
        if StoreReceipt.objects.filter(exam=exam).exists():
            raise serializers.ValidationError("This exam is already counted.")
        if exam.numbered:
            lo, hi = data.get("serial_from"), data.get("serial_to")
            if lo is None or hi is None:
                raise serializers.ValidationError("Enter the lowest and highest serial numbers.")
            if hi < lo:
                raise serializers.ValidationError("The highest serial must be above the lowest.")
            if hi - lo + 1 != data["qty"]:
                raise serializers.ValidationError(f"Serials {lo}–{hi} make {hi - lo + 1} copies, but you counted {data['qty']}. Recount.")
        return data


class SchoolSerializer(serializers.ModelSerializer):
    class Meta:
        model = School
        fields = ["id", "name", "district", "contact", "phone", "candidates"]

    def validate_name(self, name):
        name = name.strip()
        dupes = School.objects.filter(name__iexact=name, merged_into__isnull=True)
        if self.instance:
            dupes = dupes.exclude(pk=self.instance.pk)
        if dupes.exists():
            raise serializers.ValidationError("A school with this name is already on the list. Choose it instead.")
        return name


class IssueSerializer(serializers.ModelSerializer):
    exam_name = serializers.CharField(source="exam.name", read_only=True)
    sales_name = serializers.CharField(source="sales.display_name", read_only=True)
    by = serializers.CharField(source="created_by.display_name", read_only=True, default="")

    class Meta:
        model = Issue
        fields = ["id", "exam", "exam_name", "sales", "sales_name", "qty", "serials", "accepted_at", "created_at", "by"]
        read_only_fields = ["accepted_at"]

    def validate(self, data):
        not_closed(data["exam"])
        if data["sales"].role != User.Role.SALES:
            raise serializers.ValidationError("Copies can only be issued to a sales person.")
        stats = Ledger().exam_stats(data["exam"])
        if data["qty"] > stats["in_store"]:
            raise serializers.ValidationError(f"Only {stats['in_store']:,} copies are in the store.")
        check_serials(data["exam"], data.get("serials", ""), data["qty"])
        return data


class ReturnSerializer(serializers.ModelSerializer):
    exam_name = serializers.CharField(source="exam.name", read_only=True)
    sales_name = serializers.CharField(source="sales.display_name", read_only=True)

    class Meta:
        model = Return
        fields = ["id", "exam", "exam_name", "sales", "sales_name", "qty", "serials", "created_at"]

    def validate(self, data):
        not_closed(data["exam"])
        holding = Ledger().sales_stats(data["sales"].id)["per_exam"].get(data["exam"].id, 0)
        if data["qty"] > holding:
            raise serializers.ValidationError(f"{data['sales'].display_name} holds only {holding:,} copies of this exam.")
        check_serials(data["exam"], data.get("serials", ""), data["qty"])
        return data


class VisitSerializer(serializers.ModelSerializer):
    exam_name = serializers.CharField(source="exam.name", read_only=True)
    school_name = serializers.CharField(source="school.name", read_only=True)
    sales_name = serializers.CharField(source="sales.display_name", read_only=True)
    new_school = SchoolSerializer(write_only=True, required=False)
    debt = serializers.SerializerMethodField()

    class Meta:
        model = Visit
        fields = ["id", "client_id", "exam", "exam_name", "school", "school_name", "new_school", "sales", "sales_name",
                  "date", "copies", "price", "price_reason", "price_status", "paid", "method", "momo_id", "note_no",
                  "note_photo", "serials", "due", "notes", "latitude", "longitude", "confirmation", "debt", "created_at"]
        # The price always comes from the owner's set price for the exam; sales people can't change it.
        read_only_fields = ["sales", "price", "price_reason", "price_status", "confirmation"]
        # client_id uniqueness is handled in the view, so a repeated send returns the saved visit.
        extra_kwargs = {"school": {"required": False}, "client_id": {"validators": []}}

    def get_debt(self, v):
        paid_later = sum(p.amount for p in v.payments.all())
        price = v.exam.price if v.price_status == Visit.PriceStatus.REJECTED else v.price
        return v.copies * price - v.paid - paid_later

    def validate(self, data):
        user = self.context["request"].user
        exam = data["exam"]
        not_closed(exam)
        if not data.get("school") and not data.get("new_school"):
            raise serializers.ValidationError({"school": "Choose the school, or add a new one."})
        holding = Ledger().sales_stats(user.id)["per_exam"].get(exam.id, 0)
        if data["copies"] > holding:
            raise serializers.ValidationError({"copies": f"You hold only {holding:,} copies of this exam."})
        check_serials(exam, data.get("serials", ""), data["copies"])
        method, paid = data.get("method", Method.CASH), data.get("paid", 0)
        if method == Method.UNPAID and paid > 0:
            raise serializers.ValidationError({"method": "Choose how the school paid."})
        if method == Method.MOMO and paid > 0:
            if not data.get("momo_id", "").strip():
                raise serializers.ValidationError({"momo_id": "Enter the mobile money transaction ID from the payment SMS."})
            if momo_id_used(data["momo_id"]):
                raise serializers.ValidationError({"momo_id": "That mobile money transaction ID is already recorded."})
        if Visit.objects.filter(note_no__iexact=data["note_no"].strip()).exists():
            raise serializers.ValidationError({"note_no": "That delivery note number is already used."})
        if not data.get("note_photo"):
            raise serializers.ValidationError({"note_photo": "Take a photo of the delivery note signed by the school."})
        return data

    @transaction.atomic
    def create(self, data):
        new_school = data.pop("new_school", None)
        if new_school:
            existing = School.objects.filter(name__iexact=new_school["name"], merged_into__isnull=True).first()
            data["school"] = existing or School.objects.create(created_by=self.context["request"].user, **new_school)
        data["momo_id"] = data.get("momo_id", "").strip().upper() if data.get("method") == Method.MOMO else ""
        data["note_no"] = data["note_no"].strip()
        data["price"] = data["exam"].price
        data["price_status"] = Visit.PriceStatus.OK
        school = data["school"]
        if data.get("latitude") is not None and school.latitude is None:
            # The first visit with GPS fixes where the school is; later visits are checked against it.
            school.latitude, school.longitude = data["latitude"], data["longitude"]
            school.save(update_fields=["latitude", "longitude"])
        return super().create(data)


class PaymentSerializer(serializers.ModelSerializer):
    school_name = serializers.CharField(source="visit.school.name", read_only=True)
    by = serializers.CharField(source="created_by.display_name", read_only=True, default="")

    class Meta:
        model = Payment
        fields = ["id", "visit", "school_name", "amount", "method", "momo_id", "created_at", "by"]

    def validate(self, data):
        if data.get("method") == Method.MOMO:
            if not data.get("momo_id", "").strip():
                raise serializers.ValidationError({"momo_id": "Enter the mobile money transaction ID."})
            if momo_id_used(data["momo_id"]):
                raise serializers.ValidationError({"momo_id": "That mobile money transaction ID is already recorded."})
            data["momo_id"] = data["momo_id"].strip().upper()
        return data


class CashSerializer(serializers.ModelSerializer):
    sales_name = serializers.CharField(source="sales.display_name", read_only=True)
    by = serializers.CharField(source="created_by.display_name", read_only=True, default="")

    class Meta:
        model = CashHandover
        fields = ["id", "sales", "sales_name", "amount", "created_at", "by"]


class OwnerHandoverSerializer(serializers.ModelSerializer):
    by = serializers.CharField(source="created_by.display_name", read_only=True, default="")

    class Meta:
        model = OwnerHandover
        fields = ["id", "amount", "method", "ref", "confirmed_at", "created_at", "by"]
        read_only_fields = ["confirmed_at"]


class PaperSerializer(serializers.ModelSerializer):
    class Meta:
        model = PaperIssue
        fields = ["id", "reams", "sheets_per_ream", "sheets", "created_at"]


class SchoolCheckSerializer(serializers.ModelSerializer):
    name = serializers.SerializerMethodField()

    class Meta:
        model = SchoolCheck
        fields = ["id", "kind", "school", "school_name", "name", "result", "note", "created_at"]

    def get_name(self, c):
        return c.school.name if c.school else c.school_name


class MomoLineSerializer(serializers.ModelSerializer):
    class Meta:
        model = MomoLine
        fields = ["id", "tx_id", "amount", "payer", "received_at", "source", "created_at"]


class CorrectionSerializer(serializers.ModelSerializer):
    by = serializers.CharField(source="created_by.display_name", read_only=True, default="")

    class Meta:
        model = CorrectionRequest
        fields = ["id", "target_type", "target_id", "reason", "resolved_at", "resolution", "created_at", "by"]
        read_only_fields = ["resolved_at", "resolution"]


class ExpenseSerializer(serializers.ModelSerializer):
    exam_name = serializers.CharField(source="exam.name", read_only=True, default="")
    category_label = serializers.CharField(source="get_category_display", read_only=True)

    class Meta:
        model = Expense
        fields = ["id", "date", "category", "category_label", "amount", "exam", "exam_name", "note", "created_at"]


class FeedbackSerializer(serializers.ModelSerializer):
    by = serializers.CharField(source="created_by.display_name", read_only=True, default="")

    class Meta:
        model = Feedback
        fields = ["id", "text", "page", "created_at", "resolved_at", "by"]
        read_only_fields = ["resolved_at"]
