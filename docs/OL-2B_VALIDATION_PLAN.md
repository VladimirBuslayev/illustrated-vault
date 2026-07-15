# OL-2B — Verified Matching Recovery — Validation Plan

**Status:** OFFLINE GATE PASSED — smoke test pending at implementation
**Prepared as of:** 2026-07-15
**Document version:** 1.0 (final; executed against the complete current catalog)
**Applies to spec:** OL-2B_VERIFIED_MATCHING_SPEC.md v1.0
**Pinned batch:** `dd330490-081a-4bc7-8a65-a4f43c554469`
**User:** `ccc150c6-cff6-474a-86f8-c0bbdeb762e4`

> Offline gate over frozen fixtures plus one production smoke test. All offline checks
> have been executed and passed against the complete current catalog. The smoke test
> (§11) runs on Vercel Preview at implementation.

---

## 1. Frozen fixture strategy

**F1 — Frozen source export.** The exact Collectr export behind batch `dd330490-…`
(6,141 rows), parsed with the production PapaParse header contract. **Confirmed:** 6,141
data rows.

**F2 — Complete current catalog snapshot.** Full `cards_effective` export
(`id, name, set_id, set_name, local_id`). **Confirmed valid:** 23,604 records, 23,604
distinct ids, 0 duplicates, 0 parse errors, 210 distinct normalized set names; contains
`McDonald's Collection 2024` (`2024sv-*`). Pin F2 by content hash.

