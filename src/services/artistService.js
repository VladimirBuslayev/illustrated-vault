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
// Do not add caching. Writes are limited to the add_artist_to_archive RPC
// (A-D2c) — the single audited write path for archive additions. Untrack
// mutation arrives with A-D2d, not here. No direct table inserts, ever.

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

// searchIllustratorDirectory(query, limit) → Array<{ illustrator, card_count }> | null
// A-D2c: quiet discovery search over the illustrator_directory view.
// Returns null on failure (so the UI can show a quiet inline error) and []
// for a genuinely empty result. Never throws. Ordered by card count so the
// most prolific matches surface first.
async function searchIllustratorDirectory(query, limit = 12) {
  const q = String(query || '').trim();
  if (!q) return [];
  try {
    const { data, error } = await supabase
      .from('illustrator_directory')
      .select('illustrator, card_count')
      .ilike('illustrator', `%${q}%`)
      .order('card_count', { ascending: false })
      .limit(limit);
    if (error) {
      console.warn('[artistService] directory search soft-fail:', error.message);
      return null;
    }
    return data || [];
  } catch (e) {
    console.warn('[artistService] directory search soft-fail:', (e && e.message) || e);
    return null;
  }
}

// addArtistToArchive(illustrator) → { ok: boolean, error?: string }
// A-D2c: calls the add_artist_to_archive RPC — the single write path for
// archive additions. The illustrator string must come from an
// illustrator_directory result, never free text (enforced by the caller UI).
// Never throws; the caller decides how to surface { ok: false }.
//
// Hotfix (post-A-D2c): the RPC error was previously reduced to error.message,
// which hid the Postgres error code needed to diagnose failures. Now logs the
// full { code, message, details, hint } and returns a short human-readable
// reason. Error code 23505 (unique violation = already tracked) is treated as
// success — the add is idempotent from the user's point of view.
function describeAddError(error) {
  const code = (error && error.code) || '';
  const msg  = (error && error.message) || '';
  if (code === 'PGRST202') return 'App and database are out of sync (function or argument name mismatch).';
  if (code === '42501' || /permission denied/i.test(msg)) return 'The database refused the write (permissions rule needs updating).';
  if (code === '42P01') return 'A required table is missing.';
  if (/JWT|token|not authenticated/i.test(msg)) return 'Your session may have expired — sign out and back in.';
  return 'Something went wrong on the server.';
}

async function addArtistToArchive(illustrator) {
  const name = String(illustrator || '').trim();
  if (!name) return { ok: false, error: 'No illustrator given' };
  try {
    const { error } = await supabase.rpc('add_artist_to_archive', { p_illustrator: name });
    if (error) {
      console.warn('[artistService] add-to-archive failed:', {
        code: error.code, message: error.message, details: error.details, hint: error.hint,
      });
      if (error.code === '23505') return { ok: true }; // already in archive → success
      return { ok: false, error: describeAddError(error) };
    }
    return { ok: true };
  } catch (e) {
    const msg = (e && e.message) || String(e);
    console.warn('[artistService] add-to-archive failed (thrown):', msg);
    return { ok: false, error: 'Network problem — try again.' };
  }
}

export { fetchTrackedArtistIds, fetchArtistIdentities, searchIllustratorDirectory, addArtistToArchive };
