-- ═══════════════════════════════════════════════════════════════════════════
-- F-15 — DURABLE ATTRIBUTION CORRECTION: VALIDATION
--
-- ⚠ THIS FILE HAS NOT BEEN EXECUTED, because the migration has not been
--   executed. It is authored now so the acceptance criteria are reviewed
--   BEFORE deployment rather than invented afterwards.
--
-- ⚠ PART A IS READ-ONLY AND ISSUES NO PRODUCTION WRITE. Safe to run at any
--   time, before or after the migration.
--
-- ⚠ PART B (negative admission tests) IS NOT RUN AGAINST PRODUCTION IN THIS
--   SLICE. It is authored, wrapped in an explicit ROLLBACK, and left
--   deliberately commented out. See the boundary note before Part B.
--
-- Migration: docs/sql/f15-durable-attribution-correction.sql
-- Rollback:  docs/sql/f15-durable-attribution-correction-rollback.sql
-- Design:    docs/F-15_DURABLE_ATTRIBUTION_CORRECTION_DESIGN.md §20
--
-- Note on scope: the migration already asserts V-1 … V-14 INSIDE its own
-- transaction and aborts on any failure, so a successful COMMIT is itself
-- proof those invariants held. Part A re-checks them from outside afterwards,
-- which is what makes the result independently reviewable rather than
-- self-reported.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- PART A — POST-EXECUTION VALIDATION (READ-ONLY)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── A-0: did the migration land at all? ──────────────────────────────────────
-- Expect 4 columns present.
select count(*) as f15_columns_present
from information_schema.columns
where table_schema = 'public' and table_name = 'card_extras'
  and column_name in ('artist_id_override', 'attribution_override_evidence',
                      'attribution_override_approved_by',
                      'attribution_override_approved_at');


-- ── V-2 / V-3: the five legacy rows ──────────────────────────────────────────
-- Expect exactly 5 rows, every one with resolver_consistent = true and
-- provenance_complete = true.
--
--   swsh11-185       N-DESIGN Inc.  artist_id_override = NULL
--   swsh11-186       Shinji Kanda   artist_id_override = shinji-kanda
--   swsh12-TG11      Yuu Nishida    artist_id_override = NULL
--   swsh12.5gg-GG19  Asako Ito      artist_id_override = asako-ito
--   swsh12.5gg-GG69  Akira Egawa    artist_id_override = akira-egawa
select
  ce.card_id,
  ce.illustrator_override,
  ce.artist_id_override,
  c.artist_id as raw_artist_id,
  ce.artist_id_override is not distinct from
    (select a.id from public.artists a
      where exists (
        select 1 from unnest(coalesce(a.aliases, array[]::text[])) al
        where lower(btrim(al)) = lower(btrim(ce.illustrator_override))
      ))                                        as resolver_consistent,
  (ce.attribution_override_evidence    is not null
   and ce.attribution_override_approved_by is not null
   and ce.attribution_override_approved_at is not null)
                                                as provenance_complete,
  ce.attribution_override_evidence ->> 'derivation'  as derivation,
  ce.attribution_override_evidence ->> 'verified'    as verified_flag,
  ce.attribution_override_approved_by
from public.card_extras ce
join public.cards c on c.id = ce.card_id
where ce.illustrator_override is not null
order by ce.card_id;


-- ── V-3 (effective): the five rows' effective artist_id is unchanged ─────────
-- Expect exactly: NULL, shinji-kanda, NULL, asako-ito, akira-egawa —
-- identical to the pre-migration reading recorded in the design §6.1.
select ef.id, ef.illustrator, ef.artist_id
from public.cards_effective ef
where ef.id in ('swsh11-185', 'swsh11-186', 'swsh12-TG11',
                'swsh12.5gg-GG19', 'swsh12.5gg-GG69')
order by ef.id;


