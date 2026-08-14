// sync/catalog-identity-guard.test.mjs
// CAT-2B1 — dependency-free regression harness for the catalog identity guard.
//
// Run:  npm run test:identity-guard        (from sync/)
//
// Uses only node:assert. No network, no Supabase, no credentials, no fixtures
// read from disk. Every case is constructed inline from the `public.cards`
// column shape { id, name, set_name, local_id }.
//
// The harness deliberately exercises the guard through the REAL frozen
// normalizers imported from src/utils/keys.js. It never reimplements or stubs
// them — a test that normalized independently would pass while the guard
// defended the wrong key.

import assert from 'node:assert/strict';
import {
  createIdentityIndex,
  addRowsToIndex,
  identityKey,
  identityComponents,
  findIdentityCollisions,
  assertNoIdentityCollisions,
  existingDuplicateGroups,
  formatCollisionReport,
  formatCollisionRunSummary,
  isCollisionError,
  CatalogIdentityCollisionError,
} from './catalog-identity-guard.mjs';

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, err });
    console.error(`  FAIL ${name}\n       ${err.message}`);
  }
}

/** Build an index pre-loaded with existing catalog rows. */
function indexWith(...rows) {
  const ix = createIdentityIndex();
  addRowsToIndex(ix, rows);
  return ix;
}

/** Assert the batch is accepted. */
function expectAllowed(index, rows, label) {
  const collisions = findIdentityCollisions(index, rows);
  assert.deepEqual(
    collisions.map(c => c.allIds),
    [],
    `${label}: expected no collision, got ${JSON.stringify(collisions.map(c => c.allIds))}`
  );
  assert.doesNotThrow(() => assertNoIdentityCollisions(index, rows), `${label}: assert threw`);
}

/** Assert the batch is refused, and return the thrown error. */
function expectCollision(index, rows, expectedIds, label) {
  const collisions = findIdentityCollisions(index, rows);
  assert.equal(collisions.length, 1, `${label}: expected exactly 1 collision group`);
  assert.deepEqual(collisions[0].allIds, expectedIds, `${label}: colliding IDs mismatch`);
  let thrown = null;
  try { assertNoIdentityCollisions(index, rows, { setId: 'test-set' }); }
  catch (e) { thrown = e; }
  assert.ok(thrown, `${label}: assertNoIdentityCollisions did not throw`);
  assert.ok(isCollisionError(thrown), `${label}: wrong error type`);
  return thrown;
}

console.log('\nCAT-2B1 — catalog identity guard\n');

// ── 1. new identity / new ID → allowed ───────────────────────────────────────
test('1  new identity, new canonical ID -> allowed', () => {
  const ix = indexWith({ id: 'swsh9-001', name: 'Exeggcute', set_name: 'Brilliant Stars', local_id: '001' });
  expectAllowed(ix, [{ id: 'sv01-001', name: 'Sprigatito', set_name: 'Scarlet & Violet', local_id: '001' }], 'case 1');
});

// ── 2. existing identity / same ID → allowed (the normal re-sync path) ───────
test('2  existing identity, SAME canonical ID -> allowed (routine update)', () => {
  const row = { id: 'swsh9-001', name: 'Exeggcute', set_name: 'Brilliant Stars', local_id: '001' };
  const ix = indexWith(row);
  expectAllowed(ix, [{ ...row, name: 'Exeggcute' }], 'case 2');
});

// ── 3. existing identity / different ID → collision ──────────────────────────
test('3  existing identity, DIFFERENT canonical ID -> collision', () => {
  const ix = indexWith({ id: 'swsh9.5tg-TG01', name: 'Flareon', set_name: 'Brilliant Stars Trainer Gallery', local_id: 'TG01' });
  expectCollision(
    ix,
    [{ id: 'swsh9tg-TG01', name: 'Flareon', set_name: 'Brilliant Stars Trainer Gallery', local_id: 'TG01' }],
    ['swsh9.5tg-TG01', 'swsh9tg-TG01'],
    'case 3'
  );
});

// ── 4. case differences normalize to a collision ─────────────────────────────
test('4  case-only differences normalize to the same identity -> collision', () => {
  const ix = indexWith({ id: 'a-1', name: 'Flareon', set_name: 'Brilliant Stars Trainer Gallery', local_id: 'TG01' });
  expectCollision(
    ix,
    [{ id: 'b-1', name: 'FLAREON', set_name: 'BRILLIANT STARS TRAINER GALLERY', local_id: 'tg01' }],
    ['a-1', 'b-1'],
    'case 4'
  );
  // Guard the premise rather than trusting it.
  assert.equal(
    identityKey({ id: 'x', name: 'Flareon', set_name: 'Brilliant Stars Trainer Gallery', local_id: 'TG01' }),
    identityKey({ id: 'y', name: 'FLAREON', set_name: 'BRILLIANT STARS TRAINER GALLERY', local_id: 'tg01' })
  );
});

