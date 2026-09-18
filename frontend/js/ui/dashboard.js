import {
  CATEGORIES, MILK_TYPES, HEAT_TREATMENTS, PANEER_TYPES, CHEESE_TYPES, GHEE_TYPES, MILK_POWDER_TYPES, YOGURT_TYPES,
  ICE_CREAM_TYPES, KHOA_TYPES, FLAVOURED_MILK_TYPES, EVAPORATED_MILK_TYPES, SWEETENED_CONDENSED_MILK_TYPES,
  CREAM_TYPES, DAIRY_WHITENER_TYPES, WHEY_POWDER_TYPES, CASEIN_PRODUCTS_TYPES, EDIBLE_LACTOSE_TYPES,
  MILK_PROTEIN_CONCENTRATE_TYPES, WHEY_PROTEIN_CONCENTRATE_TYPES, COLOSTRUM_PRODUCTS_TYPES,
  DAIRY_PERMEATE_POWDERS_TYPES,
  MICRO_LIMITS, LABEL_ELEMENTS_ALL, LABEL_ELEMENTS_BY_CATEGORY, DAIRY_PRODUCTS, unionMicroLimits,
} from "../data/dairyBible.js";
import { PRICING_TIERS, poolAllowance } from "../data/pricing.js";
import { getCurrentUser, logout } from "../auth.js";
import { saveSubmission, poolUsed, listSubmissions, getSubmission, submissionsStorageError } from "../storage.js";
import {
  listProducts, listIterationsForProduct, saveIteration, deleteIteration,
} from "../formulations.js";
// Fix per your "the dashboard needs to have everything... if they checked
// labels or they are talking to a consultant" feedback: pull in the two
// other places a person's activity was previously invisible on this page.
import { listLabelChecks } from "../labelChecks.js";
import { listLeadsForUser } from "../leads.js";
import { renderReport, statusBadge } from "./report.js";
import { icon, hydrateIcons } from "../icons.js";

// ---------------------------------------------------------------
// Auth guard
// ---------------------------------------------------------------
const user = getCurrentUser();
if (!user) {
  window.location.replace("login.html");
}

const mainArea = document.getElementById("main-area");
let currentCategory = null;

function initials(name) {
  return (name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";
}

function initChrome() {
  hydrateIcons();
  document.getElementById("user-avatar").textContent = initials(user.name);
  document.getElementById("user-name").textContent = user.name || user.email;
  const tierLabel = user.tier ? PRICING_TIERS.find((t) => t.id === user.tier)?.label : null;
  document.getElementById("user-company").textContent = tierLabel ? `${user.company || "—"} · ${tierLabel} plan` : (user.company || "—");
  document.getElementById("logout-btn").addEventListener("click", () => {
    logout();
    window.location.href = "index.html";
  });
  document.querySelectorAll(".side-link").forEach((btn) => {
    btn.addEventListener("click", () => { window.location.hash = `#/${btn.dataset.route}`; });
  });
}

function setActiveNav(route) {
  document.querySelectorAll(".side-link").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.route === route);
  });
}

// ---------------------------------------------------------------
// Field builders — small helpers to keep the form markup readable
// ---------------------------------------------------------------
function selectField(id, label, options, hint) {
  return `
    <div class="field">
      <label for="${id}">${label}</label>
      <select id="${id}">
        <option value="">Select…</option>
        ${options.map(([val, text]) => `<option value="${val}">${text}</option>`).join("")}
      </select>
      ${hint ? `<span class="hint">${hint}</span>` : ""}
    </div>`;
}

function numberField(id, label, { hint = "", optional = false, step = "0.01" } = {}) {
  return `
    <div class="field">
      <label for="${id}">${label}${optional ? ' <span class="muted">(optional)</span>' : ""}</label>
      <input id="${id}" type="number" step="${step}" inputmode="decimal" placeholder="0.00" />
      ${hint ? `<span class="hint">${hint}</span>` : ""}
    </div>`;
}

// Fix per review item C12: plain-text field helper (batch/lot number is
// alphanumeric, e.g. "LOT-2026-08-114" — a number input would reject it).
function textField(id, label, { hint = "", optional = false } = {}) {
  return `
    <div class="field">
      <label for="${id}">${label}${optional ? ' <span class="muted">(optional)</span>' : ""}</label>
      <input id="${id}" type="text" autocomplete="off" />
      ${hint ? `<span class="hint">${hint}</span>` : ""}
    </div>`;
}

function presenceField(id, label, hint) {
  return `
    <div class="field">
      <label for="${id}">${label}</label>
      <select id="${id}">
        <option value="">Not tested</option>
        <option value="absent">Absent (tested, not detected)</option>
        <option value="detected">Detected</option>
      </select>
      ${hint ? `<span class="hint">${hint}</span>` : ""}
    </div>`;
}

function labelCheckbox(id, text) {
  return `
    <div class="checkbox-row">
      <input type="checkbox" id="${id}" />
      <label for="${id}">${text}</label>
    </div>`;
}

