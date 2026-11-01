#!/usr/bin/env node
// scripts/sync-piper-voices.js — regenerate apps/mimic/piper-voices.json, the Piper voice catalogue Mimic offers
// (the guild lead, 2026-10-28: "lets make it so we can grab more voices").
//
//   node scripts/sync-piper-voices.js              pin the CURRENT head of rhasspy/piper-voices main, rewrite the file
//   node scripts/sync-piper-voices.js --rev <sha>  re-pin to (or reproduce) one commit
//   node scripts/sync-piper-voices.js --out <path> write somewhere else
//
// What it does, in order:
//   1. resolves the revision to a COMMIT sha (the model API's /revision/main), so every URL in the file is immutable;
//   2. reads voices.json at that commit (every model: id, language, quality, speakers, file sizes);
//   3. per voice, reads the Git LFS pointer of the .onnx (oid sha256 + size, a 130-byte request, not the model) and
//      fetches + hashes the small .onnx.json (not LFS) — Mimic checks both before it keeps a download;
//   4. for en_US and en_GB ONLY (the curated list) reads the voice's MODEL_CARD and classifies its licence into the
//      three tiers neuralVoice.js gates on (classifyCard below). Every other language is tier `unchecked`: offered, but
//      behind the "needs your OK" screen with the text "licence not checked by Wolf Pack — read the model card".
// Output is sorted by id and carries no timestamps, so a re-run at the same commit is byte-identical.
//
// Behind a proxy that Node's fetch does not read by itself:  NODE_USE_ENV_PROXY=1 node scripts/sync-piper-voices.js
// The pure parts are exported for test/piper-voices-sync.test.js (no network there).

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = 'rhasspy/piper-voices';
const HF = 'https://huggingface.co';
const OUT_DEFAULT = path.join(__dirname, '..', 'apps', 'mimic', 'piper-voices.json');
// Languages whose MODEL_CARD we read and classify. The rest are offered as `unchecked` (one request per card is the cost).
const CURATED_LANGS = ['en_US', 'en_GB'];
const UNCHECKED_LICENCE = 'Licence not checked by Wolf Pack — read the model card';

// ── Pure pieces ─────────────────────────────────────────────────────────────────────────────────────

// → { oid, size } from a Git LFS pointer file's text, or null when the text is not one (the file is stored directly).
function parseLfsPointer(text) {
  const t = String(text == null ? '' : text);
  if (!/^version https:\/\/git-lfs\.github\.com\/spec\/v1/m.test(t)) return null;
  const oid = /^oid sha256:([0-9a-f]{64})\s*$/m.exec(t), size = /^size (\d+)\s*$/m.exec(t);
  return oid && size ? { oid: oid[1], size: Number(size[1]) } : null;
}

