// test/_source-slice.js — helpers for the "source-slice" fidelity tier.
//
// Two of this platform's components are single giant files whose internal
// helpers aren't (and shouldn't be) exported: the bot monolith `index.js`
// (~13k lines — require()-ing it boots the Discord client) and the zero-dep
// agent `packages/wolfpack-logsync/index.js` (single-file by design). To
// characterize a pure function embedded in one of those WITHOUT importing the
// whole file or copying the logic, we read the real source and eval just the
// target block. This keeps the test coupled to the SHIPPED code: edit the
// function and the test exercises the new behavior; rename or delete it and the
// slice throws loudly (a red test, not a silent pass on a stale copy).
//
// NOT a spec file (no `.test.`/`.spec.` — vitest won't collect it).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BOT_INDEX   = path.join(ROOT, 'index.js');
export const AGENT_INDEX = path.join(ROOT, 'packages', 'wolfpack-logsync', 'index.js');

export function readSource(absPath) {
  return fs.readFileSync(absPath, 'utf8');
}

// Slice from `startMarker` through the FIRST `endMarker` at/after it (inclusive).
// Returns the raw source substring so a caller can eval it.
export function sliceBlock(src, startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  if (start < 0) throw new Error(`source-slice: start marker not found: ${JSON.stringify(startMarker)}`);
  const endAt = src.indexOf(endMarker, start);
  if (endAt < 0) throw new Error(`source-slice: end marker not found: ${JSON.stringify(endMarker)}`);
  return src.slice(start, endAt + endMarker.length);
}

// Eval a sliced statement block and return the named bindings it declares.
// `exportNames` are the identifiers the block defines that the caller wants back.
export function evalBlock(block, exportNames) {
  const ret = `\nreturn { ${exportNames.join(', ')} };`;
  // eslint-disable-next-line no-new-func
  return new Function(block + ret)();
}

// Extract a top-level `const NAME = [ ... ];` array literal from source and eval
// it to the real array (of e.g. RegExp). Bounds on `\n];` so char classes ("]")
// inside the elements don't prematurely close it.
export function sliceArrayLiteral(src, declMarker) {
  const decl = src.indexOf(declMarker);
  if (decl < 0) throw new Error(`source-slice: array decl not found: ${JSON.stringify(declMarker)}`);
  const open = src.indexOf('[', decl);
  const close = src.indexOf('\n];', open);
  if (open < 0 || close < 0) throw new Error(`source-slice: array bounds not found: ${JSON.stringify(declMarker)}`);
  const text = src.slice(open, close) + '\n]';
  // eslint-disable-next-line no-new-func
  return new Function('return ' + text)();
}
