// test/setup-command.test.js — /setup discord status | provision | export.
//
// The command is the in-Discord face of utils/discordProvisioner.js. What has to
// hold: who may run it (Manage Server, or an officer: a brand-new guild has no
// officer role yet), that provision is a DRY RUN until told otherwise, that
// status writes nothing, that export hands back two private files, and that
// every reply is ephemeral. Run against a fake Discord world; no network.
//
// Run: npx vitest run test/setup-command.test.js

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ROOT } from './_source-slice.js';
import { makeWorld } from './_fake-discord-world.js';

const require = createRequire(import.meta.url);
const setup = require(path.join(ROOT, 'commands', 'setup.js'));
const { PermissionFlagsBits, MessageFlags } = require('discord.js');
const prov = require(path.join(ROOT, 'utils', 'discordProvisioner.js'));

// The command reads and (on a real provision) fills process.env, so each test
// gets the real environment back.
let saved;
beforeEach(() => { saved = { ...process.env }; });
afterEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
});

function fakeInteraction({ client, sub, group = 'discord', opts = {}, manageGuild = false, roles = [] }) {
  const calls = { reply: [], defer: [], edit: [] };
  return {
    client, calls,
    memberPermissions: { has: (bit) => manageGuild && bit === PermissionFlagsBits.ManageGuild },
    member: { roles: { cache: roles.map(name => ({ name })) } },
    options: {
      getSubcommandGroup: () => group,
      getSubcommand: () => sub,
      getBoolean: (n) => (n in opts ? opts[n] : null),
      getString: (n) => (n in opts ? opts[n] : null),
    },
    reply: async (p) => { calls.reply.push(p); },
    deferReply: async (p) => { calls.defer.push(p); },
    editReply: async (p) => { calls.edit.push(p); return p; },
  };
}
const writes = (s) => s.sends + s.channelCreates + s.threadCreates + s.edits + s.deletes + s.unarchives + s.pins;
// What the member would read: the message, plus any file it moved the body into.
const text = (i) => i.calls.edit.map(e => [e.content || '', ...(e.files || []).map(f => f.attachment.toString('utf8'))].join('\n')).join('\n');
function env(world, extra = {}) {
  process.env.DISCORD_GUILD_ID = world.guildId;
  delete process.env.TIMER_CHANNEL_ID;
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  Object.assign(process.env, extra);
}

describe('the command definition', () => {
  const json = setup.data.toJSON();

  it('is gated to Manage Server by default, so Discord hides it from everyone else', () => {
    expect(json.name).toBe('setup');
    expect(json.default_member_permissions).toBe(String(PermissionFlagsBits.ManageGuild));
  });

  it('is /setup discord with exactly status, provision and export', () => {
    expect(json.options).toHaveLength(1);
    const group = json.options[0];
    expect(group.name).toBe('discord');
    expect(group.options.map(o => o.name).sort()).toEqual(['export', 'provision', 'status']);
  });

  it('provision takes dry_run, only, create_channels, optional and repair', () => {
    const prov_ = json.options[0].options.find(o => o.name === 'provision');
    expect(prov_.options.map(o => o.name).sort()).toEqual(['create_channels', 'dry_run', 'only', 'optional', 'repair']);
    const byName = Object.fromEntries(prov_.options.map(o => [o.name, o]));
    expect(byName.dry_run.type).toBe(5);          // boolean
    expect(byName.only.type).toBe(3);             // string
    expect(byName.create_channels.type).toBe(5);
    expect(byName.repair.type).toBe(5);
    expect(byName.optional.description).toMatch(/pvp.*voice.*loot.*rules.*announce.*hate.*live.*deathroll.*mimic/);
  });

  it('tells a new guild that its first boot is auto mode or the CLI, and keeps every description inside Discord\'s 100 characters', () => {
    const walk = (o) => [o.description, ...(o.options || []).flatMap(walk)];
    for (const d of walk(json)) expect(d.length, d).toBeLessThanOrEqual(100);
    expect(json.options[0].description).toMatch(/New guild\? First boot is auto mode or the CLI/);
  });
});

