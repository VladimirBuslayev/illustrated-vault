-- docs/sql/cat-2d3-gate0-impact-audit.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- CAT-2D.3 GATE 0 — Celebrations production impact audit
--
-- READ-ONLY. This file answers one decision question:
--
--   Are the 25 historical Celebrations Classic Collection identities materially
--   load-bearing in production today, or can CAT-2D.3 safely be deferred while
--   we prioritise visible catalog / image completeness?
--
-- IT MAKES NO IDENTITY CLAIM. No alias is proposed, derived or implied here.
-- Name and set correspondences are reported as DIAGNOSTIC ONLY and must never
-- be promoted into a historical → survivor mapping on the strength of this
-- output. CAT-2D.3's mapping requires 25 individually corroborated pairs, per
-- docs/CAT-2D.3_CELEBRATIONS_IDENTITY_REMAP.md §3.
--
-- ─────────────────────────────────────────────────────────────────────────
-- EXECUTION CONTRACT
-- ─────────────────────────────────────────────────────────────────────────
--   * every statement is SELECT-only — no DDL, no DML, no RPC, no sync;
--   * NO temp tables, NO begin/commit, NO set_config, NO auth impersonation.
--     CAT-2D.2 established that this workflow must not depend on cross
--     top-level-statement TEMP or session state, so nothing here does;
--   * each statement is INDEPENDENTLY SELF-CONTAINED. Every one repeats the
--     population CTE verbatim. Run them in any order, in any session, any
--     number of times. None reads state produced by another;
--   * run as the migration owner / a privileged role. These are global
--     diagnostics across all users, so RLS must not scope them — that is why
--     no JWT context is established. No user UUID appears in this file, and no
--     statement emits one.
--
-- ⚠ NOTHING IN THIS FILE MAY BE COMMITTED WITH ITS OUTPUT PASTED IN if that
--   output contains user-identifying values. Q-C is written to return COUNTS
--   ONLY for exactly that reason. If per-row detail is ever needed
--   operationally, keep it in the operator's session; do not commit it.
--
-- ─────────────────────────────────────────────────────────────────────────
-- ⚠ THE POPULATION GATE IS THREE CHECKS, NOT ONE. ALL THREE MUST PASS
--   BEFORE Q-B..Q-G MAY RUN.
-- ─────────────────────────────────────────────────────────────────────────
--   1. Q-A0 passes every integrity flag;
--   2. Q-A1 enumerates all 50 rows coherently — the partition is reviewed by
--      eye and nothing looks misplaced;
--   3. current UPSTREAM cel25 live ids agree EXACTLY with Q-A1's numeric
--      partition — same count, same members, no extras on either side.
--
-- Every statement below keys off a CANDIDATE historical population. If that
-- population is not exactly the 25 rows we think it is, every downstream
-- number is measuring the wrong rows. Q-A0 alone does NOT prove the partition;
-- check 3 is the independent discriminator. See the selector note below.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- THE POPULATION SELECTOR — how the 25 historical rows are identified, and
-- what about it is assumption rather than evidence
-- ═══════════════════════════════════════════════════════════════════════════
--
-- THE PROBLEM. The live Celebrations base set and the historical Classic
-- Collection reprints BOTH live under set_id = 'cel25'. CAT-0 measured that
-- set at 50 rows (docs/cat-0-evidence/catalog_coverage_by_set.csv line 47:
-- cel25,Celebrations,50,...). 25 of those are the base set; 25 are the
-- Classic Collection rows whose provider identity moved to cel25cc-CC###.
-- There is no set_id, set_name or flag in public.cards that separates them.
--
-- WHAT IS ESTABLISHED EVIDENCE:
--   E1  cel25 holds 50 rows and cel25cc holds 25 [CAT-0, committed:
--       docs/cat-0-evidence/catalog_coverage_by_set.csv].
--   E2  The historical Classic Collection rows carry LEGACY local ids — the
--       numbers of the original printings they reproduce — not CC###. Six are
--       recorded from a production probe [committed:
--       docs/CAT-2D.3_CELEBRATIONS_IDENTITY_REMAP.md §1]:
--         cel25-2A Blastoise · cel25-4A Charizard · cel25-15A1 Venusaur ·
--         cel25-17A Umbreon Star · cel25-60A Tapu Lele GX · cel25-88A Mew ex
--   E3  CAT-2D.2's production Phase A proved the pattern '^CC[0-9]{3}$'
--       matches ZERO rows in cel25 — which is why Celebrations was split out.
--
-- WHAT IS NOT ESTABLISHED, AND IS THEREFORE ASSUMED HERE:
--   A1  that "local_id is purely numeric" separates the live base set from the
--       historical reprints exactly. Every one of the six known historical ids
--       carries a letter suffix (2A, 4A, 15A1, 17A, 60A, 88A), and the live
--       upstream cel25 set was observed on 2026-08-17 to serve exactly 25
--       cards numbered 1..25 — but that observation is a SESSION OBSERVATION
--       from the CAT-2D.2 evidence work, NOT committed repository evidence,
--       and the remaining 19 historical ids have never been enumerated.
--
-- docs/CAT-2D.3_CELEBRATIONS_IDENTITY_REMAP.md §3.1 is explicit that this
-- partition "must be established from data, not from a pattern". This file
-- honours that in the only way SQL can: it does NOT assert the pattern is
-- right. It computes the partition, then makes the partition FALSIFIABLE —
-- and then requires an INDEPENDENT check that SQL cannot perform.
--
--   * Q-A0 reports the partition sizes and several integrity flags. The
--     complement must be exactly 25 rows AND exactly the numbers 1..25 with no
--     gaps, duplicates or extras.
--   * Q-A1 enumerates ALL 50 rows — both partitions, labelled — so a reviewer
--     can confirm the split by eye rather than trusting a regex. 50 rows is
--     small enough that nothing needs to be taken on faith.
--
-- ⚠ WHAT Q-A0 CAN AND CANNOT PROVE — stated precisely, because an earlier
--   revision of this file overstated it.
--
--   Q-A0 is a strong CONSISTENCY test. It is NOT a proof of the partition, and
--   it is not true that "a single numeric historical row would break it".
--   Consider the failure mode it cannot see: if a numeric-local_id historical
--   row occupied a number whose live base-set row is missing from storage, the
--   numeric partition would still contain 25 rows spanning exactly 1..25 with
--   no duplicates. Every Q-A0 flag would pass while one historical row sat in
--   the base-set partition and one base-set row was absent entirely. The
--   counts would be right and the membership would be wrong.
--
--   Q-A0 therefore rules out the LOOSE failures — wrong sizes, gaps,
--   duplicates, NULLs, stray CC### rows. It cannot rule out a substitution.
--
-- REQUIRED CORROBORATION, OUTSIDE SQL — THE INDEPENDENT DISCRIMINATOR.
-- This is a hard prerequisite, not a nice-to-have: Q-B..Q-G may not be run
-- until it passes. Confirm the population against upstream liveness — the same
-- evidence class CAT-2D.2 used (A5, 404/200), which is what makes this data
-- rather than pattern:
--
--   curl -s https://api.tcgdex.net/v2/en/sets/cel25 | jq -r '.cards[].id' | sort
--
-- Every id that returns is a live base-set row; every stored cel25 id that
-- does NOT appear is historical. Compare that list against Q-A1's numeric
-- partition as SETS, not just as counts — they must agree exactly, with no
-- extras on either side. A stored numeric id missing from upstream is a
-- historical row hiding in the base-set partition; an upstream id missing from
-- storage is a base-set row we never ingested. Either one invalidates the
-- selector, and Q-B..Q-G must then be re-run against the corrected population.
--
-- Deliberately NOT done: pairing any historical row to any survivor. Upstream
-- liveness partitions the population; it does not map it.
--
-- Deliberately NOT done anywhere in this file: pairing any historical row to
-- any cel25cc survivor. Q-E reports name overlap as a duplicate-presentation
-- diagnostic and says so in its own output column.


