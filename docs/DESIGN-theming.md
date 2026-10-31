# Theming: one token set, a guild theme on top, a raider's look on top of that

**Status: designed 2026-10-31, first drafts in progress.** The guild lead: *"we need to really cleanup the UI … theming is very
important to guilds and it should be a part of our designer as well"*; pick **C** (DECISIONS §488) over daisyUI on the site (A)
or daisyUI everywhere (B). "Our designer" means every surface a raider or officer styles things on: the Canvas builder, UI
Studio, the Overlays tab, the website and the Mimic/dashboard colour scheme.

## 1. Why not a library
daisyUI 5 is built on Tailwind 4 (we are on 3.4.10; daisyUI 4 is the frozen Tailwind-3 line). Its twelve colour roles do not
hold ours: no `gold`, no `dim`, no `border` role, and its `accent` collides with our `accent` by name. Its components bring
rounded corners, padding and transitions that the frontend-design skill rules out for overlays read mid-raid. What it offers
that we lack, a theme as a set of CSS variables under `data-theme`, costs nothing to build ourselves, and the hex values are
already identical across the three surfaces (the skill calls that "a real asset"). So: no new dependency, no Tailwind 4
migration; daisyUI's 35 palettes may be imported later as starting presets (a one-time mapping script).

## 2. The token set
One file, `tokens.css`, the same names on every surface, seeded with today's values so nothing changes on day one:

| Slot | Today | Themable by a guild? |
|---|---|---|
| `--wp-bg` | #0d1117 | yes |
| `--wp-panel` | #161b22 | yes |
| `--wp-border` | #30363d | yes |
| `--wp-text` | #c9d1d9 | yes |
| `--wp-dim` | #6e7681 | yes |
| `--wp-accent` (buttons, links, the brand colour) | #1f6feb | yes |
| `--wp-blue` / `--wp-purple` | #58a6ff / #a371f7 | yes |
| `--wp-green` (good, kill) · `--wp-red` (bad, dead, HP) · `--wp-gold` (DKP, top, warning) · `--wp-orange` | #56d364 · #f85149 · #d29922 · #ffa657 | **no**: meanings, fixed |
| `--wp-font-mono` / `--wp-font-ui` | ui-monospace / system | pick from a short list |
| `--wp-radius` | 6px | yes (4–10px) |
| `--wp-logo` | /wolf.png | yes (URL) |
| `--wp-embed` (Discord embed colour for neutral cards) | 0x5865F2 | yes |

Where it lives per surface: the site (`web/app/tokens.css`, Tailwind colours mapped to `rgb(var(--wp-…) / <alpha-value>)`,
`globals.css` off its hard-coded hex, `<html data-theme="guild">`), the overlays (`apps/mimic/theme.css` loaded by every
overlay window; the 27 files move off raw hex to `var(--wp-…)`; `parts.js`'s colour map reads the same variables), the
dashboard (`dashboard.html`'s `:root`, same names, synced into `WEB_HTML` as always). A ratchet test counts raw hex outside
`tokens.css`/`theme.css` and may only shrink.

## 3. Layering
Built-in defaults → **guild theme** → the raider's own look (`cfg.overlayTheme` filters, colour-blind modes, per-overlay
opacity and backdrop, which overlay sets already save) → per-piece colour in the Canvas. Each layer is a CSS-variable
override on the layer below; nothing rewrites markup. A character's last layout (§468) and named sets keep working because
they store the raider's layer, not the guild's.

## 4. The guild theme
`guild_theme (guild_id primary key, slots jsonb, logo_url, font, embed_color, updated_at)`: one row per guild, officer-edited,
seeded with the defaults. Served: the site reads it in `layout.tsx` and emits the variables on `<html>`; Mimic receives it in
the link-flow identity payload (the bot's `mimic_session` reply) and caches it under `userData/brand/`, with `preload.js`
injecting it as a `wp-theme-guild` body class beside the existing theme filters; the bot's `embedColor()` applies it to the
neutral embeds only (blurple/default), never to the semantic ones. The guild-scope ratchet needs `guild_theme` in
`scripts/guild-tables.json`. The self-host kit's `guild/config.json` gets a `theme` key that the docs already promised and
nothing reads (the §3/§7b claim in `DESIGN-guild-kit.md` is corrected by this file).

## 5. The designer
One theme editor, reached from every surface: an officer page on the site (`/admin/theme`: the slots with a live preview of a
fight card, an overlay row and a Discord card), and in Mimic a read-only "Guild palette" strip in the Canvas colour picker,
the Overlays tab's look section and UI Studio's chrome, each with "your own on top" controls that write the raider's layer.
UI Studio's EverQuest UI packs are a different thing (the game's own files) and are not themed here.

## 6. The feedback loop
Google's Chrome DevTools MCP (Apache-2.0) attaches to a Chromium debug port and gives a session screenshots, computed styles,
the accessibility tree, console and input. In the cloud it attaches to the stand-in overlay server (`scripts/raidmimic-shots/
shoot.mjs`) and the Next dev server; on the guild lead's PC it attaches to the real Mimic launched with
`--remote-debugging-port=9222` (not wired yet; a `--devtools` flag in `main.js` would add it). The sweep runs component by
component with that loop: screenshot, change, screenshot. Adding the server to the repo's `.mcp.json` is the guild lead's call.

## 7. Order of work
1. `tokens.css` + the site's variable layer, visually identical (web, on beta).
2. `apps/mimic/theme.css` + the 27 overlays off raw hex + `parts.js` (Mimic, beta).
3. The dashboard's `:root` on the same names (agent, beta).
4. The ratchet test.
5. `guild_theme` + the bot's identity payload + `embedColor()` + `/admin/theme`.
6. The designer strips in the Canvas, Overlays tab and UI Studio.
7. The component sweep with the DevTools loop, surface by surface, each round as a beta preview.
