// Root ESLint config — a deliberately narrow `no-undef` tripwire for the two
// giant single-file components (the bot monolith + the zero-dep agent).
//
// Why this exists: undeclared globals in `index.js` / the agent (e.g. the
// past `_mtLiveStateByName` outage) ship silently — Node only throws when the
// offending line executes. `no-undef` catches them statically.
//
// Scope discipline (see task #71): no-undef is the ONLY rule. Do NOT add
// style rules or no-unused-vars — the goal is a zero-noise gate, not a
// linting-culture change. The web/ app has its own ESLint; this config never
// touches it.
'use strict';

const globals = require('globals');

module.exports = [
  {
    files: [
      'index.js',
      'commands/**/*.js',
      'utils/**/*.js',
      'packages/wolfpack-logsync/index.js',
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...globals.es2022,
        // `fetch` is a real global on Node 20 but not yet in the `node`
        // preset for the ecmaVersion we pin; declare it explicitly.
        fetch: 'readonly',
      },
    },
    rules: {
      'no-undef': 'error',
    },
  },
];
