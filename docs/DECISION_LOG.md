# Illustrated Vault — Decision Log

---
## 2026-07-02 — A-D1: Explore Artists directory v0 (read-only)

Decision:

Ship the Artist Directory as a read-only "Explore Artists" view over the
current tracked roster: a new top-level `artists` view derived entirely from
in-memory state (`visibleCardData`, `checkOwned`, `ARTIST_META`), entered via
an "Explore Artists →" link on the Dashboard artist section header. Gallery
cards show name, tags, accent, a 3-card color preview strip, and owned/total
progress; tapping opens the existing Artist Page. No new Supabase reads, no
schema changes, no track/untrack.

Reason:

The directory → lens pattern (which Set Lens v0 will copy) can be established
with zero data-layer risk because everything needed is already loaded.
SQL confirmed `select count(*) from artists;` = 20 — the artists table is
effectively the curated/tracked roster, not a broader illustrator database.
Broader artist discovery and "add to archive" therefore require an A-D2
data-model decision (how untracked illustrators are represented and fetched)
and were deliberately excluded from this slice.

Status:

Accepted. Live in production and validated. A-D2 (tracked-artist selection /
untracked-artist read-only lens) is planned separately.

---
## 2026-07-02 — Roadmap sequencing after Hunt Board

Decision:

With Hunt Board H-1/H-2/H-3 complete and validated, the next slices are ordered:
Product Surface Map → Artist expansion / tracked artist management → Set Lens v0
→ Artist Page Slice C or Brand/Logo/Loading V-B (chosen by app feel at the time)
→ Pokémon Search / Lens v0 → Collection Goals / Custom Lists → Binder Planning v0
once the goal/list model is clearer.

Reason:

The Product Surface Map should precede new lens types so navigation is planned
rather than accreted. Set and Pokémon lenses build toward the collection-goals
abstraction incrementally. Binder Planning is deliberately last because it
depends on a clear goal/list model — starting a large Binder Composer early
risks overbuilding schema and UI.

Status:

Accepted. Guardrail — later slices are not pulled forward without an explicit decision.

---

## 2026-07-02 — Collection goals as the long-term organizing abstraction

Decision:

Illustrated Vault will eventually organize around "collection goals," where
Artist, Set, Pokémon, Custom List, and Binder Plan are different goal types,
each with its own progress, hunt targets, and showcase.

Reason:

The strongest product triangle is artist collecting + set completion +
Pokédex-style progression. A goal abstraction unifies these without rebuilding
each surface from scratch.

Constraint:

The abstraction must be earned gradually — each goal type ships as a focused,
opinionated experience. The app must not become a generic database/filter
tracker. Artist-first, premium, calm, visual, and intentional remains the
product identity.

Status:

Accepted as strategic direction. No schema or UI generalization work yet.

---

## 2026-07-02 — Hunt Board is derived state; MAYBE LATER collapsed by default

Decision:

The Hunt Board is derived entirely from in-memory state (`visibleCardData`,
`intentMap`, `checkOwned`) with no new Supabase calls. It groups by
hunting / want / maybe, then by artist in roster order, sorted by market price
descending with unpriced cards last. It shows only missing cards with intent,
suppresses owned cards with stale intent rows, suppresses `ignore`, and
deduplicates by card id. Sections are collapsible (H-2); ACTIVE TARGETS and
ON THE LIST default open; MAYBE LATER defaults collapsed when it has cards;
collapse state is local only and not persisted. Section headers received a
larger mobile tap target (H-3).

Reason:

Hunt planning must stay fast and cheap — one intent fetch per session, all
board logic client-side. Collapsing MAYBE LATER keeps the board focused on
actionable targets while keeping speculation discoverable via visible counts.
Local-only collapse avoids persisting trivial UI state.

Status:

Accepted. H-1/H-2/H-3 live in production.

---

## 2026-07-02 — Hunt intent model (want / hunting / maybe / ignore)

Decision:

Hunt intent lives in a dedicated Supabase table `user_card_intent` with
statuses `want`, `hunting`, `maybe`, `ignore`, accessed only through
`src/services/intentService.js`. Intent is planning metadata only:

- It never affects owned/missing state.
- It never affects completion counts (`ignore` included).
- Owned cards with stale intent rows are suppressed from hunt surfaces at
  render time; rows are not eagerly deleted.
