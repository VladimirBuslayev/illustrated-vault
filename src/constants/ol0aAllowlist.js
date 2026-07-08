// src/constants/ol0aAllowlist.js
// OL-0C — FROZEN Collectr→catalog set-name allowlist.
//
// Provenance: extracted verbatim from the APPROVED OL-0A2b simulation output
// (scripts/ol0a2-refinement-sim.mjs → ol0a2-report.json,
//  setMappingEvidence.allowlistCandidates). These 33 mappings are the only
// production-safe set-name aliases. They are scoped to the OL-0C snapshot
// importer ONLY — they are NOT a global alias system and MUST NOT touch
// user_collection.owned_keys recognition.
//
// Do NOT recompute at runtime. Do NOT add cross-language/-release or low-support
// mappings. The 7 deferred and 34 rejected labels are retained below purely so
// the load-time assertion can prove they are excluded.
//
// Each entry maps a raw Collectr `Set` label to a catalog `set_name`. Matching
// is performed on normSet(label) at classify time (see snapshotMatcher.js).

import { normSet } from '../utils/keys.js';

// ── 33 production-safe allowlist mappings (order = report distinct-pair rank) ──
export const OL0A_SET_ALLOWLIST = Object.freeze([
  { collectrLabel: 'Scarlet & Violet Base Set',                 catalogSet: 'Scarlet & Violet' },
  { collectrLabel: 'SV: 151',                                   catalogSet: '151' },
  { collectrLabel: 'Sun & Moon Base Set',                       catalogSet: 'Sun & Moon' },
  { collectrLabel: 'Pokemon Go',                                catalogSet: 'Pokémon GO' },
  { collectrLabel: 'Scarlet & Violet Promo',                    catalogSet: 'SVP Black Star Promos' },
  { collectrLabel: 'Generations: Radiant Collection',           catalogSet: 'Generations' },
  { collectrLabel: 'Shining Fates: Shiny Vault',                catalogSet: 'Shining Fates' },
  { collectrLabel: 'Sword & Shield Promo',                      catalogSet: 'SWSH Black Star Promos' },
  { collectrLabel: 'Crown Zenith: Galarian Gallery',            catalogSet: 'Crown Zenith' },
  { collectrLabel: 'Legendary Treasures: Radiant Collections',  catalogSet: 'Legendary Treasures' },
  { collectrLabel: 'Sun & Moon Promo',                          catalogSet: 'SM Black Star Promos' },
  { collectrLabel: 'XY Base Set',                               catalogSet: 'XY' },
  { collectrLabel: 'Base Set (Unlimited)',                      catalogSet: 'Base Set' },
  { collectrLabel: 'Platinum Arceus',                           catalogSet: 'Arceus' },
  { collectrLabel: 'EX Crystal Guardians',                      catalogSet: 'Crystal Guardians' },
  { collectrLabel: 'EX Delta Species',                          catalogSet: 'Delta Species' },
  { collectrLabel: 'XY Promos',                                 catalogSet: 'XY Black Star Promos' },
  { collectrLabel: 'EX Emerald',                                catalogSet: 'Emerald' },
  { collectrLabel: 'EX Legend Maker',                           catalogSet: 'Legend Maker' },
  { collectrLabel: 'EX Power Keepers',                          catalogSet: 'Power Keepers' },
  { collectrLabel: 'Expedition',                                catalogSet: 'Expedition Base Set' },
  { collectrLabel: 'EX Unseen Forces',                          catalogSet: 'Unseen Forces' },
  { collectrLabel: 'EX Hidden Legends',                         catalogSet: 'Hidden Legends' },
  { collectrLabel: 'EX Holon Phantoms',                         catalogSet: 'Holon Phantoms' },
  { collectrLabel: 'EX Team Rocket Returns',                    catalogSet: 'Team Rocket Returns' },
  { collectrLabel: 'EX FireRed & LeafGreen',                    catalogSet: 'FireRed & LeafGreen' },
  { collectrLabel: 'EX Deoxys',                                 catalogSet: 'Deoxys' },
  { collectrLabel: 'EX Sandstorm',                              catalogSet: 'Sandstorm' },
  { collectrLabel: 'Brilliant Stars Trainer Gallery',          catalogSet: 'Brilliant Stars' },
  { collectrLabel: 'EX Ruby & Sapphire',                        catalogSet: 'Ruby & Sapphire' },
  { collectrLabel: 'Diamond and Pearl Promos',                  catalogSet: 'DP Black Star Promos' },
  { collectrLabel: 'Lost Origin Trainer Gallery',               catalogSet: 'Lost Origin' },
  { collectrLabel: "McDonald's Promos 2022",                    catalogSet: "McDonald's Collection 2022" },
]);

