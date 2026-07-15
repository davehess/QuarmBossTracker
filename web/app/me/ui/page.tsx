// /me/ui — Web UI Studio (Uilnayar 2026-07-06: "UI studio needs a version on
// wolfpack.quest to update these outside of that machine, access backed up UI
// files and macros, find those common macros and suggest updates").
//
// Data flow: UI Studio backups (ui_snapshots) are ENCRYPTED with the bot's
// key, so this page reads the bot-maintained plaintext extracts instead:
//   • ui_socials_index — your characters' macros (service-role read, filtered
//     to your household; socials are PRIVATE scope).
//   • common_macros — guild-wide macros on ≥3 distinct characters (the
//     commonality bar is the privacy filter).
//   • ui_pending_edits — your staged edits + their apply status. The agent on
//     the machine that runs the character picks these up (within ~5 min) and
//     applies them once the character is LOGGED OUT (EQ rewrites the ini from
//     memory on /camp — a live client would clobber the edit).

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';
import { MACRO_SUGGESTIONS } from '@/lib/macroSuggestions';
import UiStudioClient, { type CharUiData, type PendingRow, type CommonMacroRow } from './UiStudioClient';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'UI Studio' };

export default async function MeUiPage() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/');

  const admin = supabaseAdmin();

  // Household + family — same walk /me uses (see loadOwnedCharacters there).
  const { data: pack } = await admin
    .from('wolfpack_members')
    .select('discord_id, merged_into_discord_id')
    .eq('user_id', user.id)
    .maybeSingle();
  const discordId = pack?.discord_id ?? null;
  let chars: string[] = [];
  if (discordId) {
    const householdRoot = pack!.merged_into_discord_id || discordId;
    const { data: aliases } = await admin
      .from('wolfpack_members')
      .select('discord_id')
      .or(`discord_id.eq.${householdRoot},merged_into_discord_id.eq.${householdRoot}`);
    const householdIds = new Set(((aliases ?? []) as { discord_id: string }[]).map(r => r.discord_id).filter(Boolean));
    householdIds.add(discordId);
    householdIds.add(householdRoot);
    const { data: allChars } = await admin
      .from('characters')
      .select('name, main_name, discord_id, active')
      .eq('guild_id', 'wolfpack');
    const all = (allChars ?? []) as { name: string; main_name: string | null; discord_id: string | null; active: boolean | null }[];
    const anchored = all.filter(c => c.discord_id && householdIds.has(c.discord_id));
    const familyRoots = new Set(anchored.map(c => (c.main_name || c.name).toLowerCase()));
    chars = all
      .filter(c => familyRoots.has((c.main_name || c.name).toLowerCase()))
      .sort((a, b) => (a.active === b.active ? 0 : a.active ? -1 : 1) || a.name.localeCompare(b.name))
      .map(c => c.name);
  }

  // Latest snapshot metadata per character (payload stays encrypted/unread).
  const snapByChar = new Map<string, { id: string; label: string | null; created_at: string; file_count: number | null }>();
  // Socials per character from the bot-maintained index.
  const socialsByChar = new Map<string, { page: number; button: number; name: string | null; color: number | null; lines: string[] }[]>();
  let pending: PendingRow[] = [];

  if (discordId && chars.length) {
    const [{ data: snaps }, { data: socials }, { data: pend }] = await Promise.all([
      admin.from('ui_snapshots')
        .select('id, character_name, label, created_at, file_count')
        .eq('owner_discord_id', discordId)
        .order('created_at', { ascending: false })
        .limit(200),
      admin.from('ui_socials_index')
        .select('character, page, button, name, color, lines')
        .eq('guild_id', 'wolfpack')
        .in('character', chars),
      admin.from('ui_pending_edits')
        .select('id, character, note, status, error, created_at, applied_at')
        .eq('owner_discord_id', discordId)
        .order('created_at', { ascending: false })
        .limit(40),
    ]);
    for (const s of (snaps ?? []) as { id: string; character_name: string; label: string | null; created_at: string; file_count: number | null }[]) {
      const k = s.character_name.toLowerCase();
      if (!snapByChar.has(k)) snapByChar.set(k, { id: s.id, label: s.label, created_at: s.created_at, file_count: s.file_count });
    }
    for (const r of (socials ?? []) as { character: string; page: number; button: number; name: string | null; color: number | null; lines: string[] }[]) {
      const k = r.character.toLowerCase();
      if (!socialsByChar.has(k)) socialsByChar.set(k, []);
      socialsByChar.get(k)!.push({ page: r.page, button: r.button, name: r.name, color: r.color, lines: Array.isArray(r.lines) ? r.lines : [] });
    }
    pending = ((pend ?? []) as PendingRow[]);
  }

  const { data: common } = await admin
    .from('common_macros')
    .select('name, lines, char_count, classes')
    .eq('guild_id', 'wolfpack')
    .order('char_count', { ascending: false })
    .limit(40);

  // Class per owned character — seeds the common-macro class filter to the
  // selected character's class ("what do other druids run").
  const classByChar = new Map<string, string>();
  if (chars.length) {
    const { data: classRows } = await admin
      .from('characters')
      .select('name, class')
      .eq('guild_id', 'wolfpack')
      .in('name', chars);
    for (const r of (classRows ?? []) as { name: string; class: string | null }[]) {
      if (r.class) classByChar.set(r.name.toLowerCase(), r.class);
    }
  }

  const charData: CharUiData[] = chars.map(name => ({
    name,
    clazz: classByChar.get(name.toLowerCase()) ?? null,
    snapshot: snapByChar.get(name.toLowerCase()) ?? null,
    socials: (socialsByChar.get(name.toLowerCase()) ?? []).sort((a, b) => a.page - b.page || a.button - b.button),
  }));

  return (
    <div className="space-y-6">
      <section className="bg-panel border border-border rounded-lg p-6">
        <h1 className="text-xl text-gold mb-2">🪟 UI Studio — layouts &amp; macros</h1>
        <p className="text-sm text-dim leading-6">
          Your characters&apos; backed-up UI layouts and social macros, editable from anywhere.
          Macro edits are applied by <b>Mimic on the machine that plays the character</b>, once the
          character is <b>logged out</b> (EQ rewrites its ini from memory on /camp — editing a live
          character would be clobbered). Expect ~5 minutes from staging to applied when Mimic is
          running and the character is offline. Layout (window position) editing stays in Mimic&apos;s
          UI Studio — this page covers macros, backups, and the guild&apos;s common-macro library.
          {' '}<Link href="/me" className="text-blue underline">← back to /me</Link>
        </p>
      </section>
      <UiStudioClient
        chars={charData}
        pending={pending}
        common={((common ?? []) as CommonMacroRow[])}
        suggestions={MACRO_SUGGESTIONS}
        hasDiscordLink={!!discordId}
      />
    </div>
  );
}
