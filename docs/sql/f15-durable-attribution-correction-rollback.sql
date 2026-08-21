-- ═══════════════════════════════════════════════════════════════════════════
-- F-15 — DURABLE ATTRIBUTION CORRECTION: ROLLBACK
--
-- ⚠ DO NOT RUN THIS DURING DEPLOYMENT. It is authored ahead of execution so a
--   reviewed, tested reversal exists before it is ever needed — not because
--   anything is expected to go wrong.
--
-- ⚠ THIS FILE HAS NOT BEEN EXECUTED.
--
-- ⚠ NEITHER LEVEL EVER WRITES public.cards. Raw provider attribution was never
--   modified by the migration (invariant I-1, asserted by V-14), so restoring
--   the view is sufficient to restore pre-F-15 effective behaviour exactly.
--   There is nothing to un-rewrite.
--
-- Kept deliberately SEPARATE from
-- docs/sql/f15-durable-attribution-correction.sql so it cannot be pasted into
-- a deployment window by accident.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- CHOOSING A LEVEL
--
--   LEVEL 1 — PREFERRED FUNCTIONAL ROLLBACK.
--     Restores the pre-F-15 view. KEEPS the four columns, their data, the
--     constraints, the trigger and the restrictive column ACL.
--     Use this by default. It fully restores prior runtime behaviour and
--     loses NO correction data — the rows go inert and re-activate if the
--     F-15 view is ever re-applied.
--
--   LEVEL 2 — FULL TEARDOWN.
--     Level 1, then remove the channel entirely.
--     Use ONLY when abandoning F-15, and only after confirming no correction
--     rows are worth keeping.
--
--   Stopping after Level 1 is a legitimate and safer end state.
--
-- WHAT ROLLBACK COSTS, STATED PLAINLY
--   If F-15 ships before ATTR-1, Level 1 loses nothing at all: the only rows
--   touched are the five backfilled legacy ones, and their backfilled values
--   reproduce exactly the behaviour the rollback restores (that is what B-2
--   proved). If ATTR-1 has already run, Level 1 reverts those twelve cards to
--   their pre-repair effective attribution — including xyp-XY67a returning to
--   artist 'sui' — while PRESERVING the correction rows themselves.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- LEVEL 1 — RESTORE THE PRE-F-15 VIEW (preferred)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- This is the CAT-2D.1 + CAT-3B definition, byte-for-byte what production held
-- before F-15: 14 columns in order, security_invoker, the card_extras LEFT
-- JOIN, the alias exclusion, both existing COALESCE overrides, and artist_id
-- taken RAW from c.
--
-- The F-15 columns remain and stay readable by the same narrow column ACL. The
-- old view reads only card_id, illustrator_override and image_url_override —
-- all still granted — so anon/authenticated keep working, and no provenance
-- becomes readable. The admission trigger also stays: it constrains writes to
-- a channel nothing now reads, which is harmless and keeps the data coherent
-- if the view is re-applied.

begin;

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
    coalesce(ce.image_url_override, c.image_url)     as image_url,
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

grant select on public.cards_effective to anon, authenticated, service_role;

comment on view public.cards_effective is
  'Canonical product-facing catalog. CAT-2D.1 alias exclusion + CAT-3B durable image override. illustrator and image_url are the only overridable values; both come from public.card_extras. security_invoker = true. F-15 attribution override ROLLED BACK at the view layer — card_extras.artist_id_override is retained but no longer read.';

-- Confirm the reversal actually took effect before committing.
do $$
declare
  v_def text;
begin
  select pg_get_viewdef('public.cards_effective'::regclass, true) into v_def;
  if position('artist_id_override' in lower(v_def)) > 0 then
    raise exception
      'F-15 Level 1 rollback FAILED: cards_effective still references '
      'artist_id_override.';
  end if;
  if position('card_identity_resolution' in v_def) = 0 then
    raise exception
      'F-15 Level 1 rollback FAILED: the CAT-2D.1 alias exclusion is missing.';
  end if;
  if position('image_url_override' in lower(v_def)) = 0 then
    raise exception
      'F-15 Level 1 rollback FAILED: the CAT-3B image override is missing.';
  end if;
  raise notice 'F-15 Level 1 rollback: view restored to pre-F-15 semantics.';
