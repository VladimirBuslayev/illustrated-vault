-- docs/sql/attr-0-artist-attribution-audit.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- ATTR-0 — Artist attribution integrity audit
--
-- ⚠ READ ONLY. Every statement in this file is a SELECT. There is no INSERT,
--   UPDATE, DELETE, MERGE, DDL, GRANT, REVOKE, or DO block anywhere in it.
--   Nothing here writes, and nothing here needs approval to run.
--
-- WHY THIS FILE EXISTS
--   The repo-side half of ATTR-0 was answered from code and from a read-only
--   upstream probe (scripts/attr0-variant-attribution-probe.mjs). Neither can
--   see production. These queries are the figures of record for every count in
--   docs/ATTR-0_ARTIST_ATTRIBUTION_INTEGRITY_AUDIT.md §5 that is marked
--   "unmeasured".
--
--   Where the audit document states an upstream-derived number, this file
--   re-derives the same population against public.cards / cards_effective. The
--   two are expected to agree, because sync-cards.mjs :: mapCardToRow writes
--   `illustrator` verbatim from the provider with no cross-printing
--   inheritance — but "expected to agree" is a hypothesis, and A-3/A-6 below
--   are what test it.
--
-- SUFFIX VARIANT — the definition used throughout
--   A local_id ending in a single lowercase letter immediately after a digit:
--   `67a`, `98b`, `XY150a`. Anchored so set-namespace ids that merely end in
--   digits (`SV001`, `GG19`, `TG01`) never match.
--
--   Regex: '^(.*[0-9])([a-z])$'
--
-- HOW TO READ THE OUTPUT
--   Nothing in this file returns a verdict. A-3 and A-4 return a RISK
--   POPULATION: printings whose attribution is worth verifying. Membership is
--   not guilt. Do not repair anything on the strength of these queries alone —
--   see the audit document §8 for why illustrator_override cannot repair an
--   artist association at all.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION A — POPULATION BASELINE
-- ═══════════════════════════════════════════════════════════════════════════

-- A-1. Headline attribution coverage over the EFFECTIVE catalog.
--      CORRECTED INTERPRETATION (external review, 2026-08-20): do not read
--      `illustrator_present_artist_null` as "artist exists but is unreachable."
--      Most illustrator strings intentionally have no `artists` row at all — the
--      roster is a curated + user-tracked subset, not every credited name. This
--      column is illustrator-string-present-but-no-FK; it only becomes an Artist
--      Page reachability gap for the subset of those strings that resolve to an
--      actual/tracked artist row (that subset is what C-4 ranks).
select
  count(*)                                                          as effective_cards,
  count(*) filter (where illustrator is not null
                     and btrim(illustrator) <> '')                  as illustrator_present,
  count(*) filter (where illustrator is null
                     or btrim(illustrator) = '')                    as illustrator_null,
  count(*) filter (where artist_id is not null)                     as artist_id_present,
  count(*) filter (where artist_id is null)                         as artist_id_null,
  count(*) filter (where illustrator is not null
                     and btrim(illustrator) <> ''
                     and artist_id is null)                         as illustrator_present_artist_null,
  count(*) filter (where (illustrator is null or btrim(illustrator) = '')
                     and artist_id is not null)                     as illustrator_null_artist_present
from public.cards_effective;


-- A-2. The override channel. CAT-1 created 5 rows; CAT-3B.1 grew card_extras to
--      195, but only the image bundle was populated — `illustrator_override`
--      should still be 5. If `illustrator_overrides` is not 5, something wrote
--      illustrator enrichment outside a recorded slice.
select
  count(*)                                                     as card_extras_rows,
  count(*) filter (where illustrator_override is not null)     as illustrator_overrides,
  count(*) filter (where image_url_override is not null)       as image_overrides,
  count(*) filter (where source_note is not null)              as source_notes
from public.card_extras;


