-- docs/sql/cat-2d2-2-family-a-validation.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- CAT-2D.2 — deployment + validation procedure
--
-- CAT-2D.1's acceptance criterion was "nothing observable changes". CAT-2D.2 is
-- the opposite slice: things MUST change, and each change must be exactly the
-- one predicted, of exactly the predicted size, with everything else identical.
--
-- So every phase below compares a POST value against a PRE value captured live,
-- plus a predicted delta derived from real data. Nothing is hardcoded except
-- the 192 / 122 / 70 alias counts, which are the approval itself.
--
-- ─────────────────────────────────────────────────────────────────────────
-- OPERATIONAL NOTES CARRIED FORWARD FROM CAT-2D.1
-- ─────────────────────────────────────────────────────────────────────────
--   P1  auth.uid() is NULL in the SQL Editor. Both RPCs are auth.uid()-scoped,
--       so `request.jwt.claims` is set explicitly and then ASSERTED before
--       anything is captured.
--   P2  A temp table cannot survive separate Dashboard runs. Captures go into
--       PERSISTENT, privilege-locked tables that every phase re-reads.
--
-- ─────────────────────────────────────────────────────────────────────────
-- "INDEPENDENTLY RUNNABLE" — NOW ACTUALLY TRUE, AND SCOPED TO C..G
-- ─────────────────────────────────────────────────────────────────────────
-- An earlier revision of this file CLAIMED each phase was independently
-- runnable in any session after A, and it was not: Phase D established
-- `request.jwt.claims` with a session-scoped, TOP-LEVEL `select set_config(...)`
-- and Phases E and E7 then relied on it still being there. Running E on its own
-- would have raised 28000 "not authenticated", or — worse for E7, which merely
-- PRINTED its variants — rendered a tidy table of `no_active_batch` rows that
-- looked fine at a glance.
--
-- Production validation did not use that dependency; it ran self-contained E
-- and E7 statements. The committed procedure now matches the path that was
-- actually validated:
--
--   * every auth-scoped phase (D, E, E7) reads `validation_user` from
--     public.cat2d2_pre_capture, establishes `request.jwt.claims` INSIDE its own
--     DO with `is_local => true`, and ASSERTS auth.uid() before calling any RPC;
--   * no phase depends on session state an earlier phase left behind;
--   * no phase depends on a top-level BEGIN/COMMIT/ROLLBACK wrapper — G9 lost
--     its own for the same reason the Phase B migration did.
--
-- `is_local => true` also means each phase leaves the session as it found it,
-- so there is no validation identity to forget to clear afterwards.
--
-- ⚠ THE CLAIM APPLIES TO THE READ-ONLY VALIDATION PHASES C..G ONLY.
--   C, D, E, E7, F and G are genuinely self-contained: any session, any order,
--   any number of times. They read production and assert; they change nothing.
--
--   A, B and H are NOT interchangeable and are NOT re-orderable:
--     A  writes the capture tables and is a hard prerequisite of B (cat-2d2-1
--        §6 reads cat2d2_pre_refs). Re-running A is safe and rebuilds all three
--        tables, but ONLY while the alias table is still empty — its own
--        A-GUARD refuses afterwards, precisely so it cannot destroy the undo
--        list of a migration that has already run.
--     B  is the migration itself.
--     H  is DESTRUCTIVE cleanup. It drops the capture tables, including the
--        exact undo list, and must run LAST — after C..G pass, after the PR
--        merges and the app deploys, after the production smoke test.
--
-- scripts/cat2d2-family-a-alias-set.test.mjs asserts the C..G property
-- structurally, so those phases cannot regress to relying on prior-session JWT
-- state or on a transaction wrapper.
--
-- ─────────────────────────────────────────────────────────────────────────
-- ⚠ PHASE A IS A GATE AND AN INPUT, NOT JUST A SNAPSHOT
-- ─────────────────────────────────────────────────────────────────────────
-- Phase A closes CAT-2D §11 Q-1, Q-2, Q-3, Q-6 and Q-7 against production, and
-- REFUSES on:
--   * any mutable-reference merge collision (Q-3) — an explicit operator
--     decision, never an automatic one;
--   * any pair that would LOSE or CONTRADICT artist reachability (A-GATE 4);
--   * a derived map that is not exactly 192 = 122 + 70.
-- If Phase A raises, DO NOT run the migration.
--
-- Phase A also writes public.cat2d2_pre_refs, which cat-2d2-1 §6 READS and
-- compares as an exact set, in both directions, under its locks. The two runs
-- are separated in time with no lock held between them, so that comparison is
-- what makes the persistent undo list genuinely exact rather than merely
-- indicative. Do not drop cat2d2_pre_refs before Phase B.
--
-- ─────────────────────────────────────────────────────────────────────────
-- PHASES
-- ─────────────────────────────────────────────────────────────────────────
--   A0  discover the validation user                      (read-only)
--   A   PRE-DEPLOY capture + evidence gate                 (creates 3 tables)
--   B   DEPLOY                          (run cat-2d2-1-family-a-reconciliation)
--   C   POST-DEPLOY catalog, alias topology + artist gate  (read-only)
--   D   POST-DEPLOY ownership                             (read-only)
--   E   POST-DEPLOY OL-0D                                 (read-only)
--   F   POST-DEPLOY mutable + untouched data              (read-only)
--   G   security — CAT-2D.1 ACL contract unchanged        (read-only)
--   H   cleanup — drop all three capture tables
--
-- Run A0 → A → B first, in that order: A must precede B, and B must precede any
-- post-deploy phase. C, D, E, E7, F and G may then be run in any order, in any
-- session, any number of times — each is self-contained and read-only.
-- H runs LAST, at the safe point in the deployment sequence — after C..G pass,
-- after the PR is merged, the application change is deployed and the production
-- smoke test has passed. It is destructive; see the DEPLOYMENT ORDER header of
-- cat-2d2-1.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE A0 — DISCOVER THE VALIDATION USER   (read-only)
-- ═══════════════════════════════════════════════════════════════════════════

select
  b.user_id      as validation_user_uuid,
  b.id           as active_batch_id,
  b.activated_at,
  b.matcher_version,
  b.matched_rows
from public.user_import_batches b
where b.status = 'active'
order by b.activated_at desc;


-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE A — PRE-DEPLOY CAPTURE + EVIDENCE GATE   (run BEFORE cat-2d2-1)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── The ONLY line an operator edits in this file ──────────────────────────
select set_config('cat2d2.validation_user', 'PASTE-VALIDATION-USER-UUID-HERE', false);
-- ──────────────────────────────────────────────────────────────────────────

select set_config(
  'request.jwt.claims',
  json_build_object('sub', current_setting('cat2d2.validation_user'), 'role', 'authenticated')::text,
  false
);

-- ── A-GUARD RUNS FIRST, BEFORE ANY CAPTURE TABLE IS TOUCHED ───────────────
--
-- Ordering is load-bearing. The capture tables are DROPPED and rebuilt below so
-- a re-run cannot leave a stale artifact behind — but cat2d2_pre_refs is the
-- undo list for a deployed migration, so dropping it after Phase B would
-- destroy something irreplaceable.
--
-- The alias-table-empty check below is what makes the drop safe: if Phase B has
-- run, the alias table is not empty, this block raises, and nothing is dropped.
do $$
declare
  v_uid      uuid;
  v_expected text := current_setting('cat2d2.validation_user', true);
  v_batches  int;
  v_aliases  bigint;
begin
  if v_expected is null or v_expected = '' or v_expected = 'PASTE-VALIDATION-USER-UUID-HERE' then
    raise exception 'FAIL A-GUARD: paste the validation user UUID into the marked set_config line first';
  end if;

  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'FAIL A-GUARD: auth.uid() is NULL — request.jwt.claims was not applied to this session';
  end if;
  if v_uid::text <> v_expected then
    raise exception 'FAIL A-GUARD: auth.uid() is % but the validation user is %', v_uid, v_expected;
  end if;

  select count(*) into v_batches
  from public.user_import_batches where user_id = v_uid and status = 'active';
  if v_batches <> 1 then
    raise exception 'FAIL A-GUARD: validation user has % active batches, expected exactly 1', v_batches;
  end if;

  -- CAT-2D.2 is the FIRST population of the alias table. If it is not empty,
  -- something else has written identity claims and this procedure's deltas
  -- would be measured against an unknown baseline — and, critically, the drops
  -- below would discard the undo list of a migration that has already run.
  select count(*) into v_aliases from public.card_identity_aliases;
  if v_aliases <> 0 then
    raise exception
      'FAIL A-GUARD: card_identity_aliases holds % row(s) — CAT-2D.1 shipped it empty and CAT-2D.2 expects to be the first population. Phase A will NOT rebuild the capture tables while alias rows exist, because cat2d2_pre_refs would be the undo list for them. Investigate before proceeding.',
      v_aliases;
  end if;

  raise notice 'PHASE A context OK — auth.uid() = %, one active batch, alias table empty.', v_uid;
end $$;

-- ── Capture tables — DROPPED AND REBUILT, so a re-run is always clean ─────
--
-- PERSISTENT (they must survive separate SQL Editor runs), privilege-locked
-- (cat2d2_pre_refs holds user-owned card ids), all THREE dropped again in
-- Phase H.
--
-- DROP rather than `create table if not exists`, deliberately. Phase A is
-- expected to be re-run — the first production attempt refused at A-GATE 1 and
-- had already created all three tables. A `create if not exists` would then
-- KEEP whatever shape and contents the earlier revision left behind: stale
-- capture keys that no longer apply, rows for a family that has since been
-- removed from the slice, or a cat2d2_pre_map missing a column a later revision
-- added. Every one of those failures is silent and every one corrupts a
-- comparison that is supposed to be exact.
--
-- Rebuilding from scratch every time means the operator never has to reason
-- about, or hand-edit, a previous run's leftovers. Nothing here is a source of
-- truth — all three are derived, in this file, from live production state.

