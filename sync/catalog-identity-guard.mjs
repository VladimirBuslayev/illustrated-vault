// sync/catalog-identity-guard.mjs
// CAT-2B1 — write-time catalog identity collision guard.
//
// ─────────────────────────────────────────────────────────────────────────────
// What this defends against
// ─────────────────────────────────────────────────────────────────────────────
//
// TCGdex periodically re-namespaces a subset out of its parent set, changing the
// canonical card ID of a physical printing. `sync-cards.mjs` has no delete pass
// and no rename handling, so a restructure leaves the old rows in place and adds
// the new ones. The result is two catalog rows for ONE physical printing under
// two different canonical IDs.
//
// CAT-0's uniqueness invariants are keyed on `(id)` and `(set_id, local_id)`.
// A set-ID rename violates neither: `swsh9.5tg-TG01` and `swsh9tg-TG01` differ in
// both. The invariants pass while the defect exists.
//
// The key that actually matters for this product is the one the SNAPSHOT IMPORTER
// resolves on — `snapshotMatcher.js :: classifyEligible` Tier 1:
//
//     ixNSN.get(`${normName(name)}|${normSet(set)}|${normNum(number)}`)
//     hits.length === 1  -> matched
//     hits.length  >  1  -> ambiguous / multi_exact
//
// Two catalog rows sharing that triple therefore convert a collector's MATCHED
// row into AMBIGUOUS on their next CSV import. The card silently leaves the
// active snapshot, and under OWN-0B it renders missing everywhere. Losing a true
// positive is a serious ownership harm, not a cosmetic one.
//
// This module makes that condition unreachable through the sync write path.
//
// ─────────────────────────────────────────────────────────────────────────────
// Scope — containment, NOT reconciliation
// ─────────────────────────────────────────────────────────────────────────────
//
// The guard REFUSES the write. It does not delete, alias, merge, or repair any
// existing row, and it has no opinion about which of two colliding identities is
// "correct". Reconciling the four already-stored Trainer Gallery namespaces is a
// separate, evidence-gated decision (see CAT-2A §10 "do not repair yet").
//
// ─────────────────────────────────────────────────────────────────────────────
// Identity definition — frozen normalizers only
// ─────────────────────────────────────────────────────────────────────────────
//
// The identity is built from `normName` / `normSet` / `normNum` in
// `src/utils/keys.js`. Those functions are the ownership containment seam and are
// imported, never reimplemented. If the guard normalized differently from the
// importer, it would defend a key nothing consumes.
//
// An identity key EXISTS only when all three normalized components are non-empty.
// A row missing one is outside the guard, because the importer's Tier-1 index
// cannot construct that identity either — there is no collision to have. This is
// deliberately not missing-field validation.
//
// ─────────────────────────────────────────────────────────────────────────────
// Row shape
// ─────────────────────────────────────────────────────────────────────────────
//
// Both inputs use the `public.cards` column shape, so the existing-catalog rows
// and the rows produced by `mapCardToRow` are the same shape and need no adapter:
//
//     { id, name, set_name, local_id }
//
// Framework-free and deterministic: no network, no Supabase, no clock, no env.

import { normName, normSet, normNum } from '../src/utils/keys.js';

/**
 * Thrown when a write would place two different canonical IDs on one Tier-1
 * identity. Distinct from an ordinary per-set fetch failure so the caller can
 * escalate it instead of logging and continuing.
 */
export class CatalogIdentityCollisionError extends Error {
  constructor(collisions, context) {
    const ctx = context && context.setId ? ` in set ${context.setId}` : '';
    super(
      `Catalog identity collision${ctx}: ${collisions.length} Tier-1 identity ` +
      `${collisions.length === 1 ? 'group maps' : 'groups map'} to more than one canonical card ID.`
    );
    this.name = 'CatalogIdentityCollisionError';
    // Structural marker. `instanceof` is reliable within one process, but this
    // survives serialization and any future re-wrapping, and isCollisionError()
    // checks both.
    this.isCatalogIdentityCollision = true;
    this.collisions = collisions;
    this.setId = (context && context.setId) || null;
  }
}

/** True for a collision error regardless of how it reached the caller. */
export function isCollisionError(err) {
  return err instanceof CatalogIdentityCollisionError ||
    Boolean(err && err.isCatalogIdentityCollision === true);
}

