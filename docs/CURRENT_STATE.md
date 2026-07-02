# Illustrated Vault — Current State

Last updated: 2026-07-02

## Production

Production app: https://illustratedvault.com
Served by Vercel from the `main` branch. Vercel builds automatically on push to `main`.

Domain: illustratedvault.com (Porkbun). GitHub Pages is unpublished. Transactional email via Resend at `updates.illustratedvault.com`.

## Gate status

| Gate | Scope | Status |
|---|---|---|
| Gate 1 | Stabilize single-file MVP | ✓ Closed (v0.1.4) |
| Gate 2 | Vite 5 / React 18 modular migration, Vercel cutover | ✓ Closed 2026-07-01 (`gate-2-complete` tag) |
| Gate 3 | Data foundation: artists table, FK identity, cleanup | ✓ Closed |
| Hunt Board H-1/H-2/H-3 | Global hunt planning surface | ✓ Complete |

Full Gate 2 phase history (5A–5O) lives in CHANGELOG.md. No Gate 2 rollback or deferred cleanup remains.

## Gate 3 data foundation — complete

- `artists` table exists and is well-formed (with alias arrays).
- `cards_effective` view exposes `artist_id`.
- Frontend artist queries use the FK-based `artist_id` path (`.eq('artist_id', ...)`), with the old ILIKE path retained only as a fallback for entries without an `artistId`. Cache key bumped `pb7_supa_` → `pb8_supa_` to invalidate stale ILIKE caches.
- The old `sui` ILIKE false-positive bug (substring match on "Misa Tsutsui") is fixed.
- Tetsu Kayama alias/FK cleanup done.
- Three `card_extras` seed FK fixes: `swsh11-186` → `shinji-kanda`, `swsh12.5-GG19` → `asako-ito`, `swsh12.5-GG69` → `akira-egawa`.
- `shibuzoh` alias includes `Shibuzō`.
- Fukuda `"Mosakazu Fukuda"` alias confirmed legitimate.
- No schema changes are needed for near-term Hunt Board or Artist Page features.

## Hunt intent system — live

Supabase table: `user_card_intent` (RLS: `user_id = auth.uid()`).

Statuses: `want`, `hunting`, `maybe`, `ignore`.

Service: `src/services/intentService.js` — exports `fetchUserIntent(userId)`, `setCardIntent(userId, cardId, status)`, `clearCardIntent(userId, cardId)`, `INTENT_STATUSES`.

Frontend: `intentMap` (`Map<cardId, status>`) lives in `App()`, loaded once per signed-in user, with optimistic set/clear handlers (`handleSetIntent`, `handleClearIntent`).

Rules (invariant):
- Intent is planning metadata only.
- Intent never affects owned/missing state.
- Intent never affects completion counts (`ignore` included).
- Owned cards with stale intent rows are suppressed from hunt surfaces at render time.
- Intent is not exposed in SharedBinder v1.

Favorites remain a separate concept: a favorite is an emotional bookmark; intent is acquisition planning on missing cards. The Dashboard "Most Wanted" section is favorites-driven.

## Hunt Board — H-1/H-2/H-3 complete

Top-level view `hunt`, reachable from the Dashboard header and Binder header.

- Derived entirely from in-memory state — no new Supabase calls.
- Groups: ACTIVE TARGETS (`hunting`), ON THE LIST (`want`), MAYBE LATER (`maybe`); within each, grouped by artist in `ARTISTS` roster order; within each artist, sorted by market price descending, unpriced last.
- Shows only missing cards with intent; suppresses owned cards with stale intent rows; suppresses `ignore`; deduplicates by card id.
- Row tap opens the existing `CardModal`; status changes and Force Owned update the board live.
- H-2: collapsible sections. ACTIVE TARGETS and ON THE LIST default open; MAYBE LATER defaults collapsed when it has cards; counts stay visible in collapsed headers; collapse state is local only, not persisted. Dashboard mobile header polish included.
- H-3: section-header tap target enlarged for mobile (padding `.2rem` → `.55rem`).

## Artist Page 2.0 — live

