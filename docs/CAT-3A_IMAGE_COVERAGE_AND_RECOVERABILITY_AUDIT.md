# CAT-3A — Image Coverage & Recoverability Audit

**Revision:** v2 (final specification, approved 2026-08-18). Supersedes the v1 proposal in full.
**Slice:** CAT-3A — Image Coverage & Recoverability Audit
**Parent:** CAT-2 — Catalog Trust & Visual Completeness (ROADMAP near-term item 1)
**Type:** Diagnostic only. Read-only. No implementation, no migration, no repair, no enrichment.
**Predecessors:** CAT-0 (closed) · CAT-1 (closed) · CAT-2D.1/.2 (deployed) · CAT-2D.3 Gate 0 (deferred, time-bound)

---

## 0. Status

```
STATUS:            PREPARED — NOT EXECUTED
Production SQL:    authored, NOT RUN
External probes:   authored, NOT RUN
Evidence:          none materialized
```

Commit 1 carries the audit package only. No production statement in this slice
has been executed, and no evidence artifact exists yet. Execution is a
separately approved step.

---

## 1. The question

> Why are catalog images missing, and which missing-image rows are recoverable
> from authoritative exact-printing sources under the **currently approved
> contracts**, without violating collector identity?

### 1.1 Governing product rule (unchanged, restated because this slice is about images)

Illustrated Vault is a premium visual archive for physical Pokémon card
collecting. Image completeness is strategically important, but **collector truth
outranks visual convenience.**

**No cross-printing or cross-language image substitution.** An image may only be
used when it is verified for the exact physical printing represented by that
catalog row. No artwork proxies. No "close enough" fallbacks.

### 1.2 Stated scope limit, binding on the closeout

CAT-3A measures **catalog fields** and **source availability**. It does **not**
measure surface rendering or collector-visible exposure.

Whether CAT-3A resolves CAT-0's open question — *"Are the 51 fully image-missing
sets structural upstream absences? **UNPROVEN**"* — is determined **at closeout**
by the coverage and indeterminate-population gates (G-9, G-10). It is not
asserted in advance, and a partial or indeterminate result closes nothing.

---

## 2. What the current architecture actually does

Established by repository inspection at `cd4a7ee`. Every claim carries its code
anchor.

### 2.1 The image path, end to end

```
TCGdex v2 /en
  GET /sets                → set summaries
  GET /sets/{id}           → set detail; .cards = CardBrief[]
  GET /cards/{id}          → Card detail — card.image (BASE url, no extension)
        │
        ▼
sync/sync-cards.mjs :: mapCardToRow()                    ← THE ONLY WRITER
        image_url: card.image ?? null                       (sync-cards.mjs:332)
        upsert(chunk, { onConflict: 'id' })              ← FULL-ROW OVERWRITE
        ▼
public.cards.image_url        nullable · no provenance column (CAT-0 F-9)
        ▼
public.cards_effective        image_url passed through verbatim; NOT overridable
                              — card_extras overrides illustrator and nothing
                              else (docs/sql/card_extras_and_view.sql)
        ▼
src/services/cardAdapter.js:22        image: row.image_url || null
        ▼
src/utils/imageUrl.js:8-9             imgSmall = `${card.image}/low.webp`
                                      imgLarge = `${card.image}/high.webp`
        ▼
src/components/CardImage.jsx          primary → retry → ptcgio-verified
                                      → retry → neutral
```

### 2.2 Two structural facts that govern everything below

**(a) `cards.image_url` is not a URL — it is a TCGdex asset *base* path.**

`imgSmall` / `imgLarge` append `/low.webp` and `/high.webp`
(`src/utils/imageUrl.js:8-9`). The stored form is e.g.
`https://assets.tcgdex.net/en/swsh/cel25/1`. The column is therefore
**structurally typed to one provider**. A pokemontcg.io URL written into it
would render as `.../4.png/low.webp` → 404 → retry → fallback → almost certainly
neutral.

Consequence: **the catalog column cannot currently carry a non-TCGdex image**
without a schema change or a change to `imageUrl.js`. Both are outside CAT-3A.

**(b) The runtime fallback is not a second source — it is a same-ID verifier.**

`imageService.performFetch` requests `api.pokemontcg.io/v2/cards/{card.id}` with
the **TCGdex id verbatim** (`imageService.js:218`), then requires
`id_match ∧ number_match ∧ name_match` where `id_match` is
`observed.id === card.id` (`imageService.js:262, 274`).

It is structurally incapable of resolving any card whose TCGdex id differs from
its pokemontcg.io id. There is no translation layer at runtime. The only
provider set-id correspondence anywhere in the repository is the 9-entry
`NULL_SETS` table in `sync/backfill-illustrators.mjs:32-42`, which is
illustrator-only and is not referenced by the image path.

### 2.3 Stored field is not rendered outcome (the CAT-2D.3 Q-F caveat, made precise)

- `image_url IS NULL` does not imply "renders neutral". It means: skip
  `PRIMARY`, enter `FALLBACK_PENDING`, attempt one same-ID pokemontcg.io
  verification (`CardImage.jsx:67, 138-162`).
