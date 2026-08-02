// #87 — the officer runbook catalog.
//
// Runbooks are DATA, not prose. Every step that points at a lever declares it
// structurally ({kind:'flag'|'route'|'command'|'doc'|'surface'}), so
// test/runbooks-catalog.test.js can assert that every reference still resolves
// against the real repo — the same "enforced, not advisory" trick
// scripts/check-agent-dashboard.js uses for the agent dashboard. Rename a
// tuning flag and CI tells you which runbook now lies.
//
// Full design + the ranking justification: docs/DESIGN-87-officer-console.md.
//
// RULES for adding one:
//   • `groundedIn` is mandatory unless you set `speculative: true`. A runbook
//     nobody can date is a guess and the console labels it as one.
//   • Keep the set SHORT. The fastest way to make runbooks useless is length.
//   • The `donts` are the part that gets lost when knowledge moves by word of
//     mouth. Write them. The console renders them in red.

export type LeverRef =
  | { kind: 'flag';    key: string;  label?: string }   // an overlay_tuning control key
  | { kind: 'route';   href: string; label?: string }   // a real web page
  | { kind: 'command'; name: string; label?: string }   // a real Discord slash command
  | { kind: 'doc';     path: string; label?: string }   // a real file in the repo
  | { kind: 'surface'; name: string; label?: string };  // Mimic/Discord/GitHub — not repo-checkable

export type RunbookStep = {
  /** What to do, in plain officer language. */
  text: string;
  /** Levers this step points at. Verified by the catalog test. */
  levers?: LeverRef[];
};

export type Incident = {
  /** YYYY-MM-DD of the incident (or of the audit that found it). */
  date: string;
  /** One line: what happened. */
  what: string;
};

export type Runbook = {
  id: string;                 // 'rb-01' — stable, used as the deep-link anchor
  rank: number;               // display order (likelihood x pain, see the design doc)
  title: string;
  symptom: string;            // what someone actually says
  /** 'full' runbooks are written out; 'outline' ones are the short form. */
  depth: 'full' | 'outline';
  groundedIn: Incident[];
  /** Set true ONLY for a runbook with no real incident behind it. */
  speculative?: boolean;
  /** How you tell — ordered cheapest check first. */
  howYouTell: RunbookStep[];
  /** Do this — ordered least blast radius first. */
  doThis: RunbookStep[];
  ifStuck?: string;
  after?: string;
  donts: string[];
  /** Health-signal ids (see consoleHealth.ts) that should surface this runbook. */
  signals: string[];
  lastReviewed: string;       // YYYY-MM-DD
};

