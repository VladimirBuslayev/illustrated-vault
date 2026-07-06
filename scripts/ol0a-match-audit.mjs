#!/usr/bin/env node
// scripts/ol0a-match-audit.mjs  (v2 — methodological corrections)
// ─────────────────────────────────────────────────────────────────────────────
// Owned Library OL-0A — Collectr-CSV → cards_effective matching audit harness.
//
// DEV-ONLY. Reads two local files, writes two local report files. Touches
// nothing else: no Supabase, no network, no app code, no schema.
//
// Conservative matching principle (unchanged): ONLY a unique high-confidence
// normalized name+set+number match receives a canonical card_id. Weak tiers
// (name+num, name+set) are diagnostic — candidates recorded, no id assigned.
// No set alias is applied in the baseline audit; an evidence table is emitted
// so any future alias rule is grounded in observed data.
//
// Normalization parity: production modules are IMPORTED, never reimplemented
//   normName/normNum/normSet/makeKeys/isCardOwned  (src/utils/keys.js)
//   supaRowToCard                                  (src/services/cardAdapter.js)
//
// Catalog export MUST come from:
//   select id, name, set_id, set_name, local_id,
//          count(*) over () as catalog_total_rows
//   from cards_effective order by id;
// The harness hard-fails unless parsed rows === catalog_total_rows.
//
// Usage:
//   node scripts/ol0a-match-audit.mjs --csv export.csv --catalog catalog.csv
//   node scripts/ol0a-match-audit.mjs --self-test
//   optional: --keys <path> --adapter <path> --out-prefix <prefix>
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── args ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const SELF_TEST = argv.includes('--self-test');
const args = {};
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--self-test') continue;
  if (argv[i].startsWith('--')) { args[argv[i].slice(2)] = argv[i + 1]; i++; }
}
const OUT = args['out-prefix'] || 'ol0a-report';

// ── production modules ───────────────────────────────────────────────────────
async function importFirst(candidates, label) {
  for (const c of candidates.filter(Boolean)) {
    try { return await import(pathToFileURL(resolve(c)).href); } catch { /* next */ }
  }
  throw new Error(`Could not import ${label}; tried: ${candidates.filter(Boolean).join(', ')}. Use --keys/--adapter.`);
}
const keysMod = await importFirst(
  [args.keys, resolve(__dirname, '../src/utils/keys.js'), resolve(__dirname, 'keys.js')], 'production keys.js');
const adapterMod = await importFirst(
  [args.adapter, resolve(__dirname, '../src/services/cardAdapter.js'), resolve(__dirname, 'cardAdapter.js')], 'production cardAdapter.js');
const { normName, normNum, normSet, makeKeys, isCardOwned } = keysMod;
const { supaRowToCard } = adapterMod;

// ── minimal RFC4180 CSV parser (hardened) ────────────────────────────────────
// - strips a UTF-8 BOM from the first header field
// - hard-fails with the source data-row number on width mismatch
function parseCSV(text) {
  const rows = []; let field = '', row = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift();
  if (header && header[0]) header[0] = header[0].replace(/^\uFEFF/, '');
  rows.forEach((r, i) => {
    if (r.length !== header.length) throw new Error(
      `Malformed CSV: data row ${i + 1} (file line ~${i + 2}) has ${r.length} field(s), expected ${header.length}.`);
  });
  return { header, rows: rows.map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? '']))) };
}

// ── pure helpers (unit-tested in --self-test) ───────────────────────────────
// Correction 7: strip TRAILING parenthetical suffixes only (repeatedly), never
// inner groups. "Beedrill V (Alt) (Full)" → "Beedrill V"; "Mr. (Mime) Jr" unchanged.
export function stripTrailingParens(s) {
  let out = (s || '').trim();
  for (;;) {
    const next = out.replace(/\s*\([^()]*\)\s*$/, '').trim();
    if (next === out) return out;
    out = next;
  }
}
// Correction 1: strict positive-integer quantity. No defaulting.
export function parseQty(raw) {
  const t = (raw ?? '').toString().trim();
  if (!/^\d+$/.test(t)) return { valid: false, qty: 0, raw: t };
  const n = Number(t);
  return n > 0 ? { valid: true, qty: n, raw: t } : { valid: false, qty: 0, raw: t };
}
export function numberPattern(raw) {
  const n = (raw || '').trim();
  if (!n) return 'empty';
  if (/^\d+(\/.*)?$/.test(n)) return 'numeric';
  for (const p of ['TG', 'GG', 'SWSH', 'SM', 'XY', 'H']) if (new RegExp(`^${p}\\d`, 'i').test(n)) return p;
  if (/^[A-Za-z]/.test(n)) return 'other_prefix';
  return 'other';
}
// Correction 3: row-local recognition — keys from THIS source row only, so
// another row's keys can never mask a failure.
export function rowLocalOwned(src, card) {
  const keySet = new Set(makeKeys(src.productName, src.cardNumber, src.set));
  return isCardOwned(card, keySet, new Set(), new Set());
}

