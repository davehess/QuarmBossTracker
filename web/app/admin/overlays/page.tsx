// /admin/overlays — live tuning knobs for Mimic overlays + the bot's Extended
// Target aggregation, WITHOUT a redeploy or Mimic release (Uilnayar
// 2026-07-06: "we need to be able to make more of these configuration changes
// to overlays without a full redeployment").
//
// Writes overlay_tuning.tuning (single jsonb row per guild) — numbers only.
// Empty input = "use the compiled default" (the key is simply omitted).
// Propagation: the bot re-reads within ~60s (Extended Target knobs); every
// agent polls GET /api/agent/overlay-tuning every ~90s (off-heal + CH knobs),
// so a mid-raid tweak lands everywhere inside ~2 minutes.
//
// Adding a knob: wire tuneNum('<key>', DEFAULT) at the use site (agent) or
// tn('<key>', DEFAULT) (bot extended-target handler), then add a row to the
// catalog below. Keep keys snake_case with a unit suffix (_sec/_pct).

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { isOfficer } from '@/lib/officer';
import { supabaseServer } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

type Knob = {
  key:     string;
  label:   string;
  default: number;
  min:     number;
  max:     number;
  step?:   number;
  desc:    string;
};

type KnobGroup = { title: string; blurb: string; knobs: Knob[] };

// The catalog. `default` here MUST match the compiled default at the use site
// — it's shown as the input placeholder and is what "empty" means.
const GROUPS: KnobGroup[] = [
  {
    title: '🎯 Extended Target (bot-side, live in ~60s)',
    blurb: 'Controls the shared target board every Mimic polls from the bot.',
    knobs: [
      { key: 'ext_hurt_pct', label: 'Ally "hurt" threshold %', default: 85, min: 10, max: 99,
        desc: 'A player/pet below this HP% (for the minimum time below) earns a row + ⚠. Raise to show allies earlier; lower to only flag the badly wounded.' },
      { key: 'ext_hurt_min_sec', label: 'Hurt for at least (seconds)', default: 10, min: 0, max: 60,
        desc: 'How long an ally must stay below the threshold before they surface — filters spike damage that gets healed immediately.' },
      { key: 'ext_stale_grace_sec', label: 'Untargeted-mob grace (seconds)', default: 90, min: 10, max: 600,
        desc: 'A hurt mob nobody currently targets stays on the board this long ("last seen Xs ago" rows). Was 5 min — killed mobs lingered as corpses.' },
      { key: 'ext_offtank_fresh_sec', label: 'Off-tank freshness (seconds)', default: 30, min: 5, max: 120,
        desc: 'How recent a "mob is hitting a raider" combat-log signal must be for the mob to count as actively off-tanked.' },
      { key: 'ext_online_sec', label: 'Raider online window (seconds)', default: 60, min: 15, max: 300,
        desc: 'How fresh a raider\'s live-state must be to count as "in the raid now". Bigger = laggier raiders stay counted; smaller = faster dropout.' },
      { key: 'ext_hp_split_tol', label: 'Same-name split tolerance (%HP)', default: 8, min: 1, max: 30,
        desc: 'Two reports of the same generic mob name ("a wolf") whose HP differs by more than this are treated as two different mobs.' },
    ],
  },
  {
    title: '⚕ Off-heal candidates (agent-side, live in ~90s)',
    blurb: 'The hurt-offtank list on the CH chain + Tank overlays.',
    knobs: [
      { key: 'offheal_hurt_pct', label: 'Hurt threshold %', default: 90, min: 10, max: 99,
        desc: 'Offtanks only show when below this HP%. Zeal reports "full" as 99.9%, so 90 ≈ "missing a real chunk". Raise to 95 to catch people earlier.' },
      { key: 'offheal_window_sec', label: 'Taking hits window (seconds)', default: 20, min: 5, max: 120,
        desc: 'How far back the "who is this mob hitting" memory reaches. Longer = slower to drop someone who kited away.' },
      { key: 'offheal_min_hits', label: 'Minimum hits', default: 2, min: 1, max: 10, step: 1,
        desc: 'Connects required inside the window before someone counts as tanking (1 = a single stray riposte qualifies).' },
    ],
  },
  {
    title: '⛓ CH chain (agent-side, live in ~90s)',
    blurb: 'Complete Heal rotation overlay behavior.',
    knobs: [
      { key: 'ch_go_display_sec', label: 'GO! flash duration (seconds)', default: 7, min: 2, max: 30,
        desc: 'How long the green GO! pill stays on a healer\'s row after a "NNN GO GO GO" call (clears early once they cast).' },
    ],
  },
];

const ALL_KNOBS: Knob[] = GROUPS.flatMap(g => g.knobs);

