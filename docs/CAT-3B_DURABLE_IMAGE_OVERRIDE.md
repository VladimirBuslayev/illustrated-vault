# CAT-3B — Durable Approved Image Override Prerequisite

**Slice:** CAT-3B — Durable Approved Image Override Prerequisite
**Parent:** CAT-2 — Catalog Trust & Visual Completeness
**Type:** Schema prerequisite. Creates a channel. Populates nothing.
**Predecessor:** CAT-3A (CLOSED — SCOPED PARTIAL, merged `a37e00a`)

---

## 0. Status

```
STATUS:            PREPARED — NOT EXECUTED
Migration SQL:     authored, NOT RUN
Validation SQL:    authored, NOT RUN
Durability test:   authored, NOT RUN (non-production only)
Override rows:     ZERO — and creating them is out of scope for this slice
```

Deploying this slice changes **zero rendered pixels**. Every new column is
nullable with no default, so `coalesce(NULL, c.image_url)` is a provable no-op.

---

## 1. The problem

`public.cards.image_url` is **raw provider-derived data**.
`sync-cards.mjs :: mapCardToRow()` performs a full-row upsert that rewrites it
from whatever TCGdex returns (`sync-cards.mjs:332`, `:345`).

There is no image provenance column, and `card_extras` currently overrides
`illustrator` only. There is **no durable image override channel at all**.

A curated image written into `cards.image_url` today would be **silently
reverted** the next time its set is not skipped by the incremental predicate,
with nothing recording that the value was ever deliberate.

> **The prerequisite is the channel, not the image write.**

### 1.1 What CAT-3A did and did not establish

CAT-3A measured, decision-grade, that all **192** CAT-2D.2-approved alias pairs
hold a live TCGdex asset their canonical survivor lacks, covering **45 of 117**
active-owned image gaps.

CAT-3A's **Decision Framework did not run**, because its conclusion gate did not
pass. **CAT-3A selected no implementation slice** and did not select D-ALIAS.
CAT-3B exists on the strength of the A-dimension evidence, which stands on its
own, and on an explicitly accepted policy principle — not on a CAT-3A decision.

---

## 2. What this channel can and cannot express

**It is restricted to approved alias relationships. It is *not* hard-coded to
any particular set of cards, and specifically not to the current 192.**

- An override may only cite a source that `public.card_identity_resolution`
  already reports as an approved alias **of that canonical card**.
- A future alias approved by a later slice therefore becomes **eligible**
  automatically — but **nothing is applied automatically**. An explicit override
  write is always required. Approving an alias never renders a pixel by itself.
- There is no path here for a non-alias source, a translated provider id, a
  fuzzy match, or a cross-printing / cross-language image. Those are not
  discouraged; they are **unstorable**.

The 192 figure is a **measurement** of today's eligible population, not the
channel's definition.

---

## 3. Live architecture findings

Established on `main` @ `a37e00a`.

### 3.1 `cards_effective` is a total chokepoint

| Consumer | Reads |
|---|---|
| `cardService.ARTIST_SELECT` | `cards_effective` |
| `binderService.CARD_COLS` | `cards_effective` |
| `catalogIndexLoader` | `cards_effective` (nulls `image_url`) |
| `get_active_import_snapshot_read_model()` (OL-0D) | `cards_effective` (`ol-0d-1…sql:176`) |
| Direct reads of raw `public.cards` in `src/` | **0** |

Every rendered image originates from `cards_effective.image_url` →
`cardAdapter.js:22` → `imageUrl.js:8-9`.

**One view change reaches 100% of image consumers with zero application-code
change.** This is what makes a minimal design possible.

### 3.2 The durability mechanism already exists

`sync-cards.mjs` **writes to exactly one table**: `public.cards` (upsert `:345`,
temporal update `:396`). It also *reads* `public.artists` (`:218`, alias map) and
`public.cards_effective` (`:476`, the CAT-2B1 identity-collision guard) — both
`SELECT` only.

**`card_extras` appears nowhere in the file**, in any form.

The distinction between read and write targets is load-bearing here and is
asserted separately in the harness: a future edit that turned either read into a
write would break the durability claim without changing the table count.

