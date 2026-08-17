-- docs/sql/cat-2d1-1-dark-alias-foundation.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- CAT-2D.1 — Dark catalog identity alias foundation
--
-- Lands the complete alias-resolution architecture while the alias table is
-- EMPTY. No identity claim is made by this migration. No obsolete ID is
-- reconciled. No user state is migrated.
--
-- WITH ZERO ALIAS ROWS EVERY CHANGE BELOW IS A PROVABLE NO-OP:
--   `not exists (... where alias_card_id = c.id)` excludes nothing, and
--   `coalesce(res.canonical_card_id, r.card_id)` is the identity function.
-- That is the entire point: the dangerous contract change (the ownership
-- count model) lands and is verified under zero-data conditions, before any
-- row moves.
--
-- ─────────────────────────────────────────────────────────────────────────
-- SOURCE OF TRUTH
-- ─────────────────────────────────────────────────────────────────────────
-- Every existing object below is edited from its CAT-2D.0 recovered
-- production definition, never reconstructed from prose:
--   cards_effective                        docs/sql/cat-2d0-production-baseline.sql §3
--   get_active_snapshot_owned_card_ids()   docs/sql/own-0a-1-active-snapshot-owned-card-ids.sql
--   get_active_import_snapshot_read_model  docs/sql/ol-0d-4-active-snapshot-performance-hardening.sql
--
-- ─────────────────────────────────────────────────────────────────────────
-- DEPLOYMENT ORDER — dependency-driven, not preference
-- ─────────────────────────────────────────────────────────────────────────
--   §1 alias table (private)      -- no dependants
--   §2 no-chain trigger           -- depends on §1
--   §3 resolution view + grants   -- depends on §1; REQUIRED by §4/§5/§6
--   §4 cards_effective            -- depends on §3
--   §5 ownership RPC              -- depends on §3
--   §6 OL-0D read model           -- depends on §3 and §4
--
-- This file is ordered so a single top-to-bottom run is correct. It is
-- wrapped in one transaction: either the whole foundation lands or none of it.
--
-- ⚠ THE APPLICATION PR MUST NOT MERGE BEFORE THIS FILE IS DEPLOYED.
--   src/services/ownedLibraryService.js is updated in the same slice to require
--   reconciliation.distinctResolvedCardIds and .aliasCollapsedCount. Those
--   fields only exist after §5 runs. Merging the app first would put ownership
--   into its fail-closed error state until the SQL lands.
-- ═══════════════════════════════════════════════════════════════════════════

begin;


-- ═══════════════════════════════════════════════════════════════════════════
-- §1. public.card_identity_aliases — the identity map (PRIVATE)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Maps an obsolete provider card ID to the current canonical survivor. Written
-- only by privileged migration-owner execution, carrying evidence; never by a
-- runtime role (anon, authenticated and service_role all hold zero privileges
-- here — see the REVOKE below), never by users, never by the sync.
--
-- canonical_card_id REFERENCES public.cards(id) ON DELETE RESTRICT:
--   * the FK proves the survivor EXISTS;
--   * only the §2 trigger proves the survivor is CANONICAL. Under the retained
--     raw-history model obsolete rows stay in public.cards permanently, so the
--     FK alone would happily accept a survivor that is itself an alias. The two
--     mechanisms do genuinely different jobs — do not remove either.
--   * RESTRICT, not CASCADE: retiring a row that is an alias target must be a
--     deliberate act. card_extras' ON DELETE CASCADE is the counter-example
--     this deliberately avoids.

create table if not exists public.card_identity_aliases (
  alias_card_id      text        not null primary key,
  canonical_card_id  text        not null
                                 references public.cards(id) on delete restrict,
  family             text        not null,
  evidence           jsonb       not null,
  approved_by        text        not null,
  approved_at        timestamptz not null default now(),
  slice              text        not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint card_identity_aliases_no_self_alias
    check (alias_card_id <> canonical_card_id),
  constraint card_identity_aliases_ids_non_empty
    check (length(btrim(alias_card_id)) > 0 and length(btrim(canonical_card_id)) > 0)
);

-- Reverse lookup: needed by the §2 R2 check, by the future flatten UPDATE
-- (... where canonical_card_id = X), and by orphan validation.
create index if not exists card_identity_aliases_canonical_idx
  on public.card_identity_aliases (canonical_card_id);

comment on table public.card_identity_aliases is
  'CAT-2D. Evidence-backed map from an obsolete provider card id to the current canonical survivor. Private: no anon/authenticated grants. Read through public.card_identity_resolution.';

-- RLS on with NO policies. For anon/authenticated this is a second, independent
-- mechanism behind the revoked grants below.
--
-- It is NOT a defence against service_role, which bypasses RLS entirely — that
-- role is contained by the explicit REVOKE below and by nothing else. Do not
-- treat RLS here as covering all runtime roles.
alter table public.card_identity_aliases enable row level security;

