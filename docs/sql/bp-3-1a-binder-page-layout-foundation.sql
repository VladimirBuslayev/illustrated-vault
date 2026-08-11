-- docs/sql/bp-3-1a-binder-page-layout-foundation.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- BP-3.1A — Physical Binder Page Planning: data foundation
--
-- Adds the optional physical-placement layer over Binder Plan membership:
--
--    1. preflight guards                                    (raise, not warn)
--    2. additive UNIQUE (id, binder_id) on user_binder_cards (composite-FK referent)
--    3. public.user_binder_layouts                          (one per binder, optional)
--    4. public.user_binder_layout_items                     (occupied pockets only)
--    5. RLS: parent-derived SELECT only; NO client write path
--    6. public.iv_binder_layout_document(uuid)              (private, STABLE)
--    7. public.fetch_binder_page_layout(uuid)               (atomic read)
--    8. public.create_binder_page_layout(uuid, text, text)
--    9. public.save_binder_page_layout(uuid, integer, jsonb) (whole-state authority)
--   10. public.set_binder_layout_theme(uuid, text)
--   11. public.reset_binder_page_layout(uuid, text)
--   12. explicit grants / revokes
--
-- ── SEMANTICS ──────────────────────────────────────────────────────────────
-- Three separate authorities, never conflated:
--
--   user_binder_cards            EXACT Binder Plan membership (inclusion)
--   user_binder_cards.position   MANUAL LIST ORDER — a list sequence, and
--                                explicitly NOT a page or pocket index.
--                                Nothing in this migration reads, writes,
--                                orders by, or reinterprets it.
--   user_binder_layout_items     PHYSICAL POCKET PLACEMENT
--
-- A pocket is occupied by a BINDER MEMBERSHIP ROW (user_binder_cards.id), never
-- by a global catalog card id. That is what makes placement clear itself when a
-- card leaves the plan, survive catalog absence, and keep future duplicate
-- physical slots representable.
--
-- Empty pockets are DERIVED (no row). Unplaced cards are DERIVED (a membership
-- with no item). Pages are DERIVED from page_count (there is no page table).
--
-- ── SCOPE — this migration does NOT touch ──────────────────────────────────
--   user_binder_cards rows, card_id values, created_at values, position values,
--   the ubc_before_insert_assign_position trigger, user_binder_cards_assign_position(),
--   reorder_binder_cards(uuid,text[]), existing user_binder_cards / user_binders
--   RLS policies or grants, iv_touch_updated_at() or its grants, user_binders
--   rows, user_collection, card_overrides, card_favorites, price_history,
--   user_card_intent, user_import_batches, user_import_rows, cards, card_extras,
--   cards_effective, artists, user_tracked_artists.
--
-- The ONLY change to a pre-existing object is §2: an ADDITIVE unique constraint
-- on public.user_binder_cards (id, binder_id). It constrains nothing that is not
-- already unique by (id) alone — its sole purpose is to be a legal referent for
-- the composite foreign key in §4, which makes foreign-binder placement
-- STRUCTURALLY IMPOSSIBLE rather than merely validated.
--
-- NO FOREIGN KEY is added from any table here to public.cards or
-- public.cards_effective. Placement follows membership, and membership is
-- deliberately catalog-independent (see bp-1a header).
--
-- ── RERUNNABLE ─────────────────────────────────────────────────────────────
-- create table if not exists / create index if not exists / create or replace
-- function / DO-guarded constraint adds / drop trigger if exists + create.
-- A second run against a state produced by a first run changes nothing.
--
-- Rollback guidance is at the bottom of this file.
-- ═══════════════════════════════════════════════════════════════════════════

begin;


-- ── 1. Preflight guards ─────────────────────────────────────────────────────
-- Fail the whole transaction with a legible message rather than emitting a bare
-- "relation does not exist" from somewhere in the middle.

do $$
begin
  if to_regclass('public.user_binders') is null then
    raise exception 'bp-3.1a: public.user_binders is missing — wrong database or wrong branch';
  end if;

  if to_regclass('public.user_binder_cards') is null then
    raise exception 'bp-3.1a: public.user_binder_cards is missing — wrong database or wrong branch';
  end if;

  -- BP-1A must be deployed. Not because anything here reads `position`, but
  -- because its absence means this database is not the inspected production
  -- state and no other assumption in this file can be trusted.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'user_binder_cards'
       and column_name  = 'position'
       and is_nullable  = 'NO'
  ) then
    raise exception 'bp-3.1a: user_binder_cards.position (NOT NULL) is missing — deploy BP-1A first';
  end if;

  if to_regprocedure('public.iv_touch_updated_at()') is null then
    raise exception 'bp-3.1a: public.iv_touch_updated_at() is missing';
  end if;

  -- Guard against colliding with a non-table object of the same name.
  if to_regclass('public.user_binder_layouts') is not null
     and (select c.relkind from pg_class c where c.oid = to_regclass('public.user_binder_layouts')) <> 'r' then
    raise exception 'bp-3.1a: public.user_binder_layouts exists and is not an ordinary table';
  end if;

  if to_regclass('public.user_binder_layout_items') is not null
     and (select c.relkind from pg_class c where c.oid = to_regclass('public.user_binder_layout_items')) <> 'r' then
    raise exception 'bp-3.1a: public.user_binder_layout_items exists and is not an ordinary table';
  end if;
