# CAT-0 — Catalog Source & Coverage Audit — Findings & Decision

**Revision:** final (precision pass applied 2026-07-27). Complete replacement of the prior draft.
**Type:** Diagnostic synthesis. No implementation, no production change, no remediation.
**Baseline pinned:** 2026-07-27 (cards 23,780 · card_extras 5 · artists 22)
**Production SQL:** CLOSED. No further queries required or requested.
**Companion:** supersedes the decision sections of the v2 Architecture & Audit Plan; the plan's SQL and artifact schemas remain the execution record.

---

## 1. Headline

**No P0 condition exists in the catalog.** Canonical identity is clean: zero null IDs, zero duplicate IDs, zero duplicate `(set_id, local_id)` groups, zero orphan extras, zero orphan artist FKs, zero wrong artist FKs. The `cards_effective` boundary is structurally sound and cannot fan out or lose rows.

The catalog's defects are **coverage and derivation** defects, not identity defects. That is the best available outcome for a product whose governing rule is that false-positive printing identity is worse than missing data.

One finding is now fully root-caused. Several are falsified. One P0-candidate is dormant. The rest are sized and ranked below.

---

## 2. Confirmed findings

### F-13 — Global temporal metadata gap · **ROOT CAUSE CONFIRMED** · P1

`series` and `release_date` are null for 23,780 / 23,780 cards.

**Cause, proven rather than hypothesised.** TCGdex's official API reference types the Card object's `set` property as a **SetBrief**, carrying `cardCount`, `id`, `logo`, `name`, `symbol` — and nothing else. `serie` and `releaseDate` exist only on the full **Set** object returned by `GET /v2/en/sets/{id}`.

`sync-cards.mjs :: mapCardToRow` reads:

```js
series:       card.set?.serie?.name     // SetBrief has no .serie      → undefined → null
release_date: card.set?.releaseDate     // SetBrief has no .releaseDate → undefined → null
```

Both resolve to `undefined` on every card, in every set, always. 100% null is the necessary outcome of the response shape, not a data-quality variance.

**The Q6.4 discriminator behaved exactly as predicted.** `set_name` is 100% complete because `card.set.name` *is* on the SetBrief. The `card.set` extraction works; only the two fields absent from that shape fail. This rules out a broadly broken sync and isolates the defect precisely.

**The data is already retrieved.** `syncSet` fetches `GET /sets/{setSummary.id}` — the full Set object, containing both `releaseDate` and `serie` — and uses only `.cards`, discarding the rest. No new source, no new API call, no cross-source correspondence, no governance.

**Confidence: HIGH.** Documented API contract + code path + a coverage signature matching the prediction exactly.

### F-19 — Artist FK is derived at card-sync time and is not retroactive · **NEW** · P2

Chronology establishes the lifecycle mechanism cleanly:

| Artist | Identity row created | Cards synced before | Cards synced after | FK-null today |
|---|---|---|---|---|
| Midori Harada | 2026-07-03 | 378 → all FK-null | 1 → FK correct | 378 |
| Suwama Chiaki | 2026-07-10 | 121 → all FK-null | 0 | 121 |

Zero cards synced *after* identity creation remain FK-null.

**Evidence-backed statement of the mechanism:** when a new artist identity is created after matching catalog cards have already been ingested, those existing rows do not retroactively receive the new `artist_id`. They remain stale until subsequently re-synced.

`resolveArtistId` runs at card-write time against the alias map as it existed at that moment. F-6 (incremental sync skips any set where `storedCount >= briefCards.length`) means a re-sync of the affected sets is not scheduled by the current sync behavior.

Total known-identity stale FKs: **499 missing, 0 wrong.** The figure is not necessarily static — the same condition can recur whenever an identity is created after its matching cards were ingested — but no growth rate is claimed here.

**Confidence: HIGH** for the mechanism. **Product impact: currently zero** — see F-2B falsified.

### F-15 — Override/FK divergence is structural but currently harmless · P3 (was P1)

`cards_effective` COALESCEs `illustrator` with `card_extras.illustrator_override` while taking `artist_id` straight from `cards.artist_id`. An override changes the displayed illustrator and never the FK.

