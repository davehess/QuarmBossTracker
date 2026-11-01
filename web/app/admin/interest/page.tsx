// Officer tool: guild interest, the submissions from the "Register your guild" form on raidmimic.com/register.
//
// Everything here was typed by a stranger. It was cleaned before it was stored (lib/guildInterest.ts), but it is still
// untrusted text: it is rendered as PLAIN TEXT only (React text nodes, no HTML, no links, no markdown), and nothing on
// this page acts on it. ip_hash is not selected: it exists only for the form's rate limit.
import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase';
import { requireOfficer } from '@/lib/officer';
import NewPageTag from '@/components/NewPageTag';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: '[beta] Guild interest',
  description: 'Guilds that registered their interest on raidmimic.com, newest first.',
};

type Row = {
  id: string;
  created_at: string;
  guild_name: string;
  game: string | null;
  server: string | null;
  raiders: number | null;
  nights: string[] | null;
  dkp: string | null;
  heard: string | null;
  discord_contact: string | null;
  status: string;
};

const GAME: Record<string, string> = { quarm: 'Project Quarm', 'eq-live': 'EverQuest live', other: 'Other' };
const DKP: Record<string, string> = { opendkp: 'OpenDKP', eqdkp: 'EQDKP', other: 'Other', none: 'None' };

function fmtTs(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

export default async function GuildInterestPage() {
  await requireOfficer();
  const { data } = await supabaseAdmin()
    .from('guild_interest')
    .select('id, created_at, guild_name, game, server, raiders, nights, dkp, heard, discord_contact, status')
    .order('created_at', { ascending: false })
    .limit(300);
  const rows = (data ?? []) as Row[];

  return (
    <div className="space-y-6">
      <div className="text-sm flex gap-4 flex-wrap">
        <Link href="/admin" className="text-blue hover:underline">← back to admin</Link>
      </div>

      <NewPageTag note="New page, still being shaped." />

      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-xl text-gold mb-1">Guild interest</h2>
        <p className="text-sm text-dim leading-6">
          Guilds that filled in the form on raidmimic.com/register, newest first. Strangers typed all of it. Links, emails,
          addresses and keys were removed before saving, and it is shown here as plain text. Nothing here is acted on
          automatically; a person reads it and replies.
        </p>
      </section>

      {rows.length === 0 ? (
        <section className="bg-panel border border-border rounded-lg p-6 text-sm text-dim">Nothing yet.</section>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-xs">
            <thead className="bg-panel text-dim">
              <tr>
                {['When', 'Guild', 'Game', 'Raiders', 'Nights', 'DKP', 'Heard', 'Discord', 'Status'].map(h => (
                  <th key={h} scope="col" className="px-3 py-2 font-normal">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-t border-border align-top">
                  <td className="px-3 py-2 whitespace-nowrap text-dim">{fmtTs(r.created_at)}</td>
                  <td className="px-3 py-2 text-text break-words">{r.guild_name}</td>
                  <td className="px-3 py-2 text-text break-words">
                    {r.game ? (GAME[r.game] ?? '') : ''}{r.server ? `: ${r.server}` : ''}
                  </td>
                  <td className="px-3 py-2 text-text">{r.raiders ?? ''}</td>
                  <td className="px-3 py-2 text-text">{(r.nights ?? []).join(', ')}</td>
                  <td className="px-3 py-2 text-text">{r.dkp ? (DKP[r.dkp] ?? '') : ''}</td>
                  <td className="px-3 py-2 text-text break-words">{r.heard ?? ''}</td>
                  <td className="px-3 py-2 text-text break-words">{r.discord_contact ?? 'none given'}</td>
                  <td className="px-3 py-2 text-dim">{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
