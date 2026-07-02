-- ═══════════════════════════════════════════════════════════════════════════
-- A-D2a — SQL 1 of 4: user_tracked_artists (per-user tracked roster)
-- Run in Supabase SQL editor. Purely additive. SAFELY RERUNNABLE: policies
-- are dropped-if-exists before creation. Rollback at bottom.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── PREFLIGHT (run first, read results before continuing) ────────────────────
-- 1) artists.id must be text-like for the FK below; note any NOT NULL columns
--    beyond id/aliases (SQL 3's INSERT must supply them):
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'artists'
order by ordinal_position;

-- 2) all 20 roster artistIds must exist (FK targets for the seed in SQL 4):
select id from public.artists
where id in ('yuka-morii','asako-ito','tomokazu-komiya','shinji-kanda',
  'atsuko-nishida','sowsow','shibuzoh','yukiko-baba','sui','akira-egawa',
  'kouki-saitou','saya-tsuruta','okacheke','0313','gossan','mizue',
  'kayama','gapao','okubo','fukuda');
-- Expect: 20 rows. If fewer, STOP and report which are missing.

-- ── CREATE (idempotent) ──────────────────────────────────────────────────────
create table if not exists public.user_tracked_artists (
  user_id   uuid not null references auth.users(id) on delete cascade,
  artist_id text not null references public.artists(id) on delete cascade,
  added_at  timestamptz not null default now(),
  primary key (user_id, artist_id)
);

alter table public.user_tracked_artists enable row level security;

drop policy if exists "uta_select_own" on public.user_tracked_artists;
create policy "uta_select_own" on public.user_tracked_artists
  for select using (auth.uid() = user_id);

drop policy if exists "uta_insert_own" on public.user_tracked_artists;
create policy "uta_insert_own" on public.user_tracked_artists
  for insert with check (auth.uid() = user_id);

drop policy if exists "uta_delete_own" on public.user_tracked_artists;
create policy "uta_delete_own" on public.user_tracked_artists
  for delete using (auth.uid() = user_id);

-- No UPDATE policy on purpose: rows are add/remove only in this model.

grant select, insert, delete on public.user_tracked_artists to authenticated;

-- ── VALIDATION ───────────────────────────────────────────────────────────────
select count(*) from public.user_tracked_artists;               -- 0 (first run)
select relrowsecurity from pg_class
where relname = 'user_tracked_artists';                          -- expect true
select policyname, cmd from pg_policies
where tablename = 'user_tracked_artists';                        -- expect 3 rows

-- ── ROLLBACK (only if needed) ────────────────────────────────────────────────
-- drop table if exists public.user_tracked_artists;
