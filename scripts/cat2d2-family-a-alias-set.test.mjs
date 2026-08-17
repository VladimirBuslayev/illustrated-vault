#!/usr/bin/env node
// scripts/cat2d2-family-a-alias-set.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
// CAT-2D.2 — Family A alias-set integrity harness (DEV-ONLY; no network, no
// database, no credentials).
//
// WHAT THIS PROVES
//
//   The migration's embedded 217-row allowlist, the reviewed CSV artifact, the
//   manifest checksum and the editorial constant are ONE fact expressed in four
//   places. Any two of them drifting is exactly the failure mode a hand-edited
//   allowlist invites: a reviewer approves the CSV, someone patches the SQL,
//   and the deployed identity claims are no longer the approved ones.
//
//   These cases make that drift a test failure rather than a production
//   identity claim nobody approved.
//
//   They also pin the structural invariants of the alias set itself — 1:1, no
//   self-alias, no chain, well-formed ids, per-family counts — in JavaScript,
//   so a broken artifact is caught before any SQL is opened. The SAME
//   invariants are re-asserted against production data by
//   docs/sql/cat-2d2-1-family-a-reconciliation.sql §5 and by Phase C of the
//   validation file. Three independent statements of one contract is
//   deliberate, not redundant.
//
// WHAT IT DOES NOT PROVE
//   Nothing here touches the database. That the 217 obsolete ids actually exist
//   in public.cards, and that their stored names match their survivors', can
//   only be established at deploy time — which is what §5 P2/P3/P5 do, and why
//   they refuse rather than warn.
//
// Run: node scripts/cat2d2-family-a-alias-set.test.mjs
// No test framework is introduced (matches the OL-0A/0C/0D/CAT-2D.1 harnesses).
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normName, normNum } from '../src/utils/keys.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSV_PATH = join(ROOT, 'docs', 'cat-2d2-evidence', 'family-a-alias-set.csv');
const MANIFEST_PATH = join(ROOT, 'docs', 'cat-2d2-evidence', 'manifest.json');
const MIGRATION_PATH = join(ROOT, 'docs', 'sql', 'cat-2d2-1-family-a-reconciliation.sql');
const VALIDATION_PATH = join(ROOT, 'docs', 'sql', 'cat-2d2-2-family-a-validation.sql');
const EDITORIAL_PATH = join(ROOT, 'src', 'constants', 'artistEditorial.js');

let passed = 0;
let failed = 0;
const failures = [];
const ok = (cond, msg) => {
  if (cond) { passed++; console.log(`  ok   ${msg}`); }
  else { failed++; failures.push(msg); console.error(`  FAIL ${msg}`); }
};

// Newline-normalised on read and on hash: git's core.autocrlf rewrites line
// endings for text files on checkout, so comparing raw bytes would make these
// assertions pass or fail depending on the developer's platform rather than on
// the content. The checksum in the manifest — which the migration stamps into
// every alias row — attests to CONTENT.
const lf = (t) => t.split('\r\n').join('\n');
const read = (p) => lf(readFileSync(p, 'utf8'));
const sha256 = (t) => createHash('sha256').update(lf(t), 'utf8').digest('hex');

// RFC4180-ish parser: the artifact quotes any cell containing a comma or quote.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur !== '' || row.length > 0) { row.push(cur); rows.push(row); }
  return rows;
}

const EXPECTED_FAMILIES = {
  shining_fates_sv: { parent: 'swsh4.5',  canonical: 'swsh4.5sv',  count: 122, sqlPattern: '^SV[0-9]{3}$' },
  crown_zenith_gg:  { parent: 'swsh12.5', canonical: 'swsh12.5gg', count: 70,  sqlPattern: '^GG[0-9]{2}$' },
  celebrations_cc:  { parent: 'cel25',    canonical: 'cel25cc',    count: 25,  sqlPattern: '^CC[0-9]{3}$' },
};
const TOTAL = 217;

console.log('\nCAT-2D.2 — Family A alias-set integrity\n');

const csvText = read(CSV_PATH);
const manifest = JSON.parse(read(MANIFEST_PATH));
const migration = read(MIGRATION_PATH);
const validation = read(VALIDATION_PATH);
const editorial = read(EDITORIAL_PATH);

const table = parseCsv(csvText);
const header = table[0];
const rows = table.slice(1).map((cells) => Object.fromEntries(header.map((h, i) => [h, cells[i]])));

// ── The artifact and its manifest ───────────────────────────────────────────
console.log('artifact + manifest');
ok(rows.length === TOTAL, `artifact holds ${TOTAL} pairs (got ${rows.length})`);
ok(manifest.csv_sha256 === sha256(csvText), 'manifest csv_sha256 matches the committed CSV byte-for-byte');
ok(manifest.total_aliases === TOTAL, `manifest total_aliases is ${TOTAL}`);
ok(manifest.proof === 'upstream_set_rename', 'manifest records the proof kind');
ok(manifest.tier1_identity_equal === false,
  'manifest states Tier-1 identity is NOT equal — Family A cannot satisfy CAT-2D §3.4 rule 1 and must say so');