// ── catalog loading (correction 2) ───────────────────────────────────────────
const CATALOG_REQUIRED = ['id', 'name', 'set_id', 'set_name', 'local_id', 'catalog_total_rows'];
export function loadCatalog(parsed) {
  const missing = CATALOG_REQUIRED.filter(h => !parsed.header.includes(h));
  if (missing.length) throw new Error(
    `Catalog export missing required column(s): ${missing.join(', ')}. Export with:\n` +
    `  select id, name, set_id, set_name, local_id, count(*) over () as catalog_total_rows from cards_effective order by id;`);
  const declared = Number(parsed.rows[0]?.catalog_total_rows);
  if (!Number.isFinite(declared) || declared <= 0) throw new Error('catalog_total_rows is not a positive number.');
  if (parsed.rows.length !== declared) throw new Error(
    `CATALOG TRUNCATED: parsed ${parsed.rows.length} rows but catalog_total_rows=${declared}. ` +
    `Re-export the full result set (SQL editor "Download CSV", or psql \\copy).`);
  const catalog = parsed.rows.map(r => supaRowToCard({
    id: r.id, name: r.name, set_id: r.set_id, set_name: r.set_name, local_id: r.local_id,
    illustrator: null, artist_id: null, image_url: null, rarity: null,
    release_date: null, pricing: null, pricing_updated_at: null,
  }));
  const seen = new Set();
  for (const c of catalog) {
    if (seen.has(c.id)) throw new Error(`Catalog integrity failure: duplicate id ${c.id}`);
    seen.add(c.id);
  }
  return catalog;
}

const COLLECTR_REQUIRED = ['Category', 'Set', 'Product Name', 'Card Number', 'Quantity', 'Watchlist', 'Variance', 'Rarity'];
export function validateCollectrHeader(header) {
  const missing = COLLECTR_REQUIRED.filter(h => !header.includes(h));
  if (missing.length) throw new Error(`Collectr CSV missing required column(s): ${missing.join(', ')}`);
}

