# CAT-2D.3 Gate 0 — Celebrations production impact audit

**Status: ✅ COMPLETE — Q-A0 through Q-G all executed in production, 2026-08-18.**

> ## Classification: **VISIBLE BUT NON-LOAD-BEARING**
> ## Recommendation: **DEFER CAT-2D.3** — prioritise catalog / image completeness next

Every ownership and reference signal is **zero**: no active matched rows, no
impacted users, no collector-authored state, no catalog-metadata references.
Both populations are nonetheless fully present in `cards_effective` (25 + 25),
24 of 25 share a normalised name, and **all 25 historical rows are artist-query
reachable**.

**The stronger current product issue is imagery, not identity.** Both Classic
Collection populations are **0/25 imaged** while fully effective — 50 catalog
entries that render no art under either identity. See §7 Q-F.

No alias exists, no mapping is proposed, no migration or schema change is
suggested, no write of any kind was made, the sync schedule remains paused, and
no application code changed. **Gate 0 makes no alias decision.**

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

## 4a. ✅ RESOLVED FINDING — `public.artists.signature_card_id`

**Verdict: direct catalog reference — global artist/catalog metadata.
Structurally real, currently dormant. No repair required.**

Q-C0 ran in production on 2026-08-18 and returned one STOP row:

```
BASE TABLE | artists | signature_card_id | text
           | STOP: unclassified card-id-like reference | false
```

That blocked the gate until Q-C1…Q-C3 resolved it. This is Q-C0 working exactly
as designed — it caught a card-id-bearing column the CAT-2D reference inventory
never knew about, and the gate refused to proceed on a name.

### What the repository says about it: nothing

Searched exhaustively before adding any diagnostic:

| Check | Result |
|---|---|
| `public.artists` DDL in `docs/sql/` | **none — the table has no committed DDL at all**, it predates the repo's SQL convention |
| `signature_card_id` in any `.sql` / `.js` / `.jsx` / `.mjs` / `.md` / `.json` | **zero occurrences** |
| `signature_card_id` in the built `dist/` bundle | **zero occurrences** |
| `artists` columns the repo ever names | `id`, `aliases` (`artistService.js:82`, `sync-cards.mjs:218`), plus `display_name` in a CURRENT_STATE hotfix note |
| Runtime reads | both call sites use **explicit column lists** — neither selects this column |
| CAT-2D.2's reference inventory | **never considered it.** That inventory was a *static six-table list* from the CAT-2D design's [Q8] evidence; CAT-2D.2 performed **no** `information_schema` sweep for card-id columns (its four `information_schema` uses are all `cards_effective` / `card_identity_resolution` column-contract checks) |

**Its semantics therefore cannot be established from repo evidence, and are not
guessed here.** The column name is suggestive; a name is not evidence. It stays
classified `STOP: UNRESOLVED` in Q-C0 until Q-C1…Q-C3 are run and reviewed.

### ⚠ This may be a live finding about a *closed* slice

If `signature_card_id` does hold catalog card ids, then **CAT-2D.2 aliased 192
ids away without migrating any reference held in this column.** That would be a
stale reference sitting in production today — a defect in a slice already
marked closed, not merely a CAT-2D.3 input.

Q-C2 therefore checks against **all** alias rows, not just the CAT-2D.3
candidate population. A non-zero `already_aliased_by_cat2d2` must be reported
before anything else proceeds.

### ⚠ Absence from runtime code is *not* evidence of zero impact

No current frontend path reads this column — and that settles nothing. A column
no surface reads today can still be read by a future surface, by an admin or
editorial tool outside this repo, or by a direct query. A dangling or
aliased-away value would be wrong whenever that happens. Q-C1…Q-C3 measure the
**data**, not the current call graph.

### The minimum diagnostic added

