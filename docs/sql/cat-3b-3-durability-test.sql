-- docs/sql/cat-3b-3-durability-test.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- CAT-3B — DURABILITY TEST
--
-- Proves the single claim the whole slice exists to establish:
--
--   ONCE AN OVERRIDE IS ADMITTED, CHANGING OR NULLING THE RAW ALIAS ROW'S
--   cards.image_url DOES NOT CHANGE THE STORED OVERRIDE, AND DOES NOT CHANGE
--   THE CANONICAL CARD'S EFFECTIVE IMAGE.
--
-- ─────────────────────────────────────────────────────────────────────────
-- ⚠⚠ NON-PRODUCTION ONLY. THIS FILE WRITES DATA. ⚠⚠
-- ─────────────────────────────────────────────────────────────────────────
-- It INSERTs a card_extras override and UPDATEs public.cards.image_url. Both
-- are mutations. It is wrapped in an explicit transaction that ends in
-- ROLLBACK, but DO NOT rely on that against production: a disconnect between
-- the writes and the ROLLBACK would leave the mutation applied.
--
-- Run it against a local or staging Supabase. If no non-production environment
-- is available, record this as a DEFERRED OBSERVATION and rely on the static
-- proof in §0 — the same disposition CAT-1 recorded for its isolated G1 proof,
-- and for the same reason. Do not manufacture the evidence in production.
--
-- ─────────────────────────────────────────────────────────────────────────
-- §0. THE STATIC PROOF — why the empirical test should already be redundant
-- ─────────────────────────────────────────────────────────────────────────
-- Three independent facts, each verifiable without running anything:
--
--   1. sync-cards.mjs WRITES exactly one table: public.cards (upsert at line
--      345, temporal update at line 396). It also READS public.artists (line
--      218, alias map) and public.cards_effective (line 476, the CAT-2B1
--      identity-collision guard) — both SELECT only. public.card_extras appears
--      NOWHERE in the file, in any form, so the sync path has no code path that
--      can write the override column. The read/write distinction is asserted
--      separately in the harness: an edit turning either read into a write
--      would break durability without changing the table count.
--
--   2. mapCardToRow() emits 21 named keys and image_url_override is not among
--      them. Because upsertRows issues INSERT … ON CONFLICT (id) DO UPDATE SET
--      over exactly those payload columns, the routine path is STRUCTURALLY
--      INCAPABLE of expressing the column — not merely unlikely to. This is the
--      same argument CAT-1's G1 made for series/release_date, and
--      scripts/cat3b-durability.test.mjs asserts it so a future edit that
--      re-introduces the key fails CI.
--
--   3. cards_effective COALESCEs the STORED override
--      (coalesce(ce.image_url_override, c.image_url)). It does not re-derive
--      the value from the source row, and it does not join the source row at
--      all. The alias row's current image_url is not an input to the rendered
--      value.
--
-- The test below confirms all three empirically in one transaction.
--
-- ─────────────────────────────────────────────────────────────────────────
-- §0b. WHY DIVERGENCE AFTER ADMISSION IS CORRECT, NOT A BUG
-- ─────────────────────────────────────────────────────────────────────────
-- The admission trigger checks override = source.image_url WHEN WRITTEN, and
-- never again. After that the two MAY diverge, and the override wins.
--
-- That is the point. An override records a human decision, taken against
-- evidence captured at a known moment, that a specific asset represents this
-- printing. Re-deriving it later would make a curated value silently dependent
-- on provider churn — reintroducing exactly the fragility CAT-3B removes.
--
-- Step 5 below asserts that divergence explicitly, as a REQUIRED outcome.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── Step 1 — pick a real approved pair, deterministically ───────────────────
-- Any pair whose alias row currently carries an image and whose canonical row
-- does not. On a CAT-3A-era database this is the A2 population; the test does
-- not depend on that and will use whatever the environment actually has.
create temporary table cat3b_fixture on commit drop as
select
  r.alias_card_id,
  r.canonical_card_id,
  a.image_url as source_image_at_admission
from public.card_identity_resolution r
join public.cards a on a.id = r.alias_card_id
join public.cards k on k.id = r.canonical_card_id
where a.image_url is not null
  and btrim(a.image_url) <> ''
  and (k.image_url is null or btrim(k.image_url) = '')
order by r.canonical_card_id
limit 1;

