-- ═══════════════════════════════════════════════════════════════════════════
-- A-D2a — SQL 4 of 4: one-user migration seed (20 curated roster artists)
--
-- PRODUCT DECISION (recorded): the 20 current artists are the owner's
-- personal archive roster, NOT a universal default. Future users build their
-- own roster via onboarding, CSV discovery, or Add to Archive. Therefore this
-- seed targets EXACTLY ONE user, creates no rows for other existing users,
-- and installs no trigger/default that would seed future users.
--
-- Idempotent — safe to re-run. Rollback at bottom removes only these 20 rows
-- for the target user.
--
-- ── STEP 0: find your auth user id, then paste it below ─────────────────────
-- select id, email, created_at from auth.users order by created_at;
--
-- Replace PASTE-YOUR-USER-UUID-HERE (both occurrences are handled via the
-- target CTE — you only paste it once).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── SEED (one user only) ─────────────────────────────────────────────────────
with target as (
  select 'PASTE-YOUR-USER-UUID-HERE'::uuid as user_id
)
insert into public.user_tracked_artists (user_id, artist_id)
select t.user_id, r.artist_id
from target t
cross join (values
  ('yuka-morii'),('asako-ito'),('tomokazu-komiya'),('shinji-kanda'),
  ('atsuko-nishida'),('sowsow'),('shibuzoh'),('yukiko-baba'),('sui'),
  ('akira-egawa'),('kouki-saitou'),('saya-tsuruta'),('okacheke'),('0313'),
  ('gossan'),('mizue'),('kayama'),('gapao'),('okubo'),('fukuda')
) as r(artist_id)
where exists (select 1 from public.artists a where a.id = r.artist_id)
  and exists (select 1 from auth.users u where u.id = t.user_id)  -- guard: uuid must be a real user
on conflict (user_id, artist_id) do nothing;

-- ── VALIDATION ───────────────────────────────────────────────────────────────
-- 1) Target user has exactly 20 rows (paste the same uuid):
select count(*) as seeded
from public.user_tracked_artists
where user_id = 'PASTE-YOUR-USER-UUID-HERE'::uuid;
-- expect: 20. If 0, re-check the uuid against the auth.users query in STEP 0
-- (the guard above silently inserts nothing for an unknown uuid).

-- 2) No other user was touched:
select user_id, count(*) as tracked
from public.user_tracked_artists
group by user_id;
-- expect: exactly one row — your uuid with 20.

-- 3) The 20 ids are precisely the curated roster:
select artist_id
from public.user_tracked_artists
where user_id = 'PASTE-YOUR-USER-UUID-HERE'::uuid
  and artist_id not in ('yuka-morii','asako-ito','tomokazu-komiya',
    'shinji-kanda','atsuko-nishida','sowsow','shibuzoh','yukiko-baba','sui',
    'akira-egawa','kouki-saitou','saya-tsuruta','okacheke','0313','gossan',
    'mizue','kayama','gapao','okubo','fukuda');
-- expect: 0 rows.

-- ── ROLLBACK (only if needed — removes ONLY these 20 rows for this user) ─────
-- delete from public.user_tracked_artists
-- where user_id = 'PASTE-YOUR-USER-UUID-HERE'::uuid
--   and artist_id in ('yuka-morii','asako-ito','tomokazu-komiya',
--     'shinji-kanda','atsuko-nishida','sowsow','shibuzoh','yukiko-baba','sui',
--     'akira-egawa','kouki-saitou','saya-tsuruta','okacheke','0313','gossan',
--     'mizue','kayama','gapao','okubo','fukuda');
