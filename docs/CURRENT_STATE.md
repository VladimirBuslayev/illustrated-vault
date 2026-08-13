Illustrated Vault — Current State

Last updated: 2026-08-13

Production

Production app: https://illustratedvault.comServed by Vercel from the main branch. Vercel builds automatically on push to main.

Domain: illustratedvault.com (Porkbun). GitHub Pages is unpublished. Transactional email via Resend at updates.illustratedvault.com.

Gate status

Gate

Scope

Status

Gate 1

Stabilize single-file MVP

✓ Closed (v0.1.4)

Gate 2

Vite 5 / React 18 modular migration, Vercel cutover

✓ Closed 2026-07-01 (gate-2-complete tag)

Gate 3

Data foundation: artists table, FK identity, cleanup

✓ Closed

Hunt Board H-1/H-2/H-3

Global hunt planning surface

✓ Complete

Owned Library OL-0A–OL-2B

Audit through live UI and verified matching recovery

✓ Complete through OL-2B

OWN-0A

Authoritative snapshot ownership read

✓ Complete 2026-07-16

OWN-0B

Authenticated ownership cutover to active snapshot authority

✓ Complete 2026-07-17

OL-2C.1

Exact-printing runtime image resilience

✓ Complete 2026-07-24

CAT-0

Catalog source & coverage audit (diagnostic only)

✓ Complete 2026-07-27

CAT-1

Temporal metadata restoration (series / release_date)

✓ Complete 2026-07-28

BP-1A

Planned Binder manual list ordering

✓ Complete

Artist Page 3.0

Source-governed editorial dossier composition

✓ Complete

BP-3.1A

Binder Page Layout data foundation

✓ Complete

BP-3.1B

Binder Page frontend read layer + Cards / Pages shell

✓ Complete

BP-3.1C

First-use Binder Page setup (format + theme)

✓ Complete, production-validated

WF-1

Development / knowledge workflow and agent contract

✓ Complete 2026-08-13

Full Gate 2 phase history (5A–5O) lives in CHANGELOG.md. No Gate 2 rollback or deferred cleanup remains.

Gate 3 data foundation — complete

artists table exists and is well-formed (with alias arrays).

cards_effective view exposes artist_id.

Frontend artist queries use the FK-based artist_id path (.eq('artist_id', ...)), with the old ILIKE path retained only as a fallback for entries without an artistId. Gate 3 bumped pb7_supa_ → pb8_supa_ to invalidate stale ILIKE caches; OWN-0B later bumped the live canonical-card cache to pb9_supa_ and the external-set cache to pb7_cards_ so every returned card carries an explicit ownership namespace.

The old sui ILIKE false-positive bug (substring match on "Misa Tsutsui") is fixed.

Tetsu Kayama alias/FK cleanup done.

Three card_extras seed FK fixes: swsh11-186 → shinji-kanda, swsh12.5-GG19 → asako-ito, swsh12.5-GG69 → akira-egawa.

⚠ CAT-0 flag — unreconciled. Production introspection (2026-07-27) proves card_extras has no artist_id column and can override illustrator only, so card_extras cannot itself have written these FKs. All three rows do currently carry the documented FKs, meaning a separate, undocumented FK write occurred. Retain this entry and the flag until Gate-3 implementation evidence explains it. Do not rewrite the history or infer intent from current state.

shibuzoh alias includes Shibuzō.

Fukuda "Mosakazu Fukuda" alias confirmed legitimate.

No schema changes are needed for near-term Hunt Board or Artist Page features.

Hunt intent system — live

Supabase table: user_card_intent (RLS: user_id = auth.uid()).

Statuses: want, hunting, maybe, ignore.

Service: src/services/intentService.js — exports fetchUserIntent(userId), setCardIntent(userId, cardId, status), clearCardIntent(userId, cardId), INTENT_STATUSES.

Frontend: intentMap (Map<cardId, status>) lives in App(), loaded once per signed-in user, with optimistic set/clear handlers (handleSetIntent, handleClearIntent).

Rules (invariant):

Intent is planning metadata only.

Intent never affects owned/missing state.

Intent never affects completion counts (ignore included).

Owned cards with stale intent rows are suppressed from hunt surfaces at render time.

Intent is not exposed in SharedBinder v1.

Favorites remain a separate concept: a favorite is an emotional bookmark; intent is acquisition planning on missing cards. The Dashboard "Most Wanted" section is favorites-driven.

Hunt Board — H-1/H-2/H-3 complete

Top-level view hunt, reachable from the Dashboard header and Binder header.

Derived entirely from in-memory state — no new Supabase calls.

Groups: ACTIVE TARGETS (hunting), ON THE LIST (want), MAYBE LATER (maybe); within each, grouped by artist in ARTISTS roster order; within each artist, sorted by market price descending, unpriced last.

Shows only missing cards with intent; suppresses owned cards with stale intent rows; suppresses ignore; deduplicates by card id.

Row tap opens the existing CardModal; status changes and Force Owned update the board live.

H-2: collapsible sections. ACTIVE TARGETS and ON THE LIST default open; MAYBE LATER defaults collapsed when it has cards; counts stay visible in collapsed headers; collapse state is local only, not persisted. Dashboard mobile header polish included.

H-3: section-header tap target enlarged for mobile (padding .2rem → .55rem).

Artist Page 2.0 — live

Editorial hero with artist metadata; owned/missing completion chips; Hunt status chips; Notable Cards strip.

Segmented control: All / Owned / Missing / Hunting. Hunting segment shows hunting and want cards grouped by status/set.

Intent pills on missing tiles: filled purple dot = hunting; hollow purple ring = want. maybe and ignore do not appear as prominent tile pills.

Color-mode toggle reuses the persisted showAllColor state shared with Binder view.

Missing/Owned segments are literal because soloSections is passed; Binder/SharedBinder retain legacy paired-section behavior (they do not pass soloSections).

Artist Page Slice C (editorial polish) applied:

Hero chip diet: Owned/Missing chips removed (they duplicated the progress line). Only Hunting / "On the list" chips remain, shown when non-zero, and they are now tappable shortcuts that activate the Hunting segment (same viewMode state as the sticky controls — no new state, intent read-only).

About + Notable Cards merged into one collapsible "FROM THE ARCHIVE" band (default open; local state only, not persisted; V-C.1 chevron pattern). Instructional copy ("Tap to inspect · owned cards glow") removed; owned signal quieted to accent ring + ✓ with neutral captions. No curation or reordering system.

Dynamic-artist fallback: artists with no story and no notable cards (all dynamic artists today) render a quiet one-line band — "One of your additions · N cards in the archive." — instead of silently dropping the band, so added-artist pages keep the same skeleton as curated ones.

Hunting segment framing: a quiet summary line ("N active targets · M on the list") renders between the controls and the grid, hidden while searching so counts never disagree with the filtered grid. The WANT group label inside the segment is renamed ON THE LIST (Hunt Board vocabulary), and the empty state now reads "No hunt targets for this artist yet — mark a missing card as Hunting and it will gather here." Both strings are only reachable from the Artist Page: Binder/SharedBinder never pass viewMode="hunting".

Manage-in-mini-header for dynamic artists is deliberately NOT in this slice — deferred to Artist Page C2.

Artist Page 3.0 — editorial archive complete

Artist Page 3.0 adds source-governed editorial dossiers on top of the Slice C composition. Content lives in src/constants/artistEditorial.js, keyed by artist slug, and is additive: an artist absent from ARTIST_EDITORIAL still renders the full page from existing ARTIST_FACTS / ARTIST_META content.

Source-integrity rules are part of the contract, not style guidance: no invented first-person quotes, no paraphrase inside quotation marks, no long copied source passages, secondary-source claims phrased as description rather than settled self-description, and no source portraits, scans or non-catalog artwork referenced or hosted. Every image on the page comes from the existing card catalog.

