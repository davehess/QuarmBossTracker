// test/piper-voices-sync.test.js — scripts/sync-piper-voices.js and the file it writes, apps/mimic/piper-voices.json
// (the guild lead, 2026-10-28: "lets make it so we can grab more voices").
//
//   · the Git LFS pointer reader (sha256 + size without downloading a model)
//   · MODEL_CARD parsing and the licence → tier classification, on the real card shapes in rhasspy/piper-voices
//   · one voices.json record → one output entry; the output is sorted and byte-stable
//   · the committed data file: pinned to a commit, every URL immutable, en_US / en_GB classified, every other language
//     `unchecked`, the multi-speaker models carry their speaker counts
// No network here: the cards below are copied from the repository at the pinned commit.
//
// Run: npx vitest run test/piper-voices-sync.test.js

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './_source-slice.js';

const require_ = createRequire(import.meta.url);
const gen = require_('../scripts/sync-piper-voices.js');
const DATA = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'piper-voices.json'), 'utf8'));

const card = (name, licence, url, training) =>
  `# Model card for ${name}\n\n* Language: en_US (English, United States)\n* Speakers: 1\n\n## Dataset\n\n${url ? `* URL: ${url}\n` : ''}* License: ${licence}\n\n## Training\n\n${training}\n`;
const CARDS = {
  kristin: card('kristin (medium)', 'public domain', 'https://librivox.org', 'US English female voice. Trained from scratch on medium quality settings for 2000 epochs.'),
  john: card('john (medium)', 'public domain', 'https://librivox.org', 'US English male voice. Single Speaker. Finetuned from Kristin (above) on medium quality settings.'),
  ryanHigh: card('ryan (high)', 'CC BY-NC-SA 4.0', 'https://www.kaggle.com/datasets/roholazandie/ryanspeech', 'Trained from scratch.'),
  ryanMedium: card('ryan (medium)', 'CC BY-NC-SA 4.0', 'https://www.kaggle.com/datasets/roholazandie/ryanspeech', 'Finetuned from U.S. English lessac voice (medium quality).'),
  lessac: card('lessac (medium)', 'https://www.cstr.ed.ac.uk/projects/blizzard/2013/lessac_blizzard2013/license.html', 'https://www.cstr.ed.ac.uk/projects/blizzard/2013/lessac_blizzard2013/', 'Trained from scratch.'),
  joe: card('joe (medium)', 'CC0', 'https://github.com/OHF-Voice/voice-datasets', 'Finetuned from U.S. English lessac voice (medium quality).'),
  amyLow: card('amy (low)', 'See URL', 'https://github.com/MycroftAI/mimic3-voices', 'Finetuned from U.S. English Ryan voice (low quality).'),
  arctic: card('arctic (medium)', 'See LICENSE file', 'http://www.festvox.org/cmu_arctic/', 'Trained from scratch.'),
  libritts: card('libritts (high)', 'CC BY 4.0', 'http://www.openslr.org/60/', 'Trained from scratch on train-clean-360.'),
  sa: card('northern (medium)', 'CC-BY-SA 4.0 International', 'http://www.openslr.org/83/', 'Trained from scratch.'),
  apache: card('sam (medium)', 'https://www.apache.org/licenses/LICENSE-2.0.txt', 'https://github.com/x/y', 'Trained from scratch.'),
  kathleen: card('kathleen (low)', 'CC0', 'https://github.com/rhasspy/dataset-voice-kathleen', 'Finetuned from U.S. English Ryan voice (low quality).'),
  ncOnLessac: card('semaine (medium)', 'http://creativecommons.org/licenses/by-nc-sa/4.0/', 'https://github.com/marytts/dfki-semaine-data', 'Finetuned from U.S. English lessac voice (medium quality).'),
  noUrl: card('bryce (medium)', 'public domain', '', 'US English male voice. Finetuned for an additional 1000 epochs from an unreleased voice.'),
  cc0Scratch: card('mystery (medium)', 'CC0', 'https://example.org/data', 'Trained from scratch.'),
  byNcLink: card('l2 (medium)', 'https://creativecommons.org/licenses/by-nc/4.0/', 'https://example.org/x', 'Trained from scratch.'),
};