- `image_url IS NOT NULL` does not imply "renders". A dead TCGdex asset also
  falls through.
- Separately, four editorial surfaces gate **synchronously** on `imgSmall(card)`
  (`App.jsx:286, 1007, 1021, 2895`), so a null `image_url` removes the card from
  the Vault Feature, the artist hero collage and the Artist Directory preview
  **regardless of what the runtime fallback would have resolved**.

CAT-3A measures the field. It does not measure the render.

---

## 3. Failure modes, grounded in code

Hypotheses to be tested. Not assumptions.

| # | Mechanism | Anchor |
|---|---|---|
| **FM-1** | **Upstream absence.** TCGdex omits `image` when it holds no asset; `card.image ?? null` writes NULL faithfully. No defect and no repair path from this source. | `sync-cards.mjs:332` |
| **FM-2** | **F-6 skip freeze.** `storedCount >= briefCards.length && briefCards.length > 0` skips the whole set. A count-complete set with NULL images is never re-fetched, so a later upstream asset publication is never ingested. | `sync-cards.mjs:540-545` |
| **FM-2b** | **The skip predicate counts raw `cards`, not `cards_effective`.** Retained obsolete/alias rows inflate `storedCount`. `cel25` holds 50 rows against 25 upstream and is therefore permanently skipped. | `sync-cards.mjs:519-525`; deliberately excluded from the CAT-2D.1 effective-catalog change (`sync-cards.mjs:452-455`) |
| **FM-3** | **Sync is paused** (CAT-2B0). Any upstream asset published since the pause is absent by construction, and this class grows monotonically while the pause holds. | `.github/workflows/sync-cards.yml:4-11` |
| **FM-4** | **Namespace retirement.** No delete pass and no rename handling (CAT-0 F-7). Rows in a retired namespace can never be refreshed. | `sync-cards.mjs:76-84` |
| **FM-5** | **Provider-ID mismatch.** The runtime fallback uses the TCGdex id verbatim and requires exact id equality. | `imageService.js:218, 262, 274` |
| **FM-6** | **Insufficient local metadata.** `fingerprintCard` returns `null` → immediate `mismatch`, **no request issued**. Bounded: CAT-0 measured `local_id_missing = 0`, `name_empty = 0`. | `imageService.js:136-142, 295-297` |
| **FM-7** | **Per-card fetch failure drops the row entirely** (`if (!card) continue`) rather than writing NULL — so this produces *missing rows*, not missing images, and self-heals via the count predicate. | `sync-cards.mjs:558-566` |

---

## 4. Preliminary reconnaissance — NON-AUTHORITATIVE

Recorded for transparency. A small number of read-only GETs were issued against
the two already-approved public sources during audit design, to establish that
the failure-mode hypotheses were worth testing. **These are not audit evidence.**
They are unversioned, unreconciled, sampled rather than complete, and compared
against CAT-0's 2026-07-27 baseline rather than current production. Every number
below must be re-established by the executed audit.

- TCGdex set-level availability was sampled for 14 catalog sets covering 746 of
  CAT-0's 1,640 missing rows. In each sampled set, DB image presence equalled
  current upstream image availability: `smp` 181=181, `svp` 192=192,
  `cel25` 24=24; and `cel25cc`, `swsh4.5sv`, `swsh12.5gg`, `B2a`, `sm3.5`,
  `sve`, `exu`, `mep`, `tk-xy-w`, `2011bw` all showed 0 upstream images.
- pokemontcg.io exposed 174 sets against TCGdex's 218. Of CAT-0's 67 sets
  holding at least one missing image, 53 (1,383 rows) had no verbatim-matching
  pokemontcg.io `set.id`.
- pokemontcg.io returned **intermittent 5xx on known-valid ids**
  (`base1-4` → 200/500/200; `xy1-1` → 500/200/200). This is the direct reason
  the P3-0 reliability gate exists.

Two corroborating facts already on record in this repository:

- **`exu`** stores 27 rows against 28 upstream, so the F-6 predicate is
  permanently false and the set was re-ingested on every incremental run
  (ROADMAP, "F-6 skip-predicate redesign"). It is still 100% image-missing.
- **`cel25`** base partition was 24/25 populated at CAT-0 while upstream
  currently offers 24/25 — consistent with a faithful mirror rather than a stale
  one.

**Provisional and to be falsified:** the hypothesis "DB stale / missed
ingestion" may have a near-zero population, i.e. `cards.image_url` may be a
faithful mirror of TCGdex availability. If the executed audit confirms this,
broad ingestion repair recovers approximately nothing.

---

## 5. Measurement model

Four dimensions. **Every missing-image row receives exactly one value in T, one
in F and one in A**, and exactly one derived value in O. Assignment rules are
deterministic and stated. Nothing is decided by judgement at classification time.

Domain throughout: rows of `public.cards_effective` where
`image_url IS NULL OR btrim(image_url) = ''`.

### 5.1 Dimension T — TCGdex state (primary approved source)

