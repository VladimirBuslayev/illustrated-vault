# OL-2B — Verified Matching Recovery — Specification

**Status:** APPROVED — READY FOR IMPLEMENTATION
**Prepared as of:** 2026-07-15
**Document version:** 1.0 (final; evidence confirmed against the complete current catalog)
**Predecessor:** OL-2A (CLOSED)
**Successor:** CAT-0 — Multilingual Catalog Investigation
**Matcher version bump:** `ol0c-1` → `ol2b-1`

> Behavior-only specification. No implementation code. The offline evidence gate
> (validation plan) is fully passed; the production smoke test runs at implementation.
>
> Revision note (1.0): the complete current `cards_effective` export (23,604 rows) was
> validated. It reproduces the approved OL-2A baseline exactly (zero drift) and confirms
> the McDonald's Promos 2024 alias. That alias is promoted from provisional to
> **approved Tier A**; the allowlist count amendment `33 → 34` is now authorized. All six
> owner decisions are incorporated. Scope is unchanged from v0.3 (one alias, language
> guard, product-bucket runtime guard deferred).

---

## 1. Problem statement

The `ol0c-1` matcher leaves 670 of 5,969 stored rows unresolved on the pinned OL-2A
batch. A small subset are unresolved for demonstrably safe, English-only reasons —
chiefly a Collectr set label that differs cosmetically from the catalog set name. OL-2B
recovers only such rows, via a curated evidence-backed English set alias, and only when
the physical printing identity remains provable. Correctness of the collector's physical
printing outranks match rate.

---

## 2. In-scope recovery classes

OL-2B may resolve a currently-unresolved row **only** through the following, and only
when the result is a single agreed canonical card ID:

### R1 — Curated English set alias (allowlist expansion)

A new entry in the frozen set-name allowlist (`src/constants/ol0aAllowlist.js`) mapping
an English Collectr label to an English catalog set. Recovery reuses the **existing**
`set_alias` machinery in `snapshotMatcher.js` (`ALIAS_MAP` → `resolveUnder(useAlias)`).
No new matcher code path is required for R1; it is a governed data addition plus the
accompanying allowlist integrity-assertion amendment (§8.3).

An R1 alias may be added **only** when all of the following hold, evaluated against a
freshly recomputed complete candidate universe from the complete current
`cards_effective` catalog:

1. The Collectr label and target set are both English.
2. The target set exists in the catalog.
3. Every affected source row that resolves does so to exactly one catalog card via the
   existing name+set+number path (optionally with leading-zero and paren-stripped
   variants).
4. No affected row is language-marked (§6) or a prohibited product bucket (§7).
5. Adding the alias turns no previously-unique source-row resolution into a
   multi-candidate resolution, and changes no currently-matched canonical ID.
6. The Collectr label is **not** an OL-0A2b rejected or deferred label (§5.4). OL-2B does
   not reopen those decisions.

### R2 — Exact row-level recovery (consequence of R1)

A specific unresolved row is resolved when, after an approved R1 alias is applied, it
produces exactly one full name+set+number candidate that survives the existing agreement
requirement in `combinedResolve`. R2 is not a new tier; it is the observed consequence of
R1 under unchanged resolution logic.

### R3 — Explicit review of the four matched JP rows

OL-2B adds a pinned regression fixture asserting the current match status and canonical
IDs of the four JP rows (§6.4). OL-2B does **not** un-match them; it freezes them for
CAT-0.

---

## 3. Exact exclusions (out of scope)

- Global name+number fallback (any tier).
- "First candidate wins" / priority-based resolution.
- Resolution from the stored capped `candidate_card_ids`.
- Cross-language canonicalization (JP/CN/KR → English).
- Reopening any OL-0A2b rejected or deferred alias.
- Product-bucket-to-single-set aliases (§7) — permanently prohibited in OL-2B.
- Product-bucket **runtime guard** — deferred out of OL-2B (§7).
- Schema changes, unless later proven unavoidable (§8.2).
- RPC changes; timeout changes.
- Ownership-path convergence; any `owned_keys` access; any manual-override change.
- Image fallback (OL-2C); multilingual catalog ingestion / language field (CAT-0).
- A broad matcher rewrite; baseline classifier and frozen normalizers stay intact.
- Removing, re-scoring, or changing the canonical ID of any currently-matched row.

---

## 4. Matching decision order

Current matcher flow with **one** guard inserted (language, recovery-scoped) and the
alias map enriched by exactly one entry. Baseline tiers and the agreement requirement are
unchanged. The product-bucket runtime guard is deferred (§7).