All 5 rows inspected. All 5 base illustrators are null; all 5 overrides change the effective value. Two carry `artist_id = null` (N-DESIGN Inc., Yuu Nishida) — not contradictions, merely identities absent from the 22-row `artists` table. **Zero contradictory override/FK pairs exist.**

Downgraded to P3 with a trigger: if `card_extras` were ever used at scale — for example as a durable channel for illustrator enrichment — this becomes P1 immediately, because a large override population with no FK derivation would create a correspondingly large silent divergence.

### F-14 — Ordering degradation · P2, **impact unverified**

`cardService` orders `release_date ASC NULLS LAST → set_id → local_id`. With `release_date` universally null the primary key is inert, so DB-side order collapses to lexicographic `set_id` then `local_id`-as-text (`"10"` before `"9"`; `"swsh10"` before `"swsh9"`).

**User-visible impact is not confirmed.** `src/constants/setOrder.js` and `src/utils/sort.js` both exist in the repository; neither was available for inspection. If the UI re-sorts using a curated set order, chronological presentation may already be correct and this finding collapses to P3. Two circumstantial signals are consistent with the product having already worked around missing dates: `setOrder.js` exists as a hand-maintained constant, and OL-0D's read model offers `name_asc | set_asc | quantity_desc` with **no date sort**.

Recorded as unresolved. It affects CAT-1's scope, not its selection (§7).

---

## 3. Falsified, retired, and dormant

| Hypothesis | Verdict | Evidence |
|---|---|---|
| **F-8** — duplicate canonical IDs are a live P0 risk | **FALSIFIED** | 23,780 = 23,780; Q1.INV all zero; `card_extras.card_id` is PK. The v1 inference — "defensive code implies the defended-against condition exists" — was unsound and is retired with the finding. |
| **F-2B** — FK staleness causes a visible artist-surface undercount | **FALSIFIED for the affected tracked artist** | Suwama Chiaki: FK-only 0, exact-illustrator 121, current dynamic OR path 121, recovered 121. All cards remain visible. |
| **F-5** — alias collisions across artists | **FALSIFIED** | Zero aliases claimed by more than one artist row. |
| **F-16 (conflict form)** — `max(artist_id)` masks conflicting artist IDs | **FALSIFIED** | Zero illustrator strings map to more than one distinct non-null `artist_id`. The masking form persists (partial FK coverage, e.g. Midori 378 null / 1 resolved) but conceals no disagreement. |
| **F-3** — the historical backfill's number-only join may have produced wrong artist attribution | **DORMANT** | All 1,320 cards across the nine historical backfill-target sets currently have `cards.illustrator IS NULL`. No backfilled illustrator value is present in production today, so there is no wrong-attribution data to find. F-3 stands as a prospective design risk for any future enrichment, not a live defect. |
| **F-4** — NFKC/normalization fragility causes artist-first loss | **DOWNGRADED** | Only 12 cards across 3 raw strings carry the stronger Unicode/whitespace patterns; Q3.6 returned `unresolved_cards = 0` for both Saya Tsuruta variants. Q3.4's six families are largely case-only and already neutralized by the lowercase resolver. Confirmed fragility; no demonstrated current loss. |

### Correction to a prior interpretation in this audit

`illustrator IS NOT NULL AND artist_id IS NULL` was previously treated as a defect metric. **That was wrong.** With only 22 artist identities against thousands of distinct illustrator strings, 18,183 is the expected value, not a gap. The real defect class is cards whose illustrator matches an existing identity but whose FK is absent or wrong: **499 missing, 0 wrong.**

---

## 4. Unresolved, with confidence

