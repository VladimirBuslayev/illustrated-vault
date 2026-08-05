-- docs/sql/bp-1a-planned-binder-ordering.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- BP-1A — Planned Binder manual ordering
--
-- Adds a collector-authored list sequence to public.user_binder_cards:
--
--   1. position integer                       (nullable, then backfilled)
--   2. deterministic backfill from the CURRENT service order
--   3. proof that no row remains null         (raises, does not warn)
--   4. position set NOT NULL
--   5. supporting index (binder_id, position, created_at, id)
--   6. public.user_binder_cards_assign_position()   BEFORE INSERT function
--   7. trigger ubc_before_insert_assign_position
--   8. public.reorder_binder_cards(uuid, text[])    atomic whole-binder RPC
--   9. explicit grants / revokes
--
-- SCOPE — this migration does NOT touch:
--   membership rows (no insert, no delete), card_id values, created_at values,
--   binder metadata, user_collection, card_overrides, card_favorites,
--   user_card_intent, user_import_batches, user_import_rows, cards,
--   card_extras, cards_effective, artists, user_tracked_artists.
--
-- NO FOREIGN KEY is added from user_binder_cards.card_id to public.cards or
-- public.cards_effective. This is deliberate and load-bearing: a planned binder
-- is a statement of intent and must survive a catalog row becoming temporarily
-- unavailable. Do not add one later without an explicit product decision.
--
-- ORDERING SEMANTICS: position is a LIST SEQUENCE. It is not a page number, a
-- pocket index, or any physical binder placement. Do not reinterpret it as one.
--
-- RERUNNABLE: add column if not exists / create index if not exists /
-- create or replace function / drop trigger if exists + create. The backfill is
-- guarded by `where position is null`, so a second run repositions nothing.
--
-- Rollback guidance is at the bottom of this file.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. Column ────────────────────────────────────────────────────────────────
-- Added nullable so that step 2 can backfill it before step 4 tightens it.
-- integer, not smallint: a 1000-gap scheme exhausts smallint at 32 cards.
-- No DEFAULT: a default would silently give every future insert the same
-- position. Step 6/7 assign it instead, under a lock.

alter table public.user_binder_cards
  add column if not exists position integer;


-- ── 2. Backfill ──────────────────────────────────────────────────────────────
-- Source of truth is the order the service returns TODAY:
--     order by created_at asc
-- with id asc appended purely as a tiebreak. The BP-1.0 inspection confirmed
-- zero (binder_id, created_at) ties in production, so the tiebreak changes
-- nothing today and exists only to make the expression total.
--
-- Result: every collector's existing visible order is preserved EXACTLY.
--
-- `where position is null` makes the statement idempotent — a rerun after a
-- successful first run matches zero rows and cannot renumber a binder the
-- collector has since reordered.

update public.user_binder_cards c
   set position = s.pos
  from (
        select id,
               (row_number() over (
                  partition by binder_id
                  order by created_at asc, id asc
                ))::integer * 1000 as pos
          from public.user_binder_cards
       ) s
 where c.id = s.id
   and c.position is null;


-- ── 3. Prove the backfill is complete ────────────────────────────────────────
-- Fail the whole transaction rather than reaching step 4 and getting a bare
-- constraint violation with no context.

do $$
declare
  v_null_rows bigint;
begin
  select count(*) into v_null_rows
    from public.user_binder_cards
   where position is null;

  if v_null_rows > 0 then
    raise exception
      'bp-1a: % membership row(s) still have a null position after backfill',
      v_null_rows;
  end if;
end $$;


-- ── 4. Tighten ───────────────────────────────────────────────────────────────
-- Idempotent: setting NOT NULL on an already-NOT NULL column is a no-op.

alter table public.user_binder_cards
  alter column position set not null;


-- ── 5. Index ─────────────────────────────────────────────────────────────────
-- Covers the exact read the service performs:
--   where binder_id = $1 order by position asc, created_at asc, id asc
--
-- NOTE — deliberately NOT unique on (binder_id, position). Uniqueness would
-- turn every reorder into a deferred-constraint dance and would convert a
-- benign transient tie (two concurrent inserts computing the same max) into a
-- hard insert failure. The three-key read order below is a guaranteed total
-- order without it.

