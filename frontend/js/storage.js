/**
 * Inspeckt — submission history, backed by the real FastAPI backend
 * (POST/GET /api/v1/submissions — backend/app/routers/submissions.py).
 * Used to read/write this browser's localStorage only; see git history
 * for that version. The backend now runs the actual validation engine
 * (backend/app/validation_engine.py) and enforces the usage-pool
 * allowance server-side — this file no longer computes either one
 * itself, it just calls the API and shapes the response for the UI.
 */
import { apiFetch } from "./api.js";
import { CATEGORIES } from "./data/dairyBible.js";

function categoryLabel(categoryId) {
  return CATEGORIES.find((c) => c.id === categoryId)?.label || categoryId;
}

// A failed fetch (network-level — no backend reachable at all) is
// distinguished from "genuinely no submissions yet" the same way the old
// localStorage version distinguished "corrupted storage" from "empty" —
// see submissionsStorageError() below.
let lastReadError = null;
export function submissionsStorageError() { return lastReadError; }

/** How many total units (New Submissions + Formulation Lab iterations,
 * combined) this account has used, out of its shared pool. The server is
 * the source of truth for what's actually allowed to save (it 402s a
 * POST that's over the limit regardless of what this returns) — this
 * exists so the UI can show "you've used all your submissions" BEFORE
 * asking someone to fill in a whole form, not just after a failed save.
 * @returns {Promise<number>}
 */
export async function poolUsed(userId) {
  const [submissions, iterations] = await Promise.all([
    apiFetch("/api/v1/submissions"),
    apiFetch("/api/v1/formulations"),
  ]);
  return submissions.length + iterations.length;
}

/**
 * @returns {Promise<{id:string,...}|{ok:false, reason:"limit"}|{ok:false, reason:"storage", error:string}>}
 */
export async function saveSubmission(user, categoryId, categoryLabelText, input, hasLabReport, batchLotNumber = null) {
  let record;
  try {
    record = await apiFetch("/api/v1/submissions", {
      method: "POST",
      body: { category: categoryId, input, has_lab_report: !!hasLabReport, batch_lot_number: batchLotNumber || null },
    });
  } catch (err) {
    if (err.status === 402) return { ok: false, reason: "limit" };
    return { ok: false, reason: "storage", error: err.message };
  }
  return {
    id: record.id,
    userId: user.id,
    categoryId: record.category,
    categoryLabel: categoryLabelText || categoryLabel(record.category),
    input: record.input,
    result: record.result,
    overallStatus: record.overall_status,
    batchLotNumber: record.batch_lot_number,
    createdAt: new Date(record.created_at).getTime(),
  };
}

/** @returns {Promise<Array>} summaries only (no input/result — see
 * getSubmission() for the full record) */
export async function listSubmissions(userId) {
  let rows;
  try {
    rows = await apiFetch("/api/v1/submissions");
    lastReadError = null;
  } catch (err) {
    lastReadError = err.message;
    return [];
  }
  return rows.map((r) => ({
    id: r.id,
    userId,
    categoryId: r.category,
    categoryLabel: categoryLabel(r.category),
    overallStatus: r.overall_status,
    batchLotNumber: r.batch_lot_number,
    createdAt: new Date(r.created_at).getTime(),
  }));
}

/** @returns {Promise<object|undefined>} the full record (with input/result) */
export async function getSubmission(userId, id) {
  let record;
  try {
    record = await apiFetch(`/api/v1/submissions/${encodeURIComponent(id)}`);
  } catch {
    return undefined;
  }
  return {
    id: record.id,
    userId,
    categoryId: record.category,
    categoryLabel: categoryLabel(record.category),
    input: record.input,
    result: record.result,
    overallStatus: record.overall_status,
    batchLotNumber: record.batch_lot_number,
    createdAt: new Date(record.created_at).getTime(),
  };
}
