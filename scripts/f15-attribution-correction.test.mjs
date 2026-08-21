#!/usr/bin/env node
// scripts/f15-attribution-correction.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
// F-15 — durable attribution correction: static containment harness
// (DEV-ONLY; no network, no database, no credentials).
//
// WHY THIS EXISTS
//
//   The F-15 migration has not been executed, and no PostgreSQL parser is
//   available in this environment (adding one would be an out-of-scope
//   dependency). So the properties that make this migration safe cannot be
//   proved by running it. They CAN be proved structurally, and every one of
//   them is a property a future edit could silently remove. This harness turns
//   each into a test rather than a comment.
//
//     1. CONTAINMENT — the migration mutates ONLY intended objects. No ATTR-1
//        card id is a mutation target; public.cards, public.artists and artist
//        aliases are never written.
//
//     2. ORDERING — the backfill precedes both the provenance CHECKs and the
//        view switch. Getting this wrong is not a style issue: C1 would reject
//        the migration against its own legacy rows, or three artist
//        memberships would silently vanish.
//
//     3. THE RESOLVER IS ALIASES-ONLY — byte-for-byte the contract
//        sync-cards.mjs uses. If a future edit reintroduces artists.id
//        matching, admission and sync can disagree about what a name means.
//
//     4. C1 IS THE TWO-STATE FOUR-FIELD BUNDLE — the exact expression the
//        PR #25 review required. A weakened C1 admits a no-provenance
//        override, which is the thing C1 exists to block.
//
//     5. THE VIEW CHANGED EXACTLY ONE PROJECTION — diffed mechanically against
//        the live CAT-2D.1 + CAT-3B shape, so CAT-2D.1's alias exclusion or
//        CAT-3B's image override cannot be silently reverted.
//
//     6. artist_id USES CASE, NOT COALESCE — COALESCE cannot express an
//        intentional NULL and would retain the known-wrong artist on all 12
//        ATTR-1 rows.
//
//     7. PROVENANCE STAYS OUT OF THE PUBLIC GRANT.
//
//     8. THE SYNC PATH STILL CANNOT REACH card_extras (same argument CAT-3B
//        made for images; restated here for the attribution columns).
//
//     9. ROLLBACK NEVER REWRITES public.cards.
//
//    10. STRUCTURAL WELL-FORMEDNESS — balanced transaction, dollar-quoting,
//        parentheses and string literals. This is not a parser, and it is not
//        claimed to be one; it catches the structural damage a hand-edit most
//        plausibly causes.
//
// Run: node scripts/f15-attribution-correction.test.mjs
// No test framework is introduced (matches the OL-0A/0C/0D/CAT-2D/CAT-3A/CAT-3B
// harnesses).
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATION  = join(ROOT, 'docs', 'sql', 'f15-durable-attribution-correction.sql');
const VALIDATION = join(ROOT, 'docs', 'sql', 'f15-durable-attribution-correction-validation.sql');
const ROLLBACK   = join(ROOT, 'docs', 'sql', 'f15-durable-attribution-correction-rollback.sql');
const AUDIT      = join(ROOT, 'docs', 'sql', 'f15-attribution-correction-design-audit.sql');
const SYNC       = join(ROOT, 'sync', 'sync-cards.mjs');
const DOC        = join(ROOT, 'docs', 'F-15_IMPLEMENTATION.md');

let passed = 0;
let failed = 0;
const failures = [];
const ok = (cond, msg) => {
  if (cond) { passed++; console.log(`  ok   ${msg}`); }
  else { failed++; failures.push(msg); console.error(`  FAIL ${msg}`); }
};

const ATTR1 = [
  'g1-28a', 'g1-73a', 'xy10-111a', 'xy10-43a', 'xy4-65a', 'xy6-77a',
  'xy7-75a', 'xy9-107a', 'xy9-98b', 'xyp-XY150a', 'xyp-XY177a', 'xyp-XY67a',
];