| Statement | Establishes |
|---|---|
| **Q-C1** | type, nullability, default, and **whether a FK exists and what it targets** — plus any index. A FK to `public.cards(id)` settles "is it a catalog reference" outright; its absence settles nothing, since `user_binder_cards.card_id` is deliberately FK-free (BP-1A) |
| **Q-C2** | population counts, and the discriminator — how many populated values **resolve to a `public.cards` row** vs **dangle**; how many are in `cards_effective`; **how many are already alias ids** (stale); how many hit the CAT-2D.3 historical candidates |
| **Q-C3** | per-row detail — every populated row with its resolution status, so the classification rests on **values, not counts** |

`artists` is **global artist/catalog metadata** with no user dimension, so these
outputs contain no user-identifying values and are safe to commit.

### Production results — 2026-08-18

**Q-C1 — definition and constraints.** The decisive statement:

| Property | Value |
|---|---|
| type | `text` |
| nullable | YES |
| default | none |
| **FOREIGN KEY** | **`FOREIGN KEY (signature_card_id) REFERENCES cards(id)`** |
| index | none |

**The FK settles the classification.** It is a direct catalog reference by
construction, whatever the repository does or does not document about it.

**Q-C2 — population and resolution.** Every count zero:

| Measure | Value |
|---|---|
| `artists_rows_total` | 28 |
| `rows_with_signature_card_id` | **0** |
| `distinct_signature_card_ids` | 0 |
| `resolve_to_a_cards_row` | 0 |
| `dangling_no_cards_row` | 0 |
| `present_in_cards_effective` | 0 |
| **`already_aliased_by_cat2d2`** | **0** |
| `references_cat2d3_historical` | 0 |

**Q-C3 — per-row detail.** Success, **0 rows returned** — consistent with Q-C2.

### Verdict

| Question | Answer |
|---|---|
| Is it a direct reference to `public.cards.id`? | **Yes** — FK proves it |
| Does a constraint exist, and what does it target? | Yes — FK → `cards(id)` |
| How many artist rows populate it? | **0** of 28 |
| Do any reference the 25 CAT-2D.3 historical IDs? | **No** — 0 |
| Are any already alias IDs / non-effective? | **No** — 0 |
| Does runtime code read it? | No — but see the caveat below |

- **No CAT-2D.2 stale-reference defect.** `already_aliased_by_cat2d2` = 0. The
  slice's inventory gap caused no live damage.
- **No CAT-2D.3 production impact today.** Nothing references the historical
  Celebrations population.
- **Nothing to repair.**

> ### ⚠ Two things the zero population does *not* mean
>
> **1. It does not mean this is "not a catalog reference."** The FK settles
> *classification*; the population settles *impact*. Separate questions, and
> here the answers differ: a real reference that happens to be empty.
>
> **2. It does not make the column safe to forget.** The FK guarantees the
> referenced row **exists**; it does not guarantee the row is **canonical** —
> the same distinction CAT-2D.1 §1 drew for `canonical_card_id`, where the FK
> proves existence and only the trigger proves canonicality. Aliasing deletes
> nothing, so a future populated value could point at an aliased ID and the FK
> would accept it happily.
>
> That is why the column is now carried in **Q-C** and **Q-G** rather than
> dismissed as dormant, and why Q-C1…Q-C3 are retained rather than deleted:
> re-running them is how a future slice re-confirms the column is still empty
> instead of assuming it.

### The lasting lesson

CAT-2D.2's reference inventory was a **static six-table list** from the design's
[Q8] evidence, never checked against the live schema. `artists.signature_card_id`
carries a FK to `cards(id)` and was simply never considered. It happened to be
empty, so nothing broke — **that is luck, not design.**

Any future slice that migrates card IDs must run a **Q-C0-style
`information_schema` sweep** rather than inherit a static list. This is recorded
in the SQL alongside the Q-C inventory.

### How the finding was resolved

Two branches were defined in advance; **the first was taken**, on the FK evidence:

- ✅ **It IS a direct catalog reference.** Q-C0 now classifies it as
  `direct catalog reference (FK to cards.id) — global artist/catalog metadata`.
  **Q-C** inventories it as a seventh entry, labelled *catalog/editorial
  metadata (global, not collector-authored)* — using its real column name,
  `signature_card_id`, with owner and binder counts NULL by nature since
  `artists` has neither. **Q-G** reports
  `artists_signature_reference_rows` as its own global-metadata metric alongside
  `card_extras_reference_rows`, and **never** inside
  `collector_authored_reference_rows`. `artists` has no `user_id`; nothing in it
  is collector-authored.
- ❌ *Not taken:* "not a catalog reference". The FK ruled this out.

The generalized STOP rule is unchanged and still armed for genuinely unresolved
future columns: **any `reference_class` beginning with `STOP:` halts the gate.**
Resolving this one did not weaken it.

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

**Run order — ✅ ALL STATEMENTS EXECUTED, 2026-08-18:**

| Step | State |
|---|---|
| 1. **Q-A0** — consistency flags | ✅ PASSED |
| 2. **Q-A1** — 50-row enumeration, read through | ✅ PASSED |
| 3. **Upstream** `cel25` set equality | ✅ PASSED |
| → population gate | ✅ **PASSED** |
| 4. **Q-C0** — card-id-like columns, classified | ✅ RAN — one STOP, since RESOLVED |
| 5. **Q-C1 / Q-C2 / Q-C3** — resolve `artists.signature_card_id` | ✅ PASSED — §4a |
| → STOP conditions | ✅ NONE FIRING |
| 6. **Q-B** — ownership impact | ✅ RAN — all zero |
| 7. **Q-C** — mutable references by class | ✅ RAN — all seven zero |
| 8. **Q-D / Q-D2** — artist reachability | ✅ RAN |
| 9. **Q-E** — concurrent catalog presence | ✅ RAN |
| 10. **Q-F** — image / completeness | ✅ RAN |
| 11. **Q-G** — severity roll-up | ✅ RAN |
| → classification | ✅ **VISIBLE BUT NON-LOAD-BEARING** |

**Nothing further to run.** The audit is closed; the recommendation is to
**defer CAT-2D.3** and prioritise catalog / image completeness.

### Output handling

Q-C returns **counts only**, so its output is safe to paste into §7. If per-row
operational detail is ever needed, keep it in the operator's session — **do not
commit user UUIDs, binder IDs or row IDs.**

---

## 7. Production results

> **✅ COMPLETE.** Every statement ran in production on 2026-08-18. Results
> recorded below; classification and recommendation at the end of this section.

### Population gate — ✅ PASSED (all three checks, 2026-08-18)

The 25-row historical Celebrations population is **established**. Downstream
figures measure the right rows.

**Check 1 — Q-A0 consistency ✅**

```
cel25_total_rows | candidate_historical_rows | candidate_base_set_rows |
base_set_is_exactly_1_to_25 | rows_with_null_local_id |
historical_rows_matching_cc_pattern | cel25cc_rows |
distinct_set_names_in_cel25 | set_names_in_cel25
-------------------------------------------------------------------------
              50 |                        25 |                      25 |
                       true |                       0 |
                                  0 |           25 |
                          1 | Celebrations
```

- [x] `cel25_total_rows` = 50
- [x] `candidate_historical_rows` = 25
- [x] `candidate_base_set_rows` = 25
- [x] `base_set_is_exactly_1_to_25` = true
- [x] `rows_with_null_local_id` = 0
- [x] `historical_rows_matching_cc_pattern` = 0
- [x] `cel25cc_rows` = 25

All seven required checks passed. `distinct_set_names_in_cel25` = 1
(`Celebrations`) confirms both populations carry the parent set name, as the
CAT-2D.2 analysis predicted.

**Check 2 — Q-A1 full enumeration, read through ✅**

Returned all **50** rows. Partition inspected and coherent — 25 numeric
base-set rows, 25 letter-suffixed historical rows, nothing misplaced.

- [x] All 50 rows present; the partition is coherent on inspection
- [x] No `cel25` row is already aliased (`is_already_aliased` all false)

