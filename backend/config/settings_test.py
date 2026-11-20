"""Settings for the test suite: local defaults, eager background jobs, throwaway media folder."""
import os
import tempfile

os.environ.setdefault("DJANGO_DEBUG", "1")
os.environ.setdefault("CELERY_EAGER", "1")
os.environ.setdefault("MEDIA_ROOT", tempfile.mkdtemp(prefix="printery-media-"))

from .settings import *  # noqa: E402,F401,F403

PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