| Question | Confidence | Why it stays open |
|---|---|---|
| Did the historical backfill ever persist to this production population? | **LOW** | The nine sets were last synced 2026-06-23 and have not been re-synced, so the timestamp evidence **cannot** show that a later sync erased it. Candidates remain: ran before 06-23 and was overwritten · never persisted · ran in another environment · matching conditions never selected these rows. Not reconstructable from current evidence. |
| What is the current upstream cause of the 1,320 null-illustrator rows? | **NOT REVALIDATED** | These are the known historical backfill-target population. Whether TCGdex still lacks illustrator data for them today has not been re-checked in this audit. |
| Are the 51 fully image-missing sets structural upstream absences? | **UNPROVEN** | The clustering (1,370 of 1,640 missing images across 51 sets at 100%) is *consistent* with structural upstream absence but does not establish it. |
| Does OL-0D's `p_artist_id` filter resolve via FK only? | **LATENT / UNRESOLVED** | Not tested. See §5 note — does not block closure. |
| Does `add_artist_to_archive` risk duplicate identity creation when `illustrator_directory` reports `artist_id = null`? | **LOW** | The directory reports `max(artist_id) = null` for Suwama despite an identity existing. No duplicate has occurred (artists = 22, zero alias collisions). |
| Is chronological ordering already delivered by `setOrder.js` + `sort.js`? | **UNKNOWN** | Neither file inspected. Resolved during CAT-1 inspection. |
| What explains the three historical "card_extras FK fixes"? | **UNRESOLVED** | The three rows do carry the documented FKs, but the schema proves `card_extras` cannot write `artist_id`. A separate, undocumented FK write occurred. Intent must not be inferred from current state. |

---

## 5. Product-impact ranking

Measured against the spine: **artist-first visual archive + intentional physical collecting.**

| Rank | Defect | Global | Owned | Damage to the spine |
|---|---|---|---|---|
| **1** | Illustrator missing | 2,009 (8.45%) | 409 (8.56%) | **Severe.** A card with no illustrator cannot appear in *any* artist binder. It is structurally invisible to the product's organizing principle — not degraded, absent. |
| **2** | Temporal metadata missing | 23,780 (100%) | 4,776 (100%) | **Broad but shallow.** No card is hidden. Ordering may be wrong (unverified), era analysis is unavailable, and interpretation of ranks 1 and 3 is weakened without it. |
| **3** | Image missing | 1,640 (6.90%) | 114 (**2.39%**) | **Contained.** OL-2C.1 already fails safely to a calm neutral state. Owned exposure is *lower* than global — collectors hold the better-covered sets. |
| **4** | Artist FK stale | 499 (0 wrong) | — | **Zero today.** Fully recovered by the dynamic illustrator fallback path. Latent. |

**Note on rank 3.** Owned exposure (2.39%) sitting materially below global (6.90%) is itself a finding: image gaps concentrate in sets collectors do not hold. That argues against broad image remediation on its own merits, independent of OL-2C.1.

**Note on rank 4's fragility.** The recovery that falsifies F-2B is a property of being a *dynamic* entry — `cardService` uses `artist_id OR illustrator.in(...)` for those. Curated entries carrying an `artistId` use `.eq('artist_id', ...)` **only**. Promoting Suwama Chiaki to a curated roster entry would silently drop all 121 cards. The current safety is incidental rather than designed.

**Latent consumer note (does not block closure).** F-2B was falsified against `cardService` retrieval paths. OL-0D's `p_artist_id` filter was not tested and remains a possible FK-only consumer. No current user-facing Owned Library artist-filter workflow has been established, so this is recorded as a latent future consideration only. **CAT-0 is not reopened for it.**

---

## 6. Successor candidate comparison

| | **A. Temporal restoration** | **B. Illustrator enrichment** | **C. Image remediation** | **D. Artist FK repair** |
|---|---|---|---|---|
| Population | 23,780 (100%) | 2,009 global / 409 owned | 1,640 global / 114 owned | 499 |
| Root cause | **Confirmed** | Not revalidated (1,320 in the known backfill-target population; 689 uncharacterized) | Unproven; clustering consistent with upstream absence | **Confirmed** |
| New data source | **No** — already fetched and discarded | **Yes** — pokemontcg.io | Yes, and no permitted use | No |
| Cross-source correspondence | **None** | **Required + governance** | Required, and insufficient (§6.2) | None |
| Printing-identity risk | **None** — fields participate in no matcher, ownership, or verification rule | **Real** — the number-only join class OL-0A2b/OL-2B decline to globalize | Real | Low |
| Durability under current sync | Must be addressed explicitly (§6.1) | Not durable on `cards`; `card_extras` is the only durable channel | n/a | Recomputable |
| Product gain | Ordering, era context, analytical unblocking | **Highest** — makes 2,009 cards artist-reachable | Marginal — OL-2C.1 already contains it | Zero today |
| Ready to scope? | **Yes** | **No** — upstream cause not revalidated; governance and durable-channel decisions outstanding | No | Yes, but unjustified |

