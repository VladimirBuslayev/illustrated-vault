-- ═══════════════════════════════════════════════════════════════════════════
-- F-15 — DURABLE ARTIST ATTRIBUTION CORRECTION CHANNEL
--
-- ⚠ THIS FILE HAS NOT BEEN EXECUTED. Production execution is a SEPARATE,
--   EXPLICITLY-APPROVED GATE. Authoring it is not deploying it.
--
-- Design (authoritative, merged PR #25):
--   docs/F-15_DURABLE_ATTRIBUTION_CORRECTION_DESIGN.md
-- Read-only design audit:
--   docs/sql/f15-attribution-correction-design-audit.sql
-- Base: main @ 9f233de3405e1aba26358bc54a0b4156b9b09df8
--
-- WHAT THIS DOES
--   Creates the durable channel that lets a verified attribution correction
--   move BOTH the displayed illustrator AND the artist the card is filed
--   under, so the two can never diverge. It populates nothing beyond a
--   five-row, behaviour-preserving backfill of the pre-existing legacy
--   overrides.
--
-- WHAT THIS DOES NOT DO
--   * It does NOT repair the 12 ATTR-1 rows. Not one of them is a mutation
--     target here; §9 V-13 asserts that mechanically.
--   * It does NOT write public.cards, public.artists, or artist aliases.
--     §9 V-14 asserts raw attribution is byte-identical before and after.
--   * It does NOT resume or trigger catalog sync.
--   * It does NOT change RLS, or add any client write path.
--
-- THE HEADLINE INVARIANT
--   F-15 changes ZERO effective/rendered attribution values. §0 snapshots the
--   entire effective catalog; §9 V-1 diffs it row-for-row after the view
--   switch and ABORTS on any difference. Every visible change belongs to
--   ATTR-1, which is a separate slice.
--
-- HOW TO RUN
--   Execute the WHOLE FILE as ONE script. §0 through §9 are inside a single
--   BEGIN … COMMIT. Running it statement-by-statement in a console that
--   autocommits each one discards exactly the atomicity this depends on, and
--   the ordering guarantees below become meaningless.
--
--   Every gate raises an exception rather than printing a warning, so a failed
--   invariant ROLLS BACK the whole migration instead of relying on a human
--   noticing output.
--
-- RE-RUNNING
--   The DDL is idempotent, but §0 refuses to run against an ALREADY-MIGRATED
--   database (it asserts the live view does not yet reference
--   artist_id_override). That is deliberate: this migration is designed to run
--   exactly once. Because §0–§9 are atomic, a failed run applies nothing, so a
--   corrected re-run always starts from the clean pre-F-15 state.
--
-- ORDERING IS LOAD-BEARING (design §18) — in two independent ways:
--   §3 backfill MUST precede §5 provenance CHECKs, or C1 rejects the migration
--     against its own five legacy rows before they can be repaired.
--   §3 backfill MUST precede §7 view switch, or three existing artist
--     memberships vanish the moment the view is replaced.
--   No constraint is ever left in a NOT VALID state to paper over ordering.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠ MIGRATION TRANSACTION OPENS HERE — §0 through §9 commit as one unit.
-- ═══════════════════════════════════════════════════════════════════════════

begin;


-- ═══════════════════════════════════════════════════════════════════════════
-- §0. PREFLIGHT — fail closed on drift — and the pre-migration snapshots
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The design was measured against a specific production shape. If production
-- has moved, the reasoning that justified this migration no longer applies and
-- it must not proceed on assumption.

do $$
declare
  v_cols       text[];
  v_expected   text[] := array[
    'id','name','set_id','set_name','local_id','illustrator','image_url',
    'rarity','release_date','pricing','pricing_updated_at','pricing_source',
    'last_synced_at','artist_id'
  ];
  v_def        text;
  v_reloptions text[];
begin
  -- P-1  card_extras must exist and already carry illustrator_override.
  if to_regclass('public.card_extras') is null then
    raise exception 'F-15 preflight: public.card_extras does not exist.';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'card_extras'
      and column_name = 'illustrator_override'
  ) then
    raise exception
      'F-15 preflight: card_extras.illustrator_override is missing — this '
      'migration extends that column''s semantics and cannot run without it.';
  end if;

  -- P-2  cards_effective must be the expected pre-F-15 view.
  select pg_get_viewdef('public.cards_effective'::regclass, true) into v_def;

  select array_agg(attname order by attnum) into v_cols
  from pg_attribute
  where attrelid = 'public.cards_effective'::regclass
    and attnum > 0 and not attisdropped;

  if v_cols is distinct from v_expected then
    raise exception
      'F-15 preflight: cards_effective column list drifted. expected=% actual=%',
      v_expected, v_cols;
  end if;

  -- P-3  security_invoker must already be set; this migration must not be the
  --      thing that silently turns it on or off.
  select reloptions into v_reloptions
  from pg_class where oid = 'public.cards_effective'::regclass;

  if v_reloptions is null
     or not exists (select 1 from unnest(v_reloptions) o where o = 'security_invoker=true')
  then
    raise exception
      'F-15 preflight: cards_effective is not security_invoker=true (reloptions=%).',
      v_reloptions;
  end if;

  -- P-4  The CAT-2D.1 alias exclusion and the two existing COALESCE overrides
  --      must be present, so §7 cannot silently revert CAT-2D.1 or CAT-3B.
  if position('card_identity_resolution' in v_def) = 0 then
    raise exception
      'F-15 preflight: cards_effective is missing the CAT-2D.1 alias exclusion.';
  end if;
  if position('illustrator_override' in lower(v_def)) = 0 then
    raise exception
      'F-15 preflight: cards_effective is missing the illustrator override.';
  end if;
  if position('image_url_override' in lower(v_def)) = 0 then
    raise exception
      'F-15 preflight: cards_effective is missing the CAT-3B image override.';
  end if;

  -- P-5  Refuse to run against an already-migrated database.
  if position('artist_id_override' in lower(v_def)) > 0 then
    raise exception
      'F-15 preflight: cards_effective already references artist_id_override — '
      'F-15 appears to be deployed. This migration is designed to run once. '
      'Do not re-run it; inspect the live state instead.';
  end if;

  -- P-6  The 12 ATTR-1 targets must not already carry a correction. If any
  --      does, something outside this slice touched them and the operator must
  --      look before proceeding.
  if exists (
    select 1 from public.card_extras
    where illustrator_override is not null
      and card_id in ('g1-28a','g1-73a','xy10-111a','xy10-43a','xy4-65a',
                      'xy6-77a','xy7-75a','xy9-107a','xy9-98b','xyp-XY150a',
                      'xyp-XY177a','xyp-XY67a')
  ) then
    raise exception
      'F-15 preflight: an ATTR-1 target already has an illustrator_override. '
      'ATTR-1 is a separate, separately-approved slice — STOP and investigate.';
  end if;

  raise notice 'F-15 §0 preflight: PASS.';