*(Per the audit convention a concise verified result is sufficient here; the
50-row detail is not pasted. Q-C3 below does require its per-row detail, because
the classification decision rests on individual values.)*

**Check 3 — upstream liveness ✅ — the independent discriminator**

Upstream `cel25` membership matched the numeric `cel25-1`…`cel25-25` partition
**exactly, as sets**.

- [x] Upstream live IDs and Q-A1's numeric partition agree **as sets**
- [x] No stored numeric ID missing from upstream
- [x] No upstream ID missing from storage

> Membership is settled. Q-A0 alone could not have established this — check 3
> did, exactly as designed.

### Q-C0 — card-id-like columns, classified

**RUN 2026-08-18.** Returned one STOP row — **since resolved**, see §4a.

```
BASE TABLE | artists | signature_card_id | text
           | STOP: unclassified card-id-like reference | false
```

- [x] Q-C0 executed
- [x] **No unresolved `STOP:` row remains.** `artists.signature_card_id` is now
      classified `direct catalog reference (FK to cards.id) — global
      artist/catalog metadata`, and is carried in Q-C and Q-G
- [x] Expected classes only: direct catalog reference · immutable import
      evidence · identity infrastructure · membership reference

> The generalized rule stays armed: any future `reference_class` beginning with
> `STOP:` halts the gate.

### Q-C1 — `artists.signature_card_id` definition and constraints ✅

```
type text | nullable YES | no default | no index
FOREIGN KEY (signature_card_id) REFERENCES cards(id)
```

- [x] **FOREIGN KEY exists, targeting `cards(id)`** — settles the classification
- [x] Type / nullability / default recorded

### Q-C2 — does it hold catalog card ids, and are any stale? ✅

```
artists_rows_total            = 28
rows_with_signature_card_id   = 0
distinct_signature_card_ids   = 0
resolve_to_a_cards_row        = 0
dangling_no_cards_row         = 0
present_in_cards_effective    = 0
already_aliased_by_cat2d2     = 0
references_cat2d3_historical  = 0
```

- [x] `dangling_no_cards_row` = 0 — no dangling values (the column is empty)
- [x] **`already_aliased_by_cat2d2` = 0** — no stale reference in production;
      CAT-2D.2's inventory gap caused no live damage
- [x] `references_cat2d3_historical` = 0 — no CAT-2D.3 impact today

### Q-C3 — per-row detail ✅

```
success, 0 rows returned
```

- [x] Consistent with Q-C2 — the column is unpopulated

### Resolution of the §4a finding ✅

> **Direct catalog reference — global artist/catalog metadata.** Structurally
> real (FK to `cards(id)`), currently dormant (0 of 28 rows populated). No
> CAT-2D.2 stale-reference defect, no CAT-2D.3 impact, **nothing to repair.**
>
> Now classified in Q-C0, inventoried in Q-C as global metadata, and reported in
> Q-G as its own metric — never inside `collector_authored_reference_rows`.
>
> The zero population means **no repair is needed**, not that this is "not a
> catalog reference". See §4a for why that distinction matters going forward.

### Q-B — ownership impact ✅

```
batch_status | matched_rows | impacted_users | distinct_ids | quantity | candidate_only | all_rows
-------------+--------------+----------------+--------------+----------+----------------+---------
active       |            0 |              0 |            0 |        0 |              0 |    6,359
superseded   |            0 |              0 |            0 |        0 |              0 |   35,548
```

**Zero across every class.** No collector's ownership resolves through a
historical Celebrations ID — not in the active snapshot, not in superseded
batches, and not even as a `candidate_card_ids` diagnostic. 41,907 import rows
scanned in total.

### Q-C — mutable direct catalog references, by class ✅

**All seven classes returned zero.**

| Table | Class | Rows referencing historical |
|---|---|---|
| `artists.signature_card_id` | catalog/editorial metadata (global) | **0** |
| `card_extras` | catalog/editorial metadata (global) | **0** |
| `card_favorites` | collector-authored | **0** |
| `card_overrides` | collector-authored | **0** |
| `price_history` | collector-authored | **0** |
| `user_binder_cards` | collector-authored | **0** |
| `user_card_intent` | collector-authored | **0** |

