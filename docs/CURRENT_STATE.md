# Illustrated — Current State

Last updated: 2026-06-23

## Current version

Version: v0.1.4 — Gate 1 enrichment read-model (deployed and validated)

Illustrated is currently deployed at:

https://illustratedvault.com

The app is still primarily built from a single `index.html` file, with a supporting `sw.js` service worker, GitHub Pages deployment, and sync scripts.

## Current repo structure

- `.github/workflows/` — GitHub Actions workflows
- `sync/` — data sync / backfill scripts
- `CNAME` — custom domain configuration
- `README.md` — basic repo readme
- `index.html` — main single-file app
- `sw.js` — service worker

## Product direction

Illustrated is a premium visual archive and collection companion for Pokémon card collectors.

The differentiator is artist-first and artwork-first browsing, not simply price tracking.

The product should feel:

- premium
- calm
- visual
- curated
- collector-focused
- less gaming UI
- more archive / vault / gallery

Pricing is present as buying guidance and should always be treated as a reference, not an authority. Illustrated Vault is not a price tracker.

## Current architecture

Current state:

- Single-file MVP: yes
- Frontend runtime: `index.html`
- Deployment: GitHub Pages
- Domain: `illustratedvault.com`
- Database: Supabase
- External card source: TCGdex
- Intended direction: TCGdex as ingestion/sync source; Supabase as runtime source of truth
- Frontend read surface: `cards_effective` view (live)

## Working features

- Artist pages — sourced from Supabase via `cards_effective`
- Card grid with owned/missing states
- Card modal with full image, rarity, artist, set
- TCGPlayer Market price, Low / Mid / High breakdown
- All Variants pricing section (multi-variant cards)
- Cardmarket Trend section (where data exists)
- $↓ and $↑ price sort modes
- Price history recording per card per user
- CSV import (Collectr export)
- Manual owned/missing overrides
- Bookmarks / Most Wanted list
- Share / binder view
- Image fallback logic (pokemontcg.io archive, Limitless TCG)
- eBay sold links
- Cache / localStorage behavior
- GitHub Pages deployment

## Supabase objects — current state

### Tables

| Table | Owner | Written by | Purpose |
|---|---|---|---|
| `cards` | sync pipeline | `sync-cards.mjs` upsert | Raw TCGdex card data; source of truth for sync |
| `card_extras` | editorial | Manual (table editor) | Illustrator overrides and other manual corrections |
| `artists` | admin | Manual | Artist canonical names, aliases, metadata |
| `user_collection` | app | Frontend | Per-user owned card key set |
| `card_overrides` | app | Frontend | Per-user force-owned / force-missing |
| `price_history` | app | Frontend | Per-user price point log |
| `card_favorites` | app | Frontend | Per-user bookmarks |
| `share_links` | app | Frontend | Public binder share tokens |

### Views

| View | Source tables | Purpose |
|---|---|---|
| `cards_effective` | `cards` LEFT JOIN `card_extras` | Frontend read surface; exposes COALESCE(illustrator_override, illustrator) |

### RPCs

| RPC | Called by | Purpose |
|---|---|---|
| `get_shared_collection` | `fetchSharedCollection` in frontend | Returns card and ownership data for a share token; used by the public binder / share view |

The `get_shared_collection` RPC must be preserved during Gate 2 migration. It is the only backend dependency for the share/binder read path; the frontend calls `sb.rpc("get_shared_collection", {p_token: token})` and has no fallback if the RPC is absent.

### View access

`cards_effective` is live with `security_invoker = true`. anon and authenticated roles have SELECT. No INSERT/UPDATE/DELETE is possible on a non-updatable view. `card_extras` has RLS enabled with a SELECT-only policy for anon/authenticated; write access is service-role only.

### card_extras — verified seed rows

Five high-priority cards in the null-illustrator set ranges were verified and inserted as of v0.1.4:

| Card ID | Card name | Illustrator override | Notes |
|---|---|---|---|
| `swsh11-185` | Giratina V | N-DESIGN Inc. | TCGdex null for swsh11; verified at card ID level |
| `swsh11-186` | Giratina V | Shinji Kanda | TCGdex null for swsh11; verified at card ID level |
| `swsh12-TG11` | Altaria | Yuu Nishida | TCGdex null for swsh12; verified (corrected from initial wrong assignment) |
| `swsh12.5-GG19` | Altaria | Asako Ito | TCGdex null for swsh12.5; verified at card ID level |
| `swsh12.5-GG69` | Giratina VSTAR | Akira Egawa | TCGdex null for swsh12.5; verified (corrected from initial wrong assignment) |

All remaining null-illustrator cards across swsh9–swsh12.5 are a separate follow-up data-quality pass (see Known follow-up items).

## Supabase data contract — current status

The frontend selects from `cards_effective`. Column shapes are identical to `cards`; `supaRowToCard` required no changes when the switch was made.

