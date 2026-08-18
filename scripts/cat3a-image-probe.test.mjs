#!/usr/bin/env node
// scripts/cat3a-image-probe.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
// CAT-3A — external probe safety harness (DEV-ONLY; no network, no database,
// no credentials).
//
// WHAT THIS PROVES
//
//   scripts/cat3a-image-probe.mjs is a read-only classifier that measures the
//   contract production actually has. Three properties have to be structural
//   rather than promised:
//
//     1. IT CANNOT TOUCH THE DATABASE OR HOLD A SECRET.
//        No Supabase import, no createClient, no process.env read at all.
//        The probe's only input is a committed CSV export.
//
//     2. IT CANNOT INVENT A PROVIDER CORRESPONDENCE.
//        The catalog id is used VERBATIM against both sources. No set-id
//        translation, no query-endpoint search, no mapping table. A probe that
//        translated ids would report recoverability for rows the runtime cannot
//        resolve, which is precisely the conclusion CAT-3A must not reach by
//        accident.
//
//     3. INDETERMINATE IS NEVER COERCED TO ABSENT.
//        404/410 is the only definitive-absent class. Every other non-OK status
//        exhausts the retry budget and then reports indeterminate. This is
//        asserted BEHAVIOURALLY against the exported classifiers, not by
//        reading the source for reassuring words.
//
//   It also pins the gate ordering (P3 is unreachable unless P3-0 passes), the
//   T2-escalation rule, the F5 boundary, the O precedence and the worst-case
//   sensitivity promotion rules.
//
// Importing the probe module runs NO network request: the module guards its
// entry point on being invoked directly.
//
// Run: node scripts/cat3a-image-probe.test.mjs
// No test framework is introduced.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROBE_PATH = join(ROOT, 'scripts', 'cat3a-image-probe.mjs');
const DOC_PATH = join(ROOT, 'docs', 'CAT-3A_IMAGE_COVERAGE_AND_RECOVERABILITY_AUDIT.md');

let passed = 0;
let failed = 0;
const failures = [];
const ok = (cond, msg) => {
  if (cond) { passed++; console.log(`  ok   ${msg}`); }
  else { failed++; failures.push(msg); console.error(`  FAIL ${msg}`); }
};

console.log('CAT-3A — external probe safety harness\n');

ok(existsSync(PROBE_PATH), 'probe file exists');
if (!existsSync(PROBE_PATH)) { console.error('\nProbe missing — aborting.'); process.exit(1); }

