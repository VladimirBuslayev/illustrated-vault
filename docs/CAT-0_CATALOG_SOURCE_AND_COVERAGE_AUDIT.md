# CAT-0 — Catalog Source & Coverage Audit — Architecture & Audit Plan

**Revision:** v2 — supersedes v1 (2026-07-27) in full. Not an addendum.
**Slice:** CAT-0 — Catalog Source & Coverage Audit
**Type:** Diagnostic only. No implementation, no migration, no repair, no enrichment.
**Predecessor:** OL-2C.1 — Image Resilience (closed 2026-07-24)
**Successor (gated, unapproved):** one narrow evidence-backed catalog slice → OWN-1
**Baseline pinned:** 2026-07-27 13:55:39.684177+00 (CAT-0A production introspection)

---

## 0. Status and evidence baseline

### 0.1 CAT-0A — COMPLETE. Gate G-1: **PASS**

CAT-0A ran against production. The catalog boundary is structurally trustworthy enough to measure.

```
cards_total                 23,780
effective_total             23,780
effective_distinct_ids      23,780
effective_null_ids               0
extras_total                     5
artists_total                   22
captured_at                 2026-07-27 13:55:39.684177+00
```

G-1 evaluation:

- `effective_null_ids = 0` → no null canonical IDs. **Pass.**
- `effective_total − effective_null_ids = effective_distinct_ids` (23,780 = 23,780) → no duplicate canonical IDs. **Pass.**
- One effective row per base `cards` row. No fan-out.

**Proceed to CAT-0B.**

### 0.2 Corrections to v1 that the evidence forced

Recorded explicitly rather than silently revised.

| v1 claim | Status | Correction |
|---|---|---|
| **F-8** — two independent defenses against duplicate ids "raise the prior that the condition is real"; P0-candidate | **RETIRED — the claim was wrong** | Production shows zero duplicates and a PK on `card_extras.card_id` that makes fan-out structurally impossible. Defensive code is not evidence that the defended-against condition exists. That inference was unsound and should not be repeated. |
| §2.3 reasoning from defensive code to a live defect | **Withdrawn** | `catalogIndexLoader`'s duplicate check and OL-0D's dedupe are now correctly read as fail-closed hygiene against a *possible future* view change, not as symptoms. |
| Era hierarchy `series → release_date → era_unknown` | **INVALID** | Both fields are null across all 23,780 rows. The hierarchy would classify the entire catalog `era_unknown`. All era-dimensioned output is **suspended** (§5). |
| M-03 / M-04 / M-14 / M-15 / M-19 as open coverage defect classes | **Reclassified** | Now structurally impossible under the confirmed contract. Retained as cheap **invariant assertions** only (§4.2). |
| F-1 "erases every backfill result" | **Overstated** | Corrected wording in §7. |
| F-2 as a single finding | **Split** | F-2A (proven data state) vs F-2B (unmeasured product impact). |
| F-3 at P0 | **Reclassified** | P1; P0 only on evidence of actual printing-identity corruption. |
| H-IMG-1 remedy "a curated set-id correspondence table" | **Tightened** | A translation table alone cannot work under OL-2C.1's ID-equality requirement (§9.3). |
| Q3.3 `\uXXXX` regex escapes | **Bug — fixed** | PostgreSQL regex does not interpret `\uXXXX`. Rewritten using `chr()` (§6, Q3.3). |
| Baselines 23,314 / 23,604 / "20 artists" | **Superseded** | Re-pinned to 23,780 / 22 at the timestamp above. |

### 0.3 Evidence inspected

**Production (CAT-0A):** object definitions, column contracts, constraints, indexes, identity gate, series/release-date vocabulary.

**Repository:** `sync-cards.mjs`, `backfill-illustrators.mjs`, `cardService.js`, `cardAdapter.js`, `catalogIndexLoader.js`, `snapshotMatcher.js`, `ownedLibraryService.js`, `imageService.js`, `tcgdexService.js`, `ol0aAllowlist.js`, `config.js`, `package.json`, `CURRENT_STATE.md`, `OL-2C.1_CLOSEOUT.md`.

**Still absent** (each blocks a *specific named phase*, not the audit as a whole — see §12): `src/constants/setOrder.js`, `src/constants/artists.js`, `src/utils/imageUrl.js`, `src/utils/keys.js`, `add_artist_to_archive` body, OL-0B snapshot table column names, full `sync/` listing.

---

## 1. `cards_effective` contract — from facts

### 1.1 The actual definition

```sql
SELECT c.id, c.name, c.set_id, c.set_name, c.local_id,
       COALESCE(ce.illustrator_override, c.illustrator) AS illustrator,
       c.image_url, c.rarity, c.release_date, c.pricing,
       c.pricing_updated_at, c.pricing_source, c.last_synced_at, c.artist_id
FROM cards c
LEFT JOIN card_extras ce ON c.id = ce.card_id;
```

### 1.2 Contract, field by field

| Field | Source | Override? | Notes |
|---|---|---|---|
| `id` | `cards.id` | No | PK, `NOT NULL`. Canonical identity for ownership, caching, snapshots. |
| `name` | `cards.name` | No | `NOT NULL` (empty string still possible). |
| `set_id` | `cards.set_id` | No | Nullable at write (`card.set?.id ?? null`). |
| `set_name` | `cards.set_name` | No | Nullable. Adapter falls back to `set_id` for display. |
| `local_id` | `cards.local_id` | No | Nullable. Text (holds `GG19`, `SWSH284`). |
| `illustrator` | `COALESCE(ce.illustrator_override, c.illustrator)` | **Yes — the only overridable field** | |
| `image_url` | `cards.image_url` | No | Nullable. |
| `rarity` | `cards.rarity` | No | |
| `release_date` | `cards.release_date` | No | **Null across all 23,780 rows** (§8, F-13). |
| `pricing`, `pricing_updated_at`, `pricing_source`, `last_synced_at` | `cards.*` | No | |
| `artist_id` | **`cards.artist_id` directly** | **No** | FK → `artists(id)`. **Not derived from the effective illustrator** (§8, F-15). |

### 1.3 Structural consequences (each now a fact, not an assumption)

1. **Base authority is `cards`.** `card_extras` overrides illustrator and nothing else.
2. **No `WHERE` clause.** No `cards` row can be filtered out of the view.
3. **`card_extras.card_id` is PK + FK → `cards(id)` ON DELETE CASCADE.** The join cannot fan out. Orphan extras rows cannot exist.
4. **`cards → cards_effective` row loss is structurally impossible.** LEFT JOIN + no WHERE + PK on both sides.
5. **`cards.artist_id` FK → `artists(id)`.** Dangling artist references are impossible.
6. **The view exposes 14 columns and does not expose `series`.** Any per-series analysis must query `cards` directly — and `series` is globally null anyway (§8, F-13).
7. **`illustrator` and `artist_id` can disagree by construction** whenever an override is present, because the COALESCE applies to one and not the other. Blast radius today: 5 rows (§8, F-15).

### 1.4 Consumer compatibility (verified)

