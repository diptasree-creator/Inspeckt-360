/**
 * Research-vs-formulation fork — review item C17.
 *
 * Landed here (from the homepage search, or a chat "just researching"
 * choice — see site-controller.js's renderResearchFork() for the SPA's
 * in-chat equivalent) with a `?q=` describing a product. Before anything
 * else happens — signup, a consult intake form, a chat's first question —
 * show FSSAI's own definition of the matching category, self-serve, per
 * your confirmed answer that research should show "FSSAI's
 * definition/standard, self-serve" rather than routing straight past it.
 * Applies to live AND not-live categories alike (detectAnyCategoryId(),
 * not detectLiveCategoryId() — see the comment on it in dairyBible.js).
 *
 * Two calls to action, both offered rather than picking one for the
 * visitor ("Offer both" per your answer): for a live category, "Continue"
 * goes on to an actual check; for a not-live one there's nothing live to
 * continue to yet, so the consultant link is the only real next step —
 * still offered, just not paired with a second button that has nowhere
 * to go.
 */
import { CATEGORIES, NON_DAIRY_ANALOGUE_KEYWORDS, detectAnyCategoryId } from "../data/dairyBible.js";
import { getCurrentUser } from "../auth.js";
import { hydrateIcons } from "../icons.js";

const params = new URLSearchParams(window.location.search);
const raw = (params.get("q") || "").trim();
const host = document.getElementById("research-content");

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function render() {
  if (!host) return;
  const q = raw.toLowerCase();
  const categoryId = NON_DAIRY_ANALOGUE_KEYWORDS.some((k) => q.includes(k)) ? null : detectAnyCategoryId(raw);
  const category = categoryId ? CATEGORIES.find((c) => c.id === categoryId) : null;

  if (!raw || !category) {
    // Nothing recognizable to define — this page has no job to do here;
    // the consult intake (kind=doesnt_fit) is the right destination, same
    // as it always was before this fork existed.
    window.location.href = `consult.html?kind=doesnt_fit&q=${encodeURIComponent(raw)}`;
    return;
  }

  const continueHref = category.live
    ? `${getCurrentUser() ? "app.html" : "signup.html"}?q=${encodeURIComponent(raw)}`
    : null;
  // Fix per your "let them write the problem then give them option what
  // they need": this used to be a dead end — a definition plus exactly
  // 2 buttons (continue / consultant), with no way to say what you
  // actually came here to do. Added a "check my label" option (live
  // categories only — ties the research fork into the Label Check page
  // instead of leaving it undiscoverable) and, below the fixed options,
  // a free-text box that goes straight to a consultant with whatever
  // was typed, for anything that doesn't fit the 3 concrete paths.
  const labelCheckHref = category.live ? `label-check.html?q=${encodeURIComponent(raw)}` : null;
  const consultHref = `consult.html?kind=doesnt_fit&q=${encodeURIComponent(raw)}`;

  host.innerHTML = `
    <span class="eyebrow">${escapeHtml(category.label)}</span>
    <h1>Here's FSSAI's definition</h1>
    <p class="lead">You mentioned "${escapeHtml(raw)}" — the closest FSSAI category is <strong>${escapeHtml(category.label)}</strong>${category.live ? "" : ' <span class="badge badge-soon" style="vertical-align:middle">Coming soon</span>'}.</p>
    <div class="card" style="margin-top: var(--space-6)">
      <blockquote style="margin:0; padding-left: var(--space-4); border-left: 3px solid var(--color-primary-600); font-style: italic;">${escapeHtml(category.definition)}</blockquote>
      <p class="muted" style="margin-top: var(--space-3); font-size: var(--text-sm)">${escapeHtml(category.definitionRef)}</p>
    </div>
    <p class="muted" style="margin-top: var(--space-6); font-size: var(--text-sm); font-weight:600">What do you need from here?</p>
    <div style="margin-top: var(--space-3); display:flex; gap: var(--space-3); flex-wrap: wrap;">
      ${continueHref ? `<a class="btn btn-primary btn-lg" href="${continueHref}">I have a formulation — continue</a>` : ""}
      ${labelCheckHref ? `<a class="btn btn-secondary btn-lg" href="${labelCheckHref}">Just check my label</a>` : ""}
      <a class="btn ${continueHref || labelCheckHref ? "btn-secondary" : "btn-primary"} btn-lg" href="${consultHref}">Talk to a consultant</a>
    </div>
    ${category.live
      ? `<p class="muted" style="margin-top: var(--space-4); font-size: var(--text-sm)">Just researching for now? That's fine too — the definition above is yours to keep, and a consultant can help whenever you're ready to go further.</p>`
      : `<p class="muted" style="margin-top: var(--space-4); font-size: var(--text-sm)">${escapeHtml(category.label)} isn't a live automated check here yet — a consultant can help you work through it directly in the meantime.</p>`}
    <div class="card card-pad-sm" style="margin-top: var(--space-6)">
      <p style="font-weight:600; font-size: var(--text-sm)">None of these? Tell us what's actually going on.</p>
      <form id="research-else-form" style="margin-top: var(--space-3)">
        <textarea id="research-else-input" rows="3" placeholder="e.g. &quot;I need help with an export label&quot; or describe the actual problem"></textarea>
        <button class="btn btn-secondary" type="submit" style="margin-top: var(--space-3)">Send this to a consultant</button>
      </form>
    </div>
  `;
  hydrateIcons(host);

  const elseForm = document.getElementById("research-else-form");
  elseForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = document.getElementById("research-else-input").value.trim();
    if (!text) return;
    window.location.href = `consult.html?kind=doesnt_fit&q=${encodeURIComponent(text)}`;
  });
}

render();
