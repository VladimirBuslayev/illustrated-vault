# Illustrated Vault — Architecture

Last updated: 2026-08-21

## Production architecture

Production at `https://illustratedvault.com` is served by Vercel from the
`main` branch.

Vercel runs `npm install && npm run build` on push to `main` and serves
`dist/` directly. No manual deploy workflow is involved. The legacy
`.github/workflows/deploy-gate2.yml` was removed in commit `77b7a15`.

## Data source principles (unchanged)

TCGdex is an ingestion/source-sync provider. Supabase is the runtime source of truth for card display. The frontend does not depend on live TCGdex calls for normal artist pages.

TCGdex runtime usage is restricted: `tcgdexService.js` permits only the `entry.isSet` path (fetching a specific set by ID). The illustrator lookup path (`/illustrators/{name}`) is intentionally excluded. See DECISION_LOG.md.

Pricing data is adapted at write time in `sync-cards.mjs`, not at read time in the frontend. Pricing is buying guidance.

## Current module structure (main)

```
src/
  App.jsx
  main.jsx
  assets/
    logo.webp
  constants/
    artists.js
    config.js
    setOrder.js
  services/
    supabaseClient.js
    cardService.js
    collectionService.js
    shareService.js
    cardAdapter.js
    imageService.js
    tcgdexService.js
    intentService.js
    artistService.js
  styles/
    index.css
  utils/
    cache.js
    cardUtils.js
    format.js
    imageUrl.js
    keys.js
    slug.js
    sort.js
public/
  apple-touch-icon.png
  favicon.png
  manifest.json
  icons/
    icon-192.png
    icon-512.png
  sw.js
docs/
  archive/
    index.legacy.html
index.html
package.json
vite.config.js
tailwind.config.js
postcss.config.js
.github/
  workflows/
    build-check-gate2.yml  — manual-only; does not deploy
```

## Component boundary — current state

`src/App.jsx` is the component root. It is a single file (~1,444 lines) containing the full component tree, including post-Gate-2 additions: `ArtistPage` 2.0, `HuntStatusDot`, and `HuntBoard`. Keeping it single-file is intentional; component splitting into `src/components/` files is deferred and must not happen without explicit approval.

`src/main.jsx` is the Vite entry point. It:
- imports `{ App, SharedBinder, ErrorBoundary }` from `./App.jsx`
- detects `?share=TOKEN` in the URL
- renders `<ErrorBoundary>{token ? <SharedBinder token={token} /> : <App />}</ErrorBoundary>`

This mirrors the legacy `ReactDOM.createRoot` call at the bottom of `index.legacy.html` exactly.

## Module layer — responsibilities

### Constants (`src/constants/`)

Pure data. No imports. No side effects.

| File | Exports | Source |
|---|---|---|
| `artists.js` | `ARTISTS`, `ARTIST_FACTS`, `ARTIST_META` | index.legacy.html lines 106–212 |
| `config.js` | `CACHE_TTL`, `PRICE_VARIANT_ORDER` | index.legacy.html lines 102, 266 |
| `setOrder.js` | `SET_ORDER` | index.legacy.html lines 225–253 |

`SET_ORDER` is used in both `src/utils/sort.js` (imported) and directly in `ArtistSection` inside `src/App.jsx` (imported). Do not remove or alter values — they are the authoritative sort key for card chronological ordering.

### Utilities (`src/utils/`)

Pure functions. No Supabase. No network.

| File | Exports | Notes |
|---|---|---|
| `cache.js` | `lsGet`, `lsSet`, `lsDel` | localStorage helpers with silent error swallowing |
| `cardUtils.js` | `isTcgPocketCard` | Image URL path test |
| `format.js` | `fmtPrice`, `todayStr` | `fmtPrice` was `fmt$` in legacy; renamed for ESM clarity; behavior identical |
| `imageUrl.js` | `imgSmall`, `imgLarge` | TCGdex image URL suffix builders |
| `keys.js` | `normName`, `normNum`, `normSet`, `makeKeys`, `isCardOwned` | Frozen normalisers; **not** the authenticated ownership authority — `makeKeys`/`isCardOwned` serve the SharedBinder share-token path only. `normName`/`normNum`/`normSet` define Tier-1 import identity and are consumed by the CAT-2B1 sync guard and CAT-2D alias admission. `makeKeys` output is persisted in Supabase; do not alter any of them |
| `slug.js` | `toSlug` | URL-safe slug generator |
| `sort.js` | `getBestPrice`, `sortCards` | Imports from `constants/config.js` and `constants/setOrder.js` |

