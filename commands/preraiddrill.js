// commands/preraiddrill.js — the #75 pre-raid drill, runnable from Discord.
//
// Hitya, 2026-08-16: "I would also like to dig into the golden log number 75
// for us to be able to run those pre-raid checks." The CLI half
// (scripts/preraid-drill.js) answers "is the chain alive?" from a workstation;
// this command answers it from inside production, where an officer actually
// is at 19:25 on a raid night. Same five probes, one difference of meaning:
// the parser self-test here replays the golden log through the agent bundled
// IN THE DEPLOYED IMAGE — proving the build the fleet talks to parses the
// signed-off log identically, not just the checkout on someone's desk.
//
// Every probe is READ-ONLY (GETs + a local replay) — safe mid-raid, safe
// inside the deploy freeze. The write-path drill (a synthetic encounter
// through the whole chain) stays designed-but-disabled in
// docs/DESIGN-75-golden-log.md § "The drill" pending Hitya's sign-off.
const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const path = require('node:path');

const SLOW_MS = 1500;

async function probe(url, headers, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const r = await fetch(url, { cache: 'no-store', signal: ctrl.signal, headers });
    const ms = Date.now() - t0;
    let body = null;
    try { body = await r.json(); } catch { /* non-JSON bodies are fine */ }
    return { ok: r.status < 400, status: r.status, ms, body };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - t0, body: null, err: e.message };
  } finally {
    clearTimeout(timer);
  }
}

// The five probes, mirroring scripts/preraid-drill.js. Kept as data so the
// embed render and any future sentinel promotion read one list.
async function runDrill() {
  const results = [];
  const record = (name, state, detail) => results.push({ name, state, detail });
  const base = `http://127.0.0.1:${process.env.PORT || 3000}`;

  // 1. Parser self-test — the agent bundled in THIS image vs the committed
  // golden digest. Lazy-required: the agent is a 35k-line module we only want
  // in memory when an officer actually runs the drill.
  try {
    const R = require(path.join(__dirname, '..', 'test', 'fixtures', 'golden', '_replay.js'));
    const fs = require('node:fs');
    const expected = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', 'test', 'fixtures', 'golden', 'expected-encounter.json'), 'utf8'));
    const payloads = R.replayEncounter('raid-pull.log');
    if (payloads.length !== 1) {
      record('parser (golden log)', 'fail', `replayed ${payloads.length} encounters, expected 1`);
    } else {
      const actual = R.digestEncounter(payloads[0]);
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        const diffs = Object.keys(expected).filter(k => JSON.stringify(actual[k]) !== JSON.stringify(expected[k]));
        record('parser (golden log)', 'fail', `digest differs: ${diffs.join(', ')}`);
      } else {
        record('parser (golden log)', 'ok',
          `${actual.event_count} events · ${actual.boss_name} · agent ${R.agent.AGENT_VERSION} (deployed image)`);
      }
    }
  } catch (e) {
    record('parser (golden log)', 'skip', `golden fixtures unavailable in image: ${e.message}`);
  }

  // 2. Own health — breaker, budgets, readiness.
  {
    const r = await probe(`${base}/health`);
    if (!r.ok || !r.body) {
      record('bot /health', 'fail', r.status ? `HTTP ${r.status}` : `unreachable (${r.err || '?'})`);
    } else {
      const b = r.body;
      const breaker = b.supabase_breaker;
      const over = Object.keys(b.budgets || {});
      const bits = [`${r.ms}ms`];
      if (breaker && breaker.open) bits.push('⚠ Supabase breaker OPEN');
      if (over.length) bits.push(`⚠ over budget: ${over.join(', ')}`);
      if (!b.ready) record('bot /health', 'fail', `not ready (shutting_down=${!!b.shutting_down})`);
      else record('bot /health', (breaker && breaker.open) || over.length ? 'warn' : 'ok', bits.join(' · '));
    }
  }

  // 3. The manifest each updater channel hands out.
  for (const [label, qs] of [['stable', ''], ['beta', '?channel=beta']]) {
    const r = await probe(`${base}/api/agent/latest-version${qs}`);
    if (!r.ok || !r.body) record(`agent manifest (${label})`, 'fail', r.status ? `HTTP ${r.status}` : 'unreachable');
    else record(`agent manifest (${label})`, 'ok', `serves ${r.body.latest_agent_version || '(none)'}`);
  }

  // 4. Ingest auth — the fleet's bearer token, end to end. A 401/403/503 here
  // is the outage that silently kills every upload on raid night.
  {
    const token = process.env.WOLFPACK_AGENT_TOKEN;
    if (!token) record('ingest auth', 'fail', 'WOLFPACK_AGENT_TOKEN unset on the bot — ALL uploads will 503');
    else {
      const r = await probe(`${base}/api/agent/guild-triggers`, { Authorization: `Bearer ${token}` });
      if (r.status === 401 || r.status === 403) record('ingest auth', 'fail', `HTTP ${r.status} — token rejected`);
      else if (!r.ok) record('ingest auth', 'fail', r.status ? `HTTP ${r.status}` : `unreachable (${r.err})`);
      else {
        const n = Array.isArray(r.body?.triggers) ? r.body.triggers.length : null;
        record('ingest auth', 'ok', `accepted${n == null ? '' : ` · ${n} guild triggers`} · ${r.ms}ms`);
      }
    }
  }

  // 5. The site the raid reads.
  {
    const r = await probe('https://wolfpack.quest/api/health');
    if (!r.ok) record('wolfpack.quest', 'fail', r.status ? `HTTP ${r.status}` : `unreachable (${r.err || '?'})`);
    else {
      const c = r.body?.checks || {};
      record('wolfpack.quest', r.ms > SLOW_MS ? 'warn' : 'ok',
        `${r.ms}ms` + (c.auth || c.db ? ` · auth ${c.auth?.state || '?'} · db ${c.db?.state || '?'}` : ''));
    }
  }

  return results;
}

module.exports = {
  runDrill,   // exported so the sentinel (#42) can promote these probes later

  data: new SlashCommandBuilder()
    .setName('preraiddrill')
    .setDescription('Run the #75 pre-raid drill — is the whole parse chain alive? (read-only, safe mid-raid)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const results = await runDrill();
      const failed = results.filter(r => r.state === 'fail');
      const warned = results.filter(r => r.state === 'warn');
      const glyph = { ok: '✅', warn: '⚠️', fail: '🛑', skip: '➖' };
      const verdict = failed.length ? `🛑 ${failed.length} check(s) FAILED — fix before the pull.`
        : warned.length ? `⚠️ ${warned.length} check(s) degraded — pull, but watch them.`
        : '✅ Chain is alive. Good pull.';
      const embed = new EmbedBuilder()
        .setTitle('🎯 Pre-raid drill (#75)')
        .setColor(failed.length ? 0xda3633 : warned.length ? 0xd29922 : 0x2ea043)
        .setDescription(results.map(r => `${glyph[r.state]} **${r.name}** — ${r.detail}`).join('\n'))
        .setFooter({ text: verdict });
      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      return interaction.editReply(`❌ Drill crashed: ${err?.message || err}`);
    }
  },
};
