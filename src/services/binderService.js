-- ═══════════════════════════════════════════════════════════════════════════
-- BP-0A1: Binder Planning foundation — Illustrated Vault
-- Idempotent. Safe to re-run.
--
-- Security model: the parent binder (user_binders.user_id) is the single
-- security boundary. user_binder_cards carries NO user_id column; every
-- child policy verifies ownership through an EXISTS lookup on the parent,
-- with the correlated outer column explicitly qualified
-- (user_binder_cards.binder_id) so no unqualified reference is relied on.
--
-- card_id is loose text (cards_effective.id convention), no FK — matching
-- card_favorites / user_card_intent / card_overrides, because the weekly
-- sync pipeline rewrites catalog rows. Missing catalog rows are handled
-- gracefully at render time (BP-0A3).
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists user_binders (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint user_binders_name_len check (char_length(btrim(name)) between 1 and 80),
  constraint user_binders_desc_len check (
    description is null
    or char_length(btrim(description)) between 1 and 280
  )
);

create table if not exists user_binder_cards (
  id         uuid primary key default gen_random_uuid(),
  binder_id  uuid not null references user_binders(id) on delete cascade,
  card_id    text not null,
  created_at timestamptz not null default now(),
  constraint user_binder_cards_unique_member unique (binder_id, card_id)
);

create index if not exists user_binders_user_id_idx     on user_binders(user_id);
create index if not exists user_binder_cards_binder_idx on user_binder_cards(binder_id);
-- card_id index deliberately omitted for BP-0A: every query is binder-scoped.

alter table user_binders      enable row level security;
alter table user_binder_cards enable row level security;

-- ── RLS: user_binders — direct ownership ────────────────────────────────────
drop policy if exists binders_select on user_binders;
create policy binders_select on user_binders
  for select using (user_id = auth.uid());

drop policy if exists binders_insert on user_binders;
create policy binders_insert on user_binders
  for insert with check (user_id = auth.uid());

drop policy if exists binders_update on user_binders;
create policy binders_update on user_binders
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists binders_delete on user_binders;
create policy binders_delete on user_binders
  for delete using (user_id = auth.uid());

-- ── RLS: user_binder_cards — ownership via parent binder only ───────────────
drop policy if exists binder_cards_select on user_binder_cards;
create policy binder_cards_select on user_binder_cards
  for select using (
    exists (
      select 1 from user_binders b
      where b.id = user_binder_cards.binder_id
        and b.user_id = auth.uid()
    )
  );

drop policy if exists binder_cards_insert on user_binder_cards;
create policy binder_cards_insert on user_binder_cards
  for insert with check (
    exists (
      select 1 from user_binders b
      where b.id = user_binder_cards.binder_id
        and b.user_id = auth.uid()
    )
  );

drop policy if exists binder_cards_update on user_binder_cards;
create policy binder_cards_update on user_binder_cards
  for update
  using (
    exists (
      select 1 from user_binders b
      where b.id = user_binder_cards.binder_id
        and b.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from user_binders b
      where b.id = user_binder_cards.binder_id
        and b.user_id = auth.uid()
    )
  );

drop policy if exists binder_cards_delete on user_binder_cards;
create policy binder_cards_delete on user_binder_cards
  for delete using (
    exists (
      select 1 from user_binders b
      where b.id = user_binder_cards.binder_id
        and b.user_id = auth.uid()
    )
  );

-- ── updated_at trigger ───────────────────────────────────────────────────────
-- Project-prefixed function name to avoid colliding with any existing helper.
-- If the project already has an updated_at trigger convention, swap this for
-- that function and remove this block.
create or replace function iv_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists user_binders_touch_updated_at on user_binders;
create trigger user_binders_touch_updated_at
  before update on user_binders
  for each row execute function iv_touch_updated_at();
