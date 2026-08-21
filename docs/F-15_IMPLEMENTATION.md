# F-15 — Durable Attribution Correction: Implementation

**Status: AUTHORED, REVIEWED-READY — NOT EXECUTED.**
**Production mutations: none. ATTR-1 repairs: none. Catalog sync: still paused.**

| | |
|---|---|
| Slice | F-15 implementation — the durable attribution correction channel |
| Type | Schema prerequisite. **Creates a channel. Repairs nothing.** |
| Branch | `implement/f15-durable-attribution-correction` |
| Base | `main` @ `9f233de3405e1aba26358bc54a0b4156b9b09df8` |
| Design (authoritative) | `docs/F-15_DURABLE_ATTRIBUTION_CORRECTION_DESIGN.md` (PR #25, merged) |
| Migration | `docs/sql/f15-durable-attribution-correction.sql` — **NOT EXECUTED** |
| Migration SHA-256 | `2cac6639c41d38fd99ad2e7e2b977771458c98b2f583dbd0e1791ec26d57d186` |
| Validation | `docs/sql/f15-durable-attribution-correction-validation.sql` — **NOT EXECUTED** |
| Rollback | `docs/sql/f15-durable-attribution-correction-rollback.sql` — **NOT EXECUTED** |
| Static harness | `scripts/f15-attribution-correction.test.mjs` — **146 assertions, all pass** |
| Production reads | read-only introspection only (Supabase MCP is read-only) |
| Production writes | **none** |
| Production execution | **a separate, explicitly-approved gate. Not granted here.** |
| Runtime changes | **none** — `src/**` and `sync/**` are untouched |
| Authored | 2026-08-21 |

---

## 1. What this PR means, and what it does not

**It means:** the F-15 implementation is authored, statically validated, and
ready for an independent review that ends in a separate decision about whether
to run it.

**It does not mean F-15 is deployed.** Nothing has been executed. `card_extras`
has ten columns in production today, exactly as it did before this branch.

**It does not mean ATTR-1 is repaired.** The twelve confirmed attribution
defects are untouched, and the migration asserts that twice — once in its
preflight (P-6) and once before it commits (V-13).

---

## 2. The migration SHA-256 — and why it is verifiable

```
2cac6639c41d38fd99ad2e7e2b977771458c98b2f583dbd0e1791ec26d57d186  docs/sql/f15-durable-attribution-correction.sql
04373eaa3e5e11312ac0652071369c5df3157b0c417e3c5a9d04253dd496cd5a  docs/sql/f15-durable-attribution-correction-validation.sql
14f397f6063007ac41a880314d3c2f84c0b68f1eca32cb43987bdca33bce26ee  docs/sql/f15-durable-attribution-correction-rollback.sql
```

A checksum whose only purpose is to be re-derived by a reviewer before
authorising a production run is worthless if it depends on the platform doing
the checking. `docs/sql/f15-durable-attribution-correction*.sql` is therefore
pinned to `eol=lf` in `.gitattributes` — the same reasoning already recorded
there for the CAT-2D.2 and ATTR-0 evidence artifacts — so working-tree bytes
equal committed bytes everywhere and `sha256sum` gives the value above on any
machine.

**Verify before executing.** If the hash does not match, the file in front of
you is not the file that was reviewed.

---

## 3. Execution boundary

**This slice carries no production mutation authorization.** The Supabase access
used while authoring was read-only, and every figure quoted below came from a
`SELECT`.

What was read, on 2026-08-21 against `main` @ `9f233de`:

| Check | Reading |
|---|---|
| F-15 columns already present | **0 of 4** — nothing deployed |
| ATTR-1 targets with a `card_extras` row | **0 of 12** — untouched |
| `card_extras` rows | 195 (5 with an `illustrator_override`) |
| `cards_effective` / `cards` rows | 23,588 / 23,780 |
| Existing triggers on `card_extras` | 2 (CAT-3B admission, `updated_at`) |
| **B-2 gate, aliases-only resolver** | **`override_rows = 5`, `would_change_membership = 0`, `ambiguous_rows = 0`** |
| — of which resolve to NULL / to an artist | **2 / 3** |
| `cards.artist_id`, `artists.id`, `card_extras.illustrator_override` types | all `text` — the view rebuild is type-compatible |

**Execution is a separate gate.** When it is granted, run the whole file as one
script (see §8), then run the validation file, then record the result.

---

## 4. What the migration does, in order

Ordering is load-bearing in two independent ways, and the file enforces both.

| § | Step | Why it is where it is |
|---|---|---|
| **0** | Preflight (P-1…P-6) + two `TEMPORARY … ON COMMIT DROP` snapshots | Fails closed on any drift from the shape the design was measured against. Refuses to run against an already-migrated database. |
| **1** | Four columns + the C4 FK to `artists(id)` ON DELETE RESTRICT | **No provenance CHECKs yet** — see below. |
| **2** | The embedded, aliases-only **B-2 gate** | Re-measures production *at execution time* and aborts if the world moved. |
| **3** | Backfill the 5 legacy rows: `artist_id_override` + full provenance | Must precede §5 **and** §7. |
| **4** | Verify the backfill row-for-row | Before anything depends on it. |
| **5** | C1, C2, C3 | Validate on the **first** attempt, no `NOT VALID` window. |
| **6** | Admission trigger | After the backfill, so the backfill is not itself subject to admission. |
| **7** | `cards_effective` — one expression changed | After the backfill. |
| **8** | Extend the column ACL by exactly one column | |
| **9** | V-1 … V-14, every one raising on failure | `COMMIT` only if all pass. |

**Why §3 must precede §5.** C1 is unconditional: provenance must be present
whenever `illustrator_override` is present. The five legacy rows carry
`illustrator_override` with no provenance *right now*, and `ADD CONSTRAINT`
validates existing rows immediately. Adding C1 in §1 would fail the migration
on its own first step, before the backfill that is supposed to satisfy it ever
ran. The fix is ordering, **not** a `NOT VALID` deferral — and the harness
asserts the string `NOT VALID` appears nowhere in the file.

**Why §3 must precede §7.** Three of the five legacy rows hold a live
`artist_id` (`shinji-kanda`, `asako-ito`, `akira-egawa`). §7's CASE takes the
override branch for every row with an `illustrator_override`. Without the
backfill that branch reads NULL and those three memberships silently vanish —
an I-7 regression delivered by a migration that looks purely additive.

---

## 5. The one semantic change

```sql
c.artist_id                                    -- before

case                                           -- after
  when ce.illustrator_override is not null then ce.artist_id_override
  else c.artist_id
end as artist_id
```

Everything else in `cards_effective` is preserved byte-for-byte: 14 columns in
order with `artist_id` last, `security_invoker = true`, the `card_extras` LEFT
JOIN, the CAT-2D.1 alias exclusion, and both existing COALESCE overrides. The
harness diffs each of those mechanically (§5 of the harness), so a future edit
that reverts CAT-2D.1 or CAT-3B fails the test rather than shipping.

**CASE, not COALESCE — and that is the point of the slice.**
`coalesce(ce.artist_id_override, c.artist_id)` cannot express "deliberately no
artist": a NULL override falls through to the raw value. On the twelve ATTR-1
rows the correct target is NULL on **12 of 12**, so COALESCE would retain the
known-wrong artist on every one — for `xyp-XY67a` it would leave the card filed
under `sui`, which is precisely the defect F-15 exists to remove.

**The discriminator is `illustrator_override`, not `artist_id_override`.** The
presence of an illustrator correction is what makes the raw FK untrustworthy:
raw `artist_id` was derived from a string we have now overruled. Keying on
`artist_id_override` would make NULL unrepresentable again.

---

## 6. The resolver is aliases-only

This was a PR #25 review correction and it is enforced in three places
(migration, validation, design audit) and asserted by the harness.

`sync/sync-cards.mjs :: loadArtistAliasMap()` builds its lookup map
**exclusively** from `artists.aliases`; `resolveArtistId()` consults only that
map and never reads `artists.id`. Admission must not use a broader matching
contract than sync uses, or the two can disagree about what a name means. So
the resolver is, everywhere:

```sql
lower(btrim(alias)) = lower(btrim(illustrator_override))   -- alias ∈ artists.aliases
```

Never `artists.id`. Never fuzzy. Never substring. The harness fails if
`lower(a.id)` reappears as a match predicate in any of the three files.

**Ambiguity is counted in ARTIST ROWS, not alias tokens.** Production currently
holds 11 duplicate aliases *within* single artist rows (harmless case variants);
counting tokens would report those as ambiguity and fail the gate for no reason.
What matters is whether two *different* artists claim one normalised name —
measured today at **0**, but prevented by no constraint, which is exactly why
R4 fails closed. **No `LIMIT 1` appears anywhere in the migration**; the backfill
uses an unbounded scalar subquery, so an unexpected ambiguity raises rather than
silently picking.

---

## 7. Legacy provenance — honest, not flattering

All five legacy rows receive a complete provenance bundle, including the two
whose `artist_id_override` resolves to NULL. There is **no C1 exemption**: a
declarative CHECK cannot see *how* a value arrived, so it must not depend on
that.

```json
{
  "derivation": "f15-legacy-backfill",
  "basis": "artist_id_override computed from the pre-existing illustrator_override via the aliases-only resolver (design §12) to preserve pre-F-15 effective behaviour. This row was NOT externally artist-verified.",
  "verified": false,
  "design_pr": 25,
  "design_merge_commit": "9f233de3405e1aba26358bc54a0b4156b9b09df8"
}
```

`approved_by = 'system:f15-migration'` — non-empty (C2), and self-evidently not
a human reviewer. `approved_at = now()`, the transaction timestamp: real,
consistent across the five rows, **not backdated**.

A future maintainer tells a legacy derivation from an externally-verified
ATTR-1 correction by reading `.derivation` and `.verified` — not by the
*absence* of provenance, because absence is no longer a state any row can be in.

---

## 8. How to execute, when approved

1. Re-read `docs/sql/f15-attribution-correction-design-audit.sql` A-1…A-5 and
   confirm production still matches design §5.
2. Verify the migration's SHA-256 against §2.
3. **Execute the whole file as one script.** Running it statement-by-statement
   in a console that autocommits each one discards exactly the atomicity every
   ordering guarantee depends on.
4. Read the `NOTICE` output. Expect, in order: `§0 preflight: PASS`,
   `§0 snapshot: N effective rows, M raw rows`,
   `§2 B-2 gate: PASS (override_rows=5, would_change_membership=0, ambiguous_rows=0)`,
   `§4 backfill verified`, `§9 validation: ALL PASS`.
5. Run `docs/sql/f15-durable-attribution-correction-validation.sql` Part A and
   record the output. Part B is **not** run (§10).
6. Only then consider ATTR-1 — a separate slice, separately approved.

**If any gate raises, nothing applied.** §0–§9 are one transaction, both
snapshots drop automatically, and the database is left in the complete pre-F-15
state. Fix the cause and re-run the whole file.

---

## 9. Expected result: zero visible change

**V-1 is the headline invariant.** §0 snapshots `(id, illustrator, artist_id)`
for the entire effective catalog; §9 compares it against live state after the
view switch using a **symmetric `EXCEPT ALL` difference in both directions**, so
an addition and a deletion cannot cancel out. Any non-zero difference raises and
rolls back.

The pre-migration row count is deliberately **not** asserted against a hardcoded
23,588. The catalog can legitimately move between authoring and execution; what
must not move is the effective attribution contract, and that is proved by
comparing the actual snapshot to actual post-migration state.

**V-14** does the same for raw `public.cards`, proving I-1 mechanically rather
than by assertion in prose.

Expected post-execution readings (validation Part A):

| | Expected |
|---|---|
| Effective diff vs. snapshot | **0 rows** |
| Raw `cards` diff vs. snapshot | **0 rows** |
| Legacy rows backfilled | **5**, all resolver-consistent, all fully provenanced |
| `shinji-kanda` / `asako-ito` / `akira-egawa` / `sui` FK counts | **28 / 38 / 106 / 224** — unchanged |
| ATTR-1 rows with a correction | **0** |
| `sui` after F-15 | **still 224.** It becomes 223 only when ATTR-1 runs. |
| Public column SELECT on `card_extras` (anon *and* authenticated) | exactly `artist_id_override, card_id, illustrator_override, image_url_override` |
| Table-level grants for anon/authenticated | **0** |
| Triggers on `card_extras` | **3** (F-15 admission, CAT-3B admission, `updated_at`) |

---

## 10. Deferred validation, stated plainly

Two items from design §20 are **not** covered by this slice, and neither is
quietly dropped.

**V-4 negative admission tests — authored, not executed.** Every case requires a
*write* to prove a rejection, and this slice carries no mutation authorization.
Manufacturing throwaway rows in production to test a constraint is exactly the
kind of "it's only temporary" write that leaves residue when a session drops
mid-transaction. The cases are written out in the validation file's Part B,
wrapped in an explicit `ROLLBACK` and commented out, with the preferred
execution environments ranked. Twelve cases are covered, including two positive
controls (a valid intentional-NULL correction must be *admitted*, and an
unrelated `source_note` edit must *not* re-admit) — a fail-closed rule set that
rejects everything is not correct either.

**V-8 sync durability — deferred, no environment.** "Write a correction, run a
sync over its set, re-read" is non-production only. Catalog sync is paused and
must not be resumed to test F-15, and no non-production database exists;
creating a paid Supabase branch is out of scope without explicit approval.

**What stands in the meantime** is structural, and it is enforced mechanically
rather than asserted in prose — `scripts/f15-attribution-correction.test.mjs`
proves that `mapCardToRow()`'s payload (the exact `ON CONFLICT DO UPDATE SET`
column list) contains none of the F-15 columns, that the string `card_extras`
appears nowhere in `sync-cards.mjs`, and that the view gives the override
precedence. A future edit that breaks the durability claim fails the harness.

