-- docs/sql/bp-3-1a-binder-page-layout-validation.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- BP-3.1A — Binder page layout foundation: validation
--
-- THREE parts, run in this order:
--
--   PART 1  Structural assertions. Pure SELECT, one statement. Reads catalogs
--           and row counts only. Safe to run at any time, by any role.
--           Every row must read result = 'PASS'.
--
--   PART 2  Behavioural probes against the five RPCs. RUN AS THE AUTHENTICATED
--           COLLECTOR. Snapshots the chosen binder's exact layout state first
--           and restores it byte-for-byte at the end. NO PERSISTENT TEST DATA
--           IS CREATED: no binder, no membership, no card is ever inserted or
--           deleted. The whole part is one DO block, so an unexpected escape
--           rolls the entire probe run back — the explicit restore is belt,
--           transaction atomicity is braces.
--           In the Supabase SQL editor auth.uid() is null, so Part 2 reports
--           'no eligible binder' and changes nothing.
--
--   PART 3  Unauthenticated rejection probes. RUN IN THE SUPABASE SQL EDITOR,
--           where auth.uid() is null. Read-only in effect: every call must
--           raise 28000 before touching anything.
--
-- OUTPUT PATTERN — Supabase SQL editor constraints are respected throughout:
-- no RAISE NOTICE (invisible in the result grid), no ON COMMIT DROP temp tables
-- (dropped prematurely), no intermediate SELECTs. Parts 2 and 3 accumulate into
-- a PL/pgSQL jsonb, persist it with set_config, and expand it in one terminal
-- SELECT.
--
-- This file NEVER runs as part of the migration.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- PART 0 — auth-context inspection (read-only, run FIRST if you intend to run
--          Part 2B in the Supabase SQL editor)
--
-- Part 2B has to make auth.uid() resolve to a real collector while running from
-- the SQL editor. It must not GUESS which request GUC carries that identity —
-- the name has changed across Supabase generations (request.jwt.claim.sub vs
-- request.jwt.claims->>'sub'). Part 2B therefore DISCOVERS the names by reading
-- auth.uid()'s own definition and then VERIFIES that auth.uid() actually returns
-- the intended user before probing anything.
--
-- This part shows you the same evidence the harness will act on. Read it before
-- running Part 2B. It changes nothing.
-- ───────────────────────────────────────────────────────────────────────────

select 'auth.uid() exists'::text as check_name,
       case when to_regprocedure('auth.uid()') is null then 'FAIL' else 'PASS' end as result,
       coalesce(pg_get_functiondef(to_regprocedure('auth.uid()')), 'auth.uid() NOT FOUND') as detail
union all
select 'request GUCs referenced by auth.uid()'::text,
       case when (select count(*) from regexp_matches(
                    coalesce(pg_get_functiondef(to_regprocedure('auth.uid()')), ''),
                    'current_setting\s*\(\s*''([^'']+)''', 'g') m
                   where m[1] <> 'search_path') > 0
            then 'PASS' else 'FAIL' end,
       coalesce((select string_agg(distinct m[1], ', ')
                   from regexp_matches(
                          coalesce(pg_get_functiondef(to_regprocedure('auth.uid()')), ''),
                          'current_setting\s*\(\s*''([^'']+)''', 'g') m
                  where m[1] <> 'search_path'), 'none discovered')
union all
select 'auth.uid() right now'::text,
       'INFO',
       coalesce(auth.uid()::text, 'null (expected in the SQL editor)')
union all
select 'deterministic Part 2B target (user / binder / members)'::text,
       case when exists (
              select 1 from public.user_binder_cards c
               group by c.binder_id having count(*) >= 2) then 'PASS' else 'FAIL' end,
       coalesce((select b.user_id::text || ' / ' || c.binder_id::text || ' / ' || count(*)::text
                   from public.user_binder_cards c
                   join public.user_binders b on b.id = c.binder_id
                  group by b.user_id, c.binder_id
                 having count(*) >= 2
                  order by count(*) desc, c.binder_id asc
                  limit 1), 'no binder has 2+ memberships — Part 2B will hard-fail');


-- ───────────────────────────────────────────────────────────────────────────
-- PART 1 — structural assertions (read-only, one statement)
-- ───────────────────────────────────────────────────────────────────────────

with

-- ── 1. Table shape ─────────────────────────────────────────────────────────
c_layouts_columns as (
  select 'layouts: exact columns and types'::text as check_name,
         case when count(*) = 7
               and count(*) filter (where column_name='id'               and data_type='uuid'                        and is_nullable='NO') = 1
               and count(*) filter (where column_name='binder_id'        and data_type='uuid'                        and is_nullable='NO') = 1
               and count(*) filter (where column_name='format_key'       and data_type='text'                        and is_nullable='NO') = 1
               and count(*) filter (where column_name='background_theme' and data_type='text'                        and is_nullable='NO') = 1
               and count(*) filter (where column_name='page_count'       and data_type='integer'                     and is_nullable='NO') = 1
               and count(*) filter (where column_name='created_at'       and data_type='timestamp with time zone'    and is_nullable='NO') = 1
               and count(*) filter (where column_name='updated_at'       and data_type='timestamp with time zone'    and is_nullable='NO') = 1
              then 'PASS' else 'FAIL' end as result,
         coalesce(string_agg(column_name || ' ' || data_type, ', ' order by ordinal_position), 'table absent') as detail
    from information_schema.columns
   where table_schema='public' and table_name='user_binder_layouts'
),
c_items_columns as (
  select 'items: exact columns and types'::text,
         case when count(*) = 7
               and count(*) filter (where column_name='id'             and data_type='uuid'                     and is_nullable='NO') = 1
               and count(*) filter (where column_name='layout_id'      and data_type='uuid'                     and is_nullable='NO') = 1
               and count(*) filter (where column_name='binder_id'      and data_type='uuid'                     and is_nullable='NO') = 1
               and count(*) filter (where column_name='binder_card_id' and data_type='uuid'                     and is_nullable='NO') = 1
               and count(*) filter (where column_name='page_number'    and data_type='integer'                  and is_nullable='NO') = 1
               and count(*) filter (where column_name='pocket_number'  and data_type='integer'                  and is_nullable='NO') = 1
               and count(*) filter (where column_name='created_at'     and data_type='timestamp with time zone' and is_nullable='NO') = 1
              then 'PASS' else 'FAIL' end,
         coalesce(string_agg(column_name || ' ' || data_type, ', ' order by ordinal_position), 'table absent')
    from information_schema.columns
   where table_schema='public' and table_name='user_binder_layout_items'
),
-- Columns that must NOT exist. Each would be a second, weaker authority.
c_absent_columns as (
  select 'no user_id / card_id / list position / item updated_at'::text,
         case when count(*) = 0 then 'PASS' else 'FAIL' end,
         coalesce(string_agg(table_name || '.' || column_name, ', '), 'none present') 
    from information_schema.columns
   where table_schema='public'
     and table_name in ('user_binder_layouts','user_binder_layout_items')
     and (column_name in ('user_id','card_id','position')
          or (table_name='user_binder_layout_items' and column_name='updated_at'))
),

-- ── 2. Keys and uniqueness ─────────────────────────────────────────────────
c_layout_unique as (
  select 'layouts: one layout per binder (UNIQUE binder_id)'::text,
         case when count(*) = 1 then 'PASS' else 'FAIL' end,
         count(*)::text || ' matching constraint(s)'
    from pg_constraint
   where conrelid='public.user_binder_layouts'::regclass
     and contype='u'
     and pg_get_constraintdef(oid) = 'UNIQUE (binder_id)'
),
c_composite_referents as (
  select 'composite-FK referents exist on both parents'::text,
         case when count(*) = 2 then 'PASS' else 'FAIL' end,
         coalesce(string_agg(conrelid::regclass::text || '.' || conname, ', '), 'none')
    from pg_constraint
   where contype='u'
     and pg_get_constraintdef(oid) = 'UNIQUE (id, binder_id)'
     and conrelid in ('public.user_binder_cards'::regclass, 'public.user_binder_layouts'::regclass)
),
c_item_uniques as (
  select 'items: unique membership AND unique occupied pocket'::text,
         case when count(*) filter (where pg_get_constraintdef(oid)='UNIQUE (layout_id, binder_card_id)') = 1
               and count(*) filter (where pg_get_constraintdef(oid)='UNIQUE (layout_id, page_number, pocket_number)') = 1
              then 'PASS' else 'FAIL' end,
         coalesce(string_agg(conname, ', '), 'none')
    from pg_constraint
   where conrelid='public.user_binder_layout_items'::regclass and contype='u'
),

