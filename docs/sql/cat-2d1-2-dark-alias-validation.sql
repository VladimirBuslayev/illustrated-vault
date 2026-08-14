-- docs/sql/cat-2d1-2-dark-alias-validation.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- CAT-2D.1 — deployment + validation procedure
--
-- CAT-2D.1 makes an architectural change whose entire acceptance criterion is
-- that NOTHING OBSERVABLE CHANGES. With zero alias rows the exclusion excludes
-- nothing and resolution is the identity function, so every contract below must
-- be byte-for-byte / set-for-set what production produced before deployment.
--
-- ⚠ ACCEPTANCE TARGETS ARE CAPTURED LIVE, NOT HARDCODED.
--   Phase A records the real pre-state. Phase C compares against THAT. Never
--   substitute a remembered figure (e.g. an old owned-card count) — the active
--   batch may have changed since it was written down.
--
-- ─────────────────────────────────────────────────────────────────────────
-- TWO OPERATIONAL PROBLEMS THIS FILE SOLVES (review findings)
-- ─────────────────────────────────────────────────────────────────────────
--
-- P1. auth.uid() IS NULL IN THE SQL EDITOR.
--     Both RPCs are auth.uid()-scoped. A Dashboard / psql connection carries no
--     app JWT, so auth.uid() returns NULL and the two functions would answer
--     {state: error, reason: no_auth} and RAISE 28000 respectively. Capturing
--     that as a "pre-state" would be meaningless.
--
--     Solved below by explicitly setting `request.jwt.claims`, which is exactly
--     what Supabase's auth.uid() reads, and then ASSERTING that auth.uid()
--     equals the intended validation user before anything is captured.
--
-- P2. A TEMP TABLE CANNOT SURVIVE SEPARATE DASHBOARD RUNS.
--     Each Run may use a different pooled backend, so session-scoped state is
--     not reliable across phases.
--
--     Solved below by capturing into a PERSISTENT table,
--     public.cat2d1_pre_capture, which every phase can find regardless of
--     session. It is privilege-locked on creation and DROPPED in Phase G.
--     Each phase re-establishes the JWT context from that table, so
--     **every phase is independently runnable, in any session, in any order
--     after A** — no "same session" prose remains.
--
-- ─────────────────────────────────────────────────────────────────────────
-- WHY WE SET CLAIMS BUT DO NOT `SET ROLE authenticated`
-- ─────────────────────────────────────────────────────────────────────────
--   The migration DDL needs owner privileges, and switching roles mid-script
--   would break it. Staying privileged while setting `request.jwt.claims` is
--   sound for THIS purpose because both RPCs scope explicitly in SQL —
--   `where user_id = v_uid and status = 'active'` — rather than relying solely
--   on RLS. The payload is therefore identical whether or not RLS is bypassed.
--
--   That argument covers the EQUIVALENCE phases only. The PRIVILEGE phase (E)
--   does not depend on it: it asserts effective privileges per named role with
--   has_table_privilege / has_function_privilege, which accounts for PUBLIC
--   membership, and adds real DML attempts under `set role`.
--
-- ─────────────────────────────────────────────────────────────────────────
-- PHASES
-- ─────────────────────────────────────────────────────────────────────────
--   A0  discover the validation user            (read-only)
--   A   PRE-DEPLOY capture                      (creates the capture table)
--   B   DEPLOY                                  (run cat-2d1-1)
--   C   POST-DEPLOY equivalence                 (read-only)
--   D   alias constraint proofs                 (writes; ROLLED BACK)
--   E   privilege assertions + negative DML     (asserts; ROLLED BACK)
--   F   untouched-data proofs                   (read-only)
--   G   cleanup                                 (drops the capture table)
--
-- Run A0 → A → B → C → D → E → F → G in order. Each may be its own Run.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE A0 — DISCOVER THE VALIDATION USER   (read-only)
-- ═══════════════════════════════════════════════════════════════════════════
-- Pick the user whose active snapshot should be used as the acceptance target.
-- Normally there is exactly one row here.

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
-- PHASE A — PRE-DEPLOY CAPTURE   (run BEFORE cat-2d1-1)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── The ONLY line an operator edits in this file ──────────────────────────
--    Paste the validation_user_uuid from Phase A0 between the quotes.
--    Deliberately not hardcoded anywhere else, and never in the migration.
select set_config('cat2d1.validation_user', 'PASTE-VALIDATION-USER-UUID-HERE', false);
-- ──────────────────────────────────────────────────────────────────────────

