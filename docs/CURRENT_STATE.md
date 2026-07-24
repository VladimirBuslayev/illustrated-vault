Illustrated Vault — Current State

Last updated: 2026-07-24

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

Full Gate 2 phase history (5A–5O) lives in CHANGELOG.md. No Gate 2 rollback or deferred cleanup remains.

Gate 3 data foundation — complete

artists table exists and is well-formed (with alias arrays).

cards_effective view exposes artist_id.

Frontend artist queries use the FK-based artist_id path (.eq('artist_id', ...)), with the old ILIKE path retained only as a fallback for entries without an artistId. Gate 3 bumped pb7_supa_ → pb8_supa_ to invalidate stale ILIKE caches; OWN-0B later bumped the live canonical-card cache to pb9_supa_ and the external-set cache to pb7_cards_ so every returned card carries an explicit ownership namespace.

The old sui ILIKE false-positive bug (substring match on "Misa Tsutsui") is fixed.

Tetsu Kayama alias/FK cleanup done.

Three card_extras seed FK fixes: swsh11-186 → shinji-kanda, swsh12.5-GG19 → asako-ito, swsh12.5-GG69 → akira-egawa.

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

Hero chip diet: Owned/Missing chips removed (they duplicated the progressline). Only Hunting / "On the list" chips remain, shown when non-zero, andthey are now tappable shortcuts that activate the Hunting segment (sameviewMode state as the sticky controls — no new state, intent read-only).

About + Notable Cards merged into one collapsible "FROM THE ARCHIVE" band(default open; local state only, not persisted; V-C.1 chevron pattern).Instructional copy ("Tap to inspect · owned cards glow") removed; ownedsignal quieted to accent ring + ✓ with neutral captions. No curation orreordering system.

Dynamic-artist fallback: artists with no story and no notable cards (alldynamic artists today) render a quiet one-line band — "One of youradditions · N cards in the archive." — instead of silently dropping theband, so added-artist pages keep the same skeleton as curated ones.

Hunting segment framing: a quiet summary line ("N active targets · M onthe list") renders between the controls and the grid, hidden whilesearching so counts never disagree with the filtered grid. The WANT grouplabel inside the segment is renamed ON THE LIST (Hunt Board vocabulary),and the empty state now reads "No hunt targets for this artist yet — marka missing card as Hunting and it will gather here." Both strings are onlyreachable from the Artist Page: Binder/SharedBinder never passviewMode="hunting".

Manage-in-mini-header for dynamic artists is deliberately NOT in thisslice — deferred to Artist Page C2.

Explore Artists directory — A-D1 live

Read-only artists view entered via the "Explore Artists →" link on theDashboard artist section header; derived from in-memory state. Tapping anartist opens the existing Artist Page.

Tracked artists — A-D2a data foundation + A-D2b0 roster spine live

Permanent product rule: users can look at anything, but can act only onwhat's in their archive.

A-D2a (SQL, complete):

artists formalized as global artist identity (currently 20 rows).

user_tracked_artists (RLS: user_id = auth.uid()) is the per-user archive roster.

illustrator_directory is the discovery source (illustrator + card count).

add_artist_to_archive(p_illustrator text) RPC is the single Add-to-Archive write path.

Only the owner account was seeded with the 20 current artists. Not auniversal default; new users are not auto-seeded.

A-D2b0 (app, complete):

src/services/artistService.js reads user_tracked_artists and resolvesidentities from artists. Every function soft-fails to empty.

App.jsx builds effectiveRoster = curated ARTISTS + dynamic additions.Curated ARTISTS remain the unconditional safety floor — any fetch failurerenders curated-only, identical to pre-B0 behavior.

Dynamic additions appear under "YOUR ADDITIONS" (Dashboard, ExploreArtists, Binder artist dropdown) only when non-empty.

Dynamic card fetch (cardService.js) uses exact artist_id equality ORexact illustrator equality — never substring ILIKE.

SharedBinder and ArtistPicker remain curated-only.

A-D2c-lite (app, complete):

Find Illustrator search lives inside Explore Artists, queryingillustrator_directory via searchIllustratorDirectory.

Add to Archive calls addArtistToArchive (add_artist_to_archive RPC).Added artists appear under "YOUR ADDITIONS" once onArtistAdded triggersa tracked-id refetch.

