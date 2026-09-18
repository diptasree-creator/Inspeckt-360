/**
 * Inspeckt — thin fetch wrapper for the real FastAPI backend.
 * ----------------------------------------------------------------
 * Every same-origin call from this frontend (auth.js, storage.js,
 * formulations.js, leads.js, pricing-page.js) goes through here instead of
 * calling fetch() directly, for three things every one of those callers
 * would otherwise have to reimplement:
 *   1. Attaching `Authorization: Bearer <token>` from the cached session
 *      (see auth.js's getToken()) when the call needs one.
 *   2. Turning a non-2xx JSON response into a real Error whose .message
 *      is the backend's own `detail` string (FastAPI's HTTPException
 *      shape) — not a generic "Request failed".
 *   3. Turning a genuine network failure (this page has no backend behind
 *       it at all — e.g. still being previewed as a static file, or the
 *      deployment is down) into an honest, distinguishable message,
 *      rather than the same generic error a validation failure would
 *      produce. Mirrors the fallback philosophy js/ui/label-check.js
 *      already established for its scan call: never a fabricated result,
 *      always a clear reason.
 */

const NO_BACKEND_MESSAGE =
  "Couldn't reach the Inspeckt server. If you're viewing this file directly (not through a real deployment), " +
  "this feature needs the real backend — see backend/README.md.";

/**
 * @param {string} path - e.g. "/api/v1/submissions" (same-origin, relative)
 * @param {{method?:string, body?:object, auth?:boolean}} [opts]
 * @returns {Promise<any>} parsed JSON body, or `null` for a 204 No Content
 * @throws {Error} .status is set for an HTTP-level failure (e.g. 402, 404,
 *   401); unset for a network-level failure (no backend reachable at all).
 */
export async function apiFetch(path, { method = "GET", body, auth = true } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth) {
    const token = getStoredToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

  let res;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    // fetch() itself threw — a network-layer failure (DNS, connection
    // refused, offline), not an HTTP error status. This is what happens
    // when this frontend is opened with no real backend behind it at all.
    throw new Error(NO_BACKEND_MESSAGE);
  }

  if (res.status === 204) return null;

  const text = await res.text();
  const json = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const message =
      (json && typeof json.detail === "string" && json.detail) ||
      (json && Array.isArray(json.detail) && json.detail[0]?.msg) ||
      `Request failed (HTTP ${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }

  return json;
}

// Kept here (rather than re-exported from auth.js, which would be a
// circular import — auth.js itself calls apiFetch) as the one place both
// modules agree on where the token lives.
const SESSION_KEY = "inspeckt_session";
function getStoredToken() {
  try {
    const session = JSON.parse(localStorage.getItem(SESSION_KEY));
    return session?.token || null;
  } catch {
    return null;
  }
}

export { SESSION_KEY, NO_BACKEND_MESSAGE };
