# Illustrated — Changelog

## Gate 2 close — Phase 5O — 2026-07-01

Final documentation update. Gate 2 is fully closed.

No app code, Supabase schema, or product behavior was changed. No feature work
was introduced during Gate 2 or its cleanup.

### Phase 5O — Final docs update

Comprehensive docs update from Phase 5D baseline to final closed state,
covering all phases 5E–5O. Applied in a single commit to `main`:
`Gate 2 close: final docs update (Phase 5I + 5O)`

---

### Phase 5N — Repository cleanup — 2026-07-01

Commit `77b7a15` on `main` — "Post-Gate-2 cleanup: remove legacy rollback artifacts":

- Moved `index.legacy.html` → `docs/archive/index.legacy.html` (archived; not deleted)
- Deleted root `CNAME` (GitHub Pages domain record; no longer needed)
- Deleted root `sw.js` (legacy service worker; superseded by `public/sw.js`)
- Deleted `.github/workflows/deploy-gate2.yml` (legacy deploy workflow; no longer the production deployment path)

After commit validation: `gate-2/vite-migration` branch deleted via GitHub UI.

`.github/workflows/build-check-gate2.yml` retained — manual-only build smoke
test; does not deploy; no longer Gate 2-specific in behavior.

---

### Phase 5M — GitHub Pages unpublished — 2026-07-01

GitHub Pages unpublished for the repo via Settings → Pages → Unpublish site.
The apex DNS record already pointed to Vercel; GitHub Pages was no longer
serving production traffic. Unpublishing formally disabled it.

---

### Phase 5L — Supabase Auth redirect cleanup — 2026-07-01

Removed old GitHub Pages redirect URL from Supabase Auth allowed redirects:
`https://vladimirbuslayev.github.io/fire-chicken/`

Remaining redirect URLs after removal:
- `https://illustratedvault.com`
- `https://illustratedvault.com/**`
- Vercel preview URL(s)

Site URL unchanged: `https://illustratedvault.com`

OTP auth validated end-to-end on production after removal.

---

### Phase 5K — Vercel production branch migrated to main — 2026-07-01

Vercel production branch changed from `gate-2/vite-migration` to `main`.
New production deployment from `main`: commit `5848c90`. Validated: app loads,
auth, cards, owned/missing, SharedBinder, manifest, service worker.

---

### Phase 5J — Stabilization monitoring — 2026-06-26 to 2026-07-01

Passive monitoring of production under `gate-2/vite-migration` as Vercel
production branch. No issues observed. Go criteria met before proceeding to 5K.

---

### Phase 5I — Gate 2 PR close — 2026-07-01

- PR #2 conflict resolved: `.github/workflows/build-check-gate2.yml`.
  Accepted `main`-side version (includes parameterized branch input).
- PR #2 merged to `main` using merge commit strategy (merge commit `a03aff7`).
- Merging to `main` created a Vercel Preview deployment only. Production
  continued from `gate-2/vite-migration`.
- `gate-2-complete` annotated pre-release tag created on GitHub, pointing to
  the docs commit on `main`.

---

### Phase 5H — Production cutover — 2026-06-26

- Vercel production branch set to `gate-2/vite-migration`.
- Apex DNS updated: `A @ 216.198.79.1` → Vercel.
- Supabase site URL updated to `https://illustratedvault.com`.
- Supabase redirect URLs updated (old GitHub Pages URL retained temporarily).
- Production domain `https://illustratedvault.com` began serving Vite/React app.
- Original production-validated cutover commit: `d707abc`
  ("Register service worker for Vite app").
- Validated: auth, session, owned/missing, favorites, pricing, SharedBinder,
  PWA assets, `/manifest.json`, `/icons/icon-192.png`, `/sw.js`.
- Subsequent production deployment: `4198689` (workflow conflict-resolution
  merge commit on `gate-2/vite-migration`; changed only
  `.github/workflows/build-check-gate2.yml`; app behavior identical to `d707abc`).

### Phase 5I www cleanup — 2026-06-26

- `www.illustratedvault.com` added to Vercel.
- Redirect configured: `www.illustratedvault.com` → `illustratedvault.com` (307).
- Porkbun `www` CNAME updated to Vercel DNS target. Validated.

---

### Phase 5G — Service worker registration — 2026-06-26

SW registration script added to `index.html` before production cutover.
`/sw.js` registered and validated in production.

---

### Phase 5F — Auth and SharedBinder validation — 2026-06-26

Auth/OTP flow validated on live Vercel preview HTTPS URL.
SharedBinder real-token resolution validated.
Bad share token failure confirmed graceful.