describe('who may run it', () => {
  it('refuses someone with neither Manage Server nor the officer role, ephemerally, without touching Discord', async () => {
    const world = makeWorld();
    env(world);
    const i = fakeInteraction({ client: world.client, sub: 'provision', opts: { dry_run: false } });
    await setup.execute(i);
    expect(i.calls.reply).toHaveLength(1);
    expect(i.calls.reply[0].flags).toBe(MessageFlags.Ephemeral);
    expect(i.calls.reply[0].content).toMatch(/server managers|Manage Server/);
    expect(i.calls.defer).toHaveLength(0);
    expect(writes(world.stats)).toBe(0);
  });

  it('refuses a member whose only roles are the general ones', async () => {
    const world = makeWorld();
    env(world, { OFFICER_ROLE_NAMES: 'Officer', ALLOWED_ROLE_NAMES: 'Pack Member,Officer' });
    const i = fakeInteraction({ client: world.client, sub: 'status', roles: ['Pack Member'] });
    await setup.execute(i);
    expect(i.calls.reply[0].content).toMatch(/^❌/);
    expect(i.calls.edit).toHaveLength(0);
  });

  it('admits Manage Server on its own: a brand-new guild has no officer role yet', async () => {
    const world = makeWorld();
    env(world);
    const i = fakeInteraction({ client: world.client, sub: 'status', manageGuild: true });
    await setup.execute(i);
    expect(i.calls.reply).toHaveLength(0);
    expect(i.calls.edit).toHaveLength(1);
  });

  it('admits the officer role without Manage Server', async () => {
    const world = makeWorld();
    env(world, { OFFICER_ROLE_NAMES: 'Officer' });
    const i = fakeInteraction({ client: world.client, sub: 'status', roles: ['Officer'] });
    await setup.execute(i);
    expect(i.calls.reply).toHaveLength(0);
    expect(i.calls.edit).toHaveLength(1);
  });

  it('refuses a DM-style interaction with no member at all', async () => {
    const world = makeWorld();
    const i = fakeInteraction({ client: world.client, sub: 'status' });
    i.member = null; i.memberPermissions = null;
    await setup.execute(i);
    expect(i.calls.reply[0].content).toMatch(/^❌/);
  });

  it('refuses a subcommand that is not one of the three', async () => {
    const world = makeWorld();
    const i = fakeInteraction({ client: world.client, sub: 'nuke', manageGuild: true });
    await setup.execute(i);
    expect(i.calls.reply[0].flags).toBe(MessageFlags.Ephemeral);
    expect(i.calls.defer).toHaveLength(0);
  });
});

