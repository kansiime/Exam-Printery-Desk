"""Make the key pair for phone alerts while the app is closed (Web Push).

Paste the two printed values into the backend's environment (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY).
Keep the private key secret; changing it later means people turn alerts on again.
"""
import base64

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from django.core.management.base import BaseCommand


def b64(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def new_keys():
    key = ec.generate_private_key(ec.SECP256R1())
    private = b64(key.private_numbers().private_value.to_bytes(32, "big"))
    public = b64(key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint))
    return public, private


class Command(BaseCommand):
    help = "Print a new VAPID key pair for Web Push (optional: without it the server makes and stores its own)."

    def handle(self, *args, **opts):
        public, private = new_keys()
        self.stdout.write(f"VAPID_PUBLIC_KEY={public}\nVAPID_PRIVATE_KEY={private}")
