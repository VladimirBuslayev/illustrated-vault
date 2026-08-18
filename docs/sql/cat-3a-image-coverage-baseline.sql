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
-- ⚠ STATUS: PREPARED — NOT EXECUTED
-- ─────────────────────────────────────────────────────────────────────────
-- No statement in this file has been run against production. Execution is a
-- separately approved step. When it runs, record the outputs in the
-- specification document and materialize the evidence artifacts under
-- docs/cat-3a-evidence/ as Commit 2.
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
--   Q-A3  cards_effective
--   Q-A4  information_schema, then cards / cards_effective
--   Q-A5  cards_effective
--   Q-A6  RAW cards — the only query that does, and the only one that may
--   Q-A7  cards_effective, through the alias resolution surface
--   Q-A8  cards_effective
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
-- `series` and `release_date` live on public.cards and are NOT projected by
-- cards_effective (the view exposes 14 columns and series is not among them —
-- CAT-0 §1.3.6). They are joined back by id, which is safe: the join is PK to
-- PK and cannot fan out or lose rows.
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
-- Q-A6b — A2 SUBSET DETAIL — P4 PROBE INPUT   (gate G-3)
-- ═══════════════════════════════════════════════════════════════════════════
-- The rows where the retained alias holds an image its canonical survivor
-- lacks. Emitted so P4 can test whether the retained asset is still LIVE on
-- assets.tcgdex.net — CAT-2D.2 recorded alias_upstream_status = 404 for the
-- API record, but the asset host has a separate lifecycle and its liveness
-- must be measured, never inferred.
--
-- Public catalog data only. No user data, no UUIDs.
--
-- Operator: save as docs/cat-3a-evidence/inputs/a2_alias_assets_input.csv
--
-- ⚠ Emitting alias_image_url here is for LIVENESS TESTING. It is not a
--   proposed value for the canonical row and must not be applied as one.

with pairs as (
  select
    r.alias_card_id,
    r.canonical_card_id,
    a.image_url                                                    as alias_image_url,
    c.image_url                                                    as canonical_image_url,
    c.set_id                                                       as canonical_set_id,
    c.set_name                                                     as canonical_set_name,
    c.local_id                                                     as canonical_local_id,
    c.name                                                         as canonical_name
  from public.card_identity_resolution r
  join public.cards a on a.id = r.alias_card_id
  join public.cards c on c.id = r.canonical_card_id
)
select
  alias_card_id,
  canonical_card_id,
  canonical_set_id,
  canonical_set_name,
  canonical_local_id,
  canonical_name,
  alias_image_url
from pairs
where (alias_image_url is not null and btrim(alias_image_url) <> '')
  and (canonical_image_url is null or btrim(canonical_image_url) = '')
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
-- Candidate known-valid controls for the Pokémon TCG API reliability gate.
--
-- A control must be a card we have independent reason to believe EXISTS: a
-- catalog row with a POPULATED image_url, i.e. one TCGdex itself served an
-- asset for. If a probe cannot resolve such a card, the source is unreliable
-- or the probe is unsound — and either way P3 must not run.
--
-- This exports a POOL, not the final 20. The final selection needs the
-- pokemontcg.io set inventory (a control is only meaningful in a set whose id
-- matches verbatim, since that is the only lookup shape the runtime performs),
-- and this file deliberately holds NO provider-correspondence knowledge. The
-- probe performs that filtering.
--
-- Spread is enforced here rather than left to the probe: at most 2 rows per
-- set, ordered by release date, so the pool spans eras and namespaces instead
-- of clustering in one easy modern set. The specification requires controls to
-- span multiple sets, eras and namespaces.
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
