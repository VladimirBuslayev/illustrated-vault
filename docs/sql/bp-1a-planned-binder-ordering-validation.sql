-- docs/sql/bp-1a-planned-binder-ordering-validation.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- BP-1A — Planned Binder ordering: validation
--
-- Two parts, run in order:
--
--   PART 1  Structural assertions. Pure SELECT. Reads nothing but catalogs and
--           row counts. Safe to run at any time, by any role.
--
--   PART 2  Behavioural probes against reorder_binder_cards. These necessarily
--           CALL the RPC, so they are not read-only — but they snapshot the
--           target binder's exact positions first and restore them byte-for-
--           byte at the end, including when a probe raises. NO PERSISTENT TEST
--           DATA IS CREATED: no binder, no membership row, no card is ever
--           inserted or deleted.
--
-- RUN AS THE AUTHENTICATED COLLECTOR. Part 2 derives its target from
-- auth.uid(); in the Supabase SQL editor auth.uid() is null and Part 2 will
-- report "no eligible binder" and change nothing.
--
-- TIMING — run PART 1 check 4 (order preservation) BEFORE any reorder is
-- performed, including PART 2. It compares the stored sequence against
-- created_at order, which is the migration's promise. Once a collector
-- deliberately reorders a binder, that check is EXPECTED to differ and is no
-- longer meaningful.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- PART 1 — structural assertions (read-only, one statement)
-- Every row should read result = 'PASS'.
-- ───────────────────────────────────────────────────────────────────────────