create index if not exists user_binder_cards_binder_position_idx
  on public.user_binder_cards (binder_id, position, created_at, id);


-- ── 6. Insert-position function ──────────────────────────────────────────────
-- Mirrors public.uir_guard_insert() (OL-0B) exactly: security definer, empty
-- search_path, every object fully qualified, auth.uid() internal, parent row
-- locked FOR UPDATE, raises rather than silently degrading.
--
-- Locking the PARENT binder row (not the child table) serialises concurrent
-- appends to one binder without blocking any other binder.
--
-- An explicitly supplied position is left untouched. No production path
-- supplies one today — addCardToBinder omits the column entirely — so in
-- practice this branch exists for future controlled inserts (a copy-binder
-- flow, a restore) that already know the sequence they want. It does NOT open
-- a bypass: the INSERT itself is still governed by the user_binder_cards RLS
-- INSERT policy, which is evaluated independently of this trigger.
--
-- Consequence of the auth.uid() check, matching uir_guard_insert: inserts made
-- with the service role or from the SQL editor (where auth.uid() is null) are
-- rejected. That is intentional — every production insert is an authenticated
-- client insert.

create or replace function public.user_binder_cards_assign_position()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_owner     uuid;
  v_next      integer;
begin
  if v_uid is null then
    raise exception
      'user_binder_cards insert: not authenticated'
      using errcode = '28000';
  end if;

  -- Lock the parent binder and confirm ownership in one statement.
  select b.user_id
    into v_owner
    from public.user_binders b
   where b.id = new.binder_id
     and b.user_id = v_uid
     for update;

  if not found then
    raise exception
      'user_binder_cards insert: binder % not found or not owned',
      new.binder_id
      using errcode = '42501';
  end if;

  if new.position is null then
    select coalesce(max(c.position), 0) + 1000
      into v_next
      from public.user_binder_cards c
     where c.binder_id = new.binder_id;

    new.position := v_next;
  end if;

  return new;
end;
$$;

revoke all
  on function public.user_binder_cards_assign_position()
  from public, anon, authenticated;


-- ── 7. Trigger ───────────────────────────────────────────────────────────────
-- BEFORE INSERT, FOR EACH ROW. Fires only on INSERT, so the step-2 backfill
-- (an UPDATE) and the step-8 reorder (an UPDATE) never invoke it.

drop trigger if exists ubc_before_insert_assign_position
  on public.user_binder_cards;

create trigger ubc_before_insert_assign_position
  before insert on public.user_binder_cards
  for each row
  execute function public.user_binder_cards_assign_position();


-- ── 8. Reorder RPC ───────────────────────────────────────────────────────────
-- One atomic whole-binder rewrite. Either the supplied sequence is an exact
-- permutation of current membership and every row is repositioned, or nothing
-- changes and the caller gets a raised error. There is no partial state.
--
-- No user id argument. The caller is auth.uid(), always.
--
-- security definer is consistent with the repository's lifecycle-RPC
-- convention (activate_import_batch, fail_import_batch, uir_guard_insert):
-- ownership is verified explicitly inside the function rather than delegated
-- to RLS, and the parent row is locked for the duration.
--
-- Every reorder rewrites the FULL sequence as ordinal * 1000, so each reorder
-- is also a rebalance. Gaps can never be exhausted and no separate rebalance
-- path is required.

