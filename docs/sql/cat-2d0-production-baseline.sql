-- docs/sql/cat-2d0-production-baseline.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- CAT-2D.0 — Production SQL definition baseline (RECOVERY RECORD)
--
-- WHAT THIS FILE IS
--   A faithful record of the LIVE production definitions of the catalog-facing
--   SQL objects that CAT-2D.1 must modify, recovered by read-only introspection
--   on 2026-08-14 (pg_get_viewdef / pg_get_functiondef / pg_proc / pg_class /
--   information_schema.columns).
--
--   It exists because the repo could not rebuild its own production surface:
--   the committed `cards_effective` definition was stale, and the OWN-0A
--   ownership RPC had no committed definition at all. CAT-2D.1 was blocked on
--   exactly that, and future work must not reconstruct these objects from prose.
--
-- WHAT THIS FILE IS NOT
--   * Not a migration. CAT-2D.0 executed nothing and deployed nothing.
--   * Not a redesign. Every statement below reproduces what production already
--     has, byte-for-byte where the body was recovered.
--   * Not a replacement for the historical migration files. Those remain the
--     execution record of how production got here; this is a snapshot of where
--     it currently is.
--
-- DEPLOYMENT STATUS
--   NOT DEPLOYED, and deployment is NOT part of CAT-2D.0.
--   Running these statements against current production would be a no-op — they
--   are the definitions production already holds — but that is a property, not
--   an invitation. Do not run this file as part of this slice.
--
-- SCOPE — four objects
--   1. public.get_active_snapshot_owned_card_ids()      -> BODY NOT RECOVERED,
--                                                          see own-0a-1-*.sql
--   2. public.get_active_import_snapshot_read_model(...)-> no drift detected,
--                                                          see §2
--   3. public.cards_effective                           -> CORRECTED (§3)
--   4. public.illustrator_directory                     -> already current (§4)
--
-- TRANSCRIPTION NOTE — the one intentional difference from deparser output
--   `pg_get_viewdef` emits UNQUALIFIED relation names (`FROM cards c`), because
--   it deparses against the session search_path. The statements below add the
--   explicit `public.` schema qualification used everywhere else in docs/sql/.
--   That is a semantically neutral, deliberate normalization — NOT drift, and
--   NOT a change to what production computes. Nothing else was altered: column
--   list, column order, aliases, COALESCE argument order, join type and join
--   predicate are all reproduced exactly as introspected.
--
-- Full drift analysis: docs/CAT-2D.0_PRODUCTION_SQL_RECOVERY.md
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- §1. public.get_active_snapshot_owned_card_ids()
-- ═══════════════════════════════════════════════════════════════════════════
--
-- STATUS: metadata recovered; FUNCTION BODY NOT PRESENT IN THIS SLICE.
--
-- The recovered metadata and the reserved canonical path live in:
--   docs/sql/own-0a-1-active-snapshot-owned-card-ids.sql
--
-- That file deliberately contains NO executable statement, because inventing a
-- SECURITY DEFINER ownership function body is precisely the failure mode
-- CAT-2D.0 exists to end. See §1 of the recovery document.


-- ═══════════════════════════════════════════════════════════════════════════
-- §2. public.get_active_import_snapshot_read_model(...)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- STATUS: no drift detected at the property level. The current committed
--         definition is authoritative and is NOT restated here.
--
-- Canonical definition (current):
--   docs/sql/ol-0d-4-active-snapshot-performance-hardening.sql
--   — which explicitly "Replaces the BODY of get_active_import_snapshot_read_model.
--     Nothing else." over the original docs/sql/ol-0d-1-active-snapshot-read-model.sql
--
-- Every property reported by introspection matches that file exactly:
--
--   property                          introspected            ol-0d-4
--   --------------------------------  ----------------------  --------------------
--   returns                           jsonb                   jsonb           (L88)
--   language                          plpgsql                 plpgsql         (L89)
--   volatility                        STABLE                  stable          (L89)
--   security                          INVOKER (not DEFINER)   security invoker(L90)
--   search_path                       ''                      ''              (L91)
--   signature                         8 args                  8 args      (L75-84)
--   contractVersion                   1                       1     (L141,151,371)
--   aggregation                       by historical r.card_id then LEFT JOIN
--   catalog source                    cards_effective in both narrow-key and
--                                     page-wide joins         (L242, L340)
--   artist_id in page payload         yes                     yes            (L316)
--   executable by                     postgres, anon, authenticated, service_role
--
-- DUPLICATION DELIBERATELY AVOIDED. Restating a 423-line function body here
-- would create a second source of truth for the same object and guarantee they
-- drift. The single canonical definition stays in ol-0d-4.
--
-- RESIDUAL AMBIGUITY: this is a PROPERTY-level match, not a byte-level one. The
-- live pg_get_functiondef body was reported as recovered but was not supplied to
-- this slice, so a literal text comparison has NOT been performed. See the
-- recovery document §2 for what would close it.