| T | Value | Assignment rule |
|---|---|---|
| **T1** | `TCGDEX_IMAGE_AVAILABLE` | Upstream resolves the exact catalog `id` and the record carries a non-empty `image`. |
| **T2** | `TCGDEX_ENTITY_PRESENT_IMAGE_ABSENT` | Upstream resolves the exact catalog `id`; `image` absent or empty. |
| **T3** | `TCGDEX_ENTITY_ABSENT` | Definitive 404/410 on the exact catalog `id`, **or** the catalog `set_id` is absent from the upstream set inventory. Sub-reason: `card_absent` or `set_namespace_absent`. |
| **T4** | `TCGDEX_INDETERMINATE` | 429/5xx/transport/parse failure unresolved after the retry budget, **or** the catalog `id` cannot be expressed in a request at all (`empty_id`, `unencodable_id` — a lone surrogate makes `encodeURIComponent` throw). |

**Punctuation ids are probed, not excused.** The `exu` anomaly recorded during
CAT-1 (`exu-%3F` returning 404) involves ids carrying `?` / `!`. Those encode
correctly and are probed normally; a 404 on such an id is a **genuine T3**, not a
probe defect. T4's encodability sub-reasons cover only ids that cannot form a
request, which is a much smaller class and may well be empty.

**T2 escalation rule.** A set-detail `CardBrief` that omits `image` is **not**
sufficient to assign T2. It escalates to a card-detail request. T2 may be
assigned from a set payload only when that payload is verified to carry `image`
for at least one member of the same set — proving the field is projected in that
response.

### 5.2 Dimension F — current-fallback state (Pokémon TCG API, under the runtime contract)

Evaluated in this precedence order. First match wins.

| F | Value | Assignment rule |
|---|---|---|
| **F0** | `FALLBACK_NOT_REQUIRED` | `T = T1`. The primary source already carries the image. |
| **F1** | `PTCGIO_INSUFFICIENT_METADATA` | `fingerprintCard(card)` returns `null`. The runtime issues **no request** (`imageService.js:295-297`); neither does the probe. |
| **F2** | `PTCGIO_NAMESPACE_UNREACHABLE` | The catalog `set_id` has no verbatim-matching `set.id` in the pokemontcg.io set inventory. Under the current contract the row is structurally unresolvable. **Derived from the set inventory, not per-card probing** — see the mandatory validation sample in §7.4. |
| **F3** | `PTCGIO_EXACT_VERIFIED` | 200; `images.small` and/or `images.large` present; `id_match ∧ number_match ∧ name_match` all strictly `true`. |
| **F4** | `PTCGIO_EXACT_ENTITY_VERIFIED_IMAGE_UNAVAILABLE` | 200; all three checks strictly `true`; no images. |
| **F5** | `PTCGIO_VERIFICATION_FAILED` | 200 with images, but any of the three checks is `false` or `null`. Mirrors the runtime verdicts `verification_mismatch` and `insufficient_remote_metadata` (`imageService.js:271-276`). A returned entity that fails the production verification contract is **neither absent nor indeterminate** and is never folded into another class. |
| **F6** | `PTCGIO_EXACT_ID_ABSENT` | Definitive 404/410 on the exact catalog id, in a set whose namespace **is** verbatim-reachable. |
| **F7** | `PTCGIO_INDETERMINATE` | 429/5xx/401/403/transport unresolved after the retry budget. **Never reclassified as absent.** |

Verification uses the normalizers **imported from
`src/services/imageService.js`** (`normalizeName`, `normalizeNumber`,
`normalizeSetIdForDiagnostics`, `fingerprintCard`). They are never
reimplemented. `set_match` is recorded as supporting evidence and participates
in no assignment, consistent with OL-2C.1.

**Keyless by design.** P3-0 and P3 send no `X-Api-Key`, because `imageService`
sends none. This measures the contract that actually governs production. A keyed
run would not. If a keyless run cannot clear G-8, that is itself the finding; a
keyed re-run may be proposed later as a separate, explicitly
non-runtime-equivalent measurement, and is not part of CAT-3A.

### 5.3 Dimension A — approved-alias image state

Domain: the **192 CAT-2D.2 alias to canonical pairs**
(`docs/cat-2d2-evidence/family-a-alias-set.csv`, deployed as
`public.card_identity_aliases`). Read from **raw `public.cards`**, because alias
rows are excluded from `cards_effective` by construction
(`cat-2d1-1-dark-alias-foundation.sql` §4).

| A | Value |
|---|---|
| **A1** | `ALIAS_IMAGE_CANONICAL_IMAGE` |
| **A2** | `ALIAS_IMAGE_CANONICAL_MISSING` |
| **A3** | `ALIAS_MISSING_CANONICAL_IMAGE` |
| **A4** | `ALIAS_MISSING_CANONICAL_MISSING` |
| **A0** | `NOT_APPLICABLE` — every row outside the 192-pair population |

**All 192 pairs are exported with their state (Q-A6b), not just A2.** Two alias
states can appear in the missing-image population:

| State | Canonical row is missing an image? |
|---|---|
| **A2** alias has image, canonical missing | **yes** |
| **A4** both missing | **yes** |
| A1 both have images | no |
| A3 alias missing, canonical has image | no |

