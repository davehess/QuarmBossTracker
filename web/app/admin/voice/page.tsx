// /admin/voice — ripcord + tunables for the bot's voice-trigger pipeline.
//
// Hits voice_settings (single row keyed by guild_id). The bot consults this
// on every voice fire and the cache TTL is 30s, so a flipped toggle here
// kills noise inside half a minute. Officer-gated by the parent layout.
//
// Fields it controls:
//   • enabled — master ripcord. Off = the bot drops every voice fire.
//   • default_voice — fallback Edge TTS voice when the trigger didn't
//     pick one. Names are Edge's neural-voice IDs (en-US-AriaNeural etc.).
//   • volume_pct — 0..200%. The bot applies this via @discordjs/voice's
//     inlineVolume on the audio resource (one-shot opus→PCM→opus pass).
//   • skip_patterns — substring matches (case-insensitive). Any voice
//     message containing one of these gets dropped. Per-line in the
//     textarea, blank lines ignored.
//   • skip_trigger_names — exact trigger-name matches. For "mute this
//     specific callout without disabling the whole trigger."

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { isOfficer } from '@/lib/officer';
import { supabaseServer } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

type VoiceSettingsRow = {
  guild_id:              string;
  enabled:               boolean;
  default_voice:         string;
  volume_pct:            number;
  skip_patterns:         string[];
  skip_trigger_names:    string[];
  updated_by_name:       string | null;
  updated_at:            string;
};

const EDGE_VOICES = [
  { id: 'en-US-AriaNeural',        label: 'Aria (US female, default)' },
  { id: 'en-US-GuyNeural',         label: 'Guy (US male)' },
  { id: 'en-US-JennyNeural',       label: 'Jenny (US female, warm)' },
  { id: 'en-US-ChristopherNeural', label: 'Christopher (US male)' },
  { id: 'en-US-MichelleNeural',    label: 'Michelle (US female)' },
  { id: 'en-GB-RyanNeural',        label: 'Ryan (UK male)' },
  { id: 'en-GB-SoniaNeural',       label: 'Sonia (UK female)' },
];

async function saveVoiceSettings(formData: FormData) {
  'use server';
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user || !(await isOfficer(user.id))) redirect('/?error=admin_required');

  const enabled         = formData.get('enabled') === 'on';
  const default_voice   = String(formData.get('default_voice') || 'en-US-AriaNeural');
  const volume_pct      = Math.max(0, Math.min(200, parseInt(String(formData.get('volume_pct') || '100'), 10) || 100));
  const skip_patterns   = String(formData.get('skip_patterns') || '')
    .split('\n').map(s => s.trim()).filter(Boolean);
  const skip_trigger_names = String(formData.get('skip_trigger_names') || '')
    .split('\n').map(s => s.trim()).filter(Boolean);

  // Pull display name for the audit trail. Falls back to "officer" if the
  // member row isn't synced yet — rare on first install only.
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const display = String(meta.full_name || meta.name || meta.preferred_username || meta.email || 'officer');

  await supabaseAdmin()
    .from('voice_settings')
    .upsert({
      guild_id: 'wolfpack',
      enabled,
      default_voice,
      volume_pct,
      skip_patterns,
      skip_trigger_names,
      updated_by_discord_id: (user.app_metadata?.provider_id || meta.provider_id || null) as string | null,
      updated_by_name: display,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'guild_id' });

  revalidatePath('/admin/voice');
}

