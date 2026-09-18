/**
 * Inspeckt — Label Check history persistence (localStorage)
 * ----------------------------------------------------------------
 * Per your "the dashboard needs to have everything... if they checked
 * labels" feedback: label-check.html itself stays account-free (anyone
 * can run a check with no login, same as before), but when someone IS
 * logged in while they run one, it's worth remembering — otherwise a
 * logged-in user's dashboard has no record that a label check ever
 * happened, even though Submissions and Formulation Lab both keep
 * theirs. Mirrors storage.js's/formulations.js's exact pattern: read/
 * write helpers, a distinguishable storage-corruption error, filtered
 * by userId.
 */
const KEY = "inspeckt_label_checks_v1";

let lastReadError = null;
export function labelChecksStorageError() { return lastReadError; }

function readAll() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY)) || [];
    lastReadError = null;
    return raw;
  } catch {
    lastReadError = "Your label check history couldn't be read — the browser data may be corrupted. Clearing this site's storage will fix it, but will also erase what's saved.";
    return [];
  }
}

function writeAll(rows) {
  try {
    localStorage.setItem(KEY, JSON.stringify(rows));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: "This label check couldn't be saved to your browser's storage — your result above is still valid, it just won't show up in your dashboard history." };
  }
}

/**
 * @param {{id:string}|null} user — pass null/omit for an anonymous check;
 *   it still runs and returns fine, it just isn't recorded anywhere.
 */
export function saveLabelCheck(user, { productLabel, categoryId, section }) {
  if (!user) return { ok: true, record: null };
  const record = {
    id: `lc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    userId: user.id,
    productLabel, categoryId,
    status: section.status,
    declaredCount: section.checks.filter((c) => c.status === "PASS").length,
    totalCount: section.checks.length,
    createdAt: Date.now(),
  };
  const rows = readAll();
  rows.unshift(record);
  const result = writeAll(rows);
  if (!result.ok) return { ok: false, reason: "storage", error: result.error };
  return { ok: true, record };
}

export function listLabelChecks(userId) {
  return readAll().filter((r) => r.userId === userId);
}
