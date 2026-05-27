// Landing page — visible without auth. Sign-in widget comes once we wire
// Supabase Discord OAuth (next iteration).
export default function HomePage() {
  return (
    <div className="space-y-6">
      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-xl text-gold mb-3">Welcome to <span className="text-blue">wolfpack.quest</span></h2>
        <p className="text-sm leading-6">
          The guild-wide companion to the Wolf Pack Discord bot. Shared parses, full
          loadout library, theoretical TPS planner. The local agent dashboard at{' '}
          <code>http://localhost:7777</code> still runs your in-raid HUD; this site
          is where you compare against the rest of the pack between fights.
        </p>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card
          title="🗡️ Loadouts"
          body="Every tank's bandolier sets. See who's running what weapons + procs, click through to PQDI."
          href="/loadouts"
        />
        <Card
          title="🧮 Planner"
          body="Build a theoretical loadout from the item database. Estimate hate-per-minute from procs + swings."
          href="/planner"
        />
        <Card
          title="📊 Parses"
          body="History of every uploaded parse, searchable by boss, raider, and night. Multi-perspective merged."
          href="/parses"
        />
      </section>

      <section className="bg-panel border border-border rounded-lg p-6 text-sm text-dim">
        <p>
          Authentication via Discord OAuth lands in the next deploy. Until then the
          pages render shared/anonymous data only — nothing personal.
        </p>
      </section>
    </div>
  );
}

function Card({ title, body, href }: { title: string; body: string; href: string }) {
  return (
    <a href={href} className="block bg-panel border border-border rounded-lg p-4 hover:border-blue transition-colors no-underline">
      <h3 className="text-base text-orange mb-1">{title}</h3>
      <p className="text-xs text-dim leading-5">{body}</p>
    </a>
  );
}
