#!/usr/bin/env bash
# SessionStart digest — the "read it back" half of the docs-as-memory pattern.
#
# Every session (desktop or cloud) opens knowing the current state instead of
# rediscovering it. Deliberately CHEAP and deterministic: it prints pointers
# and the open-items table, not a summary — no model call, no latency, nothing
# to go stale or hallucinate. Deep retrieval is /recall, which does use a
# subagent.
#
# Never fails a session: every read is guarded, and it exits 0 regardless.
set -uo pipefail
cd "$(dirname "$0")/../.." 2>/dev/null || exit 0

echo "## Project memory (auto-loaded at session start)"
echo
echo "Durable state lives in committed docs, never in chat — this repo is worked"
echo "on by BOTH local desktop and cloud sessions, which cannot share a"
echo "conversation. Read the file before concluding anything is missing."
echo

# ── Open decisions + the inbox waiting to be merged ─────────────────────────
if [ -f docs/decisions/OPEN.md ]; then
  echo "### Open decisions — \`docs/decisions/OPEN.md\`"
  echo
  # The open-items table is the highest-value block; print it and nothing else,
  # so the digest stays short enough to always be read.
  awk '/^\| /{flag=1} flag' docs/decisions/OPEN.md | head -40
  echo
  INBOX_FILES="$(ls -1 docs/decisions/inbox/*.md 2>/dev/null | sort)"
  if [ -n "$INBOX_FILES" ]; then
    OLDEST="$(basename "$(echo "$INBOX_FILES" | head -1)" .md)"
    echo "_Decision inbox: $(echo "$INBOX_FILES" | wc -l | tr -d ' ') file(s), oldest $OLDEST. Merge weekly: \`npm run decisions:merge\`._"
  fi
  echo "_All decisions by feature set, with the ID index: \`docs/decisions/README.md\`._"
  echo
fi

# ── Durable index ───────────────────────────────────────────────────────────
echo "### Where things live"
echo
echo "| File | What it answers |"
echo "|---|---|"
echo "| \`CLAUDE.md\` | architecture, release routing, scope boundaries — wins over README |"
echo "| \`docs/HOW-ITS-BUILT.md\` | feature → file + surface index. Read BEFORE saying \"we don't have that\" |"
echo "| \`docs/STATUS.md\` | status ledger + durable queue, incl. ⚠ needs-a-local-session items |"
[ -d docs/pq-companion ] && echo "| \`docs/pq-companion/\` | competitor analysis + ranked adaptation plans (unlicensed — reimplement, never copy) |"
echo "| private briefing → **Branch inventory** tab | what each branch/channel carries, what waits on a pick, release heads — ask \`/recall\` |"
echo

# ── Live component versions, straight from the source of truth ──────────────
ver() { [ -f "$1" ] && grep -m1 '"version"' "$1" 2>/dev/null | sed 's/.*: *"//; s/".*//'; }
echo "### Versions on this branch (\`$(git branch --show-current 2>/dev/null || echo '?')\`)"
echo
echo "bot $(ver package.json) · agent $(ver packages/wolfpack-logsync/package.json) · mimic $(ver apps/mimic/package.json) · web $(ver web/package.json)"
echo
echo "_Versions live in package.json only — never in docs._"
exit 0