-- ═══════════════════════════════════════════════════════════════════════════
-- Q-A0 — SELECTOR CONSISTENCY   (gate check 1 of 3; run first)
-- ═══════════════════════════════════════════════════════════════════════════
-- Expected, if the selector is consistent:
--   cel25_total_rows                       = 50
--   candidate_historical_rows              = 25
--   candidate_base_set_rows                = 25
--   base_set_is_exactly_1_to_25            = true
--   rows_with_null_local_id                = 0
--   historical_rows_matching_CC_pattern    = 0
--   cel25cc_rows                           = 25
--
-- ANY deviation means STOP and re-derive the population.
--
-- ⚠ Passing is NECESSARY, NOT SUFFICIENT. This rules out wrong sizes, gaps,
--   duplicates, NULLs and stray CC### rows. It cannot detect a historical row
--   substituting for an absent base-set number — see the selector note above.
--   Gate checks 2 (Q-A1 read by eye) and 3 (upstream liveness) are what settle
--   the membership. Do not proceed to Q-B on this statement alone.

with cel25_all as (
  select c.id, c.name, c.set_id, c.set_name, c.local_id,
         c.artist_id, c.illustrator, c.image_url
  from public.cards c
  where c.set_id = 'cel25'
),
historical as (          -- candidate Classic Collection reprints
  select * from cel25_all where local_id ~ '^[0-9]+$' is not true
),
base_set as (            -- candidate live Celebrations base set
  select * from cel25_all where local_id ~ '^[0-9]+$'
)
select
  (select count(*) from cel25_all)                                as cel25_total_rows,
  (select count(*) from historical)                               as candidate_historical_rows,
  (select count(*) from base_set)                                 as candidate_base_set_rows,
  -- The complement must be a COMPLETE 1..25: same count, same min, same max,
  -- and no duplicates.
  --
  -- SCOPE OF THIS FLAG: it proves SIZE, RANGE, GAP and DUPLICATE consistency.
  -- It does NOT prove MEMBERSHIP. A numeric-local_id historical row occupying
  -- a number whose live base-set row is absent from storage would satisfy
  -- every clause below while sitting in the wrong partition. Upstream
  -- liveness (gate check 3) is the independent discriminator for membership.
  (select count(*) = 25
      and count(distinct (local_id)::int) = 25
      and min((local_id)::int) = 1
      and max((local_id)::int) = 25
   from base_set)                                                 as base_set_is_exactly_1_to_25,
  (select count(*) from cel25_all where local_id is null)         as rows_with_null_local_id,
  (select count(*) from historical where local_id ~ '^CC[0-9]{3}$')
                                                                  as historical_rows_matching_cc_pattern,
  (select count(*) from public.cards where set_id = 'cel25cc')    as cel25cc_rows,
  (select count(distinct set_name) from cel25_all)                as distinct_set_names_in_cel25,
  (select string_agg(distinct set_name, ' | ') from cel25_all)    as set_names_in_cel25;


