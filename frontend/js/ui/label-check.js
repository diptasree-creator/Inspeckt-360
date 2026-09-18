/**
 * Label Check — persona 2 stand-in ("I just want my label checked",
 * per the founder's triage design). Describe your product informally,
 * confirm the matched FSSAI category, upload your label, and see a
 * report scoped to ONLY the Labelling section — no composition or
 * microbiology fields, unlike the full New Submission form. Free, no
 * account needed, same as research.html.
 *
 * Unlike the published claude.ai Artifact demo (which is one static
 * HTML file with no server, and can't call this), THIS page is meant to
 * be served by the real FastAPI backend (see backend/app/main.py's
 * static mount) — so it calls the real automated-scan endpoint,
 * POST /api/v1/label-checks/scan (backend/app/routers/label_checks.py),
 * over a same-origin fetch(). If that call fails for any reason — the
 * backend deployment has no ANTHROPIC_API_KEY set (501), this page is
 * opened standalone with no backend behind it (network error), the
 * scan itself fails — this falls back to the same honest manual
 * checklist this page always had, never a fabricated result. Every
 * screen still keeps a visible "review my actual photo" link to
 * consult.html?kind=label_photo, since automated or not, this is never
 * a substitute for professional sign-off.
 */
import { CATEGORIES, LABEL_ELEMENTS_ALL, LABEL_ELEMENTS_BY_CATEGORY, NON_DAIRY_ANALOGUE_KEYWORDS, detectLiveCategoryId } from "../data/dairyBible.js";
import { checkLabelOnly } from "../validation.js";
import { labellingCard } from "./report.js";
import { hydrateIcons } from "../icons.js";
import { getCurrentUser } from "../auth.js";
// Fix per your "the dashboard needs to have everything... if they
// checked labels" feedback: this page stays free/no-login (see the
// file header), but if someone happens to be logged in when they run a
// check, save it to their dashboard history — see labelChecks.js.
import { saveLabelCheck } from "../labelChecks.js";

const params = new URLSearchParams(window.location.search);
const host = document.getElementById("label-check-content");

const CONSULT_PHOTO_LINK = `<a href="consult.html?kind=label_photo">Have a consultant review your actual label photo instead →</a>`;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

let state = { phase: "identify", raw: (params.get("q") || "").trim(), categoryId: null, scanResult: null };

/** Calls the real backend scan endpoint. Throws on any failure (network
 * error, 501 "not configured", 502 upstream failure) — the caller
 * decides how to fall back; this never returns a fabricated result. */
async function scanLabel(categoryId, files) {
  const formData = new FormData();
  formData.append("category", categoryId);
  for (const f of files) formData.append("files", f);
  const res = await fetch("/api/v1/label-checks/scan", { method: "POST", body: formData });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((body && body.detail) || `Scan failed (HTTP ${res.status})`);
  }
  return body;
}

function detect(raw) {
  const q = raw.toLowerCase();
  if (NON_DAIRY_ANALOGUE_KEYWORDS.some((k) => q.includes(k))) return null;
  return detectLiveCategoryId(raw);
}

// If a query already arrived from the homepage triage, try to resolve it
// immediately instead of making the visitor re-type what they just said.
if (state.raw) {
  const found = detect(state.raw);
  state.categoryId = found;
  state.phase = found ? "confirm" : "identify";
}

function renderIdentify(notice) {
  host.innerHTML = `
    <span class="eyebrow">Label check</span>
    <h1>What's the product?</h1>
    <p class="lead">Describe it informally — "milk powder," "cheddar cheese," "curd" — you don't need the exact
      FSSAI term. We'll match it to the right category and pull up its label checklist.</p>
    ${notice ? `<div class="alert alert-warning" style="margin: var(--space-5) 0">${notice}</div>` : ""}
    <form id="lc-identify-form" class="entry-search" style="margin-top: var(--space-6)">
      <input type="search" id="lc-identify-input" placeholder="e.g. &quot;milk powder&quot;" value="${escapeHtml(state.raw)}" />
      <button class="btn btn-primary" type="submit">Continue</button>
    </form>
    <p class="muted" style="margin-top: var(--space-5); font-size: var(--text-sm)">${CONSULT_PHOTO_LINK}</p>
  `;
  document.getElementById("lc-identify-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const raw = document.getElementById("lc-identify-input").value.trim();
    if (!raw) return;
    state.raw = raw;
    const found = detect(raw);
    if (found) {
      state.categoryId = found;
      state.phase = "confirm";
      render();
    } else {
      renderIdentify(`We couldn't match "${escapeHtml(raw)}" to a live category yet. Try describing it differently, or talk to a consultant — an automated check needs a matched category to know which label elements even apply.`);
    }
  });
}

