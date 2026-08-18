#!/usr/bin/env node
// scripts/cat3a-image-probe.mjs
// ─────────────────────────────────────────────────────────────────────────────
// CAT-3A — Image Coverage & Recoverability Audit — external source probe.
//
// Specification: docs/CAT-3A_IMAGE_COVERAGE_AND_RECOVERABILITY_AUDIT.md
//
// ⚠ STATUS: PREPARED — NOT EXECUTED. No run of this script has produced audit
//   evidence yet.
//
// WHAT THIS IS
//
//   A READ-ONLY classifier. It issues HTTP GETs against the two sources this
//   product already approves — TCGdex (primary catalog source) and the Pokémon
//   TCG API (the runtime's exact-printing fallback verifier) — and assigns each
//   missing-image catalog row exactly one value in each measurement dimension.
//
//   It touches NO database. It holds NO credential. It writes NOTHING except
//   its own evidence files under the output directory it is given.
//
// WHAT IT MUST NEVER BECOME
//
//   * a repair tool — it proposes no value for any catalog column;
//   * a correspondence builder — it never translates a provider set id, never
//     searches by name/number to find a differently-namespaced card, and never
//     emits a mapping between provider identities. The catalog id is used
//     VERBATIM against both sources, exactly as src/services/imageService.js
//     does at runtime. That is the whole point: this measures the contract
//     production actually has, not a contract we could imagine having;
//   * an image proxy — no cross-printing or cross-language substitution is
//     computed, recorded or suggested anywhere in this file.
//
// WHY NORMALIZERS ARE IMPORTED AND NEVER REIMPLEMENTED
//
//   Verification uses normalizeName / normalizeNumber /
//   normalizeSetIdForDiagnostics / fingerprintCard imported directly from
//   src/services/imageService.js, and the asset URL is built with imgSmall
//   imported from src/utils/imageUrl.js.
//
//   A probe that normalized differently would measure a contract nothing
//   enforces, and would report recoverability for rows production cannot
//   actually resolve. Those modules are import-safe in Node: their localStorage
//   access is inside call-time try/catch and no cached path is invoked here.
//
// THE GOVERNING CLASSIFICATION BIAS
//
//   404/410 is DEFINITIVE and is never retried.
//   429/5xx/401/403/transport is INDETERMINATE and is never coerced to absent.
//
//   Recording "absent" for a row the source merely failed to serve would
//   manufacture an unrecoverability rate. Every judgment call resolves toward
//   indeterminate, and indeterminate rows are what the G-10 conclusion gate
//   and the worst-case sensitivity test exist to contain.
//
// USAGE
//
//   node scripts/cat3a-image-probe.mjs --input <dir> --out <dir> [--phase p]
//
//   --input   directory holding the SQL exports:
//               image_gaps_input.csv         (Q-A8a) — required
//               alias_pairs_input.csv        (Q-A6b) — all 192 approved pairs
//               p3_control_pool_input.csv    (Q-A8b) — control candidates
//               owned_missing_ids_input.csv  (Q-A7c) — OPERATOR-ONLY, see below
//   --out     directory for evidence output (created if absent)
//   --phase   all (default) | p1 | p2 | p30 | p3 | p4
//
//   No environment variable is read. No API key is sent — see KEYLESS below.
//
// THE OPERATOR-ONLY OWNED INPUT
//
//   owned_missing_ids_input.csv is a bare list of catalog card ids describing
//   the ACTIVE-OWNED missing-image population. It carries no user id, no batch
//   id and no quantity, but it is still a projection of what the collector base
//   owns, so it is an INPUT and never an artifact.
//
//   This file reads it for exactly one purpose: computing AGGREGATE
//   active-owned outcome counts, which the G-10 active-owned gate and the
//   decision framework's weighting both require and which no aggregate SQL
//   could supply. The owned id set is deliberately NOT threaded into
//   buildEvidenceRecord, so there is no code path by which an owned id can
//   reach image_gaps.csv — the safety harness asserts that structurally.
//
//   docs/cat-3a-evidence/inputs/ is gitignored so the raw list cannot be
//   committed by accident.
//
// KEYLESS BY DESIGN
//
//   src/services/imageService.js sends no X-Api-Key. Sending one here would
//   measure a contract production does not have and would report a
//   recoverability rate production cannot achieve. If the keyless run cannot
//   clear the indeterminate threshold, that IS the finding.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  normalizeName,
  normalizeNumber,
  normalizeSetIdForDiagnostics,
  fingerprintCard,
} from '../src/services/imageService.js';
import { imgSmall } from '../src/utils/imageUrl.js';

// ── Sources ──────────────────────────────────────────────────────────────────
const TCGDEX_BASE = 'https://api.tcgdex.net/v2/en';
const PTCGIO_BASE = 'https://api.pokemontcg.io/v2';

// ── Transport discipline ─────────────────────────────────────────────────────
// Concurrency 1 and a 250 ms floor mirror sync-cards.mjs BATCH_DELAY_MS. This
// is an audit, not a race: a probe that provokes rate limiting would generate
// the very indeterminate population it is trying to avoid.
const MIN_REQUEST_SPACING_MS = 250;
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [1000, 4000, 16000];
const MAX_RETRY_AFTER_MS = 30000;

// ── Population constants ─────────────────────────────────────────────────────
// The CAT-2D.2 deployed alias population. G-3 validates the Q-A6b export
// against this exactly. If it ever differs, the alias table has moved since
// CAT-2D.2 and the audit must be re-scoped rather than run against a
// population nobody approved.
export const EXPECTED_ALIAS_PAIRS = 192;

// P3-0 staging. The qualification pass establishes which candidate ids actually
// exist in pokemontcg.io; the gate then measures how RELIABLY those known-good
// ids resolve. Qualifying more than 20 leaves room for candidates that are
// legitimately absent from the fallback provider.
const P30_QUALIFY_CANDIDATES = 120;
const P30_CONTROL_COUNT = 20;

// ── Measurement vocabulary ───────────────────────────────────────────────────
export const T = {
  IMAGE_AVAILABLE: 'T1_TCGDEX_IMAGE_AVAILABLE',
  PRESENT_NO_IMAGE: 'T2_TCGDEX_ENTITY_PRESENT_IMAGE_ABSENT',
  ABSENT: 'T3_TCGDEX_ENTITY_ABSENT',
  INDETERMINATE: 'T4_TCGDEX_INDETERMINATE',
};

