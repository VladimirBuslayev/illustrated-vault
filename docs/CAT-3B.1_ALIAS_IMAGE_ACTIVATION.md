# CAT-3B.1 — Approved Alias Image Activation — Gate 0

**Status: GATE 0 COMPLETE — disposition `PASS — recommend activation`.**

**This document authorizes no write.** It establishes the population a
separately approved activation slice would act on, and nothing else.

| | |
|---|---|
| Slice | CAT-3B.1 — Approved Alias Image Activation, Gate 0 |
| Type | Read-only decision slice |
| Branch | `audit/cat-3b1-alias-image-gate0` |
| Base | `main` @ `0629f77deec7ee638bde410adcb81ed72d468997` |
| Evidence SQL | `docs/sql/cat-3b1-0-gate0.sql` |
| Evidence gathered | 2026-08-20, read-only Supabase MCP |
| Connected role | `supabase_read_only_user` (PostgreSQL 17.6) |
| Production mutations | **none** |
| Catalog sync | **remains paused** |

---

## 0. What this slice is

CAT-3B built the durable image-override **channel** and deliberately populated
nothing. CAT-3B.1 asks the next question and only that question:

> Given current live database state, exactly which canonical cards would
> qualify to receive an approved-alias image override, and what would happen if
> they did?

This is intended as the **exit slice from catalog image work**. It is not the
opening of broader image remediation, and it is not CAT-3C.

### 0.1 The selector is derived, never remembered

CAT-3A measured 192 approved pairs holding a live retained source asset. That
figure is **history**. Every count in this document was derived from
`public.card_identity_resolution` and current live catalog state. The historical
figure appears in §11 for reconciliation only — to explain a delta, never to
produce one.

That distinction matters: had the live population shrunk, a hard-coded 192-row
list would have silently proposed writes for rows that no longer qualify.

---

## 1. Environment proof

The two prior CAT-3B.1 attempts failed on environment, not evidence. This run
therefore proved the environment before creating a branch or editing a file.

| Check | Result |
|---|---|
| Working directory | `C:\dev\illustrated-vault` ✅ |
| Supabase MCP loaded and callable | ✅ — proven by executing `select current_database(), current_user, version()` |
| Authenticated | ✅ — role `supabase_read_only_user` |
| Write capability | **none** — the role itself is read-only |

The read-only property of this slice is enforced by the **connection**, not
merely by the discipline of the SQL. No statement in this slice could have
mutated production even if it had tried to.

## 2. Pre-flight

| Check | Result |
|---|---|
| `git status` | clean, no unexplained changes |
| Branch at start | `main` |
| `git fetch origin` | ✅ |
| `origin/main` | `0629f77deec7ee638bde410adcb81ed72d468997` — exactly the expected SHA |
| Commits since expected SHA | none — no divergence to assess |
| Catalog sync | paused — `.github/workflows/sync-cards.yml` has no `schedule:` trigger; `workflow_dispatch` only |
| Branch created | `audit/cat-3b1-alias-image-gate0` from current `origin/main` |

---

## 3. The candidate definition

A candidate is a pair (target, source) where:

* **target** = `card_identity_resolution.canonical_card_id` — the surviving printing;
* **source** = `card_identity_resolution.alias_card_id` — the retired provider-history row;

and the image flows **source → target**. The proposed override value is the
source row's own `cards.image_url`.

`public.card_identity_aliases` has **no status column**. `approved_by`,
`approved_at` and `evidence` are all `NOT NULL`, so **presence in the table is
approval**. There is no pending or rejected state that could leak into this
population.

---

## 4. G0-1 — approved relationship population

| Measure | Live value | Required |
|---|---|---|
| Alias rows total | **192** | — |
| `card_identity_resolution` rows | **192** | = alias rows |
| Distinct `alias_card_id` | **192** | = rows |
| Distinct `canonical_card_id` | **192** | = rows |
| Self-alias (`alias = canonical`) | **0** | 0 |
| Canonical that is itself an alias (chain) | **0** | 0 |
| Two-cycles (a↔b) | **0** | 0 |
| Alias row missing from `cards` | **0** | 0 |
| Canonical missing from `cards` | **0** | 0 |
| Canonical absent from `cards_effective` | **0** | 0 |

**192 distinct aliases mapping to 192 distinct canonicals is a perfect 1:1
bijection.** No canonical receives two sources, and no source serves two
canonicals.