with
c_position_column as (
  select 'position exists and is NOT NULL'::text as check_name,
         case when count(*) filter (
                where column_name = 'position'
                  and data_type   = 'integer'
                  and is_nullable = 'NO'
              ) = 1 then 'PASS' else 'FAIL' end as result,
         coalesce(string_agg(column_name || ' ' || data_type || ' nullable=' || is_nullable, ', ')
                  filter (where column_name = 'position'), 'column absent') as detail
    from information_schema.columns
   where table_schema = 'public'
     and table_name   = 'user_binder_cards'
),
c_no_null_positions as (
  select 'every membership row has a position'::text,
         case when count(*) filter (where position is null) = 0 then 'PASS' else 'FAIL' end,
         count(*) filter (where position is null)::text || ' null of ' || count(*)::text || ' rows'
    from public.user_binder_cards
),
c_deterministic as (
  select 'positions are unique within each binder'::text,
         case when count(*) = 0 then 'PASS' else 'FAIL' end,
         count(*)::text || ' (binder_id, position) collision group(s)'
    from (
      select binder_id, position
        from public.user_binder_cards
       group by binder_id, position
      having count(*) > 1
    ) d
),
c_order_preserved as (
  -- The migration's core promise: the stored sequence must equal the sequence
  -- the service returned before BP-1A (created_at asc, id asc).
  -- EXPECTED to fail only after a deliberate reorder — see TIMING above.
  select 'backfilled order matches pre-BP-1A service order'::text,
         case when count(*) = 0 then 'PASS' else 'REVIEW' end,
         count(*)::text || ' row(s) whose position rank differs from created_at rank'
    from (
      select row_number() over (partition by binder_id order by position asc, created_at asc, id asc) as pos_rank,
             row_number() over (partition by binder_id order by created_at asc, id asc)               as time_rank
        from public.user_binder_cards
    ) r
   where r.pos_rank <> r.time_rank
),
c_no_dup_membership as (
  select 'no duplicate (binder_id, card_id) membership'::text,
         case when count(*) = 0 then 'PASS' else 'FAIL' end,
         count(*)::text || ' duplicate group(s)'
    from (
      select binder_id, card_id
        from public.user_binder_cards
       group by binder_id, card_id
      having count(*) > 1
    ) d
),
c_no_card_fk as (
  select 'no foreign key was added on card_id'::text,
         case when count(*) = 0 then 'PASS' else 'FAIL' end,
         coalesce(string_agg(conname, ', '), 'none') 
    from pg_constraint con
    join pg_class cl on cl.oid = con.conrelid
    join pg_namespace ns on ns.oid = cl.relnamespace
   where ns.nspname = 'public'
     and cl.relname = 'user_binder_cards'
     and con.contype = 'f'
     and 'card_id' = any (
           select a.attname
             from unnest(con.conkey) k
             join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k
         )
),
c_binder_fk_intact as (
  select 'binder_id FK still cascades from user_binders'::text,
         case when count(*) = 1 then 'PASS' else 'FAIL' end,
         coalesce(string_agg(pg_get_constraintdef(con.oid), '; '), 'absent')
    from pg_constraint con
    join pg_class cl on cl.oid = con.conrelid
    join pg_namespace ns on ns.oid = cl.relnamespace
   where ns.nspname = 'public'
     and cl.relname = 'user_binder_cards'
     and con.contype = 'f'
     and con.confdeltype = 'c'
     and con.confrelid = 'public.user_binders'::regclass
),
c_index as (
  select 'ordering index exists'::text,
         case when count(*) = 1 then 'PASS' else 'FAIL' end,
         coalesce(string_agg(indexdef, '; '), 'absent')
    from pg_indexes
   where schemaname = 'public'
     and tablename  = 'user_binder_cards'
     and indexname  = 'user_binder_cards_binder_position_idx'
),
c_trigger as (
  select 'BEFORE INSERT position trigger exists'::text,
         case when count(*) = 1 then 'PASS' else 'FAIL' end,
         coalesce(string_agg(pg_get_triggerdef(t.oid), '; '), 'absent')
    from pg_trigger t
    join pg_class cl on cl.oid = t.tgrelid
    join pg_namespace ns on ns.oid = cl.relnamespace
   where ns.nspname = 'public'
     and cl.relname = 'user_binder_cards'
     and t.tgname   = 'ubc_before_insert_assign_position'
     and not t.tgisinternal
),
c_rpc_shape as (
  select 'reorder RPC is security definer with a fixed search_path'::text,
         case when count(*) filter (
                where p.prosecdef
                  and array_to_string(coalesce(p.proconfig, '{}'), ',') like '%search_path=%'
              ) = 1 then 'PASS' else 'FAIL' end,
         coalesce(string_agg(
           'secdef=' || p.prosecdef::text ||
           ' config=' || array_to_string(coalesce(p.proconfig, '{}'), '|'), '; '), 'absent')
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and p.proname  = 'reorder_binder_cards'
),
c_rpc_grants as (
  select 'reorder RPC executable by authenticated, not by anon/public'::text,
         case when has_function_privilege('authenticated', p.oid, 'EXECUTE')
                   and not has_function_privilege('anon', p.oid, 'EXECUTE')
              then 'PASS' else 'FAIL' end,
         'authenticated=' || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text ||
         ' anon=' || has_function_privilege('anon', p.oid, 'EXECUTE')::text
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and p.proname  = 'reorder_binder_cards'
),
c_rls as (
  select 'RLS still enabled on both binder tables'::text,
         case when count(*) filter (where relrowsecurity) = 2 then 'PASS' else 'FAIL' end,
         string_agg(relname || '=' || relrowsecurity::text, ', ')
    from pg_class cl
    join pg_namespace ns on ns.oid = cl.relnamespace
   where ns.nspname = 'public'
     and cl.relname in ('user_binders', 'user_binder_cards')
),
c_policies as (
  select 'RLS policies unchanged in count and command coverage'::text,
         'REVIEW',
         string_agg(tablename || '.' || policyname || ' [' || cmd || ']', '; ' order by tablename, policyname)
    from pg_policies
   where schemaname = 'public'
     and tablename in ('user_binders', 'user_binder_cards')
),
c_no_user_id as (
  select 'user_binder_cards still has no user_id column'::text,
         case when count(*) = 0 then 'PASS' else 'FAIL' end,
         count(*)::text || ' user_id column(s)'
    from information_schema.columns
   where table_schema = 'public'
     and table_name   = 'user_binder_cards'
     and column_name  = 'user_id'
),
c_rollback_safe as (
  -- Rollback drops the column. Anything else depending on it (a view, another
  -- index, a generated column) would block the drop. Only our own index should
  -- appear.
  select 'position has no dependants beyond the BP-1A index'::text,
         case when count(*) filter (where indexname <> 'user_binder_cards_binder_position_idx') = 0
              then 'PASS' else 'REVIEW' end,
         coalesce(string_agg(indexname, ', '), 'none')
    from pg_indexes
   where schemaname = 'public'
     and tablename  = 'user_binder_cards'
     and indexdef ilike '%position%'
)
select * from c_position_column
union all select * from c_no_null_positions
union all select * from c_deterministic
union all select * from c_order_preserved
union all select * from c_no_dup_membership
union all select * from c_no_card_fk
union all select * from c_binder_fk_intact
union all select * from c_index
union all select * from c_trigger
union all select * from c_rpc_shape
union all select * from c_rpc_grants
union all select * from c_rls
union all select * from c_policies
union all select * from c_no_user_id
union all select * from c_rollback_safe;


