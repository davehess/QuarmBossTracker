// Builds the replay capture harness: bundles entry.tsx (the real ReplayBoard) with rolldown and its CSS with Tailwind.
//
//   REPLAY_DEPS=<dir holding node_modules with react, react-dom, three, tailwindcss, postcss, autoprefixer> \
//   ROLLDOWN_DIR=<dir whose node_modules holds rolldown> node scripts/raidmimic-shots/replay/build.mjs <out-dir>
//
// web/ has no node_modules in a cloud checkout, so the libraries come from REPLAY_DEPS (install once:
//   npm i --prefix <dir> react@18.3.1 react-dom@18.3.1 three@0.169.0 tailwindcss@3.4.10 postcss@8 autoprefixer@10)
// and rolldown from ROLLDOWN_DIR (the repo root's devDependency). Writes <out-dir>/replay.js, spectator.js and replay.css.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, '../../../web');
const DEPS = process.env.REPLAY_DEPS;
const RD = process.env.ROLLDOWN_DIR || path.resolve(HERE, '../../..');
if (!DEPS) throw new Error('set REPLAY_DEPS to the folder holding node_modules (see the header)');
const OUT = path.resolve(process.argv[2] || path.join(HERE, 'out'));
fs.mkdirSync(OUT, { recursive: true });

const rd = createRequire(path.join(RD, 'x.js'))('rolldown');
for (const [entry, file] of [['entry.tsx', 'replay.js'], ['spectator-entry.tsx', 'spectator.js']]) {
  await rd.build({
    input: path.join(HERE, entry),
    cwd: WEB,
    output: { file: path.join(OUT, file), format: 'iife', codeSplitting: false },
    resolve: {
      alias: { '@web': WEB, '@': WEB, 'next/dynamic': path.join(HERE, 'dynamic-shim.tsx') },
      modules: [path.join(DEPS, 'node_modules'), 'node_modules'],
    },
    transform: { jsx: { runtime: 'automatic' }, define: { 'process.env.NODE_ENV': '"production"' } },
    logLevel: 'warn',
  });
}

// Tailwind reads the classes the board and its children use; tokens.css + globals.css are the site's own.
const dreq = createRequire(path.join(DEPS, 'node_modules', 'x.js'));
const postcss = dreq('postcss');
const tailwind = dreq('tailwindcss');
const autoprefixer = dreq('autoprefixer');
// tailwind.config.ts is TypeScript; its content globs and colour map are restated here (kept in step by eye, it is a capture tool).
const tw = tailwind({
  content: [path.join(WEB, 'app/**/*.{ts,tsx}'), path.join(WEB, 'components/**/*.{ts,tsx}')],
  theme: { extend: { colors: Object.fromEntries(['bg', 'panel', 'border', 'text', 'dim', 'blue', 'gold', 'green', 'red', 'orange', 'purple', 'accent']
    .map((n) => [n, `rgb(var(--wp-${n}) / <alpha-value>)`])), fontFamily: { mono: ['var(--wp-font-mono)'] } } },
});
const src = fs.readFileSync(path.join(WEB, 'app/globals.css'), 'utf8').replace("@import './tokens.css';", fs.readFileSync(path.join(WEB, 'app/tokens.css'), 'utf8'));
const css = await postcss([tw, autoprefixer]).process(src, { from: path.join(WEB, 'app/globals.css') });
fs.writeFileSync(path.join(OUT, 'replay.css'), css.css);
console.log('built', OUT);
