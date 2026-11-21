from django.contrib import admin
from django.urls import include, path, re_path
from rest_framework.routers import DefaultRouter

from accounts import passwords
from printery import extras
from printery import views as v

router = DefaultRouter()
router.register("users", v.UserViewSet, basename="user")
router.register("exams", v.ExamViewSet, basename="exam")
router.register("prints", v.PrintViewSet, basename="print")
router.register("other-prints", v.OtherPrintViewSet, basename="other-print")
router.register("receipts", v.ReceiptViewSet, basename="receipt")
router.register("issues", v.IssueViewSet, basename="issue")
router.register("returns", v.ReturnViewSet, basename="return")
router.register("schools", v.SchoolViewSet, basename="school")
router.register("visits", v.VisitViewSet, basename="visit")
router.register("payments", v.PaymentViewSet, basename="payment")
router.register("cash", v.CashViewSet, basename="cash")
router.register("handovers", v.HandoverViewSet, basename="handover")
router.register("paper", v.PaperViewSet, basename="paper")
router.register("checks", v.SchoolCheckViewSet, basename="check")
router.register("momo", v.MomoViewSet, basename="momo")
router.register("corrections", v.CorrectionViewSet, basename="correction")

api = [
    path("health/", v.health),
    path("auth/csrf/", v.csrf),
    path("auth/login/", v.login_view),
    path("auth/logout/", v.logout_view),
    path("auth/me/", v.me),
    path("auth/password/forgot/", passwords.forgot),
    path("auth/password/reset/", passwords.reset),
    path("auth/password/change/", passwords.change),
    path("auth/password/requests/", passwords.reset_requests),
    path("auth/password/requests/<int:request_id>/dismiss/", passwords.dismiss_request),
    path("users/<int:user_id>/reset-code/", passwords.give_code),
    path("notifications/", v.notifications),
    path("notifications/read/", v.notifications_read),
    path("day-close/", extras.day_close),
    path("day-close/<int:close_id>/confirm/", extras.confirm_close),
    path("exams/<int:exam_id>/close/", extras.close_exam),
    path("exams/<int:exam_id>/qr-codes/", extras.qr_codes),
    path("verify/<int:exam_id>/<int:serial>/<str:sig>/", extras.verify_copy),
    path("push/key/", extras.push_key),
    path("push/subscribe/", extras.push_subscribe),
    path("push/unsubscribe/", extras.push_unsubscribe),
    path("cancel/", v.cancel_record),
    path("cancelled/", v.cancelled_records),
    path("counts/", v.stock_counts),
    path("summary/overview/", v.overview),
    path("summary/audit/", v.audit_view),
    path("summary/store/", v.store_summary),
    path("summary/field/", v.field_summary),
    path("summary/debts/", v.debts),
    path("summary/cash/", v.cash_summary),
    path("webhooks/momo/", v.momo_webhook),
    path("webhooks/sms/", v.sms_inbound),
    path("", include(router.urls)),
]

def backend_home(request):
    from django.http import HttpResponse
    return HttpResponse(
        "<!doctype html><title>Exam Printery Desk backend</title>"
        "<body style='font-family:system-ui;max-width:560px;margin:60px auto;padding:0 16px;line-height:1.5'>"
        "<h1>This is the backend</h1><p>It stores the data and is working. Your team does not use this address.</p>"
        "<p>Open the <b>frontend</b> (phone app) address to sign in. The owner can also use <a href='/admin/'>/admin/</a>.</p></body>")


urlpatterns = [
    path("", backend_home),
    path("admin/", admin.site.urls),
    path("api/", include(api)),
    # Meter and delivery-note photos: only signed-in staff can open them.
    re_path(r"^media/(?P<path>.+)$", v.protected_media),
]
