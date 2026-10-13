// Shared data store for the Basin portal.
//
// Every user's uploads and edits (capacity weeks, budget actuals, the Q4
// forecast and its versions, workforce, working capital, OP EX, payroll, ...)
// are saved here, in Netlify Blobs, so everyone sees the same data no matter
// which browser, computer or site address they use. No GitHub needed.
//
// Each data item is saved whole under its own name with the time it was last
// changed. A save is accepted when it is newer than what is stored; an older
// save is turned away and the sender is handed the newer copy. Every value
// that gets replaced is kept as a backup first (the last 40 per item), so
// nothing can be silently lost.
//
//   GET  /api/portal-store                 -> { items: { name: { value, at } } }
//   PUT  /api/portal-store  { items:[{ key, value, at }] }
//        -> { results: { name: { ok, at, value? } } }   (value only when turned away)
import { getStore } from "@netlify/blobs";

const ALLOWED = new Set([
  "basin_wf_data", "basin_cap_weeks_v2", "basin_cap_deleted", "basin_cap_seed_hidden",
  "basin_budget_actuals", "basin_q4_forecast_v1", "basin_q4_versions", "basin_posted_forecast",
  "basin_wc_snapshots", "basin_wc_models_v1", "basin_opex_detail_v1", "basin_payroll_runs_v1",
]);
const KEEP_BACKUPS = 40;
const headers = { "content-type": "application/json", "cache-control": "no-store" };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers });

export default async (req) => {
  const store = getStore({ name: "basin-portal-data", consistency: "strong" });

  if (req.method === "GET") {
    const items = {};
    await Promise.all([...ALLOWED].map(async (k) => {
      const v = await store.get("data/" + k, { type: "json" });
      if (v) items[k] = v;
    }));
    return json({ items, now: new Date().toISOString() });
  }

  if (req.method === "PUT" || req.method === "POST") {
    let body;
    try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
    const results = {};
    for (const it of (body && body.items) || []) {
      if (!it || !ALLOWED.has(it.key) || typeof it.at !== "string") continue;
      if (it.value !== null && typeof it.value !== "string") continue;
      const name = "data/" + it.key;
      const cur = await store.get(name, { type: "json" });
      if (cur && cur.at >= it.at) {                  // stored copy is as new or newer
        results[it.key] = { ok: false, at: cur.at, value: cur.value };
        continue;
      }
      if (cur) {
        await store.setJSON("backup/" + it.key + "/" + cur.at + "_" + Date.now(), cur);
        // keep the most recent backups only
        const { blobs } = await store.list({ prefix: "backup/" + it.key + "/" });
        const old = blobs.map((b) => b.key).sort().slice(0, Math.max(0, blobs.length - KEEP_BACKUPS));
        await Promise.all(old.map((k) => store.delete(k)));
      }
      await store.setJSON(name, { value: it.value, at: it.at, savedAt: new Date().toISOString() });
      results[it.key] = { ok: true, at: it.at };
    }
    return json({ results });
  }
  return json({ error: "method" }, 405);
};

export const config = { path: "/api/portal-store" };
