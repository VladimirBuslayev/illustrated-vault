# ATTR-1 — Confirmed Attribution Repairs

**Status: AUTHORED — NOT EXECUTED.**
**Production writes: none. Production execution remains a separate, explicit
approval gate. Catalog sync: still paused.**

| | |
|---|---|
| Slice | ATTR-1 implementation — twelve externally verified artist-attribution repairs |
| Type | Data repair through the already-deployed F-15 `card_extras` channel. **No schema, view, RLS, ACL, trigger, or sync change.** |
| Branch | `implement/attr-1-confirmed-attribution-repairs` (working session branch `claude/issue-27-20260821-1556`, same base commit) |
| Base | `main` @ `c9adc414673c34a085e81d04bd367a4b0c46ffeb` |
| Canonical evidence | `docs/ATTR-0_ARTIST_ATTRIBUTION_INTEGRITY_AUDIT.md` §3 (`xyp-XY67a`) · `docs/ATTR-0_GATE2_PRINT_VERIFICATION.md` (11 rows) · `docs/attr-0-evidence/gate2-print-verification.csv` · `docs/attr-0-evidence/f15-repair-impact.csv` |
| F-15 (prerequisite) | `docs/F-15_DURABLE_ATTRIBUTION_CORRECTION_DESIGN.md` / `docs/F-15_IMPLEMENTATION.md` — **DEPLOYED / VALIDATED** (§19), executed 2026-08-21 |
| Migration | `docs/sql/attr-1-confirmed-attribution-repairs.sql` — **NOT EXECUTED** |
| Validation | `docs/sql/attr-1-confirmed-attribution-repairs-validation.sql` — read-only, safe to run any time |
| Rollback | `docs/sql/attr-1-confirmed-attribution-repairs-rollback.sql` — **NOT EXECUTED** |
| Static harness | `scripts/attr1-attribution-repairs.test.mjs` — **authored; NOT RUN this session (see §8)** |
| Production reads | read-only introspection, plus the migration's own embedded reads (preflight, postflight) |
| Production writes | **none.** Production execution is a separate, explicit gate not exercised by this slice. |
| Runtime changes | **none** — `src/**` and `sync/**` are untouched |
| Catalog sync | **remains paused** — not resumed, not triggered |
| Authored | 2026-08-21 |
| Corrected | 2026-08-21 — independent review HOLD on `217bfe7` addressed; see §12 |

---

## 1. What this document means, and what it does not

**It means:** the ATTR-1 repair migration, its validation, its rollback, and a
static containment harness have been authored, following the same
authoring/review/execution split already established by F-15 and CAT-3B, and
are ready for independent review.

**It does not mean anything was executed.** No `INSERT`, `UPDATE`, or `DELETE`
has been run against production `card_extras` for any of the twelve rows.
Production execution requires its own separate, explicit approval — exactly as
F-15's did — and is not requested or exercised here.

**It does not mean the static harness was run.** `node` and `npm` both require
interactive tool approval that was not available in this authoring session
(see §8 for exactly what was and was not verified, and how).

---

## 2. The migration SHA-256 — and why it is verifiable

```
d15127c36b99369e294bb177efab2df195146777c8d613d6a9b00ee01295542f  docs/sql/attr-1-confirmed-attribution-repairs.sql
2f6e75d1c50b65eeedd97e521d3ddb211e1485b1e6739408f715a2ecd13b9968  docs/sql/attr-1-confirmed-attribution-repairs-validation.sql
df6b8e8ecc48460db5f73c31aa9b312a697620802800ea1eeb874d77ea359761  docs/sql/attr-1-confirmed-attribution-repairs-rollback.sql
```

**Updated 2026-08-21** in the correction round addressing the P-4 TOCTOU
overwrite gap, the P-1 trigger-enabled/pinned-semantics guard, and the
rollback postflight fix (see §12). The validation file's checksum is
unchanged — that file was not touched by this round.

A checksum whose only purpose is to be re-derived by a reviewer before
authorising a production run is worthless if it depends on the platform doing
the checking. `docs/sql/attr-1-confirmed-attribution-repairs*.sql` is
therefore pinned to `eol=lf` in `.gitattributes` — the same reasoning already
recorded there for F-15 and the ATTR-0/CAT-2D.2 evidence artifacts — so
working-tree bytes equal committed bytes everywhere and `sha256sum` gives the
values above on any machine.