function renderConfirm() {
  const category = CATEGORIES.find((c) => c.id === state.categoryId);
  // Fix per your "we need to move on from definition" feedback: the
  // FSSAI definition used to be the main content of this screen — a
  // full blockquote card between the question and the actual "yes/no"
  // decision, so the citation had to be read (or scrolled past) before
  // getting to the check itself. The decision is now the primary
  // content; the definition is still here (a compliance product
  // shouldn't hide its own citations) but as an optional, collapsed
  // reference underneath, not the thing standing between you and your
  // result.
  host.innerHTML = `
    <span class="eyebrow">Label check</span>
    <h1>Did we get that right?</h1>
    <p class="lead">You said "${escapeHtml(state.raw)}" — the closest match is <strong>${escapeHtml(category.label)}</strong>.</p>
    <div style="margin-top: var(--space-5); display:flex; gap: var(--space-3); flex-wrap: wrap;">
      <button class="btn btn-primary btn-lg" type="button" id="lc-confirm-yes">Yes, check its label</button>
      <button class="btn btn-secondary btn-lg" type="button" id="lc-confirm-no">No, let me re-describe it</button>
    </div>
    <details class="violations-collapsed" style="margin-top: var(--space-5)">
      <summary>See FSSAI's definition for ${escapeHtml(category.label)}</summary>
      <div class="card card-pad-sm" style="margin-top: var(--space-3)">
        <blockquote style="margin:0; padding-left: var(--space-4); border-left: 3px solid var(--color-primary-600); font-style: italic;">${escapeHtml(category.definition)}</blockquote>
        <p class="muted" style="margin-top: var(--space-3); font-size: var(--text-sm)">${escapeHtml(category.definitionRef)}</p>
      </div>
    </details>
  `;
  document.getElementById("lc-confirm-yes").addEventListener("click", () => { state.phase = "upload"; render(); });
  document.getElementById("lc-confirm-no").addEventListener("click", () => { state.phase = "identify"; render(); });
}

function elementsFor(categoryId) {
  return [...LABEL_ELEMENTS_ALL, ...(LABEL_ELEMENTS_BY_CATEGORY[categoryId] || [])];
}

/** Upload-first entry point, matching labelveda.com's flow: front/back/
 * nutrition-panel photos, scanned automatically via the real backend
 * (scanLabel() above). Any failure falls back to "Skip — I'll tick it
 * myself" rather than blocking the whole page on a working deployment. */
function renderUpload() {
  const category = CATEGORIES.find((c) => c.id === state.categoryId);
  host.innerHTML = `
    <span class="eyebrow">${escapeHtml(category.label)}</span>
    <h1>Upload your label</h1>
    <p class="lead">Front, back, nutrition panel — as many sides as you have. We'll scan it automatically and
      you'll confirm the results before anything counts as your final check.</p>
    <div class="card card-pad" style="margin-top: var(--space-6)">
      <div class="field">
        <label for="lc-upload-files">Label photos <span class="muted" style="font-weight:400">(up to 6 — JPEG, PNG, or WEBP)</span></label>
        <input type="file" id="lc-upload-files" accept="image/jpeg,image/png,image/webp" multiple />
        <span class="hint">Sent to this deployment's backend for scanning — nothing is stored beyond this check. If scanning isn't available here, you'll tick the checklist yourself instead.</span>
      </div>
      <div id="lc-upload-status" class="muted" style="font-size: var(--text-sm); margin-top: var(--space-2)"></div>
      <div style="margin-top: var(--space-5); display:flex; gap: var(--space-3); flex-wrap: wrap;">
        <button class="btn btn-primary btn-lg" type="button" id="lc-upload-scan">Scan my label</button>
        <button class="btn btn-secondary btn-lg" type="button" id="lc-upload-skip">Skip — I'll tick it myself</button>
      </div>
    </div>
  `;
  const statusEl = document.getElementById("lc-upload-status");
  document.getElementById("lc-upload-skip").addEventListener("click", () => { state.scanResult = null; state.phase = "checklist"; render(); });
  document.getElementById("lc-upload-scan").addEventListener("click", async (e) => {
    const input = document.getElementById("lc-upload-files");
    const files = input.files ? Array.from(input.files) : [];
    if (!files.length) { statusEl.textContent = "Choose at least one photo, or use \"Skip\" to tick the checklist yourself."; return; }
    const btn = e.currentTarget;
    btn.disabled = true;
    statusEl.textContent = "Scanning your label…";
    try {
      const result = await scanLabel(state.categoryId, files);
      state.scanResult = result.elements;
      state.phase = "checklist";
      render();
    } catch (err) {
      // Honest fallback, per this file's header comment: never a
      // fabricated result — just the same manual checklist this page
      // has always had, with a plain explanation of why scanning didn't
      // run this time.
      statusEl.textContent = `Scanning didn't work this time (${err.message}). You can still tick the checklist yourself below.`;
      btn.disabled = false;
      state.scanResult = null;
    }
  });
}

