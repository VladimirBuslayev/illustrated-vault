// scripts/attr0-variant-attribution-probe.mjs
// ═══════════════════════════════════════════════════════════════════════════
// ATTR-0 — suffix-variant artist-attribution probe (READ ONLY)
//
// WHAT THIS DOES
//   Enumerates the whole TCGdex English catalog and finds every card whose
//   local_id is a SUFFIX VARIANT — a local id ending in a lowercase letter
//   immediately after a digit (`67a`, `98b`, `XY150a`). For each one it records
//   whether the base printing (`67`, `98`, `XY150`) exists in the same set, and
//   compares the upstream illustrator and the upstream artwork bytes of the two.
//
// WHAT THIS DOES NOT DO
//   * It does not touch Supabase. It reads no production data and writes none.
//   * It does not decide whether an attribution is WRONG. Byte-difference
//     between two images proves the FILES differ — a stamped reprint of the
//     same artwork also differs — so it is a risk signal, never a verdict.
//   * It does not identify who actually drew anything. That requires external
//     artwork-level verification, which is deliberately out of scope.
//
// WHY UPSTREAM AND NOT public.cards
//   sync-cards.mjs :: mapCardToRow writes `illustrator: card.illustrator ?? null`
//   verbatim, per card, with no cross-printing inheritance. Upstream is
//   therefore a faithful proxy for what production stores. It is a PROXY, not
//   the authority: docs/sql/attr-0-artist-attribution-audit.sql re-derives the
//   same population against production and is the figure of record.
//
// USAGE
//   node scripts/attr0-variant-attribution-probe.mjs            # write CSVs
//   node scripts/attr0-variant-attribution-probe.mjs --check    # verify only
// ═══════════════════════════════════════════════════════════════════════════

import { createHash } from 'node:crypto';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const API = 'https://api.tcgdex.net/v2/en';
const OUT_DIR = 'docs/attr-0-evidence';
const CHECK = process.argv.includes('--check');

// A suffix variant: any number of characters ending in a DIGIT, followed by a
// single lowercase letter. Anchored so `SV001` / `GG19` / `TG01` never match —
// those end in digits and are set-namespace ids, not print variants.
const SUFFIX_RE = /^(.*[0-9])([a-z])$/;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.json();
    } catch (err) {
      if (i === tries - 1) throw err;
      await sleep(400 * (i + 1));
    }
  }
}

// Hash of the high-quality artwork bytes. Null when the card carries no image.
async function imageHash(card) {
  if (!card?.image) return null;
  try {
    const res = await fetch(`${card.image}/high.webp`);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return createHash('sha256').update(buf).digest('hex');
  } catch {
    return null;
  }
}

const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvRow = (cells) => cells.map(csvCell).join(',');

