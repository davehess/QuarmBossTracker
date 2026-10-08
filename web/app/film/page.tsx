// /film — the Aten Ha Ra film (the guild lead, 2026-09-27). Both takes are on YouTube; the links are
// data in bot_kv `film_youtube` (web/lib/film.ts), so the page lights up when they are set, no deploy.
// Both takes stacked, the regular take first.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { parseFilm, type FilmTake } from '@/lib/film';
import LiteYouTube from '@/components/LiteYouTube';

export const metadata = {
  title: 'Aten Ha Ra',
  description: 'The Wolf Pack film of the Aten Ha Ra kill: every raider called by name, in two takes of the song.',
};

export const dynamic = 'force-dynamic';

async function loadTakes(): Promise<FilmTake[]> {
  try {
    const { data } = await supabaseAdmin()
      .from('bot_kv').select('value').eq('key', 'film_youtube').limit(1).maybeSingle();
    return parseFilm((data as { value?: unknown } | null)?.value);
  } catch {
    return [];
  }
}

function TakeHead({ n, take }: { n: number; take: FilmTake }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-gold tabular-nums">{n}</span>
      <h2 className="text-lg text-text">{take.title}</h2>
      {take.length && <span className="text-sm text-dim tabular-nums">{take.length}</span>}
    </div>
  );
}

export default async function FilmPage() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/film');

  const takes = await loadTakes();

  return (
    <main className="mx-auto grid max-w-4xl gap-6 px-4 py-8">
      <header className="grid gap-1">
        <span className="text-xs uppercase tracking-widest text-purple">Vex Thal · Luclin complete</span>
        <h1 className="text-3xl text-text">Aten Ha Ra</h1>
        <p className="max-w-2xl text-sm text-dim">
          The Wolf Pack film: the four-armed queen, then every raider called by name, set to a song made for the kill.
        </p>
        <Link href="/film/making" className="text-sm text-blue hover:underline">How it was made: the song, every name, every take →</Link>
      </header>

      {!takes.length && <p className="text-sm text-dim">The film is not set up yet.</p>}

      {takes.map((t, i) => (
        <section key={t.key} className="grid gap-2">
          <TakeHead n={i + 1} take={t} />
          <LiteYouTube id={t.youtube} title={t.title} poster={t.poster} />
        </section>
      ))}
    </main>
  );
}