```
For each source row r:

1. gate(r)                         [UNCHANGED]
2. language-marker detection       [NEW — §6] from RAW fields, before normalization; flag only
3. classifyEligible(src, ix)       [UNCHANGED] Tier-1 exact NSN; else diagnostic reason
4. if matched at baseline          [UNCHANGED] store; STOP (the 4 JP rows match here)
5. (product-bucket runtime guard DEFERRED — not implemented in OL-2B; §7)
6. language guard on recovery      [NEW — §6] if languageMarked(r): skip OL-2B recovery; keep baseline
                                    constraint: removes no recovery ol0c-1 already produced (§6.3)
7. combinedResolve(src, ix)        [UNCHANGED LOGIC, ALIAS_MAP +1] agreement-required; else unresolved
8. else store baseline disposition [UNCHANGED]
```

---

## 5. Alias governance model

### 5.1 Alias classes in OL-2B

- **Tier A (ships):** English↔English, target set present in the current catalog,
  row-level evidence proves unique resolution with no source-row ambiguity regression and
  no matched-ID change, and the label is not an OL-0A2b rejected/deferred label.
- **Governance-blocked (does not ship, not reconsidered here):** any OL-0A2b rejected or
  deferred label. Frozen decisions; the allowlist integrity assertion throws if they are
  added. Reconsideration requires a dedicated allowlist-reopening slice with the OL-0A2b
  rationale (`ol0a2-report.json`), not OL-2B.
- **Already-live (no action):** labels already present in the frozen 33-entry allowlist.

### 5.2 Disposition of the eight audit-surfaced labels (verified against the repo file)

| Collectr label | Candidate target | OL-2B disposition |
|---|---|---|
| McDonald's Promos 2024 | McDonald's Collection 2024 | **Tier A — APPROVED** (§5.3) |
| EX Holon Phantoms | Holon Phantoms | **Already-live** (in frozen allowlist; not a candidate) |
| Sword & Shield Base Set | Sword & Shield | **Governance-blocked** — OL-0A2b **rejected** |
| EX Dragon Frontiers | Dragon Frontiers | **Governance-blocked** — OL-0A2b **rejected** |
| Mega Evolution Promos | MEP Black Star Promos | **Governance-blocked** — OL-0A2b **rejected** |
| Nintendo Promos | Nintendo Black Star Promos | **Governance-blocked** — OL-0A2b **rejected** |
| WoTC Promo | Wizards Black Star Promos | **Governance-blocked** — OL-0A2b **deferred** |
| Black and White Promos | BW Black Star Promos | **Governance-blocked** — OL-0A2b **deferred** |

Exactly **one** label ships in OL-2B: McDonald's Promos 2024. It is the direct
year-sibling of the already-approved `McDonald's Promos 2022 → McDonald's Collection 2022`
entry.

### 5.3 Confirmed evidence for McDonald's Promos 2024 (complete current catalog, 23,604 rows)

- Target set `McDonald's Collection 2024` present in the catalog.
- 9 affected source rows: 8 eligible (unmatched at baseline) + 1 watchlist-only
  (correctly gated out).
- All 8 eligible rows resolve to **exactly one** `2024sv-*` card via
  `set_alias_leading_zero`: 2024sv-4, -5, -8, -11, -12 (×2), -14, -15.
- Candidate uniqueness: 8/8 (0 multi-candidate). Conflicts: 0. Regressions
  (matched→unresolved): 0. Matched-ID changes: 0. All `match_rule` values within the
  bounded vocabulary. Deterministic rerun: byte-identical.
- No affected row is language-marked or a product bucket; English↔English.

**Before/after (confirmed):** matched **5,299 → 5,307** (ΣR = 8), unmatched **486 → 478**,
ambiguous 167, invalid 17, stored 5,969 — all unchanged otherwise; conflicts 0.

### 5.4 Frozen allowlist discipline and the count amendment (authorized)

`ol0aAllowlist.js` runs a load-time integrity assertion that throws unless the array has
exactly the declared number of entries and unless no deferred/rejected label appears.
McDonald's Promos 2024 is **not** in the deferred/rejected lists, so the exclusion
assertion continues to pass. Adding the single Tier A entry requires amending the
assertion count `33 → 34` and `OL0A_ALLOWLIST_META.allowlistCount`, adding an inline
`ol2b` provenance marker on the new entry, and a header amendment recording the one-entry
OL-2B extension of the OL-0A2b-frozen set. This is the sole controlled edit to the frozen
file and is now authorized by the confirmed evidence.

