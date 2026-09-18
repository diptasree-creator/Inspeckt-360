import { PRICING_TIERS, UNIT_NOTE } from "../data/pricing.js";
import { hydrateIcons } from "../icons.js";
import { getCurrentUser, setTier } from "../auth.js";

hydrateIcons();

const user = getCurrentUser();

function tierCard(tier) {
  const isFullConsult = tier.id === "full_consultation";
  let ctaHtml;
  if (isFullConsult) {
    ctaHtml = `<a class="btn ${tier.highlight ? "btn-secondary" : "btn-primary"} btn-block" href="consult.html?kind=custom_bundle">Talk to a consultant</a>`;
  } else if (user) {
    const already = user.tier === tier.id;
    ctaHtml = `<button class="btn ${tier.highlight ? "btn-secondary" : "btn-primary"} btn-block" data-purchase="${tier.id}" ${already ? "disabled" : ""} ${already ? "" : 'title="No real payment is charged in this build — this simulates the purchase so you can see what unlocks."'}>${already ? "Current plan" : `Purchase ${tier.label}`}</button>`;
  } else {
    ctaHtml = `<a class="btn ${tier.highlight ? "btn-secondary" : "btn-primary"} btn-block" href="signup.html">Get started</a>`;
  }
  return `
    <div class="card pricing-card ${tier.highlight ? "highlight" : ""}">
      <div>
        <div class="tier-label">${tier.label}</div>
        <div class="tier-price">${tier.price_display}</div>
        <div class="tier-billing">${tier.billing}</div>
      </div>
      <ul>${tier.included.map((i) => `<li>${i}</li>`).join("")}</ul>
      ${tier.overage ? `<div class="overage">${tier.overage}</div>` : ""}
      ${ctaHtml}
    </div>`;
}

const grid = document.getElementById("pricing-grid");
if (grid) {
  grid.innerHTML = PRICING_TIERS.map(tierCard).join("");
  // Fix per review item C2 ("Add a plain 'what counts as one unit' line").
  const unitNote = document.getElementById("pricing-unit-note");
  if (unitNote) unitNote.textContent = UNIT_NOTE;
  grid.querySelectorAll("[data-purchase]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      // Mocked purchase — no real payment, but a real server-side write
      // (POST /api/v1/pricing/purchase — backend/app/routers/pricing.py).
      const idle = btn.textContent;
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Purchasing…';
      try {
        await setTier(btn.dataset.purchase);
        window.location.href = "app.html#/lab";
      } catch (err) {
        alert(`Couldn't complete that purchase: ${err.message}`);
        btn.disabled = false;
        btn.textContent = idle;
      }
    });
  });
}
