-- docs/sql/ol-0d-4-postdeploy-plans-guc.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- OL-0D.2 — POST-DEPLOY PLAN VALIDATION (READ-ONLY, Results-grid output)
--
-- WHY THIS FILE EXISTS
--   ol-0d-3b-* hardcoded the OLD (pre-OL-0D.2) query text. It was a
--   pre-migration diagnostic and will print the OLD plan forever, no matter what
--   is deployed. It never read the RPC body. Do not use it post-deploy.
--
--   This script does two things instead:
--     SECTION 0 — FINGERPRINTS the ACTUALLY DEPLOYED function source
--                 (pg_get_functiondef) to prove OL-0D.2 is live: the deployed
--                 body must NOT contain DISTINCT ON / pricing::text /
--                 row_number() / public.cards / public.card_extras, and MUST
--                 contain item_keys / page_keys / cards_effective.
--                 If these fail, the migration did not apply — stop and re-run it.
--     SECTIONS 1-2 — EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS, FORMAT TEXT)
--                 of the OL-0D.2 ready-path SQL EQUIVALENT, mirroring the
--                 deployed migration body (matched_agg -> fallback_rows ->
--                 item_keys -> item_stats -> items_filtered -> total_cte ->
--                 page_keys -> items_json -> unresolved). Run twice
--                 (first / second execution).
--     SECTION 3 — VERDICT rows that scan the captured plan text for
--                 Disk: / external merge / WindowAgg / Unique / temp usage,
--                 so the "did the spills go away" question is answered directly
--                 in the grid.
--
--   NOTE: the RPC is PL/pgSQL, so EXPLAIN of the function CALL cannot expose the
--   inner plan. This is why the ready-path SQL is mirrored here; the fingerprint
--   in Section 0 is what ties this SQL to the deployed body.
--
-- PARAMETERS (as requested): name_asc, catalog_status = all, no search,
--   no set_id / artist_id facets, limit 60, offset 0.
--
-- SAFETY: strictly read-only. No temp tables. No NOTICE. No writes. BEGIN /
--   ROLLBACK. Runs the plans under the authenticated JWT/RLS context of the
--   batch owner, so auth.uid() and the user_import_rows RLS parent-EXISTS policy
--   behave exactly as in production.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

set local statement_timeout = '120s';

set local "ol.batch_id" = '23a64249-0094-499a-8ebb-cf3802704168';

