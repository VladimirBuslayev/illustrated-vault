-- docs/sql/ol-0d-4-candidate-validation-guc.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- OL-0D.2 — CANDIDATE VALIDATION (NO TEMP RELATIONS). Run BEFORE the migration.
--
-- WHY THIS REVISION
--   The previous harness failed with `42P01: relation "v_out" does not exist`
--   even with explicit drops, grants and pg_temp qualification. That is an
--   environment/temp-relation issue in the Supabase SQL editor — NOT an OL-0D.2
--   logic issue. This version removes temp relations ENTIRELY.
--
--   Everything (matrix, baseline outputs, candidate outputs, result rows) lives
--   in PL/pgSQL jsonb variables. Results are persisted to a transaction-local
--   GUC (ol.validation_output) and expanded by the single final SELECT.
--
-- FLOW
--   BEGIN
--     -> pin batch
--     -> ONE DO block:
--          * precondition (cards_effective one row per id)
--          * build matrix in memory
--          * PHASE 1: call the CURRENTLY DEPLOYED RPC across the matrix under the
--            authenticated JWT/RLS context; keep exact baseline jsonb in memory
--          * capture deployed metadata (volatility/secdef/proconfig/signature)
--          * CREATE OR REPLACE the production RPC with the CANDIDATE body
--            (executed inside this same transaction)
--          * PHASE 2: call the candidate across the same matrix; compare jsonb
--          * state / error / metadata / no-write checks
--          * set_config('ol.validation_output', <rows>::text, true)
--     -> final SELECT expands ol.validation_output
--   ROLLBACK   <- restores the currently deployed RPC. Nothing is kept.
--
-- SAFETY
--   The CREATE OR REPLACE is transactional and is undone by the ROLLBACK. No
--   production table data is written at any point. If the script is interrupted,
--   the transaction aborts and the deployed RPC is unchanged.
--   Do NOT change the trailing "rollback;" to "commit;" — that would deploy the
--   candidate without the gate. Use the migration file to deploy.
--
--   No temp tables. No temp sequences. No RAISE NOTICE. No helper function in
--   public. No intermediate result-returning SELECT.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

set local statement_timeout = '180s';

set local "ol.batch_id" = '23a64249-0094-499a-8ebb-cf3802704168';

do $val$
declare
  -- output accumulation (no relations)
  v_out    jsonb := '[]'::jsonb;
  v_seq    bigint := 0;

  -- in-memory matrix + payload stores
  v_matrix jsonb := '[]'::jsonb;
  v_base   jsonb := '{}'::jsonb;   -- case_id -> deployed payload
  v_cand   jsonb := '{}'::jsonb;   -- case_id -> candidate payload

  m        jsonb;
  e        jsonb;
  v        jsonb;
  v_bp     jsonb;
  v_cp     jsonb;

  v_uid     uuid;
  v_n       bigint;
  v_lastoff int;
  v_search  text;
  v_setid   text;
  v_artist  text;
  v_ce_rows bigint;
  v_ce_ids  bigint;

  -- deployed metadata (captured pre-DDL)
  d_vol  text; d_sec text; d_cfg text; d_args text;
  a_vol  text; a_sec text; a_cfg text; a_args text;

  v_b0 bigint; v_r0 bigint; v_b1 bigint; v_r1 bigint;

  v_t0 timestamptz;
  v_ms numeric;
  v_state text;
  v_same  boolean;
  v_exec  boolean;
