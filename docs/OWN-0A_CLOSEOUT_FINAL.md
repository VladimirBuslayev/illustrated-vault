# OWN-0A — Authoritative Snapshot Ownership Read — Closeout

**Prepared:** July 2026
**Status:** COMPLETE — deployed and validated
**Parent initiative:** OWN-0 — Ownership Truth Containment
**Successor slice:** OWN-0B — Ownership cutover (not started)

---

## 1. Objective and scope

OWN-0A added and **dark-loaded** the active import snapshot's exact set of canonical owned-card
IDs into the authenticated owner runtime. The read returns the active batch's complete distinct
set of matched canonical `card_id` values — the printing-exact ownership source that OWN-0B will
consume.

OWN-0A intentionally made **no visible ownership change**. It did **not** repoint `checkOwned`,
and it did not alter `isCardOwned`, manual overrides, `owned_keys`, import matching, the catalog,
SharedBinder, or Pokémon GO behavior. The authoritative Set and its authority state are held for
validation/telemetry only; nothing in any render path reads them in this slice.

Scope was authenticated owner surfaces only.

---

## 2. Deployed changes

- **`get_active_snapshot_owned_card_ids()` RPC** — read-only, `SECURITY DEFINER`,
  `search_path=''`, `auth.uid()`-scoped. Returns, atomically for the single active batch, the
  distinct sorted matched canonical `card_id` array plus minimal reconciliation
  (`distinctMatchedCardIds`, `matchedRows`). No `cards_effective` join. Fails closed on more than
  one active batch (`multiple_active_batches`) and on a header/scan mismatch (`errcode 23514`);
  returns explicit `no_active_batch` and `error` (`no_auth`) states. Owned-row predicate is
  byte-identical to the validated Owned Library read model: `match_status='matched' AND card_id
  IS NOT NULL`, grouped by `card_id`.
- **Strict `fetchActiveSnapshotOwnedCardIds()` service wrapper** — returns a `Set` on `ready`,
  preserves PostgREST error fields on throw, enforces `ownedCardIds.length ===
  distinctMatchedCardIds`, `Set size === distinctMatchedCardIds`, `matchedRows >= distinct`, and
  no duplicate IDs. Never soft-fails to an empty owned set; non-ready states are returned
  explicitly.
- **App authority state and canonical-ID Set** — `snapshotOwnedIds` (Set), `snapshotAuthority`
  (`loading` | `ready` | `no_active_batch` | `multiple_active_batches` | `error`), and
  `snapshotOwnedBatchId`.
- **Refresh on `importEpoch`** — the read runs on sign-in and after every settled CSV import.
- **Supersession and batch-bound replacement** — a per-request counter guards against stale
  in-flight responses; on `ready`, the Set is replaced wholesale for its `batchId` (never merged,
  never retained across a batch change).
- **Terminal invalidation** — `multiple_active_batches`, `error`, and thrown/transport errors
  physically clear the Set and null the batch ID before setting authority; `no_active_batch`
  clears as well. The prior Set is retained only during `loading`.
- **No new index** — the existing `uir_batch_status_idx` serves the read; performance evidence
  (§6) showed no additional index is justified.

**Deployed files:**
- `own-0a-1-active-snapshot-owned-card-ids.sql` (SQL migration)
- `src/services/ownedLibraryService.js`
- `src/App.jsx`

---

## 3. Production validation evidence

- Active batch: `1dd67dd6-15fb-4452-8edd-3626681e2a1d`
- Matcher version: `ol2b-1`
- Matched rows: 5,307
- Distinct canonical owned IDs: 4,776
- Stored / positive / actual rows: 5,969 / 5,969 / 5,969
- Nonpositive stored rows: 0
- Catalog available: 4,776
- Catalog missing: 0
- No users with multiple active batches
- Deployed read-model distinct count equals OWN-0A count: 4,776 = 4,776
- RPC authenticated production result:
  - state `ready`
  - batch ID correct (`1dd67dd6-15fb-4452-8edd-3626681e2a1d`)
  - owned ID length 4,776
  - distinct matched 4,776
  - matched rows 5,307

---

## 4. OL-2B reconciliation

- Baseline distinct (OL-2A batch `dd330490-081a-4bc7-8a65-a4f43c554469`): 4,769
- Active distinct (OL-2B batch `1dd67dd6-15fb-4452-8edd-3626681e2a1d`): 4,776
- Added: 7
- Removed: 0
- Net: +7
- Eight recovered source rows, because `2024sv-12` appeared twice
- All seven added canonical IDs belong to McDonald's Collection 2024:
  `2024sv-4`, `2024sv-5`, `2024sv-8`, `2024sv-11`, `2024sv-12`, `2024sv-14`, `2024sv-15`

This is strong reconciliation evidence consistent with the approved OL-2B alias recovery
(the single Tier-A alias *McDonald's Promos 2024 → McDonald's Collection 2024*).

---

## 5. Ownership-truth evidence

- Both Komiya Expedition Pidgeot IDs are absent from the active snapshot: `ecard1-23`, `ecard1-59`
- Komiya snapshot-owned positive control: 185 exact cards

This confirms the authoritative read excludes both Expedition Pidgeot candidate printings associated with the observed false-positive ownership issue, while retaining true snapshot-owned Komiya cards.

---

