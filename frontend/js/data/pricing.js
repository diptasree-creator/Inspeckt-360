/**
 * Inspeckt — pricing ladder (see PLATFORM_PLAN_V2.md §6).
 * Mirrors backend/app/pricing.py so the frontend-only demo and the API
 * show identical numbers. If you wire this frontend to the backend, fetch
 * GET /api/v1/pricing/tiers instead of importing this file.
 */
// Fix per review item C3: Starter's pricing copy used to say "3
// formulation iterations included" while iterationAllowance() actually
// granted 8 (adding to a 5-free baseline) — a real, un-signed-off
// [ASSUMPTION] left over from PLATFORM_PLAN_V2.md §6 ("whether tier
// allowances are separate from the free 5, or continuous"). Per the
// confirmed policy: each paid tier now grants exactly its stated number
// as ONE shared pool covering New Submissions and formulation iterations
// together, in any mix — no separate counters, no free baseline stacked
// on top. An account with no tier gets 0 (see usagePool.js).
export const PRICING_TIERS = [
  {
    id: "starter", label: "Starter", price_inr: 15000, price_display: "₹15,000",
    billing: "per product",
    included: [
      "3 New Submissions and/or formulation iterations included, in any mix — full compliance check (composition, label, and claims)",
      "2 consultation meetings with your consultant",
    ],
    overage: "₹3,000 per additional New Submission or formulation iteration beyond the included 3",
  },
  {
    id: "mid", label: "Mid", price_inr: 50000, price_display: "₹50,000",
    billing: "per engagement",
    included: [
      "5 New Submissions and/or formulation iterations included, in any mix — full compliance check (composition, label, and claims)",
      "5 consultation meetings with your consultant",
    ],
    overage: "₹3,000 per additional New Submission or formulation iteration beyond the included 5",
  },
  {
    id: "higher", label: "Higher", price_inr: 75000, price_display: "₹75,000",
    billing: "per engagement",
    included: [
      "10 New Submissions and/or formulation iterations included, in any mix — full compliance check",
      "10 consultation meetings with your consultant",
    ],
    overage: "₹3,000 per additional New Submission or formulation iteration beyond the included 10",
  },
  {
    id: "full_consultation", label: "Full Consultation", price_inr: 100000, price_display: "₹1,00,000+",
    billing: "priced per scope",
    included: [
      "Done for you — our consultant team handles formulation, label, and documentation directly",
      "You don't need to operate the tool yourself",
    ],
    overage: "Priced case-by-case above ₹1,00,000 for larger scopes",
    highlight: true,
  },
];

// Fix per review item C3: New Submissions and Formulation Lab iterations
// now draw from ONE shared pool per tier (see usagePool.js), not two
// separate counters — this replaces the C1/C2-era note that said the
// opposite. Saving a full compliance check and saving a scored
// Formulation Lab iteration both use one unit of the same allowance.
export const UNIT_NOTE =
  "“Included” New Submissions and formulation iterations are counted from one shared pool per tier, not two separate ones — saving a full compliance check and saving a scored Formulation Lab iteration both use one unit of the same allowance.";

// Fix per review item C3: the shared pool size per tier — used by both
// storage.js's saveSubmission() and formulations.js's saveIteration() so
// the two always check against the exact same numbers as the copy above.
// No free baseline: an account with no tier gets 0.
const POOL_SIZE = { starter: 3, mid: 5, higher: 10, full_consultation: Infinity };
export function poolAllowance(user) {
  if (!user?.tier) return 0;
  return POOL_SIZE[user.tier] ?? 0;
}

export const LICENSE_CHARGES_NOTE =
  "License/registration application charges are not included in any tier above — always billed separately, handled directly by your consultant.";

export const GST_NOTE = "All prices are exclusive of GST.";
