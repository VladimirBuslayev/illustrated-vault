# ATTR-0 — Artist Attribution Integrity Audit

**Verdict: HOLD — MORE VERIFICATION NEEDED.**

| | |
|---|---|
| Slice | ATTR-0 — artist attribution integrity audit (read-only) |
| Type | Catalog trust audit. **No implementation, no repair.** |
| Branch | `audit/attr-0-artist-attribution-integrity` |
| Base | `main` @ `70037bfc8aa2c8a0c77d12b4211e0ef1cc38736f` |
| Production mutations | **none** |
| Catalog sync | **remains paused** — not resumed, not triggered |
| Evidence | `docs/sql/attr-0-artist-attribution-audit.sql` (read-only) · `docs/attr-0-evidence/` · `scripts/attr0-variant-attribution-probe.mjs` |
| Seed case | `xyp-XY67` / `xyp-XY67a` (Jirachi) — **CONFIRMED WRONG**, see §3 |
| Correction pass | 2026-08-20 — Gate 1 measured against production (§5); XY67a promoted to CONFIRMED WRONG on a recorded external source (§3); D-4 Artist Page interpretation corrected to split curated vs. dynamic runtime paths (§5, §9) |

---

## 1. Executive verdict

**HOLD — MORE VERIFICATION NEEDED.**

Three findings, in order of how much they should change the plan.

**1. The seed defect is UPSTREAM, not Illustrated Vault logic.** TCGdex itself
serves `illustrator: "sui"` for `xyp-XY67a`. Illustrated Vault stores what the
provider said, per card, with no inference. The catalog is faithfully carrying
bad provider data. That is the good outcome — it rules out the STOP verdict.

**2. XY67a is not isolated. It is one member of a small, fully enumerated risk
class.** Across all 218 TCGdex sets there are exactly **37** suffix-variant
printings; **23** have a base printing in the same set; **21** of those assert a
single illustrator across two printings whose artwork files are not identical.
XY67a is one of the 21. The class is bounded and completely listed — membership
alone is *suspicion*, not guilt, and this audit could not itself verify
authorship for any of them.

**Correction (2026-08-20):** an external review recorded a source —
Bulbapedia's print history for Jirachi (XY Promo 67), listing XY67 as Illus. sui
and the XY67a Full Art / Yellow A Alternate as Illus. Naoki Saito — and that
source is enough to satisfy this audit's own promotion bar (§3, §10 "Gate 2"):
*"a recorded source, not my agreement."* XY67a is promoted to **CONFIRMED
WRONG**. The other 20 R1 families remain SUSPECT pending the same treatment.

**3. ⚑ The blocking finding: `illustrator_override` cannot repair an artist
association.** `cards_effective` COALESCEs the override into `illustrator` but
takes `artist_id` **straight from `cards.artist_id`**. An override changes the
name a card *displays* and never the artist it is *filed under*. Setting
`illustrator_override = 'Naoki Saito'` on XY67a would produce a card that reads
"Naoki Saito" while still appearing on sui's Artist Page and still counting
toward sui's totals — strictly worse than the current state, which is at least
self-consistent.

This is **CAT-0 F-15**, already documented and downgraded to P3 with an explicit
trigger: *"if `card_extras` were ever used at scale — for example as a durable
channel for illustrator enrichment — this becomes P1 immediately."* ATTR-0 is
that trigger. **F-15 should be re-escalated to P1.**

So the hold is doubly determined. Even if the evidence were sufficient — it is
not — the repair mechanism the brief hoped to use does not do the job.

> **Why not STOP.** The STOP verdict is reserved for "Illustrated Vault logic
> can systematically assign cards to the wrong artist." It does not, today: the
> ingestion path is exact, per-card, and inference-free, and it faithfully
> reproduces upstream. F-15 is a repair-capability gap, not a mis-assignment
> engine — it only produces a wrong association once somebody writes an
> override, and no such override exists. If a reviewer reads F-15's
> display/filing split as itself constituting systematic mis-assignment, the
> verdict becomes STOP; I record the reasoning so that call can be made
> explicitly rather than inherited from my wording.

