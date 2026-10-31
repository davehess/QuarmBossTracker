# Character passport: moving a character between Quarm-continuation servers through the hub

**Status: idea, recorded 2026-10-31, not designed for build.** The guild lead: *"certainly other guilds are looking to build out
their own Quarm continuation servers. it would be neat to have a hub that would let you bring your characters across from
server to server. at the same time, risky and would need syncing and some format of anti-cheating."* DECISIONS §491.

## 1. What it is
A player's character (level, class, race, AAs, flags and keys, spellbook, inventory, bank, faction) leaves server A as a
signed export and arrives on server B, with the hub as the notary between two operators who do not otherwise trust each
other. It only exists if **both operators want it**: the export is the source server's database rows, signed by the source
operator's key; the import is the destination operator's choice, under their own rules (what era, what items, what cap).
Nothing here can be done by the player alone, and nothing here is something Raid Mimic can build on its own; the operator
seam is the product.

## 2. Why it is risky, in the order operators will object
1. **Duplication.** A character exported once and imported twice, or imported and then re-exported from the copy, is an
   item dupe across economies. The passport has to be a one-way move with a revocation: the source marks the character
   `transferred` and the hub records the hash, and a second import of the same hash is refused everywhere.
2. **Doctored dumps.** A player who edits the export before import is the whole anti-cheat problem. A source signature
   stops editing after export; it does not stop a source operator who is generous with their own database, which is why
   the destination's rules (3) and the independent record (4) exist.
3. **Era mismatch.** A PoP character landing on a Classic-era server carries items that do not exist there. The destination
   publishes an allow-list (item ids, max level, AA caps) and the import clips to it; what was clipped is listed to the player
   before they accept.
4. **Identity.** The same Discord account must own the character on both sides (the hub's `players` row, §7g), or an
   operator-approved exception. Names collide; the destination's rename rules apply.

## 3. The independent record is the anti-cheat
Raid Mimic already keeps what a doctored dump cannot fake after the fact: **inventory snapshots** (`character_inventory`,
replaced per upload, now stamped per arrival), **gear and worn sets** (`character_gear`, `character_worn_sets`: which sets a
character was *seen* wearing, how often, by its own uploads), **levels and guilds seen by other people** (`who_observations`,
197 observers, 13,986 names), **parses** (what the character did in fights, seen by other raiders' agents), **flags and keys**
(`pop_flags`, `character_keys`, `character_lockouts`). A transfer verifier diffs the export against that record: an item in
the dump that no snapshot ever held, a level above anything anyone saw, an AA count that never appeared in a Quarmy export,
a flag with no recorded hail. Each miss is a flag for the destination operator, not a refusal; a character with no record at
all (never uploaded) is simply "unverified", and the destination decides whether unverified characters may come in. This is
the same posture as §7e: the client is untrusted, cross-observation is the evidence, operators decide.

## 4. The format
EQEmu's own tables are the format (`character_data`, `character_inventory`, `character_alternate_abilities`,
`character_spells`, `character_skills`, `character_keyring`, the flag and faction tables), exported as JSON by an operator
tool, with a manifest: source server id, export time, character hash, era, the operator's signature. The TAKP (Quarm) and
RoF client inventory layouts differ (the 2026-10-30 comparison of the two inventory files: slot numbering and bag
addressing), so the manifest names the client line and the importer maps slots. The hub stores the manifest and hash, never
the dump; the dump moves operator to operator.

## 5. What exists, what does not
Exists: the observational record above; Discord identity; the server key proposed in §7c (nothing today records which server
a character is on; that column is step one for any of this). Does not exist: a server registry with operator keys; an
operator-side export/import tool (an EQEmu quest-API or a DB script the operator runs); the verifier; the one-way ledger.
Costs: build high (two operator tools, a verifier, a registry), maintenance medium (per-server rule sets), runtime low,
change high (every server differs). The first step that is useful on its own: the `server` column and the verifier's
read-only report ("what our record says this character is"), which operators could ask for even without a transfer tool.
