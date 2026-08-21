-- ═══════════════════════════════════════════════════════════════════════════
-- ATTR-1 — CONFIRMED ATTRIBUTION REPAIRS
--
-- ⚠ THIS FILE HAS NOT BEEN EXECUTED. Production execution is a SEPARATE,
--   EXPLICITLY-APPROVED GATE. Authoring it is not deploying it.
--
-- Design authority (do not rediscover or broaden the population):
--   docs/ATTR-1_CONFIRMED_ATTRIBUTION_REPAIRS.md
--   docs/ATTR-0_ARTIST_ATTRIBUTION_INTEGRITY_AUDIT.md            (xyp-XY67a, §3)
--   docs/ATTR-0_GATE2_PRINT_VERIFICATION.md                      (the 11 Gate-2 rows)
--   docs/attr-0-evidence/gate2-print-verification.csv            (per-row sources)
--   docs/attr-0-evidence/f15-repair-impact.csv                   (canonical pre-repair state)
--   docs/F-15_DURABLE_ATTRIBUTION_CORRECTION_DESIGN.md / docs/F-15_IMPLEMENTATION.md
-- Base: main @ c9adc414673c34a085e81d04bd367a4b0c46ffeb
--
-- WHAT THIS DOES
--   Writes exactly twelve card_extras attribution overrides through the
--   already-deployed F-15 channel: illustrator_override set to the externally
--   verified illustrator, artist_id_override NULL on all twelve (every target
--   resolves to zero artists through the aliases-only resolver), and a
--   complete, honest, per-row external provenance bundle citing the committed
--   ATTR-0 / Gate 2 evidence.
--
-- WHAT THIS DOES NOT DO
--   * It does not touch public.cards, public.artists, or artist aliases.
--   * It does not create, alter or drop any schema object, RLS policy, ACL
--     grant, view, or trigger. F-15's admission trigger is left to enforce
--     itself, unmodified and unbypassed.
--   * It does not perform xya dedup/alias work (F-16 remains separate).
--   * It does not resume or trigger catalog sync.
--
-- THE HEADLINE INVARIANTS
--   Exactly 12 rows change. Eleven have no FK membership consequence (their
--   effective artist_id is already NULL and stays NULL — only the displayed
--   illustrator moves). xyp-XY67a is the sole membership change: it leaves
--   curated artist 'sui', taking effective sui membership from 224 to 223.
--   Every other row in card_extras — attribution or otherwise — is asserted
--   byte-identical before and after (§9 V-9). Raw public.cards is asserted
--   byte-identical for all 12 targets (§9 V-7).
--
-- HOW TO RUN
--   Execute the WHOLE FILE as ONE script. §0 through §9 are inside a single
--   BEGIN … COMMIT. Running it statement-by-statement in a console that
--   autocommits each one discards exactly the atomicity this depends on.
--
--   Every gate raises an exception rather than printing a warning, so a failed
--   invariant ROLLS BACK the whole migration instead of relying on a human
--   noticing output.
--
-- RE-RUNNING
--   The preflight re-measures live production at execution time (§0) rather
--   than trusting the currency check recorded in the design doc or the issue
--   that requested this slice. If production has moved — a target's current
--   effective attribution drifted, one of the seven verified names now
--   resolves to an artist, or any target already carries an attribution
--   bundle — the migration STOPS rather than silently adapting the plan.
--
--   The INSERT … ON CONFLICT DO UPDATE SET shape is deliberately safe to
--   re-run: if some *unrelated* card_extras enrichment (a source_note, a CAT-3B
--   image override) appears on one of these 12 rows between authoring and
--   execution, the upsert still touches only the five attribution columns and
--   preserves everything else (§9 V-8 proves this).
--
--   P-4 proves no target carries an attribution bundle AT THAT STATEMENT'S
--   SNAPSHOT, which does not by itself close the window between P-4 and the
--   upsert below. The `DO UPDATE SET` is therefore additionally guarded by a
--   `WHERE` clause requiring all five attribution fields to still be NULL at
--   the moment of the write (§1), so a target that acquires a correction in
--   that window is left untouched rather than overwritten — and §9 V-1 then
--   requires every one of the 12 to carry the exact ATTR-1 provenance
--   fingerprint, so a skipped write aborts the whole migration instead of
--   silently committing 11-of-12.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠ MIGRATION TRANSACTION OPENS HERE — §0 through §9 commit as one unit.
-- ═══════════════════════════════════════════════════════════════════════════

