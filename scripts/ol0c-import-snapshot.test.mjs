#!/usr/bin/env node
// scripts/ol0c-import-snapshot.test.mjs
// OL-0C — deterministic validation harness (DEV-ONLY).
//
// Default run (no external files) exercises: allowlist integrity, matcher rules +
// reconciliation identities, batch lifecycle success + forced failure paths,
// catalog loader completeness/duplicate/fail-closed guards, and an owned_keys
// isolation source-scan. All synthetic and deterministic — no network, no catalog.
//
//   node scripts/ol0c-import-snapshot.test.mjs
//
// Optional real-export reconciliation (catalog-independent counts only):
//   node scripts/ol0c-import-snapshot.test.mjs --csv export.csv
//
// Optional full baseline equivalence vs the accepted harness (needs a catalog
// export; OFF by default, honoring "do not require the full catalog CSV"):
//   node scripts/ol0c-import-snapshot.test.mjs --csv export.csv --catalog catalog.csv
//
// Exit code 0 iff every enabled assertion passes.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { OL0A_SET_ALLOWLIST, OL0A_ALLOWLIST_META } from '../src/constants/ol0aAllowlist.js';
import { normSet } from '../src/utils/keys.js';
import {
  buildCatalogIndex, classifyCollectrRows, reconcileCsvOnly, MATCHER_VERSION,
} from '../src/services/snapshotMatcher.js';
import { loadCatalogIndex, clearCatalogCache } from '../src/services/catalogIndexLoader.js';
import { createImportSnapshot } from '../src/services/importSnapshotService.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };

let passed = 0, failed = 0;
const ok = (cond, msg) => { if (cond) { passed++; } else { failed++; console.error(`  ✗ ${msg}`); } };
const section = (t) => console.log(`\n${t}`);
async function throwsAsync(fn, match) {
  try { await fn(); return { threw: false }; }
  catch (e) { return { threw: true, ok: !match || String(e.message || e).includes(match), msg: String(e.message || e) }; }
}

// ── minimal RFC4180 parser (real-export reconciliation only) ──────────────────
function parseCSV(text) {
  const rows = []; let f = '', row = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else inQ = false; } else f += ch; }
    else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(f); f = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(f); f = ''; if (row.length > 1 || row[0] !== '') rows.push(row); row = []; }
    else f += ch;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  const header = rows.shift();
  if (header && header[0]) header[0] = header[0].replace(/^\uFEFF/, '');
  return { header, rows: rows.map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? '']))) };
}

// ── synthetic catalog + rows ──────────────────────────────────────────────────
const card = (id, name, set, localId) => ({ id, name, localId, set: { name: set } });
function syntheticCatalog() {
  const c = [
    card('c-pika', 'Pikachu', 'Base Set', '58'),
    card('c-char', 'Charizard', 'Base Set', '4'),
    card('c-mew', 'Mew', '151', '151'),
    card('c-snivy', 'Snivy', 'Sun & Moon', '1'),
    card('c-eevee', 'Eevee', 'XY', '57'),
    card('c-groudon', 'Groudon', 'Sun & Moon', '1'),
    card('c-ditto-a', 'Ditto', 'Fossil', '3'),
    card('c-ditto-b', 'Ditto', 'Fossil', '3'),
    card('c-volt-a', 'Voltorb', 'Neo', '5'),
    card('c-volt-b', 'Voltorb', 'Neo', '05'),
    card('c-exp-a', 'Zzz', 'Expedition Base Set', '010'),
    card('c-exp-b', 'Zzz', 'Expedition', '10'),
  ];
  for (let i = 1; i <= 8; i++) c.push(card(`c-cap-${i}`, 'Magikarp', 'Jungle', '7')); // >6 exact hits
  return c;
}
const R = (Category, ProductName, Set, CardNumber, extra = {}) =>
  ({ Category, 'Product Name': ProductName, Set, 'Card Number': CardNumber,
     Variance: extra.Variance ?? 'Normal', Rarity: extra.Rarity ?? 'Common',
     Quantity: extra.Quantity ?? '1', Watchlist: extra.Watchlist ?? 'false' });

