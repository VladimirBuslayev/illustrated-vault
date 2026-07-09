-- docs/sql/ol-0d-1-active-snapshot-read-model.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- OL-0D — Active Snapshot Read Model
--
-- One authenticated, read-only RPC that returns the caller's CURRENT active
-- Collectr import snapshot as a versioned JSON contract:
--
--   get_active_import_snapshot_read_model(...) returns jsonb
--
-- Properties:
--   - SECURITY INVOKER: runs as the caller; honors existing RLS directly.
--   - STABLE: reads only; no writes anywhere.
--   - fixed empty search_path; every object fully qualified (public.*, auth.*).
--   - auth.uid() internally; NO caller-supplied user id.
--   - Does NOT read, write, or reference user_collection.owned_keys, manual
--     overrides, intent, favorites, or binder state.
--
-- States: ready | no_active_batch | snapshot_changed (contractVersion = 1).
--
-- Aggregation happens BEFORE the catalog join. cards_effective is defensively
-- deduplicated to exactly one row per id (DISTINCT ON, latest pricing_updated_at
-- wins; see rule below) so a duplicate catalog id can never multiply quantity,
-- item count, source-row count, or pagination.
--
-- Purely additive. Does not modify OL-0B (user_import_batches/user_import_rows)
-- or any ownership behavior.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

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

  -- 5. optimistic-concurrency guard: the active snapshot changed under the caller
  --    (a newer import activated between pages). Report it; do not serve stale pages.
  if p_expected_batch_id is not null and p_expected_batch_id <> v_batch_id then
    return jsonb_build_object(
      'contractVersion', 1,
      'state', 'snapshot_changed',
      'activeBatchId', v_batch_id
    );
  end if;

  -- 6. FAIL-CLOSED reconciliation: the active batch header must agree exactly with
  --    its actual stored child rows. This mirrors the guarantee activate_import_batch
  --    enforced at activation; re-checking it here means the read model can never
  --    serve a summary that disagrees with the enumeration it paginates. A failure
  --    is a hard error (23514) — never downgraded to no_active_batch, snapshot_changed,
  --    or an empty ready payload.
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

  -- 7. build an escaped LITERAL search pattern: user-entered % and _ are literal,
  --    not wildcards. Escape backslash first, then % and _. Blank/whitespace = no search.
  if p_search is not null and length(btrim(p_search)) > 0 then
    v_search_pattern := '%' ||
      replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  -- 8. ready payload.
  with
  -- Canonical aggregation FIRST, over matched child rows only. Every stored row
  -- already has quantity > 0, so no new quantity interpretation is introduced.
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
  relevant_ids as (
    select distinct card_id from matched_agg
  ),
  -- Defensive dedup: exactly one deterministic catalog row per id.
  -- Rule: latest pricing_updated_at wins (current/latest timestamp), then
  -- release_date desc, then a stable full-row tie-break so the pick is total
  -- and reproducible even when every timestamp ties.
  dedup_catalog as (
    select distinct on (ce.id)
      ce.id, ce.name, ce.set_id, ce.set_name, ce.local_id,
      ce.illustrator, ce.artist_id, ce.image_url, ce.rarity,
      ce.release_date, ce.pricing, ce.pricing_updated_at
    from public.cards_effective ce
    join relevant_ids ri on ri.card_id = ce.id
    order by
      ce.id,
      ce.pricing_updated_at desc nulls last,
      ce.release_date       desc nulls last,
      ce.set_id             asc  nulls last,
      ce.local_id           asc  nulls last,
      ce.name               asc  nulls last,
      ce.illustrator        asc  nulls last,
      ce.artist_id          asc  nulls last,
      ce.image_url          asc  nulls last,
      ce.rarity             asc  nulls last,
      (ce.pricing::text)    asc  nulls last
  ),
  -- Deterministic fallback evidence = the contributing row with the lowest
  -- source_row_number. (batch_id, source_row_number) is unique, so this joins 1:1.
  fallback_rows as (
    select
      ma.card_id, ma.quantity, ma.source_row_count, ma.first_source_row,
      fr.product_name, fr.set_name, fr.card_number, fr.variance, fr.rarity
    from matched_agg ma
    join public.user_import_rows fr
      on fr.batch_id = v_batch_id
     and fr.source_row_number = ma.first_source_row
  ),
  -- One row per canonical card, LEFT JOINed to the deduped catalog (AFTER
  -- aggregation). Stale references (no current catalog row) are retained.
  items_status as (
    select
      f.card_id, f.quantity, f.source_row_count, f.first_source_row,
      f.product_name, f.set_name, f.card_number, f.variance, f.rarity,
      dc.id as cat_id, dc.name as cat_name, dc.set_id as cat_set_id,
      dc.set_name as cat_set_name, dc.local_id as cat_local_id,
      dc.illustrator as cat_illustrator, dc.artist_id as cat_artist_id,
      dc.image_url as cat_image_url, dc.rarity as cat_rarity,
      dc.release_date as cat_release_date, dc.pricing as cat_pricing,
      dc.pricing_updated_at as cat_pricing_updated_at,
      (dc.id is not null)               as is_available,
      coalesce(dc.name, f.product_name) as eff_name,
      coalesce(dc.set_name, f.set_name) as eff_set
    from fallback_rows f
    left join dedup_catalog dc on dc.id = f.card_id
  ),
  -- Whole-batch stats (unfiltered, unpaginated) for the summary block.
  item_stats as (
    select
      count(*)::bigint                                                  as distinct_cards,
      coalesce(sum(quantity), 0)::bigint                               as matched_qty,
      count(*) filter (where not is_available)::bigint                 as missing_cards,
      coalesce(sum(quantity) filter (where not is_available), 0)::bigint as missing_qty
    from items_status
  ),
  -- Filters apply to the grouped canonical result BEFORE pagination.
  -- Catalog fields drive available items; fallback evidence drives missing ones.
  -- set_id / artist_id are current-catalog only, so stale items never match them.
  items_filtered as (
    select *
    from items_status s
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
  -- Total-order ranking; every sort ends with card_id ASC as the final tie-break.
  ranked as (
    select f.*,
      row_number() over (
        order by
          case when p_sort = 'name_asc'      then f.eff_name end asc  nulls last,
          case when p_sort = 'set_asc'       then f.eff_set  end asc  nulls last,
          case when p_sort = 'quantity_desc' then f.quantity end desc nulls last,
          f.card_id asc
      ) as rn
    from items_filtered f
  ),
  total_cte as (
    select count(*)::bigint as total from items_filtered
  ),
  page_items as (
    select * from ranked
    where rn > p_offset and rn <= p_offset + p_limit
  ),
  items_json as (
    select
      coalesce(jsonb_agg(
        jsonb_build_object(
          'cardId',         pi.card_id,
          'quantity',       pi.quantity,
          'sourceRowCount', pi.source_row_count,
          'firstSourceRow', pi.first_source_row,
          'catalogStatus',  case when pi.is_available then 'available' else 'missing' end,
          'card', case when pi.is_available then
            jsonb_build_object(
              'id',                 pi.cat_id,
              'name',               pi.cat_name,
              'set_id',             pi.cat_set_id,
              'set_name',           pi.cat_set_name,
              'local_id',           pi.cat_local_id,
              'illustrator',        pi.cat_illustrator,
              'artist_id',          pi.cat_artist_id,
              'image_url',          pi.cat_image_url,
              'rarity',             pi.cat_rarity,
              'release_date',       pi.cat_release_date,
              'pricing',            pi.cat_pricing,
              'pricing_updated_at', pi.cat_pricing_updated_at
            )
          else null end,
          'fallback', jsonb_build_object(
            'productName', pi.product_name,
            'setName',     pi.set_name,
            'cardNumber',  pi.card_number,
            'variance',    pi.variance,
            'rarity',      pi.rarity
          )
        )
        order by pi.rn
      ), '[]'::jsonb) as items,
      count(*)::bigint as returned
    from page_items pi
  ),
  -- Unresolved = the three stored non-matched statuses, grouped by status+reason.
  -- (match_reason is guaranteed non-null for these by the OL-0B uir_status_shape.)
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
$$;

revoke all on function public.get_active_import_snapshot_read_model(uuid, integer, integer, text, text, text, text, text) from public;
grant execute on function public.get_active_import_snapshot_read_model(uuid, integer, integer, text, text, text, text, text) to authenticated;

commit;