select
  'step 1 — fixture'                                                as step,
  count(*) = 1                                                      as fixture_found,
  min(alias_card_id)                                                as alias_card_id,
  min(canonical_card_id)                                            as canonical_card_id
from cat3b_fixture;
-- STOP if fixture_found is false: the environment has no approved pair to test.


-- ── Step 2 — the canonical card renders NOTHING before the override ─────────
select
  'step 2 — before override'                                        as step,
  e.id,
  e.image_url                                                       as effective_image,
  e.image_url is null                                               as expected_null_before
from public.cards_effective e
join cat3b_fixture f on f.canonical_card_id = e.id;


-- ── Step 3 — admit the override ─────────────────────────────────────────────
-- Passes all three trigger rules: source is an approved alias of card_id,
-- value equals the source's current image_url, provenance complete.
insert into public.card_extras (
  card_id, image_url_override, image_override_source_card_id,
  image_override_evidence, image_override_approved_by, image_override_approved_at
)
select
  f.canonical_card_id,
  f.source_image_at_admission,
  f.alias_card_id,
  jsonb_build_object(
    'slice', 'CAT-3B',
    'test', 'cat-3b-3-durability-test.sql',
    'basis', 'CAT-2D.2-approved same-printing alias'
  ),
  'cat-3b-durability-test',
  now()
from cat3b_fixture f
on conflict (card_id) do update set
  image_url_override            = excluded.image_url_override,
  image_override_source_card_id = excluded.image_override_source_card_id,
  image_override_evidence       = excluded.image_override_evidence,
  image_override_approved_by    = excluded.image_override_approved_by,
  image_override_approved_at    = excluded.image_override_approved_at;

select
  'step 3 — after admission'                                        as step,
  e.image_url                                                       as effective_image,
  e.image_url = f.source_image_at_admission                         as renders_the_override
from public.cards_effective e
join cat3b_fixture f on f.canonical_card_id = e.id;
-- Expected: renders_the_override = true. The channel works.


-- ── Step 4 — SIMULATE A SYNC: mutate the raw alias row ──────────────────────
-- This is what a future sync could legitimately do to provider history. First
-- change the value, then null it entirely — the harsher case.
update public.cards
set image_url = 'https://assets.tcgdex.net/en/zzz/simulated-sync-rewrite/999'
where id = (select alias_card_id from cat3b_fixture);

select
  'step 4a — alias image changed'                                   as step,
  ce.image_url_override                                             as stored_override,
  ce.image_url_override = f.source_image_at_admission               as override_unchanged,
  e.image_url                                                       as effective_image,
  e.image_url = f.source_image_at_admission                         as effective_unchanged
from cat3b_fixture f
join public.card_extras ce on ce.card_id = f.canonical_card_id
join public.cards_effective e on e.id = f.canonical_card_id;
-- Expected: override_unchanged = true, effective_unchanged = true.

update public.cards
set image_url = null
where id = (select alias_card_id from cat3b_fixture);

select
  'step 4b — alias image nulled'                                    as step,
  ce.image_url_override                                             as stored_override,
  ce.image_url_override = f.source_image_at_admission               as override_unchanged,
  e.image_url                                                       as effective_image,
  e.image_url = f.source_image_at_admission                         as effective_unchanged
from cat3b_fixture f
join public.card_extras ce on ce.card_id = f.canonical_card_id
join public.cards_effective e on e.id = f.canonical_card_id;
-- Expected: override_unchanged = true, effective_unchanged = true.
-- ⚠ THIS IS THE CENTRAL RESULT OF CAT-3B.


-- ── Step 4c — AN UNRELATED EDIT STILL SUCCEEDS, AND CHANGES NOTHING ─────────
-- ⚠ THE SECOND CENTRAL RESULT.
--
-- The source image has now been changed AND nulled, so the admitted override no
-- longer matches its source. If the trigger re-validated on every write, this
-- ordinary edit to an unrelated column would now FAIL — a routine change broken
-- by provider churn it has nothing to do with.
--
-- It must succeed, and it must leave both the stored override and the canonical
-- effective image untouched.
update public.card_extras
set source_note = 'cat-3b durability test — unrelated edit after source churn'
where card_id = (select canonical_card_id from cat3b_fixture);

select
  'step 4c — unrelated source_note edit'                            as step,
  ce.source_note                                                    as source_note_now,
  ce.image_url_override                                             as stored_override,
  ce.image_url_override = f.source_image_at_admission               as override_unchanged,
  e.image_url = f.source_image_at_admission                         as effective_unchanged
