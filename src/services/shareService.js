// src/services/shareService.js
// Supabase RPC call for SharedBinder public reads.
// Source: index.legacy.html lines 314-318.
//
// Wiring note: legacy used global `sb`; module uses imported `supabase`.
// Do NOT change the RPC name or parameter name — they match a deployed function.

import { supabase } from './supabaseClient.js';

async function fetchSharedCollection(token) {
  const { data, error } = await supabase.rpc('get_shared_collection', { p_token: token });
  if (error || !data) return null;
  return data;
}

export { fetchSharedCollection };
