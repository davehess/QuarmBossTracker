# Test cases: spell id in spell info (`/spellid`)

For the `spell-id-tooltip` branch (`67cb705`) or the fork's test-all build (`035d8a3` or later),
https://github.com/davehess/Zeal/releases/tag/test-all-build.

**Common setup:** a character in game with at least one buff on and one spell memorised. Have a spell database open
(for example PQDI) to check ids against.

Mark each case: `[x]` pass, `[!]` fail (write what you saw under it).

## Happy path

### 1. Off by default
- **Setup:** no `ShowSpellId` line in the Zeal ini (a fresh install, or delete the line).
- **Steps:** Alt+click a buff in the buff window.
- **Expected:** the spell info window looks exactly as it did before; no `Spell ID` line.
- **Result:** [ ] pass  [ ] fail

### 2. Turn it on
- **Steps:** type `/spellid on`, then Alt+click the same buff.
- **Expected:** chat says `Spell ID in spell info: on`. The window's last line is `Spell ID: <id>`, and the id matches the
  database entry for that buff.
- **Result:** [ ] pass  [ ] fail

### 3. Spell gem
- **Setup:** `/spellid on`.
- **Steps:** Alt+click a memorised spell gem.
- **Expected:** the info window ends with `Spell ID: <id>` for that spell.
- **Result:** [ ] pass  [ ] fail

### 4. Spellbook
- **Setup:** `/spellid on`.
- **Steps:** open the spellbook and Alt+click a spell.
- **Expected:** the info window ends with `Spell ID: <id>` for that spell.
- **Result:** [ ] pass  [ ] fail

### 5. Toggle and off
- **Steps:** type `/spellid` (no argument), Alt+click a buff; then `/spellid off`, Alt+click again.
- **Expected:** the bare command flips the setting and says which way (`off` here); after `/spellid off` the line is gone.
- **Result:** [ ] pass  [ ] fail

## Edge cases

### 6. Enhanced spell info on and off
- **Setup:** `/spellid on`.
- **Steps:** Alt+click a buff with "Enhanced spell info" ticked in Zeal's options, then again with it unticked.
- **Expected:** the `Spell ID` line is the last line in both layouts, and appears once (not twice).
- **Result:** [ ] pass  [ ] fail

### 7. Same name, different spells
- **Setup:** `/spellid on`. Two buffs or songs that share a name, or a spell and its item click version.
- **Steps:** Alt+click each.
- **Expected:** each shows its own id.
- **Result:** [ ] pass  [ ] fail

### 8. Several windows open
- **Steps:** with `/spellid on`, Alt+click three different buffs so three info windows are open.
- **Expected:** each window shows its own spell's id.
- **Result:** [ ] pass  [ ] fail

### 9. Bad argument
- **Steps:** type `/spellid maybe`.
- **Expected:** chat says `Usage: /spellid [on|off]`; the setting does not change.
- **Result:** [ ] pass  [ ] fail

### 10. Item windows unchanged
- **Setup:** `/spellid on`.
- **Steps:** Alt+click a spell scroll in your bags, and an item with a click effect.
- **Expected:** those item windows look as they did before (no `Spell ID` line). This change covers spell info only.
- **Result:** [ ] pass  [ ] fail

## Safety

### 11. Survives a restart
- **Steps:** `/spellid on`, camp to the desktop, start the game again, Alt+click a buff.
- **Expected:** the line is still there, and the Zeal ini has `ShowSpellId=TRUE` under `[Zeal]`.
- **Result:** [ ] pass  [ ] fail

### 12. Zoning and character switch
- **Steps:** with `/spellid on`, zone, then Alt+click a buff; camp to character select, log in another character,
  Alt+click a buff.
- **Expected:** the line shows after the zone and on the other character (the setting is per install, not per
  character). No crash.
- **Result:** [ ] pass  [ ] fail

## Performance

### 13. No cost when off or on
- **Steps:** with `/spellid off`, play a few minutes; then `/spellid on` and open and close spell info windows quickly.
- **Expected:** no frame-rate change either way; the line is only added when a window opens.
- **Result:** [ ] pass  [ ] fail