Notable cards resolve by exact canonical ID against the artist's own loaded card array — never by name prefix and never "first matching card". expectName is a mandatory integrity guard: an ID that resolves to a card whose name does not match is omitted rather than substituted, with a console diagnostic.

Komiya was the content pilot, not a separate route. The mobile notable-works rail was refined in the same phase. No schema, ownership, intent, or SharedBinder behavior changed.

Explore Artists directory — A-D1 live

Read-only artists view entered via the "Explore Artists →" link on the Dashboard artist section header; derived from in-memory state. Tapping an artist opens the existing Artist Page.

Tracked artists — A-D2a data foundation + A-D2b0 roster spine live

Permanent product rule: users can look at anything, but can act only on what's in their archive.

A-D2a (SQL, complete):

artists formalized as global artist identity (20 rows at A-D2a; 22 rows as of the CAT-0 baseline, 2026-07-27).

user_tracked_artists (RLS: user_id = auth.uid()) is the per-user archive roster.

illustrator_directory is the discovery source (illustrator + card count).

add_artist_to_archive(p_illustrator text) RPC is the single Add-to-Archive write path.

Only the owner account was seeded with the 20 then-current artists. Not a universal default; new users are not auto-seeded.

A-D2b0 (app, complete):

src/services/artistService.js reads user_tracked_artists and resolves identities from artists. Every function soft-fails to empty.

App.jsx builds effectiveRoster = curated ARTISTS + dynamic additions. Curated ARTISTS remain the unconditional safety floor — any fetch failure renders curated-only, identical to pre-B0 behavior.

Dynamic additions appear under "YOUR ADDITIONS" (Dashboard, Explore Artists, Binder artist dropdown) only when non-empty.

Dynamic card fetch (cardService.js) uses exact artist_id equality OR exact illustrator equality — never substring ILIKE.

SharedBinder and ArtistPicker remain curated-only.

A-D2c-lite (app, complete):

Find Illustrator search lives inside Explore Artists, querying illustrator_directory via searchIllustratorDirectory.

Add to Archive calls addArtistToArchive (add_artist_to_archive RPC). Added artists appear under "YOUR ADDITIONS" once onArtistAdded triggers a tracked-id refetch.

SQL hotfix (committed): add_artist_to_archive now inserts display_name when creating a new artists row. This fixed Add to Archive for illustrators without an existing identity row (e.g. Midori Harada), which previously failed the insert.

No untracked Artist Page yet.

A-D2d (SQL + app, complete):

user_tracked_artists gained a tier text NOT NULL DEFAULT 'added' column (CHECK restricts it to main / secondary / added) and a new uta_update_own RLS UPDATE policy. Scope is inherently dynamic-only: curated ARTISTS entries are never rows in this table.

artistService.js gained fetchTrackedArtistTiers (new, alongside the unchanged fetchTrackedArtistIds), updateArtistTier, and removeArtistFromArchive. The latter two are plain RLS-guarded table writes, not RPCs — neither needs catalog validation or touches global artist identity.

Dynamic artists in effectiveRoster now carry their real per-user tier instead of a hardcoded "added". Dashboard and ArtistDirectory's existing tier-based section splits required no changes.

Explore Artists: a "⋯" Manage control on dynamic artist tiles only offers tier reassignment (Main Artists / Secondary & Special / Your Additions) and Remove from Archive (window.confirm-gated). Curated tiles are visually and functionally untouched.

Removing an artist deletes only the caller's own user_tracked_artists row — never global artist identity, cards, overrides, favorites, hunt intent, or manual owned/missing state.

Binder artist-filter dropdown: dynamic artists now fold into the matching Main/Secondary optgroup by tier; "Your additions" remains for artists still at the added default.

Planned Binders — BP-0A/B complete

Planned Binders are intentional collection-building lists, distinct from the artist-focused archive, complete Owned Library, and active Hunt Board.

Supabase tables: user_binders and user_binder_cards, with per-user RLS.

Users can create, rename, describe, and delete planned binders.

Binder plans support global catalog search, add/remove, duplicate prevention, and Supabase persistence.

Authenticated strict ownership is reused live: canonical plan cards resolve through cards_effective / supaRowToCard, owned cards render normally, and planned but unowned cards render dimmed.

Planned binder cards open the existing CardModal.

Superseded note: this section previously recorded that page layout, slot positions, and physical storage modeling remained deferred. That is no longer current — see Binder Page Planning — BP-3.1A/B/C below. Planned Binder membership itself remains a list, and the physical placement layer is a separate, optional layer over it.

Planned Binder ordering and intent visibility — BP-1A complete

user_binder_cards gained a position integer NOT NULL column carrying a collector-authored list sequence, backfilled deterministically from the then-current service order, with a supporting (binder_id, position, created_at, id) index, a BEFORE INSERT assignment trigger (ubc_before_insert_assign_position / user_binder_cards_assign_position()), and an atomic whole-binder reorder_binder_cards(uuid, text[]) RPC.

Ordering semantics are load-bearing: position is a LIST SEQUENCE. It is not a page number, a pocket index, or any physical binder placement, and must not be reinterpreted as one.

No foreign key was added from user_binder_cards.card_id to cards or cards_effective. This is deliberate: a planned binder is a statement of intent and must survive a catalog row becoming temporarily unavailable. Do not add one later without an explicit product decision.

Hunt intent is visible on planned binder rows, and CardModal gained a Binder Plan entry point so a card can be added to a plan from the universal per-card action surface.

Canonical migration:

/docs/sql/bp-1a-planned-binder-ordering.sql

Binder Page Planning — BP-3.1A/B/C complete

Binder Page Layout is the optional physical page-placement layer over Binder Plan membership. It is a distinct authority from both membership and list order.

Three authorities, never conflated:

user_binder_cards — exact Binder Plan membership (inclusion).

user_binder_cards.position — manual list order only.

user_binder_layout_items — physical pocket placement.

A pocket is occupied by a binder membership row (user_binder_cards.id), never by a global catalog card ID. That is what lets placement clear itself when a card leaves the plan, survive catalog absence, and keep future duplicate physical slots representable. Empty pockets are derived (no row), unplaced cards are derived (a membership with no item), and pages are derived from page_count — there is no page table.

BP-3.1A (SQL, complete) — data foundation:

additive UNIQUE (id, binder_id) on user_binder_cards, added solely to be a legal referent for the composite foreign key below;

user_binder_layouts (at most one per binder, optional) and user_binder_layout_items (occupied pockets only);

RLS is parent-derived SELECT only — there is no client write path to either table;

composite FK makes foreign-binder placement structurally impossible rather than merely validated;

RPCs: iv_binder_layout_document(uuid) (private, STABLE), fetch_binder_page_layout(uuid) (atomic read), create_binder_page_layout(uuid, text, text), save_binder_page_layout(uuid, integer, jsonb), set_binder_layout_theme(uuid, text), reset_binder_page_layout(uuid, text);

no foreign key from any layout table to cards or cards_effective — placement follows membership, and membership is deliberately catalog-independent.

Canonical migration and validation:

/docs/sql/bp-3-1a-binder-page-layout-foundation.sql

/docs/sql/bp-3-1a-binder-page-layout-validation.sql

BP-3.1B (app, complete) — frontend read layer and Cards / Pages shell:

src/services/binderLayoutService.js is the only frontend seam for the BP-3 page-layout RPC surface.

Reads soft-fail into three closed outcomes that must stay distinct:

{ status: "ready", layout: null } — the read succeeded and this binder genuinely has no layout. This is the only payload that may render first-use setup.

{ status: "ready", layout: {…} } — the read succeeded and the document passed strict normalization.

{ status: "failed" } — nothing is known. This is not evidence that a layout is absent and must never render as first-use setup.

A malformed-but-successful RPC response is a read failure, not a repairable document. Nothing coerces a value, defaults a theme, or drops a bad placement: normalization rebuilds the document field by field from validated input and returns null on any violation — wrong contractVersion, binder-ID mismatch, unknown format key or theme, a page or pocket exceeding its ceiling, or a duplicate membership row / duplicate page:pocket slot.

