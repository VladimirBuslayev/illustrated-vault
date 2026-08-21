# ATTR-0b — Lone Suffix Variant Attribution + Printing Identity Audit

**Gate verdict: PASS — ATTRIBUTION EVIDENCE POPULATION CLOSED.**
**14-row result: FULLY VERIFIED (14 CONFIRMED_CORRECT · 0 CONFIRMED_WRONG · 0 UNRESOLVED).**
**F-16: FULLY BOUNDED. Repair population unchanged at 12 rows.**

| | |
|---|---|
| Slice | ATTR-0b — lone suffix variant attribution and printing identity (**evidence only**) |
| Type | Catalog trust verification. **No implementation, no repair, no production write.** |
| Branch | `audit/attr-0b-lone-suffix-verification` |
| Base | `main` @ `2a2c65eedf95d89e3388b3d9432ac003ee21140a` |
| Follows | PR #22 (ATTR-0) · PR #23 (ATTR-0 Gate 2) |
| Production mutations | **none** |
| Production reads | **none** — this gate never contacted Supabase |
| Catalog sync | **remains paused** — not resumed, not triggered |
| Evidence | `docs/attr-0-evidence/attr-0b-lone-suffix-verification.csv` · `docs/attr-0-evidence/attr-0b-manifest.json` |
| Population | the 14 lone suffix variants already enumerated by ATTR-0 (6 `xya` + 8 `ecard2`) |
| Row-level result | **14 CONFIRMED_CORRECT · 0 CONFIRMED_WRONG · 0 UNRESOLVED** |
| Identity result | **6 SAME_PHYSICAL_PRINTING · 8 DISTINCT_PHYSICAL_PRINTING · 0 UNRESOLVED_IDENTITY** |
| Gate verdict | **PASS — ATTRIBUTION EVIDENCE POPULATION CLOSED** |
| Checked at | 2026-08-20 |

---

## 1. Executive verdict

**PASS — ATTRIBUTION EVIDENCE POPULATION CLOSED.** All 14 canonical lone suffix
variants were investigated at the exact-printing level, each on two agreeing
sources. Every row resolved. **None of the 14 is a defect.**

Five findings, in order of how much they change the plan.

**1. F-16 adds zero rows to the repair population.** The six `xya` rows are the
duplicate-print identities that stopped Gate 2 — and all six are *correctly*
attributed. The upstream defect lives on the set-scoped side (`g1-28a`,
`xy9-107a`), which Gate 2 already caught and counted. The confirmed
attribution-defect population therefore **remains exactly 12 rows**: `xyp-XY67a`
plus Gate 2's eleven. ATTR-0b confirms the boundary rather than moving it.

**2. F-16 is fully bounded, and bounded by a general test rather than by
inspection.** The `xya` set is closed at exactly six cards upstream. More
importantly, every one of the **37** suffix-variant printings in the catalog was
tested for a same-collector-number counterpart in a *different* set, across all
**218** TCGdex sets. Exactly **12 rows** matched — the six `xya` rows and their
six twins. Nothing else in the catalog has a cross-set duplicate. The class is
closed, not merely unexamined (§9).

**3. The six `xya` links are the same physical printing, and the proof is the
collector number, not the artwork.** Bulbapedia's numbering rule is decisive:
Yellow A Alternate cards "have the same card number and expansion symbol of the
original print with the exception of a letter added to the card number" — they
are *not* a standalone expansion. So `xya-28a` is physically `28a/83`, a
**Generations** card, and `/83` is Generations' official card count. Six for
six, every denominator matches its expansion exactly (§4.2). No identity verdict
here rests on artwork similarity, card name, or the fact that both are Yellow A
Alternate.

**4. The eight `ecard2` rows are an entirely different phenomenon, and a benign
one.** Aquapolis issued four cards in two physical prints each, distinguished
**only by the e-Reader Dot Code data** printed on the card — same artwork, same
illustrator, different machine-readable payload. These are genuinely distinct
physical printings that legitimately deserve separate rows. There is no base
printing to be missing: no un-suffixed `50/147` was ever issued, so ATTR-0's
"lone" classification was *correct*, not a modelling gap (§5). The Gate 2 Yellow
A mechanism does not apply and was not applied.