end $$;


-- ── Pre-migration snapshots ──────────────────────────────────────────────────
--
-- Taken BEFORE any F-15 object exists, so they capture genuine pre-F-15
-- behaviour. ON COMMIT DROP means they vanish automatically when the
-- transaction ends, in either direction — nothing is left behind to clean up.
--
-- The effective-catalog row count is deliberately NOT asserted against a
-- hardcoded 23,588. The catalog can legitimately move between design and
-- execution; what must not move is the effective attribution contract, and
-- that is proved by comparing this snapshot against post-migration state.

create temporary table f15_pre_effective on commit drop as
select id, illustrator, artist_id
from public.cards_effective;

create temporary table f15_pre_raw_cards on commit drop as
select id, illustrator, artist_id
from public.cards;

do $$
declare
  v_eff bigint;
  v_raw bigint;
begin
  select count(*) into v_eff from f15_pre_effective;
  select count(*) into v_raw from f15_pre_raw_cards;
  if v_eff = 0 or v_raw = 0 then
    raise exception
      'F-15 §0: snapshot is empty (effective=%, raw=%) — refusing to proceed, '
      'because an empty baseline would make the V-1/V-14 diffs vacuously pass.',
      v_eff, v_raw;
  end if;
  raise notice 'F-15 §0 snapshot: % effective rows, % raw rows.', v_eff, v_raw;
end $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- §1. card_extras — the four F-15 columns and the C4 FK
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠ NO PROVENANCE CHECKS IN THIS STEP. C1–C3 are added in §5, AFTER the §3
--   backfill. C1 is unconditional (design §12.2): provenance must be present
--   whenever illustrator_override is present. The five legacy rows already
--   carry illustrator_override with NO provenance right now, and ADD CONSTRAINT
--   validates existing rows immediately, so adding C1 here would fail the
--   migration on its own first step — before the backfill that is supposed to
--   satisfy it ever runs. The fix is ORDERING, not a NOT VALID deferral.
--
-- artist_id_override carries an FK to artists(id) with ON DELETE RESTRICT,
-- deliberately NOT the CASCADE used by card_extras.card_id — the same reasoning
-- CAT-3B applied to image_override_source_card_id. An override's artist
-- reference is the record of a deliberate human decision. Cascading a delete
-- would silently convert a VERIFIED association into an intentional NULL, an
-- indistinguishable and unexplained state change. RESTRICT forces the collision
-- to surface as an error somebody has to resolve.
--
-- ⚠ NULL IN artist_id_override IS MEANINGFUL. It is not "no override" — it is
--   "this card deliberately has NO artist association". §7's CASE is what makes
--   that expressible; see the note there.

alter table public.card_extras
  add column if not exists artist_id_override                text,
  add column if not exists attribution_override_evidence     jsonb,
  add column if not exists attribution_override_approved_by  text,
  add column if not exists attribution_override_approved_at  timestamptz;

-- FK added separately so the statement is re-runnable and the constraint is
-- named explicitly rather than auto-generated. Existence is matched on conname
-- AND conrelid: conname is unique per table, not per schema, so a guard testing
-- the name alone could silently skip creating the constraint because some other
-- relation happened to carry that name.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'card_extras_artist_id_override_fk'
      and conrelid = 'public.card_extras'::regclass
  ) then
    alter table public.card_extras
      add constraint card_extras_artist_id_override_fk
      foreign key (artist_id_override)
      references public.artists(id)
      on delete restrict;
  end if;
end $$;

comment on column public.card_extras.artist_id_override is
  'F-15. Durable artist association for a corrected card. NULL is MEANINGFUL — it means "deliberately no artist", not "no override"; cards_effective discriminates on illustrator_override, not on this column. Governs the effective artist_id whenever illustrator_override is set. Admitted only when it matches the aliases-only resolution of illustrator_override (see card_extras_admit_attribution_override). Never written by sync-cards.mjs.';
comment on column public.card_extras.attribution_override_evidence is
  'F-15. Structured provenance for the attribution decision. Required whenever illustrator_override is set. Read .derivation and .verified to tell an externally-verified correction from the f15-legacy-backfill derivation.';
comment on column public.card_extras.attribution_override_approved_by is
  'F-15. Who approved this attribution correction. Required whenever illustrator_override is set. The five legacy backfilled rows carry the literal system:f15-migration.';
comment on column public.card_extras.attribution_override_approved_at is
  'F-15. When this attribution correction was approved. Required whenever illustrator_override is set. Never backdated.';


