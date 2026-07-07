# Illustrated Vault — Current State

Last updated: 2026-07-03

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

Artist Page Slice C (editorial polish) applied:
- Hero chip diet: Owned/Missing chips removed (they duplicated the progress
  line). Only Hunting / "On the list" chips remain, shown when non-zero, and
  they are now tappable shortcuts that activate the Hunting segment (same
  `viewMode` state as the sticky controls — no new state, intent read-only).
- About + Notable Cards merged into one collapsible "FROM THE ARCHIVE" band
  (default open; local state only, not persisted; V-C.1 chevron pattern).
  Instructional copy ("Tap to inspect · owned cards glow") removed; owned
  signal quieted to accent ring + ✓ with neutral captions. No curation or
  reordering system.
- Dynamic-artist fallback: artists with no story and no notable cards (all
  dynamic artists today) render a quiet one-line band — "One of your
  additions · N cards in the archive." — instead of silently dropping the
  band, so added-artist pages keep the same skeleton as curated ones.
- Hunting segment framing: a quiet summary line ("N active targets · M on
  the list") renders between the controls and the grid, hidden while
  searching so counts never disagree with the filtered grid. The WANT group
  label inside the segment is renamed ON THE LIST (Hunt Board vocabulary),
  and the empty state now reads "No hunt targets for this artist yet — mark
  a missing card as Hunting and it will gather here." Both strings are only
  reachable from the Artist Page: Binder/SharedBinder never pass
  `viewMode="hunting"`.
- Manage-in-mini-header for dynamic artists is deliberately NOT in this
  slice — deferred to Artist Page C2.

## Explore Artists directory — A-D1 live

Read-only `artists` view entered via the "Explore Artists →" link on the
Dashboard artist section header; derived from in-memory state. Tapping an
artist opens the existing Artist Page.

## Tracked artists — A-D2a data foundation + A-D2b0 roster spine live

Permanent product rule: **users can look at anything, but can act only on
what's in their archive.**

A-D2a (SQL, complete):
- `artists` formalized as global artist identity (currently 20 rows).
- `user_tracked_artists` (RLS: `user_id = auth.uid()`) is the per-user archive roster.
- `illustrator_directory` is the discovery source (illustrator + card count).
- `add_artist_to_archive(p_illustrator text)` RPC is the single Add-to-Archive write path.
- Only the owner account was seeded with the 20 current artists. Not a
  universal default; new users are not auto-seeded.

A-D2b0 (app, complete):
- `src/services/artistService.js` reads `user_tracked_artists` and resolves
  identities from `artists`. Every function soft-fails to empty.
- `App.jsx` builds `effectiveRoster = curated ARTISTS + dynamic additions`.
  Curated ARTISTS remain the unconditional safety floor — any fetch failure
  renders curated-only, identical to pre-B0 behavior.
- Dynamic additions appear under "YOUR ADDITIONS" (Dashboard, Explore
  Artists, Binder artist dropdown) only when non-empty.
- Dynamic card fetch (`cardService.js`) uses exact `artist_id` equality OR
  exact `illustrator` equality — never substring ILIKE.
- SharedBinder and ArtistPicker remain curated-only.

A-D2c-lite (app, complete):
- Find Illustrator search lives inside Explore Artists, querying
  `illustrator_directory` via `searchIllustratorDirectory`.
- Add to Archive calls `addArtistToArchive` (`add_artist_to_archive` RPC).
  Added artists appear under "YOUR ADDITIONS" once `onArtistAdded` triggers
  a tracked-id refetch.
- SQL hotfix (committed): `add_artist_to_archive` now inserts `display_name`
  when creating a new `artists` row. This fixed Add to Archive for
  illustrators without an existing identity row (e.g. Midori Harada), which
  previously failed the insert.
- No untracked Artist Page yet.

A-D2d (SQL + app, complete):
- `user_tracked_artists` gained a `tier text NOT NULL DEFAULT 'added'`
  column (`CHECK` restricts it to `main` / `secondary` / `added`) and a new
  `uta_update_own` RLS UPDATE policy. Scope is inherently dynamic-only:
  curated `ARTISTS` entries are never rows in this table.
- `artistService.js` gained `fetchTrackedArtistTiers` (new, alongside the
  unchanged `fetchTrackedArtistIds`), `updateArtistTier`, and
  `removeArtistFromArchive`. The latter two are plain RLS-guarded table
  writes, not RPCs — neither needs catalog validation or touches global
  artist identity.
- Dynamic artists in `effectiveRoster` now carry their real per-user tier
  instead of a hardcoded `"added"`. `Dashboard` and `ArtistDirectory`'s
  existing tier-based section splits required no changes.
- Explore Artists: a "⋯" Manage control on dynamic artist tiles only offers
  tier reassignment (Main Artists / Secondary & Special / Your Additions)
  and Remove from Archive (`window.confirm`-gated). Curated tiles are
  visually and functionally untouched.
- Removing an artist deletes only the caller's own `user_tracked_artists`
  row — never global artist identity, cards, overrides, favorites, hunt
  intent, or manual owned/missing state.
- Binder artist-filter dropdown: dynamic artists now fold into the matching
  Main/Secondary optgroup by tier; "Your additions" remains for artists
  still at the `added` default.

## SharedBinder — read-only share surface

- Never exposes Hunt status, editable controls, or private user info.
- Missing-card CSV export is live: `Missing CSV` button; exports only missing cards from the shared view; respects shared artist selection and viewer artist dropdown; intentionally ignores the search box; excludes TCG Pocket via `visibleCardData`; client-side generation with UTF-8 BOM; no Supabase writes; no intent/favorites/private columns.

## Visual polish

V-A Quiet Pass applied: logo glow reduced, flame/button styling calmed, Dashboard hero de-gradiented, footer artist-name text removed, stale comments cleaned, and an incident where CSS was accidentally pasted into `index.html` was fixed. `index.html` must remain a minimal Vite shell (root div + `/src/main.jsx` script). Do not reintroduce loud fire/game UI.

Brand V-B applied: final logo asset (`/illustrated-logo-gradient.svg`) wired into `BlazLogo` (component name kept to avoid touching its 11 call sites), logo sizing reduced across call sites, and the Dashboard hero no longer uses the large brand mark.

Dashboard / Brand Copy V-C applied: the Dashboard hero is now the **Vault
Feature** — an editorial split panel that features one card from the user's
own collection data. Selection ladder: `hunting` intent → `want` intent →
unowned favorite → nearest-incomplete artist ("Artist Focus") → quiet empty
state pointing at Explore Artists. Selection is deterministic (roster order,
then existing cardData order), price-blind, rotation-free, and read-only over
intent/favorites/ownership; owned cards and imageless cards are skipped at
selection time. The old stat block is demoted to a quiet single row under the
feature, and the rainbow progress bar is calmed to a two-stop amber→plum
gradient. `Dashboard` now receives `intentMap` (read-only). Copy pass in the
same slice: email removed as Dashboard identity (static "YOUR VAULT" eyebrow;
email remains only in the landing sign-out row / account context), "The art
is the point." replaced by a single landing placement of "For collectors who
follow the art." (no Dashboard tagline), "ENTER BINDER" → "Enter the Vault"
(landing button only — no route/component rename), "Send Magic Link 🔥" →
"Send sign-in link", "No password. One click and you're in." → "No password —
a link arrives in your email.", and the Most Wanted all-owned state → "Every
card on your list is home." in quiet neutral styling. `index.css` untouched.

Dashboard V-C.1 polish applied: (1) **Vault Queue** — the Vault Feature
ladder now collects up to 4 candidates (same hunting → want → favorite
priority, same roster/cardData order; candidate 0 is identical to the old
single pick). The hero's right side shows the other 2–3 candidates as
tappable "UP NEXT" thumbs; tapping swaps the featured card for the current
session only (plain `useState`, no persistence, no schema, no localStorage).
With no alternates, a quiet "IN YOUR VAULT" artist-progress note fills the
space instead of placeholders. (2) Header logo mark reduced 22 → 18 in the
Dashboard and Binder headers (SharedBinder untouched). (3) Most Wanted
expand/collapse labels are now "Show all N →" / "Collapse ▲" (same
show-3-by-default logic). (4) Main Artists and Secondary & Special section
headers are collapse toggles (chevron + count when collapsed; Main defaults
open, Secondary & Special defaults collapsed, Hunt Board precedent; local
state only). (5) A quiet full-width "Find an illustrator →" ghost row sits
after the artist sections; the Main Artists header link remains. (6) The
header "CSV" button is renamed "Import" and visually softened; placement and
import behavior are unchanged. `index.css` gained one clearly-marked V-C.1
block (`.vault-queue` + one mobile media query) — its only change since the
Gate 2 verbatim copy. Ownership, intent, favorites, Hunt Board,
SharedBinder, Artist Page, and A-D2c/A-D2d behavior untouched.

## Owned Library foundation

Owned Library is the planned surface for enumerating the user’s complete imported physical collection, distinct from the artist-focused archive, Planned Binders, and Hunt Board.

### OL-0A matching audit

OL-0A was completed against a real Collectr export and the complete `cards_effective` catalog.

Baseline results:

- 6,141 total Collectr rows
- 5,969 positive-quantity Pokémon rows
- 5,952 eligible rows with name, set, and card number
- 4,349 conservatively matched rows
- 1,116 ambiguous rows
- 487 unmatched rows
- 73.1% eligible row match rate
- 76.8% quantity-weighted match rate
- 72.9% end-to-end row resolution
- 76.6% end-to-end quantity resolution
- 0 row-local exact-match consistency failures

The audit confirmed that the existing lossy `owned_keys` model should remain recognition infrastructure but cannot safely enumerate the complete physical collection.

The validated local audit harness is stored at:

`/scripts/ol0a-match-audit.mjs`

### OL-0B import snapshot schema

OL-0B is complete.

The immutable import snapshot schema was installed and validated in Supabase:

- `user_import_batches`
- `user_import_rows`
- atomic activation and failure functions
- processing-only child insertion
- immutable evidence rows
- parent-based RLS
- one active import snapshot per user
- reconciliation constraints
- concurrency-safe child insertion and activation

Canonical migration:

`/docs/sql/ol-0b-1-user-import-snapshots.sql`

No production importer integration or Owned Library UI has been built yet.

## OL-0A2 — Matcher refinement simulation

Status: complete and approved for OL-0C integration.

The accepted OL-0A baseline was reproduced against the real Collectr export and complete `cards_effective` catalog. A second validation pass, OL-0A2b, addressed baseline-equivalence, collision, mapping-support, cross-strategy, and manual-review concerns.

Approved snapshot-import matching policy:

- preserve the existing production denominator normalization;
- allow purely numeric leading-zero equivalence, such as `057` → `57`;
- preserve meaningful prefixes and suffixes such as `TG`, `GG`, `SWSH`, `SM`, and `XY`;
- use the 33-entry curated set-name allowlist encoded in `scripts/ol0a2-refinement-sim.mjs`;
- require unique row-local canonical-card resolution;
- when multiple matching strategies succeed, require all strategies to agree on the same canonical card ID;
- keep conflicting, ambiguous, or multi-hit rows unresolved.

Validation findings:

- baseline eligible rows: 5,952
- baseline matched rows: 4,349
- baseline eligible row resolution: 73.07%
- approved combined simulation newly resolved: 948 rows / quantity 1,131
- approved combined in-sample eligible row resolution: 89.00%
- approved combined in-sample quantity resolution: 90.75%
- catalog-wide leading-zero collisions: 0
- cross-strategy conflicts: 0
- accepted set mappings: 33
- deferred mappings: 7
- rejected mappings: 34

Deferred mappings remain excluded, including cross-language or cross-release correspondences such as:

- `Ninja Spinner` → `Chaos Rising`
- `Inferno X` → `Phantasmal Flames`
- `Night Wanderer` → `Shrouded Fable`

The approved aliases are scoped only to the new snapshot importer. They must not become global production aliases or change the existing `user_collection.owned_keys` recognition behavior.

Private/generated reports, the real Collectr CSV, and catalog exports were not committed.

Next slice: OL-0C import snapshot integration.

### Next slice

OL-0A2 will run a local matcher-refinement simulation using only evidence-qualified set-name mappings and narrow card-number normalization. No production matching changes, aliases, importer integration, or UI work should occur until that evidence is reviewed.

## Completion tracking

Existed before the intent system and is unchanged:
- Artist hero shows owned/total percentage; Dashboard shows artist progress rows.
- Counts derive from `visibleCardData`, so hiding TCG Pocket affects totals.
- Manual overrides are respected.
- Do not rebuild completion counts unless explicitly requested.

## Current repo structure — main branch

```
src/
  App.jsx              — full React component tree (~1,900 lines); single file, intentional
  main.jsx             — entry point; ErrorBoundary + ?share= routing
  assets/logo.webp
  constants/           — artists.js, config.js, setOrder.js
  services/            — supabaseClient, cardService, collectionService,
                         shareService, cardAdapter, imageService,
                         tcgdexService, intentService, artistService
  styles/index.css
  utils/               — cache, cardUtils, format, imageUrl, keys, slug, sort
public/                — icons, manifest.json, sw.js
docs/                  — this documentation set + archive/ + sql/
sync/                  — data sync / backfill scripts
.github/workflows/build-check-gate2.yml — manual-only build smoke test
index.html             — minimal Vite shell
```

Components in `src/App.jsx` (in order): icon components, BlazLogo, FlameBackground, LandingPage, Dashboard, CardTile, PriceChart, CardModal, ArtistPage, ArtistSection, ArtistPicker, ShareLinkPanel, SettingsPanel, ErrorBoundary, SharedBinder, HuntStatusDot, HuntBoard, ArtistDirectory, App.

Do not split `App.jsx` unless explicitly approved.

## Supabase objects

Tables/views in use: `cards`, `card_extras`, `cards_effective` (view), `artists`, `user_tracked_artists` (now with a per-user `tier` column, A-D2d), `illustrator_directory` (view), `user_collection`, `card_overrides`, `price_history`, `card_favorites`, `user_card_intent`.

RPCs: `get_shared_collection(p_token)` (shared binder read path) and `add_artist_to_archive(p_illustrator)` (Add to Archive write path; UI arrives with A-D2c).

## Known limitations / open items

- Null-illustrator bulk enrichment for the six affected SWSH-era set ranges (~1,400 cards; TCGdex structural data gap) is still pending. It is a data-quality follow-up, not a feature blocker.
- Saya Tsuruta alias (full-width space variant) remains unconfirmed.
- Pricing features deferred: confidence labels, staleness display, Cardmarket link button, price alerts.
- Hunt Board back button always returns to Dashboard, even when entered from the Binder header (known, deferred).
