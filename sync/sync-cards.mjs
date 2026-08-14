#!/usr/bin/env node
// Syncs the TCGdex card catalog into Supabase's `cards` table, resolving
// each card's illustrator string against `artists.aliases` to set artist_id.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node sync-cards.mjs
//   SYNC_MODE=incremental node sync-cards.mjs                   (default)
//   SYNC_MODE=temporal    node sync-cards.mjs                   (all sets, temporal only)
//   SYNC_MODE=temporal SYNC_SET_ID=swsh3 node sync-cards.mjs    (one set, temporal only)
//
// Production invocation is .github/workflows/sync-cards.yml, which runs
// `npm run sync` from sync/ (sync/package.json → "sync": "node sync-cards.mjs"):
//   - automatically every Monday at 06:00 UTC, always incremental and unscoped;
//   - manually via workflow_dispatch, which selects the mode and the optional
//     single-set scope.
// "Quiesced" therefore means: no active workflow run, and operating outside the
// Monday 06:00 UTC window (or deliberately controlling that scheduled run).
//
// ─────────────────────────────────────────────────────────────────────────────
// CAT-1B — Temporal metadata (series / release_date) ownership
// ─────────────────────────────────────────────────────────────────────────────
//
// Root cause (CAT-0 F-13): mapCardToRow read `series` and `release_date` from
// `card.set`, which TCGdex types as SetBrief and which carries neither field.
// Both resolved to undefined on every card, producing 23,780/23,780 nulls.
// `syncSet` already fetches the full Set object carrying both values and
// previously discarded everything except `.cards`.
//
// G1 — the card-upsert path cannot express temporal columns.
//   `mapCardToRow` no longer emits `series` or `release_date`. Because
//   `upsertRows` issues INSERT … ON CONFLICT (id) DO UPDATE SET <payload
//   columns>, and neither column appears in that payload, the routine
//   card-write path is *structurally incapable* of writing or nulling them.
//   Not conditionally safe — unable to express the operation.
//
//   DO NOT reintroduce either key here. Doing so re-opens the non-null → NULL
//   regression that G1 exists to make unreachable.
//
// G2 — `updateSetTemporal(setDetail)` is the SOLE writer of either column.
//   It writes at most two columns, scoped by `set_id`, built only from
//   non-null upstream values, and performs no write at all when both are
//   absent. It never writes `last_synced_at` (the sync-recency signal and
//   CAT-0 audit evidence) nor any other column.
//
//   DO NOT add a second write path for these columns. The "only writer"
//   property is a statically asserted invariant, not a convention.
//
// Durability policy (explicit asymmetry, NOT global monotonicity):
//   - temporal values MAY be populated;
//   - temporal values MAY be corrected by a later non-null upstream value;
//   - an ABSENT upstream value may NOT erase a known non-null stored value.
//   CAT-1 prefers stale known temporal metadata over silent non-null → NULL
//   regression. Upstream-retraction policy is deferred pending real evidence.
//
//   Outside the guarantee, documented rather than defended in code: direct SQL
//   writes; a future SYNC_MODE=full run after G1 is reverted; any new write
//   path added without reading this header. See DECISION_LOG.md.
//
// Mode behavior:
//   incremental (default) — skipped sets receive NO temporal write, so
//     restored values are never disturbed. Non-skipped sets receive exactly
//     one temporal update, AFTER `upsertRows` succeeds. Post-upsert placement
//     is a correctness requirement, not an ordering preference: for a NEW set
//     no rows exist when syncSet begins, so an earlier UPDATE … WHERE set_id
//     would match zero rows and silently accomplish nothing.
//   temporal — whole-catalog restoration / explicit reconciliation. Per set:
//     reuse the existing Set-detail fetch, call updateSetTemporal, perform no
//     per-card fetch and no full-row upsert.
//   full — PROHIBITED for CAT-1. A full run rewrites illustrator, artist_id,
//     pricing, rarity, image_url, set_name and last_synced_at across the
//     catalog, and would repair the 499 stale artist FKs (F-19) as an
//     unscoped side effect. Do not use it during or around a CAT-1 window.
//
// ─────────────────────────────────────────────────────────────────────────────
// CAT-2B1 — catalog identity collision guard
// ─────────────────────────────────────────────────────────────────────────────
//
// Upstream periodically re-namespaces a subset out of its parent set, changing a
// physical printing's canonical card ID (observed 2026-08-13:
// swsh{9,10,11,12}.5tg -> swsh{9,10,11,12}tg). This file has no delete pass and
// no rename handling, so such a restructure would ADD the renamed rows alongside
// the old ones — two canonical IDs for one physical printing.
//
// That is invisible to CAT-0's (id) and (set_id, local_id) invariants but fatal
// to the snapshot importer, whose Tier-1 key is
// (normName(name), normSet(set_name), normNum(local_id)). Two rows sharing it
// turn a collector's MATCHED row into AMBIGUOUS at their next import, silently
// removing a card they own.
//
// G3 — no card-writing set is upserted until its rows are validated.
//   `assertNoIdentityCollisions` runs immediately before `upsertRows` in
//   `syncSet`, in straight-line code with no intervening try/catch. It throws, so
//   `upsertRows` is structurally unreachable for a colliding set. Nothing is
//   partially written: the check covers the whole set's row collection at once.
//
// G4 — a collision fails closed for its own set, and fails the run.
//   Scope of the failure is exactly one set: zero rows are written for it, and
//   every other set is still processed. A single renamed set must not stall
//   unrelated catalog coverage, and refusing the rest of the run would hide how
//   many sets are affected behind whichever one happened to be attempted first.
//
//   The failure must not be lost either. `main()`'s per-set catch already
//   swallows ordinary fetch failures; a CatalogIdentityCollisionError is instead
//   RECORDED in `identityCollisions`, restated in an end-of-run summary, and made
//   to set `process.exitCode = 1` — the same failure-visibility idiom CAT-1 uses
//   for failed temporal sets, so a partial run cannot appear green.
//
//   Ordinary per-set failures are untouched and remain non-fatal.
//
// Containment: the guard REFUSES the write. It never deletes, aliases, merges or
// repairs a row, and takes no position on which of two colliding identities is
// correct. Reconciling the already-stored Trainer Gallery namespaces is a
// separate, evidence-gated decision.
//
// The identity is built from the frozen `src/utils/keys.js` normalizers — the
// same functions the importer uses. Do not reimplement them here; a guard that
// normalized differently would defend a key nothing consumes.