export default async function VoiceAdminPage() {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from('voice_settings')
    .select('*')
    .eq('guild_id', 'wolfpack')
    .maybeSingle();

  const row: VoiceSettingsRow = data ?? {
    guild_id: 'wolfpack',
    enabled: true,
    default_voice: 'en-US-AriaNeural',
    volume_pct: 100,
    skip_patterns: [],
    skip_trigger_names: [],
    updated_by_name: null,
    updated_at: new Date(0).toISOString(),
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-xl text-gold mb-2">🎙️ Voice trigger settings</h2>
        <p className="text-sm text-dim leading-6">
          Master controls for the bot speaking in <code>RAID_VOICE_CHANNEL_ID</code> /{' '}
          <code>OFFNIGHT_VOICE_CHANNEL_ID</code>. Toggling these takes effect within ~30s
          (the bot caches this row to avoid hitting Supabase on every fire). Test with{' '}
          <code>/voicetest</code> from Discord — it consults this same row.
        </p>
      </section>

      <form action={saveVoiceSettings} className="space-y-5">
        {/* Ripcord */}
        <section className="bg-panel border border-border rounded-lg p-5">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={row.enabled}
              className="mt-1 w-5 h-5 accent-orange"
            />
            <div className="flex-1">
              <div className="text-base font-semibold text-text">
                Voice triggers <span className={row.enabled ? 'text-green' : 'text-red'}>{row.enabled ? 'ENABLED' : 'DISABLED'}</span>
              </div>
              <p className="text-xs text-dim mt-1">
                Master ripcord. When off, every voice fire is silently dropped at the bot.
                The text-relay surface (<code>TRIGGER_BROADCAST_CHANNEL_ID</code>) is
                independent and keeps working.
              </p>
            </div>
          </label>
        </section>

        {/* Default voice */}
        <section className="bg-panel border border-border rounded-lg p-5">
          <label className="block">
            <div className="text-sm font-semibold text-text mb-1">Default voice</div>
            <p className="text-xs text-dim mb-2">
              Used when a trigger&apos;s action doesn&apos;t pin a <code>voice_id</code>. Per-trigger
              overrides in <code>guild_triggers.actions[].voice_id</code> still win.
            </p>
            <select
              name="default_voice"
              defaultValue={row.default_voice}
              className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text"
            >
              {EDGE_VOICES.map(v => (
                <option key={v.id} value={v.id}>{v.label} — {v.id}</option>
              ))}
            </select>
          </label>
        </section>

        {/* Volume */}
        <section className="bg-panel border border-border rounded-lg p-5">
          <label className="block">
            <div className="text-sm font-semibold text-text mb-1 flex items-center gap-2">
              Volume <span className="text-xs text-dim">(0–200%)</span>
              <span className="text-orange font-mono ml-auto" title="Currently saved value — slide and save to update">{row.volume_pct}%</span>
            </div>
            <input
              type="range"
              name="volume_pct"
              min={0}
              max={200}
              step={5}
              defaultValue={row.volume_pct}
              className="w-full accent-orange"
            />
            <p className="text-xs text-dim mt-2">
              100% = unit gain. Above ~150% clipping is audible. Applied per-resource via
              @discordjs/voice <code>inlineVolume</code>; non-100% values cost one extra
              opus→PCM→opus pass (negligible vs network).
            </p>
          </label>
        </section>

        {/* Skip patterns */}
        <section className="bg-panel border border-border rounded-lg p-5">
          <label className="block">
            <div className="text-sm font-semibold text-text mb-1">Skip patterns</div>
            <p className="text-xs text-dim mb-2">
              One per line. Any voice message containing one of these substrings
              (case-insensitive) gets dropped. Use for quick mutes mid-fight without
              touching the trigger row — e.g. add <code>rampage</code> to silence
              every rampage callout temporarily.
            </p>
            <textarea
              name="skip_patterns"
              defaultValue={(row.skip_patterns || []).join('\n')}
              rows={5}
              placeholder={"rampage\nadds incoming"}
              className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text font-mono"
            />
          </label>
        </section>

        {/* Skip trigger names */}
        <section className="bg-panel border border-border rounded-lg p-5">
          <label className="block">
            <div className="text-sm font-semibold text-text mb-1">Skip trigger names</div>
            <p className="text-xs text-dim mb-2">
              One per line, exact match. Skips an entire trigger&apos;s voice output regardless
              of message text. Use when a specific callout has gone rogue and you want it
              quiet without disabling the trigger row (the overlay still shows).
            </p>
            <textarea
              name="skip_trigger_names"
              defaultValue={(row.skip_trigger_names || []).join('\n')}
              rows={4}
              placeholder={"Divine Intervention fired"}
              className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text font-mono"
            />
          </label>
        </section>

        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-dim">
            {row.updated_by_name
              ? <>Last saved by <span className="text-text">{row.updated_by_name}</span> · {new Date(row.updated_at).toLocaleString()}</>
              : <span>Never saved</span>}
          </div>
          <button
            type="submit"
            className="px-4 py-2 bg-orange/80 hover:bg-orange text-bg rounded text-sm font-semibold"
          >
            Save voice settings
          </button>
        </div>
      </form>

      <section className="bg-panel border border-border rounded-lg p-4 text-xs text-dim">
        <div className="font-semibold text-text mb-1">Seeded raid call-outs</div>
        <p className="leading-5">
          Two trigger drafts shipped with the v3.0.40 migration and live in{' '}
          <code>guild_triggers</code> as <span className="text-red">disabled</span>:
        </p>
        <ul className="list-disc list-inside mt-2 space-y-1">
          <li><b>Emperor Ssra Tank Buster — countdown</b> (10s + 4s pre-recast voice marks)</li>
          <li><b>Divine Intervention fired</b> (D.I. fired on {'{tank}'})</li>
        </ul>
        <p className="mt-2 leading-5">
          Both have placeholder regex patterns — verify on the next pull, fix the
          patterns to match what your logs actually emit, then enable from{' '}
          <a className="text-blue underline" href="/admin/triggers">/admin/triggers</a>.
          The voice actions inside are already correct.
        </p>
      </section>
    </div>
  );
}