**This is structural proof, not behavioural proof, and it is not presented as
more than that.**

---

## 11. Static validation performed

`node scripts/f15-attribution-correction.test.mjs` — **146 assertions, 0
failures.** No test framework introduced; matches the OL-0A/0C/0D, CAT-2D and
CAT-3B harnesses.

| Group | Proves |
|---|---|
| **1. Containment** | Exactly one `UPDATE`, targeting `card_extras`; no `INSERT`/`DELETE`/`TRUNCATE`; nothing writes `cards`, `artists`, aliases or tracked artists; **no ATTR-1 id appears in the backfill statement**, and all 12 appear as guards |
| **2. Ordering** | Backfill precedes C1, C3, the trigger and the view switch; view precedes ACL; **no `NOT VALID` anywhere** |
| **3. Resolver** | Aliases-only in migration, validation *and* audit; `lower(a.id)` never a match predicate; `lower(btrim(...))` both sides; sync still builds its map from aliases only; **no `LIMIT 1` anywhere**; ambiguity never counted over unnested tokens |
| **4. C1–C4** | C1 references each of the four fields exactly twice, with 4 × `IS NULL` and 4 × `IS NOT NULL` across a two-state disjunction; C2/C3 present; C4 is `ON DELETE RESTRICT`; every constraint guard scoped by `conname` **and** `conrelid` |
| **5. View** | All 13 unrelated projections preserved; `security_invoker`; the `card_extras` join; the CAT-2D.1 alias exclusion; `artist_id` is the CASE, **not** a COALESCE, and is still the 14th column |
| **6. ACL** | Public grant is exactly the four intended columns; each provenance column explicitly absent; no table-level grant re-added; RLS untouched |
| **7. Trigger** | Not `SECURITY DEFINER`; idempotence guard covers all five attribution fields with `IS NOT DISTINCT FROM` and never plain `=`; all five rejection paths raise; CAT-3B's trigger and function untouched |
| **8. Sync durability** | The F-15 columns are structurally unwritable by the sync payload; `card_extras` absent from `sync-cards.mjs` |
| **9. Rollback** | Never writes `cards` or `artists`; Level 1 restores the raw `artist_id` and drops no column; Level 2 drops columns before any grant and never uses `CASCADE`, and every Level 2 statement is commented out |
| **10. Structure** | Exactly one `BEGIN`/`COMMIT`; nothing executable after `COMMIT`; balanced `$$`, quotes and parens; every `DO` block closed; snapshots are `ON COMMIT DROP`; V-1/V-13/V-14 abort rather than warn; no hardcoded 23588; no UUID or credential-shaped literal; no psql meta-command |
| **11. Validation file** | Issues no production write; negative tests wrapped in `ROLLBACK` and marked not-executed |

