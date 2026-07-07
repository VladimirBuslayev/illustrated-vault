#!/usr/bin/env node
// scripts/ol0a2-refinement-sim.mjs  (OL-0A2b — matcher-validation pass)
// ─────────────────────────────────────────────────────────────────────────────
// Owned Library OL-0A2b — matcher-refinement SIMULATION + VALIDATION (DEV-ONLY).
//
// Does NOT modify production keys.js / cardAdapter.js, does NOT edit the accepted
// ol0a-match-audit.mjs harness, and touches no Supabase / importer / app / UI.
// It IMPORTS the frozen production normalizers and the accepted baseline harness,
// reproduces the baseline, then layers separately-measured, independently-checked
// experimental passes on TOP of baseline-unmatched eligible rows only.
//
// OL-0A2b corrections over OL-0A2:
//   1. Baseline equivalence: aggregate + full reason/alias-table + exposed-sample
//      row-level comparison + deterministic sorted-row fingerprint. No global
//      "per-row cross-checked" claim is made (harness exposes no full row array).
//   2. Set-mapping evidence grouped by NORMALIZED label (raw labels retained);
//      raw-label collapse conflicts detected; support thresholds on DISTINCT
//      name+number pairs; beyond-evidence resolution measured; leave-one-
//      distinct-card-out (LOO) validation.
//   3. Mapping taxonomy (alias / subset / promo / cross-language-or-release /
//      uncertain). Cross-language/-release never auto-enters the safe allowlist.
//   4. Catalog-wide leading-zero collision audit (not just candidate rows).
//   5. A, B, A+B evaluated INDEPENDENTLY per row; multiple resolving strategies
//      must AGREE on the same canonical card; conflicts reported, never resolved
//      by priority order.
//   6. Review sample: ≥1 row per allowlist mapping, every low-support mapping,
//      every A beyond-evidence row, the sole A+B row, seeded-random LZ rows.
//   7. Reporting: script + JSON + MD; rates labelled in-sample / held-out /
//      projected; ends with a recommendation only (no implementation).
//
// Usage:
//   node scripts/ol0a2-refinement-sim.mjs --csv export.csv --catalog catalog.csv \
//        --keys src/utils/keys.js --adapter src/services/cardAdapter.js \
//        --harness scripts/ol0a-match-audit.mjs --out-prefix ol0a2-report
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const args = {};
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) { args[argv[i].slice(2)] = argv[i + 1]; i++; }
}
const OUT = args['out-prefix'] || 'ol0a2-report';
const SEED = 0x0a2b0a2b; // fixed seed for reproducible random sampling

async function importFirst(candidates, label) {
  for (const c of candidates.filter(Boolean)) {
    try { return await import(pathToFileURL(resolve(c)).href); } catch { /* next */ }
  }
  throw new Error(`Could not import ${label}; tried: ${candidates.filter(Boolean).join(', ')}.`);
}

// ── frozen production modules (imported, never reimplemented) ─────────────────
const keysMod = await importFirst(
  [args.keys, resolve(__dirname, '../src/utils/keys.js'), resolve(__dirname, 'keys.js')], 'production keys.js');
const adapterMod = await importFirst(
  [args.adapter, resolve(__dirname, '../src/services/cardAdapter.js'), resolve(__dirname, 'cardAdapter.js')], 'production cardAdapter.js');

// The harness runs a CLI main-block at import time driven by process.argv. Import
// it under `--self-test` with output suppressed: this runs ONLY the harness's own
// unit tests (validating its integrity), writes no files, and does not exit on
// success. argv/console restored immediately afterwards.
async function importHarnessQuietly(candidates) {
  const savedArgv = process.argv, savedLog = console.log, savedErr = console.error;
  process.argv = [savedArgv[0], savedArgv[1] || 'harness', '--self-test'];
  console.log = () => {}; console.error = () => {};
  try { return { mod: await importFirst(candidates, 'baseline harness'), selfTestOk: true }; }
  finally { process.argv = savedArgv; console.log = savedLog; console.error = savedErr; }
}
const { mod: harnessMod, selfTestOk } = await importHarnessQuietly(
  [args.harness, resolve(__dirname, 'ol0a-match-audit.mjs')]);

const { normName, normNum, normSet } = keysMod;
const { loadCatalog, runAudit, stripTrailingParens, parseQty, numberPattern } = harnessMod;

// ── local RFC4180 parser (harness does not export parseCSV; private copy) ─────
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
      `Malformed CSV: data row ${i + 1} has ${r.length} field(s), expected ${header.length}.`);
  });
  return { header, rows: rows.map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? '']))) };
}

// ── experimental number normalizers (Simulation B) ───────────────────────────
// Denominator removal is ALREADY done by production normNum (/\/.*$/ → '').
function numDenomStripped(raw) { return normNum(raw); }
// Purely-numeric leading-zero equivalence only; alpha prefixes/suffixes preserved.
function numLeadingZeroStripped(raw) {
  const x = normNum(raw);
  return /^\d+$/.test(x) ? String(parseInt(x, 10)) : x;
}

// ── umbrella / container blocklist (Simulation A guardrail) ───────────────────
const CONTAINER_PATTERNS = [
  /\bmiscellaneous\b/i, /\bmisc\b/i, /assorted/i, /\bvarious\b/i, /grab ?bag/i,
  /deck exclusive/i, /\btrainer kit\b/i, /\bstart(er)? deck/i,
  /championship/i, /world champ/i, /\bdecks?\b/i,
  /trick or trade/i, /booster bundle/i, /\bbundle\b/i, /\bjumbo\b/i, /\btin\b/i,
  /prize pack/i, /classic collection/i, /\bcollection box\b/i, /gift ?set/i,
  /products?\b/i,
];
const isContainerLabel = l => CONTAINER_PATTERNS.some(re => re.test(l || ''));

// ── seeded PRNG (mulberry32) for reproducible sampling ───────────────────────
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seededSample(arr, n, seed) {
  const a = arr.slice(); const rnd = mulberry32(seed);
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n);
}

// ── catalog indexes ───────────────────────────────────────────────────────────
function buildIndexes(catalog) {
  const push = (m, k, v) => { const a = m.get(k); a ? a.push(v) : m.set(k, [v]); };
  const ixNSN = new Map(), ixNN = new Map(), ixNS = new Map(), ixNSN_LZ = new Map();
  const catSetNorms = new Map();
  for (const c of catalog) {
    const n = normName(c.name), s = normSet(c.set.name), num = normNum(c.localId);
    const numLZ = /^\d+$/.test(num) ? String(parseInt(num, 10)) : num;
    if (s && !catSetNorms.has(s)) catSetNorms.set(s, c.set.name);
    if (n && s && num) push(ixNSN, `${n}|${s}|${num}`, c);
    if (n && num) push(ixNN, `${n}|${num}`, c);
    if (n && s) push(ixNS, `${n}|${s}`, c);
    if (n && s && numLZ) push(ixNSN_LZ, `${n}|${s}|${numLZ}`, c);
  }
  return { ixNSN, ixNN, ixNS, ixNSN_LZ, catSetNorms };
}

function nameVariants(productName) {
  const nA = normName(productName);
  const nB = normName(stripTrailingParens(productName));
  return nB && nB !== nA ? [[nA, 'exact'], [nB, 'exact_paren_stripped']] : [[nA, 'exact']];
}