ok(manifest.families.length === 3, 'manifest describes exactly three families');

for (const [family, exp] of Object.entries(EXPECTED_FAMILIES)) {
  const m = manifest.families.find((f) => f.family === family);
  ok(!!m && m.alias_count === exp.count, `manifest: ${family} declares ${exp.count} aliases`);
  ok(!!m && m.parent_set_id === exp.parent && m.canonical_set_id === exp.canonical,
    `manifest: ${family} maps ${exp.parent} -> ${exp.canonical}`);
  // The manifest carries the JS regex source (\d); the SQL carries POSIX
  // ([0-9]). Translate rather than accept either, so a real pattern change
  // cannot hide behind the dialect difference.
  ok(!!m && `^${m.local_id_pattern.replace(/^\^/, '').replace(/\$$/, '').replace(/\\d/g, '[0-9]')}$` === exp.sqlPattern,
    `manifest: ${family} local-id pattern translates to ${exp.sqlPattern}`);
}

// ── Structural invariants of the alias set (INV-8 / INV-9 mirrors) ──────────
console.log('\nstructural invariants');
const aliasIds = rows.map((r) => r.alias_card_id);
const canonicalIds = rows.map((r) => r.canonical_card_id);
ok(new Set(aliasIds).size === TOTAL, 'every alias_card_id is unique (it becomes the primary key)');
ok(new Set(canonicalIds).size === TOTAL, 'every canonical_card_id is unique — Family A is strictly 1:1');
ok(rows.every((r) => r.alias_card_id !== r.canonical_card_id), 'no self-alias');
const canonicalSet = new Set(canonicalIds);
ok(aliasIds.every((id) => !canonicalSet.has(id)),
  'no id is both an alias and a survivor — depth stays 1 with no flatten needed');

let shapeBad = 0;
let statusBad = 0;
let normBad = 0;
const perFamily = {};
for (const r of rows) {
  const exp = EXPECTED_FAMILIES[r.family];
  perFamily[r.family] = (perFamily[r.family] ?? 0) + 1;
  if (!exp) { shapeBad++; continue; }
  if (r.alias_card_id !== `${exp.parent}-${r.local_id}`) shapeBad++;
  else if (r.canonical_card_id !== `${exp.canonical}-${r.local_id}`) shapeBad++;
  else if (!new RegExp(exp.sqlPattern.replace('[0-9]', '\\d')).test(r.local_id)) shapeBad++;
  if (r.alias_upstream_status !== '404' || r.canonical_upstream_status !== '200') statusBad++;
  // A2/A3 preconditions: both normalised components must be constructible, or
  // the pair could never satisfy the deploy-time equality checks.
  if (!normName(r.name) || !normNum(r.local_id)) normBad++;
}
ok(shapeBad === 0, `every id is exactly '<set_id>-<local_id>' for its family (${shapeBad} bad)`);
ok(statusBad === 0, `every pair records A5: alias 404 / canonical 200 (${statusBad} bad)`);
ok(normBad === 0, `every pair has a constructible normName and normNum (${normBad} bad)`);
for (const [family, exp] of Object.entries(EXPECTED_FAMILIES)) {
  ok(perFamily[family] === exp.count, `${family}: ${exp.count} pairs (got ${perFamily[family] ?? 0})`);
}

// ── The migration's embedded allowlist is the artifact, verbatim ────────────
console.log('\nmigration allowlist == artifact');
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const expectedValues = rows
  .map((r) => `    (${[q(r.family), q(r.alias_card_id), q(r.canonical_card_id), q(r.name), q(r.local_id),
    r.alias_upstream_status, r.canonical_upstream_status].join(', ')})`)
  .join(',\n') + ';';

const valuesStart = migration.indexOf('   alias_upstream_status, canonical_upstream_status)\nvalues\n');
const embedded = valuesStart === -1
  ? null
  : migration.slice(migration.indexOf('\nvalues\n', valuesStart) + '\nvalues\n'.length,
      migration.indexOf(';\n', valuesStart) + 1);
ok(embedded !== null, 'the migration contains an allowlist VALUES block');
ok(embedded === expectedValues,
  'the migration\'s 217 VALUES rows are byte-identical to the reviewed CSV — no hand edit, no drift');

ok(migration.includes(manifest.csv_sha256),
  'the migration stamps every evidence payload with the manifest csv_sha256');
ok(migration.includes(`'observed_at',               '${manifest.observed_at}'`),
  'the migration stamps every evidence payload with the manifest observed_at');