**Depth-one is measured, not assumed.** `canonical_is_also_alias_chain = 0`
means no `canonical_card_id` appears anywhere as an `alias_card_id`. There is no
chain to resolve transitively and no cycle can form, so there is no
reinterpretation risk. **Zero unresolved relationships.**

### 4.1 Provenance of the population

| slice | family | n | approved |
|---|---|---|---|
| CAT-2D.2 | `set_rename` | 192 | 2026-08-17 18:57:27 UTC |

Single slice, single family, single approver
(`CAT-2D.2 approved allowlist — docs/cat-2d2-evidence/manifest.json`), one
timestamp. Nothing has been added to this table since CAT-2D.2.

### 4.2 Structural correspondence

| source set | target set | n |
|---|---|---|
| `swsh12.5` | `swsh12.5gg` | 70 |
| `swsh4.5` | `swsh4.5sv` | 122 |

The rename preserves `local_id` exactly and moves only the set namespace:
`swsh12.5-GG01` → `swsh12.5gg-GG01`.

### 4.3 Independent corroboration of same-printing identity

Not required for admission — CAT-2D.2 already established these relationships
independently — but measured here because it is nearly free:

| Field | Agreement across 192 pairs |
|---|---|
| `name` | **192 / 192** |
| `local_id` | **192 / 192** |
| `rarity` | **192 / 192** |
| Source `image_url` equals the source's **own** derived TCGdex identity path (`.../{set_id}/{local_id}`) | **192 / 192** |
| `illustrator` identical | 122 / 192 |

The illustrator column needs explanation. Of the 70 pairs that differ:

* **70** — target has an illustrator, source is `NULL`;
* **0** — target `NULL`, source set;
* **0** — both set but different.

**Zero cases where two different named artists appear on the two rows.** The
surviving row is strictly richer; nothing contradicts same-printing identity.

The `url_is_own_identity` result is the important one for image safety: every
source URL is that source's own set/local_id path. **Nothing was borrowed from a
third printing**, so this activation cannot introduce a cross-printing or
cross-language image proxy.

**G0-1: PASS.**

---

## 5. G0-2 — source asset availability

Live database admission check across all 192 eligible relationships. This is not
a rerun of the CAT-3A web-source audit.

| Measure | Live value |
|---|---|
| Source raw row still exists | **192 / 192** |
| Source raw `image_url` non-null and non-blank | **192 / 192** |
| Source `image_url` satisfies the deployed CAT-3B shape rule | **192 / 192** |
| Failures / exceptions | **0** |

**The exception list is empty.** There is nothing to enumerate.

The shape predicate used is a verbatim copy of the deployed
`card_extras_image_override_shape` CHECK — correct host, no trailing slash, no
file extension, no whitespace — reproduced rather than approximated so that a
looser local rule could not report a candidate the wall would later reject.

**G0-2: PASS.**

---

## 6. G0-3 — target need

| Measure | Live value |
|---|---|
| Target present in `cards_effective` | **192 / 192** |
| Target raw `cards.image_url IS NULL` | **192 / 192** |
| Target effective `cards_effective.image_url IS NULL` | **192 / 192** |
| Target already has an effective image | **0** |

**Zero targets already carry an effective image.** The concern that a target
might receive an override merely because an alias source exists does not arise
in this population — there is no such case to explain.

Because every target's effective image is currently `NULL`, the `COALESCE`
override can only change `NULL → value`. It cannot displace an existing pixel.

**G0-3: PASS.**

---

## 7. G0-4 — channel cleanliness

Measured across the **whole** `card_extras` table, not just this population — an
override anywhere else would still be an untraceable curated pixel.

| Measure | Live value | Historical expectation |
|---|---|---|
| `card_extras` rows total | 5 | 5 |
| `image_url_override` populated | **0** | 0 |
| `image_override_source_card_id` populated | **0** | 0 |
| `image_override_evidence` populated | **0** | 0 |
| `image_override_approved_by` populated | **0** | 0 |
| `image_override_approved_at` populated | **0** | 0 |
| Complete override bundles | **0** | 0 |
| **Partial bundles** | **0** | 0 |

**The channel is empty, exactly as CAT-3B left it.** No unexpected override, no
partial bundle. No STOP condition.

### 7.1 Collisions with the proposed population

Two of the five existing `card_extras` rows are CAT-3B.1 targets:

| card_id | illustrator_override | source_note | image override | is CAT-3B.1 target |
|---|---|---|---|---|
| `swsh11-185` | set | set | none | no |
| `swsh11-186` | set | set | none | no |
| `swsh12-TG11` | set | set | none | no |
| `swsh12.5gg-GG19` | set | set | none | **yes** |
| `swsh12.5gg-GG69` | set | set | none | **yes** |

Both colliding rows carry prior CAT-1 illustrator enrichment.

> **⚠ Constraint on any future activation write.** These two rows must be
> modified **in place**, touching only the five image fields. A wholesale upsert
> would null `illustrator_override` and `source_note` and silently destroy
> CAT-1 enrichment. This is the single most important containment requirement
> for the activation slice.

**G0-4: PASS.**

---

## 8. G0-5 — deployed admission equivalence

Live production definitions were read through the read-only MCP and compared
against the repo-tracked implementation in
`docs/sql/cat-3b-1-durable-image-override.sql`.

### 8.1 Repo vs production

| Object | Live state | Matches repo |
|---|---|---|
| `card_extras_image_override_all_or_nothing` | present, all five fields | ✅ |
| `card_extras_image_override_approved_by_nonempty` | present | ✅ |
| `card_extras_image_override_shape` | present, `^https://assets\.tcgdex\.net/[^[:space:]]+$` + no trailing `/` + no file extension | ✅ |
| `card_extras_image_override_source_not_self` | present | ✅ |
| `card_extras_image_override_source_fk` | `REFERENCES cards(id) ON DELETE RESTRICT` | ✅ |
| `card_extras_admit_image_override()` | present, `prosecdef = false` (SECURITY INVOKER) | ✅ |
| Trigger `card_extras_admit_image_override` | `BEFORE INSERT OR UPDATE ... FOR EACH ROW`, `tgenabled = 'O'` (enabled) | ✅ |
| `cards_effective` | 14 columns, `COALESCE(ce.image_url_override, c.image_url)`, alias `NOT EXISTS` exclusion intact | ✅ |
| `card_identity_resolution` | two-column projection of `card_identity_aliases` | ✅ |

**No material repo-vs-production drift.** The live trigger body is logically
identical to the repo text (differing only in stripped comments and line
endings). The function is SECURITY INVOKER as designed, and the trigger is
enabled — not disabled, which would have made the wall decorative.

### 8.2 Per-candidate rehearsal of the wall

Each check corresponds to a specific deployed constraint or trigger rule. No
looser approximation was used.

| Key | Requirement | Enforced by | Pass |
|---|---|---|---|
| k01 | Both IDs present | — | 192 / 192 |
| k02 | source ≠ target | `..._source_not_self` CHECK | 192 / 192 |
| k03 | Approved source→target relationship | trigger **R2** | 192 / 192 |
| k04 | Source has a non-blank `image_url` | trigger **R3a** | 192 / 192 |
| k05 | Source URL satisfies TCGdex base-path rule | `..._shape` CHECK | 192 / 192 |
| k06 | Target raw `image_url IS NULL` | — | 192 / 192 |
| k07 | Target lacks an effective image | — | 192 / 192 |
| k08 | No override already exists | — | 192 / 192 |
| k09 | Target still in the effective catalog | — | 192 / 192 |
| k10 | Source raw row still exists | `..._source_fk` | 192 / 192 |
| — | **Fully qualified on all ten** | | **192 / 192** |

Two further properties from the same scan:

* **192 distinct source URLs for 192 targets** — no URL is reused, so no two
  canonical cards would receive the same image.
* All five provenance fields are currently `NULL` on every target, so the
  all-or-nothing CHECK is satisfiable in either direction.

### 8.3 Trigger rule R3 — satisfied by construction

R3 requires the override to equal the source's `image_url` **at admission
time**. This is not expressible as a static data check, because it is a property
of *how the write is authored*:

> **Requirement on the activation slice.** The write must `SELECT`
> `cards.image_url` from the source row in the same statement that stores it.
> It must **not** carry literal URL values transcribed from this document. A
> literal list captured today could diverge from live state before the write
> runs, and R3 would reject it — correctly.

**G0-5: PASS.**

---

## 9. G0-6 — active-owned collector impact

### 9.1 Ownership authority used

**Active snapshot canonical `card_id` + force-owned / force-missing overrides.**
No `owned_keys` fallback.