-- Explicit, fail-closed privilege state. Provenance (evidence, approved_by,
-- approved_at, slice, timestamps) must never be reachable by a runtime role.
--
-- THE CONTRACT, STATED WITHOUT AMBIGUITY:
--   PUBLIC, anon, authenticated AND service_role have ZERO privileges on this
--   table. Alias population happens only through privileged migration-owner
--   execution — never through a runtime role, and never through the resolution
--   view.
--
-- Why each name is listed:
--   * PUBLIC — a privilege held via PUBLIC is held by every role, so revoking
--     only the named roles would leave a hole `has_table_privilege` still
--     reports as granted.
--   * service_role — LOAD-BEARING, and the reason this line was corrected.
--     service_role BYPASSES RLS, so the "RLS enabled with no policies" defence
--     below does not protect this table from it at all. Supabase also commonly
--     grants service_role broadly across the public schema by default, so
--     silence here is not absence. Leaving it unrevoked would have contradicted
--     both the stated ACL and the migration-only-writer invariant.
--
-- REVOKE (not merely "don't grant") is what makes this idempotent against a
-- prior deployment or a blanket `grant ... on all tables in schema public`
-- having run at any point.
revoke all on table public.card_identity_aliases from public, anon, authenticated, service_role;

-- updated_at maintenance, mirroring card_extras' existing pattern.
create or replace function public.set_card_identity_aliases_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists card_identity_aliases_set_updated_at on public.card_identity_aliases;
create trigger card_identity_aliases_set_updated_at
  before update on public.card_identity_aliases
  for each row execute function public.set_card_identity_aliases_updated_at();


-- ═══════════════════════════════════════════════════════════════════════════
-- §2. Two-sided no-chain enforcement — resolution depth 1 under serialized writes
-- ═══════════════════════════════════════════════════════════════════════════
--
-- A one-sided check is NOT sufficient. Given A -> B, an insert of B -> C passes
-- "is the target already an alias?" (C is not) and still creates the chain
-- A -> B -> C. Both directions must be rejected:
--
--   R1  NEW.canonical_card_id already exists as an alias_card_id
--       (the proposed survivor is itself obsolete)
--   R2  NEW.alias_card_id is already referenced as an existing canonical_card_id
--       (the proposed alias is currently a survivor for other rows)
--
-- Many aliases -> one survivor stays ALLOWED: neither rule constrains
-- canonical_card_id multiplicity. Trainer Galleries need exactly that, since
-- both the parent and the old subset generation alias to one live survivor.
--
-- SCOPE OF THE GUARANTEE — SERIALIZED WRITES (review finding).
--   R1/R2 are evaluated with row-level triggers against the state each
--   transaction can see. Under READ COMMITTED, two CONCURRENT privileged
--   transactions could each observe the pre-state and each pass its own check,
--   committing a chain neither saw. The trigger therefore proves depth = 1 for
--   SEQUENTIAL writers; it does NOT by itself prove it under arbitrary
--   concurrent writers.
--
--   This is acceptable and is deliberately not solved with a broader
--   concurrency system, because alias population is a SINGLE-WRITER,
--   SERIALIZED MIGRATION OPERATION by construction:
--     * the table is never user-authored — there is no runtime write path;
--     * no runtime role holds any grant on it — PUBLIC, anon, authenticated
--       and service_role are all revoked — so writes require the table OWNER,
--       i.e. privileged migration-owner execution;
--     * CAT-2D.1 populates nothing at all.
--
--   BINDING REQUIREMENT ON CAT-2D.2 AND LATER: any migration that changes alias
--   topology (insert, delete, or a flatten UPDATE) MUST first take an explicit
--   lock serializing alias writers, e.g.
--       lock table public.card_identity_aliases in share row exclusive mode;
--   or an equivalent advisory lock held for the whole transaction, BEFORE
--   reading or writing any alias row. Do not rely on the trigger alone.
--
-- Given serialized writes, depth is always 1, so resolution is a single lookup:
--     coalesce((select canonical_card_id from ... where alias_card_id = $1), $1)
-- There is deliberately NO recursive resolver. A recursive resolver tolerates
-- chains, and tolerated chains become cycles.
--
-- FUTURE FLATTENING RULE (documented; NOT implemented here).
--   For a later rename X -> Y where aliases already point at X, run in ONE
--   transaction, in this order:
--     1. update public.card_identity_aliases
--           set canonical_card_id = 'Y' where canonical_card_id = 'X';
--     2. insert into public.card_identity_aliases (alias_card_id, canonical_card_id, ...)
--           values ('X', 'Y', ...);
--   The order is load-bearing. Inserting first is REJECTED by R2 (X is still a
--   survivor for the existing rows) — which is the trigger doing its job, not a
--   defect. CAT-2D.1 implements no rename migration behavior beyond this
--   constraint.

