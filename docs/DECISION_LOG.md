Illustrated Vault — Decision Log

2026-08-21 — F-15: durable attribution correction channel — EXECUTED, ATTR-1 still pending

Decision:

`illustrator_override` alone could not durably repair the twelve confirmed
ATTR-1 attribution defects: correcting the display string left the raw
`artist_id` foreign key wrong, and `coalesce(ce.artist_id_override,
c.artist_id)` cannot express "deliberately no artist" — a NULL override falls
through to the known-wrong raw value. F-15 built the durable correction
channel and executed it; it deliberately repairs nothing.

`card_extras` gained four columns — `artist_id_override` plus three
attribution provenance fields (`attribution_override_evidence`,
`attribution_override_approved_by`, `attribution_override_approved_at`) — an
FK to `artists(id)` ON DELETE RESTRICT, and an aliases-only admission trigger
mirroring `sync/sync-cards.mjs :: resolveArtistId()` exactly: never
`artists.id`, never fuzzy, never substring. `cards_effective` had exactly one
expression changed:

```sql
case
  when ce.illustrator_override is not null then ce.artist_id_override
  else c.artist_id
end as artist_id
```

**CASE, not COALESCE — the entire point of the slice.** On all twelve ATTR-1
targets the correct artist is NULL; COALESCE would have retained the raw,
known-wrong `artist_id` on every one of them (for `xyp-XY67a`, leaving it
filed under `sui` — the exact defect F-15 exists to remove). The discriminator
is `illustrator_override`, not `artist_id_override`: the presence of an
illustrator correction is what makes the raw FK untrustworthy, and keying on
`artist_id_override` would make an intentional NULL unrepresentable again.

Five legacy rows already carrying `illustrator_override` with no provenance
were backfilled through the same aliases-only resolver, with honest
provenance (`derivation: "f15-legacy-backfill"`, `verified: false`) rather
than a false claim of external verification. `public.cards` was never
written — raw provider history stays raw, exactly as CAT-2D.2 and CAT-3B
established for identity and image provenance respectively.

Independent review held the implementation three times before approving it,
each time on a genuine fail-closed gap rather than a style preference: (1)
the preflight did not assert the *exact* pre-migration shape of
`cards_effective`, `card_extras`' ACL, RLS policy, or trigger set, so an
unrelated production drift between review and execution could have been
silently overwritten; (2) the postflight proof that the view's raw
`c.artist_id` projection was replaced assumed `pg_get_viewdef()` ends at the
final SELECT-list projection, which is false — the `FROM`/`JOIN`/`WHERE`
clauses follow it, and the assumption would have failed a correct migration
every time; (3) even after isolating the replaced projection, the check that
it equalled the approved CASE was an unanchored containment regex, which a
wrapper like `COALESCE(CASE ... END, c.artist_id)` could have passed while
silently reintroducing the exact raw-fallback defect F-15 removes. All three
were corrected in the migration's §0 preflight / §9 validation before
execution; none weakened what the migration mutates.

Execution was explicitly authorized as a gate separate from review, and merge
remains a further separate gate, not granted by this decision.

Reason:

A durable correction needs the same properties CAT-2D.2 (identity) and CAT-3B
(images) already established for their respective corrections: raw
provider-synced data stays untouched and re-syncable, the override lives in
`card_extras` beside it, provenance is mandatory and honest rather than
retrofitted, and admission is restricted to the same resolver sync itself
trusts so the two can never disagree about what a name means. F-15 is that
same pattern applied to artist attribution, and — like CAT-3B — it shipped
its correction data separately from building the channel, so each step is
independently reviewable and revertible.

Status:

Accepted and EXECUTED 2026-08-21. Migration
`docs/sql/f15-durable-attribution-correction.sql`, reviewed SHA-256
`9d1a654bd1c6cda3b1ab669a99b22058278348d7f25f2b7e0c50579c91befff0`, applied
from PR #26 head `856250c4cc472ce38afc443a8c99b6a390037215`; Supabase
migration history `20260821132512_f15_durable_attribution_correction`.
Effective attribution changed on **0** rows during F-15 itself (V-1 held);
five legacy rows backfilled, resolver-consistent 5/5; C1/C2/C3 violations
0/0/0; `card_extras` ACL/RLS/trigger set match the pinned pre-review baseline
exactly. **ATTR-1 — the twelve confirmed repairs — is untouched and remains a
separate, unstarted, separately-approved slice**; `sui` stays at 224 until it
runs. Part B negative admission tests and V-8 sync durability remain
deferred, unchanged from the design (no mutation-safe or non-production
environment exists). The scheduled catalog sync remains PAUSED. PR #26 is
**not merged**; merge is a further separate authorization. Full account in
`docs/F-15_IMPLEMENTATION.md`; design in
`docs/F-15_DURABLE_ATTRIBUTION_CORRECTION_DESIGN.md` (PR #25).

2026-08-20 — CAT-3B.1: approved alias image activation — EXECUTED, and catalog image remediation closed

Decision:

The 192 approved same-printing alias pairs are activated, and that population is
the whole of authorized image remediation. Executed 2026-08-20 from PR #21 @
304c69dd05bd0d2809008a76e607c5e729ba1e87: 190 inserts + 2 updates = 192
card_extras image-override bundles. §A PASS, §B succeeded once, §C PASS, §D
rollback not executed. Status: Accepted / closed.

Eligibility is not authorization, and the gap between them is deliberate. CAT-3B
built the channel and shipped it EMPTY, explicitly refusing to populate it with
the same 192 pairs that were already eligible for admission. CAT-3B.1 is that
separate approval, and it was itself split into authoring and execution: the SQL
landed in a reviewed PR that wrote nothing, and the production write happened
only after independent review named the exact head. Three gates — build the
channel, author the write, execute the write — for one 192-row change. That is
the intended cost of writing curated pixels into a product whose spine is a
visual archive.

The candidate population is pinned to a provenance CLASS, not a count. The
selector is card_identity_aliases rows where slice = 'CAT-2D.2', family =
'set_rename' and approved_by is the CAT-2D.2 allowlist manifest, additionally
required to still resolve through card_identity_resolution. A bare count check
would have been satisfied by a remove-one/add-one against the alias table that
silently substituted a different pair while holding the total at 192. Pinning on
the class makes that substitution surface as a class-count drift and abort.
Cardinality is not identity; this is the correction that made the difference.

No image URL is transcribed. The override value is src.image_url selected inside
the INSERT ... SELECT itself, so the value written is by construction the value
the admission trigger's R3 rule compares against at admission time. A list
captured when the file was authored could have gone stale before execution, and
R3 would have rejected it — correctly. Deriving rather than transcribing is what
makes the write and the wall agree.

Correctness rests on pre-write state, not on an MVCC system column. An earlier
revision derived the 190/2 insert/update split from RETURNING (xmax = 0). That
was replaced: §B now counts which eligible targets already hold a card_extras
row before writing, asserts the split is exactly 190/2, asserts the two
pre-existing ids are exactly swsh12.5gg-GG19 and swsh12.5gg-GG69 with CAT-1
enrichment intact, and checks post-write row growth against the pre-derived
insert count. xmax is not part of the correctness contract. The split was
knowable from ordinary table state, and ordinary table state is auditable.

Preservation is proved by omission, then asserted. ON CONFLICT (card_id) DO
UPDATE SET lists only the five image fields. illustrator_override and
source_note are absent from that list, and that absence IS the CAT-1
preservation guarantee. A wholesale row upsert, or DELETE + INSERT, would have
nulled both. §B additionally asserts after writing that both rows still hold
both values and aborts if not. Gate 0 called this the single most important
containment requirement; it is enforced twice, once structurally and once
explicitly.

public.cards stays raw provider history, and the arithmetic proves it. Effective
image gaps moved 1,640 → 1,448 while raw gaps stayed at 1,640 — the entire
192-row improvement lives in the COALESCE layer. §B asserts the raw null count
is unmoved before committing. The rendering chokepoint absorbed a 192-card
visual change with zero rows written to the catalog table and zero files changed
under src/.

Broad catalog image remediation is CLOSED, on evidence rather than fatigue. The
192 pairs were the only gaps with a known admissible source: retained
provider-history rows holding live TCGdex assets for a printing CAT-2D.2 had
already independently established as physically the same. CAT-3A measured the
rest and found T1 = 0 of 1,640 — not one remaining gap has an image available
upstream today. The remaining 1,448 are therefore NOT authorized for another
repair phase. Reopening image work requires new evidence, not a new slice.

Acceptance is SQL-proven and not visually confirmed, and the record says so. No
browser/UI spot-check was performed; the executing sessions had SQL access only.
§C-7 proves the active-owned gap movement (122 → 77) read-only, every override
is asserted equal to its source card's live image_url, and every target resolves
through cards_effective — so the residual unproven claim is narrow: that a
rendered browser pixel is the correct printing. It is logged as an open QA item
rather than quietly counted as done. A validation record that overstates what
was observed is worse than one with a gap in it.

Two further honesty notes are carried rather than smoothed over. The connector's
safety layer blocked the literal C-3 and C-6 queries; both were replaced with
equivalent or stronger read-only checks (C-6 became an all-192 aggregate instead
of a five-row sample), and the substitution is recorded so the validation is not
described as a verbatim run of the committed §C text. And CAT-3A recorded the
active-owned missing-image baseline as 117 where CAT-3B.1 measured 122 — the
45-card delta is consistent across both records, only the baseline differs, it
was not investigated, and it is recorded rather than silently reconciled.

The scheduled catalog sync remains PAUSED. Next slice is NAV-1, not started.
Near-term order unchanged: NAV-1 → SEC-0 → AUTH-1 → BETA-0.

2026-08-19 — CAT-3B: durable provenance-aware approved image override channel

Decision:

Curated image values get their own durable channel; public.cards stays raw
provider history. sync-cards.mjs performs a full-row upsert of image_url from
whatever TCGdex returns, and there is no image provenance column, so a curated
value written into cards.image_url would be silently reverted the next time its
set is not skipped, with nothing recording that it was ever deliberate. The
prerequisite is therefore the channel, not the image write.

The channel extends card_extras rather than adding a table. Five columns —
image_url_override, image_override_source_card_id (FK → cards(id), ON DELETE
RESTRICT), image_override_evidence, image_override_approved_by,
image_override_approved_at — are admitted all-or-nothing. An override without
provenance is worse than no override: it renders a curated pixel nobody can
trace. RESTRICT rather than CASCADE on the source reference is deliberate:
deleting the record of where an approved image came from would destroy the audit
trail while leaving the override in place and unexplained.

cards_effective is the rendering chokepoint, and exactly one line of it changed:
c.image_url became coalesce(ce.image_url_override, c.image_url). Every rendered
image already originates from that view, so one view change reaches 100% of
image consumers with zero application-code change. All 14 columns and their
order, security_invoker = true, the card_extras LEFT JOIN and the CAT-2D.1 alias
exclusion are preserved; src/** is unchanged.

Admission is restricted to approved alias relationships, not to a card list. A
BEFORE INSERT OR UPDATE trigger, SECURITY INVOKER, admits an override only where
the source is an approved alias of the target card and the proposed value equals
that source card's current image_url at admission time. It reads
card_identity_resolution and public.cards and never touches
card_identity_aliases, whose privilege wall stays intact. Nothing here widens
anyone's access. A future approved alias becomes eligible automatically; nothing
is ever applied automatically.

Admission is not revalidation. An UPDATE where all five image fields are
IS NOT DISTINCT FROM OLD returns without re-admission, because R3 compares
against the source card's current image_url and provider churn is expected to
change it — revalidating on an unrelated edit would fail a routine write for a
reason that has nothing to do with it. Withdrawal is always permitted;
re-admitting is a new decision at the current bar.

Provenance is withheld from anon and authenticated. The production preflight
measured a broader baseline than the documented one: anon and authenticated each
held seven table-level privileges on card_extras, dormant only because RLS
carried no write policy, but real. The migration narrowed that deliberately, and
V-6 re-proved the resulting ACL after deploy.

The channel ships EMPTY, and populating it is a separate decision. Zero override
rows exist. No override may be created — not for the 192 CAT-3A-measured pairs,
not for anything else — without its own separately approved slice.

Reason:

CAT-3A closed as a SCOPED PARTIAL and selected no implementation slice: its
Decision Framework did not run, and it did not select D-ALIAS. Its A-dimension
evidence is nonetheless decision-grade on its own — all 192 CAT-2D.2-approved
alias pairs hold a live TCGdex asset their canonical survivor lacks, covering 45
of the 117 active-owned image gaps out of 1,640 stored gaps, against TCGdex
exact-current-identity recoverability of 0 / 1,640. CAT-3B rests on that
evidence and on an explicitly accepted policy principle — a retained
provider-history image is an admissible source for its canonical survivor only
where CAT-2D.2 already established that the pair is the same physical printing —
not on a CAT-3A decision.

Shipping the channel empty is what made every contract change provably a no-op
at deploy time, the same argument CAT-2D.1 used for the alias table. It also
separates the two questions that would otherwise be decided together: whether a
durable, traceable, revertible mechanism should exist, and whether any
particular image should be curated. The first is architecture and was decidable
now; the second is an editorial act on collector-visible pixels and belongs to
its own approval.

Status:

Accepted. CAT-3B is CLOSED — deployed, production-validated (V-1 … V-6 all
PASS), merged as PR #17, merge commit
5d741372cf4f1ac89ce5386c069835f947b11f07. V-3 proved row-for-row equivalence:
23,588 deployed rows against 23,588 expected, zero differing in either
direction, 1,640 null images on both sides. Zero rendered pixels changed. The
channel is empty: zero override rows.

The non-production durability write test
(docs/sql/cat-3b-3-durability-test.sql) was NOT run — no non-production Supabase
environment exists — and remains a deferred observation, the same disposition
CAT-1 took for its isolated G1 proof. Do not manufacture it in production. The
durability claim rests meanwhile on three static proofs asserted in CI by
scripts/cat3b-durability.test.mjs.

The scheduled sync remains PAUSED. The next slice after CAT-3B is UNDECIDED
pending strategy/review: CAT-3C is not named, and the 192 pairs are not
authorized as next. The standing near-term order after catalog work is unchanged
— NAV-1 → SEC-0 → AUTH-1 → BETA-0. Current state is recorded in
CURRENT_STATE.md; the full slice account is in
CAT-3B_DURABLE_IMAGE_OVERRIDE.md.

2026-08-17 — CAT-2D.2: catalog identity reconciliation (Family A, stable-number renames)

Decision:

Provider IDs are mutable source identifiers, not permanent printing identity.
TCGdex re-namespaces subsets out of parent sets and changes the canonical ID of
a physical printing. Collector identity must survive that; it therefore cannot
be defined as "whatever string the provider used at import time".

Durable resolution is an alias layer, not a rewrite. public.card_identity_aliases
maps an obsolete provider ID to its canonical survivor with evidence, approver
and slice. Raw obsolete rows STAY in public.cards as retained provider history
rather than being deleted; a retained row may preserve source metadata or assets
absent from its current survivor, and there is still no durable image override
channel. CAT-2D.2 did not perform an image-difference census, so retention is
justified by reversibility — deletion is the only irreversible act available —
not by any measured claim about what those rows contain.

public.cards_effective exposes only canonical survivors and is the canonical
Supabase-backed product catalog surface: the authority for the archive and
ownership-facing catalog paths. It is not the only source of card data —
cardService's separate provider-backed set path (tcgdexService, entry.isSet)
still exists and is deliberately NOT an identity or ownership authority.

Resolution depth is exactly one, enforced on both sides by trigger; there is
deliberately no recursive resolver, because a resolver that tolerates chains
eventually tolerates cycles. Depth one is not a limit of one alias per survivor:
MANY historical aliases may resolve onto ONE canonical survivor, which is the
shape Family B is expected to need.

Family A admission is A1+A2+A3+A4+A5, explicitly replacing CAT-2D §3.4's Tier-1
equality for this evidence class. Tier-1 equality cannot hold here: the sync
writes set_name from the set the provider served the card under, so an obsolete
row carries the PARENT set name by construction and normSet differs from its
survivor's no matter what. The replacement keeps the name and number components
strict — normName equal, normNum equal, stored row against stored row — and
substitutes, for the set component only, an explicitly enumerated set-rename
pair (A1) evidenced by the whole local-ID namespace being absent from the parent
set upstream (A4) and by a per-pair 404/200 observation (A5). A4 is what makes
it a rename rather than a same-name-same-number coincidence. Name equality alone
remains explicitly insufficient. This departure is scoped to this evidence class
and is recorded in every alias row's evidence payload.

All mutable-reference collisions fail closed. CAT-2D §6.2 permitted silent
merges for favorites, binder cards, price history and intent when a user already
held both the obsolete and the survivor row. That branch was deliberately NOT
implemented. A merge is the only information-destroying operation in the design,
and it would have run unseen. Any collision, in any table, refuses the whole
migration; resolving one is an explicit operator decision.

user_import_rows remains immutable historical evidence. Stored card_id and
candidate_card_ids are the record of what the matcher concluded against the
catalog as it existed at import time. Rewriting them would falsify the audit
trail and make superseded batches uninterpretable. Resolution happens at READ
time instead — inside the ownership RPC and the OL-0D read model — so a batch
records what was true then and the alias table records how to read it now.

Artist reachability is a hard migration gate. Artist pages load by exact
cards.artist_id, and aliasing makes the survivor the only row that can represent
a printing. An obsolete row carrying an artist_id whose survivor does not would
silently drop that printing off its artist's page. A non-null obsolete artist_id
must equal the survivor's or the migration refuses. This slice does not repair
cards.artist_id; that is illustrator/artist restoration and stays out of scope.

Celebrations was split out as CAT-2D.3. Its provider transition changed both the
set AND the numbering — production stores those 25 rows as cel25-2A, cel25-4A,
cel25-15A1, cel25-17A, cel25-60A, cel25-88A rather than cel25-CC###. It cannot
satisfy A2, and A2 was not loosened to admit it: dropping the number requirement
would reduce the rule to name equality plus a set-rename pair, which is the fuzzy
matching this architecture forbids, and several of those names are ambiguous
across the wider catalog. It needs its own evidence class with 25 individually
corroborated mappings.

Trainer Galleries / Family B is CAT-2D.4, renumbered from the design doc's
CAT-2D.3. It remains blocked on a separately reviewed maintenance-only ingestion
capability.

Deployment artifacts that require atomicity must be authored as a SINGLE
top-level PostgreSQL statement.

  Observed, in the tested Supabase SQL Editor workflow: the assumed
  cross-top-level-statement transaction / TEMP-table lifecycle did not hold. A
  harmless reproduction showed a TEMP table created by one top-level statement
  was unavailable to a subsequent one.

  Not established, and deliberately not asserted: whether the SQL Editor used
  separate sessions, committed between statements, or behaved that way for some
  other reason. The mechanism was not investigated, because the decision does
  not depend on it.

Therefore an atomic deployment artifact of this kind must not depend on
client-held cross-statement state at all. It is authored as one top-level
statement — one DO block — so atomicity is a property of the artifact rather
than an assumption about the client.

No IV UUID printing identity has been introduced. The reason is NOT that every
case is 1:1 — the alias table deliberately permits MANY historical aliases to
resolve onto ONE canonical survivor (there is no unique constraint on
canonical_card_id), and Family B is expected to need exactly that, with two
obsolete generations resolving onto one live Trainer Gallery survivor. The
reason is narrower and holds today:

  * every currently known requirement remains expressible by depth-one
    alias → canonical-survivor resolution, including many-to-one;
  * no known case requires a printing identity independent of a surviving
    canonical row;
  * no known case requires one physical printing to correspond to multiple
    simultaneously-live canonical survivors.

A UUID identity layer becomes justified when one of those stops holding — or
when an artwork-vs-printing policy or real language identity lands, both of
which are different axes from provider-ID renaming and must not be stacked onto
this map.

Reason:

Without a durable identity layer, a provider rename silently converts a matched
collector row into a missing card: ownership is keyed on the historical ID while
the rendered card carries the new one.

Deleting the obsolete rows would have been the smaller-looking fix and was
rejected. It is the only irreversible act available in the whole design, and it
would discard retained source rows that may hold metadata or assets a current
survivor lacks — in a product whose stated spine is a visual archive. The
argument does not rest on having measured that: CAT-2D.2 ran no image-difference
census, and the point of retention is precisely that it does not require one.
Retaining costs 192 rows out of 23,780 and keeps a later evidence-backed
recovery slice possible; deleting forecloses it permanently on an unmeasured
assumption.

The strictness is deliberate and asymmetric: this architecture may MERGE two
identities for one printing, and may never INVENT ownership. False-positive
physical ownership is unacceptable, so every rule that could widen the alias set
fails closed, and every count that could hide a widening is asserted rather than
reported.

Status:

Accepted. CAT-2D.2 is CLOSED — deployed, independently validated (Phases C–G),
merged as d01c8ada8e8c2838f5212aa8e28590b383460f9d, production smoke passed, and
Phase H cleanup complete. 192 aliases live (Shining Fates SV 122, Crown Zenith
GG 70); cards 23,780; cards_effective 23,588; zero aliased IDs in
cards_effective. The scheduled sync remains PAUSED. CAT-2D.3 and CAT-2D.4 are
design items only. Current state is recorded in CURRENT_STATE.md; the full slice
account, including the deployment incident, is in
CAT-2D.2_FAMILY_A_RECONCILIATION.md.

2026-08-13 — WF-1: development authority and knowledge-promotion rule

Decision:

The public GitHub repository is the canonical handoff surface and the single
source of truth for implementation. Production behavior plus the canonical docs
in this repository decide what is true; no other artifact does.

Claude Code is the primary implementation agent. ChatGPT is the product,
architecture, and independent PR review layer. The two roles are deliberately
separate so that the party writing a change is not the sole party judging it.

The private Obsidian / GitHub notes repository (illustrated-vault-notes) is the
exploratory knowledge layer: product thinking, research, audits, UX
observations, and future ideas. It is explicitly not implementation authority
and may contain incomplete, exploratory, or incorrect thinking by design.

Promotion rule — the only path by which an idea acquires authority:

observation → evidence → decision → canonical repo documentation →
implementation

An idea in the knowledge vault does not become architecture by being written
down, by being persuasive, or by being repeated. It becomes architecture when it
is promoted into this repository's canonical documentation as an approved
decision. A vault note and a canonical doc are never co-equal sources; if they
disagree, the canonical doc governs and the disagreement is reported rather than
silently resolved.

Reason:

Two agents and a private idea space create three plausible-looking sources of
truth. Without a stated hierarchy, exploratory thinking leaks into production
architecture by momentum. Naming one authority and one promotion path makes that
leak a visible violation rather than an accident.

Status:

Accepted. The operating contract itself lives in AGENTS.md (repository-wide) and
CLAUDE.md (Claude Code workflow) and is deliberately not duplicated here.
Authority boundaries are recorded in CURRENT_STATE.md.

2026-07-28 — CAT-1: temporal metadata restoration (series / release_date)

Decision:

G1 — the card-upsert path cannot express the temporal columns.mapCardToRow no longer emits series or release_date. BecauseupsertRows issues INSERT … ON CONFLICT (id) DO UPDATE SET <payload
columns> and neither column appears in that payload, the routinecard-write path is structurally incapable of writing or nulling them.This was chosen as a deletion rather than the originally proposedsetDetail-threading addition: the smaller diff is also the strongerguarantee. Do not reintroduce either key.

G2 — updateSetTemporal(setDetail) is the sole writer. At most twocolumns, scoped by set_id, built only from non-null upstream values,no write at all when both are absent. It never writes last_synced_at,which remains the sync-recency signal and CAT-0 audit evidence. The"only writer" property is a statically asserted invariant, not aconvention.

Decision A — presentation is preserved. CAT-1A's recommendation toaccept an ordering change is rejected. The inert release_dateordering key was removed from cardService.js ahead of the datarestoration, so no window existed in which a live value could influencerendering. release_date was NULL on 23,780/23,780 rows and thereforediscriminated nothing; (set_id, local_id) is unique across thecatalog, making set_id → local_id a deterministic total order. Allintentional ordering work is deferred to SORT-1.

Decision B — no cache-key bump. pb9_supa_ retained. Cached andfreshly fetched arrays agree, so no divergence exists to invalidate.ARTIST_SELECT unchanged — release_date stays in the projection,because removing it would drop a key from the row reachingsupaRowToCard, a shape change wider than removing an ordering clause.

Routine syncs are self-sufficient. The earlier runbook step(incremental → temporal after every sync) is withdrawn. Instead anon-skipped set receives one temporal update after upsertRowssucceeds. Post-upsert placement is a correctness requirement, not anordering preference: for a new set no rows exist beforehand, so anearlier UPDATE … WHERE set_id would match nothing. Skipped setsreceive no write and retain their values.

SYNC_MODE=full is prohibited as a CAT-1 mechanism. A full runrewrites illustrator, artist_id, pricing, rarity, image_url,set_name and last_synced_at. Prohibited by policy and documented inthe sync-cards.mjs header; deliberately not blocked in code,because blocking an existing mode is outside the approved footprint.

F-19 artist FK repair is refused here. A full sync would fix the499 stale FKs. CAT-1 does not do so opportunistically. Deferred to itsown slice with its own guardrails. F-6 skip-predicate redesign likewiseremains deferred.

SYNC_MODE allow-list. Adding a third mode made a typo dangerous:any unrecognized value previously fell through to the full-sync path,so SYNC_MODE=temporl would have executed a full-catalog rewriteduring the checksum window. SYNC_MODE is now validated against{incremental, temporal, full} and refuses to start on an unknownvalue. Valid-mode behavior is unchanged.

SYNC_SET_ID single-set temporal scope. Exact ID equality only —no substring, prefix, case-folding or fuzzy fallback, so swsh3 cannever select swsh35. Blank means all sets. Supplying it with anon-temporal mode refuses the run rather than being ignored, becausescoping a card-write run would sync one set while leaving the operatorbelieving the catalog was processed. An ID that does not resolve toexactly one set refuses the run rather than silently doing nothing.

Temporal failures must fail the workflow. In temporal mode aSet-detail fetch can throw before updateSetTemporal is reached, sothe main loop records the set ID as failed in temporal modespecifically, and any failed set produces a non-zero exit. A partialtemporal restoration must never appear green in GitHub Actions. Theloop still continues past failures for diagnostic completeness.Incremental/full error handling is deliberately not redesigned.

Independent missing-field reconciliation. A single "both absent"list was insufficient: a set with an upstream releaseDate but noserie.name is a successful partial write that still leaves seriesNULL for every row, and would have been invisible. The two populationsare tracked separately, with the both-absent case as theirintersection. Remaining release_date NULLs reconcile against setsmissing upstream releaseDate plus failed sets; remaining seriesNULLs against sets missing upstream serie.name plus failed sets.Neither column reconciles against the both-absent list alone.

Reconciliation guidance is mode- and scope-aware. Only an unscopedtemporal run observes every set, so only that run prints awhole-catalog claim. A scoped temporal run prints scope-limited wordingand explicitly refuses a global claim; routine incremental/full runsprint touched-set diagnostics only. This prevents a scoped dry run or aroutine sync from being mistaken for restoration evidence.

Missing-field wording. A missing upstream field means no write wasissued for that set — not that its rows are NULL. G2 never writes anull, so on a reconciliation run an absent upstream value preserves anexisting non-null stored value; previously null values simply remainnull.

No per-set affected-row counts. Supabase update() does not returnaffected rows by default. The run logs successful set IDs with the keyswritten, the missing-field and failed lists, and run-level totals.Production SQL remains the authoritative population reconciliation, andno claim is made that any response count equals rows transitioningNULL → non-null.

Empty-string upstream values are not specially handled. A key isincluded iff its upstream value is non-null, per spec. An upstream ""for series would be written and caught by the zero-empty-stringsassertion; "" for release_date would be rejected by the datecolumn and fail the set visibly. No silencing guard was added, so thatan upstream anomaly surfaces rather than being absorbed. Productionmeasured empty_series: 0.

G1 empirical proof is non-production only. The isolated one-cardupsert probe was not run against production and must not be. G1removed only the two temporal keys; the upsert still rewritesillustrator, artist_id, pricing, rarity, image_url,set_name and last_synced_at, so a production probe is an unmandatedmutation — and one made before a checksum capture would be absorbedinto the baseline and silently certified. No non-production Supabaseenvironment was available, so empirical G1 is recorded as a deferredobservation. It is not a CAT-1 blocker. Production rows were neverdeleted or altered to force a non-skipped path.

Durability policy (explicit asymmetry, not global monotonicity):temporal values may be populated, and may be corrected by a laternon-null upstream value, but an absent upstream value may not erase aknown non-null stored value. CAT-1 prefers stale known temporal metadataover silent non-null → NULL regression. Upstream-retraction policy isdeferred; it acquires a spec only if evidence emerges that TCGdexwithdraws release dates in practice.

Gate 0 (production introspection, before implementation): release_dateis date, series is text, both nullable; zero user triggers, rewriterules, generated/identity columns, and zero CHECK/FK constraints oneither column. No database-mediated path could widen the intendedtwo-column write footprint.

Scope guardrails honored: exactly three files changed(sync/sync-cards.mjs, src/services/cardService.js,.github/workflows/sync-cards.yml, the last with exactly three edits);sync/package.json untouched; no schema, RPC, RLS or view change; no newdependency; App.jsx, sort.js, setOrder.js, cardAdapter.js,snapshotMatcher.js, ownedLibraryService.js and SharedBinder internalsall untouched. The missing sortCards("name") case remains unfixed andunreferenced — leaving it alone is precisely what kept CAT-1presentation-neutral.

Status:

Accepted. Implemented and production validated 2026-07-28. F-13resolved: series and release_date populated on 23,780 / 23,780 cards,empty_series 0, distinct_series 21. The non-temporal checksumdea458d003ff71a451079c0ed66a01fd was byte-identical across both thescoped swsh3 proof and the 218-set whole-catalog restoration, whichperformed zero card upserts. A subsequent routine incremental runinvoked the post-upsert temporal helper for five sets and demonstrated thestored-row write path on exu, with zero temporal failures. Full evidence in/docs/CAT-1_TEMPORAL_METADATA_RESTORATION_CLOSEOUT.md.

Set reconciliation is exact: the complete 214-set CAT-0 inventory is asubset of the 218 sets processed, and zero catalog set IDs were absentfrom the upstream run. The four upstream set IDs with no rows inpublic.cards are exactly jumbo, rc, sp and wp.

Follow-ups recorded, none repaired inside CAT-1:

the exu-%3F TCGdex 404 card-ID anomaly;

two distinct confirmed non-skip mechanisms, both instances of thedeferred F-6 skip predicate. exu is permanently non-skipped becauseit stores 27 cards against 28 upstream. jumbo, rc, sp and wpare permanently non-skipped because they are upstream zero-cardsets: the predicate requires briefCards.length > 0, which azero-card set can never satisfy. The incremental log showed thisdirectly (Syncing wp — 0 cards, and likewise for jumbo, sp,rc). All 27 upserted cards came from exu, so it is the one set inwhich the routine post-upsert temporal write affected rows;

the deferred isolated G1 observation. Under the currently observedupstream state — every processed set supplied both temporal fields — anR8 failure would be repaired immediately by G2. A future upstream fieldretraction remains the explicit unresolved case.

2026-07-03 — V-C: Vault Feature hero, email de-identification, tagline retirement

Decision:

Vault Feature hero. The Dashboard hero is a single curated"archive moment" built only from existing in-memory data:hunting intent → want intent → unowned favorite → nearest-incompleteartist → empty state. First best candidate wins; ordering is rosterorder then existing cardData order (release date / set / number).Price is explicitly not a selection signal — the hero is aboutcollection meaning, not market value. Daily rotation was considered anddropped for V-C: stable-and-beautiful beats clever. Card tiers requirean image (imgSmall); imageless candidates are skipped so the panelnever renders a blank frame. Ownership is checked at selection time, soForce Owned / stale intent drops a card on the next render — the samesuppression rule Hunt Board uses. The memo is strictly read-only overintent, favorites, and ownership.

intentMap prop to Dashboard. Dashboard (not memoized, likeHuntBoard) now receives the full intentMap read-only. TheReact.memo constraint (pass intentStatus strings, never the Map)continues to apply only to CardTile, which is unchanged.

Email is not identity. user.email no longer appears on theDashboard; the hero eyebrow is a static "YOUR VAULT". Email remainsonly where it is functional (landing sign-out row, account context). A"Vault name" display-name setting was considered and deferred; if everwanted, the safe path is user_metadata via supabase.auth.updateUser— no schema.

Tagline retirement. "The art is the point." appeared three timesand had become a slogan sticker. Replaced by a single landing placementof "For collectors who follow the art." The Dashboard carries notagline — the featured card is the statement.

Copy register. "Send Magic Link 🔥" → "Send sign-in link";"No password. One click and you're in." → "No password — a link arrivesin your email."; "🎉 You own every card…" → "Every card on your list ishome." (quiet neutral styling); "ENTER BINDER" → "Enter the Vault" onthe landing button only. The Dashboard route, view key, and componentare not renamed.

Scope guardrails honored: no schema, no new dependencies, no profilesystem, no pinning, no Hunt Board / SharedBinder / ownership / intentsemantic changes, index.css untouched, ARCHITECTURE.md untouched (nomeaningful data-flow change — one read-only prop).

Status:

Accepted. Implemented in V-C.

2026-07-03 — A-D2d: Manage Artist in Archive (tier + remove)

Decision:

Added a small management surface for dynamically-tracked (user-added)artists only:

Schema: user_tracked_artists gets a tier text NOT NULL DEFAULT
'added' column with CHECK (tier IN ('main','secondary','added')), plusa new uta_update_own RLS UPDATE policy (none existed before). No changesto artists, cards_effective, or any other table.

Write path: unlike add_artist_to_archive, the two new mutations(updateArtistTier, removeArtistFromArchive in artistService.js) areplain RLS-guarded client calls, not RPCs — neither touches globalartist identity nor needs catalog validation, so a SECURITY DEFINERfunction would be unnecessary ceremony. add_artist_to_archive itself isunchanged; its INSERT now implicitly relies on the new column'sDEFAULT 'added'.

Scope is dynamic-only by construction, not by convention: curatedARTISTS entries are a hardcoded JS constant and are never rows inuser_tracked_artists. There is no code path by which a curated artist'sid could reach updateArtistTier or removeArtistFromArchive, so"curated tiering" was never a smaller/larger option here — it's simplyoutside what this table can express. The Manage control inArtistDirectory is rendered only on isDynamic tiles as an additionalbelt-and-suspenders guard.

UI: a small "⋯" Manage popover on dynamic artist tiles in ExploreArtists offers Main Artists / Secondary & Special / Your Additions(tier reassignment) and Remove from Archive (window.confirm-gated, nocustom modal). Dashboard's existing mainStats/secStats/addedStatssplit — already keyed on entry.tier — required no changes; adynamic artist's real tier now flows through automatically. Same forArtistDirectory's own section split.

Binder artist-filter dropdown: dynamic artists now fold into thematching Main/Secondary optgroup by tier, with "Your additions" kept foranything still at the added default. Small, additive, included in thisslice since it reused the tier data with no new state.

fetchTrackedArtistIds is untouched. A new fetchTrackedArtistTiershelper was added alongside it (returns Map<artistId, tier>) rather thanwidening the existing function's return shape, to keep the one existingcaller's risk at zero.

Remove from Archive deletes only the caller's ownuser_tracked_artists row (DELETE ... WHERE user_id = auth.uid() AND
artist_id = ...). It cannot cascade into artists, cards,card_overrides, card_favorites, user_card_intent, or manualowned/missing state, since none of those referenceuser_tracked_artists.

Reason:

Users can now add artists to their archive (A-D2c-lite) but had no way tosay where an addition belongs, or to undo an add. A-D2d closes that loopwith the smallest schema and write-path footprint the existing tablesupports, without reopening the (explicitly deferred) question of curatedMain/Secondary/Special tiering.

Status:

Accepted. SQL migration a-d2d-tier-and-manage.sql and app changes shiptogether. Next slice: TBD (see ROADMAP.md near-term priority order).

2026-07-02 — A-D2c-lite: Find Illustrator + Add to Archive, display_name hotfix, Brand V-B

Decision:

Three small, independently-shipped items closing out the sprint:

A-D2c-lite (app): Find Illustrator search added inside ExploreArtists, querying illustrator_directory viasearchIllustratorDirectory. Add to Archive wired toaddArtistToArchive (the add_artist_to_archive RPC). Newly addedartists surface under "YOUR ADDITIONS" once the parent refetches trackedids (onArtistAdded). This is the UI half of A-D2a/B0's write path.

SQL hotfix: add_artist_to_archive was updated to insertdisplay_name when creating a new artists row. Without it, adding anillustrator with no existing identity row (e.g. Midori Harada) failed theinsert. Verified via a-d2c-fix-add-artist-display-name.sql against theowner account inside a rolled-back transaction.

Brand V-B: the final logo asset (/illustrated-logo-gradient.svg) iswired into BlazLogo (component name kept as-is to avoid touching its 11call sites), logo sizing reduced across call sites, and the Dashboardhero no longer uses the large brand mark.

Reason:

A-D2c-lite completes the loop A-D2a/B0 opened (discovery + write pathexisted in SQL/services but had no UI). The display_name gap was a latentbug in the RPC only surfaced once real Add-to-Archive traffic hitillustrators with no prior artists row. Brand V-B was scoped as thelightweight "feel" pass noted as a flexible slot in the roadmap-sequencingdecision below.

Status:

Accepted. All three live in production. Next slice: A-D2d (untrack /remove from archive).

2026-07-02 — A-D2a/B0: tracked-artist data foundation and roster spine

Decision:

Formalize per-user artist tracking in two layers, both now live:

A-D2a (SQL, complete):

artists is formalized as global artist identity (id, alias arrays). Itcurrently contains 20 rows — the curated roster — but is no longerconceptually limited to it.

user_tracked_artists (RLS-enabled) is the per-user archive roster.

illustrator_directory is the discovery source for finding illustratorsbeyond the roster (name + card count over the card catalog).

add_artist_to_archive(p_illustrator text) RPC is the single write path foradding an illustrator to a user's archive (creates/normalizes the artistsidentity row and inserts the user_tracked_artists row).

Seeding: only the owner account was seeded with the 20 current artists.This is a migration convenience, not a universal default — new users are notauto-seeded.

A-D2b0 (app roster spine, complete):

effectiveRoster = curated ARTISTS + dynamic additions.

The curated ARTISTS constant remains the unconditional safety floor:every fetch in artistService.js soft-fails to empty, so missing tables,RLS blocks, or network failures render the app curated-only, byte-identicalto pre-B0 behavior.

Dynamic additions append under a "YOUR ADDITIONS" section (Dashboard,Explore Artists, Binder artist dropdown) only when non-empty.

Dynamic card fetch uses exact artist_id equality OR exact illustratorequality — never substring ILIKE.

SharedBinder and ArtistPicker remain curated-only.

No untrack and no untracked Artist Page yet (A-D2d and later).

Permanent product rule established alongside this foundation: users can lookat anything, but can act only on what's in their archive. Discovery surfaces(illustrator_directory search) are read-only windows; intent, favorites, ForceOwned, and all collection actions require the artist/card to be in the user'sarchive.

Reason:

Separating global identity (artists), per-user membership(user_tracked_artists), and discovery (illustrator_directory) lets thearchive grow per-user without touching the curated roster mechanism, keepsSharedBinder's public contract stable, and gives Add to Archive a singleaudited write path (RPC) instead of ad-hoc client inserts.

Status:

Accepted. A-D2a SQL ran cleanly in production; A-D2b0 shipped and validated.Next slice: A-D2c-lite (Find Illustrator + Add to Archive inside ExploreArtists), documented separately once validated.

2026-07-02 — A-D1: Explore Artists directory v0 (read-only)

Decision:

Ship the Artist Directory as a read-only "Explore Artists" view over thecurrent tracked roster: a new top-level artists view derived entirely fromin-memory state (visibleCardData, checkOwned, ARTIST_META), entered viaan "Explore Artists →" link on the Dashboard artist section header. Gallerycards show name, tags, accent, a 3-card color preview strip, and owned/totalprogress; tapping opens the existing Artist Page. No new Supabase reads, noschema changes, no track/untrack.

Reason:

The directory → lens pattern (which Set Lens v0 will copy) can be establishedwith zero data-layer risk because everything needed is already loaded.SQL confirmed select count(*) from artists; = 20 — the artists table iseffectively the curated/tracked roster, not a broader illustrator database.Broader artist discovery and "add to archive" therefore require an A-D2data-model decision (how untracked illustrators are represented and fetched)and were deliberately excluded from this slice.

Status:

Accepted. Live in production and validated. A-D2 (tracked-artist selection /untracked-artist read-only lens) is planned separately.

2026-07-02 — Roadmap sequencing after Hunt Board

Decision:

With Hunt Board H-1/H-2/H-3 complete and validated, the next slices are ordered:Product Surface Map → Artist expansion / tracked artist management → Set Lens v0→ Artist Page Slice C or Brand/Logo/Loading V-B (chosen by app feel at the time)→ Pokémon Search / Lens v0 → Collection Goals / Custom Lists → Binder Planning v0once the goal/list model is clearer.

Reason:

The Product Surface Map should precede new lens types so navigation is plannedrather than accreted. Set and Pokémon lenses build toward the collection-goalsabstraction incrementally. Binder Planning is deliberately last because itdepends on a clear goal/list model — starting a large Binder Composer earlyrisks overbuilding schema and UI.

Status:

Accepted. Guardrail — later slices are not pulled forward without an explicit decision.

2026-07-02 — Collection goals as the long-term organizing abstraction

Decision:

Illustrated Vault will eventually organize around "collection goals," whereArtist, Set, Pokémon, Custom List, and Binder Plan are different goal types,each with its own progress, hunt targets, and showcase.

Reason:

The strongest product triangle is artist collecting + set completion +Pokédex-style progression. A goal abstraction unifies these without rebuildingeach surface from scratch.

Constraint:

The abstraction must be earned gradually — each goal type ships as a focused,opinionated experience. The app must not become a generic database/filtertracker. Artist-first, premium, calm, visual, and intentional remains theproduct identity.

Status:

Accepted as strategic direction. No schema or UI generalization work yet.

2026-07-02 — Hunt Board is derived state; MAYBE LATER collapsed by default

Decision:

The Hunt Board is derived entirely from in-memory state (visibleCardData,intentMap, checkOwned) with no new Supabase calls. It groups byhunting / want / maybe, then by artist in roster order, sorted by market pricedescending with unpriced cards last. It shows only missing cards with intent,suppresses owned cards with stale intent rows, suppresses ignore, anddeduplicates by card id. Sections are collapsible (H-2); ACTIVE TARGETS andON THE LIST default open; MAYBE LATER defaults collapsed when it has cards;collapse state is local only and not persisted. Section headers received alarger mobile tap target (H-3).

Reason:

Hunt planning must stay fast and cheap — one intent fetch per session, allboard logic client-side. Collapsing MAYBE LATER keeps the board focused onactionable targets while keeping speculation discoverable via visible counts.Local-only collapse avoids persisting trivial UI state.

Status:

Accepted. H-1/H-2/H-3 live in production.

2026-07-02 — Hunt intent model (want / hunting / maybe / ignore)

Decision:

Hunt intent lives in a dedicated Supabase table user_card_intent withstatuses want, hunting, maybe, ignore, accessed only throughsrc/services/intentService.js. Intent is planning metadata only:

It never affects owned/missing state.

It never affects completion counts (ignore included).

Owned cards with stale intent rows are suppressed from hunt surfaces atrender time; rows are not eagerly deleted.

Intent is not exposed in SharedBinder v1.

Reason:

Ownership and completion are the app's ground truth and must stay independentof planning signals. Render-time suppression avoids write amplification andkeeps intent history recoverable. The share surface stays read-only andprivate-data-free.

Status:

Accepted. Live in production.

2026-07-02 — Favorites vs. intent disambiguation

Decision:

"Favorite" (★) is an emotional bookmark and can apply to any card. Intentstatuses are acquisition planning and apply meaningfully only to missing cards.The Dashboard "Most Wanted" section remains favorites-driven and was notmigrated to intent.

Reason:

The two signals answer different questions — "cards I love" vs. "cards I amactively planning to acquire." Merging them would overload one control andmuddy both meanings.

Status:

Accepted.

2026-07-02 — Gate 3: FK-based artist queries (artist_id) replace ILIKE

Decision:

cardService.fetchArtistCards queries cards_effective by.eq('artist_id', entry.artistId) when an artistId is present. The ILIKEalias path is retained only as a fallback for entries without an artistId.The localStorage cache key prefix was bumped pb7_supa_ → pb8_supa_ toinvalidate stale ILIKE-based caches.

Reason:

Substring ILIKE matching produced false positives — most notably suimatching "Misa Tsutsui." FK equality against the normalized artists table isprecise, faster, and makes artist identity a data-model concern rather than astring-matching concern.

Status:

Accepted. Live in production. Related cleanup: Tetsu Kayama alias/FK cleanup,three card_extras seed FK fixes (swsh11-186 → shinji-kanda,swsh12.5-GG19 → asako-ito, swsh12.5-GG69 → akira-egawa), shibuzoh aliasincludes Shibuzō, and the "Mosakazu Fukuda" alias was confirmed legitimate.

2026-07-02 — V-A: subtractive visual refinement over redesign

Decision:

Visual polish proceeds by removing the "campfire/game" prototype layer(excess glow, loud flame styling, gradient text) rather than building a newdesign system. The V-A Quiet Pass applied this: reduced logo glow, calmerflame/button styling, de-gradiented Dashboard hero, removed footer artist-nametext. index.html must remain a minimal Vite shell — an incident where appCSS was pasted into it caused a build failure and was fixed.

Reason:

The "archive" visual layer already works. Subtraction preserves what's good,keeps slices small and revertible, and avoids a risky global redesign.

Status:

Accepted. V-A applied; V-B (landing/loading/logo) is a future slice.

2026-06-26 — Gate 2: Vercel selected as production hosting platform

Decision:

Production deployment moved from GitHub Pages to Vercel. Vercel productionbranch set to gate-2/vite-migration initially, then migrated to main afterGate 2 stabilization (Phase 5K). Apex DNS record updated to point to Vercel(A @ 216.198.79.1).

Reason:

GitHub Pages does not support Vite build output natively — it requires aseparate deploy workflow that pushes dist/ to a gh-pages branch. Vercelprovides automatic Vite/React build support, per-branch and per-PR previewdeployments, and HTTPS without additional CI configuration. The Gate 2migration was the appropriate moment for this transition.

Implications:

.github/workflows/deploy-gate2.yml (manual GitHub Pages deploy) was theoriginal production deployment path. It was removed in commit 77b7a15after Gate 2 cleanup completed.

.github/workflows/build-check-gate2.yml (build-only smoke test) remains.It is workflow_dispatch-only and does not deploy. Minor future hygiene,such as renaming it, is outside Gate 2 closure.

GitHub Pages was unpublished in Phase 5M.

The old GitHub Pages Supabase Auth redirect URL(https://vladimirbuslayev.github.io/fire-chicken/) was removed in Phase 5L.

Status:

Accepted. In production since Phase 5H (2026-06-26). Vercel production branchmigrated from gate-2/vite-migration to main in Phase 5K (2026-07-01).

2026-06-25 — Gate 2: TCGdex illustrator lookup excluded from tcgdexService.js

Decision:

tcgdexService.fetchCardBriefs does not include the illustrator lookup branch from the legacy fetchCardBriefs. When entry.isSet is false, the function returns [] immediately rather than fetching from api.tcgdex.net/illustrators/{name}.

Reason:

Gate 2 rule: TCGdex is permitted only for entry.isSet paths. Artist-path card display must use Supabase cards_effective. The legacy illustrator lookup branch was a dead code path by the time the Phase 4D service layer was extracted — cardService.fetchArtistCards had already been rewritten to use Supabase for artist entries, and fetchCardBriefs was only reachable via the entry.isSet guard. Repairing and retaining the illustrator branch during a behavior-preserving migration would have re-introduced a live TCGdex runtime dependency that the architecture explicitly prohibits. The branch is excluded, not just disabled.

Status:

Accepted. Applied in Phase 4D Repair (2026-06-25).

2026-06-25 — Gate 2: fmtPrice rename from fmt$

Decision:

The fmt$ function in index.legacy.html is exported from src/utils/format.js as fmtPrice. All call sites in src/App.jsx use fmtPrice(...).

Reason:

fmt$ uses a trailing dollar sign, which is valid JavaScript but unusual in named module exports and confusing in a codebase that uses $ in other contexts (template strings, etc.). The rename improves readability without any behavior change. The function body is identical: n => (n != null && !isNaN(n)) ? '$' + Number(n).toFixed(2) : '—'. Since no currently-extracted module imported format.js before Phase 5B, there was no compatibility constraint on the name.

Status:

Accepted. Applied in Phase 4D Repair and Phase 5B (2026-06-25).

2026-06-25 — Gate 2: PriceChart uses hand-coded SVG; no chart library added

Decision:

PriceChart in src/App.jsx renders its chart using hand-coded SVG elements (<polyline>, <path>, <circle>, <text>). No external chart library (recharts or otherwise) was added to package.json.

Reason:

Pre-implementation audit of index.legacy.html lines 762–789 confirmed that the legacy PriceChart component is pure SVG with inline coordinate math. It does not use recharts or any other chart library. The legacy <head> contained no recharts CDN script. package.json on the branch did not include recharts. Adding a library that was not used in legacy would violate the behavior-preserving constraint.

Status:

Accepted. Confirmed in Phase 5B audit (2026-06-25).

2026-06-25 — Gate 2: SET_ORDER required direct import in App.jsx

Decision:

SET_ORDER is imported directly in src/App.jsx (from ./constants/setOrder.js) in addition to its existing import in src/utils/sort.js.

Reason:

ArtistSection's groupedBySet useMemo references SET_ORDER directly to sort set groups when Missing or Owned view mode is active. This was not captured in the initial Phase 5B import plan, which assumed SET_ORDER was only needed inside sort.js. The gap was identified during implementation by inspecting the component code before writing App.jsx — the direct reference at line 666 of the extracted component code would have produced a ReferenceError at runtime when a user activated Missing or Owned view mode, without causing a build failure. The import was added before the file was presented.

Status:

Accepted. Applied in Phase 5B (2026-06-25).

2026-06-25 — Gate 2: Phase 4D stubs repaired before Phase 5A wiring

Decision:

Seven Phase 4C/4D files that were broken self-import stubs were repaired with real function bodies before Phase 5B wired the service layer into the live component tree. The repair was a separate named step (Phase 4D Repair) rather than being folded into Phase 5B.

Reason:

During Phase 5A audit, all seven service/utility files were found to contain self-referential import statements (import { fn } from './src/services/fn.js') with no actual function implementations. These files were created as documentation placeholders during Phase 4C/4D but were structurally incorrect. Fixing them in a named phase (4D Repair) before Phase 5A build validation meant the broken stubs never entered a build-validated state, and the repair could be audited independently before being depended on by the App port.

Files repaired: src/utils/format.js, src/utils/imageUrl.js, src/services/collectionService.js, src/services/cardAdapter.js, src/services/imageService.js, src/services/tcgdexService.js, src/services/shareService.js.

The tcgdexService.js repair was also modified per the TCGdex exclusion decision above.

Status:

Accepted. Applied in Phase 4D Repair (2026-06-25). Build-validated in Phase 5A.

2026-06-25 — Gate 2: REDIRECT constant omitted from App.jsx

Decision:

const REDIRECT = 'https://vladimirbuslayev.github.io/fire-chicken/' (line 103 of index.legacy.html) was not ported to src/App.jsx.

Reason:

Pre-implementation grep confirmed that REDIRECT is defined on line 103 but not referenced anywhere in the component code (lines 446–1665). It is dead code in the legacy file. Including it in the Vite port would have been misleading — implying it has a purpose it does not serve.

Status:

Accepted. Applied in Phase 5B (2026-06-25).

2026-06-23 — Product identity

Decision:

Illustrated is a premium visual archive and collection companion for Pokémon card collectors. It is not merely a price tracker.

Reason:

The strongest differentiation is artist-first and artwork-first browsing, combined with physical collection tracking.

Status:

Accepted.

2026-06-23 — TCGdex role

Decision:

TCGdex should remain an ingestion/source-sync provider. Supabase should be the runtime source of truth for card display. The frontend should not rely on live TCGdex calls for normal artist pages or future set pages.

Reason:

External APIs can change shape, have missing data, or behave inconsistently. The frontend should receive predictable, app-shaped data from Supabase.

Status:

Accepted. Reinforced and further narrowed during Gate 2 (illustrator lookup path excluded).

2026-06-23 — Stabilize before migrating

Decision:

The current single-file MVP should be stabilized before migrating to Vite/React modules.

Reason:

Migrating unstable behavior risks moving bugs into the new architecture.

Status:

Accepted. Gate 1 stabilization completed at v0.1.4 before Gate 2 began.

2026-06-23 — No major features before Gate 1

Decision:

Do not add set browsing, Japanese cards, pricing confidence, or major UI redesigns before Gate 1 stabilization is complete.

Reason:

Adding features before stabilizing the data contract increases fragility.

Status:

Accepted.

2026-06-23 — Pricing philosophy

Decision:

Pricing should eventually be confidence-based, not presented as absolute truth. TCGPlayer and other automated pricing sources can be inconsistent. eBay sold links are useful for verification.

Status:

Accepted.

2026-06-23 — Japanese card identity

Decision:

Japanese and English cards should not overwrite each other. They are separate physical collector items, even if they may share artwork.

Status:

Accepted.

2026-06-23 — Enrichment read-model pattern

Decision:

Use card_extras + cards_effective for manual illustrator corrections instead of frontend override maps, sync-time backfill, or hybrid override logic.

Reason:

cards must remain the raw, sync-owned source of truth for TCGdex data. Manual editorial enrichment belongs in a separate table so the sync script can never accidentally overwrite it. A Supabase view (cards_effective) exposes the merged result — COALESCE(card_extras.illustrator_override, cards.illustrator) — to the frontend as a single illustrator field. The frontend does not need to know whether the value came from TCGdex or an override.

Status:

Accepted. Deployed and validated in v0.1.4.

2026-06-23 — Card-ID-level illustrator verification rule

Decision:

Manual illustrator overrides must be verified at exact card ID/local-number level before insertion into card_extras. Do not infer illustrator from Pokémon name, set, rarity, similar artwork, or another card in the same set.

Reason:

During v0.1.4 enrichment, two cards were initially misassigned by assumption: swsh12-TG11 Altaria was wrongly assigned to Asako Ito (correct: Yuu Nishida), and swsh12.5-GG69 Giratina VSTAR was wrongly assigned to Shinji Kanda (correct: Akira Egawa). Both errors were caught before the final insert. Verification must happen at the individual card ID level against a trusted source.

Status:

Accepted. Applied to all future bulk enrichment work.

2026-06-23 — Defer Artist Directory / Add Artist to Gate 2

Decision:

Do not add broad artist-add or artist directory functionality in Gate 1. The correct feature is an Artist Directory / Add Artist / Follow Artist flow with proper UX, belonging in Gate 2 or later.

Status:

Accepted. Deferred to Gate 2 backlog (has not yet been built in Gate 2 either).

2026-07-03 — V-C.1: Vault Queue is session-only; artist sections collapse locally

Decision:

The Dashboard hero's right side becomes a Vault Queue of alternate hero candidates drawn from the same selection ladder (hunting → want → favorite). Tapping a queue item swaps the featured card via plain component state — no persistence, no manual pinning, no schema, no localStorage. Main Artists and Secondary & Special become collapsible with local-only state (Main open, Secondary & Special collapsed by default, following the Hunt Board MAYBE LATER precedent). The header CSV button is renamed "Import" and softened but keeps its placement.

Reason:

The V-C hero left dead space on the right; showing the other ladder candidates makes the feature feel like a living archive without introducing a carousel, rotation, or any new product system. Session-only swap keeps the feature deterministic on reload (candidate 0 is byte-identical to the pre-V-C.1 pick) and honors the no-persistence guardrail. Local collapse state reduces page weight without a preferences system. Moving import out of the header was judged not worth the risk in a narrow pass; the rename alone corrects its perceived role from daily action to occasional sync.

Status:

Accepted. Shipped in the V-C.1 Dashboard polish pass.

2026-07-03 — Artist Page Slice C: consolidate, don't add; defer Manage to C2

Decision:

Slice C is a pure composition pass on the Artist Page: (1) hero Owned/Missing chips removed and the remaining Hunting / "On the list" chips become tappable shortcuts into the Hunting segment; (2) the About story band and Notable Cards band merge into a single collapsible "FROM THE ARCHIVE" band (default open, local state only); (3) artists with no story and no notable cards get a quiet fallback line instead of a silently missing band; (4) the Hunting segment gains a one-line summary, the ON THE LIST label, and warmer empty-state copy. Manage-in-mini-header for dynamic artists is split into a follow-up slice, Artist Page C2.

Reason:

The page's "grid with controls" feeling came from redundancy, not missing features: Owned/Missing chips duplicated the progress line two rems above them, and About + Notable formed two of five stacked bands before any collection content. Every Slice C move is a reduction or merge over existing state and data — no new state beyond one local collapse boolean, no schema, no service changes, no semantic changes to ownership/intent/favorites. Manage was excluded because it is the only move with structural risk (prop threading plus remove-then-navigate ordering); isolating it keeps both commits narrowly revertible, matching the A-D2c → A-D2d sequencing pattern. The Hunting-segment copy and label changes were verified safe for Binder/SharedBinder, which never set viewMode="hunting".

Status:

Accepted. Shipped as Artist Page Slice C; Manage-in-mini-header queued as Artist Page C2.