Planned Binder detail gained a Cards / Pages sub-navigation. Membership and layout reads are kept in separate state (undefined = loading, null = failed read, [] = genuinely empty), are request-superseded so one plan's response can never land on another, and the Pages tab is locked while reorder mode is active.

BP-3.1C (app, complete, production-validated) — first-use Binder Page setup:

createBinderLayout is the layout create path. Writes throw rather than soft-failing, because a create that quietly returned a falsy value would let the UI render "ready" for a layout the database may not hold. A malformed successful create fails closed through the same strict normalizer.

Format choices are the three supported physical geometries: 3x3 (9-pocket), 3x4 (12-pocket), 4x4 (16-pocket). Columns × rows is physical page geometry, not CSS convenience — the preview grid is generated from it, so a format can never be shown with a pocket count that disagrees with the key the database stores. Arbitrary rows/columns are not supported.

Eight curated background themes: charcoal, warm-black, deep-plum, midnight-navy, forest, burgundy, sand, soft-stone. The set is byte-identical across the database allowlist, THEMES in binderLayoutService.js, and the UI display order.

Defaults are deliberately asymmetric: format has no default, because pocket geometry cannot be changed later without reset and must therefore be an act rather than an accept; theme defaults to charcoal, the app's existing canonical dark surface.

Creation persists the page layout and the shell then reports format, page count, background, placed and unplaced counts.

Current Binder Page state and containment:

format choices 9-pocket / 12-pocket / 16-pocket;

curated background themes;

persisted page-layout creation;

BP-3.1D onward — actual page arrangement, pocket drag/placement, theme change and reset — intentionally paused, not abandoned. save_binder_page_layout, set_binder_layout_theme and reset_binder_page_layout exist in the database but have no frontend seam, so no code in binderLayoutService.js can modify or remove an existing layout.

SharedBinder — read-only share surface

Never exposes Hunt status, editable controls, or private user info.

Missing-card CSV export is live: Missing CSV button; exports only missing cards from the shared view; respects shared artist selection and viewer artist dropdown; intentionally ignores the search box; excludes TCG Pocket via visibleCardData; client-side generation with UTF-8 BOM; no Supabase writes; no intent/favorites/private columns.

Visual polish

V-A Quiet Pass applied: logo glow reduced, flame/button styling calmed, Dashboard hero de-gradiented, footer artist-name text removed, stale comments cleaned, and an incident where CSS was accidentally pasted into index.html was fixed. index.html must remain a minimal Vite shell (root div + /src/main.jsx script). Do not reintroduce loud fire/game UI.

Brand V-B applied: final logo asset (/illustrated-logo-gradient.svg) wired into BlazLogo (component name kept to avoid touching its 11 call sites), logo sizing reduced across call sites, and the Dashboard hero no longer uses the large brand mark.

Dashboard / Brand Copy V-C applied: the Dashboard hero is now the Vault Feature — an editorial split panel that features one card from the user's own collection data. Selection ladder: hunting intent → want intent → unowned favorite → nearest-incomplete artist ("Artist Focus") → quiet empty state pointing at Explore Artists. Selection is deterministic (roster order, then existing cardData order), price-blind, rotation-free, and read-only over intent/favorites/ownership; owned cards and imageless cards are skipped at selection time. The old stat block is demoted to a quiet single row under the feature, and the rainbow progress bar is calmed to a two-stop amber→plum gradient. Dashboard now receives intentMap (read-only). Copy pass in the same slice: email removed as Dashboard identity (static "YOUR VAULT" eyebrow; email remains only in the landing sign-out row / account context), "The art is the point." replaced by a single landing placement of "For collectors who follow the art." (no Dashboard tagline), "ENTER BINDER" → "Enter the Vault" (landing button only — no route/component rename), "Send Magic Link 🔥" → "Send sign-in link", "No password. One click and you're in." → "No password — a link arrives in your email.", and the Most Wanted all-owned state → "Every card on your list is home." in quiet neutral styling. index.css untouched.

Dashboard V-C.1 polish applied: (1) Vault Queue — the Vault Feature ladder now collects up to 4 candidates (same hunting → want → favorite priority, same roster/cardData order; candidate 0 is identical to the old single pick). The hero's right side shows the other 2–3 candidates as tappable "UP NEXT" thumbs; tapping swaps the featured card for the current session only (plain useState, no persistence, no schema, no localStorage). With no alternates, a quiet "IN YOUR VAULT" artist-progress note fills the space instead of placeholders. (2) Header logo mark reduced 22 → 18 in the Dashboard and Binder headers (SharedBinder untouched). (3) Most Wanted expand/collapse labels are now "Show all N →" / "Collapse ▲" (same show-3-by-default logic). (4) Main Artists and Secondary & Special section headers are collapse toggles (chevron + count when collapsed; Main defaults open, Secondary & Special defaults collapsed, Hunt Board precedent; local state only). (5) A quiet full-width "Find an illustrator →" ghost row sits after the artist sections; the Main Artists header link remains. (6) The header "CSV" button is renamed "Import" and visually softened; placement and import behavior are unchanged. index.css gained one clearly-marked V-C.1 block (.vault-queue + one mobile media query) — its only change since the Gate 2 verbatim copy. Ownership, intent, favorites, Hunt Board, SharedBinder, Artist Page, and A-D2c/A-D2d behavior untouched.

Owned Library and ownership truth

Owned Library is live as the complete imported physical-collection archive. It remains distinct from:

Artist Binder: owned/missing cards across intentionally tracked artists.

Planned Binder: a collection the user is intentionally building.

Hunt Board: cards the user is actively trying to acquire.

The architecture deliberately separates:

user_collection.owned_keys — legacy, lossy recognition infrastructure;

active import snapshots — canonical physical-printing enumeration authority;

manualOwned / manualMissing — explicit per-card overrides.

Owned Library reads the active snapshot through OL-0D. Since OWN-0B, every ownership-dependent authenticated collection surface uses the same active-snapshot canonical-ID authority through the centralized App checkOwned seam. The loose owned_keys predicate is no longer an authenticated ownership fallback; it remains legacy recognition infrastructure and still powers the separate SharedBinder boundary.

OL-0A matching audit — complete

OL-0A ran against a real Collectr export and the complete cards_effective catalog.

Baseline results:

6,141 total Collectr rows

5,969 positive-quantity Pokémon rows

5,952 eligible rows with name, set, and card number

4,349 conservatively matched rows

1,116 ambiguous rows

487 unmatched rows

73.07% eligible row match rate

76.84% quantity-weighted match rate

72.86% end-to-end row resolution

76.62% end-to-end quantity resolution

0 row-local exact-match consistency failures

The audit confirmed that owned_keys should remain recognition infrastructure but cannot safely enumerate the complete physical collection.

Accepted local audit harness:

/scripts/ol0a-match-audit.mjs

OL-0A2 matcher refinement — complete

OL-0A2b reproduced the accepted baseline and approved a narrow snapshot-import matcher policy:

preserve existing denominator normalization;

allow purely numeric leading-zero equivalence, such as 057 → 57;

preserve meaningful prefixes and suffixes such as TG, GG, SWSH, SM, and XY;

use a frozen 33-entry curated set-name allowlist;

require unique row-local canonical-card resolution;

require all successful strategies to agree on the same canonical card ID;

keep conflicting, ambiguous, or multi-hit rows unresolved.

Validation findings:

approved combined newly resolved: 948 rows / quantity 1,131

approved combined in-sample eligible row resolution: 89.00%

approved combined in-sample quantity resolution: 90.75%

catalog-wide leading-zero collisions: 0

cross-strategy conflicts: 0

accepted set mappings: 33

deferred mappings: 7

rejected mappings: 34

Deferred mappings remain excluded, including cross-language or cross-release correspondences such as:

Ninja Spinner → Chaos Rising

Inferno X → Phantasmal Flames