create or replace function public.card_identity_aliases_enforce_no_chain()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- R1 — the proposed survivor must not itself be obsolete.
  if exists (
    select 1 from public.card_identity_aliases a
    where a.alias_card_id = new.canonical_card_id
  ) then
    raise exception
      'card_identity_aliases: canonical_card_id % is itself an alias — alias chains are not permitted (R1)',
      new.canonical_card_id
      using errcode = '23514';
  end if;

  -- R2 — the proposed alias must not currently be a survivor for other rows.
  if exists (
    select 1 from public.card_identity_aliases a
    where a.canonical_card_id = new.alias_card_id
  ) then
    raise exception
      'card_identity_aliases: alias_card_id % is currently a canonical survivor for other aliases — flatten those rows first (R2)',
      new.alias_card_id
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists card_identity_aliases_no_chain on public.card_identity_aliases;
create trigger card_identity_aliases_no_chain
  before insert or update on public.card_identity_aliases
  for each row execute function public.card_identity_aliases_enforce_no_chain();


-- ═══════════════════════════════════════════════════════════════════════════
-- §3. public.card_identity_resolution — the ONLY public read surface
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Exactly two columns. Nothing else about an alias is publicly observable.
--
-- WHY A VIEW AND NOT COLUMN GRANTS ON THE TABLE (privilege reasoning)
--
--   CAT-2D.0 recovered the privilege facts that decide this:
--     * public.cards_effective                    is security_invoker = true
--     * get_active_import_snapshot_read_model()   is SECURITY INVOKER
--     * get_active_snapshot_owned_card_ids()      is SECURITY DEFINER
--
--   Two of the three consumers execute with the CALLER's privileges, so a
--   caller-visible resolution surface is unavoidable. The design question is
--   only how narrow it can be made.
--
--   This view is created WITHOUT security_invoker, i.e. it runs with the
--   VIEW OWNER's privileges — the PostgreSQL default for views, and the
--   standard mechanism for exposing a column subset of a private table.
--   Consequences:
--     * anon/authenticated need SELECT on THIS VIEW only. They are granted
--       nothing at all on public.card_identity_aliases.
--     * evidence / approved_by / approved_at / slice / created_at / updated_at
--       are not merely ungranted — they are not projected by any object the
--       caller can address.
--     * the exposed surface cannot widen by accident. A future blanket
--       `grant select on all tables in schema public` would hit the base table,
--       but the base table has RLS enabled with NO policies, so such a grant
--       still yields zero rows. Two independent mechanisms.
--
--   Column-level grants on the base table were rejected: they would require
--   BOTH a permissive RLS SELECT policy AND column grants to be simultaneously
--   correct, and would leave the provenance columns one policy edit away from
--   exposure.
--
--   This is owner-rights BY DESIGN, and it is safe here because the underlying
--   data is global catalog identity with no user dimension and no RLS-protected
--   rows to leak. It is NOT a pattern to copy for user-scoped tables.
--
--   Explicitly NOT done: converting OL-0D to SECURITY DEFINER to avoid this
--   grant. That would move an RLS-honoring read onto definer privileges to dodge
--   a permissions question. Not justified, not attempted.

create or replace view public.card_identity_resolution as
  select
    a.alias_card_id,
    a.canonical_card_id
  from public.card_identity_aliases a;

comment on view public.card_identity_resolution is
  'CAT-2D. Minimal public alias-resolution surface: obsolete card id -> canonical survivor. Owner-rights READ-ONLY view over the private card_identity_aliases table so provenance columns are unreachable. Read by cards_effective, the OL-0D read model and the ownership RPC. Never grant DML on this view: it is automatically updatable and runs with owner rights.';

-- ── READ-ONLY HARDENING — load-bearing, not ceremony ──────────────────────
--
-- This is a simple single-table view with no aggregate, DISTINCT, GROUP BY,
-- set operation or window function, so PostgreSQL makes it AUTOMATICALLY
-- UPDATABLE. Any INSERT/UPDATE/DELETE privilege on it would write straight
-- through to card_identity_aliases — and because the view runs with OWNER
-- rights, such a write would bypass the base table's own privilege wall
-- entirely. A single stray DML grant would hand alias authorship to anon.
--
-- So privilege state is stated explicitly and fail-closed rather than assumed:
-- revoke EVERYTHING (including via PUBLIC, and including service_role) first,
-- then grant back exactly one privilege. GRANT alone is not sufficient — it
-- cannot remove a privilege an earlier deployment or a blanket schema grant
-- may already have left in place.
--
-- service_role gets SELECT only, and has ZERO privileges on the base table
-- (see §1). It has no operational need for DML on either object: alias
-- population is done by migrations running as the table OWNER, not by any
-- runtime role and not through this surface. Phase E asserts all of this for
-- all three runtime roles rather than printing it.
revoke all on table public.card_identity_resolution from public, anon, authenticated, service_role;
grant select on table public.card_identity_resolution to anon, authenticated, service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- §4. public.cards_effective — canonical product-facing catalog
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Baseline: the CAT-2D.0 recovered 14-column production definition, reproduced
-- exactly. The ONLY change is the trailing NOT EXISTS alias exclusion.
--
-- Preserved verbatim: all 14 columns, their order (artist_id is column 14),
-- the COALESCE(illustrator_override, illustrator) behavior, the LEFT JOIN to
-- card_extras, and security_invoker = true.
--
-- security_invoker = true is REQUIRED and is NOT relaxed: reads still execute
-- with the caller's permissions against public.cards and public.card_extras, so
-- RLS there continues to govern. The caller needs SELECT on
-- card_identity_resolution (granted in §3) for the subquery.
--
-- This supersedes CAT-0's recorded property that cards -> cards_effective row
-- loss is "structurally impossible". Row loss now happens, by exactly one rule:
-- an id with an approved alias row. With zero aliases the output is unchanged.

