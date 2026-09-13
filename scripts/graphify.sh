#!/usr/bin/env bash
# Rebuild the graphify code graph of this repo in ~30s. Outputs land in
# ./graphify-out/ (gitignored) so `graphify explain`, `graphify path` and
# `python -m graphify.serve graphify-out/graph.json` work from the repo root.
#
# Decided 2026-09-13 (Hitya): keep the regen script, keep the outputs OUT of
# the repo (graph.json is ~15 MB and regenerates faster than it merges), and
# do NOT run `graphify claude install` — its "query the graph before reading
# files" hook is the opposite of the lesson that week (read the block, not the
# hits). The graph answers "who calls X / what does X reach"; it does not see
# config keys threaded through code, data contracts across HTTP/pipe
# boundaries, or preprocessor-disabled C++. docs/DECISIONS-2026-09-10.md.
#
# What it graphs: the TRACKED tree (git archive HEAD), so node_modules, .next
# and untracked files never leak in, minus the two vendored third-party skills
# (they otherwise show up as our top hubs). SQL grammar included so the
# migrations count. Code-only: no LLM, no API key.
#
#   bash scripts/graphify.sh            # rebuild
#   bash scripts/graphify.sh --portable # also write graph.portable.html
#                                       # (vis-network from jsdelivr, for
#                                       # publishing as a claude.ai artifact)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORTABLE=0
for a in "$@"; do case "$a" in --portable) PORTABLE=1 ;; *) echo "unknown arg: $a" >&2; exit 2 ;; esac; done

export PATH="$HOME/.local/bin:$PATH"
if ! command -v graphify >/dev/null 2>&1; then
  echo "[graphify] installing graphifyy[sql] (PyPI package name has the double y)"
  if command -v uv >/dev/null 2>&1; then uv tool install "graphifyy[sql]" >/dev/null
  elif command -v pipx >/dev/null 2>&1; then pipx install "graphifyy[sql]" >/dev/null
  else python3 -m pip install --user --quiet "graphifyy[sql]"; fi
fi
python3 -c "import tree_sitter_sql" 2>/dev/null || python3 -m pip install --user --quiet "graphifyy[sql]" || true

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
git -C "$ROOT" archive HEAD | tar -x -C "$WORK"
rm -rf "$WORK/.claude/skills/impeccable" "$WORK/.claude/skills/ponytail"

( cd "$WORK" && graphify update . --force 2>&1 | grep -v 'AST extraction:' )

rm -rf "$ROOT/graphify-out"
cp -r "$WORK/graphify-out" "$ROOT/graphify-out"
# The manifest/cache carry the temp path; the report header does too — cosmetic.
sed -i "s#$WORK#<repo>#g" "$ROOT/graphify-out/GRAPH_REPORT.md" 2>/dev/null || true

if [ "$PORTABLE" = 1 ]; then
  python3 - "$ROOT/graphify-out" <<'PY'
import re, sys
out = sys.argv[1]
src = open(f'{out}/graph.html', encoding='utf-8').read()
head = re.search(r'<head>(.*?)</head>', src, re.S).group(1)
body = re.search(r'<body[^>]*>(.*?)</body>', src, re.S).group(1)
head = re.sub(r'<title>[^<]*</title>', '<title>Wolf Pack Code Graph</title>', head, count=1)
head = head.replace('https://unpkg.com/vis-network@9.1.6/standalone/umd/vis-network.min.js',
                    'https://cdn.jsdelivr.net/npm/vis-network@9.1.6/standalone/umd/vis-network.min.js')
head = re.sub(r'<meta[^>]*charset[^>]*>\s*', '', head)
open(f'{out}/graph.portable.html', 'w', encoding='utf-8').write(head.strip() + '\n' + body.strip() + '\n')
print('[graphify] graph.portable.html written (jsdelivr, no document wrapper)')
PY
fi

echo
echo "[graphify] outputs in graphify-out/ (gitignored): graph.html · GRAPH_REPORT.md · graph.json"
awk '/^## Summary/,/^## Community Hubs/' "$ROOT/graphify-out/GRAPH_REPORT.md" | sed '$d'
awk '/^## God Nodes/,/^## Surprising/' "$ROOT/graphify-out/GRAPH_REPORT.md" | sed '$d'
awk '/^## Import Cycles/,/^## Communities/' "$ROOT/graphify-out/GRAPH_REPORT.md" | sed '$d'
echo "Ask it:  graphify explain '<symbol>'   ·   graphify path '<A>' '<B>'"