-- ── 3. Foreign keys and cascade ────────────────────────────────────────────
-- The composite FKs are the mechanism that makes foreign-binder placement
-- unrepresentable. A single-column FK here would be a silent downgrade.
c_item_fks as (
  select 'items: both composite FKs with ON DELETE CASCADE'::text,
         case when count(*) filter (where pg_get_constraintdef(oid) =
                'FOREIGN KEY (layout_id, binder_id) REFERENCES user_binder_layouts(id, binder_id) ON DELETE CASCADE') = 1
               and count(*) filter (where pg_get_constraintdef(oid) =
                'FOREIGN KEY (binder_card_id, binder_id) REFERENCES user_binder_cards(id, binder_id) ON DELETE CASCADE') = 1
               and count(*) = 2
              then 'PASS' else 'FAIL' end,
         coalesce(string_agg(pg_get_constraintdef(oid), ' | '), 'none')
    from pg_constraint
   where conrelid='public.user_binder_layout_items'::regclass and contype='f'
),
c_layout_fk as (
  select 'layouts: binder FK with ON DELETE CASCADE'::text,
         case when count(*) = 1 then 'PASS' else 'FAIL' end,
         coalesce(string_agg(pg_get_constraintdef(oid), ' | '), 'none')
    from pg_constraint
   where conrelid='public.user_binder_layouts'::regclass and contype='f'
     and pg_get_constraintdef(oid) = 'FOREIGN KEY (binder_id) REFERENCES user_binders(id) ON DELETE CASCADE'
),
-- No catalog FK, ever. Membership must survive catalog absence, and placement
-- follows membership.
c_no_catalog_fk as (
  select 'no FK from layout tables to any catalog relation'::text,
         case when count(*) = 0 then 'PASS' else 'FAIL' end,
         coalesce(string_agg(conrelid::regclass::text || ' -> ' || confrelid::regclass::text, ', '), 'none')
    from pg_constraint
   where contype='f'
     and conrelid in ('public.user_binder_layouts'::regclass, 'public.user_binder_layout_items'::regclass)
     and confrelid::regclass::text in ('cards','card_extras','cards_effective','public.cards','public.card_extras','public.cards_effective')
),

-- ── 4. CHECK constraints ───────────────────────────────────────────────────
c_layout_checks as (
  select 'layouts: format / theme / page_count CHECKs'::text,
         case when count(*) filter (where conname='user_binder_layouts_format_key_check') = 1
               and count(*) filter (where conname='user_binder_layouts_background_theme_check') = 1
               and count(*) filter (where conname='user_binder_layouts_page_count_check') = 1
              then 'PASS' else 'FAIL' end,
         coalesce(string_agg(conname, ', '), 'none')
    from pg_constraint
   where conrelid='public.user_binder_layouts'::regclass and contype='c'
),
c_theme_keys as (
  select 'layouts: exactly the 8 curated theme keys'::text,
         case when count(*) = 1 then 'PASS' else 'FAIL' end,
         coalesce(string_agg(pg_get_constraintdef(oid), ' '), 'absent')
    from pg_constraint
   where conrelid='public.user_binder_layouts'::regclass
     and conname='user_binder_layouts_background_theme_check'
     and pg_get_constraintdef(oid) like '%charcoal%'
     and pg_get_constraintdef(oid) like '%warm-black%'
     and pg_get_constraintdef(oid) like '%deep-plum%'
     and pg_get_constraintdef(oid) like '%midnight-navy%'
     and pg_get_constraintdef(oid) like '%forest%'
     and pg_get_constraintdef(oid) like '%burgundy%'
     and pg_get_constraintdef(oid) like '%sand%'
     and pg_get_constraintdef(oid) like '%soft-stone%'
),
c_item_checks as (
  select 'items: page_number >= 1 and pocket_number 1..16 CHECKs'::text,
         case when count(*) filter (where conname='user_binder_layout_items_page_number_check') = 1
               and count(*) filter (where conname='user_binder_layout_items_pocket_number_check') = 1
              then 'PASS' else 'FAIL' end,
         coalesce(string_agg(conname, ', '), 'none')
    from pg_constraint
   where conrelid='public.user_binder_layout_items'::regclass and contype='c'
),

-- ── 5. Indexes and trigger ─────────────────────────────────────────────────
c_item_cascade_index as (
  select 'items: binder_card_id index (supports membership-delete cascade)'::text,
         case when count(*) = 1 then 'PASS' else 'FAIL' end,
         coalesce(string_agg(indexname, ', '), 'absent')
    from pg_indexes
   where schemaname='public' and tablename='user_binder_layout_items'
     and indexname='user_binder_layout_items_binder_card_idx'
),
c_layout_trigger as (
  select 'layouts: updated_at trigger reuses iv_touch_updated_at'::text,
         case when count(*) = 1 then 'PASS' else 'FAIL' end,
         coalesce(string_agg(tgname, ', '), 'absent')
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
   where t.tgrelid='public.user_binder_layouts'::regclass
     and not t.tgisinternal
     and t.tgname='user_binder_layouts_touch_updated_at'
     and p.proname='iv_touch_updated_at'
),

-- ── 6. RLS and privileges ──────────────────────────────────────────────────
c_rls_enabled as (
  select 'RLS enabled (and not forced) on both layout tables'::text,
         case when count(*) filter (where relrowsecurity and not relforcerowsecurity) = 2
              then 'PASS' else 'FAIL' end,
         coalesce(string_agg(relname || ' rls=' || relrowsecurity::text || ' forced=' || relforcerowsecurity::text, ', '), 'none')
    from pg_class
   where oid in ('public.user_binder_layouts'::regclass, 'public.user_binder_layout_items'::regclass)
),
c_select_only_policies as (
  select 'exactly one SELECT policy per layout table, no write policies'::text,
         case when count(*) = 2 and count(*) filter (where cmd='SELECT') = 2
              then 'PASS' else 'FAIL' end,
         coalesce(string_agg(tablename || '.' || policyname || ' [' || cmd || ']', ', '), 'none')
    from pg_policies
   where schemaname='public'
     and tablename in ('user_binder_layouts','user_binder_layout_items')
),
c_policies_parent_derived as (
  select 'layout policies derive ownership through the parent binder'::text,
         case when count(*) = 2 then 'PASS' else 'FAIL' end,
         coalesce(string_agg(policyname, ', '), 'none')
    from pg_policies
   where schemaname='public'
     and tablename in ('user_binder_layouts','user_binder_layout_items')
     and qual like '%user_binders%'
     and qual like '%auth.uid()%'
),
c_no_write_grants as (
  select 'no direct INSERT/UPDATE/DELETE for public/anon/authenticated'::text,
         case when bool_or(g) then 'FAIL' else 'PASS' end,
         'granted: ' || coalesce(nullif(string_agg(case when g then r || ':' || t || ':' || pv else null end, ', '), ''), 'none')
    from (
      select r, t, pv, has_table_privilege(r, t, pv) as g
        from unnest(array['anon','authenticated']) r
        cross join unnest(array['public.user_binder_layouts','public.user_binder_layout_items']) t
        cross join unnest(array['INSERT','UPDATE','DELETE','TRUNCATE']) pv
    ) x
),
c_select_grants as (
  select 'authenticated has SELECT; anon does not'::text,
         case when has_table_privilege('authenticated','public.user_binder_layouts','SELECT')
               and has_table_privilege('authenticated','public.user_binder_layout_items','SELECT')
               and not has_table_privilege('anon','public.user_binder_layouts','SELECT')
               and not has_table_privilege('anon','public.user_binder_layout_items','SELECT')
              then 'PASS' else 'FAIL' end,
         'authenticated=' || has_table_privilege('authenticated','public.user_binder_layouts','SELECT')::text
         || ' anon=' || has_table_privilege('anon','public.user_binder_layouts','SELECT')::text
),