**5. TCGdex is right where it is thin and wrong where it is rich.** The `xya`
records carry no image, no set logo, no set symbol, and a wrong release date —
and yet every one of their illustrator credits is correct. The set-scoped
records are complete, well-imaged, and carry the base illustrator's name on an
alternate artist's card. Data completeness is not data correctness, and any
future dedup that prefers "the richer record" would pick the wrong one on
`g1-28a` and `xy9-107a` (§9.3).

**This does not unblock repair.** CAT-0 **F-15** remains open and remains P1:
`illustrator_override` moves the effective illustrator but cannot move
`artist_id`. Twelve confirmed defects still sit behind a mechanism that cannot
repair them. **F-15 must close first.** ATTR-0b closes the *evidence* phase, not
the repair path.

---

## 2. Scope and canonical 14-row population

The population is the already-committed ATTR-0 evidence, taken as-is. Nothing
was added, nothing was dropped, and no broader population was folded in.

```
docs/attr-0-evidence/lone-suffix-variants.csv
  → 14 rows: suffix-variant printings with no base printing in the same set
  →  6 xya
  →  8 ecard2
```

The generator asserts all of this and **fails closed** if any of it differs: the
canonical file must hold exactly 14 rows, split exactly 6/8, with no duplicate
IDs; the output must hold exactly 14 rows; and the output ID set must be
*equal* to the canonical ID set — not a subset, not a superset.

| # | `xya` (6) | | # | `ecard2` (8) | |
|---|---|---|---|---|---|
| 1 | `xya-24a` | M Manectric-EX | 7 | `ecard2-50a` / `50b` | Golduck |
| 2 | `xya-28a` | Jolteon-EX | 8 | `ecard2-74a` / `74b` | Drowzee |
| 3 | `xya-54a` | Zygarde-EX | 9 | `ecard2-95a` / `95b` | Mr. Mime |
| 4 | `xya-55a` | M Lucario-EX | 10 | `ecard2-103a` / `103b` | Porygon |
| 5 | `xya-92a` | Trainers' Mail | | | |
| 6 | `xya-107a` | Professor Sycamore | | | |

**Currency check.** All 14 `current_illustrator` values were re-read against live
TCGdex on 2026-08-20. **Zero drift** from the committed ATTR-0 snapshot.

**Population re-derivation.** Independently of the committed file, the
suffix-variant rule was re-applied across **all 218 TCGdex sets**, yielding
**37 suffix variants / 23 with a same-set base / 14 lone** — identical to
ATTR-0 §5 and to Gate 1's production `A-5`. The 14 lone rows it produced are
exactly the canonical 14. The population is not stale and was not mis-derived.

**Out of scope, deliberately:** the 20 Gate 2 rows (already verified), the 2 R2
rows, the wider ~79-card Yellow A Alternate universe (§11), and any decision
about *what to do* with the duplicate identities. ATTR-0b gathers evidence;
architecture comes later.

---

## 3. Evidence standard

Every verdict required evidence at the level of the **exact physical printing**.
A source describing only "the card" without distinguishing the specific print
was recorded as corroborating the credit but not as resolving the variant.

**Primary — Bulbapedia per-card `Release information`.** Enumerates every
printing of a card with its own illustrator credit. Same evidence class ATTR-0
used for `xyp-XY67a` and Gate 2 used for all 20 of its rows.

**Print-identity — Bulbapedia `Yellow A Alternate cards (TCG)`.** This supplies
the *numbering rule* that makes the six identity claims provable rather than
inferred (§4.2). It is cited on all six `xya` rows and the generator refuses to
emit a `SAME_PHYSICAL_PRINTING` verdict without it.

**Secondary — PkmnCards per-print pages.** Independently maintained,
scan-backed. For the `xya` rows these are true per-print pages carrying the
exact collector number and an `Alternate` print-type tag. For the `ecard2` rows
they are **not** per-print — see the limitation below.