-- ═══════════════════════════════════════════════════════════════════════════
-- §2. B-2 — THE EMBEDDED FAIL-CLOSED MIGRATION GATE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠ THIS GATE IS PART OF THE MIGRATION, NOT A COMMENT TELLING THE OPERATOR TO
--   GO RUN SOMETHING ELSE. It re-measures production at execution time and
--   ABORTS if the world has moved since the design was written.
--
-- THE RESOLVER IS ALIASES-ONLY, and that is load-bearing (design §12).
--   sync/sync-cards.mjs :: loadArtistAliasMap() (:217-227) builds its lookup
--   map EXCLUSIVELY from artists.aliases; resolveArtistId() (:229-232) consults
--   only that map and never reads artists.id. Admission must not use a broader
--   matching contract than sync uses, or the two can disagree about what a name
--   means. So: exact match of lower(btrim(illustrator_override)) against
--   lower(btrim(alias)) for alias in artists.aliases. Never artists.id, never
--   fuzzy, never substring.
--
-- AMBIGUITY IS COUNTED IN ARTIST ROWS, NOT ALIAS TOKENS.
--   `count(*) from artists a where exists (… unnest(a.aliases) …)` counts
--   MATCHING ARTIST ROWS. Production currently holds 11 duplicate aliases
--   WITHIN single artist rows (harmless case variants); counting alias tokens
--   would report those as ambiguity and fail the gate for no reason. What
--   matters is whether two DIFFERENT artists claim the same normalised name.
--
--   No LIMIT 1 is used to paper over ambiguity anywhere in this migration.

do $$
declare
  v_rows      bigint;
  v_change    bigint;
  v_ambiguous bigint;
begin
  with r as (
    select
      ce.card_id,
      c.artist_id as raw_artist_id,
      (select count(*) from public.artists a
        where exists (
          select 1 from unnest(coalesce(a.aliases, array[]::text[])) al
          where lower(btrim(al)) = lower(btrim(ce.illustrator_override))
        )) as match_count,
      (select a.id from public.artists a
        where exists (
          select 1 from unnest(coalesce(a.aliases, array[]::text[])) al
          where lower(btrim(al)) = lower(btrim(ce.illustrator_override))
        )) as resolved
    from public.card_extras ce
    join public.cards c on c.id = ce.card_id
    where ce.illustrator_override is not null
  )
  select
    count(*),
    count(*) filter (where resolved is distinct from raw_artist_id),
    count(*) filter (where match_count > 1)
  into v_rows, v_change, v_ambiguous
  from r;

  -- Expected at design time and re-confirmed against production 2026-08-20
  -- under the corrected aliases-only resolver: 5 / 0 / 0.
  if v_rows <> 5 then
    raise exception
      'F-15 §2 B-2 gate FAILED: expected exactly 5 pre-existing '
      'illustrator_override rows, found %. The legacy population changed since '
      'the design was measured — STOP and re-derive.', v_rows;
  end if;

  if v_change <> 0 then
    raise exception
      'F-15 §2 B-2 gate FAILED: % row(s) would change artist membership. The '
      'backfill is only safe because the aliases-only resolver already agrees '
      'with today''s raw artist_id on every legacy row. Each disagreeing row '
      'needs an explicit evidence-backed decision — HOLD.', v_change;
  end if;

  if v_ambiguous <> 0 then
    raise exception
      'F-15 §2 B-2 gate FAILED: % row(s) resolve to more than one artist. '
      'Admission rule R4 fails closed rather than choosing — HOLD.', v_ambiguous;
  end if;

  raise notice
    'F-15 §2 B-2 gate: PASS (override_rows=%, would_change_membership=%, ambiguous_rows=%).',
    v_rows, v_change, v_ambiguous;
end $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- §3. LEGACY BACKFILL — five rows, behaviour-preserving, fully provenanced
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHY THIS EXISTS. Three of the five legacy rows hold a live artist_id
-- (shinji-kanda, asako-ito, akira-egawa). §7's CASE takes the override branch
-- for every row with an illustrator_override. Without this backfill, that
-- branch would read NULL and those three memberships would silently vanish —
-- an I-7 regression delivered by a migration that looks purely additive.
--
-- WHY IT IS SAFE. §2 has just proved, against live data, that the resolver's
-- answer already equals today's raw artist_id on all five rows. So this write
-- changes nothing observable: two rows keep NULL, three keep their artist.
--
-- THE SCALAR SUBQUERY IS DELIBERATELY UNBOUNDED. It has no LIMIT 1. If it ever
-- matched more than one artist, PostgreSQL raises "more than one row returned
-- by a subquery" and the migration aborts — which is the correct fail-closed
-- outcome, and strictly better than silently picking one. §2 has already ruled
-- this out; the absence of LIMIT 1 keeps it ruled out.
--
-- PROVENANCE IS WRITTEN TO ALL FIVE ROWS, INCLUDING THE TWO THAT RESOLVE TO
-- NULL. C1 (§5) keys on illustrator_override, which is non-NULL on all five, so
-- all five are in State B and all five need the full bundle. There is NO C1
-- exemption for legacy rows — a declarative CHECK cannot see how a value
-- arrived, so it must not depend on that (design §6.4).
--
-- THE EVIDENCE IS HONEST. It says plainly that artist_id_override was DERIVED
-- from the pre-existing illustrator_override to preserve behaviour, and sets
-- "verified": false. It does NOT claim these five rows were externally
-- artist-verified, because they were not. approved_by is the literal
-- 'system:f15-migration' — non-empty (C2), and self-evidently not a human
-- reviewer. approved_at is now(), the transaction timestamp: real, consistent
-- across all five rows, and never backdated.

