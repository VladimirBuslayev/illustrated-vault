// ── binderLayoutService.js ────────────────────────────────────────────────────
// BP-3.1B: the ONLY frontend seam for the BP-3 page-layout RPC surface.
//
// Authority boundaries (locked by BP-3.1A and not reinterpreted here):
//   user_binder_cards            exact Binder Plan membership
//   user_binder_cards.position   manual LIST order only — never page placement
//   user_binder_layouts / _items page-placement layer only
//   ownership / Hunt intent      untouched by anything in this file
//
// This slice implements the READ only. create / save / theme / reset RPCs are
// deliberately absent: nothing in this module can mutate a layout.
//
// Read convention (matching binderService.js): soft-fail. The UI never sees a
// throw from here; it sees one of three closed outcomes, and the two non-happy
// ones are DIFFERENT and must stay different:
//
//   { status:"ready",  layout:null }    the read SUCCEEDED and this binder
//                                       genuinely has no layout yet. This is
//                                       the first-use state.
//   { status:"ready",  layout:{…} }     the read SUCCEEDED and the document
//                                       passed strict normalization.
//   { status:"failed" }                 NOTHING is known. This is NOT evidence
//                                       that a layout is absent and must never
//                                       render as first-use setup.
//
// A malformed-but-successful RPC response is a READ FAILURE, not a repairable
// document. Nothing here coerces a value, defaults a theme, or drops a bad
// placement: a layout we cannot trust in full is a layout we do not render at
// all, because the alternative is silently arranging a collector's physical
// pages from a document we already know is wrong.

import { supabase } from './supabaseClient.js';

// ── BP-3.1A contract constants ───────────────────────────────────────────────
// These MUST stay in lockstep with the CHECK constraints in
// bp-3-1a-binder-page-layout-foundation.sql. They are duplicated here on
// purpose: the client is validating a response it did not produce, so it needs
// its own copy of the contract rather than trusting the sender's.
const CONTRACT_VERSION = 1;

const FORMAT_POCKETS = { '3x3': 9, '3x4': 12, '4x4': 16 };

const THEMES = new Set([
  'charcoal', 'warm-black', 'deep-plum', 'midnight-navy',
  'forest', 'burgundy', 'sand', 'soft-stone',
]);

const FAILED = Object.freeze({ status: 'failed' });
const NO_LAYOUT = Object.freeze({ status: 'ready', layout: null });

const isSafeIntAtLeast1 = v => Number.isSafeInteger(v) && v >= 1;
const isNonEmptyString = v => typeof v === 'string' && v.trim().length > 0;

// UUID comparison hygiene only — both sides are Postgres-issued uuids and are
// already lowercase. Trim/lowercase makes the equality check robust without
// altering, replacing, or storing anything from the response.
const sameId = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

/** Strict normalization of the canonical BP-3.1A document.
 *
 *  Returns a NEW object built field by field from validated input — never the
 *  RPC payload itself — so no unvalidated key can reach the UI by riding along
 *  inside the response.
 *
 *  Returns null when the document is malformed in ANY respect. The caller turns
 *  that into { status:"failed" }.
 *
 *  @param {*} doc            raw jsonb payload from fetch_binder_page_layout
 *  @param {string} binderId  the binder the caller ASKED for
 */
