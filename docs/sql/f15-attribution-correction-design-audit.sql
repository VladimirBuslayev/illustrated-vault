-- ═══════════════════════════════════════════════════════════════════════════
-- F-15 — Durable Attribution Correction: DESIGN AUDIT (READ-ONLY)
--
-- ⚠ THIS FILE CONTAINS NO DDL AND NO DML. IT IS SELECT-ONLY BY CONSTRUCTION.
--
-- Every statement below is a SELECT. There is no CREATE, ALTER, DROP, INSERT,
-- UPDATE, DELETE, GRANT or REVOKE anywhere in this file, and it is safe to run
-- against production at any time.
--
-- Purpose:
--   A-*  establish the current production shape the design must fit
--   B-*  measure the five existing illustrator_override rows and prove the
--        F-15 backfill is deterministic and behaviour-preserving
--   C-*  resolve the twelve ATTR-1 target illustrators against public.artists
--   D-*  bound the consumer/blast radius
--   E-*  the post-implementation drift detector (see design doc §15)
--
-- Base: main @ 039662d338b15a38b7ec89be3a87fd73886ac873
-- Measured: 2026-08-20. Expected values recorded inline are that measurement.
-- Re-run before any implementation; if a figure has moved, STOP and re-derive.
--
-- Corrected 2026-08-21 (PR #25 review): every resolver query below matches
-- ONLY against unnest(artists.aliases). An earlier draft also matched
-- lower(artists.id), which sync/sync-cards.mjs's resolveArtistId() /
-- loadArtistAliasMap() never do (they build their lookup map from
-- artists.aliases exclusively). The B-1/B-2/C-1/E-1/E-2 queries below now
-- match the sync resolver exactly, so admission and sync cannot disagree
-- about what a name resolves to.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── A-1: card_extras shape ───────────────────────────────────────────────────
-- Expect 10 columns. There is NO artist-association override column today —
-- that absence is the F-15 gap.
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'card_extras'
order by ordinal_position;


-- ── A-2: card_extras constraints, triggers, RLS ──────────────────────────────
-- Expect: PK(card_id), FK→cards ON DELETE CASCADE, the four CAT-3B image
-- constraints, FK image_override_source_card_id ON DELETE RESTRICT,
-- triggers card_extras_set_updated_at + card_extras_admit_image_override.
select conname, contype, pg_get_constraintdef(oid) as def
from pg_constraint where conrelid = 'public.card_extras'::regclass
order by contype, conname;

select tgname, pg_get_triggerdef(oid) as def
from pg_trigger where tgrelid = 'public.card_extras'::regclass and not tgisinternal;

select relrowsecurity, relforcerowsecurity
from pg_class where oid = 'public.card_extras'::regclass;   -- expect true, false

select polname, polcmd, pg_get_expr(polqual, polrelid) as using_expr
from pg_policy where polrelid = 'public.card_extras'::regclass;
-- expect exactly one: card_extras_public_select, cmd r, USING true


-- ── A-3: the CAT-3B column ACL (F-15 must preserve this shape) ───────────────
-- Expect relacl = postgres + service_role ONLY (no anon/authenticated at table
-- level), and column-level SELECT for anon/authenticated on exactly:
--   card_id, illustrator_override, image_url_override
-- Every provenance column must show (none).
select 'relacl' as kind, coalesce(array_to_string(relacl, ' | '), '(null)') as detail
from pg_class where oid = 'public.card_extras'::regclass
union all
select 'colacl: ' || a.attname, coalesce(array_to_string(a.attacl, ' | '), '(none)')
from pg_attribute a
where a.attrelid = 'public.card_extras'::regclass and a.attnum > 0 and not a.attisdropped
order by 1;


-- ── A-4: the live cards_effective definition ─────────────────────────────────
-- Expect 14 columns; illustrator and image_url COALESCEd through card_extras;
-- artist_id taken RAW from c. That asymmetry is F-15.
select pg_get_viewdef('public.cards_effective'::regclass, true) as def;


-- ── A-5: artists shape and alias ambiguity ───────────────────────────────────
-- Expect (2026-08-20): 29 artists, 39 distinct normalized aliases,
-- aliases_shared_across_artists = 0, and NO uniqueness constraint enforcing it.
-- Ambiguity is currently impossible by DATA, not by SCHEMA — which is exactly
-- why admission must fail closed on it (design doc §12, rule R4).
with x as (
  select a.id as artist_id, lower(btrim(al)) as norm
  from public.artists a, unnest(a.aliases) al
)
select
  (select count(*) from public.artists)                                   as artist_rows,
  (select count(distinct norm) from x)                                    as distinct_normalized_aliases,
  (select count(*) from (
     select norm from x group by norm having count(distinct artist_id) > 1
   ) t)                                                                   as aliases_shared_across_artists;

select indexname, indexdef from pg_indexes
where schemaname = 'public' and tablename = 'artists';
-- expect ONLY artists_pkey — no unique index on normalized aliases


-- ── B-1: the five existing illustrator_override rows ─────────────────────────
-- The F-15 non-regression case. For each row this compares the CURRENT raw
-- artist_id against what the deterministic resolver would produce from the
-- override string.
--
-- Expected (2026-08-20) — all five agree, so the backfill is behaviour-preserving:
--   swsh11-185        N-DESIGN Inc.  raw=NULL          resolved=NULL          match=0
--   swsh11-186        Shinji Kanda   raw=shinji-kanda  resolved=shinji-kanda  match=1
--   swsh12-TG11       Yuu Nishida    raw=NULL          resolved=NULL          match=0
--   swsh12.5gg-GG19   Asako Ito      raw=asako-ito     resolved=asako-ito     match=1
--   swsh12.5gg-GG69   Akira Egawa    raw=akira-egawa   resolved=akira-egawa   match=1
select
  ce.card_id,
  c.illustrator                          as raw_illustrator,
  ce.illustrator_override                as override,
  c.artist_id                            as raw_artist_id_today,
  (select a.id from public.artists a
    where exists (select 1 from unnest(coalesce(a.aliases, array[]::text[])) al
                  where lower(btrim(al)) = lower(btrim(ce.illustrator_override)))
    limit 1)                             as resolver_would_give,
  (select count(*) from public.artists a
    where exists (select 1 from unnest(coalesce(a.aliases, array[]::text[])) al
                  where lower(btrim(al)) = lower(btrim(ce.illustrator_override))))
                                         as match_count,
  ce.source_note
from public.card_extras ce
join public.cards c on c.id = ce.card_id
where ce.illustrator_override is not null
order by ce.card_id;


-- ── B-2: THE MIGRATION GATE ──────────────────────────────────────────────────
-- Counts the override rows where the resolver DISAGREES with today's raw
-- artist_id, and the rows the resolver cannot decide.
--
-- MUST BE 0 AND 0 BEFORE THE VIEW SEMANTICS ARE SWITCHED.
-- Any non-zero value means the backfill would silently change an existing
-- artist membership → HOLD, do not proceed (design doc §6).
--
-- Independent re-run against production, 2026-08-20 (post aliases-only
-- correction): override_rows = 5, would_change_membership = 0,
-- ambiguous_rows = 0. A point-in-time reading, not a standing fact — re-run
-- again immediately before the migration executes (design doc §18 step 2).
with r as (
  select
    ce.card_id,
    c.artist_id as raw_artist_id,
    (select a.id from public.artists a
      where exists (select 1 from unnest(coalesce(a.aliases, array[]::text[])) al
                    where lower(btrim(al)) = lower(btrim(ce.illustrator_override)))
      limit 1) as resolved,
    (select count(*) from public.artists a
      where exists (select 1 from unnest(coalesce(a.aliases, array[]::text[])) al
                    where lower(btrim(al)) = lower(btrim(ce.illustrator_override)))) as match_count
  from public.card_extras ce
  join public.cards c on c.id = ce.card_id
  where ce.illustrator_override is not null
)
select
  count(*)                                                          as override_rows,
  count(*) filter (where resolved is distinct from raw_artist_id)   as would_change_membership,  -- expect 0
  count(*) filter (where match_count > 1)                           as ambiguous_rows            -- expect 0
from r;


-- ── B-3: raw artist_id that is NOT derivable from raw illustrator ────────────
-- A latent sync-durability hazard independent of F-15 (design doc §14.3).
-- Expect 3 raw rows, of which only swsh11-186 is live in cards_effective;
-- swsh12.5-GG19 / -GG69 are CAT-2D.2 alias rows already excluded from the view.
select c.id, c.illustrator as raw_illustrator, c.artist_id as raw_artist_id,
       exists (select 1 from public.cards_effective ce where ce.id = c.id) as live_in_effective
from public.cards c
where c.illustrator is null and c.artist_id is not null
order by c.id;


-- ── C-1: the twelve ATTR-1 targets, resolved ─────────────────────────────────
-- Card ids and verified illustrators are transcribed from committed evidence
-- (docs/attr-0-evidence/gate2-print-verification.csv CONFIRMED_WRONG + ATTR-0 §3).
-- This query RESOLVES them; it does not repair anything.
--
-- Expected (2026-08-20): match_count = 0 on ALL TWELVE, so expected
-- artist_id_override is an intentional NULL for every row, and exactly ONE row
-- (xyp-XY67a) currently holds a non-null effective artist_id.
with target(card_id, verified_illustrator) as (values
  ('g1-28a','Ryo Ueda'), ('g1-73a','Naoki Saito'), ('xy10-111a','Naoki Saito'),
  ('xy10-43a','Ryo Ueda'), ('xy4-65a','Ryo Ueda'), ('xy6-77a','TOKIYA'),
  ('xy7-75a','You Iribi'), ('xy9-107a','Naoki Saito'), ('xy9-98b','Sanosuke Sakuma'),
  ('xyp-XY150a','Hasuno'), ('xyp-XY177a','Hitoshi Ariga'), ('xyp-XY67a','Naoki Saito')
)
select
  t.card_id,
  ce.illustrator                        as current_effective_illustrator,
  ce.artist_id                          as current_effective_artist_id,
  t.verified_illustrator,
  (select count(*) from public.artists a
    where exists (select 1 from unnest(coalesce(a.aliases, array[]::text[])) al
                  where lower(btrim(al)) = lower(btrim(t.verified_illustrator))))
                                        as verified_artist_match_count,
  (select a.id from public.artists a
    where exists (select 1 from unnest(coalesce(a.aliases, array[]::text[])) al
                  where lower(btrim(al)) = lower(btrim(t.verified_illustrator)))
    limit 1)                            as expected_artist_id_override,
  (ce.id is not null)                   as live_in_effective
from target t
left join public.cards_effective ce on ce.id = t.card_id
order by t.card_id;


-- ── C-2: repair population sanity ────────────────────────────────────────────
-- Expect 12 / 12 / 1 / 0.
with target(card_id) as (values
  ('g1-28a'),('g1-73a'),('xy10-111a'),('xy10-43a'),('xy4-65a'),('xy6-77a'),
  ('xy7-75a'),('xy9-107a'),('xy9-98b'),('xyp-XY150a'),('xyp-XY177a'),('xyp-XY67a')
)
select
  count(*)                                                                       as population,
  count(*) filter (where exists (select 1 from public.cards_effective ce where ce.id = t.card_id))
                                                                                 as live_in_effective,
  count(*) filter (where exists (select 1 from public.cards_effective ce
                                 where ce.id = t.card_id and ce.artist_id is not null))
                                                                                 as have_fk_today,
  count(*) filter (where exists (select 1 from public.card_extras x
                                 where x.card_id = t.card_id and x.illustrator_override is not null))
                                                                                 as already_overridden
from target t;


-- ── C-3: the names the repair moves away from ────────────────────────────────
-- Proves no illustrator string is ELIMINATED from illustrator_directory by the
-- repair — so add_artist_to_archive stays valid for every one of them and no
-- discovery row disappears. Expect remaining_after_repair >= 47 on every row.
with t(card_id, cur) as (values
  ('g1-28a','Naoki Saito'),('g1-73a','Yusuke Ohmura'),('xy10-111a','Ken Sugimori'),
  ('xy10-43a','PLANETA'),('xy4-65a','Ayaka Yoshida'),('xy6-77a','Ayaka Yoshida'),
  ('xy7-75a','Yusuke Ohmura'),('xy9-107a','Yusuke Ohmura'),('xy9-98b','Yusuke Ohmura'),
  ('xyp-XY150a','Eske Yoshinob'),('xyp-XY177a','You Iribi'),('xyp-XY67a','sui')
)
select t.cur as losing_name,
       count(*) as cards_leaving,
       (select count(*) from public.cards_effective ce where ce.illustrator = t.cur) as current_total,
       (select count(*) from public.cards_effective ce where ce.illustrator = t.cur) - count(*)
         as remaining_after_repair
from t group by t.cur order by remaining_after_repair;


-- ── C-4: the seven corrected-to illustrators ─────────────────────────────────
-- Each is ALREADY a large untagged catalog string with no artists row, so a
-- corrected card with artist_id NULL lands in exactly the state its 60–451
-- siblings are already in — it is not a new orphan class (design doc §15).
-- Expect of_those_fk_tagged = 0 and in_directory = 1 on every row.
with t(nm) as (values ('Ryo Ueda'),('Naoki Saito'),('TOKIYA'),('You Iribi'),
                      ('Sanosuke Sakuma'),('Hasuno'),('Hitoshi Ariga'))
select t.nm,
  (select count(*) from public.cards_effective ce where ce.illustrator = t.nm) as eff_cards_with_name,
  (select count(*) from public.cards_effective ce
     where ce.illustrator = t.nm and ce.artist_id is not null)                 as of_those_fk_tagged,
  (select count(*) from public.illustrator_directory d where d.illustrator = t.nm) as in_directory
from t order by t.nm;


-- ── D-1: every database consumer of effective artist attribution ─────────────
-- Expect exactly two functions: add_artist_to_archive (reads
-- cards_effective.illustrator) and get_active_import_snapshot_read_model
-- (projects AND filters on ce.artist_id). Any third result is a consumer the
-- design doc §16 audit did not cover — STOP and re-audit.
select p.proname,
       (position('artist_id' in pg_get_functiondef(p.oid)) > 0)      as mentions_artist_id,
       (position('cards_effective' in pg_get_functiondef(p.oid)) > 0) as reads_cards_effective,
       (position('card_extras' in pg_get_functiondef(p.oid)) > 0)     as reads_card_extras
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f'
  and (pg_get_functiondef(p.oid) ilike '%artist_id%'
    or pg_get_functiondef(p.oid) ilike '%cards_effective%')
order by p.proname;


-- ── D-2: views over cards_effective ──────────────────────────────────────────
-- Expect illustrator_directory (max(artist_id) group by illustrator).
select c.relname, pg_get_viewdef(c.oid, true) as def
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'v'
  and c.relname <> 'cards_effective'
  and pg_get_viewdef(c.oid, true) ilike '%cards_effective%';


-- ── D-3: the one curated artist the repair touches ───────────────────────────
-- Expect sui = 224 today, 223 after xyp-XY67a is corrected. No other curated
-- artist changes count.
select a.id,
       (select count(*) from public.cards_effective ce where ce.artist_id = a.id) as eff_cards_by_fk
from public.artists a
where a.id = 'sui';


-- ═══════════════════════════════════════════════════════════════════════════
-- E — POST-IMPLEMENTATION DRIFT DETECTOR
--
-- These two queries are inert today (the columns do not exist yet) and are
-- recorded here as the design's answer to the artist-directory lifecycle
-- question (§15). Run them ONLY after the F-15 columns exist. They are
-- SELECT-only and detect, they never repair.
--
-- E-1  correction rows whose intentional-NULL artist target has since become
--      representable, because an artists row was created after the correction
--      was admitted. Non-zero output is not an error — it is the queue for a
--      deliberate, reviewed reconciliation pass.
--
--   select ce.card_id, ce.illustrator_override, ce.artist_id_override,
--          (select a.id from public.artists a
--             where exists (select 1 from unnest(coalesce(a.aliases, array[]::text[])) al
--                           where lower(btrim(al)) = lower(btrim(ce.illustrator_override)))
--             limit 1) as resolver_would_now_give
--   from public.card_extras ce
--   where ce.illustrator_override is not null
--     and ce.artist_id_override is null
--     and exists (select 1 from public.artists a
--                 where exists (select 1 from unnest(coalesce(a.aliases, array[]::text[])) al
--                               where lower(btrim(al)) = lower(btrim(ce.illustrator_override))));
--
-- E-2  the invariant that must ALWAYS hold: no correction row may point at an
--      artist that does not resolve from its own override string (I-5), and no
--      artist_id_override may exist without an illustrator_override (R5).
--      Expect 0 rows, permanently.
--
--   select ce.card_id, ce.illustrator_override, ce.artist_id_override
--   from public.card_extras ce
--   where (ce.artist_id_override is not null and ce.illustrator_override is null)
--      or (ce.artist_id_override is not null and not exists (
--            select 1 from public.artists a
--            where a.id = ce.artist_id_override
--              and exists (select 1 from unnest(coalesce(a.aliases, array[]::text[])) al
--                          where lower(btrim(al)) = lower(btrim(ce.illustrator_override)))));
-- ═══════════════════════════════════════════════════════════════════════════