`cardService.ARTIST_SELECT` requests 12 columns; all 12 exist in the view. `catalogIndexLoader` requests 5; all exist. `cardAdapter.supaRowToCard` reads 11 plus stamps `ownershipNamespace`; `pricing_source` and `last_synced_at` are exposed by the view but unread by the adapter — harmless.

---

## 2. Catalog lineage

### 2.1 Lineage map

```
TCGdex v2 /en
   │  GET /sets            → set summaries
   │  GET /sets/{id}       → set detail + brief card list   [fetched, then DISCARDED
   │                                                          except .cards — see F-13]
   │  GET /cards/{id}      → per-card detail                [1 request per card]
   │
   ├─► sync-cards.mjs :: mapCardToRow()
   │        identity  : card.id
   │        write     : upsert(chunk, { onConflict: 'id' })  ← FULL-ROW OVERWRITE
   │        derived   : artist_id = resolveArtistId(illustrator, aliasMap)
   │        reshaped  : pricing = adaptPricing()
   │        null-fed  : series ← card.set?.serie?.name       [globally null]
   │                    release_date ← card.set?.releaseDate [globally null]
   ▼
 cards (23,780)  ◄─── backfill-illustrators.mjs
   │                    source : pokemontcg.io /v2/cards
   │                    key    : (supaId, local_id) ← (ptcgId, number)  [number-only]
   │                    write  : UPDATE cards SET illustrator WHERE illustrator IS NULL
   │                    NOT written: artist_id, last_synced_at
   │
   ├── card_extras (5)   PK card_id, FK → cards(id) CASCADE
   │                     overrides illustrator ONLY
   │                     writer: manual — no script in repo
   ▼
 cards_effective (23,780)   LEFT JOIN, no WHERE, COALESCE on illustrator only
   │
   ├─► illustrator_directory   max(artist_id) GROUP BY illustrator  ← masks conflicts (§8, F-16)
   ├─► cardService.fetchArtistCards()
   ├─► catalogIndexLoader.loadCatalogIndex()
   ├─► get_active_import_snapshot_read_model
   └─► binderService

 artists (22)   PK id; written manually + add_artist_to_archive
                read by sync-cards.mjs :: loadArtistAliasMap()
```

### 2.2 Write-precedence table

| Object | Writer | Precedence | Durability under a full sync |
|---|---|---|---|
| `cards` (all columns) | `sync-cards.mjs` | Full-row overwrite on `id` | n/a — it *is* the sync |
| `cards.illustrator` | `backfill-illustrators.mjs` (only where NULL) | Loses to the next sync of that set | **Not durable** (§7, F-1) |
| `cards.artist_id` | `sync-cards.mjs` only | Recomputed from `cards.illustrator` at every upsert | Recomputed |
| `card_extras.illustrator_override` | Manual | Wins in the view via COALESCE | **Durable** — different table, untouched by sync |

**Architectural observation:** `card_extras` is currently the *only* durable illustrator-enrichment channel. Direct `UPDATE` on `cards` — what the backfill did — is not durable. This is evidence for scoping a successor slice; it is not a recommendation to migrate anything now.

---

## 3. Baseline drift

| Baseline | Value | Source |
|---|---|---|
| 23,314 | OL-0C full-catalog equivalence | Superseded |
| 23,604 | OL-2B alias validation | Superseded |
| **23,780** | **CAT-0A, 2026-07-27** | **Current — pin all CAT-0 output to this** |
| artists: 20 → **22** | Two additions since `CURRENT_STATE.md` | Consistent with `add_artist_to_archive` |

Growth from 23,604 → 23,780 proves syncs have run since 2026-07-15. **Which mode** is unknown and is decisive for F-1. §10 Q6.2 converts that from an unanswerable operational question into a query.

---

## 4. Metrics

### 4.1 Active metrics

| # | Metric | Token | Dimension |
|---|---|---|---|
| M-01 | Total `cards` | `cards_total` | global |
| M-06 | `image_url IS NULL` | `image_url_missing` | global, set |
| M-07 | `illustrator IS NULL` | `illustrator_missing` | global, set |
| M-08 | `illustrator IS NOT NULL AND artist_id IS NULL` | `artist_id_unresolved` | global, set, artist |
| M-09 | `set_id IS NULL` | `set_id_missing` | global |
| M-10 | `local_id IS NULL` | `local_id_missing` | global, set |
| M-11 | `set_name IS NULL` | `set_name_missing` | global, set |
| M-12 | `btrim(name) = ''` | `name_empty` | global |
| M-20 | Importer-unreachable (`name`/`set_name`/`local_id` any null-or-empty) | `matcher_unreachable` | global, set |
| M-05 | Duplicate `(set_id, local_id)` | `dup_set_number` | global, set |
| M-16 | Illustrator strings with no `artists` alias match | `illustrator_unaliased` | global |
| M-17 | Illustrator strings collapsing under NFKC + fold | `illustrator_near_dupe` | global |
| M-18 | Aliases claimed by >1 artist | `alias_collision` | global |
| **M-21** | **`illustrator_directory` rows masking >1 distinct `artist_id`** | `directory_artist_conflict` | global |
| **M-22** | **`card_extras` rows whose override and `artist_id` disagree** | `extras_fk_divergence` | global (n≤5) |
| **M-23** | **Tracked-artist rows reachable by illustrator but not by FK** | `artist_fk_exposure` | artist |

### 4.2 Demoted to invariant assertions

Structurally impossible under §1.3. Each is one cheap query; a non-zero result means the view definition changed and the audit must halt.

| Was | Token | Why impossible |
|---|---|---|
| M-02/M-03 | `effective_row_parity` | LEFT JOIN + no WHERE + PK |
| M-04 | `effective_dup_id` | Confirmed 0; no fan-out path |
| M-14 | `extras_orphan` | FK ON DELETE CASCADE |
| M-15 | `extras_fanout` | PK on `card_id` |
| M-19 | `artist_fk_orphan` | FK → `artists(id)` |

### 4.3 Suspended

`release_date_missing` and all era-dimensioned metrics. Both known to be 100% null; folded into F-13 as a root-cause investigation rather than a coverage percentage. **No artifact may carry a populated `era_token` column until F-13 is resolved** (Gate G-4).

---

## 5. Era / chronology — suspended

`series` and `release_date` are null for 23,780/23,780. The v1 era hierarchy is invalid.

**Not permitted:** inferring era from set-ID prefixes, set-name pattern matching, or a hand-built map created to preserve the prior audit design.

**Required first:** inspect `src/constants/setOrder.js` — the repo already contains a curated set-ordering constant, and `CURRENT_STATE.md` confirms it is in `src/constants/`. If it encodes a chronology, that is existing governed project evidence and is the correct substitute. If it is only a display-ordering list with no dates, it is not a chronology and must not be treated as one.

Until then, **all breakdowns are by `set_id` only.** Set-level granularity is sufficient for every P0–P2 question in this audit; era is a reporting convenience, not a blocker.

---

## 6. Read-only SQL — validated against the confirmed schema

All statements are `SELECT`. No writes, DDL, `ANALYZE`, or mutation. Every column referenced is confirmed present.

### CAT-0B — Identity integrity and field coverage

