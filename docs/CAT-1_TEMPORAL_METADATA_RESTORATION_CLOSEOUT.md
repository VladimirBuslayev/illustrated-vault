# CAT-1 — Temporal Metadata Restoration — Closeout

**Status:** ✓ **COMPLETE** — production validated 2026-07-28
**Type:** Catalog metadata restoration. Presentation-neutral.
**Supersedes:** the CAT-1B final specification's pending-validation status. The architecture in that document is unchanged; this records execution and results.

---

## 1. Outcome

**F-13 is resolved.** `series` and `release_date` were null on 23,780 / 23,780 cards. Both are now populated on 23,780 / 23,780 cards.

| Claim | Evidence |
|---|---|
| CAT-1 complete | Full execution sequence below, all gates passed |
| F-13 resolved | `release_date_null: 0`, `series_null: 0`, `empty_series: 0` |
| 23,780 / 23,780 populated, both fields | `release_date_present: 23,780`, `series_present: 23,780` |
| Presentation preserved | Ordering key removed *before* any temporal write; no rendered sequence changed |
| No schema change | No DDL executed at any point |
| No ownership, matcher, artist, image or pricing behavior changed | Non-temporal checksum byte-identical across the entire restoration |
| `SYNC_MODE=temporal` available for explicit reconciliation | Shipped and exercised, scoped and unscoped |
| Routine non-skipped syncs write temporal metadata after successful card upsert | Helper invoked for five sets; stored-row temporal write demonstrated on `exu`; zero failures |
| `SYNC_MODE=full` remains prohibited as a CAT-1 mechanism | Never used; prohibition documented in the sync header and DECISION_LOG |

---

## 2. Root cause (recap)

TCGdex types the Card object's `set` property as a **SetBrief**, which carries `cardCount`, `id`, `logo`, `name`, `symbol` only. `serie` and `releaseDate` exist solely on the full Set object from `GET /v2/en/sets/{id}`.

`sync-cards.mjs :: mapCardToRow` read `card.set?.serie?.name` and `card.set?.releaseDate`, so both resolved to `undefined` on every card. `set_name` was 100% complete because `name` *is* on the SetBrief — which isolated the defect to exactly those two fields. `syncSet` already fetched the full Set object carrying both values and discarded everything except `.cards`.

---

## 3. Architecture as shipped

Three changes across three files.

**G1 — the card-upsert path cannot express temporal columns.** `mapCardToRow` no longer emits `series` or `release_date`. Because `upsertRows` issues `INSERT … ON CONFLICT (id) DO UPDATE SET <payload columns>`, and neither column appears in that payload, the routine card-write path is *structurally incapable* of writing or nulling them — not conditionally safe, but unable to express the operation.

**G2 — `updateSetTemporal(setDetail)` is the sole writer.** At most two columns, scoped by `set_id`, built only from non-null upstream values, no write at all when both are absent. It never writes `last_synced_at` (the sync-recency signal and CAT-0 audit evidence) or any other column.

**C3 — the inert ordering key removed.** `cardService.js` no longer orders the artist path by `release_date`, leaving `set_id → local_id`. Shipped *before* any temporal write, so no window existed in which a live `release_date` could influence ordering.

**Supporting behavior:** `SYNC_MODE` allow-list `{incremental, temporal, full}`; optional `SYNC_SET_ID` single-set temporal scope by exact ID equality; temporal failures produce a non-zero workflow exit; missing `releaseDate` and missing `serie.name` tracked independently; reconciliation guidance is mode- and scope-aware.

**Files changed:** `sync/sync-cards.mjs` · `src/services/cardService.js` · `.github/workflows/sync-cards.yml` (three edits: `temporal` choice, optional `set_id` input, `SYNC_SET_ID` passthrough). `sync/package.json` unchanged. No `App.jsx`, `sort.js` or `setOrder.js` change. No new dependency.

---

## 4. Pre-restoration baseline

Captured before the first temporal production write, with the sync quiesced.

```
cards_total                23,780
distinct_sets                 214
series_null                23,780
release_date_null          23,780
card_extras                     5
max_last_synced_at         2026-07-27 09:42:59.029+00
max_pricing_updated_at     2026-07-20 08:52:37.368+00

non_temporal_checksum      dea458d003ff71a451079c0ed66a01fd
```

Checksum definition (whole-row, minus only the two temporal columns):

```sql
SELECT md5(
  string_agg(
    (to_jsonb(c) - 'series' - 'release_date')::text,
    '' ORDER BY c.id
  )
) AS non_temporal_checksum
FROM public.cards c;
```

---

## 5. Scoped temporal proof — `swsh3`

`SYNC_MODE=temporal`, `SYNC_SET_ID=swsh3`.

