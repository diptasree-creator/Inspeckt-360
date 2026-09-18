import { submitLead, buildConsultMailto } from "../leads.js";
import { hydrateIcons } from "../icons.js";
import { getCurrentUser } from "../auth.js";

hydrateIcons();

const COPY = {
  doesnt_fit: {
    title: "This looks like it needs expert review",
    subtitle:
      "FSSAI doesn't have a defined category or standard for what you've described yet — that doesn't mean it's non-compliant, it means our automated checks can't cover it. A consultant can help you figure out the right path.",
    messageLabel: "What are you trying to build?",
  },
  license: {
    title: "Let's get your license or registration sorted",
    subtitle:
      "Applying for or renewing an FSSAI license or registration certificate isn't something our compliance engine handles — that's a filing our consultants take care of directly.",
    messageLabel: "What do you need help with?",
  },
  custom_bundle: {
    title: "Tell us what you need — we'll work out a plan",
    subtitle:
      "For co-packers, consultants managing multiple client brands, or volume beyond our standard tiers, we build a custom plan and quote it directly with you.",
    messageLabel: "What are you looking to check, and roughly how much volume?",
  },
  dispute: {
    title: "Dispute a finding in your report",
    subtitle:
      "Every rule in your report cites its exact regulation. If you think one was applied wrong, a consultant will review it with you.",
    messageLabel: "Which finding, and why do you think it's wrong?",
  },
  escalation: {
    title: "This finding needs expert review",
    subtitle:
      "One or more results in your report were flagged as ambiguous or an edge case rather than a clean pass/fail — those need a person, not just the engine.",
    messageLabel: "Anything else we should know?",
  },
  // label-check.html's checklist only knows what you tell it — it can't
  // read an actual label photo yet. This routes anyone who wants that
  // (front/back photo review, catching a claim that shouldn't be on
  // there) to a person instead, per the founder's persona-2 design.
  label_photo: {
    title: "Have a consultant review your actual label",
    subtitle:
      "The checklist here only knows what you tell it — it can't read a label photo, and it doesn't check for wording you're not allowed to use (only for elements that are missing). Send us both sides of your label and a consultant will check it properly, including any claims.",
    messageLabel: "Anything specific you're unsure about?",
  },
};

const params = new URLSearchParams(location.search);
const kind = COPY[params.get("kind")] ? params.get("kind") : "doesnt_fit";
const prefillMessage = params.get("q") || "";
const copy = COPY[kind];

document.getElementById("intake-title").textContent = copy.title;
document.getElementById("intake-subtitle").textContent = copy.subtitle;
document.getElementById("f-message-label").textContent = copy.messageLabel;
if (prefillMessage) document.getElementById("f-message").value = prefillMessage;

const user = getCurrentUser();
if (user) {
  document.getElementById("f-name").value = user.name || "";
  document.getElementById("f-email").value = user.email || "";
  document.getElementById("f-company").value = user.company || "";
}

document.getElementById("intake-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const submitBtn = form.querySelector('button[type="submit"]');
  const idleLabel = submitBtn?.textContent;
  if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '<span class="spinner"></span> Sending…'; }

  let lead;
  try {
    lead = await submitLead(kind, {
      contactName: form.contactName.value.trim(),
      contactEmail: form.contactEmail.value.trim(),
      contactPhone: form.contactPhone.value.trim(),
      companyName: form.companyName.value.trim(),
      message: form.message.value.trim(),
      context: { source: "consult.html" },
    });
  } catch (err) {
    // Fix per your "Talk to a consultant is still not working" report:
    // never leave this looking broken with no feedback — surface exactly
    // what went wrong and let the visitor try again, or fall back to a
    // plain mailto: with what they already typed (buildConsultMailto()
    // only needs the local form fields, not a server response).
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = idleLabel; }
    const fallback = buildConsultMailto({
      id: "not yet recorded", kind,
      contactName: form.contactName.value.trim(), contactEmail: form.contactEmail.value.trim(),
      contactPhone: form.contactPhone.value.trim(), companyName: form.companyName.value.trim(),
      message: form.message.value.trim(),
    });
    document.getElementById("form-alert")?.remove();
    const alertEl = document.createElement("div");
    alertEl.id = "form-alert";
    alertEl.className = "alert alert-danger";
    alertEl.style.marginBottom = "var(--space-4)";
    alertEl.innerHTML = `Couldn't send this automatically (${err.message}). <a href="${fallback}">Email us directly instead</a> — nothing you typed is lost.`;
    form.prepend(alertEl);
    return;
  }

  document.getElementById("intake-form-wrap").style.display = "none";
  document.getElementById("intake-confirmation").style.display = "block";
  document.getElementById("confirm-id").textContent = lead.id;
  const mailtoUrl = buildConsultMailto(lead);
  document.getElementById("confirm-mailto-btn").href = mailtoUrl;

  // Fix per your "Talk to a consultant is still not working" report: this
  // used to also do `window.location.href = mailtoUrl` here, firing the
  // email app automatically on submit. That auto-navigation is exactly
  // what's unreliable in a browser with no mail client registered, or one
  // that blocks a script-triggered top-level navigation to a non-http(s)
  // scheme — it can silently do nothing (no error, no visible effect),
  // which reads as "broken" even though the request itself was recorded
  // fine by submitLead() above. The visible "Open my email app" button is
  // now the one, explicit, user-initiated way to trigger it — a real
  // <a href="mailto:...">, which every browser knows how to hand off —
  // and "Copy the message instead" below is the always-working fallback.

  // Some devices/browsers have no mail app at all — copying the message
  // text is a real fallback that works everywhere, not just a "nice to
  // have," so it's an equal, visible option rather than buried.
  document.getElementById("confirm-copy-btn").addEventListener("click", async () => {
    const btn = document.getElementById("confirm-copy-btn");
    const body = [
      lead.message || "(no message entered)",
      "",
      `Name: ${lead.contactName || "—"}`,
      `Company: ${lead.companyName || "—"}`,
      `Phone: ${lead.contactPhone || "—"}`,
      `Email: ${lead.contactEmail || "—"}`,
      `Reference: ${lead.id}`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(`To: hello@inspecktfoodsolutions.com\n\n${body}`);
      btn.textContent = "Copied — paste it anywhere";
    } catch {
      btn.textContent = "Couldn't copy — select the reference below instead";
    }
  });
});