Night Wanderer → Shrouded Fable

The aliases are scoped only to the snapshot importer. They are not global normalization rules and do not change owned_keys.

Approved simulation:

/scripts/ol0a2-refinement-sim.mjs

OL-0B import snapshot schema — complete

The immutable import snapshot schema is installed and validated in Supabase:

user_import_batches

user_import_rows

atomic activation and failure functions

processing-only child insertion

immutable evidence rows

parent-based RLS

one active import snapshot per user

reconciliation constraints

concurrency-safe child insertion and activation

previous active snapshot preserved until a replacement activates

Canonical migration:

/docs/sql/ol-0b-1-user-import-snapshots.sql

OL-0C importer integration — complete

Matcher version: ol0c-1.

OL-0C is merged to main. A signed-in Collectr import now runs two deliberately separate paths:

The existing owned_keys recognition import remains primary.

After the owned_keys write is confirmed successful, the app builds and persists an immutable enumeration snapshot.

The paths are intentionally non-atomic:

saveCollection() is awaited and its returned error is explicitly checked;

snapshot creation is skipped if owned_keys persistence fails;

the user receives a visible warning that the CSV may appear only for the current session when ownership persistence fails;

if ownership persistence succeeds but the snapshot fails, the user receives an explicit partial-success warning;

fail_import_batch() never rolls back owned_keys;

the previous active snapshot remains active until the replacement batch activates successfully.

OL-0C implementation:

src/constants/ol0aAllowlist.js — frozen 33-entry allowlist with integrity assertions. (Amended to 34 entries by OL-2B.)

src/services/snapshotMatcher.js — pure classifier and deterministic agreement resolution.

src/services/catalogIndexLoader.js — stable, paged cards_effective loading; completeness and duplicate-ID checks; fail-closed behavior.

src/services/importSnapshotService.js — processing batch, chunked immutable row insertion, activation, and failure lifecycle.

scripts/ol0c-import-snapshot.test.mjs — deterministic validation harness.

src/App.jsx — additive sequencing and user-visible failure handling.

Stored match rules are bounded to:

exact

exact_paren_stripped

set_alias

set_alias_paren_stripped

leading_zero

leading_zero_paren_stripped

set_alias_leading_zero

set_alias_leading_zero_paren_stripped

Validation completed:

full matcher/lifecycle harness: 99 passed, 0 failed;

full-catalog equivalence against 23,314 distinct catalog rows (historical — the current catalog baseline is 23,780; see CAT-0);

historical audit export reproduced:

baseline: 4,349 matched / 1,116 ambiguous / 487 unmatched;

OL-0C: 5,297 matched / 169 ambiguous / 486 unmatched;

17 invalid / 5,969 stored / 948 newly resolved / 0 conflicts;

Vercel Preview dependency install and Vite build passed;

live Preview import created and activated a reconciled snapshot.

Live Preview smoke-test batch for the then-current Collectr export:

5,890 total source rows

5,884 Pokémon rows / 6 non-Pokémon rows

5,703 positive-quantity stored rows

181 watchlist-only rows

5,098 matched

157 ambiguous

431 unmatched

17 invalid

status: active

The child-row counts and stored match-rule totals reconciled exactly to the batch header.

OL-0D active snapshot read model — complete

OL-0D establishes the authenticated read contract for the current active immutable import snapshot.

Database RPC:

get_active_import_snapshot_read_model

Frontend service:

src/services/ownedLibraryService.js

Validation artifacts:

docs/sql/ol-0d-2-active-snapshot-read-model-validation.sql

scripts/ol0d-active-snapshot-read-model.test.mjs

The RPC is:

read-only;

SECURITY INVOKER;

scoped internally to auth.uid();

protected by the existing OL-0B RLS policies;

versioned with contractVersion: 1;

not callable with a caller-supplied user ID.

Supported states:

ready

no_active_batch

snapshot_changed

The read model:

resolves the caller's single active import batch;

aggregates immutable matched source rows by canonical card_id;

sums physical quantity across duplicate source rows;

retains deterministic fallback evidence from the lowest contributing source_row_number;

summarizes unresolved rows by stored match_status and match_reason;

left-joins current cards_effective metadata;

retains matched cards whose catalog record later becomes unavailable;

defensively deduplicates catalog rows before joining;

supports server-side search, filtering, deterministic sorting, and offset pagination;

fails closed when active-batch header reconciliation no longer matches the immutable child rows.

OL-0D does not:

replace or modify user_collection.owned_keys;

change existing ownership recognition;

merge manualOwned or manualMissing into snapshot quantity;

modify the importer or matcher;

build Owned Library UI;

change App.jsx;

redesign the OL-0B schema.

Validation completed:

rollback-safe Supabase SQL validation passed;

frontend-service harness: 38 passed, 0 failed;

real active snapshot returned ready;

Vercel production build and deployment passed.

Real active snapshot validation:

batch matcher version: ol0c-1

5,890 total source rows

5,703 stored positive-quantity rows

5,098 matched source rows

7,043 matched physical copies

4,589 distinct canonical cards

157 ambiguous rows

431 unmatched rows

17 invalid rows

605 unresolved rows

700 unresolved quantity

0 catalog-missing canonical cards

0 catalog-missing quantity

The difference between matched source rows and distinct canonical cards confirms that duplicate source rows are aggregated rather than emitted as duplicate library items.

OL-1 — Owned Library v0 UI — live

Owned Library is reachable from the Dashboard and uses the OL-0D read model directly. Current behavior:

full-color grid of confidently matched owned cards;

server-backed search, sort, and catalog-status filtering;

page size 60 with Load 60 more;

showing-range and total-count disclosure;

matched / ambiguous / unmatched / invalid / catalog-missing diagnostics;

read-only CardModal inspection path;

mobile header, grid overflow, and search-focus issues corrected;

post-import refresh through importEpoch;

no merge of manual overrides into imported quantity.

Owned Library is the trusted owner-facing snapshot surface. It does not use owned_keys to decide whether a canonical printing is present.

OL-2A / OL-2B — Verified Matching Recovery — complete

OL-2B approved and deployed one narrow Tier-A alias:

McDonald's Promos 2024 → McDonald's Collection 2024

Production active batch:

batch: 1dd67dd6-15fb-4452-8edd-3626681e2a1d

matcher version: ol2b-1

total source rows: 6,141

stored positive-quantity rows: 5,969

matched source rows: 5,307

ambiguous rows: 167

unmatched rows: 478

invalid rows: 17

distinct canonical owned cards: 4,776

matched physical copies: 7,390

catalog-missing canonical cards: 0

OL-2A baseline → OL-2B active delta:

distinct owned cards: 4,769 → 4,776

added: 7

removed: 0

net: +7

eight recovered source rows because 2024sv-12 appeared twice

recovered canonical IDs: 2024sv-4, 2024sv-5, 2024sv-8, 2024sv-11, 2024sv-12, 2024sv-14, 2024sv-15

OL-2B is complete and accepted. The McDonald's alias is approved, deployed, and must not be revisited without new evidence.

OWN-0A — Authoritative Snapshot Ownership Read — complete

OWN-0A is deployed and validated.

It added:

get_active_snapshot_owned_card_ids() — read-only, SECURITY DEFINER, auth.uid()-scoped, fail-closed on multiple active batches or header/row mismatch;

strict fetchActiveSnapshotOwnedCardIds() service wrapper returning a canonical-ID Set;

App authority state, introduced dark in OWN-0A and consumed by OWN-0B: loading | ready | no_active_batch | multiple_active_batches | error;

refresh on sign-in and importEpoch;

request supersession, batch-bound wholesale replacement, and terminal invalidation.

Production validation:

RPC state: ready

active batch: 1dd67dd6-15fb-4452-8edd-3626681e2a1d

owned ID length: 4,776

distinct matched IDs: 4,776

matched rows: 5,307

deployed OL-0D read-model count: 4,776

no users with multiple active batches