end $$;

commit;


-- ═══════════════════════════════════════════════════════════════════════════
-- LEVEL 2 — FULL TEARDOWN (only when abandoning the channel)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠ RUN LEVEL 1 FIRST. Dropping artist_id_override while the F-15 view still
--   references it would fail — or, worse, if the drop were forced with CASCADE
--   it would DROP THE VIEW and take the entire product offline. Never use
--   CASCADE here.
--
-- ⚠ ORDER IS LOAD-BEARING, exactly as in CAT-3B §7.
--   The columns are dropped BEFORE any broader grant is restored. Restoring a
--   table-level grant while the provenance columns still exist would expose
--   attribution evidence, approver and timestamp to anon and authenticated —
--   creating the exact leak the migration's §8 prevents, during what is meant
--   to be a safety operation.
--
--   This file restores NO broader grant. The narrow column ACL that CAT-3B
--   established is correct on its own merits and should survive F-15's
--   removal. Keeping the tightening while abandoning F-15 is the intended end
--   state. If a future operator genuinely needs the pre-CAT-3B grants back,
--   that belongs in a CAT-3B rollback, not here — and only after the
--   provenance columns are gone.
--
-- ⚠ THIS DESTROYS CORRECTION DATA. Every attribution correction — including
--   any ATTR-1 repair already applied — is permanently lost. Export first:
--
--     select card_id, illustrator_override, artist_id_override,
--            attribution_override_evidence, attribution_override_approved_by,
--            attribution_override_approved_at
--     from public.card_extras
--     where illustrator_override is not null;

-- begin;
--
-- -- 1. Admission trigger and function (the view no longer reads the channel).
-- drop trigger if exists card_extras_admit_attribution_override on public.card_extras;
-- drop function if exists public.card_extras_admit_attribution_override();
--
-- -- 2. Constraints. Dropped before the columns so the drops cannot fail on a
-- --    dependency, and so a partial teardown cannot leave a constraint
-- --    referencing a column that is about to disappear.
-- alter table public.card_extras
--   drop constraint if exists card_extras_attribution_override_all_or_nothing,
--   drop constraint if exists card_extras_attribution_override_approved_by_nonempty,
--   drop constraint if exists card_extras_attribution_override_requires_illustrator,
--   drop constraint if exists card_extras_artist_id_override_fk;
--
-- -- 3. Columns. NO CASCADE — see the warning above. If a drop fails because
-- --    something still depends on a column, STOP and find out what; do not
-- --    force it.
-- alter table public.card_extras
--   drop column if exists artist_id_override,
--   drop column if exists attribution_override_evidence,
--   drop column if exists attribution_override_approved_by,
--   drop column if exists attribution_override_approved_at;
--
-- -- 4. Re-state the CAT-3B column ACL, now that artist_id_override is gone.
-- --    This RE-NARROWS to CAT-3B's three columns; it does not widen anything.
-- --    Safe only because step 3 has already removed the provenance columns.
-- grant select (card_id, illustrator_override, image_url_override)
--   on public.card_extras to anon, authenticated;
--
-- comment on table public.card_extras is
--   'Manual enrichment overrides for the effective catalog: illustrator_override and CAT-3B image_url_override. Never written by sync-cards.mjs. Column-level SELECT only for anon/authenticated (card_id, illustrator_override, image_url_override) — the image provenance columns are NOT publicly readable.';
--
-- commit;


-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT ROLLBACK DOES NOT DO
-- ═══════════════════════════════════════════════════════════════════════════
--
--   * It does not write public.cards. Raw provider attribution was never
--     touched, so there is nothing to restore there.
--   * It does not write public.artists or artist aliases.
--   * It does not resume or trigger catalog sync.
--   * It does not alter RLS or any policy.
--   * It does not touch CAT-3B's image override channel, its admission
--     trigger, or the updated_at trigger.
-- ═══════════════════════════════════════════════════════════════════════════
