-- docs/sql/cat-3a-image-coverage-baseline.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- CAT-3A — Image Coverage & Recoverability Audit — production baseline
--
-- READ-ONLY. This file establishes the catalog-side baseline for CAT-3A and
-- exports the row inventory the external probes consume.
--
-- Full specification: docs/CAT-3A_IMAGE_COVERAGE_AND_RECOVERABILITY_AUDIT.md
--
-- ─────────────────────────────────────────────────────────────────────────
-- ✅ STATUS: EXECUTED AND CLOSED — 2026-08-18 / 2026-08-19
-- ─────────────────────────────────────────────────────────────────────────
-- Q-A0 through Q-A8b all ran against production, read-only, as the migration
-- owner. Q-A0 captured at 2026-08-18 23:41:01.499034+00. Q-A2 and Q-A3 were
-- re-run 2026-08-19 to materialize the per-set evidence artifact.
--
-- CAT-3A closed as CLOSED — SCOPED PARTIAL. Results, gates and the scope of
-- what was NOT established are recorded in
-- docs/CAT-3A_IMAGE_COVERAGE_AND_RECOVERABILITY_AUDIT.md §0.1 and §12.
-- Evidence: docs/cat-3a-evidence/.
--
-- ⚠ Read §0.1 before quoting any figure from a run of this file. The external
--   probe's F and O dimensions were never measured — the Pokémon TCG API
--   reliability gate failed twice — so no recoverability conclusion follows
--   from this SQL either.
--
-- This file is retained as the audit definition and as the means to
-- RE-MEASURE. Re-running it is how a future slice confirms these figures still
-- hold rather than assuming they do.
--
-- ⚠ THE EXECUTABLE SQL IS FROZEN. One comment in the Q-A2 header was corrected
--   after execution (see §12.5 — `release_date` IS exposed by cards_effective;
--   only `series` is not). No executable text changed, verified by a
--   comments-stripped diff, so this file still corresponds exactly to what ran.
--
-- ─────────────────────────────────────────────────────────────────────────
-- WHAT THIS FILE DOES NOT DO
-- ─────────────────────────────────────────────────────────────────────────
-- It makes NO identity claim, proposes NO alias, and authors NO provider
-- correspondence. Q-A6 compares image presence across the 192 alias pairs that
-- CAT-2D.2 ALREADY admitted individually; it creates no new pairing and no new
-- mapping. It does not copy, propagate or suggest copying any image value.
--
-- It takes no position on whether any row should be repaired. That is the
-- decision framework's job, and the decision framework runs only after the
-- external probes and the G-10 conclusion gate.
--
-- ─────────────────────────────────────────────────────────────────────────
-- EXECUTION CONTRACT
-- ─────────────────────────────────────────────────────────────────────────
--   * every statement is SELECT-only — no DDL, no DML, no RPC, no sync;
--   * NO temp tables, NO begin/commit, NO set_config, NO auth impersonation.
--     CAT-2D.2 established that this workflow must not depend on cross
--     top-level-statement TEMP or session state, so nothing here does;
--   * each statement is INDEPENDENTLY SELF-CONTAINED. Every one repeats its
--     own predicates verbatim. Run them in any order, in any session, any
--     number of times. None reads state produced by another;
--   * run as the migration owner / a privileged role. These are global
--     diagnostics across all users, so RLS must not scope them — that is why
--     no JWT context is established. No user UUID appears in this file, and no
--     statement emits one. Q-A7 returns COUNTS ONLY for exactly that reason.
--
-- ⚠ DO NOT COMMIT OUTPUT CONTAINING USER-IDENTIFYING VALUES. Q-A7 is written
--   so that it cannot produce any, but the rule stands for any ad-hoc variant
--   an operator writes in their own session.
--
-- ─────────────────────────────────────────────────────────────────────────
-- THE MISSING-IMAGE PREDICATE — one definition, repeated verbatim everywhere
-- ─────────────────────────────────────────────────────────────────────────
--
--     image_url is null or btrim(image_url) = ''
--
-- NULL and BLANK are counted SEPARATELY in Q-A1 and TOGETHER everywhere else.
-- CAT-0 measured only `image_url IS NULL` and never established whether a
-- blank-string population exists. Assuming it is empty would silently
-- undercount the gap and would silently exclude those rows from the Q-A8
-- probe export. It is measured, not assumed.
--
-- ─────────────────────────────────────────────────────────────────────────
-- BASE-TABLE DISCIPLINE — load-bearing, stated per query
-- ─────────────────────────────────────────────────────────────────────────
--
-- CAT-2D.1 added an alias exclusion to public.cards_effective, and CAT-2D.2
-- populated 192 aliases. The two base tables therefore DIFFER by 192 rows:
--
--   public.cards            raw provider history — INCLUDES the 192 alias rows
--   public.cards_effective  product-facing catalog — EXCLUDES them
--
-- Consequence for anyone comparing these outputs to CAT-0's committed
-- docs/cat-0-evidence/catalog_coverage_by_set.csv: that file was captured
-- 2026-07-27, BEFORE CAT-2D.2 aliased those rows, so its per-set figures for
-- swsh4.5 and swsh12.5 include rows that are no longer effective. The two are
-- NOT directly comparable at set level. Q-A0 makes the delta explicit so the
-- comparison is done knowingly rather than by accident.
--
--   Q-A1  BOTH base tables, reported separately
--   Q-A2  cards_effective (+ join to cards for `series`, which the view does
--         not expose)
--   Q-A2b RAW cards for the Celebrations partition, + effective membership
--   Q-A3  cards_effective
--   Q-A4  information_schema, then cards / cards_effective
--   Q-A5  cards_effective
--   Q-A6  RAW cards for the approved alias pairs
--   Q-A7  cards_effective, through the alias resolution surface
--   Q-A8  cards_effective
--
-- Exactly two statements read RAW cards for a population the view does not
-- expose: Q-A2b (the historical Celebrations partition, which is not separable
-- inside cards_effective) and Q-A6 (the alias rows, which the view excludes by
-- construction). No other statement may.
--
-- ─────────────────────────────────────────────────────────────────────────
-- OPERATOR-ONLY OUTPUTS — NEVER COMMITTED
-- ─────────────────────────────────────────────────────────────────────────
--
-- Q-A7c emits a bare list of catalog card ids representing the ACTIVE-OWNED
-- missing-image population. It contains no user id, no batch id and no
-- quantity — but it is still a projection of what collectors collectively own,
-- so it is an OPERATOR-ONLY input to the probe and MUST NOT be committed to the
-- repository. The probe consumes it to compute AGGREGATE active-owned counts;
-- only those aggregates become evidence.
--
-- docs/cat-3a-evidence/inputs/ is gitignored for exactly this reason.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- Q-A0 — CATALOG INVARIANTS AND POST-CAT-2D.2 RECONCILIATION   (gate G-1)
-- ═══════════════════════════════════════════════════════════════════════════
-- Coverage measurement is meaningless against a catalog whose identity is not
-- sound, so this runs first and STOPs the audit on any failure.
--
-- Expected, from the committed record:
--   cards_total                    = 23780   [CAT-0 baseline, sync paused since]
--   alias_rows                     =   192   [CAT-2D.2 closeout]
--   cards_effective_total          = 23588   = 23780 - 192
--   effective_distinct_ids         = cards_effective_total
--   effective_null_ids             =     0
--   effective_equals_expected      = true
--
-- A deviation is not automatically a failure — sync could legitimately have
-- run — but it MUST be explained before Q-A1 is trusted, not absorbed.
-- `effective_equals_expected` is the invariant that must hold regardless of
-- how the absolute totals move: the view removes exactly the alias rows and
-- nothing else.

