/**
 * Renders a validateSubmission() result as a compliance report.
 * Shared between the "just submitted" flow and the history detail view.
 */
import { icon } from "../icons.js";

// Fix per your "check my numbers" feedback: every status a check can
// land on now carries the same 🟢/🔴/🟡/⚪ marker used throughout the
// lab-report flow (panelStepLab's verification block, the tally strip
// below) — one consistent visual language for "meets / doesn't meet /
// can't tell / wasn't run" everywhere a result shows up, not a
// different vocabulary per screen.
const STATUS_META = {
  PASS: { label: "Pass", dot: "🟢", icon: "✓", cls: "pass" },
  WARNING: { label: "Warning", dot: "🟡", icon: "!", cls: "warning" },
  FAIL: { label: "Fail", dot: "🔴", icon: "✕", cls: "fail" },
  // Fix per review item C17: a category with no compiled microbiology
  // panel yet (Ghee/Butter, for now) reports this instead of a
  // misleading green "Pass" for zero checks run — see validation.js's
  // validateSubmission().
  NOT_AVAILABLE: { label: "Not available yet", dot: "⚪", icon: "–", cls: "neutral" },
};

export function statusBadge(status) {
  const m = STATUS_META[status] || STATUS_META.WARNING;
  const cls = m.cls === "pass" ? "pass" : m.cls === "warning" ? "warning" : m.cls === "neutral" ? "neutral" : "fail";
  return `<span class="badge badge-${cls}">${m.label}</span>`;
}

function checkRow(c) {
  const cls = c.status === "PASS" ? "pass" : c.status === "WARNING" ? "warning" : c.status === "MISSING" ? "missing" : "fail";
  const icon = c.status === "PASS" ? "✓" : c.status === "WARNING" ? "!" : c.status === "MISSING" ? "?" : "✕";
  return `
    <div class="check-row">
      <div class="check-icon ${cls}">${icon}</div>
      <div class="check-main">
        <div class="label">${c.label}</div>
        <div class="meta">${c.ref || ""}${c.expected ? ` · Expected ${c.expected}` : ""}</div>
      </div>
      <div class="check-value">${c.actual ?? "—"}</div>
    </div>`;
}

// Fix per your "check my number situation" feedback: a Final Report needs
// an at-a-glance tally (Results assessed / Meet applicable criteria / Do
// not meet / Cannot be determined) instead of making someone count check
// rows themselves — and an explicit "assessment scope" sentence, since a
// tally that doesn't say what it does and doesn't cover is easy to
// over-read as a full regulatory clearance. Built from the same
// composition/microbiology/labelling check rows already rendered below,
// so it can't drift from what the report actually shows — MISSING
// (a test not yet run, a label element not yet declared) counts as
// "cannot be determined," never as a silent failure.
function resultTally(result) {
  const all = [
    ...result.composition.checks,
    ...result.microbiological.checks,
    ...result.labelling.checks,
  ];
  return {
    total: all.length,
    meets: all.filter((c) => c.status === "PASS").length,
    doesNotMeet: all.filter((c) => c.status === "FAIL").length,
    cannotDetermine: all.filter((c) => c.status === "WARNING" || c.status === "MISSING").length,
  };
}

function tallyTile(value, label, cls) {
  return `<div class="tally-tile ${cls}"><div class="tally-num">${value}</div><div class="tally-label">${label}</div></div>`;
}