/**
 * The three normalized components of a row's Tier-1 identity.
 * Returns null when any component normalizes to empty.
 */
export function identityComponents(row) {
  if (!row || typeof row !== 'object') return null;
  const name = normName(row.name == null ? '' : String(row.name));
  const set = normSet(row.set_name == null ? '' : String(row.set_name));
  const num = normNum(row.local_id == null ? '' : String(row.local_id));
  if (!name || !set || !num) return null;
  return { name, set, num };
}

/**
 * Collision-safe identity key, or null when the row has no constructible
 * identity.
 *
 * Serialized with JSON.stringify over an array rather than a joined string.
 * `normName` and `normSet` strip punctuation, but `normNum` does not — it only
 * lowercases, trims, and cuts at the first `/`. So a separator character cannot
 * be assumed impossible in the number component. Same reasoning as
 * `imageService.fingerprintCard`.
 */
export function identityKey(row) {
  const c = identityComponents(row);
  return c === null ? null : JSON.stringify([c.name, c.set, c.num]);
}

/** A fresh, empty identity index. */
export function createIdentityIndex() {
  return {
    byKey: new Map(), // identityKey -> Set<canonical card id>
    indexed: 0,       // rows that produced an identity
    skipped: 0,       // rows with no constructible identity
  };
}

/**
 * Fold rows into the index. Used both for the existing-catalog load (paged) and,
 * after a successful upsert, for the rows this run just wrote.
 *
 * Adding never throws. A pre-existing duplicate group in the catalog is a fact to
 * be REPORTED at load time, not a reason to abort loading — the caller decides.
 * (It will, however, trip `assertNoIdentityCollisions` on the next write that
 * touches that identity; see the note on that function.)
 */
export function addRowsToIndex(index, rows) {
  let indexed = 0;
  let skipped = 0;
  for (const row of rows || []) {
    const key = identityKey(row);
    if (key === null) { skipped++; continue; }
    const id = row && row.id;
    if (typeof id !== 'string' || !id) { skipped++; continue; }
    let ids = index.byKey.get(key);
    if (!ids) { ids = new Set(); index.byKey.set(key, ids); }
    ids.add(id);
    indexed++;
  }
  index.indexed += indexed;
  index.skipped += skipped;
  return { indexed, skipped };
}

/**
 * Identity groups already holding more than one canonical ID. Zero in production
 * as of 2026-08-14. A non-zero result is an integrity problem that predates this
 * run and should be surfaced loudly rather than silently tolerated.
 */
export function existingDuplicateGroups(index) {
  const out = [];
  for (const [key, ids] of index.byKey) {
    if (ids.size > 1) out.push({ key, components: JSON.parse(key), ids: [...ids].sort() });
  }
  return out;
}

/**
 * Find every identity in `rows` that would end up mapped to more than one
 * canonical card ID once written.
 *
 * The rule is one line: for each identity, take the union of the IDs already
 * stored under it and the IDs arriving under it. A union larger than one is a
 * collision. That single rule covers every case:
 *
 *   stored {}    + incoming {A}   -> {A}    ok — new identity
 *   stored {A}   + incoming {A}   -> {A}    ok — same-ID update, the normal path
 *   stored {A}   + incoming {A,A} -> {A}    ok — a repeated ID is not a conflict
 *   stored {A}   + incoming {B}   -> {A,B}  COLLISION — the rename case
 *   stored {}    + incoming {A,B} -> {A,B}  COLLISION — two incoming rows collide
 *   stored {A,B} + incoming {A}   -> {A,B}  COLLISION — pre-existing duplicate
 *
 * The last line is deliberate. A pre-existing duplicate group means the catalog
 * is already in the state this guard exists to prevent, and continuing to write
 * into it would compound the damage. Failing closed is the mandate. Production
 * has zero such groups, so this cannot fire today without a real regression.
 *
 * Returns every collision in the batch, not just the first, so one failed run
 * reports the whole picture.
 */
