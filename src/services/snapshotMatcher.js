// src/services/snapshotMatcher.js
// OL-0C — pure, framework-free Collectr→catalog snapshot matcher.
//
// No Supabase, no React, no fs. Deterministic and unit-testable in isolation.
//
// Reuses the FROZEN production normalizers (normName/normNum/normSet) from
// keys.js unchanged. Replicates the accepted OL-0A baseline classifier
// (scripts/ol0a-match-audit.mjs runAudit, lines ~173-241) and the approved
// OL-0A2b combined resolution (scripts/ol0a2-refinement-sim.mjs resolveUnder /
// combined section), gated by the set-name allowlist (the frozen 33-entry OL-0A2b
// core plus the approved one-entry OL-2B extension = 34 total; see ol0aAllowlist.js)
// and purely-numeric leading-zero equivalence. Every successful strategy must agree on one
// canonical card ID or the row is left unresolved (conflict). It does NOT read,
// write, or reinterpret owned_keys.
//
// stripTrailingParens / parseQty are ported VERBATIM from ol0a-match-audit.mjs
// (they are harness helpers, not production frozen modules) so the browser
// matcher performs identical eligibility + name-variant handling. The OL-0C
// validation harness asserts equivalence against the real harness.

import { normName, normNum, normSet } from '../utils/keys.js';
import { OL0A_SET_ALLOWLIST } from '../constants/ol0aAllowlist.js';

// Bump when matcher policy changes; stored in user_import_batches.matcher_version.
// OL-2B: adds the recovery-scoped cross-language guard (languageMarked) and the
// one-entry McDonald's Promos 2024 alias (in ol0aAllowlist.js). No change to gate(),
// classifyEligible, normalizers, agreement/conflict logic, or the match_rule vocabulary.
export const MATCHER_VERSION = 'ol2b-1';

// ── ported harness helpers (verbatim; see provenance above) ───────────────────
export function stripTrailingParens(s) {
  let out = (s || '').trim();
  for (;;) {
    const next = out.replace(/\s*\([^()]*\)\s*$/, '').trim();
    if (next === out) return out;
    out = next;
  }
}
export function parseQty(raw) {
  const t = (raw ?? '').toString().trim();
  if (!/^\d+$/.test(t)) return { valid: false, qty: 0, raw: t };
  const n = Number(t);
  return n > 0 ? { valid: true, qty: n, raw: t } : { valid: false, qty: 0, raw: t };
}

// purely-numeric leading-zero equivalence; alpha prefixes/suffixes preserved.
function numLeadingZeroStripped(raw) {
  const x = normNum(raw);
  return /^\d+$/.test(x) ? String(parseInt(x, 10)) : x;
}

// ── frozen allowlist → normSet-keyed alias map (built once) ────────────────────
const ALIAS_MAP = (() => {
  const m = new Map();
  for (const { collectrLabel, catalogSet } of OL0A_SET_ALLOWLIST) {
    m.set(normSet(collectrLabel), { mappedNorm: normSet(catalogSet), mappedDisplay: catalogSet });
  }
  return m;
})();