export const F = {
  NOT_REQUIRED: 'F0_FALLBACK_NOT_REQUIRED',
  INSUFFICIENT_METADATA: 'F1_PTCGIO_INSUFFICIENT_METADATA',
  NAMESPACE_UNREACHABLE: 'F2_PTCGIO_NAMESPACE_UNREACHABLE',
  EXACT_VERIFIED: 'F3_PTCGIO_EXACT_VERIFIED',
  VERIFIED_NO_IMAGE: 'F4_PTCGIO_EXACT_ENTITY_VERIFIED_IMAGE_UNAVAILABLE',
  VERIFICATION_FAILED: 'F5_PTCGIO_VERIFICATION_FAILED',
  EXACT_ID_ABSENT: 'F6_PTCGIO_EXACT_ID_ABSENT',
  INDETERMINATE: 'F7_PTCGIO_INDETERMINATE',
};

export const A = {
  NOT_APPLICABLE: 'A0_NOT_APPLICABLE',
  BOTH: 'A1_ALIAS_IMAGE_CANONICAL_IMAGE',
  ALIAS_ONLY: 'A2_ALIAS_IMAGE_CANONICAL_MISSING',
  CANONICAL_ONLY: 'A3_ALIAS_MISSING_CANONICAL_IMAGE',
  NEITHER: 'A4_ALIAS_MISSING_CANONICAL_MISSING',
};

export const ASSET = {
  LIVE: 'ASSET_LIVE',
  DEAD: 'ASSET_DEAD',
  INDETERMINATE: 'ASSET_INDETERMINATE',
  NOT_APPLICABLE: 'ASSET_NOT_APPLICABLE',
};

export const O = {
  INDETERMINATE: 'O0_INDETERMINATE',
  TCGDEX_DETERMINISTIC: 'O1_RECOVERABLE_TCGDEX_DETERMINISTIC',
  FALLBACK_ELIGIBLE: 'O2_CURRENT_RUNTIME_FALLBACK_ELIGIBLE',
  ALIAS_CANDIDATE: 'O3_RECOVERY_CANDIDATE_APPROVED_ALIAS',
  BLOCKED_METADATA: 'O4_BLOCKED_METADATA',
  NOT_RECOVERABLE: 'O5_NOT_RECOVERABLE_UNDER_CURRENT_CONTRACTS',
};

// ═════════════════════════════════════════════════════════════════════════════
// PURE CLASSIFIERS — no I/O, exported so the safety harness can assert them
// ═════════════════════════════════════════════════════════════════════════════

/**
 * HTTP outcome classification. Deliberately identical in spirit to
 * imageService.classifyNonOk (imageService.js:186-188): 404/410 is the only
 * definitive-absent class. Everything else is indeterminate and retryable.
 *
 * Do NOT widen the definitive branch. A 403 is an authorization state, a 429 is
 * a rate-limit state, a 5xx is a server state — none of them is evidence that a
 * card does not exist.
 */
export function classifyHttpStatus(status) {
  if (status === 404 || status === 410) return 'absent';
  if (status >= 200 && status < 300) return 'ok';
  return 'indeterminate';
}

/**
 * Encodability guard for a catalog id used as a URL path segment.
 *
 * Ordinary punctuation (`?`, `!`, `#`) encodes fine and IS probed normally — a
 * 404 on such an id is a genuine T3, not a probe defect. This guard exists only
 * for ids that cannot be expressed in a request at all: empty/whitespace ids and
 * lone surrogates, which make encodeURIComponent throw.
 */
export function encodeIdSegment(id) {
  if (typeof id !== 'string' || id.trim() === '') {
    return { ok: false, reason: 'empty_id' };
  }
  try {
    return { ok: true, value: encodeURIComponent(id) };
  } catch {
    return { ok: false, reason: 'unencodable_id' };
  }
}

/**
 * Dimension T from a resolved TCGdex observation.
 *
 * `setState` carries the P1 result for the row's set. The T2-escalation rule is
 * enforced here and is load-bearing: a brief that omits `image` proves nothing
 * unless the same payload projects `image` for at least one other member. Some
 * TCGdex responses simply do not carry the field, and treating that shape as
 * "no image exists" would fabricate a whole-set upstream absence.
 */
export function classifyTcgdexFromSet(row, setState) {
  if (!setState) return { t: T.INDETERMINATE, reason: 'set_not_probed' };
  if (setState.state === 'SET_ABSENT') {
    return { t: T.ABSENT, reason: 'set_namespace_absent' };
  }
  if (setState.state === 'SET_INDETERMINATE') {
    return { t: T.INDETERMINATE, reason: 'set_indeterminate' };
  }
  const brief = setState.briefById ? setState.briefById.get(row.id) : undefined;
  if (brief === undefined) return { t: null, reason: 'escalate_card_detail' };
  if (typeof brief.image === 'string' && brief.image.trim() !== '') {
    return { t: T.IMAGE_AVAILABLE, reason: 'brief_image_present', image: brief.image };
  }
  if (setState.briefsProjectImage) {
    return { t: T.PRESENT_NO_IMAGE, reason: 'brief_image_absent_field_projected' };
  }
  return { t: null, reason: 'escalate_card_detail' };
}

/** Dimension T from a resolved card-detail observation. */
export function classifyTcgdexFromCard(outcome) {
  if (outcome.kind === 'absent') return { t: T.ABSENT, reason: 'card_absent' };
  if (outcome.kind === 'indeterminate') {
    return { t: T.INDETERMINATE, reason: outcome.reason || 'card_indeterminate' };
  }
  const image = outcome.json && typeof outcome.json.image === 'string' ? outcome.json.image : null;
  if (image && image.trim() !== '') {
    return { t: T.IMAGE_AVAILABLE, reason: 'card_image_present', image };
  }
  return { t: T.PRESENT_NO_IMAGE, reason: 'card_image_absent' };
}

/**
 * The three verification checks, computed exactly as imageService.performFetch
 * does (imageService.js:253-266). `set_match` is recorded and NEVER
 * participates — OL-2C.1 fixed that boundary and this probe does not move it.
 */
export function computeChecks(row, data) {
  const observed = {
    id: typeof data.id === 'string' ? data.id : null,
    name: typeof data.name === 'string' ? data.name : null,
    number: (typeof data.number === 'string' || typeof data.number === 'number')
      ? String(data.number) : null,
    setId: data.set && typeof data.set.id === 'string' ? data.set.id : null,
  };

  const localSet = normalizeSetIdForDiagnostics(row.set_id);
  const remoteSet = normalizeSetIdForDiagnostics(observed.setId);
  const set_match = (localSet === null || remoteSet === null) ? null : localSet === remoteSet;

  const remoteNum = normalizeNumber(observed.number);
  const remoteName = normalizeName(observed.name);
  const localNum = normalizeNumber(row.local_id);
  const localName = normalizeName(row.name);

  return {
    observed,
    id_match: observed.id !== null ? observed.id === row.id : null,
    number_match: (remoteNum === null || localNum === null) ? null : remoteNum === localNum,
    name_match: (remoteName === null || localName === null) ? null : remoteName === localName,
    set_match,
  };
}

