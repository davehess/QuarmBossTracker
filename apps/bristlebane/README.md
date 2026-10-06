# Bristlebane

Wolf Pack's raid-voice bot. A **separate Discord application** (its own bot token) that runs as its own
container on the guild's home server, under Coolify. It is not part of the main bot (`/index.js`, Railway) and
talks to it through exactly one HTTP call.

**Phase 1 (this folder):** join the raid voice channel while a raid is live, announce itself, leave when the
raid is over, and record the members who **opted in** — nobody else. Members control it with `/bristlebane`.
No speech yet.

## Recording is opt-in only

The guild lead's call (2026-10-05): *"we don't need to have voices in from those that don't consent."* So:

- **Nobody is recorded until they run `/bristlebane optin`.** There is no mode that records everyone who has
  not objected; `RECORD_MODE=optout` is refused at boot.
- Someone who has not opted in is not decrypted, not subscribed to and not named anywhere: no audio, no
  `session.json` entry, no event.
- Opting out stops the recording at once **and deletes what was recorded of you tonight**. `forget` opts you
  out and deletes everything, all nights.
- Video is not Bristlebane's job; it comes from members' own recordings.

### The command

Guild-scoped (registered to `DISCORD_GUILD_ID` at every boot, idempotent). **Every reply is ephemeral.**