// A MODEL_CARD → { name, licenceRaw, datasetUrl, training }. Cards are a few markdown lines:
//   "* URL: <dataset>" / "* License: <text or link>" under "## Dataset", free text under "## Training".
function parseModelCard(text) {
  const t = String(text == null ? '' : text).replace(/\r/g, '');
  const grab = (re) => { const m = re.exec(t); return m ? m[1].trim() : ''; };
  const trainIdx = t.search(/^##\s*Training\b/m);
  let training = '';
  if (trainIdx >= 0) {
    const rest = t.slice(trainIdx).replace(/^##\s*Training[^\n]*\n/, '');
    const next = rest.search(/^##\s/m);
    training = (next >= 0 ? rest.slice(0, next) : rest).replace(/\s+/g, ' ').trim();
  }
  return {
    name: grab(/^#\s*Model card for\s+(.+)$/m),
    licenceRaw: grab(/^\*\s*License:\s*(.*)$/mi),
    datasetUrl: grab(/^\*\s*URL:\s*(\S.*)$/mi),
    training,
  };
}

// What kind of licence a card's "License:" text names. NC is tested before BY (a "by-nc" link contains "by").
function licenceKind(raw, datasetUrl = '') {
  const s = String(raw || '').trim(), both = s + ' ' + String(datasetUrl || '');
  if (/blizzard|lessac/i.test(both) && !/^public domain$/i.test(s)) return 'blizzard';
  if (!s || /^see\b/i.test(s)) return 'unknown';
  if (/by-?nc|non-?commercial/i.test(s)) return 'nc';
  if (/by-?sa|share-?alike/i.test(s)) return 'sa';
  if (/public\s*domain/i.test(s)) return 'pd';
  if (/\bcc0\b|publicdomain\/zero/i.test(s)) return 'cc0';
  if (/creativecommons\.org\/licenses\/by\/|\bcc[- ]by\b/i.test(s)) return 'by';
  if (/apache/i.test(s)) return 'apache';
  if (/\bmit\b/i.test(s)) return 'mit';
  return 'unknown';
}

// A short licence label for the picker. The raw card text is kept when it is already short prose.
function licenceLabel(kind, raw) {
  const s = String(raw || '').trim();
  const ver = (re) => { const m = re.exec(s); return m ? m[1] : ''; };
  switch (kind) {
    case 'pd': return 'Public domain';
    case 'cc0': return 'CC0';
    case 'by': return 'CC BY ' + (ver(/by\/(\d\.\d)/i) || ver(/\bby[- ]?(\d\.\d)/i) || '4.0');
    case 'nc': {
      const m = /by-nc(-sa|-nd)?\/(\d\.\d)/i.exec(s) || /CC[- ]BY-NC(-SA|-ND)?[- ](\d\.\d)/i.exec(s);
      return m ? 'CC BY-NC' + (m[1] || '').toUpperCase() + ' ' + m[2] : s;
    }
    case 'sa': return /^https?:/i.test(s) ? 'CC BY-SA' : s;
    case 'apache': return 'Apache-2.0';
    case 'mit': return 'MIT';
    case 'blizzard': return 'Blizzard 2013 data, research licence';
    default: return s ? 'Not stated on the model card (“' + s + '”)' : 'Not stated on the model card';
  }
}

// → 'lessac' | 'ryan' | '' — the voice this one was fine-tuned from, when it is one whose terms travel with it.
function derivedFrom(training) {
  const t = String(training || '');
  // ".{0,40}" and not "[^.]*": the cards say "Finetuned from U.S. English lessac voice", and "U.S." holds two periods.
  if (/fine-?tuned from.{0,40}\blessac\b/i.test(t)) return 'lessac';
  if (/fine-?tuned from.{0,40}\bryan\b/i.test(t)) return 'ryan';
  return '';
}

// A card → { tier, licence, credit, why }. The tiers are neuralVoice.js's:
//   free     public domain / CC0 / CC BY / Apache / MIT data, trained from scratch or from another free voice
//   nc       NC data (the licence says non-commercial), a share-alike licence, or a voice fine-tuned from the NC Ryan voice
//   research Blizzard / Lessac data, a voice fine-tuned from Lessac (its terms travel with the weights), or a licence the
//            card does not state ("See URL"): when unsure, the stricter tier
function classifyCard(cardText, voiceName = '') {
  const c = parseModelCard(cardText);
  const kind = licenceKind(c.licenceRaw, c.datasetUrl), from = derivedFrom(c.training);
  let tier, why;
  if (kind === 'blizzard') { tier = 'research'; why = 'trained on the Lessac Blizzard 2013 data (per-user research licence)'; }
  else if (from === 'lessac') { tier = 'research'; why = 'fine-tuned from the research-only Lessac voice, so its terms travel with it'; }
  else if (kind === 'unknown') { tier = 'research'; why = 'the card does not state the data licence' + (from === 'ryan' ? ' and the voice is fine-tuned from the non-commercial Ryan voice' : ''); }
  else if (kind === 'nc') { tier = 'nc'; why = 'the data licence is non-commercial'; }
  else if (kind === 'sa') { tier = 'nc'; why = 'the data licence is share-alike, which we cannot honour for you, so you read it first'; }
  else if (from === 'ryan') { tier = 'nc'; why = 'fine-tuned from the non-commercial Ryan voice, so its terms travel with it'; }
  else { tier = 'free'; why = ''; }
  let licence = licenceLabel(kind, c.licenceRaw);
  if (from === 'lessac' && kind !== 'blizzard') licence += ', fine-tuned from the research-only Lessac voice';
  if (from === 'ryan' && tier !== 'free') licence += ', fine-tuned from the non-commercial Ryan voice';
  const data = c.datasetUrl ? 'Trained on ' + c.datasetUrl + ' (' + licenceLabel(kind, c.licenceRaw) + ')' : 'Trained on data described on its model card (' + licenceLabel(kind, c.licenceRaw) + ')';
  const credit = data + (from ? ', fine-tuned from the ' + (from === 'lessac' ? 'Lessac' : 'Ryan') + ' voice' : '') + '; voice "' + (voiceName || c.name) + '" by the Piper project (' + REPO + ').';
  return { tier, licence, credit, why };
}

const resolveUrl = (rev, p) => HF + '/' + REPO + '/resolve/' + rev + '/' + p;
const blobUrl = (rev, p) => HF + '/' + REPO + '/blob/' + rev + '/' + p;

// One voices.json record (+ the hashes and card text fetched for it) → one entry of the output file.
function buildEntry(rev, rec, extra) {
  const files = Object.keys(rec.files || {});
  const onnx = files.find(f => f.endsWith('.onnx')), cfg = files.find(f => f.endsWith('.onnx.json')), card = files.find(f => /(^|\/)MODEL_CARD$/.test(f));
  if (!onnx || !cfg) throw new Error('voices.json: ' + rec.key + ' has no .onnx / .onnx.json');
  const cls = extra.card != null ? classifyCard(extra.card, rec.name)
    : { tier: 'unchecked', licence: UNCHECKED_LICENCE, credit: 'Voice "' + rec.name + '" by the Piper project (' + REPO + '); its licence is on its model card.' };
  return {
    id: rec.key, lang: rec.language.code,
    languageName: rec.language.name_english + ' (' + rec.language.country_english + ')',
    name: rec.name, quality: rec.quality, speakers: Number(rec.num_speakers) || 1,
    tier: cls.tier, licence: cls.licence, credit: cls.credit,
    card: card ? blobUrl(rev, card) : '',
    onnx: { url: resolveUrl(rev, onnx), size: extra.onnx.size, sha256: extra.onnx.sha256 },
    config: { url: resolveUrl(rev, cfg), size: extra.config.size, sha256: extra.config.sha256 },
  };
}

// Deterministic text: voices sorted by id, one per line (a diff of a re-pin reads voice by voice).
function serialize(rev, entries) {
  const sorted = entries.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return '{"source":"' + HF + '/' + REPO + '","rev":"' + rev + '","voices":[\n'
    + sorted.map(e => '  ' + JSON.stringify(e)).join(',\n') + '\n]}\n';
}

// ── Network ─────────────────────────────────────────────────────────────────────────────────────────

async function getText(url, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { redirect: 'follow' });
      if (r.ok) return Buffer.from(await r.arrayBuffer());
      last = new Error('HTTP ' + r.status + ' for ' + url);
      if (r.status === 404) break;
    } catch (e) { last = e; }
    await new Promise(res => setTimeout(res, 500 * (i + 1) * (i + 1)));
  }
  throw last;
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    for (;;) { const i = next++; if (i >= items.length) return; out[i] = await fn(items[i], i); }
  }));
  return out;
}