/**
 * Dimension F from a resolved pokemontcg.io observation.
 *
 * Precedence and the F5 boundary both matter. A 200 that fails verification is
 * NEITHER absent NOR indeterminate: the entity was served and it did not match
 * the printing. Folding that into F6 would understate what the source holds;
 * folding it into F7 would invite a pointless retry of a settled answer.
 */
export function classifyPtcgioFromCard(row, outcome) {
  if (outcome.kind === 'absent') {
    return { f: F.EXACT_ID_ABSENT, reason: 'ptcgio_404', checks: null };
  }
  if (outcome.kind === 'indeterminate') {
    return { f: F.INDETERMINATE, reason: outcome.reason || 'ptcgio_indeterminate', checks: null };
  }
  const data = outcome.json && outcome.json.data;
  if (!data || typeof data !== 'object') {
    return { f: F.INDETERMINATE, reason: 'ptcgio_unparseable_payload', checks: null };
  }

  const checks = computeChecks(row, data);
  const imgs = data.images;
  const small = imgs && typeof imgs.small === 'string' ? imgs.small : null;
  const large = imgs && typeof imgs.large === 'string' ? imgs.large : null;
  const hasImage = Boolean(small || large);

  const allTrue = checks.id_match === true
    && checks.number_match === true
    && checks.name_match === true;

  if (!hasImage) {
    return allTrue
      ? { f: F.VERIFIED_NO_IMAGE, reason: 'verified_no_images', checks }
      : { f: F.VERIFICATION_FAILED, reason: 'unverified_no_images', checks };
  }
  return allTrue
    ? { f: F.EXACT_VERIFIED, reason: 'verified_exact_printing', checks }
    : { f: F.VERIFICATION_FAILED, reason: 'verification_mismatch', checks };
}

/**
 * Derived dimension O. Precedence top-down, first match wins. The full T x F x A
 * cross-tabulation is emitted separately so nothing this precedence hides is
 * actually lost.
 */
export function deriveOutcome({ t, f, a, assetLiveness }) {
  if (t === T.INDETERMINATE) return O.INDETERMINATE;
  if (f === F.INDETERMINATE) return O.INDETERMINATE;
  if (a === A.ALIAS_ONLY && assetLiveness === ASSET.INDETERMINATE) return O.INDETERMINATE;
  if (t === T.IMAGE_AVAILABLE) return O.TCGDEX_DETERMINISTIC;
  if (f === F.EXACT_VERIFIED) return O.FALLBACK_ELIGIBLE;
  if (a === A.ALIAS_ONLY && assetLiveness === ASSET.LIVE) return O.ALIAS_CANDIDATE;
  if (f === F.INSUFFICIENT_METADATA) return O.BLOCKED_METADATA;
  return O.NOT_RECOVERABLE;
}

/**
 * Worst-case sensitivity assignment for the G-10 global conclusion gate.
 *
 * Each indeterminate row is promoted to the most actionable outcome that is
 * still PLAUSIBLE FOR THAT ROW. A row whose TCGdex state is already known to be
 * T2/T3 cannot plausibly become O1 — the primary source has already been
 * observed not to hold the image — so it is promoted only as far as O2.
 * Promoting it further would make the sensitivity test conservative to the point
 * of being useless.
 */
export function sensitivityOutcome({ t, f, a, assetLiveness, outcome }) {
  if (outcome !== O.INDETERMINATE) return outcome;
  if (t === T.INDETERMINATE) return O.TCGDEX_DETERMINISTIC;
  if (a === A.ALIAS_ONLY && assetLiveness === ASSET.INDETERMINATE) return O.ALIAS_CANDIDATE;
  if (f === F.INDETERMINATE) return O.FALLBACK_ELIGIBLE;
  return outcome;
}

/**
 * P4 asset-liveness classification.
 *
 * ASSET_LIVE requires ALL THREE of: a 2xx, an image/* content type, and a
 * NON-EMPTY body. Status and content type alone are not enough — a CDN can
 * answer 200 with the right content type and zero bytes, and calling that
 * "live" would put a recovery candidate into the decision framework whose asset
 * does not actually render. The body is consumed for exactly this check.
 */
export function classifyAssetResponse({ kind, contentType, byteLength, reason }) {
  if (kind === 'absent') return { liveness: ASSET.DEAD, reason: 'asset_404' };
  if (kind !== 'ok') return { liveness: ASSET.INDETERMINATE, reason: reason || 'asset_unresolved' };
  const ct = (contentType || '').toLowerCase();
  if (!ct.startsWith('image/')) {
    return { liveness: ASSET.INDETERMINATE, reason: `unexpected_content_type:${ct || 'none'}` };
  }
  if (!Number.isFinite(byteLength) || byteLength <= 0) {
    return { liveness: ASSET.INDETERMINATE, reason: 'empty_body' };
  }
  return { liveness: ASSET.LIVE, reason: `${ct}:${byteLength}b` };
}

/**
 * Deterministic stratified draw of `count` items across an ordered list.
 *
 * Used to pick P3-0 controls across the QUALIFIED era/set range. Taking the
 * first N unique sets in release order would concentrate controls in whichever
 * era happens to qualify first — usually the oldest — and would prove nothing
 * about the modern namespaces. Quantile positions spread the draw across the
 * whole range instead.
 *
 * Deterministic: same input, same output, so a re-run is comparable.
 */
export function stratifiedSample(items, count) {
  const n = items.length;
  if (n === 0 || count <= 0) return [];
  if (n <= count) return [...items];
  const picked = [];
  const used = new Set();
  for (let i = 0; i < count; i++) {
    let idx = Math.round((i * (n - 1)) / (count - 1));
    // Collisions are possible at small n; advance to the next free slot rather
    // than returning a short list.
    while (used.has(idx) && idx < n - 1) idx++;
    while (used.has(idx) && idx > 0) idx--;
    if (used.has(idx)) continue;
    used.add(idx);
    picked.push(items[idx]);
  }
  return picked;
}

/**
 * P3-0 gate evaluation. All three conditions must hold.
 *
 * Condition 3 is the one that matters most. Conditions 1 and 2 detect a SLOW or
 * flaky source, which retrying can survive. Condition 3 detects an UNSOUND
 * probe: a control is a card we independently know exists, so a control that
 * comes back "absent" or "verification failed" means real rows would be
 * misclassified, and no retry budget fixes that.
 */