// ---------------------------------------------------------------
// Composition sections per category
// ---------------------------------------------------------------
function compositionSection(categoryId) {
  if (categoryId === "milk") {
    const opts = Object.entries(DAIRY_PRODUCTS.milk).map(([k, v]) => {
      const fat = v.fields.find((f) => f.key === "fat");
      const snf = v.fields.find((f) => f.key === "snf");
      const fatText = fat.rule === "between" ? `${fat.min}–${fat.max}%` : `${fat.rule === "min" ? "≥" : "≤"} ${fat.rule === "min" ? fat.min : fat.max}%`;
      return [k, `${v.name} (fat ${fatText}, SNF ≥ ${snf.min}%)`];
    });
    return `
      ${selectField("f-milk_type", "Milk type", opts)}
      <div class="form-grid">
        ${numberField("f-fat", "Milk Fat (%)")}
        ${numberField("f-snf", "SNF (%)")}
      </div>
      <div class="form-grid">
        ${numberField("f-sodium", "Sodium (mg/100g SNF)", { optional: true, step: "1" })}
        ${numberField("f-urea", "Urea (ppm)", { optional: true, step: "1" })}
      </div>
      ${selectField("f-heat_treatment", "Heat treatment", Object.entries(HEAT_TREATMENTS).map(([k, v]) => [k, v.name]),
        "Drives the shelf-life recommendation.")}
    `;
  }
  if (categoryId === "paneer") {
    const opts = Object.entries(PANEER_TYPES).map(([k, v]) => [k, v.name]);
    return `
      ${selectField("f-paneer_type", "Paneer type", opts)}
      <div class="form-grid">
        ${numberField("f-moisture", "Moisture (%)")}
        ${numberField("f-fat", "Milk Fat, dry basis (%)")}
      </div>
    `;
  }
  if (categoryId === "cheese") {
    const opts = Object.entries(CHEESE_TYPES).map(([k, v]) => [k, v.name]);
    // Fix per review item C17 follow-up. Two fields below only apply to
    // some cheese types, but this section renders once before the
    // dropdown is picked — same known gap already flagged for the
    // Processed Cheese microbiology hint above: values are simply
    // ignored by validateSubmission() for a cheese_type whose schema
    // doesn't declare that field.
    //  - Moisture type: only Mozzarella's FDM-table check
    //    (DAIRY_PRODUCTS.cheese.mozzarella, `computed: "mozzarella_fdm"`)
    //    reads this; every other cheese type ignores it.
    //  - Lactose (%): back after being removed for lack of a source —
    //    see the field's own comment in dairyBible.js. Only Processed
    //    Cheese's schema declares a `lactose` field.
    return `
      ${selectField("f-cheese_type", "Cheese type", opts)}
      ${selectField("f-cheese_moisture_type", "Moisture type (Mozzarella only)",
        [["low_moisture", "Low moisture"], ["high_moisture", "High moisture"]],
        "Only used when Cheese type = Mozzarella; ignored for every other cheese type.")}
      <div class="form-grid">
        ${numberField("f-moisture", "Moisture (%)")}
        ${numberField("f-fat", "Milk Fat (%)", { hint: "Dry basis for most types — see the FSSAI reference for your selected type." })}
        ${numberField("f-lactose", "Lactose (%)", { optional: true, hint: "Processed Cheese only (FSS 2.1.17) — leave blank for other cheese types." })}
      </div>
    `;
  }
  // Fix per review item C17 (bring not-live categories live, composition-
  // only): renders once before the Product type dropdown is picked, same
  // known limitation already flagged above for cheese — every field here
  // is shown for every Ghee/Butter product type, and validateSubmission()
  // simply ignores whichever ones the matched sub-type's schema doesn't
  // declare (see DAIRY_PRODUCTS.ghee in dairyBible.js for which fields
  // apply to which of the 5 product types). Moisture/Milk Fat are the
  // only fields required by every type; everything else is `optional`
  // and marked so in its hint.
  if (categoryId === "ghee") {
    const opts = Object.entries(GHEE_TYPES).map(([k, v]) => [k, v.name]);
    return `
      ${selectField("f-ghee_type", "Product type", opts)}
      <div class="form-grid">
        ${numberField("f-moisture", "Moisture (%)")}
        ${numberField("f-fat", "Milk Fat (%)")}
      </div>
      <p class="muted" style="font-size: var(--text-sm); margin: var(--space-3) 0">Quality-factor tests below (FSS 2.1.8/2.1.9) — fill in whichever you have lab results for and leave the rest blank; which ones apply depends on the product type selected above.</p>
      <div class="form-grid">
        ${numberField("f-br_reading", "Butyro-refractometer Reading at 40°C", { optional: true, hint: "Milk Fat/Butter Oil, Anhydrous Milk Fat/Butter Oil, Ghee, and Butter's extracted fat." })}
        ${numberField("f-rm_value", "Reichert Meissl Value", { optional: true, hint: "Milk Fat/Butter Oil, Anhydrous Milk Fat/Butter Oil, Ghee, and Butter's extracted fat." })}
        ${numberField("f-polenske_value", "Polenske Value", { optional: true, hint: "Milk Fat/Butter Oil, Anhydrous Milk Fat/Butter Oil, and Ghee only." })}
        ${numberField("f-ffa", "FFA as Oleic Acid (%)", { optional: true, hint: "Milk Fat/Butter Oil, Anhydrous Milk Fat/Butter Oil, and Ghee only." })}
        ${numberField("f-peroxide_value", "Peroxide Value (meq O2/kg fat)", { optional: true, hint: "Milk Fat/Butter Oil and Anhydrous Milk Fat/Butter Oil only — not specified for Ghee." })}
        ${numberField("f-iodine_value", "Iodine Value", { optional: true, hint: "Ghee only." })}
        ${numberField("f-saponification_value", "Saponification Value", { optional: true, hint: "Ghee only." })}
        ${numberField("f-msnf", "Milk Solids-Not-Fat (%)", { optional: true, hint: "Table Butter only." })}
        ${numberField("f-common_salt", "Common Salt (%)", { optional: true, hint: "Table Butter only." })}
      </div>
      <div class="form-grid">
        ${selectField("f-baudouin_test", "Baudouin Test (vegetable-oil adulteration)",
          [["negative", "Negative"], ["positive", "Positive"]],
          "Milk Fat/Butter Oil, Anhydrous Milk Fat/Butter Oil, and Ghee only — leave unselected if not tested.")}
        ${selectField("f-beta_sitosterol", "Presence of β-sitosterol (vegetable-oil adulteration)",
          [["absent", "Absent"], ["present", "Present"]],
          "Milk Fat/Butter Oil, Anhydrous Milk Fat/Butter Oil, and Ghee only — leave unselected if not tested.")}
      </div>
    `;
  }
  // Fix per review item C17 (bring not-live categories live, composition-
  // only): renders once before Product type is picked, same known
  // limitation flagged above — Titrable Acidity/Insolubility Index/Total
  // Ash don't apply to Cream Powder (its schema doesn't declare them),
  // so validateSubmission() simply ignores whatever's entered there.
  if (categoryId === "milk_powder") {
    const opts = Object.entries(MILK_POWDER_TYPES).map(([k, v]) => [k, v.name]);
    return `
      ${selectField("f-milk_powder_type", "Product type", opts)}
      <div class="form-grid">
        ${numberField("f-moisture", "Moisture (%)")}
        ${numberField("f-fat", "Milk Fat (%)")}
        ${numberField("f-protein_snf", "Milk Protein, in SNF (%)")}
      </div>
      <div class="form-grid">
        ${numberField("f-titrable_acidity", "Titrable Acidity (ml 0.1N NaOH/10g SNF)", { hint: "Not applicable to Cream Powder." })}
        ${numberField("f-insolubility_index", "Insolubility Index (ml)", { hint: "Not applicable to Cream Powder." })}
        ${numberField("f-total_ash", "Total Ash, moisture & fat free basis (%)", { hint: "Not applicable to Cream Powder." })}
        ${numberField("f-sodium", "Sodium (mg/100g SNF)", { optional: true, step: "1" })}
      </div>
    `;
  }
  // Fix per review item C17 (bring not-live categories live, composition-
  // only): renders once before Product type is picked, same known
  // limitation flagged above — a field only checked for some Yogurt/Dahi
  // product types (e.g. Sugar only applies to Shrikhand) is simply
  // ignored by validateSubmission() for a type whose schema doesn't
  // declare it. Plain Dahi is architecturally different from every other
  // type here: its own Milk Fat/SNF minimums are whichever milk it's
  // made from (FSS 2.1.13, Item 2(c)(iii)), not a fixed number, so it
  // reuses the Milk Fat field above plus its own "which milk" selector
  // and SNF field below — see DAIRY_PRODUCTS.yogurt.plain_dahi's long
  // comment in dairyBible.js, and runDahiComposition() in validation.js.
  if (categoryId === "yogurt") {
    const opts = Object.entries(YOGURT_TYPES).map(([k, v]) => [k, v.name]);
    const milkOpts = Object.entries(MILK_TYPES).map(([k, v]) => [k, v.name]);
    return `
      ${selectField("f-yogurt_type", "Product type", opts)}
      ${selectField("f-milk_type", "If Plain Dahi: which milk was it made from?", milkOpts,
        "Only used for Plain Dahi — FSSAI requires Plain Dahi to meet that same milk's own Fat/SNF minimums. Ignored for every other type above.")}
      <div class="form-grid">
        ${numberField("f-fat", "Milk Fat (%)", { hint: "Dry basis for Chakka/Shrikhand types — see the FSSAI reference for your selected type. For Plain Dahi, checked against the milk type picked above." })}
        ${numberField("f-snf", "SNF (Solids-Not-Fat) (%)", { optional: true, hint: "Plain Dahi only — checked against the milk type picked above." })}
        ${numberField("f-msnf", "Milk Solids-Not-Fat (MSNF) (%)", { optional: true, hint: "Yoghurt / Flavoured Dahi types only." })}
        ${numberField("f-protein", "Milk Protein (%)", { hint: "Dry basis for Chakka/Shrikhand types." })}
        ${numberField("f-titratable_acidity", "Titratable Acidity (% as lactic acid)", { hint: "Minimum for Dahi/Yoghurt types, maximum for Chakka/Shrikhand types." })}
      </div>
      <div class="form-grid">
        ${numberField("f-total_solids", "Total Solids (%)", { optional: true, hint: "Chakka/Shrikhand types only." })}
        ${numberField("f-total_ash", "Total Ash (%, dry basis)", { optional: true, hint: "Chakka/Shrikhand types only." })}
        ${numberField("f-sugar", "Sugar / Sucrose (%, dry basis)", { optional: true, hint: "Shrikhand types only." })}
        ${numberField("f-fermented_milk_content", "Fermented Milk Content (%)", { optional: true, hint: "Drinks based on Fermented Milk (lassi/chhaas/buttermilk) only." })}
      </div>
    `;
  }
  // Ice Cream/Frozen Dessert — same known limitation as every other
  // multi-sub-type category above: a field only checked for some
  // sub-types (e.g. Weight doesn't apply to Milk Ice/Milk Lolly; Moisture
  // only applies to the 6 Dried Mix sub-types) is simply ignored by
  // validateSubmission() for a type whose schema doesn't declare it.
  if (categoryId === "ice_cream") {
    const opts = Object.entries(ICE_CREAM_TYPES).map(([k, v]) => [k, v.name]);
    return `
      ${selectField("f-ice_cream_type", "Product type", opts)}
      <div class="form-grid">
        ${numberField("f-total_solids", "Total Solids (%)")}
        ${numberField("f-weight", "Weight (g/l)", { optional: true, hint: "Not applicable to Milk Ice/Milk Lolly or any Dried Mix type." })}
        ${numberField("f-fat", "Milk Fat / Total Fat (%)", { hint: "\"Total Fat\" for Frozen Dessert types (may be vegetable oil/fat); \"Milk Fat\" for Ice Cream types. Checked post-reconstitution for Dried Mix types." })}
        ${numberField("f-protein", "Milk Protein / Protein (%)")}
        ${numberField("f-moisture", "Moisture (%)", { optional: true, hint: "Dried Mix types only — the dry powder's own moisture ceiling." })}
      </div>
    `;
  }
  // Khoa / Mawa — new category, fixed per your "khoa and mawa fixed now,
  // complete fix" go-ahead: FSS 2.1.6 was never encoded anywhere in this
  // app before (see DAIRY_PRODUCTS.khoa in dairyBible.js). Only one
  // product type exists under this standard, so the dropdown always
  // resolves to the same single option — kept for architectural
  // consistency with every other category rather than a hand-rolled
  // no-selector path.
  if (categoryId === "khoa") {
    const opts = Object.entries(KHOA_TYPES).map(([k, v]) => [k, v.name]);
    return `
      ${selectField("f-khoa_type", "Product type", opts)}
      <div class="form-grid">
        ${numberField("f-total_solids", "Total Solids (%)")}
        ${numberField("f-fat", "Milk Fat, dry matter basis (%)")}
        ${numberField("f-total_ash", "Total Ash (%)")}
        ${numberField("f-titratable_acidity", "Titratable Acidity, as % lactic acid (%)")}
      </div>
      <p class="muted" style="font-size: var(--text-sm); margin: var(--space-3) 0">Extracted-fat quality tests below (FSS 2.1.6, Note — must meet Ghee's own standards) — fill in whichever you have lab results for and leave the rest blank.</p>
      <div class="form-grid">
        ${numberField("f-rm_value", "Reichert Meissl Value", { optional: true, hint: "Extracted fat must meet Ghee's Reichert Meissl Value standard." })}
        ${numberField("f-polenske_value", "Polenske Value", { optional: true, hint: "Extracted fat must meet Ghee's Polenske Value standard." })}
        ${numberField("f-br_reading", "Butyro-refractometer Reading at 40°C", { optional: true, hint: "Extracted fat must meet Ghee's Butyro-refractometer Reading standard." })}
      </div>
    `;
  }
  // Flavoured Milk — new category, built per your "you can start
  // building on it" go-ahead (FSS 2.1.3 was never encoded anywhere in
  // this app before). Architecturally identical to Plain Dahi (see the
  // "yogurt" branch above): the ONLY sub-type in this category always
  // cross-references its Fat/SNF minimums live from whichever milk it's
  // made from (FSS 2.1.3, Item 2(c)) — see DAIRY_PRODUCTS.flavoured_milk
  // in dairyBible.js and runMilkCrossReferenceComposition() in
  // validation.js. Unlike Plain Dahi's conditional milk-type hint ("If
  // Plain Dahi..."), this category has only one product, so the
  // selector always applies — no "ignored for every other type" caveat
  // is needed.
  if (categoryId === "flavoured_milk") {
    const opts = Object.entries(FLAVOURED_MILK_TYPES).map(([k, v]) => [k, v.name]);
    const milkOpts = Object.entries(MILK_TYPES).map(([k, v]) => [k, v.name]);
    return `
      ${selectField("f-flavoured_milk_type", "Product type", opts)}
      ${selectField("f-milk_type", "Which milk was it made from?", milkOpts,
        "FSSAI requires Flavoured Milk to meet that same milk's own Fat/SNF minimums (FSS 2.1.3, Item 2(c)).")}
      <div class="form-grid">
        ${numberField("f-fat", "Milk Fat (%)", { hint: "Checked against the milk type picked above." })}
        ${numberField("f-snf", "SNF (Solids-Not-Fat) (%)", { hint: "Checked against the milk type picked above." })}
      </div>
    `;
  }
  // Evaporated / Concentrated Milk — new category, built per your "you
  // can start building on it" go-ahead (FSS 2.1.4 was never encoded
  // anywhere in this app before). Composition-only — Appendix B1 Sr.3
  // reads "NA" across every numeric CFU column for this product, see
  // DAIRY_PRODUCTS.evaporated_milk in dairyBible.js.
  if (categoryId === "evaporated_milk") {
    const opts = Object.entries(EVAPORATED_MILK_TYPES).map(([k, v]) => [k, v.name]);
    return `
      ${selectField("f-evaporated_milk_type", "Product type", opts)}
      <div class="form-grid">
        ${numberField("f-fat", "Milk Fat (%)", { hint: "Minimum for Evaporated Milk/High Fat Milk; maximum for Evaporated Skimmed Milk; a range for Evaporated Partly Skimmed Milk." })}
        ${numberField("f-milk_solids", "Milk Solids (%)")}
        ${numberField("f-protein_snf", "Milk Protein in Milk Solids-Not-Fat (%)")}
      </div>
    `;
  }
  // Sweetened Condensed Milk — new category, built per your "you can
  // start building on it" go-ahead (FSS 2.1.5 was never encoded anywhere
  // in this app before). The source table gives EITHER Milk Solids OR
  // Milk Solids-Not-Fat per tier, never both — Milk Solids is optional
  // here since Sweetened Condensed High Fat Milk has no stated minimum
  // for it ("--" in the source), and MSNF is optional since the plain
  // and Skimmed tiers have no stated minimum for it either; each
  // produces no check row at all for a sub-type whose own schema entry
  // doesn't declare that field, same union-of-fields treatment as every
  // other multi-sub-type category.
  if (categoryId === "sweetened_condensed_milk") {
    const opts = Object.entries(SWEETENED_CONDENSED_MILK_TYPES).map(([k, v]) => [k, v.name]);
    return `
      ${selectField("f-sweetened_condensed_milk_type", "Product type", opts)}
      <div class="form-grid">
        ${numberField("f-fat", "Milk Fat (%)", { hint: "Minimum for Sweetened Condensed Milk/High Fat Milk; maximum for Sweetened Condensed Skimmed Milk; a range for Sweetened Condensed Partly Skimmed Milk." })}
        ${numberField("f-milk_solids", "Milk Solids (%)", { optional: true, hint: "Not applicable to Sweetened Condensed High Fat Milk." })}
        ${numberField("f-msnf", "Milk Solids-Not-Fat (%)", { optional: true, hint: "Only stated for Sweetened Condensed Partly Skimmed Milk and High Fat Milk." })}
        ${numberField("f-protein_snf", "Milk Protein in Milk Solids-Not-Fat (%)")}
      </div>
    `;
  }
  // Cream and Malai — new category, built per your "you can start
  // building on it" go-ahead (FSS 2.1.7 was never encoded anywhere in
  // this app before). Unlike every prior multi-sub-type category, both
  // Cream and Malai share the exact same single composition rule (Milk
  // Fat min 10.0%) — see the long comment on DAIRY_PRODUCTS.cream in
  // dairyBible.js for why the Low/Medium/High Fat Cream labelling bands
  // aren't encoded as extra sub-types here. Acidity is optional since
  // it doesn't apply to fermented/cultured/sour or acidified cream.
  if (categoryId === "cream") {
    const opts = Object.entries(CREAM_TYPES).map(([k, v]) => [k, v.name]);
    return `
      ${selectField("f-cream_type", "Product type", opts)}
      <div class="form-grid">
        ${numberField("f-fat", "Milk Fat (%)", { hint: "Minimum 10.0% for both Cream and Malai." })}
        ${numberField("f-acidity", "Acidity, as lactic acid (%)", { optional: true, hint: "Not applicable to fermented/cultured/sour cream or acidified cream — leave blank for those." })}
      </div>
    `;
  }
  // Dairy Whitener — new category, built per your "you can start
  // building on it" go-ahead (FSS 2.1.11 was never encoded anywhere in
  // this app before). Same 4-tier-by-Milk-Fat shape as Milk Powder, plus
  // two fields Milk Powder doesn't have (Acid Insoluble Ash, Added
  // Sugar) — see DAIRY_PRODUCTS.dairy_whitener in dairyBible.js.
  if (categoryId === "dairy_whitener") {
    const opts = Object.entries(DAIRY_WHITENER_TYPES).map(([k, v]) => [k, v.name]);
    return `
      ${selectField("f-dairy_whitener_type", "Product type", opts)}
      <div class="form-grid">
        ${numberField("f-moisture", "Moisture (%)")}
        ${numberField("f-fat", "Milk Fat (%)", { hint: "Maximum for Skimmed Milk/High Fat Dairy Whitener; minimum for High Fat; a range for Low Fat/Medium Fat." })}
        ${numberField("f-protein_snf", "Milk Protein in Milk Solids-Not-Fat (%)")}
      </div>
      <div class="form-grid">
        ${numberField("f-insolubility_index", "Insolubility Index (ml)")}
        ${numberField("f-total_ash", "Total Ash, moisture/added sugar/fat free basis (%)")}
        ${numberField("f-acid_insoluble_ash", "Acid Insoluble Ash (%)")}
        ${numberField("f-added_sugar", "Added Sugar, as sucrose (%)")}
        ${numberField("f-titratable_acidity", "Titratable Acidity, as lactic acid (%)", { hint: "1.5% for Skimmed/Low Fat/Medium Fat; 1.2% for High Fat Dairy Whitener." })}
      </div>
    `;
  }
  // Whey Powder — new category, built per your "you can start building on
  // it" go-ahead (FSS 2.1.12 was never encoded anywhere in this app
  // before). Two sub-types (Whey Powder, Acid Whey Powder) sharing
  // moisture/fat/protein/lactose_content/ph/total_ash fields with
  // different limits per column — see DAIRY_PRODUCTS.whey_powder in
  // dairyBible.js. Titratable-acidity's alternate-test-method footnote is
  // a documented, deliberately not-encoded gap (see that file's comment)
  // — no field for it here.
  if (categoryId === "whey_powder") {
    const opts = Object.entries(WHEY_POWDER_TYPES).map(([k, v]) => [k, v.name]);
    return `
      ${selectField("f-whey_powder_type", "Product type", opts)}
      <div class="form-grid">
        ${numberField("f-moisture", "Moisture (%)")}
        ${numberField("f-fat", "Milk Fat (%)")}
        ${numberField("f-protein", "Milk Protein (%)")}
      </div>
      <div class="form-grid">
        ${numberField("f-lactose_content", "Lactose Content, as anhydrous lactose (%)")}
        ${numberField("f-ph", "pH, in 10% solution", { hint: "Minimum 5.1 for Whey Powder; maximum 5.1 for Acid Whey Powder." })}
        ${numberField("f-total_ash", "Total Ash, on dry basis (%)")}
      </div>
    `;
  }
  // Edible Casein Products — new category, built per your "you can start
  // building on it" go-ahead (FSS 2.1.18 was never encoded anywhere in
  // this app before). Three sub-types (Edible Acid Casein, Edible
  // Rennet Casein, Edible Caseinate) sharing most fields with different
  // limits per column, plus two fields that only apply to one sub-type
  // each (Free Acid to Acid Casein, pH to Caseinate) — see
  // DAIRY_PRODUCTS.casein_products in dairyBible.js. Total Ash is a
  // MAXIMUM for Acid Casein but a MINIMUM for Rennet Casein — same
  // field, opposite rule, shown here as one number field regardless
  // since the hint text carries the distinction.
  if (categoryId === "casein_products") {
    const opts = Object.entries(CASEIN_PRODUCTS_TYPES).map(([k, v]) => [k, v.name]);
    return `
      ${selectField("f-casein_products_type", "Product type", opts)}
      <div class="form-grid">
        ${numberField("f-moisture", "Moisture (%)")}
        ${numberField("f-fat", "Milk Fat (%)")}
        ${numberField("f-protein", "Milk Protein, dry matter basis (%)")}
      </div>
      <div class="form-grid">
        ${numberField("f-casein_in_protein", "Casein in Protein (%)")}
        ${numberField("f-lactose_content", "Lactose (%)")}
        ${numberField("f-total_ash", "Total Ash, including P2O5 (%)", { optional: true, hint: "Maximum 2.5% for Edible Acid Casein; minimum 7.5% for Edible Rennet Casein; not stated for Edible Caseinate — leave blank for that one." })}
      </div>
      <div class="form-grid">
        ${numberField("f-free_acid", "Free Acid, as ml 0.1N NaOH per g", { optional: true, hint: "Edible Acid Casein only — leave blank for the other two sub-types." })}
        ${numberField("f-ph", "pH, in 10% solution", { optional: true, hint: "Edible Caseinate only — leave blank for the other two sub-types." })}
      </div>
    `;
  }
  // Edible Lactose — new category (FSS 2.1.20), ninth of the 11 further
  // standards. Only one product form (no named sub-types), unlike every
  // other category above — the select field below has a single option
  // so this still runs through the same generic sub-type-keyed engine
  // as everything else. See DAIRY_PRODUCTS.edible_lactose in
  // dairyBible.js: "Scorched particle, maximum: Disc B" is a documented,
  // deliberately not-encoded gap (same ordinal-scale reasoning as Milk
  // Powder's) — no field for it here.
  if (categoryId === "edible_lactose") {
    const opts = Object.entries(EDIBLE_LACTOSE_TYPES).map(([k, v]) => [k, v.name]);
    return `
      ${selectField("f-edible_lactose_type", "Product type", opts)}
      <div class="form-grid">
        ${numberField("f-moisture", "Total Moisture (%)")}
        ${numberField("f-lactose_content", "Lactose, on dry basis (%)")}
        ${numberField("f-sulphated_ash", "Sulphated Ash (%)")}
        ${numberField("f-ph", "pH, in 10% solution", { hint: "Must fall between 4.5 and 7.0." })}
      </div>
    `;
  }
  // Milk Protein Concentrate — new category (FSS 2.1.21), tenth of the
  // 11 further standards. Single product form, same shape as Edible
  // Lactose above. "Scorched particles, maximum: Disc B" is the same
  // documented not-encoded gap.
  if (categoryId === "milk_protein_concentrate") {
    const opts = Object.entries(MILK_PROTEIN_CONCENTRATE_TYPES).map(([k, v]) => [k, v.name]);
    return `
      ${selectField("f-milk_protein_concentrate_type", "Product type", opts)}
      <div class="form-grid">
        ${numberField("f-moisture", "Moisture (%)")}
        ${numberField("f-protein", "Milk Protein (%)")}
        ${numberField("f-insolubility_index", "Insolubility Index (ml)")}
        ${numberField("f-total_ash", "Total Ash, on dry basis (%)")}
      </div>
    `;
  }
  // Whey Protein Concentrate — new category (FSS 2.1.22), eleventh of
  // the 11 further standards. Single product form.
  if (categoryId === "whey_protein_concentrate") {
    const opts = Object.entries(WHEY_PROTEIN_CONCENTRATE_TYPES).map(([k, v]) => [k, v.name]);
    return `
      ${selectField("f-whey_protein_concentrate_type", "Product type", opts)}
      <div class="form-grid">
        ${numberField("f-moisture", "Moisture (%)")}
        ${numberField("f-protein", "Milk Protein (%)")}
        ${numberField("f-fat", "Milk Fat (%)")}
      </div>
    `;
  }
  // Colostrum Products — new category (FSS 2.1.23), last of the 11
  // further standards. Two sub-types (Colostrum / Colostrum Powder) with
  // very different composition profiles (a liquid vs. a dried powder) —
  // see DAIRY_PRODUCTS.colostrum_products in dairyBible.js for the IgG
  // amendment finding (both sub-types' `igg` field already reflects the
  // amended, currently-in-force figure). Appearance/Odour/Taste are
  // documented, deliberately not-encoded organoleptic gaps — no fields
  // for them here. Total Ash only applies to Colostrum Powder (blank
  // for Colostrum, same "optional, category-specific" UI pattern as
  // Edible Casein Products' mixed Total Ash field above).
  if (categoryId === "colostrum_products") {
    const opts = Object.entries(COLOSTRUM_PRODUCTS_TYPES).map(([k, v]) => [k, v.name]);
    return `
      ${selectField("f-colostrum_products_type", "Product type", opts)}
      <div class="form-grid">
        ${numberField("f-moisture", "Moisture (%)")}
        ${numberField("f-protein", "Protein (%)")}
        ${numberField("f-fat", "Fat (%)")}
      </div>
      <div class="form-grid">
        ${numberField("f-igg", "Immunoglobulins-G, IgG (%)")}
        ${numberField("f-lactoferrin", "Lactoferrin (%)")}
        ${numberField("f-total_ash", "Total Ash, on dry basis (%)", { optional: true, hint: "Colostrum Powder only — leave blank for plain Colostrum, which has no Total Ash limit." })}
      </div>
    `;
  }
  // Dairy Permeate Powders — new category (FSS 2.1.24), found while
  // reading FSS 2.1.23's own text (immediately follows Colostrum Products
  // in the primary PDF). Three named sub-types share one parameter table
  // with different numbers per column (Nitrogen and Ash differ; Lactose,
  // Milk Fat, and Moisture are the same across all three) — see
  // DAIRY_PRODUCTS.dairy_permeate_powders in dairyBible.js for the full
  // per-column figures.
  if (categoryId === "dairy_permeate_powders") {
    const opts = Object.entries(DAIRY_PERMEATE_POWDERS_TYPES).map(([k, v]) => [k, v.name]);
    return `
      ${selectField("f-dairy_permeate_powders_type", "Product type", opts)}
      <div class="form-grid">
        ${numberField("f-lactose", "Lactose, Anhydrous (%)")}
        ${numberField("f-nitrogen", "Nitrogen (%)")}
        ${numberField("f-milk_fat", "Milk Fat (%)")}
      </div>
      <div class="form-grid">
        ${numberField("f-ash", "Ash (%)")}
        ${numberField("f-moisture", "Moisture (%)")}
      </div>
    `;
  }
  return "";
}

