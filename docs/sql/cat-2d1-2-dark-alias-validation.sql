-- docs/sql/cat-2d1-2-dark-alias-validation.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- CAT-2D.1 — validation
--
-- CAT-2D.1 makes an architectural change whose entire acceptance criterion is
-- that NOTHING OBSERVABLE CHANGES. With zero alias rows the exclusion excludes
-- nothing and resolution is the identity function, so every contract below must
-- be byte-for-byte / set-for-set what production produced before deployment.
--
-- ⚠ ACCEPTANCE TARGETS ARE CAPTURED LIVE, NOT HARDCODED.
--   Phase A runs BEFORE deployment and records the real pre-state into a temp
--   table. Phase C compares against THAT, not against any historical constant.
--   Do not substitute a remembered figure (e.g. an old owned-card count) for a
--   captured one — the active batch may have changed since it was written down.
--
-- Phases:
--   A  PRE-DEPLOY capture      (read-only; run before cat-2d1-1)
--   B  DEPLOY                  (run cat-2d1-1-dark-alias-foundation.sql)
--   C  POST-DEPLOY equivalence (read-only)
--   D  alias constraint proofs (writes inside an explicitly ROLLED BACK tx)
--   E  security / privilege proofs (read-only)
--   F  untouched-data proofs   (read-only)
--
-- Phases A and C must run in the SAME session: the capture lives in a temp
-- table. Phase A additionally prints the ownership and OL-0D payloads so they
-- can be saved outside the session if the connection is lost.
--
-- Ownership and OL-0D checks must run AS THE OWNER ACCOUNT: both RPCs are
-- auth.uid()-scoped and return no_auth / raise 28000 for an anonymous session.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE A — PRE-DEPLOY CAPTURE   (read-only; run BEFORE cat-2d1-1)
-- ═══════════════════════════════════════════════════════════════════════════

create temp table if not exists cat2d1_pre (
  key   text primary key,
  value jsonb not null
);

-- A1. cards_effective shape and content fingerprint.
insert into cat2d1_pre (key, value)
select 'cards_effective_rows', to_jsonb(count(*)) from public.cards_effective
on conflict (key) do update set value = excluded.value;

insert into cat2d1_pre (key, value)
select 'cards_effective_id_checksum',
       to_jsonb(md5(string_agg(id, ',' order by id)))
from public.cards_effective
on conflict (key) do update set value = excluded.value;

-- Full-row fingerprint: proves values, not just the id set, are unchanged.
insert into cat2d1_pre (key, value)
select 'cards_effective_row_checksum',
       to_jsonb(md5(string_agg(md5(to_jsonb(ce)::text), ',' order by ce.id)))
from public.cards_effective ce
on conflict (key) do update set value = excluded.value;

-- A2. column contract: ordered column list of the view.
insert into cat2d1_pre (key, value)
select 'cards_effective_columns',
       jsonb_agg(column_name order by ordinal_position)
from information_schema.columns
where table_schema = 'public' and table_name = 'cards_effective'
on conflict (key) do update set value = excluded.value;

-- A3. ownership RPC payload (run as the owner account).
insert into cat2d1_pre (key, value)
select 'owned_ids_payload', public.get_active_snapshot_owned_card_ids()
on conflict (key) do update set value = excluded.value;

-- A4. OL-0D representative payload (first page, default sort).
insert into cat2d1_pre (key, value)
select 'ol0d_payload', public.get_active_import_snapshot_read_model(null, 60, 0, null, null, null, 'all', 'name_asc')
on conflict (key) do update set value = excluded.value;

-- A5. untouched-data fingerprints.
insert into cat2d1_pre (key, value)
select 'user_import_rows_checksum',
       to_jsonb(md5(string_agg(
         md5(coalesce(card_id,'~') || '|' || coalesce(candidate_card_ids::text,'~') || '|' ||
             match_status || '|' || coalesce(match_reason,'~')),
         ',' order by batch_id, source_row_number)))
from public.user_import_rows
on conflict (key) do update set value = excluded.value;

insert into cat2d1_pre (key, value)
select 'card_overrides_checksum',
       to_jsonb(md5(coalesce(string_agg(md5(to_jsonb(o)::text), ',' order by o.user_id, o.card_id), '')))
