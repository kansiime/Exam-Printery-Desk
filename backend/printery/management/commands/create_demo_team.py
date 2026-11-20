"""Create example accounts for trying the system: owner, printer, store keeper, two sales people.

    python manage.py create_demo_team --password choose-a-password

Use only on a test copy. On the real system the owner creates accounts on the Team screen.
"""
from django.core.management.base import BaseCommand

from accounts.models import User

TEAM = [("owner", "Owner", "owner"), ("printer", "Peter", "printer"), ("store", "Sam", "store"),
        ("musa", "Musa", "sales"), ("sarah", "Sarah", "sales")]


class Command(BaseCommand):
    help = "Create demo accounts (owner, printer, store, musa, sarah) with one password."

    def add_arguments(self, parser):
        parser.add_argument("--password", required=True)

    def handle(self, *args, password, **opts):
        for username, first, role in TEAM:
            user, created = User.objects.get_or_create(username=username, defaults={"first_name": first, "role": role})
            user.set_password(password)
            user.is_staff = user.is_superuser = role == "owner"
            user.save()
            self.stdout.write(f"{'Created' if created else 'Updated'} {username} ({role})")