| Column | Source | Selected by frontend | Notes |
|---|---|---|---|
| `id` | `cards` | yes | — |
| `name` | `cards` | yes | — |
| `set_id` | `cards` | yes | — |
| `set_name` | `cards` | yes | — |
| `local_id` | `cards` | yes | — |
| `illustrator` | `COALESCE(card_extras.illustrator_override, cards.illustrator)` | yes | View resolves the best available value |
| `image_url` | `cards` | yes | — |
| `rarity` | `cards` | yes | — |
| `release_date` | `cards` | yes | Mapped as `releaseDate` |
| `pricing` | `cards` | yes | JSONB; adapted from TCGdex at sync time |
| `pricing_updated_at` | `cards` | yes | Mapped as `pricingUpdatedAt`; not yet rendered |

Pricing coverage: 19,415 of 23,314 cards have pricing data (83%).

## Known limitations

### Null illustrator — enrichment read-model live; bulk data-quality pass pending

Six set ranges have `illustrator: null` in the `cards` table due to a TCGdex data gap:

- swsh9 (Brilliant Stars)
- swsh10 (Astral Radiance)
- swsh10.5 (Pokémon GO promo)
- swsh11 (Lost Origin)
- swsh12 (Silver Tempest)
- swsh12.5 (Crown Zenith)

The `card_extras` table and `cards_effective` view are deployed and validated. Five high-priority seed rows were verified and inserted (see card_extras — verified seed rows above). Those corrected cards now appear on the correct artist pages. The remaining null-illustrator cards across those six sets are a separate data-quality pass tracked in Known follow-up items.

### Pricing — framing and scope

Pricing reflects TCGPlayer market data sourced through TCGdex, updated weekly by the sync pipeline. It is buying guidance, not a price authority.

The following pricing features remain deferred:

- Pricing confidence labels
- Price staleness display (`pricingUpdatedAt` is mapped but not rendered)
- Cardmarket link button (`cmUrl` is computed in the modal but not rendered)
- Price alerts and watchlists
- Advanced price history analytics

### Artist alias coverage — unconfirmed

The following aliases have not been confirmed against live Supabase data:

- Saya Tsuruta — full-width Unicode space variant
- Masakazu Fukuda — typo variant ("Masayuki Fukuda")

## Known follow-up items

### 1. Bulk enrichment of null-illustrator cards across swsh9–swsh12.5

Now that the read-model is validated, the remaining work is a one-time data-quality pass: query Supabase for all cards in swsh9–swsh12.5 where `illustrator` is null, verify each against a trusted source (Bulbapedia, pokemontcg.io, physical card scan), and insert `card_extras` rows with the correct illustrator name and a `source_note`. Do not bulk-insert unverified data. Each override must be verified at exact card ID/local-number level — do not infer from Pokémon name, set, rarity, or similar cards. This is a follow-up pass and does not block Gate 2 migration.

### 2. TCGPlayer Market pricing framing

The modal leads with TCGPlayer Market price. For buying decisions at card shows, NM Low or recent eBay sold prices may be more practically useful. Framing should be revisited when pricing display is next touched.

### 3. Artist page summary has no collapse control

The artist bio section has no collapse toggle. On mobile this adds significant scroll distance before the card grid. A follow-up UX improvement, especially relevant for card-show use.

## Current gate

Gate 1 — Stabilize current MVP. Substantially complete.

Items resolved across Gate 1:

- Clear Cache cancel behavior fixed (v0.1.1)
- Clear Cache confirm copy corrected (v0.1.1)
- `release_date` mapped in `supaRowToCard` (v0.1.1)
- `pb_fallback_img_*` keys purged by Clear Cache (v0.1.1)
- Stale TCGdex concurrency comment corrected (v0.1.1)
- Supabase pricing schema added (v0.1.2)
- Sync script pricing adapter implemented (v0.1.2)
- Pricing activated in frontend (v0.1.3)
- `card_extras_and_view.sql` deployed; five verified seed rows inserted; `index.html` updated to target `cards_effective`; live validation passed (v0.1.4)

Remaining open before Gate 2:

- Bulk enrichment of null-illustrator cards across swsh9–swsh12.5 (follow-up data-quality pass; not a hard Gate 2 blocker)
- Artist alias confirmation for Saya Tsuruta and Masakazu Fukuda

Gate 2 migration (Vite/React) may proceed once any remaining user-visible Gate 1 issues are resolved. Artist alias confirmation is a small data-quality item and can be resolved before or during Gate 2 if it remains low-risk. The bulk enrichment data-quality pass can continue in parallel with or after Gate 2.

## Do not do yet

- Do not redesign UI
- Do not migrate to Vite yet
- Do not add set browsing yet
- Do not add Japanese cards yet
- Do not add pricing confidence yet
- Do not add Cardmarket link button yet
- Do not silently invent Supabase columns
