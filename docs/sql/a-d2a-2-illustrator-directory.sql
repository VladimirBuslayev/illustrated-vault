-- ═══════════════════════════════════════════════════════════════════════════
-- A-D2a — SQL 2 of 4: illustrator_directory (read-only discovery view)
-- Aggregates distinct illustrator strings from cards_effective with counts.
-- Catalog-level data only (no user data). Rollback at bottom.
-- ═══════════════════════════════════════════════════════════════════════════

-- security_invoker: the view runs with the querying role's permissions.
-- cards_effective is already readable by anon/authenticated (the frontend
-- reads it with the publishable key), so this exposes nothing new.
create or replace view public.illustrator_directory
with (security_invoker = true) as
select
  illustrator,
  max(artist_id)  as artist_id,   -- non-null when the sync has FK-tagged this string
  count(*)::int   as card_count
from public.cards_effective
where illustrator is not null
  and btrim(illustrator) <> ''
group by illustrator;

grant select on public.illustrator_directory to anon, authenticated;

-- ── VALIDATION ───────────────────────────────────────────────────────────────
-- Top illustrators by card count — expect familiar names, sane counts:
select * from public.illustrator_directory
order by card_count desc
limit 20;

-- The 20 roster artists should appear FK-tagged. Counts here are raw catalog
-- counts (includes TCG Pocket; the app's visible counts will be lower):
select * from public.illustrator_directory
where artist_id is not null
order by artist_id;

-- No null/empty illustrator rows:
select count(*) from public.illustrator_directory
where illustrator is null or btrim(illustrator) = '';             -- expect 0

-- Rough scale check (how many distinct illustrators exist):
select count(*) from public.illustrator_directory;

-- ── ROLLBACK (only if needed) ────────────────────────────────────────────────
-- drop view if exists public.illustrator_directory;
