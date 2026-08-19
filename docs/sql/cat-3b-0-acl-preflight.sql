-- docs/sql/cat-3b-0-acl-preflight.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- CAT-3B — ACL PREFLIGHT. READ-ONLY. RUN BEFORE THE MIGRATION.
--
-- Companion to docs/sql/cat-3b-1-durable-image-override.sql §6.
-- Full document: docs/CAT-3B_DURABLE_IMAGE_OVERRIDE.md
--
-- ─────────────────────────────────────────────────────────────────────────
-- ⚠ STATUS: PREPARED — NOT EXECUTED
-- ─────────────────────────────────────────────────────────────────────────
--
-- ─────────────────────────────────────────────────────────────────────────
-- WHY THIS EXISTS
-- ─────────────────────────────────────────────────────────────────────────
-- CAT-3B adds provenance columns to public.card_extras. That table currently
-- carries a TABLE-LEVEL SELECT grant, and a table-level grant covers every
-- column the table will EVER have.
--
-- So adding the columns would publish, to every anonymous visitor: who approved
-- each image override, when, on what evidence, and which retained
-- provider-history row it came from. Nobody would have decided that. It would
-- simply happen as a side effect of an ALTER TABLE.
--
-- ⚠ THE MIGRATION'S GRANT SECTION IS WRITTEN AGAINST AN EXPECTED STATE. This
--   file establishes the ACTUAL state. If they disagree, adjust the migration
--   before running it. Do not deploy §6 on assumption — that is the whole point
--   of a preflight.
--
-- ─────────────────────────────────────────────────────────────────────────
-- WHAT A PASS LOOKS LIKE (the expected baseline)
-- ─────────────────────────────────────────────────────────────────────────
--   P-1  card_extras: SELECT held at TABLE level by anon and authenticated;
--        no PUBLIC grant; no INSERT/UPDATE/DELETE for anon or authenticated.
--   P-2  no column-level grants yet (they are what CAT-3B introduces).
--   P-3  RLS enabled, exactly one permissive SELECT policy, USING (true),
--        for anon + authenticated. No write policies.
--   P-4  cards_effective: security_invoker = true; SELECT granted to anon,
--        authenticated, service_role.
--   P-5  NO routine (function/RPC) body references public.card_extras.
--   P-6  the three columns cards_effective needs all exist.
--
-- ANY DEVIATION IS A STOP, not a note. In particular:
--   * a PUBLIC grant on card_extras means the "anon/authenticated" framing is
--     wrong and the revoke list in §6 is incomplete;
--   * a routine that reads card_extras directly means the three-column grant
--     may break it, and the grant list must be widened to whatever it selects;
--   * cards_effective NOT being security_invoker would mean the whole
--     column-grant argument is moot and the design must be re-examined.
--
-- ─────────────────────────────────────────────────────────────────────────
-- EXECUTION CONTRACT
-- ─────────────────────────────────────────────────────────────────────────
--   * every statement is SELECT-only — no DDL, no DML, no RPC, no sync;
--   * NO temp tables, NO begin/commit, NO set_config, NO auth impersonation;
--   * each statement is independently self-contained;
--   * run as the migration owner. No user UUID appears in this file and no
--     statement emits one.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- P-1 — TABLE-level privileges on card_extras
-- ═══════════════════════════════════════════════════════════════════════════
-- information_schema.role_table_grants omits grants made to PUBLIC, so PUBLIC
-- is queried separately from pg_class.relacl below. Missing that is exactly how
-- a "we only granted anon" belief survives an actual GRANT TO PUBLIC.
--
-- Expected: anon SELECT, authenticated SELECT, nothing else for those two.

select
  'P-1 table grants'                                                as check_id,
  grantee,
  string_agg(privilege_type, ', ' order by privilege_type)          as privileges,
  bool_or(is_grantable = 'YES')                                     as any_grantable
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name   = 'card_extras'
group by grantee
order by grantee;


