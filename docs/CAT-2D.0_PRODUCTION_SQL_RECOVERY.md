# CAT-2D.0 — Production SQL Definition Recovery

**Status:** ✓ Complete (documentation / SQL-reference only)
**Date:** 2026-08-14
**Type:** Recovery of existing truth. Not a redesign, not a migration.
**Production changes:** none. No SQL executed, no object altered, no sync dispatched.
**Predecessor:** CAT-2B1 · **Blocks:** CAT-2D.1

---

## 1. Why this slice exists

CAT-2D.1 was scoped to modify four load-bearing production SQL objects. It stopped before writing
any SQL, because two of them could not be safely reconstructed from committed canonical files:

- **`get_active_snapshot_owned_card_ids()` had no committed definition at all.**
  `docs/OWN-0A_CLOSEOUT.md:202` names a deployed file
  `docs/sql/own-0a-1-active-snapshot-owned-card-ids.sql`. That file is not in `docs/sql/` and
  **has never existed in git history** (`git log --all` over the path returns nothing). The function
  appears in the repo only as prose and as a string constant in its JS caller.

- **The committed `cards_effective` definition was stale**, missing `artist_id`.

The practical consequence was not theoretical. Building a `CREATE OR REPLACE VIEW` from the
committed `cards_effective` text plus an alias-exclusion clause would have **silently dropped
`artist_id`**, breaking the FK artist query path, `illustrator_directory`, `add_artist_to_archive`
and the entire Artist Page — from a change whose stated purpose was to be a provable no-op.

**The general condition:** the repository could not rebuild its own production surface. CAT-2D.0
exists to close that, and its value outlives CAT-2D.

---

## 2. Method

Read-only PostgreSQL introspection, 2026-08-14, using `pg_get_functiondef`, `pg_get_viewdef`,
`pg_get_function_identity_arguments`, `pg_get_function_result`, `pg_proc` (`prosecdef`,
`proconfig`, `proacl`), `pg_class` (`reloptions`, `relacl`), and `information_schema.columns`.

No object was created, altered, dropped or executed. Nothing was deployed.

---

## 3. Findings — one line per object

| # | Object | Verdict | Canonical location |
|---|---|---|---|
| 1 | `get_active_snapshot_owned_card_ids()` | **Metadata recovered; body still outstanding** | `docs/sql/own-0a-1-active-snapshot-owned-card-ids.sql` (path reserved, no executable SQL) |
| 2 | `get_active_import_snapshot_read_model(...)` | **No drift detected** (property-level) | `docs/sql/ol-0d-4-active-snapshot-performance-hardening.sql` — unchanged |
| 3 | `cards_effective` | **CORRECTED** — committed text was stale | `docs/sql/cat-2d0-production-baseline.sql` §3 |
| 4 | `illustrator_directory` | **Already current** | `docs/sql/a-d2a-2-illustrator-directory.sql` — unchanged |

### 3.1 `get_active_snapshot_owned_card_ids()` — recovered / outstanding

Recovered: zero-arg signature, `returns jsonb`, `language plpgsql`, `STABLE`,
**`SECURITY DEFINER`**, `SET search_path TO ''`, EXECUTE granted to `postgres`, `anon`,
`authenticated`, `service_role`; internally `auth.uid()`-scoped; no `cards_effective` join; owned
predicate `match_status = 'matched' AND card_id IS NOT NULL` grouped by `card_id`; header/row
reconciliation raising `23514`; states `ready` / `no_active_batch` / `multiple_active_batches` /
`error(no_auth)`; and the full `contractVersion` / `batchId` / `activatedAt` / `matcherVersion` /
`ownedCardIds` / `reconciliation.{distinctMatchedCardIds,matchedRows}` return shape.

**Still outstanding: the function body.** The introspection brief states the exact live body was
supplied, but no `pg_get_functiondef` output reached this slice — only the property list above. The
body was therefore **not** written, because authoring a `SECURITY DEFINER` ownership function from a
description is the precise failure mode CAT-2D.0 exists to end. The recovered metadata is sufficient
to **verify** a body; it is not sufficient to **author** one.

The canonical path is reserved and documents exactly how to complete it:

```sql
select pg_get_functiondef('public.get_active_snapshot_owned_card_ids()'::regprocedure);
```

