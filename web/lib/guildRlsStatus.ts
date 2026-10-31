// What /admin/overlays says about guild separation. The bot writes bot_kv `guild_rls_status` (utils/guildScoped.js); this
// turns it into one of three states. Pure, so a root test can import it without react or next. Nothing here is secret:
// counts, times and booleans.

export type GuildRlsStatus = {
  flag_on?: boolean;
  key_ok?: boolean;
  rejected_count?: number;
  last_rejected_at?: string | null;
  last_ok_at?: string | null;
  scoped_ok_count?: number;
};

export type GuildRlsView =
  | { kind: 'none' }
  | { kind: 'warn'; message: string }
  | { kind: 'ok'; message: string };

const DAY_MS = 24 * 60 * 60 * 1000;

function ago(iso: string | null | undefined, nowMs: number): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return 'not yet';
  const s = Math.max(0, Math.round((nowMs - t) / 1000));
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 129600) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export function guildRlsView(st: GuildRlsStatus | null | undefined, nowMs: number = Date.now()): GuildRlsView {
  if (!st || !st.flag_on) return { kind: 'none' };
  if (st.key_ok === false) {
    return {
      kind: 'warn',
      message: 'Guild separation is OFF in practice: the signing key is missing or invalid, so the bot is using the full-access key. Check the signing key in Railway and Supabase.',
    };
  }
  const rej = Number(st.rejected_count) || 0;
  const rejAt = st.last_rejected_at ? Date.parse(st.last_rejected_at) : NaN;
  if (rej > 0 && Number.isFinite(rejAt) && nowMs - rejAt < DAY_MS) {
    return {
      kind: 'warn',
      message: `Guild separation is OFF in practice: the bot fell back to the full-access key ${rej} time${rej === 1 ? '' : 's'}, most recently ${ago(st.last_rejected_at, nowMs)} (${st.last_rejected_at}). Check the signing key in Railway and Supabase.`,
    };
  }
  return { kind: 'ok', message: `Guild separation active — last scoped write ${ago(st.last_ok_at, nowMs)}` };
}