import { createClient } from '@supabase/supabase-js';
import {
  createIdentityIndex,
  addRowsToIndex,
  assertNoIdentityCollisions,
  existingDuplicateGroups,
  formatCollisionReport,
  formatCollisionRunSummary,
  isCollisionError,
} from './catalog-identity-guard.mjs';

const TCGDEX_BASE = 'https://api.tcgdex.net/v2/en';
const BATCH_SIZE = 10;        // concurrent card-detail fetches per batch
const BATCH_DELAY_MS = 250;   // pause between batches
const UPSERT_CHUNK = 500;     // rows per Supabase upsert call

// CAT-2B1 — page size for the existing-catalog identity load. PostgREST caps a
// single response (commonly 1000 rows), so one .select() CANNOT be assumed to
// return all ~23,780 rows. A silently truncated index would be worse than no
// guard at all: it would report "safe" for identities it never loaded.
const IDENTITY_PAGE_SIZE = 1000;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SYNC_MODE = process.env.SYNC_MODE || 'incremental'; // 'incremental' | 'temporal' | 'full'

// Known modes only. Previously any unrecognized value fell through to the
// full-sync path; with 'temporal' now available, a typo such as SYNC_MODE=temporl
// would silently perform a full-catalog rewrite — precisely the R1/R2 outcome
// CAT-1 prohibits, and it would do so during the checksum window. Refusing to
// start is the conservative failure mode. Valid modes behave exactly as before.
const VALID_SYNC_MODES = new Set(['incremental', 'temporal', 'full']);

// Optional single-set scope. Blank or absent means all sets. Trimmed because the
// workflow always passes the input, supplying an empty string on scheduled runs
// and whenever the manual field is left blank.
const SYNC_SET_ID = (process.env.SYNC_SET_ID || '').trim();

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
  process.exit(1);
}

if (!VALID_SYNC_MODES.has(SYNC_MODE)) {
  console.error(
    `Unknown SYNC_MODE "${SYNC_MODE}". Valid modes: ${[...VALID_SYNC_MODES].join(', ')}. Refusing to run.`
  );
  process.exit(1);
}

