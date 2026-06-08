// Admin landing — officer-only. Auth + officer gating handled by parent layout.
import Link from 'next/link';

export default function AdminPage() {
  return (
    <div className="space-y-6">
      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-xl text-gold mb-3">🛡️ Officer Tools</h2>
        <p className="text-sm text-dim">
          You're seeing this because you have the Officer or Pack Leader role on
          Discord. Tools here are for raid lead / loot council / parse review
          work that shouldn't be exposed to the general guild membership.
        </p>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card
          title="⚔️ Encounter audit"
          body="HP-vs-damage health for every encounter, duplicate detection, merge action, mark-incomplete, and file backfill requests when parses underreported."
          href="/admin/encounters"
        />
        <Card
          title="👥 Member dashboard"
          body="Silent-member outreach list. Cross-references guild members against character roster, chat, parses, and /who observations to find inactive raiders and roster gaps."
          href="/admin/members"
        />
        <Card
          title="👁 /who directory"
          body="Every character ever seen in a /who — sortable, filterable. Set a class for /anon rows that never reported one, and flag Zek for PvP-guild affiliates. Edits persist to who_overrides."
          href="/admin/who"
        />
        <Card
          title="💬 Guild chat log"
          body="Searchable /gu + /rs history from chat_messages. Filter by date, channel, speaker. Mirrors what the bot pulls from agent uploads."
          href="/admin/chat"
        />
        <Card
          title="🔗 Character → Discord links"
          body="Set or correct characters.discord_id. Auto-suggests matches from member nicknames + main-name fallback; manual dropdown for the rest. Required for owner-only views (PvP deaths, future loot history)."
          href="/admin/links"
        />
        <Card
          title="🎒 Quarmy URLs"
          body="Bulk-set characters.quarmy_url. Per-row edit and a bulk-paste mode for quickly seeding URLs across the roster."
          href="/admin/quarmy"
        />
        <Card
          title="🛰️ Agent fleet"
          body="Who's uploading right now, who's gone stale, which agent versions are deployed, recent errors. Plus the backfill request board (pending / acked / completed / dismissed)."
          href="/admin/agents"
        />
        <Card
          title="📜 Audit log"
          body="Searchable mirror of the audit trail thread — filter by actor, action, boss name, date range. Bot v2.5.35+ mirrors every kill/unkill/updatetimer."
          href="/admin/audit"
        />
        <Card
          title="📬 Feedback inbox"
          body="Every submission — Discord /feedback AND the wolfpack.quest/feedback form — with status tracking. Acknowledge / mark addressed / add officer notes without scrolling the Discord thread."
          href="/admin/feedback"
        />
        <Card
          title="📋 Sign-up accuracy"
          body="Raid-Helper events vs reality (parses + /who). Find no-shows, exceeded-tentatives, and people who showed up without signing up."
          href="/admin/signups"
        />
        <Card
          title="📊 Attendance roster"
          body="Class-by-class active roster ≥50% RA in last 30 days vs 60-man target. Color-coded for new attendees and downturn. Replaces the leader's spreadsheet."
          href="/admin/attendance"
        />
        <Card
          title="⚡ Raid triggers"
          body="Officer-tuned callouts (rampage, AE, phase changes, breath) that fire as text overlays on each member's agent during the raid. Centralizes what every raider used to maintain in their own GINA pack."
          href="/admin/triggers"
        />
        <Card
          title="🎙️ Voice triggers"
          body="Ripcord + tunables for the bot speaking in raid voice. Master enable, default voice, volume slider, skip patterns (for muting noisy callouts mid-fight). Settings propagate in ~30s."
          href="/admin/voice"
        />
        <Card
          title="🗡️ Loadouts"
          body="Every tank's bandolier sets — who's running what weapons + procs, click through to PQDI. Parked here while not in active use."
          href="/loadouts"
        />
        <Card
          title="🧮 Planner"
          body="Build a theoretical loadout from the item database; estimate hate-per-minute from procs + swings. Parked here while not in active use."
          href="/planner"
        />
      </section>
    </div>
  );
}

function Card({ title, body, href }: { title: string; body: string; href: string }) {
  return (
    <Link href={href} className="block bg-panel border border-border rounded-lg p-4 hover:border-blue transition-colors no-underline">
      <h3 className="text-base text-orange mb-1">{title}</h3>
      <p className="text-xs text-dim leading-5">{body}</p>
    </Link>
  );
}
