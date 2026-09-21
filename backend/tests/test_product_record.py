"""Tests for the shared product/submission record (Phase 1 foundation of
WHOLE_APP_SPEC.md §6): a Product row that New Submission and Formulation
Lab can both attach to via an optional product_id, instead of each module
keeping its own disconnected copy of "the product". See app/models.py's
Product/CLASSIFICATION_STATES and app/routers/products.py.
"""
import os
import uuid

os.environ["DATABASE_URL"] = "sqlite:///./test_product_record.db"

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
    return {"Authorization": f"Bearer {token}"}


def _signup_with_starter_tier():
    headers = _signup()
    purchase_resp = client.post("/api/v1/pricing/purchase", headers=headers, json={"tier": "starter"})
    assert purchase_resp.status_code == 200, purchase_resp.text
    return headers


def test_create_product_starts_in_need_information_with_no_category():
    headers = _signup()
    resp = client.post("/api/v1/products", headers=headers, json={
        "product_name": "Mango Flavoured Milk",
        "description": "Cow milk with mango pulp and sugar, pasteurised, sold chilled.",
    })
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["product_name"] == "Mango Flavoured Milk"
    assert body["classification_state"] == "NEED_INFORMATION"
    assert body["category"] is None
    assert body["sub_type"] is None
    assert body["classification_evidence"] is None


def test_list_products_returns_only_the_current_users_products_newest_first():
    headers = _signup()
    other_headers = _signup()

    client.post("/api/v1/products", headers=headers, json={"product_name": "Paneer A"})
    client.post("/api/v1/products", headers=headers, json={"product_name": "Paneer B"})
    client.post("/api/v1/products", headers=other_headers, json={"product_name": "Someone Else's Product"})

    resp = client.get("/api/v1/products", headers=headers)
    assert resp.status_code == 200
    names = [p["product_name"] for p in resp.json()]
    assert names == ["Paneer B", "Paneer A"]  # newest first
    assert "Someone Else's Product" not in names


def test_get_product_404s_for_another_users_product():
    headers = _signup()
    other_headers = _signup()

    create_resp = client.post("/api/v1/products", headers=headers, json={"product_name": "Private Cheese"})
    product_id = create_resp.json()["id"]

    resp = client.get(f"/api/v1/products/{product_id}", headers=other_headers)
    assert resp.status_code == 404


def test_update_product_can_confirm_classification_with_evidence():
    headers = _signup()
    create_resp = client.post("/api/v1/products", headers=headers, json={"product_name": "Plain Toned Milk"})
    product_id = create_resp.json()["id"]

    resp = client.patch(f"/api/v1/products/{product_id}", headers=headers, json={
        "category": "milk",
        "classification_state": "CONFIRMED",
        "classification_evidence": {
            "candidates_considered": ["milk", "flavoured_milk"],
            "reason": "Founder confirmed no added ingredients — matches FSS 2.1.2 definition, not 2.1.3.",
        },
    })
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["category"] == "milk"
    assert body["classification_state"] == "CONFIRMED"
    assert body["classification_evidence"]["candidates_considered"] == ["milk", "flavoured_milk"]


def test_update_product_rejects_an_invalid_classification_state():
    headers = _signup()
    create_resp = client.post("/api/v1/products", headers=headers, json={"product_name": "Ambiguous Dairy Thing"})
    product_id = create_resp.json()["id"]

    resp = client.patch(f"/api/v1/products/{product_id}", headers=headers, json={
        "classification_state": "DEFINITELY_MILK",
    })
    assert resp.status_code == 422


def test_update_product_404s_for_another_users_product():
    headers = _signup()
    other_headers = _signup()
    create_resp = client.post("/api/v1/products", headers=headers, json={"product_name": "Not Yours"})
    product_id = create_resp.json()["id"]

    resp = client.patch(f"/api/v1/products/{product_id}", headers=other_headers, json={"category": "milk"})
    assert resp.status_code == 404


def test_submission_can_attach_to_an_existing_product():
    headers = _signup_with_starter_tier()
    product_id = client.post("/api/v1/products", headers=headers, json={"product_name": "Full Cream Milk"}).json()["id"]

    submit_resp = client.post("/api/v1/submissions", headers=headers, json={
        "category": "milk",
        "input": {
            "milk_type": "full_cream_milk", "fat": 6.5, "snf": 9.2, "sodium": 40, "urea": 30,
            "lab": {}, "label": {},
        },
        "product_id": product_id,
    })
    assert submit_resp.status_code == 201, submit_resp.text
    assert submit_resp.json()["product_id"] == product_id

    # And it round-trips on read-back and in the history list.
    submission_id = submit_resp.json()["id"]
    get_resp = client.get(f"/api/v1/submissions/{submission_id}", headers=headers)
    assert get_resp.json()["product_id"] == product_id

    list_resp = client.get("/api/v1/submissions", headers=headers)
    assert any(s["id"] == submission_id and s["product_id"] == product_id for s in list_resp.json())


def test_submission_rejects_a_product_id_belonging_to_another_user():
    headers = _signup_with_starter_tier()
    other_headers = _signup()
    other_product_id = client.post("/api/v1/products", headers=other_headers, json={"product_name": "Not Yours"}).json()["id"]

    submit_resp = client.post("/api/v1/submissions", headers=headers, json={
        "category": "milk",
        "input": {
            "milk_type": "full_cream_milk", "fat": 6.5, "snf": 9.2, "sodium": 40, "urea": 30,
            "lab": {}, "label": {},
        },
        "product_id": other_product_id,
    })
    assert submit_resp.status_code == 404


def test_submission_without_a_product_id_still_works_exactly_as_before():
    headers = _signup_with_starter_tier()
    submit_resp = client.post("/api/v1/submissions", headers=headers, json={
        "category": "milk",
        "input": {
            "milk_type": "full_cream_milk", "fat": 6.5, "snf": 9.2, "sodium": 40, "urea": 30,
            "lab": {}, "label": {},
        },
    })
    assert submit_resp.status_code == 201, submit_resp.text
    assert submit_resp.json()["product_id"] is None


def test_formulation_iteration_can_attach_to_an_existing_product():
    headers = _signup_with_starter_tier()
    product_id = client.post("/api/v1/products", headers=headers, json={"product_name": "Fruit Yogurt"}).json()["id"]

    resp = client.post("/api/v1/formulations", headers=headers, json={
        "product_name": "Fruit Yogurt",
        "iteration_label": "v1",
        "category": "paneer",
        "input": {"paneer_type": "paneer_standard", "moisture": 55, "fat": 22},
        "product_id": product_id,
    })
    assert resp.status_code == 201, resp.text
    assert resp.json()["product_id"] == product_id


def test_formulation_iteration_rejects_a_product_id_belonging_to_another_user():
    headers = _signup_with_starter_tier()
    other_headers = _signup()
    other_product_id = client.post("/api/v1/products", headers=other_headers, json={"product_name": "Not Yours"}).json()["id"]

    resp = client.post("/api/v1/formulations", headers=headers, json={
        "product_name": "Fruit Yogurt",
        "iteration_label": "v1",
        "category": "paneer",
        "input": {"paneer_type": "paneer_standard", "moisture": 55, "fat": 22},
        "product_id": other_product_id,
    })
    assert resp.status_code == 404
