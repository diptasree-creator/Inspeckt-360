/**
 * Inspeckt — Client-side validation engine
 * ----------------------------------------------------------------
 * Mirrors the architecture described in INSPECKT_TECHNICAL_SPECIFICATION.md
 * Chapter 6 (DairyComplianceValidator) and the escalation matrix in
 * the Dairy Bible Chapter 12 — but runs entirely in the browser so
 * the tool works with zero backend. The FastAPI backend (see
 * /backend) implements the identical logic in Python so results
 * stay consistent if you later move validation server-side.
 *
 * Overall status is three-state, matching the Bible's escalation
 * matrix rather than a flat pass/fail:
 *   FAIL    (RED)    — any CRITICAL failure, any missing CRITICAL
 *                       field, or 3+ HIGH failures. Submission blocked.
 *   WARNING (YELLOW)  — one or more HIGH failures, no CRITICAL ones.
 *   PASS    (GREEN)   — everything checked out.
 */

import {
  DAIRY_PRODUCTS, MILK_CATEGORY_FIELDS, HEAT_TREATMENTS,
  CHEESE_COMMON_RULE, MOZZARELLA_FDM_BANDS, MOZZARELLA_FDM_FLOOR,
  MICRO_LIMITS, LABEL_ELEMENTS_ALL, LABEL_ELEMENTS_BY_CATEGORY,
  REPORT_DISCLAIMER,
} from "./data/dairyBible.js";

// ---------------------------------------------------------------
// Generic check helpers — each returns a "check" record
// ---------------------------------------------------------------
function check({ label, status, actual, expected, ref, severity }) {
  return { label, status, actual, expected, ref, severity };
}

function checkMin(label, value, min, unit, ref, severity = "CRITICAL") {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return check({ label, status: "MISSING", actual: "—", expected: `≥ ${min}${unit}`, ref, severity });
  }
  const pass = value >= min;
  return check({
    label, status: pass ? "PASS" : "FAIL",
    actual: `${value}${unit}`, expected: `≥ ${min}${unit}`, ref, severity: pass ? severity : severity,
  });
}

function checkMax(label, value, max, unit, ref, severity = "HIGH") {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return check({ label, status: "MISSING", actual: "—", expected: `≤ ${max}${unit}`, ref, severity });
  }
  const pass = value <= max;
  return check({
    label, status: pass ? "PASS" : "FAIL",
    actual: `${value}${unit}`, expected: `≤ ${max}${unit}`, ref, severity,
  });
}

function checkBetween(label, value, min, max, unit, ref, severity = "CRITICAL") {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return check({ label, status: "MISSING", actual: "—", expected: `${min}–${max}${unit}`, ref, severity });
  }
  const pass = value >= min && value <= max;
  return check({
    label, status: pass ? "PASS" : "FAIL",
    actual: `${value}${unit}`, expected: `${min}–${max}${unit}`, ref, severity,
  });
}

// Fix per review item C17 (Ghee/Butter): a new rule kind for a
// categorical/pass-fail lab result (Baudouin Test, presence of
// β-sitosterol) rather than a numeric threshold — "expected" is a fixed
// value ("Negative"/"Absent"), not a min/max. Comparison is
// case-insensitive so "Negative"/"negative" both match the UI's
// lowercase select values.
function titleCase(s) {
  const str = String(s).trim();
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}
function checkEquals(label, value, expected, ref, severity = "CRITICAL") {
  const expectedText = titleCase(expected);
  if (value === null || value === undefined || value === "") {
    return check({ label, status: "MISSING", actual: "—", expected: expectedText, ref, severity });
  }
  const pass = String(value).trim().toLowerCase() === String(expected).trim().toLowerCase();
  return check({
    label, status: pass ? "PASS" : "FAIL",
    actual: titleCase(value), expected: expectedText, ref, severity,
  });
}

