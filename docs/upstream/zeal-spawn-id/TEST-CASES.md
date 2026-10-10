# Test cases: spawn ids on the named pipe

Merged upstream (pull request 229) and shipped in Zeal 1.4.6, so these are regression checks for any later build,
including the fork's test-all build, https://github.com/davehess/Zeal/releases/tag/test-all-build. The reader used is
`scripts/zeal-pipe-peek.js` in the QuarmBossTracker repo (`node scripts/zeal-pipe-peek.js`): it reuses Mimic's pipe
reader, because the pipe is a stream of concatenated JSON objects with a double-encoded payload that a hand-rolled
reader gets wrong. Exit 0 means the build carries ids, 1 means it does not, 2 means it could not tell.

Mark each case: `[x]` pass, `[!]` fail (write what you saw under it).

## Happy path

### 1. Self id is always present
- **Setup:** logged in, any zone, Zeal running.
- **Steps:** run the pipe reader.
- **Expected:** exit 0; `player.spawn_id` is a positive number.
- **Result:** [ ] pass  [ ] fail

### 2. Target id
- **Steps:** target an NPC and read the pipe.
- **Expected:** `target_id` equals what `/tag` sends for that mob (the number in the `ZEALTAG | text | name | id` message). Retarget a different mob: the id changes.
- **Result:** [ ] pass  [ ] fail

### 3. Raid and group members
- **Setup:** in a group, then a raid.
- **Steps:** read the pipe's raid (type 5) and group (type 6) messages.
- **Expected:** each member row carries a `spawn_id`.
- **Result:** [ ] pass  [ ] fail

## Edge cases

### 4. Same name, different mobs
- **Setup:** a zone with several mobs sharing a name (a camp of identical NPCs).
- **Steps:** target each in turn and note `target_id`.
- **Expected:** a different id for each mob; the ids are stable while the mob lives.
- **Result:** [ ] pass  [ ] fail

### 5. No target and no pet: the keys are omitted
- **Steps:** clear your target and dismiss any pet; read the pipe.
- **Expected:** `target_id` and `pet_id` are absent, not 0 and not -1. (The first version sent `pet_id: -1`; the guard is now "greater than zero".)
- **Result:** [ ] pass  [ ] fail

### 6. A pet
- **Steps:** summon a pet (or use a charm pet), read the pipe.
- **Expected:** `pet_id` is a positive id that matches the pet when you target it.
- **Result:** [ ] pass  [ ] fail

## Safety and compatibility

### 7. A consumer that predates the keys
- **Steps:** run an old reader or the agent against a build with the keys.
- **Expected:** nothing breaks; the new keys are additive and optional.
- **Result:** [ ] pass  [ ] fail

### 8. Zoning and relog
- **Steps:** zone, camp and relog with the reader attached.
- **Expected:** it reconnects and the ids update; no crash in the game.
- **Result:** [ ] pass  [ ] fail

### 9. Two clients
- **Steps:** two clients on one machine, one reader per client's pipe.
- **Expected:** each pipe reports its own `player.spawn_id`.
- **Result:** [ ] pass  [ ] fail

## Performance

### 10. Pipe message size and rate
- **Steps:** in a full raid, log the size of one raid message with and without the keys (compare against stock 1.4.5 if available).
- **Expected:** a few bytes per member, no change in how often messages are sent, no framerate change.
- **Result:** [ ] pass  [ ] fail