-- A-3. ⚑ THE RISK POPULATION — suffix-variant families in PRODUCTION.
--
--      One row per (base printing, suffix variant) pair inside one set. This is
--      the production-side re-derivation of
--      docs/attr-0-evidence/variant-family-attribution.csv.
--
--      Read `illustrator_match`:
--        SAME       — production asserts ONE illustrator across two printings.
--                     If the artworks genuinely differ, exactly one of the two
--                     attributions is wrong. THIS IS THE SUSPECT CLASS.
--        DIFFERENT  — production already differentiates them. Lower risk.
--        BOTH_NULL  — nothing attributed either way; no false association
--                     possible, but also no artist reachability.
with variants as (
  select
    ce.id, ce.set_id, ce.local_id, ce.name, ce.illustrator, ce.artist_id,
    (regexp_match(ce.local_id, '^(.*[0-9])([a-z])$'))[1] as base_local_id
  from public.cards_effective ce
  where ce.local_id ~ '^(.*[0-9])([a-z])$'
)
select
  v.set_id,
  v.base_local_id                                        as family,
  b.id                                                   as base_card_id,
  v.id                                                   as variant_card_id,
  b.name                                                 as base_name,
  v.name                                                 as variant_name,
  b.illustrator                                          as base_illustrator,
  v.illustrator                                          as variant_illustrator,
  b.artist_id                                            as base_artist_id,
  v.artist_id                                            as variant_artist_id,
  case
    when b.illustrator is null and v.illustrator is null           then 'BOTH_NULL'
    when b.illustrator is not distinct from v.illustrator          then 'SAME'
    else 'DIFFERENT'
  end                                                    as illustrator_match,
  (b.name is not distinct from v.name)                   as same_name
from variants v
join public.cards_effective b
  on b.set_id = v.set_id
 and b.local_id = v.base_local_id
order by v.set_id, v.base_local_id, v.local_id;


-- A-4. Suffix variants with NO base printing in the effective catalog.
--      Lower risk (there is no sibling to have inherited from) but still a
--      variant class, and still worth listing.
with variants as (
  select
    ce.id, ce.set_id, ce.local_id, ce.name, ce.illustrator, ce.artist_id,
    (regexp_match(ce.local_id, '^(.*[0-9])([a-z])$'))[1] as base_local_id
  from public.cards_effective ce
  where ce.local_id ~ '^(.*[0-9])([a-z])$'
)
select v.set_id, v.id as variant_card_id, v.local_id, v.name, v.illustrator, v.artist_id
from variants v
where not exists (
  select 1 from public.cards_effective b
  where b.set_id = v.set_id and b.local_id = v.base_local_id
)
order by v.set_id, v.local_id;


-- A-5. Summary counts for the two queries above, for §5 of the audit document.
with variants as (
  select
    ce.id, ce.set_id, ce.local_id, ce.illustrator,
    (regexp_match(ce.local_id, '^(.*[0-9])([a-z])$'))[1] as base_local_id
  from public.cards_effective ce
  where ce.local_id ~ '^(.*[0-9])([a-z])$'
),
paired as (
  select v.*, b.illustrator as base_illustrator, (b.id is not null) as has_base
  from variants v
  left join public.cards_effective b
    on b.set_id = v.set_id and b.local_id = v.base_local_id
)
select
  count(*)                                                                   as suffix_variant_rows,
  count(*) filter (where has_base)                                           as with_base_printing,
  count(*) filter (where not has_base)                                       as lone_variants,
  count(*) filter (where has_base
                     and illustrator is not distinct from base_illustrator
                     and illustrator is not null)                            as same_illustrator_families,
  count(*) filter (where has_base
                     and illustrator is distinct from base_illustrator)       as differing_illustrator_families,
  count(*) filter (where has_base
                     and illustrator is null and base_illustrator is null)    as both_null_families
from paired;


-- A-6. THE SEED CASE. Full production state for the Jirachi pair.
--      Shows raw vs effective vs override vs FK in one row each, so the
--      divergence surface is visible without cross-referencing.
select
  c.id,
  c.local_id,
  c.name,
  c.illustrator                                   as raw_illustrator,
  ce.illustrator_override                         as override_illustrator,
  eff.illustrator                                 as effective_illustrator,
  c.artist_id                                     as raw_artist_id,
  eff.artist_id                                   as effective_artist_id,
  (eff.id is not null)                            as in_effective_catalog,
  c.image_url                                     as raw_image_url,
  eff.image_url                                   as effective_image_url,
  c.last_synced_at
