# Wolf Pack test server — proposal

A private practice server for guild raid prep. EverQuest emulator
(EQEmu/Quarm fork), seeded from our existing world-data mirror, with
character loadouts driven by wolfpack.quest. Goal: let 6-24 guildmates
rehearse PoP fights without taking a raid slot or breaking quarm-side
character state.

**Status:** proposal for discussion. See "Decisions needed."

## Why

PoP encounters (Fire/Earth/Air, then the gods) reward muscle memory.
A handful of us haven't tanked the wave phases on Hoshkar or seen
Bertoxxulous's dispel patterns. A scratch server where we can wipe to
a boss without consequence is the right call.

Existing testing options — alts on the live server, fights without
"the good gear" — don't actually rehearse the encounter. A private
copy of the boss with our actual loadouts does.

## Non-goals

- Not a replacement for playing on real Quarm. Levelling, loot,
  attendance, DKP — all stay on Quarm.
- Not public. Guildmate-only, Tailscale-gated.
- Not a long-running character development sandbox. Sessions are
  ephemeral; gear / AAs / spells come from wolfpack.quest loadouts.
- Not a way to "test" content not yet released on Quarm.

## Architecture

```
┌──────────────────────────────┐        ┌────────────────────────────┐
│  wolfpack.quest (existing)   │        │  Donated EC2 / VPS         │
│                              │        │  (Ubuntu 22.04, t3.medium) │
│  /me/test-server (new)       │        │                            │
│    - pick gear from catalog  │        │  Docker Compose:           │
│    - pick AAs                │        │   ├ MySQL                  │
│    - pick spell book         │        │   ├ Quarm server binary    │
│    - save "loadout"          │ ◀────▶ │   ├ Controller (Node)      │
│                              │ HTTPS  │   │   - poll loadouts      │
│  Discord OAuth = login       │        │   │   - seed character_data│
└──────────────────────────────┘        │   │   - report crashes     │
                                        │   └ Caddy + Tailscale      │
┌──────────────────────────────┐        │                            │
│  Supabase (existing)         │        │  GitHub Actions deploy:    │
│                              │ ◀────▶ │   - build images           │
│  - World mirror (29 eqemu_*  │ replic │   - push to GHCR           │
│    tables, ~350k rows)       │        │   - ssh + docker compose up│
│  - Loadouts (new table)      │        │   - daily MySQL snapshot   │
│  - Character lookups         │        │     to S3                  │
└──────────────────────────────┘        └────────────────────────────┘
                                                    ▲
                                                    │ Tailscale
                                              ┌─────┴──────┐
                                              │ Guildmates │
                                              │ EQ clients │
                                              └────────────┘
```

### Data flow

1. Player visits `wolfpack.quest/me/test-server`, picks gear from
   `eqemu_items`, AAs from `eqemu_altadv_vars`, spells they want
   memmed. Saves the loadout.
2. Player connects via Tailscale, logs in (Discord OAuth → JWT →
   server validates).
3. First time logging in this session, the controller seeds the
   `character_data` row in MySQL from the saved loadout.
4. Player joins their groupmates in the zone of choice; we spawn the
   boss; they pull; everyone wipes; they laugh.
5. Session ends. Character state can persist or wipe per officer
   decision (open question below).

### Why this architecture

- **Container compose** so the stack is declarative; redeploy is
  `docker compose up -d` from CI.
- **GitHub Actions** for deploys means no one SSHs manually after
  the one-time setup.
- **Tailscale** instead of public IP eliminates DDoS, port-forward
  debugging, ISP-TOS friction. Each player installs Tailscale once.
- **Supabase as source of truth** for loadouts means players manage
  gear in the same web UI they already use; the test server is
  stateless about player choices.

## Phased plan

Each phase ends with a usable deliverable the team can react to.

### Phase 1 — Bring-up (~5 days)
- Postgres → MySQL conversion script (one-shot full mirror + nightly delta)
- Quarm server compile in a Docker build stage; runtime image
- MySQL container + minimal `character_data` seed for one test character
- Tailscale tunnel up; one zone selectable
- GitHub Actions deploy pipeline end-to-end
- **Deliverable:** technical members can log in with a hardcoded test
  character and walk around an empty zone.

### Phase 2 — Loadout picker (~3 days)
- New `/me/test-server` page on wolfpack.quest
- Item / AA / spell pickers backed by existing eqemu catalogs
- Save → publish to `test_server_loadouts` (new Supabase table)
- Controller polls + reseeds MySQL on next login
- **Deliverable:** players configure their character via the web,
  log in, and find themselves with the picked gear/AAs/spells.

### Phase 3 — Encounter staging (~3 days)
- Spawn-on-demand controller for the PoP bosses we care about
- "Start encounter" button in wolfpack.quest that resets the boss room
- Auto-snapshot of MySQL before each pull (reset = restore)
- Discord webhook notifications: "Boss spawned by X", "Pull ended:
  duration 4m 12s, deaths 3"
- **Deliverable:** officer hits "start Bertoxxulous" in the web UI;
  boss spawns ready to pull; after the wipe, "reset" rolls back.

