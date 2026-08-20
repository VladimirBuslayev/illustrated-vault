-- docs/sql/cat-3b1-0-gate0.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- CAT-3B.1 — Approved Alias Image Activation — GATE 0
--
-- READ-ONLY DECISION EVIDENCE. THIS FILE WRITES NOTHING.
--
-- Full document: docs/CAT-3B.1_ALIAS_IMAGE_ACTIVATION.md
--
-- ─────────────────────────────────────────────────────────────────────────
-- ✅ STATUS: EXECUTED READ-ONLY AGAINST PRODUCTION — 2026-08-20
-- ─────────────────────────────────────────────────────────────────────────
-- Executed through the read-only Supabase MCP connection, authenticated as
-- role `supabase_read_only_user` against PostgreSQL 17.6. That role cannot
-- write, so the read-only property of this slice is enforced by the
-- connection itself and not merely by the text below.
--
-- Recorded results: docs/CAT-3B.1_ALIAS_IMAGE_ACTIVATION.md §4-§11.
--
-- ⚠ THIS FILE CONTAINS NO INSERT, UPDATE, DELETE, MERGE, TRUNCATE, DDL, DCL,
--   OR MUTATING RPC. Every statement is a SELECT. It is safe to re-run at any
--   time and produces no side effects.
--
-- ⚠ GATE 0 DOES NOT AUTHORIZE A WRITE. It establishes the population that a
--   SEPARATELY APPROVED activation slice would act on. Creating override rows
--   is out of scope here, exactly as creating them was out of scope for
--   CAT-3B itself.
--
-- ─────────────────────────────────────────────────────────────────────────
-- WHY THE SELECTOR IS DERIVED, NOT REMEMBERED
-- ─────────────────────────────────────────────────────────────────────────
-- CAT-3A measured 192 approved pairs with a live retained source asset. That
-- number is HISTORY, not a selector. Every query below derives its population
-- from public.card_identity_resolution and current live catalog state, so the
-- answer is whatever production says today. The historical figure is used for
-- RECONCILIATION ONLY — to explain a delta, never to produce one.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- G0-0. Connection and deployment identity
-- ═══════════════════════════════════════════════════════════════════════════
-- Establishes that evidence was gathered read-only, and pins the server.

select current_database() as db,
       current_user      as connected_role,
       version()         as pg_version,
       now()             as gathered_at;


-- ═══════════════════════════════════════════════════════════════════════════
-- G0-1. Approved relationship population
-- ═══════════════════════════════════════════════════════════════════════════
--
-- public.card_identity_aliases has NO status column: approved_by, approved_at
-- and evidence are all NOT NULL, so PRESENCE IN THE TABLE *IS* APPROVAL. There
-- is no pending/rejected state to filter out, and therefore no way for an
-- unapproved relationship to leak into this population.
--
-- Direction is alias -> canonical. The CAT-3B trigger reads it in exactly that
-- direction (r.alias_card_id = source, r.canonical_card_id = target), so the
-- image flows FROM the retired printing TO the surviving one.
--
-- Depth-one is not an assumption here, it is a measured property:
-- canonical_is_also_alias_chain = 0 means no canonical_card_id appears as an
-- alias_card_id anywhere, so no chain exists to resolve transitively and no
-- cycle can form.

select
  (select count(*) from public.card_identity_aliases)                as alias_rows_total,
  (select count(*) from public.card_identity_resolution)             as resolution_rows,
  (select count(distinct alias_card_id)     from public.card_identity_aliases) as distinct_alias,
  (select count(distinct canonical_card_id) from public.card_identity_aliases) as distinct_canonical,
  (select count(*) from public.card_identity_aliases
     where alias_card_id = canonical_card_id)                        as self_alias,
  -- chain: a canonical that is itself somebody's alias
  (select count(*) from public.card_identity_aliases a
     where exists (select 1 from public.card_identity_aliases b
                    where b.alias_card_id = a.canonical_card_id))    as canonical_is_also_alias_chain,
  -- 2-cycle: a <-> b
  (select count(*) from public.card_identity_aliases a
     join public.card_identity_aliases b
       on b.alias_card_id = a.canonical_card_id
      and b.canonical_card_id = a.alias_card_id)                     as two_cycles,
  (select count(*) from public.card_identity_aliases a
     where not exists (select 1 from public.cards c where c.id = a.alias_card_id))     as alias_row_missing_in_cards,
  (select count(*) from public.card_identity_aliases a
     where not exists (select 1 from public.cards c where c.id = a.canonical_card_id)) as canonical_missing_in_cards,
  (select count(*) from public.card_identity_aliases a
     where not exists (select 1 from public.cards_effective e where e.id = a.canonical_card_id)) as canonical_not_in_effective;

