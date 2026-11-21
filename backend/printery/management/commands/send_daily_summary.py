"""Text the owner today's summary. Run once a day by a scheduler (Render cron job or Celery beat)."""
from django.conf import settings
from django.core.management.base import BaseCommand

from printery.tasks import build_daily_summary
from printery.sms import send_sms


class Command(BaseCommand):
    help = "Send the owner's daily summary by SMS (prints it when no OWNER_PHONE is set)."

    def handle(self, *args, **opts):
        text = build_daily_summary()
        self.stdout.write(text)
        if settings.OWNER_PHONE:
            send_sms(settings.OWNER_PHONE, text)
