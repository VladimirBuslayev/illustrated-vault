# OL-2B — Verified Matching Recovery — Validation Plan

**Status:** DRAFT — pre-implementation
**Prepared as of:** 2026-07-15
**Document version:** 0.2 (revised for independent technical review)
**Applies to spec:** OL-2B_VERIFIED_MATCHING_SPEC.md v0.2
**Pinned batch:** `dd330490-081a-4bc7-8a65-a4f43c554469`
**User:** `ccc150c6-cff6-474a-86f8-c0bbdeb762e4`

> This plan is the gate between the OL-2B spec and implementation. Its checks must be
> designed and its evidence gathered before any alias is promoted to Tier A and before
> any matcher code is written. It runs entirely offline against frozen fixtures plus one
> production smoke test at the end.
>
> Revision note (0.2): §7 alias checks reframed around source-row ambiguity (not catalog
> uniqueness); §5 adds the required frozen-matcher pre-analysis for language-marked rows;
> §8 ownership checks corrected — snapshot ownership may legitimately change for recovered
> rows and D9 is rerun rather than frozen.

---

## 1. Frozen fixture strategy

Two frozen inputs pin every check so results are reproducible and diffable:

**F1 — Frozen source export.** The exact Collectr export behind batch
`dd330490-…` (or a byte-stable copy), stored as a test fixture. Parsed with the same
PapaParse header contract used in production.

**F2 — Frozen catalog snapshot.** A point-in-time export of the columns the matcher
reads from `cards_effective` (`id, name, set_id, set_name, local_id`), pinned at
23,604 rows, stored as a fixture. The matcher's completeness check must pass against it.

All before/after comparisons use F1 + F2 exclusively. No check may read the live catalog
except the §11 production smoke test. Fixtures are checked into the repo (or a tracked
fixtures location) and referenced by hash so drift is detectable.

---

## 2. Current-batch before/after comparison

Run the classifier twice over F1 + F2:

- **BEFORE:** `MATCHER_VERSION = ol0c-1`, frozen 33-entry allowlist, no guards.
- **AFTER:** `MATCHER_VERSION = ol2b-1`, allowlist + Tier A aliases, guards active.

Emit a full disposition diff:

| Bucket | Before (OL-2A) | After (target) |
|---|---|---|
| matched rows | 5,299 | 5,299 + ΣR (recovered) |
| ambiguous rows | 167 | 167 − recovered-from-ambiguous |
| unmatched rows | 486 | 486 − recovered-from-unmatched |
| invalid rows | 17 | 17 (unchanged) |
| stored rows | 5,969 | 5,969 (unchanged) |

Required invariants:

- `stored_rows` unchanged (5,969).
- `invalid_rows` unchanged (17).
- Every row that moves does so **only** from ambiguous/unmatched → matched. No row
  moves in any other direction. No matched row changes ID.
- `matched + ambiguous + unmatched + invalid = 5,969` after (D1-equivalent).

The diff must enumerate every changed row (source_row_number, before status, after
status, assigned card_id, match_rule, and the alias/guard that applied).

---

## 3. Expected recovered-row counts by rule

For **each Tier A alias**, the plan must record, from F1 + F2, before that alias is
approved:

- number of affected source rows (rows whose `normSet(src.set)` equals the alias key);
- of those, how many resolve to **exactly one** catalog card under the alias (via
  name+set+number, incl. existing LZ / paren-stripped variants);
- how many resolve to multiple or zero (these are **not** recovered and stay
  unresolved);
- the resulting `match_rule` for each recovered row (must be in the bounded vocabulary).

Aggregate the per-alias recovered counts into ΣR and break ΣR down by `match_rule`. The
AFTER run in §2 must match this projection **exactly** (spec A6). Any mismatch is a
blocking failure — it means a row recovered for an unmodeled reason.

Because no alias is Tier A at spec time, ΣR is currently **0**; every entry in the Tier
B table starts here and only contributes to ΣR after passing §3–§7.

---

## 4. False-positive review

For every recovered row (the §2 diff), a manual/audited review confirms the assigned
canonical card is the **same physical printing** as the source row, not merely a
name+number coincidence:

- The source set and target set are the same real-world English set.
- Card-number semantics match, including any preserved alpha prefix/suffix (TG/GG/SWSH/
  SM/XY must not be normalized away).
- The recovery is not one of the OL-2A unsafe-collision patterns (Black Bolt → Plasma
  Blast, Fairy Rise → Plasma Storm, Gem Pack 2 → Ultra Prism, Mega Brave → BREAKpoint,
  Mega Symphonia → Crimson Invasion/Legendary Collection, Raging Surf → Generations, or
  any JP/CN → English analogue).