-- Provenance of the population: which slice admitted it, and when.
select slice, family, count(*) as n,
       min(approved_at) as first_approved,
       max(approved_at) as last_approved,
       count(distinct approved_by) as distinct_approvers
from public.card_identity_aliases
group by slice, family
order by slice, family;

-- Structural correspondence of the rename. Not required for admission, but it
-- is the cheapest independent corroboration that these are the same printing:
-- the local_id is preserved and only the set namespace moved.
select split_part(r.alias_card_id, '-', 1)     as source_set,
       split_part(r.canonical_card_id, '-', 1) as target_set,
       count(*) as n
from public.card_identity_resolution r
group by 1, 2
order by 1;

-- Field-level agreement across the pair. illustrator is EXPECTED to differ in
-- one direction only: the surviving row may carry an illustrator the retired
-- row lacks. `both_set_but_differ` must be 0 — two different named artists on
-- the two rows would be evidence AGAINST same-printing identity.
select count(*) as pairs,
  count(*) filter (where sc.name     =  tc.name)                    as name_match,
  count(*) filter (where sc.local_id =  tc.local_id)                as local_id_match,
  count(*) filter (where sc.rarity   is not distinct from tc.rarity) as rarity_match,
  count(*) filter (where sc.illustrator is not distinct from tc.illustrator) as illustrator_match,
  count(*) filter (where tc.illustrator is not null and sc.illustrator is null) as target_richer_illustrator,
  count(*) filter (where tc.illustrator is not null and sc.illustrator is not null
                     and tc.illustrator <> sc.illustrator)          as both_set_but_differ,
  -- the source image is the source's OWN derived TCGdex identity path,
  -- i.e. nothing was borrowed from a third printing
  count(*) filter (where sc.image_url = 'https://assets.tcgdex.net/en/swsh/'
                                      || sc.set_id || '/' || sc.local_id) as url_is_own_identity
from public.card_identity_resolution r
join public.cards sc on sc.id = r.alias_card_id
join public.cards tc on tc.id = r.canonical_card_id;


-- ═══════════════════════════════════════════════════════════════════════════
-- G0-2 / G0-3 / G0-4. Source availability, target need, channel cleanliness
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The shape predicate below is a VERBATIM copy of the deployed
-- card_extras_image_override_shape CHECK constraint. It is reproduced rather
-- than approximated on purpose: a looser local rule would report candidates
-- that the admission wall would then reject.

with rel as (
  select r.alias_card_id as src, r.canonical_card_id as tgt
  from public.card_identity_resolution r
),
j as (
  select rel.src, rel.tgt,
         sc.image_url as src_raw,
         tc.image_url as tgt_raw,
         te.image_url as tgt_eff,
         (te.id is not null) as tgt_in_effective,
         (sc.id is not null) as src_row_exists,
         (ce.card_id is not null) as has_extras_row,
         ce.image_url_override
  from rel
  left join public.cards           sc on sc.id = rel.src
  left join public.cards           tc on tc.id = rel.tgt
  left join public.cards_effective te on te.id = rel.tgt
  left join public.card_extras     ce on ce.card_id = rel.tgt
)
select
  count(*) as relationships,
  -- G0-2 source asset availability
  count(*) filter (where src_row_exists)                              as src_row_exists,
  count(*) filter (where src_raw is not null and btrim(src_raw) <> '') as src_has_image,
  count(*) filter (where src_raw is null or btrim(src_raw) = '')       as src_no_image,
  count(*) filter (where src_raw is not null
                     and src_raw = btrim(src_raw)
                     and src_raw ~  '^https://assets\.tcgdex\.net/[^[:space:]]+$'
                     and src_raw !~ '/$'
                     and src_raw !~* '\.(png|jpe?g|webp|gif|avif|svg)$') as src_shape_ok,
  -- G0-3 target need
  count(*) filter (where tgt_in_effective)          as tgt_in_effective,
  count(*) filter (where tgt_raw is null)           as tgt_raw_null,
  count(*) filter (where tgt_eff is null)           as tgt_eff_null,
  count(*) filter (where tgt_eff is not null)       as tgt_already_has_image,
  -- G0-4 collision surface
  count(*) filter (where has_extras_row)            as tgt_has_extras_row,
  count(*) filter (where image_url_override is not null) as tgt_has_override,
  count(*) filter (where src <> tgt)                as src_ne_tgt
