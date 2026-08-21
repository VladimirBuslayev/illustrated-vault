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
--   carries an override is carrying EXACTLY the bundle ATTR-1 wrote — every
--   load-bearing attribution/provenance field, not a subset: derivation,
--   verified/verified_illustrator/evidence_gate/primary_source/
--   secondary_source/evidence_artifact/evidence_artifact_sha256/design_doc
--   inside the evidence payload, `approved_by`, `illustrator_override`, and
--   `artist_id_override` still NULL. If a target's bundle has since been
--   edited or replaced by a subsequent, separately-approved correction, this
--   file STOPS rather than silently discarding that later decision (Guard A).
--
--   It then verifies raw public.cards for all 12 targets still matches the
--   canonical pre-ATTR-1 reading this rollback is about to restore — ATTR-1
--   never wrote raw, so a drifted raw reading (e.g. a resumed catalog sync)
--   would mean clearing the override no longer reproduces the original
--   state, and this file STOPS rather than promising a restoration it can no
--   longer prove (Guard B).
--
-- WHAT ROLLBACK RESTORES.
--   Effective illustrator and artist_id for all 12 targets revert to their
--   pre-ATTR-1 (defective) reading — including xyp-XY67a returning to
--   curated artist 'sui' (sui effective membership 223 -> 224). This is the
--   correct and expected consequence of withdrawing the correction, not a
--   defect in the rollback. All 12 effective (illustrator, artist_id) tuples
--   are mechanically postflight-checked against the canonical pre-ATTR-1
--   state before COMMIT, not xyp-XY67a alone.
--
-- Kept deliberately SEPARATE from
-- docs/sql/attr-1-confirmed-attribution-repairs.sql so it cannot be pasted
-- into a deployment window by accident.
-- ═══════════════════════════════════════════════════════════════════════════

begin;


-- ── Canonical target population — duplicated verbatim from the migration ────
--
-- docs/sql/attr-1-confirmed-attribution-repairs.sql §0's attr1_targets is the
-- design authority for these values; this file is kept deliberately separate
-- from that one (see header) so this table is transcribed here rather than
-- shared. pre_illustrator/pre_artist_id/verified_illustrator/evidence_gate/
-- primary_source/secondary_source/evidence_artifact/evidence_artifact_sha256
-- are copied byte-for-byte from the migration's canonical table.

create temporary table attr1_rollback_targets (
  card_id                    text primary key,
  pre_illustrator            text not null,
  pre_artist_id              text,
  verified_illustrator       text not null,
  evidence_gate              text not null,
  primary_source             text not null,
  secondary_source           text,
  evidence_artifact          text not null,
  evidence_artifact_sha256   text
) on commit drop;

insert into attr1_rollback_targets
  (card_id, pre_illustrator, pre_artist_id, verified_illustrator, evidence_gate,
   primary_source, secondary_source, evidence_artifact, evidence_artifact_sha256)