// ── 5. name punctuation handled by normName ──────────────────────────────────
test("5  normName punctuation folding (Farfetch'd) -> collision", () => {
  assert.equal(identityComponents({ name: "Farfetch'd", set_name: 'Base Set', local_id: '8' }).name, 'farfetchd');
  const ix = indexWith({ id: 'base1-8', name: "Farfetch'd", set_name: 'Base Set', local_id: '8' });
  expectCollision(
    ix,
    [{ id: 'other-8', name: 'Farfetchd', set_name: 'Base Set', local_id: '8' }],
    ['base1-8', 'other-8'],
    'case 5'
  );
});

// ── 6. set punctuation / ampersand handled by normSet ────────────────────────
test('6  normSet "&" -> "and" and punctuation folding -> collision', () => {
  assert.equal(identityComponents({ name: 'x', set_name: 'Scarlet & Violet', local_id: '1' }).set, 'scarlet and violet');
  const ix = indexWith({ id: 'sv01-001', name: 'Sprigatito', set_name: 'Scarlet & Violet', local_id: '001' });
  expectCollision(
    ix,
    [{ id: 'dupe-001', name: 'Sprigatito', set_name: 'Scarlet and Violet!', local_id: '001' }],
    ['dupe-001', 'sv01-001'],
    'case 6'
  );
});

// ── 7. "/denominator" suffix handled by normNum ──────────────────────────────
test('7  normNum cuts at "/" so TG01 and TG01/TG30 are one identity -> collision', () => {
  assert.equal(identityComponents({ name: 'x', set_name: 'y', local_id: 'TG01/TG30' }).num, 'tg01');
  const ix = indexWith({ id: 'a-tg01', name: 'Flareon', set_name: 'Brilliant Stars Trainer Gallery', local_id: 'TG01' });
  expectCollision(
    ix,
    [{ id: 'b-tg01', name: 'Flareon', set_name: 'Brilliant Stars Trainer Gallery', local_id: 'TG01/TG30' }],
    ['a-tg01', 'b-tg01'],
    'case 7'
  );
});

// ── 8/9/10. genuinely different cards are never collisions ───────────────────
test('8  different set -> allowed', () => {
  const ix = indexWith({ id: 'swsh9-001', name: 'Exeggcute', set_name: 'Brilliant Stars', local_id: '001' });
  expectAllowed(ix, [{ id: 'swsh10-001', name: 'Exeggcute', set_name: 'Astral Radiance', local_id: '001' }], 'case 8');
});

test('9  different number -> allowed', () => {
  const ix = indexWith({ id: 'swsh9-001', name: 'Exeggcute', set_name: 'Brilliant Stars', local_id: '001' });
  expectAllowed(ix, [{ id: 'swsh9-002', name: 'Exeggcute', set_name: 'Brilliant Stars', local_id: '002' }], 'case 9');
});

test('10 different name -> allowed', () => {
  const ix = indexWith({ id: 'swsh9-001', name: 'Exeggcute', set_name: 'Brilliant Stars', local_id: '001' });
  expectAllowed(ix, [{ id: 'swsh9-001b', name: 'Exeggutor', set_name: 'Brilliant Stars', local_id: '001' }], 'case 10');
});

// ── 11. two INCOMING rows collide with each other, before any write ──────────
test('11 two incoming rows, one identity, two IDs -> collision before write', () => {
  const ix = createIdentityIndex(); // empty catalog: nothing stored at all
  expectCollision(
    ix,
    [
      { id: 'swsh9.5tg-TG01', name: 'Flareon', set_name: 'Brilliant Stars Trainer Gallery', local_id: 'TG01' },
      { id: 'swsh9tg-TG01', name: 'Flareon', set_name: 'Brilliant Stars Trainer Gallery', local_id: 'TG01' },
    ],
    ['swsh9.5tg-TG01', 'swsh9tg-TG01'],
    'case 11'
  );
});

// ── 12. the same canonical ID appearing twice is not a collision ─────────────
test('12 repeated incoming canonical ID -> NOT a false collision', () => {
  const row = { id: 'swsh9-001', name: 'Exeggcute', set_name: 'Brilliant Stars', local_id: '001' };
  expectAllowed(indexWith(row), [row, { ...row }], 'case 12 (stored + repeated)');
  expectAllowed(createIdentityIndex(), [row, { ...row }], 'case 12 (empty index)');
});

