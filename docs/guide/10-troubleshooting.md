# Troubleshooting (for raiders, officers and maintainers)

For raiders whose setup misbehaves and for the officers and maintainers who get the report. Find the symptom, try the fix. Every row names where it was recorded.

## Zeal, overlays and Mimic updates

| Symptom | Cause | Fix | Source |
|---|---|---|---|
| Agent log repeats `[zeal] disconnected from \\.\pipe\zeal_<pid> (EPERM)`; no Zeal data ever arrives | Windows is refusing the pipe. Seen with **Windows XP compatibility mode** on `eqgame.exe`, which a community crash checklist recommends. The mechanism is not confirmed | Untick "Run this program in compatibility mode for" on `eqgame.exe`. **Ask about compatibility mode first on any EPERM report** | `CLAUDE.md` (Mimic) |
| Mimic cannot find Zeal at all (`ENOENT`, no pipe) | One report: Mimic installed *inside* the EQ folder, so its bundled DLLs or antivirus interfere with Zeal | Reinstall Mimic outside the EQ folder | `apps/mimic/zealPipe.js` |
| The pipe connects, then drops at once with no error code; the health overlay says "EQ is not running"; or EQ runs and **no overlay shows** | **Elevation mismatch**: EQ elevated, Mimic not. Reported repeatedly | Run Mimic as administrator to match EQ, or run both normally. Restart EQ after changing either. Check compatibility and elevation separately: both are on the same tab | `apps/mimic/zealPipe.js`; agent `dashboard.html` |
| Zeal install, **Set up for me** or UI backup fails with EPERM; "EQ folder writable" is red | EQ lives under `Program Files` | Move the EQ folder out, or grant your account write access | agent `dashboard.html` |
| Windows SmartScreen warns "unknown publisher" | The installer is not code-signed. That costs money; it says nothing about safety | **More info, Run anyway** (Edge: ⋯, Keep, Keep anyway). Scan it on VirusTotal if you like | `README.md`; `docs/PRIVACY.md` |
| Beta Mimic: "Update check failed: No published versions on GitHub" | GitHub's release feed holds 10 entries, and experimental `-linux.N` builds pushed every beta out | Maintainers: run `prune-linux-releases.yml`. Anything choosing "the newest beta" must require a `-beta.N` tag | `CLAUDE.md`; `.github/workflows/prune-linux-releases.yml` |
| Banner "agent is below the guild minimum", or "paused by guild control plane"; or an update "deferred" | An officer set a version floor or the kill switch, or the update gate is holding (fight live, uploads queued, backfill running, or the Sun/Wed/Thu 19:00 to 00:30 ET raid hold) | Press **[U]** or ↻ Update for the floor. Otherwise wait for the officer to lift the pause, or for the raid hold to end. `Shift+U` bypasses the gate | agent `dashboard.html`; `index.js` |

## Logs, meters and triggers

| Symptom | Cause | Fix | Source |
|---|---|---|---|
| "No EQ logs are being read", or the checklist's "In-game logging ON" is red | EverQuest is not writing a log | Type `/log on` in EQ. **Set up for me** also switches logging on in `eqclient.ini` | agent `dashboard.html` |
| "Your EverQuest log has gone quiet"; no damage on fights, no rolls | EQ stopped writing the log mid-session. **Why is unknown**; do not blame file size | `/log off`, then `/log on`. Or press **🗄 Archive log & start fresh**, which moves it to `LogArchive` and deletes nothing, then `/log off` and `/log on` | `docs/DECISIONS-2026-09-21.md` §162, §164 |
| The DPS meter is empty | The meter is local and needs no sign-in. Recorded causes: EQ closed; logging off or quiet (rows above); the character is unticked or set to **Hide completely** in setup, so Mimic never opens its log; the overlay is hidden by an elevation mismatch | Read the dashboard's **Setup checklist** top to bottom; each row names its own fix | agent `dashboard.html` |
| A trigger never fires | Trigger patterns match the **raw log line**, which starts `[Sun Aug 02 21:10:01 2026] `. Patterns compile case-insensitive with no `m` flag, so a bare `^` anchors before the *timestamp* | Write the pattern unanchored, or anchor with `^\[.+?\]\s+`. **Do not just delete the `^`**: `{s}` matches a space, so you capture " Name" with a leading space and break name-keyed features. Agent 3.5.46+ rewrites a bare `^`, and `/admin/triggers` rewrites it on save | `CLAUDE.md`; `web/lib/triggerPattern.ts` |
| A trigger is enabled and anchored correctly, still silent | An **invented pattern**: it matches text the game never prints | Check the real strings in `eqemu_spells` (`cast_on_you`, `cast_on_other`, `spell_fades`). An enabled trigger reads as coverage, which hides this | `CLAUDE.md`; `docs/RUNBOOK-dead-triggers.md` |
| Charm timers or pet buffs look wrong | Any of four pipeline stages | Open the **🐺 Charm diagnostic** card on the Triggers tab before debugging by hand | `CLAUDE.md` |
| A parse card shows one raider dying twice | An install whose clock runs about 45 s off, past the 30 s duplicate window; or feign-death spam from Shadow Knights and Necromancers (one fight logged 63 "deaths") | Clock offsets are measured per install, and the feign fix is in agent 3.5.11 and later. ⚠ The runbook is a plan from 2026-08-04: check `docs/STATUS.md` for what shipped since | `docs/RUNBOOK-death-backfill.md` |