from public.card_overrides o
on conflict (key) do update set value = excluded.value;

insert into cat2d1_pre (key, value)
select 'card_extras_checksum',
       to_jsonb(md5(coalesce(string_agg(md5(to_jsonb(e)::text), ',' order by e.card_id), '')))
from public.card_extras e
on conflict (key) do update set value = excluded.value;

insert into cat2d1_pre (key, value)
select 'cards_rows', to_jsonb(count(*)) from public.cards
on conflict (key) do update set value = excluded.value;

-- Print the capture so it survives a lost session.
select key, value from cat2d1_pre order by key;


-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE B — DEPLOY
-- ═══════════════════════════════════════════════════════════════════════════
--   Run docs/sql/cat-2d1-1-dark-alias-foundation.sql now, in the SAME session,
--   then continue with Phase C.


-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE C — POST-DEPLOY EQUIVALENCE   (read-only)
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare
  v_pre  jsonb;
  v_now  jsonb;
  v_txt  text;
  v_n    bigint;
begin
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
  select value into v_pre from cat2d1_pre where key = 'cards_effective_rows';
  select to_jsonb(count(*)) into v_now from public.cards_effective;
  if v_pre is distinct from v_now then
    raise exception 'FAIL C1: cards_effective row count changed: % -> %', v_pre, v_now;
  end if;

  -- C2. cards_effective exact ID set unchanged.
  select value into v_pre from cat2d1_pre where key = 'cards_effective_id_checksum';
  select to_jsonb(md5(string_agg(id, ',' order by id))) into v_now from public.cards_effective;
  if v_pre is distinct from v_now then
    raise exception 'FAIL C2: cards_effective ID set changed';
  end if;

  -- C3. cards_effective full-row values unchanged.
  select value into v_pre from cat2d1_pre where key = 'cards_effective_row_checksum';
  select to_jsonb(md5(string_agg(md5(to_jsonb(ce)::text), ',' order by ce.id)))
    into v_now from public.cards_effective ce;
  if v_pre is distinct from v_now then
    raise exception 'FAIL C3: cards_effective row VALUES changed';
  end if;

  -- C4. 14-column contract intact, in order, artist_id at position 14.
  select value into v_pre from cat2d1_pre where key = 'cards_effective_columns';
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
  from pg_class where oid = 'public.cards_effective'::regclass and reloptions is not null
  limit 1;
  if coalesce(v_txt, '') <> 'security_invoker=true' then
    raise exception 'FAIL C5: cards_effective must remain security_invoker=true (found %)', coalesce(v_txt, '<none>');
  end if;

  -- C6. ownership RPC: exact owned-ID set and metadata preserved; counts agree.
  select value into v_pre from cat2d1_pre where key = 'owned_ids_payload';
  v_now := public.get_active_snapshot_owned_card_ids();

  if (v_pre ->> 'state') <> (v_now ->> 'state') then
    raise exception 'FAIL C6: ownership state changed: % -> %', v_pre ->> 'state', v_now ->> 'state';
  end if;

  if (v_now ->> 'state') = 'ready' then
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
    -- New additive fields must be present and must show zero collapse.
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
  end if;

  -- C7. OL-0D: representative page identical.
  select value into v_pre from cat2d1_pre where key = 'ol0d_payload';
  v_now := public.get_active_import_snapshot_read_model(null, 60, 0, null, null, null, 'all', 'name_asc');
  if v_pre is distinct from v_now then
    raise exception 'FAIL C7: OL-0D payload changed under an empty alias map';
  end if;

  raise notice 'PHASE C PASSED — cards_effective, ownership and OL-0D are equivalent under an empty alias map.';
end $$;