-- ═══════════════════════════════════════════════════════════════════════════
-- §3. public.cards_effective  — CORRECTED
-- ═══════════════════════════════════════════════════════════════════════════
--
-- DRIFT FOUND. The committed definition in docs/sql/card_extras_and_view.sql
-- (Gate 1) has THIRTEEN columns and omits `artist_id`. Production has FOURTEEN.
-- Gate 3 added `c.artist_id` to the view and the change was never written back.
--
-- Consequence had CAT-2D.1 proceeded: a CREATE OR REPLACE VIEW built from the
-- committed text plus an alias-exclusion clause would have SILENTLY DROPPED
-- artist_id, breaking the FK artist query path (cardService ARTIST_SELECT),
-- illustrator_directory (max(artist_id)), add_artist_to_archive, and the whole
-- Artist Page — from a change intended to be a provable no-op.
--
-- Below is the live production definition, recovered 2026-08-14.
-- Column ORDER is part of the contract and is preserved exactly; `artist_id` is
-- the fourteenth and last column.
--
-- security_invoker = true is REQUIRED and must never be relaxed: the view runs
-- with the calling role's permissions so that RLS on the underlying tables is
-- honored. CAT-2D.1 must not weaken this to make an alias join easier.

CREATE OR REPLACE VIEW public.cards_effective
  WITH (security_invoker = true)
AS
  SELECT
    c.id,
    c.name,
    c.set_id,
    c.set_name,
    c.local_id,
    COALESCE(ce.illustrator_override, c.illustrator) AS illustrator,
    c.image_url,
    c.rarity,
    c.release_date,
    c.pricing,
    c.pricing_updated_at,
    c.pricing_source,
    c.last_synced_at,
    c.artist_id
  FROM public.cards c
  LEFT JOIN public.card_extras ce ON c.id = ce.card_id;

-- Recovered column list, in exact production order:
--    1 id                  8 rarity
--    2 name                9 release_date
--    3 set_id             10 pricing
--    4 set_name           11 pricing_updated_at
--    5 local_id           12 pricing_source
--    6 illustrator        13 last_synced_at
--    7 image_url          14 artist_id
--
-- NOTE: the view does NOT expose `series`, even though CAT-1 populated that
-- column on public.cards. That is current production truth, not an omission
-- here — CAT-1 explicitly made no view change.


-- ═══════════════════════════════════════════════════════════════════════════
-- §4. public.illustrator_directory  — already current
-- ═══════════════════════════════════════════════════════════════════════════
--
-- NO DRIFT. The committed definition in docs/sql/a-d2a-2-illustrator-directory.sql
-- is semantically identical to production. The only textual differences are
-- pg_get_viewdef deparser normalizations, not changes:
--
--   committed              introspected           nature
--   ---------------------  ---------------------  --------------------------
--   count(*)::int          count(*)::integer      same type, canonical spelling
--   btrim(illustrator)<>'' btrim(...) <> ''::text deparser adds explicit cast
--   from public.cards_effective  from cards_effective  deparser drops schema
--   lower-case keywords    upper-case keywords    deparser canonicalization
--
-- Recovered production column types: illustrator text, artist_id text,
-- card_count integer. security_invoker = true. Restated here for the record;
-- the canonical definition remains a-d2a-2-illustrator-directory.sql.

CREATE OR REPLACE VIEW public.illustrator_directory
  WITH (security_invoker = true)
AS
  SELECT
    illustrator,
    max(artist_id)     AS artist_id,
    count(*)::integer  AS card_count
  FROM public.cards_effective
  WHERE illustrator IS NOT NULL
    AND btrim(illustrator) <> ''::text
  GROUP BY illustrator;


-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Not applicable. CAT-2D.0 deployed nothing. If this file is ever executed
-- deliberately, it restores the definitions production already holds, so there
-- is nothing to roll back to — the pre-state and post-state are identical.
--
-- The one exception worth stating: executing §3 against a database whose
-- cards_effective has since gained further columns would REVERT those columns.
-- Re-introspect before ever running this file.