`mapCardToRow` emits 21 named keys. Because `upsertRows` issues
`INSERT … ON CONFLICT (id) DO UPDATE SET` over exactly those payload columns,
**a column absent from the payload is structurally unwritable by the routine
path** — the same argument CAT-1's G1 made for `series` / `release_date`.

### 3.3 The override pattern already exists

`cards_effective` already does `coalesce(ce.illustrator_override, c.illustrator)`.
`card_extras` already has an FK to `cards(id)`, RLS enabled with SELECT-only for
anon/authenticated (no write policies → writes implicitly denied), an explicit
GRANT, and an `updated_at` trigger. New columns inherit all of it.

### 3.4 A hazard that does not apply

CAT-0 **F-15** flagged that `cards_effective` COALESCEs `illustrator_override`
while taking `artist_id` straight from `cards`, so an override changes the
display and never the derived FK. **`image_url` has no derived companion
column**, so the analogous divergence class does not exist for images.

---

## 4. Design

Extend `card_extras`. No new table.

### 4.1 Columns

| Column | Type | Notes |
|---|---|---|
| `image_url_override` | `text` | the durable value |
| `image_override_source_card_id` | `text` | FK → `cards(id)` **ON DELETE RESTRICT** |
| `image_override_evidence` | `jsonb` | structured provenance |
| `image_override_approved_by` | `text` | |
| `image_override_approved_at` | `timestamptz` | |

**Why RESTRICT and not CASCADE.** `card_extras.card_id` cascades because an
enrichment row is meaningless once its card is gone. The *source* reference is
the opposite case: it is the provenance of a deliberate human decision. Silently
deleting the record of where an approved image came from — because some
unrelated cleanup removed the retained provider-history row — would destroy the
audit trail while leaving the override in place and unexplained. RESTRICT forces
that collision to surface.

The FK targets raw `public.cards`, not `cards_effective`: an alias source row is
by construction **excluded** from the effective catalog.

### 4.2 Constraints

- **All-or-nothing.** Either all five fields are present or all five are absent.
  An override without provenance is worse than no override: it renders a curated
  pixel nobody can trace.
- **Non-empty `approved_by`.**
- **Source ≠ self.**
- **Shape.** The value must be a TCGdex asset **base path**: correct host, no
  trailing slash, no file extension, no whitespace. `imgSmall` renders
  `` `${image}/low.webp` ``, so a finished-file URL would resolve to
  `.../x.png/low.webp` and 404. Pinning the host is the point, not incidental
  hardening — without it this column becomes an arbitrary external-image
  channel, precisely the generic multi-provider framework CAT-3B is scoped to
  avoid.

### 4.3 Admission trigger

`BEFORE INSERT OR UPDATE ON card_extras`, **SECURITY INVOKER**. Rejects:

1. incomplete provenance;
2. a source that is **not an approved alias of `NEW.card_id`**;
3. a value that is **not that source card's current `image_url` at admission
   time**;
4. (implicitly, via the source lookup) a source with no image to admit.

It reads `public.card_identity_resolution` — the two-column public surface
CAT-2D.1 §3 granted to anon, authenticated and service_role — and
`public.cards`. **It never touches `public.card_identity_aliases`**, whose
privilege wall stays intact, and it is deliberately **not** `SECURITY DEFINER`.
Nothing here widens anyone's access.

### 4.4 Admission-time semantics — deliberate, not a gap

> The equality between the override and its source's `image_url` is checked
> **when the override is written, and never again.**

Raw `cards` is provider history. A future sync may legitimately change or null
the alias row's `image_url`. The stored override **must survive that**: it
records a human decision, taken against evidence captured at a known moment,
that a specific asset represents this printing. Re-deriving it later would make
a curated value silently dependent on provider churn — reintroducing exactly the
fragility CAT-3B removes.

**After admission the override and the source's current value may diverge, and
that divergence is correct.** `cat-3b-3-durability-test.sql` step 5 asserts it as
a required outcome.

### 4.5 The view

Rebuilt from the **current CAT-2D.1 production definition**
(`cat-2d1-1-dark-alias-foundation.sql` §4) — **not** from the stale definition in
`card_extras_and_view.sql`, which predates the alias exclusion and would silently
revert CAT-2D.1 if used as the base.