- Editorial hero with artist metadata; owned/missing completion chips; Hunt status chips; Notable Cards strip.
- Segmented control: All / Owned / Missing / Hunting. Hunting segment shows `hunting` and `want` cards grouped by status/set.
- Intent pills on missing tiles: filled purple dot = hunting; hollow purple ring = want. `maybe` and `ignore` do not appear as prominent tile pills.
- Color-mode toggle reuses the persisted `showAllColor` state shared with Binder view.
- Missing/Owned segments are literal because `soloSections` is passed; Binder/SharedBinder retain legacy paired-section behavior (they do not pass `soloSections`).

## Explore Artists directory — A-D1 live

Read-only `artists` view over the current 20 tracked roster artists (SQL
confirmed the `artists` table contains exactly these 20 rows). Entered via the
"Explore Artists →" link on the Dashboard artist section header; derived
entirely from in-memory state with no new Supabase calls. Tapping an artist
opens the existing Artist Page. Track/untrack and untracked-artist behavior
are deferred to A-D2.

## SharedBinder — read-only share surface

- Never exposes Hunt status, editable controls, or private user info.
- Missing-card CSV export is live: `Missing CSV` button; exports only missing cards from the shared view; respects shared artist selection and viewer artist dropdown; intentionally ignores the search box; excludes TCG Pocket via `visibleCardData`; client-side generation with UTF-8 BOM; no Supabase writes; no intent/favorites/private columns.

## Visual polish

V-A Quiet Pass applied: logo glow reduced, flame/button styling calmed, Dashboard hero de-gradiented, footer artist-name text removed, stale comments cleaned, and an incident where CSS was accidentally pasted into `index.html` was fixed. `index.html` must remain a minimal Vite shell (root div + `/src/main.jsx` script). Do not reintroduce loud fire/game UI.

## Completion tracking

Existed before the intent system and is unchanged:
- Artist hero shows owned/total percentage; Dashboard shows artist progress rows.
- Counts derive from `visibleCardData`, so hiding TCG Pocket affects totals.
- Manual overrides are respected.
- Do not rebuild completion counts unless explicitly requested.

## Current repo structure — main branch

```
src/
  App.jsx              — full React component tree (~1,444 lines); single file, intentional
  main.jsx             — entry point; ErrorBoundary + ?share= routing
  assets/logo.webp
  constants/           — artists.js, config.js, setOrder.js
  services/            — supabaseClient, cardService, collectionService,
                         shareService, cardAdapter, imageService,
                         tcgdexService, intentService
  styles/index.css
  utils/               — cache, cardUtils, format, imageUrl, keys, slug, sort
public/                — icons, manifest.json, sw.js
docs/                  — this documentation set + archive/ + sql/
sync/                  — data sync / backfill scripts
.github/workflows/build-check-gate2.yml — manual-only build smoke test
index.html             — minimal Vite shell
```

Components in `src/App.jsx` (in order): icon components, BlazLogo, FlameBackground, LandingPage, Dashboard, CardTile, PriceChart, CardModal, ArtistPage, ArtistSection, ArtistPicker, ShareLinkPanel, SettingsPanel, ErrorBoundary, SharedBinder, HuntStatusDot, HuntBoard, App.

Do not split `App.jsx` unless explicitly approved.

## Supabase objects

Tables/views in use: `cards`, `card_extras`, `cards_effective` (view), `artists`, `user_collection`, `card_overrides`, `price_history`, `card_favorites`, `user_card_intent`.

RPC: `get_shared_collection(p_token)` — the only stored procedure the frontend calls.

## Known limitations / open items

- Null-illustrator bulk enrichment for the six affected SWSH-era set ranges (~1,400 cards; TCGdex structural data gap) is still pending. It is a data-quality follow-up, not a feature blocker.
- Saya Tsuruta alias (full-width space variant) remains unconfirmed.
- Pricing features deferred: confidence labels, staleness display, Cardmarket link button, price alerts.
- Hunt Board back button always returns to Dashboard, even when entered from the Binder header (known, deferred).