function syntheticRows() {
  return [
    /* 0 */ R('Pokemon', 'Pikachu', 'Base Set', '58'),
    /* 1 */ R('Pokemon', 'Charizard (Holo)', 'Base Set', '4'),
    /* 2 */ R('Pokemon', 'Mew', 'SV: 151', '151'),
    /* 3 */ R('Pokemon', 'Snivy (Full Art)', 'Sun & Moon Base Set', '1'),
    /* 4 */ R('Pokemon', 'Eevee', 'XY', '057'),
    /* 5 */ R('Pokemon', 'Eevee (Reverse Holo)', 'XY', '057'),
    /* 6 */ R('Pokemon', 'Groudon', 'Sun & Moon Base Set', '001'),
    /* 7 */ R('Pokemon', 'Groudon (Alt Art)', 'Sun & Moon Base Set', '001'),
    /* 8 */ R('Pokemon', 'Ditto', 'Fossil', '3'),
    /* 9 */ R('Pokemon', 'Missingno', 'Base Set', '58'),
    /* 10 */ R('Pokemon', 'Zubat', 'Fake Set Zzz', '999'),
    /* 11 */ R('Pokemon', 'Pikachu', 'Base Set', ''),
    /* 12 */ R('YuGiOh', 'Blue-Eyes White Dragon', 'LOB', '1'),
    /* 13 */ R('Pokemon', 'Snorlax', 'Jungle', '11', { Quantity: '', Watchlist: 'true' }),
    /* 14 */ R('Pokemon', 'Gengar', 'Fossil', '5', { Quantity: '0' }),
    /* 15 */ R('Pokemon', 'Voltorb', 'Neo', '005'),
    /* 16 */ R('Pokemon', 'Zzz', 'Expedition', '010'),
    /* 17 */ R('Pokemon', 'Magikarp', 'Jungle', '7'),
  ];
}

// ── mock clients ──────────────────────────────────────────────────────────────
function lifecycleMock(cfg = {}) {
  const calls = []; let rowChunk = 0;
  const from = (table) => {
    const b = {
      insert() { return b; }, select() { return b; }, single() { b._single = true; return b; },
      then(onF, onR) {
        let res;
        if (table === 'user_import_batches') { calls.push({ type: 'batch_insert' }); res = cfg.batchInsert ?? { data: { id: 'batch-1' }, error: null }; }
        else if (table === 'user_import_rows') { const i = rowChunk++; calls.push({ type: 'rows_insert', chunk: i }); res = cfg.rowsInsert ? cfg.rowsInsert(i) : { data: null, error: null }; }
        else res = { data: null, error: null };
        return Promise.resolve(res).then(onF, onR);
      },
    };
    return b;
  };
  const rpc = (name, params) => {
    calls.push({ type: 'rpc', name, params });
    const res = name === 'activate_import_batch' ? (cfg.activate ?? { data: 'batch-1', error: null })
      : name === 'fail_import_batch' ? (cfg.fail ?? { data: 'batch-1', error: null })
      : { data: null, error: null };
    return Promise.resolve(res);
  };
  return { client: { from, rpc }, calls };
}
function catalogMock(cfg) {
  const calls = []; let pageIdx = 0;
  const from = () => {
    const b = {
      _head: false, _range: null,
      select(_c, o) { if (o && o.head) b._head = true; return b; },
      order() { return b; }, range(a, z) { b._range = [a, z]; return b; },
      then(onF, onR) {
        let res;
        if (b._head) { calls.push({ type: 'count' }); res = cfg.count != null ? { count: cfg.count, error: null } : { count: null, error: cfg.countError || { message: 'no count' } }; }
        else { const i = pageIdx++; calls.push({ type: 'page', i, range: b._range }); res = (cfg.pageError === i) ? { data: null, error: { message: 'page fail' } } : { data: cfg.pages[i] || [], error: null }; }
        return Promise.resolve(res).then(onF, onR);
      },
    };
    return b;
  };
  return { client: { from }, calls };
}
const catRows = (n, startId) => Array.from({ length: n }, (_, k) => ({ id: `k-${startId + k}`, name: `N${startId + k}`, set_id: 's', set_name: 'S', local_id: String(startId + k) }));

