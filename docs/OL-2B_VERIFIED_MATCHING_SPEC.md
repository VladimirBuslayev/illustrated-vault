# OL-2B — Verified Matching Recovery — Specification

**Status:** DRAFT SPEC — pre-implementation
**Prepared as of:** 2026-07-15
**Document version:** 0.2 (revised for independent technical review)
**Predecessor:** OL-2A (CLOSED)
**Successor:** CAT-0 — Multilingual Catalog Investigation
**Proposed matcher version bump:** `ol0c-1` → `ol2b-1`

> This specification defines behavior only. It contains no implementation code.
> Implementation is gated on the readiness assessment in §15.
>
> Revision note (0.2): corrections applied from independent review — (a) the
> language guard is clarified as matcher-level and constrained so it cannot silently
> remove a valid existing OL-0A recovery; (b) alias validation is reframed around
> source-row ambiguity rather than catalog uniqueness; (c) ownership acceptance
> criteria now permit legitimate snapshot-ownership change for recovered rows while
> keeping `owned_keys`, overrides, and pre-existing snapshot matches fixed. Scope and
> architecture are unchanged.

---

## 1. Problem statement

The `ol0c-1` matcher leaves 670 of 5,969 stored rows unresolved on the pinned OL-2A
batch. A meaningful subset of those rows are unresolved for **recoverable and
demonstrably safe** reasons — chiefly English source sets whose Collectr label differs
cosmetically from the catalog set name (`set_not_in_catalog`), and English rows whose
name+number resolves uniquely once the correct set is known.

OL-2B recovers **only** rows whose physical printing identity remains provable after
recovery, using curated evidence-backed English set aliases and exact row-level
recovery. It must not raise the matched percentage by collapsing distinct printings,
must exclude non-English rows from generic recovery, and must remain fully
deterministic. Correctness of the collector's physical printing outranks match rate.

---

## 2. In-scope recovery classes

OL-2B may resolve a currently-unresolved row **only** through one of the following, and
only when the result is a single agreed canonical card ID:

### R1 — Curated English set alias (allowlist expansion)

A new entry in the frozen set-name allowlist (`src/constants/ol0aAllowlist.js`) mapping
an English Collectr label to an English catalog set. Recovery reuses the **existing**
`set_alias` machinery in `snapshotMatcher.js` (`ALIAS_MAP` → `resolveUnder(useAlias)`).
No new matcher code path is required for R1; it is a governed data addition plus its
validation.

An R1 alias may be added **only** when all of the following hold for that alias, using a
freshly recomputed complete candidate universe (§5, and validation plan §7):

1. The Collectr label and target set are both English.
2. The target set exists in the catalog (`catSetNorms`).
3. Under the alias, every affected source row that resolves does so to **exactly one**
   catalog card via the existing name+set+number path (optionally with the existing
   leading-zero and paren-stripped variants).
4. No affected row is a language-marked row (§6) or a prohibited product bucket (§7).
5. Adding the alias does not turn any **previously-unique source-row resolution** into a
   multi-candidate resolution, and does not change the canonical ID of any currently
   matched row (§5.5).

### R2 — Exact row-level recovery (demonstrably safe identity)

A specific unresolved row is resolved when it produces exactly one full name+set+number
candidate **after** an approved R1 alias (or an already-frozen OL-0A2b alias) is
applied, and that candidate survives the existing agreement requirement across all
active strategies. R2 is not a new fallback tier; it is the observed consequence of R1
under the unchanged agreement-required resolution already in `combinedResolve`.

### R3 — Explicit review of the four matched JP rows

OL-2B must add a pinned regression fixture asserting the current match status and
canonical IDs of Amoonguss (JP), Emboar (JP), Servine (JP), Victini (JP). OL-2B does
**not** un-match them (see §6.4) — it freezes them so no OL-2B change silently alters
their disposition, and formally hands their correctness decision to CAT-0.

---

## 3. Exact exclusions (out of scope)

OL-2B must not include any of the following:

- Global name+number fallback (any tier).
- "First candidate wins" / priority-based resolution.
- Resolution from the stored capped `candidate_card_ids`.
- Cross-language canonicalization (JP/CN/KR → English).
- Product-bucket-to-single-set aliases (§7).
- Schema changes, unless later proven unavoidable (§8.2).
- RPC changes.
- `statement_timeout` / timeout changes.
- Ownership-path convergence (`owned_keys` ↔ snapshot).
- Any `owned_keys` read, write, or interpretation.
- Any change to manual ownership overrides.
- Image fallback implementation (OL-2C).
- Multilingual catalog ingestion or a catalog language field (CAT-0).
- A broad matcher rewrite. OL-0A2b baseline logic and frozen normalizers stay intact.
- Removing, re-scoring, or changing the canonical ID of any currently-matched row
  (including the 4 JP rows).

---

## 4. Proposed matching decision order

The order below is the **current** matcher flow with two guards inserted and the alias
map enriched. Baseline tiers and the agreement requirement are unchanged.

```
For each source row r:

1. gate(r)                         [UNCHANGED]
     → non_pokemon | watchlist_only | invalid_quantity | invalid_missing | eligible

2. language-marker detection       [NEW — §6]
     → compute languageMarked(r) from raw source fields, before normalization strips it
     → does NOT change disposition; sets a flag consumed only in recovery (steps 6–7)

3. classifyEligible(src, ix)       [UNCHANGED]
     → Tier 1 exact name+set+number (unique ⇒ matched; multi ⇒ ambiguous)
     → else diagnostic ambiguous/unmatched reason

4. if matched at baseline          [UNCHANGED]
     → store matched; STOP  (the 4 JP rows matched here and are preserved)

5. product-bucket guard            [NEW — §7]
     → if normSet(src.set) ∈ PROHIBITED_BUCKETS: skip all alias recovery for r;
       fall through to baseline disposition (ambiguous/unmatched)

6. language guard on recovery      [NEW — §6, matcher-level]
     → if languageMarked(r): skip all OL-2B alias/LZ recovery for r;
       fall through to baseline disposition
     → constraint: this must be shown NOT to remove any recovery the frozen ol0c-1
       matcher already produced for that row (§6.3)

7. combinedResolve(src, ix)        [UNCHANGED LOGIC, enriched ALIAS_MAP]
     → strategies: [alias], [LZ], [alias+LZ]
     → all successful strategies must agree on ONE card id, else unresolved
     → minimal-transform winner; composeRule
     → the ONLY change here is that ALIAS_MAP now also contains approved R1 aliases

8. else store baseline disposition [UNCHANGED]
```

Guards run **before** recovery and never override a baseline exact match. This
preserves every currently-matched row (§10 criterion A5) and confines OL-2B's effect to
rows that are currently unresolved, English, and non-bucket — subject to the §6.3
constraint that no existing recovery is lost.

---

## 5. Alias governance model

### 5.1 Alias tiers

Every candidate alias is placed in exactly one of three tiers. Only Tier A ships.

**Tier A — Approved for implementation:** English↔English, target set present in
catalog, and **row-level evidence** (per §2 R1, evaluated against a recomputed complete
candidate universe) demonstrates unique resolution for all affected rows with no
source-row ambiguity regression and no change to any currently-matched canonical ID.

**Tier B — Requires row-level evidence:** credible at the naming level but not yet
validated per-row against the recomputed candidate universe. Must not ship until
promoted to Tier A by the validation plan.

**Tier C — Prohibited:** product buckets that span multiple sets, and any cross-language
or cross-release correspondence.

### 5.2 Current alias disposition

At spec time, **no alias is Tier A.** The eight surfaced English aliases below are all
**Tier B** until the OL-2B validation plan produces per-alias row-level evidence from an
uploaded catalog snapshot:

| Collectr label | Candidate catalog set | Tier |
|---|---|---|
| Sword & Shield Base Set | Sword & Shield | B |
| EX Dragon Frontiers | Dragon Frontiers | B |
| EX Holon Phantoms | Holon Phantoms | B |
| Mega Evolution Promos | MEP Black Star Promos | B |
| McDonald's Promos 2024 | McDonald's Collection 2024 | B |
| WoTC Promo | Wizards Black Star Promos | B |
| Black and White Promos | BW Black Star Promos | B |
| Nintendo Promos | Nintendo Black Star Promos | B |

