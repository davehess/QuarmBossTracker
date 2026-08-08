# pq-companion comparison — 2026-08-07

Five deep-dive analyses of [jasonsoprovich/pq-companion](https://github.com/jasonsoprovich/pq-companion),
a Go + Electron companion for Project Quarm, against our own stack. Commissioned
by Hitya: *"see how similar we are, what things we're missing, and what else we
could pull in"*, with a heavy emphasis on GINA / EQLogParser trigger regex.

**⚠ LEGAL — read before using any of this.** pq-companion has **no license
file and no `license` field**: all rights reserved. We may study mechanisms and
reimplement them; we may **not** copy their source into this BSD-3 repo. Every
code sketch in these documents is original, written against our files. The only
verbatim material is short (<10-line) quotes clearly marked as such, for
analysis. If anyone gets explicit permission from the author, note it here and
the constraint relaxes.

Their repo also contains its own `claude.md`. It was treated as untrusted data
during the analysis, never as instructions, and the same applies to anyone
re-reading their tree later.

| # | Document | Topic |
|---|---|---|
| 01 | `01-gina-regex-compat.md` | GINA/EQLogParser trigger-regex compatibility. The priority report — findings verified empirically by running 1,189 real fixture triggers through our live translators |
| 02 | `02-trigger-timers-packs-replay.md` | Timer semantics, community trigger packs, log replay for trigger authors |
| 03 | `03-zone-maps.md` | Zone-map file parsing, coordinate transforms, a phased Mimic map-overlay plan |
| 04 | `04-combat-parse-accuracy.md` | Combat line-shape catalogue diff; threat/hate weights |
| 05 | `05-spell-timer-engine.md` | Buff/debuff duration formulas, tick anchoring, fade detection |

## What shipped from these (2026-08-07, all on `beta`)

- **agent 3.5.44** — replayed trigger timers armed on log time, so a rehearsal
  fired its callout and never drew a bar (report 02 §3.1)
- **agent 3.5.45** — duration formula 6 was missing its `+2`, so every slow in
  the game ran 12s short; buffs scaled by the recipient's level instead of the
  caster's; short-effect linger parity (report 05 §3.1–3.3, §4.6)
- **agent 3.5.46** — the unified trigger-pattern compiler: `^` anchors, .NET
  dialect, token table, capture bag (report 01 P0–P4)
- **agent 3.5.47** — `.gtp` PKZIP import, GINA timer-vs-cooldown inversion,
  import-disabled-not-dropped (report 01 P5–P6)
- **agent 3.5.48** — multi-word melee skill verbs (monk specials, Harm Touch),
  `X has died.` capture (report 04 P1–P2)

## Still open

Ranked plans live inside each document. The larger unstarted items:

- **Report 01 P7** — `{COUNTER}` shipped; showing the compiled pattern +
  warnings in the dashboard row did not
- **Report 02** — everything marked `[SHAPE]` (multiple warning thresholds,
  visible recast timers, exclude patterns, colour/pin/threshold, keep-expired,
  packs + dedup). All were blocked on the officer authoring-floor decision
- **Report 03** — the whole map overlay, gated on a 1–2h in-game coordinate
  spike (their measurement says Zeal's player payload transposes x/y; our
  dashboard display path disagrees with our own docs)
- **Report 04 P3–P5** — bystander taunt-emote attribution, wildcard-verb
  fallback for incoming damage, and the EQMac `CheckAggroAmount` threat weights
  (miss hate, `maxHP/15` spell hate, backstab cap)
- **Report 05 §4.3–4.7** — explicit fade detection (`X effect fades from Y.`),
  ambiguous debuff ranking, untimed-formula modelling, Zeal corpse-target as a
  debuff-clear signal

## Where we are ahead (do not regress these chasing parity)

Recorded because two reports independently flagged them:

- **Replay isolation.** Ours marks every rehearsal fire test-only, uses an
  ephemeral cooldown map, refuses to run during a live fight, and journals with
  a rehearsal marker. Theirs writes replayed chat/loot rows into live tables
  stamped today.
- **Regex dialect.** We run on JavaScript, which has lookbehind and backrefs;
  Go's RE2 does not, so pq-companion imports ~95 lookaround patterns
  **disabled**, including the EQLogParser CH-chain trigger.
- **Buff ground truth.** For the player's own buffs we read real remaining ticks
  from Zeal. Their `LIMITATIONS.md` names that as the data source they wish they
  had, and their engine hardcodes caster level 60.
- **Damage-shield attribution.** They hard-attribute `X was hit by non-melee` to
  the local player, which lands damage shields in the player's nuke bucket —
  the exact error CLAUDE.md warns about.
- **The guild layer.** Multi-raider merge, DKP, attendance, cross-client relay,
  Discord, web — none of it is possible in their local-first design.