// ---------------------------------------------------------------
// Microbiology — Table 2A (process hygiene, 2/3-class plans) and
// Table 2B (food safety, presence/absence)
// ---------------------------------------------------------------
function checkMicroCount(name, value, limit, ref) {
  if (value === null || value === undefined || value === "" || Number.isNaN(value)) {
    return check({ label: `${name} (${limit.unit})`, status: "MISSING", actual: "—",
      expected: `≤ ${limit.m}`, ref, severity: "HIGH" });
  }
  if (value <= limit.m) {
    return check({ label: `${name} (${limit.unit})`, status: "PASS", actual: value,
      expected: `≤ ${limit.m} (m)`, ref, severity: "HIGH" });
  }
  if (limit.M !== null && value <= limit.M) {
    return check({ label: `${name} (${limit.unit})`, status: "WARNING", actual: value,
      expected: `≤ ${limit.m} (m) — between acceptable (${limit.m}) and rejection (${limit.M}) limit`,
      ref, severity: "HIGH" });
  }
  // Fix per review item B1 — sign-off received (escalate to CRITICAL):
  // a confirmed breach used to be CRITICAL only for a 3-class organism
  // (one with a rejection limit M) and HIGH for a 2-class organism
  // (a plain ceiling, M: null) — exactly the shape of E. coli/Coliform/
  // Staph aureus for milk, paneer, and cheese after the A-item fixes.
  // A single HIGH failure alone doesn't escalate overall_status to FAIL
  // (aggregateStatus() needs 3+ HIGH failures, or one CRITICAL one), so
  // a real, confirmed E. coli result over the limit rendered as a
  // yellow "Warning — composition looks good so far," not a red "Fail."
  // A confirmed breach is a confirmed breach regardless of which class
  // of sampling plan the organism uses — both now escalate the same way.
  return check({
    label: `${name} (${limit.unit})`, status: "FAIL", actual: value,
    expected: limit.M !== null ? `≤ ${limit.M} (M, rejection limit)` : `≤ ${limit.m}`,
    ref, severity: "CRITICAL",
  });
}

function checkMicroPresence(name, detected, limit, ref) {
  if (detected === null || detected === undefined) {
    return check({ label: name, status: "MISSING", actual: "—", expected: `Absent ${limit.unit}`, ref, severity: "CRITICAL" });
  }
  return check({
    label: name, status: detected ? "FAIL" : "PASS",
    actual: detected ? "Detected" : "Absent", expected: `Absent ${limit.unit}`, ref, severity: "CRITICAL",
  });
}

// Fix per review item C17 (bring not-live categories live, composition-
// only): returns null — not an empty array — when this category has no
// MICRO_LIMITS entry yet, so validateSubmission() below can tell "no
// panel exists for this category" apart from "the panel exists and every
// check passed." An empty array read as a real result used to be
// impossible (every live category had a full MICRO_LIMITS panel); it
// isn't anymore, now that Ghee/Butter is live with composition checks
// only (per your "skip microbiology for now" answer) — see the
// microbiological.status "NOT_AVAILABLE" handling below.
function runMicrobiology(categoryId, lab) {
  const limits = MICRO_LIMITS[categoryId];
  if (!limits) return null;
  const checks = [];
  // Routes by each entry's own `presence` flag, not by which table it's
  // in — Appendix B1's Table 2A is mostly CFU-count organisms, but a few
  // categories (Ghee/Butter's Sr.6, Yogurt/Dahi's Sr.12) list E. coli
  // there as "Absent/g", a presence/absence test like Table 2B's, not a
  // count with an m/M band. Table-2A-vs-2B only decides the citation
  // string below.
  for (const [key, limit] of Object.entries(limits.table_2a)) {
    checks.push(limit.presence
      ? checkMicroPresence(limit.name, lab?.[key], limit, "Appendix B, Table 2A")
      : checkMicroCount(limit.name, lab?.[key], limit, "Appendix B, Table 2A"));
  }
  // Same presence-vs-count routing as Table 2A above — found while
  // smoke-testing the new Dried Ice Cream Mix sub-types (which share
  // Milk Powder's Sr.7 bucket): Milk Powder's own Table 2B carries
  // Bacillus cereus and Sulphite Reducing Clostridia as real CFU counts
  // with m/M bands (500/1000 and 50/100), not presence/absence tests
  // like Salmonella/Listeria — but this loop was running every Table 2B
  // entry through the presence checker unconditionally, so a real count
  // like "400 CFU/g" (well under the 500 acceptable limit) was being
  // read as "Detected" and forced to FAIL. Pre-existing bug in the
  // already-live Milk Powder category, not something introduced by Ice
  // Cream — fixed here since Dried Ice Cream Mix inherits the same bucket.
  for (const [key, limit] of Object.entries(limits.table_2b)) {
    checks.push(limit.presence
      ? checkMicroPresence(limit.name, lab?.[key], limit, "Appendix B, Table 2B")
      : checkMicroCount(limit.name, lab?.[key], limit, "Appendix B, Table 2B"));
  }
  return checks;
}