## Client crashes

| Symptom | Cause | Fix | Source |
|---|---|---|---|
| "D'oh! Client crash" dialog | Usually the graphics driver resetting under the 2002 client | Send the newest `<EQ folder>\crashes\<name>.zip`. Try windowed or borderless, move Windows sound off the graphics card, clean-reinstall the driver, or add dgVoodoo2's `d3d8.dll` and `ddraw.dll` beside `eqgame.exe`. The dialog's Zone ID is **hex** on Zeal 1.2.0 and later | `docs/RUNBOOK-client-crash-triage.md` |
| "Failed to load the graphics DLL!" | `eqgame.dll` beside the exe is not the client's own | Restore it from the original Quarm client download. `/zeal version` shows the build | `docs/RUNBOOK-client-crash-triage.md` |
| EQ will not launch ("Memory could not be read"), even without Zeal, after it worked yesterday | One report traced it to a Windows 11 preview update. ⚠ one machine; mechanism unknown | Check update history for the update named in the runbook and uninstall it | `docs/RUNBOOK-client-crash-triage.md` |

Mimic does most of this triage itself, but uploading its crash summary is a separate opt-in. The dump never leaves your PC.

## Sign-in and the beta site

| Symptom | Cause | Fix | Source |
|---|---|---|---|
| Discord sign-in is blocked by a verification wall | Discord blocks the consent screen | An officer issues a site-access invite at `/admin/links` (single-use, 7 days, sent by DM), and for Mimic a 6-character code (10 minutes) | `docs/RUNBOOK-site-access.md` |
| "Wrong username or password" on the first try, or "Your guild roles don't include site access yet" | The first can be false: the server may have signed you in. The second: roles sync every 6 hours | Refresh first. Fix the Discord role, wait or trigger a member sync, then re-issue the invite | `docs/RUNBOOK-site-access.md` |
| Sign-in on the beta site finishes, but you land signed in on production | Supabase ignores a `redirectTo` that is not on its allowlist and uses the Site URL. Nothing errors | Add the beta host (`https://b.<your-domain>/**`) to Auth, URL Configuration, Redirect URLs. **No second Discord app is needed** | `CLAUDE.md` |
| Beta sign-in fails with "SUPABASE_SERVICE_ROLE_KEY not set on the server" | The variable is enabled for Production only | Enable **every** variable for Preview too, then redeploy | `CLAUDE.md` |

## Hosting

| Symptom | Cause | Fix | Source |
|---|---|---|---|
| Bot boots with `[state] state.json not found — creating fresh state` | Normal: Railway has no volume, so every deploy starts fresh | Keep per-night or per-fight state in `bot_kv`. Keep Discord anchors in env vars, or cards repost (one night posted a review eleven times) | `CLAUDE.md` |
| Vercel: "Deployment rate limited — retry in 24 hours" | Hobby allows 100 deployments a day; every push to any branch counts, even a skipped build | Only `main` and `beta` build (`web/vercel.json`). Wait. The reason shows on the commit's status | `CLAUDE.md` |
| A self-hosted `next build` stops with no error | An out-of-memory kill. The build needs about 8 GB | Give the builder more memory | `docs/DESIGN-selfhost-wizard.md` |
| A database read returns exactly 1,000 rows and looks complete | PostgREST silently caps every response at 1,000 | Page it (`selectAllPaged`, `web/lib/selectAll.ts`) with a stable `ORDER BY` | `docs/GEMINI-SPARK-HELPER.md` §10 |
| A feature fails although its migration is committed | The migration integration stalled once and applied nothing for three days | Compare the newest file in `supabase/migrations/` with `supabase_migrations.schema_migrations` | `docs/DESIGN-selfhost-wizard.md` |
| The bot connects but member sync never works (self-host) | The privileged **Server Members** intent is off in the Discord developer portal. Nothing warns you | Turn the intent on, restart the bot | `docs/DESIGN-external-tenancy.md` |
