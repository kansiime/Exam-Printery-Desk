from django.contrib.auth.models import AbstractUser
from django.db import models
from simple_history.models import HistoricalRecords


class User(AbstractUser):
    """A person who works at the printery. The role decides which screens and
    actions they get; the owner creates every account."""

    class Role(models.TextChoices):
        OWNER = "owner", "Owner"
        PRINTER = "printer", "Printer"
        STORE = "store", "Store keeper"
        SALES = "sales", "Sales person"

    role = models.CharField(max_length=10, choices=Role.choices, default=Role.SALES)
    phone = models.CharField(max_length=20, blank=True)
    history = HistoricalRecords()

    @property
    def display_name(self):
        return self.get_full_name() or self.username

    def __str__(self):
        return f"{self.display_name} ({self.get_role_display()})"


class PasswordResetCode(models.Model):
    """A one-time code sent by SMS so a worker can set a new password.

    Only a hash of the code is stored. Codes expire and lock after a few wrong tries.
    """

    MAX_ATTEMPTS = 5
    LIFETIME_MINUTES = 15

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="reset_codes")
    code_hash = models.CharField(max_length=128)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    attempts = models.PositiveSmallIntegerField(default=0)
    used_at = models.DateTimeField(null=True, blank=True)


class ResetRequest(models.Model):
    """A worker asked for a password reset while SMS is not set up; the owner hands them a code."""

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="reset_requests")
    created_at = models.DateTimeField(auto_now_add=True)
    handled_at = models.DateTimeField(null=True, blank=True)
