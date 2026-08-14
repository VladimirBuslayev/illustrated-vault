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

**Both conditions above are now resolved.** The two paragraphs describe the state CAT-2D.0 found,
not the state it leaves. The ownership function's exact production body is committed at the
canonical path, and `cards_effective`'s live definition is recorded with `artist_id`. **CAT-2D.1 has
no remaining SQL-source blocker.**

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
| 1 | `get_active_snapshot_owned_card_ids()` | **RECOVERED IN FULL** — exact production body | `docs/sql/own-0a-1-active-snapshot-owned-card-ids.sql` |
| 2 | `get_active_import_snapshot_read_model(...)` | **No drift detected** (property/semantic level) | `docs/sql/ol-0d-4-active-snapshot-performance-hardening.sql` — unchanged |
| 3 | `cards_effective` | **CORRECTED** — committed text was stale | `docs/sql/cat-2d0-production-baseline.sql` §3 |
| 4 | `illustrator_directory` | **Already current** | `docs/sql/a-d2a-2-illustrator-directory.sql` — unchanged |

### 3.1 `get_active_snapshot_owned_card_ids()` — recovered in full

The exact live `pg_get_functiondef` body is now committed verbatim at the canonical path the
OWN-0A closeout referenced. It was transcribed byte-for-byte and **verified by diff against the
introspection capture: zero differences, matching SHA256** (`15527edf…7ab2`). Nothing was authored,
inferred, reformatted or "improved"; the only additions to the file are comments outside the
function body.

Recovered properties: zero-arg signature, `returns jsonb`, `language plpgsql`, `STABLE`,
**`SECURITY DEFINER`**, `SET search_path TO ''`, `proacl`
`{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}` — EXECUTE
only, all four roles.

The body confirms every property previously known only from prose: `auth.uid()` scoping, no
`cards_effective` join, the owned predicate `match_status = 'matched' AND card_id IS NOT NULL`,
fail-closed handling of zero and multiple active batches, and header reconciliation raising
`errcode 23514`.

`src/services/ownedLibraryService.js:287-362` enforces eight assertions on the `ready` payload; all
are satisfied by the recovered body.

**Three things the real body settles that the description could not** — recorded for CAT-2D.1:

1. **The `23514` reconciliation is safe under alias resolution.** It compares `count(*)` of matched
   rows against `v_batch.matched_rows` — a *row* count against the immutable batch header. Distinct
   card ids play no part. Alias resolution collapses ids, never rows, so it cannot trip this
   exception. The header contract is untouched by CAT-2D.1.
2. **The three-count change is local and small.** All three quantities already come from one scan;
   resolution adds a left join to the alias map and one more aggregate.
3. **The client assertion is the only thing that breaks.** `ownedLibraryService.js:343` enforces
   `ownedCardIds.length === distinctMatchedCardIds`. Under collapse the array shrinks while that
   count does not, so the wrapper throws and ownership enters the fail-closed error state. The
   function and the wrapper must change in the **same** slice.

**Handoff note.** The exact body was present in the original production introspection throughout; it
simply did not reach the implementing context on the first pass. A-1 was a transcription/handoff
gap, **not** a production evidence gap — the introspection was complete.

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

`proacl`: `{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}` —
EXECUTE only, all four roles. Identical grant shape to the ownership RPC; the meaningful difference
between the two functions is `prosecdef`, not their ACL.

**Equivalence status, stated precisely:** the exact production body **is** present in the captured
introspection output. Repo equivalence was verified at the **property/semantic** level — every
property above matches `ol-0d-4`. A **literal byte comparison was not performed** in CAT-2D.0, and
`ol-0d-4` is deliberately retained as the single canonical repo body rather than duplicated here.
Low risk and non-blocking; closable at any time with one text diff. Tracked as A-2 in §6.

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

| # | Item | Status | Effect |
|---|---|---|---|
| A-1 | `get_active_snapshot_owned_card_ids()` body | **CLOSED** — exact production body committed, diff-verified byte-identical (SHA256 `15527edf…7ab2`). Was a transcription/handoff gap, not a production evidence gap. | None. **No longer blocks CAT-2D.1.** |
| A-2 | `get_active_import_snapshot_read_model` verified at property/semantic level, not byte level | **Open, non-blocking** | Low risk. The exact body exists in the introspection capture; `ol-0d-4` is retained as the single canonical repo body. One text diff closes it whenever desired. |
| A-3 | View and function ACLs | **CLOSED** — all four objects' ACLs and both views' `reloptions` recovered and recorded | None. |
| A-4 | `card_extras` and `cards` not introspected | **Open, out of scope** | Outside CAT-2D.0's four-object scope. `card_extras`' `ON DELETE CASCADE` is already documented in the CAT-2D design. |

**No remaining blocker to starting CAT-2D.1.** A-2 and A-4 are recorded and non-blocking.

Recovered ACLs, for the record:

| Object | `relacl` / `proacl` | Notes |
|---|---|---|
| `cards_effective` | `{postgres,anon,authenticated,service_role}=arwdDxtm/postgres` | `reloptions ["security_invoker=true"]` |
| `illustrator_directory` | `{postgres,anon,authenticated,service_role}=arwdDxtm/postgres` | `reloptions ["security_invoker=true"]` |
| `get_active_snapshot_owned_card_ids()` | `{postgres,anon,authenticated,service_role}=X/postgres` | EXECUTE only |
| `get_active_import_snapshot_read_model(...)` | `{postgres,anon,authenticated,service_role}=X/postgres` | EXECUTE only |

The views' full privilege sets are not a privilege escalation: both are `security_invoker`, so every
read executes with the caller's own permissions against the underlying tables, where RLS governs
visibility.

---

## 7. Files

| File | Change |
|---|---|
| `docs/sql/cat-2d0-production-baseline.sql` | **new** — recovered production definitions for `cards_effective` and `illustrator_directory`; pointers for the two functions |
| `docs/sql/own-0a-1-active-snapshot-owned-card-ids.sql` | **new** — **exact executable production baseline**: the live `pg_get_functiondef` body verbatim, plus recovered metadata, client-observed contract and CAT-2D.1 notes as comments outside the function |
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
