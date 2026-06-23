# Illustrated — Current State

Last updated: 2026-06-23

## Current version

Version: v0.1 — single-file MVP

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

## Current architecture

Current state:

- Single-file MVP: yes
- Frontend runtime: `index.html`
- Deployment: GitHub Pages
- Domain: `illustratedvault.com`
- Database: Supabase
- External card source: TCGdex
- Intended direction: TCGdex as ingestion/sync source; Supabase as runtime source of truth

## Working features to preserve

Before any refactor or migration, preserve:

- artist pages
- card grid
- card modal
- CSV import
- collection ownership state
- manual owned/missing overrides
- bookmarks/favorites
- share/binder view
- image fallback logic
- eBay sold links
- pricing display where available
- cache/localStorage behavior
- GitHub Pages deployment

## Known strategic risk

The app is becoming too large and fragile as a single-file MVP.

The next priority is not new features. The next priority is stabilization, documentation, and migration readiness.

## Current gate

Gate 1 — Stabilize current MVP.

Do not add major new features until the card data contract, Supabase runtime behavior, pricing assumptions, cache behavior, and modal behavior are stable.

## Next technical priority

Audit and stabilize:

- `fetchArtistCards`
- `supaRowToCard`
- `getBestPrice`
- card modal assumptions
- eBay sold link generation
- cache clearing
- stale wording about TCGdex/runtime source

## Do not do yet

- Do not redesign UI
- Do not migrate to Vite yet
- Do not add set browsing yet
- Do not add Japanese cards yet
- Do not add pricing confidence yet
- Do not silently invent Supabase columns