-- ── V-3b: curated artist FK counts unchanged ────────────────────────────────
-- Expect shinji-kanda 28, asako-ito 38, akira-egawa 106, sui 224 — the
-- pre-migration readings. sui MUST still be 224: F-15 repairs nothing, so
-- xyp-XY67a is still filed under sui. It drops to 223 only when ATTR-1 runs.
select a.id,
       (select count(*) from public.cards_effective ce where ce.artist_id = a.id) as eff_cards_by_fk
from public.artists a
where a.id in ('shinji-kanda', 'asako-ito', 'akira-egawa', 'sui')
order by a.id;


-- ── V-4 / V-5 / V-6: the declarative invariants hold ────────────────────────
-- Expect 0 / 0 / 0.
select
  (select count(*) from public.card_extras
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
    ))                                                        as c1_violations,
  (select count(*) from public.card_extras
    where attribution_override_approved_by is not null
      and length(btrim(attribution_override_approved_by)) = 0) as c2_violations,
  (select count(*) from public.card_extras
    where artist_id_override is not null
      and illustrator_override is null)                        as c3_violations;


-- ── V-7: no admitted override is ambiguous ──────────────────────────────────
-- Expect 0. Counted in ARTIST ROWS, not alias tokens.
select count(*) as ambiguous_admitted_overrides
from public.card_extras ce
where ce.illustrator_override is not null
  and (select count(*) from public.artists a
        where exists (
          select 1 from unnest(coalesce(a.aliases, array[]::text[])) al
          where lower(btrim(al)) = lower(btrim(ce.illustrator_override))
        )) > 1;


-- ── V-8 / V-9 / V-10 / V-11: the view survived intact ───────────────────────
-- Expect 14 columns in the CAT-2D.1 order with artist_id last.
select attnum, attname
from pg_attribute
where attrelid = 'public.cards_effective'::regclass
  and attnum > 0 and not attisdropped
order by attnum;

-- Expect reloptions to contain security_invoker=true.
select reloptions from pg_class where oid = 'public.cards_effective'::regclass;

-- Read the definition and confirm by eye AND by the flags below:
--   * the CAT-2D.1 alias exclusion is present
--   * both COALESCE overrides are present
--   * artist_id is the CASE, not a COALESCE
select pg_get_viewdef('public.cards_effective'::regclass, true) as def;

select
  position('card_identity_resolution' in v.def) > 0                as has_alias_exclusion,
  position('illustrator_override'     in lower(v.def)) > 0         as has_illustrator_override,
  position('image_url_override'       in lower(v.def)) > 0         as has_image_override,
  position('artist_id_override'       in lower(v.def)) > 0         as has_attribution_override,
  position('coalesce(ce.artist_id_override' in lower(v.def)) = 0   as artist_id_is_not_coalesce
from (select pg_get_viewdef('public.cards_effective'::regclass, true) as def) v;
-- Expect: true, true, true, true, true.


-- ── V-12: the public column ACL is exactly the four intended columns ────────
-- Expect for BOTH anon and authenticated, exactly:
--   artist_id_override, card_id, illustrator_override, image_url_override
-- Every provenance column must be absent.
select r.rolname,
       array_agg(distinct a.attname order by a.attname) as public_select_columns
from pg_attribute a
cross join lateral aclexplode(a.attacl) x
join pg_roles r on r.oid = x.grantee
where a.attrelid = 'public.card_extras'::regclass
  and a.attnum > 0 and not a.attisdropped
  and r.rolname in ('anon', 'authenticated')
  and x.privilege_type = 'SELECT'
group by r.rolname
order by r.rolname;

-- Expect ZERO rows: no table-level grant may exist for anon/authenticated,
-- because a table grant covers every column the table will ever have.
select r.rolname, x.privilege_type
from pg_class c
cross join lateral aclexplode(c.relacl) x
join pg_roles r on r.oid = x.grantee
where c.oid = 'public.card_extras'::regclass
  and r.rolname in ('anon', 'authenticated');


