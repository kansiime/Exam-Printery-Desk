from django.contrib import admin
from simple_history.admin import SimpleHistoryAdmin

from . import models as m


class CancellableAdmin(SimpleHistoryAdmin):
    """Shows cancelled records too, so the owner can see everything."""

    def get_queryset(self, request):
        return self.model.all_objects.all()

    def has_delete_permission(self, request, obj=None):
        return False


for model in [m.Exam, m.PrintRun, m.OtherPrint, m.StoreReceipt, m.Issue, m.Return, m.Visit, m.Payment,
              m.CashHandover, m.OwnerHandover, m.PaperIssue, m.StockCount, m.SchoolCheck]:
    admin.site.register(model, CancellableAdmin)

admin.site.register(m.School, SimpleHistoryAdmin)
admin.site.register(m.MomoLine)
admin.site.register(m.CorrectionRequest, SimpleHistoryAdmin)
admin.site.site_header = "Exam Printery Desk"
