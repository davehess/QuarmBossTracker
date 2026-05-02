# discord-agent-bridge — Setup for QuarmBossTracker

## What it does
Runs Claude Code inside a tmux session and streams output to a Discord channel in your server.
This lets you monitor/review a Claude session from your phone or Discord.

## Prerequisites
- tmux 3.0+
- Node.js 18+
- A **separate** Discord bot token (NOT the Quarm bot token — this is a different bot)

## One-time install
```bash
npm install -g discord-agent-bridge
agent-discord setup YOUR_SECOND_BOT_TOKEN
# It will auto-detect your guild ID
```

## Starting a session on this repo
```bash
cd /path/to/QuarmBossTracker
agent-discord go claude       # creates a Discord channel, launches Claude Code in tmux
agent-discord go --yolo       # skip permission prompts
```

## Attaching / detaching
```bash
agent-discord attach          # attach to the tmux pane (Ctrl-b d to detach)
agent-discord stop            # kill session, delete the Discord channel
```

## Notes
- The daemon uses port 18470 locally by default
- Discord channel is auto-created per project, auto-deleted on stop
- Config lives in ~/.discord-agent-bridge/config.json
- This bot needs: Send Messages, Manage Channels, Read Message History, Embed Links, Add Reactions