---

## 2. Attribution architecture

Traced from current code and current SQL, not from prose.

```
TCGdex card.illustrator
  │  sync/sync-cards.mjs :: mapCardToRow
  │    illustrator: card.illustrator ?? null          ← verbatim, per card
  ▼
public.cards.illustrator ─────────────────────────────────────┐
  │                                                            │
  │  resolveArtistId(card.illustrator, aliasMap)               │
  │    aliasMap.get(illustrator.trim().toLowerCase())          │
  │    built from public.artists.aliases                       │
  ▼                                                            │
public.cards.artist_id                                         │
  │                                                            │
  │                          public.card_extras                │
  │                            .illustrator_override ──────────┤
  │                                                            │
  ▼                                                            ▼
cards_effective.artist_id                    cards_effective.illustrator
  = c.artist_id            ⚠ NO OVERRIDE       = coalesce(ce.illustrator_override,
                             PARTICIPATES                    c.illustrator)
  │                                                            │
  ▼                                                            ▼
Artist Page membership                              Displayed illustrator,
cardService.fetchArtistCards                        illustrator_directory
  .eq('artist_id', entry.artistId)
```

### Source of truth at each stage

| Stage | Source | Matching | Overridable |
|---|---|---|---|
| `cards.illustrator` | TCGdex, verbatim per card | none — direct assignment | no (sync-owned) |
| `cards.artist_id` | `resolveArtistId()` at sync time | **exact** on `lower(trim(illustrator))` vs `artists.aliases` | no (sync-owned) |
| `card_extras.illustrator_override` | human-authored | n/a | **yes** — this is the channel |
| `cards_effective.illustrator` | `coalesce(override, raw)` | n/a | **yes** |
| `cards_effective.artist_id` | `c.artist_id`, passed through | n/a | **⚠ NO** |
| Artist Page membership | `.eq('artist_id', …)` | exact FK | follows `artist_id`, so **no** |

### Where a wrong attribution can enter

1. **Upstream** — TCGdex serves a wrong `illustrator`. Propagates verbatim into
   `cards.illustrator`, then deterministically into `artist_id`, then into
   Artist Page membership. **This is the seed defect's mechanism.**
2. **Alias content** — `artists.aliases` claiming a string that belongs to a
   different artist would file cards under the wrong artist. The *matcher* is
   exact and cannot invent a match; the *alias list* is human-curated and is the
   real exposure. Query **C-1** tests it; expected zero.
3. **F-15 divergence** — an `illustrator_override` desynchronises display from
   filing. Query **B-1/B-2** measure it; CAT-0 measured zero contradictions
   across 5 rows.
4. **Directory collapse** — `illustrator_directory` does
   `max(artist_id) group by illustrator`. If one illustrator string ever carried
   two `artist_id`s, the directory silently shows one. Query **C-3**; expected
   zero.

### Explicitly *not* a risk

- **No cross-printing inheritance exists.** `mapCardToRow` reads each card's own
  `illustrator`. No variant can inherit metadata from a sibling printing. This
  was the primary hypothesis behind the brief's "did XY67a copy from XY67?" and
  it is **falsified in code**.
- **`resolveArtistId` is not fuzzy.** Exact normalised equality only.
- **The ILIKE fallback is currently dead.** `cardService.fetchArtistCards` has a
  third branch using `illustrator.ilike.%name%` — substring matching, which
  *could* create false membership. It is reached only for roster entries with no
  `artistId`, and **all 20 entries in `src/constants/artists.js` carry one**, as
  do dynamic entries. Latent, not active. Flagged in §7 so it is not
  accidentally revived.

---

## 3. XY67 / XY67a root cause