**Tier C (prohibited, never aliased one-to-one):** Prize Pack Series One; Trick or
Trade BOOster Bundles; Deck Exclusives; Miscellaneous Cards & Products; Jumbo Cards;
World Championship Decks; Trainer Kits. Plus all OL-0A2b-deferred cross-language /
cross-release mappings (e.g. Ninja Spinner → Chaos Rising).

### 5.3 Promotion rule

A Tier B alias becomes Tier A **only** when the validation plan records, for that alias,
against a recomputed complete candidate universe: the count of affected source rows,
proof each resolving row resolves to exactly one catalog card, proof no previously-unique
source-row resolution becomes multi-candidate, and proof no currently-matched canonical
ID changes. Promotion is per-alias; partial approval is allowed.

### 5.4 Frozen allowlist discipline

The existing 33-entry OL-0A2b allowlist is frozen and unchanged. OL-2B **appends** only
Tier A entries and marks them distinctly (an `ol2b` provenance tag on new rows, if the
allowlist structure permits without a breaking change). Existing entries are never
edited.

### 5.5 Alias evaluation is source-row-centric, not catalog-centric

Aliases are validated by their effect on **source-row resolution**, using a freshly
recomputed complete candidate universe — not by any claim about catalog uniqueness. A
proposed alias is evaluated for whether it:

- resolves each affected source row to exactly one canonical card, and
- leaves every previously-unique source-row resolution still unique (no row that
  resolved to one card before now resolves to several), and
- changes no currently-matched row's canonical ID.

OL-2B does not describe or modify catalog-level uniqueness. Its only lens is what a
source row resolves to before vs. after the alias.

---

## 6. Cross-language guard

### 6.1 Purpose and scope

Prevent OL-2B recovery from pulling JP/CN/KR-marked source rows toward English catalog
cards. The guard is implemented **at the matcher level**, which means it sits in the
same resolution path used by existing OL-0A / OL-0A2b recovery, not only the new OL-2B
aliases. Because of that placement, it must be constrained so it never silently removes
a recovery the frozen matcher already produces (§6.3).

### 6.2 Detection

`languageMarked(r)` inspects the **raw source fields** (product name and set label) for
explicit language markers *before* the frozen normalizers run, because normalization may
strip the marker (this is exactly how paren-stripped name variants currently expose JP
rows to English recovery). Markers to detect are enumerated from the real export — at
minimum trailing `(JP)` / `(CN)` / `(KR)` tokens and explicitly non-English set labels.
The exact marker set is finalized against the uploaded export during validation and
stored as a small, reviewable constant.

A language-marked row is excluded from **OL-2B alias/leading-zero recovery** (steps 6–7
of §4) and retains its baseline disposition — subject to §6.3.

### 6.3 No silent removal of existing OL-0A recovery (required)

Because the guard is matcher-level, implementation must first, for every
language-marked row in the pinned batch:

1. classify the row under the **frozen `ol0c-1` matcher** (guard disabled), and
2. record which existing strategy, if any, produced its disposition (baseline exact,
   `set_alias`, `leading_zero`, combined, or none).

The guard may only exclude a language-marked row from recovery where doing so does
**not** remove a disposition the frozen matcher already produced. If a language-marked
row currently receives a valid recovery under `ol0c-1`, the guard must not silently drop
it: any such row is surfaced as explicit evidence and its disposition is **frozen for
CAT-0**, not changed by OL-2B. In other words, OL-2B may prevent *new* JP/CN/KR recovery
but must not regress *existing* dispositions without explicit, reviewed evidence.

### 6.4 The four already-matched JP rows

These matched at **baseline** (step 4), not via recovery, so the recovery guard does not
touch them. OL-2B does **not** un-match them: the catalog has no language field, their
correct target cannot be proven, and forcing them unmatched would change existing
working behavior and pre-empt CAT-0. OL-2B pins them in a regression fixture (§2 R3),
records them as a known correctness risk, and hands the decision to CAT-0. A test asserts
their status and IDs are unchanged.

> **Open dependency:** whether the baseline exact-match path should itself gate on
> `languageMarked` is a CAT-0 question requiring a catalog language field. It is
> explicitly deferred.

---

## 7. Product-bucket guard

