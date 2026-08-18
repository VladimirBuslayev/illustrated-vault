#!/usr/bin/env node
// scripts/cat3a-audit-sql.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
// CAT-3A — audit SQL safety harness (DEV-ONLY; no network, no database, no
// credentials).
//
// WHAT THIS PROVES
//
//   docs/sql/cat-3a-image-coverage-baseline.sql is a READ-ONLY production
//   audit. The whole point is that it can be run against production without a
//   line-by-line review of what it might do. That property has to be
//   STRUCTURAL, not a promise in a comment — so this asserts it:
//
//     * no write, DDL or DML statement of any kind;
//     * no TEMP objects and no top-level transaction wrapper, because CAT-2D.2
//       established that this workflow must not depend on cross
//       top-level-statement TEMP or session state;
//     * every statement independently self-contained — each defines the CTEs
//       it uses rather than reading state another statement built;
//     * no hard-coded user UUID, and no statement that could emit one:
//       `user_id` may appear ONLY inside COUNT(DISTINCT ...);
//     * the missing-image predicate is one definition repeated verbatim, so
//       two queries cannot silently measure two different populations.
//
//   It also pins the scope boundaries that matter most for this slice:
//
//     * the audit must contain NO provider correspondence and no reference to
//       the fallback source at all — CAT-3A's SQL measures the catalog, and
//       provider knowledge lives exclusively in the probe;
//     * Q-A6 must compare alias-pair image presence WITHOUT proposing,
//       copying or writing any image value;
//     * the specification must not pre-state that CAT-3A closes CAT-0's open
//       question, and must not describe fallback-eligible rows as rendering.
//
// Run: node scripts/cat3a-audit-sql.test.mjs
// No test framework is introduced (matches the OL-0A/0C/0D/CAT-2D harnesses).
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SQL_PATH = join(ROOT, 'docs', 'sql', 'cat-3a-image-coverage-baseline.sql');
const DOC_PATH = join(ROOT, 'docs', 'CAT-3A_IMAGE_COVERAGE_AND_RECOVERABILITY_AUDIT.md');

let passed = 0;
let failed = 0;
const failures = [];
const ok = (cond, msg) => {
  if (cond) { passed++; console.log(`  ok   ${msg}`); }
  else { failed++; failures.push(msg); console.error(`  FAIL ${msg}`); }
};

console.log('CAT-3A — audit SQL safety harness\n');

ok(existsSync(SQL_PATH), 'audit SQL file exists');
ok(existsSync(DOC_PATH), 'specification document exists');
if (!existsSync(SQL_PATH) || !existsSync(DOC_PATH)) {
  console.error('\nRequired files missing — aborting.');
  process.exit(1);
}

const sqlRaw = readFileSync(SQL_PATH, 'utf8');
const doc = readFileSync(DOC_PATH, 'utf8');

// Strip line comments so prose about DML cannot be mistaken for DML. Everything
// below this point inspects EXECUTABLE SQL only.
const code = sqlRaw.replace(/--[^\n]*/g, '');
const codeLower = code.toLowerCase();

// Statement split. The file contains no function bodies or dollar quoting, so a
// semicolon split is exact here.
const statements = code.split(';').map(s => s.trim()).filter(s => s.length > 0);

// ── 1. Read-only ─────────────────────────────────────────────────────────────
console.log('\n1. read-only');

const FORBIDDEN = [
  'insert into', 'update ', 'delete from', 'truncate', 'merge into',
  'create table', 'create view', 'create or replace', 'create index',
  'create function', 'create trigger', 'create materialized',
  'alter table', 'alter view', 'drop table', 'drop view', 'drop function',
  'grant ', 'revoke ', 'comment on', 'refresh materialized', 'do $$',
  'copy ', 'call ', 'vacuum', 'analyze ', 'reindex', 'lock table',
];
for (const kw of FORBIDDEN) {
  ok(!codeLower.includes(kw), `no executable "${kw.trim()}"`);
}

ok(statements.every(s => /^with\b|^select\b/i.test(s)),
  'every statement begins with SELECT or WITH');