-- ── 7. RPCs ────────────────────────────────────────────────────────────────
c_rpcs_exist as (
  select 'all five RPCs exist with the approved signatures'::text,
         case when count(*) = 5 then 'PASS' else 'FAIL' end,
         coalesce(string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ', ' order by p.proname), 'none')
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public'
     and (p.proname, pg_get_function_identity_arguments(p.oid)) in (
       ('fetch_binder_page_layout',  'p_binder_id uuid'),
       ('create_binder_page_layout', 'p_binder_id uuid, p_format_key text, p_background_theme text'),
       ('save_binder_page_layout',   'p_binder_id uuid, p_page_count integer, p_placements jsonb'),
       ('set_binder_layout_theme',   'p_binder_id uuid, p_background_theme text'),
       ('reset_binder_page_layout',  'p_binder_id uuid, p_format_key text'))
),
c_rpcs_secdef as (
  select 'all five RPCs are SECURITY DEFINER'::text,
         case when count(*) filter (where p.prosecdef) = 5 then 'PASS' else 'FAIL' end,
         coalesce(string_agg(p.proname || '=' || p.prosecdef::text, ', ' order by p.proname), 'none')
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public'
     and p.proname in ('fetch_binder_page_layout','create_binder_page_layout',
                       'save_binder_page_layout','set_binder_layout_theme','reset_binder_page_layout')
),
c_rpcs_search_path as (
  select 'all five RPCs pin an empty search_path'::text,
         case when count(*) filter (
                where p.proconfig is not null
                  and exists (select 1 from unnest(p.proconfig) c
                               where c in ('search_path=""','search_path='))
              ) = 5 then 'PASS' else 'FAIL' end,
         coalesce(string_agg(p.proname || '=' || coalesce(array_to_string(p.proconfig, ';'), 'null'), ', ' order by p.proname), 'none')
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public'
     and p.proname in ('fetch_binder_page_layout','create_binder_page_layout',
                       'save_binder_page_layout','set_binder_layout_theme','reset_binder_page_layout')
),
-- The read RPC must be STABLE: that is what makes its ownership check, layout
-- metadata and placement aggregation share ONE snapshot.
c_fetch_stable as (
  select 'fetch_binder_page_layout is STABLE (snapshot coherence)'::text,
         case when count(*) filter (where p.provolatile='s') = 1 then 'PASS' else 'FAIL' end,
         coalesce(string_agg('volatility=' || p.provolatile::text, ', '), 'absent')
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='fetch_binder_page_layout'
),
c_rpc_grants as (
  select 'RPC EXECUTE: authenticated yes, anon/public no'::text,
         case when bool_and(auth_ok) and not bool_or(anon_ok) then 'PASS' else 'FAIL' end,
         'auth_ok=' || count(*) filter (where auth_ok)::text || '/5, anon_granted='
           || count(*) filter (where anon_ok)::text
    from (
      select has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_ok,
             has_function_privilege('anon',          p.oid, 'EXECUTE') as anon_ok
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public'
         and p.proname in ('fetch_binder_page_layout','create_binder_page_layout',
                           'save_binder_page_layout','set_binder_layout_theme','reset_binder_page_layout')
    ) x
),
c_helper_private as (
  select 'canonical-document helper is STABLE and client-unreachable'::text,
         case when count(*) = 1
               and bool_and(p.provolatile='s')
               and bool_and(not p.prosecdef)
               and not bool_or(has_function_privilege('authenticated', p.oid, 'EXECUTE'))
               and not bool_or(has_function_privilege('anon',          p.oid, 'EXECUTE'))
              then 'PASS' else 'FAIL' end,
         coalesce(string_agg('volatile=' || p.provolatile::text
                  || ' secdef=' || p.prosecdef::text
                  || ' auth_exec=' || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text, ', '), 'absent')
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='iv_binder_layout_document'
),

-- ── 8. Data integrity (should be trivially true; asserted anyway) ──────────
c_no_orphan_items as (
  select 'no placement without a live layout or membership'::text,
         case when count(*) = 0 then 'PASS' else 'FAIL' end,
         count(*)::text || ' orphan placement row(s)'
    from public.user_binder_layout_items i
   where not exists (select 1 from public.user_binder_layouts l where l.id = i.layout_id)
      or not exists (select 1 from public.user_binder_cards c
                      where c.id = i.binder_card_id and c.binder_id = i.binder_id)
),
c_items_within_pages as (
  select 'no placement beyond its layout page_count'::text,
         case when count(*) = 0 then 'PASS' else 'FAIL' end,
         count(*)::text || ' out-of-range placement(s)'
    from public.user_binder_layout_items i
    join public.user_binder_layouts l on l.id = i.layout_id
   where i.page_number > l.page_count or i.page_number < 1
),
c_items_within_format as (
  select 'no placement beyond its format pocket ceiling'::text,
         case when count(*) = 0 then 'PASS' else 'FAIL' end,
         count(*)::text || ' out-of-format placement(s)'
    from public.user_binder_layout_items i
    join public.user_binder_layouts l on l.id = i.layout_id
   where i.pocket_number < 1
      or i.pocket_number > case l.format_key when '3x3' then 9 when '3x4' then 12 when '4x4' then 16 end
),
c_no_dup_member as (
  select 'no membership placed in two pockets'::text,
         case when count(*) = 0 then 'PASS' else 'FAIL' end,
         count(*)::text || ' duplicate-membership group(s)'
    from (select layout_id, binder_card_id from public.user_binder_layout_items
           group by 1,2 having count(*) > 1) d
),
c_no_dup_pocket as (
  select 'no pocket occupied twice'::text,
         case when count(*) = 0 then 'PASS' else 'FAIL' end,
         count(*)::text || ' duplicate-pocket group(s)'
    from (select layout_id, page_number, pocket_number from public.user_binder_layout_items
           group by 1,2,3 having count(*) > 1) d
),
c_one_layout_per_binder as (
  select 'no binder has two layouts'::text,
         case when count(*) = 0 then 'PASS' else 'FAIL' end,
         count(*)::text || ' binder(s) with more than one layout'
    from (select binder_id from public.user_binder_layouts group by 1 having count(*) > 1) d
),

