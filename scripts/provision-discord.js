#!/usr/bin/env node
// scripts/provision-discord.js — build (or adopt) a guild's Discord layout from a
// terminal, before any database or Railway project exists.
//
//   node scripts/provision-discord.js [--dry-run] [--mode create] [--out guild/discord.json]
//
// Needs only DISCORD_TOKEN (in the environment or a .env file) and a bot that
// has been invited to exactly one server (or DISCORD_GUILD_ID set). It logs a
// bare discord.js client in, runs the SAME provisionLayout the bot runs at boot
// — with no Supabase, so the ids are written to a file instead of a database —
// prints the report, writes guild/discord.json and exits.
//
//   --dry-run        look and say what would happen; change nothing, write no file
//   --mode <m>       report | adopt | create        (default adopt: nothing is created)
//   --out <file>     where to write the ids         (default guild/discord.json)
//   --create-channels, --optional pvp,voice,...      the same switches as /setup discord provision
//
// The hub channel is the one channel `create` makes without --create-channels.
// Design: docs/DESIGN-guild-kit.md §7 slice 3.

'use strict';

const fs = require('fs');
const path = require('path');

try { require('dotenv').config(); } catch { /* dotenv is optional here */ }

function parseArgs(argv) {
  const a = { dryRun: false, mode: 'adopt', out: path.join(__dirname, '..', 'guild', 'discord.json'),
    createChannels: false, optional: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--dry-run') a.dryRun = true;
    else if (k === '--mode') a.mode = String(argv[++i] || '').toLowerCase();
    else if (k === '--out') a.out = path.resolve(argv[++i] || '');
    else if (k === '--create-channels') a.createChannels = true;
    else if (k === '--optional') a.optional = new Set(String(argv[++i] || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
    else if (k === '-h' || k === '--help') a.help = true;
    else { console.error(`Unknown option: ${k}`); a.help = true; }
  }
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/provision-discord.js [--dry-run] [--mode report|adopt|create] [--out guild/discord.json]\n'
      + '         [--create-channels] [--optional pvp,voice,loot,rules,announce,hate,live,deathroll,mimic]');
    return 0;
  }
  if (!['report', 'adopt', 'create'].includes(args.mode)) { console.error('--mode must be report, adopt or create'); return 2; }
  if (!process.env.DISCORD_TOKEN) { console.error('DISCORD_TOKEN is not set (put it in .env or the environment).'); return 2; }

  const { Client, GatewayIntentBits, Events } = require('discord.js');
  const prov = require('../utils/discordProvisioner');

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await new Promise((resolve, reject) => {
    client.once(Events.ClientReady, resolve);
    client.login(process.env.DISCORD_TOKEN).catch(reject);
  });

  let code = 0;
  try {
    const id = prov.deriveIdentity(client, process.env);
    for (const n of id.notes) console.log(n);
    const report = await prov.provisionLayout({
      client, supabase: null, env: process.env, mode: args.mode, dryRun: args.dryRun,
      createChannels: args.createChannels, optional: args.optional || undefined, log: console.log,
    });
    console.log(prov.formatReport(report));
    const inv = prov.invitePermissions({ channels: args.createChannels, clientId: process.env.DISCORD_CLIENT_ID });
    console.log(`Invite permissions: ${inv.permissions}${inv.url ? `\n${inv.url}` : ''}`);
    if (report.errors.length) code = 1;
    if (!args.dryRun) {
      const expanded = prov.expandLayout(prov.loadLayout());
      const out = prov.buildExport(expanded, prov.exportValues(expanded, report, process.env));
      fs.mkdirSync(path.dirname(args.out), { recursive: true });
      fs.writeFileSync(args.out, out.jsonText);
      console.log(`Wrote ${args.out}. Commit it (ids are not secrets), or paste the matching lines into your host's variables.`);
    }
  } finally {
    client.destroy();
  }
  return code;
}

main().then(c => process.exit(c), e => { console.error(e && e.message ? e.message : e); process.exit(1); });