### Phase 4 — Polish + handoff (~3 days)
- Crash auto-restart + Discord alerts
- Daily snapshot to S3
- Documentation: add a zone, update the binary, onboard a Tailscale
  player
- Officer admin page on wolfpack.quest: kick player, wipe session,
  bring server up/down
- **Deliverable:** runs unattended; ops surface area minimal.

Total: ~2 weeks to first usable platform, ~3 weeks to polished.

## Cost

| Line | $/mo |
|---|---:|
| EC2 t3.medium on-demand (always-on) | ~$30 |
| EBS 30 GB gp3 | ~$3 |
| Egress (24-player raid sessions, few/mo) | ~$1-2 |
| S3 backup (~5 GB) | ~$0.15 |
| **Total — always-on** | **~$35** |
| Alternative: Spot + session-based start | **~$10** |

Charged to whoever's donating the AWS account. Bigger instance
(`t3.large`, ~$60/mo) if PoP zones with heavy trash bog us down.

## Decisions needed from the team

These change the plan; please discuss:

1. **Who hosts?** AWS donation? Hetzner ($10-20/mo, cheaper bandwidth,
   EU-located so US latency 90-130ms)? Linode/DO credit?
2. **Always-on or session-based?** $35/mo vs $10/mo. Always-on is
   simpler; session-based saves money if we play < 3 evenings/week.
3. **Tailscale-only or public IP?** Recommend Tailscale. Cost +
   security wins; players install Tailscale once.
4. **Which zones first?** Suggesting PoFire / PoEarth / PoAir — the
   elementals' little brothers, lowest risk, most useful for muscle
   memory. PoTime is a later goal.
5. **Character persistence between sessions?** Ephemeral is cleaner
   (no "I lost my XP" drama), persistent is more EQ-like.
6. **Officer admin scope.** Who has start/stop/spawn-boss rights?
   Probably the same set as wolfpack.quest officers.
7. **Patch cadence.** Quarm's source updates frequently. Pin a
   version and update intentionally? Or always-latest? Pin is
   probably right for a test server.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| EQEmu source doesn't compile cleanly first try | Target the EQEmu community's documented Ubuntu 22.04 path; budget a debug round in Phase 1 |
| Player loadouts produce invalid `character_data` rows (skill/level mismatches) | Validation in the loadout picker; controller rejects bad combos with a clear error |
| Server crashes mid-session | systemd restart + Discord webhook; auto-snapshot pre-encounter so wipes don't cost progress |
| AWS bandwidth bill higher than expected | Tailscale carries most traffic on tailnet's overlay, not AWS egress; monitor first month |
| Daybreak takedown notice | Private + Tailscale-only is the safe posture; we're not the first guild to do this |
| Donor's AWS account gets billed for our experiment | Hard budget alarm; auto-stop instance if monthly cost exceeds $50 |
| Nobody on the team has compiled EQEmu before | I'll handle compile in the pipeline; one team member with C++ familiarity to sanity-check the build |

## Honest constraints from my side

What I can and cannot contribute:

- **I can build everything as code** — Postgres conversion, server
  Docker setup, deploy pipeline, wolfpack.quest UI, controller
  daemon, character seeding, snapshots, monitoring. All committed
  to the repo, all running off CI.
- **I cannot SSH into a third-party server** — GitHub Actions
  handles deploys; team member adds three secrets
  (`TESTSERVER_HOST`, `TESTSERVER_USER`, `TESTSERVER_SSH_KEY`) and
  we're hands-off thereafter.
- **I cannot validate gameplay** — no EQ client. The first 1-2
  sessions need a person with a client doing the actual logging in.
  I can debug from server logs but won't see what the player sees.
- **I cannot guarantee EQEmu source compatibility** — upstream is
  a moving target. Pinning a version is the safe play; we accept
  occasional "update the pinned version" work.
- **I cannot operate it long-term** — once it's hands-off, an
  occasional crash or "update the binary" task needs a human.
  Phase 4 documents what those tasks look like.

## Open questions for technical members

- Has anyone compiled the EQEmu source before? Any gotchas?
- Anyone running a Tailscale tailnet already we could extend?
- Preference: vanilla docker-compose vs Nomad vs k3s? Compose is
  simplest; if someone strongly prefers something else for ops
  familiarity, easy to switch.
- Monitoring stack preference? Default plan: Uptime Kuma +
  Discord webhook; happy to use whatever else.
- Quarm-custom spell coverage — anyone with recent server-side
  knowledge to validate which custom spells need special handling?
- ZoneServer model: single zoneserver hosting multiple zones
  (simpler, lower RAM, slower-feeling zoning) vs one process per
  zone (more RAM, faster zoning). For 3-4 zones, single is fine.

## What's next

If the team agrees this is worth pursuing:
1. Pick a host (Phase 0).
2. File the work as a tracked roadmap item with the phases above.
3. Start Phase 1 when we wrap the immediate guild-utility work
   (faction/quest tracker / Mimic stable graduation are higher
   priority right now).
4. ~3-week build with the team's technical members consulting on
   the compile + first-login validation.