from j;

-- G0-4 channel cleanliness across the WHOLE table, not just this population.
-- An override anywhere else would still be an unexplained curated pixel.
select
  count(*) as card_extras_rows,
  count(*) filter (where image_url_override            is not null) as with_override_url,
  count(*) filter (where image_override_source_card_id is not null) as with_source,
  count(*) filter (where image_override_evidence       is not null) as with_evidence,
  count(*) filter (where image_override_approved_by    is not null) as with_approved_by,
  count(*) filter (where image_override_approved_at    is not null) as with_approved_at,
  count(*) filter (where image_url_override is not null
                    and image_override_source_card_id is not null
                    and image_override_evidence       is not null
                    and image_override_approved_by    is not null
                    and image_override_approved_at    is not null) as complete_bundles,
  count(*) filter (where (image_url_override is not null
                       or image_override_source_card_id is not null
                       or image_override_evidence       is not null
                       or image_override_approved_by    is not null
                       or image_override_approved_at    is not null)
                    and not (image_url_override is not null
                         and image_override_source_card_id is not null
                         and image_override_evidence       is not null
                         and image_override_approved_by    is not null
                         and image_override_approved_at    is not null)) as partial_bundles
from public.card_extras;

-- The existing card_extras rows, and whether each collides with this
-- population. A colliding row must be modified in place, never upserted
-- wholesale: illustrator_override and source_note on it are prior CAT-1
-- enrichment and must survive untouched.
select ce.card_id,
       (ce.illustrator_override is not null) as has_illustrator_override,
       (ce.source_note          is not null) as has_source_note,
       (ce.image_url_override   is not null) as has_image_override,
       (r.canonical_card_id     is not null) as is_cat3b1_target
from public.card_extras ce
left join public.card_identity_resolution r on r.canonical_card_id = ce.card_id
order by ce.card_id;


-- ═══════════════════════════════════════════════════════════════════════════
-- G0-5. Deployed admission equivalence
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Compare LIVE production definitions against the repo-tracked CAT-3B
-- implementation in docs/sql/cat-3b-1-durable-image-override.sql. Any material
-- difference is a STOP condition: Gate 0 would then be reasoning about a wall
-- that production does not actually enforce.

select conname, pg_get_constraintdef(oid) as def
from pg_constraint
where conrelid = 'public.card_extras'::regclass
order by conname;

select p.proname,
       p.prosecdef as is_security_definer,   -- must be false (SECURITY INVOKER)
       pg_get_functiondef(p.oid) as def
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'card_extras_admit_image_override';

select t.tgname, t.tgenabled, pg_get_triggerdef(t.oid) as def
from pg_trigger t
where t.tgrelid = 'public.card_extras'::regclass
  and not t.tgisinternal;

-- cards_effective must still be the single COALESCE, still excluding aliases.
select pg_get_viewdef('public.cards_effective'::regclass, true)          as cards_effective_def;
select pg_get_viewdef('public.card_identity_resolution'::regclass, true) as resolution_def;

