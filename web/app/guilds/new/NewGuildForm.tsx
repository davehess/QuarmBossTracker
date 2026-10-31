'use client';
// The "Start a guild" form. The rules and the one-a-day limit are on the server (actions.ts); this derives the address
// from the name while the player has not typed their own, sends the fields, and shows the answer. On success the
// action redirects to the new guild's page, so there is nothing to do here but wait.
import { useState, useTransition } from 'react';
import { createGuild, type CreateGuildResult } from './actions';
import { slugFromName, NAME_MAX, SLUG_MAX } from '@/lib/hubGuilds';

const INPUT = 'min-h-11 w-full rounded border border-border bg-bg px-3 text-sm text-text';
const LABEL = 'block text-xs text-dim';
const ERR = 'mt-1 text-xs text-red';

export default function NewGuildForm() {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [discordGuildId, setDiscordGuildId] = useState('');
  const [openJoin, setOpenJoin] = useState(false);
  const [result, setResult] = useState<CreateGuildResult | null>(null);
  const [pending, start] = useTransition();

  function onName(v: string) {
    setName(v);
    if (!slugTouched) setSlug(slugFromName(v));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const r = await createGuild({ displayName: name, slug, discordGuildId, openJoin });
      if (r) setResult(r);   // a success redirects and never returns
    });
  }

  const errors = result?.errors ?? {};

  return (
    <form onSubmit={submit} className="mt-4 space-y-4">
      <div>
        <label htmlFor="guild-name" className={LABEL}>Guild name</label>
        <input id="guild-name" value={name} onChange={e => onName(e.target.value)} maxLength={NAME_MAX} autoComplete="off" className={INPUT} placeholder="Wolf Pack" />
        {errors.displayName && <p role="alert" className={ERR}>{errors.displayName}</p>}
      </div>

      <div>
        <label htmlFor="guild-slug" className={LABEL}>Address</label>
        <input
          id="guild-slug"
          value={slug}
          onChange={e => { setSlugTouched(true); setSlug(e.target.value.toLowerCase()); }}
          maxLength={SLUG_MAX}
          autoComplete="off"
          spellCheck={false}
          className={`${INPUT} font-mono`}
          placeholder="wolf-pack"
        />
        <p className="mt-1 text-xs text-dim">Lower-case letters, numbers and dashes. Your guild lives at /guilds/{slug || 'your-address'}.</p>
        {errors.slug && <p role="alert" className={ERR}>{errors.slug}</p>}
      </div>

      <div>
        <label htmlFor="guild-discord" className={LABEL}>Discord server id (optional)</label>
        <input
          id="guild-discord"
          value={discordGuildId}
          onChange={e => setDiscordGuildId(e.target.value.replace(/\s+/g, ''))}
          inputMode="numeric"
          maxLength={25}
          autoComplete="off"
          className={`${INPUT} font-mono`}
          placeholder="123456789012345678"
        />
        <p className="mt-1 text-xs text-dim">Lets members who are in that Discord server find the guild with &ldquo;Find my guilds&rdquo;. You can leave it empty and use invite codes.</p>
        {errors.discordGuildId && <p role="alert" className={ERR}>{errors.discordGuildId}</p>}
      </div>

      <div>
        <label className="flex min-h-11 items-start gap-2 text-sm text-text">
          <input type="checkbox" checked={openJoin} onChange={e => setOpenJoin(e.target.checked)} className="mt-1 h-4 w-4" />
          <span>
            Anyone in the Discord server can join without a code
            <span className="mt-0.5 block text-xs text-dim">Off by default: people then need an invite code from you. It only matters if you set a Discord server id.</span>
          </span>
        </label>
      </div>

      <div>
        <p className={LABEL}>Server</p>
        <p className="min-h-11 rounded border border-border bg-bg/60 px-3 py-3 text-sm text-dim">Project Quarm (EverQuest). Other servers come later.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending || name.trim() === '' || slug === ''}
          className="min-h-11 rounded border border-gold/70 px-5 text-sm text-gold hover:bg-gold/10 disabled:opacity-50"
        >
          {pending ? 'Starting…' : 'Start the guild'}
        </button>
        {result?.message && <p role="alert" className="text-xs text-red">{result.message}</p>}
      </div>
    </form>
  );
}
