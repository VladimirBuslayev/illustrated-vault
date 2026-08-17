# CAT-2D.3 Gate 0 — Celebrations production impact audit

**Status: prepared, NOT run.** Read-only audit definition. No production SQL has
been executed, no alias exists, no migration or schema change is proposed, the
sync schedule remains paused, and no application code changed.

**Gate 0 makes no alias decision and proposes no mapping.** It exists to answer
one prioritisation question with evidence instead of intuition.

---

## 1. The decision question

> Are the 25 historical Celebrations Classic Collection identities **materially
> load-bearing in production today**, or can CAT-2D.3 safely be **deferred**
> while we prioritise visible catalog / image completeness?

CAT-2D.3 is a 25-pair, individually corroborated identity remap — genuinely
expensive work. It is worth doing early only if collector truth currently
depends on those old IDs, or if the duplicate presentation is materially
damaging the artist-first experience. Gate 0 measures both rather than assuming
either.

This gate can also conclude **"the evidence is mixed"**. That is a permitted
outcome, not a failure to decide — see §5.

---

## 2. Settled context

Established and not re-litigated here:

- Production stores **25 historical Classic Collection rows** under legacy
  `cel25` local IDs — the numbers of the original printings they reproduce, not
  `CC###`. Six are recorded from a production probe:

  | Stored historical id | Name |
  |---|---|
  | `cel25-2A` | Blastoise |
  | `cel25-4A` | Charizard |
  | `cel25-15A1` | Venusaur |
  | `cel25-17A` | Umbreon Star |
  | `cel25-60A` | Tapu Lele GX |
  | `cel25-88A` | Mew ex |

- Current provider survivors use the **`cel25cc`** namespace with `CC###`
  numbering.
- **CAT-2D.2's rule cannot be reused.** `normNum` differs, so admission rule A2
  fails outright; name equality alone is insufficient; no fuzzy aliasing is
  permitted. The eventual mapping must be **individually corroborated per
  pair** — `CAT-2D.3_CELEBRATIONS_IDENTITY_REMAP.md` §3.
- The 25 historical rows currently remain in **both** `public.cards` **and**
  `cards_effective`. Nothing about them changed in CAT-2D.2.
- CAT-2D.2 is closed: 192 aliases (SV 122, GG 70), `cards` 23,780,
  `cards_effective` 23,588, merged as `d01c8ad`.

**No historical → survivor mapping is created, inferred or implied by this
gate.** Exact-name correspondence may be *reported* as a duplicate-presentation
diagnostic and is labelled as such in the SQL output itself; it is never
identity evidence.

---

## 3. ⚠ Known gap: the population selector is falsifiable, not yet proven

This is the one place Gate 0 could go wrong, so it is stated up front rather
than buried.

**The problem.** The live Celebrations base set and the historical Classic
Collection reprints both live under `set_id = 'cel25'` — CAT-0 measured that set
at **50 rows**. No column in `public.cards` separates them.

**What is established evidence:**

| # | Fact | Source |
|---|---|---|
| E1 | `cel25` holds 50 rows; `cel25cc` holds 25 | `docs/cat-0-evidence/catalog_coverage_by_set.csv` (committed) |
| E2 | Historical rows carry legacy letter-suffixed local IDs; six enumerated | `CAT-2D.3_CELEBRATIONS_IDENTITY_REMAP.md` §1 (committed) |
| E3 | `'^CC[0-9]{3}$'` matches **zero** rows in `cel25` | CAT-2D.2 production Phase A refusal |

**What is assumed and must be confirmed:**

> **A1** — that *"`local_id` is purely numeric"* separates the live base set
> from the historical reprints **exactly**.

All six known historical IDs carry a letter suffix, and upstream `cel25` was
observed on 2026-08-17 to serve exactly 25 cards numbered 1–25 — but **that was
a session observation during the CAT-2D.2 evidence work, not committed
repository evidence**, and the remaining 19 historical IDs have never been
enumerated.

`CAT-2D.3_CELEBRATIONS_IDENTITY_REMAP.md` §3.1 is explicit that this partition
*"must be established from data, not from a pattern."* This audit honours that
in the only way SQL can — it does not assert the pattern is right, it makes the
pattern **falsifiable**:

- **Q-A0** reports partition sizes plus four integrity flags. The complement
  must be exactly 25 rows **and** exactly the integers 1–25 with no gaps,
  duplicates or extras. A single numeric historical row breaks it.