describe('LFS pointer', () => {
  it('reads the sha256 and the size out of a pointer file', () => {
    const t = 'version https://git-lfs.github.com/spec/v1\noid sha256:5849957f929cbf720c258f8458692d6103fff2f0e3d3b19c8259474bb06a18d4\nsize 63531379\n';
    expect(gen.parseLfsPointer(t)).toEqual({ oid: '5849957f929cbf720c258f8458692d6103fff2f0e3d3b19c8259474bb06a18d4', size: 63531379 });
  });
  it('is null for anything that is not a pointer (the small .onnx.json is stored directly)', () => {
    expect(gen.parseLfsPointer('{"audio":{"sample_rate":22050}}')).toBeNull();
    expect(gen.parseLfsPointer('')).toBeNull();
    expect(gen.parseLfsPointer(null)).toBeNull();
    expect(gen.parseLfsPointer('version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 3\n')).toBeNull();   // a short oid
    expect(gen.parseLfsPointer('version https://git-lfs.github.com/spec/v1\noid sha256:' + 'a'.repeat(64) + '\n')).toBeNull();   // no size
  });
});

describe('model card parsing', () => {
  it('reads the dataset URL, the licence line and the training text', () => {
    expect(gen.parseModelCard(CARDS.ryanMedium)).toEqual({
      name: 'ryan (medium)', licenceRaw: 'CC BY-NC-SA 4.0',
      datasetUrl: 'https://www.kaggle.com/datasets/roholazandie/ryanspeech', training: 'Finetuned from U.S. English lessac voice (medium quality).',
    });
  });
  it('a card with no dataset URL, no sections or CRLF line ends still parses', () => {
    expect(gen.parseModelCard(CARDS.noUrl)).toMatchObject({ licenceRaw: 'public domain', datasetUrl: '' });
    expect(gen.parseModelCard(CARDS.kristin.replace(/\n/g, '\r\n')).licenceRaw).toBe('public domain');
    expect(gen.parseModelCard('')).toEqual({ name: '', licenceRaw: '', datasetUrl: '', training: '' });
    expect(gen.parseModelCard(undefined).licenceRaw).toBe('');
  });
});

describe('licence → tier', () => {
  const tier = (c) => gen.classifyCard(c, 'x').tier;

  it('free: public domain, CC0, CC BY and Apache data, trained from scratch or from another free voice', () => {
    for (const c of ['kristin', 'john', 'noUrl', 'cc0Scratch', 'libritts', 'apache']) expect(tier(CARDS[c]), c).toBe('free');
  });

  it('non-commercial: an NC licence, whether it is spelled out or only in the link; a share-alike licence is read first too', () => {
    expect(tier(CARDS.ryanHigh)).toBe('nc');
    expect(tier(CARDS.byNcLink)).toBe('nc');
    expect(tier(CARDS.sa)).toBe('nc');
  });

  it('a voice fine-tuned from the NC Ryan voice carries those terms even though its own data is CC0', () => {
    expect(tier(CARDS.kathleen)).toBe('nc');
    expect(gen.classifyCard(CARDS.kathleen, 'kathleen').licence).toMatch(/fine-tuned from the non-commercial Ryan voice/);
  });

  it('research: Lessac Blizzard data, anything fine-tuned from Lessac, and a licence the card does not state', () => {
    expect(tier(CARDS.lessac)).toBe('research');
    expect(tier(CARDS.joe)).toBe('research');           // CC0 data, but fine-tuned from lessac (the 2026-10-17 call)
    expect(tier(CARDS.ryanMedium)).toBe('research');    // NC data AND fine-tuned from lessac → the stricter of the two
    expect(tier(CARDS.ncOnLessac)).toBe('research');
    expect(tier(CARDS.amyLow)).toBe('research');        // "See URL" + fine-tuned from Ryan
    expect(tier(CARDS.arctic)).toBe('research');        // "See LICENSE file"
    expect(tier('')).toBe('research');                  // no card text at all: unsure → strictest
    expect(tier('# Model card\n\n* License: something nobody has seen\n')).toBe('research');
  });

  it('the labels read like the hand-written ones, and the credit names the dataset and the voice', () => {
    expect(gen.classifyCard(CARDS.ryanHigh, 'ryan').licence).toBe('CC BY-NC-SA 4.0');
    expect(gen.classifyCard(CARDS.kristin, 'kristin').licence).toBe('Public domain');
    expect(gen.classifyCard(CARDS.libritts, 'libritts').licence).toBe('CC BY 4.0');
    expect(gen.classifyCard(CARDS.byNcLink, 'l2').licence).toBe('CC BY-NC 4.0');
    expect(gen.classifyCard(CARDS.lessac, 'lessac').licence).toBe('Blizzard 2013 data, research licence');
    expect(gen.classifyCard(CARDS.joe, 'joe').licence).toBe('CC0, fine-tuned from the research-only Lessac voice');
    expect(gen.classifyCard(CARDS.amyLow, 'amy').licence).toMatch(/^Not stated on the model card/);
    const c = gen.classifyCard(CARDS.ryanHigh, 'ryan');
    expect(c.credit).toBe('Trained on https://www.kaggle.com/datasets/roholazandie/ryanspeech (CC BY-NC-SA 4.0); voice "ryan" by the Piper project (rhasspy/piper-voices).');
    expect(gen.classifyCard(CARDS.noUrl, 'bryce').credit).toMatch(/model card/);
  });

  it('knows who a voice was fine-tuned from, across the periods in "U.S."', () => {
    expect(gen.derivedFrom('Finetuned from U.S. English lessac voice (medium quality).')).toBe('lessac');
    expect(gen.derivedFrom('Fine-tuned from English lessac medium on train-clean-360.')).toBe('lessac');
    expect(gen.derivedFrom('Finetuned from U.S. English Ryan voice (low quality).')).toBe('ryan');
    expect(gen.derivedFrom('Finetuned from Kristin (above) on medium quality settings.')).toBe('');
    expect(gen.derivedFrom('Trained from scratch.')).toBe('');
  });
});