// ── the audit core ───────────────────────────────────────────────────────────
export function runAudit(csvParsed, catalog) {
  validateCollectrHeader(csvParsed.header);
  const csvRows = csvParsed.rows;

  // catalog indexes
  const push = (m, k, v) => { const a = m.get(k); a ? a.push(v) : m.set(k, [v]); };
  const ixNSN = new Map(), ixNN = new Map(), ixNS = new Map();
  const catSetNorms = new Map(); // normSet -> canonical display set_name
  for (const c of catalog) {
    const n = normName(c.name), s = normSet(c.set.name), num = normNum(c.localId);
    if (s && !catSetNorms.has(s)) catSetNorms.set(s, c.set.name);
    if (n && s && num) push(ixNSN, `${n}|${s}|${num}`, c);
    if (n && num) push(ixNN, `${n}|${num}`, c);
    if (n && s) push(ixNS, `${n}|${s}`, c);
  }

  const results = [];
  let watchlistAndOwned = 0;
  for (const r of csvRows) {
    const src = {
      productName: r['Product Name'] || '', set: r['Set'] || '', cardNumber: r['Card Number'] || '',
      variance: r['Variance'] || '', rarity: r['Rarity'] || '',
    };
    const q = parseQty(r['Quantity']);
    const watch = (r['Watchlist'] || '').trim().toLowerCase() === 'true';
    const rec = { src, qty: q.valid ? q.qty : 0, rawQty: q.raw, watchlist: watch, numberPattern: numberPattern(src.cardNumber) };

    // eligibility gates (corrections 1 & 4)
    if ((r['Category'] || '').trim() !== 'Pokemon') { results.push({ ...rec, bucket: 'skipped', reason: 'non_pokemon' }); continue; }
    if (watch && !q.valid) { results.push({ ...rec, bucket: 'skipped', reason: 'watchlist_only' }); continue; }
    if (!q.valid) { results.push({ ...rec, bucket: 'skipped', reason: 'invalid_quantity' }); continue; }
    // From here the row has strictly positive quantity ("positive-quantity Pokémon row").
    rec.positiveQty = true;
    if (watch) { watchlistAndOwned++; rec.watchlistAndOwned = true; }
    const nameMissing = !src.productName.trim(), setMissing = !src.set.trim(), numMissing = !src.cardNumber.trim();
    if (nameMissing) { results.push({ ...rec, bucket: 'skipped', reason: 'missing_name' }); continue; }
    const nA = normName(src.productName);
    const nB = normName(stripTrailingParens(src.productName));
    const variants = nB && nB !== nA ? [[nA, 'exact'], [nB, 'exact_paren_stripped']] : [[nA, 'exact']];
    if (setMissing || numMissing) {
      // Correction 4: absent identifiers are invalid input, not "mismatches".
      // Diagnostic candidates retained from whichever weak tier is possible.
      const diag = [];
      const s = normSet(src.set), num = normNum(src.cardNumber);
      for (const [n] of variants) {
        if (!setMissing && n && s) for (const c of ixNS.get(`${n}|${s}`) || []) diag.push(c.id);
        if (!numMissing && n && num) for (const c of ixNN.get(`${n}|${num}`) || []) diag.push(c.id);
      }
      results.push({ ...rec, bucket: 'skipped', reason: setMissing ? 'missing_set' : 'missing_number',
        diagnosticCandidates: [...new Set(diag)].slice(0, 6) });
      continue;
    }

    // eligible row — enters the matcher
    rec.eligible = true;
    const s = normSet(src.set), num = normNum(src.cardNumber);

    // Tier 1 — exact name+set+number; unique ⇒ the ONLY auto-match.
    let done = false;
    for (const [n, rule] of variants) {
      if (!n) continue;
      const hits = ixNSN.get(`${n}|${s}|${num}`);
      if (!hits) continue;
      if (hits.length === 1) { results.push({ ...rec, bucket: 'matched', rule, cardId: hits[0].id, card: hits[0] }); done = true; break; }
      results.push({ ...rec, bucket: 'ambiguous', reason: 'multi_exact', candidates: hits.map(h => h.id) }); done = true; break;
    }
    if (done) continue;

    // Tiers 2/3 — diagnostic only, never auto-matched.
    const cand = [];
    for (const [n, tag] of variants) {
      if (n) for (const c of ixNN.get(`${n}|${num}`) || []) cand.push({ id: c.id, via: `name_num:${tag}`, catalogSet: c.set.name });
      if (n) for (const c of ixNS.get(`${n}|${s}`) || []) cand.push({ id: c.id, via: `name_set:${tag}`, catalogNum: c.localId });
    }
    const uniq = [...new Map(cand.map(c => [c.id, c])).values()];
    if (uniq.length) {
      const nnOnly = uniq.every(c => c.via.startsWith('name_num'));
      const reason = uniq.length === 1
        ? (nnOnly ? 'name_num_unique_set_mismatch' : 'name_set_unique_num_mismatch')
        : (nnOnly ? 'name_num_multi' : 'mixed_weak_multi');
      results.push({ ...rec, bucket: 'ambiguous', reason, candidates: uniq.slice(0, 6) });
    } else {
      const reason = !catSetNorms.has(s) ? 'set_not_in_catalog'
        : (ixNS.get(`${nA}|${s}`) || ixNS.get(`${nB}|${s}`)) ? 'number_mismatch_within_set'
        : 'name_not_found';
      results.push({ ...rec, bucket: 'unmatched', reason });
    }
  }

  // ── key-consistency (correction 3): two distinct tests ─────────────────────
  const ownedKeySetGlobal = new Set(); // EXACTLY what production handleCSV builds today
  for (const r of csvRows) {
    if ((r['Category'] || '').trim() !== 'Pokemon') continue;
    makeKeys(r['Product Name'] || '', r['Card Number'] || '', r['Set'] || '').forEach(k => ownedKeySetGlobal.add(k));
  }
  const EMPTY = new Set();
  const rowLocalExactFailures = [], rowLocalParenFailures = [], globalParenGaps = [];
  for (const res of results) {
    if (res.bucket !== 'matched') continue;
    const localOk = rowLocalOwned(res.src, res.card);
    const entry = { cardId: res.cardId, catalogName: res.card.name, src: res.src, rule: res.rule };
    if (res.rule === 'exact') {
      if (!localOk) rowLocalExactFailures.push(entry); // MUST be zero — matcher bug otherwise
    } else {
      if (!localOk) rowLocalParenFailures.push(entry); // expected: source-row recognition failure
      if (!isCardOwned(res.card, ownedKeySetGlobal, EMPTY, EMPTY)) globalParenGaps.push(entry); // real production gap
    }
  }

  // ── aggregation (correction 5) ──────────────────────────────────────────────
  const rate = (n, d) => d ? Number((n / d).toFixed(4)) : null;
  const zero = () => ({ rows: 0, qty: 0 });
  const bucketAgg = { matched: zero(), ambiguous: zero(), unmatched: zero(), skipped: zero() };
  for (const r of results) { bucketAgg[r.bucket].rows++; bucketAgg[r.bucket].qty += r.qty; }
  const eligible = results.filter(r => r.eligible);
  const eligibleRows = eligible.length, eligibleQty = eligible.reduce((s, r) => s + r.qty, 0);
  const positiveQty = results.filter(r => r.positiveQty);
  const positiveQtyRows = positiveQty.length, positiveQtyQty = positiveQty.reduce((s, r) => s + r.qty, 0);

  const dim = keyFn => {
    const m = new Map();
    for (const r of eligible) {
      const k = keyFn(r);
      if (!m.has(k)) m.set(k, { eligible: zero(), matched: zero(), ambiguous: zero(), unmatched: zero() });
      const g = m.get(k);
      g.eligible.rows++; g.eligible.qty += r.qty;
      g[r.bucket].rows++; g[r.bucket].qty += r.qty;
    }
    return [...m.entries()].map(([key, g]) => ({ key, ...g,
      rowMatchRate: rate(g.matched.rows, g.eligible.rows), qtyMatchRate: rate(g.matched.qty, g.eligible.qty) }))
      .sort((a, b) => b.eligible.rows - a.eligible.rows);
  };
  const bySet = dim(r => r.src.set || '(empty)');
  const byNumPat = dim(r => r.numberPattern);

  const reasonAgg = arr => {
    const m = new Map();
    for (const r of arr) { if (!m.has(r.reason)) m.set(r.reason, zero()); const g = m.get(r.reason); g.rows++; g.qty += r.qty; }
    return [...m.entries()].map(([reason, g]) => ({ reason, ...g })).sort((a, b) => b.rows - a.rows);
  };
  const ambiguousReasons = reasonAgg(results.filter(r => r.bucket === 'ambiguous'));
  const unmatchedReasons = reasonAgg(results.filter(r => r.bucket === 'unmatched'));
  const skipReasons = reasonAgg(results.filter(r => r.bucket === 'skipped'));

  const push2 = (m, k, v) => { const a = m.get(k); a ? a.push(v) : m.set(k, [v]); };
  const byId = new Map();
  for (const r of results) if (r.bucket === 'matched') push2(byId, r.cardId, r);
  const dupGroups = [...byId.entries()].filter(([, v]) => v.length > 1)
    .map(([id, v]) => ({ cardId: id, name: v[0].card.name, sourceRows: v.length,
      totalQuantity: v.reduce((s, x) => s + x.qty, 0), variances: [...new Set(v.map(x => x.src.variance || '(none)'))] }));
  const excessDuplicateRows = dupGroups.reduce((s, g) => s + g.sourceRows - 1, 0);
  const byRule = reasonAgg(results.filter(r => r.bucket === 'matched').map(r => ({ ...r, reason: r.rule })));

  // ── production recognition breadth ──────────────────────────────────────────
  // How broadly do TODAY'S lossy owned_keys recognize the catalog? Recognition-
  // only cards are NOT called false positives: the any-printing key design
  // means they may well be genuinely owned cards the conservative matcher
  // could not resolve. This measures breadth, not error.
  const recognizedIds = new Set();
  for (const c of catalog) if (isCardOwned(c, ownedKeySetGlobal, EMPTY, EMPTY)) recognizedIds.add(c.id);
  const resolvedIds = new Set(byId.keys());
  const recognizedAndResolved = [...resolvedIds].filter(id => recognizedIds.has(id));
  const recognitionOnly = [...recognizedIds].filter(id => !resolvedIds.has(id));
  const resolvedNotRecognized = [...resolvedIds].filter(id => !recognizedIds.has(id));

  // Watchlist contamination: rebuild the production key set EXCLUDING
  // watchlist_only rows (Watchlist=true with no valid quantity), then find
  // catalog ids recognized solely because those rows are in today's key set.
  const ownedKeySetNoWatchlistOnly = new Set();
  for (const r of csvRows) {
    if ((r['Category'] || '').trim() !== 'Pokemon') continue;
    const wl = (r['Watchlist'] || '').trim().toLowerCase() === 'true';
    if (wl && !parseQty(r['Quantity']).valid) continue; // watchlist_only excluded
    makeKeys(r['Product Name'] || '', r['Card Number'] || '', r['Set'] || '').forEach(k => ownedKeySetNoWatchlistOnly.add(k));
  }
  const watchlistOnlyRecognized = [];
  for (const c of catalog) {
    if (recognizedIds.has(c.id) && !isCardOwned(c, ownedKeySetNoWatchlistOnly, EMPTY, EMPTY)) {
      watchlistOnlyRecognized.push(c);
    }
  }
  // stratified by catalog set, round-robin
  const wlBySet = new Map();
  for (const c of watchlistOnlyRecognized) push2(wlBySet, c.set.name, c);
  const wlSample = [];
  { const lists = [...wlBySet.values()]; let added = true;
    for (let i = 0; added && wlSample.length < 24; i++) { added = false;
      for (const l of lists) if (l[i] && wlSample.length < 24) { wlSample.push({ id: l[i].id, name: l[i].name, set: l[i].set.name }); added = true; } } }

  // Ownership-key collision evidence: production key → canonical catalog ids
  // that GENERATE that key. Diagnostic only — the matcher is not altered.
  const keyToIds = new Map();
  for (const c of catalog) {
    for (const k of makeKeys(c.name, c.localId, c.set.name)) push2(keyToIds, k, c.id);
  }
  const kindOf = k => k.includes('::num::') ? 'num' : k.includes('::set::') ? 'set' : 'other';
  const collisionCounts = { num: { unique: 0, colliding: 0 }, set: { unique: 0, colliding: 0 }, other: { unique: 0, colliding: 0 } };
  const collidingGroups = [];
  for (const [k, ids] of keyToIds) {
    const kind = kindOf(k);
    if (ids.length === 1) collisionCounts[kind].unique++;
    else { collisionCounts[kind].colliding++; collidingGroups.push({ key: k, kind, cardCount: ids.length, sampleIds: ids.slice(0, 6) }); }
  }
  collidingGroups.sort((a, b) => b.cardCount - a.cardCount);

  // ── stratified samples (correction 6): round-robin reason → set ───────────
  const stratified = (bucket, n = 24) => {
    const pool = results.filter(r => r.bucket === bucket);
    const byReason = new Map();
    for (const r of pool) push2(byReason, r.reason, r);
    const reasonLists = [...byReason.entries()].sort((a, b) => b[1].length - a[1].length)
      .map(([, list]) => {
        const bySetM = new Map();
        for (const r of list) push2(bySetM, r.src.set, r);
        const setLists = [...bySetM.values()];
        const rr = []; let added = true;
        for (let i = 0; added; i++) { added = false; for (const sl of setLists) if (sl[i]) { rr.push(sl[i]); added = true; } }
        return rr;
      });
    const out = []; let added = true;
    for (let i = 0; added && out.length < n; i++) {
      added = false;
      for (const rl of reasonLists) { if (rl[i] && out.length < n) { out.push(rl[i]); added = true; } }
    }
    return out.map(r => ({ ...r.src, qty: r.qty, reason: r.reason, candidates: r.candidates }));
  };

  // ── alias evidence table (correction 8) — no alias applied ─────────────────
  const aliasEvidence = new Map(); // collectrSet -> Map(catalogSet -> {rows, qty})
  for (const r of results) {
    if (r.bucket !== 'ambiguous' || r.reason !== 'name_num_unique_set_mismatch') continue;
    const cand = r.candidates[0];
    if (!aliasEvidence.has(r.src.set)) aliasEvidence.set(r.src.set, new Map());
    const m = aliasEvidence.get(r.src.set);
    if (!m.has(cand.catalogSet)) m.set(cand.catalogSet, zero());
    const g = m.get(cand.catalogSet); g.rows++; g.qty += r.qty;
  }
  const aliasTable = [...aliasEvidence.entries()].map(([collectrSet, m]) => {
    const mappings = [...m.entries()].map(([catalogSet, g]) => ({ catalogSet, ...g })).sort((a, b) => b.rows - a.rows);
    const total = mappings.reduce((s, x) => s + x.rows, 0);
    return { collectrSet, supportRows: total, supportQty: mappings.reduce((s, x) => s + x.qty, 0),
      topCandidate: mappings[0].catalogSet, competingMappings: mappings, consistency: rate(mappings[0].rows, total) };
  }).sort((a, b) => b.supportRows - a.supportRows);

  // reconciliation self-checks
  if (results.length !== csvRows.length) throw new Error('Reconciliation failure: row counts diverge');
  if (bucketAgg.matched.rows + bucketAgg.ambiguous.rows + bucketAgg.unmatched.rows + bucketAgg.skipped.rows !== results.length)
    throw new Error('Reconciliation failure: bucket sums diverge');
  if (eligibleRows !== bucketAgg.matched.rows + bucketAgg.ambiguous.rows + bucketAgg.unmatched.rows)
    throw new Error('Reconciliation failure: eligible rows diverge');

  return {
    generatedAt: new Date().toISOString(),
    inputs: { csvRows: csvRows.length, catalogCards: catalog.length },
    summary: {
      totalCsvRows: csvRows.length,
      skipped: { ...bucketAgg.skipped, reasons: skipReasons },
      watchlistAndOwnedRows: watchlistAndOwned,
      positiveQuantityPokemonRows: { rows: positiveQtyRows, qty: positiveQtyQty },
      eligibleRows: { rows: eligibleRows, qty: eligibleQty },
      matched: bucketAgg.matched, ambiguous: bucketAgg.ambiguous, unmatched: bucketAgg.unmatched,
      rowLevelMatchRate: rate(bucketAgg.matched.rows, eligibleRows),
      quantityWeightedMatchRate: rate(bucketAgg.matched.qty, eligibleQty),
      endToEndResolutionRate: rate(bucketAgg.matched.rows, positiveQtyRows),
      endToEndQtyResolutionRate: rate(bucketAgg.matched.qty, positiveQtyQty),
      resolvedCanonicalCards: byId.size,
      duplicateCanonicalIdGroups: dupGroups.length,
      excessDuplicateRows,
      keyConsistency: {
        rowLocalExactFailures: rowLocalExactFailures.length,   // must be 0
        rowLocalParenFailures: rowLocalParenFailures.length,   // source-row recognition failures
        globalParenGaps: globalParenGaps.length,               // actual production recognition gaps
      },
      recognitionBreadth: {
        productionRecognizedCatalogCards: recognizedIds.size,
        resolvedCanonicalCards: resolvedIds.size,
        recognizedAndResolvedCards: recognizedAndResolved.length,
        recognitionOnlyCatalogCards: recognitionOnly.length,   // NOT false positives — may include real owned cards the conservative matcher couldn't resolve
        resolvedButNotRecognizedCards: resolvedNotRecognized.length,
      },
      watchlistContamination: {
        watchlistOnlyRows: skipReasons.find(r => r.reason === 'watchlist_only')?.rows ?? 0,
        catalogIdsRecognizedSolelyViaWatchlistOnly: watchlistOnlyRecognized.length,
      },
      keyCollisions: {
        counts: collisionCounts,
        totalKeys: keyToIds.size,
        keysMappingToOneId: collisionCounts.num.unique + collisionCounts.set.unique + collisionCounts.other.unique,
        keysMappingToMultipleIds: collisionCounts.num.colliding + collisionCounts.set.colliding + collisionCounts.other.colliding,
      },
      languageBreakdown: 'not present in Collectr CSV (no language column)',
    },
    breakdowns: { byMatchRule: byRule, ambiguousReasons, unmatchedReasons, bySet, byNumberingPattern: byNumPat },
    aliasEvidence: aliasTable,
    samples: {
      ambiguous: stratified('ambiguous'), unmatched: stratified('unmatched'),
      rowLocalExactFailures, rowLocalParenFailures: rowLocalParenFailures.slice(0, 40),
      globalParenGaps: globalParenGaps.slice(0, 40), duplicateCanonicalGroups: dupGroups.slice(0, 40),
      watchlistOnlyRecognized: wlSample,
      largestKeyCollisions: collidingGroups.slice(0, 15),
      recognitionOnlySample: recognitionOnly.slice(0, 24),
      resolvedNotRecognizedSample: resolvedNotRecognized.slice(0, 24),
    },
  };
}

