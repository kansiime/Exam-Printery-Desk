from django.contrib import admin
from django.urls import include, path, re_path
from rest_framework.routers import DefaultRouter

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

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include(api)),
    # Meter and delivery-note photos: only signed-in staff can open them.
    re_path(r"^media/(?P<path>.+)$", v.protected_media),
]