- Workflow succeeded.
- Exact scope selected **only** `swsh3`.
- **201 / 201** cards received `release_date = 2020-08-14` and `series = Sword & Shield`.
- Zero temporal values changed outside `swsh3`.
- `last_synced_at` unchanged. `pricing_updated_at` unchanged. `card_extras` remained 5.
- Non-temporal checksum remained exactly **`dea458d003ff71a451079c0ed66a01fd`**.

**This proves the scoped temporal write changed only the two authorized columns.** It is the cheap, early failure point: the write footprint was demonstrated on one set before being applied to the whole catalog.

---

## 6. Whole-catalog temporal restoration

`SYNC_MODE=temporal`, unscoped.

| Metric | Result |
|---|---|
| Upstream TCGdex sets inspected | 218 |
| Temporal operations succeeded | 218 |
| Failed | 0 |
| Sets missing upstream `releaseDate` | 0 |
| Sets missing upstream `serie.name` | 0 |
| Card upserts | **0** |

### Post-restoration production state

```
cards_total                23,780
distinct_sets                 214
release_date_present       23,780
release_date_null               0
series_present             23,780
series_null                     0
empty_series                    0
distinct_series                21
card_extras                     5
max_last_synced_at         2026-07-27 09:42:59.029+00   (unchanged)
max_pricing_updated_at     2026-07-20 08:52:37.368+00   (unchanged)

non_temporal_checksum      dea458d003ff71a451079c0ed66a01fd   (byte-identical)
```

### Reconciliation

Zero sets were missing either upstream field and zero sets failed, so both missing-field lists and the failed list were empty. The per-column reconciliation rule is therefore satisfied trivially and exactly:

- remaining `release_date` NULLs (0) = sets missing upstream `releaseDate` (0) ∪ failed sets (0);
- remaining `series` NULLs (0) = sets missing upstream `serie.name` (0) ∪ failed sets (0).

### Representative values

| Set | `release_date` | `series` |
|---|---|---|
| `base1` | 1999-01-09 | Base |
| `swsh3` | 2020-08-14 | Sword & Shield |
| `sv01` | 2023-03-31 | Scarlet & Violet |

### Reconciliation — 218 upstream sets vs 214 catalog sets

The restoration processed **218** upstream sets; the catalog holds **214** distinct `set_id` values. These reconcile exactly:

- **the complete 214-set CAT-0 inventory is a subset of the 218 sets processed by CAT-1**;
- **zero catalog set IDs were absent from the 218-set upstream run** — every set holding rows was covered;
- the four upstream set IDs with no rows in `public.cards` are exactly **`jumbo`, `rc`, `sp`, `wp`**.

Those four `UPDATE … WHERE set_id = X` statements matched zero rows: benign, idempotent, and complete coverage of the catalog. This is also why the planning documents' "≤214 UPDATEs" estimate understated the operation count.

Whether those four sets *should* hold rows is a catalog-coverage question, not a CAT-1 question. See §8 — they are upstream zero-card sets, which is the same fact seen from the sync side.

---

## 7. Routine incremental validation

The normal incremental workflow ran and succeeded.

- **27 cards upserted** — all from `exu`; the four zero-card sets contributed none (§8).
- **Five sets reached the post-upsert temporal helper:** `exu`, `jumbo`, `rc`, `sp`, `wp`.
- Zero temporal failures. Zero temporal nulls afterward.
- 27 cards had `last_synced_at` newer than the CAT-1 baseline.
- `exu` contains 27 stored cards; **all 27 retain `release_date = 2005-08-22` and `series = EX`** after the upsert.
- `cards_total` 23,780 · `distinct_sets` 214 · `pricing_updated_at` unchanged · `card_extras` 5.

### Post-incremental checksum — expected change

```
71b2cf06db50cf2f29a53e0ea30f4600
```

**This is expected and correct.** A normal card upsert legitimately rewrites non-temporal fields — `last_synced_at` on 27 cards among them — and the checksum covers those columns by design.

> **Do not compare this value to the pre-restoration checksum as a temporal-write control.** The temporal-write control is the §5–§6 comparison, where the checksum stayed byte-identical across a run that performed zero card upserts. Once a card upsert occurs, the checksum is measuring something else entirely.

### Phase 11 coverage — achieved naturally

The post-upsert temporal call was carried as a possible deferred observation in case no set turned out to be non-skipped. **The helper was invoked for five non-skipped sets; the stored-row temporal write path was demonstrated on `exu`, and the deferred observation is closed.**

Precisely: of those five, only `exu` holds rows in `public.cards`, so it is the one set in which the routine temporal write affected rows. The other four are upstream zero-card sets whose `UPDATE` matched nothing. The path is exercised, and `exu` is the case that demonstrates it. See §8.

---