select
  (select count(*) from public.cards)                              as cards_total,
  (select count(*) from public.card_identity_resolution)           as alias_rows,
  (select count(*) from public.cards_effective)                    as cards_effective_total,
  (select count(distinct id) from public.cards_effective)          as effective_distinct_ids,
  (select count(*) from public.cards_effective where id is null)   as effective_null_ids,
  (select count(*) from public.card_extras)                        as card_extras_total,
  -- The structural invariant: cards_effective = cards minus exactly the aliases.
  ( (select count(*) from public.cards)
    - (select count(*) from public.card_identity_resolution)
    = (select count(*) from public.cards_effective) )              as effective_equals_expected,
  -- No canonical id may itself be an alias (CAT-2D.1 R1 enforces this at write
  -- time; re-asserted here because the audit depends on one-hop resolution).
  (select count(*)
     from public.card_identity_resolution r
     join public.card_identity_resolution r2
       on r2.alias_card_id = r.canonical_card_id)                  as alias_chain_violations,
  -- Every alias target must exist as a real catalog row and must be effective.
  (select count(*)
     from public.card_identity_resolution r
    where not exists (select 1 from public.cards c where c.id = r.canonical_card_id))
                                                                   as alias_targets_missing_from_cards,
  (select count(*)
     from public.card_identity_resolution r
    where not exists (select 1 from public.cards_effective e where e.id = r.canonical_card_id))
                                                                   as alias_targets_not_effective,
  -- ⚠ AND EVERY ALIAS SOURCE — deliberately NOT symmetric with the target
  -- checks above, because the schema is not symmetric either.
  --
  -- card_identity_aliases.canonical_card_id carries an FK to cards(id);
  -- alias_card_id DOES NOT (cat-2d1-1-dark-alias-foundation.sql §1). An alias
  -- row can therefore name a SOURCE id with no corresponding `cards` row, and
  -- nothing in the schema prevents it.
  --
  -- That matters because the A dimension compares both sides of each pair. A
  -- missing source row yields a null image_url on the alias side, which reads
  -- as "the alias has no image" (A3/A4) when the truth is "there is no alias
  -- row to read". Those states are not interchangeable, and the difference is
  -- invisible in the output unless it is measured here.
  --
  -- Expected 0. Any non-zero value invalidates the A dimension and STOPs the
  -- audit at G-1, before Q-A6 is trusted.
  (select count(*)
     from public.card_identity_resolution r
    where not exists (select 1 from public.cards c where c.id = r.alias_card_id))
                                                                   as alias_sources_missing_from_cards,
  now()                                                            as captured_at;


-- ═══════════════════════════════════════════════════════════════════════════
-- Q-A1 — GLOBAL IMAGE COVERAGE, BOTH BASE TABLES   (gate G-2)
-- ═══════════════════════════════════════════════════════════════════════════
-- NULL and BLANK reported separately. `image_missing` is their union and is the
-- figure every other statement in this file uses.
--
-- The two rows differ by exactly the 192 alias rows. Reading them side by side
-- is what makes the CAT-0 comparability caveat visible rather than theoretical.

select
  'cards_effective'                                                as base_table,
  count(*)                                                         as rows_total,
  count(*) filter (where image_url is null)                        as image_url_null,
  count(*) filter (where image_url is not null and btrim(image_url) = '')
                                                                   as image_url_blank,
  count(*) filter (where image_url is null or btrim(image_url) = '')
                                                                   as image_missing,
  count(*) filter (where image_url is not null and btrim(image_url) <> '')
                                                                   as image_populated,
  round(100.0 * count(*) filter (where image_url is null or btrim(image_url) = '')
              / nullif(count(*), 0), 4)                            as pct_missing
from public.cards_effective

union all