// FIXED — this used to only look up MICRO_LIMITS[categoryId] directly,
// so a category with a sub-type-specific microKey override (Processed
// Cheese -> cheese_processed; Table/White Butter -> butter) never got
// the right fields shown: Processed Cheese's real panel needs APC
// (which the general cheese fields don't have) and skips Yeast & Mould
// (which the general cheese fields do have) — this form was collecting
// the wrong set entirely. unionMicroLimits() (dairyBible.js) shows every
// field ANY sub-type in this category might need; validateSubmission()
// still resolves the ONE correct microKey when scoring, so an
// irrelevant optional field being blank never affects the verdict.
// FIXED — this used to render/collect purely by which table an organism
// came from (table_2a => numeric CFU field, table_2b => presence
// checkbox), same wrong assumption runMicrobiology() used to make before
// it was fixed to route by each entry's own `presence` flag. Found while
// wiring up Milk Powder's Sr.7 bucket for the new Dried Ice Cream Mix
// sub-types: Milk Powder's Table 2B carries real CFU counts (Bacillus
// cereus, SRC), not presence tests, so they need a numeric field, not a
// checkbox — and Yogurt/Butter/Ice Cream's Table 2A E. coli entries are
// presence tests ("Absent/g"), not counts, so they need a checkbox, not
// a numeric field with a nonsensical "Acceptable ≤ 0" hint. Every
// organism across BOTH tables is now routed the same way, by its own
// `presence` flag.
function labSection(categoryId) {
  const limits = unionMicroLimits(categoryId);
  if (!limits) return `<p class="muted" style="font-size: var(--text-sm)">Microbiology limits for this category haven't been compiled into Inspeckt yet — this check covers composition and labelling only.</p>`;
  const allEntries = [...Object.entries(limits.table_2a), ...Object.entries(limits.table_2b)];
  const countFields = allEntries.filter(([, l]) => !l.presence).map(([key, l]) =>
    numberField(`f-lab-${key}`, `${l.name} (${l.unit})`, { optional: true, step: "1",
      hint: `Acceptable ≤ ${l.m}${l.M ? `, rejected above ${l.M}` : ""}` })).join("");
  const presenceFields = allEntries.filter(([, l]) => l.presence).map(([key, l]) =>
    presenceField(`f-lab-${key}`, `${l.name} (${l.unit})`, "Presence/absence test.")).join("");
  return `
    <div class="form-grid">${countFields}</div>
    <div class="form-grid">${presenceFields}</div>
    <div class="checkbox-row" style="margin-top: var(--space-3)">
      <input type="checkbox" id="f-has-lab-report" />
      <label for="f-has-lab-report">I have a real NABL lab report backing these results
        <span class="hint">Required to see nutrition panel values and run claims validation — we never estimate these from your entered numbers.</span>
      </label>
    </div>`;
}