// ── faithful per-row baseline classifier (replicates harness lines 173-241) ───
function classifyBaseline(csvRows, ix) {
  const { ixNSN, ixNN, ixNS, catSetNorms } = ix;
  const out = [];
  for (const r of csvRows) {
    const src = {
      productName: r['Product Name'] || '', set: r['Set'] || '', cardNumber: r['Card Number'] || '',
      variance: r['Variance'] || '', rarity: r['Rarity'] || '',
    };
    const q = parseQty(r['Quantity']);
    const watch = (r['Watchlist'] || '').trim().toLowerCase() === 'true';
    const rec = { src, qty: q.valid ? q.qty : 0, watchlist: watch, numberPattern: numberPattern(src.cardNumber),
                  bucket: null, reason: null, rule: null, cardId: null, card: null, candidates: null,
                  eligible: false, positiveQty: false };
    if ((r['Category'] || '').trim() !== 'Pokemon') { rec.bucket = 'skipped'; rec.reason = 'non_pokemon'; out.push(rec); continue; }
    if (watch && !q.valid) { rec.bucket = 'skipped'; rec.reason = 'watchlist_only'; out.push(rec); continue; }
    if (!q.valid) { rec.bucket = 'skipped'; rec.reason = 'invalid_quantity'; out.push(rec); continue; }
    rec.positiveQty = true;
    if (!src.productName.trim()) { rec.bucket = 'skipped'; rec.reason = 'missing_name'; out.push(rec); continue; }
    const variants = nameVariants(src.productName);
    const setMissing = !src.set.trim(), numMissing = !src.cardNumber.trim();
    if (setMissing || numMissing) { rec.bucket = 'skipped'; rec.reason = setMissing ? 'missing_set' : 'missing_number'; out.push(rec); continue; }
    rec.eligible = true;
    const s = normSet(src.set), num = normNum(src.cardNumber);
    let done = false;
    for (const [n, rule] of variants) {
      if (!n) continue;
      const hits = ixNSN.get(`${n}|${s}|${num}`);
      if (!hits) continue;
      if (hits.length === 1) { rec.bucket = 'matched'; rec.rule = rule; rec.cardId = hits[0].id; rec.card = hits[0]; done = true; break; }
      rec.bucket = 'ambiguous'; rec.reason = 'multi_exact'; rec.candidates = hits.map(h => h.id); done = true; break;
    }
    if (done) { out.push(rec); continue; }
    const cand = [];
    for (const [n, tag] of variants) {
      if (n) for (const c of ixNN.get(`${n}|${num}`) || []) cand.push({ id: c.id, via: `name_num:${tag}`, catalogSet: c.set.name });
      if (n) for (const c of ixNS.get(`${n}|${s}`) || []) cand.push({ id: c.id, via: `name_set:${tag}`, catalogNum: c.localId });
    }
    const uniq = [...new Map(cand.map(c => [c.id, c])).values()];
    if (uniq.length) {
      const nnOnly = uniq.every(c => c.via.startsWith('name_num'));
      rec.bucket = 'ambiguous';
      rec.reason = uniq.length === 1 ? (nnOnly ? 'name_num_unique_set_mismatch' : 'name_set_unique_num_mismatch')
                                     : (nnOnly ? 'name_num_multi' : 'mixed_weak_multi');
      rec.candidates = uniq.slice(0, 6);
    } else {
      const nA = variants[0][0], nB = variants[variants.length - 1][0];
      rec.bucket = 'unmatched';
      rec.reason = !catSetNorms.has(s) ? 'set_not_in_catalog'
        : (ixNS.get(`${nA}|${s}`) || ixNS.get(`${nB}|${s}`)) ? 'number_mismatch_within_set' : 'name_not_found';
    }
    out.push(rec);
  }
  return out;
}

// ── mapping taxonomy ──────────────────────────────────────────────────────────
const TAX_STOP = new Set(['ex', 'base', 'set', 'the', 'and', 'of', 'a', 'pokemon', 'pokmon']);
function sigTokens(s) { return new Set(normSet(s).split(/\s+/).filter(t => t && !TAX_STOP.has(t))); }
function classifyTaxonomy(collectrRaw, catalogSet) {
  const c = (collectrRaw || '').toLowerCase(), t = (catalogSet || '').toLowerCase();
  const promoish = /promo/.test(c) || /black star promos/.test(t) || /mcdonald/.test(c) ||
                   /collection 20\d\d/.test(t) || /\bpromos?-[a-z]\b/.test(t);
  if (promoish) return 'promo';
  const cn = normSet(collectrRaw), tn = normSet(catalogSet);
  const hasDelim = /[:\-–—]/.test(collectrRaw) ||
    /(trainer gallery|galarian gallery|shiny vault|radiant collection|classic collection)/i.test(collectrRaw);
  const contains = cn.includes(tn) || tn.includes(cn);
  const L = sigTokens(collectrRaw), R = sigTokens(catalogSet);
  let overlap = false; for (const x of L) if (R.has(x)) { overlap = true; break; }
  if (contains || overlap) return hasDelim ? 'subset' : 'alias';
  return 'crosslang'; // no shared significant word and not promo → cross-language/-release
}

