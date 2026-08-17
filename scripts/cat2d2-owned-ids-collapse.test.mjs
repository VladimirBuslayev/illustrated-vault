#!/usr/bin/env node
// scripts/cat2d2-owned-ids-collapse.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
// CAT-2D.2 — REAL-COLLAPSE ownership behaviour (DEV-ONLY; no network, no
// credentials, no database).
//
// WHY THIS EXISTS ALONGSIDE cat2d1-owned-ids-contract.test.mjs
//
//   CAT-2D.1 pinned the three-count contract with synthetic ids, under the
//   condition that mattered then: ZERO aliases, output identical to production.
//   Collapse was defensive, not load-bearing (CAT-2D §5.4).
//
//   CAT-2D.2 is the slice that makes collapse REAL. From the moment the 192
//   alias rows land, any collector whose active batch matched BOTH a Family A
//   historical id and its survivor — e.g. an older CSV row for swsh12.5-GG19
//   and a newer one for swsh12.5gg-GG19 — produces
//   aliasCollapsedCount > 0 on their very next ownership read.
//
//   Under the PRE-CAT-2D.1 wrapper that user's ownership would have entered its
//   fail-closed error state and every ownership-dependent surface would gate.
//   These cases prove that path is closed, using the ACTUAL ids this migration
//   creates, read from the committed evidence artifact rather than invented.
//
//   They also pin the direction of the guarantee: collapse may MERGE ids, and
//   it may never INVENT one, never lose the historical counts, and never
//   change the row count.
//
// Run: node scripts/cat2d2-owned-ids-collapse.test.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchActiveSnapshotOwnedCardIds } from '../src/services/ownedLibraryService.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSV_PATH = join(ROOT, 'docs', 'cat-2d2-evidence', 'family-a-alias-set.csv');

let passed = 0;
let failed = 0;
const failures = [];
const ok = (cond, msg) => {
  if (cond) { passed++; console.log(`  ok   ${msg}`); }
  else { failed++; failures.push(msg); console.error(`  FAIL ${msg}`); }
};
async function threw(fn) { try { await fn(); return false; } catch { return true; } }

const mockClient = (payload) => ({ rpc: async () => ({ data: payload, error: null }) });

// ── Real Family A pairs, straight from the reviewed artifact ────────────────
const lines = readFileSync(CSV_PATH, 'utf8').trim().split('\n').slice(1);
const pairs = lines.map((l) => {
  const c = l.split(',');
  return { family: c[0], alias: c[1], canonical: c[2] };
});
const pickFamily = (family) => pairs.filter((p) => p.family === family);
const GG = pairs.find((p) => p.alias === 'swsh12.5-GG19');
const SV = pickFamily('shining_fates_sv')[0];
// A second Shining Fates pair, so the multi-collapse case still exercises three
// simultaneous collapses now that Celebrations has been split out to CAT-2D.3.
const SV2 = pickFamily('shining_fates_sv')[1];

// An unrelated id that this slice never touches — every case carries one, so a
// change that quietly rewrote the whole set would be visible.
const UNTOUCHED = 'swsh8-111';

console.log('\nCAT-2D.2 — real Family A collapse through the ownership wrapper\n');

console.log('fixtures');
ok(pairs.length === 192, `artifact supplies 192 pairs (got ${pairs.length})`);
ok(!!GG && GG.canonical === 'swsh12.5gg-GG19', 'artifact supplies the real swsh12.5-GG19 pair');
ok(!!SV && SV.alias.startsWith('swsh4.5-SV'), 'artifact supplies a real Shining Fates SV pair');
ok(!!SV2 && SV2.alias !== SV.alias, 'artifact supplies a second, distinct Shining Fates SV pair');
ok(!pairs.some((p) => p.family === 'celebrations_cc' || p.alias.startsWith('cel25')),
  'artifact carries no Celebrations pair — that is CAT-2D.3, a separate evidence class');

/**
 * Build the payload the RPC produces for a batch whose matched rows carry
 * `historical`, given the alias map implied by `collapsing` pairs.
 *
 * This mirrors get_active_snapshot_owned_card_ids() exactly: resolve each
 * historical id, return the DISTINCT resolved set sorted, and report both
 * distinct counts plus the unchanged row count.
 */
function payloadFor(historicalIds, matchedRows) {
  const map = new Map(pairs.map((p) => [p.alias, p.canonical]));
  const resolved = historicalIds.map((id) => map.get(id) ?? id);
  const distinctMatched = new Set(historicalIds).size;
  const distinctResolved = new Set(resolved).size;
  return {
    contractVersion: 1,
    state: 'ready',
    batchId: '3f1d0a2e-0000-4000-8000-000000000001',
    activatedAt: '2026-08-17T00:00:00Z',
    matcherVersion: 'ol2b-1',
    ownedCardIds: [...new Set(resolved)].sort(),
    reconciliation: {
      distinctMatchedCardIds: distinctMatched,
      distinctResolvedCardIds: distinctResolved,
      aliasCollapsedCount: distinctMatched - distinctResolved,
      matchedRows,
    },
  };
}