### 6.1 Why A precedes B — and the guardrail that makes it defensible

The sequencing argument is about **understanding catalog refresh and durability before enrichment**, not about A being free.

Illustrator enrichment writes values into the catalog. Under the current full-row upsert, a later sync rewrites `cards.illustrator` from whatever TCGdex returns. Enrichment written to `cards` is therefore not durable while that behavior stands, and the refresh/durability contract should be understood before enrichment is attempted. CAT-1 necessarily engages the sync path, so it is the natural and cheapest place to establish that understanding — on a field set with no identity implications.

**The guardrail, stated explicitly.** `series` and `release_date` are currently empty, so populating them has **no existing temporal data to overwrite**. That is *not* the same as CAT-1 being risk-free:

- the current sync path performs **full-row card upserts** and could rewrite unrelated fields — including `illustrator` (21,771 non-null), `artist_id` (3,588 non-null), `pricing` (19,897 non-null), `rarity`, `image_url`, and `set_name`;
- `card_extras` overrides live in a separate table and are unaffected;
- therefore **CAT-1 must explicitly preserve unrelated catalog fields** unless broader refresh behavior is separately inspected and approved.

CAT-1 is low-cost **only under that guardrail**. No claim of zero cost is made without it.

### 6.2 Why C is deferred and Probe B is unnecessary

**Probe B cannot change the next-slice decision.** Both outcomes lead to the same place:

- High verified-fallback coverage → those images **already render at runtime** via OL-2C.1. Nothing to build.
- Low coverage → no permitted remedy exists. OL-2C.1 requires `observed.id === card.id`; a set-ID translation returns the Pokémon TCG API's ID, which by construction is not the TCGdex ID, so `id_match` fails and the verdict shifts from `absent` to `mismatch`. **Nothing renders either way.** A real remedy would require a governed, individually verified cross-source exact-printing correspondence — an identity claim, outside CAT-0's remit.

**Defer Probe B.** Un-defer trigger: a future slice proposing fallback-aware editorial candidate selection (currently primary-image-gated for Dashboard feature/queue, Artist hero collage, Artist Directory preview). That is a presentation slice, not a catalog slice.

---

## 7. Recommendation

# CAT-1 — Temporal Metadata Restoration

**One slice. Selected.**

Selection rests on:

1. **Root cause fully confirmed** against the documented TCGdex API contract.
2. **Same TCGdex source already fetched** — `syncSet` retrieves the set detail carrying both fields and discards it.
3. **Existing database columns** — no schema change.
4. **No ownership or printing-identity implications** — `series` and `release_date` participate in no matcher rule, no ownership predicate, and no image verification check.
5. **Narrow deterministic defect** — a single extraction path with one known fix shape.
6. **It should precede illustrator enrichment** so catalog refresh and durability behavior are understood first. Era context is a genuine enabler for scoping later illustrator work, but it is a supporting benefit, not the sole basis for the ordering.

The `setOrder.js` / `sort.js` question changes CAT-1's **scope**, not its **rank**. Every other candidate is either not ready to scope (B), has no permitted remedy (C), or has zero current product impact (D).

**CAT-1's inspection phase must resolve, before any spec:**

- `src/constants/setOrder.js` — real chronology, or display order only? Display order must not be treated as chronology.
- `src/utils/sort.js` and the render path — does the UI re-sort, or is DB order the rendered order? This determines whether CAT-1 is purely additive or also alters visible ordering. **If it alters visible ordering, that is a behavior change requiring explicit approval.**
- **The field-preservation guardrail of §6.1** — how `series` and `release_date` are populated without rewriting unrelated fields under the current full-row upsert. Whether CAT-1 also addresses the broader refresh/durability contract, or performs a narrowly targeted population, is a scoping decision for its spec. This document pre-approves neither.

