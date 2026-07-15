# OL-2A — Matching + Image Coverage Audit — Closeout

**Status:** CLOSED
**Prepared as of:** 2026-07-15
**Document version:** 1.1 (revised for independent documentation review; audit findings unchanged)
**Matcher version audited:** `ol0c-1`
**Successor slice:** OL-2B — Verified Matching Recovery

> Revision note (1.1): audit baseline, diagnostics, and findings are frozen and
> unchanged from 1.0. This revision only clarifies, in §4.9 and §5, that snapshot
> ownership may legitimately change for rows OL-2B newly recovers — which is distinct
> from ownership-path convergence — so the record does not contradict the corrected
> OL-2B validation plan.

---

## 1. Objective and status

OL-2A was a read-only audit of the current snapshot matcher against a real, pinned
Collectr import batch and the full `cards_effective` catalog. Its purpose was to
quantify what the `ol0c-1` matcher resolves, characterize what it leaves unresolved,
and determine whether any recovery is safe **without weakening the product's
physical-printing accuracy guarantee**.

OL-2A introduced no runtime changes. It read already-decided import results only.

OL-2A is **closed**. Its findings are accepted and frozen as the evidence base for
OL-2B. This document is the authoritative record; the working conversation that
produced it is superseded by this file.

---

## 2. Audit baseline

Pinned audit target:

- Batch UUID: `dd330490-081a-4bc7-8a65-a4f43c554469`
- User UUID: `ccc150c6-cff6-474a-86f8-c0bbdeb762e4`
- Matcher version: `ol0c-1`
- Catalog rows at audit time: 23,604

Import reconciliation (D1 passed exactly):

| Metric | Value |
|---|---|
| Total source rows | 6,141 |
| Pokémon rows | 6,135 |
| Stored positive-quantity rows | 5,969 |
| Matched rows | 5,299 |
| Ambiguous rows | 167 |
| Unmatched rows | 486 |
| Invalid rows | 17 |
| Unresolved rows (ambiguous + unmatched + invalid) | 670 |
| Unresolved copies | 774 |
| Distinct matched canonical cards | 4,769 |
| Matched copies | 7,382 |

Internal consistency confirmed: matched + ambiguous + unmatched + invalid = 5,969 =
stored rows; ambiguous + unmatched + invalid = 670 = unresolved rows. The gap between
5,299 matched rows and 4,769 distinct canonical cards confirms duplicate source rows
aggregate onto shared canonical IDs rather than emitting duplicate library items.

This batch is a later, larger Collectr export than the OL-0D validation snapshot
(5,890 source rows) recorded in `CURRENT_STATE.md`. OL-2A's numbers above are the
authoritative baseline for all OL-2B before/after comparison.

---

## 3. Diagnostics completed

- **D1 — Reconciliation.** Header counts vs. immutable child rows. Passed exactly.
- **Unresolved taxonomy.** Every unresolved row classified by stored
  `match_status` / `match_reason`.
- **D4a — Unique-candidate scan (unresolved).** Counted unresolved rows with exactly
  one apparent name+number candidate vs. multiple vs. none.
- **D5a — Full candidate-universe recomputation (ambiguous).** Recomputed candidates
  independently of the stored six-candidate cap; confirmed the stored
  `candidate_card_ids` is descriptive only and must not be treated as authoritative.
- **Alias surfacing.** Identified credible one-to-one English set-name candidates and,
  separately, source buckets that must **not** collapse to a single set.
- **Cross-language audit.** Corrected explicit-language pass over JP/CN-marked rows,
  establishing a firm lower bound on non-English unresolved volume, plus four
  explicitly Japanese rows currently matched.
- **Unsafe-collision review.** Confirmed that unique name+number does not prove same
  physical printing.
- **Invalid-row review.** Confirmed the matcher correctly rejects unnumbered /
  sealed-product / unidentifiable rows.
- **Image coverage + runtime sample.** Verified matched-ID persistence, `image_url`
  population, and a corrected 300-response runtime WebP sample.
- **D9 — Ownership disagreement measurement.** Compared `owned_keys` ownership against
  snapshot ownership across tracked artist cohorts.

---

## 4. Findings