An A2-only export would force every A4 canonical row to be labelled `A0`,
understating the dimension and making the promised 192-row census artifact
impossible to produce. A1 and A3 are exported too: the census must reconcile to
192, and a state that is absent by construction is worth showing to be absent.

**G-3 validates the count explicitly** against the CAT-2D.2 deployed population
of 192. A different count means the alias table has moved since CAT-2D.2, and
the audit is re-scoped rather than run against a population nobody approved.

A2 rows additionally carry an asset-liveness verdict from P4 (§7.5):
`ASSET_LIVE`, `ASSET_DEAD` or `ASSET_INDETERMINATE`. An A2 row is a recovery
*candidate* only when the retained alias asset is live. P4 probes A2 rows only —
A1 and A3 canonical rows already carry an image, and an A4 alias has no image to
probe.

**No image is copied, propagated, written or proposed as a mapping.** This
dimension quantifies only. The 192 pairs are already individually admitted
identity evidence from CAT-2D.2, so comparing image presence across them creates
no new identity claim.

### 5.4 Derived dimension O — recoverability outcome

Deterministic function of (T, F, A). Precedence top-down; first match wins. The
full T×F×A cross-tabulation is published alongside, so co-occurrence is never
hidden by the precedence.

| O | Value | Rule |
|---|---|---|
| **O0** | `INDETERMINATE` | `T4 ∨ F7 ∨ (A2 ∧ ASSET_INDETERMINATE)` |
| **O1** | `RECOVERABLE_TCGDEX_DETERMINISTIC` | `T1` — same approved source, same canonical id, no correspondence, no identity claim |
| **O2** | `CURRENT_RUNTIME_FALLBACK_ELIGIBLE` | `F3` — satisfies the current runtime fallback contract |
| **O3** | `RECOVERY_CANDIDATE_APPROVED_ALIAS` | `A2 ∧ ASSET_LIVE` |
| **O4** | `BLOCKED_METADATA` | `F1` |
| **O5** | `NOT_RECOVERABLE_UNDER_CURRENT_CONTRACTS` | everything else (`F2`, `F4`, `F5`, `F6`) |

**O2 is not a rendering claim.** It states that the row satisfies the current
runtime fallback contract. It does **not** state that the card is displayed:
editorial surfaces gate synchronously on `imgSmall(card)` (§2.3) and exposure is
unmeasured in this slice. The label is deliberately
`CURRENT_RUNTIME_FALLBACK_ELIGIBLE` and must not be paraphrased as "already
renders today".

---

## 6. Gate sequence

| Gate | Condition | On failure |
|---|---|---|
| **G-0** | Working tree clean; branch cut from current `origin/main`; sync quiesced — no active `sync-cards.yml` run, scheduled trigger remains paused per CAT-2B0 | STOP |
| **G-1** | **Q-A0** catalog invariants hold and reconcile to the post-CAT-2D.2 expected state | STOP — catalog integrity precedes coverage measurement |
| **G-2** | **Q-A1 through Q-A5, and Q-A7** complete; Q-A1 and Q-A2 reconcile exactly | STOP |
| **G-3** | **Q-A6b** exports exactly **192** pairs, each carrying an A state; **P4** completes over the A2 subset | Record the A-population as PARTIAL; withhold O3 |
| **G-4** | **Q-A8a** export produced; row count equals the Q-A1 missing count exactly | STOP — probes must not run against a partial inventory (same fail-closed discipline as `catalogIndexLoader.js:68`) |
| **G-5** | **P1** resolves every distinct catalog `set_id`, or marks it indeterminate | Indeterminate sets propagate T4 to their rows |
| **G-6** | **P2** assigns exactly one T to every exported row | STOP if any row is unassigned |
| **G-7** | **P3-0** two-stage reliability gate passes (§7.3) | **STOP — P3 does not run.** Source instability is recorded as a standalone finding; CAT-3A reports T- and A-findings only and withholds every F- and O-dependent conclusion |
| **G-8** | Every row **requiring a fallback verdict** carries exactly one F value from the vocabulary | `not_evaluated` when the fallback phase did not run |
| **G-9** | Completeness: every missing-image row carries exactly one T, one F, one A **and** one O, and totals reconcile (`Σ O = Q-A1 missing total`) | `not_evaluated` when the fallback phase did not run; STOP if false |
| **G-10** | **Conclusion gate** — see §6.1 | Withhold the conclusion at the corresponding scope |

### 6.0 G-8 / G-9 may never pass on a G-7 failure

`not_evaluated` is a **distinct third state**, not a synonym for `false`: the
gate was never tested, which is different from having been tested and failed.

If G-7 fails, no row has an F value and no outcome is derivable, so:

- **G-8** and **G-9** are `not_evaluated` — **never `true`**;
- every F- and O-dependent figure is withheld, including the whole decision
  framework;
- the T and A dimensions remain valid and are still reported.

A completeness gate computed from row count and T assignment alone would report
`true` on a run that hard-stopped at G-7. That is exactly the green light an
audit must never emit, and the probe's `computeGates` is written so it cannot.

### 6.1 G-10 — conclusion gate (three scopes, three different rules)

`O0` is the indeterminate population.

