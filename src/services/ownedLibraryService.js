// src/services/ownedLibraryService.js
// OL-0D — Active Snapshot Read Model client.
//
// Wraps the read-only RPC get_active_import_snapshot_read_model, normalizes its
// response to the OL-0D camelCase contract (contractVersion 1), and passes
// available catalog rows through the EXISTING card adapter (supaRowToCard) so
// nothing here invents a second frontend card shape.
//
// This service is READ-ONLY. It never touches owned_keys, manual overrides,
// intent, favorites, or binder state. It exposes two distinct reads:
//   - fetchActiveSnapshotReadModel: the paginated Owned Library (OL-1) read.
//     It backs the Owned Library surface only and is NOT the app-wide ownership
//     source (it is filtered/paginated and joins the catalog).
//   - fetchActiveSnapshotOwnedCardIds: the separate OWN-0A authoritative read
//     returning the active batch's complete distinct set of matched canonical
//     card_ids (see its own doc block below). This is the printing-exact
//     ownership source OWN-0B will consume; OWN-0A only dark-loads it.
//
// It NEVER soft-fails to an empty collection:
//   - Supabase / RPC errors throw.
//   - Malformed or unsupported contract responses throw.
//   - no_active_batch and snapshot_changed are returned as explicit states.
//
// Integer discipline is STRICT: every count/quantity must be a safe,
// non-negative integer (Number.isSafeInteger). Decimals, unsafe integers,
// strings, negatives, NaN, and Infinity all throw — nothing is coerced or
// truncated.
//
// The default Supabase client is imported lazily (mirroring importSnapshotService),
// so the module is unit-testable with an injected mock and no network.

import { supaRowToCard } from './cardAdapter.js';

const RPC_NAME = 'get_active_import_snapshot_read_model';
const CONTRACT_VERSION = 1;

const STATES = new Set(['ready', 'no_active_batch', 'snapshot_changed']);
const CATALOG_STATUS_ARGS = new Set(['all', 'available', 'missing']);
const SORTS = new Set(['name_asc', 'set_asc', 'quantity_desc']);
const UNRESOLVED_STATUSES = new Set(['ambiguous', 'unmatched', 'invalid']);

const DEFAULTS = { limit: 60, offset: 0, catalogStatus: 'all', sort: 'name_asc' };

const SUMMARY_KEYS = [
  'totalSourceRows', 'pokemonRows', 'positiveQuantityRows', 'storedRows', 'matchedRows',
  'ambiguousRows', 'unmatchedRows', 'invalidRows', 'watchlistOnlyRows', 'nonPokemonRows',
  'invalidQuantityRows', 'matchedQuantity', 'distinctCanonicalCards', 'unresolvedRows',
  'unresolvedQuantity', 'catalogMissingCards', 'catalogMissingQuantity',
];

async function defaultClient() {
  return (await import('./supabaseClient.js')).supabase;
}

function fail(msg) {
  throw new Error(`ownedLibraryService: ${msg}`);
}

function isObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Strict safe non-negative integer. Rejects non-numbers, decimals, unsafe
// integers (> 2^53-1), NaN, Infinity, and negatives. Never truncates.
function asInt(v, label) {
  if (!Number.isSafeInteger(v) || v < 0) {
    fail(`${label} must be a safe non-negative integer (got ${JSON.stringify(v)})`);
  }
  return v;
}

function asStr(v, label, { allowEmpty = true } = {}) {
  if (typeof v !== 'string') fail(`${label} must be a string (got ${JSON.stringify(v)})`);
  if (!allowEmpty && v.length === 0) fail(`${label} must be non-empty`);
  return v;
}

// Non-empty, parseable timestamp string.
function asTimestamp(v, label) {
  if (typeof v !== 'string' || v.length === 0) {
    fail(`${label} must be a non-empty timestamp string (got ${JSON.stringify(v)})`);
  }
  if (Number.isNaN(Date.parse(v))) {
    fail(`${label} must be a valid timestamp string (got ${JSON.stringify(v)})`);
  }
  return v;
}