drop table if exists public.cat2d2_pre_capture;
create table public.cat2d2_pre_capture (
  key   text primary key,
  value jsonb not null
);
revoke all on table public.cat2d2_pre_capture from public, anon, authenticated, service_role;

-- The exact pre-migration reference rows, i.e. the undo list for §9 of the
-- migration. row_key carries the non-card_id components of each table's unique
-- key, which is what makes a reversal addressable to the exact rows migrated.
--
-- ⚠ THIS TABLE IS A HARD INPUT TO THE MIGRATION, NOT JUST A RECORD.
--   cat-2d2-1 §6 re-derives the same set under its locks and refuses unless the
--   two are IDENTICAL in both directions. Do not drop it before Phase B, and do
--   not edit it: a mismatch is the signal that a collector changed something
--   between the two SQL Editor runs, and the correct response is to re-run
--   Phase A — which rebuilds this table — not to reconcile it by hand.
drop table if exists public.cat2d2_pre_refs;
create table public.cat2d2_pre_refs (
  table_name text  not null,
  row_key    jsonb not null,
  card_id    text  not null
);
revoke all on table public.cat2d2_pre_refs from public, anon, authenticated, service_role;

-- The independently derived Family A map, MATERIALISED rather than merely
-- counted. Two things need the exact id set, not a total:
--
--   * the "unaffected catalog" checksum domain (A2 / Phase C8) must exclude
--     BOTH sides of every pair — see the comment there for why the canonical
--     side is not innocent;
--   * the artist-reachability gate (A-GATE 4 / Phase C10) compares artist_id
--     across each pair and must name the offenders.
--
-- Phase A and Phase C read the SAME rows from here, so the two checksums are
-- taken over provably the same domain rather than over two re-evaluations of a
-- predicate that could drift.
drop table if exists public.cat2d2_pre_map;
create table public.cat2d2_pre_map (
  alias_card_id       text primary key,
  canonical_card_id   text not null,
  alias_set_id        text not null,
  alias_artist_id     text,
  canonical_artist_id text
);
revoke all on table public.cat2d2_pre_map from public, anon, authenticated, service_role;

-- ── A1. The independently derived Family A map, MATERIALISED ──────────────
--
-- Derived here a SECOND time, straight from public.cards, without reading the
-- migration's allowlist. If this derivation and the migration's §5 derivation
-- ever disagree, the migration or Phase C fails — two independent derivations
-- agreeing is the point, so do not refactor them into one.
--
-- Materialised (not merely counted) because A2's checksum domain and A-GATE 4's
-- artist comparison both need the exact id set, and because Phase C must use
-- the IDENTICAL rows rather than re-evaluate a predicate that could drift.
--
-- ⚠ THE PATTERNS SELECT CANDIDATES; THEY PROVE NOTHING.
--   Only families whose historical rows kept a STABLE local_id can be derived
--   this way. Celebrations Classic Collection cannot: its historical rows are
--   stored as cel25-2A / cel25-4A / cel25-15A1 / cel25-17A / cel25-60A /
--   cel25-88A — the numbers of the originals they reproduce — not cel25-CC###.
--   The provider changed the numbering as well as the set, so no A2-compliant
--   pairing exists. It is CAT-2D.3, a separate evidence class, and must not be
--   added here. See docs/CAT-2D.3_CELEBRATIONS_IDENTITY_REMAP.md.
--
--   This was found the right way round: an earlier revision assumed cel25-CC###
--   from the survivor side, and production Phase A refused with
--   "derived Family A map holds 192 pairs, expected 217". The fail-closed
--   derivation did its job.

-- Redundant after the DROP above, kept so this statement is individually
-- re-runnable during an interactive session.
delete from public.cat2d2_pre_map;

with fam(alias_set_id, canonical_set_id, pat) as (values
  ('swsh4.5',  'swsh4.5sv',  '^SV[0-9]{3}$'),
  ('swsh12.5', 'swsh12.5gg', '^GG[0-9]{2}$')
)
insert into public.cat2d2_pre_map
  (alias_card_id, canonical_card_id, alias_set_id, alias_artist_id, canonical_artist_id)
select o.id, s.id, f.alias_set_id, o.artist_id, s.artist_id
from public.cards o
join fam f on f.alias_set_id = o.set_id and o.local_id ~ f.pat
join public.cards s on s.set_id = f.canonical_set_id
                   and upper(btrim(s.local_id)) = upper(btrim(o.local_id));

insert into public.cat2d2_pre_capture (key, value)
select 'derived_map', jsonb_build_object(
  'total',      (select count(*) from public.cat2d2_pre_map),
  'by_set',     (select jsonb_object_agg(alias_set_id, n)
                   from (select alias_set_id, count(*) as n from public.cat2d2_pre_map group by alias_set_id) q),
  'obsolete_in_cards_effective',
                (select count(*) from public.cat2d2_pre_map m
                   join public.cards_effective ce on ce.id = m.alias_card_id),
  'survivors_in_cards_effective',
                (select count(*) from public.cat2d2_pre_map m
                   join public.cards_effective ce on ce.id = m.canonical_card_id)
)
on conflict (key) do update set value = excluded.value;

-- ── A2. Catalog fingerprints ──────────────────────────────────────────────

insert into public.cat2d2_pre_capture (key, value)
select 'validation_user', to_jsonb(current_setting('cat2d2.validation_user'))
on conflict (key) do update set value = excluded.value;

insert into public.cat2d2_pre_capture (key, value)
select 'cards_rows', to_jsonb(count(*)) from public.cards
on conflict (key) do update set value = excluded.value;

insert into public.cat2d2_pre_capture (key, value)
select 'cards_effective_rows', to_jsonb(count(*)) from public.cards_effective
on conflict (key) do update set value = excluded.value;

insert into public.cat2d2_pre_capture (key, value)
select 'cards_effective_columns', jsonb_agg(column_name order by ordinal_position)
from information_schema.columns
where table_schema = 'public' and table_name = 'cards_effective'
on conflict (key) do update set value = excluded.value;

-- ── THE UNAFFECTED DOMAIN — why BOTH sides of every pair are excluded ─────
--
-- An earlier revision excluded only the 192 OBSOLETE ids and claimed everything
-- else must be byte-identical. That claim was WRONG, and it would have made
-- Phase C8 fail on a correct deployment:
--
--   cards_effective.illustrator = coalesce(card_extras.illustrator_override,
--                                          cards.illustrator)
--
--   §9 of the migration moves card_extras rows from the obsolete id ONTO the
--   canonical survivor. The survivor's `illustrator` therefore LEGITIMATELY
--   changes — for swsh12.5gg-GG69 it must, since the whole reason that override
--   is migrated rather than retired is that its casing differs from the
--   survivor's native value (CAT-2D §2.5).
--
-- So "unaffected" means: NEITHER SIDE of any of the 192 approved pairs. The
-- checksum below therefore asserts exactly one thing, and asserts it exactly:
--
--   every effective catalog row unrelated to both sides of the 192 approved
--   identity pairs is value-identical before and after.
--
-- The survivor-side changes are NOT hidden inside that exclusion — they are
-- captured immediately below and validated positively in Phase C, so an
-- unexpected survivor change is a failure rather than an untested gap.
insert into public.cat2d2_pre_capture (key, value)
select 'cards_effective_unaffected_checksum',
       to_jsonb(md5(coalesce(string_agg(md5(to_jsonb(ce)::text), ',' order by ce.id), '')))
from public.cards_effective ce
where not exists (
  select 1 from public.cat2d2_pre_map m
  where m.alias_card_id = ce.id or m.canonical_card_id = ce.id
)
on conflict (key) do update set value = excluded.value;

-- The survivors that WILL receive a migrated card_extras row, and the exact
-- illustrator value cards_effective must report for each afterwards. NULL
-- override means the survivor keeps its own cards.illustrator.
insert into public.cat2d2_pre_capture (key, value)
select 'expected_survivor_illustrator',
       coalesce(jsonb_object_agg(m.canonical_card_id,
         coalesce(to_jsonb(e.illustrator_override), to_jsonb(s.illustrator), 'null'::jsonb)), '{}'::jsonb)
from public.cat2d2_pre_map m
join public.card_extras e on e.card_id = m.alias_card_id
join public.cards s on s.id = m.canonical_card_id
on conflict (key) do update set value = excluded.value;

-- Every OTHER survivor must be value-identical after the migration: it is not
-- receiving an override, and nothing else in this slice can touch it.
insert into public.cat2d2_pre_capture (key, value)
select 'cards_effective_untouched_survivors_checksum',
       to_jsonb(md5(coalesce(string_agg(md5(to_jsonb(ce)::text), ',' order by ce.id), '')))
from public.cards_effective ce
join public.cat2d2_pre_map m on m.canonical_card_id = ce.id
where not exists (select 1 from public.card_extras e where e.card_id = m.alias_card_id)
on conflict (key) do update set value = excluded.value;

-- ── A3. Ownership + OL-0D pre-state, and the PREDICTED collapse ───────────

insert into public.cat2d2_pre_capture (key, value)
select 'owned_ids_payload', public.get_active_snapshot_owned_card_ids()
on conflict (key) do update set value = excluded.value;

insert into public.cat2d2_pre_capture (key, value)
select 'ol0d_payload',
       public.get_active_import_snapshot_read_model(null, 60, 0, null, null, null, 'all', 'name_asc')
on conflict (key) do update set value = excluded.value;