**Verify before executing.** If a hash does not match, the file in front of
you is not the file that was reviewed.

---

## 3. The exact 12-row repair population

Transcribed from `docs/attr-0-evidence/f15-repair-impact.csv` (canonical
pre-repair state) and `docs/attr-0-evidence/gate2-print-verification.csv` /
`docs/ATTR-0_ARTIST_ATTRIBUTION_INTEGRITY_AUDIT.md` §3 (verified illustrator +
sources). No row here was rediscovered or broadened beyond that committed
evidence.

| # | card_id | current (wrong) illustrator | verified illustrator | evidence gate | membership consequence |
|---|---|---|---|---|---|
| 1 | `g1-28a` | Naoki Saito | **Ryo Ueda** | ATTR-0 Gate 2 | none — effective `artist_id` already NULL |
| 2 | `g1-73a` | Yusuke Ohmura | **Naoki Saito** | ATTR-0 Gate 2 | none |
| 3 | `xy10-111a` | Ken Sugimori | **Naoki Saito** | ATTR-0 Gate 2 | none |
| 4 | `xy10-43a` | PLANETA | **Ryo Ueda** | ATTR-0 Gate 2 | none |
| 5 | `xy4-65a` | Ayaka Yoshida | **Ryo Ueda** | ATTR-0 Gate 2 | none |
| 6 | `xy6-77a` | Ayaka Yoshida | **TOKIYA** | ATTR-0 Gate 2 | none |
| 7 | `xy7-75a` | Yusuke Ohmura | **You Iribi** | ATTR-0 Gate 2 | none |
| 8 | `xy9-107a` | Yusuke Ohmura | **Naoki Saito** | ATTR-0 Gate 2 | none |
| 9 | `xy9-98b` | Yusuke Ohmura | **Sanosuke Sakuma** | ATTR-0 Gate 2 | none |
| 10 | `xyp-XY150a` | Eske Yoshinob | **Hasuno** | ATTR-0 Gate 2 | none |
| 11 | `xyp-XY177a` | You Iribi | **Hitoshi Ariga** | ATTR-0 Gate 2 | none |
| 12 | `xyp-XY67a` | sui | **Naoki Saito** | ATTR-0 §3 | **leaves curated artist `sui`: 224 → 223** |

**`artist_id_override` is NULL on all twelve.** Every one of the seven distinct
verified illustrator names (Ryo Ueda, Naoki Saito, TOKIYA, You Iribi, Sanosuke
Sakuma, Hasuno, Hitoshi Ariga) resolves to **zero** rows in `public.artists`
through the aliases-only resolver (design §7.1, re-confirmed by this
migration's own P-5 preflight at execution time). This is the entire repair
population — there is no row where the CASE takes a non-NULL artist branch.

**Only `xyp-XY67a` moves a membership.** Eleven targets already have effective
`artist_id = NULL` and stay NULL — the correction moves only the displayed
illustrator. `xyp-XY67a` is the sole exception: its raw and (pre-repair)
effective `artist_id` is `'sui'`, and the repair removes it from `sui`,
dropping that curated artist's effective membership from 224 to 223. This is
the correct outcome — ATTR-0 confirmed the card is not by sui — and it is the
only FK membership change in the entire migration.

---

## 4. Evidence, per row

Every row's `attribution_override_evidence` cites the confirming gate, the
verified illustrator, a primary source, and (where one exists) a secondary
source:

- **Eleven rows** (`g1-28a` through `xyp-XY177a`, excluding `xyp-XY67a`) cite
  `docs/attr-0-evidence/gate2-print-verification.csv`
  (SHA-256 `b5e6e2dec95f75a2dcd069bec94e2ca8beaf38de6d74aba7659b684489c6c0f3`,
  matching `docs/attr-0-evidence/gate2-manifest.json`), each with a Bulbapedia
  per-print `Release information` source (primary) and a PkmnCards per-print
  scan page (secondary) — the same two-source standard Gate 2 required for
  every one of its twenty verified rows.
- **`xyp-XY67a`** cites `docs/ATTR-0_ARTIST_ATTRIBUTION_INTEGRITY_AUDIT.md` §3
  — Bulbapedia's "Jirachi (XY Promo 67)" print history, the source that
  distinguishes the regular `XY67` print (sui) from the `XY67a` Full Art /
  Yellow A Alternate print (Naoki Saito). This is a prose citation, not a
  checksummed CSV row, so its `evidence_artifact_sha256` is honestly `NULL` —
  inventing a hash for a document that was never hash-pinned would be worse
  than recording that no such pin exists.

**No new evidence was gathered and no evidence file was rediscovered or
broadened.** The migration's canonical `attr1_targets` temp table (§0 of the
migration) is transcribed directly from these two already-committed sources;
it is the single place both the preflight currency check and the mutation
itself read from, so the two cannot silently disagree.