// ---------------------------------------------------------------
// Labelling
// ---------------------------------------------------------------
// Label-only entry point (persona 2: "I just want my label checked", per
// the founder's request) — a thin wrapper around the same runLabelling()/
// sectionStatus() every full validateSubmission() call already uses, so
// label-check.html's report and a full submission's Labelling card can
// never silently disagree about what "declared" means for a given
// category. Frontend-only: label-check.html has no backend call (same
// as research.html/index.html), so there's no Python mirror to keep in
// sync here — nothing server-side reads this.
export function checkLabelOnly(categoryId, label) {
  const checks = runLabelling(categoryId, label || {});
  return { status: sectionStatus(checks), checks };
}

function runLabelling(categoryId, label) {
  // A checkbox left unticked means "not yet declared" — it hasn't been
  // decided wrong, it just hasn't been finalized (very normal for a
  // product still being formulated, before packaging artwork exists).
  // That's a MISSING check, not a FAIL — see aggregateStatus()/
  // sectionStatus() below for why the distinction matters.
  const elements = [...LABEL_ELEMENTS_ALL, ...(LABEL_ELEMENTS_BY_CATEGORY[categoryId] || [])];
  return elements.map((el) => {
    const declared = !!label?.[el.key];
    return check({
      label: el.label, status: declared ? "PASS" : "MISSING",
      actual: declared ? "Declared" : "Not yet declared", expected: "Declared",
      ref: "Labelling & Display Regs 2020", severity: el.severity,
    });
  });
}

// ---------------------------------------------------------------
// Sub-type key lookup — the one place that knows which input field
// carries "which sub-type", so nothing downstream has to branch on
// categoryId to find it.
// ---------------------------------------------------------------
const SUB_TYPE_INPUT_KEY = { milk: "milk_type", paneer: "paneer_type", cheese: "cheese_type", ghee: "ghee_type", milk_powder: "milk_powder_type", yogurt: "yogurt_type", ice_cream: "ice_cream_type", khoa: "khoa_type", flavoured_milk: "flavoured_milk_type", evaporated_milk: "evaporated_milk_type", sweetened_condensed_milk: "sweetened_condensed_milk_type", cream: "cream_type", dairy_whitener: "dairy_whitener_type", whey_powder: "whey_powder_type", casein_products: "casein_products_type", edible_lactose: "edible_lactose_type", milk_protein_concentrate: "milk_protein_concentrate_type", whey_protein_concentrate: "whey_protein_concentrate_type", colostrum_products: "colostrum_products_type", dairy_permeate_powders: "dairy_permeate_powders_type" };

function specFor(categoryId, input) {
  const subTypeKey = SUB_TYPE_INPUT_KEY[categoryId];
  if (!subTypeKey) return null;
  return DAIRY_PRODUCTS[categoryId]?.[input[subTypeKey]] || null;
}

// ---------------------------------------------------------------
// ONE generic composition runner, for every category/sub-type. Walks
// whatever `fields` the schema declares (see data/dairyBible.js) and
// calls the matching generic check helper above — there is no
// per-category function to keep in sync, and no special case for a
// future bug to get bolted onto (see the skimmed-milk note in
// dairyBible.js for the bug this replaced).
// ---------------------------------------------------------------
function runFieldCheck(field, value) {
  const label = field.reportLabel;
  if (field.rule === "min") return checkMin(label, value, field.min, field.unit, field.ref, field.severity);
  if (field.rule === "max") return checkMax(label, value, field.max, field.unit, field.ref, field.severity);
  // Fix per review item C17 (Ghee/Butter): categorical fields (Baudouin
  // Test, β-sitosterol) — see checkEquals() above.
  if (field.rule === "equals") return checkEquals(label, value, field.equals, field.ref, field.severity);
  return checkBetween(label, value, field.min, field.max, field.unit, field.ref, field.severity);
}

function runFields(fields, specName, input) {
  const checks = [];
  for (const field of fields) {
    const raw = input[field.key];
    const present = raw !== null && raw !== undefined && raw !== "";
    // Optional fields (sodium/urea/lactose/Ghee's quality-factor tests)
    // that were never answered ("skip") don't produce a row at all —
    // that's the existing, deliberate behavior for a test the FBO said
    // they don't have. Required fields always produce a row (MISSING if
    // unanswered).
    if (field.optional && !present) continue;
    const label = field.reportLabel.replace("{name}", specName);
    // "equals" fields carry a string (e.g. "negative"), not a number —
    // Number()-converting them would turn every non-numeric answer into
    // NaN and always read as MISSING.
    const value = present ? (field.rule === "equals" ? raw : Number(raw)) : raw;
    checks.push(runFieldCheck({ ...field, reportLabel: label }, value));
  }
  return checks;
}