Any recovered row failing this review disqualifies its alias from Tier A until the row
is either excluded or the alias is narrowed.

---

## 5. Language exclusion checks (and no-lost-existing-recovery)

**Pre-analysis (required before the guard is designed).** For every language-marked row
in F1, classify it under the **frozen `ol0c-1` matcher with the guard disabled** and
record which existing strategy produced its disposition (baseline exact, `set_alias`,
`leading_zero`, combined, or none). This inventory is the reference against which the
guard is judged.

- **X1 — No new non-English recovery.** Assert zero of the ≥233 explicitly
  Japanese/Chinese unresolved rows are **newly** recovered by OL-2B.
- **X2 — Marker inventory.** Produce the exact set of language markers present in F1
  (trailing `(JP)`/`(CN)`/`(KR)`, non-English set labels, etc.) and confirm
  `languageMarked()` flags each. Include a labeled table of every distinct marker.
- **X3 — Pre-normalization detection.** Assert `languageMarked()` fires on the raw
  source field even for markers the frozen normalizers would strip (e.g. a trailing
  `(JP)` removed by paren-stripping). This is the check that prevents the observed
  JP→English paren-strip recovery.
- **X4 — Four-JP-row freeze.** Assert Amoonguss (JP), Emboar (JP), Servine (JP),
  Victini (JP) retain their exact BEFORE `match_status` and `card_id` in the AFTER run.
- **X5 — No silent removal of existing OL-0A recovery (spec §6.3, A12).** Using the
  pre-analysis inventory, assert that no language-marked row that had a valid `ol0c-1`
  disposition loses it under the guard. Any language-marked row that currently receives a
  recovery is surfaced explicitly and **frozen for CAT-0**, not dropped. If the guard
  would remove any such disposition, that is a blocking failure and the guard must be
  narrowed.

---

## 6. Product-bucket checks

- **B1 — Bucket exclusion.** For each label in `PROHIBITED_BUCKETS`, assert no row with
  that source set is recovered, even where a lone candidate exists.
- **B2 — No bucket alias.** Assert no `PROHIBITED_BUCKETS` label appears as an allowlist
  key (a bucket can never be rescued by an alias).
- **B3 — Deferred cross-language/cross-release stay excluded.** Assert the OL-0A2b
  deferred mappings (e.g. Ninja Spinner → Chaos Rising, Inferno X → Phantasmal Flames,
  Night Wanderer → Shrouded Fable) remain unmapped.

---

## 7. Candidate-universe and source-row-ambiguity checks

All alias evaluation is source-row-centric and uses a freshly recomputed complete
candidate universe from F2. These checks do **not** assert anything about catalog-level
uniqueness; they assert what each source row resolves to before vs. after an alias.

- **C1 — Recompute, don't read.** All candidate reasoning uses a freshly recomputed
  candidate universe from F2, never the stored capped `candidate_card_ids`.
- **C2 — Uniqueness of resolution.** Every recovered source row resolves to exactly one
  full name+set+number candidate under its applied alias; multi-candidate source rows are
  not recovered.
- **C3 — No source-row ambiguity regression.** For each proposed alias, recompute the
  complete candidate universe with the alias applied and assert that **no source row that
  previously resolved to a single card now resolves to multiple candidates**. Any alias
  that turns a previously-unique source-row resolution into a multi-candidate resolution
  is disqualified.
- **C4 — No matched-ID change.** Assert no currently-matched source row changes its
  canonical `card_id` under any proposed alias (spec A4/A5).
- **C5 — Cap-independence.** Confirm the 7 rows whose candidates were hidden by the
  six-candidate cap are handled from the recomputed universe, not the stored cap.

---

## 8. Ownership and image non-regression

### 8.1 Ownership (corrected)

OL-2B changes which imported rows receive canonical snapshot card IDs, so **snapshot
ownership may legitimately change** for newly recovered rows. The checks therefore fix
the immutable inputs and reconcile the delta rather than freezing D9:

- **O1 — `owned_keys` unchanged.** Assert OL-2B code references neither reads nor writes
  `owned_keys`, and that the primary recognition path and its counts are untouched.
- **O2 — Manual overrides unchanged.** Assert `manualOwned` / `manualMissing` overrides
  are neither read nor modified by OL-2B.
- **O3 — Pre-existing snapshot matches unchanged.** Assert every row matched before
  OL-2B keeps its exact canonical `card_id` (no pre-existing snapshot ownership is
  altered or removed).