values
  ('g1-28a', 'Naoki Saito', null, 'Ryo Ueda', 'ATTR-0 Gate 2',
   'https://bulbapedia.bulbagarden.net/wiki/Jolteon-EX_(Generations_28)',
   'https://pkmncards.com/card/jolteon-ex-generations-gen-28a/',
   'docs/attr-0-evidence/gate2-print-verification.csv',
   'b5e6e2dec95f75a2dcd069bec94e2ca8beaf38de6d74aba7659b684489c6c0f3'),

  ('g1-73a', 'Yusuke Ohmura', null, 'Naoki Saito', 'ATTR-0 Gate 2',
   'https://bulbapedia.bulbagarden.net/wiki/Team_Flare_Grunt_(XY_129)',
   'https://pkmncards.com/card/team-flare-grunt-generations-gen-73a/',
   'docs/attr-0-evidence/gate2-print-verification.csv',
   'b5e6e2dec95f75a2dcd069bec94e2ca8beaf38de6d74aba7659b684489c6c0f3'),

  ('xy10-111a', 'Ken Sugimori', null, 'Naoki Saito', 'ATTR-0 Gate 2',
   'https://bulbapedia.bulbagarden.net/wiki/Shauna_(XY_127)',
   'https://pkmncards.com/card/shauna-fates-collide-fco-111a/',
   'docs/attr-0-evidence/gate2-print-verification.csv',
   'b5e6e2dec95f75a2dcd069bec94e2ca8beaf38de6d74aba7659b684489c6c0f3'),

  ('xy10-43a', 'PLANETA', null, 'Ryo Ueda', 'ATTR-0 Gate 2',
   'https://bulbapedia.bulbagarden.net/wiki/Regirock-EX_(Fates_Collide_43)',
   'https://pkmncards.com/card/regirock-ex-fates-collide-fco-43a/',
   'docs/attr-0-evidence/gate2-print-verification.csv',
   'b5e6e2dec95f75a2dcd069bec94e2ca8beaf38de6d74aba7659b684489c6c0f3'),

  ('xy4-65a', 'Ayaka Yoshida', null, 'Ryo Ueda', 'ATTR-0 Gate 2',
   'https://bulbapedia.bulbagarden.net/wiki/Aegislash-EX_(Phantom_Forces_65)',
   'https://pkmncards.com/card/aegislash-ex-phantom-forces-phf-65a/',
   'docs/attr-0-evidence/gate2-print-verification.csv',
   'b5e6e2dec95f75a2dcd069bec94e2ca8beaf38de6d74aba7659b684489c6c0f3'),

  ('xy6-77a', 'Ayaka Yoshida', null, 'TOKIYA', 'ATTR-0 Gate 2',
   'https://bulbapedia.bulbagarden.net/wiki/Shaymin-EX_(Roaring_Skies_77)',
   'https://pkmncards.com/card/shaymin-ex-roaring-skies-ros-77a/',
   'docs/attr-0-evidence/gate2-print-verification.csv',
   'b5e6e2dec95f75a2dcd069bec94e2ca8beaf38de6d74aba7659b684489c6c0f3'),

  ('xy7-75a', 'Yusuke Ohmura', null, 'You Iribi', 'ATTR-0 Gate 2',
   'https://bulbapedia.bulbagarden.net/wiki/Hex_Maniac_(Ancient_Origins_75)',
   'https://pkmncards.com/card/hex-maniac-ancient-origins-aor-75a/',
   'docs/attr-0-evidence/gate2-print-verification.csv',
   'b5e6e2dec95f75a2dcd069bec94e2ca8beaf38de6d74aba7659b684489c6c0f3'),

  ('xy9-107a', 'Yusuke Ohmura', null, 'Naoki Saito', 'ATTR-0 Gate 2',
   'https://bulbapedia.bulbagarden.net/wiki/Professor_Sycamore_(XY_122)',
   'https://pkmncards.com/card/professor-sycamore-breakpoint-bkp-107a/',
   'docs/attr-0-evidence/gate2-print-verification.csv',
   'b5e6e2dec95f75a2dcd069bec94e2ca8beaf38de6d74aba7659b684489c6c0f3'),

  ('xy9-98b', 'Yusuke Ohmura', null, 'Sanosuke Sakuma', 'ATTR-0 Gate 2',
   'https://bulbapedia.bulbagarden.net/wiki/Delinquent_(BREAKpoint_98)',
   'https://pkmncards.com/card/delinquent-breakpoint-bkp-98b/',
   'docs/attr-0-evidence/gate2-print-verification.csv',
   'b5e6e2dec95f75a2dcd069bec94e2ca8beaf38de6d74aba7659b684489c6c0f3'),

  ('xyp-XY150a', 'Eske Yoshinob', null, 'Hasuno', 'ATTR-0 Gate 2',
   'https://bulbapedia.bulbagarden.net/wiki/Yveltal-EX_(XY_79)',
   'https://pkmncards.com/card/yveltal-ex-xy-promos-xyp-xy150a/',
   'docs/attr-0-evidence/gate2-print-verification.csv',
   'b5e6e2dec95f75a2dcd069bec94e2ca8beaf38de6d74aba7659b684489c6c0f3'),

  ('xyp-XY177a', 'You Iribi', null, 'Hitoshi Ariga', 'ATTR-0 Gate 2',
   'https://bulbapedia.bulbagarden.net/wiki/Karen_(XY_Promo_177)',
   'https://pkmncards.com/card/karen-xy-promos-xyp-xy177a/',
   'docs/attr-0-evidence/gate2-print-verification.csv',
   'b5e6e2dec95f75a2dcd069bec94e2ca8beaf38de6d74aba7659b684489c6c0f3'),

  ('xyp-XY67a', 'sui', 'sui', 'Naoki Saito', 'ATTR-0 §3',
   'https://bulbapedia.bulbagarden.net/wiki/Jirachi_(XY_Promo_67)',
   null,
   'docs/ATTR-0_ARTIST_ATTRIBUTION_INTEGRITY_AUDIT.md',
   null);