### 4.1 Unresolved taxonomy

| Reason | Rows | Copies |
|---|---|---|
| `set_not_in_catalog` | 412 | 472 |
| `name_num_unique_set_mismatch` | 139 | 158 |
| `name_not_found` | 74 | 90 |
| `name_num_multi` | 18 | 20 |
| `missing_number` | 17 | 24 |
| `mixed_weak_multi` | 9 | 9 |
| `name_set_unique_num_mismatch` | 1 | 1 |
| **Total** | **670** | **774** |

The top two reasons (`set_not_in_catalog`, `name_num_unique_set_mismatch`) account for
551 of 670 unresolved rows. These are the primary OL-2B target surface.

### 4.2 Unique-candidate evidence

D4a (unresolved rows):

- 199 rows with exactly one apparent name+number candidate
- 41 rows with multiple candidates
- 430 rows with no name+number candidate

D5a (ambiguous rows, full recomputed universe):

- 134 rows / 151 copies with exactly one full candidate
- 33 rows / 37 copies with multiple candidates
- 7 rows had candidates hidden by the stored six-candidate cap
- **Stored `candidate_card_ids` is descriptive only** and is not an authoritative
  resolution source.

A single apparent candidate is **necessary but not sufficient** for recovery. D4a's
199 and D5a's 134 mark the *ceiling* of recoverable rows, not an approved set.

### 4.3 Strong potential English aliases (candidates only — not approved)

Credible one-to-one naming candidates surfaced, subject to row-level validation:

- `Sword & Shield Base Set` → `Sword & Shield`
- `EX Dragon Frontiers` → `Dragon Frontiers`
- `EX Holon Phantoms` → `Holon Phantoms`
- `Mega Evolution Promos` → `MEP Black Star Promos`
- `McDonald's Promos 2024` → `McDonald's Collection 2024`
- `WoTC Promo` → `Wizards Black Star Promos`
- `Black and White Promos` → `BW Black Star Promos`
- `Nintendo Promos` → `Nintendo Black Star Promos`

These are **candidates for row-level validation, not approved mappings.**

### 4.4 Product buckets that must not become one-to-one aliases

The following source buckets legitimately span multiple underlying catalog sets and
must remain either row-level-treated or unresolved. They are prohibited from
single-set aliasing:

- Prize Pack Series One
- Trick or Trade BOOster Bundles
- Deck Exclusives
- Miscellaneous Cards & Products
- Jumbo Cards
- World Championship Decks
- Trainer Kits

### 4.5 Cross-language evidence

Corrected explicit-language audit (firm lower bound):

**Chinese** — 107 unmatched, 2 ambiguous → 109 rows / 114 copies.

**Japanese** — 102 unmatched, 21 ambiguous, 1 invalid, 4 matched → 128 rows /
157 copies.

Therefore at least **233 of 670 unresolved rows** and **267 of 774 unresolved copies**
are explicitly Japanese or Chinese (excluding the 4 already-matched JP rows). This is
a lower bound; unmarked non-English rows are not counted here.

Four explicitly Japanese rows are **currently matched** and require review:

- Amoonguss (JP)
- Emboar (JP)
- Servine (JP)
- Victini (JP)

All four are in Black Bolt or White Flare. The catalog has no authoritative language
field, so their physical-printing correctness is currently **unproven**.

### 4.6 Unsafe collisions

Unique name+number does not establish the same physical printing. Observed unsafe
correspondences include:

- Black Bolt → Plasma Blast
- Fairy Rise → Plasma Storm
- Gem Pack 2 → Ultra Prism
- Mega Brave → BREAKpoint
- Mega Symphonia → Crimson Invasion / Legendary Collection
- Raging Surf → Generations
- JP/CN cards resolving toward English analogues

**No global name+number fallback is approved, at any tier.**

### 4.7 Invalid rows

17 invalid rows / 24 copies comprise unnumbered energy or stamped-card variants,
sealed products (e.g. Elite Trainer Boxes), and one Japanese trainer without a number.
The matcher's automatic rejection of these is **correct** and must be preserved.

### 4.8 Image findings