// Map service options -> RPC p_* args. Mirrors the RPC defaults so we never send
// null for the constrained args (which the RPC would reject). limit/offset are
// validated strictly on the client BEFORE the RPC round-trip.
function toArgs(options) {
  const limit = options.limit ?? DEFAULTS.limit;
  const offset = options.offset ?? DEFAULTS.offset;
  const catalogStatus = options.catalogStatus ?? DEFAULTS.catalogStatus;
  const sort = options.sort ?? DEFAULTS.sort;

  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    fail(`invalid limit ${JSON.stringify(limit)} (must be a safe integer 1..100)`);
  }
  if (!Number.isSafeInteger(offset) || offset < 0) {
    fail(`invalid offset ${JSON.stringify(offset)} (must be a safe integer >= 0)`);
  }
  if (!CATALOG_STATUS_ARGS.has(catalogStatus)) fail(`invalid catalogStatus "${catalogStatus}"`);
  if (!SORTS.has(sort)) fail(`invalid sort "${sort}"`);

  return {
    p_expected_batch_id: options.expectedBatchId ?? null,
    p_limit: limit,
    p_offset: offset,
    p_search: options.search ?? null,
    p_set_id: options.setId ?? null,
    p_artist_id: options.artistId ?? null,
    p_catalog_status: catalogStatus,
    p_sort: sort,
  };
}

function normalizeFallback(raw, i) {
  if (!isObj(raw)) fail(`page.items[${i}].fallback must be an object`);
  // All five fields must be present strings. No invented empty-string defaults.
  return {
    productName: asStr(raw.productName, `page.items[${i}].fallback.productName`),
    setName: asStr(raw.setName, `page.items[${i}].fallback.setName`),
    cardNumber: asStr(raw.cardNumber, `page.items[${i}].fallback.cardNumber`),
    variance: asStr(raw.variance, `page.items[${i}].fallback.variance`),
    rarity: asStr(raw.rarity, `page.items[${i}].fallback.rarity`),
  };
}

function normalizeItem(raw, i) {
  if (!isObj(raw)) fail(`page.items[${i}] must be an object`);

  const catalogStatus = asStr(raw.catalogStatus, `page.items[${i}].catalogStatus`);
  if (catalogStatus !== 'available' && catalogStatus !== 'missing') {
    fail(`page.items[${i}].catalogStatus must be available|missing (got ${catalogStatus})`);
  }

  const cardId = asStr(raw.cardId, `page.items[${i}].cardId`, { allowEmpty: false });

  let card = null;
  if (catalogStatus === 'available') {
    if (!isObj(raw.card)) fail(`page.items[${i}].card is required when catalogStatus is available`);
    // The raw catalog id must equal the item's canonical cardId BEFORE adaptation.
    const rawCardId = asStr(raw.card.id, `page.items[${i}].card.id`, { allowEmpty: false });
    if (rawCardId !== cardId) {
      fail(`page.items[${i}].card.id (${rawCardId}) must equal cardId (${cardId})`);
    }
    card = supaRowToCard(raw.card);
  } else {
    // missing items MUST carry an explicit null card.
    if (raw.card !== null) {
      fail(`page.items[${i}].card must be null when catalogStatus is missing (got ${JSON.stringify(raw.card)})`);
    }
  }

  return {
    cardId,
    quantity: asInt(raw.quantity, `page.items[${i}].quantity`),
    sourceRowCount: asInt(raw.sourceRowCount, `page.items[${i}].sourceRowCount`),
    firstSourceRow: asInt(raw.firstSourceRow, `page.items[${i}].firstSourceRow`),
    catalogStatus,
    card,
    fallback: normalizeFallback(raw.fallback, i),
  };
}

