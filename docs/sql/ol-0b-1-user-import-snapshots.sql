begin;

-- ═══════════════════════════════════════════════════════════════════════════
-- OL-0B — Immutable Collectr import snapshot model
--
-- Creates:
--   - user_import_batches
--   - user_import_rows
--   - uir_guard_insert() concurrency trigger function
--   - uir_before_insert_guard trigger
--   - activate_import_batch()
--   - fail_import_batch()
--
-- Purely additive.
-- Does not modify owned_keys, user_collection, card_overrides,
-- or any existing ownership behavior.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Parent: import batches ───────────────────────────────────────────────────

create table public.user_import_batches (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null
    references auth.users(id)
    on delete cascade,

  source text not null default 'collectr'
    constraint uib_source_known
    check (source in ('collectr')),

  status text not null default 'processing'
    constraint uib_status_known
    check (
      status in (
        'processing',
        'active',
        'failed',
        'superseded'
      )
    ),

  matcher_version text not null,

  total_source_rows integer not null
    check (total_source_rows >= 0),

  pokemon_rows integer not null
    check (pokemon_rows >= 0),

  positive_qty_rows integer not null
    check (positive_qty_rows >= 0),

  stored_rows integer not null
    check (stored_rows >= 0),

  matched_rows integer not null
    check (matched_rows >= 0),

  ambiguous_rows integer not null
    check (ambiguous_rows >= 0),

  unmatched_rows integer not null
    check (unmatched_rows >= 0),

  invalid_rows integer not null
    check (invalid_rows >= 0),

  watchlist_only_rows integer not null
    check (watchlist_only_rows >= 0),

  non_pokemon_rows integer not null
    check (non_pokemon_rows >= 0),

  invalid_quantity_rows integer not null
    check (invalid_quantity_rows >= 0),

  created_at timestamptz not null default now(),

  activated_at timestamptz,

  superseded_at timestamptz,

  constraint uib_eq_total
    check (
      total_source_rows
        = pokemon_rows + non_pokemon_rows
    ),

  constraint uib_eq_pokemon
    check (
      pokemon_rows
        = positive_qty_rows
        + watchlist_only_rows
        + invalid_quantity_rows
    ),

  constraint uib_eq_stored_is_positive_qty
    check (
      stored_rows = positive_qty_rows
    ),

  constraint uib_eq_stored_breakdown
    check (
      stored_rows
        = matched_rows
        + ambiguous_rows
        + unmatched_rows
        + invalid_rows
    ),

  constraint uib_lifecycle_coherent
    check (
      (
        status = 'processing'
        and activated_at is null
        and superseded_at is null
      )
      or
      (
        status = 'failed'
        and activated_at is null
        and superseded_at is null
      )
      or
      (
        status = 'active'
        and activated_at is not null
        and superseded_at is null
      )
      or
      (
        status = 'superseded'
        and activated_at is not null
        and superseded_at is not null
      )
    ),

  constraint uib_ts_activated_after_created
    check (
      activated_at is null
      or activated_at >= created_at
    ),

  constraint uib_ts_superseded_after_activated
    check (
      superseded_at is null
      or activated_at is null
      or superseded_at >= activated_at
    )
);

create unique index uib_one_active_per_user
  on public.user_import_batches(user_id)
  where status = 'active';

create index uib_user_created_idx
  on public.user_import_batches(
    user_id,
    created_at desc
  );

-- ── Child: immutable import evidence rows ────────────────────────────────────

create table public.user_import_rows (
  id uuid primary key default gen_random_uuid(),

  batch_id uuid not null
    references public.user_import_batches(id)
    on delete cascade,

  source_row_number integer not null
    check (source_row_number > 0),

  product_name text not null default '',

  set_name text not null default '',

  card_number text not null default '',

  variance text not null default '',

  rarity text not null default '',

  quantity integer not null
    check (quantity > 0),

  card_id text,

  match_status text not null
    constraint uir_status_known
    check (
      match_status in (
        'matched',
        'ambiguous',
        'unmatched',
        'invalid'
      )
    ),

  match_rule text,

  match_reason text,

  candidate_card_ids text[],

  created_at timestamptz not null default now(),

  constraint uir_unique_source_row
    unique (
      batch_id,
      source_row_number
    ),

  constraint uir_status_shape
    check (
      (
        match_status = 'matched'
        and card_id is not null
        and match_rule is not null
        and match_reason is null
      )
      or
      (
        match_status in (
          'ambiguous',
          'unmatched',
          'invalid'
        )
        and card_id is null
        and match_rule is null
        and match_reason is not null
      )
    ),

  constraint uir_candidates_shape
    check (
      candidate_card_ids is null
      or
      (
        match_status = 'ambiguous'
        and cardinality(candidate_card_ids) between 1 and 6
        and array_position(candidate_card_ids, null) is null
      )
    )
);

create index uir_batch_status_idx
  on public.user_import_rows(
    batch_id,
    match_status
  );

create index uir_card_id_idx
  on public.user_import_rows(card_id)
  where card_id is not null;

-- ── Row-level security ───────────────────────────────────────────────────────

alter table public.user_import_batches
  enable row level security;

alter table public.user_import_rows
  enable row level security;

create policy "uib_select_own"
on public.user_import_batches
for select
using (
  auth.uid() = user_id
);