**Rejected as non-independent — `limitlesstcg.com`.** Gate 2 §8 demonstrated it
reproduces the same base-illustrator defect as TCGdex on every sampled row. It
was not consulted as corroboration here.

**Not used as evidence — TCGdex.** The feed under audit was read only to state
what it currently says and to re-derive the population. It never resolved a
verdict. Where TCGdex contradicts itself (§4.4), the contradiction is recorded
as a finding, not used as a vote.

Nothing in this gate infers authorship from base-print illustrator, sibling
printing, visual style, image hashes, card name, or set convention.

**Stated limitation — PkmnCards does not separate the Aquapolis dot-code
variants.** It keeps one page per Aquapolis number (`…/golduck-aquapolis-aq-50/`,
not `…-50a/`). So for the eight `ecard2` rows it corroborates the illustrator
credit on the physical card but supplies no a/b discrimination; **Bulbapedia
supplies that**, explicitly enumerating both prints and crediting the same
illustrator on each. This is recorded per-row in `evidence_notes` rather than
papered over. One useful accident: the PkmnCards Mr. Mime scan carries the
*95a* Poké-Body wording (§5.3), which identifies which print was scanned.

---

## 4. XYA findings — all six rows

### 4.1 Result

| # | `xya` row | card | current | verified | attribution | twin | twin current | twin verdict (Gate 2) |
|---|---|---|---|---|---|---|---|---|
| 1 | `xya-28a` | Jolteon-EX | Ryo Ueda | **Ryo Ueda** | CONFIRMED_CORRECT | `g1-28a` | Naoki Saito | CONFIRMED_WRONG |
| 2 | `xya-107a` | Professor Sycamore | Naoki Saito | **Naoki Saito** | CONFIRMED_CORRECT | `xy9-107a` | Yusuke Ohmura | CONFIRMED_WRONG |
| 3 | `xya-24a` | M Manectric-EX | 5ban Graphics | 5ban Graphics | CONFIRMED_CORRECT | `xy4-24a` | 5ban Graphics | CONFIRMED_CORRECT |
| 4 | `xya-54a` | Zygarde-EX | 5ban Graphics | 5ban Graphics | CONFIRMED_CORRECT | `xy10-54a` | 5ban Graphics | CONFIRMED_CORRECT |
| 5 | `xya-55a` | M Lucario-EX | 5ban Graphics | 5ban Graphics | CONFIRMED_CORRECT | `xy3-55a` | 5ban Graphics | CONFIRMED_CORRECT |
| 6 | `xya-92a` | Trainers' Mail | Toyste Beach | Toyste Beach | CONFIRMED_CORRECT | `xy6-92a` | Toyste Beach | CONFIRMED_CORRECT |

**All six `xya` rows are correctly attributed.** All six are
`SAME_PHYSICAL_PRINTING` with their set-scoped twin.

### 4.2 The twin mapping, verified rather than assumed

Gate 2 proposed six pairings. All six were re-verified from first principles and
**all six hold** — but the proof is the collector number, not the resemblance.

Bulbapedia's `Yellow A Alternate cards (TCG)`: these cards "have the same card
number and expansion symbol of the original print with the exception of a letter
added to the card number." They are reprints inside their original expansion,
**not a standalone set**. So the physical card's denominator identifies its
expansion, and the expansion identifies the twin.

| `xya` row | physical collector number | expansion named by Bulbapedia | that expansion's official card count | twin | match |
|---|---|---|---|---|---|
| `xya-28a` | **28a/83** | Generations | `g1` = **83** | `g1-28a` | ✅ |
| `xya-107a` | **107a/122** | BREAKpoint | `xy9` = **122** | `xy9-107a` | ✅ |
| `xya-24a` | **24a/119** | Phantom Forces | `xy4` = **119** | `xy4-24a` | ✅ |
| `xya-54a` | **54a/124** | Fates Collide | `xy10` = **124** | `xy10-54a` | ✅ |
| `xya-55a` | **55a/111** | Furious Fists | `xy3` = **111** | `xy3-55a` | ✅ |
| `xya-92a` | **92a/108** | Roaring Skies | `xy6` = **108** | `xy6-92a` | ✅ |

