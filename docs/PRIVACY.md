# Wolf Pack — Privacy, in plain words

> Source of truth for the public privacy statement. Mirrored on
> `wolfpack.quest/privacy` (`web/app/privacy/page.tsx`) and linked from the
> global footer + the welcome onboarding embed. Keep this file and the page
> in sync.

**The spirit.** This stuff exists to make raids easier to run when things get
hectic — and to carry some of the load for the officers who prep at all hours.
It is **not** here to grade anyone. We don't track who caused a wipe, and we never
will. Parses are for coordination and a little friendly fun. Healers, tanks, DPS:
a rough night is just a rough night. It's a game. Nobody here is "not doing enough."

**Is it a keylogger? Is it a virus?** Short answer: **no — and you don't have to
take our word for it.** The cautious instinct is healthy, so here's what it is and
how to prove it to yourself.
- **It reads EverQuest's log file — not your keyboard.** When you turn on logging
  (`/log on`), EverQuest writes everything to a text file. Mimic just *reads that
  file*. It does **not** record keystrokes, watch your screen, or see your browser,
  passwords, or anything outside EverQuest. A keylogger hooks your whole keyboard —
  Mimic literally only opens EQ's own log.
- **It's an ordinary app, not a virus.** No admin rights, no drivers, no Windows
  services, no changes to system files or startup. Installs to your own user folder
  and uninstalls cleanly. It can't touch other programs or your OS.
- **It's 100% open source.** Every line is public on GitHub
  (github.com/davehess/QuarmBossTracker). Keylogger authors don't publish their
  code. Have any techy friend look — what you see is what it does.
- **Verify it yourself:** scan the installer on VirusTotal (an unsigned installer
  can trip 1–2 over-cautious heuristics — that's the "not code-signed yet" thing,
  not a real virus); watch Task Manager (one app, talking to one server + GitHub);
  the dashboard shows exactly what it uploads, live, and the pending-upload file on
  disk is plain readable text.
- The scary **"unknown publisher"** popup is paperwork, not danger — Windows warns
  about any app that hasn't paid for a code-signing certificate yet. We're sorting
  signing out.

**Your data stays yours.**
- Your raw EverQuest logs and game files **stay on your device and your network.**
  The tool reads them locally.
- Only what you opt into is ever synced — and only over an **authenticated**
  connection tied to your Discord login.
- We **never** upload officer chat, tells, or private channels. They're filtered
  out on your own machine before anything leaves it.

**You're in control.**
- Pick which characters take part. Exclude any character from stats, or from
  inventory cataloguing, at any time — even one that's in another guild.
- Turn logging off and uploading stops. No agent running = nothing collected.
- See everything we have on you, anytime, in `/me`. Ask an officer to remove it and
  we will.

**Who sees what.**
- 🔒 **Private** — only you (your detailed stats, your inventory, your tells). Gated
  to your login; never named anywhere else.
- 👤 **Anonymous** — guild-wide totals with **no names** (e.g. "the Pack summoned
  4,000 stacks of food").
- 🐺 **Guild** — shared with signed-in members (parses, DKP, attendance, kill timers).

**What we keep, and why.**
- Combat parses — coordination and friendly competition.
- Attendance (ticks) — fair DKP.
- Guild/raid chat timeline — our shared history.
- `/who` sightings — keeping the roster straight.
- Your stats only count from **when you joined us** — we don't reach back before your
  first guild day. (PvP kills are public server events, counted from the start.)

**That's it.** No selling, no ads, no leaderboards of who whispered whom. Just tools
to help the Pack run smoother on a crazy night.
