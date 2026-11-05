#!/usr/bin/env node
'use strict';
// sidl-preview.js — render EverQuest UI windows from a skin to PNGs, through the same two modules UI Studio will use
// (apps/mimic/sidlSkin.js reads the skin; apps/mimic/sidlRender.js draws it). For eyeballing, not for CI.
//
//   node scripts/sidl-preview.js --eq <dir holding uifiles/> --skin <name> [--out <dir>] [--scale 2]
//        [--screens "PlayerWindow,ChatWindow:600x300,..."] [--fill 0.7]
//
// "Name:WxH" renders at that size (the ini Width/Height); a bare Name uses the XML design size. Needs the pre-installed
// Playwright (chromium). Never commit the output or the skin: it is Daybreak / community art.

const fs = require('fs');
const path = require('path');
const { loadSkinModel, readSkinTexture } = require('../apps/mimic/sidlSkin.js');
const SidlRender = require('../apps/mimic/sidlRender.js');

const DEFAULT_OUT = '/tmp/claude-0/-home-user-QuarmBossTracker/ee25763f-05a7-5a49-9c06-997752d27c3e/scratchpad/sidl-preview';
const DEFAULT_SCREENS = ['PlayerWindow', 'TargetWindow', 'GroupWindow', 'BuffWindow', 'HotButtonWnd', 'RaidWindow', 'InventoryWindow', 'ChatWindow'];

function parseArgs(argv) {
  const a = { eq: '', skin: 'default', out: DEFAULT_OUT, scale: 2, screens: DEFAULT_SCREENS.join(','), fill: 0.7 };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, '');
    if (k in a && i + 1 < argv.length) a[k] = argv[++i];
  }
  a.scale = Math.max(1, parseInt(a.scale, 10) || 1);
  a.fill = parseFloat(a.fill);
  return a;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.eq) { console.error('usage: sidl-preview.js --eq <eqDir> --skin <name> [--out dir] [--screens a,b:WxH] [--scale n]'); process.exit(2); }
  const model = loadSkinModel(args.eq, args.skin);
  if (!model.ok) { console.error('load failed:', model.error); process.exit(1); }
  console.log('model', JSON.stringify(model.stats), JSON.stringify(model.dirs));
  fs.mkdirSync(args.out, { recursive: true });

  const jobs = [];
  const texCache = new Map();
  for (const spec of args.screens.split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = /^([^:]+)(?::(\d+)x(\d+))?$/.exec(spec);
    if (!m) continue;
    const name = m[1];
    const scr = model.screens[name];
    if (!scr) { console.warn('no such screen:', name); continue; }
    const sz = (scr.props && scr.props.Size) || {};
    const w = m[2] ? +m[2] : sz.CX, h = m[3] ? +m[3] : sz.CY;
    const need = SidlRender.neededTextures(model, name, w, h, { fakeFill: args.fill });
    for (const t of need) {
      const key = t.toLowerCase();
      if (!texCache.has(key)) {
        const px = readSkinTexture(args.eq, args.skin, t);
        texCache.set(key, px ? { width: px.width, height: px.height, b64: Buffer.from(px.rgba.buffer, px.rgba.byteOffset, px.rgba.byteLength).toString('base64') } : null);
        if (!px) console.warn('  texture not decoded:', t);
      }
    }
    jobs.push({ name, w, h, need, tag: m[2] ? '-' + w + 'x' + h : '' });
  }

  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><html><body style="margin:0;background:#222"></body></html>');
    await page.addScriptTag({ path: path.join(__dirname, '..', 'apps', 'mimic', 'sidlRender.js') });
    for (const job of jobs) {
      const texs = {};
      for (const t of job.need) { const c = texCache.get(t.toLowerCase()); if (c) texs[t] = c; }
      const res = await page.evaluate(({ model, texs, job, scale, fill }) => {
        const textures = {};
        for (const k of Object.keys(texs)) {
          const bin = atob(texs[k].b64);
          const u = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
          textures[k] = { width: texs[k].width, height: texs[k].height, rgba: u };
        }
        const c = window.SidlRender.renderScreen(model, textures, job.name, job.w, job.h, { fakeFill: fill });
        const out = document.createElement('canvas');
        out.width = c.width * scale; out.height = c.height * scale;
        const g = out.getContext('2d');
        g.fillStyle = '#3a3a44';
        g.fillRect(0, 0, out.width, out.height);
        g.imageSmoothingEnabled = false;
        g.drawImage(c, 0, 0, out.width, out.height);
        return { png: out.toDataURL('image/png'), notes: c.sidlLayout.notes.slice(0, 12), cmds: c.sidlLayout.cmds.length };
      }, { model, texs, job, scale: args.scale, fill: args.fill });
      const file = path.join(args.out, args.skin + '-' + job.name + job.tag + '.png');
      fs.writeFileSync(file, Buffer.from(res.png.split(',')[1], 'base64'));
      console.log(file, job.w + 'x' + job.h, res.cmds + ' cmds', res.notes.length ? 'notes: ' + res.notes.join(' | ') : '');
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