// ── 13. an unconstructible identity is outside the guard ─────────────────────
test('13 missing/empty identity component -> outside the guard, no false collision', () => {
  assert.equal(identityKey({ id: 'a', name: 'Flareon', set_name: 'Brilliant Stars', local_id: '' }), null);
  assert.equal(identityKey({ id: 'a', name: '', set_name: 'Brilliant Stars', local_id: '1' }), null);
  assert.equal(identityKey({ id: 'a', name: 'Flareon', set_name: '', local_id: '1' }), null);
  assert.equal(identityKey({ id: 'a', name: 'Flareon', set_name: 'Brilliant Stars', local_id: null }), null);
  // normName strips punctuation, so a purely-symbolic name normalizes to empty.
  assert.equal(identityKey({ id: 'a', name: '!!!', set_name: 'Brilliant Stars', local_id: '1' }), null);
  // normNum cuts at the first "/", so a bare "/" normalizes to empty.
  assert.equal(identityKey({ id: 'a', name: 'Flareon', set_name: 'Brilliant Stars', local_id: '/' }), null);

  const ix = indexWith({ id: 'stored-x', name: 'Flareon', set_name: 'Brilliant Stars', local_id: '' });
  expectAllowed(ix, [{ id: 'incoming-y', name: 'Flareon', set_name: 'Brilliant Stars', local_id: '' }], 'case 13');
  assert.equal(ix.indexed, 0, 'unconstructible rows must not enter the index');
  assert.equal(ix.skipped, 1, 'unconstructible rows must be counted as skipped');
});

// ── Production-incident fixture ──────────────────────────────────────────────
test('FIXTURE swsh9.5tg-TG01 vs swsh9tg-TG01 -> fatal collision naming both IDs', () => {
  const stored = {
    id: 'swsh9.5tg-TG01',
    name: 'Flareon',
    set_name: 'Brilliant Stars Trainer Gallery',
    local_id: 'TG01',
  };
  const incoming = {
    id: 'swsh9tg-TG01',
    name: 'Flareon',
    set_name: 'Brilliant Stars Trainer Gallery',
    local_id: 'TG01',
  };

  const ix = indexWith(stored);
  const err = expectCollision(ix, [incoming], ['swsh9.5tg-TG01', 'swsh9tg-TG01'], 'fixture');

  assert.ok(err instanceof CatalogIdentityCollisionError);
  assert.equal(err.name, 'CatalogIdentityCollisionError');
  assert.equal(err.isCatalogIdentityCollision, true);
  assert.equal(err.setId, 'test-set');
  assert.equal(err.collisions.length, 1);
  assert.deepEqual(err.collisions[0].incomingIds, ['swsh9tg-TG01']);
  assert.deepEqual(err.collisions[0].storedIds, ['swsh9.5tg-TG01']);
  assert.deepEqual(err.collisions[0].components, ['flareon', 'brilliant stars trainer gallery', 'tg01']);

  // The report must name both canonical IDs and all three components.
  const report = formatCollisionReport(err);
  for (const needle of ['swsh9.5tg-TG01', 'swsh9tg-TG01', 'flareon', 'brilliant stars trainer gallery', 'tg01']) {
    assert.ok(report.includes(needle), `report missing "${needle}"`);
  }
});

test('FIXTURE all 30 renamed TG rows collide, and every group is reported', () => {
  const ix = createIdentityIndex();
  const stored = [];
  const incoming = [];
  for (let i = 1; i <= 30; i++) {
    const n = String(i).padStart(2, '0');
    stored.push({ id: `swsh9.5tg-TG${n}`, name: `Card ${n}`, set_name: 'Brilliant Stars Trainer Gallery', local_id: `TG${n}` });
    incoming.push({ id: `swsh9tg-TG${n}`, name: `Card ${n}`, set_name: 'Brilliant Stars Trainer Gallery', local_id: `TG${n}` });
  }
  addRowsToIndex(ix, stored);
  assert.equal(ix.indexed, 30);
  assert.deepEqual(existingDuplicateGroups(ix), [], 'stored TG namespace is internally clean');

  const collisions = findIdentityCollisions(ix, incoming);
  assert.equal(collisions.length, 30, 'every one of the 30 printings must be reported');
  assert.deepEqual(collisions[0].allIds.length, 2);
});