from public.cards c
left join public.card_extras ce      on ce.card_id = c.id
left join public.cards_effective eff on eff.id = c.id
where c.id in ('xyp-XY67', 'xyp-XY67a')
order by c.id;


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION B — F-15: OVERRIDE / FK DIVERGENCE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- CAT-0 F-15: cards_effective COALESCEs illustrator_override into `illustrator`
-- but takes `artist_id` straight from cards.artist_id. An override therefore
-- changes what is DISPLAYED and never what the card is FILED UNDER.
--
-- F-15 was downgraded to P3 with an explicit trigger: "if card_extras were ever
-- used at scale — for example as a durable channel for illustrator enrichment —
-- this becomes P1 immediately." An artist-attribution repair is exactly that
-- use. B-1 and B-2 measure the divergence that already exists.

-- B-1. Every illustrator override, with the FK it does NOT affect.
--      `fk_matches_effective` = does artist_id agree with the artist the
--      EFFECTIVE illustrator string resolves to?  false ⇒ the card displays one
--      artist and is filed under another.
select
  ce.card_id,
  c.illustrator                          as raw_illustrator,
  ce.illustrator_override                as override_illustrator,
  eff.illustrator                        as effective_illustrator,
  c.artist_id                            as artist_id,
  a_eff.id                               as artist_id_the_effective_string_resolves_to,
  (c.artist_id is not distinct from a_eff.id) as fk_matches_effective,
  ce.source_note
from public.card_extras ce
join public.cards c                on c.id = ce.card_id
left join public.cards_effective eff on eff.id = ce.card_id
left join public.artists a_eff
  on exists (
       select 1 from unnest(a_eff.aliases) al
       where lower(btrim(al)) = lower(btrim(eff.illustrator))
     )
where ce.illustrator_override is not null
order by ce.card_id;


-- B-2. Count of contradictory override/FK pairs. CAT-0 measured this as ZERO
--      across 5 rows. Any non-zero result is a live F-15 P1 escalation.
select
  count(*)                                                             as illustrator_override_rows,
  count(*) filter (where c.artist_id is not null)                      as with_artist_id,
  count(*) filter (
    where c.artist_id is not null
      and not exists (
        select 1 from public.artists a, unnest(a.aliases) al
        where a.id = c.artist_id
          and lower(btrim(al)) = lower(btrim(coalesce(ce.illustrator_override, c.illustrator)))
      )
  )                                                                    as contradictory_override_fk_pairs
from public.card_extras ce
join public.cards c on c.id = ce.card_id
where ce.illustrator_override is not null;


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION C — ALIAS COLLAPSE AND DIRECTORY CONSISTENCY
-- ═══════════════════════════════════════════════════════════════════════════
--
-- resolveArtistId() is an EXACT lookup on lower(btrim(illustrator)) against
-- artists.aliases. It is not fuzzy, so it cannot invent a match. The risk is
-- therefore not the matcher — it is the CONTENT of artists.aliases. One alias
-- string listed under two artists collapses two identities into whichever row
-- the sync's Map saw last.

-- C-1. ⚑ Alias strings claimed by more than one artist. MUST return zero rows.
--      A non-empty result means artist attribution is non-deterministic: the
--      winner depends on row order in loadArtistAliasMap().
select
  lower(btrim(al))                       as normalized_alias,
  count(distinct a.id)                   as artist_count,
  array_agg(distinct a.id order by a.id) as artist_ids
from public.artists a, unnest(a.aliases) al
where btrim(al) <> ''
group by lower(btrim(al))
having count(distinct a.id) > 1
order by artist_count desc, normalized_alias;


