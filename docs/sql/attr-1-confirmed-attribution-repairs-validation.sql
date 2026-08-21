-- ═══════════════════════════════════════════════════════════════════════════
-- ATTR-1 — CONFIRMED ATTRIBUTION REPAIRS: VALIDATION
--
-- ⚠ THIS FILE HAS NOT BEEN EXECUTED, because the migration has not been
--   executed. Authored now so the acceptance criteria are reviewed BEFORE
--   deployment rather than invented afterwards.
--
-- ⚠ READ-ONLY. Issues no production write. Safe to run at any time, before or
--   after the migration.
--
-- Migration: docs/sql/attr-1-confirmed-attribution-repairs.sql
-- Rollback:  docs/sql/attr-1-confirmed-attribution-repairs-rollback.sql
-- Design:    docs/ATTR-1_CONFIRMED_ATTRIBUTION_REPAIRS.md
--
-- Note on scope: the migration already asserts V-1 … V-10 INSIDE its own
-- transaction and aborts on any failure, so a successful COMMIT is itself
-- proof those invariants held. This file re-checks them from outside
-- afterwards, which is what makes the result independently reviewable rather
-- than self-reported.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── A-0: did the migration land at all? ──────────────────────────────────────
-- Expect exactly 12.
select count(*) as attr1_bundles_present
from public.card_extras
where card_id in ('g1-28a','g1-73a','xy10-111a','xy10-43a','xy4-65a',
                  'xy6-77a','xy7-75a','xy9-107a','xy9-98b','xyp-XY150a',
                  'xyp-XY177a','xyp-XY67a')
  and illustrator_override is not null;


-- ── V-1 / V-2 / V-3: per-row bundle shape and effective attribution ─────────
-- Expect 12 rows, artist_id_override NULL on every one, illustrator matching
-- the verified name exactly, effective artist_id NULL on every one.
select
  ce.id,
  x.illustrator_override,
  x.artist_id_override,
  ce.illustrator as effective_illustrator,
  ce.artist_id   as effective_artist_id,
  x.attribution_override_evidence ->> 'derivation'  as derivation,
  x.attribution_override_evidence ->> 'gate'         as gate,
  x.attribution_override_evidence ->> 'verified'     as verified_flag,
  x.attribution_override_approved_by
from public.cards_effective ce
join public.card_extras x on x.card_id = ce.id
where ce.id in ('g1-28a','g1-73a','xy10-111a','xy10-43a','xy4-65a',
                'xy6-77a','xy7-75a','xy9-107a','xy9-98b','xyp-XY150a',
                'xyp-XY177a','xyp-XY67a')
order by ce.id;

-- Expect every row TRUE.
select
  bool_and(x.artist_id_override is null)                                 as all_artist_id_override_null,
  bool_and(x.attribution_override_evidence    is not null)               as all_evidence_present,
  bool_and(x.attribution_override_approved_by is not null)                as all_approved_by_present,
  bool_and(x.attribution_override_approved_at is not null)                as all_approved_at_present,
  count(*)                                                                as row_count
from public.card_extras x
where x.card_id in ('g1-28a','g1-73a','xy10-111a','xy10-43a','xy4-65a',
                    'xy6-77a','xy7-75a','xy9-107a','xy9-98b','xyp-XY150a',
                    'xyp-XY177a','xyp-XY67a')
  and x.illustrator_override is not null;


-- ── V-5 / V-6: xyp-XY67a left sui, and sui dropped by exactly one ───────────
-- Expect xyp-XY67a's artist_id NULL (not 'sui').
select ce.id, ce.illustrator, ce.artist_id
from public.cards_effective ce
where ce.id = 'xyp-XY67a';

-- Expect 223 (224 - 1) after execution. Compare against the pre-migration
-- reading recorded in docs/attr-0-evidence/f15-repair-impact.csv / the
-- F-15_IMPLEMENTATION.md §19 post-F-15 baseline (224).
select count(*) as sui_effective_membership
from public.cards_effective ce
where ce.artist_id = 'sui';


-- ── V-7: raw public.cards is unchanged for all 12 targets ───────────────────
-- Expect the ORIGINAL, pre-repair (defective) raw values — unchanged by
-- ATTR-1, since the correction lives only in card_extras.
select c.id, c.illustrator, c.artist_id
from public.cards c
where c.id in ('g1-28a','g1-73a','xy10-111a','xy10-43a','xy4-65a',
              'xy6-77a','xy7-75a','xy9-107a','xy9-98b','xyp-XY150a',
              'xyp-XY177a','xyp-XY67a')
order by c.id;


-- ── V-9: no non-target row carries an ATTR-1-shaped bundle ──────────────────
-- Expect ZERO. This does not distinguish an ATTR-1 bundle from an F-15 legacy
-- bundle by content — it only proves no NEW bundle exists outside the 12
-- targets. The five pre-existing F-15 legacy rows (design §6.1) are expected
-- and unrelated to ATTR-1; if this count is non-zero, diff it against the
-- known five legacy card_ids before treating it as a regression.
select ce.card_id, ce.illustrator_override, ce.attribution_override_evidence ->> 'derivation' as derivation
from public.card_extras ce
where ce.illustrator_override is not null
  and ce.card_id not in ('g1-28a','g1-73a','xy10-111a','xy10-43a','xy4-65a',
                        'xy6-77a','xy7-75a','xy9-107a','xy9-98b','xyp-XY150a',
                        'xyp-XY177a','xyp-XY67a')
  and (ce.attribution_override_evidence ->> 'derivation') = 'attr-1-confirmed-repair';


-- ── V-10: F-15 constraints/admission invariants remain clean, table-wide ────
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

-- Expect 0.
select count(*) as ambiguous_admitted_overrides
from public.card_extras ce
where ce.illustrator_override is not null
  and (select count(*) from public.artists a
        where exists (
          select 1 from unnest(coalesce(a.aliases, array[]::text[])) al
          where lower(btrim(al)) = lower(btrim(ce.illustrator_override))
        )) > 1;


-- ── Illustrator-directory sanity: no name was destroyed ─────────────────────
-- Expect each corrected-FROM name to retain a large remaining population
-- (design §7.3 / f15-repair-impact.csv `losing_name_cards_remaining`).
select illustrator, count(*) as remaining
from public.cards_effective
where illustrator in ('Naoki Saito','Yusuke Ohmura','Ken Sugimori','PLANETA',
                      'Ayaka Yoshida','Eske Yoshinob','You Iribi','sui')
group by illustrator
order by illustrator;