-- ── V-6 (RLS): unchanged ────────────────────────────────────────────────────
-- Expect relrowsecurity = true, relforcerowsecurity = false, and exactly one
-- permissive SELECT policy (card_extras_public_select). No write policy.
select relrowsecurity, relforcerowsecurity
from pg_class where oid = 'public.card_extras'::regclass;

select polname, polcmd, pg_get_expr(polqual, polrelid) as using_expr
from pg_policy where polrelid = 'public.card_extras'::regclass
order by polname;


-- ── V-13: ATTR-1 remains completely unrepaired ──────────────────────────────
-- Expect 0. F-15 creates the channel and repairs nothing.
select count(*) as attr1_rows_with_a_correction
from public.card_extras
where card_id in ('g1-28a','g1-73a','xy10-111a','xy10-43a','xy4-65a',
                  'xy6-77a','xy7-75a','xy9-107a','xy9-98b','xyp-XY150a',
                  'xyp-XY177a','xyp-XY67a')
  and (illustrator_override is not null or artist_id_override is not null);

-- And their effective attribution is still the pre-repair (defective) value.
-- Expect the ATTR-0 / Gate 2 readings unchanged, including xyp-XY67a = sui.
select ef.id, ef.illustrator, ef.artist_id
from public.cards_effective ef
where ef.id in ('g1-28a','g1-73a','xy10-111a','xy10-43a','xy4-65a',
                'xy6-77a','xy7-75a','xy9-107a','xy9-98b','xyp-XY150a',
                'xyp-XY177a','xyp-XY67a')
order by ef.id;


-- ── V-14: both triggers coexist ─────────────────────────────────────────────
-- Expect THREE triggers: card_extras_admit_attribution_override (F-15),
-- card_extras_admit_image_override (CAT-3B), card_extras_set_updated_at.
select tgname, pg_get_triggerdef(oid) as def
from pg_trigger
where tgrelid = 'public.card_extras'::regclass and not tgisinternal
order by tgname;

-- The F-15 admission function must NOT be security definer.
-- Expect prosecdef = false.
select proname, prosecdef
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and proname in ('card_extras_admit_attribution_override',
                  'card_extras_admit_image_override')
order by proname;


-- ── E-1: the artist-directory drift detector (design §15) ───────────────────
-- Corrections whose intentional-NULL artist target has since become
-- representable, because an artists row was created after admission.
--
-- NON-ZERO OUTPUT IS NOT AN ERROR. It is the queue for a deliberate, reviewed
-- reconciliation pass. Nothing here repairs anything.
--
-- Expect 0 rows immediately after F-15: the two legacy NULL rows
-- (N-DESIGN Inc., Yuu Nishida) have no artists row and none is expected.
select ce.card_id, ce.illustrator_override, ce.artist_id_override,
       (select a.id from public.artists a
          where exists (
            select 1 from unnest(coalesce(a.aliases, array[]::text[])) al
            where lower(btrim(al)) = lower(btrim(ce.illustrator_override))
          )) as resolver_would_now_give
from public.card_extras ce
where ce.illustrator_override is not null
  and ce.artist_id_override is null
  and exists (
    select 1 from public.artists a
    where exists (
      select 1 from unnest(coalesce(a.aliases, array[]::text[])) al
      where lower(btrim(al)) = lower(btrim(ce.illustrator_override))
    ));


-- ── E-2: the permanent invariant (I-5 + R5) ─────────────────────────────────
-- Expect ZERO rows, forever. A row here means a correction points at an artist
-- its own override string does not resolve to, or a bare artist_id_override
-- exists.
select ce.card_id, ce.illustrator_override, ce.artist_id_override
from public.card_extras ce
where (ce.artist_id_override is not null and ce.illustrator_override is null)
   or (ce.artist_id_override is not null and not exists (
         select 1 from public.artists a
         where a.id = ce.artist_id_override
           and exists (
             select 1 from unnest(coalesce(a.aliases, array[]::text[])) al
             where lower(btrim(al)) = lower(btrim(ce.illustrator_override))
           )));


