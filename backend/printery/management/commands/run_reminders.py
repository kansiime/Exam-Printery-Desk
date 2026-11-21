"""Send reminders for stuck or forgotten work. Safe to run as often as you like (e.g. every 30 minutes)."""
from django.core.management.base import BaseCommand

from printery.reminders import run_reminders


class Command(BaseCommand):
    help = "Remind people about stuck printing, counting, issues, cash, overdue debts and day closes."

    def handle(self, *args, **opts):
        self.stdout.write(f"Checked reminders ({run_reminders()} checked).")