---

## 5. Provenance convention — `approved_by`

Following F-15's precedent for system-authored rows (`system:f15-migration`),
every ATTR-1 row is stamped `attribution_override_approved_by =
'system:attr-1-migration'` — non-empty (satisfies F-15's C2), and
self-evidently not a human reviewer's name. This migration was authored by an
agent from committed, already-externally-verified evidence (ATTR-0 / Gate 2);
no human clicked "approve" on an individual row at execution time, and the
provenance says so honestly rather than implying otherwise.

Unlike F-15's five legacy rows — which carry `"verified": false` because they
were *derived* from the pre-existing raw `artist_id` to preserve behaviour —
every ATTR-1 row carries **`"verified": true`**, because each one rests on an
external, exact-print source (Bulbapedia release information / PkmnCards scan
pages), not on a derivation from existing data. A future maintainer
distinguishes the three provenance shapes now possible in `card_extras` by
reading `attribution_override_evidence.derivation`:

| `derivation` | Meaning |
|---|---|
| `f15-legacy-backfill` | F-15's five pre-existing overrides, behaviour-preserving, not externally verified |
| `attr-1-confirmed-repair` | This slice's twelve rows, externally verified against committed ATTR-0 / Gate 2 evidence |
| (absent) | Not possible — F-15's C1 constraint makes provenance-absent-with-override unrepresentable |

---

## 6. Migration shape

Follows the same one-transaction, fail-closed-preflight, in-transaction-
validation shape F-15 established, scoped narrowly to data repair only.

### 6.1 Preflight (§0), all re-measured live at execution time

| Gate | Checks | STOPs if |
|---|---|---|
| P-1 | The F-15 channel exists: all 4 columns, all 4 constraints (`card_extras_artist_id_override_fk`, `..._all_or_nothing`, `..._approved_by_nonempty`, `..._requires_illustrator`), the `card_extras_admit_attribution_override` trigger — **enabled**, firing `BEFORE INSERT OR UPDATE FOR EACH ROW`, bound to `public.card_extras_admit_attribution_override()` via `tgfoid` (not by name alone), that function still `SECURITY INVOKER` plpgsql with its load-bearing resolver semantics intact (aliases-only lookup, fail-closed-on-ambiguity, zero-match-requires-NULL) — `cards_effective` reads `artist_id_override` via a CASE, and the CAT-3B/F-15 column ACL still has no table-level grant for anon/authenticated | F-15 has drifted from its deployed shape, including a disabled trigger or same-name-drifted admission logic |
| P-2 | Exactly the 12 target IDs are live in `cards_effective` | any target is missing, or the count is not exactly 12 |
| P-3 | Each target's current effective `(illustrator, artist_id)` matches the canonical pre-repair reading in `f15-repair-impact.csv` | anything has changed since the evidence was captured |
| P-4 | No target already carries any attribution bundle field at this statement's snapshot. The `ON CONFLICT DO UPDATE SET` in §1 additionally re-checks this at write time (`WHERE` all five fields still `NULL`), closing the TOCTOU gap between P-4's snapshot and the upsert | a prior correction (verified or not) would be silently overwritten |
| P-5 | Each of the 7 distinct verified illustrator names still resolves to zero `public.artists` rows via the aliases-only resolver | any name now resolves to ≥1 artist — the approved `artist_id_override = NULL` plan may no longer be correct |

Before mutation, five temporary snapshots (`ON COMMIT DROP`) capture: the
twelve targets' pre-migration effective `(illustrator, artist_id)`; their raw
`public.cards` `(illustrator, artist_id)`; any pre-existing `card_extras` row
for the twelve targets (typically zero, but re-checked rather than assumed);
every *other* `card_extras` row in the table; and the pre-migration effective
`sui` FK membership count.

### 6.2 Mutation (§1)

One `INSERT ... SELECT ... FROM attr1_targets ON CONFLICT (card_id) DO UPDATE
SET` naming only the five attribution columns
(`illustrator_override`, `artist_id_override`,
`attribution_override_evidence`, `attribution_override_approved_by`,
`attribution_override_approved_at`). This is deliberately safe to re-run
against a world where an *unrelated* `card_extras` enrichment (a
`source_note`, a CAT-3B image override) has appeared on one of these twelve
rows since authoring: the `DO UPDATE SET` clause never touches those columns,
so they survive untouched (§9 V-8 proves this both for a row that already
existed and for a row this migration creates fresh).

`artist_id_override` is a literal `null` in the `SELECT`, not a value read
from the canonical table — there is no code path by which a non-NULL value
could reach it. The F-15 admission trigger re-validates the resolver result
independently at write time, using the exact same aliases-only contract P-5
just re-checked; it is the second, independent wall, not merely a formality.

### 6.3 Postconditions (§9), all abort the transaction on failure

| Check | Proves |
|---|---|
| V-1 | Exactly 12 complete attribution bundles exist, exactly for the target set, each carrying the exact ATTR-1 provenance fingerprint (`derivation = 'attr-1-confirmed-repair'`, `approved_by = 'system:attr-1-migration'`) — no non-target row gained a new bundle, and a short count (e.g. because the P-4 upsert guard skipped a racing target) aborts the whole transaction |
| V-2 | Each target's effective illustrator equals the verified name |
| V-3 | Effective `artist_id` is NULL on all 12 |
| V-4 | The eleven non-`xyp-XY67a` targets had no FK membership change |
| V-5 | `xyp-XY67a` is no longer filed under `sui` |
| V-6 | Effective `sui` membership changed by **exactly -1** from the captured pre-state |
| V-7 | Raw `public.cards` is byte/value unchanged for all 12 targets |
| V-8 | Every unrelated `card_extras` field on the 12 targets is unchanged (both for rows that pre-existed and rows newly created) |
| V-9 | No `card_extras` row *outside* the 12 targets changed at all — a full symmetric `EXCEPT ALL` diff against the pre-migration snapshot |
| V-10 | F-15's C1/C2/C3 constraints and ambiguity invariant remain clean table-wide |

---

## 7. Containment

- One transaction (`BEGIN` … `COMMIT`).
- Data repair only. No schema, view, RLS, ACL, trigger, or sync-logic change.
  The F-15 admission trigger is left to enforce itself, unmodified and
  unbypassed.
- Writes only the five attribution fields on exactly the 12 target rows of
  `public.card_extras`.
- Never writes `public.cards`, `public.artists`, aliases, identity/ownership
  tables, or any image-override field.
- No `xya`/`ecard2` identifier appears anywhere as a mutation target — F-16
  (duplicate printing identity) remains a separate, unstarted slice, and no
  confirmed-correct Gate-2 row or ATTR-0b row enters this population.
- `sync/sync-cards.mjs` is untouched, still writes only `public.cards`, and
  still never references `card_extras` — the correction survives sync for the
  same structural reason F-15's does.

---

## 8. Static validation performed (and what was not)

`node scripts/attr1-attribution-repairs.test.mjs` was authored to prove, by
static analysis rather than a live database, the containment/logical
properties above:

1. Exactly the 12 approved IDs, exact corrected names, no leakage from the 9
   Gate-2 `CONFIRMED_CORRECT` rows or the 14-row ATTR-0b population.
2. `artist_id_override` is a literal NULL for all 12.
3. The only DML target in the migration and the rollback is
   `public.card_extras`; no schema DDL.
4. The `ON CONFLICT DO UPDATE SET` clause names exactly the five attribution
   columns.
5. Every target carries a committed evidence reference (gate, primary source,
   evidence artifact, and the exact committed CSV SHA-256 where one exists).
6. All five preflight drift guards (P-1…P-5) exist and each contains a `raise
   exception` path.
7. Raw-attribution and unrelated-field preservation postconditions exist
   (V-7, V-8, V-9), plus the membership postconditions (V-4, V-5, V-6).
8. The rollback is scoped to the exact 12 IDs, checks a provenance fingerprint
   (`derivation` + `approved_by` + expected illustrator name) before touching
   any row, never writes `public.cards`, and its postflight proves — not just
   asserts — the reversal: all five attribution fields cleared on every
   target, plus `xyp-XY67a`'s effective membership confirmed restored to
   `sui` (or an explicit `STOP` if that is not safely assertable).
9. Structural sanity: balanced `BEGIN`/`COMMIT`, balanced `$$` dollar-quoting,
   nothing executable after the final `COMMIT`.

**This harness was NOT executed in this authoring session.** `node` and `npm`
both require interactive tool approval that was not available (confirmed
directly, and independently re-confirmed by a second subagent spawned
specifically to attempt it). In place of execution:

- Every regex in the harness was traced by hand against the actual committed
  SQL text by two independent readings (mine, and a fresh subagent's). This
  process found and fixed two real bugs before commit: an off-by-one array
  index in a `.split(',')`-based check (the migration's `SELECT` list, split
  naively, put the literal `null` for `artist_id_override` at index 2, not
  the index 1 the check originally assumed), and a phrase-search regex that
  would have failed to match a `raise exception` message PostgreSQL treats as
  one continuous string but that spans a source-line wrap in the file (fixed
  by adding a `joinLiterals()` normalizer that collapses the
  quote/newline/quote boundary PostgreSQL's own string-literal-continuation
  rule already merges). A third bug — a lazily-bounded regex that could merge
  two adjacent `do $$...end $$;` blocks into one match, masking a missing
  guard specifically in the first real preflight block — was found by the
  independent subagent review and fixed by splitting into individual DO
  blocks before filtering, rather than searching for the preflight marker
  inside one greedy-bounded window.
- `sha256sum` was run directly (available in this environment) and confirms
  the migration/validation/rollback hashes in §2, and independently confirms
  the cited `gate2-print-verification.csv` hash matches the committed
  manifest.
- `git diff --check` was run and is clean. `git status --short` shows only
  the four new files this slice adds.

**Please run `node scripts/attr1-attribution-repairs.test.mjs` and `npm run
build` before treating this migration as verified**, or grant `node`/`npm` in
`--allowedTools` so a future session can do so directly. This mirrors exactly
the caveat recorded in `docs/F-15_IMPLEMENTATION.md` §16–§18 for the
equivalent review rounds on that slice.

---

## 9. Files

**Added**

| File | Purpose |
|---|---|
| `docs/ATTR-1_CONFIRMED_ATTRIBUTION_REPAIRS.md` | this document |
| `docs/sql/attr-1-confirmed-attribution-repairs.sql` | the migration — **NOT EXECUTED** |
| `docs/sql/attr-1-confirmed-attribution-repairs-validation.sql` | read-only postconditions, safe to run any time |
| `docs/sql/attr-1-confirmed-attribution-repairs-rollback.sql` | target/provenance-scoped rollback — **NOT EXECUTED** |
| `scripts/attr1-attribution-repairs.test.mjs` | static containment harness — authored, not run this session (§8) |

**Changed**

| File | Change |
|---|---|
| `.gitattributes` | pin `docs/sql/attr-1-confirmed-attribution-repairs*.sql` to `eol=lf` so the stated SHA-256 checksums are verifiable on any platform |

**Explicitly unchanged:** `src/**` (zero files) · `sync/**` (zero files) ·
`public.cards` · `public.artists` · artist aliases · the F-15 admission
trigger, its function, and `cards_effective` · CAT-3B's image override channel
· every RLS policy · the merged F-15 design/implementation artifacts ·
`docs/CURRENT_STATE.md`, `docs/ARCHITECTURE.md`, `docs/DECISION_LOG.md`,
`docs/ROADMAP.md` — these remain execution-closeout documents, deliberately
not updated by an authoring-only slice (AGENTS.md "Documentation closeout").

---

## 10. Non-goals

- **No production write of any kind.** Production execution is a separate,
  explicit gate, not exercised here.
- **The twelve rows are not repaired yet** — this document authors the
  migration that would repair them; nothing has been applied.
- No `xya`/`ecard2` dedup or alias work. F-16 remains a separate, unstarted
  slice.
- No schema, view, RLS, ACL, or trigger change. F-15's admission trigger is
  neither modified nor bypassed.
- No change to `public.cards`, `public.artists`, or artist aliases.
- `sync/sync-cards.mjs` unchanged; **catalog sync remains paused** — not
  resumed, not triggered.
- No frontend or runtime change.
- Canonical closeout documents (`CURRENT_STATE.md`, `DECISION_LOG.md`,
  `ARCHITECTURE.md`, `ROADMAP.md`) are not updated — that is a deliberate
  post-execution closeout step, not an authoring step.

---

## 11. Recommended next

1. Independent review of this authoring package — the migration, validation,
   rollback, and harness.
2. **Run the static harness and the build** (`node
   scripts/attr1-attribution-repairs.test.mjs`, `npm run build`) — not done
   in this authoring session (§8) — and confirm the SHA-256 checksums in §2
   before any execution approval is considered.
3. Production execution as a separate, explicit gate. Expected visible effect
   (per §9's postconditions): twelve corrected illustrators and exactly one
   membership change (`sui` 224 → 223).
4. After successful execution and its own separate review, update
   `docs/CURRENT_STATE.md` / `docs/DECISION_LOG.md` / `docs/ROADMAP.md` as a
   deliberate closeout step — not before.

---

## 12. Independent review correction round (2026-08-21)

Independent review on head `217bfe7` returned HOLD, identifying three
fail-closed gaps in the authored package. This round closes all three,
narrowly, without broadening scope:

1. **P-4 TOCTOU overwrite gap.** P-4 proved no target carried an attribution
   bundle at that statement's snapshot, but the `INSERT ... ON CONFLICT DO
   UPDATE SET` that followed was unconditional — a target that acquired a
   correction after P-4 but before the upsert (a manual or service-role
   writer racing this migration) would have been silently overwritten.
   Fixed by adding a `WHERE` guard to the `DO UPDATE SET` requiring all five
   attribution fields to still be `NULL` on the conflicting row (§1), and by
   tightening §9 V-1 to require the exact ATTR-1 provenance fingerprint
   (`derivation = 'attr-1-confirmed-repair'`, `approved_by =
   'system:attr-1-migration'`) on all 12 bundles — so a target the guard
   skipped drops the count below 12 and aborts the whole transaction instead
   of committing a partial repair.
2. **P-1 checked the F-15 admission trigger by name only.** A disabled
   trigger, or a same-named trigger rebound to a different function, would
   have passed the original P-1 silently. P-1 now additionally asserts:
   the trigger is enabled (`tgenabled <> 'D'`); its firing shape is exactly
   `BEFORE INSERT OR UPDATE FOR EACH ROW` (`tgtype` bitmask); it is bound to
   `public.card_extras_admit_attribution_override()` via `tgfoid`/`pg_proc`,
   not by name coincidence; that function is still `SECURITY INVOKER`
   plpgsql; and the function body (`pg_proc.prosrc`) still contains the
   load-bearing resolver semantics — the aliases-only lookup, the
   fail-closed-on-ambiguity rule, and the zero-match-requires-NULL rule —
   so same-name drift of the underlying logic fails closed rather than
   passing silently.
3. **Rollback postflight was incomplete.** It computed `v_still_sui` but
   never checked it, and reported success after checking only
   `illustrator_override IS NULL`. The postflight now checks all five
   ATTR-1 attribution fields are cleared, and mechanically proves the
   effective reversal: it confirms `xyp-XY67a`'s effective `artist_id` reads
   `sui` again before allowing `COMMIT`, and — if F-15's own channel is not
   live enough to safely make that assertion (e.g. F-15 was also rolled
   back in the same window) — it `STOP`s explicitly rather than silently
   reporting success on an unproven claim.

The static harness (`scripts/attr1-attribution-repairs.test.mjs`) was
updated to assert all three fixes structurally: the P-4 `WHERE` guard and
the V-1 provenance fingerprint requirement, the P-1 enabled/firing-shape/
binding/security/semantics checks, and the rollback's all-five-fields
postflight plus its explicit STOP path. The three SQL checksums in §2 were
regenerated; the validation file was not touched by this round and its
checksum is unchanged.

**Still not executed.** `node scripts/attr1-attribution-repairs.test.mjs`
could not be run in this session either — `node`/`npm` again required
interactive tool approval unavailable here. Every new/changed regex was
traced by hand against the actual committed SQL and rollback text, and the
`tgtype` bitmask was independently re-derived (`ROW=1, BEFORE=2, INSERT=4,
DELETE=8, UPDATE=16` per `pg_trigger.tgtype`/`trigger.h`) — an earlier draft
of this fix used `8` for `UPDATE`, which is `DELETE`'s bit, and was caught
and corrected before commit. **Please run the static harness on this head
before treating the implementation gate as approved**, exactly as requested.
