#!/usr/bin/env node
// scripts/cat2d2-build-family-a-evidence.mjs
// ─────────────────────────────────────────────────────────────────────────────
// CAT-2D.2 — Family A evidence generator (READ-ONLY upstream probe).
//
// Regenerates docs/cat-2d2-evidence/family-a-alias-set.csv and manifest.json
// from live TCGdex. Touches no database, reads no credentials, writes nothing
// outside docs/cat-2d2-evidence/.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT THIS FILE IS AND IS NOT
// ─────────────────────────────────────────────────────────────────────────────
// It is the provenance of the APPROVED ALLOWLIST — the survivor side of every
// Family A identity claim, each carrying its observed upstream status.
//
// It is NOT the alias set. An alias row is only created by
// docs/sql/cat-2d2-1-family-a-reconciliation.sql, and only when a row that this
// artifact describes is also PROVEN against `public.cards` at deploy time. This
// artifact cannot, on its own, cause any row to be written.
//
// The distinction is the whole point of CAT-2D §7.1: the alias table is an
// allowlist of individually approved, evidence-backed claims — never a matcher,
// never derived at runtime.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE ADMISSION RULE FOR FAMILY A — AND WHY IT IS NOT TIER-1 EQUALITY
// ─────────────────────────────────────────────────────────────────────────────
// CAT-2D §3.4 rule 1 requires equal Tier-1 identity
// (normName, normSet(set_name), normNum(local_id)) between alias and canonical.
//
// FAMILY A CANNOT SATISFY THAT RULE, and it is important that this is stated
// rather than quietly worked around:
//
//   sync-cards.mjs :: mapCardToRow writes `set_name: card.set?.name`, i.e. the
//   name of the set the provider served the card under. The obsolete rows were
//   ingested while these printings sat in the PARENT set, so they carry
//     'Shining Fates' / 'Crown Zenith'
//   while their survivors carry
//     'Shining Fates Shiny Vault' / 'Crown Zenith Galarian Gallery'.
//   normSet of those pairs differs, so the Tier-1 keys differ BY CONSTRUCTION.
//
// That is also precisely why Family A produces no Tier-1 collision in the
// effective catalog today, and why the CAT-2B1 guard has never refused these
// sets — the defect here is a duplicated PRINTING, not a duplicated identity
// key. Trainer Galleries (Family B) are the opposite case: their subset
// generation kept the subset set_name, so Tier-1 equality does hold there.
//
// Family A therefore substitutes, for the set component only, an explicitly
// enumerated and separately evidenced SET-RENAME PAIR, and keeps the other two
// components strictly:
//
//   A1  the pairing is inside an approved (parent_set_id -> canonical_set_id)
//       pair listed in FAMILIES below — never inferred, never wildcarded;
//   A2  normNum(local_id) equal, exactly — normNum does not strip leading
//       zeros, so 'SV1' and 'SV001' are different printings and must not pair;
//   A3  normName(name) equal, exactly, asserted against the STORED rows at
//       deploy time, not against this file;
//   A4  the parent set no longer serves ANY card in the family's local-id
//       namespace (asserted below, per family — this is the evidence that the
//       namespace moved rather than that one card vanished);
//   A5  the obsolete id 404s upstream and the canonical id 200s, both observed
//       and dated (probed below, per pair).
//
// A1+A2+A3 alone would still be a same-name-same-number coincidence argument.
// A4 is what makes it a rename: the entire numbered range left the parent set
// together, and reappeared, intact and complete, under the new set id.
//
// No cross-language, cross-printing, artwork-level or name-only equivalence is
// admitted by any of this.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY CELEBRATIONS IS NOT HERE — production evidence, not an oversight
// ─────────────────────────────────────────────────────────────────────────────
// An earlier revision of this slice included a third family,
// cel25-CC### -> cel25cc-CC###, derived from the SURVIVOR side and assumed to
// have a matching obsolete id. Production Phase A refused it, correctly:
//
//   derived Family A map holds 192 pairs, expected 217
//   — {"swsh4.5":122,"swsh12.5":70}
//
// A read-only query over public.cards WHERE set_id = 'cel25' showed why. The 25
// historical Classic Collection rows are NOT stored as cel25-CC001..CC025. They
// carry LEGACY local ids — the numbers from the original printings they
// reproduce — e.g.
//
//   cel25-2A    Blastoise        cel25-17A   Umbreon Star
//   cel25-4A    Charizard        cel25-88A   Mew ex
//   cel25-15A1  Venusaur         cel25-60A   Tapu Lele GX
//
// So Celebrations is not a set-id rename with a stable number: the provider
// changed the SET and the NUMBERING. It cannot satisfy A2 (normNum equality) at
// all, and no admission rule here should be widened to let it in — name
// equality plus a changed number is exactly the fuzzy matching CAT-2D forbids.
//
// Celebrations is therefore split out as its own evidence class:
//   docs/CAT-2D.3_CELEBRATIONS_IDENTITY_REMAP.md   (design only, not implemented)
//
// CAT-2D.2 is now, exactly, the SET-RENAME-WITH-STABLE-LOCAL-ID slice.
//
// Run: node scripts/cat2d2-build-family-a-evidence.mjs
//      node scripts/cat2d2-build-family-a-evidence.mjs --check   (verify only)
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normName, normNum } from '../src/utils/keys.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', 'docs', 'cat-2d2-evidence');
const CSV_PATH = join(OUT_DIR, 'family-a-alias-set.csv');
const MANIFEST_PATH = join(OUT_DIR, 'manifest.json');

