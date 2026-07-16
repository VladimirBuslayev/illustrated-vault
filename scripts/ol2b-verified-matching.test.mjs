// scripts/ol2b-verified-matching.test.mjs
// OL-2B — Verified Matching Recovery: self-contained committed unit test.
//
// Proves OL-2B behavior against a tiny SYNTHETIC catalog + synthetic Collectr rows.
// No personal data, no CSV fixtures, no Supabase — safe to commit and run in CI.
//   node scripts/ol2b-verified-matching.test.mjs
//
// It exercises the REAL production modules (snapshotMatcher.js + ol0aAllowlist.js),
// so it fails if the McDonald's Promos 2024 alias, the recovery-scoped language
// guard, the version bump, or the 34-entry allowlist integrity regress.
//
// Full-batch numeric proof (5,299 -> 5,307 over the real 6,141-row export and the
// 23,604-row catalog) lives in the SEPARATE local-validation harness
// (ol2b-fullfixture-audit.mjs), which reads private fixtures via env vars.

import assert from 'node:assert/strict';
import { buildCatalogIndex, classifyCollectrRows, MATCHER_VERSION, languageMarked }
  from '../src/services/snapshotMatcher.js';
import { OL0A_SET_ALLOWLIST, OL0A_ALLOWLIST_META } from '../src/constants/ol0aAllowlist.js';
import { normSet } from '../src/utils/keys.js';

let groups = 0;
const ok = (msg) => { console.log('  ok  ' + msg); groups++; };
const row = (o) => ({ Category: 'Pokemon', Variance: '', Rarity: '', Watchlist: 'false', Quantity: '1', ...o });

// ── Synthetic catalog ─────────────────────────────────────────────────────────
// - a McDonald's Collection 2024 card with a bare local id "7" (forces leading-zero)
// - a Base Set card for a plain baseline exact match
// - a "Black Bolt" card sharing a name with a (JP) row, to mirror the real 4 JP rows
//   that match at BASELINE via exact_paren_stripped (must be preserved, not guarded).
const CATALOG = [
  { id: '2024sv-7',    name: 'Quaxlytest',   localId: '7',   set: { name: "McDonald's Collection 2024" } },
  { id: 'base1-25',    name: 'Pikatest',     localId: '25',  set: { name: 'Base Set' } },
  { id: 'sv10.5b-012', name: 'Victinitest',  localId: '012', set: { name: 'Black Bolt' } },
];
const ix = buildCatalogIndex(CATALOG);

console.log(`\nOL-2B synthetic unit test  (matcher=${MATCHER_VERSION})\n`);
assert.equal(MATCHER_VERSION, 'ol2b-1', 'matcher must be ol2b-1');

// ── Synthetic source rows ─────────────────────────────────────────────────────
const ROWS = [
  // 1. McDonald's 2024 alias recovery, leading-zero required (007 -> 7)
  row({ 'Product Name': 'Quaxlytest', Set: "McDonald's Promos 2024", 'Card Number': '007/015' }),
  // 2. Identical row but language-marked (JP) -> must be EXCLUDED from recovery
  row({ 'Product Name': 'Quaxlytest (JP)', Set: "McDonald's Promos 2024", 'Card Number': '007/015' }),
  // 3. Plain baseline exact match (no alias, no guard) -> must stay matched
  row({ 'Product Name': 'Pikatest', Set: 'Base Set', 'Card Number': '25' }),
  // 4. Language-marked row that matches at BASELINE via exact_paren_stripped
  //    (mirrors the real 4 JP rows) -> guard is recovery-scoped, so this stays matched
  row({ 'Product Name': 'Victinitest (JP)', Set: 'Black Bolt', 'Card Number': '012' }),
];

const { stored } = classifyCollectrRows(ROWS, ix);
const [mcd, mcdJP, base, jpBaseline] = stored;

// ── 1. McDonald's 2024 alias behavior + exact set_alias_leading_zero rule ───────
console.log('1 — McDonald\'s Promos 2024 alias');
assert.equal(mcd.matchStatus, 'matched', 'McDonald\'s row recovered');
assert.equal(mcd.cardId, '2024sv-7', 'resolved to the McDonald\'s Collection 2024 card');
assert.equal(mcd.matchRule, 'set_alias_leading_zero', 'exact rule = set_alias_leading_zero');
ok('McDonald\'s Promos 2024 row -> 2024sv-7 via set_alias_leading_zero');

// ── 2. Language-marked recovery exclusion ───────────────────────────────────────
console.log('2 — language-marked recovery exclusion');
assert.equal(languageMarked({ productName: 'Quaxlytest (JP)', set: "McDonald's Promos 2024" }), true);
assert.equal(mcdJP.matchStatus, 'unmatched', '(JP) twin is NOT recovered');
assert.equal(mcdJP.cardId, null, '(JP) twin has no card id');
ok('identical (JP) row blocked from recovery while plain row recovers');

// ── 3. Preservation of baseline matches (incl. language-marked baseline) ────────
console.log('3 — baseline match preservation');
assert.equal(base.matchStatus, 'matched', 'plain baseline exact row matched');
assert.equal(base.matchRule, 'exact', 'baseline rule = exact');
assert.equal(base.cardId, 'base1-25');
assert.equal(jpBaseline.matchStatus, 'matched', 'language-marked baseline row preserved');
assert.equal(jpBaseline.matchRule, 'exact_paren_stripped', 'via exact_paren_stripped (baseline)');
assert.equal(jpBaseline.cardId, 'sv10.5b-012');
ok('baseline exact + language-marked baseline (exact_paren_stripped) both preserved');

// ── 4. Determinism ──────────────────────────────────────────────────────────────
console.log('4 — determinism');
const a = JSON.stringify(classifyCollectrRows(ROWS, ix).stored);
const b = JSON.stringify(classifyCollectrRows(ROWS, ix).stored);
assert.equal(a, b, 'repeated runs byte-identical');
ok('repeated ol2b-1 runs byte-identical');

// ── 5. Allowlist integrity at 34 entries ────────────────────────────────────────
console.log('5 — allowlist integrity');
assert.equal(OL0A_SET_ALLOWLIST.length, 34, 'exactly 34 entries');
assert.equal(OL0A_ALLOWLIST_META.allowlistCount, 34, 'META.allowlistCount = 34');
const keys = OL0A_SET_ALLOWLIST.map(e => normSet(e.collectrLabel));
assert.equal(new Set(keys).size, keys.length, 'no duplicate normalized keys');
assert.ok(keys.includes(normSet("McDonald's Promos 2024")), 'McDonald\'s Promos 2024 present');
for (const lbl of ['Sword & Shield Base Set', 'EX Dragon Frontiers', 'Mega Evolution Promos',
  'Nintendo Promos', 'WoTC Promo', 'Black and White Promos', 'Prize Pack Series One',
  'Deck Exclusives', 'World Championship Decks', 'Jumbo Cards', 'Miscellaneous Cards & Products']) {
  assert.ok(!keys.includes(normSet(lbl)), `excluded label absent: ${lbl}`);
}
ok('34 entries, no dup keys, McDonald\'s 2024 present, no rejected/deferred leak');

console.log(`\nALL SYNTHETIC CHECKS PASSED (${groups} groups)\n`);
