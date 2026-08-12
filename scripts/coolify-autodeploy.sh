#!/bin/bash
# Poll GitHub for new commits and trigger a Coolify deploy of the local mirror.
#
# WHY POLLING AND NOT A WEBHOOK. Coolify's normal auto-deploy is a GitHub webhook,
# which needs GitHub to REACH the Coolify instance. Ours lives on a LAN VM with no
# public address, and the fix for that — exposing port 8000 or a Tailscale Funnel —
# puts a dashboard that deploys containers on the open internet. Polling keeps the
# whole thing outbound-only: nothing inbound, no tunnel, no exposure.
#
# WHY THE MIRROR IS WORTH AUTO-DEPLOYING AT ALL. It is the only place we run the
# site outside Vercel, which makes it the canary for Vercel-masked bugs. Exactly
# one such bug shipped undetected for months: every auth redirect was built from
# `new URL(req.url).origin`, which resolves to localhost in a container — invisible
# on Vercel because its proxy rewrites the request (fixed in web 1.1.41). A mirror
# that tracks main automatically catches the next one; a mirror that needs a manual
# click drifts and catches nothing.
#
# INSTALL (on the Coolify VM, as root):
#   1. Read-only repo access so we can ask GitHub for the current SHA:
#        ssh-keygen -t ed25519 -f /root/.ssh/wolfpack_ro -N '' -C autodeploy
#        cat /root/.ssh/wolfpack_ro.pub
#      → GitHub → repo → Settings → Deploy keys → Add (leave write access OFF).
#      This is a SECOND key, separate from Coolify's own; revoking one must never
#      lock out the other.
#   2. Coolify → Keys & Tokens → API Tokens → create one (read+write).
#   3. Coolify → your app → Webhooks tab → copy the "Deploy Webhook" URL. Copy it
#      rather than hand-writing the endpoint — it already contains the app uuid,
#      and the API path has changed between Coolify versions.
#   4. Write /etc/coolify-autodeploy.conf (chmod 600):
#        DEPLOY_URL="http://localhost:8000/api/v1/deploy?uuid=xxxxxxxx&force=false"
#        API_TOKEN="1|xxxxxxxxxxxxxxxx"
#        REPO="git@github.com:davehess/QuarmBossTracker.git"
#        BRANCH="main"
#   5. Install the timer:
#        cp scripts/systemd/coolify-autodeploy.* /etc/systemd/system/
#        systemctl daemon-reload
#        systemctl enable --now coolify-autodeploy.timer
#   6. Watch it:  journalctl -u coolify-autodeploy -f
#
# Run it once by hand first (`bash scripts/coolify-autodeploy.sh`) — it prints what
# it would do and exits non-zero on any misconfiguration.

set -euo pipefail

CONF="${CONF:-/etc/coolify-autodeploy.conf}"
STATE_DIR="${STATE_DIR:-/var/lib/coolify-autodeploy}"
SSH_KEY="${SSH_KEY:-/root/.ssh/wolfpack_ro}"

[ -r "$CONF" ] || { echo "missing $CONF — see the header of this script"; exit 1; }
# shellcheck disable=SC1090
. "$CONF"

for v in DEPLOY_URL API_TOKEN REPO BRANCH; do
  [ -n "${!v:-}" ] || { echo "$CONF is missing $v"; exit 1; }
done
[ -r "$SSH_KEY" ] || { echo "missing $SSH_KEY (read-only deploy key)"; exit 1; }

mkdir -p "$STATE_DIR"
STATE="$STATE_DIR/last-sha"

# Ask GitHub what the branch head is. ls-remote is one round trip and no clone.
REMOTE_SHA="$(GIT_SSH_COMMAND="ssh -i $SSH_KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new" \
  git ls-remote "$REPO" "refs/heads/$BRANCH" | cut -f1)"

if [ -z "$REMOTE_SHA" ]; then
  echo "could not read refs/heads/$BRANCH from $REPO — key not authorised, or branch renamed"
  exit 1
fi

LAST_SHA="$(cat "$STATE" 2>/dev/null || echo none)"

if [ "$REMOTE_SHA" = "$LAST_SHA" ]; then
  echo "up to date at ${REMOTE_SHA:0:8}"
  exit 0
fi

echo "new commit on $BRANCH: ${LAST_SHA:0:8} -> ${REMOTE_SHA:0:8} — deploying"

# Record the SHA on a successful HANDOFF, not on a successful build. If the build
# itself fails that is a real failure to look at, and re-triggering the same broken
# commit every 5 minutes would bury the logs and hammer the VM. A fix is a new
# commit, which this picks up on the next tick anyway.
HTTP_CODE="$(curl -sS -o /tmp/coolify-autodeploy.out -w '%{http_code}' \
  -X GET -H "Authorization: Bearer $API_TOKEN" "$DEPLOY_URL" || echo 000)"

if [ "$HTTP_CODE" = "405" ] || [ "$HTTP_CODE" = "404" ]; then
  # Older/newer Coolify builds disagree on the verb; try the other one before
  # calling it a failure.
  HTTP_CODE="$(curl -sS -o /tmp/coolify-autodeploy.out -w '%{http_code}' \
    -X POST -H "Authorization: Bearer $API_TOKEN" "$DEPLOY_URL" || echo 000)"
fi

BODY="$(cat /tmp/coolify-autodeploy.out 2>/dev/null || true)"

case "$HTTP_CODE" in
  2*)
    echo "$REMOTE_SHA" > "$STATE"
    echo "deploy accepted (HTTP $HTTP_CODE): $BODY"
    ;;
  401|403)
    echo "Coolify rejected the API token (HTTP $HTTP_CODE): $BODY"; exit 1 ;;
  000)
    echo "could not reach Coolify at all — is it running?"; exit 1 ;;
  *)
    echo "deploy trigger failed (HTTP $HTTP_CODE): $BODY"; exit 1 ;;
esac