const API = 'https://api.tcgdex.net/v2/en';

// ── The approved set-rename pairs (A1) ──────────────────────────────────────
// `localIdPattern` is anchored and family-specific on purpose. It is the only
// thing that separates an obsolete subset row from an ordinary parent-set row
// inside the same `set_id`, and the migration uses the SAME anchored patterns
// against `public.cards`. A loose pattern here would silently widen the slice.
const FAMILIES = [
  {
    family: 'shining_fates_sv',
    parentSetId: 'swsh4.5',
    canonicalSetId: 'swsh4.5sv',
    localIdPattern: /^SV\d{3}$/,
    expectedCount: 122,
  },
  {
    family: 'crown_zenith_gg',
    parentSetId: 'swsh12.5',
    canonicalSetId: 'swsh12.5gg',
    localIdPattern: /^GG\d{2}$/,
    expectedCount: 70,
  },
  // NO celebrations_cc — see "WHY CELEBRATIONS IS NOT HERE" in the header.
  // Its historical rows carry legacy local ids (cel25-2A, cel25-15A1, ...), so
  // the transition changed the numbering as well as the set and cannot be
  // admitted under A2. It is CAT-2D.3, a separate evidence class.
];

/** The approved total. Asserted, so a family cannot be added by accident. */
const EXPECTED_TOTAL = 192;

const CSV_COLUMNS = [
  'family',
  'alias_card_id',
  'canonical_card_id',
  'name',
  'local_id',
  'alias_set_id',
  'alias_set_name',
  'canonical_set_id',
  'canonical_set_name',
  'alias_upstream_status',
  'canonical_upstream_status',
];

const CONCURRENCY = 6;
const RETRIES = 3;

async function getJson(path) {
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetch(`${API}${path}`, { headers: { accept: 'application/json' } });
      if (res.status === 404) return { status: 404, body: null };
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { status: res.status, body: await res.json() };
    } catch (err) {
      if (attempt === RETRIES) throw new Error(`GET ${path} failed after ${RETRIES} attempts: ${err.message}`);
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }
  throw new Error('unreachable');
}

/** HEAD-equivalent status probe. TCGdex answers 404 for an id it no longer serves. */
async function probeStatus(cardId) {
  const { status } = await getJson(`/cards/${encodeURIComponent(cardId)}`);
  return status;
}

async function mapLimited(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i], i);
      }
    })
  );
  return out;
}

function csvCell(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const row of rows) lines.push(CSV_COLUMNS.map((c) => csvCell(row[c])).join(','));
  return `${lines.join('\n')}\n`;
}