- Intent is not exposed in SharedBinder v1.

Reason:

Ownership and completion are the app's ground truth and must stay independent
of planning signals. Render-time suppression avoids write amplification and
keeps intent history recoverable. The share surface stays read-only and
private-data-free.

Status:

Accepted. Live in production.

---

## 2026-07-02 — Favorites vs. intent disambiguation

Decision:

"Favorite" (★) is an emotional bookmark and can apply to any card. Intent
statuses are acquisition planning and apply meaningfully only to missing cards.
The Dashboard "Most Wanted" section remains favorites-driven and was not
migrated to intent.

Reason:

The two signals answer different questions — "cards I love" vs. "cards I am
actively planning to acquire." Merging them would overload one control and
muddy both meanings.

Status:

Accepted.

---

## 2026-07-02 — Gate 3: FK-based artist queries (artist_id) replace ILIKE

Decision:

`cardService.fetchArtistCards` queries `cards_effective` by
`.eq('artist_id', entry.artistId)` when an `artistId` is present. The ILIKE
alias path is retained only as a fallback for entries without an `artistId`.
The localStorage cache key prefix was bumped `pb7_supa_` → `pb8_supa_` to
invalidate stale ILIKE-based caches.

Reason:

Substring ILIKE matching produced false positives — most notably `sui`
matching "Misa Tsutsui." FK equality against the normalized `artists` table is
precise, faster, and makes artist identity a data-model concern rather than a
string-matching concern.

Status:

Accepted. Live in production. Related cleanup: Tetsu Kayama alias/FK cleanup,
three card_extras seed FK fixes (`swsh11-186` → shinji-kanda,
`swsh12.5-GG19` → asako-ito, `swsh12.5-GG69` → akira-egawa), `shibuzoh` alias
includes `Shibuzō`, and the `"Mosakazu Fukuda"` alias was confirmed legitimate.

---

## 2026-07-02 — V-A: subtractive visual refinement over redesign

Decision:

Visual polish proceeds by removing the "campfire/game" prototype layer
(excess glow, loud flame styling, gradient text) rather than building a new
design system. The V-A Quiet Pass applied this: reduced logo glow, calmer
flame/button styling, de-gradiented Dashboard hero, removed footer artist-name
text. `index.html` must remain a minimal Vite shell — an incident where app
CSS was pasted into it caused a build failure and was fixed.

Reason:

The "archive" visual layer already works. Subtraction preserves what's good,
keeps slices small and revertible, and avoids a risky global redesign.

Status:

Accepted. V-A applied; V-B (landing/loading/logo) is a future slice.

---
---

## 2026-06-26 — Gate 2: Vercel selected as production hosting platform

Decision:

Production deployment moved from GitHub Pages to Vercel. Vercel production
branch set to `gate-2/vite-migration` initially, then migrated to `main` after
Gate 2 stabilization (Phase 5K). Apex DNS record updated to point to Vercel
(`A @ 216.198.79.1`).

Reason:

GitHub Pages does not support Vite build output natively — it requires a
separate deploy workflow that pushes `dist/` to a `gh-pages` branch. Vercel
provides automatic Vite/React build support, per-branch and per-PR preview
deployments, and HTTPS without additional CI configuration. The Gate 2
migration was the appropriate moment for this transition.

Implications:

- `.github/workflows/deploy-gate2.yml` (manual GitHub Pages deploy) was the
  original production deployment path. It was removed in commit `77b7a15`
  after Gate 2 cleanup completed.
- `.github/workflows/build-check-gate2.yml` (build-only smoke test) remains.
  It is `workflow_dispatch`-only and does not deploy. Minor future hygiene,
  such as renaming it, is outside Gate 2 closure.
- GitHub Pages was unpublished in Phase 5M.
- The old GitHub Pages Supabase Auth redirect URL
  (`https://vladimirbuslayev.github.io/fire-chicken/`) was removed in Phase 5L.

Status:

Accepted. In production since Phase 5H (2026-06-26). Vercel production branch
migrated from `gate-2/vite-migration` to `main` in Phase 5K (2026-07-01).

---

## 2026-06-25 — Gate 2: TCGdex illustrator lookup excluded from tcgdexService.js

Decision:

`tcgdexService.fetchCardBriefs` does not include the illustrator lookup branch from the legacy `fetchCardBriefs`. When `entry.isSet` is false, the function returns `[]` immediately rather than fetching from `api.tcgdex.net/illustrators/{name}`.

Reason:

Gate 2 rule: TCGdex is permitted only for `entry.isSet` paths. Artist-path card display must use Supabase `cards_effective`. The legacy illustrator lookup branch was a dead code path by the time the Phase 4D service layer was extracted — `cardService.fetchArtistCards` had already been rewritten to use Supabase for artist entries, and `fetchCardBriefs` was only reachable via the `entry.isSet` guard. Repairing and retaining the illustrator branch during a behavior-preserving migration would have re-introduced a live TCGdex runtime dependency that the architecture explicitly prohibits. The branch is excluded, not just disabled.

Status:

Accepted. Applied in Phase 4D Repair (2026-06-25).

---

## 2026-06-25 — Gate 2: fmtPrice rename from fmt$

Decision:

The `fmt$` function in `index.legacy.html` is exported from `src/utils/format.js` as `fmtPrice`. All call sites in `src/App.jsx` use `fmtPrice(...)`.

Reason:

`fmt$` uses a trailing dollar sign, which is valid JavaScript but unusual in named module exports and confusing in a codebase that uses `$` in other contexts (template strings, etc.). The rename improves readability without any behavior change. The function body is identical: `n => (n != null && !isNaN(n)) ? '$' + Number(n).toFixed(2) : '—'`. Since no currently-extracted module imported `format.js` before Phase 5B, there was no compatibility constraint on the name.

Status:

Accepted. Applied in Phase 4D Repair and Phase 5B (2026-06-25).

---

## 2026-06-25 — Gate 2: PriceChart uses hand-coded SVG; no chart library added

Decision:

`PriceChart` in `src/App.jsx` renders its chart using hand-coded SVG elements (`<polyline>`, `<path>`, `<circle>`, `<text>`). No external chart library (recharts or otherwise) was added to `package.json`.

Reason:

Pre-implementation audit of `index.legacy.html` lines 762–789 confirmed that the legacy `PriceChart` component is pure SVG with inline coordinate math. It does not use recharts or any other chart library. The legacy `<head>` contained no recharts CDN script. `package.json` on the branch did not include recharts. Adding a library that was not used in legacy would violate the behavior-preserving constraint.

Status:

Accepted. Confirmed in Phase 5B audit (2026-06-25).

---

## 2026-06-25 — Gate 2: SET_ORDER required direct import in App.jsx

Decision:

`SET_ORDER` is imported directly in `src/App.jsx` (from `./constants/setOrder.js`) in addition to its existing import in `src/utils/sort.js`.

Reason:

`ArtistSection`'s `groupedBySet` useMemo references `SET_ORDER` directly to sort set groups when Missing or Owned view mode is active. This was not captured in the initial Phase 5B import plan, which assumed `SET_ORDER` was only needed inside `sort.js`. The gap was identified during implementation by inspecting the component code before writing `App.jsx` — the direct reference at line 666 of the extracted component code would have produced a ReferenceError at runtime when a user activated Missing or Owned view mode, without causing a build failure. The import was added before the file was presented.

Status:

Accepted. Applied in Phase 5B (2026-06-25).

---

## 2026-06-25 — Gate 2: Phase 4D stubs repaired before Phase 5A wiring

Decision:

Seven Phase 4C/4D files that were broken self-import stubs were repaired with real function bodies before Phase 5B wired the service layer into the live component tree. The repair was a separate named step (Phase 4D Repair) rather than being folded into Phase 5B.

Reason:

During Phase 5A audit, all seven service/utility files were found to contain self-referential import statements (`import { fn } from './src/services/fn.js'`) with no actual function implementations. These files were created as documentation placeholders during Phase 4C/4D but were structurally incorrect. Fixing them in a named phase (4D Repair) before Phase 5A build validation meant the broken stubs never entered a build-validated state, and the repair could be audited independently before being depended on by the App port.

Files repaired: `src/utils/format.js`, `src/utils/imageUrl.js`, `src/services/collectionService.js`, `src/services/cardAdapter.js`, `src/services/imageService.js`, `src/services/tcgdexService.js`, `src/services/shareService.js`.

The `tcgdexService.js` repair was also modified per the TCGdex exclusion decision above.