select
  'cards'                                                          as base_table,
  count(*)                                                         as rows_total,
  count(*) filter (where image_url is null)                        as image_url_null,
  count(*) filter (where image_url is not null and btrim(image_url) = '')
                                                                   as image_url_blank,
  count(*) filter (where image_url is null or btrim(image_url) = '')
                                                                   as image_missing,
  count(*) filter (where image_url is not null and btrim(image_url) <> '')
                                                                   as image_populated,
  round(100.0 * count(*) filter (where image_url is null or btrim(image_url) = '')
              / nullif(count(*), 0), 4)                            as pct_missing
from public.cards

order by base_table;


-- ═══════════════════════════════════════════════════════════════════════════
-- Q-A2 — PER-SET IMAGE COVERAGE   (gate G-2; evidence: image_coverage_by_set)
-- ═══════════════════════════════════════════════════════════════════════════
-- Complete enumeration of the effective catalog. No filter, no LIMIT — a
-- truncated per-set table would silently misreport the partitions in Q-A3.
--
-- ⚠ CORRECTED WORDING (this comment was wrong; the query was not).
--
--   `series` is the ONLY one of the two absent from cards_effective. The view
--   projects 14 columns and `release_date` IS among them — it sits between
--   `rarity` and `pricing` (cat-2d1-1-dark-alias-foundation.sql §4). The
--   earlier text here claimed both were unprojected, which misdescribed the
--   view. CAT-0 §1.3.6 says only that the view does not expose `series`.
--
--   Both are joined back from public.cards by id regardless. That is safe —
--   the join is PK to PK and cannot fan out or lose rows — and for
--   `release_date` it is merely redundant, not incorrect: the value is the
--   same column either way.
--
--   The EXECUTABLE SQL BELOW IS UNCHANGED. It is byte-identical to the text
--   executed against production on 2026-08-18, so the committed file still
--   corresponds exactly to what ran. Only this comment was corrected.
--
-- CAT-1 populated both columns, so the series dimension is real here. Q-A4
-- proves that from the live schema rather than from this comment.

select
  e.set_id,
  max(e.set_name)                                                  as set_name,
  max(c.series)                                                    as series,
  min(c.release_date)                                              as set_release_date,
  count(*)                                                         as cards_total,
  count(*) filter (where e.image_url is null or btrim(e.image_url) = '')
                                                                   as image_missing,
  count(*) filter (where e.image_url is not null and btrim(e.image_url) <> '')
                                                                   as image_populated,
  round(100.0 * count(*) filter (where e.image_url is null or btrim(e.image_url) = '')
              / nullif(count(*), 0), 2)                            as pct_missing,
  case
    when count(*) filter (where e.image_url is null or btrim(e.image_url) = '') = 0
      then 'fully_covered'
    when count(*) filter (where e.image_url is null or btrim(e.image_url) = '') = count(*)
      then 'fully_missing'
    else 'partially_missing'
  end                                                              as coverage_class
from public.cards_effective e
join public.cards c on c.id = e.id
group by e.set_id
order by image_missing desc, e.set_id;


-- ═══════════════════════════════════════════════════════════════════════════
-- Q-A2b — CELEBRATIONS NAMED POPULATIONS   (gate G-2)
-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠ REMEASUREMENT ONLY. This statement pairs NOTHING. It proposes no
--   historical -> survivor mapping, derives none, and implies none. CAT-2D.3's
--   admission rules (25 individually corroborated pairs, no fuzzy matching,
--   its own named evidence class) are untouched by this file.
--
-- WHY THIS EXISTS AS ITS OWN STATEMENT
--
--   Q-A2 groups by set_id, and the live Celebrations base set and the
--   historical Classic Collection reprints BOTH live under set_id = 'cel25'.
--   Grouping by set therefore CANNOT report them separately, and the number
--   CAT-2D.3 called "the single most decision-relevant" — image coverage of the
--   Classic Collection under either identity — is invisible in Q-A2's output.
--
-- ⚠ READS RAW public.cards for the partition. The historical rows are fully
--   effective (CAT-2D.3 Gate 0 Q-E: 25/25 in cards_effective), so this is NOT
--   about alias exclusion — it is because no column in the view separates the
--   two cel25 populations. Effective membership is reported as its own column.
--
-- THE SELECTOR IS CAT-2D.3's, REPRODUCED VERBATIM
--
--   historical := set_id = 'cel25' AND local_id ~ '^[0-9]+$' IS NOT TRUE
--   base_set   := set_id = 'cel25' AND local_id ~ '^[0-9]+$'
--
--   Its known limitation is carried forward unchanged and must not be
--   forgotten here: the selector proves SIZE, RANGE, GAP and DUPLICATE
--   consistency but NOT membership. A numeric-local_id historical row
--   occupying a number whose live base-set row is absent would sit in the
--   wrong partition. CAT-2D.3 settled membership with an independent upstream
--   liveness check; this statement does not re-derive it and does not need to,
--   because a small misassignment between the two cel25 partitions cannot
--   change an image-coverage conclusion that is reported for BOTH partitions
--   plus their total.
--
-- Expected from CAT-2D.3 Gate 0 (2026-08-18), to be re-established not assumed:
--   base_set      25 rows · 24 populated image_url · 25 effective
--   historical    25 rows ·  0 populated image_url · 25 effective
--   cel25cc       25 rows ·  0 populated image_url · 25 effective

