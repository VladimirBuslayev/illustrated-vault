// src/services/imageService.js
// Image fallback resolution for cards whose exact TCGdex asset is absent or dead.
//
// OL-2C.1 — Image Resilience.
//   fetchFallbackImage is now a VERIFICATION function, not a URL lookup.
//   It accepts the full canonical card and returns a verdict record. An image
//   URL is returned ONLY when exact physical-printing identity is proven by the
//   Pokémon TCG API response itself.
//
//   Locked product rule: never render an image that is not a verified exact
//   physical printing of the card. When exactness cannot be proven, callers
//   render a neutral unavailable state.
//
//   Governing bias for every normalizer below: a FALSE MISMATCH (no image is
//   shown) is acceptable and fail-safe. A FALSE MATCH (a different printing is
//   shown) is not. Every judgment call resolves in that direction.
//
// buildLimitlessGuess is retained, exported, and RUNTIME-DEAD as of OL-2C.1.
//   Its URL hardcodes an English printing (_R_EN) and the app has no proven
//   language-identity contract, so it can never satisfy the exact-printing
//   rule. It is not called from anywhere. Any labeled proxy-image policy is
//   deferred to CAT-0 or a later explicit image-policy slice.
//
// Do NOT import normalizers from src/utils/keys.js. That module is the
// ownership containment seam (OWN-0B) and must stay unchanged with a single
// consumer. The normalizers here are private to image verification.

import { lsGet, lsSet } from '../utils/cache.js';

const PTCGIO_BASE = 'https://api.pokemontcg.io/v2';

// Cache prefix. Bumped from pb_fallback_img_ because the record shape and the
// trust semantics both changed: records now carry a schema version, a
// verification fingerprint, a status and a timestamp. A legacy {small,large}
// entry carries no verification evidence and must never be promoted to
// "verified exact printing".
const IMG_CACHE_PREFIX = 'pb_img2_';
const IMG_CACHE_VERSION = 1;

// Status-dependent TTLs.
//   verified — a verified exact-printing URL is stable; re-verifying wastes network.
//   absent/mismatch — coverage improves and metadata gets corrected; re-check soon.
//   error — never cached at all (see classifyNonOk / the cooldown below).
// NOTE: src/constants/config.js was not part of the OL-2C.1 baseline inspection,
// so CACHE_TTL's value is unverified and these are defined independently here.
// If CACHE_TTL expresses a house convention these should follow, align them here.
const IMG_TTL_VERIFIED = 30 * 24 * 60 * 60 * 1000; // 30 days
const IMG_TTL_NEGATIVE = 72 * 60 * 60 * 1000;      // 72 hours

// Memory-only cooldown after an `error` verdict. `error` is never persisted, so
// without this a persistent 429/5xx would be re-requested on every mount and
// scroll and amplify the very condition causing it. This is NOT caching: it
// lives in module memory only, is never written to localStorage, and is gone on
// reload. Locked by amendment — not optional.
const IMG_ERROR_COOLDOWN_MS = 60 * 1000; // 60 seconds

// ── Private normalizers ──────────────────────────────────────────────────────
// Conservative by design. See the governing bias note at the top of this file.

// Apostrophe variants are the ONLY character class removed from names. The
// sources disagree on which glyph they use and no two distinct cards differ
// solely by apostrophe.
const APOSTROPHES = /[\u0027\u2019\u02BC\u2032]/g;

// Latin combining diacritics ONLY (U+0300–U+036F).
// Deliberately EXCLUDES U+3099 / U+309A, the combining kana voiced/semi-voiced
// sound marks, so が and か remain distinct. A blanket \p{M} strip would
// collapse them and could produce a cross-printing false match.
const LATIN_COMBINING = /[\u0300-\u036F]/g;

