# Illustrated — Roadmap

## Gate 1 — Stabilize current MVP ✓ Complete

Objective:

Make the current single-file app reliable before migration.

Acceptance criteria:

- Artist pages render from Supabase where intended
- Card modal opens for Supabase-fetched cards
- Pricing displays when pricing data exists
- No-pricing state remains clean
- eBay sold links still work
- CSV import still works
- Owned/missing state still works
- Manual owned/missing overrides still work
- Bookmarks/favorites still work
- Share/binder view still works
- Cache clearing works
- Console has no obvious errors
- Deployment still works

## Gate 2 — Modular migration ✓ Complete (2026-07-01)

Objective:

Move existing behavior into a maintainable app structure.

Delivered:

- Vite 5 / React 18
- Separated service modules (`src/services/`)
- Centralized constants and utilities (`src/constants/`, `src/utils/`)
- Centralized card mapping (`cardAdapter.js`)
- Centralized collection/import logic (`collectionService.js`)
- Centralized cache utility (`cache.js`)
- Same visible app behavior as MVP
- No feature regression
- Domain still works

Deployment note: production moved from GitHub Pages to Vercel during Gate 2.
GitHub Pages has been unpublished. Production is served by Vercel from `main`.

No Gate 2 rollback or deferred cleanup remains. Minor future hygiene, such as
renaming the manual build-check workflow, is outside Gate 2 closure.

## Gate 3 — Data model improvement (current focus)

Objective:

Prepare the app for larger scale and better data quality.

Priorities:

- normalized artists
- artist aliases
- set table
- language/source identity
- card extras/manual corrections
- better card identity handling

## Gate 4 — Product expansion

Features to consider after foundation:

- set browsing
- wishlist
- collection dashboard
- improved binder/share view
- Japanese cards
- pricing confidence labels
- last-updated pricing context
- manual card corrections
- richer artist pages

## Gate 5 — App readiness

Objective:

Move toward a polished public beta.

Priorities:

- mobile polish
- onboarding
- account settings
- PWA install flow
- freemium boundaries
- app-store wrapper decision
- performance and image loading polish
