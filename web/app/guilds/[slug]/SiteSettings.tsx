'use client';
// The "Website" form of a guild's page, for an owner or officer: the guild's own site and the switch that sends its members
// there from raidmimic.com. The rules and the role check are on the server (actions.ts saveGuildSite); this only sends the
// two values and shows the answer.
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveGuildSite, type SiteResult } from './actions';
import { SITE_URL_MAX } from '@/lib/guildSites';

export default function SiteSettings({ slug, url, redirectMembers }: { slug: string; url: string | null; redirectMembers: boolean }) {
  const [site, setSite] = useState(url ?? '');
  const [redirect, setRedirect] = useState(redirectMembers);
  const [result, setResult] = useState<SiteResult | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const r = await saveGuildSite(slug, site, redirect);
      setResult(r);
      if (r.ok) { setSite(r.url ?? ''); router.refresh(); }
    });
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-3">
      <div>
        <label htmlFor="guild-site" className="block text-xs text-dim">Website address</label>
        <input
          id="guild-site"
          type="url"
          inputMode="url"
          value={site}
          onChange={e => setSite(e.target.value)}
          maxLength={SITE_URL_MAX}
          autoComplete="off"
          spellCheck={false}
          placeholder="https://your-guild.example"
          className="mt-1 min-h-11 w-full rounded border border-border bg-bg px-3 text-sm text-text"
        />
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm text-text">
        <input type="checkbox" checked={redirect} onChange={e => setRedirect(e.target.checked)} className="h-4 w-4" />
        Send members to this site when they sign in on raidmimic.com
      </label>
      <button
        type="submit"
        disabled={pending}
        className="min-h-11 rounded border border-gold/70 px-4 text-sm text-gold hover:bg-gold/10 disabled:opacity-50"
      >
        {pending ? 'Saving…' : 'Save'}
      </button>
      {result && <p role="status" className={`text-xs ${result.ok ? 'text-green' : 'text-red'}`}>{result.message}</p>}
    </form>
  );
}