-- ═══════════════════════════════════════════════════════════════════════════
-- Q-A1 — FULL ENUMERATION OF set_id = 'cel25'   (all 50 rows, both partitions)
-- ═══════════════════════════════════════════════════════════════════════════
-- Answers question A, and lets a reviewer verify the Q-A0 partition by eye.
-- Every row in the set is listed — nothing is filtered away — so a
-- misclassified row is visible rather than silently dropped.
--
-- No user data. Catalog rows only.

with cel25_all as (
  select c.id, c.name, c.set_id, c.set_name, c.local_id,
         c.artist_id, c.illustrator, c.image_url
  from public.cards c
  where c.set_id = 'cel25'
)
select
  case when a.local_id ~ '^[0-9]+$'
       then 'base-set (candidate live)'
       else 'HISTORICAL (candidate Classic Collection)'
  end                                                             as partition,
  a.id,
  a.local_id,
  a.name,
  a.set_id,
  a.set_name,
  a.artist_id,
  a.illustrator,
  (a.image_url is not null and btrim(a.image_url) <> '')          as has_image,
  exists (select 1 from public.cards_effective ce where ce.id = a.id)
                                                                  as in_cards_effective,
  exists (select 1 from public.card_identity_aliases al where al.alias_card_id = a.id)
                                                                  as is_already_aliased
from cel25_all a
order by
  (a.local_id ~ '^[0-9]+$') desc,
  case when a.local_id ~ '^[0-9]+$' then (a.local_id)::int end nulls last,
  a.local_id;


-- ═══════════════════════════════════════════════════════════════════════════
-- Q-C0 — SCHEMA DISCOVERY: every card-id-like column, CLASSIFIED
-- ═══════════════════════════════════════════════════════════════════════════
-- Question C requires inspecting the CURRENT schema rather than trusting the
-- CAT-2D reference inventory. A bare '%card_id%' sweep is not enough on its
-- own, because it legitimately surfaces columns that are NOT catalog card
-- references — so a rule of "anything Q-C does not cover is a STOP" would fire
-- on known-immune structure and cry wolf.
--
-- Every hit is therefore CLASSIFIED against the current repo definitions:
--
--   direct catalog reference      a real public.cards id, migratable, in Q-C
--   immutable import evidence     user_import_rows.card_id / candidate_card_ids
--                                 — never rewritten; measured by Q-B instead
--   identity infrastructure       CAT-2D alias/canonical columns; the map
--                                 itself, not a consumer of it
--   membership reference          user_binder_layout_items.binder_card_id —
--                                 a FK to user_binder_cards(id, binder_id),
--                                 NOT a catalog card id. Structurally immune
--                                 to any provider rename (BP-3.1A)
--   STOP: unclassified            anything else — a potentially-direct catalog
--                                 reference nobody has accounted for
--
-- ⚠ THE STOP CONDITION IS THE LAST CLASS ONLY. A row classified as immutable
--   evidence, identity infrastructure or membership reference is expected and
--   is not a finding. Only 'STOP: unclassified card-id-like reference' halts
--   the gate.
--
-- Views are included as well as base tables, so card_identity_resolution is
-- visible rather than silently filtered out.