- All 4,769 matched IDs still exist in the catalog.
- 4,662 matched cards have populated `image_url`; 107 lack it.
- Corrected runtime sample: 300/300 valid WebP responses; no evidence of broad
  runtime URL failure.
- Missing images concentrate in special subsets and promo families.

Image work is **deferred to OL-2C** and is out of scope for OL-2B.

### 4.9 D9 ownership disagreement

Across tracked artist cohorts, at audit time:

- 1,210 cards owned by both paths
- 220 owned via `owned_keys` only
- 74 owned via snapshot only
- 294 disagreements = 19.5% of the combined owned-card union

These figures are a **point-in-time measurement of the pre-OL-2B state**, not an
invariant. Because OL-2B changes which imported rows receive canonical snapshot card
IDs, the *snapshot* side of this comparison may legitimately shift for rows OL-2B
recovers. That is expected and is **not** the same as ownership-path convergence.
Convergence of the two ownership paths is a separate initiative deferred to **OWN-1**.
The OL-2B validation plan reruns D9 and requires every ownership delta to reconcile
exactly to an approved OL-2B recovery (see the validation plan); it does **not** require
the numbers above to remain frozen.

---

## 5. Accepted decisions

1. Physical-printing accuracy outranks matched percentage. A lower matched rate with
   correct printings is preferred to a higher rate with collapsed printings.
2. `owned_keys` remains lossy recognition infrastructure; it is never touched by OL
   work and is not converged in OL-2B.
3. The two ownership paths (Artist Page/Binder loose `owned_keys` + overrides; Owned
   Library strict snapshot IDs) stay separate through OL-2B.
4. Unique name+number is never sufficient on its own; no global name+number fallback.
5. Stored `candidate_card_ids` is descriptive only, capped, and non-authoritative.
   Any candidate universe must be recomputed, not read from storage.
6. JP/CN/KR-marked source rows are excluded from generic recovery.
7. The surfaced product buckets in 4.4 are prohibited from single-set aliasing.
8. The eight surfaced English aliases in 4.3 are candidates requiring row-level
   evidence, not approved mappings.
9. The matcher's rejection of the 17 invalid rows is correct and preserved.
10. Image work is deferred to OL-2C. Ownership-path **convergence** is deferred to
    OWN-1. OL-2B may legitimately change snapshot ownership for newly recovered rows;
    every such change must reconcile to an approved recovery, and `owned_keys` and
    manual overrides must remain untouched.
11. The four currently-matched JP rows are frozen for CAT-0 review; OL-2B does not
    un-match them.

---

## 6. Limitations

- The cross-language counts are a **lower bound** keyed on explicit markers; unmarked
  non-English printings are undercounted.
- The catalog has **no authoritative language field**, so no printing can currently be
  proven English-only or non-English from catalog data alone. This blocks a
  definitive ruling on the four matched JP rows.
- OL-2A measured a single pinned batch. Findings generalize to the matcher's behavior
  but the exact counts are batch-specific.
- Alias credibility in 4.3 was assessed at the naming level, not yet at the
  per-row unique-resolution level.

---

## 7. Deferred work

| Item | Deferred to |
|---|---|
| Multilingual catalog language field / ingestion | CAT-0 |
| Disposition of the four matched JP rows | CAT-0 (frozen, not force-unmatched, in OL-2B) |
| Image resilience + targeted coverage (107 missing) | OL-2C |
| Ownership-path **convergence** (the 294 disagreements as a reconciliation goal) | OWN-1 |
| Product-bucket row-level treatment | OL-2B row-level classes / later slices |

Approved roadmap sequence: **OL-2B → CAT-0 → OL-2C → OWN-1.**

---

## 8. Closure statement

OL-2A — Matching + Image Coverage Audit is **CLOSED** as of 2026-07-14 (record revised
2026-07-15 for documentation review; findings unchanged). Its baseline, diagnostics, and
findings are accepted and frozen. No runtime changes were made. The findings above are
the sole authorized evidence base for OL-2B — Verified Matching Recovery. Any recovery
beyond what this evidence supports requires new diagnostics under a later slice.

---

*Illustrated Vault — Owned Library initiative. This document supersedes prior
conversation context regarding OL-2A.*