---

### Phase 5E — Vercel preview deployment — 2026-06-26

Vercel project created: `illustrated-vault` (team: Illustrated Vault).
PR #2 opened as Draft to trigger Vercel preview integration.
Preview deployment validated before production cutover.

---

## gate-2/vite-migration branch — 2026-06-25

### Phase 5D — Gate 2 checkpoint documentation update

Status: Closed.

Updated CURRENT_STATE.md, CHANGELOG.md, ARCHITECTURE.md, DECISION_LOG.md to reflect the validated state of the Gate 2 migration through Phase 5C. No code changes.

---

### Phase 5C — Local core parity audit

Status: Passed.

Ran `npm run build` locally and opened `npm run preview`. Compared Vite app behavior against `index.legacy.html` across core flows:

- App loads; spinner → dashboard with valid session; landing page with no session
- Binder opens; artist sections load from Supabase `cards_effective`
- Cards display correctly; owned/missing states visually consistent with legacy
- Console showed only expected pokemontcg.io fallback 404s (no ReferenceError, no TypeError)
- Network tab confirmed `cards_effective` requests after cache clear; no TCGdex `/illustrators/` calls observed
- Overall visual behavior consistent with legacy

Remaining flows requiring a live HTTPS URL (OTP login, SharedBinder real-token, auth redirect handling) were deferred to Phase 5E/5F.

---

### Phase 5B — Full App port

Status: Closed / build-validated. GitHub Actions: npm install succeeded, npm run build succeeded, Vite transformed 92 modules, dist/ produced, logo asset bundled correctly, no deploy occurred.

Replaced the Phase 5A smoke-test `src/App.jsx` with the full React component tree from `index.legacy.html` lines 446–1665. Updated `src/main.jsx` to wire ErrorBoundary, SharedBinder, and `?share=` routing.

Files changed:
- `src/App.jsx` — 1,266 lines; full component tree
- `src/main.jsx` — 23 lines; real entry point

Substitutions applied (behavior unchanged):
- `LOGO_DATA_URI` inline base64 → `import logoSrc from './assets/logo.webp'`
- `fmt$(...)` → `fmtPrice(...)` at 8 call sites (Dashboard, PriceChart ×2, CardModal ×5)
- `sb.*` → `supabase.*` at 12 call sites (auth handlers in App, ShareLinkPanel, handleToggleFavorite, clearManual)
- `window.Papa` → `import Papa from 'papaparse'`
- `SET_ORDER` direct usage in ArtistSection confirmed and import added (gap caught during implementation)
- `REDIRECT` constant (line 103): defined in legacy but never referenced in component code; omitted
- `useEnter`/`useLeave`: confirmed to be `onMouseEnter`/`onMouseLeave` JSX props, not custom hooks; no action needed

PriceChart confirmed to use hand-coded SVG only. No new npm dependency added.

`index.legacy.html` md5 `fa281f58d7152f8e5b9487c2c5f1e17e` — confirmed unchanged throughout.

---

### Phase 5A — Vite boundary smoke test

Status: Closed / build-validated. GitHub Actions: npm install succeeded, npm run build succeeded, dist/ produced, no deploy occurred.

Created a minimal `src/App.jsx` smoke-test component that imports `ARTISTS` from `./constants/artists.js` and `toSlug` from `./utils/slug.js` to prove ES module resolution. Updated `src/main.jsx` to render `<App />` instead of the placeholder div.

No SharedBinder routing, no ErrorBoundary, no auth, no Supabase calls — intentionally minimal for boundary validation only.

Files changed:
- `src/App.jsx` — created (smoke test)
- `src/main.jsx` — placeholder div → `<App />`

---

### Phase 4D Repair — Service-layer stub repair

Status: Closed / build-validated. Included in Phase 5A build validation.

Seven Phase 4C/4D files were discovered to be broken self-import stubs (each file imported from itself, providing no actual implementation). All seven were replaced with real function bodies copied mechanically from `index.legacy.html`.

Files repaired:

| File | Functions repaired |
|---|---|
| `src/utils/format.js` | `fmtPrice` (renamed from `fmt$`), `todayStr` |
| `src/utils/imageUrl.js` | `imgSmall`, `imgLarge` |
| `src/services/cardAdapter.js` | `supaRowToCard` |
| `src/services/tcgdexService.js` | `fetchCardBriefs` (set path only), `fetchFullCard` |
| `src/services/imageService.js` | `fetchFallbackImage`, `buildLimitlessGuess` |
| `src/services/collectionService.js` | `loadUserData`, `saveCollection`, `saveOverride`, `savePricePoint` |
| `src/services/shareService.js` | `fetchSharedCollection` |