// Explicit semantic symbol mappings, applied to the RAW string before any
// folding so the distinction can never be lost downstream.
// Nidoran♀ vs Nidoran♂ are different cards.
function applySymbolMap(s) {
  return s
    .replace(/\u2640/g, ' female ')  // ♀
    .replace(/\u2642/g, ' male ');   // ♂
}

function normalizeName(value) {
  if (typeof value !== 'string') return null;
  let s = value.trim();
  if (!s) return null;
  s = applySymbolMap(s);                        // 1. semantic symbols first
  s = s.normalize('NFKC');                      // 2. compatibility folding
  s = s.normalize('NFD').replace(LATIN_COMBINING, '').normalize('NFC'); // 3. Latin diacritics only
  s = s.toLowerCase();                          // 4. locale-independent
  s = s.replace(APOSTROPHES, '');               // 5. only removal
  s = s.replace(/\s+/g, ' ').trim();            // 6. whitespace
  return s || null;
}

// Preserves meaningful prefixes (SWSH, TG, GG, XY-P) and suffixes (letters,
// /total denominators). Leading zeros are stripped ONLY within the first digit
// run — the clearly defined numeric portion.
function normalizeNumber(value) {
  let s;
  if (typeof value === 'number' && Number.isFinite(value)) s = String(value);
  else if (typeof value === 'string') s = value;
  else return null;
  s = s.trim();
  if (!s) return null;
  s = s.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  if (!s) return null;
  const m = s.match(/^([^0-9]*)([0-9]+)(.*)$/);
  if (!m) return s;                                 // no digits at all: 'promo', '?'
  const prefix = m[1];
  const digits = m[2].replace(/^0+(?=[0-9])/, '');  // a lone '0' stays '0'
  const rest = m[3];                                // never zero-stripped
  return `${prefix}${digits}${rest}`;
}

// Diagnostics-only set-id normalizer (OL-2C.1 amendment 3).
// Catalog set ids and pokemontcg.io set ids are NOT proven directly comparable,
// so set_match is supporting evidence recorded for CAT-0 and NEVER determines
// whether a fallback may render. Deliberately minimal: require string, NFKC,
// trim, lowercase, collapse whitespace. No punctuation stripping, no alias
// mapping, no zero handling, no ownership normalizers.
function normalizeSetIdForDiagnostics(value) {
  if (typeof value !== 'string') return null;
  const s = value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
  return s || null;
}

// ── Verification fingerprint ─────────────────────────────────────────────────
// Verification depends on exactly three values: card.id, the normalized local
// number, and the normalized name. A verdict is reusable only for a card whose
// all three still match; keying reuse by card.id alone would silently reuse a
// verdict computed against different evidence after a catalog correction.
//
// Serialization is JSON.stringify over an array — deterministic and
// collision-safe. It does NOT assume any separator character is impossible.
//
// Returns null when local metadata is insufficient to verify anything; callers
// must treat a null fingerprint as an immediate, request-free mismatch.
function fingerprintCard(card) {
  if (!card || typeof card.id !== 'string' || !card.id) return null;
  const num = normalizeNumber(card.localId);
  const name = normalizeName(card.name);
  if (num === null || name === null) return null;
  return JSON.stringify([card.id, num, name]);
}

// ── Module-local runtime state (never persisted) ─────────────────────────────
// All three maps are keyed by the SAME fingerprint function.
const inFlight = new Map();         // fingerprint -> Promise<verdict>
const errorCooldown = new Map();    // fingerprint -> timestamp of last error verdict
const loggedMismatches = new Set(); // fingerprint (once-per-session diagnostics)

const EMPTY_CHECKS = { id_match: null, number_match: null, name_match: null, set_match: null };

