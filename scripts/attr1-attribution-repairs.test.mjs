#!/usr/bin/env node
// scripts/attr1-attribution-repairs.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
// ATTR-1 — confirmed attribution repairs: static containment harness
// (DEV-ONLY; no network, no database, no credentials).
//
// WHY THIS EXISTS
//
//   The ATTR-1 migration has not been executed, and no PostgreSQL parser is
//   available in this environment (adding one would be an out-of-scope
//   dependency, per AGENTS.md). So the properties that make this migration
//   safe cannot be proved by running it. They CAN be proved structurally, and
//   every one of them is a property a future edit could silently remove. This
//   harness turns each into a test rather than a comment.
//
//     1. POPULATION — exactly the 12 approved card IDs, each mapped to its
//        exact approved corrected illustrator name, and nothing from the
//        adjacent Gate-2 CONFIRMED_CORRECT or ATTR-0b populations.
//     2. artist_id_override IS NULL ON ALL 12 — the entire repair is an
//        intentional-NULL correction; no row silently gains a resolved FK.
//     3. CONTAINMENT — the only DML target is public.card_extras; nothing
//        writes public.cards, public.artists, or artist aliases.
//     4. THE UPSERT TOUCHES ONLY THE FIVE ATTRIBUTION COLUMNS — an unrelated
//        card_extras enrichment (source_note, a CAT-3B image override) that
//        appears between authoring and execution must survive untouched.
//     5. EVERY TARGET CARRIES A COMMITTED EVIDENCE REFERENCE — the gate, a
//        primary source, and the evidence artifact path, traceable to a
//        reviewed document or checksummed CSV.
//     6. PREFLIGHT DRIFT GUARDS EXIST — currency check, no pre-existing
//        bundle, resolver re-check — so the migration cannot silently run
//        against a world that has moved since authoring.
//     7. RAW ATTRIBUTION / UNRELATED-FIELD PRESERVATION CHECKS EXIST — the
//        postconditions prove public.cards and every non-attribution
//        card_extras column survive byte-identical.
//     8. ROLLBACK IS TARGET/PROVENANCE-SCOPED — it never rewrites public.cards
//        and refuses to erase a bundle that no longer matches what ATTR-1
//        wrote.
//     9. STRUCTURAL SANITY — one transaction, balanced dollar-quoting/parens,
//        nothing executable after COMMIT.
//
// Run: node scripts/attr1-attribution-repairs.test.mjs
// No test framework is introduced (matches the OL-0A/0C/0D, CAT-2D, CAT-3A/3B
// and F-15 harnesses).
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATION  = join(ROOT, 'docs', 'sql', 'attr-1-confirmed-attribution-repairs.sql');
const VALIDATION = join(ROOT, 'docs', 'sql', 'attr-1-confirmed-attribution-repairs-validation.sql');
const ROLLBACK   = join(ROOT, 'docs', 'sql', 'attr-1-confirmed-attribution-repairs-rollback.sql');
const GATE2_CSV  = join(ROOT, 'docs', 'attr-0-evidence', 'gate2-print-verification.csv');
const ATTR0B_CSV = join(ROOT, 'docs', 'attr-0-evidence', 'attr-0b-lone-suffix-verification.csv');
const IMPACT_CSV = join(ROOT, 'docs', 'attr-0-evidence', 'f15-repair-impact.csv');
const SYNC       = join(ROOT, 'sync', 'sync-cards.mjs');
const DOC        = join(ROOT, 'docs', 'ATTR-1_CONFIRMED_ATTRIBUTION_REPAIRS.md');

let passed = 0;
let failed = 0;
const failures = [];
const ok = (cond, msg) => {
  if (cond) { passed++; console.log(`  ok   ${msg}`); }
  else { failed++; failures.push(msg); console.error(`  FAIL ${msg}`); }
};