// Single-set scoping exists for temporal validation only. Scoping a card-write
// run would silently sync one set and leave the operator believing the catalog
// was processed, so it is refused rather than ignored.
if (SYNC_SET_ID && SYNC_MODE !== 'temporal') {
  console.error(
    `SYNC_SET_ID="${SYNC_SET_ID}" was supplied with SYNC_MODE="${SYNC_MODE}". ` +
    `Single-set scoping is supported only in temporal mode. Refusing to run.`
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Run-level temporal accounting. Set IDs only — no per-set affected-row counts.
// Supabase/PostgREST does not return affected rows from update() by default,
// and this run must not assert a row count it cannot substantiate. Production
// SQL remains the authoritative population reconciliation.
//
// The two missing-field populations are tracked INDEPENDENTLY. A set whose
// upstream carries a releaseDate but no serie.name is a SUCCESSFUL write — one
// column lands — yet it still leaves `series` NULL for every row in that set.
// A single "both absent" list cannot express that, so the post-run NULL counts
// must reconcile per column:
//   remaining release_date NULLs ⊆ rows of (missingReleaseDate ∪ failed)
//   remaining series       NULLs ⊆ rows of (missingSeries      ∪ failed)
// missingBoth is the intersection, reported additionally — never as the sole
// reconciliation basis for either column.
//
// Sets (not arrays) so a set ID recorded twice — e.g. by updateSetTemporal and
// again by the main loop's temporal catch — cannot produce a duplicate entry.
const temporalStats = {
  succeeded: new Map(),            // setId -> keys written
  missingReleaseDate: new Set(),   // upstream releaseDate absent
  missingSeries: new Set(),        // upstream serie.name absent
  missingBoth: new Set(),          // both absent — no write issued
  failed: new Set(),               // write failed, or the set threw before the write
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

async function loadArtistAliasMap() {
  const { data, error } = await supabase.from('artists').select('id, aliases');
  if (error) throw error;
  const map = new Map();
  for (const artist of data) {
    for (const alias of artist.aliases || []) {
      map.set(alias.trim().toLowerCase(), artist.id);
    }
  }
  return map;
}

function resolveArtistId(illustrator, aliasMap) {
  if (!illustrator) return null;
  return aliasMap.get(illustrator.trim().toLowerCase()) || null;
}

// ── Pricing adapter ───────────────────────────────────────────────────────────
// TCGdex pricing shape differs from the frontend-compatible shape stored in
// Supabase. The adapter runs at write time (here) so the frontend reads a
// stable, predictable contract from Supabase and never depends on upstream
// field names.
//
// TCGdex TCGPlayer shape (confirmed):
//   pricing.tcgplayer.{variant}.marketPrice / lowPrice / midPrice / highPrice
//   pricing.tcgplayer.updated  (metadata sibling)
//   pricing.tcgplayer.unit     (metadata sibling)
//   Known variant keys: normal, holo, reverse
//
// TCGdex Cardmarket shape (confirmed):
//   pricing.cardmarket.avg / low / trend / url / unit / updated / avg30 / …

// Maps known TCGdex TCGPlayer variant keys to frontend PRICE_VARIANT_ORDER keys.
// Unknown keys are passed through unchanged so they surface in "All Variants"
// rather than silently disappearing.
const VARIANT_KEY_MAP = {
  normal:  'normal',
  holo:    'holofoil',
  reverse: 'reverse-holofoil',
  // Additional keys (e.g. first-edition, unlimited variants) to be added here
  // once confirmed against a live WotC-era card response.
};

function adaptTcgplayer(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const adapted = {};
  for (const [key, value] of Object.entries(raw)) {
    // Preserve metadata siblings the frontend filters during variant enumeration
    if (key === 'updated' || key === 'unit') {
      adapted[key] = value;
      continue;
    }
    if (!value || typeof value !== 'object') continue;
    const normalizedKey = VARIANT_KEY_MAP[key] ?? key;
    adapted[normalizedKey] = {
      marketPrice: value.marketPrice ?? null,
      lowPrice:    value.lowPrice    ?? null,
      midPrice:    value.midPrice    ?? null,
      highPrice:   value.highPrice   ?? null,
    };
  }
  return Object.keys(adapted).length > 0 ? adapted : null;
}

function adaptCardmarket(raw) {
  if (!raw || typeof raw !== 'object') return null;
  // TCGdex Cardmarket fields are flat; frontend expects { url, prices: {...} }
  return {
    url: raw.url ?? null,
    prices: {
      averageSellPrice: raw.avg   ?? null,
      lowPrice:         raw.low   ?? null,
      trendPrice:       raw.trend ?? null,
    },
  };
}

function adaptPricing(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  if (raw.tcgplayer) {
    const t = adaptTcgplayer(raw.tcgplayer);
    if (t) out.tcgplayer = t;
  }
  if (raw.cardmarket) {
    const cm = adaptCardmarket(raw.cardmarket);
    if (cm) out.cardmarket = cm;
  }
  return Object.keys(out).length > 0 ? out : null;
}

// G1 — CAT-1B.
// This row object deliberately contains NO `series` and NO `release_date` key.
// The two fields it previously read (card.set?.serie?.name, card.set?.releaseDate)
// do not exist on TCGdex's SetBrief and always resolved to undefined.
// Omitting them keeps both columns out of the ON CONFLICT DO UPDATE SET list,
// so this path cannot write or null them. `updateSetTemporal` owns them.
// Signature stays two-parameter — setDetail is intentionally NOT threaded here.
function mapCardToRow(card, aliasMap) {
  const pricing = adaptPricing(card.pricing ?? null);
  return {
    id: card.id,
    local_id: card.localId ?? null,
    name: card.name,
    category: card.category ?? null,
    illustrator: card.illustrator ?? null,
    artist_id: resolveArtistId(card.illustrator, aliasMap),
    rarity: card.rarity ?? null,
    set_id: card.set?.id ?? null,
    set_name: card.set?.name ?? null,
    pokemon_dex_ids: card.dexId ?? null,
    types: card.types ?? null,
    hp: card.hp ?? null,
    regulation_mark: card.regulationMark ?? null,
    variants: card.variants ?? null,
    image_url: card.image ?? null,
    legal_standard: card.legal?.standard ?? null,
    legal_expanded: card.legal?.expanded ?? null,
    pricing:            pricing,
    pricing_updated_at: pricing ? new Date().toISOString() : null,
    pricing_source:     pricing ? 'tcgdex' : null,
    last_synced_at: new Date().toISOString(),
  };
}

async function upsertRows(rows) {
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const { error } = await supabase.from('cards').upsert(chunk, { onConflict: 'id' });
    if (error) throw error;
  }
}

// G2 — CAT-1B.
// The SOLE writer of `series` and `release_date`. Nothing else in this file may
// write either column.
//
// Payload rules:
//   - include `release_date` iff setDetail.releaseDate is non-null/undefined;
//   - include `series`       iff setDetail.serie?.name is non-null/undefined;
//   - a null-valued temporal key can never enter the payload — keys are added
//     only inside the non-null guards;
//   - when both are absent: log the set ID, perform NO write, return.
//
// Never writes last_synced_at, illustrator, artist_id, pricing, rarity,
// image_url, set_name, or any other column. The write footprint is at most two
// columns on the rows matched by set_id.
async function updateSetTemporal(setDetail) {
  const setId = setDetail?.id ?? null;
  if (!setId) {
    throw new Error('updateSetTemporal called without a resolvable set id');
  }

  const upstreamReleaseDate = setDetail.releaseDate ?? null;
  const upstreamSeries = setDetail.serie?.name ?? null;

  // Record each absent field independently, BEFORE the write. A set can be a
  // successful partial write and still belong to one missing-field list.
  if (upstreamReleaseDate === null) temporalStats.missingReleaseDate.add(setId);
  if (upstreamSeries === null) temporalStats.missingSeries.add(setId);

  const payload = {};
  const presentKeys = [];

  if (upstreamReleaseDate !== null) {
    payload.release_date = upstreamReleaseDate;
    presentKeys.push('release_date');
  }
  if (upstreamSeries !== null) {
    payload.series = upstreamSeries;
    presentKeys.push('series');
  }

  if (presentKeys.length === 0) {
    temporalStats.missingBoth.add(setId);
    console.log(`  Temporal skip ${setId} — upstream releaseDate and serie.name both absent; no write issued`);
    return { setId, written: false, keys: [] };
  }

  const { error } = await supabase.from('cards').update(payload).eq('set_id', setId);
  if (error) {
    temporalStats.failed.add(setId);
    throw new Error(`Temporal update failed for set ${setId}: ${error.message}`);
  }

  temporalStats.succeeded.set(setId, presentKeys);
  const partial = presentKeys.length === 1 ? ' (partial — the other upstream field is absent)' : '';
  console.log(`  Temporal ok ${setId} — keys written: ${presentKeys.join(', ')}${partial}`);
  return { setId, written: true, keys: presentKeys };
}

// Single-set scope resolution. Exact ID equality only — no substring match, no
// fuzzy fallback, no case folding. A scope that does not resolve to exactly one
// set refuses the run rather than silently processing the wrong sets or none.
// Throws; main()'s catch converts that to exit code 1.
function resolveScopedSets(sets) {
  if (!SYNC_SET_ID) return sets;

  const matches = (sets || []).filter((s) => s && s.id === SYNC_SET_ID);

  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? `SYNC_SET_ID="${SYNC_SET_ID}" matched no set exactly. Matching is exact — there is no ` +
          `substring or fuzzy fallback. Check the set ID against the upstream set list. Refusing to run.`
        : `SYNC_SET_ID="${SYNC_SET_ID}" matched ${matches.length} sets exactly, which should be ` +
          `impossible for a unique set ID. Refusing to run.`
    );
  }

  console.log(
    `Scoped run — SYNC_SET_ID="${SYNC_SET_ID}" selected exactly 1 of ${sets.length} sets. ` +
    `Every other set will be left completely untouched.`
  );
  return matches;
}

