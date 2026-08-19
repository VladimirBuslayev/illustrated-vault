#!/usr/bin/env node
// scripts/cat3b-durability.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
// CAT-3B — durability and containment harness (DEV-ONLY; no network, no
// database, no credentials).
//
// WHAT THIS PROVES
//
//   CAT-3B's entire value is one claim: an approved image override SURVIVES
//   future catalog sync. That claim rests on structural properties of code and
//   SQL that a future edit could silently remove. This harness makes each of
//   them a test rather than a comment.
//
//     1. THE SYNC PATH CANNOT EXPRESS THE OVERRIDE COLUMN.
//        mapCardToRow's payload is the exact column list of the ON CONFLICT DO
//        UPDATE SET, so a key absent from it is unwritable by the routine path.
//        If someone later adds image_url_override to that payload, this fails.
//        Same argument, same shape, as CAT-1's G1 for series/release_date.
//
//     2. THE SYNC PATH NEVER ADDRESSES card_extras AT ALL.
//
//     3. THE VIEW REBUILD CHANGED EXACTLY ONE LINE.
//        The new cards_effective is diffed MECHANICALLY against the CAT-2D.1
//        production definition. Column count, order, artist_id position,
//        security_invoker, the card_extras join and the alias exclusion must
//        all survive, and image_url must be the only altered projection.
//
//     4. NO SECURITY DEFINER, AND THE PRIVATE ALIAS TABLE IS NOT READ.
//        CAT-2D.1 walled off card_identity_aliases from every runtime role.
//        CAT-3B validates against the public card_identity_resolution view
//        instead, so it never needs definer rights.
//
//     5. THE MIGRATION POPULATES NOTHING.
//
// Run: node scripts/cat3b-durability.test.mjs
// No test framework is introduced (matches the OL-0A/0C/0D/CAT-2D/CAT-3A
// harnesses).
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATION = join(ROOT, 'docs', 'sql', 'cat-3b-1-durable-image-override.sql');
const VALIDATION = join(ROOT, 'docs', 'sql', 'cat-3b-2-validation.sql');
const DURABILITY = join(ROOT, 'docs', 'sql', 'cat-3b-3-durability-test.sql');
const CAT2D1 = join(ROOT, 'docs', 'sql', 'cat-2d1-1-dark-alias-foundation.sql');
const SYNC = join(ROOT, 'sync', 'sync-cards.mjs');
const PREFLIGHT = join(ROOT, 'docs', 'sql', 'cat-3b-0-acl-preflight.sql');
const DOC = join(ROOT, 'docs', 'CAT-3B_DURABLE_IMAGE_OVERRIDE.md');

let passed = 0;
let failed = 0;
const failures = [];
const ok = (cond, msg) => {
  if (cond) { passed++; console.log(`  ok   ${msg}`); }
  else { failed++; failures.push(msg); console.error(`  FAIL ${msg}`); }
};

console.log('CAT-3B — durability and containment harness\n');

for (const [label, p] of [['migration', MIGRATION], ['validation', VALIDATION],
  ['durability test', DURABILITY], ['CAT-2D.1 baseline', CAT2D1],
  ['sync-cards.mjs', SYNC], ['ACL preflight', PREFLIGHT], ['spec doc', DOC]]) {
  ok(existsSync(p), `${label} file exists`);
}
if ([MIGRATION, VALIDATION, DURABILITY, CAT2D1, SYNC, PREFLIGHT, DOC].some(p => !existsSync(p))) {
  console.error('\nRequired files missing — aborting.');
  process.exit(1);
}

const migration = readFileSync(MIGRATION, 'utf8');
const validation = readFileSync(VALIDATION, 'utf8');
const durability = readFileSync(DURABILITY, 'utf8');
const cat2d1 = readFileSync(CAT2D1, 'utf8');
const sync = readFileSync(SYNC, 'utf8');
const preflight = readFileSync(PREFLIGHT, 'utf8');
const doc = readFileSync(DOC, 'utf8');

const strip = (s) => s.replace(/--[^\n]*/g, '');
const migrationCode = strip(migration);
const syncCode = sync.replace(/^\s*\/\/[^\n]*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

// The five columns CAT-3B adds. Used throughout.
const NEW_COLUMNS = [
  'image_url_override',
  'image_override_source_card_id',
  'image_override_evidence',
  'image_override_approved_by',
  'image_override_approved_at',
];

// ── 1. The sync path cannot express the override ─────────────────────────────
console.log('\n1. sync cannot express the override (the durability claim)');

const payloadMatch = syncCode.match(/function mapCardToRow\([^)]*\)\s*\{[\s\S]*?\n\}/);
ok(Boolean(payloadMatch), 'mapCardToRow located in sync-cards.mjs');
const payload = payloadMatch ? payloadMatch[0] : '';
const payloadKeys = [...payload.matchAll(/^\s{4}([a-z_]+):/gm)].map(m => m[1]);
ok(payloadKeys.length > 15,
  `mapCardToRow payload parsed (${payloadKeys.length} columns)`);