update public.card_extras ce
set
  artist_id_override =
    (select a.id from public.artists a
      where exists (
        select 1 from unnest(coalesce(a.aliases, array[]::text[])) al
        where lower(btrim(al)) = lower(btrim(ce.illustrator_override))
      )),
  attribution_override_evidence = jsonb_build_object(
    'derivation', 'f15-legacy-backfill',
    'basis',      'artist_id_override computed from the pre-existing illustrator_override '
                  'via the aliases-only resolver (design §12) to preserve pre-F-15 '
                  'effective behaviour. This row was NOT externally artist-verified.',
    'verified',   false,
    'design_pr',  25,
    'design_merge_commit', '9f233de3405e1aba26358bc54a0b4156b9b09df8'
  ),
  attribution_override_approved_by = 'system:f15-migration',
  attribution_override_approved_at = now()
where ce.illustrator_override is not null;


-- ═══════════════════════════════════════════════════════════════════════════
-- §4. VERIFY THE BACKFILL — before any constraint or view depends on it
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare
  v_total     bigint;
  v_mismatch  bigint;
  v_noprov    bigint;
begin
  with r as (
    select
      ce.card_id,
      ce.artist_id_override,
      c.artist_id as raw_artist_id,
      (select a.id from public.artists a
        where exists (
          select 1 from unnest(coalesce(a.aliases, array[]::text[])) al
          where lower(btrim(al)) = lower(btrim(ce.illustrator_override))
        )) as resolved,
      ce.attribution_override_evidence,
      ce.attribution_override_approved_by,
      ce.attribution_override_approved_at
    from public.card_extras ce
    join public.cards c on c.id = ce.card_id
    where ce.illustrator_override is not null
  )
  select
    count(*),
    -- IS DISTINCT FROM, not <>: two of the five legitimately resolve to NULL,
    -- and plain inequality would treat NULL = NULL as a mismatch.
    count(*) filter (where artist_id_override is distinct from resolved),
    count(*) filter (where attribution_override_evidence    is null
                        or attribution_override_approved_by is null
                        or attribution_override_approved_at is null)
  into v_total, v_mismatch, v_noprov
  from r;

  if v_total <> 5 then
    raise exception 'F-15 §4: expected 5 backfilled rows, found %.', v_total;
  end if;
  if v_mismatch <> 0 then
    raise exception
      'F-15 §4: % row(s) have artist_id_override that does not equal the '
      'aliases-only resolver result.', v_mismatch;
  end if;
  if v_noprov <> 0 then
    raise exception
      'F-15 §4: % row(s) carry illustrator_override without a complete '
      'provenance bundle — C1 in §5 would reject them.', v_noprov;
  end if;

  raise notice 'F-15 §4 backfill verified: 5 rows, resolver-consistent, fully provenanced.';
end $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- §5. C1–C3 — the declarative invariants, added AFTER the backfill
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Every constraint below validates existing rows immediately, on its first
-- attempt, with NO `not valid` window — because §3 already put every row in a
-- conforming state. That is the whole reason §3 precedes §5.

do $$
begin
  -- ── C1 — the four-field bundle has exactly TWO legal states ───────────────
  --
  -- ⚠ THIS IS A TWO-STATE INVARIANT, NOT "provenance is optional".
  --
  --   State A — no attribution override: illustrator_override IS NULL and all
  --             three provenance fields are NULL.
  --   State B — attribution override:    all four are NOT NULL.
  --
  --   EVERY mixed combination is rejected. In particular
  --   `illustrator_override IS NOT NULL` with any provenance field NULL is
  --   State B VIOLATED — not a permissible State A. An earlier draft phrased
  --   this as "either all four present, or all three provenance fields absent",
  --   which left that combination unaddressed and admitted exactly the
  --   no-provenance override C1 exists to block. Do not weaken this back.
  --
  --   An override without provenance is worse than no override: it silently
  --   re-files a card under a different artist and nobody can trace why.
  if not exists (
    select 1 from pg_constraint
     where conname = 'card_extras_attribution_override_all_or_nothing'
       and conrelid = 'public.card_extras'::regclass
  ) then
    alter table public.card_extras
      add constraint card_extras_attribution_override_all_or_nothing check (
        (    illustrator_override             is null
         and attribution_override_evidence    is null
         and attribution_override_approved_by is null
         and attribution_override_approved_at is null)
        or
        (    illustrator_override             is not null
         and attribution_override_evidence    is not null
         and attribution_override_approved_by is not null
         and attribution_override_approved_at is not null)
      );
  end if;

  -- ── C2 — provenance that is present must be meaningful ────────────────────
  if not exists (
    select 1 from pg_constraint
     where conname = 'card_extras_attribution_override_approved_by_nonempty'
       and conrelid = 'public.card_extras'::regclass
  ) then
    alter table public.card_extras
      add constraint card_extras_attribution_override_approved_by_nonempty check (
        attribution_override_approved_by is null
        or length(btrim(attribution_override_approved_by)) > 0
      );
  end if;

  -- ── C3 — no bare artist_id_override (admission rule R5) ───────────────────
  --
  -- An artist_id_override without an illustrator_override has no provenance and
  -- no display counterpart, and §7's CASE would never even read it — the row
  -- would carry a correction that is structurally invisible. Together with C1,
  -- C3 also makes withdrawal atomic: clearing illustrator_override forces
  -- artist_id_override and all three provenance fields to be cleared in the
  -- SAME statement. There is no partial-removal state to fall into.
  if not exists (
    select 1 from pg_constraint
     where conname = 'card_extras_attribution_override_requires_illustrator'
       and conrelid = 'public.card_extras'::regclass
  ) then
    alter table public.card_extras
      add constraint card_extras_attribution_override_requires_illustrator check (
        artist_id_override is null
        or illustrator_override is not null
      );
  end if;