create or replace view public.cards_effective
  with (security_invoker = true)
as
  select
    c.id,
    c.name,
    c.set_id,
    c.set_name,
    c.local_id,
    coalesce(ce.illustrator_override, c.illustrator) as illustrator,
    c.image_url,
    c.rarity,
    c.release_date,
    c.pricing,
    c.pricing_updated_at,
    c.pricing_source,
    c.last_synced_at,
    c.artist_id
  from public.cards c
  left join public.card_extras ce on c.id = ce.card_id
  where not exists (
    select 1
    from public.card_identity_resolution r
    where r.alias_card_id = c.id
  );

-- Grants restated so this migration is self-contained (CREATE OR REPLACE
-- preserves them; these match the CAT-2D.0 recovered relacl).
grant select on public.cards_effective to anon, authenticated, service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- §5. public.get_active_snapshot_owned_card_ids() — alias-aware ownership
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Baseline: the exact recovered production body. Three changes only:
--   (a) LEFT JOIN card_identity_resolution to resolve each matched historical id
--   (b) ownedCardIds now carries distinct RESOLVED ids
--   (c) reconciliation gains distinctResolvedCardIds and aliasCollapsedCount
--
-- PRESERVED EXACTLY: SECURITY DEFINER, STABLE, search_path '', auth.uid()
-- scoping, zero-arg signature (no caller-supplied user id), the no_auth /
-- no_active_batch / multiple_active_batches / ready states, batchId,
-- activatedAt, matcherVersion, and contractVersion 1 — the new fields are
-- purely ADDITIVE, so no version bump is warranted.
--
-- THE 23514 RECONCILIATION IS UNCHANGED IN MEANING. It compares count(*) of
-- matched CHILD ROWS against the immutable batch header's matched_rows. Alias
-- resolution collapses IDS, never ROWS, and the join cannot fan out because
-- alias_card_id is the primary key of the underlying table — so at most one
-- resolution row matches each child row. The row count is therefore provably
-- identical to the pre-alias behavior.
--
-- user_import_rows is READ ONLY here and stays immutable historical evidence.

create or replace function public.get_active_snapshot_owned_card_ids()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  v_uid              uuid := auth.uid();
  v_active_count     int;
  v_batch            public.user_import_batches%rowtype;
  v_ids              text[];
  v_distinct_matched bigint;
  v_distinct_resolved bigint;
  v_matched_rows     bigint;
begin
  if v_uid is null then
    return jsonb_build_object('contractVersion', 1, 'state', 'error', 'reason', 'no_auth');
  end if;

  -- Fail closed on multiple active batches. The partial unique index
  -- uib_one_active_per_user makes >1 impossible; this never silently picks one.
  select count(*)
    into v_active_count
  from public.user_import_batches
  where user_id = v_uid and status = 'active';

  if v_active_count = 0 then
    return jsonb_build_object('contractVersion', 1, 'state', 'no_active_batch');
  elsif v_active_count > 1 then
    return jsonb_build_object('contractVersion', 1, 'state', 'multiple_active_batches');
  end if;

  select *
    into v_batch
  from public.user_import_batches
  where user_id = v_uid and status = 'active';   -- exactly one (guaranteed above + by index)

  -- Single scan of the active batch's matched rows: resolved owned id set,
  -- BOTH distinct counts, and the row count for reconciliation.
  -- CAT-2D.1: the LEFT JOIN cannot fan out — alias_card_id is the PK of
  -- card_identity_aliases — so count(*) is unaffected by resolution.
  select
    array_agg(distinct coalesce(res.canonical_card_id, r.card_id)
              order by coalesce(res.canonical_card_id, r.card_id)),
    count(distinct r.card_id),
    count(distinct coalesce(res.canonical_card_id, r.card_id)),
    count(*)
    into v_ids, v_distinct_matched, v_distinct_resolved, v_matched_rows
  from public.user_import_rows r
  left join public.card_identity_resolution res
    on res.alias_card_id = r.card_id
  where r.batch_id = v_batch.id
    and r.match_status = 'matched'
    and r.card_id is not null;

  -- Minimal fail-closed reconciliation to the immutable batch header.
  -- Row-count semantics, unchanged by CAT-2D.1.
  if v_matched_rows <> v_batch.matched_rows then
    raise exception
      'get_active_snapshot_owned_card_ids: matched row count % <> header matched_rows % for batch %',
      v_matched_rows, v_batch.matched_rows, v_batch.id
      using errcode = '23514';
  end if;

  return jsonb_build_object(
    'contractVersion', 1,
    'state', 'ready',
    'batchId', v_batch.id,
    'activatedAt', v_batch.activated_at,
    'matcherVersion', v_batch.matcher_version,
    'ownedCardIds', coalesce(to_jsonb(v_ids), '[]'::jsonb),
    'reconciliation', jsonb_build_object(
      'distinctMatchedCardIds',  coalesce(v_distinct_matched, 0),
      'distinctResolvedCardIds', coalesce(v_distinct_resolved, 0),
      'aliasCollapsedCount',     coalesce(v_distinct_matched, 0) - coalesce(v_distinct_resolved, 0),
      'matchedRows',             coalesce(v_matched_rows, 0)
    )
  );