begin
  -- ─── resolve owner / confirm active ──────────────────────────────────────
  select user_id into v_uid
  from public.user_import_batches
  where id = current_setting('ol.batch_id')::uuid and status = 'active';
  if v_uid is null then
    raise exception 'candidate-validation: pinned batch % is not active', current_setting('ol.batch_id');
  end if;

  -- ─── A. PRECONDITION: cards_effective is presently one row per id ────────
  select count(*), count(distinct id) into v_ce_rows, v_ce_ids
  from public.cards_effective;

  v_seq := v_seq + 1;
  v_out := v_out || jsonb_build_object(
    'seq', v_seq, 'section', 'A. precondition',
    'check_name', 'cards_effective is one row per id',
    'expected', v_ce_ids::text || ' distinct',
    'actual',   v_ce_rows::text || ' rows',
    'pass',     (v_ce_rows = v_ce_ids),
    'elapsed_ms', null,
    'notes', 'if FALSE the DISTINCT ON is load-bearing -> do NOT deploy OL-0D.2');

  -- ─── derive real filter values from the pinned batch ─────────────────────
  select count(distinct card_id) into v_n
  from public.user_import_rows
  where batch_id = current_setting('ol.batch_id')::uuid
    and match_status = 'matched' and card_id is not null;
  v_lastoff := greatest(v_n - 60, 0);

  select left(lower(substring(coalesce(product_name, '') from '[[:alnum:]]+')), 6)
    into v_search
  from public.user_import_rows
  where batch_id = current_setting('ol.batch_id')::uuid
    and match_status = 'matched'
    and length(coalesce(product_name, '')) > 0
  order by source_row_number
  limit 1;
  v_search := coalesce(nullif(v_search, ''), 'a');

  select ce.set_id into v_setid
  from public.user_import_rows r
  join public.cards_effective ce on ce.id = r.card_id
  where r.batch_id = current_setting('ol.batch_id')::uuid
    and r.match_status = 'matched'
    and ce.set_id is not null
  order by r.source_row_number
  limit 1;

  select ce.artist_id::text into v_artist
  from public.user_import_rows r
  join public.cards_effective ce on ce.id = r.card_id
  where r.batch_id = current_setting('ol.batch_id')::uuid
    and r.match_status = 'matched'
    and ce.artist_id is not null
  order by r.source_row_number
  limit 1;

  v_seq := v_seq + 1;
  v_out := v_out || jsonb_build_object(
    'seq', v_seq, 'section', 'A. precondition', 'check_name', 'derived filters',
    'expected', 'set_id non-null', 'actual', coalesce(v_setid, '(none)'),
    'pass', (v_setid is not null), 'elapsed_ms', null,
    'notes', 'search="' || v_search || '" set_id=' || coalesce(v_setid, 'NONE') ||
             ' artist_id=' || coalesce(v_artist, 'NONE') ||
             ' lastOffset=' || v_lastoff::text || ' distinctCards=' || v_n::text);

  -- ─── build the matrix IN MEMORY ──────────────────────────────────────────
  v_matrix :=
    jsonb_build_array(
      jsonb_build_object('id', 1,'label','name_asc, page 1',        'lim',60,'off',0,            'srch',null,    'setid',null,   'artistid',null,'cat','all',      'srt','name_asc',      'expect',null),
      jsonb_build_object('id', 2,'label','name_asc, page 2',        'lim',60,'off',60,           'srch',null,    'setid',null,   'artistid',null,'cat','all',      'srt','name_asc',      'expect',null),
      jsonb_build_object('id', 3,'label','set_asc, page 1',         'lim',60,'off',0,            'srch',null,    'setid',null,   'artistid',null,'cat','all',      'srt','set_asc',       'expect',null),
      jsonb_build_object('id', 4,'label','quantity_desc, page 1',   'lim',60,'off',0,            'srch',null,    'setid',null,   'artistid',null,'cat','all',      'srt','quantity_desc','expect',null),
      jsonb_build_object('id', 5,'label','catalog=available',       'lim',60,'off',0,            'srch',null,    'setid',null,   'artistid',null,'cat','available','srt','name_asc',      'expect',null),
      jsonb_build_object('id', 6,'label','catalog=missing',         'lim',60,'off',0,            'srch',null,    'setid',null,   'artistid',null,'cat','missing',  'srt','name_asc',      'expect',null),
      jsonb_build_object('id', 7,'label','search "'||v_search||'"', 'lim',60,'off',0,            'srch',v_search,'setid',null,   'artistid',null,'cat','all',      'srt','name_asc',      'expect',null),
      jsonb_build_object('id', 8,'label','search literal %',        'lim',60,'off',0,            'srch','%',     'setid',null,   'artistid',null,'cat','all',      'srt','name_asc',      'expect',null),
      jsonb_build_object('id', 9,'label','search literal _',        'lim',60,'off',0,            'srch','_',     'setid',null,   'artistid',null,'cat','all',      'srt','name_asc',      'expect',null),
      jsonb_build_object('id',10,'label','limit 1',                 'lim', 1,'off',0,            'srch',null,    'setid',null,   'artistid',null,'cat','all',      'srt','name_asc',      'expect',null),
      jsonb_build_object('id',11,'label','limit 100',               'lim',100,'off',0,           'srch',null,    'setid',null,   'artistid',null,'cat','all',      'srt','name_asc',      'expect',null),
      jsonb_build_object('id',12,'label','last page',               'lim',60,'off',v_lastoff,    'srch',null,    'setid',null,   'artistid',null,'cat','all',      'srt','name_asc',      'expect',null),
      jsonb_build_object('id',13,'label','offset past end',         'lim',60,'off',v_lastoff+500,'srch',null,    'setid',null,   'artistid',null,'cat','all',      'srt','name_asc',      'expect',null),
      jsonb_build_object('id',14,'label','set_id filter',           'lim',60,'off',0,            'srch',null,    'setid',v_setid,'artistid',null,'cat','all',      'srt','name_asc',      'expect',null),
      jsonb_build_object('id',16,'label','correct expected_batch_id','lim',60,'off',0,           'srch',null,    'setid',null,   'artistid',null,'cat','all',      'srt','name_asc',      'expect',current_setting('ol.batch_id'))
    );

  if v_artist is not null then
    v_matrix := v_matrix || jsonb_build_array(
      jsonb_build_object('id',15,'label','artist_id filter','lim',60,'off',0,'srch',null,
                         'setid',null,'artistid',v_artist,'cat','all','srt','name_asc','expect',null));
  else
    v_seq := v_seq + 1;
    v_out := v_out || jsonb_build_object(
      'seq', v_seq, 'section', 'B. equivalence', 'check_name', 'artist_id filter',
      'expected', 'covered', 'actual', 'SKIPPED', 'pass', true, 'elapsed_ms', null,
      'notes', 'no matched card in this batch has a non-null artist_id — explicitly skipped, not silently omitted');
  end if;

  -- ─── authenticated JWT / RLS context ─────────────────────────────────────
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role', 'authenticated', 'aud', 'authenticated')::text, true);

  -- ═══ PHASE 1 — BASELINE: the CURRENTLY DEPLOYED RPC ══════════════════════
  for m in select * from jsonb_array_elements(v_matrix) loop
    set local role authenticated;
    v := public.get_active_import_snapshot_read_model(
           (m->>'expect')::uuid,
           (m->>'lim')::int,
           (m->>'off')::int,
           m->>'srch',
           m->>'setid',
           m->>'artistid',
           m->>'cat',
           m->>'srt');
    reset role;
    v_base := v_base || jsonb_build_object(m->>'id', v);
  end loop;

  -- ─── capture DEPLOYED metadata (pre-DDL) ─────────────────────────────────
  select provolatile::text, prosecdef::text,
         coalesce(array_to_string(proconfig, ','), ''),
         pg_get_function_identity_arguments(oid)
    into d_vol, d_sec, d_cfg, d_args
  from pg_proc where proname = 'get_active_import_snapshot_read_model';

  -- ═══ APPLY THE CANDIDATE BODY, inside this transaction (undone by ROLLBACK)
  --     Byte-for-byte the body in ol-0d-4-active-snapshot-performance-hardening.sql.
  execute $ddl$