end $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- §6. ADMISSION TRIGGER — the resolver wall
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠ ADMISSION-TIME SEMANTICS. DELIBERATE, NOT A GAP.
--   The alias resolution is checked WHEN THE CORRECTION IS WRITTEN, and never
--   again. A correction records a human decision taken against external
--   evidence at a known moment. Re-deriving it on read — or on every unrelated
--   write — would make a reviewed correction a live function of the alias
--   table, so a later alias edit could silently re-point or invalidate it.
--   The cost is that a correction can go STALE relative to an artist row
--   created later; design §15 answers that with detection (validation file
--   E-1), not with coupling.
--
-- ⚠ NO SECURITY DEFINER. This runs with the privileges of whoever writes
--   card_extras (owner or service_role; anon/authenticated have no write policy
--   and cannot reach it). It reads only public.artists. Nothing here widens
--   anyone's access, and it is not a client-facing function.
--
-- ⚠ COEXISTS WITH CAT-3B, DOES NOT REPLACE IT.
--   card_extras_admit_image_override stays exactly as it is. PostgreSQL fires
--   BEFORE-row triggers in name order, so this one runs first; the two are
--   independent because each inspects only its own columns and each returns
--   early when its own bundle is unchanged.

create or replace function public.card_extras_admit_attribution_override()
returns trigger
language plpgsql
as $$
declare
  v_match_count bigint;
  v_resolved    text;
begin
  -- ── Unchanged attribution bundle on UPDATE: this write is about something
  --    else (source_note, an image override, anything). Do not re-admit. ─────
  -- IS NOT DISTINCT FROM so NULL = NULL compares equal; a plain `=` would treat
  -- two NULL bundles as "changed" and re-admit on every unrelated edit.
  if tg_op = 'UPDATE'
     and new.illustrator_override             is not distinct from old.illustrator_override
     and new.artist_id_override               is not distinct from old.artist_id_override
     and new.attribution_override_evidence    is not distinct from old.attribution_override_evidence
     and new.attribution_override_approved_by is not distinct from old.attribution_override_approved_by
     and new.attribution_override_approved_at is not distinct from old.attribution_override_approved_at
  then
    return new;
  end if;

  -- ── No attribution override present. ──────────────────────────────────────
  -- Covers an INSERT with no attribution bundle, and CLEARING a complete bundle
  -- back to NULL — which is explicitly permitted. Withdrawing a correction is a
  -- legitimate act and must not require the artist to still resolve.
  if new.illustrator_override is null then
    -- R5, restated here so the error names the actual problem. C3 also blocks
    -- this declaratively; the trigger just says which field is wrong.
    if new.artist_id_override is not null then
      raise exception
        'card_extras: attribution override for % rejected — artist_id_override '
        'is set without an illustrator_override. A bare artist association has '
        'no provenance and no display counterpart.',
        new.card_id
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- ── Everything below is a REAL admission: an INSERT carrying a correction,
  --    or a material change to any attribution field on UPDATE. ─────────────

  -- R1 — provenance completeness.
  -- C1 also enforces this. Repeated here as the second wall, and because a
  -- trigger can say WHICH field is missing where a CHECK cannot.
  if new.attribution_override_evidence    is null
     or new.attribution_override_approved_by is null
     or new.attribution_override_approved_at is null then
    raise exception
      'card_extras: attribution override for % rejected — provenance '
      'incomplete. illustrator_override requires attribution_override_evidence, '
      '_approved_by and _approved_at.',
      new.card_id
      using errcode = 'check_violation';
  end if;

  -- ── Resolve the corrected illustrator. ALIASES ONLY. ──────────────────────
  -- Byte-for-byte the contract sync/sync-cards.mjs :: resolveArtistId() uses:
  -- exact match of the normalised string against artists.aliases, never
  -- artists.id, never fuzzy, never substring. Admission and sync therefore
  -- share one definition and cannot disagree about what a name means.
  --
  -- Counted in ARTIST ROWS, not alias tokens, so duplicate aliases within a
  -- single artist row cannot manufacture false ambiguity.
  select count(*) into v_match_count
  from public.artists a
  where exists (
    select 1 from unnest(coalesce(a.aliases, array[]::text[])) al
    where lower(btrim(al)) = lower(btrim(new.illustrator_override))
  );

  -- R4 — ambiguous: FAIL CLOSED. Never choose.
  -- artists.aliases has no uniqueness constraint, so this is reachable the
  -- moment two artists claim one normalised name. The difference between
  -- rejecting and picking the first is the difference between a visible failure
  -- and cards silently filed under the wrong artist.
  if v_match_count > 1 then
    raise exception
      'card_extras: attribution override for % rejected — "%" resolves to % '
      'artists. Admission fails closed on ambiguity rather than choosing one.',
      new.card_id, new.illustrator_override, v_match_count
      using errcode = 'check_violation';
  end if;

  -- R3 — zero matches: artist_id_override MUST be an intentional NULL.
  if v_match_count = 0 then
    if new.artist_id_override is not null then
      raise exception
        'card_extras: attribution override for % rejected — "%" matches no '
        'artist alias, so artist_id_override must be NULL, not %.',
        new.card_id, new.illustrator_override, new.artist_id_override
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- R2 — exactly one match: artist_id_override MUST be that artist.
  select a.id into v_resolved
  from public.artists a
  where exists (
    select 1 from unnest(coalesce(a.aliases, array[]::text[])) al
    where lower(btrim(al)) = lower(btrim(new.illustrator_override))
  );

  if new.artist_id_override is distinct from v_resolved then
    raise exception
      'card_extras: attribution override for % rejected — "%" resolves to '
      'artist %, but artist_id_override is %.',
      new.card_id, new.illustrator_override, v_resolved,
      coalesce(new.artist_id_override, 'NULL')
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.card_extras_admit_attribution_override() is
  'F-15. Write-time admission control for card_extras attribution corrections. Resolves illustrator_override against artists.aliases ONLY — the exact contract sync-cards.mjs resolveArtistId() uses — and requires artist_id_override to equal the single match, to be NULL when there is no match, and rejects outright when two or more artists match. Also rejects incomplete provenance and a bare artist_id_override. Returns early when an UPDATE leaves all five attribution fields IS NOT DISTINCT FROM OLD, so unrelated edits never re-admit. Clearing a complete bundle to NULL is permitted. Deliberately SECURITY INVOKER and deliberately not re-evaluated after admission.';