const src = readFileSync(PROBE_PATH, 'utf8');
// Strip block and line comments so prose cannot satisfy — or trip — a source
// assertion. Everything in section 1-4 inspects EXECUTABLE code only.
const codeOnly = src
  .replace(/^\s*\/\/[^\n]*$/gm, '')
  .replace(/\/\*[\s\S]*?\*\//g, '');

const probe = await import(pathToFileURL(PROBE_PATH).href);
const { T, F, A, ASSET, O } = probe;

// ── 1. No database, no credentials ───────────────────────────────────────────
console.log('\n1. no database, no credentials');

for (const token of ['@supabase', 'supabase', 'createClient', 'SERVICE_ROLE', 'SERVICE_KEY']) {
  ok(!codeOnly.includes(token), `no "${token}" reference in executable code`);
}
ok(!/process\.env/.test(codeOnly), 'reads no environment variable at all');
ok(!/X-Api-Key|x-api-key|POKEMONTCG_API_KEY/i.test(codeOnly),
  'sends no API key — the runtime sends none, so neither does the probe');
ok(/keyless/i.test(src), 'the keyless-by-design decision is documented in the file');

for (const verb of ['.insert(', '.update(', '.upsert(', '.delete(', '.rpc(']) {
  ok(!codeOnly.includes(verb), `no write verb "${verb}"`);
}
// The only permitted writes are the probe's own evidence files.
const writeCalls = [...codeOnly.matchAll(/writeFileSync\(/g)].length;
ok(writeCalls > 0 && writeCalls <= 6,
  `writes only its own evidence files (${writeCalls} writeFileSync calls)`);
ok(!/method\s*:\s*['"](POST|PUT|PATCH|DELETE)/i.test(codeOnly),
  'issues no non-GET HTTP method');

// ── 2. Normalizers imported, never reimplemented ─────────────────────────────
console.log('\n2. production contracts imported, not reimplemented');

ok(/from '\.\.\/src\/services\/imageService\.js'/.test(codeOnly),
  'imports from src/services/imageService.js');
ok(/normalizeName/.test(codeOnly) && /normalizeNumber/.test(codeOnly)
  && /normalizeSetIdForDiagnostics/.test(codeOnly) && /fingerprintCard/.test(codeOnly),
  'imports all four verification contracts');
ok(/from '\.\.\/src\/utils\/imageUrl\.js'/.test(codeOnly),
  'imports imgSmall from src/utils/imageUrl.js for the asset URL shape');

for (const name of ['normalizeName', 'normalizeNumber', 'normalizeSetIdForDiagnostics',
  'fingerprintCard', 'imgSmall']) {
  ok(!new RegExp(`function\\s+${name}\\s*\\(`).test(codeOnly),
    `does not define its own ${name}`);
}

// ── 3. No provider correspondence ────────────────────────────────────────────
console.log('\n3. no provider correspondence');

for (const token of ['swsh45', 'swsh12pt5', 'NULL_SETS', 'SET_ID_MAP', 'setIdMap',
  'correspondence', 'translateSet', 'cel25c']) {
  ok(!codeOnly.includes(token), `no correspondence token "${token}"`);
}
// A search endpoint is how a translated lookup would sneak in. The probe must
// only ever address a card by its verbatim catalog id.
ok(!/\/cards\?q=|[?&]q=set\.id|[?&]q=name/.test(codeOnly),
  'never uses the pokemontcg.io search endpoint to find a differently-namespaced card');
ok(/cards\/\$\{enc\.value\}/.test(codeOnly),
  'addresses cards by the encoded verbatim catalog id');

// ── 4. Gate ordering ─────────────────────────────────────────────────────────
console.log('\n4. gate ordering');

const runP3Calls = [...codeOnly.matchAll(/await runP3\(/g)];
ok(runP3Calls.length === 1, 'runP3 has exactly one call site');
const gateIdx = codeOnly.indexOf('if (p30.gate.passed)');
const p3Idx = codeOnly.indexOf('await runP3(');
ok(gateIdx !== -1 && p3Idx > gateIdx,
  'P3 is invoked only inside the P3-0 pass branch (G-7 is structural)');
ok(/G-7 FAILED/.test(src), 'a failed reliability gate is reported explicitly');

// ── 5. HTTP classification — behavioural ─────────────────────────────────────
console.log('\n5. HTTP classification (behavioural)');

ok(probe.classifyHttpStatus(404) === 'absent', '404 is definitive absent');
ok(probe.classifyHttpStatus(410) === 'absent', '410 is definitive absent');
for (const s of [429, 500, 502, 503, 504, 401, 403, 418]) {
  ok(probe.classifyHttpStatus(s) === 'indeterminate', `${s} is indeterminate, never absent`);
}
ok(probe.classifyHttpStatus(200) === 'ok', '200 is ok');
ok(probe.classifyHttpStatus(204) === 'ok', '204 is ok');

ok(probe.encodeIdSegment('exu-?').ok === true, 'punctuation ids are probed, not excused');
ok(probe.encodeIdSegment('exu-?').value === 'exu-%3F', '? is percent-encoded');
ok(probe.encodeIdSegment('').ok === false, 'empty id is unprobeable');
ok(probe.encodeIdSegment('\uD800').ok === false, 'lone surrogate is unprobeable');

// ── 6. Dimension T ───────────────────────────────────────────────────────────
console.log('\n6. dimension T');

const row = { id: 'x-1', set_id: 'x', local_id: '1', name: 'Pikachu' };

ok(probe.classifyTcgdexFromSet(row, { state: 'SET_ABSENT' }).t === T.ABSENT,
  'absent set namespace yields T3');
ok(probe.classifyTcgdexFromSet(row, { state: 'SET_ABSENT' }).reason === 'set_namespace_absent',
  'T3 sub-reason distinguishes namespace absence');
ok(probe.classifyTcgdexFromSet(row, { state: 'SET_INDETERMINATE' }).t === T.INDETERMINATE,
  'indeterminate set yields T4, never T3');

const withImage = {
  state: 'SET_PRESENT', briefsProjectImage: true,
  briefById: new Map([['x-1', { id: 'x-1', image: 'https://assets.tcgdex.net/en/x/1' }]]),
};
ok(probe.classifyTcgdexFromSet(row, withImage).t === T.IMAGE_AVAILABLE, 'brief image yields T1');

// The escalation rule: a payload that never projects `image` proves nothing.
const noProjection = {
  state: 'SET_PRESENT', briefsProjectImage: false,
  briefById: new Map([['x-1', { id: 'x-1' }]]),
};
ok(probe.classifyTcgdexFromSet(row, noProjection).t === null,
  'a brief without image escalates when the payload never projects image');
ok(probe.classifyTcgdexFromSet(row, noProjection).reason === 'escalate_card_detail',
  'escalation is explicit, not a silent T2');

const projected = {
  state: 'SET_PRESENT', briefsProjectImage: true,
  briefById: new Map([['x-1', { id: 'x-1' }]]),
};
ok(probe.classifyTcgdexFromSet(row, projected).t === T.PRESENT_NO_IMAGE,
  'T2 only once the payload is proven to project image');

ok(probe.classifyTcgdexFromCard({ kind: 'absent' }).t === T.ABSENT, 'card 404 yields T3');
ok(probe.classifyTcgdexFromCard({ kind: 'indeterminate', reason: 'http_500' }).t === T.INDETERMINATE,
  'card 5xx yields T4');
ok(probe.classifyTcgdexFromCard({ kind: 'ok', json: { image: 'https://a/b' } }).t === T.IMAGE_AVAILABLE,
  'card with image yields T1');
ok(probe.classifyTcgdexFromCard({ kind: 'ok', json: {} }).t === T.PRESENT_NO_IMAGE,
  'card without image yields T2');
ok(probe.classifyTcgdexFromCard({ kind: 'ok', json: { image: '   ' } }).t === T.PRESENT_NO_IMAGE,
  'blank image string is not an image');

// ── 7. Dimension F ───────────────────────────────────────────────────────────
console.log('\n7. dimension F');

const exact = {
  kind: 'ok',
  json: { data: { id: 'x-1', name: 'Pikachu', number: '1', set: { id: 'x' }, images: { small: 's' } } },
};
ok(probe.classifyPtcgioFromCard(row, exact).f === F.EXACT_VERIFIED, 'verified exact printing yields F3');

const verifiedNoImg = {
  kind: 'ok',
  json: { data: { id: 'x-1', name: 'Pikachu', number: '1', set: { id: 'x' } } },
};
ok(probe.classifyPtcgioFromCard(row, verifiedNoImg).f === F.VERIFIED_NO_IMAGE,
  'verified entity without images yields F4');

const mismatched = {
  kind: 'ok',
  json: { data: { id: 'x-1', name: 'Raichu', number: '1', set: { id: 'x' }, images: { small: 's' } } },
};
ok(probe.classifyPtcgioFromCard(row, mismatched).f === F.VERIFICATION_FAILED,
  'name mismatch yields F5, not F3');

const nullName = {
  kind: 'ok',
  json: { data: { id: 'x-1', number: '1', set: { id: 'x' }, images: { small: 's' } } },
};
ok(probe.classifyPtcgioFromCard(row, nullName).f === F.VERIFICATION_FAILED,
  'indeterminate remote metadata yields F5 — null is not a pass');

ok(probe.classifyPtcgioFromCard(row, { kind: 'absent' }).f === F.EXACT_ID_ABSENT,
  '404 yields F6');
ok(probe.classifyPtcgioFromCard(row, { kind: 'indeterminate', reason: 'http_503' }).f === F.INDETERMINATE,
  '5xx yields F7');
ok(probe.classifyPtcgioFromCard(row, { kind: 'ok', json: {} }).f === F.INDETERMINATE,
  'unparseable payload yields F7, never F6');

// F5 must be a distinct value, never an alias of another class.
const fValues = Object.values(F);
ok(new Set(fValues).size === fValues.length, 'every F value is distinct');
ok(F.VERIFICATION_FAILED !== F.EXACT_ID_ABSENT && F.VERIFICATION_FAILED !== F.INDETERMINATE,
  'F5 is neither F6 nor F7');

// set_match is recorded but must not decide anything: flipping only set_match
// must not change the verdict.
const setMismatch = {
  kind: 'ok',
  json: { data: { id: 'x-1', name: 'Pikachu', number: '1', set: { id: 'DIFFERENT' }, images: { small: 's' } } },
};
ok(probe.classifyPtcgioFromCard(row, setMismatch).f === F.EXACT_VERIFIED,
  'set_match is diagnostic only and never blocks a verdict');
ok(probe.classifyPtcgioFromCard(row, setMismatch).checks.set_match === false,
  'set_match is still recorded as evidence');

// ── 8. Derived outcome precedence ────────────────────────────────────────────
console.log('\n8. derived outcome O');

const d = (o) => probe.deriveOutcome({
  t: T.PRESENT_NO_IMAGE, f: F.EXACT_ID_ABSENT, a: A.NOT_APPLICABLE,
  assetLiveness: ASSET.NOT_APPLICABLE, ...o,
});

ok(d({ t: T.INDETERMINATE }) === O.INDETERMINATE, 'T4 dominates -> O0');
ok(d({ f: F.INDETERMINATE }) === O.INDETERMINATE, 'F7 dominates -> O0');
ok(d({ a: A.ALIAS_ONLY, assetLiveness: ASSET.INDETERMINATE }) === O.INDETERMINATE,
  'indeterminate alias asset -> O0');
ok(d({ t: T.IMAGE_AVAILABLE, f: F.NOT_REQUIRED }) === O.TCGDEX_DETERMINISTIC, 'T1 -> O1');
ok(d({ f: F.EXACT_VERIFIED }) === O.FALLBACK_ELIGIBLE, 'F3 -> O2');
ok(d({ a: A.ALIAS_ONLY, assetLiveness: ASSET.LIVE }) === O.ALIAS_CANDIDATE, 'live A2 -> O3');
ok(d({ f: F.INSUFFICIENT_METADATA }) === O.BLOCKED_METADATA, 'F1 -> O4');
ok(d({}) === O.NOT_RECOVERABLE, 'F6 -> O5');
ok(d({ f: F.NAMESPACE_UNREACHABLE }) === O.NOT_RECOVERABLE, 'F2 -> O5');
ok(d({ f: F.VERIFICATION_FAILED }) === O.NOT_RECOVERABLE, 'F5 -> O5');
ok(d({ f: F.VERIFIED_NO_IMAGE }) === O.NOT_RECOVERABLE, 'F4 -> O5');

// A dead alias asset must NOT become a recovery candidate.
ok(d({ a: A.ALIAS_ONLY, assetLiveness: ASSET.DEAD }) === O.NOT_RECOVERABLE,
  'a dead alias asset is not a recovery candidate');

// Every (T,F) pair must resolve to exactly one O — no undefined outcome.
let undefinedOutcomes = 0;
for (const t of Object.values(T)) {
  for (const f of Object.values(F)) {
    for (const a of [A.NOT_APPLICABLE, A.ALIAS_ONLY]) {
      for (const al of [ASSET.NOT_APPLICABLE, ASSET.LIVE, ASSET.DEAD, ASSET.INDETERMINATE]) {
        const o = probe.deriveOutcome({ t, f, a, assetLiveness: al });
        if (!Object.values(O).includes(o)) undefinedOutcomes++;
      }
    }
  }
}
ok(undefinedOutcomes === 0, 'every (T,F,A,asset) combination resolves to exactly one O');

// ── 9. Worst-case sensitivity ────────────────────────────────────────────────
console.log('\n9. worst-case sensitivity');

const s = (o) => probe.sensitivityOutcome({
  a: A.NOT_APPLICABLE, assetLiveness: ASSET.NOT_APPLICABLE,
  outcome: O.INDETERMINATE, ...o,
});

ok(s({ t: T.INDETERMINATE, f: F.INDETERMINATE }) === O.TCGDEX_DETERMINISTIC,
  'unknown TCGdex state is promoted to the most actionable outcome O1');
ok(s({ t: T.PRESENT_NO_IMAGE, f: F.INDETERMINATE }) === O.FALLBACK_ELIGIBLE,
  'a row TCGdex is known not to hold is promoted only to O2, never O1');
ok(s({ t: T.ABSENT, f: F.INDETERMINATE }) === O.FALLBACK_ELIGIBLE,
  'T3 + F7 is promoted only to O2');
ok(s({ t: T.PRESENT_NO_IMAGE, f: F.EXACT_ID_ABSENT, a: A.ALIAS_ONLY, assetLiveness: ASSET.INDETERMINATE })
  === O.ALIAS_CANDIDATE,
  'indeterminate alias asset is promoted to O3');
ok(probe.sensitivityOutcome({
  t: T.PRESENT_NO_IMAGE, f: F.EXACT_ID_ABSENT, a: A.NOT_APPLICABLE,
  assetLiveness: ASSET.NOT_APPLICABLE, outcome: O.NOT_RECOVERABLE,
}) === O.NOT_RECOVERABLE, 'a determinate outcome is never promoted');

// ── 10. P3-0 reliability gate ────────────────────────────────────────────────
console.log('\n10. P3-0 reliability gate');

const controls = (spec) => {
  const out = [];
  for (const [f, n] of Object.entries(spec)) for (let i = 0; i < n; i++) out.push({ f });
  return out;
};

ok(probe.evaluateReliabilityGate(controls({ [F.EXACT_VERIFIED]: 20 })).passed,
  '20 verified controls pass');
ok(probe.evaluateReliabilityGate(
  controls({ [F.EXACT_VERIFIED]: 19, [F.INDETERMINATE]: 1 })).passed,
  '19 valid + 1 indeterminate passes');
ok(!probe.evaluateReliabilityGate(
  controls({ [F.EXACT_VERIFIED]: 18, [F.INDETERMINATE]: 2 })).passed,
  '18 valid + 2 indeterminate fails');
ok(!probe.evaluateReliabilityGate(
  controls({ [F.EXACT_VERIFIED]: 19, [F.EXACT_ID_ABSENT]: 1 })).passed,
  'a single false-absent control fails the gate outright');
ok(!probe.evaluateReliabilityGate(
  controls({ [F.EXACT_VERIFIED]: 19, [F.VERIFICATION_FAILED]: 1 })).passed,
  'a single false verification-failure fails the gate outright');
ok(probe.evaluateReliabilityGate(
  controls({ [F.EXACT_VERIFIED]: 15, [F.VERIFIED_NO_IMAGE]: 5 })).passed,
  'F4 counts as a definitive-valid control result');
// A control that lands outside all three counted classes (e.g. F1, which means
// the control pool itself was built wrong) does NOT get a fourth, unapproved
// pass condition invented for it. The approved rule set is exactly three
// conditions. What the gate must do is make such a control VISIBLE via `other`,
// so a pool-selection defect is reviewable rather than silently absorbed.
const withOther = probe.evaluateReliabilityGate(
  controls({ [F.EXACT_VERIFIED]: 19, [F.INSUFFICIENT_METADATA]: 1 }));
ok(withOther.other === 1,
  'a control outside the three counted classes is surfaced as `other`');
ok(withOther.valid === 19 && withOther.passed === true,
  'the gate applies exactly the three approved conditions and no fourth');
ok(!probe.evaluateReliabilityGate(
  controls({ [F.EXACT_VERIFIED]: 18, [F.INSUFFICIENT_METADATA]: 2 })).passed,
  'enough off-class controls still fail the gate through the valid-count condition');

const g = probe.evaluateReliabilityGate(controls({ [F.EXACT_VERIFIED]: 19, [F.EXACT_ID_ABSENT]: 1 }));
ok(g.conditions.c3_zero_false_definitive === false && g.conditions.c1_valid_at_least_19 === true,
  'the three gate conditions are reported independently');

// ── 10b. P3-0 two-stage qualification ────────────────────────────────────────
console.log('\n10b. P3-0 two-stage qualification');

ok(/Stage 1 — qualification/.test(src) && /Stage 2 — the gate/.test(src),
  'runP30 is implemented in two stages');
ok(/const isQualified = v\.f === F\.EXACT_VERIFIED \|\| v\.f === F\.VERIFIED_NO_IMAGE/.test(codeOnly),
  'a candidate qualifies only by an actual exact-ID success');
ok(/qualified\.length < P30_CONTROL_COUNT/.test(codeOnly),
  'too few qualified controls fails the gate explicitly rather than proceeding');
ok(/stratifiedSample\(qualified, P30_CONTROL_COUNT\)/.test(codeOnly),
  'stage 2 draws controls from the QUALIFIED set, stratified');
ok(/stratifiedSample\(reachable, P30_QUALIFY_CANDIDATES\)/.test(codeOnly),
  'stage 1 candidates are themselves stratified across the pool');
// The rejected design: first-N-unique-sets in release order.
ok(!/usedSets/.test(codeOnly),
  'the first-N-unique-sets selection has been removed');
ok(!/50/.test(codeOnly.match(/async function runP30[\s\S]*?\n}/)?.[0] || ''),
  'the unused 50-row P3-0 sample is gone');

// stratifiedSample must genuinely span the range, not take a prefix.
const seq = Array.from({ length: 100 }, (_, i) => i);
const drawn = probe.stratifiedSample(seq, 20);
ok(drawn.length === 20, 'stratified draw returns the requested count');
ok(drawn[0] === 0 && drawn[drawn.length - 1] === 99,
  'stratified draw spans both ends of the range');
ok(drawn.some(v => v > 40 && v < 60), 'stratified draw covers the middle of the range');
ok(new Set(drawn).size === drawn.length, 'stratified draw has no duplicates');
ok(JSON.stringify(probe.stratifiedSample(seq, 20)) === JSON.stringify(drawn),
  'stratified draw is deterministic');
ok(probe.stratifiedSample([1, 2, 3], 20).length === 3, 'a short list is returned whole');
ok(probe.stratifiedSample([], 20).length === 0, 'an empty list yields an empty draw');

// ── 10c. P4 asset liveness requires a non-empty body ─────────────────────────
console.log('\n10c. P4 asset liveness');

const asset = (o) => probe.classifyAssetResponse(o).liveness;
ok(asset({ kind: 'ok', contentType: 'image/webp', byteLength: 1024 }) === ASSET.LIVE,
  '200 + image + bytes -> LIVE');
ok(asset({ kind: 'ok', contentType: 'image/webp', byteLength: 0 }) === ASSET.INDETERMINATE,
  '200 + image + ZERO bytes -> INDETERMINATE, never LIVE');
ok(asset({ kind: 'ok', contentType: 'text/html', byteLength: 4096 }) === ASSET.INDETERMINATE,
  '200 + non-image -> INDETERMINATE');
ok(asset({ kind: 'ok', contentType: null, byteLength: 10 }) === ASSET.INDETERMINATE,
  '200 + missing content type -> INDETERMINATE');
ok(asset({ kind: 'absent', status: 404 }) === ASSET.DEAD, '404 -> DEAD');
ok(asset({ kind: 'absent', status: 410 }) === ASSET.DEAD, '410 -> DEAD');
ok(asset({ kind: 'indeterminate', reason: 'http_503' }) === ASSET.INDETERMINATE,
  '5xx -> INDETERMINATE');
ok(asset({ kind: 'indeterminate', reason: 'http_429' }) === ASSET.INDETERMINATE,
  '429 -> INDETERMINATE');
ok(probe.classifyAssetResponse({ kind: 'ok', contentType: 'image/png', byteLength: 0 }).reason
  === 'empty_body', 'the empty-body reason is recorded distinctly');
// The body must actually be consumed, not inferred from a header.
ok(/mode: 'bytes'/.test(codeOnly) && /arrayBuffer\(\)/.test(codeOnly),
  'P4 consumes the response body rather than trusting content-length');

// ── 10d. G-8 / G-9 can never pass after a G-7 failure ────────────────────────
console.log('\n10d. gate semantics on the G-7 failure path');

const okRecord = (over = {}) => ({
  id: 'x-1', tcgdex_state: T.PRESENT_NO_IMAGE, ptcgio_state: F.EXACT_ID_ABSENT,
  alias_state: A.NOT_APPLICABLE, outcome: O.NOT_RECOVERABLE, ...over,
});
const setStatesOk = new Map([['x', { state: 'SET_PRESENT' }]]);
const pairs192 = Array.from({ length: 192 }, (_, i) => ({ canonical_card_id: `c-${i}` }));

const gatesFailPath = probe.computeGates({
  records: [okRecord({ ptcgio_state: '', outcome: '' })],
  expectedRows: 1, setStates: setStatesOk,
  p30: { gate: { passed: false } }, fallbackPhaseRan: false, aliasPairs: pairs192,
});
ok(gatesFailPath['G-7_ptcgio_reliability'] === false, 'G-7 reports the failure');
ok(gatesFailPath['G-8_fallback_assigned'] === 'not_evaluated',
  'G-8 is not_evaluated after a G-7 failure — never true');
ok(gatesFailPath['G-9_completeness'] === 'not_evaluated',
  'G-9 is not_evaluated after a G-7 failure — never true');
ok(gatesFailPath['G-6_all_rows_have_T'] === true,
  'the T dimension remains valid and is still reported');

const gatesNoP30 = probe.computeGates({
  records: [okRecord({ ptcgio_state: '', outcome: '' })],
  expectedRows: 1, setStates: setStatesOk,
  p30: null, fallbackPhaseRan: false, aliasPairs: pairs192,
});
ok(gatesNoP30['G-7_ptcgio_reliability'] === 'not_evaluated',
  'an unrun P3-0 is not_evaluated, not false');
ok(gatesNoP30['G-9_completeness'] !== true, 'G-9 is never true without the fallback phase');

const gatesHappy = probe.computeGates({
  records: [okRecord()], expectedRows: 1, setStates: setStatesOk,
  p30: { gate: { passed: true } }, fallbackPhaseRan: true, aliasPairs: pairs192,
});
ok(gatesHappy['G-8_fallback_assigned'] === true, 'G-8 passes on a complete run');
ok(gatesHappy['G-9_completeness'] === true, 'G-9 passes on a complete run');

// G-9 must fail on a genuinely incomplete run, not merely on a G-7 stop.
const gatesShort = probe.computeGates({
  records: [okRecord()], expectedRows: 2, setStates: setStatesOk,
  p30: { gate: { passed: true } }, fallbackPhaseRan: true, aliasPairs: pairs192,
});
ok(gatesShort['G-9_completeness'] === false, 'G-9 fails when totals do not reconcile');

const gatesBadO = probe.computeGates({
  records: [okRecord({ outcome: 'garbage' })], expectedRows: 1, setStates: setStatesOk,
  p30: { gate: { passed: true } }, fallbackPhaseRan: true, aliasPairs: pairs192,
});
ok(gatesBadO['G-9_completeness'] === false, 'G-9 fails when a row carries no valid O');

// ── 10e. G-3 validates the 192-pair population ───────────────────────────────
console.log('\n10e. G-3 alias population');

ok(probe.EXPECTED_ALIAS_PAIRS === 192, 'the expected alias population is 192');
ok(gatesHappy['G-3_alias_pairs_complete'] === true, 'G-3 passes at exactly 192 pairs');
const gates191 = probe.computeGates({
  records: [okRecord()], expectedRows: 1, setStates: setStatesOk,
  p30: { gate: { passed: true } }, fallbackPhaseRan: true, aliasPairs: pairs192.slice(0, 191),
});
ok(gates191['G-3_alias_pairs_complete'] === false, 'G-3 fails at 191 pairs');
ok(gates191['G-3_alias_pairs_seen'] === 191, 'G-3 reports the observed count');
ok(/alias_pairs_input\.csv/.test(codeOnly) && !/a2_alias_assets_input/.test(codeOnly),
  'the probe ingests the FULL pair export, not an A2-only file');
ok(/p\.alias_state === A\.ALIAS_ONLY/.test(codeOnly),
  'P4 is scoped to A2 by the ingested state');
ok(/aliasPairs\.map\(/.test(codeOnly),
  'the alias census artifact is built from all ingested pairs, not the A2 subset');

// ── 10f. Owned linkage never reaches per-row evidence ────────────────────────
console.log('\n10f. operator-only owned linkage');

ok(/owned_missing_ids_input\.csv/.test(codeOnly), 'the owned id input is read');
const headerKeys = probe.EVIDENCE_HEADER.join(',');
ok(!/own|user|collector|quantity/i.test(headerKeys),
  'the evidence header carries no ownership, user or quantity column');
// Structural: the record builder cannot see the owned set, so no code path can
// stamp ownership onto a committed row.
const builderSig = codeOnly.match(/export function buildEvidenceRecord\(\{[^}]*\}\)/)?.[0] || '';
ok(builderSig.length > 0 && !/owned/i.test(builderSig),
  'buildEvidenceRecord takes no owned-population argument');
const builtRow = probe.buildEvidenceRecord({
  row: { id: 'x-1', set_id: 'x', set_name: 'X', local_id: '1', name: 'Pikachu' },
  t: { t: T.PRESENT_NO_IMAGE, reason: 'card_image_absent' },
  fRec: { f: F.EXACT_ID_ABSENT, reason: 'ptcgio_404', status: 404, checks: null },
  a: A.NOT_APPLICABLE, assetLiveness: ASSET.NOT_APPLICABLE, fallbackPhaseRan: true,
});
ok(Object.keys(builtRow).every(k => probe.EVIDENCE_HEADER.includes(k)),
  'a built record emits only declared evidence columns');
ok(!Object.keys(builtRow).some(k => /own|user/i.test(k)),
  'a built record has no ownership key');
ok(builtRow.outcome === O.NOT_RECOVERABLE, 'a built record carries its derived outcome');
// ownedIds may only be used for aggregates.
const ownedUses = [...codeOnly.matchAll(/ownedIds/g)].length;
ok(ownedUses >= 2 && !/toCsv\([^)]*owned/i.test(codeOnly),
  'the owned id set is never passed to a CSV writer');
ok(/active_owned/.test(codeOnly) && /G-10_active_owned_o0_is_zero/.test(codeOnly),
  'the active-owned O0 = 0 gate input is computed');

// ── 11. CSV round-trip ───────────────────────────────────────────────────────
console.log('\n11. CSV handling');

const csv = probe.toCsv(['id', 'name'], [{ id: 'a-1', name: 'Nidoran♀, the "one"' }]);
const back = probe.parseCsv(csv);
ok(back.length === 1 && back[0].id === 'a-1', 'round-trips a single record');
ok(back[0].name === 'Nidoran♀, the "one"', 'preserves commas, quotes and symbols exactly');
ok(probe.parseCsv('id,name\r\nx,y\r\n').length === 1, 'handles CRLF input');
ok(probe.parseCsv('id,name\n').length === 0, 'header-only input yields zero records');

// ── 12. Specification alignment ──────────────────────────────────────────────
console.log('\n12. specification alignment');

if (existsSync(DOC_PATH)) {
  const doc = readFileSync(DOC_PATH, 'utf8');
  const flat = doc.replace(/\s+/g, ' ');
  for (const v of [...Object.values(T), ...Object.values(F), ...Object.values(O)]) {
    const label = v.replace(/^[TFO]\d+_/, '');
    ok(doc.includes(label), `spec documents the ${v.slice(0, 2)} value ${label}`);
  }
  ok(flat.includes('404/410 is definitive on first response and is never retried'),
    'spec states the retry boundary the probe implements');
  ok(flat.includes('P3 is unreachable if this gate fails'),
    'spec states the G-7 ordering the probe enforces');
} else {
  ok(false, 'specification document exists');
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
