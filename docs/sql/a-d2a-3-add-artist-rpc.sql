-- ═══════════════════════════════════════════════════════════════════════════
-- A-D2a — SQL 3 of 4: add_artist_to_archive(p_illustrator text) RPC
-- Atomically: resolve-or-create global artist identity, then track it for
-- the calling user. SECURITY DEFINER so clients never hold insert rights on
-- the global artists table. Idempotent and rerunnable (create or replace).
--
-- CATALOG GUARD (this revision): a NEW global artists row is created ONLY
-- when p_illustrator exactly matches a real illustrator string in
-- cards_effective (case-insensitive lookup, canonical catalog spelling is
-- what gets stored as the alias). Free-text that matches nothing in the
-- catalog raises a clear exception — typos and fake names cannot pollute
-- the global artists table. Tracking an already-known identity (id or alias
-- match) needs no catalog check, since that identity already exists.
--
-- NOTE: the INSERT into artists below assumes (id, aliases) are sufficient.
-- If the SQL-1 preflight showed other NOT NULL columns on artists, add them
-- to that INSERT before running this file.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.add_artist_to_archive(p_illustrator text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user      uuid := auth.uid();
  v_name      text := btrim(coalesce(p_illustrator, ''));
  v_canonical text;
  v_artist_id text;
  v_slug      text;
begin
  if v_user is null then
    raise exception 'add_artist_to_archive: not authenticated';
  end if;
  if v_name = '' then
    raise exception 'add_artist_to_archive: illustrator name required';
  end if;

  -- 1) Resolve existing identity: exact (case-insensitive) match on id or
  --    any alias. Exact equality only — no substring matching, ever.
  select a.id into v_artist_id
  from public.artists a
  where lower(a.id) = lower(v_name)
     or exists (
       select 1 from unnest(coalesce(a.aliases, array[]::text[])) as al
       where lower(al) = lower(v_name)
     )
  limit 1;

  -- 2) Unknown identity: allow creation ONLY for a real catalog illustrator.
  if v_artist_id is null then
    select ce.illustrator into v_canonical
    from public.cards_effective ce
    where ce.illustrator is not null
      and lower(btrim(ce.illustrator)) = lower(v_name)
    order by ce.illustrator
    limit 1;

    if v_canonical is null then
      raise exception
        'add_artist_to_archive: "%" is not an illustrator in the card catalog',
        v_name;
    end if;

    v_slug := btrim(regexp_replace(lower(v_canonical), '[^a-z0-9]+', '-', 'g'), '-');
    if v_slug = '' then
      -- Name has no ascii alphanumerics (e.g. fully Japanese script).
      v_slug := 'artist-' || substr(md5(v_canonical), 1, 8);
    elsif exists (select 1 from public.artists where id = v_slug) then
      -- Slug taken by a DIFFERENT identity (alias check above already missed).
      v_slug := v_slug || '-' || substr(md5(v_canonical), 1, 6);
    end if;

    insert into public.artists (id, aliases)
    values (v_slug, array[v_canonical]);
    -- Side effect by design: the weekly sync's alias map will now FK-tag this
    -- artist's cards on its next run. Until then the frontend fetches this
    -- artist's cards by exact illustrator equality.

    v_artist_id := v_slug;
  end if;

  -- 3) Track for the calling user (idempotent).
  insert into public.user_tracked_artists (user_id, artist_id)
  values (v_user, v_artist_id)
  on conflict (user_id, artist_id) do nothing;

  return v_artist_id;
end;
$$;

revoke all on function public.add_artist_to_archive(text) from public;
grant execute on function public.add_artist_to_archive(text) to authenticated;

-- ── VALIDATION ───────────────────────────────────────────────────────────────
-- Behavioral checks (need an authenticated session — test from the signed-in
-- app's browser console via supabase.rpc, or role impersonation if available):
--   1. rpc('add_artist_to_archive', { p_illustrator: '<real catalog
--      illustrator not in the roster>' })
--      → creates one artists row (slug of canonical name, alias = canonical
--        catalog spelling) + one tracking row; returns the id.
--      Pick a real name first:
--        select illustrator from public.illustrator_directory
--        where artist_id is null order by card_count desc limit 10;
--   2. Same call again → no duplicates, same return value (idempotent).
--   3. rpc with 'Yuka Morii' → returns 'yuka-morii'; NO new artists row;
--      tracking row already seeded → no-op.
--   4. rpc with 'Totally Fake Person' → raises
--      '"Totally Fake Person" is not an illustrator in the card catalog';
--      confirm: select count(*) from artists;  -- unchanged.
--
-- Cleanup after test 1 (as postgres; replace the id):
--   delete from public.user_tracked_artists where artist_id = '<new-id>';
--   delete from public.artists where id = '<new-id>';

-- ── ROLLBACK (only if needed) ────────────────────────────────────────────────
-- drop function if exists public.add_artist_to_archive(text);