// CAT-2B1 — build the existing-catalog identity index.
//
// CAT-2D.1 — SOURCE IS THE EFFECTIVE CANONICAL CATALOG, NOT RAW `cards`.
//   Under the retained raw-history model, public.cards keeps obsolete provider
//   rows permanently. If the guard indexed raw `cards`, a reconciled rename
//   would collide with its own retired predecessor forever: the four renamed
//   Trainer Gallery sets would be refused on every future run even AFTER their
//   identities were correctly reconciled.
//
//   public.cards_effective excludes any id carrying an approved alias, so an
//   obsolete row is by definition not a catalog member and must not participate
//   in collision detection. The view exposes exactly the four identity columns
//   this index needs, so this is a source change, not a shape change.
//
//   With an empty alias table the two sources are row-for-row identical, so
//   this change is a provable no-op at deploy time.
//
//   Deliberately NOT changed to the effective catalog: upsertRows (writes
//   provider history), updateSetTemporal (CAT-1's sole temporal writer, must
//   still reach historical rows) and getStoredCountForSet (F-6 skip predicate).
//   Those three remain raw-`cards` consumers.
//
// Selects the four identity columns and nothing else: no images, pricing,
// illustrator, or other unrelated payload.
//
// Pagination is explicit and deterministic (ordered by id, fixed-size ranges).
// Any page shorter than IDENTITY_PAGE_SIZE — including an empty one — ends the
// walk, and the cursor always advances by a full page, so a finite table always
// terminates the loop.
//
// Cost: roughly ceil(rows / 1000) extra reads per card-writing run — about 24
// requests against the current catalog. Paid once per run, not per set.
//
// Only called for card-writing modes. Temporal mode performs no upsert and must
// not pay for — or depend on — this read.
async function loadCatalogIdentityIndex() {
  const index = createIdentityIndex();
  let from = 0;
  let pages = 0;

  for (;;) {
    const { data, error } = await supabase
      .from('cards_effective')
      .select('id, name, set_name, local_id')
      .order('id', { ascending: true })
      .range(from, from + IDENTITY_PAGE_SIZE - 1);
    if (error) throw error;

    const rows = data || [];
    pages++;
    addRowsToIndex(index, rows);

    if (rows.length < IDENTITY_PAGE_SIZE) break;
    from += rows.length;
  }

  console.log(
    `Identity index loaded — ${index.indexed} identities from ${pages} page(s)` +
    (index.skipped > 0 ? `; ${index.skipped} row(s) had no constructible Tier-1 identity` : '')
  );

  // A pre-existing duplicate group means the catalog is ALREADY in the state this
  // guard exists to prevent. It is not caused by this run, so loading does not
  // abort — but it is surfaced loudly, because the next write touching that
  // identity will fail closed and this is the explanation.
  const dupes = existingDuplicateGroups(index);
  if (dupes.length > 0) {
    console.error(
      `\nWARNING — ${dupes.length} pre-existing Tier-1 identity group(s) already map to ` +
      `more than one canonical card ID. These predate this run.`
    );
    for (const d of dupes) {
      const [name, set, num] = d.components;
      console.error(`  - name="${name}" set="${set}" num="${num}" -> ${d.ids.join(', ')}`);
    }
    console.error('');
  }

  return index;
}

