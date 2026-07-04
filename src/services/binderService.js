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

const BINDER_COLS = 'id, name, description, created_at, updated_at';

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