### Services (`src/services/`)

All network and Supabase I/O. Imported by `src/App.jsx`.

| File | Exports | Notes |
|---|---|---|
| `supabaseClient.js` | `supabase` | Single ES module Supabase client; replaces CDN `window.supabase.createClient` in legacy |
| `cardService.js` | `fetchArtistCards` | Artist path: Supabase `cards_effective`; set path: TCGdex via `tcgdexService` |
| `collectionService.js` | `loadUserData`, `saveCollection`, `saveOverride`, `savePricePoint` | All `user_collection`, `card_overrides`, `price_history`, `card_favorites` reads/writes |
| `shareService.js` | `fetchSharedCollection` | Calls `get_shared_collection` RPC |
| `cardAdapter.js` | `supaRowToCard` | Maps `cards_effective` row to TCGdex card shape |
| `imageService.js` | `fetchFallbackImage`, `buildLimitlessGuess` | pokemontcg.io fallback; Limitless CDN guess |
| `tcgdexService.js` | `fetchCardBriefs`, `fetchFullCard` | TCGdex only; `fetchCardBriefs` returns `[]` when `entry.isSet` is false |
| `intentService.js` | `fetchUserIntent`, `setCardIntent`, `clearCardIntent`, `INTENT_STATUSES` | All `user_card_intent` reads/writes; no caching; RLS-enforced `user_id = auth.uid()` |
| `artistService.js` | `fetchTrackedArtistIds`, `fetchTrackedArtistTiers`, `fetchArtistIdentities`, `searchIllustratorDirectory`, `addArtistToArchive`, `updateArtistTier`, `removeArtistFromArchive` | `user_tracked_artists` / `artists` reads for the dynamic roster (soft-fail to empty; curated ARTISTS remain the safety floor); `illustrator_directory` search and `add_artist_to_archive` RPC write path for A-D2c-lite Find Illustrator / Add to Archive; `updateArtistTier` / `removeArtistFromArchive` (A-D2d) are direct RLS-guarded writes to `user_tracked_artists`, not RPCs — scoped to dynamic artists only, since curated entries are never rows in that table; no caching |

## Data flow — artist card display

```
App.useEffect → loadAllEntries
  → fetchArtistCards(entry)           [cardService.js]
    if entry.isSet:
      → fetchCardBriefs(entry)        [tcgdexService.js]
        → GET api.tcgdex.net/sets/{id}
      → fetchFullCard(id) × N         [tcgdexService.js]
        → GET api.tcgdex.net/cards/{id}
    else (artist path):
      if entry.artistId:
        → supabase.from('cards_effective').select(...).eq('artist_id', entry.artistId)
      else (fallback only):
        → supabase.from('cards_effective').select(...).or(ilikeFilters)
      → supaRowToCard(row) × N        [cardAdapter.js]
  → setCardData(cards)
```

The FK path (Gate 3D) is the normal path for all tracked artists. The ILIKE
alias path exists only as a fallback for entries without an `artistId`.
The localStorage cache key prefix is `pb8_supa_` (bumped from `pb7_supa_` to
invalidate stale ILIKE-based caches).

## Data flow — collection / ownership

> **Corrected 2026-08-17 (CAT-2D.2 closeout).** This section previously
> described `owned_keys` / `isCardOwned` as the authenticated ownership
> authority. That has not been true since OWN-0B. The description below is the
> current canonical behaviour; the rest of this file has NOT been modernised in
> the same pass — see *Documentation debt* at the end.

