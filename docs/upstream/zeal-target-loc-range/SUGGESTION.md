# Raise the pipe's target-position range from 250 to ~450

**What.** Zeal 1.4.8's named pipe exports `target_loc` only while the target is within 250 units of the player
(`Zeal/named_pipe.cpp`, the `distance_sq < 250.f * 250.f` check added with #239). We ask to raise that limit to about
**450**, so the target keeps a position for the whole range a player can actually hit it from. The intent of the cap
(no locating spawns across a zone) is unchanged: 450 is still well inside a zone and still bound to your own target.

**Why.** At 250 the target position disappears exactly when you are attacking from range:

- **Archery.** A shot's range is the bow's range plus the arrow's range (plus a small size adjustment). The best bows
  (Bow of Storms, Bow of Shadows, Bow of Doom, Warmaster's Recurved Longbow, Blessed Faydark Thunderbolt) are range
  **250 on their own**, and a common arrow adds 150 (the longest adds 170), so a shot from them reaches **400–420**
  before the size adjustment. Across all bows, with a 150 arrow, 82 reach 251–300 and 66 reach 301–400. A ranger
  pulling at full range loses their target's position for the last 150+ units of the shot.
- **Nukes.** The Wizard and Magician bolt line is range **300**: Frost Bolt (WIZ 1), Fire Bolt (WIZ 8), Lightning
  Bolt (WIZ 16), Flame Bolt (MAG 8), Bolt of Flame (MAG 20), Cinder Bolt (MAG 34), Lava Bolt (MAG 49), Scars of
  Sigil (MAG 54), Seeking Flame of Seukor (MAG 59), Firebolt of Tallon (MAG 61).
- **Pulling and utility.** Flare is 400, Fade is 350.
- For comparison, the crowd-control family (snare, root, mez, lull, Harmony, slow and the debuffs) is 200, inside the
  current cap, so those are not affected either way.

Long-range utility spells (Summon Corpse, Call of the Hero, Vision, Yonder, Shadow Step) are deliberately NOT part of
this ask; we are not asking to follow anything beyond combat range.

**How.** A one-constant change: `250.f` → `450.f` (or a named `kTargetLocMaxRange`). No new data is exported; the
same three numbers are sent for the same target, just for longer.

**How tested.** Numbers come from Project Quarm's own server database (`spells_new.range`, `items.range`, dump
`quarm_2026-09-27-22_44`). In game: target a mob at 260–420 units with a bow equipped and while casting a 300-range
bolt, and check that `target_loc` keeps arriving on the pipe.

**Try it.** Our fork carries a test-only build with the cap removed (branch `target-loc-range`, clearly marked
"test build only, not for upstream"); the requested change is the raised limit above, not removal.