-- Establish the authenticated identity that auth.uid() will report.
select set_config(
  'request.jwt.claims',
  json_build_object('sub', current_setting('cat2d1.validation_user'), 'role', 'authenticated')::text,
  false
);

-- Capture table. PERSISTENT (survives separate Dashboard runs), privilege
-- locked (it holds this user's owned-card ids), dropped in Phase G.
create table if not exists public.cat2d1_pre_capture (
  key   text primary key,
  value jsonb not null
);
revoke all on table public.cat2d1_pre_capture from public, anon, authenticated, service_role;

do $$
declare
  v_uid       uuid;
  v_expected  text := current_setting('cat2d1.validation_user', true);
  v_batches   int;
begin
  -- A-GUARD 1: the operator actually pasted a uuid.
  if v_expected is null or v_expected = '' or v_expected = 'PASTE-VALIDATION-USER-UUID-HERE' then
    raise exception 'FAIL A-GUARD: paste the validation user UUID into the marked set_config line first';
  end if;

  -- A-GUARD 2: auth.uid() is established and is EXACTLY the intended user.
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'FAIL A-GUARD: auth.uid() is NULL — request.jwt.claims was not applied to this session';
  end if;
  if v_uid::text <> v_expected then
    raise exception 'FAIL A-GUARD: auth.uid() is % but the validation user is %', v_uid, v_expected;
  end if;

  -- A-GUARD 3: that user has exactly one active batch (otherwise the ownership
  -- RPC would legitimately answer multiple_active_batches / no_active_batch and
  -- the capture would not be a usable acceptance target).
  select count(*) into v_batches
  from public.user_import_batches where user_id = v_uid and status = 'active';
  if v_batches <> 1 then
    raise exception 'FAIL A-GUARD: validation user has % active batches, expected exactly 1', v_batches;
  end if;

  raise notice 'PHASE A context OK — auth.uid() = %, one active batch.', v_uid;
end $$;

-- A1. cards_effective shape and content fingerprints.
insert into public.cat2d1_pre_capture (key, value)
select 'validation_user', to_jsonb(current_setting('cat2d1.validation_user'))
on conflict (key) do update set value = excluded.value;

insert into public.cat2d1_pre_capture (key, value)
select 'cards_effective_rows', to_jsonb(count(*)) from public.cards_effective
on conflict (key) do update set value = excluded.value;

insert into public.cat2d1_pre_capture (key, value)
select 'cards_effective_id_checksum', to_jsonb(md5(string_agg(id, ',' order by id)))
from public.cards_effective
on conflict (key) do update set value = excluded.value;

-- Full-row fingerprint: proves VALUES are unchanged, not just the id set.
insert into public.cat2d1_pre_capture (key, value)
select 'cards_effective_row_checksum',
       to_jsonb(md5(string_agg(md5(to_jsonb(ce)::text), ',' order by ce.id)))
from public.cards_effective ce
on conflict (key) do update set value = excluded.value;

-- A2. ordered column contract.
insert into public.cat2d1_pre_capture (key, value)
select 'cards_effective_columns', jsonb_agg(column_name order by ordinal_position)
from information_schema.columns
where table_schema = 'public' and table_name = 'cards_effective'
on conflict (key) do update set value = excluded.value;

-- A3/A4. the two auth.uid()-scoped payloads.
insert into public.cat2d1_pre_capture (key, value)
select 'owned_ids_payload', public.get_active_snapshot_owned_card_ids()
on conflict (key) do update set value = excluded.value;

insert into public.cat2d1_pre_capture (key, value)
select 'ol0d_payload',
       public.get_active_import_snapshot_read_model(null, 60, 0, null, null, null, 'all', 'name_asc')
on conflict (key) do update set value = excluded.value;

-- A5. untouched-data fingerprints.
insert into public.cat2d1_pre_capture (key, value)
select 'user_import_rows_checksum',
       to_jsonb(md5(string_agg(
         md5(coalesce(card_id,'~') || '|' || coalesce(candidate_card_ids::text,'~') || '|' ||
             match_status || '|' || coalesce(match_reason,'~')),
         ',' order by batch_id, source_row_number)))
from public.user_import_rows
on conflict (key) do update set value = excluded.value;

insert into public.cat2d1_pre_capture (key, value)
select 'card_overrides_checksum',
       to_jsonb(md5(coalesce(string_agg(md5(to_jsonb(o)::text), ',' order by o.user_id, o.card_id), '')))
from public.card_overrides o
on conflict (key) do update set value = excluded.value;

insert into public.cat2d1_pre_capture (key, value)
select 'card_extras_checksum',
       to_jsonb(md5(coalesce(string_agg(md5(to_jsonb(e)::text), ',' order by e.card_id), '')))
from public.card_extras e
on conflict (key) do update set value = excluded.value;

insert into public.cat2d1_pre_capture (key, value)
select 'cards_rows', to_jsonb(count(*)) from public.cards
on conflict (key) do update set value = excluded.value;

-- A6. sanity: the captured ownership payload must be a usable 'ready' target.
do $$
declare v_state text;
begin
  select value ->> 'state' into v_state from public.cat2d1_pre_capture where key = 'owned_ids_payload';
  if v_state <> 'ready' then
    raise exception 'FAIL A6: captured ownership state is % — expected ready. Fix the context before deploying.', v_state;
  end if;
  raise notice 'PHASE A PASSED — pre-state captured.';
end $$;

select key, jsonb_pretty(value) from public.cat2d1_pre_capture order by key;


-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE B — DEPLOY
-- ═══════════════════════════════════════════════════════════════════════════
--   Run docs/sql/cat-2d1-1-dark-alias-foundation.sql now, top to bottom.
--   It is one transaction and needs owner privileges. No JWT context required.


-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE C — POST-DEPLOY EQUIVALENCE   (read-only)
-- ═══════════════════════════════════════════════════════════════════════════

-- Re-establish the SAME identity, read from the capture table, so this phase is
-- runnable in a fresh session.
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select value #>> '{}' from public.cat2d1_pre_capture where key = 'validation_user'),
    'role', 'authenticated'
  )::text,
  false
);