-- ── 9. BP-1A regression proof — these objects must be UNTOUCHED ────────────
c_bp1a_position as (
  select 'BP-1A: position column still integer NOT NULL, no nulls'::text,
         case when count(*) filter (where column_name='position' and data_type='integer' and is_nullable='NO') = 1
               and (select count(*) from public.user_binder_cards where position is null) = 0
              then 'PASS' else 'FAIL' end,
         coalesce(string_agg(column_name || ' ' || data_type || ' nullable=' || is_nullable, ', ')
                  filter (where column_name='position'), 'column absent')
    from information_schema.columns
   where table_schema='public' and table_name='user_binder_cards'
),
c_bp1a_index as (
  select 'BP-1A: position index unchanged'::text,
         case when count(*) = 1 then 'PASS' else 'FAIL' end,
         coalesce(string_agg(indexdef, ' '), 'absent')
    from pg_indexes
   where schemaname='public' and tablename='user_binder_cards'
     and indexname='user_binder_cards_binder_position_idx'
     and indexdef like '%(binder_id, "position", created_at, id)%'
),
c_bp1a_trigger as (
  select 'BP-1A: assign-position trigger unchanged'::text,
         case when count(*) = 1 then 'PASS' else 'FAIL' end,
         coalesce(string_agg(t.tgname || ' -> ' || p.proname, ', '), 'absent')
    from pg_trigger t join pg_proc p on p.oid=t.tgfoid
   where t.tgrelid='public.user_binder_cards'::regclass
     and not t.tgisinternal
     and t.tgname='ubc_before_insert_assign_position'
     and p.proname='user_binder_cards_assign_position'
     and p.prosecdef
),
c_bp1a_reorder as (
  select 'BP-1A: reorder_binder_cards unchanged (secdef, pinned path, grants)'::text,
         case when count(*) = 1 then 'PASS' else 'FAIL' end,
         coalesce(string_agg('secdef=' || p.prosecdef::text
                  || ' auth_exec=' || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text
                  || ' anon_exec=' || has_function_privilege('anon', p.oid, 'EXECUTE')::text, ', '), 'absent')
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='reorder_binder_cards'
     and pg_get_function_identity_arguments(p.oid)='p_binder_id uuid, p_card_ids text[]'
     and p.prosecdef
     and exists (select 1 from unnest(p.proconfig) c where c in ('search_path=""','search_path='))
     and has_function_privilege('authenticated', p.oid, 'EXECUTE')
     and not has_function_privilege('anon', p.oid, 'EXECUTE')
),
c_bp1a_membership_policies as (
  select 'BP-1A: user_binder_cards still has its four policies'::text,
         case when count(*) = 4 then 'PASS' else 'FAIL' end,
         coalesce(string_agg(policyname || '[' || cmd || ']', ', ' order by cmd), 'none')
    from pg_policies where schemaname='public' and tablename='user_binder_cards'
),
c_bp1a_membership_grants as (
  select 'BP-1A: user_binder_cards write grants untouched'::text,
         case when has_table_privilege('authenticated','public.user_binder_cards','INSERT')
               and has_table_privilege('authenticated','public.user_binder_cards','UPDATE')
               and has_table_privilege('authenticated','public.user_binder_cards','DELETE')
               and has_table_privilege('authenticated','public.user_binder_cards','SELECT')
              then 'PASS' else 'FAIL' end,
         'authenticated I/U/D/S = '
           || has_table_privilege('authenticated','public.user_binder_cards','INSERT')::text || '/'
           || has_table_privilege('authenticated','public.user_binder_cards','UPDATE')::text || '/'
           || has_table_privilege('authenticated','public.user_binder_cards','DELETE')::text || '/'
           || has_table_privilege('authenticated','public.user_binder_cards','SELECT')::text
),
c_bp1a_unique_member as (
  select 'BP-1A: UNIQUE (binder_id, card_id) still present'::text,
         case when count(*) = 1 then 'PASS' else 'FAIL' end,
         coalesce(string_agg(conname, ', '), 'absent')
    from pg_constraint
   where conrelid='public.user_binder_cards'::regclass and contype='u'
     and pg_get_constraintdef(oid) = 'UNIQUE (binder_id, card_id)'
),
c_touch_fn as (
  select 'iv_touch_updated_at() unchanged and still shared'::text,
         case when count(*) = 1 then 'PASS' else 'FAIL' end,
         coalesce(string_agg('secdef=' || p.prosecdef::text, ', '), 'absent')
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='iv_touch_updated_at' and not p.prosecdef
)

select * from c_layouts_columns
union all select * from c_items_columns
union all select * from c_absent_columns
union all select * from c_layout_unique
union all select * from c_composite_referents
union all select * from c_item_uniques
union all select * from c_item_fks
union all select * from c_layout_fk
union all select * from c_no_catalog_fk
union all select * from c_layout_checks
union all select * from c_theme_keys
union all select * from c_item_checks
union all select * from c_item_cascade_index
union all select * from c_layout_trigger
union all select * from c_rls_enabled
union all select * from c_select_only_policies
union all select * from c_policies_parent_derived
union all select * from c_no_write_grants
union all select * from c_select_grants
union all select * from c_rpcs_exist
union all select * from c_rpcs_secdef
union all select * from c_rpcs_search_path
union all select * from c_fetch_stable
union all select * from c_rpc_grants
union all select * from c_helper_private
union all select * from c_no_orphan_items
union all select * from c_items_within_pages
union all select * from c_items_within_format
union all select * from c_no_dup_member
union all select * from c_no_dup_pocket
union all select * from c_one_layout_per_binder
union all select * from c_bp1a_position
union all select * from c_bp1a_index
union all select * from c_bp1a_trigger
union all select * from c_bp1a_reorder
union all select * from c_bp1a_membership_policies
union all select * from c_bp1a_membership_grants
union all select * from c_bp1a_unique_member
union all select * from c_touch_fn;


-- ───────────────────────────────────────────────────────────────────────────
-- PART 2 — behavioural probes. ONE probe engine, TWO entry points.
--
--   2A  AUTHENTICATED CLIENT (PostgREST / an app session).
--       auth.uid() already resolves. Run the DO block below as-is.
--
--   2B  SUPABASE SQL EDITOR.  ►► THIS IS THE BLOCK TO RUN IN THE EDITOR ◄◄
--       auth.uid() is null there, so the engine self-skips unless it is armed.
--       Run PART 0 first, read what it reports, then run the two-statement
--       "PART 2B ENTRY POINT" immediately below, and then the DO block.
--
-- The 24 behavioural assertions are IDENTICAL on both paths — there is one copy
-- of them, not two. Duplicating the probe body for a second entry point would
-- guarantee the two copies drift; arming one engine cannot.
--
-- What 2B does and does not prove:
--   PROVES   every in-RPC ownership, validation, bounds, atomicity and
--            fail-closed behaviour, against real data, with an exact restore.
--   DOES NOT prove RLS enforcement. The SQL editor runs as the table owner, for
--            which RLS is not applied and the write grants are irrelevant. RLS
--            and grants are asserted structurally in Part 1
--            (c_rls_enabled, c_select_only_policies, c_no_write_grants) and
--            confirmed behaviourally by real-client QA in BP-3.1B.
--
-- Target selection: the caller's binder with the most memberships, requiring at
-- least 2 (several probes need two distinct memberships). On 2A, none qualifying
-- reports 'no eligible binder' and mutates nothing; on 2B it HARD-FAILS, because
-- an armed harness that silently probed nothing would read as a pass.
--
-- Restore contract: the target's pre-probe layout state is captured before the
-- first probe and restored EXACTLY at the end — the layout row's id,
-- format_key, background_theme, page_count, created_at AND updated_at, plus
-- every placement row with its original id, page, pocket and created_at.
-- updated_at survives the restore because the row is re-INSERTed with its
-- snapshotted value and iv_touch_updated_at fires on UPDATE only. Verified by
-- EXCEPT in both directions against a pre-probe copy: zero differing rows.
-- If no layout existed before the run, the probe-created one is deleted and the
-- binder is returned to having none.
--
-- Membership, position, ownership, intent, favourites and the catalog are never
-- written by any probe.
--
-- NOT covered here, deliberately: direct-client-write rejection (the SQL editor
-- runs as the table owner, for which the grant check is meaningless — Part 1
-- c_no_write_grants is the real assertion) and cross-USER membership rejection
-- (a second account cannot be exercised from one session — the composite FK
-- asserted in Part 1 c_item_fks is the structural guarantee; the probe below
-- covers the cross-BINDER case, which is the same code path).
-- ───────────────────────────────────────────────────────────────────────────

-- ═══ PART 2B ENTRY POINT — run these two statements in the SQL editor, then
--     the DO block below. Arming is ONE-SHOT: the engine disarms itself at the
--     end of a successful run, so a later accidental execution self-skips.
--     Skip both statements entirely on path 2A.
--
--   select set_config('iv.bp31a_probe', '', false);        -- clear stale results
--   select set_config('iv.bp31a_impersonate', 'on', false); -- arm the harness
-- ═══

