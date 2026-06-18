// utils/reconcileFunEvents.js — derive fun_events from parse encounters.
//
// Thin wrapper around the backfill_fun_events_from_encounters RPC so the manual
// /backfillfunevents command and the nightly midnight chain share one code path
// (same pattern as utils/reconcileKills.js for /recoverkills).
//
// Why this exists: encounter-backed fun counters (currently Lord of Ire) are
// normally credited from the live PvP/Druzzil broadcast relay, which is missed
// whenever no agent is online with the broadcast in its log (the 1am open-world
// gap). The killers' agents still upload a combat encounter, so we reconcile any
// uncredited kill off encounters. The RPC handles all dedup (encounter_id link +
// fight-window match against broadcast/manual rows) and wipe/incomplete filtering.
'use strict';

const supabase = require('./supabase');

/**
 * @param {object}  opts
 * @param {number} [opts.sinceMs] only consider encounters started within this
 *        many ms of now; omit/0 for a full scan.
 * @param {boolean}[opts.dryRun] compute the would-insert set without writing.
 * @returns {Promise<{ rows: Array, inserted: number, scanned: 'rpc' }>}
 */
async function reconcileFunEventsFromEncounters({ sinceMs = 0, dryRun = false } = {}) {
  if (!supabase.isEnabled()) return { rows: [], inserted: 0 };
  const p_since = sinceMs > 0 ? new Date(Date.now() - sinceMs).toISOString() : null;
  const rows = await supabase.rpc('backfill_fun_events_from_encounters', {
    p_guild_id: process.env.SUPABASE_GUILD_ID || 'wolfpack',
    p_since,
    p_dry_run: dryRun,
  });
  const list = Array.isArray(rows) ? rows : [];
  return { rows: list, inserted: list.filter(r => r.action === 'inserted').length };
}

module.exports = { reconcileFunEventsFromEncounters };