**PostgreSQL syntax parse: NOT PERFORMED — no parser available.** There is no
`psql`, `pglast`, `sqlparse` or `pg-query-parser` in this environment, and
adding one would be an out-of-scope dependency (AGENTS.md). The structural
checks in group 10 catch the damage a hand-edit most plausibly causes —
unbalanced dollar-quoting, quotes, parens, or an unterminated `DO` block — but
**they are not a parser and are not claimed to be one.** A genuine parse should
happen at execution time, where PostgreSQL itself parses the whole script inside
the transaction before any statement takes effect; a syntax error there aborts
with nothing applied.

`npm.cmd run build` was also run (the repo build), even though `src/**` is
untouched, to prove the runtime is genuinely unaffected.

---

## 12. Files

**Added**

| File | Purpose |
|---|---|
| `docs/F-15_IMPLEMENTATION.md` | this document |
| `docs/sql/f15-durable-attribution-correction.sql` | the migration — **NOT EXECUTED** |
| `docs/sql/f15-durable-attribution-correction-validation.sql` | Part A read-only validation; Part B negative tests, not executed |
| `docs/sql/f15-durable-attribution-correction-rollback.sql` | Level 1 + Level 2 — **NOT EXECUTED** |
| `scripts/f15-attribution-correction.test.mjs` | static containment harness |