function labellingSection(categoryId) {
  const elements = [...LABEL_ELEMENTS_ALL, ...(LABEL_ELEMENTS_BY_CATEGORY[categoryId] || [])];
  return elements.map((el) => labelCheckbox(`f-label-${el.key}`, el.label)).join("");
}

function renderForm(categoryId) {
  const cat = CATEGORIES.find((c) => c.id === categoryId);
  return `
    <form id="submission-form" novalidate>
      <!-- Fix per review item C12: a micro test result belongs to a
           specific production batch/lot — the same recipe can pass one
           batch and fail the next — but the app previously had no
           durable link between a saved result and that batch/lot number.
           Optional: not every FBO has assigned one yet at draft time. -->
      <fieldset class="section">
        <legend>Batch / lot</legend>
        <div class="form-grid">
          ${textField("f-batch-lot-number", "Batch / lot number", { optional: true, hint: "So this result can be traced back to the batch it was tested from." })}
        </div>
      </fieldset>
      <fieldset class="section">
        <legend>Composition</legend>
        ${compositionSection(categoryId)}
      </fieldset>
      <fieldset class="section">
        <legend>Lab results (microbiology)</legend>
        ${labSection(categoryId)}
      </fieldset>
      <fieldset class="section">
        <legend>Labelling</legend>
        ${labellingSection(categoryId)}
      </fieldset>
      <button class="btn btn-primary btn-lg" type="submit">Check compliance — ${cat.label}</button>
    </form>
  `;
}

function getNum(id) {
  const v = document.getElementById(id)?.value;
  return v === "" || v === undefined ? null : parseFloat(v);
}
function getPresence(id) {
  const v = document.getElementById(id)?.value;
  if (v === "" || v === undefined) return undefined;
  return v === "detected";
}
function getChecked(id) {
  return !!document.getElementById(id)?.checked;
}

