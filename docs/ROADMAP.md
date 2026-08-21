Illustrated Vault — Roadmap

Last updated: 2026-08-21

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

Artist expansion — A-D1 / A-D2a–d ✓

Explore Artists directory, tracked-artist data foundation, Find Illustrator + Add to Archive, and per-user tier / remove management. Superseded the "Artist expansion / tracked artist management" line of the old sequence.

Artist Page Slice C ✓ and Artist Page 3.0 ✓

Slice C consolidated the page (chip diet, merged FROM THE ARCHIVE band, Hunting-segment framing). Artist Page 3.0 added source-governed editorial dossiers in src/constants/artistEditorial.js with exact-canonical-ID notable-card resolution and an expectName integrity guard, plus the mobile notable-works rail refinement.

Planned Binders — BP-0A/B ✓ and BP-1A ✓

Planned Binder create/rename/describe/delete, catalog search, add/remove, and Supabase persistence. BP-1A added collector-authored manual list ordering (user_binder_cards.position, assignment trigger, atomic reorder_binder_cards RPC), Hunt intent visibility on plan rows, and a Binder Plan entry point in CardModal.

position is a list sequence, not a page or pocket index.

Binder Page Planning — BP-3.1A / BP-3.1B / BP-3.1C ✓

The physical page-placement layer over Binder Plan membership, shipped through first use and production-validated.

BP-3.1A — data foundation: user_binder_layouts / user_binder_layout_items, parent-derived SELECT-only RLS with no client write path, composite FK making foreign-binder placement structurally impossible, and the layout RPC surface.

BP-3.1B — frontend read layer and the Planned Binder Cards / Pages sub-navigation. A failed read is never rendered as first-use setup.

BP-3.1C — first-use setup: 9-pocket / 12-pocket / 16-pocket format choice, eight curated background themes, and persisted layout creation.

BP-3.1D onward is paused, not abandoned — see Paused below.

Other shipped

SharedBinder missing-card CSV export. V-A visual quiet pass. Brand V-B. Dashboard/copy V-C and V-C.1.

WF-1 — development and knowledge workflow ✓ (2026-08-13)

GitHub public repo as canonical implementation authority; Claude Code as primary implementation agent; ChatGPT as strategy/architecture/review layer; the private Obsidian notes repo as a non-authoritative exploratory knowledge layer; feature branch → build/test → PR → review → merge. Contract in AGENTS.md / CLAUDE.md; authority boundaries recorded in CURRENT_STATE.md and DECISION_LOG.md.

Sequencing — current near-term order (guardrail)

This replaces the earlier post-Hunt-Board sequence (Product Surface Map → Artist expansion → Set Lens v0 → feel-check → Pokémon Lens → Collection Goals → Binder Planning). That order is superseded: the Surface Map, artist expansion, the feel-check slices, and Binder Planning have all shipped, and the remaining lens work is no longer the near-term priority.

The agreed order is:

1. CAT-2 — Catalog Trust & Visual Completeness

CAT-3A (Image Coverage & Recoverability Audit) closed 2026-08-19 as a SCOPED PARTIAL. T and A dimensions are decision-grade; F and O were never measured because the Pokémon TCG API reliability gate (G-7) failed twice. Headline: T1 = 0 of 1,640 — no missing-image row has an image available at TCGdex today, so broad ingestion repair is not justified. The CAT-3A Decision Framework did not run, so CAT-3A selected no slice.

CAT-3A itself selected no repair slice. It did identify 192 approved same-printing retained-history alias relationships as a potentially repairable class — 192/192 CAT-2D.2-approved pairs are A2 with 192/192 retained assets live, covering 45 of 117 active-owned gaps — but CAT-3A authorized no image writes. See /docs/CAT-3A_IMAGE_COVERAGE_AND_RECOVERABILITY_AUDIT.md §12-13.

CAT-3B (Durable Approved Image Override Channel) is ✓ CLOSED / DEPLOYED / VALIDATED / MERGED 2026-08-19 — PR #17, merge commit 5d741372cf4f1ac89ce5386c069835f947b11f07. The durability / image-override prerequisite that CAT-3A recommended now exists and is no longer a future prerequisite. public.cards remains raw provider history; cards_effective is the rendering chokepoint via an image_url_override COALESCE; admission is restricted to approved alias relationships with the source image matched at admission; provenance is withheld from anon and authenticated. The channel is EMPTY — zero override rows, zero rendered pixels changed. Creating any override, including the 192 CAT-3A-measured pairs, requires its own separately approved slice. Sync remains PAUSED. See /docs/CAT-3B_DURABLE_IMAGE_OVERRIDE.md.

CAT-3B.1 (Approved Alias Image Activation) is ✓ EXECUTED / VALIDATED 2026-08-20 — PR #21, head 304c69d. The 192 approved same-printing alias pairs are activated (190 inserts + 2 updates), closing 45 of the 117 active-owned image gaps. Broad catalog image remediation is CLOSED: T1 = 0 of 1,640, so no remaining gap has an image available upstream today.

F-15 (Durable Attribution Correction — the channel) is ✓ EXECUTED / VALIDATED 2026-08-21 — PR #26, head 856250c, migration `20260821132512_f15_durable_attribution_correction`. Same pattern as CAT-3B applied to artist attribution: `card_extras` gained `artist_id_override` plus provenance, admission is aliases-only (mirroring `sync-cards.mjs :: resolveArtistId()`), and `cards_effective`'s `artist_id` now uses `CASE` — not `COALESCE` — so an intentional NULL correction is representable. Effective attribution changed on **0** rows during F-15 itself; the channel exists but is not yet used for a single ATTR-1 repair. See /docs/F-15_IMPLEMENTATION.md.

