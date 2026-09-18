from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from passlib.context import CryptContext

from app.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return pwd_context.verify(password, password_hash)


def create_access_token(subject: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {"sub": subject, "exp": expire}
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def decode_access_token(token: str) -> Optional[str]:
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
        return payload.get("sub")
    except jwt.PyJWTError:
        return None


def extract_state_code(fssai_license_number: Optional[str]) -> Optional[str]:
    """FSSAI license numbers start with a 2-digit state code (Chapter 9.2 of
    the Dairy Bible). Returns None for anything that doesn't look like one —
    this is best-effort metadata, not a validated field."""
    if fssai_license_number and len(fssai_license_number) >= 2 and fssai_license_number[:2].isdigit():
        return fssai_license_number[:2]
    return None