with cel25_all as (
  select c.id, c.local_id, c.image_url
  from public.cards c
  where c.set_id = 'cel25'
),
populations as (
  select 'cel25_base_set_live'          as population, id, image_url
    from cel25_all where local_id ~ '^[0-9]+$'
  union all
  select 'cel25_classic_collection_historical' as population, id, image_url
    from cel25_all where local_id ~ '^[0-9]+$' is not true
  union all
  select 'cel25cc_current'              as population, c.id, c.image_url
    from public.cards c where c.set_id = 'cel25cc'
)
select
  p.population,
  count(*)                                                         as rows_total,
  count(*) filter (where p.image_url is null or btrim(p.image_url) = '')
                                                                   as image_missing,
  count(*) filter (where p.image_url is not null and btrim(p.image_url) <> '')
                                                                   as image_populated,
  count(*) filter (where exists (
    select 1 from public.cards_effective e where e.id = p.id
  ))                                                               as rows_in_cards_effective,
  round(100.0 * count(*) filter (where p.image_url is null or btrim(p.image_url) = '')
              / nullif(count(*), 0), 2)                            as pct_missing
from populations p
group by p.population
order by p.population;


-- ═══════════════════════════════════════════════════════════════════════════
-- Q-A3 — COVERAGE PARTITIONS   (gate G-2)
-- ═══════════════════════════════════════════════════════════════════════════
-- The three-way partition CAT-0 reported as "51 fully image-missing sets
-- accounting for 1,370 of 1,640 gaps", re-measured on the current effective
-- catalog. Concentration is the number that decides whether any remedy could
-- be targeted rather than broad.

with per_set as (
  select
    e.set_id,
    count(*)                                                       as cards_total,
    count(*) filter (where e.image_url is null or btrim(e.image_url) = '')
                                                                   as image_missing
  from public.cards_effective e
  group by e.set_id
)
select
  count(*)                                                         as sets_total,
  count(*) filter (where image_missing = 0)                        as sets_fully_covered,
  count(*) filter (where image_missing = cards_total)              as sets_fully_missing,
  count(*) filter (where image_missing > 0 and image_missing < cards_total)
                                                                   as sets_partially_missing,
  coalesce(sum(image_missing), 0)                                  as missing_rows_total,
  coalesce(sum(image_missing) filter (where image_missing = cards_total), 0)
                                                                   as missing_rows_in_fully_missing_sets,
  coalesce(sum(image_missing) filter (where image_missing > 0 and image_missing < cards_total), 0)
                                                                   as missing_rows_in_partially_missing_sets,
  round(100.0 * coalesce(sum(image_missing) filter (where image_missing = cards_total), 0)
              / nullif(sum(image_missing), 0), 2)                  as pct_concentrated_in_fully_missing_sets
from per_set;


-- ═══════════════════════════════════════════════════════════════════════════
-- Q-A4a — LIVE-SCHEMA DIMENSION DISCOVERY   (gate G-2)
-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠ THIS IS THE CAT-2D.2 ENGINEERING RULE APPLIED TO DIMENSIONS.
--
-- CAT-2D.2 used a static reference inventory of what referenced cards(id) and
-- missed artists.signature_card_id, which carried a live FK. The rule adopted
-- from that: any claim about catalog structure must begin with live
-- information_schema discovery, not with the repository's belief about it.
--
-- CAT-3A must state which analysis dimensions exist. It PROVES them here
-- rather than asserting them from the repo. Specifically, the claims
--   "there is no language column"          and
--   "there is no image provenance column"
-- are established by this statement or they are not established at all.
--
-- If has_language_column or has_image_source_column comes back TRUE, the
-- specification's dimension section is WRONG and must be corrected before the
-- audit proceeds — a language dimension would change the analysis materially.

with cols as (
  select table_name, column_name, data_type, is_nullable
  from information_schema.columns
  where table_schema = 'public'
    and table_name in ('cards', 'cards_effective')
)
select
  (select count(*) from cols where table_name = 'cards')            as cards_column_count,
  (select count(*) from cols where table_name = 'cards_effective')  as cards_effective_column_count,
  (select string_agg(column_name, ',' order by ordinal_position)
     from information_schema.columns
    where table_schema = 'public' and table_name = 'cards')         as cards_columns,
  (select string_agg(column_name, ',' order by ordinal_position)
     from information_schema.columns
    where table_schema = 'public' and table_name = 'cards_effective')
                                                                    as cards_effective_columns,
  -- Dimension availability flags. Each must be read as: does the CATALOG
  -- support this analysis dimension at all?
  exists (select 1 from cols where column_name in ('language', 'lang', 'locale'))
                                                                    as has_language_column,
  exists (select 1 from cols where column_name in
            ('image_source', 'image_provenance', 'image_url_source', 'source'))
                                                                    as has_image_source_column,
  exists (select 1 from cols where table_name = 'cards' and column_name = 'series')
                                                                    as has_series_column,
  exists (select 1 from cols where table_name = 'cards' and column_name = 'release_date')
                                                                    as has_release_date_column,
  exists (select 1 from cols where table_name = 'cards_effective' and column_name = 'series')
                                                                    as view_exposes_series;


-- ═══════════════════════════════════════════════════════════════════════════
-- Q-A4b — COVERAGE BY SERIES   (gate G-2)
-- ═══════════════════════════════════════════════════════════════════════════
-- Real only because CAT-1 populated `series`. Run this ONLY if Q-A4a reports
-- has_series_column = true; if it does not, the dimension does not exist and
-- this statement must not be substituted with an inference from set-id
-- patterns.
--
-- `series` is not exposed by cards_effective, so this joins cards by id.

select
  coalesce(c.series, '(null)')                                     as series,
  count(*)                                                         as cards_total,
  count(*) filter (where e.image_url is null or btrim(e.image_url) = '')
                                                                   as image_missing,
  round(100.0 * count(*) filter (where e.image_url is null or btrim(e.image_url) = '')
              / nullif(count(*), 0), 2)                            as pct_missing,
  count(distinct e.set_id)                                         as sets_in_series
from public.cards_effective e
join public.cards c on c.id = e.id
group by c.series
order by image_missing desc, series;


