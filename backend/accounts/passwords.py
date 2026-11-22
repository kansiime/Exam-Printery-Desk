"""Forgot-password (SMS code) and change-password endpoints."""
import logging
import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import update_session_auth_hash
from django.contrib.auth.hashers import check_password, make_password
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle

from printery.sms import send_sms

from .models import PasswordResetCode, ResetRequest, User

log = logging.getLogger(__name__)

# Same answer whether or not the username exists, so nobody can test which accounts exist.
SENT = ("If that username has a phone number, a 6-digit code has been sent to it by SMS. "
        "No code after a few minutes? Ask the owner to set a new password for you.")
ASKED = ("Your request has been sent to the owner. They will give you a 6-digit code in person, "
         "by phone or on WhatsApp. Enter it below.")
BAD_CODE = "That code is wrong or has expired. Ask for a new code."
OWNER_CODE_MINUTES = 24 * 60  # codes the owner passes on by hand last a day


def sms_enabled():
    return settings.SMS_PROVIDER == "africastalking" and bool(settings.AT_API_KEY)


def new_code(user, minutes):
    """Replace any open code for this user with a fresh one; returns the plain code (stored hashed)."""
    code = f"{secrets.randbelow(1_000_000):06d}"
    with transaction.atomic():
        PasswordResetCode.objects.filter(user=user, used_at__isnull=True).update(used_at=timezone.now())
        PasswordResetCode.objects.create(user=user, code_hash=make_password(code), expires_at=timezone.now() + timedelta(minutes=minutes))
    return code


class ResetThrottle(ScopedRateThrottle):
    scope = "password_reset"


def _password_errors(password, user):
    try:
        validate_password(password, user=user)
    except ValidationError as e:
        return " ".join(e.messages)
    return ""


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([ResetThrottle])
def forgot(request):
    username = str(request.data.get("username", "")).strip()
    user = User.objects.filter(username__iexact=username, is_active=True).first()
    if not sms_enabled():
        # No SMS yet: the owner sees the request in the app and hands over a code.
        if user and not ResetRequest.objects.filter(user=user, handled_at__isnull=True).exists():
            ResetRequest.objects.create(user=user)
            from printery import notify
            notify.tell_roles([notify.OWNER], f"{user.display_name} forgot their password",
                              "Create a reset code for them on your Overview.", "/owner", "action")
        return Response({"detail": ASKED, "via": "owner"})
    if user and user.phone:
        code = new_code(user, PasswordResetCode.LIFETIME_MINUTES)
        send_sms(user.phone, f"{settings.BUSINESS_NAME}: your password reset code is {code}. "
                             f"It expires in {PasswordResetCode.LIFETIME_MINUTES} minutes. Don't share it.")
    elif user:
        log.info("Password reset asked for %s, but the account has no phone number.", user.username)
    return Response({"detail": SENT, "via": "sms"})


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([ResetThrottle])
def reset(request):
    username = str(request.data.get("username", "")).strip()
    code = str(request.data.get("code", "")).strip()
    new_password = str(request.data.get("new_password", ""))
    user = User.objects.filter(username__iexact=username, is_active=True).first()
    entry = (PasswordResetCode.objects.filter(user=user, used_at__isnull=True, expires_at__gt=timezone.now())
             .order_by("-created_at").first() if user else None)
    if not entry or entry.attempts >= PasswordResetCode.MAX_ATTEMPTS:
        return Response({"code": BAD_CODE}, status=400)
    if not check_password(code, entry.code_hash):
        entry.attempts += 1
        entry.save(update_fields=["attempts"])
        return Response({"code": BAD_CODE}, status=400)
    if problem := _password_errors(new_password, user):
        return Response({"new_password": problem}, status=400)
    with transaction.atomic():
        user.set_password(new_password)
        user.failed_logins, user.locked_until = 0, None
        user.save(update_fields=["password", "failed_logins", "locked_until"])
        entry.used_at = timezone.now()
        entry.save(update_fields=["used_at"])
    return Response({"detail": "Password changed. Sign in with your new password."})


@api_view(["POST"])
def change(request):
    user = request.user
    if not user.check_password(str(request.data.get("current_password", ""))):
        return Response({"current_password": "Your current password is wrong."}, status=400)
    new_password = str(request.data.get("new_password", ""))
    if problem := _password_errors(new_password, user):
        return Response({"new_password": problem}, status=400)
    user.set_password(new_password)
    user.save(update_fields=["password"])
    update_session_auth_hash(request, user)  # stay signed in here; other phones are signed out
    return Response({"detail": "Password changed."})


# ---------- owner: hand out codes when there is no SMS ----------
def _is_owner(request):
    return request.user.is_superuser or request.user.role == User.Role.OWNER


@api_view(["GET"])
def reset_requests(request):
    if not _is_owner(request):
        return Response(status=403)
    rows = ResetRequest.objects.filter(handled_at__isnull=True, user__is_active=True).select_related("user").order_by("-created_at")
    return Response([{"id": r.id, "user": r.user_id, "name": r.user.display_name, "username": r.user.username,
                      "phone": r.user.phone, "created_at": r.created_at} for r in rows])


@api_view(["POST"])
def give_code(request, user_id):
    """Owner creates a one-time code for a worker and passes it on in person, by phone or WhatsApp."""
    if not _is_owner(request):
        return Response(status=403)
    user = User.objects.filter(pk=user_id, is_active=True).first()
    if not user:
        return Response({"detail": "That account is switched off or does not exist."}, status=404)
    code = new_code(user, OWNER_CODE_MINUTES)
    ResetRequest.objects.filter(user=user, handled_at__isnull=True).update(handled_at=timezone.now())
    message = (f"{settings.BUSINESS_NAME}: your password reset code is {code}. Open the app, tap "
               f"'Forgot your password?', enter your username ({user.username}) and this code. It works once, within 24 hours.")
    return Response({"code": code, "name": user.display_name, "username": user.username, "phone": user.phone,
                     "message": message, "hours": OWNER_CODE_MINUTES // 60})


@api_view(["POST"])
def dismiss_request(request, request_id):
    if not _is_owner(request):
        return Response(status=403)
    ResetRequest.objects.filter(pk=request_id).update(handled_at=timezone.now())
    return Response({"ok": True})
