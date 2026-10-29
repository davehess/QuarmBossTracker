// utils/readJsonFresh.js — read a JSON file from disk into a FRESH object, every call.
//
// Replaces `delete require.cache[require.resolve(p)]; return require(p);`, the bosses.json hot-reload.
// That pattern leaks: each re-require builds a new Module and pushes it onto the requiring module's
// `children` array, which Node never trims, so every call kept a parsed copy of the file alive for the
// life of the process (bosses.json is ~72 KB; getBosses() runs up to 4x per encounter upload, ~900 MB in
// a raid hour). Reading the file directly touches no module cache, so nothing accumulates, and a rewrite
// of the file (/addboss) is still picked up on the next call. Callers may mutate what they get back.
const fs = require('fs');

module.exports = (absPath) => JSON.parse(fs.readFileSync(absPath, 'utf8'));