-- ═══════════════════════════════════════════════════════════════════════════
-- Q-A4c — COVERAGE BY RELEASE YEAR   (gate G-2)
-- ═══════════════════════════════════════════════════════════════════════════
-- Era context for the concentration question: are gaps an old-catalog artifact,
-- a recent-ingestion artifact, or neither? Descriptive only — it decides
-- nothing on its own.

select
  coalesce(to_char(c.release_date, 'YYYY'), '(null)')              as release_year,
  count(*)                                                         as cards_total,
  count(*) filter (where e.image_url is null or btrim(e.image_url) = '')
                                                                   as image_missing,
  round(100.0 * count(*) filter (where e.image_url is null or btrim(e.image_url) = '')
              / nullif(count(*), 0), 2)                            as pct_missing
from public.cards_effective e
join public.cards c on c.id = e.id
group by 1
order by 1;


-- ═══════════════════════════════════════════════════════════════════════════
-- Q-A5a — image_url SHAPE CENSUS   (gate G-2)
-- ═══════════════════════════════════════════════════════════════════════════
-- CAT-0 Q4.2 re-run, extended.
--
-- WHY THIS MATTERS AND IS NOT HOUSEKEEPING. src/utils/imageUrl.js:8-9 renders
--   imgSmall = `${image_url}/low.webp`
-- so the stored value MUST be a TCGdex asset BASE path with no extension and
-- no trailing slash. Any populated value that does not have that shape is a
-- row that stores something but renders nothing — a distinct defect class from
-- "missing", and one no prior audit has measured.
--
-- It also detects whether any non-TCGdex value has already been written into
-- the column by some path, which would contradict the single-writer model
-- (sync-cards.mjs:332 is the only writer in the repository).

select
  count(*) filter (where image_url is not null and btrim(image_url) <> '')
                                                                   as populated_total,
  count(*) filter (where image_url ~* '\.(png|jpg|jpeg|webp|gif)$')
                                                                   as ends_with_extension,
  count(*) filter (where image_url is not null and btrim(image_url) <> ''
                     and image_url !~* '\.(png|jpg|jpeg|webp|gif)$')
                                                                   as base_form_no_extension,
  count(*) filter (where image_url is not null and btrim(image_url) <> ''
                     and image_url not like 'https://%')            as non_https,
  count(*) filter (where image_url like '%/')                       as trailing_slash,
  count(*) filter (where image_url <> btrim(image_url))             as leading_or_trailing_whitespace,
  count(*) filter (where image_url is not null and btrim(image_url) <> ''
                     and split_part(image_url, '/', 3) <> 'assets.tcgdex.net')
                                                                   as host_not_assets_tcgdex,
  count(distinct split_part(image_url, '/', 3))
    filter (where image_url is not null and btrim(image_url) <> '') as distinct_hosts
from public.cards_effective;


-- ═══════════════════════════════════════════════════════════════════════════
-- Q-A5b — DISTINCT image_url HOSTS   (gate G-2)
-- ═══════════════════════════════════════════════════════════════════════════
-- Expected: exactly one host, assets.tcgdex.net. Anything else is a finding.

select
  split_part(image_url, '/', 3)                                    as host,
  count(*)                                                         as cards
from public.cards_effective
where image_url is not null and btrim(image_url) <> ''
group by 1
order by cards desc, host;


-- ═══════════════════════════════════════════════════════════════════════════
-- Q-A6a — APPROVED-ALIAS IMAGE CENSUS   (gate G-3; dimension A)
-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠ READS RAW public.cards. This is the ONLY statement in this file that does
--   so for the alias population, and the only one that may. Alias rows are
--   excluded from cards_effective by construction, so the comparison is
--   impossible through the view.
--
-- ⚠ THIS MAKES NO IDENTITY CLAIM. The 192 pairs were admitted INDIVIDUALLY by
--   CAT-2D.2 with per-pair upstream evidence. This statement compares image
--   presence across pairings that already exist. It creates no pairing, infers
--   no correspondence, and proposes no mapping.
--
-- ⚠ IT ALSO PROPOSES NO REPAIR. A2 is a MEASUREMENT, not an instruction. No
--   image value is copied here, and whether an alias row's image may ever be
--   used for its canonical survivor is an explicit policy decision recorded in
--   the specification's decision framework (D-ALIAS), not something this
--   statement settles.
--
-- Expected: pairs_total = 192, and unresolved_alias_rows =
-- unresolved_canonical_rows = 0. A non-zero unresolved count means the alias
-- table references a row that is not in `cards`, which is a Q-A0 failure and
-- must STOP the audit.

with pairs as (
  select
    r.alias_card_id,
    r.canonical_card_id,
    a.image_url                                                    as alias_image_url,
    c.image_url                                                    as canonical_image_url,
    (a.id is null)                                                 as alias_row_missing,
    (c.id is null)                                                 as canonical_row_missing
  from public.card_identity_resolution r
  left join public.cards a on a.id = r.alias_card_id
  left join public.cards c on c.id = r.canonical_card_id
),
classified as (
  select
    case
      when alias_row_missing or canonical_row_missing then 'A_UNRESOLVED'
      when (alias_image_url is not null and btrim(alias_image_url) <> '')
       and (canonical_image_url is not null and btrim(canonical_image_url) <> '')
        then 'A1_ALIAS_IMAGE_CANONICAL_IMAGE'
      when (alias_image_url is not null and btrim(alias_image_url) <> '')
       and (canonical_image_url is null or btrim(canonical_image_url) = '')
        then 'A2_ALIAS_IMAGE_CANONICAL_MISSING'
      when (alias_image_url is null or btrim(alias_image_url) = '')
       and (canonical_image_url is not null and btrim(canonical_image_url) <> '')
        then 'A3_ALIAS_MISSING_CANONICAL_IMAGE'
      else 'A4_ALIAS_MISSING_CANONICAL_MISSING'
    end                                                            as alias_state
  from pairs
)
select
  alias_state,
  count(*)                                                         as pair_count,
  round(100.0 * count(*) / nullif(sum(count(*)) over (), 0), 2)    as pct_of_pairs