async function getStoredCountForSet(setId) {
  const { count, error } = await supabase
    .from('cards')
    .select('id', { count: 'exact', head: true })
    .eq('set_id', setId);
  if (error) throw error;
  return count ?? 0;
}

async function syncSet(setSummary, aliasMap, unmatched, identityIndex) {
  const setDetail = await fetchJson(`${TCGDEX_BASE}/sets/${setSummary.id}`);
  const briefCards = setDetail.cards || [];

  // ── Temporal mode ───────────────────────────────────────────────────────────
  // Reuses the Set-detail fetch already performed above. No card-detail fetch,
  // no full-row upsert, no card write of any kind.
  // CAT-2B1: identityIndex is null here — a mode that cannot upsert cannot
  // introduce a colliding identity, so it neither loads nor invokes the guard.
  if (SYNC_MODE === 'temporal') {
    await updateSetTemporal(setDetail);
    return { synced: 0 };
  }

  // ── Incremental skip ────────────────────────────────────────────────────────
  // A skipped set receives NO temporal write. Restored values stay untouched.
  if (SYNC_MODE === 'incremental') {
    const storedCount = await getStoredCountForSet(setSummary.id);
    if (storedCount >= briefCards.length && briefCards.length > 0) {
      console.log(`Skip ${setSummary.id} (${setSummary.name}) — already synced (${storedCount}/${briefCards.length})`);
      return { synced: 0 };
    }
  }

  console.log(`Syncing ${setSummary.id} (${setSummary.name}) — ${briefCards.length} cards`);

  const rows = [];
  for (let i = 0; i < briefCards.length; i += BATCH_SIZE) {
    const batch = briefCards.slice(i, i + BATCH_SIZE);
    const details = await Promise.all(
      batch.map((c) =>
        fetchJson(`${TCGDEX_BASE}/cards/${c.id}`).catch((err) => {
          console.error(`  Failed to fetch ${c.id}: ${err.message}`);
          return null;
        })
      )
    );
    for (const card of details) {
      if (!card) continue;
      const row = mapCardToRow(card, aliasMap);
      if (card.illustrator && !row.artist_id) {
        unmatched.add(card.illustrator);
      }
      rows.push(row);
    }
    await sleep(BATCH_DELAY_MS);
  }

  // ── CAT-2B1 G3 — identity guard, immediately before the write ───────────────
  // Validates the ENTIRE row collection for this set against every identity
  // already in the catalog plus every identity this run has already committed.
  // Throws CatalogIdentityCollisionError on conflict. There is no try/catch
  // between here and upsertRows, so a colliding set cannot reach the write at
  // all — not even partially.
  if (identityIndex) {
    assertNoIdentityCollisions(identityIndex, rows, { setId: setSummary.id });
  }

  await upsertRows(rows);

  // Commit AFTER the write succeeds, never before. upsertRows throws on error, so
  // rows that failed to land never enter the index — a later set in this same run
  // is only ever checked against identities that are genuinely in the catalog.
  if (identityIndex) {
    addRowsToIndex(identityIndex, rows);
  }

  // Post-upsert placement is load-bearing: for a new set the rows do not exist
  // before this point, so an earlier UPDATE would match nothing. upsertRows
  // throws on error and is not caught here, so a set whose cards failed to land
  // never reaches this line.
  try {
    await updateSetTemporal(setDetail);
  } catch (err) {
    console.error(
      `  TEMPORAL UPDATE FAILED for set ${setSummary.id} AFTER the card upsert succeeded.\n` +
      `    The card rows for this set are written; its series/release_date may be missing or stale.\n` +
      `    A later incremental run will NOT necessarily repair this: once the stored card count\n` +
      `    reaches the upstream count, this set is skipped and receives no temporal write at all.\n` +
      `    Run an explicit SYNC_MODE=temporal reconciliation to repair it.`
    );
    throw err;
  }

  return { synced: rows.length };
}