export function evaluateReliabilityGate(controlResults) {
  const total = controlResults.length;
  const valid = controlResults.filter(
    r => r.f === F.EXACT_VERIFIED || r.f === F.VERIFIED_NO_IMAGE,
  ).length;
  const indeterminate = controlResults.filter(r => r.f === F.INDETERMINATE).length;
  const falseDefinitive = controlResults.filter(
    r => r.f === F.EXACT_ID_ABSENT || r.f === F.VERIFICATION_FAILED,
  ).length;
  const other = total - valid - indeterminate - falseDefinitive;

  const conditions = {
    c1_valid_at_least_19: valid >= 19,
    c2_indeterminate_at_most_1: indeterminate <= 1,
    c3_zero_false_definitive: falseDefinitive === 0,
  };
  return {
    total,
    valid,
    indeterminate,
    false_definitive: falseDefinitive,
    other,
    conditions,
    passed: conditions.c1_valid_at_least_19
      && conditions.c2_indeterminate_at_most_1
      && conditions.c3_zero_false_definitive,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// CSV — minimal RFC4180 reader/writer. No dependency is introduced for this.
// ═════════════════════════════════════════════════════════════════════════════

export function parseCsv(text) {
  const rows = [];
  let field = '';
  let record = [];
  let inQuotes = false;
  let i = 0;
  const s = text.replace(/^﻿/, '');
  while (i < s.length) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ',') { record.push(field); field = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { record.push(field); rows.push(record); record = []; field = ''; i++; continue; }
    field += ch; i++;
  }
  if (field !== '' || record.length > 0) { record.push(field); rows.push(record); }
  if (rows.length === 0) return [];
  const header = rows[0].map(h => h.trim());
  return rows.slice(1)
    .filter(r => r.length > 1 || (r.length === 1 && r[0] !== ''))
    .map(r => Object.fromEntries(header.map((h, idx) => [h, r[idx] ?? ''])));
}

export function toCsv(header, records) {
  const esc = (v) => {
    const str = v === null || v === undefined ? '' : String(v);
    return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const lines = [header.join(',')];
  for (const rec of records) lines.push(header.map(h => esc(rec[h])).join(','));
  return `${lines.join('\n')}\n`;
}

// ═════════════════════════════════════════════════════════════════════════════
// TRANSPORT
// ═════════════════════════════════════════════════════════════════════════════

let lastRequestAt = 0;
const stats = { requests: 0, retries: 0, byHost: {} };

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function pace() {
  const wait = MIN_REQUEST_SPACING_MS - (Date.now() - lastRequestAt);
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

function retryAfterMs(res) {
  const raw = res.headers && res.headers.get ? res.headers.get('retry-after') : null;
  if (!raw) return null;
  const secs = Number(raw);
  if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, MAX_RETRY_AFTER_MS);
  const when = Date.parse(raw);
  if (Number.isFinite(when)) return Math.min(Math.max(when - Date.now(), 0), MAX_RETRY_AFTER_MS);
  return null;
}

/**
 * One bounded GET.
 *
 * Returns { kind: 'ok' | 'absent' | 'indeterminate', status, json?, contentType?,
 * byteLength?, reason? }.
 *
 * `mode` selects what the body is used for:
 *   'json'  — parse it (TCGdex / pokemontcg.io)
 *   'bytes' — consume it and report byteLength (P4 asset liveness)
 *
 * 404/410 returns immediately and is NEVER retried — it is a settled answer and
 * retrying it would only slow the run. Everything else consumes the retry budget
 * and then falls through to indeterminate. There is no branch anywhere in this
 * function that converts a retry exhaustion into 'absent'.
 */
async function httpGet(url, { mode = 'json' } = {}) {
  const host = (() => { try { return new URL(url).host; } catch { return 'invalid'; } })();
  stats.byHost[host] = (stats.byHost[host] || 0) + 1;

  let lastStatus = null;
  let lastReason = 'transport_error';

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      stats.retries++;
      await sleep(BACKOFF_MS[attempt - 1] + Math.floor(Math.random() * 250));
    }
    await pace();
    stats.requests++;

    let res;
    try {
      res = await fetch(url, { headers: { accept: 'application/json' } });
    } catch (err) {
      lastReason = `transport:${err && err.message ? err.message.slice(0, 60) : 'unknown'}`;
      continue;
    }

    lastStatus = res.status;
    const kind = classifyHttpStatus(res.status);

    if (kind === 'absent') {
      return { kind: 'absent', status: res.status };
    }
    if (kind === 'ok') {
      const contentType = res.headers && res.headers.get ? res.headers.get('content-type') : null;
      if (mode === 'bytes') {
        // The body is consumed, not assumed: a 200 with the right content type
        // and zero bytes must not be reported as a live asset.
        try {
          const buf = await res.arrayBuffer();
          return { kind: 'ok', status: res.status, contentType, byteLength: buf.byteLength };
        } catch {
          lastReason = 'body_read_failure';
          continue;
        }
      }
      try {
        return { kind: 'ok', status: res.status, contentType, json: await res.json() };
      } catch {
        lastReason = 'json_parse_failure';
        continue;
      }
    }

    lastReason = `http_${res.status}`;
    const ra = retryAfterMs(res);
    if (ra !== null) await sleep(ra);
  }

  return { kind: 'indeterminate', status: lastStatus, reason: lastReason };
}

// ═════════════════════════════════════════════════════════════════════════════
// PHASES
// ═════════════════════════════════════════════════════════════════════════════

/** P1 — TCGdex set inventory and per-set image availability. */
async function runP1(catalogSetIds, log) {
  log('P1 — TCGdex set inventory');
  const inventory = await httpGet(`${TCGDEX_BASE}/sets`);
  if (inventory.kind !== 'ok' || !Array.isArray(inventory.json)) {
    throw new Error('P1: TCGdex set inventory unavailable — G-5 cannot be evaluated. Aborting.');
  }
  const upstreamIds = new Set(inventory.json.map(s => s && s.id).filter(Boolean));
  log(`P1 — upstream sets: ${upstreamIds.size}; catalog sets: ${catalogSetIds.length}`);

  const setStates = new Map();
  for (const setId of catalogSetIds) {
    if (!upstreamIds.has(setId)) {
      setStates.set(setId, {
        setId, state: 'SET_ABSENT', upstreamCards: 0, briefsWithImage: 0,
        briefsProjectImage: false, briefById: new Map(),
      });
      log(`  ${setId} — SET_ABSENT (not in upstream inventory)`);
      continue;
    }
    const enc = encodeIdSegment(setId);
    const detail = enc.ok
      ? await httpGet(`${TCGDEX_BASE}/sets/${enc.value}`)
      : { kind: 'indeterminate', status: null, reason: enc.reason };

    if (detail.kind === 'absent') {
      setStates.set(setId, {
        setId, state: 'SET_ABSENT', upstreamCards: 0, briefsWithImage: 0,
        briefsProjectImage: false, briefById: new Map(),
      });
      continue;
    }
    if (detail.kind === 'indeterminate') {
      setStates.set(setId, {
        setId, state: 'SET_INDETERMINATE', upstreamCards: null, briefsWithImage: null,
        briefsProjectImage: false, briefById: new Map(), reason: detail.reason,
      });
      log(`  ${setId} — SET_INDETERMINATE (${detail.reason})`);
      continue;
    }

    const briefs = Array.isArray(detail.json && detail.json.cards) ? detail.json.cards : [];
    const briefById = new Map();
    let withImage = 0;
    for (const b of briefs) {
      if (!b || typeof b.id !== 'string') continue;
      briefById.set(b.id, b);
      if (typeof b.image === 'string' && b.image.trim() !== '') withImage++;
    }
    setStates.set(setId, {
      setId,
      state: 'SET_PRESENT',
      upstreamName: detail.json && detail.json.name ? detail.json.name : null,
      upstreamCards: briefs.length,
      briefsWithImage: withImage,
      // The T2-escalation discriminator: only a payload that projects `image`
      // for at least one member may be used to conclude "no image" for another.
      briefsProjectImage: withImage > 0,
      briefById,
    });
  }

  const notInCatalog = [...upstreamIds].filter(id => !catalogSetIds.includes(id)).sort();
  return { setStates, upstreamIds, upstreamSetsNotInCatalog: notInCatalog };
}