from cat3b_fixture f
join public.card_extras ce on ce.card_id = f.canonical_card_id
join public.cards_effective e on e.id = f.canonical_card_id;
-- Expected: the UPDATE did not raise, override_unchanged = true,
--           effective_unchanged = true.

-- Same again for the other overridable column, which shares this row.
update public.card_extras
set illustrator_override = 'CAT-3B Test Illustrator'
where card_id = (select canonical_card_id from cat3b_fixture);

select
  'step 4d — unrelated illustrator_override edit'                   as step,
  ce.illustrator_override                                           as illustrator_now,
  ce.image_url_override = f.source_image_at_admission               as override_unchanged,
  e.image_url = f.source_image_at_admission                         as effective_unchanged,
  e.illustrator = 'CAT-3B Test Illustrator'                         as illustrator_applied
from cat3b_fixture f
join public.card_extras ce on ce.card_id = f.canonical_card_id
join public.cards_effective e on e.id = f.canonical_card_id;
-- Expected: all three true. The two override channels are independent and
--           neither re-admits the other.


-- ── Step 5 — divergence is the REQUIRED outcome, not a defect ───────────────
select
  'step 5 — post-admission divergence'                              as step,
  a.image_url                                                       as source_image_now,
  ce.image_url_override                                             as stored_override,
  (a.image_url is distinct from ce.image_url_override)              as diverged_as_designed
from cat3b_fixture f
join public.cards a on a.id = f.alias_card_id
join public.card_extras ce on ce.card_id = f.canonical_card_id;
-- Expected: diverged_as_designed = true. See §0b.


-- ── Step 6 — the admission wall still rejects bad writes ────────────────────
-- Each of these MUST raise. Run them one at a time, uncommented, confirming
-- the error, then re-comment. They are left commented because a raised
-- exception aborts the surrounding transaction and would end the test run.
--
-- 6a — source is not an approved alias of this card:
--   insert into public.card_extras (card_id, image_url_override,
--     image_override_source_card_id, image_override_evidence,
--     image_override_approved_by, image_override_approved_at)
--   values ('base1-4', 'https://assets.tcgdex.net/en/base/base1/4',
--           'base1-5', '{}'::jsonb, 'test', now());
--   -- expect: "% is not an approved alias of it"
--
-- 6b — value does not match the source's current image_url:
--   (repeat step 3 with a mangled image_url_override)
--   -- expect: "does not match the current image_url of source"
--
-- 6c — incomplete provenance:
--   (repeat step 3 omitting image_override_approved_by)
--   -- expect: check constraint card_extras_image_override_all_or_nothing
--
-- 6d — non-TCGdex host:
--   (repeat step 3 with 'https://images.pokemontcg.io/base1/4')
--   -- expect: check constraint card_extras_image_override_shape


-- ── Step 7 — CLEARING the bundle is permitted, even after source churn ─────
-- Withdrawing an override is a legitimate act. It must not require the source
-- to still be admissible — which it no longer is, since step 4b nulled it.
update public.card_extras
set image_url_override            = null,
    image_override_source_card_id = null,
    image_override_evidence       = null,
    image_override_approved_by    = null,
    image_override_approved_at    = null
where card_id = (select canonical_card_id from cat3b_fixture);

select
  'step 7 — bundle cleared'                                        as step,
  ce.image_url_override is null                                     as override_cleared,
  e.image_url                                                       as effective_image,
  e.image_url is null                                               as fell_back_to_raw
from cat3b_fixture f
join public.card_extras ce on ce.card_id = f.canonical_card_id
join public.cards_effective e on e.id = f.canonical_card_id;
-- Expected: override_cleared = true, and the canonical card falls back to its
--           own raw image_url (null here, since it was the A2 case).

-- ⚠ NOTE ON RE-ADMISSION. Re-applying this bundle now would FAIL, and that is
--   correct: step 4b nulled the source image, so R3 can no longer admit it.
--   Withdrawing an override is always allowed; re-admitting is a NEW decision
--   and must meet the current bar. If a re-admit unexpectedly succeeded,
--   admission is not being enforced on material change — a STOP.


-- ── Step 8 — leave nothing behind ───────────────────────────────────────────
rollback;

-- Post-rollback sanity, run as its own statement afterwards:
--   select count(*) as override_rows from public.card_extras
--    where image_url_override is not null;   -- expect 0
