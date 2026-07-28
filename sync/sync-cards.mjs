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

import { createClient } from '@supabase/supabase-js';

const TCGDEX_BASE = 'https://api.tcgdex.net/v2/en';
const BATCH_SIZE = 10;        // concurrent card-detail fetches per batch
const BATCH_DELAY_MS = 250;   // pause between batches
const UPSERT_CHUNK = 500;     // rows per Supabase upsert call

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

async function getStoredCountForSet(setId) {
  const { count, error } = await supabase
    .from('cards')
    .select('id', { count: 'exact', head: true })
    .eq('set_id', setId);
  if (error) throw error;
  return count ?? 0;
}

async function syncSet(setSummary, aliasMap, unmatched) {
  const setDetail = await fetchJson(`${TCGDEX_BASE}/sets/${setSummary.id}`);
  const briefCards = setDetail.cards || [];

  // ── Temporal mode ───────────────────────────────────────────────────────────
  // Reuses the Set-detail fetch already performed above. No card-detail fetch,
  // no full-row upsert, no card write of any kind.
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

  await upsertRows(rows);

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

  const unmatched = new Set();
  let totalSynced = 0;

  for (const setSummary of sets) {
    try {
      const { synced } = await syncSet(setSummary, aliasMap, unmatched);
      totalSynced += synced;
    } catch (err) {
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
}

main().catch((err) => {
  console.error('Sync failed:', err);
  process.exit(1);
});