**Authenticated ownership authority is the active import snapshot, by canonical
card ID.** `get_active_snapshot_owned_card_ids()` returns the distinct set of
canonical IDs matched by the caller's one active batch. Every authenticated
ownership decision routes through the single `checkOwned` seam in `App`, which
consumes that set.

The precedence ladder is explicit and ordered:

```
force-missing override  →  force-owned override  →  active snapshot  →  missing
```

Manual force-owned / force-missing overrides (`card_overrides`) remain distinct
explicit layers on top of snapshot authority — they are not merged into it.

```
App (after auth) → fetchActiveSnapshotOwnedCardIds()   [ownedLibraryService.js]
  → supabase.rpc('get_active_snapshot_owned_card_ids')
  → { state, batchId, ownedCardIds:Set<canonical id>,
      reconciliation:{ distinctMatchedCardIds,      // historical, stored ids
                       distinctResolvedCardIds,     // after alias resolution
                       aliasCollapsedCount,         // matched − resolved, ≥ 0
                       matchedRows } }

checkOwned(card) → force-missing? → force-owned? → ownedCardIds.has(card.id)
```

The wrapper is strict and fails closed: the returned set size must equal
`distinctResolvedCardIds`, resolved may never exceed matched, and
`aliasCollapsedCount` must equal their difference. Alias resolution may MERGE
two identities onto one printing; it may never INVENT ownership.

`user_import_rows` is **immutable historical evidence** — the record of what the
matcher concluded against the catalog as it existed at import time. It is never
rewritten. Identity drift is handled at read time instead (below).

`user_collection.owned_keys` / `isCardOwned` / `makeKeys` are **not** the
authenticated ownership authority. They remain in use only on the unauthenticated
SharedBinder share-token path, which is a separate, looser boundary and is
deliberately deferred.

**Collector ownership is exact-printing authority.** Owning one printing implies
nothing about another printing, another language, or another card sharing the
same artwork. Nothing in this pipeline may infer ownership across those axes.

## Catalog identity resolution (CAT-2D)

TCGdex periodically re-namespaces a subset out of its parent set, changing the
canonical provider ID of a physical printing. **Provider IDs are mutable source
identifiers, not permanent printing identity.** Three layers keep collector
identity stable across that:

| Layer | Contents | Read by |
|---|---|---|
| `public.cards` | raw provider history — everything ever ingested, including superseded identities | sync tooling only |
| `public.card_identity_aliases` | evidence-backed obsolete ID → canonical survivor | resolution paths, via the view below |
| `public.cards_effective` | canonical survivors only; alias IDs excluded | the archive / ownership-facing catalog paths |

`cards_effective` is the **canonical Supabase-backed product catalog surface** and
the authority for the archive and ownership-facing catalog paths. It is not the
only place card data can come from: `cardService.fetchArtistCards` still has a
separate provider-backed set path (`tcgdexService`, the `entry.isSet` branch).
That path is **not an identity or ownership authority** — no external-set cards
render in the current authenticated collection surfaces, and any future set-path
card is override-only until a separately validated canonical mapping exists.

- **Resolution depth is exactly one. No chains, no cycles.** A two-sided trigger
  rejects both an alias whose target is itself obsolete and an alias that is
  currently a survivor for other rows. Resolution is therefore a single lookup,
  never a recursive walk. Depth one is **not** one-alias-per-survivor: MANY
  historical aliases may resolve onto ONE canonical survivor, and Family B is
  expected to need exactly that.
- The alias table is **private**: `anon`, `authenticated` and `service_role` hold
  zero privileges on it. The only public surface is the two-column owner-rights
  view `public.card_identity_resolution` (SELECT only), so provenance —
  evidence, approver, timestamps — is unreachable by any runtime role.
- `public.cards` **retains** obsolete rows permanently — they are excluded from
  `cards_effective`, not deleted. A retained row may preserve source metadata or
  assets absent from its current survivor; CAT-2D.2 ran no image-difference
  census, so nothing is claimed about how many actually differ. Retention is
  justified by reversibility: deletion is the only irreversible act in the
  design.
