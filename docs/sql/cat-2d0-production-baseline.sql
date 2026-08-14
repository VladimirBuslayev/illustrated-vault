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
--   1. public.get_active_snapshot_owned_card_ids()      -> RECOVERED in full,
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
-- STATUS: RECOVERED IN FULL — exact production body, verbatim.
--
-- Canonical location:
--   docs/sql/own-0a-1-active-snapshot-owned-card-ids.sql
--
-- That file is now an exact executable production baseline: the live
-- pg_get_functiondef output, transcribed byte-for-byte and verified by diff
-- against the introspection capture. Not restated here — one object, one
-- canonical body, no second source of truth.
--
-- Recovered properties: () -> jsonb, plpgsql, STABLE, SECURITY DEFINER,
-- SET search_path TO '', proacl {postgres,anon,authenticated,service_role} = X
-- (EXECUTE only).


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
--   proacl                            {postgres=X/postgres,anon=X/postgres,
--                                      authenticated=X/postgres,service_role=X/postgres}
--                                     (EXECUTE only, for all four roles)
--
-- DUPLICATION DELIBERATELY AVOIDED. Restating a 423-line function body here
-- would create a second source of truth for the same object and guarantee they
-- drift. The single canonical definition stays in ol-0d-4.
--
-- EQUIVALENCE STATUS, stated precisely: the exact production body IS present in
-- the captured introspection output. Repo equivalence was verified at the
-- PROPERTY / SEMANTIC level against ol-0d-4 — every property above matches. A
-- literal byte comparison of the two bodies was NOT performed in CAT-2D.0, and
-- ol-0d-4 is deliberately retained as the single canonical repo body rather
-- than duplicated here. Recorded as ambiguity A-2 in the recovery document:
-- low risk, non-blocking, closable with one text diff whenever desired.


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
--
-- Recovered relation metadata (introspection, 2026-08-14):
--   reloptions  ["security_invoker=true"]
--   relacl      {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,
--                authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}
--
-- Note on that ACL: all four roles hold the full privilege set on the VIEW
-- object. That is not a privilege escalation, because security_invoker = true
-- means every read still executes with the caller's own permissions against
-- public.cards and public.card_extras, and RLS there is what actually governs
-- visibility. The ACL is recorded as production truth; CAT-2D.1 changes neither
-- it nor the invoker setting.

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
-- card_count integer.
--
-- Recovered relation metadata (introspection, 2026-08-14):
--   reloptions  ["security_invoker=true"]
--   relacl      {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,
--                authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}
--
-- Identical ACL shape to cards_effective, and the same reasoning applies: the
-- view is security_invoker, so reads execute with the caller's permissions
-- against cards_effective beneath it.
--
-- Restated here for the record; the canonical definition remains
-- a-d2a-2-illustrator-directory.sql.

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