-- Q-1, answered directly rather than by inference: does the ACTIVE batch hold
-- Family A obsolete ids, and do any of them collapse onto a survivor the same
-- batch already matched?
--
--   matched_rows            unchanged by aliasing (resolution collapses IDS,
--                           never ROWS — the join cannot fan out)
--   distinct_matched        unchanged (historical ids)
--   distinct_resolved_pred  what the RPC must report AFTER the migration
--   collapse_pred           distinct_matched - distinct_resolved_pred
insert into public.cat2d2_pre_capture (key, value)
with fam(alias_set_id, canonical_set_id, pat) as (values
  ('swsh4.5',  'swsh4.5sv',  '^SV[0-9]{3}$'),
  ('swsh12.5', 'swsh12.5gg', '^GG[0-9]{2}$')
),
map as (
  select o.id as alias_card_id, s.id as canonical_card_id
  from public.cards o
  join fam f on f.alias_set_id = o.set_id and o.local_id ~ f.pat
  join public.cards s on s.set_id = f.canonical_set_id
                     and upper(btrim(s.local_id)) = upper(btrim(o.local_id))
),
batch as (
  select id from public.user_import_batches
  where user_id = current_setting('cat2d2.validation_user')::uuid and status = 'active'
),
matched as (
  select r.card_id, coalesce(m.canonical_card_id, r.card_id) as resolved_id
  from public.user_import_rows r
  join batch b on b.id = r.batch_id
  left join map m on m.alias_card_id = r.card_id
  where r.match_status = 'matched' and r.card_id is not null
)
select 'active_batch_prediction', jsonb_build_object(
  'matched_rows',            (select count(*) from matched),
  'distinct_matched',        (select count(distinct card_id) from matched),
  'distinct_resolved_pred',  (select count(distinct resolved_id) from matched),
  'collapse_pred',           (select count(distinct card_id) - count(distinct resolved_id) from matched),
  'family_a_rows',           (select count(*) from matched where card_id <> resolved_id),
  'family_a_distinct_ids',   (select count(distinct card_id) from matched where card_id <> resolved_id)
)
on conflict (key) do update set value = excluded.value;

-- Q-6 — diagnostic ONLY. candidate_card_ids is immutable historical evidence
-- and is never rewritten in either direction (CAT-2D principle 11). Recorded
-- so the number is on the record rather than unknown.
insert into public.cat2d2_pre_capture (key, value)
with fam(alias_set_id, pat) as (values
  ('swsh4.5', '^SV[0-9]{3}$'), ('swsh12.5', '^GG[0-9]{2}$')
),
obsolete as (
  select o.id from public.cards o join fam f on f.alias_set_id = o.set_id and o.local_id ~ f.pat
)
select 'candidate_card_ids_family_a_rows', to_jsonb(count(*))
from public.user_import_rows r
where exists (
  select 1 from obsolete o where o.id = any (r.candidate_card_ids)
)
on conflict (key) do update set value = excluded.value;

-- ── A4. Untouched-data fingerprints ───────────────────────────────────────

insert into public.cat2d2_pre_capture (key, value)
select 'user_import_rows_checksum',
       to_jsonb(md5(coalesce(string_agg(
         md5(coalesce(card_id,'~') || '|' || coalesce(candidate_card_ids::text,'~') || '|' ||
             match_status || '|' || coalesce(match_reason,'~')),
         ',' order by batch_id, source_row_number), '')))
from public.user_import_rows
on conflict (key) do update set value = excluded.value;

insert into public.cat2d2_pre_capture (key, value)
select 'card_extras_rows', to_jsonb(count(*)) from public.card_extras
on conflict (key) do update set value = excluded.value;

-- Content fingerprint EXCLUDING card_id: card_id is the only column this slice
-- may change, so this proves the editorial payload itself is untouched.
insert into public.cat2d2_pre_capture (key, value)
select 'card_extras_payload_checksum',
       to_jsonb(md5(coalesce(string_agg(
         md5(coalesce(illustrator_override,'~') || '|' || coalesce(source_note,'~')),
         ',' order by coalesce(illustrator_override,'~'), coalesce(source_note,'~')), '')))
from public.card_extras
on conflict (key) do update set value = excluded.value;

insert into public.cat2d2_pre_capture (key, value)
select 'card_overrides_payload_checksum',
       to_jsonb(md5(coalesce(string_agg(
         md5(o.user_id::text || '|' || o.override_type),
         ',' order by o.user_id, o.override_type), '')))
from public.card_overrides o
on conflict (key) do update set value = excluded.value;

-- ── A5. THE GATE — reference inventory and merge-collision analysis ───────
--
-- Q-2 (price_history, unmeasured by the original evidence pass) and Q-3 (merge
-- collisions) are both closed here. ANY collision REFUSES.

delete from public.cat2d2_pre_refs;

with fam(alias_set_id, canonical_set_id, pat) as (values
  ('swsh4.5',  'swsh4.5sv',  '^SV[0-9]{3}$'),
  ('swsh12.5', 'swsh12.5gg', '^GG[0-9]{2}$')
),
map as (
  select o.id as alias_card_id, s.id as canonical_card_id
  from public.cards o
  join fam f on f.alias_set_id = o.set_id and o.local_id ~ f.pat
  join public.cards s on s.set_id = f.canonical_set_id
                     and upper(btrim(s.local_id)) = upper(btrim(o.local_id))
)
insert into public.cat2d2_pre_refs (table_name, row_key, card_id)
  select 'card_extras',       jsonb_build_object(),                                              t.card_id
    from public.card_extras t       join map m on m.alias_card_id = t.card_id
union all
  select 'card_favorites',    jsonb_build_object('user_id', t.user_id),                          t.card_id
    from public.card_favorites t    join map m on m.alias_card_id = t.card_id
union all
  select 'card_overrides',    jsonb_build_object('user_id', t.user_id),                          t.card_id
    from public.card_overrides t    join map m on m.alias_card_id = t.card_id
union all
  select 'price_history',     jsonb_build_object('user_id', t.user_id,
                                                 'recorded_date', t.recorded_date),              t.card_id
    from public.price_history t     join map m on m.alias_card_id = t.card_id
union all
  select 'user_binder_cards', jsonb_build_object('binder_id', t.binder_id),                      t.card_id
    from public.user_binder_cards t join map m on m.alias_card_id = t.card_id
union all
  select 'user_card_intent',  jsonb_build_object('user_id', t.user_id),                          t.card_id
    from public.user_card_intent t  join map m on m.alias_card_id = t.card_id;

insert into public.cat2d2_pre_capture (key, value)
with fam(alias_set_id, canonical_set_id, pat) as (values
  ('swsh4.5',  'swsh4.5sv',  '^SV[0-9]{3}$'),
  ('swsh12.5', 'swsh12.5gg', '^GG[0-9]{2}$')
),
map as (
  select o.id as alias_card_id, s.id as canonical_card_id
  from public.cards o
  join fam f on f.alias_set_id = o.set_id and o.local_id ~ f.pat
  join public.cards s on s.set_id = f.canonical_set_id
                     and upper(btrim(s.local_id)) = upper(btrim(o.local_id))
),
collisions as (
  select 'card_extras' as t, count(*) as n
    from public.card_extras a join map m on m.alias_card_id = a.card_id
    join public.card_extras b on b.card_id = m.canonical_card_id
  union all
  select 'card_favorites', count(*)
    from public.card_favorites a join map m on m.alias_card_id = a.card_id
    join public.card_favorites b on b.card_id = m.canonical_card_id
                                and b.user_id is not distinct from a.user_id
  union all
  select 'card_overrides', count(*)
    from public.card_overrides a join map m on m.alias_card_id = a.card_id
    join public.card_overrides b on b.card_id = m.canonical_card_id
                                and b.user_id is not distinct from a.user_id
  union all
  select 'price_history', count(*)
    from public.price_history a join map m on m.alias_card_id = a.card_id
    join public.price_history b on b.card_id = m.canonical_card_id
                               and b.user_id is not distinct from a.user_id
                               and b.recorded_date is not distinct from a.recorded_date
  union all
  select 'user_binder_cards', count(*)
    from public.user_binder_cards a join map m on m.alias_card_id = a.card_id
    join public.user_binder_cards b on b.card_id = m.canonical_card_id
                                   and b.binder_id is not distinct from a.binder_id
  union all
  select 'user_card_intent', count(*)
    from public.user_card_intent a join map m on m.alias_card_id = a.card_id
    join public.user_card_intent b on b.card_id = m.canonical_card_id
                                  and b.user_id is not distinct from a.user_id
)
select 'reference_inventory', jsonb_build_object(
  'refs',       coalesce((select jsonb_object_agg(table_name, n)
                   from (select table_name, count(*) as n from public.cat2d2_pre_refs group by table_name) q),
                  '{}'::jsonb),
  'refs_total', (select count(*) from public.cat2d2_pre_refs),
  'collisions', (select jsonb_object_agg(t, n) from collisions),
  'collisions_total', (select coalesce(sum(n), 0) from collisions)
)
on conflict (key) do update set value = excluded.value;