`get_active_snapshot_owned_card_ids()` could not be invoked directly: it derives
its user from `auth.uid()`, which is `NULL` on this connection. The Gate 0 SQL
therefore reproduces the **deployed CAT-2D.1 function body** against the same
tables — active batch → matched rows → `coalesce(canonical_card_id, card_id)` —
then applies the `card_overrides` force-owned / force-missing layer.

Alias resolution here collapses an id onto its canonical survivor **only** where
CAT-2D.2 already admitted the two as the same physical card. No ownership is
inferred across printings or languages.

> **⚠ Correction applied post-merge review, independently re-verified.** The
> first cut of this reproduction filtered `user_import_batches` by
> `status = 'active'` alone, with no `user_id` filter, and read
> `card_overrides` unfiltered. The deployed RPC filters `user_import_batches`
> by `user_id = auth.uid()` and fails closed (an error state) if that one user
> does not have exactly one active batch — the Gate 0 SQL dropped that
> boundary and would silently pool every user's active batch and every user's
> force-owned/force-missing rows instead. This was a methodology/invariant
> defect, not a data defect. `docs/sql/cat-3b1-0-gate0.sql` §G0-6 now derives
> a `target_user` CTE that resolves to the single user_id holding an active
> batch and a `target_batch` CTE that resolves to that user's single active
> batch — both **fail closed to zero rows** (not an unfiltered fallback) if
> ever ambiguous, matching the deployed RPC's own two-level contract
> (`v_active_count = 0` vs `> 1`) rather than relying on the
> `uib_one_active_per_user` unique index alone. `card_overrides` reads are
> scoped to the same resolved user everywhere, the per-set distribution query
> uses the full ownership authority instead of snapshot-only, and a guard
> query reconciles the active-batch user, the active-batch count for that
> user, and the `card_overrides` user set using only counts and booleans — no
> `user_id` is ever projected.
>
> ChatGPT independently re-executed the corrected G0-6 SQL read-only against
> production on 2026-08-20 and confirmed: exactly one active-batch user,
> exactly one active batch for that user, override scope reconciling to that
> same user, and every count in §9.2–§9.4 below reproduced exactly. G0-6 is
> **final PASS**, not provisional.

### 9.2 Live measurements

| Measure | Live value |
|---|---|
| Active snapshot resolved ids | 4,998 |
| Owned ids after force-owned / force-missing | 5,068 |
| Owned ids present in `cards_effective` | 5,053 |
| Owned ids not in the effective catalog | 15 |
| **Active-owned effective cards missing an image** | **122** |
| Active-owned cards with an image | 4,931 |
| CAT-3B.1 candidates that are active-owned | **45** |
| **Active-owned image gaps this activation would fix** | **45 / 122 = 36.9 %** |

### 9.3 How the candidate set meets ownership

| Path | n |
|---|---|
| Candidate is in the active snapshot | 45 |
| Candidate is force-owned | 1 (also in the snapshot) |
| Candidate is force-**missing** | **0** |
| **Candidate is active-owned overall** | **45** |

No candidate is force-missing, so no candidate is excluded by the override
layer. The one force-owned candidate is already in the snapshot and adds nothing.

### 9.4 Per-set distribution

| Target set | Candidates | Active-owned |
|---|---|---|
| `swsh12.5gg` | 70 | 21 |
| `swsh4.5sv` | 122 | 24 |
| **Total** | **192** | **45** |

**G0-6: PASS.**

---

## 10. G0-7 — predicted blast radius

Calculated without writing anything.

| Measure | Predicted |
|---|---|
| `card_extras` rows **inserted** | **190** |
| `card_extras` rows **updated** | **2** (`swsh12.5gg-GG19`, `swsh12.5gg-GG69`) |
| Effective image values expected to change | **192** |
| Effective missing-image count **before** | **1,640** |
| Effective missing-image count **predicted after** | **1,448** |
| Active-owned missing-image count **before** | **122** |
| Active-owned missing-image count **predicted after** | **77** |

### 10.1 Containment

* All 192 changes are `NULL → value`. Because every candidate's effective image
  is currently `NULL` (§6), **no existing image value can be displaced**.
* `public.cards` is not touched. The raw provider-history column keeps its
  1,640 nulls; the change is entirely in the `COALESCE` layer.
* The 192 alias **source** rows are excluded from `cards_effective` by CAT-2D.1
  and remain excluded — they gain and lose nothing.
* Non-alias image gaps (1,448 after) are untouched and remain out of scope.
* On the two updated rows, only the five image fields change.
  `illustrator_override` and `source_note` must be preserved (§7.1).