// ═══════════════════════════════════════════════════════════════════════════
// Suite 1 — allowlist integrity
// ═══════════════════════════════════════════════════════════════════════════
section('Suite 1 — allowlist integrity');
ok(OL0A_SET_ALLOWLIST.length === 33, `allowlist has exactly 33 entries (got ${OL0A_SET_ALLOWLIST.length})`);
ok(OL0A_ALLOWLIST_META.allowlistCount === 33 && OL0A_ALLOWLIST_META.deferredCount === 7 && OL0A_ALLOWLIST_META.rejectedCount === 34, 'meta counts are 33 / 7 / 34');
ok(Object.isFrozen(OL0A_SET_ALLOWLIST), 'allowlist array is frozen');
{
  const keys = new Set(OL0A_SET_ALLOWLIST.map(e => normSet(e.collectrLabel)));
  ok(keys.size === 33, 'no duplicate normalized allowlist keys');
  ok(OL0A_SET_ALLOWLIST.every(e => e.collectrLabel && e.catalogSet), 'every entry has label + catalogSet');
  // module load already asserts exclusion of deferred/rejected; presence of the
  // module (imported above without throwing) proves it.
  ok(true, 'load-time exclusion assertion passed (module imported without throwing)');
}

// ═══════════════════════════════════════════════════════════════════════════
// Suite 2 — matcher rules + buckets
// ═══════════════════════════════════════════════════════════════════════════
section('Suite 2 — matcher rules + buckets');
const ix = buildCatalogIndex(syntheticCatalog());
const { stored, counts, diagnostics } = classifyCollectrRows(syntheticRows(), ix);
const byRow = new Map(stored.map(r => [r.sourceRowNumber, r]));
const expect = [
  [1, 'matched', 'exact'],
  [2, 'matched', 'exact_paren_stripped'],
  [3, 'matched', 'set_alias'],
  [4, 'matched', 'set_alias_paren_stripped'],
  [5, 'matched', 'leading_zero'],
  [6, 'matched', 'leading_zero_paren_stripped'],
  [7, 'matched', 'set_alias_leading_zero'],
  [8, 'matched', 'set_alias_leading_zero_paren_stripped'],
  [9, 'ambiguous', null],   // Ditto multi_exact
  [10, 'unmatched', null],  // name_not_found
  [11, 'unmatched', null],  // set_not_in_catalog
  [12, 'invalid', null],    // missing_number
  [16, 'ambiguous', null],  // Voltorb LZ collision → not matched
  [17, 'ambiguous', null],  // Expedition conflict → not matched
  [18, 'ambiguous', null],  // Magikarp candidate cap
];
for (const [srn, status, rule] of expect) {
  const r = byRow.get(srn);
  ok(r && r.matchStatus === status, `row ${srn} → ${status} (got ${r ? r.matchStatus : 'MISSING'})`);
  if (rule) ok(r && r.matchRule === rule, `row ${srn} → match_rule ${rule} (got ${r ? r.matchRule : 'MISSING'})`);
}
ok(byRow.get(9).matchReason === 'multi_exact' && byRow.get(9).candidateCardIds.length === 2, 'row 9 multi_exact, 2 candidates');
ok(byRow.get(10).matchReason === 'name_not_found', 'row 10 reason name_not_found');
ok(byRow.get(11).matchReason === 'set_not_in_catalog', 'row 11 reason set_not_in_catalog');
ok(byRow.get(12).matchReason === 'missing_number' && byRow.get(12).candidateCardIds === null, 'row 12 invalid missing_number, no candidates');
ok(byRow.get(16).candidateCardIds && byRow.get(16).candidateCardIds.length >= 1, 'row 16 (LZ collision) kept as ambiguous, not matched');
ok(diagnostics.conflicts >= 1, `row 17 recorded a strategy conflict (conflicts=${diagnostics.conflicts})`);
ok(byRow.get(18).candidateCardIds.length === 6, `row 18 candidate cap = 6 (got ${byRow.get(18).candidateCardIds.length})`);
// no leading_zero collision auto-resolved to a wrong card:
ok(!stored.some(r => r.matchStatus === 'matched' && r.productName === 'Voltorb'), 'LZ collision never produced a matched Voltorb');

