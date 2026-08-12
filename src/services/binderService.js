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
import { isTcgPocketCard } from '../utils/cardUtils.js'; // BP-1G: the ONE production Pocket predicate

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

/** Update a binder's name/description. Same normalization as createBinder:
 *  trims both, empty-after-trim description → null. updated_at is refreshed
 *  by the iv_touch_updated_at trigger — never set client-side. Binder id and
 *  memberships are untouched. Throws on failure; returns the updated row. */
export async function updateBinder(userId, binderId, { name, description }) {
  const cleanName = (name || '').trim();
  const cleanDesc = (description || '').trim();
  if (!cleanName) throw new Error('Binder name is required.');
  if (cleanName.length > 80) throw new Error('Binder name is too long (80 characters max).');
  if (cleanDesc.length > 280) throw new Error('Description is too long (280 characters max).');
  const { data, error } = await supabase
    .from('user_binders')
    .update({ name: cleanName, description: cleanDesc || null })
    .eq('id', binderId)
    .eq('user_id', userId)
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

/** Ordered card_id list for a binder. Soft-fails to null.
 *
 *  BP-1B: read order is now the collector-authored sequence —
 *  position ASC, created_at ASC, id ASC. The three keys together are a
 *  guaranteed TOTAL order, which the previous single created_at key was not:
 *  two rows sharing a timestamp had no defined sequence. position carries the
 *  intent; created_at and id only break ties deterministically.
 *
 *  REQUIRES the BP-1A migration. Without the position column this select
 *  errors and the function soft-fails to null, which the UI renders as a
 *  retryable load failure — so the migration MUST deploy before this file.
 *
 *  Public return contract is unchanged: string[] of card_ids, or null. */
export async function fetchBinderCardIds(binderId) {
  try {
    const { data, error } = await supabase
      .from('user_binder_cards')
      .select('card_id, position, created_at, id')
      .eq('binder_id', binderId)
      .order('position',   { ascending: true })
      .order('created_at', { ascending: true })
      .order('id',         { ascending: true });
    if (error) throw error;
    return (data || []).map(r => r.card_id);
  } catch (e) {
    console.error('fetchBinderCardIds failed:', e);
    return null;
  }
}

/** BP-3.1B: membership rows WITH their stable identity.
 *
 *  fetchBinderCardIds answers "which cards are in this plan". This answers
 *  "which membership ROWS are in this plan", which is a different question and
 *  the one physical page placement needs: user_binder_layout_items references
 *  user_binder_cards.id, not card_id. The card id is not a usable placement key
 *  — nothing prevents the same illustration entering a plan through a different
 *  membership row later, and a placement must point at exactly one row.
 *
 *  Ordering is IDENTICAL to fetchBinderCardIds (position ASC, created_at ASC,
 *  id ASC) so the two reads describe the same sequence. position is carried
 *  through as the manual LIST order only — it is never a page or pocket number,
 *  and must not be reinterpreted as one.
 *
 *  Return contract matches the rest of this file:
 *    null   the read FAILED. Nothing is known about membership.
 *    []     the read SUCCEEDED and the plan is genuinely empty.
 *
 *  @returns {Promise<Array<{binderCardId:string,cardId:string,position:number}>|null>}
 */
export async function fetchBinderMembers(binderId) {
  try {
    const { data, error } = await supabase
      .from('user_binder_cards')
      .select('id, card_id, position, created_at')
      .eq('binder_id', binderId)
      .order('position',   { ascending: true })
      .order('created_at', { ascending: true })
      .order('id',         { ascending: true });
    if (error) throw error;
    return (data || []).map(r => ({
      binderCardId: r.id,
      cardId: r.card_id,
      position: r.position,
    }));
  } catch (e) {
    console.error('fetchBinderMembers failed:', e);
    return null; // null = read failed (distinct from a genuinely empty [])
  }
}

/** BP-2: which of the caller's binders already contain this EXACT card id.
 *
 *  One indexed read against the child table, filtered by card_id alone. No
 *  user id is sent and none is needed: user_binder_cards has no user_id column
 *  and its RLS policies resolve ownership through the parent binder, so a
 *  caller can only ever see rows belonging to their own binders. This is the
 *  same boundary fetchBinderCardIds already relies on.
 *
 *  Deliberately NOT "fetch every plan's membership and intersect": that is one
 *  round trip per plan and grows with the collection. This is one round trip
 *  whose result size is bounded by the number of plans containing the card.
 *
 *  Return contract mirrors fetchBinderCardIds and fetchCardsByIds — the two
 *  non-happy outcomes are DIFFERENT:
 *    null   the read FAILED. Nothing is known. This is NOT evidence that the
 *           card is absent from every plan, and must never render as "not
 *           added anywhere".
 *    []     the read SUCCEEDED and the card is genuinely in no plan.
 *
 *  Order is not meaningful; duplicates are impossible (unique constraint) but
 *  are collapsed anyway so the caller can build a Set directly. */
export async function fetchBinderIdsContainingCard(cardId) {
  if (!cardId) return [];
  try {
    const { data, error } = await supabase
      .from('user_binder_cards')
      .select('binder_id')
      .eq('card_id', cardId);
    if (error) throw error;
    return Array.from(new Set((data || []).map(r => r.binder_id)));
  } catch (e) {
    console.error('fetchBinderIdsContainingCard failed:', e);
    return null; // null = read failed (distinct from a genuinely empty [])
  }
}

/** Add a card to a binder. Returns true on insert, false when the card was
 *  already a member (unique constraint 23505 — treated as a soft no-op, not
 *  an error). Throws on any other failure. Touches nothing but
 *  user_binder_cards — never hunt intent, favorites, or ownership. */
export async function addCardToBinder(binderId, cardId, card = null) {
  // BP-1G: TCG Pocket cards are excluded from NEW membership on every path
  // through this service, not only from search results. The test is the single
  // production predicate isTcgPocketCard — no second heuristic is introduced
  // here. When the caller already holds the adapted card (the plan search
  // surface always does) no extra round trip is made; otherwise the row is
  // resolved once so a direct service call cannot bypass the rule.
  //
  // A cardId that resolves to NOTHING is deliberately still insertable:
  // membership must survive catalog absence, and refusing here would make an
  // unavailable catalog row silently unaddable.
  let subject = card;
  if (!subject) {
    const { data, error: lookupError } = await supabase
      .from('cards_effective')
      .select(CARD_COLS)
      .eq('id', cardId)
      .maybeSingle();
    if (lookupError) throw lookupError;
    subject = data ? supaRowToCard(data) : null;
  }
  if (subject && isTcgPocketCard(subject)) {
    throw new Error('TCG Pocket cards cannot be added to a planned binder.');
  }
  // position is intentionally omitted: the BP-1A BEFORE INSERT trigger assigns
  // it under a parent-binder lock, so an unpositioned row is unrepresentable.
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

/** BP-1B: persist a whole-binder manual order through the reorder_binder_cards
 *  RPC. orderedCardIds must be an EXACT permutation of the binder's current
 *  membership — the RPC verifies this under a parent-row lock and raises rather
 *  than partially applying, so there is no half-reordered state to reconcile.
 *
 *  No user id is sent: the RPC derives the caller from auth.uid().
 *  Write convention — throws on failure; the caller restores its previous
 *  order. Returns the number of rows repositioned. */
export async function reorderBinderCards(binderId, orderedCardIds) {
  if (!binderId) throw new Error('reorderBinderCards: binderId is required.');
  if (!Array.isArray(orderedCardIds)) {
    throw new Error('reorderBinderCards: orderedCardIds must be an array.');
  }
  const { data, error } = await supabase.rpc('reorder_binder_cards', {
    p_binder_id: binderId,
    p_card_ids: orderedCardIds,
  });
  if (error) throw error;
  return data;
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
    // BP-1G: each tier is over-fetched, then adapted, then filtered through the
    // production isTcgPocketCard predicate. Filtering AFTER adaptation is what
    // lets us reuse that one predicate instead of inventing an image_url SQL
    // heuristic that would have to stay in sync with it. The over-fetch is a
    // fetch-size detail only: the returned contract is still at most `limit`
    // cards, in the same tier order as before.
    const over = Math.min(limit * 3, 100);
    const { data: prefixRows, error: e1 } = await supabase
      .from('cards_effective')
      .select(CARD_COLS)
      .ilike('name', `${esc}%`)
      .order('name', { ascending: true })
      .order('release_date', { ascending: true, nullsFirst: false })
      .limit(over);
    if (e1) throw e1;
    let rows = (prefixRows || []).map(supaRowToCard).filter(c => !isTcgPocketCard(c));
    if (rows.length < limit) {
      const { data: subRows, error: e2 } = await supabase
        .from('cards_effective')
        .select(CARD_COLS)
        .ilike('name', `%${esc}%`)
        .not('name', 'ilike', `${esc}%`)
        .order('name', { ascending: true })
        .order('release_date', { ascending: true, nullsFirst: false })
        .limit(over);
      if (e2) throw e2;
      rows = rows.concat((subRows || []).map(supaRowToCard).filter(c => !isTcgPocketCard(c)));
    }
    const ql = q.toLowerCase();
    const rank = c => ((c.name || '').toLowerCase() === ql ? 0 : 1);
    // Stable partition: exact-name matches first, original tier order kept.
    rows = rows.filter(c => rank(c) === 0).concat(rows.filter(c => rank(c) === 1));
    return rows.slice(0, limit);
  } catch (e) {
    console.error('searchCatalogCards failed:', e);
    return null;
  }
}

/** Resolve arbitrary card ids against the catalog (chunked .in()). Returns
 *  whatever resolves — callers compare against the requested ids to detect
 *  orphans. Soft-fails to null.
 *
 *  BP-1A — the two non-happy outcomes are DIFFERENT and callers must treat
 *  them differently:
 *    null            the read FAILED. Nothing is known about any id. This is
 *                    NOT evidence that any card is missing from the catalog.
 *    shorter array   the read SUCCEEDED and the absent ids are genuine
 *                    orphans.
 *  Conflating the two is what made a transient network error render as
 *  "no longer in the catalog". Do not reintroduce it.
 *
 *  Order is NOT preserved: chunks are unordered and concatenated. Callers that
 *  need membership order re-project through the requested id array. */
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