describe('entries and the file', () => {
  const REV = 'a'.repeat(40);
  const rec = (key, lang, name, extra = {}) => ({
    key, name, quality: 'medium', num_speakers: extra.speakers || 1,
    language: { code: lang, name_english: lang.startsWith('de') ? 'German' : 'English', country_english: lang.startsWith('de') ? 'Germany' : 'United States' },
    files: {
      [`x/${lang}/${name}/medium/${key}.onnx`]: { size_bytes: 10, md5_digest: '0' },
      [`x/${lang}/${name}/medium/${key}.onnx.json`]: { size_bytes: 5, md5_digest: '0' },
      [`x/${lang}/${name}/medium/MODEL_CARD`]: { size_bytes: 5, md5_digest: '0' },
    },
  });
  const hashes = { onnx: { size: 10, sha256: 'b'.repeat(64) }, config: { size: 5, sha256: 'c'.repeat(64) } };

  it('a curated voice is classified from its card; the URLs are the commit\'s, never a branch', () => {
    const e = gen.buildEntry(REV, rec('en_US-kristin-medium', 'en_US', 'kristin'), { ...hashes, card: CARDS.kristin });
    expect(e).toMatchObject({ id: 'en_US-kristin-medium', lang: 'en_US', languageName: 'English (United States)', name: 'kristin', quality: 'medium', speakers: 1, tier: 'free', licence: 'Public domain' });
    expect(e.onnx).toEqual({ url: `https://huggingface.co/rhasspy/piper-voices/resolve/${REV}/x/en_US/kristin/medium/en_US-kristin-medium.onnx`, size: 10, sha256: 'b'.repeat(64) });
    expect(e.config.url).toBe(`https://huggingface.co/rhasspy/piper-voices/resolve/${REV}/x/en_US/kristin/medium/en_US-kristin-medium.onnx.json`);
    expect(e.card).toBe(`https://huggingface.co/rhasspy/piper-voices/blob/${REV}/x/en_US/kristin/medium/MODEL_CARD`);
  });

  it('a voice with no card read is `unchecked`, with the "not checked by Wolf Pack" text', () => {
    const e = gen.buildEntry(REV, rec('de_DE-thorsten-medium', 'de_DE', 'thorsten'), { ...hashes, card: null });
    expect(e).toMatchObject({ tier: 'unchecked', languageName: 'German (Germany)', licence: gen.UNCHECKED_LICENCE });
    expect(e.licence).toMatch(/not checked by Wolf Pack/i);
    expect(e.credit).toMatch(/model card/);
  });

  it('the speaker count comes through (multi-speaker models)', () => {
    expect(gen.buildEntry(REV, rec('en_US-libritts-high', 'en_US', 'libritts', { speakers: 904 }), { ...hashes, card: CARDS.libritts }).speakers).toBe(904);
  });

  it('a record without both files is refused', () => {
    expect(() => gen.buildEntry(REV, { key: 'k', name: 'n', language: { code: 'en_US' }, files: { 'a/MODEL_CARD': {} } }, { ...hashes, card: null })).toThrow(/no \.onnx/);
  });

  it('the output is sorted by id and identical however the input is ordered', () => {
    const a = gen.buildEntry(REV, rec('en_US-a-medium', 'en_US', 'a'), { ...hashes, card: CARDS.kristin });
    const b = gen.buildEntry(REV, rec('de_DE-b-medium', 'de_DE', 'b'), { ...hashes, card: null });
    const c = gen.buildEntry(REV, rec('en_GB-c-medium', 'en_US', 'c'), { ...hashes, card: CARDS.kristin });
    const one = gen.serialize(REV, [a, b, c]), two = gen.serialize(REV, [c, a, b]);
    expect(one).toBe(two);
    const parsed = JSON.parse(one);
    expect(parsed.rev).toBe(REV);
    expect(parsed.voices.map(v => v.id)).toEqual(['de_DE-b-medium', 'en_GB-c-medium', 'en_US-a-medium']);
    expect(one.endsWith('\n')).toBe(true);
  });
});