// ---------------------------------------------------------------
// Mozzarella — Fix per review item C17 follow-up. Not a simple min/max
// field: FSS 2.1.17's Compositional Standards Table-2 (in force 1 May
// 2025) keys the requirement off Fat-in-Dry-Matter (FDM), computed from
// the FBO's entered fat + moisture, not entered directly. See the long
// comment on DAIRY_PRODUCTS.cheese.mozzarella and the MOZZARELLA_FDM_*
// exports in dairyBible.js for the source table this implements.
// ---------------------------------------------------------------
function runMozzarellaComposition(spec, input) {
  const rawFat = input.fat;
  const rawMoisture = input.moisture;
  const fatPresent = rawFat !== null && rawFat !== undefined && rawFat !== "";
  const moisturePresent = rawMoisture !== null && rawMoisture !== undefined && rawMoisture !== "";
  const moistureType = input.moisture_type === "high_moisture" ? "high_moisture" : "low_moisture";
  const typeLabel = moistureType === "high_moisture" ? "High moisture" : "Low moisture";
  const floor = MOZZARELLA_FDM_FLOOR[moistureType];

  if (!fatPresent || !moisturePresent || Number(rawMoisture) >= 100 || Number.isNaN(Number(rawFat)) || Number.isNaN(Number(rawMoisture))) {
    return [
      check({ label: "Fat in Dry Matter (FDM)", status: "MISSING", actual: "—", expected: `≥ ${floor}% FDM (${typeLabel} Mozzarella)`, ref: spec.ref, severity: "CRITICAL" }),
      check({ label: "Moisture (Mozzarella)", status: "MISSING", actual: "—", expected: "Depends on the FDM band — enter Milk Fat and Moisture to see it", ref: spec.ref, severity: "HIGH" }),
    ];
  }

  const fat = Number(rawFat);
  const moisture = Number(rawMoisture);
  const fdm = (fat / (100 - moisture)) * 100;

  const floorCheck = check({
    label: "Fat in Dry Matter (FDM)",
    status: fdm >= floor ? "PASS" : "FAIL",
    actual: `${fdm.toFixed(1)}%`, expected: `≥ ${floor}% FDM (${typeLabel} Mozzarella)`,
    ref: spec.ref, severity: "CRITICAL",
  });

  const band = MOZZARELLA_FDM_BANDS.find((b) => fdm >= b.minFdm && fdm < b.maxFdm);
  if (!band) {
    return [floorCheck, check({
      label: "Moisture (Mozzarella)", status: "MISSING", actual: `${moisture}%`,
      expected: "FDM is outside the Compositional Standards Table-2 range (18–85%) — double-check the entered fat/moisture",
      ref: spec.ref, severity: "HIGH",
    })];
  }
  const minDryMatter = moistureType === "high_moisture" ? band.highDM : band.lowDM;
  const maxMoisture = 100 - minDryMatter;
  const qualifierNote = band.qualifier ? ` — ${band.qualifier} classification` : "";
  const moistureCheck = check({
    label: "Moisture (Mozzarella)",
    status: moisture <= maxMoisture ? "PASS" : "FAIL",
    actual: `${moisture}%`, expected: `≤ ${maxMoisture.toFixed(1)}% (min dry matter ${minDryMatter}%${qualifierNote})`,
    ref: spec.ref, severity: "HIGH",
  });
  return [floorCheck, moistureCheck];
}

