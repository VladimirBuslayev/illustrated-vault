// src/services/imageService.js
// Image fallback fetchers for cards that TCGdex has no asset for.
// Source: index.legacy.html lines 350-392 (PTCGIO_BASE, fetchFallbackImage, buildLimitlessGuess).
//
// fetchFallbackImage — Tier 1 fallback: pokemontcg.io asset lookup.
//   Results are cached in localStorage (pb_fallback_img_{cardId}).
//   Cached value is {small, large} on a hit, or false on a confirmed miss.
//   Transient network failures return false WITHOUT caching to allow retry.
//
// buildLimitlessGuess — Tier 2 fallback: Limitless TCG CDN URL construction.
//   This is a *constructed guess*, not a verified lookup. Callers must confirm
//   the URL loads (e.g. via <img onError>) before trusting it.

import { lsGet, lsSet } from '../utils/cache.js';

const PTCGIO_BASE = 'https://api.pokemontcg.io/v2';

async function fetchFallbackImage(cardId) {
  const ck = `pb_fallback_img_${cardId}`;
  const cached = lsGet(ck);
  if (cached !== null) return cached; // {small,large} on a known hit, false on a known miss
  try {
    const res = await fetch(`${PTCGIO_BASE}/cards/${encodeURIComponent(cardId)}`);
    if (!res.ok) { lsSet(ck, false); return false; }
    const json = await res.json();
    const imgs = json && json.data && json.data.images;
    if (imgs && (imgs.small || imgs.large)) {
      const result = { small: imgs.small || null, large: imgs.large || null };
      lsSet(ck, result);
      return result;
    }
    lsSet(ck, false);
    return false;
  } catch {
    return false; // don't cache transient network errors — allow a retry later
  }
}

function buildLimitlessGuess(card) {
  const setId = card && card.set && card.set.id;
  const num   = card && card.localId;
  if (!setId || !num) return null;
  const code = String(setId).toUpperCase();
  const base = `https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/${code}/${code}_${num}_R_EN`;
  return { small: `${base}_SM.png`, large: `${base}_LG.png` };
}

export { fetchFallbackImage, buildLimitlessGuess };