function resultTallyStrip(categoryLabel, result) {
  const t = resultTally(result);
  return `
    <div class="card card-pad" style="margin-bottom: var(--space-6)">
      <h3 style="margin-bottom: var(--space-1)">Final report — results at a glance</h3>
      <p class="muted" style="font-size: var(--text-sm); margin-bottom: var(--space-4)">Every composition, microbiology, and labelling check run against this submission.</p>
      <div class="tally-grid">
        ${tallyTile(t.total, "Results assessed", "neutral")}
        ${tallyTile(t.meets, "🟢 Meet applicable criteria", "pass")}
        ${tallyTile(t.doesNotMeet, "🔴 Do not meet", "fail")}
        ${tallyTile(t.cannotDetermine, "🟡 Cannot be determined", "warning")}
      </div>
      <p class="muted" style="font-size: var(--text-xs); margin-top: var(--space-4)">
        <strong>Assessment scope:</strong> this covers only ${escapeHtmlLite(categoryLabel)}'s composition, microbiology,
        and labelling requirements as compiled in Inspeckt today — not every FSSAI provision that could ever apply to this
        product, and not a substitute for your own regulatory sign-off. A "cannot be determined" result means a test
        wasn't run or a label element wasn't yet declared, not that it failed.
      </p>
    </div>`;
}
// Small local escape — report.js has no existing HTML-escape helper of
// its own (unlike site-controller.js's escapeHtml()) and category labels
// are internal, trusted strings (CATEGORIES[].label), so this only
// guards against the literal characters that would break the attribute
// this string isn't even used in — kept anyway since it costs nothing
// and a future caller might pass an actual user string here.
function escapeHtmlLite(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function sectionCard(title, icon, section) {
  const statusLabel = section.status === "PASS" ? "All checks passed" : section.status === "WARNING" ? "Needs attention" : "Failing";
  return `
    <div class="card card-pad" style="margin-bottom: var(--space-5)">
      <div class="row-between" style="margin-bottom: var(--space-3)">
        <h3>${icon} ${title}</h3>
        ${statusBadge(section.status)}
      </div>
      ${section.checks.length
        ? section.checks.map(checkRow).join("")
        : `<p class="muted" style="font-size: var(--text-sm)">${section.note || "No checks applicable."}</p>`}
    </div>`;
}

// Design pass (founder feedback: the report reads as a repetitive wall of
// near-identical rows — 13-16 Labelling rows that only ever say "Declared"
// or "Not yet declared" don't need the same tall, three-column
// check-row treatment built for a lab measurement with a real numeric
// value. A compact chip grid says the same thing in a fraction of the
// vertical space and reads as a checklist, which is what it actually is.
// CRITICAL elements still not declared get a slightly warmer amber
// treatment than an ordinary MISSING one, so the ones worth fixing first
// are visually distinguishable from a quick glance, not just by reading
// every row's ref text.
function labelChip(c) {
  const cls = c.status === "PASS" ? "pass" : c.status === "FAIL" ? "fail" : c.severity === "CRITICAL" ? "missing critical" : "missing";
  const icon = c.status === "PASS" ? "✓" : c.status === "FAIL" ? "✕" : "?";
  const title = `${c.ref || ""}${c.expected ? ` · Expected ${c.expected}` : ""} — ${c.actual ?? ""}`;
  return `
    <span class="label-chip ${cls}" title="${title.replace(/"/g, "&quot;")}">
      <span class="chip-icon">${icon}</span>${c.label}
    </span>`;
}

export function labellingCard(section) {
  const total = section.checks.length;
  const declared = section.checks.filter((c) => c.status === "PASS").length;
  return `
    <div class="card card-pad" style="margin-bottom: var(--space-5)">
      <div class="row-between" style="margin-bottom: var(--space-1)">
        <h3>${icon("tag")} Labelling</h3>
        ${statusBadge(section.status)}
      </div>
      ${total
        ? `<p class="muted" style="font-size: var(--text-sm); margin-bottom: var(--space-4)">${declared} of ${total} required elements declared</p>
           <div class="label-chip-grid">${section.checks.map(labelChip).join("")}</div>`
        : `<p class="muted" style="font-size: var(--text-sm)">${section.note || "No checks applicable."}</p>`}
    </div>`;
}

const GATED_STATUS_META = {
  TEMPLATE_ONLY: { label: "Template only", cls: "neutral" },
  AVAILABLE: { label: "Available", cls: "pass" },
  NOT_CHECKED: { label: "Not checked", cls: "neutral" },
  NOT_YET_IMPLEMENTED: { label: "Not yet built", cls: "neutral" },
};

function gatedCard(title, iconMarkup, section) {
  const meta = GATED_STATUS_META[section.status] || GATED_STATUS_META.NOT_CHECKED;
  return `
    <div class="card card-pad" style="margin-bottom: var(--space-5)">
      <div class="row-between" style="margin-bottom: var(--space-3)">
        <h3>${iconMarkup} ${title}</h3>
        <span class="badge badge-${meta.cls}">${meta.label}</span>
      </div>
      <p class="muted" style="font-size: var(--text-sm)">${section.note}</p>
    </div>`;
}

export function renderReport(categoryLabel, result) {
  const banner = STATUS_META[result.overall_status] || STATUS_META.WARNING;
  const bannerText = {
    PASS: "This formulation meets the FSSAI standards checked.",
    WARNING: "Composition looks good so far — some items still need a real test result or a finalized label declaration before this is ready to sell.",
    FAIL: "One or more FSSAI requirements were tested or declared and did not meet the standard. Do not release this batch as labelled.",
  }[result.overall_status];

  // A MISSING item (test not yet run, label element not yet finalized)
  // reads as outstanding work, not a failure — it gets the same yellow
  // "warning" treatment as a WARNING check regardless of the underlying
  // check's severity. Only an item that was actually tested/declared and
  // came back non-compliant (a real FAIL) gets the red treatment.
  const violationItem = (v) => `
    <div class="violation-item ${v.status === "FAIL" && v.severity === "CRITICAL" ? "" : "warning"}">
      <div>
        <div class="sev">${v.severity}${v.status === "MISSING" ? " · NOT YET PROVIDED" : ""}</div>
        <div>${v.message}</div>
        <div class="muted" style="font-size: var(--text-xs); margin-top:2px">${v.ref || ""}</div>
      </div>
    </div>`;

  // Design pass: runLabelling()'s checks all share this exact ref string
  // (see validation.js), so it doubles as a reliable "this is a label
  // declaration, not a lab result" tag at the rendering layer — no change
  // to the data shape validateSubmission() returns, so nothing that reads
  // `result.violations` elsewhere (there are no such test-suite readers
  // today — confirmed via grep) is affected. Repeating all 13-16 label
  // elements here, having just shown every one of them in the Labelling
  // card above, was the single biggest source of this report reading as
  // a repetitive wall of text — collapsed into one disclosure instead so
  // the count is still honest (nothing is hidden, just tucked behind a
  // click) while the default view stays short and scannable.
  const LABEL_REF = "Labelling & Display Regs 2020";
  const labelViolations = result.violations.filter((v) => v.ref === LABEL_REF);
  const otherViolations = result.violations.filter((v) => v.ref !== LABEL_REF);

  const violationsHtml = result.violations.length
    ? `<div class="violations-list">
        ${otherViolations.map(violationItem).join("")}
        ${labelViolations.length ? `
          <details class="violations-collapsed">
            <summary>${labelViolations.length} label element${labelViolations.length === 1 ? "" : "s"} still to declare — see Labelling above, or click to list them here</summary>
            ${labelViolations.map(violationItem).join("")}
          </details>` : ""}
      </div>`
    : `<p class="muted" style="font-size: var(--text-sm)">No violations found.</p>`;

  return `
    <div class="status-banner ${banner.cls}" style="margin-bottom: var(--space-6)">
      <div class="icon">${banner.icon}</div>
      <div>
        <h2>${banner.label.toUpperCase()}</h2>
        <p>${bannerText}</p>
      </div>
    </div>

    ${resultTallyStrip(categoryLabel, result)}

    ${sectionCard("Composition", '<span class="icon-inline" style="width:18px;height:18px;font-weight:800;font-size:15px;line-height:18px">%</span>', result.composition)}
    ${sectionCard("Microbiology", icon("flask"), result.microbiological)}
    ${labellingCard(result.labelling)}
    ${result.nutrition_panel ? gatedCard("Nutrition panel", icon("clipboard"), result.nutrition_panel) : ""}
    ${result.claims ? gatedCard("Claims validation", icon("shield"), result.claims) : ""}

    <div class="card card-pad" style="margin-bottom: var(--space-5); background: var(--color-info-bg); border-color: var(--color-info-border)">
      <h3 style="color: var(--color-info-ink)">${icon("thermometer")} Shelf-life recommendation</h3>
      <p style="margin-top: var(--space-2); color: var(--color-ink-900)">
        <strong>${result.shelf_life.days ?? "—"} days</strong> at ${result.shelf_life.storage_temp}
      </p>
      ${result.shelf_life.note ? `<p class="muted" style="font-size: var(--text-xs); margin-top: var(--space-2)">${result.shelf_life.note}</p>` : ""}
    </div>

    <div class="card card-pad no-print" style="margin-bottom: var(--space-5); display:flex; align-items:center; justify-content:space-between; gap: var(--space-4); flex-wrap: wrap;">
      <div>
        <strong>${icon("clock")} This is your instant automated result.</strong>
        <!-- Fix per review item C15: the sign-off promise had no visible
             credential anywhere near it — compare tax platforms surfacing
             "Reviewed by [CA name], Membership No. X." Named per the
             founder's direction. -->
        <!-- Fix per your "48 hours needs to be removed": dropped the
             specific-timeframe promise — the sign-off queue behind it
             isn't live in this build, so a number here is a promise this
             product can't yet keep. Matches index.html's Expert sign-off
             card, which got the same fix. -->
        <p class="muted" style="font-size: var(--text-sm); margin-top: 2px">On a paid plan, a consultant signs off a PDF version of this report — that queue isn't connected in this build yet. Sign-off today is by Diptasree Chaudhuri, Founder, Inspeckt.</p>
      </div>
      <a class="btn btn-secondary btn-sm" href="consult.html?kind=escalation">Not sure about a finding? Talk to a consultant</a>
    </div>

    ${result.extra_notes && result.extra_notes.length ? `
      <div class="alert alert-info" style="margin-bottom: var(--space-5)">
        ${result.extra_notes.join("<br/>")}
      </div>` : ""}

    <div class="card card-pad" style="margin-bottom: var(--space-5)">
      <h3 style="margin-bottom: var(--space-3)">${icon("warning")} Violations &amp; items to fix (${result.violations.length})</h3>
      ${violationsHtml}
    </div>

    <div class="alert alert-info always-print" style="font-size: var(--text-xs)">
      ${result.disclaimer}
    </div>

    <div class="row no-print" style="margin-top: var(--space-6)">
      <button class="btn btn-secondary" onclick="window.print()">Print / Save as PDF</button>
      <a class="btn btn-primary" href="#/new">New submission</a>
    </div>
  `;
}