**Determination: UPSTREAM DEFECT, and — as of the 2026-08-20 correction —
CONFIRMED WRONG. Illustrated Vault is faithfully carrying bad provider data.**

Read-only probe of TCGdex on 2026-08-20:

```
GET /v2/en/cards/xyp-XY67   → {"illustrator":"sui", "name":"Jirachi", …}
GET /v2/en/cards/xyp-XY67a  → {"illustrator":"sui", "name":"Jirachi", …}
```

The provider asserts `sui` for **both** printings. Chain of custody:

| Question | Answer | Evidence |
|---|---|---|
| Did XY67a inherit metadata from XY67? | **No** | `mapCardToRow` assigns `card.illustrator` per card; there is no sibling lookup anywhere in the sync |
| Same ingestion rule for both rows? | **Yes** — and that is correct behaviour | both are ordinary `xyp` cards on the same upsert path |
| Did a normalisation step introduce it? | **No** | the only transform is `trim().toLowerCase()` **for FK lookup**; the stored string is untouched |
| Is `artist_id = 'sui'` correctly derived? | **Yes** | exact alias match on `"sui"`; the FK faithfully reflects the illustrator string it was given |
| Is Illustrated Vault causing this? | **No** | every stage is a faithful carry of an upstream assertion |

**The artwork is not identical.** The two printings' `high.webp` assets differ:

| Card | SHA-256 (16) |
|---|---|
| `xyp-XY67` | `6af5a8a9839a505b` |
| `xyp-XY67a` | `20d1d06a8a406693` |

> **What that does and does not prove.** It proves the image **files** differ. It
> does **not** prove the **artwork** differs — a stamped promo reprint or a
> re-encode of one artwork also produces different bytes. Byte difference is a
> risk signal, not authorship evidence.

**On the Naoki Saito attribution — promoted to CONFIRMED WRONG, 2026-08-20.**
The original session of this audit did not independently verify the brief's
Naoki Saito claim and left XY67a at SUSPECT, on the stated rule that promotion
needs a recorded source, not agreement. An external review has since supplied
that source:

> Bulbapedia, "Jirachi (XY Promo 67)" print history: the regular `XY67` print is
> credited Illus. sui; the Full Art / Yellow A Alternate `XY67a` print is
> credited Illus. Naoki Saito.
> https://bulbapedia.bulbagarden.net/wiki/Jirachi_(XY_Promo_67)

This is a print-level external identification for the specific pair TCGdex
conflates, so it clears this audit's own bar. XY67a is reclassified
**CONFIRMED WRONG**: `artist_id = 'sui'` (and the displayed `illustrator =
'sui'`) is wrong for `xyp-XY67a`, whose correct illustrator is Naoki Saito. The
upstream determination is unchanged — TCGdex is the origin of the bad value,
Illustrated Vault carries it verbatim — so this row is simultaneously an
UPSTREAM DEFECT (cause) and CONFIRMED WRONG (this audit's classification of the
row). No write follows from this: **F-15 (§6, §8) still means there is no
mechanism that could correctly repair it today.** The other 20 R1 members are
unaffected by this source and remain SUSPECT.

*(Incidental, not evidence: `g1-28` Jolteon-EX is upstream-attributed to Naoki
Saito, so the name is present in the catalog and would resolve to an artist if
one exists. Noted only so a reviewer is not surprised by it.)*

---

## 4. Risk classes

