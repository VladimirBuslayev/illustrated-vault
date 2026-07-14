-- docs/sql/ol-0d-4-active-snapshot-performance-hardening.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- OL-0D.2 — Active Snapshot Read Model: performance hardening
--
-- Replaces the BODY of get_active_import_snapshot_read_model. Nothing else.
--
-- CONTRACT: UNCHANGED.
--   Same name, same 8-arg signature, same contractVersion 1, same states
--   (ready | no_active_batch | snapshot_changed), same JSON fields, same
--   deterministic ordering, same fail-closed reconciliation (23514), same
--   catalog-missing retention, same STABLE / SECURITY INVOKER / auth.uid()
--   scoping / RLS / empty search_path / grants. No writes.
--
-- CATALOG ABSTRACTION PRESERVED
--   Both catalog stages still read public.cards_effective. This migration does
--   NOT join public.cards / public.card_extras directly, so effective-catalog
--   semantics (including illustrator_override resolution) stay owned by the
--   view, now and in future, and no direct-table grant/RLS differences are
--   introduced.
--
-- WHAT CHANGES (2 internal changes, both evidence-driven):
--
--   (1) Global DISTINCT ON over cards_effective  ->  plain join to
--       cards_effective.
--       Runtime evidence (3A): cards_effective currently returns 23,604 rows /
--       23,604 distinct ids / 0 duplicate-id rows. It is presently one row per
--       id, so the defensive DISTINCT ON was selecting from single-row groups —
--       doing no dedup work while paying a 10-key sort that terminated in
--       (ce.pricing::text), which detoasts and serializes the jsonb for every
--       candidate row. That sort spilled to disk (Disk: 4208kB).
--       The join is now a plain join on ce.id, with no DISTINCT ON, no
--       pricing::text, and no sort in this step.
--       NOTE: this rests on the *measured* one-row-per-id property of the view.
--       ol-0d-4-candidate-validation.sql re-asserts it as a precondition; if it
--       ever ceases to hold, roll back (the dedup would become load-bearing).
--
--   (2) row_number() ranking over the whole result  ->  ORDER BY + LIMIT/OFFSET
--       on a NARROW key set, with the wide catalog payload fetched only for the
--       page (<= 100 rows).
--       The old shape forced a WindowAgg over every filtered row, and those rows
--       were wide: they carried pricing (jsonb), image_url, release_date and
--       pricing_updated_at through the sort. That sort also spilled
--       (Disk: 3104kB).
--       `rn` was never part of the contract — it was purely an internal
--       pagination device — so replacing it with ORDER BY + LIMIT/OFFSET is
--       contract-neutral. The ORDER BY expression is character-for-character the
--       same (including the final card_id ASC total-order tie-break), so page
--       composition and page order are identical.
--
-- WHY THIS IS THE FIX AND NOT JUST A SPEEDUP
--   Settled cost was never the problem (3A: 125–145 ms against an 8s ceiling).
--   The measured facts are:
--     - the planner's row estimates are materially below actual (~200 estimated
--       vs 4,767 actual) for the batch-scoped rows;
--     - work_mem is a FIXED per-operation ceiling (2184kB here) — it is not
--       derived from the estimate — and both of the wide sorts above exceed it
--       and spill to disk;
--     - both of those sorts are avoidable, per (1) and (2);
--     - post-import cache state, first-touch I/O and import-window contention
--       are a PLAUSIBLE amplifier of disk-based sorts.
--   The precise failing-window mechanism was NOT directly captured: production
--   is cancelled at the 8s ceiling and reports nothing further. Stale
--   statistics / autoanalyze timing is a hypothesis, NOT a proven cause.
--   What this migration does establish is that the query no longer performs
--   either avoidable spilling sort, which removes the largest known
--   I/O-amplifiable component of the ready path.
--
-- WHAT IS DELIBERATELY *NOT* DONE
--   - No index added. EXPLAIN already showed ID pushdown and pkey lookups;
--     uir_batch_status_idx and uir_unique_source_row serve every access path.
--   - No statement_timeout change (backstop only, if step E still fails).
--   - No importer / matcher / owned_keys / manual-override / frontend change.
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
$$;

-- Grants restated verbatim (CREATE OR REPLACE preserves them; restated so this
-- migration is self-contained and idempotent).
revoke all on function public.get_active_import_snapshot_read_model(uuid, integer, integer, text, text, text, text, text) from public;
grant execute on function public.get_active_import_snapshot_read_model(uuid, integer, integer, text, text, text, text, text) to authenticated;

commit;