do $$
declare
  v_count int;
begin
  select count(*) into v_count from attr1_rollback_targets;
  if v_count <> 12 then
    raise exception
      'ATTR-1 rollback: the canonical target table holds % rows, expected '
      'exactly 12. STOP.', v_count;
  end if;
end $$;


-- ── Guard A — every PRESENT bundle matches the exact ATTR-1 payload ─────────
--
-- Not just derivation/approved_by/illustrator_override: every load-bearing
-- attribution/provenance field this migration wrote (artist_id_override NULL,
-- the full evidence bundle's gate/verified/verified_illustrator/
-- primary_source/secondary_source/evidence_artifact/evidence_artifact_sha256/
-- design_doc, and approved_by). A mismatch on ANY of them means something
-- else wrote or edited this row since ATTR-1 ran, and this rollback must not
-- guess whether that later state is safe to discard.

do $$
declare
  v_mismatched text[];
begin
  select coalesce(array_agg(ce.card_id order by ce.card_id), array[]::text[])
    into v_mismatched
  from public.card_extras ce
  join attr1_rollback_targets t on t.card_id = ce.card_id
  where ce.illustrator_override is not null
    and (
      ce.illustrator_override is distinct from t.verified_illustrator
      or ce.artist_id_override is not null
      or (ce.attribution_override_evidence ->> 'derivation')           is distinct from 'attr-1-confirmed-repair'
      or (ce.attribution_override_evidence ->> 'gate')                 is distinct from t.evidence_gate
      or (ce.attribution_override_evidence ->> 'verified')             is distinct from 'true'
      or (ce.attribution_override_evidence ->> 'verified_illustrator') is distinct from t.verified_illustrator
      or (ce.attribution_override_evidence ->> 'primary_source')       is distinct from t.primary_source
      or (ce.attribution_override_evidence ->> 'secondary_source')     is distinct from t.secondary_source
      or (ce.attribution_override_evidence ->> 'evidence_artifact')    is distinct from t.evidence_artifact
      or (ce.attribution_override_evidence ->> 'evidence_artifact_sha256') is distinct from t.evidence_artifact_sha256
      or (ce.attribution_override_evidence ->> 'design_doc')           is distinct from 'docs/ATTR-1_CONFIRMED_ATTRIBUTION_REPAIRS.md'
      or ce.attribution_override_approved_by is distinct from 'system:attr-1-migration'
    );

  if array_length(v_mismatched, 1) is not null then
    raise exception
      'ATTR-1 rollback FAILED: % target(s) no longer carry the exact ATTR-1 '
      'bundle this migration authored, on at least one load-bearing '
      'attribution/provenance field: %. Their attribution has been edited or '
      'replaced since — refusing to erase what may be a later, '
      'separately-approved correction. STOP and inspect manually.',
      array_length(v_mismatched, 1), v_mismatched;
  end if;

  raise notice 'ATTR-1 rollback: all present ATTR-1 bundles verified byte-exact against the migration''s payload. Proceeding.';
end $$;


