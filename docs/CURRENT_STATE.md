# Illustrated Vault — Current State

Last updated: 2026-07-08

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
| Owned Library OL-0A/0A2/0B/0C | Audit, matcher, snapshot schema, importer integration | ✓ Foundation complete 2026-07-08 |

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

## Planned Binders — BP-0A/B complete

Planned Binders are intentional collection-building lists, distinct from the
artist-focused archive, complete Owned Library, and active Hunt Board.

- Supabase tables: `user_binders` and `user_binder_cards`, with per-user RLS.
- Users can create, rename, describe, and delete planned binders.
- Binder plans support global catalog search, add/remove, duplicate prevention,
  and Supabase persistence.
- Existing ownership recognition is reused live: owned cards render normally;
  planned but unowned cards render dimmed.
- Planned binder cards open the existing `CardModal`.
- This is still a list-based planning surface, not a 9-pocket physical page
  planner. Page layout, slot positions, and physical storage modeling remain
  deferred.

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

Owned Library is the future surface for enumerating the user’s complete
imported physical collection. It remains distinct from:

- Artist Binder: owned/missing cards across intentionally tracked artists.
- Planned Binder: a collection the user is intentionally building.
- Hunt Board: cards the user is actively trying to acquire.

The architecture deliberately separates:

- `user_collection.owned_keys` — existing lossy recognition infrastructure;
- import snapshots — canonical enumeration infrastructure;
- `manualOwned` / `manualMissing` — separate ownership overrides.

No production ownership cutover has occurred.

### OL-0A matching audit — complete

OL-0A ran against a real Collectr export and the complete
`cards_effective` catalog.

Baseline results:

- 6,141 total Collectr rows
- 5,969 positive-quantity Pokémon rows
- 5,952 eligible rows with name, set, and card number
- 4,349 conservatively matched rows
- 1,116 ambiguous rows
- 487 unmatched rows
- 73.07% eligible row match rate
- 76.84% quantity-weighted match rate
- 72.86% end-to-end row resolution
- 76.62% end-to-end quantity resolution
- 0 row-local exact-match consistency failures

The audit confirmed that `owned_keys` should remain recognition
infrastructure but cannot safely enumerate the complete physical collection.

Accepted local audit harness:

`/scripts/ol0a-match-audit.mjs`

### OL-0A2 matcher refinement — complete

OL-0A2b reproduced the accepted baseline and approved a narrow
snapshot-import matcher policy:

- preserve existing denominator normalization;
- allow purely numeric leading-zero equivalence, such as `057` → `57`;
- preserve meaningful prefixes and suffixes such as `TG`, `GG`, `SWSH`,
  `SM`, and `XY`;
- use a frozen 33-entry curated set-name allowlist;
- require unique row-local canonical-card resolution;
- require all successful strategies to agree on the same canonical card ID;
- keep conflicting, ambiguous, or multi-hit rows unresolved.

Validation findings:

- approved combined newly resolved: 948 rows / quantity 1,131
- approved combined in-sample eligible row resolution: 89.00%
- approved combined in-sample quantity resolution: 90.75%
- catalog-wide leading-zero collisions: 0
- cross-strategy conflicts: 0
- accepted set mappings: 33
- deferred mappings: 7
- rejected mappings: 34

Deferred mappings remain excluded, including cross-language or cross-release
correspondences such as:

- `Ninja Spinner` → `Chaos Rising`
- `Inferno X` → `Phantasmal Flames`
- `Night Wanderer` → `Shrouded Fable`

The aliases are scoped only to the snapshot importer. They are not global
normalization rules and do not change `owned_keys`.

Approved simulation:

`/scripts/ol0a2-refinement-sim.mjs`

### OL-0B import snapshot schema — complete

The immutable import snapshot schema is installed and validated in Supabase:

- `user_import_batches`
- `user_import_rows`
- atomic activation and failure functions
- processing-only child insertion
- immutable evidence rows
- parent-based RLS
- one active import snapshot per user
- reconciliation constraints
- concurrency-safe child insertion and activation
- previous active snapshot preserved until a replacement activates

Canonical migration:

`/docs/sql/ol-0b-1-user-import-snapshots.sql`

### OL-0C importer integration — complete

Matcher version: `ol0c-1`.

OL-0C is merged to `main`. A signed-in Collectr import now runs two deliberately
separate paths:

1. The existing `owned_keys` recognition import remains primary.
2. After the `owned_keys` write is confirmed successful, the app builds and
   persists an immutable enumeration snapshot.

The paths are intentionally non-atomic:

- `saveCollection()` is awaited and its returned `error` is explicitly checked;
- snapshot creation is skipped if `owned_keys` persistence fails;
- the user receives a visible warning that the CSV may appear only for the
  current session when ownership persistence fails;
- if ownership persistence succeeds but the snapshot fails, the user receives
  an explicit partial-success warning;
- `fail_import_batch()` never rolls back `owned_keys`;
- the previous active snapshot remains active until the replacement batch
  activates successfully.

OL-0C implementation:

- `src/constants/ol0aAllowlist.js` — frozen 33-entry allowlist with integrity
  assertions.