**Design input, not implementation:** the TCGdex Card object carries an `updated` (ISO 8601) field that `sync-cards.mjs` does not capture. A durable incremental sync could key on it rather than the current `storedCount >= briefCards.length` heuristic. Noted for CAT-1's spec to consider or reject.

**Explicitly not in CAT-1:** illustrator enrichment · image work · FK repair · ownership · SharedBinder · pricing · schema change · alias changes.

---

## 8. Defer list

| Item | Status | Un-defer trigger |
|---|---|---|
| Probe B (Pokémon TCG API fallback coverage) | Deferred | A slice proposing fallback-aware editorial candidate selection |
| Image remediation | Deferred | Evidence that owned-card image exposure materially exceeds 2.39%, or a separately established governed cross-source printing correspondence |
| Illustrator enrichment (1,320 backfill-target + 689 uncharacterized) | Deferred | Upstream cause revalidated, plus OL-2B-grade governance and a durable write-channel decision |
| Artist FK repair (499) | Deferred | An affected artist promoted to a curated roster entry, or an FK-only consumer established in practice |
| OL-0D `p_artist_id` filter semantics | Latent | Only if an Owned Library artist-filter workflow becomes user-facing |
| `add_artist_to_archive` duplicate-identity risk | Deferred | A second identity appearing for an existing illustrator |
| F-17 history reconciliation (three "card_extras FK fixes") | Deferred | Gate-3 implementation evidence surfaces |
| Duplicate non-unique indexes on `cards` | Deferred (P3) | A measured write-amplification concern |
| Historical backfill persistence question | **Not resolvable** from current evidence | Backfill run logs, if they exist |
| Pricing (3,883 null; stale variant-key comment in `sync-cards.mjs` vs current TCGdex docs) | Out of scope | A dedicated pricing slice |

---

## 9. CAT-0 closure status

**CAT-0 is closed.**

No further production SQL is required. No P0 escalation is open. All `possible_wrong_printing` classes are falsified (C-A1, C-A2), dormant (C-W1), or never observed (C-W2, C-W3).

### 9.1 Evidence of record

**The read-only query outputs recorded in this document and in the audit thread are the audit evidence.** All findings, counts, and verdicts above trace to those outputs. No finding depends on a CSV artifact.

### 9.2 Artifacts materialized

Generated from the production query outputs already supplied — no new queries, no derived estimates:

| Artifact | Content | Fidelity |
|---|---|---|
| `catalog_coverage_summary.csv` | Global, owned-snapshot, and per-set-scoped metrics that were explicitly reported | Complete for every metric it contains |
| `catalog_coverage_by_set.csv` | Complete per-set enumeration — 214 rows transcribed verbatim from the Q2.1 output | Complete; reconciles to 23,780 cards / 1,640 image gaps / 2,009 illustrator gaps / 51 fully-image-missing sets accounting for 1,370 gaps |
| `identity_conflicts.csv` | Header with **zero rows** — the null result is itself the evidence | Complete; conflict classes C-A1, C-A2, C-A4, C-A5, C-A6 all returned zero |
| `manifest.json` | Baseline, capture timestamp, materialization record, validation results | Complete |

### 9.3 Artifacts NOT materialized

The v2 plan §11 contemplated five CSV artifacts. Two were **not** produced, and this document does not claim otherwise:

| Planned artifact | Status | Reason |
|---|---|---|
| `illustrator_gaps.csv` | **Not materialized** | Genuinely requires per-card rows. Only aggregates and a small number of named illustrator strings were supplied. |
| `image_gaps.csv` | **Not materialized** | Genuinely requires per-card rows plus probe results. Probe A is blocked pending `src/utils/imageUrl.js`; Probe B is deferred (§6.2). |

These are **not** outstanding obligations. CAT-0's conclusions are fully supported without them, and regenerating them would require reopening production SQL, which is explicitly closed. If a future slice needs row-level evidence, the v2 plan §6 contains the exact read-only queries.

`era_token` remains empty under Gate G-4 until CAT-1 lands.

Read-only throughout. No fixes implemented, no production files modified, no production changes.
