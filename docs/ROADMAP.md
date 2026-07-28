Illustrated Vault — Roadmap

Last updated: 2026-07-28

Completed

Gate 1 — Stabilize MVP ✓ (v0.1.4)

Single-file app made reliable: artist pages, card modal, pricing display, CSV import, ownership + overrides, favorites, share view, cache clearing, deployment.

Gate 2 — Modular migration ✓ (2026-07-01)

Vite 5 / React 18, service/constants/utils modules, same visible behavior, no regressions. Production moved from GitHub Pages to Vercel (main). Fully closed — see CHANGELOG.md for phase history.

Gate 3 — Data foundation ✓

Normalized artists table with aliases, cards_effective exposes artist_id, frontend FK-based artist queries (ILIKE retained only as fallback), sui false-positive fix, Kayama cleanup, three card_extras seed FK fixes, alias confirmations. No further schema changes needed for near-term features.

Hunt intent + Hunt Board H-1/H-2/H-3 ✓

user_card_intent table and intentService.js (want / hunting / maybe / ignore).

Intent is planning metadata only — never affects ownership or completion counts.

Global Hunt Board view: grouped by hunting / want / maybe, then by artist, price-descending; missing-with-intent cards only; owned/stale and ignore suppressed; no new Supabase calls.

H-2: collapsible sections, MAYBE LATER collapsed by default, Dashboard mobile header polish.

H-3: larger mobile tap target on section headers.

Artist Page 2.0 ✓

Editorial hero, completion + hunt chips, Notable Cards strip, All/Owned/Missing/Hunting segments, intent pills, color-mode toggle.

CAT-1 — Temporal metadata restoration ✓ (2026-07-28)

series and release_date restored from the TCGdex Set detail. F-13 resolved: both fields populated on 23,780 / 23,780 cards (empty_series 0, distinct_series 21).

The card-upsert path is now structurally incapable of writing or nulling either column (G1); updateSetTemporal is the sole writer (G2).

Presentation-neutral. The inert release_date ordering key was removed before any temporal write, leaving set_id → local_id. No rendered sequence changed. ARTIST_SELECT unchanged, no cache bump.

SYNC_MODE=temporal is available for explicit reconciliation, scoped to one set or whole-catalog. Routine non-skipped syncs write temporal metadata after a successful card upsert, so no follow-up run is required.

SYNC_MODE=full remains prohibited as a CAT-1 mechanism.

No schema change. No ownership, matcher, artist, image or pricing behavior changed — proven by a whole-row non-temporal checksum that stayed byte-identical across the restoration.

Full evidence: /docs/CAT-1_TEMPORAL_METADATA_RESTORATION_CLOSEOUT.md.

Other shipped

SharedBinder missing-card CSV export. V-A visual quiet pass.

Sequencing — next slices (guardrail)

H-2/H-3 validation is complete. The agreed order:

Product Surface Map — map the app's surfaces and navigation before adding new lens types; plan, not build.

Artist expansion / tracked artist management — grow beyond the fixed roster; artist directory / add-artist flow.

Set Lens v0 — first non-artist goal type: browse and track completion by set.

Artist Page Slice C (collapsible/curated Notable Cards, hero refinement) or Brand/Logo/Loading V-B (calmer landing/loading, refined flame/star mythology, logo direction) — choose based on how the app feels at that point.

Pokémon Search / Lens v0 — browse and track by Pokémon.

Collection Goals / Custom Lists — user-defined goals and lists.

Binder Planning v0 — only once the goal/list model is clearer. Do not start a large Binder Composer before a clear v0 plan exists.

This order is a guardrail: do not pull later slices forward without an explicit decision.

Next decision — deliberately open

CAT-1 does not choose its successor, and this document does not either.

The next major build should be decided by weighing SORT-1 against a visible artist-first collector improvement from the sequence above — on product grounds, not on the momentum of having just finished catalog work. Two consecutive infrastructure slices (CAT-0, CAT-1) have shipped without a user-visible change; that is a reason to look hard at the collector-facing option, not a reason to reflexively pick it either.

Make the comparison explicitly and record it here before starting.

Backlog candidates

SORT-1 — Sorting architecture (unblocked by CAT-1, not automatically next)

Scope: the missing sortCards("name") case · true A–Z · whether presentation should move to real release-date chronology · SET_ORDER coverage gaps · setOrder.js cleanup · Dashboard candidate-order policy.

First input, now available for free: a read-only diff of SET_ORDER rank against true date order, possible only because release_date is populated. It will characterize setOrder.js exactly — where it agrees with chronology, where it deliberately departs, and which sets are unranked.

Known already: setOrder.js is a curated total ordering, not pure release-date chronology. The TCG Pocket block sits after the Mega Evolution block despite earlier first sets, consistent with hideTcgPocket defaulting true; and 196 mapped set IDs cover 214 catalog set_id values, so at least 18 fall to ?? 999.

SORT-1 is a candidate, not a commitment. It is infrastructure with modest immediate collector value; that trade-off is the substance of the next decision.

Strategic direction — collection goals

The long-term organizing principle is collection goals: Artist, Set, Pokémon, Custom List, and Binder Plan are different goal types, each with progress, hunt targets, and showcase. This abstraction is earned gradually through the sequence above. The app must not become a generic database/filter tracker — artist-first, premium, calm, visual, and intentional remains the identity.

Later / app readiness

mobile polish, onboarding, account settings

PWA install flow, app-store wrapper decision

performance and image loading polish

Japanese cards / language identity

pricing confidence labels and last-updated context

Deferred (explicitly)

Binder 3x3 spread view, Next Hunts module

Global UI redesign, navigation architecture overhaul

Friend comparison / social features

Freemium model, value tracking, price alerts

Null-illustrator bulk enrichment pass (data-quality follow-up; not a feature blocker)

Artist FK repair (F-19) — 499 stale FKs, 0 wrong, zero product impact today. A full sync would repair them; CAT-1 explicitly refused to do so opportunistically.

F-6 skip-predicate redesign. CAT-1 attached two confirmed instances: exu stores 27 cards against 28 upstream, so storedCount >= briefCards.length is false permanently; and jumbo, rc, sp, wp are upstream zero-card sets, which can never satisfy the predicate's trailing briefCards.length > 0 clause. All five are processed on every incremental run. Costs a small recurring re-sync; incidentally keeps the post-upsert temporal path exercised (on exu, the only one of the five holding rows).

exu-%3F TCGdex 404 — catalog-source / card-ID anomaly recorded during CAT-1, deliberately unrepaired.

Isolated non-production G1 proof — deferred observation, not a blocker. Requires a local or staging Supabase environment; must never be run against production.

Workflow concurrency guard on sync-cards.yml, which would make sync quiescence structural rather than procedural.

Upstream temporal retraction policy — specified only if evidence emerges that TCGdex withdraws release dates in practice.