-- ═══════════════════════════════════════════════════════════════════════════
-- PART B — NEGATIVE ADMISSION TESTS
--
-- ⚠⚠ NOT RUN IN THIS SLICE. DELIBERATELY LEFT COMMENTED OUT. ⚠⚠
--
-- WHY NOT. Every case below requires a WRITE to prove a rejection. The F-15
-- implementation slice carries no production mutation authorization, and
-- manufacturing throwaway rows in production to test a constraint is exactly
-- the kind of "it's only temporary" write that leaves residue when a session
-- drops mid-transaction. The design's V-8 durability test is deferred for the
-- same reason (design §20; no non-production database exists, and creating a
-- paid Supabase branch is out of scope without explicit approval).
--
-- WHAT PROVES THE RULES IN THE MEANTIME. scripts/f15-attribution-correction.test.mjs
-- asserts statically that each rejection path exists in the admission function
-- and that C1 is the exact two-state expression — so a future edit that
-- removes a rule fails the harness. That is structural proof, not behavioural
-- proof, and this file does not pretend otherwise.
--
-- HOW TO RUN THESE LATER, IF AND WHEN SEPARATELY APPROVED.
--   Every case is inside ONE transaction that ends in ROLLBACK, so nothing is
--   ever committed. Each expects an exception; if a statement SUCCEEDS, that
--   case has FAILED. Run them one at a time and read each error.
--
--   Preferred order of preference for where to run:
--     1. a non-production database, if one exists;
--     2. a Supabase branch, only with explicit approval (it is a paid
--        resource);
--     3. production inside the explicit ROLLBACK below — ONLY with separate
--        written approval, never as part of the deployment window.
--
--   'swsh11-999' is used as a scratch card_id below; substitute a card id that
--   genuinely exists in public.cards, since card_extras.card_id has an FK.
-- ═══════════════════════════════════════════════════════════════════════════