export const RUNBOOKS: Runbook[] = [
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'rb-01',
    rank: 1,
    title: 'A callout didn’t fire',
    symptom:
      'A raider says the tank-buster / Death Touch / enrage callout never spoke, ' +
      'or it spoke for some people and not others, or it fired minutes late.',
    depth: 'full',
    groundedIn: [
      { date: '2026-07-17', what: 'Callout trifecta: triggers were evaluated AFTER the privacy filter, so 9 of the 17 shipped templates could never fire; the trigger overlay’s ✕ silently persisted enableTriggerTts=false forever; a bot deploy reset the relay’s nextId and made the fleet relay-deaf for hours.' },
      { date: '2026-07-17', what: 'The {s} placeholder excluded backticks, so Luclin-era names (Rhag`Zhezum) could never match a name-captured trigger.' },
      { date: '2026-07-31', what: '30 of 102 enabled guild triggers were structurally dead: the agent tests patterns against the RAW log line including the timestamp prefix, so any ^-anchored pattern matches nothing, ever. Both test surfaces validate a timestamp-free string, so Rehearse always passed.' },
      { date: '2026-07-31', what: 'The Emperor Ssraeshza tank-buster pattern demanded the literal words "tank buster" — EQ never names a mob’s spell. Tested against 7 real lines it matched ZERO, including plain buster hits.' },
      { date: '2026-07-22', what: 'TTS was silent on some machines: Windows blocks audio from a window that is never clicked, and the alert overlay never is. Fixed by clearing the block at startup.' },
    ],
    howYouTell: [
      { text: 'Did it fire for ANYONE else? Check the Mimic dashboard Triggers tab (recent fires + the why-didn’t-it-fire panel) or the bot’s trigger relay posts in Discord. Fired for others = it is that one machine; skip to the machine-local checks.',
        levers: [{ kind: 'surface', name: 'Mimic → Triggers tab → recent fires' }] },
      { text: 'Is the pattern structurally alive? A pattern starting with ^ can NEVER match — the agent tests against the raw log line, timestamp prefix included. This is the single largest bucket today.',
        levers: [{ kind: 'route', href: '/admin/triggers', label: 'Guild triggers' }] },
      { text: 'Does the log line the trigger needs actually exist? Get the VERBATIM line from a raider’s eqlog_*_pq.proj.txt. EQ never names a mob’s spell — it prints a bare "begins to cast a spell.". A trigger waiting for the words "tank buster" waits forever.' },
      { text: 'Rehearse it — and know the blind spot. Rehearse drives the REAL tail pipeline, but _synthesizeMatchingLine strips anchors, so Rehearse passes on every ^-dead pattern. Rehearse proves the action path (TTS / overlay / timer), not the match. To prove the match, use Replay over a real log slice.',
        levers: [{ kind: 'surface', name: 'Mimic → Triggers → Rehearse / Replay' }] },
      { text: 'Machine-local: does "Mimic" appear in the Windows volume mixer during a Rehearse? Was the trigger overlay closed with ✕ on an old build (used to mute TTS permanently)? Is a class filter or require_raid_member excluding them? What agent version are they on?',
        levers: [{ kind: 'route', href: '/admin/console', label: 'Fleet versions' }] },
      { text: 'Late rather than missing? That is the ghost-callout path — relays ride the durable upload queue, so a backlog delivers fires minutes late and the bot serves them for 60s from posted_at. Check that uploader’s queue depth.',
        levers: [{ kind: 'route', href: '/admin/agents', label: 'Agent fleet' }] },
    ],
    doThis: [
      { text: '^-anchored pattern: replace ^ with \\]\\s+ or unanchor it. ONE ROW AT A TIME, each confirmed against a real log line. Live on the 10-minute agent poll — no release.',
        levers: [{ kind: 'route', href: '/admin/triggers' }] },
      { text: 'Pattern demands text EQ never prints: rewrite as the EQLogParser two-alternative shape (damage line OR generic cast line).',
        levers: [{ kind: 'route', href: '/admin/triggers' }] },
      { text: 'One machine silent: walk them through Rehearse → volume mixer → agent version.' },
      { text: 'Trigger is genuinely wrong: disable the row, tell the raid, fix it after. A broadcast to every Mimic reaches them in ~90s regardless of version.',
        levers: [{ kind: 'route', href: '/admin/notices', label: 'Mimic Mail' }] },
    ],
    ifStuck:
      'File it with the VERBATIM log line attached. A callout bug without a verbatim line is not actionable — that is exactly why "Death Touch not captured when the victim is a PET" is still open.',
    after:
      'Guild triggers propagate on the 10-minute poll. Tell the raid the callout is back rather than letting them discover it at the next pull.',
    donts: [
      'Don’t loosen a pattern without the verbatim line — widening the Death Touch victim group blind risks EATING real Death Touches.',
      'Don’t bulk-fix the dead anchors mid-raid-week. A bulk un-mute of ~29 callouts is its own incident. Reviewed batch, one confirmed line each.',
      'Don’t trust a green Rehearse as proof the pattern matches. It isn’t.',
      'Don’t conclude "TTS is broken" from one machine — it is per-machine far more often than not.',
    ],
    signals: ['triggerHealth', 'fleetVersions'],
    lastReviewed: '2026-08-02',
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'rb-02',
    rank: 2,
    title: 'Parses are missing, or the numbers are wrong',
    symptom:
      'A fight has no parse card; or the card exists but someone’s damage is absurd, ' +
      'a name is on it who wasn’t there, or the total exceeds the boss’s HP.',
    depth: 'full',
    groundedIn: [
      { date: '2026-07-17', what: 'P0: _resolveSessionToken could not distinguish "query failed" from "token not found", so during a Supabase 5xx window valid agents got 401 — and the agent’s durable queue drops 4xx as PERMANENT. A blip became permanent fleet-wide data loss. Fixed: auth-lookup failure returns 503.' },
      { date: '2026-07-13', what: '409 storm: 86.8% of bot log lines in the peak 5-minute window were duplicate-key errors; mid-raid restarts amplified the queue backup.' },
      { date: '2026-07-30', what: 'Charm-pet attribution corruption: one corrupted uploader per fight (Bardtholemu 3.05M phantom damage, Jankzer top DPS while mezzing, encounter total 70k past the boss’s HP pool). Repaired in Supabase with originals preserved under players_pre_petfix.' },
      { date: '2026-07-22', what: '#134: the Discord auto-parse card SUMMED each parser’s sighting of the same death ("Melting x3" when 3 parsers each saw it once).' },
      { date: '2026-07-13', what: 'Lord of Ire: a dispel/FD reset that full-healed the mob was splitting one kill into two encounter cards; the splitter now also requires the matched encounter to be a CONFIRMED kill.' },
    ],
    howYouTell: [
      { text: 'Branch first — MISSING or WRONG? They have completely different causes.' },
      { text: 'MISSING: compare Parses-landing freshness against Ingest heartbeat. Ingest fresh but no encounters = the encounter path specifically. Ingest also stale = platform-wide, go to "Everything is frozen".',
        levers: [{ kind: 'route', href: '/admin/console' }] },
      { text: 'MISSING: check upload errors grouped by status code. 401/403 across many uploaders is the auth-blip signature and is an EMERGENCY — every agent behind it is dropping payloads permanently, not retrying. 429 = admission control. 5xx = bot or Supabase.',
        levers: [{ kind: 'route', href: '/admin/agents' }, { kind: 'flag', key: 'flag_disable_budgets' }] },
      { text: 'MISSING: check queue backlog (max queuePending across uploaders). A raid-wide backlog means Discord or Supabase is slow; the queue is doing its job and will drain.',
        levers: [{ kind: 'route', href: '/admin/agents' }] },
      { text: 'MISSING: confirm the fight was even eligible for a night-thread card — non-boss mobs need >=15s and >=3 players. The Parse Log embed and Supabase ALWAYS get every encounter, so "no card in the night thread" is not "no parse".' },
      { text: 'WRONG: open the encounter’s HP-vs-damage health. A total far above the catalog HP is the tell; per-contributor rows show whether a SINGLE uploader carries the anomaly (the 2026-07-30 signature).',
        levers: [{ kind: 'route', href: '/admin/encounters' }] },
    ],
    doThis: [
      { text: 'MISSING, transient: nothing. The durable queue recovers on its own.' },
      { text: 'MISSING, genuinely lost: file a backfill request and have that raider re-run the agent with --since. find_or_create_encounter dedups, so a re-submission attaches instead of duplicating.',
        levers: [{ kind: 'route', href: '/admin/encounters' }] },
      { text: 'WRONG: identify the bad uploader from the per-contributor rows, then follow "One agent is poisoning the data".' },
      { text: 'WRONG: mark the encounter incomplete or merge duplicates.',
        levers: [{ kind: 'route', href: '/admin/encounters' }, { kind: 'command', name: 'markincomplete' }] },
      { text: 'WRONG, pet damage: check the parse card’s Charmed field — it lists which charm pets split to whom.' },
    ],
    ifStuck:
      'Data repair is a service-role SQL edit with the original preserved (precedent: players_pre_petfix, 2026-07-31). Not a console button. Ever.',
    after:
      'Anything repaired by hand goes in docs/STATUS.md. The 2026-07-31 repair is only auditable because it was written down.',
    donts: [
      'Don’t tell people to clear their upload queue — it IS the durable record.',
      'Don’t try to shed the encounter stream. You can’t (_SHED_NEVER refuses it), and that refusal exists precisely so this instinct can’t do damage.',
      'Don’t re-run a merge to "fix" numbers before you know which uploader was wrong — merge_encounter_players takes max-damage-per-player, so a bad submitter WINS the merge.',
    ],
    signals: ['parsesLanding', 'ingestHeartbeat', 'uploadErrors', 'backlog'],
    lastReviewed: '2026-08-02',
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'rb-03',
    rank: 3,
    title: 'Everything is frozen',
    symptom:
      'Overlays blank, no parse cards, chat not relaying, the site won’t load — all at once, mid-raid.',
    depth: 'full',
    groundedIn: [
      { date: '2026-07-13', what: 'Supabase GoTrue returned 504s (site-wide MIDDLEWARE_INVOCATION_TIMEOUT) while Postgres stayed healthy. A single "is it up?" ping could not tell those apart — which is why /api/health now probes auth and db separately.' },
      { date: '2026-07-13', what: 'Web-only pushes were restarting the bot (fixed via railway.toml watchPatterns), and mid-raid restarts amplified the queue backup and the release-announcer spam. This is where the raid-night deploy freeze came from.' },
      { date: '2026-07-17', what: 'Audit: the single Railway replica is load-bearing — a second replica would double-post every Discord message (two gateway sessions). Horizontal scaling is not an option; admission control is.' },
    ],
    howYouTell: [
      { text: 'Is it just one machine? Ask a second raider. Overlays are LOCAL — a single blank HUD is a Mimic problem, not an outage. Do this first: it is free and it is the answer more often than not.' },
      { text: 'Is the Discord bot alive? Run any slash command. Discord is independent of Supabase.',
        levers: [{ kind: 'command', name: 'timers' }] },
      { text: 'Check the site probe: auth down + db ok = GoTrue only. Sign-in wedges but the RAID does not care — agents authenticate through the bot with their own bearer tokens. db down = Postgres; everything analytical stops and the bot’s circuit breaker will already be open.',
        levers: [{ kind: 'route', href: '/admin/console' }] },
      { text: 'Check the bot’s own view: /health returns ready, shutting_down, supabase_breaker and per-kind budget state. Until the bot publishes a heartbeat row, infer it: if ANY agent uploaded in the last 5 minutes, the bot is up — the bot is what writes those rows.' },
      { text: 'Was there a deploy? Railway shows the merge commit message as the deploy name. A deploy inside Sun/Wed/Thu 19:30→00:30 ET should never have happened — raid-freeze.yml turns the push red but CANNOT stop it.',
        levers: [{ kind: 'doc', path: 'CLAUDE.md', label: 'Raid-night deploy freeze' }] },
    ],
    doThis: [
      { text: 'GoTrue only: nothing. Say so in raid chat. Sign-in returns on its own.' },
      { text: 'Postgres down: nothing to pull — the breaker already backed off. Announce it; a critical Mimic Mail notice also posts to Discord. Parses queue durably on every agent and land when it returns.',
        levers: [{ kind: 'route', href: '/admin/notices', label: 'Mimic Mail' }] },
      { text: 'Bot restarting: wait one healthcheck. Do NOT push anything.' },
      { text: 'Bot up but drowning: shed the EPHEMERAL streams in this order — live_state, raid_roster, casting, threat_snapshot, buff_casts. Each is 200-ack-and-drop, reversible, ~60s to take effect, and never touches parses or chat.',
        levers: [
          { kind: 'flag', key: 'flag_shed_live_state' },
          { kind: 'flag', key: 'flag_shed_raid_roster' },
          { kind: 'flag', key: 'flag_shed_casting' },
          { kind: 'flag', key: 'flag_shed_threat_snapshot' },
          { kind: 'flag', key: 'flag_shed_buff_casts' },
        ] },
      { text: 'Genuinely unknown and the fleet is suspected: pausing the whole fleet is the last resort. It is safe by design — queues hold, nothing drops, overlays keep running on local data, and clearing it resumes within one heartbeat — but it makes the raid blind to everything cross-client. Tell the raid first.',
        levers: [{ kind: 'flag', key: 'flag_agent_kill' }] },
    ],
    ifStuck: 'A fix that must ship right now: follow "It’s raid night and this has to ship".',
    after:
      'Clear every shed flag. The drift panel will nag, but clear them deliberately — a shed stream that stays shed is a feature quietly dead.',
    donts: [
      'Don’t push to main to fix it unless the commit message contains [hotfix] and you have decided the restart is worth it. A mid-raid restart is what AMPLIFIED 2026-07-13.',
      'Don’t add a second bot replica — two gateway sessions double-post every Discord message.',
      'Don’t try to shed encounter / chat / bosskill / lockout / historical_chat. The bot refuses; the instinct is the bug.',
    ],
    signals: ['ingestHeartbeat', 'fleetNow', 'liveState', 'site'],
    lastReviewed: '2026-08-02',
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'rb-04',
    rank: 4,
    title: 'One agent is poisoning the data',
    symptom:
      'One raider’s uploads carry impossible numbers, or one elected reporter has silently ' +
      'stopped covering its stream, or someone is on an agent old enough to be missing a correctness fix.',
    depth: 'full',
    groundedIn: [
      { date: '2026-07-30', what: 'Exactly ONE corrupted uploader per fight — whoever’s stale petOwners residue matched that fight’s mob names (Hawkner on Blood, Bardtholemu 3.05M, Uilnayar at 01:05).' },
      { date: '2026-07-19', what: 'ONE elected chat reporter heartbeating while its character was logged out darkened guild chat for 8.5 hours. The election TTL never noticed, because the AGENT was alive.' },
      { date: '2026-08-02', what: 'Fleet version spread measured live: 9 distinct agent versions active in 7 days, oldest still uploading 3.4.22.' },
    ],
    howYouTell: [
      { text: 'Fleet versions: distinct agent_version among uploaders active in the last 7 days, oldest first, with the version floor drawn on it.',
        levers: [{ kind: 'route', href: '/admin/console' }] },
      { text: 'Upload errors: uploaders with last_ok=false, newest first.',
        levers: [{ kind: 'route', href: '/admin/agents' }] },
      { text: 'Per-contributor rows on the parse: is the anomaly one submitter or all of them?',
        levers: [{ kind: 'route', href: '/admin/encounters' }] },
      { text: 'Reporters panel: per uploader — character, zone, group, version, camping, last-line age, fresh. A reporter that is ELECTED but STALE is the 2026-07-19 shape.',
        levers: [{ kind: 'surface', name: 'Mimic → Admin tab → Reporters' }] },
    ],
    doThis: [
      { text: 'Elected reporter stale or wrong: swap the pin to a live+fresh character, or add an include. A dead/stale pin is IGNORED (fail-open), so a bad pin cannot break anything.',
        levers: [{ kind: 'surface', name: 'Mimic → Admin → Reporters (reporter_pin_* / reporter_extra_*)' }] },
      { text: 'Fleet-wide correctness bug fixed in a newer agent: set the version floor. Below-floor agents stand down and get an update nudge. Typed confirm — a wrong digit stands the WHOLE fleet down.',
        levers: [{ kind: 'flag', key: 'min_agent_ver_num' }] },
      { text: 'One uploader flooding a stream: set a per-uploader budget for that kind (budget_<kind>_per_min).',
        levers: [{ kind: 'flag', key: 'flag_disable_budgets' }] },
      { text: 'One uploader corrupting ENCOUNTERS: no lever exists today. Ask them to update and restart Mimic (it clears in-memory residue like petLeaders, and costs nothing because the queue is durable), then repair the data after the fact.' },
      { text: 'Uploader compromised or must stop entirely: revoke their agent session. NUCLEAR — it logs them out of Mimic. Talk to them first.',
        levers: [{ kind: 'command', name: 'token' }] },
    ],
    ifStuck: 'Repair the data (see "Parses are missing, or the numbers are wrong") and file the root cause.',
    after: 'Clear any pin you set — a forgotten pin is harmless but it hides that the election is being overridden.',
    donts: [
      'Don’t revoke a token as a first move — it removes a raider from the raid’s data entirely and they have to be re-onboarded.',
      'Don’t set a version floor mid-raid unless the below-floor behaviour is actively worse than having those raiders dark. Standing agents down mid-fight removes their overlays’ cross-client data.',
      'Don’t try to pin encounter/mob streams — per-observer streams are structurally never elected, and that is correct.',
    ],
    signals: ['fleetVersions', 'uploadErrors'],
    lastReviewed: '2026-08-02',
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'rb-05',
    rank: 5,
    title: 'Guild chat stopped reaching Discord',
    symptom: 'The guild-chat channel is silent while the raid is visibly playing.',
    depth: 'outline',
    groundedIn: [
      { date: '2026-07-19', what: 'Guild chat → Discord went dark 6:43am–3:16pm. The single elected chat reporter’s AGENT kept heartbeating while its CHARACTER was logged out, so it stayed elected and saw no chat. The PvP feed (not election-gated) posted all day, which is why the fleet looked healthy.' },
    ],
    howYouTell: [
      { text: 'Chat-relay freshness STALE while ingest heartbeat is FRESH is the signature — one stream dead, fleet fine.',
        levers: [{ kind: 'route', href: '/admin/console' }] },
      { text: 'Check the elected chat reporter’s last-line age on the Reporters panel.',
        levers: [{ kind: 'surface', name: 'Mimic → Admin → Reporters' }] },
    ],
    doThis: [
      { text: 'Set dedup_chat = 0 — instant fail-open, everyone uploads, and the bot’s 10s dedup collapses the duplicates.',
        levers: [{ kind: 'flag', key: 'dedup_chat' }] },
      { text: 'Or swap the chat reporter pin to a live+fresh character; confirm chat resumes within ~60s.',
        levers: [{ kind: 'surface', name: 'Mimic → Admin → Reporters' }] },
      { text: 'OPEN ITEM: dedup_chat has been 0 since the incident. #112 shipped liveness + zone-spread specifically to make re-enabling safe, and the fleet passed agent 3.3.91 long ago. The three-step re-enable procedure is written down.',
        levers: [{ kind: 'doc', path: 'docs/BETA-TESTING.md', label: '#112 re-enable procedure' }] },
    ],
    donts: [
      'Don’t re-enable dedup_chat during a raid.',
      'Don’t conclude the fleet is broken because one stream is — check a non-elected stream (PvP, live-state) first.',
    ],
    signals: ['chatRelay', 'drift'],
    lastReviewed: '2026-08-02',
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'rb-06',
    rank: 6,
    title: 'Mimic won’t update, or a bad build is out there',
    symptom: '"Update check failed: No published versions on GitHub", a release that crashes on launch, or beta testers frozen on one version.',
    depth: 'outline',
    groundedIn: [
      { date: '2026-07-30', what: '14 Linux/Deck builds in two days pushed v2.1.1-beta.2, -beta.1 and v2.1.0 out of GitHub’s 10-entry releases.atom window. Beta clients walk that feed, found only linux tags, and the ENTIRE Windows beta channel could not update. Stable was spared only because it resolves via /releases/latest.' },
      { date: '2026-07-09', what: 'Parking beta at or below stable tags prereleases that semver-sort BELOW stable, and the updater stops offering new betas. After cutting a stable, re-park beta above it immediately.' },
    ],
    howYouTell: [
      { text: 'Count non-linux entries in the newest 10 GitHub releases — fewer than 2 means the feed is starving the beta channel.',
        levers: [{ kind: 'surface', name: 'GitHub → Releases' }] },
      { text: 'Fleet versions: are beta testers all frozen at the same version?',
        levers: [{ kind: 'route', href: '/admin/console' }] },
    ],
    doThis: [
      { text: 'Feed starvation: run the Linux-release pruner (it also runs at the end of every Linux build now).',
        levers: [{ kind: 'doc', path: '.github/workflows/prune-linux-releases.yml' }] },
      { text: 'Beta parked wrong: re-park apps/mimic/package.json ABOVE the current stable.',
        levers: [{ kind: 'doc', path: 'CLAUDE.md', label: 'Mimic release channels' }] },
      { text: 'Bad build crashing: Mimic’s LKG auto-rollback already restores last-known-good and blacklists the version on a crash-loop. Confirm via the tray notice.' },
      { text: 'Bad build that does NOT crash: the version floor stands down the agent half; the shell half needs a new release.',
        levers: [{ kind: 'flag', key: 'min_agent_ver_num' }] },
      { text: 'Tell people — Mimic Mail reaches every Mimic version ever built, with no release.',
        levers: [{ kind: 'route', href: '/admin/notices' }] },
    ],
    donts: [
      'Don’t merge the Deck working branch to beta to "ship the fix" — cherry-pick the specific feature commits.',
      'Don’t let Deck iteration fill the release feed again.',
    ],
    signals: ['fleetVersions'],
    lastReviewed: '2026-08-02',
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'rb-07',
    rank: 7,
    title: 'A raider can’t get Mimic or Zeal working',
    symptom: 'No overlays, no Zeal, "it says I’m not signed in", or no logs are being read.',
    depth: 'outline',
    groundedIn: [
      { date: '2026-06-12', what: 'Mimic installed INSIDE the EQ folder breaks Zeal DX-hook detection (n=1, environmental — DLL shadowing or AV). Reinstalling outside the EQ folder is the fix. Note the friction: detectEqDir() supports in-folder installs for LOG detection, so the product steers people into the layout that breaks Zeal.' },
      { date: '2026-07-05', what: 'Elevation mismatch (EQ as admin, Mimic not) makes the named pipe connect-then-close with NO error. Run Mimic as admin.' },
      { date: '2026-07-17', what: 'Release-announce DMs failed for 15 of 26 members — Discord code 50007, DMs off.' },
    ],
    howYouTell: [
      { text: 'Zeal health overlay / the dashboard Zeal card walks the checkpoints for you.',
        levers: [{ kind: 'surface', name: 'Mimic → Zeal health overlay' }] },
    ],
    doThis: [
      { text: 'Settings → "Set up for me" writes Log=TRUE (eqclient.ini) plus Zeal’s PipeVerbose / ExportOnCamp / PipeDelay across every known EQ folder. Must be run with EQ CLOSED — EQ rewrites eqclient.ini from memory on exit.',
        levers: [{ kind: 'surface', name: 'Mimic → Settings → Set up for me' }] },
      { text: 'Is Mimic installed inside the EQ folder? Reinstall outside it.' },
      { text: 'Is EQ running as admin? Then run Mimic as admin too.' },
      { text: 'Token trouble: mint a fresh one. Officers can mint on a member’s behalf when they can’t run the command themselves.',
        levers: [{ kind: 'command', name: 'token' }] },
      { text: 'DMs off (Discord 50007): point them at the releases channel instead.' },
    ],
    donts: [
      'Don’t debug Zeal by hand before the Zeal-health card and the Charm diagnostic card — they walk the checkpoints for you.',
    ],
    signals: [],
    lastReviewed: '2026-08-02',
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'rb-08',
    rank: 8,
    title: 'It’s raid night and this has to ship',
    symptom: 'Something is broken now and the fix is a code change.',
    depth: 'outline',
    groundedIn: [
      { date: '2026-07-13', what: 'Any main push restarts production surfaces the raid depends on; mid-raid restarts amplified that night’s queue backup and announcer spam. The Sun/Wed/Thu 19:30→00:30 ET freeze came from this.' },
    ],
    howYouTell: [
      { text: 'Decide first: does it actually have to ship? A tuning flag, a guild-trigger row, a Mimic Mail notice and a reporter pin all take effect in 60s–10min with NO deploy. That is what the whole control plane is for.',
        levers: [{ kind: 'route', href: '/admin/console' }] },
    ],
    doThis: [
      { text: 'If it must ship: include [hotfix] in the commit message. It is required for the raid-freeze tripwire and, more importantly, it marks the push as deliberate.',
        levers: [{ kind: 'doc', path: '.github/workflows/raid-freeze.yml' }] },
      { text: 'Know what restarts: bot = main touching bot paths (Railway); web = main touching web/ (Vercel — railway.toml watchPatterns keep this from bouncing the bot); Mimic/agent = beta, pull-based, safe any time.' },
      { text: 'Announce in raid chat before, not after.' },
    ],
    donts: [
      'Don’t merge with --no-edit — Railway shows the merge commit message as the deploy name.',
      'Don’t stage unrelated work into a hotfix.',
    ],
    signals: [],
    lastReviewed: '2026-08-02',
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'rb-09',
    rank: 9,
    title: 'The night thread is in the wrong channel, or missing',
    symptom: 'Parse cards and loot posts landed somewhere unexpected, or no night thread opened at all.',
    depth: 'outline',
    groundedIn: [
      { date: '2026-07-31', what: 'The v1 parent chain stopped at RAID_CHAT_CHANNEL_ID, which is unset on Railway, so night one’s threads all landed in #raid-mobs. v2 added a known-id fallback and logs every rejected candidate.' },
    ],
    howYouTell: [
      { text: 'The bot logs "[raid-night] parent …" for every rejected candidate — that tells you which link in the chain failed and why.' },
    ],
    doThis: [
      { text: 'Resolution order is env pin → memory cache → channelSlots → an open /raidnight session → an active thread with the SAME NAME → create. The name-match is how it recovers from volume loss, so a correctly-named existing thread gets adopted.',
        levers: [{ kind: 'command', name: 'raidnight' }] },
      { text: 'Set RAID_NIGHT_THREAD_PARENT_ID to fix it permanently; RAID_NIGHT_THREADS=0 disables the feature.' },
      { text: 'Reassure people: the canonical parse record never moves — the Parse Log thread always gets the JSON embed, so a misplaced night thread is cosmetic, never data loss.' },
    ],
    donts: ['Don’t delete a mis-parented thread that already has cards in it — the night key will just adopt it by name next time.'],
    signals: [],
    lastReviewed: '2026-08-02',
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'rb-10',
    rank: 10,
    title: 'The loot or DKP didn’t show up',
    symptom: 'An award exists in OpenDKP but not on the site, or vice versa.',
    depth: 'outline',
    groundedIn: [
      { date: '2026-07-22', what: '#138: OpenDKP upserts 500’d with PG 21000 whenever a batch carried >=2 rows sharing the conflict key — the WHOLE batch silently never mirrored. Fixed by deduping each batch by its exact arbiter key.' },
      { date: '2026-07-19', what: '#110 "Backpack": 3 awards deleted in OpenDKP still showed on the site — opendkp_loot was append-only via upsert and _raidNeedsDetail stopped re-fetching a settled raid.' },
    ],
    howYouTell: [
      { text: 'Compare the audit log and the site’s loot surfaces against OpenDKP itself.',
        levers: [{ kind: 'route', href: '/admin/audit' }] },
    ],
    doThis: [
      { text: 'Run a sync; add full:true to reconcile every raid rather than just the recent window.',
        levers: [{ kind: 'command', name: 'syncopendkp' }] },
      { text: 'The reconcile fails SAFE: it never deletes for a raid whose fetch errored, and aborts its deletes entirely if the removal set exceeds max(20, 25% of scanned).' },
    ],
    donts: ['Don’t hand-edit the mirror — it is a mirror. Fix upstream and re-sync.'],
    signals: [],
    lastReviewed: '2026-08-02',
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'rb-11',
    rank: 11,
    title: 'A callout is spamming the raid',
    symptom: 'The same TTS callout fires over and over, or fires for something that didn’t happen.',
    depth: 'outline',
    groundedIn: [
      { date: '2026-07-17', what: 'Ghost callouts: trigger relays ride the durable FIFO, so a queue backlog delivers fires minutes late and the bot serves them for 60s from posted_at — stale callouts speak as if live.' },
      { date: '2026-07-30', what: 'A Cleric hammer pet self-destructing (Vobeker hit Vobeker for 20000 non-melee) matched the Death Touch countdown trigger. Fixed server-side with a self-hit exclusion.' },
    ],
    howYouTell: [
      { text: 'Recent fires on the Mimic Triggers tab tells you which row is firing and on what capture.',
        levers: [{ kind: 'surface', name: 'Mimic → Triggers → recent fires' }] },
    ],
    doThis: [
      { text: 'Disable the row — propagates on the 10-minute agent poll.',
        levers: [{ kind: 'route', href: '/admin/triggers' }] },
      { text: 'Faster: shedding the trigger relay kills only the CROSS-CLIENT replay; local callouts still fire. ~60s.',
        levers: [{ kind: 'flag', key: 'flag_shed_trigger_relay' }] },
      { text: 'TTS ripcord for the bot’s voice: master enable + skip patterns.',
        levers: [{ kind: 'route', href: '/admin/voice' }] },
    ],
    donts: [
      'Don’t try to shed the whole trigger path hoping to catch one bad row — trigger ingest is not sheddable, only the relay fan-out is.',
    ],
    signals: ['triggerHealth'],
    lastReviewed: '2026-08-02',
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'rb-12',
    rank: 12,
    title: 'The board or the timers are wrong',
    symptom: 'A boss shows a timer it shouldn’t have, or a kill didn’t start one.',
    depth: 'outline',
    groundedIn: [
      { date: '2026-07-13', what: 'PvP-event lockouts named for the war gods ("Tallon Zek" / "Vallon Zek") name-matched Plane of Tactics bosses and synthesized timers onto the PoP-LOCKED board. Every manual clear path is itself PoP-locked, so an officer could not remove them — hence the startup sweep.' },
    ],
    howYouTell: [
      { text: 'Compare the board against the kill history; a timer on a PoP boss before 2026-10-01 is always wrong.' },
    ],
    doThis: [
      { text: 'Adjust a single timer.', levers: [{ kind: 'command', name: 'updatetimer' }] },
      { text: 'Rebuild from Discord cards — paste cooldown/summary message links; the latest nextSpawn per boss wins across everything pasted.',
        levers: [{ kind: 'command', name: 'restore' }] },
      { text: 'Rebuild from Supabase encounters (default 72h, dry-run supported).',
        levers: [{ kind: 'command', name: 'recoverkills' }] },
    ],
    after: 'PoP is locked until 2026-10-01. After unlock, run /board and refresh pqdiUrls via /addboss.',
    donts: ['Don’t chase stale spawn alerts right after a redeploy — they are suppressed on purpose.'],
    signals: [],
    lastReviewed: '2026-08-02',
  },
];

/** Lookup by id — used by the console for deep-linking and by the health board. */
export function runbookById(id: string): Runbook | undefined {
  return RUNBOOKS.find(r => r.id === id);
}

/** Every lever reference across the catalog, flattened. The anti-rot test walks this. */
export function allLevers(): LeverRef[] {
  const out: LeverRef[] = [];
  for (const rb of RUNBOOKS) {
    for (const s of [...rb.howYouTell, ...rb.doThis]) {
      for (const l of s.levers ?? []) out.push(l);
    }
  }
  return out;
}
