-- docs/sql/cat-3b-2-validation.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- CAT-3B — deployment validation. READ-ONLY.
--
-- Companion to docs/sql/cat-3b-1-durable-image-override.sql.
-- Full document: docs/CAT-3B_DURABLE_IMAGE_OVERRIDE.md
--
-- ─────────────────────────────────────────────────────────────────────────
-- ⚠ STATUS: PREPARED — NOT EXECUTED
-- ─────────────────────────────────────────────────────────────────────────
--
-- ─────────────────────────────────────────────────────────────────────────
-- WHAT THIS PROVES
-- ─────────────────────────────────────────────────────────────────────────
-- The central claim of CAT-3B's deployment is that it changes NOTHING that is
-- rendered. Every check below exists to make that falsifiable rather than
-- asserted:
--
--   V-1  card_extras pre-existing columns are byte-identical across the
--        schema addition — checksummed over the PRE-EXISTING COLUMNS ONLY.
--   V-2  every new override field is NULL on every row.
--   V-3  cards_effective is row-for-row output-equivalent to pre-CAT-3B.
--   V-4  the view's structural contract is intact — 14 columns, order,
--        security_invoker, grants.
--   V-5  the admission wall exists and is SECURITY INVOKER.
--
-- ─────────────────────────────────────────────────────────────────────────
-- EXECUTION CONTRACT
-- ─────────────────────────────────────────────────────────────────────────
--   * every statement is SELECT-only — no DDL, no DML, no RPC, no sync;
--   * NO temp tables, NO begin/commit, NO set_config, NO auth impersonation;
--   * each statement is independently self-contained;
--   * run as the migration owner. No user UUID appears in this file and no
--     statement emits one.
--
-- ⚠ V-1 REQUIRES A BEFORE-CAPTURE. Run V-1 BEFORE applying
--   cat-3b-1-durable-image-override.sql, record the output, then run it again
--   after. The two must match exactly.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- V-1 — card_extras PRE-EXISTING columns, unchanged by the schema addition
-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠ RUN BEFORE AND AFTER THE MIGRATION. The two outputs must be identical.
--
-- The checksum covers ONLY the columns that existed before CAT-3B:
--   card_id, illustrator_override, source_note, created_at, updated_at
--
-- A whole-row to_jsonb(ce) checksum would be USELESS here: adding columns
-- changes the row's JSON shape, so it would differ by construction and prove
-- nothing about whether existing data moved. Projecting the pre-existing
-- columns explicitly is what makes the before/after comparison meaningful.
--
-- Expected: row_count 5 (CAT-0 baseline, unchanged since), and a payload_digest
-- identical across the two runs.

select
  count(*)                                                          as row_count,
  md5(string_agg(
        to_jsonb(t)::text, '|' order by t.card_id
      ))                                                            as payload_digest,
  count(*) filter (where t.illustrator_override is not null)        as illustrator_overrides,
  min(t.created_at)                                                 as earliest_created_at,
  max(t.updated_at)                                                 as latest_updated_at
from (
  select
    ce.card_id,
    ce.illustrator_override,
    ce.source_note,
    ce.created_at,
    ce.updated_at
  from public.card_extras ce
) t;


-- ═══════════════════════════════════════════════════════════════════════════
-- V-2 — every new override field is NULL on every row
-- ═══════════════════════════════════════════════════════════════════════════
-- Run AFTER the migration. CAT-3B creates the channel and populates nothing,
-- so all five counters must be 0 and rows_with_any_override_field must be 0.
--
-- rows_with_any_override_field is the one that matters: it catches a partially
-- populated row that the individual counters could mask.

select
  count(*)                                                           as card_extras_rows,
  count(image_url_override)                                          as image_url_override_set,
  count(image_override_source_card_id)                               as source_card_id_set,
  count(image_override_evidence)                                     as evidence_set,
  count(image_override_approved_by)                                  as approved_by_set,
  count(image_override_approved_at)                                  as approved_at_set,
  count(*) filter (
    where image_url_override            is not null
       or image_override_source_card_id is not null
       or image_override_evidence       is not null
       or image_override_approved_by    is not null
       or image_override_approved_at    is not null
  )                                                                  as rows_with_any_override_field
from public.card_extras;


-- ═══════════════════════════════════════════════════════════════════════════
-- V-3 — cards_effective is ROW-FOR-ROW output-equivalent to pre-CAT-3B
-- ═══════════════════════════════════════════════════════════════════════════
-- Run AFTER the migration.
--
-- This is the load-bearing check. It does NOT compare against a remembered
-- number: it reconstructs the PRE-CAT-3B expression inline from the same base
-- tables and diffs the two projections symmetrically, so any divergence in any
-- column of any row surfaces.
--
-- The reconstruction is the CAT-2D.1 definition verbatim — same joins, same
-- alias exclusion, same 14 columns — with `c.image_url` where the deployed view
-- now has the coalesce. With zero override rows the two must be identical.
--
-- Expected: rows_only_in_deployed = 0, rows_only_in_expected = 0, and both
-- totals equal to the current effective catalog size (23,588 at CAT-3A).

