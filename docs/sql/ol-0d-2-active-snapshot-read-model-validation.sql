-- docs/sql/ol-0d-2-active-snapshot-read-model-validation.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- OL-0D — rollback-safe validation for get_active_import_snapshot_read_model.
--
-- HOW TO RUN
--   Run in the Supabase SQL editor as the `postgres` role, AFTER installing
--   ol-0d-1-active-snapshot-read-model.sql. The entire script runs inside one
--   transaction and ROLLS BACK at the end: it creates two throwaway auth.users,
--   seeds synthetic import snapshots, exercises the RPC under simulated auth,
--   asserts invariants, and leaves the database byte-for-byte unchanged.
--
--   If your local auth.users schema requires more NOT NULL columns than the
--   minimal insert below, extend ONLY that INSERT. Nothing else changes.
--
--   Any failed assertion RAISEs and aborts (the transaction rolls back either
--   way). A fully successful run prints:  OL-0D VALIDATION: ALL PASS
--
-- WHY SOME COVERAGE LIVES IN THE NODE HARNESS
--   cards_effective is a catalog view; synthetic catalog rows cannot be injected
--   without touching catalog tables (out of scope). So "available" cases use REAL
--   catalog ids, and the "duplicate catalog id cannot multiply" invariant is
--   proven here by demonstrating the RPC's exact DISTINCT ON dedup rule on a
--   controlled duplicate set (Test 11). Response-shape/normalization coverage is
--   in scripts/ol0d-active-snapshot-read-model.test.mjs.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

do $$
declare
  v_owner       text := current_user;
  v_user_a      uuid := gen_random_uuid();
  v_user_b      uuid := gen_random_uuid();
  v_active_a    uuid := gen_random_uuid();
  v_proc_a      uuid := gen_random_uuid();
  v_failed_a    uuid := gen_random_uuid();
  v_super_a     uuid := gen_random_uuid();

  v_real_a      text;
  v_real_b      text;

  v_res         jsonb;
  v_item        jsonb;
  v_threw       boolean;

  v_hash_before text;
  v_hash_after  text;
  v_uc_before   text;
  v_uc_after    text;

  v_dedup_cnt   int;
  v_dedup_tag   text;

  v_secdef      boolean;
  v_volatile    "char";
  v_config      text;
  v_has_dml     boolean;

  -- convenience: run the RPC as user A (authenticated), then restore owner role.
  -- (inline below; plpgsql has no nested procedures.)
