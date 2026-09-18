"""
Inspeckt — pricing ladder (see PLATFORM_PLAN_V2.md §6).

Replaces the CTO spec's original per-report pricing (₹1,499 / ₹749 / ₹999 /
₹4,999 / ₹19,999) entirely. Kept as one data module so the frontend and any
backend gating logic (Formulation Lab overage, submission limits) read the
same numbers instead of hardcoding them twice.
"""

# Fix per review item C3: Starter's pricing copy used to say "3
# formulation iterations included" while _iteration_allowance() actually
# granted 8 (adding to a 5-free baseline, FREE_ITERATION_LIMIT — now
# removed) — a real, un-signed-off [ASSUMPTION] left over from
# PLATFORM_PLAN_V2.md §6 ("whether tier allowances are separate from the
# free 5, or continuous"). Per the confirmed policy: each paid tier now
# grants exactly its stated number as ONE shared pool covering New
# Submissions and formulation iterations together, in any mix — no
# separate counters, no free baseline stacked on top. An account with no
# tier gets 0 (see usage_pool.py).
PRICING_TIERS = [
    {
        "id": "starter",
        "label": "Starter",
        "price_inr": 15000,
        "price_display": "₹15,000",
        "billing": "per product",
        "included": [
            "3 New Submissions and/or formulation iterations included, in any mix — full compliance check (composition, label, and claims)",
            "2 consultation meetings with your consultant",
        ],
        "overage": "₹3,000 per additional New Submission or formulation iteration beyond the included 3",
        "included_units": 3,
        "included_consultations": 2,
        "overage_per_unit_inr": 3000,
    },
    {
        "id": "mid",
        "label": "Mid",
        "price_inr": 50000,
        "price_display": "₹50,000",
        "billing": "per engagement",
        "included": [
            "5 New Submissions and/or formulation iterations included, in any mix — full compliance check (composition, label, and claims)",
            "5 consultation meetings with your consultant",
        ],
        "overage": "₹3,000 per additional New Submission or formulation iteration beyond the included 5",
        "included_units": 5,
        "included_consultations": 5,
        "overage_per_unit_inr": 3000,
    },
    {
        "id": "higher",
        "label": "Higher",
        "price_inr": 75000,
        "price_display": "₹75,000",
        "billing": "per engagement",
        "included": [
            "10 New Submissions and/or formulation iterations included, in any mix — full compliance check",
            "10 consultation meetings with your consultant",
        ],
        "overage": "₹3,000 per additional New Submission or formulation iteration beyond the included 10",
        "included_units": 10,
        "included_consultations": 10,
        "overage_per_unit_inr": 3000,
    },
    {
        "id": "full_consultation",
        "label": "Full Consultation",
        "price_inr": 100000,
        "price_display": "₹1,00,000+",
        "billing": "priced per scope",
        "included": [
            "Done for you — our consultant team handles formulation, label, and documentation directly",
            "You don't need to operate the tool yourself",
        ],
        "overage": "Priced case-by-case above ₹1,00,000 for larger scopes",
        "included_units": None,
        "included_consultations": None,
        "overage_per_unit_inr": None,
    },
]

TIER_IDS = {t["id"] for t in PRICING_TIERS}

# Applies across every tier — never bundled in, always a separate charge
# handled directly by the consultant (see PLATFORM_PLAN_V2.md §6).
LICENSE_CHARGES_NOTE = (
    "License/registration application charges are not included in any tier "
    "above and are billed separately, handled directly by your consultant."
)

# Fix per review item C3: New Submissions and Formulation Lab iterations
# now draw from ONE shared pool per tier (see usage_pool.py), not two
# separate counters — this replaces the C1/C2-era note that said the
# opposite. Saving a full compliance check and saving a scored
# Formulation Lab iteration both use one unit of the same allowance.
UNIT_NOTE = (
    "“Included” New Submissions and formulation iterations are counted "
    "from one shared pool per tier, not two separate ones — saving a full "
    "compliance check and saving a scored Formulation Lab iteration both "
    "use one unit of the same allowance."
)


def get_tier(tier_id: str):
    return next((t for t in PRICING_TIERS if t["id"] == tier_id), None)