### 5.5 Source-row-centric alias evaluation

Aliases are validated by their effect on source-row resolution, using a recomputed
complete candidate universe — never by any claim about catalog uniqueness.

---

## 6. Cross-language guard (retained as specified)

### 6.1 Purpose and scope

Prevent OL-2B recovery from pulling JP/CN/KR-marked source rows toward English catalog
cards. Implemented at the matcher level, in the same resolution path as existing
OL-0A/0A2b recovery, so it must not silently remove a recovery the frozen matcher already
produces (§6.3).

### 6.2 Detection

`languageMarked(r)` inspects the **raw** source fields before the frozen normalizers run
— necessary because `normName` erases a trailing `(JP)` in the paren-stripped variant
(the exact path by which the four JP rows currently match). Marker set fixed from the
batch: trailing `(JP)` / `(CN)` product-name tokens and `"…(Japanese/Chinese/Korean)"`
set labels. (No `(KR)` in the current batch; the detector still covers it.)

### 6.3 No silent removal of existing OL-0A recovery (empirically satisfied)

Verified on the current batch: of 238 language-marked Pokémon rows, **zero** are recovered
by any existing strategy (`set_alias`/`leading_zero`); the only 4 matched language-marked
rows match at **baseline exact** (`exact_paren_stripped`). The recovery-scoped guard
therefore removes nothing `ol0c-1` produces. Any future exception must be surfaced and
frozen for CAT-0, never dropped.

### 6.4 The four already-matched JP rows

Confirmed on the current catalog, matched at baseline and preserved:

| Row | ID | Set |
|---|---|---|
| Amoonguss (JP) | `sv10.5b-096` | Black Bolt |
| Servine (JP) | `sv10.5b-002` | Black Bolt |
| Victini (JP) | `sv10.5b-012` | Black Bolt |
| Emboar (JP) | `sv10.5w-013` | White Flare |

They match at baseline (step 4), so the recovery guard does not touch them, and no
additional rows require freezing (exactly four). OL-2B pins them in a regression fixture
and hands their correctness to CAT-0.

---

## 7. Product buckets — prohibited; runtime guard deferred

Product buckets that span multiple catalog sets (Prize Pack Series One; Trick or Trade
BOOster Bundles; Deck Exclusives; Miscellaneous Cards & Products; Jumbo Cards; World
Championship Decks; Trainer Kits) remain **permanently prohibited from single-set
aliasing.** They are OL-0A2b-rejected labels; the allowlist integrity assertion already
prevents them from being aliased.

Because OL-2B adds no product-bucket alias, a runtime product-bucket guard would be inert
(verified: no bucket row recovers, no bucket alias exists). Per owner decision, the
**runtime guard is deferred out of OL-2B**; the prohibition is retained here and enforced
statically by the allowlist assertion. A runtime guard may be reconsidered only in a
dedicated future slice.

---

## 8. Provenance requirements

### 8.1 Batch-level provenance (primary, no schema change)

Bump `MATCHER_VERSION` to `ol2b-1`. `matcher_version` is `text not null` with no CHECK
constraint (verified), so `ol2b-1` is accepted with no migration.

### 8.2 Row-level provenance (existing `match_rule` only)

`match_rule` has no enumeration CHECK constraint (verified: only `match_rule text` and the
null/not-null `uir_status_shape`). The Tier A alias emits only existing bounded values
(`set_alias_leading_zero`), so no new `match_rule` value and no schema change is required.

### 8.3 Allowlist provenance and the count amendment (authorized)

At implementation, `ol0aAllowlist.js` is amended by exactly: appending
`{ collectrLabel: "McDonald's Promos 2024", catalogSet: "McDonald's Collection 2024" }`;
changing the integrity assertion `33 → 34`; updating `OL0A_ALLOWLIST_META.allowlistCount`
`33 → 34`; adding an inline `ol2b` provenance marker on the new entry; and amending the
file header to record the one-entry OL-2B extension.

---

## 9. Failure behavior

Agreement required (disagreement ⇒ unresolved); fail closed to baseline; guard fails safe;
deterministic; no partial-catalog matching (completeness check preserved); 17 invalid-row
rejections unchanged.

---

## 10. Acceptance criteria

- **A1.** Every recovered row resolves to exactly one canonical card via the agreement-
  required path. *(Confirmed: 8/8.)*
