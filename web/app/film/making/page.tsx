// /film/making — how the Aten Ha Ra film was made (the guild lead, 2026-09-28: "all of this ... into a page
// on wolfpack.quest, with this process, all of the pronunciations, everything that went into making it").
// Members only. The pictures and clips come from guild media (web/lib/guildMedia.ts); the names, how each
// is said and when each take sings it come from bot_kv `film_making`, never the repo.
// Find-your-raider sits at the top ("make sure people can filter just see specific characters at the top",
// the guild lead, 2026-09-28); the story follows, chapter by chapter. ?raider=<name> opens on that raider.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { parseFilm } from '@/lib/film';
import { clock, type FilmMaking } from '@/lib/guildMedia';
import { loadFilmMaking, loadMedia } from '@/lib/guildMediaLoad';
import MediaGrid from '@/components/MediaGrid';
import RaiderFinder, { type FinderRaider } from './RaiderFinder';

export const metadata = {
  title: 'How the film was made',
  description: 'The Aten Ha Ra film from the inside: the song, how every name is sung, every picture and animation take, and the outtakes.',
};
export const dynamic = 'force-dynamic';

const SET = 'aten-ha-ra';
const FIRST = 12;

async function youtubeIds(): Promise<Record<string, string | null>> {
  try {
    const { data } = await supabaseAdmin().from('bot_kv').select('value').eq('key', 'film_youtube').limit(1).maybeSingle();
    return Object.fromEntries(parseFilm((data as { value?: unknown } | null)?.value).map((t) => [t.key, t.youtube]));
  } catch {
    return {};
  }
}

// One chapter: a heading, a few lines, then the pictures of one or more sections.
async function Chapter({ n, title, children, sections, character = true }: {
  n: number; title: string; children: React.ReactNode; sections: string[]; character?: boolean;
}) {
  const sets = await Promise.all(sections.map((s) => loadMedia({ collection: SET, section: s }, { limit: FIRST })));
  return (
    <section className="grid gap-3 border-t border-border pt-6" id={`ch${n}`}>
      <h2 className="flex items-baseline gap-3 text-xl text-text"><span className="text-gold tabular-nums">{n}</span>{title}</h2>
      <div className="grid max-w-3xl gap-2 text-sm text-dim">{children}</div>
      {sets.map((m, i) => m.items.length > 0 && (
        <MediaGrid key={sections[i]} initial={m.items} total={m.total} showCharacter={character}
          query={`collection=${SET}&section=${sections[i]}`} />
      ))}
    </section>
  );
}