- `src/services/snapshotMatcher.js` — pure classifier and deterministic
  agreement resolution.
- `src/services/catalogIndexLoader.js` — stable, paged `cards_effective`
  loading; completeness and duplicate-ID checks; fail-closed behavior.
- `src/services/importSnapshotService.js` — processing batch, chunked immutable
  row insertion, activation, and failure lifecycle.
- `scripts/ol0c-import-snapshot.test.mjs` — deterministic validation harness.
- `src/App.jsx` — additive sequencing and user-visible failure handling.

Stored match rules are bounded to:

- `exact`
- `exact_paren_stripped`
- `set_alias`
- `set_alias_paren_stripped`
- `leading_zero`
- `leading_zero_paren_stripped`
- `set_alias_leading_zero`
- `set_alias_leading_zero_paren_stripped`

Validation completed:

- full matcher/lifecycle harness: 99 passed, 0 failed;
- full-catalog equivalence against 23,314 distinct catalog rows;
- historical audit export reproduced:
  - baseline: 4,349 matched / 1,116 ambiguous / 487 unmatched;
  - OL-0C: 5,297 matched / 169 ambiguous / 486 unmatched;
  - 17 invalid / 5,969 stored / 948 newly resolved / 0 conflicts;
- Vercel Preview dependency install and Vite build passed;
- live Preview import created and activated a reconciled snapshot.

Live Preview smoke-test batch for the then-current Collectr export:

- 5,890 total source rows
- 5,884 Pokémon rows / 6 non-Pokémon rows
- 5,703 positive-quantity stored rows
- 181 watchlist-only rows
- 5,098 matched
- 157 ambiguous
- 431 unmatched
- 17 invalid
- status: `active`

The child-row counts and stored match-rule totals reconciled exactly to the
batch header.

### Current boundary / next decision

OL-0C creates enumeration infrastructure only. No Owned Library UI reads the
snapshot tables yet, and existing ownership display still derives from
`owned_keys` plus manual overrides.

The next decision is to define and validate the smallest active-snapshot read
model and Owned Library v0 surface before implementation. Do not begin a
production ownership cutover, broad fuzzy matching, global aliases, or
9-pocket page planning as part of that slice.

## Completion tracking

Existed before the intent system and is unchanged:
- Artist hero shows owned/total percentage; Dashboard shows artist progress rows.
- Counts derive from `visibleCardData`, so hiding TCG Pocket affects totals.
- Manual overrides are respected.
- Do not rebuild completion counts unless explicitly requested.

## Current repo structure — main branch

```
src/
  App.jsx              — main React component tree; large single file remains intentional
  main.jsx             — entry point; ErrorBoundary + ?share= routing
  assets/logo.webp
  constants/           — artists.js, config.js, setOrder.js, ol0aAllowlist.js
  services/            — supabaseClient, cardService, collectionService,
                         shareService, cardAdapter, imageService,
                         tcgdexService, intentService, artistService,
                         binderService, snapshotMatcher,
                         catalogIndexLoader, importSnapshotService
  styles/index.css
  utils/               — cache, cardUtils, format, imageUrl, keys, slug, sort
public/                — icons, manifest.json, sw.js, logo assets
docs/                  — this documentation set + archive/ + sql/
scripts/               — OL-0A audit, OL-0A2 simulation, OL-0C validation
sync/                  — data sync / backfill scripts
.github/workflows/build-check-gate2.yml — manual-only build smoke test
index.html             — minimal Vite shell
```

`src/App.jsx` contains the existing product surfaces, including Dashboard,
Artist Page, Binder, SharedBinder, Hunt Board, Artist Directory, Planned
Binder index/detail, CardModal, Settings, and the top-level App shell.

Do not split `App.jsx` unless explicitly approved.

## Supabase objects

Tables/views in use:

- catalog/data: `cards`, `card_extras`, `cards_effective`, `artists`,
  `illustrator_directory`
- user archive/planning: `user_tracked_artists`, `user_collection`,
  `card_overrides`, `card_favorites`, `user_card_intent`
- planned binders: `user_binders`, `user_binder_cards`
- import snapshots: `user_import_batches`, `user_import_rows`
- pricing/history: `price_history`

RPCs in use:

- `get_shared_collection`
- `add_artist_to_archive`
- `activate_import_batch`
- `fail_import_batch`

## Known limitations / open items

- Owned Library UI is not built yet; active import snapshots are enumeration infrastructure only.
- The OL-0C catalog index is loaded client-side in stable pages during signed-in CSV import. The loader is isolated so a future server-side resolver can replace it without changing the matcher.
- Null-illustrator bulk enrichment for the six affected SWSH-era set ranges (~1,400 cards; TCGdex structural data gap) is still pending. It is a data-quality follow-up, not a feature blocker.
- Saya Tsuruta alias (full-width space variant) remains unconfirmed.
- Pricing features deferred: confidence labels, staleness display, Cardmarket link button, price alerts.
- Hunt Board back button always returns to Dashboard, even when entered from the Binder header (known, deferred).