export function findIdentityCollisions(index, rows) {
  // Dedupe incoming by identity first, so a repeated canonical ID collapses.
  const incoming = new Map(); // key -> Set<id>
  for (const row of rows || []) {
    const key = identityKey(row);
    if (key === null) continue;
    const id = row && row.id;
    if (typeof id !== 'string' || !id) continue;
    let ids = incoming.get(key);
    if (!ids) { ids = new Set(); incoming.set(key, ids); }
    ids.add(id);
  }

  const collisions = [];
  for (const [key, incomingIds] of incoming) {
    const storedIds = index.byKey.get(key) || new Set();
    const union = new Set([...storedIds, ...incomingIds]);
    if (union.size <= 1) continue;
    collisions.push({
      key,
      components: JSON.parse(key),
      incomingIds: [...incomingIds].sort(),
      storedIds: [...storedIds].sort(),
      allIds: [...union].sort(),
    });
  }
  // Deterministic order so logs and tests are stable.
  collisions.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return collisions;
}

/**
 * Fail-closed assertion. Throws CatalogIdentityCollisionError, otherwise returns
 * the number of identities checked.
 *
 * MUST be called before the upsert. Nothing in this module writes anything, so
 * the ordering guarantee lives entirely at the call site.
 */
export function assertNoIdentityCollisions(index, rows, context) {
  const collisions = findIdentityCollisions(index, rows);
  if (collisions.length > 0) {
    throw new CatalogIdentityCollisionError(collisions, context);
  }
  return (rows || []).length;
}

/**
 * Multi-line, diagnosable rendering of a collision error.
 *
 * Logs the three normalized identity components and the conflicting canonical
 * IDs — and nothing else. No secrets, no pricing, no images, no unrelated
 * catalog payload.
 */
export function formatCollisionReport(err) {
  const lines = [];
  lines.push('CATALOG IDENTITY COLLISION — refusing to write.');
  if (err.setId) lines.push(`  set: ${err.setId}`);
  lines.push(
    `  ${err.collisions.length} Tier-1 identity ` +
    `${err.collisions.length === 1 ? 'group maps' : 'groups map'} to more than one canonical card ID.`
  );
  for (const c of err.collisions) {
    const [name, set, num] = c.components;
    lines.push(`  - identity: name="${name}" set="${set}" num="${num}"`);
    lines.push(`      incoming id(s): ${c.incomingIds.join(', ') || '(none)'}`);
    lines.push(`      stored   id(s): ${c.storedIds.join(', ') || '(none)'}`);
  }
  lines.push('  No rows were written for this set. The catalog is unchanged by it.');
  lines.push('  This is the snapshot importer\'s Tier-1 key: two rows sharing it turn a');
  lines.push('  collector\'s MATCHED row into AMBIGUOUS at their next import.');
  lines.push('  Likely cause: an upstream set-ID rename. Resolve the identity question');
  lines.push('  deliberately — do NOT widen the guard to let the write through.');
  return lines.join('\n');
}

/**
 * End-of-run summary across every set that failed the guard.
 *
 * A collision is contained to its own set: the rest of the run proceeds, so one
 * renamed set cannot stall unrelated catalog coverage. The cost of continuing is
 * that the failure would otherwise scroll far up the log behind later sets, so
 * the run must restate it at the end — and the process must still exit non-zero.
 *
 * `entries` is [{ setId, collisions }] in the order the sets were attempted.
 * Returns null when the run was clean, so the caller prints nothing.
 */
export function formatCollisionRunSummary(entries) {
  const list = entries || [];
  if (list.length === 0) return null;

  const groups = list.reduce((n, e) => n + ((e.collisions && e.collisions.length) || 0), 0);
  const lines = [];
  lines.push('CATALOG IDENTITY COLLISIONS — this run is INCOMPLETE.');
  lines.push(
    `  ${list.length} set(s) were refused, covering ${groups} conflicting Tier-1 ` +
    `identity group(s). Zero rows were written for those sets.`
  );
  for (const e of list) {
    const n = (e.collisions && e.collisions.length) || 0;
    const ids = new Set();
    for (const c of e.collisions || []) for (const id of c.allIds || []) ids.add(id);
    lines.push(`  - ${e.setId}: ${n} identity group(s); canonical ids involved: ${[...ids].sort().join(', ')}`);
  }
  lines.push('  Every other set was processed normally — this is containment, not a full stop.');
  lines.push('  Exiting non-zero so a partial run cannot appear green.');
  return lines.join('\n');
}