function normalizeLayoutDocument(doc, binderId) {
  const bad = reason => {
    console.error('binderLayoutService: malformed layout document —', reason);
    return null;
  };

  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return bad('not an object');

  if (doc.contractVersion !== CONTRACT_VERSION) return bad(`contractVersion ${doc.contractVersion}`);
  if (!isNonEmptyString(doc.layoutId)) return bad('layoutId');
  if (!isNonEmptyString(doc.binderId)) return bad('binderId');
  // A document for a DIFFERENT binder is a failure, not a document to render.
  if (!sameId(doc.binderId, binderId)) return bad(`binderId mismatch (asked ${binderId}, got ${doc.binderId})`);

  const pocketCeiling = Object.prototype.hasOwnProperty.call(FORMAT_POCKETS, doc.formatKey)
    ? FORMAT_POCKETS[doc.formatKey]
    : null;
  if (pocketCeiling === null) return bad(`formatKey ${doc.formatKey}`);

  if (typeof doc.backgroundTheme !== 'string' || !THEMES.has(doc.backgroundTheme)) {
    return bad(`backgroundTheme ${doc.backgroundTheme}`); // never silently fall back to charcoal
  }

  if (!isSafeIntAtLeast1(doc.pageCount)) return bad(`pageCount ${doc.pageCount}`);

  if (!Array.isArray(doc.placements)) return bad('placements is not an array');

  // updatedAt is not part of the mandated validation set. It is accepted only as
  // a string; a non-string is treated as malformed rather than coerced, and an
  // absent value normalizes to null (it is display metadata, not authority).
  let updatedAt = null;
  if (doc.updatedAt !== undefined && doc.updatedAt !== null) {
    if (typeof doc.updatedAt !== 'string') return bad('updatedAt is not a string');
    updatedAt = doc.updatedAt;
  }

  const seenCards = new Set();
  const seenSlots = new Set();
  const placements = [];

  for (let i = 0; i < doc.placements.length; i += 1) {
    const p = doc.placements[i];
    if (!p || typeof p !== 'object' || Array.isArray(p)) return bad(`placement ${i} is not an object`);
    if (!isNonEmptyString(p.binderCardId)) return bad(`placement ${i} binderCardId`);
    if (!isSafeIntAtLeast1(p.page)) return bad(`placement ${i} page ${p.page}`);
    if (!isSafeIntAtLeast1(p.pocket)) return bad(`placement ${i} pocket ${p.pocket}`);
    if (p.page > doc.pageCount) return bad(`placement ${i} page ${p.page} exceeds pageCount ${doc.pageCount}`);
    if (p.pocket > pocketCeiling) return bad(`placement ${i} pocket ${p.pocket} exceeds ${doc.formatKey} ceiling ${pocketCeiling}`);

    // One membership row can occupy at most one pocket, and one pocket can hold
    // at most one membership row. Either violation makes the whole document
    // unrenderable: there is no correct way to choose which duplicate wins.
    if (seenCards.has(p.binderCardId)) return bad(`duplicate binderCardId ${p.binderCardId}`);
    seenCards.add(p.binderCardId);

    const slot = `${p.page}:${p.pocket}`;
    if (seenSlots.has(slot)) return bad(`duplicate page/pocket ${slot}`);
    seenSlots.add(slot);

    placements.push({ binderCardId: p.binderCardId, page: p.page, pocket: p.pocket });
  }

  return {
    contractVersion: CONTRACT_VERSION,
    layoutId: doc.layoutId,
    binderId: doc.binderId,
    formatKey: doc.formatKey,
    backgroundTheme: doc.backgroundTheme,
    pageCount: doc.pageCount,
    updatedAt,
    placements,
  };
}

/** Read the page layout for one binder through fetch_binder_page_layout.
 *
 *  The RPC is STABLE and returns ONE coherent snapshot: ownership, layout
 *  metadata and placements can never be assembled from different moments. Do
 *  not batch this call into the same SQL statement as a future write RPC.
 *
 *  Backend SQLSTATEs (28000 unauthenticated, 42501 foreign/nonexistent binder,
 *  22023 bad argument) all arrive as PostgREST errors and all resolve to
 *  { status:"failed" } with the diagnostic in console only — user-facing copy
 *  never carries backend detail.
 *
 *  @param {string} binderId
 *  @returns {Promise<{status:'ready',layout:object|null}|{status:'failed'}>}
 */
export async function fetchBinderLayout(binderId) {
  if (!binderId) {
    console.error('fetchBinderLayout: binderId is required.');
    return FAILED;
  }
  try {
    const { data, error } = await supabase.rpc('fetch_binder_page_layout', {
      p_binder_id: binderId,
    });
    if (error) throw error;

    // SQL NULL == owned binder with no layout. Explicitly NOT an error, and
    // explicitly NOT the same outcome as a failed read. This is the ONLY
    // payload that may render first-use setup.
    if (data === null) return NO_LAYOUT;

    // undefined is NOT in the BP-3.1A contract. fetch_binder_page_layout returns
    // either a canonical jsonb document or SQL NULL, and PostgREST surfaces SQL
    // NULL as null — never undefined. An undefined payload therefore means
    // something outside the contract produced this response (a transport shim, a
    // changed client, a shape drift), and nothing is known about whether a
    // layout exists. Treating it as "no layout" would offer first-use setup for
    // a binder that may already hold an arrangement, which is precisely the
    // confusion this service exists to prevent.
    if (data === undefined) {
      console.error('fetchBinderLayout: RPC returned undefined — outside the BP-3.1A contract, treated as a read failure.');
      return FAILED;
    }

    const layout = normalizeLayoutDocument(data, binderId);
    if (!layout) return FAILED; // malformed success == read failure
    return { status: 'ready', layout };
  } catch (e) {
    console.error('fetchBinderLayout failed:', e);
    return FAILED;
  }
}

// Exported for validation harnesses and future BP-3.1C reuse. Not consumed by
// the UI directly — the UI only ever sees the closed contract above.
export { normalizeLayoutDocument, FORMAT_POCKETS, THEMES, CONTRACT_VERSION };
