# Illustrated — Current State

Last updated: 2026-07-01

## Production version

Gate 2 fully closed — Vite/React app deployed, validated, and cleaned up.

Production app: https://illustratedvault.com

Production is served by Vercel from the `main` branch.

Significant commits on `main`:
- `d707abc` — "Register service worker for Vite app" — original Phase 5H
  production-validated cutover commit.
- `4198689` — workflow conflict-resolution merge on `gate-2/vite-migration`;
  triggered a Vercel production deployment at the time (app behavior identical
  to `d707abc`).
- `a03aff7` — PR #2 merge commit (`gate-2/vite-migration` → `main`).
- `5848c90` — Vercel production branch switched to `main`; first production
  deployment from `main`.
- `77b7a15` — "Post-Gate-2 cleanup: remove legacy rollback artifacts" —
  deleted root `CNAME`, root `sw.js`, `.github/workflows/deploy-gate2.yml`;
  moved `index.legacy.html` → `docs/archive/index.legacy.html`.

No Gate 2 rollback or deferred cleanup remains. Minor future hygiene, such as
renaming the manual build-check workflow, is outside Gate 2 closure.

## Gate 2 migration — status

Gate 2 is fully closed. The Vite/React app is in production on `main`.
`gate-2/vite-migration` has been deleted. No feature work, schema changes, or
product behavior changes were introduced during Gate 2 or its cleanup.

### Gate 2 phases — all closed