async function main() {
  console.log('ATTR-0 variant attribution probe — READ ONLY, upstream only\n');

  const sets = await getJson(`${API}/sets`);
  console.log(`sets enumerated: ${sets.length}`);

  // ── Pass 1: find every suffix variant from set briefs (cheap: 1 req/set) ──
  const families = [];   // { setId, base, variant, name }
  const lone = [];       // { setId, variant, name }

  for (const s of sets) {
    const detail = await getJson(`${API}/sets/${s.id}`);
    const cards = detail?.cards ?? [];
    const present = new Set(cards.map((c) => c.localId));
    for (const c of cards) {
      const m = SUFFIX_RE.exec(c.localId ?? '');
      if (!m) continue;
      if (present.has(m[1])) {
        families.push({ setId: s.id, base: m[1], variant: c.localId, name: c.name });
      } else {
        lone.push({ setId: s.id, variant: c.localId, name: c.name });
      }
    }
  }

  console.log(`suffix variants with a base printing in the same set: ${families.length}`);
  console.log(`suffix variants with NO base printing in the same set: ${lone.length}\n`);

  // ── Pass 2: detail + artwork comparison for family members only ──────────
  const cache = new Map();
  const getCard = async (id) => {
    if (!cache.has(id)) cache.set(id, await getJson(`${API}/cards/${id}`));
    return cache.get(id);
  };

  const rows = [];
  for (const f of families) {
    const baseId = `${f.setId}-${f.base}`;
    const varId = `${f.setId}-${f.variant}`;
    const b = await getCard(baseId);
    const v = await getCard(varId);
    const [bh, vh] = await Promise.all([imageHash(b), imageHash(v)]);

    const illMatch =
      b?.illustrator == null && v?.illustrator == null
        ? 'BOTH_NULL'
        : b?.illustrator === v?.illustrator
          ? 'SAME'
          : 'DIFFERENT';

    const artwork = bh && vh ? (bh === vh ? 'IDENTICAL_BYTES' : 'DIFFERENT_BYTES') : 'UNKNOWN';

    // The risk class: upstream asserts ONE illustrator across two printings
    // whose artwork files are not identical. Not a verdict — a candidate.
    const risk =
      illMatch === 'SAME' && artwork === 'DIFFERENT_BYTES'
        ? 'SUSPECT'
        : illMatch === 'DIFFERENT'
          ? 'DISTINCT_ATTRIBUTION'
          : 'REVIEW';

    rows.push({
      set_id: f.setId,
      family: f.base,
      base_card_id: baseId,
      variant_card_id: varId,
      name: b?.name ?? f.name,
      base_illustrator: b?.illustrator ?? null,
      variant_illustrator: v?.illustrator ?? null,
      illustrator_match: illMatch,
      base_image_sha256: bh,
      variant_image_sha256: vh,
      artwork_bytes: artwork,
      risk_class: risk,
    });
  }

  const suspect = rows.filter((r) => r.risk_class === 'SUSPECT').length;
  const distinct = rows.filter((r) => r.risk_class === 'DISTINCT_ATTRIBUTION').length;
  console.log(`SUSPECT (one illustrator across non-identical artwork files): ${suspect}`);
  console.log(`DISTINCT_ATTRIBUTION (upstream already differentiates):      ${distinct}`);
  console.log(`REVIEW (null/unknown):                                       ${rows.length - suspect - distinct}\n`);

  // ── Emit ─────────────────────────────────────────────────────────────────
  const famHeader = [
    'set_id', 'family', 'base_card_id', 'variant_card_id', 'name',
    'base_illustrator', 'variant_illustrator', 'illustrator_match',
    'base_image_sha256', 'variant_image_sha256', 'artwork_bytes', 'risk_class',
  ];
  const famCsv =
    csvRow(famHeader) + '\n' +
    rows
      .sort((a, b) => a.variant_card_id.localeCompare(b.variant_card_id))
      .map((r) => csvRow(famHeader.map((h) => r[h])))
      .join('\n') + '\n';

  const loneHeader = ['set_id', 'variant_card_id', 'local_id', 'name'];
  const loneCsv =
    csvRow(loneHeader) + '\n' +
    lone
      .sort((a, b) => `${a.setId}-${a.variant}`.localeCompare(`${b.setId}-${b.variant}`))
      .map((l) => csvRow([l.setId, `${l.setId}-${l.variant}`, l.variant, l.name]))
      .join('\n') + '\n';

  const sha = (s) => createHash('sha256').update(s.replace(/\r\n/g, '\n')).digest('hex');

  const manifest = {
    slice: 'ATTR-0',
    generated_by: 'scripts/attr0-variant-attribution-probe.mjs',
    source: 'TCGdex v2 (en) — read-only',
    observed_at: new Date().toISOString(),
    scope: 'suffix-variant printings only (local_id = <digits><lowercase letter>)',
    production_reads: 'none — this probe never contacts Supabase',
    sets_enumerated: sets.length,
    variant_families_with_base: families.length,
    lone_suffix_variants: lone.length,
    suspect_families: suspect,
    distinct_attribution_families: distinct,
    interpretation_limit:
      'DIFFERENT_BYTES proves the image FILES differ. It does NOT prove the ARTWORK differs — a stamped or re-encoded reprint also differs. No row here is a confirmed wrong attribution.',
    artifacts: {
      'variant-family-attribution.csv': sha(famCsv),
      'lone-suffix-variants.csv': sha(loneCsv),
    },
  };

  if (CHECK) {
    const prior = JSON.parse(readFileSync(join(OUT_DIR, 'manifest.json'), 'utf8'));
    const same =
      prior.artifacts['variant-family-attribution.csv'] === manifest.artifacts['variant-family-attribution.csv'] &&
      prior.artifacts['lone-suffix-variants.csv'] === manifest.artifacts['lone-suffix-variants.csv'];
    console.log(same ? 'ok — committed artifacts match upstream' : 'DRIFT — committed artifacts differ from upstream');
    process.exit(same ? 0 : 1);
  }

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'variant-family-attribution.csv'), famCsv);
  writeFileSync(join(OUT_DIR, 'lone-suffix-variants.csv'), loneCsv);
  writeFileSync(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`wrote ${OUT_DIR}/variant-family-attribution.csv`);
  console.log(`wrote ${OUT_DIR}/lone-suffix-variants.csv`);
  console.log(`wrote ${OUT_DIR}/manifest.json`);
}

main().catch((err) => {
  console.error('probe failed:', err);
  process.exit(1);
});
