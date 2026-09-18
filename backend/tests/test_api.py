"""End-to-end smoke test: register -> login -> submit -> read back.
Uses a throwaway SQLite file so it never touches a real database.
"""
import os
import uuid

os.environ["DATABASE_URL"] = "sqlite:///./test_inspeckt.db"

from fastapi.testclient import TestClient  # noqa: E402
from app.main import app  # noqa: E402

client = TestClient(app)


def test_health():
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_register_login_submit_flow():
    email = f"test-{uuid.uuid4().hex[:8]}@example.com"
    register_resp = client.post("/api/v1/auth/register", json={
        "email": email, "password": "testpass123", "full_name": "Test FBO",
        "company_name": "Test Dairy Co", "fssai_license_number": "12ABCDE1234F1Z5",
    })
    assert register_resp.status_code == 201, register_resp.text
    token = register_resp.json()["access_token"]
    assert register_resp.json()["user"]["state_code"] == "12"

    headers = {"Authorization": f"Bearer {token}"}

    login_resp = client.post("/api/v1/auth/login", json={"email": email, "password": "testpass123"})
    assert login_resp.status_code == 200

    me_resp = client.get("/api/v1/auth/me", headers=headers)
    assert me_resp.status_code == 200
    assert me_resp.json()["email"] == email

    # Fix per review items C1/C2: New Submissions are now gated by tier
    # (free/no-tier accounts get 0) — purchase Starter first so this
    # end-to-end flow can actually save one, same as
    # test_free_iteration_limit_enforced_then_lifted_by_starter_tier does
    # for the Formulation Lab.
    purchase_resp = client.post("/api/v1/pricing/purchase", headers=headers, json={"tier": "starter"})
    assert purchase_resp.status_code == 200, purchase_resp.text

    submit_resp = client.post("/api/v1/submissions", headers=headers, json={
        "category": "milk",
        "input": {
            "milk_type": "buffalo_milk", "fat": 6.2, "snf": 9.1, "heat_treatment": "pasteurised",
            # Milk's real Table 2A/2B panel (dairy_bible.py MICRO_LIMITS["milk"],
            # matching frontend/js/data/dairyBible.js exactly) is just
            # apc + coliform (2A) and salmonella + listeria (2B) — no
            # e_coli/staph_aureus/enterobacteriaceae keys exist for milk.
            # A stale, never-applied "rename to enterobacteriaceae" note
            # used to live here; corrected so this fixture matches what
            # the engine actually checks today.
            "lab": {"apc": 25000, "coliform": 2, "salmonella": False, "listeria": False},
            "label": {
                "product_name": True, "manufacturer_name": True, "fssai_license_number": True,
                "ingredients": True, "net_quantity": True, "mrp": True, "batch_number": True,
                "mfg_date": True, "expiry_date": True, "allergen_milk": True, "nutrition_panel": True,
                "instructions_for_use": True, "consumer_care": True, "milk_class": True,
                "heat_treatment_declared": True,
            },
        },
    })
    assert submit_resp.status_code == 201, submit_resp.text
    body = submit_resp.json()
    assert body["overall_status"] == "PASS"
    submission_id = body["id"]

    list_resp = client.get("/api/v1/submissions", headers=headers)
    assert list_resp.status_code == 200
    assert any(s["id"] == submission_id for s in list_resp.json())

    get_resp = client.get(f"/api/v1/submissions/{submission_id}", headers=headers)
    assert get_resp.status_code == 200
    assert get_resp.json()["result"]["overall_status"] == "PASS"

    unauth_resp = client.get("/api/v1/submissions")
    assert unauth_resp.status_code == 401
