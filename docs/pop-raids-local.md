# Filling in PoTime Phase 2 & 3 (run locally)

The PoP Raid Slideshow overlay (`apps/mimic/popraid.html`, data in
`apps/mimic/pop-raids.js`) ships with PoTime **Phases 2 and 3 as
`pending: true` stubs**. The captured reference docs didn't include them, and
EQProgression 403s our server/CI (same as PQDI — datacenter IPs are blocked),
so nothing can transcribe them automatically.

Your home machine CAN reach the pages. Two steps: capture locally, then hand
the capture to a Claude session to transcribe into the data module.

---

## 1. Capture the pages locally

From any machine that can browse eqprogression.com:

```powershell
# PowerShell (Windows)
Invoke-WebRequest https://www.eqprogression.com/phase-2/ -OutFile potime-p2.html
Invoke-WebRequest https://www.eqprogression.com/phase-3/ -OutFile potime-p3.html
```

or

```bash
# bash (anything else)
curl -sL https://www.eqprogression.com/phase-2/ -o potime-p2.html
curl -sL https://www.eqprogression.com/phase-3/ -o potime-p3.html
```

Browser "Save page as…" on those two URLs works just as well. If the guide
pages link per-boss diagrams for P2/P3, note their image filenames (right-click
→ Copy image address) — anything under
`https://www.eqprogression.com/wp-content/uploads/PoTime_Raid_Guide/` can go
straight into a `diagrams: [...]` entry as a bare filename.

## 2. Transcribe into pop-raids.js

Start a Claude Code session on `beta`, attach/paste the two captures, and say:

> Fill in the PoTime Phase 2 and Phase 3 sections of
> `apps/mimic/pop-raids.js` from these captures. Follow the existing encounter
> shape and remove `pending: true` from both sections.

The encounter shape (see any Tier 1 entry for a live example):

```js
{
  id: 'slug',                 // stable, kebab-case
  name: 'Boss Name',          // display
  zone: 'Plane of Time',
  npcName: 'Exact NPC Name',  // drives the live drop-table lookup (mob-info)
  callouts: ['one line per raid-leader callout, in fight order'],
  stats: { hp: '~xK (MoTM)', hits: 'n+', slow: 'slowable|unslowable', ramp: 'rampages'|null, immune: '...'|undefined },
  abilities: [{ name: 'Spell/AE', note: 'what it does, short' }],
  tracker: [{ id: 'slug', label: 'Raid-wide objective checkbox' }],
  diagrams: ['Filename.png'],   // relative to imageBase (hotlinked from EQProgression)
  guide: 'https://www.eqprogression.com/npc-…/',
}
```

Rules that keep the overlay honest:
- **Numbers are guide estimates** — Quarm is the source of truth after the
  2026-10-01 PoP unlock. Don't massage numbers to "look right"; the ⚑ flag
  button exists for the deltas raiders observe live.
- **Images stay hotlinked** — filenames relative to `imageBase`, never
  downloaded into the repo (we don't store or re-serve EQProgression's
  content; the guide link on each panel is the credit).
- `tracker` ids only need to be unique **within** the encounter.
- Ship it as an agent/Mimic change on `beta` (data module rides in Mimic).

## 3. Quarm-divergence fill-in (ongoing)

As PoP opens and fights get pulled, ⚑ anomaly flags land in the QOL thread
(`QOL_THREAD_ID`) with the guide baseline + what was observed. Fold confirmed
divergences back into `pop-raids.js`:

- encounter-level: edit the `callouts`/`stats` and note it ("Quarm: …"),
- server-wide: add a line to `quarmGlobalNotes`.

Known-divergence starting points (from the poptodo capture): access levels
46/55/60/62 differ by source; PoStorms flag = Askr collect quest, not a boss;
flag caps 72 / 36 (Carprin) / 54 (Earth A); pet/invis rework, hybrid fizzle,
and zone-punt grace already live on Quarm and carry into PoP.