Six independent numeric agreements, each cross-checked against PkmnCards' own
per-print header (e.g. `XY › Generations (GEN) › #28a/83 : Ultra Rare :
Alternate`). The `local_id` on both provider rows is identical in every case.
This is print-identity evidence: same expansion symbol, same collector number,
same card. **`SAME_PHYSICAL_PRINTING` on all six.**

**Products and dates** (Bulbapedia): `28a`, `24a`, `54a`, `55a` were distributed
in the **Mega Powers Collection** (2017-05-19); `92a` and `107a` in **Battle
Arena Decks: Black Kyurem vs. White Kyurem** (2017-06-16). PkmnCards' release
dates match exactly.

### 4.3 Illustrator verification, per print

**The two contradictions — `xya` is right, the set-scoped row is wrong.**

- **`xya-28a` Jolteon-EX = Ryo Ueda.** Bulbapedia: regular 28/83 is Naoki
  Saito; the Japanese *The Best of XY* Full Art print is "new artwork by Ryo
  Ueda" and "was released in English as one of the new Yellow A Alternate cards
  within the Mega Powers Collection." PkmnCards `GEN #28a/83` reads
  `illus. Ryo Ueda`. `g1-28a` carries the base illustrator and is wrong —
  as Gate 2 found.
- **`xya-107a` Professor Sycamore = Naoki Saito.** Bulbapedia separates the
  prints: original art Yusuke Ohmura, Yellow A Alternate 107a/122
  "Illus. Naoki Saito". PkmnCards `BKP #107a/122` reads `illus. Naoki Saito`.
  `xy9-107a` carries the base illustrator and is wrong.

**The four agreements — genuinely new artwork by the same illustrator.** These
are not cases of an unchecked inherited credit; Bulbapedia states the identity
positively in each case.

- **`xya-24a`** — "Both prints feature artwork by 5ban Graphics"; gallery
  caption "Full Art print / Illus. 5ban Graphics". PkmnCards `PHF #24a/119`:
  `illus. 5ban Graphics`.
- **`xya-54a`** — regular is "artwork by 5ban Graphics", the alternate is "new
  artwork by 5ban Graphics" — a new illustration by the same hand. PkmnCards
  `FCO #54a/124`: `illus. 5ban Graphics`.
  *Note:* the separate `XY151` Zygarde-EX promo **is** by Eske Yoshinob. That is
  a different card ID, outside this population, and is recorded so a future
  reader does not mistake it for a missed defect.
- **`xya-55a`** — "Both prints feature artwork by 5ban Graphics". PkmnCards
  `FFI #55a/111`: `illus. 5ban Graphics`.
- **`xya-92a`** — "a new print with different artwork **by the same artist**".
  PkmnCards `ROS #92a/108`: `illus. Toyste Beach`.

### 4.4 What the contradiction means

For `28a` and `107a`, the catalog currently holds **one physical card under two
provider IDs with two different artists**. That is F-16 in its sharpest form.
ATTR-0b resolves the direction: the `xya` record is right and the set-scoped
record is wrong, on both rows, on two external sources each.

This is a *provider-internal* contradiction, not a source conflict, and it is
recorded in the CSV's `source_conflict` column as such — the external sources
never disagreed with each other.

---

## 5. ECARD2 findings — all eight rows

### 5.1 What `a` / `b` means here: Pokémon-e Dot Code variants

**Not** the Yellow A Alternate mechanism. Not alternate artwork. Not a different
illustrator.

Aquapolis (English e-Card Series, 2003-01-15) issued **four** cards in two
physical prints each, differing in the **Pokémon-e Dot Code** — the
machine-readable strip an e-Reader scans. Bulbapedia, on three of the four:

> "The 'a' and 'b' versions of this card are identical except for its Dot Code
> data."

| card | `a` dot code carries | `b` dot code carries |
|---|---|---|
| Golduck 50 | map data for the *Construction: Action* application | a hidden attack, **Spiral Damage** |
| Drowzee 74 | dot code data (contents not itemised) | dot code data (contents not itemised) |
| Mr. Mime 95 | the **Dream Eater** e-Reader mini-game | sound data for *Construction: Melody Box* |
| Porygon 103 | map data for *Construction: Action* (ID C-32-a) | a hidden attack, **Miracle Beam** (ID C-32-b) |

