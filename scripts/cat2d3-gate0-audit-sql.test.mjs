#!/usr/bin/env node
// scripts/cat2d3-gate0-audit-sql.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
// CAT-2D.3 Gate 0 — audit SQL safety harness (DEV-ONLY; no network, no
// database, no credentials).
//
// WHAT THIS PROVES
//
//   Gate 0 is a READ-ONLY production audit. The whole point is that it can be
//   run against production without a review of what it might do. That property
//   has to be structural, not a promise in a comment — so this asserts it:
//
//     * no write, DDL or DML statement of any kind;
//     * no TEMP objects and no top-level transaction wrapper, because CAT-2D.2
//       established that this workflow must not depend on cross
//       top-level-statement TEMP or session state;
//     * every statement independently self-contained — each repeats the
//       population CTE rather than reading state another statement built;
//     * no hard-coded user UUID, and no statement that could emit one;
//     * the historical-population selector is EXPLICIT and falsifiable, with
//       its integrity checks present.
//
//   It also pins the scope boundary that matters most for this gate: the audit
//   must not contain a historical → survivor mapping. Gate 0 answers a
//   prioritisation question; it does not do CAT-2D.3's identity work, and a
//   file that quietly grew a pair list would have crossed that line.
//
// Run: node scripts/cat2d3-gate0-audit-sql.test.mjs
// No test framework is introduced (matches the OL-0A/0C/0D/CAT-2D harnesses).
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SQL_PATH = join(ROOT, 'docs', 'sql', 'cat-2d3-gate0-impact-audit.sql');
const DOC_PATH = join(ROOT, 'docs', 'CAT-2D.3_GATE0_IMPACT_AUDIT.md');

let passed = 0;
let failed = 0;
const failures = [];
const ok = (cond, msg) => {
  if (cond) { passed++; console.log(`  ok   ${msg}`); }
  else { failed++; failures.push(msg); console.error(`  FAIL ${msg}`); }
};

const lf = (t) => t.split('\r\n').join('\n');
const read = (p) => lf(readFileSync(p, 'utf8'));

const sql = read(SQL_PATH);
const doc = read(DOC_PATH);

// Comments are where this file explains itself at length, and several forbidden
// keywords legitimately appear there ("no DDL", "never rewritten", ...). Every
// safety assertion therefore runs over EXECUTABLE SQL only.
const code = sql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
const codeLower = code.toLowerCase();

console.log('\nCAT-2D.3 Gate 0 — audit SQL safety\n');

// ── Read-only ───────────────────────────────────────────────────────────────
console.log('read-only');
const FORBIDDEN = [
  'insert into', 'update ', 'delete from', 'truncate', 'merge into',
  'create table', 'create or replace', 'create index', 'create view',
  'create function', 'create temporary', 'create temp',
  'alter ', 'drop ', 'grant ', 'revoke ', 'lock table',
  'do $$', 'call ', 'refresh materialized',
];
for (const kw of FORBIDDEN) {
  ok(!codeLower.includes(kw), `executable SQL contains no "${kw.trim()}"`);
}
ok(!/\bset_config\s*\(/i.test(code), 'no set_config — no session or JWT state is established');
ok(!/\bset\s+role\b/i.test(code), 'no SET ROLE — no impersonation');
ok(!/\bselect\s+.*\binto\b/i.test(code.replace(/\bint\b/g, '')),
  'no SELECT ... INTO (which would create a table)');

// ── No transaction wrapper, no TEMP ─────────────────────────────────────────
console.log('\nno transaction wrapper, no TEMP');
for (const kw of ['begin', 'commit', 'rollback', 'start transaction', 'savepoint']) {
  ok(!new RegExp(`^\\s*${kw}\\b`, 'im').test(code),
    `no top-level ${kw.toUpperCase()}`);
}
ok(!/\btemp(orary)?\b/i.test(code), 'no TEMP object anywhere in executable SQL');
ok(!/\bpg_temp\b/i.test(code), 'no pg_temp reference');

// ── Every statement is a self-contained SELECT ──────────────────────────────
console.log('\nstatements are self-contained SELECTs');
const statements = code
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean);
ok(statements.length >= 8, `the audit has ${statements.length} statements`);
ok(statements.every((s) => /^with\b|^select\b/i.test(s)),
  'every statement starts with WITH or SELECT — nothing else is executable here');

// The population CTE must be repeated per statement rather than shared, which
// is what makes each independently runnable.
const popStatements = statements.filter((s) => s.includes("set_id = 'cel25'"));
ok(popStatements.length >= 7,
  `${popStatements.length} statements define their own cel25 population inline`);