for (const f of [MIGRATION, VALIDATION, ROLLBACK, AUDIT, SYNC, DOC]) {
  if (!existsSync(f)) {
    console.error(`FATAL: missing required file ${f}`);
    process.exit(1);
  }
}

const migration  = readFileSync(MIGRATION, 'utf8');
const validation = readFileSync(VALIDATION, 'utf8');
const rollback   = readFileSync(ROLLBACK, 'utf8');
const audit      = readFileSync(AUDIT, 'utf8');
const sync       = readFileSync(SYNC, 'utf8');

// Strip line comments so assertions test EXECUTABLE sql, never prose. Prose in
// this repo deliberately quotes the things being forbidden, so testing raw text
// would produce false passes and false failures in both directions.
const strip = (sql) =>
  sql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');

const mig = strip(migration);
const val = strip(validation);
const rbk = strip(rollback);
const aud = strip(audit);

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n1. CONTAINMENT — only intended mutation targets');

{
  // Every statement that can write. Extract them from the stripped migration.
  const writes = mig.match(/\b(insert\s+into|update|delete\s+from|alter\s+table|drop\s+\w+|create\s+(or\s+replace\s+)?(view|function|trigger)|grant|revoke|comment\s+on)\b[^;]*/gi) || [];

  const forbiddenWrite = /\b(insert\s+into|update|delete\s+from)\s+(public\.)?(cards|artists|user_tracked_artists|card_identity_aliases)\b/i;
  ok(!forbiddenWrite.test(mig),
     'migration never writes public.cards / artists / aliases / tracked artists');

  // The only DML target is card_extras. Matched at STATEMENT position (start of
  // a line) so that prose inside COMMENT ON string literals, and the
  // `before insert or update on …` trigger clause, are not mistaken for DML.
  const dml = mig.match(/^\s*(insert\s+into|update|delete\s+from)\s+[a-z_."]+/gim) || [];
  const badDml = dml.filter((s) => !/card_extras/i.test(s));
  ok(badDml.length === 0,
     `the only DML target is public.card_extras (found ${badDml.length} other: ${badDml.join(' | ').trim() || 'none'})`);

  // Exactly one UPDATE statement in the whole migration: the legacy backfill.
  const updates = mig.match(/\bupdate\s+public\.card_extras\b/gi) || [];
  ok(updates.length === 1,
     `exactly one UPDATE statement (the 5-row legacy backfill), found ${updates.length}`);

  ok(!/\binsert\s+into\b/i.test(mig), 'migration INSERTs nothing');
  ok(!/\bdelete\s+from\b/i.test(mig), 'migration DELETEs nothing');
  ok(!/\btruncate\b/i.test(mig),      'migration TRUNCATEs nothing');

  // ATTR-1 ids may appear only inside guard/assertion predicates, never as a
  // write target. Prove it by checking no ATTR-1 id occurs in an UPDATE/INSERT
  // statement body.
  const updateBody = (mig.match(/\bupdate\s+public\.card_extras[\s\S]*?;/i) || [''])[0];
  const attr1InWrite = ATTR1.filter((id) => updateBody.includes(id));
  ok(attr1InWrite.length === 0,
     `no ATTR-1 card id appears in the backfill statement (found ${attr1InWrite.join(', ') || 'none'})`);

  // ...and they DO appear, as guards. Absence would mean V-13/P-6 went missing.
  const guarded = ATTR1.every((id) => mig.includes(id));
  ok(guarded, 'all 12 ATTR-1 ids are present as assertion guards (P-6 and V-13)');

  // The backfill must be scoped to pre-existing overrides only.
  ok(/where\s+ce\.illustrator_override\s+is\s+not\s+null\s*;/i.test(updateBody),
     'backfill is scoped by `where ce.illustrator_override is not null`');

  ok(writes.length > 0, 'migration contains executable statements (sanity)');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n2. ORDERING — backfill precedes the CHECKs and the view switch');

{
  const iBackfill = mig.search(/\bupdate\s+public\.card_extras\b/i);
  const iGate     = mig.search(/B-2 gate FAILED/i);
  const iC1       = mig.search(/card_extras_attribution_override_all_or_nothing/i);
  const iC3       = mig.search(/card_extras_attribution_override_requires_illustrator/i);
  const iView     = mig.search(/create\s+or\s+replace\s+view\s+public\.cards_effective/i);
  const iTrigger  = mig.search(/create\s+or\s+replace\s+function\s+public\.card_extras_admit_attribution_override/i);
  const iColumns  = mig.search(/add\s+column\s+if\s+not\s+exists\s+artist_id_override/i);
  const iAcl      = mig.search(/revoke\s+all\s+on\s+table\s+public\.card_extras/i);

  ok(iColumns > -1 && iColumns < iBackfill, 'columns added before the backfill');
  ok(iGate > -1 && iGate < iBackfill,       'B-2 gate runs before the backfill');
  ok(iBackfill > -1 && iBackfill < iC1,     'backfill precedes C1  (else C1 rejects the legacy rows)');
  ok(iBackfill < iC3,                       'backfill precedes C3');
  ok(iBackfill < iView,                     'backfill precedes the view switch (else 3 memberships vanish)');
  ok(iBackfill < iTrigger,                  'backfill precedes the admission trigger');
  ok(iView < iAcl,                          'view switch precedes the ACL extension');

  // No NOT VALID loophole used to compensate for ordering.
  ok(!/\bnot\s+valid\b/i.test(mig),
     'no `NOT VALID` constraint deferral anywhere (ordering is the fix, not deferral)');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n3. RESOLVER — aliases only, never artists.id');

{
  // Every resolver occurrence must match against unnest(aliases).
  const aliasMatches = mig.match(/unnest\(coalesce\(a\.aliases/gi) || [];
  ok(aliasMatches.length >= 4,
     `resolver matches against artists.aliases in every site (${aliasMatches.length} occurrences)`);

  // artists.id may be SELECTED (it is the resolved value) but must never be a
  // MATCH predicate: `lower(a.id) = ...` is the exact regression to catch.
  ok(!/lower\s*\(\s*(btrim\s*\(\s*)?a\.id/i.test(mig),
     'migration never matches on lower(artists.id) — aliases-only contract held');
  ok(!/lower\s*\(\s*(btrim\s*\(\s*)?a\.id/i.test(aud),
     'design audit never matches on lower(artists.id) either');
  ok(!/lower\s*\(\s*(btrim\s*\(\s*)?a\.id/i.test(val),
     'validation file never matches on lower(artists.id) either');

  // Normalisation must be lower(btrim(...)) on BOTH sides, matching sync.
  ok(/lower\(btrim\(al\)\)\s*=\s*lower\(btrim\(/i.test(mig),
     'normalisation is lower(btrim(alias)) = lower(btrim(override)) on both sides');

  // Sync really does build its map from aliases only — the contract this mirrors.
  ok(/for\s*\(\s*const\s+alias\s+of\s+artist\.aliases/.test(sync),
     'sync-cards.mjs loadArtistAliasMap() still builds from artists.aliases only');
  ok(!/aliasMap\.set\(\s*artist\.id/.test(sync),
     'sync-cards.mjs never keys its alias map by artists.id');

  // Ambiguity is counted in ARTIST ROWS, not alias tokens.
  ok(/count\(\*\)\s*from\s+public\.artists\s+a\s*\n?\s*where\s+exists/i.test(mig),
     'ambiguity is counted as matching ARTIST ROWS (count(*) from artists where exists)');
  // Ambiguity must never be counted over the unnested alias tokens themselves —
  // production holds 11 duplicate aliases WITHIN single artist rows, and
  // counting tokens would report those as ambiguity and fail closed for no
  // reason. `count(*) from unnest(...)` is the exact regression to catch.
  ok(!/count\(\*\)\s*\n?\s*from\s+unnest/i.test(mig),
     'ambiguity is never counted over unnested alias tokens');

  // No LIMIT 1 shortcut anywhere in the resolver paths.
  ok(!/\blimit\s+1\b/i.test(mig),
     'no `LIMIT 1` anywhere — ambiguity is detected, never silently resolved');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n4. C1 — the exact two-state, four-field bundle');

{
  const c1 = (mig.match(/add\s+constraint\s+card_extras_attribution_override_all_or_nothing\s+check\s*\(([\s\S]*?)\n\s*\);/i) || [])[1] || '';
  ok(c1.length > 0, 'C1 constraint body located');

  const fields = [
    'illustrator_override',
    'attribution_override_evidence',
    'attribution_override_approved_by',
    'attribution_override_approved_at',
  ];

  const nullBranch    = (c1.match(/is\s+null/gi) || []).length;
  const notNullBranch = (c1.match(/is\s+not\s+null/gi) || []).length;

  ok(nullBranch === 4,
     `C1 State A tests all four fields IS NULL (found ${nullBranch})`);
  ok(notNullBranch === 4,
     `C1 State B tests all four fields IS NOT NULL (found ${notNullBranch})`);
  ok(/\bor\b/i.test(c1), 'C1 is a two-state disjunction');

  for (const f of fields) {
    const n = (c1.match(new RegExp(`\\b${f}\\b`, 'gi')) || []).length;
    ok(n === 2, `C1 references ${f} exactly twice (once per state) — found ${n}`);
  }

  // The weakened wording the review rejected: a State A branch that omits
  // illustrator_override entirely would leave "override present, provenance
  // absent" unaddressed.
  ok(/illustrator_override\s+is\s+null/i.test(c1),
     'C1 State A explicitly requires illustrator_override IS NULL');

  ok(/add\s+constraint\s+card_extras_attribution_override_approved_by_nonempty/i.test(mig),
     'C2 non-empty approved_by constraint present');
  ok(/add\s+constraint\s+card_extras_attribution_override_requires_illustrator/i.test(mig),
     'C3 bare-FK constraint present');
  ok(/references\s+public\.artists\(id\)\s*\n?\s*on\s+delete\s+restrict/i.test(mig),
     'C4 FK to artists(id) is ON DELETE RESTRICT (not CASCADE)');

  // Constraint existence guards must be scoped by relation, not name alone.
  const guards = mig.match(/where\s+conname\s*=\s*'[^']+'\s*\n?\s*and\s+conrelid\s*=\s*'public\.card_extras'::regclass/gi) || [];
  ok(guards.length >= 4,
     `every constraint guard is scoped by conname AND conrelid (${guards.length} found)`);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n5. VIEW — exactly one projection changed');

{
  const view = (mig.match(/create\s+or\s+replace\s+view\s+public\.cards_effective[\s\S]*?;\n/i) || [''])[0];
  ok(view.length > 0, 'view definition located');

  const EXPECTED_COLS = [
    'c.id', 'c.name', 'c.set_id', 'c.set_name', 'c.local_id',
    'coalesce(ce.illustrator_override, c.illustrator)',
    'coalesce(ce.image_url_override, c.image_url)',
    'c.rarity', 'c.release_date', 'c.pricing', 'c.pricing_updated_at',
    'c.pricing_source', 'c.last_synced_at',
  ];
  for (const col of EXPECTED_COLS) {
    ok(view.toLowerCase().includes(col.toLowerCase()),
       `view preserves projection: ${col}`);
  }

  ok(/with\s*\(\s*security_invoker\s*=\s*true\s*\)/i.test(view),
     'view keeps security_invoker = true');
  ok(/left\s+join\s+public\.card_extras\s+ce\s+on\s+c\.id\s*=\s*ce\.card_id/i.test(view),
     'view keeps the card_extras LEFT JOIN');
  ok(/where\s+not\s+exists[\s\S]*card_identity_resolution[\s\S]*alias_card_id\s*=\s*c\.id/i.test(view),
     'view keeps the CAT-2D.1 alias exclusion');

  // The one intended change — CASE, not COALESCE.
  ok(/case\s*\n?\s*when\s+ce\.illustrator_override\s+is\s+not\s+null\s+then\s+ce\.artist_id_override\s*\n?\s*else\s+c\.artist_id\s*\n?\s*end\s+as\s+artist_id/i.test(view.replace(/\s+/g, ' ').replace(/ /g, ' ')) ||
     /case[\s\S]*when\s+ce\.illustrator_override\s+is\s+not\s+null\s+then\s+ce\.artist_id_override[\s\S]*else\s+c\.artist_id[\s\S]*end/i.test(view),
     'artist_id uses the approved CASE expression');
  ok(!/coalesce\s*\(\s*ce\.artist_id_override/i.test(view),
     'artist_id does NOT use COALESCE (which cannot express an intentional NULL)');

  // artist_id must still be the LAST column.
  const selectBody = (view.match(/select([\s\S]*?)from\s+public\.cards\s+c/i) || ['', ''])[1];
  const lastProjection = selectBody.trim().split('\n').filter((l) => l.trim()).pop();
  ok(/as\s+artist_id/i.test(lastProjection),
     'artist_id remains the 14th and last column');

  // Column count: count top-level ` as ` aliases + bare c.* projections.
  const projLines = selectBody.split('\n').map((l) => l.trim()).filter(Boolean);
  const commaTerminated = projLines.filter((l) => l.endsWith(',')).length;
  ok(commaTerminated === 13,
     `view projects 14 columns (13 comma-terminated + 1 final), found ${commaTerminated + 1}`);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n6. ACL — provenance stays private');

{
  const grant = (mig.match(/grant\s+select\s*\(([^)]*)\)\s*\n?\s*on\s+public\.card_extras/i) || ['', ''])[1];
  const granted = grant.split(',').map((s) => s.trim()).filter(Boolean).sort();
  const expected = ['artist_id_override', 'card_id', 'illustrator_override', 'image_url_override'].sort();

  ok(JSON.stringify(granted) === JSON.stringify(expected),
     `public column grant is exactly [${expected.join(', ')}] — got [${granted.join(', ')}]`);

  for (const p of ['attribution_override_evidence', 'attribution_override_approved_by',
                   'attribution_override_approved_at', 'source_note',
                   'image_override_evidence', 'image_override_approved_by',
                   'image_override_approved_at', 'image_override_source_card_id']) {
    ok(!granted.includes(p), `provenance column NOT granted publicly: ${p}`);
  }

  ok(/revoke\s+all\s+on\s+table\s+public\.card_extras\s+from\s+anon,\s*authenticated/i.test(mig),
     'blanket table grant is revoked before the column grant');
  ok(!/grant\s+select\s+on\s+public\.card_extras\s+to\s+anon/i.test(mig),
     'no table-level SELECT grant is re-added for anon/authenticated');

  // RLS untouched.
  ok(!/\b(enable|disable|force)\s+row\s+level\s+security\b/i.test(mig),
     'migration does not alter RLS');
  ok(!/create\s+policy/i.test(mig), 'migration adds no RLS policy');
  ok(!/drop\s+policy/i.test(mig),   'migration drops no RLS policy');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n7. TRIGGER — security, idempotence, coexistence');

{
  const fn = (mig.match(/create\s+or\s+replace\s+function\s+public\.card_extras_admit_attribution_override[\s\S]*?\n\$\$;/i) || [''])[0];
  ok(fn.length > 0, 'admission function located');

  ok(!/security\s+definer/i.test(fn), 'admission function is NOT security definer');
  ok(/language\s+plpgsql/i.test(fn),  'admission function is plpgsql');

  // Idempotence guard covers all five attribution fields with IS NOT DISTINCT FROM.
  const guard = (fn.match(/if\s+tg_op\s*=\s*'UPDATE'([\s\S]*?)then/i) || ['', ''])[1];
  const notDistinct = (guard.match(/is\s+not\s+distinct\s+from/gi) || []).length;
  ok(notDistinct === 5,
     `idempotence guard compares all 5 attribution fields with IS NOT DISTINCT FROM (found ${notDistinct})`);
  for (const f of ['illustrator_override', 'artist_id_override',
                   'attribution_override_evidence', 'attribution_override_approved_by',
                   'attribution_override_approved_at']) {
    ok(guard.includes(f), `idempotence guard includes ${f}`);
  }
  ok(!/[^t]\bnew\.\w+\s*=\s*old\./i.test(guard),
     'idempotence guard uses IS NOT DISTINCT FROM, never plain equality');

  // All five admission rules raise. Matched on a distinctive fragment of each
  // message rather than on its line wrapping, which is incidental.
  for (const [rule, needle] of [
    ['R2 wrong artist',  'but artist_id_override is'],
    ['R3 zero matches',  'artist alias, so artist_id_override must be NULL'],
    ['R4 ambiguous',     'fails closed on ambiguity'],
    ['R5 bare FK',       'without an illustrator_override'],
    ['R1 provenance',    'incomplete. illustrator_override requires'],
  ]) {
    ok(fn.includes(needle), `admission rejects: ${rule}`);
  }

  const raises = (fn.match(/raise\s+exception/gi) || []).length;
  ok(raises >= 5, `admission function raises on every rejection path (${raises} raises)`);

  // CAT-3B coexistence: its trigger and function are untouched.
  ok(!/drop\s+trigger\s+if\s+exists\s+card_extras_admit_image_override/i.test(mig),
     'CAT-3B image admission trigger is not dropped');
  ok(!/create\s+or\s+replace\s+function\s+public\.card_extras_admit_image_override/i.test(mig),
     'CAT-3B image admission function is not redefined');
  ok(!/card_extras_set_updated_at/i.test(mig),
     'the updated_at trigger is not touched');

  ok(/drop\s+trigger\s+if\s+exists\s+card_extras_admit_attribution_override/i.test(mig),
     'F-15 trigger creation is idempotent (drop if exists first)');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n8. SYNC DURABILITY — the payload still cannot reach card_extras');

{
  // Same structural argument CAT-3B made, restated for the attribution columns.
  const mapFn = (sync.match(/function\s+mapCardToRow[\s\S]*?\n}/) || [''])[0];
  ok(mapFn.length > 0, 'sync mapCardToRow() located');

  for (const col of ['artist_id_override', 'attribution_override_evidence',
                     'attribution_override_approved_by', 'attribution_override_approved_at',
                     'illustrator_override']) {
    ok(!mapFn.includes(col), `sync payload cannot express ${col}`);
  }

  ok(!/from\(['"]card_extras['"]\)|\.from\(\s*['"]card_extras['"]\s*\)/.test(sync),
     'sync never addresses card_extras at all');
  ok(!/card_extras/.test(sync), 'the string "card_extras" appears nowhere in sync-cards.mjs');

  // No hidden manual step: the migration must be a single self-contained
  // script, with no psql meta-command or external include in the middle.
  ok(!/^\s*\\[a-z]/im.test(migration), 'migration contains no psql meta-command (\\i, \\copy, …)');
  ok(!/\bcopy\s+\w+\s+from\b/i.test(mig), 'migration contains no COPY FROM (no external data step)');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n9. ROLLBACK — never rewrites raw provider history');

{
  const forbidden = /\b(insert\s+into|update|delete\s+from|truncate)\s+(public\.)?cards\b/i;
  ok(!forbidden.test(rbk), 'rollback never writes public.cards');
  ok(!/\b(insert\s+into|update|delete\s+from|truncate)\s+(public\.)?artists\b/i.test(rbk),
     'rollback never writes public.artists');

  ok(/create\s+or\s+replace\s+view\s+public\.cards_effective/i.test(rbk),
     'rollback restores cards_effective');
  ok(/c\.artist_id\s*\n?\s*from\s+public\.cards\s+c/i.test(rbk) || /c\.artist_id$/im.test(rbk),
     'rollback restores artist_id to the raw column');
  ok(!/case\s+when\s+ce\.illustrator_override/i.test(
       (rbk.match(/Level 1[\s\S]*?commit;/i) || [''])[0]),
     'Level 1 rollback view does not keep the F-15 CASE');

  // Level 1 must NOT drop the columns (data preserved).
  const level1 = (rbk.match(/LEVEL 1[\s\S]*?commit;/i) || [''])[0];
  ok(!/drop\s+column/i.test(level1),
     'Level 1 rollback preserves the F-15 columns and their data');

  // Level 2 is deliberately commented out (it destroys correction data and must
  // never be pasted in by reflex), so this reads the RAW file, not the
  // comment-stripped one.
  // Anchored on the section BANNER (column 0), not on the first mention of
  // "LEVEL 2" in the chooser preamble — which sits above Level 1's live SQL.
  const level2 = rollback.slice(rollback.search(/^-- LEVEL 2 —/m));
  ok(level2.length > 0, 'Level 2 teardown is documented');
  const iDrop  = level2.search(/drop\s+column\s+if\s+exists\s+artist_id_override/i);
  const iGrant = level2.search(/grant\s+select/i);
  ok(iDrop > -1, 'Level 2 documents dropping the F-15 columns');
  ok(iGrant > -1 && iDrop < iGrant,
     'Level 2 drops the provenance columns BEFORE restoring any grant');
  ok(!/drop\s+column[^\n;]*cascade/i.test(level2),
     'Level 2 never uses CASCADE on a column drop (it would drop the view)');
  // Every executable line of Level 2 must remain commented out in this slice.
  const level2Live = level2.split('\n').filter((l) =>
    /^\s*(alter|drop|grant|revoke|begin|commit)\b/i.test(l));
  ok(level2Live.length === 0,
     `Level 2 is commented out, not executable (${level2Live.length} live statements)`);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n10. STRUCTURE — transaction, quoting, parens');

{
  // Exactly one BEGIN / COMMIT pair, and nothing outside it that writes.
  const begins  = (mig.match(/^\s*begin;\s*$/gim) || []).length;
  const commits = (mig.match(/^\s*commit;\s*$/gim) || []).length;
  ok(begins === 1,  `exactly one BEGIN (found ${begins})`);
  ok(commits === 1, `exactly one COMMIT (found ${commits})`);
  ok(mig.search(/^\s*begin;\s*$/im) < mig.search(/^\s*commit;\s*$/im),
     'BEGIN precedes COMMIT');
  ok(!/\brollback\s*;/i.test(mig), 'migration contains no bare ROLLBACK');

  // The migration must be wholly inside the transaction.
  const afterCommit = mig.slice(mig.search(/^\s*commit;\s*$/im) + 'commit;'.length);
  ok(!/\b(alter|create|drop|grant|revoke|update|insert|delete)\b/i.test(afterCommit),
     'no executable statement follows COMMIT');

  // Dollar quoting balanced (each `$$` toggles; must be even).
  for (const [name, sql] of [['migration', migration], ['validation', validation], ['rollback', rollback]]) {
    const dollars = (sql.match(/\$\$/g) || []).length;
    ok(dollars % 2 === 0, `${name}: $$ delimiters balanced (${dollars})`);
  }

  // Parens and single quotes balanced OUTSIDE dollar-quoted blocks and comments.
  const outside = (sql) => {
    let out = '';
    let i = 0;
    let inDollar = false;
    const lines = sql.split('\n').filter((l) => !/^\s*--/.test(l));
    const body = lines.join('\n');
    while (i < body.length) {
      if (body.startsWith('$$', i)) { inDollar = !inDollar; i += 2; continue; }
      if (!inDollar) out += body[i];
      i++;
    }
    return out;
  };

  for (const [name, sql] of [['migration', migration], ['validation', validation], ['rollback', rollback]]) {
    const o = outside(sql);
    const quotes = (o.match(/'/g) || []).length;
    ok(quotes % 2 === 0, `${name}: single quotes balanced outside $$ blocks (${quotes})`);

    // Strip string literals before counting parens.
    const noStr = o.replace(/'(?:[^']|'')*'/g, "''");
    const open = (noStr.match(/\(/g) || []).length;
    const close = (noStr.match(/\)/g) || []).length;
    ok(open === close, `${name}: parentheses balanced outside $$ blocks (${open} vs ${close})`);
  }

  // Every DO block is closed.
  const doOpen  = (mig.match(/\bdo\s*\$\$/gi) || []).length;
  const doClose = (mig.match(/\bend\s*\$\$\s*;/gi) || []).length;
  ok(doOpen === doClose, `every DO block is closed (${doOpen} open, ${doClose} close)`);
  ok(doOpen >= 6, `migration uses DO blocks for its gates (${doOpen} found)`);

  // Snapshots are temporary and self-cleaning.
  ok(/create\s+temporary\s+table\s+f15_pre_effective\s+on\s+commit\s+drop/i.test(mig),
     'effective snapshot is TEMPORARY … ON COMMIT DROP');
  ok(/create\s+temporary\s+table\s+f15_pre_raw_cards\s+on\s+commit\s+drop/i.test(mig),
     'raw-cards snapshot is TEMPORARY … ON COMMIT DROP');

  // The headline invariant is asserted, not merely described.
  ok(/V-1 FAILED/i.test(mig),  'V-1 (zero effective diff) aborts the transaction');
  ok(/V-13 FAILED/i.test(mig), 'V-13 (ATTR-1 untouched) aborts the transaction');
  ok(/V-14 FAILED/i.test(mig), 'V-14 (raw cards untouched) aborts the transaction');
  ok(/except\s+all/i.test(mig),
     'V-1/V-14 use a symmetric EXCEPT ALL difference, not a count comparison');

  // No hardcoded catalog size as a correctness requirement.
  ok(!/23,?588/.test(mig),
     'no hardcoded 23588 row count is treated as a correctness requirement');

  // No credentials or user ids.
  ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(migration),
     'migration contains no UUID (no user ids)');
  ok(!/(service_role_key|anon_key|apikey|password|secret|bearer)\s*[:=]/i.test(migration),
     'migration contains no credential-shaped literal');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n11. VALIDATION FILE — read-only, no production writes');

{
  const stmts = val.match(/\b(insert\s+into|update\s+|delete\s+from|alter\s+table|drop\s+table|truncate|grant|revoke)\b/gi) || [];
  ok(stmts.length === 0,
     `validation file issues no production write (found ${stmts.length}: ${stmts.join(', ') || 'none'})`);
  ok(/select/i.test(val), 'validation file contains SELECT checks');

  // Negative admission tests must be authored but explicitly not executed here.
  ok(/rollback/i.test(validation),
     'negative-test harness is wrapped in an explicit ROLLBACK (never committed)');
  ok(/NOT\s+(BE\s+)?RUN|DO\s+NOT\s+(RUN|EXECUTE)|not executed/i.test(validation),
     'validation file states the negative tests are not executed against production');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('F-15 static containment harness: ALL PASS');