SQL hotfix (committed): add_artist_to_archive now inserts display_namewhen creating a new artists row. This fixed Add to Archive forillustrators without an existing identity row (e.g. Midori Harada), whichpreviously failed the insert.

No untracked Artist Page yet.

A-D2d (SQL + app, complete):

user_tracked_artists gained a tier text NOT NULL DEFAULT 'added'column (CHECK restricts it to main / secondary / added) and a newuta_update_own RLS UPDATE policy. Scope is inherently dynamic-only:curated ARTISTS entries are never rows in this table.

artistService.js gained fetchTrackedArtistTiers (new, alongside theunchanged fetchTrackedArtistIds), updateArtistTier, andremoveArtistFromArchive. The latter two are plain RLS-guarded tablewrites, not RPCs — neither needs catalog validation or touches globalartist identity.

Dynamic artists in effectiveRoster now carry their real per-user tierinstead of a hardcoded "added". Dashboard and ArtistDirectory'sexisting tier-based section splits required no changes.

Explore Artists: a "⋯" Manage control on dynamic artist tiles only offerstier reassignment (Main Artists / Secondary & Special / Your Additions)and Remove from Archive (window.confirm-gated). Curated tiles arevisually and functionally untouched.

Removing an artist deletes only the caller's own user_tracked_artistsrow — never global artist identity, cards, overrides, favorites, huntintent, or manual owned/missing state.

Binder artist-filter dropdown: dynamic artists now fold into the matchingMain/Secondary optgroup by tier; "Your additions" remains for artistsstill at the added default.

Planned Binders — BP-0A/B complete

Planned Binders are intentional collection-building lists, distinct from theartist-focused archive, complete Owned Library, and active Hunt Board.

Supabase tables: user_binders and user_binder_cards, with per-user RLS.

Users can create, rename, describe, and delete planned binders.

Binder plans support global catalog search, add/remove, duplicate prevention,and Supabase persistence.

Authenticated strict ownership is reused live: canonical plan cards resolve throughcards_effective / supaRowToCard, owned cards render normally, and plannedbut unowned cards render dimmed.

Planned binder cards open the existing CardModal.

This is still a list-based planning surface, not a 9-pocket physical pageplanner. Page layout, slot positions, and physical storage modeling remaindeferred.

SharedBinder — read-only share surface

Never exposes Hunt status, editable controls, or private user info.

Missing-card CSV export is live: Missing CSV button; exports only missing cards from the shared view; respects shared artist selection and viewer artist dropdown; intentionally ignores the search box; excludes TCG Pocket via visibleCardData; client-side generation with UTF-8 BOM; no Supabase writes; no intent/favorites/private columns.

Visual polish

V-A Quiet Pass applied: logo glow reduced, flame/button styling calmed, Dashboard hero de-gradiented, footer artist-name text removed, stale comments cleaned, and an incident where CSS was accidentally pasted into index.html was fixed. index.html must remain a minimal Vite shell (root div + /src/main.jsx script). Do not reintroduce loud fire/game UI.

Brand V-B applied: final logo asset (/illustrated-logo-gradient.svg) wired into BlazLogo (component name kept to avoid touching its 11 call sites), logo sizing reduced across call sites, and the Dashboard hero no longer uses the large brand mark.

Dashboard / Brand Copy V-C applied: the Dashboard hero is now the VaultFeature — an editorial split panel that features one card from the user'sown collection data. Selection ladder: hunting intent → want intent →unowned favorite → nearest-incomplete artist ("Artist Focus") → quiet emptystate pointing at Explore Artists. Selection is deterministic (roster order,then existing cardData order), price-blind, rotation-free, and read-only overintent/favorites/ownership; owned cards and imageless cards are skipped atselection time. The old stat block is demoted to a quiet single row under thefeature, and the rainbow progress bar is calmed to a two-stop amber→plumgradient. Dashboard now receives intentMap (read-only). Copy pass in thesame slice: email removed as Dashboard identity (static "YOUR VAULT" eyebrow;email remains only in the landing sign-out row / account context), "The artis the point." replaced by a single landing placement of "For collectors whofollow the art." (no Dashboard tagline), "ENTER BINDER" → "Enter the Vault"(landing button only — no route/component rename), "Send Magic Link 🔥" →"Send sign-in link", "No password. One click and you're in." → "No password —a link arrives in your email.", and the Most Wanted all-owned state → "Everycard on your list is home." in quiet neutral styling. index.css untouched.