| Phase | Description | Status |
|---|---|---|
| Phase 1 | Vite scaffold (index.html, package.json, vite.config.js, tailwind, postcss, src/main.jsx stub, deploy workflow) | Closed / build-validated |
| Phase 2A | Static asset extraction (base64 blobs → public/ and src/assets/) | Closed / build-validated |
| Phase 2B | Service worker placement (public/sw.js byte-for-byte copy of root sw.js) | Closed / build-validated |
| Phase 3 | Constants and utilities extraction (setOrder.js, artists.js, config.js, cache.js, slug.js, keys.js, cardUtils.js, sort.js) | Closed / build-validated |
| Phase 4A | Supabase client boundary (src/services/supabaseClient.js) | Closed / build-validated |
| Phase 4B | Legacy inventory audit | Closed / no code changes |
| Phase 4C | Remaining pure utilities (format.js, imageUrl.js) | Closed / build-validated |
| Phase 4D | Service extraction (collectionService.js, shareService.js, cardAdapter.js, imageService.js, tcgdexService.js, cardService.js) | Closed / build-validated |
| Phase 4D Repair | Repaired broken self-import stubs in Phase 4C/4D files | Closed / build-validated |
| Phase 5A | Vite boundary smoke test (minimal src/App.jsx proving ES module resolution) | Closed / build-validated |
| Phase 5B | Full App port (complete React component tree from index.legacy.html into src/App.jsx) | Closed / build-validated |
| Phase 5C | Local core parity audit | Passed |
| Phase 5D | Gate 2 checkpoint documentation update | Closed |
| Phase 5E | Vercel preview deployment (isolated HTTPS) | Closed / validated |
| Phase 5F | Auth/OTP + SharedBinder real-token validation on live HTTPS | Closed / validated |
| Phase 5G | Service worker registration in index.html | Closed / validated |
| Phase 5H | Production cutover (Vercel, apex DNS, Supabase site URL/redirects) | Closed / validated |
| Phase 5I | Gate 2 PR close (PR #2 merged to main; gate-2-complete tag created) | Closed |
| Phase 5J | Stabilization monitoring | Closed / passed |
| Phase 5K | Vercel production branch migrated to main | Closed / validated |
| Phase 5L | Supabase old GitHub Pages redirect URL removed | Closed / validated |
| Phase 5M | GitHub Pages unpublished | Closed |
| Phase 5N | Repository cleanup (commit 77b7a15; gate-2/vite-migration branch deleted) | Closed |
| Phase 5O | Final docs update | Closed by this commit |

## Current repo structure — main branch

```
src/
  App.jsx              — full React component tree (1,266 lines); single file for now
  main.jsx             — entry point; wires App, SharedBinder, ErrorBoundary, ?share= routing
  assets/
    logo.webp          — Blaziken logo
  constants/
    artists.js         — ARTISTS, ARTIST_FACTS, ARTIST_META
    config.js          — CACHE_TTL, PRICE_VARIANT_ORDER
    setOrder.js        — SET_ORDER (chronological set sort index)
  services/
    supabaseClient.js  — ES module Supabase client
    cardService.js     — fetchArtistCards
    collectionService.js — loadUserData, saveCollection, saveOverride, savePricePoint
    shareService.js    — fetchSharedCollection (RPC call)
    cardAdapter.js     — supaRowToCard
    imageService.js    — fetchFallbackImage, buildLimitlessGuess
    tcgdexService.js   — fetchCardBriefs, fetchFullCard (entry.isSet path only)
  styles/
    index.css          — all global CSS
  utils/
    cache.js           — lsGet, lsSet, lsDel
    cardUtils.js       — isTcgPocketCard
    format.js          — fmtPrice, todayStr
    imageUrl.js        — imgSmall, imgLarge
    keys.js            — normName, normNum, normSet, makeKeys, isCardOwned
    slug.js            — toSlug
    sort.js            — getBestPrice, sortCards
public/
  apple-touch-icon.png
  favicon.png
  manifest.json
  icons/
    icon-192.png
    icon-512.png
  sw.js                — Vite app service worker
docs/
  archive/
    index.legacy.html  — 1,680-line single-file legacy app; archived reference
  ARCHITECTURE.md
  CHANGELOG.md
  CURRENT_STATE.md
  DECISION_LOG.md
  PRODUCT_BRIEF.md
  ROADMAP.md
index.html             — Vite entry point (PWA meta tags, font links, root div, SW registration)
package.json           — Vite 5, React 18, @supabase/supabase-js, papaparse
vite.config.js
tailwind.config.js
postcss.config.js
sync/                  — data sync / backfill scripts
.github/
  workflows/
    build-check-gate2.yml  — manual-only build smoke test; does not deploy
```

Files removed during Gate 2 cleanup (commit `77b7a15`):
- Root `CNAME` — GitHub Pages domain record; deleted
- Root `sw.js` — legacy service worker; deleted (superseded by `public/sw.js`)
- `.github/workflows/deploy-gate2.yml` — legacy deploy workflow; deleted
- `index.legacy.html` (root) — moved to `docs/archive/index.legacy.html`

Branch deleted: `gate-2/vite-migration`

## Current architecture — Vite/React app

### Component root

`src/App.jsx` is the component root. It contains the full component tree as a single
1,266-line file. Component splitting into `src/components/` is deferred to Phase 7.

Components in `src/App.jsx` (in order):
- Icons: Ico, IcoSearch, IcoUpload, IcoX, IcoGear, IcoCheck, IcoRetry, IcoEdit, IcoSpin, IcoChev, IcoNoImage, IcoInfo, IcoEye, IcoContrast
- BlazLogo
- FlameBackground
- LandingPage
- Dashboard
- CardTile
- PriceChart (hand-coded SVG; no external chart library)
- CardModal
- ArtistPage
- ArtistSection
- ArtistPicker
- ShareLinkPanel
- SettingsPanel
- ErrorBoundary (class component; React 18 compatible)
- SharedBinder
- App

### Entry point

`src/main.jsx` wires:
- `<ErrorBoundary>` as the top-level boundary
- `?share=TOKEN` URL detection → `<SharedBinder token={TOKEN} />`
- All other routes → `<App />`

### Service layer

All service functions are in `src/services/`, imported by `src/App.jsx` at the
same call sites as the legacy inline functions. No new Supabase calls, no new
product behavior.

### Data flow — unchanged

Artist-path card display: `src/App.jsx` → `cardService.fetchArtistCards` → Supabase `cards_effective`

Set-path card display: `cardService.fetchArtistCards` → `tcgdexService.fetchCardBriefs` → TCGdex `/sets/{setId}` → `tcgdexService.fetchFullCard`

TCGdex illustrator lookup (`/illustrators/`) is not used. See DECISION_LOG.md.

### Service worker

`public/sw.js` is registered in `index.html`. Validated in production.

## Product direction

See PRODUCT_BRIEF.md.

Illustrated is a premium visual archive and collection companion for Pokémon card collectors.
The differentiator is artist-first and artwork-first browsing. Pricing is present as buying
guidance, not price authority.

## Supabase objects — unchanged

No Supabase schema, SQL, tables, views, policies, or RPCs were modified during Gate 2
or its cleanup. The Supabase state is exactly as it was at v0.1.4.

`cards_effective` remains the frontend read model. `get_shared_collection` RPC is preserved.
All RLS policies, view access, and data contracts are unchanged.

## Known limitations — unchanged from Gate 1

- Null illustrator enrichment for swsh9–swsh12.5: bulk data-quality pass pending
- Artist alias confirmation for Saya Tsuruta (full-width space) and Masakazu Fukuda (typo variant): unconfirmed
- Pricing features deferred: confidence labels, staleness display, Cardmarket link button, price alerts
