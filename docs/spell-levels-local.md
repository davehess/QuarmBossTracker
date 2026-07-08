# Building out spell levels (run locally)

The missing-spells page groups by scribe level. A spell nobody in the guild has
scribed-and-uploaded has **no level to group by** — every PoP 61–65 spell (locked
until 2026-10-01) and any older spell the roster never uploaded. The `eqemu_*`
mirror carries no per-class level (spell `raw` is effect-only, item
`required/recommended_level` are 0), and PQDI 403s the server, so nothing can
derive them automatically.

This fills the gap with the `spell_level_seed` table. **It's self-healing:**
`character_missing_spells` coalesces the *guild-scribed* level first and this
seed second — so the moment a real druid scribes a PoP spell and uploads their
book, their actual level overrides the seed. The seed is just a planning
placeholder until then.

You have two ways to fill it: **A) auto-scrape PQDI from your machine** (fast),
or **B) a hand-fill worksheet**. Either produces `INSERT`s you paste into the
Supabase SQL editor.

---

## Option A — scrape PQDI locally (recommended)

PQDI is reachable from your home machine (it only blocks the server), so a small
local script can read the real Project Quarm levels.

### 1. Export the spells that still need a level

Run this in the **Supabase SQL editor** and copy the single JSON blob it returns
into a file named `spells-todo.json`:

```sql
select json_agg(json_build_object(
         'spell_id', spell_id, 'spell_name', spell_name, 'class_bits', class_bits))
from (
  select distinct on (s.id)
    s.id                                   as spell_id,
    s.name                                 as spell_name,
    i.classes                              as class_bits
  from eqemu_items i
  join eqemu_spells s
    on lower(s.name) = lower(regexp_replace(substring(i.name from 8), '\*+\s*$', ''))
  where i.name like 'Spell: %'
    and not exists (select 1 from spell_level_seed sd where sd.spell_id = s.id)
    and not exists (select 1 from character_spellbook cs
                    where lower(cs.spell_name) = lower(s.name) and cs.spell_level is not null)
  order by s.id
) t;
```

### 2. Run the fetcher (Node 18+, zero dependencies)

Save as `fetch-spell-levels.mjs` next to `spells-todo.json`, then
`node fetch-spell-levels.mjs`. It fetches each spell's PQDI page, pulls the
per-class levels, and writes `seed.sql`. Spells it can't parse are listed at the
end so you can hand-fill them.

```js
// fetch-spell-levels.mjs — read spells-todo.json, scrape PQDI, emit seed.sql
import { readFileSync, writeFileSync } from 'node:fs';

const spells = JSON.parse(readFileSync('spells-todo.json', 'utf8')) || [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = [], manual = [];

// EQ class bit -> PQDI class name. The seed is ONE level per spell; for a
// multi-class scroll we take the lowest class level (earliest availability).
const BITS = [[2,'Cleric'],[4,'Paladin'],[8,'Ranger'],[16,'Shadow Knight'],
  [32,'Druid'],[128,'Bard'],[512,'Shaman'],[1024,'Necromancer'],
  [2048,'Wizard'],[4096,'Magician'],[8192,'Enchanter'],[16384,'Beastlord']];

for (const s of spells) {
  try {
    const res = await fetch(`https://www.pqdi.cc/spell/${s.spell_id}`, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' },
    });
    if (!res.ok) { manual.push(`${s.spell_id}\t${s.spell_name}\tHTTP ${res.status}`); await sleep(300); continue; }
    const html = await res.text();
    // Grab every "ClassName (NN)" / "ClassName NN" the page shows for this
    // scroll's classes; keep the lowest. Adjust these patterns if PQDI's
    // markup differs from what you see in "View Source".
    const wanted = BITS.filter(([b]) => (s.class_bits & b) > 0).map(([,n]) => n);
    let best = null;
    for (const cls of wanted) {
      const rx = new RegExp(cls.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + '\\D{0,6}?(\\d{1,2})');
      const m = html.match(rx);
      if (m) { const lv = +m[1]; if (lv >= 1 && lv <= 75 && (best === null || lv < best)) best = lv; }
    }
    if (best === null) manual.push(`${s.spell_id}\t${s.spell_name}\t(no level parsed)`);
    else out.push(`  (${s.spell_id}, ${best})`);
    process.stdout.write(best === null ? '?' : '.');
    await sleep(300); // be polite
  } catch (e) { manual.push(`${s.spell_id}\t${s.spell_name}\t${e.message}`); }
}

const sql = out.length
  ? `insert into public.spell_level_seed (spell_id, level, source, note) values\n${out.join(',\n')}\n` +
    `on conflict (spell_id) do update set level = excluded.level, source = 'pqdi', updated_at = now();\n`
  : '-- nothing parsed\n';
writeFileSync('seed.sql', sql);
console.log(`\n\nWrote seed.sql: ${out.length} levels.`);
if (manual.length) {
  writeFileSync('manual-todo.tsv', 'spell_id\tspell_name\treason\n' + manual.join('\n') + '\n');
  console.log(`${manual.length} need hand-fill — see manual-todo.tsv`);
}
```

> ⚠ The parse patterns are a best guess at PQDI's markup. Open one spell page in
> your browser, "View Source", and confirm how the class levels appear (e.g.
> `Druid (65)`); tweak the regex line if needed. Anything unparsed lands in
> `manual-todo.tsv` for Option B.

### 3. Apply

Paste `seed.sql` into the Supabase SQL editor and run it. Reload any
`/character/<name>/spells` page — the spells regroup under their new levels
immediately. Re-running is safe (it upserts).

---

## Option B — hand-fill worksheet

For anything the scraper missed (or if you'd rather just type them from
in-game / memory). Fill the level column, then wrap it in the `insert` at the
bottom.

| spell_id | spell (druid 61–65 examples) | level |
|----------|-------------------------------|-------|
| 3184 | Circle of Knowledge |  |
| 1291 | Nature's Touch |  |
| 3438 | Karana's Rage |  |
| 3580 | Spirit of Ash |  |
| … | (use the export query above for the full list) | |

```sql
insert into public.spell_level_seed (spell_id, level, source, note) values
  (3184, 62, 'officer', null),
  (1291, 65, 'officer', null)
  -- add your rows…
on conflict (spell_id) do update set level = excluded.level, updated_at = now();
```

---

## Notes

- **One level per spell.** The seed is per `spell_id`, so a scroll usable by
  several classes at different levels stores one number (the scraper uses the
  lowest). That's fine for the planning view; a real per-character scribe always
  overrides it for that character's class.
- **No install for officers.** You can also just open a druid's
  `/character/<name>/spells` page signed in as an officer and type a level in the
  little box next to each “Level unknown” spell — same table, one at a time.
- **To wipe a bad entry:** `delete from public.spell_level_seed where spell_id = <id>;`
- **To review what's filled:** `select spell_id, level, source, updated_by, updated_at from public.spell_level_seed order by updated_at desc;`