catalog available / missing: 4,776 / 0

query execution: approximately 7.6 ms; no sequential scan; no new index justified

Ownership-truth evidence:

Komiya Expedition Pidgeot ecard1-23 is absent from the active snapshot;

Komiya Expedition Pidgeot ecard1-59 is absent from the active snapshot;

Komiya positive control: 185 exact snapshot-owned cards.

OWN-0A did not change visible ownership on its own. OWN-0B now consumes the Set through the centralized authenticated ownership selector and authority gate. Owned Library remains on its independent OL-0D snapshot read path.

Closeout:

/docs/OWN-0A_CLOSEOUT.md

OWN-0B — Authenticated Ownership Cutover — complete

OWN-0B is merged to main, deployed to production, and smoke-tested.

Production files changed:

src/App.jsx

src/services/cardAdapter.js

src/services/cardService.js

Effective authenticated ownership is now centralized:

canonical cards: force-missing → force-owned → active snapshot canonical ID → missing;

external-set or unknown cards: force-missing → force-owned → missing;

no authenticated owned_keys fallback.

The single authenticated App checkOwned closure uses the strict selector. SharedBinder keeps its separate share-token isCardOwned / owned_keys closure and remains explicitly out of this cutover.

Authority behavior:

ready — ownership-dependent authenticated surfaces render normally;

loading — those surfaces are gated; a retained prior Set is not shown;

no_active_batch — blocked import/onboarding state, not an all-missing collection;

error / multiple_active_batches — fail-closed retry states;

retry calls the authority read directly and does not misuse importEpoch;

the requested view, artistSlug, and planId remain preserved while gated.

Ownership namespace contract:

supaRowToCard marks canonical cards_effective cards with ownershipNamespace: "canonical";

the currently unwired TCGdex set path marks cards ownershipNamespace: "external-set";

absent or unknown namespace fails conservatively to override-only / missing;

current canonical caches use pb9_supa_; external-set caches use pb7_cards_; cache-hit normalization prevents unmarked legacy objects from escaping; Settings cache clearing removes both current and retained legacy prefixes.

Planned Binder verification confirmed both fetchCardsByIds and searchCatalogCards query cards_effective, preserve canonical IDs, adapt through supaRowToCard, and use no card-object cache. No BinderPlan-specific ownership stamp or binderService.js change was required.

Preview ownership-delta validation:

3,295 rendered canonical cards audited;

old loose-owned: 1,461;

new strict-owned: 1,344;

168 owned_keys false-positive verdicts removed;

51 snapshot true-positive verdicts added;

net visible change: −117 owned cards;

0 unexplained changes;

0 external-set cards rendered;

125 override-controlled rows remained verdict-stable (96 force-owned, 29 force-missing);

every snapshot-positive card not force-missing remained owned.

Komiya Expedition Pidgeot evidence after cutover:

ecard1-59 — absent from snapshot, no override, correctly missing;

ecard1-23 — absent from snapshot but intentionally remains owned because an explicit force-owned override is present.

The 17 previously identified noncanonical override rows remain untouched and inert: none resolve to cards, cards_effective, the active snapshot, or a currently rendered external-set card ID.

Production validation:

Vercel Preview build passed;

temporary Preview audit instrumentation was removed before merge;

production package contains no audit hook;

merged to main;

Vercel production deployment passed;

production smoke test passed.

Closeout:

/docs/OWN-0B_CLOSEOUT.md

OL-2C.1 — Image Resilience — complete

OL-2C.1 is merged to main, deployed to production, and smoke-tested.

Production files changed:

src/App.jsx

src/components/CardImage.jsx — new shared resilience seam

src/services/imageService.js

src/styles/index.css

Locked runtime policy:

exact TCGdex primary → one retry → verified exact Pokémon TCG API fallback → one retry → neutral unavailable

No other-language, other-set, other-variation, other-printing, or artwork-equivalent image may be substituted.

Pokémon TCG API fallback verification requires:

exact returned card ID;

conservative normalized card-number equality;

conservative normalized card-name equality.

Set identity is supporting diagnostic evidence only. A mismatch or insufficient identity proof never exposes a renderable fallback URL.

CardImage.jsx centralizes source selection and failure transitions through useCardImage / CardImage. Two Preview-found protections are part of the final implementation:

R1: state is synchronously stamped with the current verification identity, preventing a prior card's verified fallback from rendering during an identity change;

R2: rendered <img> elements use a phase/source-specific renderKey, so a permitted retry is a genuine new browser image attempt even when the literal retry URL is unchanged.

Fallback verdict cache:

prefix: pb_img2_;

verified: 30-day TTL;

absent / mismatch: 72-hour TTL;

errors are never persisted;

60-second memory-only error cooldown prevents API retry storms;

concurrent requests deduplicate by the verification fingerprint;

Settings cache clearing removes current pb_img2_ and legacy pb_fallback_img_ entries.

Limitless image guessing remains exported but is runtime-dead. No OL-2C.1 surface renders a Limitless proxy.

Surface coverage includes Dashboard image surfaces, Artist Page, Binder, CardModal, Hunt Board / Hunt Show, Planned Binder search, Artist Directory, Owned Library, and SharedBinder through CardTile.

Editorial/decorative candidate selection remains intentionally primary-image-gated for the Dashboard feature/queue, Artist hero collage, and Artist Directory preview. OL-2C.1 hardens selected candidates; it does not add asynchronous fallback-aware candidate selection.

Preview validation included:

organic audit: 256 rows / 191 unique cards;

explicit follow-up coverage for Owned Library, Hunt Show, Artist Directory, and SharedBinder;

live 404 and 500 Pokémon TCG API behavior;

dead-primary → retry-success browser test;

identical dead-primary URL twice → verified-fallback browser test;

verification-mismatch → unavailable fail-closed test;

live R2 proof that the browser issued two separate same-URL failed attempts before advancing to the verified fallback.

Temporary Preview instrumentation and fixtures were removed before production. The clean Preview returned undefined for all audit globals.

Production validation:

merged to main;

Vercel production deployment passed;

illustratedvault.com smoke test passed;

production audit globals remain undefined.

Closeout:

/docs/OL-2C.1_CLOSEOUT.md

CAT-0 — Catalog Source & Coverage Audit — complete

Status: ✓ Complete 2026-07-27 (diagnostic only)Production changes: none. Read-only throughout. No SQL objects, schema, code, or data modified.

Full documents:

/docs/CAT-0_CATALOG_SOURCE_AND_COVERAGE_AUDIT.md — architecture & audit plan

/docs/CAT-0_FINDINGS_AND_DECISION.md — findings & decision

/docs/cat-0-evidence/ — coverage summary CSV, identity-conflicts CSV, manifest

Verdict

No P0 catalog identity defect was found.

Canonical identity is clean and structurally protected:

zero null canonical IDs;

zero duplicate canonical IDs;

zero duplicate (set_id, local_id) printing identities;

zero orphan card_extras rows;

zero orphan artist FKs;

zero wrong artist FKs.

The catalog's defects are coverage and derivation defects, not identity defects.

Catalog baseline (pinned 2026-07-27 13:55:39+00)

cards                 23,780
cards_effective       23,780   (distinct ids 23,780; null ids 0)
card_extras                5
artists                   22

Supersedes the 23,314 (OL-0C) and 23,604 (OL-2B) baselines as the current catalog size.

cards_effective contract (confirmed, not inferred)

Normal view — not materialized:

SELECT c.id, c.name, c.set_id, c.set_name, c.local_id,
       COALESCE(ce.illustrator_override, c.illustrator) AS illustrator,
       c.image_url, c.rarity, c.release_date, c.pricing,
       c.pricing_updated_at, c.pricing_source, c.last_synced_at, c.artist_id
FROM cards c
LEFT JOIN card_extras ce ON c.id = ce.card_id;

Confirmed properties:

base authority is cards;

card_extras overrides illustrator only — it has no artist_id column;