function collectInput(categoryId) {
  // FIXED — mirrors the labSection() fix above: collect every field the
  // form could have shown (the union across microKey overrides), not
  // just the category-default bucket's fields, AND read each one with
  // getNum()/getPresence() according to its own `presence` flag rather
  // than which table (2A/2B) it came from — matching how labSection()
  // now decides which input type to render for it.
  const limits = unionMicroLimits(categoryId) || { table_2a: {}, table_2b: {} };
  const lab = {};
  const allEntries = [...Object.entries(limits.table_2a), ...Object.entries(limits.table_2b)];
  allEntries.forEach(([key, l]) => { lab[key] = l.presence ? getPresence(`f-lab-${key}`) : getNum(`f-lab-${key}`); });

  const elements = [...LABEL_ELEMENTS_ALL, ...(LABEL_ELEMENTS_BY_CATEGORY[categoryId] || [])];
  const label = {};
  elements.forEach((el) => { label[el.key] = getChecked(`f-label-${el.key}`); });

  if (categoryId === "milk") {
    return {
      milk_type: document.getElementById("f-milk_type").value,
      fat: getNum("f-fat"), snf: getNum("f-snf"),
      sodium: getNum("f-sodium"), urea: getNum("f-urea"),
      heat_treatment: document.getElementById("f-heat_treatment").value,
      lab, label,
    };
  }
  if (categoryId === "paneer") {
    return {
      paneer_type: document.getElementById("f-paneer_type").value,
      moisture: getNum("f-moisture"), fat: getNum("f-fat"),
      lab, label,
    };
  }
  if (categoryId === "cheese") {
    return {
      cheese_type: document.getElementById("f-cheese_type").value,
      moisture: getNum("f-moisture"), fat: getNum("f-fat"),
      moisture_type: document.getElementById("f-cheese_moisture_type")?.value || null,
      lactose: getNum("f-lactose"),
      lab, label,
    };
  }
  if (categoryId === "ghee") {
    return {
      ghee_type: document.getElementById("f-ghee_type").value,
      moisture: getNum("f-moisture"), fat: getNum("f-fat"),
      br_reading: getNum("f-br_reading"), rm_value: getNum("f-rm_value"),
      polenske_value: getNum("f-polenske_value"), ffa: getNum("f-ffa"),
      peroxide_value: getNum("f-peroxide_value"),
      iodine_value: getNum("f-iodine_value"), saponification_value: getNum("f-saponification_value"),
      msnf: getNum("f-msnf"), common_salt: getNum("f-common_salt"),
      baudouin_test: document.getElementById("f-baudouin_test")?.value || null,
      beta_sitosterol: document.getElementById("f-beta_sitosterol")?.value || null,
      lab, label,
    };
  }
  if (categoryId === "milk_powder") {
    return {
      milk_powder_type: document.getElementById("f-milk_powder_type").value,
      moisture: getNum("f-moisture"), fat: getNum("f-fat"), protein_snf: getNum("f-protein_snf"),
      titrable_acidity: getNum("f-titrable_acidity"), insolubility_index: getNum("f-insolubility_index"),
      total_ash: getNum("f-total_ash"), sodium: getNum("f-sodium"),
      lab, label,
    };
  }
  if (categoryId === "yogurt") {
    return {
      yogurt_type: document.getElementById("f-yogurt_type").value,
      // Plain Dahi only — see runDahiComposition() in validation.js.
      milk_type: document.getElementById("f-milk_type")?.value || null,
      fat: getNum("f-fat"), snf: getNum("f-snf"), msnf: getNum("f-msnf"),
      protein: getNum("f-protein"), titratable_acidity: getNum("f-titratable_acidity"),
      total_solids: getNum("f-total_solids"), total_ash: getNum("f-total_ash"),
      sugar: getNum("f-sugar"), fermented_milk_content: getNum("f-fermented_milk_content"),
      lab, label,
    };
  }
  if (categoryId === "ice_cream") {
    return {
      ice_cream_type: document.getElementById("f-ice_cream_type").value,
      total_solids: getNum("f-total_solids"), weight: getNum("f-weight"),
      fat: getNum("f-fat"), protein: getNum("f-protein"), moisture: getNum("f-moisture"),
      lab, label,
    };
  }
  if (categoryId === "khoa") {
    return {
      khoa_type: document.getElementById("f-khoa_type").value,
      total_solids: getNum("f-total_solids"), fat: getNum("f-fat"),
      total_ash: getNum("f-total_ash"), titratable_acidity: getNum("f-titratable_acidity"),
      rm_value: getNum("f-rm_value"), polenske_value: getNum("f-polenske_value"), br_reading: getNum("f-br_reading"),
      lab, label,
    };
  }
  if (categoryId === "flavoured_milk") {
    return {
      flavoured_milk_type: document.getElementById("f-flavoured_milk_type").value,
      // Cross-referenced live from whichever milk it's made from — see
      // runMilkCrossReferenceComposition() in validation.js.
      milk_type: document.getElementById("f-milk_type")?.value || null,
      fat: getNum("f-fat"), snf: getNum("f-snf"),
      lab, label,
    };
  }
  if (categoryId === "evaporated_milk") {
    return {
      evaporated_milk_type: document.getElementById("f-evaporated_milk_type").value,
      fat: getNum("f-fat"), milk_solids: getNum("f-milk_solids"), protein_snf: getNum("f-protein_snf"),
      lab, label,
    };
  }
  if (categoryId === "sweetened_condensed_milk") {
    return {
      sweetened_condensed_milk_type: document.getElementById("f-sweetened_condensed_milk_type").value,
      fat: getNum("f-fat"), milk_solids: getNum("f-milk_solids"), msnf: getNum("f-msnf"), protein_snf: getNum("f-protein_snf"),
      lab, label,
    };
  }
  if (categoryId === "cream") {
    return {
      cream_type: document.getElementById("f-cream_type").value,
      fat: getNum("f-fat"), acidity: getNum("f-acidity"),
      lab, label,
    };
  }
  if (categoryId === "dairy_whitener") {
    return {
      dairy_whitener_type: document.getElementById("f-dairy_whitener_type").value,
      moisture: getNum("f-moisture"), fat: getNum("f-fat"), protein_snf: getNum("f-protein_snf"),
      insolubility_index: getNum("f-insolubility_index"), total_ash: getNum("f-total_ash"),
      acid_insoluble_ash: getNum("f-acid_insoluble_ash"), added_sugar: getNum("f-added_sugar"),
      titratable_acidity: getNum("f-titratable_acidity"),
      lab, label,
    };
  }
  if (categoryId === "whey_powder") {
    return {
      whey_powder_type: document.getElementById("f-whey_powder_type").value,
      moisture: getNum("f-moisture"), fat: getNum("f-fat"), protein: getNum("f-protein"),
      lactose_content: getNum("f-lactose_content"), ph: getNum("f-ph"), total_ash: getNum("f-total_ash"),
      lab, label,
    };
  }
  if (categoryId === "casein_products") {
    return {
      casein_products_type: document.getElementById("f-casein_products_type").value,
      moisture: getNum("f-moisture"), fat: getNum("f-fat"), protein: getNum("f-protein"),
      casein_in_protein: getNum("f-casein_in_protein"), lactose_content: getNum("f-lactose_content"),
      total_ash: getNum("f-total_ash"), free_acid: getNum("f-free_acid"), ph: getNum("f-ph"),
      lab, label,
    };
  }
  if (categoryId === "edible_lactose") {
    return {
      edible_lactose_type: document.getElementById("f-edible_lactose_type").value,
      moisture: getNum("f-moisture"), lactose_content: getNum("f-lactose_content"),
      sulphated_ash: getNum("f-sulphated_ash"), ph: getNum("f-ph"),
      lab, label,
    };
  }
  if (categoryId === "milk_protein_concentrate") {
    return {
      milk_protein_concentrate_type: document.getElementById("f-milk_protein_concentrate_type").value,
      moisture: getNum("f-moisture"), protein: getNum("f-protein"),
      insolubility_index: getNum("f-insolubility_index"), total_ash: getNum("f-total_ash"),
      lab, label,
    };
  }
  if (categoryId === "whey_protein_concentrate") {
    return {
      whey_protein_concentrate_type: document.getElementById("f-whey_protein_concentrate_type").value,
      moisture: getNum("f-moisture"), protein: getNum("f-protein"), fat: getNum("f-fat"),
      lab, label,
    };
  }
  if (categoryId === "colostrum_products") {
    return {
      colostrum_products_type: document.getElementById("f-colostrum_products_type").value,
      moisture: getNum("f-moisture"), protein: getNum("f-protein"), fat: getNum("f-fat"),
      igg: getNum("f-igg"), lactoferrin: getNum("f-lactoferrin"), total_ash: getNum("f-total_ash"),
      lab, label,
    };
  }
  if (categoryId === "dairy_permeate_powders") {
    return {
      dairy_permeate_powders_type: document.getElementById("f-dairy_permeate_powders_type").value,
      lactose: getNum("f-lactose"), nitrogen: getNum("f-nitrogen"), milk_fat: getNum("f-milk_fat"),
      ash: getNum("f-ash"), moisture: getNum("f-moisture"),
      lab, label,
    };
  }
  return { lab, label };
}