`PROHIBITED_BUCKETS` is a normalized set of source labels that legitimately span
multiple catalog sets. A row whose `normSet(src.set)` is in this set is excluded from
**all** OL-2B alias recovery and falls through to its baseline disposition, even if it
appears to have a unique candidate. Initial membership (normalized):

- Prize Pack Series One
- Trick or Trade BOOster Bundles
- Deck Exclusives
- Miscellaneous Cards & Products
- Jumbo Cards
- World Championship Decks
- Trainer Kits

The guard is a denylist independent of the alias allowlist; a bucket can never be
rescued by an alias entry. Row-level treatment of bucket contents is out of OL-2B scope.

---

## 8. Provenance requirements

### 8.1 Batch-level provenance (primary, no schema change)

Bump `MATCHER_VERSION` to `ol2b-1`. Because `matcher_version` is stored per batch in
`user_import_batches`, every row decided under OL-2B is attributable to the OL-2B policy
without any per-row schema change. This is the primary provenance mechanism.

### 8.2 Row-level provenance (existing `match_rule` only)

Recovered rows continue to use the **existing** bounded `match_rule` vocabulary:
`exact`, `exact_paren_stripped`, `set_alias`, `set_alias_paren_stripped`,
`leading_zero`, `leading_zero_paren_stripped`, `set_alias_leading_zero`,
`set_alias_leading_zero_paren_stripped`. R1 recoveries emit `set_alias`-family values —
identical to OL-0A2b aliases — so **no new `match_rule` value and no schema/CHECK change
is required.** Combined with the `ol2b-1` batch version, this is sufficient provenance.

> A distinct per-row provenance value (e.g. `set_alias_ol2b`) is **explicitly avoided**
> because it would risk a `match_rule` CHECK-constraint change in
> `ol-0b-1-user-import-snapshots.sql`, which the boundary prohibits unless later proven
> unavoidable. Any per-row OL-2B tag is a separate, schema-gated decision.

### 8.3 Allowlist provenance

New Tier A allowlist entries carry an inline provenance marker (`ol2b`) in the source
constant if the allowlist structure accepts an added field non-breakingly. If it does
not, provenance is carried by git history plus the `ol2b-1` matcher version, and no
allowlist shape change is made.

---

## 9. Failure behavior

- **Agreement required.** If active strategies disagree on the canonical card, the row
  stays unresolved. Unchanged from `ol0c-1`.
- **Fail closed to baseline.** Any row not recovered under R1/R2 retains its exact
  baseline `match_status` and `match_reason`.
- **Guards fail safe.** If language detection or bucket detection is uncertain, the row
  is treated as excluded from recovery (kept unresolved) rather than recovered — except
  where §6.3 shows an existing recovery must be preserved and frozen.
- **Deterministic.** Identical input export + identical catalog snapshot ⇒ identical
  output, including identical `match_rule` labels and identical counts.
- **No partial-catalog matching.** The existing `catalogIndexLoader` fail-closed
  completeness check is preserved.
- **Invalid rows preserved.** The 17 invalid-row rejections are unchanged.

---

## 10. Acceptance criteria

- **A1.** Every OL-2B-recovered row resolves to exactly one canonical card via the
  existing agreement-required path.
- **A2.** No currently-unresolved language-marked row is newly recovered by OL-2B.
- **A3.** No prohibited product bucket is recovered via a single-set alias.
- **A4.** Against a recomputed complete candidate universe, no alias turns a
  previously-unique source-row resolution into a multi-candidate resolution, and no
  alias changes the canonical ID of any currently-matched row.
- **A5.** All 5,299 currently-matched rows retain their exact canonical IDs and
  `match_rule` values (including the 4 JP rows).
- **A6.** Recovered counts by rule match the validation plan's per-alias projections
  exactly.
- **A7.** No schema change, no RPC change, no timeout change, no `owned_keys` access,
  no change to manual ownership overrides.
- **A8.** `match_rule` values remain within the existing bounded vocabulary.
- **A9.** Deterministic rerun produces byte-identical stored output.
- **A10 (ownership).** `owned_keys` behavior is unchanged; manual overrides are
  unchanged; pre-existing snapshot matches are unchanged. D9 is **rerun** after OL-2B,
  and every snapshot-ownership delta reconciles **exactly** to an approved OL-2B
  recovery. OL-2B performs no ownership-path convergence. The pre-OL-2B D9 figures
  (1,210 / 220 / 74 / 294) are **not** required to remain frozen.