function renderChecklist() {
  const category = CATEGORIES.find((c) => c.id === state.categoryId);
  const elements = elementsFor(state.categoryId);
  const scanByKey = new Map((state.scanResult || []).map((r) => [r.key, r]));
  const scanBanner = state.scanResult
    ? `<div class="alert alert-info" style="margin-bottom: var(--space-5)">We pre-filled this from your label scan — please confirm each one is actually correct before submitting. A scan can misread a photo; you're the final check.</div>`
    : "";
  host.innerHTML = `
    <span class="eyebrow">${escapeHtml(category.label)}</span>
    <h1>Tick what's already on your label</h1>
    <p class="lead">Leave anything unfinished unticked — that's normal at this stage, not a failure. We'll show
      you exactly what's still missing.</p>
    ${scanBanner}
    <form id="lc-checklist-form" class="card card-pad" style="margin-top: var(--space-6)">
      ${elements.map((el) => {
        const scanned = scanByKey.get(el.key);
        const checkedAttr = scanned?.detected ? "checked" : "";
        const scanNote = scanned
          ? `<span class="hint">${scanned.detected ? "Scan found: " + escapeHtml(scanned.extracted_text || "(present, no text read)") : "Scan didn't find this"}${scanned.confidence ? ` · confidence: ${escapeHtml(scanned.confidence)}` : ""}${scanned.note ? ` · ${escapeHtml(scanned.note)}` : ""}</span>`
          : "";
        return `
        <div class="checkbox-row">
          <input type="checkbox" id="lc-${el.key}" ${checkedAttr} />
          <label for="lc-${el.key}">${escapeHtml(el.label)}${scanNote}</label>
        </div>`;
      }).join("")}
      <div style="margin-top: var(--space-5); display:flex; gap: var(--space-3); flex-wrap: wrap;">
        <button class="btn btn-primary btn-lg" type="submit">Check my label</button>
        <button class="btn btn-secondary btn-lg" type="button" id="lc-back">← Wrong product? Go back</button>
      </div>
    </form>
  `;
  document.getElementById("lc-back").addEventListener("click", () => { state.phase = "upload"; render(); });
  document.getElementById("lc-checklist-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const label = {};
    elements.forEach((el) => { label[el.key] = document.getElementById(`lc-${el.key}`).checked; });
    state.labelResult = checkLabelOnly(state.categoryId, label);
    const category = CATEGORIES.find((c) => c.id === state.categoryId);
    saveLabelCheck(getCurrentUser(), {
      productLabel: state.raw || category?.label || state.categoryId,
      categoryId: state.categoryId,
      section: state.labelResult,
    });
    state.phase = "report";
    render();
  });
}

function renderReport() {
  const category = CATEGORIES.find((c) => c.id === state.categoryId);
  const section = state.labelResult;
  const missingCritical = section.checks.some((c) => c.status !== "PASS" && c.severity === "CRITICAL");
  const scanNote = state.scanResult
    ? "This result includes elements pre-filled by an automated scan, which you reviewed and confirmed above."
    : "This ran entirely from what you ticked by hand — no automated scan was used for this check.";
  host.innerHTML = `
    <span class="eyebrow">${escapeHtml(category.label)}</span>
    <h1>Label check result</h1>
    ${labellingCard(section)}
    <div class="card card-pad no-print" style="margin-bottom: var(--space-5)">
      <strong>This is a checklist result, not a certified compliance decision.</strong>
      <p class="muted" style="font-size: var(--text-sm); margin-top: var(--space-2)">${scanNote} Either way, it only
        checks for elements that are missing — it doesn't check for wording that isn't allowed, or measure font
        size or symbol placement. ${missingCritical ? "With critical elements still missing, a " : "A "}
        consultant review is the closest thing to a real pre-print check we can offer today.</p>
      <a class="btn btn-secondary btn-sm" style="margin-top: var(--space-3)" href="consult.html?kind=label_photo">Have a consultant review your actual label photo</a>
    </div>
    <div style="display:flex; gap: var(--space-3); flex-wrap: wrap;">
      <a class="btn btn-primary" href="signup.html?q=${encodeURIComponent(state.raw)}">Want composition &amp; microbiology checked too? Create a free account</a>
      <button class="btn btn-secondary" type="button" id="lc-restart">Check another product</button>
    </div>
  `;
  document.getElementById("lc-restart").addEventListener("click", () => {
    state = { phase: "identify", raw: "", categoryId: null, scanResult: null };
    render();
  });
  hydrateIcons(host);
}

function render() {
  if (!host) return;
  if (state.phase === "identify") renderIdentify();
  else if (state.phase === "confirm") renderConfirm();
  else if (state.phase === "upload") renderUpload();
  else if (state.phase === "checklist") renderChecklist();
  else renderReport();
  hydrateIcons(host);
}

render();
