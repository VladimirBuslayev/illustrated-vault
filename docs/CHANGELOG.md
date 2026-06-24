# Illustrated — Changelog

## v0.1.4 — Gate 1 illustrator enrichment read-model

Date: 2026-06-23

Status: SQL written and ready; pending Supabase deployment, seed-row insertion, frontend switch, and live validation.

### Problem

Six complete set ranges — swsh9 through swsh12.5 — have `illustrator: null` in Supabase. This is a TCGdex data gap, not a sync bug. The cards exist with correct images, names, and pricing. Because the frontend artist page query uses `illustrator.ilike.%name%`, null-illustrator cards are invisible on all artist pages. Named high-value cards affected include Giratina and Altaria cards from Lost Origin, Silver Tempest, and Crown Zenith.

### Solution

A two-layer read-model was introduced:

- `card_extras` — a new Supabase table that holds manual editorial corrections. The sync script never touches it.
- `cards_effective` — a new Supabase view that LEFT JOINs `cards` and `card_extras`, exposing `COALESCE(card_extras.illustrator_override, cards.illustrator) AS illustrator`. The frontend queries this view instead of `cards` directly.

`cards` remains the raw, sync-owned source of truth for TCGdex data. `card_extras` is the editorial layer. The view is the frontend's runtime read surface.

### `card_extras` table

New table with columns:

- `card_id TEXT PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE`
- `illustrator_override TEXT`
- `source_note TEXT`
- `created_at TIMESTAMPTZ DEFAULT now()`
- `updated_at TIMESTAMPTZ DEFAULT now()`

FK with ON DELETE CASCADE is safe because the sync script uses upsert-only writes and never truncates or recreates the `cards` table.

anon and authenticated roles have SELECT only. No INSERT/UPDATE/DELETE granted. Manual enrichment is performed via the Supabase table editor using service-role access.

### `cards_effective` view

Created with `security_invoker = true` (PostgreSQL 15+). Exposes the same column set and names as the `cards` table, with the single difference that `illustrator` is resolved via COALESCE. SELECT granted to anon and authenticated.

The PostgREST ilike OR filter used by `fetchArtistCards` — `illustrator.ilike.%name%` — evaluates correctly against the COALESCE expression in the view. No query logic changes were needed.

### Frontend change (`index.html`)

One string substitution in `fetchArtistCards`:

```js
// Before:
sb.from("cards")

// After:
sb.from("cards_effective")
```

`supaRowToCard` is unchanged. The view exposes identical column names, so the mapping is column-name-compatible without modification. The `illustrator` field on the card object now contains the COALESCE result — either the override or the raw TCGdex value — with no frontend awareness of which source won.

### What this does not do

- Bulk-enrich all null-illustrator cards across swsh9–swsh12.5. That is a separate data-quality pass, tracked in Known Follow-up Items. The schema and view support it without modification.
- Add a frontend override map or any client-side awareness of `card_extras`.
- Change the sync script.

---

## v0.1.3 — Pricing Phase 2: frontend activation

Date: 2026-06-23

Merged: yes

### `fetchArtistCards` — `pricing` and `pricing_updated_at` added to Supabase select

The Supabase `.select()` string in `fetchArtistCards` now includes `pricing` and `pricing_updated_at`. These fields were already present in the `cards` table following the Phase 1 schema migration; this change routes them to the frontend.

### `supaRowToCard` — pricing stub replaced with live mapping

The `pricing: null` stub (and its accompanying "does not exist in Supabase yet" comment) has been replaced with `pricing: row.pricing || null`. The field `pricingUpdatedAt: row.pricing_updated_at || null` has also been added and is available for future use.

No other changes to `supaRowToCard`, `getBestPrice`, the modal, or price sort logic were needed. All pricing UI was already written against the correct shape — it was dormant because pricing was always `null`. Opening the data gate was the only change required.

### Live validation results

Manual validation confirmed across artist cards:

- TCGPlayer Market price displays in the card modal
- Low / Mid / High breakdown displays
- All Variants section displays for multi-variant cards
- Cardmarket Trend section displays where Cardmarket data exists
- $↓ and $↑ price sort modes work; unpriced cards sort to the end
- Cards with no pricing data (WotC-era and others) still show "No pricing data" cleanly
- Owned/missing state, manual overrides, favorites, eBay links, and share/binder view unaffected

### Pricing framing note

Pricing in Illustrated Vault is buying guidance, not a price authority. TCGPlayer Market is displayed as a reference point. For buying decisions, the eBay Sold link remains important for verification against recent actual sales. Confidence labels, price alerts, Cardmarket link button, and price history analytics remain deferred.

---

## v0.1.2 — Pricing Phase 1: schema and sync adapter

Date: 2026-06-23

Merged: yes

### Supabase schema — three nullable columns added to `cards`

```sql
ALTER TABLE cards
  ADD COLUMN IF NOT EXISTS pricing            JSONB        DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS pricing_updated_at TIMESTAMPTZ  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS pricing_source     TEXT         DEFAULT NULL;
```

All columns are nullable. Existing rows were unaffected by the migration.

### `sync-cards.mjs` — pricing adapter added

Three adapter functions were added before `mapCardToRow`:

- `adaptTcgplayer(raw)` — normalizes TCGdex's flat TCGPlayer pricing object. Renames known variant keys (`holo` → `holofoil`, `reverse` → `reverse-holofoil`); passes unknown keys through unchanged. Preserves `updated` and `unit` metadata siblings. Property names (`marketPrice`, `lowPrice`, `midPrice`, `highPrice`) were already compatible — no renaming required for those.
- `adaptCardmarket(raw)` — restructures TCGdex's flat Cardmarket fields into the `{ url, prices: { averageSellPrice, lowPrice, trendPrice } }` shape the frontend expects. Maps `avg` → `averageSellPrice`, `low` → `lowPrice`, `trend` → `trendPrice`.
- `adaptPricing(raw)` — top-level coordinator; returns `null` if both sections are absent.

`mapCardToRow` was updated to compute `adaptPricing(card.pricing ?? null)` once per card and write three new fields to the Supabase row.

### Full sync results

A `SYNC_MODE=full` run populated pricing for 19,415 of 23,314 cards (83%). The 3,899 cards without pricing are primarily WotC-era sets where TCGdex carries no TCGPlayer data.

---

## v0.1.1 — Gate 1 stabilization patch

Date: 2026-06-23

Merged: yes (PR merged to `stabilization/gate-1`)

Changes:

### Clear Cache — cancel behavior fixed

The "Clear card cache" button in Settings previously called `onClose()` unconditionally. This has been fixed. Cancel now leaves the Settings panel open.

### Clear Cache — confirm copy corrected

The confirm dialog previously read "Will re-fetch from Supabase on next load." The copy now reads "Cards will be re-fetched from Supabase immediately."

### `supaRowToCard` — `release_date` now mapped

Mapped as `releaseDate: row.release_date || null`.

### Clear Cache — `pb_fallback_img_*` keys now purged

`clearCache` now also purges all keys matching the `pb_fallback_img_` prefix.

### Stale comment corrected in `loadAllEntries`

Updated to reference Supabase query pressure rather than TCGdex throttling.

---

## v0.1 — Initial single-file MVP

Date: 2026-06-23

State:

- GitHub Pages deployment works
- Custom domain works
- App is still primarily contained in `index.html`
- Service worker exists in `sw.js`
- Sync/backfill scripts exist in `sync/`
- Supabase is being introduced as runtime card source
- TCGdex remains a source/sync provider

Known risk:

The app is becoming too large and fragile as a single-file MVP.

Next planned step:

Gate 1 stabilization audit.

