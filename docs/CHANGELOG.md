Illustrated — Changelog
v0.1.1 — Gate 1 stabilization patch
Date: 2026-06-23
Merged: yes (PR merged to `stabilization/gate-1`)
Changes:
Clear Cache — cancel behavior fixed
The "Clear card cache" button in Settings previously called `onClose()` unconditionally, closing the Settings panel even when the user clicked Cancel on the confirm dialog. This has been fixed. Cancel now leaves the Settings panel open.
Clear Cache — confirm copy corrected
The confirm dialog previously read "Will re-fetch from Supabase on next load." This was inaccurate: `clearCache` triggers an immediate re-fetch via `loadAllEntries()`. The copy now reads "Cards will be re-fetched from Supabase immediately."
`supaRowToCard` — `release_date` now mapped
`release_date` was already selected from Supabase and used as the primary `ORDER BY` on the `fetchArtistCards` query, but was not mapped to the returned card object. It is now mapped as `releaseDate: row.release_date || null`. The UI's visual date sort continues to use `SET_ORDER`, so no display behavior changes. The field is available on the card object for future use.
Clear Cache — `pb_fallback_img_*` keys now purged
`clearCache` previously purged `pb6_cards_*` (old TCGdex cache) and `pb7_supa_*` (current Supabase cache) keys, but did not touch `pb_fallback_img_${cardId}` keys. These keys cache pokemontcg.io fallback image lookups — including permanent `false` values for cards where no image was found. `clearCache` now also purges all keys matching the `pb_fallback_img_` prefix, so stale "not found" results do not persist after TCGdex gains images for previously imageless cards.
Stale comment corrected in `loadAllEntries`
A comment describing the `ARTIST_CONCURRENCY=4` chunked loading strategy referred to "simultaneous requests to TCGdex and risks silent throttling." Artist entries no longer hit TCGdex live — they query Supabase. The comment now reads "simultaneous Supabase queries and risks connection pool pressure."
Known open items not addressed by this patch:
Pricing is intentionally stubbed (`pricing: null`) in `supaRowToCard`. No Supabase pricing column exists yet. TCGPlayer and Cardmarket display, price-based sorting, and price history recording remain inactive for all Supabase-backed artist cards. This will be addressed when a pricing column or pricing table is added to Supabase.
`cmUrl` (Cardmarket link) is computed in the modal but not rendered. This dead variable will become meaningful once pricing data is available.
Artist alias coverage for Saya Tsuruta (full-width space variant) and Masakazu Fukuda (typo variant) not yet confirmed against live Supabase data.
---
v0.1 — Initial single-file MVP
Date: 2026-06-23
State:
GitHub Pages deployment works
Custom domain works
App is still primarily contained in `index.html`
Service worker exists in `sw.js`
Sync/backfill scripts exist in `sync/`
Supabase is being introduced as runtime card source
TCGdex remains a source/sync provider
Known working areas to preserve:
artist browsing
card modal
CSV import
owned/missing state
manual overrides
bookmarks/favorites
share/binder view
eBay sold links
pricing display where available
image fallback behavior
Known risk:
The app is becoming too large and fragile as a single-file MVP.
Next planned step:
Gate 1 stabilization audit.