select
  t.table_type,
  c.table_name,
  c.column_name,
  c.data_type,
  case
    when c.table_name = 'user_import_rows' and c.column_name in ('card_id', 'candidate_card_ids')
      then 'immutable import evidence — measured by Q-B, never migrated'
    when c.table_name in ('card_identity_aliases', 'card_identity_resolution')
         and c.column_name in ('alias_card_id', 'canonical_card_id')
      then 'identity infrastructure — the alias map itself'
    when c.table_name = 'user_binder_layout_items' and c.column_name = 'binder_card_id'
      then 'membership reference (FK to user_binder_cards) — NOT a catalog card id — structurally immune'
    when c.table_name in ('card_extras', 'card_overrides', 'card_favorites',
                          'price_history', 'user_card_intent', 'user_binder_cards')
         and c.column_name = 'card_id'
      then 'direct catalog reference — covered by Q-C'
    else 'STOP: unclassified card-id-like reference'
  end                                                             as reference_class,
  exists (select 1 from information_schema.columns u
           where u.table_schema = 'public' and u.table_name = c.table_name
             and u.column_name = 'user_id')                       as has_user_id_column
from information_schema.columns c
join information_schema.tables t
  on t.table_schema = c.table_schema and t.table_name = c.table_name
where c.table_schema = 'public'
  and c.column_name like '%card_id%'
order by
  case when c.table_name in ('card_extras', 'card_overrides', 'card_favorites',
                             'price_history', 'user_card_intent', 'user_binder_cards')
       then 0 else 1 end,
  c.table_name, c.column_name;


-- ═══════════════════════════════════════════════════════════════════════════
-- Q-B — OWNERSHIP IMPACT   (the load-bearing question)
-- ═══════════════════════════════════════════════════════════════════════════
-- Separates the three reference classes the gate must not conflate:
--
--   ACTIVE MATCHED       — user_import_rows.card_id in an 'active' batch.
--                          This is the only class that is ownership authority.
--   ACTIVE CANDIDATE-ONLY— the id appears in candidate_card_ids of an active
--                          batch row but is not the matched card_id.
--                          DIAGNOSTIC. Never ownership authority, and never
--                          rewritten in either direction (CAT-2D principle 11).
--   SUPERSEDED/OTHER     — any non-active batch. Historical evidence only.
--
-- Aggregate counts only. No user_id, no batch id, no row id is emitted.
-- user_import_rows is READ ONLY here and is never modified by this file.

with cel25_all as (
  select c.id, c.local_id from public.cards c where c.set_id = 'cel25'
),
historical as (
  select id from cel25_all where local_id ~ '^[0-9]+$' is not true
),
rows_scoped as (
  select r.card_id, r.candidate_card_ids, r.match_status, r.quantity,
         b.status as batch_status,
         b.user_id                      -- aggregated with COUNT(DISTINCT ...) only
  from public.user_import_rows r
  join public.user_import_batches b on b.id = r.batch_id
)
select
  rs.batch_status,
  count(*) filter (
    where rs.match_status = 'matched'
      and rs.card_id in (select id from historical)
  )                                                               as matched_rows_on_historical_ids,
  -- Impacted collectors, as a COUNT ONLY. No UUID is emitted; this is here
  -- because "3 rows" and "3 collectors" are very different severities.
  count(distinct rs.user_id) filter (
    where rs.match_status = 'matched'
      and rs.card_id in (select id from historical)
  )                                                               as impacted_users,
  count(distinct rs.card_id) filter (
    where rs.match_status = 'matched'
      and rs.card_id in (select id from historical)
  )                                                               as distinct_historical_ids_matched,
  coalesce(sum(rs.quantity) filter (
    where rs.match_status = 'matched'
      and rs.card_id in (select id from historical)
  ), 0)                                                           as matched_quantity_on_historical_ids,
  count(*) filter (
    where exists (select 1 from historical h where h.id = any (rs.candidate_card_ids))
      and (rs.card_id is null or rs.card_id not in (select id from historical))
  )                                                               as candidate_only_rows,
  count(*)                                                        as all_rows_in_batches_of_this_status