- **Q-A1** enumerates **all 50 rows**, both partitions labelled, so a reviewer
  confirms the split by eye rather than trusting a regex.

**Required corroboration, outside SQL.** Before any downstream CAT-2D.3 work
treats this population as final, confirm against upstream liveness — the same
evidence class CAT-2D.2 used for A5:

```
curl -s https://api.tcgdex.net/v2/en/sets/cel25 | jq -r '.cards[].id'
```

Every returned ID is a live base-set row; every stored `cel25` ID absent from
that list is historical. **That list and Q-A1's non-numeric partition must agree
exactly.** If they disagree, the selector is wrong, this audit's population is
wrong, and Q-B…Q-G must be re-run against the corrected population.

**This is the gate's first STOP condition.** If Q-A0 does not return
50 / 25 / 25 with `base_set_is_exactly_1_to_25 = true`, stop and re-derive the
population before reading anything else.

---

## 4. The questions

### A — Exact historical population
The exact 25 rows: IDs, names, set IDs/names, local IDs, `artist_id`,
`illustrator`, image presence, and whether each remains in `cards_effective`.
Selection method must be explicit and not use an over-broad `cel25` filter that
sweeps in the live base set. → **Q-A0, Q-A1**

### B — Current ownership impact
For the **active** import snapshot: matched `user_import_rows.card_id`
references to the historical IDs, distinct IDs referenced, matched quantity, and
whether any appear in `candidate_card_ids`. Three classes kept strictly
separate: **active matched** (ownership authority) · **candidate-only**
(diagnostic, never authority) · **superseded/other batches** (historical
evidence). `user_import_rows` is read-only throughout. → **Q-B**

### C — Collector-authored mutable state
Reference counts from every current card-ID-bearing mutable surface —
`card_overrides`, `card_extras`, `card_favorites`, `price_history`,
`user_card_intent`, `user_binder_cards` — with the schema inspected first to
confirm no other table stores direct `card_id` references. Row count, distinct
card IDs, and owner count where applicable. **Counts only; no user UUIDs.**
→ **Q-C0** (schema discovery), **Q-C** (inventory)

### D — Artist-first impact
How many historical rows carry a non-null `artist_id`, which artists, and
whether those legacy rows are therefore rendered on Artist Pages today. Reported
**per `artist_id` in aggregate**, never row-to-row — equal `artist_id` is not an
identity claim. → **Q-D, Q-D2**

### E — Duplicate catalog / UI exposure
Whether `cards_effective` currently exposes **both** populations; counts;
exact-name overlap; non-unique names within either population. Presentation
diagnostic only. → **Q-E**

### F — Image / completeness comparison
Image presence measured **separately** per population. No claim that a
historical image could substitute for a survivor — cross-printing image
substitution remains prohibited and no approved pair mapping exists. → **Q-F**

### G — Current user-facing severity
Classification against §5. → **Q-G** gathers the deciding figures; the judgement
is human.

---

## 5. Interpretation framework

Applied **after** Q-A0 passes. If Q-A0 fails, no classification is valid.

| Classification | Evidence pattern |
|---|---|
| **LOAD-BEARING NOW** | Active physical ownership depends on old IDs (Q-B `active_matched_rows` > 0); **and/or** manual ownership / intents / binder / favorites materially depend on them (Q-C non-zero on a user-authored table); **and/or** artist-first presentation is materially duplicated or broken (Q-D shows the same artist rendering both populations). |
| **VISIBLE BUT NON-LOAD-BEARING** | Duplicate catalog presentation exists (Q-E both populations in `cards_effective`), but no collector truth or authored state depends on the old IDs (Q-B active = 0, Q-C ≈ 0). |
| **DORMANT** | Effectively no active or user-authored references **and** no meaningful current presentation impact. |

**Mixed evidence is a permitted outcome.** The likely mixed case: zero active
ownership and zero authored state, but 25 duplicated printings visible in the
catalog and some of them on artist pages. That is not LOAD-BEARING by the
ownership test and is more than DORMANT by the presentation test. Say so, and
state the tradeoff explicitly rather than rounding to a label.

Signals that would argue for **deferring** CAT-2D.3:

- Q-B active matched rows = 0 → no collector's ownership currently resolves
  through a historical Celebrations ID;
- Q-C totals ≈ 0 → no overrides, favorites, intents, binder rows or price
  history to migrate, so the eventual migration stays cheap and no user-authored
  state is at risk while we wait;
- Q-D historical rows with `artist_id` = 0 → the duplicates are not reaching
  artist pages, the strategically important surface.