drop trigger if exists card_extras_admit_attribution_override on public.card_extras;
create trigger card_extras_admit_attribution_override
  before insert or update on public.card_extras
  for each row execute function public.card_extras_admit_attribution_override();


-- ═══════════════════════════════════════════════════════════════════════════
-- §7. public.cards_effective — one CASE, nothing else
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠ REBUILT FROM THE CURRENT LIVE DEFINITION (CAT-2D.1 alias exclusion +
--   CAT-3B image override), verified by §0 P-2/P-3/P-4 immediately above.
--   NOT from docs/sql/card_extras_and_view.sql, which is stale and would
--   silently revert both.
--
-- Preserved EXACTLY:
--   * with (security_invoker = true) — reads still execute with the caller's
--     permissions, so RLS on the base tables continues to govern. NOT relaxed.
--   * all 14 columns, in order, with artist_id last;
--   * the LEFT JOIN to card_extras;
--   * the CAT-2D.1 NOT EXISTS alias exclusion;
--   * both existing COALESCE overrides, unchanged.
--
-- The ONLY effective-value semantic change in this entire slice:
--
--     c.artist_id                                    -- before
--     case when ce.illustrator_override is not null  -- after
--            then ce.artist_id_override
--          else c.artist_id end
--
-- ⚠ CASE, NOT COALESCE — AND THIS IS THE POINT OF THE WHOLE SLICE.
--   coalesce(ce.artist_id_override, c.artist_id) cannot express "deliberately
--   no artist": a NULL override falls through to the raw value. On the twelve
--   ATTR-1 rows the correct target is NULL on 12 of 12, so COALESCE would
--   retain the KNOWN-WRONG raw artist_id on every one — for xyp-XY67a it would
--   leave the card filed under 'sui', which is precisely the defect F-15
--   exists to remove. Do not "simplify" this back to a COALESCE.
--
-- ⚠ THE DISCRIMINATOR IS illustrator_override, NOT artist_id_override.
--   The presence of an illustrator correction is what makes the raw FK
--   untrustworthy: raw artist_id was derived from a string we have now
--   overruled. Keying on artist_id_override instead would make NULL
--   unrepresentable again, because a NULL override would read as "no override".
--
-- With the §3 backfill already applied, this is a provable no-op: the override
-- branch returns exactly the raw artist_id for all five override rows, and
-- every other row takes the ELSE branch. §9 V-1 proves it row-for-row.
--
-- CREATE OR REPLACE (not DROP + CREATE) so the view's identity, dependencies
-- and existing grants are preserved. Column names, types and order are
-- unchanged, which is what makes REPLACE legal here.

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
    case
      when ce.illustrator_override is not null then ce.artist_id_override
      else c.artist_id
    end                                              as artist_id
  from public.cards c
  left join public.card_extras ce on c.id = ce.card_id
  where not exists (
    select 1
    from public.card_identity_resolution r
    where r.alias_card_id = c.id
  );

-- Grants restated so this migration is self-contained (CREATE OR REPLACE
-- preserves them; these match the CAT-2D.1 / CAT-3B state).
grant select on public.cards_effective to anon, authenticated, service_role;

comment on view public.cards_effective is
  'Canonical product-facing catalog. CAT-2D.1 alias exclusion + CAT-3B durable image override + F-15 durable attribution correction. illustrator, image_url and artist_id are the overridable values; all three come from public.card_extras. artist_id uses CASE (not COALESCE) so an intentional NULL artist association is representable. security_invoker = true.';


-- ═══════════════════════════════════════════════════════════════════════════
-- §8. ACL — extend the CAT-3B column list by exactly one column
-- ═══════════════════════════════════════════════════════════════════════════
--
-- CAT-3B replaced card_extras' blanket table grant with an explicit column
-- list. That narrowing must be PRESERVED, not undone.
--
-- WHY artist_id_override MUST BE GRANTED. cards_effective is
-- security_invoker = true, so its reads execute with the CALLER's privileges
-- against card_extras. §7's CASE now reads ce.artist_id_override, so anon and
-- authenticated need column SELECT on it or the view breaks for every public
-- visitor. It is not sensitive: its value is already published through
-- cards_effective.artist_id.
--
-- WHY THE PROVENANCE COLUMNS MUST NOT BE. A table-level grant covers every
-- column the table will EVER have — which is exactly how adding columns
-- silently publishes them. Granting the attribution provenance would tell every
-- anonymous visitor who approved each correction, when, and on what evidence.
--
-- ⚠ NOT SOLVED BY MAKING cards_effective DEFINER-RIGHTS. security_invoker
--   stays true. Owner rights would let the view read columns the caller cannot
--   — the "dodge the permissions question" move CAT-2D.1 §3 rejected. Column
--   grants are the honest mechanism.
--
-- REVOKE-then-GRANT, not GRANT alone: GRANT cannot remove a privilege an
-- earlier deployment already left in place. §9 V-12 then asserts the RESULTING
-- ACL is exactly the intended four columns, so this section is verified by
-- outcome rather than by assumption about revoke semantics.
--
-- service_role is deliberately untouched: it is the write identity for
-- enrichment and needs the provenance columns to author a correction at all.
-- This migration does not widen its privileges.

