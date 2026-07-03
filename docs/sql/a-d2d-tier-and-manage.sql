-- A-D2d — Manage Artist in Archive
-- Adds a per-user tier to user_tracked_artists and the RLS policy needed to
-- update it directly from the client. Scope: dynamic (user-added) artists
-- only — curated ARTISTS entries are a hardcoded JS constant and are never
-- rows in this table, so this migration cannot affect them.
--
-- Does NOT touch: artists (global identity), cards, cards_effective,
-- user_collection, card_overrides, card_favorites, user_card_intent,
-- add_artist_to_archive's catalog-validation logic.

begin;

-- 1) Per-user display tier for a tracked artist.
--    'added' is the default so every existing row (and every future
--    Add to Archive) starts in "YOUR ADDITIONS", matching current behavior.
alter table public.user_tracked_artists
  add column if not exists tier text not null default 'added';

-- Conditional: add the CHECK constraint only if it doesn't already exist,
-- so rerunning this migration is a no-op rather than an error.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'user_tracked_artists_tier_check'
      and conrelid = 'public.user_tracked_artists'::regclass
  ) then
    alter table public.user_tracked_artists
      add constraint user_tracked_artists_tier_check
      check (tier in ('main','secondary','added'));
  end if;
end $$;

-- 2) UPDATE RLS policy — did not exist before this migration.
--    Mirrors the existing uta_select_own / uta_insert_own / uta_delete_own
--    shape: a user may only ever touch their own rows.
--    drop-if-exists + create makes this safely rerunnable.
drop policy if exists uta_update_own on public.user_tracked_artists;

create policy uta_update_own
  on public.user_tracked_artists
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

commit;

-- ── Verification (run manually, not part of the migration) ─────────────────
-- select column_name, data_type, is_nullable, column_default
-- from information_schema.columns
-- where table_schema='public' and table_name='user_tracked_artists'
-- order by ordinal_position;
--
-- select conname, pg_get_constraintdef(oid)
-- from pg_constraint
-- where conrelid = 'public.user_tracked_artists'::regclass;
--
-- select policyname, cmd, qual, with_check
-- from pg_policies
-- where schemaname='public' and tablename='user_tracked_artists';
