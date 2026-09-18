"""Tests for the platform-wide additions in PLATFORM_PLAN_V2.md: magic-link
auth, platform categories, the Formulation Lab, leads, and pricing tiers."""
import os
import uuid

os.environ["DATABASE_URL"] = "sqlite:///./test_platform_v2.db"

from fastapi.testclient import TestClient  # noqa: E402
from app.main import app  # noqa: E402

client = TestClient(app)


def _signup():
    email = f"brand-{uuid.uuid4().hex[:8]}@example.com"
    resp = client.post("/api/v1/auth/magic-link", json={
        "email": email, "business_name": "ABC Foods Pvt. Ltd.",
        "fssai_license_number": "12345678901234",
    })
    assert resp.status_code == 201, resp.text
    token = resp.json()["access_token"]
    return token, {"Authorization": f"Bearer {token}"}


def test_magic_link_signup_no_password_needed():
    token, headers = _signup()
    me = client.get("/api/v1/auth/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["tier"] is None


def test_magic_link_is_idempotent_for_same_email():
    email = f"brand-{uuid.uuid4().hex[:8]}@example.com"
    body = {"email": email, "business_name": "X", "fssai_license_number": "12345678901234"}
    first = client.post("/api/v1/auth/magic-link", json=body)
    second = client.post("/api/v1/auth/magic-link", json=body)
    assert first.json()["user"]["id"] == second.json()["user"]["id"]


def test_magic_link_signup_works_with_no_license_number():
    # License is not a signup gate — see Fix Plan handoff item
    # "I don't want license to be a criteria."
    email = f"nolicense-{uuid.uuid4().hex[:8]}@example.com"
    resp = client.post("/api/v1/auth/magic-link", json={"email": email, "business_name": "No License Co"})
    assert resp.status_code == 201, resp.text
    assert resp.json()["user"]["fssai_license_number"] is None


def test_magic_link_rejects_a_malformed_license_number_when_one_is_given():
    email = f"badlicense-{uuid.uuid4().hex[:8]}@example.com"
    resp = client.post("/api/v1/auth/magic-link", json={
        "email": email, "business_name": "Bad License Co", "fssai_license_number": "123",
    })
    assert resp.status_code == 422


def test_platform_categories_lists_dairy_live_and_others_coming_soon():
    resp = client.get("/api/v1/products/platform-categories")
    assert resp.status_code == 200
    categories = resp.json()["categories"]
    assert len(categories) >= 5
    dairy = next(c for c in categories if c["id"] == "dairy")
    assert dairy["live"] is True
    non_dairy_live = [c for c in categories if c["id"] != "dairy" and c["live"]]
    assert non_dairy_live == []


def test_pricing_tiers_match_the_plan():
    resp = client.get("/api/v1/pricing/tiers")
    tiers = {t["id"]: t for t in resp.json()["tiers"]}
    assert tiers["starter"]["price_inr"] == 15000
    assert tiers["mid"]["price_inr"] == 50000
    assert tiers["higher"]["price_inr"] == 75000
    assert tiers["full_consultation"]["price_inr"] == 100000


def test_formulation_iteration_scores_a_compliant_draft_high():
    _, headers = _signup()
    # Fix per review item C3: Formulation Lab iterations are gated by the
    # shared usage pool (a fresh signup gets 0) — purchase Starter first
    # so this test can save one; the gating itself is covered separately
    # below.
    assert client.post("/api/v1/pricing/purchase", headers=headers, json={"tier": "starter"}).status_code == 200
    resp = client.post("/api/v1/formulations", headers=headers, json={
        "product_name": "Fruit Yogurt", "iteration_label": "v1", "category": "milk",
        "input": {"milk_type": "buffalo_milk", "fat": 6.2, "snf": 9.1},
    })
    assert resp.status_code == 201, resp.text
    assert resp.json()["closeness_score"] == "100"
    assert resp.json()["gap_summary"] == []


def test_formulation_iteration_flags_gaps_for_a_non_compliant_draft():
    _, headers = _signup()
    # Fix per review item C3: see test_formulation_iteration_scores_a_compliant_draft_high above.
    assert client.post("/api/v1/pricing/purchase", headers=headers, json={"tier": "starter"}).status_code == 200
    resp = client.post("/api/v1/formulations", headers=headers, json={
        "product_name": "Fruit Yogurt", "iteration_label": "low-fat draft", "category": "milk",
        "input": {"milk_type": "buffalo_milk", "fat": 4.0, "snf": 9.1},
    })
    assert resp.status_code == 201
    assert int(resp.json()["closeness_score"]) < 100
    assert any("Fat" in g["label"] for g in resp.json()["gap_summary"])


def test_formulation_iteration_blocked_for_free_tier_then_lifted_by_starter_tier():
    """Fix per review item C3: Formulation Lab iterations now draw from
    the same shared pool as New Submissions (app/usage_pool.py) — no free
    baseline stacked on top any more (that additive 5-free-plus-included
    math was itself C3's bug: Starter's copy said "3", it actually granted
    8). A free/untiered account gets 0; Starter's shared pool is 3."""
    _, headers = _signup()
    body = {"product_name": "Paneer", "iteration_label": "draft", "category": "paneer",
            "input": {"paneer_type": "paneer_standard", "moisture": 58, "fat": 52}}

    blocked = client.post("/api/v1/formulations", headers=headers, json=body)
    assert blocked.status_code == 402

    client.post("/api/v1/pricing/purchase", headers=headers, json={"tier": "starter"})
    for _ in range(3):
        r = client.post("/api/v1/formulations", headers=headers, json=body)
        assert r.status_code == 201, r.text

    blocked_again = client.post("/api/v1/formulations", headers=headers, json=body)
    assert blocked_again.status_code == 402


def test_new_submissions_and_formulation_iterations_share_one_pool():
    """Fix per review item C3: New Submissions and Formulation Lab
    iterations now draw from ONE shared pool per tier, in any mix — not
    two separate counters. This was flagged as an unresolved
    [ASSUMPTION — please confirm] in PLATFORM_PLAN_V2.md §6 ("whether tier
    allowances are separate from the free 5, or continuous") that never
    got signed off; the confirmed policy is one shared pool, no free
    baseline. Starter's pool is 3 — this mixes 1 submission + 2
    iterations to use up all 3, regardless of type."""
    _, headers = _signup()
    submission_body = {
        "category": "milk",
        "input": {
            "milk_type": "buffalo_milk", "fat": 6.2, "snf": 9.1, "heat_treatment": "pasteurised",
            "lab": {"apc": 25000, "enterobacteriaceae": 2, "e_coli": 2, "staph_aureus": 5, "salmonella": False, "listeria": False},
            "label": {
                "product_name": True, "manufacturer_name": True, "fssai_license_number": True,
                "ingredients": True, "net_quantity": True, "mrp": True, "batch_number": True,
                "mfg_date": True, "expiry_date": True, "allergen_milk": True, "nutrition_panel": True,
                "instructions_for_use": True, "consumer_care": True, "milk_class": True,
                "heat_treatment_declared": True,
            },
        },
        "has_lab_report": False,
    }
    iteration_body = {"product_name": "Paneer", "iteration_label": "draft", "category": "paneer",
                       "input": {"paneer_type": "paneer_standard", "moisture": 58, "fat": 52}}

    # No tier purchased yet -> 0 shared units; both kinds blocked.
    assert client.post("/api/v1/submissions", headers=headers, json=submission_body).status_code == 402
    assert client.post("/api/v1/formulations", headers=headers, json=iteration_body).status_code == 402

    client.post("/api/v1/pricing/purchase", headers=headers, json={"tier": "starter"})
    resp1 = client.post("/api/v1/submissions", headers=headers, json=submission_body)
    assert resp1.status_code == 201, resp1.text
    resp2 = client.post("/api/v1/formulations", headers=headers, json=iteration_body)
    assert resp2.status_code == 201, resp2.text
    resp3 = client.post("/api/v1/formulations", headers=headers, json=iteration_body)
    assert resp3.status_code == 201, resp3.text

    # All 3 shared units used (1 submission + 2 iterations) -> blocked
    # regardless of which type is requested next.
    assert client.post("/api/v1/submissions", headers=headers, json=submission_body).status_code == 402
    assert client.post("/api/v1/formulations", headers=headers, json=iteration_body).status_code == 402


def test_submission_batch_lot_number_is_stored_and_returned():
    """Fix per review item C12: a micro test result belongs to a specific
    production batch/lot, not "the SKU" as a concept — the same recipe can
    pass one batch and fail the next. Previously there was no durable link
    between a saved result and a batch/lot number at all. Optional field —
    a submission without one should still work exactly as before."""
    _, headers = _signup()
    assert client.post("/api/v1/pricing/purchase", headers=headers, json={"tier": "starter"}).status_code == 200
    body = {
        "category": "paneer",
        "input": {
            "paneer_type": "paneer_standard", "moisture": 58, "fat": 52,
            "lab": {"apc": 25000, "coliform": 2, "e_coli": 2, "staph_aureus": 5, "salmonella": False, "listeria": False},
            "label": {
                "product_name": True, "manufacturer_name": True, "fssai_license_number": True,
                "ingredients": True, "net_quantity": True, "mrp": True, "batch_number": True,
                "mfg_date": True, "expiry_date": True, "allergen_milk": True, "nutrition_panel": True,
                "instructions_for_use": True, "consumer_care": True,
            },
        },
        "has_lab_report": False,
        "batch_lot_number": "LOT-2026-08-114",
    }
    resp = client.post("/api/v1/submissions", headers=headers, json=body)
    assert resp.status_code == 201, resp.text
    assert resp.json()["batch_lot_number"] == "LOT-2026-08-114"

    submission_id = resp.json()["id"]
    fetched = client.get(f"/api/v1/submissions/{submission_id}", headers=headers)
    assert fetched.json()["batch_lot_number"] == "LOT-2026-08-114"

    listed = client.get("/api/v1/submissions", headers=headers)
    assert listed.json()[0]["batch_lot_number"] == "LOT-2026-08-114"

    # Omitting it entirely (the field is optional) must not break anything.
    body_no_batch = {**body, "input": {**body["input"]}}
    del body_no_batch["batch_lot_number"]
    resp2 = client.post("/api/v1/submissions", headers=headers, json=body_no_batch)
    assert resp2.status_code == 201, resp2.text
    assert resp2.json()["batch_lot_number"] is None


def test_lead_capture_works_without_login():
    resp = client.post("/api/v1/leads", json={
        "kind": "doesnt_fit", "contact_email": "founder@example.com",
        "message": "Building a yogurt with ashwagandha — not sure it fits a defined category.",
        "context": {"product_description": "ashwagandha fruit yogurt"},
    })
    assert resp.status_code == 201, resp.text
    assert resp.json()["kind"] == "doesnt_fit"
    assert resp.json()["status"] == "new"


def test_lead_capture_notifies_the_consultant_team():
    """Every hand-off has to actually reach a person, not just sit in the
    leads table — see routers/leads.py's own comment on why this must
    never fail the lead-creation call itself. ConsoleEmailAdapter (the
    default, used throughout this test suite) records every "sent"
    notification in `sent_notifications` instead of emailing it, which is
    what this asserts against; a real deployment sets
    EMAIL_PROVIDER=resend so the same call actually emails
    CONSULTANT_NOTIFY_EMAIL (see app/email_adapter.py's ResendEmailAdapter)."""
    from app.email_adapter import get_email_adapter

    resp = client.post("/api/v1/leads", json={
        "kind": "license", "contact_email": "founder2@example.com", "contact_name": "Asha Rao",
        "message": "Need help with an FSSAI license renewal.",
    })
    assert resp.status_code == 201, resp.text
    lead_id = resp.json()["id"]

    notifications = get_email_adapter().sent_notifications
    assert any(n["lead_id"] == lead_id and n["kind"] == "license" for n in notifications)


def test_list_my_leads_only_returns_the_current_users_own_leads():
    """Added alongside GET /api/v1/leads (routers/leads.py) — parity with
    the standalone frontend's listLeadsForUser(), for the dashboard's
    "your consultant requests" history. Two different logged-in accounts
    each submit a lead; each must see only their own, and a lead
    submitted logged-out (no user_id stamped) must show up for neither."""
    _, headers_a = _signup()
    _, headers_b = _signup()

    resp_a = client.post("/api/v1/leads", headers=headers_a, json={
        "kind": "doesnt_fit", "contact_email": "a@example.com", "message": "Account A's product.",
    })
    assert resp_a.status_code == 201, resp_a.text

    client.post("/api/v1/leads", json={
        "kind": "license", "contact_email": "anonymous@example.com", "message": "Logged-out lead — belongs to nobody.",
    })

    leads_a = client.get("/api/v1/leads", headers=headers_a)
    assert leads_a.status_code == 200
    assert len(leads_a.json()) == 1
    assert leads_a.json()[0]["message"] == "Account A's product."

    leads_b = client.get("/api/v1/leads", headers=headers_b)
    assert leads_b.status_code == 200
    assert leads_b.json() == []


def test_list_my_leads_requires_login():
    resp = client.get("/api/v1/leads")
    assert resp.status_code == 401


def test_email_exists_distinguishes_a_real_account_from_an_unknown_one():
    """Added alongside GET /api/v1/auth/exists (routers/auth.py) — lets
    the real frontend's login page say "no account for that email,
    create one first" instead of the passwordless /magic-link endpoint
    silently creating a new account for any email typed into a login
    form."""
    email = f"exists-{uuid.uuid4().hex[:8]}@example.com"
    before = client.get("/api/v1/auth/exists", params={"email": email})
    assert before.status_code == 200
    assert before.json()["exists"] is False

    client.post("/api/v1/auth/magic-link", json={"email": email, "business_name": "Exists Test Co"})

    after = client.get("/api/v1/auth/exists", params={"email": email})
    assert after.json()["exists"] is True

    # Case-insensitive, matching every other email lookup in this backend
    # (User.email is always stored lowercased — see routers/auth.py).
    mixed_case = client.get("/api/v1/auth/exists", params={"email": email.upper()})
    assert mixed_case.json()["exists"] is True


def test_delete_formulation_iteration_frees_its_usage_pool_slot():
    """Added alongside DELETE /api/v1/formulations/{id} — parity with the
    standalone frontend's existing deleteIteration(). Deleting must also
    free the shared usage-pool slot back up (app/usage_pool.py counts
    rows), matching the original localStorage behavior."""
    _, headers = _signup()
    client.post("/api/v1/pricing/purchase", headers=headers, json={"tier": "starter"})
    body = {"product_name": "Paneer", "iteration_label": "draft", "category": "paneer",
            "input": {"paneer_type": "paneer_standard", "moisture": 58, "fat": 52}}
    for _ in range(3):
        assert client.post("/api/v1/formulations", headers=headers, json=body).status_code == 201
    assert client.post("/api/v1/formulations", headers=headers, json=body).status_code == 402

    iteration_id = client.get("/api/v1/formulations", headers=headers).json()[0]["id"]
    deleted = client.delete(f"/api/v1/formulations/{iteration_id}", headers=headers)
    assert deleted.status_code == 204

    remaining = client.get("/api/v1/formulations", headers=headers)
    assert len(remaining.json()) == 2

    # The freed slot is usable again.
    assert client.post("/api/v1/formulations", headers=headers, json=body).status_code == 201


def test_delete_formulation_iteration_is_scoped_to_its_owner():
    _, headers_a = _signup()
    _, headers_b = _signup()
    client.post("/api/v1/pricing/purchase", headers=headers_a, json={"tier": "starter"})
    body = {"product_name": "Paneer", "iteration_label": "draft", "category": "paneer",
            "input": {"paneer_type": "paneer_standard", "moisture": 58, "fat": 52}}
    created = client.post("/api/v1/formulations", headers=headers_a, json=body)
    iteration_id = created.json()["id"]

    cross_account_delete = client.delete(f"/api/v1/formulations/{iteration_id}", headers=headers_b)
    assert cross_account_delete.status_code == 404

    still_there = client.get(f"/api/v1/formulations/{iteration_id}", headers=headers_a)
    assert still_there.status_code == 200


def test_submission_without_lab_report_never_fabricates_nutrition_or_claims():
    _, headers = _signup()
    # Fix per review items C1/C2/C3: New Submissions are gated by the
    # shared usage pool (a fresh signup gets 0) — purchase Starter first
    # so this test can save one; the gating itself is covered separately
    # above.
    assert client.post("/api/v1/pricing/purchase", headers=headers, json={"tier": "starter"}).status_code == 200
    resp = client.post("/api/v1/submissions", headers=headers, json={
        "category": "milk",
        "input": {
            "milk_type": "buffalo_milk", "fat": 6.2, "snf": 9.1, "heat_treatment": "pasteurised",
            # "coliform" -> "enterobacteriaceae" for milk per review item
            # A12; "ingredients"/"mrp"/"instructions_for_use"/
            # "consumer_care" added to the label dict per B8.
            "lab": {"apc": 25000, "enterobacteriaceae": 2, "e_coli": 2, "staph_aureus": 5, "salmonella": False, "listeria": False},
            "label": {
                "product_name": True, "manufacturer_name": True, "fssai_license_number": True,
                "ingredients": True, "net_quantity": True, "mrp": True, "batch_number": True,
                "mfg_date": True, "expiry_date": True, "allergen_milk": True, "nutrition_panel": True,
                "instructions_for_use": True, "consumer_care": True, "milk_class": True,
                "heat_treatment_declared": True,
            },
        },
        "has_lab_report": False,
    })
    assert resp.status_code == 201, resp.text
    result = resp.json()["result"]
    assert result["nutrition_panel"]["status"] == "TEMPLATE_ONLY"
    assert result["claims"]["status"] == "NOT_CHECKED"