end;
$function$;

-- Grants restated verbatim from the CAT-2D.0 recovered proacl.
revoke all on function public.get_active_snapshot_owned_card_ids() from public;
grant execute on function public.get_active_snapshot_owned_card_ids()
  to postgres, anon, authenticated, service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- §6. public.get_active_import_snapshot_read_model(...) — alias-aware OL-0D
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Baseline: ol-0d-4 (the current canonical body), edited in exactly ONE place.
--
-- THE ONLY CHANGE is inside matched_agg: historical card ids are resolved
-- BEFORE aggregation, so quantities from several historical ids that resolve to
-- one survivor merge into a single canonical row.
--
--   before:  group by r.card_id
--   after:   group by coalesce(res.canonical_card_id, r.card_id)
--
-- Everything downstream already keys off matched_agg.card_id, so it now carries
-- the resolved id with no further edits: fallback_rows, item_keys' LEFT JOIN to
-- cards_effective, filters, ordering, pagination and the emitted 'cardId'.
--
-- Determinism of fallback evidence is preserved: first_source_row is still
-- min(source_row_number) over the group — now over the merged group — and
-- (batch_id, source_row_number) is unique, so fallback_rows still joins 1:1.
--
-- PRESERVED EXACTLY: the 8-argument signature, contractVersion 1, SECURITY
-- INVOKER, STABLE, search_path '', auth.uid() authentication, the 23514
-- reconciliation, search escaping, filters, sorting, pagination, unresolved
-- grouping, summary semantics, cards_effective as the catalog source,
-- artist_id in the page payload, and catalog-missing behavior.
--
-- Note the interaction that makes this coherent: §4 removes aliased rows from
-- cards_effective, and §6 resolves historical ids to survivors before joining
-- it. A historical id therefore lands on the survivor's catalog row instead of
-- reporting catalog-missing.