create or replace function public.reorder_binder_cards(
  p_binder_id uuid,
  p_card_ids  text[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_owner     uuid;
  v_supplied  integer;
  v_distinct  integer;
  v_current   integer;
  v_updated   integer;
begin
  -- 8a. authentication is mandatory, never softened into a no-op.
  if v_uid is null then
    raise exception
      'reorder_binder_cards: not authenticated'
      using errcode = '28000';
  end if;

  if p_binder_id is null then
    raise exception
      'reorder_binder_cards: p_binder_id is required'
      using errcode = '22023';
  end if;

  if p_card_ids is null then
    raise exception
      'reorder_binder_cards: p_card_ids is required'
      using errcode = '22023';
  end if;

  -- 8b. reject null card ids before anything is locked or counted.
  if array_position(p_card_ids, null) is not null then
    raise exception
      'reorder_binder_cards: p_card_ids contains a null card id'
      using errcode = '22023';
  end if;

  -- 8c. lock the parent binder and verify ownership in one statement.
  select b.user_id
    into v_owner
    from public.user_binders b
   where b.id = p_binder_id
     and b.user_id = v_uid
     for update;

  if not found then
    raise exception
      'reorder_binder_cards: binder % not found or not owned',
      p_binder_id
      using errcode = '42501';
  end if;

  -- 8d. reject duplicates within the supplied array.
  v_supplied := coalesce(array_length(p_card_ids, 1), 0);

  select count(distinct x)
    into v_distinct
    from unnest(p_card_ids) as x;

  if v_supplied <> v_distinct then
    raise exception
      'reorder_binder_cards: p_card_ids contains duplicate card ids (% supplied, % distinct)',
      v_supplied,
      v_distinct
      using errcode = '22023';
  end if;

  -- 8e. cardinality must match current membership exactly.
  select count(*)
    into v_current
    from public.user_binder_cards c
   where c.binder_id = p_binder_id;

  if v_supplied <> v_current then
    raise exception
      'reorder_binder_cards: % ids supplied, binder % has % member(s)',
      v_supplied,
      p_binder_id,
      v_current
      using errcode = '22023';
  end if;

  -- 8f. no extras — every supplied id must currently be a member.
  if exists (
    select 1
      from unnest(p_card_ids) as x(card_id)
     where not exists (
             select 1
               from public.user_binder_cards c
              where c.binder_id = p_binder_id
                and c.card_id   = x.card_id
           )
  ) then
    raise exception
      'reorder_binder_cards: p_card_ids contains ids that are not members of binder %',
      p_binder_id
      using errcode = '22023';
  end if;

  -- 8g. no omissions — every current member must appear in the supplied array.
  --     8e + 8f + 8d already imply this, but it is asserted explicitly so a
  --     future change to any one of them cannot quietly admit a partial order.
  if exists (
    select 1
      from public.user_binder_cards c
     where c.binder_id = p_binder_id
       and not exists (
             select 1
               from unnest(p_card_ids) as x(card_id)
              where x.card_id = c.card_id
           )
  ) then
    raise exception
      'reorder_binder_cards: p_card_ids omits current members of binder %',
      p_binder_id
      using errcode = '22023';
  end if;

  -- 8h. rewrite the full sequence.
  update public.user_binder_cards c
     set position = (t.ord)::integer * 1000
    from unnest(p_card_ids) with ordinality as t(card_id, ord)
   where c.binder_id = p_binder_id
     and c.card_id   = t.card_id;

  get diagnostics v_updated = row_count;

  -- 8i. fail closed on any disagreement between intent and effect.
  if v_updated <> v_current then
    raise exception
      'reorder_binder_cards: repositioned % row(s), expected %',
      v_updated,
      v_current
      using errcode = '40003';
  end if;

  return v_updated;
end;
$$;


-- ── 9. Grants ────────────────────────────────────────────────────────────────

revoke all
  on function public.reorder_binder_cards(uuid, text[])
  from public, anon;

grant execute
  on function public.reorder_binder_cards(uuid, text[])
  to authenticated;

commit;


-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK
--
-- Total and cheap. Nothing outside these four objects reads `position`, so
-- dropping them restores the pre-BP-1A behaviour exactly: fetchBinderCardIds
-- reverts to created_at ordering and no membership row is touched.
--
-- Run the frontend rollback FIRST (revert binderService.js + App.jsx), or the
-- deployed service will select a column that no longer exists and every plan
-- will render its retryable "couldn't load the card details" state.
--
--   begin;
--
--   drop trigger if exists ubc_before_insert_assign_position
--     on public.user_binder_cards;
--
--   drop function if exists public.user_binder_cards_assign_position();
--
--   drop function if exists public.reorder_binder_cards(uuid, text[]);
--
--   drop index if exists public.user_binder_cards_binder_position_idx;
--
--   alter table public.user_binder_cards
--     drop column if exists position;
--
--   commit;
--
-- Dropping the column DISCARDS the collector-authored sequence. Re-running the
-- forward migration afterwards restores created_at order, not the sequence the
-- collector last chose. If that matters, snapshot first:
--
--   select binder_id, card_id, position
--     from public.user_binder_cards
--    order by binder_id, position;
-- ═══════════════════════════════════════════════════════════════════════════