-- Per-candidate rehearsal of the deployed wall. Each k* column is one
-- admission requirement. fully_qualified must equal the candidate count.
with rel as (
  select r.alias_card_id as src, r.canonical_card_id as tgt
  from public.card_identity_resolution r
),
c as (
  select rel.src, rel.tgt,
         sc.image_url as src_raw,
         tc.image_url as tgt_raw,
         te.image_url as tgt_eff,
         ce.card_id   as extras_card_id,
         ce.image_url_override
  from rel
  left join public.cards           sc on sc.id = rel.src
  left join public.cards           tc on tc.id = rel.tgt
  left join public.cards_effective te on te.id = rel.tgt
  left join public.card_extras     ce on ce.card_id = rel.tgt
),
chk as (
  select c.*,
    (src is not null and tgt is not null)  as k01_ids_present,
    (src <> tgt)                           as k02_src_ne_tgt,          -- source_not_self CHECK
    exists (select 1 from public.card_identity_resolution r
             where r.alias_card_id = c.src and r.canonical_card_id = c.tgt) as k03_approved_rel, -- trigger R2
    (src_raw is not null and btrim(src_raw) <> '')                     as k04_src_has_image,     -- trigger R3a
    (src_raw =  btrim(src_raw)
      and src_raw ~  '^https://assets\.tcgdex\.net/[^[:space:]]+$'
      and src_raw !~ '/$'
      and src_raw !~* '\.(png|jpe?g|webp|gif|avif|svg)$')               as k05_shape_ok,          -- shape CHECK
    (tgt_raw is null)                      as k06_tgt_raw_null,
    (tgt_eff is null)                      as k07_tgt_eff_null,        -- target genuinely needs it
    (image_url_override is null)           as k08_no_existing_override,
    exists (select 1 from public.cards_effective e where e.id = c.tgt)  as k09_tgt_in_effective,
    exists (select 1 from public.cards x where x.id = c.src)            as k10_src_row_exists     -- source FK
  from c
)
select count(*) as candidates,
  count(*) filter (where k01_ids_present)          as k01,
  count(*) filter (where k02_src_ne_tgt)           as k02,
  count(*) filter (where k03_approved_rel)         as k03,
  count(*) filter (where k04_src_has_image)        as k04,
  count(*) filter (where k05_shape_ok)             as k05,
  count(*) filter (where k06_tgt_raw_null)         as k06,
  count(*) filter (where k07_tgt_eff_null)         as k07,
  count(*) filter (where k08_no_existing_override) as k08,
  count(*) filter (where k09_tgt_in_effective)     as k09,
  count(*) filter (where k10_src_row_exists)       as k10,
  count(*) filter (where k01_ids_present and k02_src_ne_tgt and k03_approved_rel
                     and k04_src_has_image and k05_shape_ok and k06_tgt_raw_null
                     and k07_tgt_eff_null and k08_no_existing_override
                     and k09_tgt_in_effective and k10_src_row_exists) as fully_qualified,
  -- G0-7 blast radius, same scan
  count(*) filter (where extras_card_id is not null) as would_touch_existing_row,
  count(*) filter (where extras_card_id is null)     as would_create_new_row,
  count(distinct tgt)     as distinct_targets,
  count(distinct src)     as distinct_sources,
  count(distinct src_raw) as distinct_source_urls   -- must equal candidates: no URL reuse
from chk;

-- Note on trigger rule R3 (override = source's CURRENT image_url at admission
-- time): it is satisfied BY CONSTRUCTION, because the proposed override value
-- IS `cards.image_url` of the source, read in the same statement that would
-- write it. It is therefore not expressible as a separate k* check here — an
-- activation slice must SELECT the value rather than carry a literal, and that
-- is a property of how the write is authored, not of the current data.


-- ═══════════════════════════════════════════════════════════════════════════
-- G0-6. Active-owned collector impact
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠ OWNERSHIP AUTHORITY. This reproduces, in read-only SQL, the resolution
--   performed by the deployed SECURITY DEFINER function
--   public.get_active_snapshot_owned_card_ids() (CAT-2D.1 body), plus the
--   force-owned / force-missing layer from public.card_overrides.
--
--   The RPC itself cannot be called here: it derives its user from auth.uid(),
--   which is null on this connection. The projection below is the same logic
--   applied to the same tables.
--
--   NO owned_keys fallback. NO inference of ownership across printings or
--   languages: alias resolution collapses an id onto its canonical survivor
--   only where CAT-2D.2 already admitted the two as the SAME physical card.