revoke all on table public.card_extras from anon, authenticated;

grant select (card_id, illustrator_override, image_url_override, artist_id_override)
  on public.card_extras to anon, authenticated;

comment on table public.card_extras is
  'Manual enrichment overrides for the effective catalog: illustrator_override, CAT-3B image_url_override, and F-15 artist_id_override. Never written by sync-cards.mjs. Column-level SELECT only for anon/authenticated (card_id, illustrator_override, image_url_override, artist_id_override) — the image and attribution provenance columns are NOT publicly readable.';


-- ═══════════════════════════════════════════════════════════════════════════
-- §9. IN-TRANSACTION VALIDATION — every check ABORTS rather than warns
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare
  v_diff       bigint;
  v_five       bigint;
  v_c1         bigint;
  v_c2         bigint;
  v_c3         bigint;
  v_ambig      bigint;
  v_cols       text[];
  v_expected   text[] := array[
    'id','name','set_id','set_name','local_id','illustrator','image_url',
    'rarity','release_date','pricing','pricing_updated_at','pricing_source',
    'last_synced_at','artist_id'
  ];
  v_def        text;
  v_reloptions text[];
  v_attr1      bigint;
  v_rawdiff    bigint;
  v_acl_anon   text[];
  v_acl_auth   text[];
  v_acl_expect text[] := array[
    'artist_id_override','card_id','illustrator_override','image_url_override'
  ];
  v_tablelevel bigint;