do $$
declare
  v_pre jsonb; v_now jsonb; v_txt text; v_n bigint; v_uid uuid; v_expected text;
begin
  -- C-GUARD: identity must match the capture, or the comparison is meaningless.
  select value #>> '{}' into v_expected from public.cat2d1_pre_capture where key = 'validation_user';
  if v_expected is null then
    raise exception 'FAIL C-GUARD: no capture found — run Phase A first';
  end if;
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'FAIL C-GUARD: auth.uid() is NULL — the claims setting above did not apply';
  end if;
  if v_uid::text <> v_expected then
    raise exception 'FAIL C-GUARD: auth.uid() is % but the capture was taken as %', v_uid, v_expected;
  end if;

  -- C0. the alias table exists and is EMPTY. Everything below depends on this.
  if to_regclass('public.card_identity_aliases') is null then
    raise exception 'FAIL C0: public.card_identity_aliases does not exist';
  end if;
  select count(*) into v_n from public.card_identity_aliases;
  if v_n <> 0 then
    raise exception 'FAIL C0: card_identity_aliases must be EMPTY in CAT-2D.1 (found % rows)', v_n;
  end if;
  if to_regclass('public.card_identity_resolution') is null then
    raise exception 'FAIL C0: public.card_identity_resolution does not exist';
  end if;

  -- C1. cards_effective row count unchanged.
  select value into v_pre from public.cat2d1_pre_capture where key = 'cards_effective_rows';
  select to_jsonb(count(*)) into v_now from public.cards_effective;
  if v_pre is distinct from v_now then
    raise exception 'FAIL C1: cards_effective row count changed: % -> %', v_pre, v_now;
  end if;

  -- C2. exact ID set unchanged.
  select value into v_pre from public.cat2d1_pre_capture where key = 'cards_effective_id_checksum';
  select to_jsonb(md5(string_agg(id, ',' order by id))) into v_now from public.cards_effective;
  if v_pre is distinct from v_now then
    raise exception 'FAIL C2: cards_effective ID set changed';
  end if;

  -- C3. full-row values unchanged.
  select value into v_pre from public.cat2d1_pre_capture where key = 'cards_effective_row_checksum';
  select to_jsonb(md5(string_agg(md5(to_jsonb(ce)::text), ',' order by ce.id)))
    into v_now from public.cards_effective ce;
  if v_pre is distinct from v_now then
    raise exception 'FAIL C3: cards_effective row VALUES changed';
  end if;

  -- C4. 14-column contract intact, in order, artist_id at position 14.
  select value into v_pre from public.cat2d1_pre_capture where key = 'cards_effective_columns';
  select jsonb_agg(column_name order by ordinal_position) into v_now
  from information_schema.columns
  where table_schema = 'public' and table_name = 'cards_effective';
  if v_pre is distinct from v_now then
    raise exception 'FAIL C4: cards_effective column list changed: % -> %', v_pre, v_now;
  end if;
  if jsonb_array_length(v_now) <> 14 then
    raise exception 'FAIL C4: cards_effective must expose exactly 14 columns (found %)', jsonb_array_length(v_now);
  end if;
  if v_now ->> 13 <> 'artist_id' then
    raise exception 'FAIL C4: artist_id must be column 14 (found %)', v_now ->> 13;
  end if;

  -- C5. cards_effective remains security_invoker.
  select unnest(reloptions) into v_txt
  from pg_class where oid = 'public.cards_effective'::regclass and reloptions is not null limit 1;
  if coalesce(v_txt, '') <> 'security_invoker=true' then
    raise exception 'FAIL C5: cards_effective must remain security_invoker=true (found %)', coalesce(v_txt, '<none>');
  end if;

  -- C6. ownership RPC: exact owned-ID set and metadata preserved.
  select value into v_pre from public.cat2d1_pre_capture where key = 'owned_ids_payload';
  v_now := public.get_active_snapshot_owned_card_ids();

  if (v_now ->> 'state') <> 'ready' then
    raise exception 'FAIL C6: ownership state is % — expected ready', v_now ->> 'state';
  end if;
  if (v_pre -> 'ownedCardIds') is distinct from (v_now -> 'ownedCardIds') then
    raise exception 'FAIL C6: owned-ID set changed (array is sorted, so this is an exact comparison)';
  end if;
  if (v_pre #>> '{reconciliation,distinctMatchedCardIds}')
     is distinct from (v_now #>> '{reconciliation,distinctMatchedCardIds}') then
    raise exception 'FAIL C6: distinctMatchedCardIds changed';
  end if;
  if (v_pre #>> '{reconciliation,matchedRows}')
     is distinct from (v_now #>> '{reconciliation,matchedRows}') then
    raise exception 'FAIL C6: matchedRows changed';
  end if;
  if (v_now #>> '{reconciliation,distinctResolvedCardIds}') is null then
    raise exception 'FAIL C6: distinctResolvedCardIds missing from the payload';
  end if;
  if (v_now #>> '{reconciliation,distinctResolvedCardIds}')
     is distinct from (v_now #>> '{reconciliation,distinctMatchedCardIds}') then
    raise exception 'FAIL C6: with zero aliases distinctResolved must equal distinctMatched';
  end if;
  if (v_now #>> '{reconciliation,aliasCollapsedCount}') <> '0' then
    raise exception 'FAIL C6: aliasCollapsedCount must be 0 with an empty alias table (found %)',
      v_now #>> '{reconciliation,aliasCollapsedCount}';
  end if;
  if (v_pre ->> 'batchId') is distinct from (v_now ->> 'batchId')
     or (v_pre ->> 'activatedAt') is distinct from (v_now ->> 'activatedAt')
     or (v_pre ->> 'matcherVersion') is distinct from (v_now ->> 'matcherVersion') then
    raise exception 'FAIL C6: batch metadata changed';
  end if;
  if (v_now ->> 'contractVersion') <> '1' then
    raise exception 'FAIL C6: contractVersion must remain 1';
  end if;

  -- C7. OL-0D: representative page identical.
  select value into v_pre from public.cat2d1_pre_capture where key = 'ol0d_payload';
  v_now := public.get_active_import_snapshot_read_model(null, 60, 0, null, null, null, 'all', 'name_asc');
  if v_pre is distinct from v_now then
    raise exception 'FAIL C7: OL-0D payload changed under an empty alias map';
  end if;

  raise notice 'PHASE C PASSED — cards_effective, ownership and OL-0D are equivalent under an empty alias map.';
end $$;

-- C8. spot-check other OL-0D argument combinations still execute.
select 'ol0d sort=set_asc' as variant,
       public.get_active_import_snapshot_read_model(null, 60, 0, null, null, null, 'all', 'set_asc') ->> 'state' as state
union all
select 'ol0d sort=quantity_desc',
       public.get_active_import_snapshot_read_model(null, 60, 0, null, null, null, 'all', 'quantity_desc') ->> 'state'
union all
select 'ol0d status=missing',
       public.get_active_import_snapshot_read_model(null, 60, 0, null, null, null, 'missing', 'name_asc') ->> 'state'
union all
select 'ol0d offset page 2',
       public.get_active_import_snapshot_read_model(null, 60, 60, null, null, null, 'all', 'name_asc') ->> 'state';


-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE D — ALIAS CONSTRAINT PROOFS   (writes; explicitly ROLLED BACK)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠ INSERTS alias rows to prove the constraints reject what they must, then
--   ROLLS BACK. CAT-2D.1 ships with the table EMPTY.

begin;

do $$
declare v_a text; v_b text; v_c text; v_msg text;
begin
  select id into v_a from public.cards order by id offset 0 limit 1;
  select id into v_b from public.cards order by id offset 1 limit 1;
  select id into v_c from public.cards order by id offset 2 limit 1;
  if v_a is null or v_b is null or v_c is null then
    raise exception 'FAIL D: need at least 3 rows in public.cards for constraint proofs';
  end if;

  -- D1. self-alias refused.
  begin
    insert into public.card_identity_aliases
      (alias_card_id, canonical_card_id, family, evidence, approved_by, slice)
      values (v_a, v_a, 'set_rename', '{}'::jsonb, 'validation', 'CAT-2D.1');
    raise exception 'FAIL D1: self-alias was accepted';
  exception when check_violation then null;
  end;

  -- D2. survivor must exist (FK).
  begin
    insert into public.card_identity_aliases
      (alias_card_id, canonical_card_id, family, evidence, approved_by, slice)
      values (v_a, '__no_such_card__', 'set_rename', '{}'::jsonb, 'validation', 'CAT-2D.1');
    raise exception 'FAIL D2: alias to a nonexistent survivor was accepted';
  exception when foreign_key_violation then null;
  end;

  -- D3. blank ids refused.
  begin
    insert into public.card_identity_aliases
      (alias_card_id, canonical_card_id, family, evidence, approved_by, slice)
      values ('   ', v_b, 'set_rename', '{}'::jsonb, 'validation', 'CAT-2D.1');
    raise exception 'FAIL D3: blank alias_card_id was accepted';
  exception when check_violation then null;
  end;

  -- Baseline: a legitimate alias A -> B is accepted.
  insert into public.card_identity_aliases
    (alias_card_id, canonical_card_id, family, evidence, approved_by, slice)
    values (v_a, v_b, 'set_rename', '{}'::jsonb, 'validation', 'CAT-2D.1');

  -- D4. R2 — B -> C refused (B is currently a survivor). This is the case a
  --     one-sided trigger would have MISSED.
  begin
    insert into public.card_identity_aliases
      (alias_card_id, canonical_card_id, family, evidence, approved_by, slice)
      values (v_b, v_c, 'set_rename', '{}'::jsonb, 'validation', 'CAT-2D.1');
    raise exception 'FAIL D4: chain A->B then B->C was accepted (R2 not enforced)';
  exception when check_violation then null;
  end;

  -- D5. R1 — C -> A refused (A is already an alias).
  begin
    insert into public.card_identity_aliases
      (alias_card_id, canonical_card_id, family, evidence, approved_by, slice)
      values (v_c, v_a, 'set_rename', '{}'::jsonb, 'validation', 'CAT-2D.1');
    raise exception 'FAIL D5: chain A->B then C->A was accepted (R1 not enforced)';
  exception when check_violation then null;
  end;

  -- D6. many aliases -> one survivor MUST remain allowed.
  insert into public.card_identity_aliases
    (alias_card_id, canonical_card_id, family, evidence, approved_by, slice)
    values (v_c, v_b, 'set_rename', '{}'::jsonb, 'validation', 'CAT-2D.1');

  -- D7. duplicate alias_card_id refused (PK).
  begin
    insert into public.card_identity_aliases
      (alias_card_id, canonical_card_id, family, evidence, approved_by, slice)
      values (v_a, v_b, 'set_rename', '{}'::jsonb, 'validation', 'CAT-2D.1');
    raise exception 'FAIL D7: duplicate alias_card_id was accepted';
  exception when unique_violation then null;
  end;

  -- D8. with two aliases live, cards_effective must EXCLUDE both and keep the survivor.
  if exists (select 1 from public.cards_effective where id in (v_a, v_c)) then
    raise exception 'FAIL D8: cards_effective still exposes an aliased id';
  end if;
  if not exists (select 1 from public.cards_effective where id = v_b) then
    raise exception 'FAIL D8: cards_effective must still expose the survivor';
  end if;

  -- D9. resolution view exposes exactly two columns.
  select string_agg(column_name, ',' order by ordinal_position) into v_msg
  from information_schema.columns
  where table_schema = 'public' and table_name = 'card_identity_resolution';
  if v_msg <> 'alias_card_id,canonical_card_id' then
    raise exception 'FAIL D9: resolution view must expose exactly alias_card_id,canonical_card_id (found %)', v_msg;
  end if;

  raise notice 'PHASE D PASSED — constraints, exclusion and resolution surface behave correctly.';
end $$;

rollback;   -- ⚠ MANDATORY: CAT-2D.1 ships with ZERO alias rows.

select case when count(*) = 0 then 'OK: alias table empty after rollback'
            else 'FAIL: alias rows survived the rollback' end as phase_d_cleanup,
       count(*) as alias_rows
from public.card_identity_aliases;


-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE E — PRIVILEGE ASSERTIONS   (asserted, not printed)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- has_table_privilege / has_function_privilege report EFFECTIVE privilege, so
-- a privilege held indirectly via PUBLIC is correctly reported as held. That is
-- exactly why they are used here instead of reading information_schema grants.

do $$
declare
  r text;
  p text;
begin
  -- E1. base table: anon/authenticated have NOTHING.
  foreach r in array array['anon', 'authenticated'] loop
    foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      if has_table_privilege(r, 'public.card_identity_aliases', p) then
        raise exception 'FAIL E1: % must NOT have % on card_identity_aliases (provenance would be reachable)', r, p;
      end if;
    end loop;
  end loop;

  -- E2. resolution view: SELECT granted to exactly the three read roles.
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if not has_table_privilege(r, 'public.card_identity_resolution', 'SELECT') then
      raise exception 'FAIL E2: % must have SELECT on card_identity_resolution', r;
    end if;
  end loop;

  -- E3. resolution view: NO write privilege for anyone. The view is a simple
  --     single-table view and is therefore AUTOMATICALLY UPDATABLE — a DML
  --     grant here would write through to the private base table with OWNER
  --     rights, bypassing E1 entirely. This is the assertion that matters most.
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    foreach p in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      if has_table_privilege(r, 'public.card_identity_resolution', p) then
        raise exception 'FAIL E3: % must NOT have % on card_identity_resolution (auto-updatable owner-rights view)', r, p;
      end if;
    end loop;
  end loop;

  -- E4. the resolution view projects exactly two columns.
  if (select string_agg(column_name, ',' order by ordinal_position)
        from information_schema.columns
       where table_schema = 'public' and table_name = 'card_identity_resolution')
     <> 'alias_card_id,canonical_card_id' then
    raise exception 'FAIL E4: resolution view must project exactly alias_card_id,canonical_card_id';
  end if;

  -- E5. base table RLS enabled with NO policies (defence in depth behind E1).
  if not (select relrowsecurity from pg_class where oid = 'public.card_identity_aliases'::regclass) then
    raise exception 'FAIL E5: RLS must be enabled on card_identity_aliases';
  end if;
  if (select count(*) from pg_policies
       where schemaname = 'public' and tablename = 'card_identity_aliases') <> 0 then
    raise exception 'FAIL E5: card_identity_aliases must have NO RLS policies';
  end if;

  -- E6. security properties of the consumers are unchanged.
  if not (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname='public' and p.proname='get_active_snapshot_owned_card_ids') then
    raise exception 'FAIL E6: ownership RPC must remain SECURITY DEFINER';
  end if;
  if (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname='public' and p.proname='get_active_import_snapshot_read_model') then
    raise exception 'FAIL E6: OL-0D must remain SECURITY INVOKER';
  end if;

  -- E7. OL-0D EXECUTE ACL matches the CAT-2D.0 recovered production contract.
  foreach r in array array['postgres', 'anon', 'authenticated', 'service_role'] loop
    if not has_function_privilege(r,
         'public.get_active_import_snapshot_read_model(uuid,integer,integer,text,text,text,text,text)', 'EXECUTE') then
      raise exception 'FAIL E7: % must have EXECUTE on get_active_import_snapshot_read_model (recovered production ACL)', r;
    end if;
    if not has_function_privilege(r, 'public.get_active_snapshot_owned_card_ids()', 'EXECUTE') then
      raise exception 'FAIL E7: % must have EXECUTE on get_active_snapshot_owned_card_ids (recovered production ACL)', r;
    end if;
  end loop;

  -- E8. cards_effective and illustrator_directory remain security_invoker; the
  --     resolution view remains owner-rights (reloptions null / no invoker flag).
  if (select coalesce(array_to_string(reloptions, ','), '')
        from pg_class where oid='public.cards_effective'::regclass) not like '%security_invoker=true%' then
    raise exception 'FAIL E8: cards_effective must remain security_invoker=true';
  end if;
  if (select coalesce(array_to_string(reloptions, ','), '')
        from pg_class where oid='public.illustrator_directory'::regclass) not like '%security_invoker=true%' then
    raise exception 'FAIL E8: illustrator_directory must remain security_invoker=true';
  end if;
  if (select coalesce(array_to_string(reloptions, ','), '')
        from pg_class where oid='public.card_identity_resolution'::regclass) like '%security_invoker=true%' then
    raise exception 'FAIL E8: card_identity_resolution must stay OWNER-RIGHTS, otherwise callers would need base-table access';
  end if;

  raise notice 'PHASE E PASSED — privileges are exactly as designed.';
end $$;

-- ── E9. NEGATIVE DML PROOFS — real attempts under the real roles ──────────
-- Belt-and-braces behind E3: proves the grants behave as asserted, not merely
-- that the catalog says so. Wrapped in a transaction that ROLLS BACK.

begin;

do $$
declare
  v_denied boolean;
  v_role   text;
  -- Restore to the SESSION role, not a hardcoded 'postgres': `set role` changes
  -- current_user but never session_user, so this is correct whatever privileged
  -- role the operator connected as.
  v_orig   text := session_user;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    -- INSERT through the auto-updatable view must be denied.
    v_denied := false;
    begin
      perform set_config('role', v_role, true);
      execute format(
        'insert into public.card_identity_resolution (alias_card_id, canonical_card_id) values (%L, %L)',
        '__cat2d1_probe__', '__cat2d1_probe_canonical__');
    exception
      when insufficient_privilege then v_denied := true;
      when others then v_denied := false;
    end;
    perform set_config('role', v_orig, true);
    if not v_denied then
      raise exception 'FAIL E9: % was able to attempt INSERT through card_identity_resolution', v_role;
    end if;

    -- SELECT on the private base table must be denied.
    v_denied := false;
    begin
      perform set_config('role', v_role, true);
      execute 'select 1 from public.card_identity_aliases limit 1';
    exception
      when insufficient_privilege then v_denied := true;
      when others then v_denied := false;
    end;
    perform set_config('role', v_orig, true);
    if not v_denied then
      raise exception 'FAIL E9: % was able to read the private card_identity_aliases table', v_role;
    end if;

    -- SELECT on the resolution view must SUCCEED (positive control: proves the
    -- denials above are about privilege, not about a broken object).
    begin
      perform set_config('role', v_role, true);
      execute 'select 1 from public.card_identity_resolution limit 1';
      perform set_config('role', v_orig, true);
    exception when others then
      perform set_config('role', v_orig, true);
      raise exception 'FAIL E9: % could NOT read card_identity_resolution — the read surface is broken', v_role;
    end;
  end loop;

  raise notice 'PHASE E9 PASSED — DML denied, private table unreadable, read surface works.';
end $$;

rollback;


-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE F — UNTOUCHED-DATA PROOFS   (read-only)
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare v_pre jsonb; v_now jsonb;
begin
  select value into v_pre from public.cat2d1_pre_capture where key = 'user_import_rows_checksum';
  select to_jsonb(md5(string_agg(
           md5(coalesce(card_id,'~') || '|' || coalesce(candidate_card_ids::text,'~') || '|' ||
               match_status || '|' || coalesce(match_reason,'~')),
           ',' order by batch_id, source_row_number)))
    into v_now from public.user_import_rows;
  if v_pre is distinct from v_now then
    raise exception 'FAIL F1: user_import_rows changed — historical evidence must be immutable';
  end if;

  select value into v_pre from public.cat2d1_pre_capture where key = 'card_overrides_checksum';
  select to_jsonb(md5(coalesce(string_agg(md5(to_jsonb(o)::text), ',' order by o.user_id, o.card_id), '')))
    into v_now from public.card_overrides o;
  if v_pre is distinct from v_now then
    raise exception 'FAIL F2: card_overrides changed';
  end if;

  select value into v_pre from public.cat2d1_pre_capture where key = 'card_extras_checksum';
  select to_jsonb(md5(coalesce(string_agg(md5(to_jsonb(e)::text), ',' order by e.card_id), '')))
    into v_now from public.card_extras e;
  if v_pre is distinct from v_now then
    raise exception 'FAIL F3: card_extras changed';
  end if;

  select value into v_pre from public.cat2d1_pre_capture where key = 'cards_rows';
  select to_jsonb(count(*)) into v_now from public.cards;
  if v_pre is distinct from v_now then
    raise exception 'FAIL F4: public.cards row count changed — CAT-2D.1 deletes and inserts nothing';
  end if;

  raise notice 'PHASE F PASSED — import evidence, overrides, extras and raw cards are untouched.';
end $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- FINAL GATE + PHASE G CLEANUP
-- ═══════════════════════════════════════════════════════════════════════════

select
  (select count(*) from public.card_identity_aliases)              as alias_rows_must_be_zero,
  (select count(*) from public.cards_effective)                    as cards_effective_rows,
  (select count(*) from public.cards)                              as cards_rows,
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='cards_effective') as cards_effective_columns_must_be_14;

-- PHASE G — remove the capture table. It holds this user's owned-card ids, so
-- do not leave it behind. Run only after Phases C and F have passed.
drop table if exists public.cat2d1_pre_capture;

-- Clear the validation identity from the session.
select set_config('request.jwt.claims', '', false);
