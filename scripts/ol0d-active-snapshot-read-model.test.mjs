#!/usr/bin/env node
// scripts/ol0d-active-snapshot-read-model.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
// OL-0D — service normalization harness (DEV-ONLY; no network, no credentials).
//
// Exercises src/services/ownedLibraryService.js against an injected mock client.
// The service lazy-imports supabaseClient only when no client is passed, so this
// harness never pulls @supabase/supabase-js into the graph.
//
// Run: node scripts/ol0d-active-snapshot-read-model.test.mjs
// No test framework is introduced (matches OL-0A/0C harness conventions).
// ─────────────────────────────────────────────────────────────────────────────

import { fetchActiveSnapshotReadModel } from '../src/services/ownedLibraryService.js';

let passed = 0;
let failed = 0;
const ok = (cond, msg) => { if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); } };
async function threw(fn) { try { await fn(); return false; } catch { return true; } }

function mockClient(payload, capture) {
  return {
    rpc: async (name, args) => {
      if (capture) { capture.name = name; capture.args = args; }
      return { data: payload, error: null };
    },
  };
}
// Tracks whether the RPC was actually invoked (to prove client-side rejection).
function trackingClient(payload) {
  const state = { calls: 0 };
  return { state, rpc: async () => { state.calls++; return { data: payload, error: null }; } };
}
function errorClient(error) {
  return { rpc: async () => ({ data: null, error }) };
}
const clone = (o) => JSON.parse(JSON.stringify(o));

// Representative ready payload: RPC contract (camelCase) with a raw snake_case
// catalog card on the available item, and a retained stale (missing) item.
const readyPayload = {
  contractVersion: 1,
  state: 'ready',
  batch: { id: 'b1', source: 'collectr', matcherVersion: 'ol0c-1', createdAt: '2026-07-08T00:00:00Z', activatedAt: '2026-07-08T00:01:00Z' },
  summary: {
    totalSourceRows: 16, pokemonRows: 15, positiveQuantityRows: 12, storedRows: 12, matchedRows: 7,
    ambiguousRows: 2, unmatchedRows: 2, invalidRows: 1, watchlistOnlyRows: 2, nonPokemonRows: 1,
    invalidQuantityRows: 1, matchedQuantity: 13, distinctCanonicalCards: 6, unresolvedRows: 5,
    unresolvedQuantity: 6, catalogMissingCards: 4, catalogMissingQuantity: 7,
  },
  unresolved: { groups: [
    { status: 'ambiguous', reason: 'multi_exact', rowCount: 1, quantity: 1 },
    { status: 'unmatched', reason: 'name_not_found', rowCount: 1, quantity: 1 },
    { status: 'invalid', reason: 'missing_number', rowCount: 1, quantity: 1 },
  ] },
  page: {
    limit: 60, offset: 0, totalItems: 2, returnedItems: 2,
    items: [
      {
        cardId: 'real-a', quantity: 5, sourceRowCount: 2, firstSourceRow: 10, catalogStatus: 'available',
        card: {
          id: 'real-a', name: 'Alpha', set_id: 'base1', set_name: 'Base Set', local_id: '58',
          illustrator: 'Atsuko Nishida', artist_id: 'atsuko-nishida', image_url: 'https://img/a.png',
          rarity: 'Rare', release_date: '1999-01-09', pricing: { market: 1.2 }, pricing_updated_at: '2026-07-01T00:00:00Z',
        },
        fallback: { productName: 'Alpha', setName: 'Base Set', cardNumber: '58', variance: 'Normal', rarity: 'Rare' },
      },
      {
        cardId: 'ol0d-stale', quantity: 4, sourceRowCount: 1, firstSourceRow: 40, catalogStatus: 'missing',
        card: null,
        fallback: { productName: 'StaleName', setName: 'StaleSet', cardNumber: 'S1', variance: 'Holofoil', rarity: 'Promo' },
      },
    ],
  },
};