```sql
-- Q1.INV  Invariant assertions. All four MUST return 0.
--         Any non-zero ⇒ the view contract changed ⇒ HALT (Gate G-1b).
SELECT
  (SELECT COUNT(*) FROM public.cards c
     LEFT JOIN public.cards_effective e ON e.id = c.id
   WHERE e.id IS NULL)                                    AS inv_rows_lost,
  (SELECT COUNT(*) FROM public.cards_effective)
    - (SELECT COUNT(DISTINCT id) FROM public.cards_effective) AS inv_dup_ids,
  (SELECT COUNT(*) FROM public.card_extras x
     LEFT JOIN public.cards c ON c.id = x.card_id
   WHERE c.id IS NULL)                                    AS inv_extras_orphan,
  (SELECT COUNT(*) FROM public.cards_effective e
     LEFT JOIN public.artists a ON a.id = e.artist_id
   WHERE e.artist_id IS NOT NULL AND a.id IS NULL)        AS inv_artist_orphan;

-- Q1.2  Duplicate (set_id, local_id) printing identities.
--       THE remaining open identity question. PK is on id; nothing prevents
--       two distinct canonical ids sharing a set + number.
SELECT set_id, local_id, COUNT(*) AS n,
       COUNT(DISTINCT name) AS distinct_names,
       array_agg(id ORDER BY id)   AS card_ids,
       array_agg(DISTINCT name ORDER BY name) AS names
FROM public.cards_effective
WHERE set_id IS NOT NULL AND btrim(COALESCE(local_id,'')) <> ''
GROUP BY set_id, local_id
HAVING COUNT(*) > 1
ORDER BY distinct_names DESC, n DESC, set_id, local_id;

-- Q2.1  Per-set field coverage. Backing query for catalog_coverage_by_set.csv.
--       No series column: cards_effective does not expose it.
SELECT
  COALESCE(set_id,'(null)') AS set_id,
  MIN(set_name)                                                   AS set_name,
  COUNT(*)                                                        AS cards_total,
  COUNT(*) FILTER (WHERE image_url IS NULL)                       AS image_url_missing,
  COUNT(*) FILTER (WHERE illustrator IS NULL)                     AS illustrator_missing,
  COUNT(*) FILTER (WHERE illustrator IS NOT NULL
                     AND artist_id IS NULL)                       AS artist_id_unresolved,
  COUNT(*) FILTER (WHERE btrim(COALESCE(local_id,'')) = '')       AS local_id_missing,
  COUNT(*) FILTER (WHERE btrim(COALESCE(set_name,'')) = '')       AS set_name_missing,
  COUNT(*) FILTER (WHERE btrim(name) = '')                        AS name_empty,
  COUNT(*) FILTER (WHERE btrim(name) = ''
                      OR btrim(COALESCE(set_name,'')) = ''
                      OR btrim(COALESCE(local_id,'')) = '')       AS matcher_unreachable,
  ROUND(100.0 * COUNT(*) FILTER (WHERE image_url IS NULL)
              / NULLIF(COUNT(*),0), 2)                            AS pct_image_missing
FROM public.cards_effective
GROUP BY set_id
ORDER BY set_id;

-- Q2.3  Global summary. Backing query for catalog_coverage_summary.csv.
SELECT 'cards_total' AS metric_key,
       (SELECT COUNT(*) FROM public.cards)::bigint AS count,
       (SELECT COUNT(*) FROM public.cards)::bigint AS denominator
UNION ALL SELECT 'image_url_missing',
       COUNT(*) FILTER (WHERE image_url IS NULL), COUNT(*) FROM public.cards_effective
UNION ALL SELECT 'illustrator_missing',
       COUNT(*) FILTER (WHERE illustrator IS NULL), COUNT(*) FROM public.cards_effective
UNION ALL SELECT 'artist_id_unresolved',
       COUNT(*) FILTER (WHERE illustrator IS NOT NULL AND artist_id IS NULL),
       COUNT(*) FROM public.cards_effective
UNION ALL SELECT 'artist_id_null_total',
       COUNT(*) FILTER (WHERE artist_id IS NULL), COUNT(*) FROM public.cards_effective
UNION ALL SELECT 'local_id_missing',
       COUNT(*) FILTER (WHERE btrim(COALESCE(local_id,'')) = ''), COUNT(*) FROM public.cards_effective
UNION ALL SELECT 'set_id_missing',
       COUNT(*) FILTER (WHERE set_id IS NULL), COUNT(*) FROM public.cards_effective
UNION ALL SELECT 'set_name_missing',
       COUNT(*) FILTER (WHERE btrim(COALESCE(set_name,'')) = ''), COUNT(*) FROM public.cards_effective
UNION ALL SELECT 'name_empty',
       COUNT(*) FILTER (WHERE btrim(name) = ''), COUNT(*) FROM public.cards_effective;

-- Q3.7  illustrator_directory artist-identity conflicts.
--       The directory uses max(artist_id) GROUP BY illustrator, which SILENTLY
--       collapses disagreement. Any row returned is a real conflict.
SELECT illustrator,
       COUNT(DISTINCT artist_id) FILTER (WHERE artist_id IS NOT NULL) AS distinct_artist_ids,
       array_agg(DISTINCT artist_id) FILTER (WHERE artist_id IS NOT NULL) AS artist_ids,
       COUNT(*)                                             AS cards_total,
       COUNT(*) FILTER (WHERE artist_id IS NULL)            AS cards_unresolved,
       array_agg(DISTINCT set_id ORDER BY set_id)           AS set_ids
FROM public.cards_effective
WHERE illustrator IS NOT NULL AND btrim(illustrator) <> ''
GROUP BY illustrator
HAVING COUNT(DISTINCT artist_id) FILTER (WHERE artist_id IS NOT NULL) > 1
ORDER BY distinct_artist_ids DESC, cards_total DESC;

-- Q3.7b  Directory rows where SOME cards resolve and others do not
--        (partial FK coverage hidden behind max()).
SELECT illustrator,
       COUNT(*)                                   AS cards_total,
       COUNT(*) FILTER (WHERE artist_id IS NULL)  AS cards_unresolved,
       MAX(artist_id)                             AS directory_reported_artist_id
FROM public.cards_effective
WHERE illustrator IS NOT NULL AND btrim(illustrator) <> ''
GROUP BY illustrator
HAVING COUNT(*) FILTER (WHERE artist_id IS NULL) > 0
   AND COUNT(*) FILTER (WHERE artist_id IS NOT NULL) > 0
ORDER BY cards_unresolved DESC;

-- Q3.8  Full inspection of every card_extras row (n = 5).
--       Tests F-15 directly: does the override disagree with artist_id?
SELECT x.card_id, x.illustrator_override, x.source_note,
       c.illustrator            AS base_illustrator,
       e.illustrator            AS effective_illustrator,
       c.artist_id,
       c.set_id, c.local_id, c.name, c.last_synced_at,
       (c.artist_id IS NULL)                        AS fk_unresolved,
       (x.illustrator_override IS DISTINCT FROM c.illustrator) AS override_changes_value
FROM public.card_extras x
JOIN public.cards c            ON c.id = x.card_id
JOIN public.cards_effective e  ON e.id = x.card_id
ORDER BY x.card_id;
```