## 6. Performance evidence

- Bitmap Index Scan on `uir_batch_status_idx`
- Bitmap Heap Scan
- HashAggregate
- 5,307 matched rows scanned
- 4,776 distinct IDs returned
- 129 shared buffer hits
- 123 heap blocks
- 465 kB aggregation memory
- Execution time approximately 7.6 ms
- No sequential scan
- No additional index justified

The repeated timing harness was not retained because of Supabase SQL Editor instability, but the
direct plan and the full payload query both succeeded.

---

## 7. Runtime and product validation

- Vercel deployment passed
- Application loaded successfully
- No visible ownership behavior changed
- `checkOwned` and `isCardOwned` remained unchanged
- OWN-0A remains a dark-loaded authority input only

OWN-0A corrected no additional visible surface. Owned Library remains on its existing snapshot-based read path; the other authenticated collection surfaces continue using the current `checkOwned` path until OWN-0B.

---

## 8. Deferred findings for OWN-0B (recorded, not solved)

- 17 manual overrides are outside `cards_effective`.
- At least two are Pokémon GO / TCGdex IDs.
- The remaining legacy/alternate override IDs require classification.
- Pokémon GO set-path cards use a different ID namespace.
- SharedBinder remains an unresolved external ownership boundary.
- OWN-0B must define the strict authenticated ownership cutover, override handling, and the
  loading / error / no-snapshot rendering behavior.
- No `owned_keys` fallback is permitted.

---

## 9. Rollback

- Revert `src/App.jsx`.
- Revert `src/services/ownedLibraryService.js`.
- Drop `public.get_active_snapshot_owned_card_ids()`.
- No data restoration or migration rollback required.
- `owned_keys`, overrides, imports, snapshots, matcher, catalog, and SharedBinder data were not
  modified.

Because the App changes are additive and unconsumed, and the RPC is read-only and unreferenced by
any other object, rollback is clean in either order.

---

## 10. Final verdict

OWN-0A is **complete, deployed, and validated**.

The authoritative exact-printing snapshot ownership set is available in the authenticated owner
runtime but is **not yet used for visible ownership decisions**.

OWN-0B is the next ownership slice, but implementation must not begin until its architecture
resolves the mixed override namespaces and the Pokémon GO set-path boundary.

---

## Appendix — filing metadata

**Recommended filename:** `OWN-0A_CLOSEOUT.md`

**Suggested commit message (if committed to GitHub):**

```
docs(OWN-0A): closeout — authoritative snapshot ownership read complete

Record OWN-0A as deployed and validated: get_active_snapshot_owned_card_ids()
RPC + strict service wrapper + dark-loaded App authority state/Set, refreshed on
importEpoch with batch-bound replacement and terminal invalidation. Production
validation on active batch 1dd67dd6 (ol2b-1): state=ready, 4776 distinct owned
IDs / 5307 matched rows; OWN-0A count == read-model distinct (4776=4776);
OL-2B delta +7/-0 (McDonald's Collection 2024); Komiya Expedition Pidgeot ids
(ecard1-23, ecard1-59) absent; 185-card Komiya positive control. No visible
ownership change; checkOwned/isCardOwned untouched. Cutover deferred to OWN-0B.
```

**Continuity block for `CURRENT_STATE.md`:**

```
### OWN-0 — Ownership Truth Containment

OWN-0A (Authoritative Snapshot Ownership Read): COMPLETE — deployed and validated.
Added get_active_snapshot_owned_card_ids() (read-only, SECURITY DEFINER, auth.uid()-scoped,
fail-closed on multi-active/header mismatch) and a strict fetchActiveSnapshotOwnedCardIds()
wrapper (returns a Set; never soft-fails). App dark-loads the active snapshot's exact distinct
matched canonical card_id set + authority state (loading|ready|no_active_batch|
multiple_active_batches|error), refreshed on importEpoch with supersession + batch-bound
wholesale replacement + terminal invalidation. No new index. Deployed files:
own-0a-1-active-snapshot-owned-card-ids.sql, src/services/ownedLibraryService.js, src/App.jsx.
Production (active batch 1dd67dd6-15fb-4452-8edd-3626681e2a1d, matcher ol2b-1): state=ready,
4,776 distinct owned IDs, 5,307 matched rows, catalog 4,776 available / 0 missing, OWN-0A count
== read-model distinct (4,776). OL-2B reconciliation +7/-0 (McDonald's Collection 2024:
2024sv-4/5/8/11/12/14/15). Komiya Expedition Pidgeot ecard1-23 and ecard1-59 absent; 185-card
Komiya positive control. checkOwned/isCardOwned UNCHANGED — this is a dark authority input only;
no visible ownership change.

Deferred to OWN-0B: strict authenticated ownership cutover (repoint checkOwned; no owned_keys
fallback), override-namespace handling (17 overrides outside cards_effective; >=2 Pokémon GO/
TCGdex; remainder need classification), Pokémon GO set-path ID-namespace boundary, SharedBinder
external ownership boundary, and loading/error/no-snapshot rendering behavior. OWN-0B
implementation must not begin until its architecture resolves the override namespaces and the
Pokémon GO set-path boundary.
```

---

*Illustrated Vault — Owned Library initiative. This document supersedes prior conversation
context regarding OWN-0A. No implementation was performed in producing this closeout.*