async function run() {
  // 1. ready normalization + adapter passthrough + default args (valid payload still passes)
  {
    const cap = {};
    const res = await fetchActiveSnapshotReadModel({ client: mockClient(readyPayload, cap) });
    ok(res.state === 'ready', 'ready: state');
    ok(res.summary.matchedQuantity === 13 && res.summary.catalogMissingCards === 4, 'ready: summary integers preserved');
    const a = res.page.items[0];
    const s = res.page.items[1];
    ok(a.card && a.card.image === 'https://img/a.png' && a.card.set.id === 'base1'
       && a.card.artistId === 'atsuko-nishida' && a.card.localId === '58',
       'ready: available item adapted via supaRowToCard');
    ok(s.card === null && s.catalogStatus === 'missing' && s.fallback.productName === 'StaleName',
       'ready: missing item retained with fallback, card null');
    ok(a.quantity === 5 && a.sourceRowCount === 2 && a.firstSourceRow === 10, 'ready: aggregation fields preserved');
    ok(res.unresolved.groups.length === 3, 'ready: unresolved groups preserved');
    ok(cap.name === 'get_active_import_snapshot_read_model', 'ready: rpc name');
    ok(cap.args.p_limit === 60 && cap.args.p_offset === 0 && cap.args.p_catalog_status === 'all'
       && cap.args.p_sort === 'name_asc' && cap.args.p_expected_batch_id === null,
       'ready: default args mapped to p_*');
  }

  // 2. all options mapped to p_* args
  {
    const cap = {};
    await fetchActiveSnapshotReadModel({
      client: mockClient(readyPayload, cap),
      expectedBatchId: 'b1', limit: 10, offset: 20, search: 'pika',
      setId: 'base1', artistId: 'atsuko-nishida', catalogStatus: 'missing', sort: 'quantity_desc',
    });
    ok(cap.args.p_expected_batch_id === 'b1' && cap.args.p_limit === 10 && cap.args.p_offset === 20
       && cap.args.p_search === 'pika' && cap.args.p_set_id === 'base1' && cap.args.p_artist_id === 'atsuko-nishida'
       && cap.args.p_catalog_status === 'missing' && cap.args.p_sort === 'quantity_desc',
       'options: all mapped to p_*');
  }

  // 3. no_active_batch passthrough
  {
    const res = await fetchActiveSnapshotReadModel({ client: mockClient({ contractVersion: 1, state: 'no_active_batch' }) });
    ok(res.state === 'no_active_batch' && res.contractVersion === 1, 'no_active_batch passthrough');
  }

  // 4. snapshot_changed passthrough
  {
    const res = await fetchActiveSnapshotReadModel({ client: mockClient({ contractVersion: 1, state: 'snapshot_changed', activeBatchId: 'b9' }) });
    ok(res.state === 'snapshot_changed' && res.activeBatchId === 'b9', 'snapshot_changed passthrough');
  }

  // 5. RPC error throws (no soft-fail)
  ok(await threw(() => fetchActiveSnapshotReadModel({ client: errorClient({ message: 'boom' }) })), 'rpc error throws');

  // 6. wrong contractVersion throws
  ok(await threw(() => fetchActiveSnapshotReadModel({ client: mockClient({ contractVersion: 2, state: 'ready' }) })), 'bad contractVersion throws');

  // 7. unknown state throws
  ok(await threw(() => fetchActiveSnapshotReadModel({ client: mockClient({ contractVersion: 1, state: 'weird' }) })), 'unknown state throws');

  // 8. ready missing summary throws
  ok(await threw(() => fetchActiveSnapshotReadModel({
    client: mockClient({ contractVersion: 1, state: 'ready', batch: { id: 'b' }, unresolved: { groups: [] },
      page: { limit: 1, offset: 0, totalItems: 0, returnedItems: 0, items: [] } }),
  })), 'missing summary throws');

  // 9. negative count throws
  { const bad = clone(readyPayload); bad.summary.matchedQuantity = -1;
    ok(await threw(() => fetchActiveSnapshotReadModel({ client: mockClient(bad) })), 'negative count throws'); }

  // 10. string count throws (strict integer contract)
  { const bad = clone(readyPayload); bad.summary.storedRows = '12';
    ok(await threw(() => fetchActiveSnapshotReadModel({ client: mockClient(bad) })), 'string count throws'); }

  // 11. item missing cardId throws
  { const bad = clone(readyPayload); delete bad.page.items[0].cardId;
    ok(await threw(() => fetchActiveSnapshotReadModel({ client: mockClient(bad) })), 'missing cardId throws'); }

  // 12. available item without a card object throws
  { const bad = clone(readyPayload); bad.page.items[0].card = null;
    ok(await threw(() => fetchActiveSnapshotReadModel({ client: mockClient(bad) })), 'available item without card throws'); }

  // 13. invalid client-side sort throws before RPC
  { const c = trackingClient(readyPayload);
    ok(await threw(() => fetchActiveSnapshotReadModel({ client: c, sort: 'bogus' })), 'invalid sort throws');
    ok(c.state.calls === 0, 'invalid sort throws before RPC'); }

  // 14. decimal numeric field rejected
  { const bad = clone(readyPayload); bad.summary.matchedQuantity = 12.5;
    ok(await threw(() => fetchActiveSnapshotReadModel({ client: mockClient(bad) })), 'decimal count rejected'); }

  // 15. unsafe integer rejected
  { const bad = clone(readyPayload); bad.summary.storedRows = Number.MAX_SAFE_INTEGER + 1;
    ok(await threw(() => fetchActiveSnapshotReadModel({ client: mockClient(bad) })), 'unsafe integer rejected'); }

  // 16. invalid limit rejected before RPC (0, 101, decimal)
  { const c = trackingClient(readyPayload);
    ok(await threw(() => fetchActiveSnapshotReadModel({ client: c, limit: 0 })), 'limit=0 rejected');
    ok(await threw(() => fetchActiveSnapshotReadModel({ client: c, limit: 101 })), 'limit=101 rejected');
    ok(await threw(() => fetchActiveSnapshotReadModel({ client: c, limit: 12.5 })), 'limit=12.5 rejected');
    ok(c.state.calls === 0, 'invalid limit rejected before RPC'); }

  // 17. invalid offset rejected before RPC (negative, decimal)
  { const c = trackingClient(readyPayload);
    ok(await threw(() => fetchActiveSnapshotReadModel({ client: c, offset: -1 })), 'offset=-1 rejected');
    ok(await threw(() => fetchActiveSnapshotReadModel({ client: c, offset: 1.5 })), 'offset=1.5 rejected');
    ok(c.state.calls === 0, 'invalid offset rejected before RPC'); }

  // 18. snapshot_changed without activeBatchId rejected
  ok(await threw(() => fetchActiveSnapshotReadModel({ client: mockClient({ contractVersion: 1, state: 'snapshot_changed' }) })),
     'snapshot_changed without activeBatchId rejected');

  // 19. malformed / absent fallback rejected
  { const bad = clone(readyPayload); delete bad.page.items[0].fallback;
    ok(await threw(() => fetchActiveSnapshotReadModel({ client: mockClient(bad) })), 'absent fallback rejected'); }
  { const bad = clone(readyPayload); delete bad.page.items[0].fallback.variance;
    ok(await threw(() => fetchActiveSnapshotReadModel({ client: mockClient(bad) })), 'fallback missing a field rejected'); }

  // 20. missing item with a non-null card rejected
  { const bad = clone(readyPayload); bad.page.items[1].card = { id: 'ol0d-stale' };
    ok(await threw(() => fetchActiveSnapshotReadModel({ client: mockClient(bad) })), 'missing item with non-null card rejected'); }

  // 21. available card id mismatch rejected
  { const bad = clone(readyPayload); bad.page.items[0].card.id = 'different';
    ok(await threw(() => fetchActiveSnapshotReadModel({ client: mockClient(bad) })), 'available card id mismatch rejected'); }

  // 22. returnedItems / items.length mismatch rejected
  { const bad = clone(readyPayload); bad.page.returnedItems = 1;
    ok(await threw(() => fetchActiveSnapshotReadModel({ client: mockClient(bad) })), 'returnedItems != items.length rejected'); }

  // 23. returnedItems > totalItems rejected
  { const bad = clone(readyPayload); bad.page.totalItems = 1;
    ok(await threw(() => fetchActiveSnapshotReadModel({ client: mockClient(bad) })), 'returnedItems > totalItems rejected'); }

  // 24. returnedItems > limit rejected
  { const bad = clone(readyPayload); bad.page.limit = 1;
    ok(await threw(() => fetchActiveSnapshotReadModel({ client: mockClient(bad) })), 'returnedItems > limit rejected'); }

  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} passed, ${failed} failed.`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((e) => { console.error(e); process.exit(1); });
