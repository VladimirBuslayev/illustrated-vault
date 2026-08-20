# CAT-3B.1 — Approved Alias Image Activation — Activation Slice

**Status: AUTHORED, NOT EXECUTED. Awaiting approval for production execution.**

> **No production write has been performed.** This slice authors the activation
> SQL, validates it read-only against live production, and stops. `§B` of
> `docs/sql/cat-3b1-1-alias-image-activation.sql` has never been run.

| | |
|---|---|
| Slice | CAT-3B.1 — Approved Alias Image Activation (implementation) |
| Type | Production write, **authored only** |
| Branch | `feature/cat-3b1-alias-image-activation` |
| Base | `main` @ `e33acb9bcf95159e0ed60caca1a6bac88d9355e6` |
| Authorizing evidence | `docs/CAT-3B.1_ALIAS_IMAGE_ACTIVATION.md` — Gate 0, `PASS — recommend activation` |
| Migration | `docs/sql/cat-3b1-1-alias-image-activation.sql` |
| Deployed wall | `docs/sql/cat-3b-1-durable-image-override.sql` (CAT-3B) |
| Validation | 2026-08-20, read-only Supabase MCP as `supabase_read_only_user` |
| Production mutations | **none** |
| Catalog sync | **remains paused** |

---

## 1. What this slice does

Gate 0 established that all 192 approved CAT-2D.2 alias relationships qualify to
donate an image to their surviving canonical printing, and that the CAT-3B
override channel is empty and ready to receive them. This slice writes the SQL
that would do it.

The write populates `public.card_extras`'s five image-override fields for 192
canonical cards, taking each override value from the retired alias row's own
`cards.image_url`. Every change is `NULL → value` in the `COALESCE` layer.
`public.cards` is not touched.

**Authoring is not execution.** The two are separated deliberately, per
`AGENTS.md`: *"Do not execute production SQL merely because a migration file was
written."*

---

## 2. Structure of the migration

`docs/sql/cat-3b1-1-alias-image-activation.sql` has four sections. Only §B
writes.

| § | Contents | Safe to run now |
|---|---|---|
| **§A** | Preflight — wall deployed, channel clean, ten admission keys re-derived, predicted split, baseline counts | ✅ read-only |
| **§B** | **The write.** Single `DO` block, fail-closed | ❌ **needs approval** |
| **§C** | Post-write validation — blast radius, bundle integrity, CAT-1 survival, evidence self-check | ✅ read-only |
| **§D** | Rollback, commented out | ❌ only if §C fails |

---

## 3. How the five Gate 0 §13.1 requirements are met

Gate 0 imposed five requirements on any activation slice. Each is met by a
specific construct, not by intent.

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

§B distinguishes inserts from updates via `RETURNING (xmax = 0)` and asserts the
split is exactly 190 / 2. Both the total and the split must match or the
transaction aborts.

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
| Eligible population ≠ 192 | abort, nothing written |
| Rows written ≠ 192 | abort, rolled back |
| Split ≠ 190 / 2 | abort, rolled back |
| CAT-1 enrichment lost on either updated row | abort, rolled back |
| `public.cards` raw null count moved | abort, rolled back |
| **§B re-run after a successful run** | abort — `k08` excludes rows that now hold an override, so the eligible count is 0 and the first assertion fires |

That last row matters: the migration refuses to double-apply, loudly, rather
than quietly rewriting 192 overrides with fresh timestamps.

---

## 5. Validation performed

All validation was **read-only**, through the Supabase MCP as
`supabase_read_only_user` on a connection with `transaction_read_only = on` and
no INSERT/UPDATE privilege on `card_extras` or `cards`. No statement in this
slice could have mutated production.

### 5.1 §A preflight, executed live

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

### 5.2 Write payload, dry-run

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

### 5.3 Evidence payload matches the Gate 0 contract

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

---

## 6. Execution identity

`public.card_extras` has RLS enabled with exactly one policy — a permissive
`SELECT` for `anon`/`authenticated`. **There is no write policy.** CAT-3B §6
narrowed table-level grants to an explicit column list for those roles and
deliberately left `service_role` alone as the write identity.

§B must therefore run as the table owner (the Supabase SQL editor's `postgres`)
or as `service_role`. Run as `anon` or `authenticated` it fails on privileges —
loudly, not silently.

---

## 7. Predicted blast radius

Unchanged from Gate 0 §10, re-derived live during validation.

| Measure | Before | After |
|---|---|---|
| `card_extras` rows | 5 | **195** |
| Populated image overrides | 0 | **192** |
| `cards` raw missing image | 1,640 | **1,640** (unchanged) |
| `cards_effective` missing image | 1,640 | **1,448** |
| Active-owned missing image | 122 | **77** |

All 192 changes are `NULL → value`. No existing image can be displaced, because
every target's effective image is currently `NULL`.

---

## 8. Containment

**Not done, deliberately:**

* **no production write executed** — §B has never been run;
* no schema, constraint, trigger, view, RLS or ACL change;
* `public.cards` unmodified;
* frontend and sync code unmodified;
* catalog sync **remains paused**;
* the 1,448 non-alias image gaps untouched;
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

1. **Gate 0's evidence is a 2026-08-20 snapshot.** §A and §B both re-derive
   admission live, so drift causes an abort rather than a bad write — but if
   drift has occurred, execution will fail rather than proceed, and the slice
   must be re-gated. This is intended.
2. **`now()` is the approval timestamp.** `image_override_approved_at` records
   when the write executed, not when Gate 0 passed. This is the honest reading
   of "approved at" for an admission-time channel.
3. **Rollback leaves bundle-empty rows behind.** §D clears the five image fields
   in place rather than deleting rows, because two rows predate this slice and
   hold CAT-1 enrichment. The 190 rows this slice would insert remain as
   empty-bundle rows after a rollback. That is harmless — `cards_effective`
   `COALESCE`s a `NULL` override to the raw value — but it is not a
   byte-identical restoration of the prior table, and it is deliberate.

---

## 10. Manual QA required after execution

None of this can be checked before the write runs.

1. Run §C in full. Every "must be 0" query must return 0; every count must match
   §7.
2. Confirm `swsh12.5gg-GG19` and `swsh12.5gg-GG69` still show their CAT-1
   illustrator values in the UI, and now also show images.
3. Spot-check a handful of activated cards in production and confirm the image
   renders from `assets.tcgdex.net` and is the correct printing.
4. Confirm the owned view's missing-image count drops from 122 to 77.
5. Confirm no non-alias card gained or lost an image.

---

## 11. Next checkpoint

**This slice is complete as authored work and stops at the execution gate.**

Production execution requires separate explicit approval. On approval the order
is: §A → read output → §B → §C → manual QA → documentation closeout of
`CURRENT_STATE.md`, `CHANGELOG.md` and `DECISION_LOG.md`.

Roadmap intent, unchanged:

**CAT-3B.1 activation → close catalog image work → NAV-1 → SEC-0 → AUTH-1 → BETA-0**