No collector-authored state and no catalog metadata points at any of the 25
historical IDs. A future CAT-2D.3 migration would have **no references to
migrate** as of today.

### Q-D / Q-D2 — artist-first impact ✅

**Q-D — per `artist_id`:**

| artist_id | historical rows / reachable | cel25cc rows / reachable |
|---|---|---|
| `fukuda` | 1 / 1 | 1 / 1 |
| `midori-harada` | 0 | 1 / 1 |

**Q-D2 — totals:**

| Measure | historical | cel25cc |
|---|---|---|
| rows | 25 | 25 |
| with `artist_id` | 1 | 2 |
| **FK reachable** | 1 | 2 |
| **illustrator reachable** | **25** | **25** |
| illustrator but no `artist_id` | 24 | 23 |
| distinct artists | 1 | 2 |

> ### ⚠ Read this correctly — `historical_fk_reachable = 1` is *not* the
> ### artist-reachability figure
>
> **All 25 historical rows are artist-query reachable**, via
> `illustrator_reachable = 25`. `cardService.fetchArtistCards`'s **dynamic**
> branch matches on exact `illustrator` equality *or* `artist_id`, so a NULL
> `artist_id` does not make a row unreachable — 24 of the 25 are reachable by
> illustrator string alone.
>
> The FK figure of **1** describes only the narrower *curated* FK path. Reporting
> it as overall reachability would understate the artist-first exposure
> twenty-five-fold.
>
> **Rendering remains unproven either way.** Reachability means a query *can*
> return the row; whether any collector sees it also requires an artist entry to
> exist for that identity and for someone to open that page. Gate 0 measured
> reachability, which is what it can measure.

**The concrete coexistence case:** `fukuda` is reachable in **both** populations
— one historical row and one `cel25cc` row, each reachable. An artist query for
that identity can return both.

### Q-E — concurrent catalog presence ✅

| Measure | Value |
|---|---|
| historical rows | 25 |
| **historical in `cards_effective`** | **25** |
| `cel25cc` rows | 25 |
| **`cel25cc` in `cards_effective`** | **25** |
| historical names also in `cel25cc` | 24 |
| historical names with no `cel25cc` match | 1 |
| non-unique normalised names within either population | 0 |

**Both populations are fully present in the canonical catalog** — 50 effective
rows where the collector arguably expects 25.

> **Name overlap remains DIAGNOSTIC ONLY.** 24 of 25 sharing a normalised name
> is a presentation signal, not alias evidence, and it creates and implies **no
> mapping**. CAT-2D.3 §3 still requires per-pair corroboration; nothing here
> supplies it. The one name with no `cel25cc` match is itself a reason the
> name-based shortcut must not be taken.

### Q-F — image / completeness comparison ✅

| Population | rows | with image | missing image | in `cards_effective` |
|---|---|---|---|---|
| base-set `cel25` (live Celebrations) | 25 | **24** | 1 | 25 |
| `cel25cc` (current survivors) | 25 | **0** | **25** | 25 |
| historical `cel25` (Classic Collection) | 25 | **0** | **25** | 25 |

**This is the decision-relevant result.** Both Classic Collection populations
are **0 / 25 imaged** while both are **fully effective**. The collector sees 50
Classic Collection entries in the catalog and **not one of them renders art** —
under either identity.

CAT-0's 2026-07-27 figure for `cel25cc` (25/25 image-missing) still holds, and
the historical population is in exactly the same state.

### Q-G — severity roll-up ✅

| Signal | Value |
|---|---|
| historical population | 25 |
| active matched rows / users / distinct IDs / quantity | **0 / 0 / 0 / 0** |
| **collector-authored reference rows** | **0** |
| `card_extras` reference rows | 0 |
| `artists.signature` reference rows | 0 |
| historical present in catalog | 25 |
| survivors present in catalog | 25 |
| historical names also in `cel25cc` | 24 |
| historical FK reachable | 1 *(see Q-D2 — illustrator reachability is 25)* |
| scope | Gate 0 makes **NO** alias decision and proposes **NO** mapping |

