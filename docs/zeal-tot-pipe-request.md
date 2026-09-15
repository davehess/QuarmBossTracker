# Zeal PR draft — put Target of Target on the named pipe

*Drafted 2026-09-12 against Zeal v1.4.7 (`e24a3ed`). The patch is
`docs/zeal-tot-pipe.patch`; it applies cleanly to a v1.4.7 checkout
(`git apply docs/zeal-tot-pipe.patch`). It has NOT been compiled here — a cloud
session has no MSVC — so build it once locally before opening the PR.*

**Opened by:** Hitya, under their own GitHub account (same as #229).
**Upstream:** https://github.com/CoastalRedwood/Zeal — the assist bar is #228
(Larcen22), the spawn ids on the pipe are #229.

---

## PR title

`named_pipe: emit target of target from the assist bar module`

## PR body (paste as-is)

Follow-up to #228 and #229. The `/assistbar` module resolves an assist
candidate for the current target but nothing outside the bar can read it. This
emits it on the named pipe's `player` message so a third-party tool can show
"who is my target on" without re-deriving it from chat.

**What changes**

- `AssistTarget` gains a render-independent resolver, `ResolveCandidate(target_id,
  now, defend, use_assist_reply)`, and `LookupLiveEntity(id)`. `CallbackRender`
  now uses them; the bar's behaviour is unchanged (same two sources, same
  freshness rules, same corpse filter).
- The packet hooks are gated on `IsActive()` = bar enabled OR a pipe client
  attached, instead of the bar alone. A user who never turns the bar on and has
  no pipe consumer still pays nothing. With the bar off, damage inference runs
  for the pipe; the synthetic `/assist` poll stays tied to the bar being enabled
  (no new server traffic is introduced by this PR), and an OP_Assist reply is
  recorded but never swallowed unless the bar's own poll asked for it.
- `named_pipe.cpp` adds two optional keys to the `player` message, both omitted
  when there is no fresh candidate (same convention as `target_id` / `pet_id`):
  - `target_of_target` — who the target last hit (assist semantics)
  - `target_hit_by` — who last hit the target (defend semantics)

  Each is `{ "id": <spawn id>, "name": "<name>", "authoritative": <bool> }`.
  `authoritative` is true when the value came from the server's `/assist`
  reply; `name` is omitted when the entity is gone or a corpse. Both directions
  are emitted so a consumer does not depend on the user's bar mode.
- README: a "Target of target" subsection under "Zeal pipes".

**Why both keys instead of "what the bar shows"**

The bar's mode is a display preference. A consumer that wants "which player is
this mob on" needs assist semantics regardless of how the user set their bar,
and one that wants "what is beating on my target" needs the other. Two flat keys
cost nothing and avoid a mode field the consumer would have to interpret.

**Test plan**

1. Build; `/pipeverbose on`; attach any pipe reader (the C# example in the
   README works).
2. `/assistbar off`. Target a mob in combat with a group: the `player` message
   carries `target_of_target` with `"authoritative": false` once the mob has
   swung at someone; `target_hit_by` appears once someone hits it.
3. `/assistbar on`: within one server round-trip `target_of_target` flips to
   `"authoritative": true` (the target-change poll). `/assistbar refresh on`
   keeps it true between polls.
4. Detach the pipe reader with the bar off: no damage packets are processed
   (`/assistbar verbose` prints nothing) — `IsActive()` is false.
5. Bar on, no pipe: renders exactly as before this change.

---

## What we do with it once it lands (our side, not for the PR)

Mimic `zealPipe.js` reads `player.target_of_target` and `player.target_hit_by`;
the agent carries them on live-state; the Extended Target overlay's "→ tank"
arrow becomes authoritative for your own target, and the cross-Mimic relay makes
every raider's answer visible to everyone. Ties into the open "null a
`target_id` of 0 at the edge" item — the new keys use omission, not 0, so no
sentinel handling is needed for them.


---

## Second ask, same message: the target's race and gender (2026-09-15)

**Why.** Plane of Hate's `a forsaken revenant` is two NPCs with one name — a
male Magician and a female Enchanter, identical in level, HP, model and
specials. The only in-game tell is the sex of the body you are looking at, and
the pipe's target object is `{id, name}`, so a companion tool cannot say which
one you have. It is not a one-off: any zone that reuses a name across two class
variants has the same hole, and the catalog rows differ only in `gender`.

**What.** Two more keys on the `player` message's `target` object, both from
the target `Entity`: its race id and its gender (0 male, 1 female, 2 neuter —
the same values the server's `npc_types` uses). Omit them when there is no
target, like `target_id`. No new packets, no new state — the entity is already
in hand where `target_id` is written.

**Our side.** Mimic passes `target.gender` / `target.race` to the agent; the
agent adds `gender=` to its mob-info lookup; the bot already honours that hint
(3.1.127) and picks the exact catalog body. Until then Mob Info shows both
classes on a disagreement.