function normalizeReady(data) {
  const b = data.batch;
  const s = data.summary;
  const u = data.unresolved;
  const p = data.page;

  if (!isObj(b)) fail('batch missing or malformed');
  if (!isObj(s)) fail('summary missing or malformed');
  if (!isObj(u) || !Array.isArray(u.groups)) fail('unresolved.groups missing or malformed');
  if (!isObj(p) || !Array.isArray(p.items)) fail('page.items missing or malformed');

  const summary = {};
  for (const k of SUMMARY_KEYS) summary[k] = asInt(s[k], `summary.${k}`);

  const groups = u.groups.map((g, i) => {
    if (!isObj(g)) fail(`unresolved.groups[${i}] must be an object`);
    const status = asStr(g.status, `unresolved.groups[${i}].status`);
    if (!UNRESOLVED_STATUSES.has(status)) fail(`unresolved.groups[${i}].status invalid (${status})`);
    return {
      status,
      reason: asStr(g.reason, `unresolved.groups[${i}].reason`),
      rowCount: asInt(g.rowCount, `unresolved.groups[${i}].rowCount`),
      quantity: asInt(g.quantity, `unresolved.groups[${i}].quantity`),
    };
  });

  const items = p.items.map(normalizeItem);

  const limit = asInt(p.limit, 'page.limit');
  const offset = asInt(p.offset, 'page.offset');
  const totalItems = asInt(p.totalItems, 'page.totalItems');
  const returnedItems = asInt(p.returnedItems, 'page.returnedItems');

  if (returnedItems !== items.length) {
    fail(`page.returnedItems (${returnedItems}) must equal page.items.length (${items.length})`);
  }
  if (returnedItems > limit) {
    fail(`page.returnedItems (${returnedItems}) must be <= page.limit (${limit})`);
  }
  if (returnedItems > totalItems) {
    fail(`page.returnedItems (${returnedItems}) must be <= page.totalItems (${totalItems})`);
  }

  return {
    contractVersion: CONTRACT_VERSION,
    state: 'ready',
    batch: {
      id: asStr(b.id, 'batch.id', { allowEmpty: false }),
      source: asStr(b.source, 'batch.source', { allowEmpty: false }),
      matcherVersion: asStr(b.matcherVersion, 'batch.matcherVersion', { allowEmpty: false }),
      createdAt: asTimestamp(b.createdAt, 'batch.createdAt'),
      activatedAt: asTimestamp(b.activatedAt, 'batch.activatedAt'),
    },
    summary,
    unresolved: { groups },
    page: { limit, offset, totalItems, returnedItems, items },
  };
}

// options: { client?, expectedBatchId?, limit?, offset?, search?, setId?,
//            artistId?, catalogStatus?, sort? }
// Returns a normalized { ready | no_active_batch | snapshot_changed } object.
export async function fetchActiveSnapshotReadModel(options = {}) {
  const args = toArgs(options); // client-side validation before any round-trip
  const db = options.client || (await defaultClient());

  // Supabase does not throw on query errors — inspect error explicitly.
  const { data, error } = await db.rpc(RPC_NAME, args);
  if (error) {
    // OL-1.2: preserve the PostgREST error fields on the thrown Error for the
    // post-import diagnostic path. This does NOT change the read-model contract:
    // the message format is unchanged, and the returned shape / states / strict
    // normalization are untouched. These are diagnostic own-properties only.
    const e = new Error(`ownedLibraryService: RPC error: ${error.message || error}`);
    e.rpcCode = error.code ?? null;
    e.rpcDetails = error.details ?? null;
    e.rpcHint = error.hint ?? null;
    e.rpcMessage = error.message ?? null;
    throw e;
  }

  if (!isObj(data)) fail('RPC returned a non-object payload');
  if (data.contractVersion !== CONTRACT_VERSION) {
    fail(`unsupported contractVersion ${JSON.stringify(data.contractVersion)}`);
  }
  const state = data.state;
  if (!STATES.has(state)) fail(`unsupported state ${JSON.stringify(state)}`);

  if (state === 'no_active_batch') {
    return { contractVersion: CONTRACT_VERSION, state };
  }
  if (state === 'snapshot_changed') {
    return {
      contractVersion: CONTRACT_VERSION,
      state,
      activeBatchId: asStr(data.activeBatchId, 'activeBatchId', { allowEmpty: false }),
    };
  }
  return normalizeReady(data);
}

// ─────────────────────────────────────────────────────────────────────────────
// OWN-0A — Authoritative Snapshot Ownership Read client.
//
// Wraps the read-only, purpose-built RPC get_active_snapshot_owned_card_ids(),
// which returns — atomically for the caller's single active batch — the complete
// distinct set of MATCHED canonical card_ids plus minimal row/count reconciliation.
// This is the printing-exact ownership source that OWN-0B will feed to checkOwned.
//
// Distinct from fetchActiveSnapshotReadModel: no pagination, no filters, and no
// cards_effective catalog join. It never returns catalog availability — a matched
// id is owned whether or not it renders as a catalog tile.
//
// Strictness matches the read-model client: Supabase/RPC errors throw (with the
// PostgREST diagnostic fields preserved), malformed/unsupported contract responses
// throw, and it NEVER soft-fails to an empty owned set. States are returned
// explicitly. On "ready", ownedCardIds is a Set<string> and
// ownedCardIds.size === reconciliation.distinctMatchedCardIds is enforced.