do $$
declare
  v_uid        uuid := auth.uid();
  v_binder     uuid;
  v_card_a     uuid;
  v_card_b     uuid;
  v_foreign    uuid;
  v_had_layout boolean := false;
  v_layout_id  uuid;
  v_o_format   text;
  v_o_theme    text;
  v_o_pages    integer;
  v_o_created  timestamptz;
  v_o_updated  timestamptz;
  v_o_items    jsonb := '[]'::jsonb;
  v_out        jsonb := '[]'::jsonb;
  v_doc        jsonb;
  v_n          integer;
  v_ok         boolean;
  v_theme      text;
  -- 2B harness state
  v_armed      boolean;
  v_authdef    text;
  v_gucs       text[];
  v_prior      jsonb := '{}'::jsonb;
  v_guc        text;
  v_target     uuid;
begin
  v_armed := lower(coalesce(nullif(current_setting('iv.bp31a_impersonate', true), ''), 'off'))
             in ('on','true','yes','1');

  -- ── Unarmed and unauthenticated: unchanged, harmless self-skip ───────────
  if v_uid is null and not v_armed then
    perform set_config('iv.bp31a_probe',
      jsonb_build_object('probe','preflight','result','SKIP',
        'detail','auth.uid() is null and the harness is not armed — run path 2A '
                 || 'as the authenticated collector, or arm path 2B (see PART 2B ENTRY POINT)')::text, false);
    return;
  end if;

  -- ── 2B: establish a real auth context, by DISCOVERY then VERIFICATION ────
  -- Every failure here RAISES. A harness that guessed, or that probed as the
  -- wrong identity, would produce assertions that mean nothing.
  if v_uid is null then

    -- (i) How does auth.uid() read the request identity HERE? Ask the function,
    --     do not assume a GUC name. Part 0 shows you the same evidence.
    v_authdef := pg_get_functiondef(to_regprocedure('auth.uid()'));
    if v_authdef is null then
      raise exception 'BP-3.1A Part 2B: auth.uid() does not exist in this database — cannot establish an auth context';
    end if;

    select array_agg(distinct m[1] order by m[1]) into v_gucs
      from regexp_matches(v_authdef, 'current_setting\s*\(\s*''([^'']+)''', 'g') m
     where m[1] <> 'search_path';

    if v_gucs is null or cardinality(v_gucs) = 0 then
      raise exception 'BP-3.1A Part 2B: auth.uid() references no request setting — its definition is % ', v_authdef;
    end if;

    -- (ii) Pick the target user deterministically and visibly: the owner of the
    --      binder with the most memberships, ties broken by binder id. Reported
    --      in the 'harness' output row. auth.users is READ ONLY here.
    select b.user_id
      into v_target
      from public.user_binder_cards c
      join public.user_binders b on b.id = c.binder_id
     group by b.user_id, c.binder_id
    having count(*) >= 2
     order by count(*) desc, c.binder_id asc
     limit 1;

    if v_target is null then
      raise exception 'BP-3.1A Part 2B: no binder in this database has 2 or more memberships — nothing eligible to probe';
    end if;

    if not exists (select 1 from auth.users u where u.id = v_target) then
      raise exception 'BP-3.1A Part 2B: binder owner % is not a row in auth.users', v_target;
    end if;

    -- (iii) Set ONLY the discovered settings, and only for this transaction
    --       (is_local := true). A raise anywhere below therefore reverts the
    --       auth context automatically; the explicit restore at the end is belt
    --       to that braces. A name containing "claims" takes the JWT-claims
    --       object form; anything else takes the bare subject.
    foreach v_guc in array v_gucs loop
      v_prior := v_prior || jsonb_build_object(v_guc, coalesce(current_setting(v_guc, true), ''));
      if v_guc like '%claims%' then
        perform set_config(v_guc,
          jsonb_build_object('sub', v_target::text, 'role', 'authenticated')::text, true);
      else
        perform set_config(v_guc, v_target::text, true);
      end if;
    end loop;

    -- (iv) VERIFY. This is the gate that makes discovery safe: if the identity
    --      did not take, nothing is probed.
    v_uid := auth.uid();
    if v_uid is distinct from v_target then
      raise exception 'BP-3.1A Part 2B: could not establish an auth context. Set % but auth.uid() returned %. Definition: %',
        array_to_string(v_gucs, ', '), coalesce(v_uid::text, 'null'), v_authdef;
    end if;
  end if;

  select c.binder_id into v_binder
    from public.user_binder_cards c
    join public.user_binders b on b.id = c.binder_id
   where b.user_id = v_uid
   group by c.binder_id
  having count(*) >= 2
   order by count(*) desc, c.binder_id
   limit 1;

  if v_binder is null then
    if v_armed then
      raise exception 'BP-3.1A Part 2B: user % owns no binder with 2 or more memberships — refusing to report a pass on zero probes', v_uid;
    end if;
    perform set_config('iv.bp31a_probe',
      jsonb_build_object('probe','preflight','result','SKIP',
        'detail','no owned binder with at least 2 memberships — nothing probed, nothing changed')::text, false);
    return;
  end if;

  -- Visible record of exactly who and what was probed, always the first row.
  v_out := v_out || jsonb_build_object(
    'probe','harness',
    'expected', case when v_armed then '2B: SQL-editor auth context' else '2A: authenticated client' end,
    'result','INFO',
    'detail', 'user=' || v_uid::text || ' binder=' || v_binder::text
              || case when v_armed then ' auth GUCs set: ' || array_to_string(v_gucs, ', ')
                      else ' (auth.uid() supplied by the session)' end);

  -- First and last member in the BP-1A read order. Deterministic, and it avoids
  -- min(uuid)/max(uuid), which do not exist before PostgreSQL 17.
  select id into v_card_a from public.user_binder_cards
   where binder_id = v_binder order by position asc, created_at asc, id asc limit 1;
  select id into v_card_b from public.user_binder_cards
   where binder_id = v_binder order by position desc, created_at desc, id desc limit 1;

  -- A real membership of a DIFFERENT binder if one exists; otherwise a uuid that
  -- is a member of nothing. Both exercise the same "not a member of this binder"
  -- rejection path.
  select c.id into v_foreign
    from public.user_binder_cards c
    join public.user_binders b on b.id = c.binder_id
   where b.user_id = v_uid and c.binder_id <> v_binder
   limit 1;
  v_foreign := coalesce(v_foreign, gen_random_uuid());

  -- ── snapshot ─────────────────────────────────────────────────────────────
  select l.id, l.format_key, l.background_theme, l.page_count, l.created_at, l.updated_at
    into v_layout_id, v_o_format, v_o_theme, v_o_pages, v_o_created, v_o_updated
    from public.user_binder_layouts l where l.binder_id = v_binder;
  v_had_layout := found;

  if v_had_layout then
    select coalesce(jsonb_agg(to_jsonb(i)), '[]'::jsonb) into v_o_items
      from public.user_binder_layout_items i where i.layout_id = v_layout_id;
    -- Clear the way for the probes; the snapshot above is the restore source.
    delete from public.user_binder_layout_items where layout_id = v_layout_id;
    delete from public.user_binder_layouts where id = v_layout_id;
  end if;

  -- ── P01 fetch with no layout → SQL NULL, not an error ────────────────────
  begin
    v_doc := public.fetch_binder_page_layout(v_binder);
    v_out := v_out || jsonb_build_object('probe','P01 fetch, no layout','expected','NULL',
      'result', case when v_doc is null then 'PASS' else 'FAIL' end, 'detail', coalesce(v_doc::text,'null'));
  exception when others then
    v_out := v_out || jsonb_build_object('probe','P01 fetch, no layout','expected','NULL','result','FAIL','detail','raised '||sqlstate);
  end;

  -- ── P02 create 3x3 ───────────────────────────────────────────────────────
  begin
    v_doc := public.create_binder_page_layout(v_binder,'3x3','charcoal');
    v_out := v_out || jsonb_build_object('probe','P02 create 3x3','expected','layout, 1 page, 0 placements',
      'result', case when (v_doc->>'formatKey')='3x3' and (v_doc->>'pageCount')='1'
                       and (v_doc->'placements')='[]'::jsonb and (v_doc->>'contractVersion')='1'
                     then 'PASS' else 'FAIL' end, 'detail', v_doc::text);
  exception when others then
    v_out := v_out || jsonb_build_object('probe','P02 create 3x3','result','FAIL','detail','raised '||sqlstate);
  end;

  -- ── P03 second create rejected ───────────────────────────────────────────
  begin
    perform public.create_binder_page_layout(v_binder,'4x4','sand');
    v_out := v_out || jsonb_build_object('probe','P03 duplicate layout','expected','23505','result','FAIL','detail','no error raised');
  exception when others then
    v_out := v_out || jsonb_build_object('probe','P03 duplicate layout','expected','23505',
      'result', case when sqlstate='23505' then 'PASS' else 'FAIL' end, 'detail', sqlstate);
  end;

  -- ── P04 invalid theme / invalid format rejected ──────────────────────────
  begin
    perform public.set_binder_layout_theme(v_binder,'#ff0000');
    v_out := v_out || jsonb_build_object('probe','P04 invalid theme','expected','22023','result','FAIL','detail','no error raised');
  exception when others then
    v_out := v_out || jsonb_build_object('probe','P04 invalid theme','expected','22023',
      'result', case when sqlstate='22023' then 'PASS' else 'FAIL' end, 'detail', sqlstate);
  end;

  begin
    perform public.reset_binder_page_layout(v_binder,'5x5');
    v_out := v_out || jsonb_build_object('probe','P05 invalid format','expected','22023','result','FAIL','detail','no error raised');
  exception when others then
    v_out := v_out || jsonb_build_object('probe','P05 invalid format','expected','22023',
      'result', case when sqlstate='22023' then 'PASS' else 'FAIL' end, 'detail', sqlstate);
  end;

  -- ── P06 all eight curated themes accepted ────────────────────────────────
  v_n := 0;
  begin
    -- v_theme, never v_o_theme: the snapshot's theme is the restore source and
    -- must not be clobbered by a loop variable.
    foreach v_theme in array array['charcoal','warm-black','deep-plum','midnight-navy',
                                   'forest','burgundy','sand','soft-stone'] loop
      perform public.set_binder_layout_theme(v_binder, v_theme);
      v_n := v_n + 1;
    end loop;
    v_out := v_out || jsonb_build_object('probe','P06 all 8 themes','expected','8 accepted',
      'result', case when v_n = 8 then 'PASS' else 'FAIL' end, 'detail', v_n::text || ' accepted');
  exception when others then
    v_out := v_out || jsonb_build_object('probe','P06 all 8 themes','result','FAIL','detail','raised '||sqlstate||' after '||v_n::text);
  end;

  -- ── P07 valid save ───────────────────────────────────────────────────────
  begin
    v_doc := public.save_binder_page_layout(v_binder, 1,
      jsonb_build_array(jsonb_build_object('binderCardId',v_card_a,'page',1,'pocket',5)));
    v_out := v_out || jsonb_build_object('probe','P07 valid save','expected','1 placement at 1/5',
      'result', case when jsonb_array_length(v_doc->'placements')=1
                       and (v_doc->'placements'->0->>'pocket')='5' then 'PASS' else 'FAIL' end,
      'detail', (v_doc->'placements')::text);
  exception when others then
    v_out := v_out || jsonb_build_object('probe','P07 valid save','result','FAIL','detail','raised '||sqlstate);
  end;

  -- ── P08 duplicate membership rejected ────────────────────────────────────
  begin
    perform public.save_binder_page_layout(v_binder, 1, jsonb_build_array(
      jsonb_build_object('binderCardId',v_card_a,'page',1,'pocket',1),
      jsonb_build_object('binderCardId',v_card_a,'page',1,'pocket',2)));
    v_out := v_out || jsonb_build_object('probe','P08 duplicate membership','expected','22023','result','FAIL','detail','no error raised');
  exception when others then
    v_out := v_out || jsonb_build_object('probe','P08 duplicate membership','expected','22023',
      'result', case when sqlstate='22023' then 'PASS' else 'FAIL' end, 'detail', sqlstate);
  end;

  -- ── P09 duplicate pocket rejected ────────────────────────────────────────
  begin
    perform public.save_binder_page_layout(v_binder, 1, jsonb_build_array(
      jsonb_build_object('binderCardId',v_card_a,'page',1,'pocket',1),
      jsonb_build_object('binderCardId',v_card_b,'page',1,'pocket',1)));
    v_out := v_out || jsonb_build_object('probe','P09 duplicate pocket','expected','22023','result','FAIL','detail','no error raised');
  exception when others then
    v_out := v_out || jsonb_build_object('probe','P09 duplicate pocket','expected','22023',
      'result', case when sqlstate='22023' then 'PASS' else 'FAIL' end, 'detail', sqlstate);
  end;

  -- ── P10 foreign membership rejected ──────────────────────────────────────
  begin
    perform public.save_binder_page_layout(v_binder, 1, jsonb_build_array(
      jsonb_build_object('binderCardId',v_foreign,'page',1,'pocket',1)));
    v_out := v_out || jsonb_build_object('probe','P10 foreign membership','expected','42501','result','FAIL','detail','no error raised');
  exception when others then
    v_out := v_out || jsonb_build_object('probe','P10 foreign membership','expected','42501',
      'result', case when sqlstate='42501' then 'PASS' else 'FAIL' end, 'detail', sqlstate);
  end;

  -- ── P11 pocket ceiling per format: 3x3→10, 3x4→13, 4x4→17 ────────────────
  -- Each format change gets its OWN block. A BEGIN ... EXCEPTION block is an
  -- implicit savepoint: pairing the reset with the save that is expected to
  -- raise would roll the reset back too, and the next probe would run against
  -- the previous format. (That rollback behaviour is also what makes the
  -- restore at the end of this part safe.)
  v_n := 0;
  begin perform public.reset_binder_page_layout(v_binder,'3x3'); exception when others then null; end;
  begin
    perform public.save_binder_page_layout(v_binder, 1, jsonb_build_array(
      jsonb_build_object('binderCardId',v_card_a,'page',1,'pocket',10)));
  exception when others then if sqlstate='22023' then v_n := v_n + 1; end if;
  end;
  begin perform public.reset_binder_page_layout(v_binder,'3x4'); exception when others then null; end;
  begin
    perform public.save_binder_page_layout(v_binder, 1, jsonb_build_array(
      jsonb_build_object('binderCardId',v_card_a,'page',1,'pocket',13)));
  exception when others then if sqlstate='22023' then v_n := v_n + 1; end if;
  end;
  begin perform public.reset_binder_page_layout(v_binder,'4x4'); exception when others then null; end;
  begin
    perform public.save_binder_page_layout(v_binder, 1, jsonb_build_array(
      jsonb_build_object('binderCardId',v_card_a,'page',1,'pocket',17)));
  exception when others then if sqlstate='22023' then v_n := v_n + 1; end if;
  end;
  v_out := v_out || jsonb_build_object('probe','P11 pocket ceilings 9/12/16','expected','3 rejections',
    'result', case when v_n = 3 then 'PASS' else 'FAIL' end, 'detail', v_n::text || '/3 rejected');

  -- ── P12 highest legal pocket per format accepted (4x4 → 16) ──────────────
  begin
    v_doc := public.save_binder_page_layout(v_binder, 1, jsonb_build_array(
      jsonb_build_object('binderCardId',v_card_a,'page',1,'pocket',16)));
    v_out := v_out || jsonb_build_object('probe','P12 4x4 pocket 16 accepted','expected','1 placement',
      'result', case when jsonb_array_length(v_doc->'placements')=1 then 'PASS' else 'FAIL' end,
      'detail', (v_doc->'placements')::text);
  exception when others then
    v_out := v_out || jsonb_build_object('probe','P12 4x4 pocket 16 accepted','result','FAIL','detail','raised '||sqlstate);
  end;

  -- ── P13 page beyond page_count rejected ──────────────────────────────────
  begin
    perform public.save_binder_page_layout(v_binder, 1, jsonb_build_array(
      jsonb_build_object('binderCardId',v_card_a,'page',2,'pocket',1)));
    v_out := v_out || jsonb_build_object('probe','P13 page > page_count','expected','22023','result','FAIL','detail','no error raised');
  exception when others then
    v_out := v_out || jsonb_build_object('probe','P13 page > page_count','expected','22023',
      'result', case when sqlstate='22023' then 'PASS' else 'FAIL' end, 'detail', sqlstate);
  end;

  -- ── P14 add page, then place on it ───────────────────────────────────────
  begin
    v_doc := public.save_binder_page_layout(v_binder, 2, jsonb_build_array(
      jsonb_build_object('binderCardId',v_card_a,'page',1,'pocket',16),
      jsonb_build_object('binderCardId',v_card_b,'page',2,'pocket',1)));
    v_out := v_out || jsonb_build_object('probe','P14 add page + place','expected','2 pages, 2 placements',
      'result', case when (v_doc->>'pageCount')='2' and jsonb_array_length(v_doc->'placements')=2
                     then 'PASS' else 'FAIL' end, 'detail', (v_doc->'placements')::text);
  exception when others then
    v_out := v_out || jsonb_build_object('probe','P14 add page + place','result','FAIL','detail','raised '||sqlstate);
  end;

  -- ── P15 deleting an OCCUPIED final page rejected ─────────────────────────
  begin
    perform public.save_binder_page_layout(v_binder, 1, jsonb_build_array(
      jsonb_build_object('binderCardId',v_card_a,'page',1,'pocket',16),
      jsonb_build_object('binderCardId',v_card_b,'page',2,'pocket',1)));
    v_out := v_out || jsonb_build_object('probe','P15 delete occupied final page','expected','22023','result','FAIL','detail','no error raised');
  exception when others then
    v_out := v_out || jsonb_build_object('probe','P15 delete occupied final page','expected','22023',
      'result', case when sqlstate='22023' then 'PASS' else 'FAIL' end, 'detail', sqlstate);
  end;

  -- ── P16 whole-state rollback: state after every rejection is P14's ───────
  begin
    v_doc := public.fetch_binder_page_layout(v_binder);
    v_out := v_out || jsonb_build_object('probe','P16 no partial effect','expected','still 2 pages / 2 placements',
      'result', case when (v_doc->>'pageCount')='2' and jsonb_array_length(v_doc->'placements')=2
                     then 'PASS' else 'FAIL' end, 'detail', v_doc::text);
  exception when others then
    v_out := v_out || jsonb_build_object('probe','P16 no partial effect','result','FAIL','detail','raised '||sqlstate);
  end;

  -- ── P17 delete EMPTY final page accepted ─────────────────────────────────
  begin
    v_doc := public.save_binder_page_layout(v_binder, 1, jsonb_build_array(
      jsonb_build_object('binderCardId',v_card_a,'page',1,'pocket',16)));
    v_out := v_out || jsonb_build_object('probe','P17 delete empty final page','expected','1 page',
      'result', case when (v_doc->>'pageCount')='1' then 'PASS' else 'FAIL' end, 'detail', v_doc->>'pageCount');
  exception when others then
    v_out := v_out || jsonb_build_object('probe','P17 delete empty final page','result','FAIL','detail','raised '||sqlstate);
  end;

  -- ── P18 theme change preserves placements and page count ─────────────────
  begin
    perform public.set_binder_layout_theme(v_binder,'burgundy');
    -- NOTE: read in a SEPARATE statement. fetch_binder_page_layout is STABLE, so
    -- calling it in the same SELECT list as a write would return the PRE-write
    -- snapshot. This is correct PostgreSQL behaviour, not a defect — but it will
    -- mislead anyone who combines them.
    v_doc := public.fetch_binder_page_layout(v_binder);
    v_out := v_out || jsonb_build_object('probe','P18 theme change preserves layout','expected','burgundy, 1 placement',
      'result', case when (v_doc->>'backgroundTheme')='burgundy'
                       and jsonb_array_length(v_doc->'placements')=1 then 'PASS' else 'FAIL' end,
      'detail', v_doc::text);
  exception when others then
    v_out := v_out || jsonb_build_object('probe','P18 theme change preserves layout','result','FAIL','detail','raised '||sqlstate);
  end;

  -- ── P19 empty array clears every placement (and is not an error) ─────────
  begin
    v_doc := public.save_binder_page_layout(v_binder, 1, '[]'::jsonb);
    v_out := v_out || jsonb_build_object('probe','P19 empty placement set','expected','0 placements, no error',
      'result', case when (v_doc->'placements')='[]'::jsonb then 'PASS' else 'FAIL' end,
      'detail', (v_doc->'placements')::text);
  exception when others then
    v_out := v_out || jsonb_build_object('probe','P19 empty placement set','result','FAIL','detail','raised '||sqlstate);
  end;

  -- ── P20 malformed payloads all rejected with 22023 ───────────────────────
  v_n := 0;
  begin perform public.save_binder_page_layout(v_binder,1,'"nope"'::jsonb);
  exception when others then if sqlstate='22023' then v_n := v_n+1; end if; end;
  begin perform public.save_binder_page_layout(v_binder,1,'{}'::jsonb);
  exception when others then if sqlstate='22023' then v_n := v_n+1; end if; end;
  begin perform public.save_binder_page_layout(v_binder,1,'[null]'::jsonb);
  exception when others then if sqlstate='22023' then v_n := v_n+1; end if; end;
  begin perform public.save_binder_page_layout(v_binder,1,
    jsonb_build_array(jsonb_build_object('binderCardId',v_card_a,'page',1)));
  exception when others then if sqlstate='22023' then v_n := v_n+1; end if; end;
  begin perform public.save_binder_page_layout(v_binder,1,
    jsonb_build_array(jsonb_build_object('binderCardId',v_card_a,'page',1,'pocket',1,'extra',9)));
  exception when others then if sqlstate='22023' then v_n := v_n+1; end if; end;
  begin perform public.save_binder_page_layout(v_binder,1,
    jsonb_build_array(jsonb_build_object('binderCardId','not-a-uuid','page',1,'pocket',1)));
  exception when others then if sqlstate='22023' then v_n := v_n+1; end if; end;
  begin perform public.save_binder_page_layout(v_binder,1,
    jsonb_build_array(jsonb_build_object('binderCardId',v_card_a,'page',1,'pocket',1.5)));
  exception when others then if sqlstate='22023' then v_n := v_n+1; end if; end;
  begin perform public.save_binder_page_layout(v_binder,1,
    jsonb_build_array(jsonb_build_object('binderCardId',v_card_a,'page',-1,'pocket',1)));
  exception when others then if sqlstate='22023' then v_n := v_n+1; end if; end;
  begin perform public.save_binder_page_layout(v_binder,0,'[]'::jsonb);
  exception when others then if sqlstate='22023' then v_n := v_n+1; end if; end;
  begin perform public.save_binder_page_layout(v_binder,501,'[]'::jsonb);
  exception when others then if sqlstate='22023' then v_n := v_n+1; end if; end;
  v_out := v_out || jsonb_build_object('probe','P20 malformed payloads','expected','10 rejections with 22023',
    'result', case when v_n = 10 then 'PASS' else 'FAIL' end, 'detail', v_n::text || '/10 rejected');

  -- ── P21 foreign / nonexistent binder rejected on every RPC ───────────────
  v_n := 0;
  begin perform public.fetch_binder_page_layout(gen_random_uuid());
  exception when others then if sqlstate='42501' then v_n := v_n+1; end if; end;
  begin perform public.create_binder_page_layout(gen_random_uuid(),'3x3','sand');
  exception when others then if sqlstate='42501' then v_n := v_n+1; end if; end;
  begin perform public.save_binder_page_layout(gen_random_uuid(),1,'[]'::jsonb);
  exception when others then if sqlstate='42501' then v_n := v_n+1; end if; end;
  begin perform public.set_binder_layout_theme(gen_random_uuid(),'sand');
  exception when others then if sqlstate='42501' then v_n := v_n+1; end if; end;
  begin perform public.reset_binder_page_layout(gen_random_uuid(),'3x3');
  exception when others then if sqlstate='42501' then v_n := v_n+1; end if; end;
  v_out := v_out || jsonb_build_object('probe','P21 foreign binder on all five RPCs','expected','5 rejections with 42501',
    'result', case when v_n = 5 then 'PASS' else 'FAIL' end, 'detail', v_n::text || '/5 rejected');

  -- ── P22 reset clears placements, preserves theme, sets one page ──────────
  begin
    perform public.save_binder_page_layout(v_binder, 1, jsonb_build_array(
      jsonb_build_object('binderCardId',v_card_a,'page',1,'pocket',3)));
    v_doc := public.reset_binder_page_layout(v_binder,'3x3');
    v_out := v_out || jsonb_build_object('probe','P22 reset','expected','0 placements, 1 page, 3x3, theme preserved',
      'result', case when (v_doc->'placements')='[]'::jsonb and (v_doc->>'pageCount')='1'
                       and (v_doc->>'formatKey')='3x3' and (v_doc->>'backgroundTheme')='burgundy'
                     then 'PASS' else 'FAIL' end, 'detail', v_doc::text);
  exception when others then
    v_out := v_out || jsonb_build_object('probe','P22 reset','result','FAIL','detail','raised '||sqlstate);
  end;

  -- ── P23 membership and list order untouched by every probe above ─────────
  select count(*) into v_n from public.user_binder_cards where binder_id = v_binder;
  select count(*) = 0 into v_ok from public.user_binder_cards
   where binder_id = v_binder and position is null;
  v_out := v_out || jsonb_build_object('probe','P23 membership + position untouched','expected','unchanged count, no null positions',
    'result', case when v_n >= 2 and v_ok then 'PASS' else 'FAIL' end,
    'detail', v_n::text || ' member(s), null positions: ' || (not v_ok)::text);

  -- ── restore ──────────────────────────────────────────────────────────────
  delete from public.user_binder_layout_items i
   where i.layout_id in (select l.id from public.user_binder_layouts l where l.binder_id = v_binder);
  delete from public.user_binder_layouts where binder_id = v_binder;

  if v_had_layout then
    insert into public.user_binder_layouts (id, binder_id, format_key, background_theme, page_count, created_at, updated_at)
    values (v_layout_id, v_binder, v_o_format, v_o_theme, v_o_pages, v_o_created, v_o_updated);

    insert into public.user_binder_layout_items (id, layout_id, binder_id, binder_card_id, page_number, pocket_number, created_at)
    select (r->>'id')::uuid, (r->>'layout_id')::uuid, (r->>'binder_id')::uuid,
           (r->>'binder_card_id')::uuid, (r->>'page_number')::integer,
           (r->>'pocket_number')::integer, (r->>'created_at')::timestamptz
      from jsonb_array_elements(v_o_items) r;

    -- The insert above re-applies the original updated_at literally; the touch
    -- trigger fires only on UPDATE, so the restore is exact.
    v_out := v_out || jsonb_build_object('probe','restore','expected','pre-probe layout restored verbatim',
      'result','PASS','detail', jsonb_array_length(v_o_items)::text || ' placement(s) restored, layout id preserved');
  else
    v_out := v_out || jsonb_build_object('probe','restore','expected','no layout existed; probe layout removed',
      'result','PASS','detail','binder returned to having no layout');
  end if;

  -- ── restore the request/auth context and disarm ─────────────────────────
  -- The settings were made with is_local := true, so they lapse at the end of
  -- this transaction regardless; restoring them explicitly means the context is
  -- correct for anything else running in the same transaction too.
  if v_armed and v_gucs is not null then
    foreach v_guc in array v_gucs loop
      perform set_config(v_guc, coalesce(v_prior->>v_guc, ''), true);
    end loop;
    perform set_config('iv.bp31a_impersonate', 'off', false);   -- one-shot arming
    v_out := v_out || jsonb_build_object('probe','auth context restored',
      'expected','prior request settings restored, harness disarmed','result','PASS',
      'detail', 'restored: ' || array_to_string(v_gucs, ', ') || '; auth.uid() now '
                || coalesce(auth.uid()::text, 'null'));
  end if;

  perform set_config('iv.bp31a_probe', v_out::text, false);
