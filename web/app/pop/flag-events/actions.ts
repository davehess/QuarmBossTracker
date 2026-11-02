'use server';

// Officer writes for the flag-event board (/pop/flag-events): post an event, remove one. A server action is a public
// endpoint that anyone can POST to, so each one re-checks the session AND the officer role itself; the page hiding the
// form protects nothing. Everything from the form is validated here (web/lib/flagEvents.ts parseEventForm): the target
// must be in the catalog, the time a real Eastern date, the note short. The service role writes, and every query
// carries the guild. No client script: a form posts, and the page comes back with ?posted=1 or ?error=<code>.
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { isOfficer } from '@/lib/officer';
import { GUILD_TAG } from '@/lib/guild';
import { parseEventForm } from '@/lib/flagEvents';

const BOARD = '/pop/flag-events';
const back = (q: string): never => redirect(`${BOARD}?${q}`);

/** The signed-in officer's auth id, or a redirect back to the board with the reason. */
async function officerOrBack(): Promise<string> {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect(`/auth/signin?next=${BOARD}`);
  if (!(await isOfficer(user.id))) return back('error=officer');
  return user.id;
}

export async function postFlagEvent(formData: FormData): Promise<void> {
  const userId = await officerOrBack();
  const parsed = parseEventForm({
    target_key: formData.get('target_key'),
    starts_at: formData.get('starts_at'),
    note: formData.get('note'),
    rh_event_id: formData.get('rh_event_id'),
  });
  if (!parsed.ok) return back(`error=${parsed.code}`);
  const { target_key, starts_at, note, rh_event_id } = parsed.value;

  const sb = supabaseAdmin();
  // Who is posting, as a Discord id (the board shows their name from wolfpack_members).
  const { data: member } = await sb.from('wolfpack_members').select('discord_id').eq('user_id', userId).maybeSingle();
  const discordId = (member as { discord_id?: string | null } | null)?.discord_id;
  if (!discordId) return back('error=member');

  // A linked Raid-Helper event must be one of this guild's, not any id someone typed.
  if (rh_event_id) {
    const { data: ev } = await sb.from('rh_events').select('id').eq('guild_id', GUILD_TAG).eq('id', rh_event_id).maybeSingle();
    if (!ev) return back('error=rh');
  }

  const { error } = await sb.from('flag_events').insert({
    guild_id: GUILD_TAG, target_key, starts_at, note, rh_event_id, posted_by_discord_id: discordId,
  });
  if (error) return back('error=save');
  revalidatePath(BOARD);
  return back('posted=1');
}

export async function deleteFlagEvent(formData: FormData): Promise<void> {
  await officerOrBack();
  const raw = formData.get('id');
  const id = typeof raw === 'string' && /^\d{1,15}$/.test(raw) ? Number(raw) : null;
  if (id == null) return back('error=id');
  // Any officer may remove any event, not only the one who posted it.
  const { error } = await supabaseAdmin().from('flag_events').delete().eq('guild_id', GUILD_TAG).eq('id', id);
  if (error) return back('error=save');
  revalidatePath(BOARD);
  return back('removed=1');
}