const OWNED_IDS_RPC = 'get_active_snapshot_owned_card_ids';
const OWNED_IDS_STATES = new Set([
  'ready', 'no_active_batch', 'multiple_active_batches', 'error',
]);

// options: { client? }  (client injectable for unit tests; default lazy import)
// Returns one of:
//   { contractVersion, state:'ready', batchId, activatedAt, matcherVersion,
//     ownedCardIds:Set<string>, reconciliation:{ distinctMatchedCardIds, matchedRows } }
//   { contractVersion, state:'no_active_batch' }
//   { contractVersion, state:'multiple_active_batches' }
//   { contractVersion, state:'error', reason }
export async function fetchActiveSnapshotOwnedCardIds(options = {}) {
  const db = options.client || (await defaultClient());

  // Supabase does not throw on query errors — inspect error explicitly and
  // preserve the PostgREST fields on the thrown Error (diagnostic path).
  const { data, error } = await db.rpc(OWNED_IDS_RPC);
  if (error) {
    const e = new Error(`ownedLibraryService: owned-ids RPC error: ${error.message || error}`);
    e.rpcCode = error.code ?? null;
    e.rpcDetails = error.details ?? null;
    e.rpcHint = error.hint ?? null;
    e.rpcMessage = error.message ?? null;
    throw e;
  }

  if (!isObj(data)) fail('owned-ids RPC returned a non-object payload');
  if (data.contractVersion !== CONTRACT_VERSION) {
    fail(`owned-ids: unsupported contractVersion ${JSON.stringify(data.contractVersion)}`);
  }
  const state = data.state;
  if (!OWNED_IDS_STATES.has(state)) fail(`owned-ids: unsupported state ${JSON.stringify(state)}`);

  if (state === 'no_active_batch' || state === 'multiple_active_batches') {
    return { contractVersion: CONTRACT_VERSION, state };
  }
  if (state === 'error') {
    return { contractVersion: CONTRACT_VERSION, state, reason: asStr(data.reason ?? '', 'owned-ids.reason') };
  }

  // state === 'ready'
  const rawIds = data.ownedCardIds;
  if (!Array.isArray(rawIds)) fail('owned-ids: ownedCardIds must be an array');
  const ownedCardIds = new Set();
  for (let i = 0; i < rawIds.length; i++) {
    const id = asStr(rawIds[i], `owned-ids.ownedCardIds[${i}]`, { allowEmpty: false });
    if (ownedCardIds.has(id)) fail(`owned-ids: duplicate card id ${JSON.stringify(id)}`);
    ownedCardIds.add(id);
  }

  const r = data.reconciliation;
  if (!isObj(r)) fail('owned-ids: reconciliation missing or malformed');
  const distinctMatchedCardIds = asInt(r.distinctMatchedCardIds, 'owned-ids.reconciliation.distinctMatchedCardIds');
  const matchedRows = asInt(r.matchedRows, 'owned-ids.reconciliation.matchedRows');

  if (rawIds.length !== distinctMatchedCardIds) {
    fail(`owned-ids: ownedCardIds length (${rawIds.length}) must equal distinctMatchedCardIds (${distinctMatchedCardIds})`);
  }
  if (ownedCardIds.size !== distinctMatchedCardIds) {
    fail(`owned-ids: distinct ownedCardIds (${ownedCardIds.size}) must equal distinctMatchedCardIds (${distinctMatchedCardIds})`);
  }
  if (matchedRows < distinctMatchedCardIds) {
    fail(`owned-ids: matchedRows (${matchedRows}) must be >= distinctMatchedCardIds (${distinctMatchedCardIds})`);
  }

  return {
    contractVersion: CONTRACT_VERSION,
    state,
    batchId: asStr(data.batchId, 'owned-ids.batchId', { allowEmpty: false }),
    activatedAt: asTimestamp(data.activatedAt, 'owned-ids.activatedAt'),
    matcherVersion: asStr(data.matcherVersion, 'owned-ids.matcherVersion', { allowEmpty: false }),
    ownedCardIds,
    reconciliation: { distinctMatchedCardIds, matchedRows },
  };
}