-- ── A6. ARTIST-FIRST GATE — artist reachability across the 192 pairs ──────
--
-- Artist Page loads a curated artist's cards by EXACT public.cards.artist_id
-- (cardService.fetchArtistCards, the FK-only branch). Once the obsolete row
-- leaves the effective catalog, the survivor is the ONLY row that can carry
-- this printing onto an artist page.
--
-- Migrating card_extras changes the survivor's EFFECTIVE illustrator; it does
-- NOT change public.cards.artist_id, which only the sync writes. So a pair
-- whose obsolete row has an artist_id and whose survivor does not would
-- silently drop that printing off its artist's page.
--
-- CAT-0 per-set evidence makes this a live risk rather than a hypothetical:
-- 100 of 122 swsh4.5sv rows and 48 of 70 swsh12.5gg rows carry an illustrator
-- but a NULL artist_id.
--
-- Semantics:
--   obsolete NULL                       -> allowed (nothing to lose)
--   obsolete NOT NULL, survivor equal   -> allowed
--   obsolete NOT NULL, survivor NULL    -> REFUSE — reachability would be lost
--   obsolete NOT NULL, survivor differs -> REFUSE — two conflicting claims
--
-- CAT-2D.2 does NOT repair public.cards.artist_id. That is illustrator/artist
-- restoration, explicitly out of scope. A refusal here STOPS THE DEPLOYMENT and
-- becomes an evidence-backed follow-up decision — the correct outcome.
insert into public.cat2d2_pre_capture (key, value)
select 'artist_id_gate', jsonb_build_object(
  'pairs',                    (select count(*) from public.cat2d2_pre_map),
  'obsolete_with_artist_id',  (select count(*) from public.cat2d2_pre_map where alias_artist_id is not null),
  'canonical_with_artist_id', (select count(*) from public.cat2d2_pre_map where canonical_artist_id is not null),
  'preserved',                (select count(*) from public.cat2d2_pre_map
                                 where alias_artist_id is not null
                                   and canonical_artist_id = alias_artist_id),
  'would_lose',               (select count(*) from public.cat2d2_pre_map
                                 where alias_artist_id is not null and canonical_artist_id is null),
  'would_conflict',           (select count(*) from public.cat2d2_pre_map
                                 where alias_artist_id is not null
                                   and canonical_artist_id is not null
                                   and canonical_artist_id <> alias_artist_id),
  'first_offenders',          coalesce((select jsonb_agg(jsonb_build_object(
                                   'alias', alias_card_id, 'alias_artist_id', alias_artist_id,
                                   'canonical', canonical_card_id, 'canonical_artist_id', canonical_artist_id))
                                 from (select * from public.cat2d2_pre_map
                                        where alias_artist_id is not null
                                          and (canonical_artist_id is null
                                               or canonical_artist_id <> alias_artist_id)
                                        order by alias_card_id limit 20) q), '[]'::jsonb)
)
on conflict (key) do update set value = excluded.value;

do $$
declare
  v_map      jsonb;
  v_inv      jsonb;
  v_pred     jsonb;
  v_art      jsonb;
  v_state    text;
  v_coll     bigint;
