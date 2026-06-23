// /test-server — proposal for a private practice server, with per-topic
// "I'm interested" buttons and a comments section. Members-only. Replaces
// what would otherwise be a static doc on GitHub — Uilnayar 2026-06-23
// preferred this lives on the site so we can collect signal directly.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { supabaseAdmin }  from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';
import { isOfficer }      from '@/lib/officer';
import InterestButton, { type InterestRow }  from './InterestButton';
import Comments,        { type CommentRow }  from './Comments';

export const dynamic = 'force-dynamic';

// Topic keys + display labels. Keep keys stable — they're persisted on
// test_server_interests.topic. Adding a topic = append here. Removing one
// orphans rows in the DB (harmless; they just stop displaying).
const PHASES: { key: string; label: string; detail: string }[] = [
  { key: 'phase_1_bringup',    label: 'Phase 1 — Bring-up (~5 days)',
    detail: 'Postgres → MySQL conversion, Quarm compile, deploy pipeline, walking around an empty zone. Deliverable: technical members log in to a hardcoded character.' },
  { key: 'phase_2_loadouts',   label: 'Phase 2 — Loadout picker (~3 days)',
    detail: '/me/test-server page on wolfpack.quest: item / AA / spell pickers from the eqemu catalog. Deliverable: pick a loadout in the web, find yourself with it in-game.' },
  { key: 'phase_3_encounters', label: 'Phase 3 — Encounter staging (~3 days)',
    detail: 'Spawn-on-demand for the PoP bosses we care about + auto-snapshot before each pull (reset = restore). Deliverable: officer clicks "start Bertoxxulous", the boss spawns, after the wipe reset rolls back.' },
  { key: 'phase_4_polish',     label: 'Phase 4 — Polish + handoff (~3 days)',
    detail: 'Crash auto-restart, daily snapshot to S3, officer admin page (kick player, wipe session, bring server up/down), docs. Deliverable: runs unattended.' },
];

const HOSTS: { key: string; label: string; detail: string }[] = [
  { key: 'host_aws',   label: 'AWS donation from a team member',
    detail: 't3.medium on-demand ≈ $30/mo, or Spot ≈ $10/mo session-based. Closest to "have an account, set it up."' },
  { key: 'host_vps',   label: 'Hetzner / generic VPS',
    detail: 'Hetzner ≈ $10-20/mo with cheaper bandwidth; EU-located so US latency 90-130ms. Best raw $/perf.' },
  { key: 'host_other', label: 'Other (Linode / DigitalOcean / personal box)',
    detail: 'Got credits? A spare home server? Drop the details in the notes field and we can scope around them.' },
];

const SKILLS: { key: string; label: string; detail: string }[] = [
  { key: 'skill_eqemu_compile', label: 'I’ve compiled EQEmu / Quarm source before',
    detail: 'The biggest force-multiplier — someone who’s built it knows the gotchas. Even an "I poked at it in 2019" is useful.' },
  { key: 'skill_tailscale',     label: 'I run / can run a Tailscale tailnet',
    detail: 'For player access without exposing the server publicly. We extend an existing tailnet or stand up a new one.' },
  { key: 'skill_eq_client_test', label: 'I have a Quarm-compatible EQ client + time to do test-logins',
    detail: 'First 1-2 sessions need a real client logging in to validate gameplay. I can debug from server logs but I can’t see what the player sees.' },
  { key: 'skill_pop_curation',  label: 'I know PoP encounters well enough to curate spawn lists',
    detail: 'Which mobs to seed in which zones, which encounters are worth practising first. Less code, more raid-leader-brain.' },
];

const ZONES: { key: string; label: string; detail: string }[] = [
  { key: 'zone_fire',  label: 'Plane of Fire',  detail: 'Suggested first target — manageable, trash-light by PoP standards.' },
  { key: 'zone_earth', label: 'Plane of Earth', detail: 'The Rathe Council is exactly the kind of encounter rehearsal pays back on.' },
  { key: 'zone_air',   label: 'Plane of Air',   detail: 'Bastion + the storms — group-coordination heavy.' },
  { key: 'zone_water', label: 'Plane of Water', detail: 'Coirnav, but trash is rough — bigger lift to spawn-curate.' },
  { key: 'zone_time',  label: 'Plane of Time',  detail: 'Aspirational. After the elementals work.' },
];

type RawInterest = { user_id: string; topic: string; notes: string | null };
type RawComment  = { id: string; user_id: string; body: string; created_at: string; deleted_at: string | null };