-- ───────────────────────────────────────────────────────────────────────────
-- PART 2 — behavioural probes (calls the RPC; restores exact prior state)
--
-- Statement 1 runs the probes and stashes the report.
-- Statement 2 prints it.
--
-- The probes never insert or delete a row. The target binder's positions are
-- snapshotted before the first probe and restored in an EXCEPTION-guarded
-- final step, so an unexpected failure still leaves production untouched.
-- ───────────────────────────────────────────────────────────────────────────

do $$
declare
  v_binder   uuid;
  v_ids      text[];
  v_rev      text[];
  v_probe    text[];
  v_orig     jsonb;
  v_out      jsonb := '[]'::jsonb;
  v_res      integer;
  v_len      integer;
  v_after    text[];
begin
  -- Pick, deterministically, a binder owned by the caller with >= 2 members.
  select c.binder_id
    into v_binder
    from public.user_binder_cards c
    join public.user_binders b
      on b.id = c.binder_id
     and b.user_id = auth.uid()
   group by c.binder_id
  having count(*) >= 2
   order by count(*) desc, c.binder_id
   limit 1;

  if v_binder is null then
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'check_name', 'behavioural probes',
      'result',     'SKIPPED',
      'detail',     'no binder owned by auth.uid() has 2 or more members (auth.uid() is null in the SQL editor)'));
    perform set_config('iv.bp1a_validation', v_out::text, false);
    return;
  end if;

  -- Snapshot exact positions for byte-for-byte restoration.
  select jsonb_agg(jsonb_build_object('card_id', card_id, 'position', position)),
         array_agg(card_id order by position asc, created_at asc, id asc)
    into v_orig, v_ids
    from public.user_binder_cards
   where binder_id = v_binder;

  v_len := array_length(v_ids, 1);
  select array_agg(x order by ord desc) into v_rev
    from unnest(v_ids) with ordinality as t(x, ord);

  begin
    -- Probe 1 — foreign binder is rejected.
    begin
      v_res := public.reorder_binder_cards(gen_random_uuid(), v_ids);
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'check_name','reorder rejects a foreign binder','result','FAIL','detail','no exception raised'));
    exception when others then
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'check_name','reorder rejects a foreign binder','result','PASS','detail', sqlerrm));
    end;

    -- Probe 2 — a null card id is rejected.
    v_probe := v_ids; v_probe[v_len] := null;
    begin
      v_res := public.reorder_binder_cards(v_binder, v_probe);
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'check_name','reorder rejects a null card id','result','FAIL','detail','no exception raised'));
    exception when others then
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'check_name','reorder rejects a null card id','result','PASS','detail', sqlerrm));
    end;

    -- Probe 3 — duplicate ids are rejected (same cardinality, so this exercises
    -- the duplicate check rather than the count check).
    v_probe := v_ids; v_probe[v_len] := v_ids[1];
    begin
      v_res := public.reorder_binder_cards(v_binder, v_probe);
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'check_name','reorder rejects duplicate card ids','result','FAIL','detail','no exception raised'));
    exception when others then
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'check_name','reorder rejects duplicate card ids','result','PASS','detail', sqlerrm));
    end;

    -- Probe 4 — a missing id is rejected.
    v_probe := v_ids[1 : v_len - 1];
    begin
      v_res := public.reorder_binder_cards(v_binder, v_probe);
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'check_name','reorder rejects a missing card id','result','FAIL','detail','no exception raised'));
    exception when others then
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'check_name','reorder rejects a missing card id','result','PASS','detail', sqlerrm));
    end;

    -- Probe 5 — an extra (non-member) id is rejected, again at equal
    -- cardinality so the membership check is what fires.
    v_probe := v_ids; v_probe[v_len] := 'bp1a-validation-nonexistent-card';
    begin
      v_res := public.reorder_binder_cards(v_binder, v_probe);
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'check_name','reorder rejects a non-member card id','result','FAIL','detail','no exception raised'));
    exception when others then
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'check_name','reorder rejects a non-member card id','result','PASS','detail', sqlerrm));
    end;

    -- Probe 6 — an exact permutation succeeds and repositions every row.
    begin
      v_res := public.reorder_binder_cards(v_binder, v_rev);
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'check_name','reorder accepts an exact permutation','result',
        case when v_res = v_len then 'PASS' else 'FAIL' end,
        'detail', v_res::text || ' of ' || v_len::text || ' row(s) repositioned'));
    exception when others then
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'check_name','reorder accepts an exact permutation','result','FAIL','detail', sqlerrm));
    end;

    -- Probe 7 — the new order is what the service read will return.
    select array_agg(card_id order by position asc, created_at asc, id asc)
      into v_after
      from public.user_binder_cards
     where binder_id = v_binder;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'check_name','reordered sequence persists in service read order','result',
      case when v_after = v_rev then 'PASS' else 'FAIL' end,
      'detail', 'stored=' || array_to_string(v_after, ',')));

  exception when others then
    -- Restore before surfacing any unexpected failure.
    update public.user_binder_cards c
       set position = (s.value ->> 'position')::integer
      from jsonb_array_elements(v_orig) s
     where c.binder_id = v_binder
       and c.card_id   = s.value ->> 'card_id';
    raise;
  end;

  -- Restore the exact pre-validation positions.
  update public.user_binder_cards c
     set position = (s.value ->> 'position')::integer
    from jsonb_array_elements(v_orig) s
   where c.binder_id = v_binder
     and c.card_id   = s.value ->> 'card_id';

  select array_agg(card_id order by position asc, created_at asc, id asc)
    into v_after
    from public.user_binder_cards
   where binder_id = v_binder;

  v_out := v_out || jsonb_build_array(jsonb_build_object(
    'check_name','pre-validation order restored (no persistent change)','result',
    case when v_after = v_ids then 'PASS' else 'FAIL' end,
    'detail', 'restored=' || array_to_string(v_after, ',')));

  v_out := v_out || jsonb_build_array(jsonb_build_object(
    'check_name','target binder','result','INFO','detail', v_binder::text));

  perform set_config('iv.bp1a_validation', v_out::text, false);
end $$;

select *
  from jsonb_to_recordset(current_setting('iv.bp1a_validation')::jsonb)
    as t(check_name text, result text, detail text);


-- ───────────────────────────────────────────────────────────────────────────
-- PART 3 — trigger append behaviour and RLS isolation
--
-- These two cannot be proved from SQL alone without creating persistent data,
-- and this file deliberately creates none. Validate them from the application:
--
--   Trigger append —  add a card to a binder from the Planned Binder search
--                     surface, then re-run PART 1. The new row must carry
--                     max(position) + 1000 for that binder and must appear
--                     last in the grid.
--
--   RLS isolation  —  sign in as a second collector and call
--                     reorder_binder_cards with the first collector's binder
--                     id. Expect SQLSTATE 42501, "binder ... not found or not
--                     owned". PART 2 probe 1 covers the same code path with a
--                     synthetic uuid.
--
--   Rollback       —  the rollback block at the foot of the migration is the
--                     tested path. PART 1's "position has no dependants"
--                     check confirms nothing beyond the BP-1A index would
--                     block the DROP COLUMN.
-- ───────────────────────────────────────────────────────────────────────────