-- C8. spot-check other OL-0D argument combinations (compare by eye or capture
-- them in Phase A too if a stricter gate is wanted).
select 'ol0d sort=set_asc'       as variant, public.get_active_import_snapshot_read_model(null, 60, 0, null, null, null, 'all', 'set_asc')       is not null as ok
union all
select 'ol0d sort=quantity_desc',                public.get_active_import_snapshot_read_model(null, 60, 0, null, null, null, 'all', 'quantity_desc') is not null
union all
select 'ol0d status=missing',                    public.get_active_import_snapshot_read_model(null, 60, 0, null, null, null, 'missing', 'name_asc')  is not null
union all
select 'ol0d offset page 2',                     public.get_active_import_snapshot_read_model(null, 60, 60, null, null, null, 'all', 'name_asc')     is not null;


-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE D — ALIAS CONSTRAINT PROOFS   (writes; explicitly ROLLED BACK)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠ This phase INSERTS alias rows to prove the constraints reject what they
--   must. It ends with ROLLBACK. CAT-2D.1 ships with the table EMPTY — verify
--   with Phase C0 again afterwards.
--
-- Uses real existing card ids so the FK is satisfied; pick any three.

begin;

do $$
declare
  v_a text; v_b text; v_c text;
  v_msg text;
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

  -- D3. empty ids refused.
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

  -- D4. R2 — B -> C refused, because B is currently a survivor for A -> B.
  --     This is the case a one-sided trigger would have MISSED.
  begin
    insert into public.card_identity_aliases
      (alias_card_id, canonical_card_id, family, evidence, approved_by, slice)
      values (v_b, v_c, 'set_rename', '{}'::jsonb, 'validation', 'CAT-2D.1');
    raise exception 'FAIL D4: chain A->B then B->C was accepted (R2 not enforced)';
  exception when check_violation then null;
  end;

  -- D5. R1 — C -> A refused, because A is already an alias.
  begin
    insert into public.card_identity_aliases
      (alias_card_id, canonical_card_id, family, evidence, approved_by, slice)
      values (v_c, v_a, 'set_rename', '{}'::jsonb, 'validation', 'CAT-2D.1');
    raise exception 'FAIL D5: chain A->B then C->A was accepted (R1 not enforced)';
  exception when check_violation then null;
  end;

  -- D6. many aliases -> one survivor MUST remain allowed (Trainer Galleries
  --     need exactly this: two obsolete generations, one live survivor).
  insert into public.card_identity_aliases
    (alias_card_id, canonical_card_id, family, evidence, approved_by, slice)
    values (v_c, v_b, 'set_rename', '{}'::jsonb, 'validation', 'CAT-2D.1');

  -- D7. duplicate alias_card_id refused (PK): one old id, one survivor.
  begin
    insert into public.card_identity_aliases
      (alias_card_id, canonical_card_id, family, evidence, approved_by, slice)
      values (v_a, v_b, 'set_rename', '{}'::jsonb, 'validation', 'CAT-2D.1');
    raise exception 'FAIL D7: duplicate alias_card_id was accepted';
  exception when unique_violation then null;
  end;

  -- D8. with two aliases live, cards_effective must now EXCLUDE both.
  if exists (select 1 from public.cards_effective where id in (v_a, v_c)) then
    raise exception 'FAIL D8: cards_effective still exposes an aliased id';
  end if;
  if not exists (select 1 from public.cards_effective where id = v_b) then
    raise exception 'FAIL D8: cards_effective must still expose the survivor';
  end if;

  -- D9. the resolution view exposes exactly two columns.
  select string_agg(column_name, ',' order by ordinal_position) into v_msg
  from information_schema.columns
  where table_schema = 'public' and table_name = 'card_identity_resolution';
  if v_msg <> 'alias_card_id,canonical_card_id' then
    raise exception 'FAIL D9: resolution view must expose exactly alias_card_id,canonical_card_id (found %)', v_msg;
  end if;

  raise notice 'PHASE D PASSED — constraints, exclusion and resolution surface behave correctly.';
end $$;

rollback;   -- ⚠ MANDATORY: CAT-2D.1 ships with ZERO alias rows.

-- Re-assert emptiness after the rollback.
select case when count(*) = 0 then 'OK: alias table empty after rollback'
            else 'FAIL: alias rows survived the rollback' end as phase_d_cleanup,
       count(*) as alias_rows
from public.card_identity_aliases;


-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE E — SECURITY / PRIVILEGE PROOFS   (read-only)
-- ═══════════════════════════════════════════════════════════════════════════