begin
  -- ── V-1 — THE HEADLINE INVARIANT ──────────────────────────────────────────
  -- Full pre/post diff of the effective attribution contract, in BOTH
  -- directions, over the whole catalog. Not a count comparison — a row-for-row
  -- symmetric difference, so an addition and a deletion cannot cancel out.
  select count(*) into v_diff
  from (
    (select id, illustrator, artist_id from f15_pre_effective
     except all
     select id, illustrator, artist_id from public.cards_effective)
    union all
    (select id, illustrator, artist_id from public.cards_effective
     except all
     select id, illustrator, artist_id from f15_pre_effective)
  ) d;

  if v_diff <> 0 then
    raise exception
      'F-15 V-1 FAILED: % effective row(s) differ from the pre-migration '
      'snapshot on (id, illustrator, artist_id). F-15 must change ZERO '
      'rendered attribution values — every visible change belongs to ATTR-1. '
      'ABORTING.', v_diff;
  end if;

  -- ── V-14 — raw provider attribution untouched (I-1) ───────────────────────
  select count(*) into v_rawdiff
  from (
    (select id, illustrator, artist_id from f15_pre_raw_cards
     except all
     select id, illustrator, artist_id from public.cards)
    union all
    (select id, illustrator, artist_id from public.cards
     except all
     select id, illustrator, artist_id from f15_pre_raw_cards)
  ) d;

  if v_rawdiff <> 0 then
    raise exception
      'F-15 V-14 FAILED: % raw public.cards row(s) changed illustrator or '
      'artist_id. This migration must never write raw provider history. '
      'ABORTING.', v_rawdiff;
  end if;

  -- ── V-2 / V-3 — the five legacy rows ──────────────────────────────────────
  select count(*) into v_five
  from public.card_extras ce
  join public.cards c on c.id = ce.card_id
  where ce.illustrator_override is not null
    and ce.attribution_override_evidence    is not null
    and ce.attribution_override_approved_by is not null
    and ce.attribution_override_approved_at is not null
    and ce.artist_id_override is not distinct from
        (select a.id from public.artists a
          where exists (
            select 1 from unnest(coalesce(a.aliases, array[]::text[])) al
            where lower(btrim(al)) = lower(btrim(ce.illustrator_override))
          ));

  if v_five <> 5 then
    raise exception
      'F-15 V-2 FAILED: expected 5 fully-backfilled, resolver-consistent legacy '
      'rows, found %.', v_five;
  end if;

  -- V-3 is implied by V-1 (which covers every row including these five), but
  -- asserted separately so a failure names the legacy rows specifically.
  if exists (
    select 1
    from f15_pre_effective p
    join public.cards_effective ce on ce.id = p.id
    join public.card_extras x on x.card_id = p.id
    where x.illustrator_override is not null
      and ce.artist_id is distinct from p.artist_id
  ) then
    raise exception
      'F-15 V-3 FAILED: a legacy override row''s effective artist_id changed.';
  end if;

  -- ── V-4 / V-5 / V-6 — the declarative invariants hold on live data ────────
  select count(*) into v_c1
  from public.card_extras
  where not (
    (    illustrator_override             is null
     and attribution_override_evidence    is null
     and attribution_override_approved_by is null
     and attribution_override_approved_at is null)
    or
    (    illustrator_override             is not null
     and attribution_override_evidence    is not null
     and attribution_override_approved_by is not null
     and attribution_override_approved_at is not null)
  );
  if v_c1 <> 0 then
    raise exception 'F-15 V-4 FAILED: % row(s) violate the C1 two-state bundle.', v_c1;
  end if;

  select count(*) into v_c2
  from public.card_extras
  where attribution_override_approved_by is not null
    and length(btrim(attribution_override_approved_by)) = 0;
  if v_c2 <> 0 then
    raise exception 'F-15 V-5 FAILED: % row(s) have a blank approved_by.', v_c2;
  end if;

  select count(*) into v_c3
  from public.card_extras
  where artist_id_override is not null and illustrator_override is null;
  if v_c3 <> 0 then
    raise exception 'F-15 V-6 FAILED: % bare artist_id_override row(s).', v_c3;
  end if;

  -- ── V-7 — no admitted override resolves ambiguously ───────────────────────
  select count(*) into v_ambig
  from public.card_extras ce
  where ce.illustrator_override is not null
    and (select count(*) from public.artists a
          where exists (
            select 1 from unnest(coalesce(a.aliases, array[]::text[])) al
            where lower(btrim(al)) = lower(btrim(ce.illustrator_override))
          )) > 1;
  if v_ambig <> 0 then
    raise exception 'F-15 V-7 FAILED: % admitted override(s) are ambiguous.', v_ambig;
  end if;

  -- ── V-8 / V-9 / V-10 / V-11 — the view shape survived ─────────────────────
  select array_agg(attname order by attnum) into v_cols
  from pg_attribute
  where attrelid = 'public.cards_effective'::regclass
    and attnum > 0 and not attisdropped;
  if v_cols is distinct from v_expected then
    raise exception
      'F-15 V-8 FAILED: cards_effective columns changed. expected=% actual=%',
      v_expected, v_cols;
  end if;

  select reloptions into v_reloptions
  from pg_class where oid = 'public.cards_effective'::regclass;
  if v_reloptions is null
     or not exists (select 1 from unnest(v_reloptions) o where o = 'security_invoker=true')
  then
    raise exception 'F-15 V-9 FAILED: cards_effective lost security_invoker=true.';
  end if;

  select pg_get_viewdef('public.cards_effective'::regclass, true) into v_def;
  if position('card_identity_resolution' in v_def) = 0 then
    raise exception 'F-15 V-10 FAILED: the CAT-2D.1 alias exclusion is gone.';
  end if;

  -- V-11 — everything unrelated is still there, and the one intended change is.
  if position('illustrator_override' in lower(v_def)) = 0
     or position('image_url_override' in lower(v_def)) = 0 then
    raise exception
      'F-15 V-11 FAILED: an unrelated override expression was lost — this '
      'migration must change ONLY the artist_id expression.';
  end if;
  if position('artist_id_override' in lower(v_def)) = 0
     or position('case' in lower(v_def)) = 0 then
    raise exception
      'F-15 V-11 FAILED: the artist_id CASE expression is not present.';
  end if;

  -- ── V-12 — the public column ACL is EXACTLY the four intended columns ─────
  -- Verified by outcome, so this does not depend on any assumption about how
  -- much REVOKE ... ON TABLE clears.
  select coalesce(array_agg(distinct a.attname order by a.attname), array[]::text[])
    into v_acl_anon
  from pg_attribute a
  cross join lateral aclexplode(a.attacl) x
  join pg_roles r on r.oid = x.grantee
  where a.attrelid = 'public.card_extras'::regclass
    and a.attnum > 0 and not a.attisdropped
    and r.rolname = 'anon' and x.privilege_type = 'SELECT';

  select coalesce(array_agg(distinct a.attname order by a.attname), array[]::text[])
    into v_acl_auth
  from pg_attribute a
  cross join lateral aclexplode(a.attacl) x
  join pg_roles r on r.oid = x.grantee
  where a.attrelid = 'public.card_extras'::regclass
    and a.attnum > 0 and not a.attisdropped
    and r.rolname = 'authenticated' and x.privilege_type = 'SELECT';

  if v_acl_anon is distinct from v_acl_expect then
    raise exception
      'F-15 V-12 FAILED: anon column SELECT on card_extras is % — expected %. '
      'Provenance columns must NOT be publicly readable.', v_acl_anon, v_acl_expect;
  end if;
  if v_acl_auth is distinct from v_acl_expect then
    raise exception
      'F-15 V-12 FAILED: authenticated column SELECT on card_extras is % — '
      'expected %.', v_acl_auth, v_acl_expect;
  end if;

  -- No table-level grant may have crept back for anon/authenticated — it would
  -- silently cover every current AND future column, including provenance.
  select count(*) into v_tablelevel
  from pg_class c
  cross join lateral aclexplode(c.relacl) x
  join pg_roles r on r.oid = x.grantee
  where c.oid = 'public.card_extras'::regclass
    and r.rolname in ('anon', 'authenticated');
  if v_tablelevel <> 0 then
    raise exception
      'F-15 V-12 FAILED: % table-level grant(s) exist for anon/authenticated on '
      'card_extras. The CAT-3B narrowing must be preserved.', v_tablelevel;
  end if;

  -- ── V-13 — ATTR-1 remains completely unrepaired ───────────────────────────
  select count(*) into v_attr1
  from public.card_extras
  where card_id in ('g1-28a','g1-73a','xy10-111a','xy10-43a','xy4-65a',
                    'xy6-77a','xy7-75a','xy9-107a','xy9-98b','xyp-XY150a',
                    'xyp-XY177a','xyp-XY67a')
    and (illustrator_override is not null or artist_id_override is not null);
  if v_attr1 <> 0 then
    raise exception
      'F-15 V-13 FAILED: % ATTR-1 target(s) carry a correction. F-15 creates '
      'the channel and repairs nothing. ABORTING.', v_attr1;
  end if;

  raise notice 'F-15 §9 validation: ALL PASS (V-1 … V-14). Committing.';
end $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠ MIGRATION TRANSACTION CLOSES HERE — §0 through §9 commit as one unit.
--   If anything above raised, NOTHING applied and the database is in the
--   complete pre-F-15 state. Both temporary snapshots drop automatically.
--
--   V-15 (catalog sync remains paused) is not assertable from SQL — the sync
--   schedule lives in the repository workflow, not the database. It is
--   verified out-of-band; see docs/F-15_IMPLEMENTATION.md.
--
--   Rollback is NOT in this file. It lives in
--   docs/sql/f15-durable-attribution-correction-rollback.sql — deliberately
--   separate so it cannot be pasted into a deployment window by accident.
-- ═══════════════════════════════════════════════════════════════════════════

commit;