// ── markdown rendering ───────────────────────────────────────────────────────
function toMD(rep, csvPath, catPath) {
  const s = rep.summary, pc = v => v == null ? 'n/a' : (100 * v).toFixed(1) + '%';
  const rq = g => `${g.rows} rows · q${g.qty}`;
  const dimTable = rows => ['| key | eligible | matched | ambiguous | unmatched | row rate | qty rate |', '|---|---|---|---|---|---|---|',
    ...rows.map(r => `| ${r.key} | ${rq(r.eligible)} | ${rq(r.matched)} | ${rq(r.ambiguous)} | ${rq(r.unmatched)} | ${pc(r.rowMatchRate)} | ${pc(r.qtyMatchRate)} |`)];
  const md = [
    `# OL-0A Match Audit`, `Generated ${rep.generatedAt} · CSV \`${csvPath}\` (${rep.inputs.csvRows} rows) · catalog \`${catPath}\` (${rep.inputs.catalogCards} cards, completeness verified)`, '',
    '## Summary',
    `- skipped: ${rq(s.skipped)} — ${s.skipped.reasons.map(r => `${r.reason} ${r.rows}`).join(', ')}`,
    `- watchlisted-but-owned rows (positive qty, counted as owned candidates): ${s.watchlistAndOwnedRows}`,
    `- positive-quantity Pokémon rows (pre-validation): ${rq(s.positiveQuantityPokemonRows)}`,
    `- valid eligible rows (name+set+number present): ${rq(s.eligibleRows)}`,
    `- **matched (auto)**: ${rq(s.matched)} · ambiguous: ${rq(s.ambiguous)} · unmatched: ${rq(s.unmatched)}`,
    `- match rate among valid eligible rows: **${pc(s.rowLevelMatchRate)}** rows · **${pc(s.quantityWeightedMatchRate)}** quantity-weighted`,
    `- end-to-end resolution across positive-quantity rows: ${pc(s.endToEndResolutionRate)} rows · ${pc(s.endToEndQtyResolutionRate)} qty`,
    `- resolved canonical cards: ${s.resolvedCanonicalCards} · duplicate-id groups: ${s.duplicateCanonicalIdGroups} · excess duplicate rows: ${s.excessDuplicateRows}`,
    `- key-consistency — row-local exact failures (must be 0): **${s.keyConsistency.rowLocalExactFailures}** · row-local paren failures: ${s.keyConsistency.rowLocalParenFailures} · global production recognition gaps: **${s.keyConsistency.globalParenGaps}**`,
    `- language: ${s.languageBreakdown}`, '',
    '## Production recognition breadth',
    'Recognition-only cards are NOT false positives — the any-printing key design means they may include genuinely owned cards the conservative matcher could not resolve.',
    `- production-recognized catalog cards (current owned_keys behavior): **${s.recognitionBreadth.productionRecognizedCatalogCards}**`,
    `- conservatively resolved canonical cards: ${s.recognitionBreadth.resolvedCanonicalCards}`,
    `- recognized ∧ resolved: ${s.recognitionBreadth.recognizedAndResolvedCards}`,
    `- recognition-only: ${s.recognitionBreadth.recognitionOnlyCatalogCards}`,
    `- resolved but NOT recognized (today's production misses these): **${s.recognitionBreadth.resolvedButNotRecognizedCards}**`, '',
    '## Watchlist contamination',
    `- watchlist_only rows in CSV: ${s.watchlistContamination.watchlistOnlyRows}`,
    `- catalog ids recognized SOLELY because watchlist-only rows are in today's production key set: **${s.watchlistContamination.catalogIdsRecognizedSolelyViaWatchlistOnly}**`,
    ...rep.samples.watchlistOnlyRecognized.map(c => `  - ${c.id} · ${c.name} · ${c.set}`), '',
    '## Ownership-key collisions (catalog-side, diagnostic only)',
    `- total distinct keys generated by catalog: ${s.keyCollisions.totalKeys} · one-id keys: ${s.keyCollisions.keysMappingToOneId} · multi-id keys: **${s.keyCollisions.keysMappingToMultipleIds}**`,
    `- by kind — num: ${s.keyCollisions.counts.num.unique} unique / ${s.keyCollisions.counts.num.colliding} colliding · set: ${s.keyCollisions.counts.set.unique} unique / ${s.keyCollisions.counts.set.colliding} colliding`,
    '### Largest collision groups',
    ...rep.samples.largestKeyCollisions.map(g => `- \`${g.key}\` (${g.kind}) → ${g.cardCount} cards, e.g. ${g.sampleIds.join(', ')}`), '',
    '## Match rules', ...rep.breakdowns.byMatchRule.map(r => `- ${r.reason}: ${rq(r)}`), '',
    '## Ambiguous reasons', ...rep.breakdowns.ambiguousReasons.map(r => `- ${r.reason}: ${rq(r)}`), '',
    '## Unmatched reasons', ...rep.breakdowns.unmatchedReasons.map(r => `- ${r.reason}: ${rq(r)}`), '',
    '## By numbering pattern', ...dimTable(rep.breakdowns.byNumberingPattern), '',
    `## By set (top 30 of ${rep.breakdowns.bySet.length})`, ...dimTable(rep.breakdowns.bySet.slice(0, 30)), '',
    `## Set-alias evidence (name+number-unique; NO alias applied in this audit)`,
    '| Collectr set | support | top catalog candidate | consistency | competing |', '|---|---|---|---|---|',
    ...rep.aliasEvidence.slice(0, 30).map(a => `| ${a.collectrSet} | ${a.supportRows} rows · q${a.supportQty} | ${a.topCandidate} | ${pc(a.consistency)} | ${a.competingMappings.length - 1} |`), '',
    `## Ambiguous samples (stratified, ${rep.samples.ambiguous.length})`,
    ...rep.samples.ambiguous.map(x => `- ${x.productName} · ${x.set} · #${x.cardNumber} · q${x.qty} → ${x.reason} ${JSON.stringify((x.candidates || []).slice(0, 3))}`), '',
    `## Unmatched samples (stratified, ${rep.samples.unmatched.length})`,
    ...rep.samples.unmatched.map(x => `- ${x.productName} · ${x.set} · #${x.cardNumber} · q${x.qty} → ${x.reason}`), '',
    `## Row-local exact failures (${rep.samples.rowLocalExactFailures.length})`,
    ...rep.samples.rowLocalExactFailures.map(f => `- ${f.cardId} (${f.catalogName}) src=${JSON.stringify(f.src)}`), '',
    `## Global production recognition gaps (${rep.summary.keyConsistency.globalParenGaps}, first 40)`,
    ...rep.samples.globalParenGaps.map(f => `- ${f.cardId} (${f.catalogName}) src name="${f.src.productName}"`), '',
    `## Multi-row → same canonical id (${rep.summary.duplicateCanonicalIdGroups} groups, first 40)`,
    ...rep.samples.duplicateCanonicalGroups.map(g => `- ${g.cardId} ${g.name}: ${g.sourceRows} rows · q${g.totalQuantity} · variances: ${g.variances.join(', ')}`), '',
  ];
  return md.join('\n');
}