do $val$
declare
  v_out  jsonb := '[]'::jsonb;
  v_seq  bigint := 0;
  v_uid  uuid;
  r      record;
  i      int;
  v_src  text;

  v_lines_1 text := '';
  v_lines_2 text := '';

  -- OL-0D.2 ready-path equivalent, mirroring the DEPLOYED migration body.
  -- Fixed params: sort=name_asc, catalog_status=all, search=null,
  -- set_id=null, artist_id=null, limit=60, offset=0.
  -- No DISTINCT ON, no pricing::text, no row_number(), no direct joins to
  -- public.cards / public.card_extras. cards_effective is the catalog boundary.
  v_sql text := $q$
    with
    matched_agg as (
      select
        r.card_id,
        sum(r.quantity)::bigint  as quantity,
        count(*)::bigint         as source_row_count,
        min(r.source_row_number) as first_source_row
      from public.user_import_rows r
      where r.batch_id = current_setting('ol.batch_id')::uuid
        and r.match_status = 'matched'
        and r.card_id is not null
      group by r.card_id
    ),
    fallback_rows as (
      select
        ma.card_id, ma.quantity, ma.source_row_count, ma.first_source_row,
        fr.product_name, fr.set_name, fr.card_number, fr.variance, fr.rarity
      from matched_agg ma
      join public.user_import_rows fr
        on fr.batch_id = current_setting('ol.batch_id')::uuid
       and fr.source_row_number = ma.first_source_row
    ),
    item_keys as (
      select
        f.card_id,
        f.quantity,
        f.source_row_count,
        f.first_source_row,
        f.product_name,
        f.set_name,
        f.card_number,
        f.variance,
        f.rarity,
        (ce.id is not null)               as is_available,
        ce.name                           as cat_name,
        ce.set_id                         as cat_set_id,
        ce.set_name                       as cat_set_name,
        ce.local_id                       as cat_local_id,
        ce.illustrator                    as cat_illustrator,
        ce.artist_id                      as cat_artist_id,
        coalesce(ce.name, f.product_name) as eff_name,
        coalesce(ce.set_name, f.set_name) as eff_set
      from fallback_rows f
      left join public.cards_effective ce
        on ce.id = f.card_id
    ),
    item_stats as (
      select
        count(*)::bigint                                                   as distinct_cards,
        coalesce(sum(quantity), 0)::bigint                                 as matched_qty,
        count(*) filter (where not is_available)::bigint                   as missing_cards,
        coalesce(sum(quantity) filter (where not is_available), 0)::bigint as missing_qty
      from item_keys
    ),
    items_filtered as (
      select *
      from item_keys s
      where
        ( 'all' = 'all'
          or ('all' = 'available' and s.is_available)
          or ('all' = 'missing'   and not s.is_available) )
        and ( null::text is null )
        and ( null::text is null or s.cat_set_id    = null::text )
        and ( null::text is null or s.cat_artist_id = null::text )
    ),
    total_cte as (
      select count(*)::bigint as total from items_filtered
    ),
    page_keys as (
      select *
      from items_filtered f
      order by
        case when 'name_asc' = 'name_asc'      then f.eff_name end asc  nulls last,
        case when 'name_asc' = 'set_asc'       then f.eff_set  end asc  nulls last,
        case when 'name_asc' = 'quantity_desc' then f.quantity end desc nulls last,
        f.card_id asc
      limit 60
      offset 0
    ),
    items_json as (
      select
        coalesce(jsonb_agg(
          jsonb_build_object(
            'cardId',         pk.card_id,
            'quantity',       pk.quantity,
            'sourceRowCount', pk.source_row_count,
            'firstSourceRow', pk.first_source_row,
            'catalogStatus',  case when pk.is_available then 'available' else 'missing' end,
            'card', case when pk.is_available then
              jsonb_build_object(
                'id',                 ce.id,
                'name',               ce.name,
                'set_id',             ce.set_id,
                'set_name',           ce.set_name,
                'local_id',           ce.local_id,
                'illustrator',        ce.illustrator,
                'artist_id',          ce.artist_id,
                'image_url',          ce.image_url,
                'rarity',             ce.rarity,
                'release_date',       ce.release_date,
                'pricing',            ce.pricing,
                'pricing_updated_at', ce.pricing_updated_at
              )
            else null end,
            'fallback', jsonb_build_object(
              'productName', pk.product_name,
              'setName',     pk.set_name,
              'cardNumber',  pk.card_number,
              'variance',    pk.variance,
              'rarity',      pk.rarity
            )
          )
          order by
            case when 'name_asc' = 'name_asc'      then pk.eff_name end asc  nulls last,
            case when 'name_asc' = 'set_asc'       then pk.eff_set  end asc  nulls last,
            case when 'name_asc' = 'quantity_desc' then pk.quantity end desc nulls last,
            pk.card_id asc
        ), '[]'::jsonb) as items,
        count(*)::bigint as returned
      from page_keys pk
      left join public.cards_effective ce
        on ce.id = pk.card_id
    ),
    unresolved_groups as (
      select
        r.match_status          as status,
        r.match_reason          as reason,
        count(*)::bigint        as row_count,
        sum(r.quantity)::bigint as quantity
      from public.user_import_rows r
      where r.batch_id = current_setting('ol.batch_id')::uuid
        and r.match_status in ('ambiguous', 'unmatched', 'invalid')
      group by r.match_status, r.match_reason
    ),
    unresolved_json as (
      select
        coalesce(jsonb_agg(
          jsonb_build_object(
            'status',   status,
            'reason',   reason,
            'rowCount', row_count,
            'quantity', quantity
          )
          order by status asc, reason asc
        ), '[]'::jsonb) as groups,
        coalesce(sum(row_count), 0)::bigint as unresolved_rows,
        coalesce(sum(quantity),  0)::bigint as unresolved_quantity
      from unresolved_groups
    )
    select jsonb_build_object(
      'contractVersion', 1,
      'state', 'ready',
      'summary', jsonb_build_object(
        'matchedQuantity',        ist.matched_qty,
        'distinctCanonicalCards', ist.distinct_cards,
        'unresolvedRows',         ur.unresolved_rows,
        'unresolvedQuantity',     ur.unresolved_quantity,
        'catalogMissingCards',    ist.missing_cards,
        'catalogMissingQuantity', ist.missing_qty
      ),
      'unresolved', jsonb_build_object('groups', ur.groups),
      'page', jsonb_build_object(
        'limit', 60, 'offset', 0,
        'totalItems',    tc.total,
        'returnedItems', ij.returned,
        'items',         ij.items
      )
    )
    from item_stats ist
    cross join total_cte tc
    cross join items_json ij
    cross join unresolved_json ur
  $q$;