artist_id always comes directly from cards.artist_id and is not derived from the effective illustrator;

no WHERE clause; card_extras.card_id is PK and FK → cards(id) ON DELETE CASCADE;

the join cannot fan out, and cards → cards_effective row loss is structurally impossible;

the view exposes 14 columns and does not expose series.

illustrator_directory is a normal view over cards_effective using max(artist_id) GROUP BY illustrator.

Headline coverage measurements

Metric

Global

Owned (active snapshot)

Total cards

23,780

4,776

image_url missing

1,640 (6.90%)

114 (2.39%)

illustrator missing

2,009 (8.45%)

409 (8.56%)

local_id / set_id / set_name / name missing

0

—

Matcher-unreachable rows

0

—

Owned totals reconcile exactly to the authoritative ownership baseline.

Coverage is strongly set-clustered: 51 sets are 100% image-missing and account for 1,370 of the 1,640 gaps. This clustering is consistent with structural upstream absence but that has not been proven.

The nine historical illustrator-backfill-target sets (swsh9, swsh10, swsh10.5, swsh11, swsh12, swsh12.5, mee, ru1, sve) contain 1,320 cards, all currently cards.illustrator IS NULL. This is the known historical backfill-target population; the current upstream cause has not been revalidated, and the historical backfill's production execution/persistence cannot be reconstructed from available evidence. The non-null values previously visible in cards_effective for swsh11 / swsh12 / swsh12.5 are fully explained by the 5 card_extras overrides.

This supersedes the earlier "~1,400 cards across six SWSH-era set ranges" estimate.

F-13 — Global temporal metadata gap — RESOLVED by CAT-1 (2026-07-28)

Resolved. series and release_date are now populated on 23,780 / 23,780 cards; release_date_null: 0, series_null: 0, empty_series: 0, distinct_series: 21. See ## CAT-1 — Temporal Metadata Restoration — complete below and /docs/CAT-1_TEMPORAL_METADATA_RESTORATION_CLOSEOUT.md.

The original CAT-0 finding is retained below as the diagnostic record.

series and release_date were null for 23,780 / 23,780 cards.

Confirmed cause: TCGdex types the Card object's set property as a SetBrief, which carries cardCount, id, logo, name, symbol only. serie and releaseDate exist solely on the full Set object from GET /v2/en/sets/{id}.

sync-cards.mjs :: mapCardToRow reads card.set?.serie?.name and card.set?.releaseDate from the per-card response, so both resolve to undefined on every card. set_name is 100% complete because name is on the SetBrief — which isolates the defect to exactly those two fields.

syncSet already fetches the full set detail containing both values and uses only .cards.

Consequence recorded: cardService ordered release_date ASC NULLS LAST → set_id → local_id, so the primary sort key was inert. CAT-1 removed that ordering key before any temporal write, leaving set_id → local_id — a deterministic total order, since CAT-0 established zero duplicate (set_id, local_id) groups. The rendered sequence is unchanged. All intentional ordering work is deferred to SORT-1.

Artist identity findings

Confirmed mechanism: when a new artist identity is created after matching catalog cards have already been ingested, those existing rows do not retroactively receive the new artist_id. They remain stale until subsequently re-synced.

Evidence: Midori Harada (identity created 2026-07-03) — 378 cards synced before creation are FK-null, 1 synced after is correct. Suwama Chiaki (created 2026-07-10) — all 121 cards synced before creation, all FK-null.

Known-identity stale FKs: 499 missing, 0 wrong.

Product impact today: zero. Only Suwama Chiaki is currently tracked (tier secondary), and all 121 cards are recovered through the dynamic exact-illustrator retrieval path. Noted as fragile rather than designed: curated entries carrying an artistId use FK-only retrieval.

Also measured: zero illustrator strings map to more than one distinct non-null artist_id; zero aliases are claimed by multiple artist rows. Unicode/whitespace normalization fragility is confirmed but small — 12 cards across 3 raw strings, with no demonstrated current artist-first loss.

Interpretation note: illustrator IS NOT NULL AND artist_id IS NULL (18,183 rows) is not a defect metric. With only 22 artist identities against thousands of illustrator strings, that is the expected value.

card_extras current state

All 5 rows inspected. All 5 base illustrators are null; all 5 overrides change the effective illustrator. Two carry artist_id = null for identities absent from the artists table. No contradictory override/FK pair exists.

See the CAT-0 flag under Gate 3 regarding the three historical "card_extras FK fixes".

Structural notes carried forward

Secondary illustrator enrichment written to cards is not durable: the sync performs full-row upserts and rewrites cards.illustrator from the current TCGdex value. card_extras is the only durable enrichment channel today. series and release_date are the sole exception since CAT-1 — they left the upsert payload entirely (G1) and are written only by updateSetTemporal (G2).

Incremental sync skips any set where storedCount >= briefCards.length && briefCards.length > 0, so a completed set is not re-read. Two confirmed classes are therefore never skipped and are processed on every incremental run: (a) a set that permanently stores fewer cards than upstream lists — the exu instance, 27 stored against 28 upstream; and (b) an upstream zero-card set, which cannot satisfy the trailing briefCards.length > 0 clause — confirmed for jumbo, rc, sp and wp. Both are the deferred F-6 skip-predicate issue with evidence now attached. See Known limitations.

Sync invocation is GitHub Actions: .github/workflows/sync-cards.yml, workflow name Sync Card Catalog, running npm run sync from sync/ on ubuntu-latest with Node 24. It fires automatically every Monday 06:00 UTC (always incremental, always unscoped) and manually via workflow_dispatch with a sync_mode choice (incremental | full | temporal) and an optional set_id single-set temporal scope. Any procedure requiring a quiesced sync must account for the Monday window.

No delete pass exists.

No provenance column exists for illustrator or image.

pricing_updated_at measures sync recency, not price freshness.

Duplicated non-unique indexes exist on cards (illustrator, pokemon_dex_ids, rarity, set_id) — P3 hygiene, no action.

CAT-0 artifact status

The read-only query outputs recorded in /docs/CAT-0_FINDINGS_AND_DECISION.md are the audit evidence; no finding depends on a CSV artifact. Materialized: catalog_coverage_summary.csv, catalog_coverage_by_set.csv (complete 214-set enumeration), identity_conflicts.csv (intentionally zero rows), manifest.json. Not materialized: illustrator_gaps.csv and image_gaps.csv — both genuinely require per-card evidence and probes that were not produced. Neither is a deferred deliverable; CAT-0's conclusions stand without them.

CAT-1 — Temporal Metadata Restoration — complete

Status: ✓ CAT-1 complete 2026-07-28. F-13 resolved.Production changes: two catalog columns populated. No schema change. No ownership, matcher, artist, image or pricing behavior changed. Presentation behavior preserved.Full document: /docs/CAT-1_TEMPORAL_METADATA_RESTORATION_CLOSEOUT.md

series and release_date were null on 23,780 / 23,780 cards because mapCardToRow read them from card.set, which TCGdex types as a SetBrief carrying neither field. Both are now populated on 23,780 / 23,780 cards.

Architecture as shipped

G1 — mapCardToRow no longer emits series or release_date. Since upsertRows issues INSERT … ON CONFLICT (id) DO UPDATE SET <payload columns>, and neither column appears there, the routine card-write path is structurally incapable of writing or nulling them.

G2 — updateSetTemporal(setDetail) is the sole writer of either column: at most two columns, scoped by set_id, built only from non-null upstream values, no write at all when both are absent. It never writes last_synced_at or any other column.

C3 — presentation behavior preserved. cardService.js no longer orders the artist path by release_date, leaving set_id → local_id. Shipped before any temporal write, so no window existed in which a live release_date could influence ordering. The rendered sequence is unchanged across Binder, SharedBinder, ArtistPage, grouped views, Hunt Board, CSV export and the Dashboard Vault Feature / Vault Queue candidate identity. ARTIST_SELECT unchanged; pb9_supa_ cache key not bumped.