| Class | Definition | Population | Disposition |
|---|---|---|---|
| **R1** | Suffix variant + base printing in same set + **one** illustrator across **non-identical** artwork files | **21 families** | **1 CONFIRMED WRONG** (`xyp-XY67a`, §3) + **20 SUSPECT** — the seed class |
| **R2** | Suffix variant where upstream already differentiates attribution | **2 families** | Lower risk; shows the provider *does* model per-variant illustrators |
| **R3** | Suffix variant with **no** base printing in the same set | **14 rows** | Lower risk — no sibling to inherit from |
| **R4** | `illustrator_override` rows where the override disagrees with `artist_id` (F-15) | **unmeasured** (CAT-0: 0 of 5) | Query **B-1/B-2** |
| **R5** | Alias strings claimed by two artists | **unmeasured** | Query **C-1**; expected 0 |
| **R6** | Illustrator string carrying >1 `artist_id` | **unmeasured** | Query **C-3**; expected 0 |
| **R7** | Same set + same name + multiple printings with differing illustrators | **unmeasured** | Query **D-1** |
| **R8** | Illustrator present, `artist_id` null — unreachable from any Artist Page | **unmeasured** | Query **C-4**; a *coverage* gap, not a false association |

**R2 matters more than its size.** `xy9-98a` (Delinquent) is attributed to Megumi
Mizutani while its base `xy9-98` is Yusuke Ohmura, and `xy8-146a` carries no
illustrator where its base has one. So when TCGdex asserts the *same* illustrator
across a variant pair, that is a positive data assertion, not a modelling default
— which slightly lowers the prior on R1 being systematically wrong. XY67a
demonstrates the assertion is nonetheless fallible.

---

## 5. Population counts

**Measured (upstream, read-only, 2026-08-20 — `docs/attr-0-evidence/`):**

| Measure | Value |
|---|---|
| TCGdex sets enumerated | 218 |
| Suffix-variant printings, all sets | **37** |
| — with a base printing in the same set | **23** |
| — with no base printing (lone) | **14** |
| Families asserting one illustrator across non-identical artwork (**R1**) | **21** |
| Families where upstream differentiates (**R2**) | **2** |
| Families where artwork bytes were identical | **0** |

**Gate 1 — measured, production, 2026-08-20.** An external review ran
`docs/sql/attr-0-artist-attribution-audit.sql` against production and reported
the figures below. This session still has no direct database access (no
Supabase MCP tools, no credentials); these numbers are recorded as reported,
not independently re-run, in the same spirit the rest of this audit records
external claims — attributed, not silently adopted as self-verified. Anyone
with production access should re-run the file to confirm before relying on
these for a repair decision.

| Query | Measure | Value |
|---|---|---|
| **A-1** | effective_cards | 23,588 |
| **A-1** | illustrator_present / illustrator_null | 21,639 / 1,949 |
| **A-1** | artist_id_present / artist_id_null | 3,564 / 20,024 |
| **A-1** | illustrator_present_artist_null | 18,075 — see corrected reading below |
| **A-1** | illustrator_null_artist_present | 0 |
| **A-2** | card_extras_rows / illustrator_overrides / image_overrides / source_notes | 195 / 5 / 192 / 5 |
| **A-5** | suffix_variant_rows / with_base / lone | 37 / 23 / 14 |
| **A-5** | same_illustrator (R1) / differing_illustrator (R2) / both_null | 21 / 2 / 0 |
| **B-2** | illustrator_override_rows / with_artist_id / contradictory_override_fk_pairs | 5 / 3 / 0 |
| **C-1** | duplicate normalized aliases across artists | 0 |
| **C-3** | illustrator strings carrying >1 artist_id | 0 |
| **D-3** | raw/effective illustrator differences | 4 |
| **F-1** | raw_cards / effective_cards / alias_rows / card_extras_rows | 23,780 / 23,588 / 192 / 195 |
| **E-1/E-2** | canonical-ownership cross-check | 1 resolved user context, 1 resolved batch; 0 owned suffix variants; 0 owned R1 suspect variants (no user IDs recorded) |

> **A-5 confirms the upstream proxy.** Production is exactly 37/23/14/21/2/0 —
> identical to the upstream-derived numbers above. `public.cards` and TCGdex
> have **not** diverged on this population; using upstream as a proxy for §2–§4
> was valid.