ok(payloadKeys.includes('image_url'),
  'sanity: the payload does write the RAW image_url column');
for (const col of NEW_COLUMNS) {
  ok(!payloadKeys.includes(col),
    `mapCardToRow payload cannot express "${col}"`);
}
// The upsert must still be payload-scoped; a bare column list elsewhere would
// break the "absent key is unwritable" argument.
ok(/upsert\(chunk,\s*\{\s*onConflict:\s*'id'\s*\}\)/.test(syncCode),
  'upsertRows still upserts the payload object with onConflict id');

console.log('\n2. sync never addresses card_extras');
ok(!/card_extras/.test(syncCode),
  'sync-cards.mjs contains no reference to card_extras in executable code');
const syncTables = [...syncCode.matchAll(/\.from\(['"]([a-z_]+)['"]\)/g)].map(m => m[1]);
ok(syncTables.length > 0, `sync table targets parsed: ${[...new Set(syncTables)].join(', ')}`);
// sync legitimately READS three objects: cards, artists (alias map) and
// cards_effective (the CAT-2B1 identity-collision guard). What matters for
// durability is the WRITE set, so read and write targets are asserted apart.
// Counting tables alone would miss an edit that turned a read into a write.
ok([...new Set(syncTables)].every(t => t === 'cards' || t === 'artists' || t === 'cards_effective'),
  'sync touches only cards, artists and cards_effective');
const syncWrites = [...syncCode.matchAll(
  /\.from\(['"]([a-z_]+)['"]\)[\s\S]{0,200}?\.(upsert|insert|update|delete)\(/g)].map(m => m[1]);
ok(syncWrites.length > 0, `sync write targets parsed: ${[...new Set(syncWrites)].join(', ')}`);
ok([...new Set(syncWrites)].every(t => t === 'cards'),
  'the ONLY table sync writes is public.cards');
ok(!syncWrites.includes('card_extras'), 'sync never writes card_extras');

// ── 3. The view rebuild changed exactly one line ─────────────────────────────
console.log('\n3. cards_effective rebuild — exactly one changed projection');

function extractView(src) {
  const m = src.match(/create or replace view public\.cards_effective[\s\S]*?;\s*/i);
  if (!m) return null;
  return m[0]
    .split('\n')
    .map(l => l.replace(/--.*$/, '').trim())
    .filter(Boolean);
}
const baseView = extractView(cat2d1);
const newView = extractView(migration);
ok(Boolean(baseView), 'CAT-2D.1 production view definition located');
ok(Boolean(newView), 'CAT-3B view definition located');

if (baseView && newView) {
  ok(baseView.length === newView.length,
    `view line count unchanged (${baseView.length} vs ${newView.length})`);
  const diffs = [];
  for (let i = 0; i < Math.max(baseView.length, newView.length); i++) {
    if (baseView[i] !== newView[i]) diffs.push({ i, before: baseView[i], after: newView[i] });
  }
  ok(diffs.length === 1,
    `exactly one line differs from the CAT-2D.1 definition (${diffs.length})`);
  if (diffs.length === 1) {
    ok(/^c\.image_url,$/.test(diffs[0].before || ''),
      'the changed line was `c.image_url,`');
    ok(/^coalesce\(ce\.image_url_override, c\.image_url\)\s+as image_url,$/.test(diffs[0].after || ''),
      'the changed line is now the image_url COALESCE');
  } else {
    for (const d of diffs) console.error(`       line ${d.i}: "${d.before}" -> "${d.after}"`);
  }
}

// Structural properties CAT-2D.1 made load-bearing.
ok(/with \(security_invoker = true\)/.test(migrationCode),
  'security_invoker = true preserved (not relaxed)');
ok(/left join public\.card_extras ce on c\.id = ce\.card_id/.test(migrationCode),
  'card_extras join preserved');
ok(/where not exists \(\s*select 1\s*from public\.card_identity_resolution r\s*where r\.alias_card_id = c\.id\s*\)/
  .test(migrationCode.replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')'))
  || /card_identity_resolution/.test(migrationCode),
  'CAT-2D.1 alias exclusion preserved');
ok(/coalesce\(ce\.illustrator_override, c\.illustrator\) as illustrator/.test(migrationCode),
  'illustrator override behavior preserved');

// artist_id must remain the final column.
const projection = (newView || []).join(' ');
ok(/c\.artist_id\s+from public\.cards c/.test(projection),
  'artist_id is still the last projected column');

// The stale pre-CAT-2D.1 definition must not be used as the base.
ok(/NOT from the stale/.test(migration),
  'migration states it was rebuilt from CAT-2D.1, not card_extras_and_view.sql');
ok(!/card_extras_and_view\.sql[\s\S]{0,40}(base|source of truth)/i.test(migration),
  'the stale view definition is not treated as the base');

// ── 4. No SECURITY DEFINER; private alias table untouched ────────────────────
console.log('\n4. privilege containment');

ok(!/security\s+definer/i.test(migrationCode),
  'migration contains no SECURITY DEFINER');
ok(/card_identity_resolution/.test(migrationCode),
  'admission validates against the public card_identity_resolution view');
ok(!/card_identity_aliases/.test(migrationCode),
  'migration never reads the private card_identity_aliases table');
ok(/grant select on public\.cards_effective to anon, authenticated, service_role/.test(migrationCode),
  'cards_effective grants restated unchanged');
ok(!/grant[\s\S]{0,80}card_extras[\s\S]{0,40}(insert|update|delete)/i.test(migrationCode),
  'no write privilege is granted on card_extras');

// ── 5. The migration populates nothing ───────────────────────────────────────
console.log('\n5. the migration writes no data');

ok(!/^\s*insert\s+into/im.test(migrationCode), 'no INSERT in the migration');
ok(!/^\s*update\s+public\./im.test(migrationCode), 'no UPDATE in the migration');
ok(!/^\s*delete\s+from/im.test(migrationCode), 'no DELETE in the migration');
ok(!/\bdefault\s+'/i.test(migrationCode),
  'no column default that could populate a value');
ok(/add column if not exists/i.test(migrationCode),
  'columns added idempotently');

// ── 6. Admission rules present ───────────────────────────────────────────────
console.log('\n6. admission rules');

ok(/is not an approved alias/i.test(migration), 'R2 rejects a non-alias source');
// Rejoin adjacent string-literal concatenations before matching: the exception
// text wraps across a `' '` seam in the source and would otherwise not read as
// one sentence.
const migJoined = migration.replace(/'\s+'/g, '').replace(/\s+/g, ' ');
ok(/does not match the current image_url of source/i.test(migJoined),
  'R3 rejects a value that is not the source image at admission');
ok(/provenance incomplete/i.test(migration), 'R1 rejects incomplete provenance');
ok(/card_extras_image_override_all_or_nothing/.test(migrationCode),
  'all-or-nothing CHECK constraint present');
ok(/card_extras_image_override_shape/.test(migrationCode),
  'shape CHECK constraint present');
ok(/assets\\?\.tcgdex\\?\.net/.test(migrationCode),
  'shape constraint pins the TCGdex asset host');
ok(/!~\* '\\\.\(png\|jpe\?g\|webp\|gif\|avif\|svg\)\$'/.test(migrationCode)
  || /png\|jpe\?g\|webp/.test(migrationCode),
  'shape constraint rejects file-extension URLs (imgSmall appends /low.webp)');
ok(/on delete restrict/i.test(migrationCode),
  'source FK uses ON DELETE RESTRICT');
ok(/references public\.cards\(id\)/i.test(migrationCode),
  'source FK targets public.cards(id)');

// ── 7. Admission-time semantics documented, not accidental ───────────────────
console.log('\n7. admission-time semantics');

const flatMig = migration.replace(/\s+/g, ' ');
ok(/ADMISSION-TIME SEMANTICS/.test(migration),
  'migration flags the admission-time decision explicitly');
ok(/DELIBERATE DESIGN DECISION, NOT A GAP/.test(flatMig),
  'migration states the non-re-evaluation is deliberate');
ok(/MAY diverge, and that divergence is CORRECT/.test(flatMig),
  'migration states post-admission divergence is correct');
ok(/diverged_as_designed/.test(durability),
  'durability test asserts divergence as a required outcome');

// ── 7b. Admission is not revalidation ────────────────────────────────────────
console.log('\n7b. admission is not revalidation');

const fnBody = migrationCode.slice(
  migrationCode.indexOf('create or replace function public.card_extras_admit_image_override'),
  migrationCode.indexOf('drop trigger if exists card_extras_admit_image_override'),
);
ok(fnBody.length > 400, 'admission function body located');

// The unchanged-bundle early return. Without it, editing source_note would drag
// an already-admitted override back through R3 — which compares against the
// source's CURRENT image_url, exactly the value provider churn is expected to
// change. A routine edit would then fail for an unrelated reason.
ok(/tg_op = 'UPDATE'/.test(fnBody),
  'the function branches on TG_OP');
for (const col of NEW_COLUMNS) {
  ok(new RegExp(`new\\.${col}\\s+is not distinct from old\\.${col}`).test(fnBody),
    `unchanged-bundle check covers "${col}"`);
}
// IS NOT DISTINCT FROM, not `=`: a plain equality treats two NULL bundles as
// changed and would re-admit on every unrelated edit.
ok(!/new\.image_url_override\s*=\s*old\.image_url_override/.test(fnBody),
  'the unchanged-bundle check does not use plain equality on nullable columns');
const earlyReturnIdx = fnBody.indexOf('is not distinct from');
const r2Idx = fnBody.indexOf('is not an approved alias');
ok(earlyReturnIdx !== -1 && r2Idx !== -1 && earlyReturnIdx < r2Idx,
  'the unchanged-bundle early return precedes R2/R3');

// Clearing a complete bundle must be permitted even when the source is no
// longer admissible — withdrawing an override is always allowed.
ok(/if new\.image_url_override is null then\s*return new;/.test(fnBody.replace(/\s+/g, ' ')),
  'a null override returns early (clearing is permitted)');
const nullReturnIdx = fnBody.indexOf('if new.image_url_override is null');
ok(nullReturnIdx !== -1 && nullReturnIdx < r2Idx,
  'the null-override return precedes R2/R3');

ok(/ADMISSION IS NOT REVALIDATION/.test(migration),
  'migration states the non-revalidation rule explicitly');
ok(/step 4c — unrelated source_note edit/.test(durability),
  'durability test covers an unrelated source_note edit after source churn');
ok(/step 4d — unrelated illustrator_override edit/.test(durability),
  'durability test covers an unrelated illustrator_override edit');
ok(/step 7 — bundle cleared/.test(durability),
  'durability test covers clearing the bundle');

// ── 7c. Provenance ACL ───────────────────────────────────────────────────────
console.log('\n7c. provenance ACL');

const PUBLIC_COLUMNS = ['card_id', 'illustrator_override', 'image_url_override'];
const WITHHELD_COLUMNS = [
  'image_override_evidence',
  'image_override_approved_by',
  'image_override_approved_at',
  'image_override_source_card_id',
];

// The blanket table grant must be revoked, not merely supplemented: GRANT alone
// cannot remove a table-level privilege an earlier deployment left behind, and
// a table-level grant covers every column the table will ever have.
ok(/revoke all on table public\.card_extras from anon, authenticated/.test(migrationCode),
  'migration revokes the blanket table-level grant on card_extras');
const grantMatch = migrationCode.match(
  /grant select \(([^)]*)\)\s*\n?\s*on public\.card_extras to ([^;]*);/);
ok(Boolean(grantMatch), 'migration re-grants column-level SELECT on card_extras');
if (grantMatch) {
  const granted = grantMatch[1].split(',').map(s => s.trim()).filter(Boolean);
  const grantees = grantMatch[2].split(',').map(s => s.trim()).filter(Boolean);
  ok(granted.length === PUBLIC_COLUMNS.length
    && PUBLIC_COLUMNS.every(c => granted.includes(c)),
    `column grant is exactly ${PUBLIC_COLUMNS.join(', ')} (got ${granted.join(', ')})`);
  for (const col of WITHHELD_COLUMNS) {
    ok(!granted.includes(col), `provenance column "${col}" is NOT publicly granted`);
  }
  ok(grantees.includes('anon') && grantees.includes('authenticated'),
    'the column grant targets anon and authenticated');
  ok(!grantees.includes('public') && !grantees.includes('PUBLIC'),
    'the column grant does not target PUBLIC');
}
// The whole design rests on the view staying invoker-rights; switching it to
// definer would let it read columns the caller cannot and make the ACL moot.
ok(!/security_definer/i.test(migrationCode)
  && /with \(security_invoker = true\)/.test(migrationCode),
  'the ACL is not solved by making cards_effective definer-rights');
ok(/NOT SOLVED BY MAKING cards_effective DEFINER-RIGHTS/.test(migration),
  'migration states that definer-rights is explicitly rejected');
ok(/service_role is deliberately NOT column-restricted/.test(migration),
  'migration explains why service_role is left alone');

// The preflight must exist and must be read before the grant section runs.
ok(existsSync(PREFLIGHT), 'ACL preflight file exists');
const preflightCode = strip(preflight);
ok(!/^\s*(insert|update|delete|alter|drop|create|grant|revoke)\s/im.test(preflightCode),
  'preflight is read-only — no DDL, DML or privilege statement');
for (const id of ['P-1', 'P-1b', 'P-2', 'P-3', 'P-4', 'P-5', 'P-5b', 'P-6']) {
  ok(preflight.includes(id), `preflight ${id} present`);
}
ok(/relacl/.test(preflightCode) && /has_public_grant/.test(preflightCode),
  'preflight detects grants made to PUBLIC (which role_table_grants omits)');
ok(/column_privileges/.test(preflightCode), 'preflight introspects column-level grants');
ok(/pg_policy/.test(preflightCode) && /relrowsecurity/.test(preflightCode),
  'preflight introspects RLS state and policies');
ok(/prosrc ilike '%card_extras%'/.test(preflightCode),
  'preflight finds routines that read card_extras directly');
// prosrc alone holds only the function BODY, and is empty for SQL-standard
// `BEGIN ATOMIC` functions (PG14+). pg_get_functiondef reconstructs the whole
// definition, so a reader hiding outside the body is still found.
ok(/pg_get_functiondef\(p\.oid\) ilike '%card_extras%'/.test(preflightCode),
  'preflight also inspects pg_get_functiondef, not only prosrc');
ok(/found_in_prosrc/.test(preflightCode) && /found_in_functiondef/.test(preflightCode),
  'preflight reports the two detection methods separately');
// pg_get_functiondef raises on aggregates and window functions.
ok(/p\.prokind in \('f', 'p'\)/.test(preflightCode),
  'preflight restricts prokind so pg_get_functiondef cannot raise');
ok(/prosqlbody|BEGIN ATOMIC/.test(preflight),
  'preflight records why prosrc alone is insufficient');
ok(/pg_get_viewdef\(c\.oid\) ilike '%card_extras%'/.test(preflightCode),
  'preflight finds views that read card_extras directly');
ok(/security_invoker_on/.test(preflightCode),
  'preflight confirms cards_effective is still invoker-rights');
ok(/RUN docs\/sql\/cat-3b-0-acl-preflight\.sql FIRST/.test(migration),
  'migration tells the operator to run the preflight first');

// ── 7c-2. The MEASURED baseline, not the assumed one ─────────────────────────
console.log('\n7c-2. measured production baseline');

// The preflight found anon/authenticated/service_role each holding seven
// table-level privileges, not the SELECT-only grant this package was drafted
// against. Both files must carry the measured state, or a reviewer would check
// the migration against a baseline that never existed.
const SEVEN = /DELETE, INSERT, REFERENCES, SELECT, TRIGGER,\s*(--\s*)?\s*TRUNCATE, UPDATE/;
ok(SEVEN.test(preflight.replace(/\s+/g, ' ')) || /TRUNCATE, UPDATE/.test(preflight),
  'preflight records the seven measured table-level privileges');
ok(/MEASURED PRODUCTION BASELINE/.test(preflight),
  'preflight labels the baseline as measured, not assumed');
ok(/MEASURED BASELINE/.test(migration),
  'migration §6 records the measured baseline');
ok(/WITH GRANT OPTION/i.test(migration) && /WITH GRANT\s*(--\s*)?\s*OPTION/i.test(migration.replace(/\s+/g, ' ')),
  'migration records that postgres holds the grants WITH GRANT OPTION');

// P-2 must no longer claim zero rows; P-2b is the explicit-ACL check.
ok(/RETURNS ROWS ON THE LIVE BASELINE, AND THAT IS CORRECT/.test(preflight),
  'P-2 states that returning rows is expected');
ok(/conflated effective privileges with explicit ones/.test(preflight.replace(/\s+/g, ' ')),
  'P-2 records why the earlier zero-rows expectation was wrong');
ok(/P-2b — EXPLICIT column ACLs/.test(preflight), 'P-2b exists');
ok(/pg_attribute a/.test(preflightCode) && /a\.attacl is not null/.test(preflightCode),
  'P-2b reads pg_attribute.attacl');
ok(/a\.attrelid = 'public\.card_extras'::regclass/.test(preflightCode),
  'P-2b is scoped to card_extras by regclass');
ok(/not a\.attisdropped/.test(preflightCode),
  'P-2b excludes dropped columns');
ok(/ZERO ROWS/.test(preflight), 'P-2b states the expected zero-row result');

// §6 must be classified as deliberate narrowing, with the dormancy argument.
ok(/DELIBERATE PRIVILEGE NARROWING, NOT A NO-OP ACL CONVERSION/.test(migration),
  'migration classifies §6 as deliberate privilege narrowing');
ok(/DORMANT RATHER THAN A LIVE HOLE/.test(migration),
  'migration explains why the broad write grants are dormant');
ok(/A GRANT permits addressing the table; an RLS POLICY permits touching the/.test(
  migration.replace(/--\s*/g, '').replace(/\s+/g, ' ')),
  'migration states the grant-versus-policy distinction');
ok(/genuine security tightening/.test(migration),
  'migration states the change is a security tightening');
ok(/service_role and postgres were never altered by §6/.test(
  migration.replace(/--\s*/g, '').replace(/\s+/g, ' ')),
  'migration confirms service_role is untouched');

// ── 7c-3. Two-level rollback with the measured pre-state ─────────────────────
console.log('\n7c-3. rollback levels');

ok(/TWO ROLLBACK LEVELS AND THEY ARE NOT INTERCHANGEABLE/.test(migration),
  'migration documents two distinct rollback levels');
ok(/LEVEL 1 — PREFERRED FUNCTIONAL ROLLBACK/.test(migration),
  'Level 1 functional rollback is documented');
ok(/LEVEL 2 — TRUE FULL PRE-CAT-3B ROLLBACK/.test(migration),
  'Level 2 full rollback is documented');
ok(/KEEP the restrictive CAT-3B column ACL/.test(migration),
  'Level 1 keeps the restrictive ACL, so no provenance is exposed');
ok(/ORDER IS LOAD-BEARING/.test(migration),
  'Level 2 flags that the step order matters');
ok(/Remove the CAT-3B columns FIRST, and only then/.test(
  migration.replace(/--\s*/g, '').replace(/\s+/g, ' ')),
  'Level 2 removes the columns before restoring the broad grants');
ok(/would expose[\s\S]{0,120}provenance columns|re-exposes the\s*(--\s*)?\s*provenance columns/
  .test(migration.replace(/\s+/g, ' ')),
  'migration states the hazard of restoring GRANT ALL while the columns exist');
// The restore must be the measured seven privileges, not SELECT-only.
ok(/grant delete, insert, references, select, trigger, truncate, update/i.test(migration),
  'Level 2 restores the MEASURED seven privileges');
ok(!/grant select on table public\.card_extras to anon, authenticated;/.test(migration),
  'the incorrect SELECT-only rollback text is gone');
ok(/stop after\s*(--\s*)?\s*step 3/.test(migration.replace(/\s+/g, ' ')),
  'migration offers keeping the tightening as a legitimate end state');

// ── 7c-4. V-1 before-capture on record ───────────────────────────────────────
console.log('\n7c-4. V-1 before-capture');

ok(/BEFORE-CAPTURE ON RECORD/.test(validation),
  'V-1 records the production before-capture');
ok(/5a3348d04081450b251b79c1a492dd3c/.test(validation),
  'the measured payload_digest is committed for comparison');
ok(/2026-06-24 01:12:49\.298647\+00/.test(validation)
  && /2026-08-17 18:57:27\.574545\+00/.test(validation),
  'the measured timestamps are committed');
ok(/card_extras_set_updated_at trigger fires on ANY update/.test(
  validation.replace(/--\s*/g, '').replace(/\s+/g, ' ')),
  'V-1 explains why latest_updated_at is load-bearing');

// ── 7d. The migration is ATOMIC ──────────────────────────────────────────────
console.log('\n7d. migration transaction boundary');

// CAT-3B changes columns, constraints, a function, a trigger, a view definition
// AND privileges. A half-applied state is a product defect: the worst shape is
// the view rewritten while the ACL revoke has not landed, which would leave the
// provenance columns live AND publicly readable. PostgreSQL makes DDL and
// GRANT/REVOKE transactional, so one wrapper is sufficient.
const beginMatches = [...migrationCode.matchAll(/^\s*begin\s*;/gim)];
const commitMatches = [...migrationCode.matchAll(/^\s*commit\s*;/gim)];
ok(beginMatches.length === 1, `exactly one BEGIN; in executable SQL (${beginMatches.length})`);
ok(commitMatches.length === 1, `exactly one COMMIT; in executable SQL (${commitMatches.length})`);
ok(!/^\s*rollback\s*;/im.test(migrationCode), 'the migration contains no ROLLBACK');

if (beginMatches.length === 1 && commitMatches.length === 1) {
  const bIdx = beginMatches[0].index;
  const cIdx = commitMatches[0].index;
  ok(bIdx < cIdx, 'BEGIN precedes COMMIT');

  // The transaction must ENCLOSE §1–§6. Anchors are executable statements
  // unique to each section, so a section drifting outside the wrapper fails.
  const enclosed = [
    ['§1 add column', /alter table public\.card_extras\s*\n\s*add column if not exists image_url_override/],
    ['§1 FK', /card_extras_image_override_source_fk/],
    ['§2 all-or-nothing', /card_extras_image_override_all_or_nothing/],
    ['§3 shape', /card_extras_image_override_shape/],
    ['§4 function', /create or replace function public\.card_extras_admit_image_override/],
    ['§4 trigger', /create trigger card_extras_admit_image_override/],
    ['§5 view', /create or replace view public\.cards_effective/],
    ['§6 revoke', /revoke all on table public\.card_extras/],
    ['§6 grant', /grant select \(card_id/],
  ];
  for (const [label, re] of enclosed) {
    const m = migrationCode.match(re);
    ok(Boolean(m) && m.index > bIdx && m.index < cIdx,
      `${label} is inside the migration transaction`);
  }
  // The §7 rollback notes must sit OUTSIDE the committed unit. They are
  // comments, so they must not appear in executable code at all.
  const after = migrationCode.slice(cIdx);
  ok(!/create or replace view/i.test(after),
    'nothing executable follows COMMIT (the rollback section is commentary)');
}
ok(/ATOMIC\. §1 through §6 execute inside ONE explicit transaction/.test(migration),
  'the execution contract states the migration is atomic');
ok(/autocommits each one/.test(migration),
  'the contract warns against statement-by-statement execution in an autocommit console');

// ── 7e. Constraint guards are scoped to card_extras ──────────────────────────
console.log('\n7e. constraint existence guards');

// conname is unique PER TABLE, not per schema. A guard checking conname alone
// would silently skip creating a constraint if any other relation happened to
// carry the same name — leaving CAT-3B's integrity rules absent while the
// migration reported success.
const constraintGuards = [...migrationCode.matchAll(
  /select 1 from pg_constraint[\s\S]{0,220}?then/gi)];
ok(constraintGuards.length === 5,
  `all five constraint guards located (${constraintGuards.length})`);
for (const g of constraintGuards) {
  const nameMatch = g[0].match(/conname = '([a-z_]+)'/);
  const label = nameMatch ? nameMatch[1] : '(unnamed)';
  ok(/conrelid = 'public\.card_extras'::regclass/.test(g[0]),
    `guard for "${label}" is scoped to public.card_extras`);
}
const bareGuards = [...migrationCode.matchAll(/from pg_constraint/gi)].length;
ok(bareGuards === constraintGuards.length,
  'every pg_constraint reference is part of a scoped guard');

// ── 7f. V-6 proves the POST-deploy ACL state ─────────────────────────────────
console.log('\n7f. V-6 post-deploy ACL gate');

ok(/V-6 — POST-DEPLOY ACL STATE/.test(validation), 'V-6 exists');
for (const id of ['V-6a', 'V-6b', 'V-6b-summary', 'V-6c']) {
  ok(validation.includes(id), `${id} present`);
}
const v6 = validation.slice(validation.indexOf('-- V-6 — POST-DEPLOY'));
ok(v6.length > 1000, 'the V-6 slice is substantive');
// PUBLIC must be detected from raw relacl — role_table_grants omits it.
ok(/unnest\(coalesce\(c\.relacl/.test(v6) && /split_part\(a::text, '=', 1\) = ''/.test(v6),
  'V-6a detects a PUBLIC grant from raw relacl, not information_schema');
ok(/has_public_grant/.test(v6), 'V-6a reports has_public_grant');
ok(/table_level_grants/.test(v6),
  'V-6a proves anon/authenticated hold NO table-level privilege');
ok(/relrowsecurity/.test(v6), 'V-6a proves RLS is still enabled');
// The three readable columns, and the seven withheld, both asserted.
ok(/'card_id', 'illustrator_override', 'image_url_override'/.test(v6),
  'V-6b pins the three intended readable columns');
ok(/column_privileges/.test(v6),
  'V-6b reads EFFECTIVE column privileges (table-level grants included)');
ok(/LEAK/.test(v6) && /leaked_columns/.test(v6),
  'V-6b names any leaked provenance column explicitly');
ok(/all_match/.test(v6), 'V-6b-summary gives a pass/fail');

// ── PER-ROLE PROPERTY ──────────────────────────────────────────────────────
// The defect this pins: `p.grantee in ('anon','authenticated')` inside a single
// EXISTS proves only that AT LEAST ONE runtime role can read an intended
// column. A state where `authenticated` held all three grants and `anon` held
// none would have passed, while every anonymous visitor got a permission error
// on every card image.
// Comments are stripped first: V-6b's header QUOTES the rejected pattern while
// explaining why it was wrong, so the phrase legitimately appears in prose.
// What must be absent is the executable form.
const v6Code = strip(v6);
ok(!/p\.grantee in \('anon', ?'authenticated'\)/.test(v6Code),
  'V-6b does NOT collapse the two roles into one EXISTS');
ok(/p\.grantee\s+= i\.grantee/.test(v6Code),
  'V-6b matches privileges against the specific role being tested');
// V-6a legitimately aggregates both roles: its claim is "table-level grants
// must be ZERO", and any non-zero count fails regardless of which role caused
// it. The per-role requirement applies to V-6b's column grants.
ok(/table_level_grants/.test(v6Code) && /table_level_detail/.test(v6Code),
  'V-6a reports both the table-level count and which grantee holds it');

// The role list must be a VALUES list crossed with the columns — not derived
// from the grants themselves. Otherwise a role holding NO privileges would
// simply vanish from the result instead of failing.
const roleValues = /with roles \(grantee\) as \(\s*values \('anon'\), \('authenticated'\)\s*\)/;
const v6bBlocks = v6.split('V-6b').length - 1;
ok(v6bBlocks >= 2, 'V-6b has both the per-row detail and the summary');
ok((v6.match(roleValues) || []).length >= 1
  || (v6.match(/values \('anon'\), \('authenticated'\)/g) || []).length >= 2,
  'the role list is an explicit VALUES list, so a privilege-less role cannot vanish');
ok((v6.match(/cross join/gi) || []).length >= 2,
  'both V-6b statements CROSS JOIN roles against the live column list');
ok(/a\.grantee,\s*\n\s*a\.column_name/.test(v6),
  'the per-row output is keyed by (grantee, column_name)');
ok(/group by a\.grantee/.test(v6),
  'the summary aggregates PER ROLE, giving one pass/fail row each');
ok(/missing_columns/.test(v6),
  'the summary names which required grants a role is missing');
// Verdicts must identify WHICH role, not just that something is wrong.
ok(/\|\| a\.grantee \|\|/.test(v6),
  'LEAK / MISSING verdicts name the affected role');
ok(/2 roles x 10 columns|20 rows/.test(v6),
  'V-6b documents the expected 20-row shape');
ok(/still produces its ten rows and\s*--\s*fails loudly|cannot disappear from the output/
  .test(v6.replace(/\s+/g, ' ')) || /fails loudly/.test(v6),
  'V-6b records why a privilege-less role must still appear');
ok(/write_policies/.test(v6), 'V-6c proves no write policy was introduced');
ok(/card_extras_public_select/.test(v6), 'V-6c pins the existing SELECT policy');
ok(/polpermissive/.test(v6), 'V-6c proves the policy is still PERMISSIVE');
// Pre-state vs post-state division of labour must be stated, not assumed.
ok(/P-1…P-6\s+establish the PRE-state|proves the PRE-state/.test(
  validation.replace(/\s+/g, ' ')),
  'validation states P-1..P-6 are the pre-state gate');
ok(/V-6 IS THE POST-STATE GATE/.test(validation),
  'validation states V-6 is the post-state gate');
ok(/P-1…P-6/.test(doc) || /P-1…P-6/.test(preflight),
  'the pre-state gate is documented');

// ── 8. Validation coverage ───────────────────────────────────────────────────
console.log('\n8. validation coverage');

const vCode = strip(validation);
ok(!/^\s*(insert|update|delete|alter|drop|create)\s/im.test(vCode),
  'validation file is SELECT-only');
ok(/V-1/.test(validation) && /V-2/.test(validation) && /V-3/.test(validation)
  && /V-4/.test(validation) && /V-5/.test(validation),
  'V-1 through V-5 present');
// V-1 must checksum ONLY pre-existing columns.
// Slice by the statement banner. indexOf('V-1') would land in the header
// comment, which names V-1..V-5 before any SQL exists — the same trap the
// CAT-3A harness hit.
const v1 = validation.slice(validation.indexOf('-- V-1 —'), validation.indexOf('-- V-2 —'));
ok(v1.length > 200 && v1.includes('public.card_extras'),
  'the V-1 slice is bounded by its own statement banner');
ok(/ce\.card_id,\s*ce\.illustrator_override,\s*ce\.source_note,\s*ce\.created_at,\s*ce\.updated_at/
  .test(v1.replace(/\s+/g, ' ')),
  'V-1 projects only the five pre-existing card_extras columns');
for (const col of NEW_COLUMNS) {
  ok(!v1.includes(col), `V-1 checksum excludes the new column "${col}"`);
}
// Comments must be stripped first: V-1's header EXPLAINS why a whole-row
// to_jsonb(ce) checksum would be useless, so the phrase legitimately appears in
// prose. What must be absent is the executable form.
ok(!/to_jsonb\(ce\)/.test(strip(v1)),
  'V-1 does not use a whole-row checksum (which adding columns would break)');
ok(/to_jsonb\(t\)/.test(strip(v1)),
  'V-1 checksums the explicit pre-existing-column projection instead');
ok(/rows_with_any_override_field/.test(validation),
  'V-2 catches a partially populated override row');
ok(/except all/i.test(validation),
  'V-3 proves row-for-row equivalence with a symmetric EXCEPT ALL diff');
ok(/artist_id_is_column_14/.test(validation), 'V-4 pins artist_id at column 14');
ok(/security_invoker_on/.test(validation), 'V-4 pins security_invoker');
ok(/is_security_definer/.test(validation), 'V-5 pins that the trigger is NOT definer');
ok(/reads_private_alias_table/.test(validation),
  'V-5 pins that the private alias table is not read');

// ── 9. Durability test containment ───────────────────────────────────────────
console.log('\n9. durability test containment');

ok(/NON-PRODUCTION ONLY/.test(durability), 'durability test is labelled non-production');
ok(/rollback;/i.test(durability), 'durability test ends in ROLLBACK');
ok(/DEFERRED OBSERVATION/.test(durability),
  'durability test states the CAT-1 deferral disposition if no environment exists');
ok(/step 4b — alias image nulled/.test(durability),
  'durability test covers the nulled-source case, not just a changed value');
ok(/THIS IS THE CENTRAL RESULT OF CAT-3B/.test(durability),
  'the central assertion is marked');

// ── 10. Documentation wording ────────────────────────────────────────────────
console.log('\n10. documentation wording');

const flatDoc = doc.replace(/\s+/g, ' ');
ok(/restricted to \*\*approved alias relationships\*\*|restricted to approved alias relationships/i.test(flatDoc),
  'doc says the channel is restricted to approved alias relationships');
ok(/\*?not\*? hard-coded/i.test(flatDoc),
  'doc says the channel is NOT hard-coded to a fixed card set');
ok(/do not auto-apply|never auto-applied|nothing is applied automatically/i.test(flatDoc),
  'doc says future aliases do not auto-apply');
ok(/explicit override write/i.test(flatDoc),
  'doc says an explicit override write remains required');
ok(/192/.test(doc) && !/hard-coded to the (current )?192/i.test(flatDoc),
  'doc references the 192 as measurement, not as a hard-coded scope');
ok(/PREPARED — NOT EXECUTED/.test(doc), 'doc states nothing has been deployed');
ok(/out of scope/i.test(flatDoc), 'doc carries an explicit out-of-scope list');
ok(/CAT-3A[\s\S]{0,200}(did not|selected no)/i.test(flatDoc),
  'doc preserves that CAT-3A selected no slice');

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