Dashboard V-C.1 polish applied: (1) Vault Queue — the Vault Featureladder now collects up to 4 candidates (same hunting → want → favoritepriority, same roster/cardData order; candidate 0 is identical to the oldsingle pick). The hero's right side shows the other 2–3 candidates astappable "UP NEXT" thumbs; tapping swaps the featured card for the currentsession only (plain useState, no persistence, no schema, no localStorage).With no alternates, a quiet "IN YOUR VAULT" artist-progress note fills thespace instead of placeholders. (2) Header logo mark reduced 22 → 18 in theDashboard and Binder headers (SharedBinder untouched). (3) Most Wantedexpand/collapse labels are now "Show all N →" / "Collapse ▲" (sameshow-3-by-default logic). (4) Main Artists and Secondary & Special sectionheaders are collapse toggles (chevron + count when collapsed; Main defaultsopen, Secondary & Special defaults collapsed, Hunt Board precedent; localstate only). (5) A quiet full-width "Find an illustrator →" ghost row sitsafter the artist sections; the Main Artists header link remains. (6) Theheader "CSV" button is renamed "Import" and visually softened; placement andimport behavior are unchanged. index.css gained one clearly-marked V-C.1block (.vault-queue + one mobile media query) — its only change since theGate 2 verbatim copy. Ownership, intent, favorites, Hunt Board,SharedBinder, Artist Page, and A-D2c/A-D2d behavior untouched.

Owned Library and ownership truth

Owned Library is live as the complete imported physical-collection archive. Itremains distinct from:

Artist Binder: owned/missing cards across intentionally tracked artists.

Planned Binder: a collection the user is intentionally building.

Hunt Board: cards the user is actively trying to acquire.

The architecture deliberately separates:

user_collection.owned_keys — legacy, lossy recognition infrastructure;

active import snapshots — canonical physical-printing enumeration authority;

manualOwned / manualMissing — explicit per-card overrides.

Owned Library reads the active snapshot through OL-0D. Since OWN-0B, everyownership-dependent authenticated collection surface uses the same active-snapshotcanonical-ID authority through the centralized App checkOwned seam. The looseowned_keys predicate is no longer an authenticated ownership fallback; it remainslegacy recognition infrastructure and still powers the separate SharedBinder boundary.

OL-0A matching audit — complete

OL-0A ran against a real Collectr export and the completecards_effective catalog.

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

The audit confirmed that owned_keys should remain recognitioninfrastructure but cannot safely enumerate the complete physical collection.

Accepted local audit harness:

/scripts/ol0a-match-audit.mjs

OL-0A2 matcher refinement — complete

OL-0A2b reproduced the accepted baseline and approved a narrowsnapshot-import matcher policy:

preserve existing denominator normalization;

allow purely numeric leading-zero equivalence, such as 057 → 57;

preserve meaningful prefixes and suffixes such as TG, GG, SWSH,SM, and XY;

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

Deferred mappings remain excluded, including cross-language or cross-releasecorrespondences such as:

Ninja Spinner → Chaos Rising

Inferno X → Phantasmal Flames

Night Wanderer → Shrouded Fable

The aliases are scoped only to the snapshot importer. They are not globalnormalization rules and do not change owned_keys.

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

OL-0C is merged to main. A signed-in Collectr import now runs two deliberatelyseparate paths:

The existing owned_keys recognition import remains primary.

After the owned_keys write is confirmed successful, the app builds andpersists an immutable enumeration snapshot.

The paths are intentionally non-atomic:

saveCollection() is awaited and its returned error is explicitly checked;

snapshot creation is skipped if owned_keys persistence fails;

the user receives a visible warning that the CSV may appear only for thecurrent session when ownership persistence fails;

if ownership persistence succeeds but the snapshot fails, the user receivesan explicit partial-success warning;

fail_import_batch() never rolls back owned_keys;

the previous active snapshot remains active until the replacement batchactivates successfully.

OL-0C implementation:

src/constants/ol0aAllowlist.js — frozen 33-entry allowlist with integrityassertions.

src/services/snapshotMatcher.js — pure classifier and deterministicagreement resolution.

