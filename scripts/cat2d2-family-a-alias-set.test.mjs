#!/usr/bin/env node
// scripts/cat2d2-family-a-alias-set.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
// CAT-2D.2 — Family A alias-set integrity harness (DEV-ONLY; no network, no
// database, no credentials).
//
// WHAT THIS PROVES
//
//   The migration's embedded 192-row allowlist, the reviewed CSV artifact, the
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
//   Nothing here touches the database. That the 192 obsolete ids actually exist
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

// SQL with `--` line comments removed, lowercased. Used wherever an assertion
// is about EXECUTABLE SQL rather than prose — the files are required to explain
// themselves at length, and a check that could not tell the two apart would
// force those explanations to be deleted.
const sqlCode = (t) => t.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n').toLowerCase();

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
};
const TOTAL = 192;

// Namespaces that MUST NOT appear anywhere in the executable mapping logic.
// Celebrations was removed from CAT-2D.2 on production evidence: its historical
// rows are stored as cel25-2A / cel25-15A1 / cel25-88A — legacy numbers from the
// printings they reproduce — not cel25-CC###. The transition changed the
// numbering as well as the set, so it cannot satisfy A2 and must not be
// re-admitted by widening a rule. It is CAT-2D.3, a separate evidence class.
const FORBIDDEN_NAMESPACES = [
  { token: 'cel25', why: 'Celebrations — CAT-2D.3, changed numbering (A2 cannot hold)' },
  { token: 'celebrations', why: 'Celebrations — CAT-2D.3' },
  { token: 'tg-', why: 'Trainer Galleries — Family B, blocked on maintenance ingestion' },
];

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
ok(manifest.families.length === 2, 'manifest describes exactly two families');
ok(manifest.scope === 'set rename with STABLE local_id only',
  'manifest states the narrowed scope: set rename with a stable local_id');
ok(Array.isArray(manifest.excluded) && manifest.excluded.some((e) => e.family === 'celebrations_cc'),
  'manifest records WHY Celebrations was excluded, rather than silently dropping it');

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
  'the migration\'s 192 VALUES rows are byte-identical to the reviewed CSV — no hand edit, no drift');

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
    `migration §2 declares ${family}: ${exp.parent} -> ${exp.canonical} ${exp.sqlPattern} (${exp.count})`);
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
// Inlined in the §5 map (they were pg_temp functions until the migration became
// a single `do`; `create function` would have needed dollar-quoting nested
// inside the block's own). Still text-pinned: if someone "fixes" the missing
// trailing btrim in the name transcription — which looks like an improvement
// and would silently diverge from src/utils/keys.js — this fails.
for (const side of ['o', 's']) {
  ok(migrationSquished.includes(squish(
    `regexp_replace(regexp_replace(lower(btrim(coalesce(${side}.name, ''))), '[^a-z0-9[:space:]]', '', 'g'), '[[:space:]]+', ' ', 'g')`)),
    `normName transcription applied to the ${side === 'o' ? 'obsolete' : 'survivor'} stored name (lower, trim, strip, collapse — and NO trailing trim)`);
  ok(migrationSquished.includes(squish(
    `btrim(regexp_replace(lower(btrim(coalesce(${side}.local_id, ''))), '/.*$', ''))`)),
    `normNum transcription applied to the ${side === 'o' ? 'obsolete' : 'survivor'} stored local_id`);
}
ok(/alias_norm_name <> canonical_norm_name/.test(migration),
  'P5 compares the two normalised STORED names, not the artifact');
ok(/alias_norm_num <> canonical_norm_num/.test(migration),
  'P6 compares the two normalised STORED local_ids');