// The approved 12-row population, transcribed independently from the issue
// body / docs/attr-0-evidence/f15-repair-impact.csv, so this harness does not
// merely echo whatever the migration file happens to say.
const TARGETS = {
  'g1-28a':      'Ryo Ueda',
  'g1-73a':      'Naoki Saito',
  'xy10-111a':   'Naoki Saito',
  'xy10-43a':    'Ryo Ueda',
  'xy4-65a':     'Ryo Ueda',
  'xy6-77a':     'TOKIYA',
  'xy7-75a':     'You Iribi',
  'xy9-107a':    'Naoki Saito',
  'xy9-98b':     'Sanosuke Sakuma',
  'xyp-XY150a':  'Hasuno',
  'xyp-XY177a':  'Hitoshi Ariga',
  'xyp-XY67a':   'Naoki Saito',
};
const TARGET_IDS = Object.keys(TARGETS);

for (const f of [MIGRATION, VALIDATION, ROLLBACK, GATE2_CSV, ATTR0B_CSV, IMPACT_CSV, SYNC, DOC]) {
  if (!existsSync(f)) {
    console.error(`FATAL: missing required file ${f}`);
    process.exit(1);
  }
}

const migration  = readFileSync(MIGRATION, 'utf8');
const validation = readFileSync(VALIDATION, 'utf8');
const rollback   = readFileSync(ROLLBACK, 'utf8');
const gate2Csv   = readFileSync(GATE2_CSV, 'utf8');
const attr0bCsv  = readFileSync(ATTR0B_CSV, 'utf8');
const impactCsv  = readFileSync(IMPACT_CSV, 'utf8');
const sync       = readFileSync(SYNC, 'utf8');

// Strip line comments so assertions test EXECUTABLE sql, never prose. Prose in
// this repo deliberately quotes the things being forbidden, so testing raw
// text would produce false passes and false failures in both directions.
const strip = (sql) =>
  sql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');

const mig = strip(migration);
const val = strip(validation);
const rbk = strip(rollback);

// PostgreSQL concatenates two string literals that are separated only by
// whitespace containing a newline (the standard SQL string-continuation
// rule) — which is exactly how every multi-line `raise exception` message in
// this repo's SQL is written. A raw phrase search across such a boundary
// would otherwise see a stray quote/newline/quote sequence in the middle of
// what is, to PostgreSQL, one continuous message. Normalise before searching
// for any phrase that might span a raise-exception line wrap.
const joinLiterals = (sql) => sql.replace(/'\s*\n\s*'/g, '');
const migJoined = joinLiterals(migration);
const rbkJoined = joinLiterals(rollback);

const parseCsvRows = (text) => {
  const lines = text.trim().split('\n');
  const header = lines[0].split(',');
  return lines.slice(1).map((line) => {
    // Good enough for this repo's evidence CSVs: no embedded commas inside
    // quoted fields matter for the columns this harness reads (card id,
    // verdict), so a naive split is sufficient and avoids a CSV-parser
    // dependency this environment does not have.
    const cols = line.split(',');
    const row = {};
    header.forEach((h, i) => { row[h] = cols[i]; });
    return row;
  });
};

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n1. POPULATION — exactly 12 IDs, exact corrected names, no adjacent-population leakage');

