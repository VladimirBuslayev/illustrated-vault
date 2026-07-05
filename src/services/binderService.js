// ── binderService.js ─────────────────────────────────────────────────────────
// BP-0A1: all user_binders / user_binder_cards I/O for Binder Planning.
//
// Conventions (matching artistService / collectionService):
//   - reads soft-fail: log and return [] / null so the UI can render a calm
//     degraded state instead of crashing
//   - writes throw: callers surface the failure (inline error / confirm flow)
//   - no caching
//   - RLS is the real security boundary; the explicit .eq('user_id', …) on
//     binder writes is belt-and-braces client hygiene, not the guarantee.
//     user_binder_cards has NO user_id column — its policies verify
//     ownership through the parent binder (BP-0A1 migration).
//
// user_binder_cards functions arrive with BP-0A3; this file is deliberately
// binder-row-only for the BP-0A1/2 foundation.

import { supabase } from './supabaseClient.js';
import { supaRowToCard } from './cardAdapter.js'; // BP-0A4: catalog helpers below

const BINDER_COLS = 'id, name, description, created_at, updated_at';

// Byte-identical to ARTIST_SELECT in cardService.js — the canonical
// cards_effective column list consumed by supaRowToCard.
const CARD_COLS = "id,name,set_id,set_name,local_id,illustrator,artist_id,image_url,rarity,release_date,pricing,pricing_updated_at";

/** All binders for a user, most recently touched first. Soft-fails to []. */
export async function fetchBinders(userId) {
  try {
    const { data, error } = await supabase
      .from('user_binders')
      .select(BINDER_COLS)
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return data || [];
  } catch (e) {
    console.error('fetchBinders failed:', e);
    return null; // null = load failed (distinct from a genuinely empty [])
  }
}

/** One binder by id. Returns null when missing, unauthorized, or on error —
 *  the caller renders a soft not-found state in all three cases. */
export async function fetchBinder(binderId) {
  try {
    const { data, error } = await supabase
      .from('user_binders')
      .select(BINDER_COLS)
      .eq('id', binderId)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  } catch (e) {
    console.error('fetchBinder failed:', e);
    return null;
  }
}

/** Create a binder. Trims name/description; empty-after-trim description is
 *  stored as null (never ""). Throws on failure. Returns the created row. */
export async function createBinder(userId, { name, description }) {
  const cleanName = (name || '').trim();
  const cleanDesc = (description || '').trim();
  if (!cleanName) throw new Error('Binder name is required.');
  if (cleanName.length > 80) throw new Error('Binder name is too long (80 characters max).');
  if (cleanDesc.length > 280) throw new Error('Description is too long (280 characters max).');
  const { data, error } = await supabase
    .from('user_binders')
    .insert({ user_id: userId, name: cleanName, description: cleanDesc || null })
    .select(BINDER_COLS)
    .single();
  if (error) throw error;
  return data;
}

/** Delete a binder. Membership rows cascade at the database level. Throws on
 *  failure. */
export async function deleteBinder(userId, binderId) {
  const { error } = await supabase
    .from('user_binders')
    .delete()
    .eq('id', binderId)
    .eq('user_id', userId);
  if (error) throw error;
}

// ═══ BP-0A3: binder membership ═══════════════════════════════════════════════
// No user_id on child rows — RLS verifies ownership through the parent binder.

/** Ordered card_id list for a binder (created_at asc). Soft-fails to null. */
export async function fetchBinderCardIds(binderId) {
  try {
    const { data, error } = await supabase
      .from('user_binder_cards')
      .select('card_id, created_at')
      .eq('binder_id', binderId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data || []).map(r => r.card_id);
  } catch (e) {
    console.error('fetchBinderCardIds failed:', e);
    return null;
  }
}

/** Add a card to a binder. Returns true on insert, false when the card was
 *  already a member (unique constraint 23505 — treated as a soft no-op, not
 *  an error). Throws on any other failure. Touches nothing but
 *  user_binder_cards — never hunt intent, favorites, or ownership. */
export async function addCardToBinder(binderId, cardId) {
  const { error } = await supabase
    .from('user_binder_cards')
    .insert({ binder_id: binderId, card_id: cardId });
  if (error) {
    if (error.code === '23505') return false; // already in the binder
    throw error;
  }
  return true;
}

/** Remove a card from a binder. Throws on failure. */
export async function removeCardFromBinder(binderId, cardId) {
  const { error } = await supabase
    .from('user_binder_cards')
    .delete()
    .eq('binder_id', binderId)
    .eq('card_id', cardId);
  if (error) throw error;
}

// ═══ BP-0A4: global catalog helpers ══════════════════════════════════════════
// NOTE: these live here as Binder Planning catalog helpers for this slice —
// not necessarily their permanent architectural home. A later hygiene pass
// may move them into cardService.js once that file is in hand; nothing here
// modifies or assumes the unseen cardService internals. Both read
// cards_effective (the global catalog — deliberately roster-independent) and
// adapt rows through the existing supaRowToCard.

/** Global catalog search by card name. Ranking without RPC/schema work:
 *  query 1 takes prefix matches (which include exact matches) ordered by
 *  name then release_date; exact matches are floated to the top client-side.
 *  If the limit isn't filled, query 2 backfills with substring-only matches
 *  (ILIKE %q% excluding the prefix set). Soft-fails to null. */
export async function searchCatalogCards(query, limit = 24) {
  const q = (query || '').trim();
  if (q.length < 2) return [];
  try {
    const esc = q.replace(/[%_]/g, m => '\\' + m); // literal % / _ in user input
    const { data: prefixRows, error: e1 } = await supabase
      .from('cards_effective')
      .select(CARD_COLS)
      .ilike('name', `${esc}%`)
      .order('name', { ascending: true })
      .order('release_date', { ascending: true, nullsFirst: false })
      .limit(limit);
    if (e1) throw e1;
    let rows = prefixRows || [];
    if (rows.length < limit) {
      const { data: subRows, error: e2 } = await supabase
        .from('cards_effective')
        .select(CARD_COLS)
        .ilike('name', `%${esc}%`)
        .not('name', 'ilike', `${esc}%`)
        .order('name', { ascending: true })
        .order('release_date', { ascending: true, nullsFirst: false })
        .limit(limit - rows.length);
      if (e2) throw e2;
      rows = rows.concat(subRows || []);
    }
    const ql = q.toLowerCase();
    const rank = r => ((r.name || '').toLowerCase() === ql ? 0 : 1);
    // Stable partition: exact-name matches first, original tier order kept.
    rows = rows.filter(r => rank(r) === 0).concat(rows.filter(r => rank(r) === 1));
    return rows.map(supaRowToCard);
  } catch (e) {
    console.error('searchCatalogCards failed:', e);
    return null;
  }
}

/** Resolve arbitrary card ids against the catalog (chunked .in()). Returns
 *  whatever resolves — callers compare against the requested ids to detect
 *  orphans. Soft-fails to null. */
export async function fetchCardsByIds(ids) {
  if (!ids || !ids.length) return [];
  try {
    const out = [];
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const { data, error } = await supabase
        .from('cards_effective')
        .select(CARD_COLS)
        .in('id', chunk);
      if (error) throw error;
      (data || []).forEach(r => out.push(supaRowToCard(r)));
    }
    return out;
  } catch (e) {
    console.error('fetchCardsByIds failed:', e);
    return null;
  }
}
