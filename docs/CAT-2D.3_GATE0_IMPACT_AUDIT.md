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
pattern **falsifiable**, and then requires an independent check SQL cannot
perform.

### The population gate is three checks, and all three are prerequisites

**Q-B through Q-G may not be run until all three pass.**

| # | Check | What it settles |
|---|---|---|
| **1** | **Q-A0** passes every integrity flag | sizes, gaps, duplicates, NULLs, stray `CC###` rows |
| **2** | **Q-A1** enumerates all 50 rows coherently, reviewed by eye | nothing looks misplaced across the two partitions |
| **3** | **Upstream** `cel25` live IDs agree **exactly** with Q-A1's numeric partition | membership — the independent discriminator |

#### ⚠ What Q-A0 can and cannot prove

An earlier revision of this document claimed *"a single numeric historical row
breaks it."* **That is not universally true**, and the overstatement is
corrected here.

Q-A0 is a strong **consistency** test, not a proof of membership. Consider the
failure it cannot see: if a numeric-`local_id` historical row occupied a number
whose live base-set row is missing from storage, the numeric partition would
still hold 25 rows spanning exactly 1–25 with no duplicates. **Every Q-A0 flag
would pass** while one historical row sat in the base-set partition and one
base-set row was absent entirely. Counts right, membership wrong.

Q-A0 rules out the *loose* failures. It cannot rule out a substitution.
**Upstream liveness is the independent discriminator** — check 3, not check 1.

#### Check 3 — required corroboration, outside SQL

```
curl -s https://api.tcgdex.net/v2/en/sets/cel25 | jq -r '.cards[].id' | sort
```

Every returned ID is a live base-set row; every stored `cel25` ID absent from
that list is historical. Compare against Q-A1's numeric partition **as sets, not
just as counts** — they must agree exactly, with no extras on either side:

- a stored numeric ID **missing from upstream** → a historical row hiding in the
  base-set partition;
- an upstream ID **missing from storage** → a base-set row never ingested.

Either invalidates the selector. Q-B…Q-G must then be re-run against the
corrected population.

Upstream liveness **partitions** the population; it does not **map** it. No
historical → survivor pairing is derived here or anywhere else in Gate 0.

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

### C — Mutable direct catalog references, by class
Reference counts from every current card-ID-bearing mutable surface —
`card_overrides`, `card_extras`, `card_favorites`, `price_history`,
`user_card_intent`, `user_binder_cards`. Row count, distinct card IDs, owner
count where derivable. **Counts only; no user UUIDs.**

> **`card_extras` is *not* collector-authored state.** It is global
> catalog/editorial metadata — manual illustrator corrections, written by
> privileged enrichment, shared by every user, with **no `user_id` column**
> (`docs/sql/card_extras_and_view.sql`). Q-C inventories it because it is a
> mutable direct card reference a migration would have to move, but it is
> labelled as catalog metadata and **excluded from any collector-impact total**.

> **`user_binder_cards` has no `user_id`.** Ownership is carried by the parent
> binder, and its RLS policies verify through it (BP-0A1). Owner counts are
> derived by joining `public.user_binders`; distinct binders are reported
> separately and are **not** labelled as owners.

The schema is inspected first — **Q-C0** classifies every card-id-like column
in the live schema, so an unaccounted-for reference is a finding while known
non-catalog structure is not. → **Q-C0** (classification), **Q-C** (inventory)

### D — Artist-first impact: query *reachability*
How many historical rows carry a non-null `artist_id`, which artists, and
whether those legacy rows are **reachable by an artist query** today. Reported
**per `artist_id` in aggregate**, never row-to-row — equal `artist_id` is not an
identity claim.

> **Reachability, not rendering.** `cardService.fetchArtistCards` reads
> `cards_effective`; a curated entry filters `.eq('artist_id', …)`, a dynamic
> entry matches exact `artist_id` **or** exact `illustrator`. So `artist_id` +
> effective membership proves a row *can be returned* by an artist query — not
> that any collector renders it today, which also requires an artist entry to
> exist for that identity. Illustrator-string reachability is reported alongside,
> because the dynamic branch matches on it even when `artist_id` is NULL.

→ **Q-D, Q-D2**

### E — Concurrent catalog presence
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

Applied **only after all three population-gate checks pass** (§3). If any of
Q-A0, the Q-A1 read-through, or upstream agreement fails, no classification is
valid — the audit is measuring the wrong rows.

**Visibility is judged on measured co-presence plus name / artist-reachability
evidence — never on co-presence alone.** Two populations both being in the
catalog is two populations being in the catalog; calling that "the printing
shows twice" would presuppose the row-to-row identity Gate 0 has not
established.