src/services/catalogIndexLoader.js — stable, paged cards_effectiveloading; completeness and duplicate-ID checks; fail-closed behavior.

src/services/importSnapshotService.js — processing batch, chunked immutablerow insertion, activation, and failure lifecycle.

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

full-catalog equivalence against 23,314 distinct catalog rows;

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

The child-row counts and stored match-rule totals reconciled exactly to thebatch header.

OL-0D active snapshot read model — complete

OL-0D establishes the authenticated read contract for the current activeimmutable import snapshot.

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

resolves the caller’s single active import batch;

aggregates immutable matched source rows by canonical card_id;

sums physical quantity across duplicate source rows;

retains deterministic fallback evidence from the lowest contributingsource_row_number;

summarizes unresolved rows by stored match_status and match_reason;

left-joins current cards_effective metadata;

retains matched cards whose catalog record later becomes unavailable;

defensively deduplicates catalog rows before joining;

supports server-side search, filtering, deterministic sorting, and offsetpagination;

fails closed when active-batch header reconciliation no longer matches theimmutable child rows.

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

The difference between matched source rows and distinct canonical cards confirmsthat duplicate source rows are aggregated rather than emitted as duplicatelibrary items.

OL-1 — Owned Library v0 UI — live

Owned Library is reachable from the Dashboard and uses the OL-0D read modeldirectly. Current behavior:

full-color grid of confidently matched owned cards;

server-backed search, sort, and catalog-status filtering;

page size 60 with Load 60 more;

showing-range and total-count disclosure;

matched / ambiguous / unmatched / invalid / catalog-missing diagnostics;

read-only CardModal inspection path;

mobile header, grid overflow, and search-focus issues corrected;

post-import refresh through importEpoch;

no merge of manual overrides into imported quantity.

Owned Library is the trusted owner-facing snapshot surface. It does not useowned_keys to decide whether a canonical printing is present.

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

recovered canonical IDs:2024sv-4, 2024sv-5, 2024sv-8, 2024sv-11,2024sv-12, 2024sv-14, 2024sv-15

OL-2B is complete and accepted. The McDonald's alias is approved, deployed,and must not be revisited without new evidence.

OWN-0A — Authoritative Snapshot Ownership Read — complete

OWN-0A is deployed and validated.

It added:

get_active_snapshot_owned_card_ids() — read-only, SECURITY DEFINER,auth.uid()-scoped, fail-closed on multiple active batches or header/rowmismatch;

strict fetchActiveSnapshotOwnedCardIds() service wrapper returning acanonical-ID Set;

App authority state, introduced dark in OWN-0A and consumed by OWN-0B:loading | ready | no_active_batch | multiple_active_batches | error;

refresh on sign-in and importEpoch;

request supersession, batch-bound wholesale replacement, and terminalinvalidation.

Production validation:

RPC state: ready

active batch: 1dd67dd6-15fb-4452-8edd-3626681e2a1d

owned ID length: 4,776

distinct matched IDs: 4,776

matched rows: 5,307

deployed OL-0D read-model count: 4,776

no users with multiple active batches

catalog available / missing: 4,776 / 0

query execution: approximately 7.6 ms; no sequential scan; no new indexjustified

Ownership-truth evidence:

Komiya Expedition Pidgeot ecard1-23 is absent from the active snapshot;

Komiya Expedition Pidgeot ecard1-59 is absent from the active snapshot;

Komiya positive control: 185 exact snapshot-owned cards.

OWN-0A did not change visible ownership on its own. OWN-0B now consumes the Setthrough the centralized authenticated ownership selector and authority gate. OwnedLibrary remains on its independent OL-0D snapshot read path.

Closeout:

/docs/OWN-0A_CLOSEOUT.md

OWN-0B — Authenticated Ownership Cutover — complete

OWN-0B is merged to main, deployed to production, and smoke-tested.

Production files changed:

src/App.jsx

src/services/cardAdapter.js

src/services/cardService.js

Effective authenticated ownership is now centralized:

canonical cards:force-missing → force-owned → active snapshot canonical ID → missing;

external-set or unknown cards:force-missing → force-owned → missing;

no authenticated owned_keys fallback.

The single authenticated App checkOwned closure uses the strict selector.SharedBinder keeps its separate share-token isCardOwned / owned_keys closureand remains explicitly out of this cutover.