ATTR-1 (twelve confirmed attribution repairs through the F-15 channel) is the immediate next slice — evidence population closed; implementation not authored. `artist_id_override` NULL on all twelve, full external provenance, its own review and its own separate execution approval. Expected visible effect: twelve corrected illustrators and exactly one membership change (sui 224 → 223).

After ATTR-1: the bounded xya duplicate-identity decision, Yellow-A coverage follow-up as needed, IMG-0, and then any narrow evidence-backed image repairs actually supported/approved close out the remaining named Catalog Trust work, followed by the Catalog Trust Exit Gate.

2. NAV-1 — Product Architecture & Durable Navigation

3. SEC-0 — User Data & Application Security Audit

4. AUTH-1 — Persistent Sign-In & Session Reliability

5. BETA-0 — Small Collector Beta

This order is a guardrail: do not pull later slices forward without an explicit decision. ATTR-1 is inside CAT-2 (Catalog Trust), ahead of NAV-1 — it is not a new step pulled forward, it is CAT-2's own remaining work.

Paused

Binder Page Planning BP-3.1D+ — page arrangement, pocket placement, theme change, and layout reset. Paused, not abandoned. The database RPCs (save_binder_page_layout, set_binder_layout_theme, reset_binder_page_layout) already exist and are deliberately unreachable from the frontend until this resumes. Do not add a write seam to binderLayoutService.js outside an approved slice.

Backlog candidates

SORT-1 — Sorting architecture (unblocked by CAT-1, not automatically next)

Scope: the missing sortCards("name") case · true A–Z · whether presentation should move to real release-date chronology · SET_ORDER coverage gaps · setOrder.js cleanup · Dashboard candidate-order policy.

First input, now available for free: a read-only diff of SET_ORDER rank against true date order, possible only because release_date is populated. It will characterize setOrder.js exactly — where it agrees with chronology, where it deliberately departs, and which sets are unranked.

Known already: setOrder.js is a curated total ordering, not pure release-date chronology. The TCG Pocket block sits after the Mega Evolution block despite earlier first sets, consistent with hideTcgPocket defaulting true; and 196 mapped set IDs cover 214 catalog set_id values, so at least 18 fall to ?? 999.

SORT-1 is a candidate, not a commitment, and it is not in the current near-term sequence.

Set Lens v0, Pokémon Search / Lens v0, and Collection Goals / Custom Lists — the remaining unbuilt lens types from the superseded sequence. Still valid long-term direction, deliberately behind the current near-term order.

Strategic direction — collection goals

The long-term organizing principle is collection goals: Artist, Set, Pokémon, Custom List, and Binder Plan are different goal types, each with progress, hunt targets, and showcase. This abstraction is earned gradually, one concrete goal type at a time — Artist and Binder Plan now exist as real, opinionated surfaces. The app must not become a generic database/filter tracker — artist-first, premium, calm, visual, and intentional remains the identity.

Later / app readiness

mobile polish, onboarding, account settings

PWA install flow, app-store wrapper decision

performance and image loading polish

Japanese cards / language identity

pricing confidence labels and last-updated context

Deferred (explicitly)

Next Hunts module

Superseded: "Binder 3x3 spread view" is no longer a deferral. Physical page planning shipped as Binder Page Planning BP-3.1A/B/C with 9/12/16-pocket formats; the remaining arrangement work is paused under BP-3.1D+, not deferred indefinitely.

Superseded: "navigation architecture overhaul" is no longer an indefinite deferral either — durable routes and state restoration are now the substance of NAV-1 in the near-term sequence.

Global UI redesign

Friend comparison / social features

Freemium model, value tracking, price alerts

Null-illustrator bulk enrichment pass (data-quality follow-up; not a feature blocker)

Artist FK repair (F-19) — 499 stale FKs, 0 wrong, zero product impact today. A full sync would repair them; CAT-1 explicitly refused to do so opportunistically.

F-6 skip-predicate redesign. CAT-1 attached two confirmed instances: exu stores 27 cards against 28 upstream, so storedCount >= briefCards.length is false permanently; and jumbo, rc, sp, wp are upstream zero-card sets, which can never satisfy the predicate's trailing briefCards.length > 0 clause. All five are processed on every incremental run. Costs a small recurring re-sync; incidentally keeps the post-upsert temporal path exercised (on exu, the only one of the five holding rows).

exu-%3F TCGdex 404 — catalog-source / card-ID anomaly recorded during CAT-1, deliberately unrepaired.

Isolated non-production G1 proof — deferred observation, not a blocker. Requires a local or staging Supabase environment; must never be run against production.

CAT-3B durability write test (docs/sql/cat-3b-3-durability-test.sql) — deferred observation, not a blocker. Non-production only, and no non-production Supabase environment exists; must never be manufactured in production. The durability claim rests meanwhile on the three static proofs asserted in CI by scripts/cat3b-durability.test.mjs.

Workflow concurrency guard on sync-cards.yml, which would make sync quiescence structural rather than procedural.

Upstream temporal retraction policy — specified only if evidence emerges that TCGdex withdraws release dates in practice.
