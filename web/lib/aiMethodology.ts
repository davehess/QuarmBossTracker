// Data behind /ai — how this platform is built and maintained by AI sessions.
//
// Hitya 2026-08-23: "publish all of this detail to wolfpack.quest/ai … it
// should be human and agent readable … any agentic workflow could review that
// page and understand our methodology for developing and maintaining this
// without GitHub access, but if the agent has GitHub access it could see the
// full picture and set up its own workflow to match."
//
// ONE source, three renderings: the page (`app/ai/page.tsx`), the JSON
// (`app/ai.json/route.ts`) and the plain-text brief (`app/ai.txt/route.ts`).
// Never write methodology prose directly into any of those three — put it here.
//
// ⚠ DO NOT write a literal over-cap row limit into the prose here. This file
// is inside the read-discipline ratchet's scan roots, so describing the
// footgun in its own notation registers as committing it and fails CI —
// which is exactly what happened when this page was first written. Say what
// the pattern does, not what it looks like.
//
// ⚠ ANTI-DRIFT: `test/ai-methodology.test.js` asserts that every `sourceDoc`
// path still exists in the repo and that every `quote` still appears verbatim
// in the doc it cites. Rename or rewrite a rule in CLAUDE.md and this file
// fails CI until it is updated too. That guard is the only reason a published
// page is allowed to restate rules that live somewhere else.

export const REPO_URL = 'https://github.com/davehess/QuarmBossTracker';
export const commitUrl = (sha: string) => `${REPO_URL}/commit/${sha}`;
export const fileUrl = (path: string) => `${REPO_URL}/blob/main/${path}`;

// ── Principles ──────────────────────────────────────────────────────────────
// The standing rules. `adopted` is the date the rule entered CLAUDE.md (or the
// gate went live), and ties each one to a milestone below so the slider can
// show the ruleset as it stood on any given date.

export type Principle = {
  id: string;
  title: string;
  /** One sentence. What the rule actually requires. */
  rule: string;
  /** Why it exists — always a real incident, never a preference. */
  because: string;
  adopted: string;          // YYYY-MM-DD
  milestone: string;        // milestone id
  sourceDoc: string;        // repo-relative path
  /** Verbatim string that must still appear in sourceDoc (anti-drift check). */
  quote?: string;
};