Authority behavior:

ready — ownership-dependent authenticated surfaces render normally;

loading — those surfaces are gated; a retained prior Set is not shown;

no_active_batch — blocked import/onboarding state, not an all-missing collection;

error / multiple_active_batches — fail-closed retry states;

retry calls the authority read directly and does not misuse importEpoch;

the requested view, artistSlug, and planId remain preserved while gated.

Ownership namespace contract:

supaRowToCard marks canonical cards_effective cards withownershipNamespace: "canonical";

the currently unwired TCGdex set path marks cardsownershipNamespace: "external-set";

absent or unknown namespace fails conservatively to override-only / missing;

current canonical caches use pb9_supa_; external-set caches usepb7_cards_; cache-hit normalization prevents unmarked legacy objects fromescaping; Settings cache clearing removes both current and retained legacyprefixes.

Planned Binder verification confirmed both fetchCardsByIds andsearchCatalogCards query cards_effective, preserve canonical IDs, adapt throughsupaRowToCard, and use no card-object cache. No BinderPlan-specific ownershipstamp or binderService.js change was required.

Preview ownership-delta validation:

3,295 rendered canonical cards audited;

old loose-owned: 1,461;

new strict-owned: 1,344;

168 owned_keys false-positive verdicts removed;

51 snapshot true-positive verdicts added;

net visible change: −117 owned cards;

0 unexplained changes;

0 external-set cards rendered;

125 override-controlled rows remained verdict-stable(96 force-owned, 29 force-missing);

every snapshot-positive card not force-missing remained owned.

Komiya Expedition Pidgeot evidence after cutover:

ecard1-59 — absent from snapshot, no override, correctly missing;

ecard1-23 — absent from snapshot but intentionally remains owned because anexplicit force-owned override is present.

The 17 previously identified noncanonical override rows remain untouched andinert: none resolve to cards, cards_effective, the active snapshot, or acurrently rendered external-set card ID.

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

Set identity is supporting diagnostic evidence only. A mismatch or insufficientidentity proof never exposes a renderable fallback URL.

CardImage.jsx centralizes source selection and failure transitions throughuseCardImage / CardImage. Two Preview-found protections are part of the finalimplementation:

R1: state is synchronously stamped with the current verification identity,preventing a prior card's verified fallback from rendering during an identitychange;

R2: rendered <img> elements use a phase/source-specific renderKey, so apermitted retry is a genuine new browser image attempt even when the literalretry URL is unchanged.

Fallback verdict cache:

prefix: pb_img2_;

verified: 30-day TTL;

absent / mismatch: 72-hour TTL;

errors are never persisted;

60-second memory-only error cooldown prevents API retry storms;

concurrent requests deduplicate by the verification fingerprint;

Settings cache clearing removes current pb_img2_ and legacypb_fallback_img_ entries.

Limitless image guessing remains exported but is runtime-dead. No OL-2C.1surface renders a Limitless proxy.

Surface coverage includes Dashboard image surfaces, Artist Page, Binder,CardModal, Hunt Board / Hunt Show, Planned Binder search, Artist Directory,Owned Library, and SharedBinder through CardTile.

Editorial/decorative candidate selection remains intentionallyprimary-image-gated for the Dashboard feature/queue, Artist hero collage, andArtist Directory preview. OL-2C.1 hardens selected candidates; it does not addasynchronous fallback-aware candidate selection.

Preview validation included:

organic audit: 256 rows / 191 unique cards;

explicit follow-up coverage for Owned Library, Hunt Show, Artist Directory,and SharedBinder;

live 404 and 500 Pokémon TCG API behavior;

dead-primary → retry-success browser test;

identical dead-primary URL twice → verified-fallback browser test;

verification-mismatch → unavailable fail-closed test;

live R2 proof that the browser issued two separate same-URL failed attemptsbefore advancing to the verified fallback.

Temporary Preview instrumentation and fixtures were removed before production.The clean Preview returned undefined for all audit globals.

Production validation:

merged to main;

Vercel production deployment passed;

illustratedvault.com smoke test passed;

production audit globals remain undefined.

Closeout:

/docs/OL-2C.1_CLOSEOUT.md

Current ownership boundary / roadmap

Confirmed current split:

Owned Library — OL-0D active-snapshot read model; trusted enumeration andquantity surface.