**Changed**

| File | Change |
|---|---|
| `.gitattributes` | pin `docs/sql/f15-durable-attribution-correction*.sql` to `eol=lf` so the stated SHA-256 is verifiable on any platform |

**Explicitly unchanged:** `src/**` (zero files) · `sync/**` (zero files) ·
`public.cards` · `public.artists` · artist aliases · CAT-3B's image override
channel, its admission trigger and the `updated_at` trigger · every RLS policy ·
the merged PR #25 design and audit artifacts · `docs/CURRENT_STATE.md`,
`docs/ARCHITECTURE.md`, `docs/DECISION_LOG.md`, `docs/ROADMAP.md` (closeout
documents — updated after successful production execution, not before).

---

## 13. Non-goals

- **No production DDL or DML executed.** No `apply_migration` path was called.
- The 12 ATTR-1 rows are **not repaired**; no `illustrator_override` or
  `artist_id_override` was written for any of them.
- No artist created; no alias added or edited.
- No raw `public.cards` attribution changed.
- `sync/sync-cards.mjs` unchanged; **catalog sync remains paused** — not
  resumed, not triggered.
- No `xya` deduplication; F-16 not solved; the 79-vs-37 coverage question not
  investigated.
- RLS not redesigned; no anon/authenticated write policy added.
- No frontend or runtime change. IMG-0 not started. NAV-1 not started.
- **The PR is not merged and the migration is not run.**