// Milk cross-reference — originally built for Plain Dahi (Fix per review
// item C17, Yogurt/Dahi): FSS 2.1.13, Item 2(c)(iii) says Plain Dahi's
// own Milk Fat/SNF minimums ARE whichever milk it's made from — so this
// reuses DAIRY_PRODUCTS.milk's already-sourced numbers instead of
// duplicating them, per your "cross-reference Milk live" sign-off. Any
// other sub-type's own baseline fields (e.g. Dahi's Fermented Milk
// protein/acidity minimums, Item 2(c)(ii)) still apply and are ordinary
// `fields` on its spec, run through the normal runFields() path here.
//
// Generalized (renamed from runDahiComposition()/"dahi_milk_cross_
// reference") when Flavoured Milk (FSS 2.1.3) turned out to need the
// EXACT same mechanism — Item 2(c): "Flavoured Milk shall have the same
// minimum percentage of milk fat and milk solids-not-fat as that of the
// milk... from which it is prepared." The function itself needed no
// logic change at all, only a category-neutral name and MISSING-case
// message — it was already generic. See the long comment on
// DAIRY_PRODUCTS.yogurt.plain_dahi and DAIRY_PRODUCTS.flavoured_milk in
// dairyBible.js for the full reasoning on each.
function runMilkCrossReferenceComposition(spec, input) {
  const generalChecks = runFields(spec.fields, spec.name, input);
  const milkSpec = DAIRY_PRODUCTS.milk[input.milk_type];
  if (!milkSpec) {
    return [
      ...generalChecks,
      check({ label: "Milk Fat (same as source milk)", status: "MISSING", actual: "—", expected: "Select which milk this product was made from", ref: spec.ref, severity: "CRITICAL" }),
      check({ label: "SNF (same as source milk)", status: "MISSING", actual: "—", expected: "Select which milk this product was made from", ref: spec.ref, severity: "CRITICAL" }),
    ];
  }
  const milkFields = milkSpec.fields.filter((f) => f.key === "fat" || f.key === "snf");
  const milkChecks = runFields(milkFields, milkSpec.name, input);
  return [...generalChecks, ...milkChecks];
}

function runComposition(categoryId, input) {
  const spec = specFor(categoryId, input);
  if (!spec) return [];
  if (spec.computed === "mozzarella_fdm") {
    return runMozzarellaComposition(spec, input);
  }
  if (spec.computed === "milk_cross_reference") {
    return runMilkCrossReferenceComposition(spec, input);
  }
  const checks = runFields(spec.fields, spec.name, input);
  if (categoryId === "milk") {
    checks.push(...runFields(MILK_CATEGORY_FIELDS, spec.name, input));
  }
  return checks;
}

// ---------------------------------------------------------------
// Shelf life — milk's is driven by the FBO's chosen heat treatment
// (a processing decision, not a property of the milk type), so it
// stays its own lookup. Paneer and cheese both read a static
// `shelfLife` straight off the matched sub-type's schema entry — one
// shared path instead of two category-specific branches.
// ---------------------------------------------------------------
function calculateShelfLife(categoryId, input) {
  if (categoryId === "milk") {
    const ht = HEAT_TREATMENTS[input.heat_treatment];
    if (!ht) return { days: null, storage_temp: "—", note: "Select a heat treatment to estimate shelf life." };
    return { days: ht.shelf_days, storage_temp: ht.storage_temp, note: null };
  }
  const spec = specFor(categoryId, input);
  if (!spec || !spec.shelfLife) return { days: null, storage_temp: "—", note: null };
  return {
    days: spec.shelfLife.days, storage_temp: spec.shelfLife.storageTemp,
    note: "Estimated — confirm with your own shelf-life study.",
  };
}

// ---------------------------------------------------------------
// Status aggregation — Dairy Bible §12.2 escalation matrix
//
// FAIL is reserved for something that was actually tested/declared and
// came back non-compliant. A MISSING check — a lab test not yet run, a
// label element not yet finalized — means "not done yet," not "wrong."
// Treating the two the same used to mean any in-progress draft (no lab
// report yet, no finished label art yet — the normal state for a
// product still being formulated) got the same alarming red "FAIL / do
// not release this batch" verdict as a real, tested non-compliance.
// MISSING critical items still push the result to WARNING — they're
// real outstanding work — but only an actual FAIL (or a genuine test
// result) escalates to the release-blocking FAIL banner.
// ---------------------------------------------------------------
function aggregateStatus(allChecks) {
  const failed = allChecks.filter((c) => c.status === "FAIL");
  const missing = allChecks.filter((c) => c.status === "MISSING");
  const criticalFailures = failed.filter((c) => c.severity === "CRITICAL");
  const highFailures = failed.filter((c) => c.severity === "HIGH");

  if (criticalFailures.length > 0 || highFailures.length >= 3) {
    return "FAIL";
  }
  if (highFailures.length > 0 || missing.length > 0 || allChecks.some((c) => c.status === "WARNING")) {
    return "WARNING";
  }
  return "PASS";
}

