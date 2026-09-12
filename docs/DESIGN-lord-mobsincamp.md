# DESIGN — Lord Mobsincamp: a local assistant as the members' search

*Written 2026-09-12 from Hitya's ask: "could we hook up a local LLM agent that
would be exposed to our members as the search element and run off of the larger
local database copy? if we experience issues to our supabase hosted database
could we fail back to the copy on tower and offload? I'd like to name it Lord
Mobsincamp and have that be a configurable name in the setup."*

**Status: design + assessment. Nothing built. Two calls needed (§9).**
The name is decided: **Lord Mobsincamp**, configurable per deployment
(`ASSISTANT_NAME`, §8). Sits on top of `TOWER-coolify-and-supabase-backups.md`
(what Tower has), `DESIGN-sentinel.md` §3b (the replica tier idea) and the P40
assessment of 2026-09-07 (`DECISIONS-2026-09-07.md`).

---

## 1. What it is

A member types a question into the site's search box instead of a name, and
Lord Mobsincamp answers from the guild's own data, with links. The model runs on
Tower; the data it reads is Tower's archive, which keeps everything production
prunes. No member data leaves the guild's own hardware to be answered.

The existing search stays: a name still gets the dropdown of characters, items,
mobs and spells (`web/app/api/search/route.ts`). A sentence goes to the
assistant. Same box, two behaviours, one gate (members only).

What it can answer that nothing on the site can today, because the questions
cross tables and time: *"when did we last kill Emperor Ssraeshza and who
tanked?"*, *"who has landed the most slows on Kaas Thox this month?"*, *"which
of my characters is missing Fungal Regrowth?"*, *"what does Turgur's Insects do
and who can cast it?"*, *"how many raid nights did Lucker make in August?"*.

## 2. Shape

```
 member ──▶ wolfpack.quest (Vercel) ──▶ broker ──▶ Tower
             search box: "Ask Lord Mobsincamp…"          ┌────────────────────────────┐
             answer card with links + 👍/👎              │ model server (P40)         │
                                                          │   OpenAI-compatible API    │
                                                          │ tool service (Node)        │
                                                          │   read-only, allowlisted   │
                                                          │ archive Postgres           │
                                                          │   nightly merge (today)    │
                                                          │   live replica (§5)        │
                                                          └────────────────────────────┘
```

Three parts on Tower, one on the site:

**a. Model serving.** Ollama or llama.cpp on the P40, exposed only on the LAN as
an OpenAI-compatible endpoint. Candidates that fit 24 GB and call tools well:
Qwen2.5-14B-Instruct (Q4/Q5) — the strongest tool-caller in this size, ~12–18
tok/s on a P40; Llama-3.1-8B-Instruct (Q8) — faster (~25 tok/s), weaker at
multi-step tools. A 32B at Q4 fits but runs at 5–7 tok/s, too slow for a search
box. Start with the 14B.

**b. The tool service.** A small Node service (same stack as the bot) that owns
the conversation: it gives the model a FIXED list of read-only tools and runs
them against the archive. The model never writes SQL. Tools are the questions
we already know members ask, each one a parameterised query or an existing
view/RPC:

| Tool | Backed by |
|---|---|
| `find(entity, text)` | the same tiered lookup `/api/search` does |
| `encounters(mob, since, until)` | `encounters` + `encounter_players` |
| `character(name)` | `characters`, `character_data_floor`, live-state (fresh only) |
| `spell(name)` / `item(name)` / `mob(name)` | the `eqemu_*` catalog |
| `debuffs_landed(mob, spell_family, since)` | `buff_casts` archive (the table production prunes at 7 days — this is where Tower earns its keep) |
| `attendance(name, month)` | raid ticks / `raid_nights` |
| `last_seen(name)` | `who_observations` archive |

Every tool applies the same rules the site applies: `exclude_from_stats`,
`exclude_inventory`, the PRIVATE / ANON / GUILD stat scopes, and it never reads
`tells`, officer chat or anything the site does not show a member. Answers carry
the page links the tools resolved to, so a member can check the source.

**c. Exposure — how the site reaches Tower.** Tower accepts nothing inbound today
(the Coolify auto-deploy polls GitHub for that reason). Two ways to keep it so:

| | Broker through the bot | Outbound tunnel |
|---|---|---|
| How | The site writes the question to a `assistant_requests` row (hosted Supabase); a worker on Tower long-polls the bot for open requests, answers, writes the answer back; the site reads it | Cloudflare Tunnel (or equivalent) from Tower, publishing ONE hostname for the tool service, protected by a service token only the Vercel server side holds |
| Inbound to Tower | none | none (tunnel is outbound), but a public hostname exists |
| Latency added | 1–3 s (poll cadence) on top of model time | ~none |
| Build / maint / runtime / change | med / low / low / low | low / low / low / med (tunnel account + token rotation is a dependency) |
| Fits the existing posture | yes — same as Coolify polling and the agent's own poll loops | new surface; token in Vercel env |

Recommendation: **the broker.** It costs a second or two per question, and it
keeps Tower exactly as unexposed as it is now. The tunnel is the upgrade if the
latency annoys.

**d. The site.** The header box gets an "Ask" affordance: a sentence (or a `?`)
routes to the assistant, a name routes to the dropdown as today. The answer is a
card under the box: the reply, its links, a 👍/👎 that lands in the `feedback`
table with the question attached. The assistant's name comes from
`ASSISTANT_NAME` everywhere it appears (placeholder, card header, a later
`/ask` Discord command).

## 3. What the model is NOT allowed to do

- No free-form SQL, ever. Tools only. This is the whole privacy and
  prompt-injection story: a member cannot talk the model into reading a table
  the tool list does not expose, because the model has no way to name one.
- No writes. Read-only role on the archive.
- No member data in prompts beyond what the tools return for THIS question; no
  conversation memory across members.
- Every question and answer is logged (member, question, tools called, answer)
  — for tuning, and because an assistant that can be asked about members is
  an officer-auditable surface. Same visibility as `/admin/feedback`.

## 4. Where the data comes from, and how fresh it is

Today Tower's archive is **the 05:00 dump merged at 05:30** — everything, kept
forever, up to a day stale. For history questions that is ideal (it is the
only copy with `buff_casts` older than a week). For *"what did we kill
tonight"* it is wrong by a day.

Two honest options:

1. **Nightly archive + a live overlay.** Tools that ask about *today* hit the
   hosted project (small, indexed reads); everything else hits Tower. Two
   connections in the tool service, one flag per tool. Cheap; slightly fussy.
2. **A live logical replica on Tower** (`RUNBOOK-unraid-supabase-replica.md`
   Phase 2 path). `wal_level = logical` is already on and 0 slots are used;
   the blocker is that replication needs a direct connection, which is IPv6 on
   Supabase, and the home network has no outbound IPv6 — so the **IPv4 add-on**
   (a few dollars a month; confirm on the pricing page) is the prerequisite.
   With it, Tower lags production by seconds, the assistant is always fresh,
   and §6 becomes real. Replication traffic is the write volume (small: writes
   are cheap, reads are what bills), well under the 33 GB/month the nightly
   dump already costs.

Recommendation: **option 2**, because it also unlocks the failover below and it
retires the daily 1.1 GB dump as the sync mechanism (the dump stays as the
backup). Option 1 is the fallback if the add-on is declined.

## 5. Offload — the part that pays for itself

Hosted Supabase bills on egress and storage, never on request counts
(`CLAUDE.md` › Supabase). Reads are the metered thing. So every heavy READ that
moves to Tower is money and headroom back:

- the assistant's retrieval (by construction);
- the sentinel's analytical battery (`DESIGN-sentinel.md` §3b — designed for
  exactly this tier, not built);
- long-horizon pages (`/leaderboards` over months, attendance across an
  expansion) that today either prune or paginate against production.

None of that needs the assistant; it needs the replica. The assistant is the
first consumer that makes the replica worth standing up.

## 6. Failover — what is honest to promise

If the hosted project has issues:

- **Reads can fail over, with a banner.** With a live replica the site's
  server-side reads can switch to Tower (through the same broker/tunnel) and
  show *"showing Tower's copy, N seconds behind"*. With only the nightly
  archive, the banner says *"as of last night"*. Either is better than a blank
  page. Implementation: a second base URL for `supabaseAdmin()` reads plus the
  bot's existing circuit breaker (`SUPABASE_BREAKER_*`) deciding when to flip.
