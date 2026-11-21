"""Create the owner account from OWNER_USERNAME / OWNER_PASSWORD if it doesn't exist yet.

Safe to run on every deploy: an existing account is never changed.
"""
import os

from django.core.management.base import BaseCommand

from accounts.models import User


class Command(BaseCommand):
    help = "Create the first owner account from environment variables."

    def handle(self, *args, **opts):
        username, password = os.environ.get("OWNER_USERNAME", "").strip(), os.environ.get("OWNER_PASSWORD", "")
        if not username or not password:
            self.stdout.write("OWNER_USERNAME / OWNER_PASSWORD not set; skipping.")
            return
        if User.objects.filter(username=username).exists():
            self.stdout.write(f"Owner {username} already exists.")
            return
        User.objects.create_superuser(username=username, password=password, role=User.Role.OWNER,
                                      first_name=os.environ.get("OWNER_FIRST_NAME", "").strip(),
                                      last_name=os.environ.get("OWNER_LAST_NAME", "").strip())
        self.stdout.write(f"Created owner {username}.")