Note that `raw_missing_image` and `effective_missing_image` are both 1,640
today. That equality is expected, not a coincidence: every excluded alias row
currently *has* an image, so the alias exclusion removes no gaps from the
effective count.

**G0-7: PASS.**

---

## 11. Historical reconciliation

### 11.1 Population — 192 then, 192 now, and for the same reasons

| CAT-3A measurement | Live at Gate 0 | Delta |
|---|---|---|
| 192 approved CAT-2D.2 pairs | **192** | **0** |
| 192/192 with a live retained source asset | **192 / 192** | **0** |
| 1,640 effective-catalog image gaps | **1,640** | **0** |
| 45 candidates among active-owned gaps | **45** | **0** |

The population is unchanged **and independently re-derived**. Nothing was added
to `card_identity_aliases` since CAT-2D.2; no source asset was lost; no target
acquired an image in the meantime.

### 11.2 The one real delta: 117 → 122 active-owned gaps

CAT-3A reported **45 of 117** active-owned missing-image cards. Live measurement
gives **45 of 122**. The numerator is identical; the **denominator** moved.

This is **not** a data change. Ownership inputs have not moved since CAT-3A:

* the active import batch was activated **2026-08-14**, before CAT-3A's
  2026-08-18 run, and is still the active batch;
* the most recent `card_overrides` row was created **2026-08-14**;
* no override has been created since.

The delta is **methodological**, and isolating it is exact:

| Variant | Active-owned missing images |
|---|---|
| v1 — active snapshot, alias-resolved, **alone** | **117** |
| v2 — active snapshot, unresolved | 117 |
| v3 — snapshot ∪ force-owned | 122 |
| v4 — snapshot ∪ force-owned − force-missing (**mandated authority**) | **122** |

**CAT-3A's 117 was the active snapshot alone. It did not include the force-owned
override layer.** The mandated CAT-3B.1 authority does, which adds exactly **5**
force-owned cards that sit outside the snapshot and lack images.

Two consequences worth stating plainly:

1. **Those 5 cards are not CAT-3B.1 candidates.** They are not alias targets, so
   the numerator stays 45. The activation's reach did not shrink; the measured
   size of the problem grew slightly.
2. **The coverage percentage falls, correctly** — from 38.5 % (45/117) to
   36.9 % (45/122). The lower figure is the honest one under the current
   ownership authority.

v1 = v2 = 117 also shows alias resolution does not change this count on its own:
collapsed alias ids are excluded from `cards_effective` regardless.

---

## 12. G0-8 — provenance contract

**Proposed for later review. Neither field is populated by this slice.**

### 12.1 `image_override_approved_by`

```
CAT-3B.1 approved alias image activation — docs/CAT-3B.1_ALIAS_IMAGE_ACTIVATION.md
```

A single constant for the whole population. It names the slice and points at the
document that authorized it. It contains no personal data, and it matches the
form already used by CAT-2D.2's `approved_by`.

### 12.2 `image_override_evidence` — exact JSON shape

```json
{
  "slice": "CAT-3B.1",
  "basis": "cat-2d2-approved-same-printing-alias",
  "alias_slice": "CAT-2D.2",
  "alias_family": "set_rename",
  "alias_approved_at": "2026-08-17T18:57:27.574545+00:00",
  "source_card_id": "swsh12.5-GG01",
  "source_image_url_at_admission": "https://assets.tcgdex.net/en/swsh/swsh12.5/GG01",
  "target_raw_image_url_at_admission": null,
  "gate": "CAT-3B.1 Gate 0",
  "gate_evidence": "docs/sql/cat-3b1-0-gate0.sql"
}
```

Rendered live for all 192 candidates by the final query in
`docs/sql/cat-3b1-0-gate0.sql`, which projects the payload without storing it.

### 12.3 Why this shape

| Requirement | How it is met |
|---|---|
| Traces the CAT-2D.2 relationship | `basis`, `alias_slice`, `alias_family`, `alias_approved_at`, `source_card_id` |
| Traces the CAT-3B.1 approval decision | `slice`, `gate`, `gate_evidence` |
| Deterministic and reviewable | Every field is derived from `card_identity_aliases` and `cards`; the payload can be recomputed and diffed against what was stored, indefinitely |
| No secrets or private data | Only public catalog identifiers and TCGdex asset paths. No user id, no batch id, no ownership data |
| Narrow to this evidence class | Fields describe an approved same-printing alias and nothing else |

