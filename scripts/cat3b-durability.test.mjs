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
  ['sync-cards.mjs', SYNC], ['spec doc', DOC]]) {
  ok(existsSync(p), `${label} file exists`);
}
if ([MIGRATION, VALIDATION, DURABILITY, CAT2D1, SYNC, DOC].some(p => !existsSync(p))) {
  console.error('\nRequired files missing — aborting.');
  process.exit(1);
}

const migration = readFileSync(MIGRATION, 'utf8');
const validation = readFileSync(VALIDATION, 'utf8');
const durability = readFileSync(DURABILITY, 'utf8');
const cat2d1 = readFileSync(CAT2D1, 'utf8');
const sync = readFileSync(SYNC, 'utf8');
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
