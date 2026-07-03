# Illustrated Vault — Architecture

Last updated: 2026-07-02

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
| `keys.js` | `normName`, `normNum`, `normSet`, `makeKeys`, `isCardOwned` | Ownership key builders; `makeKeys` output is persisted in Supabase; do not alter |
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
| `artistService.js` | `fetchTrackedArtistIds`, `fetchArtistIdentities`, `searchIllustratorDirectory`, `addArtistToArchive` | `user_tracked_artists` / `artists` reads for the dynamic roster (soft-fail to empty; curated ARTISTS remain the safety floor); `illustrator_directory` search and `add_artist_to_archive` RPC write path for A-D2c-lite Find Illustrator / Add to Archive; no caching |

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

```
App.useEffect (after auth) → loadUserData(userId)    [collectionService.js]
  → supabase.from('user_collection').select('owned_keys')
  → supabase.from('card_overrides').select(...)
  → supabase.from('price_history').select(...)
  → supabase.from('card_favorites').select(...)
  → returns { ownedKeys, manualOwned, manualMissing, priceHistory, favorites }

checkOwned(card) → isCardOwned(card, ownedKeySet, manualOwned, manualMissing)
  → makeKeys(name, localId, setName).some(k => ownedKeySet.has(k))
```

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
RLS `user_id = auth.uid()`. Editorial enrichment lives in `card_extras`,
merged into `cards_effective`; the normalized `artists` table (with alias
arrays) backs FK artist identity and is formalized as global artist identity
(20 rows today). `illustrator_directory` is the read-only discovery view
(illustrator + card count) backing the future Find Illustrator flow.

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