with expected as (
  select
    c.id, c.name, c.set_id, c.set_name, c.local_id,
    coalesce(ce.illustrator_override, c.illustrator) as illustrator,
    c.image_url,
    c.rarity, c.release_date, c.pricing, c.pricing_updated_at,
    c.pricing_source, c.last_synced_at, c.artist_id
  from public.cards c
  left join public.card_extras ce on c.id = ce.card_id
  where not exists (
    select 1 from public.card_identity_resolution r
    where r.alias_card_id = c.id
  )
),
deployed as (
  select
    e.id, e.name, e.set_id, e.set_name, e.local_id, e.illustrator, e.image_url,
    e.rarity, e.release_date, e.pricing, e.pricing_updated_at,
    e.pricing_source, e.last_synced_at, e.artist_id
  from public.cards_effective e
)
select
  (select count(*) from deployed)                                    as deployed_rows,
  (select count(*) from expected)                                    as expected_rows,
  (select count(*) from (
     select * from deployed except all select * from expected) d)    as rows_only_in_deployed,
  (select count(*) from (
     select * from expected except all select * from deployed) x)    as rows_only_in_expected,
  (select count(*) from deployed where image_url is null)            as deployed_null_images,
  (select count(*) from expected where image_url is null)            as expected_null_images;


-- ═══════════════════════════════════════════════════════════════════════════
-- V-4 — the view's structural contract is intact
-- ═══════════════════════════════════════════════════════════════════════════
-- Column count, column ORDER, security_invoker and grants. CAT-2D.1 made all
-- four load-bearing; CAT-3B must preserve every one.
--
-- Expected:
--   column_count            = 14
--   column_list             = id,name,set_id,set_name,local_id,illustrator,
--                             image_url,rarity,release_date,pricing,
--                             pricing_updated_at,pricing_source,
--                             last_synced_at,artist_id
--   artist_id_is_column_14  = true
--   security_invoker_on     = true
--   grantees                = anon, authenticated, service_role (select)

select
  (select count(*)
     from information_schema.columns
    where table_schema = 'public' and table_name = 'cards_effective')  as column_count,
  (select string_agg(column_name, ',' order by ordinal_position)
     from information_schema.columns
    where table_schema = 'public' and table_name = 'cards_effective')  as column_list,
  (select column_name = 'artist_id'
     from information_schema.columns
    where table_schema = 'public' and table_name = 'cards_effective'
      and ordinal_position = 14)                                       as artist_id_is_column_14,
  (select 'security_invoker=true' = any(c.reloptions)
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'cards_effective')      as security_invoker_on,
  (select string_agg(distinct grantee, ', ' order by grantee)
     from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'cards_effective'
      and privilege_type = 'SELECT')                                   as select_grantees;


-- ═══════════════════════════════════════════════════════════════════════════
-- V-5 — the admission wall exists, and is NOT SECURITY DEFINER
-- ═══════════════════════════════════════════════════════════════════════════
-- CAT-3B's identity guarantee rests entirely on this trigger. Its absence
-- would leave the columns writable with no alias check at all.
--
-- prosecdef MUST be false: a SECURITY DEFINER function here would run with the
-- owner's rights and could read public.card_identity_aliases, silently
-- punching through the privilege wall CAT-2D.1 built. The design deliberately
-- reads the public card_identity_resolution view instead.
--
-- Expected: function_exists true, is_security_definer FALSE,
--           trigger_exists true, fires BEFORE INSERT OR UPDATE, row-level,
--           reads_resolution_view true, reads_private_alias_table FALSE.

select
  (select count(*) = 1
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'card_extras_admit_image_override')              as function_exists,
  (select p.prosecdef
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'card_extras_admit_image_override')              as is_security_definer,
  (select count(*) = 1
     from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where c.relname = 'card_extras'
      and t.tgname = 'card_extras_admit_image_override'
      and not t.tgisinternal)                                          as trigger_exists,
  (select p.prosrc like '%card_identity_resolution%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'card_extras_admit_image_override')              as reads_resolution_view,
  (select p.prosrc like '%card_identity_aliases%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'card_extras_admit_image_override')              as reads_private_alias_table,
  (select count(*)
     from pg_constraint
    where conrelid = 'public.card_extras'::regclass
      and conname like 'card_extras_image_override%')                  as image_override_constraints;