| Classification | Evidence pattern |
|---|---|
| **LOAD-BEARING NOW** | Active physical ownership depends on old IDs (Q-B `active_matched_rows` > 0, `impacted_users` > 0); **and/or** collector-authored state materially depends on them (Q-C non-zero on a **collector-authored** table — `card_extras` does not count); **and/or** artist-first quality is materially affected (Q-D shows historical rows FK-reachable under the *same* `artist_id` as cel25cc rows). |
| **VISIBLE BUT NON-LOAD-BEARING** | Both populations are concurrently present in the canonical catalog (Q-E) **and** there is substantial exact-name overlap and/or shared artist reachability — but no collector truth or authored state depends on the old IDs (Q-B active = 0, Q-C collector-authored ≈ 0). |
| **DORMANT** | Effectively no active or collector-authored references **and** no meaningful presentation signal: little or no name overlap, and no shared artist reachability. |

**Mixed evidence is a permitted outcome.** The likely mixed case: zero active
ownership and zero collector-authored state, but both populations present in the
catalog with substantial name overlap and some shared artist reachability. That
is not LOAD-BEARING by the ownership test and is more than DORMANT by the
presentation test. Say so, and state the tradeoff explicitly rather than
rounding to a label.

A second mixed case worth naming: non-zero `card_extras` references with zero
collector-authored ones. That is a **catalog-metadata migration signal**, not
collector impact — it raises the eventual cost of CAT-2D.3 slightly without
making it urgent.

Signals that would argue for **deferring** CAT-2D.3:

- Q-B active matched rows = 0 → no collector's ownership currently resolves
  through a historical Celebrations ID;
- Q-C **collector-authored** totals ≈ 0 → no overrides, favorites, intents,
  binder rows or price history to migrate, so the eventual migration stays cheap
  and no collector-authored state is at risk while we wait;
- Q-D `historical_fk_reachable` = 0 → the legacy rows are not reachable by the
  artist-query path at all, so the strategically important surface is unaffected.

Signals that would argue for **prioritising** it:

- any non-zero Q-B active matched count — that is live ownership sitting on an
  identity the provider has retired;
- Q-D showing historical rows FK-reachable under the **same `artist_id`** as
  cel25cc rows — an artist query for that identity can return both populations,
  which is an artist-first quality concern that persists while we defer;
- Q-C collector-authored growth over time — every day of deferral is more
  collector-authored state landing on IDs that will eventually have to move.

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

**Run order — the population gate is a hard prerequisite:**

1. **Q-A0** — consistency flags. Stop on any deviation.
2. **Q-A1** — read the 50-row enumeration; confirm the partition looks coherent.
3. **Upstream** — `curl … /sets/cel25` and compare as sets against Q-A1's
   numeric partition.

**Only when all three pass**, run Q-C0, Q-B, Q-C, Q-D, Q-D2, Q-E, Q-F, Q-G — in
any order, each is independently self-contained.

### Output handling

Q-C returns **counts only**, so its output is safe to paste into §7. If per-row
operational detail is ever needed, keep it in the operator's session — **do not
commit user UUIDs, binder IDs or row IDs.**

---

## 7. Production results

> **Not yet run.** Paste output below, then classify against §5.

### Population gate — all three required before Q-B..Q-G

**Check 1 — Q-A0 consistency**

```
(pending)
```

- [ ] `cel25_total_rows` = 50
- [ ] `candidate_historical_rows` = 25
- [ ] `candidate_base_set_rows` = 25
- [ ] `base_set_is_exactly_1_to_25` = true
- [ ] `rows_with_null_local_id` = 0
- [ ] `historical_rows_matching_cc_pattern` = 0
- [ ] `cel25cc_rows` = 25

**Check 2 — Q-A1 full enumeration of `set_id = 'cel25'`, read through**

```
(pending)
```

- [ ] All 50 rows present; the partition is coherent on inspection
- [ ] No `cel25` row is already aliased (`is_already_aliased` all false)

**Check 3 — upstream liveness (the independent discriminator)**

```
(pending — curl -s https://api.tcgdex.net/v2/en/sets/cel25 | jq -r '.cards[].id' | sort)
```

- [ ] Upstream live IDs and Q-A1's numeric partition agree **as sets**
- [ ] No stored numeric ID missing from upstream
- [ ] No upstream ID missing from storage

> ⚠ Q-A0 passing is **not** sufficient on its own — it cannot detect a
> historical row substituting for an absent base-set number. Check 3 settles
> membership. Do not proceed to Q-B until all three boxes above are ticked.

### Q-C0 — card-id-like columns, classified

```
(pending)
```

- [ ] No row classified `STOP: unclassified card-id-like reference`
- [ ] Expected classes only: direct catalog reference · immutable import
      evidence · identity infrastructure · membership reference

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