// ---------------------------------------------------------------
// Views
// ---------------------------------------------------------------
async function renderNew() {
  // Fix per review item C3: New Submissions and Formulation Lab
  // iterations now draw from ONE shared usage pool per tier (was two
  // separate counters whose stated numbers didn't match what was
  // actually granted — see data/pricing.js's poolAllowance()). Gate the
  // entry point itself (mirrors renderLab()'s atLimit pattern) rather
  // than only failing at save time, so a user over their allowance isn't
  // asked to fill in a whole form first. poolUsed() now asks the real
  // backend (source of truth for what's actually allowed to save), so
  // this view needs a brief loading state first.
  mainArea.innerHTML = `<p class="muted">Loading…</p>`;
  let used;
  try {
    used = await poolUsed(user.id);
  } catch (err) {
    mainArea.innerHTML = `<div class="alert alert-danger">${escapeHtml(err.message)}</div>`;
    return;
  }
  const allowance = poolAllowance(user);
  const atLimit = used >= allowance;

  mainArea.innerHTML = `
    <div class="page-head">
      <span class="eyebrow">New submission</span>
      <h1>Run a compliance check</h1>
      <p class="muted" style="margin-top: var(--space-2)">Pick a product category, then enter your formulation, lab results and label details.
        ${allowance === Infinity ? " Unlimited on your plan." : ` ${used} of ${allowance} New Submissions/formulation iterations used${user.tier ? "" : " (none included on the free plan)"}.`}
      </p>
    </div>
    <!-- Fix per your "submission happened but not showing in history"
         report: mirrors build/site-controller.js's identical fix — a
         never-purchased account (user.tier === null, allowance 0) used to
         see "You've used all 0..." here, which reads as a glitch, not a
         paywall. -->
    ${atLimit ? (user.tier ? `
      <div class="card" style="border-color: var(--color-warning-border); background: var(--color-warning-bg); padding: var(--space-5)">
        <strong>You've used all ${allowance} New Submissions and formulation iterations included on your current plan.</strong>
        <p class="muted" style="margin-top: var(--space-2)">Purchase or upgrade a tier to run more — Starter includes 3, Mid includes 5, Higher includes 10, shared between New Submissions and the Formulation Lab.</p>
        <a class="btn btn-primary btn-sm" href="pricing.html" style="margin-top: var(--space-3)">See pricing</a>
      </div>` : `
      <div class="card" style="border-color: var(--color-warning-border); background: var(--color-warning-bg); padding: var(--space-5)">
        <strong>A plan is needed to run a full compliance check.</strong>
        <p class="muted" style="margin-top: var(--space-2)">There's no free full New Submission or Formulation Lab check — the free part is the Regulatory Brief (the definition and standard for your category), no account needed. Starter includes 3 New Submissions/formulation iterations for ₹15,000.</p>
        <a class="btn btn-primary btn-sm" href="pricing.html" style="margin-top: var(--space-3)">See pricing</a>
      </div>`) : `
      <div class="category-picker" id="cat-picker"></div>
      <div id="form-host"></div>
    `}
  `;

  if (atLimit) return;

  const picker = document.getElementById("cat-picker");
  picker.innerHTML = CATEGORIES.map((c) => `
    <button class="category-pick ${currentCategory === c.id ? "selected" : ""}" data-id="${c.id}" ${c.live ? "" : "disabled"}>
      <div class="name">${c.label}</div>
      <div class="reg">FSSAI ${c.regulation}${c.live ? "" : " · Coming soon"}</div>
    </button>`).join("");

  picker.querySelectorAll(".category-pick").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentCategory = btn.dataset.id;
      picker.querySelectorAll(".category-pick").forEach((b) => b.classList.toggle("selected", b === btn));
      mountForm(currentCategory);
    });
  });

  if (currentCategory) mountForm(currentCategory);
}

function mountForm(categoryId) {
  const host = document.getElementById("form-host");
  host.innerHTML = renderForm(categoryId);
  const form = document.getElementById("submission-form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = collectInput(categoryId);
    const hasLabReport = getChecked("f-has-lab-report");
    const cat = CATEGORIES.find((c) => c.id === categoryId);
    // Fix per review item C12.
    const batchLotNumber = document.getElementById("f-batch-lot-number")?.value.trim() || null;
    // The compliance check itself now runs server-side (POST
    // /api/v1/submissions — backend/app/validation_engine.py) rather than
    // client-side via validation.js, so what gets saved and what gets
    // shown are guaranteed to be the exact same result, computed once —
    // see saveSubmission()'s own comment in storage.js.
    const submitBtn = form.querySelector('button[type="submit"]');
    const idleLabel = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spinner"></span> Checking…';
    // Fix per review items C1/C2/C3: saveSubmission() checks the shared
    // usage pool server-side and can fail with reason "limit" as well as
    // "storage" (which now also covers "no backend reachable").
    const record = await saveSubmission(user, categoryId, cat.label, input, hasLabReport, batchLotNumber);
    if (record && record.ok === false) {
      if (record.reason === "limit") {
        alert("This check couldn't be saved — you've used all the New Submissions and formulation iterations included on your current plan. See Pricing to add more.");
      } else {
        alert(`This check couldn't be run: ${record.error}`);
      }
      submitBtn.disabled = false;
      submitBtn.textContent = idleLabel;
      return;
    }
    window.location.hash = `#/results/${record.id}`;
  });
}

// ---------------------------------------------------------------
// Formulation Lab — draft & compare formulation iterations before
// committing to a real submission. See PLATFORM_PLAN_V2.md §2.5.
// ---------------------------------------------------------------
const LAB_LIVE_CATEGORIES = CATEGORIES.filter((c) => c.live);

function scoreColor(score) {
  if (score >= 85) return "var(--color-success-ink)";
  if (score >= 60) return "var(--color-warning-ink)";
  return "var(--color-danger-ink)";
}

async function renderLab() {
  mainArea.innerHTML = `<p class="muted">Loading…</p>`;
  let products, used;
  try {
    // Fix per review item C3: shares data/pricing.js's poolAllowance() with
    // New Submissions (storage.js) instead of its own separate, additive
    // allowance — see renderNew() above for the fuller rationale.
    [products, used] = await Promise.all([listProducts(user.id), poolUsed(user.id)]);
  } catch (err) {
    mainArea.innerHTML = `<div class="alert alert-danger">${escapeHtml(err.message)}</div>`;
    return;
  }
  const allowance = poolAllowance(user);
  const atLimit = used >= allowance;

  mainArea.innerHTML = `
    <div class="page-head">
      <span class="eyebrow">Formulation Lab</span>
      <h1>Draft &amp; compare formulations</h1>
      <p class="muted" style="margin-top: var(--space-2)">
        Score a formulation against the regulation using your own planned numbers — no lab report needed yet.
        ${allowance === Infinity ? "Unlimited on your plan." : `${used} of ${allowance} New Submissions/formulation iterations used${user.tier ? "" : " (none included on the free plan)"}.`}
      </p>
    </div>
    <!-- Fix per review item C7: this score is composition-only — it
         can't and doesn't check microbiology (pathogen limits) or
         labelling, since there's no lab report at the Lab stage. That
         used to be explained once in scroll-away intro copy; this is
         now a persistent, visible caveat plus a per-score badge below,
         so a high score can't be read as "basically ready." -->
    <div class="alert alert-info" style="margin-bottom: var(--space-5)">
      A Lab score checks composition only — it does not include microbiology (pathogen/APC limits) or
      labelling. A high score here is not a pass on those; only a New Submission with a lab report checks them.
    </div>
    ${atLimit ? (user.tier ? `
      <div class="card" style="border-color: var(--color-warning-border); background: var(--color-warning-bg); margin-bottom: var(--space-6); padding: var(--space-5)">
        <strong>You've used all ${allowance} New Submissions and formulation iterations included on your current plan.</strong>
        <p class="muted" style="margin-top: var(--space-2)">Purchase or upgrade a tier to add more — Starter includes 3, Mid includes 5, Higher includes 10, shared between New Submissions and the Formulation Lab.</p>
        <a class="btn btn-primary btn-sm" href="pricing.html" style="margin-top: var(--space-3)">See pricing</a>
      </div>` : `
      <div class="card" style="border-color: var(--color-warning-border); background: var(--color-warning-bg); margin-bottom: var(--space-6); padding: var(--space-5)">
        <strong>A plan is needed to run the Formulation Lab.</strong>
        <p class="muted" style="margin-top: var(--space-2)">There's no free formulation scoring — Starter includes 3 New Submissions/formulation iterations for ₹15,000.</p>
        <a class="btn btn-primary btn-sm" href="pricing.html" style="margin-top: var(--space-3)">See pricing</a>
      </div>`) : `
      <button class="btn btn-primary" id="lab-new-btn" style="margin-bottom: var(--space-6)">${icon("plus", 16)} New formulation iteration</button>
    `}
    <div id="lab-products"></div>
  `;
  hydrateIcons(mainArea);

  const host = document.getElementById("lab-products");
  if (products.length === 0) {
    host.innerHTML = `
      <div class="card empty-state">
        <div class="glyph">${icon("layers", 40)}</div>
        <h3>No formulations yet</h3>
        <p>Draft your first iteration to see how close it is to compliant.</p>
      </div>`;
  } else {
    host.innerHTML = products.map((p) => `
      <div class="card" style="margin-bottom: var(--space-4); padding: var(--space-5)">
        <div class="row-between">
          <h3>${escapeHtml(p.productName)}</h3>
          <span style="font-family: var(--font-mono); font-weight: 700; color: ${scoreColor(p.best.score)}">${p.best.score}% closest</span>
        </div>
        <!-- Fix per review item C7: badge sits directly next to the score
             column header, not just in page-intro copy a user may not
             scroll back to. -->
        <table class="history-table" style="margin-top: var(--space-3)">
          <thead><tr><th>Iteration</th><th>Category</th><th>Score <span class="badge badge-neutral" style="font-weight:400" title="Composition only — excludes microbiology and labelling">composition only</span></th><th>Gaps</th><th></th></tr></thead>
          <tbody>
            ${p.iterations.map((it) => `
              <tr>
                <td>${escapeHtml(it.iterationLabel)}</td>
                <td>${LAB_LIVE_CATEGORIES.find((c) => c.id === it.category)?.label || it.category}</td>
                <td style="font-family: var(--font-mono); color: ${scoreColor(it.score)}; font-weight:600">${it.score}%</td>
                <td class="muted">${it.gapSummary.length ? it.gapSummary.map((g) => g.label).join(", ") : "None — fully within range"}</td>
                <td><button type="button" class="btn btn-ghost btn-sm" data-delete-iteration="${it.id}" title="Delete this iteration" aria-label="Delete iteration ${escapeHtml(it.iterationLabel)}">Delete</button></td>
              </tr>`).join("")}
          </tbody>
        </table>
        ${!atLimit ? `<button class="btn btn-secondary btn-sm" data-add-iteration="${encodeURIComponent(p.productName)}" style="margin-top: var(--space-4)">+ Add another iteration</button>` : ""}
      </div>`).join("");
    host.querySelectorAll("[data-add-iteration]").forEach((btn) => {
      btn.addEventListener("click", () => {
        window.location.hash = `#/lab/new/${btn.dataset.addIteration}`;
      });
    });
    host.querySelectorAll("[data-delete-iteration]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Delete this formulation iteration? This can't be undone.")) return;
        btn.disabled = true;
        const result = await deleteIteration(user.id, btn.dataset.deleteIteration);
        if (result && result.ok === false) { alert(`Couldn't delete: ${result.error}`); btn.disabled = false; return; }
        renderLab();
      });
    });
  }

  const newBtn = document.getElementById("lab-new-btn");
  if (newBtn) newBtn.addEventListener("click", () => { window.location.hash = "#/lab/new"; });
}