begin
  -- ─── owner / active-batch guard ──────────────────────────────────────────
  select user_id into v_uid
  from public.user_import_batches
  where id = current_setting('ol.batch_id')::uuid and status = 'active';
  if v_uid is null then
    raise exception 'postdeploy-plans: pinned batch % is not active', current_setting('ol.batch_id');
  end if;

  -- ═══ SECTION 0 — FINGERPRINT THE DEPLOYED FUNCTION BODY ══════════════════
  select pg_get_functiondef(oid) into v_src
  from pg_proc
  where proname = 'get_active_import_snapshot_read_model'
    and pronamespace = 'public'::regnamespace;

  -- pg_get_functiondef includes comments inside the function body. The deployed
  -- OL-0D.2 body legitimately documents the removed old constructs in full-line
  -- comments, so fingerprint the executable body by dropping full-line comments.
  select string_agg(line, E'\n')
  into v_src
  from regexp_split_to_table(v_src, E'\r?\n') as line
  where btrim(line) not like '--%';

  v_seq := v_seq + 1;
  v_out := v_out || jsonb_build_object('seq', v_seq, 'plan_no', 0,
    'plan_label', '0. deployed body fingerprint',
    'line_no', 1,
    'plan_line', 'DEPLOYED body contains "item_keys"      : ' ||
      (v_src ilike '%item_keys%')::text || '   [expect true]');

  v_seq := v_seq + 1;
  v_out := v_out || jsonb_build_object('seq', v_seq, 'plan_no', 0,
    'plan_label', '0. deployed body fingerprint', 'line_no', 2,
    'plan_line', 'DEPLOYED body contains "page_keys"      : ' ||
      (v_src ilike '%page_keys%')::text || '   [expect true]');

  v_seq := v_seq + 1;
  v_out := v_out || jsonb_build_object('seq', v_seq, 'plan_no', 0,
    'plan_label', '0. deployed body fingerprint', 'line_no', 3,
    'plan_line', 'DEPLOYED body contains "cards_effective": ' ||
      (v_src ilike '%cards_effective%')::text || '   [expect true]');

  v_seq := v_seq + 1;
  v_out := v_out || jsonb_build_object('seq', v_seq, 'plan_no', 0,
    'plan_label', '0. deployed body fingerprint', 'line_no', 4,
    'plan_line', 'DEPLOYED body contains "distinct on"   : ' ||
      (v_src ilike '%distinct on%')::text || '   [expect false]');

  v_seq := v_seq + 1;
  v_out := v_out || jsonb_build_object('seq', v_seq, 'plan_no', 0,
    'plan_label', '0. deployed body fingerprint', 'line_no', 5,
    'plan_line', 'DEPLOYED body contains "pricing::text" : ' ||
      (v_src ilike '%pricing::text%')::text || '   [expect false]');

  v_seq := v_seq + 1;
  v_out := v_out || jsonb_build_object('seq', v_seq, 'plan_no', 0,
    'plan_label', '0. deployed body fingerprint', 'line_no', 6,
    'plan_line', 'DEPLOYED body contains "row_number("   : ' ||
      (v_src ilike '%row_number(%')::text || '   [expect false]');

  v_seq := v_seq + 1;
  v_out := v_out || jsonb_build_object('seq', v_seq, 'plan_no', 0,
    'plan_label', '0. deployed body fingerprint', 'line_no', 7,
    'plan_line', 'DEPLOYED body contains "public.card_extras": ' ||
      (v_src ilike '%public.card_extras%')::text || '   [expect false]');

  v_seq := v_seq + 1;
  v_out := v_out || jsonb_build_object('seq', v_seq, 'plan_no', 0,
    'plan_label', '0. deployed body fingerprint', 'line_no', 8,
    'plan_line', 'VERDICT: OL-0D.2 IS DEPLOYED = ' ||
      (     v_src ilike '%item_keys%'
        and v_src ilike '%page_keys%'
        and v_src ilike '%cards_effective%'
        and v_src not ilike '%distinct on%'
        and v_src not ilike '%pricing::text%'
        and v_src not ilike '%row_number(%'
        and v_src not ilike '%public.card_extras%'
      )::text ||
      '   [if false: the migration did NOT apply — plans below are meaningless]');

  -- ─── authenticated JWT / RLS context ─────────────────────────────────────
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role', 'authenticated', 'aud', 'authenticated')::text,
    true);

  -- ═══ SECTION 1 — PLAN, FIRST EXECUTION ═══════════════════════════════════
  i := 0;
  set local role authenticated;
  for r in execute 'explain (analyze, buffers, verbose, settings, format text) ' || v_sql loop
    i := i + 1;
    v_lines_1 := v_lines_1 || r."QUERY PLAN" || E'\n';
    v_seq := v_seq + 1;
    v_out := v_out || jsonb_build_object('seq', v_seq, 'plan_no', 1,
      'plan_label', '1. OL-0D.2 ready path (first execution)',
      'line_no', i, 'plan_line', r."QUERY PLAN");
  end loop;
  reset role;

  -- ═══ SECTION 2 — PLAN, SECOND EXECUTION ══════════════════════════════════
  i := 0;
  set local role authenticated;
  for r in execute 'explain (analyze, buffers, verbose, settings, format text) ' || v_sql loop
    i := i + 1;
    v_lines_2 := v_lines_2 || r."QUERY PLAN" || E'\n';
    v_seq := v_seq + 1;
    v_out := v_out || jsonb_build_object('seq', v_seq, 'plan_no', 2,
      'plan_label', '2. OL-0D.2 ready path (second execution)',
      'line_no', i, 'plan_line', r."QUERY PLAN");
  end loop;
  reset role;

  -- ═══ SECTION 3 — VERDICTS: did the spills go away? ═══════════════════════
  v_seq := v_seq + 1;
  v_out := v_out || jsonb_build_object('seq', v_seq, 'plan_no', 3,
    'plan_label', '3. verdict', 'line_no', 1,
    'plan_line', 'DISK SPILL present (any "Disk:")      : ' ||
      (v_lines_1 ilike '%Disk:%' or v_lines_2 ilike '%Disk:%')::text ||
      '   [expect false — was 4208kB + 3104kB before]');

  v_seq := v_seq + 1;
  v_out := v_out || jsonb_build_object('seq', v_seq, 'plan_no', 3,
    'plan_label', '3. verdict', 'line_no', 2,
    'plan_line', 'external merge sort present           : ' ||
      (v_lines_1 ilike '%external merge%' or v_lines_2 ilike '%external merge%')::text ||
      '   [expect false]');

  v_seq := v_seq + 1;
  v_out := v_out || jsonb_build_object('seq', v_seq, 'plan_no', 3,
    'plan_label', '3. verdict', 'line_no', 3,
    'plan_line', 'WindowAgg present                     : ' ||
      (v_lines_1 ilike '%WindowAgg%' or v_lines_2 ilike '%WindowAgg%')::text ||
      '   [expect false — row_number() is gone]');

  v_seq := v_seq + 1;
  v_out := v_out || jsonb_build_object('seq', v_seq, 'plan_no', 3,
    'plan_label', '3. verdict', 'line_no', 4,
    'plan_line', 'temp read/written present             : ' ||
      (v_lines_1 ilike '%temp read%' or v_lines_1 ilike '%temp written%'
       or v_lines_2 ilike '%temp read%' or v_lines_2 ilike '%temp written%')::text ||
      '   [expect false]');

  v_seq := v_seq + 1;
  v_out := v_out || jsonb_build_object('seq', v_seq, 'plan_no', 3,
    'plan_label', '3. verdict', 'line_no', 5,
    'plan_line', 'top-N heapsort present                : ' ||
      (v_lines_1 ilike '%top-N heapsort%' or v_lines_2 ilike '%top-N heapsort%')::text ||
      '   [expect true — bounded page sort]');

  v_seq := v_seq + 1;
  v_out := v_out || jsonb_build_object('seq', v_seq, 'plan_no', 3,
    'plan_label', '3. verdict', 'line_no', 6,
    'plan_line', 'OVERALL: spills eliminated            : ' ||
      (not (v_lines_1 ilike '%Disk:%' or v_lines_2 ilike '%Disk:%'
            or v_lines_1 ilike '%external merge%' or v_lines_2 ilike '%external merge%'))::text ||
      '   [expect true]');

  perform set_config('ol.plan_output', v_out::text, true);
end
$val$;

-- ═══════════════════════════════════════════════════════════════════════════
-- FINAL (and only) result-returning statement.
-- ═══════════════════════════════════════════════════════════════════════════
select *
from jsonb_to_recordset(current_setting('ol.plan_output')::jsonb)
as x(
  seq        bigint,
  plan_no    int,
  plan_label text,
  line_no    int,
  plan_line  text
)
order by seq;

rollback;