// ── self-test (correction 9) ─────────────────────────────────────────────────
function selfTest() {
  let n = 0;
  const assert = (cond, msg) => { n++; if (!cond) { console.error(`✗ ${msg}`); process.exit(1); } console.log(`✓ ${msg}`); };

  // unit: helpers
  assert(stripTrailingParens('Beedrill V (Alt) (Full)') === 'Beedrill V', 'trailing parens stripped repeatedly');
  assert(stripTrailingParens('Mr. (Mime) Jr') === 'Mr. (Mime) Jr', 'inner parenthetical NOT stripped');
  assert(!parseQty('').valid && !parseQty('0').valid && !parseQty('-1').valid && !parseQty('1.5').valid, 'invalid quantities rejected');
  assert(parseQty('3').valid && parseQty('3').qty === 3, 'positive integer quantity accepted');

  // fixture catalog (with completeness column)
  const catHdr = ['id', 'name', 'set_id', 'set_name', 'local_id', 'catalog_total_rows'];
  const catData = [
    ['fx-1', 'Snivy', 'fx', 'Fixture Set', '1', '5'],
    ['fx-2', 'Entei', 'fx', 'Fixture Set', 'H8', '5'],
    ['fx-3', 'Pikachu', 's1', 'Set One', '25', '5'],
    ['fx-4', 'Pikachu', 's2', 'Set Two', '25', '5'],
    ['fx-5', 'Mewtwo', 'fx', 'Fixture Set', '10', '5'],
  ];
  const catParsed = { header: catHdr, rows: catData.map(r => Object.fromEntries(catHdr.map((h, i) => [h, r[i]]))) };
  const catalog = loadCatalog(catParsed);
  assert(catalog.length === 5, 'fixture catalog loads with verified completeness');

  // truncation hard-fail
  let threw = false;
  try { loadCatalog({ header: catHdr, rows: catParsed.rows.slice(0, 4) }); } catch { threw = true; }
  assert(threw, 'catalog truncation hard-fails');
  threw = false;
  try { loadCatalog({ header: catHdr.slice(0, 5), rows: [] }); } catch { threw = true; }
  assert(threw, 'missing catalog_total_rows column hard-fails');

  // fixture CSV
  const H = ['Portfolio Name', 'Category', 'Set', 'Product Name', 'Card Number', 'Rarity', 'Variance', 'Grade', 'Card Condition', 'Average Cost Paid', 'Quantity', 'Market Price', 'Price Override', 'Watchlist', 'Date Added', 'Notes'];
  const row = (set, name, num, qty, wl = 'false', cat = 'Pokemon', variance = 'Normal') =>
    Object.fromEntries(H.map(h => [h, { 'Category': cat, 'Set': set, 'Product Name': name, 'Card Number': num, 'Quantity': qty, 'Watchlist': wl, 'Variance': variance, 'Rarity': 'Common' }[h] ?? '']));
  const csvParsed = { header: H, rows: [
    row('Fixture Set', 'Snivy', '1', '2'),                       // exact, q2
    row('Fixture Set', 'Entei (H8)', 'H8', '1'),                 // trailing-paren exact, q1
    row('Totally Wrong', 'Pikachu', '25', '1'),                  // ambiguous name_num_multi
    row('Alias Set', 'Mewtwo', '10', '1'),                       // ambiguous name_num_unique_set_mismatch (alias evidence)
    row('Fixture Set', 'Nonexistmon', '99', '1'),                // unmatched name_not_found
    row('Fixture Set', 'Snivy', '1', '', 'true'),                // watchlist_only (no qty)
    row('Fixture Set', 'Entei', 'H8', '3', 'true'),              // watchlisted WITH qty ⇒ owned candidate, matched
    row('Fixture Set', 'Snivy', '1', '0'),                       // invalid_quantity
    row('', 'Snivy', '1', '1'),                                  // missing_set
    row('Fixture Set', 'Snivy', '', '1'),                        // missing_number
    row('Fixture Set', 'Snivy', '1', '3'),                       // duplicate of row 1 ⇒ dup group
    row('Some Set', 'Dark Magician', '1', '1', 'false', 'YuGiOh'), // non_pokemon
  ]};
  const rep = runAudit(csvParsed, catalog);
  const s = rep.summary;

  assert(s.matched.rows === 4 && s.matched.qty === 9, 'matched rows/qty (4 rows, q9: 2+1+3+3)');
  assert(s.ambiguous.rows === 2 && s.unmatched.rows === 1, 'ambiguous=2, unmatched=1');
  const skipR = Object.fromEntries(s.skipped.reasons.map(r => [r.reason, r.rows]));
  assert(skipR.watchlist_only === 1 && skipR.invalid_quantity === 1 && skipR.missing_set === 1 && skipR.missing_number === 1 && skipR.non_pokemon === 1, 'all five skip reasons present');
  assert(s.watchlistAndOwnedRows === 1, 'watchlisted-with-quantity counted as owned candidate');
  assert(s.positiveQuantityPokemonRows.rows === 9 && s.eligibleRows.rows === 7, 'positive-qty=9 pre-validation, eligible=7');
  assert(s.rowLevelMatchRate === Number((4 / 7).toFixed(4)) && s.quantityWeightedMatchRate === Number((9 / 12).toFixed(4)), 'rates numeric and correct (4/7 rows, 9/12 qty)');
  assert(s.endToEndResolutionRate === Number((4 / 9).toFixed(4)), 'end-to-end resolution across positive-qty rows');
  assert(s.duplicateCanonicalIdGroups === 2 && s.excessDuplicateRows === 2, 'dup groups (Snivy, Entei) with excess rows = 2');
  assert(s.keyConsistency.rowLocalExactFailures === 0, 'row-local exact failures = 0');
  assert(s.keyConsistency.rowLocalParenFailures === 1, 'paren row fails ROW-LOCAL recognition');
  assert(s.keyConsistency.globalParenGaps === 0, 'global gap masked by the clean Entei row — masking distinction proven');
  assert(rep.aliasEvidence.length === 1 && rep.aliasEvidence[0].collectrSet === 'Alias Set' && rep.aliasEvidence[0].topCandidate === 'Fixture Set' && rep.aliasEvidence[0].consistency === 1, 'alias evidence table row (Alias Set → Fixture Set, 100%)');
  assert(rowLocalOwned({ productName: 'Snivy', cardNumber: '1', set: 'Fixture Set' }, catalog[0]) === true, 'row-local recognition positive control');
  assert(rowLocalOwned({ productName: 'Completely Different', cardNumber: '1', set: 'Fixture Set' }, catalog[0]) === false, 'row-local failure detection works');
  const ambReasons = new Set(rep.breakdowns.ambiguousReasons.map(r => r.reason));
  assert(ambReasons.has('name_num_multi') && ambReasons.has('name_num_unique_set_mismatch'), 'ambiguous subreasons recorded');
  assert(rep.breakdowns.unmatchedReasons[0].reason === 'name_not_found', 'unmatched reason recorded');

  // ── new: CSV hardening ──
  const bomText = '\uFEFFid,name,set_id,set_name,local_id,catalog_total_rows\nfx-9,BomTest,fx,Fixture Set,9,1\n';
  const bomCat = loadCatalog(parseCSV(bomText));
  assert(bomCat.length === 1 && bomCat[0].id === 'fx-9', 'BOM-prefixed catalog header parses and loads');
  threw = false;
  try { parseCSV('a,b,c\n1,2\n'); } catch (e) { threw = /data row 1/.test(e.message); }
  assert(threw, 'malformed row width hard-fails with source row number');

  // ── new: production recognition breadth (fixture) ──
  const rb = rep.summary.recognitionBreadth;
  assert(rb.productionRecognizedCatalogCards === 5, 'production keys recognize all 5 fixture cards (breadth of lossy keys)');
  assert(rb.resolvedCanonicalCards === 2 && rb.recognizedAndResolvedCards === 2, 'resolved=2, all inside recognized set');
  assert(rb.recognitionOnlyCatalogCards === 3 && rb.resolvedButNotRecognizedCards === 0, 'recognition-only=3 (incl. both Pikachus via shared num key), resolved-not-recognized=0');

  // ── new: key collisions (fixture) ──
  const kc = rep.summary.keyCollisions;
  assert(kc.keysMappingToMultipleIds === 1 && kc.counts.num.colliding === 1 && kc.counts.set.colliding === 0, 'exactly one colliding key, num-kind (pikachu::num::25)');
  assert(rep.samples.largestKeyCollisions[0].cardCount === 2 && rep.samples.largestKeyCollisions[0].kind === 'num', 'largest collision group is the 2-card num key');

  // ── new: watchlist contamination — negative case in main fixture ──
  assert(rep.summary.watchlistContamination.catalogIdsRecognizedSolelyViaWatchlistOnly === 0, 'no contamination when watchlist-only keys duplicate owned keys');
  // positive case: isolated mini-fixture — one owned card, one watchlist-only
  // row naming a DIFFERENT card whose keys nothing else supplies.
  const miniCsv = { header: H, rows: [
    row('Fixture Set', 'Snivy', '1', '1'),
    row('Set One', 'Pikachu', '25', '', 'true'),  // watchlist_only; sole source of pikachu keys
  ]};
  const miniRep = runAudit(miniCsv, catalog);
  assert(miniRep.summary.watchlistContamination.catalogIdsRecognizedSolelyViaWatchlistOnly === 2, 'watchlist-only row alone causes 2 catalog ids (both Pikachus via shared num key) to be production-recognized');
  assert(miniRep.samples.watchlistOnlyRecognized.length === 2, 'contaminated ids sampled');

  console.log(`\nSelf-test passed: ${n} assertions.`);
}