// storage-shape conformance to OL-0B constraints
for (const r of stored) {
  if (r.matchStatus === 'matched') ok(r.cardId && r.matchRule && r.matchReason === null && r.candidateCardIds === null, `matched row ${r.sourceRowNumber} shape`);
  else if (r.matchStatus === 'ambiguous') ok(r.cardId === null && r.matchRule === null && r.matchReason && r.candidateCardIds && r.candidateCardIds.length >= 1 && r.candidateCardIds.length <= 6, `ambiguous row ${r.sourceRowNumber} shape`);
  else ok(r.cardId === null && r.matchRule === null && r.matchReason && r.candidateCardIds === null, `${r.matchStatus} row ${r.sourceRowNumber} shape`);
}

// ═══════════════════════════════════════════════════════════════════════════
// Suite 3 — reconciliation identities (OL-0B batch constraints)
// ═══════════════════════════════════════════════════════════════════════════
section('Suite 3 — reconciliation identities');
ok(counts.total_source_rows === 18, `total 18 (got ${counts.total_source_rows})`);
ok(counts.non_pokemon_rows === 1 && counts.pokemon_rows === 17, 'non_pokemon 1, pokemon 17');
ok(counts.watchlist_only_rows === 1 && counts.invalid_quantity_rows === 1 && counts.positive_qty_rows === 15, 'watchlist_only 1, invalid_quantity 1, positive_qty 15');
ok(counts.matched_rows === 8 && counts.ambiguous_rows === 4 && counts.unmatched_rows === 2 && counts.invalid_rows === 1, `buckets 8/4/2/1 (got ${counts.matched_rows}/${counts.ambiguous_rows}/${counts.unmatched_rows}/${counts.invalid_rows})`);
ok(counts.total_source_rows === counts.pokemon_rows + counts.non_pokemon_rows, 'identity: total = pokemon + non_pokemon');
ok(counts.pokemon_rows === counts.positive_qty_rows + counts.watchlist_only_rows + counts.invalid_quantity_rows, 'identity: pokemon = positive + watchlist_only + invalid_quantity');
ok(counts.stored_rows === counts.positive_qty_rows, 'identity: stored = positive_qty');
ok(counts.stored_rows === counts.matched_rows + counts.ambiguous_rows + counts.unmatched_rows + counts.invalid_rows, 'identity: stored = matched+ambiguous+unmatched+invalid');
ok(stored.length === counts.stored_rows, 'stored.length === stored_rows');
{
  const srns = stored.map(r => r.sourceRowNumber);
  ok(new Set(srns).size === srns.length, 'source_row_number unique');
  ok(srns.every(n => n > 0), 'source_row_number > 0');
}

// ═══════════════════════════════════════════════════════════════════════════
// Suite 4 — batch lifecycle (success + forced failures)
// ═══════════════════════════════════════════════════════════════════════════
section('Suite 4 — batch lifecycle');
const classified = { stored, counts };
{ // success
  const { client, calls } = lifecycleMock();
  const res = await createImportSnapshot({ client, userId: 'u1', matcherVersion: MATCHER_VERSION, classified, chunkSize: 5 });
  ok(res.status === 'active' && res.batchId === 'batch-1', 'success → active');
  ok(calls.some(c => c.type === 'rpc' && c.name === 'activate_import_batch'), 'success → activate called');
  ok(!calls.some(c => c.type === 'rpc' && c.name === 'fail_import_batch'), 'success → fail NOT called');
}
{ // batch-create failure
  const { client, calls } = lifecycleMock({ batchInsert: { data: null, error: { message: 'rls denied' } } });
  const res = await createImportSnapshot({ client, userId: 'u1', matcherVersion: MATCHER_VERSION, classified, chunkSize: 5 });
  ok(res.status === 'failed' && res.stage === 'create_batch' && res.batchId === null, 'batch-create failure → failed/create_batch, no batchId');
  ok(!calls.some(c => c.type === 'rpc'), 'batch-create failure → no rpc calls (prior active untouched)');
}
{ // forced INSERT failure on 2nd chunk
  const { client, calls } = lifecycleMock({ rowsInsert: (i) => i === 1 ? { data: null, error: { message: 'insert boom' } } : { data: null, error: null } });
  const res = await createImportSnapshot({ client, userId: 'u1', matcherVersion: MATCHER_VERSION, classified, chunkSize: 2 });
  ok(res.status === 'failed' && res.stage === 'insert_rows', 'insert failure → failed/insert_rows');
  ok(calls.some(c => c.type === 'rpc' && c.name === 'fail_import_batch'), 'insert failure → fail_import_batch called');
  ok(!calls.some(c => c.type === 'rpc' && c.name === 'activate_import_batch'), 'insert failure → activate NOT called (no partial active)');
}
{ // forced ACTIVATION failure
  const { client, calls } = lifecycleMock({ activate: { data: null, error: { message: 'reconcile mismatch' } } });
  const res = await createImportSnapshot({ client, userId: 'u1', matcherVersion: MATCHER_VERSION, classified, chunkSize: 5 });
  ok(res.status === 'failed' && res.stage === 'activate', 'activation failure → failed/activate');
  const order = calls.filter(c => c.type === 'rpc').map(c => c.name);
  ok(order[0] === 'activate_import_batch' && order.includes('fail_import_batch'), 'activation failure → activate then fail');
  // prior active intact: service issues no delete/update to other batches — only
  // insert + activate/fail RPCs. Supersession lives ONLY inside activate (which
  // errored and rolled back server-side), so the previous active is untouched.
  ok(!order.some(n => n !== 'activate_import_batch' && n !== 'fail_import_batch'), 'no supersession/side-effect RPCs on failure → prior active intact');
}