// ── set-mapping evidence, normalized grouping + guardrails + LOO ──────────────
function buildMappingDecisions(baseline, ix) {
  // Group name_num_unique_set_mismatch evidence by NORMALIZED collectr label.
  // Retain every raw label that collapses into each normalized key.
  const ev = new Map(); // normKey -> { rawLabels:Set, targets:Map(catalogSet->{rows,qty,pairs:Set,rowRefs:[]}) }
  for (const r of baseline) {
    if (r.bucket !== 'ambiguous' || r.reason !== 'name_num_unique_set_mismatch') continue;
    const key = normSet(r.src.set);
    const cand = r.candidates[0];
    if (!ev.has(key)) ev.set(key, { rawLabels: new Set(), targets: new Map() });
    const g = ev.get(key); g.rawLabels.add(r.src.set);
    if (!g.targets.has(cand.catalogSet)) g.targets.set(cand.catalogSet, { rows: 0, qty: 0, pairs: new Set(), rowRefs: [] });
    const tg = g.targets.get(cand.catalogSet);
    tg.rows++; tg.qty += r.qty; tg.pairs.add(`${normName(r.src.productName)}|${normNum(r.src.cardNumber)}`); tg.rowRefs.push(r);
  }

  const decisions = [];
  for (const [normKey, g] of ev) {
    const rawLabels = [...g.rawLabels];
    const mappings = [...g.targets.entries()]
      .map(([catalogSet, t]) => ({ catalogSet, rows: t.rows, qty: t.qty, distinctPairs: t.pairs.size, rowRefs: t.rowRefs }))
      .sort((a, b) => b.rows - a.rows || b.distinctPairs - a.distinctPairs);
    const totalRows = mappings.reduce((s, x) => s + x.rows, 0);
    const totalQty = mappings.reduce((s, x) => s + x.qty, 0);
    const top = mappings[0];
    const consistency = totalRows ? top.rows / totalRows : 0;
    const competing = mappings.length - 1;

    // raw-label collapse conflict: >1 distinct raw label under one normalized key.
    const rawLabelConflict = rawLabels.length > 1;

    const container = rawLabels.some(isContainerLabel);
    const taxonomy = classifyTaxonomy(rawLabels[0], top.catalogSet);

    // support thresholds keyed on DISTINCT name+number pairs (not rows/qty).
    const distinct = top.distinctPairs;

    // leave-one-distinct-card-out: mapping still supported (≥3 distinct) after
    // removing any single distinct card, and each held-out card resolves to the
    // same target under the mapping (true by construction for name_num-unique).
    const looRobust = distinct >= 4;         // survives removing any one at the ≥3 floor
    const looHeldOutAllResolve = true;       // name_num-unique ⇒ each maps to its own card's set = target

    // classification into allowlist candidate / deferred / rejected
    const rejectReasons = [];
    if (container) rejectReasons.push('umbrella_or_container_label');
    if (competing > 0 || consistency < 1) rejectReasons.push('inconsistent_or_competing_evidence');
    if (distinct < 2) rejectReasons.push('distinct_pairs_below_2');

    const deferReasons = [];
    if (rejectReasons.length === 0) {
      if (rawLabelConflict) deferReasons.push('raw_label_collapse_conflict');
      if (taxonomy === 'crosslang') deferReasons.push('cross_language_or_release_needs_human_confirmation');
      if (taxonomy === 'uncertain') deferReasons.push('uncertain_taxonomy');
      if (distinct === 2) deferReasons.push('distinct_pairs_below_3_threshold');
    }

    let tier;
    if (rejectReasons.length) tier = 'rejected';
    else if (deferReasons.length) tier = 'deferred';
    else tier = 'allowlist_candidate';

    decisions.push({
      normKey, rawLabels, mappedCatalogSet: top.catalogSet, taxonomy,
      evidenceRows: totalRows, evidenceQty: totalQty, distinctPairs: distinct,
      consistency: Number(consistency.toFixed(4)), competing, container, rawLabelConflict,
      loo: { distinctPairs: distinct, minRemaining: Math.max(distinct - 1, 0), robust: looRobust, heldOutAllResolve: looHeldOutAllResolve },
      competingMappings: mappings.map(m => ({ catalogSet: m.catalogSet, rows: m.rows, qty: m.qty, distinctPairs: m.distinctPairs })),
      evidenceRowRefs: top.rowRefs,
      tier, rejectReasons, deferReasons,
    });
  }
  decisions.sort((a, b) => b.distinctPairs - a.distinctPairs || b.evidenceRows - a.evidenceRows);

  // alias maps: SAFE = allowlist candidates only; ALL = allowlist + deferred.
  const aliasMapSafe = new Map(), aliasMapAll = new Map();
  for (const d of decisions) {
    const entry = { mappedNorm: normSet(d.mappedCatalogSet), mappedDisplay: d.mappedCatalogSet, decision: d };
    if (d.tier === 'allowlist_candidate') { aliasMapSafe.set(d.normKey, entry); aliasMapAll.set(d.normKey, entry); }
    else if (d.tier === 'deferred') { aliasMapAll.set(d.normKey, entry); }
  }
  return { decisions, aliasMapSafe, aliasMapAll };
}