// Hash NEWLINE-NORMALISED content, never raw bytes. git's core.autocrlf
// rewrites line endings on checkout for text files, so a byte hash would make
// the committed checksum machine-dependent — and the migration stamps this
// hash into every alias row's evidence. The hash must attest to the CONTENT of
// the approved artifact on every machine that clones the repo.
const lf = (text) => text.split('\r\n').join('\n');
const sha256 = (text) => createHash('sha256').update(lf(text), 'utf8').digest('hex');

async function build() {
  const observedAt = new Date().toISOString();
  const rows = [];
  const perFamily = [];

  for (const fam of FAMILIES) {
    const parent = await getJson(`/sets/${fam.parentSetId}`);
    const canonical = await getJson(`/sets/${fam.canonicalSetId}`);
    if (parent.status !== 200 || !parent.body) throw new Error(`parent set ${fam.parentSetId} not served upstream`);
    if (canonical.status !== 200 || !canonical.body) throw new Error(`canonical set ${fam.canonicalSetId} not served upstream`);

    const parentCards = parent.body.cards ?? [];
    const canonicalCards = canonical.body.cards ?? [];

    // A4 — the namespace must be GONE from the parent set. A single straggler
    // means this is not a clean whole-namespace rename and the family must not
    // be reconciled by pattern at all.
    const stragglers = parentCards.filter((c) => fam.localIdPattern.test(String(c.localId ?? '')));
    if (stragglers.length > 0) {
      throw new Error(
        `A4 FAILED for ${fam.family}: parent set ${fam.parentSetId} still serves ` +
          `${stragglers.length} card(s) in the ${fam.localIdPattern} namespace ` +
          `(e.g. ${stragglers[0].id}) — the namespace did not move cleanly`
      );
    }

    const members = canonicalCards.filter((c) => fam.localIdPattern.test(String(c.localId ?? '')));
    if (members.length !== canonicalCards.length) {
      throw new Error(
        `${fam.family}: canonical set ${fam.canonicalSetId} contains ` +
          `${canonicalCards.length - members.length} card(s) outside the ${fam.localIdPattern} namespace`
      );
    }
    if (members.length !== fam.expectedCount) {
      throw new Error(
        `${fam.family}: expected ${fam.expectedCount} canonical members, upstream serves ${members.length}`
      );
    }

    const probed = await mapLimited(members, CONCURRENCY, async (card) => {
      const localId = String(card.localId);
      const aliasCardId = `${fam.parentSetId}-${localId}`;
      const [aliasStatus, canonicalStatus] = await Promise.all([
        probeStatus(aliasCardId),
        probeStatus(card.id),
      ]);
      return {
        family: fam.family,
        alias_card_id: aliasCardId,
        canonical_card_id: card.id,
        name: card.name,
        local_id: localId,
        alias_set_id: fam.parentSetId,
        alias_set_name: parent.body.name,
        canonical_set_id: fam.canonicalSetId,
        canonical_set_name: canonical.body.name,
        alias_upstream_status: aliasStatus,
        canonical_upstream_status: canonicalStatus,
      };
    });

    // A5 — per pair, asserted rather than merely recorded.
    for (const r of probed) {
      if (r.alias_upstream_status !== 404) {
        throw new Error(`A5 FAILED: ${r.alias_card_id} returned ${r.alias_upstream_status}, expected 404`);
      }
      if (r.canonical_upstream_status !== 200) {
        throw new Error(`A5 FAILED: ${r.canonical_card_id} returned ${r.canonical_upstream_status}, expected 200`);
      }
      // A2 — the derived alias id and the survivor must share an identical
      // normalised number. This is trivially true by construction here; it is
      // asserted anyway so a future edit to the id-derivation cannot slip past.
      if (normNum(r.local_id) !== normNum(r.canonical_card_id.slice(r.canonical_set_id.length + 1))) {
        throw new Error(`A2 FAILED: ${r.alias_card_id} / ${r.canonical_card_id} local-id mismatch`);
      }
      if (!normName(r.name)) {
        throw new Error(`A3 FAILED: ${r.canonical_card_id} has no constructible normalised name`);
      }
    }

    probed.sort((a, b) => a.local_id.localeCompare(b.local_id));
    rows.push(...probed);
    perFamily.push({
      family: fam.family,
      parent_set_id: fam.parentSetId,
      canonical_set_id: fam.canonicalSetId,
      local_id_pattern: fam.localIdPattern.source,
      alias_count: probed.length,
    });
  }

  // The approved total, asserted. A family added without re-approving the
  // slice total is exactly the kind of silent widening this file must refuse.
  if (rows.length !== EXPECTED_TOTAL) {
    throw new Error(`expected ${EXPECTED_TOTAL} pairs across ${FAMILIES.length} families, built ${rows.length}`);
  }

  // Structural invariants (INV-9 / INV-8 mirrors, on the artifact itself).
  const aliasIds = rows.map((r) => r.alias_card_id);
  const canonicalIds = rows.map((r) => r.canonical_card_id);
  if (new Set(aliasIds).size !== aliasIds.length) throw new Error('duplicate alias_card_id in artifact');
  if (new Set(canonicalIds).size !== canonicalIds.length) throw new Error('duplicate canonical_card_id in artifact (Family A is 1:1)');
  for (const r of rows) {
    if (r.alias_card_id === r.canonical_card_id) throw new Error(`self-alias in artifact: ${r.alias_card_id}`);
  }
  const canonicalSet = new Set(canonicalIds);
  for (const id of aliasIds) {
    if (canonicalSet.has(id)) throw new Error(`chain in artifact: ${id} is both an alias and a survivor`);
  }

  const csv = toCsv(rows);
  const manifest = {
    slice: 'CAT-2D.2',
    artifact: 'family-a-alias-set.csv',
    generated_by: 'scripts/cat2d2-build-family-a-evidence.mjs',
    source: 'TCGdex v2 (en) — read-only',
    observed_at: observedAt,
    proof: 'upstream_set_rename',
    scope: 'set rename with STABLE local_id only',
    admission_rules: ['A1 approved set-rename pair', 'A2 normNum equal', 'A3 normName equal (asserted at deploy)', 'A4 namespace absent from parent set', 'A5 alias 404 / canonical 200'],
    tier1_identity_equal: false,
    tier1_note:
      'Alias and canonical rows carry different set_name, so their Tier-1 identity keys differ by construction. See the header of the generator for why, and why A4 replaces the set component.',
    excluded: [
      {
        family: 'celebrations_cc',
        parent_set_id: 'cel25',
        canonical_set_id: 'cel25cc',
        reason:
          'The 25 historical Classic Collection rows are stored with LEGACY local ids (cel25-2A, cel25-4A, cel25-15A1, cel25-17A, cel25-60A, cel25-88A, ...), not cel25-CC###. The provider changed the numbering as well as the set, so the pairing cannot satisfy A2 (normNum equality). Split out as CAT-2D.3 — see docs/CAT-2D.3_CELEBRATIONS_IDENTITY_REMAP.md. Do not re-add without a separate, individually corroborated evidence class.',
        observed_by: 'production Phase A refusal + read-only query over public.cards where set_id = cel25',
      },
    ],
    total_aliases: rows.length,
    families: perFamily,
    csv_sha256: sha256(csv),
  };
  return { rows, csv, manifest };
}

const checkOnly = process.argv.includes('--check');

const { rows, csv, manifest } = await build();

if (checkOnly) {
  const existing = await readFile(CSV_PATH, 'utf8');
  if (lf(existing) !== csv) {
    console.error('FAIL: committed family-a-alias-set.csv does not match a fresh upstream probe');
    process.exit(1);
  }
  console.log(`ok — committed artifact matches upstream (${rows.length} pairs)`);
} else {
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(CSV_PATH, csv, 'utf8');
  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`wrote ${rows.length} pairs`);
  for (const f of manifest.families) console.log(`  ${f.family.padEnd(20)} ${String(f.alias_count).padStart(4)}  ${f.parent_set_id} -> ${f.canonical_set_id}`);
  console.log(`  csv_sha256 ${manifest.csv_sha256}`);
}
