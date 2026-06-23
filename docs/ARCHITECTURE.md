# Illustrated — Architecture

## Current architecture

The app is currently a single-file MVP.

Current core files:

- `index.html` — main frontend app
- `sw.js` — service worker
- `sync/` — data sync / backfill scripts
- `.github/workflows/` — automation
- `CNAME` — GitHub Pages custom domain

## Current deployment

The app is deployed through GitHub Pages to:

https://illustratedvault.com

## Architecture direction

The target architecture is:

External APIs → ingestion/sync scripts → Supabase → frontend app

## Data source principle

TCGdex should remain an ingestion/source-sync provider.

Supabase should become the runtime source of truth for card display.

The frontend should not rely on live TCGdex calls for normal artist pages or future set pages.

## Why

External APIs can change shape, have missing data, or behave inconsistently.

The frontend should receive predictable, app-shaped data from Supabase.

## Pricing principle

Pricing data is adapted at write time in the sync script (`sync-cards.mjs`), not at read time in the frontend. The sync adapter normalizes TCGdex's upstream pricing shape into the frontend-compatible JSONB shape before upsert. The frontend reads a stable contract from Supabase and does not depend on TCGdex field names.

Pricing is buying guidance. It is not presented as authoritative market truth.

## Near-term data contract

The frontend should expect a stable card object with fields such as:

| Field | In Supabase | Selected by frontend | Notes |
|---|---|---|---|
| `id` | yes | yes | — |
| `name` | yes | yes | — |
| `set_id` | yes | yes | — |
| `set_name` | yes | yes | — |
| `local_id` | yes | yes | — |
| `illustrator` | yes | yes | — |
| `image_url` | yes | yes | — |
| `rarity` | yes | yes | — |
| `release_date` | yes | yes | Used for Supabase ORDER BY; mapped as `releaseDate` |
| `pricing` | yes | yes | JSONB; adapted from TCGdex at sync time |
| `pricing_updated_at` | yes | yes | Mapped as `pricingUpdatedAt`; not yet rendered |
| `pricing_source` | yes | no | In Supabase; not needed by frontend currently |
| `source` | no | no | Planned |
| `source_card_id` | no | no | Planned |
| `artist_id` | yes (sync) | no | Written by sync; not yet selected by frontend |
| `illustrator_raw` | no | no | Planned |
| `language` | no | no | Planned |
| `variants` | yes (sync) | no | Physical variant flags; not pricing variants |
| `tcgplayer_url` | no | no | Deferred |
| `ebay_sold_url` | no | no | Deferred |
| `price_confidence` | no | no | Deferred |

Do not silently invent missing Supabase columns. Missing columns should be identified explicitly.

## Sync adapter responsibility

The `sync-cards.mjs` script is responsible for:

- Fetching card detail from TCGdex
- Resolving `illustrator` strings to `artist_id` via the `artists.aliases` table
- Adapting TCGdex's pricing shape to the frontend-compatible JSONB shape
- Writing `pricing`, `pricing_updated_at`, and `pricing_source` columns alongside card metadata

The frontend should never contain logic that compensates for TCGdex's upstream field names or structure.

## Future database direction

Likely core tables:

```
cards
artists
artist_aliases
sets
collection_items
card_prices
card_extras
```

## Future frontend direction

After Gate 1 stabilization is fully complete, migrate toward a modular Vite/React structure:

```
src/
  app/
  components/
  pages/
  services/
  utils/
  hooks/
  data/
```

## Future service layers

Expected service separation:

- Supabase client
- card service
- artist service
- set service
- price service
- collection service
- import/CSV service
- cache utility
- card mapping utility

## Migration rule

Do not migrate to Vite until the current MVP behavior is stable.

The first migration should preserve user-facing behavior rather than redesigning or adding features.