// ── 1. The condition CAT-2D.2 creates: a real collapse of exactly 1 ─────────
{
  const historical = [GG.alias, GG.canonical, SV.alias, UNTOUCHED];
  const payload = payloadFor(historical, 9);
  ok(payload.reconciliation.aliasCollapsedCount === 1,
    'fixture: matching both swsh12.5-GG19 and its survivor collapses exactly 1 id');

  const res = await fetchActiveSnapshotOwnedCardIds({ client: mockClient(payload) });
  ok(res.state === 'ready', 'a real collapse does NOT put ownership into its fail-closed error state');
  ok(res.ownedCardIds.size === 3, 'the owned set holds 3 canonical ids');
  ok(res.ownedCardIds.has('swsh12.5gg-GG19'), 'the collapsed printing is owned under the CANONICAL id');
  ok(!res.ownedCardIds.has('swsh12.5-GG19'), 'the obsolete id is NOT in the owned set');
  ok(res.ownedCardIds.has(SV.canonical), 'a Family A historical id with no duplicate still resolves to its survivor');
  ok(!res.ownedCardIds.has(SV.alias), 'and its obsolete id is gone');
  ok(res.ownedCardIds.has(UNTOUCHED), 'an unrelated owned id is carried through untouched');
  ok(res.reconciliation.distinctMatchedCardIds === 4,
    'distinctMatchedCardIds stays HISTORICAL (4) — the batch still matched four ids');
  ok(res.reconciliation.matchedRows === 9,
    'matchedRows is unchanged by collapse — resolution merges ids, never rows');
  ok(res.reconciliation.aliasCollapsedCount === 1, 'aliasCollapsedCount is reported as 1');
}

// ── 2. Three simultaneous collapses, across both families ───────────────────
{
  const historical = [GG.alias, GG.canonical, SV.alias, SV.canonical, SV2.alias, SV2.canonical, UNTOUCHED];
  const payload = payloadFor(historical, 20);
  ok(payload.reconciliation.aliasCollapsedCount === 3, 'fixture: three simultaneous collapses');

  const res = await fetchActiveSnapshotOwnedCardIds({ client: mockClient(payload) });
  ok(res.state === 'ready', 'a three-way collapse is accepted');
  ok(res.ownedCardIds.size === 4, 'seven historical ids resolve to four owned printings');
  ok(res.reconciliation.distinctMatchedCardIds - res.reconciliation.distinctResolvedCardIds === 3,
    'the arithmetic identity aliasCollapsed = distinctMatched - distinctResolved holds');
  ok([...res.ownedCardIds].every((id) => !pairs.some((p) => p.alias === id)),
    'no owned id is a Family A obsolete id');
}

// ── 3. The common case: Family A ids present, but nothing collapses ─────────
{
  const historical = [GG.alias, SV.alias, SV2.alias, UNTOUCHED];
  const payload = payloadFor(historical, 6);
  ok(payload.reconciliation.aliasCollapsedCount === 0,
    'fixture: obsolete ids with no survivor duplicate collapse nothing');

  const res = await fetchActiveSnapshotOwnedCardIds({ client: mockClient(payload) });
  ok(res.state === 'ready', 'the no-collapse case is accepted');
  ok(res.ownedCardIds.size === 4, 'the owned count is unchanged — only the ids moved');
  ok(res.ownedCardIds.has(GG.canonical) && res.ownedCardIds.has(SV.canonical) && res.ownedCardIds.has(SV2.canonical),
    'each obsolete id is now owned under its survivor');
  ok(res.reconciliation.aliasCollapsedCount === 0, 'aliasCollapsedCount is 0');
}

// ── 4. Ownership can be merged, never invented ──────────────────────────────
{
  const bad = payloadFor([GG.alias, GG.canonical, UNTOUCHED], 5);
  bad.reconciliation.distinctResolvedCardIds = bad.reconciliation.distinctMatchedCardIds + 1;
  bad.reconciliation.aliasCollapsedCount = -1;
  ok(await threw(() => fetchActiveSnapshotOwnedCardIds({ client: mockClient(bad) })),
    'distinctResolved > distinctMatched is refused — resolution cannot create a printing');
}

// ── 5. The server must not disagree with its own arithmetic ─────────────────
{
  const bad = payloadFor([GG.alias, GG.canonical, UNTOUCHED], 5);
  bad.reconciliation.aliasCollapsedCount = 0;   // truth is 1
  ok(await threw(() => fetchActiveSnapshotOwnedCardIds({ client: mockClient(bad) })),
    'an aliasCollapsedCount that does not equal distinctMatched - distinctResolved is refused');
}

// ── 6. A resolver that forgot DISTINCT must not pass ────────────────────────
{
  const bad = payloadFor([GG.alias, GG.canonical, UNTOUCHED], 5);
  bad.ownedCardIds = [GG.canonical, GG.canonical, UNTOUCHED];
  ok(await threw(() => fetchActiveSnapshotOwnedCardIds({ client: mockClient(bad) })),
    'a duplicate id in ownedCardIds is refused — the resolved set must be distinct');
}

// ── 7. Rows still reconcile against the HISTORICAL distinct count ───────────
{
  const bad = payloadFor([GG.alias, GG.canonical, SV.alias, UNTOUCHED], 3);   // 3 rows, 4 distinct
  ok(await threw(() => fetchActiveSnapshotOwnedCardIds({ client: mockClient(bad) })),
    'matchedRows < distinctMatchedCardIds is refused — the row-count invariant keeps its pre-alias meaning');
}

// ── 8. Collapse must not shrink the row count ───────────────────────────────
{
  const before = payloadFor([GG.alias, SV.alias, UNTOUCHED], 9);
  const after = payloadFor([GG.alias, GG.canonical, SV.alias, UNTOUCHED], 9);
  ok(before.reconciliation.matchedRows === after.reconciliation.matchedRows,
    'introducing a collapse leaves matchedRows identical (the alias join cannot fan out)');
  const resAfter = await fetchActiveSnapshotOwnedCardIds({ client: mockClient(after) });
  ok(resAfter.reconciliation.matchedRows === 9, 'and the wrapper reports it unchanged');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
