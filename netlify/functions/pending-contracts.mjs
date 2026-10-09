// Shared Pending Contracts list for the Basin portal.
//
// Anyone using the site reads and edits one list stored in Netlify Blobs, so
// edits reach every user without GitHub. Each row carries `u` (when it was
// last edited) and deletions are kept as tombstones, so two people editing at
// once are merged row by row instead of one overwriting the other.
//
//   GET  /api/pending-contracts   -> { list, deleted, at }
//   PUT  /api/pending-contracts   body { list, deleted, legacyAt? }
//        merges into the stored list and returns the result.
//
// Moving over from browser-only lists: each browser sends the copy it had
// before the shared list existed once, with `legacyAt` (how recent that copy
// is). The most recent copy becomes the base list -- so the person who made
// the latest changes keeps them, including deletions -- and anything edited
// in the shared list since is kept on top. Every copy received this way is
// also saved as a backup under "pending-contracts-backup/...".
import { getStore } from "@netlify/blobs";

const KEY = "pending-contracts";
const headers = { "content-type": "application/json", "cache-control": "no-store" };

function merge(cur, inc) {
  const rows = new Map();
  const deleted = Object.assign({}, cur.deleted || {});
  for (const [id, at] of Object.entries(inc.deleted || {})) {
    if (!deleted[id] || at > deleted[id]) deleted[id] = at;
  }
  for (const r of [...(cur.list || []), ...(inc.list || [])]) {
    if (!r || !r.id) continue;
    const have = rows.get(r.id);
    if (!have || (r.u || "") >= (have.u || "")) rows.set(r.id, r);
  }
  // a deletion wins unless the row was edited after it
  for (const [id, at] of Object.entries(deleted)) {
    const r = rows.get(id);
    if (r && (r.u || "") <= at) rows.delete(id);
  }
  // keep tombstones for 120 days
  const cutoff = new Date(Date.now() - 120 * 864e5).toISOString();
  for (const [id, at] of Object.entries(deleted)) if (at < cutoff) delete deleted[id];
  // newest-edited first is not wanted; keep the incoming order, then the rest
  const order = [];
  const seen = new Set();
  for (const r of [...(inc.list || []), ...(cur.list || [])]) {
    if (r && rows.has(r.id) && !seen.has(r.id)) { order.push(rows.get(r.id)); seen.add(r.id); }
  }
  return { list: order, deleted };
}

export default async (req) => {
  const store = getStore({ name: "basin-portal", consistency: "strong" });
  const cur = (await store.get(KEY, { type: "json" })) || { list: null, deleted: {}, at: null };

  if (req.method === "GET") return new Response(JSON.stringify(cur), { headers });

  if (req.method === "PUT" || req.method === "POST") {
    let inc;
    try { inc = await req.json(); } catch { return new Response('{"error":"bad json"}', { status: 400, headers }); }
    if (!inc || !Array.isArray(inc.list) || inc.list.length > 2000) {
      return new Response('{"error":"list required"}', { status: 400, headers });
    }
    let next;
    if (inc.legacyAt) {
      const stamp = new Date().toISOString();
      await store.setJSON("pending-contracts-backup/" + stamp + "-" + Math.random().toString(36).slice(2, 7),
        { receivedAt: stamp, legacyAt: inc.legacyAt, list: inc.list });
      if (!cur.list || !cur.legacyAt || inc.legacyAt > cur.legacyAt) {
        // newest pre-shared copy becomes the base; keep shared-era edits on top
        const sharedEra = { list: (cur.list || []).filter((r) => r && r.u), deleted: cur.deleted || {} };
        next = merge({ list: inc.list, deleted: {} }, sharedEra);
        next.list = [...inc.list.filter((r) => next.list.some((x) => x.id === r.id)).map((r) => next.list.find((x) => x.id === r.id)),
                     ...next.list.filter((x) => !inc.list.some((r) => r.id === x.id))];
        next.legacyAt = inc.legacyAt;
      } else {
        next = { list: cur.list, deleted: cur.deleted || {}, legacyAt: cur.legacyAt };   // older copy: keep what's there
      }
    } else {
      next = merge(cur, inc);
      next.legacyAt = cur.legacyAt || null;
    }
    next.at = new Date().toISOString();
    await store.setJSON(KEY, next);
    return new Response(JSON.stringify(next), { headers });
  }
  return new Response('{"error":"method"}', { status: 405, headers });
};

export const config = { path: "/api/pending-contracts" };