function sectionStatus(checks) {
  if (checks.some((c) => c.status === "FAIL")) return "FAIL";
  if (checks.some((c) => c.status === "WARNING" || c.status === "MISSING")) return "WARNING";
  return "PASS";
}

// ---------------------------------------------------------------
// Formulation Lab scoring — how close a *planned* formulation is to
// compliant, using only the numbers the FBO has entered themselves. No
// lab report exists at this stage, so only composition checks run (see
// PLATFORM_PLAN_V2.md §2.5). Severity-weighted pass rate, 0-100.
// ---------------------------------------------------------------
const SCORE_WEIGHT = { CRITICAL: 3, HIGH: 2, MEDIUM: 1, LOW: 1 };

export function scoreFormulation(categoryId, input) {
  const checks = runComposition(categoryId, input);

  if (checks.length === 0) {
    return { score: 0, gapSummary: [{ label: "Product type", issue: "Select a valid product sub-type to score this iteration." }] };
  }

  const totalWeight = checks.reduce((sum, c) => sum + (SCORE_WEIGHT[c.severity] ?? 1), 0);
  const passedWeight = checks
    .filter((c) => c.status === "PASS")
    .reduce((sum, c) => sum + (SCORE_WEIGHT[c.severity] ?? 1), 0);
  const score = totalWeight ? Math.round((passedWeight / totalWeight) * 100) : 0;

  const gapSummary = checks
    .filter((c) => c.status !== "PASS")
    .map((c) => ({ label: c.label, issue: `${c.actual} — needs ${c.expected}`, severity: c.severity, ref: c.ref }));

  return { score, gapSummary };
}

// ---------------------------------------------------------------
// Main entry point
// `hasLabReport` gates anything that would otherwise require a
// fabricated number: the populated nutrition panel and claims
// validation both require a real, uploaded NABL test report — see
// PLATFORM_PLAN_V2.md §2.6, "no fabrication" rule.
// ---------------------------------------------------------------
export function validateSubmission(categoryId, input, hasLabReport = false) {
  const compositionChecks = runComposition(categoryId, input);

  // Fix alongside review items A11-A16 (Processed Cheese microbiology
  // exception, Part II Ch 6.2): most sub-types check against
  // MICRO_LIMITS[categoryId] directly, but a sub-type can declare its
  // own `microKey` (see DAIRY_PRODUCTS.cheese.processed_cheese) to be
  // checked against a different, stricter panel instead. Falls back to
  // categoryId when no override is set or no sub-type is matched yet.
  const spec = specFor(categoryId, input);
  const microCategoryId = spec?.microKey || categoryId;
  // Fix per review item C17: null (not []) means no microbiology panel is
  // compiled for this category yet — see runMicrobiology()'s own comment.
  const microChecksRaw = runMicrobiology(microCategoryId, input.lab || {});
  const microAvailable = microChecksRaw !== null;
  const microChecks = microChecksRaw || [];
  const labelChecks = runLabelling(categoryId, input.label || {});
  const shelfLife = calculateShelfLife(categoryId, input);

  const nutritionPanel = hasLabReport
    ? { status: "AVAILABLE", note: "Populated from the uploaded NABL lab report." }
    : { status: "TEMPLATE_ONLY", note: "Structure only (serving size, RDA%, layout) — upload a NABL lab report to see real values. Numbers are never estimated from your entered figures." };

  const claims = hasLabReport
    ? { status: "NOT_YET_IMPLEMENTED", checks: [], note: "Claims validation (Schedule I thresholds, prohibited claims) is not yet built into this engine — the lab report requirement is enforced, but the check itself needs the Advertising & Claims regulatory data compiled and signed off first." }
    : { status: "NOT_CHECKED", checks: [], note: "Claims validation requires an uploaded NABL lab report to back any claim — none was provided." };

  const allChecks = [...compositionChecks, ...microChecks, ...labelChecks];
  const overall = aggregateStatus(allChecks);

  const violations = allChecks
    .filter((c) => c.status === "FAIL" || c.status === "WARNING" || c.status === "MISSING")
    .map((c) => ({
      severity: c.severity,
      status: c.status,
      message: `${c.label}: ${c.actual} (expected ${c.expected})`,
      ref: c.ref,
    }))
    .sort((a, b) => {
      const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
      return (order[a.severity] ?? 9) - (order[b.severity] ?? 9);
    });

  // Fix per review item C17: a category without a compiled microbiology
  // panel gets its own explicit "NOT_AVAILABLE" section status (see
  // report.js's STATUS_META/sectionCard) rather than sectionStatus([])'s
  // default "PASS" — zero checks run is not the same thing as zero
  // checks failed, and this app's whole premise is never implying
  // something was verified that wasn't.
  const extraNotes = [];
  if (categoryId === "cheese") extraNotes.push(CHEESE_COMMON_RULE);
  if (!microAvailable) {
    extraNotes.push("Microbiology limits for this category haven't been compiled into Inspeckt yet — this report covers composition and labelling only. Verify microbiology separately against FSSAI's Appendix B before release.");
  }

  return {
    category: categoryId,
    generated_at: new Date().toISOString(),
    overall_status: overall,
    composition: { status: sectionStatus(compositionChecks), checks: compositionChecks },
    microbiological: microAvailable
      ? { status: sectionStatus(microChecks), checks: microChecks }
      : { status: "NOT_AVAILABLE", checks: [], note: "Microbiology limits for this category haven't been compiled into Inspeckt yet." },
    labelling: { status: sectionStatus(labelChecks), checks: labelChecks },
    nutrition_panel: nutritionPanel,
    claims,
    shelf_life: shelfLife,
    violations,
    disclaimer: REPORT_DISCLAIMER,
    extra_notes: extraNotes,
  };
}