create or replace function public.get_active_import_snapshot_read_model(
  p_expected_batch_id uuid    default null,
  p_limit             integer default 60,
  p_offset            integer default 0,
  p_search            text    default null,
  p_set_id            text    default null,
  p_artist_id         text    default null,
  p_catalog_status    text    default 'all',
  p_sort              text    default 'name_asc'
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_uid            uuid := auth.uid();
  v_batch          public.user_import_batches%rowtype;
  v_batch_id       uuid;
  v_search_pattern text;
  v_result         jsonb;

  -- fail-closed reconciliation counters (actual child rows by status).
  v_c_total        bigint;
  v_c_matched      bigint;
  v_c_ambiguous    bigint;
  v_c_unmatched    bigint;
  v_c_invalid      bigint;
begin
  -- 1. authentication is mandatory (never converted into empty results).
  if v_uid is null then
    raise exception 'get_active_import_snapshot_read_model: not authenticated'
      using errcode = '28000';
  end if;

  -- 2. argument validation — invalid input is a hard error, never a silent fallback.
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'get_active_import_snapshot_read_model: p_limit must be between 1 and 100 (got %)', p_limit
      using errcode = '22023';
  end if;
  if p_offset is null or p_offset < 0 then
    raise exception 'get_active_import_snapshot_read_model: p_offset must be >= 0 (got %)', p_offset
      using errcode = '22023';
  end if;
  if p_catalog_status is null or p_catalog_status not in ('all', 'available', 'missing') then
    raise exception 'get_active_import_snapshot_read_model: p_catalog_status must be all|available|missing (got %)', p_catalog_status
      using errcode = '22023';
  end if;
  if p_sort is null or p_sort not in ('name_asc', 'set_asc', 'quantity_desc') then
    raise exception 'get_active_import_snapshot_read_model: p_sort must be name_asc|set_asc|quantity_desc (got %)', p_sort
      using errcode = '22023';
  end if;

  -- 3. resolve the caller's active batch. The partial unique index
  --    uib_one_active_per_user guarantees at most one row here.
  select * into v_batch
  from public.user_import_batches
  where user_id = v_uid
    and status = 'active';

  -- 4. no active batch → typed state, regardless of p_expected_batch_id.
  if not found then
    return jsonb_build_object(
      'contractVersion', 1,
      'state', 'no_active_batch'
    );
  end if;

  v_batch_id := v_batch.id;

  -- 5. optimistic-concurrency guard: the active snapshot changed under the caller.
  if p_expected_batch_id is not null and p_expected_batch_id <> v_batch_id then
    return jsonb_build_object(
      'contractVersion', 1,
      'state', 'snapshot_changed',
      'activeBatchId', v_batch_id
    );
  end if;

  -- 6. FAIL-CLOSED reconciliation (unchanged; still errcode 23514).
  select
    count(*),
    count(*) filter (where match_status = 'matched'),
    count(*) filter (where match_status = 'ambiguous'),
    count(*) filter (where match_status = 'unmatched'),
    count(*) filter (where match_status = 'invalid')
  into v_c_total, v_c_matched, v_c_ambiguous, v_c_unmatched, v_c_invalid
  from public.user_import_rows
  where batch_id = v_batch_id;

  if v_c_total     <> v_batch.stored_rows
     or v_c_matched   <> v_batch.matched_rows
     or v_c_ambiguous <> v_batch.ambiguous_rows
     or v_c_unmatched <> v_batch.unmatched_rows
     or v_c_invalid   <> v_batch.invalid_rows then
    raise exception
      'get_active_import_snapshot_read_model: reconciliation failure for active batch % — child stored/matched/ambiguous/unmatched/invalid = %/%/%/%/% but header declares %/%/%/%/%',
      v_batch_id,
      v_c_total, v_c_matched, v_c_ambiguous, v_c_unmatched, v_c_invalid,
      v_batch.stored_rows, v_batch.matched_rows, v_batch.ambiguous_rows, v_batch.unmatched_rows, v_batch.invalid_rows
      using errcode = '23514';
  end if;

  -- 7. escaped LITERAL search pattern (unchanged).
  if p_search is not null and length(btrim(p_search)) > 0 then
    v_search_pattern := '%' ||
      replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  -- 8. ready payload.
  with
  -- Canonical aggregation FIRST, over matched child rows only.
  -- CAT-2D.1: aggregate by the RESOLVED canonical id, so quantities from
  -- several historical ids that resolve to one survivor merge here. The LEFT
  -- JOIN cannot fan out (alias_card_id is a primary key), so source_row_count
  -- and the reconciliation above are unaffected.
  matched_agg as (
    select
      coalesce(res.canonical_card_id, r.card_id) as card_id,
      sum(r.quantity)::bigint  as quantity,
      count(*)::bigint         as source_row_count,
      min(r.source_row_number) as first_source_row
    from public.user_import_rows r
    left join public.card_identity_resolution res
      on res.alias_card_id = r.card_id
    where r.batch_id = v_batch_id
      and r.match_status = 'matched'
      and r.card_id is not null
    group by coalesce(res.canonical_card_id, r.card_id)
  ),
  -- Deterministic fallback evidence = the contributing row with the lowest
  -- source_row_number. (batch_id, source_row_number) is unique → joins 1:1.
  fallback_rows as (
    select
      ma.card_id, ma.quantity, ma.source_row_count, ma.first_source_row,
      fr.product_name, fr.set_name, fr.card_number, fr.variance, fr.rarity
    from matched_agg ma
    join public.user_import_rows fr
      on fr.batch_id = v_batch_id
     and fr.source_row_number = ma.first_source_row
  ),
  -- OL-0D.2: NARROW key set. One row per canonical card, LEFT JOINed to the
  -- effective catalog VIEW (not the base tables). Plain join on ce.id: no
  -- DISTINCT ON, no pricing::text, no sort. Stale references (no catalog row)
  -- are retained via LEFT JOIN, exactly as before.
  --
  -- Only the columns needed for summary, filtering and ordering are carried
  -- here. pricing / image_url / release_date / pricing_updated_at are NOT —
  -- they are fetched later, for page rows only.
  item_keys as (
    select
      f.card_id,
      f.quantity,
      f.source_row_count,
      f.first_source_row,
      f.product_name,
      f.set_name,
      f.card_number,
      f.variance,
      f.rarity,
      (ce.id is not null)               as is_available,
      ce.name                           as cat_name,
      ce.set_id                         as cat_set_id,
      ce.set_name                       as cat_set_name,
      ce.local_id                       as cat_local_id,
      ce.illustrator                    as cat_illustrator,
      ce.artist_id                      as cat_artist_id,
      coalesce(ce.name, f.product_name) as eff_name,
      coalesce(ce.set_name, f.set_name) as eff_set
    from fallback_rows f
    left join public.cards_effective ce
      on ce.id = f.card_id
  ),
  -- Whole-batch stats (unfiltered, unpaginated) for the summary block.
  item_stats as (
    select
      count(*)::bigint                                                   as distinct_cards,
      coalesce(sum(quantity), 0)::bigint                                 as matched_qty,
      count(*) filter (where not is_available)::bigint                   as missing_cards,
      coalesce(sum(quantity) filter (where not is_available), 0)::bigint as missing_qty
    from item_keys
  ),
  -- Filters apply to the grouped canonical result BEFORE pagination (unchanged
  -- predicates, evaluated over the narrow key set).
  items_filtered as (
    select *
    from item_keys s
    where
      ( p_catalog_status = 'all'
        or (p_catalog_status = 'available' and s.is_available)
        or (p_catalog_status = 'missing'   and not s.is_available) )
      and ( v_search_pattern is null
        or coalesce(s.cat_name, '')        ilike v_search_pattern escape '\'
        or coalesce(s.cat_set_name, '')    ilike v_search_pattern escape '\'
        or coalesce(s.cat_local_id, '')    ilike v_search_pattern escape '\'
        or coalesce(s.cat_illustrator, '') ilike v_search_pattern escape '\'
        or ( not s.is_available and (
                 s.product_name ilike v_search_pattern escape '\'
              or s.set_name     ilike v_search_pattern escape '\'
              or s.card_number  ilike v_search_pattern escape '\'
        )) )
      and ( p_set_id    is null or s.cat_set_id    = p_set_id )
      and ( p_artist_id is null or s.cat_artist_id = p_artist_id )
  ),
  total_cte as (
    select count(*)::bigint as total from items_filtered
  ),
  -- OL-0D.2: pagination by ORDER BY + LIMIT/OFFSET over the NARROW rows,
  -- instead of row_number() over the whole (wide) result. The ORDER BY is
  -- identical to the old row_number() ORDER BY, ending in card_id ASC — a total
  -- order (card_id is unique per row here) — so the page boundary and the page
  -- contents are deterministic and unchanged. `rn` was internal only.
  page_keys as (
    select *
    from items_filtered f
    order by
      case when p_sort = 'name_asc'      then f.eff_name end asc  nulls last,
      case when p_sort = 'set_asc'       then f.eff_set  end asc  nulls last,
      case when p_sort = 'quantity_desc' then f.quantity end desc nulls last,
      f.card_id asc
    limit p_limit
    offset p_offset
  ),
  -- OL-0D.2: the WIDE catalog payload is fetched HERE, for page rows only
  -- (<= p_limit <= 100), from the SAME view. Same columns, same semantics as
  -- before, so the emitted card object is identical to what the old
  -- cards_effective/DISTINCT ON path produced.
  items_json as (
    select
      coalesce(jsonb_agg(
        jsonb_build_object(
          'cardId',         pk.card_id,
          'quantity',       pk.quantity,
          'sourceRowCount', pk.source_row_count,
          'firstSourceRow', pk.first_source_row,
          'catalogStatus',  case when pk.is_available then 'available' else 'missing' end,
          'card', case when pk.is_available then
            jsonb_build_object(
              'id',                 ce.id,
              'name',               ce.name,
              'set_id',             ce.set_id,
              'set_name',           ce.set_name,
              'local_id',           ce.local_id,
              'illustrator',        ce.illustrator,
              'artist_id',          ce.artist_id,
              'image_url',          ce.image_url,
              'rarity',             ce.rarity,
              'release_date',       ce.release_date,
              'pricing',            ce.pricing,
              'pricing_updated_at', ce.pricing_updated_at
            )
          else null end,
          'fallback', jsonb_build_object(
            'productName', pk.product_name,
            'setName',     pk.set_name,
            'cardNumber',  pk.card_number,
            'variance',    pk.variance,
            'rarity',      pk.rarity
          )
        )
        order by
          case when p_sort = 'name_asc'      then pk.eff_name end asc  nulls last,
          case when p_sort = 'set_asc'       then pk.eff_set  end asc  nulls last,
          case when p_sort = 'quantity_desc' then pk.quantity end desc nulls last,
          pk.card_id asc
      ), '[]'::jsonb) as items,
      count(*)::bigint as returned
    from page_keys pk
    left join public.cards_effective ce
      on ce.id = pk.card_id
  ),
  -- Unresolved grouping (unchanged).
  unresolved_groups as (
    select
      r.match_status          as status,
      r.match_reason          as reason,
      count(*)::bigint        as row_count,
      sum(r.quantity)::bigint as quantity
    from public.user_import_rows r
    where r.batch_id = v_batch_id
      and r.match_status in ('ambiguous', 'unmatched', 'invalid')
    group by r.match_status, r.match_reason
  ),
  unresolved_json as (
    select
      coalesce(jsonb_agg(
        jsonb_build_object(
          'status',   status,
          'reason',   reason,
          'rowCount', row_count,
          'quantity', quantity
        )
        order by status asc, reason asc
      ), '[]'::jsonb) as groups,
      coalesce(sum(row_count), 0)::bigint as unresolved_rows,
      coalesce(sum(quantity),  0)::bigint as unresolved_quantity
    from unresolved_groups
  )
  select jsonb_build_object(
    'contractVersion', 1,
    'state', 'ready',
    'batch', jsonb_build_object(
      'id',             v_batch.id,
      'source',         v_batch.source,
      'matcherVersion', v_batch.matcher_version,
      'createdAt',      v_batch.created_at,
      'activatedAt',    v_batch.activated_at
    ),
    'summary', jsonb_build_object(
      'totalSourceRows',        v_batch.total_source_rows,
      'pokemonRows',            v_batch.pokemon_rows,
      'positiveQuantityRows',   v_batch.positive_qty_rows,
      'storedRows',             v_batch.stored_rows,
      'matchedRows',            v_batch.matched_rows,
      'ambiguousRows',          v_batch.ambiguous_rows,
      'unmatchedRows',          v_batch.unmatched_rows,
      'invalidRows',            v_batch.invalid_rows,
      'watchlistOnlyRows',      v_batch.watchlist_only_rows,
      'nonPokemonRows',         v_batch.non_pokemon_rows,
      'invalidQuantityRows',    v_batch.invalid_quantity_rows,
      'matchedQuantity',        ist.matched_qty,
      'distinctCanonicalCards', ist.distinct_cards,
      'unresolvedRows',         ur.unresolved_rows,
      'unresolvedQuantity',     ur.unresolved_quantity,
      'catalogMissingCards',    ist.missing_cards,
      'catalogMissingQuantity', ist.missing_qty
    ),
    'unresolved', jsonb_build_object('groups', ur.groups),
    'page', jsonb_build_object(
      'limit',         p_limit,
      'offset',        p_offset,
      'totalItems',    tc.total,
      'returnedItems', ij.returned,
      'items',         ij.items
    )
  )
  into v_result
  from item_stats ist
  cross join total_cte tc
  cross join items_json ij
  cross join unresolved_json ur;

  return v_result;
end;
$$;

-- ── ACL CORRECTION (review finding) ───────────────────────────────────────
--
-- ol-0d-4 ends with `revoke all ... from public; grant execute ... to
-- authenticated;` and describes that as restating the grants verbatim. It is
-- NOT verbatim against production: CAT-2D.0 recovered the live proacl as
--   {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
-- i.e. EXECUTE for four roles, not one.
--
-- Copying ol-0d-4's tail into this migration would therefore have SILENTLY
-- NARROWED the production ACL — dropping EXECUTE for postgres, anon and
-- service_role — inside a slice whose entire acceptance criterion is that
-- nothing observable changes. CREATE OR REPLACE preserves an existing ACL, but
-- an explicit REVOKE immediately afterwards does not, and a migration that
-- calls itself self-contained cannot lean on preservation anyway.
--
-- The grants below are the CAT-2D.0 RECOVERED PRODUCTION CONTRACT. No repo
-- evidence indicates any of the four was intentionally removed. Phase E asserts
-- the resulting ACL.
revoke all on function public.get_active_import_snapshot_read_model(uuid, integer, integer, text, text, text, text, text) from public;
grant execute on function public.get_active_import_snapshot_read_model(uuid, integer, integer, text, text, text, text, text)
  to postgres, anon, authenticated, service_role;

commit;


-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Fully reversible while the alias table is empty, which it is for the whole of
-- CAT-2D.1. Run top to bottom inside one transaction:
--
--   begin;
--   -- 1. restore the pre-CAT-2D.1 catalog view (CAT-2D.0 recovered baseline)
--   --    -> docs/sql/cat-2d0-production-baseline.sql §3
--   -- 2. restore the pre-CAT-2D.1 ownership RPC
--   --    -> docs/sql/own-0a-1-active-snapshot-owned-card-ids.sql
--   -- 3. restore the pre-CAT-2D.1 read model
--   --    -> docs/sql/ol-0d-4-active-snapshot-performance-hardening.sql
--   drop view if exists public.card_identity_resolution;
--   drop table if exists public.card_identity_aliases;   -- refuses if rows exist as FK targets
--   drop function if exists public.card_identity_aliases_enforce_no_chain();
--   drop function if exists public.set_card_identity_aliases_updated_at();
--   commit;
--
-- Revert the application PR alongside step 2, since the wrapper requires the
-- additive reconciliation fields.
--
-- No data is destroyed by this rollback: no alias row ever existed, and no
-- public.cards row, user_import_rows row, override or card_extras row is
-- touched by this migration in either direction.