describe('provision', () => {
  it('is a dry run by default and makes zero writes', async () => {
    const world = makeWorld();
    env(world);
    const i = fakeInteraction({ client: world.client, sub: 'provision', manageGuild: true });   // no options at all
    await setup.execute(i);
    expect(writes(world.stats)).toBe(0);
    expect(process.env.TIMER_CHANNEL_ID).toBeUndefined();
    expect(text(i)).toMatch(/dry run/i);
    expect(text(i)).toMatch(/Would create/);
    expect(text(i)).toMatch(/dry_run:false/);
  });

  it('with dry_run true spelled out is the same', async () => {
    const world = makeWorld();
    env(world);
    await setup.execute(fakeInteraction({ client: world.client, sub: 'provision', manageGuild: true, opts: { dry_run: true } }));
    expect(writes(world.stats)).toBe(0);
  });

  it('with dry_run false builds the layout and says so', async () => {
    const world = makeWorld();
    env(world);
    const i = fakeInteraction({ client: world.client, sub: 'provision', manageGuild: true, opts: { dry_run: false } });
    await setup.execute(i);
    expect(world.stats.channelCreates).toBe(1);
    expect(world.stats.threadCreates).toBe(6);
    expect(process.env.TIMER_CHANNEL_ID).toBeTruthy();
    expect(text(i)).toMatch(/Created/);
    expect(text(i)).not.toMatch(/dry run/i);
  });

  it('only: names the keys to touch and nothing else', async () => {
    const world = makeWorld();
    const hub = world.addChannel({ name: 'raid-mobs' });
    env(world, { TIMER_CHANNEL_ID: hub.id });
    const i = fakeInteraction({ client: world.client, sub: 'provision', manageGuild: true, opts: { dry_run: false, only: 'HISTORIC_KILLS_THREAD_ID' } });
    await setup.execute(i);
    expect(world.stats.threadCreates).toBe(1);
    expect(world.stats.sends).toBe(0);
    expect(process.env.HISTORIC_KILLS_THREAD_ID).toBeTruthy();
    expect(process.env.CLASSIC_THREAD_ID).toBeUndefined();
  });

  it('create_channels lets it make a channel beyond the hub, and without it it does not', async () => {
    const w1 = makeWorld(); env(w1);
    await setup.execute(fakeInteraction({ client: w1.client, sub: 'provision', manageGuild: true, opts: { dry_run: false } }));
    expect(w1.byName('raid-chat')).toHaveLength(0);
    const w2 = makeWorld(); env(w2);
    await setup.execute(fakeInteraction({ client: w2.client, sub: 'provision', manageGuild: true, opts: { dry_run: false, create_channels: true } }));
    expect(w2.byName('raid-chat')).toHaveLength(1);
    expect(w2.byName('pvp')).toHaveLength(0);   // still optional
  });

  it('optional names the groups to include', async () => {
    const world = makeWorld();
    world.addChannel({ name: 'raid-mobs' });
    const pvp = world.addChannel({ name: 'pvp' });
    env(world);
    await setup.execute(fakeInteraction({ client: world.client, sub: 'provision', manageGuild: true, opts: { dry_run: false, optional: 'PvP' } }));
    expect(process.env.PVP_CHANNEL_ID).toBe(pvp.id);
  });

  it('repair replaces a dead env id only when asked', async () => {
    const world = makeWorld();
    const hub = world.addChannel({ name: 'raid-mobs' });
    env(world, { TIMER_CHANNEL_ID: hub.id, KUNARK_THREAD_ID: 'dead' });
    await setup.execute(fakeInteraction({ client: world.client, sub: 'provision', manageGuild: true, opts: { dry_run: false } }));
    expect(process.env.KUNARK_THREAD_ID).toBe('dead');
    await setup.execute(fakeInteraction({ client: world.client, sub: 'provision', manageGuild: true, opts: { dry_run: false, repair: true } }));
    expect(process.env.KUNARK_THREAD_ID).not.toBe('dead');
  });

  it('defers ephemerally, and answers ephemerally (editReply inherits the defer)', async () => {
    const world = makeWorld();
    env(world);
    const i = fakeInteraction({ client: world.client, sub: 'provision', manageGuild: true });
    await setup.execute(i);
    expect(i.calls.defer).toEqual([{ flags: MessageFlags.Ephemeral }]);
    expect(i.calls.reply).toHaveLength(0);
  });

  it('a long report goes out as a file instead of being cut off', async () => {
    const world = makeWorld();
    env(world, { GUILD_PROVISION_OPTIONAL: 'pvp,voice,loot,rules,announce,hate,live,deathroll,mimic' });
    const i = fakeInteraction({ client: world.client, sub: 'provision', manageGuild: true,
      opts: { create_channels: true, optional: 'pvp,voice,loot,rules,announce,hate,live,deathroll,mimic' } });
    await setup.execute(i);
    const out = i.calls.edit[0];
    expect(out.files).toHaveLength(1);
    expect(out.files[0].name).toBe('setup-report.txt');
    expect(out.files[0].attachment.toString('utf8').length).toBeGreaterThan(1900);
    expect(out.content.length).toBeLessThanOrEqual(2000);
    // the line that says nothing was changed stays in the message itself
    expect(out.content).toMatch(/attached/);
    expect(out.content).toMatch(/dry run/);
  });
});