Modes — SYNC_MODE is validated against {incremental, temporal, full}; an unrecognized value refuses to run rather than falling through to the full path. SYNC_SET_ID optionally scopes a temporal run to exactly one set by exact ID equality, and is refused with any non-temporal mode.

Failure visibility — in temporal mode every per-set exception is recorded as a failed set and any failure exits non-zero, so a partial restoration cannot appear green in GitHub Actions.

Reconciliation model — missing upstream releaseDate and missing upstream serie.name are tracked independently; a set written with only one key is a successful write that still leaves the other column NULL. Reconciliation guidance printed by the run is mode- and scope-aware: only an unscoped temporal run makes a whole-catalog claim.

Files changed: sync/sync-cards.mjs, src/services/cardService.js, .github/workflows/sync-cards.yml. No schema change, no new dependency, no App.jsx / sort.js / setOrder.js change.

Production results

Stage

Result

Pre-restoration baseline

23,780 cards · 214 distinct sets · 23,780 nulls in both columns · card_extras 5 · checksum dea458d003ff71a451079c0ed66a01fd

Scoped proof (swsh3)

201/201 cards → 2020-08-14 / Sword & Shield; nothing changed outside the set; last_synced_at and pricing_updated_at unchanged; checksum byte-identical

Whole-catalog restoration

218 upstream sets inspected · 218 succeeded · 0 failed · 0 missing releaseDate · 0 missing serie.name · 0 card upserts

Post-restoration

release_date_present 23,780 · series_present 23,780 · nulls 0 · empty_series 0 · distinct_series 21 · last_synced_at and pricing_updated_at unchanged · checksum still dea458d003ff71a451079c0ed66a01fd

Routine incremental

27 cards upserted, all from exu · five sets (exu, jumbo, rc, sp, wp) reached the post-upsert temporal helper · 0 temporal failures · 0 temporal nulls afterward · exu's 27 stored cards all retain 2005-08-22 / EX

Representative values: base1 → 1999-01-09 / Base · swsh3 → 2020-08-14 / Sword & Shield · sv01 → 2023-03-31 / Scarlet & Violet.

Reconciliation: zero sets were missing either upstream field and zero failed, so both missing-field lists and the failed list were empty and the per-column rule is satisfied exactly.

Post-incremental checksum is 71b2cf06db50cf2f29a53e0ea30f4600. This is expected: a normal card upsert legitimately rewrites non-temporal fields including last_synced_at on 27 cards. Do not compare it to the pre-restoration checksum as a temporal-write control — the control is the scoped/whole-catalog comparison, both of which performed zero card upserts.

Set reconciliation, exact: the complete 214-set CAT-0 inventory is a subset of the 218 sets processed by CAT-1, and zero catalog set IDs were absent from the 218-set upstream run — every set holding rows was covered. The four upstream set IDs with no rows in public.cards are exactly jumbo, rc, sp, wp; their UPDATE matched zero rows. Benign, idempotent, and complete coverage.

G1 empirical-proof status

G1 structural invariant — ✓ passed (AST-asserted, not grep).

Production temporal write boundary — ✓ passed by byte-identical checksum.

Natural routine path — ✓ completed; the post-upsert temporal helper was invoked for five sets and affected stored rows for exu, closing the Phase 11 deferred-observation risk.

Isolated non-production G1 proof — ⏸ deferred observation. Not run: no non-production Supabase environment was available. No isolated production card mutation was manufactured, and none should be — mapCardToRow still rewrites illustrator, artist_id, pricing, rarity, image_url, set_name and last_synced_at.

The routine-path result is composite evidence, not isolation: updateSetTemporal runs immediately after upsertRows, so an R8 failure (PostgREST nulling omitted columns on conflict) would be repaired within the same run and never surface. Under the currently observed upstream state — where every processed set supplied both temporal fields — an R8 failure would be repaired immediately by G2. A future upstream field retraction remains the explicit unresolved case. Not a CAT-1 blocker.

Guardrails held

SYNC_MODE=full never used and still prohibited as a CAT-1 mechanism · F-19 artist FKs not repaired · F-6 skip predicate not redesigned · no schema/RPC/RLS/view change · no rows deleted or altered to force a non-skipped path.

Current ownership boundary / roadmap

Confirmed current split:

Owned Library — OL-0D active-snapshot read model; trusted enumeration and quantity surface.

Authenticated collection surfaces — strict active-snapshot canonical IDs plus exact manual overrides through one centralized App seam.

SharedBinder — separate share-token loose owned_keys boundary; known and intentionally deferred.

External-set cards — none render today; future set-path cards are override-only until a separately validated canonical mapping exists.

Recommended next slice:

Settled. The "deliberately open" state recorded after CAT-1 is closed. The agreed near-term sequence is CAT-2 (Catalog Trust & Visual Completeness) → NAV-1 (Product Architecture & Durable Navigation) → SEC-0 (User Data & Application Security Audit) → AUTH-1 (Persistent Sign-In & Session Reliability) → BETA-0 (Small Collector Beta). Binder Page Planning BP-3.1D+ is paused, not abandoned. SORT-1 remains a backlog candidate and is not in the near-term sequence. See ROADMAP.md.

Historical note — CAT-1 was selected as the slice following CAT-0 because the root cause was fully confirmed, the same TCGdex source was already fetched, the database columns already existed, there were no ownership or printing-identity implications, and the defect was narrow and deterministic.

Binding guardrail that governed CAT-1, retained as precedent. The sync path performs full-row card upserts and can rewrite unrelated fields including illustrator, artist_id, pricing, rarity, image_url and set_name. CAT-1 preserved every unrelated catalog field, proven by a whole-row to_jsonb(c) - 'series' - 'release_date' checksum that stayed byte-identical across the restoration. Any future catalog slice must preserve unrelated fields unless broader refresh behavior is separately inspected and approved.

Deferred by CAT-0: Pokémon TCG API fallback Probe B · image remediation · illustrator enrichment · artist FK repair · OL-0D p_artist_id filter semantics (latent; no user-facing Owned Library artist-filter workflow established) · add_artist_to_archive duplicate-identity risk · index hygiene · pricing.

Roadmap after CAT-1 — superseded as sequencing. The evidence-backed illustrator slice and OWN-1 (Artwork vs Printing ownership policy) remain valid work items and their preconditions are unchanged, but they are no longer the stated next sequence. Catalog trust and image completeness are now carried by CAT-2. See ROADMAP.md for the current order.

evidence-backed illustrator slice (pending revalidated upstream cause and governance) → OWN-1 Artwork vs Printing ownership policy

Locked ownership principles:

physical-printing ownership, artwork identity, and future artwork-goal satisfaction are separate concepts;

owning one language or printing never implies owning another;

false-positive physical ownership is more harmful than a temporary false negative;

artwork-level goal satisfaction, if introduced later, is policy — not ownership.

Completion tracking

Authenticated completion counts flow through the centralized strict App checkOwned closure:

Artist hero shows owned/total percentage; Dashboard shows artist progress rows.

Binder, Hunt surfaces, Artist Directory, CardModal, and Planned Binder consume the same strict canonical ownership verdict.

Counts derive from visibleCardData, so hiding TCG Pocket affects totals.

Exact force-missing overrides precede force-owned overrides, which precede active-snapshot canonical membership.

Loose owned_keys collisions no longer inflate authenticated counts.

Owned Library counts remain separate and snapshot-authoritative through OL-0D.

SharedBinder remains intentionally separate on its share-token legacy path.

WF-1 — development and knowledge workflow — complete

The working model is settled as of 2026-08-13. It is recorded here because it governs where authority lives, not merely how work is done.

Implementation authority:

The public GitHub repository is the canonical implementation source of truth. Production behavior and the canonical docs in this repository decide what is true; nothing outside it does.

The canonical local full clone is C:\dev\illustrated-vault. It is a complete working tree, not a partial export.

Roles:

Claude Code is the primary implementation agent, operating under AGENTS.md and CLAUDE.md.