### Classification

> # VISIBLE BUT NON-LOAD-BEARING

Against §5:

- **Not LOAD-BEARING.** Every ownership signal is zero — no active matched rows,
  no impacted users, no quantity, not even a candidate-only diagnostic across
  41,907 import rows. Every collector-authored table is zero. Both global
  catalog-metadata references are zero.
- **More than DORMANT.** Both populations are fully present in
  `cards_effective` (25 + 25), 24 of 25 share a normalised name, and **all 25
  historical rows are artist-query reachable** — with `fukuda` reachable in both
  populations under one `artist_id`.

The evidence is not mixed: it lands squarely in the middle band. Collector truth
does not depend on the old IDs at all, and the coexistence is real and visible.

### Recommendation

> # DEFER CAT-2D.3
>
> Do **not** create aliases or begin the 25-pair corroboration work now.
> **Prioritise catalog / image completeness next.**

**Why defer:**

- **Nothing is at risk while we wait.** Zero ownership load, zero
  collector-authored state, zero references of any kind. There is no
  accumulating damage and no user whose collection depends on a retired ID.
- **The migration stays cheap.** With zero references, a future CAT-2D.3 has
  nothing to migrate — only the 25 alias rows themselves, once corroborated.
- **The 25-pair corroboration is the expensive part** and it buys, today, only
  the removal of a duplicate that no collector's data touches.

**Why image completeness is the stronger claim on the next slice:**

Q-F is the finding that matters. **Both** Classic Collection populations are
0/25 imaged while fully effective. Deduplicating them would leave the collector
with 25 entries that still render no art — a tidier catalog that is no more
usable. Fixing the imagery makes the set visible under either identity, and it
does so *without* requiring 25 individually corroborated identity claims.

In a product whose stated spine is a **visual archive**, 50 art-less catalog
entries outrank a duplicate the data does not depend on.

**What defers with it:** the duplicate presentation and the `fukuda`
artist-page coexistence persist until CAT-2D.3 runs. Both are cosmetic under
this evidence; neither touches collector truth.

**Revisit if any of these change:** a non-zero Q-B active matched count · any
collector-authored reference appearing · a curated artist entry making the
duplication prominent · or the Classic Collection gaining imagery, which would
make the duplication visible in a way it currently is not.

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

**The population gate — any one of the three checks failing is a stop:**

- **Q-A0 fails any flag** → size, range, gap or duplicate consistency is broken;
- **Q-A1's enumeration is incoherent** → a row looks misplaced across the two
  partitions on read-through;
- **the upstream live-ID set differs from Q-A1's numeric partition** → membership
  is wrong. This is the discriminator Q-A0 cannot supply: a stored numeric ID
  missing from upstream is a historical row hiding in the base-set partition, and
  an upstream ID missing from storage is a base-set row never ingested.

In any of those cases the population is wrong and every downstream figure is
measuring the wrong rows. Re-derive the population before running Q-B…Q-G.

**Everything else:**

- **Q-C0 returns any row classified `STOP: unclassified card-id-like reference`**
  → stop and inspect the new or unaccounted-for reference. Rows classified as
  immutable import evidence, identity infrastructure or membership reference are
  expected and are **not** findings.

  **NOT CURRENTLY FIRING.** It fired on 2026-08-18 for
  `public.artists.signature_card_id` and was resolved by Q-C1…Q-C3 — see §4a.
  That column is now classified and inventoried, and the rule remains armed for
  genuinely unresolved future columns;
- the current schema differs materially from what the CAT-2D docs expect (e.g. a
  named table absent, a unique constraint changed);
- answering any question would require an unapproved identity mapping;
- answering would require a production write.

Record the gap and what evidence would resolve it.