describe('the committed piper-voices.json', () => {
  it('is pinned to a commit and every URL is that commit\'s', () => {
    expect(DATA.rev).toMatch(/^[0-9a-f]{40}$/);
    expect(DATA.voices.length).toBeGreaterThan(150);
    for (const v of DATA.voices) {
      for (const f of [v.onnx, v.config]) {
        expect(f.url.startsWith(`https://huggingface.co/rhasspy/piper-voices/resolve/${DATA.rev}/`), v.id).toBe(true);
        expect(f.sha256, v.id).toMatch(/^[0-9a-f]{64}$/);
        expect(Number.isInteger(f.size) && f.size > 0, v.id).toBe(true);
      }
      expect(v.card.startsWith(`https://huggingface.co/rhasspy/piper-voices/blob/${DATA.rev}/`), v.id).toBe(true);
      expect(v.licence && v.credit, v.id).toBeTruthy();
      expect(['free', 'nc', 'research', 'unchecked'], v.id).toContain(v.tier);
    }
  });

  it('is sorted by id with no duplicates, and the file is exactly what the generator would write', () => {
    const ids = DATA.voices.map(v => v.id);
    expect(ids).toEqual([...ids].sort());
    expect(new Set(ids).size).toBe(ids.length);
    expect(gen.serialize(DATA.rev, DATA.voices)).toBe(fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'piper-voices.json'), 'utf8'));
  });

  it('en_US and en_GB are classified; every other language is unchecked', () => {
    for (const v of DATA.voices) {
      if (gen.CURATED_LANGS.includes(v.lang)) expect(v.tier, v.id).not.toBe('unchecked');
      else expect(v.tier, v.id).toBe('unchecked');
    }
    expect(DATA.voices.filter(v => v.lang === 'en_US').length).toBeGreaterThanOrEqual(27);
    expect(DATA.voices.filter(v => v.lang === 'en_GB').length).toBeGreaterThanOrEqual(11);
  });

  it('the multi-speaker models carry their speaker counts', () => {
    const sp = (id) => DATA.voices.find(v => v.id === id).speakers;
    expect(sp('en_US-arctic-medium')).toBe(18);
    expect(sp('en_US-l2arctic-medium')).toBe(24);
    expect(sp('en_US-libritts-high')).toBe(904);
    expect(sp('en_US-libritts_r-medium')).toBe(2306);
    expect(sp('en_US-kristin-medium')).toBe(1);
  });

  it('the six voices offered since 2026-10-17 are in the same tiers as before, with the checksums they were pinned with', () => {
    const by = Object.fromEntries(DATA.voices.map(v => [v.id, v]));
    expect(['en_US-kristin-medium', 'en_US-john-medium'].map(i => by[i].tier)).toEqual(['free', 'free']);
    expect(by['en_US-ryan-high'].tier).toBe('nc');
    expect(['en_US-lessac-medium', 'en_US-joe-medium', 'en_US-ryan-medium'].map(i => by[i].tier)).toEqual(['research', 'research', 'research']);
    expect(by['en_US-kristin-medium'].onnx.sha256).toBe('5849957f929cbf720c258f8458692d6103fff2f0e3d3b19c8259474bb06a18d4');
    expect(by['en_US-ryan-high'].onnx.sha256).toBe('b3990d7606e183ec8dbfba70a4607074f162de1a0c412e0180d1ff60bb154eca');
  });

  it('no free-tier voice descends from Lessac or Ryan, or trains on NC data (by the generator\'s own reading of the licence text)', () => {
    for (const v of DATA.voices.filter(x => x.tier === 'free')) {
      expect(v.licence, v.id).not.toMatch(/fine-tuned|Blizzard|BY-NC|BY-SA|Not stated/);
    }
  });
});