// ── Excluded mappings (must NEVER appear in the allowlist) ─────────────────────
// Retained ONLY to power the exclusion assertion below. Not exported for use.
const OL0A_DEFERRED_LABELS = Object.freeze([
  'Ninja Spinner',
  'Inferno X',
  'Base Set (1st Edition & Shadowless)',
  'Black and White Promos',
  'Night Wanderer',
  'Silver Tempest Trainer Gallery',
  'WoTC Promo',
]);

const OL0A_REJECTED_LABELS = Object.freeze([
  'Sword & Shield Base Set', 'Mega Evolution Promos', 'Prize Pack Series One',
  'Trick or Trade BOOster Bundle 2023', 'Miscellaneous Cards & Products', 'EX Dragon Frontiers',
  'Trick or Trade BOOster Bundle 2024', 'Burger King Promos', 'EX Trainer Kit 1: Latias & Latios',
  'World Championship Decks', 'XY Trainer Kit: Latias & Latios', 'Deck Exclusives',
  'Celebrations: Classic Collection', 'Jumbo Cards', 'SM Trainer Kit: Lycanroc & Alolan Raichu',
  'XY Trainer Kit: Pikachu Libre & Suicune', 'Abyss Eye', 'Astral Radiance Trainer Gallery',
  'Brave Stars (Courage)', 'Cyber Judge', 'DP Trainer Kit: Manaphy & Lucario', 'EX Dragon',
  'EX Trainer Kit 2: Plusle & Minun', 'Fairy Rise', 'Hot Air Arena',
  "McDonald's 25th Anniversary Promos", 'Night Unison', 'Nihil Zero', 'Nintendo Promos',
  'Pokemon 151', 'Shining Synergy (Summon)', 'SV: ex Start Decks', 'Tag Team GX All Stars',
  'XY Trainer Kit: Sylveon & Noivern',
]);

export const OL0A_ALLOWLIST_META = Object.freeze({
  allowlistCount: OL0A_SET_ALLOWLIST.length,
  deferredCount: OL0A_DEFERRED_LABELS.length,
  rejectedCount: OL0A_REJECTED_LABELS.length,
  source: 'ol0a2-report.json (OL-0A2b, approved)',
});

// ── Load-time integrity assertion (deterministic; throws on any drift) ─────────
// 1. Exactly 33 entries.
// 2. No duplicate normalized keys.
// 3. Every deferred and rejected label is excluded from the allowlist.
(function assertAllowlistIntegrity() {
  if (OL0A_SET_ALLOWLIST.length !== 33) {
    throw new Error(`OL0A allowlist integrity: expected 33 entries, found ${OL0A_SET_ALLOWLIST.length}.`);
  }
  const keys = new Set();
  for (const e of OL0A_SET_ALLOWLIST) {
    if (!e.collectrLabel || !e.catalogSet) throw new Error('OL0A allowlist integrity: entry missing label/catalogSet.');
    const k = normSet(e.collectrLabel);
    if (keys.has(k)) throw new Error(`OL0A allowlist integrity: duplicate normalized key "${k}".`);
    keys.add(k);
  }
  for (const lbl of OL0A_DEFERRED_LABELS) {
    if (keys.has(normSet(lbl))) throw new Error(`OL0A allowlist integrity: DEFERRED label leaked into allowlist ("${lbl}").`);
  }
  for (const lbl of OL0A_REJECTED_LABELS) {
    if (keys.has(normSet(lbl))) throw new Error(`OL0A allowlist integrity: REJECTED label leaked into allowlist ("${lbl}").`);
  }
})();
