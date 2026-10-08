# Platform diagrams

Source of truth for the four interactive diagrams on
[`/platform/architecture`](../../web/app/platform/architecture/page.tsx).

**The JSON here is the source; the HTML in `web/public/platform/` is build
output.** Never hand-edit the HTML — it is a validated artifact and editing it
silently breaks the guarantee that what ships is what passed the checks.

| Source | Type | Renders to |
|---|---|---|
| `platform.architecture.json` | architecture | `web/public/platform/platform.html` |
| `logline.dataflow.json` | dataflow | `web/public/platform/logline.html` |
| `overlays.architecture.json` | architecture | `web/public/platform/overlays.html` |
| `integrations.architecture.json` | architecture | `web/public/platform/integrations.html` |

## Regenerating

Rendered with [archify](https://github.com/tt-a1i/archify) (MIT). It is a tool,
not a dependency — deliberately **not** vendored into `.claude/skills/` the way
`impeccable` and `ponytail` are, because it is 7.5 MB and is only needed when a
diagram changes.

```bash
npx skills add tt-a1i/archify -g          # or: git clone --depth 1 <repo>
cd <archify>/archify
node bin/archify.mjs validate architecture <repo>/docs/diagrams/platform.architecture.json --quality showcase --json
node bin/archify.mjs deliver  architecture <repo>/docs/diagrams/platform.architecture.json \
     <repo>/web/public/platform/platform.html --quality showcase --json
```

⚠ **All four must pass `--quality showcase` with 0 errors and 0 warnings.** A
receipt showing only 4 artifact checks is basic validation, not showcase
acceptance. Do not lower the profile to make a change pass.

## What the renderer taught us, so the next author does not relearn it

- **Crossings are structural, not cosmetic.** A first draft of `overlays` fanned
  3 sources into 9 overlays and produced **22** crossing errors. No amount of
  label nudging fixes that shape; it was rebuilt as sources → one tracker layer →
  four grouped surfaces, which is also the truer picture. Fifteen overlay names
  belong in the page's table, not in the diagram.
- **Labels collide with ROUTES, not just boxes.** The common failure is a
  vertical segment from another connection passing through a horizontal edge's
  label. `labelDx` past the segment fixes it; if two attempts do not, delete the
  label — the sublabels usually already carry the meaning.
- **`dataflow` requires a `label` on every flow** and caps `stages` at 5, so you
  cannot drop a label there. Shorten it instead.
- **Diagonals across stages need `route: "vertical-channel"`.** Straight diagonal
  segments fail `composition/desktop-readability` and cut through nodes.
- **`viewBox` width is a readability lever with a floor.** The check projects
  font size at a 1440px viewport: `projected = source × (930 / viewBoxWidth)`,
  minimum 6px. `logline` needed width ≤ 1085 to clear a 7px sublabel, and ≥ 1068
  for its stages to fit — hence 1076.

## Embedding

The page frames each artifact with `?theme=dark`. Do **not** add `&embed=1`: it
strips the viewer chrome for a clean picture, which also strips the guided views,
legend and cards — the interactivity that is the reason to render through archify
rather than exporting a PNG.