Independent corroboration of the contract now lives beside the metadata:
`src/services/ownedLibraryService.js:287-362` enforces eight distinct assertions on the `ready`
payload, all consistent with the recovered shape.

### 3.2 `get_active_import_snapshot_read_model(...)` — no drift detected

`docs/sql/ol-0d-4-active-snapshot-performance-hardening.sql` supersedes `ol-0d-1`, stating it
"Replaces the BODY of get_active_import_snapshot_read_model. Nothing else. CONTRACT: UNCHANGED."
Every introspected property matches it:

| Property | Introspected | `ol-0d-4` |
|---|---|---|
| returns | `jsonb` | L88 |
| language | `plpgsql` | L89 |
| volatility | `STABLE` | L89 |
| security | **INVOKER** (not DEFINER) | L90 `security invoker` |
| `search_path` | `''` | L91 |
| signature | 8 args | L75–84 |
| `contractVersion` | 1 | L141, L151, L371 |
| aggregation | by historical `r.card_id`, then `LEFT JOIN` | matches |
| catalog source | `cards_effective` in narrow-key **and** page-wide joins | L242, L340 |
| `artist_id` in page payload | yes | L316 |
| EXECUTE | postgres, anon, authenticated, service_role | matches |

**The definition is NOT restated in the baseline file.** Duplicating a 423-line function body would
create a second source of truth for one object and guarantee eventual drift. `ol-0d-4` remains
canonical.

**Residual ambiguity:** this is a **property-level** match, not byte-level. The live
`pg_get_functiondef` body was not supplied, so no literal text comparison was performed. Every
observable property agrees, which is strong but not conclusive — a body change that preserved all of
them would not be detected. See §6.

### 3.3 `cards_effective` — corrected

| | Columns | `artist_id` |
|---|---|---|
| Committed (`card_extras_and_view.sql`, Gate 1) | 13 | **absent** |
| Production (introspected 2026-08-14) | 14 | **present, position 14** |

Gate 3 added `c.artist_id` to the view; the change was never written back to the canonical file.
Three independent committed artifacts already proved production had it, which is how the drift was
caught:

- `docs/CAT-0_FINDINGS_AND_DECISION.md:65` — production introspection recorded `artist_id` coming
  "straight from `cards.artist_id`"
- `src/services/cardService.js:56` — `ARTIST_SELECT` selects `artist_id` **from `cards_effective`**,
  and works in production
- `docs/sql/a-d2a-2-illustrator-directory.sql:14` — `max(artist_id) from public.cards_effective`

The live definition is now recorded in `docs/sql/cat-2d0-production-baseline.sql` §3, with column
order preserved exactly. `security_invoker = true` is unchanged and must stay.

Also recorded as current truth: the view does **not** expose `series`, even though CAT-1 populated
that column on `public.cards`. CAT-1 made no view change; this is not an omission in the recovery.

### 3.4 `illustrator_directory` — already current

No drift. Committed and production differ only by `pg_get_viewdef` deparser normalization:

| Committed | Introspected | Nature |
|---|---|---|
| `count(*)::int` | `count(*)::integer` | same type, canonical spelling |
| `btrim(illustrator) <> ''` | `btrim(...) <> ''::text` | deparser adds explicit cast |
| `from public.cards_effective` | `from cards_effective` | deparser drops schema prefix |
| lower-case keywords | upper-case keywords | deparser canonicalization |

Production column types: `illustrator text`, `artist_id text`, `card_count integer`.
`security_invoker = true`. `docs/sql/a-d2a-2-illustrator-directory.sql` remains canonical and is
unchanged; the body is restated in the baseline file for the record only.

---

## 4. Convention decision — why nothing historical was rewritten

`docs/sql/` is the **execution record**: each file documents a migration as it was run, and
`ol-0d-4`'s header is explicit that it replaced a body without changing a contract. Retroactively
editing `card_extras_and_view.sql` to add `artist_id` would falsify that record — it would claim
Gate 1 did something Gate 3 actually did.

So CAT-2D.0 adds a **new baseline artifact** rather than rewriting history, and makes exactly one
non-behavioral edit to a historical file:

> A comment block was added at the top of the `cards_effective` section of
> `docs/sql/card_extras_and_view.sql` marking the definition **superseded** and pointing at the
> baseline. No DDL in that file was changed.

