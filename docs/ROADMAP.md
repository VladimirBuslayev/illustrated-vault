# Illustrated Vault — Roadmap

Last updated: 2026-07-02

## Completed

### Gate 1 — Stabilize MVP ✓ (v0.1.4)

Single-file app made reliable: artist pages, card modal, pricing display, CSV import, ownership + overrides, favorites, share view, cache clearing, deployment.

### Gate 2 — Modular migration ✓ (2026-07-01)

Vite 5 / React 18, service/constants/utils modules, same visible behavior, no regressions. Production moved from GitHub Pages to Vercel (`main`). Fully closed — see CHANGELOG.md for phase history.

### Gate 3 — Data foundation ✓

Normalized `artists` table with aliases, `cards_effective` exposes `artist_id`, frontend FK-based artist queries (ILIKE retained only as fallback), `sui` false-positive fix, Kayama cleanup, three `card_extras` seed FK fixes, alias confirmations. No further schema changes needed for near-term features.

### Hunt intent + Hunt Board H-1/H-2/H-3 ✓

- `user_card_intent` table and `intentService.js` (`want` / `hunting` / `maybe` / `ignore`).
- Intent is planning metadata only — never affects ownership or completion counts.
- Global Hunt Board view: grouped by hunting / want / maybe, then by artist, price-descending; missing-with-intent cards only; owned/stale and `ignore` suppressed; no new Supabase calls.
- H-2: collapsible sections, MAYBE LATER collapsed by default, Dashboard mobile header polish.
- H-3: larger mobile tap target on section headers.

### Artist Page 2.0 ✓

Editorial hero, completion + hunt chips, Notable Cards strip, All/Owned/Missing/Hunting segments, intent pills, color-mode toggle.

### Other shipped

SharedBinder missing-card CSV export. V-A visual quiet pass.

## Sequencing — next slices (guardrail)

H-2/H-3 validation is complete. The agreed order:

1. **Product Surface Map** — map the app's surfaces and navigation before adding new lens types; plan, not build.
2. **Artist expansion / tracked artist management** — grow beyond the fixed roster; artist directory / add-artist flow.
3. **Set Lens v0** — first non-artist goal type: browse and track completion by set.
4. **Artist Page Slice C** (collapsible/curated Notable Cards, hero refinement) **or Brand/Logo/Loading V-B** (calmer landing/loading, refined flame/star mythology, logo direction) — choose based on how the app feels at that point.
5. **Pokémon Search / Lens v0** — browse and track by Pokémon.
6. **Collection Goals / Custom Lists** — user-defined goals and lists.
7. **Binder Planning v0** — only once the goal/list model is clearer. Do not start a large Binder Composer before a clear v0 plan exists.

This order is a guardrail: do not pull later slices forward without an explicit decision.

## Strategic direction — collection goals

The long-term organizing principle is **collection goals**: Artist, Set, Pokémon, Custom List, and Binder Plan are different goal types, each with progress, hunt targets, and showcase. This abstraction is earned gradually through the sequence above. The app must not become a generic database/filter tracker — artist-first, premium, calm, visual, and intentional remains the identity.

## Later / app readiness

- mobile polish, onboarding, account settings
- PWA install flow, app-store wrapper decision
- performance and image loading polish
- Japanese cards / language identity
- pricing confidence labels and last-updated context

## Deferred (explicitly)

- Binder 3x3 spread view, Next Hunts module
- Global UI redesign, navigation architecture overhaul
- Friend comparison / social features
- Freemium model, value tracking, price alerts
- Null-illustrator bulk enrichment pass (data-quality follow-up; not a feature blocker)