-- C-2. Dangerously short / generic alias strings. Not defects on their own —
--      resolveArtistId is exact, so a short alias is only a hazard if it
--      exactly equals another artist's real name. Listed for human review.
select a.id as artist_id, al as alias, length(btrim(al)) as alias_length
from public.artists a, unnest(a.aliases) al
where length(btrim(al)) <= 4 and btrim(al) <> ''
order by alias_length, a.id;


-- C-3. Illustrator strings carrying MORE THAN ONE artist_id in the effective
--      catalog. illustrator_directory does `max(artist_id) group by illustrator`,
--      so any such string is silently collapsed in the directory. Expect zero.
select
  illustrator,
  count(distinct artist_id)                       as distinct_artist_ids,
  array_agg(distinct artist_id order by artist_id) as artist_ids,
  count(*)                                        as card_count
from public.cards_effective
where illustrator is not null and btrim(illustrator) <> ''
group by illustrator
having count(distinct artist_id) > 1
order by distinct_artist_ids desc, card_count desc;


-- C-4. Illustrator strings that resolve to NO artist_id anywhere, ranked by how
--      many cards they carry. This is the "artist exists but is unreachable"
--      population — a coverage gap, not a false association. Top 50.
select
  illustrator,
  count(*) as card_count
from public.cards_effective
where illustrator is not null
  and btrim(illustrator) <> ''
  and artist_id is null
group by illustrator
order by card_count desc, illustrator
limit 50;


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION D — ADJACENT RISK CLASSES
-- ═══════════════════════════════════════════════════════════════════════════

-- D-1. Same set + same card name + more than one printing, where those
--      printings do NOT all share one illustrator. Catches variant conventions
--      other than the lowercase-suffix one (reprints, alternate numbering).
select
  set_id,
  name,
  count(*)                                         as printings,
  count(distinct illustrator)                      as distinct_illustrators,
  array_agg(local_id order by local_id)            as local_ids,
  array_agg(distinct illustrator)                  as illustrators
from public.cards_effective
where illustrator is not null and btrim(illustrator) <> ''
group by set_id, name
having count(*) > 1 and count(distinct illustrator) > 1
order by printings desc, set_id, name;


-- D-2. Same set + same name + multiple printings that DO all share one
--      illustrator. This is the broader analogue of A-3's SAME class: if any of
--      these are genuinely different artwork, they carry the same risk.
--      Expected to be large — most are legitimate reprints of one artwork.
select
  set_id,
  name,
  count(*)                              as printings,
  min(illustrator)                      as illustrator,
  array_agg(local_id order by local_id) as local_ids
from public.cards_effective
where illustrator is not null and btrim(illustrator) <> ''
group by set_id, name
having count(*) > 1 and count(distinct illustrator) = 1
order by printings desc, set_id, name
limit 100;


-- D-3. Raw vs effective illustrator divergence across the whole catalog.
--      Should equal exactly the illustrator_override population (A-2).
select count(*) as rows_where_raw_and_effective_illustrator_differ
from public.cards c
join public.cards_effective ce on ce.id = c.id
where c.illustrator is distinct from ce.illustrator;


