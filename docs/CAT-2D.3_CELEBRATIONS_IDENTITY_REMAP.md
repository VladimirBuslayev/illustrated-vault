# CAT-2D.3 — Celebrations Classic Collection historical identity remap

**Status: design item only. Nothing is implemented. No SQL exists. Do not
implement this in the CAT-2D.2 PR.**

This document records a follow-up split out of CAT-2D.2 on production evidence.
It is a scope record and an evidence brief, not a design — the design work has
not been done.

> ### CAT-2D slice numbering — resolved
>
> | Slice | Scope | Status |
> |---|---|---|
> | **CAT-2D.1** | Alias schema, `cards_effective` exclusion, dark read-path resolution | **deployed** (PR #12) |
> | **CAT-2D.2** | SV + GG set rename with a **stable local_id** — 192 aliases | **deployed and validated** |
> | **CAT-2D.3** | **Celebrations historical identity + numbering remap** — this document | design item only |
> | **CAT-2D.4** | Trainer Galleries / Family B | blocked on the maintenance-ingestion capability |
>
> The CAT-2D design doc originally numbered Trainer Galleries CAT-2D.3 (§8
> Phase 3). That has been corrected to **CAT-2D.4** in the design doc; the
> capability requirements in its §7.3 are unchanged and still apply, and Family
> B remains blocked on them.

---

## 1. Why this is not part of CAT-2D.2

CAT-2D.2 originally proposed three Family A rename pairs. Production Phase A
refused:

```
FAIL A-GATE: derived Family A map holds 192 pairs, expected 217
             — {"swsh4.5":122,"swsh12.5":70}
```

A read-only query over `public.cards WHERE set_id = 'cel25'` explained it. The
25 historical Classic Collection rows are **not** stored as
`cel25-CC001..CC025`. They carry **legacy local ids** — the numbers of the
original printings they reproduce:

| Stored historical id | Name | Current survivor |
|---|---|---|
| `cel25-2A` | Blastoise | `cel25cc-CC001` |
| `cel25-4A` | Charizard | `cel25cc-CC002` |
| `cel25-15A1` | Venusaur | `cel25cc-CC003` |
| `cel25-17A` | Umbreon Star | *(to be established)* |
| `cel25-60A` | Tapu Lele GX | `cel25cc-CC025` |
| `cel25-88A` | Mew ex | *(to be established)* |

Six of twenty-five are known from the production probe. The survivor column
above is **inference from the CAT-2D.2 upstream artifact by name**, and is
recorded here as a starting point for evidence gathering — **not** as an
approved mapping. Nothing in this table may be used to create an alias.

So the Celebrations transition changed **both** the provider set id **and** the
provider numbering. That is a different defect class from the one CAT-2D.2
handles.

---

## 2. Why the CAT-2D.2 admission rule cannot be stretched to cover it

CAT-2D.2's rules are A1–A5 (see `docs/CAT-2D.2_FAMILY_A_RECONCILIATION.md` §2.2).
Celebrations fails **A2** outright:

> **A2** `normNum(local_id)` equal, exactly. `normNum` lowercases, trims and
> cuts at the first `/`; it does **not** strip leading zeros or letters. `2a` and
> `cc001` are different printings under the frozen normalisers.

It also cannot lean on **A4** in the same way. A4 works for Shining Fates and
Crown Zenith because the *entire numbered namespace* left the parent set intact
and reappeared complete under the new set id — the range itself is the evidence
of a rename. The Celebrations numbers did not move; they were **replaced**.

**A2 must not be loosened, and no broad exception may be added.** Dropping the
number requirement would reduce the admission rule to name equality plus a
set-rename pair, which is precisely the fuzzy matching CAT-2D §7.1 and
`AGENTS.md` forbid. Several Celebrations names are also ambiguous across the
wider catalog (`Blastoise`, `Charizard`, `Venusaur`, `Mew ex`), so name-based
pairing here is not merely against policy, it is unsound.

---

## 3. What CAT-2D.3 would have to establish

Treated as its **own evidence class**, not an extension of Family A:

1. **Enumerate the exact 25 stored historical ids** from `public.cards WHERE
   set_id = 'cel25' AND id NOT IN (the 25 real Celebrations base-set rows)` —
   read-only, no assumptions from the survivor side. The base set and the
   Classic Collection both live under `set_id = 'cel25'`, so the partition must
   be established from data, not from a pattern.
2. **Map each one individually** to its current survivor. Twenty-five
   hand-checked pairs, each recorded with its own evidence.
3. **No fuzzy matching.** No name-only pairing, no numeric heuristic, no
   "obviously the same card".
4. **Independent corroboration per pair, before any alias insert.** At minimum
   an upstream 404/200 observation on both ids plus a second, independent
   confirmation of the pairing (e.g. the original set and number the reprint
   reproduces, matched against the survivor's own metadata).
5. **Reuse everything CAT-2D.2 already proved**: the alias schema and two-sided
   no-chain trigger, the serialized-write requirement, the exact Phase A → B
   reference-set drift refusal, fail-closed collision handling, the both-sides
   unaffected-checksum domain, positive survivor `card_extras` validation, the
   artist reachability gate, immutable `user_import_rows`.
6. **A new admission rule set**, explicitly named and documented, that states
   what replaces A2 — and states honestly that it is a weaker structural claim
   backed by stronger per-pair evidence.

---

## 4. Containment

CAT-2D.3 is **not** started. Until it is designed, reviewed and approved:

- the 25 obsolete `cel25-*` rows remain in `public.cards` **and** in
  `cards_effective`, exactly as today — no behaviour changes;
- the duplicate Classic Collection printings continue to appear twice in
  artist pages, Binder search and Owned Library, as they do now;
- no `cel25` id appears anywhere in CAT-2D.2's executable mapping logic, and a
  test asserts that.

The pre-existing duplication is not made worse by CAT-2D.2; it is simply left
untouched.