begin
  select value into v_map  from public.cat2d2_pre_capture where key = 'derived_map';
  select value into v_inv  from public.cat2d2_pre_capture where key = 'reference_inventory';
  select value into v_pred from public.cat2d2_pre_capture where key = 'active_batch_prediction';
  select value into v_art  from public.cat2d2_pre_capture where key = 'artist_id_gate';

  -- A-GATE 1: the derived map must be exactly the approved shape. If it is not,
  -- the approval and the database disagree and the migration would refuse
  -- anyway — but it is far better to learn that here, before deploying.
  if (v_map ->> 'total')::bigint <> 192 then
    raise exception 'FAIL A-GATE: derived Family A map holds % pairs, expected 192 — %',
      v_map ->> 'total', v_map ->> 'by_set';
  end if;
  if (v_map #>> '{by_set,swsh4.5}')  <> '122'
     or (v_map #>> '{by_set,swsh12.5}') <> '70' then
    raise exception 'FAIL A-GATE: per-set counts are % — expected swsh4.5=122, swsh12.5=70',
      v_map ->> 'by_set';
  end if;
  if (v_map ->> 'obsolete_in_cards_effective')::bigint <> 192 then
    raise exception 'FAIL A-GATE: only % of 192 obsolete ids are in cards_effective — the expected delta is not 192',
      v_map ->> 'obsolete_in_cards_effective';
  end if;
  if (v_map ->> 'survivors_in_cards_effective')::bigint <> 192 then
    raise exception 'FAIL A-GATE: only % of 192 survivors are in cards_effective',
      v_map ->> 'survivors_in_cards_effective';
  end if;

  -- A-GATE 2: Q-3. Any collision refuses, in every table, without exception.
  v_coll := (v_inv ->> 'collisions_total')::bigint;
  if v_coll <> 0 then
    raise exception
      'FAIL A-GATE (Q-3): % merge collision(s) — a user holds BOTH the obsolete and the survivor row. DO NOT DEPLOY. Per table: %',
      v_coll, v_inv ->> 'collisions';
  end if;

  -- A-GATE 3: the captured ownership payload must be a usable target.
  select value ->> 'state' into v_state from public.cat2d2_pre_capture where key = 'owned_ids_payload';
  if v_state <> 'ready' then
    raise exception 'FAIL A-GATE: captured ownership state is % — expected ready', v_state;
  end if;

  -- A-GATE 4: artist reachability. See A6 above for the full reasoning.
  if (v_art ->> 'would_lose')::bigint <> 0 or (v_art ->> 'would_conflict')::bigint <> 0 then
    raise exception
      'FAIL A-GATE (artist): % pair(s) would LOSE artist reachability (obsolete has artist_id, survivor NULL) and % would CONFLICT (different artist_id). DO NOT DEPLOY. CAT-2D.2 does not repair cards.artist_id — this is an evidence-backed follow-up decision. Offenders: %',
      v_art ->> 'would_lose', v_art ->> 'would_conflict', jsonb_pretty(v_art -> 'first_offenders');
  end if;

  raise notice 'PHASE A PASSED — 192 pairs derived, % reference row(s) will migrate, ZERO collisions, % obsolete row(s) carry an artist_id and all are preserved, predicted aliasCollapsedCount = %.',
    v_inv ->> 'refs_total', v_art ->> 'obsolete_with_artist_id', v_pred ->> 'collapse_pred';
end $$;

-- Human-readable evidence dump. Report these figures with the deployment.
select key, jsonb_pretty(value) from public.cat2d2_pre_capture order by key;
select table_name, count(*) as rows_to_migrate
from public.cat2d2_pre_refs group by table_name order by table_name;


-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE B — DEPLOY
-- ═══════════════════════════════════════════════════════════════════════════
--   Run docs/sql/cat-2d2-1-family-a-reconciliation.sql now, top to bottom.
--   It is one transaction and needs owner privileges. No JWT context required.
--   Do NOT proceed if Phase A raised.
--
--   ⚠ Do NOT drop public.cat2d2_pre_refs first. The migration's §6 reads it and
--     refuses unless the reference set it is about to migrate is IDENTICAL, in
--     both directions, to what Phase A captured. If a collector changed a
--     favourite / price point / intent / binder row / override in between, §6
--     refuses with errcode 40001 — re-run Phase A and re-review rather than
--     editing the capture.


-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE C — POST-DEPLOY CATALOG + ALIAS TOPOLOGY   (read-only)
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare
  v_pre jsonb; v_now jsonb; v_map jsonb; v_exp jsonb; v_n bigint; v_txt text;
begin
  select value into v_map from public.cat2d2_pre_capture where key = 'derived_map';
  if v_map is null then
    raise exception 'FAIL C-GUARD: no capture found — run Phase A first';
  end if;

  -- C1. Alias topology: exactly 192 Family A rows, and nothing else.
  select count(*) into v_n from public.card_identity_aliases;
  if v_n <> 192 then
    raise exception 'FAIL C1: card_identity_aliases holds % rows, expected 192', v_n;
  end if;
  select count(*) into v_n from public.card_identity_aliases where slice = 'CAT-2D.2';
  if v_n <> 192 then
    raise exception 'FAIL C1: % rows carry slice CAT-2D.2, expected 192', v_n;
  end if;

  select count(*) into v_n from public.card_identity_aliases
   where evidence ->> 'family_token' = 'shining_fates_sv';
  if v_n <> 122 then raise exception 'FAIL C1: shining_fates_sv has % aliases, expected 122', v_n; end if;
  select count(*) into v_n from public.card_identity_aliases
   where evidence ->> 'family_token' = 'crown_zenith_gg';
  if v_n <> 70 then raise exception 'FAIL C1: crown_zenith_gg has % aliases, expected 70', v_n; end if;

  -- C2. INV-9 — no self-alias, no chain in either direction, depth exactly 1.
  select count(*) into v_n from public.card_identity_aliases where alias_card_id = canonical_card_id;
  if v_n <> 0 then raise exception 'FAIL C2: % self-alias row(s)', v_n; end if;
  select count(*) into v_n
  from public.card_identity_aliases a join public.card_identity_aliases b
    on b.canonical_card_id = a.alias_card_id;
  if v_n <> 0 then raise exception 'FAIL C2: % chain(s) — an alias targets another alias', v_n; end if;
  select count(*) into v_n from (
    select canonical_card_id from public.card_identity_aliases
    group by canonical_card_id having count(*) > 1
  ) q;
  if v_n <> 0 then raise exception 'FAIL C2: % survivor(s) claimed by >1 alias — Family A is 1:1', v_n; end if;

  -- C3. INV-8 — every survivor exists, and is itself canonical.
  select count(*) into v_n from public.card_identity_aliases a
  where not exists (select 1 from public.cards c where c.id = a.canonical_card_id);
  if v_n <> 0 then raise exception 'FAIL C3: % orphan alias row(s)', v_n; end if;
  select count(*) into v_n from public.card_identity_aliases a
  where not exists (select 1 from public.cards_effective ce where ce.id = a.canonical_card_id);
  if v_n <> 0 then raise exception 'FAIL C3: % survivor(s) are not in the effective catalog', v_n; end if;

  -- C4. Every alias is evidence-backed. Not "evidence is non-null" — the
  --     specific admission record must be present on every row.
  select count(*) into v_n from public.card_identity_aliases
  where evidence ->> 'proof' is distinct from 'upstream_set_rename'
     or evidence ->> 'family_token' is null
     or (evidence -> 'admission_rules') is null
     or jsonb_array_length(evidence -> 'admission_rules') <> 5
     or (evidence #>> '{alias,name}') is null
     or (evidence #>> '{canonical,name}') is null
     or (evidence ->> 'alias_upstream_status') <> '404'
     or (evidence ->> 'canonical_upstream_status') <> '200'
     or evidence ->> 'evidence_artifact_sha256' is null
     or coalesce(btrim(approved_by), '') = ''
     or slice <> 'CAT-2D.2';
  if v_n <> 0 then
    raise exception 'FAIL C4: % alias row(s) are not fully evidence-backed', v_n;
  end if;

  -- C5. INV-12 — raw provider history preserved.
  select value into v_pre from public.cat2d2_pre_capture where key = 'cards_rows';
  select to_jsonb(count(*)) into v_now from public.cards;
  if v_pre is distinct from v_now then
    raise exception 'FAIL C5 (INV-12): public.cards row count changed: % -> %', v_pre, v_now;
  end if;
  select count(*) into v_n from public.card_identity_aliases a
  where not exists (select 1 from public.cards c where c.id = a.alias_card_id);
  if v_n <> 0 then
    raise exception 'FAIL C5 (INV-12): % obsolete row(s) left public.cards — they must be retained', v_n;
  end if;

  -- C6. INV-13 — cards_effective shrank by EXACTLY 192.
  select value into v_pre from public.cat2d2_pre_capture where key = 'cards_effective_rows';
  select to_jsonb(count(*)) into v_now from public.cards_effective;
  if (v_now #>> '{}')::bigint <> (v_pre #>> '{}')::bigint - 192 then
    raise exception 'FAIL C6 (INV-13): cards_effective went % -> %, expected a decrease of exactly 192', v_pre, v_now;
  end if;

  -- C7. INV-10 — no alias id in the effective catalog; cards unconstrained.
  select count(*) into v_n
  from public.cards_effective ce join public.card_identity_aliases a on a.alias_card_id = ce.id;
  if v_n <> 0 then raise exception 'FAIL C7 (INV-10): % aliased id(s) still in cards_effective', v_n; end if;

  -- C8. No UNRELATED effective row changed — value-level, not count-level.
  --     The domain is BOTH sides of every one of the 192 pairs, read from the
  --     same cat2d2_pre_map rows Phase A used. A canonical survivor is NOT
  --     unrelated: §9 moves card_extras onto it and cards_effective.illustrator
  --     is coalesce(illustrator_override, cards.illustrator), so a survivor can
  --     legitimately change value. Those changes are validated positively in
  --     C8b/C8c rather than hidden inside this exclusion.
  select value into v_pre from public.cat2d2_pre_capture where key = 'cards_effective_unaffected_checksum';
  select to_jsonb(md5(coalesce(string_agg(md5(to_jsonb(ce)::text), ',' order by ce.id), '')))
    into v_now
  from public.cards_effective ce
  where not exists (
    select 1 from public.cat2d2_pre_map m
    where m.alias_card_id = ce.id or m.canonical_card_id = ce.id
  );
  if v_pre is distinct from v_now then
    raise exception 'FAIL C8: an effective catalog row unrelated to BOTH sides of the 192 approved pairs changed';
  end if;

  -- C8b. Survivors that received a migrated card_extras row report EXACTLY the
  --      illustrator Phase A predicted — no more, no less. This is where
  --      swsh12.5gg-GG69 must show the migrated override rather than its own
  --      differently-cased native value (CAT-2D §2.5).
  select value into v_exp from public.cat2d2_pre_capture where key = 'expected_survivor_illustrator';
  select count(*) into v_n
  from jsonb_each_text(v_exp) exp(card_id, expected)
  left join public.cards_effective ce on ce.id = exp.card_id
  where ce.id is null or ce.illustrator is distinct from exp.expected;
  if v_n <> 0 then
    select string_agg(format('%s expected "%s" got "%s"',
             exp.card_id, exp.expected, coalesce(ce.illustrator, '<no effective row>')), '; ') into v_txt
    from jsonb_each_text(v_exp) exp(card_id, expected)
    left join public.cards_effective ce on ce.id = exp.card_id
    where ce.id is null or ce.illustrator is distinct from exp.expected;
    raise exception 'FAIL C8b: % survivor(s) do not report the predicted illustrator after card_extras migration: %', v_n, v_txt;
  end if;

  -- C8c. Every OTHER survivor is value-identical. The domain is the exact
  --      complement of C8b within the survivor set, so C8 + C8b + C8c account
  --      for every effective-catalog row exactly once, with no gap.
  --
  --      The predicate is expressed against the CAPTURED expectation rather
  --      than against card_extras: after §9 the overrides no longer sit on the
  --      obsolete ids, so Phase A's original predicate is not re-computable
  --      here, and re-deriving it from the post-state would beg the question.
  select value into v_pre from public.cat2d2_pre_capture where key = 'cards_effective_untouched_survivors_checksum';
  select to_jsonb(md5(coalesce(string_agg(md5(to_jsonb(ce)::text), ',' order by ce.id), '')))
    into v_now
  from public.cards_effective ce
  join public.cat2d2_pre_map m on m.canonical_card_id = ce.id
  where not (v_exp ? ce.id);
  if v_pre is distinct from v_now then
    raise exception 'FAIL C8c: a canonical survivor that received NO migrated card_extras row changed value';
  end if;

  -- C10. ARTIST-FIRST GATE, re-asserted after deployment. A-GATE 4 proved this
  --      before the migration; this proves the migration did not change it —
  --      it must not, since nothing here writes public.cards.artist_id.
  select count(*) into v_n
  from public.cat2d2_pre_map m
  join public.cards s on s.id = m.canonical_card_id
  where m.alias_artist_id is not null
    and (s.artist_id is null or s.artist_id <> m.alias_artist_id);
  if v_n <> 0 then
    select string_agg(format('%s artist_id=%s -> %s artist_id=%s',
             m.alias_card_id, m.alias_artist_id, m.canonical_card_id, coalesce(s.artist_id, '<null>')), '; ')
      into v_txt
    from public.cat2d2_pre_map m
    join public.cards s on s.id = m.canonical_card_id
    where m.alias_artist_id is not null
      and (s.artist_id is null or s.artist_id <> m.alias_artist_id);
    raise exception
      'FAIL C10 (artist): % pair(s) lost or contradict artist reachability after deployment. The survivor is now the only effective row for the printing, so it must carry the artist_id. %',
      v_n, v_txt;
  end if;

  -- C11. The 14-column contract and security_invoker are untouched by this slice.
  select value into v_pre from public.cat2d2_pre_capture where key = 'cards_effective_columns';
  select jsonb_agg(column_name order by ordinal_position) into v_now
  from information_schema.columns
  where table_schema = 'public' and table_name = 'cards_effective';
  if v_pre is distinct from v_now then
    raise exception 'FAIL C11: cards_effective column list changed: % -> %', v_pre, v_now;
  end if;
  select unnest(reloptions) into v_txt
  from pg_class where oid = 'public.cards_effective'::regclass and reloptions is not null limit 1;
  if coalesce(v_txt, '') <> 'security_invoker=true' then
    raise exception 'FAIL C11: cards_effective must remain security_invoker=true (found %)', coalesce(v_txt, '<none>');
  end if;

  raise notice 'PHASE C PASSED — 192 evidence-backed aliases, depth 1, cards unchanged, cards_effective -192, % survivor(s) changed illustrator exactly as predicted, every other row identical, artist reachability intact.',
    (select count(*) from jsonb_object_keys(v_exp));
end $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE D — POST-DEPLOY OWNERSHIP   (read-only)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The one phase where a false positive would be an ownership harm rather than
-- a cosmetic defect. Every assertion here is about the OWNED SET, not counts
-- alone: the post-migration owned set must be exactly the pre-migration set
-- with Family A historical ids REPLACED by their survivors — no addition, no
-- unexplained removal.
--
-- SELF-CONTAINED. The JWT context is recovered from the capture table and
-- established INSIDE this DO, then asserted, so this phase depends on nothing
-- an earlier phase left behind in the session. See the header note on why that
-- matters for this file.

do $$
declare
  v_pre    jsonb;
  v_now    jsonb;
  v_pred   jsonb;
  v_uid    uuid;
  v_exp    text;
  v_added  text[];
  v_lost   text[];
begin
  select value #>> '{}' into v_exp from public.cat2d2_pre_capture where key = 'validation_user';
  if v_exp is null then
    raise exception 'FAIL D-GUARD: no capture found — run Phase A first';
  end if;

  -- Establish the authenticated identity this phase needs, here, from the
  -- capture. `is_local => true` scopes it to the surrounding transaction, so
  -- this DO leaves no identity behind in the session either.
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_exp, 'role', 'authenticated')::text,
    true
  );

  v_uid := auth.uid();
  if v_uid is null or v_uid::text <> v_exp then
    raise exception 'FAIL D-GUARD: auth.uid() is % but the capture was taken as %', v_uid, v_exp;
  end if;

  select value into v_pre  from public.cat2d2_pre_capture where key = 'owned_ids_payload';
  select value into v_pred from public.cat2d2_pre_capture where key = 'active_batch_prediction';
  v_now := public.get_active_snapshot_owned_card_ids();

  if (v_now ->> 'state') <> 'ready' then
    raise exception 'FAIL D1: ownership state is % — expected ready', v_now ->> 'state';
  end if;
  if (v_now ->> 'contractVersion') <> '1' then
    raise exception 'FAIL D1: contractVersion must remain 1';
  end if;
  if (v_pre ->> 'batchId') is distinct from (v_now ->> 'batchId')
     or (v_pre ->> 'activatedAt') is distinct from (v_now ->> 'activatedAt')
     or (v_pre ->> 'matcherVersion') is distinct from (v_now ->> 'matcherVersion') then
    raise exception 'FAIL D1: batch metadata changed — the active snapshot is not the one that was captured';
  end if;

  -- D2. matchedRows is HISTORICAL and must not move. Alias resolution collapses
  --     IDS, never ROWS; the resolution join cannot fan out because
  --     alias_card_id is a primary key.
  if (v_pre #>> '{reconciliation,matchedRows}') is distinct from (v_now #>> '{reconciliation,matchedRows}') then
    raise exception 'FAIL D2: matchedRows changed % -> % — rows must be unaffected by aliasing',
      v_pre #>> '{reconciliation,matchedRows}', v_now #>> '{reconciliation,matchedRows}';
  end if;

  -- D3. distinctMatchedCardIds is HISTORICAL and must not move either.
  if (v_pre #>> '{reconciliation,distinctMatchedCardIds}')
     is distinct from (v_now #>> '{reconciliation,distinctMatchedCardIds}') then
    raise exception 'FAIL D3: distinctMatchedCardIds changed % -> % — historical ids must be unaffected',
      v_pre #>> '{reconciliation,distinctMatchedCardIds}', v_now #>> '{reconciliation,distinctMatchedCardIds}';
  end if;

  -- D4. distinctResolvedCardIds must equal the value PREDICTED in Phase A from
  --     the independently derived map.
  if (v_now #>> '{reconciliation,distinctResolvedCardIds}')
     is distinct from (v_pred ->> 'distinct_resolved_pred') then
    raise exception 'FAIL D4: distinctResolvedCardIds is % but Phase A predicted %',
      v_now #>> '{reconciliation,distinctResolvedCardIds}', v_pred ->> 'distinct_resolved_pred';
  end if;

  -- D5. aliasCollapsedCount is exactly distinctMatched - distinctResolved, and
  --     exactly the predicted collapse.
  if (v_now #>> '{reconciliation,aliasCollapsedCount}')::bigint
     <> (v_now #>> '{reconciliation,distinctMatchedCardIds}')::bigint
      - (v_now #>> '{reconciliation,distinctResolvedCardIds}')::bigint then
    raise exception 'FAIL D5: aliasCollapsedCount is not distinctMatched - distinctResolved';
  end if;
  if (v_now #>> '{reconciliation,aliasCollapsedCount}') is distinct from (v_pred ->> 'collapse_pred') then
    raise exception 'FAIL D5: aliasCollapsedCount is % but Phase A predicted %',
      v_now #>> '{reconciliation,aliasCollapsedCount}', v_pred ->> 'collapse_pred';
  end if;

  -- D6. Owned ids are CANONICAL — no owned id is an alias.
  select array_agg(x order by x) into v_added
  from jsonb_array_elements_text(v_now -> 'ownedCardIds') t(x)
  where exists (select 1 from public.card_identity_aliases a where a.alias_card_id = x);
  if v_added is not null then
    raise exception 'FAIL D6: % owned id(s) are aliases, not canonical survivors: %',
      array_length(v_added, 1), array_to_string(v_added[1:10], ', ');
  end if;

  -- D7. NO FALSE-POSITIVE OWNERSHIP. Every post id must either be a pre id, or
  --     be the survivor of a pre id. Anything else is a printing the collector
  --     did not own under any identity.
  select array_agg(x order by x) into v_added
  from jsonb_array_elements_text(v_now -> 'ownedCardIds') t(x)
  where not exists (select 1 from jsonb_array_elements_text(v_pre -> 'ownedCardIds') p(y) where p.y = t.x)
    and not exists (
      select 1 from public.card_identity_aliases a
      join jsonb_array_elements_text(v_pre -> 'ownedCardIds') p(y) on p.y = a.alias_card_id
      where a.canonical_card_id = t.x
    );
  if v_added is not null then
    raise exception 'FAIL D7: % owned id(s) appeared that were NOT owned before and are not a survivor of a previously owned id: %',
      array_length(v_added, 1), array_to_string(v_added[1:10], ', ');
  end if;

  -- D8. NO SILENT OWNERSHIP LOSS. Every pre id must still be represented, as
  --     itself or as its survivor.
  select array_agg(y order by y) into v_lost
  from jsonb_array_elements_text(v_pre -> 'ownedCardIds') p(y)
  where not exists (select 1 from jsonb_array_elements_text(v_now -> 'ownedCardIds') t(x) where t.x = p.y)
    and not exists (
      select 1 from public.card_identity_aliases a
      join jsonb_array_elements_text(v_now -> 'ownedCardIds') t(x) on t.x = a.canonical_card_id
      where a.alias_card_id = p.y
    );
  if v_lost is not null then
    raise exception 'FAIL D8: % previously owned id(s) are no longer represented: %',
      array_length(v_lost, 1), array_to_string(v_lost[1:10], ', ');
  end if;

  -- D9. The set size must equal distinctResolvedCardIds. This is the exact
  --     assertion the App wrapper makes; failing it here rather than in the
  --     browser is the point of running this phase.
  if jsonb_array_length(v_now -> 'ownedCardIds') <> (v_now #>> '{reconciliation,distinctResolvedCardIds}')::int then
    raise exception 'FAIL D9: ownedCardIds length % <> distinctResolvedCardIds %',
      jsonb_array_length(v_now -> 'ownedCardIds'), v_now #>> '{reconciliation,distinctResolvedCardIds}';
  end if;

  raise notice 'PHASE D PASSED — matchedRows and distinctMatched historical, resolved = % (predicted), collapse = %, no ownership added or lost.',
    v_now #>> '{reconciliation,distinctResolvedCardIds}', v_now #>> '{reconciliation,aliasCollapsedCount}';
end $$;

-- D10. INV-3 — swsh12.5-GG19 must be owned at every gate, under whichever id
--      currently represents it. The override is the SOLE reason it is owned.
select
  (select count(*) from public.card_overrides where card_id = 'swsh12.5-GG19')    as obsolete_override_rows_must_be_0,
  (select count(*) from public.card_overrides where card_id = 'swsh12.5gg-GG19')  as survivor_override_rows,
  (select override_type from public.card_overrides where card_id = 'swsh12.5gg-GG19' limit 1) as survivor_override_type,
  (select count(*) from public.cards_effective where id = 'swsh12.5gg-GG19')      as survivor_in_effective_must_be_1,
  (select count(*) from public.cards_effective where id = 'swsh12.5-GG19')        as obsolete_in_effective_must_be_0;


-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE E — POST-DEPLOY OL-0D   (read-only)
-- ═══════════════════════════════════════════════════════════════════════════

-- SELF-CONTAINED. OL-0D is SECURITY INVOKER and auth.uid()-scoped, so this
-- phase needs an authenticated identity — and it establishes its own from the
-- capture rather than inheriting whatever Phase D happened to leave in the
-- session. Without this, running E on its own raises 28000 "not authenticated",
-- which is a confusing way to discover a session assumption.

do $$
declare
  v_pre jsonb; v_now jsonb; v_pred jsonb;
  v_pre_missing bigint; v_now_missing bigint;
  v_pre_distinct bigint; v_now_distinct bigint;
  v_pre_qty bigint; v_now_qty bigint;
  v_exp text; v_uid uuid;
begin
  select value #>> '{}' into v_exp from public.cat2d2_pre_capture where key = 'validation_user';
  if v_exp is null then
    raise exception 'FAIL E-GUARD: no capture found — run Phase A first';
  end if;
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_exp, 'role', 'authenticated')::text,
    true
  );
  v_uid := auth.uid();
  if v_uid is null or v_uid::text <> v_exp then
    raise exception 'FAIL E-GUARD: auth.uid() is % but the capture was taken as %', v_uid, v_exp;
  end if;

  select value into v_pre  from public.cat2d2_pre_capture where key = 'ol0d_payload';
  select value into v_pred from public.cat2d2_pre_capture where key = 'active_batch_prediction';
  v_now := public.get_active_import_snapshot_read_model(null, 60, 0, null, null, null, 'all', 'name_asc');

  if (v_now ->> 'state') <> 'ready' then
    raise exception 'FAIL E1: OL-0D state is % — expected ready', v_now ->> 'state';
  end if;

  -- E2. Row-level summary numbers are historical and must not move.
  if (v_pre #>> '{summary,matchedRows}')   is distinct from (v_now #>> '{summary,matchedRows}')
   or (v_pre #>> '{summary,storedRows}')   is distinct from (v_now #>> '{summary,storedRows}')
   or (v_pre #>> '{summary,unresolvedRows}') is distinct from (v_now #>> '{summary,unresolvedRows}') then
    raise exception 'FAIL E2: OL-0D row-level summary changed — aliasing must not affect rows';
  end if;

  -- E3. Quantities MERGE, never vanish. Total matched quantity is conserved
  --     exactly: collapsing two historical ids adds their quantities together.
  v_pre_qty := (v_pre #>> '{summary,matchedQuantity}')::bigint;
  v_now_qty := (v_now #>> '{summary,matchedQuantity}')::bigint;
  if v_pre_qty <> v_now_qty then
    raise exception 'FAIL E3: matchedQuantity changed % -> % — collapse must conserve quantity, not lose it',
      v_pre_qty, v_now_qty;
  end if;

  -- E4. distinctCanonicalCards falls by exactly the predicted collapse.
  v_pre_distinct := (v_pre #>> '{summary,distinctCanonicalCards}')::bigint;
  v_now_distinct := (v_now #>> '{summary,distinctCanonicalCards}')::bigint;
  if v_now_distinct <> v_pre_distinct - (v_pred ->> 'collapse_pred')::bigint then
    raise exception 'FAIL E4: distinctCanonicalCards went % -> %, expected a decrease of exactly % (the predicted collapse)',
      v_pre_distinct, v_now_distinct, v_pred ->> 'collapse_pred';
  end if;

  -- E5. INV-11 — catalog-missing must NOT regress. A historical Family A id now
  --     resolves onto its survivor's catalog row, so this can only improve.
  v_pre_missing := (v_pre #>> '{summary,catalogMissingCards}')::bigint;
  v_now_missing := (v_now #>> '{summary,catalogMissingCards}')::bigint;
  if v_now_missing > v_pre_missing then
    raise exception 'FAIL E5 (INV-11): catalogMissingCards regressed % -> %', v_pre_missing, v_now_missing;
  end if;

  -- E6. No page item carries an aliased card id.
  if exists (
    select 1 from jsonb_array_elements(v_now #> '{page,items}') it
    join public.card_identity_aliases a on a.alias_card_id = it.value ->> 'cardId'
  ) then
    raise exception 'FAIL E6: an OL-0D page item still carries an aliased cardId';
  end if;

  raise notice 'PHASE E PASSED — rows and quantity conserved, distinct cards -%, catalog-missing % -> %.',
    v_pred ->> 'collapse_pred', v_pre_missing, v_now_missing;
end $$;

-- ── E7. Pagination, filtering and sorting still behave ────────────────────
--
-- This was a bare SELECT that PRINTED eight rows for a human to eyeball. It is
-- now a DO that ASSERTS, because printing is not validation: a variant that
-- came back 'no_active_batch' — which is exactly what an OL-0D call answers
-- with no JWT — would have rendered as a tidy row nobody looked at twice.
--
-- Two assertions, matching what production actually checked:
--   1. all EIGHT variants answer 'ready';
--   2. the four UNFILTERED variants (name_asc, set_asc, quantity_desc and the
--      offset page) agree on totalItems. Sorting must not change how many rows
--      exist, and neither must paging — totalItems is the count BEFORE
--      LIMIT/OFFSET. The filtered variants legitimately differ and are checked
--      for 'ready' only.
--
-- Self-contained, like D and E: it recovers the validation user from the
-- capture and establishes its own transaction-local JWT.

do $$
declare
  v_exp     text;
  v_uid     uuid;
  r         record;
  v_payload jsonb;
  v_total   bigint;
  v_unfiltered_total bigint := null;
  v_variants int := 0;
  v_report  text := '';
begin
  select value #>> '{}' into v_exp from public.cat2d2_pre_capture where key = 'validation_user';
  if v_exp is null then
    raise exception 'FAIL E7-GUARD: no capture found — run Phase A first';
  end if;
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_exp, 'role', 'authenticated')::text,
    true
  );
  v_uid := auth.uid();
  if v_uid is null or v_uid::text <> v_exp then
    raise exception 'FAIL E7-GUARD: auth.uid() is % but the capture was taken as %', v_uid, v_exp;
  end if;

  for r in
    select * from (values
      (1, 'sort=name_asc',      60,  0, null::text,   'all',       'name_asc',      true),
      (2, 'sort=set_asc',       60,  0, null,         'all',       'set_asc',       true),
      (3, 'sort=quantity_desc', 60,  0, null,         'all',       'quantity_desc', true),
      (4, 'offset page 2',      60, 60, null,         'all',       'name_asc',      true),
      (5, 'status=available',   60,  0, null,         'available', 'name_asc',      false),
      (6, 'status=missing',     60,  0, null,         'missing',   'name_asc',      false),
      (7, 'set_id=swsh12.5gg',  60,  0, 'swsh12.5gg', 'all',       'name_asc',      false),
      (8, 'set_id=swsh12.5',    60,  0, 'swsh12.5',   'all',       'name_asc',      false)
    ) t(ord, label, lim, ofs, set_id, status, sort, unfiltered)
    order by ord
  loop
    select public.get_active_import_snapshot_read_model(
             null, r.lim, r.ofs, null, r.set_id, null, r.status, r.sort)
      into v_payload;

    if (v_payload ->> 'state') <> 'ready' then
      raise exception 'FAIL E7: variant "%" answered state=% — expected ready', r.label, v_payload ->> 'state';
    end if;

    v_total := (v_payload #>> '{page,totalItems}')::bigint;

    if r.unfiltered then
      if v_unfiltered_total is null then
        v_unfiltered_total := v_total;
      elsif v_total <> v_unfiltered_total then
        raise exception
          'FAIL E7: unfiltered variant "%" reports totalItems=% but the other unfiltered variants report % — sorting and paging must not change how many rows exist',
          r.label, v_total, v_unfiltered_total;
      end if;
    end if;

    v_variants := v_variants + 1;
    v_report := v_report || format('%s=%s; ', r.label, v_total);
  end loop;

  if v_variants <> 8 then
    raise exception 'FAIL E7: % variants exercised, expected 8', v_variants;
  end if;
  if v_unfiltered_total is null then
    raise exception 'FAIL E7: no unfiltered variant ran — the totalItems agreement was never tested';
  end if;

  raise notice 'PHASE E7 PASSED — 8/8 variants ready; the 4 unfiltered variants all report totalItems=%. %',
    v_unfiltered_total, v_report;
end $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE F — MUTABLE + UNTOUCHED DATA   (read-only)
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare
  v_pre jsonb; v_now jsonb; v_inv jsonb; v_n bigint; r record;
begin
  select value into v_inv from public.cat2d2_pre_capture where key = 'reference_inventory';

  -- F1. INV-7 — historical import evidence byte-identical.
  select value into v_pre from public.cat2d2_pre_capture where key = 'user_import_rows_checksum';
  select to_jsonb(md5(coalesce(string_agg(
           md5(coalesce(card_id,'~') || '|' || coalesce(candidate_card_ids::text,'~') || '|' ||
               match_status || '|' || coalesce(match_reason,'~')),
           ',' order by batch_id, source_row_number), '')))
    into v_now from public.user_import_rows;
  if v_pre is distinct from v_now then
    raise exception 'FAIL F1 (INV-7): user_import_rows changed — historical evidence must be immutable';
  end if;

  -- F2. Every captured reference row moved to its survivor, and NOTHING else
  --     in those tables moved. Row counts per table are unchanged: this slice
  --     performs UPDATEs only, never INSERT or DELETE.
  for r in select table_name, count(*) as n from public.cat2d2_pre_refs group by table_name loop
    execute format('select count(*) from public.%I t join public.card_identity_aliases a on a.alias_card_id = t.card_id', r.table_name)
      into v_n;
    if v_n <> 0 then
      raise exception 'FAIL F2: public.% still holds % obsolete reference(s)', r.table_name, v_n;
    end if;
  end loop;

  -- F3. card_extras: same number of rows, same editorial payload. INV-5.
  select value into v_pre from public.cat2d2_pre_capture where key = 'card_extras_rows';
  select to_jsonb(count(*)) into v_now from public.card_extras;
  if v_pre is distinct from v_now then
    raise exception 'FAIL F3 (INV-5): card_extras row count changed % -> % — this slice may only UPDATE card_id', v_pre, v_now;
  end if;
  select value into v_pre from public.cat2d2_pre_capture where key = 'card_extras_payload_checksum';
  select to_jsonb(md5(coalesce(string_agg(
           md5(coalesce(illustrator_override,'~') || '|' || coalesce(source_note,'~')),
           ',' order by coalesce(illustrator_override,'~'), coalesce(source_note,'~')), '')))
    into v_now from public.card_extras;
  if v_pre is distinct from v_now then
    raise exception 'FAIL F3 (INV-5): a card_extras illustrator_override or source_note changed';
  end if;

  -- F4. card_overrides: the (user_id, override_type) multiset is unchanged.
  --     Ownership authority moved id, never meaning.
  select value into v_pre from public.cat2d2_pre_capture where key = 'card_overrides_payload_checksum';
  select to_jsonb(md5(coalesce(string_agg(
           md5(o.user_id::text || '|' || o.override_type),
           ',' order by o.user_id, o.override_type), '')))
    into v_now from public.card_overrides o;
  if v_pre is distinct from v_now then
    raise exception 'FAIL F4: a card_overrides row changed beyond its card_id';
  end if;

  -- F5. The undo list is still addressable: every id captured in Phase A by the
  --     INDEPENDENT derivation is an id the deployed allowlist actually aliased.
  --     If the two ever disagreed, cat2d2_pre_refs would describe a reversal
  --     that cannot be performed — so this is checked before Phase H drops it.
  select count(*) into v_n
  from public.cat2d2_pre_refs p
  where not exists (
    select 1 from public.card_identity_aliases a where a.alias_card_id = p.card_id
  );
  if v_n <> 0 then
    raise exception
      'FAIL F5: % captured reference row(s) point at an id the migration did NOT alias — Phase A''s independent derivation and the deployed allowlist disagree, so the undo list is not trustworthy',
      v_n;
  end if;

  raise notice 'PHASE F PASSED — import evidence immutable, % reference row(s) migrated, no payload changed.',
    v_inv ->> 'refs_total';
end $$;

-- F6. Per-table before/after fingerprint, for the deployment report.
select
  p.table_name,
  count(*)                                                as migrated_rows,
  count(distinct p.card_id)                               as distinct_obsolete_ids,
  count(distinct a.canonical_card_id)                     as distinct_canonical_ids
from public.cat2d2_pre_refs p
left join public.card_identity_aliases a on a.alias_card_id = p.card_id
group by p.table_name
order by p.table_name;


-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE G — SECURITY: THE CAT-2D.1 ACL CONTRACT IS UNCHANGED   (read-only)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- CAT-2D.2 populates rows; it must not have moved a single privilege. The
-- assertions below are the CAT-2D.1 Phase E contract, re-run verbatim.
--
-- These matter MORE now than they did in CAT-2D.1: the alias table is no
-- longer empty, so a privilege leak would expose real provenance — evidence,
-- approved_by, approved_at — rather than an empty set.

do $$
declare r text; p text;
begin
  -- G1. Base table: all three runtime roles have NOTHING. service_role is
  --     included deliberately — it bypasses RLS, so the explicit REVOKE is the
  --     only thing containing it.
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    foreach p in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
      if has_table_privilege(r, 'public.card_identity_aliases', p) then
        raise exception 'FAIL G1: % must NOT have % on card_identity_aliases', r, p;
      end if;
    end loop;
  end loop;

  -- G2/G3. Resolution view: SELECT for the three read roles, and NO write
  --        privilege for anyone — it is automatically updatable and owner-rights.
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if not has_table_privilege(r, 'public.card_identity_resolution', 'SELECT') then
      raise exception 'FAIL G2: % must have SELECT on card_identity_resolution', r;
    end if;
    foreach p in array array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
      if has_table_privilege(r, 'public.card_identity_resolution', p) then
        raise exception 'FAIL G3: % must NOT have % on card_identity_resolution', r, p;
      end if;
    end loop;
  end loop;

  -- G4. The view still projects exactly two columns — provenance stays
  --     unreachable now that there is provenance to reach.
  if (select string_agg(column_name, ',' order by ordinal_position)
        from information_schema.columns
       where table_schema = 'public' and table_name = 'card_identity_resolution')
     <> 'alias_card_id,canonical_card_id' then
    raise exception 'FAIL G4: resolution view must project exactly alias_card_id,canonical_card_id';
  end if;

  -- G5. RLS enabled with no policies, behind the revoked grants.
  if not (select relrowsecurity from pg_class where oid = 'public.card_identity_aliases'::regclass) then
    raise exception 'FAIL G5: RLS must be enabled on card_identity_aliases';
  end if;
  if (select count(*) from pg_policies where schemaname='public' and tablename='card_identity_aliases') <> 0 then
    raise exception 'FAIL G5: card_identity_aliases must have NO RLS policies';
  end if;

  -- G6. Consumer security properties unchanged.
  if not (select prosecdef from pg_proc p2 join pg_namespace n on n.oid = p2.pronamespace
           where n.nspname='public' and p2.proname='get_active_snapshot_owned_card_ids') then
    raise exception 'FAIL G6: ownership RPC must remain SECURITY DEFINER';
  end if;
  if (select prosecdef from pg_proc p2 join pg_namespace n on n.oid = p2.pronamespace
       where n.nspname='public' and p2.proname='get_active_import_snapshot_read_model') then
    raise exception 'FAIL G6: OL-0D must remain SECURITY INVOKER';
  end if;

  -- G7. EXECUTE ACLs match the CAT-2D.0 recovered production contract.
  foreach r in array array['postgres','anon','authenticated','service_role'] loop
    if not has_function_privilege(r,
         'public.get_active_import_snapshot_read_model(uuid,integer,integer,text,text,text,text,text)', 'EXECUTE') then
      raise exception 'FAIL G7: % must have EXECUTE on get_active_import_snapshot_read_model', r;
    end if;
    if not has_function_privilege(r, 'public.get_active_snapshot_owned_card_ids()', 'EXECUTE') then
      raise exception 'FAIL G7: % must have EXECUTE on get_active_snapshot_owned_card_ids', r;
    end if;
  end loop;

  -- G8. View rights model unchanged.
  if (select coalesce(array_to_string(reloptions, ','), '')
        from pg_class where oid='public.cards_effective'::regclass) not like '%security_invoker=true%' then
    raise exception 'FAIL G8: cards_effective must remain security_invoker=true';
  end if;
  if (select coalesce(array_to_string(reloptions, ','), '')
        from pg_class where oid='public.card_identity_resolution'::regclass) like '%security_invoker=true%' then
    raise exception 'FAIL G8: card_identity_resolution must stay OWNER-RIGHTS';
  end if;

  raise notice 'PHASE G PASSED — the CAT-2D.1 ACL contract is intact with 192 populated rows.';
end $$;

-- ── G9. Negative DML proofs under the real roles ─────────────────────────
--
-- This used to be wrapped in a top-level `begin;` … `rollback;`. That wrapper
-- is gone, for the same reason the Phase B migration lost its own: a client
-- that does not hold one transaction across top-level statements turns the
-- wrapper into a lie, and a `rollback;` that never pairs with anything is
-- worse than no wrapper at all.
--
-- HOW THE ATTEMPTED MUTATION IS STILL ROLLED BACK.
--   The DO runs in its own implicit transaction. Each forbidden DML attempt sits
--   in a plpgsql BEGIN…EXCEPTION block, i.e. a subtransaction:
--
--     * the expected outcome is insufficient_privilege — the subtransaction
--       rolls back on its own and v_denied becomes true;
--     * if the DML instead SUCCEEDS, v_denied stays false and the code
--       immediately RAISES. That exception is not caught anywhere above it, so
--       it aborts the whole DO — and with it the implicit transaction and the
--       mutation that should never have been possible.
--
--   So a privilege hole cannot commit: proving the hole exists is the same act
--   that undoes it. G9-FINAL below re-counts the alias rows as an independent
--   check that nothing slipped through.
--
--   `set_config('role', …, is_local => true)` is transaction-scoped, so the
--   role also reverts when the DO ends, however it ends. v_orig restores it
--   between attempts from session_user rather than a hardcoded 'postgres',
--   because `set role` changes current_user but never session_user.
--
-- ⚠ Do not wrap this DO in a transaction block. It is complete as it stands.

do $$
declare
  v_denied boolean;
  v_role   text;
  v_orig   text := session_user;
  v_alias_rows bigint;
  v_seen   bigint;
begin
  select count(*) into v_alias_rows from public.card_identity_aliases;
  if v_alias_rows <> 192 then
    raise exception 'FAIL G9: card_identity_aliases holds % rows before the probes, expected 192', v_alias_rows;
  end if;

  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    v_denied := false;
    begin
      perform set_config('role', v_role, true);
      execute 'delete from public.card_identity_resolution where alias_card_id = ''swsh12.5-GG19''';
    exception
      when insufficient_privilege then v_denied := true;
      when others then v_denied := false;
    end;
    perform set_config('role', v_orig, true);
    if not v_denied then
      raise exception 'FAIL G9: % was able to attempt DELETE through card_identity_resolution', v_role;
    end if;

    v_denied := false;
    begin
      perform set_config('role', v_role, true);
      execute 'select evidence from public.card_identity_aliases limit 1';
    exception
      when insufficient_privilege then v_denied := true;
      when others then v_denied := false;
    end;
    perform set_config('role', v_orig, true);
    if not v_denied then
      raise exception 'FAIL G9: % was able to read alias provenance from the private base table', v_role;
    end if;

    -- Positive control. "The SELECT succeeded" is not enough: an owner-rights
    -- view that returns ZERO rows also succeeds, and that is precisely how a
    -- broken read surface would present — every consumer would silently stop
    -- resolving aliases while every privilege check still looked green.
    -- So the row COUNT is captured and asserted to be exactly 192.
    v_seen := null;
    begin
      perform set_config('role', v_role, true);
      execute 'select count(*) from public.card_identity_resolution' into v_seen;
      perform set_config('role', v_orig, true);
    exception when others then
      perform set_config('role', v_orig, true);
      raise exception 'FAIL G9: % could NOT read card_identity_resolution — the read surface is broken', v_role;
    end;
    if v_seen is distinct from 192 then
      raise exception
        'FAIL G9: % reads % row(s) through card_identity_resolution, expected exactly 192 — the read surface resolves a different set than the alias table holds',
        v_role, coalesce(v_seen::text, '<null>');
    end if;
    if v_seen <> v_alias_rows then
      raise exception
        'FAIL G9: % reads % row(s) through card_identity_resolution but card_identity_aliases holds % — the view and its base table disagree',
        v_role, v_seen, v_alias_rows;
    end if;
  end loop;

  -- G9-FINAL. Independent proof that no attempted DML took effect. If a DELETE
  -- had succeeded the code above would already have aborted this block, so this
  -- can only fail if some future edit weakens that path.
  if (select count(*) from public.card_identity_aliases) <> v_alias_rows then
    raise exception
      'FAIL G9: card_identity_aliases moved from % rows during the negative-DML probes — a forbidden write took effect',
      v_alias_rows;
  end if;

  raise notice 'PHASE G9 PASSED — for anon, authenticated and service_role: view DML denied, provenance unreadable, and the read surface returns exactly % mappings. Alias rows unchanged at %.', 192, v_alias_rows;
end $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- FINAL GATE + PHASE H CLEANUP
-- ═══════════════════════════════════════════════════════════════════════════

select
  (select count(*) from public.card_identity_aliases)                       as alias_rows_must_be_192,
  (select count(*) from public.cards)                                       as cards_rows,
  (select count(*) from public.cards_effective)                             as cards_effective_rows,
  (select count(*) from public.cards_effective ce
     join public.card_identity_aliases a on a.alias_card_id = ce.id)        as aliased_in_effective_must_be_0,
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='cards_effective')          as cards_effective_columns_must_be_14;

-- ⚠ PHASE H — run at the appropriate safe point in the deployment sequence:
--   AFTER C, D, E, F and G have all passed, AFTER the PR is merged and the
--   application change is deployed, AFTER the production smoke test, and only
--   once you are certain no rollback is wanted.
--
--   public.cat2d2_pre_refs is the EXACT undo list for the reference migration —
--   one row per migrated reference, proven identical to the migrated set by §6
--   of cat-2d2-1. Once it is dropped, a reversal can only be reconstructed from
--   the alias table, which identifies survivors but not the individual rows
--   that moved onto them. Export it first if there is any doubt.
--
--   All THREE tables MUST be dropped before this deployment is considered
--   closed: cat2d2_pre_refs holds user-owned card ids and must not remain in
--   production.

drop table if exists public.cat2d2_pre_refs;
drop table if exists public.cat2d2_pre_map;
drop table if exists public.cat2d2_pre_capture;

-- No "clear the validation identity" step is needed any more. Phase A sets
-- `request.jwt.claims` for its own run; every later auth-scoped phase (D, E,
-- E7) sets it transaction-locally inside its own DO and therefore leaves the
-- session exactly as it found it. There is no lingering identity to forget.
