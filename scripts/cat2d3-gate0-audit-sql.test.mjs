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

// Statement splitting must be QUOTE-AWARE. A naive split(';') breaks apart any
// statement whose caveat string contains a semicolon, which silently turns
// "every statement is a self-contained SELECT" into a test of fragments.
function splitStatements(text) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      cur += c;
      if (c === "'") {
        if (text[i + 1] === "'") { cur += "'"; i++; } else quoted = false;
      }
      continue;
    }
    if (c === "'") { quoted = true; cur += c; continue; }
    if (c === ';') { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

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
const statements = splitStatements(code);
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
ok(!/\bas\s+\w*user_id\b/i.test(code) && !/\bas\s+\w*user_ids\b/i.test(code),
  'no output column is a user id — user_id never reaches a result set as a value');
ok(/count\(distinct t\.user_id\)/.test(code),
  'per-table user impact is COUNT(DISTINCT user_id), never the ids themselves');
ok(/count\(distinct rs\.user_id\)/.test(code),
  'Q-B reports impacted collectors as a COUNT(DISTINCT ...) aggregate');
ok(/COUNTS ONLY/.test(sql), 'the file states that Q-C is counts-only and why');

// ── The population gate is three checks, not one ────────────────────────────
console.log('\npopulation gate is three checks');
ok(/THE POPULATION GATE IS THREE CHECKS, NOT ONE/.test(sql),
  'the SQL header states the gate is three checks');
ok(/gate check 1 of 3/.test(sql),
  'Q-A0 is labelled as check 1 of 3, not as the whole gate');
ok(/Passing is NECESSARY, NOT SUFFICIENT/.test(sql),
  'Q-A0 says explicitly that passing is necessary but not sufficient');
ok(/cannot rule out a substitution/.test(sql),
  'the SQL names the failure Q-A0 cannot detect (a substituted numeric row)');
// The doc QUOTES the old claim in order to correct it. That is the point, so
// the assertion is that the phrase never stands as an assertion — it must sit
// next to the correction.
const claimIdx = doc.indexOf('single numeric historical row');
ok(claimIdx === -1 || /not universally true/.test(doc.slice(claimIdx, claimIdx + 260)),
  'the "single numeric historical row breaks it" phrasing survives only as a quoted, corrected overstatement');
ok(!/^(?!.*not true).*a single numeric historical row would break/im.test(sql),
  'the SQL never asserts that a single numeric historical row would break Q-A0');
ok(/independent discriminator/.test(sql) && /independent discriminator/.test(doc),
  'upstream liveness is named as the independent discriminator in both files');
ok(/as SETS, not just as counts|as sets, not\njust as counts|\*\*as sets, not\njust as counts\*\*/.test(sql + doc),
  'the upstream comparison is specified as a set comparison, not a count comparison');
ok(/Q-B..Q-G may not be run until|may not be run until it passes|Only when all three pass/.test(sql + doc),
  'the doc/SQL state that Q-B..Q-G may not run until the gate passes');

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
const qa1 = splitStatements(code).find((s) => s.includes('partition'));
ok(!!qa1 && !/where[^;]*local_id ~ '\^\[0-9\]\+\$' is not true/i.test(qa1),
  'Q-A1 enumerates all 50 cel25 rows, not just the historical partition');

// ── Q-C0 classifies rather than blanket-STOPping ────────────────────────────
//
// A bare '%card_id%' sweep legitimately surfaces columns that are NOT catalog
// card references — binder_card_id is a membership FK, alias/canonical are the
// identity map itself. A rule of "anything Q-C does not cover is a STOP" would
// fire on known-immune structure and cry wolf.
console.log('\nQ-C0 classifies every card-id-like column');
const qc0 = splitStatements(code).find((s) => s.includes('information_schema.columns'));
ok(!!qc0, 'Q-C0 located');
for (const cls of [
  'immutable import evidence',
  'identity infrastructure',
  'membership reference',
  'direct catalog reference',
  'STOP: unclassified card-id-like reference',
]) {
  ok(qc0.includes(cls), `Q-C0 emits the "${cls}" class`);
}
ok(/user_binder_layout_items.*binder_card_id/s.test(qc0),
  'Q-C0 classifies binder_card_id explicitly rather than letting it fall through to STOP');
ok(/user_import_rows.*candidate_card_ids/s.test(qc0),
  'Q-C0 classifies candidate_card_ids as immutable import evidence');
ok(/THE STOP CONDITION IS THE LAST CLASS ONLY/.test(sql),
  'the SQL states the stop condition fires only on the unclassified class');
ok(/No row classified `STOP: unclassified card-id-like reference`/.test(doc),
  'the doc checklist asks only for zero unclassified rows, not zero uncovered tables');

// ── card_extras is catalog metadata, not collector-authored state ───────────
console.log('\ncard_extras is not collector-authored state');
ok(/card_extras IS NOT COLLECTOR-AUTHORED STATE/.test(sql),
  'the SQL states plainly that card_extras is catalog/editorial metadata');
ok(/'catalog\/editorial metadata \(global, not collector-authored\)'/.test(code),
  'Q-C labels card_extras with its own reference class');
const qg = splitStatements(code).find((s) => s.includes('collector_authored_reference_rows'));
ok(!!qg, 'Q-G exposes a collector_authored_reference_rows total');
// The collector-authored sum is the parenthesised block immediately preceding
// its alias. card_extras must not appear inside it.
const collectorSum = qg ? qg.slice(0, qg.indexOf('as collector_authored_reference_rows')).slice(-900) : '';
ok(collectorSum.length > 0 && !collectorSum.includes('card_extras'),
  'card_extras is NOT summed into the collector-authored total');
ok(!!qg && /as\s+card_extras_reference_rows/.test(qg),
  'card_extras is reported separately as a catalog-metadata migration signal');

// ── user_binder_cards owner counting ────────────────────────────────────────
console.log('\nbinder owner counting');
ok(/join public\.user_binders ub on ub\.id = t\.binder_id/.test(code),
  'owner count for user_binder_cards is derived by joining the parent binder');
ok(/count\(distinct ub\.user_id\)/.test(code),
  'distinct owners come from user_binders.user_id');
ok(/count\(distinct t\.binder_id\)\s*\n?\s*--?.*binders|as\s+distinct_binders/.test(code) ||
   /distinct_binders/.test(code),
  'distinct binders are reported under their own name');
ok(!/count\(distinct t\.binder_id\)[^,]*as distinct_owners/i.test(code),
  'a binder count is never emitted as distinct_owners');

// ── Gate 0 does not do CAT-2D.3's identity work ─────────────────────────────
console.log('\nno identity claim');
ok(!/cel25cc-CC\d/.test(sql),
  'no specific cel25cc survivor id is named anywhere — no pair list has crept in');
ok(!/alias_card_id\s*,\s*canonical_card_id/.test(code),
  'no alias-shaped (alias, canonical) projection exists');
ok(/DIAGNOSTIC ONLY/.test(sql) && /NAME OVERLAP IS NOT ALIAS EVIDENCE/.test(sql),
  'name overlap is labelled DIAGNOSTIC ONLY and explicitly not alias evidence');
ok(/NOT a historical->survivor mapping/.test(sql),
  'the artist comparison carries its own not-a-mapping caveat column');

// ── Artist and UI claims are narrowed to what production proves ─────────────
console.log('\nartist / UI claims are evidence-safe');
ok(/ARTIST-QUERY REACHABILITY\. Not "is rendered today"/.test(sql),
  'Q-D states it measures reachability, not rendering');
ok(/fetchArtistCards/.test(sql),
  'Q-D grounds the claim in the actual production query path');
ok(/artist_query_reachable/.test(code),
  'Q-D output columns are named for reachability');
ok(/illustrator_reachable/.test(code),
  'illustrator-string reachability is measured too — a NULL artist_id is not automatically unreachable');
ok(!/visible_on_artist_page/.test(code),
  'no output column claims a row is visible on an artist page');
ok(!/shows the printing twice|show the printing twice/i.test(sql.replace(/does NOT establish[\s\S]{0,200}/g, '')) ||
   /does NOT establish\s*\n--\s*that "every catalog surface shows the printing twice"/.test(sql),
  'the "every catalog surface shows the printing twice" claim appears only as the thing being disclaimed');
ok(/CONCURRENT CATALOG PRESENCE/.test(sql),
  'Q-E is framed as concurrent presence, not duplicate presentation');
ok(/both populations are concurrently present in the canonical catalog/i.test(sql),
  'Q-E uses evidence-safe language for co-presence');
ok(/no row-to-row printing identity is asserted/i.test(sql),
  'Q-E states no row-to-row printing identity is asserted');
ok(!!qg && /historical_names_also_in_cel25cc/.test(qg),
  'Q-G carries the exact-name-overlap diagnostic, not co-presence alone');
ok(!!qg && /historical_present_in_catalog/.test(qg) && !/duplicate/i.test(qg),
  'Q-G names co-presence as presence, never as "duplicate"');
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
