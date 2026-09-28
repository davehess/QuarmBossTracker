// Server side of guild media (web/lib/guildMedia.ts): reads the `guild_media` index with the service role
// and signs the files a page shows, in ONE batch per call. Pages sign what they render; the rest comes
// from /api/media on a click. That keeps a gallery to one auth check per page instead of one per picture
// (the middleware note on the 2026-07-13 auth incident is why that matters).
import { supabaseAdmin } from '@/lib/supabase';
import { MEDIA_BUCKET, parseFilmMaking, type FilmMaking, type MediaItem } from '@/lib/guildMedia';

export type MediaFilter = { collection?: string | null; section?: string | null; character?: string | null };
type Row = {
  id: number; section: string; character_name: string | null; kind: 'image' | 'video';
  path: string; thumb_path: string | null; title: string | null; used: unknown;
};

const SIGN_SECONDS = 6 * 60 * 60;

export async function loadMedia(f: MediaFilter, opts: { limit?: number; offset?: number } = {}): Promise<{ items: MediaItem[]; total: number }> {
  try {
    const sb = supabaseAdmin();
    let q = sb.from('guild_media')
      .select('id, section, character_name, kind, path, thumb_path, title, used:meta->used', { count: 'exact' });
    if (f.collection) q = q.eq('collection', f.collection);
    if (f.section) q = q.eq('section', f.section);
    if (f.character) q = q.ilike('character_name', f.character);     // letters only (isCharacterName), so no wildcards
    const from = Math.max(0, opts.offset ?? 0);
    const { data, count } = await q.order('sort').order('id').range(from, from + (opts.limit ?? 200) - 1);
    const rows = (data ?? []) as Row[];
    const paths = rows.flatMap((r) => (r.thumb_path ? [r.path, r.thumb_path] : [r.path]));
    const signed = new Map<string, string>();
    if (paths.length) {
      const { data: s } = await sb.storage.from(MEDIA_BUCKET).createSignedUrls(paths, SIGN_SECONDS);
      for (const x of s ?? []) if (x.path && x.signedUrl) signed.set(x.path, x.signedUrl);
    }
    return {
      total: count ?? rows.length,
      items: rows.map((r) => ({
        id: r.id, section: r.section, character: r.character_name, kind: r.kind, title: r.title, used: r.used === true,
        thumbUrl: r.thumb_path ? signed.get(r.thumb_path) ?? null : null, url: signed.get(r.path) ?? null,
        name: r.path.split('/').pop() || 'file',
      })),
    };
  } catch {
    return { items: [], total: 0 };
  }
}

// How one file was made: the prompt and the model, for the viewer's "How it was made" line. No cost here.
export async function mediaInfo(id: number): Promise<{ prompt: string | null; model: string | null; resolution: string | null } | null> {
  try {
    const { data } = await supabaseAdmin().from('guild_media').select('meta').eq('id', id).maybeSingle();
    const m = ((data as { meta?: Record<string, unknown> } | null)?.meta ?? null);
    if (!m) return null;
    const s = (k: string) => (typeof m[k] === 'string' ? (m[k] as string) : null);
    return { prompt: s('prompt'), model: s('model'), resolution: s('resolution') };
  } catch {
    return null;
  }
}

export async function loadFilmMaking(): Promise<FilmMaking | null> {
  try {
    const { data } = await supabaseAdmin().from('bot_kv').select('value').eq('key', 'film_making').limit(1).maybeSingle();
    return parseFilmMaking((data as { value?: unknown } | null)?.value);
  } catch {
    return null;
  }
}
