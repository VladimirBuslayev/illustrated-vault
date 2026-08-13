# Illustrated Vault — Product Surface Map

Last updated: 2026-08-13
Status: Live surface map. §1 describes surfaces that are shipped and in
production; §2 remains forward-looking. This file records surface ownership
boundaries — it does not authorize implementation on its own.

Purpose: define what each surface owns, what it must not own, and how the
future Collection Goals / Lenses model fits — so new features land in the
right place instead of accreting onto whatever surface is nearest.

Three binder concepts are distinct and must not be conflated:

- **Binder** — artist-first collection browse. The continuous, whole-collection
  visual scroll across tracked artists. Not a user-authored list.
- **Planned Binder** — an intentional themed card list the collector builds.
  Membership is explicit and catalog-independent; `position` is a manual **list
  order** and nothing more.
- **Binder Page Layout** — the optional physical page-placement planning layer
  over one Planned Binder's membership. Pockets are occupied by membership rows,
  never by catalog card IDs, and never by list `position`.

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

### Owned Library — shipped

- **Primary job:** The exhaustive physical-collection archive. Answers "what do I physically own?" across the imported collection, including cards outside the tracked-artist roster.
- **Ownership authority:** authenticated ownership follows the active import snapshot canonical-card authority plus explicit manual overrides. Never fall back to loose `owned_keys` matching — that remains legacy recognition infrastructure and still powers only the separate SharedBinder boundary.
- **Secondary job:** Collection search/browse and card inspection.
- **Does not belong here:** Missing-card completion planning, Hunt Board prioritization, Planned Binder membership, or generic portfolio/value analytics.
- **Risks:** Ownership-authority drift, cross-printing false positives, or turning the archive into a generic tracker. False-positive physical ownership is more harmful than a temporary false negative.

### Artist Directory ("Explore Artists") — shipped

- **Primary job:** Artist discovery and archive-roster management. Gallery browse over the roster, Find Illustrator search against `illustrator_directory`, Add to Archive, and per-artist tier reassignment / Remove from Archive on dynamically added artists.
- **Secondary job:** Entry point into the Artist Page lens.
- **Does not belong here:** Card-level actions, ownership editing, hunt planning, price analysis, spreadsheet-style artist tables. Tracked-artist management belongs here and **not** in Settings — tracking is a collecting decision, not a preference.
- **Standing rule:** users can look at anything, but can act only on what is in their archive. Untracked discovery results are read-only until added to the archive; once an artist is in the user's archive, the existing roster-management actions (tier reassignment, Remove from Archive) are allowed.
- **Risks:** Drifting from gallery to database. Curated roster entries must stay visually and functionally untouched by the Manage affordance, which is dynamic-only by construction.

### Planned Binder — shipped

- **Primary job:** An intentional themed card list the collector is building — create/rename/describe/delete, global catalog search, add/remove, manual list ordering, and Hunt intent visibility on rows.
- **Secondary job:** Hosts the Cards / Pages sub-navigation into the page-layout layer.
- **Does not belong here:** Artist-first browse (that is Binder), acquisition ranking (that is Hunt Board), ownership authority. Membership is a statement of intent and is deliberately catalog-independent — it must survive a catalog row becoming unavailable.
- **Risks:** `position` being reinterpreted as physical placement. It is a list sequence, full stop.

### Binder Page Layout ("Pages") — shipped through first-use setup

- **Primary job:** Physical page-placement planning for one Planned Binder: page format (9 / 12 / 16-pocket), background theme, and — once BP-3.1D resumes — pocket arrangement.
- **Secondary job:** None. Its restraint is deliberate.
- **Does not belong here:** Membership changes (that is Planned Binder), list reordering, ownership, intent. A pocket is occupied by a membership row, never by a global catalog card ID.
- **Current containment:** setup only. A layout can be created but not yet arranged, re-themed, or reset from the app; the corresponding RPCs exist but have no frontend seam. A failed layout read must never render as first-use setup.
- **Risks:** Overwriting a real arrangement by treating an unknown state as "no layout." The three read outcomes (ready-with-layout / ready-with-null / failed) must stay distinct.

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

| Concept | Belongs in | Status / notes |
|---|---|---|
| Browse/search all artists | **Artist Directory** | **Shipped** (A-D1, A-D2c-lite). Gallery of illustrators, not a table. Established the directory → lens pattern that Sets will reuse. |
| Tracked artist management | **Artist Directory** | **Shipped** (A-D2a/b0/c/d): add to archive, tier reassignment, remove. Not Settings. |
| Binder planning | **Planned Binder + Binder Page Layout** | **Shipped ahead of the original sequence.** Binder Planning was originally deferred until the goal model was proven; BP-0A/B, BP-1A and BP-3.1A/B/C shipped it as its own concrete surface instead. Physical placement is a separate optional layer over membership, not a property of it. |
| Set pages / Set Lens v0 | **New: Set Page** (Lens skeleton) | Not built. The next unbuilt Lens type — the first reuse of the Artist Page skeleton, not literally the second goal type now that Binder Plan exists. Entry points: CardModal set link first, a set index later. Reuses segments, intent pills, completion. |
| Pokémon Search / Pokémon Lens v0 | **New: search-first surface → Pokémon Page** (Lens skeleton) | Not built. Search is the entry; the result page is just another lens. Do not build a global "all cards" search grid. |
| Custom lists / collection goals | **New: Goals surface** | Not built. The generalization step. A goal = (type, target, progress, hunt targets, showcase). Artist/Set/Pokémon lenses become goal types retroactively. |
| Shareable views | **SharedBinder, later generalized to "share a lens/goal"** | v1 stays artist-collection sharing and read-only. Read-only contract carries over to any future shared lens. |
| Hunt Board acquisition planning | **Hunt Board (unchanged role)** | Stays the single cross-goal plan. Later enhancement: goal-aware grouping. Never per-lens boards. |