ok(!/\bselect\b[\s\S]*\binto\b\s+(?!\s*\()/i.test(code) || !/\binto\s+\w+\s*(from|;)/i.test(code),
  'no SELECT ... INTO target');

// ── 2. No session or transaction state ───────────────────────────────────────
console.log('\n2. no session or transaction state');

ok(!/\btemp(orary)?\b/i.test(code), 'no TEMP/TEMPORARY objects');
ok(!/\bbegin\b/i.test(code), 'no BEGIN');
ok(!/\bcommit\b/i.test(code), 'no COMMIT');
ok(!/\brollback\b/i.test(code), 'no ROLLBACK');
ok(!/set_config\s*\(/i.test(code), 'no set_config()');
ok(!/\bset\s+(local\s+|session\s+)?role\b/i.test(code), 'no SET ROLE');
ok(!/current_setting\s*\(/i.test(code), 'no current_setting()');
ok(!/\bauth\.(uid|jwt|role)\s*\(/i.test(code), 'no auth.* impersonation');

// ── 3. Statement independence ────────────────────────────────────────────────
console.log('\n3. statement independence');

// Every unqualified relation a statement reads must be a CTE that same
// statement defines. A statement that referenced another statement's CTE would
// fail at run time — but it would also mean the file could not be re-run
// out of order, which is the property CAT-2D.2 required.
let independenceViolations = 0;
for (const stmt of statements) {
  const defined = new Set();
  // CTE names cannot be found by slicing "everything before the first SELECT" —
  // the first SELECT is inside the first CTE's own body. Match the definition
  // shapes directly instead: `with X as (` and the `), Y as (` continuations.
  for (const m of stmt.matchAll(/\bwith\s+([a-z_][a-z0-9_]*)\s+as\s*\(/gi)) {
    defined.add(m[1].toLowerCase());
  }
  for (const m of stmt.matchAll(/\)\s*,\s*([a-z_][a-z0-9_]*)\s+as\s*\(/gi)) {
    defined.add(m[1].toLowerCase());
  }
  for (const m of stmt.matchAll(/\b(?:from|join)\s+([a-z_][a-z0-9_.]*)/gi)) {
    const rel = m[1].toLowerCase();
    if (rel.includes('.')) continue;             // schema-qualified: real object
    if (defined.has(rel)) continue;              // locally defined CTE
    independenceViolations++;
    console.error(`       unqualified relation "${rel}" not defined in its own statement`);
  }
}
ok(independenceViolations === 0, 'no statement reads a relation it does not define or schema-qualify');

ok(statements.length >= 12, `file carries the full query set (${statements.length} statements)`);

// ── 4. No user-identifying output ────────────────────────────────────────────
console.log('\n4. no user-identifying output');

ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(sqlRaw),
  'no hard-coded UUID anywhere in the file, comments included');

let userIdViolations = 0;
for (const m of code.matchAll(/user_id/gi)) {
  const before = code.slice(Math.max(0, m.index - 40), m.index).toLowerCase();
  // user_id is permitted ONLY as a COUNT(DISTINCT ...) argument. Selecting it,
  // grouping by it or joining on it would put a collector identity in output an
  // operator might paste into a public document.
  if (!/count\s*\(\s*distinct\s+[a-z_]*\.?$/.test(before)) {
    userIdViolations++;
    console.error(`       user_id used outside COUNT(DISTINCT ...) near: ...${before.slice(-50)}`);
  }
}
ok(userIdViolations === 0, 'user_id appears only inside COUNT(DISTINCT ...)');

ok(!/\bemail\b/i.test(code), 'no email column referenced');

// ── 5. One missing-image predicate, repeated verbatim ────────────────────────
console.log('\n5. single missing-image predicate');

const PRED = "image_url is null or btrim(image_url) = ''";
const predCount = (codeLower.match(/image_url is null or btrim\(image_url\) = ''/g) || []).length
  + (codeLower.match(/e\.image_url is null or btrim\(e\.image_url\) = ''/g) || []).length;
ok(predCount >= 15, `missing-image predicate repeated verbatim (${predCount} occurrences)`);
ok(codeLower.includes(PRED) || codeLower.includes("e." + PRED),
  'the canonical predicate text is present');

// NULL and BLANK must be counted separately somewhere, or the blank population
// is being assumed empty rather than measured.
ok(/image_url_null/i.test(code) && /image_url_blank/i.test(code),
  'Q-A1 counts NULL and BLANK separately');

// ── 6. Scope boundary: no provider correspondence in the SQL ─────────────────
console.log('\n6. scope boundary — no provider knowledge in SQL');

// The FALLBACK provider must be entirely absent from the SQL: any reference to
// it here would mean catalog measurement had started carrying provider
// correspondence, which belongs exclusively to the probe.
for (const token of ['pokemontcg', 'ptcgio', 'swsh45', 'swsh12pt5', 'cel25c-']) {
  ok(!codeLower.includes(token),
    `executable SQL contains no fallback-provider token "${token}"`);
}
// assets.tcgdex.net IS permitted, but ONLY as a host comparison in the Q-A5
// shape census — that assertion checks the stored value against its own
// expected host and is how a non-TCGdex value would be detected. It must never
// appear in a URL that the SQL constructs.
const tcgdexMentions = [...codeLower.matchAll(/tcgdex/g)];
ok(tcgdexMentions.length > 0 && tcgdexMentions.every(m => {
  const ctx = codeLower.slice(Math.max(0, m.index - 200), m.index + 40);
  // Permitted shapes only: the host literal compared against the stored value,
  // and the result column that reports the comparison.
  return /split_part\(image_url,\s*'\/',\s*3\)\s*<>\s*'assets\.tcgdex\.net'/.test(ctx)
    || /host_not_assets_tcgdex/.test(ctx);
}), 'assets.tcgdex.net appears only as a host comparison, never in a constructed URL');
ok(!/\|\|\s*'https?:/i.test(code) && !/concat\s*\([^)]*https?:/i.test(code),
  'the SQL constructs no URL of any kind');

ok(!/\bmap\b|correspondence|translat/i.test(code),
  'no correspondence/translation construct in executable SQL');

// ── 7. Q-A6 measures, it does not propagate ──────────────────────────────────
console.log('\n7. Q-A6 measures without propagating');

ok(/alias_image_url/i.test(code) && /canonical_image_url/i.test(code),
  'Q-A6 reads both sides of each approved pair');
ok(/A2_ALIAS_IMAGE_CANONICAL_MISSING/i.test(sqlRaw)
  && /A1_ALIAS_IMAGE_CANONICAL_IMAGE/i.test(sqlRaw)
  && /A3_ALIAS_MISSING_CANONICAL_IMAGE/i.test(sqlRaw)
  && /A4_ALIAS_MISSING_CANONICAL_MISSING/i.test(sqlRaw),
  'all four alias states are classified');
ok(/card_identity_resolution/i.test(code),
  'Q-A6 reads the approved alias surface, not an invented pairing');
ok(!/coalesce\s*\(\s*a\.image_url\s*,\s*c\.image_url\s*\)/i.test(code)
  && !/coalesce\s*\(\s*c\.image_url\s*,\s*a\.image_url\s*\)/i.test(code),
  'no COALESCE that would present an alias image as a canonical value');

// The audit must not name a repair. That decision belongs to the framework.
ok(!/set\s+image_url/i.test(code), 'no image_url assignment anywhere');

// ── 8. Base-table discipline is stated ───────────────────────────────────────
console.log('\n8. base-table discipline');

ok(/BASE-TABLE DISCIPLINE/i.test(sqlRaw), 'the file states its base-table discipline');
ok(/public\.cards_effective/.test(code), 'reads cards_effective');
ok(/public\.cards\b/.test(code), 'reads raw cards where the alias population requires it');
ok(/NOT directly comparable at set level/i.test(sqlRaw),
  'the CAT-0 set-level comparability caveat is recorded in the file');

// ── 9. Query coverage ────────────────────────────────────────────────────────
console.log('\n9. query coverage');

for (const q of ['Q-A0', 'Q-A1', 'Q-A2', 'Q-A2b', 'Q-A3', 'Q-A4a', 'Q-A4b', 'Q-A4c',
  'Q-A5a', 'Q-A5b', 'Q-A6a', 'Q-A6b', 'Q-A7a', 'Q-A7b', 'Q-A7c', 'Q-A8a', 'Q-A8b']) {
  ok(sqlRaw.includes(q), `${q} present`);
}
ok(/information_schema\.columns/i.test(code),
  'Q-A4a performs live-schema discovery rather than trusting the repo inventory');
ok(/has_language_column/i.test(code) && /has_image_source_column/i.test(code),
  'dimension-availability flags are proven from the live schema');

// ── 9b. Q-A2b — Celebrations remeasurement, no pairing ───────────────────────
console.log('\n9b. Q-A2b Celebrations remeasurement');

ok(/cel25_base_set_live/.test(code)
  && /cel25_classic_collection_historical/.test(code)
  && /cel25cc_current/.test(code),
  'Q-A2b reports all three named Celebrations populations');
// CAT-2D.3's selector, reproduced verbatim.
ok(/local_id ~ '\^\[0-9\]\+\$' is not true/.test(code),
  'the historical partition uses the CAT-2D.3 selector verbatim');
ok(/local_id ~ '\^\[0-9\]\+\$'\s*$/m.test(code) || /where local_id ~ '\^\[0-9\]\+\$'/.test(code),
  'the live base-set partition uses the CAT-2D.3 selector verbatim');
ok(/rows_in_cards_effective/.test(code),
  'Q-A2b reports effective membership alongside coverage');
ok(/REMEASUREMENT ONLY/.test(sqlRaw) && /pairs NOTHING/i.test(sqlRaw),
  'Q-A2b states it performs no pairing');
// No survivor mapping may appear anywhere near the Celebrations statement.
ok(!/historical[\s\S]{0,200}(join|=)[\s\S]{0,40}cel25cc/i.test(code),
  'no historical -> cel25cc join or mapping construct exists');

// ── 9c. Q-A6b — full 192-pair export ─────────────────────────────────────────
console.log('\n9c. Q-A6b full pair export');

// Slice by the STATEMENT BANNER, not by the first textual mention: the header
// comment block names several queries, so indexOf('Q-A7c') would start the
// slice in the header and swallow every statement up to Q-A8a — including
// Q-A7a's legitimate COUNT(DISTINCT user_id).
function section(id, nextId) {
  const start = sqlRaw.indexOf(`-- ${id} —`);
  const end = sqlRaw.indexOf(`-- ${nextId} —`);
  if (start === -1) return '';
  return sqlRaw.slice(start, end > start ? end : undefined);
}

const qa6b = section('Q-A6b', 'Q-A7a');
ok(qa6b.includes('alias_state'), 'Q-A6b projects the alias_state column');
for (const st of ['A1_ALIAS_IMAGE_CANONICAL_IMAGE', 'A2_ALIAS_IMAGE_CANONICAL_MISSING',
  'A3_ALIAS_MISSING_CANONICAL_IMAGE', 'A4_ALIAS_MISSING_CANONICAL_MISSING']) {
  ok(qa6b.includes(st), `Q-A6b can emit ${st}`);
}
// The defect being pinned: an A2-only WHERE clause would mislabel every A4
// canonical row as A0 and make the 192-row census impossible.
ok(!/where[\s\S]{0,200}canonical_image_url is null or btrim\(canonical_image_url\) = ''/i.test(qa6b),
  'Q-A6b does NOT filter to the A2 subset — all 192 pairs are exported');
ok(/exactly 192 rows/i.test(qa6b), 'Q-A6b states the expected 192-row count');
ok(/ZERO carrying A_UNRESOLVED/i.test(qa6b), 'Q-A6b states that A_UNRESOLVED must be zero');
ok(/HARD-STOPS/i.test(qa6b), 'Q-A6b states that the probe hard-stops on failure');

// ── 9c-2. Unresolved detection uses JOINED-ROW existence ─────────────────────
console.log('\n9c-2. unresolved detection');

// The defect being pinned: alias_card_id is card_identity_resolution's PRIMARY
// KEY, so `alias_card_id is null` can never be true and would report every pair
// as resolved. Existence must come from the LEFT-joined `cards` rows.
ok(/\(a\.id is not null\)\s+as alias_row_exists/.test(qa6b),
  'Q-A6b derives alias_row_exists from the joined cards row');
ok(/\(c\.id is not null\)\s+as canonical_row_exists/.test(qa6b),
  'Q-A6b derives canonical_row_exists from the joined cards row');
ok(/when not alias_row_exists or not canonical_row_exists[\s\S]{0,40}then 'A_UNRESOLVED'/.test(qa6b),
  'either missing side classifies as A_UNRESOLVED');
ok(!/when alias_card_id is null or canonical_card_id is null/.test(qa6b),
  'the old key-column null test is gone — it could never be true');
ok(/alias_row_exists,[\s\S]{0,40}canonical_row_exists,/.test(qa6b),
  'both existence flags are projected for the probe to consume');
ok(/alias_card_id DOES NOT/.test(qa6b),
  'Q-A6b records that alias_card_id carries no FK to cards(id)');

// Population-level counterpart in Q-A0.
const qa0 = section('Q-A0', 'Q-A1');
ok(/alias_sources_missing_from_cards/.test(qa0),
  'Q-A0 counts alias SOURCE rows missing from cards');
ok(/alias_targets_missing_from_cards/.test(qa0),
  'Q-A0 still counts alias TARGET rows missing from cards');
ok(/where not exists \(select 1 from public\.cards c where c\.id = r\.alias_card_id\)/.test(qa0),
  'the source check tests the alias id against cards, not against the alias table');
ok(/NOT symmetric/i.test(qa0),
  'Q-A0 explains why the source and target checks are asymmetric');

// ── 9d. Q-A7c — operator-only owned linkage ──────────────────────────────────
console.log('\n9d. Q-A7c operator-only owned input');

const qa7c = section('Q-A7c', 'Q-A8a');
ok(qa7c.length > 0 && !qa7c.includes('Q-A7a —'),
  'the Q-A7c slice is bounded by its own statement banner');
ok(/OPERATOR-ONLY/.test(qa7c) && /DO NOT COMMIT/i.test(qa7c),
  'Q-A7c is labelled operator-only and not-to-be-committed');
// The projection must be a single card-id column: no user dimension at all.
const qa7cCode = qa7c.replace(/--[^\n]*/g, '');
ok(!/user_id/i.test(qa7cCode), 'Q-A7c projects no user_id anywhere');
ok(!/quantity/i.test(qa7cCode), 'Q-A7c projects no quantity');
ok(!/batch_id\s+as|\bb\.id\s+as/i.test(qa7cCode), 'Q-A7c projects no batch id');
ok(/as\s+card_id/i.test(qa7cCode), 'Q-A7c projects a single card_id column');
ok(/image_url is null or btrim\(e\.image_url\) = ''|e\.image_url is null or btrim\(e\.image_url\) = ''/i.test(qa7cCode),
  'Q-A7c is scoped to the missing-image population');
ok(/card_identity_resolution/.test(qa7cCode),
  'Q-A7c resolves aliases exactly as production ownership does');

// The gitignore rule is what makes "never committed" structural.
const GITIGNORE = join(ROOT, '.gitignore');
ok(existsSync(GITIGNORE)
  && readFileSync(GITIGNORE, 'utf8').includes('docs/cat-3a-evidence/inputs/'),
  'docs/cat-3a-evidence/inputs/ is gitignored so the owned id list cannot be committed');

// ── 9e. SHA256SUMS semantics are not broadened ───────────────────────────────
console.log('\n9e. checksum manifest scope');

const SUMS = join(ROOT, 'docs', 'sql', 'SHA256SUMS.txt');
ok(existsSync(SUMS) && !readFileSync(SUMS, 'utf8').includes('cat-3a'),
  'CAT-3A is NOT added to the deployment-SQL checksum manifest');
ok(/deployment-SQL\*{0,2} checksum\s*\n?manifest/.test(doc.replace(/\s+/g, ' '))
  || /is a \*\*deployment-SQL\*\* checksum/.test(doc.replace(/\s+/g, ' ')),
  'spec states SHA256SUMS.txt keeps its deployment-only semantics');
ok(/SHA-256 of the reviewed and executed/.test(doc.replace(/\s+/g, ' ')),
  'spec records the executed SQL SHA in the CAT-3A evidence manifest instead');

// ── 10. Specification guardrails ─────────────────────────────────────────────
console.log('\n10. specification guardrails');

ok(/PREPARED — NOT EXECUTED/.test(doc), 'spec states the package is not executed');
ok(/PREPARED — NOT EXECUTED/.test(sqlRaw), 'SQL states it has not been executed');

ok(/CURRENT_RUNTIME_FALLBACK_ELIGIBLE/.test(doc),
  'O2 uses the evidence-safe label');
ok(!/already renders today(?![\s\S]{0,200}must not be paraphrased)/.test(doc)
  || /must not be paraphrased as "already\s*\n?renders today"/.test(doc.replace(/\s+/g, ' ').replace(/must not be paraphrased as "already renders today"/, 'must not be paraphrased as "already\nrenders today"')),
  'the spec does not assert fallback-eligible rows render; it forbids that paraphrase');

ok(/determined \*\*at closeout\*\*/.test(doc) || /determined \*\*at closeout/.test(doc),
  'spec defers the CAT-0 closure claim to the closeout gates');
ok(/It is not\s*\n?asserted in advance/.test(doc),
  'spec explicitly refuses to pre-state that it closes CAT-0');

ok(/rate below 1% is \*\*not by itself a sufficient conclusion gate/.test(doc.replace(/\s+/g, ' ')),
  'G-10 states that a sub-1% rate alone is not sufficient');
ok(/Per-set conclusion/.test(doc) && /Active-owned missing-image conclusion/.test(doc)
  && /Global conclusion/.test(doc),
  'G-10 defines all three conclusion scopes');
ok(/worst-case sensitivity test/i.test(doc), 'G-10 requires the sensitivity test');
ok(/at least 19 of 20/.test(doc) && /at most 1/.test(doc)
  && /0 false definitive classifications/.test(doc),
  'P3-0 states all three pass conditions');

// P3-0 must be two-stage, and must say why a populated image_url is not proof
// of pokemontcg.io validity.
const flatDoc = doc.replace(/\s+/g, ' ');
ok(/Stage 1 — qualification/.test(doc) && /Stage 2 — the gate/.test(doc),
  'P3-0 is specified as two stages');
ok(/says nothing about whether the same id exists in pokemontcg\.io/.test(flatDoc),
  'spec explains that a populated image_url does not prove pTCG validity');
ok(/legitimate provider-ID mismatch, not a reliability failure/i.test(flatDoc),
  'spec distinguishes provider-ID mismatch from source unreliability');
ok(/qualified\*{0,2} only by actually resolving to `F3` or `F4`/.test(flatDoc)
  || /becomes \*\*qualified\*\* only by actually resolving/.test(flatDoc),
  'only probe-qualified ids become controls');
ok(/stratified \(quantile\) draw of 20/.test(flatDoc),
  'stage 2 uses a stratified quantile draw');
ok(/would concentrate controls in whichever era qualifies first/.test(flatDoc),
  'spec states why first-N-unique-sets selection was rejected');
ok(/exact catalog ids only\. No translation, no correspondence, no name\/number lookup/.test(flatDoc),
  'both stages preserve exact-id-only lookup');

// The unused 50-row sample is gone.
ok(!/50 missing-image rows drawn deterministically/.test(doc),
  'the unused 50-row P3-0 sample has been removed');

// G-8 / G-9 semantics.
ok(/`not_evaluated` is a \*\*distinct third state\*\*/.test(flatDoc),
  'not_evaluated is defined as distinct from false');
ok(/\*\*G-8\*\* and \*\*G-9\*\* are `not_evaluated` — \*\*never `true`\*\*/.test(flatDoc),
  'spec states G-8/G-9 can never be true after a G-7 failure');
ok(/computed from row count and T assignment alone would report `true`/.test(flatDoc),
  'spec records the defect the corrected semantics fix');

// P4 non-empty body.
ok(/NON-EMPTY body/.test(doc), 'P4 requires a non-empty body for ASSET_LIVE');
ok(/zero bytes \| `ASSET_INDETERMINATE`/.test(doc.replace(/\s+/g, ' '))
  || /zero bytes \| `ASSET_INDETERMINATE`/.test(doc),
  'P4 verdict table maps zero bytes to indeterminate');

// Full A dimension.
ok(/All 192 pairs are exported with their state \(Q-A6b\), not just A2/.test(flatDoc),
  'spec requires the full 192-pair export');
ok(/would force every A4 canonical row to be labelled `A0`/.test(flatDoc),
  'spec records why an A2-only export is wrong');

// G-3 is a hard stop, and A_UNRESOLVED has its own justification.
ok(/\*\*G-3 is a HARD STOP, not a warning\.\*\*/.test(flatDoc),
  'spec states G-3 is a hard stop');
ok(/before it derives any A state, runs P4, runs P3, or derives any O outcome/.test(flatDoc),
  'spec states what the hard stop precedes');
ok(/A quiet undercount that passes its own completeness check/.test(flatDoc),
  'spec records why a warning was insufficient');
ok(/`alias_card_id` does not\*\*|\*\*`alias_card_id` does not\*\*/.test(flatDoc),
  'spec records that alias_card_id carries no FK');
ok(/there is no alias row to read/.test(flatDoc),
  'spec distinguishes a missing alias row from a genuine A3/A4');
ok(/alias_sources_missing_from_cards/.test(flatDoc),
  'spec names the Q-A0 population-level check');
ok(/alias_row_exists` \/ `canonical_row_exists/.test(flatDoc),
  'spec names the Q-A6b row-level existence flags');

// F2 three-state validation.
ok(/An exhausted 5xx is not confirmation\.\*\*|\*\*An exhausted 5xx is not confirmation\.\*\*/.test(flatDoc),
  'spec states an exhausted 5xx is not confirmation');
ok(/derivation is \*\*untested\*\*, not confirmed/.test(flatDoc),
  'spec labels the indeterminate F2 verdict as untested');
ok(/G-8 and G-9 become `not_evaluated`/.test(flatDoc),
  'spec states a non-PASS F2 verdict blocks the completeness gates');
ok(/global `O5` conclusion is\s*barred|global `O5` conclusion is barred/.test(flatDoc),
  'spec bars the global O5 conclusion on a non-PASS F2 verdict');
ok(/a \*\*small\*\* F2 population could demote quietly, stay under 1%/.test(flatDoc),
  'spec explains why G-10 alone would not close the hole');

// P3-0 pool exhaustion and scoped wording.
ok(/the run continues deterministically through the remaining prepared pool/i.test(flatDoc),
  'spec requires continuing through the prepared pool');
ok(/Scarcity may not be inferred from the first 120/.test(flatDoc),
  'spec forbids inferring scarcity from the first pass');
ok(/Only after the prepared pool is exhausted/.test(flatDoc),
  'spec permits the insufficient verdict only after exhaustion');
ok(/says nothing about how many catalog ids exist in pokemontcg\.io overall/.test(flatDoc),
  'spec scopes the insufficient verdict away from a global claim');
ok(/samples at most two cards per set/.test(flatDoc),
  'spec names the two-per-set limit that forces the scoping');

// Active-owned linkage.
ok(/### 6\.3 Active-owned linkage/.test(doc), 'spec defines the active-owned linkage');
ok(/must not be committed/.test(flatDoc) && /gitignored/.test(flatDoc),
  'spec states the owned id list is never committed and is gitignored');
ok(/committed evidence carries aggregate counts only/i.test(flatDoc),
  'spec limits committed owned evidence to aggregates');
ok(/takes no owned-population argument/.test(flatDoc),
  'spec states the record builder cannot see the owned set');

// Celebrations remeasurement.
ok(/Q-A2b — Celebrations, remeasurement only/.test(doc),
  'spec documents Q-A2b');
ok(/It pairs nothing\.\*{0,2}|\*\*It pairs nothing\.\*\*/.test(flatDoc),
  'spec states Q-A2b pairs nothing');
ok(/`F5`|F5.*PTCGIO_VERIFICATION_FAILED/.test(doc),
  'F5 is retained as a distinct fallback state');
ok(/neither absent nor indeterminate/i.test(doc.replace(/\s+/g, ' ')),
  'F5 is documented as neither absent nor indeterminate');

for (const forbidden of ['translated set', 'correspondence table', 'artwork proxy']) {
  ok(!new RegExp(`we (will|should) (author|build|add) an? ${forbidden}`, 'i').test(doc),
    `spec proposes no ${forbidden}`);
}
ok(/no translation, no query-endpoint search, no set-id substitution/i.test(doc.replace(/\s+/g, ' ')),
  'spec forbids provider translation in P3');

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
