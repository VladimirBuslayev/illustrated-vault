# Illustrated Vault — Product Surface Map

Last updated: 2026-07-02
Status: Planning document. No implementation implied by this file.

Purpose: define what each surface owns, what it must not own, and how the
future Collection Goals / Lenses model fits — so new features land in the
right place instead of accreting onto whatever surface is nearest.

---

## 1. Current surface responsibilities

### Dashboard

- **Primary job:** Personal collection overview and routing hub. Answers "how is my collection doing, and where do I go next?" — total progress, per-artist progress rows, Most Wanted strip, entry points to Binder and Hunt Board.
- **Secondary job:** Sync/import feedback (CSV status, sync indicator) and account context.
- **Does not belong here:** Catalog browsing or search, hunt planning detail (counts and a link are fine; ranked lists are Hunt Board's job), pricing analytics, artist management, settings content.
- **Risks:** The classic widget dump — every future feature will want a Dashboard module. "Next Hunts" was already correctly deferred. Rule of thumb: **Dashboard summarizes and routes; it never operates.** Each goal type gets at most one summary row/strip that links out.

### Artist Page

- **Primary job:** The definitive editorial view of one artist: hero, metadata, notable cards, completion, and the All / Owned / Missing / Hunting segments. This is the flagship surface and — importantly — the **prototype of the universal Lens layout** (see §2).
- **Secondary job:** Per-artist hunt context (intent pills, Hunting segment) and color-mode viewing.
- **Does not belong here:** Cross-artist comparison, global search, artist add/remove management, price analysis, generic filter stacks.
- **Risks:** Chip/segment overload as features accrue; becoming a filter playground. Every new control must justify itself against "calm, editorial, art-first."

### Binder

- **Primary job:** Whole-collection visual browse — all tracked artists in one continuous, physical-binder-metaphor scroll. Owned in color, missing desaturated.
- **Secondary job:** In-collection search, sort, view modes, color mode.
- **Does not belong here:** Acquisition planning beyond intent pills, artist management, set-centric browsing, dashboard-style stats.
- **Risks:** Sort/filter clutter; identity blur against Artist Page (Binder = everything, Artist Page = one lens deep) and later against non-artist lenses. Binder should stay artist-sectioned; other groupings belong to other lenses.

### SharedBinder

- **Primary job:** Read-only public showcase of a shared collection, plus the practical missing-list utility (Missing CSV) for shops and trade partners.
- **Secondary job:** None. Its power is its restraint.
- **Does not belong here:** Intent/hunt data (hard rule), editing, private user info, viewer accounts, social features.
- **Risks:** Feature leakage from owner surfaces during refactors (the `soloSections` pattern already guards one such case). Any change to owner-side components must re-verify SharedBinder's read-only contract.

### Hunt Board

- **Primary job:** Acquisition planning — the single ranked, grouped answer to "what should I hunt next?" across the whole collection. Card-show and shop-visit companion.
- **Secondary job:** Light triage: moving cards between hunting / want / maybe via the modal.
- **Does not belong here:** Browsing/discovery, completion stats, favorites (separate concept), marketplace features, per-lens sub-boards.
- **Risks:** Becoming a second collection browser, or sprouting price-alert/deal features. It is a plan, not a store. There must only ever be **one** Hunt Board — future lenses feed it; they don't fork it.

### CardModal

- **Primary job:** Single-card detail and the universal per-card action surface: ownership override, favorite, hunt intent, price context, eBay reference. Reachable from every surface.
- **Secondary job (growing):** Connective tissue — the natural home for future cross-links ("view artist," later "view set," "view Pokémon"). This is how lenses will interlink without global nav growth.
- **Does not belong here:** Long-form content, editorial curation, bulk actions.
- **Risks:** Button soup as goal types multiply. Actions must stay grouped by concept (ownership / affection / intent / reference) and each new one must earn its row.

### Settings

- **Primary job:** Preferences and data controls: TCG Pocket visibility, cache, sharing management, account.
- **Secondary job:** None.
- **Does not belong here:** Feature functionality — especially **tracked-artist management**, which is a collecting decision, not a preference. Settings must not become the junk drawer.
- **Risks:** Exactly that junk-drawer drift.

---

## 2. Future surface model

The organizing idea: **Artist Page 2.0 already defines the Lens skeleton** —
hero → progress → notable/curated strip → All / Owned / Missing / Hunting
segments → tiles → CardModal. Future goal types should *reuse this skeleton*
with type-specific heroes, not invent new page designs. One layout, many
lenses. This is how the collection-goals abstraction gets earned without a
rewrite.

| Future concept | Belongs in | Notes |
|---|---|---|
| Browse/search all artists | **New: Artist Directory** | Discovery surface over the Gate 3 `artists` table. Visual, card-art-led — a gallery of illustrators, not a table. Establishes the directory → lens pattern that Sets will reuse. |
| Tracked artist management | **Artist Directory** (track/untrack), with a small "manage" affordance near the Dashboard artist list | Not Settings. Tracking is a collecting decision made in context of discovery. |
| Set pages / Set Lens v0 | **New: Set Page** (Lens skeleton) | Second goal type. Entry points: CardModal set link first, a set index later. Reuses segments, intent pills, completion. |
| Pokémon Search / Pokémon Lens v0 | **New: search-first surface → Pokémon Page** (Lens skeleton) | Search is the entry; the result page is just another lens. Do not build a global "all cards" search grid. |
| Custom lists / collection goals | **New: Goals surface** | The generalization step. A goal = (type, target, progress, hunt targets, showcase). Artist/Set/Pokémon lenses become goal types retroactively; custom lists are the first user-defined type. |
| Binder planning | **Grows out of Goals** — a goal type with physical-layout semantics (pages, slots) | Deliberately last. No standalone Binder Composer before the goal model is proven. |
| Shareable views | **SharedBinder, later generalized to "share a lens/goal"** | v1 stays artist-collection sharing. Read-only contract carries over to any future shared lens. |
| Hunt Board acquisition planning | **Hunt Board (unchanged role)** | Stays the single cross-goal plan. Later enhancement: goal-aware grouping. Never per-lens boards. |

---

## 3. Navigation model recommendation

Keep **hub-and-spoke with three persistent anchors**, and let lenses be
content, not chrome:

- **Anchors (persistent, small header):** Dashboard (home) · Binder (collection) · Hunt Board (plan). These are the three verbs: *overview, browse, hunt.*
- **Lenses (Artist / future Set / future Pokémon pages):** reached through anchors, directories, and cross-links — never top-level tabs. This is the guard against tab explosion as goal types grow from 1 to 5.
- **Directories (Artist Directory, later set index):** hang off Dashboard and/or Binder as "explore" entry points.
- **CardModal as connective tissue:** artist name links to Artist Page today; set and Pokémon links join it when those lenses exist. Most cross-lens travel should happen through cards, because cards are the shared atom of every lens.
- **SharedBinder:** stays URL-only (`?share=`), outside app navigation.

Known debt to flag (not fix now): navigation is view-state only — Artist
Pages and future lenses have no URLs, so they can't be linked, bookmarked, or
back-buttoned. Real routing becomes necessary around Set Lens / shareable
lens views. Record it as an upcoming infrastructure decision, not a current
task.

---

## 4. Product sequencing recommendation

The agreed sequence is **confirmed**, with rationale:

1. **Product Surface Map** — this document.
2. **Artist expansion / tracked artist management** — correctly next: the Artist Directory establishes the directory → lens → track pattern, exercises the Gate 3 `artists` table, and deepens the flagship lens before any new lens type exists.
3. **Set Lens v0** — first reuse of the Lens skeleton; proves the model generalizes.
4. **Artist Page Slice C or Brand/Logo/Loading V-B** — feel-check decision point; choose whichever the app most needs after two structural slices.
5. **Pokémon Search / Lens v0** — second skeleton reuse; adds the search entry pattern.
6. **Collection Goals / Custom Lists** — generalize only after three concrete lens types exist to generalize *from*.
7. **Binder Planning v0** — last, once the goal/list model is clear.

One nuance: the step-4 feel-check is allowed to move earlier if the app
starts feeling structurally sound but emotionally flat — brand work is the
pressure valve, not a fixed slot. Nothing else in the order should move
without an explicit decision.

---

## 5. Risks and deferrals

- **Generic tracker drift:** global filter bars, an "all cards" grid, spreadsheet-style tables. Mitigation: every surface must answer one of the five collector questions; directories are galleries, not databases.
- **Database clone drift:** exposing the raw catalog without goal context. Mitigation: catalog data is only ever reached *through* a lens or directory with progress and curation attached.
- **Marketplace/price drift:** deal feeds, portfolio-value charts on Dashboard, price alerts. Pricing stays per-card buying context (modal, Hunt Board sort). All alert/valuation features remain deferred.
- **Overbuilt binder planner:** schema and UI for pages/slots before the goal model exists. Hard-deferred per roadmap.
- **Cluttered dashboard:** module creep. Budget: one summary element per goal type, everything links out.
- **Lens divergence:** each new lens getting bespoke UI. Mitigation: the Lens skeleton is the contract; deviations need a reason.
- **Intent semantics dilution:** as lenses multiply, pressure will grow to merge favorites and intent or add per-lens statuses. The favorites-vs-intent distinction and the four-status model hold unless deliberately revisited.
- **Navigation debt:** view-state routing (no URLs) is acceptable now, a blocker later. Decide on routing before or during Set Lens v0.

---

## 6. Recommended next implementation slice

**Artist Directory v0 (read-only browse) — slice A-D1.**

Scope: a directory surface listing all artists from the Gate 3 `artists`
table — visual, card-art-led, with name, card count, and (for tracked
artists) progress — where tapping a tracked artist opens their existing
Artist Page. No track/untrack mutation yet; no schema changes; no changes to
the `ARTISTS` roster mechanism.

Why this slice:

- It is the first step of the agreed "Artist expansion" phase and establishes the directory → lens pattern that Set Lens v0 will copy.
- It reads data that already exists (the `artists` table was built in Gate 3 and is currently underused by the frontend).
- It is narrow, independently revertible, and touches no invariants: no ownership logic, no intent, no SharedBinder, no schema.
- It surfaces the real design questions of tracked-artist management (what does an *untracked* artist's page look like? where does progress come from?) *before* any tracking persistence is built — audit-first, in product form.

Track/untrack persistence (which will require a schema decision, e.g. a
user-tracked-artists table vs. the current hardcoded roster) becomes slice
A-D2, planned only after A-D1 is validated.