from classified
group by alias_state
order by alias_state;


-- ═══════════════════════════════════════════════════════════════════════════
-- Q-A6b — FULL APPROVED-PAIR STATE EXPORT — PROBE INPUT   (gate G-3)
-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠ ALL 192 PAIRS, NOT JUST A2. This is deliberate and was a review
--   correction.
--
--   Exporting only the A2 subset would leave the probe unable to distinguish
--   "this canonical row has no approved alias at all" (A0) from "this canonical
--   row has an approved alias and BOTH sides are missing an image" (A4). Every
--   A4 canonical row IS in the missing-image population, so an A2-only export
--   silently mislabels them A0, understates the A dimension, and makes the
--   promised 192-row alias census artifact impossible to produce.
--
--   Which alias states can appear in the missing-image population at all:
--     A2  alias has image, canonical missing   -> canonical IS missing-image
--     A4  both missing                         -> canonical IS missing-image
--     A1  both have images                     -> canonical is NOT missing-image
--     A3  alias missing, canonical has image   -> canonical is NOT missing-image
--   A1 and A3 are exported anyway. The census artifact must reconcile to 192,
--   and a state that is absent by construction is worth showing to be absent.
--
-- ⚠ THIS PROPOSES NO REPAIR. alias_image_url is emitted so P4 can test whether
--   the retained asset is still LIVE on assets.tcgdex.net — CAT-2D.2 recorded
--   alias_upstream_status = 404 for the API record, but the asset host has a
--   separate lifecycle and its liveness must be measured, never inferred. The
--   value is a LIVENESS TARGET, not a proposed value for the canonical row, and
--   must not be applied as one. P4 probes A2 rows only.
--
-- Public catalog data only. No user data, no UUIDs.
--
-- Expected: exactly 192 rows, and ZERO carrying A_UNRESOLVED.
--
-- G-3 validates both, and the probe HARD-STOPS on either failure. It does not
-- proceed on a partial or unresolved alias population: doing so would silently
-- treat every absent pair as A0, understate the A dimension, and still let the
-- completeness gate pass. A partial A population means O3 is withheld and no
-- outcome is derived at all.
--
-- Operator: save as docs/cat-3a-evidence/inputs/alias_pairs_input.csv

-- ⚠ UNRESOLVED DETECTION USES JOINED-ROW EXISTENCE, NOT THE ALIAS ROW'S OWN
--   COLUMNS. This was a review correction and it is load-bearing.
--
--   r.alias_card_id and r.canonical_card_id come from card_identity_resolution.
--   alias_card_id is that table's PRIMARY KEY, so it is never null — testing it
--   for null proves nothing at all and would report every pair as resolved.
--   What must be proven is that the JOINED `cards` rows exist, which is
--   a.id / c.id after the LEFT JOIN.
--
--   This matters more on the alias side than the canonical side:
--   canonical_card_id carries an FK to cards(id); alias_card_id DOES NOT
--   (cat-2d1-1-dark-alias-foundation.sql §1). A missing alias row is therefore
--   schema-permitted, and it would surface as a null alias_image_url —
--   indistinguishable from a genuine A3/A4 unless existence is carried
--   explicitly. Q-A0's alias_sources_missing_from_cards is the population-level
--   version of the same check.

with pairs as (
  select
    r.alias_card_id,
    r.canonical_card_id,
    (a.id is not null)                                             as alias_row_exists,
    (c.id is not null)                                             as canonical_row_exists,
    a.image_url                                                    as alias_image_url,
    c.image_url                                                    as canonical_image_url,
    c.set_id                                                       as canonical_set_id,
    c.set_name                                                     as canonical_set_name,
    c.local_id                                                     as canonical_local_id,
    c.name                                                         as canonical_name
  from public.card_identity_resolution r
  left join public.cards a on a.id = r.alias_card_id
  left join public.cards c on c.id = r.canonical_card_id
)
select
  alias_card_id,
  canonical_card_id,
  alias_row_exists,
  canonical_row_exists,
  canonical_set_id,
  canonical_set_name,
  canonical_local_id,
  canonical_name,
  case
    when not alias_row_exists or not canonical_row_exists
      then 'A_UNRESOLVED'
    when (alias_image_url is not null and btrim(alias_image_url) <> '')
     and (canonical_image_url is not null and btrim(canonical_image_url) <> '')
      then 'A1_ALIAS_IMAGE_CANONICAL_IMAGE'
    when (alias_image_url is not null and btrim(alias_image_url) <> '')
     and (canonical_image_url is null or btrim(canonical_image_url) = '')
      then 'A2_ALIAS_IMAGE_CANONICAL_MISSING'
    when (alias_image_url is null or btrim(alias_image_url) = '')
     and (canonical_image_url is not null and btrim(canonical_image_url) <> '')
      then 'A3_ALIAS_MISSING_CANONICAL_IMAGE'
    else 'A4_ALIAS_MISSING_CANONICAL_MISSING'
  end                                                              as alias_state,
  alias_image_url
from pairs
order by canonical_set_id, canonical_local_id, canonical_card_id;


