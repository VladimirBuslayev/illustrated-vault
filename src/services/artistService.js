// src/services/artistService.js
// Supabase read layer for user-specific tracked artists (A-D2b0).
//
// B0 contract: the app must render the curated ARTISTS roster even when the
// A-D2a SQL objects (user_tracked_artists, artists rows beyond the roster)
// do not exist yet, or when any request fails. Every function here fails
// SOFT — on any error it logs quietly and returns an empty result. Callers
// treat an empty result as "no dynamic additions" and fall back to the
// curated roster.
//
// Read-only. Do not add caching. Do not add writes — track/untrack mutation
// arrives with A-D2c (Add to Archive UI) and A-D2d (untrack), not here.

import { supabase } from './supabaseClient.js';

// fetchTrackedArtistIds(userId) → Set<artistId>
// The user's tracked roster ids. Empty Set on any failure, including the
// table not having been created yet (pre-SQL deploys are safe).
async function fetchTrackedArtistIds(userId) {
  if (!userId) return new Set();
  try {
    const { data, error } = await supabase
      .from('user_tracked_artists')
      .select('artist_id')
      .eq('user_id', userId);
    if (error) {
      console.warn('[artistService] tracked-roster fetch soft-fail:', error.message);
      return new Set();
    }
    return new Set((data || []).map(r => r.artist_id));
  } catch (e) {
    console.warn('[artistService] tracked-roster fetch soft-fail:', (e && e.message) || e);
    return new Set();
  }
}

// fetchArtistIdentities(ids) → Array<{ id, aliases }>
// Resolves identity rows for dynamic (non-curated) tracked ids so the app
// can build roster entries (display name = aliases[0] || id). Only called
// when dynamic ids exist — with the curated-only seed, that is never.
// Empty array on any failure.
async function fetchArtistIdentities(ids) {
  const list = Array.from(ids || []).filter(Boolean);
  if (!list.length) return [];
  try {
    const { data, error } = await supabase
      .from('artists')
      .select('id, aliases')
      .in('id', list);
    if (error) {
      console.warn('[artistService] identity fetch soft-fail:', error.message);
      return [];
    }
    return data || [];
  } catch (e) {
    console.warn('[artistService] identity fetch soft-fail:', (e && e.message) || e);
    return [];
  }
}

export { fetchTrackedArtistIds, fetchArtistIdentities };
