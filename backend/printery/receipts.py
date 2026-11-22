"""Receipts for sales and debt payments: a PDF with the business name, a receipt number and a
check code, shared with the school through a public link (WhatsApp) so it can't be disputed later.

Receipt numbers: S-000123 for a sale (school visit), P-000045 for a debt payment.
The check code is a signature of the receipt's contents: anyone opening the link sees the
system's own copy, so a changed or made-up receipt doesn't match.
"""
import hashlib
import hmac
from io import BytesIO

from django.conf import settings
from django.http import HttpResponse
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .models import Payment, Visit
from .permissions import OWNER, SALES, role_of
from .services import Ledger, ugx
from .whatsapp import intl

KINDS = {"sale": ("S", Visit), "payment": ("P", Payment)}


def number(kind, obj_id):
    return f"{KINDS[kind][0]}-{obj_id:06d}"


def check_code(kind, obj_id):
    return hmac.new(settings.SECRET_KEY.encode(), f"receipt:{kind}:{obj_id}".encode(), hashlib.sha256).hexdigest()[:12]


def load(kind, obj_id):
    model = KINDS[kind][1]
    return model.all_objects.select_related("exam", "school", "sales").filter(pk=obj_id).first() if kind == "sale" else \
        model.all_objects.select_related("visit__exam", "visit__school", "visit__sales", "created_by").filter(pk=obj_id).first()


def facts(kind, obj):
    """The receipt's lines, in order, plus who it is for."""
    L = Ledger()
    if kind == "sale":
        v = obj
        total = L.visit_value(v) if not v.cancelled_at else v.copies * v.price
        paid_since = sum(p.amount for p in L.payments if p.visit_id == v.id)
        lines = [
            ("Date", v.date.strftime("%d %b %Y")), ("School", v.school.name), ("Exam", v.exam.name),
            ("Copies", f"{v.copies:,}"), ("Price per copy", ugx(v.price)), ("Total", ugx(total)),
            ("Paid now", f"{ugx(v.paid)} ({v.get_method_display()}{' ' + v.momo_id if v.momo_id else ''})"),
            ("Balance owed", ugx(max(total - v.paid, 0))),
        ]
        if v.serials:
            lines.append(("Serial numbers", v.serials))
        lines += [("Delivery note", v.note_no), ("Served by", v.sales.display_name)]
        if v.due and total - v.paid > 0:
            lines.append(("To pay by", v.due.strftime("%d %b %Y")))
        if paid_since:
            lines.append(("Paid since (later payments)", ugx(paid_since)))
        school, title = v.school, "Sales receipt"
    else:
        p = obj
        v = p.visit
        before = L.visit_value(v) - v.paid - sum(x.amount for x in L.payments if x.visit_id == v.id and x.created_at < p.created_at)
        lines = [
            ("Date", timezone.localtime(p.created_at).strftime("%d %b %Y %H:%M")), ("School", v.school.name),
            ("For", f"{v.exam.name}, sale {number('sale', v.id)} of {v.date:%d %b %Y}"),
            ("Amount received", f"{ugx(p.amount)} ({p.get_method_display()}{' ' + p.momo_id if p.momo_id else ''})"),
            ("Balance before", ugx(max(before, 0))), ("Balance now", ugx(max(before - p.amount, 0))),
            ("Received by", p.created_by.display_name if p.created_by else ""),
        ]
        school, title = v.school, "Payment receipt"
    if obj.cancelled_at:
        lines.append(("CANCELLED", f"{timezone.localtime(obj.cancelled_at):%d %b %Y}: {obj.cancel_reason}"))
    return {"title": title, "school": school, "lines": lines}