export const PRINCIPLES: Principle[] = [
  {
    id: 'minimal-diff',
    title: 'Minimal diff',
    rule: 'Change only what the task requires. If it looks like adjacent code must change too, stop and say so before proceeding.',
    because:
      'The bot is one ~18k-line file and the agent one ~35k-line file, so a small line count is a bad proxy for a small blast radius. Reaching into unrelated behaviour is the structural hazard, not diff size.',
    adopted: '2026-07-18',
    milestone: 'm-guardrails',
    sourceDoc: 'CLAUDE.md',
    quote: 'Working rule — minimal diff',
  },
  {
    id: 'index-first',
    title: 'Answer "do we already have X?" from the index',
    rule: 'Read docs/HOW-ITS-BUILT.md first, then grep all four surfaces — bot, web, agent dashboard, Mimic. Never conclude "we do not have that" from one file.',
    because:
      'A feature can span four surfaces. A single grep produced a confident "we do not have that" for the eqclient/Zeal "Set up for me" writer, which already existed. The failure-prone direction is always the negative answer.',
    adopted: '2026-07-19',
    milestone: 'm-index',
    sourceDoc: 'CLAUDE.md',
    quote: 'do we already have X',
  },
  {
    id: 'decisions-written',
    title: 'Decisions get written down, same session',
    rule: 'When the guild lead makes a call — a default, a threshold, a policy, a "we do not do that" — append it to docs/DECISIONS-<date>.md before the session ends, with the reasoning and where it landed.',
    because:
      'Sessions cannot share a conversation and a container reset takes the scratchpad with it. A decision that lives only in chat is lost. Retrieval was never the weak link — writing was.',
    adopted: '2026-08-08',
    milestone: 'm-memory',
    sourceDoc: 'CLAUDE.md',
    quote: 'decisions get WRITTEN DOWN',
  },
  {
    id: 'docs-at-both-gates',
    title: 'Shipping updates the docs in the same change',
    rule: 'A change updates its ledger entry and design doc in the same commit, and again when it graduates from beta to stable. If the doc edit is not in the diff, the ship is not done.',
    because:
      'A ledger that lags its code made the recall tool report a feature as "blocked on the call" the day after it shipped.',
    adopted: '2026-08-11',
    milestone: 'm-memory',
    sourceDoc: 'CLAUDE.md',
    quote: 'shipping updates the docs at BOTH gates',
  },
  {
    id: 'attribution',
    title: 'Attribution is explicit',
    rule: 'Every request in this repo comes from one person under several character names; credit them all to that person. The one exception is the feedback table, whose submitters are other members and keep their own names.',
    because:
      'Character names are also real fixtures in tests and golden logs. Guessing attribution from a name in a code comment is what produced the wrong credits this rule replaced.',
    adopted: '2026-08-09',
    milestone: 'm-attribution',
    sourceDoc: 'CLAUDE.md',
    quote: 'everything is Hitya',
  },
  {
    id: 'raid-freeze',
    title: 'Raid-night deploy freeze',
    rule: 'No pushes to main on Sun/Wed/Thu between 19:30 and 00:30 Eastern. Mid-raid fixes ship with [hotfix] in the commit message.',
    because:
      'A push restarts the production surfaces the raid depends on. Mid-raid restarts amplified a queue backup and announcer spam on 2026-07-13.',
    adopted: '2026-07-13',
    milestone: 'm-freeze',
    sourceDoc: '.github/workflows/raid-freeze.yml',
    quote: 'raid-freeze',
  },
  {
    id: 'fail-open',
    title: 'Fail open',
    rule: 'On missing data, an unknown value, or a dependency being down, degrade to safe defaults. Never crash, never hide data that exists.',
    because:
      'The consumers are raiders mid-pull. A surface that disappears is worse than one that shows less.',
    adopted: '2026-07-18',
    milestone: 'm-guardrails',
    sourceDoc: 'docs/AI-CONTRIBUTOR-BRIEF.md',
    quote: 'Fail open',
  },
  {
    id: 'privacy-byte-level',
    title: 'Private channels never leave the machine',
    rule: 'Officer chat, tells, group and custom channels are dropped at byte level before parsing, on the user PC. Every log-derived stat declares a visibility scope, and opt-out flags are honoured by every consumer.',
    because:
      'The agent reads a player’s whole log file. Filtering after upload would mean the data had already left, so the filter has to run before the parse.',
    adopted: '2026-05-30',
    milestone: 'm-privacy',
    sourceDoc: 'docs/PRIVACY.md',
  },
  {
    id: 'no-dedup-observers',
    title: 'Never deduplicate a per-observer stream',
    rule: 'Live state, threat, casting, target-casts and encounter uploads are per observer. Each one is a distinct fact and is merged, never collapsed.',
    because:
      'Two agents reporting the same fight are two viewpoints, not a duplicate. Collapsing them silently discards the coverage that makes merged parses work.',
    adopted: '2026-07-20',
    milestone: 'm-guardrails',
    sourceDoc: 'docs/AI-CONTRIBUTOR-BRIEF.md',
    quote: 'Never deduplicate a `per_observer` data stream',
  },
  {
    id: 'players-not-characters',
    title: 'Count adoption in players, never characters',
    rule: 'Fleet and adoption numbers count distinct uploading humans, each at their most recent version.',
    because:
      'One person runs 3–12 characters, so character counts inflate roughly tenfold: a "178 characters on the new build" fleet was 16 people.',
    adopted: '2026-08-16',
    milestone: 'm-honest-metrics',
    sourceDoc: 'CLAUDE.md',
    quote: 'Fleet adoption is counted in PLAYERS',
  },
  {
    id: 'one-read-layer',
    title: 'One paginated reader per runtime',
    rule: 'All database reads go through a single paginator per runtime. A second paginator, or a new over-cap .limit(), fails CI.',
    because:
      'PostgREST silently caps every response at 1000 rows, and asking for 5,000 does not lift it — the cap is applied on top, so you get a short array and a success code. The same footgun was rediscovered independently four times, each rediscovery writing its own paginator.',
    adopted: '2026-08-16',
    milestone: 'm-ratchet',
    sourceDoc: 'test/db-read-discipline.test.js',
    quote: 'the database read layer stays ONE layer',
  },
  {
    id: 'postgres-is-home',
    title: 'Postgres is the home; Discord is a projection',
    rule: 'No new durable state goes into Discord messages or the local state file. Postgres holds it; Discord renders it.',
    because:
      'The state file does not persist across deploys, and treating Discord as a source of truth once posted the same raid review eleven times in one night.',
    adopted: '2026-08-16',
    milestone: 'm-honest-metrics',
    sourceDoc: 'CLAUDE.md',
    quote: 'now it should just be a projection',
  },
  {
    id: 'beta-parity',
    title: 'When main gets something, beta gets it too',
    rule: 'A workflow merges main into beta on every push to main. Real conflicts fail the run loudly instead of auto-resolving.',
    because:
      'Nothing flowed main to beta for months. Beta drifted 79,199 lines behind, carried 35 test files against main’s 90, and a priority-one parser bug rode through nine agent releases unseen because the test that would have caught it did not exist on that branch.',
    adopted: '2026-08-10',
    milestone: 'm-beta-sync',
    sourceDoc: '.github/workflows/sync-beta.yml',
  },
  {
    id: 'deployment-decisions',
    title: 'Deployment decisions are recorded as they are made',
    rule: 'Any decision that changes how the platform is deployed, what it stores, or what it costs to run gets a line in the self-host design doc at the time it is made.',
    because:
      'The goal is a wizard that stands the whole platform up for another guild. It can only be built from decisions recorded as they happened; a choice captured only in a runbook is written for one specific box.',
    adopted: '2026-08-12',
    milestone: 'm-selfhost',
    sourceDoc: 'CLAUDE.md',
    quote: 'deployment decisions write to the self-host epic',
  },
  {
    id: 'surface-parity',
    title: 'Every control exists on more than one surface',
    rule: 'A control that ships in the tray menu ships on the dashboard in the same change, driving the same internals — never a parallel path.',
    because:
      'A control that exists in only one place is a control people forget exists. Per-character layout saves sat tray-only for four minor versions before the guild lead discovered them.',
    adopted: '2026-08-19',
    milestone: 'm-parity',
    sourceDoc: 'CLAUDE.md',
    quote: 'tray ↔ dashboard parity',
  },
  {
    id: 'agent-onboarding',
    title: 'Any assistant can pick up the work',
    rule: 'Two onboarding docs are maintained: one for an assistant with repo and shell access, one for a chat with neither. Each says which it is and points at the other.',
    because:
      'Sessions run on different tools and cannot share a conversation. What is not written down for the next one does not survive.',
    adopted: '2026-08-23',
    milestone: 'm-portable',
    sourceDoc: 'docs/GEMINI-SPARK-HELPER.md',
    quote: 'The prime directive',
  },
];