### 5.2 There is no missing base printing

`ecard2-50`, `ecard2-74`, `ecard2-95` and `ecard2-103` **do not exist upstream**
(TCGdex returns 404 for all four). No un-suffixed print was ever issued; the
card was only ever `50a` or `50b`. ATTR-0's "lone" classification is therefore
**correct** — these rows have no base because no base exists, which is a
different situation from the `xya` rows, whose base exists in another set.

Consequently the `a`/`b` pairs are **`DISTINCT_PHYSICAL_PRINTING`**, linked to
each other as siblings. They are legitimately two rows and must **not** be
deduplicated. The one relationship ATTR-0's same-set base model did not
represent is this sibling link — a benign omission, since both rows are real and
both are correctly attributed.

### 5.3 Illustrator verification

| row | current | verified | verdict | source |
|---|---|---|---|---|
| `ecard2-50a` / `50b` | Sumiyoshi Kizuki | **Sumiyoshi Kizuki** | CONFIRMED_CORRECT | Bulbapedia both prints; PkmnCards `AQ #50` scan |
| `ecard2-74a` / `74b` | Hisao Nakamura | **Hisao Nakamura** | CONFIRMED_CORRECT | Bulbapedia both prints; PkmnCards `AQ #74` scan |
| `ecard2-95a` / `95b` | Yukiko Baba | **Yukiko Baba** | CONFIRMED_CORRECT | Bulbapedia both prints; PkmnCards `AQ #95` scan |
| `ecard2-103a` / `103b` | Masako Yamashita | **Masako Yamashita** | CONFIRMED_CORRECT | Bulbapedia both prints; PkmnCards `AQ #103` scan |

**All eight correct.** Bulbapedia credits the same illustrator on both prints of
each card, and the PkmnCards scan confirms the credit on the physical card.

**Mr. Mime is the one card where the prints differ in printed text.** Bulbapedia:

> "Unlike the other three cards, where the 'a' and 'b' versions are identical
> except for their Dot Code data, the Energy Barrier Poké-Body on this card
> reads slightly differently."

95a reads "…the maximum amount of damage that can be reduced by Energy Barrier
**is 20**"; 95b reads "…**this ability is 20**." The PkmnCards scan carries the
95a wording, which pins that scan to the 95a print — recorded so the secondary
source's scope is not overstated for 95b.

That sentence is also **the bounding statement for this class**: "the other
three cards" fixes the population at exactly four cards / eight rows, and the
catalog scan (§9.1) returns exactly eight `ecard2` suffix rows. External and
internal enumeration agree.

---

## 6. Confirmed wrong attributions

**None. Zero of the 14.**

The confirmed attribution-defect population is **unchanged at 12 rows** —
`xyp-XY67a` (ATTR-0) plus Gate 2's eleven. ATTR-0b adds nothing to it.

This is the substantive result: the evidence-class expansion that stopped Gate 2
turned out to contain no additional defects. The defect is confined to the
set-scoped side of the duplicate pairs, which was already counted.

---

## 7. Confirmed correct attributions

**All 14.** Six `xya` (§4.1) and eight `ecard2` (§5.3), each on two agreeing
exact-print sources.

These must **not** be touched by ATTR-1. Two specifically deserve a guard rail:
`xya-28a` (Ryo Ueda) and `xya-107a` (Naoki Saito) are the *correct* records in a
contradictory pair. A repair pass that normalised each pair toward the
better-populated record — the one with an image, a set logo and a symbol — would
overwrite the right answer with the wrong one on both.

---

## 8. Unresolved rows and source conflicts

**Unresolved rows: none.** All 14 resolved. No row was forced; had a source
failed to identify the exact printing, the row would have been left
`UNRESOLVED`.

**External source conflicts: none.** Bulbapedia and PkmnCards agreed on every
row where both address the same question. Limitless was not consulted (§3).