with active as (
  select b.id as batch_id
  from public.user_import_batches b
  where b.status = 'active'
),
snap as (   -- active snapshot, canonicalised
  select distinct coalesce(res.canonical_card_id, r.card_id) as card_id
  from public.user_import_rows r
  join active a on a.batch_id = r.batch_id
  left join public.card_identity_resolution res on res.alias_card_id = r.card_id
  where r.match_status = 'matched'
    and r.card_id is not null
),
fo as (select distinct card_id from public.card_overrides where override_type = 'owned'),
fm as (select distinct card_id from public.card_overrides where override_type = 'missing'),
owned as (
  select card_id
  from (select card_id from snap union select card_id from fo) u
  where card_id not in (select card_id from fm)
),
owned_eff as (
  select e.id, e.image_url
  from public.cards_effective e
  join owned o on o.card_id = e.id
),
cand as (select r.canonical_card_id as tgt from public.card_identity_resolution r)
select
  (select count(*) from snap)      as snapshot_resolved_ids,
  (select count(*) from owned)     as owned_ids_total,
  (select count(*) from owned_eff) as owned_in_effective,
  (select count(*) from owned o
     where not exists (select 1 from public.cards_effective e where e.id = o.card_id)) as owned_not_in_effective,
  (select count(*) from owned_eff where image_url is null)     as owned_missing_image,
  (select count(*) from owned_eff where image_url is not null) as owned_has_image,
  (select count(*) from owned_eff oe join cand on cand.tgt = oe.id)                            as owned_intersect_candidates,
  (select count(*) from owned_eff oe join cand on cand.tgt = oe.id where oe.image_url is null) as owned_missing_image_fixable;