// ── entry ────────────────────────────────────────────────────────────────────
if (SELF_TEST) {
  selfTest();
} else {
  if (!args.csv || !args.catalog) {
    console.error('Required: --csv <collectr export> --catalog <cards_effective export>  (or --self-test)');
    process.exit(1);
  }
  const csvParsed = parseCSV(readFileSync(resolve(args.csv), 'utf8'));
  const catalog = loadCatalog(parseCSV(readFileSync(resolve(args.catalog), 'utf8')));
  const rep = runAudit(csvParsed, catalog);
  writeFileSync(`${OUT}.json`, JSON.stringify(rep, null, 2));
  writeFileSync(`${OUT}.md`, toMD(rep, args.csv, args.catalog));
  const s = rep.summary, pc = v => v == null ? 'n/a' : (100 * v).toFixed(1) + '%';
  console.log(`OL-0A audit complete → ${OUT}.md / ${OUT}.json`);
  console.log(`eligible ${s.eligibleRows.rows} rows/q${s.eligibleRows.qty} · matched ${pc(s.rowLevelMatchRate)} rows, ${pc(s.quantityWeightedMatchRate)} qty · end-to-end ${pc(s.endToEndResolutionRate)} · exact row-local failures ${s.keyConsistency.rowLocalExactFailures} · production gaps ${s.keyConsistency.globalParenGaps}`);
}