- **A11.** Reconciliation (D1-equivalent) passes exactly on the OL-2B output.
- **A12.** No language-marked row loses a disposition the frozen `ol0c-1` matcher
  already produced (§6.3); any such row is surfaced and frozen for CAT-0.

---

## 11. Expected files touched

| File | Change |
|---|---|
| `src/constants/ol0aAllowlist.js` | Append Tier A aliases only; existing 33 entries frozen. |
| `src/services/snapshotMatcher.js` | Add `languageMarked` detection + `PROHIBITED_BUCKETS` guard; insert guards ahead of recovery; bump `MATCHER_VERSION` to `ol2b-1`. Baseline tiers and agreement logic unchanged. |
| `scripts/ol0c-import-snapshot.test.mjs` *(or a new `ol2b-*` test file)* | Add OL-2B fixtures: recovered-row assertions, JP/CN exclusion + no-lost-existing-recovery, bucket exclusion, 4-JP-row freeze, D9 rerun reconciliation, deterministic rerun. |
| `docs/OL-2A_CLOSEOUT.md` | Revised (this pass). |
| `docs/OL-2B_VERIFIED_MATCHING_SPEC.md` | Revised (this file). |
| `docs/OL-2B_VALIDATION_PLAN.md` | Revised (this pass). |
| `CURRENT_STATE.md` | Owned Library section updated at closeout, **after** validation passes. |

Not touched: `catalogIndexLoader.js`, `importSnapshotService.js`, any RPC, any SQL
migration, `App.jsx`, `owned_keys`, ownership overrides, image services.

---

## 12. Explicit non-goals

- Maximizing match rate.
- Resolving JP/CN/KR printings.
- Fixing the 4 matched JP rows (frozen for CAT-0).
- Repairing missing images or `image_url` gaps.
- Converging `owned_keys` and snapshot ownership.
- Building or changing any Owned Library UI.
- Introducing a catalog language field or multilingual ingestion.
- Any product-bucket row-level enumeration.

---

## 13. Rollback approach

OL-2B is a pure, deterministic, additive matcher-policy change with no schema or RPC
surface, so rollback is clean:

1. **Code rollback.** Revert the `snapshotMatcher.js` and `ol0aAllowlist.js` changes and
   restore `MATCHER_VERSION` to `ol0c-1`. New imports again decide under `ol0c-1`.
2. **Data safety.** No existing stored batch is mutated by OL-2B. Snapshots decided
   under `ol2b-1` remain valid and are attributable by their stored `matcher_version`;
   a user re-imports to obtain an `ol0c-1` snapshot again if desired.
3. **No destructive step.** No table rename, no backfill, no in-place row rewrite. The
   OL-0B activation/supersession lifecycle preserves the prior active snapshot until a
   replacement activates.
4. **Verification.** After rollback, the deterministic rerun test reproduces the
   `ol0c-1` baseline counts from §2 of the closeout.

---

## 14. Determinism and preservation guarantees

- Frozen normalizers (`normName`/`normNum`/`normSet` in `keys.js`) are reused unchanged.
- OL-0A2b baseline classifier and combined-resolution agreement logic are unchanged.
- Leading-zero equivalence semantics are unchanged.
- The six-candidate storage cap and its descriptive-only status are unchanged.
- The existing bounded `match_rule` vocabulary is unchanged.
- No existing OL-0A recovery is dropped without explicit, reviewed evidence (§6.3).

---

## 15. Implementation readiness

**NOT READY — EVIDENCE REQUIRED.** No alias is currently Tier A, and the two new
constraints introduced by this revision — the §6.3 "no silent removal of existing OL-0A
recovery" check and the §5.5 source-row-ambiguity evaluation — both require the frozen
catalog snapshot and the frozen normalizers to execute. The exact required files are
listed in the accompanying response and the validation plan. Implementing now would
require inventing catalog/normalizer/schema behavior, which the working boundary
prohibits.

---

*Illustrated Vault — Owned Library initiative. Behavior-only specification; no
implementation code authorized by this document.*
