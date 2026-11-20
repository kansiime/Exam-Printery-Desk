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