### CAT-0C — Illustrator and artist identity

```sql
-- Q3.1  Null-illustrator population by set. Re-measures the "~1,400" estimate.
SELECT COALESCE(set_id,'(null)') AS set_id, MIN(set_name) AS set_name,
       COUNT(*) FILTER (WHERE illustrator IS NULL) AS null_illustrator,
       COUNT(*)                                    AS cards_total,
       ROUND(100.0 * COUNT(*) FILTER (WHERE illustrator IS NULL)
                   / NULLIF(COUNT(*),0), 2)        AS pct_null
FROM public.cards_effective
GROUP BY set_id
HAVING COUNT(*) FILTER (WHERE illustrator IS NULL) > 0
ORDER BY null_illustrator DESC;

-- Q3.2  Illustrator present, artist_id absent — grouped by raw string.
SELECT illustrator, COUNT(*) AS cards,
       COUNT(DISTINCT set_id) AS sets,
       array_agg(DISTINCT set_id ORDER BY set_id) AS set_ids
FROM public.cards_effective
WHERE illustrator IS NOT NULL AND artist_id IS NULL
GROUP BY illustrator
ORDER BY cards DESC;

-- Q3.3  Unicode / normalization risk. (v1 used \uXXXX escapes, which PostgreSQL
--       regex does not interpret. Rewritten with chr().)
SELECT illustrator, COUNT(*) AS cards,
       normalize(illustrator, NFKC) <> illustrator            AS nfkc_delta,
       position(chr(12288) in illustrator) > 0                AS has_ideographic_space,
       position(chr(160)   in illustrator) > 0                AS has_nbsp,
       illustrator ~ ('[' || chr(65281) || '-' || chr(65374) || ']') AS has_fullwidth_ascii,
       illustrator <> btrim(illustrator)                      AS has_edge_space,
       illustrator ~ '\s\s+'                                  AS has_double_space
FROM public.cards_effective
WHERE illustrator IS NOT NULL
GROUP BY illustrator
HAVING normalize(illustrator, NFKC) <> illustrator
    OR position(chr(12288) in illustrator) > 0
    OR position(chr(160)   in illustrator) > 0
    OR illustrator ~ ('[' || chr(65281) || '-' || chr(65374) || ']')
    OR illustrator <> btrim(illustrator)
    OR illustrator ~ '\s\s+'
ORDER BY cards DESC;

-- Q3.4  Near-duplicate illustrator identities collapsing under NFKC + fold.
WITH k AS (
  SELECT illustrator,
         lower(regexp_replace(normalize(btrim(illustrator), NFKC), '\s+', ' ', 'g')) AS folded,
         COUNT(*) AS cards
  FROM public.cards_effective
  WHERE illustrator IS NOT NULL AND btrim(illustrator) <> ''
  GROUP BY illustrator
)
SELECT folded, COUNT(*) AS variant_count, SUM(cards) AS cards_total,
       array_agg(illustrator ORDER BY illustrator) AS variants
FROM k GROUP BY folded HAVING COUNT(*) > 1
ORDER BY cards_total DESC;

-- Q3.5  Alias collisions across artists.
--       loadArtistAliasMap() last-writer-wins on these, silently and by row order.
WITH a AS (
  SELECT id, lower(btrim(alias)) AS alias_key
  FROM public.artists, unnest(aliases) AS alias
)
SELECT alias_key, COUNT(DISTINCT id) AS artist_count,
       array_agg(DISTINCT id ORDER BY id) AS artist_ids
FROM a GROUP BY alias_key HAVING COUNT(DISTINCT id) > 1
ORDER BY artist_count DESC, alias_key;

-- Q3.6  Aliases that would match only under NFKC folding — dead aliases today.
--       Isolates the exact failure class sync-cards.mjs cannot resolve
--       (.trim().toLowerCase(), no NFKC). Candidates for HUMAN REVIEW ONLY.
WITH a AS (
  SELECT id, alias,
         lower(btrim(alias)) AS sync_key,
         lower(regexp_replace(normalize(btrim(alias), NFKC), '\s+', ' ', 'g')) AS fold_key
  FROM public.artists, unnest(aliases) AS alias
),
c AS (
  SELECT DISTINCT illustrator,
         lower(btrim(illustrator)) AS sync_key,
         lower(regexp_replace(normalize(btrim(illustrator), NFKC), '\s+', ' ', 'g')) AS fold_key
  FROM public.cards_effective
  WHERE illustrator IS NOT NULL AND btrim(illustrator) <> ''
)
SELECT c.illustrator, a.id AS candidate_artist_id, a.alias,
       (SELECT COUNT(*) FROM public.cards_effective ce
        WHERE ce.illustrator = c.illustrator AND ce.artist_id IS NULL) AS unresolved_cards
FROM c JOIN a ON a.fold_key = c.fold_key AND a.sync_key <> c.sync_key
ORDER BY unresolved_cards DESC, a.id, c.illustrator;

-- Q3.9  F-2B exposure test, per tracked artist.
--       Rows an FK-path query (.eq('artist_id', ...)) MISSES but an exact
--       illustrator-string query would return.
WITH tracked AS (
  SELECT a.id AS artist_id, lower(btrim(alias)) AS alias_key
  FROM public.artists a, unnest(a.aliases) AS alias
)
SELECT t.artist_id,
       COUNT(*)                                          AS illustrator_matched_cards,
       COUNT(*) FILTER (WHERE e.artist_id = t.artist_id) AS fk_reachable,
       COUNT(*) FILTER (WHERE e.artist_id IS NULL)       AS fk_unresolved,
       COUNT(*) FILTER (WHERE e.artist_id IS NOT NULL
                          AND e.artist_id <> t.artist_id) AS fk_points_elsewhere,
       array_agg(DISTINCT e.set_id ORDER BY e.set_id)
         FILTER (WHERE e.artist_id IS NULL)              AS unresolved_set_ids
FROM public.cards_effective e
JOIN tracked t ON lower(btrim(e.illustrator)) = t.alias_key
GROUP BY t.artist_id
HAVING COUNT(*) FILTER (WHERE e.artist_id IS DISTINCT FROM t.artist_id) > 0
ORDER BY fk_unresolved DESC;
```

### CAT-0D — Temporal metadata root cause (F-13)