Signals that would argue for **prioritising** it:

- any non-zero Q-B active matched count — that is live ownership sitting on an
  identity the provider has retired;
- Q-D showing curated artists rendering both copies — a visible artist-first
  quality defect that persists for as long as we defer;
- Q-C growth over time — every day of deferral is more collector-authored state
  landing on IDs that will eventually have to move.

**Note on Q-F.** `cel25cc` was 25/25 image-missing at CAT-0. If that still
holds, the Classic Collection is invisible-as-art under *either* identity, which
is an argument that **image completeness, not identity, is the user-visible
problem here** — and therefore an argument for the roadmap alternative. This is
the single most decision-relevant number in the audit.

---

## 6. Execution

`docs/sql/cat-2d3-gate0-impact-audit.sql`. Read-only; run as the migration
owner.

- Every statement is `SELECT`-only. No DDL, DML, RPC or sync.
- **No** TEMP tables, `BEGIN`/`COMMIT`, `set_config`, or auth impersonation.
  CAT-2D.2 established that this workflow must not depend on cross
  top-level-statement TEMP or session state; nothing here does.
- Each statement is **independently self-contained** — every one repeats the
  population CTE verbatim. Any order, any session, any number of times.
- Global diagnostics across all users, so RLS must not scope them; that is why
  no JWT context is established. No user UUID appears in the file.

Run order: **Q-A0 first** (it gates everything), then Q-A1, Q-C0, Q-B, Q-C, Q-D,
Q-D2, Q-E, Q-F, Q-G.

### Output handling

Q-C returns **counts only**, so its output is safe to paste into §7. If per-row
operational detail is ever needed, keep it in the operator's session — **do not
commit user UUIDs, binder IDs or row IDs.**

---

## 7. Production results

> **Not yet run.** Paste output below, then classify against §5.

### Q-A0 — selector integrity  ⚠ gate

```
(pending)
```

- [ ] `cel25_total_rows` = 50
- [ ] `candidate_historical_rows` = 25
- [ ] `candidate_base_set_rows` = 25
- [ ] `base_set_is_exactly_1_to_25` = true
- [ ] `rows_with_null_local_id` = 0
- [ ] `cel25cc_rows` = 25
- [ ] Upstream corroboration run; `cel25` live IDs match the numeric partition exactly

### Q-A1 — full enumeration of `set_id = 'cel25'`

```
(pending)
```

### Q-C0 — schema discovery: tables carrying `card_id`

```
(pending)
```

- [ ] No card_id-bearing table appears here that Q-C does not cover

### Q-B — ownership impact

```
(pending)
```

### Q-C — collector-authored mutable state

```
(pending)
```

### Q-D / Q-D2 — artist-first impact

```
(pending)
```

### Q-E — duplicate catalog exposure

```
(pending)
```

### Q-F — image / completeness comparison

```
(pending)
```

### Q-G — severity roll-up

```
(pending)
```

### Classification

> **Pending.** One of LOAD-BEARING NOW / VISIBLE BUT NON-LOAD-BEARING /
> DORMANT / mixed-with-explanation, per §5.

### Recommendation

> **Pending.** Prioritise CAT-2D.3, or defer it in favour of catalog/image
> completeness — with the reasoning tied to specific figures above.

---

## 8. Scope statement

Gate 0 **does not**:

- create, infer, propose or imply any historical → survivor alias;
- write anything to production;
- change schema, RLS, RPCs, runtime code, the sync, or the paused schedule;
- modify `user_import_rows` or any collector-authored state;
- treat exact-name or exact-`artist_id` correspondence as identity evidence.

Gate 0 **does**: measure current production impact, and produce a recommendation
on sequencing.

Whatever it concludes, the CAT-2D.3 admission rules in
`CAT-2D.3_CELEBRATIONS_IDENTITY_REMAP.md` §3 are unchanged — 25 individually
corroborated pairs, no fuzzy matching, its own named evidence class.

---

## 9. Stop conditions

Stop and report rather than proceeding if:

- **Q-A0 fails any check**, or upstream corroboration disagrees with the numeric
  partition → the population is wrong; every downstream figure is measuring the
  wrong rows;
- **Q-C0 reveals a `card_id`-bearing table Q-C does not cover** → an unmeasured
  reference class;
- the current schema differs materially from what the CAT-2D docs expect (e.g. a
  named table absent, a unique constraint changed);
- answering any question would require an unapproved identity mapping;
- answering would require a production write.

Record the gap and what evidence would resolve it.