| Scope | Rule |
|---|---|
| **Per-set conclusion** | `O0 = 0` **for that set**. No tolerance. |
| **Active-owned missing-image conclusion** | `O0 = 0` across the active-owned missing-image population. No tolerance. Requires the Q-A7c linkage (§6.3). |
| **Global conclusion** | `O0 < 1%` of total missing rows **may be tolerated only if the worst-case sensitivity test (§6.2) proves the remaining indeterminate rows cannot change the selected roadmap outcome.** |

A global `O0` rate below 1% is **not by itself a sufficient conclusion gate.**
Both the **raw `O0` rate** and the **sensitivity result** are recorded, always,
whether or not the gate passes.

### 6.2 Worst-case sensitivity test

Assign every `O0` row to the **most actionable outcome that remains plausible
for that row given what is already known about it**:

| O0 cause | Most actionable plausible outcome |
|---|---|
| `T4` — TCGdex state unknown | → **O1** (`RECOVERABLE_TCGDEX_DETERMINISTIC`) |
| `F7` with `T2`/`T3` already established — TCGdex confirmed not to hold the image | → **O2** (`CURRENT_RUNTIME_FALLBACK_ELIGIBLE`); O1 is not plausible for these rows |
| `A2 ∧ ASSET_INDETERMINATE` | → **O3** (`RECOVERY_CANDIDATE_APPROVED_ALIAS`) |

Then re-run the §8 decision framework against the inflated counts.

- If the selected decision path / slice **changes**, the global recoverability
  conclusion is **withheld** and CAT-3A reports scoped findings only.
- If the recommendation is **unchanged even under that worst case**, the global
  conclusion may proceed, and the sensitivity margin is recorded.

### 6.3 Active-owned linkage — Q-A7c, and why it is operator-only

The active-owned `O0 = 0` gate and the decision framework's active-owned
weighting both need **per-row linkage** between a recoverability outcome (which
only the probe computes) and the owned population (which only the database
knows). Q-A7a and Q-A7b aggregate, so neither can supply it. Without the linkage
the active-owned gate is unmeasurable and would have to be silently dropped.

**Q-A7c** supplies it as a bare list of distinct catalog card ids representing
the active-owned missing-image population.

| Emitted | Not emitted |
|---|---|
| distinct catalog card ids, one column | user id · batch id · row id · quantity · anything per-user |

There is no user dimension in the projection at all. It is nonetheless a
projection of what the collector base collectively owns, which is not public
information — so it is an **input**, never an artifact:

- the raw id list **must not be committed**. `docs/cat-3a-evidence/inputs/` is
  gitignored so it cannot be committed by accident, and the operator deletes it
  when the run completes;
- the probe uses it **only** to compute aggregate active-owned outcome counts;
- **committed evidence carries aggregate counts only**;
- the probe's `buildEvidenceRecord` takes no owned-population argument, so there
  is no code path by which an owned id reaches `image_gaps.csv`. The safety
  harness asserts that structurally, against the exported evidence header and
  the record builder's own signature.

If the two exports are taken at different times the id sets will not reconcile.
The probe reports `reconciles: false` in that case and the active-owned figures
must not be trusted.

---

## 7. Probe behavior

All probes are read-only HTTP GETs against the two already-approved sources.
No credentials. No Supabase client is imported by any probe. Deterministic
ordering throughout, so a re-run is comparable to its predecessor.

Shared transport discipline: concurrency 1, minimum 250 ms spacing (mirrors
`sync-cards.mjs` `BATCH_DELAY_MS`), maximum 3 attempts, exponential backoff
1s / 4s / 16s with jitter, `Retry-After` honoured. **404/410 is definitive on
first response and is never retried.** 429/5xx/401/403/transport are retried,
then classified indeterminate — never absent.

### 7.1 P1 — TCGdex set-level inventory and availability

- `GET /v2/en/sets` (1 request) → upstream set inventory.
- `GET /v2/en/sets/{id}` for every distinct catalog `set_id`, and for every
  upstream set id absent from the catalog (drift reporting only).
- Records per set: exists upstream, upstream card count, count of briefs
  carrying `image`, and whether the brief payload carries `image` for any member
  — the T2-escalation discriminator (§5.1).
- Assigns `set_namespace_absent` → **T3** for every row of a catalog set absent
  upstream.

### 7.2 P2 — TCGdex row-level T assignment

- Rows in sets that P1 shows as uniformly imaged or uniformly unimaged **and**
  whose brief payload demonstrably carries `image` for at least one member are
  assigned from P1 with no additional request.
- Every other row gets `GET /v2/en/cards/{id}`, URL-encoded. An id that cannot
  be safely encoded is `T4 / unencodable_id`.
- Output: exactly one T per exported row.

### 7.3 P3-0 — Pokémon TCG API reliability gate (two stages)

Runs before P3. **P3 is unreachable if this gate fails.**

#### Why two stages

Stage 2 requires controls that are **known-valid pokemontcg.io ids**. A catalog
row with a populated `image_url` proves only that *TCGdex* served an asset — it
says nothing about whether the same id exists in pokemontcg.io. Nor does a
verbatim-matching set namespace: the providers agree on some set ids while still
disagreeing about individual card ids inside them.