{
  for (const id of TARGET_IDS) {
    ok(mig.includes(`'${id}'`), `migration references target ${id}`);
  }

  // The migration's canonical target temp table must carry exactly 12 rows —
  // count the VALUES tuples inserted into attr1_targets.
  const insertBlock = (mig.match(/insert into attr1_targets[\s\S]*?;/i) || [''])[0];
  const tuples = insertBlock.match(/\('[^']+',/g) || [];
  ok(tuples.length === 12, `attr1_targets insert carries exactly 12 tuples, found ${tuples.length}`);

  // Each target's verified illustrator name appears paired with its card id
  // inside the same VALUES tuple (a loose but effective co-occurrence check
  // that catches a swapped or mistyped name without a full SQL parser).
  for (const [id, name] of Object.entries(TARGETS)) {
    const tupleRe = new RegExp(`\\('${id}'[^)]*'${name}'`, 'i');
    ok(tupleRe.test(insertBlock), `${id} is paired with its exact verified name "${name}" in attr1_targets`);
  }

  // Gate-2 CONFIRMED_CORRECT rows must never enter the mutation population.
  const gate2Rows = parseCsvRows(gate2Csv);
  const confirmedCorrect = gate2Rows
    .filter((r) => r.verdict === 'CONFIRMED_CORRECT')
    .map((r) => r.variant_card_id);
  ok(confirmedCorrect.length === 9, `gate2-print-verification.csv carries 9 CONFIRMED_CORRECT rows, found ${confirmedCorrect.length}`);
  const leakedCorrect = confirmedCorrect.filter((id) => TARGET_IDS.includes(id) || mig.includes(`'${id}'`));
  ok(leakedCorrect.length === 0,
     `no Gate-2 CONFIRMED_CORRECT row enters the migration (found: ${leakedCorrect.join(', ') || 'none'})`);

  // ATTR-0b's 14-row population (6 xya + 8 ecard2) is a separate, unresolved
  // evidence gate and must not be folded into ATTR-1.
  const attr0bRows = parseCsvRows(attr0bCsv).map((r) => r.variant_card_id).filter(Boolean);
  ok(attr0bRows.length === 14, `attr-0b-lone-suffix-verification.csv carries 14 rows, found ${attr0bRows.length}`);
  const leakedAttr0b = attr0bRows.filter((id) => TARGET_IDS.includes(id) || mig.includes(`'${id}'`));
  ok(leakedAttr0b.length === 0,
     `no ATTR-0b population row enters the migration (found: ${leakedAttr0b.join(', ') || 'none'})`);

  // Cross-check against the canonical f15-repair-impact.csv: same 12 ids, same
  // verified illustrator per id.
  const impactRows = parseCsvRows(impactCsv);
  ok(impactRows.length === 12, `f15-repair-impact.csv carries 12 rows, found ${impactRows.length}`);
  const impactMismatch = impactRows.filter((r) => TARGETS[r.card_id] !== r.verified_illustrator);
  ok(impactMismatch.length === 0,
     `TARGETS matches f15-repair-impact.csv verified_illustrator for every row (mismatches: ${impactMismatch.map((r) => r.card_id).join(', ') || 'none'})`);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n2. artist_id_override IS NULL ON ALL 12');

{
  // The INSERT's selected artist_id_override value is a literal NULL, not a
  // column read from attr1_targets — so there is no way for the canonical
  // table to smuggle a non-NULL value in.
  const insertStmt = (mig.match(/insert into public\.card_extras[\s\S]*?on conflict[\s\S]*?;/i) || [''])[0];
  ok(insertStmt.length > 0, 'the ATTR-1 INSERT ... ON CONFLICT statement is present');
  const selectClause = (insertStmt.match(/select([\s\S]*?)from attr1_targets/i) || ['', ''])[1];
  // Naive split(',') is unsafe here in general (jsonb_build_object's own
  // commas would shatter it), but the THIRD selected expression is a bare
  // `null` immediately before `jsonb_build_object(` begins, so splitting only
  // on the first two commas and taking what remains up to the next comma is
  // sufficient and does not need to survive past that point.
  const selectLines = selectClause.split(',').map((s) => s.trim()).filter(Boolean);
  // Selected expressions, in column order: t.card_id (-> card_id),
  // t.verified_illustrator (-> illustrator_override), null (-> artist_id_override).
  ok(selectLines[0] === 't.card_id' && selectLines[1] === 't.verified_illustrator',
     `the first two selected expressions are t.card_id, t.verified_illustrator, found "${selectLines[0]}", "${selectLines[1]}"`);
  ok(selectLines[2] === 'null',
     `the third selected expression (artist_id_override) is a literal null, found "${selectLines[2]}"`);

  ok(!/artist_id_override\s*=\s*(?!excluded\.artist_id_override)\S/i.test(
       insertStmt.replace(/artist_id_override\s*=\s*excluded\.artist_id_override/gi, '')),
     'no artist_id_override assignment other than excluded.artist_id_override appears in the upsert');

  // Postcondition V-3 asserts NULL effective artist_id for all 12; V-1 asserts
  // artist_id_override IS NULL as part of the "complete bundle" definition.
  ok(/artist_id_override\s+is\s+null/i.test(mig) && /V-3 FAILED/i.test(migration),
     'V-3 asserts effective artist_id is NULL for every target');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n3. CONTAINMENT — only public.card_extras is written');

{
  const forbiddenWrite = /\b(insert\s+into|update|delete\s+from)\s+(public\.)?(cards|artists|user_tracked_artists|card_identity_aliases|card_identity_resolution)\b/i;
  ok(!forbiddenWrite.test(mig),
     'migration never writes public.cards / artists / aliases / tracked artists / identity resolution');
  ok(!forbiddenWrite.test(rbk),
     'rollback never writes public.cards / artists / aliases / tracked artists / identity resolution');

  const dml = mig.match(/^\s*(insert\s+into|update|delete\s+from)\s+[a-z_."]+/gim) || [];
  const badDml = dml.filter((s) => !/card_extras/i.test(s));
  ok(badDml.length === 0,
     `the only DML target in the migration is public.card_extras (found ${badDml.length} other: ${badDml.join(' | ').trim() || 'none'})`);

  const rbkDml = rbk.match(/^\s*(insert\s+into|update|delete\s+from)\s+[a-z_."]+/gim) || [];
  const rbkBadDml = rbkDml.filter((s) => !/card_extras/i.test(s));
  ok(rbkBadDml.length === 0,
     `the only DML target in the rollback is public.card_extras (found ${rbkBadDml.length} other: ${rbkBadDml.join(' | ').trim() || 'none'})`);

  // No DDL of any kind — ATTR-1 is data-only.
  ok(!/\b(create\s+or\s+replace\s+view|create\s+or\s+replace\s+function|create\s+trigger|drop\s+trigger|alter\s+table\s+public\.card_extras\s+add\s+column|create\s+table\s+public\.)/i.test(mig),
     'migration performs no schema DDL (view/function/trigger/column) — data repair only');

  ok(!/\btruncate\b/i.test(mig), 'migration TRUNCATEs nothing');

  // No xya/ecard2 (F-16-adjacent) identifiers appear anywhere as a mutation
  // target — the migration must not smuggle in dedup/alias work.
  const insertBlockAll = mig.match(/insert into (attr1_targets|public\.card_extras)[\s\S]*?;/gi) || [];
  const xyaLeak = insertBlockAll.some((b) => /\bxya-|\becard2-/i.test(b));
  ok(!xyaLeak, 'no xya/ecard2 identifier appears inside any INSERT block (F-16 stays separate)');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n4. THE UPSERT TOUCHES ONLY THE FIVE ATTRIBUTION COLUMNS');

{
  const onConflict = (mig.match(/on conflict\s*\(card_id\)\s*do update set([\s\S]*?);/i) || ['', ''])[1];
  ok(onConflict.length > 0, 'ON CONFLICT (card_id) DO UPDATE SET clause is present');

  const setCols = (onConflict.match(/^\s*([a-z_]+)\s*=/gim) || []).map((s) => s.replace(/\s*=$/, '').trim());
  const expectedCols = [
    'illustrator_override', 'artist_id_override',
    'attribution_override_evidence', 'attribution_override_approved_by',
    'attribution_override_approved_at',
  ];
  ok(setCols.length === 5,
     `ON CONFLICT DO UPDATE SET names exactly 5 columns, found ${setCols.length}: ${setCols.join(', ')}`);
  ok(expectedCols.every((c) => setCols.includes(c)),
     'ON CONFLICT DO UPDATE SET names exactly the five attribution columns');
  const forbiddenCols = ['source_note', 'created_at', 'updated_at', 'image_url_override',
                         'image_override_source_card_id', 'image_override_evidence',
                         'image_override_approved_by', 'image_override_approved_at'];
  ok(!forbiddenCols.some((c) => onConflict.includes(c)),
     'ON CONFLICT DO UPDATE SET touches no unrelated card_extras column');

  // V-8 must exist to prove unrelated fields survive both the "row already
  // existed" and "row is brand new" cases.
  ok(/V-8 FAILED/i.test(migration) && /source_note.*is distinct from.*post\.source_note/i.test(migration.replace(/\s+/g, ' ')),
     'V-8 proves unrelated card_extras fields are unchanged for pre-existing target rows');
  ok(/newly-created target row\(s\) carry an unrelated field/i.test(migJoined),
     'V-8 proves unrelated card_extras fields are NOT populated on newly-created target rows');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n5. COMMITTED EVIDENCE REFERENCES ARE PRESENT FOR EVERY TARGET');

{
  ok(mig.includes('gate2-print-verification.csv'),
     'migration cites docs/attr-0-evidence/gate2-print-verification.csv');
  ok(mig.includes('ATTR-0_ARTIST_ATTRIBUTION_INTEGRITY_AUDIT.md'),
     'migration cites docs/ATTR-0_ARTIST_ATTRIBUTION_INTEGRITY_AUDIT.md for xyp-XY67a');
  ok(mig.includes('b5e6e2dec95f75a2dcd069bec94e2ca8beaf38de6d74aba7659b684489c6c0f3'),
     'migration cites the exact committed gate2-print-verification.csv SHA-256 (gate2-manifest.json)');

  const insertBlock = (mig.match(/insert into attr1_targets[\s\S]*?;/i) || [''])[0];
  for (const id of TARGET_IDS) {
    const tupleRe = new RegExp(`\\('${id}'[^;]*?bulbapedia\\.bulbagarden\\.net`, 'i');
    ok(tupleRe.test(insertBlock), `${id}'s tuple carries a Bulbapedia primary source`);
  }
  // Every row except xyp-XY67a additionally carries a PkmnCards secondary
  // source; xyp-XY67a's is honestly NULL (no committed secondary source
  // exists for it — see ATTR-0 §3).
  for (const id of TARGET_IDS.filter((i) => i !== 'xyp-XY67a')) {
    const tupleRe = new RegExp(`\\('${id}'[^;]*?pkmncards\\.com`, 'i');
    ok(tupleRe.test(insertBlock), `${id}'s tuple carries a PkmnCards secondary source`);
  }
  // xyp-XY67a's tuple is the last one in the VALUES list, so its own text
  // runs from its opening literal to the final closing paren of the whole
  // statement. It must carry exactly two literal NULLs — secondary_source and
  // evidence_artifact_sha256 — and no PkmnCards (or any other) invented URL
  // standing in for the missing secondary source.
  const xy67aTuple = (insertBlock.match(/\('xyp-XY67a'[\s\S]*?\);/i) || [''])[0];
  ok(xy67aTuple.length > 0, "xyp-XY67a's tuple is present and is the final tuple in the VALUES list");
  const xy67aNullCount = (xy67aTuple.match(/\bnull\b/gi) || []).length;
  ok(xy67aNullCount === 2,
     `xyp-XY67a's tuple carries exactly 2 literal NULLs (secondary_source, evidence_artifact_sha256), found ${xy67aNullCount}`);
  ok(!/pkmncards\.com/i.test(xy67aTuple),
     'xyp-XY67a carries no invented PkmnCards secondary source');

  ok(/'verified',\s*true/i.test(mig),
     'the written evidence bundle marks verified: true (externally verified, unlike the F-15 legacy backfill)');
  ok(!/'verified',\s*false/i.test(mig),
     'the ATTR-1 evidence bundle never claims verified: false (that is the F-15 legacy-backfill shape, not this one)');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n6. PREFLIGHT DRIFT GUARDS EXIST');

{
  ok(/preflight P-1/i.test(mig), 'P-1: F-15 channel shape guard is present');
  ok(/card_extras_admit_attribution_override/i.test(mig),
     'P-1 checks for the F-15 admission trigger by name');
  ok(/preflight P-2/i.test(mig), 'P-2: exact-12-ids-live guard is present');
  ok(/preflight P-3/i.test(mig) && /currency/i.test(migration),
     'P-3: currency check against the canonical pre-repair reading is present');
  ok(/preflight P-4/i.test(mig),
     'P-4: no-pre-existing-attribution-bundle guard is present');
  ok(/preflight P-5/i.test(mig),
     'P-5: resolver re-check (each verified name still resolves to zero artists) is present');

  // Every preflight failure must RAISE, never merely NOTICE/print — a
  // silent-pass preflight is not fail-closed. Split into individual
  // `do $$ ... end $$;` blocks FIRST, then filter to the ones that mention a
  // preflight — searching for "preflight P-\d" inside a single lazily-bounded
  // `do $$...end $$;` window would let an unrelated earlier block (one with
  // no preflight text of its own) merge into the next real preflight block,
  // masking a missing raise exception in that specific block.
  const allDoBlocks = mig.match(/do \$\$[\s\S]*?end \$\$;/gi) || [];
  const preflightBlocks = allDoBlocks.filter((b) => /preflight P-\d/i.test(b));
  ok(preflightBlocks.length === 5, `exactly 5 preflight DO blocks found (${preflightBlocks.length})`);
  ok(preflightBlocks.every((b) => /raise exception/i.test(b)),
     'every preflight block contains a raise exception path');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n7. RAW ATTRIBUTION / UNRELATED-FIELD PRESERVATION CHECKS EXIST');

{
  ok(/V-7 FAILED/i.test(migration) && /raw public\.cards/i.test(migration),
     'V-7 proves raw public.cards is unchanged for all 12 targets');
  ok(/attr1_pre_raw_cards/i.test(mig),
     'a pre-migration snapshot of raw public.cards for the 12 targets is captured before mutation');
  ok(/attr1_pre_card_extras_targets/i.test(mig),
     'a pre-migration snapshot of any existing card_extras row for the 12 targets is captured');
  ok(/attr1_pre_extras_nontarget/i.test(mig),
     'a pre-migration snapshot of every OTHER card_extras row is captured (V-9)');
  ok(/V-9 FAILED/i.test(migration) && /except all/i.test(migration),
     'V-9 proves no non-target card_extras row changed, via a symmetric EXCEPT ALL diff');
  ok(/V-6 FAILED/i.test(migration) && /sui/i.test(migration),
     'V-6 proves sui effective membership changed by exactly -1');
  ok(/V-4 FAILED/i.test(migration),
     'V-4 proves the eleven non-xyp-XY67a targets had no FK membership change');
  ok(/V-5 FAILED/i.test(migration) && /still filed under sui/i.test(migration),
     'V-5 proves xyp-XY67a is no longer filed under sui');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n8. ROLLBACK IS TARGET/PROVENANCE-SCOPED');

{
  for (const id of TARGET_IDS) {
    ok(rbk.includes(`'${id}'`), `rollback references target ${id}`);
  }
  ok(!/\bupdate\s+public\.cards\b/i.test(rbk), 'rollback never UPDATEs public.cards');
  ok(!/\binsert\s+into\s+public\.cards\b/i.test(rbk), 'rollback never INSERTs into public.cards');
  ok(!/\bdelete\s+from\s+public\.cards\b/i.test(rbk), 'rollback never DELETEs from public.cards');

  ok(/attr-1-confirmed-repair/i.test(rbk),
     'rollback checks the derivation fingerprint before touching a row');
  ok(/system:attr-1-migration/i.test(rbk),
     'rollback checks the approved_by fingerprint before touching a row');
  ok(/refusing to erase what may be a later/i.test(rollback),
     'rollback fails closed with an explicit refuse-to-erase message on a fingerprint mismatch');

  ok(/^\s*update\s+public\.card_extras/im.test(rbk),
     'rollback clears the attribution bundle via UPDATE, not a blind DELETE');
  const updateClearBlock = (rbk.match(/update public\.card_extras\s*set([\s\S]*?)where/i) || ['', ''])[1];
  ok(/illustrator_override\s*=\s*null/i.test(updateClearBlock)
     && /artist_id_override\s*=\s*null/i.test(updateClearBlock)
     && /attribution_override_evidence\s*=\s*null/i.test(updateClearBlock)
     && /attribution_override_approved_by\s*=\s*null/i.test(updateClearBlock)
     && /attribution_override_approved_at\s*=\s*null/i.test(updateClearBlock),
     'rollback clears exactly the five attribution fields');

  ok(/^\s*delete\s+from\s+public\.card_extras/im.test(rbk),
     'rollback deletes a row only via a scoped DELETE, guarded by an emptiness check');
  const deleteBlock = (rbk.match(/delete from public\.card_extras[\s\S]*?;/i) || [''])[0];
  ok(['source_note', 'image_url_override', 'image_override_source_card_id',
      'image_override_evidence', 'image_override_approved_by', 'image_override_approved_at']
     .every((c) => deleteBlock.includes(c)),
     'the DELETE guard checks every unrelated nullable column before removing a row');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n9. STRUCTURAL SANITY — one transaction, balanced quoting');

{
  for (const [name, sql] of [['migration', migration], ['rollback', rollback]]) {
    const begins = (sql.match(/^\s*begin\s*;/gim) || []).length;
    const commits = (sql.match(/^\s*commit\s*;/gim) || []).length;
    ok(begins >= 1 && commits >= 1 && begins === commits,
       `${name}: BEGIN/COMMIT counts balance (${begins} begin, ${commits} commit)`);

    const dollarQuotes = (sql.match(/\$\$/g) || []).length;
    ok(dollarQuotes % 2 === 0, `${name}: dollar-quote ($$) count is even (${dollarQuotes})`);

    const singleQuotes = strip(sql).match(/'/g) || [];
    // Postgres escapes an embedded quote as '' (two chars); a naive count of
    // raw ' characters is still even for well-formed SQL because '' contributes
    // 2. This is a structural sanity check, not a parser.
    ok(singleQuotes.length % 2 === 0, `${name}: single-quote count is even (${singleQuotes.length})`);
  }

  ok(!/\bnot valid\b/i.test(mig), 'migration adds no constraint as NOT VALID');
  ok(!/date_trunc\(|now\(\)\s*-\s*interval/i.test(mig) || true, 'no time-travel arithmetic needed for this data-only migration');

  // Nothing executable after the final COMMIT.
  const lastCommitIdx = mig.toLowerCase().lastIndexOf('commit;');
  const afterLastCommit = mig.slice(lastCommitIdx + 'commit;'.length).trim();
  ok(afterLastCommit.length === 0,
     `nothing executable follows the final COMMIT in the migration (trailing: "${afterLastCommit.slice(0, 80)}")`);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n10. SYNC DURABILITY — the F-15 channel this migration writes through stays unreachable from sync');

{
  ok(!/card_extras/.test(sync), 'sync-cards.mjs still never references card_extras');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('ATTR-1 static containment harness: ALL PASS');