function reportTemporal() {
  const { succeeded, missingReleaseDate, missingSeries, missingBoth, failed } = temporalStats;
  const touched = succeeded.size + missingReleaseDate.size + missingSeries.size +
                  missingBoth.size + failed.size;
  if (touched === 0) return;

  const sorted = (s) => [...s].sort();

  console.log(`\nTemporal summary`);
  console.log(`  written:         ${succeeded.size} set(s)`);
  console.log(`  no write issued: ${missingBoth.size} set(s) (both upstream fields absent)`);
  console.log(`  failed:          ${failed.size} set(s)`);

  if (succeeded.size > 0) {
    console.log(`\nWritten sets — set ID → keys written:`);
    for (const setId of [...succeeded.keys()].sort()) {
      console.log(`  - ${setId} → ${succeeded.get(setId).join(', ')}`);
    }
  }

  // Wording note: G2 never writes a null, so "no write was issued" must not be
  // read as "these rows are NULL". On a reconciliation run over already-restored
  // data, an absent upstream value leaves a known non-null stored value intact.
  if (missingReleaseDate.size > 0) {
    console.log(`\nSets missing upstream releaseDate (${missingReleaseDate.size}) — no release_date write was issued for these sets.`);
    console.log(`  Existing non-null values were preserved; previously null values remain null.`);
    for (const setId of sorted(missingReleaseDate)) console.log(`  - ${setId}`);
  }

  if (missingSeries.size > 0) {
    console.log(`\nSets missing upstream serie.name (${missingSeries.size}) — no series write was issued for these sets.`);
    console.log(`  Existing non-null values were preserved; previously null values remain null.`);
    for (const setId of sorted(missingSeries)) console.log(`  - ${setId}`);
  }

  if (missingBoth.size > 0) {
    console.log(`\nSets missing BOTH upstream fields (${missingBoth.size}) — no temporal write was issued at all.`);
    console.log(`  Existing non-null values were preserved; previously null values remain null.`);
    for (const setId of sorted(missingBoth)) console.log(`  - ${setId}`);
  }

  if (failed.size > 0) {
    console.error(`\nFAILED temporal sets (${failed.size}) — explicit SYNC_MODE=temporal reconciliation required:`);
    for (const setId of sorted(failed)) console.error(`  - ${setId}`);
    console.error(
      `Temporal restoration is INCOMPLETE. Exiting non-zero so a partial run cannot appear green.`
    );
    process.exitCode = 1;
  }

  // Reconciliation guidance is mode- and scope-aware. Only an unscoped temporal
  // run observes every set, so only that run may make a whole-catalog claim.
  if (SYNC_MODE === 'temporal' && !SYNC_SET_ID) {
    console.log(
      `\nPost-run reconciliation — whole-catalog temporal restoration (authoritative):\n` +
      `  remaining release_date NULL rows must reconcile against the sets listed as\n` +
      `    'missing upstream releaseDate' plus the failed sets above;\n` +
      `  remaining series NULL rows must reconcile against the sets listed as\n` +
      `    'missing upstream serie.name' plus the failed sets above.\n` +
      `  The two populations are tracked INDEPENDENTLY. Do NOT reconcile either\n` +
      `  column against the both-absent list alone: a set written with only one\n` +
      `  key is a successful write and still leaves the other column NULL.\n` +
      `  Per-set affected-row counts are intentionally not reported — Supabase\n` +
      `  update() does not return affected rows by default. Production SQL is\n` +
      `  the authoritative population reconciliation.`
    );
  } else if (SYNC_MODE === 'temporal') {
    console.log(
      `\nPost-run reconciliation — SCOPED temporal run (set "${SYNC_SET_ID}"):\n` +
      `  These diagnostics apply ONLY to the selected set.\n` +
      `  Do NOT reconcile whole-catalog release_date or series NULL counts from\n` +
      `  this run: every other set was left unvisited and is not represented here.\n` +
      `  Validate the selected set directly instead.\n` +
      `  A whole-catalog reconciliation requires an unscoped SYNC_MODE=temporal run.`
    );
  } else {
    console.log(
      `\nPost-run temporal diagnostics — routine ${SYNC_MODE} run:\n` +
      `  The lists above describe only the sets TOUCHED by this run.\n` +
      `  They are NOT a complete inventory of catalog temporal gaps: skipped sets\n` +
      `  received no temporal write and are not represented here.\n` +
      `  This run makes no whole-catalog NULL reconciliation claim.`
    );
  }
}