/** P2 — assign exactly one T to every input row. */
async function runP2(rows, p1, log) {
  log(`P2 — TCGdex row-level classification over ${rows.length} rows`);
  const out = new Map();
  let escalations = 0;

  for (const row of rows) {
    const fromSet = classifyTcgdexFromSet(row, p1.setStates.get(row.set_id));
    if (fromSet.t !== null) {
      out.set(row.id, { t: fromSet.t, reason: fromSet.reason, tcgdex_image: fromSet.image || null });
      continue;
    }
    const enc = encodeIdSegment(row.id);
    if (!enc.ok) {
      out.set(row.id, { t: T.INDETERMINATE, reason: enc.reason, tcgdex_image: null });
      continue;
    }
    escalations++;
    const detail = await httpGet(`${TCGDEX_BASE}/cards/${enc.value}`);
    const verdict = classifyTcgdexFromCard(detail);
    out.set(row.id, { t: verdict.t, reason: verdict.reason, tcgdex_image: verdict.image || null });
  }

  log(`P2 — card-detail escalations: ${escalations}`);
  return out;
}

/** Fetch the pokemontcg.io set inventory (paged). Used for the F2 derivation. */
async function fetchPtcgioSetIds(log) {
  const ids = new Set();
  let page = 1;
  for (;;) {
    const res = await httpGet(`${PTCGIO_BASE}/sets?pageSize=250&page=${page}&select=id`);
    if (res.kind !== 'ok') {
      throw new Error(
        `P3: pokemontcg.io set inventory unavailable (${res.reason || res.status}). ` +
        'The F2 derivation depends on it, so the phase aborts rather than guessing.',
      );
    }
    const data = Array.isArray(res.json && res.json.data) ? res.json.data : [];
    for (const s of data) if (s && typeof s.id === 'string') ids.add(s.id);
    if (data.length < 250) break;
    page++;
  }
  log(`P3 — pokemontcg.io sets: ${ids.size}`);
  return ids;
}

/** One exact-ID pokemontcg.io probe, classified. */
async function probePtcgio(row) {
  const enc = encodeIdSegment(row.id);
  if (!enc.ok) return { f: F.INDETERMINATE, reason: enc.reason, checks: null, status: null };
  const res = await httpGet(`${PTCGIO_BASE}/cards/${enc.value}`);
  const verdict = classifyPtcgioFromCard(row, res);
  return { ...verdict, status: res.status ?? null };
}

/**
 * P3-0 — TWO-STAGE reliability gate. P3 is unreachable unless this passes.
 *
 * ⚠ WHY TWO STAGES (a review correction).
 *
 *   Stage 2 needs controls that are KNOWN-VALID pokemontcg.io ids. A catalog
 *   row with a populated image_url only proves TCGdex served an asset; it says
 *   nothing about whether the same id exists in pokemontcg.io. Nor does a
 *   verbatim-matching set namespace — the providers agree on some set ids while
 *   still disagreeing about individual card ids within them.
 *
 *   Probing such a card and getting a 404 is a legitimate provider-ID mismatch,
 *   NOT a reliability failure. Feeding it to the gate as a "known-valid
 *   control" would trip condition 3 (zero false definitives) and hard-stop an
 *   audit over a healthy source.
 *
 *   So stage 1 QUALIFIES: a candidate becomes a control only by actually
 *   resolving to F3/F4 — exact-id success against the verbatim id. Stage 2 then
 *   re-probes a stratified draw of qualified ids and measures how RELIABLY
 *   known-good ids resolve. That is the property the gate is supposed to test.
 *
 *   Preserved throughout: exact catalog ids only. No translation, no
 *   correspondence, no name/number lookup to find a different identity. A
 *   candidate that does not resolve under its own id is simply not qualified.
 */
async function runP30(controlPool, ptcgioSetIds, log) {
  const reachable = controlPool.filter(r => ptcgioSetIds.has(r.set_id));
  log(`P3-0 — pool ${controlPool.length}; verbatim-reachable ${reachable.length}`);

  // Stage 1 — qualification. Stratify the candidate draw across the
  // release-ordered pool so qualification itself samples every era.
  const candidates = stratifiedSample(reachable, P30_QUALIFY_CANDIDATES);
  log(`P3-0 stage 1 — qualifying ${candidates.length} candidates`);

  const qualified = [];
  const qualification = [];
  for (const r of candidates) {
    const v = await probePtcgio(r);
    const isQualified = v.f === F.EXACT_VERIFIED || v.f === F.VERIFIED_NO_IMAGE;
    qualification.push({ id: r.id, set_id: r.set_id, f: v.f, qualified: isQualified });
    if (isQualified) qualified.push(r);
    if (qualified.length >= P30_QUALIFY_CANDIDATES) break;
  }
  log(`P3-0 stage 1 — qualified ${qualified.length} of ${candidates.length}`);

  if (qualified.length < P30_CONTROL_COUNT) {
    return {
      qualification,
      qualified_count: qualified.length,
      selected: 0,
      distinct_sets: 0,
      results: [],
      gate: {
        passed: false,
        reason: `only ${qualified.length} qualified controls; ${P30_CONTROL_COUNT} required. `
          + 'Too few candidate ids exist in pokemontcg.io under their own catalog id to '
          + 'measure reliability at all — which is itself a finding about provider-ID overlap.',
      },
    };
  }

  // Stage 2 — the gate. Stratified draw across the QUALIFIED era/set range.
  const chosen = stratifiedSample(qualified, P30_CONTROL_COUNT);
  const results = [];
  for (const r of chosen) {
    const v = await probePtcgio(r);
    results.push({ id: r.id, set_id: r.set_id, f: v.f, reason: v.reason, status: v.status });
    log(`  control ${r.id} -> ${v.f}`);
  }

  const gate = evaluateReliabilityGate(results);
  gate.distinct_sets = new Set(results.map(r => r.set_id)).size;
  return {
    qualification,
    qualified_count: qualified.length,
    selected: chosen.length,
    distinct_sets: gate.distinct_sets,
    results,
    gate,
  };
}

