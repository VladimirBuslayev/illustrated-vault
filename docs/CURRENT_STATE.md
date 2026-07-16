# Illustrated Vault — Current State

Last updated: 2026-07-16

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
| Owned Library OL-0A–OL-2B | Audit through live UI and verified matching recovery | ✓ Complete through OL-2B |
| OWN-0A | Authoritative snapshot ownership read, dark-loaded in App | ✓ Complete 2026-07-16 |

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

## Owned Library and ownership truth

Owned Library is live as the complete imported physical-collection archive. It
remains distinct from:

- Artist Binder: owned/missing cards across intentionally tracked artists.
- Planned Binder: a collection the user is intentionally building.
- Hunt Board: cards the user is actively trying to acquire.

The architecture deliberately separates:

- `user_collection.owned_keys` — legacy, lossy recognition infrastructure;
- active import snapshots — canonical physical-printing enumeration authority;
- `manualOwned` / `manualMissing` — explicit per-card overrides.

Owned Library already reads the active snapshot directly. Other authenticated
collection surfaces still use the existing `checkOwned` → `isCardOwned` path
until OWN-0B. No visible authenticated ownership cutover has occurred yet.

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

### OL-0D active snapshot read model — complete

OL-0D establishes the authenticated read contract for the current active
immutable import snapshot.

Database RPC:

`get_active_import_snapshot_read_model`

Frontend service:

`src/services/ownedLibraryService.js`

Validation artifacts:

- `docs/sql/ol-0d-2-active-snapshot-read-model-validation.sql`
- `scripts/ol0d-active-snapshot-read-model.test.mjs`

The RPC is:

- read-only;
- `SECURITY INVOKER`;
- scoped internally to `auth.uid()`;
- protected by the existing OL-0B RLS policies;
- versioned with `contractVersion: 1`;
- not callable with a caller-supplied user ID.

Supported states:

- `ready`
- `no_active_batch`
- `snapshot_changed`

The read model:

- resolves the caller’s single active import batch;
- aggregates immutable matched source rows by canonical `card_id`;
- sums physical quantity across duplicate source rows;
- retains deterministic fallback evidence from the lowest contributing
  `source_row_number`;
- summarizes unresolved rows by stored `match_status` and `match_reason`;
- left-joins current `cards_effective` metadata;
- retains matched cards whose catalog record later becomes unavailable;
- defensively deduplicates catalog rows before joining;
- supports server-side search, filtering, deterministic sorting, and offset
  pagination;
- fails closed when active-batch header reconciliation no longer matches the
  immutable child rows.

OL-0D does not:

- replace or modify `user_collection.owned_keys`;
- change existing ownership recognition;
- merge `manualOwned` or `manualMissing` into snapshot quantity;
- modify the importer or matcher;
- build Owned Library UI;
- change `App.jsx`;
- redesign the OL-0B schema.

Validation completed:

- rollback-safe Supabase SQL validation passed;
- frontend-service harness: 38 passed, 0 failed;
- real active snapshot returned `ready`;
- Vercel production build and deployment passed.

Real active snapshot validation:

- batch matcher version: `ol0c-1`
- 5,890 total source rows
- 5,703 stored positive-quantity rows
- 5,098 matched source rows
- 7,043 matched physical copies
- 4,589 distinct canonical cards
- 157 ambiguous rows
- 431 unmatched rows
- 17 invalid rows
- 605 unresolved rows
- 700 unresolved quantity
- 0 catalog-missing canonical cards
- 0 catalog-missing quantity

The difference between matched source rows and distinct canonical cards confirms
that duplicate source rows are aggregated rather than emitted as duplicate
library items.

### OL-1 — Owned Library v0 UI — live

Owned Library is reachable from the Dashboard and uses the OL-0D read model
directly. Current behavior:

- full-color grid of confidently matched owned cards;
- server-backed search, sort, and catalog-status filtering;
- page size 60 with `Load 60 more`;
- showing-range and total-count disclosure;
- matched / ambiguous / unmatched / invalid / catalog-missing diagnostics;
- read-only CardModal inspection path;
- mobile header, grid overflow, and search-focus issues corrected;
- post-import refresh through `importEpoch`;
- no merge of manual overrides into imported quantity.

Owned Library is the trusted owner-facing snapshot surface. It does not use
`owned_keys` to decide whether a canonical printing is present.

### OL-2A / OL-2B — Verified Matching Recovery — complete

OL-2B approved and deployed one narrow Tier-A alias:

`McDonald's Promos 2024` → `McDonald's Collection 2024`

Production active batch:

- batch: `1dd67dd6-15fb-4452-8edd-3626681e2a1d`
- matcher version: `ol2b-1`
- total source rows: 6,141
- stored positive-quantity rows: 5,969
- matched source rows: 5,307
- ambiguous rows: 167
- unmatched rows: 478
- invalid rows: 17
- distinct canonical owned cards: 4,776
- matched physical copies: 7,390
- catalog-missing canonical cards: 0

OL-2A baseline → OL-2B active delta:

- distinct owned cards: 4,769 → 4,776
- added: 7
- removed: 0
- net: +7
- eight recovered source rows because `2024sv-12` appeared twice
- recovered canonical IDs:
  `2024sv-4`, `2024sv-5`, `2024sv-8`, `2024sv-11`,
  `2024sv-12`, `2024sv-14`, `2024sv-15`

OL-2B is complete and accepted. The McDonald's alias is approved, deployed,
and must not be revisited without new evidence.