```sql
-- Q6.1  Confirm and scope the temporal gap. Expect 23,780 / 23,780 for both.
SELECT COUNT(*) AS cards_total,
       COUNT(*) FILTER (WHERE series       IS NULL) AS series_null,
       COUNT(*) FILTER (WHERE release_date IS NULL) AS release_date_null,
       COUNT(*) FILTER (WHERE series       IS NOT NULL) AS series_present,
       COUNT(*) FILTER (WHERE release_date IS NOT NULL) AS release_date_present
FROM public.cards;

-- Q6.2  Sync history from last_synced_at. THE decisive F-1 discriminator.
--       backfill-illustrators.mjs does NOT touch last_synced_at, so this column
--       reflects sync-cards.mjs runs only.
SELECT date_trunc('day', last_synced_at) AS sync_day,
       COUNT(*) AS cards, COUNT(DISTINCT set_id) AS sets
FROM public.cards
GROUP BY 1 ORDER BY 1;

-- Q6.3  The nine backfilled sets: current state vs sync recency.
--       Discriminates whether backfill enrichment survived, was erased, or
--       whether TCGdex now supplies the illustrator natively.
SELECT set_id, COUNT(*) AS cards,
       COUNT(*) FILTER (WHERE illustrator IS NULL)     AS illustrator_null,
       COUNT(*) FILTER (WHERE illustrator IS NOT NULL
                          AND artist_id IS NULL)       AS backfill_signature,
       COUNT(*) FILTER (WHERE illustrator IS NOT NULL
                          AND artist_id IS NOT NULL)   AS fully_resolved,
       MIN(last_synced_at) AS first_sync, MAX(last_synced_at) AS last_sync
FROM public.cards
WHERE set_id IN ('swsh9','swsh10','swsh10.5','swsh11','swsh12','swsh12.5','mee','ru1','sve')
GROUP BY set_id
ORDER BY set_id;

-- Q6.4  Are the ONLY illustrator-bearing fields also the only temporal ones?
--       Distinguishes "sync writes some fields well" from a broader extraction gap.
SELECT
  COUNT(*) FILTER (WHERE rarity           IS NULL) AS rarity_null,
  COUNT(*) FILTER (WHERE set_name         IS NULL) AS set_name_null,
  COUNT(*) FILTER (WHERE image_url        IS NULL) AS image_url_null,
  COUNT(*) FILTER (WHERE pricing          IS NULL) AS pricing_null,
  COUNT(*) FILTER (WHERE pricing_source   IS NULL) AS pricing_source_null,
  COUNT(*) FILTER (WHERE last_synced_at   IS NULL) AS last_synced_null,
  COUNT(*) AS total
FROM public.cards;
```

**Q6.4 is the discriminator between two root causes.** `set_name` comes from `card.set?.name` — the *same* `card.set` object that `series` and `release_date` are read from. If `set_name` is well populated while `series`/`release_date` are 100% null, then `card.set` exists in the response but lacks `serie` and `releaseDate` — pointing at response-shape mismatch, not a broken sync. If `set_name` is also null, the whole `card.set` extraction is failing.

**Leading hypothesis (code-evidenced, not yet confirmed):**
`mapCardToRow` reads `card.set?.serie?.name` and `card.set?.releaseDate` from the **per-card** detail response (`GET /cards/{id}`). In TCGdex v2 the per-card `set` object is a set *résumé* (id, name, symbol, logo, card counts); `serie` and `releaseDate` live on the **set detail** response. `syncSet` already fetches that set detail at line 175 and uses only `.cards`, discarding `releaseDate` and `serie`. If confirmed, the temporal gap is a systematic **extraction defect with the data already in hand**, not missing upstream data.

**Confirming probe (read-only, 2 unauthenticated GETs, no writes):**

```
GET https://api.tcgdex.net/v2/en/cards/base1-1   → inspect keys of .set
GET https://api.tcgdex.net/v2/en/sets/base1      → inspect .releaseDate, .serie
```

Also inspect `src/constants/setOrder.js` in the same step (§5).

### CAT-0E — Image coverage

```sql
-- Q4.1  Image coverage by set.
SELECT COALESCE(set_id,'(null)') AS set_id, MIN(set_name) AS set_name,
       COUNT(*) AS cards_total,
       COUNT(*) FILTER (WHERE image_url IS NULL)     AS image_url_missing,
       COUNT(*) FILTER (WHERE image_url IS NOT NULL) AS image_url_present,
       ROUND(100.0 * COUNT(*) FILTER (WHERE image_url IS NULL)
                   / NULLIF(COUNT(*),0), 2) AS pct_missing
FROM public.cards_effective
GROUP BY set_id ORDER BY pct_missing DESC NULLS LAST, set_id;

-- Q4.2  image_url shape — is the stored value a file URL or a TCGdex base URL?
SELECT
  COUNT(*) FILTER (WHERE image_url ~* '\.(png|jpg|jpeg|webp)$') AS ends_with_extension,
  COUNT(*) FILTER (WHERE image_url IS NOT NULL
                     AND image_url !~* '\.(png|jpg|jpeg|webp)$') AS no_extension,
  COUNT(*) FILTER (WHERE image_url IS NOT NULL
                     AND image_url NOT LIKE 'https://%')         AS non_https,
  COUNT(DISTINCT split_part(image_url, '/', 3))                  AS distinct_hosts
FROM public.cards_effective;

-- Q4.3  Host distribution.
SELECT split_part(image_url, '/', 3) AS host, COUNT(*) AS cards
FROM public.cards_effective WHERE image_url IS NOT NULL
GROUP BY 1 ORDER BY cards DESC;

-- Q4.4  Cards structurally unable to obtain a verified fallback.
--       fingerprintCard() returns null when localId or name is unusable,
--       short-circuiting to mismatch with NO request issued.
SELECT COALESCE(set_id,'(null)') AS set_id, COUNT(*) AS unverifiable_cards
FROM public.cards_effective
WHERE image_url IS NULL
  AND (btrim(COALESCE(local_id,'')) = '' OR btrim(name) = '')
GROUP BY set_id ORDER BY unverifiable_cards DESC;
```

### CAT-0F — Product-impact segmentation

```sql
-- Q5.1  Defects on tracked artists (global roster).
--       COLUMN NAMES UNCONFIRMED — verify user_tracked_artists before running.
WITH tracked AS (
  SELECT DISTINCT artist_id FROM public.user_tracked_artists WHERE artist_id IS NOT NULL
)
SELECT e.artist_id, COUNT(*) AS cards_total,
       COUNT(*) FILTER (WHERE e.image_url   IS NULL) AS image_missing,
       COUNT(*) FILTER (WHERE e.illustrator IS NULL) AS illustrator_missing
FROM public.cards_effective e
JOIN tracked t ON t.artist_id = e.artist_id
GROUP BY e.artist_id ORDER BY image_missing DESC;

-- Q5.2  Defects on the active snapshot population.
--       READ-ONLY. Ownership SCOPES impact; it never defines catalog truth.
--       COLUMN NAMES UNCONFIRMED — verify against the OL-0B migration.
SELECT e.set_id, COUNT(DISTINCT e.id) AS owned_distinct_cards,
       COUNT(DISTINCT e.id) FILTER (WHERE e.image_url   IS NULL) AS owned_image_missing,
       COUNT(DISTINCT e.id) FILTER (WHERE e.illustrator IS NULL) AS owned_illustrator_missing
FROM public.user_import_rows r
JOIN public.user_import_batches b ON b.id = r.batch_id AND b.status = 'active'
JOIN public.cards_effective e ON e.id = r.card_id
WHERE r.match_status = 'matched'
GROUP BY e.set_id ORDER BY owned_image_missing DESC;
```

---

## 7. Image-source evidence and H-IMG-1

### 7.1 Runtime verdict vocabulary (from `imageService.js` — evidence, not a redesign target)

