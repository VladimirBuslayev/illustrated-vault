// src/services/catalogIndexLoader.js
// OL-0C — narrow, replaceable catalog loader for the snapshot matcher.
//
// Reads the FULL cards_effective catalog via deterministic paged selects and
// returns matcher indexes. This is the ONLY OL-0C module that talks to the
// catalog; a server-side resolver RPC can replace it later without touching the
// matcher. No schema change. Selects only the columns the matcher needs.
//
// Guarantees:
//   - stable deterministic ordering (order by id asc);
//   - does not rely on the default Supabase row cap (explicit .range paging);
//   - verifies completion against an exact head count;
//   - rejects duplicate catalog ids;
//   - fails CLOSED on any page error (throws — never classify a partial catalog);
//   - caches the completed index for the current session/import (override w/ force).
//
// The default client is imported lazily so this module stays unit-testable with
// an injected mock without pulling @supabase/supabase-js into the test graph.

import { supaRowToCard } from './cardAdapter.js';
import { buildCatalogIndex } from './snapshotMatcher.js';

const PAGE = 1000;
const CATALOG_COLUMNS = 'id,name,set_id,set_name,local_id';

let _cache = null; // session/import-scoped completed index

async function defaultClient() {
  return (await import('./supabaseClient.js')).supabase;
}

export async function loadCatalogIndex({ client, pageSize = PAGE, force = false } = {}) {
  if (_cache && !force) return _cache;
  const db = client || (await defaultClient());

  // 1. exact target count (completion verification target).
  const head = await db.from('cards_effective').select('id', { count: 'exact', head: true });
  if (head.error) throw new Error(`catalogIndexLoader: count query failed: ${head.error.message || head.error}`);
  const expected = head.count;
  if (!Number.isFinite(expected) || expected <= 0) {
    throw new Error(`catalogIndexLoader: invalid catalog count (${expected}).`);
  }

  // 2. deterministic paged retrieval; fail closed on any page error.
  const rows = [];
  const seen = new Set();
  const maxPages = Math.ceil(expected / pageSize) + 2; // guard against runaway loops
  for (let page = 0, from = 0; page < maxPages; page++, from += pageSize) {
    const res = await db.from('cards_effective')
      .select(CATALOG_COLUMNS)
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (res.error) throw new Error(`catalogIndexLoader: page ${page} failed: ${res.error.message || res.error}`);
    const data = res.data || [];
    for (const r of data) {
      if (seen.has(r.id)) throw new Error(`catalogIndexLoader: duplicate catalog id "${r.id}".`);
      seen.add(r.id);
      rows.push(supaRowToCard({
        id: r.id, name: r.name, set_id: r.set_id, set_name: r.set_name, local_id: r.local_id,
        illustrator: null, artist_id: null, image_url: null, rarity: null,
        release_date: null, pricing: null, pricing_updated_at: null,
      }));
    }
    if (data.length < pageSize) break; // last page reached
  }

  // 3. completeness check — never classify against a partial catalog.
  if (rows.length !== expected) {
    throw new Error(`catalogIndexLoader: retrieved ${rows.length} of ${expected} catalog rows (incomplete).`);
  }

  const index = buildCatalogIndex(rows);
  _cache = { index, rowCount: rows.length };
  return _cache;
}

// Reset the session/import cache (e.g. tests, or forcing a refetch next import).
export function clearCatalogCache() { _cache = null; }
