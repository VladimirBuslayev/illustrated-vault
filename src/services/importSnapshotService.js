// src/services/importSnapshotService.js
// OL-0C — writes an immutable Collectr import snapshot (OL-0B schema).
//
// SECONDARY, non-atomic path. It NEVER reads, writes, or rolls back
// user_collection.owned_keys. The caller runs the (unchanged) owned_keys import
// first and primary; this service only persists the enumeration snapshot.
//
// Lifecycle (matches ol-0b-1-user-import-snapshots.sql):
//   1. insert one user_import_batches row (status 'processing', declared counts);
//   2. insert immutable user_import_rows in safe chunks (BEFORE-INSERT guard
//      enforces processing+ownership per row);
//   3. activate_import_batch() — server-side reconciles counts, supersedes the
//      prior active, and activates atomically;
//   4. on ANY failure after batch creation → fail_import_batch(); the previous
//      active snapshot is left intact and no partial batch is ever active.
//
// This function does not claim fail_import_batch() unwinds owned_keys — it does
// not. On failure it returns an explicit failed result for the caller to surface
// as partial success (ownership updated; snapshot failed; retryable).
//
// Default client imported lazily so the service is unit-testable with a mock.

const DEFAULT_CHUNK = 500;

async function defaultClient() {
  return (await import('./supabaseClient.js')).supabase;
}

function toBatchRow(userId, matcherVersion, c) {
  return {
    user_id: userId,
    source: 'collectr',
    status: 'processing',
    matcher_version: matcherVersion,
    total_source_rows: c.total_source_rows,
    pokemon_rows: c.pokemon_rows,
    non_pokemon_rows: c.non_pokemon_rows,
    positive_qty_rows: c.positive_qty_rows,
    watchlist_only_rows: c.watchlist_only_rows,
    invalid_quantity_rows: c.invalid_quantity_rows,
    stored_rows: c.stored_rows,
    matched_rows: c.matched_rows,
    ambiguous_rows: c.ambiguous_rows,
    unmatched_rows: c.unmatched_rows,
    invalid_rows: c.invalid_rows,
  };
}

// Shape one stored row to satisfy uir_status_shape + uir_candidates_shape.
function toImportRow(batchId, r) {
  const base = {
    batch_id: batchId,
    source_row_number: r.sourceRowNumber,
    product_name: r.productName ?? '',
    set_name: r.setName ?? '',
    card_number: r.cardNumber ?? '',
    variance: r.variance ?? '',
    rarity: r.rarity ?? '',
    quantity: r.quantity,
    match_status: r.matchStatus,
  };
  if (r.matchStatus === 'matched') {
    base.card_id = r.cardId;
    base.match_rule = r.matchRule;
    base.match_reason = null;
    base.candidate_card_ids = null;
  } else {
    base.card_id = null;
    base.match_rule = null;
    base.match_reason = r.matchReason;
    base.candidate_card_ids = (r.matchStatus === 'ambiguous' && Array.isArray(r.candidateCardIds) && r.candidateCardIds.length)
      ? r.candidateCardIds.slice(0, 6)
      : null;
  }
  return base;
}

// classified: { stored, counts } from classifyCollectrRows.
// Returns { status: 'active'|'failed', batchId, counts?, stage?, error?, failError? }.
export async function createImportSnapshot({ client, userId, matcherVersion, classified, chunkSize = DEFAULT_CHUNK }) {
  if (!userId) throw new Error('createImportSnapshot: userId required');
  if (!classified || !Array.isArray(classified.stored) || !classified.counts) {
    throw new Error('createImportSnapshot: classified { stored, counts } required');
  }
  const db = client || (await defaultClient());
  const { stored, counts } = classified;

  // 1. create the processing batch. RLS permits insert only when status='processing'.
  const ins = await db.from('user_import_batches')
    .insert(toBatchRow(userId, matcherVersion, counts))
    .select('id')
    .single();
  if (ins.error || !ins.data) {
    // Nothing to fail yet — no processing batch exists.
    return { status: 'failed', batchId: null, stage: 'create_batch', error: ins.error || new Error('no batch id returned') };
  }
  const batchId = ins.data.id;

  try {
    // 2. chunked immutable row insert.
    for (let i = 0; i < stored.length; i += chunkSize) {
      const chunk = stored.slice(i, i + chunkSize).map(r => toImportRow(batchId, r));
      const res = await db.from('user_import_rows').insert(chunk);
      if (res.error) throw Object.assign(new Error('row insert failed'), { stage: 'insert_rows', cause: res.error });
    }
    // 3. atomic activation (server reconciles counts + supersedes prior active).
    const act = await db.rpc('activate_import_batch', { p_batch_id: batchId });
    if (act.error) throw Object.assign(new Error('activation failed'), { stage: 'activate', cause: act.error });

    return { status: 'active', batchId, counts };
  } catch (e) {
    // 4. fail the processing batch. Prior active snapshot is untouched.
    let failError = null;
    try {
      const f = await db.rpc('fail_import_batch', { p_batch_id: batchId });
      if (f && f.error) failError = f.error;
    } catch (fe) {
      failError = fe;
    }
    return { status: 'failed', batchId, stage: e.stage || 'unknown', error: e.cause || e, failError };
  }
}