-- ═══════════════════════════════════════════════════════════════════════════
-- P-1b — the RAW ACL, including PUBLIC
-- ═══════════════════════════════════════════════════════════════════════════
-- relacl entries of the form "=r/owner" (empty grantee) are grants to PUBLIC.
-- A NULL relacl means default privileges — owner only, nothing granted.
--
-- Expected: no PUBLIC entry.

select
  'P-1b raw acl'                                                    as check_id,
  c.relacl::text                                                    as raw_acl,
  c.relacl is null                                                  as acl_is_default,
  exists (
    select 1 from unnest(coalesce(c.relacl, '{}'::aclitem[])) a
    where split_part(a::text, '=', 1) = ''
  )                                                                 as has_public_grant,
  c.relrowsecurity                                                  as rls_enabled,
  c.relforcerowsecurity                                             as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'card_extras';


-- ═══════════════════════════════════════════════════════════════════════════
-- P-2 — COLUMN-level privileges on card_extras
-- ═══════════════════════════════════════════════════════════════════════════
-- Expected BEFORE the migration: zero rows. Column grants are what CAT-3B
-- introduces. Pre-existing column grants would mean someone has already
-- restricted this table and the migration's blanket REVOKE would change more
-- than intended.

select
  'P-2 column grants'                                               as check_id,
  grantee,
  column_name,
  privilege_type
from information_schema.column_privileges
where table_schema = 'public'
  and table_name   = 'card_extras'
  and grantee not in ('postgres')
order by grantee, column_name, privilege_type;


-- ═══════════════════════════════════════════════════════════════════════════
-- P-3 — RLS state and policies on card_extras
-- ═══════════════════════════════════════════════════════════════════════════
-- Column grants and RLS are independent walls: grants decide which columns a
-- role may address, policies decide which rows. CAT-3B changes only the former,
-- so the latter must be recorded to prove it was left alone.
--
-- Expected: rls_enabled true; exactly one PERMISSIVE SELECT policy named
-- card_extras_public_select, qual "true", roles {anon,authenticated}; no
-- INSERT/UPDATE/DELETE policies.

select
  'P-3 policies'                                                    as check_id,
  pol.polname                                                       as policy_name,
  case pol.polcmd
    when 'r' then 'SELECT' when 'a' then 'INSERT'
    when 'w' then 'UPDATE' when 'd' then 'DELETE'
    when '*' then 'ALL'    else pol.polcmd::text
  end                                                               as command,
  pol.polpermissive                                                 as is_permissive,
  (select coalesce(string_agg(r.rolname, ',' order by r.rolname), '(public)')
     from pg_roles r where r.oid = any (pol.polroles))              as applies_to_roles,
  pg_get_expr(pol.polqual, pol.polrelid)                            as using_expr,
  pg_get_expr(pol.polwithcheck, pol.polrelid)                       as with_check_expr
from pg_policy pol
join pg_class c on c.oid = pol.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'card_extras'
order by pol.polname;


-- ═══════════════════════════════════════════════════════════════════════════
-- P-4 — cards_effective: security_invoker and grants
-- ═══════════════════════════════════════════════════════════════════════════
-- The entire column-grant design rests on security_invoker = true: reads
-- execute with the CALLER's privileges, so the caller must hold SELECT on the
-- card_extras columns the view touches.
--
-- ⚠ If security_invoker is FALSE the view already runs with owner rights, the
--   caller needs no card_extras privilege at all, and §6's reasoning does not
--   apply. That is a STOP and a design re-examination, not an adjustment.
--
-- Expected: security_invoker_on true; SELECT granted to anon, authenticated,
-- service_role.

select
  'P-4 cards_effective'                                             as check_id,
  (select 'security_invoker=true' = any(c.reloptions)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'cards_effective')   as security_invoker_on,
  (select c.reloptions::text
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'cards_effective')   as reloptions,
  (select string_agg(distinct grantee, ', ' order by grantee)
     from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'cards_effective'
      and privilege_type = 'SELECT')                                as select_grantees;