function renderLabNew(prefilledProduct) {
  const productName = prefilledProduct ? decodeURIComponent(prefilledProduct) : "";
  mainArea.innerHTML = `
    <div class="page-head">
      <span class="eyebrow">Formulation Lab</span>
      <h1>New formulation iteration</h1>
      <p class="muted" style="margin-top: var(--space-2)">Enter your planned/target numbers — this scores against the regulation, it doesn't require a lab report.</p>
    </div>
    <div class="card" style="padding: var(--space-6); max-width: 640px;">
      <div class="form-grid">
        <div class="field">
          <label for="lab-product-name">Product name</label>
          <input id="lab-product-name" type="text" placeholder="e.g. Fruit Yogurt" value="${escapeHtml(productName)}" ${productName ? "readonly" : ""} />
        </div>
        <div class="field">
          <label for="lab-iteration-label">Iteration name</label>
          <input id="lab-iteration-label" type="text" placeholder="e.g. v1, Less sugar" />
        </div>
      </div>
      <div class="category-picker" id="lab-cat-picker" style="margin-top: var(--space-2)"></div>
      <div id="lab-form-host"></div>
      <p class="muted" style="font-size: var(--text-sm); margin-top: var(--space-5)">
        Working with an ingredient or formulation FSSAI doesn't have a defined standard for?
        <a href="consult.html?kind=doesnt_fit">Talk to a consultant instead →</a>
      </p>
    </div>
  `;

  let selectedCategory = null;
  const picker = document.getElementById("lab-cat-picker");
  picker.innerHTML = LAB_LIVE_CATEGORIES.map((c) => `
    <button type="button" class="category-pick" data-id="${c.id}">
      <div class="name">${c.label}</div>
      <div class="reg">FSSAI ${c.regulation}</div>
    </button>`).join("");

  picker.querySelectorAll(".category-pick").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedCategory = btn.dataset.id;
      picker.querySelectorAll(".category-pick").forEach((b) => b.classList.toggle("selected", b === btn));
      document.getElementById("lab-form-host").innerHTML = `
        ${compositionSection(selectedCategory)}
        <button class="btn btn-primary btn-lg" id="lab-save-btn" type="button" style="margin-top: var(--space-3)">Score this iteration</button>
      `;
      document.getElementById("lab-save-btn").addEventListener("click", async (e) => {
        const name = document.getElementById("lab-product-name").value.trim();
        const label = document.getElementById("lab-iteration-label").value.trim() || "v1";
        if (!name) { alert("Enter a product name first."); return; }
        const input = collectCompositionOnly(selectedCategory);
        const btn = e.currentTarget;
        const idleLabel = btn.textContent;
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> Scoring…';
        // Scored server-side now (POST /api/v1/formulations) — see
        // saveIteration()'s own comment in formulations.js.
        const result = await saveIteration(user, { productName: name, iterationLabel: label, category: selectedCategory, input });
        if (!result.ok) {
          alert(result.reason === "limit"
            ? "You've used all the New Submissions and formulation iterations included on your current plan. See Pricing to add more."
            : `This couldn't be scored: ${result.error}`);
          btn.disabled = false;
          btn.textContent = idleLabel;
          return;
        }
        window.location.hash = "#/lab";
      });
    });
  });
}

/** Composition-only input collection for the Formulation Lab (no lab/label
 * fields — those come later, once there's a real submission). */
function collectCompositionOnly(categoryId) {
  if (categoryId === "milk") {
    return {
      milk_type: document.getElementById("f-milk_type").value,
      fat: getNum("f-fat"), snf: getNum("f-snf"),
      sodium: getNum("f-sodium"), urea: getNum("f-urea"),
    };
  }
  if (categoryId === "paneer") {
    return { paneer_type: document.getElementById("f-paneer_type").value, moisture: getNum("f-moisture"), fat: getNum("f-fat") };
  }
  if (categoryId === "cheese") {
    return { cheese_type: document.getElementById("f-cheese_type").value, moisture: getNum("f-moisture"), fat: getNum("f-fat") };
  }
  if (categoryId === "ghee") {
    return {
      ghee_type: document.getElementById("f-ghee_type").value,
      moisture: getNum("f-moisture"), fat: getNum("f-fat"),
      br_reading: getNum("f-br_reading"), rm_value: getNum("f-rm_value"),
      polenske_value: getNum("f-polenske_value"), ffa: getNum("f-ffa"),
      peroxide_value: getNum("f-peroxide_value"),
      iodine_value: getNum("f-iodine_value"), saponification_value: getNum("f-saponification_value"),
      msnf: getNum("f-msnf"), common_salt: getNum("f-common_salt"),
      baudouin_test: document.getElementById("f-baudouin_test")?.value || null,
      beta_sitosterol: document.getElementById("f-beta_sitosterol")?.value || null,
    };
  }
  if (categoryId === "milk_powder") {
    return {
      milk_powder_type: document.getElementById("f-milk_powder_type").value,
      moisture: getNum("f-moisture"), fat: getNum("f-fat"), protein_snf: getNum("f-protein_snf"),
      titrable_acidity: getNum("f-titrable_acidity"), insolubility_index: getNum("f-insolubility_index"),
      total_ash: getNum("f-total_ash"), sodium: getNum("f-sodium"),
    };
  }
  if (categoryId === "yogurt") {
    return {
      yogurt_type: document.getElementById("f-yogurt_type").value,
      milk_type: document.getElementById("f-milk_type")?.value || null,
      fat: getNum("f-fat"), snf: getNum("f-snf"), msnf: getNum("f-msnf"),
      protein: getNum("f-protein"), titratable_acidity: getNum("f-titratable_acidity"),
      total_solids: getNum("f-total_solids"), total_ash: getNum("f-total_ash"),
      sugar: getNum("f-sugar"), fermented_milk_content: getNum("f-fermented_milk_content"),
    };
  }
  if (categoryId === "ice_cream") {
    return {
      ice_cream_type: document.getElementById("f-ice_cream_type").value,
      total_solids: getNum("f-total_solids"), weight: getNum("f-weight"),
      fat: getNum("f-fat"), protein: getNum("f-protein"), moisture: getNum("f-moisture"),
    };
  }
  if (categoryId === "khoa") {
    return {
      khoa_type: document.getElementById("f-khoa_type").value,
      total_solids: getNum("f-total_solids"), fat: getNum("f-fat"),
      total_ash: getNum("f-total_ash"), titratable_acidity: getNum("f-titratable_acidity"),
      rm_value: getNum("f-rm_value"), polenske_value: getNum("f-polenske_value"), br_reading: getNum("f-br_reading"),
    };
  }
  if (categoryId === "flavoured_milk") {
    return {
      flavoured_milk_type: document.getElementById("f-flavoured_milk_type").value,
      milk_type: document.getElementById("f-milk_type")?.value || null,
      fat: getNum("f-fat"), snf: getNum("f-snf"),
    };
  }
  if (categoryId === "evaporated_milk") {
    return {
      evaporated_milk_type: document.getElementById("f-evaporated_milk_type").value,
      fat: getNum("f-fat"), milk_solids: getNum("f-milk_solids"), protein_snf: getNum("f-protein_snf"),
    };
  }
  if (categoryId === "sweetened_condensed_milk") {
    return {
      sweetened_condensed_milk_type: document.getElementById("f-sweetened_condensed_milk_type").value,
      fat: getNum("f-fat"), milk_solids: getNum("f-milk_solids"), msnf: getNum("f-msnf"), protein_snf: getNum("f-protein_snf"),
    };
  }
  if (categoryId === "cream") {
    return {
      cream_type: document.getElementById("f-cream_type").value,
      fat: getNum("f-fat"), acidity: getNum("f-acidity"),
    };
  }
  if (categoryId === "dairy_whitener") {
    return {
      dairy_whitener_type: document.getElementById("f-dairy_whitener_type").value,
      moisture: getNum("f-moisture"), fat: getNum("f-fat"), protein_snf: getNum("f-protein_snf"),
      insolubility_index: getNum("f-insolubility_index"), total_ash: getNum("f-total_ash"),
      acid_insoluble_ash: getNum("f-acid_insoluble_ash"), added_sugar: getNum("f-added_sugar"),
      titratable_acidity: getNum("f-titratable_acidity"),
    };
  }
  if (categoryId === "whey_powder") {
    return {
      whey_powder_type: document.getElementById("f-whey_powder_type").value,
      moisture: getNum("f-moisture"), fat: getNum("f-fat"), protein: getNum("f-protein"),
      lactose_content: getNum("f-lactose_content"), ph: getNum("f-ph"), total_ash: getNum("f-total_ash"),
    };
  }
  if (categoryId === "casein_products") {
    return {
      casein_products_type: document.getElementById("f-casein_products_type").value,
      moisture: getNum("f-moisture"), fat: getNum("f-fat"), protein: getNum("f-protein"),
      casein_in_protein: getNum("f-casein_in_protein"), lactose_content: getNum("f-lactose_content"),
      total_ash: getNum("f-total_ash"), free_acid: getNum("f-free_acid"), ph: getNum("f-ph"),
    };
  }
  if (categoryId === "edible_lactose") {
    return {
      edible_lactose_type: document.getElementById("f-edible_lactose_type").value,
      moisture: getNum("f-moisture"), lactose_content: getNum("f-lactose_content"),
      sulphated_ash: getNum("f-sulphated_ash"), ph: getNum("f-ph"),
    };
  }
  if (categoryId === "milk_protein_concentrate") {
    return {
      milk_protein_concentrate_type: document.getElementById("f-milk_protein_concentrate_type").value,
      moisture: getNum("f-moisture"), protein: getNum("f-protein"),
      insolubility_index: getNum("f-insolubility_index"), total_ash: getNum("f-total_ash"),
    };
  }
  if (categoryId === "whey_protein_concentrate") {
    return {
      whey_protein_concentrate_type: document.getElementById("f-whey_protein_concentrate_type").value,
      moisture: getNum("f-moisture"), protein: getNum("f-protein"), fat: getNum("f-fat"),
    };
  }
  if (categoryId === "colostrum_products") {
    return {
      colostrum_products_type: document.getElementById("f-colostrum_products_type").value,
      moisture: getNum("f-moisture"), protein: getNum("f-protein"), fat: getNum("f-fat"),
      igg: getNum("f-igg"), lactoferrin: getNum("f-lactoferrin"), total_ash: getNum("f-total_ash"),
    };
  }
  if (categoryId === "dairy_permeate_powders") {
    return {
      dairy_permeate_powders_type: document.getElementById("f-dairy_permeate_powders_type").value,
      lactose: getNum("f-lactose"), nitrogen: getNum("f-nitrogen"), milk_fat: getNum("f-milk_fat"),
      ash: getNum("f-ash"), moisture: getNum("f-moisture"),
    };
  }
  return {};
}

