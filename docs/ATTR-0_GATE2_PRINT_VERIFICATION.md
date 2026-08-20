# ATTR-0 Gate 2 — Print-Level Artist Attribution Verification

**Verdict: PASS — FULLY VERIFIED.**

| | |
|---|---|
| Slice | ATTR-0 Gate 2 — external print-level verification (**evidence only**) |
| Type | Catalog trust verification. **No implementation, no repair, no production write.** |
| Branch | `audit/attr-0-gate2-print-verification` |
| Base | `main` @ `b78892d49de9bc42d8480a7b3464edd0f456331c` |
| Follows | PR #22 — ATTR-0 artist attribution integrity audit |
| Production mutations | **none** |
| Production reads | **none** — this gate never contacted Supabase |
| Catalog sync | **remains paused** — not resumed, not triggered |
| Evidence | `docs/attr-0-evidence/gate2-print-verification.csv` · `docs/attr-0-evidence/gate2-manifest.json` |
| Population | 20 R1 printings (ATTR-0 SUSPECT, less the already-confirmed `xyp-XY67a`) |
| Result | **9 CONFIRMED_CORRECT · 11 CONFIRMED_WRONG · 0 UNRESOLVED** |
| Checked at | 2026-08-20 |

---

## 1. Executive verdict

**PASS — FULLY VERIFIED.** All 20 remaining R1 printings were investigated at the
exact-printing level and every one resolved. Zero rows remain unresolved.

Four findings, in order of how much they should change the plan.

**1. The defect rate in the SUSPECT population is 55%, not the 5% a
single-seed audit would imply.** Eleven of the twenty printings carry the wrong
illustrator. ATTR-0 confirmed one defect (`xyp-XY67a`) and flagged twenty as
merely suspect; Gate 2 converts eleven of those twenty into confirmed defects.
The total confirmed per-row attribution defect count for ATTR-0 therefore rises
from **1 to 12**.

**2. The defect has a single, precise mechanism.** Every one of the twelve
confirmed defects is the same failure: the printing is a **Yellow A Alternate**
card — a Full Art reprint carrying *genuinely different artwork by a different
illustrator* — and the upstream record has inherited the **base printing's**
illustrator instead of the one credited on the alternate print. This is not
random data rot. It is a systematic upstream rule failure on one well-defined
class of card, which is why it was predictable enough for ATTR-0 to enumerate
and why it was worth verifying rather than assuming.