// ── The approved set-rename pairs appear identically in both SQL files ──────
// Compared with whitespace removed: both files align these tuples for
// readability, and column alignment is not part of the contract. The tuple
// CONTENT is.
console.log('\napproved set-rename pairs');
const squish = (s) => s.replace(/\s+/g, '');
const migrationSquished = squish(migration);
const validationSquished = squish(validation);
for (const [family, exp] of Object.entries(EXPECTED_FAMILIES)) {
  ok(migrationSquished.includes(
    squish(`('${family}','${exp.parent}','${exp.canonical}','${exp.sqlPattern}',${exp.count})`)),
    `migration §3 declares ${family}: ${exp.parent} -> ${exp.canonical} ${exp.sqlPattern} (${exp.count})`);
  // The validation file re-derives the map WITHOUT reading the allowlist, on
  // purpose (two independent derivations must agree). It must still use the
  // identical rename pair and pattern, or the agreement would be meaningless.
  ok(validationSquished.includes(squish(`('${exp.parent}','${exp.canonical}','${exp.sqlPattern}')`)),
    `validation re-derives ${family} from the same (${exp.parent} -> ${exp.canonical}) pair and pattern`);
  ok(validationSquished.includes(squish(`('${exp.parent}','${exp.sqlPattern}')`)),
    `validation uses the same ${exp.parent} pattern for the Q-6 candidate_card_ids sweep`);
}

// ── The frozen normalisers are transcribed, not reinvented ──────────────────
// The SQL copies live in pg_temp and cannot be executed from here, so this
// pins their TEXT. If someone "fixes" the missing trailing btrim in
// cat2d2_norm_name — which looks like an improvement and would silently
// diverge from src/utils/keys.js — this fails.
console.log('\nfrozen normalisers');
ok(migration.includes(
  "regexp_replace(lower(btrim(coalesce(s, ''))), '[^a-z0-9[:space:]]', '', 'g'),\n           '[[:space:]]+', ' ', 'g')"),
  'cat2d2_norm_name transcribes normName (lower, trim, strip, collapse — and NO trailing trim)');
ok(migration.includes("btrim(regexp_replace(lower(btrim(coalesce(s, ''))), '/.*$', ''))"),
  'cat2d2_norm_num transcribes normNum (lower, trim, cut at first slash, trim)');
ok(normName('Umbreon ☆') === 'umbreon ',
  'normName leaves the trailing space on \'Umbreon ☆\' — the behaviour the SQL copy must reproduce');
ok(normNum('SV001') !== normNum('SV1'),
  'normNum does not strip leading zeros, so SV001 and SV1 are different printings (A2)');

// ── The editorial constant is swept, not spot-fixed ─────────────────────────
console.log('\nartistEditorial sweep (CAT-2D §6.4 / Q-5)');
const editorialIds = [...editorial.matchAll(/\bid:\s*"([^"]+)"/g)].map((m) => m[1]);
ok(editorialIds.length >= 169, `swept ${editorialIds.length} editorial card ids`);
const aliasSet = new Set(aliasIds);
const stillObsolete = editorialIds.filter((id) => aliasSet.has(id));
ok(stillObsolete.length === 0,
  `no editorial id points at a Family A obsolete id (found ${stillObsolete.length}: ${stillObsolete.join(', ')})`);
ok(editorialIds.includes('swsh12.5gg-GG19'),
  'the Asako Ito notable card now points at the canonical survivor swsh12.5gg-GG19');
const gg19 = rows.find((r) => r.canonical_card_id === 'swsh12.5gg-GG19');
ok(gg19 && gg19.name === 'Altaria',
  'the survivor swsh12.5gg-GG19 is still named Altaria, so the expectName guard passes');

// ── Containment: Family B and unrelated namespaces are untouched ────────────
console.log('\ncontainment');
ok(rows.every((r) => !/-TG\d+$/i.test(r.alias_card_id) && !/tg-/i.test(r.canonical_card_id)),
  'no Trainer Gallery id appears anywhere in the alias set (Family B stays blocked)');
ok(rows.every((r) => ['swsh4.5', 'swsh12.5', 'cel25'].includes(r.alias_set_id)),
  'every alias comes from one of the three approved parent sets');
ok(!/^\s*(delete|truncate|drop table public\.cards)\b/im.test(migration),
  'the migration contains no DELETE or TRUNCATE — reference migration is UPDATE-only');
ok(/lock table public\.card_identity_aliases in share row exclusive mode;/.test(migration),
  'the migration serialises alias-topology writes before reading them (CAT-2D.1 binding requirement)');
ok(!/update\s+public\.user_import_rows/i.test(migration),
  'the migration never writes user_import_rows — historical evidence stays immutable');

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
