-- docs/sql/cat-2d2-1-family-a-reconciliation.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- CAT-2D.2 — Family A provider identity reconciliation
--
-- Populates public.card_identity_aliases with the 192 Family A renames whose
-- current TCGdex survivor ALREADY EXISTS in public.cards, and migrates the
-- mutable user-facing references that point at the obsolete ids.
--
--   swsh4.5-SV###   -> swsh4.5sv-SV###     Shining Fates Shiny Vault        122
--   swsh12.5-GG##   -> swsh12.5gg-GG##     Crown Zenith Galarian Gallery     70
--                                                                          ───
--                                                                          192
--
-- No sync run is required: every survivor is already stored.
--
-- ─────────────────────────────────────────────────────────────────────────
-- WHAT THIS FILE DOES NOT DO
-- ─────────────────────────────────────────────────────────────────────────
--   * deletes NOTHING from public.cards — the 192 obsolete rows are retained
--     raw provider history and simply stop appearing in cards_effective;
--   * never writes user_import_rows — historical matching evidence stays
--     byte-identical, and alias resolution happens at READ time (CAT-2D.1 §5);
--   * touches no Trainer Gallery id (Family B, blocked — CAT-2D §7.3);
--   * changes no ownership semantics beyond the resolution CAT-2D.1 shipped;
--   * does not restore the sync schedule and runs no sync.
--
-- ─────────────────────────────────────────────────────────────────────────
-- SOURCE OF TRUTH
-- ─────────────────────────────────────────────────────────────────────────
--   alias schema, no-chain trigger, resolution view, alias-aware consumers
--     -> docs/sql/cat-2d1-1-dark-alias-foundation.sql   (deployed, PR #12)
--   approved allowlist + per-pair upstream evidence
--     -> docs/cat-2d2-evidence/family-a-alias-set.csv
--        docs/cat-2d2-evidence/manifest.json
--   normalisers replicated in §4
--     -> src/utils/keys.js  normName / normNum   (frozen — never reimplement
--        differently; the copies here are asserted equal-by-construction in
--        scripts/cat2d2-family-a-alias-set.test.mjs)
--
-- ─────────────────────────────────────────────────────────────────────────
-- THE ADMISSION RULE, AND THE ONE PLACE IT DEPARTS FROM CAT-2D §3.4
-- ─────────────────────────────────────────────────────────────────────────
-- CAT-2D §3.4 rule 1 requires equal Tier-1 identity
-- (normName, normSet(set_name), normNum(local_id)) between alias and canonical.
--
-- FAMILY A CANNOT SATISFY THAT RULE, and pretending otherwise would be the
-- exact kind of unexamined pattern migration this slice must not be.
--
--   sync-cards.mjs :: mapCardToRow writes set_name from the set the provider
--   served the card under. These printings were ingested while they sat in the
--   PARENT set, so the obsolete rows carry 'Shining Fates' / 'Crown Zenith' /
--   while their survivors carry the subset names. normSet of
--   those differs, so the Tier-1 keys differ BY CONSTRUCTION.
--
-- That is also why Family A has never produced a Tier-1 collision and why the
-- CAT-2B1 guard has never refused these sets: the defect is a duplicated
-- PRINTING, not a duplicated identity key. (Family B is the opposite case —
-- the TG subset generation kept the subset set_name, so Tier-1 equality does
-- hold there. Nothing in this file relies on or affects that.)
--
-- Family A therefore substitutes, FOR THE SET COMPONENT ONLY, an explicitly
-- enumerated and separately evidenced set-rename pair, and keeps the other two
-- components strictly:
--
--   A1  the pairing lies inside an approved (parent -> canonical) set pair,
--       enumerated in §2 — never inferred, never wildcarded
--   A2  normNum(local_id) equal, exactly. normNum does NOT strip leading
--       zeros, so 'SV1' and 'SV001' are different printings and cannot pair
--   A3  normName(name) equal, exactly, evaluated against the STORED rows —
--       §5 P5. Not against the artifact, and not against upstream
--   A4  the parent set no longer serves ANY card in the family's local-id
--       namespace — observed upstream when the artifact was generated. This
--       is the evidence that the whole namespace MOVED, rather than that one
--       card happens to share a name and number with another
--   A5  the obsolete id 404s upstream and the canonical id 200s, per pair,
--       observed and dated in the artifact
--
-- A1+A2+A3 alone would still only be a same-name-same-number argument. A4 is
-- what makes it a rename. Name equality alone is explicitly insufficient, and
-- no cross-language, cross-printing or artwork-level equivalence is admitted.
--
-- ─────────────────────────────────────────────────────────────────────────
-- FAIL-CLOSED POSTURE — STRICTER THAN CAT-2D §6.2
-- ─────────────────────────────────────────────────────────────────────────
-- CAT-2D §6.2 permits SILENT MERGES for card_favorites, user_binder_cards,
-- price_history and user_card_intent when a user already holds both the
-- obsolete and the survivor row.
--
-- THIS MIGRATION IMPLEMENTS NO MERGE BRANCH AT ALL. Every collision in every
-- mutable table REFUSES the whole statement (§8). Rationale:
--
--   * a merge is the only operation in the entire CAT-2D design that destroys
--     information (§10), and it would do so without a human ever seeing it;
--   * Q-3 predicts ZERO collisions, so fail-closed is expected to cost
--     nothing — and if that prediction is wrong, that fact is far more
--     valuable than an automatic resolution;
--   * refusing keeps the migration a single reversible UPDATE of card_id.
--
-- If a collision is ever reported, resolving it is a separate, explicitly
-- approved operator decision — not a side effect of running this file.
--
-- ─────────────────────────────────────────────────────────────────────────
-- DEPLOYMENT ORDER — the established repository workflow
-- ─────────────────────────────────────────────────────────────────────────
--   1. independent review of the PR
--   2. run docs/sql/cat-2d2-2-family-a-validation.sql PHASE A. It captures the
--      pre-state, closes Q-1/Q-2/Q-3/Q-6/Q-7, and REFUSES on any merge
--      collision or artist_id regression before this file is ever run.
--   3. run THIS FILE. It is ONE top-level statement — a single `do` — so the
--      192 alias rows and every reference migration land together or not at
--      all, in one server-side transaction, whatever the client does with
--      statement batching (CAT-2D §6.3 — swsh12.5-GG19 must never be unowned,
--      not even mid-migration). See "ONE TOP-LEVEL STATEMENT" below for the
--      production incident that made this explicit.
--   4. run cat-2d2-2 PHASES C..G (post-deploy validation)
--   5. merge the PR and deploy the application change
--   6. production smoke test
--   7. run cat-2d2-2 PHASE H (cleanup) at the appropriate safe point
--
-- ⚠ PHASE A IS A HARD PREREQUISITE, NOT A COURTESY. §6 of this file reads
--   public.cat2d2_pre_refs and refuses if it is absent — see §6 for why the
--   captured pre-state must be compared, not merely trusted.
--
-- THE APPLICATION CHANGE DELIBERATELY LANDS AFTER THE SQL.
--   src/constants/artistEditorial.js moves swsh12.5-GG19 -> swsh12.5gg-GG19.
--   Between step 3 and step 5 the old id no longer resolves, so the Asako Ito
--   notable Altaria is omitted with a console warning — the expectName guard
--   FAILING SAFE, never substituting a different card. That brief, cosmetic,
--   self-healing omission is accepted rather than reordered around: splitting
--   the app constant into its own earlier PR would buy nothing and cost a
--   review boundary. Nothing else in the application reads the obsolete id.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- ONE TOP-LEVEL STATEMENT — WHY THIS FILE IS A SINGLE `DO`
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The first production deployment of this slice exposed a deployment-tool
-- assumption that was wrong, and it is worth stating plainly because the
-- original shape looked completely ordinary:
--
--   The migration used a top-level `begin;`, then `create temporary table ...
--   on commit drop`, then further TOP-LEVEL statements that referenced those
--   temp tables, then `commit;`.
--
--   In the Supabase SQL Editor those top-level statements do NOT behave as one
--   persistent transaction/session for this workflow. A harmless reproduction
--   confirmed it: the temp tables were gone before the later statements ran.
--
-- The durable CAT-2D.2 changes had nonetheless landed correctly, and
-- independent Phase C–G validation proved the final state good, so production
-- was neither re-run nor rolled back. This file is corrected so the ARTIFACT is
-- reproducible for any future replay or environment.
--
-- The correction is structural, not cosmetic:
--
--   * there is exactly ONE executable top-level statement — the `do` below;
--   * there is no top-level `begin;` / `commit;` to depend on;
--   * every temp table is created AND consumed inside that one statement;
--   * the locks, the proofs, the alias insert, the reference migration and the
--     final invariants all execute in one server-side transaction.
--
-- ATOMICITY, EXPLICITLY.
--   A `DO` issued outside an explicit transaction block runs inside its own
--   implicit transaction. Any exception raised anywhere in the block — a
--   REFUSED proof, a FAIL invariant, a constraint or trigger violation, a lock
--   timeout — aborts that transaction, so the alias rows and every reference
--   UPDATE roll back together. There is deliberately NO `exception when ...`
--   handler anywhere in this block: catching would create a subtransaction and
--   could let execution continue past a failed proof. Fail closed means fail
--   the whole statement.
--
--   The temp tables are `on commit drop`, so a successful run cleans up after
--   itself and a failed run never committed them in the first place.
--
-- scripts/cat2d2-family-a-alias-set.test.mjs asserts this shape structurally,
-- so the file cannot regress to a multi-statement, transaction-dependent
-- deployment.
-- ═══════════════════════════════════════════════════════════════════════════

do $cat2d2$
declare
  -- proofs / general
  v_n              bigint;
  v_now            bigint;
  v_detail         text;
  r                record;
  i                int;

  -- §6 drift refusal
  v_appeared       bigint;
  v_vanished       bigint;
  v_capt_refs      bigint;
  v_live_refs      bigint;

  -- §8 / §9 mutable references
  v_join           text;
  v_refs           bigint;
  v_derived_refs   bigint;
  v_coll           bigint;
  v_total_coll     bigint  := 0;
  v_report         text    := '';
  v_refs_by_ord    bigint[] := array[0, 0, 0, 0, 0, 0];
  v_migrated       bigint  := 0;

  -- in-transaction pre-state (plain scalars: a temp table cannot be used here,
  -- because a plpgsql %rowtype is resolved when the block is compiled, before
  -- any statement in it has run)
  v_pre_cards      bigint;
  v_pre_effective  bigint;
  v_pre_aliases    bigint;
  v_pre_import_ck  text;
  v_checksum       text;
begin

-- ═══════════════════════════════════════════════════════════════════════════
-- §1. SERIALIZE ALIAS TOPOLOGY WRITES   (binding requirement from CAT-2D.1 §2)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- CAT-2D.1 proved depth-1 alias topology only for SEQUENTIAL writers: the
-- two-sided R1/R2 trigger evaluates against the state each transaction can
-- see, so two concurrent privileged transactions could each pass and commit a
-- chain neither observed. Its binding requirement on this and every later
-- slice is an explicit lock taken BEFORE any alias row is read or written.
--
-- SHARE ROW EXCLUSIVE is the mode named there. It self-conflicts, so at most
-- one alias-topology writer exists at a time, while ordinary readers (the
-- resolution view, cards_effective, both RPCs) are unaffected.
--
-- Taken FIRST, before the §5 proofs read the table. Reading topology under a
-- weaker lock and then writing under a stronger one is the race this closes.
--
-- The mutable-reference tables are locked in the same mode for the same
-- reason: §8 proves "no collision exists", then §9 acts on that proof. Without
-- a lock a concurrent INSERT could create the colliding row in between.
-- Readers are not blocked; concurrent writers to these six tables are, for the
-- duration of one short transaction.
--
-- Lock order is fixed and alphabetical to keep this file deadlock-free against
-- itself if it is ever run twice concurrently by mistake.
--
-- If any of these relations does not exist, this aborts before a single row
-- has been read. That is the intended outcome: the §8 reference inventory
-- would be stale, and a stale inventory is the one condition under which this
-- migration could leave a live reference pointing at an id that has left the
-- effective catalog.
lock table public.card_identity_aliases in share row exclusive mode;
lock table public.card_extras           in share row exclusive mode;
lock table public.card_favorites        in share row exclusive mode;
lock table public.card_overrides        in share row exclusive mode;
lock table public.price_history         in share row exclusive mode;
lock table public.user_binder_cards     in share row exclusive mode;
lock table public.user_card_intent      in share row exclusive mode;

-- In-transaction pre-state, for the §10 deltas. Captured after the locks, so
-- nothing can move underneath it.
select count(*) into v_pre_cards     from public.cards;
select count(*) into v_pre_effective from public.cards_effective;
select count(*) into v_pre_aliases   from public.card_identity_aliases;
select md5(coalesce(string_agg(
         md5(coalesce(ir.card_id, '~') || '|' || ir.match_status),
         ',' order by ir.batch_id, ir.source_row_number), ''))
  into v_pre_import_ck
from public.user_import_rows ir;


-- ═══════════════════════════════════════════════════════════════════════════
-- §2. THE APPROVED SET-RENAME PAIRS   (A1)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The local-id patterns are ANCHORED and family-specific. They are the only
-- thing separating an obsolete subset row from an ordinary parent-set row
-- inside the same set_id — swsh4.5 also holds the 73 real Shining Fates cards
-- and swsh12.5 the 160 real Crown Zenith cards, and NONE of those may be
-- touched. A loose pattern here would widen the slice silently, so §5 P7 pins
-- the resulting counts exactly.
--
-- ⚠ ONLY families whose historical rows kept a STABLE local_id belong here.
--   Celebrations Classic Collection does not: production stores those rows as
--   cel25-2A / cel25-4A / cel25-15A1 / cel25-17A / cel25-60A / cel25-88A — the
--   numbers of the printings they reproduce — not cel25-CC###. The provider
--   changed the numbering as well as the set, so no A2-compliant pairing
--   exists. It is CAT-2D.3, a separate evidence class; do not add it here.
--
-- The SAME patterns appear in scripts/cat2d2-build-family-a-evidence.mjs and
-- are compared by scripts/cat2d2-family-a-alias-set.test.mjs.

create temporary table cat2d2_family (
  family              text primary key,
  alias_set_id        text not null,
  canonical_set_id    text not null,
  local_id_pattern    text not null,
  expected_count      int  not null
) on commit drop;

insert into cat2d2_family values
  ('shining_fates_sv', 'swsh4.5',  'swsh4.5sv',  '^SV[0-9]{3}$', 122),
  ('crown_zenith_gg',  'swsh12.5', 'swsh12.5gg', '^GG[0-9]{2}$',  70);


-- ═══════════════════════════════════════════════════════════════════════════
-- §3. THE APPROVED ALLOWLIST — 192 individually evidenced identity claims
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Generated from docs/cat-2d2-evidence/family-a-alias-set.csv, which was in
-- turn produced by a read-only upstream probe
-- (scripts/cat2d2-build-family-a-evidence.mjs). Every row was individually
-- observed: alias_upstream_status = 404, canonical_upstream_status = 200.
--
-- THIS IS AN ALLOWLIST, NOT A MATCHER (CAT-2D §7.1). A pair that is not
-- listed here cannot be created by this migration under any circumstance, and
-- a pair that IS listed here is still refused unless §5 proves it against the
-- stored rows. Both gates must pass.
--
-- The `name` column is the UPSTREAM survivor name at observation time. It is
-- carried for review and for the evidence payload. It is deliberately NOT the
-- value P5 tests: P5 compares stored obsolete name against stored survivor
-- name, so a drifting upstream name cannot make an unrelated pair look valid.
--
-- Do not hand-edit. Regenerate the artifact and re-derive this block; the
-- test asserts the two are identical.

create temporary table cat2d2_allowlist (
  family                    text not null,
  alias_card_id             text not null primary key,
  canonical_card_id         text not null,
  name                      text not null,
  local_id                  text not null,
  alias_upstream_status     int  not null,
  canonical_upstream_status int  not null
) on commit drop;

insert into cat2d2_allowlist
  (family, alias_card_id, canonical_card_id, name, local_id,
   alias_upstream_status, canonical_upstream_status)
values
    ('shining_fates_sv', 'swsh4.5-SV001', 'swsh4.5sv-SV001', 'Rowlet', 'SV001', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV002', 'swsh4.5sv-SV002', 'Dartrix', 'SV002', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV003', 'swsh4.5sv-SV003', 'Decidueye', 'SV003', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV004', 'swsh4.5sv-SV004', 'Grookey', 'SV004', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV005', 'swsh4.5sv-SV005', 'Thwackey', 'SV005', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV006', 'swsh4.5sv-SV006', 'Rillaboom', 'SV006', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV007', 'swsh4.5sv-SV007', 'Blipbug', 'SV007', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV008', 'swsh4.5sv-SV008', 'Dottler', 'SV008', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV009', 'swsh4.5sv-SV009', 'Orbeetle', 'SV009', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV010', 'swsh4.5sv-SV010', 'Gossifleur', 'SV010', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV011', 'swsh4.5sv-SV011', 'Eldegoss', 'SV011', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV012', 'swsh4.5sv-SV012', 'Applin', 'SV012', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV013', 'swsh4.5sv-SV013', 'Flapple', 'SV013', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV014', 'swsh4.5sv-SV014', 'Appletun', 'SV014', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV015', 'swsh4.5sv-SV015', 'Scorbunny', 'SV015', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV016', 'swsh4.5sv-SV016', 'Raboot', 'SV016', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV017', 'swsh4.5sv-SV017', 'Cinderace', 'SV017', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV018', 'swsh4.5sv-SV018', 'Sizzlipede', 'SV018', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV019', 'swsh4.5sv-SV019', 'Centiskorch', 'SV019', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV020', 'swsh4.5sv-SV020', 'Galarian Mr. Mime', 'SV020', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV021', 'swsh4.5sv-SV021', 'Galarian Mr. Rime', 'SV021', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV022', 'swsh4.5sv-SV022', 'Suicune', 'SV022', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV023', 'swsh4.5sv-SV023', 'Galarian Darumaka', 'SV023', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV024', 'swsh4.5sv-SV024', 'Galarian Darmanitan', 'SV024', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV025', 'swsh4.5sv-SV025', 'Sobble', 'SV025', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV026', 'swsh4.5sv-SV026', 'Drizzile', 'SV026', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV027', 'swsh4.5sv-SV027', 'Inteleon', 'SV027', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV028', 'swsh4.5sv-SV028', 'Chewtle', 'SV028', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV029', 'swsh4.5sv-SV029', 'Drednaw', 'SV029', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV030', 'swsh4.5sv-SV030', 'Cramorant', 'SV030', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV031', 'swsh4.5sv-SV031', 'Arrokuda', 'SV031', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV032', 'swsh4.5sv-SV032', 'Barraskewda', 'SV032', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV033', 'swsh4.5sv-SV033', 'Snom', 'SV033', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV034', 'swsh4.5sv-SV034', 'Frosmoth', 'SV034', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV035', 'swsh4.5sv-SV035', 'Eiscue', 'SV035', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV036', 'swsh4.5sv-SV036', 'Dracovish', 'SV036', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV037', 'swsh4.5sv-SV037', 'Arctovish', 'SV037', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV038', 'swsh4.5sv-SV038', 'Rotom', 'SV038', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV039', 'swsh4.5sv-SV039', 'Yamper', 'SV039', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV040', 'swsh4.5sv-SV040', 'Boltund', 'SV040', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV041', 'swsh4.5sv-SV041', 'Toxel', 'SV041', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV042', 'swsh4.5sv-SV042', 'Toxtricity', 'SV042', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV043', 'swsh4.5sv-SV043', 'Pincurchin', 'SV043', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV044', 'swsh4.5sv-SV044', 'Morpeko', 'SV044', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV045', 'swsh4.5sv-SV045', 'Dracozolt', 'SV045', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV046', 'swsh4.5sv-SV046', 'Arctozolt', 'SV046', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV047', 'swsh4.5sv-SV047', 'Galarian Ponyta', 'SV047', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV048', 'swsh4.5sv-SV048', 'Galarian Rapidash', 'SV048', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV049', 'swsh4.5sv-SV049', 'Galarian Corsola', 'SV049', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV050', 'swsh4.5sv-SV050', 'Galarian Cursola', 'SV050', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV051', 'swsh4.5sv-SV051', 'Dedenne', 'SV051', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV052', 'swsh4.5sv-SV052', 'Sinistea', 'SV052', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV053', 'swsh4.5sv-SV053', 'Polteageist', 'SV053', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV054', 'swsh4.5sv-SV054', 'Hatenna', 'SV054', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV055', 'swsh4.5sv-SV055', 'Hattrem', 'SV055', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV056', 'swsh4.5sv-SV056', 'Hatterene', 'SV056', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV057', 'swsh4.5sv-SV057', 'Milcery', 'SV057', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV058', 'swsh4.5sv-SV058', 'Alcremie', 'SV058', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV059', 'swsh4.5sv-SV059', 'Indeedee', 'SV059', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV060', 'swsh4.5sv-SV060', 'Dreepy', 'SV060', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV061', 'swsh4.5sv-SV061', 'Drakloak', 'SV061', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV062', 'swsh4.5sv-SV062', 'Dragapult', 'SV062', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV063', 'swsh4.5sv-SV063', 'Galarian Farfetch''d', 'SV063', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV064', 'swsh4.5sv-SV064', 'Galarian Sirfetch''d', 'SV064', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV065', 'swsh4.5sv-SV065', 'Galarian Yamask', 'SV065', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV066', 'swsh4.5sv-SV066', 'Galarian Runerigus', 'SV066', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV067', 'swsh4.5sv-SV067', 'Rolycoly', 'SV067', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV068', 'swsh4.5sv-SV068', 'Carkol', 'SV068', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV069', 'swsh4.5sv-SV069', 'Coalossal', 'SV069', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV070', 'swsh4.5sv-SV070', 'Silicobra', 'SV070', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV071', 'swsh4.5sv-SV071', 'Sandaconda', 'SV071', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV072', 'swsh4.5sv-SV072', 'Clobbopus', 'SV072', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV073', 'swsh4.5sv-SV073', 'Grapploct', 'SV073', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV074', 'swsh4.5sv-SV074', 'Falinks', 'SV074', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV075', 'swsh4.5sv-SV075', 'Stonjourner', 'SV075', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV076', 'swsh4.5sv-SV076', 'Koffing', 'SV076', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV077', 'swsh4.5sv-SV077', 'Galarian Weezing', 'SV077', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV078', 'swsh4.5sv-SV078', 'Galarian Zigzagoon', 'SV078', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV079', 'swsh4.5sv-SV079', 'Galarian Linoone', 'SV079', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV080', 'swsh4.5sv-SV080', 'Galarian Obstagoon', 'SV080', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV081', 'swsh4.5sv-SV081', 'Nickit', 'SV081', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV082', 'swsh4.5sv-SV082', 'Thievul', 'SV082', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV083', 'swsh4.5sv-SV083', 'Impidimp', 'SV083', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV084', 'swsh4.5sv-SV084', 'Morgrem', 'SV084', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV085', 'swsh4.5sv-SV085', 'Grimmsnarl', 'SV085', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV086', 'swsh4.5sv-SV086', 'Galarian Meowth', 'SV086', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV087', 'swsh4.5sv-SV087', 'Galarian Perrserker', 'SV087', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV088', 'swsh4.5sv-SV088', 'Galarian Stunfisk', 'SV088', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV089', 'swsh4.5sv-SV089', 'Corviknight', 'SV089', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV090', 'swsh4.5sv-SV090', 'Cufant', 'SV090', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV091', 'swsh4.5sv-SV091', 'Copperajah', 'SV091', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV092', 'swsh4.5sv-SV092', 'Duraludon', 'SV092', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV093', 'swsh4.5sv-SV093', 'Minccino', 'SV093', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV094', 'swsh4.5sv-SV094', 'Cinccino', 'SV094', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV095', 'swsh4.5sv-SV095', 'Ducklett', 'SV095', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV096', 'swsh4.5sv-SV096', 'Swanna', 'SV096', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV097', 'swsh4.5sv-SV097', 'Bunnelby', 'SV097', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV098', 'swsh4.5sv-SV098', 'Oranguru', 'SV098', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV099', 'swsh4.5sv-SV099', 'Skwovet', 'SV099', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV100', 'swsh4.5sv-SV100', 'Greedent', 'SV100', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV101', 'swsh4.5sv-SV101', 'Rookidee', 'SV101', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV102', 'swsh4.5sv-SV102', 'Corvisquire', 'SV102', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV103', 'swsh4.5sv-SV103', 'Wooloo', 'SV103', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV104', 'swsh4.5sv-SV104', 'Dubwool', 'SV104', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV105', 'swsh4.5sv-SV105', 'Rillaboom V', 'SV105', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV106', 'swsh4.5sv-SV106', 'Rillaboom VMAX', 'SV106', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV107', 'swsh4.5sv-SV107', 'Charizard VMAX', 'SV107', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV108', 'swsh4.5sv-SV108', 'Centiskorch V', 'SV108', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV109', 'swsh4.5sv-SV109', 'Centiskorch VMAX', 'SV109', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV110', 'swsh4.5sv-SV110', 'Lapras V', 'SV110', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV111', 'swsh4.5sv-SV111', 'Lapras VMAX', 'SV111', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV112', 'swsh4.5sv-SV112', 'Toxtricity V', 'SV112', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV113', 'swsh4.5sv-SV113', 'Toxtricity VMAX', 'SV113', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV114', 'swsh4.5sv-SV114', 'Indeedee V', 'SV114', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV115', 'swsh4.5sv-SV115', 'Falinks V', 'SV115', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV116', 'swsh4.5sv-SV116', 'Grimmsnarl V', 'SV116', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV117', 'swsh4.5sv-SV117', 'Grimmsnarl VMAX', 'SV117', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV118', 'swsh4.5sv-SV118', 'Ditto V', 'SV118', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV119', 'swsh4.5sv-SV119', 'Ditto VMAX', 'SV119', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV120', 'swsh4.5sv-SV120', 'Dubwool V', 'SV120', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV121', 'swsh4.5sv-SV121', 'Eternatus V', 'SV121', 404, 200),
    ('shining_fates_sv', 'swsh4.5-SV122', 'swsh4.5sv-SV122', 'Eternatus VMAX', 'SV122', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG01', 'swsh12.5gg-GG01', 'Hisuian Voltorb', 'GG01', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG02', 'swsh12.5gg-GG02', 'Kricketune', 'GG02', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG03', 'swsh12.5gg-GG03', 'Magmortar', 'GG03', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG04', 'swsh12.5gg-GG04', 'Oricorio', 'GG04', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG05', 'swsh12.5gg-GG05', 'Lapras', 'GG05', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG06', 'swsh12.5gg-GG06', 'Manaphy', 'GG06', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG07', 'swsh12.5gg-GG07', 'Keldeo', 'GG07', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG08', 'swsh12.5gg-GG08', 'Electivire', 'GG08', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG09', 'swsh12.5gg-GG09', 'Toxtricity', 'GG09', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG10', 'swsh12.5gg-GG10', 'Mew', 'GG10', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG11', 'swsh12.5gg-GG11', 'Lunatone', 'GG11', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG12', 'swsh12.5gg-GG12', 'Deoxys', 'GG12', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG13', 'swsh12.5gg-GG13', 'Diancie', 'GG13', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG14', 'swsh12.5gg-GG14', 'Comfey', 'GG14', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG15', 'swsh12.5gg-GG15', 'Solrock', 'GG15', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG16', 'swsh12.5gg-GG16', 'Absol', 'GG16', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG17', 'swsh12.5gg-GG17', 'Thievul', 'GG17', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG18', 'swsh12.5gg-GG18', 'Magnezone', 'GG18', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG19', 'swsh12.5gg-GG19', 'Altaria', 'GG19', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG20', 'swsh12.5gg-GG20', 'Latias', 'GG20', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG21', 'swsh12.5gg-GG21', 'Hisuian Goodra', 'GG21', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG22', 'swsh12.5gg-GG22', 'Ditto', 'GG22', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG23', 'swsh12.5gg-GG23', 'Dunsparce', 'GG23', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG24', 'swsh12.5gg-GG24', 'Miltank', 'GG24', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG25', 'swsh12.5gg-GG25', 'Bibarel', 'GG25', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG26', 'swsh12.5gg-GG26', 'Riolu', 'GG26', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG27', 'swsh12.5gg-GG27', 'Swablu', 'GG27', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG28', 'swsh12.5gg-GG28', 'Duskull', 'GG28', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG29', 'swsh12.5gg-GG29', 'Bidoof', 'GG29', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG30', 'swsh12.5gg-GG30', 'Pikachu', 'GG30', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG31', 'swsh12.5gg-GG31', 'Turtwig', 'GG31', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG32', 'swsh12.5gg-GG32', 'Paras', 'GG32', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG33', 'swsh12.5gg-GG33', 'Poochyena', 'GG33', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG34', 'swsh12.5gg-GG34', 'Mareep', 'GG34', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG35', 'swsh12.5gg-GG35', 'Leafeon VSTAR', 'GG35', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG36', 'swsh12.5gg-GG36', 'Entei V', 'GG36', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG37', 'swsh12.5gg-GG37', 'Simisear VSTAR', 'GG37', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG38', 'swsh12.5gg-GG38', 'Suicune V', 'GG38', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG39', 'swsh12.5gg-GG39', 'Lumineon V', 'GG39', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG40', 'swsh12.5gg-GG40', 'Glaceon VSTAR', 'GG40', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG41', 'swsh12.5gg-GG41', 'Raikou V', 'GG41', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG42', 'swsh12.5gg-GG42', 'Zeraora VMAX', 'GG42', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG43', 'swsh12.5gg-GG43', 'Zeraora VSTAR', 'GG43', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG44', 'swsh12.5gg-GG44', 'Mewtwo VSTAR', 'GG44', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG45', 'swsh12.5gg-GG45', 'Deoxys VMAX', 'GG45', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG46', 'swsh12.5gg-GG46', 'Deoxys VSTAR', 'GG46', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG47', 'swsh12.5gg-GG47', 'Hatterene VMAX', 'GG47', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG48', 'swsh12.5gg-GG48', 'Zacian V', 'GG48', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG49', 'swsh12.5gg-GG49', 'Drapion V', 'GG49', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG50', 'swsh12.5gg-GG50', 'Darkrai VSTAR', 'GG50', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG51', 'swsh12.5gg-GG51', 'Hisuian Samurott V', 'GG51', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG52', 'swsh12.5gg-GG52', 'Hisuian Samurott VSTAR', 'GG52', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG53', 'swsh12.5gg-GG53', 'Hoopa V', 'GG53', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG54', 'swsh12.5gg-GG54', 'Zamazenta V', 'GG54', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG55', 'swsh12.5gg-GG55', 'Regigigas VSTAR', 'GG55', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG56', 'swsh12.5gg-GG56', 'Hisuian Zoroark VSTAR', 'GG56', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG57', 'swsh12.5gg-GG57', 'Adaman', 'GG57', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG58', 'swsh12.5gg-GG58', 'Cheren''s Care', 'GG58', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG59', 'swsh12.5gg-GG59', 'Colress''s Experiment', 'GG59', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG60', 'swsh12.5gg-GG60', 'Cynthia''s Ambition', 'GG60', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG61', 'swsh12.5gg-GG61', 'Gardenia''s Vigor', 'GG61', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG62', 'swsh12.5gg-GG62', 'Grant', 'GG62', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG63', 'swsh12.5gg-GG63', 'Irida', 'GG63', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG64', 'swsh12.5gg-GG64', 'Melony', 'GG64', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG65', 'swsh12.5gg-GG65', 'Raihan', 'GG65', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG66', 'swsh12.5gg-GG66', 'Roxanne', 'GG66', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG67', 'swsh12.5gg-GG67', 'Origin Forme Palkia VSTAR', 'GG67', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG68', 'swsh12.5gg-GG68', 'Origin Forme Dialga VSTAR', 'GG68', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG69', 'swsh12.5gg-GG69', 'Giratina VSTAR', 'GG69', 404, 200),
    ('crown_zenith_gg', 'swsh12.5-GG70', 'swsh12.5gg-GG70', 'Arceus VSTAR', 'GG70', 404, 200);


-- ═══════════════════════════════════════════════════════════════════════════
-- §4. FROZEN NORMALISERS — inlined transcriptions of src/utils/keys.js
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Previously two pg_temp functions. They are now INLINE expressions, evaluated
-- once per pair in the §5 map, because `create function` inside a `do` block
-- would need its own dollar-quoting nested in this one — avoidable complexity
-- in a file whose whole point is that it is a single statement.
--
-- These are transcriptions of the frozen ownership normalisers:
--
--   normName = s => (s||"").toLowerCase().trim()
--                          .replace(/[^a-z0-9\s]/g,"").replace(/\s+/g," ")
--   normNum  = n => (n||"").toString().toLowerCase().trim()
--                          .replace(/\/.*$/,"").trim()
--
-- Note there is deliberately NO trailing btrim in the name transcription: the
-- JS trims BEFORE stripping punctuation, so a name like 'Umbreon ☆' normalises
-- to 'umbreon ' WITH a trailing space. Adding a final btrim here would be
-- "obviously correct" and would silently diverge from the importer.
--
-- POSIX [:space:] and JavaScript \s are not identical (JS also matches NBSP
-- and friends). That divergence cannot affect this migration: P5 compares one
-- STORED name against another STORED name using the same expression on both
-- sides. No value normalised here is ever compared to a JS-normalised value.


-- ═══════════════════════════════════════════════════════════════════════════
-- §5. DERIVE THE CANDIDATE PAIRS FROM STORED EVIDENCE, AND PROVE EVERY ONE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Nothing above has claimed that any of the 192 obsolete ids actually exists in
-- public.cards, or that the stored rows say what the artifact says. §5 does
-- exactly that, against production data, and refuses on any discrepancy.
--
-- The two sets must match EXACTLY in both directions:
--   * a stored row inside an approved namespace that is NOT on the allowlist
--     means the namespace is wider than the approval — refuse (P2);
--   * an allowlist entry with no stored row means the artifact describes a
--     printing this database never ingested, or ingested under a different id
--     shape — refuse (P3). P3 is the check that fires if, say, the obsolete
--     rows were stored as 'swsh4.5-SV1' rather than 'swsh4.5-SV001'. It is
--     meant to fire loudly rather than be worked around — and it is exactly the
--     class of refusal that caught Celebrations before any row was written.

-- 5a. Stored obsolete candidates — selected ONLY by an approved
--     (set_id, anchored local-id pattern) pair. This is the pattern's entire
--     job: propose candidates. It proves nothing on its own.
create temporary table cat2d2_stored_obsolete on commit drop as
select c.id, c.name, c.set_id, c.set_name, c.local_id, f.family
from public.cards c
join cat2d2_family f on f.alias_set_id = c.set_id
where c.local_id ~ f.local_id_pattern;

create unique index on cat2d2_stored_obsolete (id);

-- 5b. The proven map: allowlist ∩ stored obsolete ∩ stored survivor.
--     Every column below comes from a REAL ROW, not from the artifact, except
--     the two upstream statuses which are observation records by nature.
--     The four norm_* columns apply the §4 transcriptions to STORED values.
create temporary table cat2d2_map on commit drop as
select
  a.family,
  a.alias_card_id,
  a.canonical_card_id,
  a.alias_upstream_status,
  a.canonical_upstream_status,
  o.name      as alias_name,
  o.set_id    as alias_set_id,
  o.set_name  as alias_set_name,
  o.local_id  as alias_local_id,
  o.artist_id as alias_artist_id,
  s.name      as canonical_name,
  s.set_id    as canonical_set_id,
  s.set_name  as canonical_set_name,
  s.local_id  as canonical_local_id,
  s.artist_id as canonical_artist_id,
  regexp_replace(
    regexp_replace(lower(btrim(coalesce(o.name, ''))), '[^a-z0-9[:space:]]', '', 'g'),
    '[[:space:]]+', ' ', 'g')                                        as alias_norm_name,
  regexp_replace(
    regexp_replace(lower(btrim(coalesce(s.name, ''))), '[^a-z0-9[:space:]]', '', 'g'),
    '[[:space:]]+', ' ', 'g')                                        as canonical_norm_name,
  btrim(regexp_replace(lower(btrim(coalesce(o.local_id, ''))), '/.*$', ''))  as alias_norm_num,
  btrim(regexp_replace(lower(btrim(coalesce(s.local_id, ''))), '/.*$', ''))  as canonical_norm_num
from cat2d2_allowlist a
join public.cards o on o.id = a.alias_card_id
join public.cards s on s.id = a.canonical_card_id;

create unique index on cat2d2_map (alias_card_id);
create index on cat2d2_map (canonical_card_id);

-- ── P1. The allowlist is internally well formed ───────────────────────────
select count(*) into v_n from cat2d2_allowlist;
if v_n <> 192 then
  raise exception 'CAT-2D.2 REFUSED (P1): allowlist holds % rows, expected 192', v_n;
end if;

for r in
  select f.family, f.expected_count, count(a.alias_card_id) as actual
  from cat2d2_family f
  left join cat2d2_allowlist a on a.family = f.family
  group by f.family, f.expected_count
loop
  if r.actual <> r.expected_count then
    raise exception 'CAT-2D.2 REFUSED (P1): family % holds % allowlist rows, expected %',
      r.family, r.actual, r.expected_count;
  end if;
end loop;

-- id shape: both ids must be exactly '<set_id>-<local_id>' for their family.
select count(*) into v_n
from cat2d2_allowlist a
join cat2d2_family f on f.family = a.family
where a.alias_card_id     <> f.alias_set_id     || '-' || a.local_id
   or a.canonical_card_id <> f.canonical_set_id || '-' || a.local_id
   or a.local_id !~ f.local_id_pattern;
if v_n <> 0 then
  raise exception 'CAT-2D.2 REFUSED (P1): % allowlist row(s) have a malformed id or local_id', v_n;
end if;

-- A5, as recorded per pair.
select count(*) into v_n from cat2d2_allowlist
where alias_upstream_status <> 404 or canonical_upstream_status <> 200;
if v_n <> 0 then
  raise exception 'CAT-2D.2 REFUSED (P1/A5): % allowlist row(s) do not carry alias=404 / canonical=200', v_n;
end if;

-- 1:1, no self-alias, no chain WITHIN the allowlist itself.
select count(*) into v_n from (
  select canonical_card_id from cat2d2_allowlist group by canonical_card_id having count(*) > 1
) q;
if v_n <> 0 then
  raise exception 'CAT-2D.2 REFUSED (P1): % survivor(s) are claimed by more than one alias — Family A is 1:1', v_n;
end if;
select count(*) into v_n from cat2d2_allowlist where alias_card_id = canonical_card_id;
if v_n <> 0 then
  raise exception 'CAT-2D.2 REFUSED (P1): % self-alias row(s) in the allowlist', v_n;
end if;
select count(*) into v_n
from cat2d2_allowlist a join cat2d2_allowlist b on b.canonical_card_id = a.alias_card_id;
if v_n <> 0 then
  raise exception 'CAT-2D.2 REFUSED (P1): % allowlist id(s) appear as both an alias and a survivor', v_n;
end if;

-- ── P2. No stored row inside an approved namespace is unlisted ────────────
--     v_n is the TRUE total; v_detail samples the first 20, so a wide
--     mismatch can never be misread as a small one.
select count(*) into v_n from cat2d2_stored_obsolete so
where not exists (select 1 from cat2d2_allowlist a where a.alias_card_id = so.id);
if v_n <> 0 then
  select string_agg(id, ', ' order by id) into v_detail from (
    select so.id from cat2d2_stored_obsolete so
    where not exists (select 1 from cat2d2_allowlist a where a.alias_card_id = so.id)
    order by so.id limit 20
  ) q;
  raise exception
    'CAT-2D.2 REFUSED (P2): % stored row(s) in an approved namespace are NOT on the allowlist — the approval does not cover what is stored. First 20: %',
    v_n, v_detail;
end if;

-- ── P3. Every allowlist alias id exists as a stored row ───────────────────
select count(*) into v_n from cat2d2_allowlist a
where not exists (select 1 from cat2d2_stored_obsolete so where so.id = a.alias_card_id);
if v_n <> 0 then
  select string_agg(alias_card_id, ', ' order by alias_card_id) into v_detail from (
    select a.alias_card_id from cat2d2_allowlist a
    where not exists (select 1 from cat2d2_stored_obsolete so where so.id = a.alias_card_id)
    order by a.alias_card_id limit 20
  ) q;
  raise exception
    'CAT-2D.2 REFUSED (P3): % allowlist alias id(s) have no row in public.cards — the stored id shape does not match the artifact. First 20: %',
    v_n, v_detail;
end if;

-- ── P4. Every survivor exists, in the approved canonical set ──────────────
select count(*) into v_n from cat2d2_allowlist a
where not exists (select 1 from public.cards c where c.id = a.canonical_card_id);
if v_n <> 0 then
  select string_agg(canonical_card_id, ', ' order by canonical_card_id) into v_detail from (
    select a.canonical_card_id from cat2d2_allowlist a
    where not exists (select 1 from public.cards c where c.id = a.canonical_card_id)
    order by a.canonical_card_id limit 20
  ) q;
  raise exception 'CAT-2D.2 REFUSED (P4): % survivor(s) absent from public.cards. First 20: %', v_n, v_detail;
end if;

select count(*) into v_n
from cat2d2_map m join cat2d2_family f on f.family = m.family
where m.alias_set_id <> f.alias_set_id or m.canonical_set_id <> f.canonical_set_id;
if v_n <> 0 then
  raise exception 'CAT-2D.2 REFUSED (P4): % row(s) have a stored set_id outside the approved rename pair', v_n;
end if;

-- The map must now be complete. If it is not, one of the joins above lost a
-- row for a reason P2/P3/P4 did not name — refuse rather than proceed on a
-- partial map.
select count(*) into v_n from cat2d2_map;
if v_n <> 192 then
  raise exception 'CAT-2D.2 REFUSED (P4): proven map holds % pairs, expected 192', v_n;
end if;

-- ── P5 (A3). normName equality, STORED vs STORED ──────────────────────────
select count(*) into v_n from cat2d2_map
where alias_norm_name <> canonical_norm_name or alias_norm_name = '';
if v_n <> 0 then
  select string_agg(format('%s "%s" <> %s "%s"',
           alias_card_id, alias_name, canonical_card_id, canonical_name), '; ') into v_detail
  from (
    select * from cat2d2_map
    where alias_norm_name <> canonical_norm_name or alias_norm_name = ''
    order by alias_card_id limit 10
  ) q;
  raise exception 'CAT-2D.2 REFUSED (P5/A3): % pair(s) fail normName equality. First 10: %', v_n, v_detail;
end if;

-- ── P6 (A2). normNum equality, STORED vs STORED ───────────────────────────
select count(*) into v_n from cat2d2_map
where alias_norm_num <> canonical_norm_num or alias_norm_num = '';
if v_n <> 0 then
  raise exception 'CAT-2D.2 REFUSED (P6/A2): % pair(s) fail normNum equality', v_n;
end if;

-- ── P7. Exact per-family counts against stored rows ───────────────────────
for r in
  select f.family, f.expected_count, count(m.alias_card_id) as actual
  from cat2d2_family f
  left join cat2d2_map m on m.family = f.family
  group by f.family, f.expected_count
loop
  if r.actual <> r.expected_count then
    raise exception 'CAT-2D.2 REFUSED (P7): family % proved % pairs against stored rows, expected %',
      r.family, r.actual, r.expected_count;
  end if;
  raise notice 'CAT-2D.2 family % — % proven pairs', rpad(r.family, 18), r.actual;
end loop;

-- ── P8. A survivor must not itself be obsolete ────────────────────────────
select count(*) into v_n
from cat2d2_map m
where exists (select 1 from cat2d2_stored_obsolete so where so.id = m.canonical_card_id);
if v_n <> 0 then
  raise exception 'CAT-2D.2 REFUSED (P8): % survivor(s) are themselves obsolete candidates', v_n;
end if;

-- ── P9. Nothing here is already aliased, in either direction ──────────────
--     The R1/R2 trigger would catch a chain, but a clear refusal beats a
--     trigger message, and this also makes a partial re-run impossible to
--     mistake for success.
select count(*) into v_n
from public.card_identity_aliases x
join cat2d2_allowlist a
  on a.alias_card_id     in (x.alias_card_id, x.canonical_card_id)
  or a.canonical_card_id in (x.alias_card_id, x.canonical_card_id);
if v_n <> 0 then
  raise exception
    'CAT-2D.2 REFUSED (P9): % existing alias row(s) already reference a Family A id — this migration has already run, or a conflicting claim exists',
    v_n;
end if;

-- ── P10. All 192 obsolete ids are visible in cards_effective TODAY ────────
--     This is what makes the §10 delta assertion meaningful: the effective
--     catalog must shrink by exactly 192, no more and no less.
select count(*) into v_n
from cat2d2_map m join public.cards_effective ce on ce.id = m.alias_card_id;
if v_n <> 192 then
  raise exception
    'CAT-2D.2 REFUSED (P10): % of 192 obsolete ids are currently in cards_effective — the expected delta is not 192', v_n;
end if;

-- ── P11. ARTIST-FIRST GATE — the survivor must not lose artist reachability
--
--   Artist Page loads a curated artist's cards by EXACT public.cards.artist_id
--   (cardService.fetchArtistCards, the FK-only branch). Aliasing removes the
--   obsolete row from the effective catalog, so from that moment the ONLY row
--   that can represent this printing on an artist page is the survivor.
--
--   Migrating card_extras (§9) changes the survivor's EFFECTIVE illustrator —
--   cards_effective.illustrator is coalesce(card_extras.illustrator_override,
--   cards.illustrator) — but it does NOT touch public.cards.artist_id, which
--   is written only by the sync at card-write time. So a printing whose
--   obsolete row carries an artist_id and whose survivor does not would
--   silently LEAVE its artist's page.
--
--   CAT-2A/CAT-0 evidence makes this a live possibility, not a hypothetical:
--   48 of 70 swsh12.5gg rows and 100 of 122 swsh4.5sv rows have an illustrator
--   but a NULL artist_id.
--
--   Semantics, exactly:
--     obsolete NULL                      -> allowed, whatever the survivor has
--     obsolete NOT NULL, survivor equal  -> allowed
--     obsolete NOT NULL, survivor NULL   -> REFUSE (reachability would be lost)
--     obsolete NOT NULL, survivor differs-> REFUSE (two artist claims)
--
--   This slice does NOT repair public.cards.artist_id. CAT-2D.2 is identity
--   reconciliation, not illustrator/artist restoration. A refusal here stops
--   the deployment and becomes an evidence-backed follow-up decision.
select count(*) into v_n
from cat2d2_map m
where m.alias_artist_id is not null
  and (m.canonical_artist_id is null or m.canonical_artist_id <> m.alias_artist_id);
if v_n <> 0 then
  select string_agg(format('%s artist_id=%s -> %s artist_id=%s',
           alias_card_id, alias_artist_id, canonical_card_id,
           coalesce(canonical_artist_id, '<null>')), '; ') into v_detail
  from (
    select * from cat2d2_map
    where alias_artist_id is not null
      and (canonical_artist_id is null or canonical_artist_id <> alias_artist_id)
    order by alias_card_id limit 10
  ) q;
  raise exception
    'CAT-2D.2 REFUSED (P11): % pair(s) would lose or contradict artist reachability. Aliasing removes the obsolete row from the effective catalog, and this slice does not repair cards.artist_id. First 10: %',
    v_n, v_detail;
end if;

select count(*) into v_n from cat2d2_map where alias_artist_id is not null;
raise notice 'CAT-2D.2 P11 PASSED — % of 192 obsolete rows carry an artist_id; every one is preserved on its survivor.', v_n;
raise notice 'CAT-2D.2 §5 PASSED — 192 pairs proven against stored rows.';


-- ═══════════════════════════════════════════════════════════════════════════
-- §6. PRE-STATE DRIFT REFUSAL — the captured undo list must still be exact
-- ═══════════════════════════════════════════════════════════════════════════
--
-- THE GAP THIS CLOSES.
--   Validation PHASE A persists public.cat2d2_pre_refs: the exact
--   (table_name, row_key, card_id) list of every mutable reference pointing at
--   a Family A obsolete id at capture time. That list is the slice's undo list
--   (§ROLLBACK), and Phase F re-checks it.
--
--   But Phase A and this file are SEPARATE SQL Editor runs, minutes or hours
--   apart, with NO lock held in between. In that window a collector can
--   favourite a card, save a price point, set a hunt intent, add a binder row,
--   or clear an override. Nothing in the original design noticed:
--     * §8 counts references as they are NOW, under the locks — a count that
--       silently includes rows Phase A never saw;
--     * §9 then migrates exactly those rows.
--   The result would commit cleanly while cat2d2_pre_refs — the thing a
--   rollback depends on — no longer described what was actually changed.
--
--   Comparing totals is not sufficient: one insert plus one delete leaves the
--   count identical while both endpoints are wrong. So the comparison is an
--   EXACT SET comparison on (table_name, row_key, card_id), in BOTH directions.
--
-- WHY IT IS SAFE TO DO IT HERE.
--   The §1 locks are already held, so the set derived below cannot move again
--   before §9 migrates it. From this point the captured list, the scanned list
--   and the migrated list are provably the same rows.
--
-- row_key MUST be built exactly as Phase A builds it — same key columns, same
-- jsonb shape, per table — or the comparison would report drift that is really
-- a formatting difference. The six branches below are deliberately written out
-- rather than generated, so a reviewer can diff them against Phase A by eye.
-- card_extras is keyed by card_id alone, so its row_key is the empty object.

if to_regclass('public.cat2d2_pre_refs') is null then
  raise exception
    'CAT-2D.2 REFUSED (§6): public.cat2d2_pre_refs does not exist. PHASE A of docs/sql/cat-2d2-2-family-a-validation.sql is a HARD PREREQUISITE — it captures the pre-state this migration is required to prove it is still acting on. Run Phase A, then re-run this file.';
end if;

create temporary table cat2d2_current_refs on commit drop as
  select 'card_extras'::text       as table_name,
         jsonb_build_object()                                              as row_key,
         t.card_id
    from public.card_extras t       join cat2d2_map m on m.alias_card_id = t.card_id
union all
  select 'card_favorites',
         jsonb_build_object('user_id', t.user_id),
         t.card_id
    from public.card_favorites t    join cat2d2_map m on m.alias_card_id = t.card_id
union all
  select 'card_overrides',
         jsonb_build_object('user_id', t.user_id),
         t.card_id
    from public.card_overrides t    join cat2d2_map m on m.alias_card_id = t.card_id
union all
  select 'price_history',
         jsonb_build_object('user_id', t.user_id, 'recorded_date', t.recorded_date),
         t.card_id
    from public.price_history t     join cat2d2_map m on m.alias_card_id = t.card_id
union all
  select 'user_binder_cards',
         jsonb_build_object('binder_id', t.binder_id),
         t.card_id
    from public.user_binder_cards t join cat2d2_map m on m.alias_card_id = t.card_id
union all
  select 'user_card_intent',
         jsonb_build_object('user_id', t.user_id),
         t.card_id
    from public.user_card_intent t  join cat2d2_map m on m.alias_card_id = t.card_id;

select count(*) into v_capt_refs from public.cat2d2_pre_refs;
select count(*) into v_live_refs from cat2d2_current_refs;

-- Each table's unique key makes (table_name, row_key, card_id) unique within
-- it, so EXCEPT is a faithful set difference here. The count equality below
-- is asserted as well, so a duplicate that somehow existed could not hide.

-- D1. APPEARED — a reference exists now that Phase A did not capture.
select count(*) into v_appeared from (
  select table_name, row_key, card_id from cat2d2_current_refs
  except
  select table_name, row_key, card_id from public.cat2d2_pre_refs
) q;
if v_appeared <> 0 then
  select string_agg(format('%s %s -> %s', table_name, row_key::text, card_id), '; ') into v_detail
  from (
    select table_name, row_key, card_id from cat2d2_current_refs
    except
    select table_name, row_key, card_id from public.cat2d2_pre_refs
    order by 1, 3 limit 10
  ) q;
  raise exception
    'CAT-2D.2 REFUSED (§6): % mutable reference(s) appeared AFTER the Phase A capture. Migrating them would leave public.cat2d2_pre_refs describing a different row set than the one this migration changed, so the undo list would be wrong. Re-run Phase A and re-review. First 10: %',
    v_appeared, v_detail
    using errcode = '40001';
end if;

-- D2. VANISHED — Phase A captured a reference that is no longer there.
select count(*) into v_vanished from (
  select table_name, row_key, card_id from public.cat2d2_pre_refs
  except
  select table_name, row_key, card_id from cat2d2_current_refs
) q;
if v_vanished <> 0 then
  select string_agg(format('%s %s -> %s', table_name, row_key::text, card_id), '; ') into v_detail
  from (
    select table_name, row_key, card_id from public.cat2d2_pre_refs
    except
    select table_name, row_key, card_id from cat2d2_current_refs
    order by 1, 3 limit 10
  ) q;
  raise exception
    'CAT-2D.2 REFUSED (§6): % captured mutable reference(s) no longer exist. The user changed them between Phase A and now, so the undo list is stale. Re-run Phase A and re-review. First 10: %',
    v_vanished, v_detail
    using errcode = '40001';
end if;

-- D3. Cardinality, as a third statement of the same fact. Two symmetric
--     EXCEPTs both empty already implies set equality; this also catches a
--     duplicate row that set semantics would have absorbed.
if v_capt_refs <> v_live_refs then
  raise exception
    'CAT-2D.2 REFUSED (§6): Phase A captured % reference row(s) but % exist now, with no set difference — a duplicate row exists in one of the two lists',
    v_capt_refs, v_live_refs;
end if;

raise notice 'CAT-2D.2 §6 PASSED — the % captured reference row(s) are exactly the rows now locked for migration.', v_live_refs;


-- ═══════════════════════════════════════════════════════════════════════════
-- §7. INSERT THE 192 ALIAS ROWS
-- ═══════════════════════════════════════════════════════════════════════════
--
-- family = 'set_rename' is the value CAT-2D §3.1 defines for this column
-- ("the only value today"). The finer-grained family token is carried inside
-- `evidence` rather than widening the column's vocabulary without approval.
--
-- Every evidence payload is built from the STORED rows proven in §5, so the
-- stored provenance of each claim is auditable from the table alone, without
-- the artifact. `evidence_artifact_sha256` ties it back to the reviewed CSV.
--
-- The R1/R2 no-chain trigger fires per row here. §5 P8/P9 have already made a
-- trigger rejection impossible; if one fires anyway, this migration has a bug
-- and the whole statement correctly aborts.

insert into public.card_identity_aliases
  (alias_card_id, canonical_card_id, family, evidence, approved_by, slice)
select
  m.alias_card_id,
  m.canonical_card_id,
  'set_rename',
  jsonb_build_object(
    'proof',                     'upstream_set_rename',
    'family_token',              m.family,
    'admission_rules',           jsonb_build_array('A1', 'A2', 'A3', 'A4', 'A5'),
    'alias',                     jsonb_build_object(
                                   'name',     m.alias_name,
                                   'set_id',   m.alias_set_id,
                                   'set_name', m.alias_set_name,
                                   'local_id', m.alias_local_id),
    'canonical',                 jsonb_build_object(
                                   'name',     m.canonical_name,
                                   'set_id',   m.canonical_set_id,
                                   'set_name', m.canonical_set_name,
                                   'local_id', m.canonical_local_id),
    'norm_name_equal',           true,
    'norm_num_equal',            true,
    'tier1_identity_equal',      false,
    'tier1_note',                'Family A alias and canonical rows carry different set_name (parent set vs renamed subset), so their Tier-1 keys differ by construction. Admission rule A4 — the whole local-id namespace is absent from the parent set upstream — replaces the set component. See docs/sql/cat-2d2-1-family-a-reconciliation.sql header.',
    'alias_upstream_status',     m.alias_upstream_status,
    'canonical_upstream_status', m.canonical_upstream_status,
    'observed_at',               '2026-08-17T15:37:20.244Z',
    'evidence_artifact',         'docs/cat-2d2-evidence/family-a-alias-set.csv',
    'evidence_artifact_sha256',  '9deca61b3403be13b773b475ebafabfbd2a16a64085a8e8907270a3596fb63ab'
  ),
  'CAT-2D.2 approved allowlist — docs/cat-2d2-evidence/manifest.json',
  'CAT-2D.2'
from cat2d2_map m
order by m.alias_card_id;


-- ═══════════════════════════════════════════════════════════════════════════
-- §8. MUTABLE-REFERENCE COLLISION ANALYSIS   (fail-closed; no merge branch)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Six mutable tables carry a card_id that may point at a Family A obsolete id.
-- Each has a uniqueness constraint a naive UPDATE could violate, so each is
-- scanned for the condition "this owner already holds the survivor too".
--
--   table               unique key                        peer columns scanned
--   card_extras         (card_id)                         —
--   card_favorites      (user_id, card_id)                user_id
--   card_overrides      (user_id, card_id)                user_id
--   price_history       (user_id, card_id, recorded_date) user_id, recorded_date
--   user_binder_cards   (binder_id, card_id)              binder_id
--   user_card_intent    (user_id, card_id)                user_id
--
-- NOT SCANNED, DELIBERATELY:
--   user_import_rows           — immutable historical evidence, never migrated
--   user_import_rows.candidate_card_ids
--                              — same; CAT-2D §11 Q-6 is diagnostic only and
--                                is reported by the validation file, not acted on
--   user_binder_layout_items   — references a MEMBERSHIP row id, never a card
--                                id (BP-3.1A). Structurally immune
--   user_collection.owned_keys — name::num / name::set keys, not card ids.
--                                Structurally immune to any id rename
--
-- ANY collision anywhere aborts the whole statement. CAT-2D §6.2 permits
-- SILENT MERGES here; this migration implements NO merge branch at all,
-- because a merge is the only operation in the CAT-2D design that destroys
-- information and it would do so without a human ever seeing it.

for r in
  select * from (values
    (1, 'card_extras',       '{}'::text[]),
    (2, 'card_favorites',    '{user_id}'::text[]),
    (3, 'card_overrides',    '{user_id}'::text[]),
    (4, 'price_history',     '{user_id,recorded_date}'::text[]),
    (5, 'user_binder_cards', '{binder_id}'::text[]),
    (6, 'user_card_intent',  '{user_id}'::text[])
  ) t(ord, table_name, peer_cols)
  order by ord
loop
  -- Resolved before any dynamic statement touches the table, so a renamed or
  -- missing table is a named refusal rather than an opaque runtime error.
  if to_regclass('public.' || quote_ident(r.table_name)) is null then
    raise exception
      'CAT-2D.2 REFUSED (§8): expected mutable-reference table public.% does not exist — the reference inventory is stale and this migration must not proceed on it',
      r.table_name;
  end if;

  execute format(
    'select count(*) from public.%I t join cat2d2_map m on m.alias_card_id = t.card_id',
    r.table_name
  ) into v_refs;

  -- Third statement of the same fact: this dynamic per-table count must agree
  -- with the static six-branch derivation §6 compared against the capture.
  -- If the two ever disagreed, one of them is addressing the wrong rows.
  select count(*) into v_derived_refs from cat2d2_current_refs c where c.table_name = r.table_name;
  if v_refs <> v_derived_refs then
    raise exception
      'CAT-2D.2 REFUSED (§8): public.% has % obsolete reference(s) by the dynamic scan but % by the §6 derivation — the two disagree and neither can be trusted',
      r.table_name, v_refs, v_derived_refs;
  end if;

  -- `is not distinct from` rather than `=`: a NULL peer column (e.g. a
  -- nullable user_id) must still count as the same owner, otherwise a real
  -- collision could hide behind a NULL and reach the UPDATE.
  v_join := '';
  for i in 1 .. coalesce(array_length(r.peer_cols, 1), 0) loop
    v_join := v_join || format(' and b.%I is not distinct from a.%I', r.peer_cols[i], r.peer_cols[i]);
  end loop;

  execute format(
    'select count(*) from public.%I a '
    'join cat2d2_map m on m.alias_card_id = a.card_id '
    'join public.%I b on b.card_id = m.canonical_card_id%s',
    r.table_name, r.table_name, v_join
  ) into v_coll;

  v_refs_by_ord[r.ord] := v_refs;
  v_total_coll := v_total_coll + v_coll;
  v_report := v_report || format('%s refs=%s collisions=%s; ', r.table_name, v_refs, v_coll);
  raise notice 'CAT-2D.2 §8 % obsolete refs = %, collisions = %', rpad(r.table_name, 18), v_refs, v_coll;
end loop;

if v_total_coll <> 0 then
  raise exception
    'CAT-2D.2 REFUSED (§8): % merge collision(s) found — a user already holds BOTH the obsolete and the survivor row. Resolving a collision destroys information and is an explicit operator decision, never an automatic one. Scan: %',
    v_total_coll, v_report
    using errcode = '23505';
end if;

raise notice 'CAT-2D.2 §8 PASSED — zero collisions. %', v_report;


-- ═══════════════════════════════════════════════════════════════════════════
-- §9. MIGRATE THE MUTABLE REFERENCES
-- ═══════════════════════════════════════════════════════════════════════════
--
-- UPDATE only. Never DELETE, never INSERT, never ON CONFLICT.
--
-- CAT-2D §6.3: the override on swsh12.5-GG19 is the SOLE reason that printing
-- is owned — it is not in the active snapshot. Because §7 and §9 are in ONE
-- statement, and therefore one transaction, there is no committed state in
-- which the obsolete id has left cards_effective while the survivor is not yet
-- force-owned.
--
-- The per-table row_count is compared against §8's scan. Under the §1 locks
-- these cannot differ; the assertion exists so that a future edit which
-- weakens the locking cannot silently migrate a different row set than the one
-- that was proven collision-free.

for r in
  select * from (values
    (1, 'card_extras'),
    (2, 'card_favorites'),
    (3, 'card_overrides'),
    (4, 'price_history'),
    (5, 'user_binder_cards'),
    (6, 'user_card_intent')
  ) t(ord, table_name)
  order by ord
loop
  execute format(
    'update public.%I t set card_id = m.canonical_card_id '
    'from cat2d2_map m where m.alias_card_id = t.card_id',
    r.table_name
  );
  get diagnostics v_n = row_count;

  if v_n <> v_refs_by_ord[r.ord] then
    raise exception
      'CAT-2D.2 REFUSED (§9): public.% migrated % row(s) but §8 proved % — the table changed under the migration',
      r.table_name, v_n, v_refs_by_ord[r.ord];
  end if;

  v_migrated := v_migrated + v_n;
  if v_n > 0 then
    raise notice 'CAT-2D.2 §9 % migrated % row(s) to canonical ids', rpad(r.table_name, 18), v_n;
  end if;
end loop;

raise notice 'CAT-2D.2 §9 PASSED — % mutable reference row(s) migrated.', v_migrated;


-- ═══════════════════════════════════════════════════════════════════════════
-- §10. IN-TRANSACTION INVARIANTS   (CAT-2D §9 INV-7..INV-13)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Asserted before the statement ends, so a violation rolls the whole slice
-- back rather than being discovered by the post-deploy validation file.

-- INV-12. Raw provider history preserved — nothing deleted, nothing added.
select count(*) into v_now from public.cards;
if v_now <> v_pre_cards then
  raise exception 'CAT-2D.2 FAIL (INV-12): public.cards moved from % to % rows', v_pre_cards, v_now;
end if;

-- 192 alias rows added, and no other alias row disturbed.
select count(*) into v_now from public.card_identity_aliases;
if v_now <> v_pre_aliases + 192 then
  raise exception 'CAT-2D.2 FAIL: alias rows moved from % to %, expected %', v_pre_aliases, v_now, v_pre_aliases + 192;
end if;
select count(*) into v_n from public.card_identity_aliases where slice = 'CAT-2D.2';
if v_n <> 192 then
  raise exception 'CAT-2D.2 FAIL: % alias row(s) carry slice CAT-2D.2, expected 192', v_n;
end if;

-- INV-13. cards_effective = raw − aliased, explained exactly.
select count(*) into v_now from public.cards_effective;
if v_now <> v_pre_effective - 192 then
  raise exception 'CAT-2D.2 FAIL (INV-13): cards_effective moved from % to %, expected %',
    v_pre_effective, v_now, v_pre_effective - 192;
end if;

-- INV-10. No alias id appears in the effective catalog. cards itself is
--         deliberately unconstrained — the obsolete rows must still be there.
select count(*) into v_n
from public.cards_effective ce join public.card_identity_aliases a on a.alias_card_id = ce.id;
if v_n <> 0 then
  raise exception 'CAT-2D.2 FAIL (INV-10): % aliased id(s) still visible in cards_effective', v_n;
end if;
select count(*) into v_n
from cat2d2_map m join public.cards c on c.id = m.alias_card_id;
if v_n <> 192 then
  raise exception 'CAT-2D.2 FAIL (INV-12): % of 192 obsolete rows survive in public.cards — retention was violated', v_n;
end if;
select count(*) into v_n
from cat2d2_map m join public.cards_effective ce on ce.id = m.canonical_card_id;
if v_n <> 192 then
  raise exception 'CAT-2D.2 FAIL: % of 192 survivors are visible in cards_effective, expected all', v_n;
end if;

-- INV-8. No orphan aliases.
select count(*) into v_n
from public.card_identity_aliases a
where not exists (select 1 from public.cards c where c.id = a.canonical_card_id);
if v_n <> 0 then
  raise exception 'CAT-2D.2 FAIL (INV-8): % orphan alias row(s)', v_n;
end if;

-- INV-9. No self-alias, no chain, in either direction, table-wide.
select count(*) into v_n from public.card_identity_aliases where alias_card_id = canonical_card_id;
if v_n <> 0 then
  raise exception 'CAT-2D.2 FAIL (INV-9): % self-alias row(s)', v_n;
end if;
select count(*) into v_n
from public.card_identity_aliases a join public.card_identity_aliases b
  on b.canonical_card_id = a.alias_card_id;
if v_n <> 0 then
  raise exception 'CAT-2D.2 FAIL (INV-9): % alias chain(s) — depth must be exactly 1', v_n;
end if;

-- No obsolete reference survives in any migrated table.
for r in
  select * from (values
    ('card_extras'), ('card_favorites'), ('card_overrides'),
    ('price_history'), ('user_binder_cards'), ('user_card_intent')
  ) t(table_name)
loop
  execute format(
    'select count(*) from public.%I t join cat2d2_map m on m.alias_card_id = t.card_id',
    r.table_name
  ) into v_n;
  if v_n <> 0 then
    raise exception 'CAT-2D.2 FAIL (§9): public.% still holds % obsolete reference(s)', r.table_name, v_n;
  end if;
end loop;

-- INV-7. Historical import evidence byte-identical. This migration issues no
--        write against user_import_rows; the checksum proves it rather than
--        asserting it in prose.
select md5(coalesce(string_agg(
         md5(coalesce(ir.card_id, '~') || '|' || ir.match_status),
         ',' order by ir.batch_id, ir.source_row_number), ''))
  into v_checksum
from public.user_import_rows ir;
if v_checksum is distinct from v_pre_import_ck then
  raise exception 'CAT-2D.2 FAIL (INV-7): user_import_rows changed — historical evidence must be immutable';
end if;

-- Final summary, emitted as notices rather than a trailing SELECT: a trailing
-- SELECT would be a second top-level statement and would reintroduce exactly
-- the multi-statement dependency this file exists to avoid.
raise notice 'CAT-2D.2 §10 PASSED — cards % (unchanged), cards_effective % -> %, aliases % -> %.',
  v_pre_cards, v_pre_effective, v_pre_effective - 192, v_pre_aliases, v_pre_aliases + 192;

select count(*) into v_n from public.card_identity_aliases
 where slice = 'CAT-2D.2' and evidence ->> 'family_token' = 'shining_fates_sv';
raise notice 'CAT-2D.2 SUMMARY — shining_fates_sv = %', v_n;
select count(*) into v_n from public.card_identity_aliases
 where slice = 'CAT-2D.2' and evidence ->> 'family_token' = 'crown_zenith_gg';
raise notice 'CAT-2D.2 SUMMARY — crown_zenith_gg  = %', v_n;
raise notice 'CAT-2D.2 COMPLETE — run PHASES C..G of docs/sql/cat-2d2-2-family-a-validation.sql next.';

end
$cat2d2$;


-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Fully reversible. Nothing was deleted and nothing was created outside the
-- alias table; every reference change is an UPDATE of card_id whose inverse is
-- the same map read backwards.
--
-- ⚠ THE SKETCH BELOW IS A MULTI-STATEMENT begin/commit BLOCK. That is the exact
--   shape the SQL Editor did not honour for this workflow (see "ONE TOP-LEVEL
--   STATEMENT" above). If a rollback is ever needed, wrap it in a single
--   `do $rb$ begin ... end $rb$;` first, or run it through a client that
--   genuinely holds one session and one transaction across statements. It is
--   left in readable step form here because it is a recipe to be adapted under
--   supervision, never a file to be pasted unread.
--
-- ⚠ THE EXACT UNDO LIST IS public.cat2d2_pre_refs — one row per migrated
--   reference, carrying (table_name, row_key, card_id). §6 has PROVEN that
--   list is exactly the row set this migration changed, so it is authoritative
--   rather than merely indicative.
--
--   public.cat2d2_pre_capture is a different thing: catalog/ownership/OL-0D
--   fingerprints and the Phase A predictions. It contains NO per-row reference
--   list and cannot drive a reversal.
--
--   Do not run PHASE H of cat-2d2-2 (which drops both) until you are certain no
--   rollback is wanted. Export cat2d2_pre_refs first if there is any doubt: the
--   reverse UPDATE below reconstructs the same result from the alias table, but
--   only cat2d2_pre_refs identifies the individual rows.
--
--   begin;
--
--   lock table public.card_identity_aliases in share row exclusive mode;
--   lock table public.card_extras        in share row exclusive mode;
--   lock table public.card_favorites     in share row exclusive mode;
--   lock table public.card_overrides     in share row exclusive mode;
--   lock table public.price_history      in share row exclusive mode;
--   lock table public.user_binder_cards  in share row exclusive mode;
--   lock table public.user_card_intent   in share row exclusive mode;
--
--   -- 1. reverse the reference migration, for THIS slice's rows only.
--   --    Safe because §8 proved no user held both rows, so no obsolete row
--   --    can exist to conflict with.
--   update public.card_extras       t set card_id = a.alias_card_id
--     from public.card_identity_aliases a
--    where a.slice = 'CAT-2D.2' and t.card_id = a.canonical_card_id;
--   -- ... repeat verbatim for card_favorites, card_overrides, price_history,
--   --     user_binder_cards, user_card_intent.
--   --
--   -- ⚠ This reverses EVERY row now pointing at a survivor, including any row
--   --   that already pointed there before the migration. Because §8 proved
--   --   zero collisions, no such row existed for a migrated owner — but if a
--   --   user has created one SINCE the deploy, restrict the update with
--   --   public.cat2d2_pre_refs, e.g. for the user_id-keyed tables:
--   --
--   --     update public.card_favorites t set card_id = a.alias_card_id
--   --       from public.card_identity_aliases a
--   --       join public.cat2d2_pre_refs p
--   --         on p.table_name = 'card_favorites'
--   --        and p.card_id    = a.alias_card_id
--   --        and (p.row_key ->> 'user_id')::uuid = t.user_id
--   --      where a.slice = 'CAT-2D.2' and t.card_id = a.canonical_card_id;
--   --
--   --   card_extras is keyed by card_id alone (row_key is '{}'), and
--   --   price_history additionally needs
--   --   (p.row_key ->> 'recorded_date')::date = t.recorded_date.
--
--   -- 2. remove the alias rows. The 192 obsolete rows reappear in
--   --    cards_effective byte-identical, because they were never deleted.
--   delete from public.card_identity_aliases where slice = 'CAT-2D.2';
--
--   commit;
--
-- Revert src/constants/artistEditorial.js alongside step 2 (or leave it: the
-- expectName guard fails safe either way).
--
-- No public.cards row, user_import_rows row or schema object is touched by
-- this migration in either direction.