- The ownership RPC and the OL-0D read model **resolve aliases at read time**.
  OL-0D aggregates by the resolved ID *before* joining `cards_effective`, so
  quantities from several historical IDs merge onto one canonical row rather
  than reporting catalog-missing.
- The CAT-2B1 sync collision guard builds its identity index from
  `cards_effective`, so an aliased row cannot participate in collision detection.

Live as of CAT-2D.2: 192 aliases; `cards` 23,780; `cards_effective` 23,588.
See `CURRENT_STATE.md` and `CAT-2D.2_FAMILY_A_RECONCILIATION.md`.

## Durable override channels (`card_extras`)

`public.cards` stays raw, sync-owned provider history and must remain
re-syncable without losing curated corrections. Two independent,
provenance-aware override channels live beside it on `card_extras` — never
inside `cards` — and both are merged into the frontend read model only by
`cards_effective`, the single rendering chokepoint:

| Channel | Columns on `card_extras` | `cards_effective` expression | Shipped by |
|---|---|---|---|
| Image override | `image_url_override`, `image_override_source_card_id` (FK → `cards(id)`, `ON DELETE RESTRICT`), `image_override_evidence`, `image_override_approved_by`, `image_override_approved_at` | `coalesce(ce.image_url_override, c.image_url)` | CAT-3B (channel, 2026-08-19) / CAT-3B.1 (192 rows, 2026-08-20) |
| Attribution override | `illustrator_override` (pre-existing), `artist_id_override` (FK → `artists(id)`, `ON DELETE RESTRICT`), `attribution_override_evidence`, `attribution_override_approved_by`, `attribution_override_approved_at` | `case when ce.illustrator_override is not null then ce.artist_id_override else c.artist_id end as artist_id` | F-15 (channel, 2026-08-21) |

**Attribution uses `CASE`, not `COALESCE` — deliberately.**
`coalesce(ce.artist_id_override, c.artist_id)` cannot express "deliberately no
artist": a NULL override falls through to the raw, possibly-wrong `artist_id`.
The image channel's COALESCE is correct for images (there is no
"deliberately no image" case); attribution needs the stronger CASE because a
future correction may need to set `artist_id_override` to NULL on purpose.
The discriminator is `illustrator_override`, not `artist_id_override` —
presence of an illustrator correction is what makes the raw FK untrustworthy.

**Admission is restricted and channel-specific**, each via its own `BEFORE
INSERT OR UPDATE`, `SECURITY INVOKER` trigger on `card_extras`:

- Image admission (CAT-3B) admits only where the source is an approved alias
  relationship of the target card, read through the public owner-rights view
  `public.card_identity_resolution` (never the private `card_identity_aliases`
  table directly), and the proposed value equals that source card's current
  `image_url`.
- Attribution admission (F-15) admits only through the same aliases-only
  resolver contract `sync/sync-cards.mjs :: resolveArtistId()` uses — never
  `artists.id`, never fuzzy, never substring — so sync and admission can
  never disagree about what a name means.

Both are idempotence-guarded (`IS NOT DISTINCT FROM`, never `=`): an update
that changes none of a channel's fields is not re-admitted, so unrelated
edits (e.g. `source_note`) never trigger revalidation.

`card_extras` currently has three triggers total, coexisting: the CAT-3B
image admission trigger, the F-15 attribution admission trigger, and the
pre-existing `updated_at` trigger. Provenance columns for both channels are
withheld from `anon`/`authenticated`; the public column-level `SELECT` grant
on `card_extras` is exactly `card_id`, `illustrator_override`,
`image_url_override`, `artist_id_override` — no table-level grant, no
provenance exposure. RLS is enabled, not forced, with exactly one permissive
policy (`card_extras_public_select`, roles `{anon, authenticated}`, `USING
true`, no `WITH CHECK`).