Authenticated collection surfaces — strict active-snapshot canonical IDsplus exact manual overrides through one centralized App seam.

SharedBinder — separate share-token loose owned_keys boundary; known andintentionally deferred.

External-set cards — none render today; future set-path cards areoverride-only until a separately validated canonical mapping exists.

Recommended next slice:

CAT-0 Catalog Source & Coverage Audit

OWN-0B stabilizes authenticated ownership truth and OL-2C.1 now contains runtimeimage failure without substituting unverified printings. The next evidence questionis catalog/source coverage: where and why exact images or catalog fields are absent,stale, or inconsistent across sources.

CAT-0 must remain diagnostic rather than becoming a broad source migration orcatalog rewrite.

Roadmap after CAT-0:

next evidence-backed catalog slice → OWN-1 Artwork vs Printing ownership policy

Locked ownership principles:

physical-printing ownership, artwork identity, and future artwork-goalsatisfaction are separate concepts;

owning one language or printing never implies owning another;

false-positive physical ownership is more harmful than a temporary falsenegative;

artwork-level goal satisfaction, if introduced later, is policy—notownership.

Completion tracking

Authenticated completion counts flow through the centralized strict AppcheckOwned closure:

Artist hero shows owned/total percentage; Dashboard shows artist progress rows.

Binder, Hunt surfaces, Artist Directory, CardModal, and Planned Binder consumethe same strict canonical ownership verdict.

Counts derive from visibleCardData, so hiding TCG Pocket affects totals.

Exact force-missing overrides precede force-owned overrides, which precedeactive-snapshot canonical membership.

Loose owned_keys collisions no longer inflate authenticated counts.

Owned Library counts remain separate and snapshot-authoritative through OL-0D.

SharedBinder remains intentionally separate on its share-token legacy path.

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
docs/                  — this documentation set + archive/ + sql/
scripts/               — OL-0A audit, OL-0A2 simulation, OL-0C/OL-0D validation
sync/                  — data sync / backfill scripts
.github/workflows/build-check-gate2.yml — manual-only build smoke test
index.html             — minimal Vite shell

src/App.jsx contains the existing product surfaces, including Dashboard,Artist Page, Binder, SharedBinder, Hunt Board, Artist Directory, PlannedBinder index/detail, CardModal, Settings, and the top-level App shell.

Do not split App.jsx unless explicitly approved.

Supabase objects

Tables/views in use:

catalog/data: cards, card_extras, cards_effective, artists,illustrator_directory

user archive/planning: user_tracked_artists, user_collection,card_overrides, card_favorites, user_card_intent

planned binders: user_binders, user_binder_cards

import snapshots: user_import_batches, user_import_rows

pricing/history: price_history

RPCs in use:

get_shared_collection

add_artist_to_archive

activate_import_batch

fail_import_batch

get_active_import_snapshot_read_model

get_active_snapshot_owned_card_ids

Known limitations / open items

SharedBinder remains on its separate loose share-token owned_keys path.This divergence is known and intentionally out of OWN-0B; any future sharecutover requires its own authority and compatibility design.

The 17 noncanonical legacy override rows remain stored but inert. Do not delete,rewrite, or remap them without evidence-backed namespace and identity work.

No external-set / Pokémon GO path renders today. If one is reintroduced, itsdefault ownership is override-only; do not infer snapshot ownership without aseparately validated canonical mapping.

OL-2C.1 image resilience is complete. Runtime card-image failures now retryonce, use only verified exact-printing Pokémon TCG API fallbacks, then failclosed to a neutral unavailable state. Limitless/proxy imagery remains disabled.

Exact-image and catalog-source coverage remain data-quality questions for CAT-0;CAT-0 is a diagnostic catalog-source and coverage audit, not an implementationrewrite.

The OL-0C catalog index is loaded client-side in stable pages during signed-inCSV import. The loader is isolated so a future server-side resolver canreplace it without changing the matcher.

Null-illustrator bulk enrichment for the six affected SWSH-era set ranges(~1,400 cards; TCGdex structural data gap) remains a data-quality follow-up.

Saya Tsuruta alias (full-width space variant) remains unconfirmed.

Pricing features deferred: confidence labels, staleness display, Cardmarketlink button, price alerts.

Hunt Board back button always returns to Dashboard, even when entered fromthe Binder header.
