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
// Do not add caching.
//
// Writes, and why each one is (or isn't) an RPC:
//   - addArtistToArchive (A-D2c) — RPC. Must validate against the card
//     catalog and may create a global artists identity row: needs
//     SECURITY DEFINER, so it stays server-side.
//   - updateArtistTier / removeArtistFromArchive (A-D2d) — direct
//     RLS-guarded table writes, not RPCs. Neither touches global artist
//     identity or needs catalog validation, so a plain client-side
//     update/delete under RLS is sufficient and simplest. Both are
//     inherently scoped to dynamic (user-added) artists, since curated
//     ARTISTS entries are never rows in user_tracked_artists.

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

// fetchTrackedArtistTiers(userId) → Map<artistId, tier>
// A-D2d: per-user tier for every tracked (dynamic) artist row, keyed by
// artist_id. tier is one of 'main' | 'secondary' | 'added' (DB default
// 'added', enforced by a CHECK constraint). Added alongside — not in place
// of — fetchTrackedArtistIds so existing callers/behavior are untouched.
// Empty Map on any failure, including the column not existing yet.
async function fetchTrackedArtistTiers(userId) {
  if (!userId) return new Map();
  try {
    const { data, error } = await supabase
      .from('user_tracked_artists')
      .select('artist_id, tier')
      .eq('user_id', userId);
    if (error) {
      console.warn('[artistService] tracked-tiers fetch soft-fail:', error.message);
      return new Map();
    }
    return new Map((data || []).map(r => [r.artist_id, r.tier || 'added']));
  } catch (e) {
    console.warn('[artistService] tracked-tiers fetch soft-fail:', (e && e.message) || e);
    return new Map();
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

// updateArtistTier(userId, artistId, tier) → { ok: boolean, error?: string }
// A-D2d: reassigns a dynamically-tracked artist's display tier
// ('main' | 'secondary' | 'added'). Direct RLS-guarded UPDATE — no RPC
// needed, since this mutation (unlike Add to Archive) never touches global
// artist identity or requires catalog validation; the DB CHECK constraint
// is the source of truth for valid tier values. Only ever called for
// artistIds already present in the caller's own user_tracked_artists rows
// (curated artists are never rows here, so this is inherently scoped to
// dynamic additions). Never throws.
async function updateArtistTier(userId, artistId, tier) {
  if (!userId || !artistId) return { ok: false, error: 'Missing user or artist.' };
  if (!['main', 'secondary', 'added'].includes(tier)) return { ok: false, error: 'Invalid tier.' };
  try {
    const { error } = await supabase
      .from('user_tracked_artists')
      .update({ tier })
      .eq('user_id', userId)
      .eq('artist_id', artistId);
    if (error) {
      console.warn('[artistService] tier update failed:', error.message);
      return { ok: false, error: 'Could not update — try again.' };
    }
    return { ok: true };
  } catch (e) {
    const msg = (e && e.message) || String(e);
    console.warn('[artistService] tier update failed (thrown):', msg);
    return { ok: false, error: 'Network problem — try again.' };
  }
}

// removeArtistFromArchive(userId, artistId) → { ok: boolean, error?: string }
// A-D2d: deletes only the caller's own user_tracked_artists membership row.
// Direct RLS-guarded DELETE (uta_delete_own already restricts to
// auth.uid() = user_id). Does NOT touch the global artists identity row,
// cards, card_overrides, card_favorites, user_card_intent, or manual
// owned/missing state — none of those reference user_tracked_artists.
// Never throws.
async function removeArtistFromArchive(userId, artistId) {
  if (!userId || !artistId) return { ok: false, error: 'Missing user or artist.' };
  try {
    const { error } = await supabase
      .from('user_tracked_artists')
      .delete()
      .eq('user_id', userId)
      .eq('artist_id', artistId);
    if (error) {
      console.warn('[artistService] remove failed:', error.message);
      return { ok: false, error: 'Could not remove — try again.' };
    }
    return { ok: true };
  } catch (e) {
    const msg = (e && e.message) || String(e);
    console.warn('[artistService] remove failed (thrown):', msg);
    return { ok: false, error: 'Network problem — try again.' };
  }
}

export {
  fetchTrackedArtistIds,
  fetchTrackedArtistTiers,
  fetchArtistIdentities,
  searchIllustratorDirectory,
  addArtistToArchive,
  updateArtistTier,
  removeArtistFromArchive,
};
