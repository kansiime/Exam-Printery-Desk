"""Who gets told what. Every event in the printery creates in-app notifications;
the phone app polls for them and rings."""
import hashlib
import json
import logging
import threading

from django.db import IntegrityError, transaction

from accounts.models import User

from .models import Notification, PushSubscription

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
                continue  # this person already has this warning
            push(user, title, body, link, level)
    transaction.on_commit(write)


def push(user, title, body, link, level):
    """Also alert the person's phones while the app is closed (Web Push), in the background."""
    from django.conf import settings

    from .extras import vapid_keys
    subs = list(PushSubscription.objects.filter(user=user))
    if not subs:
        return
    private_key = vapid_keys()[1]
    payload = json.dumps({"title": title[:120], "body": body[:240], "link": link or "/", "level": str(level)})

    def send():
        from pywebpush import WebPushException, webpush
        for s in subs:
            try:
                webpush({"endpoint": s.endpoint, "keys": {"p256dh": s.p256dh, "auth": s.auth}}, payload,
                        vapid_private_key=private_key, vapid_claims={"sub": settings.VAPID_SUBJECT}, ttl=86400,
                        headers={"Urgency": "high" if str(level) == "urgent" else "normal"})
            except WebPushException as e:
                if getattr(e, "response", None) is not None and e.response.status_code in (404, 410):
                    PushSubscription.objects.filter(pk=s.pk).delete()  # phone unsubscribed
                else:
                    log.warning("push to %s failed: %s", user, e)
            except Exception:
                log.exception("push failed")
    threading.Thread(target=send, daemon=True).start()


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
                        _, created = Notification.objects.get_or_create(recipient=owner, key=key, defaults={
                            "level": Notification.Level.URGENT, "title": "Fraud warning", "body": f["text"], "link": "/owner/fraud"})
                except IntegrityError:
                    continue
                if created:
                    push(owner, "Fraud warning", f["text"], "/owner/fraud", "urgent")
    transaction.on_commit(run)


def photo_url(field):
    return field.url if field else None