> The earlier uploaded exports (99 rows, McDonald's 2011–2021 only) were Supabase
> SQL-editor results truncated at the 100-row cap and were rejected as invalid F2. The
> current export is complete and untruncated.

**Baseline authority.** The approved OL-2A baseline — **5,299 / 167 / 486 / 17 / 5,969** —
is preserved as authoritative and is reproduced exactly by F2 (§2).

---

## 2. Baseline reproduction and drift resolution — PASSED

`ol0c-1` over F1 + F2:

| Bucket | OL-2A baseline | Current catalog | Δ |
|---|---|---|---|
| matched | 5,299 | 5,299 | 0 |
| ambiguous | 167 | 167 | 0 |
| unmatched | 486 | 486 | 0 |
| invalid | 17 | 17 | 0 |
| stored | 5,969 | 5,969 | 0 |
| distinct matched canonical | 4,769 | 4,769 | 0 |
| matched copies | 7,382 | 7,382 | 0 |
| conflicts | 0 | 0 | 0 |

**Zero row-level drift.** The 2-row difference seen against the stale 23,314-row fixture
is fully resolved by the complete current catalog. D-3 passes against a valid F2.

---

## 3. McDonald's Promos 2024 — Tier A evidence — PASSED

Recomputed against the complete current catalog:

- Target set `McDonald's Collection 2024` present.
- 9 affected rows: 8 eligible (unmatched at baseline) + 1 watchlist-only (gated out).
- 8/8 eligible rows resolve to exactly one `2024sv-*` card via `set_alias_leading_zero`:

| srn | Product | # | → card | rule |
|---|---|---|---|---|
| 3013 | Dragonite | 012/015 | `2024sv-12` | set_alias_leading_zero |
| 3014 | Dragonite | 012/015 | `2024sv-12` | set_alias_leading_zero |
| 3015 | Drampa | 015/015 | `2024sv-15` | set_alias_leading_zero |
| 3016 | Hatenna | 005/015 | `2024sv-5` | set_alias_leading_zero |
| 3017 | Jigglypuff | 004/015 | `2024sv-4` | set_alias_leading_zero |
| 3018 | Koraidon | 008/015 | `2024sv-8` | set_alias_leading_zero |
| 3019 | Rayquaza | 014/015 | `2024sv-14` | set_alias_leading_zero |
| 3020 | Roaring Moon | 011/015 | `2024sv-11` | set_alias_leading_zero |

- Candidate uniqueness 8/8; conflicts 0; regressions 0; matched-ID changes 0; all rules
  within the bounded vocabulary; deterministic rerun byte-identical.

**Before/after (confirmed):** matched **5,299 → 5,307** (ΣR = 8), unmatched **486 → 478**,
ambiguous 167, invalid 17, stored 5,969 unchanged; conflicts 0.

Governance-blocked labels (Sword & Shield Base Set, EX Dragon Frontiers, Mega Evolution
Promos, Nintendo Promos, WoTC Promo, Black and White Promos) are not validated for
promotion; EX Holon Phantoms is already-live.

---

## 4. False-positive review — PASSED

All 8 recovered rows: same real-world English set (McDonald's Collection 2024), number
semantics preserved (leading-zero equivalence only, e.g. `005 → 5`), none matching an
OL-2A unsafe-collision pattern. Directly analogous to the approved 2022 sibling entry.

---

## 5. Language exclusion checks — PASSED

- **X1.** 0 language-marked rows newly recovered.
- **X2.** Marker set from F1: `(JP)` ×128, `(CN)` ×109, `"…(Japanese)"` set labels ×4
  (Gym Heroes, Gym Challenge, Neo Revelation); no `(KR)`.
- **X3.** `languageMarked()` must fire on the raw field even where normalization strips
  the marker.
- **X4.** The 4 JP rows retain exact status/IDs on the current catalog: Amoonguss (JP)
  `sv10.5b-096`, Servine (JP) `sv10.5b-002`, Victini (JP) `sv10.5b-012`, Emboar (JP)
  `sv10.5w-013` — all `matched` / `exact_paren_stripped`, frozen for CAT-0.
- **X5.** No silent removal: 0 language-marked rows currently recover via
  `set_alias`/`leading_zero` (238 marked = 4 baseline-exact + 234 unresolved/watchlist).

---

## 6. Product-bucket checks — static only

- **B2 — No bucket alias (PASSED, static).** No product-bucket label appears as an
  allowlist key; enforced by the integrity assertion (all buckets are OL-0A2b-rejected).
- **B1 / B3 (runtime bucket-exclusion checks) — DEFERRED** with the runtime guard; not
  part of OL-2B.

---

## 7. Candidate-universe and source-row-ambiguity checks — PASSED

- **C1.** Candidate universe recomputed from the complete current catalog (23,604 rows),
  not from stored `candidate_card_ids`.
- **C2.** Every recovered row has exactly one candidate under the alias.
- **C3.** No previously-unique source-row resolution becomes multi-candidate (0
  regressions).
- **C4.** No currently-matched source row changes canonical `card_id` (0 ID changes).
- **C5.** Cap-hidden candidates handled from the recomputed universe.

---

## 8. Ownership and image non-regression

### 8.1 Ownership (to assert in the implementation test)

- **O1.** `owned_keys` neither read nor written by OL-2B.
- **O2.** Manual overrides neither read nor modified.
- **O3.** Every pre-OL-2B matched row keeps its exact canonical `card_id` (confirmed: 0
  ID changes at the matcher level).
- **O4.** D9 rerun after OL-2B: every snapshot-ownership delta reconciles exactly to one
  of the 8 approved McDonald's recoveries; pre-OL-2B D9 figures are expected to move.
- **O5.** No ownership-path convergence.

### 8.2 Image

- **I1.** Existing image figures stable for the pre-existing matched set; the 8 recovered
  IDs reported separately and not required to have images (OL-2C).
- **I2.** No image code path exercised.

---

## 9. Deterministic rerun test — PASSED

- **D-1.** AFTER classifier run twice ⇒ byte-identical stored output. *(Confirmed.)*
- **D-2.** `conflicts` = 0; no conflicting row recovered.
- **D-3.** `ol0c-1` over F1 + F2 reproduces the OL-2A baseline exactly (5,299/167/486/17).
  *(Confirmed.)*

---

## 10. Rollback validation

- **RB-1.** Revert OL-2B (restore `MATCHER_VERSION = ol0c-1`, remove the alias, restore
  assertion count to 33) and rerun over F1 + F2 ⇒ baseline reproduces (5,299/167/486/17).
- **RB-2.** No stored production batch mutated by OL-2B.
- **RB-3.** No schema/RPC/timeout artifact to revert.

---

## 11. Production smoke test — to run at implementation

- **S1.** Real signed-in Collectr import on Vercel Preview; batch activates;
  `matcher_version = ol2b-1`; D1 reconciliation passes.
- **S2.** Live matched/ambiguous/unmatched/invalid deltas vs the prior active `ol0c-1`
  snapshot fall within the ΣR = 8 envelope (allowing for export drift).
- **S3.** `owned_keys` untouched.
- **S4.** `get_active_import_snapshot_read_model` returns `ready`, `contractVersion: 1`.
- **S5.** Vite build passes.

Living-doc closeout is updated only after S1–S5 pass.

---

## 12. Pass/fail summary

| Gate | Status |
|---|---|
| §2 Baseline reproduced on valid F2 (OL-2A preserved) | **PASS** |
| §3 McDonald's 2024 evidence; ΣR + IDs confirmed | **PASS** |
| §4 False-positive review | **PASS** |
| §5 Language exclusion X1–X5 | **PASS** |
| §6 B2 static (B1/B3 deferred) | **PASS** |
| §7 Candidate-universe C1–C5 | **PASS** |
| §8 Ownership O1–O5 / image I1–I2 | To assert in implementation test |
| §9 Determinism D-1–D-3 | **PASS** |
| §10 Rollback RB-1–RB-3 | To assert in implementation test |
| §11 Production smoke S1–S5 | To run on Vercel Preview |

The offline evidence gate is fully passed. Remaining items are the implementation-time
test assertions and the Preview smoke test, both of which run once the change is written.

---

*Illustrated Vault — Owned Library initiative. Validation gate for OL-2B.*