That is a deliberate judgement call. Leaving a known-wrong canonical definition unmarked is what
nearly caused a production regression; a pointer costs nothing and removes the trap. The historical
DDL itself is untouched and still reads exactly as it was executed.

---

## 5. Security note for CAT-2D.1 — recorded, not implemented

Introspection changes the privilege picture the CAT-2D design assumed:

| Object | Security |
|---|---|
| `get_active_snapshot_owned_card_ids()` | **DEFINER** |
| `get_active_import_snapshot_read_model(...)` | **INVOKER** |
| `cards_effective` | `security_invoker = true` |
| `illustrator_directory` | `security_invoker = true` |

The CAT-2D design note's preferred minimum read surface — `SELECT (alias_card_id)` only for
`anon`/`authenticated` — **is too narrow.**

- The ownership RPC is `SECURITY DEFINER`, so it can read the alias map regardless of caller
  privileges. Resolution there needs no public grant.
- **The OL-0D read model is `SECURITY INVOKER`.** If it joins `card_identity_aliases` directly, it
  executes as the caller and therefore needs the caller to be able to read **both**
  `alias_card_id` **and** `canonical_card_id`.
- `cards_effective` is also `security_invoker`, so its `NOT EXISTS` alias-exclusion subquery needs
  the caller to read at least `alias_card_id`.

CAT-2D.1 must therefore choose between:

- **Option A** — grant `anon`/`authenticated` column-level `SELECT` on exactly
  `(alias_card_id, canonical_card_id)`, keeping `evidence`, `approved_by`, `approved_at`, `slice`
  and timestamps private.
- **Option B** — a dedicated two-column resolution view over the alias table, with the base table
  entirely private.

**Do not convert the OL-0D function to `SECURITY DEFINER` merely to avoid the grant.** That would
move an RLS-honoring read onto definer privileges to dodge a permissions question, which is a
security change disguised as convenience and needs its own justification.

Not decided here. Recorded so CAT-2D.1 starts from the real privilege model.

---

## 6. Remaining ambiguity

| # | Item | Effect |
|---|---|---|
| A-1 | **The `get_active_snapshot_owned_card_ids()` body is still missing.** The brief stated it was supplied; it did not reach this slice. | **Still blocks CAT-2D.1 scope D and F.** One read-only `pg_get_functiondef` call closes it. |
| A-2 | `get_active_import_snapshot_read_model` was matched at property level, not byte level. | Low risk. Every observable property agrees with `ol-0d-4`. A `pg_get_functiondef` diff would make it conclusive. |
| A-3 | View and function **grants/ACLs** were captured for the two functions (`postgres, anon, authenticated, service_role`) but not reported for the two views. | Low risk — both views are demonstrably readable by the frontend's publishable key. Worth capturing when A-1 is collected. |
| A-4 | `card_extras` and `cards` themselves were not introspected. | Out of CAT-2D.0's four-object scope. `card_extras`' `ON DELETE CASCADE` is already documented in the CAT-2D design. |

**CAT-2D.1 remains blocked on A-1 alone.** A-2 through A-4 are recorded, not blocking.

---

## 7. Files

| File | Change |
|---|---|
| `docs/sql/cat-2d0-production-baseline.sql` | **new** — recovered production definitions for `cards_effective` and `illustrator_directory`; pointers for the two functions |
| `docs/sql/own-0a-1-active-snapshot-owned-card-ids.sql` | **new** — canonical path reserved; recovered metadata and client-observed contract; **no executable SQL** |
| `docs/CAT-2D.0_PRODUCTION_SQL_RECOVERY.md` | **new** — this document |
| `docs/sql/card_extras_and_view.sql` | comment-only superseded marker; **no DDL change** |

No runtime file, workflow file, sync file or JS file was changed.

---

## 8. Containment

Not done, by design: no `card_identity_aliases` created · no `cards_effective` behavior change · no
RPC behavior change · no `illustrator_directory` change · no grant/RLS change · no JS change · no
sync-code change · no aliases populated · no references migrated · no sync dispatched · no schedule
restored · **no SQL deployed to Supabase**.

`.github/workflows/sync-cards.yml` untouched; the `schedule:` trigger remains absent.
