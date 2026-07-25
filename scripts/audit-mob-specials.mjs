#!/usr/bin/env node
/*
 * audit-mob-specials.mjs — mob-info catalog audit (#173)
 * ---------------------------------------------------------------------------
 * Two jobs, both keyed off eqemu_npc_types (the weekly Quarm mirror the Mob
 * Info / Target Info overlay reads):
 *
 *   1. --db-all   FULL-CATALOG DB analysis (no PQDI needed). Decodes every mob,
 *                 detects placeholder/controller rows, clusters same-name
 *                 variants, and flags the ones whose danger flags DIVERGE (some
 *                 variants enrage/flurry, others don't). This is the data the
 *                 same-name-variant fix (#161/#171) and the row-picker (#173)
 *                 are built on. Covers all ~18k mobs, not just raid bosses.
 *
 *   2. (default)  PQDI DIFF for a bounded set (the 113 raid bosses in
 *                 data/bosses.json, by pqdiUrl id). Confirms our catalog agrees
 *                 with pqdi.cc on: see-invis · pacify · rooted · flee · enrage
 *                 · rampage · summon · unslowable · unsnareable(root).
 *
 * WHY THE PQDI HALF RUNS LOCALLY: pqdi.cc 403s the Claude Code cloud proxy.
 * Scraping all 18k mobs is also infeasible (~7.5h, rate-limited), so PQDI is a
 * validation SAMPLE (bosses by default) while --db-all covers the whole catalog.
 *
 * USAGE:
 *   SUPABASE_URL=... SUPABASE_KEY=... node scripts/audit-mob-specials.mjs --db-all
 *   SUPABASE_URL=... SUPABASE_KEY=... node scripts/audit-mob-specials.mjs           # PQDI boss diff
 *     (SUPABASE_KEY falls back to SUPABASE_SERVICE_ROLE_KEY or
 *      NEXT_PUBLIC_SUPABASE_ANON_KEY — eqemu_* is anon-readable.)
 *
 *   --db-all        full-catalog DB analysis → mob-specials-all.csv +
 *                   mob-specials-clusters.md + mob-specials-summary.md
 *   --dump <id>     fetch ONE pqdi page → pqdi-dump-<id>.html + print text
 *                   (use to recalibrate the PQDI phrase matchers if markup drifts)
 *   --limit N       cap the PQDI-diff boss count (smoke test)
 *   --delay MS      politeness delay between pqdi fetches (default 1500)
 *   --out FILE      PQDI-diff report path (default audit-mob-specials-report.md)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');

// ---- args ------------------------------------------------------------------
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const getArg = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : def;
};
const MODE_DB_ALL = has('--db-all');
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
// show: should this surface as a Mob Info flag? danger: is it a combat warning
// that must be UNIONed across same-name variants (if any real variant does it,
// warn)? Codes marked VERIFY are internal combat-tuning knobs whose PQDI
// rendering is unconfirmed — the PQDI diff settles them.
const CODE = {
  1:  { label: 'Summon',                    show: true,  danger: true  },
  2:  { label: 'Enrage',                    show: true,  danger: true  },
  3:  { label: 'Rampage',                   show: true,  danger: true  },
  4:  { label: 'Area Rampage',              show: true,  danger: true  },
  5:  { label: 'Flurry',                    show: true,  danger: true  },
  6:  { label: 'Triple Attack',             show: true,  danger: false },
  7:  { label: 'Quad Attack',               show: true,  danger: false },
  8:  { label: 'Dual Wield',                show: false, danger: false },
  9:  { label: 'Bane',                      show: true,  danger: false },
  10: { label: 'Magical',                   show: true,  danger: false },
  11: { label: 'Ranged',                    show: true,  danger: false },
  12: { label: 'Unslowable',                show: true,  danger: false },
  13: { label: 'Unmezzable',                show: true,  danger: false },
  14: { label: 'Uncharmable',               show: true,  danger: false },
  15: { label: 'Unstunnable',               show: true,  danger: false },
  16: { label: 'Unsnareable',               show: true,  danger: false }, // movement-speed immune
  17: { label: 'Unfearable',                show: true,  danger: false },
  18: { label: 'Undispellable',             show: true,  danger: false },
  19: { label: 'Immune Melee',              show: true,  danger: false },
  20: { label: 'Immune Magic',              show: true,  danger: false },
  21: { label: 'Immune Fleeing',            show: true,  danger: false }, // does NOT flee
  22: { label: 'Immune Melee Except Bane',  show: true,  danger: false },
  23: { label: 'Immune Non-Magical',        show: true,  danger: false }, // needs magic weapon
  24: { label: 'Will Not Aggro',            show: true,  danger: false },
  25: { label: 'Immune Aggro On',           show: false, danger: false },
  26: { label: 'Immune Ranged Spells',      show: true,  danger: false },
  27: { label: 'Immune Feign Death',        show: true,  danger: false },
  28: { label: 'Immune Taunt',              show: true,  danger: false },
  29: { label: 'Tunnel Vision',             show: false, danger: false },
  30: { label: 'No Buff/Heal Friends',      show: false, danger: false },
  31: { label: 'Immune Pacify',             show: true,  danger: false },
  32: { label: 'Leash',                     show: false, danger: false },
  33: { label: 'Tether',                    show: false, danger: false },
  34: { label: 'Destructible Object',       show: false, danger: false },
  35: { label: 'No Harm From Client',       show: false, danger: false },
  36: { label: 'Always Flee',               show: true,  danger: false },
  37: { label: 'Flee At Percent',           show: true,  danger: false }, // "runs when low"
  38: { label: 'Allow Beneficial',          show: false, danger: false },
  39: { label: 'Disable Melee',             show: true,  danger: false },
  40: { label: 'Chase Distance',            show: false, danger: false },
  41: { label: 'Casting Resist Diff',       show: false, danger: false },
  42: { label: 'Counter Avoid Damage',      show: false, danger: false }, // VERIFY tuning
  43: { label: 'Prox Aggro',                show: false, danger: false }, // VERIFY tuning
  44: { label: 'Immune Ranged Attacks',     show: true,  danger: false },
  45: { label: 'Immune Damage (Client)',    show: false, danger: false },
  46: { label: 'Immune Damage (NPC/Pet)',   show: true,  danger: false }, // charm/pet strats
  47: { label: 'Immune Aggro (Client)',     show: false, danger: false },
  48: { label: 'Immune Aggro (NPC)',        show: false, danger: false },
  49: { label: 'Modify Avoid Damage',       show: false, danger: false }, // VERIFY tuning
};

// Codes the production decoder (index.js _MOB_SPECIAL_LABELS) currently labels.
const DECODED_BY_BOT = new Set([
  1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 23, 27, 28, 31,
]);

function normName(n) {
  return String(n || '').trim().toLowerCase().replace(/^#/, '');
}

// Map<code, params[]> from a `^`-delimited code,param[,param2] string.
function parseSpecials(str) {
  const out = new Map();
  if (!str) return out;
  for (const part of String(str).split('^')) {
    const bits = part.split(',').map((s) => s.trim());
    const code = parseInt(bits[0], 10);
    if (!Number.isFinite(code)) continue;
    if (bits[1] != null && bits[1] === '0') continue; // present-but-disabled
    out.set(code, bits.slice(1));
  }
  return out;
}

// A placeholder / event-controller row: immune to BOTH melee (19) and magic
// (20) — can't be killed normally, so it is never the mob you're fighting.
// Catches L1 spawn placeholders AND scripted pre-event bodies. The row-picker
// still falls back to these if a name has NO real row.
function isPlaceholder(sp) {
  return sp.has(19) && sp.has(20);
}

function decodeRow(row) {
  const sp = parseSpecials(row.special_abilities);
  const codes = [...sp.keys()].sort((a, b) => a - b);
  const rs = Number(row.runspeed);
  const labels = codes.filter((c) => CODE[c] && CODE[c].show).map((c) => CODE[c].label);
  return {
    id: row.id,
    name: row.name,
    norm: normName(row.name),
    level: row.level,
    runspeed: Number.isFinite(rs) ? rs : null,
    rooted: Number.isFinite(rs) && rs === 0,
    seeInvis: !!row.see_invis || !!row.see_invis_undead,
    placeholder: isPlaceholder(sp),
    summon: sp.has(1),
    enrage: sp.has(2),
    rampage: sp.has(3) || sp.has(4),
    flurry: sp.has(5),
    unslowable: sp.has(12),
    unsnareable: sp.has(16),
    immunePacify: sp.has(31),
    immuneFleeing: sp.has(21),
    fleePercent: sp.has(37) ? sp.get(37)[0] || '?' : null,
    codes,
    labels,
    raw: row.special_abilities || '',
  };
}

// ---- fetch helpers ---------------------------------------------------------
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) WolfPack-audit/1.0 (raid boss mob-info audit)';

async function sbSelect(qs) {
  const url = `${SUPABASE_URL}/rest/v1/eqemu_npc_types?${qs}`;
  const res = await fetch(url, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) throw new Error(`supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function fetchAllRows() {
  const sel = 'id,name,level,runspeed,see_invis,see_invis_undead,special_abilities';
  const page = 1000;
  let offset = 0;
  const all = [];
  for (;;) {
    const rows = await sbSelect(`select=${sel}&order=id.asc&limit=${page}&offset=${offset}`);
    if (!Array.isArray(rows) || rows.length === 0) break;
    all.push(...rows);
    process.stdout.write(`\r  fetched ${all.length} rows...`);
    if (rows.length < page) break;
    offset += page;
  }
  process.stdout.write('\n');
  return all;
}

async function fetchPqdi(id) {
  const res = await fetch(`https://www.pqdi.cc/npc/${id}`, {
    headers: { 'User-Agent': UA, Accept: 'text/html' },
  });
  if (!res.ok) throw new Error(`pqdi ${res.status} for npc ${id}`);
  return res.text();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ===========================================================================
// MODE 1 — full-catalog DB analysis
// ===========================================================================
async function runDbAll() {
  console.log('Full-catalog DB analysis (no PQDI). Fetching eqemu_npc_types...');
  const rows = await fetchAllRows();
  const decoded = rows.map(decodeRow);

  // cluster by normalized name
  const byName = new Map();
  for (const d of decoded) {
    if (!byName.has(d.norm)) byName.set(d.norm, []);
    byName.get(d.norm).push(d);
  }

  // per-cluster: real (non-placeholder) rows, danger divergence, merged danger
  const DANGER = ['summon', 'enrage', 'rampage', 'flurry'];
  const clusterInfo = new Map(); // norm -> {size, real, divergent, merged}
  let divergentCount = 0;
  let placeholderClusters = 0;
  for (const [norm, list] of byName) {
    const real = list.filter((d) => !d.placeholder);
    const base = real.length ? real : list; // fall back to placeholders if no real row
    const profiles = new Set(base.map((d) => DANGER.map((k) => (d[k] ? 1 : 0)).join('')));
    const merged = {};
    for (const k of DANGER) merged[k] = base.some((d) => d[k]);
    const divergent = list.length > 1 && profiles.size > 1;
    if (divergent) divergentCount++;
    if (list.some((d) => d.placeholder) && list.length > 1) placeholderClusters++;
    clusterInfo.set(norm, { size: list.length, real: real.length, divergent, merged });
  }

  // dropped-code inventory (show:true codes present but not decoded by the bot)
  const dropped = new Map();
  for (const d of decoded) {
    for (const c of d.codes) {
      if (CODE[c] && CODE[c].show && !DECODED_BY_BOT.has(c)) {
        if (!dropped.has(c)) dropped.set(c, 0);
        dropped.set(c, dropped.get(c) + 1);
      }
    }
  }

  // ---- write full CSV ------------------------------------------------------
  const csvPath = path.join(REPO, 'mob-specials-all.csv');
  const header = [
    'id', 'name', 'norm', 'level', 'runspeed', 'rooted', 'see_invis',
    'placeholder', 'cluster_size', 'cluster_divergent',
    'summon', 'enrage', 'rampage', 'flurry',
    'unslowable', 'unsnareable', 'immune_pacify', 'immune_fleeing', 'flee_pct',
    'flags', 'raw_special_abilities',
  ];
  const lines = [header.join(',')];
  for (const d of decoded) {
    const ci = clusterInfo.get(d.norm);
    lines.push([
      d.id, csvCell(d.name), d.norm, d.level, d.runspeed ?? '', d.rooted,
      d.seeInvis, d.placeholder, ci.size, ci.divergent,
      d.summon, d.enrage, d.rampage, d.flurry,
      d.unslowable, d.unsnareable, d.immunePacify, d.immuneFleeing, d.fleePercent ?? '',
      csvCell(d.labels.join('; ')), csvCell(d.raw),
    ].join(','));
  }
  fs.writeFileSync(csvPath, lines.join('\n'));

  // ---- write divergent-cluster report -------------------------------------
  const clPath = path.join(REPO, 'mob-specials-clusters.md');
  const cl = [];
  cl.push('# Same-name variant clusters that DIVERGE on danger flags');
  cl.push('');
  cl.push('Each block is one name whose non-placeholder rows do not all agree on');
  cl.push('summon/enrage/rampage/flurry. The row-picker must MERGE these (warn if');
  cl.push('ANY real variant does it) and never let a placeholder row win.');
  cl.push('');
  const divergent = [...byName.entries()]
    .filter(([norm]) => clusterInfo.get(norm).divergent)
    .sort((a, b) => b[1].length - a[1].length);
  for (const [norm, list] of divergent) {
    const ci = clusterInfo.get(norm);
    const warn = Object.entries(ci.merged).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none';
    cl.push(`## ${norm}  —  merged danger: ${warn}`);
    cl.push('');
    cl.push('| id | name | lvl | rs | placeholder | S | E | R | F | flags |');
    cl.push('|---|---|---|---|---|---|---|---|---|---|');
    for (const d of list.sort((a, b) => (b.level || 0) - (a.level || 0))) {
      cl.push(`| ${d.id} | ${d.name} | ${d.level} | ${d.runspeed ?? ''} | ${d.placeholder ? 'YES' : ''} | ${d.summon ? '✓' : ''} | ${d.enrage ? '✓' : ''} | ${d.rampage ? '✓' : ''} | ${d.flurry ? '✓' : ''} | ${d.labels.join('; ')} |`);
    }
    cl.push('');
  }
  fs.writeFileSync(clPath, cl.join('\n'));

  // ---- write summary -------------------------------------------------------
  const sPath = path.join(REPO, 'mob-specials-summary.md');
  const s = [];
  s.push('# Mob-specials full-catalog summary');
  s.push('');
  s.push(`- Total mobs: **${decoded.length}**`);
  s.push(`- Placeholder/controller rows (immune melee+magic): **${decoded.filter((d) => d.placeholder).length}**`);
  s.push(`- Rooted-in-place rows (runspeed 0): **${decoded.filter((d) => d.rooted).length}**`);
  s.push(`- Same-name clusters (size > 1): **${[...byName.values()].filter((l) => l.length > 1).length}**`);
  s.push(`- Clusters that DIVERGE on danger flags: **${divergentCount}**  ← the merge targets`);
  s.push(`- Clusters containing a placeholder row: **${placeholderClusters}**  ← the exclusion targets`);
  s.push('');
  s.push('## Special-ability codes present in the catalog that our decoder DROPS');
  s.push('');
  s.push('| code | label (expected) | # mobs |');
  s.push('|---|---|---|');
  for (const c of [...dropped.keys()].sort((a, b) => a - b)) {
    s.push(`| ${c} | ${CODE[c].label} | ${dropped.get(c)} |`);
  }
  s.push('');
  s.push('Outputs: `mob-specials-all.csv` (every mob decoded), `mob-specials-clusters.md` (divergent clusters).');
  fs.writeFileSync(sPath, s.join('\n'));

  console.log(`\nWrote:\n  ${csvPath}\n  ${clPath}\n  ${sPath}`);
  console.log(`Mobs ${decoded.length} · divergent clusters ${divergentCount} · placeholder rows ${decoded.filter((d) => d.placeholder).length} · dropped-code types ${dropped.size}`);
}

// ===========================================================================
// MODE 2 — PQDI diff (bosses)
// ===========================================================================
const PQDI_TRUE = {
  seeInvis:     [/see\s+invis/i, /sees?\s+invisible/i],
  summon:       [/\bsummon/i],
  enrage:       [/\benrage/i],
  rampage:      [/\brampage/i],
  unslowable:   [/immune\s+to\s+slow/i, /unslow/i, /cannot\s+be\s+slowed/i],
  unsnareable:  [/immune\s+to\s+(snare|root)/i, /unsnare/i, /unroot/i, /cannot\s+be\s+(snared|rooted)/i],
  immunePacify: [/immune\s+to\s+pacif/i, /cannot\s+be\s+pacif/i, /unpacif/i],
  flees:        [/\bflees?\b/i, /runs?\s+(at|when)\s+low/i, /will\s+flee/i],
  immuneFleeing:[/immune\s+to\s+flee/i, /does\s+not\s+flee/i, /will\s+not\s+flee/i],
};

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ').trim();
}

function pqdiDimensions(text) {
  const any = (rs) => rs.some((re) => re.test(text));
  const o = {};
  for (const k of Object.keys(PQDI_TRUE)) o[k] = any(PQDI_TRUE[k]);
  return o;
}

function loadBosses() {
  const raw = JSON.parse(fs.readFileSync(path.join(REPO, 'data', 'bosses.json'), 'utf8'));
  const arr = Array.isArray(raw) ? raw : Object.values(raw);
  const out = [];
  for (const b of arr) {
    const m = String(b.pqdiUrl || '').match(/\/npc\/(\d+)/);
    if (m) out.push({ id: b.id, name: b.name, exp: b.expansion, pqdiId: parseInt(m[1], 10) });
  }
  return out;
}

async function runPqdiDiff() {
  let bosses = loadBosses();
  if (LIMIT) bosses = bosses.slice(0, LIMIT);
  console.log(`PQDI diff for ${bosses.length} bosses (delay ${DELAY}ms)...`);
  const mismatches = [];
  const errors = [];
  const DIMS = [
    ['seeInvis', 'see invis'], ['summon', 'summon'], ['enrage', 'enrage'],
    ['rampage', 'rampage'], ['unslowable', 'unslowable'],
    ['unsnareable', 'unsnareable/root'], ['immunePacify', 'immune pacify'],
  ];
  for (let i = 0; i < bosses.length; i++) {
    const b = bosses[i];
    process.stdout.write(`[${i + 1}/${bosses.length}] ${b.name} (${b.pqdiId}) ... `);
    let dbd;
    try {
      const rows = await sbSelect(`id=eq.${b.pqdiId}&select=id,name,level,runspeed,see_invis,see_invis_undead,special_abilities`);
      if (!rows[0]) { console.log('DB row missing'); errors.push(`${b.name}: no DB row`); continue; }
      dbd = decodeRow(rows[0]);
    } catch (e) { console.log(`DB ERR ${e.message}`); errors.push(`${b.name}: ${e.message}`); continue; }
    let pq;
    try { pq = pqdiDimensions(stripHtml(await fetchPqdi(b.pqdiId))); }
    catch (e) { console.log(`PQDI ERR ${e.message}`); errors.push(`${b.name}: ${e.message}`); await sleep(DELAY); continue; }
    const iss = [];
    for (const [k, label] of DIMS) if (!!dbd[k] !== !!pq[k]) iss.push(`${label}: DB=${!!dbd[k]} PQDI=${!!pq[k]}`);
    if (dbd.immuneFleeing && pq.flees && !pq.immuneFleeing) iss.push('flee: DB immune-to-fleeing but PQDI says it flees');
    if (iss.length) { mismatches.push({ ...b, iss }); console.log(`MISMATCH (${iss.length})`); }
    else console.log('ok');
    await sleep(DELAY);
  }
  const out = ['# Mob-info audit — DB vs pqdi.cc (raid bosses)', '',
    `Bosses ${bosses.length} · mismatches ${mismatches.length} · errors ${errors.length}`, ''];
  if (!mismatches.length) out.push('_No disagreements._');
  else {
    out.push('| Boss | npc | Exp | Disagreements |', '|---|---|---|---|');
    for (const m of mismatches) out.push(`| ${m.name} | [${m.pqdiId}](https://www.pqdi.cc/npc/${m.pqdiId}) | ${m.exp} | ${m.iss.join('; ')} |`);
  }
  if (errors.length) { out.push('', '## Errors'); for (const e of errors) out.push(`- ${e}`); }
  fs.writeFileSync(OUT, out.join('\n'));
  console.log(`\nReport → ${OUT}  (mismatches ${mismatches.length}, errors ${errors.length})`);
}

// ---- main ------------------------------------------------------------------
async function main() {
  if (DUMP_ID) {
    const html = await fetchPqdi(DUMP_ID);
    fs.writeFileSync(path.join(REPO, `pqdi-dump-${DUMP_ID}.html`), html);
    console.log(`Wrote pqdi-dump-${DUMP_ID}.html (${html.length} bytes)\n\n--- text ---\n`);
    console.log(stripHtml(html).slice(0, 4000));
    return;
  }
  if (!SUPABASE_KEY) {
    console.error('ERROR: set SUPABASE_KEY (or SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY).');
    process.exit(1);
  }
  if (MODE_DB_ALL) await runDbAll();
  else await runPqdiDiff();
}

main().catch((e) => { console.error(e); process.exit(1); });