// ═══════════════════════════════════════════════════════════════════════════
// Suite 5 — catalog loader guards
// ═══════════════════════════════════════════════════════════════════════════
section('Suite 5 — catalog loader');
{ // completeness across 3 pages
  clearCatalogCache();
  const pages = [catRows(1000, 0), catRows(1000, 1000), catRows(314, 2000)];
  const { client } = catalogMock({ count: 2314, pages });
  const { index, rowCount } = await loadCatalogIndex({ client, pageSize: 1000, force: true });
  ok(rowCount === 2314, `loader returns all 2314 rows (got ${rowCount})`);
  ok(index && index.ixNSN instanceof Map, 'loader builds a catalog index');
}
{ // duplicate id rejection
  clearCatalogCache();
  const dup = catRows(1000, 0); dup[10] = { ...dup[10], id: dup[9].id };
  const { client } = catalogMock({ count: 1000, pages: [dup] });
  const r = await throwsAsync(() => loadCatalogIndex({ client, pageSize: 1000, force: true }), 'duplicate');
  ok(r.threw && r.ok, 'duplicate catalog id → throws (rejected)');
}
{ // page error → fail closed
  clearCatalogCache();
  const { client } = catalogMock({ count: 2000, pages: [catRows(1000, 0), catRows(1000, 1000)], pageError: 1 });
  const r = await throwsAsync(() => loadCatalogIndex({ client, pageSize: 1000, force: true }), 'page 1 failed');
  ok(r.threw && r.ok, 'page error → throws (fail closed)');
}
{ // incomplete retrieval → throws (never classify partial)
  clearCatalogCache();
  const { client } = catalogMock({ count: 2314, pages: [catRows(1000, 0), catRows(1000, 1000)] }); // page2 returns [] → 2000 total
  const r = await throwsAsync(() => loadCatalogIndex({ client, pageSize: 1000, force: true }), 'incomplete');
  ok(r.threw && r.ok, 'incomplete count → throws (never classify partial catalog)');
}
clearCatalogCache();

