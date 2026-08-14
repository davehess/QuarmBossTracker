// utils/chatClockSkew.js — clock skew measured from a line everybody saw.
//
// THE IDEA (Hitya, 2026-08-14): "we could figure it out from any guild or raid
// chat message, some zeal tag, anything everyone or many people see."
//
// A `/gu` line is broadcast by the EQ server to every client at once. Each
// client's log stamps it with that client's own clock. So the difference
// between two clients' stamps for the SAME line is their clock skew, with no
// network in the path and — crucially — **without our server's clock being
// involved at all**.
//
// That makes it independent of `pulse`, which measures client-vs-OUR-BOT. If
// the bot's own clock is wrong (a real risk for a self-hosted tenant running it
// on a home box), pulse corrects the whole fleet toward that wrong clock and
// nothing notices. This estimator would disagree, loudly.
//
// ⚠ We were already generating this measurement and throwing it away. The bot
// receives the same line from every uploader in the zone and drops all but the
// first at the dedup gate — measured 2026-08-14: 1,019 distinct guild/raid
// lines in 12 hours, only 3 of which kept a second uploader's copy. That is
// roughly a thousand free samples a raid night going in the bin, at the one
// moment the bot is holding two independent stamps for one shared event.
//
// ⚠ RESOLUTION IS ONE SECOND. EQ writes `[Wed Aug 13 22:24:01 2026]` — whole
// seconds, no milliseconds. Every delta this module sees is a multiple of
// 1000ms. That is fine against the 5s threshold at which we act on a clock
// (see utils/clockOffset.js) and useless for anything sub-second. Do not build
// a sub-second feature on this.
//
// This module is PURE — the accumulation and the resolve, no I/O. index.js owns
// the capture point and the flush.

// A pair needs this many agreements before it is evidence rather than an
// accident of one line arriving oddly.
const MIN_PAIR_SAMPLES = 3;
// And an install needs this many distinct partners before we will publish an
// offset for it. One partner means we cannot tell which of the two is wrong.
const MIN_PARTNERS = 2;
// Anything past this is not a clock, it is a backfill replaying week-old log
// lines. `--since` uploads carry their ORIGINAL timestamps, so a backfilling
// uploader looks hours or days "behind" for as long as the run lasts.
const MAX_PLAUSIBLE_SKEW_MS = 10 * 60 * 1000;

function median(xs) {
  if (!xs || xs.length === 0) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

// Pairwise observations accumulate here between flushes. Key is the ordered
// pair "lo|hi" so (a,b) and (b,a) land in one bucket; the stored delta is
// always hi-minus-lo so the sign is unambiguous.
function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Record one sighting of a shared line by two different installs.
 *
 * `tsA`/`tsB` are the two clients' own stamps for the same line, in ms.
 * Returns true if the sample was kept.
 */
function addSample(store, a, b, tsA, tsB, cap = 64) {
  if (!store || !a || !b || a === b) return false;
  if (!Number.isFinite(tsA) || !Number.isFinite(tsB)) return false;
  const delta = tsB - tsA;
  if (Math.abs(delta) > MAX_PLAUSIBLE_SKEW_MS) return false;   // backfill, not a clock
  const key = pairKey(a, b);
  // Normalise the sign to the key's own ordering: always hi-minus-lo.
  const signed = a < b ? delta : -delta;
  let arr = store.get(key);
  if (!arr) { arr = []; store.set(key, arr); }
  arr.push(signed);
  // Keep the most recent `cap` — a clock that drifts should be represented by
  // where it is now, not by an average over the whole night.
  if (arr.length > cap) arr.splice(0, arr.length - cap);
  return true;
}

/**
 * Turn accumulated pairwise deltas into a per-install offset.
 *
 * Sign convention matches `agent_clock_offsets`, stated once because a flipped
 * sign here corrupts every correction downstream:
 *   **offset_ms POSITIVE = that client is BEHIND**, so `ts + offset_ms` moves
 *   its stamps forward onto true time.
 *
 * Anchoring: this measures clients against EACH OTHER, so it yields a set of
 * relative positions with no absolute zero. We centre on the FLEET MEDIAN,
 * which is the same assumption the `consensus` estimator already makes ("for a
 * death with 3+ witnesses the median is truth") and which the data supports —
 * 18 of 21 installs sit within ±3s of each other while three are seconds to a
 * minute out. It fails only if MOST of the fleet is wrong together, in which
 * case pulse and min-lag would disagree with this and that disagreement is
 * itself the signal.
 *
 * Returns [{ discord_id, offset_ms, samples, spread_ms, partners }].
 */
function resolveOffsets(store, { minPairSamples = MIN_PAIR_SAMPLES, minPartners = MIN_PARTNERS } = {}) {
  if (!store || store.size === 0) return [];

  // 1. Collapse each pair to its median. The median is what makes one weird
  //    line — a re-typed message, a fuzzy-dedup mismatch — unable to move the
  //    answer.
  const byInstall = new Map();   // id → [{ other, delta (this minus other), n }]
  for (const [key, deltas] of store) {
    if (deltas.length < minPairSamples) continue;
    const [lo, hi] = key.split('|');
    const m = median(deltas);                       // hi minus lo
    if (!byInstall.has(lo)) byInstall.set(lo, []);
    if (!byInstall.has(hi)) byInstall.set(hi, []);
    byInstall.get(lo).push({ other: hi, delta: -m, n: deltas.length });
    byInstall.get(hi).push({ other: lo, delta:  m, n: deltas.length });
  }

  // 2. Each install's position = median of how far ahead it reads vs everyone
  //    it was seen with. Positive `rel` = this clock runs AHEAD.
  const rel = new Map();
  for (const [id, edges] of byInstall) {
    if (edges.length < minPartners) continue;       // one partner cannot say who is wrong
    rel.set(id, {
      rel: median(edges.map(e => e.delta)),
      samples: edges.reduce((a, e) => a + e.n, 0),
      partners: edges.length,
      spread: edges.length > 1
        ? Math.max(...edges.map(e => e.delta)) - Math.min(...edges.map(e => e.delta))
        : 0,
    });
  }
  if (rel.size === 0) return [];

  // 3. Centre on the fleet. Without this every install would carry the fleet's
  //    own arbitrary origin and the numbers would be meaningless as offsets.
  const centre = median([...rel.values()].map(v => v.rel));

  const out = [];
  for (const [id, v] of rel) {
    out.push({
      discord_id: id,
      // rel is "ahead of the fleet"; the table wants "behind true time".
      offset_ms: -(v.rel - centre),
      samples:   v.samples,
      spread_ms: v.spread,
      partners:  v.partners,
    });
  }
  out.sort((a, b) => Math.abs(b.offset_ms) - Math.abs(a.offset_ms));
  return out;
}

module.exports = {
  addSample, resolveOffsets, pairKey, median,
  MIN_PAIR_SAMPLES, MIN_PARTNERS, MAX_PLAUSIBLE_SKEW_MS,
};