end $$;


-- ── 2. Additive composite-FK referent on user_binder_cards ──────────────────
-- (id, binder_id) is already unique by virtue of (id) being the primary key.
-- This constraint therefore rejects nothing that was previously accepted and
-- changes no membership semantics whatsoever. It exists so that
-- user_binder_layout_items can reference (binder_card_id, binder_id) as a pair,
-- which is what forbids a membership from one binder being placed into another
-- binder's layout.
--
-- PostgreSQL has no ADD CONSTRAINT IF NOT EXISTS, hence the DO guard.

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.user_binder_cards'::regclass
       and conname  = 'user_binder_cards_id_binder_key'
  ) then
    alter table public.user_binder_cards
      add constraint user_binder_cards_id_binder_key unique (id, binder_id);
  end if;
end $$;


-- ── 3. public.user_binder_layouts ───────────────────────────────────────────
-- One OPTIONAL layout per binder. No user_id column: ownership is derived
-- through binder_id -> user_binders.user_id, exactly as user_binder_cards does.
-- A second ownership column could drift from the first; there must be one.
--
-- format_key, not rows/columns: a single validated key cannot express an
-- unsupported geometry, and the frontend maps it through one frozen constant.
-- background_theme, a validated text key, not an enum (enum values cannot be
-- removed) and not a colour value (contrast would be unverifiable at write time).

create table if not exists public.user_binder_layouts (
  id                uuid        primary key default gen_random_uuid(),
  binder_id         uuid        not null unique
                                references public.user_binders(id) on delete cascade,
  format_key        text        not null,
  background_theme  text        not null default 'charcoal',
  page_count        integer     not null default 1,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.user_binder_layouts'::regclass
                    and conname  = 'user_binder_layouts_format_key_check') then
    alter table public.user_binder_layouts
      add constraint user_binder_layouts_format_key_check
      check (format_key in ('3x3','3x4','4x4'));
  end if;

  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.user_binder_layouts'::regclass
                    and conname  = 'user_binder_layouts_background_theme_check') then
    alter table public.user_binder_layouts
      add constraint user_binder_layouts_background_theme_check
      check (background_theme in (
        'charcoal','warm-black','deep-plum','midnight-navy',
        'forest','burgundy','sand','soft-stone'));
  end if;

  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.user_binder_layouts'::regclass
                    and conname  = 'user_binder_layouts_page_count_check') then
    alter table public.user_binder_layouts
      add constraint user_binder_layouts_page_count_check
      check (page_count between 1 and 500);
  end if;

  -- Composite-FK referent for user_binder_layout_items (layout_id, binder_id).
  -- Redundant for uniqueness (id is the PK); load-bearing for the FK.
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.user_binder_layouts'::regclass
                    and conname  = 'user_binder_layouts_id_binder_key') then
    alter table public.user_binder_layouts
      add constraint user_binder_layouts_id_binder_key unique (id, binder_id);
  end if;
end $$;

drop trigger if exists user_binder_layouts_touch_updated_at on public.user_binder_layouts;
create trigger user_binder_layouts_touch_updated_at
  before update on public.user_binder_layouts
  for each row execute function public.iv_touch_updated_at();


-- ── 4. public.user_binder_layout_items ──────────────────────────────────────
-- ONE ROW PER OCCUPIED POCKET. Empty pockets and unplaced memberships have no
-- row and are derived at render time.
--
-- binder_id is deliberately denormalized. Without it, "a membership from another
-- binder cannot be placed here" is enforceable only by RPC validation; with it,
-- the two composite foreign keys below cannot both be satisfied by a
-- cross-binder placement, so the state is UNREPRESENTABLE. The RPC check is
-- retained anyway — the FK fails closed with an opaque constraint error, the RPC
-- fails closed with a clear one. Same layered-redundancy philosophy as
-- reorder_binder_cards §8g.
--
-- binder_id is written by the RPCs only; it is never accepted from a client.
--
-- The CHECK on pocket_number is a FLOOR, not the authority: it cannot know the
-- layout's format. Exact per-format bounds (9 / 12 / 16) and the
-- page_number <= page_count bound are enforced in save_binder_page_layout()
-- under the parent-binder lock. The table CHECKs exist so that the absurd
-- (pocket 0, pocket 400, page -1) stays unrepresentable even if some future code
-- path bypasses the RPC.

