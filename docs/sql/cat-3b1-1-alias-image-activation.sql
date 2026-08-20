-- ═══════════════════════════════════════════════════════════════════════════
-- CAT-3B.1 — Approved Alias Image Activation
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Authorizing evidence : docs/CAT-3B.1_ALIAS_IMAGE_ACTIVATION.md (Gate 0, PASS)
-- Slice document       : docs/CAT-3B.1_ACTIVATION_SLICE.md
-- Deployed wall        : docs/sql/cat-3b-1-durable-image-override.sql
--
-- ⚠ THIS FILE IS NOT SELF-EXECUTING AUTHORIZATION.
--   Authoring a migration is not permission to run it. §B is the only section
--   that writes, and it must not be executed until production execution is
--   separately approved. §A and §C are read-only and safe to run at any time.
--
-- ⚠ EXECUTION IDENTITY. public.card_extras has RLS enabled with exactly one
--   policy — a permissive SELECT for anon/authenticated. There is no write
--   policy. CAT-3B §6 narrowed the table-level grants to an explicit column
--   list for anon/authenticated and deliberately left service_role alone as
--   the write identity. §B must therefore be run as the table owner
--   (the Supabase SQL editor's `postgres`) or as `service_role`. Running it as
--   anon or authenticated fails on privileges, not silently.
--
-- WHAT THIS DOES
--   Populates the CAT-3B durable image-override channel for the 192 approved
--   CAT-2D.2 alias relationships, so each surviving canonical printing shows
--   the image its retired provider-history row still holds.
--
-- WHAT THIS DOES NOT DO
--   * does not touch public.cards — the raw provider column keeps its nulls;
--   * does not alter schema, constraints, triggers, views, RLS or ACL;
--   * does not touch the 1,448 non-alias image gaps;
--   * does not create an alias relationship — it only consumes existing ones;
--   * does not overwrite an override that already exists (see k08).
--
-- ORDER: §A read-only preflight → §B the write → §C post-write validation.
--        §D is the rollback, for use only if §C fails.
--
-- Section §B is a single DO block. Every assertion inside it RAISES, and a
-- raise inside a DO block aborts the surrounding transaction. There is no
-- partial-application path: either all 192 rows land and every count matches,
-- or nothing is written.


-- ═══════════════════════════════════════════════════════════════════════════
-- §A. PREFLIGHT — READ ONLY. Run first. Nothing here writes.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Gate 0 evidence is a snapshot of 2026-08-20. Requirement 3 of §13.1 is that
-- admission is re-checked at execution time. §A is that re-check in a form a
-- human can read before deciding to proceed; §B then re-evaluates the SAME
-- predicate as part of the write itself, so a change landing between §A and §B
-- cannot slip through.

-- A-1. The wall is still deployed and still enabled. If any of these is false,
--      STOP — the write would be admitted by a weaker wall than Gate 0 tested.
select
  (select count(*) from pg_constraint con
     join pg_class rel on rel.oid = con.conrelid
     join pg_namespace ns on ns.oid = rel.relnamespace
    where ns.nspname = 'public' and rel.relname = 'card_extras'
      and con.conname in (
        'card_extras_image_override_all_or_nothing',
        'card_extras_image_override_approved_by_nonempty',
        'card_extras_image_override_shape',
        'card_extras_image_override_source_not_self',
        'card_extras_image_override_source_fk'))            as wall_constraints_present,  -- must be 5
  (select tgenabled = 'O'
     from pg_trigger t
     join pg_class rel on rel.oid = t.tgrelid
     join pg_namespace ns on ns.oid = rel.relnamespace
    where ns.nspname = 'public' and rel.relname = 'card_extras'
      and t.tgname = 'card_extras_admit_image_override')    as admit_trigger_enabled,     -- must be true
  (select not prosecdef from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'card_extras_admit_image_override')   as admit_fn_security_invoker; -- must be true

-- A-2. Channel cleanliness across the WHOLE table. A populated override
--      anywhere is a STOP condition: this slice expects to be the first writer.
select
  count(*)                                                          as card_extras_rows,
  count(*) filter (where image_url_override            is not null) as image_url_override_set,
  count(*) filter (where image_override_source_card_id is not null) as source_card_id_set,
  count(*) filter (where image_override_evidence       is not null) as evidence_set,
  count(*) filter (where image_override_approved_by    is not null) as approved_by_set,
  count(*) filter (where image_override_approved_at    is not null) as approved_at_set,
  count(*) filter (where illustrator_override is not null or source_note is not null)
                                                                    as cat1_enrichment_rows
from public.card_extras;

-- A-3. The ten admission keys, re-derived live. This is the same predicate §B
--      writes through. eligible_all_ten must be 192, and each key must be 192.
--      Any shortfall means the population moved since Gate 0 — STOP and
--      re-gate rather than writing a reduced set.
with pair as (
  select r.alias_card_id as src_id, r.canonical_card_id as tgt_id
  from public.card_identity_resolution r
),
k as (
  select
    p.src_id, p.tgt_id,
    (p.src_id is not null and p.tgt_id is not null)              as k01_ids_present,
    (p.src_id <> p.tgt_id)                                       as k02_not_self,
    exists (select 1 from public.card_identity_resolution r
             where r.alias_card_id = p.src_id
               and r.canonical_card_id = p.tgt_id)               as k03_approved_rel,
    (src.image_url is not null and btrim(src.image_url) <> '')   as k04_source_has_image,
    (src.image_url is not null
       and src.image_url = btrim(src.image_url)
       and src.image_url ~ '^https://assets\.tcgdex\.net/[^[:space:]]+$'
       and src.image_url !~ '/$'
       and src.image_url !~* '\.(png|jpe?g|webp|gif|avif|svg)$')  as k05_shape_ok,
    (tgt.image_url is null)                                      as k06_target_raw_null,
    (eff.image_url is null)                                      as k07_target_eff_null,
    (ce.image_url_override is null)                              as k08_no_existing_override,
    (eff.id is not null)                                         as k09_target_in_effective,
    (src.id is not null)                                         as k10_source_row_exists
  from pair p
  left join public.cards           src on src.id = p.src_id
  left join public.cards           tgt on tgt.id = p.tgt_id
  left join public.cards_effective eff on eff.id = p.tgt_id
  left join public.card_extras     ce  on ce.card_id = p.tgt_id
)
select
  count(*)                                          as pairs_total,
  count(*) filter (where k01_ids_present)           as k01,
  count(*) filter (where k02_not_self)              as k02,
  count(*) filter (where k03_approved_rel)          as k03,
  count(*) filter (where k04_source_has_image)      as k04,
  count(*) filter (where k05_shape_ok)              as k05,
  count(*) filter (where k06_target_raw_null)       as k06,
  count(*) filter (where k07_target_eff_null)       as k07,
  count(*) filter (where k08_no_existing_override)  as k08,
  count(*) filter (where k09_target_in_effective)   as k09,
  count(*) filter (where k10_source_row_exists)     as k10,
  count(*) filter (where k01_ids_present and k02_not_self and k03_approved_rel
                     and k04_source_has_image and k05_shape_ok and k06_target_raw_null
                     and k07_target_eff_null and k08_no_existing_override
                     and k09_target_in_effective and k10_source_row_exists)
                                                    as eligible_all_ten,   -- must be 192
  count(distinct src.image_url)                     as distinct_source_urls -- must be 192: no reuse
from k
join public.cards src on src.id = k.src_id;

-- A-4. Predicted split, and the two rows that must be UPDATED in place.
--      expected_inserts must be 190, expected_updates must be 2, and every
--      expected-update row must still carry its CAT-1 enrichment.
select
  count(*) filter (where ce.card_id is null) as expected_inserts,  -- must be 190
  count(*) filter (where ce.card_id is not null) as expected_updates -- must be 2
from public.card_identity_resolution r
left join public.card_extras ce on ce.card_id = r.canonical_card_id;

select ce.card_id,
       ce.illustrator_override is not null as has_illustrator_override,
       ce.source_note          is not null as has_source_note,
       ce.image_url_override   is null     as image_channel_empty
from public.card_extras ce
join public.card_identity_resolution r on r.canonical_card_id = ce.card_id
order by ce.card_id;

-- A-5. Baseline counts to compare §C against.
select
  (select count(*) from public.cards            where image_url is null) as raw_missing_image,     -- 1640, must not move
  (select count(*) from public.cards_effective  where image_url is null) as effective_missing_image, -- 1640 -> 1448
  (select count(*) from public.card_extras)                              as card_extras_rows;      -- 5 -> 195


-- ═══════════════════════════════════════════════════════════════════════════
-- §B. THE WRITE — ⚠ DO NOT RUN UNTIL PRODUCTION EXECUTION IS APPROVED
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠ DERIVE, NEVER TRANSCRIBE (§13.1 requirement 1). The override value is
--   `src.image_url`, selected from public.cards inside the writing statement.
--   No URL literal appears anywhere in this file. Trigger rule R3 compares the
--   stored value against the source's image_url at admission time; a literal
--   list captured when this file was written could have gone stale and would
--   be rejected — correctly.
--
-- ⚠ PRESERVE CAT-1 ENRICHMENT (§13.1 requirement 2). ON CONFLICT DO UPDATE
--   sets ONLY the five image fields. illustrator_override and source_note are
--   not in the SET list, so the two colliding rows (swsh12.5gg-GG19 and
--   swsh12.5gg-GG69) keep their CAT-1 values. This is why the write is an
--   upsert with an explicit column list and NOT a wholesale row replacement:
--   `insert ... on conflict do update set` a full row, or a delete+insert,
--   would silently null both columns.
--
-- ⚠ RE-VERIFY AT EXECUTION TIME (§13.1 requirement 3). The WHERE clause below
--   IS the admission predicate — it is evaluated as part of the write, not
--   read from §A's output. A pair that stopped qualifying between §A and §B is
--   simply not selected, and the row-count assertion then fails the whole
--   transaction rather than applying a silently reduced population.
--
-- ⚠ FAIL-CLOSED. Every assertion raises. A raise inside a DO block aborts the
--   transaction, so a deviation rolls back the write entirely. Re-running §B
--   after a successful run raises on `eligible = 0` (k08 excludes rows that
--   now hold an override) rather than double-applying.

do $$
declare
  v_eligible   integer;
  v_inserted   integer;
  v_updated    integer;
  v_expected   constant integer := 192;
  v_exp_ins    constant integer := 190;
  v_exp_upd    constant integer := 2;
  v_approved_by constant text :=
    'CAT-3B.1 approved alias image activation — docs/CAT-3B.1_ALIAS_IMAGE_ACTIVATION.md';
begin

  -- ── Pre-write admission count, from the same predicate the write uses. ────
  select count(*) into v_eligible
  from public.card_identity_resolution r
  join public.cards           src on src.id  = r.alias_card_id
  join public.cards           tgt on tgt.id  = r.canonical_card_id
  join public.cards_effective eff on eff.id  = r.canonical_card_id
  left join public.card_extras ce  on ce.card_id = r.canonical_card_id
  where r.alias_card_id <> r.canonical_card_id
    and src.image_url is not null
    and btrim(src.image_url) <> ''
    and src.image_url = btrim(src.image_url)
    and src.image_url ~ '^https://assets\.tcgdex\.net/[^[:space:]]+$'
    and src.image_url !~ '/$'
    and src.image_url !~* '\.(png|jpe?g|webp|gif|avif|svg)$'
    and tgt.image_url is null
    and eff.image_url is null
    and ce.image_url_override is null;

  if v_eligible <> v_expected then
    raise exception
      'CAT-3B.1 activation aborted — % pairs currently satisfy admission, expected %. '
      'The population moved since Gate 0. Re-gate before writing; do NOT write a reduced set.',
      v_eligible, v_expected
      using errcode = 'check_violation';
  end if;

  -- ── The write. ────────────────────────────────────────────────────────────
  with written as (
    insert into public.card_extras as ce_t (
      card_id,
      image_url_override,
      image_override_source_card_id,
      image_override_evidence,
      image_override_approved_by,
      image_override_approved_at
    )
    select
      r.canonical_card_id,
      src.image_url,                         -- derived in-statement; satisfies R3
      r.alias_card_id,
      jsonb_build_object(
        'slice',                             'CAT-3B.1',
        'basis',                             'cat-2d2-approved-same-printing-alias',
        'alias_slice',                       a.slice,
        'alias_family',                      a.family,
        'alias_approved_at',                 a.approved_at,
        'source_card_id',                    r.alias_card_id,
        'source_image_url_at_admission',     src.image_url,
        'target_raw_image_url_at_admission', tgt.image_url,
        'gate',                              'CAT-3B.1 Gate 0',
        'gate_evidence',                     'docs/sql/cat-3b1-0-gate0.sql'
      ),
      v_approved_by,
      now()
    from public.card_identity_resolution r
    join public.card_identity_aliases a on a.alias_card_id     = r.alias_card_id
                                       and a.canonical_card_id = r.canonical_card_id
    join public.cards           src on src.id = r.alias_card_id
    join public.cards           tgt on tgt.id = r.canonical_card_id
    join public.cards_effective eff on eff.id = r.canonical_card_id
    left join public.card_extras ce on ce.card_id = r.canonical_card_id
    where r.alias_card_id <> r.canonical_card_id
      and src.image_url is not null
      and btrim(src.image_url) <> ''
      and src.image_url = btrim(src.image_url)
      and src.image_url ~ '^https://assets\.tcgdex\.net/[^[:space:]]+$'
      and src.image_url !~ '/$'
      and src.image_url !~* '\.(png|jpe?g|webp|gif|avif|svg)$'
      and tgt.image_url is null
      and eff.image_url is null
      and ce.image_url_override is null
    on conflict (card_id) do update
      set image_url_override            = excluded.image_url_override,
          image_override_source_card_id = excluded.image_override_source_card_id,
          image_override_evidence       = excluded.image_override_evidence,
          image_override_approved_by    = excluded.image_override_approved_by,
          image_override_approved_at    = excluded.image_override_approved_at
      -- illustrator_override and source_note are deliberately ABSENT from this
      -- SET list. That absence is the CAT-1 preservation guarantee.
    returning (xmax = 0) as was_insert
  )
  select count(*) filter (where was_insert),
         count(*) filter (where not was_insert)
    into v_inserted, v_updated
  from written;

  -- ── Post-write assertions. Any failure aborts the transaction. ────────────
  if v_inserted + v_updated <> v_expected then
    raise exception
      'CAT-3B.1 activation aborted — wrote % rows, expected %.',
      v_inserted + v_updated, v_expected
      using errcode = 'check_violation';
  end if;

  if v_inserted <> v_exp_ins or v_updated <> v_exp_upd then
    raise exception
      'CAT-3B.1 activation aborted — split was % inserts / % updates, expected % / %. '
      'Gate 0 §10 predicted exactly two pre-existing card_extras rows in this population.',
      v_inserted, v_updated, v_exp_ins, v_exp_upd
      using errcode = 'check_violation';
  end if;

  -- CAT-1 enrichment must have survived the two in-place updates.
  if exists (
    select 1
    from public.card_extras ce
    join public.card_identity_resolution r on r.canonical_card_id = ce.card_id
    where ce.card_id in ('swsh12.5gg-GG19', 'swsh12.5gg-GG69')
      and (ce.illustrator_override is null or ce.source_note is null)
  ) then
    raise exception
      'CAT-3B.1 activation aborted — CAT-1 enrichment was lost on an updated row.'
      using errcode = 'check_violation';
  end if;

  -- public.cards must be untouched: this slice writes only the COALESCE layer.
  if (select count(*) from public.cards where image_url is null) <> 1640 then
    raise exception
      'CAT-3B.1 activation aborted — public.cards raw null count moved. '
      'This slice must not touch public.cards.'
      using errcode = 'check_violation';
  end if;

  raise notice 'CAT-3B.1 activation: % inserted, % updated, % total.',
    v_inserted, v_updated, v_inserted + v_updated;
end;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- §C. POST-WRITE VALIDATION — READ ONLY. Run after §B.
-- ═══════════════════════════════════════════════════════════════════════════

-- C-1. Blast radius, against §A-5's baseline.
select
  (select count(*) from public.card_extras)                                        as card_extras_rows,          -- 195
  (select count(*) from public.card_extras where image_url_override is not null)   as overrides_populated,       -- 192
  (select count(*) from public.cards           where image_url is null)            as raw_missing_image,         -- 1640, unchanged
  (select count(*) from public.cards_effective where image_url is null)            as effective_missing_image;   -- 1448

-- C-2. Every override is complete, points at an approved alias of its own
--      canonical card, and equals that source's current image_url.
select
  count(*)                                                                  as overrides,                 -- 192
  count(*) filter (where image_override_source_card_id is not null
                     and image_override_evidence       is not null
                     and image_override_approved_by    is not null
                     and image_override_approved_at    is not null)         as complete_bundles,          -- 192
  count(*) filter (where image_override_source_card_id = card_id)           as self_sourced,              -- 0
  count(distinct image_url_override)                                        as distinct_urls              -- 192
from public.card_extras
where image_url_override is not null;

select count(*) as overrides_without_approved_relationship  -- must be 0
from public.card_extras ce
where ce.image_url_override is not null
  and not exists (
    select 1 from public.card_identity_resolution r
    where r.alias_card_id = ce.image_override_source_card_id
      and r.canonical_card_id = ce.card_id);

select count(*) as overrides_not_matching_source_image  -- must be 0
from public.card_extras ce
join public.cards src on src.id = ce.image_override_source_card_id
where ce.image_url_override is not null
  and ce.image_url_override <> src.image_url;

-- C-3. CAT-1 enrichment survived the two in-place updates. Both rows must
--      still report true for both columns.
select card_id,
       illustrator_override is not null as has_illustrator_override,
       source_note          is not null as has_source_note,
       image_url_override   is not null as has_image_override
from public.card_extras
where card_id in ('swsh12.5gg-GG19', 'swsh12.5gg-GG69')
order by card_id;

-- C-4. Every change was NULL -> value. No effective image was displaced:
--      a canonical target whose raw image is null and whose effective image is
--      now set can only have got it from the COALESCE layer.
select count(*) as targets_with_effective_image  -- must be 192
from public.cards_effective eff
join public.card_identity_resolution r on r.canonical_card_id = eff.id
join public.cards tgt on tgt.id = eff.id
where eff.image_url is not null
  and tgt.image_url is null;

-- C-5. The alias source rows remain excluded from the effective catalog. They
--      gain and lose nothing from this slice.
select count(*) as alias_sources_visible_in_effective  -- must be 0
from public.cards_effective eff
join public.card_identity_resolution r on r.alias_card_id = eff.id;

-- C-6. Evidence payload spot-check — shape and derivation, not a literal list.
select ce.card_id,
       ce.image_override_evidence ->> 'slice'          as slice,
       ce.image_override_evidence ->> 'basis'          as basis,
       ce.image_override_evidence ->> 'source_card_id' as evidence_source,
       (ce.image_override_evidence ->> 'source_card_id') = ce.image_override_source_card_id
                                                       as evidence_matches_column,
       (ce.image_override_evidence ->> 'source_image_url_at_admission') = ce.image_url_override
                                                       as evidence_matches_url,
       ce.image_override_evidence -> 'target_raw_image_url_at_admission' = 'null'::jsonb
                                                       as target_was_empty
from public.card_extras ce
where ce.image_url_override is not null
order by ce.card_id
limit 5;

select count(*) as evidence_rows_failing_selfcheck  -- must be 0
from public.card_extras ce
where ce.image_url_override is not null
  and not (
        (ce.image_override_evidence ->> 'slice') = 'CAT-3B.1'
    and (ce.image_override_evidence ->> 'basis') = 'cat-2d2-approved-same-printing-alias'
    and (ce.image_override_evidence ->> 'source_card_id') = ce.image_override_source_card_id
    and (ce.image_override_evidence ->> 'source_image_url_at_admission') = ce.image_url_override
    and (ce.image_override_evidence ->  'target_raw_image_url_at_admission') = 'null'::jsonb
    and (ce.image_override_evidence ->> 'gate') = 'CAT-3B.1 Gate 0'
  );


-- ═══════════════════════════════════════════════════════════════════════════
-- §D. ROLLBACK — only if §C fails
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Withdrawing an override is explicitly permitted by the CAT-3B trigger: it
-- returns early when the bundle is cleared to NULL, so a withdrawal does not
-- require the source to still be admissible. The all-or-nothing CHECK forces
-- all five fields to clear together, which is why they are set in one statement.
--
-- ⚠ This CLEARS the image bundle in place. It does NOT delete card_extras rows,
--   because two of them predate this slice and hold CAT-1 enrichment. Deleting
--   rows here would destroy that enrichment — the exact failure §B was built to
--   avoid. Rows this slice inserted are left behind as bundle-empty rows, which
--   is harmless: cards_effective COALESCEs a NULL override to the raw value.

-- do $$
-- declare v_cleared integer;
-- begin
--   with cleared as (
--     update public.card_extras ce
--        set image_url_override            = null,
--            image_override_source_card_id = null,
--            image_override_evidence       = null,
--            image_override_approved_by    = null,
--            image_override_approved_at    = null
--      where ce.image_override_evidence ->> 'slice' = 'CAT-3B.1'
--      returning 1
--   )
--   select count(*) into v_cleared from cleared;
--
--   raise notice 'CAT-3B.1 rollback: % overrides withdrawn.', v_cleared;
--
--   if (select count(*) from public.card_extras where image_url_override is not null) <> 0 then
--     raise exception 'CAT-3B.1 rollback incomplete — overrides remain.'
--       using errcode = 'check_violation';
--   end if;
--
--   if exists (
--     select 1 from public.card_extras
--     where card_id in ('swsh12.5gg-GG19', 'swsh12.5gg-GG69')
--       and (illustrator_override is null or source_note is null)
--   ) then
--     raise exception 'CAT-3B.1 rollback aborted — CAT-1 enrichment lost.'
--       using errcode = 'check_violation';
--   end if;
-- end;
-- $$;