create policy "uib_insert_processing_only"
on public.user_import_batches
for insert
with check (
  auth.uid() = user_id
  and status = 'processing'
  and activated_at is null
  and superseded_at is null
);

create policy "uib_delete_own_nonactive"
on public.user_import_batches
for delete
using (
  auth.uid() = user_id
  and status <> 'active'
);

create policy "uir_select_own"
on public.user_import_rows
for select
using (
  exists (
    select 1
    from public.user_import_batches b
    where b.id = user_import_rows.batch_id
      and b.user_id = auth.uid()
  )
);

create policy "uir_insert_processing_parent"
on public.user_import_rows
for insert
with check (
  exists (
    select 1
    from public.user_import_batches b
    where b.id = user_import_rows.batch_id
      and b.user_id = auth.uid()
      and b.status = 'processing'
  )
);

grant select, insert, delete
  on public.user_import_batches
  to authenticated;

grant select, insert
  on public.user_import_rows
  to authenticated;

-- ── Child-insert serialization guard ─────────────────────────────────────────

create or replace function public.uir_guard_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if auth.uid() is null then
    raise exception
      'user_import_rows insert: not authenticated';
  end if;

  select b.status
  into v_status
  from public.user_import_batches b
  where b.id = new.batch_id
    and b.user_id = auth.uid()
  for update;

  if not found then
    raise exception
      'user_import_rows insert: batch % not found or not owned',
      new.batch_id;
  end if;

  if v_status <> 'processing' then
    raise exception
      'user_import_rows insert: batch % is %, expected processing',
      new.batch_id,
      v_status;
  end if;

  return new;
end;
$$;

revoke all
  on function public.uir_guard_insert()
  from public, authenticated;

create trigger uir_before_insert_guard
before insert on public.user_import_rows
for each row
execute function public.uir_guard_insert();

-- ── Atomic activation ────────────────────────────────────────────────────────

create or replace function public.activate_import_batch(
  p_batch_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch public.user_import_batches%rowtype;

  v_total integer;
  v_matched integer;
  v_ambiguous integer;
  v_unmatched integer;
  v_invalid integer;
begin
  if auth.uid() is null then
    raise exception
      'activate_import_batch: not authenticated';
  end if;

  select *
  into v_batch
  from public.user_import_batches
  where id = p_batch_id
    and user_id = auth.uid()
  for update;

  if not found then
    raise exception
      'activate_import_batch: batch % not found or not owned',
      p_batch_id;
  end if;

  if v_batch.status <> 'processing' then
    raise exception
      'activate_import_batch: batch % is %, expected processing',
      p_batch_id,
      v_batch.status;
  end if;

  select
    count(*),
    count(*) filter (
      where match_status = 'matched'
    ),
    count(*) filter (
      where match_status = 'ambiguous'
    ),
    count(*) filter (
      where match_status = 'unmatched'
    ),
    count(*) filter (
      where match_status = 'invalid'
    )
  into
    v_total,
    v_matched,
    v_ambiguous,
    v_unmatched,
    v_invalid
  from public.user_import_rows
  where batch_id = p_batch_id;

  if v_total <> v_batch.stored_rows then
    raise exception
      'activate_import_batch: % rows stored, batch declares %',
      v_total,
      v_batch.stored_rows;
  end if;

  if v_matched <> v_batch.matched_rows
     or v_ambiguous <> v_batch.ambiguous_rows
     or v_unmatched <> v_batch.unmatched_rows
     or v_invalid <> v_batch.invalid_rows then
    raise exception
      'activate_import_batch: row status counts (m%,a%,u%,i%) disagree with batch (m%,a%,u%,i%)',
      v_matched,
      v_ambiguous,
      v_unmatched,
      v_invalid,
      v_batch.matched_rows,
      v_batch.ambiguous_rows,
      v_batch.unmatched_rows,
      v_batch.invalid_rows;
  end if;

  update public.user_import_batches
  set
    status = 'superseded',
    superseded_at = now()
  where user_id = auth.uid()
    and status = 'active';

  update public.user_import_batches
  set
    status = 'active',
    activated_at = now()
  where id = p_batch_id;

  return p_batch_id;
end;
$$;

-- ── Failure transition ───────────────────────────────────────────────────────

create or replace function public.fail_import_batch(
  p_batch_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if auth.uid() is null then
    raise exception
      'fail_import_batch: not authenticated';
  end if;

  select status
  into v_status
  from public.user_import_batches
  where id = p_batch_id
    and user_id = auth.uid()
  for update;

  if not found then
    raise exception
      'fail_import_batch: batch % not found or not owned',
      p_batch_id;
  end if;

  if v_status <> 'processing' then
    raise exception
      'fail_import_batch: batch % is %, expected processing',
      p_batch_id,
      v_status;
  end if;

  update public.user_import_batches
  set status = 'failed'
  where id = p_batch_id;

  return p_batch_id;
end;
$$;

revoke all
  on function public.activate_import_batch(uuid)
  from public;

revoke all
  on function public.fail_import_batch(uuid)
  from public;

grant execute
  on function public.activate_import_batch(uuid)
  to authenticated;

grant execute
  on function public.fail_import_batch(uuid)
  to authenticated;

commit;