-- ═══════════════════════════════════════════════════════════════════════════
-- Q-A7a — ACTIVE-OWNED IMAGE EXPOSURE   (gate G-2)
-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠ COUNTS ONLY. No user UUID, no batch id, no row id is emitted. user_id
--   appears solely inside COUNT(DISTINCT ...), exactly as CAT-2D.3 Gate 0 Q-B
--   does, because "40 rows" and "40 collectors" are different severities.
--
-- user_import_rows and user_import_batches are READ ONLY here.
--
-- Ownership authority is the matched card_id of an ACTIVE batch. Candidate ids
-- are diagnostic and are NOT ownership — they are deliberately excluded.
--
-- Alias resolution is applied exactly as production does it
-- (get_active_snapshot_owned_card_ids, CAT-2D.1 §5): a matched historical id
-- resolves one hop to its canonical survivor before the catalog join. Skipping
-- it would count an owned card as absent from the effective catalog.
--
-- Re-measures CAT-0's owned figure (114 / 4,776 = 2.39%).

with owned as (
  select distinct
    coalesce(ires.canonical_card_id, r.card_id)                    as resolved_card_id
  from public.user_import_rows r
  join public.user_import_batches b
    on b.id = r.batch_id and b.status = 'active'
  left join public.card_identity_resolution ires
    on ires.alias_card_id = r.card_id
  where r.match_status = 'matched'
    and r.card_id is not null
),
owned_users as (
  select count(distinct b.user_id)                                 as active_owner_count
  from public.user_import_rows r
  join public.user_import_batches b
    on b.id = r.batch_id and b.status = 'active'
  where r.match_status = 'matched'
    and r.card_id is not null
)
select
  (select active_owner_count from owned_users)                     as active_owner_count,
  count(*)                                                         as owned_distinct_cards,
  count(*) filter (where e.id is null)                             as owned_ids_not_in_effective_catalog,
  count(*) filter (where e.image_url is null or btrim(e.image_url) = '')
                                                                   as owned_image_missing,
  round(100.0 * count(*) filter (where e.image_url is null or btrim(e.image_url) = '')
              / nullif(count(*), 0), 2)                            as pct_owned_image_missing
from owned o
left join public.cards_effective e on e.id = o.resolved_card_id;


-- ═══════════════════════════════════════════════════════════════════════════
-- Q-A7b — ACTIVE-OWNED IMAGE EXPOSURE BY SET   (gate G-2)
-- ═══════════════════════════════════════════════════════════════════════════
-- Which sets actually cost collectors something. This is the weighting input
-- for the decision framework: CAT-0 found owned exposure materially BELOW
-- global exposure, and if that still holds it argues down any broad remedy
-- independently of what the sources can supply.
--
-- Counts only. No user dimension is projected at all in this statement.

with owned as (
  select distinct
    coalesce(ires.canonical_card_id, r.card_id)                    as resolved_card_id
  from public.user_import_rows r
  join public.user_import_batches b
    on b.id = r.batch_id and b.status = 'active'
  left join public.card_identity_resolution ires
    on ires.alias_card_id = r.card_id
  where r.match_status = 'matched'
    and r.card_id is not null
)
select
  e.set_id,
  max(e.set_name)                                                  as set_name,
  count(*)                                                         as owned_cards,
  count(*) filter (where e.image_url is null or btrim(e.image_url) = '')
                                                                   as owned_image_missing,
  round(100.0 * count(*) filter (where e.image_url is null or btrim(e.image_url) = '')
              / nullif(count(*), 0), 2)                            as pct_owned_image_missing
from owned o
join public.cards_effective e on e.id = o.resolved_card_id
group by e.set_id
having count(*) filter (where e.image_url is null or btrim(e.image_url) = '') > 0
order by owned_image_missing desc, e.set_id;


-- ═══════════════════════════════════════════════════════════════════════════
-- Q-A7c — ACTIVE-OWNED MISSING-IMAGE CARD IDS — OPERATOR-ONLY PROBE INPUT
-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠ OPERATOR-ONLY. DO NOT COMMIT THIS OUTPUT.
--
-- WHY IT EXISTS. G-10 requires an ACTIVE-OWNED O0 = 0 gate and the decision
-- framework weights O1/O3 by active-owned exposure. Both need per-row linkage
-- between a recoverability OUTCOME (which only the probe computes) and the
-- owned population (which only the database knows). Q-A7a/Q-A7b aggregate, so
-- neither can supply that linkage. Without this statement the active-owned
-- gate is unmeasurable and would have to be silently dropped.
--
-- WHY IT IS STILL PRIVACY-SAFE TO PRODUCE, AND NOT TO PUBLISH.
--   Emitted:     distinct catalog card ids, and nothing else.
--   NOT emitted: user_id, batch id, row id, quantity, per-user anything.
--   There is no user dimension in the projection at all — one column, one row
--   per distinct card.
--
--   It is nonetheless a projection of what the collector base collectively
--   owns, which is not public information. So it is an INPUT to the probe and
--   never an artifact. The probe uses it to compute AGGREGATE active-owned
--   counts; only those aggregates become committed evidence, and the probe is
--   structurally prevented from copying these ids into per-row output.
--
-- docs/cat-3a-evidence/inputs/ is gitignored so this cannot be committed by
-- accident.
--
-- Operator: save as docs/cat-3a-evidence/inputs/owned_missing_ids_input.csv
--           DELETE IT when the audit run is complete.
--
-- ⚠ ALSO SAVE Q-A7d. The probe requires an INDEPENDENT expected count before it
--   will treat the active-owned scope as decision-grade. Matching supplied ids
--   against the evidence proves only that the ids we were given are real — it
--   cannot detect a TRUNCATED export, because a file holding 3 of 114 owned ids
--   reconciles perfectly against itself. Q-A7d is the count that catches that.

with owned as (
  select distinct
    coalesce(ires.canonical_card_id, r.card_id)                    as resolved_card_id
  from public.user_import_rows r
  join public.user_import_batches b
    on b.id = r.batch_id and b.status = 'active'
  left join public.card_identity_resolution ires
    on ires.alias_card_id = r.card_id
  where r.match_status = 'matched'
    and r.card_id is not null
)
select
  e.id                                                             as card_id