create table if not exists public.user_binder_layout_items (
  id              uuid        primary key default gen_random_uuid(),
  layout_id       uuid        not null,
  binder_id       uuid        not null,
  binder_card_id  uuid        not null,
  page_number     integer     not null,
  pocket_number   integer     not null,
  created_at      timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.user_binder_layout_items'::regclass
                    and conname  = 'user_binder_layout_items_page_number_check') then
    alter table public.user_binder_layout_items
      add constraint user_binder_layout_items_page_number_check check (page_number >= 1);
  end if;

  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.user_binder_layout_items'::regclass
                    and conname  = 'user_binder_layout_items_pocket_number_check') then
    alter table public.user_binder_layout_items
      add constraint user_binder_layout_items_pocket_number_check
      check (pocket_number between 1 and 16);
  end if;

  -- Cascade: deleting the layout removes its placements.
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.user_binder_layout_items'::regclass
                    and conname  = 'user_binder_layout_items_layout_fkey') then
    alter table public.user_binder_layout_items
      add constraint user_binder_layout_items_layout_fkey
      foreign key (layout_id, binder_id)
      references public.user_binder_layouts (id, binder_id) on delete cascade;
  end if;

  -- Cascade: removing a card from the plan clears its pocket automatically.
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.user_binder_layout_items'::regclass
                    and conname  = 'user_binder_layout_items_binder_card_fkey') then
    alter table public.user_binder_layout_items
      add constraint user_binder_layout_items_binder_card_fkey
      foreign key (binder_card_id, binder_id)
      references public.user_binder_cards (id, binder_id) on delete cascade;
  end if;

  -- v0: a membership occupies at most one pocket.
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.user_binder_layout_items'::regclass
                    and conname  = 'user_binder_layout_items_unique_member') then
    alter table public.user_binder_layout_items
      add constraint user_binder_layout_items_unique_member unique (layout_id, binder_card_id);
  end if;

  -- A pocket holds at most one membership.
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.user_binder_layout_items'::regclass
                    and conname  = 'user_binder_layout_items_unique_pocket') then
    alter table public.user_binder_layout_items
      add constraint user_binder_layout_items_unique_pocket
      unique (layout_id, page_number, pocket_number);
  end if;
end $$;

-- Supports the ON DELETE CASCADE from user_binder_cards. Without it, every
-- membership delete degrades to a sequential scan of this table.
create index if not exists user_binder_layout_items_binder_card_idx
  on public.user_binder_layout_items (binder_card_id);

-- The canonical read order (page, pocket) is already served by
-- user_binder_layout_items_unique_pocket; no additional index is created.


-- ── 5. RLS and table privileges ─────────────────────────────────────────────
-- Deliberately NARROWER than user_binder_cards, which carries all four
-- per-command policies because its writes are single-row and independently
-- meaningful. A layout write is only ever meaningful as a COMPLETE valid state,
-- so there is no client write path at all: the absence of INSERT/UPDATE/DELETE
-- policies AND privileges makes "the client cannot save a chain of partially
-- valid per-pocket writes" a property of the database, not of the client code.
--
-- RLS is enabled and NOT forced, matching production. The SECURITY DEFINER RPCs
-- below are owned by the migration role and therefore bypass RLS; each verifies
-- ownership explicitly and locks the parent binder, exactly as
-- reorder_binder_cards does.

alter table public.user_binder_layouts       enable row level security;
alter table public.user_binder_layout_items  enable row level security;

drop policy if exists binder_layouts_select on public.user_binder_layouts;
create policy binder_layouts_select
  on public.user_binder_layouts
  for select
  to authenticated
  using (exists (
    select 1 from public.user_binders b
     where b.id = user_binder_layouts.binder_id
       and b.user_id = auth.uid()
  ));

drop policy if exists binder_layout_items_select on public.user_binder_layout_items;
create policy binder_layout_items_select
  on public.user_binder_layout_items
  for select
  to authenticated
  using (exists (
    select 1
      from public.user_binder_layouts l
      join public.user_binders b on b.id = l.binder_id
     where l.id = user_binder_layout_items.layout_id
       and b.user_id = auth.uid()
  ));