// ── Same-run ordering: set B is checked against set A's committed writes ─────
test('RUN-ORDER later set is checked against earlier writes from the same run', () => {
  const ix = createIdentityIndex(); // empty catalog
  const setA = [{ id: 'swsh9.5tg-TG01', name: 'Flareon', set_name: 'Brilliant Stars Trainer Gallery', local_id: 'TG01' }];
  const setB = [{ id: 'swsh9tg-TG01', name: 'Flareon', set_name: 'Brilliant Stars Trainer Gallery', local_id: 'TG01' }];

  // Set A validates against an empty catalog and is written.
  expectAllowed(ix, setA, 'run-order set A');
  addRowsToIndex(ix, setA); // simulates the post-upsert commit

  // Set B, later in the same run, must now be refused.
  expectCollision(ix, setB, ['swsh9.5tg-TG01', 'swsh9tg-TG01'], 'run-order set B');
});

test('RUN-ORDER an unwritten (refused) set does NOT enter the index', () => {
  const ix = createIdentityIndex();
  const rows = [{ id: 'a-1', name: 'Flareon', set_name: 'Brilliant Stars Trainer Gallery', local_id: 'TG01' }];
  expectAllowed(ix, rows, 'pre-check');
  // Guard passes but the caller must only commit AFTER a successful upsert.
  assert.equal(ix.indexed, 0, 'validation alone must never mutate the index');
});

// ── Pre-existing duplicate group behavior (documented, deliberate) ───────────
test('PRE-EXISTING duplicate group is reported at load time and fails closed on write', () => {
  const ix = indexWith(
    { id: 'a-1', name: 'Flareon', set_name: 'Brilliant Stars Trainer Gallery', local_id: 'TG01' },
    { id: 'b-1', name: 'Flareon', set_name: 'Brilliant Stars Trainer Gallery', local_id: 'TG01' }
  );
  const dups = existingDuplicateGroups(ix);
  assert.equal(dups.length, 1, 'the pre-existing duplicate must be visible at load time');
  assert.deepEqual(dups[0].ids, ['a-1', 'b-1']);

  // Writing either ID into an already-duplicated identity is refused by design.
  expectCollision(ix, [{ id: 'a-1', name: 'Flareon', set_name: 'Brilliant Stars Trainer Gallery', local_id: 'TG01' }],
    ['a-1', 'b-1'], 'pre-existing');
});

// ── Index hygiene ────────────────────────────────────────────────────────────
test('INDEX paged loading accumulates across multiple addRowsToIndex calls', () => {
  const ix = createIdentityIndex();
  addRowsToIndex(ix, [{ id: 'p1', name: 'A', set_name: 'S', local_id: '1' }]);
  addRowsToIndex(ix, [{ id: 'p2', name: 'B', set_name: 'S', local_id: '2' }]);
  addRowsToIndex(ix, [{ id: 'p3', name: 'C', set_name: 'S', local_id: '3' }]);
  assert.equal(ix.indexed, 3);
  assert.equal(ix.byKey.size, 3);
  expectAllowed(ix, [{ id: 'p4', name: 'D', set_name: 'S', local_id: '4' }], 'paged');
});

test('INDEX rows without a usable canonical id are skipped, not indexed', () => {
  const ix = createIdentityIndex();
  const r = addRowsToIndex(ix, [
    { id: '', name: 'A', set_name: 'S', local_id: '1' },
    { id: null, name: 'A', set_name: 'S', local_id: '2' },
    { id: 'ok-1', name: 'A', set_name: 'S', local_id: '3' },
  ]);
  assert.deepEqual(r, { indexed: 1, skipped: 2 });
});

test('INDEX empty/absent row batches are inert', () => {
  const ix = createIdentityIndex();
  assert.deepEqual(addRowsToIndex(ix, []), { indexed: 0, skipped: 0 });
  assert.deepEqual(addRowsToIndex(ix, null), { indexed: 0, skipped: 0 });
  assert.deepEqual(findIdentityCollisions(ix, []), []);
  assert.deepEqual(findIdentityCollisions(ix, null), []);
});

test('KEY serialization is collision-safe across component boundaries', () => {
  // normNum does not strip punctuation, so a separator character is possible in
  // the number component. A naive "a|b|c" join could alias these two rows.
  const a = identityKey({ name: 'x', set_name: 'y', local_id: 'a"],["b' });
  const b = identityKey({ name: 'x', set_name: 'y', local_id: 'c' });
  assert.notEqual(a, b);
  assert.equal(identityKey({ name: 'x', set_name: 'y', local_id: '1' }),
               identityKey({ name: ' X ', set_name: 'Y', local_id: ' 1 ' }));
});