**Two provider-internal contradictions**, recorded in `source_conflict` on
`xya-28a` and `xya-107a`: TCGdex disagrees with *itself* across two records for
one physical card. Resolved in favour of the `xya` record on external evidence
(§4.3). This is a finding about the feed, not a disagreement between sources.

**Confidence.** All 14 rows HIGH. No row rests on a single source.

**Residual evidence limits, stated plainly:**

- No row was verified against a physical card in hand or a first-party Pokémon
  publication. Bulbapedia and PkmnCards are reputable transcribers, not the
  publisher. This is the standard ATTR-0 accepted for `xyp-XY67a` and Gate 2
  held to; ATTR-0b holds to it too, but it remains a transcription chain.
- Both sources are English-language community references. A systematic error
  common to both would not be caught here.
- For the eight `ecard2` rows the secondary source does not discriminate the
  a/b prints (§3). The a/b discrimination rests on Bulbapedia alone. This does
  not weaken the *attribution* verdicts — both prints carry the same credit, so
  discrimination is not required to answer the illustrator question — but it is
  a single-source dependency for the *phenomenon* description and is recorded
  as such.

---

## 9. F-16 final characterization

**F-16 — duplicate printing identity across card IDs — is FULLY BOUNDED.**

### 9.1 The bounding evidence

Bounding was established by a **general test**, not by inspecting the six rows
already known.

1. **The `xya` set is closed at six.** TCGdex reports `cardCount.official = 6`,
   `total = 6`, and enumeration returns exactly the six canonical rows. No
   seventh `xya` row can exist to be missed.

2. **Generalised cross-set duplicate test.** Every one of the **37**
   suffix-variant printings was tested for a counterpart carrying the **same
   collector number in a different set**, across all **218** TCGdex sets — the
   detection rule ATTR-0's same-set family model lacked. Result:

   > **exactly 12 rows** have any cross-set counterpart: the 6 `xya` rows and
   > their 6 set-scoped twins. **No other suffix variant in the catalog has
   > one.**

   The six pairs are mutual and one-to-one. There is no third member, no
   unpaired row, and no chain.

3. **`ecard2` has zero cross-set counterparts.** All eight rows are
   Aquapolis-only. The class does not extend beyond the set.

4. **`xya` is the only synthetic grouping involved.** The 37 suffix variants
   live in 13 sets; twelve are real physical expansions (`g1`, `sm4`, `xy2`–
   `xy10`, `xyp`, `ecard2`) and only `xya` is a provider-side construct.

5. **The population itself re-derives exactly.** 37 / 23 / 14, matching ATTR-0
   §5 and Gate 1 production `A-5`. The model was incomplete; the *population*
   never was.

### 9.2 What `xya` actually is

Not a physical expansion. Bulbapedia's numbering rule (§4.2) is explicit, and
the provider record corroborates it: `xya` has **no logo**, **no symbol**, **no
image on any of its six cards**, and a `releaseDate` of **2014-02-05** —
inherited from the XY series, not the May 2017 – November 2020 window in which
Yellow A Alternate cards actually appeared. It is a thin metadata grouping
placed alongside real sets.

### 9.3 Why this matters more than the row count suggests

The correctness signal runs **opposite** to the completeness signal. The `xya`
records are impoverished — no art, no symbol, wrong date — and correct. The
set-scoped records are complete and, on two rows, wrong. Any future
reconciliation that resolves duplicates by preferring the richer record would
propagate the defect onto the one row that had it right.

A second trap: **card names do not match across three of the six pairs**
(`Zygarde EX` vs `Zygarde-EX`, `M Lucario EX` vs `M Lucario-EX`, `M Manectric
EX` vs `M Manectric-EX`). A dedup keyed on name equality would silently miss
half the pairs. Collector number plus set is the sound key; name is not.

### 9.4 F-16's disposition

F-16 is **real, enumerated, and not an attribution defect**. It contributes
**zero rows** to the repair population. After ATTR-1 repairs `g1-28a` → Ryo Ueda
and `xy9-107a` → Naoki Saito, all six pairs agree on illustrator and **both F-16
contradictions disappear**.