ChatGPT is the strategy, architecture, and independent PR review layer.

Delivery loop:

feature branch → build/test → pull request → review → merge. Every implementation slice reaches GitHub as a PR before main; the PR is the review boundary between implementation and production.

Knowledge layer:

The private illustrated-vault-notes repository, worked through Obsidian, is the exploratory knowledge layer: product thinking, research, audits, UX observations, and future ideas.

It is explicitly not implementation authority. It may contain incomplete, exploratory, or incorrect thinking by design.

Promotion rule: observation → evidence → decision → canonical repo documentation → implementation. An idea does not acquire authority by being written down in the vault; it acquires authority by being promoted into this repository's canonical documentation as an approved decision.

The permanent agent contract lives in AGENTS.md (repository-wide) and CLAUDE.md (Claude Code workflow). This section records the workflow's authority boundaries only and deliberately does not duplicate their instructions.

Current repo structure — main branch

src/
  App.jsx              — main React component tree; large single file remains intentional
  main.jsx             — entry point; ErrorBoundary + ?share= routing
  assets/logo.webp
  components/          — CardImage.jsx (shared exact-printing image resilience seam)
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
docs/                  — this documentation set + archive/ + sql/ + cat-0-evidence/
scripts/               — OL-0A audit, OL-0A2 simulation, OL-0C/OL-0D validation
sync/                  — data sync / backfill scripts
.github/workflows/build-check-gate2.yml — manual-only build smoke test
index.html             — minimal Vite shell

src/App.jsx contains the existing product surfaces, including Dashboard, Artist Page, Binder, SharedBinder, Hunt Board, Artist Directory, Planned Binder index/detail, CardModal, Settings, and the top-level App shell.

Do not split App.jsx unless explicitly approved.

Supabase objects

Tables/views in use:

catalog/data: cards, card_extras, cards_effective, artists, illustrator_directory

user archive/planning: user_tracked_artists, user_collection, card_overrides, card_favorites, user_card_intent

planned binders: user_binders, user_binder_cards

binder page layout: user_binder_layouts, user_binder_layout_items

import snapshots: user_import_batches, user_import_rows

pricing/history: price_history

RPCs in use:

get_shared_collection

add_artist_to_archive

activate_import_batch

fail_import_batch

get_active_import_snapshot_read_model

get_active_snapshot_owned_card_ids

reorder_binder_cards

fetch_binder_page_layout

create_binder_page_layout

Installed but with no frontend seam today (BP-3.1D+ paused): save_binder_page_layout, set_binder_layout_theme, reset_binder_page_layout, and the private iv_binder_layout_document.

Known limitations / open items

Binder Page Planning stops at first-use setup. A layout can be created but not yet arranged, re-themed, or reset from the app. The corresponding RPCs exist in the database and are intentionally unreachable from the frontend until BP-3.1D resumes. Do not add a write seam to binderLayoutService.js outside an approved slice.

SharedBinder remains on its separate loose share-token owned_keys path. This divergence is known and intentionally out of OWN-0B; any future share cutover requires its own authority and compatibility design.

The 17 noncanonical legacy override rows remain stored but inert. Do not delete, rewrite, or remap them without evidence-backed namespace and identity work.

No external-set / Pokémon GO path renders today. If one is reintroduced, its default ownership is override-only; do not infer snapshot ownership without a separately validated canonical mapping.

OL-2C.1 image resilience is complete. Runtime card-image failures now retry once, use only verified exact-printing Pokémon TCG API fallbacks, then fail closed to a neutral unavailable state. Limitless/proxy imagery remains disabled.

CAT-1 is complete: series and release_date are populated on 23,780 / 23,780 cards, and the routine card-write path can no longer express either column. SYNC_MODE=temporal remains available as an explicit reconciliation tool, scoped or unscoped. Routine non-skipped syncs write temporal metadata after a successful card upsert. SYNC_MODE=full remains prohibited as a CAT-1 mechanism.

exu-%3F TCGdex 404 (open, unrepaired). The incremental run attempted 28 exu cards; the ID exu-%3F — a URL-encoded ? — returned 404 and 27 were upserted. Recorded as a catalog-source / card-ID anomaly; deliberately not repaired inside CAT-1.

exu is permanently non-skipped — stored count below upstream count. It stores 27 cards while upstream lists 28, so storedCount >= briefCards.length is 27 >= 28, false, forever: every weekly run re-fetches all 28 card details, hits the same 404, and re-upserts 27 rows. Cost is a small permanent weekly re-sync with last_synced_at churn; the incidental benefit is that the post-upsert temporal path is exercised weekly. Deferred F-6 skip-predicate issue, first confirmed case.

jumbo, rc, sp and wp are permanently non-skipped — upstream zero-card sets. The skip predicate requires briefCards.length > 0, which a zero-card set can never satisfy, so these four are processed on every incremental run. The production incremental log showed this directly: Syncing wp — 0 cards, Syncing jumbo — 0 cards, Syncing sp — 0 cards, Syncing rc — 0 cards. They hold no rows in public.cards, so their upserts and temporal updates alike match zero rows. Deferred F-6 skip-predicate issue, second confirmed case — a distinct mechanism from exu's.

Isolated non-production G1 proof remains a deferred observation. The structural invariant passed and the production write boundary passed by checksum, but the isolated one-card upsert proof was never run for lack of a non-production Supabase environment. Do not manufacture it in production: mapCardToRow still rewrites illustrator, artist_id, pricing, rarity, image_url, set_name and last_synced_at. The routine path cannot isolate G1, because updateSetTemporal repairs any such regression within the same run. Under the currently observed upstream state — where every processed set supplied both temporal fields — an R8 failure would be repaired immediately by G2; a future upstream field retraction remains the explicit unresolved case.

The whole-catalog temporal run processed 218 upstream sets against 214 distinct catalog set_id values. These reconcile exactly: the complete 214-set CAT-0 inventory is a subset of the 218, and zero catalog set IDs were absent from the upstream run. The four upstream set IDs with no rows in public.cards are exactly jumbo, rc, sp, wp — the same four zero-card sets noted above. Their UPDATE matched zero rows: benign, idempotent, complete coverage. Whether those sets should hold rows is a coverage question, not a CAT-1 one.

CAT-0 is complete and found no P0 catalog identity defect. Remaining catalog work is coverage and derivation, not identity. Exact-image coverage is measured (1,640 global / 114 owned) and deferred; broad image remediation is not currently justified.

The OL-0C catalog index is loaded client-side in stable pages during signed-in CSV import. The loader is isolated so a future server-side resolver can replace it without changing the matcher.

Null-illustrator remediation remains a data-quality follow-up: 2,009 cards globally, 409 in the active owned snapshot, of which 1,320 sit in the nine known historical backfill-target sets. The current upstream cause has not been revalidated, and the historical backfill's production execution/persistence cannot be reconstructed from available evidence. Do not bulk-enrich without revalidated source evidence and OL-2B-grade governance.

Artist FK staleness: 499 known-identity cards carry a missing artist_id and 0 carry a wrong one. Cause confirmed (FK is derived at card-sync time and is not retroactive). Current product impact is zero because the affected tracked artist resolves through the dynamic exact-illustrator path. Deferred.

Saya Tsuruta alias (full-width space variant): CAT-0 measured the stronger Unicode/whitespace population at 12 cards across 3 raw illustrator strings, with 0 unresolved cards for both returned Saya variants. Confirmed normalization fragility with no demonstrated current artist-first loss. Alias resolution in sync-cards.mjs uses .trim().toLowerCase() with no NFKC folding.

Pricing features deferred: confidence labels, staleness display, Cardmarket link button, price alerts. CAT-0 additionally observed 3,883 cards with null pricing and a stale variant-key comment in sync-cards.mjs relative to current TCGdex documentation — both out of scope until a dedicated pricing slice.

Hunt Board back button always returns to Dashboard, even when entered from the Binder header.

