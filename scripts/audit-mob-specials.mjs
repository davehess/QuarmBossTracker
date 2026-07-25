#!/usr/bin/env node
/*
 * audit-mob-specials.mjs — DB-vs-PQDI mob-info audit (#173)
 * ---------------------------------------------------------------------------
 * Compares what OUR catalog (eqemu_npc_types) says about each raid boss against
 * what pqdi.cc displays, across the dimensions raiders actually care about:
 *   see-invis · pacify · rooted-in-place · flees-when-low · enrage · rampage
 *   · summon · unslowable · unsnareable(movement-immune)
 *
 * WHY THIS RUNS LOCALLY: the cloud agent proxy is 403-blocked by pqdi.cc, so the
 * PQDI side cannot be scraped from the Claude Code web environment. Run it on a
 * machine that can reach pqdi.cc (Hitya's box).
 *
 * USAGE:
 *   SUPABASE_URL=... SUPABASE_KEY=... node scripts/audit-mob-specials.mjs
 *     (SUPABASE_KEY falls back to SUPABASE_SERVICE_ROLE_KEY or
 *      NEXT_PUBLIC_SUPABASE_ANON_KEY — eqemu_* is anon-readable, so the anon
 *      key is enough.)
 *
 *   --dump <id>   Fetch ONE pqdi npc page, write its HTML to
 *                 pqdi-dump-<id>.html, and print the plain-text flag block.
 *                 Use this ONCE to calibrate the PQDI phrase matchers below if
 *                 the site's markup has drifted since this was written.
 *   --limit N     Only audit the first N bosses (smoke test).
 *   --delay MS    Politeness delay between pqdi fetches (default 1500).
 *   --out FILE    Report path (default audit-mob-specials-report.md).
 *
 * OUTPUT: a Markdown report with one row per mismatch, plus a "codes we drop"
 * section listing special-ability codes present in the catalog that our decoder
 * (index.js _decodeMobSpecials) does not label.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');

// ---- args ------------------------------------------------------------------
const argv = process.argv.slice(2);
const getArg = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : def;
};
const DUMP_ID = getArg('--dump', null);
const LIMIT = parseInt(getArg('--limit', '0'), 10) || 0;
const DELAY = parseInt(getArg('--delay', '1500'), 10);
const OUT = getArg('--out', path.join(REPO, 'audit-mob-specials-report.md'));

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://zhtoekwakucbckvatfky.supabase.co';
const SUPABASE_KEY =
  process.env.SUPABASE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  '';

// ---- eqemu special_abilities code map (EQEmu SpecialAbility enum) -----------
// label:  human name  ·  show: true if it should surface in Mob Info
// The audit flags any `show:true` code present in the catalog that our current
// decoder omits. Codes marked VERIFY are internal combat-tuning knobs whose
// PQDI rendering is unconfirmed — the audit's job is to settle them.
const CODE = {
  1:  { label: 'Summon',                    show: true  },
  2:  { label: 'Enrage',                    show: true  },
  3:  { label: 'Rampage',                   show: true  },
  4:  { label: 'Area Rampage',              show: true  },
  5:  { label: 'Flurry',                    show: true  },
  6:  { label: 'Triple Attack',             show: true  },
  7:  { label: 'Quad Attack',               show: true  },
  8:  { label: 'Dual Wield',                show: false },
  9:  { label: 'Bane',                      show: true  },
  10: { label: 'Magical',                   show: true  },
  11: { label: 'Ranged',                    show: true  },
  12: { label: 'Unslowable',                show: true  },
  13: { label: 'Unmezzable',                show: true  },
  14: { label: 'Uncharmable',               show: true  },
  15: { label: 'Unstunnable',               show: true  },
  16: { label: 'Unsnareable',               show: true  },  // immune to movement-speed debuffs
  17: { label: 'Unfearable',                show: true  },
  18: { label: 'Undispellable',             show: true  },
  19: { label: 'Immune Melee',              show: true  },
  20: { label: 'Immune Magic',              show: true  },
  21: { label: 'Immune Fleeing',            show: true  },  // does NOT flee at low HP
  22: { label: 'Immune Melee Except Bane',  show: true  },
  23: { label: 'Immune Non-Magical',        show: true  },  // needs a magic weapon
  24: { label: 'Will Not Aggro',            show: true  },
  25: { label: 'Immune Aggro On',           show: false },
  26: { label: 'Immune Ranged Spells',      show: true  },
  27: { label: 'Immune Feign Death',        show: true  },
  28: { label: 'Immune Taunt',              show: true  },
  29: { label: 'Tunnel Vision',             show: false },
  30: { label: 'No Buff/Heal Friends',      show: false },
  31: { label: 'Immune Pacify',             show: true  },
  32: { label: 'Leash',                     show: false }, // resets if pulled too far
  33: { label: 'Tether',                    show: false },
  34: { label: 'Destructible Object',       show: false },
  35: { label: 'No Harm From Client',       show: false },
  36: { label: 'Always Flee',               show: true  },
  37: { label: 'Flee At Percent',           show: true  },  // "runs when low"
  38: { label: 'Allow Beneficial',          show: false },
  39: { label: 'Disable Melee',             show: true  },
  40: { label: 'Chase Distance',            show: false },
  41: { label: 'Casting Resist Diff',       show: false },
  42: { label: 'Counter Avoid Damage',      show: false }, // VERIFY: tuning knob, PQDI likely hides
  43: { label: 'Prox Aggro',                show: false }, // VERIFY
  44: { label: 'Immune Ranged Attacks',     show: true  },
  45: { label: 'Immune Damage (Client)',    show: false },
  46: { label: 'Immune Damage (NPC/Pet)',   show: true  },  // matters for charm/pet strats
  47: { label: 'Immune Aggro (Client)',     show: false },
  48: { label: 'Immune Aggro (NPC)',        show: false },
  49: { label: 'Modify Avoid Damage',       show: false }, // VERIFY: tuning knob
};

// Codes our production decoder (index.js _MOB_SPECIAL_LABELS) currently labels.
// Keep in sync with index.js — the audit reports codes it drops.
const DECODED_BY_BOT = new Set([
  1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 23, 27, 28, 31,
]);

function parseSpecials(str) {
  // returns Map<code, params[]>
  const out = new Map();
  if (!str) return out;
  for (const part of String(str).split('^')) {
    const bits = part.split(',').map((s) => s.trim());
    const code = parseInt(bits[0], 10);
    if (!Number.isFinite(code)) continue;
    // bits[1] === '0' means the ability is present-but-disabled in the row
    if (bits[1] != null && bits[1] === '0') continue;
    out.set(code, bits.slice(1));
  }
  return out;
}

// Reduce a DB row to the audited boolean dimensions.
function dbDimensions(row) {
  const sp = parseSpecials(row.special_abilities);
  const has = (c) => sp.has(c);
  const rs = Number(row.runspeed);
  return {
    seeInvis: !!row.see_invis || !!row.see_invis_undead,
    summon: has(1),
    enrage: has(2),
    rampage: has(3) || has(4),
    unslowable: has(12),
    unsnareable: has(16), // movement-speed-change immunity
    immunePacify: has(31),
    immuneFleeing: has(21), // does not flee
    fleePercent: has(37) ? (sp.get(37)[0] || '?') : null,
    rooted: Number.isFinite(rs) && rs === 0, // stationary
    runspeed: Number.isFinite(rs) ? rs : null,
    codes: [...sp.keys()].sort((a, b) => a - b),
  };
}

// ---- PQDI phrase matchers --------------------------------------------------
// pqdi.cc renders a "Special Abilities" area as plain words. We detect by
// case-insensitive phrase. If the site markup drifts, run `--dump <id>` and
// adjust these. Each entry: dimension -> array of regexes that mean "true".
const PQDI_TRUE = {
  seeInvis:      [/see\s+invis/i, /sees?\s+invisible/i],
  summon:        [/\bsummon/i],
  enrage:        [/\benrage/i],
  rampage:       [/\brampage/i],
  unslowable:    [/immune\s+to\s+slow/i, /unslow/i, /cannot\s+be\s+slowed/i],
  unsnareable:   [/immune\s+to\s+snare/i, /unsnare/i, /cannot\s+be\s+snared/i,
                  /immune\s+to\s+root/i, /unroot/i],
  immunePacify:  [/immune\s+to\s+pacif/i, /cannot\s+be\s+pacif/i, /unpacif/i],
  // PQDI usually phrases flee as an affirmative "flees"/"runs"; absence +
  // "immune to fleeing" phrasing means it stands its ground.
  flees:         [/\bflees?\b/i, /runs?\s+(at|when)\s+low/i, /will\s+flee/i],
  immuneFleeing: [/immune\s+to\s+flee/i, /does\s+not\s+flee/i, /will\s+not\s+flee/i],
};

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function pqdiDimensions(text) {
  const any = (regexes) => regexes.some((re) => re.test(text));
  return {
    seeInvis: any(PQDI_TRUE.seeInvis),
    summon: any(PQDI_TRUE.summon),
    enrage: any(PQDI_TRUE.enrage),
    rampage: any(PQDI_TRUE.rampage),
    unslowable: any(PQDI_TRUE.unslowable),
    unsnareable: any(PQDI_TRUE.unsnareable),
    immunePacify: any(PQDI_TRUE.immunePacify),
    flees: any(PQDI_TRUE.flees),
    immuneFleeing: any(PQDI_TRUE.immuneFleeing),
  };
}

// ---- fetch helpers ---------------------------------------------------------
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) WolfPack-audit/1.0 (raid boss mob-info audit)';

async function fetchDbRow(id) {
  const sel =
    'id,name,level,maxlevel,runspeed,see_invis,see_invis_undead,special_abilities,npcspecialattks';
  const url = `${SUPABASE_URL}/rest/v1/eqemu_npc_types?id=eq.${id}&select=${sel}`;
  const res = await fetch(url, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) throw new Error(`supabase ${res.status} for npc ${id}`);
  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] : null;
}

async function fetchPqdi(id) {
  const url = `https://www.pqdi.cc/npc/${id}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' } });
  if (!res.ok) throw new Error(`pqdi ${res.status} for npc ${id}`);
  return await res.text();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- boss list -------------------------------------------------------------
function loadBosses() {
  const raw = JSON.parse(fs.readFileSync(path.join(REPO, 'data', 'bosses.json'), 'utf8'));
  const arr = Array.isArray(raw) ? raw : Object.values(raw);
  const out = [];
  for (const b of arr) {
    const m = String(b.pqdiUrl || '').match(/\/npc\/(\d+)/);
    if (!m) continue; // PoP-locked bosses have no pqdiUrl yet — skipped
    out.push({ id: b.id, name: b.name, zone: b.zone, exp: b.expansion, pqdiId: parseInt(m[1], 10) });
  }
  return out;
}

// ---- main ------------------------------------------------------------------
async function main() {
  if (!SUPABASE_KEY) {
    console.error('ERROR: set SUPABASE_KEY (or SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY).');
    process.exit(1);
  }

  if (DUMP_ID) {
    const html = await fetchPqdi(DUMP_ID);
    const file = path.join(REPO, `pqdi-dump-${DUMP_ID}.html`);
    fs.writeFileSync(file, html);
    console.log(`Wrote ${file} (${html.length} bytes)`);
    console.log('\n--- plain text ---\n');
    console.log(stripHtml(html).slice(0, 4000));
    return;
  }

  let bosses = loadBosses();
  if (LIMIT) bosses = bosses.slice(0, LIMIT);
  console.log(`Auditing ${bosses.length} bosses (pqdi delay ${DELAY}ms)...`);

  const mismatches = [];
  const droppedCodes = new Map(); // code -> Set(boss names)
  const errors = [];

  const DIMS = [
    ['seeInvis', 'see invis'],
    ['summon', 'summon'],
    ['enrage', 'enrage'],
    ['rampage', 'rampage'],
    ['unslowable', 'unslowable'],
    ['unsnareable', 'unsnareable/root'],
    ['immunePacify', 'immune pacify'],
  ];

  for (let i = 0; i < bosses.length; i++) {
    const b = bosses[i];
    process.stdout.write(`[${i + 1}/${bosses.length}] ${b.name} (npc ${b.pqdiId}) ... `);
    let dbRow;
    try {
      dbRow = await fetchDbRow(b.pqdiId);
    } catch (e) {
      console.log(`DB ERR ${e.message}`);
      errors.push({ boss: b.name, side: 'db', err: e.message });
      continue;
    }
    if (!dbRow) {
      console.log('DB row missing');
      errors.push({ boss: b.name, side: 'db', err: 'no row for pqdiId' });
      continue;
    }
    const dbd = dbDimensions(dbRow);

    // record codes present-but-undecoded
    for (const c of dbd.codes) {
      if (CODE[c] && CODE[c].show && !DECODED_BY_BOT.has(c)) {
        if (!droppedCodes.has(c)) droppedCodes.set(c, new Set());
        droppedCodes.get(c).add(b.name);
      }
    }

    let pq;
    try {
      const html = await fetchPqdi(b.pqdiId);
      pq = pqdiDimensions(stripHtml(html));
    } catch (e) {
      console.log(`PQDI ERR ${e.message}`);
      errors.push({ boss: b.name, side: 'pqdi', err: e.message });
      await sleep(DELAY);
      continue;
    }

    const rowMiss = [];
    for (const [key, label] of DIMS) {
      if (!!dbd[key] !== !!pq[key]) {
        rowMiss.push(`${label}: DB=${!!dbd[key]} PQDI=${!!pq[key]}`);
      }
    }
    // flee is a tri-state: DB immuneFleeing vs PQDI flees text
    if (dbd.immuneFleeing && pq.flees && !pq.immuneFleeing) {
      rowMiss.push(`flee: DB says immune-to-fleeing but PQDI text says it flees`);
    }

    if (rowMiss.length) {
      mismatches.push({ boss: b.name, npc: b.pqdiId, exp: b.exp, issues: rowMiss });
      console.log(`MISMATCH (${rowMiss.length})`);
    } else {
      console.log('ok');
    }
    await sleep(DELAY);
  }

  // ---- write report --------------------------------------------------------
  const lines = [];
  lines.push('# Mob-info audit — DB (eqemu_npc_types) vs pqdi.cc');
  lines.push('');
  lines.push(`Bosses audited: ${bosses.length}  ·  mismatches: ${mismatches.length}  ·  errors: ${errors.length}`);
  lines.push('');
  lines.push('## Flag mismatches (fix the catalog decode or the row picked)');
  lines.push('');
  if (!mismatches.length) {
    lines.push('_None — DB and PQDI agree on every audited dimension._');
  } else {
    lines.push('| Boss | npc | Expansion | Disagreements |');
    lines.push('|---|---|---|---|');
    for (const m of mismatches) {
      lines.push(`| ${m.boss} | [${m.npc}](https://www.pqdi.cc/npc/${m.npc}) | ${m.exp} | ${m.issues.join('; ')} |`);
    }
  }
  lines.push('');
  lines.push('## Special-ability codes present in the catalog that our decoder DROPS');
  lines.push('');
  lines.push('These are `show:true` codes that appear on raid bosses but are not in');
  lines.push('`index.js` `_MOB_SPECIAL_LABELS`. If PQDI renders them, Mob Info is missing a flag.');
  lines.push('');
  if (!droppedCodes.size) {
    lines.push('_None._');
  } else {
    lines.push('| Code | Label (expected) | # bosses | Examples |');
    lines.push('|---|---|---|---|');
    for (const c of [...droppedCodes.keys()].sort((a, b) => a - b)) {
      const names = [...droppedCodes.get(c)];
      lines.push(`| ${c} | ${CODE[c].label} | ${names.length} | ${names.slice(0, 4).join(', ')}${names.length > 4 ? ' …' : ''} |`);
    }
  }
  lines.push('');
  if (errors.length) {
    lines.push('## Errors');
    lines.push('');
    for (const e of errors) lines.push(`- ${e.boss} (${e.side}): ${e.err}`);
    lines.push('');
  }

  fs.writeFileSync(OUT, lines.join('\n'));
  console.log(`\nReport written to ${OUT}`);
  console.log(`Mismatches: ${mismatches.length}  Dropped-code types: ${droppedCodes.size}  Errors: ${errors.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
