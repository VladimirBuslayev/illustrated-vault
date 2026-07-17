# OWN-0B — Authenticated Ownership Cutover — Closeout

**Status:** Complete  
**Production date:** 2026-07-17  
**Predecessor:** OWN-0A — Authoritative Snapshot Ownership Read  
**Production:** `illustratedvault.com`, Vercel from `main`

## 1. Objective

Replace loose authenticated `owned_keys` inference with the active import
snapshot's exact canonical card IDs, while preserving explicit manual overrides,
failing closed when ownership authority is unavailable, and leaving Owned Library
and SharedBinder within their accepted boundaries.

OWN-0B was a containment cutover, not an ownership-system rewrite. It did not
change the importer, matcher, snapshot schema, RPC contract, card catalog,
SharedBinder, or Owned Library read model.

## 2. Production changes

Files changed:

- `src/App.jsx`
- `src/services/cardAdapter.js`
- `src/services/cardService.js`

No SQL, schema, RPC, importer, matcher, catalog, override-data, SharedBinder, or
Owned Library changes were required.

### 2.1 Central authenticated ownership selector

The authenticated App `checkOwned` closure now uses one strict rule:

**Canonical card**

`force-missing → force-owned → active snapshot canonical ID → missing`

**External-set or unknown card**

`force-missing → force-owned → missing`

There is no authenticated `owned_keys` fallback.

`src/utils/keys.js` and SharedBinder's separate `isCardOwned` closure remain
unchanged so the share-token surface stays outside this cutover.

### 2.2 Ownership authority gate

Ownership-dependent authenticated surfaces render only when
`snapshotAuthority === "ready"`:

- Dashboard
- Artist Page
- Hunt Board
- Hunt Show
- Artist Directory
- Binder
- Binder Plan detail
- their CardModal paths

Exempt surfaces:

- Owned Library, which uses OL-0D directly;
- Planned Binders index, which does not compute ownership.

Authority states:

- `loading` — gated neutral loading state; retained prior Set is not shown;
- `ready` — strict ownership renders;
- `no_active_batch` — blocked CSV-import onboarding, not an empty collection;
- `error` — generic retry state;
- `multiple_active_batches` — fail-closed safety state.

Retry invokes the authoritative read directly and does not increment
`importEpoch`. The requested `view`, `artistSlug`, and `planId` remain unchanged
while gated.

### 2.3 Ownership namespace contract

Every canonical `cards_effective` card adapted through `supaRowToCard` receives:

`ownershipNamespace: "canonical"`

The TCGdex set branch receives:

`ownershipNamespace: "external-set"`

Missing or unknown namespaces fail conservatively to override-only / missing.

Direct inspection confirmed both Planned Binder card producers —
`fetchCardsByIds` and `searchCatalogCards` — query `cards_effective`, preserve
canonical IDs, adapt through `supaRowToCard`, and use no card-object cache.
Therefore the adapter is the single canonical marker point and
`binderService.js` required no change.

### 2.4 Cache compatibility

Live cache prefixes were advanced:

- canonical artist cards: `pb8_supa_` → `pb9_supa_`;
- external-set cards: `pb6_cards_` → `pb7_cards_`.

Both cache-hit paths normalize the ownership namespace so an unmarked object
cannot escape. Settings cache clearing removes the current prefixes and retained
legacy prefixes before refetching.

## 3. Scope preserved

OWN-0B did not:

- change `get_active_snapshot_owned_card_ids()`;
- change `get_active_import_snapshot_read_model`;
- change import matching, activation, or reconciliation;
- change `user_collection.owned_keys` persistence;
- migrate, delete, or rewrite manual overrides;
- add Pokémon GO / external-set mapping;
- change SharedBinder ownership;
- change Owned Library quantity or ownership semantics;
- split or broadly refactor `App.jsx`.

## 4. Preview validation

Vercel Preview built successfully. A temporary Preview-only runtime export
compared the old loose predicate with the new strict predicate over the actual
signed-in in-memory card and ownership state.

Audit artifact: `own-0b-delta-2026-07-17.csv`

Results:

- rendered cards audited: **3,295**;
- namespace: **3,295 canonical / 0 external-set**;
- old loose-owned: **1,461**;
- new strict-owned: **1,344**;
- false-positive owned verdicts removed: **168**;
- snapshot true-positive owned verdicts added: **51**;
- net visible ownership change: **−117**;
- unchanged verdicts: **3,076**;
- unexplained changes: **0**.

Manual override validation:

- force-owned rows: **96**;
- force-missing rows: **29**;
- total override-controlled rows: **125**;
- override-controlled verdict changes: **0**.

Snapshot validation:

- every snapshot-positive card not force-missing remained owned;
- no external-set inference occurred;
- both allowed change directions were separately explained:
  `owned_keys_false_positive_removed` and `snapshot_true_positive_added`.

## 5. Expedition Pidgeot evidence

Both Tomokazu Komiya Expedition Pidgeot canonical IDs remain absent from the
active snapshot:

- `ecard1-59` — no override; strict result is missing;
- `ecard1-23` — explicit force-owned override; strict result remains owned.

This confirms the intended precedence. Snapshot absence removes loose inferred
ownership, while an exact user override remains authoritative.

## 6. Legacy override evidence

The previously inspected 17 noncanonical override rows remain untouched.
All were absent from:

- `cards`;
- `cards_effective`;
- the active snapshot;
- currently rendered external-set card IDs.

They are inert today. Cleanup or remapping is deferred until there is direct
identity evidence; OWN-0B did not treat their ID shapes as proof of equivalence.

## 7. Production validation

- implementation built on a dedicated Vercel Preview branch;
- Preview build passed;
- delta audit passed with `unexplained = 0`;
- temporary `window.__ownDeltaExport` instrumentation was removed before merge;
- final production files contain no Preview audit function, global, or filename token;
- branch merged to `main`;
- Vercel production deployment passed;
- production smoke test passed.

## 8. Rollback

The functional rollback is limited to the three production files:

1. restore App's authenticated closure to
   `isCardOwned(card, ownedKeySet, manualOwned, manualMissing)`;
2. remove the authority gate and AuthorityScreen;
3. restore the prior inline OWN-0A read effect if required;
4. revert ownership namespace annotations and cache-prefix changes.

OWN-0A's RPC and read contract remain valid and require no database rollback.
No data migration was performed.

## 9. Remaining boundaries

- SharedBinder still uses its separate share-token loose ownership path.
- No external-set path renders today; a future set path is override-only until a
  canonical mapping is independently validated.
- The 17 noncanonical overrides remain inert and deferred.
- Artwork identity and collection-goal satisfaction remain separate from exact
  physical-printing ownership.

## 10. Next recommended slice

**OL-2C.1 — Image Resilience**

Ownership truth is now stable across the authenticated product. The next archive
integrity risk is incorrect or unavailable imagery. This slice should be narrow
and evidence-led:

- detect missing/broken canonical images;
- preserve the exact physical printing as the identity;
- never silently substitute another printing's image;
- explicitly label any approved proxy image;
- avoid catalog-source rewrites until CAT-0.

Sequence after OL-2C.1:

`CAT-0 Catalog Source & Coverage Audit → next evidence-backed catalog slice →
OWN-1 Artwork vs Printing ownership policy`

## 11. Final verdict

### COMPLETE — PRODUCTION VALIDATED

OWN-0B successfully replaced loose authenticated ownership inference with exact
active-snapshot canonical ownership plus explicit overrides, without widening the
slice into import, catalog, share, or artwork-policy work.