Preserved exactly: `security_invoker = true`, all 14 columns in order with
`artist_id` last, the `card_extras` LEFT JOIN, and the
`card_identity_resolution` alias exclusion.

The only effective-value semantic change in the entire slice:

```sql
c.image_url                                   -- before
coalesce(ce.image_url_override, c.image_url)  -- after
```

`scripts/cat3b-durability.test.mjs` proves mechanically that **exactly one line**
differs from the CAT-2D.1 definition.

---

## 5. Files

**Added**

| File | Purpose |
|---|---|
| `docs/CAT-3B_DURABLE_IMAGE_OVERRIDE.md` | this document |
| `docs/sql/cat-3b-1-durable-image-override.sql` | migration + inline rollback (§6) |
| `docs/sql/cat-3b-2-validation.sql` | read-only V-1 … V-5 |
| `docs/sql/cat-3b-3-durability-test.sql` | **non-production** write test |
| `scripts/cat3b-durability.test.mjs` | static harness |

**Changed on deploy/closeout only:** `docs/CURRENT_STATE.md`,
`docs/DECISION_LOG.md`, `docs/ROADMAP.md`.

**Explicitly unchanged:** `src/**` (zero files) · `sync/**` (zero files) ·
`card_identity_aliases` · the OL-0D RPC · every workflow.

---

## 6. Migration and rollback

**Migration.** Additive and idempotent (`add column if not exists`, guarded
constraint adds). Order: columns → FK → constraints → trigger → view. Every new
column is nullable with no default.

**Rollback.** Restoring the view is one `CREATE OR REPLACE VIEW`, instant,
recorded verbatim in the migration §6. Because this slice writes no override
rows, rollback loses no data. Columns, constraints and trigger may be left in
place — they are inert while every override field is NULL — or dropped with the
statements also recorded in §6.

---

## 7. Validation plan

| Check | Proves |
|---|---|
| **V-1** | `card_extras` **pre-existing columns only** are byte-identical across the schema addition. Run **before and after**. A whole-row `to_jsonb` checksum would be useless — adding columns changes the JSON shape by construction — so the five pre-existing columns are projected explicitly. |
| **V-2** | Every new override field is NULL on every row, including a `rows_with_any_override_field` counter that catches a partially populated row the individual counters could mask. |
| **V-3** | `cards_effective` is **row-for-row output-equivalent** to pre-CAT-3B, via a symmetric `EXCEPT ALL` diff against the pre-CAT-3B expression reconstructed inline from the same base tables. Not a remembered number. |
| **V-4** | Structural contract: 14 columns, order, `artist_id` at position 14, `security_invoker`, grants. |
| **V-5** | The admission wall exists, is **not** `SECURITY DEFINER`, reads `card_identity_resolution`, and does **not** read `card_identity_aliases`. |

### 7.1 Durability — proving sync cannot erase an override

**Static (in CI, `scripts/cat3b-durability.test.mjs`):**

1. `mapCardToRow`'s payload cannot express any of the five columns — asserted
   per-column, so a future edit that adds one fails the build.
2. `sync-cards.mjs` addresses only `cards` and `artists`; `card_extras` appears
   nowhere.
3. `cards_effective` COALESCEs the **stored** override and does not join the
   source row at all, so the alias row's current value is not an input to the
   rendered value.

**Empirical (`cat-3b-3-durability-test.sql`, non-production, ends in ROLLBACK):**
admit an override, then change the raw alias `image_url`, then null it entirely,
asserting at each step that both the stored override and the canonical effective
image are unchanged. If no non-production environment exists, this is recorded as
a **deferred observation** — the disposition CAT-1 took for its isolated G1
proof, and for the same reason. It must not be manufactured in production.

---

## 8. Out of scope

Creating the 192 overrides · any production data write · deploying this
migration · resuming or triggering sync · `SYNC_MODE=full` · any `src/**` or
`sync/**` change · runtime image logic, `imageUrl.js`, `imageService.js`,
`CardImage.jsx` · a generic multi-provider image framework · non-alias image
sources of any kind · provider-ID translation or correspondence tables ·
cross-printing or cross-language proxies · reopening CAT-3A · re-attempting the
CAT-3A reliability gate · CAT-2D.3 identity remap · CAT-2D.4 Trainer Galleries ·
image provenance for the 1,448 non-alias gaps.
