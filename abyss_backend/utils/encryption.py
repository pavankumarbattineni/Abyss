import base64
from functools import lru_cache

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

from config import config

_SECRET_KEY: str = config["MCP"]["encryption_key"]


@lru_cache(maxsize=None)
def _fernet(purpose: str = "mcp") -> Fernet:
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=f"thinkloop_{purpose}_api_key_v1".encode(),
        iterations=100_000,
    )
    key = base64.urlsafe_b64encode(kdf.derive(_SECRET_KEY.encode()))
    return Fernet(key)


def encrypt_value(plaintext: str, purpose: str = "mcp") -> str:
    return _fernet(purpose).encrypt(plaintext.encode()).decode()


def decrypt_value(ciphertext: str, purpose: str = "mcp") -> str:
    return _fernet(purpose).decrypt(ciphertext.encode()).decode()