from rows_scoped rs
group by rs.batch_status
order by rs.batch_status;


-- ═══════════════════════════════════════════════════════════════════════════
-- Q-C — MUTABLE DIRECT CATALOG REFERENCES, BY REFERENCE CLASS
-- ═══════════════════════════════════════════════════════════════════════════
-- COUNTS ONLY. No user UUID, binder id or row id is emitted, by design — this
-- output is intended to be safe to commit alongside the audit.
--
-- ⚠ card_extras IS NOT COLLECTOR-AUTHORED STATE. It is GLOBAL CATALOG /
--   EDITORIAL metadata — manual illustrator corrections, written by privileged
--   enrichment, shared by every user, with no user_id column at all
--   (docs/sql/card_extras_and_view.sql). It is inventoried here because it is
--   a mutable direct card reference that a future migration would have to
--   move, but it must NOT be added to a collector-impact total. Q-G keeps the
--   two apart for exactly this reason.
--
-- The six tables below are the CAT-2D reference inventory, re-verified by
-- CAT-2D.2's production Phase A. Q-C0 above classifies every card-id-like
-- column in the live schema; only an entry it marks 'STOP: unclassified' is a
-- finding.
--
-- Excluded deliberately, with reasons:
--   user_import_rows           — immutable historical evidence, covered by Q-B
--   user_binder_layout_items   — references a MEMBERSHIP row id, never a card
--                                id (BP-3.1A). Structurally immune
--   user_collection.owned_keys — name::num / name::set keys, not card ids.
--                                Structurally immune to any id rename
--   card_identity_aliases      — identity map; Q-A1 reports whether any
--                                cel25 row is already aliased (expected: none)
--
-- OWNER COUNTS. user_binder_cards has NO user_id column — ownership is carried
-- by the parent binder, and its RLS policies verify through it (BP-0A1). So
-- distinct owners are derived by joining public.user_binders, and distinct
-- binders are reported separately. A binder count is NOT an owner count and is
-- no longer labelled as one.

with cel25_all as (
  select c.id, c.local_id from public.cards c where c.set_id = 'cel25'
),
historical as (
  select id from cel25_all where local_id ~ '^[0-9]+$' is not true
)
select 'card_extras'       as table_name,
       'catalog/editorial metadata (global, not collector-authored)' as reference_class,
       count(*)                                                   as rows_referencing_historical,
       count(distinct t.card_id)                                   as distinct_historical_ids,
       null::bigint                                                as distinct_owners,
       null::bigint                                                as distinct_binders
  from public.card_extras t where t.card_id in (select id from historical)
union all
select 'card_overrides', 'collector-authored',
       count(*), count(distinct t.card_id), count(distinct t.user_id), null::bigint
  from public.card_overrides t where t.card_id in (select id from historical)
union all
select 'card_favorites', 'collector-authored',
       count(*), count(distinct t.card_id), count(distinct t.user_id), null::bigint
  from public.card_favorites t where t.card_id in (select id from historical)
union all
select 'price_history', 'collector-authored',
       count(*), count(distinct t.card_id), count(distinct t.user_id), null::bigint
  from public.price_history t where t.card_id in (select id from historical)
union all
select 'user_card_intent', 'collector-authored',
       count(*), count(distinct t.card_id), count(distinct t.user_id), null::bigint
  from public.user_card_intent t where t.card_id in (select id from historical)
union all
select 'user_binder_cards', 'collector-authored',
       count(*), count(distinct t.card_id),
       count(distinct ub.user_id),          -- owner, via the parent binder
       count(distinct t.binder_id)          -- binders, reported separately
  from public.user_binder_cards t
  join public.user_binders ub on ub.id = t.binder_id
  where t.card_id in (select id from historical)
order by table_name;


