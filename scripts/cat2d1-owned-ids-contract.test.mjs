#!/usr/bin/env node
// scripts/cat2d1-owned-ids-contract.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
// CAT-2D.1 — alias-aware ownership contract harness (DEV-ONLY; no network,
// no credentials).
//
// Exercises fetchActiveSnapshotOwnedCardIds() in src/services/ownedLibraryService.js
// against an injected mock client. The service lazy-imports supabaseClient only
// when no client is passed, so this harness never pulls @supabase/supabase-js
// into the graph.
//
// WHAT THIS PROVES
//   The pre-CAT-2D.1 wrapper asserted
//       ownedCardIds.length === distinctMatchedCardIds
//   which is wrong once alias resolution can COLLAPSE two historical ids onto
//   one canonical survivor: the returned array shrinks while the historical
//   count does not, the wrapper throws, and ownership enters its fail-closed
//   error state — gating every ownership-dependent surface from a data
//   condition rather than a bug.
//
//   These cases pin the corrected three-count contract, and — critically — pin
//   the ZERO-ALIAS case to behave exactly as production does today.
//
// Run: node scripts/cat2d1-owned-ids-contract.test.mjs
// No test framework is introduced (matches OL-0A/0C/0D harness conventions).
// ─────────────────────────────────────────────────────────────────────────────

import { fetchActiveSnapshotOwnedCardIds } from '../src/services/ownedLibraryService.js';

let passed = 0;
let failed = 0;
const failures = [];
const ok = (cond, msg) => {
  if (cond) { passed++; console.log(`  ok   ${msg}`); }
  else { failed++; failures.push(msg); console.error(`  FAIL ${msg}`); }
};
async function threw(fn) { try { await fn(); return false; } catch { return true; } }

function mockClient(payload) {
  return { rpc: async () => ({ data: payload, error: null }) };
}
function errorClient(error) {
  return { rpc: async () => ({ data: null, error }) };
}
const clone = (o) => JSON.parse(JSON.stringify(o));

// Zero-alias payload: what production returns today, plus the additive fields.
// distinctResolved === distinctMatched and aliasCollapsedCount === 0.
const zeroAlias = {
  contractVersion: 1,
  state: 'ready',
  batchId: 'batch-1',
  activatedAt: '2026-08-14T00:00:00Z',
  matcherVersion: 'ol2b-1',
  ownedCardIds: ['a-1', 'a-2', 'a-3'],
  reconciliation: {
    distinctMatchedCardIds: 3,
    distinctResolvedCardIds: 3,
    aliasCollapsedCount: 0,
    matchedRows: 5,
  },
};

// Collapsed payload: four historical ids resolved onto three survivors.
const collapsed = {
  ...clone(zeroAlias),
  ownedCardIds: ['s-1', 's-2', 's-3'],
  reconciliation: {
    distinctMatchedCardIds: 4,
    distinctResolvedCardIds: 3,
    aliasCollapsedCount: 1,
    matchedRows: 9,
  },
};

console.log('\nCAT-2D.1 — alias-aware ownership contract\n');

// ── Zero-alias equivalence: the acceptance condition for this slice ─────────
{
  const res = await fetchActiveSnapshotOwnedCardIds({ client: mockClient(clone(zeroAlias)) });
  ok(res.state === 'ready', 'zero aliases: state ready');
  ok(res.ownedCardIds instanceof Set, 'zero aliases: ownedCardIds is a Set');
  ok(res.ownedCardIds.size === 3, 'zero aliases: set size matches');
  ok([...res.ownedCardIds].join(',') === 'a-1,a-2,a-3', 'zero aliases: exact id set preserved');
  ok(res.reconciliation.distinctMatchedCardIds === 3, 'zero aliases: distinctMatchedCardIds surfaced');
  ok(res.reconciliation.distinctResolvedCardIds === 3, 'zero aliases: distinctResolvedCardIds === distinctMatchedCardIds');
  ok(res.reconciliation.aliasCollapsedCount === 0, 'zero aliases: aliasCollapsedCount === 0');
  ok(res.reconciliation.matchedRows === 5, 'zero aliases: matchedRows surfaced');
  ok(res.batchId === 'batch-1' && res.matcherVersion === 'ol2b-1', 'zero aliases: batch metadata preserved');
}

// ── The case the old assertion got wrong ───────────────────────────────────
{
  const res = await fetchActiveSnapshotOwnedCardIds({ client: mockClient(clone(collapsed)) });
  ok(res.state === 'ready', 'collapse: accepted (the pre-CAT-2D.1 assertion would have thrown)');
  ok(res.ownedCardIds.size === 3, 'collapse: returned set measured against RESOLVED count');
  ok(res.reconciliation.distinctMatchedCardIds === 4, 'collapse: historical count retained');
  ok(res.reconciliation.aliasCollapsedCount === 1, 'collapse: collapsed count surfaced');
}