/** P3 — assign exactly one F to every row that needs one. */
async function runP3(rows, tByRow, ptcgioSetIds, log) {
  log(`P3 — pokemontcg.io exact-ID classification`);
  const out = new Map();
  const f2Rows = [];

  for (const row of rows) {
    const t = tByRow.get(row.id);
    if (t && t.t === T.IMAGE_AVAILABLE) {
      out.set(row.id, { f: F.NOT_REQUIRED, reason: 'tcgdex_has_image', checks: null, status: null });
      continue;
    }
    // The runtime issues NO request when the fingerprint is null
    // (imageService.js:295-297). Neither does this probe — measuring a request
    // production never makes would overstate what the fallback can do.
    const fp = fingerprintCard({ id: row.id, name: row.name, localId: row.local_id });
    if (fp === null) {
      out.set(row.id, {
        f: F.INSUFFICIENT_METADATA, reason: 'null_fingerprint', checks: null, status: null,
      });
      continue;
    }
    if (!ptcgioSetIds.has(row.set_id)) {
      out.set(row.id, {
        f: F.NAMESPACE_UNREACHABLE, reason: 'set_id_absent_from_ptcgio_inventory',
        checks: null, status: null,
      });
      f2Rows.push(row);
      continue;
    }
    const v = await probePtcgio(row);
    out.set(row.id, v);
  }

  // ── F2 derivation validation ───────────────────────────────────────────────
  // F2 is DERIVED from the set inventory rather than probed, so the derivation
  // itself is tested. A single 200 here means the derivation is unsound, and
  // every F2 row is demoted to indeterminate rather than reported as a
  // structural unreachability we did not actually establish.
  const sample = [];
  if (f2Rows.length > 0) {
    const step = Math.max(1, Math.floor(f2Rows.length / 25));
    for (let i = 0; i < f2Rows.length && sample.length < 25; i += step) sample.push(f2Rows[i]);
  }
  let f2Unsound = false;
  const f2Validation = [];
  for (const row of sample) {
    const res = await httpGet(`${PTCGIO_BASE}/cards/${encodeIdSegment(row.id).value}`);
    f2Validation.push({ id: row.id, set_id: row.set_id, kind: res.kind, status: res.status ?? null });
    if (res.kind === 'ok') f2Unsound = true;
  }
  if (f2Unsound) {
    log('P3 — ⚠ F2 derivation UNSOUND: a namespace-unreachable id resolved. Demoting all F2 to indeterminate.');
    for (const row of f2Rows) {
      out.set(row.id, {
        f: F.INDETERMINATE, reason: 'f2_derivation_unsound', checks: null, status: null,
      });
    }
  }

  return { fByRow: out, f2Validation, f2Unsound, f2Count: f2Rows.length };
}

/**
 * P4 — approved-alias asset liveness on assets.tcgdex.net.
 *
 * Runs over the A2 subset ONLY. A1/A3/A4 pairs have nothing to test: A1 and A3
 * canonical rows already carry an image, and an A4 alias has no image to probe.
 */
async function runP4(a2Rows, log) {
  log(`P4 — alias asset liveness over ${a2Rows.length} A2 rows`);
  const out = new Map();
  for (const r of a2Rows) {
    // Built with the production URL builder, never hand-assembled: this is the
    // exact URL imgSmall would render for that stored value.
    const url = imgSmall({ image: r.alias_image_url });
    if (!url) {
      out.set(r.canonical_card_id, {
        liveness: ASSET.INDETERMINATE, reason: 'no_alias_image_url', status: null,
      });
      continue;
    }
    const res = await httpGet(url, { mode: 'bytes' });
    const verdict = classifyAssetResponse(res);
    out.set(r.canonical_card_id, { ...verdict, status: res.status ?? null });
  }
  return out;
}

// ═════════════════════════════════════════════════════════════════════════════
// ORCHESTRATION
// ═════════════════════════════════════════════════════════════════════════════