-- ═══════════════════════════════════════════════════════════════════════════
-- Q-D — ARTIST-FIRST IMPACT
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT THIS MEASURES: ARTIST-QUERY REACHABILITY. Not "is rendered today".
--
-- src/services/cardService.js :: fetchArtistCards proves the query shape:
--   * all artist paths read public.cards_effective;
--   * a curated entry with artistId  -> .eq('artist_id', entry.artistId);
--   * a dynamic entry                -> artist_id.eq(...) OR illustrator.in(...)
--                                       (exact equality on either, never ILIKE);
--   * an entry with neither          -> ILIKE fallback on illustrator.
--
-- So artist_id + cards_effective membership proves a row IS REACHABLE by an
-- artist query. It does NOT prove any collector renders it today: that also
-- requires an artist entry to exist for that identity (curated editorial or a
-- user's dynamic tracked artist) and for someone to open that page. Reach is
-- what this audit can measure; rendering is not.
--
-- Illustrator-string reachability is reported alongside, because the dynamic
-- branch matches on exact illustrator equality even when artist_id is NULL —
-- so a NULL artist_id does not by itself mean unreachable.
--
-- ⚠ THIS STATEMENT DOES NOT PAIR ROWS. It reports, per artist_id, how many
--   historical rows and how many cel25cc rows carry that artist_id. Equal
--   artist_id is NOT an identity claim and must never be used as one — the two
--   populations are compared in aggregate, never row to row.
--
-- CAT-0 context for comparison (committed, 2026-07-27): cel25 had 45 of 50
-- rows with an illustrator but a NULL artist_id; cel25cc had 23 of 25.

with cel25_all as (
  select c.id, c.local_id, c.artist_id, c.illustrator from public.cards c where c.set_id = 'cel25'
),
historical as (
  select * from cel25_all where local_id ~ '^[0-9]+$' is not true
),
survivors as (
  select c.id, c.artist_id, c.illustrator from public.cards c where c.set_id = 'cel25cc'
),
artist_ids as (
  select artist_id from historical where artist_id is not null
  union
  select artist_id from survivors  where artist_id is not null
)
select
  a.artist_id,
  (select count(*) from historical h where h.artist_id = a.artist_id)
                                                                  as historical_rows_with_this_artist,
  (select count(*) from historical h
     join public.cards_effective ce on ce.id = h.id
    where h.artist_id = a.artist_id)                              as historical_rows_artist_query_reachable,
  (select count(*) from survivors s where s.artist_id = a.artist_id)
                                                                  as cel25cc_rows_with_this_artist,
  (select count(*) from survivors s
     join public.cards_effective ce on ce.id = s.id
    where s.artist_id = a.artist_id)                              as cel25cc_rows_artist_query_reachable,
  'reachability by artist query, not proof of rendering — aggregate per artist_id, NOT a historical->survivor mapping'
                                                                  as caveat
from artist_ids a
order by a.artist_id;


-- ═══════════════════════════════════════════════════════════════════════════
-- Q-D2 — ARTIST REACHABILITY TOTALS
-- ═══════════════════════════════════════════════════════════════════════════

with cel25_all as (
  select c.id, c.local_id, c.artist_id, c.illustrator from public.cards c where c.set_id = 'cel25'
),
historical as (
  select * from cel25_all where local_id ~ '^[0-9]+$' is not true
),
survivors as (
  select c.id, c.artist_id, c.illustrator from public.cards c where c.set_id = 'cel25cc'
)
select
  (select count(*) from historical)                               as historical_rows,
  (select count(*) from historical where artist_id is not null)   as historical_with_artist_id,
  -- FK-path reachability: artist_id present AND the row is in the effective
  -- catalog the artist query actually reads.
  (select count(*) from historical h join public.cards_effective ce on ce.id = h.id
    where h.artist_id is not null)                                as historical_fk_reachable,
  -- Dynamic-branch reachability: exact illustrator equality, which applies even
  -- when artist_id is NULL.
  (select count(*) from historical h join public.cards_effective ce on ce.id = h.id
    where h.illustrator is not null and btrim(h.illustrator) <> '')
                                                                  as historical_illustrator_reachable,
  (select count(*) from historical where illustrator is not null
     and btrim(illustrator) <> '' and artist_id is null)          as historical_illustrator_but_no_artist_id,
  (select count(distinct artist_id) from historical where artist_id is not null)
                                                                  as historical_distinct_artists,
  (select count(*) from survivors)                                as cel25cc_rows,
  (select count(*) from survivors where artist_id is not null)    as cel25cc_with_artist_id,
  (select count(*) from survivors s join public.cards_effective ce on ce.id = s.id
    where s.artist_id is not null)                                as cel25cc_fk_reachable,
  (select count(*) from survivors s join public.cards_effective ce on ce.id = s.id
    where s.illustrator is not null and btrim(s.illustrator) <> '')
                                                                  as cel25cc_illustrator_reachable,
  (select count(*) from survivors where illustrator is not null
     and btrim(illustrator) <> '' and artist_id is null)          as cel25cc_illustrator_but_no_artist_id,
  (select count(distinct artist_id) from survivors where artist_id is not null)
                                                                  as cel25cc_distinct_artists,
  'reachability by artist query — rendering also needs an artist entry to exist'
                                                                  as caveat;


-- ═══════════════════════════════════════════════════════════════════════════
-- Q-E — CONCURRENT CATALOG PRESENCE   (presentation diagnostic ONLY)
-- ═══════════════════════════════════════════════════════════════════════════
-- Measures whether BOTH populations are concurrently present in the canonical
-- Supabase catalog (cards_effective), and how far their display names overlap.
--
-- ⚠ WHAT THIS DOES NOT SAY. Co-presence of two populations does NOT establish
--   that "every catalog surface shows the printing twice". That phrasing was
--   in an earlier revision and was wrong on its own terms: it presupposes a
--   row-to-row printing identity, and Gate 0 has no approved mapping. Two
--   populations of 25 rows each being present is exactly that — two
--   populations present. Whether any given pair is the same physical printing
--   is precisely the question CAT-2D.3 exists to answer, per pair, with
--   corroboration.
--
--   What CAN be said from this output:
--     * both populations are concurrently present in the canonical catalog;
--     * N historical display names also occur in cel25cc (a presentation
--       diagnostic — a collector browsing by name plausibly meets both);
--     * artist-query reachability is measured separately, in Q-D;
--     * no row-to-row printing identity is asserted anywhere.
--
-- ⚠ NAME OVERLAP IS NOT ALIAS EVIDENCE. The normalisation below is the frozen
--   normName transcription from src/utils/keys.js, used here only to compare
--   display names — never to propose a pairing. CAT-2D.3 §3 requires per-pair
--   corroboration; nothing in this output supplies it.

with cel25_all as (
  select c.id, c.name, c.local_id from public.cards c where c.set_id = 'cel25'
),
historical as (
  select id, name,
         regexp_replace(regexp_replace(lower(btrim(coalesce(name, ''))),
           '[^a-z0-9[:space:]]', '', 'g'), '[[:space:]]+', ' ', 'g') as norm_name
  from cel25_all where local_id ~ '^[0-9]+$' is not true
),
survivors as (
  select c.id, c.name,
         regexp_replace(regexp_replace(lower(btrim(coalesce(c.name, ''))),
           '[^a-z0-9[:space:]]', '', 'g'), '[[:space:]]+', ' ', 'g') as norm_name
  from public.cards c where c.set_id = 'cel25cc'
)
select
  (select count(*) from historical)                               as historical_rows,
  (select count(*) from historical h join public.cards_effective ce on ce.id = h.id)
                                                                  as historical_in_cards_effective,
  (select count(*) from survivors)                                as cel25cc_rows,
  (select count(*) from survivors s join public.cards_effective ce on ce.id = s.id)
                                                                  as cel25cc_in_cards_effective,
  (select count(*) from historical h
    where exists (select 1 from survivors s where s.norm_name = h.norm_name))
                                                                  as historical_names_also_in_cel25cc,
  (select count(*) from historical h
    where not exists (select 1 from survivors s where s.norm_name = h.norm_name))
                                                                  as historical_names_with_no_cel25cc_match,
  (select count(*) from (select norm_name from historical group by norm_name having count(*) > 1) q)
                                                                  as non_unique_names_within_historical,
  (select count(*) from (select norm_name from survivors group by norm_name having count(*) > 1) q)
                                                                  as non_unique_names_within_cel25cc,
  'DIAGNOSTIC ONLY — concurrent presence + name overlap — not identity evidence, no pairing asserted'
                                                                  as caveat;


-- ═══════════════════════════════════════════════════════════════════════════
-- Q-F — IMAGE / COMPLETENESS COMPARISON
-- ═══════════════════════════════════════════════════════════════════════════
-- Feeds the roadmap tradeoff: CAT-2D.3 identity work versus broader image and
-- catalog completeness.
--
-- ⚠ This measures PRESENCE per population. It does NOT and may not imply that
--   a historical row's image could stand in for a survivor.
--   Cross-printing image substitution is prohibited, and no approved pair
--   mapping exists that could even name a substitute.
--
-- CAT-0 context (committed, 2026-07-27): cel25 26 of 50 image_url_missing;
-- cel25cc 25 of 25 image_url_missing. Re-measure rather than assume.

with cel25_all as (
  select c.id, c.local_id, c.image_url from public.cards c where c.set_id = 'cel25'
),
pops as (
  select 'historical cel25 (Classic Collection)' as population, id, image_url
    from cel25_all where local_id ~ '^[0-9]+$' is not true
  union all
  select 'base-set cel25 (live Celebrations)', id, image_url
    from cel25_all where local_id ~ '^[0-9]+$'
  union all
  select 'cel25cc (current survivors)', c.id, c.image_url
    from public.cards c where c.set_id = 'cel25cc'
)
select
  p.population,
  count(*)                                                        as rows_total,
  count(*) filter (where p.image_url is not null and btrim(p.image_url) <> '')
                                                                  as rows_with_image,
  count(*) filter (where p.image_url is null or btrim(p.image_url) = '')
                                                                  as rows_missing_image,
  count(*) filter (where exists (select 1 from public.cards_effective ce where ce.id = p.id))
                                                                  as rows_in_cards_effective
from pops p
group by p.population
order by p.population;


-- ═══════════════════════════════════════════════════════════════════════════
-- Q-G — SEVERITY ROLL-UP   (the numbers that drive the classification)
-- ═══════════════════════════════════════════════════════════════════════════
-- Read alongside the framework in docs/CAT-2D.3_GATE0_IMPACT_AUDIT.md §5.
-- This statement CLASSIFIES NOTHING. It gathers the deciding figures into one
-- row; the judgement — including whether the evidence is mixed — is made by a
-- human against that framework.

with cel25_all as (
  select c.id, c.name, c.local_id, c.artist_id from public.cards c where c.set_id = 'cel25'
),
historical as (
  select id, artist_id,
         regexp_replace(regexp_replace(lower(btrim(coalesce(name, ''))),
           '[^a-z0-9[:space:]]', '', 'g'), '[[:space:]]+', ' ', 'g') as norm_name
  from cel25_all where local_id ~ '^[0-9]+$' is not true
),
survivors as (
  select c.id,
         regexp_replace(regexp_replace(lower(btrim(coalesce(c.name, ''))),
           '[^a-z0-9[:space:]]', '', 'g'), '[[:space:]]+', ' ', 'g') as norm_name
  from public.cards c where c.set_id = 'cel25cc'
),
active_matched as (
  select r.card_id, r.quantity, b.user_id
  from public.user_import_rows r
  join public.user_import_batches b on b.id = r.batch_id and b.status = 'active'
  where r.match_status = 'matched' and r.card_id is not null
)
select
  (select count(*) from historical)                               as historical_population,
  -- LOAD-BEARING signal 1: active physical ownership on old ids
  (select count(*) from active_matched am
    where am.card_id in (select id from historical))              as active_matched_rows,
  (select count(distinct am.user_id) from active_matched am
    where am.card_id in (select id from historical))              as active_impacted_users,
  (select count(distinct am.card_id) from active_matched am
    where am.card_id in (select id from historical))              as active_distinct_ids,
  (select coalesce(sum(am.quantity), 0) from active_matched am
    where am.card_id in (select id from historical))              as active_matched_quantity,
  -- LOAD-BEARING signal 2: COLLECTOR-AUTHORED state only.
  -- card_extras is EXCLUDED here on purpose — it is global catalog/editorial
  -- metadata with no user_id, not something a collector authored. Folding it
  -- in would inflate a collector-impact number with a catalog concern.
  (
    (select count(*) from public.card_overrides    t where t.card_id in (select id from historical)) +
    (select count(*) from public.card_favorites    t where t.card_id in (select id from historical)) +
    (select count(*) from public.price_history     t where t.card_id in (select id from historical)) +
    (select count(*) from public.user_card_intent  t where t.card_id in (select id from historical)) +
    (select count(*) from public.user_binder_cards t where t.card_id in (select id from historical))
  )                                                               as collector_authored_reference_rows,
  -- Reported SEPARATELY: a catalog-metadata migration signal, not collector impact.
  (select count(*) from public.card_extras t where t.card_id in (select id from historical))
                                                                  as card_extras_reference_rows,
  -- VISIBLE signal: concurrent catalog presence + the name-overlap diagnostic.
  -- Co-presence alone is not "duplicate presentation" — Gate 0 has no approved
  -- mapping and asserts no row-to-row identity.
  (select count(*) from historical h join public.cards_effective ce on ce.id = h.id)
                                                                  as historical_present_in_catalog,
  (select count(*) from survivors s join public.cards_effective ce on ce.id = s.id)
                                                                  as survivors_present_in_catalog,
  (select count(*) from historical h
    where exists (select 1 from survivors s where s.norm_name = h.norm_name))
                                                                  as historical_names_also_in_cel25cc,
  -- Artist-query REACHABILITY (not proof of rendering) — see Q-D.
  (select count(*) from historical h join public.cards_effective ce on ce.id = h.id
    where h.artist_id is not null)                                as historical_fk_reachable,
  'Gate 0 makes NO alias decision and proposes NO mapping'        as scope;
