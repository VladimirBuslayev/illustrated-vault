# Illustrated — Architecture

Last updated: 2026-07-01

## Production architecture

Production at `https://illustratedvault.com` is served from Vercel.
Vercel production branch: `gate-2/vite-migration`.

The app is a Vite 5 / React 18 build. Vercel runs `npm install && npm run build`
on push to the production branch and serves `dist/` directly.

`main` now contains the same Vite project structure (merged via PR #2,
merge commit `a03aff7`). Merging to `main` created a Vercel Preview deployment
only — it did not affect production. Migrating the Vercel production branch
from `gate-2/vite-migration` to `main` is a deferred cleanup item.

## Data source principles (unchanged)

TCGdex is an ingestion/source-sync provider. Supabase is the runtime source of truth for card display. The frontend does not depend on live TCGdex calls for normal artist pages.

TCGdex runtime usage is restricted: `tcgdexService.js` permits only the `entry.isSet` path (fetching a specific set by ID). The illustrator lookup path (`/illustrators/{name}`) is intentionally excluded. See DECISION_LOG.md.

Pricing data is adapted at write time in `sync-cards.mjs`, not at read time in the frontend. Pricing is buying guidance.

## Current module structure (main and gate-2/vite-migration)

```
src/
  App.jsx
  main.jsx
  assets/
    logo.webp
  constants/
    artists.js
    config.js
    setOrder.js
  services/
    supabaseClient.js
    cardService.js
    collectionService.js
    shareService.js
    cardAdapter.js
    imageService.js
    tcgdexService.js
  styles/
    index.css
  utils/
    cache.js
    cardUtils.js
    format.js
    imageUrl.js
    keys.js
    slug.js
    sort.js
public/
  apple-touch-icon.png
  favicon.png
  manifest.json
  icons/
    icon-192.png
    icon-512.png
  sw.js
index.html
index.legacy.html        — rollback reference; do not delete yet
package.json
vite.config.js
tailwind.config.js
postcss.config.js
sw.js                    — root legacy service worker; rollback reference; do not delete yet
CNAME                    — GitHub Pages domain record; rollback reference; do not delete yet
```

## Component boundary — current state

`src/App.jsx` is the component root. It is a single 1,266-line file containing the full component tree. This is intentional for Gate 2 — it mirrors the legacy single-file approach while operating inside the Vite module system. Component splitting into `src/components/` files is deferred to Phase 7, after Gate 2 stabilization is confirmed.

`src/main.jsx` is the Vite entry point. It:
- imports `{ App, SharedBinder, ErrorBoundary }` from `./App.jsx`
- detects `?share=TOKEN` in the URL
- renders `<ErrorBoundary>{token ? <SharedBinder token={token} /> : <App />}</ErrorBoundary>`

This mirrors the legacy `ReactDOM.createRoot` call at the bottom of `index.legacy.html` exactly.

## Module layer — responsibilities

### Constants (`src/constants/`)

Pure data. No imports. No side effects.

| File | Exports | Source |
|---|---|---|
| `artists.js` | `ARTISTS`, `ARTIST_FACTS`, `ARTIST_META` | index.legacy.html lines 106–212 |
| `config.js` | `CACHE_TTL`, `PRICE_VARIANT_ORDER` | index.legacy.html lines 102, 266 |
| `setOrder.js` | `SET_ORDER` | index.legacy.html lines 225–253 |

`SET_ORDER` is used in both `src/utils/sort.js` (imported) and directly in `ArtistSection` inside `src/App.jsx` (imported). Do not remove or alter values — they are the authoritative sort key for card chronological ordering.

### Utilities (`src/utils/`)

Pure functions. No Supabase. No network.

| File | Exports | Notes |
|---|---|---|
| `cache.js` | `lsGet`, `lsSet`, `lsDel` | localStorage helpers with silent error swallowing |
| `cardUtils.js` | `isTcgPocketCard` | Image URL path test |
| `format.js` | `fmtPrice`, `todayStr` | `fmtPrice` was `fmt$` in legacy; renamed for ESM clarity; behavior identical |
| `imageUrl.js` | `imgSmall`, `imgLarge` | TCGdex image URL suffix builders |
| `keys.js` | `normName`, `normNum`, `normSet`, `makeKeys`, `isCardOwned` | Ownership key builders; `makeKeys` output is persisted in Supabase; do not alter |
| `slug.js` | `toSlug` | URL-safe slug generator |
| `sort.js` | `getBestPrice`, `sortCards` | Imports from `constants/config.js` and `constants/setOrder.js` |

### Services (`src/services/`)

All network and Supabase I/O. Imported by `src/App.jsx`.