-- ═══════════════════════════════════════════════════════════════════════════
-- P-5 — does ANY routine read card_extras directly?
-- ═══════════════════════════════════════════════════════════════════════════
-- This is the check that decides whether a three-column grant is sufficient.
--
-- A SECURITY INVOKER function that selects card_extras.source_note would break
-- the moment the blanket grant is replaced, and it would break for callers, not
-- for the deployer — the worst possible time to discover it.
--
-- Repository evidence says no such routine exists: nothing in src/ reads
-- card_extras, and OL-0D asserts its own deployed body must NOT contain
-- "public.card_extras". This statement verifies that against LIVE production
-- rather than trusting the repo — the CAT-2D.2 lesson, where a static inventory
-- missed artists.signature_card_id.
--
-- Expected: zero rows.

-- ⚠ INSPECTS pg_get_functiondef, NOT ONLY prosrc.
--
--   p.prosrc holds only the function BODY. It misses anything outside it — most
--   importantly a SQL-standard function whose body lives in prosqlbody rather
--   than prosrc (PostgreSQL 14+ `BEGIN ATOMIC`), where prosrc can be empty.
--   pg_get_functiondef reconstructs the COMPLETE definition — signature,
--   SET clauses, SECURITY attribute and body — so a reader hiding in any of
--   those is still found.
--
--   Both are checked and reported separately, so a hit found by one and not the
--   other is visible rather than averaged away.
--
--   pg_get_functiondef raises on aggregate and window functions, so prokind is
--   restricted to ordinary functions ('f') and procedures ('p'). Aggregates
--   cannot contain a table reference of the kind being hunted here.
--
--   Read-only: pg_get_functiondef is a catalog-formatting function and mutates
--   nothing.

select
  'P-5 routines reading card_extras'                                as check_id,
  n.nspname                                                         as schema_name,
  p.proname                                                         as routine_name,
  p.prokind                                                         as kind,
  p.prosecdef                                                       as is_security_definer,
  pg_get_function_identity_arguments(p.oid)                         as args,
  (p.prosrc ilike '%card_extras%')                                  as found_in_prosrc,
  (pg_get_functiondef(p.oid) ilike '%card_extras%')                 as found_in_functiondef
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname not in ('pg_catalog', 'information_schema')
  and p.prokind in ('f', 'p')
  and (
        p.prosrc ilike '%card_extras%'
     or pg_get_functiondef(p.oid) ilike '%card_extras%'
      )
  -- The CAT-3B admission trigger itself will match after deployment; before
  -- deployment it does not exist, so any hit here is a pre-existing reader.
  and p.proname <> 'card_extras_admit_image_override'
  and p.proname <> 'set_card_extras_updated_at'
order by n.nspname, p.proname;


-- ═══════════════════════════════════════════════════════════════════════════
-- P-5b — does any OTHER view read card_extras?
-- ═══════════════════════════════════════════════════════════════════════════
-- Same question for views. cards_effective is the expected and only hit.

select
  'P-5b views reading card_extras'                                  as check_id,
  n.nspname                                                         as schema_name,
  c.relname                                                         as view_name,
  'security_invoker=true' = any(coalesce(c.reloptions, '{}'))       as security_invoker_on
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('v', 'm')
  and n.nspname not in ('pg_catalog', 'information_schema')
  and pg_get_viewdef(c.oid) ilike '%card_extras%'
order by n.nspname, c.relname;


-- ═══════════════════════════════════════════════════════════════════════════
-- P-6 — current card_extras columns
-- ═══════════════════════════════════════════════════════════════════════════
-- Live-schema discovery rather than trusting the repository's belief about the
-- table — the CAT-2D.2 engineering rule.
--
-- Expected BEFORE the migration: exactly 5 columns — card_id,
-- illustrator_override, source_note, created_at, updated_at — and none of the
-- five CAT-3B columns present.

select
  'P-6 columns'                                                     as check_id,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'card_extras')   as column_count,
  (select string_agg(column_name, ',' order by ordinal_position)
     from information_schema.columns
    where table_schema = 'public' and table_name = 'card_extras')   as column_list,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'card_extras'
      and column_name in ('image_url_override','image_override_source_card_id',
                          'image_override_evidence','image_override_approved_by',
                          'image_override_approved_at'))            as cat3b_columns_present,
  (select count(*) from public.card_extras)                         as row_count;