- **Writes do not fail over, and should not.** Agents already hold uploads in a
  durable queue with backoff to 10 minutes; the bot returns 5xx and they retry.
  An outage of hours is absorbed with no data loss. Writing to Tower during an
  outage and merging back is split-brain; the merge is one-directional on
  purpose. Keep it that way.
- **Auth is the hard wall.** Sign-in is Supabase Auth on the hosted project. If
  it is down, nobody NEW can sign in; existing sessions keep working only if
  the site verifies the JWT locally (`SUPABASE_JWT_SECRET` in Vercel env) instead
  of asking the auth server. That is a real change to `middleware.ts` /
  `lib/session.ts` and the first thing to build if failover matters, because
  without it a failover of reads serves nobody.
- **Not a Vercel or Railway failover.** Tower cannot take the site or the bot
  for the guild (no public DNS, no TLS — `TOWER-…` §4). This design is about
  the DATABASE layer only.

## 7. Hardware reality

The 2026-09-07 assessment stands: if the P40 goes anywhere it is Tower, and
Tower has no free x16 slot (a card would have to move out). Things to know
before buying anything else:

- **P40 = Pascal, 24 GB GDDR5, 250 W, passively cooled.** It needs a server-style
  airflow duct or a shroud + fan in a tower case; it will throttle or die
  without one. BIOS needs "Above 4G decoding" on. Drivers: Pascal is on
  NVIDIA's legacy branch now — check the Unraid Nvidia plugin offers a branch
  that still lists it before the card is in the slot.
- **No tensor cores, weak fp16.** Run integer-quantised models (Q4/Q5/Q8 in
  llama.cpp/Ollama). It is fine for an 8–14B assistant at conversational speed;
  it is not a training or fine-tuning card.
- **Idle cost is real:** ~50 W idle, 250 W under load, on all the time. Order
  of $5–10/month of electricity depending on rates — comparable to the
  hosted-model bridge in §8, which is the honest comparison.

## 8. Phases, costs, and the no-GPU bridge

| Phase | What | Build | Maint | Runtime | Change |
|---|---|---|---|---|---|
| 0 — prove the layer | Tool service + site UI + broker, model = **hosted API via the bot** (cents per question, no hardware). Everything in §2b–d gets built and used; only the model is remote | med | low | ~cents/question | low |
| 1 — the card | P40 in Tower, Ollama serving the 14B, tool service pointed at it. Nothing above it changes | med (mostly physical) | med (drivers, model updates) | electricity | low |
| 2 — the replica | IPv4 add-on + logical replication; assistant reads live | med | low | add-on + small egress | low |
| 3 — read failover | JWT verified locally; `supabaseAdmin()` read fallback + banner | med | low | none | med |

Phase 0 is the honest accelerator: it makes Lord Mobsincamp real for members in
days, with every privacy rule in place, while the card is sourced and seated.
Whether member questions may be answered by a hosted model at all is Hitya's
call (§9) — the tool layer guarantees the model only ever sees what the tools
return, which is data the site already shows that member.

**Config (all phases):**
- `ASSISTANT_NAME` — default `Lord Mobsincamp`; web + bot env; the wizard asks
  for it ("What is your guild's assistant called?").
- `ASSISTANT_MODE` — `off` | `hosted` | `local`.
- `ASSISTANT_MODEL_URL` — the OpenAI-compatible endpoint (Tower LAN address in
  local mode; never committed).
- Broker: `assistant_requests` table (hosted), worker on Tower with the bot
  token it already has.

## 9. Calls needed

1. **Exposure:** broker through the bot (recommended, keeps Tower unexposed) or
   an outbound tunnel with a service token.
2. **The replica:** approve the Supabase IPv4 add-on so logical replication can
   run; without it the assistant reads a day-old archive plus a live overlay.
3. **Phase 0 bridge:** may member questions go to a hosted model until the P40
   is in? Yes → Lord Mobsincamp ships before the card. No → it waits for Phase 1.
4. **The card:** which card moves out of Tower to free the x16, and the duct.

Once 1–3 are answered this becomes a build plan with the tool list in §2b as
the first milestone.