| Condition | Verdict | Persisted | Audit token |
|---|---|---|---|
| Local `name`/`localId` unusable | `insufficient_local_metadata`, **no request** | never | `fb_mismatch_insufficient_local` |
| PTCG 404 / 410 | `absent` | 72h | `fb_absent_404` |
| PTCG OK, no images | `absent` | 72h | `fb_absent_no_images` |
| PTCG OK, a check null | `insufficient_remote_metadata` | 72h | `fb_mismatch_insufficient_remote` |
| PTCG OK, a check false | `verification_mismatch` | 72h | `fb_mismatch_verification` |
| All three true | `verified` | 30d | `fb_verified` |
| 429 / 5xx / 401 / 403 / transport | `error` | **never** | `fb_error` |

`verified` persists 30 days, so a production console reading is **not** a live measurement. Probes must run offline and must never read or write `pb_img2_`.

### 7.2 H-IMG-1 — hypothesis, with the successor implication tightened

**Hypothesis.** `fetchFallbackImage` requests `api.pokemontcg.io/v2/cards/{tcgdex_id}` verbatim. Where the two sources' set-ID conventions diverge — and `backfill-illustrators.mjs` proves they do (`swsh10.5`↔`swsh45`, `swsh12.5`↔`swsh12pt5`) — the request 404s and classifies `absent`, never reaching verification. Predicted signature: `fb_absent_404` clusters tightly by set.

**What this does *not* imply.** A set-ID translation table alone **cannot** resolve it. OL-2C.1 requires `observed.id === card.id`, where `card.id` is the TCGdex canonical ID. A translated lookup returns the *Pokémon TCG API's* ID, which by construction ≠ the TCGdex ID, so `id_match` is false and the verdict is `verification_mismatch`. Translation converts an `absent` into a `mismatch`. It renders nothing either way.

Any future remedy would first require **a governed, individually verified cross-source exact-printing correspondence** — an identity claim, not a string mapping — and would additionally require a deliberate change to OL-2C.1 verification semantics to consume it. **CAT-0 approves, designs, and implements none of that.** It measures the size and shape of the population only.

Note the inversion of F-12: under the current same-ID lookup, `id_match` is near-tautological. Under any translated lookup it becomes the sole blocking check. That asymmetry is precisely why translation is not a shortcut.

### 7.3 Probe design

**Probe A — primary URL liveness. BLOCKED** pending `src/utils/imageUrl.js`. `cards.image_url` stores TCGdex's base form (Q4.2 confirms the shape); the rendered URL is constructed downstream. Probing the unresolved value would fabricate a dead-link rate.

**Probe B — fallback reachability. Runnable now.** Offline Node script replicating `performFetch` exactly: same URL construction, same `classifyNonOk`, same `normalizeName`/`normalizeNumber`. Rate-limited, API key set, resumable, ≤1 request per card, stratified sample, no cache access.

---

## 8. Findings

Severity: **P0** wrong physical-printing identity / false-positive risk · **P1** missing data materially breaking artist-first use · **P2** visible completeness gap · **P3** hygiene.

| ID | Finding | Severity | Status | Evidence |
|---|---|---|---|---|
| **F-1** | **Secondary illustrator enrichment is not durable under a full refresh.** A full-row sync overwrites backfilled illustrator values with the current TCGdex value; wherever TCGdex still returns null, the enrichment is erased. Whether erasure has occurred is unknown. | P1 | Confirmed mechanism; realization **unmeasured** (Q6.2/Q6.3) | `sync-cards.mjs` L128–163 |
| **F-2A** | **Incomplete artist identity state — proven.** Backfill writes `illustrator` but not `artist_id`; `cards_effective` does not derive `artist_id` from the effective illustrator. Rows can legitimately hold `illustrator IS NOT NULL AND artist_id IS NULL`. | P1 | **Confirmed** | `backfill-illustrators.mjs` L125–129; A1 view definition |
| **F-2B** | **Visible artist-surface undercount — hypothesis.** The FK path (`.eq('artist_id', …)`) cannot see F-2A rows, but `cardService` has two other branches: dynamic entries use `artist_id OR illustrator.in(...)`, and entries without `artistId` use ILIKE. Exposure is therefore confined to **curated entries carrying an `artistId`**, and its size is unknown. | P1 if confirmed | **Unmeasured** (Q3.9) | `cardService.js` three branches |
| **F-3** | Backfill correspondence joins on card **number only** across a set-ID convention boundary, with no name verification. Wrong artist attribution is possible. | P1 (**P0 only on evidence of actual printing-identity corruption**) | Unmeasured | `backfill-illustrators.mjs` L32–42, L80–102 |
| **F-4** | Artist alias resolution uses the weakest normalizer in the system (`.trim().toLowerCase()`, no NFKC), while ownership and image verification both use NFKC-based normalizers. Mechanically explains the open full-width-space alias item. | P1 | Confirmed mechanism; population **unmeasured** (Q3.6) | `sync-cards.mjs` L37–52 vs `imageService.js` L80–111 |
| **F-5** | `loadArtistAliasMap` silently last-writer-wins on duplicate aliases across artists, by row order, with no collision detection. | P1 | Unmeasured (Q3.5) | `sync-cards.mjs` L37–47 |
| **F-6** | Incremental sync never re-reads a set once `storedCount >= briefCards.length`, so upstream corrections after first ingest are permanently invisible. | P1 | Confirmed | `sync-cards.mjs` L178–184 |
| **F-7** | No delete pass; upstream-removed rows persist. Candidate source of dead primary image URLs. | P2 | Unmeasured | absence across both scripts |
| ~~F-8~~ | ~~Duplicate canonical IDs~~ | — | **RETIRED — falsified** | A5: 23,780 = 23,780; `card_extras.card_id` PK |
| **F-9** | No provenance column for illustrator or image. Source family is inferable only, and the inference is defeasible by overrides. | P2 | Confirmed | `cards` write contract |
| **F-10** | `pricing_updated_at` is stamped at sync time whenever pricing exists — it measures sync recency, not price freshness. Must not be read as staleness evidence. | P3 | Confirmed | `sync-cards.mjs` L151 |
| **F-11** | The nine `NULL_SETS` reconcile to the documented six SWSH-era ranges plus three undocumented non-SWSH sets (`mee`, `ru1`, `sve`). | P2 | Confirmed | script vs `CURRENT_STATE.md` |
| **F-12** | `id_match` is near-tautological under same-ID lookup, concentrating verification power in `number_match` + `name_match`. Inverts under any translated lookup (§7.2). | P3 | Characterization | `imageService.js` L218, L262 |
| **F-13** | **Global temporal catalog metadata gap.** `series` null 23,780/23,780; `release_date` null 23,780/23,780. **Root cause not assigned.** Candidates: upstream absence · extraction defect in `mapCardToRow` (leading hypothesis, §6 CAT-0D) · historical ingestion behavior · stale data. | P1 | **Confirmed gap, cause open** | A6; `sync-cards.mjs` L140–141, L175 |
| **F-14** | **Catalog ordering degraded by F-13.** `cardService` orders `release_date ASC NULLS LAST`, then `set_id`, then `local_id`. With `release_date` universally null the primary key is inert, so artist/binder card order is lexicographic by `set_id` then by `local_id` *as text* (`"10" < "9"`). This is a visible, user-facing consequence, not just a metadata gap. | P2 | Confirmed mechanism; UX impact **unassessed** | `cardService.js` order chain; A6 |
| **F-15** | **Override/FK divergence by construction.** `cards_effective` COALESCEs `illustrator` with `card_extras.illustrator_override` but takes `artist_id` straight from `cards.artist_id`. An override changes the displayed illustrator and **never** the FK. The two fields can disagree by design. Blast radius today: 5 rows. | P1 (contract defect), small blast radius | **Confirmed structurally**; per-row state unmeasured (Q3.8) | A1 view definition |
| **F-16** | **`illustrator_directory` masks artist-identity conflicts.** `max(artist_id) GROUP BY illustrator` collapses disagreement to a single arbitrary winner, and groups by the **raw** string — so NFKC variants appear as separate directory entries. Feeds Find Illustrator search and `add_artist_to_archive`. | P1 if conflicts exist | Unmeasured (Q3.7, Q3.7b) | A1 view definition |
| **F-17** | **Documentation/history inconsistency.** `CURRENT_STATE.md` records "Three `card_extras` seed FK fixes: swsh11-186 → shinji-kanda, swsh12.5-GG19 → asako-ito, swsh12.5-GG69 → akira-egawa," but `card_extras` has no `artist_id` column and can override illustrator only. Requires reconciliation against Gate-3 implementation evidence. **Do not rewrite history or infer what happened.** Q3.8 shows the current state of those rows; it does not establish intent. | P2 | Flagged | A2 schema vs `CURRENT_STATE.md` |
| **F-18** | Duplicated non-unique indexes on `cards` (`illustrator`, `pokemon_dex_ids`, `rarity`, `set_id`). Write amplification and storage only. | P3 | Confirmed | A4 |

