# CAT-3B.1 — Approved Alias Image Activation — Activation Slice

**Status: ✅ EXECUTED / VALIDATED / PASS — production activation complete 2026-08-20.**

> **The production write has been performed, once.** `§B` of
> `docs/sql/cat-3b1-1-alias-image-activation.sql` executed successfully against
> production on 2026-08-20 from PR #21 @ `304c69dd05bd0d2809008a76e607c5e729ba1e87`.
> `§C` post-write validation passed in full. Rollback (`§D`) was **not** used and
> is not warranted. 192 approved alias image overrides are live.

| | |
|---|---|
| Slice | CAT-3B.1 — Approved Alias Image Activation (implementation) |
| Type | Production write — **executed** |
| Branch | `feature/cat-3b1-alias-image-activation` |
| Base | `main` @ `e33acb9bcf95159e0ed60caca1a6bac88d9355e6` |
| Executed head | `304c69dd05bd0d2809008a76e607c5e729ba1e87` (PR #21) |
| Execution date | **2026-08-20** |
| Authorizing evidence | `docs/CAT-3B.1_ALIAS_IMAGE_ACTIVATION.md` — Gate 0, `PASS — recommend activation` |
| Migration | `docs/sql/cat-3b1-1-alias-image-activation.sql` |
| Deployed wall | `docs/sql/cat-3b-1-durable-image-override.sql` (CAT-3B) |
| Validation | §A PASS · §B success (190 inserts + 2 updates) · §C PASS — see §5 |
| Production mutations | **192 `card_extras` image-override bundles** (190 inserted, 2 updated) |
| Rollback | **not executed** |
| Catalog sync | **remains paused** |

> **Corrections applied 2026-08-20** in response to review of PR #21, before
> ChatGPT approval for production execution: (1) the candidate selector is
> pinned to the exact CAT-2D.2 approved-alias evidence class, not merely
> whatever `card_identity_resolution` resolves today; (2) §B is
> self-contained on first-writer channel cleanliness and derives its 190/2
> insert/update split from pre-write state instead of `RETURNING (xmax = 0)`;
> (3) §D rollback deletes the 190 inserted rows (behind a fail-closed
> enrichment guard) instead of leaving them as empty rows, and §C proves
> the active-owned missing-image count is 77 instead of leaving it to manual
> QA. See §3.0, §3.4, §4, §9 and §10 below. **These corrections are the SQL that
> was executed** — §A was re-run live against the corrected file and passed
> before §B was authorized. See §5.
>
> **The executed SQL is now historical execution evidence and must remain
> stable.** Do not edit `docs/sql/cat-3b1-1-alias-image-activation.sql` except to
> correct a factual documentation typo. §B must not be run again — it is
> designed to refuse a second application (§4).

---

## 1. What this slice does

Gate 0 established that all 192 approved CAT-2D.2 alias relationships qualify to
donate an image to their surviving canonical printing, and that the CAT-3B
override channel is empty and ready to receive them. This slice wrote the SQL
that does it, and — on separate explicit approval — executed it.

The write populated `public.card_extras`'s five image-override fields for 192
canonical cards, taking each override value from the retired alias row's own
`cards.image_url`. Every change was `NULL → value` in the `COALESCE` layer.
`public.cards` was not touched.

**Authoring is not execution.** The two were separated deliberately, per
`AGENTS.md`: *"Do not execute production SQL merely because a migration file was
written."* Authoring landed first and stopped at the execution gate; execution
followed only after independent review of PR #21 and an explicit production
authorization naming the exact head.

---

## 2. Structure of the migration

`docs/sql/cat-3b1-1-alias-image-activation.sql` has four sections. Only §B
writes.

| § | Contents | Status |
|---|---|---|
| **§A** | Preflight — wall deployed, channel clean, ten admission keys re-derived, predicted split, baseline counts | ✅ read-only — **executed, PASS** |
| **§B** | **The write.** Single `DO` block, fail-closed | ✅ **executed once, succeeded** — must not be re-run |
| **§C** | Post-write validation — blast radius, bundle integrity, CAT-1 survival, evidence self-check | ✅ read-only — **executed, PASS** |
| **§D** | Rollback, commented out | **not executed; not warranted** |

---

## 3. How the five Gate 0 §13.1 requirements are met

Gate 0 imposed five requirements on any activation slice. Each is met by a
specific construct, not by intent.

### 3.0 Provenance pin — the candidate population is a class, not a count

The candidate selector is not "whatever pairs `card_identity_resolution`
currently resolves." It is the exact CAT-2D.2 approved-alias evidence class:
`card_identity_aliases` rows where `slice = 'CAT-2D.2'`,
`family = 'set_rename'`, `approved_by = 'CAT-2D.2 approved allowlist —
docs/cat-2d2-evidence/manifest.json'` — additionally required to still
resolve through the deployed `card_identity_resolution` view. §A and §B both
define the identical `cat2d2_alias_pair` CTE and both assert its row count is
exactly 192 before any admission check runs. No card id or image URL is ever
hard-coded; the provenance predicate is the pin.

This closes a gap the original slice did not cover: cardinality staying at
192 does not by itself prove the *identity* of the population is unchanged. A
future remove-one/add-one against `card_identity_aliases` could hold the
count at 192 while silently substituting a different approved alias into this
activation. Pinning on `slice`/`family`/`approved_by` makes that substitution
visible as a class-count drift (the substituted alias belongs to a different
class, so the pinned class shrinks below 192) rather than something a bare
row-count check would miss.

### 3.1 Requirement 1 — derive, do not transcribe

The override value is `src.image_url`, selected from `public.cards` **inside the
`INSERT ... SELECT` itself**. There is no URL literal anywhere in the migration.

This is what satisfies trigger rule **R3**, which compares the stored value
against the source's `image_url` *at admission time*. A transcribed list
captured when this file was written could have gone stale before execution, and
R3 would reject it — correctly.

### 3.2 Requirement 2 — preserve CAT-1 enrichment

`swsh12.5gg-GG19` and `swsh12.5gg-GG69` already exist in `card_extras` carrying
`illustrator_override` and `source_note` from CAT-1.

The write is an upsert whose `ON CONFLICT (card_id) DO UPDATE SET` lists **only
the five image fields**. `illustrator_override` and `source_note` are absent
from that list, so `DO UPDATE` leaves them untouched. That absence *is* the
preservation guarantee — it is not incidental, and the migration says so at the
point of the omission.

A wholesale upsert of the full row, or a `DELETE` + `INSERT`, would null both
columns. Gate 0 called this "the single most important containment requirement";
§B additionally **asserts** after writing that both rows still hold both values,
and aborts the transaction if not.

### 3.3 Requirement 3 — re-verify immediately before writing

The `WHERE` clause of the writing statement **is** the ten-key admission
predicate. It is evaluated as part of the write, not read from §A's output.

A pair that stopped qualifying between §A and §B is simply not selected — and
the row-count assertion then fails the whole transaction rather than applying a
silently reduced population. §B also computes the eligible count from that same
predicate *before* writing and aborts if it is not exactly 192.

### 3.4 Requirement 4 — expect 190 inserts and 2 updates

§B derives the 190/2 split from **pre-write state**, not from an MVCC system
column on the write's own output. Before writing, it counts which eligible
targets already have a `card_extras` row (updates) versus none (inserts),
asserts the split is exactly 190 / 2, and asserts the two pre-existing target
ids are exactly `swsh12.5gg-GG19` and `swsh12.5gg-GG69` with CAT-1 enrichment
still intact. The write itself is then asserted only on total affected rows
via `GET DIAGNOSTICS ... ROW_COUNT`, and the post-write growth in
`card_extras`'s row count is checked against the pre-derived insert count.
`RETURNING (xmax = 0)` is no longer part of the correctness contract: the
split is knowable — and checked — from ordinary table state before the write
runs at all.

### 3.5 Requirement 5 — touch nothing else

The migration contains no DDL. It does not alter schema, constraints, triggers,
views, RLS or ACL, does not touch `public.cards`, and does not reach the 1,448
non-alias image gaps. §B asserts after writing that `public.cards`'s raw null
count is still 1,640.

---

## 4. Fail-closed design

Every assertion in §B **raises**. A raise inside a `DO` block aborts the
surrounding transaction, so any deviation rolls the write back entirely. There
is no partial-application path: either all 192 rows land with every count
matching, or nothing is written.

| Condition | Behavior |
|---|---|
| CAT-2D.2 evidence class ≠ 192 rows | abort, nothing written — provenance pin checked first |
| Channel not clean (any pre-existing populated override anywhere) | abort, nothing written |
| Eligible population ≠ 192 | abort, nothing written |
| Pre-write split ≠ 190 / 2, or the 2 pre-existing ids ≠ `swsh12.5gg-GG19`/`swsh12.5gg-GG69`, or either lacks CAT-1 enrichment | abort, nothing written |
| Rows written ≠ 192 (`GET DIAGNOSTICS ROW_COUNT`) | abort, rolled back |
| `card_extras` row-count growth ≠ 190 (the pre-derived insert count) | abort, rolled back |
| CAT-1 enrichment lost on either updated row | abort, rolled back |
| `public.cards` raw null count moved | abort, rolled back |
| **§B re-run after a successful run** | abort — `k08` excludes rows that now hold an override, so the eligible count is 0 and that assertion fires |

That last row matters: the migration refuses to double-apply, loudly, rather
than quietly rewriting 192 overrides with fresh timestamps.

---

## 5. Validation performed

### 5.0 Production execution record — 2026-08-20

Executed from PR #21 @ `304c69dd05bd0d2809008a76e607c5e729ba1e87`, against the
corrected SQL, in the order §A → §B → §C.

**§A — PASS.** Re-run live against the corrected file, superseding the
pre-correction pass recorded in §5.1–§5.3. Every value matched the required
contract:

| Group | Required | Live |
|---|---|---|
| Wall constraints present | 5 | **5** ✅ |
| Admit trigger enabled | true | **true** ✅ |
| Admit fn SECURITY INVOKER | true | **true** ✅ |
| `card_extras` rows | 5 | **5** ✅ |
| All five image-bundle fields populated | 0 each | **0 each** ✅ |
| Provenance-pinned class count | 192 | **192** ✅ |
| Pairs total | 192 | **192** ✅ |
| Admission keys k01–k10 | 192 each | **192 each** ✅ |
| Eligible on all ten | 192 | **192** ✅ |
| Distinct source URLs | 192 | **192** ✅ |
| Predicted inserts / updates | 190 / 2 | **190 / 2** ✅ |
| Pre-existing target ids | GG19, GG69 exactly | **GG19, GG69** ✅ |
| Both: illustrator_override / source_note / empty bundle | true / true / true | **true / true / true** ✅ |
| Baseline raw / effective missing, `card_extras` | 1640 / 1640 / 5 | **1640 / 1640 / 5** ✅ |

This closed §5.5. The provenance-pinned `class_count` of 192 confirmed live
that the pinned CAT-2D.2 evidence class and the unfiltered resolution view are
in fact identical today — the equivalence §5.5 required be re-confirmed rather
than assumed.

**§B — executed once, succeeded.** 190 inserts + 2 updates = 192 total affected
rows. Every in-transaction assertion passed; nothing was rolled back.

**§C — PASS.** Full results in §5.6.

**§D — not executed.** No rollback was performed and none is warranted.

### 5.1 §A preflight, pre-correction pass (historical)

Recorded for chronology. This pass ran read-only through the Supabase MCP as
`supabase_read_only_user` on a connection with `transaction_read_only = on` and
no INSERT/UPDATE privilege on `card_extras` or `cards`. It predates the
corrections and is **superseded by §5.0**.

| Check | Required | Live |
|---|---|---|
| Wall constraints present | 5 | **5** ✅ |
| `card_extras_admit_image_override` trigger enabled | true | **true** ✅ |
| Admission function is SECURITY INVOKER | true | **true** ✅ |
| Pairs total | 192 | **192** ✅ |
| Admission keys k01–k10 | 192 each | **192 each** ✅ |
| Eligible on all ten | 192 | **192** ✅ |
| Distinct source URLs | 192 | **192** ✅ |
| Predicted inserts / updates | 190 / 2 | **190 / 2** ✅ |

### 5.2 Write payload, dry-run (historical, pre-correction)

§B's exact `SELECT` payload was executed as a plain read-only `SELECT` — the
same joins, the same predicate, the same `jsonb_build_object` — without the
`INSERT`:

| Measure | Result |
|---|---|
| Rows the write would produce | **192** |
| Distinct target `card_id` | **192** — equal to row count, so no row is targeted twice in one statement (which `ON CONFLICT DO UPDATE` would reject) |
| Distinct override URLs | **192** — no two canonical cards receive the same image |
| Self-sourced rows (`source = target`) | **0** |
| Payload URL matches evidence field | **192 / 192** |
| Shape-rule conformance | **192 / 192** |
| `target_raw_image_url_at_admission` is JSON `null` | **192 / 192** |

### 5.3 Evidence payload matches the Gate 0 contract (historical, pre-correction)

Rendered live for `swsh12.5-GG01 → swsh12.5gg-GG01`:

```json
{
    "gate": "CAT-3B.1 Gate 0",
    "basis": "cat-2d2-approved-same-printing-alias",
    "slice": "CAT-3B.1",
    "alias_slice": "CAT-2D.2",
    "alias_family": "set_rename",
    "gate_evidence": "docs/sql/cat-3b1-0-gate0.sql",
    "source_card_id": "swsh12.5-GG01",
    "alias_approved_at": "2026-08-17T18:57:27.574545+00:00",
    "source_image_url_at_admission": "https://assets.tcgdex.net/en/swsh/swsh12.5/GG01",
    "target_raw_image_url_at_admission": null
}
```

Field-for-field identical to Gate 0 §12.2, including the `alias_approved_at`
rendering. Key order differs because `jsonb` stores keys by length then
bytewise — that is storage representation, not content.

Every field is derived from `card_identity_aliases` and `cards`, so the payload
can be recomputed and diffed against what was stored, indefinitely. §C-6
includes exactly that self-check as a query returning 0 on success.

### 5.4 Not run

`npm.cmd run build` was **not** run. This slice changes no runtime code — no
file under `src/`, no sync code, no config. `AGENTS.md` requires the build for
frontend/runtime changes; this is a SQL and documentation slice.

### 5.5 Closed — §A was re-run live before execution

This section previously recorded that the corrected SQL had not been re-verified
against production. **That is closed.** §A was re-executed live against the
corrected file and passed in full; the figures are in §5.0. §C-7's active-owned
proof is no longer a prediction — it was measured at 77 post-write (§5.6).

### 5.6 §C post-write validation — PASS

Executed immediately after §B.

**Blast radius**

| Measure | Before | Required after | Live after |
|---|---|---|---|
| `card_extras` rows | 5 | 195 | **195** ✅ |
| Populated image overrides | 0 | 192 | **192** ✅ |
| `cards` raw missing image | 1,640 | 1,640 | **1,640** ✅ |
| `cards_effective` missing image | 1,640 | 1,448 | **1,448** ✅ |

**Bundle integrity**

| Check | Required | Live |
|---|---|---|
| Overrides | 192 | **192** ✅ |
| Complete bundles | 192 | **192** ✅ |
| Self-sourced (`source = target`) | 0 | **0** ✅ |
| Distinct override URLs | 192 | **192** ✅ |
| Overrides without an approved alias relationship | 0 | **0** ✅ |
| Overrides not matching the source's `image_url` | 0 | **0** ✅ |
| Evidence rows failing self-check | 0 | **0** ✅ |

**CAT-1 preservation** — the containment requirement Gate 0 called the most
important. Both pre-existing rows retained their CAT-1 enrichment *and* gained
an image override:

| Card | `illustrator_override` | `source_note` | `image_url_override` |
|---|---|---|---|
| `swsh12.5gg-GG19` | **true** ✅ | **true** ✅ | **true** ✅ |
| `swsh12.5gg-GG69` | **true** ✅ | **true** ✅ | **true** ✅ |

**Catalog containment**

| Check | Required | Live |
|---|---|---|
| Targets with an effective image | 192 | **192** ✅ |
| Alias sources visible in the effective catalog | 0 | **0** ✅ |

**Evidence integrity** — all 192 of 192 passed every provenance component:
`slice`, `basis`, source card linkage, source image linkage, target-raw-image-
was-null, and Gate 0 provenance. Zero self-check failures.

**Ownership authority (§C-7)**

| Measure | Required | Live |
|---|---|---|
| `target_user_resolved` | 1 | **1** ✅ |
| `target_batch_resolved` | 1 | **1** ✅ |
| `active_owned_missing_image` | 77 | **77** ✅ |

Active-owned image gaps fell **122 → 77**: 45 gaps closed, exactly the
CAT-3A A-dimension population.

### 5.7 Execution-tool deviation — recorded, not material

The connector's safety layer blocked two §C queries *as literally written*: the
C-3 CAT-1 preservation query and the C-6 five-row evidence display. Neither was
skipped; both were replaced with equivalent or stronger read-only verification:

* **C-3** was confirmed by querying each of the two rows individually. Both
  returned `illustrator_override` / `source_note` / `image_url_override` all
  true — the same three facts the blocked query would have returned, for the
  same two rows.
* **C-6** was replaced with an **all-192 aggregate** provenance validation
  rather than a five-row sample: 192/192 correct slice, 192/192 correct basis,
  192/192 correct source linkage, 192/192 correct URL linkage, 192/192
  target-was-empty evidence, 192/192 correct gate, 0 self-check failures. This
  is strictly stronger than the sample it replaced.

The deviation is in the *tooling used to observe*, not in the migration, the
data written, or the acceptance criteria. Recorded here so the validation
record is not overstated as a verbatim run of the committed §C text.

### 5.8 Not performed — UI QA

**No browser or UI spot-check was performed.** §10 items 2, 3 and 5 call for
visual confirmation in production; the executing sessions had SQL access only.
All CAT-3B.1 acceptance evidence is therefore **SQL-proven, not
visually confirmed**.

This is recorded as an honest gap rather than treated as satisfied. It is not
blocking: §C-7 proves the owned-gap movement in SQL, §C proves every override
resolves through `cards_effective`, and every override value is asserted equal
to its source card's live `image_url`. The residual unproven claim is narrow —
that the rendered pixel in a browser is the correct printing — and it is
recoverable at any time by opening the app. See §10.

---

## 6. Execution identity

`public.card_extras` has RLS enabled with exactly one policy — a permissive
`SELECT` for `anon`/`authenticated`. **There is no write policy.** CAT-3B §6
narrowed table-level grants to an explicit column list for those roles and
deliberately left `service_role` alone as the write identity.

§B therefore had to run as the table owner (the Supabase SQL editor's
`postgres`) or as `service_role`. Run as `anon` or `authenticated` it fails on
privileges — loudly, not silently. It was executed with sufficient privilege on
2026-08-20.

---

## 7. Blast radius — predicted, then measured

Gate 0 §10 predicted this. §C measured it. **Every figure matched.**

| Measure | Before | Predicted | Measured after |
|---|---|---|---|
| `card_extras` rows | 5 | 195 | **195** ✅ |
| Populated image overrides | 0 | 192 | **192** ✅ |
| `cards` raw missing image | 1,640 | 1,640 (unchanged) | **1,640** ✅ |
| `cards_effective` missing image | 1,640 | 1,448 | **1,448** ✅ |
| Active-owned missing image | 122 | 77 | **77** ✅ |

All 192 changes were `NULL → value`. No existing image could be displaced,
because every target's effective image was `NULL` at admission — asserted per
row in the stored evidence (`target_raw_image_url_at_admission`) and re-proved
192/192 by §C.

The "Active-owned missing image" row was not left to manual QA: §C-7 proved the
post-write figure of 77 read-only, using the same single-user/single-batch
ownership authority as Gate 0 §G0-6 (snapshot ∪ force-owned − force-missing, no
`owned_keys`).

> **Baseline note, unresolved and non-blocking.** CAT-3A recorded the
> active-owned missing-image population as **117**; CAT-3B.1's §A and §C
> measured the pre-write baseline as **122**. The 45-card improvement is
> consistent across both records (CAT-3A's A-dimension found 45 such cards, and
> 122 − 45 = 77), so the *delta* is not in question — only the baseline is. The
> two figures were measured on different dates by different selectors and the
> discrepancy was not investigated here. It is recorded rather than silently
> reconciled, and it does not affect any CAT-3B.1 acceptance criterion.

---

## 8. Containment

**What the production write did and did not touch:**

* the write is confined to `public.card_extras`'s five image-override columns on
  192 rows — 190 inserted, 2 updated;
* no schema, constraint, trigger, view, RLS or ACL change;
* `public.cards` unmodified — raw missing-image count still 1,640, asserted
  in-transaction by §B and re-proved by §C;
* frontend and sync code unmodified;
* catalog sync **remains paused**;
* the 1,448 remaining non-alias image gaps untouched, and **not authorized for
  any further repair phase**;
* no alias relationship created, modified or removed;
* no existing override overwritten — `k08` excludes any target that already
  holds one;
* no cross-printing or cross-language image proxy introduced;
* no generic image-provenance framework created.

**Unrelated known failure:** `ol0c-import-snapshot.test.mjs` expects 33 where the
current allowlist count is 34. Out of scope and not touched; no test run was
required, because this slice changes no runtime code.

---

## 9. Deviations and risks

**No deviations from the Gate 0 requirements.** All five §13.1 requirements are
met by explicit constructs, documented in §3 above.

Risks worth stating:

1. **Gate 0's evidence was a 2026-08-20 snapshot.** §A and §B both re-derive
   admission live, so drift would have caused an abort rather than a bad write.
   No drift occurred: §A re-derived all ten admission keys at 192 each on the
   day of execution, and §B's in-transaction re-derivation agreed. Resolved.
2. **`now()` is the approval timestamp.** `image_override_approved_at` records
   when the write executed, not when Gate 0 passed. This is the honest reading
   of "approved at" for an admission-time channel.
3. **Rollback was not executed and is not warranted** — §C passed in full. The
   §D contract is recorded here for completeness only. **Rollback restores the
   pre-slice operational baseline, not a byte-identical
   table.** §D clears the five image fields **in place** on the two
   pre-existing CAT-1 rows (`swsh12.5gg-GG19`, `swsh12.5gg-GG69`) — never
   deletes them — and **deletes** the 190 rows this slice inserted, behind a
   fail-closed guard that aborts the delete if any of those rows has since
   picked up non-image (`illustrator_override`/`source_note`) enrichment a
   delete would destroy. §D then asserts `card_extras` is back to 5 rows with
   0 populated bundles and both CAT-1 rows intact. This also means a retry of
   §B after a successful rollback sees the same 190/2 pre-state split §B's own
   pre-write assertions expect, rather than 192 already-existing rows.

---

## 10. Post-execution QA — status

| # | Check | Status |
|---|---|---|
| 1 | Run §C in full; every "must be 0" returns 0, every count matches §7 | ✅ **DONE** — PASS (§5.6), with the C-3/C-6 tooling deviation recorded in §5.7 |
| 2 | `swsh12.5gg-GG19` / `swsh12.5gg-GG69` still show CAT-1 illustrator values **in the UI**, and now also show images | ⚠️ **SQL-proven only** — both rows hold all three values (§5.6); not visually confirmed |
| 3 | Spot-check activated cards in production; image renders from `assets.tcgdex.net` and is the correct printing | ❌ **NOT PERFORMED** — no UI QA (§5.8) |
| 4 | §C-7 shows `active_owned_missing_image` = 77, `target_user_resolved` = 1, `target_batch_resolved` = 1 | ✅ **DONE** — all three confirmed (§5.6). UI half of this item not performed |
| 5 | No non-alias card gained or lost an image | ✅ **DONE** — `cards` raw null count unchanged at 1,640; effective moved by exactly 192; alias sources visible in effective = 0 |

Items 2, 3 and the UI half of 4 remain open. They are **not blocking** — see
§5.8 for why the residual unproven claim is narrow — but they must not be
described as complete. Anyone opening the app can close them in minutes.

---

## 11. Status and next checkpoint

**This slice is COMPLETE: authored, reviewed, executed and validated.**

Executed 2026-08-20 from PR #21 @ `304c69dd05bd0d2809008a76e607c5e729ba1e87`.
192 overrides live, §C PASS, rollback unused, sync still paused.

**Broad catalog image remediation is now CLOSED.** CAT-3B.1 activated the only
population that was ever authorized — the 192 CAT-2D.2 approved same-printing
alias pairs. The remaining **1,448** effective image gaps are explicitly **not
authorized for another repair phase**: CAT-3A established that not one of them
has an image available at TCGdex today (T1 = 0 of 1,640), so there is no known
admissible source for any of them. Reopening image work would require new
evidence, not a new slice.

Remaining closeout: independent review of PR #21, then merge. **Merging does not
re-execute any SQL** — the production write is already done, and §B refuses a
second application by construction (§4).

Roadmap, unchanged:

**CAT-3B.1 ✅ → catalog image work CLOSED → NAV-1 → SEC-0 → AUTH-1 → BETA-0**

Next slice is **NAV-1**. It is not started, and is not authorized by this
document.
