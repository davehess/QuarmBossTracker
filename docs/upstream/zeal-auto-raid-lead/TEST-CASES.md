# Test cases: `/autoraidlead` and a persistent `/autoraidinvite`

For the local draft branch `raidlead-draft` (`b15b8a2`). **Not compiled with MSVC, not pushed, not run in game.** The
handoff packet was built from the server source and must be proven in a two-person raid before anyone relies on it. Use
a throwaway raid and a throwaway password such as `owl7` (the password is stored in plain text in `zeal.ini`).

**Characters:** L is the raid leader (the one under test), M is a raid member, O is outside the raid. Cases that use two
clients say so. Run the first block with M present.

Mark each case: `[x]` pass, `[!]` fail (write what you saw under it).

## `/autoraidinvite` (persisted)

### 1. It survives a restart
- **Steps:** L: `/ari owl7`. Check `zeal.ini` under `[Zeal_<Character>]` for `AutoRaidInvite`. Camp, restart the client, log in, `/ari`.
- **Expected:** the status line says enabled, showing only the first character of the password (`o***`). The pipe sent `ARI set owl7` (check with a pipe reader or Mimic).
- **Result:** [ ] pass  [ ] fail

### 2. Invite by password
- **Steps:** O (not in the raid) tells L `owl7`.
- **Expected:** L invites O to the raid. Note whether the tell, with the password in it, stays visible in L's chat window and `eqlog` (the invite flow was never designed to hide it).
- **Result:** [ ] pass  [ ] fail

### 3. Special characters in the password
- **Steps:** `/ari a.b(c[`, then O tells `a.b(c[`, then O tells `axb(c[`.
- **Expected:** only the exact text matches. The old build treated the password as a pattern and could match the wrong text or throw.
- **Result:** [ ] pass  [ ] fail

### 4. Whole message, case-sensitive
- **Steps:** with `owl7` set, O tells `owl7 please`, `OWL7`, and `owl7`.
- **Expected:** only the last one invites.
- **Result:** [ ] pass  [ ] fail

### 5. Clear
- **Steps:** `/ari clear`, then `/ari off` after setting it again, then `/ari`.
- **Expected:** both disable it, `/ari` says disabled, `zeal.ini` no longer holds a password, and the pipe sends `ARI clear`. `clear` and `off` cannot be used as passwords. A password over 64 characters is refused.
- **Result:** [ ] pass  [ ] fail

## `/autoraidlead`: the handoff

### 6. Set it up
- **Steps:** L (raid leader): `/arl owl7`, then `/arl`.
- **Expected:** "enabled (password o***)", and "You are the raid leader". The pipe sends `ARL on` and never the password.
- **Result:** [ ] pass  [ ] fail

### 7. Happy path
- **Steps:** M (in L's raid) tells L `owl7`.
- **Expected:** L prints "ARL: handing raid lead to M." and M becomes raid leader (raid window, and the pipe's raid message shows rank "Raid Leader" on M). **This is the proof the packet is right: if nothing happens, the packet layout is wrong.**
- **Result:** [ ] pass  [ ] fail

### 8. Manual give
- **Steps:** with L leader again, `/arl give M`, then `/arl give Nobody`, then `/arl give L` (yourself).
- **Expected:** M gets raid lead; "Nobody is not another member of your raid"; yourself is refused. Not being leader prints "You are not the raid leader."
- **Result:** [ ] pass  [ ] fail

### 9. The prompt, without the password
- **Steps:** with L leader and a password set, M tells L `raidlead`.
- **Expected:** L sees "M asks for raid lead - /arl give M to hand it over". Nothing changes until L runs `/arl give M`.
- **Result:** [ ] pass  [ ] fail

## Safety (every one must be silent and safe)

### 10. Receiver is not the raid leader
- **Steps:** with M as leader and L not, a third raider tells L `owl7`.
- **Expected:** L sees "ARL: not raid leader, ignored". No packet is sent, no crash.
- **Result:** [ ] pass  [ ] fail

### 11. Sender is not in the raid
- **Steps:** O (outside) tells L `owl7`.
- **Expected:** "ARL: O is not in this raid, ignored". Nothing sent.
- **Result:** [ ] pass  [ ] fail

### 12. Not in a raid at all
- **Steps:** L alone, in a group or solo, `/arl owl7`, then someone tells `owl7`.
- **Expected:** ignored with a local line, no crash. `/arl give M` says you are not the raid leader.
- **Result:** [ ] pass  [ ] fail

### 13. Rate limit
- **Steps:** M tells `owl7`, and within 10 seconds a second raider tells `owl7`.
- **Expected:** the second gets "ARL: rate limited, ignored". After 10 seconds it works again.
- **Result:** [ ] pass  [ ] fail

### 14. Wrong password
- **Steps:** M tells L `owl8`.
- **Expected:** nothing happens and nothing is printed that reveals the password.
- **Result:** [ ] pass  [ ] fail

### 15. Old or no Zeal on either side
- **Steps:** (a) M on stock Zeal or no Zeal sends the password tell. (b) M, the receiver, has stock Zeal while L runs the draft and L gives raid lead to someone who has no Zeal.
- **Expected:** (a) works, because the sender only sends a tell. (b) works, because the server does the handoff. No client errors or crashes either way. A stock client that receives the password tell just sees an ordinary tell.
- **Result:** [ ] pass  [ ] fail

### 16. Zoning, linkdead, camping
- **Steps:** L zones, goes linkdead (pull the network briefly), camps and logs back in; M tells the password at each stage.
- **Expected:** while L is not in game nothing happens (a linkdead leader runs nothing: that is why the server's own handoff to the first raid member exists). After login the password is still set. No crash.
- **Result:** [ ] pass  [ ] fail

### 17. Two clients on one machine
- **Steps:** L and M both on this build, each with their own password.
- **Expected:** each stores its own settings in its own `[Zeal_<Character>]` section; neither reads the other's password.
- **Result:** [ ] pass  [ ] fail

### 18. The password does not leak
- **Steps:** after cases 6 and 7, search `eqlog`, the Zeal log and the pipe output for `owl7`.
- **Expected:** the ARL password appears in no chat line of the draft and never on the pipe. Note anything found: the raw tell may still be in the game's own log file, which is not Zeal's to change.
- **Result:** [ ] pass  [ ] fail

### 19. Quarm's rules
- **Steps:** no test: record the maintainers' or Quarm team's written view on whether acting on a tell counts as automation.
- **Expected:** a written answer, or a decision to keep only `/arl give` and the prompt.
- **Result:** [ ] answered  [ ] pending

## Performance

### 20. Chat cost
- **Steps:** with both passwords set, stand in a busy tell and chat channel for five minutes, framerate counter on.
- **Expected:** no framerate change; the tell parser is plain string handling, and every ignored line is cheap.
- **Result:** [ ] pass  [ ] fail