-- begin;
--
-- -- N-1 — R2: a known single alias with the WRONG artist → reject.
-- --   'Shinji Kanda' resolves to shinji-kanda; claiming sui must fail.
-- insert into public.card_extras
--   (card_id, illustrator_override, artist_id_override,
--    attribution_override_evidence, attribution_override_approved_by,
--    attribution_override_approved_at)
-- values
--   ('<real-card-id>', 'Shinji Kanda', 'sui',
--    '{"derivation":"negative-test"}'::jsonb, 'test', now());
-- -- EXPECT: ERROR … resolves to artist shinji-kanda, but artist_id_override is sui
--
-- -- N-2 — R3: zero alias matches with a NON-NULL artist_id_override → reject.
-- insert into public.card_extras
--   (card_id, illustrator_override, artist_id_override,
--    attribution_override_evidence, attribution_override_approved_by,
--    attribution_override_approved_at)
-- values
--   ('<real-card-id>', 'Ryo Ueda', 'sui',
--    '{"derivation":"negative-test"}'::jsonb, 'test', now());
-- -- EXPECT: ERROR … matches no artist alias, so artist_id_override must be NULL
--
-- -- N-3 — R4: ambiguity → reject. Requires two artists sharing one normalised
-- --   alias, which production does not currently have (measured 0). To exercise
-- --   this you must first create the collision, which is itself a write — so
-- --   this case is only meaningful on a non-production database.
-- -- EXPECT: ERROR … fails closed on ambiguity rather than choosing one
--
-- -- N-4 — R5 / C3: a bare artist_id_override → reject.
-- insert into public.card_extras (card_id, artist_id_override)
-- values ('<real-card-id>', 'sui');
-- -- EXPECT: ERROR … artist_id_override is set without an illustrator_override
-- --   (raised by the trigger; C3 also blocks it declaratively)
--
-- -- N-5 — C1 State B violated: illustrator_override with MISSING provenance.
-- insert into public.card_extras (card_id, illustrator_override)
-- values ('<real-card-id>', 'Ryo Ueda');
-- -- EXPECT: ERROR … provenance incomplete  (or the C1 check violation)
--
-- -- N-6 — C1 mixed state: provenance present, illustrator_override NULL.
-- insert into public.card_extras
--   (card_id, attribution_override_evidence, attribution_override_approved_by,
--    attribution_override_approved_at)
-- values
--   ('<real-card-id>', '{"derivation":"negative-test"}'::jsonb, 'test', now());
-- -- EXPECT: ERROR … card_extras_attribution_override_all_or_nothing
--
-- -- N-7 — C2: blank approved_by → reject.
-- insert into public.card_extras
--   (card_id, illustrator_override, artist_id_override,
--    attribution_override_evidence, attribution_override_approved_by,
--    attribution_override_approved_at)
-- values
--   ('<real-card-id>', 'Ryo Ueda', null,
--    '{"derivation":"negative-test"}'::jsonb, '   ', now());
-- -- EXPECT: ERROR … card_extras_attribution_override_approved_by_nonempty
--
-- -- N-8 — POSITIVE: a valid intentional-NULL correction is ADMITTED.
-- --   This is the shape every one of the 12 ATTR-1 rows will take.
-- insert into public.card_extras
--   (card_id, illustrator_override, artist_id_override,
--    attribution_override_evidence, attribution_override_approved_by,
--    attribution_override_approved_at)
-- values
--   ('<real-card-id>', 'Ryo Ueda', null,
--    '{"derivation":"negative-test"}'::jsonb, 'test', now());
-- -- EXPECT: SUCCESS (1 row). If this fails, admission is too strict.
--
-- -- N-9 — IDEMPOTENCE: an unrelated source_note edit must NOT re-admit.
-- update public.card_extras
--    set source_note = 'unrelated edit'
--  where card_id = '<real-card-id>';
-- -- EXPECT: SUCCESS. The trigger returns early because all five attribution
-- --   fields are IS NOT DISTINCT FROM OLD.
--
-- -- N-10 — IDEMPOTENCE: an unrelated image-override edit must NOT re-admit
-- --   the attribution bundle either (it will still face CAT-3B's own admission).
-- --   Exercise only where an admissible alias source exists.
--
-- -- N-11 — WITHDRAWAL: clearing the whole bundle is permitted.
-- update public.card_extras
--    set illustrator_override             = null,
--        artist_id_override               = null,
--        attribution_override_evidence    = null,
--        attribution_override_approved_by = null,
--        attribution_override_approved_at = null
--  where card_id = '<real-card-id>';
-- -- EXPECT: SUCCESS. Withdrawing a correction must not require the artist to
-- --   still resolve.
--
-- -- N-12 — PARTIAL WITHDRAWAL: clearing ONLY illustrator_override → reject.
-- update public.card_extras
--    set illustrator_override = null
--  where card_id = '<real-card-id>';
-- -- EXPECT: ERROR … card_extras_attribution_override_all_or_nothing
-- --   (there is no partial-removal state to fall into)
--
-- rollback;   -- ⚠ ALWAYS. Nothing above is ever committed.


-- ═══════════════════════════════════════════════════════════════════════════
-- DEFERRED — V-8 SYNC DURABILITY (design §20)
--
-- "Write a correction, run a sync over its set, re-read" is NON-PRODUCTION
-- ONLY and is DEFERRED: catalog sync is paused and must not be resumed to test
-- F-15, and no non-production database exists.
--
-- The structural proof stands in the meantime, and is enforced mechanically by
-- scripts/f15-attribution-correction.test.mjs §8:
--   * sync-cards.mjs writes exactly one table, public.cards;
--   * mapCardToRow()'s payload is the exact ON CONFLICT DO UPDATE SET column
--     list, and contains none of the F-15 columns — so they are structurally
--     unwritable by the routine sync path;
--   * the string "card_extras" appears nowhere in sync-cards.mjs;
--   * cards_effective gives the override precedence.
-- ═══════════════════════════════════════════════════════════════════════════