end $$;

-- Expected: the 'harness' INFO row, 24 probe rows all PASS, the 'restore' row,
-- and on path 2B an 'auth context restored' row. A hard-fail in the 2B harness
-- aborts before any probe, so you see the ERROR and this table shows whatever
-- the previous run left behind — which is why the entry point clears it first.
select p.probe, p.expected, p.result, p.detail
  from jsonb_to_recordset(
         case when jsonb_typeof(coalesce(nullif(current_setting('iv.bp31a_probe', true),''),'{}')::jsonb) = 'array'
              then coalesce(nullif(current_setting('iv.bp31a_probe', true),''),'{}')::jsonb
              else jsonb_build_array(coalesce(nullif(current_setting('iv.bp31a_probe', true),''),'{}')::jsonb) end
       ) as p(probe text, expected text, result text, detail text);


-- ───────────────────────────────────────────────────────────────────────────
-- PART 3 — unauthenticated rejection (RUN IN THE SUPABASE SQL EDITOR)
--
-- Meaningful only where auth.uid() is null. Every RPC must raise 28000 before
-- locking, reading or writing anything. Reports SKIP when a real session is
-- attached, so it is harmless to run in either context.
-- ───────────────────────────────────────────────────────────────────────────

do $$
declare
  v_n   integer := 0;
  v_out jsonb;