ok(popStatements.every((s) => /with\s+cel25_all\s+as\s*\(/i.test(s) || /from public\.cards c where c\.set_id = 'cel25'/i.test(s)),
  'each of those declares the population itself rather than reading another statement');

// ── No user-identifying literals ────────────────────────────────────────────
console.log('\nno user-identifying values');
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
ok(!UUID.test(sql), 'no hard-coded UUID anywhere in the file');
ok(!/\bselect\b[^;]*\bt\.user_id\b(?![^;]*count)/is.test(code) || !/select\s+t\.user_id/i.test(code),
  'no statement selects a raw user_id column');
ok(/count\(distinct t\.user_id\)/.test(code),
  'user impact is expressed as COUNT(DISTINCT user_id), never as the ids themselves');
ok(/COUNTS ONLY/.test(sql), 'the file states that Q-C is counts-only and why');

// ── The population selector is explicit and falsifiable ─────────────────────
console.log('\npopulation selector is explicit and falsifiable');
ok(/THE POPULATION SELECTOR/.test(sql),
  'the file carries a dedicated section explaining how the 25 rows are selected');
ok(/local_id ~ '\^\[0-9\]\+\$' is not true/.test(code),
  'the historical partition is defined by an explicit, anchored local_id predicate');
ok(/base_set_is_exactly_1_to_25/.test(code),
  'Q-A0 asserts the complement is exactly the integers 1..25 — the falsification test');
ok(/rows_with_null_local_id/.test(code),
  'Q-A0 accounts for NULL local_id, so no row can fall silently outside both partitions');
ok(/historical_rows_matching_cc_pattern/.test(code),
  'Q-A0 re-checks that no CC### row exists, corroborating the CAT-2D.2 finding');
ok(/WHAT IS NOT ESTABLISHED, AND IS THEREFORE ASSUMED HERE/.test(sql),
  'the file separates established evidence from the one assumption it makes');
ok(/api\.tcgdex\.net\/v2\/en\/sets\/cel25/.test(sql),
  'the required out-of-SQL upstream corroboration step is spelled out');

// Q-A1 must enumerate BOTH partitions, so the split is reviewable by eye.
const qa1 = code.split(';').find((s) => s.includes('partition'));
ok(!!qa1 && !/where[^;]*local_id ~ '\^\[0-9\]\+\$' is not true/i.test(qa1),
  'Q-A1 enumerates all 50 cel25 rows, not just the historical partition');

// ── Gate 0 does not do CAT-2D.3's identity work ─────────────────────────────
console.log('\nno identity claim');
ok(!/cel25cc-CC\d/.test(sql),
  'no specific cel25cc survivor id is named anywhere — no pair list has crept in');
ok(!/alias_card_id\s*,\s*canonical_card_id/.test(code),
  'no alias-shaped (alias, canonical) projection exists');
ok(/DIAGNOSTIC ONLY/.test(sql) && /name overlap is not identity evidence/i.test(sql),
  'name overlap is labelled DIAGNOSTIC ONLY in the output itself');
ok(/NOT a historical->survivor mapping/.test(sql),
  'the artist comparison carries its own not-a-mapping caveat column');
ok(/Gate 0 makes NO alias decision and proposes NO mapping/.test(sql),
  'the severity roll-up restates the scope boundary in its own output');
ok(/Cross-printing image substitution|cross-printing image substitution/i.test(sql),
  'the image comparison restates the cross-printing substitution prohibition');

// ── Doc and SQL agree ───────────────────────────────────────────────────────
console.log('\ndoc and SQL agree');
for (const q of ['Q-A0', 'Q-A1', 'Q-C0', 'Q-B', 'Q-C', 'Q-D', 'Q-E', 'Q-F', 'Q-G']) {
  ok(sql.includes(q) && doc.includes(q), `${q} appears in both the SQL and the audit doc`);
}
ok(/LOAD-BEARING NOW/.test(doc) && /VISIBLE BUT NON-LOAD-BEARING/.test(doc) && /DORMANT/.test(doc),
  'the doc carries all three classifications');
ok(/Mixed evidence is a permitted outcome/.test(doc),
  'the doc allows a mixed verdict rather than forcing a label');
ok(/Not yet run/.test(doc) && /\(pending\)/.test(doc),
  'the production-results section is present and blank');
ok(/Gate 0 \*\*does not\*\*/.test(doc) || /Gate 0 \*\*makes no alias decision/.test(doc),
  'the doc states explicitly that Gate 0 makes no alias decision');

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
