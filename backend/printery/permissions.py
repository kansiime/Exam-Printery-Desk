from rest_framework.permissions import SAFE_METHODS, BasePermission

from accounts.models import User

OWNER, PRINTER, STORE, SALES = User.Role.OWNER, User.Role.PRINTER, User.Role.STORE, User.Role.SALES


def role_of(request):
    user = request.user
    if not user or not user.is_authenticated:
        return None
    return OWNER if user.is_superuser else user.role


def roles(*allowed, read=None):
    """Permission class: `allowed` roles may do anything, `read` roles may only read."""
    read = read or ()

    class RolePermission(BasePermission):
        message = "Your role does not allow this."

        def has_permission(self, request, view):
            r = role_of(request)
            if r in allowed:
                return True
            return request.method in SAFE_METHODS and r in read

    return RolePermission