- **O4 — D9 rerun + exact reconciliation.** Rerun the D9 ownership comparison after
  OL-2B. Every snapshot-ownership delta vs. the pre-OL-2B D9 measurement must reconcile
  **exactly** to an approved OL-2B recovery from the §2 diff — i.e. each newly
  snapshot-owned card corresponds to a specific recovered row and no delta is
  unexplained. The pre-OL-2B figures (1,210 / 220 / 74 / 294) are expected to move and
  are **not** treated as invariants.
- **O5 — No convergence.** Assert OL-2B performs no ownership-path convergence: the
  Artist Page/Binder `owned_keys`+overrides path and the snapshot path remain separate;
  no merge of `manualOwned`/`manualMissing` into snapshot quantity occurs.

### 8.2 Image (unchanged path)

- **I1 — Existing image figures stable.** For the pre-existing matched set, matched-ID
  persistence (4,769 IDs still present), 107 missing `image_url`, and 4,662 populated
  remain as measured in OL-2A. Newly recovered IDs are reported separately and are **not**
  required to have images (image work is OL-2C).
- **I2 — No image code path exercised.** OL-2B changes must not import or invoke image
  services.

---

## 9. Deterministic rerun test

- **D-1.** Run the AFTER classifier twice over F1 + F2 and assert byte-identical stored
  output: identical row order, identical `card_id`, identical `match_rule`, identical
  counts, identical `diagnostics.conflicts`.
- **D-2.** Assert `conflicts` is reported and that no conflicting row is ever recovered
  (agreement requirement preserved).
- **D-3.** Confirm the same F1 + F2 under `ol0c-1` reproduces the exact OL-2A baseline
  (5,299 / 167 / 486 / 17), proving the fixture itself is faithful before measuring any
  delta.

---

## 10. Rollback validation

- **RB-1.** Revert OL-2B code (restore `MATCHER_VERSION = ol0c-1`, remove Tier A
  aliases, remove guards) and rerun over F1 + F2; assert the OL-2A baseline counts
  reproduce exactly.
- **RB-2.** Assert no stored production batch was mutated by OL-2B (OL-2B affects only
  newly-created snapshots; existing batches are immutable).
- **RB-3.** Assert no schema/RPC/timeout artifact needs reverting (there should be none).

---

## 11. Production smoke test

After code review and all offline checks pass:

- **S1 — Preview import.** On Vercel Preview, run a real signed-in Collectr import.
  Confirm the batch activates, `matcher_version = ol2b-1`, and D1 reconciliation passes
  on the live batch.
- **S2 — Bounded delta.** Confirm live matched/ambiguous/unmatched/invalid deltas vs. the
  prior active `ol0c-1` snapshot fall within the projected ΣR envelope from §3
  (accounting for any export drift since the pinned batch).
- **S3 — `owned_keys` untouched.** Confirm the primary `owned_keys` recognition path and
  its counts are unchanged by the import (OL-2B is snapshot-only).
- **S4 — Read model intact.** Confirm `get_active_import_snapshot_read_model` returns
  `ready` on the new active snapshot with no contract change (`contractVersion: 1`).
- **S5 — Vite build.** Vercel Preview dependency install and Vite build pass.

Living-doc closeout (`CURRENT_STATE.md`) is updated **only after** S1–S5 pass.

---

## 12. Pass/fail summary gate

OL-2B ships only if **all** of the following hold:

1. §2 before/after diff shows movement only into `matched`, `stored_rows` and
   `invalid_rows` unchanged, D1-equivalent passes.
2. §3 per-alias projection equals the §2 AFTER result exactly.
3. §4 false-positive review clears every recovered row.
4. §5 X1–X5 pass (no new non-English recovery; 4 JP rows frozen; no existing OL-0A
   recovery silently removed).
5. §6 B1–B3 pass (no bucket recovery/aliasing).
6. §7 C1–C5 pass (recomputed universe; per-row uniqueness; no source-row ambiguity
   regression; no matched-ID change).
7. §8 O1–O5 pass (owned_keys/overrides/pre-existing matches fixed; D9 rerun reconciles
   exactly; no convergence) and I1–I2 pass.
8. §9 D-1–D-3 pass (determinism + faithful baseline reproduction).
9. §10 RB-1–RB-3 pass (clean rollback).
10. §11 S1–S5 pass (production smoke).

Any failing item blocks the slice. Partial alias approval is allowed: aliases failing
§3–§7 stay Tier B and simply do not ship; the slice can still ship the aliases that pass,
provided ΣR reconciles to only those.

---

*Illustrated Vault — Owned Library initiative. Validation gate for OL-2B; must pass
before implementation and before living-doc closeout.*