// Once-per-fingerprint-per-session mismatch diagnostic. Called from BOTH the
// cache-hit path and the network path, so a cached mismatch still reports
// exactly once without refetching and without duplicate warnings.
function logMismatchOnce(cardId, v) {
  if (!v || v.status !== 'mismatch') return;
  const fp = v.fp;
  if (fp === null || fp === undefined) return;
  if (loggedMismatches.has(fp)) return;
  loggedMismatches.add(fp);
  // Diagnostics are console-only; user-facing copy stays generic.
  console.warn('[OL-2C.1] fallback verification mismatch', {
    cardId, fp, reason: v.reason, checks: v.checks, observed: v.observed,
  });
}

function verdict(status, reason, extra) {
  return Object.assign({
    status,
    reason,
    fp: null,
    small: null,
    large: null,
    checks: EMPTY_CHECKS,
    observed: null,
  }, extra || {});
}

// HTTP outcome classification (OL-2C.1 §3.2).
//   404/410            -> absent, negative-cache eligible (definitive)
//   429, 5xx, 401/403,
//   any other non-OK   -> error, NEVER cached
// This is entirely separate from <img onError>, which is retried once WITHOUT
// any attempt to classify its cause.
function classifyNonOk(status) {
  if (status === 404 || status === 410) return 'absent';
  return 'error';
}

function readCache(cacheKey, fp) {
  const raw = lsGet(cacheKey);
  if (!raw || typeof raw !== 'object') return null;
  if (raw.v !== IMG_CACHE_VERSION) return null;            // 1. schema version
  if (raw.fp !== fp) return null;                          // 2. fingerprint, BEFORE ttl
  const ttl = raw.status === 'verified' ? IMG_TTL_VERIFIED : IMG_TTL_NEGATIVE;
  if (!raw.ts || Date.now() - raw.ts >= ttl) return null;  // 3. ttl
  return raw;
}

function writeCache(cacheKey, fp, v) {
  if (v.status === 'error') return; // `error` is never persisted
  lsSet(cacheKey, {
    v: IMG_CACHE_VERSION,
    fp,
    status: v.status,
    ts: Date.now(),
    small: v.small,
    large: v.large,
    checks: v.checks,
    observed: v.observed,
    reason: v.reason,
  });
}

async function performFetch(card, fp) {
  let res;
  try {
    res = await fetch(`${PTCGIO_BASE}/cards/${encodeURIComponent(card.id)}`);
  } catch {
    return verdict('error', 'fallback_error', { fp }); // transport/network/timeout
  }

  if (!res.ok) {
    const status = classifyNonOk(res.status);
    return verdict(status, status === 'absent' ? 'fallback_absent' : 'fallback_error', { fp });
  }

  let json;
  try {
    json = await res.json();
  } catch {
    return verdict('error', 'fallback_error', { fp }); // JSON parse failure
  }
  if (!json || typeof json !== 'object' || !json.data || typeof json.data !== 'object') {
    return verdict('error', 'fallback_error', { fp });
  }

  const d = json.data;
  const imgs = d.images;
  const small = imgs && typeof imgs.small === 'string' ? imgs.small : null;
  const large = imgs && typeof imgs.large === 'string' ? imgs.large : null;

  const observed = {
    id: typeof d.id === 'string' ? d.id : null,
    name: typeof d.name === 'string' ? d.name : null,
    number: (typeof d.number === 'string' || typeof d.number === 'number') ? String(d.number) : null,
    setId: d.set && typeof d.set.id === 'string' ? d.set.id : null,
    setName: d.set && typeof d.set.name === 'string' ? d.set.name : null,
  };

  // set_match is SUPPORTING EVIDENCE ONLY. Recorded for CAT-0; it never
  // participates in the render decision below.
  const localSet = normalizeSetIdForDiagnostics(card.set && card.set.id);
  const remoteSet = normalizeSetIdForDiagnostics(observed.setId);
  const set_match = (localSet === null || remoteSet === null) ? null : localSet === remoteSet;

  const remoteNum = normalizeNumber(observed.number);
  const remoteName = normalizeName(observed.name);
  const localNum = normalizeNumber(card.localId);
  const localName = normalizeName(card.name);

  const id_match = observed.id !== null ? observed.id === card.id : null;
  const number_match = (remoteNum === null || localNum === null) ? null : remoteNum === localNum;
  const name_match = (remoteName === null || localName === null) ? null : remoteName === localName;

  const checks = { id_match, number_match, name_match, set_match };

  if (!small && !large) {
    return verdict('absent', 'fallback_absent', { fp, checks, observed });
  }
  if (id_match === null || number_match === null || name_match === null) {
    return verdict('mismatch', 'insufficient_remote_metadata', { fp, checks, observed });
  }
  if (!id_match || !number_match || !name_match) {
    return verdict('mismatch', 'verification_mismatch', { fp, checks, observed });
  }

  // Verified exact printing. This is the ONLY branch that returns image URLs.
  return verdict('verified', 'fallback_verified_ok', { fp, small, large, checks, observed });
}