What remains after that is a pure catalog-identity question — six physical cards
each held twice — which is a **Catalog Trust** concern, not an attribution one,
and can be sequenced after ATTR-1 rather than before it.

**Explicitly not decided here:** whether `xya` rows should be aliased,
deduplicated, or accepted as upstream artefacts. ATTR-0b was told not to assume
the CAT-2D.2 alias mechanism applies merely because both involve duplicate-like
records, and it does not assume it. Two observations for whoever designs that:
the pairs share a stable `local_id` across a set rename-like relationship, which
*resembles* CAT-2D.2 Family A; but unlike Family A there is no evidence the
`xya` IDs are **obsolete** — both sides are currently live upstream, which is a
materially different shape. That is a design question, deliberately left open.

---

## 10. Implications for the eventual repair population

**1. The repair population is unchanged: 12 rows.** `xyp-XY67a` plus Gate 2's
eleven. ATTR-0b adds none and removes none. ATTR-1 sizing, review burden and
rollback surface should be planned against twelve.

**2. Fourteen rows are now positively excluded.** Not merely unexamined —
verified correct, with sources. ATTR-1 can state its exclusions with evidence.

**3. F-15 still blocks all twelve, unchanged.** `cards_effective` resolves
`coalesce(ce.illustrator_override, c.illustrator)` for display while
`c.artist_id` bypasses the override. Writing overrides for the twelve today
produces twelve cards that *display* correctly and remain *filed* under the
wrong artist. **Close F-15 first.**

**4. Repair introduces two new duplicate artist-page entries — knowingly.**
Today four of the six pairs already sit under one artist and therefore already
double-count (`5ban Graphics` ×3, `Toyste Beach` ×1) — a **pre-existing**
condition ATTR-1 does not create. Repairing `g1-28a` and `xy9-107a` converges
the remaining two pairs, so Ryo Ueda and Naoki Saito each gain a second entry
for one physical card. Six of six pairs will then double-count. This is a known,
bounded, cosmetic consequence of correcting the data, it affects counts rather
than correctness, and it should be **named and accepted in the ATTR-1 design**
rather than discovered afterwards.

**5. Validation strategy is unchanged.** Do not validate against another bulk
card feed (Gate 2 §8). Use per-print encyclopedic or scan-backed sources.

---

## 11. Boundary: attribution vs. duplicate identity vs. coverage

Three distinct problems keep getting adjacent to one another. They are not the
same problem and should not share a slice.

| | **Attribution correction** | **Provider duplicate identity** | **Catalog coverage** |
|---|---|---|---|
| **Question** | Does this row name the illustrator actually credited on this printing? | Do two provider rows denote one physical printing? | Does the catalog hold every printing that exists? |
| **Finding** | 12 confirmed wrong rows | F-16 — 6 `xya`/twin pairs | 79 Yellow A Alternate cards exist; catalog holds 37 suffix variants |
| **Status** | Evidence **closed** by ATTR-0 / Gate 2 / ATTR-0b | **Fully bounded** by ATTR-0b §9 | **Open**, untouched, out of scope |
| **Blocker** | F-15 | none for ATTR-1 | none for ATTR-1 |
| **Owner** | ATTR-1, after F-15 | Catalog Trust, after ATTR-1 | Catalog Trust / sync coverage |

**The 79-vs-37 discrepancy remains a separate follow-up.** ATTR-0b re-confirmed
the figure from Bulbapedia (79 Yellow A Alternate cards, May 2017 – November
2020) and re-derived the 37 independently, but did **not** crawl the 79 and did
**not** expand the population.

It does **not** force a STOP, and the reason is specific: a printing that is
absent from the catalog cannot carry a wrong attribution. Coverage gaps can only
add *missing* rows, never *defective* ones, so they cannot enlarge the confirmed
repair population or make repairing the existing 12 unsafe. The two problems are
independent, and attribution repair does not depend on closing coverage.

---

## 12. Recommended next gate

**The attribution evidence phase is CLOSED.** ATTR-0, Gate 2 and ATTR-0b
together have investigated every suffix-variant printing in the catalog:

| gate | population | result |
|---|---|---|
| ATTR-0 | 21 R1 families + 2 R2 + 14 lone enumerated | 1 confirmed wrong (`xyp-XY67a`) |
| Gate 2 | 20 R1 printings | 9 correct · **11 wrong** · 0 unresolved |
| ATTR-0b | 14 lone printings | **14 correct** · 0 wrong · 0 unresolved |
| | **total confirmed defects** | **12** |

Recommended order:

1. **Evidence phase closed.** No further attribution verification is required
   before repair design.
2. **Design F-15** — the durable attribution-correction architecture. It must
   allow a provenance-backed correction to keep **effective illustrator** *and*
   **effective artist membership / `artist_id`** consistent. Design only.
3. **Define the ATTR-1 repair population** using only confirmed evidence from
   ATTR-0, Gate 2 and ATTR-0b: **exactly 12 rows**, with the 14 verified in this
   gate explicitly excluded.
4. **Review architecture and proposed repair SQL separately.**
5. **Only after explicit approval:** execute the production repair.

Then, separately and later: F-16 duplicate identity disposition, and the
79-vs-37 coverage question.

---

## 13. Non-goals and containment

This branch is **evidence only**. Nothing below was done, and nothing below was
partially done.

- **No production write of any kind.** No `UPDATE`, `INSERT`, or migration.
- **No production read.** This gate never contacted Supabase. `current_illustrator`
  came from the committed ATTR-0 CSV, re-validated against the public TCGdex API.
- No `illustrator_override` added or changed. No `artist_id` changed.
- No edit to `cards`, `card_extras`, `artists`, or artist aliases.
- No catalog alias created; no `xya` row deduplicated; no provider history deleted.
- No ATTR-1 migration authored; **ATTR-1 not opened**.
- **F-15 not fixed and not designed in code** — deliberately; see §10.
- `cards_effective` not modified. No RLS, ACL, schema, view, or sync-logic change.
- **Catalog sync remains paused** — not resumed, not triggered.
- No runtime or frontend source modified.
- IMG-0 not started. NAV-1 not started. (The imageless `xya` rows are recorded
  in §9.2 as an observation for a later slice, not acted on.)
- **The ATTR-0 and Gate 2 evidence files were not modified.**
  `lone-suffix-variants.csv` keeps its canonical ATTR-0 content; ATTR-0b is
  purely additive in new files. History is not rewritten.
- The 79-card Yellow A Alternate universe was **not** crawled and the 14-row
  population was **not** expanded.

---

## Verdict

**Gate verdict: PASS — ATTRIBUTION EVIDENCE POPULATION CLOSED.**

All 14 canonical lone suffix variants investigated at the exact-printing level:
**14 CONFIRMED_CORRECT, 0 CONFIRMED_WRONG, 0 UNRESOLVED**, each on two agreeing
sources, with zero external source conflicts and two provider-internal
contradictions resolved and recorded.

Identity: **6 SAME_PHYSICAL_PRINTING** (each `xya` row to its set-scoped twin,
proved by collector number and expansion symbol) and **8
DISTINCT_PHYSICAL_PRINTING** (the Aquapolis dot-code sibling pairs, which are
genuinely separate printings and must not be deduplicated). **0
UNRESOLVED_IDENTITY.**

**F-16 is fully bounded** — six duplicate pairs, twelve rows, established by a
generalised cross-set test over all 37 suffix variants in all 218 sets, not by
inspection of the rows already known. It contributes **zero rows** to the repair
population, and repairing the two contradictory twins eliminates both
contradictions outright.

**No new evidence class was discovered.** The `ecard2` rows resolved to a
distinct, fully enumerated historical phenomenon — e-Reader Dot Code variants
across exactly four Aquapolis cards — with no cross-set links and no defects.

The confirmed attribution-defect population stands at **12 rows**, unchanged.
None is repaired, and none can be until **F-15** closes.

The 79-vs-37 Yellow A coverage discrepancy remains a **separate Catalog Trust /
sync-coverage follow-up** and is explicitly not folded into ATTR-0b or ATTR-1.

**Do not open ATTR-1 in this PR. Do not begin F-15 implementation in this PR.**
