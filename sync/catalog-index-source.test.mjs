// sync/catalog-index-source.test.mjs
// CAT-2D.1 — structural regression guard for the CAT-2B1 identity index source.
//
// Run:  npm run test:index-source        (from sync/)
//
// WHY A STRUCTURAL TEST
//   loadCatalogIdentityIndex() talks to Supabase over the network with a
//   service-role key, so it cannot be exercised in a dependency-free unit test
//   without either injecting a client (a signature change outside this slice's
//   scope) or contacting production (forbidden). What CAN be asserted, cheaply
//   and durably, is the invariant that actually matters:
//
//     the identity index reads the EFFECTIVE canonical catalog,
//     while the three provider-history writers keep reading raw `cards`.
//
//   This follows the CAT-1 precedent of asserting a structural invariant over
//   the source file rather than trusting a comment. It is deliberately narrow:
//   it proves which relation each function addresses, nothing more.
//
// WHY IT MATTERS
//   Under the retained raw-history model, public.cards keeps obsolete provider
//   rows forever. If the guard index regressed to raw `cards`, every reconciled
//   rename would collide with its own retired predecessor permanently — the
//   four renamed Trainer Gallery sets would be refused on every run even after
//   being correctly reconciled. That failure would be silent in code review and
//   loud only in production.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, 'sync-cards.mjs'), 'utf8');

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

/**
 * Extract one top-level function body by name: from its declaration up to the
 * next top-level `function` / `async function` declaration (column 0), or EOF.
 */
function functionBody(name) {
  const decl = new RegExp(`^(?:async\\s+)?function\\s+${name}\\s*\\(`, 'm');
  const start = SRC.search(decl);
  assert.ok(start !== -1, `function ${name} not found in sync-cards.mjs`);
  const rest = SRC.slice(start + 1);
  const nextDecl = rest.search(/^(?:async\s+)?function\s+\w+\s*\(/m);
  return nextDecl === -1 ? SRC.slice(start) : SRC.slice(start, start + 1 + nextDecl);
}

/** Every `.from('<relation>')` a function addresses, in order. */
function relationsAddressedBy(name) {
  const body = functionBody(name);
  return [...body.matchAll(/\.from\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1]);
}

console.log('\nCAT-2D.1 — catalog index source\n');

// ── The change this slice makes ─────────────────────────────────────────────
test('loadCatalogIdentityIndex reads the EFFECTIVE canonical catalog', () => {
  assert.deepEqual(relationsAddressedBy('loadCatalogIdentityIndex'), ['cards_effective']);
});

test('loadCatalogIdentityIndex does NOT read raw cards', () => {
  assert.ok(
    !relationsAddressedBy('loadCatalogIdentityIndex').includes('cards'),
    'the identity index must not address raw public.cards — obsolete rows would collide forever'
  );
});

// ── The three provider-history consumers that must NOT move ────────────────
test('upsertRows still writes raw cards (provider history target)', () => {
  assert.deepEqual(relationsAddressedBy('upsertRows'), ['cards']);
});

test('updateSetTemporal still writes raw cards (CAT-1 sole temporal writer)', () => {
  assert.deepEqual(relationsAddressedBy('updateSetTemporal'), ['cards']);
});

test('getStoredCountForSet still counts raw cards (F-6 skip predicate)', () => {
  assert.deepEqual(relationsAddressedBy('getStoredCountForSet'), ['cards']);
});

test('exactly one catalog-reading function moved to cards_effective', () => {
  const all = [...SRC.matchAll(/\.from\(\s*['"](cards|cards_effective)['"]\s*\)/g)].map(m => m[1]);
  assert.equal(all.filter(r => r === 'cards_effective').length, 1, 'exactly one cards_effective call site');
  assert.equal(all.filter(r => r === 'cards').length, 3, 'exactly three raw-cards call sites');
});

// ── Everything else about the index must be unchanged ──────────────────────
test('index still selects exactly the four identity columns', () => {
  const body = functionBody('loadCatalogIdentityIndex');
  assert.ok(
    /\.select\(\s*['"]id,\s*name,\s*set_name,\s*local_id['"]\s*\)/.test(body),
    'identity index must select exactly id, name, set_name, local_id — no images, pricing or illustrator'
  );
  for (const forbidden of ['image_url', 'pricing', 'illustrator', 'artist_id', 'release_date']) {
    assert.ok(!body.includes(forbidden), `index must not select ${forbidden}`);
  }
});

test('index still uses deterministic ordering and explicit range pagination', () => {
  const body = functionBody('loadCatalogIdentityIndex');
  assert.ok(/\.order\(\s*['"]id['"]\s*,\s*\{\s*ascending:\s*true\s*\}\s*\)/.test(body), 'deterministic order by id asc');
  assert.ok(/\.range\(\s*from\s*,\s*from\s*\+\s*IDENTITY_PAGE_SIZE\s*-\s*1\s*\)/.test(body), 'explicit fixed-size range paging');
  assert.ok(/rows\.length\s*<\s*IDENTITY_PAGE_SIZE/.test(body), 'short page terminates the walk');
  assert.ok(/from\s*\+=\s*rows\.length/.test(body), 'cursor advances by page length');
});

test('index still fails closed on read error', () => {
  const body = functionBody('loadCatalogIdentityIndex');
  assert.ok(/if\s*\(error\)\s*throw error;/.test(body), 'a failed page read must throw, never yield a partial index');
});

test('index still reports pre-existing duplicate identity groups', () => {
  const body = functionBody('loadCatalogIdentityIndex');
  assert.ok(body.includes('existingDuplicateGroups'), 'pre-existing duplicates must still be surfaced at load time');
});

test('IDENTITY_PAGE_SIZE constant is unchanged', () => {
  assert.ok(/const IDENTITY_PAGE_SIZE = 1000;/.test(SRC), 'page size must remain 1000');
});

// ── Guard semantics untouched by this slice ────────────────────────────────
test('guard still runs immediately before upsertRows with no try/catch between', () => {
  const body = functionBody('syncSet');
  const guardAt = body.indexOf('assertNoIdentityCollisions(');
  const upsertAt = body.indexOf('await upsertRows(rows)');
  assert.ok(guardAt !== -1 && upsertAt !== -1, 'both call sites must exist');
  assert.ok(guardAt < upsertAt, 'the guard must precede the upsert');
  const between = body.slice(guardAt, upsertAt);
  assert.ok(!/\btry\s*\{/.test(between), 'no try block may sit between the guard and the upsert');
});

test('temporal mode still loads no identity index', () => {
  assert.ok(
    /SYNC_MODE === 'temporal' \? null : await loadCatalogIdentityIndex\(\)/.test(SRC),
    'temporal mode must neither load the index nor invoke the guard'
  );
});

test('collision handling is still per-set containment plus a non-zero exit', () => {
  assert.ok(/isCollisionError\(err\)/.test(SRC), 'collision errors are still discriminated');
  assert.ok(/identityCollisions\.push\(/.test(SRC), 'collisions are still recorded');
  assert.ok(/reportIdentityCollisions\(identityCollisions\)/.test(SRC), 'end-of-run report still emitted');
  assert.ok(/process\.exitCode = 1;/.test(SRC), 'run still exits non-zero on collision');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  for (const f of failures) console.error(`FAILED: ${f.name}\n${f.err.stack}\n`);
  process.exit(1);
}