// ── Milestones ──────────────────────────────────────────────────────────────
// Each entry is a real commit. This repo ships by direct push to main rather
// than pull requests, so `commits` are the durable links — see METHOD_NOTES.

export type Milestone = {
  id: string;
  date: string;             // YYYY-MM-DD
  title: string;
  /** What forced it — the incident, measurement or instruction. */
  trigger: string;
  /** What actually changed in the repo. */
  change: string;
  commits: { sha: string; subject: string }[];
  /** Measured outcome, where one exists. Never aspirational. */
  outcome?: string;
};

export const MILESTONES: Milestone[] = [
  {
    id: 'm-genesis',
    date: '2026-04-25',
    title: 'The instructions become a file',
    trigger:
      'The project was a single Discord respawn timer. Context for each session was retyped by hand, so it varied every time.',
    change:
      'CLAUDE.md is committed alongside the deployment config — one file describing the architecture and the rules, versioned with the code it governs.',
    commits: [{ sha: '44ca9487', subject: 'Add Railway deployment config and CLAUDE.md' }],
    outcome: 'Every rule below is an edit to this one file. It now outranks the README where they disagree.',
  },
  {
    id: 'm-privacy',
    date: '2026-05-30',
    title: 'Privacy becomes a constraint, not a feature',
    trigger:
      'The agent reads a raider’s entire EQ log — officer chat, tells, group, custom channels. Filtering after upload would mean the data had already left their machine.',
    change:
      'A written privacy statement, and byte-level filtering before the parse so private channels never enter the pipeline. Visibility scopes and opt-out flags become mandatory on every log-derived stat.',
    commits: [
      { sha: 'b1009ecf', subject: 'privacy statement draft + QoL north star + PoP flagging in queue' },
      { sha: 'd3c9d9a6', subject: 'build: guard against the agent-dashboard escape bug (blank-page class)' },
    ],
    outcome:
      'Later exceptions are narrow and documented: a single carve-out for public "Hail" lines was added for expansion flagging, in the privacy doc and on the member-facing page.',
  },
  {
    id: 'm-index',
    date: '2026-07-07',
    title: 'A feature index, so the answer is not one grep',
    trigger:
      'A session answered "we do not have that" about a feature that already existed, because it checked one of the four surfaces a feature can live on.',
    change:
      'HOW-ITS-BUILT.md maps every feature to its file and surface, and the rule becomes: read the index before answering a does-this-exist question. Twelve days later the rule is written into CLAUDE.md explicitly.',
    commits: [
      { sha: '9dbb9a07', subject: "docs — HOW-ITS-BUILT.md: per-feature 'how X is built' reference" },
      { sha: '05bd892d', subject: "docs — feature-index discipline: CLAUDE.md rule for 'do we have X' questions" },
    ],
    outcome: 'Now 79 documents. A stale index causes exactly the wrong negative answer, so shipping a feature refreshes its row.',
  },
  {
    id: 'm-freeze',
    date: '2026-07-13',
    title: 'The deploy freeze',
    trigger:
      'A mid-raid deploy restarted production surfaces during a raid, amplifying a queue backup and announcer spam.',
    change:
      'No pushes to main inside the raid window. A workflow turns any such push red — advisory, because Railway and Vercel deploy on push regardless. [hotfix] is the escape hatch, because a mid-raid fix is exactly what should ship mid-raid.',
    commits: [{ sha: '2f9c32c6', subject: 'bot v3.0.167 — pre-raid health check, raid-night deploy freeze, mid-raid shed switches' }],
    outcome: 'A tripwire, not a gate. The enforcement that matters is in the instructions; the workflow catches everyone who has not read them.',
  },
  {
    id: 'm-status',
    date: '2026-07-17',
    title: 'One ledger instead of scattered queues',
    trigger: 'Work-in-flight was tracked in several competing documents, so no single one could be trusted.',
    change: 'STATUS.md becomes the single index: done, queued, abandoned, and items that need a session with local-machine access.',
    commits: [{ sha: '0225ad10', subject: 'docs: consolidate scattered queues into STATUS.md + archive superseded' }],
  },
  {
    id: 'm-guardrails',
    date: '2026-07-18',
    title: 'The first real gates',
    trigger:
      'An undeclared global shipped and took a surface down. In an 18k-line file, that class of bug throws only when the offending line executes.',
    change:
      'A deliberately narrow lint tripwire (one rule: no-undef, nothing stylistic), a blocking CI workflow, and the first characterization tests. The minimal-diff rule enters CLAUDE.md the same week.',
    commits: [
      { sha: '243888e8', subject: 'bot v3.0.204 — ESLint no-undef gate + blocking test workflow' },
      { sha: '7d91a4dc', subject: 'bot v3.0.205 — vitest characterization suite + CI test step' },
      { sha: '944a87f1', subject: 'docs — commit .claude settings + minimal-diff rule' },
    ],
    outcome: '6 test files at introduction. 151 files and 2,284 tests today.',
  },
  {
    id: 'm-portable-brief',
    date: '2026-07-20',
    title: 'Onboarding for an assistant that cannot read the repo',
    trigger: 'Work was being drafted in chat tools with no repo access, against guesses about the architecture.',
    change: 'A self-contained brief with the architecture, the guardrails and the review bar, written to be pasted into a fresh chat.',
    commits: [{ sha: 'd6786ade', subject: "docs — AI-CONTRIBUTOR-BRIEF.md: self-contained brief for chat AIs that can't browse the repo" }],
  },
  {
    id: 'm-golden',
    date: '2026-08-02',
    title: 'A regression net for the numbers the raid sees',
    trigger:
      'The log parser produces every figure on a parse card, a damage meter and a kill credit. A silent regression there is forty raiders with wrong numbers on a Sunday night.',
    change:
      'A committed synthetic log is replayed through the shipped parser and diffed against a committed known-good result. Changing it on purpose means regenerating and reading every changed number.',
    commits: [{ sha: '8dac1be5', subject: 'test: #75 golden-log CI + pre-raid drill (agent parser regression net)' }],
    outcome: 'The privacy assertions read the live parser rather than the expectation file, so regenerating the golden can never launder a privacy hole.',
  },
  {
    id: 'm-memory',
    date: '2026-08-08',
    title: 'Project memory',
    trigger:
      'Sessions run on different machines and cannot share a conversation. Decisions made in chat were being re-litigated a week later.',
    change:
      'Dated decision records, a session-start digest that prints open items and live versions, and a recall command that answers questions from the committed docs with citations.',
    commits: [{ sha: '45629403', subject: 'docs — project memory: decision records, a SessionStart digest, and /recall' }],
    outcome: '7 decision records so far. Retrieval was never the weak link — the writing discipline is what this milestone bought.',
  },
  {
    id: 'm-attribution',
    date: '2026-08-09',
    title: 'Attribution stops being guesswork',
    trigger:
      'Credit was being inferred from names in code comments — which is exactly how the wrong credits got there in the first place.',
    change:
      'One rule with one explicit exception, and a named table of who the exception covers. Character names in fixtures are excluded from the rule by construction.',
    commits: [{ sha: '6dae2bdd', subject: 'attribution — everything is Hitya unless it came through the feedback form' }],
  },
  {
    id: 'm-beta-sync',
    date: '2026-08-10',
    title: 'Branch parity becomes automatic',
    trigger:
      'Nothing had ever flowed from main to beta. Beta reached 79,199 lines behind and carried 35 test files against main’s 90 — which is why a priority-one parser bug rode through nine agent releases unseen.',
    change:
      'A workflow merges main into beta on every push to main. Only two deliberately-ahead version files are excluded; any other conflict fails the run loudly rather than picking a side.',
    commits: [{ sha: 'e0ee9cd7', subject: 'ci — when main gets something, beta gets it too' }],
    outcome: '21 automatic syncs so far. The earlier practice — re-syncing by hand at each release — was a snapshot, not a link, and main moves 12–42 commits a day.',
  },
  {
    id: 'm-selfhost',
    date: '2026-08-12',
    title: 'Deployment decisions are written for the next deployment',
    trigger:
      'Retention windows, hosting mix and Discord layout were being decided per-choice and recorded, if at all, in runbooks written for one specific machine.',
    change:
      'Every decision that changes how the platform is deployed, what it stores, or what it costs to run gets a line in the self-host design doc at the moment it is made.',
    commits: [{ sha: 'd017c3b3', subject: 'scripts+docs — the local box becomes an archive that never loses history' }],
    outcome:
      'Retention is treated as a hosting-bill question, not a data-modelling one — hosted storage bills on egress, an on-premises box costs electricity, and the answer differs per deployment.',
  },
  {
    id: 'm-ratchet',
    date: '2026-08-16',
    title: 'A ratchet instead of a ban',
    trigger:
      'PostgREST silently caps every response at 1000 rows. The same footgun was rediscovered four separate times, and each rediscovery wrote its own paginator — three paginators for one problem.',
    change:
      'One paginator per runtime, enforced by test. Existing over-cap call sites are counted into a baseline that may only shrink: converting one lowers it, adding one fails CI.',
    commits: [{ sha: '92447856', subject: 'bot v3.1.49 + web v1.1.58 — one paged reader per runtime, award identity in the schema' }],
    outcome:
      'A ratchet rather than a ban because 85 pre-existing sites could not be converted blind — each needs its ordering key checked by hand.',
  },
  {
    id: 'm-honest-metrics',
    date: '2026-08-16',
    title: 'Metrics have to be honest to be useful',
    trigger:
      'Adoption was being reported in characters. One person runs 3–12, so a "178 characters on the new build" fleet was 16 people — a tenfold overstatement in every graduation argument.',
    change:
      'Adoption counts distinct humans. In the same period, durable state stops going into Discord messages: Postgres is the home, Discord is a projection.',
    commits: [
      { sha: '9b579015', subject: 'docs — fleet counts are PLAYERS not characters (Hitya’s rule)' },
    ],
  },
  {
    id: 'm-parity',
    date: '2026-08-19',
    title: 'A control in one place is a control nobody finds',
    trigger:
      'Per-character layout saves existed for four minor versions in the tray menu only. The guild lead discovered them by accident.',
    change:
      'Anything available from the tray is available from the dashboard in the same change, driving the same internals rather than a parallel path.',
    commits: [{ sha: '99f48a98', subject: 'web v1.1.71 + docs — tray/dashboard parity rule, ledger + roadmap for the parity batch' }],
  },
  {
    id: 'm-portable',
    date: '2026-08-23',
    title: 'The method becomes portable',
    trigger:
      'A different assistant was going to work in this repo, and would get none of the standing instructions automatically — no session-start hook, no accumulated conversation.',
    change:
      'A working guide for any agentic session with repo access: boot order, the per-task loop, branch routing, the full verification gate including the two checks CI does not run, the three test tiers, and the footguns that have each already shipped a bug. Then this page, so the method is legible without a checkout at all.',
    commits: [
      { sha: '4dd1385b', subject: 'docs — a working guide for non-Claude agentic sessions (Gemini Spark)' },
    ],
  },
];