function parseArgs(argv) {
  const args = { phase: 'all', input: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--input') args.input = argv[++i];
    else if (argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--phase') args.phase = argv[++i];
  }
  return args;
}

function readInput(dir, file, required) {
  const path = join(dir, file);
  if (!existsSync(path)) {
    if (required) throw new Error(`Missing required input: ${path}`);
    return null;
  }
  return parseCsv(readFileSync(path, 'utf8'));
}


// ── Evidence record shape ────────────────────────────────────────────────────
// The per-row evidence header is a MODULE CONSTANT rather than an inline
// literal so the safety harness can assert what image_gaps.csv may contain.
// There is deliberately no owned/ownership column: the operator-only owned id
// list feeds aggregate tallies only and must never reach a committed artifact.
export const EVIDENCE_HEADER = [
  'id', 'set_id', 'set_name', 'local_id', 'name',
  'tcgdex_state', 'tcgdex_reason',
  'ptcgio_state', 'ptcgio_reason', 'ptcgio_status',
  'id_match', 'number_match', 'name_match', 'set_match',
  'alias_state', 'alias_asset_liveness',
  'outcome', 'sensitivity_outcome',
];

/**
 * Build one evidence record.
 *
 * ⚠ This function deliberately takes NO owned-population argument. Active-owned
 *   figures are computed as aggregates in main() by intersecting the outcome
 *   map with the operator-only id set — never by stamping an ownership flag
 *   onto a row. Because the owned set is not in scope here, there is no code
 *   path by which an owned id can be written into image_gaps.csv.
 */
export function buildEvidenceRecord({ row, t, fRec, a, assetLiveness, fallbackPhaseRan }) {
  const f = fRec ? fRec.f : (fallbackPhaseRan ? F.INDETERMINATE : '');
  const outcome = fallbackPhaseRan
    ? deriveOutcome({ t: t.t, f, a, assetLiveness })
    : '';
  const sensitivity = fallbackPhaseRan
    ? sensitivityOutcome({ t: t.t, f, a, assetLiveness, outcome })
    : '';
  const checks = fRec && fRec.checks ? fRec.checks : null;

  return {
    id: row.id,
    set_id: row.set_id,
    set_name: row.set_name,
    local_id: row.local_id,
    name: row.name,
    tcgdex_state: t.t,
    tcgdex_reason: t.reason,
    ptcgio_state: f,
    ptcgio_reason: fRec ? fRec.reason : '',
    ptcgio_status: fRec && fRec.status !== null && fRec.status !== undefined ? fRec.status : '',
    id_match: checks ? String(checks.id_match) : '',
    number_match: checks ? String(checks.number_match) : '',
    name_match: checks ? String(checks.name_match) : '',
    set_match: checks ? String(checks.set_match) : '',
    alias_state: a,
    alias_asset_liveness: assetLiveness,
    outcome,
    sensitivity_outcome: sensitivity,
  };
}

/**
 * Gate results.
 *
 * ⚠ G-8 and G-9 can NEVER be true when G-7 failed (a review correction).
 *
 *   The earlier version computed G-9 from row count and T assignment alone, so
 *   a run that hard-stopped at the reliability gate — with no F assigned to any
 *   row and no outcome derivable — still reported "completeness: true". That is
 *   exactly the kind of green light an audit must not emit.
 *
 *   Correct semantics:
 *     G-8  every row REQUIRING a fallback verdict carries exactly one F value.
 *     G-9  every row carries exactly one T, F, A and O, and totals reconcile.
 *     Both are 'not_evaluated' — never true — when the fallback phase did not
 *     run. 'not_evaluated' is a distinct third state, not a synonym for false:
 *     the gate was not tested, which is different from having been tested and
 *     failed.
 */
export function computeGates({ records, expectedRows, setStates, p30, fallbackPhaseRan, aliasPairs }) {
  const NOT_EVALUATED = 'not_evaluated';

  const allSetsResolved = [...setStates.values()].every(s => s.state !== 'SET_INDETERMINATE');
  const tValues = new Set(Object.values(T));
  const fValues = new Set(Object.values(F));
  const aValues = new Set(Object.values(A));
  const oValues = new Set(Object.values(O));

  const everyRowHasT = records.length === expectedRows
    && records.every(r => tValues.has(r.tcgdex_state));

  const g8 = !fallbackPhaseRan
    ? NOT_EVALUATED
    : records.every(r => fValues.has(r.ptcgio_state));

  const g9 = !fallbackPhaseRan
    ? NOT_EVALUATED
    : (records.length === expectedRows
      && everyRowHasT
      && records.every(r => fValues.has(r.ptcgio_state))
      && records.every(r => aValues.has(r.alias_state))
      && records.every(r => oValues.has(r.outcome)));

  return {
    'G-3_alias_pairs_complete': aliasPairs.length === EXPECTED_ALIAS_PAIRS,
    'G-3_alias_pairs_seen': aliasPairs.length,
    'G-5_all_sets_resolved': allSetsResolved,
    'G-6_all_rows_have_T': everyRowHasT,
    'G-7_ptcgio_reliability': p30 ? p30.gate.passed : NOT_EVALUATED,
    'G-8_fallback_assigned': g8,
    'G-9_completeness': g9,
  };
}

export async function main(argv) {
  const args = parseArgs(argv);
  if (!args.input || !args.out) {
    console.error('Usage: node scripts/cat3a-image-probe.mjs --input <dir> --out <dir> [--phase all|p1|p2|p30|p3|p4]');
    process.exitCode = 1;
    return;
  }
  const log = (m) => console.log(m);
  mkdirSync(args.out, { recursive: true });

  const startedAt = new Date().toISOString();
  const gaps = readInput(args.input, 'image_gaps_input.csv', true);
  const controlPool = readInput(args.input, 'p3_control_pool_input.csv', false) || [];
  const aliasPairs = readInput(args.input, 'alias_pairs_input.csv', false) || [];
  // OPERATOR-ONLY. Never written to any artifact; used for aggregates only.
  const ownedRows = readInput(args.input, 'owned_missing_ids_input.csv', false) || [];
  const ownedIds = new Set(ownedRows.map(r => r.card_id).filter(Boolean));

  log(`Input — missing-image rows: ${gaps.length}; control pool: ${controlPool.length}; `
    + `alias pairs: ${aliasPairs.length}; active-owned missing ids: ${ownedIds.size}`);

  if (aliasPairs.length !== EXPECTED_ALIAS_PAIRS) {
    log(`⚠ G-3 — alias pair input holds ${aliasPairs.length}, expected ${EXPECTED_ALIAS_PAIRS}. `
      + 'The A dimension will be reported as PARTIAL and O3 must be withheld.');
  }

  const catalogSetIds = [...new Set(gaps.map(r => r.set_id))].sort();

  // ── P1 / P2 ────────────────────────────────────────────────────────────────
  const p1 = await runP1(catalogSetIds, log);
  writeFileSync(
    join(args.out, 'upstream_image_availability.csv'),
    toCsv(
      ['set_id', 'state', 'upstream_name', 'upstream_cards', 'briefs_with_image', 'briefs_project_image', 'reason'],
      [...p1.setStates.values()].map(s => ({
        set_id: s.setId, state: s.state, upstream_name: s.upstreamName ?? '',
        upstream_cards: s.upstreamCards ?? '', briefs_with_image: s.briefsWithImage ?? '',
        briefs_project_image: s.briefsProjectImage, reason: s.reason ?? '',
      })),
    ),
  );

  const tByRow = await runP2(gaps, p1, log);

  // ── A dimension, from the FULL approved-pair export ────────────────────────
  // Every canonical survivor gets its real state. A2 and A4 are the two states
  // that can appear in the missing-image population; A1 and A3 canonical rows
  // carry an image and are therefore not in it. Assigning A0 to an A4 row — as
  // an A2-only input would force — would understate the dimension and make the
  // 192-row census artifact impossible.
  const aByRow = new Map();
  for (const p of aliasPairs) {
    if (!p.canonical_card_id || !p.alias_state) continue;
    aByRow.set(p.canonical_card_id, p.alias_state);
  }
  const a2Rows = aliasPairs.filter(p => p.alias_state === A.ALIAS_ONLY);
  const assetByRow = a2Rows.length > 0 ? await runP4(a2Rows, log) : new Map();

  // ── P3-0 / P3 ──────────────────────────────────────────────────────────────
  let ptcgioSetIds = null;
  let p30 = null;
  let p3 = null;
  let fallbackPhaseRan = false;

  if (args.phase === 'all' || args.phase === 'p30' || args.phase === 'p3') {
    ptcgioSetIds = await fetchPtcgioSetIds(log);
    p30 = await runP30(controlPool, ptcgioSetIds, log);
    log(`P3-0 gate: ${p30.gate.passed ? 'PASS' : 'FAIL'} ${JSON.stringify(p30.gate)}`);
    if (p30.gate.passed) {
      p3 = await runP3(gaps, tByRow, ptcgioSetIds, log);
      fallbackPhaseRan = true;
    } else {
      // G-7. The specification requires a hard stop here: without a sound
      // fallback measurement, every F- and O-dependent conclusion is withheld,
      // and G-8/G-9 report not_evaluated rather than a misleading pass.
      log('G-7 FAILED — P3 not run. F- and O-dependent conclusions are withheld.');
    }
  }

  // ── Assemble per-row evidence ──────────────────────────────────────────────
  const records = gaps.map(row => {
    const t = tByRow.get(row.id) || { t: T.INDETERMINATE, reason: 'not_classified' };
    const fRec = p3 ? p3.fByRow.get(row.id) : null;
    const a = aByRow.get(row.id) || A.NOT_APPLICABLE;
    const asset = assetByRow.get(row.id);
    const assetLiveness = a === A.ALIAS_ONLY
      ? (asset ? asset.liveness : ASSET.INDETERMINATE)
      : ASSET.NOT_APPLICABLE;
    return buildEvidenceRecord({ row, t, fRec, a, assetLiveness, fallbackPhaseRan });
  });

  writeFileSync(join(args.out, 'image_gaps.csv'), toCsv(EVIDENCE_HEADER, records));

  // ── Alias census — ALL approved pairs, not just A2 ─────────────────────────
  if (aliasPairs.length > 0) {
    writeFileSync(
      join(args.out, 'alias_pair_image_census.csv'),
      toCsv(
        ['alias_card_id', 'canonical_card_id', 'canonical_set_id', 'canonical_local_id',
          'canonical_name', 'alias_state', 'asset_liveness', 'asset_reason', 'asset_status'],
        aliasPairs.map(p => {
          const v = assetByRow.get(p.canonical_card_id);
          return {
            alias_card_id: p.alias_card_id,
            canonical_card_id: p.canonical_card_id,
            canonical_set_id: p.canonical_set_id,
            canonical_local_id: p.canonical_local_id,
            canonical_name: p.canonical_name,
            alias_state: p.alias_state,
            // Liveness is meaningful for A2 only; every other state records
            // NOT_APPLICABLE rather than an empty cell that could read as a
            // failed probe.
            asset_liveness: p.alias_state === A.ALIAS_ONLY
              ? (v ? v.liveness : ASSET.INDETERMINATE)
              : ASSET.NOT_APPLICABLE,
            asset_reason: v ? v.reason : '',
            asset_status: v && v.status !== null && v.status !== undefined ? v.status : '',
          };
        }),
      ),
    );
  }

  // ── Tallies ────────────────────────────────────────────────────────────────
  const tallyOver = (rows, key) => rows.reduce((acc, r) => {
    const k = r[key] || '(none)';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

  const o0 = records.filter(r => r.outcome === O.INDETERMINATE).length;
  const o0Rate = records.length > 0 ? (100 * o0) / records.length : 0;

  // ── Active-owned aggregates ────────────────────────────────────────────────
  // The ONLY use of the operator-only owned id set. It is intersected with the
  // in-memory record list to produce counts; no owned id is written anywhere.
  const ownedRecords = ownedIds.size > 0
    ? records.filter(r => ownedIds.has(r.id))
    : [];
  const ownedO0 = ownedRecords.filter(r => r.outcome === O.INDETERMINATE).length;
  const activeOwned = ownedIds.size === 0
    ? { available: false, note: 'owned_missing_ids_input.csv not supplied — the active-owned G-10 gate cannot be evaluated' }
    : {
      available: true,
      owned_missing_rows_supplied: ownedIds.size,
      owned_missing_rows_matched_in_evidence: ownedRecords.length,
      // A mismatch means the two exports were taken at different times and the
      // owned figures must not be trusted.
      reconciles: ownedRecords.length === ownedIds.size,
      outcome: tallyOver(ownedRecords, 'outcome'),
      sensitivity_outcome: tallyOver(ownedRecords, 'sensitivity_outcome'),
      o0_rows: ownedO0,
      'G-10_active_owned_o0_is_zero': fallbackPhaseRan ? ownedO0 === 0 : 'not_evaluated',
    };

  const gates = computeGates({
    records, expectedRows: gaps.length, setStates: p1.setStates, p30, fallbackPhaseRan, aliasPairs,
  });

  const manifest = {
    audit: 'CAT-3A — Image Coverage & Recoverability Audit',
    probe_version: 2,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    keyless: true,
    inputs: {
      missing_image_rows: gaps.length,
      control_pool_rows: controlPool.length,
      alias_pairs: aliasPairs.length,
      active_owned_missing_ids: ownedIds.size,
      distinct_catalog_sets: catalogSetIds.length,
    },
    p1: {
      upstream_sets: p1.upstreamIds.size,
      sets_absent_upstream: [...p1.setStates.values()].filter(s => s.state === 'SET_ABSENT').length,
      sets_indeterminate: [...p1.setStates.values()].filter(s => s.state === 'SET_INDETERMINATE').length,
      upstream_sets_not_in_catalog: p1.upstreamSetsNotInCatalog,
    },
    p3_0: p30
      ? {
        qualification_candidates: p30.qualification ? p30.qualification.length : 0,
        qualified_count: p30.qualified_count ?? 0,
        controls_selected: p30.selected,
        distinct_sets: p30.distinct_sets,
        gate: p30.gate,
      }
      : null,
    p3: p3
      ? {
        f2_derived_rows: p3.f2Count,
        f2_validation_sample: p3.f2Validation.length,
        f2_derivation_unsound: p3.f2Unsound,
      }
      : null,
    p4: {
      a2_rows_probed: a2Rows.length,
      liveness: [...assetByRow.values()].reduce((acc, v) => {
        acc[v.liveness] = (acc[v.liveness] || 0) + 1;
        return acc;
      }, {}),
    },
    fallback_phase_ran: fallbackPhaseRan,
    tallies: {
      tcgdex_state: tallyOver(records, 'tcgdex_state'),
      ptcgio_state: tallyOver(records, 'ptcgio_state'),
      alias_state: tallyOver(records, 'alias_state'),
      outcome: tallyOver(records, 'outcome'),
      sensitivity_outcome: tallyOver(records, 'sensitivity_outcome'),
    },
    active_owned: activeOwned,
    gates: {
      ...gates,
      // G-10 is NOT decided here. The raw rate, the sensitivity tally and the
      // active-owned figures are its inputs; whether the global conclusion may
      // proceed is a review judgement recorded in the specification document,
      // not a boolean this script sets.
      'G-10_inputs': {
        o0_rows: o0,
        o0_rate_pct: Number(o0Rate.toFixed(4)),
        o0_below_1pct: o0Rate < 1,
        active_owned_o0_rows: activeOwned.available ? ownedO0 : null,
        note: 'A global rate below 1% is NOT sufficient on its own. The worst-case '
          + 'sensitivity tally must show the selected decision path is unchanged, and the '
          + 'per-set and active-owned scopes require O0 = 0 with no tolerance. See spec §6.1/§6.2.',
      },
    },
    request_stats: stats,
  };

  writeFileSync(join(args.out, 'probe_manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  log(`\nWrote evidence to ${args.out}`);
  log(JSON.stringify({ tallies: manifest.tallies, gates: manifest.gates }, null, 2));
}

// Executed only when invoked directly, so the safety harness can import the
// pure classifiers without triggering a network run.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(err => {
    console.error(err && err.stack ? err.stack : err);
    process.exitCode = 1;
  });
}
