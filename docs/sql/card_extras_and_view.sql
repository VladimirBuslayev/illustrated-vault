-- ============================================================
-- Illustrated Vault — Gate 1 Enrichment Read-Model
-- card_extras table + cards_effective view
-- Run this in the Supabase SQL editor (in order, top to bottom).
-- ============================================================


-- ── PHASE 1: card_extras table ───────────────────────────────
--
-- Holds manual illustrator corrections for cards where TCGdex
-- returned null. The sync script never touches this table.
-- card_id has a FK to cards.id with ON DELETE CASCADE because the
-- sync uses upsert-only writes and never truncates or recreates
-- the cards table, making cascade-delete safe and correct.
--
-- RLS is enabled explicitly. anon/authenticated have SELECT only
-- via the policy below. No INSERT/UPDATE/DELETE policies exist for
-- those roles, so write operations are implicitly denied.
-- Service-role writes bypass RLS and are used for manual enrichment.

CREATE TABLE IF NOT EXISTS public.card_extras (
  card_id               TEXT        NOT NULL PRIMARY KEY
                                    REFERENCES public.cards(id)
                                    ON DELETE CASCADE,
  illustrator_override  TEXT,
  source_note           TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS (not left to Supabase defaults).
ALTER TABLE public.card_extras ENABLE ROW LEVEL SECURITY;

-- SELECT policy: anon and authenticated can read all rows.
-- No INSERT/UPDATE/DELETE policies → those operations are implicitly
-- denied for anon and authenticated. Service-role bypasses RLS.
-- Drop first so the script is safe to re-run after partial execution.
DROP POLICY IF EXISTS "card_extras_public_select" ON public.card_extras;

CREATE POLICY "card_extras_public_select"
  ON public.card_extras
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Explicit GRANT in addition to the RLS policy.
-- Both are required: RLS controls row visibility; GRANT controls
-- whether the role can address the table at all.
GRANT SELECT ON public.card_extras TO anon, authenticated;


-- ── PHASE 1b: updated_at trigger ─────────────────────────────
--
-- Automatically sets updated_at to now() on any UPDATE.
-- The ON CONFLICT DO UPDATE path in Phase 4 would set updated_at
-- manually, but a trigger is safer and removes the dependency on
-- the caller remembering to include it.

CREATE OR REPLACE FUNCTION public.set_card_extras_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS card_extras_set_updated_at ON public.card_extras;

CREATE TRIGGER card_extras_set_updated_at
  BEFORE UPDATE
  ON public.card_extras
  FOR EACH ROW
  EXECUTE FUNCTION public.set_card_extras_updated_at();


-- ── PHASE 2: cards_effective view ────────────────────────────
--
-- ⚠ SUPERSEDED — DO NOT REUSE THIS DEFINITION AS CURRENT TRUTH.
--
--   The DDL below is the Gate 1 execution record and is preserved as history.
--   It is NO LONGER what production holds: Gate 3 added `c.artist_id` as a
--   fourteenth column and that change was never written back here.
--
--   Running a CREATE OR REPLACE VIEW built from the text below would SILENTLY
--   DROP artist_id and break the FK artist query path (cardService
--   ARTIST_SELECT), illustrator_directory (max(artist_id)),
--   add_artist_to_archive, and the Artist Page.
--
--   Current production definition, recovered by read-only introspection
--   2026-08-14:
--       docs/sql/cat-2d0-production-baseline.sql  §3
--   Drift analysis:
--       docs/CAT-2D.0_PRODUCTION_SQL_RECOVERY.md  §3.3
--
--   This comment is the only CAT-2D.0 change to this file. No DDL was altered.
--
-- Read-model that merges cards (raw TCGdex sync target) with
-- card_extras (manual editorial layer). The frontend queries
-- this view instead of cards directly.
--
-- security_invoker = true is set explicitly (not relying on defaults).
-- The view runs with the calling role's permissions. anon must have
-- SELECT on both cards and card_extras; both are granted above.
--
-- illustrator_override is intentionally not exposed as a separate
-- column. The frontend receives a single illustrator column that
-- always contains the best available value. The editorial source
-- is an internal implementation detail.

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
    c.last_synced_at
  FROM  public.cards c
  LEFT  JOIN public.card_extras ce ON c.id = ce.card_id;

GRANT SELECT ON public.cards_effective TO anon, authenticated;


-- ── PHASE 3: Validation queries ──────────────────────────────
--
-- Run BEFORE Phase 4 and BEFORE switching the frontend.
-- These queries validate the schema and view are working correctly.

-- 3a. Confirm the view returns the same card count as the cards table.
-- SELECT COUNT(*) FROM public.cards;
-- SELECT COUNT(*) FROM public.cards_effective;

-- 3b. Confirm a known-good artist still resolves correctly through the view.
--     Use any artist with confirmed non-null illustrator coverage.
-- SELECT id, name, illustrator
-- FROM   public.cards_effective
-- WHERE  illustrator ILIKE '%Yuka Morii%'
-- LIMIT  5;

-- 3c. Find the exact card IDs for the target cards in the affected sets.
--     Run this before Phase 4 to identify what to insert into card_extras.
--     Adjust the name filters as needed.
-- SELECT id, name, local_id, set_id, illustrator
-- FROM   public.cards
-- WHERE  set_id IN ('swsh11', 'swsh12', 'swsh12.5')
--   AND  (name ILIKE '%Giratina%' OR name ILIKE '%Altaria%')
-- ORDER  BY set_id, local_id;

-- 3d. Validate a specific target card through the view BEFORE inserting overrides.
--     Replace the card IDs with the real IDs found in query 3c.
--     Expected: illustrator = null for cards in the affected set ranges.
-- SELECT id, name, illustrator
-- FROM   public.cards_effective
-- WHERE  id IN (
--   'swsh11-NNN',   -- Giratina card from Lost Origin
--   'swsh12-NNN',   -- Altaria card from Silver Tempest
--   'swsh12.5-NNN', -- Altaria card from Crown Zenith
--   'swsh12.5-NNN'  -- Giratina VSTAR from Crown Zenith
-- );

-- 3e. Validate anon-key access with a REST call from your terminal.
--     Use the project anon key (not service role key).
--
--   curl -s \
--     -H "apikey: YOUR_ANON_KEY" \
--     -H "Authorization: Bearer YOUR_ANON_KEY" \
--     "https://YOUR_PROJECT.supabase.co/rest/v1/cards_effective?select=id,name,illustrator&illustrator=ilike.*Yuka+Morii*&limit=3"
--
-- Expected: JSON array of card rows with illustrator = "Yuka Morii".
-- If you get a permission error or empty result, check grants and RLS policy.


-- ── PHASE 4: High-priority card_extras seed rows ─────────────
--
-- VERIFY EACH CARD ID AND ILLUSTRATOR NAME BEFORE INSERTING.
-- Use query 3c above to find exact card IDs.
-- Verify the illustrator against the physical card's "Illus." credit
-- or a trusted source (Bulbapedia, pokemontcg.io) before inserting.
-- Do not insert unverified data.
--
-- Crown Zenith set ID is swsh12.5 — not swsh12pt5.
--
-- After inserting, re-run query 3d. Each corrected card should now
-- show illustrator = override value, not null.

-- INSERT INTO public.card_extras (card_id, illustrator_override, source_note)
-- VALUES
--   ('swsh11-NNN',   'Shinji Kanda', 'TCGdex null for swsh11; verified from physical card'),
--   ('swsh12-NNN',   'Asako Ito',    'TCGdex null for swsh12; verified from physical card'),
--   ('swsh12.5-NNN', 'Asako Ito',    'TCGdex null for swsh12.5; verified from physical card'),
--   ('swsh12.5-NNN', 'Shinji Kanda', 'TCGdex null for swsh12.5; verified from physical card')
-- ON CONFLICT (card_id) DO UPDATE
--   SET illustrator_override = EXCLUDED.illustrator_override,
--       source_note          = EXCLUDED.source_note;
--   -- updated_at is set automatically by the trigger.

-- Post-insertion validation: re-run query 3d after inserting.
-- Expected: each target card now shows illustrator = the override value.