-- ── Guard B — canonical RAW pre-ATTR-1 state has not drifted ────────────────
--
-- ATTR-1 never wrote public.cards, so the pre-ATTR-1 effective reading this
-- rollback claims to restore is exactly the raw reading captured at
-- authoring time. If raw provider attribution has since moved for any of the
-- 12 (e.g. a resumed catalog sync re-syncing a target), clearing the
-- override would NOT reproduce the original pre-ATTR-1 state — this file
-- must refuse to promise a restoration it can no longer prove, rather than
-- clear the override and silently claim success.

do $$
declare
  v_drift bigint;
  v_rows  text[];
begin
  select count(*), coalesce(array_agg(t.card_id order by t.card_id), array[]::text[])
    into v_drift, v_rows
  from attr1_rollback_targets t
  join public.cards c on c.id = t.card_id
  where c.illustrator is distinct from t.pre_illustrator
     or c.artist_id   is distinct from t.pre_artist_id;

  if v_drift <> 0 then
    raise exception
      'ATTR-1 rollback FAILED: % target(s)'' raw public.cards no longer match '
      'the canonical pre-ATTR-1 state this rollback claims to restore: %. '
      'Raw provider attribution has drifted since ATTR-1 ran — clearing the '
      'override would not reproduce the original reading. STOP and inspect '
      'manually rather than asserting a restoration that is no longer true.',
      v_drift, v_rows;
  end if;

  raise notice 'ATTR-1 rollback: raw public.cards for all 12 targets still matches the canonical pre-ATTR-1 state.';
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
  v_remaining     bigint;
  v_f15_active    boolean;
  v_mismatched_post text[];
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

  -- Prove the EFFECTIVE reversal for ALL 12 targets, not merely that
  -- storage-layer columns are NULL and not xyp-XY67a alone — the rollback
  -- claims all 12 effective (illustrator, artist_id) readings return to
  -- their pre-ATTR-1 state, so all 12 must be mechanically checked. This is
  -- only honestly assertable while F-15's channel is still live to read
  -- through (cards_effective discriminating on artist_id_override via its
  -- CASE) — if F-15 has itself been rolled back in the same window, this
  -- file cannot safely claim what any target's effective state "should"
  -- read, so it STOPs rather than silently reporting success on an unproven
  -- claim.
  select position('artist_id_override' in lower(pg_get_viewdef('public.cards_effective'::regclass, true))) > 0
     and position('case' in lower(pg_get_viewdef('public.cards_effective'::regclass, true))) > 0
    into v_f15_active;

  if not coalesce(v_f15_active, false) then
    raise exception
      'ATTR-1 rollback FAILED: cannot prove the 12 targets'' effective '
      'reversal — cards_effective no longer reads artist_id_override through '
      'the F-15 CASE, so the pre-ATTR-1 effective state is not safely '
      'assertable here. The five attribution fields ARE cleared (checked '
      'above), but this file refuses to claim the effective reversal is '
      'proven when it is not. STOP and verify all 12 targets'' effective '
      '(illustrator, artist_id) manually before treating this rollback as '
      'complete.';
  end if;

  select coalesce(array_agg(t.card_id order by t.card_id), array[]::text[])
    into v_mismatched_post
  from attr1_rollback_targets t
  join public.cards_effective ce on ce.id = t.card_id
  where ce.illustrator is distinct from t.pre_illustrator
     or ce.artist_id   is distinct from t.pre_artist_id;

  if array_length(v_mismatched_post, 1) is not null then
    raise exception
      'ATTR-1 rollback FAILED: % target(s) do not read back to their '
      'canonical pre-ATTR-1 effective (illustrator, artist_id) after '
      'clearing the override: %. Clearing the storage-layer override is not '
      'sufficient — the effective reversal must be proven for every target '
      'before COMMIT. ABORTING.',
      array_length(v_mismatched_post, 1), v_mismatched_post;
  end if;

  raise notice
    'ATTR-1 rollback: all 12 target bundles fully cleared (all five '
    'attribution fields) and all 12 effective (illustrator, artist_id) '
    'readings confirmed restored to their canonical pre-ATTR-1 state, '
    'including xyp-XY67a -> sui.';
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