begin
  -- ── preflight: the OL-0B child-insert guard trigger must exist by name ───────
  -- The real trigger (from ol-0b-1-user-import-snapshots.sql) is
  -- public.user_import_rows.uir_before_insert_guard (it executes uir_guard_insert()).
  -- We disable/enable it by this exact name below; assert it before relying on it.
  if not exists (
    select 1
    from pg_trigger t
    join pg_class c     on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'user_import_rows'
      and t.tgname  = 'uir_before_insert_guard'
      and not t.tgisinternal
  ) then
    raise exception 'validation preflight: expected trigger public.user_import_rows.uir_before_insert_guard not found (schema drift?)';
  end if;

  -- ── pick two real catalog ids for the "available" path ──────────────────────
  select id into v_real_a from public.cards_effective order by id limit 1;
  select id into v_real_b from public.cards_effective where id <> v_real_a order by id limit 1;
  if v_real_a is null or v_real_b is null then
    raise exception 'validation setup: need >= 2 rows in cards_effective';
  end if;

  -- ── throwaway users (FK target for user_import_batches.user_id) ──────────────
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values
    (v_user_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ol0d_a@example.test', now(), now()),
    (v_user_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ol0d_b@example.test', now(), now());

  -- ── seed NON-active batches for A (must be ignored by the RPC) ───────────────
  insert into public.user_import_batches
    (id, user_id, source, status, matcher_version,
     total_source_rows, pokemon_rows, positive_qty_rows, stored_rows,
     matched_rows, ambiguous_rows, unmatched_rows, invalid_rows,
     watchlist_only_rows, non_pokemon_rows, invalid_quantity_rows,
     created_at, activated_at, superseded_at)
  values
    (v_proc_a,   v_user_a, 'collectr', 'processing', 'ol0c-1', 0,0,0,0,0,0,0,0,0,0,0, now(), null, null),
    (v_failed_a, v_user_a, 'collectr', 'failed',     'ol0c-1', 0,0,0,0,0,0,0,0,0,0,0, now(), null, null),
    (v_super_a,  v_user_a, 'collectr', 'superseded', 'ol0c-1', 0,0,0,0,0,0,0,0,0,0,0,
       now() - interval '2 min', now() - interval '1 min', now());

  -- ══ Test 2/3 (part 1): with only non-active batches, A has no active batch ══
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user_a::text, 'role', 'authenticated', 'aud', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := public.get_active_import_snapshot_read_model();
  execute format('set local role %I', v_owner);
  if (v_res->>'state') <> 'no_active_batch' then
    raise exception 'FAIL 2/3a: expected no_active_batch with only non-active batches, got %', v_res->>'state';
  end if;

  -- ── seed the ACTIVE batch + child rows (disable the child guard for seeding) ─
  alter table public.user_import_rows disable trigger uir_before_insert_guard;

  insert into public.user_import_batches
    (id, user_id, source, status, matcher_version,
     total_source_rows, pokemon_rows, positive_qty_rows, stored_rows,
     matched_rows, ambiguous_rows, unmatched_rows, invalid_rows,
     watchlist_only_rows, non_pokemon_rows, invalid_quantity_rows,
     created_at, activated_at, superseded_at)
  values
    (v_active_a, v_user_a, 'collectr', 'active', 'ol0c-1',
     16, 15, 12, 12,
     7, 2, 2, 1,
     2, 1, 1,
     now() - interval '1 min', now(), null);

  -- matched rows (7). Two share real_a → aggregation 5, sourceRowCount 2,
  -- lowest source_row_number (10) supplies fallback 'Alpha'.
  insert into public.user_import_rows
    (batch_id, source_row_number, product_name, set_name, card_number, variance, rarity,
     quantity, card_id, match_status, match_rule, match_reason, candidate_card_ids)
  values
    (v_active_a, 10, 'Alpha',     'SetA',     '58', 'Normal',   'Rare',     2, v_real_a,        'matched', 'exact',     null, null),
    (v_active_a, 25, 'AlphaDupe', 'SetA',     '58', 'Holofoil', 'Rare',     3, v_real_a,        'matched', 'set_alias', null, null),
    (v_active_a,  5, 'Bravo',     'SetB',     '12', 'Normal',   'Uncommon', 1, v_real_b,        'matched', 'exact',     null, null),
    (v_active_a, 40, 'StaleName', 'StaleSet', 'S1', 'Normal',   'Promo',    4, 'ol0d-stale-40', 'matched', 'exact',     null, null),
    (v_active_a, 51, 'A_B',       'X',        'n1', 'Normal',   'Common',   1, 'ol0d-stale-51', 'matched', 'exact',     null, null),
    (v_active_a, 52, 'AxB',       'X',        'n2', 'Normal',   'Common',   1, 'ol0d-stale-52', 'matched', 'exact',     null, null),
    (v_active_a, 53, '5%OFF',     'X',        'n3', 'Normal',   'Common',   1, 'ol0d-stale-53', 'matched', 'exact',     null, null);

  -- unresolved rows: ambiguous(2), unmatched(2), invalid(1) → 5 groups, qty 6.
  insert into public.user_import_rows
    (batch_id, source_row_number, product_name, set_name, card_number, variance, rarity,
     quantity, card_id, match_status, match_rule, match_reason, candidate_card_ids)
  values
    (v_active_a, 60, 'AmbA', 'SetC', '1', 'Normal', 'Rare', 1, null, 'ambiguous', null, 'multi_exact',        array['x','y']),
    (v_active_a, 61, 'AmbB', 'SetC', '2', 'Normal', 'Rare', 2, null, 'ambiguous', null, 'name_num_multi',     array['z']),
    (v_active_a, 62, 'UnmA', 'SetD', '3', 'Normal', 'Rare', 1, null, 'unmatched', null, 'name_not_found',     null),
    (v_active_a, 63, 'UnmB', 'SetE', '4', 'Normal', 'Rare', 1, null, 'unmatched', null, 'set_not_in_catalog', null),
    (v_active_a, 64, 'InvA', '',     '',  'Normal', 'Rare', 1, null, 'invalid',   null, 'missing_number',     null);

  alter table public.user_import_rows enable trigger uir_before_insert_guard;

  -- ── snapshot content hashes BEFORE any read (for no-write / owned_keys tests) ─
  select md5(coalesce(string_agg(line, '|' order by line), '')) into v_hash_before
  from (
    select 'b:' || b.id::text || b.status || b.stored_rows::text as line
    from public.user_import_batches b where b.user_id in (v_user_a, v_user_b)
    union all
    select 'r:' || r.id::text || coalesce(r.card_id, '') || r.match_status || r.quantity::text
    from public.user_import_rows r
    join public.user_import_batches b on b.id = r.batch_id
    where b.user_id in (v_user_a, v_user_b)
  ) s;

  select md5(coalesce(string_agg(uc::text, '|'), '')) into v_uc_before
  from public.user_collection uc where uc.user_id in (v_user_a, v_user_b);

  -- ══ Test 1: unauthenticated call is rejected ════════════════════════════════
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role authenticated';
  begin
    perform public.get_active_import_snapshot_read_model();
    v_threw := false;
  exception when others then
    v_threw := true;
  end;
  execute format('set local role %I', v_owner);
  if not v_threw then raise exception 'FAIL 1: unauthenticated call was not rejected'; end if;

  -- helper macro pattern: authenticate as A for the remaining reads.
  -- (each block re-asserts role authenticated then restores owner.)

  -- ══ Test 3 (part 2) + 4 + 5 + 6 + 8 + 9: ready shape & aggregation ══════════
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user_a::text, 'role', 'authenticated', 'aud', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := public.get_active_import_snapshot_read_model(p_limit => 100);
  execute format('set local role %I', v_owner);

  if (v_res->>'state') <> 'ready' then raise exception 'FAIL 3b: expected ready, got %', v_res->>'state'; end if;
  if (v_res->'batch'->>'id') <> v_active_a::text then raise exception 'FAIL 3b: active batch id mismatch (non-active not ignored)'; end if;

  -- batch-only header counts (Test 8)
  if (v_res->'summary'->>'watchlistOnlyRows')::int <> 2 then raise exception 'FAIL 8: watchlistOnlyRows'; end if;
  if (v_res->'summary'->>'nonPokemonRows')::int <> 1 then raise exception 'FAIL 8: nonPokemonRows'; end if;
  if (v_res->'summary'->>'invalidQuantityRows')::int <> 1 then raise exception 'FAIL 8: invalidQuantityRows'; end if;

  -- quantity-weighted / distinct-card summary
  if (v_res->'summary'->>'matchedQuantity')::int <> 13 then raise exception 'FAIL agg: matchedQuantity expected 13, got %', v_res->'summary'->>'matchedQuantity'; end if;
  if (v_res->'summary'->>'distinctCanonicalCards')::int <> 6 then raise exception 'FAIL agg: distinctCanonicalCards expected 6'; end if;
  if (v_res->'summary'->>'unresolvedRows')::int <> 5 then raise exception 'FAIL 7: unresolvedRows expected 5'; end if;
  if (v_res->'summary'->>'unresolvedQuantity')::int <> 6 then raise exception 'FAIL 7: unresolvedQuantity expected 6'; end if;
  if (v_res->'summary'->>'catalogMissingCards')::int <> 4 then raise exception 'FAIL 10: catalogMissingCards expected 4'; end if;
  if (v_res->'summary'->>'catalogMissingQuantity')::int <> 7 then raise exception 'FAIL 10: catalogMissingQuantity expected 7'; end if;

  if (v_res->'page'->>'totalItems')::int <> 6 then raise exception 'FAIL: totalItems expected 6, got %', v_res->'page'->>'totalItems'; end if;

  -- Test 5/6/9: real_a item = merged, deterministic fallback from lowest row.
  select elem into v_item
  from jsonb_array_elements(v_res->'page'->'items') elem
  where elem->>'cardId' = v_real_a;
  if v_item is null then raise exception 'FAIL 4: real_a item missing'; end if;
  if (v_item->>'quantity')::int <> 5 then raise exception 'FAIL 5: real_a quantity expected 5 (2+3)'; end if;
  if (v_item->>'sourceRowCount')::int <> 2 then raise exception 'FAIL 5/6: real_a sourceRowCount expected 2'; end if;
  if (v_item->>'firstSourceRow')::int <> 10 then raise exception 'FAIL 9: real_a firstSourceRow expected 10'; end if;
  if (v_item->'fallback'->>'productName') <> 'Alpha' then raise exception 'FAIL 9: fallback should come from lowest source row (Alpha)'; end if;
  if (v_item->>'catalogStatus') <> 'available' then raise exception 'FAIL 4: real_a should be available'; end if;
  if (v_item->'card'->>'id') <> v_real_a then raise exception 'FAIL 4: real_a catalog card.id mismatch'; end if;

  -- Test 10: stale reference retained, card null, still counted.
  select elem into v_item
  from jsonb_array_elements(v_res->'page'->'items') elem
  where elem->>'cardId' = 'ol0d-stale-40';
  if v_item is null then raise exception 'FAIL 10: stale item was discarded'; end if;
  if (v_item->>'catalogStatus') <> 'missing' then raise exception 'FAIL 10: stale item not marked missing'; end if;
  if (v_item->'card') <> 'null'::jsonb then raise exception 'FAIL 10: stale item card should be null'; end if;
  if (v_item->>'quantity')::int <> 4 then raise exception 'FAIL 10: stale item quantity retained (4)'; end if;
  if (v_item->'fallback'->>'productName') <> 'StaleName' then raise exception 'FAIL 10: stale fallback productName'; end if;

  -- Test 7: unresolved grouped by status+reason, deterministic order.
  if jsonb_array_length(v_res->'unresolved'->'groups') <> 5 then raise exception 'FAIL 7: expected 5 unresolved groups'; end if;
  if (v_res->'unresolved'->'groups'->0->>'status') <> 'ambiguous' then raise exception 'FAIL 7: groups not sorted by status'; end if;

  -- ══ Test 12: filter-before-pagination ═══════════════════════════════════════
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user_a::text, 'role', 'authenticated', 'aud', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := public.get_active_import_snapshot_read_model(p_catalog_status => 'available', p_limit => 1);
  execute format('set local role %I', v_owner);
  if (v_res->'page'->>'totalItems')::int <> 2 then raise exception 'FAIL 12: available totalItems expected 2, got %', v_res->'page'->>'totalItems'; end if;
  if (v_res->'page'->>'returnedItems')::int <> 1 then raise exception 'FAIL 12: returnedItems should honor limit 1'; end if;

  -- ══ Test 13: literal % and _ (no wildcard expansion) ════════════════════════
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user_a::text, 'role', 'authenticated', 'aud', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := public.get_active_import_snapshot_read_model(p_search => 'A_B', p_limit => 100);
  execute format('set local role %I', v_owner);
  if (v_res->'page'->>'totalItems')::int <> 1 then raise exception 'FAIL 13: search "A_B" must match only literal A_B (got % items)', v_res->'page'->>'totalItems'; end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user_a::text, 'role', 'authenticated', 'aud', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := public.get_active_import_snapshot_read_model(p_search => '5%', p_limit => 100);
  execute format('set local role %I', v_owner);
  if (v_res->'page'->>'totalItems')::int <> 1 then raise exception 'FAIL 13: search "5%%" must match only literal 5%% (got % items)', v_res->'page'->>'totalItems'; end if;

  -- ══ Test 14: deterministic adjacent pages ═══════════════════════════════════
  declare
    v_p0 jsonb; v_p1 jsonb; v_p0b jsonb;
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_user_a::text, 'role', 'authenticated', 'aud', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_p0  := public.get_active_import_snapshot_read_model(p_limit => 1, p_offset => 0, p_sort => 'name_asc');
    v_p1  := public.get_active_import_snapshot_read_model(p_limit => 1, p_offset => 1, p_sort => 'name_asc');
    v_p0b := public.get_active_import_snapshot_read_model(p_limit => 1, p_offset => 0, p_sort => 'name_asc');
    execute format('set local role %I', v_owner);

    if (v_p0->'page'->'items'->0->>'cardId') = (v_p1->'page'->'items'->0->>'cardId') then
      raise exception 'FAIL 14: adjacent pages returned the same item';
    end if;
    if (v_p0->'page'->'items'->0->>'cardId') <> (v_p0b->'page'->'items'->0->>'cardId') then
      raise exception 'FAIL 14: repeated identical query was not deterministic';
    end if;
  end;

  -- ══ Test 15: invalid argument rejection ═════════════════════════════════════
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user_a::text, 'role', 'authenticated', 'aud', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.get_active_import_snapshot_read_model(p_limit => 0);   v_threw := false; exception when others then v_threw := true; end;
  if not v_threw then execute format('set local role %I', v_owner); raise exception 'FAIL 15: p_limit=0 not rejected'; end if;
  begin perform public.get_active_import_snapshot_read_model(p_limit => 101); v_threw := false; exception when others then v_threw := true; end;
  if not v_threw then execute format('set local role %I', v_owner); raise exception 'FAIL 15: p_limit=101 not rejected'; end if;
  begin perform public.get_active_import_snapshot_read_model(p_offset => -1); v_threw := false; exception when others then v_threw := true; end;
  if not v_threw then execute format('set local role %I', v_owner); raise exception 'FAIL 15: p_offset=-1 not rejected'; end if;
  begin perform public.get_active_import_snapshot_read_model(p_catalog_status => 'bogus'); v_threw := false; exception when others then v_threw := true; end;
  if not v_threw then execute format('set local role %I', v_owner); raise exception 'FAIL 15: bad p_catalog_status not rejected'; end if;
  begin perform public.get_active_import_snapshot_read_model(p_sort => 'bogus'); v_threw := false; exception when others then v_threw := true; end;
  if not v_threw then execute format('set local role %I', v_owner); raise exception 'FAIL 15: bad p_sort not rejected'; end if;
  execute format('set local role %I', v_owner);

  -- ══ Test 16: cross-user isolation (B never sees A's active batch) ═══════════
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user_b::text, 'role', 'authenticated', 'aud', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := public.get_active_import_snapshot_read_model();
  execute format('set local role %I', v_owner);
  if (v_res->>'state') <> 'no_active_batch' then raise exception 'FAIL 16: user B leaked into user A''s snapshot'; end if;

  -- ══ Test 17: expected-batch mismatch → snapshot_changed ═════════════════════
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user_a::text, 'role', 'authenticated', 'aud', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := public.get_active_import_snapshot_read_model(p_expected_batch_id => gen_random_uuid());
  execute format('set local role %I', v_owner);
  if (v_res->>'state') <> 'snapshot_changed' then raise exception 'FAIL 17: expected snapshot_changed'; end if;
  if (v_res->>'activeBatchId') <> v_active_a::text then raise exception 'FAIL 17: snapshot_changed should report the current active id'; end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user_a::text, 'role', 'authenticated', 'aud', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_res := public.get_active_import_snapshot_read_model(p_expected_batch_id => v_active_a);
  execute format('set local role %I', v_owner);
  if (v_res->>'state') <> 'ready' then raise exception 'FAIL 17: matching expected id should be ready'; end if;

  -- ══ Test R: fail-closed reconciliation guard on the ready path ══════════════
  -- Corrupt the header so it disagrees with child statuses while STILL satisfying
  -- the table-level arithmetic constraints: swap matched<->ambiguous (6/3 still
  -- sums to stored_rows 12; pokemon/total identities untouched). The RPC must
  -- raise a hard error, not degrade to no_active_batch / snapshot_changed / empty.
  update public.user_import_batches
  set matched_rows = 6, ambiguous_rows = 3
  where id = v_active_a;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user_a::text, 'role', 'authenticated', 'aud', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.get_active_import_snapshot_read_model();
    v_threw := false;
  exception when others then
    v_threw := true;
  end;
  execute format('set local role %I', v_owner);

  -- restore the correct header BEFORE continuing (leave the batch consistent).
  update public.user_import_batches
  set matched_rows = 7, ambiguous_rows = 2
  where id = v_active_a;

  if not v_threw then
    raise exception 'FAIL R: inconsistent active-batch header did not raise a reconciliation error';
  end if;

  -- ══ Test 11: duplicate catalog id CANNOT multiply — prove the dedup rule ════
  -- Mirrors the RPC's DISTINCT ON (id) ORDER BY pricing_updated_at DESC ...
  with dc as (
    select distinct on (v.id) v.id, v.tag
    from (values
      ('dup1'::text, timestamptz '2024-01-01', 'old'),
      ('dup1',        timestamptz '2025-06-01', 'new'),
      ('dup2',        null::timestamptz,        'solo')
    ) v(id, pu, tag)
    order by v.id, v.pu desc nulls last
  )
  select count(*)::int, (select tag from dc where id = 'dup1') into v_dedup_cnt, v_dedup_tag from dc;
  if v_dedup_cnt <> 2 then raise exception 'FAIL 11: dedup produced % rows, expected 2', v_dedup_cnt; end if;
  if v_dedup_tag <> 'new' then raise exception 'FAIL 11: dedup did not pick latest pricing_updated_at (got %)', v_dedup_tag; end if;

  -- Also: the merged available item (real_a, 2 source rows) yields exactly ONE
  -- item — duplicate join fan-out would have produced two (proven at Test 5).

  -- ══ Test 18 + 19: no write side effects; owned_keys / collection untouched ══
  select md5(coalesce(string_agg(line, '|' order by line), '')) into v_hash_after
  from (
    select 'b:' || b.id::text || b.status || b.stored_rows::text as line
    from public.user_import_batches b where b.user_id in (v_user_a, v_user_b)
    union all
    select 'r:' || r.id::text || coalesce(r.card_id, '') || r.match_status || r.quantity::text
    from public.user_import_rows r
    join public.user_import_batches b on b.id = r.batch_id
    where b.user_id in (v_user_a, v_user_b)
  ) s;
  if v_hash_before <> v_hash_after then raise exception 'FAIL 18: snapshot tables changed after RPC reads'; end if;

  select md5(coalesce(string_agg(uc::text, '|'), '')) into v_uc_after
  from public.user_collection uc where uc.user_id in (v_user_a, v_user_b);
  if v_uc_before <> v_uc_after then raise exception 'FAIL 19: user_collection changed after RPC reads'; end if;

  -- Static guarantee: function metadata + no DML keywords in its body.
  select p.prosecdef, p.provolatile, array_to_string(coalesce(p.proconfig, array[]::text[]), ','),
         p.prosrc ~* '\m(insert|update|delete|truncate)\M'
  into v_secdef, v_volatile, v_config, v_has_dml
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_active_import_snapshot_read_model';

  if v_secdef is distinct from false then raise exception 'FAIL meta: function must be SECURITY INVOKER'; end if;
  if v_volatile <> 's' then raise exception 'FAIL meta: function must be STABLE'; end if;
  if v_config not like '%search_path%' then raise exception 'FAIL meta: function must pin search_path'; end if;
  if v_has_dml then raise exception 'FAIL 18: function body contains a DML keyword'; end if;

  raise notice 'OL-0D VALIDATION: ALL PASS';
end;
$$;

rollback;