## 8. Separate anomaly — `exu-%3F` (recorded, not repaired)

The incremental run attempted **28** `exu` cards; one card ID, `exu-%3F`, returned a **TCGdex 404**. Twenty-seven were upserted.

`%3F` is a URL-encoded `?`, so the upstream card ID appears to contain a literal question mark that does not resolve on the card-detail endpoint.

**Recorded as a separate catalog-source / card-ID anomaly. It did not block CAT-1 closure and was deliberately not repaired inside CAT-1.**

### Consequence worth tracking

`exu` stores **27** cards while upstream lists **28**. The incremental skip predicate is `storedCount >= briefCards.length`, so `27 >= 28` is false **permanently**. `exu` will therefore be re-synced on every weekly run, re-fetch all 28 card details, hit the same 404 each time, and re-upsert 27 rows indefinitely.

Two consequences, in opposite directions:

- **Cost:** a small, permanent, recurring weekly re-sync of `exu`, with `last_synced_at` churn on its 27 rows.
- **Benefit:** the post-upsert temporal path is exercised every week rather than rarely, which is why Phase 11 coverage arrived naturally.

This is the previously deferred **F-6 skip-predicate** issue showing a concrete instance. It remains deferred; it now has evidence attached.

### The five non-skipped sets — two distinct confirmed mechanisms

The five sets that reached the post-upsert temporal helper did so for two different, separately confirmed reasons. Neither is inferred.

**1. `exu` — stored count below upstream count.** Upstream lists 28 cards; `public.cards` stores 27, because `exu-%3F` 404s. `storedCount >= briefCards.length` is `27 >= 28`, false, permanently.

**2. `jumbo`, `rc`, `sp`, `wp` — upstream zero-card sets.** The skip predicate is `storedCount >= briefCards.length && briefCards.length > 0`. The trailing `briefCards.length > 0` clause means a zero-card set can never satisfy it, so these sets are processed on **every** incremental run regardless of stored state.

The production incremental log showed this directly:

```
Syncing wp — 0 cards
Syncing jumbo — 0 cards
Syncing sp — 0 cards
Syncing rc — 0 cards
```

These are the same four set IDs that hold no rows in `public.cards` (§6) — the coverage observation and the sync-side observation are one fact viewed from two directions.

**Consequence for the routine-path evidence.** All 27 upserted cards came from `exu`; the four zero-card sets contributed none. Their `updateSetTemporal` calls therefore matched zero rows. **`exu` is the single set in which the routine post-upsert temporal write affected real rows**, and it is the case that carries the Phase 11 result. The path is genuinely exercised, on one set, every week.

---

## 9. G1 empirical-proof status

| Line of evidence | Status |
|---|---|
| G1 **structural** invariant — `mapCardToRow` emits neither temporal key; `updateSetTemporal` is the sole writer; asserted by AST, not by grep | ✓ **Passed** |
| Production **temporal write boundary** — checksum byte-identical across scoped and whole-catalog temporal runs | ✓ **Passed** |
| **Natural routine path** — non-skipped incremental sync completed; temporal values intact afterward | ✓ **Completed** |
| **Isolated non-production G1 proof** — one-card upsert through `upsertRows([mapCardToRow(...)])`, no temporal writer involved | ⏸ **Deferred observation** |

The isolated proof was not run because no non-production Supabase environment was available. **No isolated production card mutation was manufactured**, and none should be: `mapCardToRow` still rewrites `illustrator`, `artist_id`, `pricing`, `rarity`, `image_url`, `set_name` and `last_synced_at`, so a production probe would be an unmandated mutation — and one made before a checksum capture would be absorbed into the baseline and become undetectable.

**This is a deferred observation, not a CAT-1 blocker.**

### What the routine path does and does not prove

The routine result is **composite evidence, not isolation.** In the routine path `updateSetTemporal` runs immediately after `upsertRows`, so if PostgREST *did* null the omitted columns on conflict (risk R8), the temporal writer would rewrite them within the same run and the failure would never surface. `exu` retaining `2005-08-22` / `EX` after its upsert is consistent with G1 holding **and** with G1 failing and G2 repairing.

No isolating evidence was available from this run, because **zero sets were missing an upstream temporal field** — the only routine configuration that could expose an unrepaired regression.

### Why the residual risk is small

The post-upsert placement, chosen for new-set correctness, also bounds the blast radius of an R8 failure:

- a **skipped** set receives no upsert, so no regression is possible;
- a **non-skipped** set whose upstream carries the values would be nulled and immediately rewritten — net restored within the same run;
- a **non-skipped** set whose upstream lacks a field would be nulled and not rewritten, but those rows were NULL already, never having been populated.

