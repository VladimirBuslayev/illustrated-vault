-- ═══════════════════════════════════════════════════════════════════════════
-- ATTR-1 — CONFIRMED ATTRIBUTION REPAIRS: ROLLBACK
--
-- ⚠ DO NOT RUN THIS DURING DEPLOYMENT. Authored ahead of execution so a
--   reviewed, tested reversal exists before it is ever needed — not because
--   anything is expected to go wrong.
--
-- ⚠ THIS FILE HAS NOT BEEN EXECUTED.
--
-- SCOPE — the exact 12 ATTR-1 bundles, nothing else.
--   * Never rewrites public.cards. The correction lives entirely in
--     card_extras; there is nothing to un-rewrite in the raw table.
--   * Never touches public.artists or artist aliases.
--   * Never touches a card_extras row outside the 12 ATTR-1 targets,
--     including the five pre-existing F-15 legacy rows (design §6.1) —
--     those carry `derivation = 'f15-legacy-backfill'`, not
--     `'attr-1-confirmed-repair'`, so the provenance guard below excludes
--     them structurally, not by card_id list alone.
--   * Does not resume or trigger catalog sync. Does not alter RLS, ACL,
--     schema, the admission trigger, or cards_effective.
--
-- FAIL-CLOSED GUARD — do not erase a later human decision.
--   Before touching anything, this file verifies every target that still
--   carries an override is carrying EXACTLY the bundle ATTR-1 wrote: the
--   provenance `derivation` is `attr-1-confirmed-repair`, `approved_by` is
--   the literal `system:attr-1-migration`, and `illustrator_override` still
--   equals the verified name ATTR-1 set. If a target's bundle has since been
--   edited or replaced by a subsequent, separately-approved correction, this
--   file STOPS rather than silently discarding that later decision.
--
-- WHAT ROLLBACK RESTORES.
--   Effective illustrator and artist_id for all 12 targets revert to their
--   pre-ATTR-1 (defective) reading — including xyp-XY67a returning to
--   curated artist 'sui' (sui effective membership 223 -> 224). This is the
--   correct and expected consequence of withdrawing the correction, not a
--   defect in the rollback.
--
-- Kept deliberately SEPARATE from
-- docs/sql/attr-1-confirmed-attribution-repairs.sql so it cannot be pasted
-- into a deployment window by accident.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

do $$
declare
  v_expected jsonb := jsonb_build_object(
    'g1-28a',      'Ryo Ueda',
    'g1-73a',      'Naoki Saito',
    'xy10-111a',   'Naoki Saito',
    'xy10-43a',    'Ryo Ueda',
    'xy4-65a',     'Ryo Ueda',
    'xy6-77a',     'TOKIYA',
    'xy7-75a',     'You Iribi',
    'xy9-107a',    'Naoki Saito',
    'xy9-98b',     'Sanosuke Sakuma',
    'xyp-XY150a',  'Hasuno',
    'xyp-XY177a',  'Hitoshi Ariga',
    'xyp-XY67a',   'Naoki Saito'
  );
  v_mismatched text[];
begin
  -- Any target that STILL carries an override must match the ATTR-1
  -- fingerprint exactly: derivation, approved_by, AND the verified name this
  -- migration set. A mismatch on any of the three means something else wrote
  -- or edited this row since ATTR-1 ran, and this rollback must not guess
  -- whether that later state is safe to discard.
  select coalesce(array_agg(ce.card_id order by ce.card_id), array[]::text[])
    into v_mismatched
  from public.card_extras ce
  where ce.card_id in (select jsonb_object_keys(v_expected))
    and ce.illustrator_override is not null
    and (
      (ce.attribution_override_evidence ->> 'derivation') is distinct from 'attr-1-confirmed-repair'
      or ce.attribution_override_approved_by is distinct from 'system:attr-1-migration'
      or ce.illustrator_override is distinct from (v_expected ->> ce.card_id)
    );

  if array_length(v_mismatched, 1) is not null then
    raise exception
      'ATTR-1 rollback FAILED: % target(s) no longer carry the exact ATTR-1 '
      'bundle this migration authored: %. Their attribution has been edited '
      'or replaced since — refusing to erase what may be a later, '
      'separately-approved correction. STOP and inspect manually.',
      array_length(v_mismatched, 1), v_mismatched;
  end if;

  raise notice 'ATTR-1 rollback: all present ATTR-1 bundles verified as untouched since authoring. Proceeding.';
end $$;


-- ── Clear the five attribution fields on exactly the 12 targets ────────────
--
-- Scoped by card_id AND by the same provenance fingerprint the guard above
-- just verified, so this statement can never touch a row the guard did not
-- already clear — even if the guard's exception is somehow bypassed by a
-- future edit to this file, the WHERE clause here is independently correct.

update public.card_extras
set
  illustrator_override              = null,
  artist_id_override                = null,
  attribution_override_evidence     = null,
  attribution_override_approved_by  = null,
  attribution_override_approved_at  = null
where card_id in (
  'g1-28a','g1-73a','xy10-111a','xy10-43a','xy4-65a','xy6-77a',
  'xy7-75a','xy9-107a','xy9-98b','xyp-XY150a','xyp-XY177a','xyp-XY67a'
)
and illustrator_override is not null
and (attribution_override_evidence ->> 'derivation') = 'attr-1-confirmed-repair'
and attribution_override_approved_by = 'system:attr-1-migration';


