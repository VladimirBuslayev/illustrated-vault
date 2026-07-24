# OL-2C.1 — Image Resilience — Closeout

**Status:** ✓ Complete  
**Completed:** 2026-07-24  
**Production:** `illustratedvault.com`  
**Branch:** `ol-2c1-image-resilience` → merged to `main`  
**Predecessor:** OWN-0B — Authenticated Ownership Cutover

## Objective

OL-2C.1 makes card-image failure safe and consistent without weakening exact physical-printing identity.

Locked rule:

**Never render an image that is not verified as the exact physical printing of the card.**

When exactness cannot be proven, Illustrated Vault now fails closed to a calm neutral unavailable state instead of silently substituting another language, set, variation, or printing.

This was a runtime presentation-resilience slice only. It did not change ownership, intent, import matching, Supabase schema/RPCs, catalog records, pricing, or SharedBinder ownership.

## Production image hierarchy

For every card that reaches image rendering:

1. exact TCGdex primary URL;
2. one retry of that same primary image;
3. verified exact Pokémon TCG API fallback;
4. one retry of that verified fallback image;
5. neutral unavailable state.

A rendered `<img>` failure is not classified as 404, timeout, decode failure, or another transport condition; it simply receives one bounded retry before the chain advances.

There is no runtime Limitless fallback in OL-2C.1.

## Exact-printing fallback verification

`src/services/imageService.js` now accepts the full card when checking the Pokémon TCG API fallback.

A fallback image is renderable only when the response verifies the same printing through:

- exact card-ID equality;
- conservative normalized card-number equality;
- conservative normalized card-name equality.

Set identity is retained as supporting diagnostic evidence only.

Verification deliberately favors false negatives over false positives. Important normalization protections include:

- `Nidoran♀` and `Nidoran♂` remain distinct;
- Latin diacritics may fold;
- Japanese kana voicing is preserved;
- apostrophe variants normalize consistently;
- meaningful card-number prefixes and suffixes are preserved.

A mismatch or insufficient verification never exposes a renderable fallback URL.

## Verification fingerprint and stale-state protection

Fallback verdict reuse is bound to a collision-safe serialized fingerprint over:

- canonical card ID;
- normalized local number;
- normalized card name.

The fingerprint is used for:

- fallback-cache validation;
- in-flight request deduplication;
- short error cooldown;
- once-per-session mismatch diagnostics.

A catalog correction to name or number therefore invalidates a stale cached verdict even when the canonical card ID is unchanged.

`src/components/CardImage.jsx` centralizes the image state machine through:

- `useCardImage`;
- `CardImage`.

Two Preview-discovered runtime protections are part of the final production implementation:

### R1 — stale cross-card protection

Hook state is synchronously associated with the current verification identity. An old verified fallback can never render for a newly selected card during a React identity transition.

### R2 — same-URL retry remount

The hook separates:

- `identityKey` — verification/reset identity;
- `renderKey` — concrete render-attempt identity.

`renderKey` includes the current phase and source URL. This forces React to create a fresh `<img>` for a permitted retry even when the retry uses the same literal URL.

This R2 behavior was found through live Vercel Preview browser testing after the earlier harness had passed.

## Cache and network contract

New fallback-verdict cache prefix:

`pb_img2_{cardId}`

Persisted outcomes:

- `verified` — 30-day TTL;
- `absent` — 72-hour TTL;
- `mismatch` — 72-hour TTL.

`error` is never persisted.

HTTP/API classification inside the fallback service:

- 404 / 410 → `absent`;
- 429 / 5xx / permission-auth failures / other unexpected non-OK responses → `error`;
- transport, network, timeout, or invalid-response failures → `error`.

A 60-second in-memory cooldown by verification fingerprint prevents repeated remounts from amplifying a temporary API outage or rate limit.

Concurrent fallback requests for the same fingerprint share one in-flight Promise.

Settings → Clear card cache removes both:

- legacy `pb_fallback_img_`;
- current `pb_img2_`.

OWN-0B card-object caches `pb9_supa_` and `pb7_cards_` are unchanged.

## Surface coverage

The resilience seam covers the live card-image surfaces, including:

- Dashboard Vault Feature;
- Dashboard queue;
- Dashboard Most Wanted thumbnails;
- Artist hero collage;
- Artist Notable Cards;
- Artist/Binder card tiles;
- CardModal;
- Hunt Board grid and row thumbnails;
- Hunt Show;
- Planned Binder search;
- Artist Directory previews;
- Owned Library;
- SharedBinder through `CardTile`.

SharedBinder receives the same image resilience while retaining its separate legacy ownership boundary.

Editorial/decorative candidate selection intentionally remains primary-image-gated for:

- Dashboard Vault Feature / queue;
- Artist hero collage;
- Artist Directory preview.

OL-2C.1 hardens cards already selected by those surfaces; it does not perform asynchronous fallback-aware candidate selection.

## Unavailable-image presentation

`src/styles/index.css` adds a shared calm dark image-frame/loading/unavailable treatment for previously unframed image sites.

The final behavior:

- reserves image dimensions and aspect ratio;
- prevents raw browser broken-image glyphs;
- distinguishes loading from unavailable;
- keeps card metadata inspectable;
- introduces no generic card-back or substitute card image.