create or replace function public.get_active_import_snapshot_read_model(
  p_expected_batch_id uuid    default null,
  p_limit             integer default 60,
  p_offset            integer default 0,
  p_search            text    default null,
  p_set_id            text    default null,
  p_artist_id         text    default null,
  p_catalog_status    text    default 'all',
  p_sort              text    default 'name_asc'
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_uid            uuid := auth.uid();
  v_batch          public.user_import_batches%rowtype;
  v_batch_id       uuid;
  v_search_pattern text;
  v_result         jsonb;

  -- fail-closed reconciliation counters (actual child rows by status).
  v_c_total        bigint;
  v_c_matched      bigint;
  v_c_ambiguous    bigint;
  v_c_unmatched    bigint;
  v_c_invalid      bigint;
begin
  -- 1. authentication is mandatory (never converted into empty results).
  if v_uid is null then
    raise exception 'get_active_import_snapshot_read_model: not authenticated'
      using errcode = '28000';
  end if;

  -- 2. argument validation — invalid input is a hard error, never a silent fallback.
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'get_active_import_snapshot_read_model: p_limit must be between 1 and 100 (got %)', p_limit
      using errcode = '22023';
  end if;
  if p_offset is null or p_offset < 0 then
    raise exception 'get_active_import_snapshot_read_model: p_offset must be >= 0 (got %)', p_offset
      using errcode = '22023';
  end if;
  if p_catalog_status is null or p_catalog_status not in ('all', 'available', 'missing') then
    raise exception 'get_active_import_snapshot_read_model: p_catalog_status must be all|available|missing (got %)', p_catalog_status
      using errcode = '22023';
  end if;
  if p_sort is null or p_sort not in ('name_asc', 'set_asc', 'quantity_desc') then
    raise exception 'get_active_import_snapshot_read_model: p_sort must be name_asc|set_asc|quantity_desc (got %)', p_sort
      using errcode = '22023';
  end if;

  -- 3. resolve the caller's active batch. The partial unique index
  --    uib_one_active_per_user guarantees at most one row here.
  select * into v_batch
  from public.user_import_batches
  where user_id = v_uid
    and status = 'active';

  -- 4. no active batch → typed state, regardless of p_expected_batch_id.
  if not found then
    return jsonb_build_object(
      'contractVersion', 1,
      'state', 'no_active_batch'
    );
  end if;

  v_batch_id := v_batch.id;

  -- 5. optimistic-concurrency guard: the active snapshot changed under the caller.
  if p_expected_batch_id is not null and p_expected_batch_id <> v_batch_id then
    return jsonb_build_object(
      'contractVersion', 1,
      'state', 'snapshot_changed',
      'activeBatchId', v_batch_id
    );
  end if;

  -- 6. FAIL-CLOSED reconciliation (unchanged; still errcode 23514).
  select
    count(*),
    count(*) filter (where match_status = 'matched'),
    count(*) filter (where match_status = 'ambiguous'),
    count(*) filter (where match_status = 'unmatched'),
    count(*) filter (where match_status = 'invalid')
  into v_c_total, v_c_matched, v_c_ambiguous, v_c_unmatched, v_c_invalid
  from public.user_import_rows
  where batch_id = v_batch_id;

  if v_c_total     <> v_batch.stored_rows
     or v_c_matched   <> v_batch.matched_rows
     or v_c_ambiguous <> v_batch.ambiguous_rows
     or v_c_unmatched <> v_batch.unmatched_rows
     or v_c_invalid   <> v_batch.invalid_rows then
    raise exception
      'get_active_import_snapshot_read_model: reconciliation failure for active batch % — child stored/matched/ambiguous/unmatched/invalid = %/%/%/%/% but header declares %/%/%/%/%',
      v_batch_id,
      v_c_total, v_c_matched, v_c_ambiguous, v_c_unmatched, v_c_invalid,
      v_batch.stored_rows, v_batch.matched_rows, v_batch.ambiguous_rows, v_batch.unmatched_rows, v_batch.invalid_rows
      using errcode = '23514';
  end if;

  -- 7. escaped LITERAL search pattern (unchanged).
  if p_search is not null and length(btrim(p_search)) > 0 then
    v_search_pattern := '%' ||
      replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  -- 8. ready payload.
  with
  -- Canonical aggregation FIRST, over matched child rows only (unchanged).
  matched_agg as (
    select
      r.card_id,
      sum(r.quantity)::bigint  as quantity,
      count(*)::bigint         as source_row_count,
      min(r.source_row_number) as first_source_row
    from public.user_import_rows r
    where r.batch_id = v_batch_id
      and r.match_status = 'matched'
      and r.card_id is not null
    group by r.card_id
  ),
  -- Deterministic fallback evidence = the contributing row with the lowest
  -- source_row_number. (batch_id, source_row_number) is unique → joins 1:1.
  fallback_rows as (
    select
      ma.card_id, ma.quantity, ma.source_row_count, ma.first_source_row,
      fr.product_name, fr.set_name, fr.card_number, fr.variance, fr.rarity
    from matched_agg ma
    join public.user_import_rows fr
      on fr.batch_id = v_batch_id
     and fr.source_row_number = ma.first_source_row
  ),
  -- OL-0D.2: NARROW key set. One row per canonical card, LEFT JOINed to the
  -- effective catalog VIEW (not the base tables). Plain join on ce.id: no
  -- DISTINCT ON, no pricing::text, no sort. Stale references (no catalog row)
  -- are retained via LEFT JOIN, exactly as before.
  --
  -- Only the columns needed for summary, filtering and ordering are carried
  -- here. pricing / image_url / release_date / pricing_updated_at are NOT —
  -- they are fetched later, for page rows only.
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
  -- Whole-batch stats (unfiltered, unpaginated) for the summary block.
  item_stats as (
    select
      count(*)::bigint                                                   as distinct_cards,
      coalesce(sum(quantity), 0)::bigint                                 as matched_qty,
      count(*) filter (where not is_available)::bigint                   as missing_cards,
      coalesce(sum(quantity) filter (where not is_available), 0)::bigint as missing_qty
    from item_keys
  ),
  -- Filters apply to the grouped canonical result BEFORE pagination (unchanged
  -- predicates, evaluated over the narrow key set).
  items_filtered as (
    select *
    from item_keys s
    where
      ( p_catalog_status = 'all'
        or (p_catalog_status = 'available' and s.is_available)
        or (p_catalog_status = 'missing'   and not s.is_available) )
      and ( v_search_pattern is null
        or coalesce(s.cat_name, '')        ilike v_search_pattern escape '\'
        or coalesce(s.cat_set_name, '')    ilike v_search_pattern escape '\'
        or coalesce(s.cat_local_id, '')    ilike v_search_pattern escape '\'
        or coalesce(s.cat_illustrator, '') ilike v_search_pattern escape '\'
        or ( not s.is_available and (
                 s.product_name ilike v_search_pattern escape '\'
              or s.set_name     ilike v_search_pattern escape '\'
              or s.card_number  ilike v_search_pattern escape '\'
        )) )
      and ( p_set_id    is null or s.cat_set_id    = p_set_id )
      and ( p_artist_id is null or s.cat_artist_id = p_artist_id )
  ),
  total_cte as (
    select count(*)::bigint as total from items_filtered
  ),
  -- OL-0D.2: pagination by ORDER BY + LIMIT/OFFSET over the NARROW rows,
  -- instead of row_number() over the whole (wide) result. The ORDER BY is
  -- identical to the old row_number() ORDER BY, ending in card_id ASC — a total
  -- order (card_id is unique per row here) — so the page boundary and the page
  -- contents are deterministic and unchanged. `rn` was internal only.
  page_keys as (
    select *
    from items_filtered f
    order by
      case when p_sort = 'name_asc'      then f.eff_name end asc  nulls last,
      case when p_sort = 'set_asc'       then f.eff_set  end asc  nulls last,
      case when p_sort = 'quantity_desc' then f.quantity end desc nulls last,
      f.card_id asc
    limit p_limit
    offset p_offset
  ),
  -- OL-0D.2: the WIDE catalog payload is fetched HERE, for page rows only
  -- (<= p_limit <= 100), from the SAME view. Same columns, same semantics as
  -- before, so the emitted card object is identical to what the old
  -- cards_effective/DISTINCT ON path produced.
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
          case when p_sort = 'name_asc'      then pk.eff_name end asc  nulls last,
          case when p_sort = 'set_asc'       then pk.eff_set  end asc  nulls last,
          case when p_sort = 'quantity_desc' then pk.quantity end desc nulls last,
          pk.card_id asc
      ), '[]'::jsonb) as items,
      count(*)::bigint as returned
    from page_keys pk
    left join public.cards_effective ce
      on ce.id = pk.card_id
  ),
  -- Unresolved grouping (unchanged).
  unresolved_groups as (
    select
      r.match_status          as status,
      r.match_reason          as reason,
      count(*)::bigint        as row_count,
      sum(r.quantity)::bigint as quantity
    from public.user_import_rows r
    where r.batch_id = v_batch_id
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
    'batch', jsonb_build_object(
      'id',             v_batch.id,
      'source',         v_batch.source,
      'matcherVersion', v_batch.matcher_version,
      'createdAt',      v_batch.created_at,
      'activatedAt',    v_batch.activated_at
    ),
    'summary', jsonb_build_object(
      'totalSourceRows',        v_batch.total_source_rows,
      'pokemonRows',            v_batch.pokemon_rows,
      'positiveQuantityRows',   v_batch.positive_qty_rows,
      'storedRows',             v_batch.stored_rows,
      'matchedRows',            v_batch.matched_rows,
      'ambiguousRows',          v_batch.ambiguous_rows,
      'unmatchedRows',          v_batch.unmatched_rows,
      'invalidRows',            v_batch.invalid_rows,
      'watchlistOnlyRows',      v_batch.watchlist_only_rows,
      'nonPokemonRows',         v_batch.non_pokemon_rows,
      'invalidQuantityRows',    v_batch.invalid_quantity_rows,
      'matchedQuantity',        ist.matched_qty,
      'distinctCanonicalCards', ist.distinct_cards,
      'unresolvedRows',         ur.unresolved_rows,
      'unresolvedQuantity',     ur.unresolved_quantity,
      'catalogMissingCards',    ist.missing_cards,
      'catalogMissingQuantity', ist.missing_qty
    ),
    'unresolved', jsonb_build_object('groups', ur.groups),
    'page', jsonb_build_object(
      'limit',         p_limit,
      'offset',        p_offset,
      'totalItems',    tc.total,
      'returnedItems', ij.returned,
      'items',         ij.items
    )
  )
  into v_result
  from item_stats ist
  cross join total_cte tc
  cross join items_json ij
  cross join unresolved_json ur;

  return v_result;
