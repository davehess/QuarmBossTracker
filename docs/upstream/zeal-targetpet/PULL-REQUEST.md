# Zeal PR draft — `/targetpet`: target your own pet from a hotkey

*Drafted 2026-10-19 against Zeal v1.4.8 (`50dc9a4`), from the guild lead's pick of option A in
DECISIONS-2026-09-21 §59e (decision desk, §383): "a `/targetpet` slash command in Zeal that the member
binds to a social hotkey; no Mimic change." The change is `0001-target-pet.patch` in this folder: 72 added
lines, 7 files, nothing existing is edited except one-line wiring. **Not compiled and not run in game.**
No branch is pushed yet (see "Before opening the PR").*

## How sure this is, plainly

The Zeal source is not in this repo. What is here is notes and patches written against it, so the patch
is built from lines that already compiled and (for the ids) ran, not from reading the current tree.

| Part | Where it comes from | Confidence |
|---|---|---|
| Registering a command: `zeal->commands_hook->Add("/name", {}, "help", handler)`, handler `bool (std::vector<std::string> &args)`, `return true` = handled, `args.size() == 1` means no arguments | `docs/upstream/zeal-hide-ui-cursor/0001-hide-ui-cursor.patch` (`/uicursor`), compiled by GitHub 2026-10-09 | High |
| The wiring (new `.h`/`.cpp`, `Zeal.vcxproj`, `.filters`, `zeal.h` member, `zeal.cpp` include and `MakeCheckedUnique`) | The same patch's wiring hunks, copied with the names changed. They apply cleanly to a base rebuilt from that patch's own context (`git apply --check` passes) | High, but the hunks conflict with it if both are applied; rebase whichever goes second |
| `Zeal::Game::get_self()->ActorInfo->PetID` is the pet's spawn id, a SHORT that holds **-1**, not 0, with no pet | Zeal PR 229 (merged, 1.4.6): `docs/upstream/zeal-spawn-id/pr-body.md`, and the `-1` bug found live in `pr-229-build-report.md` | High |
| `Zeal::Game::get_entity_by_id(id)` rejects ids outside the spawn table | PR 229 notes (`zone_map.cpp` relies on it) | High |
| `Zeal::Game::get_target()`, `print_chat(fmt, ...)`, `is_in_game()` | Used by the compiled patches in `docs/upstream/` | High |
| **`Zeal::Game::set_target(Entity *)`** | DECISIONS §59e (read from the source 2026-09-27: "targets an entity without the `/target` range rules") and DECISIONS-2026-09-10 (the Assist Bar's `HandleLMouseUp` calls it). **No patch in this repo calls it, so the exact signature is unconfirmed** | Medium: the one line most likely to need a fix at compile time |
| A charmed pet fills `PetID` like a summoned one | Expected (`docs/STATUS.md` line 1544 reads the charm target's id from the pipe's `pet_id`), **not confirmed** | Medium: test 4 below |

If `set_target` takes another type, or a second argument, that is the only line that changes.
The alternative §59e names, `Zeal::Game::get_pet()`, is not used here because nothing in this repo shows
its signature, while the `PetID` + `get_entity_by_id` route is the one that is verified.

## Exact behaviour

`/targetpet` (no arguments):

1. Not in game: nothing happens.
2. No pet (`PetID <= 0`): prints **`You do not have a pet to target.`** The target does not change.
3. A pet id the spawn table does not hold (zoning, out of range): prints **`Your pet could not be found
   (out of range or zoning).`** The target does not change.
4. Otherwise the pet becomes the target (a no-op if it already is). Nothing is printed.
5. Any argument (`/targetpet now`): prints **`Usage: /targetpet`**.

Works at any distance the game would allow for a pet, because it targets by entity, not through
`/target`'s name search and range rules. A charmed pet is included if test 4 passes. It does not attack,
move or command the pet: it only changes the target, so it is the same as clicking the pet window.

## What changes (72 lines added, 7 files)

- New `TargetPet` class (`target_pet.{h,cpp}`, 56 lines) whose constructor registers the command.
- `zeal.h` / `zeal.cpp`: one member, one include, one `MakeCheckedUnique(TargetPet)`.
- `Zeal.vcxproj` and `Zeal.vcxproj.filters`: the two new files.
- `README.md`: a `/targetpet` entry. It sits before `/uierrors` only because that is the anchor the
  copied hunk had; **move it to the alphabetical spot** among the commands upstream.

Code, in full (`target_pet.cpp`):

```cpp
bool target_pet(std::vector<std::string> &args) {
  if (args.size() > 1) { Zeal::Game::print_chat("Usage: /targetpet"); return true; }
  if (!Zeal::Game::is_in_game()) return true;
  const auto *self = Zeal::Game::get_self();
  const int pet_id = (self && self->ActorInfo) ? self->ActorInfo->PetID : -1;
  if (pet_id <= 0) { Zeal::Game::print_chat("You do not have a pet to target."); return true; }
  auto *pet = Zeal::Game::get_entity_by_id(pet_id);
  if (!pet) { Zeal::Game::print_chat("Your pet could not be found (out of range or zoning)."); return true; }
  if (pet != Zeal::Game::get_target()) Zeal::Game::set_target(pet);
  return true;
}
// TargetPet::TargetPet(ZealService *zeal):
//   zeal->commands_hook->Add("/targetpet", {}, "Targets your own pet (works for a charmed pet too).", target_pet);
```

## Not in this PR

- A click-to-target pet row in Mimic's Charm window. That is §59e option 2 (an inbound command channel in
  Zeal), a policy question about software outside the game driving the client, and the guild lead did not
  pick it. Nothing in Mimic changes.