Probing such a card and getting a 404 is a **legitimate provider-ID mismatch,
not a reliability failure**. Feeding it to the gate as a "known-valid control"
would trip condition 3 and hard-stop the audit over a healthy source.

Validity therefore cannot be established by SQL. It is established by probing.

#### Stage 1 — qualification

- Candidate pool: Q-A8b (populated-image catalog rows, at most 2 per set across
  every set), filtered to sets whose id matches a pokemontcg.io `set.id`
  verbatim, then a **deterministic stratified draw** of up to 120 candidates
  across the release-ordered pool so every era is sampled.
- Each candidate is probed by its **exact catalog id**.
- A candidate becomes **qualified** only by actually resolving to `F3` or `F4`
  — an exact-id success.
- Fewer than 20 qualified → the gate fails with an explicit reason. That
  outcome is itself a finding about provider-ID overlap, not a source-health
  verdict.

#### Stage 2 — the gate

- Controls: a **deterministic stratified (quantile) draw of 20** from the
  qualified set, spread across the qualified era/set range. Quantile positions
  rather than "the first 20 unique sets in release order", which would
  concentrate controls in whichever era qualifies first and prove nothing about
  the other namespaces.
- Each is re-probed. The gate measures how **reliably known-good ids resolve** —
  which is the property it is supposed to test.
- **Pass requires all three:**
  1. **at least 19 of 20** controls reach the expected definitive-valid result;
  2. **at most 1** control ends indeterminate;
  3. **0 false definitive classifications** — no qualified control may finish as
     `PTCGIO_EXACT_ID_ABSENT` or `PTCGIO_VERIFICATION_FAILED`.
- **On failure:** STOP at G-7. P3 does not run. Source instability is recorded
  as a first-class finding: the runtime maps 5xx to `error`, never caches it,
  and re-requests after a 60 s memory cooldown
  (`imageService.js:186-188, 314-321`), so a degraded upstream degrades the live
  fallback tier non-deterministically.

Condition 3 is the important one. It is what distinguishes a *slow* source from
an *unsound* one: a control now **known** to exist that comes back "absent" or
"verification failed" means the probe would misclassify real rows, and no amount
of retrying fixes it.

**Preserved across both stages:** exact catalog ids only. No translation, no
correspondence, no name/number lookup to find another identity. A candidate that
does not resolve under its own id is simply not qualified.

### 7.4 P3 — exact-ID fallback probe

- Runs only over rows not already assigned F0/F1/F2.
- `GET https://api.pokemontcg.io/v2/cards/{catalog_id}` — **the verbatim catalog
  id, exactly as `imageService.performFetch` does.**
- **No translation, no query-endpoint search, no set-id substitution, and no
  provider correspondence of any kind is authored, inferred, probed or
  persisted.** Where provider-ID mismatch is the limiting factor, its magnitude
  (the F2 population) is recorded as **evidence for a possible future
  source-correspondence / source-expansion slice** and carried no further here.
- Verification via the imported `imageService` normalizers.
  `id_match`, `number_match`, `name_match` and `set_match` are all recorded;
  only the first three participate in assignment.
- **F2 validation sample.** 25 F2 rows — whose value was *derived* from the set
  inventory rather than probed — are probed anyway, to confirm the derivation
  returns 404. If any returns 200, the F2 derivation is unsound: every F2 row is
  demoted to indeterminate pending a redesign. This is the only reason a
  per-card request is issued for an F2 row.

### 7.5 P4 — approved-alias asset liveness

Required by the Q-A6 decision. Without it, Q-A6 produces an unactionable number.

- Domain: the **A2** subset only (alias has image, canonical missing).
- `GET {alias_image_url}/low.webp` against `assets.tcgdex.net` — an
  already-approved host, and the exact URL `imgSmall` would construct.
- **`ASSET_LIVE` requires all three of: a 2xx, an `image/*` content type, and a
  NON-EMPTY body.** The body is consumed and its byte length checked. Status and
  content type alone are not sufficient — a CDN can answer 200 with the right
  content type and zero bytes, and calling that "live" would admit a recovery
  candidate whose asset does not actually render.

| Observation | Verdict |
|---|---|
| 2xx + `image/*` + bytes > 0 | `ASSET_LIVE` |
| 2xx + `image/*` + zero bytes | `ASSET_INDETERMINATE` |
| 2xx + non-image content type | `ASSET_INDETERMINATE` |
| 404 / 410 | `ASSET_DEAD` |
| 429 / 5xx / transport after budget | `ASSET_INDETERMINATE` |
- This is CAT-0's **Probe A**, which was blocked pending
  `src/utils/imageUrl.js`. That file now exists and has been inspected, so the
  probe is unblocked — but it is scoped **only** to the A2 population.
- **Primary-URL liveness across the roughly 22k populated rows is explicitly out
  of scope.** That is a dead-link question, not a missing-field question.

### 7.6 Why P4 is necessary rather than assumable

CAT-2D.2 recorded `alias_upstream_status = 404` for the alias ids — but that is
the **API** record on `api.tcgdex.net`. The image asset lives on
`assets.tcgdex.net`, a different host with a different lifecycle. Its liveness
must be measured, never inferred from the API status.