begin;


-- ═══════════════════════════════════════════════════════════════════════════
-- §0. PREFLIGHT — fail closed on drift — and the canonical target population
-- ═══════════════════════════════════════════════════════════════════════════

-- ── The canonical 12-row repair population, in one place ────────────────────
--
-- This is the single source of truth the rest of the migration reads from —
-- both the preflight currency check (P-3) and the mutation (§1) derive from
-- this table, so there is no way for the two to silently disagree. Values are
-- transcribed exactly from docs/attr-0-evidence/f15-repair-impact.csv
-- (pre-repair state) and docs/attr-0-evidence/gate2-print-verification.csv /
-- docs/ATTR-0_ARTIST_ATTRIBUTION_INTEGRITY_AUDIT.md §3 (verified illustrator +
-- external sources).

create temporary table attr1_targets (
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

insert into attr1_targets
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

  -- xyp-XY67a is the one row confirmed in ATTR-0 §3, not Gate 2. Its evidence
  -- is a prose citation of Bulbapedia's Jirachi (XY Promo 67) print history,
  -- not a checksummed CSV row, so evidence_artifact_sha256 is honestly NULL —
  -- inventing a hash for a document that was never hash-pinned would be worse
  -- than recording that no such pin exists. It is also the ONLY target whose
  -- pre_artist_id is non-NULL ('sui') and the sole membership consequence of
  -- this whole migration (§9 V-5, V-6).
  ('xyp-XY67a', 'sui', 'sui', 'Naoki Saito', 'ATTR-0 §3',
   'https://bulbapedia.bulbagarden.net/wiki/Jirachi_(XY_Promo_67)',
   null,
   'docs/ATTR-0_ARTIST_ATTRIBUTION_INTEGRITY_AUDIT.md',
   null);

do $$
declare
  v_count int;
begin
  select count(*) into v_count from attr1_targets;
  if v_count <> 12 then
    raise exception
      'ATTR-1 §0: the canonical target table holds % rows, expected exactly '
      '12. This migration authors a fixed, narrow population and must not '
      'silently run against a different one.', v_count;
  end if;
  raise notice 'ATTR-1 §0: canonical 12-row target population loaded.';
end $$;


-- ── P-1: the F-15 channel exists with the expected shape ─────────────────────
--
-- ATTR-1 writes through F-15's channel and must not proceed if F-15 has
-- drifted from its deployed, validated shape (docs/F-15_IMPLEMENTATION.md §19).

do $$
declare
  v_cols          text[];
  v_f15_cols      text[] := array[
    'artist_id_override', 'attribution_override_evidence',
    'attribution_override_approved_by', 'attribution_override_approved_at'
  ];
  v_def           text;
  v_constraints   text[];
  v_expect_constr text[] := array[
    'card_extras_artist_id_override_fk',
    'card_extras_attribution_override_all_or_nothing',
    'card_extras_attribution_override_approved_by_nonempty',
    'card_extras_attribution_override_requires_illustrator'
  ];
  v_trigger_count int;
  v_tablelevel    bigint;
  v_tgenabled     "char";
  v_tgtype        smallint;
  v_fn_schema     text;
  v_fn_name       text;
  v_fn_secdef     bool;
  v_fn_lang       text;
  v_fn_src        text;
begin
  if to_regclass('public.card_extras') is null then
    raise exception 'ATTR-1 preflight P-1: public.card_extras does not exist.';
  end if;

  select coalesce(array_agg(column_name order by column_name), array[]::text[])
    into v_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'card_extras'
    and column_name = any(v_f15_cols);
  if v_cols is distinct from (select array_agg(x order by x) from unnest(v_f15_cols) x) then
    raise exception
      'ATTR-1 preflight P-1: card_extras is missing one or more F-15 columns '
      '(found=%, expected=%). F-15 must be deployed before ATTR-1 can write '
      'through its channel.', v_cols, v_f15_cols;
  end if;

  select coalesce(array_agg(conname order by conname), array[]::text[])
    into v_constraints
  from pg_constraint
  where conrelid = 'public.card_extras'::regclass
    and conname = any(v_expect_constr);
  if v_constraints is distinct from (select array_agg(x order by x) from unnest(v_expect_constr) x) then
    raise exception
      'ATTR-1 preflight P-1: card_extras is missing one or more F-15 '
      'constraints (found=%, expected=%).', v_constraints, v_expect_constr;
  end if;

  select count(*) into v_trigger_count
  from pg_trigger
  where tgrelid = 'public.card_extras'::regclass
    and not tgisinternal
    and tgname = 'card_extras_admit_attribution_override';
  if v_trigger_count <> 1 then
    raise exception
      'ATTR-1 preflight P-1: the F-15 admission trigger '
      'card_extras_admit_attribution_override is missing. ATTR-1 relies on it '
      'to enforce resolver consistency and must not bypass it by proceeding '
      'without it.';
  end if;

  -- A trigger existing BY NAME is not the same as it being live and doing
  -- the reviewed thing: a DISABLED trigger still satisfies the count check
  -- above while enforcing nothing, and a same-named trigger could in
  -- principle be rebound to a different function. This migration explicitly
  -- relies on this trigger as its SECOND resolver wall (P-5 re-checks the
  -- resolver, but the trigger is what actually enforces it at write time) —
  -- so same-name drift must fail closed, not pass silently.
  select t.tgenabled, t.tgtype, n.nspname, p.proname, p.prosecdef,
         l.lanname, p.prosrc
    into v_tgenabled, v_tgtype, v_fn_schema, v_fn_name, v_fn_secdef,
         v_fn_lang, v_fn_src
  from pg_trigger t
  join pg_proc p      on p.oid = t.tgfoid
  join pg_namespace n on n.oid = p.pronamespace
  join pg_language l  on l.oid = p.prolang
  where t.tgrelid = 'public.card_extras'::regclass
    and not t.tgisinternal
    and t.tgname = 'card_extras_admit_attribution_override';

  if v_tgenabled = 'D' then
    raise exception
      'ATTR-1 preflight P-1: the F-15 admission trigger exists but is '
      'DISABLED (tgenabled=D). A disabled trigger enforces nothing — ATTR-1 '
      'must not write through a channel whose second wall is silently off. '
      'STOP.';
  end if;

  -- tgtype bit flags (see postgres pg_trigger.tgtype / trigger.h):
  -- 1=ROW, 2=BEFORE, 4=INSERT, 8=DELETE, 16=UPDATE. The reviewed trigger is
  -- BEFORE INSERT OR UPDATE FOR EACH ROW; any other firing shape means the
  -- trigger no longer runs where this migration's writes need it to.
  if (v_tgtype & 1) = 0 or (v_tgtype & 2) = 0
     or (v_tgtype & 4) = 0 or (v_tgtype & 16) = 0 then
    raise exception
      'ATTR-1 preflight P-1: the F-15 admission trigger is not '
      'BEFORE INSERT OR UPDATE FOR EACH ROW (tgtype=%). Its firing shape has '
      'drifted from the reviewed design. STOP.', v_tgtype;
  end if;

  if v_fn_schema is distinct from 'public'
     or v_fn_name is distinct from 'card_extras_admit_attribution_override' then
    raise exception
      'ATTR-1 preflight P-1: the trigger is bound to %.%(), not '
      'public.card_extras_admit_attribution_override(). A same-named trigger '
      'pointing at a different function must fail closed, not pass by name '
      'alone. STOP.', v_fn_schema, v_fn_name;
  end if;

  if v_fn_secdef is distinct from false or v_fn_lang is distinct from 'plpgsql' then
    raise exception
      'ATTR-1 preflight P-1: the F-15 admission function is no longer '
      'SECURITY INVOKER plpgsql (secdef=%, lang=%) — its privilege shape has '
      'drifted from the reviewed design. STOP.', v_fn_secdef, v_fn_lang;
  end if;

  -- Pin the load-bearing SEMANTICS, not just the name and binding: the
  -- aliases-only resolver, the fail-closed-on-ambiguity rule (R4), the
  -- zero-match-requires-NULL rule (R3), and provenance completeness (R1).
  -- A same-named, correctly-bound function whose body was quietly redefined
  -- without these would otherwise pass every check above while removing
  -- ATTR-1's second wall.
  if position('unnest(coalesce(a.aliases' in v_fn_src) = 0
     or position('v_match_count > 1' in v_fn_src) = 0
     or position('v_match_count = 0' in v_fn_src) = 0
     or position('attribution_override_evidence' in v_fn_src) = 0
     or position('attribution_override_approved_by' in v_fn_src) = 0
     or position('attribution_override_approved_at' in v_fn_src) = 0 then
    raise exception
      'ATTR-1 preflight P-1: the F-15 admission function body no longer '
      'contains the reviewed aliases-only resolver, fail-closed-on-ambiguity, '
      'zero-match-requires-NULL, or provenance-completeness logic. Same-name, '
      'same-binding drift must still fail closed. STOP and re-review before '
      'trusting this channel.';
  end if;

  raise notice
    'ATTR-1 preflight P-1: F-15 admission trigger is enabled, correctly '
    'shaped, bound to the reviewed function, and its load-bearing resolver '
    'semantics are intact.';

  -- cards_effective must be reading artist_id_override through the F-15 CASE,
  -- not the pre-F-15 raw passthrough — otherwise this migration's writes would
  -- be invisible at the effective layer and every postcondition below would be
  -- checking the wrong thing.
  select pg_get_viewdef('public.cards_effective'::regclass, true) into v_def;
  if position('artist_id_override' in lower(v_def)) = 0
     or position('case' in lower(v_def)) = 0 then
    raise exception
      'ATTR-1 preflight P-1: cards_effective does not reference '
      'artist_id_override via a CASE expression — F-15 does not appear to be '
      'deployed. STOP.';
  end if;

  -- The restrictive CAT-3B/F-15 column ACL must still be in force: no
  -- table-level grant for anon/authenticated. Not because this migration
  -- changes it, but because a drifted ACL would mean something outside this
  -- slice touched the channel this migration is about to write through.
  select count(*) into v_tablelevel
  from pg_class c
  cross join lateral aclexplode(c.relacl) x
  join pg_roles r on r.oid = x.grantee
  where c.oid = 'public.card_extras'::regclass
    and r.rolname in ('anon', 'authenticated');
  if v_tablelevel <> 0 then
    raise exception
      'ATTR-1 preflight P-1: % table-level grant(s) exist for '
      'anon/authenticated on card_extras — the F-15/CAT-3B column ACL has '
      'drifted. STOP and investigate before writing through this channel.',
      v_tablelevel;
  end if;

  raise notice 'ATTR-1 preflight P-1: F-15 channel shape confirmed (columns, constraints, trigger, view, ACL).';
end $$;


-- ── P-2: exactly the 12 target IDs exist in cards_effective ──────────────────

do $$
declare
  v_found   bigint;
  v_missing text[];
begin
  select count(*) into v_found
  from public.cards_effective ce
  join attr1_targets t on t.card_id = ce.id;

  select coalesce(array_agg(t.card_id order by t.card_id), array[]::text[])
    into v_missing
  from attr1_targets t
  where not exists (select 1 from public.cards_effective ce where ce.id = t.card_id);

  if v_found <> 12 or array_length(v_missing, 1) is not null then
    raise exception
      'ATTR-1 preflight P-2: expected exactly 12 target IDs live in '
      'cards_effective, found %. Missing: %. STOP.', v_found, v_missing;
  end if;

  raise notice 'ATTR-1 preflight P-2: all 12 target IDs are live in cards_effective.';
end $$;


-- ── P-3: currency — each target's current effective state matches the ───────
--        canonical pre-repair reading (f15-repair-impact.csv), re-measured now

do $$
declare
  v_drift bigint;
  v_rows  text[];
begin
  select count(*), coalesce(array_agg(t.card_id order by t.card_id), array[]::text[])
    into v_drift, v_rows
  from attr1_targets t
  join public.cards_effective ce on ce.id = t.card_id
  where ce.illustrator is distinct from t.pre_illustrator
     or ce.artist_id   is distinct from t.pre_artist_id;

  if v_drift <> 0 then
    raise exception
      'ATTR-1 preflight P-3: % target(s) have drifted from the canonical '
      'pre-repair state recorded in f15-repair-impact.csv: %. Something has '
      'changed these cards'' attribution since the evidence was captured — '
      'STOP and re-review before trusting the approved repair plan.',
      v_drift, v_rows;
  end if;

  raise notice 'ATTR-1 preflight P-3: all 12 targets match the canonical pre-repair reading.';
end $$;


-- ── P-4: no target already carries an attribution bundle ────────────────────
--        Do not overwrite a prior correction — verified or not.

do $$
declare
  v_existing bigint;
  v_rows     text[];
begin
  select count(*), coalesce(array_agg(ce.card_id order by ce.card_id), array[]::text[])
    into v_existing, v_rows
  from public.card_extras ce
  join attr1_targets t on t.card_id = ce.card_id
  where ce.illustrator_override             is not null
     or ce.artist_id_override               is not null
     or ce.attribution_override_evidence    is not null
     or ce.attribution_override_approved_by is not null
     or ce.attribution_override_approved_at is not null;

  if v_existing <> 0 then
    raise exception
      'ATTR-1 preflight P-4: % target(s) already carry an attribution bundle: '
      '%. ATTR-1 must not silently overwrite an existing correction — STOP '
      'and investigate.', v_existing, v_rows;
  end if;

  raise notice 'ATTR-1 preflight P-4: no target carries a pre-existing attribution bundle.';
end $$;


-- ── P-5: each verified illustrator still resolves to zero artist rows ───────
--        (aliases-only resolver, byte-for-byte the F-15/sync-cards.mjs
--        contract). If this has changed, the approved artist_id_override=NULL
--        plan may no longer be correct and must not be applied blindly.

do $$
declare
  v_bad_count int;
  v_names     text[];
begin
  select count(*), coalesce(array_agg(v.verified_illustrator order by v.verified_illustrator), array[]::text[])
    into v_bad_count, v_names
  from (select distinct verified_illustrator from attr1_targets) v
  where exists (
    select 1 from public.artists a
    where exists (
      select 1 from unnest(coalesce(a.aliases, array[]::text[])) al
      where lower(btrim(al)) = lower(btrim(v.verified_illustrator))
    )
  );

  if v_bad_count <> 0 then
    raise exception
      'ATTR-1 preflight P-5: % of the 7 distinct verified illustrator name(s) '
      'now resolve to at least one public.artists row via aliases: %. The '
      'approved artist_id_override = NULL plan assumed zero matches for '
      'every one — STOP rather than silently writing a stale plan.',
      v_bad_count, v_names;
  end if;

  raise notice 'ATTR-1 preflight P-5: all 7 distinct verified illustrator names still resolve to zero artists.';
end $$;


-- ── Pre-mutation snapshots — everything the postconditions compare against ──

create temporary table attr1_pre_effective on commit drop as
select ce.id as card_id, ce.illustrator, ce.artist_id
from public.cards_effective ce
join attr1_targets t on t.card_id = ce.id;

create temporary table attr1_pre_raw_cards on commit drop as
select c.id as card_id, c.illustrator, c.artist_id
from public.cards c
join attr1_targets t on t.card_id = c.id;

-- Full-row snapshot of any pre-existing card_extras row for the 12 targets.
-- P-4 has already proved none carries an attribution bundle, but a target MAY
-- still carry an unrelated enrichment row (a source_note, a CAT-3B image
-- override) — this snapshot is what proves that row's unrelated columns
-- survive the upsert untouched (§9 V-8). Zero rows is an expected, valid
-- outcome, not a snapshot failure.
create temporary table attr1_pre_card_extras_targets on commit drop as
select ce.*
from public.card_extras ce
join attr1_targets t on t.card_id = ce.card_id;

-- Full-row snapshot of every OTHER card_extras row, so §9 V-9 can prove this
-- migration changed nothing whatsoever outside the 12-row target set.
create temporary table attr1_pre_extras_nontarget on commit drop as
select ce.*
from public.card_extras ce
where not exists (select 1 from attr1_targets t where t.card_id = ce.card_id);

create temporary table attr1_pre_sui_count on commit drop as
select count(*) as n
from public.cards_effective ce
where ce.artist_id = 'sui';

do $$
declare
  v_sui bigint;
begin
  select n into v_sui from attr1_pre_sui_count;
  raise notice 'ATTR-1 §0 snapshot: pre-migration effective sui membership = %.', v_sui;
end $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- §1. THE MUTATION — twelve rows, five columns, nothing else
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ON CONFLICT DO UPDATE SET names only the five attribution columns, so this
-- remains safe even if an unrelated card_extras row appears for one of these
-- 12 cards between authoring and execution: any such row's source_note or
-- CAT-3B image columns are left untouched, exactly as the containment
-- contract requires.
--
-- artist_id_override is NULL on all 12 (verbatim from attr1_targets — no
-- literal NULL is hardcoded here beyond what the canonical table already
-- states via a plain SELECT). The F-15 admission trigger re-validates this at
-- write time against the SAME aliases-only resolver P-5 just re-checked; if
-- production moved between P-5 and this INSERT within the same transaction,
-- the trigger — not this file's own logic — is the second, independent wall.
--
-- The ON CONFLICT DO UPDATE's WHERE guard closes the P-4 TOCTOU gap: it only
-- overwrites a conflicting row if that row STILL carries no attribution
-- bundle at write time. A target that acquired a correction between P-4's
-- snapshot and this statement (a manual or service-role writer racing this
-- migration) is left untouched — its DO UPDATE simply does not match — and
-- §9 V-1 catches the resulting short write by requiring all 12 to carry the
-- ATTR-1 provenance fingerprint, aborting the whole transaction rather than
-- silently committing a partial repair.

insert into public.card_extras (
  card_id,
  illustrator_override,
  artist_id_override,
  attribution_override_evidence,
  attribution_override_approved_by,
  attribution_override_approved_at
)
select
  t.card_id,
  t.verified_illustrator,
  null,
  jsonb_build_object(
    'derivation',              'attr-1-confirmed-repair',
    'gate',                    t.evidence_gate,
    'verified',                true,
    'verified_illustrator',    t.verified_illustrator,
    'primary_source',          t.primary_source,
    'secondary_source',        t.secondary_source,
    'evidence_artifact',       t.evidence_artifact,
    'evidence_artifact_sha256', t.evidence_artifact_sha256,
    'design_doc',              'docs/ATTR-1_CONFIRMED_ATTRIBUTION_REPAIRS.md'
  ),
  'system:attr-1-migration',
  now()
from attr1_targets t
on conflict (card_id) do update set
  illustrator_override              = excluded.illustrator_override,
  artist_id_override                = excluded.artist_id_override,
  attribution_override_evidence     = excluded.attribution_override_evidence,
  attribution_override_approved_by  = excluded.attribution_override_approved_by,
  attribution_override_approved_at  = excluded.attribution_override_approved_at
where card_extras.illustrator_override             is null
  and card_extras.artist_id_override               is null
  and card_extras.attribution_override_evidence    is null
  and card_extras.attribution_override_approved_by is null
  and card_extras.attribution_override_approved_at is null;


-- ═══════════════════════════════════════════════════════════════════════════
-- §9. IN-TRANSACTION VALIDATION — every check ABORTS rather than warns
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare
  v_bundle_count      bigint;
  v_illustrator_wrong bigint;
  v_artist_not_null   bigint;
  v_membership_moved  bigint;
  v_xy67a_still_sui   bigint;
  v_sui_pre           bigint;
  v_sui_post          bigint;
  v_raw_changed       bigint;
  v_unrelated_existed bigint;
  v_unrelated_new     bigint;
  v_nontarget_diff    bigint;
  v_c1                bigint;
  v_c2                bigint;
  v_c3                bigint;
  v_ambig             bigint;
  v_extra_bundles     bigint;
begin
  -- ── V-1 — exactly 12 complete ATTR-1 bundles, exactly the target set ──────
  -- Requires the exact ATTR-1 provenance fingerprint (derivation +
  -- approved_by), not merely "some complete bundle" — this is what turns the
  -- P-4/upsert TOCTOU guard into an actual abort rather than a silent partial
  -- write: if the conditional DO UPDATE skipped a target because a racing
  -- writer got there first, that row carries the RACING write's fingerprint
  -- (or none), v_bundle_count comes in under 12, and the whole transaction
  -- rolls back instead of committing 11-of-12.
  select count(*) into v_bundle_count
  from public.card_extras ce
  join attr1_targets t on t.card_id = ce.card_id
  where ce.illustrator_override             is not null
    and ce.artist_id_override               is null
    and ce.attribution_override_evidence    is not null
    and ce.attribution_override_approved_by is not null
    and ce.attribution_override_approved_at is not null
    and (ce.attribution_override_evidence ->> 'derivation') = 'attr-1-confirmed-repair'
    and ce.attribution_override_approved_by = 'system:attr-1-migration';

  if v_bundle_count <> 12 then
    raise exception
      'ATTR-1 V-1 FAILED: expected exactly 12 complete attribution bundles '
      'carrying the ATTR-1 provenance fingerprint (illustrator_override set, '
      'artist_id_override NULL, full provenance, derivation='
      'attr-1-confirmed-repair, approved_by=system:attr-1-migration), found '
      '%. A short count means a target already acquired a different '
      'correction between P-4 and the upsert and this migration correctly '
      'refused to overwrite it — ABORTING the whole transaction rather than '
      'committing a partial repair.', v_bundle_count;
  end if;

  -- No OTHER row anywhere in card_extras now carries an ATTR-1-shaped bundle
  -- outside the 12 target ids — this migration must create no non-target
  -- correction.
  select count(*) into v_extra_bundles
  from public.card_extras ce
  where ce.illustrator_override is not null
    and not exists (select 1 from attr1_targets t where t.card_id = ce.card_id)
    and not exists (select 1 from attr1_pre_extras_nontarget p
                     where p.card_id = ce.card_id
                       and p.illustrator_override is not null);
  if v_extra_bundles <> 0 then
    raise exception
      'ATTR-1 V-1 FAILED: % non-target row(s) gained a NEW attribution '
      'bundle. ABORTING.', v_extra_bundles;
  end if;

  -- ── V-2 — each effective illustrator equals the verified value ────────────
  select count(*) into v_illustrator_wrong
  from attr1_targets t
  join public.cards_effective ce on ce.id = t.card_id
  where ce.illustrator is distinct from t.verified_illustrator;

  if v_illustrator_wrong <> 0 then
    raise exception
      'ATTR-1 V-2 FAILED: % target(s) do not display the verified '
      'illustrator. ABORTING.', v_illustrator_wrong;
  end if;

  -- ── V-3 — effective artist_id is NULL on all 12 ───────────────────────────
  select count(*) into v_artist_not_null
  from public.cards_effective ce
  join attr1_targets t on t.card_id = ce.id
  where ce.artist_id is not null;

  if v_artist_not_null <> 0 then
    raise exception
      'ATTR-1 V-3 FAILED: % target(s) have a non-NULL effective artist_id — '
      'every one of the 12 is an intentional NULL. ABORTING.',
      v_artist_not_null;
  end if;

  -- ── V-4 — the eleven non-sui targets: no FK membership change ─────────────
  select count(*) into v_membership_moved
  from attr1_pre_effective pre
  join public.cards_effective post on post.id = pre.card_id
  where pre.card_id <> 'xyp-XY67a'
    and pre.artist_id is distinct from post.artist_id;

  if v_membership_moved <> 0 then
    raise exception
      'ATTR-1 V-4 FAILED: % non-xyp-XY67a target(s) had an FK membership '
      'change. Eleven of the twelve must move ONLY the displayed '
      'illustrator. ABORTING.', v_membership_moved;
  end if;

  -- ── V-5 — xyp-XY67a is no longer filed under sui ──────────────────────────
  select count(*) into v_xy67a_still_sui
  from public.cards_effective ce
  where ce.id = 'xyp-XY67a' and ce.artist_id is not distinct from 'sui';

  if v_xy67a_still_sui <> 0 then
    raise exception
      'ATTR-1 V-5 FAILED: xyp-XY67a is still filed under sui. This is the '
      'one membership change the whole repair exists to make. ABORTING.';
  end if;

  -- ── V-6 — sui membership changed by EXACTLY -1 from the captured pre-state ─
  select n into v_sui_pre from attr1_pre_sui_count;
  select count(*) into v_sui_post
  from public.cards_effective ce
  where ce.artist_id = 'sui';

  if v_sui_post <> v_sui_pre - 1 then
    raise exception
      'ATTR-1 V-6 FAILED: effective sui membership went from % to % — '
      'expected exactly -1. Any other delta means this migration moved a '
      'membership it should not have, or failed to move the one it should. '
      'ABORTING.', v_sui_pre, v_sui_post;
  end if;

  -- ── V-7 — raw public.cards is byte/value unchanged for all 12 targets ────
  select count(*) into v_raw_changed
  from attr1_pre_raw_cards pre
  join public.cards post on post.id = pre.card_id
  where pre.illustrator is distinct from post.illustrator
     or pre.artist_id   is distinct from post.artist_id;

  if v_raw_changed <> 0 then
    raise exception
      'ATTR-1 V-7 FAILED: % target(s) have a changed raw public.cards row. '
      'This migration must never write raw provider history. ABORTING.',
      v_raw_changed;
  end if;

  -- ── V-8 — unrelated card_extras fields on the 12 targets are unchanged ────
  -- Case A: a target already had a card_extras row before this migration —
  -- every non-attribution column on it must be untouched.
  select count(*) into v_unrelated_existed
  from attr1_pre_card_extras_targets pre
  join public.card_extras post on post.card_id = pre.card_id
  where pre.source_note                    is distinct from post.source_note
     or pre.created_at                     is distinct from post.created_at
     or pre.image_url_override             is distinct from post.image_url_override
     or pre.image_override_source_card_id  is distinct from post.image_override_source_card_id
     or pre.image_override_evidence        is distinct from post.image_override_evidence
     or pre.image_override_approved_by     is distinct from post.image_override_approved_by
     or pre.image_override_approved_at     is distinct from post.image_override_approved_at;

  if v_unrelated_existed <> 0 then
    raise exception
      'ATTR-1 V-8 FAILED: % target row(s) that already existed in '
      'card_extras had an unrelated field change. The upsert must touch '
      'only the five attribution columns. ABORTING.', v_unrelated_existed;
  end if;

  -- Case B: a target had NO card_extras row before this migration — its new
  -- row must carry only the attribution bundle, nothing else populated.
  select count(*) into v_unrelated_new
  from public.card_extras post
  join attr1_targets t on t.card_id = post.card_id
  where not exists (select 1 from attr1_pre_card_extras_targets pre where pre.card_id = post.card_id)
    and (
      post.source_note                   is not null
      or post.image_url_override            is not null
      or post.image_override_source_card_id is not null
      or post.image_override_evidence       is not null
      or post.image_override_approved_by    is not null
      or post.image_override_approved_at    is not null
    );

  if v_unrelated_new <> 0 then
    raise exception
      'ATTR-1 V-8 FAILED: % newly-created target row(s) carry an unrelated '
      'field the insert never set. ABORTING.', v_unrelated_new;
  end if;

  -- ── V-9 — no non-target card_extras row was created or changed ───────────
  select count(*) into v_nontarget_diff
  from (
    (select * from attr1_pre_extras_nontarget
     except all
     select ce.* from public.card_extras ce
     where not exists (select 1 from attr1_targets t where t.card_id = ce.card_id))
    union all
    (select ce.* from public.card_extras ce
     where not exists (select 1 from attr1_targets t where t.card_id = ce.card_id)
     except all
     select * from attr1_pre_extras_nontarget)
  ) d;

  if v_nontarget_diff <> 0 then
    raise exception
      'ATTR-1 V-9 FAILED: % non-target card_extras row(s) differ from their '
      'pre-migration snapshot. This migration must touch ONLY the 12 '
      'targets. ABORTING.', v_nontarget_diff;
  end if;

  -- ── V-10 — F-15 constraints/admission invariants remain clean ────────────
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
    raise exception 'ATTR-1 V-10 FAILED: % row(s) violate the F-15 C1 two-state bundle.', v_c1;
  end if;

  select count(*) into v_c2
  from public.card_extras
  where attribution_override_approved_by is not null
    and length(btrim(attribution_override_approved_by)) = 0;
  if v_c2 <> 0 then
    raise exception 'ATTR-1 V-10 FAILED: % row(s) have a blank approved_by.', v_c2;
  end if;

  select count(*) into v_c3
  from public.card_extras
  where artist_id_override is not null and illustrator_override is null;
  if v_c3 <> 0 then
    raise exception 'ATTR-1 V-10 FAILED: % bare artist_id_override row(s).', v_c3;
  end if;

  select count(*) into v_ambig
  from public.card_extras ce
  where ce.illustrator_override is not null
    and (select count(*) from public.artists a
          where exists (
            select 1 from unnest(coalesce(a.aliases, array[]::text[])) al
            where lower(btrim(al)) = lower(btrim(ce.illustrator_override))
          )) > 1;
  if v_ambig <> 0 then
    raise exception 'ATTR-1 V-10 FAILED: % admitted override(s) are ambiguous.', v_ambig;
  end if;

  raise notice
    'ATTR-1 §9 validation: ALL PASS (V-1 … V-10). sui: % -> %. Committing.',
    v_sui_pre, v_sui_post;
end $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠ MIGRATION TRANSACTION CLOSES HERE — §0 through §9 commit as one unit.
--   If anything above raised, NOTHING applied and the database is in the
--   complete pre-ATTR-1 state. All temporary tables drop automatically.
--
--   Rollback is NOT in this file. It lives in
--   docs/sql/attr-1-confirmed-attribution-repairs-rollback.sql — deliberately
--   separate so it cannot be pasted into a deployment window by accident.
--
--   Catalog sync remains PAUSED — this migration does not resume or trigger
--   it, and nothing in it depends on it running.
-- ═══════════════════════════════════════════════════════════════════════════

commit;