### 8.1 Open identity question

With F-8 retired, the sole remaining P0-candidate is **duplicate `(set_id, local_id)` identities** (Q1.2). The PK is on `id`; nothing constrains set+number uniqueness. Two rows sharing a set and number with **different names** would be a genuine printing-identity ambiguity and would fire Gate G-2.

---

## 9. Conflict taxonomy

| ID | Conflict | Class | Severity |
|---|---|---|---|
| C-F1 | Illustrator differs by width/space/case between sources | `harmless_formatting` | P3 |
| C-F2 | Card-number leading zeros differ | `resolvable_deterministic` | P3 |
| C-F3 | Apostrophe / diacritic glyph differs in name | `harmless_formatting` | P3 |
| C-R1 | Set-ID convention differs across sources | `resolvable_deterministic` **only where individually verified** | P2 |
| C-R2 | Card present in one source, absent in the other | `resolvable_deterministic` (absence is a fact) | P2 |
| C-A1 | Same `(set_id, local_id)`, different `name` | `ambiguous_identity` | **P0** |
| C-A3 | Illustrator differs materially between sources for the same id | `ambiguous_identity` | P1 |
| C-A4 | One alias claimed by two artists | `ambiguous_identity` | P1 |
| C-A5 | **Same illustrator string, >1 distinct `artist_id`** (F-16) | `ambiguous_identity` | P1 |
| C-A6 | **Override illustrator disagrees with FK-derived artist** (F-15) | `ambiguous_identity` | P1 |
| C-W1 | Backfill number-join assigned an illustrator from a different printing | `possible_wrong_printing` | P1 → **P0 on evidence** |
| C-W2 | A `verified` fallback rendered for a non-exact printing | `possible_wrong_printing` | **P0** — expected count zero; any non-zero is an OL-2C.1 regression |
| C-W3 | Cross-release/cross-language correspondence treated as equivalence | `possible_wrong_printing` | **P0** |

**Resolution policy.** `harmless_formatting` → record. `resolvable_deterministic` → record, recommend nothing inside CAT-0. `ambiguous_identity` → **no automatic winner**; escalate with full row-level evidence. `possible_wrong_printing` → **stop and escalate immediately** (G-2); do not batch into a final report.

**Ownership is unaffected by artist attribution.** Ownership flows through canonical `id` only. A wrong illustrator or `artist_id` misplaces a card in an artist binder; it does not create false physical-printing ownership. That distinction is why F-3 sits at P1.

---

## 10. Execution order and gates

```
CAT-0A  Contract introspection        ✓ COMPLETE — G-1 PASS
CAT-0B  Identity + field coverage     ── G-1b, G-2 ──▶   ◀── NEXT
CAT-0C  Illustrator & artist identity ── G-2 ──▶
CAT-0D  Temporal root cause (F-13)    ── G-4 ──▶
CAT-0E  Image coverage + Probe B      ── G-3 ──▶
CAT-0F  Product-impact segmentation
CAT-0G  Artifacts, synthesis, ONE successor recommendation
```

| Gate | Condition | Action |
|---|---|---|
| **G-1** | Null or duplicate canonical IDs | ✓ **PASSED** 2026-07-27 |
| **G-1b** | Any Q1.INV assertion ≠ 0 | **HALT** — the view contract changed; re-run CAT-0A before anything else |
| **G-2** | Any `possible_wrong_printing` finding | **HALT and escalate immediately** with row-level evidence |
| **G-3** | Probe writes, touches `pb_img2_`, or hits sustained 429 | Abort probe; report partial results as partial, never extrapolated |
| **G-4** | Era-dimensioned output attempted before F-13 root cause | **Blocked.** No artifact may carry a populated `era_token` |

---

## 11. Artifacts

UTF-8, RFC 4180, header row required, plus `manifest.json` carrying `captured_at`, the 23,780/22 baseline, query IDs, and script versions. Closed token vocabularies; no free text in a token column.

**`catalog_coverage_summary.csv`** — `metric_key`, `scope`, `count`, `denominator`, `pct`, `severity`, `query_id`, `captured_at`

**`catalog_coverage_by_set.csv`** — `set_id`, `set_name`, `cards_total`, `image_url_missing`, `illustrator_missing`, `artist_id_unresolved`, `local_id_missing`, `set_name_missing`, `name_empty`, `matcher_unreachable`, `dup_set_number_groups`, `source_family_token`, `impact_token`
*`era_token` is defined but must remain **empty** under G-4. `series` is not available from the view and is globally null in the base table.*

**`illustrator_gaps.csv`** — `card_id`, `set_id`, `local_id`, `card_name`, `illustrator_raw`, `illustrator_nfkc`, `illustrator_source_token`, `artist_id`, `gap_token`, `cause_hypothesis_token`, `unicode_risk_token`, `alias_candidate_artist_id`, `impact_token`

- `gap_token` ∈ `gap_illustrator_null` | `gap_artist_id_null` | `gap_directory_conflict` | `gap_alias_collision` | `gap_override_fk_divergence`
- `cause_hypothesis_token` ∈ `cause_full_sync_overwrite` | `cause_backfill_no_fk` | `cause_alias_normalizer` | `cause_source_gap` | `cause_override_no_fk` | `cause_unknown`
- `unicode_risk_token` ∈ `uni_none` | `uni_ideographic_space` | `uni_nbsp` | `uni_fullwidth_ascii` | `uni_nfkc_delta` | `uni_double_space` | `uni_edge_space`
- `illustrator_source_token` ∈ `ill_base` | `ill_override` (derivable exactly: an override exists iff the `card_extras` row exists)
- `alias_candidate_artist_id` — from Q3.6 only; **a candidate for human review, never an applied mapping**