The image channel shipped its schema **empty** in CAT-3B and was populated
by a separate, later, separately-approved slice — CAT-3B.1 wrote the 192
approved image overrides. The attribution channel did not ship empty: F-15's
**same** migration that built the channel also performed the required
behavior-preserving backfill of the five pre-existing `illustrator_override`
rows with the new provenance bundle (resolver-consistent, zero
effective-attribution change) — that backfill was not a separate slice. What
remains at zero is NEW ATTR-1 correction targets — the twelve confirmed
repairs are the channel's first intended *new-correction* use, are a
separate later population, and have not run (0/12). See `CURRENT_STATE.md`,
`CAT-3B_DURABLE_IMAGE_OVERRIDE.md` and `F-15_IMPLEMENTATION.md`.

## Data flow — hunt intent

```
App.useEffect (on user change) → fetchUserIntent(userId)   [intentService.js]
  → supabase.from('user_card_intent').select('card_id, status')
  → setIntentMap(Map<cardId, status>)

CardModal Hunt status buttons →
  handleSetIntent(card, status)  → optimistic Map update → setCardIntent (upsert)
  handleClearIntent(cardId)      → optimistic Map update → clearCardIntent (delete)
  (both roll back the Map on Supabase error)

HuntBoard / ArtistPage hunt surfaces derive entirely from
(visibleCardData, intentMap, checkOwned) in memory — no additional Supabase calls.
```

Invariants: intent never affects `checkOwned`, ownership keys, or completion
counts. Owned cards with stale intent rows are suppressed at render time.
Intent is not exposed in SharedBinder v1.

## Data flow — dynamic tracked artists (A-D2b0)

```
App.useEffect (on user change) → fetchTrackedArtistIds(user.id)   [artistService.js]
  → supabase.from('user_tracked_artists').select('artist_id')
  → ids not in curated ARTISTS → fetchArtistIdentities(newIds)
    → supabase.from('artists').select('id, aliases')
  → setDynamicArtists([{ name, tier:'added', isDynamic, artistId, aliases }])

effectiveRoster = useMemo([...ARTISTS, ...dynamicArtists])
  → loadEntry per dynamic artist (incremental effect; pb8 cache dedupes)
  → cardService dynamic branch: artist_id.eq OR illustrator.in(exact names)
```

Every artistService path soft-fails to empty: missing tables, RLS blocks, or
network failures render the app curated-only, identical to pre-B0 behavior.
SharedBinder and ArtistPicker remain curated-only.

## Data flow — manage artist in archive (A-D2d)

```
ArtistDirectory tile (isDynamic only) → "⋯" Manage popover
  → Move to Main/Secondary/Your Additions:
      handleTierChange → App.handleChangeArtistTier(artistId, tier)
        → updateArtistTier(user.id, artistId, tier)   [artistService.js]
          → supabase.from('user_tracked_artists').update({tier}).eq(...)
        → on success: setDynRefresh(n+1) → dynamic-artist effect re-fetches
          → dynamicArtists[i].tier now reflects the new value
          → Dashboard / ArtistDirectory section splits (already tier-keyed)
            reclassify the tile with no component changes
  → Remove from Archive (window.confirm-gated):
      handleRemove → App.handleRemoveArtist(artistId)
        → removeArtistFromArchive(user.id, artistId) [artistService.js]
          → supabase.from('user_tracked_artists').delete().eq(...)
        → on success: setDynRefresh(n+1) → artist drops out of dynamicArtists
          → effectiveRoster / all roster-driven views update on next render
```

Both mutations are plain RLS-guarded table writes (not RPCs) and are
reachable only for `isDynamic` tiles — curated `ARTISTS` entries are never
rows in `user_tracked_artists`, so there is no code path by which a curated
artist could be tier-changed or removed by this flow. Neither mutation
touches `artists` (global identity), `cards`, `card_overrides`,
`card_favorites`, `user_card_intent`, or manual owned/missing state.

## Data flow — SharedBinder

```
main.jsx: SHARE_TOKEN → <SharedBinder token={token} />
  → fetchSharedCollection(token)      [shareService.js]
    → supabase.rpc('get_shared_collection', { p_token: token })
  → fetchArtistCards(entry) per artist (same path as App)
```

## Supabase read model

