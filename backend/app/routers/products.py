from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.dairy_bible import (
    CATEGORIES, FSSAI_CATEGORIES, CHEESE_TYPES, MICRO_LIMITS, MILK_TYPES, PANEER_TYPES, GHEE_TYPES, MILK_POWDER_TYPES,
    YOGURT_TYPES, LABEL_ELEMENTS_ALL, LABEL_ELEMENTS_BY_CATEGORY,
)
from app.database import get_db
from app.deps import get_current_user
from app.models import Product, User
from app.schemas import ProductCreateRequest, ProductOut, ProductUpdateRequest

router = APIRouter(prefix="/api/v1/products", tags=["products"])

# Fix per review item C17 (bring not-live categories live): "ghee",
# "milk_powder", and "yogurt" added.
_COMPOSITION_BY_CATEGORY = {
    "milk": MILK_TYPES, "paneer": PANEER_TYPES, "cheese": CHEESE_TYPES,
    "ghee": GHEE_TYPES, "milk_powder": MILK_POWDER_TYPES, "yogurt": YOGURT_TYPES,
}


@router.get("/platform-categories")
def list_platform_categories():
    """Every FSSAI category the platform covers (Dairy live, rest coming
    soon) — the homepage grid and the product-search "doesn't fit" flow
    both read from this. See PLATFORM_PLAN_V2.md §1, §4."""
    return {"categories": FSSAI_CATEGORIES}


@router.get("/categories")
def list_categories():
    """Dairy sub-categories — the picker *inside* the Dairy category."""
    return {"categories": CATEGORIES}


@router.get("/{category_id}/standards")
def get_standards(category_id: str):
    if category_id not in _COMPOSITION_BY_CATEGORY:
        raise HTTPException(status_code=404, detail="Unknown or not-yet-live category")
    return {
        "category": category_id,
        "composition_types": _COMPOSITION_BY_CATEGORY[category_id],
        "microbiological_limits": MICRO_LIMITS.get(category_id, {}),
        "labelling_requirements": LABEL_ELEMENTS_ALL + LABEL_ELEMENTS_BY_CATEGORY.get(category_id, []),
    }


# ---------------------------------------------------------------------
# The shared product/submission record (WHOLE_APP_SPEC.md §6). Every
# module — New Submission, Formulation Lab, and (later) Lab Testing,
# Label Check, Claims Review — is meant to read/write one of these
# instead of keeping its own separate copy of "the product". Phase 1
# foundation only: CRUD lives here now; nothing calls create_product()
# automatically yet (that's Phase 2, the real classification engine —
# see New Submission's redesign).
# ---------------------------------------------------------------------

def _to_product_out(record: Product) -> ProductOut:
    return ProductOut(
        id=record.id,
        product_name=record.product_name,
        description=record.description,
        category=record.category,
        sub_type=record.sub_type,
        classification_state=record.classification_state,
        classification_evidence=record.classification_evidence_json,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


@router.post("", response_model=ProductOut, status_code=status.HTTP_201_CREATED)
def create_product(
    payload: ProductCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # A brand-new product is never auto-confirmed — see
    # app/models.py:CLASSIFICATION_STATES and WHOLE_APP_SPEC.md §7-8.
    record = Product(
        user_id=current_user.id,
        product_name=payload.product_name,
        description=payload.description,
        classification_state="NEED_INFORMATION",
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return _to_product_out(record)


@router.get("", response_model=List[ProductOut])
def list_products(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rows = (
        db.query(Product)
        .filter(Product.user_id == current_user.id)
        .order_by(Product.created_at.desc())
        .all()
    )
    return [_to_product_out(r) for r in rows]


@router.get("/{product_id}", response_model=ProductOut)
def get_product(product_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    record = db.get(Product, product_id)
    if record is None or record.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Product not found")
    return _to_product_out(record)


@router.patch("/{product_id}", response_model=ProductOut)
def update_product(
    product_id: str,
    payload: ProductUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    record = db.get(Product, product_id)
    if record is None or record.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Product not found")

    if payload.product_name is not None:
        record.product_name = payload.product_name
    if payload.description is not None:
        record.description = payload.description
    if payload.category is not None:
        record.category = payload.category
    if payload.sub_type is not None:
        record.sub_type = payload.sub_type
    if payload.classification_state is not None:
        record.classification_state = payload.classification_state
    if payload.classification_evidence is not None:
        record.classification_evidence_json = payload.classification_evidence

    db.commit()
    db.refresh(record)
    return _to_product_out(record)