describe('status', () => {
  it('is read-only', async () => {
    const world = makeWorld();
    const hub = world.addChannel({ name: 'raid-mobs' });
    world.addThread(hub.id, { name: 'Classic', archived: true });
    env(world, { TIMER_CHANNEL_ID: hub.id, DISCORD_CLIENT_ID: '4242' });
    const i = fakeInteraction({ client: world.client, sub: 'status', manageGuild: true });
    await setup.execute(i);
    expect(writes(world.stats)).toBe(0);
    expect(process.env.CLASSIC_THREAD_ID).toBeUndefined();
    expect(i.calls.defer).toEqual([{ flags: MessageFlags.Ephemeral }]);
  });

  it('says where each id came from, what is dead, what is missing and what a human has to do', async () => {
    const world = makeWorld();
    const hub = world.addChannel({ name: 'raid-mobs' });
    env(world, { TIMER_CHANNEL_ID: hub.id, CLASSIC_THREAD_ID: 'gone-thread', DISCORD_CLIENT_ID: '4242',
      OFFICER_ROLE_NAMES: 'Officer', ALLOWED_ROLE_NAMES: 'Pack Member' });
    world.guild.roles.cache.set('r1', { name: 'Pack Member' });
    const i = fakeInteraction({ client: world.client, sub: 'status', manageGuild: true });
    await setup.execute(i);
    const t = text(i);
    expect(t).toMatch(/Provenance: env 2/);                       // the hub and the dead thread are both env
    expect(t).toMatch(/Dead ids.*CLASSIC_THREAD_ID/);
    expect(t).toMatch(/Missing, required:.*SUMMARY_MESSAGE_ID/);
    expect(t).toMatch(/Missing, platform:.*RAID_CHAT_CHANNEL_ID/);
    expect(t).toMatch(/By hand: FORUM_CHANNEL_ID/);
    expect(t).toMatch(/Roles that open the commands: Pack Member/);
    expect(t).toMatch(/Officer roles: Officer \(MISSING\)/);       // the role does not exist on this server
    expect(t).toMatch(/permissions 2252135193504768/);
    expect(t).toContain('https://discord.com/oauth2/authorize?client_id=4242&scope=bot+applications.commands&permissions=2252135193504768');
  });

  it('lists the provenance of every anchor, one line each, ids and all', async () => {
    const world = makeWorld();
    const hub = world.addChannel({ name: 'raid-mobs' });
    env(world, { TIMER_CHANNEL_ID: hub.id, CLASSIC_THREAD_ID: 'gone-thread' });
    const i = fakeInteraction({ client: world.client, sub: 'status', manageGuild: true });
    await setup.execute(i);
    const t = text(i);
    expect(t).toContain(`TIMER_CHANNEL_ID [required]: env ${hub.id}`);
    expect(t).toContain('CLASSIC_THREAD_ID [required]: env (DEAD) gone-thread');
    expect(t).toContain('SUMMARY_MESSAGE_ID [required]: missing');
    expect(t).toContain('RAID_CHAT_CHANNEL_ID [platform]: missing');
    expect(t).not.toMatch(/PVP_CHANNEL_ID/);   // an optional anchor nobody set is not a gap
  });

  it('reports a permission gap by name', async () => {
    const world = makeWorld();
    const hub = world.addChannel({ name: 'raid-mobs' });
    world.denied.add('ManageThreads');
    env(world, { TIMER_CHANNEL_ID: hub.id });
    const i = fakeInteraction({ client: world.client, sub: 'status', manageGuild: true });
    await setup.execute(i);
    expect(text(i)).toMatch(/Permission gap in TIMER_CHANNEL_ID: Manage Threads/);
  });

  it('knows the difference between file, env and kv-owned ids', async () => {
    const world = makeWorld();
    const hub = world.addChannel({ name: 'raid-mobs' });
    env(world, { TIMER_CHANNEL_ID: hub.id });
    const st = await prov.inspectLayout({ client: world.client, env: process.env, supabase: null });
    expect(st.items.find(x => x.key === 'TIMER_CHANNEL_ID').source).toBe('env');
    expect(st.items.find(x => x.key === 'SUMMARY_MESSAGE_ID').source).toBe('missing');
    expect(st.kv).toBe('disabled');
  });
});

