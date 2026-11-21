"""Who gets told what. Every event in the printery creates in-app notifications;
the phone app polls for them and rings."""
import hashlib
import logging

from django.db import IntegrityError, transaction

from accounts.models import User

from .models import Notification

log = logging.getLogger(__name__)
OWNER, PRINTER, STORE, SALES = User.Role.OWNER, User.Role.PRINTER, User.Role.STORE, User.Role.SALES


def people(*roles):
    qs = User.objects.filter(is_active=True)
    if OWNER in roles:
        return list(qs.filter(role__in=roles)) + list(qs.filter(is_superuser=True).exclude(role__in=roles))
    return list(qs.filter(role__in=roles))


def tell(recipients, title, body="", link="", level=Notification.Level.INFO, photos=None, key="", exclude=None):
    """Create one notification per person (after the current save commits)."""
    def write():
        for user in {u.id: u for u in recipients}.values():
            if exclude is not None and user.id == exclude.id:
                continue
            try:
                with transaction.atomic():
                    Notification.objects.create(recipient=user, level=level, title=title[:200], body=body, link=link,
                                                photos=[p for p in (photos or []) if p], key=key)
            except IntegrityError:
                pass  # this person already has this warning
    transaction.on_commit(write)


def tell_roles(roles, *args, **kwargs):
    tell(people(*roles), *args, **kwargs)


def check_findings():
    """Ring the owner for every new serious fraud warning (each warning only once)."""
    from .services import audit

    def run():
        try:
            findings = [f for f in audit()["findings"] if f["level"] == "bad"]
        except Exception:  # never let a check break the save that triggered it
            log.exception("fraud check failed")
            return
        owners = people(OWNER)
        for f in findings:
            key = "finding:" + hashlib.sha1(f["text"].encode()).hexdigest()[:40]
            for owner in owners:
                try:
                    with transaction.atomic():
                        Notification.objects.get_or_create(recipient=owner, key=key, defaults={
                            "level": Notification.Level.URGENT, "title": "Fraud warning", "body": f["text"], "link": "/owner/fraud"})
                except IntegrityError:
                    pass
    transaction.on_commit(run)


def photo_url(field):
    return field.url if field else None