-- Supabase default privileges grant every table privilege to anon/authenticated
-- on creation. Revoke first, then grant back only SELECT, and only to
-- authenticated. anon has no legitimate read: every policy above resolves
-- through auth.uid().
revoke all on public.user_binder_layouts      from public, anon, authenticated;
revoke all on public.user_binder_layout_items from public, anon, authenticated;

grant select on public.user_binder_layouts      to authenticated;
grant select on public.user_binder_layout_items to authenticated;


-- ── 6. Canonical response helper (PRIVATE) ──────────────────────────────────
-- One projection, five call sites. It is NOT a public API:
--   • EXECUTE is revoked from public, anon and authenticated, so it is reachable
--     only from inside the SECURITY DEFINER RPCs below (and by the owner).
--   • It is SECURITY INVOKER: it acquires no privilege of its own. Called from a
--     definer RPC it runs in that RPC's context; there is no path by which a
--     client reaches it with elevated rights.
--   • It takes a layout id and performs NO ownership check, which is safe
--     precisely because it is unreachable except after a caller has already
--     verified ownership. Do not grant it to a client role.
--
-- STABLE is load-bearing, not decoration. A STABLE function invoked from a query
-- uses the CALLING QUERY'S SNAPSHOT; a VOLATILE function would take a fresh
-- snapshot for each statement it executes internally. Marking it STABLE is what
-- lets fetch_binder_page_layout() assemble ownership, layout metadata and
-- placements inside ONE statement and therefore ONE coherent snapshot.

create or replace function public.iv_binder_layout_document(p_layout_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
           'contractVersion', 1,
           'layoutId',        l.id,
           'binderId',        l.binder_id,
           'formatKey',       l.format_key,
           'backgroundTheme', l.background_theme,
           'pageCount',       l.page_count,
           'updatedAt',       l.updated_at,
           'placements',      coalesce((
             select jsonb_agg(
                      jsonb_build_object(
                        'binderCardId', i.binder_card_id,
                        'page',         i.page_number,
                        'pocket',       i.pocket_number)
                      order by i.page_number, i.pocket_number, i.binder_card_id)
               from public.user_binder_layout_items i
              where i.layout_id = l.id
           ), '[]'::jsonb)
         )
    from public.user_binder_layouts l
   where l.id = p_layout_id
$$;

revoke all on function public.iv_binder_layout_document(uuid)
  from public, anon, authenticated;


-- ── 7. fetch_binder_page_layout — ATOMIC READ ───────────────────────────────
-- Returns SQL NULL for an owned binder with no layout; a canonical
-- contractVersion 1 document for an owned binder with one; raises 42501 for a
-- binder that is missing OR belongs to someone else (the two are deliberately
-- indistinguishable to the caller).
--
-- SNAPSHOT COHERENCE — how this function achieves it:
--   • The function is STABLE, so all of its internal SQL executes against a
--     single snapshot rather than taking a new one per statement.
--   • Ownership, layout metadata and the placement set are obtained by ONE
--     statement: a LEFT JOIN from user_binders to user_binder_layouts whose
--     select list invokes the STABLE helper, which therefore inherits that same
--     statement's snapshot for its aggregation of user_binder_layout_items.
--   • Consequently there is no window in which the returned pageCount could come
--     from before a concurrent save and the placements from after it.
--
-- No lock is taken. Locking the binder to read would serialise readers against
-- writers for no benefit: the snapshot already guarantees a coherent document,
-- and a document that was true a moment ago is exactly what a read returns.
-- Nothing is mutated; updated_at is untouched.