-- D-4. Artist Page membership impact, per roster artist, split by RUNTIME PATH.
--
--      CORRECTED (external review, 2026-08-20): `cardService.fetchArtistCards`
--      has two distinct branches, confirmed against
--      src/services/cardService.js and src/constants/artists.js as committed:
--        CURATED  — the 20 artistId slugs hardcoded in src/constants/artists.js.
--                   Runtime query is an exact `.eq('artist_id', entry.artistId)`
--                   ONLY. For a curated artist, `displayed_but_not_filed` is a
--                   REAL leak: the card is on-catalog under this illustrator but
--                   the FK path never returns it.
--        DYNAMIC  — every other `public.artists` row (added via
--                   add_artist_to_archive / user_tracked_artists). Runtime query
--                   is `artist_id.eq.<id> OR illustrator.in.(<exact names/
--                   aliases>)`, so a DYNAMIC artist's `displayed_but_not_filed`
--                   rows are already reachable through the illustrator branch of
--                   the SAME query — this is FK-tagging incompleteness /
--                   dynamic-fallback reliance, not a current visible membership
--                   failure. Do not report it as one.
--
--      `member_cards` is what the FK path alone returns
--      (`.eq('artist_id', ...)`).
with curated_artist_ids as (
  select unnest(array[
    'yuka-morii','asako-ito','tomokazu-komiya','shinji-kanda','atsuko-nishida',
    'sowsow','shibuzoh','yukiko-baba','sui','akira-egawa','kouki-saitou',
    'saya-tsuruta','okacheke','0313','gossan','mizue','kayama','gapao',
    'okubo','fukuda'
  ]) as artist_id
)
select
  a.id                                                            as artist_id,
  (a.id in (select artist_id from curated_artist_ids))            as is_curated,
  count(ce.id) filter (where ce.artist_id = a.id)                 as member_cards,
  count(ce.id) filter (
    where ce.artist_id is distinct from a.id
      and exists (
        select 1 from unnest(a.aliases) al
        where lower(btrim(al)) = lower(btrim(ce.illustrator))
      )
  )                                                               as displayed_but_not_filed
from public.artists a
left join public.cards_effective ce
  on ce.artist_id = a.id
  or exists (
       select 1 from unnest(a.aliases) al
       where lower(btrim(al)) = lower(btrim(ce.illustrator))
     )
group by a.id
order by is_curated desc, member_cards desc, a.id;


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION E — OWNERSHIP EXPOSURE OF THE RISK POPULATION
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠ E-1 is auth.uid()-scoped and returns nothing useful in a SQL Editor session
--   without a JWT context. It is included so the ownership question is asked in
--   the same file, not because it can be answered unauthenticated. Establish
--   `request.jwt.claims` first if this figure is needed — see
--   docs/sql/cat-2d1-2-dark-alias-validation.sql P1 for the pattern.
--
-- Interpretation: a suspect attribution on a card nobody owns is a browse-surface
-- defect. A suspect attribution on an OWNED card also distorts per-artist
-- collection counts, which is the artist-first product's core number.

-- E-1. How many suffix-variant printings are in the caller's active snapshot?
with variants as (
  select ce.id
  from public.cards_effective ce
  where ce.local_id ~ '^(.*[0-9])([a-z])$'
)
select
  count(*)                                    as owned_suffix_variant_rows,
  count(distinct r.card_id)                   as distinct_owned_variant_cards
from public.user_import_rows r
join public.user_import_batches b
  on b.id = r.batch_id and b.status = 'active'
join variants v
  on v.id = coalesce(
       (select res.canonical_card_id
          from public.card_identity_resolution res
         where res.alias_card_id = r.card_id),
       r.card_id)
where r.match_status = 'matched'
  and r.card_id is not null
  and b.user_id = auth.uid();


-- E-2. Unauthenticated alternative: are any suffix variants force-owned or
--      force-missing via card_overrides? Aggregate only — no user id is
--      selected, so this is safe to run and safe to paste into a review.
with variants as (
  select ce.id
  from public.cards_effective ce
  where ce.local_id ~ '^(.*[0-9])([a-z])$'
)
select
  o.override_type,
  count(*)                        as override_rows,
  count(distinct o.card_id)       as distinct_cards
from public.card_overrides o
join variants v on v.id = o.card_id
group by o.override_type
order by o.override_type;


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION F — CONTAINMENT SELF-CHECK
-- ═══════════════════════════════════════════════════════════════════════════

-- F-1. Confirms the catalog totals this audit assumes, so a reviewer can tell
--      at a glance whether the audit was written against the same catalog they
--      are looking at. Expected at ATTR-0 time: cards 23,780 ·
--      cards_effective 23,588 · aliases 192 · card_extras 195.
select
  (select count(*) from public.cards)                    as raw_cards,
  (select count(*) from public.cards_effective)          as effective_cards,
  (select count(*) from public.card_identity_resolution) as alias_rows,
  (select count(*) from public.card_extras)              as card_extras_rows;
