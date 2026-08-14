-- docs/sql/own-0a-1-active-snapshot-owned-card-ids.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- OWN-0A — get_active_snapshot_owned_card_ids()
-- EXACT PRODUCTION BASELINE, recovered by CAT-2D.0
--
-- Recovered 2026-08-14 via read-only `pg_get_functiondef`. The function body
-- below is the live production definition, transcribed verbatim. Nothing in it
-- was authored, inferred, reformatted or "improved".
--
-- WHY THIS FILE EXISTS
--   docs/OWN-0A_CLOSEOUT.md:202 records this exact path as a deployed file, but
--   it was never committed — `git log --all` over this path returned nothing,
--   and the function appeared nowhere in the repository except prose and its JS
--   caller. Production ran a SECURITY DEFINER ownership function whose source
--   the repository did not hold. CAT-2D.1 was blocked on that, because it must
--   add alias resolution here and the only alternative to the real body was
--   inventing one.
--
--   That gap is now CLOSED. Future work must read this file rather than
--   reconstruct the function from prose descriptions.
--
-- DEPLOYMENT STATUS
--   NOT DEPLOYED by CAT-2D.0, and deployment is not part of this slice.
--   Executing it against current production is a no-op — it is the definition
--   production already holds — but that is a property, not an invitation.
--
-- RECOVERED PROPERTIES (introspection, 2026-08-14)
--   arguments        () — zero-arg; NOT callable with a caller-supplied user id
--   returns          jsonb
--   language         plpgsql
--   volatility       STABLE
--   security         SECURITY DEFINER     <-- differs from OL-0D, which is INVOKER
--   proconfig        SET search_path TO ''
--   proacl           {postgres=X/postgres,anon=X/postgres,
--                     authenticated=X/postgres,service_role=X/postgres}
--                    (EXECUTE only, for all four roles)
--
-- CLIENT-OBSERVED CONTRACT — corroborating repo evidence
--   src/services/ownedLibraryService.js:287-362 consumes this RPC and enforces,
--   on `ready`: contractVersion === 1; state ∈ {ready, no_active_batch,
--   multiple_active_batches, error}; ownedCardIds an array of non-empty strings
--   with no duplicates; ownedCardIds.length === distinctMatchedCardIds; distinct
--   set size === distinctMatchedCardIds; matchedRows >= distinctMatchedCardIds;
--   batchId and matcherVersion non-empty; activatedAt a valid timestamp. The
--   wrapper never soft-fails to an empty owned set — malformed payloads throw.
--   Every one of those assertions is satisfied by the body below.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_active_snapshot_owned_card_ids()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid          uuid := auth.uid();
  v_active_count int;
  v_batch        public.user_import_batches%rowtype;
  v_ids          text[];
  v_distinct     bigint;
  v_matched_rows bigint;
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

  -- Single scan of the active batch's matched rows: owned id set + reconciliation.
  select
    array_agg(distinct r.card_id order by r.card_id),
    count(distinct r.card_id),
    count(*)
    into v_ids, v_distinct, v_matched_rows
  from public.user_import_rows r
  where r.batch_id = v_batch.id
    and r.match_status = 'matched'
    and r.card_id is not null;

  -- Minimal fail-closed reconciliation to the immutable batch header.
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
      'distinctMatchedCardIds', coalesce(v_distinct, 0),
      'matchedRows',            coalesce(v_matched_rows, 0)
    )
  );
end;
$function$;


-- ═══════════════════════════════════════════════════════════════════════════
-- NOTES FOR CAT-2D.1 — recorded from the recovered body; nothing acted on here
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Having the real body settles three questions the prose description could not.
--
-- 1. THE 23514 RECONCILIATION IS SAFE UNDER ALIAS RESOLUTION.
--    The fail-closed check compares `count(*)` of matched rows against
--    `v_batch.matched_rows` — a ROW count against the immutable batch header.
--    It does not involve distinct card ids. Alias resolution collapses distinct
--    IDS, never rows, so it cannot trip this exception. The header contract is
--    untouched by CAT-2D.1.
--
-- 2. THE THREE-COUNT CHANGE IS LOCAL AND SMALL.
--    All three quantities come from one scan. Resolution adds a left join to
--    the alias map and one more aggregate, e.g.
--      array_agg(distinct coalesce(a.canonical_card_id, r.card_id) order by 1)
--      count(distinct coalesce(a.canonical_card_id, r.card_id))  -- resolved
--      count(distinct r.card_id)                                 -- historical
--      count(*)                                                  -- rows
--    `distinctMatchedCardIds` keeps its current meaning (historical distinct),
--    a new `distinctResolvedCardIds` is added, and `aliasCollapsedCount` is
--    their difference. `user_import_rows` is read-only here and stays so.
--
-- 3. THE CLIENT ASSERTION IS THE ONLY THING THAT BREAKS.
--    ownedLibraryService.js:343 enforces
--      ownedCardIds.length === distinctMatchedCardIds
--    Under collapse the array shrinks while `distinctMatchedCardIds` does not,
--    so the wrapper would throw and ownership would enter the fail-closed error
--    state — a full-app ownership gate from a data condition. The wrapper and
--    the function must therefore change in the SAME slice.
--
-- SECURITY — see docs/CAT-2D.0_PRODUCTION_SQL_RECOVERY.md §5.
--    This function is SECURITY DEFINER, so it can read card_identity_aliases
--    regardless of caller privileges. The OL-0D read model is SECURITY INVOKER
--    and cannot. Do not convert OL-0D to DEFINER merely to avoid granting the
--    two-column alias resolution surface.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK (recorded from OWN-0A_CLOSEOUT.md:155)
-- ═══════════════════════════════════════════════════════════════════════════
--
--   drop function if exists public.get_active_snapshot_owned_card_ids();
--
-- Dropping it removes the authoritative ownership read. Under OWN-0B the App
-- gates every ownership-dependent surface when this read fails, so a drop is a
-- full ownership outage, not a soft degradation. Do not drop without a plan.
