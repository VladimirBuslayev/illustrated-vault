# Illustrated — Decision Log

## 2026-06-23 — Product identity

Decision:

Illustrated is a premium visual archive and collection companion for Pokémon card collectors.

It is not merely a price tracker.

Reason:

The strongest differentiation is artist-first and artwork-first browsing, combined with physical collection tracking.

Status:

Accepted.

## 2026-06-23 — TCGdex role

Decision:

TCGdex should remain an ingestion/source-sync provider.

Supabase should become the runtime source of truth for card display.

Reason:

The frontend should not depend on live external API shape during normal browsing.

Status:

Accepted.

## 2026-06-23 — Stabilize before migrating

Decision:

The current single-file MVP should be stabilized before migrating to Vite/React modules.

Reason:

Migrating unstable behavior risks moving bugs into the new architecture.

Status:

Accepted.

## 2026-06-23 — No major features before Gate 1

Decision:

Do not add set browsing, Japanese cards, pricing confidence, or major UI redesigns before Gate 1 stabilization is complete.

Reason:

Adding features before stabilizing the data contract increases fragility.

Status:

Accepted.

## 2026-06-23 — Pricing philosophy

Decision:

Pricing should eventually be confidence-based, not presented as absolute truth.

Reason:

TCGplayer and other automated pricing sources can be inconsistent. eBay sold links are useful for verification.

Status:

Accepted.

## 2026-06-23 — Japanese card identity

Decision:

Japanese and English cards should not overwrite each other.

Reason:

They are separate physical collector items, even if they may share artwork.

Status:

Accepted.

## 2026-06-23 — Enrichment read-model pattern

Decision:

Use `card_extras` + `cards_effective` for manual illustrator corrections instead of frontend override maps, sync-time backfill, or hybrid override logic.

Reason:

`cards` must remain the raw, sync-owned source of truth for TCGdex data. Manual editorial enrichment belongs in a separate table so the sync script can never accidentally overwrite it. A Supabase view (`cards_effective`) exposes the merged result — `COALESCE(card_extras.illustrator_override, cards.illustrator)` — to the frontend as a single `illustrator` field. The frontend does not need to know whether the value came from TCGdex or an override. This keeps the editorial and sync layers fully independent.

Status:

Accepted. Deployed and validated in v0.1.4.

## 2026-06-23 — Card-ID-level illustrator verification rule

Decision:

Manual illustrator overrides must be verified at exact card ID/local-number level before insertion into `card_extras`. Do not infer illustrator from Pokémon name, set, rarity, similar artwork, or another card in the same set.

Reason:

During v0.1.4 enrichment, two cards were initially misassigned by assumption: `swsh12-TG11` Altaria was wrongly assigned to Asako Ito (correct: Yuu Nishida), and `swsh12.5-GG69` Giratina VSTAR was wrongly assigned to Shinji Kanda (correct: Akira Egawa). Both errors were caught before the final insert, but the failure mode is clear — inference from name or set proximity is not reliable. Verification must happen at the individual card ID level against a trusted source (Bulbapedia, pokemontcg.io, or the physical card).

Status:

Accepted. Applied to all future bulk enrichment work.

## 2026-06-23 — Defer Artist Directory / Add Artist to Gate 2

Decision:

Do not add broad artist-add or artist directory functionality in Gate 1.

Reason:

The enrichment read-model work surfaced new illustrators — N-DESIGN Inc., Akira Egawa, Yuu Nishida — that are not yet in the tracked artist list. Adding them via a rushed Gate 1 patch would bypass the intentional curation that distinguishes Illustrated Vault. The correct feature is an Artist Directory / Add Artist / Follow Artist flow with proper UX. Gate 1 is stabilization; that feature belongs in Gate 2 or later.

Status:

Accepted. Deferred to Gate 2 backlog.