async function renderHistory() {
  mainArea.innerHTML = `<p class="muted">Loading…</p>`;
  const items = await listSubmissions(user.id);
  const err = submissionsStorageError();
  mainArea.innerHTML = `
    <div class="page-head">
      <span class="eyebrow">History</span>
      <h1>Submission history</h1>
      <p class="muted" style="margin-top: var(--space-2)">${items.length} submission${items.length === 1 ? "" : "s"}.</p>
    </div>
    ${err ? `<div class="alert alert-danger" style="margin-bottom: var(--space-5)">${escapeHtml(err)}</div>` : ""}
    ${items.length ? `
      <div class="card">
        <table class="history-table">
          <!-- Fix per review item C12: batch/lot column so a saved result
               can be traced back to the batch it was tested from. -->
          <thead><tr><th>Product</th><th>Batch / lot</th><th>Date</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${items.map((r) => `
              <tr class="clickable" data-id="${r.id}">
                <td>${r.categoryLabel}</td>
                <td class="muted">${escapeDash(r.batchLotNumber)}</td>
                <td>${new Date(r.createdAt).toLocaleString()}</td>
                <td>${statusBadge(r.overallStatus)}</td>
                <td class="muted">View →</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>` : `
      <div class="card empty-state">
        <div class="glyph">${icon("clipboard", 40)}</div>
        <h3>No submissions yet</h3>
        <p>Run your first compliance check to see it here.</p>
        <a class="btn btn-primary" style="margin-top: var(--space-4)" href="#/new">New submission</a>
      </div>`}
  `;
  mainArea.querySelectorAll("tr.clickable").forEach((row) => {
    row.addEventListener("click", () => { window.location.hash = `#/results/${row.dataset.id}`; });
  });
}

async function renderResults(id) {
  mainArea.innerHTML = `<p class="muted">Loading…</p>`;
  const record = await getSubmission(user.id, id);
  if (!record) { window.location.hash = "#/new"; return; }
  mainArea.innerHTML = `
    <div class="page-head">
      <span class="eyebrow">${record.categoryLabel}</span>
      <h1>Compliance report</h1>
      <!-- Fix per review item C12. -->
      <p class="muted" style="margin-top: var(--space-2)">Generated ${new Date(record.createdAt).toLocaleString()}${record.batchLotNumber ? ` · Batch/lot: ${escapeHtml(record.batchLotNumber)}` : ""}</p>
    </div>
    ${renderReport(record.categoryLabel, record.result)}
  `;
}

// Fix per your "the dashboard needs to have everything... if they checked
// labels" feedback: label-check.html itself stays free/no-login, but a
// logged-in user's checks now surface here, same table pattern as
// renderHistory() above.
function renderLabelChecks() {
  const items = listLabelChecks(user.id);
  mainArea.innerHTML = `
    <div class="page-head">
      <span class="eyebrow">Label checks</span>
      <h1>Your label checks</h1>
      <p class="muted" style="margin-top: var(--space-2)">Stored in this browser only. ${items.length} check${items.length === 1 ? "" : "s"}. Run one any time at <a href="label-check.html">label-check.html</a> — no need to be logged in, but it'll land here when you are.</p>
    </div>
    ${items.length ? `
      <div class="card">
        <table class="history-table">
          <thead><tr><th>Product</th><th>Date</th><th>Status</th><th>Elements declared</th></tr></thead>
          <tbody>
            ${items.map((r) => `
              <tr>
                <td>${escapeDash(r.productLabel)}</td>
                <td>${new Date(r.createdAt).toLocaleString()}</td>
                <td>${statusBadge(r.status)}</td>
                <td class="muted">${r.declaredCount} / ${r.totalCount}</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>` : `
      <div class="card empty-state">
        <div class="glyph">${icon("tag", 40)}</div>
        <h3>No label checks yet</h3>
        <p>Run a free label check to see it here.</p>
        <a class="btn btn-primary" style="margin-top: var(--space-4)" href="label-check.html">Check a label</a>
      </div>`}
  `;
}

const LEAD_STATUS_LABEL = { new: "Sent", contacted: "Contacted", resolved: "Resolved" };
function leadStatusBadge(status) {
  const cls = status === "resolved" ? "pass" : status === "contacted" ? "warning" : "neutral";
  return `<span class="badge badge-${cls}">${LEAD_STATUS_LABEL[status] || status}</span>`;
}

const LEAD_KIND_LABEL = {
  doesnt_fit: "New product review", license: "License / registration", custom_bundle: "Custom plan enquiry",
  dispute: "Report dispute", escalation: "Report finding review", label_photo: "Label photo review",
};

// Fix per your "...or they are talking to a consultant, what that is at
// this stage" feedback: every consult.html hand-off used to be
// fire-and-forget with no record for the person who sent it — now shown
// here so they can see it was sent and what stage it's at.
async function renderConsultRequests() {
  mainArea.innerHTML = `<p class="muted">Loading…</p>`;
  const items = await listLeadsForUser(user.id);
  mainArea.innerHTML = `
    <div class="page-head">
      <span class="eyebrow">Consultant requests</span>
      <h1>Your consultant requests</h1>
      <p class="muted" style="margin-top: var(--space-2)">${items.length} request${items.length === 1 ? "" : "s"}.</p>
    </div>
    ${items.length ? `
      <div class="card">
        <table class="history-table">
          <thead><tr><th>Topic</th><th>Message</th><th>Date</th><th>Status</th></tr></thead>
          <tbody>
            ${items.map((l) => `
              <tr>
                <td>${LEAD_KIND_LABEL[l.kind] || l.kind}</td>
                <td class="muted" style="max-width: 320px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeDash(l.message)}</td>
                <td>${new Date(l.createdAt).toLocaleString()}</td>
                <td>${leadStatusBadge(l.status)}</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>` : `
      <div class="card empty-state">
        <div class="glyph">${icon("message", 40)}</div>
        <h3>No consultant requests yet</h3>
        <p>Every "talk to a consultant" hand-off will show up here once you send one.</p>
      </div>`}
  `;
}

// Fix per the "unescaped free text" review finding: `escapeDash` already
// covered `productLabel`/`message`, but two other free-text fields —
// Formulation Lab's `productName` and the New Submission `batchLotNumber`
// — were being dropped into innerHTML/attribute values with no escaping
// at all (both here and in build/site-controller.js's identical copy of
// these same tables). Pulling the actual escaping into its own
// `escapeHtml()` (used for both HTML content and attribute values below)
// means any future free-text field just needs to remember to call it —
// same helper either way, dash-fallback or not — rather than each call
// site hand-rolling its own regex.
function escapeHtml(s) {
  return s == null ? "" : String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeDash(s) {
  return s ? escapeHtml(s) : "—";
}

// ---------------------------------------------------------------
// Router
// ---------------------------------------------------------------
function router() {
  const hash = (window.location.hash || "#/new").replace(/^#\//, "");
  const [route, sub, rest] = hash.split("/");
  if (route === "history") { renderHistory(); setActiveNav("history"); }
  else if (route === "results") { renderResults(sub); setActiveNav(""); }
  else if (route === "labelchecks") { renderLabelChecks(); setActiveNav("labelchecks"); }
  else if (route === "consults") { renderConsultRequests(); setActiveNav("consults"); }
  else if (route === "lab" && sub === "new") { renderLabNew(rest); setActiveNav("lab"); }
  else if (route === "lab") { renderLab(); setActiveNav("lab"); }
  else { renderNew(); setActiveNav("new"); }
}

initChrome();
window.addEventListener("hashchange", router);
router();
