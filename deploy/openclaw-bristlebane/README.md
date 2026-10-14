# Bristlebane chat agent (OpenClaw) on Tower

The Bristlebane persona as a Discord chat agent: OpenClaw's gateway in one container on Tower's Coolify, its model
on V5's local model server over the LAN. Separate from the raid **voice** bot (`apps/bristlebane`, which runs as
the Discord application "miMIC"). Decisions: `docs/DECISIONS-2026-09-21.md` §323, §325.

## Why it moved, and the real fix
On V5 it died with "Auto-compaction could not recover this turn … set `reserveTokensFloor` to 20000". That hint
is stale: the floor already defaulted to 20000, and from OpenClaw 2026.8 the key is removed (setting it stops the
gateway). The overflow comes from one large tool result or a context window smaller than declared. The seed
config fixes the causes: `tools.profile: "messaging"`, an honest `contextWindow` matched to `num_ctx`,
`midTurnPrecheck`, smaller bootstrap caps.

## Deploy (Coolify)
1. New Resource → Docker Compose, from this repo, branch `main`, Base Directory `/deploy/openclaw-bristlebane`,
   Compose Location `/docker-compose.yml`. Turn on **Preserve repository during deployment**. No domain, no ports.
2. Environment (Coolify blocks the deploy until the required ones are set):
   - `DISCORD_BOT_TOKEN` — the **Bristlebane** application's token (not miMIC's). Reset it in the Developer
     Portal after V5's gateway is stopped and paste only the new one.
   - `OPENCLAW_GATEWAY_TOKEN` — `openssl rand -hex 32`.
   - `OLLAMA_BASE_URL` — `http://<v5-lan-address>:11434` (no `/v1`).
   - optional `OPENCLAW_IMAGE_TAG` (default `2026.10.3`), `OPENCLAW_TZ`.
3. Before the first deploy, fill the `<…>` ids in `openclaw.seed.json5` (application id, operator id, guild id,
   chat channel id, model tag). The seed is copied once; later edits go in the live config in the volume.
4. Enable the **Message Content** intent on the Bristlebane application.

## On V5 first
- Stop the old gateway so two never answer at once: `openclaw gateway stop`, then `openclaw gateway uninstall`
  (or `schtasks /Delete /F /TN "OpenClaw Gateway"`).
- Model server on the LAN: Ollama → `OLLAMA_HOST=0.0.0.0:11434` and `OLLAMA_CONTEXT_LENGTH=65536` (or set the
  same in LM Studio's load settings), and a Windows Firewall rule allowing TCP 11434 from the Coolify VM. The
  `contextWindow` in the seed must equal what the server really runs.
- Copy over only the persona files (`SOUL.md`, `AGENTS.md`, `IDENTITY.md`) into the container's
  `/home/node/.openclaw/workspace/`; start with fresh sessions (the wedged one is what failed). Never copy V5's
  `.env`, logs, `node_modules`, lock files or another tool's auth folders.

## Check
`docker exec` (or Coolify's terminal) into the gateway: `openclaw --version`, `openclaw doctor`, then in Discord
`/status` and `/context detail` to see where the tokens go.