- **A2.** No currently-unresolved language-marked row is newly recovered. *(Confirmed.)*
- **A3.** No product-bucket label is present as an allowlist key. *(Static check.)*
- **A4.** Against the recomputed complete candidate universe, no alias turns a
  previously-unique source-row resolution into multi-candidate, and none changes a
  currently-matched canonical ID. *(Confirmed: 0 regressions, 0 ID changes.)*
- **A5.** All currently-matched rows retain exact canonical IDs and `match_rule` values,
  including the 4 JP rows. *(Confirmed.)*
- **A6.** Recovered counts by rule match the validation projection exactly. *(Confirmed:
  `set_alias_leading_zero` × 8.)*
- **A7.** No schema/RPC/timeout change, no `owned_keys` access, no manual-override change.
- **A8.** `match_rule` values within the bounded vocabulary. *(Confirmed.)*
- **A9.** Deterministic rerun byte-identical. *(Confirmed.)*
- **A10 (ownership).** `owned_keys`, manual overrides, and pre-existing snapshot matches
  unchanged; D9 rerun with every delta reconciling to an approved recovery; no
  convergence. Pre-OL-2B D9 figures are not invariants.
- **A11.** Reconciliation (D1-equivalent) passes exactly. *(Baseline + after both
  reconcile.)*
- **A12.** No language-marked row loses a disposition `ol0c-1` already produced.
  *(Confirmed: none.)*
- **A13 (governance).** No OL-0A2b rejected/deferred label appears in the amended
  allowlist; the integrity assertion passes with exactly 34 entries.

---

## 11. Expected files touched

| File | Change |
|---|---|
| `src/constants/ol0aAllowlist.js` | Append the single Tier A entry; amend integrity assertion `33 → 34` and `META.allowlistCount`; add `ol2b` provenance note + header amendment. |
| `src/services/snapshotMatcher.js` | Add `languageMarked(src)` (raw-field detection); gate the `combinedResolve` call on it; bump `MATCHER_VERSION` to `ol2b-1`. **No product-bucket guard.** Baseline tiers and agreement logic unchanged. |
| `scripts/ol0c-import-snapshot.test.mjs` *(or new `ol2b-*` test)* | OL-2B fixtures: the +8 McDonald's recovery (IDs + rules), JP exclusion + no-lost-existing-recovery, 4-JP-row freeze, D9 rerun reconciliation, deterministic rerun. |
| `docs/OL-2B_VERIFIED_MATCHING_SPEC.md` | This file. |
| `docs/OL-2B_VALIDATION_PLAN.md` | Final companion. |
| `CURRENT_STATE.md` | Owned Library section updated at closeout, after the smoke test passes. |

Not touched: `catalogIndexLoader.js`, `importSnapshotService.js`, `cardAdapter.js`, any
RPC, any SQL migration, `App.jsx`, `owned_keys`, ownership overrides, image services.

---

## 12. Explicit non-goals

Maximizing match rate; resolving JP/CN/KR printings; fixing the 4 matched JP rows;
repairing images; ownership convergence; building/altering Owned Library UI; multilingual
ingestion; reopening OL-0A2b rejected/deferred aliases; adding any product-bucket alias or
runtime bucket guard.

---

## 13. Rollback approach

Pure, deterministic, additive matcher-policy change with no schema or RPC surface. Revert
`snapshotMatcher.js` and `ol0aAllowlist.js`, restore `MATCHER_VERSION` to `ol0c-1` and the
assertion count to `33`. No stored batch is mutated; `ol2b-1` snapshots remain attributable
by their stored version; a re-import reproduces an `ol0c-1` snapshot. No table rename,
backfill, or in-place rewrite. After rollback, the deterministic rerun reproduces the
`ol0c-1` baseline (5,299/167/486/17).

---

## 14. Determinism and preservation guarantees

Frozen normalizers reused unchanged; OL-0A2b baseline classifier and agreement logic
unchanged; leading-zero semantics unchanged; six-candidate storage cap and its
descriptive-only status unchanged; bounded `match_rule` vocabulary unchanged; no existing
OL-0A recovery dropped.

---

## 15. Implementation readiness

**READY FOR IMPLEMENTATION.** The complete current catalog (23,604 rows) reproduces the
approved OL-2A baseline exactly (zero drift) and confirms the single Tier A alias with 8
clean recoveries, zero regressions, zero ID changes, and byte-identical determinism. No
repository files remain outstanding. The only steps left are writing the change (per §11),
running the test fixtures, and the Vercel Preview smoke test (validation plan §11), which
executes against the built preview at implementation time.

---

*Illustrated Vault — Owned Library initiative. Behavior-only specification; no
implementation code authorized by this document.*