-- E1. provenance is NOT reachable by anon/authenticated on the base table.
--     Expect ZERO rows: no privilege of any kind is granted on the table.
select 'E1 base-table grants to anon/authenticated (expect none)' as check_name,
       grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'card_identity_aliases'
  and grantee in ('anon', 'authenticated');

-- E2. only the two-column resolution surface is granted.
select 'E2 resolution view grants' as check_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'card_identity_resolution'
  and grantee in ('anon', 'authenticated', 'service_role')
order by grantee, privilege_type;

-- E3. the resolution view projects exactly two columns.
select 'E3 resolution columns' as check_name, column_name, ordinal_position
from information_schema.columns
where table_schema = 'public' and table_name = 'card_identity_resolution'
order by ordinal_position;

-- E4. RLS is enabled on the base table and has NO policies (defence in depth).
select 'E4 base-table RLS' as check_name,
       c.relrowsecurity as rls_enabled,
       (select count(*) from pg_policies p
         where p.schemaname = 'public' and p.tablename = 'card_identity_aliases') as policy_count
from pg_class c where c.oid = 'public.card_identity_aliases'::regclass;

-- E5. security properties of the three consumers are unchanged.
select 'E5 security properties' as check_name, p.proname,
       case when p.prosecdef then 'DEFINER' else 'INVOKER' end as security,
       p.proconfig
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('get_active_snapshot_owned_card_ids', 'get_active_import_snapshot_read_model')
order by p.proname;
-- EXPECT: get_active_snapshot_owned_card_ids   = DEFINER, search_path=""
--         get_active_import_snapshot_read_model = INVOKER, search_path=""

select 'E5 view security_invoker' as check_name, c.relname, c.reloptions
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('cards_effective', 'illustrator_directory', 'card_identity_resolution')
order by c.relname;
-- EXPECT: cards_effective and illustrator_directory  -> {security_invoker=true}
--         card_identity_resolution                   -> NULL (owner-rights, by design)


-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE F — UNTOUCHED-DATA PROOFS   (read-only)
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare v_pre jsonb; v_now jsonb;
begin
  select value into v_pre from cat2d1_pre where key = 'user_import_rows_checksum';
  select to_jsonb(md5(string_agg(
           md5(coalesce(card_id,'~') || '|' || coalesce(candidate_card_ids::text,'~') || '|' ||
               match_status || '|' || coalesce(match_reason,'~')),
           ',' order by batch_id, source_row_number)))
    into v_now from public.user_import_rows;
  if v_pre is distinct from v_now then
    raise exception 'FAIL F1: user_import_rows changed — historical evidence must be immutable';
  end if;

  select value into v_pre from cat2d1_pre where key = 'card_overrides_checksum';
  select to_jsonb(md5(coalesce(string_agg(md5(to_jsonb(o)::text), ',' order by o.user_id, o.card_id), '')))
    into v_now from public.card_overrides o;
  if v_pre is distinct from v_now then
    raise exception 'FAIL F2: card_overrides changed';
  end if;

  select value into v_pre from cat2d1_pre where key = 'card_extras_checksum';
  select to_jsonb(md5(coalesce(string_agg(md5(to_jsonb(e)::text), ',' order by e.card_id), '')))
    into v_now from public.card_extras e;
  if v_pre is distinct from v_now then
    raise exception 'FAIL F3: card_extras changed';
  end if;

  select value into v_pre from cat2d1_pre where key = 'cards_rows';
  select to_jsonb(count(*)) into v_now from public.cards;
  if v_pre is distinct from v_now then
    raise exception 'FAIL F4: public.cards row count changed — CAT-2D.1 deletes and inserts nothing';
  end if;

  raise notice 'PHASE F PASSED — import evidence, overrides, extras and raw cards are untouched.';
end $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- FINAL GATE
-- ═══════════════════════════════════════════════════════════════════════════
select
  (select count(*) from public.card_identity_aliases)                       as alias_rows_must_be_zero,
  (select count(*) from public.cards_effective)                             as cards_effective_rows,
  (select count(*) from public.cards)                                       as cards_rows,
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='cards_effective')          as cards_effective_columns_must_be_14;
