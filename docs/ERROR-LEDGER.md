# Bot error ledger

Every line the bot writes to stderr shows as an error in Railway (`console.error` AND `console.warn`). The guild
lead, 2026-10-25: *"let's start watching these errors and resolving them cleanly instead"*. So each error
signature is either **fixed at its cause**, or, when it is an expected condition, **moved to stdout** (once, not
per occurrence). A real failure stays loud.

The daily "Bot error watch" scheduled task (9:44 am Eastern) reads the last 24 h of `@level:error` lines from
Railway, groups them by signature, compares them with this table, and drafts fixes for anything new on a
`claude/error-watch-<date>` branch. Never copy member or character names from the logs into this file.

| Signature | Seen (2026-10-24/25) | Status | Where |
|---|---|---|---|
| `Failed to load enragedeath.js: Invalid string length` | every boot since 2026-06-26 | **Fixed, bot 4.0.14.** The slash-command description was 101 characters (Discord allows 100), so `/enragedeath` never registered. `test/commands-load.test.js` now builds every command's JSON, so an over-long description fails CI. | `commands/enragedeath.js` |
| `[agent] no bosses_local match for "<mob>" and no exact eqemu resolution — encounter not persisted` | ~420 in 90 min | **Expected, downgraded, bot 4.0.14.** Agents upload trash fights with ambiguous names; they are dropped as before. Now stdout, at most once an hour per name. | `index.js` `_logUnmatchedMob` |
| `[raidhelper-api] GET /api/v2/events/<id> → 404 … Endpoint … not found` | ~123 a day | **Fixed, bot 4.0.14.** Raid-Helper retired the v2 per-event route for every event (v4 serves the same event). The sync never needed it: the v4 listing carries each event's signups. The sync no longer asks; `getEvent` uses v4. | `utils/raidhelperApi.js` |
| `[spell-catalog] DS formula <n> not modeled — using \|base\|` | formulas 8, 32, 110, 119, 122, ~12 each a day | **Expected, downgraded, bot 4.0.14.** Stdout, once per formula per process (the set used to be rebuilt every catalog rebuild). Model a formula if a real damage-shield buff needs it. | `index.js` `_dsFormulaValue` |
| `[supabase] POST /chat_messages … 21000 "cannot affect row a second time"` | 3 a day | **Fixed, bot 4.0.14.** A batch carried the same (guild, ts, channel, speaker, text) twice; both chat upserts de-duplicate first. | `index.js` `_dedupeRows`, `_chatRowKey` |
| `[supabase] POST /character_aas → 409 23505 character_aas_pkey` | 1 a day | **Fixed, bot 4.0.14.** Repeated AA index in one export, or two uploads racing the delete-then-insert. De-duplicated and upserted on the primary key. | `index.js` `_handleAgentQuarmy` |
| `[supabase] POST /zeal_tag_observations → 409 23505` | ~6 a day | **Fixed, bot 4.0.14.** Several agents report the same /tag; written through `insertIgnoreDuplicates` (the unique index is not the primary key). | `index.js` `_noteZealTags` |
| `[quarm-notes] N of M message(s) read had no content, embeds or attachments` | ~5 a day | **Expected, downgraded, bot 4.0.14.** A partial read is a diagnostic. The "every message empty" line (Message Content intent off) stays a warning: that one is a real misconfiguration. | `index.js` `_syncQuarmPatchNotes` |
| `[supabase] request failed (timeout 10000ms)` | ~3 a day | **Watching.** Slow reads hitting the 10 s client timeout; one was on `encounter_threat_snapshots`, the known oversized table (CLAUDE.md, Supabase section). | `utils/supabase.js` |
| `[budget] encounter: uploader … over budget … log-only, allowing` | ~2 a day | **By design** (admission control in log-only mode, CLAUDE.md #73). Revisit if it becomes frequent. | `index.js` budgets |
| Railway build: `failed to fetch snapshot` (deployments 797f74f8, 542e03cf) | 2 on 2026-10-24 | **Infrastructure (Railway's builder).** The snapshot uploaded, then the builder could not read it back. A redeploy of the same commit built fine (700fa862). Not caused by code. | — |