**3. TCGdex contradicts itself, and its own contradiction confirms our
verdicts.** TCGdex carries a separate six-card set, `xya` ("Yellow A
Alternate"), whose members are the *same physical printings* as six rows in this
population. On the two rows where the set-scoped record is wrong, the `xya`
record is independently **right** (`xya-28a` = Ryo Ueda, `xya-107a` = Naoki
Saito) — matching Bulbapedia and PkmnCards exactly. On the four rows where the
set-scoped record is right, the `xya` record agrees. Six for six. This is
upstream-internal corroboration of Gate 2's method, and it is also a **new
structural finding** (§9, F-16): the same physical printing exists twice in the
catalog under two card IDs, sometimes with contradictory illustrators.

**4. Independent verification cannot be delegated to another bulk card feed.**
`limitlesstcg.com` reproduces the *same* base-illustrator defect (verified on
`GEN/28a`, `AOR/75a`, `FCO/111a`). It is a derived feed sharing the upstream
error, not corroboration. Only sources that transcribe the physical card —
Bulbapedia's per-print release-information sections and PkmnCards' per-print
scan pages — resolved these rows correctly. Any future ATTR-1 validation must
use that evidence class.

**This does not unblock repair.** CAT-0 **F-15** remains open and remains P1:
`illustrator_override` moves the effective illustrator but cannot move
`artist_id`. Twelve confirmed defects now sit behind a repair mechanism that
still cannot repair them. F-15 must close first.

---

## 2. Exact population definition

The canonical population is the committed ATTR-0 evidence, not a fresh
discovery. No new population was enumerated and the scope was not broadened.

```
docs/attr-0-evidence/variant-family-attribution.csv
  → 23 rows total
  → 21 rows with risk_class = SUSPECT          (R1)
  →  2 rows with risk_class = DISTINCT_ATTRIBUTION (R2, already differentiated)

R1 (21) − xyp-XY67a (already CONFIRMED WRONG, ATTR-0 §3) = 20
```

The generator asserts all three of these counts and fails closed if any differs.
`xyp-XY67a` is excluded and is **not** counted among the twenty.

Every output row maps to exactly one canonical R1 row by `variant_card_id`; the
join is by primary key, and the key sets are asserted equal.

**Currency check.** All 20 `current_illustrator` values in the ATTR-0 CSV were
re-read against live TCGdex on 2026-08-20. **Zero drift** — the committed
evidence still matches upstream, so the verdicts below apply to today's data and
not to a stale snapshot.

**Out of scope, deliberately:** the 14 lone suffix variants
(`lone-suffix-variants.csv`), the 2 R2 rows, and the wider Yellow A Alternate
universe. See §9.

---

## 3. Source and evidence standard

Every row required evidence that **explicitly distinguishes the suffixed
printing from the base printing**. A source describing only the base card was
rejected.

**Primary — Bulbapedia per-card `Release information`.** These sections
enumerate every printing of a card with its own illustrator credit, which is
exactly the discrimination this gate needs. This is the same evidence class
ATTR-0 used to confirm `xyp-XY67a`, and the method was re-validated against that
known case before use: the Jirachi page distinguishes XY67 (sui) from XY67a
(Naoki Saito), reproducing the ATTR-0 finding exactly.

**Secondary — PkmnCards per-print pages.** Independently maintained, scan-backed,
with one page per printing (`…/shauna-fates-collide-fco-111a/`) carrying its own
`illus.` credit and `Alternate` print-type tag.

All 20 rows carry **both** sources, and both sources agree on all 20.

**Rejected as non-independent — `limitlesstcg.com`.** Initially consulted as a
third source, it was found to reproduce the defect under audit (§8) and is
therefore recorded as a conflicting *derived feed* rather than as corroboration.

Nothing in this gate infers authorship from base-print illustrator, visual
similarity, artist style, card name, set convention, or image hashes. Image
hashes from ATTR-0 established only that the files differ; they were not used to
decide any verdict.

---

## 4. 20-print verification summary

All 20 printings are Yellow A Alternate cards. Bulbapedia defines the class as
reprints "featuring alternate artwork", so `artwork_distinct_from_base = YES`
holds for the whole population — the open question was never *whether* the art
differs but *who is credited on it*.

| # | variant | card | current | verified | verdict |
|---|---|---|---|---|---|
| 1 | `g1-28a` | Jolteon-EX | Naoki Saito | **Ryo Ueda** | CONFIRMED_WRONG |
| 2 | `g1-73a` | Team Flare Grunt | Yusuke Ohmura | **Naoki Saito** | CONFIRMED_WRONG |
| 3 | `sm4-63a` | Guzzlord-GX | 5ban Graphics | 5ban Graphics | CONFIRMED_CORRECT |
| 4 | `xy10-105a` | N | Megumi Mizutani | Megumi Mizutani | CONFIRMED_CORRECT |
| 5 | `xy10-111a` | Shauna | Ken Sugimori | **Naoki Saito** | CONFIRMED_WRONG |
| 6 | `xy10-43a` | Regirock-EX | PLANETA | **Ryo Ueda** | CONFIRMED_WRONG |
| 7 | `xy10-54a` | Zygarde-EX | 5ban Graphics | 5ban Graphics | CONFIRMED_CORRECT |
| 8 | `xy2-88a` | Blacksmith | Masakazu Fukuda | Masakazu Fukuda | CONFIRMED_CORRECT |
| 9 | `xy3-55a` | M Lucario-EX | 5ban Graphics | 5ban Graphics | CONFIRMED_CORRECT |
| 10 | `xy4-24a` | M Manectric-EX | 5ban Graphics | 5ban Graphics | CONFIRMED_CORRECT |
| 11 | `xy4-65a` | Aegislash-EX | Ayaka Yoshida | **Ryo Ueda** | CONFIRMED_WRONG |
| 12 | `xy6-77a` | Shaymin-EX | Ayaka Yoshida | **TOKIYA** | CONFIRMED_WRONG |
| 13 | `xy6-92a` | Trainers' Mail | Toyste Beach | Toyste Beach | CONFIRMED_CORRECT |
| 14 | `xy7-75a` | Hex Maniac | Yusuke Ohmura | **You Iribi** | CONFIRMED_WRONG |
| 15 | `xy9-107a` | Professor Sycamore | Yusuke Ohmura | **Naoki Saito** | CONFIRMED_WRONG |
| 16 | `xy9-98b` | Delinquent | Yusuke Ohmura | **Sanosuke Sakuma** | CONFIRMED_WRONG |
| 17 | `xyp-XY150a` | Yveltal-EX | Eske Yoshinob | **Hasuno** | CONFIRMED_WRONG |
| 18 | `xyp-XY177a` | Karen | You Iribi | **Hitoshi Ariga** | CONFIRMED_WRONG |
| 19 | `xyp-XY198a` | M Camerupt-EX | 5ban Graphics | 5ban Graphics | CONFIRMED_CORRECT |
| 20 | `xyp-XY200a` | M Sharpedo-EX | 5ban Graphics | 5ban Graphics | CONFIRMED_CORRECT |

| Verdict | Count |
|---|---|
| CONFIRMED_CORRECT | **9** |
| CONFIRMED_WRONG | **11** |
| UNRESOLVED | **0** |
| **Total** | **20** |

Full per-row sources and notes: `docs/attr-0-evidence/gate2-print-verification.csv`.

---

## 5. Confirmed correct printings (9)

These nine are genuinely distinct artwork **by the same illustrator**, so the
stored credit is right. The distinction matters: a naive "the bytes differ,
therefore the attribution is suspect" rule would have flagged all nine as
defects. They are not defects and must not be touched by ATTR-1.

| variant | illustrator | why the credit is genuinely unchanged |
|---|---|---|
| `sm4-63a` | 5ban Graphics | Distinct GX Battle Boost artwork (Guzzlord-GX Box, 2018-01-05); every printing credits 5ban Graphics. |
| `xy10-105a` | Megumi Mizutani | Bulbapedia: the Full Art print is new artwork "by the same artist". |
| `xy10-54a` | 5ban Graphics | Bulbapedia: 54a is a Full Art card with **new** artwork by 5ban Graphics. |
| `xy2-88a` | Masakazu Fukuda | The Best of XY Full Art 182/171 is new artwork by the same artist. |
| `xy3-55a` | 5ban Graphics | Full Art 55a/111 credited to 5ban Graphics, as are the regular and secret prints. |
| `xy4-24a` | 5ban Graphics | All printings including 24a/119 credit 5ban Graphics. |
| `xy6-92a` | Toyste Beach | Bulbapedia: "a new print with different artwork **by the same artist**". |
| `xyp-XY198a` | 5ban Graphics | Both XY198 and the XY198a Full Art credit 5ban Graphics. |
| `xyp-XY200a` | 5ban Graphics | Both XY200 and the XY200a Full Art credit 5ban Graphics. |

Note `xy10-54a`: the *separate* `XY151` Zygarde-EX promo **is** by a different
artist (Eske Yoshinob), but that is a different card ID and outside this
population. It is recorded here so a future reader does not mistake it for a
missed defect.

---

## 6. Confirmed wrong printings (11)

Each row below has **two** exact-print sources — a Bulbapedia release-information
entry that distinguishes the suffixed print, and a PkmnCards per-print page —
recorded in the CSV. All eleven fail the same way: the stored value is the base
printing's illustrator.

| variant | card | stored (wrong) | verified correct | alternate-print provenance |
|---|---|---|---|---|
| `g1-28a` | Jolteon-EX | Naoki Saito | **Ryo Ueda** | The Best of XY Full Art 173/171 |
| `g1-73a` | Team Flare Grunt | Yusuke Ohmura | **Naoki Saito** | The Best of XY Full Art 186/171 |
| `xy10-111a` | Shauna | Ken Sugimori | **Naoki Saito** | Yellow A Alternate 111a/124 Full Art |
| `xy10-43a` | Regirock-EX | PLANETA | **Ryo Ueda** | The Best of XY Full Art |
| `xy4-65a` | Aegislash-EX | Ayaka Yoshida | **Ryo Ueda** | "new artwork by Ryo Ueda", PTXYC 2017-10-20 |
| `xy6-77a` | Shaymin-EX | Ayaka Yoshida | **TOKIYA** | The Best of XY Full Art 188/171 |
| `xy7-75a` | Hex Maniac | Yusuke Ohmura | **You Iribi** | The Best of XY Full Art 181/171 |
| `xy9-107a` | Professor Sycamore | Yusuke Ohmura | **Naoki Saito** | Yellow A Alternate 107a/122 |
| `xy9-98b` | Delinquent | Yusuke Ohmura | **Sanosuke Sakuma** | PTXYC print, distinct from 98a |
| `xyp-XY150a` | Yveltal-EX | Eske Yoshinob | **Hasuno** | XY150a Full Art, Xerneas alongside Yveltal |
| `xyp-XY177a` | Karen | You Iribi | **Hitoshi Ariga** | The Best of XY Full Art 183/171 |

Three of these deserve a specific note.

**`xy6-77a` Shaymin-EX has three distinct illustrators across three prints** —
regular 77/108 = Ayaka Yoshida, Roaring Skies Full Art 106/108 = Ryo Ueda, and
The Best of XY Full Art 188/171 = TOKIYA. It is the TOKIYA print (Mega Rayquaza
alongside Shaymin) that became 77a. A repair that reached for "the Full Art one"
without checking *which* Full Art would land on Ryo Ueda and still be wrong.

**`xy9-98b` Delinquent validates ATTR-0's R2 call.** Bulbapedia separates all
three prints: 98 = Yusuke Ohmura, 98a = Megumi Mizutani, 98b = Sanosuke Sakuma.
ATTR-0 classified `xy9-98a` as R2 (already differentiated, Megumi Mizutani) and
`xy9-98b` as R1 SUSPECT. Both calls were correct, and 98b is confirmed wrong.

**`xy10-111a` Shauna is the one contested row.** See §8.

---

## 7. Unresolved printings

**None.** All 20 rows resolved on two agreeing exact-print sources.

No row was forced. Had a source failed to identify the exact printing, the row
would have been left UNRESOLVED — zero unresolved is the outcome here, not a
target that was pursued at the cost of rigor.

---

## 8. Source conflicts and weak evidence

**One conflict, resolved with reasons recorded.**

`limitlesstcg.com/cards/fco/111a` credits **Shauna 111a** to "Ken Sugimori",
against Bulbapedia and PkmnCards which both credit **Naoki Saito**.

Rather than pick a winner on source reputation, the conflict was tested by
sampling Limitless on two rows where the correct answer was already established
by two independent sources:

| card | Limitless says | verified correct | Limitless |
|---|---|---|---|
| `GEN/28a` Jolteon-EX | Naoki Saito | Ryo Ueda | **wrong — base illustrator** |
| `AOR/75a` Hex Maniac | Yusuke Ohmura | You Iribi | **wrong — base illustrator** |
| `FCO/111a` Shauna | Ken Sugimori | Naoki Saito | **wrong — base illustrator** |

Limitless reproduces the *same* base-illustrator inheritance defect as TCGdex on
every sampled row. It is not an independent witness; it is a second instance of
the error under audit, almost certainly sharing an upstream bulk-data ancestor
with TCGdex. It is therefore recorded as a **conflicting derived feed** and given
no evidential weight. Shauna is CONFIRMED_WRONG at HIGH confidence.

The conflict is preserved verbatim in the `evidence_notes` column for
`xy10-111a` so a reviewer can re-litigate it without re-deriving the reasoning.

**Confidence.** All 20 rows are recorded HIGH: two independent exact-print
sources in agreement, and for six rows a third upstream-internal agreement from
TCGdex's own `xya` set. No row rests on a single source.

**Residual evidence limits, stated plainly:**

- No row was verified against a physical card in hand or a first-party Pokémon
  publication. Bulbapedia and PkmnCards are reputable transcribers, not the
  publisher. This is the standard ATTR-0 accepted for `xyp-XY67a` and Gate 2
  holds to it, but it is a transcription chain, not an official record.
- Both primary sources are English-language community encyclopedias. A
  systematic error common to *both* would not be caught by this gate. The `xya`
  cross-check mitigates this on six rows only.

---

## 9. Implications for ATTR-1

**1. The repair set is now 12 rows, not 1.** `xyp-XY67a` plus the eleven above.
ATTR-1 sizing, review burden, and rollback surface should all be planned against
twelve.

**2. F-15 still blocks all twelve, unchanged.** Gate 2 performed no repair and
changes nothing about the mechanism. `cards_effective` still resolves
`coalesce(ce.illustrator_override, c.illustrator)` for display while
`c.artist_id` bypasses the override entirely. Writing `illustrator_override` for
these twelve today would produce twelve cards that *display* the correct artist
and remain *filed* under the wrong one — converting a data defect into a
display/filing split the product does not currently have. **Close F-15 first.**
The ordering in ATTR-0 §10 is unchanged and now carries twelve times the weight.

**3. New finding — F-16: duplicate printing identity across card IDs.**
TCGdex's `xya` set contains six cards that are the same physical printings as
six rows in this population:

| `xya` record | duplicate of | `xya` illustrator | set-scoped illustrator | |
|---|---|---|---|---|
| `xya-28a` | `g1-28a` | Ryo Ueda | Naoki Saito | **contradiction** |
| `xya-107a` | `xy9-107a` | Naoki Saito | Yusuke Ohmura | **contradiction** |
| `xya-24a` | `xy4-24a` | 5ban Graphics | 5ban Graphics | consistent |
| `xya-54a` | `xy10-54a` | 5ban Graphics | 5ban Graphics | consistent |
| `xya-55a` | `xy3-55a` | 5ban Graphics | 5ban Graphics | consistent |
| `xya-92a` | `xy6-92a` | Toyste Beach | Toyste Beach | consistent |

These six sit in ATTR-0's `lone-suffix-variants.csv` — the audit *saw* them but
its family model, which pairs a variant to a base **within one set**, could not
link `xya-28a` to `g1-28a` across sets and so never compared them.

The consequence for ATTR-1 is concrete: a per-row repair keyed on `g1-28a` alone
leaves `xya-28a` untouched, and the catalog continues to hold the same physical
printing twice under two artists. **ATTR-1 must decide explicitly** whether
`xya-*` rows are repaired alongside their duplicates, deduplicated, or left as
an accepted upstream artefact — and that decision belongs in the ATTR-1 design,
not in a migration written after the fact.

This is raised as a **finding**, not a blocker. It is fully characterised here
(six rows, two contradictions, all enumerated), so it requires ATTR-1 scope to
account for it, not a fresh audit ahead of it. A reviewer who reads F-16 as
materially breaking the ATTR-0 model should escalate this gate to
**STOP — EVIDENCE CLASS EXPANDED**; the evidence to make that call is above, and
the author's judgement is that PASS is correct because every Gate 2 row resolved
and the ATTR-0 R1 population was exactly right for its stated scope.

**4. The lone-variant population is now higher-risk than ATTR-0 rated it.**
Gate 2 establishes that the base-illustrator defect is systematic on Yellow A
Alternate prints, and 6 of the 14 lone suffix variants are Yellow A Alternate
cards. The remaining 8 are `ecard2` Porygon/Golduck/Drowzee/Mr. Mime `a`/`b`
rows, a different phenomenon entirely and unassessed. A short **ATTR-0b** over
the 14 lone variants is recommended before ATTR-1 finalises its repair set.

**5. Catalog completeness is a separate, larger question.** Bulbapedia
enumerates roughly 79 Yellow A Alternate cards released May 2017 – November 2020;
production holds 37 suffix variants in total. The catalog is therefore missing
many printings of this class outright. That is a **sync/coverage** matter for the
paused catalog sync, not an attribution-correctness matter, and it is recorded
here only so it is not rediscovered as a surprise. **It is explicitly not in
ATTR-1's scope.**

**6. Validation strategy for ATTR-1.** Do not validate a repair against another
bulk card feed. Limitless is demonstrably infected with the same defect (§8).
Verification must use per-print encyclopedic or scan-backed sources, exactly as
this gate did.

---

## 10. Explicit non-goals

This branch is **evidence only**. Nothing below was done, and nothing below was
partially done.

- **No production write of any kind.** No `UPDATE`, no `INSERT`, no migration
  executed.
- **No production read.** This gate never contacted Supabase; `current_illustrator`
  came from the committed ATTR-0 CSV, re-validated against the public TCGdex API.
- No `illustrator_override` added or changed.
- No `artist_id` changed.
- No edit to `cards`, `card_extras`, `artists`, or aliases.
- No ATTR-1 migration authored.
- **F-15 not fixed** — deliberately; see §9.
- `cards_effective` not modified.
- No RLS, ACL, schema, view, or sync-logic change.
- **Catalog sync remains paused** — not resumed, not triggered.
- No runtime source modified; no Artist Page redesign.
- IMG-0 not started. NAV-1 not started.
- **The original ATTR-0 evidence CSV was not modified.** `variant-family-attribution.csv`
  keeps its as-generated `risk_class = SUSPECT` values. Gate 2 is additive
  evidence in new files; history is not rewritten.

---

## Verdict

**PASS — FULLY VERIFIED.**

All 20 remaining R1 printings investigated at the exact-printing level. **9
CONFIRMED_CORRECT, 11 CONFIRMED_WRONG, 0 UNRESOLVED**, each on two agreeing
exact-print sources, with one source conflict resolved and recorded (§8).

The ATTR-0 R1 population was exactly right: 21 families, one already confirmed,
twenty verified here. The suspicion that motivated ATTR-0 is vindicated — more
than half the suspect population was genuinely wrong.

Total confirmed per-row attribution defects across ATTR-0 and Gate 2: **12**.
None is repaired, and none can be until **F-15** closes. One new structural
finding, **F-16** (duplicate printing identity across card IDs, §9), must be
scoped into ATTR-1 before a per-row repair is written.

Recommended order is unchanged from ATTR-0 §10, with one insertion:

1. Close **F-15** — architectural, provable, no per-row data change.
2. Run **ATTR-0b** over the 14 lone suffix variants, and resolve **F-16**'s
   duplicate-identity question.
3. **Then** ATTR-1, repairing all 12 confirmed rows.

**Do not open ATTR-1 in this PR.**