**`image_gaps.csv`** — `card_id`, `set_id`, `local_id`, `card_name`, `image_url_present`, `primary_probe_token`, `fallback_probe_token`, `id_match`, `number_match`, `name_match`, `set_match`, `impact_token`, `probe_captured_at`
*`set_match` is diagnostic evidence only and never a verdict input. The three `*_match` columns use `true`/`false`/`null`, preserving `imageService`'s null-means-indeterminate semantics.*

**`identity_conflicts.csv`** — `conflict_id`, `conflict_class_token` (§9 IDs), `field`, `card_id_a`, `card_id_b`, `value_a`, `value_b`, `source_a`, `source_b`, `resolvability_token`, `risk_token`, `impact_token`, `query_id`

`impact_token` ∈ `impact_tracked_artist` | `impact_active_snapshot` | `impact_hunt_or_plan` | `impact_catalog_only` | `impact_unreachable`

---

## 12. Remaining evidence gaps — phase-scoped

None blocks CAT-0B or CAT-0C.

| # | Artifact | Blocks | Why |
|---|---|---|---|
| 1 | `src/constants/setOrder.js` | CAT-0D chronology substitute, G-4 | Existing project evidence must be inspected before any chronology is proposed. If it carries no dates, it is not a chronology. |
| 2 | `src/utils/imageUrl.js` | CAT-0E **Probe A only** | Primary-URL resolution contract; without it a dead-link rate would be fabricated |
| 3 | `user_tracked_artists`, `user_import_rows`, `user_import_batches` column names | CAT-0F | Q5.1/Q5.2 assume names not yet confirmed |
| 4 | `src/constants/artists.js` | F-2B precision | Distinguishes curated-with-`artistId` entries (the exposed class) from dynamic ones |
| 5 | `src/utils/keys.js` | §9 normalizer comparison | Lets the normalizer-family comparison rest on reading rather than inference |
| 6 | `add_artist_to_archive` body | Lineage completeness | Only known programmatic writer to `artists` |
| 7 | Full `sync/` listing | Lineage completeness | `package.json` declares one script; `CURRENT_STATE.md` says "scripts" plural. Any unlisted writer is an unmapped edge |
| 8 | Gate-3 implementation evidence for the three "card_extras FK fixes" | F-17 reconciliation | Documentation contradicts schema; intent cannot be inferred from current state |

Operational facts, now largely answerable by query rather than recall: **Q6.2/Q6.3 reconstruct sync history from `last_synced_at`** (untouched by the backfill, so it isolates `sync-cards.mjs` runs). A Pokémon TCG API key remains needed for Probe B to be representative.

---

## 13. Conditional successor outcomes — none approved

Listed only as conditional outcomes of evidence. CAT-0 concludes by recommending **exactly one** narrow slice, not a programme. Each would require its own inspection → spec → implementation sequence.

| Trigger (must be measured first) | Conditional outcome shape |
|---|---|
| Q1.2 returns set+number duplicates with differing names | Immediate narrow identity escalation; preempts everything else |
| F-13 root cause = extraction defect, and `setOrder.js` offers no chronology | Restore temporal fields from data already fetched in `syncSet`; also resolves F-14 ordering |
| Q3.9 shows material curated-artist exposure | Recompute `artist_id` from existing illustrator strings; no illustrator writes |
| Q3.6 returns a reviewable candidate list | Normalizer change scoped to alias resolution in sync only; never touches `keys.js`; every mapping individually reviewed |
| Q3.7 returns conflicts | Surface conflicts in `illustrator_directory` instead of masking them with `max()` |
| Q6.2/Q6.3 show F-1 realized | Idempotent sync contract + a provenance column |
| Probe B confirms H-IMG-1 | **No image slice.** §7.2 shows translation alone cannot render anything; a correspondence mechanism is out of CAT-0's remit entirely |

---

## 14. Scope guardrails

CAT-0 **does not**: implement fixes · modify production · change SQL objects or schema · bulk-enrich · scrape images · modify sync behavior · modify artist aliases · add source-correspondence mappings · add allowlist entries · change OL-2C.1 verification · re-enable `buildLimitlessGuess` · touch ownership or SharedBinder · start OWN-1 · repair duplicate indexes · deploy.

CAT-0 **does**: read, count, classify, distinguish root cause, assess product exposure, and recommend one narrow evidence-backed successor.

Standing constraints carried forward: no per-language metric until an authoritative language field is proven (`cards_effective` has none) · a single sampled ID is never global namespace proof · uncertain cross-language/cross-release correspondences are never globalized (OL-0A2 rule) · stale baselines are re-measured, never reused · `cards_effective` remains the app catalog boundary, with `cards`/`card_extras` queried only for lineage-integrity and root-cause work.

---

## 15. Verdict

# READY TO RUN CAT-0 AUDIT

G-1 has passed, the `cards_effective` contract is established from production fact rather than assumption, and every query in §6 is validated against the confirmed schema. CAT-0B, CAT-0C, and CAT-0D are unblocked and can run immediately.

Two phases carry scoped blocks, neither of which gates the audit:

- **CAT-0E Probe A** requires `src/utils/imageUrl.js`. Probe B and all image SQL run without it.
- **CAT-0F** requires confirmation of three user-table column names.

Era-dimensioned reporting is **suspended** under G-4 pending F-13.

---

## 16. Exact next execution step

**Run CAT-0B — Identity Integrity and Field Coverage.** Six statements, all read-only, all validated against the confirmed schema, none dependent on any other result.

| Order | Query | Purpose | Cost |
|---|---|---|---|
| 1 | **Q1.INV** | Four invariant assertions. All must return 0. | Trivial |
| 2 | **Q1.2** | Duplicate `(set_id, local_id)`. **The sole remaining P0-candidate.** | Group scan |
| 3 | **Q2.1** | Per-set field coverage. Backs `catalog_coverage_by_set.csv`. | One pass |
| 4 | **Q2.3** | Global summary. Backs `catalog_coverage_summary.csv`. | One pass |
| 5 | **Q3.7 + Q3.7b** | `illustrator_directory` conflicts hidden by `max(artist_id)`. | Group scan |
| 6 | **Q3.8** | Full inspection of all 5 `card_extras` rows — tests F-15, informs F-17. | 5 rows |

Run in this order. **Stop immediately if Q1.INV returns any non-zero value** (G-1b) or if **Q1.2 returns groups with differing names** (G-2) — the second is a printing-identity ambiguity and takes precedence over completing the phase.

Post the output and this plan will be amended: coverage numbers pinned, F-15/F-16 resolved from state to fact, F-17 informed, and either CAT-0C authorized or a G-2 escalation opened.

Worth running in the same pass if convenient, since they are independent and cheap: **Q6.1–Q6.4** (temporal root cause and sync history) plus inspection of `src/constants/setOrder.js`. Q6.2 and Q6.3 are the decisive discriminators for F-1, which is otherwise unanswerable from files alone.

No fixes implemented. No files modified. No production changes. Read-only throughout.