def pdf(kind, obj):
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A5
    from reportlab.lib.units import mm
    from reportlab.pdfgen import canvas

    f = facts(kind, obj)
    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=A5)
    w, h = A5
    blue = colors.HexColor("#2153E0")
    c.setFillColor(blue)
    c.rect(0, h - 28 * mm, w, 28 * mm, stroke=0, fill=1)
    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", 16)
    c.drawString(12 * mm, h - 14 * mm, settings.BUSINESS_NAME)
    c.setFont("Helvetica", 9)
    contact = " · ".join(x for x in [settings.BUSINESS_PHONE, settings.BUSINESS_ADDRESS] if x)
    if contact:
        c.drawString(12 * mm, h - 20 * mm, contact)
    c.setFillColor(colors.black)
    c.setFont("Helvetica-Bold", 13)
    c.drawString(12 * mm, h - 40 * mm, f["title"])
    c.setFont("Helvetica", 10)
    c.drawRightString(w - 12 * mm, h - 40 * mm, f"No. {number(kind, obj.id)}")
    y = h - 52 * mm
    for label, value in f["lines"]:
        bold = label in ("Total", "Balance owed", "Amount received", "Balance now", "CANCELLED")
        c.setFillColor(colors.HexColor("#B42318") if label == "CANCELLED" else colors.HexColor("#5B6475"))
        c.setFont("Helvetica", 9)
        c.drawString(12 * mm, y, label)
        c.setFillColor(colors.black)
        c.setFont("Helvetica-Bold" if bold else "Helvetica", 10)
        text = str(value)
        while len(text) > 48:  # wrap long values
            cut = text.rfind(" ", 0, 48) or 48
            c.drawRightString(w - 12 * mm, y, text[:cut])
            text, y = text[cut:].strip(), y - 5 * mm
        c.drawRightString(w - 12 * mm, y, text)
        y -= 4 * mm
        c.setStrokeColor(colors.HexColor("#E3E7EF"))
        c.line(12 * mm, y, w - 12 * mm, y)
        y -= 5 * mm
    c.setFillColor(colors.HexColor("#5B6475"))
    c.setFont("Helvetica", 8)
    c.drawString(12 * mm, 22 * mm, f"Check code: {check_code(kind, obj.id)}")
    c.drawString(12 * mm, 17 * mm, "Open the receipt link to see the printery's own copy. A receipt that differs is not valid.")
    c.drawString(12 * mm, 12 * mm, f"Printed {timezone.localtime():%d %b %Y %H:%M}")
    c.showPage()
    c.save()
    return buf.getvalue()


def can_see(request, kind, obj):
    r = role_of(request)
    if r == OWNER:
        return True
    if r == SALES:
        v = obj if kind == "sale" else obj.visit
        return v.sales_id == request.user.id
    return False


@api_view(["GET"])
def receipt_info(request, kind, obj_id):
    """For the app: receipt number, the public link and a ready WhatsApp message."""
    if kind not in KINDS:
        return Response(status=404)
    obj = load(kind, obj_id)
    if not obj or not can_see(request, kind, obj):
        return Response(status=404)
    f = facts(kind, obj)
    path = f"/api/r/{kind}/{obj_id}/{check_code(kind, obj_id)}/"
    lines = dict(f["lines"])
    if kind == "sale":
        summary = f"{lines['Copies']} copies of {lines['Exam']}, total {lines['Total']}, paid {lines['Paid now'].split(' (')[0]}, balance {lines['Balance owed']}"
    else:
        summary = f"received {lines['Amount received'].split(' (')[0]}, balance now {lines['Balance now']}"
    text = (f"{settings.BUSINESS_NAME} receipt {number(kind, obj_id)} for {f['school'].name}: {summary}. "
            f"View or download your receipt: {{link}}")
    return Response({"number": number(kind, obj_id), "path": path, "whatsapp_text": text, "phone": intl(f["school"].phone),
                     "school": f["school"].name, "title": f["title"]})


@api_view(["GET"])
@permission_classes([AllowAny])
def receipt_pdf(request, kind, obj_id, code):
    """Public, for the school: the receipt PDF, only with the right check code."""
    if kind not in KINDS or not hmac.compare_digest(code, check_code(kind, obj_id)):
        return HttpResponse("This receipt link is not valid.", status=404, content_type="text/plain")
    obj = load(kind, obj_id)
    if not obj:
        return HttpResponse("Receipt not found.", status=404, content_type="text/plain")
    resp = HttpResponse(pdf(kind, obj), content_type="application/pdf")
    resp["Content-Disposition"] = f'inline; filename="receipt-{number(kind, obj_id)}.pdf"'
    return resp
