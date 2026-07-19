#!/usr/bin/env node
// scripts/research-helper.mjs — LOCAL dev aid (NOT shipped to any user, not
// imported by the bot). A Gemini "sub-agent" Claude can call when it's
// rate-limited, can't reach a site from its sandbox, or needs an image.
//
// Zero dependencies (Node 18+ global fetch). Keys come from the environment and
// are NEVER committed. See docs/RESEARCH-HELPER.md for setup + mobile key steps.
//
// Two keys are supported so a rate-limited key fails over to the second
// (e.g. personal Google account primary, Workspace account fallback):
//   GEMINI_API_KEY      (required)
//   GEMINI_API_KEY_2    (optional fallback — doubles free-tier headroom)
// Optional: GEMINI_MODEL (default gemini-2.5-flash), GEMINI_IMAGE_MODEL.
//
// Usage:
//   node scripts/research-helper.mjs "your question"            # grounded research + sources
//   node scripts/research-helper.mjs --image "a wolf sigil" out.png
//   node scripts/research-helper.mjs --json "question"          # raw API JSON
//
// NOTE: the managed cloud Claude-Code env blocks egress to
// generativelanguage.googleapis.com (proxy 403) — run this from a LOCAL session.

const KEYS = [process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY_2].filter(Boolean);
const TEXT_MODEL  = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

if (!KEYS.length) {
  console.error('No Gemini key. Set GEMINI_API_KEY (and optionally GEMINI_API_KEY_2).');
  console.error('See docs/RESEARCH-HELPER.md for how to mint one on mobile.');
  process.exit(2);
}

// Try each key in turn; retry the next one on quota/transient errors, surface
// hard errors (bad request, bad key) immediately with the API's own message.
async function callGemini(model, body) {
  let lastErr = 'no keys';
  for (const key of KEYS) {
    const res = await fetch(`${BASE}/${model}:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch((e) => ({ ok: false, status: 0, _err: e }));
    if (res.ok) return res.json();
    lastErr = `HTTP ${res.status}` + (res._err ? ` (${res._err.message})` : '');
    if (![429, 403, 500, 503, 0].includes(res.status)) {
      const txt = res.text ? await res.text().catch(() => '') : '';
      throw new Error(`${lastErr} ${txt}`.slice(0, 600));
    }
    // otherwise fall through to the next key
  }
  throw new Error(`All Gemini keys exhausted — ${lastErr}`);
}

async function research(question, asJson) {
  const data = await callGemini(TEXT_MODEL, {
    contents: [{ parts: [{ text: question }] }],
    tools: [{ google_search: {} }],   // Google-grounded (renamed from google_search_retrieval in 2.x)
  });
  if (asJson) { console.log(JSON.stringify(data, null, 2)); return; }
  const cand = data.candidates?.[0];
  const text = (cand?.content?.parts || []).map((p) => p.text).filter(Boolean).join('\n') || '(no text returned)';
  console.log(text);
  const cites = [...new Set((cand?.groundingMetadata?.groundingChunks || []).map((c) => c.web?.uri).filter(Boolean))];
  if (cites.length) {
    console.log('\nSources:');
    for (const u of cites) console.log('  - ' + u);
  }
}

async function image(prompt, outfile) {
  const fs = await import('node:fs');
  const data = await callGemini(IMAGE_MODEL, {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
  });
  const parts = data.candidates?.[0]?.content?.parts || [];
  const img = parts.find((p) => p.inlineData?.data);
  if (!img) {
    console.error('No image in the response. Likely causes: image model needs billing enabled on');
    console.error('the account, or GEMINI_IMAGE_MODEL is not an image-capable model. Raw:');
    console.error(JSON.stringify(data).slice(0, 500));
    process.exit(1);
  }
  const out = outfile || `gemini-image-${process.pid}.png`;
  fs.writeFileSync(out, Buffer.from(img.inlineData.data, 'base64'));
  console.log('Saved', out, `(${Math.round(img.inlineData.data.length * 0.75 / 1024)} KB)`);
}

const argv = process.argv.slice(2);
(async () => {
  try {
    if (argv[0] === '--image') await image(argv[1], argv[2]);
    else if (argv[0] === '--json') await research(argv.slice(1).join(' '), true);
    else if (argv.length) await research(argv.join(' '), false);
    else { console.error('Usage: research-helper.mjs "question" | --image "prompt" [out.png] | --json "question"'); process.exit(2); }
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
})();