async function saveOverlayTuning(formData: FormData) {
  'use server';
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user || !(await isOfficer(user.id))) redirect('/?error=admin_required');

  // Only non-empty, in-range numbers become overrides; everything else is
  // omitted so the compiled default applies. Clamp instead of reject — an
  // officer nudging a slider mid-raid should never lose the save to a typo.
  const tuning: Record<string, number> = {};
  for (const k of ALL_KNOBS) {
    const raw = String(formData.get(k.key) ?? '').trim();
    if (!raw) continue;
    const n = Number(raw);
    if (!Number.isFinite(n)) continue;
    tuning[k.key] = Math.max(k.min, Math.min(k.max, n));
  }

  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const display = String(meta.full_name || meta.name || meta.preferred_username || meta.email || 'officer');

  await supabaseAdmin()
    .from('overlay_tuning')
    .upsert({
      guild_id: 'wolfpack',
      tuning,
      updated_by_discord_id: (user.app_metadata?.provider_id || meta.provider_id || null) as string | null,
      updated_by_name: display,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'guild_id' });

  revalidatePath('/admin/overlays');
}

export default async function OverlayTuningPage() {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from('overlay_tuning')
    .select('*')
    .eq('guild_id', 'wolfpack')
    .maybeSingle();

  const tuning: Record<string, number> = (data?.tuning as Record<string, number>) ?? {};
  const overrideCount = ALL_KNOBS.filter(k => typeof tuning[k.key] === 'number').length;

  return (
    <div className="space-y-6 max-w-3xl">
      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-xl text-gold mb-2">🎛 Overlay tuning</h2>
        <p className="text-sm text-dim leading-6">
          Live thresholds for the Extended Target board and Mimic overlays — no bot
          redeploy, no Mimic release. The bot re-reads within <b>~60s</b>; every running
          Mimic picks agent-side knobs up within <b>~90s</b>. Leave a field <b>empty</b> to
          use the built-in default (shown greyed in the box). Values are clamped to the
          listed range on save.
          {overrideCount > 0 && (
            <> Currently <span className="text-orange font-semibold">{overrideCount} override{overrideCount === 1 ? '' : 's'}</span> active.</>
          )}
        </p>
      </section>

      <form action={saveOverlayTuning} className="space-y-5">
        {GROUPS.map(group => (
          <section key={group.title} className="bg-panel border border-border rounded-lg p-5">
            <div className="text-base font-semibold text-text mb-1">{group.title}</div>
            <p className="text-xs text-dim mb-4">{group.blurb}</p>
            <div className="space-y-4">
              {group.knobs.map(k => {
                const current = tuning[k.key];
                const hasOverride = typeof current === 'number';
                return (
                  <label key={k.key} className="block">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-semibold text-text">{k.label}</span>
                      <code className="text-[10px] text-dim">{k.key}</code>
                      {hasOverride && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange/20 text-orange border border-orange/40">
                          override: {current} (default {k.default})
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <input
                        type="number"
                        name={k.key}
                        min={k.min}
                        max={k.max}
                        step={k.step ?? 'any'}
                        defaultValue={hasOverride ? current : ''}
                        placeholder={String(k.default)}
                        className="w-28 bg-bg border border-border rounded px-3 py-1.5 text-sm text-text font-mono"
                      />
                      <span className="text-[10px] text-dim">range {k.min}–{k.max}</span>
                    </div>
                    <p className="text-xs text-dim mt-1 leading-5">{k.desc}</p>
                  </label>
                );
              })}
            </div>
          </section>
        ))}

        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-dim">
            {data?.updated_by_name
              ? <>Last saved by <span className="text-text">{data.updated_by_name}</span> · {new Date(data.updated_at).toLocaleString()}</>
              : <span>Never saved — all defaults in effect</span>}
          </div>
          <button
            type="submit"
            className="px-4 py-2 bg-orange/80 hover:bg-orange text-bg rounded text-sm font-semibold"
          >
            Save tuning
          </button>
        </div>
      </form>

      <section className="bg-panel border border-border rounded-lg p-4 text-xs text-dim leading-5">
        <div className="font-semibold text-text mb-1">How it propagates</div>
        <ul className="list-disc list-inside space-y-1">
          <li><b>Extended Target knobs</b> — read by the bot on the next board refresh (60s cache).</li>
          <li><b>Off-heal / CH knobs</b> — every agent polls <code>/api/agent/overlay-tuning</code> every 90s and applies them on the next overlay tick. Requires Mimic 1.5.0+ (older Mimics silently keep their built-in defaults).</li>
          <li>Clearing a field and saving removes the override — the compiled default takes back over on the same schedule.</li>
        </ul>
      </section>
    </div>
  );
}
