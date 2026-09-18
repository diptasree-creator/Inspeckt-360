/**
 * Inspeckt — client-side session, backed by the real FastAPI backend.
 * ----------------------------------------------------------------
 * This used to be a purely local simulation (see git history) — every
 * "account" lived only in this browser's localStorage, with no server at
 * all. It now calls the real backend (backend/app/routers/auth.py) over
 * same-origin fetch(), same pattern as js/ui/label-check.js's real scan
 * call: this file is meant to be used from a page actually served BY that
 * backend (backend/app/main.py's static mount), not opened as a bare file.
 *
 * Deliberately still NOT the platform's eventual real auth (a verified
 * email link or Google OAuth) — see MagicLinkRequest's docstring in
 * backend/app/schemas.py. Building that out (a page that reads ?token=...,
 * a configured email provider) was explicitly deferred so the rest of the
 * app could get off localStorage first; this still authenticates by email
 * alone, no password, no verification step — same trust level the app
 * already had, just backed by a real database now instead of a browser's
 * local storage, so an account is no longer lost if someone clears their
 * browser data or opens the app on a different device.
 *
 * Sign-up and sign-in deliberately use two different backend endpoints,
 * not one, so this can still give the accurate
 * "No account found for that email — create one first." error a returning
 * -user form should give, instead of silently creating an account for any
 * email typed into the login page:
 *   - signUp() calls POST /auth/register, which 409s on a duplicate email
 *     and preserves the person-name/company-name distinction this
 *     frontend already asks for separately (full_name vs company_name).
 *   - signIn() first calls GET /auth/exists to tell the two cases apart,
 *     then POST /auth/magic-link (the backend's find-by-email, no-
 *     password, instant-token legacy endpoint — see that endpoint's own
 *     docstring) purely to mint a token for an account already confirmed
 *     to exist.
 */
import { apiFetch, SESSION_KEY } from "./api.js";

function readSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

function writeSession(token, user) {
  const session = { token, user };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session.user;
}

/** Maps the backend's UserOut shape to the shape every UI file here
 * already expects (unchanged from the old localStorage version, so
 * ui/dashboard.js, ui/pricing-page.js, etc. needed no changes for this
 * part of the migration). */
function toFrontendUser(userOut) {
  return {
    id: userOut.id,
    name: userOut.full_name,
    company: userOut.company_name,
    license: userOut.fssai_license_number,
    email: userOut.email,
    tier: userOut.tier || null,
  };
}

/** Synchronous by design — reads the session cached locally by the last
 * successful signUp()/signIn()/setTier() call, rather than re-checking
 * with the server on every call. Every UI file here calls this
 * synchronously (guard checks, nav chrome, etc.); making it async would
 * have meant converting all of those call sites too, for no real benefit
 * — a stale cached tier (e.g. purchased on another device) only matters
 * at the moments that actually check it server-side anyway (submissions/
 * formulations enforce their own allowance server-side regardless of what
 * this cache says). GET /auth/me exists for anything that later needs to
 * actually re-verify against the server. */
export function getCurrentUser() {
  return readSession()?.user || null;
}

/** FSSAI license numbers are 14 digits (Dairy Bible §9.2 / CTO spec §2.4).
 * Checked here too (not just server-side) so a mistyped number is caught
 * before a network round-trip, not after. */
export function isValidLicenseNumber(license) {
  return /^\d{14}$/.test((license || "").trim());
}

/** New account — email, business name, FSSAI license number. No password.
 * `name` is the signer's own name (e.g. "who do we ask for" on a
 * consultant follow-up) — kept separate from `company` so the sidebar
 * and any hand-off form can address a person, not just a business. Falls
 * back to the company name if omitted, for callers that don't collect it.
 * @returns {Promise<object>} the session (frontend-shaped user)
 */
export async function signUp({ email, company, license, name }) {
  if (license && !isValidLicenseNumber(license)) {
    throw new Error("FSSAI license number should be 14 digits — or leave it blank for now.");
  }
  let body;
  try {
    body = await apiFetch("/api/v1/auth/register", {
      method: "POST",
      auth: false,
      body: {
        email: email.trim().toLowerCase(),
        full_name: (name || "").trim() || company,
        company_name: company,
        fssai_license_number: license || null,
      },
    });
  } catch (err) {
    if (err.status === 409) {
      throw new Error("An account with this email already exists. Try logging in instead.");
    }
    throw err;
  }
  return writeSession(body.access_token, toFrontendUser(body.user));
}

/** Returning user — email only, matching the magic-link model. Checks
 * existence first (GET /auth/exists) so an unrecognized email gives the
 * same clear error it always has, rather than silently creating a new,
 * essentially-blank account the way the raw magic-link endpoint would.
 * @returns {Promise<object>} the session (frontend-shaped user)
 */
export async function signIn({ email }) {
  const normalizedEmail = email.trim().toLowerCase();
  const { exists } = await apiFetch(`/api/v1/auth/exists?email=${encodeURIComponent(normalizedEmail)}`, { auth: false });
  if (!exists) {
    throw new Error("No account found for that email. Create one first.");
  }
  // business_name is a required field on this endpoint but is only ever
  // read when it CREATES a new user — the exists check above already
  // confirmed this account is not new, so the value here is never used.
  const body = await apiFetch("/api/v1/auth/magic-link", {
    method: "POST",
    auth: false,
    body: { email: normalizedEmail, business_name: normalizedEmail },
  });
  return writeSession(body.access_token, toFrontendUser(body.user));
}

/** Records a purchased tier against the account (mocked payment — see
 * PLATFORM_PLAN_V2.md §6 / backend app/routers/pricing.py). Enforced for
 * real server-side (POST /pricing/purchase), not just written locally.
 * @returns {Promise<object|null>} the updated session, or null if nobody's signed in
 */
export async function setTier(tierId) {
  const session = readSession();
  if (!session) return null;
  const updated = await apiFetch("/api/v1/pricing/purchase", { method: "POST", body: { tier: tierId } });
  return writeSession(session.token, toFrontendUser(updated));
}

export function logout() {
  localStorage.removeItem(SESSION_KEY);
}