// ── Strictness preserved: every inconsistency still throws ─────────────────
{
  const bad = clone(zeroAlias); bad.reconciliation.distinctResolvedCardIds = 2;
  ok(await threw(() => fetchActiveSnapshotOwnedCardIds({ client: mockClient(bad) })),
     'length !== distinctResolvedCardIds throws');
}
{
  const bad = clone(collapsed); bad.reconciliation.distinctResolvedCardIds = 5; bad.reconciliation.distinctMatchedCardIds = 4;
  ok(await threw(() => fetchActiveSnapshotOwnedCardIds({ client: mockClient(bad) })),
     'distinctResolved > distinctMatched throws (resolution cannot invent ids)');
}
{
  const bad = clone(collapsed); bad.reconciliation.aliasCollapsedCount = 7;
  ok(await threw(() => fetchActiveSnapshotOwnedCardIds({ client: mockClient(bad) })),
     'aliasCollapsedCount inconsistent with the two counts throws');
}
{
  const bad = clone(zeroAlias); bad.reconciliation.aliasCollapsedCount = -1; bad.reconciliation.distinctMatchedCardIds = 2;
  ok(await threw(() => fetchActiveSnapshotOwnedCardIds({ client: mockClient(bad) })),
     'negative aliasCollapsedCount throws');
}
{
  const bad = clone(zeroAlias); bad.reconciliation.matchedRows = 2;
  ok(await threw(() => fetchActiveSnapshotOwnedCardIds({ client: mockClient(bad) })),
     'matchedRows < distinctMatchedCardIds throws (row count still reconciles historically)');
}
{
  const bad = clone(zeroAlias); bad.ownedCardIds = ['a-1', 'a-1', 'a-3'];
  ok(await threw(() => fetchActiveSnapshotOwnedCardIds({ client: mockClient(bad) })),
     'duplicate returned id throws');
}
{
  const bad = clone(zeroAlias); delete bad.reconciliation.distinctResolvedCardIds;
  ok(await threw(() => fetchActiveSnapshotOwnedCardIds({ client: mockClient(bad) })),
     'missing distinctResolvedCardIds throws — NOT soft-defaulted');
}
{
  const bad = clone(zeroAlias); delete bad.reconciliation.aliasCollapsedCount;
  ok(await threw(() => fetchActiveSnapshotOwnedCardIds({ client: mockClient(bad) })),
     'missing aliasCollapsedCount throws — NOT soft-defaulted');
}
{
  const bad = clone(zeroAlias); bad.reconciliation.distinctResolvedCardIds = '3';
  ok(await threw(() => fetchActiveSnapshotOwnedCardIds({ client: mockClient(bad) })),
     'non-integer distinctResolvedCardIds throws');
}
{
  const bad = clone(zeroAlias); delete bad.reconciliation;
  ok(await threw(() => fetchActiveSnapshotOwnedCardIds({ client: mockClient(bad) })),
     'missing reconciliation block throws');
}
{
  const bad = clone(zeroAlias); bad.ownedCardIds = 'not-an-array';
  ok(await threw(() => fetchActiveSnapshotOwnedCardIds({ client: mockClient(bad) })),
     'non-array ownedCardIds throws');
}

// ── Pre-existing authority behavior must be untouched ──────────────────────
{
  const res = await fetchActiveSnapshotOwnedCardIds({ client: mockClient({ contractVersion: 1, state: 'no_active_batch' }) });
  ok(res.state === 'no_active_batch' && res.ownedCardIds === undefined, 'no_active_batch preserved (no owned set)');
}
{
  const res = await fetchActiveSnapshotOwnedCardIds({ client: mockClient({ contractVersion: 1, state: 'multiple_active_batches' }) });
  ok(res.state === 'multiple_active_batches', 'multiple_active_batches preserved');
}
{
  const res = await fetchActiveSnapshotOwnedCardIds({ client: mockClient({ contractVersion: 1, state: 'error', reason: 'no_auth' }) });
  ok(res.state === 'error' && res.reason === 'no_auth', 'error/no_auth preserved');
}
ok(await threw(() => fetchActiveSnapshotOwnedCardIds({ client: errorClient({ message: 'boom', code: '23514' }) })),
   'RPC error throws (fail-closed 23514 path never soft-fails)');
ok(await threw(() => fetchActiveSnapshotOwnedCardIds({ client: mockClient({ contractVersion: 2, state: 'ready' }) })),
   'unsupported contractVersion throws');
ok(await threw(() => fetchActiveSnapshotOwnedCardIds({ client: mockClient({ contractVersion: 1, state: 'weird' }) })),
   'unknown state throws');
{
  const bad = clone(zeroAlias); bad.batchId = '';
  ok(await threw(() => fetchActiveSnapshotOwnedCardIds({ client: mockClient(bad) })), 'empty batchId throws');
}
{
  const bad = clone(zeroAlias); bad.activatedAt = 'not-a-timestamp';
  ok(await threw(() => fetchActiveSnapshotOwnedCardIds({ client: mockClient(bad) })), 'invalid activatedAt throws');
}
{
  const empty = { ...clone(zeroAlias), ownedCardIds: [],
    reconciliation: { distinctMatchedCardIds: 0, distinctResolvedCardIds: 0, aliasCollapsedCount: 0, matchedRows: 0 } };
  const res = await fetchActiveSnapshotOwnedCardIds({ client: mockClient(empty) });
  ok(res.state === 'ready' && res.ownedCardIds.size === 0, 'empty-but-valid ready payload accepted');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  for (const f of failures) console.error(`FAILED: ${f}`);
  process.exit(1);
}