-- ── Delete a row only if it is now semantically empty ───────────────────────
--
-- "Empty" means every nullable column on the row is NULL — attribution (just
-- cleared above), the CAT-3B image-override bundle, and source_note.
-- created_at/updated_at are NOT NULL by table definition and never disqualify
-- a row from being empty. If ANY unrelated field carries data (a source_note,
-- a CAT-3B image override written before or after ATTR-1 ran), the row is
-- retained — deleting it would destroy that unrelated data, which this
-- rollback must never do.

delete from public.card_extras
where card_id in (
  'g1-28a','g1-73a','xy10-111a','xy10-43a','xy4-65a','xy6-77a',
  'xy7-75a','xy9-107a','xy9-98b','xyp-XY150a','xyp-XY177a','xyp-XY67a'
)
and illustrator_override             is null
and artist_id_override               is null
and attribution_override_evidence    is null
and attribution_override_approved_by is null
and attribution_override_approved_at is null
and source_note                      is null
and image_url_override               is null
and image_override_source_card_id    is null
and image_override_evidence          is null
and image_override_approved_by       is null
and image_override_approved_at       is null;


-- ── Confirm the reversal actually took effect before committing ────────────

do $$
declare
  v_remaining  bigint;
  v_f15_active boolean;
  v_xy67a_now  text;
begin
  -- All FIVE attribution fields, not illustrator_override alone — a row could
  -- in principle retain a stray artist_id_override or evidence/approval
  -- fragment even with illustrator_override cleared, and that would still be
  -- an incomplete reversal.
  select count(*) into v_remaining
  from public.card_extras
  where card_id in (
    'g1-28a','g1-73a','xy10-111a','xy10-43a','xy4-65a','xy6-77a',
    'xy7-75a','xy9-107a','xy9-98b','xyp-XY150a','xyp-XY177a','xyp-XY67a'
  )
  and (
    illustrator_override             is not null
    or artist_id_override            is not null
    or attribution_override_evidence is not null
    or attribution_override_approved_by is not null
    or attribution_override_approved_at is not null
  );

  if v_remaining <> 0 then
    raise exception
      'ATTR-1 rollback FAILED: % target(s) still carry a non-NULL attribution '
      'field after the clear/delete pass — all five ATTR-1 fields must be '
      'cleared, not illustrator_override alone. ABORTING.', v_remaining;
  end if;

  -- Prove the EFFECTIVE reversal, not merely that storage-layer columns are
  -- NULL. This is only honestly assertable while F-15's channel is still
  -- live to read through (cards_effective discriminating on
  -- artist_id_override via its CASE) — if F-15 has itself been rolled back
  -- in the same window, this file cannot safely claim what xyp-XY67a's
  -- membership "should" read, so it STOPs rather than silently reporting
  -- success on an unproven claim.
  select position('artist_id_override' in lower(pg_get_viewdef('public.cards_effective'::regclass, true))) > 0
     and position('case' in lower(pg_get_viewdef('public.cards_effective'::regclass, true))) > 0
    into v_f15_active;

  if not coalesce(v_f15_active, false) then
    raise exception
      'ATTR-1 rollback FAILED: cannot prove xyp-XY67a''s membership reversal '
      '— cards_effective no longer reads artist_id_override through the F-15 '
      'CASE, so the pre-ATTR-1 effective state is not safely assertable here. '
      'The five attribution fields ARE cleared (checked above), but this file '
      'refuses to claim the membership reversal is proven when it is not. '
      'STOP and verify xyp-XY67a''s effective artist_id manually before '
      'treating this rollback as complete.';
  end if;

  select artist_id into v_xy67a_now
  from public.cards_effective
  where id = 'xyp-XY67a';

  if v_xy67a_now is distinct from 'sui' then
    raise exception
      'ATTR-1 rollback FAILED: xyp-XY67a effective artist_id is % after '
      'rollback, expected sui (the pre-ATTR-1 state this rollback claims to '
      'restore). Clearing the storage-layer override is not sufficient — the '
      'effective reversal must be proven before COMMIT. ABORTING.',
      coalesce(v_xy67a_now, 'NULL');
  end if;

  raise notice
    'ATTR-1 rollback: all 12 target bundles fully cleared (all five '
    'attribution fields) and xyp-XY67a''s effective artist_id is confirmed '
    'restored to sui.';
end $$;

commit;


-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT ROLLBACK DOES NOT DO
-- ═══════════════════════════════════════════════════════════════════════════
--
--   * It does not write public.cards. Raw provider attribution was never
--     touched by ATTR-1, so there is nothing to restore there.
--   * It does not write public.artists or artist aliases.
--   * It does not resume or trigger catalog sync.
--   * It does not alter RLS, ACL, schema, the F-15 admission trigger, or
--     cards_effective.
--   * It does not touch the five pre-existing F-15 legacy rows, or any
--     card_extras row outside the 12 ATTR-1 targets.
--   * It does not erase a later, separately-approved correction — the
--     fail-closed guard above stops rather than guessing.
-- ═══════════════════════════════════════════════════════════════════════════