`tcgdexService.js` note: the repaired version intentionally excludes the legacy illustrator lookup branch (`/illustrators/{name}`). `fetchCardBriefs` returns `[]` immediately when `entry?.isSet` is false. See DECISION_LOG.md.

`fmt$` renamed to `fmtPrice` in the module export. Function behavior is identical.

---

### Phase 4D — Service extraction

Status: Closed / build-validated.

Created:
- `src/services/collectionService.js`
- `src/services/shareService.js`
- `src/services/cardAdapter.js`
- `src/services/imageService.js`
- `src/services/tcgdexService.js`
- `src/services/cardService.js`

`cardService.js` artist path queries `cards_effective`. Cache keys and TTL behavior are preserved.

---

### Phase 4C — Remaining pure utilities extraction

Status: Closed / build-validated. (Stubs later repaired in Phase 4D Repair.)

Created:
- `src/utils/format.js`
- `src/utils/imageUrl.js`

---

### Phase 4B — Legacy inventory audit

Status: Closed / no code changes.

---

### Phase 4A — Supabase client boundary

Status: Closed / build-validated.

Created `src/services/supabaseClient.js`. Additive only; not wired into legacy.

---

### Phase 3 — Constants and utilities extraction

Status: Closed / build-validated.

Created:
- `src/constants/setOrder.js`
- `src/constants/artists.js`
- `src/constants/config.js`
- `src/utils/cache.js`
- `src/utils/slug.js`
- `src/utils/keys.js`
- `src/utils/cardUtils.js`
- `src/utils/sort.js`

All values are verbatim copies from `index.legacy.html`. `makeKeys` output format is unchanged — any modification would break Supabase `user_collection.owned_keys` matching.

---

### Phase 2B — Service worker placement

Status: Closed / build-validated.

Created `public/sw.js` as a byte-for-byte copy of root `sw.js`. Root `sw.js` left in place at the time. Service worker registration in `index.html` deferred to Phase 5G.

---

### Phase 2A — Static asset extraction

Status: Closed / build-validated.

Extracted base64-embedded assets from `index.legacy.html`:
- `public/apple-touch-icon.png`
- `public/favicon.png`
- `public/manifest.json`
- `public/icons/icon-192.png`
- `public/icons/icon-512.png`
- `src/assets/logo.webp`

`index.html` updated with `<link>` tags referencing these assets.

---

### Phase 1 — Vite scaffold

Status: Closed / build-validated.

Created:
- `index.legacy.html` (copy of legacy `index.html` at Gate 2 start; archived at `docs/archive/index.legacy.html` after Gate 2 close)
- New minimal Vite `index.html`
- `package.json` (Vite 5, React 18, @supabase/supabase-js, papaparse)
- `vite.config.js`
- `tailwind.config.js`
- `postcss.config.js`
- `src/main.jsx` (scaffold placeholder)
- `src/styles/index.css`
- `.github/workflows/deploy-gate2.yml` (manual-only; removed after Gate 2 close)
- `.github/workflows/build-check-gate2.yml` (build-only validation; retained)
- `.gitignore`

---

## v0.1.4 — 2026-06-23

Gate 1 enrichment read-model. Deployed and validated at illustratedvault.com.

- `card_extras_and_view.sql` deployed to Supabase
- `cards_effective` view live with `security_invoker = true`
- Five verified seed rows inserted into `card_extras`
- `index.html` updated to query `cards_effective` instead of `cards`
- Live validation confirmed: corrected cards appear on correct artist pages

---

## v0.1.3 — 2026-06-23

Pricing activated in frontend.

- TCGPlayer Market price display in card modal
- Low / Mid / High breakdown
- All Variants section (multi-variant cards)
- Cardmarket Trend section (where data exists)
- `$↓` and `$↑` sort modes
- Price history recording per card per user (first open per day)

---

## v0.1.2 — 2026-06-23

Supabase pricing schema. Sync script pricing adapter.

---

## v0.1.1 — 2026-06-23

Bug fixes:
- Clear Cache cancel behavior fixed
- Clear Cache confirm copy corrected
- `release_date` mapped in `supaRowToCard`
- `pb_fallback_img_*` keys purged by Clear Cache
- Stale TCGdex concurrency comment corrected

---

## v0.1.0 — 2026-06-23 (approximate)

Initial single-file MVP. Artist binder, card grid, owned/missing states, CSV import, favorites, share links, image fallback logic, manual overrides.
