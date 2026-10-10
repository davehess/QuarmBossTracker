# Runbook — repair the wrong PQDI item links already stored in `chat_messages`

**Status: staged, NOT applied.** It rewrites member chat rows in production, so it waits for the guild lead's yes.

## Why the stored rows need it

An EverQuest item link is `\x12` + the item id as 7 zero-padded DECIMAL digits + the name + `\x12`. Until agent
3.7.127 / bot 3.1.241 both decoders skipped the first digit and read the next five as HEX
(`0011057Ragebringer` → `0x1105` = 4357). The link is written into the chat text **at ingest** (the agent's
`transformEqItemLinks`, then the bot's `linkifyEqItems`) and stored as written. `/admin/chat` renders the stored
`<https://…>` verbatim, and `web/lib/item-link.ts` only links plain names from `eqemu_items`, so nothing re-derives
the id at read time. The code fix stops new bad links; it does not touch the old ones.

Discord messages the relay already posted keep their wrong links. They are not repaired.

## What the repair can and cannot recover

The sixth digit is lost: a wrong id W comes from 10 possible real ids (`hex(W)` padded to 5, read as decimal, ×10 + 0..9).
The real one was picked by the item name around the link, row by row (2026-10-10, measured read-only):

| Links | What happens |
|---|---|
| 62 rows, one link each | all the stored item links there are |
| 57 | resolved to one item by name; rewritten by the SQL below |
| 1 (`chat_messages.id` 1233358) | "Storm Giant Head": 28781 or 28782, same name, the text cannot choose. Left alone |
| 4 (ids 350558, 478931, 581362, 717423) | URLs typed by a member, not the agent's `<…>` shape. Left alone (the `>` in the match excludes them) |

Keying on W alone is wrong: W 1408, 1333, 6513, 10376, 5672 and 10034 each map to two different real items in
different rows. The mapping is per (row, W).

## The SQL

Safe to re-run: a second run matches nothing, because the old W is gone.

```sql
with m(chat_id,w,r) as (values
(36036,10096,27707),(36200,1641,6692),(43399,1408,5803),(43605,354,1625),(48436,5237,14759),(48532,5174,14369),(269651,4357,11057),(314051,1333,5358),(314537,1394,5725),(605925,9363,24930),
(607622,1350,5461),(607729,8337,20911),(750014,6513,19719),(825481,10385,28915),(825741,12610,31420),(832698,1921,7810),(876600,1890,7628),(878597,6483,19531),(902227,4433,11512),(904447,4119,10177),
(904931,4448,11604),(904944,10034,27325),(914718,10034,27320),(918855,6450,19326),(934964,2454,9963),(935705,10390,28968),(935857,1602,6427),(936598,10565,29452),(940691,5235,14732),(945321,1298,5127),
(946069,10376,28889),(948259,5120,14007),(1049743,372,1746),(1050242,1169,4910),(1055659,10260,28147),(1127454,9512,25289),(1129755,277,1158),(1130387,12374,30569),(1131580,1333,5350),(1133504,10389,28951),
(1133988,8833,22813),(1134473,5234,14727),(1134609,1665,6817),(1135441,326,1465),(1136359,6513,19717),(1137858,772,3040),(1140188,10376,28884),(1229566,1108,4544),(1230202,9731,26036),(1235061,10513,29112),
(1235908,10084,27641),(1236872,10325,28551),(1239198,1408,5807),(1239217,5672,16282),(1240764,5672,16283),(1244754,10359,28779),(1248508,8835,22838))
update chat_messages c
   set text = replace(c.text, 'pqdi.cc/item/'||m.w||'>', 'pqdi.cc/item/'||m.r||'>')
  from m
 where c.id = m.chat_id
   and c.text like '%pqdi.cc/item/'||m.w||'>%';
-- expected: UPDATE 57
```

## Something else the rows show (not fixed here)

The item names around the stored links are often broken: a space inside the name (`A Sandw ich`, `F lower`), the link
dropped in the middle of a name (`Greenmi <link> st`), only the LAST of several linked items getting a link, and a stray
`Q` after many links. The old three-`\x12` pattern never matched a real link, so every link went through the
"delimiters already stripped" fallback and its casing guess; the new pattern matches the real shape and takes the name
whole. Whether the spaces and the `Q` come from the log itself cannot be told from the cloud: the first links through
agent 3.7.127 will show it. If they persist, a raw log line with an item link is what to ask a local session for.