// ── The verification gate ───────────────────────────────────────────────────

export type Gate = {
  command: string;
  protects: string;
  inCi: boolean;
};

export const GATES: Gate[] = [
  {
    command: 'npm run lint',
    protects:
      'A single no-undef tripwire over the two monoliths. An undeclared global in an 18k-line file throws only when that line executes; this catches it statically. Deliberately the only rule — the value is that it is zero-noise.',
    inCi: true,
  },
  {
    command: 'npm run check:dashboard',
    protects:
      'The agent dashboard is one template literal with two layers of escaping; one wrong character blanks the whole page with no partial degradation. This parses every script block it emits, checks a required helper on every collapsible element, and fails if an embedded copy of an overlay has drifted from its source file.',
    inCi: true,
  },
  {
    command: 'npm test',
    protects:
      '151 files, 2,284 tests. Includes guard tests that hold a rule rather than cover a function — the read-layer ratchet, workflow validity, the expansion lock, and the parser golden.',
    inCi: true,
  },
  {
    command: 'cd web && npx tsc --noEmit',
    protects:
      'Type errors in the web app. Not in CI — the only other place this fails is the deploy, i.e. after the push.',
    inCi: false,
  },
  {
    command: 'npm run golden:check',
    protects:
      'That the committed parser expectations still describe the parser. Changing them on purpose means regenerating and reading every changed number, because each one is a change in what the raid sees.',
    inCi: false,
  },
];