Existing `.card-blank`, `.ol-frame`, and `.ol-miss` behavior remains in place where already appropriate.

The decorative artist collage renders nothing when an image becomes unavailable rather than inserting a placeholder into the composition.

## Production files changed

- `src/App.jsx`
- `src/components/CardImage.jsx` — new
- `src/services/imageService.js`
- `src/styles/index.css`

Explicitly unchanged by OL-2C.1:

- `src/services/cardAdapter.js`
- `src/services/cardService.js`
- `src/services/ownedLibraryService.js`
- `src/services/tcgdexService.js`
- `src/services/binderService.js`
- `src/utils/cache.js`
- `src/utils/imageUrl.js`
- `src/utils/keys.js`
- all SQL / Supabase schema / RPC objects
- OWN-0B ownership selector and authority gate
- intent / favorites / pricing
- SharedBinder ownership

## Validation evidence

### Instrumented Preview — organic runtime

The first exported Preview audit contained:

- 256 audit rows;
- 191 unique cards;
- 247 `ready / primary` outcomes;
- 9 unavailable outcomes;
- 0 verification mismatches;
- 0 retry-limit violations.

Additional live walkthroughs explicitly covered initially missing surfaces:

- Owned Library: 60 audit rows;
- Hunt Show: 15 audit rows;
- Artist Directory preview: 63 audit rows;
- SharedBinder: 854 `shared-binder-tile` audit rows in the share-view session.

Those counts are separate runtime observations, not one deduplicated combined export.

### Real Pokémon TCG API behavior

Live Preview network checks observed both:

- 404 / not found;
- 500 / internal server error.

The runtime correctly treats definitive absence as negative-cacheable while leaving server/network errors unpersisted.

### Controlled browser fixtures

**A — dead primary → primary retry succeeds**

- final state: `ready`;
- tier: `primary`;
- reason: `primary_retry_ok`;
- retry current: 1;
- retry total: 1.

**B — identical dead primary URL on both attempts → verified fallback**

Live browser evidence showed two separate failed requests to the same literal dead URL, followed by the verified exact fallback.

- final state: `ready`;
- tier: `ptcgio-verified`;
- reason: `fallback_verified_ok`;
- retry total: 1;
- CardModal displayed: `Image via Pokémon TCG API — verified exact printing.`

This validated the R2 `renderKey` correction.

**C — verification mismatch**

- final state: `unavailable`;
- tier: `none`;
- reason: `verification_mismatch`;
- no fallback image rendered.

### Production-clean package

Before merge:

- temporary audit / fixture instrumentation was removed;
- blocking instrumentation grep returned zero matches;
- clean Vercel Preview deployed successfully;
- `window.__ivImageAudit`, `window.__ivImageAuditCsv`, and `window.__ivImageFixtures` were all `undefined`.

Reported production-clean harnesses were all green, including:

- syntax / AST: 0 diagnostics, 0 parse errors;
- structural assertions: 72 / 72;
- normalizer + service: 67 / 67;
- cached mismatch: 11 / 11;
- browser-faithful state/retry harness: 49 / 49;
- stale-cross-card regression: 9 / 9.

## Production confirmation

Confirmed 2026-07-24:

- merged to `main`;
- Vercel production deployment passed;
- `illustratedvault.com` smoke test passed;
- production console:
  - `typeof window.__ivImageAudit` → `"undefined"`;
  - `typeof window.__ivImageAuditCsv` → `"undefined"`;
  - `typeof window.__ivImageFixtures` → `"undefined"`.

OL-2C.1 is therefore closed.

## OWN-0B invariants preserved

OL-2C.1 did not alter ownership truth.

The following remain unchanged:

- centralized authenticated `effectiveOwned` / `checkOwned`;
- canonical `ownershipNamespace`;
- active-snapshot authority gating;
- manual override precedence;
- SharedBinder's separate `isCardOwned` path;
- `pb9_supa_` / `pb7_cards_`;
- intent and hunt semantics.

No SQL, RPC, schema, matcher, snapshot, or ownership migration was required.

## Remaining boundaries

- Runtime image failure is now contained, but catalog/image-source coverage remains a data-quality question.
- Conservative exact-printing verification intentionally accepts reduced fallback coverage when identity cannot be proven.
- Limitless / proxy images remain disabled.
- Editorial/decorative candidate selection remains primary-image-gated.
- SharedBinder ownership remains its separate loose share-token `owned_keys` boundary.
- The 17 noncanonical legacy ownership overrides remain stored but inert.
- External-set ownership remains override-only until a separately validated canonical mapping exists.

## Next recommended slice

**CAT-0 — Catalog Source & Coverage Audit**

OL-2C.1 makes runtime image failure safe. The next question is evidence: where and why are catalog fields or exact images missing, stale, or inconsistent across sources?

CAT-0 should remain diagnostic:

- measure catalog and image coverage by era / set / source;
- quantify exact-image unavailable and verification-mismatch tails;
- identify source-specific structural gaps;
- distinguish data remediation from runtime fallback policy;
- avoid a broad catalog rewrite until evidence identifies a narrow justified slice.

Roadmap after CAT-0:

`next evidence-backed catalog slice → OWN-1 Artwork vs Printing ownership policy`