`cards_effective` is the frontend read model. Since Gate 3 it exposes
`artist_id`, and the normal artist query is FK-based:

```sql
SELECT id, name, set_id, set_name, local_id, illustrator, artist_id,
       image_url, rarity, release_date, pricing, pricing_updated_at
FROM cards_effective
WHERE artist_id = '{artistId}'
ORDER BY release_date ASC NULLS LAST, set_id, local_id
```

The ILIKE alias variant (`illustrator ILIKE '%{name}%' OR ...`) remains only
as a fallback for entries without an `artistId`.

`supaRowToCard` maps rows to the TCGdex card shape the components expect. The
mapping is stable and must not be altered without a corresponding schema
migration.

User-scoped tables: `user_collection`, `card_overrides`, `price_history`,
`card_favorites` (via `collectionService.js`), `user_card_intent` (via
`intentService.js`) and `user_tracked_artists` (via `artistService.js`) — all
RLS `user_id = auth.uid()`. Editorial enrichment lives in `card_extras` —
image and attribution override channels, see "Durable override channels"
above — merged into `cards_effective`; the normalized `artists` table (with
alias arrays) backs FK artist identity and is formalized as global artist
identity (20 rows today). `illustrator_directory` is the read-only discovery
view (illustrator + card count) backing the future Find Illustrator flow.

## Backend RPC dependencies — unchanged

| RPC | Signature | Used by |
|---|---|---|
| `get_shared_collection` | `p_token TEXT` | `fetchSharedCollection` — share/binder read path |
| `add_artist_to_archive` | `p_illustrator TEXT` | Add to Archive write path (A-D2a); creates/normalizes the `artists` identity row and inserts the `user_tracked_artists` row. UI wiring arrives with A-D2c |

`get_shared_collection` powers the public shared binder view. Do not modify
its signature or remove it. `add_artist_to_archive` is the single write path
for archive additions — no ad-hoc client inserts into `user_tracked_artists`.

## Deployment — current state

Production is served by Vercel from the `main` branch. Vercel builds
automatically on push to `main`.

`.github/workflows/build-check-gate2.yml` remains on `main` as a
`workflow_dispatch`-only build smoke test. It never triggers automatically,
does not deploy anything, and can be pointed at any branch via its input
parameter. Minor future hygiene, such as renaming this workflow, is outside
Gate 2 closure.

## Service worker

`public/sw.js` is the Vite app service worker. Service worker registration is
present in `index.html` (added in Phase 5G). Registered and validated in
production.

## Future direction

See ROADMAP.md for the authoritative sequencing. Architecture-relevant notes:

- Product Surface Map precedes new lens types (Set Lens, Pokémon Lens) so
  navigation is planned, not accreted.
- The long-term "collection goals" abstraction (Artist / Set / Pokémon /
  Custom List / Binder Plan as goal types) should be earned gradually; no
  schema generalization work yet.
- Component extraction of `src/App.jsx` and shared hooks remain deferred and
  require explicit approval.
- Freemium model / public collection pages remain deferred.

## Documentation debt

**This file is materially older than the system it describes.** The CAT-2D.2
closeout (2026-08-17) repaired only the ownership/identity architecture that was
actively wrong — it described `owned_keys` / `isCardOwned` as the authenticated
ownership authority, which has been false since OWN-0B. Nothing else was
modernised, deliberately, to keep that correction reviewable.

Known-stale and NOT repaired here, recorded as follow-up documentation debt:

- the module inventory and component-boundary sections predate OL-0A…OL-2B,
  OWN-0A/0B, BP-1A, BP-3.1A–C, Artist Page 3.0, CAT-1 and CAT-2D, and do not
  list their services or surfaces;
- the Supabase read model and backend RPC tables omit the import-snapshot,
  binder-layout and identity-resolution objects added since;
- the data-flow diagrams for surfaces other than collection/ownership have not
  been re-checked against current code.

Until a dedicated documentation slice addresses that, treat production behaviour
plus `CURRENT_STATE.md` and `DECISION_LOG.md` as authoritative wherever this
file disagrees — as `AGENTS.md` already requires.