// ── Method notes ────────────────────────────────────────────────────────────
// Things an agent needs in order to actually match the workflow, which are not
// principles and not milestones.

export const METHOD_NOTES: { title: string; body: string }[] = [
  {
    title: 'Direct push, not pull requests',
    body:
      'This repo ships by pushing to a branch, not by opening pull requests, so commits are the durable unit of history. Bot, web and docs go to main; the desktop app and its bundled log agent go to a beta branch and graduate by file-level promotion, never by merging the whole branch. Version numbers live in package.json and nowhere else — never in a document.',
  },
  {
    title: 'Write the reason, not the change',
    body:
      'Every rule here records the incident that produced it. "The threshold is 0.5" is worthless in six weeks; "0.5 because our raids measure 0.75–0.89 and outside raids 0.14–0.22, and it matches the constant the other surface already uses" is the whole point. Comments in this codebase carry reasons, not descriptions.',
  },
  {
    title: 'Tests are the record of why',
    body:
      'Tests are named after the behaviour that was asked for and quote the request. Pure logic is extracted into small modules so it can be tested directly. Logic trapped inside a monolith is tested by slicing the real function out of the shipped file and evaluating it, so the test tracks the shipped code and fails loudly if the function is renamed.',
  },
  {
    title: 'Report honestly',
    body:
      'If a test failed, say so with the output. If part of the scope was skipped, say which part and why. Scaling work down is the requester’s call, not the assistant’s. Uncertainty that was not closed gets stated as uncertainty — several rules here exist because a confident wrong answer was cheaper to give than a checked one.',
  },
  {
    title: 'Verify git state before concluding anything is lost',
    body:
      'Cloud containers here come up shallow and with stale refs, so local branch pointers can look dozens of commits behind while the remote is fine. Fetch and check the real remote head before concluding work vanished, and never force-push on the basis of a stale ref.',
  },
];