---

## 14. Risks and assumptions

- **Not parsed by PostgreSQL** (§11). The first genuine parse happens at
  execution, inside the transaction, with nothing applied on failure.
- **The B-2 gate is a point-in-time measurement.** It read 5/0/0 on 2026-08-21,
  but `artists.aliases` can change between now and execution — which is exactly
  why the gate is embedded in the migration and re-runs at execution time
  rather than being trusted from this document.
- **`illustrator_override` now always governs `artist_id`.** There is no way to
  correct the display string and leave the FK alone. Intended (I-3), but it is a
  real semantic widening of an existing column, and any future writer of that
  column inherits it.
- **The five legacy rows gain provenance they did not previously have.** The
  values are honest and explicitly marked `verified: false`, but they are
  system-authored, and `approved_at` records the migration time rather than when
  the original override decision was made — which is unknown and not
  reconstructable.
- **`REVOKE ALL ON TABLE` semantics are not assumed.** Rather than relying on
  how much it clears, V-12 asserts the *resulting* ACL is exactly the four
  intended columns and that no table-level grant survives for
  anon/authenticated. Verified by outcome, not by assumption.
- **Pre-existing hazard, recorded and not fixed** (design §6.5): `swsh11-186`
  carries a raw `artist_id` the sync cannot reproduce, so a future full sync
  would drop it from Shinji Kanda's page *today*. F-15 happens to close this
  once backfilled, as a side effect. It is not repaired here.

---

## 15. Recommended next

1. **Review this implementation** — particularly the ordering (§4), the CASE
   (§5), the aliases-only resolver (§6), the legacy provenance (§7), and the
   deferred validation (§10).
2. **Approve production execution as a separate gate.** Expect zero visible
   change (§9).
3. Record the execution result, then update the closeout documents.
4. **Only then ATTR-1** — twelve rows through this channel,
   `artist_id_override` NULL on all twelve, full external provenance,
   separately reviewed and separately approved. Expected visible effect: twelve
   corrected illustrators and exactly one membership change (`sui` 224 → 223).
