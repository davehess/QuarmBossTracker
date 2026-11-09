// weave.js — the Weave timer's engine. It runs in Mimic's MAIN process, fed straight from the Zeal pipe, and
// the renderers (weaveDraw.js) re-derive the windows from the numbers it sends. Mimic only DISPLAYS timing:
// nothing here presses a key or automates anything.
//
// The guild lead, 2026-11-07: a monk weaves with a social macro — kick, then /bandolier load a 2H blunt, then
// /bandolier load the other 2H — and wanted to see when to press it. "it needs to be local so that it's as close
// to real time as possible": Zeal writes every chat line to the named pipe the instant the game prints it
// (NamedPipe::chat_msg, type 0, data {"type": <colour>, "text": "..."}), where the log file gives one-second
// stamps. So this module timestamps each line at ARRIVAL.
//
// THE MECHANIC (the server's own code, SecretsOTheP/EQMacEmu c2cd265 — not a guide):
//  • zone/attack.cpp:4686 Client::SetAttackTimer — the primary (attack_timer) runs on the primary weapon's delay,
//    or GetHandToHandDelay() for a monk with empty hands; the secondary (attack_dw_timer) is DISABLED unless
//    dual wielding (a 2H = no dual wield; empty hands = a monk dual-wields fists). speed = delay / haste.
//  • common/timer.cpp:156 Timer::SetDuration(d, true), reached from a weapon swap during auto-attack
//    (zone/inventory.cpp:1517): the CURRENT interval's start is kept and only its length changes, so the next
//    trigger is interval_start + new_duration.
//  Consequence: swap the 2H out EARLY in its interval and the idle secondary fist timer (already past due) fires
//  a fist round right away, while the primary's trigger becomes last2H + fistDelay. Swap back BEFORE that and the
//  2H fires at last2H + 2Hinterval as if nothing happened — a free weave. Swap out AFTER last2H + fistDelay and
//  the primary fires as fists (a CLIP: the 2H interval restarts from there and time is lost). After a fist round
//  the secondary is ready again at lastFist + fistDelay.
//  • zone/attack.cpp:3160 Client::GetHandToHandDelay — the tables below (copied, not re-derived).
//
// So the window for the next press is [max(last2H, lastFist + fistInterval), last2H + fistInterval − margin]
// (margin: the swap's round trip, default 150 ms), and the swap back must be done by last2H + 2Hinterval.
//
// The same file loads in a renderer as window.WpWeave (for derive/zones, the pure parts) and in main as a module.
(function (root) {
  'use strict';

  // ── attack.cpp:3160, indexed by level (entry 0 unused) ──────────────────────────────────────────────────────
  var MNK_HUM = [99,
    35, 35, 35, 35, 35, 35, 35, 35, 35, 35, 35, 35, 35, 35, 35, 35, 35, 35, 35, 35,          // 1-20
    35, 35, 35, 35, 35, 35, 35, 34, 34, 34, 34, 33, 33, 33, 33, 32, 32, 32, 32, 31,          // 21-40
    31, 31, 31, 30, 30, 30, 30, 29, 29, 29, 29, 28, 28, 28, 28, 27, 27, 27, 27, 26,          // 41-60
    24, 22];                                                                                   // 61-62
  var MNK_IKS = [99,
    35, 35, 35, 35, 35, 35, 35, 35, 35, 35, 35, 35, 35, 35, 35, 35, 35, 35, 35, 35,          // 1-20
    35, 35, 35, 35, 35, 35, 35, 35, 35, 34, 34, 34, 34, 34, 34, 33, 33, 33, 33, 33,          // 21-40
    33, 32, 32, 32, 32, 32, 32, 31, 31, 31, 31, 31, 31, 30, 30, 30, 30, 30, 30, 29,          // 41-60
    25, 23];                                                                                   // 61-62
  var BST = [99,
    35, 35, 35, 35, 35, 35, 35, 35, 35, 35, 35, 35, 35, 35, 35, 35, 35, 35, 35, 35,          // 1-20
    35, 35, 35, 35, 35, 35, 35, 35, 34, 34, 34, 34, 34, 33, 33, 33, 33, 33, 32, 32,          // 21-40
    32, 32, 32, 31, 31, 31, 31, 31, 30, 30, 30, 30, 30, 29, 29, 29, 29, 29, 28, 28,          // 41-60
    28, 28, 28];                                                                               // 61-63
  var EPIC_DELAY = 16;   // Celestial Fists (item 10652) equipped, level > 50

  // The hand-to-hand delay in 1/10 s units (30 = 3.0 s), as the server computes it.
  function handToHandDelay(o) {
    o = o || {};
    var cls = String(o.cls || 'monk').toLowerCase(), level = Math.max(1, Math.floor(Number(o.level) || 60));
    var iksar = String(o.race || '').toLowerCase() === 'iksar';
    if (cls === 'monk') {
      if (o.epic && level > 50) return EPIC_DELAY;
      if (level > 62) return iksar ? 21 : 20;
      return (iksar ? MNK_IKS : MNK_HUM)[level];
    }
    if (cls === 'beastlord') return level > 63 ? 27 : BST[level];
    return 35;
  }

  var DEFAULT_CFG = {
    twoHDelay: 30,
    // The 2H verb follows the weapon type (crush blunt, slash 2HS, pierce 2HP); the monk fist verb is not
    // confirmed, so all three plausible ones are listed and BOTH lists stay configurable.
    twoVerbs: ['crush', 'crushes'],
    fistVerbs: ['punch', 'punches', 'hit', 'hits', 'strike', 'strikes'],
    // The swap's round trip, press to 2H back in hand: 400 ms, as Basketweaver measured it (2026-11-09; was 150, too short).
    marginMs: 400, showTally: true,
    cls: 'monk', level: 60, race: 'human', epic: false,
    // The offhand the weave set puts in the secondary slot: 0 = bare fists (the level / race table, or the epic); a weapon
    // uses its own delay (EQMacEmu Client::SetAttackTimer). The guild lead, 2026-11-09, trying Ribcracker (secondary only,
    // 1H blunt, delay 25) after Primal Velium Fist Wraps (delay 20).
    offDelay: 0,
    // Sounds for a press's outcome (2026-11-09: "lets add some sounds into ours"): names from Mimic's sound library, '' = none.
    sndLanded: 'weave-punch', sndBig: 'weave-smash', sndClip: 'weave-thud', sndVol: 0.8, bigHit: 200,
  };
  function verbList(v, dflt) {
    var a = Array.isArray(v) ? v : (typeof v === 'string' ? v.split(/[\s,]+/) : null);
    if (!a) return dflt.slice();
    var out = [];
    a.forEach(function (x) { x = String(x || '').toLowerCase().trim(); if (/^[a-z]{2,16}$/.test(x) && out.indexOf(x) < 0) out.push(x); });
    return out.length ? out.slice(0, 12) : dflt.slice();
  }
  function intIn(v, lo, hi, d) { v = Math.round(Number(v)); return (isFinite(v) && v >= lo && v <= hi) ? v : d; }
  // A config from a renderer, every field clamped; anything else falls back to the default.
  // A sound name from the library ('' or 'off' = none); anything else falls back to the default.
  function sndName(v, d) { if (v === undefined || v === null) return d; v = String(v).toLowerCase(); if (v === '' || v === 'off') return ''; return /^[a-z0-9-]{1,32}$/.test(v) ? v : d; }
  function cleanCfg(c) {
    c = c || {};
    var out = {
      twoHDelay: intIn(c.twoHDelay, 10, 60, DEFAULT_CFG.twoHDelay),
      twoVerbs: verbList(c.twoVerbs, DEFAULT_CFG.twoVerbs),
      fistVerbs: verbList(c.fistVerbs, DEFAULT_CFG.fistVerbs),
      marginMs: intIn(c.marginMs, 0, 1000, DEFAULT_CFG.marginMs),
      showTally: c.showTally === undefined ? true : !!c.showTally,
      cls: String(c.cls || '').toLowerCase() === 'beastlord' ? 'beastlord' : 'monk',
      level: intIn(c.level, 1, 65, DEFAULT_CFG.level),
      race: String(c.race || '').toLowerCase() === 'iksar' ? 'iksar' : 'human',
      epic: !!c.epic,
      offDelay: intIn(c.offDelay, 0, 60, 0),
      sndLanded: sndName(c.sndLanded, DEFAULT_CFG.sndLanded), sndBig: sndName(c.sndBig, DEFAULT_CFG.sndBig),
      sndClip: sndName(c.sndClip, DEFAULT_CFG.sndClip),
      sndVol: (function (v) { v = Number(v); return isFinite(v) && v >= 0 && v <= 1 ? v : DEFAULT_CFG.sndVol; })(c.sndVol),
      bigHit: intIn(c.bigHit, 1, 5000, DEFAULT_CFG.bigHit),
    };
    out.fistVerbs = out.fistVerbs.filter(function (v) { return out.twoVerbs.indexOf(v) < 0; });   // a verb is one or the other
    if (!out.fistVerbs.length) out.fistVerbs = DEFAULT_CFG.fistVerbs.filter(function (v) { return out.twoVerbs.indexOf(v) < 0; });
    return out;
  }

  // ── Lines ───────────────────────────────────────────────────────────────────────────────────────────────────
  var HIT_RE = /^You (\w+) (.+?) for (\d+) points? of damage\./i;           // colour 265 (USERCOLOR_YOU_HIT_OTHER)
  var MISS_RE = /^You try to (\w+) (.+?), but /i;                           // colour 267 (USERCOLOR_YOU_MISS_OTHER); dodge, parry, block, riposte too
  var BAND_RE = /^Loading bandolier set \[(.+?)\]/i;                        // Zeal's own channel (the agent maps 1010/1011); text is distinctive enough to match on any colour
  // Zeal's chat timestamps ("/timestamp": [HH:MM:SS], [HH:MM], [hh:mm:ss AM]) can ride in front of a pipe line (the guild lead's
  // chat, 2026-11-09: "[11:53:53] crush a potameid wildling for 256"), so every check below runs on the line without it.
  var STAMP_RE = /^\[\d{1,2}:\d{2}(?::\d{2})?(?: ?[AP]M)?\]\s*/i;
  function unstamp(text) { return String(text == null ? '' : text).replace(STAMP_RE, ''); }
  function bare(text) { return unstamp(text).replace(/^\[[^\]]*\]\s*/, '').trim(); }
  // The SHORT form the same chat shows for your own melee: "crush a potameid wildling for 256" — no "You", no "points of
  // damage". Lowercase first word only (another player's line starts with their name), and only a word the 2H or fist
  // lists know counts as a swing (classify); "miss" alone names no weapon and is skipped.
  // Ends at the number: a full line ("… for N points of damage.") is never read this way, and a first word that is an article
  // ("a gnoll crushes YOU …") is a mob, not your verb.
  var SHORT_HIT_RE = /^(?!(?:a|an|the|your)\b)([a-z]+) (.+?) for (\d+)\.?$/;
  // YOUR melee swing, or null. Only a line that starts "You " (or the short form above) counts: another player's hits
  // arrive on other colours, but this guards anyway.
  var BARE_MISS_RE = /^miss(?:es)?!?\.?$/i;
  function parseSwing(text) {
    var t = bare(text), m = HIT_RE.exec(t), miss = false;
    if (!m && BARE_MISS_RE.test(t)) return { verb: null, target: '', miss: true, bareMiss: true, dmg: 0 };
    if (!m) { m = MISS_RE.exec(t); miss = !!m; }
    var short = false;
    if (!m) { m = SHORT_HIT_RE.exec(t); short = !!m; }
    if (!m) return null;
    var out = { verb: m[1].toLowerCase(), target: m[2], miss: miss, dmg: miss ? 0 : (parseInt(m[3], 10) || 0) };
    if (short) out.short = true;
    return out;
  }
  // Cheap gate for the hub's hot path: could this line be one of your swings?
  function maybeSwing(text) {
    var t = unstamp(text);
    return t.slice(0, 4) === 'You ' || /^[a-z]+ .+ for \d+/.test(t) || BARE_MISS_RE.test(t.trim());
  }
  function parseLoad(text) { var m = BAND_RE.exec(bare(text)); return m ? m[1] : null; }
  // Zeal's bandolier failures (Zeal/bandolier.cpp at CoastalRedwood/Zeal 094afa55): printed on CHANNEL_BANDOLIER_FAILURE (1012),
  // and matched on the words too for a Zeal that prints them on another colour. "Already swapping" and "already equipped" are
  // NOT failures of a weave (they print on the ordinary bandolier channel and a macro's overlapping second load says them).
  var BAND_FAIL_COLOUR = 1012;
  var BAND_FAIL_RE = /canceling set load|You cannot swap items when|You are too busy to (?:swap items|equip bandolier set)|^The bandolier set \[.*\] does not exist|^Invalid bandolier name/i;
  function isBandolierFailure(colour, text) { return colour === BAND_FAIL_COLOUR || BAND_FAIL_RE.test(bare(text)); }
  // '2h', 'fist', or null for a kick, a flying kick or any other special — those are not swings.
  function classify(verb, cfg) {
    if (cfg.twoVerbs.indexOf(verb) >= 0) return '2h';
    if (cfg.fistVerbs.indexOf(verb) >= 0) return 'fist';
    return null;
  }

  // ── The pure parts (also used by the renderers) ─────────────────────────────────────────────────────────────
  var SWING_GRACE = 250;   // a predicted 2H swing that has not printed yet is "swing" for this long, then rolled forward
  // Where we are in the cycle at `now`, from the numbers the engine sends. core: { last2H, lastFist, interval2H,
  // fistInterval, marginMs }. A missing last2H gives null.
  function derive(core, now) {
    if (!core || core.last2H == null || !(core.interval2H > 0)) return null;
    var iv = core.interval2H, fiv = core.fistInterval, base = core.last2H, n = 0;
    while (now > base + iv + SWING_GRACE && n < 12) { base += iv; n++; }   // the swings that came since the last line
    var lf = n > 0 ? null : core.lastFist;                                  // a rolled cycle is assumed unweaved: the fist is ready
    var open = Math.max(base, lf != null ? lf + fiv : base);
    var close = base + fiv - (core.marginMs || 0);
    var next2H = base + iv;
    var phase = now >= next2H ? 'swing' : now < open ? 'wait' : now < close ? 'go' : 'late';
    return { base: base, open: open, close: close, next2H: next2H, phase: phase, rolled: n };
  }
  // The coloured stretches of the next `cycles` 2H intervals: [{ kind: 'wait'|'go'|'late', start, end, k }] and the
  // predicted 2H swings [{ at, k }]. Future cycles assume nothing was pressed (the fist is ready at the swing).
  function zones(core, now, cycles) {
    var d = derive(core, now);
    if (!d) return null;
    var iv = core.interval2H, fiv = core.fistInterval, mg = core.marginMs || 0, out = [], swings = [];
    for (var k = 0; k < (cycles || 3); k++) {
      var b = d.base + k * iv, end = b + iv, open = k === 0 ? d.open : b, close = b + fiv - mg;
      function seg(kind, s, e) { s = Math.max(s, b); e = Math.min(e, end); if (e > s) out.push({ kind: kind, start: s, end: e, k: k }); }
      if (open >= close) { seg('wait', b, open); seg('late', open, end); }
      else { seg('wait', b, open); seg('go', open, close); seg('late', close, end); }
      swings.push({ at: end, k: k });
    }
    return { derived: d, zones: out, swings: swings };
  }

  // ── The engine (one per character) ──────────────────────────────────────────────────────────────────────────
  var ROUND_MS = 250;        // lines of one kind inside this are one round (a double attack prints two)
  var PRESS_GROUP_MS = 1200; // the macro loads two sets back to back: loads this close are ONE press
  var FIST_AFTER_MS = 700;   // a fist round this soon after a load belongs to that press
  var CLIP_MS = 250;         // the next 2H round later than expected by more than this = clipped
  var FIGHT_GAP_MS = 12000;  // no swing this long: the fight is over, the tally and the samples reset
  var MAX_SAMPLES = 6;
  var BARE_MISS_2H_MS = 300;
  var SYNC_NOTE_MS = 150;   // a 2H swing at least this far from the prediction is a re-sync worth saying // a bare "miss" this close to a predicted 2H swing is that round missing
  // `late` (ms past the expected 2H) is a whole number of swings, give or take CLIP_MS.
  // The tolerance widens by 100 ms a swing: two unseen swings drift further than one (a blood raven press 2 swings + 302 ms late).
  function onBeat(late, iv) { var k = Math.round(late / iv); return k >= 1 && Math.abs(late - k * iv) <= CLIP_MS + 100 * (k - 1); }
  var VOID_AFTER_MS = 2500;  // a bandolier failure this soon after the press's last load voids it (a set swaps over a few ticks)

  function median(a) {
    var s = a.slice().sort(function (x, y) { return x - y; }), n = s.length;
    return n ? (n % 2 ? s[(n - 1) >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2) : null;
  }

  function WeaveEngine(cfg) {
    this.cfg = cleanCfg(cfg);
    // What the lane can say when it stays idle (the guild lead, 2026-11-08: "WEAVING IS WAITING FOR A FIGHT BUT I'M IN
    // ONE"): your melee lines seen, how many matched a 2H or fist word, and the last word that did not. Kept across
    // fights; never reset by fresh().
    this.diag = { seen: 0, matched: 0, lastVerb: null };
    this.attempts = [];      // the last 50 attempt records (_record), kept across fights
    this.onAttempt = null;   // set by the hub: each record goes to Mimic's capture file
    this.hasteN = null; this.hasteAt = null; this.statsDelay = null;   // from /mystats (mystats())
    this.notice = null;
    this.fresh();
  }
  // Words that are not swings at all, so never offered as "your swings say …".
  var SPECIAL_VERBS = { kick: 1, kicks: 1, bash: 1, bashes: 1, backstab: 1, backstabs: 1, flying: 1, round: 1, dragon: 1,
    eagle: 1, tiger: 1, frenzy: 1, frenzies: 1, have: 1, are: 1, were: 1, gain: 1, feel: 1, begin: 1 };
  WeaveEngine.prototype.fresh = function () {
    this.last2H = null; this.last2HLine = null; this.lastFist = null; this.lastFistLine = null;
    this.samples = []; this.lastSwingAt = null; this.pending = null; this.offBand = []; this.divStreak = 0;
    this.lastPress = null; this.outcome = null; this.tally = { presses: 0, landed: 0, clips: 0, misses: 0, voided: 0, open: 0,
      // Basketweaver's terms (2026-11-09): 2H rounds and how many carried a weave, bonus (fist) attacks tried and hit, the
      // damage the weaved fists did, and the press's reaction (press - the window opening).
      rounds: 0, fistTried: 0, fistHit: 0, weaveDmg: 0, reactSum: 0, reactN: 0 };
    this.fightStart = null;
  };
  WeaveEngine.prototype.setConfig = function (cfg) { this.cfg = cleanCfg(cfg); };
  // /mystats (the guild lead, 2026-11-09: "running /mystats will sync up the basketweaver apparently"): the server prints
  // "Haste: N (cap M)" with N = 100 + haste (Mob::GetHaste; under 100 = slowed), and times a swing as delay * 10000 / N
  // (Client::SetAttackTimer). With N and a measured 2H interval the 2H's real delay follows, and from it the haste at any
  // later interval: the fist window no longer leans on the "2H weapon delay" setting. Kept across fights; a new /mystats
  // recalibrates (another weapon).
  // The latest re-sync, for the painters to say for a moment: { kind: sync | speed | stats, text, at }.
  WeaveEngine.prototype._note = function (kind, text, at) { this.notice = { kind: kind, text: text, at: at }; };
  WeaveEngine.prototype.twoHDelay = function () { return this.statsDelay || this.cfg.twoHDelay; };
  WeaveEngine.prototype.interval2H = function () {
    if (this.samples.length >= 3) return median(this.samples);
    return this.hasteN ? this.twoHDelay() * 10000 / this.hasteN : this.cfg.twoHDelay * 100;
  };
  WeaveEngine.prototype.mystats = function (hasteN, t) {
    if (!(hasteN > 0 && hasteN < 400)) return false;
    this.hasteN = hasteN; this.hasteAt = t; this.statsDelay = null;
    this._calibrate();
    if (!this.statsDelay) this._note('stats', '/mystats: haste ' + (hasteN - 100) + '% (calibrates on the next swings)', t);
    return true;
  };
  WeaveEngine.prototype._calibrate = function () {
    if (!this.hasteN || this.statsDelay || !this.measured()) return;
    var d = this.interval2H() * this.hasteN / 10000, r = Math.round(d);
    if (r >= 10 && r <= 60 && Math.abs(d - r) <= 0.6) {   // a weapon delay is a whole number of tenths
      this.statsDelay = r;
      this._note('stats', '/mystats: 2H delay ' + r + ', haste ' + (this.hasteN - 100) + '%', this.lastSwingAt || this.hasteAt || 0);
    }
  };
  WeaveEngine.prototype.measured = function () { return this.samples.length >= 3; };
  WeaveEngine.prototype.core = function () {
    var iv = this.interval2H(), haste = this.twoHDelay() * 100 / iv;
    return { last2H: this.last2H, lastFist: this.lastFist, interval2H: iv, haste: haste,
      fistInterval: (this.cfg.offDelay || handToHandDelay(this.cfg)) * 100 / haste, marginMs: this.cfg.marginMs };
  };
  WeaveEngine.prototype._resolve = function (kind, at) {
    var p = this.pending;
    if (!p) return;
    this.pending = null;
    this.outcome = { kind: kind, at: at, pressAt: p.firstT };
    if (kind === 'landed') {
      this.tally.landed++;
      this.tally.weaveDmg += p.fistDmg || 0;   // a landed weave's fist round is extra: the 2H swung on time as well
      if (p.open != null && p.firstT >= p.open) { this.tally.reactSum += p.firstT - p.open; this.tally.reactN++; }
      this.outcome.dmg = p.fistDmg || 0;
    } else if (kind === 'clip') this.tally.clips++; else if (kind === 'open') this.tally.open++; else this.tally.misses++;
    this._record(p, kind, at, null);
  };
  // Every attempt, the good ones too (the guild lead, 2026-11-09: "capture the successful weave attempts as well"): when it
  // was pressed, the window it was pressed in, when the fist and the 2H came, and how it ended. Kept in memory (the last 50)
  // and handed to onAttempt, which Mimic's main process appends to a file.
  WeaveEngine.prototype._record = function (p, kind, at, reason) {
    var c = this.core();
    var rec = { at: at, outcome: kind, reason: reason || null, press: p.firstT, lastLoad: p.lastLoad, loads: p.loads || 0,
      marked: !!p.marked, phase: p.phase || null, open: p.open, close: p.close, last2H: p.last2H, lastFist: p.lastFist,
      fist: p.fist, expected2H: p.expected, actual2H: (kind === 'landed' || kind === 'clip') ? at : null,
      interval2H: Math.round(c.interval2H), fistInterval: Math.round(c.fistInterval), measured: this.measured(),
      fistDmg: p.fistDmg || 0, fistMissed: !!p.fistMissed, reaction: p.open != null ? p.firstT - p.open : null };
    this.attempts.push(rec);
    if (this.attempts.length > 50) this.attempts.shift();
    if (typeof this.onAttempt === 'function') { try { this.onAttempt(rec); } catch (e) { /* a writer must never break timing */ } }
  };
  // One melee line, `t` = arrival (ms). Returns true when it was a swing.
  WeaveEngine.prototype.swing = function (text, t) {
    var s = parseSwing(text);
    if (!s) return false;
    // A bare "miss" (the short form names no weapon; 2026-11-09, compared against Basketweaver's "52 attempts 38 landed"):
    // straight after a press it is the fist round missing (the 2H is out of the hand); near the next predicted 2H swing it is
    // the 2H round missing. Anything else (a kick, a stray line) is left alone.
    if (s.bareMiss) {
      if (this.lastSwingAt == null || t - this.lastSwingAt > FIGHT_GAP_MS) return false;
      var pm = this.pending;
      if (pm && pm.fist == null && t >= pm.firstT && t - pm.lastLoad <= FIST_AFTER_MS) {
        pm.fist = t; pm.fistMissed = true; pm.fistDmg = 0; this.lastFist = t; this.lastFistLine = t; this.lastSwingAt = t;
        this.tally.fistTried++;
        return true;
      }
      if (this.last2H == null) return false;
      var ivm = this.interval2H(), km = Math.max(1, Math.round((t - this.last2H) / ivm));
      if (Math.abs(t - (this.last2H + km * ivm)) > BARE_MISS_2H_MS) return false;
      s = { verb: null, target: '', miss: true };
      var kind = '2h';
    } else {
      var kind = classify(s.verb, this.cfg);   // eslint-disable-line no-redeclare
    }
    // An offhand that shares the 2H's verb (Ribcracker "crush" beside a crushing staff): a 2H word straight after a press,
    // well before the 2H is due, is the offhand round (the 2H is out of the hand then).
    var pq = this.pending;
    if (kind === '2h' && pq && pq.fist == null && t >= pq.firstT && t - pq.lastLoad <= FIST_AFTER_MS
        && (pq.expected == null || t < pq.expected - CLIP_MS)) kind = 'fist';
    if (s.short && !kind) return false;   // a short-form line counts only for a word the lists know (it has no "You" to prove it is yours)
    if (s.verb && !SPECIAL_VERBS[s.verb]) { this.diag.seen++; if (kind) this.diag.matched++; else this.diag.lastVerb = s.verb; }
    if (!kind) return false;
    if (this.lastSwingAt != null && t - this.lastSwingAt > FIGHT_GAP_MS) this.fresh();   // a new fight
    if (this.fightStart == null) this.fightStart = t;
    this.lastSwingAt = t;
    if (kind === '2h') {
      if (this.last2HLine != null && t - this.last2HLine <= ROUND_MS) { this.last2HLine = t; return true; }   // the second line of a double attack
      this.last2HLine = t;
      this.tally.rounds++;
      var clipped = false;
      if (this.pending) {
        var p = this.pending, late = p.expected != null ? t - p.expected : 0;
        // Late by a whole number of swings (± CLIP_MS) is on time with rounds we never saw in between (a missed round whose
        // line named no weapon), not a clip: a real clip restarts the 2H from the fist's swing, a fraction of an interval late.
        clipped = late > CLIP_MS && !onBeat(late, this.interval2H());
        this._resolve(clipped ? 'clip' : (p.fist != null ? 'landed' : 'miss'), t);
      }
      if (this.last2H != null) {
        var dt = t - this.last2H, med = this.samples.length >= 3 ? median(this.samples) : null;
        // Say when the timeline moves (the guild lead, 2026-11-09: Basketweaver "will also autocalibrate when it detects a swing
        // ... we do that too, but it jumps and doesn't say anything"): a 2H swing this far off the prediction re-syncs it.
        if (med != null) {
          var kp = Math.max(1, Math.round(dt / med)), drift = Math.round(dt - kp * med);
          if (Math.abs(drift) >= SYNC_NOTE_MS && Math.abs(drift) < med / 2) this._note('sync', 'SYNC ' + (drift > 0 ? '+' : '') + drift + ' ms', t);
        }
        // A gap of two or three swings (rounds we never saw) is that many intervals, not one long one; a clipped interval is
        // longer than the weapon's own, and a gap past a fight break is not an interval.
        var raw = dt, kk = med != null ? Math.round(dt / med) : 1;
        if (kk >= 2 && kk <= 3 && Math.abs(dt - kk * med) <= CLIP_MS) { dt = dt / kk; this.divStreak++; } else this.divStreak = 0;
        if (!clipped && dt >= 300 && (med != null ? (dt >= 0.67 * med && dt <= 1.5 * med) : dt <= FIGHT_GAP_MS) && this.divStreak < 3) {
          this.samples.push(dt);
          if (this.samples.length > MAX_SAMPLES) this.samples.shift();
          this.offBand = [];
          this._calibrate();
        } else if (!clipped && raw >= 300 && raw <= FIGHT_GAP_MS) {
          // Re-lock on a new speed (the guild lead, 2026-11-09: "basketweaver is catching the delay appropriately ... they've
          // called for me to swing where ours was on red"; its card read 3.65 s against a hasted 1.65 s): haste dropping or
          // coming back moves every interval at once, and the old band refused the new ones forever. Two in a row that agree
          // with each other (within 15%) become the samples; so do three "missed rounds" in a row, which is a slower weapon.
          this.offBand.push(raw);
          if (this.offBand.length > 3) this.offBand.shift();
          var ob = this.offBand, a = ob[ob.length - 1], b = ob[ob.length - 2];
          if (b != null && Math.abs(a - b) <= 0.15 * Math.max(a, b)) {
            var was = this.samples.length >= 3 ? median(this.samples) : null;
            this.samples = [b, a, (a + b) / 2];
            if (was != null) this._note('speed', 'SPEED ' + (was / 1000).toFixed(2) + ' → ' + ((a + b) / 2000).toFixed(2) + ' s', t);
            this.offBand = []; this.divStreak = 0;
          }
        }
      }
      this.last2H = t;
    } else {
      var q = this.pending;
      if (this.lastFistLine != null && t - this.lastFistLine <= ROUND_MS) {   // the second line of the same fist round
        this.lastFistLine = t;
        if (q && q.fist != null) { q.fistDmg = (q.fistDmg || 0) + s.dmg; if (q.fistMissed && s.dmg) { q.fistMissed = false; this.tally.fistHit++; } }
        return true;
      }
      this.lastFistLine = t;
      this.lastFist = t;
      if (q && q.fist == null && t >= q.firstT && t - q.lastLoad <= FIST_AFTER_MS) {
        q.fist = t; q.fistDmg = s.dmg; q.fistMissed = !s.dmg;
        this.tally.fistTried++; if (s.dmg) this.tally.fistHit++;
      }
    }
    return true;
  };
  // A "Loading bandolier set [name]" line: the press.
  WeaveEngine.prototype.load = function (text, t) {
    if (parseLoad(text) == null) return false;
    this._press(t, 'load');
    return true;
  };
  // `/pipe weave` in the macro (the guild lead, 2026-11-09: "i can add a /pipe weave into the mix as well after the attempts
  // happen"): Zeal sends it as a custom pipe object; it marks the press for certain. Close to the loads it joins their press.
  WeaveEngine.prototype.marker = function (t) { this._press(t, 'marker'); return true; };
  WeaveEngine.prototype._press = function (t, how) {
    var p = this.pending;
    if (p && t - p.lastLoad <= PRESS_GROUP_MS) {   // the macro's second load, or its /pipe weave
      p.lastLoad = t; this.lastPress = t;
      if (how === 'marker') p.marked = true; else p.loads++;
      return;
    }
    // An earlier press whose 2H round never came before this one: with its fist seen it cannot be judged (no 2H to time),
    // so it is `open`, not a clip (2026-11-09: a blood raven "clip" 217 ms late was a re-press before the 2H line arrived).
    if (p) this._resolve(p.fist != null ? 'open' : 'miss', t);
    var exp = null;
    if (this.last2H != null) { var iv = this.interval2H(), b = this.last2H; while (b + iv + CLIP_MS < t) b += iv; exp = b + iv; }
    var d = this.active(t) ? derive(this.core(), t) : null;      // the window this press landed in, for the record
    this.pending = { firstT: t, lastLoad: t, fist: null, expected: exp, marked: how === 'marker', loads: how === 'load' ? 1 : 0,
      phase: d ? d.phase : null, open: d ? d.open : null, close: d ? d.close : null, last2H: this.last2H, lastFist: this.lastFist };
    this.tally.presses++;
    this.lastPress = t;
  };
  // A bandolier FAILURE line (Zeal's CHANNEL_BANDOLIER_FAILURE: "No empty inventory slot to unequip [..], canceling set load.",
  // "You cannot swap items when holding something in the cursor!", too busy, casting, a missing item): the swap never
  // happened, so the press is not a weave and does not count (the guild lead, 2026-11-09: "Don't count ones when inventory is
  // full of the user has something in their hand where the weave doesn't happen"). Recorded as `void` with the reason.
  WeaveEngine.prototype.fail = function (text, t) {
    var p = this.pending;
    if (!p || t - p.lastLoad > VOID_AFTER_MS) return false;
    this.pending = null;
    this.tally.presses--;
    this.tally.voided++;
    this.outcome = { kind: 'void', at: t, pressAt: p.firstT };
    this._record(p, 'void', t, bare(text).slice(0, 120));
    return true;
  };
  WeaveEngine.prototype.active = function (now) { return this.lastSwingAt != null && now - this.lastSwingAt <= FIGHT_GAP_MS; };
  // Settle what time alone decides, and reset after a fight. Returns true when the fight just ended.
  WeaveEngine.prototype.tick = function (now) {
    var p = this.pending;
    if (p && now > Math.max(p.expected != null ? p.expected : 0, p.lastLoad) + 2500) this._resolve(p.fist != null ? 'open' : 'miss', now);
    if (this.lastSwingAt != null && !this.active(now)) { this.fresh(); return true; }
    return false;
  };
  // The tally plus what follows from it: added DPS (the weaved fists' damage over the fight so far) and the average reaction.
  WeaveEngine.prototype.summary = function (now) {
    var t = Object.assign({}, this.tally);
    var end = this.lastSwingAt != null ? Math.max(this.lastSwingAt, Math.min(now, this.lastSwingAt + 3000)) : now;
    var secs = this.fightStart != null ? Math.max(1, (end - this.fightStart) / 1000) : 1;
    t.addedDps = Math.round(t.weaveDmg / secs);
    t.reactAvg = t.reactN ? Math.round(t.reactSum / t.reactN) : null;
    return t;
  };
  WeaveEngine.prototype.snapshot = function (now) {
    var c = this.core(), d = this.active(now) ? derive(c, now) : null;
    return {
      active: !!d, phase: d ? d.phase : 'idle', at: now,
      core: c, measured: this.measured(), open: d ? d.open : null, close: d ? d.close : null, next2H: d ? d.next2H : null,
      lastPress: this.lastPress, outcome: this.outcome, tally: this.summary(now),
      cfg: { showTally: this.cfg.showTally, marginMs: this.cfg.marginMs },
      diag: { seen: this.diag.seen, matched: this.diag.matched, lastVerb: this.diag.lastVerb },
      stats: { hasteN: this.hasteN, delay: this.statsDelay, at: this.hasteAt },
      notice: this.notice,
    };
  };

  // ── The hub: every character's engine, fed from the pipe objects, pushing states out ────────────────────────
  var PIPE_QUIET_MS = 5000, SEND_MS = 33;
  function createWeaveHub(o) {
    var send = o.send, clock = o.now || Date.now, engines = new Map(), enabled = false, dflt = {};
    function entry(character, make) {
      var k = String(character || '').toLowerCase();
      if (!k) return null;
      var e = engines.get(k);
      if (!e && make) {
        e = { character: character, eng: new WeaveEngine(Object.assign({}, dflt)), lastPipe: 0, sentAt: 0, wasActive: false, wantNeeds: false, needsAt: 0, configured: false };
        if (typeof o.onAttempt === 'function') { var who = character; e.eng.onAttempt = function (rec) { rec.character = who; o.onAttempt(rec); }; }
        engines.set(k, e);
      }
      return e || null;
    }
    function emit(e, st, now) {
      e.sentAt = now; st.character = e.character; st.source = (now - e.lastPipe <= PIPE_QUIET_MS) ? 'zeal' : 'needs-zeal'; send(st);
      // Each new outcome sounds once (2026-11-09): a landed weave (a big fist hit its own sound), a clip; nothing else.
      var oc = st.outcome;
      if (typeof o.onSound === 'function' && oc && oc.at && oc.at !== e.soundAt) {
        e.soundAt = oc.at;
        var cf = e.eng.cfg;
        var name = oc.kind === 'landed' ? ((oc.dmg || 0) >= cf.bigHit && cf.sndBig ? cf.sndBig : cf.sndLanded) : oc.kind === 'clip' ? cf.sndClip : '';
        if (name) { try { o.onSound({ name: name, volume: cf.sndVol, character: e.character, kind: oc.kind }); } catch (err) { /* never into the pipe */ } }
      }
    }
    return {
      engines: engines,
      setEnabled: function (on) { enabled = !!on; },
      // A renderer's settings for one character (and the newest become what a character with none starts from).
      setConfig: function (character, cfg) {
        var e = entry(character, true);
        if (!e) return;
        // A Canvas piece only knows the class and level: it must not wipe the delay and verbs a HUD set.
        if (cfg && cfg.partial) { e.eng.setConfig(Object.assign({}, e.eng.cfg, { cls: cfg.cls, level: cfg.level })); return; }
        e.configured = true;
        e.eng.setConfig(cfg);
        dflt = cleanCfg(cfg);
      },
      // Every object off the pipe. Cheap on the hot path: only type 0 (a chat line) is parsed, and only for a
      // character that has an engine or when something is listening.
      note: function (obj) {
        if (!obj || typeof obj.character !== 'string') return false;
        var e = entry(obj.character, false), now = clock();
        if (e) e.lastPipe = now;
        if ((obj.type !== 0 && obj.type !== 4) || (!e && !enabled)) return false;
        var d = obj.data;
        if (typeof d === 'string') { try { d = JSON.parse(d); } catch (err) { return false; } }
        if (!d || typeof d.text !== 'string') return false;
        // Type 4 is Zeal's custom pipe object, written by `/pipe <text>`: `/pipe weave` in the macro marks the press.
        if (obj.type === 4) {
          if (!/^weave\b/i.test(d.text.trim())) return false;
          if (!e) { e = entry(obj.character, true); e.lastPipe = now; }
          e.eng.marker(now);
          if (now - e.sentAt >= SEND_MS) { e.wasActive = true; emit(e, e.eng.snapshot(now), now); }
          return true;
        }
        // /mystats: "  Level: 65  AC: …  Class: 7 … Haste: 182 (cap …)". Only YOUR line: a pet you target prints its own, so the
        // class must be the one this engine times (Monk 7, Beastlord 15).
        if (d.text.indexOf('Haste: ') >= 0) {
          var ms = /\bLevel: \d+\s+AC: -?\d+\s+Class: (\d+)\b.*\bHaste: (\d+) \(cap/.exec(d.text);
          if (ms) {
            if (!e) { e = entry(obj.character, true); e.lastPipe = now; }
            var want = e.eng.cfg.cls === 'beastlord' ? 15 : 7;
            if (Number(ms[1]) !== want) return false;
            var ok = e.eng.mystats(Number(ms[2]), now);
            if (ok) emit(e, e.eng.snapshot(now), now);
            return ok;
          }
        }
        // A bandolier failure voids the press it follows (inventory full, something on the cursor, too busy, casting).
        if (isBandolierFailure(Number(d.type), d.text)) {
          if (!e) return false;
          var voided = e.eng.fail(d.text, now);
          if (voided) emit(e, e.eng.snapshot(now), now);
          return voided;
        }
        // Your melee lines by their words, on any colour: 265 / 267 (you hit / you miss) are the usual ones, but a crit and
        // other client paths print yours on others, and a colour gate left the lane idle mid-fight (the guild lead,
        // 2026-11-08). parseSwing only takes "You <verb> <target> for N points of damage." and "You try to …", never
        // non-melee damage, and classify() only a 2H or fist word.
        var swing = maybeSwing(d.text);   // "You …" or the short form, with or without a leading timestamp
        var load = !swing && d.text.indexOf('oading bandolier set') > 0;
        if (!swing && !load) return false;
        if (!e) { e = entry(obj.character, true); e.lastPipe = now; }
        var before = e.eng.diag.seen;
        var took = swing ? e.eng.swing(d.text, now) : e.eng.load(d.text, now);
        if (took && now - e.sentAt >= SEND_MS) { e.wasActive = true; emit(e, e.eng.snapshot(now), now); }
        // Melee seen but none of it matched: say so now and then, so an idle lane can name the word it heard.
        else if (!took && e.eng.diag.seen > before && !e.eng.active(now) && now - e.sentAt >= 2000) emit(e, e.eng.snapshot(now), now);
        return took;
      },
      // The 50 ms beat: settle time-driven outcomes, push the live state, push one final idle, and tell a
      // configured character that has no pipe that it needs Zeal.
      tick: function () {
        if (!engines.size) return;
        var now = clock();
        engines.forEach(function (e) {
          var ended = e.eng.tick(now), st = e.eng.snapshot(now);
          if (st.active) { e.wasActive = true; if (now - e.sentAt >= SEND_MS) emit(e, st, now); return; }
          if (e.wasActive || ended) { e.wasActive = false; emit(e, st, now); return; }
          if (e.configured && now - e.lastPipe > PIPE_QUIET_MS && now - e.needsAt >= 1000) { e.needsAt = now; emit(e, st, now); }
        });
      },
      snapshots: function () {
        var now = clock(), out = [];
        engines.forEach(function (e) { var st = e.eng.snapshot(now); st.character = e.character; st.source = (now - e.lastPipe <= PIPE_QUIET_MS) ? 'zeal' : 'needs-zeal'; out.push(st); });
        return out;
      },
    };
  }

  var api = { handToHandDelay: handToHandDelay, cleanCfg: cleanCfg, DEFAULT_CFG: DEFAULT_CFG, parseSwing: parseSwing, parseLoad: parseLoad,
    maybeSwing: maybeSwing, unstamp: unstamp, isBandolierFailure: isBandolierFailure,
    classify: classify, derive: derive, zones: zones, median: median, WeaveEngine: WeaveEngine, createWeaveHub: createWeaveHub,
    CLIP_MS: CLIP_MS, FIGHT_GAP_MS: FIGHT_GAP_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.WpWeave = api;
})(typeof window !== 'undefined' ? window : null);