---

## 8. Decision framework

Runs only if G-10 passes, at the scope G-10 permits.

### 8.1 Inputs, in the order they are weighed

| Input | Source |
|---|---|
| `N(O1)`, its set distribution, and its **active-owned** exposure | P2 × Q-A2 × Q-A7 |
| `N(O3)` and its set distribution | Q-A6 × P4 |
| `N(O2)` | P3 — informational; implies **no build** |
| `N(O5)`, split F2 versus F4/F5/F6 | P3 |
| `N(O0)`, `N(O4)`, and the §6.2 sensitivity result | gates |

### 8.2 Candidate outcomes

| ID | Slice | Precondition | Constraint |
|---|---|---|---|
| **D-NONE** | No image slice. Publish the falsification. | `O1 + O3` immaterial globally **and** in active-owned exposure | — |
| **D-ALIAS** | Restore `image_url` on canonical survivors from their approved alias rows (O3) | `N(O3)` material; assets live | Narrowest available. No new source, no correspondence, no schema change, no runtime change — the value is already a TCGdex base URL, so `imgSmall` works unchanged. **Requires one explicit policy acceptance:** that a retained provider-history row is an admissible image source for *its own* CAT-2D.2-approved canonical survivor. CAT-2D.2 admitted those 192 pairs individually as one physical printing, so the acceptance is narrow — but it must be stated and approved, never assumed |
| **D-INGEST** | Targeted re-ingestion of O1 rows | `N(O1)` material | Requires defeating FM-2 and FM-2b. **This is the same maintenance-ingestion capability CAT-2D.4 is blocked on.** Built once, it unblocks both — a genuine argument for D-PREREQ over a bespoke D-INGEST |
| **D-PERSIST** | Persist verified exact-printing fallback images | — | **Structurally blocked; cannot be selected by CAT-3A.** See §2.2(a). CAT-3A **sizes** this option and stops |
| **D-SOURCE** | Source-coverage expansion | — | Out of scope. CAT-3A produces the F2 magnitude as evidence only |
| **D-PREREQ** | A narrower prerequisite — maintenance-ingestion capability, or an image provenance / durable override channel | The recoverable population is real but no existing path can durably deliver it | The durable-channel gap is on record: no image provenance column (CAT-0 F-9), no durable image override channel (`card_extras` overrides illustrator only), and a full-row upsert that rewrites `image_url` |

### 8.3 Selection rules

1. **Never** select D-PERSIST or D-SOURCE from CAT-3A.
2. Prefer the candidate with the highest trustworthy gain per unit of identity
   risk. D-ALIAS and D-INGEST both carry zero cross-printing risk; D-ALIAS
   additionally carries zero new-capability cost.
3. Active-owned exposure (Q-A7) weights the ranking. CAT-0 found owned gaps
   (2.39%) materially below global (6.90%); if that holds, it argues down any
   broad remedy independently of source availability.
4. If D-INGEST would be selected, evaluate D-PREREQ first on the CAT-2D.4
   convergence.
5. Any conclusion resting on a population containing `O0` rows is stated as
   scoped, never global.
6. **Do not default to a Celebrations-specific special case.** `cel25` and
   `cel25cc` are measured as named populations because CAT-2D.3 Q-F surfaced
   them, but they are a test case for the general mechanism, not a slice.

---

## 9. Execution contract

### 9.1 Production SQL — `docs/sql/cat-3a-image-coverage-baseline.sql`

- every statement is `SELECT`-only — no DDL, no DML, no RPC, no sync;
- **no** TEMP tables, **no** `begin`/`commit`, **no** `set_config`, **no** auth
  impersonation. CAT-2D.2 established that this workflow must not depend on
  cross top-level-statement TEMP or session state, and nothing here does;
- each statement is **independently self-contained**. Run them in any order, in
  any session, any number of times. None reads state produced by another;
- run as the migration owner or a privileged role. These are global diagnostics
  across all users, so RLS must not scope them — which is why no JWT context is
  established. **No user UUID appears in the file, and no statement emits one.**
  Q-A7 is written to return counts only for exactly that reason;
- base-table choice is stated explicitly per query and is load-bearing.
  `cards_effective` excludes the 192 alias rows; raw `cards` includes them.
  Exactly two statements read raw `cards` for a population the view cannot
  express: **Q-A2b** (the historical Celebrations partition, which no column in
  the view separates) and **Q-A6** (the alias rows, which the view excludes by
  construction). No other statement may;
- **Q-A7c is operator-only and is never committed** (§6.3).
  `docs/cat-3a-evidence/inputs/` is gitignored to enforce that.

#### Query inventory