// CAT-2B1 G4 — end-of-run integrity report.
//
// Sets process.exitCode rather than calling process.exit(), matching how
// reportTemporal() reports failed temporal sets: the run finishes its normal
// reporting and Node exits non-zero afterwards. A clean run prints nothing and
// leaves the exit code alone.
function reportIdentityCollisions(entries) {
  const summary = formatCollisionRunSummary(entries);
  if (summary === null) return;
  console.error(`\n${summary}`);
  process.exitCode = 1;
}

async function main() {
  console.log(
    `Starting card sync — mode: ${SYNC_MODE}` +
    (SYNC_SET_ID ? `, scoped to set "${SYNC_SET_ID}"` : ', all sets')
  );

  const aliasMap = await loadArtistAliasMap();
  console.log(`Loaded ${aliasMap.size} artist aliases`);

  const allSets = await fetchJson(`${TCGDEX_BASE}/sets`);
  console.log(`Found ${allSets.length} sets`);

  // Blank scope leaves the list exactly as fetched.
  const sets = resolveScopedSets(allSets);

  // CAT-2B1 — the identity guard applies to every mode capable of calling
  // upsertRows, which today is incremental and full. Temporal mode writes no card
  // rows, so it neither loads the index nor runs the guard.
  const identityIndex = SYNC_MODE === 'temporal' ? null : await loadCatalogIdentityIndex();

  const unmatched = new Set();
  const identityCollisions = []; // [{ setId, collisions }] — CAT-2B1 G4
  let totalSynced = 0;

  for (const setSummary of sets) {
    try {
      const { synced } = await syncSet(setSummary, aliasMap, unmatched, identityIndex);
      totalSynced += synced;
    } catch (err) {
      // CAT-2B1 G4 — a catalog identity collision is an INTEGRITY failure, not a
      // per-set transport failure. It is contained to THIS set: the guard threw
      // before upsertRows, so zero rows were written and updateSetTemporal never
      // ran for it. Record it, report it now while the context is local, and let
      // the loop continue — unrelated sets must not be held hostage by one
      // renamed set, and stopping here would hide how many sets are affected.
      //
      // It is NOT swallowed: reportIdentityCollisions() restates it at the end of
      // the run and sets process.exitCode = 1.
      if (isCollisionError(err)) {
        console.error(`\n${formatCollisionReport(err)}\n`);
        console.error(
          `Set ${setSummary.id} was REFUSED — zero rows written. Continuing with the remaining sets.`
        );
        identityCollisions.push({ setId: setSummary.id, collisions: err.collisions || [] });
        continue;
      }
      console.error(`Error syncing set ${setSummary.id}: ${err.message}`);
      if (SYNC_MODE === 'temporal') {
        // Narrow correction, temporal mode only. In temporal mode the Set-detail
        // fetch can fail BEFORE updateSetTemporal runs, so without this the set
        // would never enter temporalStats.failed and the run could exit 0 with a
        // silently incomplete restoration. Set semantics dedupe the case where
        // updateSetTemporal already recorded this ID before throwing.
        // The loop deliberately continues: attempting later sets gives a complete
        // diagnostic picture in one run rather than one failure at a time.
        temporalStats.failed.add(setSummary.id);
      }
    }
  }

  console.log(`\nDone. Upserted ${totalSynced} cards.`);
  reportTemporal();

  if (unmatched.size > 0) {
    console.log(`\n${unmatched.size} unmatched illustrator strings (no artist alias match):`);
    for (const name of [...unmatched].sort()) {
      console.log(`  - ${name}`);
    }
  }

  // CAT-2B1 G4 — LAST, deliberately. A refused set is the highest-severity output
  // of the run, and a failed Actions job is read from the tail of the log. Printed
  // after the unmatched-illustrator list so it is never buried behind it.
  reportIdentityCollisions(identityCollisions);
}

main().catch((err) => {
  console.error('Sync failed:', err);
  process.exit(1);
});

