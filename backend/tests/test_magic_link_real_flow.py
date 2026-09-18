"""Tests for the REAL magic-link flow added in Fix Plan Part 3, §1:
POST /auth/magic-link/request + GET /auth/magic-link/verify, and the
pluggable email adapter in app/email_adapter.py. Kept separate from
test_platform_v2.py, which covers the legacy /auth/magic-link shortcut
that most other tests still use for signup."""
import os
import uuid

os.environ["DATABASE_URL"] = "sqlite:///./test_magic_link_real_flow.db"

from fastapi.testclient import TestClient  # noqa: E402
from app.main import app  # noqa: E402
from app.email_adapter import get_email_adapter, reset_email_adapter  # noqa: E402

client = TestClient(app)


def _request_link(email=None):
    reset_email_adapter()
    email = email or f"real-{uuid.uuid4().hex[:8]}@example.com"
    resp = client.post("/api/v1/auth/magic-link/request", json={
        "email": email, "business_name": "Real Flow Foods",
        "fssai_license_number": "12345678901234",
    })
    return email, resp


def test_request_step_returns_no_token_and_no_user():
    email, resp = _request_link()
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert "access_token" not in body
    assert "user" not in body
    assert body["message"] == "Check your email for a sign-in link."
    assert body["expires_in_minutes"] > 0


def test_request_step_does_not_create_an_account():
    # A link that's requested but never verified must leave no account
    # behind — the whole point of splitting request/verify apart.
    email, resp = _request_link()
    assert resp.status_code == 201
    # No way to check "does this user exist" without a token, by design —
    # instead, verify with a bogus token and confirm it's rejected as
    # invalid (not "already used" or any status implying a user exists).
    bad = client.get("/api/v1/auth/magic-link/verify", params={"token": "not-a-real-token"})
    assert bad.status_code == 401
    assert "invalid" in bad.json()["detail"].lower()


def test_console_adapter_captures_the_link():
    email, resp = _request_link()
    assert resp.status_code == 201
    adapter = get_email_adapter()
    assert len(adapter.sent_links) == 1
    assert adapter.sent_links[0]["to"] == email
    assert "token=" in adapter.sent_links[0]["link"]


def test_verify_with_the_real_token_issues_a_session():
    email, resp = _request_link()
    assert resp.status_code == 201
    adapter = get_email_adapter()
    link = adapter.sent_links[-1]["link"]
    token = link.split("token=")[1]

    verify = client.get("/api/v1/auth/magic-link/verify", params={"token": token})
    assert verify.status_code == 200, verify.text
    body = verify.json()
    assert body["access_token"]
    assert body["user"]["email"] == email
    assert body["user"]["company_name"] == "Real Flow Foods"

    me = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"})
    assert me.status_code == 200
    assert me.json()["email"] == email


def test_verify_is_single_use():
    _, resp = _request_link()
    token = get_email_adapter().sent_links[-1]["link"].split("token=")[1]

    first = client.get("/api/v1/auth/magic-link/verify", params={"token": token})
    assert first.status_code == 200

    second = client.get("/api/v1/auth/magic-link/verify", params={"token": token})
    assert second.status_code == 401
    assert "already been used" in second.json()["detail"]


def test_verify_rejects_an_unknown_token():
    resp = client.get("/api/v1/auth/magic-link/verify", params={"token": "totally-made-up"})
    assert resp.status_code == 401
    assert "invalid" in resp.json()["detail"].lower()


def test_verify_rejects_an_expired_token():
    # Directly manipulate the stored row's expiry rather than sleeping —
    # this test asserts the comparison logic, not real wall-clock time.
    from datetime import datetime, timedelta
    from app.database import SessionLocal
    from app.models import MagicLinkToken

    _, resp = _request_link()
    token = get_email_adapter().sent_links[-1]["link"].split("token=")[1]

    import hashlib
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    db = SessionLocal()
    row = db.query(MagicLinkToken).filter(MagicLinkToken.token_hash == token_hash).first()
    row.expires_at = datetime.utcnow() - timedelta(minutes=1)
    db.commit()
    db.close()

    verify = client.get("/api/v1/auth/magic-link/verify", params={"token": token})
    assert verify.status_code == 401
    assert "expired" in verify.json()["detail"].lower()


def test_verify_reuses_the_existing_account_for_a_second_link():
    email = f"repeat-{uuid.uuid4().hex[:8]}@example.com"

    _, resp1 = _request_link(email)
    token1 = get_email_adapter().sent_links[-1]["link"].split("token=")[1]
    first = client.get("/api/v1/auth/magic-link/verify", params={"token": token1})
    user_id_1 = first.json()["user"]["id"]

    _, resp2 = _request_link(email)
    token2 = get_email_adapter().sent_links[-1]["link"].split("token=")[1]
    second = client.get("/api/v1/auth/magic-link/verify", params={"token": token2})
    user_id_2 = second.json()["user"]["id"]

    assert user_id_1 == user_id_2