| File | Exports | Notes |
|---|---|---|
| `supabaseClient.js` | `supabase` | Single ES module Supabase client; replaces CDN `window.supabase.createClient` in legacy |
| `cardService.js` | `fetchArtistCards` | Artist path: Supabase `cards_effective`; set path: TCGdex via `tcgdexService` |
| `collectionService.js` | `loadUserData`, `saveCollection`, `saveOverride`, `savePricePoint` | All `user_collection`, `card_overrides`, `price_history`, `card_favorites` reads/writes |
| `shareService.js` | `fetchSharedCollection` | Calls `get_shared_collection` RPC |
| `cardAdapter.js` | `supaRowToCard` | Maps `cards_effective` row to TCGdex card shape |
| `imageService.js` | `fetchFallbackImage`, `buildLimitlessGuess` | pokemontcg.io fallback; Limitless CDN guess |
| `tcgdexService.js` | `fetchCardBriefs`, `fetchFullCard` | TCGdex only; `fetchCardBriefs` returns `[]` when `entry.isSet` is false |

## Data flow — artist card display

```
App.useEffect → loadAllEntries
  → fetchArtistCards(entry)           [cardService.js]
    if entry.isSet:
      → fetchCardBriefs(entry)        [tcgdexService.js]
        → GET api.tcgdex.net/sets/{id}
      → fetchFullCard(id) × N         [tcgdexService.js]
        → GET api.tcgdex.net/cards/{id}
    else (artist path):
      → supabase.from('cards_effective').select(...).or(ilikeFilters)
      → supaRowToCard(row) × N        [cardAdapter.js]
  → setCardData(cards)
```

## Data flow — collection / ownership

```
App.useEffect (after auth) → loadUserData(userId)    [collectionService.js]
  → supabase.from('user_collection').select('owned_keys')
  → supabase.from('card_overrides').select(...)
  → supabase.from('price_history').select(...)
  → supabase.from('card_favorites').select(...)
  → returns { ownedKeys, manualOwned, manualMissing, priceHistory, favorites }

checkOwned(card) → isCardOwned(card, ownedKeySet, manualOwned, manualMissing)
  → makeKeys(name, localId, setName).some(k => ownedKeySet.has(k))
```

## Data flow — SharedBinder

```
main.jsx: SHARE_TOKEN → <SharedBinder token={token} />
  → fetchSharedCollection(token)      [shareService.js]
    → supabase.rpc('get_shared_collection', { p_token: token })
  → fetchArtistCards(entry) per artist (same path as App)
```

## Supabase read model — unchanged

`cards_effective` is the frontend read model. No changes to Supabase during Gate 2.

```sql
SELECT id, name, set_id, set_name, local_id, illustrator,
       image_url, rarity, release_date, pricing, pricing_updated_at
FROM cards_effective
WHERE illustrator ILIKE '%{name}%'
  OR  illustrator ILIKE '%{alias}%'
ORDER BY release_date ASC NULLS LAST, set_id, local_id
```

`supaRowToCard` maps this to the TCGdex card shape the components expect. The mapping is stable and must not be altered without a corresponding schema migration.

## Backend RPC dependencies — unchanged

| RPC | Signature | Used by |
|---|---|---|
| `get_shared_collection` | `p_token TEXT` | `fetchSharedCollection` — share/binder read path |

This RPC is the only stored procedure the frontend calls. It powers the public shared binder view. Do not modify its signature or remove it.

## Deployment — current state

Production is served by Vercel from the `gate-2/vite-migration` branch. Vercel
builds automatically on push to that branch.

Merging PR #2 into `main` created a Vercel Preview deployment (commit `a03aff7`,
environment: Preview). It did not change or create a new Production deployment.

The manual GitHub Actions workflow `.github/workflows/build-check-gate2.yml`
remains on `main` as a `workflow_dispatch`-only build smoke test. It never
triggers automatically and does not deploy anything.

The manual GitHub Actions workflow `.github/workflows/deploy-gate2.yml` is no
longer the production deployment path. It remains on `main` as a historical
Gate 2 artifact only.

## Service worker

`public/sw.js` is the Vite app service worker. Service worker registration is
present in `index.html` (added in Phase 5G, before production cutover). The SW
is registered and validated in production.

Root `sw.js` also remains in the repo as a legacy rollback artifact. Do not
delete until GitHub Pages rollback window closes.

## Future direction — post Gate 2

After Gate 2 stabilization is confirmed and deferred cleanup is complete:

- Vercel production branch migration: `gate-2/vite-migration` → `main`
- Component extraction: split `src/App.jsx` into `src/components/` files (Phase 7+)
- Shared hooks: `useCardData`, `useCollection` (Phase 8+)
- Artist Directory / Add Artist flow (backlog)
- Set browsing (backlog)
- Freemium model / public collection pages (deferred)

## Constraints active through Gate 2 stabilization

- `index.legacy.html` must not be modified (rollback reference)
- Root `sw.js` and `CNAME` must not be deleted yet (rollback reference)
- Supabase schema, SQL, tables, views, policies, RPCs must not be modified
- TCGdex runtime usage must remain limited to `entry.isSet` paths
- `cards_effective` must remain the artist-path read model
