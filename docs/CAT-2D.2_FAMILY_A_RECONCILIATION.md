# CAT-2D.2 — Family A provider identity reconciliation

**Status: DEPLOYED AND VALIDATED IN PRODUCTION; PR not yet merged.** 192 alias
rows are live, Phases C–G all passed, and the sync schedule remains paused. See
**§8a** for the production record, including the SQL Editor deployment finding
and the single-statement correction this PR now carries.

This document is the slice record. `CURRENT_STATE.md`, `DECISION_LOG.md` and
`ARCHITECTURE.md` are updated as a deliberate closeout step **after** the PR
merges — see §10.

Depends on **CAT-2D.1** (PR #12, merge `303ca4b`), which shipped the alias
schema, the two-sided no-chain trigger, the `card_identity_resolution` read
surface, the `cards_effective` exclusion and alias-aware resolution in both
consumers — with the alias table **empty**.

CAT-2D.2 is the first slice that puts rows in it.

---

## 1. Scope

Reconcile **Family A only**: provider-ID renames whose current TCGdex survivor
already exists in `public.cards`, so no sync run is required.

| Family | Obsolete | Survivor | Aliases |
|---|---|---|---|
| Shining Fates Shiny Vault | `swsh4.5-SV###` | `swsh4.5sv-SV###` | **122** |
| Crown Zenith Galarian Gallery | `swsh12.5-GG##` | `swsh12.5gg-GG##` | **70** |
| | | | **192** |

192 = 122 + 70, independently confirmed by production Phase A. The CAT-2D
design's Family A figure of **217** also counted Celebrations Classic
Collection; production has since shown that is a different evidence class — see
**§1a**.

**Explicitly out of scope and untouched:** Celebrations Classic Collection
(**§1a**), Trainer Galleries (Family B), TG set ingestion, the sync schedule, any
catalog sync, deletion of any `public.cards` row, any write to
`user_import_rows`, importer normalisers, fuzzy / cross-language / artwork-only
aliases, IV UUID printing identity, illustrator restoration, ownership semantics
beyond the resolution CAT-2D.1 already shipped, CAT-2B2, CAT-2C, and the
pre-existing OL-0C allowlist test debt.

---

## 1a. Celebrations was split out — on production evidence

An earlier revision of this slice proposed a third pair,
`cel25-CC###` → `cel25cc-CC###`, derived from the **survivor** side and assumed
to have a matching obsolete id. **Production Phase A refused it:**

```
FAIL A-GATE: derived Family A map holds 192 pairs, expected 217
             — {"swsh4.5":122,"swsh12.5":70}
```

A read-only query over `public.cards WHERE set_id = 'cel25'` showed why. The 25
historical Classic Collection rows are **not** stored as `cel25-CC001..CC025`.
They carry **legacy local ids** — the numbers of the printings they reproduce:

| Stored historical id | Name |
|---|---|
| `cel25-2A` | Blastoise |
| `cel25-4A` | Charizard |
| `cel25-15A1` | Venusaur |
| `cel25-17A` | Umbreon Star |
| `cel25-60A` | Tapu Lele GX |
| `cel25-88A` | Mew ex |

So the Celebrations transition changed the provider **set** *and* the provider
**numbering**. It fails **A2** (`normNum` equality) outright — `2a` and `cc001`
are different printings under the frozen normalisers — and it cannot lean on
**A4** either, because the numbers did not move, they were replaced.

**A2 was not loosened and no broad exception was added.** Dropping the number
requirement would reduce the admission rule to name equality plus a set-rename
pair, which is exactly the fuzzy matching CAT-2D §7.1 forbids — and several of
these names (`Blastoise`, `Charizard`, `Venusaur`, `Mew ex`) are ambiguous
across the wider catalog, so it would be unsound as well as against policy.

Celebrations is therefore its own evidence class, recorded in
**`docs/CAT-2D.3_CELEBRATIONS_IDENTITY_REMAP.md`** (design item only, not
implemented, not in this PR). Its 25 rows remain in `public.cards` **and** in
`cards_effective`, exactly as today — this slice changes nothing about them.

CAT-2D.2 is now, exactly, the **set-rename-with-stable-local-id** slice.

> **This is what fail-closed derivation is for.** The pattern selected
> candidates; production evidence refused the claim. No alias row was written,
> Phase B was never run, and the correction cost one refused Phase A run.

---

## 2. Evidence

### 2.1 How the alias set was derived

`scripts/cat2d2-build-family-a-evidence.mjs` probes TCGdex read-only and writes
`docs/cat-2d2-evidence/family-a-alias-set.csv` plus `manifest.json`. Every one
of the 192 pairs was individually observed on **2026-08-17**:

- **384 upstream probes.** Every obsolete id returned **404**; every survivor
  returned **200**.
- **Namespace departure confirmed per family.** `swsh4.5` now serves 73 cards
  and **no** `SV###`; `swsh12.5` serves 160 and **no** `GG##`. The whole
  numbered range left the parent set together and reappeared, intact and
  complete, under the new set id.
- Stored-row arithmetic agrees: CAT-0's per-set evidence records `swsh4.5` = 195
  (73 + 122) and `swsh12.5` = 230 (160 + 70).
- **Production independently confirmed both families.** Phase A's derivation
  reads `public.cards` and never touches this artifact; it returned
  `{"swsh4.5":122,"swsh12.5":70}`, so the stored obsolete rows really do carry
  the stable `SV###` / `GG##` local ids this slice depends on.

`manifest.json` carries the CSV's SHA-256; the migration stamps that same hash
into every `evidence` payload it writes.

The checksum is taken over **newline-normalised content**, and `.gitattributes`
pins the artifact to LF. Both are load-bearing: with `core.autocrlf=true` (the
Windows default, and this repository's setting) a byte hash would change on
checkout, and the hash the migration writes into production would stop matching
the file a reviewer is looking at.

### 2.2 The admission rule — and where it departs from the approved design

CAT-2D §3.4 rule 1 requires **equal Tier-1 identity**
(`normName`, `normSet(set_name)`, `normNum(local_id)`) between alias and
canonical.

**Family A cannot satisfy that rule, and this slice says so rather than working
around it.**

`sync-cards.mjs :: mapCardToRow` writes `set_name` from the set the provider
served the card under. These printings were ingested while they sat in the
*parent* set, so the obsolete rows carry `Shining Fates` / `Crown Zenith` while
the survivors carry the subset names. `normSet` of those differs, so the Tier-1
keys differ **by construction**.

That is also why Family A has never produced a Tier-1 collision and why the
CAT-2B1 guard has never refused these sets: the defect here is a duplicated
**printing**, not a duplicated identity key. Family B is the opposite case — the
TG subset generation kept the subset `set_name`, so Tier-1 equality does hold
there. Nothing in this slice relies on or changes that.

Family A therefore substitutes, **for the set component only**, an explicitly
enumerated and separately evidenced set-rename pair, and keeps the other two
components strictly:

| Rule | Requirement | Enforced |
|---|---|---|
| **A1** | inside an approved `(parent → canonical)` set pair, never inferred or wildcarded | migration §3 + §5 P1/P4 |
| **A2** | `normNum(local_id)` equal exactly — `normNum` does not strip leading zeros, so `SV1` ≠ `SV001` | migration §5 P6 |
| **A3** | `normName(name)` equal exactly, **stored row vs stored row** | migration §5 P5 |
| **A4** | the local-id namespace is absent from the parent set upstream | evidence generator, per family |
| **A5** | obsolete 404 / canonical 200, observed and dated | evidence generator, per pair; re-asserted in §5 P1 |

A1+A2+A3 alone would only be a same-name-same-number argument. **A4 is what
makes it a rename.** Name equality alone is explicitly insufficient, and no
cross-language, cross-printing or artwork-level equivalence is admitted.

> **Review note.** This is a deliberate, documented departure from CAT-2D §3.4
> rule 1 for Family A only. It is recorded in the manifest
> (`tier1_identity_equal: false`), in every alias row's `evidence`
> (`tier1_identity_equal`, `tier1_note`), and asserted by the test harness so it
> cannot be quietly reverted to a false claim of Tier-1 equality.

### 2.3 Two gates, not one

The artifact is an **allowlist**, not a matcher (CAT-2D §7.1). A pair that is
not on it cannot be created under any circumstance — and a pair that *is* on it
is still refused unless the migration proves it against `public.cards` at deploy
time:

- **P2** — a stored row inside an approved namespace that is not on the
  allowlist ⇒ refuse (the approval does not cover what is stored).
- **P3** — an allowlist entry with no stored row ⇒ refuse. This is the check
  that fires if the obsolete rows were stored as `swsh4.5-SV1` rather than
  `swsh4.5-SV001`. It is meant to fire loudly, not be worked around.
- **P5/P6** — normalised name and number equality, stored vs stored.
- **P7** — exact per-family counts, 122 / 70.
- **P10** — all 192 obsolete ids are in `cards_effective` today, so the
  expected delta really is 192.
- **P11** — artist reachability is preserved on every survivor (§5a).

The validation file re-derives the same map a **second time, independently**,
without reading the allowlist. Two derivations agreeing is the point; they are
deliberately not refactored into one.

### 2.4 Design questions closed

| # | Question | Status |
|---|---|---|
| **Q-1** | Does the active batch hold live-survivor ids alongside obsolete ones? | **Measured at deploy.** Validation Phase A computes `distinct_resolved_pred` and `collapse_pred` from real rows; Phase D asserts the RPC reproduces them exactly. |
| **Q-2** | `price_history` rows referencing obsolete ids | **Measured at deploy.** Phase A inventories all six mutable tables including `price_history`, which the original evidence pass omitted. |
| **Q-3** | Mutable-reference merge collisions | **Gated at deploy.** Phase A refuses if any exist, in any table, before the migration is run; migration §8 refuses again under lock. |
| **Q-5** | Do other `artistEditorial.js` ids reference obsolete namespaces? | **CLOSED — statically, now.** All 169 `id:` entries swept: exactly **one** hit, `swsh12.5-GG19`, exactly as predicted. Fixed in this PR and pinned by a test. |
| **Q-6** | Obsolete ids in `candidate_card_ids[]` | **Recorded at deploy, diagnostic only.** Never rewritten in either direction. |
| **Q-7** | Are the non-obsolete `card_extras` rows on survivor ids? | **Gated at deploy** by the `card_extras` collision scan (PK conflict). |

Q-4 and Q-8 are Family B / open-ended and out of scope here.

**Q-9 is partially forced open by this slice.** CAT-2D §2.6 left it
[UNVERIFIED] whether an artist page currently shows the obsolete copy, the
survivor, or both. Aliasing makes the survivor the only candidate, so the
artist-reachability gate (§5a) now *measures* the relevant half of Q-9 against
production and refuses if the answer is unsafe.

---

## 3. Fail-closed posture — stricter than CAT-2D §6.2

CAT-2D §6.2 permits **silent merges** for `card_favorites`,
`user_binder_cards`, `price_history` and `user_card_intent` when a user already
holds both the obsolete and the survivor row.

**This slice implements no merge branch at all.** Every collision, in every
table, refuses the whole transaction.

- a merge is the only operation in the CAT-2D design that destroys information
  (§10), and it would do so without a human ever seeing it;
- Q-3 predicts zero collisions, so failing closed is expected to cost nothing —
  and if that prediction is wrong, that fact is worth far more than an automatic
  resolution;
- refusing keeps the whole reference migration a single reversible `UPDATE` of
  `card_id`.

Resolving a collision, if one is ever reported, is a separate operator decision.

---

## 4. Mutable references

Migrated by `UPDATE` of `card_id` only — never `DELETE`, never `INSERT`, never
`ON CONFLICT`:

| Table | Unique key | Peer columns scanned | Expected Family A rows |
|---|---|---|---|
| `card_extras` | `(card_id)` | — | **2** (`swsh12.5-GG19`, `swsh12.5-GG69`) |
| `card_overrides` | `(user_id, card_id)` | `user_id` | **1** (`swsh12.5-GG19`, `override_type = owned`) |
| `price_history` | `(user_id, card_id, recorded_date)` | `user_id, recorded_date` | **unmeasured** — Phase A closes Q-2 |
| `card_favorites` | `(user_id, card_id)` | `user_id` | 0 expected |
| `user_card_intent` | `(user_id, card_id)` | `user_id` | 0 expected |
| `user_binder_cards` | `(binder_id, card_id)` | `binder_id` | 0 expected |

Expected counts come from the CAT-2D design's production evidence and are
**not** trusted: Phase A measures every one of them against live data, and the
migration re-counts under lock and refuses if the two disagree.

**Not scanned, deliberately:**

- `user_import_rows.card_id` / `.candidate_card_ids` — immutable historical
  evidence. Resolution happens at read time. Proved untouched by checksum in
  both the migration (§10, in-transaction) and Phase F.
- `user_binder_layout_items.binder_card_id` — references a *membership row id*,
  never a global card id (BP-3.1A). Structurally immune.
- `user_collection.owned_keys` — `name::num` / `name::set` keys, not card ids.
  Structurally immune to any id rename.

### `swsh12.5-GG19` must never be unowned

That override is the **sole** reason the printing is owned — it is not in the
active snapshot. The alias insert (§7) and the reference migration (§9) are in
**one transaction**, so no committed state exists in which the obsolete id has
left `cards_effective` but the survivor is not yet force-owned. Phase D10
re-checks it after deploy.

### The exact undo list is `public.cat2d2_pre_refs`

One row per migrated reference, carrying `(table_name, row_key, card_id)`.
`cat2d2_pre_capture` is a *different* table — catalog/ownership/OL-0D
fingerprints and the Phase A predictions — and cannot drive a reversal.

---

## 5. Serialization, and the Phase A → B drift refusal

CAT-2D.1 §2 made this binding on every later slice: the two-sided R1/R2 trigger
proves depth-1 topology only for *sequential* writers. The migration therefore
takes `share row exclusive` on `card_identity_aliases` **before reading any
alias row**, and on all six mutable-reference tables for the same reason — §8
proves "no collision exists" and §9 acts on that proof, so nothing may move in
between. Lock order is fixed and alphabetical.

**The locks do not span the two SQL Editor runs.** Phase A captures
`cat2d2_pre_refs`; the migration runs later, minutes or hours apart, with
nothing held in between. In that window a collector can favourite a card, save a
price point, set a hunt intent, add a binder row or clear an override.

Counting references under the locks was not enough: the migration would have
migrated whatever was there, and `cat2d2_pre_refs` — the undo list — would then
describe a different row set than the one that actually changed. A row added in
the window would be migrated and **not reversible from the capture**; a row
deleted in the window would sit in an undo list that would silently do nothing.

Migration **§6** closes this. Under the §1 locks, before a single alias row is
inserted or a single reference is migrated, it re-derives the current obsolete
reference set from the proven `cat2d2_map` — the same six branches, the same
per-table `row_key` shape as Phase A — and compares it to `cat2d2_pre_refs` as
an **exact set, in both directions**:

| Direction | Meaning | Result |
|---|---|---|
| `current EXCEPT pre` | a reference **appeared** after the capture | refuse, `errcode 40001` |
| `pre EXCEPT current` | a captured reference **vanished** | refuse, `errcode 40001` |
| cardinality | a duplicate hiding behind set semantics | refuse |

Totals alone are explicitly insufficient — one insert plus one delete leaves the
count identical while both endpoints are wrong — so the identity compared is the
full `(table_name, row_key, card_id)` triple. §8 additionally cross-checks its
per-table dynamic count against the §6 derivation.

Phase A is therefore a **hard prerequisite**: the migration refuses outright if
`cat2d2_pre_refs` does not exist. A drift refusal is not a defect to be worked
around — re-run Phase A and re-review.

---

## 5a. Artist-first gate — the survivor must not lose `artist_id`

Artist Page loads a curated artist's cards by **exact `public.cards.artist_id`**
(`cardService.fetchArtistCards`, the FK-only branch). Once the obsolete row
leaves the effective catalog, the survivor is the only row that can carry the
printing onto an artist page.

Migrating `card_extras` changes the survivor's **effective illustrator** —
`cards_effective.illustrator = coalesce(card_extras.illustrator_override,
cards.illustrator)` — but it does **not** touch `public.cards.artist_id`, which
only the sync writes. So a pair whose obsolete row carries an `artist_id` and
whose survivor does not would silently drop that printing off its artist's page.

| Obsolete `artist_id` | Canonical `artist_id` | Verdict |
|---|---|---|
| NULL | anything | allowed — nothing to lose |
| non-NULL | equal | allowed |
| non-NULL | NULL | **REFUSE** — reachability lost |
| non-NULL | different non-NULL | **REFUSE** — two conflicting claims |

Enforced in three places: validation **A-GATE 4** (pre-deploy, reports
`preserved` / `would_lose` / `would_conflict` plus the first 20 offenders),
migration **§5 P11** (in-transaction, under the locks), and validation
**Phase C10** (re-asserted post-deploy).

> **This gate may well fire.** CAT-0 per-set evidence records 100 of 122
> `swsh4.5sv` rows and 48 of 70 `swsh12.5gg` rows as
> having an illustrator but a **NULL `artist_id`**, while the obsolete
> `swsh12.5` rows that do carry one (GG19, GG69) are exactly the two with
> `card_extras` overrides. Whether their survivors carry `artist_id` is
> [UNVERIFIED] — CAT-2D §11 Q-9 left it open.
>
> **CAT-2D.2 does not repair `public.cards.artist_id`.** That is
> illustrator/artist restoration, explicitly out of scope. A refusal stops the
> deployment and becomes an evidence-backed follow-up decision. Neither SQL file
> writes `cards.artist_id`, and a test asserts that.

---

## 6. Deployment sequence

The established repository workflow: review → production Phase A gate → SQL
migration → C–G validation → merge PR / deploy app → production smoke → H
cleanup at the safe point.

| Step | Action | Gate |
|---|---|---|
| 1 | Independent review of PR #13 | — |
| 2 | `cat-2d2-2-family-a-validation.sql` **Phase A0** — read off the validation user | one active batch |
| 3 | Paste the UUID into the single marked `set_config` line; run **Phase A** | **REFUSES** on any merge collision, any artist-reachability loss or conflict, a non-empty alias table, or a derived map that is not 192 / 122 / 70 |
| 4 | **Phase B** — run `cat-2d2-1-family-a-reconciliation.sql` top to bottom, one transaction | §5 P1–P11, §6 drift refusal, §8, §10 all inside the transaction |
| 5 | **Phase C** — catalog, alias topology, artist gate | 192 evidence-backed rows, depth 1, `cards` unchanged, `cards_effective` −192 exactly, predicted survivor illustrator changes only, artist reachability intact |
| 6 | **Phase D** — ownership | `matchedRows` and `distinctMatchedCardIds` historical; resolved count and collapse equal Phase A's prediction; **no ownership added, none lost**; GG19 still owned |
| 7 | **Phase E** — OL-0D | rows and matched quantity conserved, distinct cards −collapse, catalog-missing does not regress, pagination/filter/sort valid |
| 8 | **Phase F** — mutable + untouched data | import evidence byte-identical, card_extras/card_overrides payloads unchanged, zero obsolete references remain |
| 9 | **Phase G** — security | the CAT-2D.1 ACL contract intact, now with real provenance to protect |
| 10 | Merge PR #13; deploy the application change | build green |
| 11 | Production smoke test | ownership, Owned Library, artist pages |
| 12 | **Phase H** — cleanup, at the safe point | **drop `cat2d2_pre_refs`, `cat2d2_pre_map`, `cat2d2_pre_capture`** — `cat2d2_pre_refs` holds user-owned card ids and must not remain in production |

Do not run step 4 if step 3 raised. Do not drop `cat2d2_pre_refs` before step 4
— the migration reads it.

**The app constant lands after the SQL, deliberately.** Between step 4 and step
10, `swsh12.5-GG19` no longer resolves, so the Asako Ito notable Altaria is
omitted with a console warning — the `expectName` guard *failing safe*, never
substituting a different card. That brief, cosmetic, self-healing gap is
accepted; splitting the constant into an earlier PR would buy nothing and cost a
review boundary. Nothing else in the application reads the obsolete id.

---

## 7. Rollback

Fully reversible; nothing is deleted and no schema object is created.

1. Reverse the reference migration — `UPDATE ... SET card_id = a.alias_card_id
   FROM card_identity_aliases a WHERE a.slice = 'CAT-2D.2'`, per table, under
   the same locks. Safe because §8 proved no user held both rows.
2. `DELETE FROM card_identity_aliases WHERE slice = 'CAT-2D.2'` — the 192
   obsolete rows reappear in `cards_effective` byte-identical, because they were
   never deleted.

**`public.cat2d2_pre_refs` is the exact undo list** — one row per migrated
reference, `(table_name, row_key, card_id)`, and §6 has *proven* it is exactly
the row set the migration changed. `cat2d2_pre_capture` is a different table
(catalog / ownership / OL-0D fingerprints and the Phase A predictions) and
cannot drive a reversal.

If a collector has created a conflicting row since the deploy, narrow the
reverse `UPDATE` with `cat2d2_pre_refs.row_key` — the migration's ROLLBACK
section carries a worked example per key shape. Export the table before Phase H
if a reversal is still plausible.

---

## 8. Validation performed in this PR

Static only — the PR itself touches no database.

| Check | Result |
|---|---|
| `node scripts/cat2d2-family-a-alias-set.test.mjs` | **148 passed, 0 failed** |
| `node scripts/cat2d2-owned-ids-collapse.test.mjs` | **32 passed, 0 failed** |
| `node scripts/cat2d2-build-family-a-evidence.mjs --check` (384 live probes) | **ok — committed artifact matches upstream** |
| `node scripts/cat2d1-owned-ids-contract.test.mjs` | 33 passed, 0 failed |
| `node scripts/ol0d-active-snapshot-read-model.test.mjs` | 38 passed, 0 failed |
| `node scripts/ol2b-verified-matching.test.mjs` | all 5 groups passed |
| `node sync/catalog-identity-guard.test.mjs` | 27 passed, 0 failed |
| `node sync/catalog-index-source.test.mjs` | 14 passed, 0 failed |
| `npm.cmd run build` | ✓ built |
| `node scripts/ol0c-import-snapshot.test.mjs` | 80 passed, **3 failed — pre-existing** |

The three OL-0C failures are the known allowlist test debt (`expects 33 entries,
allowlist has 34`). Verified identical on a clean `main` tree via `git stash`;
declared out of scope for this slice and left untouched.

---

## 8a. Production deployment record

Deployed and independently validated. Figures below are the production run;
no validation-user identifier is recorded here or anywhere else in the repo.

**Phase A — gate passed**

| Measure | Value |
|---|---|
| Derived map | **192** (`swsh4.5` 122, `swsh12.5` 70) |
| Obsolete ids in `cards_effective` | 192 |
| Canonical survivors in `cards_effective` | 192 |
| Mutable references to migrate | **3** — `card_extras` 2, `card_overrides` 1 |
| Merge collisions | **0** |
| Obsolete rows carrying `artist_id` | 24 — **24 preserved, 0 would-lose, 0 conflicts** |
| Ownership prediction | `matchedRows` 5572, `distinctMatched` 4998, `distinctResolved` 4998, **collapse 0** |

The artist gate — the one most likely to refuse — passed cleanly: all 24
obsolete rows carrying an `artist_id` have a survivor carrying the same one.

**Phase B — deployment-tool finding**

The migration as originally committed used a top-level `begin;`, then
`create temporary table ... on commit drop`, then further **top-level**
statements referencing those temp tables, then `commit;`.

In the Supabase SQL Editor those top-level statements do **not** behave as one
persistent transaction/session for this workflow. A harmless reproduction
confirmed it: the temp tables were gone before the later statements ran.

The durable CAT-2D.2 changes had nonetheless landed correctly —
`card_identity_aliases` = 192 (all `slice = 'CAT-2D.2'`), `cards_effective` =
23,588, the GG19 and GG69 `card_extras` rows migrated, the GG19 owned override
migrated. **The migration was therefore neither re-run nor rolled back**, and
independent post-deploy validation was run instead of guessing.

**Phases C–G — all passed**

| Phase | Result |
|---|---|
| C — catalog / alias topology / artist gate | ✓ |
| D — ownership | ✓ |
| E — OL-0D core | ✓ |
| E7 — sort / filter / pagination smoke | ✓ |
| F — mutable + untouched-data integrity | ✓ |
| G — ACL / security | ✓ |

Production state is accepted.

**The correction carried in this PR**

The committed migration is now **one top-level statement** — a single
`do $cat2d2$ ... $cat2d2$;`. There is no top-level `begin;`/`commit;`, every
temp table is created and consumed inside that one statement, and the locks,
proofs, alias insert, reference migration and final invariants all run in one
server-side transaction. Any exception anywhere in the block aborts the whole
statement, and there is deliberately no `exception when ...` handler that could
let execution continue past a failed proof.

This is a **reproducibility fix for the artifact**, not a change to production —
production is already migrated and correct, and this corrected file must not be
run against it (P9 would refuse it anyway: the Family A ids are already
aliased). A structural test asserts the single-statement shape so the file
cannot regress.

---

## 9. Slice numbering — resolved

| Slice | Scope | Status |
|---|---|---|
| **CAT-2D.1** | Alias schema, `cards_effective` exclusion, dark read-path resolution | deployed (PR #12) |
| **CAT-2D.2** | SV + GG set rename with a **stable local_id** — 192 aliases | **deployed and validated** |
| **CAT-2D.3** | Celebrations historical identity + numbering remap | design item only — `docs/CAT-2D.3_CELEBRATIONS_IDENTITY_REMAP.md` |
| **CAT-2D.4** | Trainer Galleries / Family B | blocked on the maintenance-ingestion capability (CAT-2D §7.3) |

The CAT-2D design doc originally numbered Trainer Galleries CAT-2D.3 (§8
Phase 3); it has been corrected to **CAT-2D.4**. Its §7.3 capability
requirements are unchanged and still apply.

---

## 10. Remaining closeout — after the PR merges

- update `CURRENT_STATE.md`: aliases 0 → **192**, `cards_effective`
  23,780 → **23,588**, `cards` unchanged at **23,780**, sync schedule still
  **paused**;
- record in `DECISION_LOG.md`:
  - CAT-2D §3.4 rule 1 is satisfied for this slice by A1+A2+A3+A4+A5 rather
    than by Tier-1 equality;
  - CAT-2D §6.2's silent-merge branches were replaced by a fail-closed refusal;
  - Celebrations was split out on production evidence (§1a), superseding the
    design doc's Family A figure of 217;
  - the slice numbering above;
  - the SQL Editor deployment finding (§8a) — future migrations are authored as
    a single top-level statement.