// ── Run-level containment: refuse the set, keep going, fail the run ─────────
test('RUN-SUMMARY a clean run returns null so nothing is printed', () => {
  assert.equal(formatCollisionRunSummary([]), null);
  assert.equal(formatCollisionRunSummary(null), null);
  assert.equal(formatCollisionRunSummary(undefined), null);
});

test('RUN-SUMMARY names every refused set and the canonical IDs involved', () => {
  const ix = indexWith(
    { id: 'swsh9.5tg-TG01', name: 'Flareon', set_name: 'Brilliant Stars Trainer Gallery', local_id: 'TG01' },
    { id: 'swsh10.5tg-TG01', name: 'Abomasnow', set_name: 'Astral Radiance Trainer Gallery', local_id: 'TG01' }
  );

  // Two independent sets each collide; both are recorded, neither stops the other.
  const entries = [];
  for (const [setId, row] of [
    ['swsh9tg', { id: 'swsh9tg-TG01', name: 'Flareon', set_name: 'Brilliant Stars Trainer Gallery', local_id: 'TG01' }],
    ['swsh10tg', { id: 'swsh10tg-TG01', name: 'Abomasnow', set_name: 'Astral Radiance Trainer Gallery', local_id: 'TG01' }],
  ]) {
    try { assertNoIdentityCollisions(ix, [row], { setId }); }
    catch (err) { entries.push({ setId, collisions: err.collisions }); }
  }
  assert.equal(entries.length, 2, 'both sets must be recorded, not just the first');

  const summary = formatCollisionRunSummary(entries);
  for (const needle of ['swsh9tg', 'swsh10tg', 'swsh9.5tg-TG01', 'swsh10.5tg-TG01', '2 set(s)']) {
    assert.ok(summary.includes(needle), `run summary missing "${needle}"`);
  }
  assert.ok(/exit/i.test(summary), 'run summary must state that the run exits non-zero');
});

test('RUN-SUMMARY an independent set after a refused one is still allowed', () => {
  const ix = indexWith({ id: 'swsh9.5tg-TG01', name: 'Flareon', set_name: 'Brilliant Stars Trainer Gallery', local_id: 'TG01' });

  // Set 1 collides and is refused — nothing is written, so nothing is committed.
  const colliding = [{ id: 'swsh9tg-TG01', name: 'Flareon', set_name: 'Brilliant Stars Trainer Gallery', local_id: 'TG01' }];
  assert.throws(() => assertNoIdentityCollisions(ix, colliding, { setId: 'swsh9tg' }));
  assert.equal(ix.indexed, 1, 'a refused set must not enter the index');

  // Set 2 is unrelated and must still pass — containment, not a full stop.
  const independent = [{ id: 'sv01-001', name: 'Sprigatito', set_name: 'Scarlet & Violet', local_id: '001' }];
  expectAllowed(ix, independent, 'independent set after refusal');
  addRowsToIndex(ix, independent);
  assert.equal(ix.indexed, 2, 'the independent set commits normally');

  // The refused identity stays refused for the rest of the run.
  assert.throws(() => assertNoIdentityCollisions(ix, colliding, { setId: 'swsh9tg-retry' }));
});

test('RUN-SUMMARY counts identity groups across sets, not just sets', () => {
  const entries = [
    { setId: 'a', collisions: [{ allIds: ['a-1', 'b-1'] }, { allIds: ['a-2', 'b-2'] }] },
    { setId: 'b', collisions: [{ allIds: ['c-1', 'd-1'] }] },
  ];
  const summary = formatCollisionRunSummary(entries);
  assert.ok(summary.includes('2 set(s)'), 'set count');
  assert.ok(summary.includes('3 conflicting'), 'identity group count across sets');
});

test('ERROR isCollisionError distinguishes integrity failure from ordinary errors', () => {
  assert.equal(isCollisionError(new Error('404 Not Found for https://api.tcgdex.net/...')), false);
  assert.equal(isCollisionError(new TypeError('fetch failed')), false);
  assert.equal(isCollisionError(null), false);
  assert.equal(isCollisionError(undefined), false);
  assert.equal(isCollisionError(new CatalogIdentityCollisionError([], {})), true);
  // Survives a structural copy that loses the prototype.
  assert.equal(isCollisionError({ isCatalogIdentityCollision: true }), true);
});

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  for (const f of failures) console.error(`FAILED: ${f.name}\n${f.err.stack}\n`);
  process.exit(1);
}