/**
 * Resolve a verified exact-printing fallback image for a canonical card.
 *
 * @param {object} card Full canonical card (id, name, localId, set:{id,name}).
 * @returns {Promise<object>} verdict record. small/large are populated ONLY
 *   when status === 'verified'. On 'mismatch' the URLs are deliberately
 *   withheld so no caller can render them by accident.
 */
async function fetchFallbackImage(card) {
  const fp = fingerprintCard(card);

  // Insufficient LOCAL metadata: verification is impossible, so no request is
  // issued at all.
  if (fp === null) {
    return verdict('mismatch', 'insufficient_local_metadata', { fp: null });
  }

  const cacheKey = `${IMG_CACHE_PREFIX}${card.id}`;

  const cached = readCache(cacheKey, fp);
  if (cached) {
    const cv = verdict(cached.status, cached.reason || 'fallback_absent', {
      fp,
      small: cached.small || null,
      large: cached.large || null,
      checks: cached.checks || EMPTY_CHECKS,
      observed: cached.observed || null,
    });
    logMismatchOnce(card.id, cv); // cached mismatches still report once per session
    return cv;
  }

  // Memory-only error cooldown (never persisted).
  const cooledAt = errorCooldown.get(fp);
  if (cooledAt !== undefined) {
    if (Date.now() - cooledAt < IMG_ERROR_COOLDOWN_MS) {
      return verdict('error', 'fallback_error', { fp });
    }
    errorCooldown.delete(fp);
  }

  // Concurrent request deduplication, keyed by fingerprint.
  const existing = inFlight.get(fp);
  if (existing) return existing;

  const p = performFetch(card, fp)
    .then(v => {
      if (v.status === 'error') {
        errorCooldown.set(fp, Date.now());
        console.warn('[OL-2C.1] fallback lookup error', { cardId: card.id, fp });
      } else {
        writeCache(cacheKey, fp, v);
      }
      logMismatchOnce(card.id, v);
      return v;
    })
    .finally(() => {
      inFlight.delete(fp);
    });

  inFlight.set(fp, p);
  return p;
}

// ── RUNTIME-DEAD as of OL-2C.1 ───────────────────────────────────────────────
// Retained and exported for a narrow diff only. NOT called from anywhere.
// The constructed URL hardcodes an English printing (_R_EN) and is a guess
// rather than a lookup, so it cannot satisfy the exact-printing rule. Any
// labeled proxy-image policy is deferred to CAT-0 or a later image-policy slice.
function buildLimitlessGuess(card) {
  const setId = card && card.set && card.set.id;
  const num   = card && card.localId;
  if (!setId || !num) return null;
  const code = String(setId).toUpperCase();
  const base = `https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/${code}/${code}_${num}_R_EN`;
  return { small: `${base}_SM.png`, large: `${base}_LG.png` };
}

export { fetchFallbackImage, buildLimitlessGuess };
// Exported for the OL-2C.1 Preview validation harness only.
export { normalizeName, normalizeNumber, normalizeSetIdForDiagnostics, fingerprintCard };