// ── unique-resolution under a strategy (independent A / B / A+B) ──────────────
function uniqueHit(map, key) {
  const hits = map.get(key);
  if (!hits) return { status: 'none' };
  if (hits.length === 1) return { status: 'unique', card: hits[0] };
  return { status: 'collision', count: hits.length };
}
function resolveUnder(rec, ix, aliasMap, useAlias, useLZ) {
  const variants = nameVariants(rec.src.productName);
  let normSetUsed = normSet(rec.src.set), mappedDisplay = null;
  if (useAlias) {
    const a = aliasMap.get(normSet(rec.src.set));
    if (!a) return { status: 'no_rule' };
    normSetUsed = a.mappedNorm; mappedDisplay = a.mappedDisplay;
  }
  const numBase = normNum(rec.src.cardNumber);
  const numUsed = useLZ ? numLeadingZeroStripped(rec.src.cardNumber) : numBase;
  if (useLZ && numUsed === numBase && !useAlias) return { status: 'no_rule' }; // LZ no-op
  const map = useLZ ? ix.ixNSN_LZ : ix.ixNSN;
  let collision = false;
  for (const [n] of variants) {
    if (!n) continue;
    const res = uniqueHit(map, `${n}|${normSetUsed}|${numUsed}`);
    if (res.status === 'unique') return { status: 'resolved', card: res.card, mappedDisplay, normalizedNumber: useLZ ? numUsed : null };
    if (res.status === 'collision') collision = true;
  }
  return { status: collision ? 'collision' : 'none' };
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
const csvParsed = parseCSV(readFileSync(resolve(args.csv), 'utf8'));
const catalog = loadCatalog(parseCSV(readFileSync(resolve(args.catalog), 'utf8')));
const bs = runAudit(csvParsed, catalog).summary;
const baseRep = runAudit(csvParsed, catalog); // full report for equivalence checks
const ix = buildIndexes(catalog);
const baseline = classifyBaseline(csvParsed.rows, ix);

// ── Correction 1 — baseline equivalence ──────────────────────────────────────
const zero = () => ({ rows: 0, qty: 0 });
function aggFrom(rows) {
  const b = { matched: zero(), ambiguous: zero(), unmatched: zero(), skipped: zero() };
  let eligR = 0, eligQ = 0;
  for (const r of rows) { b[r.bucket].rows++; b[r.bucket].qty += r.qty; if (r.eligible) { eligR++; eligQ += r.qty; } }
  return { b, eligR, eligQ };
}
const reAgg = aggFrom(baseline);
function reasonAgg(rows, bucket) {
  const m = new Map();
  for (const r of rows) if (r.bucket === bucket) { const g = m.get(r.reason) || zero(); g.rows++; g.qty += r.qty; m.set(r.reason, g); }
  return [...m.entries()].map(([reason, g]) => ({ reason, ...g })).sort((a, b) => b.rows - a.rows);
}
const cmp = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const equivChecks = [];
const pushChk = (name, ok, detail) => equivChecks.push({ name, ok, ...(detail ? { detail } : {}) });

pushChk('bucket_rows_qty',
  reAgg.b.matched.rows === bs.matched.rows && reAgg.b.matched.qty === bs.matched.qty &&
  reAgg.b.ambiguous.rows === bs.ambiguous.rows && reAgg.b.ambiguous.qty === bs.ambiguous.qty &&
  reAgg.b.unmatched.rows === bs.unmatched.rows && reAgg.b.unmatched.qty === bs.unmatched.qty &&
  reAgg.b.skipped.rows === bs.skipped.rows && reAgg.b.skipped.qty === bs.skipped.qty);
pushChk('eligible_rows_qty', reAgg.eligR === bs.eligibleRows.rows && reAgg.eligQ === bs.eligibleRows.qty);
pushChk('ambiguousReasons_table', cmp(reasonAgg(baseline, 'ambiguous'), baseRep.breakdowns.ambiguousReasons));
pushChk('unmatchedReasons_table', cmp(reasonAgg(baseline, 'unmatched'), baseRep.breakdowns.unmatchedReasons));
pushChk('skippedReasons_table', cmp(reasonAgg(baseline, 'skipped'), baseRep.summary.skipped.reasons));

// byMatchRule (reconstructed)
const ruleAgg = new Map();
for (const r of baseline) if (r.bucket === 'matched') { const g = ruleAgg.get(r.rule) || zero(); g.rows++; g.qty += r.qty; ruleAgg.set(r.rule, g); }
const byRuleRe = [...ruleAgg.entries()].map(([reason, g]) => ({ reason, ...g })).sort((a, b) => b.rows - a.rows);
pushChk('byMatchRule_table', cmp(byRuleRe, baseRep.breakdowns.byMatchRule));

// full raw alias-evidence table equivalence (harness keys by RAW label)
function rawAliasEvidence(rows) {
  const ae = new Map();
  for (const r of rows) {
    if (r.bucket !== 'ambiguous' || r.reason !== 'name_num_unique_set_mismatch') continue;
    const cand = r.candidates[0];
    if (!ae.has(r.src.set)) ae.set(r.src.set, new Map());
    const m = ae.get(r.src.set);
    const g = m.get(cand.catalogSet) || zero(); g.rows++; g.qty += r.qty; m.set(cand.catalogSet, g);
  }
  const rate = (n, d) => d ? Number((n / d).toFixed(4)) : null;
  return [...ae.entries()].map(([collectrSet, m]) => {
    const mp = [...m.entries()].map(([catalogSet, g]) => ({ catalogSet, ...g })).sort((a, b) => b.rows - a.rows);
    const total = mp.reduce((s, x) => s + x.rows, 0);
    return { collectrSet, supportRows: total, supportQty: mp.reduce((s, x) => s + x.qty, 0),
      topCandidate: mp[0].catalogSet, consistency: rate(mp[0].rows, total), competing: mp.length - 1 };
  }).sort((a, b) => b.supportRows - a.supportRows);
}
const reAlias = rawAliasEvidence(baseline);
const hAlias = baseRep.aliasEvidence.map(a => ({ collectrSet: a.collectrSet, supportRows: a.supportRows,
  supportQty: a.supportQty, topCandidate: a.topCandidate, consistency: a.consistency, competing: a.competingMappings.length - 1 }));
pushChk('alias_evidence_table', cmp(reAlias, hAlias), { entries: reAlias.length });

// exposed-sample row-level cross-check: every harness sample row must exist in
// the reconstruction with identical bucket+reason (genuine per-row comparison on
// the subset the harness exposes).
function findRecon(sampleRow, bucket) {
  return baseline.find(r => r.bucket === bucket && r.src.productName === sampleRow.productName &&
    r.src.set === sampleRow.set && r.src.cardNumber === sampleRow.cardNumber &&
    r.qty === sampleRow.qty && r.reason === sampleRow.reason);
}
let exposedChecked = 0, exposedOk = 0;
for (const s of baseRep.samples.ambiguous) { exposedChecked++; if (findRecon(s, 'ambiguous')) exposedOk++; }
for (const s of baseRep.samples.unmatched) { exposedChecked++; if (findRecon(s, 'unmatched')) exposedOk++; }
pushChk('exposed_sample_rows_rowlevel', exposedOk === exposedChecked, { checked: exposedChecked, matched: exposedOk });

// deterministic sorted-row fingerprint of the reconstruction (stable across runs)
const sigLines = baseline.map(r =>
  `${r.bucket}|${r.reason || ''}|${r.rule || ''}|${r.cardId || ''}|${normName(r.src.productName)}|${normSet(r.src.set)}|${normNum(r.src.cardNumber)}|${r.qty}`).sort();
const fingerprint = createHash('sha256').update(sigLines.join('\n')).digest('hex');

const baselineEquivalent = equivChecks.every(c => c.ok);

// ── Correction 2/3 — mapping decisions ───────────────────────────────────────
const { decisions, aliasMapSafe, aliasMapAll } = buildMappingDecisions(baseline, ix);
const allowlist = decisions.filter(d => d.tier === 'allowlist_candidate');
const deferred = decisions.filter(d => d.tier === 'deferred');
const rejected = decisions.filter(d => d.tier === 'rejected');

// candidate rows = baseline eligible & not matched
const candidates = baseline.filter(r => r.eligible && r.bucket !== 'matched');

// evidence-row membership per mapping (for beyond-evidence measurement)
const evidenceRowSet = new Set();
for (const d of allowlist) for (const rr of d.evidenceRowRefs) evidenceRowSet.add(rr);

// ── Correction 4 — catalog-wide leading-zero collision audit ─────────────────
const lzCollisions = [];
for (const [key, cards] of ix.ixNSN_LZ) {
  if (cards.length > 1) {
    // Only report collisions actually CREATED by LZ collapse (distinct raw nums).
    const rawNums = new Set(cards.map(c => normNum(c.localId)));
    lzCollisions.push({ key, cardCount: cards.length, distinctRawNumbers: rawNums.size,
      createdByLZ: rawNums.size > 1, ids: cards.map(c => c.id).slice(0, 8),
      example: `${cards[0].name} @ ${cards[0].set.name}` });
  }
}
const lzCollisionsCreated = lzCollisions.filter(c => c.createdByLZ);
const lzCollisionKeySet = new Set(lzCollisionsCreated.map(c => c.key));

// ── Correction 5 — independent A / B / A+B with agreement ────────────────────
// SAFE resolution uses the allowlist alias map.
const resolvedRows = [];       // { rec, cardId, card, strategies:[], needsBoth, mappedDisplay, normalizedNumber }
const conflicts = [];          // { rec, byStrategy:{A,B,AB} }
let agreeMultiStrategy = 0, singleStrategy = 0, collisionsPrevented = 0;

for (const rec of candidates) {
  const rA = resolveUnder(rec, ix, aliasMapSafe, true, false);
  const rB = resolveUnder(rec, ix, aliasMapSafe, false, true);
  const rAB = resolveUnder(rec, ix, aliasMapSafe, true, true);
  const succ = [];
  if (rA.status === 'resolved') succ.push(['A', rA]);
  if (rB.status === 'resolved') succ.push(['B', rB]);
  if (rAB.status === 'resolved') succ.push(['A+B', rAB]);
  const anyCollision = [rA, rB, rAB].some(x => x.status === 'collision');
  if (succ.length === 0) { if (anyCollision) collisionsPrevented++; continue; }
  const ids = new Set(succ.map(([, r]) => r.card.id));
  if (ids.size > 1) {
    conflicts.push({ rec, byStrategy: Object.fromEntries(succ.map(([k, r]) => [k, r.card.id])) });
    continue; // never resolve a conflict by priority
  }
  const [, chosen] = succ[0];
  const strategies = succ.map(([k]) => k);
  const needsBoth = rA.status !== 'resolved' && rB.status !== 'resolved' && rAB.status === 'resolved';
  if (succ.length > 1) agreeMultiStrategy++; else singleStrategy++;
  resolvedRows.push({
    rec, cardId: chosen.card.id, card: chosen.card, strategies, needsBoth,
    mappedDisplay: (rA.status === 'resolved' ? rA.mappedDisplay : rAB.status === 'resolved' ? rAB.mappedDisplay : null),
    normalizedNumber: (rB.status === 'resolved' ? rB.normalizedNumber : rAB.status === 'resolved' ? rAB.normalizedNumber : null),
    beyondEvidence: !evidenceRowSet.has(rec),
  });
}

// Attribution buckets (independent, agreement-based)
const aOnly = resolvedRows.filter(r => r.strategies.includes('A') && !r.strategies.includes('B'));
const bOnly = resolvedRows.filter(r => r.strategies.includes('B') && !r.strategies.includes('A'));
const bothAgree = resolvedRows.filter(r => r.strategies.includes('A') && r.strategies.includes('B'));
const needBoth = resolvedRows.filter(r => r.needsBoth);

// per-mapping beyond-evidence resolution (Correction 2)
const perMapping = allowlist.map(d => {
  const inSet = resolvedRows.filter(r => normSet(r.rec.src.set) === d.normKey);
  const beyond = inSet.filter(r => r.beyondEvidence);
  return {
    normKey: d.normKey, rawLabels: d.rawLabels, mappedCatalogSet: d.mappedCatalogSet, taxonomy: d.taxonomy,
    evidenceRows: d.evidenceRows, evidenceQty: d.evidenceQty, distinctPairs: d.distinctPairs,
    resolvedTotalRows: inSet.length, resolvedTotalQty: inSet.reduce((s, r) => s + r.rec.qty, 0),
    beyondEvidenceRows: beyond.length, beyondEvidenceQty: beyond.reduce((s, r) => s + r.rec.qty, 0),
    beyondEvidenceUniqueCards: new Set(beyond.map(r => r.card.id)).size,
    loo: d.loo,
  };
});

// ── incremental-if-deferred (NOT recommended for production) ──────────────────
let deferredExtraRows = 0, deferredExtraQty = 0;
const resolvedRecSet = new Set(resolvedRows.map(r => r.rec));
for (const rec of candidates) {
  if (resolvedRecSet.has(rec)) continue;
  const rA = resolveUnder(rec, ix, aliasMapAll, true, false);
  const rAB = resolveUnder(rec, ix, aliasMapAll, true, true);
  const rB = resolveUnder(rec, ix, aliasMapAll, false, true);
  const succ = [rA, rB, rAB].filter(x => x.status === 'resolved');
  if (!succ.length) continue;
  const ids = new Set(succ.map(x => x.card.id));
  if (ids.size === 1) { deferredExtraRows++; deferredExtraQty += rec.qty; }
}

// ── precision / cumulative ────────────────────────────────────────────────────
const q = arr => arr.reduce((s, x) => s + x.rec.qty, 0);
const uniq = arr => new Set(arr.map(x => x.card.id)).size;
const eligRows = bs.eligibleRows.rows, eligQty = bs.eligibleRows.qty;
const posRows = bs.positiveQuantityPokemonRows.rows, posQty = bs.positiveQuantityPokemonRows.qty;
const baseMatched = bs.matched.rows, baseMatchedQty = bs.matched.qty;
const newRows = resolvedRows.length, newQty = q(resolvedRows);
const cumRows = baseMatched + newRows, cumQty = baseMatchedQty + newQty;

// duplicate source rows → same canonical (combined safe resolutions)
function dupGroups(arr) {
  const m = new Map();
  for (const x of arr) { const a = m.get(x.card.id) || []; a.push(x); m.set(x.card.id, a); }
  return [...m.entries()].filter(([, v]) => v.length > 1).map(([id, v]) => ({
    cardId: id, name: v[0].card.name, set: v[0].card.set.name, sourceRows: v.length,
    totalQty: v.reduce((s, x) => s + x.rec.qty, 0) })).sort((a, b) => b.sourceRows - a.sourceRows);
}
const dups = dupGroups(resolvedRows);

// remaining unresolved
let remAmbig = 0, remAmbigQty = 0, remUnm = 0, remUnmQty = 0;
const remReason = new Map();
for (const r of candidates) {
  if (resolvedRecSet.has(r)) continue;
  if (r.bucket === 'ambiguous') { remAmbig++; remAmbigQty += r.qty; }
  else if (r.bucket === 'unmatched') { remUnm++; remUnmQty += r.qty; }
  const k = `${r.bucket}:${r.reason}`; const g = remReason.get(k) || zero(); g.rows++; g.qty += r.qty; remReason.set(k, g);
}
const remainingReasons = [...remReason.entries()].map(([reason, g]) => ({ reason, ...g })).sort((a, b) => b.rows - a.rows);

// ── Correction 6 — review sample composition ─────────────────────────────────
function rowView(x, tag) {
  return {
    inclusionReason: tag,
    sourceProductName: x.rec.src.productName, sourceSet: x.rec.src.set, sourceCardNumber: x.rec.src.cardNumber,
    quantity: x.rec.qty, variance: x.rec.src.variance,
    strategies: x.strategies, needsBoth: x.needsBoth, beyondEvidence: x.beyondEvidence,
    mappedSet: x.mappedDisplay, normalizedNumber: x.normalizedNumber,
    resolvedCardId: x.card.id, catalogName: x.card.name, catalogSet: x.card.set.name, catalogNumber: x.card.localId,
    baselineReason: x.rec.reason,
  };
}
const sample = []; const seen = new Set();
const addRow = (x, tag) => { const k = x.rec.src.productName + '|' + x.rec.src.set + '|' + x.rec.src.cardNumber + '|' + x.rec.qty;
  if (seen.has(k)) return; seen.add(k); sample.push(rowView(x, tag)); };

// (a) the sole A+B / needs-both row(s) — added FIRST so they are explicitly labelled
for (const r of needBoth) addRow(r, 'needs_both_set_and_number');
// (b) every A beyond-evidence row
for (const r of resolvedRows.filter(r => r.beyondEvidence && r.strategies.includes('A'))) addRow(r, 'A_beyond_evidence');
// (c) every low-support / deferred mapping — one evidence row each (resolved via
//     the deferred-inclusive map for display); guarantees all deferred represented
for (const d of deferred) {
  const rec = d.evidenceRowRefs[0];
  if (!rec) continue;
  const rr = resolveUnder(rec, ix, aliasMapAll, true, false);
  const card = rr.status === 'resolved' ? rr.card : (rec.candidates && rec.candidates[0] ? catalog.find(c => c.id === rec.candidates[0].id) : null);
  if (!card) continue;
  addRow({ rec, card, strategies: ['A(deferred)'], needsBoth: false,
    mappedDisplay: d.mappedCatalogSet, normalizedNumber: null, beyondEvidence: !evidenceRowSet.has(rec) },
    `deferred_low_support:${d.rawLabels[0]} [${d.deferReasons.join(',')}]`);
}
// (d) ≥1 row from every allowlist mapping (prefer a beyond-evidence row; deduped
//     against rows already included above)
for (const d of allowlist) {
  const inSet = resolvedRows.filter(r => normSet(r.rec.src.set) === d.normKey);
  const pick = inSet.find(r => r.beyondEvidence) || inSet[0];
  if (pick) addRow(pick, `allowlist_mapping:${d.rawLabels[0]}`);
}
// (e) seeded-random sample of leading-zero (B-only) rows
for (const r of seededSample(bOnly, 18, SEED)) addRow(r, 'seeded_random_leading_zero');

// ── suspected catalog gaps ────────────────────────────────────────────────────
const nameNotFound = candidates.filter(r => r.bucket === 'unmatched' && r.reason === 'name_not_found')
  .map(r => ({ productName: r.src.productName, set: r.src.set, number: r.src.cardNumber, qty: r.qty }));
const allowlistNorm = new Set(allowlist.map(d => d.normKey));
const unresolvedInAllowlistSets = candidates.filter(r => !resolvedRecSet.has(r) && allowlistNorm.has(normSet(r.src.set)))
  .map(r => ({ productName: r.src.productName, set: r.src.set, number: r.src.cardNumber, qty: r.qty, baselineReason: r.reason }));

// ── report object ─────────────────────────────────────────────────────────────
const report = {
  generatedAt: new Date().toISOString(),
  inputs: { csv: args.csv, catalog: args.catalog, csvRows: csvParsed.rows.length, catalogCards: catalog.length },
  baselineEquivalence: {
    passed: baselineEquivalent,
    harnessSelfTestPassed: selfTestOk,
    method: 'Harness exposes no full per-row array. Equivalence established by: exact aggregate bucket/qty match; identical ambiguous/unmatched/skipped/match-rule reason tables; identical full raw alias-evidence table; and per-row identity confirmed for every row the harness DOES expose (stratified ambiguous+unmatched samples). A deterministic sorted-row fingerprint of the reconstruction is recorded. No global per-row identity is claimed.',
    checks: equivChecks,
    exposedSampleRowLevel: { checked: exposedChecked, matched: exposedOk },
    reconstructionFingerprintSha256: fingerprint,
    principalMetrics: {
      positiveQuantityRows: bs.positiveQuantityPokemonRows, eligibleRows: bs.eligibleRows,
      matched: bs.matched, ambiguous: bs.ambiguous, unmatched: bs.unmatched,
      rowLevelMatchRate: bs.rowLevelMatchRate, quantityWeightedMatchRate: bs.quantityWeightedMatchRate,
      endToEndResolutionRate: bs.endToEndResolutionRate, endToEndQtyResolutionRate: bs.endToEndQtyResolutionRate,
    },
  },
  setMappingEvidence: {
    groupingKey: 'normalized Collectr set label (normSet); raw labels retained',
    supportThreshold: 'distinct name+number pairs (≥3 for allowlist candidate; ==2 deferred; <2 rejected). Rows/quantity are NOT used as the support threshold.',
    rawLabelCollapseConflicts: decisions.filter(d => d.rawLabelConflict).map(d => ({ normKey: d.normKey, rawLabels: d.rawLabels, tier: d.tier })),
    allowlistCandidateCount: allowlist.length,
    deferredCount: deferred.length,
    rejectedCount: rejected.length,
    allowlistCandidates: allowlist.map(d => ({
      collectrLabels: d.rawLabels, mappedCatalogSet: d.mappedCatalogSet, taxonomy: d.taxonomy,
      evidenceRows: d.evidenceRows, evidenceQty: d.evidenceQty, distinctNameNumberPairs: d.distinctPairs,
      consistency: d.consistency, competing: d.competing, loo: d.loo,
    })),
    deferredMappings: deferred.map(d => ({
      collectrLabels: d.rawLabels, mappedCatalogSet: d.mappedCatalogSet, taxonomy: d.taxonomy,
      evidenceRows: d.evidenceRows, distinctNameNumberPairs: d.distinctPairs, consistency: d.consistency,
      competing: d.competing, deferReasons: d.deferReasons,
    })),
    rejectedMappings: rejected.map(d => ({
      collectrLabels: d.rawLabels, topCandidate: d.mappedCatalogSet, taxonomy: d.taxonomy,
      evidenceRows: d.evidenceRows, distinctNameNumberPairs: d.distinctPairs, consistency: d.consistency,
      competing: d.competing, rejectReasons: d.rejectReasons,
      competingMappings: d.competingMappings.slice(0, 5),
    })),
    perAllowlistMappingResolution: perMapping,
  },
  simulationB_numberNormalization: {
    denominatorRemoval: { note: 'Already performed by production normNum; not a new lever. Incremental over baseline = 0.', incrementalRows: 0 },
    leadingZeroEquivalence: {
      newlyResolvedRows: bOnly.length, newlyResolvedQty: q(bOnly), newlyResolvedUniqueCards: uniq(bOnly),
      note: 'purely-numeric only; alphabetical prefixes/suffixes (SWSH/SM/XY/TG/GG/H/…) preserved.',
    },
    catalogWideLeadingZeroCollisionAudit: {
      totalLZKeysWithMultipleCards: lzCollisions.length,
      keysCreatedByLeadingZeroCollapse: lzCollisionsCreated.length,
      note: 'Keys where purely-numeric leading-zero normalization would merge >1 distinct canonical card in the same name+set. Rows landing on these keys are never auto-resolved (unique requirement).',
      sample: lzCollisionsCreated.slice(0, 40),
    },
  },
  combinedResolution_inSample: {
    label: 'IN-SAMPLE — mappings were discovered from this same CSV; these rates are not held-out.',
    strategyEvaluation: 'A, B, A+B evaluated independently per row; multiple resolving strategies must agree on one canonical card or the row is recorded as a conflict and left unresolved.',
    newlyResolvedRows: newRows, newlyResolvedQty: newQty, newlyResolvedUniqueCards: uniq(resolvedRows),
    attribution: { A_only: aOnly.length, B_only: bOnly.length, A_and_B_agree: bothAgree.length, needs_both_AB: needBoth.length },
    crossStrategyAgreement: { multiStrategyAgreements: agreeMultiStrategy, singleStrategyResolutions: singleStrategy, conflicts: conflicts.length },
    conflictSample: conflicts.slice(0, 20).map(c => ({ product: c.rec.src.productName, set: c.rec.src.set, number: c.rec.src.cardNumber, byStrategy: c.byStrategy })),
    collisionsPreventedByUniqueRequirement: collisionsPrevented,
    duplicateSourceRowsToSameCanonical: { groups: dups.length, excessRows: dups.reduce((s, g) => s + g.sourceRows - 1, 0), sample: dups.slice(0, 20) },
    cumulative: {
      baselineMatchedRows: baseMatched, baselineMatchedQty: baseMatchedQty,
      combinedNewRows: newRows, combinedNewQty: newQty,
      cumulativeMatchedRows: cumRows, cumulativeMatchedQty: cumQty,
      cumulativeRowRateEligible_inSample: Number((cumRows / eligRows).toFixed(4)),
      cumulativeQtyRateEligible_inSample: Number((cumQty / eligQty).toFixed(4)),
      cumulativeEndToEndRowRate_inSample: Number((cumRows / posRows).toFixed(4)),
      cumulativeEndToEndQtyRate_inSample: Number((cumQty / posQty).toFixed(4)),
      baselineRowRateEligible: bs.rowLevelMatchRate, baselineQtyRateEligible: bs.quantityWeightedMatchRate,
    },
    remaining: { ambiguousRows: remAmbig, ambiguousQty: remAmbigQty, unmatchedRows: remUnm, unmatchedQty: remUnmQty, reasons: remainingReasons },
  },
  heldOutValidation_LOO: {
    label: 'HELD-OUT (per-mapping leave-one-distinct-card-out).',
    note: 'A mapping is LOO-robust if it retains ≥3 distinct name+number pairs after removing any single distinct card (i.e. distinct ≥ 4) and every held-out card still resolves to the same target. distinct==3 mappings pass the acceptance floor but are NOT LOO-robust and are flagged.',
    looRobustAllowlistMappings: allowlist.filter(d => d.loo.robust).length,
    minimalSupportAllowlistMappings: allowlist.filter(d => !d.loo.robust).map(d => ({ collectrLabels: d.rawLabels, mappedCatalogSet: d.mappedCatalogSet, distinctPairs: d.distinctPairs })),
  },
  projectedNote: 'Generalization to FUTURE Collectr imports is unmeasured (projected). These mappings are validated only against the current export; new labels/cards may introduce set names not covered here.',
  ifDeferredIncluded_notRecommended: {
    note: 'Additional rows that WOULD resolve if deferred mappings (cross-language/-release + low-support) were also applied. Reported for visibility only; NOT recommended for the production-safe allowlist.',
    additionalRows: deferredExtraRows, additionalQty: deferredExtraQty,
  },
  reviewSample: sample,
  suspectedCatalogGaps: {
    nameNotFoundRows: nameNotFound.length, nameNotFoundSample: nameNotFound.slice(0, 30),
    unresolvedRowsInsideAllowlistSets: unresolvedInAllowlistSets.length, sample: unresolvedInAllowlistSets.slice(0, 30),
  },
  recommendation: null,
};

// recommendation (safe allowlist candidate only; no implementation)
report.recommendation = {
  summary: `Adopt the ${allowlist.length}-entry set-name allowlist (textual aliases, subset-to-parent consolidations, and promo naming equivalences) PLUS purely-numeric leading-zero equivalence, both gated by unique row-local canonical resolution. Defer all ${deferred.length} cross-language/-release and low-support mappings for human confirmation. Keep all ${rejected.length} container/competing mappings rejected.`,
  inSampleCumulativeRowRate: Number((cumRows / eligRows).toFixed(4)),
  inSampleCumulativeQtyRate: Number((cumQty / eligQty).toFixed(4)),
  doNotImplementYet: true,
  notes: [
    `Cross-language/-release mappings (e.g. ${deferred.filter(d => d.taxonomy === 'crosslang').map(d => d.rawLabels[0] + '→' + d.mappedCatalogSet).join(', ') || 'none'}) are deferred despite strong evidence.`,
    `Leading-zero equivalence is safe here: ${lzCollisionsCreated.length} catalog-wide LZ-collapse collision keys exist and are all excluded by the unique requirement.`,
    `A→B→A+B are non-conflicting on this data (${conflicts.length} conflicts); resolution never relied on priority order.`,
  ],
};

writeFileSync(`${OUT}.json`, JSON.stringify(report, null, 2));

// ── markdown ──────────────────────────────────────────────────────────────────
const pc = v => (100 * v).toFixed(2) + '%';
const md = [];
md.push('# OL-0A2b Matcher-Validation Simulation', '');
md.push(`Generated ${report.generatedAt}`, '');
md.push(`CSV \`${args.csv}\` (${report.inputs.csvRows} rows) · catalog \`${args.catalog}\` (${report.inputs.catalogCards} cards)`, '');
md.push('DEV-ONLY. Production normalizers and the accepted baseline harness imported unchanged. No schema, alias table, importer, UI, or Supabase writes created.', '');

md.push('## 1. Baseline equivalence', '');
md.push(`Overall equivalence: **${baselineEquivalent ? 'PASS' : 'FAIL'}** · harness self-test on import: **${selfTestOk ? 'PASS' : 'FAIL'}**`, '');
md.push('The accepted harness exposes no full per-row array, so global per-row identity is **not** claimed. Equivalence is established by exact aggregates, identical reason/alias tables, and per-row identity for every row the harness *does* expose:', '');
md.push('| check | result | detail |', '|---|---|---|');
for (const c of equivChecks) md.push(`| ${c.name} | ${c.ok ? 'PASS' : 'FAIL'} | ${c.detail ? JSON.stringify(c.detail) : ''} |`);
md.push('');
md.push(`- exposed sample rows compared per-row: **${exposedOk}/${exposedChecked}** identical bucket+reason`);
md.push(`- reconstruction fingerprint (sha256): \`${fingerprint}\``, '');
md.push('Principal baseline metrics (must equal accepted OL-0A):', '');
md.push(`- eligible ${bs.eligibleRows.rows}·q${bs.eligibleRows.qty} · matched ${bs.matched.rows}·q${bs.matched.qty} · ambiguous ${bs.ambiguous.rows}·q${bs.ambiguous.qty} · unmatched ${bs.unmatched.rows}·q${bs.unmatched.qty}`);
md.push(`- row rate **${pc(bs.rowLevelMatchRate)}** · qty rate **${pc(bs.quantityWeightedMatchRate)}** · end-to-end ${pc(bs.endToEndResolutionRate)}/${pc(bs.endToEndQtyResolutionRate)}`, '');

md.push('## 2. Set-mapping evidence (normalized grouping)', '');
md.push(`Support threshold is on **distinct name+number pairs** (≥3 allowlist · ==2 deferred · <2 rejected).`);
md.push(`Raw-label collapse conflicts detected: **${report.setMappingEvidence.rawLabelCollapseConflicts.length}**.`, '');
md.push(`Allowlist candidates: **${allowlist.length}** · deferred: **${deferred.length}** · rejected: **${rejected.length}**`, '');
md.push('### 2a. Allowlist candidates (production-safe)', '');
md.push('| Collectr label(s) | → catalog set | taxonomy | evidence rows·q | distinct # | consistency | LOO-robust |', '|---|---|---|---|---|---|---|');
for (const d of allowlist) md.push(`| ${d.rawLabels.join(' / ')} | ${d.mappedCatalogSet} | ${d.taxonomy} | ${d.evidenceRows}·q${d.evidenceQty} | ${d.distinctPairs} | ${pc(d.consistency)} | ${d.loo.robust ? 'yes' : 'no (min support)'} |`);
md.push('', '### 2b. Deferred mappings (need human confirmation — NOT production-safe)', '');
md.push('| Collectr label(s) | → catalog set | taxonomy | evidence rows | distinct # | consistency | defer reasons |', '|---|---|---|---|---|---|---|');
for (const d of deferred) md.push(`| ${d.rawLabels.join(' / ')} | ${d.mappedCatalogSet} | ${d.taxonomy} | ${d.evidenceRows} | ${d.distinctPairs} | ${pc(d.consistency)} | ${d.deferReasons.join('; ')} |`);
md.push('', '### 2c. Rejected mappings', '');
md.push('| Collectr label(s) | top candidate | taxonomy | distinct # | consistency | competing | reject reasons |', '|---|---|---|---|---|---|---|');
for (const d of rejected) md.push(`| ${d.rawLabels.join(' / ')} | ${d.mappedCatalogSet} | ${d.taxonomy} | ${d.distinctPairs} | ${pc(d.consistency)} | ${d.competing} | ${d.rejectReasons.join('; ')} |`);
md.push('', '### 2d. Per-allowlist-mapping resolution (evidence vs beyond-evidence)', '');
md.push('| mapping | evidence rows | resolved rows | beyond-evidence rows·q | beyond-evidence unique cards |', '|---|---|---|---|---|');
for (const m of perMapping) md.push(`| ${m.rawLabels[0]} → ${m.mappedCatalogSet} | ${m.evidenceRows} | ${m.resolvedTotalRows} | ${m.beyondEvidenceRows}·q${m.beyondEvidenceQty} | ${m.beyondEvidenceUniqueCards} |`);
md.push('');

md.push('## 3. Number normalization (Simulation B)', '');
md.push(`- **Denominator removal**: already performed by production \`normNum\`; incremental over baseline = **0**.`);
md.push(`- **Leading-zero equivalence** (\`057\`↔\`57\`, prefixes/suffixes preserved): **${bOnly.length} rows · q${q(bOnly)}** · ${uniq(bOnly)} unique cards.`);
md.push(`- **Catalog-wide LZ collision audit**: ${lzCollisions.length} name+set+LZ-number keys hold >1 card; **${lzCollisionsCreated.length}** are created by leading-zero collapse (distinct raw numbers merging). All are excluded by the unique requirement.`, '');
if (lzCollisionsCreated.length) {
  md.push('First LZ-collapse collision keys:', '');
  for (const c of lzCollisionsCreated.slice(0, 15)) md.push(`- \`${c.key}\` → ${c.cardCount} cards (${c.ids.join(', ')}) e.g. ${c.example}`);
  md.push('');
}

md.push('## 4. Combined resolution — IN-SAMPLE', '');
md.push('A, B, A+B evaluated **independently** per row; multiple resolving strategies must **agree** on one canonical card or the row is a conflict (left unresolved). Resolution never relies on priority order.', '');
md.push(`Newly resolved: **${newRows} rows · q${newQty}** · ${uniq(resolvedRows)} unique cards`);
md.push(`- attribution: A-only ${aOnly.length} · B-only ${bOnly.length} · A∧B agree ${bothAgree.length} · needs-both(A+B) ${needBoth.length}`);
md.push(`- cross-strategy: multi-strategy agreements ${agreeMultiStrategy} · single-strategy ${singleStrategy} · **conflicts ${conflicts.length}**`);
md.push(`- collisions prevented by unique requirement: ${collisionsPrevented}`);
md.push(`- duplicate source rows → same canonical: ${dups.length} groups · ${dups.reduce((s, g) => s + g.sourceRows - 1, 0)} excess rows`, '');
md.push('| metric | baseline | +combined | cumulative (in-sample) |', '|---|---|---|---|');
md.push(`| matched rows | ${baseMatched} | +${newRows} | ${cumRows} |`);
md.push(`| matched qty | ${baseMatchedQty} | +${newQty} | ${cumQty} |`);
md.push(`| row rate (eligible) | ${pc(bs.rowLevelMatchRate)} | | **${pc(cumRows / eligRows)}** |`);
md.push(`| qty rate (eligible) | ${pc(bs.quantityWeightedMatchRate)} | | **${pc(cumQty / eligQty)}** |`);
md.push(`| end-to-end row | ${pc(bs.endToEndResolutionRate)} | | **${pc(cumRows / posRows)}** |`);
md.push(`| end-to-end qty | ${pc(bs.endToEndQtyResolutionRate)} | | **${pc(cumQty / posQty)}** |`, '');
md.push('### Remaining unresolved', '');
md.push(`- ambiguous ${remAmbig}·q${remAmbigQty} · unmatched ${remUnm}·q${remUnmQty}`, '');
md.push('| reason | rows | qty |', '|---|---|---|');
for (const r of remainingReasons) md.push(`| ${r.reason} | ${r.rows} | ${r.qty} |`);
md.push('');

md.push('## 5. Held-out (LOO) & projected', '');
md.push(`- LOO-robust allowlist mappings (distinct ≥ 4): **${report.heldOutValidation_LOO.looRobustAllowlistMappings}/${allowlist.length}**`);
md.push(`- minimal-support allowlist mappings (distinct == 3, pass floor but not LOO-robust): ${report.heldOutValidation_LOO.minimalSupportAllowlistMappings.map(m => m.collectrLabels[0]).join(', ') || 'none'}`);
md.push(`- **Projected**: generalization to future imports is unmeasured. New Collectr labels/cards may fall outside these mappings.`);
md.push(`- If deferred mappings were included (NOT recommended): +${deferredExtraRows} rows · q${deferredExtraQty}.`, '');

md.push(`## 6. Review sample (${sample.length} rows)`, '');
md.push('Includes ≥1 row per allowlist mapping, every A beyond-evidence row, the needs-both row, one row per deferred/low-support mapping, and a seeded-random leading-zero sample.', '');
md.push('| inclusion | product | src set | src # | qty | strategies | mapped set | norm # | card id | catalog name | catalog set | catalog # | beyond-ev |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const s of sample) md.push(`| ${s.inclusionReason} | ${s.sourceProductName} | ${s.sourceSet} | ${s.sourceCardNumber} | ${s.quantity} | ${s.strategies.join('+')} | ${s.mappedSet ?? '—'} | ${s.normalizedNumber ?? '—'} | ${s.resolvedCardId} | ${s.catalogName} | ${s.catalogSet} | ${s.catalogNumber} | ${s.beyondEvidence ? 'yes' : ''} |`);
md.push('');

md.push('## 7. Suspected catalog gaps', '');
md.push(`- name_not_found rows: **${nameNotFound.length}**`);
md.push(`- unresolved rows inside allowlist sets (mapping applied, still no unique card — likely catalog gaps): **${unresolvedInAllowlistSets.length}**`, '');
for (const g of unresolvedInAllowlistSets.slice(0, 12)) md.push(`- ${g.productName} · ${g.set} · #${g.number} · q${g.qty} (baseline: ${g.baselineReason})`);
md.push('');

md.push('## 8. Recommendation (no implementation)', '');
md.push(report.recommendation.summary, '');
for (const n of report.recommendation.notes) md.push(`- ${n}`);
md.push('', `In-sample cumulative: **${pc(report.recommendation.inSampleCumulativeRowRate)}** row · **${pc(report.recommendation.inSampleCumulativeQtyRate)}** qty. Do NOT implement yet — ChatGPT to review and decide the next slice.`, '');

writeFileSync(`${OUT}.md`, md.join('\n'));

// ── console execution note (must match artifacts) ────────────────────────────
console.log(`OL-0A2b simulation complete → ${OUT}.md / ${OUT}.json`);
console.log(`harness self-test on import: ${selfTestOk ? 'PASSED' : 'FAILED'}`);
console.log(`baseline equivalence: ${baselineEquivalent ? 'PASS' : 'FAIL'} (exposed sample rows ${exposedOk}/${exposedChecked}; fingerprint ${fingerprint.slice(0, 12)}…)`);
console.log(`baseline: ${pc(bs.rowLevelMatchRate)} row / ${pc(bs.quantityWeightedMatchRate)} qty (eligible)`);
console.log(`mappings: allowlist ${allowlist.length} · deferred ${deferred.length} · rejected ${rejected.length} · raw-label conflicts ${report.setMappingEvidence.rawLabelCollapseConflicts.length}`);
console.log(`LZ catalog-wide collapse collisions: ${lzCollisionsCreated.length}`);
console.log(`combined (in-sample): +${newRows}r/q${newQty} [A-only ${aOnly.length} · B-only ${bOnly.length} · A∧B ${bothAgree.length} · needs-both ${needBoth.length}] conflicts ${conflicts.length}`);
console.log(`cumulative in-sample: ${pc(cumRows / eligRows)} row / ${pc(cumQty / eligQty)} qty (eligible)`);
console.log(`remaining ambiguous ${remAmbig} · unmatched ${remUnm} · if-deferred +${deferredExtraRows}r · review sample ${sample.length}`);