> **Corrected reading of `illustrator_present_artist_null` (A-1 = 18,075).**
> This is *not* "18,075 cards with a reachable artist that the FK can't find."
> Most illustrator strings in the catalog intentionally have no `artists` row —
> the roster is a curated-plus-user-tracked subset (currently 20 curated + a
> handful of dynamic entries), not a comprehensive artist directory. This figure
> is illustrator-string-present-but-no-FK; only the subset of those strings that
> resolve to an actual/tracked artist row is an Artist Page reachability gap
> (ranked by C-4, not yet run). Do not use 18,075 as a "cards invisible to their
> artist" count — see §9 for the corrected, artist-scoped figure (D-4).

> **B-2 confirms F-15 has no live contradiction today, but that doesn't close
> it.** 0 of 5 overrides currently disagree with `artist_id`. F-15 remains a
> real repair-path blocker (§6, §8) because the failure mode only appears once
> someone writes an override that changes the effective illustrator without a
> matching `artist_id` change — which is exactly what an XY67a repair would do.

### Classification

| Classification | Count | Members |
|---|---|---|
| **CONFIRMED WRONG** | **1** | `xyp-XY67a` — see §3 |
| **CONFIRMED CORRECT** | **0** | nothing was positively cleared |
| **SUSPECT** | **20 families** (+3 unmeasured adjacent classes: D-1, C-4, R3) | R1 minus `xyp-XY67a` |
| **STRUCTURAL DEFECT** | **1** | **F-15** — `illustrator_override` cannot move `artist_id`; a naive repair desynchronises display from filing |
| **UPSTREAM DEFECT** | **1 confirmed** | `xyp-XY67a`, same row as CONFIRMED WRONG — TCGdex currently reports `sui` for both `XY67` and `XY67a` |