-- Why the active-owned denominator moved vs CAT-3A. v1 is the snapshot ALONE
-- (CAT-3A's basis); v4 is the full authority mandated for CAT-3B.1.
with active as (select id as batch_id from public.user_import_batches where status = 'active'),
snap as (
  select distinct coalesce(res.canonical_card_id, r.card_id) as card_id
  from public.user_import_rows r
  join active a on a.batch_id = r.batch_id
  left join public.card_identity_resolution res on res.alias_card_id = r.card_id
  where r.match_status = 'matched' and r.card_id is not null),
snap_raw as (
  select distinct r.card_id
  from public.user_import_rows r join active a on a.batch_id = r.batch_id
  where r.match_status = 'matched' and r.card_id is not null),
fo as (select distinct card_id from public.card_overrides where override_type = 'owned'),
fm as (select distinct card_id from public.card_overrides where override_type = 'missing')
select
  (select count(*) from public.cards_effective e join snap s     on s.card_id = e.id where e.image_url is null) as v1_snapshot_resolved_only,
  (select count(*) from public.cards_effective e join snap_raw s on s.card_id = e.id where e.image_url is null) as v2_snapshot_unresolved,
  (select count(*) from public.cards_effective e
     where e.image_url is null
       and e.id in (select card_id from snap union select card_id from fo)) as v3_plus_forced_owned,
  (select count(*) from public.cards_effective e
     where e.image_url is null
       and e.id in (select card_id from snap union select card_id from fo)
       and e.id not in (select card_id from fm)) as v4_full_authority,
  (select count(*) from public.cards_effective e
     join fo on fo.card_id = e.id
     where e.image_url is null
       and e.id not in (select card_id from snap)) as forced_owned_only_missing_img;

-- Do the force-owned / force-missing layers touch the candidate set at all?
with snap as (
  select distinct coalesce(res.canonical_card_id, r.card_id) as card_id
  from public.user_import_rows r
  join public.user_import_batches b on b.id = r.batch_id and b.status = 'active'
  left join public.card_identity_resolution res on res.alias_card_id = r.card_id
  where r.match_status = 'matched' and r.card_id is not null),
fo as (select distinct card_id from public.card_overrides where override_type = 'owned'),
fm as (select distinct card_id from public.card_overrides where override_type = 'missing'),
cand as (select canonical_card_id as tgt from public.card_identity_resolution)
select
  (select count(*) from cand where tgt in (select card_id from snap)) as cand_in_snapshot,
  (select count(*) from cand where tgt in (select card_id from fo))   as cand_force_owned,
  (select count(*) from cand where tgt in (select card_id from fm))   as cand_force_missing,
  (select count(*) from cand
     where tgt in (select card_id from snap union select card_id from fo)
       and tgt not in (select card_id from fm))                       as cand_active_owned;

-- Per-set distribution of the candidate population and its owned share.
select split_part(r.canonical_card_id, '-', 1) as target_set,
       count(*) as candidates,
       count(*) filter (where r.canonical_card_id in (
         select distinct coalesce(res.canonical_card_id, ur.card_id)
         from public.user_import_rows ur
         join public.user_import_batches b on b.id = ur.batch_id and b.status = 'active'
         left join public.card_identity_resolution res on res.alias_card_id = ur.card_id
         where ur.match_status = 'matched' and ur.card_id is not null)) as active_owned
from public.card_identity_resolution r
group by 1
order by 1;


-- ═══════════════════════════════════════════════════════════════════════════
-- G0-7. Predicted blast radius
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Global "before" figures. The predicted "after" values are arithmetic on
-- these, stated in the Gate 0 document; nothing here simulates a write.
--
-- Note raw_missing_image and effective_missing_image are EXPECTED to be equal:
-- every excluded alias row currently HAS an image, so the alias exclusion
-- removes no gaps from the effective count.

select
  (select count(*) from public.cards)                                  as raw_cards,
  (select count(*) from public.cards_effective)                        as effective_cards,
  (select count(*) from public.cards where image_url is null)          as raw_missing_image,
  (select count(*) from public.cards_effective where image_url is null) as effective_missing_image;

-- Containment: a future write must change ONLY canonical image values.
-- Every candidate target currently resolves its effective image from
-- cards.image_url = NULL, so a COALESCE override changes NULL -> value and can
-- displace no existing pixel. This is that claim, measured.
select count(*) as candidates_whose_effective_image_is_currently_null
from public.card_identity_resolution r
join public.cards_effective e on e.id = r.canonical_card_id
where e.image_url is null;


-- ═══════════════════════════════════════════════════════════════════════════
-- G0-8. Provenance contract — SHAPE ONLY, NOTHING POPULATED
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Renders the EXACT evidence payload a later, separately approved activation
-- slice would store, for every candidate — without writing any of it. This is
-- a SELECT that projects a jsonb value; it does not touch card_extras.
--
-- Reviewability is the point: the payload is derived entirely from
-- card_identity_aliases and cards, so it can be recomputed and diffed against
-- what was stored, forever.
--
-- ⚠ The `would_be_*` column aliases are deliberate. Nothing here is assigned
--   to a card_extras column; this projection is evidence for review only.

select
  r.canonical_card_id as would_be_card_id,
  sc.image_url        as would_be_image_url_override,
  r.alias_card_id     as would_be_image_override_source_card_id,
  'CAT-3B.1 approved alias image activation — docs/CAT-3B.1_ALIAS_IMAGE_ACTIVATION.md'
                      as would_be_image_override_approved_by,
  jsonb_build_object(
    'slice',              'CAT-3B.1',
    'basis',              'cat-2d2-approved-same-printing-alias',
    'alias_slice',         a.slice,
    'alias_family',        a.family,
    'alias_approved_at',   a.approved_at,
    'source_card_id',      r.alias_card_id,
    'source_image_url_at_admission',     sc.image_url,
    'target_raw_image_url_at_admission', tc.image_url,
    'gate',                'CAT-3B.1 Gate 0',
    'gate_evidence',       'docs/sql/cat-3b1-0-gate0.sql'
  ) as would_be_image_override_evidence
from public.card_identity_resolution r
join public.card_identity_aliases a on a.alias_card_id = r.alias_card_id
join public.cards sc on sc.id = r.alias_card_id
join public.cards tc on tc.id = r.canonical_card_id
order by r.canonical_card_id
limit 5;   -- shape demonstration; the full set is the same projection unlimited


-- ═══════════════════════════════════════════════════════════════════════════
-- END — no statement above mutates anything.
-- ═══════════════════════════════════════════════════════════════════════════
