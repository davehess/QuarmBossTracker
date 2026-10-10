![Export #POPFLAGS on /camp](https://raw.githubusercontent.com/davehess/Zeal/showcase/showcase/posters/popflags-export-banner.png)

# Save your #popflags output with "Export data on /camp"

*Fork branch `popflags-export` (`b27bb26`), based on Zeal 1.4.8. Status: draft; in the test-all build (`593f848`). Two in-game runs so far; the fixes from the second (repeats, chat flood) need a third.*

This answers the suggestion thread 'Zeal "Export data on /camp" option to include a full #POPFLAGS output?'.

**What**
With "Export data on /camp" on, camping now also saves your Planes of Power flag progress to `<name>-PoPFlags.txt`, next to the inventory, spellbook and Quarmy files. `/outputfile popflags` does the same on demand.

**Why**
Guilds collate PoP flags by hand in spreadsheets. The server already prints each character's flags with `#popflags`, but only into chat, where it scrolls away. A file per character, written at the end of the night, can be collected and merged by a script.

**How**
`#popflags all` is limited to server staff, so Zeal asks the way a player would: `#popflags` (the overview), then `#popflags 1` to `5`, a quarter second apart. Until 1.5 seconds after the last one it takes the reply's lines (white, lime, yellow and red server text; player chat, combat and NPC speech are skipped), drops the chat timestamp, and writes them under three header lines (character, timestamp, command) and a `---` line. The reply goes to the file, not the chat window, so camping does not flood your chat. Nothing waits on the server, so the game never stalls. If the server sends nothing, no file is written. A new request needs 15 seconds since the last, and none is sent when the camp is not going ahead. About 130 lines in `outputfile.cpp` and `outputfile.h`, plus README and CHANGELOG. No new setting, but players who already have "Export data on /camp" ticked will start sending these six commands when they camp.

The file keeps the server's reply line for line, so it stays correct if the server changes its wording.

**How tested**
- In game, on an earlier build that sent `#popflags all`: camping wrote `<name>-PoPFlags.txt` with the header and the server's one reply ("The all option is restricted to server staff."). That proved the camp hook, the colour filter and the file; it is also how we found `all` is staff-only.
- In game, on the next build: the full reply came back, but each section printed several times and flooded the chat at camp. Zeal's delayed callbacks can run on more than one frame (they fire when the time is reached but are removed only once it has passed, and the tick count moves in 10-16 ms steps), so each send now runs once, and the reply is kept out of the chat window. A simulation of that frame/tick behaviour confirms one send per command.
- The server's own `#popflags` code was read to pick the player commands and to check every reply line uses a colour the filter keeps.
- The capture, the timing rules, the empty-reply case, the file layout and the timestamp strip ran against a stand-in on Linux; clang-format with Zeal's style is clean.
- The whole fork is built by GitHub from test-all. The remaining cases are in `TEST-CASES.md`.

**Try it:** in the fork's test-all build (https://github.com/davehess/Zeal/releases/tag/test-all-build), `593f848` or later, then `/outputfile popflags`.

**Pull request:** _link added when it is filed._

**Testing evidence:** _added after the in-game test run._
