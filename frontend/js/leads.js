/**
 * Inspeckt — human hand-off capture, backed by the real FastAPI backend
 * (POST/GET /api/v1/leads — backend/app/routers/leads.py). Every "talk to
 * a consultant" moment in the product — a product that doesn't fit any
 * FSSAI category, a license/registration request, a custom-bundle
 * enquiry, a dispute, or a rule-level escalation from a report — is
 * submitted here. See PLATFORM_PLAN_V2.md §3 and §6.
 *
 * Used to write only to this browser's localStorage, with nothing behind
 * it at all — see git history for that version, and the long comment
 * that used to sit here about mailto: being "the one delivery mechanism
 * that works with no backend." The backend now actually emails the
 * consultant team on every submission (see backend/app/email_adapter.py's
 * ResendEmailAdapter, once EMAIL_PROVIDER=resend is configured), so the
 * mailto: fallback below is now a backup path — kept because it's a real,
 * zero-configuration way for a visitor to reach a human even if this
 * deployment's email sending isn't set up yet, not because it's the only
 * one.
 */
import { apiFetch } from "./api.js";

/**
 * @param {"doesnt_fit"|"license"|"custom_bundle"|"dispute"|"escalation"} kind
 * @param {{contactName?:string, contactEmail:string, contactPhone?:string, companyName?:string, message?:string, context?:object, userId?:string|null}} details
 * @returns {Promise<object>} the lead, including its server-assigned id —
 *   merges `details` back in (rather than only returning what the server
 *   echoes back) so buildConsultMailto() below has the contact fields it
 *   needs without a second round-trip; POST /api/v1/leads intentionally
 *   doesn't echo them back (see LeadOut in backend/app/schemas.py).
 */
export async function submitLead(kind, details) {
  const record = await apiFetch("/api/v1/leads", {
    method: "POST",
    // Works logged out too (get_current_user_optional server-side) — the
    // Authorization header is only attached by apiFetch when a session
    // token actually exists, matching this endpoint's own design.
    body: {
      kind,
      contact_name: details.contactName || null,
      contact_email: details.contactEmail,
      contact_phone: details.contactPhone || null,
      company_name: details.companyName || null,
      message: details.message || null,
      context: details.context || null,
    },
  });
  return { ...details, id: record.id, kind: record.kind, status: record.status, createdAt: record.created_at };
}

/** A logged-in founder's own consultant requests — see backend's
 * GET /api/v1/leads, which scopes this to the current account server-side
 * (a lead submitted logged out never has an owner to scope it to).
 * @returns {Promise<Array>}
 */
export async function listLeadsForUser(userId) {
  let rows;
  try {
    rows = await apiFetch("/api/v1/leads");
  } catch {
    return [];
  }
  return rows.map((r) => ({
    id: r.id, userId, kind: r.kind, status: r.status, message: r.message, createdAt: r.created_at,
  }));
}

// ---------------------------------------------------------------
// Real delivery, without relying on this deployment's email being set up
// ----------------------------------------------------------------
// A mailto: link is a delivery mechanism that works with zero backend
// configuration: it opens the *visitor's own* email client with the
// message pre-filled, and sending it is a real email from a real inbox to
// a real inbox — a useful fallback for a deployment that hasn't set
// EMAIL_PROVIDER=resend yet (see this file's header comment).
// CONSULT_INBOX_EMAIL must be a real, monitored address before this goes
// anywhere near real customers.
export const CONSULT_INBOX_EMAIL = "hello@inspecktfoodsolutions.com";

const LEAD_KIND_SUBJECT = {
  doesnt_fit: "New product — needs review",
  license: "License / registration request",
  custom_bundle: "Custom plan enquiry",
  dispute: "Dispute a report finding",
  escalation: "Report finding needs review",
  label_photo: "Label photo review request",
};

export function buildConsultMailto(lead) {
  const subject = `Inspeckt enquiry: ${LEAD_KIND_SUBJECT[lead.kind] || "Consultant request"} (ref ${lead.id})`;
  const body = [
    lead.message || "(no message entered)",
    "",
    `Name: ${lead.contactName || "—"}`,
    `Company: ${lead.companyName || "—"}`,
    `Phone: ${lead.contactPhone || "—"}`,
    `Email: ${lead.contactEmail || "—"}`,
    `Reference: ${lead.id}`,
  ].join("\n");
  return `mailto:${CONSULT_INBOX_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