---

## 3. Navigation model recommendation

Keep **hub-and-spoke with three persistent anchors**, and let lenses be
content, not chrome:

- **Anchors (persistent, small header):** Dashboard (home) · Binder (collection) · Hunt Board (plan). These are the three verbs: *overview, browse, hunt.*
- **Lenses (Artist / future Set / future Pokémon pages):** reached through anchors, directories, and cross-links — never top-level tabs. This is the guard against tab explosion as goal types grow from 1 to 5.
- **Directories (Artist Directory, later set index):** hang off Dashboard and/or Binder as "explore" entry points.
- **Sub-navigation within a surface** (Planned Binder's Cards / Pages tabs) is content-local and does not become app chrome. A second layer inside one surface is acceptable; a second layer in the header is not.
- **CardModal as connective tissue:** artist name links to Artist Page today, and the Binder Plan entry point adds a card to a plan from the same surface; set and Pokémon links join them when those lenses exist. Most cross-lens travel should happen through cards, because cards are the shared atom of every lens.
- **SharedBinder:** stays URL-only (`?share=`), outside app navigation.

Navigation debt — now an active concern, not a flagged future one. Navigation
is still view-state only: Artist Pages, Planned Binders, the Pages sub-view and
future lenses have no URLs, so they cannot be linked, bookmarked, or
back-buttoned, and page/route state is not durably restored across reloads.
The Hunt Board back button always returns to Dashboard regardless of entry
point. Deep sub-navigation (Planned Binder → Pages) made this materially worse.

This is the substance of **NAV-1 — Product Architecture & Durable Navigation**,
the second slice in the current near-term sequence. It is a scheduled slice,
not an open question; see ROADMAP.md.

---

## 4. Product sequencing

**Superseded.** The sequence this document recommended in 2026-07 (Surface Map
→ Artist expansion → Set Lens v0 → feel-check → Pokémon Lens → Collection Goals
→ Binder Planning last) no longer describes the plan. The Surface Map, artist
expansion, and the feel-check slices shipped; Binder Planning shipped early as
its own surface rather than last out of Goals.

Sequencing authority now lives in ROADMAP.md. The current near-term order is
CAT-2 → NAV-1 → SEC-0 → AUTH-1 → BETA-0, with Binder Page Planning BP-3.1D+
paused. Set Lens, Pokémon Lens, and Collection Goals remain valid long-term
direction behind that order.

Do not re-derive sequencing from this file.

---

## 5. Risks and deferrals

- **Generic tracker drift:** global filter bars, an "all cards" grid, spreadsheet-style tables. Mitigation: every surface must answer one of the five collector questions; directories are galleries, not databases.
- **Database clone drift:** exposing the raw catalog without goal context. Mitigation: catalog data is only ever reached *through* a lens or directory with progress and curation attached.
- **Marketplace/price drift:** deal feeds, portfolio-value charts on Dashboard, price alerts. Pricing stays per-card buying context (modal, Hunt Board sort). All alert/valuation features remain deferred.
- **Overbuilt binder planner:** the original mitigation was to hard-defer pages/slots until the goal model existed. Binder planning shipped first instead, contained by keeping placement a separate optional layer over membership and by holding arrangement/theme/reset behind the paused BP-3.1D+ boundary. The live risk is now the reverse: adding write seams to the layout layer ahead of an approved slice.
- **Cluttered dashboard:** module creep. Budget: one summary element per goal type, everything links out.
- **Lens divergence:** each new lens getting bespoke UI. Mitigation: the Lens skeleton is the contract; deviations need a reason.
- **Intent semantics dilution:** as lenses multiply, pressure will grow to merge favorites and intent or add per-lens statuses. The favorites-vs-intent distinction and the four-status model hold unless deliberately revisited.
- **Navigation debt:** view-state routing (no URLs) and non-durable page/route state. No longer "acceptable now" — scheduled as NAV-1 (§3).

---

## 6. Next implementation slice

This file no longer recommends one. The former recommendation — Artist
Directory v0 (A-D1) — shipped, along with A-D2a/b0/c/d.

The next slice is **CAT-2 — Catalog Trust & Visual Completeness**, per
ROADMAP.md. Slice selection is roadmap authority; this document's job is to say
where a slice's behavior belongs once it is approved, not to choose it.