`target_raw_image_url_at_admission` records that the target was empty when the
decision was taken — the fact that makes the override additive rather than a
replacement. It is `null` for all 192 today.

**This is not a generic image-provenance framework.** There is no source-type
discriminator, no provider enum, no confidence score, no extensibility hook. A
future non-alias image class must justify its own evidence shape rather than
inherit this one.

**G0-8: PASS.**

---

## 13. Gate disposition

# PASS — recommend activation

All 192 currently approved CAT-2D.2 alias relationships qualify, on every one of
the ten admission keys derived from the deployed CAT-3B wall. The channel is
empty. Production matches the repo. The population is unchanged from CAT-3A and
was independently re-derived rather than recalled. The single numeric difference
from CAT-3A — 117 → 122 active-owned gaps — is fully explained as a deliberate
change of ownership authority, affects only the denominator, and is documented
in §11.2.

**No reduction in population was necessary**, so this is not
`PASS WITH REDUCED POPULATION`.

> **This disposition does not authorize a write.** It is a recommendation that a
> CAT-3B.1 activation slice be separately proposed, reviewed and approved.

### 13.1 Requirements any activation slice must carry

1. **Derive, do not transcribe.** Select `cards.image_url` from the source row
   in the writing statement itself. No literal URL lists (§8.3).
2. **Preserve CAT-1 enrichment.** `swsh12.5gg-GG19` and `swsh12.5gg-GG69` must
   be updated in place, touching only the five image fields (§7.1).
3. **Re-verify immediately before writing.** Gate 0 evidence is a snapshot of
   2026-08-20; the write must re-check admission at execution time.
4. **Expect 190 inserts and 2 updates**, and 192 effective image changes,
   all `NULL → value` (§10).
5. **Do not touch `public.cards`**, the CAT-3B schema, RLS, ACL, frontend code,
   sync code, or the 1,448 non-alias gaps.

### 13.2 Correction record (did not change the disposition)

§9.1 records a G0-6 methodology defect found in post-merge review: the
ownership reproduction was missing the deployed RPC's per-user and
per-batch boundary. `docs/sql/cat-3b1-0-gate0.sql` was corrected to fail
closed to a single resolved user with a single resolved active batch,
matching the deployed RPC's own two-level contract. ChatGPT independently
re-executed the corrected SQL read-only against production on 2026-08-20 and
confirmed every recorded count is unchanged. The disposition above is
confirmed, not merely expected, to be unaffected.

---

## 14. Scope containment

**Not done, deliberately:**

* no image overrides created;
* no activation write authored or executed;
* `public.cards` unmodified;
* CAT-3B schema, RLS and ACL unmodified;
* frontend and sync code unmodified;
* catalog sync **remains paused**;
* non-alias image gaps untouched;
* CAT-3A not reopened;
* no cross-language or cross-printing image proxy introduced;
* no generic image-provenance framework created.

**Unrelated known failure:** `ol0c-import-snapshot.test.mjs` expects 33 where
the current allowlist count is 34. Explicitly out of scope and **not touched**.
It was not encountered during this slice — no test run was required, because
this slice changes no runtime code.

---

## 15. Next checkpoint

Gate 0 is complete and ready for the write / no-write decision. Independent
ChatGPT review is required before any activation slice or production write.

### 15.1 G0-6 user/batch-scoping correction — independently re-confirmed

The user- and batch-scoping correction in §9.1/§13.2 was applied to
`docs/sql/cat-3b1-0-gate0.sql` and independently re-executed read-only
against production by ChatGPT on 2026-08-20. Confirmed:

* `target_user_resolved = 1` and `target_batch_resolved = 1` in the main
  G0-6 query (proves both fail-closed CTEs resolved, not empty);
* `single_active_user_confirmed = true`, `single_active_batch_confirmed = true`
  and `active_and_override_user_scopes_reconcile = true` in the guard query;
* the counts in §9.2–§9.4 above (4,998 / 5,068 / 5,053 / 122 / 45 / 36.9%,
  v1/v2/v3/v4 = 117 / 117 / 122 / 122, forced-owned-only missing-image = 5,
  and the 21 / 24 per-set split) are unchanged.

No outstanding re-run remains for G0-6.

Roadmap intent, unchanged by this slice:

**CAT-3B.1 activation → close catalog image work → NAV-1 → SEC-0 → AUTH-1 → BETA-0**