### OWN-0A — Authoritative Snapshot Ownership Read — complete

OWN-0A is deployed and validated.

It added:

- `get_active_snapshot_owned_card_ids()` — read-only, `SECURITY DEFINER`,
  `auth.uid()`-scoped, fail-closed on multiple active batches or header/row
  mismatch;
- strict `fetchActiveSnapshotOwnedCardIds()` service wrapper returning a
  canonical-ID `Set`;
- dark-loaded App authority state:
  `loading | ready | no_active_batch | multiple_active_batches | error`;
- refresh on sign-in and `importEpoch`;
- request supersession, batch-bound wholesale replacement, and terminal
  invalidation.

Production validation:

- RPC state: `ready`
- active batch: `1dd67dd6-15fb-4452-8edd-3626681e2a1d`
- owned ID length: 4,776
- distinct matched IDs: 4,776
- matched rows: 5,307
- deployed OL-0D read-model count: 4,776
- no users with multiple active batches
- catalog available / missing: 4,776 / 0
- query execution: approximately 7.6 ms; no sequential scan; no new index
  justified

Ownership-truth evidence:

- Komiya Expedition Pidgeot `ecard1-23` is absent from the active snapshot;
- Komiya Expedition Pidgeot `ecard1-59` is absent from the active snapshot;
- Komiya positive control: 185 exact snapshot-owned cards.

`checkOwned` and `isCardOwned` remain unchanged. OWN-0A is a dark authority
input only and corrected no additional visible surface. Owned Library remains
on its existing snapshot read path.

Closeout:

`/docs/OWN-0A_CLOSEOUT.md`

### Current ownership boundary / next slice

Confirmed current split:

1. **Owned Library** — active snapshot canonical `card_id`; trusted.
2. **Authenticated collection surfaces** — still use loose `owned_keys` through
   the existing App `checkOwned` closure.
3. **SharedBinder** — separate share-token `owned_keys` path; unresolved
   external ownership boundary.

OWN-0B is the next ownership slice, but it is **architecture inspection only**
until the following are resolved:

- 17 manual overrides outside `cards_effective`;
- at least two Pokémon GO / TCGdex override IDs;
- remaining legacy or alternate override namespaces;
- Pokémon GO set-path cards using a different ID namespace;
- loading / error / no-snapshot behavior as ownership unavailable, not missing;
- strict canonical precedence:
  force-missing → force-owned → active snapshot canonical ID → missing;
- no `owned_keys` fallback;
- SharedBinder remains out of the authenticated cutover.

Roadmap after OWN-0B:

`OL-2C.1 Image Resilience → CAT-0 Catalog Source & Coverage Audit → next
evidence-backed catalog slice → OWN-1 Artwork vs Printing ownership policy`

Locked ownership principles:

- physical-printing ownership, artwork identity, and future artwork-goal
  satisfaction are separate concepts;
- owning one language or printing never implies owning another;
- false-positive physical ownership is more harmful than a temporary false
  negative;
- artwork-level goal satisfaction, if introduced later, is policy—not
  ownership.
## Completion tracking

Current authenticated completion counts still flow through the existing App
`checkOwned` closure:

- Artist hero shows owned/total percentage; Dashboard shows artist progress rows.
- Counts derive from `visibleCardData`, so hiding TCG Pocket affects totals.
- Manual overrides are respected.
- Until OWN-0B, loose `owned_keys` collisions can inflate counts on these
  surfaces.
- Owned Library counts are separate and snapshot-authoritative.
- Do not patch counts surface-by-surface; OWN-0B must change the centralized
  ownership seam.

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
                         catalogIndexLoader, importSnapshotService,
                         ownedLibraryService
  styles/index.css
  utils/               — cache, cardUtils, format, imageUrl, keys, slug, sort
public/                — icons, manifest.json, sw.js, logo assets
docs/                  — this documentation set + archive/ + sql/
scripts/               — OL-0A audit, OL-0A2 simulation, OL-0C/OL-0D validation
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
- `get_active_import_snapshot_read_model`
- `get_active_snapshot_owned_card_ids`

## Known limitations / open items

- OWN-0B authenticated ownership cutover has not started. Artist Page, Binder,
  Dashboard, CardModal, Hunt Board, Artist Directory, and Planned Binder still
  consume the loose `owned_keys` path.
- 17 manual overrides use IDs outside `cards_effective`; at least two are
  Pokémon GO / TCGdex IDs. Do not delete or rewrite them before the OWN-0B
  namespace and reachability audit.
- Pokémon GO set-path cards use a different ID space from snapshot canonical
  IDs and need an explicit narrow policy before cutover.
- SharedBinder remains on its separate loose share-token ownership path and is
  not corrected by OWN-0A.
- Image resilience remains OL-2C.1. Never silently substitute another
  printing's image; cross-language or cross-printing proxies require explicit
  labeling.
- CAT-0 remains a diagnostic catalog-source and coverage audit, not an
  implementation rewrite.
- The OL-0C catalog index is loaded client-side in stable pages during signed-in
  CSV import. The loader is isolated so a future server-side resolver can
  replace it without changing the matcher.
- Null-illustrator bulk enrichment for the six affected SWSH-era set ranges
  (~1,400 cards; TCGdex structural data gap) remains a data-quality follow-up.
- Saya Tsuruta alias (full-width space variant) remains unconfirmed.
- Pricing features deferred: confidence labels, staleness display, Cardmarket
  link button, price alerts.
- Hunt Board back button always returns to Dashboard, even when entered from
  the Binder header.
