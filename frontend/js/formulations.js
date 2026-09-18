/**
 * Inspeckt — Formulation Lab, backed by the real FastAPI backend
 * (POST/GET/DELETE /api/v1/formulations — backend/app/routers/
 * formulations.py). Used to score drafts locally against
 * validation.js's scoreFormulation() and save them to localStorage; see
 * git history for that version. The backend now runs the actual scoring
 * (the same validation_engine.py logic, mirrored — see backend/README.md's
 * "Two validation engines" section) and enforces the shared usage-pool
 * allowance server-side, so this file no longer scores anything itself,
 * it just calls the API and shapes the response for the UI.
 */
import { apiFetch } from "./api.js";

// A failed fetch (network-level — no backend reachable at all) is
// distinguished from "genuinely no iterations yet" the same way the old
// localStorage version distinguished "corrupted storage" from "empty" —
// see formulationsStorageError() below.
let lastReadError = null;
export function formulationsStorageError() { return lastReadError; }

function toFrontendRecord(userId, r) {
  return {
    id: r.id,
    userId,
    productName: r.product_name,
    iterationLabel: r.iteration_label,
    category: r.category,
    input: r.input,
    score: Number(r.closeness_score),
    gapSummary: r.gap_summary,
    createdAt: new Date(r.created_at).getTime(),
  };
}

/** @returns {Promise<Array>} */
export async function listIterations(userId) {
  let rows;
  try {
    rows = await apiFetch("/api/v1/formulations");
    lastReadError = null;
  } catch (err) {
    lastReadError = err.message;
    return [];
  }
  return rows.map((r) => toFrontendRecord(userId, r)).sort((a, b) => b.createdAt - a.createdAt);
}

export async function listIterationsForProduct(userId, productName) {
  return (await listIterations(userId)).filter((r) => r.productName === productName);
}

export async function listProducts(userId) {
  const rows = await listIterations(userId);
  const byProduct = new Map();
  for (const r of rows) {
    if (!byProduct.has(r.productName)) byProduct.set(r.productName, []);
    byProduct.get(r.productName).push(r);
  }
  return [...byProduct.entries()].map(([productName, iterations]) => ({
    productName,
    iterations: iterations.sort((a, b) => b.score - a.score),
    best: iterations.reduce((best, i) => (i.score > (best?.score ?? -1) ? i : best), null),
  }));
}

/** @returns {Promise<{ok:true, record:object}|{ok:false, reason:"limit"|"storage", error?:string}>} */
export async function saveIteration(user, { productName, iterationLabel, category, input }) {
  let record;
  try {
    record = await apiFetch("/api/v1/formulations", {
      method: "POST",
      body: { product_name: productName, iteration_label: iterationLabel, category, input },
    });
  } catch (err) {
    if (err.status === 402) return { ok: false, reason: "limit" };
    return { ok: false, reason: "storage", error: err.message };
  }
  return { ok: true, record: toFrontendRecord(user.id, record) };
}

/** @returns {Promise<{ok:true}|{ok:false, error:string}>} */
export async function deleteIteration(userId, id) {
  try {
    await apiFetch(`/api/v1/formulations/${encodeURIComponent(id)}`, { method: "DELETE" });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
