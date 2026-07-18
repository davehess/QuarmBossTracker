'use server';

// Server action for the comp-template editor (#93). Officer-gated, re-validates
// the whole array with the SAME pure validator the client previews with
// (web/lib/comp.ts), then upserts the single per-guild comp_templates row. The
// editor owns the whole `templates` array, so a save replaces it wholesale —
// there are no out-of-band keys in that column to preserve.

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';
import { isOfficer } from '@/lib/officer';
import { validateTemplate } from '@/lib/comp';

export type SaveResult = { ok: true } | { ok: false; errors: string[] };

export async function saveCompTemplates(rawJson: string): Promise<SaveResult> {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user || !(await isOfficer(user.id))) {
    return { ok: false, errors: ['Not authorized — officer role required.'] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (e) {
    return { ok: false, errors: [`JSON parse error: ${(e as Error).message}`] };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, errors: ['Top level must be a JSON array of templates (use [] for none).'] };
  }

  const errors: string[] = [];
  const names = new Set<string>();
  parsed.forEach((t, i) => {
    const r = validateTemplate(t);
    if (!r.ok) {
      for (const e of r.errors) errors.push(`template[${i}]: ${e}`);
      return;
    }
    const key = r.template.name.trim().toLowerCase();
    if (names.has(key)) errors.push(`template[${i}]: duplicate name "${r.template.name}" — names must be unique`);
    names.add(key);
  });
  if (errors.length) return { ok: false, errors };

  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const display = String(meta.full_name || meta.name || meta.preferred_username || meta.email || 'officer');

  const { error } = await supabaseAdmin()
    .from('comp_templates')
    .upsert({
      guild_id: 'wolfpack',
      templates: parsed,
      updated_by_discord_id: (user.app_metadata?.provider_id || meta.provider_id || null) as string | null,
      updated_by_name: display,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'guild_id' });

  if (error) return { ok: false, errors: [`Save failed: ${error.message}`] };

  revalidatePath('/admin/comp');
  revalidatePath('/admin/signups');
  return { ok: true };
}