// ── catalog indexes (mirrors ol0a2-refinement-sim.mjs buildIndexes) ────────────
// catalog: array of card shapes { id, name, localId, set:{ name } }.
export function buildCatalogIndex(catalog) {
  const push = (m, k, v) => { const a = m.get(k); a ? a.push(v) : m.set(k, [v]); };
  const ixNSN = new Map(), ixNN = new Map(), ixNS = new Map(), ixNSN_LZ = new Map();
  const catSetNorms = new Map();
  for (const c of catalog) {
    const n = normName(c.name), s = normSet(c.set && c.set.name), num = normNum(c.localId);
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

function uniqueHit(map, key) {
  const hits = map.get(key);
  if (!hits) return { status: 'none' };
  if (hits.length === 1) return { status: 'unique', card: hits[0] };
  return { status: 'collision' };
}

// Resolve a row under one strategy. useAlias applies the frozen set-name alias;
// useLZ applies purely-numeric leading-zero equivalence. Returns which name
// variant hit and which transforms were ACTUALLY required (for match_rule).
function resolveUnder(src, ix, useAlias, useLZ) {
  const variants = nameVariants(src.productName);
  let normSetUsed = normSet(src.set), aliasApplied = false;
  if (useAlias) {
    const a = ALIAS_MAP.get(normSet(src.set));
    if (!a) return { status: 'no_rule' };
    normSetUsed = a.mappedNorm; aliasApplied = true;
  }
  const numBase = normNum(src.cardNumber);
  const numUsed = useLZ ? numLeadingZeroStripped(src.cardNumber) : numBase;
  const lzApplied = useLZ && numUsed !== numBase;
  // LZ no-op guard (matches sim): a pure-LZ strategy that changes nothing is inert.
  if (useLZ && !lzApplied && !useAlias) return { status: 'no_rule' };
  const map = useLZ ? ix.ixNSN_LZ : ix.ixNSN;
  let collision = false;
  for (const [n, variantRule] of variants) {
    if (!n) continue;
    const res = uniqueHit(map, `${n}|${normSetUsed}|${numUsed}`);
    if (res.status === 'unique') return { status: 'resolved', card: res.card, variantRule, aliasApplied, lzApplied };
    if (res.status === 'collision') collision = true;
  }
  return { status: collision ? 'collision' : 'none' };
}

// Compose a bounded match_rule recording ONLY transforms actually required.
function composeRule({ aliasApplied, lzApplied, variantRule }) {
  const base = aliasApplied && lzApplied ? 'set_alias_leading_zero'
             : aliasApplied ? 'set_alias'
             : lzApplied ? 'leading_zero'
             : null;
  if (!base) return null;
  return variantRule === 'exact_paren_stripped' ? `${base}_paren_stripped` : base;
}

// Combined resolution over a single baseline-non-matched eligible row.
// Returns { resolved:true, cardId, matchRule } or { resolved:false } (kept as
// baseline). Conflicts (strategies disagree on the card) are never resolved.
function combinedResolve(src, ix) {
  const succ = [];
  for (const [uA, uL] of [[true, false], [false, true], [true, true]]) {
    const r = resolveUnder(src, ix, uA, uL);
    if (r.status === 'resolved') succ.push(r);
  }
  if (!succ.length) return { resolved: false };
  const ids = new Set(succ.map(s => s.card.id));
  if (ids.size > 1) return { resolved: false, conflict: true }; // never resolve by priority
  // Minimal-transform winner. Tie-break (equal weight, differing kind) prefers
  // set_alias for LABELLING only — resolution already succeeded and agreed, so
  // this never affects which card is matched. (A_and_B_agree = 0 on real data.)
  const weight = s => (s.aliasApplied ? 1 : 0) + (s.lzApplied ? 1 : 0);
  succ.sort((a, b) => weight(a) - weight(b)
    || (a.aliasApplied === b.aliasApplied ? 0 : (a.aliasApplied ? -1 : 1)));
  const win = succ[0];
  return { resolved: true, cardId: win.card.id, matchRule: composeRule(win) };
}

// ── row gating (catalog-independent) ──────────────────────────────────────────
// disposition: non_pokemon | watchlist_only | invalid_quantity | invalid_missing | eligible
function gate(r) {
  const src = {
    productName: r['Product Name'] || '', set: r['Set'] || '', cardNumber: r['Card Number'] || '',
    variance: r['Variance'] || '', rarity: r['Rarity'] || '',
  };
  const q = parseQty(r['Quantity']);
  const watch = (r['Watchlist'] || '').trim().toLowerCase() === 'true';
  if ((r['Category'] || '').trim() !== 'Pokemon') return { src, qty: 0, disposition: 'non_pokemon' };
  if (watch && !q.valid) return { src, qty: 0, disposition: 'watchlist_only' };
  if (!q.valid) return { src, qty: 0, disposition: 'invalid_quantity' };
  const missingName = !src.productName.trim(), missingSet = !src.set.trim(), missingNum = !src.cardNumber.trim();
  if (missingName) return { src, qty: q.qty, disposition: 'invalid_missing', reason: 'missing_name' };
  if (missingSet)  return { src, qty: q.qty, disposition: 'invalid_missing', reason: 'missing_set' };
  if (missingNum)  return { src, qty: q.qty, disposition: 'invalid_missing', reason: 'missing_number' };
  return { src, qty: q.qty, disposition: 'eligible' };
}

// Catalog-independent reconciliation (used by the validation harness on the real
// export without needing a catalog). Shares gate() with classify to avoid drift.
export function reconcileCsvOnly(dataRows) {
  const c = { total: dataRows.length, pokemon: 0, non_pokemon: 0, watchlist_only: 0,
    invalid_quantity: 0, positive_qty: 0, invalid_missing: 0, eligible: 0 };
  for (const r of dataRows) {
    const g = gate(r);
    if (g.disposition === 'non_pokemon') { c.non_pokemon++; continue; }
    c.pokemon++;
    if (g.disposition === 'watchlist_only') { c.watchlist_only++; continue; }
    if (g.disposition === 'invalid_quantity') { c.invalid_quantity++; continue; }
    c.positive_qty++;
    if (g.disposition === 'invalid_missing') { c.invalid_missing++; continue; }
    c.eligible++;
  }
  return c;
}

// Baseline classifier for one eligible row (mirrors runAudit tiers exactly).
function classifyEligible(src, ix) {
  const variants = nameVariants(src.productName);
  const s = normSet(src.set), num = normNum(src.cardNumber);
  // Tier 1 — exact name+set+number; unique ⇒ the only auto-match.
  for (const [n, rule] of variants) {
    if (!n) continue;
    const hits = ix.ixNSN.get(`${n}|${s}|${num}`);
    if (!hits) continue;
    if (hits.length === 1) return { bucket: 'matched', rule, cardId: hits[0].id };
    return { bucket: 'ambiguous', reason: 'multi_exact', candidates: hits.map(h => h.id) };
  }
  // Tiers 2/3 — diagnostic only, never auto-matched at baseline.
  const cand = [];
  for (const [n, tag] of variants) {
    if (n) for (const c of ix.ixNN.get(`${n}|${num}`) || []) cand.push({ id: c.id, via: `name_num:${tag}` });
    if (n) for (const c of ix.ixNS.get(`${n}|${s}`) || []) cand.push({ id: c.id, via: `name_set:${tag}` });
  }
  const uniq = [...new Map(cand.map(c => [c.id, c])).values()];
  if (uniq.length) {
    const nnOnly = uniq.every(c => c.via.startsWith('name_num'));
    const reason = uniq.length === 1
      ? (nnOnly ? 'name_num_unique_set_mismatch' : 'name_set_unique_num_mismatch')
      : (nnOnly ? 'name_num_multi' : 'mixed_weak_multi');
    return { bucket: 'ambiguous', reason, candidates: uniq.map(c => c.id) };
  }
  const nA = variants[0][0], nB = variants[variants.length - 1][0];
  const reason = !ix.catSetNorms.has(s) ? 'set_not_in_catalog'
    : (ix.ixNS.get(`${nA}|${s}`) || ix.ixNS.get(`${nB}|${s}`)) ? 'number_mismatch_within_set'
    : 'name_not_found';
  return { bucket: 'unmatched', reason };
}

// ── OL-2B cross-language guard (recovery-scoped) ──────────────────────────────
// Inspects the RAW source fields BEFORE the frozen normalizers run — necessary
// because normName turns a trailing "(JP)" into " jp" in the exact variant and
// erases it entirely in the paren-stripped variant. Used ONLY to skip OL-2B
// recovery (combinedResolve) for JP/CN/KR-marked rows. It NEVER runs against gate()
// or baseline classifyEligible, so the four baseline-matched JP rows keep their exact
// IDs/rules. Narrow by design: a trailing (JP)/(CN)/(KR) product-name token, or a
// Japanese/Chinese/Korean set-label word.
const OL2B_LANG_PAREN = /\((?:JP|CN|KR)\)\s*$/i;          // trailing product-name marker
const OL2B_LANG_SET   = /\b(?:japanese|chinese|korean)\b/i; // set-label marker
export function languageMarked(src) {
  const name = ((src && src.productName) || '').trim();
  const set  = ((src && src.set) || '');
  return OL2B_LANG_PAREN.test(name) || OL2B_LANG_SET.test(set);
}

// ── main entry ────────────────────────────────────────────────────────────────
// dataRows: Papa.parse header rows (objects keyed by Collectr column names).
// ix: catalog index from buildCatalogIndex.
// Returns { stored: [rows ready for user_import_rows], counts: {batch header} }.
export function classifyCollectrRows(dataRows, ix) {
  const stored = [];
  const counts = {
    total_source_rows: dataRows.length, pokemon_rows: 0, non_pokemon_rows: 0,
    positive_qty_rows: 0, watchlist_only_rows: 0, invalid_quantity_rows: 0,
    stored_rows: 0, matched_rows: 0, ambiguous_rows: 0, unmatched_rows: 0, invalid_rows: 0,
  };
  let conflicts = 0;

  dataRows.forEach((r, i) => {
    const sourceRowNumber = i + 1; // 1-based, unique per batch
    const g = gate(r);
    const { src } = g;

    if (g.disposition === 'non_pokemon') { counts.non_pokemon_rows++; return; }
    counts.pokemon_rows++;
    if (g.disposition === 'watchlist_only') { counts.watchlist_only_rows++; return; }
    if (g.disposition === 'invalid_quantity') { counts.invalid_quantity_rows++; return; }
    counts.positive_qty_rows++;

    const evidence = {
      sourceRowNumber, productName: src.productName, setName: src.set, cardNumber: src.cardNumber,
      variance: src.variance, rarity: src.rarity, quantity: g.qty,
    };

    // invalid = positive-qty row with a missing identifier (stored per OL-0B).
    if (g.disposition === 'invalid_missing') {
      counts.invalid_rows++;
      stored.push({ ...evidence, matchStatus: 'invalid', cardId: null, matchRule: null,
        matchReason: g.reason, candidateCardIds: null });
      return;
    }

    // eligible → baseline classify, then combined resolution if not matched.
    const base = classifyEligible(src, ix);
    if (base.bucket === 'matched') {
      counts.matched_rows++;
      stored.push({ ...evidence, matchStatus: 'matched', cardId: base.cardId, matchRule: base.rule,
        matchReason: null, candidateCardIds: null });
      return;
    }

    // OL-2B cross-language guard (recovery-scoped): JP/CN/KR-marked rows are excluded
    // from alias/LZ recovery and keep their baseline disposition. Baseline matches were
    // already returned above, so the four baseline-matched JP rows are unaffected.
    const combined = languageMarked(src) ? { resolved: false } : combinedResolve(src, ix);
    if (combined.resolved) {
      counts.matched_rows++;
      stored.push({ ...evidence, matchStatus: 'matched', cardId: combined.cardId, matchRule: combined.matchRule,
        matchReason: null, candidateCardIds: null });
      return;
    }
    if (combined.conflict) conflicts++;

    if (base.bucket === 'ambiguous') {
      counts.ambiguous_rows++;
      const cids = (base.candidates || []).map(c => (typeof c === 'string' ? c : c.id)).slice(0, 6);
      stored.push({ ...evidence, matchStatus: 'ambiguous', cardId: null, matchRule: null,
        matchReason: base.reason, candidateCardIds: cids.length ? cids : null });
      return;
    }
    // unmatched
    counts.unmatched_rows++;
    stored.push({ ...evidence, matchStatus: 'unmatched', cardId: null, matchRule: null,
      matchReason: base.reason, candidateCardIds: null });
  });

  counts.stored_rows = stored.length;
  return { stored, counts, diagnostics: { conflicts } };
}
