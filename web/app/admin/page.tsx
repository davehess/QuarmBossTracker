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
          title="💬 Guild chat log"
          body="Searchable /gu + /rs history from chat_messages. Filter by date, channel, speaker. Mirrors what the bot pulls from agent uploads."
          href="/admin/chat"
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