// ── The task workflow, as a decision tree ───────────────────────────────────
// What an agent actually does with one task, including the branch points.
// Rendered as a tree on /ai and emitted verbatim into /ai.json and /ai.txt, so
// an assistant with no repo access can still follow the same procedure.

export type WorkflowStage = {
  id: string;
  step: string;              // imperative, one line
  detail: string;
  /** Branch points — a question with mutually exclusive answers. */
  branches?: { when: string; then: string }[];
  /** Commands to run at this stage. */
  commands?: string[];
  /** The failure this stage exists to prevent. */
  guards?: string;
};

export const WORKFLOW: WorkflowStage[] = [
  {
    id: 'w-read',
    step: 'Load the committed context',
    detail:
      'CLAUDE.md (architecture and rules; outranks the README), docs/STATUS.md (ledger and queue), docs/HOW-ITS-BUILT.md (feature → file index), then the newest docs/DECISIONS-*.md. Then the design or runbook doc for the area you are touching.',
    guards:
      'Sessions cannot share a conversation. Anything not in a committed file does not reach the next one.',
  },
  {
    id: 'w-locate',
    step: 'Find the real code before deciding it does not exist',
    detail:
      'A feature can live on four surfaces and often spans several: the bot, the web app, the agent dashboard, and the desktop overlays. Check the index, then grep all four.',
    guards: 'The negative answer is the failure-prone one. It has been wrong before.',
  },
  {
    id: 'w-route',
    step: 'Route the change',
    detail:
      'What you touched decides both the branch and which version file moves. Versions live in package.json and nowhere else.',
    branches: [
      { when: 'the Discord bot and its HTTP API', then: 'main · bump the root package.json' },
      { when: 'the website', then: 'main · bump web/package.json' },
      { when: 'the log agent', then: 'beta · bump the agent package.json only' },
      { when: 'the desktop app', then: 'beta · its version stays parked; the release workflow increments the prerelease tag' },
      { when: 'a database migration', then: 'main, as a timestamped idempotent file — and if the column is needed now, apply it AND commit the identical file' },
      { when: 'documentation only', then: 'main · no version bump' },
    ],
    guards:
      'A change spanning bot and agent is two commits on two branches. Cherry-pick between them; never merge the whole branch, because the beta branch carries a deliberately-ahead version and in-flight work.',
  },
  {
    id: 'w-clock',
    step: 'Check the clock before touching production',
    detail:
      'Raids run Sunday, Wednesday and Thursday evenings Eastern. The freeze window is 19:30 to 00:30.',
    branches: [
      { when: 'outside the window', then: 'ship normally' },
      { when: 'inside it, and something is broken right now', then: 'ship with [hotfix] in the commit message' },
      { when: 'inside it, and it can wait', then: 'stage on a working branch and land it after midnight' },
    ],
    guards: 'A push restarts the production surfaces the raid depends on.',
  },
  {
    id: 'w-build',
    step: 'Make the smallest change that does the job',
    detail:
      'Extract the decision into a small pure module where you can; leave the plumbing in place. Fail open on missing data. Never collapse a per-observer stream.',
    guards:
      'Two files here are 18k and 35k lines. Line count is a bad proxy for blast radius.',
  },
  {
    id: 'w-test',
    step: 'Prove it',
    detail:
      'Pure module → import and test it directly. Logic trapped in a monolith → slice the real function out of the shipped file and evaluate it, so the test tracks shipped code. A rule rather than a function → a guard test, and read the header of any guard test that goes red before changing it.',
    guards:
      'Use real fixtures. An invented fixture that is subtly unlike production has shipped bugs here.',
  },
  {
    id: 'w-verify',
    step: 'Run the whole gate',
    detail:
      'All of it, not the parts that seem relevant. Two of these are not in CI, which means the only other place they fail is the deploy.',
    commands: [
      'npm run lint',
      'npm run check:dashboard',
      'npm test',
      'cd web && npx tsc --noEmit   # if the web app changed',
      'npm run golden:check         # if the log parser changed',
    ],
  },
  {
    id: 'w-document',
    step: 'Write the docs into the same commit',
    detail:
      'The ledger entry, the feature index row, the design doc, a dated decision record for any call that was made, and a plain-language release note for anything user-facing. Deployment-shaped decisions also go in the self-host design doc.',
    guards:
      'If the doc edit is not in the diff, the ship is not done. A ledger that lags its code once reported a shipped feature as blocked.',
  },
  {
    id: 'w-ship',
    step: 'Commit, push, and say what actually happened',
    detail:
      'Commit subject is "<component> vX.Y.Z — short reason"; the body explains why, not which files. Push to the branch the routing step named. Then report honestly: failures with their output, skipped scope named as skipped, uncertainty left open stated as uncertainty.',
    guards:
      'Containers here come up shallow and with stale refs. Fetch and check the real remote head before concluding work was lost, and never force-push on a stale ref.',
  },
];

// ── Measured facts ──────────────────────────────────────────────────────────
// Numbers, with the date they were measured. Never aspirational.

export const MEASURED = {
  asOf: '2026-08-23',
  commits: 2088,
  testFiles: 151,
  tests: 2284,
  docs: 79,
  decisionRecords: 7,
  betaSyncs: 21,
  firstCommit: '2026-04-21',
  components: 4,
};

/** Milestones oldest → newest, which is the slider's axis. */
export const TIMELINE = [...MILESTONES].sort((a, b) => a.date.localeCompare(b.date));

/** The ruleset as it stood on a given date — what the slider renders. */
export function principlesAsOf(date: string): Principle[] {
  return PRINCIPLES.filter(p => p.adopted <= date)
    .sort((a, b) => a.adopted.localeCompare(b.adopted) || a.id.localeCompare(b.id));
}