create or replace function public.fetch_binder_page_layout(p_binder_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_owner uuid;
  v_doc   jsonb;
begin
  if v_uid is null then
    raise exception 'fetch_binder_page_layout: not authenticated'
      using errcode = '28000';
  end if;

  if p_binder_id is null then
    raise exception 'fetch_binder_page_layout: p_binder_id is required'
      using errcode = '22023';
  end if;

  select b.user_id, public.iv_binder_layout_document(l.id)
    into v_owner, v_doc
    from public.user_binders b
    left join public.user_binder_layouts l on l.binder_id = b.id
   where b.id = p_binder_id
     and b.user_id = v_uid;

  if not found then
    raise exception 'fetch_binder_page_layout: binder % not found or not owned', p_binder_id
      using errcode = '42501';
  end if;

  return v_doc;   -- NULL == owned binder, no layout. NOT an error.
end;
$$;


-- ── 8. create_binder_page_layout ────────────────────────────────────────────
-- Creates the single layout row for a binder. page_count 1, zero placements.
-- Binder members are NEVER auto-placed: the list order is not a page order.
--
-- format_key is written in exactly two places in a layout's life — here and in
-- reset_binder_page_layout. It is deliberately absent from the save signature so
-- no autosave can silently change the geometry under existing placements.

create or replace function public.create_binder_page_layout(
  p_binder_id        uuid,
  p_format_key       text,
  p_background_theme text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_owner     uuid;
  v_layout_id uuid;
begin
  if v_uid is null then
    raise exception 'create_binder_page_layout: not authenticated' using errcode = '28000';
  end if;

  if p_binder_id is null then
    raise exception 'create_binder_page_layout: p_binder_id is required' using errcode = '22023';
  end if;

  if p_format_key is null or p_format_key not in ('3x3','3x4','4x4') then
    raise exception 'create_binder_page_layout: invalid format key' using errcode = '22023';
  end if;

  if p_background_theme is null or p_background_theme not in (
       'charcoal','warm-black','deep-plum','midnight-navy',
       'forest','burgundy','sand','soft-stone') then
    raise exception 'create_binder_page_layout: invalid background theme' using errcode = '22023';
  end if;

  select b.user_id
    into v_owner
    from public.user_binders b
   where b.id = p_binder_id
     and b.user_id = v_uid
   for update;

  if not found then
    raise exception 'create_binder_page_layout: binder % not found or not owned', p_binder_id
      using errcode = '42501';
  end if;

  -- Explicit check for a legible error; the UNIQUE (binder_id) constraint is the
  -- backstop and raises the same SQLSTATE if this is ever reached concurrently.
  if exists (select 1 from public.user_binder_layouts l where l.binder_id = p_binder_id) then
    raise exception 'create_binder_page_layout: binder % already has a layout', p_binder_id
      using errcode = '23505';
  end if;

  insert into public.user_binder_layouts (binder_id, format_key, background_theme, page_count)
  values (p_binder_id, p_format_key, p_background_theme, 1)
  returning id into v_layout_id;

  return public.iv_binder_layout_document(v_layout_id);
end;
$$;


-- ── 9. save_binder_page_layout — WHOLE-STATE PLACEMENT AUTHORITY ────────────
-- p_placements is the COMPLETE intended placement set:
--
--   [ { "binderCardId": "<uuid>", "page": <int>, "pocket": <int> }, ... ]
--
-- An EMPTY ARRAY is valid and means every member is unplaced. It is not an
-- error and must never be confused with "no layout" or "read failed".
--
-- Add page          == page_count + 1, placements unchanged.
-- Delete final page == page_count - 1, placements unchanged. Validation 9e
-- rejects that automatically when the final page still holds a placement, so the
-- page rules enforce themselves and there is no second code path to disagree
-- with the first. There are deliberately no add-page / delete-page RPCs.
--
-- REPLACEMENT, NOT DIFF: the payload IS the complete intended state. Delete-then-
-- insert inside the function's transaction, under the parent-binder lock, has no
-- partially-applied intermediate state visible to any other session. A per-pocket
-- diff would introduce an ordering-dependent apply window and could transiently
-- violate the unique-pocket constraint during a swap, for no benefit at this size.

create or replace function public.save_binder_page_layout(
  p_binder_id  uuid,
  p_page_count integer,
  p_placements jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := auth.uid();
  v_owner      uuid;
  v_layout_id  uuid;
  v_format     text;
  v_pockets    integer;
  v_bad        bigint;
  v_supplied   bigint;
  v_bad_pocket bigint;
  v_bad_page   bigint;
  v_dup_member bigint;
  v_dup_pocket bigint;
  v_foreign    bigint;
  v_inserted   bigint;
begin
  -- 9a. authentication is mandatory, never softened into a no-op.
  if v_uid is null then
    raise exception 'save_binder_page_layout: not authenticated' using errcode = '28000';
  end if;

  if p_binder_id is null then
    raise exception 'save_binder_page_layout: p_binder_id is required' using errcode = '22023';
  end if;

  if p_page_count is null then
    raise exception 'save_binder_page_layout: p_page_count is required' using errcode = '22023';
  end if;

  if p_placements is null then
    raise exception 'save_binder_page_layout: p_placements is required' using errcode = '22023';
  end if;

  if jsonb_typeof(p_placements) <> 'array' then
    raise exception 'save_binder_page_layout: p_placements must be a JSON array'
      using errcode = '22023';
  end if;

  if p_page_count < 1 or p_page_count > 500 then
    raise exception 'save_binder_page_layout: p_page_count % is out of range (1..500)', p_page_count
      using errcode = '22023';
  end if;

  -- 9b. lock the parent binder and verify ownership in one statement.
  --
  --     WHAT THIS LOCK DOES AND DOES NOT DO — the accurate model:
  --
  --     DIRECTLY SERIALISED (they take the same user_binders row lock):
  --       • reorder_binder_cards           — bp-1a §8c
  --       • membership INSERTs             — user_binder_cards_assign_position()
  --                                          locks the parent before assigning
  --                                          a position
  --       • the other layout write RPCs in this file
  --     So a save cannot interleave with a reorder or an append for this binder,
  --     and it blocks no other binder.
  --
  --     NOT SERIALISED BY THIS LOCK:
  --       • a direct DELETE on public.user_binder_cards (removeCardFromBinder).
  --         That path is a plain RLS-guarded statement; it takes no lock on the
  --         parent binder row and is therefore free to run concurrently with a
  --         save. Do not claim otherwise.
  --
  --     Concurrent membership deletion is nonetheless INTEGRITY-SAFE, by the
  --     (binder_card_id, binder_id) foreign key rather than by locking. Either
  --     ordering is correct and neither can leave a dangling placement:
  --       • delete commits first  → the save's 9d membership check finds the row
  --         gone and raises 42501, or, if it slipped past 9d, the INSERT in 9f
  --         violates the FK. Fail-closed; nothing is partially applied.
  --       • save commits first    → the subsequent delete cascades and clears
  --         that placement. The layout is left consistent, one pocket lighter.
  --     The collector's client then re-reads and sees the truth in both cases.
  select b.user_id
    into v_owner
    from public.user_binders b
   where b.id = p_binder_id
     and b.user_id = v_uid
   for update;

  if not found then
    raise exception 'save_binder_page_layout: binder % not found or not owned', p_binder_id
      using errcode = '42501';
  end if;

  select l.id, l.format_key
    into v_layout_id, v_format
    from public.user_binder_layouts l
   where l.binder_id = p_binder_id
   for update;

  if not found then
    raise exception 'save_binder_page_layout: binder % has no page layout', p_binder_id
      using errcode = 'P0002';
  end if;

  v_pockets := case v_format when '3x3' then 9 when '3x4' then 12 when '4x4' then 16 end;

  -- 9c. STRUCTURAL validation of the payload, in three passes, before any value
  --     is cast. Casting first would surface 22P02 / 22003 from the executor
  --     instead of this function's stable 22023 contract.

  -- 9c-i. every element is an object.
  select count(*) into v_bad
    from jsonb_array_elements(p_placements) e
   where jsonb_typeof(e) <> 'object';
  if v_bad > 0 then
    raise exception 'save_binder_page_layout: % placement entr(y/ies) are not JSON objects', v_bad
      using errcode = '22023';
  end if;

  -- 9c-ii. exactly the three expected keys, each of the expected JSON type.
  --        jsonb_typeof(e->'k') is NULL for an absent key, which
  --        `is distinct from` catches.
  select count(*) into v_bad
    from jsonb_array_elements(p_placements) e
   where (select count(*) from jsonb_object_keys(e)) <> 3
      or jsonb_typeof(e->'binderCardId') is distinct from 'string'
      or jsonb_typeof(e->'page')         is distinct from 'number'
      or jsonb_typeof(e->'pocket')       is distinct from 'number';
  if v_bad > 0 then
    raise exception 'save_binder_page_layout: % malformed placement entr(y/ies) (expected exactly binderCardId, page, pocket)', v_bad
      using errcode = '22023';
  end if;

  -- 9c-iii. lexical validation. Rejects a non-uuid id and any non-integer
  --         number (1.5, 1.0, -1, 1e400) before the cast can raise.
  select count(*) into v_bad
    from jsonb_array_elements(p_placements) e
   where (e->>'binderCardId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or (e->>'page')   !~ '^[0-9]{1,9}$'
      or (e->>'pocket') !~ '^[0-9]{1,9}$';
  if v_bad > 0 then
    raise exception 'save_binder_page_layout: % placement entr(y/ies) have a malformed uuid or non-integer page/pocket', v_bad
      using errcode = '22023';
  end if;

  -- 9d. SEMANTIC validation, all in one pass over the shredded set.
  with p as (
    select (e->>'binderCardId')::uuid  as binder_card_id,
           (e->>'page')::integer       as page_number,
           (e->>'pocket')::integer     as pocket_number
      from jsonb_array_elements(p_placements) e
  )
  select count(*),
         count(*) filter (where pocket_number < 1 or pocket_number > v_pockets),
         count(*) filter (where page_number   < 1 or page_number   > p_page_count),
         count(*) - count(distinct binder_card_id),
         count(*) - count(distinct (page_number, pocket_number)),
         count(*) filter (where not exists (
           select 1 from public.user_binder_cards c
            where c.id = p.binder_card_id
              and c.binder_id = p_binder_id))
    into v_supplied, v_bad_pocket, v_bad_page, v_dup_member, v_dup_pocket, v_foreign
    from p;

  -- 9e. raise in a fixed order so one payload always produces one message.
  if v_bad_pocket > 0 then
    raise exception 'save_binder_page_layout: % placement(s) outside pocket range 1..% for format %',
      v_bad_pocket, v_pockets, v_format using errcode = '22023';
  end if;

  if v_bad_page > 0 then
    raise exception 'save_binder_page_layout: % placement(s) outside page range 1..%',
      v_bad_page, p_page_count using errcode = '22023';
  end if;

  if v_dup_member > 0 then
    raise exception 'save_binder_page_layout: a binder membership appears in more than one pocket'
      using errcode = '22023';
  end if;

  if v_dup_pocket > 0 then
    raise exception 'save_binder_page_layout: a pocket is occupied by more than one membership'
      using errcode = '22023';
  end if;

  -- Asserted explicitly even though the composite FK makes it unrepresentable:
  -- the constraint fails closed with an opaque message, this fails closed with a
  -- clear one. Same reasoning as reorder_binder_cards §8g.
  if v_foreign > 0 then
    raise exception 'save_binder_page_layout: % placement(s) reference memberships that do not belong to binder %',
      v_foreign, p_binder_id using errcode = '42501';
  end if;

  -- 9f. replace the COMPLETE set.
  delete from public.user_binder_layout_items i where i.layout_id = v_layout_id;

  insert into public.user_binder_layout_items
         (layout_id, binder_id, binder_card_id, page_number, pocket_number)
  select v_layout_id,
         p_binder_id,                     -- server-supplied; never from the client
         (e->>'binderCardId')::uuid,
         (e->>'page')::integer,
         (e->>'pocket')::integer
    from jsonb_array_elements(p_placements) e;

  get diagnostics v_inserted = row_count;

  -- 9g. fail closed on any disagreement between intent and effect.
  if v_inserted <> v_supplied then
    raise exception 'save_binder_page_layout: placed % row(s), expected %', v_inserted, v_supplied
      using errcode = '40003';
  end if;

  -- 9h. page_count moves in the same transaction as the placements it bounds.
  --     updated_at is refreshed by the iv_touch_updated_at trigger — never set
  --     here. The UPDATE is issued unconditionally, so a save that only moves
  --     cards still stamps the layout's mtime.
  update public.user_binder_layouts l
     set page_count = p_page_count
   where l.id = v_layout_id;

  return public.iv_binder_layout_document(v_layout_id);
end;
$$;


-- ── 10. set_binder_layout_theme ─────────────────────────────────────────────
-- The structural purpose of this dedicated RPC is that changing the colour
-- CANNOT reset placements: this function has no access to page_count, format or
-- user_binder_layout_items at all, so "the theme change lost my layout" is not a
-- bug that can be introduced here later without a visible signature change.

create or replace function public.set_binder_layout_theme(
  p_binder_id        uuid,
  p_background_theme text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_owner     uuid;
  v_layout_id uuid;
begin
  if v_uid is null then
    raise exception 'set_binder_layout_theme: not authenticated' using errcode = '28000';
  end if;

  if p_binder_id is null then
    raise exception 'set_binder_layout_theme: p_binder_id is required' using errcode = '22023';
  end if;

  if p_background_theme is null or p_background_theme not in (
       'charcoal','warm-black','deep-plum','midnight-navy',
       'forest','burgundy','sand','soft-stone') then
    raise exception 'set_binder_layout_theme: invalid background theme' using errcode = '22023';
  end if;

  select b.user_id
    into v_owner
    from public.user_binders b
   where b.id = p_binder_id
     and b.user_id = v_uid
   for update;

  if not found then
    raise exception 'set_binder_layout_theme: binder % not found or not owned', p_binder_id
      using errcode = '42501';
  end if;

  update public.user_binder_layouts l
     set background_theme = p_background_theme
   where l.binder_id = p_binder_id
   returning l.id into v_layout_id;

  if v_layout_id is null then
    raise exception 'set_binder_layout_theme: binder % has no page layout', p_binder_id
      using errcode = 'P0002';
  end if;

  return public.iv_binder_layout_document(v_layout_id);
end;
$$;


-- ── 11. reset_binder_page_layout ────────────────────────────────────────────
-- The ONLY destructive layout operation, and the only other place format_key is
-- written. Every card returns to unplaced and the layout returns to one page.
-- background_theme is PRESERVED — a reset is about geometry, not appearance.
--
-- Binder membership, list order (position), ownership and Hunt intent are not
-- touched: this function writes to user_binder_layouts and
-- user_binder_layout_items only.

create or replace function public.reset_binder_page_layout(
  p_binder_id  uuid,
  p_format_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_owner     uuid;
  v_layout_id uuid;
begin
  if v_uid is null then
    raise exception 'reset_binder_page_layout: not authenticated' using errcode = '28000';
  end if;

  if p_binder_id is null then
    raise exception 'reset_binder_page_layout: p_binder_id is required' using errcode = '22023';
  end if;

  if p_format_key is null or p_format_key not in ('3x3','3x4','4x4') then
    raise exception 'reset_binder_page_layout: invalid format key' using errcode = '22023';
  end if;

  select b.user_id
    into v_owner
    from public.user_binders b
   where b.id = p_binder_id
     and b.user_id = v_uid
   for update;

  if not found then
    raise exception 'reset_binder_page_layout: binder % not found or not owned', p_binder_id
      using errcode = '42501';
  end if;

  select l.id
    into v_layout_id
    from public.user_binder_layouts l
   where l.binder_id = p_binder_id
   for update;

  if not found then
    raise exception 'reset_binder_page_layout: binder % has no page layout', p_binder_id
      using errcode = 'P0002';
  end if;

  delete from public.user_binder_layout_items i where i.layout_id = v_layout_id;

  update public.user_binder_layouts l
     set format_key = p_format_key,
         page_count = 1
   where l.id = v_layout_id;

  return public.iv_binder_layout_document(v_layout_id);
end;
$$;


-- ── 12. Function grants ─────────────────────────────────────────────────────
-- EXECUTE on a new function is granted to PUBLIC by default; revoke first.

revoke all on function public.fetch_binder_page_layout(uuid)                    from public, anon;
revoke all on function public.create_binder_page_layout(uuid, text, text)       from public, anon;
revoke all on function public.save_binder_page_layout(uuid, integer, jsonb)     from public, anon;
revoke all on function public.set_binder_layout_theme(uuid, text)               from public, anon;
revoke all on function public.reset_binder_page_layout(uuid, text)              from public, anon;

grant execute on function public.fetch_binder_page_layout(uuid)                 to authenticated;
grant execute on function public.create_binder_page_layout(uuid, text, text)    to authenticated;
grant execute on function public.save_binder_page_layout(uuid, integer, jsonb)  to authenticated;
grant execute on function public.set_binder_layout_theme(uuid, text)            to authenticated;
grant execute on function public.reset_binder_page_layout(uuid, text)           to authenticated;

commit;


-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK
--
-- Total. Nothing outside these objects reads them, and no pre-existing object
-- was modified except by the additive unique constraint in §2.
--
-- ORDER: the frontend rollback may run before or after this one. Unlike BP-1A,
-- a deployed frontend that finds these objects gone does not break the Binder:
-- fetch_binder_page_layout simply fails, binderLayoutService soft-fails to
-- {status:'failed'}, Pages renders its retry state, and Cards mode — which never
-- touches any of this — is unaffected. Frontend-first is still the tidier order.
--
-- DATA LOSS: dropping user_binder_layout_items DISCARDS every authored physical
-- layout. Placements are not reconstructible from anything else — `position` is
-- a list sequence, not a page order. Snapshot first if any layout has real use:
--
--   select l.binder_id, l.format_key, l.background_theme, l.page_count,
--          i.binder_card_id, i.page_number, i.pocket_number
--     from public.user_binder_layouts l
--     left join public.user_binder_layout_items i on i.layout_id = l.id
--    order by l.binder_id, i.page_number, i.pocket_number;
--
--   begin;
--
--   drop function if exists public.reset_binder_page_layout(uuid, text);
--   drop function if exists public.set_binder_layout_theme(uuid, text);
--   drop function if exists public.save_binder_page_layout(uuid, integer, jsonb);
--   drop function if exists public.create_binder_page_layout(uuid, text, text);
--   drop function if exists public.fetch_binder_page_layout(uuid);
--   drop function if exists public.iv_binder_layout_document(uuid);
--
--   drop table if exists public.user_binder_layout_items;
--   drop table if exists public.user_binder_layouts;
--
--   -- Optional. Harmless to keep: it constrains nothing that (id) does not
--   -- already constrain. Drop it only if a clean revert to the pre-BP-3.1A
--   -- catalog is required.
--   alter table public.user_binder_cards
--     drop constraint if exists user_binder_cards_id_binder_key;
--
--   commit;
--
-- NOT rolled back, because it was never changed: user_binder_cards.position,
-- ubc_before_insert_assign_position, user_binder_cards_assign_position(),
-- reorder_binder_cards(uuid,text[]), iv_touch_updated_at(), and every existing
-- policy and grant on user_binders / user_binder_cards.
-- ═══════════════════════════════════════════════════════════════════════════