ok(!/btrim\(regexp_replace\(regexp_replace\(lower\(btrim/.test(migration),
  'the name transcription has no trailing btrim — matching normName exactly');
ok(normName('Umbreon ☆') === 'umbreon ',
  'normName leaves the trailing space on \'Umbreon ☆\' — the behaviour the SQL copy must reproduce');
ok(normNum('SV001') !== normNum('SV1'),
  'normNum does not strip leading zeros, so SV001 and SV1 are different printings (A2)');

// ── One top-level statement (review finding: SQL Editor deployment) ─────────
//
// The first production run exposed the assumption that a top-level `begin;`,
// `create temp table ... on commit drop`, further top-level statements and
// `commit;` behave as one transaction/session. In the Supabase SQL Editor they
// do not — the temp tables were gone before the later statements ran.
//
// These assertions make the corrected shape a structural property of the file,
// so it cannot regress to a multi-statement, transaction-dependent deployment.
console.log('\none top-level statement');
const DOLLAR_TAG = '$cat2d2$';
const segments = sqlCode(migration).split(DOLLAR_TAG);
ok(segments.length === 3,
  `the migration has exactly one ${DOLLAR_TAG}-quoted body (found ${segments.length - 1} delimiter pair halves)`);
const outsideBody = (segments[0] ?? '') + (segments[2] ?? '');
const topLevel = outsideBody.split(';').map((s) => s.trim()).filter(Boolean);
ok(topLevel.length === 1 && topLevel[0] === 'do',
  `exactly one executable top-level statement, and it is the DO (found ${topLevel.length}: ${JSON.stringify(topLevel).slice(0, 120)})`);
ok(!/^\s*begin;\s*$/m.test(sqlCode(migration)),
  'no top-level BEGIN; — the migration does not depend on the client holding a transaction');
ok(!/^\s*commit;\s*$/m.test(sqlCode(migration)),
  'no top-level COMMIT;');
ok(!/\bexception\s+when\b/i.test(sqlCode(migration)),
  'no exception handler anywhere in the block — catching would open a subtransaction and could let execution continue past a failed proof');

// Every temp table must be created inside the DO body, and none referenced
// outside it.
const doBody = segments[1] ?? '';
const tempTables = [...migration.matchAll(/create temporary table (\w+)/g)].map((m) => m[1]);
ok(tempTables.length > 0, `the migration stages ${tempTables.length} temp table(s)`);
for (const t of new Set(tempTables)) {
  ok(doBody.includes(`create temporary table ${t}`),
    `${t} is created inside the single DO body`);
  ok(!outsideBody.includes(t),
    `${t} is never referenced outside the DO body`);
  ok(new RegExp(`create temporary table ${t}[^;]*on commit drop`).test(migration),
    `${t} is ON COMMIT DROP, so a successful run cleans up and a failed one never committed it`);
}
// A trailing summary SELECT would be a second top-level statement; the summary
// is emitted as notices instead.
ok(/raise notice 'CAT-2D\.2 SUMMARY/.test(migration),
  'the post-deploy summary is emitted as NOTICEs, not a trailing SELECT');
ok(/one server-side transaction/.test(migration) && /implicit transaction/.test(migration),
  'the file states its atomicity guarantee explicitly');

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

// ── Containment: excluded namespaces appear in NO executable mapping logic ──
//
// "Executable mapping logic" means anything that can produce or select an alias
// pair: the artifact, the migration's family table and allowlist, and the
// validation file's independent derivations. Explanatory prose is exempt — the
// files are REQUIRED to say why Celebrations is out, and a test that forbade
// the word would force that explanation to be deleted.
//
// The check therefore strips SQL line comments and JS/CSV commentary first, and
// asserts over what is left.
console.log('\ncontainment');
const migrationCode = sqlCode(migration);
const validationCode = sqlCode(validation);

for (const { token, why } of FORBIDDEN_NAMESPACES) {
  ok(!rows.some((r) => (r.alias_card_id + r.canonical_card_id + r.family).toLowerCase().includes(token)),
    `evidence artifact contains no "${token}" (${why})`);
  ok(!migrationCode.includes(token),
    `migration executable SQL contains no "${token}" (${why})`);
  ok(!validationCode.includes(token),
    `validation executable SQL contains no "${token}" (${why})`);
}

// The validation file SHOULD warn a future editor in prose. That is the
// opposite of a violation, so it is asserted positively.
ok(/cel25-2A|cel25-15A1/.test(validation),
  'the validation file warns, in prose, why Celebrations cannot be derived this way');
ok(rows.every((r) => ['swsh4.5', 'swsh12.5'].includes(r.alias_set_id)),
  'every alias comes from one of the two approved parent sets');
ok(new Set(rows.map((r) => r.family)).size === 2,
  'the artifact carries exactly two families');
ok(!/^\s*(delete|truncate|drop table public\.cards)\b/im.test(migration),
  'the migration contains no DELETE or TRUNCATE — reference migration is UPDATE-only');
ok(/lock table public\.card_identity_aliases in share row exclusive mode;/.test(migration),
  'the migration serialises alias-topology writes before reading them (CAT-2D.1 binding requirement)');
ok(!/update\s+public\.user_import_rows/i.test(migration),
  'the migration never writes user_import_rows — historical evidence stays immutable');

// ── §6 pre-state drift refusal (review finding 1) ───────────────────────────
//
// Phase A and the migration are separate SQL Editor runs with no lock held in
// between. A collector can favourite a card, save a price point, set an intent,
// add a binder row or clear an override in that window. Without an exact
// comparison the migration would happily migrate rows Phase A never captured,
// leaving public.cat2d2_pre_refs — the undo list — describing a different row
// set than the one that actually changed.
//
// These assertions pin the shape of the fix, not merely its presence: BOTH
// directions, on the full (table_name, row_key, card_id) identity, under the
// locks, before anything is written.
console.log('\n§6 pre-state drift refusal');
ok(/to_regclass\('public\.cat2d2_pre_refs'\) is null/.test(migration),
  'the migration refuses outright if Phase A never ran (cat2d2_pre_refs absent)');
ok(migrationSquished.includes(squish('create temporary table cat2d2_current_refs')),
  'the migration re-derives the current reference set under its own locks');

const exceptCurrentMinusPre = squish(
  'select table_name, row_key, card_id from cat2d2_current_refs except select table_name, row_key, card_id from public.cat2d2_pre_refs');
const exceptPreMinusCurrent = squish(
  'select table_name, row_key, card_id from public.cat2d2_pre_refs except select table_name, row_key, card_id from cat2d2_current_refs');
ok(migrationSquished.includes(exceptCurrentMinusPre),
  'direction 1: a reference that APPEARED after the capture is detected (current EXCEPT pre)');
ok(migrationSquished.includes(exceptPreMinusCurrent),
  'direction 2: a captured reference that VANISHED is detected (pre EXCEPT current)');
ok(/REFUSED \(§6\)[\s\S]{0,400}appeared AFTER the Phase A capture/.test(migration),
  'the APPEARED case refuses with a diagnostic that names the drift');
ok(/REFUSED \(§6\)[\s\S]{0,400}no longer exist/.test(migration),
  'the VANISHED case refuses with a diagnostic that names the drift');
ok((migration.match(/errcode = '40001'/g) || []).length === 2,
  'both drift refusals raise serialization_failure (40001), not a generic error');

// The identity compared must be all three columns. A count-only comparison
// would pass on one insert plus one delete.
ok(/select count\(\*\) into v_appeared from \(\s*select table_name, row_key, card_id/.test(migration),
  'the comparison is on (table_name, row_key, card_id), not on totals');
ok(/Comparing totals is not sufficient/.test(migration),
  'the file records WHY a count comparison would be insufficient');

// Ordering: locks -> map proven -> drift refusal -> alias insert -> reference UPDATE.
const iLock = migration.indexOf('lock table public.card_identity_aliases in share row exclusive mode;');
const iMap = migration.indexOf('create temporary table cat2d2_map');
const iDrift = migration.indexOf('create temporary table cat2d2_current_refs');
const iInsert = migration.indexOf('insert into public.card_identity_aliases\n  (alias_card_id, canonical_card_id, family, evidence, approved_by, slice)');
const iUpdate = migration.indexOf("'update public.%I t set card_id = m.canonical_card_id '");
ok(iLock > 0 && iMap > iLock, 'the alias-topology lock is taken before the map is derived');
ok(iDrift > iMap, 'the drift refusal runs after the 192 pairs are proven');
ok(iInsert > iDrift, 'the drift refusal runs BEFORE any alias row is inserted');
ok(iUpdate > iDrift, 'the drift refusal runs BEFORE any mutable reference is migrated');

// row_key must be built identically on both sides or the comparison is noise.
console.log('\nrow_key shapes match Phase A');
const ROW_KEYS = {
  card_extras: 'jsonb_build_object()',
  card_favorites: "jsonb_build_object('user_id', t.user_id)",
  card_overrides: "jsonb_build_object('user_id', t.user_id)",
  price_history: "jsonb_build_object('user_id', t.user_id, 'recorded_date', t.recorded_date)",
  user_binder_cards: "jsonb_build_object('binder_id', t.binder_id)",
  user_card_intent: "jsonb_build_object('user_id', t.user_id)",
};
for (const [table, builder] of Object.entries(ROW_KEYS)) {
  const b = squish(builder);
  ok(migrationSquished.includes(b) && validationSquished.includes(b),
    `${table}: row_key built as ${builder} in BOTH the migration and Phase A`);
  ok(migrationSquished.includes(squish(`from public.${table} t`)) &&
     validationSquished.includes(squish(`from public.${table} t`)),
    `${table}: scanned by both files`);
}

// ── Artist-first gate (review finding 3) ────────────────────────────────────
//
// cards_effective.illustrator = coalesce(card_extras.illustrator_override,
// cards.illustrator), but Artist Page loads by EXACT cards.artist_id. Moving
// card_extras onto the survivor therefore changes the rendered illustrator
// WITHOUT giving the survivor artist reachability. Once the obsolete row leaves
// the effective catalog the survivor is the only row that can represent the
// printing, so a survivor with a NULL artist_id would drop it off the page.
console.log('\nartist-first gate');
ok(/P11\. ARTIST-FIRST GATE/.test(migration), 'the migration carries the P11 artist gate');
ok(/alias_artist_id is not null\s*\n\s*and \(m?\.?canonical_artist_id is null or m?\.?canonical_artist_id <> m?\.?alias_artist_id\)/.test(migration.replace(/m\./g, 'm.')),
  'P11 refuses obsolete-non-null -> survivor NULL and obsolete-non-null -> different');
ok(/REFUSED \(P11\)/.test(migration), 'P11 refuses rather than warns');
ok(/does not repair cards\.artist_id|not repair public\.cards\.artist_id/.test(migration),
  'the migration states it does NOT repair cards.artist_id (no illustrator restoration)');
ok(!/update\s+public\.cards\s+set[\s\S]{0,80}artist_id/i.test(migration),
  'the migration never writes public.cards.artist_id');
ok(!/update\s+public\.cards\s+set[\s\S]{0,80}artist_id/i.test(validation),
  'the validation file never writes public.cards.artist_id either');

ok(/A-GATE 4: artist reachability/.test(validation), 'Phase A carries the pre-deploy artist gate');
ok(/'would_lose'/.test(validation) && /'would_conflict'/.test(validation) && /'preserved'/.test(validation),
  'Phase A reports preserved / would_lose / would_conflict counts');
ok(/'first_offenders'/.test(validation), 'Phase A reports the first offenders, not just a count');
ok(/C10\. ARTIST-FIRST GATE, re-asserted after deployment/.test(validation),
  'Phase C re-asserts the same invariant after deployment');
ok(/FAIL C10 \(artist\)/.test(validation), 'the post-deploy artist assertion fails closed');

// ── Unaffected-checksum domain (review finding 2) ───────────────────────────
//
// The original domain excluded only the 192 obsolete ids, which was wrong: §9
// moves card_extras onto the survivors, and cards_effective.illustrator is
// coalesce(illustrator_override, cards.illustrator), so a survivor can
// legitimately change. swsh12.5gg-GG69 MUST change — the override is migrated
// precisely because its casing differs from the survivor's native value.
console.log('\nunaffected-checksum domain');
const domain = squish('where not exists (\n  select 1 from public.cat2d2_pre_map m\n  where m.alias_card_id = ce.id or m.canonical_card_id = ce.id\n)');
ok((validationSquished.match(new RegExp(domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length >= 2,
  'both the Phase A capture and the Phase C re-check exclude BOTH sides of every pair');
ok(!/cards_effective_unaffected_checksum[\s\S]{0,400}ce\.local_id ~ '\^SV/.test(validation),
  'the old pattern-only exclusion is gone from the unaffected checksum');
ok(/expected_survivor_illustrator/.test(validation),
  'the expected survivor illustrator effects are captured, not hidden by the exclusion');
ok(/C8b\./.test(validation) && /do not report the predicted illustrator/.test(validation),
  'Phase C validates each migrated survivor against its predicted illustrator');
ok(/C8c\./.test(validation) && /received NO migrated card_extras row changed value/.test(validation),
  'Phase C proves every OTHER survivor is value-identical');
ok(/cards_effective_untouched_survivors_checksum/.test(validation),
  'a separate checksum covers the survivors that receive no override');

// ── Capture tables (review finding 4) ───────────────────────────────────────
console.log('\ncapture tables and rollback prose');
ok(/create table public\.cat2d2_pre_map/.test(validation),
  'the derived map is materialised so Phase A and Phase C share one domain');

// Phase A must be re-runnable. The first production attempt refused at A-GATE 1
// having already created all three tables, so `create table if not exists`
// would keep a previous revision's shape and contents — including rows for a
// family that has since been removed from the slice. Phase A therefore DROPS
// and rebuilds, and the operator never hand-edits an artifact.
const phaseA = validation.slice(validation.indexOf('PHASE A — PRE-DEPLOY'),
                               validation.indexOf('PHASE B — DEPLOY'));
const phaseH = validation.slice(validation.indexOf('FINAL GATE + PHASE H'));
for (const t of ['cat2d2_pre_refs', 'cat2d2_pre_map', 'cat2d2_pre_capture']) {
  ok(new RegExp(`revoke all on table public\\.${t} from public, anon, authenticated, service_role;`).test(validation),
    `${t} is privilege-locked on creation`);
  ok(new RegExp(`drop table if exists public\\.${t};[\\s\\S]{0,600}create table public\\.${t}`).test(phaseA),
    `${t} is dropped and rebuilt by Phase A, so a re-run is always clean`);
  ok(new RegExp(`drop table if exists public\\.${t};`).test(phaseH),
    `${t} is dropped in Phase H`);
  ok(!new RegExp(`create table if not exists public\\.${t}`).test(validation),
    `${t} is never created with "if not exists" — a stale shape must not survive a re-run`);
}
// The drops must be unreachable once aliases exist: cat2d2_pre_refs would be
// the undo list for a deployed migration.
const iGuard = phaseA.indexOf('card_identity_aliases holds % row(s)');
const iDrop = phaseA.indexOf('drop table if exists public.cat2d2_pre_capture;');
ok(iGuard > 0 && iDrop > iGuard,
  'the alias-table-empty guard runs BEFORE the capture tables are dropped');
const rollback = migration.slice(migration.indexOf('-- ROLLBACK'));
ok(/THE EXACT UNDO LIST IS public\.cat2d2_pre_refs/.test(rollback),
  'the rollback section names cat2d2_pre_refs as the exact undo list');
ok(!/cat2d2_pre_capture[\s\S]{0,120}\(table, key, card_id\)/.test(rollback),
  'the rollback section no longer attributes the per-row undo list to cat2d2_pre_capture');
ok(/cat2d2_pre_capture is a different thing/.test(rollback),
  'the rollback section says explicitly what cat2d2_pre_capture is instead');
ok(/restrict the update with\s*\n--\s*--\s*public\.cat2d2_pre_refs/.test(rollback),
  'the narrowing example uses cat2d2_pre_refs');

// ── Deployment sequencing (review finding 5) ────────────────────────────────
console.log('\ndeployment sequencing');
const migrationHeader = migration.slice(0, migration.indexOf('begin;'));
ok(/merge the PR and deploy the application change/.test(migrationHeader),
  'the documented order is SQL first, then merge/deploy the app');
ok(!/is best\s*\n--\s*deployed FIRST/.test(migrationHeader),
  'the app-first recommendation is gone');
ok(/FAILING SAFE, never substituting/.test(migrationHeader),
  'the brief notable-card omission is documented as an accepted fail-safe gap');
ok(/PHASE H \(cleanup\) at the appropriate safe point/.test(migrationHeader),
  'Phase H is sequenced after merge and smoke test, not immediately after validation');

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