- A keybind entry in Zeal's options window (needs XML in both `uifiles` trees). A social button or a macro
  covers it.
- `CHANGELOG.md`: upstream writes it per release.

## Test plan (in game, a pet class and an enchanter or bard)

0. **Before anything else:** in a build WITHOUT this change, type `/target mypet` with a pet up. If the
   client already targets the pet, tell the guild lead before filing: the command may be redundant. (Not
   checked; that is a client feature, not a Zeal one.)
1. Summon a pet (magician, necromancer, shaman, beastlord), target something else, type `/targetpet`: the
   pet is targeted and the target window shows it. Type it again: nothing changes and nothing prints.
2. Bind it: Social page, a button whose first line is `/targetpet`; press it mid-fight. Same result.
3. No pet (dismiss it, or a class with none): `You do not have a pet to target.` and the current target
   stays.
4. **Charm:** charm a mob (Allure, Dictate, Beguile) and type `/targetpet`. If it prints the no-pet line,
   the client does not fill `PetID` for charmed pets; report it, because the charm window case is why
   this was asked for.
5. Zone with the pet and type it during the load: no crash; right after, it targets the pet or says it
   cannot find it.
6. The pet far away (out of the zone's draw distance) and the pet dead: a message or the pet, never a crash
   and never a corpse targeted.
7. `/targetpet extra`: `Usage: /targetpet`.
8. Two clients on one machine: each targets its own pet.
9. Mimic running: the Zeal pipe's `pet_id` is unchanged and the Charm window still tracks the pet.

## Before opening the PR

1. Fork `davehess/Zeal`, branch from the default branch at v1.4.8 (`50dc9a4`) or later, then
   `git am docs/upstream/zeal-targetpet/0001-target-pet.patch`. If the wiring hunks do not apply because
   `hide-ui-cursor` landed first, apply the two new files and add the wiring edits by hand (the patch
   shows each: two project-file lines, a filters entry, the `zeal.h` member, the `zeal.cpp` include and
   constructor line, the README entry).
2. Build it (`msbuild /m /p:Configuration=Release /p:Platform=x86 Zeal.sln`). The first thing to check is
   `set_target`'s signature.
3. Run the test plan, then re-author the commit as yours
   (`git commit --amend --no-edit --reset-author`) and open it against CoastalRedwood/Zeal.
4. Add a row to `docs/upstream/README.md`'s index (this folder is not listed there yet), and a
   `SUGGESTION.md` and `TEST-CASES.md` in the other folders' shape once the test plan has run.