function Pronunciations({ fm, youtube }: { fm: FilmMaking; youtube: Record<string, string | null> }) {
  const at = (key: string, t: { t: number } | null) => {
    if (!t) return <span className="text-dim">—</span>;
    const id = youtube[key];
    return id
      ? <a href={`https://www.youtube.com/watch?v=${id}&t=${Math.floor(t.t)}s`} target="_blank" rel="noreferrer" className="text-blue hover:underline">{clock(t.t)}</a>
      : <span>{clock(t.t)}</span>;
  };
  return (
    <div className="overflow-x-auto rounded border border-border">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="bg-panel text-left text-xs uppercase tracking-wider text-dim">
          <tr>
            <th className="px-2 py-1.5 font-normal">#</th><th className="px-2 py-1.5 font-normal">Raider</th>
            <th className="px-2 py-1.5 font-normal">Class</th><th className="px-2 py-1.5 font-normal">Written for the song as</th>
            {fm.song.takes.map((t) => <th key={t.key} className="px-2 py-1.5 font-normal">{t.title}</th>)}
            <th className="px-2 py-1.5 font-normal">What the transcriber heard</th>
          </tr>
        </thead>
        <tbody>
          {fm.raiders.map((r) => (
            <tr key={r.name} className={`border-t border-border ${r.inFilm ? '' : 'text-dim'}`}>
              <td className="px-2 py-1 tabular-nums text-dim">{r.n}</td>
              <td className="px-2 py-1"><Link href={`/character/${encodeURIComponent(r.name)}`} className="hover:text-gold">{r.name}</Link></td>
              <td className="px-2 py-1 text-dim">{r.cls}</td>
              <td className="px-2 py-1 text-gold">{r.say || <span className="text-dim">not in the cut</span>}</td>
              {fm.song.takes.map((t) => <td key={t.key} className="px-2 py-1 tabular-nums">{at(t.key, t.key === 'regular' ? r.regular : t.key === 'remix' ? r.remix : null)}</td>)}
              <td className="px-2 py-1 text-dim">{r.regular?.heard || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function MakingPage({ searchParams }: { searchParams: { raider?: string } }) {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/film/making');

  const [fm, youtube, firsts] = await Promise.all([
    loadFilmMaking(), youtubeIds(), loadMedia({ collection: SET, section: 'first-still' }, { limit: 200 }),
  ]);

  const head = (
    <header className="grid gap-2">
      <Link href="/film" className="text-sm text-blue hover:underline">← the film</Link>
      <span className="text-xs uppercase tracking-widest text-purple">Aten Ha Ra · behind the scenes</span>
      <h1 className="text-3xl text-text">How the film was made</h1>
      {fm && (
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-dim tabular-nums">
          <span><span className="text-text">{fm.stats.cards}</span> raiders drawn</span>
          <span><span className="text-text">{fm.stats.inFilm}</span> in the film</span>
          <span><span className="text-text">{fm.stats.pictures}</span> pictures</span>
          <span><span className="text-text">{fm.stats.renders}</span> animations</span>
          <span><span className="text-text">{fm.song.takes.length}</span> takes of the song</span>
        </p>
      )}
      <p className="max-w-3xl text-sm text-dim">
        Pictures by an image model (Gemini), set moving by a video model (LTX), sung by Suno, and cut to the beat with
        ffmpeg, Demucs to lift the voice off the music, and Whisper to time every word. Open anything to play it,
        save it, or read the prompt that made it.
      </p>
    </header>
  );

  if (!fm) {
    return <main className="mx-auto grid max-w-5xl gap-6 px-4 py-8">{head}<p className="text-sm text-dim">The making-of is not set up yet.</p></main>;
  }

  const thumb = new Map(firsts.items.map((i) => [i.character, i.thumbUrl]));
  const raiders: FinderRaider[] = fm.raiders.map((r) => ({ ...r, thumbUrl: thumb.get(r.name) ?? null }));

  return (
    <main className="mx-auto grid max-w-5xl gap-6 px-4 py-8">
      {head}
      <RaiderFinder raiders={raiders} youtube={youtube} takes={fm.song.takes} initialPick={searchParams.raider ?? null} />
      <nav className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-6 text-sm">
        <span className="text-dim">How it was made:</span>
        {['The song', 'Ninety-eight pictures', 'Into action', 'Making them move', 'Four arms', 'Classes, opening, end', 'Cutting to the song', 'Outtakes', 'Take it home']
          .map((t, i) => <a key={t} href={`#ch${i + 1}`} className="text-blue hover:underline">{t}</a>)}
      </nav>

      <section className="grid gap-3 border-t border-border pt-6" id="ch1">
        <h2 className="flex items-baseline gap-3 text-xl text-text"><span className="text-gold tabular-nums">1</span>The song</h2>
        <div className="grid max-w-3xl gap-2 text-sm text-dim">
          <p>
            The song was made in Suno from a lyric sheet that spells every name the way it is said: capitals on the
            stressed part, dashes between the sounds. Suno cannot follow timestamps, so the film was cut to the song
            afterwards, not the other way round.
            {fm.song.bpm ? <> It runs at about <span className="text-text tabular-nums">{Math.round(fm.song.bpm)}</span> beats a minute.</> : null}
          </p>
          <p>
            The times below are when each take sings the name{Object.values(youtube).some(Boolean) ? '; click one to hear it' : ''}.
            The last column is what a speech-to-text model heard in the regular take, which is sometimes the joke.
          </p>
        </div>
        <Pronunciations fm={fm} youtube={youtube} />
        <details className="max-w-3xl rounded border border-border bg-panel p-3 text-sm">
          <summary className="cursor-pointer text-dim hover:text-text">The lyric sheet and the style, as given to Suno</summary>
          {fm.song.style && <p className="mt-2 text-dim">Style: <span className="text-text">{fm.song.style}</span></p>}
          <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-text">{fm.song.lyrics}</pre>
        </details>
      </section>

      <Chapter n={2} title="Ninety-eight pictures" sections={['first-still']}>
        <p>
          Every raider got one picture first, drawn by an image model from their class, their race and a look, in the
          style of a late-90s anime opening. {fm.stats.cards} were drawn; {fm.stats.inFilm} made the film.
        </p>
      </Chapter>
      <Chapter n={3} title="Into action" sections={['action-still']}>
        <p>
          The second round redrew each raider in the film mid-move, from a new angle, with the first picture as the
          reference so the look carried over. Some needed a second try.
        </p>
      </Chapter>
      <Chapter n={4} title="Making them move" sections={['take']}>
        <p>
          Each action still became a six-second animation. A few took three or four tries: faces drifted, a weapon
          changed hands, one raider walked off-model entirely. The take marked <span className="text-gold">film</span> is
          the one in the cut.
        </p>
        <p>
          The first set of raider clips looked smeared. The animations are drawn on twos, like real anime, and software
          was asked to invent the missing in-between frames. The clips now use every frame exactly as it was drawn.
        </p>
      </Chapter>
      <Chapter n={5} title="Four arms" sections={['cold-open']}>
        <p>
          Aten Ha Ra has four arms. The video model kept giving her two, so every shot of her starts from a picture
          that already has four. The first takes are here, two-armed and all.
        </p>
      </Chapter>
      <Chapter n={6} title="Classes, the opening and the end" sections={['class-intro', 'opening-ending', 'transition']} character={false}>
        <p>Each class got a group picture and a short animation for its shout in the song, plus the shots that open and close the film.</p>
      </Chapter>
      <Chapter n={7} title="Cutting to the song" sections={['cut']} character={false}>
        <p>
          The song was split into voice and music, every word was timed, and each raider was placed on the beat their
          name is sung. Before the song existed there were six rough cuts and three versions of the names montage.
        </p>
      </Chapter>
      <Chapter n={8} title="Outtakes and tests" sections={['test', 'cover']} character={false}>
        <p>The early tests, and every cover that was tried before the two that were used.</p>
      </Chapter>
      <Chapter n={9} title="Take it home" sections={['film', 'clip', 'song-clip']}>
        <p>
          Both takes of the film in 720p, each raider&apos;s own six seconds exactly as drawn, and the older clips with the
          name card and their name sung. Open one and press Save. Every raider&apos;s pictures are on their character page too.
        </p>
      </Chapter>
    </main>
  );
}
