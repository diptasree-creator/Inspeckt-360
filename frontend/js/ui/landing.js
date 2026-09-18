import { FSSAI_CATEGORIES, CATEGORIES, NON_DAIRY_ANALOGUE_KEYWORDS, detectAnyCategoryId } from "../data/dairyBible.js";
import { getCurrentUser } from "../auth.js";
import { hydrateIcons } from "../icons.js";
import { submitLead } from "../leads.js";

hydrateIcons();

// ---------------------------------------------------------------
// Live-coverage copy — computed from CATEGORIES' own `live` flag so a
// category launch (or a marketing edit) can't leave the homepage
// claiming something the data doesn't back up. See Fix Plan Part 3,
// §2 ("the 'fully built' overclaim bug").
// ---------------------------------------------------------------
function liveDairyLabelsText() {
  const labels = CATEGORIES.filter((c) => c.live).map((c) => c.label);
  if (labels.length === 0) return "no dairy sub-categories yet";
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}
function dairyCoverageSummary() {
  const total = CATEGORIES.length;
  const live = CATEGORIES.filter((c) => c.live).length;
  return `${live} of ${total} dairy sub-categories live so far (${liveDairyLabelsText()})`;
}
// Fix per your "homepage can't be just for Milk... other language need
// to be more product all kinds" feedback: liveDairyLabelsText() above
// names every one of the 20 live dairy sub-categories by name, which is
// exactly right for the actual category grid below, but reads as
// "this is a dairy-only product" everywhere else it's dropped in —
// specifically the two mid-page explainer notes right under the hero,
// which is what you flagged. This shorter, count-based phrase (same
// wording as the hero's own stat) is what that copy uses instead; the
// full per-category enumeration stays exactly where it belongs, in the
// actual "Category coverage" grid section and per-card notes.
function liveDairyCountText() {
  const live = CATEGORIES.filter((c) => c.live).length;
  if (live === 0) return "no dairy product types yet";
  return `${live} dairy product types — milk to lactose & permeate powder`;
}
const pickCategoryNote = document.getElementById("pick-category-note");
if (pickCategoryNote) {
  pickCategoryNote.textContent = `Choose from the full FSSAI category list, spanning all 10 food groups — meat, seafood, bakery, beverages, and more. Dairy is the one fully compiled and checkable today (${liveDairyCountText()}); the rest are visible now and launching over time.`;
}
const whatGetsCheckedNote = document.getElementById("what-gets-checked-note");
if (whatGetsCheckedNote) {
  whatGetsCheckedNote.textContent = `Live today for Dairy (${liveDairyCountText()}); the same four-parameter structure — composition, testing parameters, labelling, shelf life — extends to every FSSAI category as its data is compiled and signed off.`;
}
const categoryCoverageNote = document.getElementById("category-coverage-note");
if (categoryCoverageNote) {
  categoryCoverageNote.textContent = `Dairy is live today — ${dairyCoverageSummary()}. Everything else is real — you can see what's coming and ask to be notified — but isn't checkable yet, because its regulatory data hasn't been compiled and signed off.`;
}

// ---------------------------------------------------------------
// Platform-wide category grid (Dairy live, rest "coming soon" with a
// notify-me capture — see PLATFORM_PLAN_V2.md §4).
// ---------------------------------------------------------------
function categoryCard(cat) {
  if (cat.live) {
    return `
      <div class="card category-card">
        <div class="row-between">
          <h3>${cat.label}</h3>
          <span class="badge badge-pass">Live</span>
        </div>
        <p class="desc">${cat.description}</p>
        <p class="category-card-note">${liveDairyLabelsText()} live now — more dairy categories launching soon.</p>
        <a class="btn btn-secondary btn-sm" href="signup.html">Start a check</a>
      </div>`;
  }
  return `
    <div class="card category-card soon" data-category-id="${cat.id}">
      <div class="row-between">
        <h3>${cat.label}</h3>
        <span class="badge badge-soon">Coming soon</span>
      </div>
      <p class="desc">${cat.description}</p>
      <form class="notify-row" data-notify-form>
        <input type="email" placeholder="you@company.com" required aria-label="Email for ${cat.label} launch notice" />
        <button class="btn btn-secondary btn-sm" type="submit">Notify me</button>
      </form>
    </div>`;
}

const grid = document.getElementById("category-grid");
if (grid) {
  grid.innerHTML = FSSAI_CATEGORIES.map(categoryCard).join("");
  grid.querySelectorAll("[data-notify-form]").forEach((form) => {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const card = form.closest(".category-card");
      const categoryId = card.dataset.categoryId;
      const category = FSSAI_CATEGORIES.find((c) => c.id === categoryId);
      const email = form.querySelector("input").value.trim();
      const btn = form.querySelector("button");
      btn.disabled = true;
      try {
        await submitLead("doesnt_fit", {
          contactEmail: email,
          message: `Notify me when ${category?.label || categoryId} launches.`,
          context: { category_id: categoryId, category_label: category?.label, type: "category_interest" },
        });
        form.outerHTML = `<p class="notify-done">Got it — we'll email you when ${category?.label || categoryId} launches.</p>`;
      } catch {
        btn.disabled = false;
        form.outerHTML = `<p class="notify-done">Couldn't save that right now — feel free to <a href="consult.html?kind=doesnt_fit">reach us directly</a> instead so you don't miss it.</p>`;
      }
    });
  });
}