async function load() {
  const admin = supabaseAdmin();
  const [interestsRes, commentsRes, membersRes] = await Promise.all([
    admin.from('test_server_interests')
      .select('user_id, topic, notes')
      .order('created_at', { ascending: true }),
    admin.from('test_server_comments')
      .select('id, user_id, body, created_at, deleted_at')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(500),
    admin.from('wolfpack_members')
      .select('user_id, nickname, global_name, discord_id')
      .not('user_id', 'is', null),
  ]);

  // Resolve user_id → display name. Falls back to discord_id then "Unknown".
  const nameByUserId = new Map<string, string>();
  for (const m of ((membersRes.data ?? []) as { user_id: string; nickname: string | null; global_name: string | null; discord_id: string | null }[])) {
    const label = (m.nickname?.trim() || m.global_name?.trim() || m.discord_id || 'Unknown');
    nameByUserId.set(m.user_id, label);
  }
  const nameFor = (uid: string) => nameByUserId.get(uid) || 'Unknown';

  return {
    interests: (interestsRes.data ?? []) as RawInterest[],
    comments:  (commentsRes.data ?? []) as RawComment[],
    nameFor,
  };
}

export default async function TestServerPage() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/test-server');
  const canModerate = await isOfficer(user.id);

  const { interests, comments, nameFor } = await load();

  // Index interests by topic for the buttons.
  const byTopic = new Map<string, RawInterest[]>();
  for (const i of interests) {
    const list = byTopic.get(i.topic) ?? [];
    list.push(i);
    byTopic.set(i.topic, list);
  }
  const buttonProps = (key: string, label: string) => {
    const rows = byTopic.get(key) ?? [];
    const mine = rows.find(r => r.user_id === user.id);
    const others: InterestRow[] = rows
      .filter(r => r.user_id !== user.id)
      .map(r => ({ user_id: r.user_id, name: nameFor(r.user_id), notes: r.notes }));
    return { topic: key, label, myInterest: { yes: !!mine, notes: mine?.notes ?? null }, others };
  };

  const commentRows: CommentRow[] = comments.map(c => ({
    id: c.id, user_id: c.user_id, name: nameFor(c.user_id),
    body: c.body, created_at: c.created_at, isMine: c.user_id === user.id,
  }));

  return (
    <div className="space-y-6">
      <div className="text-sm flex items-center gap-2">
        <Link href="/me" className="text-blue hover:underline">← back to /me</Link>
        <span className="text-dim">·</span>
        <span className="text-dim">proposal for discussion</span>
      </div>

      {/* Header */}
      <section className="bg-panel border border-border rounded-lg p-6">
        <h1 className="text-2xl text-gold flex items-center gap-3">
          🧪 Wolf Pack test server
          <span className="text-[10px] tracking-widest font-bold px-2 py-0.5 rounded bg-orange/20 border border-orange/60 text-orange uppercase">Proposal</span>
        </h1>
        <p className="text-sm text-dim leading-6 mt-2">
          A private practice server for guild raid prep. EverQuest emulator
          (Quarm fork), seeded from our existing world-data mirror, with
          character loadouts driven by wolfpack.quest. Goal: let 6-24
          guildmates rehearse PoP fights without taking a raid slot or
          touching real Quarm character state.
        </p>
        <p className="text-sm text-dim leading-6 mt-2">
          <b className="text-text">This page is the proposal.</b> Hit
          “interested” next to anything you’d be willing to contribute to
          — phases of the build, hosting, skills you bring — and drop
          comments at the bottom with concerns / alternatives /
          “absolutely not, here’s why.” Nothing here is committed
          until the guild’s pulse is clear.
        </p>
      </section>

      {/* Why */}
      <section className="bg-panel border border-border rounded-lg p-5 space-y-2">
        <h2 className="text-lg text-orange">Why</h2>
        <p className="text-sm text-text/90">
          PoP encounters (Fire/Earth/Air, then the gods) reward muscle
          memory. A handful of us haven’t tanked wave phases on Hoshkar or
          seen Bertox’s dispel patterns. A scratch server where we can
          wipe to a boss without consequence is the right call.
        </p>
        <p className="text-sm text-text/90">
          Existing testing options — alts on live, fights without “the
          good gear” — don’t actually rehearse the encounter. A private
          copy of the boss with our actual loadouts does.
        </p>
      </section>

      {/* Non-goals */}
      <section className="bg-panel border border-border rounded-lg p-5">
        <h2 className="text-lg text-orange mb-2">Non-goals</h2>
        <ul className="text-sm text-text/90 space-y-1 list-disc list-inside">
          <li>Not a replacement for playing on real Quarm — levelling,
              loot, attendance, DKP all stay there.</li>
          <li>Not public. Guildmate-only, Tailscale-gated.</li>
          <li>Not a long-running character sandbox. Sessions are
              ephemeral; gear / AAs / spells come from wolfpack.quest
              loadouts.</li>
          <li>Not a way to “test” content not yet released on Quarm.</li>
        </ul>
      </section>

      {/* Architecture */}
      <section className="bg-panel border border-border rounded-lg p-5">
        <h2 className="text-lg text-orange mb-2">Architecture</h2>
        <p className="text-sm text-text/90 mb-2">
          Three pieces talking over HTTPS + SSH + Tailscale:
        </p>
        <ul className="text-sm text-text/90 space-y-1 list-disc list-inside">
          <li><b>wolfpack.quest</b> hosts the loadout picker (existing item /
              spell / AA catalogs become a build tool), Discord OAuth signs
              players in, the new <code>/me/test-server</code> page saves
              loadouts to a Supabase table.</li>
          <li><b>Donated VPS / EC2</b> runs MySQL + the Quarm server binary +
              a controller daemon, all in Docker. GitHub Actions handles
              deploys — nobody SSHs after the one-time setup.</li>
          <li><b>Supabase (existing)</b> stays the source of truth for world
              data (29 eqemu_* tables, ~350k rows already mirrored) and
              loadouts. The VPS replicates content into MySQL nightly.</li>
        </ul>
        <pre className="text-[10px] text-dim bg-bg/40 border border-border/40 rounded p-3 mt-3 overflow-x-auto leading-tight">{`
wolfpack.quest                 Donated EC2 / VPS              Supabase
   /me/test-server   ◀──────▶   Docker:                  ◀──▶  • world mirror
   - pick loadout                MySQL + Quarm                    (29 tables)
   - boss spawn UI               + controller daemon              • loadouts
                                 Tailscale ingress                • lookups
                                       ▲
                                       │
                                  guildmates' EQ clients
`}</pre>
      </section>

      {/* Phased plan */}
      <section className="bg-panel border border-border rounded-lg p-5 space-y-3">
        <h2 className="text-lg text-orange">Phased plan — ~3 weeks total</h2>
        <p className="text-sm text-dim">
          Each phase ends with a usable deliverable the team can react to.
          Hit “I’m interested” next to anything you’d want to help land.
        </p>
        {PHASES.map(p => (
          <div key={p.key} className="space-y-1.5">
            <InterestButton {...buttonProps(p.key, p.label)} />
            <p className="text-xs text-dim pl-2">{p.detail}</p>
          </div>
        ))}
      </section>

      {/* Cost */}
      <section className="bg-panel border border-border rounded-lg p-5">
        <h2 className="text-lg text-orange mb-2">Cost</h2>
        <table className="text-sm w-full">
          <tbody className="divide-y divide-border/40">
            <tr><td className="py-1.5 text-text/90">EC2 t3.medium on-demand (always-on)</td><td className="py-1.5 text-right text-dim">~$30/mo</td></tr>
            <tr><td className="py-1.5 text-text/90">EBS 30 GB gp3</td><td className="py-1.5 text-right text-dim">~$3/mo</td></tr>
            <tr><td className="py-1.5 text-text/90">Egress (24-player raid sessions, few/mo)</td><td className="py-1.5 text-right text-dim">~$1-2/mo</td></tr>
            <tr><td className="py-1.5 text-text/90">S3 backup (~5 GB)</td><td className="py-1.5 text-right text-dim">~$0.15/mo</td></tr>
            <tr className="border-t-2 border-border/60"><td className="py-1.5 text-text font-bold">Total — always-on</td><td className="py-1.5 text-right text-text font-bold">~$35/mo</td></tr>
            <tr><td className="py-1.5 text-text/90 italic">Alternative: Spot + session-based start</td><td className="py-1.5 text-right text-text italic">~$10/mo</td></tr>
          </tbody>
        </table>
        <p className="text-xs text-dim mt-2">
          Charged to whoever donates the account. Bigger instance
          (<code>t3.large</code> ~$60/mo) if PoP zones with heavy trash bog
          us down.
        </p>
      </section>

      {/* Hosting — buttons */}
      <section className="bg-panel border border-border rounded-lg p-5 space-y-3">
        <h2 className="text-lg text-orange">Where to host — pick what you’d back</h2>
        {HOSTS.map(h => (
          <div key={h.key} className="space-y-1.5">
            <InterestButton {...buttonProps(h.key, h.label)} />
            <p className="text-xs text-dim pl-2">{h.detail}</p>
          </div>
        ))}
      </section>

      {/* Zones */}
      <section className="bg-panel border border-border rounded-lg p-5 space-y-3">
        <h2 className="text-lg text-orange">Which zones first — vote with “interested”</h2>
        {ZONES.map(z => (
          <div key={z.key} className="space-y-1.5">
            <InterestButton {...buttonProps(z.key, z.label)} />
            <p className="text-xs text-dim pl-2">{z.detail}</p>
          </div>
        ))}
      </section>

      {/* Skills wanted */}
      <section className="bg-panel border border-border rounded-lg p-5 space-y-3">
        <h2 className="text-lg text-orange">What I’m looking for from the team</h2>
        <p className="text-sm text-dim">
          The blockers I can’t handle from this seat. Even one person on
          each line moves this from “interesting idea” to “buildable.”
        </p>
        {SKILLS.map(s => (
          <div key={s.key} className="space-y-1.5">
            <InterestButton {...buttonProps(s.key, s.label)} />
            <p className="text-xs text-dim pl-2">{s.detail}</p>
          </div>
        ))}
      </section>

      {/* Honest constraints */}
      <section className="bg-panel border border-border rounded-lg p-5">
        <h2 className="text-lg text-orange mb-2">Honest constraints from my side</h2>
        <ul className="text-sm text-text/90 space-y-1 list-disc list-inside leading-6">
          <li><b>I can build everything as code</b> — Postgres conversion,
              server Docker setup, deploy pipeline, wolfpack.quest UI,
              controller, character seeding, snapshots, monitoring.</li>
          <li><b>I cannot SSH into a third-party server.</b> GitHub Actions
              handles deploys; the donor adds three secrets
              (<code>TESTSERVER_HOST</code>, <code>TESTSERVER_USER</code>,
              <code>TESTSERVER_SSH_KEY</code>) and we’re hands-off.</li>
          <li><b>I cannot validate gameplay</b> — no EQ client. First 1-2
              sessions need a person doing actual test-logins; I debug
              from server logs.</li>
          <li><b>I cannot guarantee EQEmu source compatibility.</b>
              Upstream moves. We pin a version and update intentionally.</li>
          <li><b>I cannot operate it long-term.</b> Occasional crashes /
              binary updates need a human — Phase 4 documents what those
              tasks look like.</li>
        </ul>
      </section>

      {/* Risks */}
      <section className="bg-panel border border-border rounded-lg p-5">
        <h2 className="text-lg text-orange mb-2">Risks and what we’d do about them</h2>
        <table className="text-sm w-full">
          <thead>
            <tr className="text-dim text-left text-xs">
              <th className="py-1 pr-3 w-[42%]">Risk</th>
              <th className="py-1">Mitigation</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            <tr><td className="py-1.5 pr-3 text-text/90">EQEmu source doesn’t compile cleanly</td><td className="py-1.5 text-dim">Target Ubuntu 22.04 (EQEmu-documented); budget a debug round in Phase 1</td></tr>
            <tr><td className="py-1.5 pr-3 text-text/90">Loadouts produce invalid character_data (skill/level mismatch)</td><td className="py-1.5 text-dim">Validation in the picker; controller rejects bad combos with a clear error</td></tr>
            <tr><td className="py-1.5 pr-3 text-text/90">Server crashes mid-session</td><td className="py-1.5 text-dim">systemd restart + Discord webhook; auto-snapshot pre-encounter</td></tr>
            <tr><td className="py-1.5 pr-3 text-text/90">AWS bandwidth bill surprises</td><td className="py-1.5 text-dim">Tailscale carries most traffic off AWS egress; monitor month 1</td></tr>
            <tr><td className="py-1.5 pr-3 text-text/90">Daybreak takedown</td><td className="py-1.5 text-dim">Private + Tailscale-only is the safe posture; we’re not the first guild</td></tr>
            <tr><td className="py-1.5 pr-3 text-text/90">Donor’s account billed unexpectedly</td><td className="py-1.5 text-dim">Hard budget alarm; auto-stop instance over $50/mo</td></tr>
          </tbody>
        </table>
      </section>

      {/* Comments */}
      <section className="bg-panel border border-border rounded-lg p-5">
        <h2 className="text-lg text-orange mb-3">Discussion</h2>
        <Comments rows={commentRows} canModerate={canModerate} />
      </section>
    </div>
  );
}