// ---------------------------------------------------------------
// Generic, schema-driven text for the Regulatory Brief and the live
// chat hints. Both used to be hand-written per category (a fourth and
// fifth place composition numbers could drift from the schema, on top
// of the three runXComposition() functions) — now both are one small
// function each, reading the exact same `fields` the checks run
// against, for every category.
// ---------------------------------------------------------------
function fieldThreshold(field) {
  if (field.rule === "min") return `≥ ${field.min}${field.unit}`;
  if (field.rule === "max") return `≤ ${field.max}${field.unit}`;
  if (field.rule === "equals") return titleCase(field.equals);
  return `${field.min}–${field.max}${field.unit}`;
}

/** One <li> per field, for the Regulatory Brief's Composition list. */
export function fieldBriefBullets(categoryId, subTypeId) {
  const spec = DAIRY_PRODUCTS[categoryId]?.[subTypeId];
  if (!spec) return [];
  const bullets = spec.fields.map(
    (f) => `${f.shortLabel}: ${fieldThreshold(f)} — ${f.ref}`
  );
  if (categoryId === "milk") {
    bullets.push(...MILK_CATEGORY_FIELDS.map((f) => `${f.shortLabel}: ${fieldThreshold(f)} — ${f.ref}`));
  }
  // Plain Dahi's (and Flavoured Milk's) Fat/SNF aren't declared as their
  // own `fields` (see the long comment on DAIRY_PRODUCTS.yogurt.
  // plain_dahi / DAIRY_PRODUCTS.flavoured_milk in dairyBible.js) — note
  // the cross-reference rule explicitly so the Regulatory Brief doesn't
  // silently look like either has no Fat/SNF requirement at all. Not
  // using extraBriefNotes for this: those bullets are always prefixed
  // "Label must declare: ", which would be semantically wrong for a
  // composition rule (same reasoning as Ghee's fatty-acid gap).
  if (spec.computed === "milk_cross_reference") {
    bullets.push(`Milk Fat & SNF: same minimum as whichever milk it's made from — ${spec.ref}`);
  }
  if (spec.extraBriefNotes) {
    bullets.push(...spec.extraBriefNotes.map((n) => `Label must declare: ${n}`));
  }
  return bullets;
}

/** Live-typing hint shown while the FBO answers a composition
 * question in chat — "Buffalo Milk requires Milk Fat ≥ 5.0% — ref." */
export function fieldHintText(categoryId, subTypeId, fieldKey) {
  const spec = DAIRY_PRODUCTS[categoryId]?.[subTypeId];
  if (!spec) return "";
  const field = spec.fields.find((f) => f.key === fieldKey)
    || (categoryId === "milk" ? MILK_CATEGORY_FIELDS.find((f) => f.key === fieldKey) : null);
  if (!field) return "";
  const verb = field.rule === "max" ? "allows" : "requires";
  return `${spec.name} ${verb} ${field.shortLabel} ${fieldThreshold(field)} — ${field.ref}.`;
}