// ---------------------------------------------------------------
// Entry-point search: "what are you working on?" — keyword-detects a
// license/registration request or an unsupported product and routes to
// the consultant intake; otherwise sends a recognized dairy product
// straight into the signup flow. See PLATFORM_PLAN_V2.md §2.2.
// ---------------------------------------------------------------
const LICENSE_KEYWORDS = ["license", "licence", "registration", "certificate", "renew", "fssai number"];
// NON_DAIRY_ANALOGUE_KEYWORDS and detectAnyCategoryId() both come from
// data/dairyBible.js now. detectAnyCategoryId() resolves the LONGEST
// matching keyword across every category, live or not, so a query like
// "milk powder" doesn't get mis-routed into a "milk" match just because
// "milk" is a substring of it (the original bug this fixed, back when
// this used a plain `liveDairyKeywords().some(k => q.includes(k))`
// substring test). Per review item C17, matching any dairy category —
// not just a live one — is now correct here: every match routes through
// research.html first, which is where the live/not-live distinction
// actually gets decided (see the comment there).

// ---------------------------------------------------------------
// Intent-first triage — added per the founder's request that different
// visitors arrive with different mindsets (a first-timer who doesn't
// know what to test, someone who just wants their label checked, and
// someone already formulating who wants a working/not-working verdict)
// and the app should ask what they want rather than funnelling everyone
// through the same product-name search. Matches route straight to the
// existing destination for that intent; "something else" and an
// unrecognized product both fall through to "talk to a consultant"
// rather than forcing a guess. The direct-search escape hatch stays
// for a visitor who already knows what they want and would rather skip
// the question — it reveals the exact same search box "explore" does.
// ---------------------------------------------------------------
const triageGrid = document.getElementById("triage-grid");
const searchWrap = document.getElementById("entry-search-wrap");
const searchPrompt = document.getElementById("entry-search-prompt");
const searchInput = document.getElementById("entry-search-input");
let searchIntent = "explore";

function revealSearch(intent, promptText) {
  searchIntent = intent;
  if (triageGrid) triageGrid.hidden = true;
  if (searchWrap) searchWrap.hidden = false;
  if (searchPrompt) searchPrompt.textContent = promptText;
  if (searchInput) searchInput.focus();
}

if (triageGrid) {
  triageGrid.querySelectorAll(".triage-option").forEach((btn) => {
    btn.addEventListener("click", () => {
      const intent = btn.dataset.intent;
      if (intent === "explore") {
        revealSearch("explore", "Tell us your product — we'll show you exactly what's required.");
      } else if (intent === "label") {
        revealSearch("label", "Tell us your product, even informally — we'll pull up its label checklist.");
      } else if (intent === "formulate") {
        // Fix per review item C3: Formulation Lab iterations draw from
        // the same paid-tier pool as New Submissions (see auth.js/
        // usage_pool.py) — signed-in visitors go straight to the Lab;
        // a new visitor signs up first, then lands there via the
        // `next=lab` hint auth-pages.js reads (see the comment there).
        window.location.href = getCurrentUser() ? "app.html#/lab" : "signup.html?next=lab";
      } else if (intent === "other") {
        window.location.href = "consult.html?kind=doesnt_fit";
      }
    });
  });
}
const skipTriageBtn = document.getElementById("skip-triage-btn");
if (skipTriageBtn) {
  skipTriageBtn.addEventListener("click", () => {
    revealSearch("explore", "Search for your product, or tell us straight away if it's something else.");
  });
}

const searchForm = document.getElementById("entry-search-form");
if (searchForm) {
  searchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const raw = document.getElementById("entry-search-input").value.trim();
    if (!raw) return;
    const q = raw.toLowerCase();

    // The "just check my label" intent has its own destination
    // (label-check.html) that does its own informal-name matching and
    // its own "doesn't match anything" fallback — it doesn't go through
    // research.html or the license/non-dairy detours below, which are
    // specific to the "what do I need to test" intent.
    if (searchIntent === "label") {
      window.location.href = `label-check.html?q=${encodeURIComponent(raw)}`;
      return;
    }

    if (LICENSE_KEYWORDS.some((k) => q.includes(k))) {
      window.location.href = `consult.html?kind=license&q=${encodeURIComponent(raw)}`;
      return;
    }
    // Fix per review item C17: any recognized dairy category — live or
    // not — now routes through research.html first, to show FSSAI's own
    // definition before anything else happens (signup, a consult intake
    // form). detectAnyCategoryId() generalizes detectLiveCategoryId() to
    // not-live categories too, per your confirmed answer that this
    // applies to "both live and not-live categories" — research.html
    // itself decides what the two next-step buttons should be from the
    // matched category's own `live` flag.
    if (!NON_DAIRY_ANALOGUE_KEYWORDS.some((k) => q.includes(k)) && detectAnyCategoryId(raw) !== null) {
      window.location.href = `research.html?q=${encodeURIComponent(raw)}`;
      return;
    }
    // Doesn't match any dairy category — proprietary/novel/unclear product.
    window.location.href = `consult.html?kind=doesnt_fit&q=${encodeURIComponent(raw)}`;
  });
}

// If already signed in, send primary CTAs straight to the dashboard.
const user = getCurrentUser();
if (user) {
  document.querySelectorAll('a[href="signup.html"], a[href="login.html"]').forEach((a) => {
    a.href = "app.html";
  });
  const loginBtn = document.querySelector(".nav-actions .btn-ghost");
  if (loginBtn) loginBtn.textContent = "Dashboard";
}