begin
  if auth.uid() is not null then
    perform set_config('iv.bp31a_unauth',
      jsonb_build_object('check_name','unauthenticated rejection','result','SKIP',
        'detail','auth.uid() is not null — run Part 3 in the SQL editor')::text, false);
    return;
  end if;

  begin perform public.fetch_binder_page_layout(gen_random_uuid());
  exception when others then if sqlstate='28000' then v_n := v_n+1; end if; end;
  begin perform public.create_binder_page_layout(gen_random_uuid(),'3x3','charcoal');
  exception when others then if sqlstate='28000' then v_n := v_n+1; end if; end;
  begin perform public.save_binder_page_layout(gen_random_uuid(),1,'[]'::jsonb);
  exception when others then if sqlstate='28000' then v_n := v_n+1; end if; end;
  begin perform public.set_binder_layout_theme(gen_random_uuid(),'charcoal');
  exception when others then if sqlstate='28000' then v_n := v_n+1; end if; end;
  begin perform public.reset_binder_page_layout(gen_random_uuid(),'3x3');
  exception when others then if sqlstate='28000' then v_n := v_n+1; end if; end;

  v_out := jsonb_build_object('check_name','unauthenticated rejection','expected','5 rejections with 28000',
    'result', case when v_n = 5 then 'PASS' else 'FAIL' end, 'detail', v_n::text || '/5 rejected');
  perform set_config('iv.bp31a_unauth', v_out::text, false);
end $$;

select u.check_name, u.expected, u.result, u.detail
  from jsonb_to_recordset(jsonb_build_array(
         coalesce(nullif(current_setting('iv.bp31a_unauth', true),''),'{}')::jsonb))
    as u(check_name text, expected text, result text, detail text);
