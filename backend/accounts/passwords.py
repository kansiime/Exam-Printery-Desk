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

from .models import PasswordResetCode, User

log = logging.getLogger(__name__)

# Same answer whether or not the username exists, so nobody can test which accounts exist.
SENT = ("If that username has a phone number, a 6-digit code has been sent to it by SMS. "
        "No code after a few minutes? Ask the owner to set a new password for you.")
BAD_CODE = "That code is wrong or has expired. Ask for a new code."


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
    if user and user.phone:
        code = f"{secrets.randbelow(1_000_000):06d}"
        with transaction.atomic():
            PasswordResetCode.objects.filter(user=user, used_at__isnull=True).update(used_at=timezone.now())
            PasswordResetCode.objects.create(user=user, code_hash=make_password(code),
                                             expires_at=timezone.now() + timedelta(minutes=PasswordResetCode.LIFETIME_MINUTES))
        send_sms(user.phone, f"{settings.BUSINESS_NAME}: your password reset code is {code}. "
                             f"It expires in {PasswordResetCode.LIFETIME_MINUTES} minutes. Don't share it.")
    elif user:
        log.info("Password reset asked for %s, but the account has no phone number.", user.username)
    return Response({"detail": SENT})


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
        user.save(update_fields=["password"])
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