async function resolveRev(arg) {
  if (arg) {
    if (!/^[0-9a-f]{40}$/.test(arg)) throw new Error('--rev must be a full 40-character commit sha');
    return arg;
  }
  const j = JSON.parse((await getText(HF + '/api/models/' + REPO + '/revision/main')).toString('utf8'));
  if (!/^[0-9a-f]{40}$/.test(j.sha || '')) throw new Error('the model API did not return a commit sha');
  return j.sha;
}

async function build(rev, log = () => {}) {
  const voicesJson = JSON.parse((await getText(HF + '/' + REPO + '/raw/' + rev + '/voices.json')).toString('utf8'));
  const recs = Object.keys(voicesJson).sort().map(k => voicesJson[k]);
  const raw = (p) => HF + '/' + REPO + '/raw/' + rev + '/' + p;
  let done = 0;
  const entries = await pool(recs, 6, async (rec) => {
    const files = rec.files, paths = Object.keys(files);
    const onnxP = paths.find(f => f.endsWith('.onnx')), cfgP = paths.find(f => f.endsWith('.onnx.json')), cardP = paths.find(f => /(^|\/)MODEL_CARD$/.test(f));
    const ptr = parseLfsPointer((await getText(raw(onnxP))).toString('utf8'));
    if (!ptr) throw new Error(rec.key + ': the .onnx is not an LFS pointer');
    // The LFS pointer is what the server will actually send, so it wins; voices.json is hand-maintained and can lag
    // (en_US-libritts_r-medium listed 81472438 bytes while the file is 78580914).
    if (ptr.size !== files[onnxP].size_bytes) console.warn('\n' + rec.key + ': voices.json says ' + files[onnxP].size_bytes + ' bytes, the LFS pointer says ' + ptr.size + '; using the pointer');
    const cfgBuf = await getText(raw(cfgP));
    let cfg = { sha256: crypto.createHash('sha256').update(cfgBuf).digest('hex'), size: cfgBuf.length };
    const lfs = parseLfsPointer(cfgBuf.toString('utf8'));
    if (lfs) cfg = { sha256: lfs.oid, size: lfs.size };
    else if (crypto.createHash('md5').update(cfgBuf).digest('hex') !== files[cfgP].md5_digest) console.warn('\n' + rec.key + ': .onnx.json differs from its md5 in voices.json (stale there); using the bytes the server sent');
    const card = (CURATED_LANGS.includes(rec.language.code) && cardP) ? (await getText(raw(cardP))).toString('utf8') : null;
    log(++done + '/' + recs.length + ' ' + rec.key);
    return buildEntry(rev, rec, { onnx: { size: ptr.size, sha256: ptr.oid }, config: cfg, card });
  });
  return entries;
}

async function main(argv) {
  const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : ''; };
  const rev = await resolveRev(arg('--rev'));
  const out = arg('--out') || OUT_DEFAULT;
  console.log('pinning ' + REPO + ' @ ' + rev);
  const entries = await build(rev, (m) => { if (process.stdout.isTTY) process.stdout.write('\r' + m + '        '); });
  fs.writeFileSync(out, serialize(rev, entries));
  const by = {};
  for (const e of entries) by[e.tier] = (by[e.tier] || 0) + 1;
  console.log('\nwrote ' + entries.length + ' voices to ' + path.relative(process.cwd(), out) + ' ' + JSON.stringify(by));
}

module.exports = { parseLfsPointer, parseModelCard, licenceKind, licenceLabel, derivedFrom, classifyCard, buildEntry, serialize, CURATED_LANGS, UNCHECKED_LICENCE };

if (require.main === module) main(process.argv.slice(2)).catch((e) => { console.error(e && e.message ? e.message : e); process.exit(1); });