Status:

Accepted. Applied in Phase 4D Repair (2026-06-25). Build-validated in Phase 5A.

---

## 2026-06-25 — Gate 2: REDIRECT constant omitted from App.jsx

Decision:

`const REDIRECT = 'https://vladimirbuslayev.github.io/fire-chicken/'` (line 103 of `index.legacy.html`) was not ported to `src/App.jsx`.

Reason:

Pre-implementation grep confirmed that `REDIRECT` is defined on line 103 but not referenced anywhere in the component code (lines 446–1665). It is dead code in the legacy file. Including it in the Vite port would have been misleading — implying it has a purpose it does not serve.

Status:

Accepted. Applied in Phase 5B (2026-06-25).

---

## 2026-06-23 — Product identity

Decision:

Illustrated is a premium visual archive and collection companion for Pokémon card collectors. It is not merely a price tracker.

Reason:

The strongest differentiation is artist-first and artwork-first browsing, combined with physical collection tracking.

Status:

Accepted.

---

## 2026-06-23 — TCGdex role

Decision:

TCGdex should remain an ingestion/source-sync provider. Supabase should be the runtime source of truth for card display. The frontend should not rely on live TCGdex calls for normal artist pages or future set pages.

Reason:

External APIs can change shape, have missing data, or behave inconsistently. The frontend should receive predictable, app-shaped data from Supabase.

Status:

Accepted. Reinforced and further narrowed during Gate 2 (illustrator lookup path excluded).

---

## 2026-06-23 — Stabilize before migrating

Decision:

The current single-file MVP should be stabilized before migrating to Vite/React modules.

Reason:

Migrating unstable behavior risks moving bugs into the new architecture.

Status:

Accepted. Gate 1 stabilization completed at v0.1.4 before Gate 2 began.

---

## 2026-06-23 — No major features before Gate 1

Decision:

Do not add set browsing, Japanese cards, pricing confidence, or major UI redesigns before Gate 1 stabilization is complete.

Reason:

Adding features before stabilizing the data contract increases fragility.

Status:

Accepted.

---

## 2026-06-23 — Pricing philosophy

Decision:

Pricing should eventually be confidence-based, not presented as absolute truth. TCGPlayer and other automated pricing sources can be inconsistent. eBay sold links are useful for verification.

Status:

Accepted.

---

## 2026-06-23 — Japanese card identity

Decision:

Japanese and English cards should not overwrite each other. They are separate physical collector items, even if they may share artwork.

Status:

Accepted.

---

## 2026-06-23 — Enrichment read-model pattern

Decision:

Use `card_extras` + `cards_effective` for manual illustrator corrections instead of frontend override maps, sync-time backfill, or hybrid override logic.

Reason:

`cards` must remain the raw, sync-owned source of truth for TCGdex data. Manual editorial enrichment belongs in a separate table so the sync script can never accidentally overwrite it. A Supabase view (`cards_effective`) exposes the merged result — `COALESCE(card_extras.illustrator_override, cards.illustrator)` — to the frontend as a single `illustrator` field. The frontend does not need to know whether the value came from TCGdex or an override.

Status:

Accepted. Deployed and validated in v0.1.4.

---

## 2026-06-23 — Card-ID-level illustrator verification rule

Decision:

Manual illustrator overrides must be verified at exact card ID/local-number level before insertion into `card_extras`. Do not infer illustrator from Pokémon name, set, rarity, similar artwork, or another card in the same set.

Reason:

During v0.1.4 enrichment, two cards were initially misassigned by assumption: `swsh12-TG11` Altaria was wrongly assigned to Asako Ito (correct: Yuu Nishida), and `swsh12.5-GG69` Giratina VSTAR was wrongly assigned to Shinji Kanda (correct: Akira Egawa). Both errors were caught before the final insert. Verification must happen at the individual card ID level against a trusted source.

Status:

Accepted. Applied to all future bulk enrichment work.

---

## 2026-06-23 — Defer Artist Directory / Add Artist to Gate 2

Decision:

Do not add broad artist-add or artist directory functionality in Gate 1. The correct feature is an Artist Directory / Add Artist / Follow Artist flow with proper UX, belonging in Gate 2 or later.

Status:

Accepted. Deferred to Gate 2 backlog (has not yet been built in Gate 2 either).