end;
$$;  $ddl$;

  -- ═══ PHASE 2 — CANDIDATE across the same matrix ══════════════════════════
  for m in select * from jsonb_array_elements(v_matrix) loop
    set local role authenticated;
    v_t0 := clock_timestamp();
    v := public.get_active_import_snapshot_read_model(
           (m->>'expect')::uuid,
           (m->>'lim')::int,
           (m->>'off')::int,
           m->>'srch',
           m->>'setid',
           m->>'artistid',
           m->>'cat',
           m->>'srt');
    v_ms := round(1000 * extract(epoch from clock_timestamp() - v_t0), 1);
    reset role;
    v_cand := v_cand || jsonb_build_object(m->>'id', v);

    v_bp := v_base -> (m->>'id');
    v_cp := v;
    v_same := (v_bp = v_cp);

    v_seq := v_seq + 1;
    v_out := v_out || jsonb_build_object(
      'seq', v_seq, 'section', 'B. equivalence',
      'check_name', m->>'label',
      'expected', 'deployed == candidate',
      'actual', case when v_same then 'identical' else 'DIFFERENT' end,
      'pass', v_same,
      'elapsed_ms', v_ms,
      'notes', 'state=' || coalesce(v_cp->>'state', '?') ||
               ' totalItems=' || coalesce(v_cp->'page'->>'totalItems', '-') ||
               ' returned='   || coalesce(v_cp->'page'->>'returnedItems', '-'));
  end loop;

  -- ═══ C. STATES — ready / snapshot_changed / no_active_batch ══════════════
  set local role authenticated;
  v := public.get_active_import_snapshot_read_model();
  reset role;
  v_seq := v_seq + 1;
  v_out := v_out || jsonb_build_object(
    'seq', v_seq, 'section', 'C. states', 'check_name', 'ready',
    'expected', 'ready', 'actual', v->>'state', 'pass', (v->>'state' = 'ready'),
    'elapsed_ms', null, 'notes', null);

  set local role authenticated;
  v := public.get_active_import_snapshot_read_model(
         p_expected_batch_id => '00000000-0000-0000-0000-000000000000'::uuid);
  reset role;
  v_seq := v_seq + 1;
  v_out := v_out || jsonb_build_object(
    'seq', v_seq, 'section', 'C. states', 'check_name', 'snapshot_changed (stale expected id)',
    'expected', 'snapshot_changed', 'actual', v->>'state',
    'pass', (v->>'state' = 'snapshot_changed'), 'elapsed_ms', null,
    'notes', 'activeBatchId=' || coalesce(v->>'activeBatchId', '?'));

  -- a user with no active batch
  perform set_config('request.jwt.claims',
    json_build_object('sub', '11111111-1111-1111-1111-111111111111',
                      'role', 'authenticated', 'aud', 'authenticated')::text, true);
  set local role authenticated;
  v := public.get_active_import_snapshot_read_model();
  reset role;
  v_seq := v_seq + 1;
  v_out := v_out || jsonb_build_object(
    'seq', v_seq, 'section', 'C. states', 'check_name', 'no_active_batch',
    'expected', 'no_active_batch', 'actual', v->>'state',
    'pass', (v->>'state' = 'no_active_batch'), 'elapsed_ms', null, 'notes', null);

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role', 'authenticated', 'aud', 'authenticated')::text, true);

  -- ═══ D. FAIL-CLOSED — 22023 argument validation ══════════════════════════
  for e in select * from jsonb_array_elements(jsonb_build_array(
      jsonb_build_object('label','p_limit = 0',           'lim',0,   'off',0,   'cat','all',  'srt','name_asc'),
      jsonb_build_object('label','p_limit = 101',         'lim',101, 'off',0,   'cat','all',  'srt','name_asc'),
      jsonb_build_object('label','p_limit = null',        'lim',null,'off',0,   'cat','all',  'srt','name_asc'),
      jsonb_build_object('label','p_offset = -1',         'lim',60,  'off',-1,  'cat','all',  'srt','name_asc'),
      jsonb_build_object('label','p_offset = null',       'lim',60,  'off',null,'cat','all',  'srt','name_asc'),
      jsonb_build_object('label','bad p_catalog_status',  'lim',60,  'off',0,   'cat','bogus','srt','name_asc'),
      jsonb_build_object('label','null p_catalog_status', 'lim',60,  'off',0,   'cat',null,   'srt','name_asc'),
      jsonb_build_object('label','bad p_sort',            'lim',60,  'off',0,   'cat','all',  'srt','bogus'),
      jsonb_build_object('label','null p_sort',           'lim',60,  'off',0,   'cat','all',  'srt',null)
    )) loop
    begin
      set local role authenticated;
      v := public.get_active_import_snapshot_read_model(
             null, (e->>'lim')::int, (e->>'off')::int, null, null, null, e->>'cat', e->>'srt');
      reset role;
      v_state := 'no error';
    exception when others then
      v_state := sqlstate;
      begin
        reset role;
      exception when others then
        null;
      end;
    end;

    v_seq := v_seq + 1;
    v_out := v_out || jsonb_build_object(
      'seq', v_seq, 'section', 'D. fail-closed', 'check_name', e->>'label',
      'expected', '22023', 'actual', v_state, 'pass', (v_state = '22023'),
      'elapsed_ms', null, 'notes', null);
  end loop;

  -- ═══ D. FAIL-CLOSED — 28000 unauthenticated ══════════════════════════════
  begin
    perform set_config('request.jwt.claims', '', true);
    set local role authenticated;
    v := public.get_active_import_snapshot_read_model();
    reset role;
    v_state := 'no error';
  exception when others then
    v_state := sqlstate;
    begin
      reset role;
    exception when others then
      null;
    end;
  end;

  v_seq := v_seq + 1;
  v_out := v_out || jsonb_build_object(
    'seq', v_seq, 'section', 'D. fail-closed', 'check_name', 'unauthenticated',
    'expected', '28000', 'actual', v_state, 'pass', (v_state = '28000'),
    'elapsed_ms', null, 'notes', 'auth.uid() null under role authenticated');

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role', 'authenticated', 'aud', 'authenticated')::text, true);

  -- ═══ E. METADATA / SURFACE unchanged ═════════════════════════════════════
  select provolatile::text, prosecdef::text,
         coalesce(array_to_string(proconfig, ','), ''),
         pg_get_function_identity_arguments(oid)
    into a_vol, a_sec, a_cfg, a_args
  from pg_proc where proname = 'get_active_import_snapshot_read_model';

  v_exec := has_function_privilege('authenticated',
    'public.get_active_import_snapshot_read_model(uuid,integer,integer,text,text,text,text,text)',
    'EXECUTE');

  v_seq := v_seq + 1;
  v_out := v_out || jsonb_build_object(
    'seq', v_seq, 'section', 'E. surface', 'check_name', 'volatility unchanged (STABLE)',
    'expected', d_vol, 'actual', a_vol, 'pass', (a_vol = d_vol),
    'elapsed_ms', null, 'notes', 's = STABLE');

  v_seq := v_seq + 1;
  v_out := v_out || jsonb_build_object(
    'seq', v_seq, 'section', 'E. surface', 'check_name', 'SECURITY INVOKER unchanged',
    'expected', d_sec, 'actual', a_sec, 'pass', (a_sec = d_sec),
    'elapsed_ms', null, 'notes', 'false = SECURITY INVOKER');

  v_seq := v_seq + 1;
  v_out := v_out || jsonb_build_object(
    'seq', v_seq, 'section', 'E. surface', 'check_name', 'proconfig (search_path) unchanged',
    'expected', d_cfg, 'actual', a_cfg, 'pass', (a_cfg = d_cfg),
    'elapsed_ms', null, 'notes', null);

  v_seq := v_seq + 1;
  v_out := v_out || jsonb_build_object(
    'seq', v_seq, 'section', 'E. surface', 'check_name', 'signature unchanged',
    'expected', d_args, 'actual', a_args, 'pass', (a_args = d_args),
    'elapsed_ms', null, 'notes', null);

  v_seq := v_seq + 1;
  v_out := v_out || jsonb_build_object(
    'seq', v_seq, 'section', 'E. surface', 'check_name', 'authenticated retains EXECUTE',
    'expected', 'true', 'actual', v_exec::text, 'pass', v_exec,
    'elapsed_ms', null, 'notes', null);

  -- ═══ F. NO WRITE EFFECTS ═════════════════════════════════════════════════
  select count(*) into v_b0 from public.user_import_batches;
  select count(*) into v_r0 from public.user_import_rows;

  set local role authenticated;
  v := public.get_active_import_snapshot_read_model(p_limit => 100, p_offset => 0);
  reset role;

  select count(*) into v_b1 from public.user_import_batches;
  select count(*) into v_r1 from public.user_import_rows;

  v_seq := v_seq + 1;
  v_out := v_out || jsonb_build_object(
    'seq', v_seq, 'section', 'F. no writes', 'check_name', 'user_import_batches count unchanged',
    'expected', v_b0::text, 'actual', v_b1::text, 'pass', (v_b0 = v_b1),
    'elapsed_ms', null, 'notes', null);

  v_seq := v_seq + 1;
  v_out := v_out || jsonb_build_object(
    'seq', v_seq, 'section', 'F. no writes', 'check_name', 'user_import_rows count unchanged',
    'expected', v_r0::text, 'actual', v_r1::text, 'pass', (v_r0 = v_r1),
    'elapsed_ms', null, 'notes', null);

  -- ═══ SUMMARY ═════════════════════════════════════════════════════════════
  v_seq := v_seq + 1;
  v_out := v_out || jsonb_build_object(
    'seq', v_seq, 'section', 'ZZ. SUMMARY', 'check_name', 'all checks passed',
    'expected', (select count(*) from jsonb_array_elements(v_out))::text || ' checks',
    'actual',   (select count(*) from jsonb_array_elements(v_out) x
                  where (x->>'pass')::boolean)::text || ' passed',
    'pass', (select count(*) = count(*) filter (where (x->>'pass')::boolean)
               from jsonb_array_elements(v_out) x),
    'elapsed_ms', null,
    'notes', case when (select count(*) = count(*) filter (where (x->>'pass')::boolean)
                          from jsonb_array_elements(v_out) x)
                  then 'CANDIDATE VALIDATED — safe to apply ol-0d-4-active-snapshot-performance-hardening.sql'
                  else 'FAILURES PRESENT — DO NOT DEPLOY' end);

  -- persist the result rows for the final SELECT
  perform set_config('ol.validation_output', v_out::text, true);
end
$val$;

-- ═══════════════════════════════════════════════════════════════════════════
-- FINAL (and only) result-returning statement.
-- ═══════════════════════════════════════════════════════════════════════════
select *
from jsonb_to_recordset(current_setting('ol.validation_output')::jsonb)
as x(
  seq        bigint,
  section    text,
  check_name text,
  expected   text,
  actual     text,
  pass       boolean,
  elapsed_ms numeric,
  notes      text
)
order by seq;

-- Restores the currently deployed RPC. Do NOT change this to commit.
rollback;