| | |
|---|---|
| `/bristlebane optin` | record my voice from now on. Takes effect on the session in progress at your next utterance |
| `/bristlebane optout` | stop recording me now **and delete what was recorded of me tonight** (the session in progress and tonight's earlier ones) |
| `/bristlebane forget` | opt me out and delete **every** recording of me, all nights — asks to confirm with a button first |
| `/bristlebane status` | am I opted in · is Bristlebane recording right now · how many in the channel are opted in |

"Tonight" is the bot's night key from the latest `raid-live` answer (a night runs through the small hours),
plus the night the session in progress is recording into.

**Deleting** (`forgetUser` in `lib.js`): removes `<userId>.opusraw` from every session folder and the person's
name **and their speaking events** from each `session.json` (rewritten atomically). A `session.json` that will
not parse is left as it was and counted. The session being recorded right now is cleaned through the recorder
itself (it keeps its own copy of `session.json` and would otherwise write the person straight back). One log
line per deletion, with the user id and counts, no name.

**The consent store** is `${RECORDINGS_DIR}/../consent.json` — `{ "optin": ["<userId>", …], "updatedAt": "<ISO>" }`
— kept next to the recordings folder so wiping recordings never wipes who said yes. The commands write it
atomically (temp file + rename) on every change. A missing file is an empty list. A file that exists but cannot
be parsed means **nobody is recorded** and opt-in refuses to write over it (an opt-out still takes effect in
memory). `/bristlebane optin` is the way to edit it; a hand edit is picked up at the next join.

### What the room sees

On join, the bot posts to `RAID_CHAT_CHANNEL_ID` (when set):

> 🎙 Bristlebane is in 🔊 #raid-voice. Recording only members who opted in — N of M here. Want in? /bristlebane optin. Change your mind any time: /bristlebane optout or /bristlebane forget.

Its nickname is **`[REC] Bristlebane`** only while at least one opted-in member is in the channel, plain
`Bristlebane` otherwise (it follows people joining, leaving and opting in or out; reset on leave and at boot).
With `RECORD_MODE=off` the notice says "(not recording)". The wording lives in `lib.js` (`joinNotice`).

## What it does

Every `POLL_SECONDS` it asks the main bot `GET {BOT_API_URL}/raid-live` and decides:

| | Rule |
|---|---|
| **Join** | the raid reads **live on 2 polls in a row**, an officer has **not** pressed End raid, **and** at least one human is in the raid voice channel |
| **Leave**, whichever comes first | an officer pressed **End raid** · **not live for 10 minutes** straight · **no human in the channel for 5 minutes** straight · the bot API **unreachable for 10 minutes** |
| API unreachable | never joins; if already in, it stays (clocks frozen) for up to 10 minutes, so a bot restart on a raid night does not drop the channel |

"Live" is the main bot's own call: at least `RAID_TRACK_MIN_PLACED` (default 6) raiders placed by the roster
uploads in the last few seconds. The roster stays live after End raid (everyone is still logged in), which is
why `ended` also blocks the *join*. The rule is `decide()` in `lib.js`; one log line per decision
(`[live] join: placed=14 humans=9`, `[live] leave: not live 10m`).

While recording is on the bot is **undeafened** (an opted-in member can speak at any moment); otherwise it
joins deafened. It is always muted.

## Settings (names only — values go in Coolify, never in the repo)

| Variable | | |
|---|---|---|
| `BRISTLEBANE_TOKEN` | required | the bot token of the Bristlebane application |
| `DISCORD_GUILD_ID` | required | the guild (also where `/bristlebane` is registered) |
| `RAID_VOICE_CHANNEL_ID` | required | the channel to join |
| `BOT_API_URL` | required | the main bot's agent API base, ending `/api/agent` (no trailing slash needed) |
| `BOT_API_KEY` | required | bearer for `BOT_API_URL`: must equal **`BRISTLEBANE_API_KEY` on the main bot** |
| `RAID_CHAT_CHANNEL_ID` | optional | where the join notice is posted; unset = no notice |
| `SCREEN_URL` | optional | the raid screen page (Wolf Pack: `https://wolfpack.quest/screen`), added to the join notice on its own line; must be `https://` |
| `RECORD_MODE` | `optin` | `optin` (record the members who opted in) · `off` (record nobody; the commands still work) |
| `RECORDINGS_DIR` | `/data/recordings` | where recordings go; `consent.json` lives in its **parent** |
| `POLL_SECONDS` | `30` | clamped to 5–300 |
| `BRISTLEBANE_APP_ID` | optional | the application id for registering the command; defaults to the bot's own user id |
| `OFFNIGHT_VOICE_CHANNEL_ID` | optional | read, **not used yet** (reserved) |

**The key.** The main bot's `/api/agent/*` routes want a per-user session token, which a service has no person
to borrow. So the main bot has one dedicated variable, **`BRISTLEBANE_API_KEY`** (generate a long random
string; documented in `.env.example`). When it is set, **`GET /api/agent/raid-live` — and no other route —**
also accepts `Authorization: Bearer <that key>` (constant-time compare). Set the same value here as
`BOT_API_KEY`. Unset on the main bot, the route wants a session token like every other.

Discord side: no privileged intents (it asks only for `Guilds` and `GuildVoiceStates`). Permissions:
View Channel + Connect on the voice channel, Send Messages on `RAID_CHAT_CHANNEL_ID`, and Change Nickname on
the guild. Invite with the **`applications.commands`** scope as well as `bot`:
`https://discord.com/oauth2/authorize?client_id=<APP_ID>&scope=bot%20applications.commands&permissions=68160512`.

## Recording format

One folder per stay in the channel (a rejoin is a new folder):

```
${RECORDINGS_DIR}/<night, YYYY-MM-DD>/<session start, UTC e.g. 2026-10-05T00-30-12Z>/
    session.json            start epoch (ms, UTC), channel, userId → display name, join/leave/speaking-start events
    <userId>.opusraw        one file per opted-in speaker, the whole stay
```

`.opusraw` is a plain sequence of records, big-endian: `[uint32 arrival_ms_since_session_start][uint16 length][Opus payload]`.
`@discordjs/voice` 0.19 delivers bare Opus payloads with no RTP header, so arrival time is the only clock
(`decodeRecords()` in `lib.js` reads the format). Bots are skipped. DAVE voice encryption stays on (the
library default; Discord requires it).

Every 5 minutes: `[rec] 5 users, packets/min <id>=<avg> …`, with a `WARN` for anyone who was seen speaking
but produced no packets (what a DAVE or key problem looks like). If the voice connection drops it waits 5 s
for Discord to bring it back, else tears down and the poller rejoins.

**TODO — `tools/opusraw-to-ogg.js`:** turn a session into one gap-filled Ogg Opus per speaker, all starting
at the session's start so they line up. Plan: write the `OpusHead`/`OpusTags` pages, then for each packet at
`t` ms emit 20 ms Opus silence frames (`F8 FF FE`) to cover any gap since the last one, granule position in
48 kHz samples. Not written yet; the raw files are the source of truth until it is.

## Run it

Locally (Node 22.12+):

```
cd apps/bristlebane
npm install
BRISTLEBANE_TOKEN=… DISCORD_GUILD_ID=… RAID_VOICE_CHANNEL_ID=… \
BOT_API_URL=https://<bot-host>/api/agent BOT_API_KEY=… \
RECORDINGS_DIR=./recordings  node index.js
```

Docker (the build context is this folder):

```
docker build -t bristlebane apps/bristlebane
docker run --rm --env-file .env -v bristlebane-data:/data bristlebane
```

**Coolify:** new resource → this repo → build pack **Dockerfile**, base directory **`/apps/bristlebane`**.
**No ports** (it only makes outbound connections; no domain, no health-check URL). **Persistent storage →
mount a volume at `/data`** (recordings + `consent.json`). Environment variables as above. Deploy from the
branch you want; it does not share a deploy with the main bot. `SIGTERM` is handled — files are flushed,
the channel is left and the nickname is restored.

Tests: `npx vitest run test/bristlebane.test.js` from the repo root (the join/leave rule, the consent store,
deletion, the recording writer and the texts; the Discord glue is covered by the smoke test below).

## 30-minute smoke test (three testers, one rejoin)

Use a **test voice channel** as `RAID_VOICE_CHANNEL_ID` and leave `RECORD_MODE` at `optin`.
`tools/fake-raid-live.js` stands in for the main bot so you can start and end a raid by hand:

```
node tools/fake-raid-live.js            # reads ./fake-raid-live.json; BOT_API_URL=http://127.0.0.1:8787/api/agent
echo '{"live":true}'              > fake-raid-live.json     # on
echo '{"live":false}'             > fake-raid-live.json     # quiet
echo '{"live":true,"ended":true}' > fake-raid-live.json     # End raid
```

(The fake ignores the key, so any `BOT_API_KEY` value will do. To test the real route, set
`BRISTLEBANE_API_KEY` on a local main bot and the same value as `BOT_API_KEY`.) Testers: **A**, **B**, **C**.

1. **0:00** Boot the bot, no one in the channel. Log shows `[boot] logged in …`, the dependency report with `@snazzah/davey`, and `[boot] /bristlebane registered for the guild`. In Discord, `/bristlebane` autocompletes its four subcommands.
2. **0:02** Set live. Two polls later: `[live] waiting: live, nobody in the channel` — and the bot does **not** join. ✔ no empty-channel join.
3. **0:03** A joins the channel (nobody has opted in). Within one poll: `[live] join: … opted-in=0`, the notice reads "0 of 1 here", and the bot is called plain **Bristlebane**, not `[REC]`. A talks: **no `.opusraw` file appears** (only `session.json`).
4. **0:05** A runs `/bristlebane status` → "not opted in", "nobody there has opted in", "0 of 1". A runs `/bristlebane optin` → the nickname changes to **[REC] Bristlebane** within seconds, `consent.json` appears next to the recordings folder. A talks: `<A>.opusraw` appears and grows. ✔ opt-in applies mid-session.
5. **0:08** B joins, talks, **never opts in**: no file for B, B's name is nowhere in `session.json`. `/bristlebane status` from B says "1 of 2 opted in".
6. **0:11** B runs `/bristlebane optin`, talks: `<B>.opusraw` appears. C joins and opts in too, talks briefly.
7. **0:14** B runs `/bristlebane optout`: B's stream stops, B's file is **deleted**, B is gone from `session.json` (names and events), `consent.json` no longer lists B, and the reply says how many files were deleted. A and C keep recording.
8. **0:16** C runs `/bristlebane forget` → a confirm prompt with **Delete everything** / **Cancel**. Cancel: "nothing was deleted". Run it again and confirm: C's file is gone from every folder under the recordings directory, C is no longer listed in `consent.json` (the reply says "You are opted out"), and the log shows one `[consent] forget:` line with a user id and counts, no name. C speaks again: no file starts.
9. **0:19** **Rejoin:** right-click the bot → *Disconnect*. Log: `disconnected and not coming back — leaving`, nickname back to **Bristlebane**, `session.json` has a `leave` event. Within ~1 minute (two live polls) it rejoins into a **new** session folder; A (still opted in) is recorded again without doing anything.
10. **0:23** Everyone who opted in leaves the channel while B (not opted in) stays: the nickname drops back to plain **Bristlebane** within seconds. Set live **false**: `[live] in channel: not live (leaves at 10m)` once, then (10 minutes) `[live] leave: not live 10m`.
11. **0:28** Set live true again → rejoins; set `ended` true → `[live] leave: ended`, and it does **not** come back while `ended` stays true. `Ctrl-C` / `docker stop`: clean exit, files closed, nickname restored.
12. **After:** every `session.json` parses; names appear only for people who opted in; the `.opusraw` files decode (`decodeRecords` in `lib.js` — `leftover` should be 0).

Pass = steps 3, 5, 7, 8 and 9 behave exactly as written.