// ═══════════════════════════════════════════════════════════════════════════
// Suite 6 — owned_keys isolation (source scan)
// ═══════════════════════════════════════════════════════════════════════════
section('Suite 6 — owned_keys isolation');
{
  // Scan CODE only (strip block + line comments) — documentation is allowed to
  // name owned_keys/user_collection; what must never appear is an actual call or
  // table reference. Forbidden tokens are code-shaped to avoid prose matches.
  const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const forbidden = ['saveCollection', 'makeKeys', 'isCardOwned', 'manualOwned', 'manualMissing',
    '.owned_keys', "'user_collection'", '"user_collection"', "'card_overrides'", '"card_overrides"'];
  const files = [
    '../src/constants/ol0aAllowlist.js',
    '../src/services/snapshotMatcher.js',
    '../src/services/catalogIndexLoader.js',
    '../src/services/importSnapshotService.js',
  ];
  for (const f of files) {
    const code = stripComments(readFileSync(resolve(__dirname, f), 'utf8'));
    const hits = forbidden.filter(tok => code.includes(tok));
    ok(hits.length === 0, `${f} calls no ownership internals (found: ${hits.join(', ') || 'none'})`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Suite 7 — real-export reconciliation (catalog-independent) [optional]
// ═══════════════════════════════════════════════════════════════════════════
const csvPath = arg('--csv');
if (csvPath) {
  section('Suite 7 — real-export reconciliation (--csv)');
  const parsed = parseCSV(readFileSync(resolve(csvPath), 'utf8'));
  const c = reconcileCsvOnly(parsed.rows);
  ok(c.total === 6141, `total 6141 (got ${c.total})`);
  ok(c.pokemon === 6135 && c.non_pokemon === 6, `pokemon 6135 / non_pokemon 6 (got ${c.pokemon}/${c.non_pokemon})`);
  ok(c.watchlist_only === 166 && c.invalid_quantity === 0, `watchlist_only 166 / invalid_quantity 0 (got ${c.watchlist_only}/${c.invalid_quantity})`);
  ok(c.positive_qty === 5969, `positive_qty 5969 (got ${c.positive_qty})`);
  ok(c.invalid_missing === 17, `invalid_missing 17 (got ${c.invalid_missing})`);
  ok(c.eligible === 5952, `eligible 5952 (got ${c.eligible})`);
} else {
  section('Suite 7 — real-export reconciliation (skipped; pass --csv export.csv to enable)');
}

// ═══════════════════════════════════════════════════════════════════════════
// Suite 8 — full baseline equivalence vs accepted harness [optional]
// ═══════════════════════════════════════════════════════════════════════════
const catPath = arg('--catalog');
if (csvPath && catPath) {
  section('Suite 8 — full equivalence vs accepted harness (--csv --catalog)');
  const savedArgv = process.argv;
  process.argv = [savedArgv[0], savedArgv[1], '--self-test']; // make harness import benign
  let harness;
  try { harness = await import('./ol0a-match-audit.mjs'); }
  finally { process.argv = savedArgv; }
  const { loadCatalog, runAudit } = harness;
  const csvParsed = parseCSV(readFileSync(resolve(csvPath), 'utf8'));
  const catalog = loadCatalog(parseCSV(readFileSync(resolve(catPath), 'utf8')));
  const base = runAudit(csvParsed, catalog).summary;
  ok(base.matched.rows === 4349, `baseline matched = 4349 (got ${base.matched.rows})`);
  ok(base.ambiguous.rows === 1116, `baseline ambiguous = 1116 (got ${base.ambiguous.rows})`);
  ok(base.unmatched.rows === 487, `baseline unmatched = 487 (got ${base.unmatched.rows})`);

  const ix2 = buildCatalogIndex(catalog);
  const { counts: rc, diagnostics: diag2 } = classifyCollectrRows(csvParsed.rows, ix2);
  ok(rc.matched_rows === 5297, `OL-0C matched = 5297 (got ${rc.matched_rows})`);
  ok(rc.ambiguous_rows === 169, `OL-0C ambiguous = 169 (got ${rc.ambiguous_rows})`);
  ok(rc.unmatched_rows === 486, `OL-0C unmatched = 486 (got ${rc.unmatched_rows})`);
  ok(rc.invalid_rows === 17, `invalid = 17 (got ${rc.invalid_rows})`);
  ok(rc.stored_rows === 5969, `stored = 5969 (got ${rc.stored_rows})`);
  ok(rc.matched_rows - base.matched.rows === 948, `newly resolved = 948 (got ${rc.matched_rows - base.matched.rows})`);
  ok(diag2.conflicts === 0, `diagnostics conflicts = 0 (got ${diag2.conflicts})`);
} else {
  section('Suite 8 — full harness equivalence (skipped; pass --csv and --catalog to enable)');
}

// ── result ────────────────────────────────────────────────────────────────────
console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
