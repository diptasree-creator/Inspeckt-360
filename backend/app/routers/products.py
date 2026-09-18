from fastapi import APIRouter, HTTPException

from app.dairy_bible import (
    CATEGORIES, FSSAI_CATEGORIES, CHEESE_TYPES, MICRO_LIMITS, MILK_TYPES, PANEER_TYPES, GHEE_TYPES, MILK_POWDER_TYPES,
    YOGURT_TYPES, LABEL_ELEMENTS_ALL, LABEL_ELEMENTS_BY_CATEGORY,
)

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