Under the currently observed upstream state — where every processed set supplied both temporal fields — an R8 failure would be repaired immediately by G2. **A future upstream field retraction remains the explicit unresolved case.** This is an argument for accepting the deferred observation — **not** a substitute for the isolated proof.

### When isolation would become possible

Only if a future set holds a stored non-null temporal value while its upstream field is absent — i.e. upstream retraction, whose policy is itself deliberately deferred. If that ever occurs, a routine non-skipped sync over that set would isolate G1 for free. Until then, isolation requires a non-production environment.

---

## 10. Durability policy — as shipped

Explicit asymmetry, **not** global monotonicity:

- temporal values **may** be populated;
- temporal values **may** be corrected by a later non-null upstream value;
- an **absent** upstream value may **not** erase a known non-null stored value.

CAT-1 prefers stale known temporal metadata over silent non-null → NULL regression. Upstream-retraction policy is **deferred** — it acquires a spec only if evidence emerges that TCGdex withdraws release dates in practice.

Outside the guarantee, documented rather than defended in code: direct SQL writes; a future `SYNC_MODE=full` run after G1 is reverted; any new write path added without reading the `sync-cards.mjs` header.

---

## 11. Guardrails held

- **`SYNC_MODE=full` was never used.** It remains prohibited as a CAT-1 mechanism; a full run would rewrite `illustrator`, `artist_id`, `pricing`, `rarity`, `image_url`, `set_name` and `last_synced_at`.
- **The 499 stale artist FKs (F-19) were not repaired**, despite a full sync being capable of it. Deferred to its own slice with its own guardrails.
- **The F-6 skip-predicate was not redesigned.**
- **No schema change, no RPC, no RLS, no view change, no new dependency.**
- **`App.jsx`, `sort.js` and `setOrder.js` untouched.** The missing `sortCards("name")` case remains unfixed and unreferenced — leaving it alone is precisely what kept CAT-1 presentation-neutral.
- **`ARTIST_SELECT` unchanged; cache key `pb9_supa_` not bumped.**
- **No production rows were deleted or altered to force a non-skipped path.**

---

## 12. Exit criteria — final

| # | Criterion | Result |
|---|---|---|
| 1 | Non-temporal checksum byte-identical across restoration | ✓ `dea458d0…` before and after |
| 2 | Both temporal columns populated; remaining NULLs reconcile per column | ✓ 0 NULLs; both lists empty; reconciles exactly |
| 3 | Runtime presentation unchanged — Binder, SharedBinder, Dashboard hero identity | ✓ |
| 4 | G1 static invariant passes before restoration | ✓ |
| 4b | G1 empirical proof — non-production, or recorded as pending observation | ⏸ Recorded as deferred observation; no production mutation authorized or performed |
| 5 | Routine-path regression clean | ✓ Five sets exercised the post-upsert path; zero temporal failures |
| 6 | Living docs updated; SORT-1 recorded | ✓ This closeout, `CURRENT_STATE.md`, `DECISION_LOG.md`, `ROADMAP.md` |

---

## 13. What CAT-1 unlocks — and what it does not decide

Now that `release_date` is populated, a read-only diff of `SET_ORDER` rank against true date order is available for free. It will characterize `src/constants/setOrder.js` exactly — where it agrees with chronology, where it deliberately departs, and which sets are unranked. **This is recorded as SORT-1's first input. It was not performed in CAT-1.**

Known already: `setOrder.js` is a **curated total ordering, not pure release-date chronology**. The TCG Pocket block sits after the Mega Evolution block despite earlier first sets, consistent with `hideTcgPocket` defaulting true; and 196 mapped set IDs cover 214 catalog `set_id` values, so at least 18 sets fall to `?? 999`.

**SORT-1 is a backlog candidate, not automatically the next major build.** CAT-1 does not choose the next slice. The next roadmap decision should deliberately weigh SORT-1 against a visible artist-first collector improvement, and be made on product grounds rather than on the momentum of having just finished catalog work.

---

## 14. Follow-ups opened by CAT-1

| Item | Disposition |
|---|---|
| `exu-%3F` TCGdex 404 | Catalog-source / card-ID anomaly. Recorded, not repaired. |
| `exu` permanently non-skipped (27 stored vs 28 upstream) | Concrete instance of the deferred F-6 skip-predicate issue. Evidence now attached. |
| `jumbo`, `rc`, `sp`, `wp` — upstream zero-card sets, no rows in `cards`, never skipped | Catalog-coverage observation and a second F-6 skip-predicate case. No action. |
| Isolated non-production G1 proof | Deferred observation. Run if a local/staging environment appears. |
| `SET_ORDER` vs true date order diff | SORT-1's first input. |
| Upstream temporal retraction policy | Deferred until evidence exists that TCGdex withdraws values. |

---

## 15. Commit

```
Close CAT-1 temporal metadata restoration
```