from owned o
join public.cards_effective e on e.id = o.resolved_card_id
where e.image_url is null or btrim(e.image_url) = ''
order by e.id;


-- ═══════════════════════════════════════════════════════════════════════════
-- Q-A7d — ACTIVE-OWNED EXPECTED COUNT — RECONCILIATION INPUT   (gate G-10)
-- ═══════════════════════════════════════════════════════════════════════════
-- One number: how many rows Q-A7c should have produced.
--
-- WHY THIS IS NOT REDUNDANT WITH Q-A7c ITSELF.
--
--   The probe checks that every supplied owned id appears in the Q-A8a
--   evidence. That proves the ids we were given are real. It CANNOT detect a
--   truncated export: a file holding 3 of 114 owned ids matches perfectly
--   against itself and reports a clean reconciliation.
--
--   The active-owned O0 gate is a NO-TOLERANCE gate — it must read `O0 = 0`
--   before any active-owned conclusion is drawn. A gate that strict must not be
--   satisfiable by a short file. This independent count is the only thing that
--   can catch that, so the probe treats the active-owned scope as
--   not_evaluated when it is absent or disagrees.
--
-- It is deliberately a COUNT and not a second id list: nothing here needs to
-- restate the population, only to size it.
--
-- This is the same figure Q-A7a reports as owned_image_missing. It is repeated
-- as its own statement so the operator saves a clean one-value CSV rather than
-- transcribing a column out of a wider result.
--
-- Counts only. No user dimension is projected.
--
-- Operator: save as docs/cat-3a-evidence/inputs/owned_expected_count_input.csv
--           DELETE IT with the rest of the inputs when the run completes.

with owned as (
  select distinct
    coalesce(ires.canonical_card_id, r.card_id)                    as resolved_card_id
  from public.user_import_rows r
  join public.user_import_batches b
    on b.id = r.batch_id and b.status = 'active'
  left join public.card_identity_resolution ires
    on ires.alias_card_id = r.card_id
  where r.match_status = 'matched'
    and r.card_id is not null
)
select
  count(*) filter (where e.image_url is null or btrim(e.image_url) = '')
                                                                   as owned_image_missing
from owned o
join public.cards_effective e on e.id = o.resolved_card_id;


-- ═══════════════════════════════════════════════════════════════════════════
-- Q-A8a — MISSING-IMAGE ROW EXPORT — P1/P2/P3 PROBE INPUT   (gate G-4)
-- ═══════════════════════════════════════════════════════════════════════════
-- The complete inventory the external probes classify. Ordered by id so a
-- re-run is byte-comparable to its predecessor.
--
-- ⚠ THE ROW COUNT MUST EQUAL Q-A1's cards_effective image_missing FIGURE
--   EXACTLY. G-4 fails otherwise and the probes MUST NOT run. Classifying
--   against a partial inventory would produce a recoverability rate for a
--   population nobody enumerated — the same fail-closed rule
--   catalogIndexLoader.js:68 applies to the matcher catalog.
--
-- Public catalog data only. No user data, no UUIDs, no pricing, no ownership.
--
-- Operator: save as docs/cat-3a-evidence/inputs/image_gaps_input.csv

select
  e.id,
  e.set_id,
  e.set_name,
  e.local_id,
  e.name
from public.cards_effective e
where e.image_url is null or btrim(e.image_url) = ''
order by e.id;


-- ═══════════════════════════════════════════════════════════════════════════
-- Q-A8b — P3-0 CONTROL POOL EXPORT   (gate G-7 input)
-- ═══════════════════════════════════════════════════════════════════════════
-- CANDIDATE pool for the Pokémon TCG API reliability gate. Not the controls.
--
-- ⚠ WHAT A POPULATED image_url DOES AND DOES NOT PROVE — a review correction.
--
--   A populated image_url proves TCGdex served an asset for that card. It does
--   NOT prove the same card id exists in pokemontcg.io. The two providers
--   disagree about set-id conventions, so a perfectly legitimate provider-ID
--   mismatch would make a "known-valid" control 404 — and the reliability gate
--   would fail for a reason that has nothing to do with reliability.
--
--   Validity therefore cannot be established by SQL at all. It is established
--   by the probe's QUALIFICATION pass: only ids that actually resolve to an
--   exact-ID success against pokemontcg.io become qualified controls, and only
--   qualified controls are re-probed for the gate. This statement supplies
--   candidates for that qualification pass and nothing more.
--
-- Deliberately NOT done here: any pokemontcg.io knowledge. This file holds no
-- provider correspondence, so it cannot pre-filter by which set ids match
-- verbatim. The probe applies that filter.
--
-- Diversity is seeded here — at most 2 rows per set across every set in the
-- catalog — so the qualification pass has early, mid and modern candidates to
-- work with. Final control selection is a deterministic stratified draw across
-- the QUALIFIED era range, performed by the probe.
--
-- release_date and series are projected because they are the stratification
-- key. CAT-1 populated both; Q-A4a proves they exist.
--
-- Operator: save as docs/cat-3a-evidence/inputs/p3_control_pool_input.csv

with ranked as (
  select
    e.id,
    e.set_id,
    e.set_name,
    e.local_id,
    e.name,
    c.series,
    c.release_date,
    row_number() over (partition by e.set_id order by e.id)        as rn_in_set
  from public.cards_effective e
  join public.cards c on c.id = e.id
  where e.image_url is not null and btrim(e.image_url) <> ''
)
select
  id,
  set_id,
  set_name,
  local_id,
  name,
  series,
  release_date
from ranked
where rn_in_set <= 2
order by release_date nulls last, set_id, id;
