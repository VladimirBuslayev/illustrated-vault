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
-- PROVENANCE PIN
--   The candidate population is not "whatever pairs card_identity_resolution
--   currently resolves" — it is the exact CAT-2D.2 approved-alias evidence
--   class: card_identity_aliases rows where slice = 'CAT-2D.2', family =
--   'set_rename', approved_by = 'CAT-2D.2 approved allowlist —
--   docs/cat-2d2-evidence/manifest.json', additionally required to still
--   resolve through the deployed card_identity_resolution view. §A and §B
--   both define this identical CTE (cat2d2_alias_pair) and both assert its
--   row count is exactly 192 before doing anything else — no card id or
--   image URL is ever hard-coded. Cardinality alone does not pin identity: a
--   future remove-one/add-one against card_identity_aliases could hold total
--   count at 192 while silently substituting a different alias into this
--   activation. The provenance predicate is what makes that substitution
--   impossible to admit unnoticed.
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

-- A-3. The provenance-pinned candidate class, then the ten admission keys
--      re-derived live against it. class_count must be 192 (the provenance
--      pin — see header). eligible_all_ten must be 192, and each key must be
--      192. Any shortfall means the population moved since Gate 0 — STOP and
--      re-gate rather than writing a reduced set.
with cat2d2_alias_pair as (
  select a.alias_card_id, a.canonical_card_id
  from public.card_identity_aliases a
  join public.card_identity_resolution r
    on r.alias_card_id     = a.alias_card_id
   and r.canonical_card_id = a.canonical_card_id
  where a.slice       = 'CAT-2D.2'
    and a.family      = 'set_rename'
    and a.approved_by = 'CAT-2D.2 approved allowlist — docs/cat-2d2-evidence/manifest.json'
),
pair as (
  select alias_card_id as src_id, canonical_card_id as tgt_id
  from cat2d2_alias_pair
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
  (select count(*) from cat2d2_alias_pair)          as class_count,   -- must be 192 — the provenance pin
  count(*)                                          as pairs_total,   -- must equal class_count
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

-- A-4. Predicted split, and the two rows that must be UPDATED in place —
--      derived from the same provenance-pinned class as §A-3, not from the
--      unfiltered resolution view. expected_inserts must be 190,
--      expected_updates must be 2, and every expected-update row must still
--      carry its CAT-1 enrichment.
with cat2d2_alias_pair as (
  select a.alias_card_id, a.canonical_card_id
  from public.card_identity_aliases a
  join public.card_identity_resolution r
    on r.alias_card_id     = a.alias_card_id
   and r.canonical_card_id = a.canonical_card_id
  where a.slice       = 'CAT-2D.2'
    and a.family      = 'set_rename'
    and a.approved_by = 'CAT-2D.2 approved allowlist — docs/cat-2d2-evidence/manifest.json'
)
select
  count(*) filter (where ce.card_id is null) as expected_inserts,  -- must be 190
  count(*) filter (where ce.card_id is not null) as expected_updates -- must be 2
from cat2d2_alias_pair p
left join public.card_extras ce on ce.card_id = p.canonical_card_id;

with cat2d2_alias_pair as (
  select a.alias_card_id, a.canonical_card_id
  from public.card_identity_aliases a
  join public.card_identity_resolution r
    on r.alias_card_id     = a.alias_card_id
   and r.canonical_card_id = a.canonical_card_id
  where a.slice       = 'CAT-2D.2'
    and a.family      = 'set_rename'
    and a.approved_by = 'CAT-2D.2 approved allowlist — docs/cat-2d2-evidence/manifest.json'
)
select ce.card_id,
       ce.illustrator_override is not null as has_illustrator_override,
       ce.source_note          is not null as has_source_note,
       ce.image_url_override   is null     as image_channel_empty
from public.card_extras ce
join cat2d2_alias_pair p on p.canonical_card_id = ce.card_id
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
-- ⚠ PIN THE PROVENANCE CLASS FIRST. Before any admission check, §B recomputes
--   the CAT-2D.2 evidence class (the identical cat2d2_alias_pair CTE §A-3
--   uses) and aborts if its row count is not 192. This is deliberately
--   separate from — and evaluated before — the ten-key admission predicate:
--   a class-count drift means the identity of the approved population moved,
--   which must be re-gated, not silently re-admitted through a still-192
--   admission count drawn from a different set of aliases.
--
-- ⚠ SELF-CONTAINED FIRST-WRITER GUARANTEE. §A-2 checks channel cleanliness as
--   a human-readable preflight, but §B does not trust that §A was run moments
--   before it. §B re-checks, inside its own transaction, that no card_extras
--   row anywhere carries a populated image override before writing.
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
-- ⚠ SPLIT FROM PRE-WRITE STATE, NOT FROM xmax. §B derives the expected
--   190/2 insert-vs-update split BEFORE writing, by checking which eligible
--   targets already have a card_extras row, and asserts the two pre-existing
--   ids are exactly swsh12.5gg-GG19 / swsh12.5gg-GG69 with CAT-1 enrichment
--   intact. The write itself is asserted only on total affected rows via
--   `GET DIAGNOSTICS ... ROW_COUNT`, and the post-write row-count growth of
--   card_extras is checked against the pre-derived insert count. The 190/2
--   split is therefore knowable and checked from ordinary table state; it is
--   not part of the production correctness contract via an MVCC system
--   column.
--
-- ⚠ FAIL-CLOSED. Every assertion raises. A raise inside a DO block aborts the
--   transaction, so a deviation rolls back the write entirely. Re-running §B
--   after a successful run raises on `eligible = 0` (k08 excludes rows that
--   now hold an override) rather than double-applying.

do $$
declare
  v_class_count    integer;
  v_clean_check    integer;
  v_pre_extras     integer;
  v_post_extras    integer;
  v_eligible       integer;
  v_pre_inserts    integer;
  v_pre_updates    integer;
  v_pre_update_ids text[];
  v_total          integer;
  v_expected       constant integer := 192;
  v_exp_ins        constant integer := 190;
  v_exp_upd        constant integer := 2;
  v_approved_by    constant text :=
    'CAT-3B.1 approved alias image activation — docs/CAT-3B.1_ALIAS_IMAGE_ACTIVATION.md';
begin

  -- ── Provenance pin, checked FIRST. ───────────────────────────────────────
  with cat2d2_alias_pair as (
    select a.alias_card_id, a.canonical_card_id
    from public.card_identity_aliases a
    join public.card_identity_resolution r
      on r.alias_card_id     = a.alias_card_id
     and r.canonical_card_id = a.canonical_card_id
    where a.slice       = 'CAT-2D.2'
      and a.family      = 'set_rename'
      and a.approved_by = 'CAT-2D.2 approved allowlist — docs/cat-2d2-evidence/manifest.json'
  )
  select count(*) into v_class_count from cat2d2_alias_pair;

  if v_class_count <> v_expected then
    raise exception
      'CAT-3B.1 activation aborted — the CAT-2D.2 approved-alias evidence class has % rows, expected %. '
      'This is the provenance pin, distinct from the admission predicate: a class-count drift means the '
      'identity of the approved population moved and must be re-gated, not merely re-counted.',
      v_class_count, v_expected
      using errcode = 'check_violation';
  end if;

  -- ── Self-contained first-writer guarantee. ───────────────────────────────
  select count(*) into v_clean_check
  from public.card_extras
  where image_url_override is not null;

  if v_clean_check <> 0 then
    raise exception
      'CAT-3B.1 activation aborted — % row(s) in card_extras already carry a populated image override. '
      'This slice is authored to be the first writer to this channel and must not run against a '
      'channel that is no longer empty.',
      v_clean_check
      using errcode = 'check_violation';
  end if;

  select count(*) into v_pre_extras from public.card_extras;

  -- ── Pre-write admission count, from the same ten-key predicate §A-3
  --    checks, evaluated against the provenance-pinned class. ──────────────
  with cat2d2_alias_pair as (
    select a.alias_card_id, a.canonical_card_id
    from public.card_identity_aliases a
    join public.card_identity_resolution r
      on r.alias_card_id     = a.alias_card_id
     and r.canonical_card_id = a.canonical_card_id
    where a.slice       = 'CAT-2D.2'
      and a.family      = 'set_rename'
      and a.approved_by = 'CAT-2D.2 approved allowlist — docs/cat-2d2-evidence/manifest.json'
  )
  select count(*) into v_eligible
  from cat2d2_alias_pair p
  join public.cards           src on src.id  = p.alias_card_id
  join public.cards           tgt on tgt.id  = p.canonical_card_id
  join public.cards_effective eff on eff.id  = p.canonical_card_id
  left join public.card_extras ce  on ce.card_id = p.canonical_card_id
  where p.alias_card_id <> p.canonical_card_id
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

  -- ── Split derived from PRE-WRITE state (target already has a card_extras
  --    row -> update; no row -> insert), not from RETURNING xmax on the
  --    write itself. ─────────────────────────────────────────────────────
  with cat2d2_alias_pair as (
    select a.alias_card_id, a.canonical_card_id
    from public.card_identity_aliases a
    join public.card_identity_resolution r
      on r.alias_card_id     = a.alias_card_id
     and r.canonical_card_id = a.canonical_card_id
    where a.slice       = 'CAT-2D.2'
      and a.family      = 'set_rename'
      and a.approved_by = 'CAT-2D.2 approved allowlist — docs/cat-2d2-evidence/manifest.json'
  ),
  eligible as (
    select p.canonical_card_id as tgt_id
    from cat2d2_alias_pair p
    join public.cards           src on src.id  = p.alias_card_id
    join public.cards           tgt on tgt.id  = p.canonical_card_id
    join public.cards_effective eff on eff.id  = p.canonical_card_id
    left join public.card_extras ce  on ce.card_id = p.canonical_card_id
    where p.alias_card_id <> p.canonical_card_id
      and src.image_url is not null
      and btrim(src.image_url) <> ''
      and src.image_url = btrim(src.image_url)
      and src.image_url ~ '^https://assets\.tcgdex\.net/[^[:space:]]+$'
      and src.image_url !~ '/$'
      and src.image_url !~* '\.(png|jpe?g|webp|gif|avif|svg)$'
      and tgt.image_url is null
      and eff.image_url is null
      and ce.image_url_override is null
  )
  select
    count(*) filter (where ce.card_id is null),
    count(*) filter (where ce.card_id is not null),
    array_agg(e.tgt_id order by e.tgt_id) filter (where ce.card_id is not null)
    into v_pre_inserts, v_pre_updates, v_pre_update_ids
  from eligible e
  left join public.card_extras ce on ce.card_id = e.tgt_id;

  if v_pre_inserts <> v_exp_ins or v_pre_updates <> v_exp_upd then
    raise exception
      'CAT-3B.1 activation aborted — pre-write state implies % inserts / % updates, expected % / %. '
      'Gate 0 §10 predicted exactly two pre-existing card_extras rows in this population.',
      v_pre_inserts, v_pre_updates, v_exp_ins, v_exp_upd
      using errcode = 'check_violation';
  end if;

  if v_pre_update_ids is distinct from array['swsh12.5gg-GG19', 'swsh12.5gg-GG69']::text[] then
    raise exception
      'CAT-3B.1 activation aborted — the pre-existing target row(s) are %, expected exactly '
      'swsh12.5gg-GG19 and swsh12.5gg-GG69.',
      v_pre_update_ids
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from public.card_extras
    where card_id in ('swsh12.5gg-GG19', 'swsh12.5gg-GG69')
      and (illustrator_override is null or source_note is null)
  ) then
    raise exception
      'CAT-3B.1 activation aborted — the two pre-existing target rows do not carry CAT-1 '
      'enrichment intact ahead of the write.'
      using errcode = 'check_violation';
  end if;

  -- ── The write. ────────────────────────────────────────────────────────────
  with cat2d2_alias_pair as (
    select a.alias_card_id, a.canonical_card_id,
           a.slice as alias_slice, a.family as alias_family, a.approved_at as alias_approved_at
    from public.card_identity_aliases a
    join public.card_identity_resolution r
      on r.alias_card_id     = a.alias_card_id
     and r.canonical_card_id = a.canonical_card_id
    where a.slice       = 'CAT-2D.2'
      and a.family      = 'set_rename'
      and a.approved_by = 'CAT-2D.2 approved allowlist — docs/cat-2d2-evidence/manifest.json'
  )
  insert into public.card_extras as ce_t (
    card_id,
    image_url_override,
    image_override_source_card_id,
    image_override_evidence,
    image_override_approved_by,
    image_override_approved_at
  )
  select
    p.canonical_card_id,
    src.image_url,                         -- derived in-statement; satisfies R3
    p.alias_card_id,
    jsonb_build_object(
      'slice',                             'CAT-3B.1',
      'basis',                             'cat-2d2-approved-same-printing-alias',
      'alias_slice',                       p.alias_slice,
      'alias_family',                      p.alias_family,
      'alias_approved_at',                 p.alias_approved_at,
      'source_card_id',                    p.alias_card_id,
      'source_image_url_at_admission',     src.image_url,
      'target_raw_image_url_at_admission', tgt.image_url,
      'gate',                              'CAT-3B.1 Gate 0',
      'gate_evidence',                     'docs/sql/cat-3b1-0-gate0.sql'
    ),
    v_approved_by,
    now()
  from cat2d2_alias_pair p
  join public.cards           src on src.id = p.alias_card_id
  join public.cards           tgt on tgt.id = p.canonical_card_id
  join public.cards_effective eff on eff.id = p.canonical_card_id
  left join public.card_extras ce on ce.card_id = p.canonical_card_id
  where p.alias_card_id <> p.canonical_card_id
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
        image_override_approved_at    = excluded.image_override_approved_at;
      -- illustrator_override and source_note are deliberately ABSENT from this
      -- SET list. That absence is the CAT-1 preservation guarantee.

  get diagnostics v_total = row_count;

  -- ── Post-write assertions. Any failure aborts the transaction. ────────────
  if v_total <> v_expected then
    raise exception
      'CAT-3B.1 activation aborted — wrote % rows, expected %.',
      v_total, v_expected
      using errcode = 'check_violation';
  end if;

  -- card_extras must have grown by exactly the pre-derived insert count. This
  -- is the post-write confirmation of the pre-derived 190/2 split, using
  -- ordinary row-count arithmetic rather than an xmax heuristic.
  select count(*) into v_post_extras from public.card_extras;
  if v_post_extras - v_pre_extras <> v_exp_ins then
    raise exception
      'CAT-3B.1 activation aborted — card_extras grew by % row(s), expected % (the pre-derived '
      'insert count). The insert/update split did not land as predicted from pre-write state.',
      v_post_extras - v_pre_extras, v_exp_ins
      using errcode = 'check_violation';
  end if;

  -- CAT-1 enrichment must have survived the two in-place updates.
  if exists (
    select 1
    from public.card_extras ce
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
    v_pre_inserts, v_pre_updates, v_total;
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

-- C-7. Active-owned missing-image count, proven rather than left to manual
--      QA. Uses the SAME ownership authority as CAT-3B.1 Gate 0 §G0-6 —
--      single resolved active user, that user's single active batch,
--      snapshot ∪ force-owned − force-missing. No `owned_keys` fallback and
--      no cross-printing inference beyond the alias resolution CAT-2D.2
--      already approved. Fails closed to 0 resolved rows (not an unfiltered
--      pool) if zero or more than one user/batch is active; read
--      target_user_resolved / target_batch_resolved alongside the count
--      before trusting it. No user_id is ever selected.
with target_user as (
  select b.user_id
  from public.user_import_batches b
  where b.status = 'active'
  group by b.user_id
  having (select count(distinct user_id) from public.user_import_batches where status = 'active') = 1
),
target_batch as (
  select b.id as batch_id
  from public.user_import_batches b
  join target_user tu on tu.user_id = b.user_id
  where b.status = 'active'
    and (
      select count(*) from public.user_import_batches b2
      join target_user tu2 on tu2.user_id = b2.user_id
      where b2.status = 'active'
    ) = 1
),
snap as (
  select distinct coalesce(res.canonical_card_id, r.card_id) as card_id
  from public.user_import_rows r
  join target_batch tb on tb.batch_id = r.batch_id
  left join public.card_identity_resolution res on res.alias_card_id = r.card_id
  where r.match_status = 'matched' and r.card_id is not null
),
fo as (select distinct co.card_id from public.card_overrides co
         join target_user tu on tu.user_id = co.user_id
         where co.override_type = 'owned'),
fm as (select distinct co.card_id from public.card_overrides co
         join target_user tu on tu.user_id = co.user_id
         where co.override_type = 'missing'),
owned as (
  select card_id from (select card_id from snap union select card_id from fo) u
  where card_id not in (select card_id from fm)
)
select
  (select count(*) from target_user)  as target_user_resolved,   -- must be 1
  (select count(*) from target_batch) as target_batch_resolved,  -- must be 1
  (select count(*) from public.cards_effective e
     where e.image_url is null
       and e.id in (select card_id from owned))                  as active_owned_missing_image; -- must be 77


-- ═══════════════════════════════════════════════════════════════════════════
-- §D. ROLLBACK — only if §C fails
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Withdrawing an override is explicitly permitted by the CAT-3B trigger: it
-- returns early when the bundle is cleared to NULL, so a withdrawal does not
-- require the source to still be admissible. The all-or-nothing CHECK forces
-- all five fields to clear together, which is why they are set in one statement.
--
-- Restores the pre-slice operational baseline rather than leaving 190
-- bundle-empty rows behind:
--   * the two pre-existing CAT-1 rows (swsh12.5gg-GG19, swsh12.5gg-GG69) have
--     their five image fields cleared IN PLACE — never deleted, because they
--     predate this slice and carry CAT-1 enrichment that must survive;
--   * the 190 rows this slice inserted are DELETED outright, but only after a
--     fail-closed guard proves none of them has since picked up non-image
--     (illustrator_override / source_note) enrichment that a delete would
--     destroy. If the guard finds any, rollback aborts rather than deleting —
--     the row is left as a populated override for a human to resolve.
--   * a re-run of §B after a successful rollback then sees the same 190/2
--     pre-state split §B's own pre-write assertions expect, rather than 192
--     pre-existing rows.

-- do $$
-- declare
--   v_would_lose_enrichment integer;
--   v_cleared               integer;
--   v_deleted               integer;
-- begin
--   -- Fail-closed guard: a row this slice inserted (i.e. not one of the two
--   -- known pre-existing CAT-1 rows) that now carries non-image enrichment
--   -- must not be deleted — that enrichment did not exist before this slice
--   -- ran and rollback must not destroy it.
--   select count(*) into v_would_lose_enrichment
--   from public.card_extras
--   where image_override_evidence ->> 'slice' = 'CAT-3B.1'
--     and card_id not in ('swsh12.5gg-GG19', 'swsh12.5gg-GG69')
--     and (illustrator_override is not null or source_note is not null);
--
--   if v_would_lose_enrichment <> 0 then
--     raise exception
--       'CAT-3B.1 rollback aborted — % row(s) created by this slice now carry non-image '
--       'enrichment; deleting them would lose it. Resolve manually — do not delete.',
--       v_would_lose_enrichment
--       using errcode = 'check_violation';
--   end if;
--
--   -- Clear the two pre-existing CAT-1 rows' image bundle in place.
--   with cleared as (
--     update public.card_extras ce
--        set image_url_override            = null,
--            image_override_source_card_id = null,
--            image_override_evidence       = null,
--            image_override_approved_by    = null,
--            image_override_approved_at    = null
--      where ce.card_id in ('swsh12.5gg-GG19', 'swsh12.5gg-GG69')
--        and ce.image_override_evidence ->> 'slice' = 'CAT-3B.1'
--      returning 1
--   )
--   select count(*) into v_cleared from cleared;
--
--   -- Delete the 190 rows this slice inserted.
--   with deleted as (
--     delete from public.card_extras
--      where image_override_evidence ->> 'slice' = 'CAT-3B.1'
--        and card_id not in ('swsh12.5gg-GG19', 'swsh12.5gg-GG69')
--      returning 1
--   )
--   select count(*) into v_deleted from deleted;
--
--   raise notice 'CAT-3B.1 rollback: % bundle(s) cleared in place, % inserted row(s) deleted.',
--     v_cleared, v_deleted;
--
--   if (select count(*) from public.card_extras where image_url_override is not null) <> 0 then
--     raise exception 'CAT-3B.1 rollback incomplete — overrides remain.'
--       using errcode = 'check_violation';
--   end if;
--
--   if (select count(*) from public.card_extras) <> 5 then
--     raise exception
--       'CAT-3B.1 rollback incomplete — card_extras has % rows, expected 5 (the pre-slice baseline).',
--       (select count(*) from public.card_extras)
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