| Query | Purpose | Gate |
|---|---|---|
| **Q-A0** | Catalog invariants and post-CAT-2D.2 reconciliation | G-1 |
| **Q-A1** | Global coverage, both base tables; NULL and BLANK counted separately | G-2 |
| **Q-A2** | Per-set coverage, complete enumeration | G-2 |
| **Q-A2b** | **Celebrations named populations** — `cel25` live numeric partition, historical Classic Collection partition, `cel25cc`; remeasurement only | G-2 |
| **Q-A3** | Coverage partitions and concentration | G-2 |
| **Q-A4a/b/c** | Live-schema dimension discovery; coverage by series; by release year | G-2 |
| **Q-A5a/b** | `image_url` shape census; distinct hosts | G-2 |
| **Q-A6a** | Approved-alias image census, aggregate by state | G-3 |
| **Q-A6b** | **Full 192-pair state export** — probe input | G-3 |
| **Q-A7a/b** | Active-owned exposure, global and by set; counts only | G-2 |
| **Q-A7c** | **Active-owned missing-image card ids** — operator-only probe input | G-10 |
| **Q-A8a** | Missing-image row export — probe input | G-4 |
| **Q-A8b** | P3-0 control candidate pool — probe input | G-7 |

#### Q-A2b — Celebrations, remeasurement only

Q-A2 groups by `set_id`, and the live Celebrations base set and the historical
Classic Collection reprints both live under `set_id = 'cel25'`. Grouping by set
therefore cannot report them separately, and the figure CAT-2D.3 called *"the
single most decision-relevant number in the audit"* is invisible in Q-A2's
output.

Q-A2b reuses **CAT-2D.3's population selector verbatim** and reports rows total,
image missing, image populated and `cards_effective` membership for each of the
three populations.

**It pairs nothing.** No historical → survivor mapping is proposed, derived or
implied. CAT-2D.3's admission rules are untouched. The selector's known
limitation — it proves size/range/gap/duplicate consistency but not membership —
is carried forward explicitly, and does not matter here because coverage is
reported for both partitions and their total.

### 9.2 Probes — `scripts/cat3a-image-probe.mjs`

- no Supabase import, no credentials, no environment secret of any kind;
- no write verb of any kind against any store;
- normalizers imported from `src/services/imageService.js`, never
  reimplemented;
- P3 is unreachable unless P3-0 passes;
- indeterminate is never coerced to absent;
- no translated provider set-id, and no correspondence table.

### 9.3 Live-schema discipline

Q-A4a performs `information_schema` discovery of `public.cards` and
`public.cards_effective` rather than trusting the repository's column inventory.
This applies the CAT-2D.2 engineering rule — *any future card-ID migration must
begin with live-schema `information_schema` discovery* — to dimension
availability. CAT-2D.2 used a static reference inventory and missed
`artists.signature_card_id`. CAT-3A does not repeat that: the claims "there is no
`language` column" and "there is no image provenance column" are **proven from
the live catalog**, not asserted from the repo.

---

## 10. Evidence artifacts (Commit 2 — not present in Commit 1)

| Artifact | Content |
|---|---|
| `docs/cat-3a-evidence/manifest.json` | Baselines, capture timestamps, probe version, gate results (including `not_evaluated` states), threshold values, sensitivity result, **the SHA-256 of the executed `cat-3a-image-coverage-baseline.sql`**, validation record |
| `docs/cat-3a-evidence/image_coverage_by_set.csv` | Q-A2 and Q-A3 |
| `docs/cat-3a-evidence/upstream_image_availability.csv` | P1 |
| `docs/cat-3a-evidence/alias_pair_image_census.csv` | Q-A6b and P4 — **exactly 192 rows**, every approved pair with its A state; liveness populated for A2, `ASSET_NOT_APPLICABLE` elsewhere |
| `docs/cat-3a-evidence/image_gaps.csv` | Per-row `T`, `F`, `A`, `O` plus reason codes and the three `*_match` values, preserving `true`/`false`/`null` semantics. **No ownership column** — see §6.3. This is the artifact CAT-0 planned and could not materialize |

**Not an artifact, ever:** `docs/cat-3a-evidence/inputs/` — the operator-only
SQL exports, including the Q-A7c owned id list. Gitignored.

**On checksums.** `docs/sql/SHA256SUMS.txt` is a **deployment-SQL** checksum
manifest covering the OL-0D deployment set. CAT-3A does not broaden its
semantics and adds nothing to it. The SHA-256 of the reviewed and executed
CAT-3A baseline SQL is recorded in this slice's own evidence manifest instead,
which is where an audit's execution provenance belongs.

---

## 11. Scope boundary

CAT-3A **does not**: modify production · run any production write · add or change
an alias · change any schema object, view, RPC or RLS policy · change runtime
image logic · change `imageUrl.js`, `imageService.js` or `CardImage.jsx` · change
any file under `src/` or `sync/` · change any workflow · resume or trigger sync ·
introduce a new external image source · author, infer, probe or persist a
translated provider-set correspondence · proxy an image across printings or
languages · special-case `cel25cc` · perform any CAT-2D.3 identity mapping ·
implement any repair.

Commit 1 additionally carries **no production output, no evidence CSV, no
findings, and no roadmap / current-state closeout.**

### 11.1 The one file outside `docs/` and `scripts/`

`.gitignore` gains a single rule, `docs/cat-3a-evidence/inputs/`. It exists to
make §6.3's "the raw owned id list must never be committed" structural rather
than procedural. It ignores a path that does not yet exist and changes no
existing repository behavior.
