# F-15 — Durable Artist Attribution Correction Architecture

**Design verdict: PASS — F-15 IMPLEMENTATION DESIGN READY.**
**Selected architecture: Option A — extend `card_extras` with an explicit, provenance-backed artist-association override.**
**Design + read-only evidence only. Nothing was implemented, migrated, or repaired.**

| | |
|---|---|
| Slice | F-15 — durable attribution correction architecture (**design only**) |
| Branch | `design/f15-durable-attribution-correction` |
| Base | `main` @ `039662d338b15a38b7ec89be3a87fd73886ac873` |
| Follows | PR #22 (ATTR-0) · PR #23 (Gate 2) · PR #24 (ATTR-0b) |
| Production reads | **read-only introspection only** (Supabase MCP is read-only) |
| Production mutations | **none** |
| Schema / view / RLS / ACL changes | **none** |
| Runtime changes | **none** — `src/**` and `sync/**` untouched |
| Catalog sync | **remains paused** — not resumed, not triggered |
| Repair performed | **none** — the 12 confirmed rows are untouched |
| Artifacts | `docs/sql/f15-attribution-correction-design-audit.sql` (SELECT-only) · `docs/attr-0-evidence/f15-repair-impact.csv` |
| Measured at | 2026-08-20 |
| Corrections (2026-08-21, PR #25 review) | (1) admission resolver corrected to aliases-only, matching `sync-cards.mjs` exactly — §12, §6.3; (2) legacy-row provenance grandfathering replaced with a concrete, unconditional representation — §6.4, §12.2 C1, §13.4 |

---

## 1. Executive decision

**Adopt Option A: extend `card_extras` with `artist_id_override` plus dedicated
attribution provenance, and change `cards_effective.artist_id` from a raw
passthrough to an explicit override expression.** The prior in the brief was
right, and the production evidence supports it — but *not* for the reason the
prior assumed, and the naive migration would have caused a regression.

Six findings, in order of how much they change the plan.

**1. The proposed CASE expression is correct, and the naive migration to it is
not.** Switching to
`CASE WHEN illustrator_override IS NOT NULL THEN artist_id_override ELSE cards.artist_id END`
with a new nullable column defaulting to NULL would **silently strip artist
membership from three of the five existing override rows** — `swsh11-186`
(Shinji Kanda), `swsh12.5gg-GG19` (Asako Ito), `swsh12.5gg-GG69` (Akira Egawa).
A backfill is **mandatory and must precede the view switch** (§6).

**2. The backfill is deterministic and provably behaviour-preserving.** For all
five existing overrides the resolver's answer **already equals** today's raw
`artist_id` — 5/5, with zero ambiguous rows (§6.2). So the backfill is
`artist_id_override := resolve(illustrator_override)` and it changes nothing
observable. No row is undecidable, so **no HOLD is required**.

**3. Intentional NULL is not an edge case — it is the whole repair
population.** All twelve verified illustrators resolve to **zero** rows in
`public.artists` (§7). `coalesce(artist_id_override, cards.artist_id)` is
therefore not merely theoretically wrong, it would be wrong on **12 of 12**
rows, silently retaining the known-bad artist on every single one. The CASE
form is load-bearing.

**4. Only one of the twelve actually moves artist membership.** Eleven already
carry `artist_id = NULL`; correcting them changes the displayed illustrator and
nothing else. **`xyp-XY67a` is the sole membership change** in the entire
repair: it leaves curated artist `sui`, taking `sui` from 224 effective cards to
223 (§7.2). The blast radius is one card on one Artist Page.

**5. The artist-directory lifecycle already resolves itself, and the evidence
says so.** All seven corrected-to illustrators are *already* large untagged
catalog strings — `Ryo Ueda` 451 cards, `Naoki Saito` 299, down to `You Iribi`
60 — every one with **zero** FK-tagged cards and every one **already present in
`illustrator_directory`** (§15). A corrected card with `artist_id = NULL` is not
a new orphan class; it lands in exactly the state its 60–451 siblings already
occupy. When the user later adds that artist, the **dynamic** query path's exact
illustrator arm picks it up immediately. NULL does **not** trap the card.

**6. A new column would inherit the wrong ACL if nobody looked.** CAT-3B
replaced `card_extras`' table-level grant with an explicit column list; anon and
authenticated now hold SELECT on exactly `card_id`, `illustrator_override`,
`image_url_override` (§5.3). `artist_id_override` must be **added to that list**
(the view is `security_invoker` and must read it), while the new provenance
columns must be **withheld**. Neither happens automatically.

**What this design does not do.** It does not repair the twelve rows, author a
migration for execution, or touch `cards`, `cards_effective`, sync, or the
frontend. ATTR-1 remains a separate, separately-approved slice.

---

## 2. The F-15 defect

Live production definition, read 2026-08-20 (§5.2 — repo and production agree):

```sql
COALESCE(ce.illustrator_override, c.illustrator) AS illustrator,   -- overridable
COALESCE(ce.image_url_override,   c.image_url)   AS image_url,     -- overridable (CAT-3B)
c.artist_id                                                        -- RAW. not overridable.
```

`cards.artist_id` is written by the sync as
`resolveArtistId(card.illustrator, aliasMap)` (`sync/sync-cards.mjs:323`) — an
exact normalised lookup of the **raw** illustrator string against
`artists.aliases`. The enrichment layer can move what a card *says* but not what
it is *filed under*.

Concretely, for `xyp-XY67a` (Jirachi — raw `sui`, verified **Naoki Saito**):
writing `illustrator_override = 'Naoki Saito'` today yields a card that
**displays Naoki Saito while remaining filed under `sui`**, still counted on
`sui`'s Artist Page. That converts a data defect into a display/filing split the
product does not currently have — which is why ATTR-0, Gate 2 and ATTR-0b all
stopped short of repair and why F-15 blocks ATTR-1.

**Why aliases cannot fix it either.** Adding `"Naoki Saito"` to some artist's
`aliases` does not help: `artist_id` is recomputed by the **sync** from
`cards.illustrator`, which still says `sui`. The next sync run re-derives
`artist_id = 'sui'`. Any correction that lives only in the alias table is
erased by the next sync.

---

## 3. Current architecture

### 3.1 The effective layer is a total chokepoint

Verified on `main` @ `039662d`: **zero** direct reads of raw `public.cards` in
`src/`. Every consumer goes through `cards_effective`. One view change therefore
reaches 100% of consumers with no application-code change — the same property
that made CAT-3B minimal.

### 3.2 Artist membership resolution — three paths, and they differ

`src/services/cardService.js:88-131`:

| Path | Condition | Query |
|---|---|---|
| **Dynamic** | `entry.isDynamic` (user-added) | `artist_id.eq.<id>` **OR** `illustrator.in.(names)` |
| **FK** | curated entry with `artistId` | `.eq('artist_id', <id>)` — **FK only** |
| **ILIKE** | neither | `illustrator.ilike.%name%` (legacy fallback) |

**This asymmetry is the crux of the lifecycle question (§15).** A card with
`artist_id = NULL` is reachable by a *dynamic* artist through the illustrator
arm, but invisible to a *curated* artist, which matches on FK alone.

### 3.3 Sync writes exactly one table

`sync/sync-cards.mjs` writes only `public.cards`. `card_extras` appears nowhere
in the file. It *reads* `public.artists` (alias map, `:218`) and
`public.cards_effective` (identity guard, `:476`) — SELECT only. This is the
durability mechanism F-15 inherits unchanged (§14).

### 3.4 CAT-3B is the governing precedent

CAT-3B §3.4 explicitly flagged F-15 as out of its scope, noting `image_url` has
no derived companion column so the divergence class did not exist for images.
F-15 is that same slice for the column that *does* have a companion. The
precedent supplies: raw provider history untouched · correction outside the raw
row · **write-time admission, not continuous revalidation** · mandatory
provenance · fail-closed constraints · restrictive column ACL.

---

## 4. Requirements and invariants

The twelve invariants from the brief, mapped to where this design satisfies
them.

| | Invariant | Satisfied by |
|---|---|---|
| **I-1** | Raw provider attribution untouched in `public.cards` | §9 — correction lives in `card_extras` only |
| **I-2** | Correction survives catalog sync | §14 — sync writes only `cards`; `card_extras` is unreachable from it |
| **I-3** | Corrected illustrator cannot stay filed under a known-wrong raw `artist_id` | §11 — CASE discards `c.artist_id` whenever an override exists |
| **I-4** | Intentional `artist_id = NULL` representable | §11 — CASE, not COALESCE |
| **I-5** | Resolves to one known artist ⇒ effective `artist_id` must match it | §12 R2 + constraint C4 |
| **I-6** | Ambiguous resolution ⇒ admission fails closed | §12 R4 |
| **I-7** | Existing override behaviour not broken | §6 — mandatory backfill, gate B-2 must read 0/0 |
| **I-8** | No new client privilege on provenance | §13.3 — provenance columns withheld from the column ACL |
| **I-9** | Ownership authority untouched | §16 — no ownership object read or written |
| **I-10** | No `xya` dedup smuggled into attribution repair | §17 — named, quantified, explicitly deferred |
| **I-11** | Rollback restores pre-F-15 effective behaviour without rewriting raw `cards` | §19 |
| **I-12** | ATTR-1 repairs exactly 12 rows with no per-card special case in app or sync | §9 — data rows in one table; zero code branches |

---

## 5. Read-only production evidence

All figures measured 2026-08-20 via the read-only Supabase MCP. Reproduce with
`docs/sql/f15-attribution-correction-design-audit.sql` — a file that contains
**no DDL and no DML**, verified mechanically (20 `SELECT` / 6 `WITH` statement
starts, zero mutation keywords outside comments).

### 5.1 `card_extras` today — 10 columns, no artist override

`card_id` (PK, NOT NULL, FK→`cards` ON DELETE CASCADE) · `illustrator_override`
· `source_note` · `created_at` · `updated_at` · and the five CAT-3B image
columns. **There is no artist-association override of any kind.** That absence
is the gap.

Constraints: PK, the CASCADE FK, four CAT-3B image CHECKs (all-or-nothing,
non-empty `approved_by`, TCGdex host shape, source ≠ self), and the RESTRICT FK
on `image_override_source_card_id`.
Triggers: `card_extras_set_updated_at`, `card_extras_admit_image_override`.
RLS: enabled, not forced, exactly one policy — `card_extras_public_select`,
`SELECT`, `USING (true)`. **No write policy exists**, so anon/authenticated
cannot write regardless of grants.

### 5.2 `cards_effective` — repo and production agree

Live definition is CAT-2D.1 + CAT-3B: 14 columns, `illustrator` and `image_url`
COALESCEd through `card_extras`, `artist_id` raw from `c`, `security_invoker`,
and the `card_identity_resolution` alias exclusion. No drift.

### 5.3 The ACL — CAT-3B's narrowing is live

```
relacl:  postgres, service_role          (anon/authenticated NOT at table level)
column SELECT for anon + authenticated:  card_id, illustrator_override, image_url_override
withheld (no ACL):                       source_note, created_at, updated_at,
                                         image_override_{evidence,approved_by,approved_at,source_card_id}
```

**Design consequence.** `artist_id_override` must be added to the granted column
list or `cards_effective` — which runs with the caller's rights — breaks for
anon and authenticated. Provenance columns must stay off it (§13.3).

### 5.4 `artists` — ambiguity is currently impossible by data, not by schema

29 artist rows · 53 alias entries · **39 distinct normalised aliases** ·
**0 aliases shared across artists** (reconciles with ATTR-0 C-1) · 11 duplicate
aliases *within* the same artist row (harmless case variants) · 0 artists
without an alias.

Indexes on `artists`: **`artists_pkey` only**. There is **no unique constraint
on normalised aliases**. Today's zero-ambiguity is a property of the current
data, and nothing prevents a future `add_artist_to_archive` call or manual edit
from creating a collision. **This is precisely why R4 must fail closed** rather
than pick a winner (§12).

---

## 6. The five existing overrides and the migration they force

### 6.1 What is actually there

| card_id | raw illustrator | override | raw `artist_id` today | resolver gives | matches |
|---|---|---|---|---|---|
| `swsh11-185` | NULL | N-DESIGN Inc. | NULL | NULL | 0 |
| `swsh11-186` | NULL | Shinji Kanda | **`shinji-kanda`** | `shinji-kanda` | 1 |
| `swsh12-TG11` | NULL | Yuu Nishida | NULL | NULL | 0 |
| `swsh12.5gg-GG19` | Asako Ito | Asako Ito | **`asako-ito`** | `asako-ito` | 1 |
| `swsh12.5gg-GG69` | AKIRA EGAWA | Akira Egawa | **`akira-egawa`** | `akira-egawa` | 1 |

### 6.2 The regression the naive migration would cause — and the fix

Three rows hold a live `artist_id`. Adding `artist_id_override` as a nullable
column and switching the view in the same breath would evaluate the CASE's
override branch with a NULL override on all five rows, **removing
`shinji-kanda`, `asako-ito` and `akira-egawa` memberships**. Shinji Kanda's
curated Artist Page would quietly lose a card. That is an I-7 violation
delivered by a migration that looks additive.

**The fix is a mandatory ordered backfill.** Before the view is switched:

```
artist_id_override := resolve(illustrator_override)      -- for all 5 existing rows
```

Because the resolver's answer **already equals** today's raw `artist_id` on all
five rows — 5/5 agreement, 0 ambiguous — the backfill is **provably
behaviour-preserving**: two rows keep NULL, three keep their existing artist.
Nothing observable changes.

### 6.3 The migration gate

Query **B-2** in the audit SQL is the gate. It must return:

```
would_change_membership = 0
ambiguous_rows          = 0
```

**If either is non-zero, HOLD.** A non-zero `would_change_membership` means the
backfill would alter an existing membership and each such row needs an explicit
evidence-backed decision; a non-zero `ambiguous_rows` means R4 cannot decide.
Today both are 0 **under the corrected, aliases-only resolver** (§12 —
`docs/sql/f15-attribution-correction-design-audit.sql` B-1/B-2 no longer test
`artists.id`), so implementation may proceed — but the gate must be re-run
against production immediately before the migration, not trusted from this
document. Narrowing the resolver to aliases-only can only ever turn a match
into a non-match, never the reverse, so it cannot introduce a new
`would_change_membership` or `ambiguous_rows` hit that the broader two-clause
formula didn't already have — but the three matched legacy rows (§6.1) must
still be re-measured under the corrected query rather than assumed, since the
figures recorded here were captured before this correction.

### 6.4 Provenance for the five legacy rows

**Correction, from review.** An earlier draft had the backfill leave the three
provenance columns NULL on the five legacy rows and carved out a CHECK
exemption for "a row whose `artist_id_override` arrived through the
backfill." That is not enforceable: a declarative CHECK sees only a row's
current column values, never *how* they got there, so nothing could
distinguish a legitimately-exempt backfilled row from a future write that
simply omits provenance and claims the same exemption. That would have made
C1 (§12.2) a loophole, not a constraint.

**The backfill instead writes a complete, honest provenance bundle to all
five rows — there is no exemption, and C1 stays unconditional.**
`attribution_override_evidence` is stamped with a structured `jsonb` value
that says plainly what happened:
`{"derivation": "f15-legacy-backfill", "basis": "artist_id_override computed from the pre-existing illustrator_override via the aliases-only resolver (§12) to preserve pre-F-15 effective behaviour", "verified": false}` —
explicitly *not* an external-verification claim, which is the one thing that
would be dishonest to assert for these rows. `attribution_override_approved_by`
is set to the fixed literal `'system:f15-migration'` (non-empty, satisfies
C2, and self-evidently not a human reviewer). `attribution_override_approved_at`
is the migration's execution timestamp, not backdated.

This keeps §12.2's C1 a single all-or-nothing rule with **zero exceptions**,
applied identically to every row forever: legacy backfill, ATTR-1 repair, and
any future correction all satisfy the same constraint the same way. A future
maintainer distinguishes a legacy derivation from an externally-verified
correction by reading `attribution_override_evidence.derivation` /
`.verified`, not by the *absence* of provenance — because absence of
provenance is no longer a state any row can be in.

### 6.5 A latent hazard found in passing — recorded, not fixed

`swsh11-186` has raw `illustrator = NULL` but raw `artist_id = 'shinji-kanda'`,
which the sync **cannot** produce (`resolveArtistId(null) → null`). Three raw
rows are in this state; the other two (`swsh12.5-GG19`, `swsh12.5-GG69`) are
CAT-2D.2 alias rows already excluded from `cards_effective`, so only
`swsh11-186` is live.

**A future full sync would null that `artist_id`,** silently dropping the card
from Shinji Kanda's page — today, with or without F-15. F-15 *fixes* this as a
side effect: once `artist_id_override = 'shinji-kanda'` is backfilled, the CASE
takes the override branch and the effective value no longer depends on the raw
column at all. Recorded here as a pre-existing defect this design happens to
close, not as a new one it introduces. **No repair is performed in this slice.**

---

## 7. The twelve confirmed repair rows

Row-level detail: `docs/attr-0-evidence/f15-repair-impact.csv` (12 rows,
generated with fail-closed assertions against the committed Gate 2 evidence —
the id set must equal Gate 2's 11 `CONFIRMED_WRONG` plus `xyp-XY67a`).

### 7.1 Target resolution — every one is an intentional NULL

| card_id | current illustrator | current `artist_id` | verified illustrator | artist matches | expected `artist_id_override` |
|---|---|---|---|---|---|
| `g1-28a` | Naoki Saito | NULL | Ryo Ueda | **0** | **NULL** |
| `g1-73a` | Yusuke Ohmura | NULL | Naoki Saito | **0** | **NULL** |
| `xy10-111a` | Ken Sugimori | NULL | Naoki Saito | **0** | **NULL** |
| `xy10-43a` | PLANETA | NULL | Ryo Ueda | **0** | **NULL** |
| `xy4-65a` | Ayaka Yoshida | NULL | Ryo Ueda | **0** | **NULL** |
| `xy6-77a` | Ayaka Yoshida | NULL | TOKIYA | **0** | **NULL** |
| `xy7-75a` | Yusuke Ohmura | NULL | You Iribi | **0** | **NULL** |
| `xy9-107a` | Yusuke Ohmura | NULL | Naoki Saito | **0** | **NULL** |
| `xy9-98b` | Yusuke Ohmura | NULL | Sanosuke Sakuma | **0** | **NULL** |
| `xyp-XY150a` | Eske Yoshinob | NULL | Hasuno | **0** | **NULL** |
| `xyp-XY177a` | You Iribi | NULL | Hitoshi Ariga | **0** | **NULL** |
| `xyp-XY67a` | sui | **`sui`** | Naoki Saito | **0** | **NULL** |

All twelve are live in `cards_effective`; none currently has a `card_extras`
override. **Ambiguous targets: 0. Targets resolving to a known artist: 0.
Targets requiring intentional NULL: 12.** These zeros hold a fortiori under
the §12 resolver correction: dropping the `artists.id` match arm can only
turn a match into a non-match, never manufacture a new one, so a target that
resolved to 0 artists under the broader two-clause formula still resolves to
0 under the corrected aliases-only one. No re-measurement is required for
this section specifically.

### 7.2 Membership consequence

**Eleven rows: no FK membership change.** Effective `artist_id` is already NULL
and stays NULL. The correction moves the displayed illustrator only.

**One row — `xyp-XY67a` — is the entire membership blast radius.** It leaves
curated artist `sui`: **224 → 223** effective cards. This is the correct
outcome; the card is not by sui, which is exactly what ATTR-0 confirmed.

### 7.3 No illustrator string is destroyed

Every name the repair moves *away from* retains a large population — the
smallest is PLANETA at 47 remaining, the largest Ken Sugimori at 1,107. **No row
disappears from `illustrator_directory`**, so every one of those names remains
discoverable and addable via `add_artist_to_archive`. No discovery regression.

---

## 8. Architecture options considered

| | **A — `card_extras.artist_id_override`** | **B — derive from effective illustrator in the view** | **C — correct `cards.artist_id` / special-case sync** | **D — dedicated corrections table** |
|---|---|---|---|---|
| Correctness | ✅ explicit, per-row | ⚠️ correct only while aliases are unambiguous | ❌ raw history destroyed | ✅ explicit |
| Intentional NULL (I-4) | ✅ representable | ⚠️ NULL is derived, not *chosen* — indistinguishable from "unknown" | ✅ | ✅ |
| Fail-closed | ✅ write-time admission + CHECKs | ❌ ambiguity resolved silently at read time | ❌ | ✅ |
| Sync durability (I-2) | ✅ sync never writes `card_extras` | ✅ | ❌ **overwritten every sync** | ✅ |
| Raw history (I-1) | ✅ untouched | ✅ | ❌ **violated** | ✅ |
| Alias ambiguity | ✅ fails closed once, at write | ❌ a later alias edit silently re-files cards | n/a | ✅ |
| Performance | ✅ one extra column on an existing LEFT JOIN | ❌ correlated subquery or join over `artists` per row, on the hot catalog view | ✅ | ⚠️ second LEFT JOIN |
| Query complexity | ✅ one CASE | ❌ view gains a resolver | ✅ | ⚠️ extra join |
| Migration complexity | ⚠️ backfill required (§6) | ✅ none | ❌ data rewrite | ⚠️ new table + RLS + ACL + grants |
| Rollback | ✅ restore view; data inert | ✅ | ❌ raw values not recoverable | ✅ |
| ACL/RLS impact | ⚠️ column ACL must be extended (§13.3) | ✅ none | ✅ none | ❌ whole new surface to secure |
| Effect on existing 5 | ⚠️ **needs backfill or regresses** | ✅ none | ❌ | ⚠️ needs backfill |
| Consistency with IV architecture | ✅ **exactly the CAT-3B pattern** | ⚠️ novel read-time derivation | ❌ contradicts CAT-3B | ⚠️ parallel enrichment surface |
| Over-generality | ✅ narrow | ✅ | ❌ | ❌ **a correction framework broader than needed** |

**Option B is the strongest rival and it fails on a specific point, not on
taste.** Deriving `artist_id` from the effective illustrator inside the view
would make the FK a *live function of the alias table*. Adding an alias to any
artist would then silently re-file cards catalog-wide with no write, no
provenance, and no review — and because `artists.aliases` has **no uniqueness
constraint** (§5.4), a future collision would be resolved arbitrarily at read
time on every query. It also cannot distinguish "deliberately no artist" from
"resolver found nothing", collapsing I-4. Write-time admission converts all of
that into a single reviewable decision.

**Option C violates I-1 and I-2 outright** — the sync rewrites `cards.artist_id`
from the raw illustrator on every run, so a correction there is erased, and
per-card exception logic in sync violates I-12.

**Option D is Option A with extra surface**: a second table needs its own RLS,
policies, grants, FK, trigger and join, to hold at most a few dozen rows that
are 1:1 with a `card_extras` row that already exists. It buys separation the
product has no use for and creates the generic framework the brief warns
against.

---

## 9. Selected architecture

**Option A.** Extend `public.card_extras`:

| Column | Type | Purpose |
|---|---|---|
| `artist_id_override` | `text` NULL, FK → `artists(id)` **ON DELETE RESTRICT** | the corrected artist association; **NULL is a meaningful value** |
| `attribution_override_evidence` | `jsonb` | structured external provenance |
| `attribution_override_approved_by` | `text` | who approved |
| `attribution_override_approved_at` | `timestamptz` | when |

`illustrator_override` is **reused, not duplicated** — it already carries the
corrected display string and already feeds the view.

**Why `ON DELETE RESTRICT`, matching CAT-3B §4.1.** An override's artist
reference is the record of a deliberate human decision. Cascading a delete would
silently convert a *verified* association into an intentional-NULL — an
indistinguishable, unexplained state change. RESTRICT forces the collision to
surface. (Deleting an artist row is not a routine operation; nothing in the app
does it.)

**Why not a new table.** `card_extras` is already the enrichment layer, already
1:1 with `cards`, already joined by the view, already RLS-enabled with the right
policy shape, already column-ACL'd, and already carries `illustrator_override`
— the exact value this correction pairs with. See §8, Option D.

---

## 10. Effective illustrator semantics

**Unchanged.**

```sql
COALESCE(ce.illustrator_override, c.illustrator) AS illustrator
```

F-15 changes nothing about the display path. This matters for review scope: the
only semantic change in the whole slice is the `artist_id` expression.

---

## 11. Effective `artist_id` semantics

```sql
CASE
  WHEN ce.illustrator_override IS NOT NULL THEN ce.artist_id_override
  ELSE c.artist_id
END AS artist_id
```

**Why COALESCE is wrong here — measured, not argued.**
`coalesce(ce.artist_id_override, c.artist_id)` cannot express "deliberately no
artist": a NULL override falls through to the raw value. On the twelve repair
rows — where the correct target is NULL on **12 of 12** (§7.1) — COALESCE would
retain the **known-wrong** raw `artist_id` on every one, violating I-3 and I-4
simultaneously. For `xyp-XY67a` it would leave the card filed under `sui`, which
is the precise defect F-15 exists to remove.

**The trigger is `illustrator_override IS NOT NULL`, not
`artist_id_override IS NOT NULL`.** The presence of an illustrator correction is
what makes the raw FK untrustworthy: the raw `artist_id` was derived from a
string we have now overruled. Once we overrule the string, we must overrule what
was derived from it. Keying on `artist_id_override` instead would make NULL
unrepresentable again, because a NULL override would be read as "no override".

**Consequence, stated plainly:** an `illustrator_override` **always** governs
`artist_id`. There is no way to correct the display string and leave the FK
alone. That is the point (I-3) — and §6.2 is why the existing five rows must be
backfilled before this expression goes live.

**Column order and count are preserved.** The view keeps its 14 columns with
`artist_id` last, `security_invoker = true`, the `card_extras` LEFT JOIN and the
CAT-2D.1 alias exclusion. Exactly one expression changes.

---

## 12. Admission and fail-closed rules

Admission is enforced by a `BEFORE INSERT OR UPDATE` trigger, **SECURITY
INVOKER**, alongside declarative CHECKs. **Correction, from review**: an
earlier draft of this design and its audit SQL described the resolver as
matching `lower(btrim(...))` against `artists.id` **or** `artists.aliases`.
That is not what the sync does. `loadArtistAliasMap()`
(`sync/sync-cards.mjs:217-227`) builds its lookup map **exclusively** from
`artists.aliases`; `resolveArtistId()` (`:229-232`) consults only that map and
never reads `artists.id`. `artists.id` is a hyphenated slug (e.g.
`shinji-kanda`), not a display string, so it would rarely coincide with a
normalised illustrator name anyway — but "rarely" is exactly the fail-open
gap R4 exists to close (§5.4), and admission must not use a broader
matching contract than sync uses. **The admission resolver is therefore
aliases-only, byte-for-byte identical to `resolveArtistId()`**: exact match of
`lower(btrim(illustrator_override))` against `lower(btrim(alias))` for
`alias` in `artists.aliases`, nothing else. This is deliberate, not a
divergence to be justified — admission and sync now share one definition and
can never disagree about what a name means.

| | Rule | Behaviour |
|---|---|---|
| **R1** | Determining the expected artist | Resolve `illustrator_override` via the normalised exact-match resolver against `artists.aliases` only — never `artists.id`, never fuzzy, never substring. |
| **R2** | Exactly **one** match | `artist_id_override` **must equal** that artist's id. Any other value → **reject**. (I-5) |
| **R3** | **Zero** matches | `artist_id_override` **must be NULL**. A non-NULL value → **reject**. (I-4) |
| **R4** | **More than one** match | **Reject — fail closed.** Never pick. (I-6) |
| **R5** | `artist_id_override` without `illustrator_override` | **Reject.** A bare FK override has no provenance and no display counterpart, and would be invisible in the view (§11). |
| **R6** | Removing `illustrator_override` | Must clear `artist_id_override` and the attribution provenance **in the same statement**. A CHECK enforces it; the row reverts cleanly to raw. |
| **R7** | Aliases change later | **Nothing re-runs.** See below. |

**R4 is not defensive boilerplate.** `artists.aliases` has no uniqueness
constraint (§5.4). Today `aliases_shared_across_artists = 0`, so R4 never fires
— but a single future `add_artist_to_archive` call or manual alias edit can
create a collision, and at that moment the difference between "reject" and
"pick the first one" is the difference between a visible failure and cards
silently filed under the wrong artist.

### 12.1 Write-time invariant, not continuous revalidation

**Admission runs once, at write, exactly as CAT-3B §4.3a.** It is **not**
re-derived on read and **not** re-checked on unrelated writes.

An UPDATE where all attribution fields are `IS NOT DISTINCT FROM OLD` must
**return without re-admission** — `IS NOT DISTINCT FROM` rather than `=`, or two
NULL bundles compare as changed and every unrelated edit re-admits. Editing
`source_note`, or setting an *image* override, must not drag an admitted
attribution correction back through R1–R4.

**Why this is right.** A correction records a human decision taken against
external evidence at a known moment. Continuous re-derivation would make it a
live function of the alias table — reintroducing Option B's failure mode through
the back door, and letting an unrelated alias edit invalidate or silently
re-point a reviewed correction. Withdrawing a correction is always allowed;
re-admitting is a **new decision** that must meet the current bar.

The cost is that a correction can become *stale* relative to a later-created
artist row. That is real, it is bounded, and §15 answers it with detection
rather than coupling.

### 12.2 Declarative constraints

- **C1 — all-or-nothing provenance, no exceptions.** Either `illustrator_override`
  + `attribution_override_{evidence,approved_by,approved_at}` are all present, or
  all three provenance fields are absent. This holds unconditionally for every
  row, including the five legacy overrides: the backfill supplies a real
  (system-authored, explicitly-labeled-as-derived) provenance bundle for them
  rather than being exempted from C1 (§6.4, §13.4). A declarative CHECK cannot
  see how a value arrived, so C1 must not depend on that — it can only depend
  on what is present in the row today.
- **C2 — non-empty `approved_by`.**
- **C3 — R5.** `artist_id_override IS NOT NULL` requires
  `illustrator_override IS NOT NULL`.
- **C4 — FK.** `artist_id_override` references `artists(id)` ON DELETE RESTRICT,
  so it can never name an artist that does not exist. R2 supplies the stronger
  condition — that it is the *right* artist.

---

## 13. Provenance model

### 13.1 Why `source_note` is not enough

`source_note` is free text. Its five existing values are honest but
unstructured — "TCGdex null for swsh11; verified against official Pokémon card
database". There is no way to answer *who approved this*, *when*, or *against
what evidence*, and no way to distinguish a verified catalog correction from an
unexplained manual string edit. For an attribution correction that **moves a
card between artists**, that is not sufficient.

### 13.2 Fields — three, not five

Deliberately **not** symmetric with CAT-3B. CAT-3B needed
`image_override_source_card_id` because its value was copied *from another
catalog row*; an attribution correction's authority is **external** (Bulbapedia
/ PkmnCards per-print evidence), so there is no internal source row to point at.
Adding one for symmetry would be a field with nothing true to put in it.

`attribution_override_evidence` (`jsonb`) should carry, per the ATTR-0b evidence
model: the verified illustrator, the primary and secondary exact-print source
URLs, the gate that confirmed it (`ATTR-0 §3` / `ATTR-0 Gate 2` / `ATTR-0b`), and
the committed evidence-CSV SHA-256 — the same artifact-hash convention CAT-2D.2
and the ATTR-0 manifests already use, which makes each correction traceable to
an immutable reviewed artifact rather than to a prose claim.

### 13.3 ACL — the new columns must not become public (I-8)

Following CAT-3B §4.3b exactly:

| Granted SELECT to anon/authenticated | Withheld |
|---|---|
| `card_id` | `attribution_override_evidence` |
| `illustrator_override` | `attribution_override_approved_by` |
| `image_url_override` | `attribution_override_approved_at` |
| **`artist_id_override`** ← must be added | (plus all existing withheld columns) |

`artist_id_override` **must** be granted: `cards_effective` is
`security_invoker`, so it reads with the caller's rights and the view breaks for
anon without it. It is also not sensitive — it is already published through
`cards_effective.artist_id`.

The three provenance columns must **not** be granted. Publishing them would tell
every anonymous visitor who approved each correction and when. **Not solved by
making the view definer-rights** — `security_invoker = true` stays; column grants
are the honest mechanism (CAT-2D.1 §3, CAT-3B §4.3b).

`service_role` keeps table-level access and needs it to author corrections. No
privilege is widened.

### 13.4 Provenance for the five legacy rows — concrete representation

**Correction, from review.** §6.4 explains why a C1 exemption for
backfilled rows is not enforceable (a stateless CHECK cannot see *how* a
value arrived) and would leave a permanent no-provenance loophole a future
unprovenanced write could claim. The chosen shape instead gives all five
legacy rows real provenance, so C1 (§12.2) needs no exemption at all:

| Field | Legacy-row value written by the §6.2/§18 backfill |
|---|---|
| `attribution_override_evidence` | `{"derivation": "f15-legacy-backfill", "basis": "artist_id_override computed from the pre-existing illustrator_override via the aliases-only resolver (§12) to preserve pre-F-15 effective behaviour", "verified": false}` |
| `attribution_override_approved_by` | fixed literal `'system:f15-migration'` — non-empty (C2), unambiguously not a human reviewer |
| `attribution_override_approved_at` | the migration's execution timestamp |

A future maintainer distinguishes the three classes of row that can now
exist — an ATTR-1 externally-verified correction, an F-15 legacy-backfilled
row, and (going forward, unwritable) an unprovenanced manual edit — by
reading `attribution_override_evidence.derivation` and `.verified`, never by
whether provenance is present, because C1 guarantees it always is.

---

## 14. Sync durability

**The correction survives sync, and the proof is structural, not behavioural.**

1. `sync/sync-cards.mjs` **writes exactly one table**: `public.cards`. It
   *reads* `artists` and `cards_effective`. `card_extras` appears **nowhere** in
   the file, in any form.
2. `mapCardToRow` emits 21 named keys and `upsertRows` issues
   `INSERT … ON CONFLICT (id) DO UPDATE SET` over exactly those columns, so a
   column absent from the payload is **structurally unwritable** by the routine
   path (CAT-3B §3.2, CAT-1 G1).
3. Sync therefore keeps recomputing raw `illustrator` and raw `artist_id`
   freely — which is correct, since `public.cards` **is** provider history
   (I-1) — while the effective layer keeps winning (I-2).

**No per-card exception logic enters sync.** I-12 holds: ATTR-1 becomes twelve
data rows in one table and zero code branches anywhere.

**A worked case showing the design actively protects correctness.** Take
`g1-28a`: raw illustrator `Naoki Saito` (wrong), corrected to `Ryo Ueda`.
Suppose a user later adds *Naoki Saito* to the archive. The next sync resolves
raw `g1-28a` to `artist_id = 'naoki-saito'`. Under the CASE, the effective value
is still `artist_id_override` (NULL) and the effective illustrator is still
`Ryo Ueda` — so the card correctly does **not** appear under Naoki Saito. The
override does not merely survive the sync; it **shields the card from being
re-filed under the wrong artist by it**.

---

## 15. Artist-directory lifecycle — decided explicitly

**The scenario.** Today: corrected illustrator = Artist X, no `artists` row,
effective `artist_id` = NULL. Later: the user adds Artist X to the archive. What
happens?

**Decision: immutable correction snapshot + dynamic runtime path + an explicit
detector. No read-time resolver, no continuous re-derivation.**

**Storing NULL does not permanently prevent convergence.** The evidence:

| corrected-to illustrator | effective cards today | FK-tagged | in `illustrator_directory` |
|---|---|---|---|
| Ryo Ueda | 451 | **0** | ✅ |
| Naoki Saito | 299 | **0** | ✅ |
| Sanosuke Sakuma | 194 | **0** | ✅ |
| Hitoshi Ariga | 168 | **0** | ✅ |
| TOKIYA | 94 | **0** | ✅ |
| Hasuno | 86 | **0** | ✅ |
| You Iribi | 60 | **0** | ✅ |

A corrected card with `artist_id = NULL` is in **exactly** the state its 60–451
siblings are already in. It is not an orphan class; it is the normal state of an
untracked illustrator.

**What happens when the user adds Artist X, step by step:**

1. The name is already in `illustrator_directory` (all seven are), so it is
   discoverable in "Find an illustrator" **today**.
2. `add_artist_to_archive` validates against `cards_effective.illustrator` —
   which, post-correction, contains the corrected name. The add **succeeds**.
   (§7.3 confirms no name is destroyed by the repair, so nothing becomes
   un-addable either.)
3. The RPC creates the `artists` row and a `user_tracked_artists` row. The
   roster entry is **dynamic** (`isDynamic: true`).
4. `cardService`'s dynamic path queries
   `artist_id.eq.<id> OR illustrator.in.("Artist X")`. The corrected card
   matches on the **illustrator arm immediately** — `artist_id = NULL`
   notwithstanding. **Convergence is immediate, with no backfill and no sync.**

**The one real gap, named.** If Artist X later becomes a **curated** roster
entry (`src/constants/artists.js`, `isDynamic` false), `cardService` uses the
**FK-only** path (§3.2) and would miss the corrected card, because its
`artist_id_override` is a snapshot NULL taken before the artist existed.

**How that is handled — detection, then a deliberate pass:**

- **E-1** in the audit SQL lists every correction whose intentional-NULL target
  has since become representable. Its output is a **queue**, not an error.
- Reconciliation is a reviewed maintenance step re-running the *same* resolver
  (R1–R4) — identical rules, so it can never admit something a fresh write
  could not.
- **E-2** asserts the permanent invariant (I-5 + R5) and must return zero rows
  forever.

**Why not a read-time resolver.** It would re-open Option B's failure mode — a
hot-path join, ambiguity resolved silently on every query, and I-4 collapsed
because a derived NULL is indistinguishable from a chosen one. Detection keeps
the coupling out of the read path while making staleness **observable rather
than silent**, which is the actual requirement.

**Practical note for ATTR-1:** promoting any of these seven to the curated
roster is not currently planned, and the E-1 queue makes the prerequisite
visible if it ever is.

---

## 16. Consumer impact audit

Every consumer of effective artist attribution, from a full sweep of `src/`,
`sync/`, production functions and production views.

| Consumer | Reads | Classification |
|---|---|---|
| **Artist Page — FK path** (`cardService`, curated w/ `artistId`) | `.eq('artist_id')` | **EXPECTED CORRECTION** — `sui` 224 → 223. The only membership change in the repair. |
| **Artist Page — dynamic path** (`cardService`, `isDynamic`) | `artist_id.eq` OR `illustrator.in` | **NO CHANGE** on repair; carries convergence for corrected cards (§15) |
| **Artist Page — ILIKE fallback** | `illustrator.ilike` | **NO CHANGE** — string path, unaffected by `artist_id` |
| **`illustrator_directory`** (Explore/Find an illustrator) | `max(artist_id) group by illustrator` from `cards_effective` | **EXPECTED CORRECTION** — counts shift with the illustrator string; no row created or destroyed (§7.3) |
| **`add_artist_to_archive`** RPC | `cards_effective.illustrator` | **NO CHANGE** — every affected name retains ≥47 cards, so all stay addable |
| **`get_active_import_snapshot_read_model`** (OL-0D, Owned Library) | projects `ce.artist_id`; **filters** `p_artist_id is null or cat_artist_id = p_artist_id` | **POTENTIAL REGRESSION — currently inert.** No caller passes `artistId` (always `null`), so the filter never runs today. If an artist filter is ever built, a NULL-`artist_id` card cannot match it. Semantically correct, but must be designed for. |
| **`binderService`** | selects `artist_id` in `CARD_COLS` | **NO CHANGE** — projection only, no filter |
| **`cardAdapter`** → `card.artistId` | passthrough | **NO CHANGE** — **nothing in the app reads `card.artistId`** (verified) |
| **`catalogIndexLoader`** | explicitly sets `illustrator: null, artist_id: null` | **NO CHANGE** — structurally cannot see either |
| **Hunt Board / CardModal / shared surfaces** | no `artist_id` reference | **NO CHANGE** |
| **Ownership authority** (`get_active_snapshot_owned_card_ids`, import rows, binder membership) | no artist attribution | **NO CHANGE** (I-9) |
| **`sync-cards.mjs`** | writes `cards` only | **NO CHANGE** (I-2, §14) |

**Completeness.** Only **two** production functions reference `artist_id` or
`cards_effective` (`add_artist_to_archive`, `get_active_import_snapshot_read_model`);
audit query **D-1** re-derives that list and a third result means this audit is
stale. There are **zero** direct reads of raw `public.cards` in `src/`.

---

## 17. XYA duplicate consequence

ATTR-0b proved `xya-28a ↔ g1-28a` and `xya-107a ↔ xy9-107a` are duplicate
provider IDs for one physical printing. Measured in production, all twelve rows
of the six pairs are live in `cards_effective`, **all with `artist_id = NULL`**,
and every `xya` row has a **NULL image**.

**Quantified consequence of the repair:**

- `g1-28a` becomes `Ryo Ueda`, matching `xya-28a` → `Ryo Ueda` string count
  451 → **454** (this pair plus `xy10-43a` and `xy4-65a`).
- `xy9-107a` becomes `Naoki Saito`, matching `xya-107a` → `Naoki Saito` nets
  299 → **302** (four join, `g1-28a` leaves).
- **Two pairs converge**, so one physical card is counted twice under one name.
  **Four of six pairs already double-count today** (5ban Graphics ×3, Toyste
  Beach ×1) — a **pre-existing** condition, not one ATTR-1 creates.
- No curated Artist Page is affected: none of these names has an `artists` row,
  so the duplication is visible only in illustrator-string counts and in a
  *dynamic* Artist Page if one of these artists is later added.

**This does not block attribution correction** and is explicitly **not solved
here** (I-10). No alias is created, no `xya` row is deduplicated, no provider
history is deleted. It remains a **later Catalog Trust identity slice**, to be
sequenced before the overall Catalog Trust Exit Gate.

---

## 18. Proposed implementation sequence — DESIGN ONLY

**Nothing below is authored, executed, or staged in this PR.** No migration file
exists; this is the shape a future approved slice should take.

| # | Step | Gate |
|---|---|---|
| 0 | Re-run the ACL/shape preflight (audit **A-1…A-5**) | Production must match §5 |
| 1 | Add the four columns, nullable, no default; add FK + C1–C4 | Additive, idempotent |
| 2 | **Backfill `artist_id_override` plus the full provenance bundle for the 5 existing rows** (§6.2, §6.4/§13.4 — no C1 exemption) | **B-2 must read 0 / 0 — else HOLD** |
| 3 | Verify: 5 rows backfilled with `artist_id_override` **and** all three provenance fields set; expected effective `artist_id` unchanged for all 5 | Row-for-row equality vs. a pre-migration snapshot; C1 satisfied on all 5 |
| 4 | Add the admission trigger (R1–R7) | SECURITY INVOKER |
| 5 | Rebuild `cards_effective` from the **live** definition, changing exactly one expression | 14 columns, order preserved, `security_invoker`, alias exclusion intact |
| 6 | Extend the column ACL with `artist_id_override`; withhold provenance (§13.3) | anon/authenticated read the view successfully; provenance unreadable |
| 7 | Validation suite (§20) | All pass |

**Ordering is load-bearing.** Step 2 **must** precede step 5, or three existing
artist memberships vanish the moment the view is replaced (§6.2). Steps 1–6
belong in **one `BEGIN; … COMMIT;`** — columns, constraints, trigger, backfill,
view and privileges are a single logical unit, and PostgreSQL makes DDL and
GRANT/REVOKE transactional. The worst half-applied shape is the view rewritten
before the backfill lands.

**ATTR-1 is a separate slice.** It writes twelve rows through this channel and
must be separately reviewed and approved. F-15 creates the channel and populates
nothing beyond the five-row behaviour-preserving backfill.

---

## 19. Rollback

Two levels, following CAT-3B §6, and **neither rewrites raw `cards`** (I-11).

| Level | Action | When |
|---|---|---|
| **1 — preferred functional** | Restore the pre-F-15 view (`c.artist_id` raw); **keep** the columns and the restrictive ACL | Default. Fully restores prior effective behaviour; correction data goes inert but is preserved |
| **2 — full** | Level 1, then drop the four columns and the trigger, **then** restore the prior column-ACL shape | Only when abandoning the channel entirely |

⚠ **Order is load-bearing in Level 2**, exactly as in CAT-3B: adjusting grants
while provenance columns still exist risks exposing them during what is meant to
be a safety operation.

**Level 1 is safe with correction rows present.** The raw `cards.artist_id`
values were never modified (I-1), so reverting the view restores exactly the
pre-F-15 effective state — including, for `xyp-XY67a`, its membership of `sui`.
Correction rows survive and re-activate if the view is re-applied. **No
correction data is lost at Level 1.**

If F-15 ships before ATTR-1, rollback loses nothing at all: the only rows
touched are the five backfilled ones, whose backfilled values reproduce the
behaviour the rollback restores.

---

## 20. Validation plan for the future implementation

| # | Check | Proves |
|---|---|---|
| **V-1** | Row-for-row diff of `(id, illustrator, artist_id)` from `cards_effective` before vs. after, over all 23,588 rows | **Zero** differences. F-15 changes no rendered value by itself. |
| **V-2** | The 5 override rows: effective `artist_id` after == snapshot before | I-7 non-regression, per row |
| **V-3** | `shinji-kanda`, `asako-ito`, `akira-egawa`, `sui` FK counts unchanged (`sui` = 224 pre-ATTR-1) | No membership moved by F-15 |
| **V-4** | Admission negative tests: R2 wrong artist → reject · R3 non-NULL with 0 matches → reject · R4 ambiguous → reject · R5 bare FK → reject · C1 missing provenance → reject | Fail-closed is real, not documented |
| **V-5** | Admission idempotence: UPDATE `source_note` alone on a row with a correction succeeds without re-admission | §12.1 — no unrelated-write coupling |
| **V-6** | `select ... from cards_effective` as `anon` succeeds; direct select of the three provenance columns as `anon` **fails** | I-8 |
| **V-7** | View shape: 14 columns, order preserved, `security_invoker`, alias exclusion present; exactly one expression differs from the live definition | No silent CAT-2D.1/CAT-3B revert |
| **V-8** | Durability (non-production): write a correction, run a sync over its set, re-read | I-2 |
| **V-9** | **E-2** returns zero rows | I-5 / R5 invariant holds |
| **V-10** | `npm.cmd run build` | Runtime untouched (expected: no `src/` change at all) |

V-1 is the headline: like CAT-3B, a correctly-built F-15 changes **zero**
rendered values on deployment. Every visible change belongs to ATTR-1.

---

## 21. Explicit non-goals

This branch is **design + read-only evidence**. Nothing below was done, and
nothing below was partially done.

- **No production write of any kind.** No `UPDATE`, `INSERT`, `ALTER`, or
  migration executed. The Supabase access used is **read-only**.
- **No executable mutation SQL authored.** The one SQL file added contains no
  DDL and no DML — verified mechanically (§5).
- `cards_effective` **not** modified. `card_extras` **not** altered. No column,
  constraint, trigger, index, RLS policy, or grant changed.
- **The 12 confirmed rows are not repaired.** No `illustrator_override`, no
  `artist_id_override`, no `card_extras` row written.
- No change to `cards`, `artists`, artist aliases, or `user_tracked_artists`.
- **ATTR-1 not opened.** No repair migration authored.
- No runtime source modified — `src/**` and `sync/**` are untouched (zero files).
- **Catalog sync remains paused** — not resumed, not triggered.
- No `xya` alias, dedup, or provider-history deletion (I-10).
- No artist created; no alias added or edited.
- IMG-0 not started. NAV-1 not started.
- The ATTR-0 / Gate 2 / ATTR-0b evidence files are **unmodified**; F-15 is
  additive.
- Canonical state docs (`CURRENT_STATE.md`, `DECISION_LOG.md`,
  `ARCHITECTURE.md`, `ROADMAP.md`) deliberately **not** updated — per AGENTS.md,
  that is a closeout step after deployment, not a design step.

---

## 22. Recommended next slice

1. **Review this design** — specifically §6 (the mandatory backfill and its
   gate), §11 (CASE vs COALESCE), §12 (admission), §13.3 (ACL), and §15 (the
   lifecycle decision).
2. **F-15 implementation slice**, on explicit approval: the §18 sequence, as one
   atomic script, validated by §20. It writes no corrections and must change
   zero rendered values (V-1).
3. **ATTR-1**, separately approved: write the twelve evidence-backed corrections
   through the channel — twelve `card_extras` rows, `illustrator_override` set,
   `artist_id_override` **NULL on all twelve** (§7.1), full attribution
   provenance attached. Expected visible effect: twelve corrected illustrators
   and exactly one membership change (`sui` 224 → 223).
4. **Later, separately:** the F-16 `xya` duplicate-identity slice (§17), then
   the 79-vs-37 Yellow A coverage question — both Catalog Trust, both before the
   Catalog Trust Exit Gate.

---

## Verdict

**PASS — F-15 IMPLEMENTATION DESIGN READY.**

One architecture is selected (Option A — `card_extras.artist_id_override` with
explicit CASE semantics and write-time admission), and production evidence
supports it at every load-bearing point rather than by analogy to CAT-3B.

- **Intentional NULL is solved** and is the dominant case: 12 of 12 targets
  resolve to zero artists, so `CASE` is required and `COALESCE` is
  demonstrably wrong.
- **The existing five overrides have a safe, deterministic migration path** —
  the resolver already agrees with today's raw `artist_id` on all five, 0
  ambiguous, so the mandatory backfill is behaviour-preserving. Gate B-2 must
  read 0/0 before the view switch.
- **The lifecycle question is answered explicitly**: immutable snapshot +
  dynamic-path convergence (immediate, evidenced) + an E-1 detector for the one
  real gap (curated promotion), with no read-time resolver and no continuous
  coupling.
- **Consumer impact is bounded**: one expected correction (`sui` 224 → 223),
  one currently-inert potential regression (the OL-0D artist filter), everything
  else NO CHANGE.
- **No unresolved dependency blocks implementation.**

F-15 changes no rendered value by itself. It creates the channel; ATTR-1 uses
it.

**Do not implement F-15 in this PR. Do not open ATTR-1 in this PR.**
