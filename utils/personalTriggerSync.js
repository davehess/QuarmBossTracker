// utils/personalTriggerSync.js — shape checks for the personal-trigger sync store
// (POST /api/agent/personal-triggers/push). Pure functions; the routes live in index.js.
//
// A push carries the member's personal triggers plus their per-user "what you hear" rules:
//   rules = { "<key>": { "*" | "<character>": "speak" | "overlay" | "off" } }
// Compiled/internal fields on a trigger (every `_`-prefixed key: _regex, _scope, ...) are
// stripped — they are rebuilt by the agent on load and a RegExp does not round-trip JSON.

'use strict';

const MAX_BODY_BYTES = 512 * 1024;
const MAX_TRIGGERS   = 2000;
const KEEP_PER_OWNER = 20;
const MODES = new Set(['speak', 'overlay', 'off']);
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Returns { ok: true, triggers, rules } (cleaned copies) or { ok: false, error }.
function validatePush(body) {
  if (!isPlainObject(body)) return { ok: false, error: 'body must be an object' };
  const { triggers, rules } = body;
  if (!Array.isArray(triggers)) return { ok: false, error: 'triggers must be an array' };
  if (triggers.length > MAX_TRIGGERS) return { ok: false, error: `too many triggers (max ${MAX_TRIGGERS})` };
  if (!isPlainObject(rules)) return { ok: false, error: 'rules must be an object' };

  const cleanTriggers = [];
  for (let i = 0; i < triggers.length; i++) {
    if (!isPlainObject(triggers[i])) return { ok: false, error: `triggers[${i}] must be an object` };
    const t = {};
    for (const [k, v] of Object.entries(triggers[i])) {
      if (k.startsWith('_') || BAD_KEYS.has(k)) continue;
      t[k] = v;
    }
    cleanTriggers.push(t);
  }

  const cleanRules = {};
  for (const [key, perChar] of Object.entries(rules)) {
    if (BAD_KEYS.has(key)) return { ok: false, error: `bad rule key "${key}"` };
    if (!isPlainObject(perChar)) return { ok: false, error: `rules["${key}"] must be an object` };
    const out = {};
    for (const [who, mode] of Object.entries(perChar)) {
      if (BAD_KEYS.has(who)) return { ok: false, error: `bad character key "${who}" in rules["${key}"]` };
      if (!MODES.has(mode)) return { ok: false, error: `rules["${key}"]["${who}"] must be speak, overlay or off` };
      out[who] = mode;
    }
    cleanRules[key] = out;
  }
  return { ok: true, triggers: cleanTriggers, rules: cleanRules };
}

module.exports = { validatePush, MAX_BODY_BYTES, MAX_TRIGGERS, KEEP_PER_OWNER, MODES };