**CONFIRMED WRONG is now 1, not 0.** XY67a was the obvious candidate from the
start, but this audit's hard rule is that promotion needs a *recorded source*,
not agreement with a risk pattern. That source has now been supplied and
recorded (§3: Bulbapedia's print history for Jirachi (XY Promo 67)), so the
promotion stands on the same evidentiary bar the rest of this audit uses. The
remaining 20 R1 families have no comparable source yet and stay SUSPECT — §10
Gate 2 is unchanged for them.

---

## 6. Confirmed defects

**Two: one per-row, one architectural.**

**Per-row: `xyp-XY67a` is misattributed.** `artist_id = 'sui'` (and the
displayed `illustrator`) should be Naoki Saito, per the source recorded in §3.
This is a confirmed data defect, not a repair — nothing in this audit writes to
it. See §8 for why `illustrator_override` cannot fix it alone.

**Architectural: F-15, re-escalated to P1.**

`cards_effective` (current definition, `docs/sql/cat-3b-1-durable-image-override.sql`):

```sql
coalesce(ce.illustrator_override, c.illustrator) as illustrator,   -- overridable
...
c.artist_id                                                        -- NOT overridable
```

CAT-0 rated this P3 because the override population was 5 rows, all
uncontradictory, and nothing depended on it. Its recorded escalation trigger has
now fired. Any ATTR-1 repair performed with `illustrator_override` alone would
produce cards that display one artist and are filed under another — a defect
class the product currently does not have.

XY67a is the first per-row attribution defect this audit confirms, and F-15 is
precisely why it cannot be repaired yet: writing `illustrator_override =
'Naoki Saito'` today would fix the display and leave `artist_id = 'sui'`,
producing exactly the display/filing split described above.

---

## 7. Suspect population

The complete R1 list is `docs/attr-0-evidence/variant-family-attribution.csv`
(21 rows, still tagged `risk_class = SUSPECT` in the evidence CSV — the CSV is
upstream evidence and is left as-generated rather than hand-annotated; see §3
and §5 for the one row, `xyp-XY67a`, now classified CONFIRMED WRONG in this
document). The remaining **20** span `xyp`, `xy2`, `xy3`, `xy4`, `xy6`, `xy7`,
`xy9`, `xy10`, `g1`, `sm4`.

Every one of the 20 needs the same thing: **artwork-level authorship
verification from a recorded external source.** Nothing in the catalog, in the
provider API, or in image bytes can supply it. XY67a is the worked example of
what that verification looks like (§3) — the same standard applies to the rest.

Two latent items, neither a current defect:

- **The ILIKE fallback** in `cardService.fetchArtistCards`
  (`illustrator.ilike.%name%`) is genuine substring matching and *would* create
  false Artist Page membership if reached. It is unreachable today because every
  roster entry carries an `artistId`. It should not be revived without bounding.
- **`illustrator_directory`'s `max(artist_id) group by illustrator`** silently
  picks a winner if one string ever carries two FKs. Query C-3 tests the
  precondition.

---

## 8. Existing repair mechanism

Direct answers to the brief's questions.

| Question | Answer |
|---|---|
| **Is `illustrator_override` sufficient?** | **No.** It fixes the displayed string and leaves `artist_id` untouched, so the card stays on the wrong Artist Page and in the wrong counts. Used alone it makes the product *less* coherent. |
| **Would artist alias rows also be required?** | Adding the correct name to the right artist's `aliases` does **not** help either: `artist_id` is written by the **sync**, from `cards.illustrator`. While upstream keeps saying `sui`, the next sync recomputes `artist_id = 'sui'`. |
| **Is a schema change necessary?** | **Almost certainly yes** — see the three options below. No existing column can durably express "this printing's artist is X" against a provider that says otherwise. |
| **Would correction alter raw `public.cards`?** | It must not. Writing `cards.artist_id` directly is **non-durable**: `mapCardToRow` rewrites `artist_id` on every full sync. This is precisely the argument CAT-3B made for images. |
| **Can corrections be fully provenance-recorded with existing fields?** | **No.** `illustrator_override` has only `source_note` (free text). There is no approved-by, approved-at, evidence, or source-of-claim field for illustrator — unlike the CAT-3B image bundle, which has all five. |
| **Risk of a future sync re-breaking the fix?** | **High for any raw write; nil for an override-layer fix.** `card_extras` is never written by the sync (asserted by `scripts/cat3b-durability.test.mjs`). Durability comes from staying out of `public.cards`. |

### The three shapes an ATTR-1 could take

Not a recommendation — the decision belongs to review.

1. **Derive `artist_id` from the effective illustrator in the view.** Change
   `c.artist_id` to a resolution against the *effective* string. Closes F-15 at
   the root and makes `illustrator_override` sufficient. Touches the hottest
   view in the product and changes Artist Page membership catalog-wide the
   moment it lands — needs its own before/after proof.
2. **Add an approved `artist_id_override` + provenance bundle to `card_extras`**,
   mirroring CAT-3B's five-column all-or-nothing pattern. Narrow, provenance-
   complete, durable, and precedented. Requires schema change and a new
   admission rule (what evidence admits an artist claim?).
3. **Do nothing to the data; correct upstream.** Report to TCGdex and wait. Zero
   risk, unbounded latency, no control.

Options 1 and 2 are not exclusive: 1 fixes the class, 2 supplies the evidence
channel. **Whichever is chosen, F-15 must be closed before any per-row
attribution repair is written.**

---

## 9. Product impact

**Correction (2026-08-20): Artist Page membership is not universally
`.eq('artist_id', …)`.** `src/services/cardService.js :: fetchArtistCards` has
two runtime paths, verified directly against the committed source:

- **Curated** — the 20 hardcoded `artistId` slugs in `src/constants/artists.js`
  (`yuka-morii`, `asako-ito`, …, `fukuda`). Query is exactly
  `.eq('artist_id', entry.artistId)`. For these, a false FK is a real,
  unmitigated membership failure — no illustrator-string fallback covers it.
- **Dynamic** (`entry.isDynamic`) — user-tracked artists added via
  `add_artist_to_archive` / `user_tracked_artists`, not in the curated list.
  Query is `artist_id.eq.<id> OR illustrator.in.(<exact names/aliases>)` — a
  card with no FK but a matching illustrator string is **still** returned, via
  the OR branch, until the FK catches up.

D-4 (§5) measured 962 display-string-vs-FK mismatches, **all 962 with
`artist_id` null** (0 filed to a *different* non-null artist), across 9
artists — `midori-harada`, `akira-komayama`, `suwama-chiaki`, `hikaru-koike`,
`minaminami-take`, `yoriyuki-ikegami`, `jiro-sasumo`, `satoma`, `aspara` — none
of which are in the 20 curated IDs above. All 962 are therefore on the
**dynamic** path and are **not** currently missing from their Artist Page; they
are reached through the illustrator-equality branch of the same query, pending
FK tagging by a future sync. A curated-only cross-check across the 20 constant
artist IDs returned 0 mismatches, 0 filed-null, 0 wrong-nonnull. **D-4 measures
FK-tagging incompleteness / reliance on the dynamic fallback, not a visible
membership failure**, given the code as committed today.

This does not change the F-15 risk (§6, §8): if `xyp-XY67a` received
`illustrator_override = 'Naoki Saito'` while `artist_id` stayed `sui`, a
*dynamic* Naoki Saito page would pick the card up via the exact-illustrator OR
branch while the *curated* sui page would still return it via the FK — dual,
contradictory membership, worse than any of the 962 dynamic-fallback rows
above because it is self-contradicting on screen. That is the scenario §6/§8
already describe; the 962 count was simply an overstated citation for it and is
retracted here.

For a card whose attribution is wrong, with **no** override applied (today's
state — display and filing agree, and both are wrong):

| Surface | Impact |
|---|---|
| **Artist Page membership (curated artist)** | Card appears on the **wrong** artist's page (`.eq('artist_id', …)`, no fallback) |
| **Artist Page membership (dynamic artist)** | Same wrong-page outcome via the FK branch; the OR/illustrator branch does not correct it because the illustrator string is also wrong |
| **Missing from correct artist** | The true artist's page **never** lists it (curated); dynamic pages for the true artist may still surface it later once/if the illustrator string is corrected |
| **Artist card counts** | Both artists' totals are off by one, in opposite directions |
| **`illustrator_directory`** | Wrong `card_count` for both strings |
| **Collection / owned-missing counts** | Per-artist owned/missing skewed **only if the card is owned** — Query E-1/E-2 (measured: 0 owned in the R1 suspect population) |
| **Hunt Board** | Affected only where hunts are artist-scoped; card surfaces under the wrong artist |
| **Binder grouping** | Artist-grouped views place the card under the wrong artist |
| **SharedBinder** | Unaffected — `isCardOwned` keys on name/number/set, never on artist |

**Scale.** 1 printing (`xyp-XY67a`) is confirmed wrong; at most 21 of 23,588
(~0.09%) are suspect or confirmed combined. This is a **trust** problem, not a
volume problem: the artist-first wedge means one visibly wrong attribution on
an artist page costs more than its row count suggests.

---

## 10. Recommended next slice

**Do not open ATTR-1 as a repair yet.** One gate remains.

**Gate 1 — run the audit SQL (read-only, ~10 minutes). ✅ Done, 2026-08-20.**
`docs/sql/attr-0-artist-attribution-audit.sql` has been executed against
production and §5 is filled in. A-3/A-5 confirm production matches the
37/23/14/21/2/0 upstream population exactly — no divergence. B-2, C-1 and C-3
all returned zero — no live F-15 contradiction, no alias collapse. E-1/E-2:
zero owned printings in the R1 suspect population. Nothing in Gate 1 re-scopes
this audit.

**Gate 2 — external verification, 20 remaining printings.** Establish
authorship for each remaining R1 family from a recorded source, the same way
§3 did for `xyp-XY67a`. This is the only way SUSPECT becomes CONFIRMED WRONG
for the rest of the class. It is human work, not automatable, and it is small.

**Then, and only then, ATTR-1 — with F-15 closed first.** Scope in dependency
order:

1. Close **F-15** (option 1 or 2 from §8) — architectural, provable, no per-row
   claims.
2. Repair `xyp-XY67a` plus any further printings confirmed by Gate 2, each
   carrying its source as provenance.
3. Re-assert Artist Page membership before/after for every affected artist
   (curated *and* dynamic — §9's runtime-path split matters here).

If Gate 2 confirms no further printings, ATTR-1 is a **one-row** repair
(`xyp-XY67a`) sitting on top of a one-view architectural fix — which is a good
trade, because the architectural fix is what makes every future attribution
correction possible. **ATTR-1 is not scoped or started in this PR.**

---

## 11. Explicit non-goals

Not done, deliberately:

- **no production write of any kind** — no override created, no `artist_id`
  changed, no `cards` row touched, no `card_extras` row touched;
- no schema, RLS, ACL, view, trigger or grant change;
- no repair migration authored — not even a draft;
- no sync change; **catalog sync remains PAUSED and was not triggered**;
- no runtime code modified; no Artist Page redesign;
- **no fuzzy artist substitution**, no inferring an illustrator from a sibling
  printing, no assuming a suffix variant shares artwork with its base;
- no general catalog cleanup; no IMG-0 work; no NAV-1 work;
- no attempt to resolve the 1,448 remaining image gaps (CAT-3B.1 closed that);
- **no promotion of the remaining 20 SUSPECT families to CONFIRMED WRONG** —
  `xyp-XY67a` was promoted on a recorded external source (§3), which is exactly
  the evidentiary bar the other 20 still have to clear; no other promotion was
  made, and no promotion here implies or performs a repair;
- no ATTR-1 scoping or repair started, for XY67a or any other row.

---

## 12. Reproducible evidence queries

| Artifact | Contents |
|---|---|
| `docs/sql/attr-0-artist-attribution-audit.sql` | 21 read-only queries, sections A–F. Verified: no INSERT/UPDATE/DELETE/DDL/DO/GRANT anywhere. |
| `scripts/attr0-variant-attribution-probe.mjs` | The upstream probe. `--check` re-verifies committed artifacts against TCGdex. Never contacts Supabase. |
| `docs/attr-0-evidence/variant-family-attribution.csv` | 23 family pairs: both illustrators, both artwork hashes, risk class. |
| `docs/attr-0-evidence/lone-suffix-variants.csv` | 14 suffix variants with no base printing. |
| `docs/attr-0-evidence/manifest.json` | Counts, SHA-256 per CSV, and the stated interpretation limit on byte comparison. |

Re-verify the upstream evidence at any time:

```bash
node scripts/attr0-variant-attribution-probe.mjs --check
```

The seed case, reproducible in two requests:

```bash
curl -s https://api.tcgdex.net/v2/en/cards/xyp-XY67  | jq '{id,name,illustrator}'
curl -s https://api.tcgdex.net/v2/en/cards/xyp-XY67a | jq '{id,name,illustrator}'
```

---

## Verdict

**HOLD — MORE VERIFICATION NEEDED.**

A bounded population of **21 variant families** exists and is fully enumerated.
**One**, `xyp-XY67a`, is now confirmed wrong on a recorded external source
(§3); the remaining **20** are still unverified SUSPECT. Gate 1 (§10) is
complete — production matches the upstream population exactly, and no
additional live F-15 contradiction or alias collapse was found. The existing
`illustrator_override` mechanism still **cannot** repair an artist association
because `artist_id` bypasses it entirely (**CAT-0 F-15, re-escalated to P1**) —
this is why even the one confirmed row, XY67a, is not repaired in this PR.

No write is justified yet. Verify the remaining 20 families externally, close
F-15, then repair — in that order. **Do not open ATTR-1 in this PR.**