describe('export', () => {
  it('returns two attachments, ephemerally: guild/discord.json and an env block', async () => {
    const world = makeWorld();
    const hub = world.addChannel({ name: 'raid-mobs' });
    const t = world.addThread(hub.id, { name: 'Classic' });
    env(world, { TIMER_CHANNEL_ID: hub.id, CLASSIC_THREAD_ID: t.id });
    const i = fakeInteraction({ client: world.client, sub: 'export', manageGuild: true });
    await setup.execute(i);
    expect(i.calls.defer).toEqual([{ flags: MessageFlags.Ephemeral }]);
    const out = i.calls.edit[0];
    expect(out.files).toHaveLength(2);
    expect(out.files.map(f => f.name)).toEqual(['discord.json', 'discord.env']);
    const json = JSON.parse(out.files[0].attachment.toString('utf8'));
    expect(json.TIMER_CHANNEL_ID).toBe(hub.id);
    expect(json.CLASSIC_THREAD_ID).toBe(t.id);
    expect(json.KUNARK_THREAD_ID).toBe(null);          // unprovisioned is null, not absent
    expect('POP_BOARD_IDS' in json).toBe(true);
    const envText = out.files[1].attachment.toString('utf8');
    expect(envText).toContain(`TIMER_CHANNEL_ID=${hub.id}`);
    expect(envText).toContain(`CLASSIC_THREAD_ID=${t.id}`);
    expect(envText).not.toMatch(/KUNARK_THREAD_ID=/);
    expect(writes(world.stats)).toBe(0);
  });

  it('never carries anything secret-shaped, even if the environment holds it', async () => {
    const world = makeWorld();
    env(world, { DISCORD_TOKEN: 'super-secret', TAG_CHANNEL_SPEC: 'name:pw', SUPABASE_SERVICE_ROLE_KEY: 'k' });
    const i = fakeInteraction({ client: world.client, sub: 'export', manageGuild: true });
    await setup.execute(i);
    const all = i.calls.edit[0].files.map(f => f.attachment.toString('utf8')).join('\n');
    expect(all).not.toMatch(/super-secret|name:pw|DISCORD_TOKEN|SERVICE_ROLE/);
  });

  it('after a real provision, exports the ids it just made', async () => {
    const world = makeWorld();
    env(world);
    await setup.execute(fakeInteraction({ client: world.client, sub: 'provision', manageGuild: true, opts: { dry_run: false } }));
    const i = fakeInteraction({ client: world.client, sub: 'export', manageGuild: true });
    await setup.execute(i);
    const json = JSON.parse(i.calls.edit[0].files[0].attachment.toString('utf8'));
    expect(json.TIMER_CHANNEL_ID).toBe(process.env.TIMER_CHANNEL_ID);
    expect(json.SUMMARY_MESSAGE_ID).toBe(process.env.SUMMARY_MESSAGE_ID);
    expect(String(json.POP_BOARD_IDS)).toBe(process.env.POP_BOARD_IDS.split(',').join(','));
  });
});

describe('failure', () => {
  it('answers with the error rather than leaving the interaction hanging', async () => {
    const i = fakeInteraction({ client: null, sub: 'status', manageGuild: true });
    i.client = { get guilds() { throw new Error('discord is down'); } };
    await setup.execute(i);
    expect(i.calls.defer).toHaveLength(1);
    expect(i.calls.edit).toHaveLength(1);
    expect(i.calls.edit[0].content).toMatch(/^❌ status failed/);
  });
});
