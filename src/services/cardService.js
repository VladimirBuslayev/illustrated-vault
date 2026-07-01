// src/services/cardService.js
// Artist card fetch orchestrator — Supabase artist path + legacy TCGdex set path.
// Source: index.legacy.html lines 401–444.
//
// Runtime source-of-truth rule:
//   Artist entries → Supabase cards_effective (fast, reliable, never TCGdex live).
//   Set entries    → TCGdex (existing legacy behavior; only for entry.isSet paths).
//   Do NOT expand TCGdex usage. Do NOT use TCGdex for artist card display.
//
// Gate 3D: FK query path added.
//   When entry.artistId is present, queries cards_effective by .eq('artist_id', ...)
//   instead of fuzzy ILIKE. This eliminates false positives (e.g. 'sui' matching
//   'Misa Tsutsui') and is more reliable for all tracked artists.
//   ILIKE path is retained as a fallback for entries without artistId.
//
//   Cache key bumped from pb7_supa_ to pb8_supa_ to force invalidation of all
//   stale ILIKE-based caches on first load after deploy.
//   Key suffix uses entry.artistId when available (stable DB slug),
//   falling back to toSlug(entry.name) for entries without an artistId.
//
// Do not add retries, logging, validation, normalization, or new data sources.
// Do not change sort behavior or return shape (beyond the additive artist_id field).

import { supabase }                      from './supabaseClient.js';
import { lsGet, lsSet }                  from '../utils/cache.js';
import { toSlug }                        from '../utils/slug.js';
import { CACHE_TTL }                     from '../constants/config.js';
import { fetchCardBriefs, fetchFullCard } from './tcgdexService.js';
import { supaRowToCard }                 from './cardAdapter.js';

// Source: index.legacy.html line 104.
// Module-local only — not exported. Used only in the set-based fetch loop below.
const FETCH_BATCH = 10;

// Columns selected from cards_effective for artist path queries.
// artist_id added in Gate 3D; all other fields unchanged from Gate 2.
const ARTIST_SELECT = "id,name,set_id,set_name,local_id,illustrator,artist_id,image_url,rarity,release_date,pricing,pricing_updated_at";

async function fetchArtistCards(entry) {
  // ── Set path ────────────────────────────────────────────────────────────────
  // Set-based entries (e.g. Pokémon GO promo set) keep the TCGdex path.
  if (entry.isSet) {
    const ck = `pb6_cards_${toSlug(entry.name)}`;
    const cached = lsGet(ck);
    if (cached && cached.ts && Date.now() - cached.ts < CACHE_TTL) return cached.cards;
    const rawBriefs = await fetchCardBriefs(entry);
    const seen = new Set();
    const briefs = rawBriefs.filter(b => { if (!b || !b.id || seen.has(b.id)) return false; seen.add(b.id); return true; });
    const fullCards = []; let failCount = 0;
    for (let i = 0; i < briefs.length; i += FETCH_BATCH) {
      const batch = briefs.slice(i, i + FETCH_BATCH);
      const results = await Promise.all(batch.map(b => fetchFullCard(b.id).catch(() => null)));
      results.forEach(c => { if (c) fullCards.push(c); else failCount++; });
    }
    if (briefs.length > 0 && fullCards.length === 0) throw new Error(`Found ${briefs.length} cards but all detail fetches failed — likely rate-limited`);
    if (failCount > 0) throw new Error(`${failCount} of ${briefs.length} card detail fetches failed — likely rate-limited, retry shortly`);
    fullCards.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    lsSet(ck, { cards: fullCards, ts: Date.now() });
    return fullCards;
  }

  // ── Artist path ─────────────────────────────────────────────────────────────
  // Cache key: pb8 prefix (invalidates all pb7 ILIKE caches from Gate 2).
  // Suffix: artistId slug when available (stable), else display-name slug.
  const ck = `pb8_supa_${entry.artistId ?? toSlug(entry.name)}`;
  const cached = lsGet(ck);
  if (cached && cached.ts && Date.now() - cached.ts < CACHE_TTL) return cached.cards;

  // Build the Supabase query — FK path when artistId present, ILIKE fallback otherwise.
  let query;
  if (entry.artistId) {
    // FK path: precise equality match on artist_id.
    // Eliminates false positives from substring ILIKE (e.g. 'sui' in 'Misa Tsutsui').
    query = supabase.from("cards_effective")
      .select(ARTIST_SELECT)
      .eq("artist_id", entry.artistId);
  } else {
    // ILIKE fallback: used for entries without an artistId (future additions, edge cases).
    // Behavior identical to Gate 2 ILIKE path.
    const names = [entry.name, ...(entry.aliases || [])];
    const ilikeFilters = names.map(n => `illustrator.ilike.%${n}%`).join(",");
    query = supabase.from("cards_effective")
      .select(ARTIST_SELECT)
      .or(ilikeFilters);
  }

  const { data, error } = await query
    .order("release_date", { ascending: true, nullsFirst: false })
    .order("set_id")
    .order("local_id");

  if (error) throw new Error(`Supabase artist fetch error: ${error.message}`);
  const seen = new Set();
  const cards = (data || [])
    .filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true; })
    .map(supaRowToCard);
  lsSet(ck, { cards, ts: Date.now() });
  return cards;
}

export { fetchArtistCards };
