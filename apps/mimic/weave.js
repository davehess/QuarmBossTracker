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
    marginMs: 150, showTally: true,
    cls: 'monk', level: 60, race: 'human', epic: false,
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
  function cleanCfg(c) {
    c = c || {};
    var out = {
      twoHDelay: intIn(c.twoHDelay, 10, 60, DEFAULT_CFG.twoHDelay),
      twoVerbs: verbList(c.twoVerbs, DEFAULT_CFG.twoVerbs),
      fistVerbs: verbList(c.fistVerbs, DEFAULT_CFG.fistVerbs),
      marginMs: intIn(c.marginMs, 0, 500, DEFAULT_CFG.marginMs),
      showTally: c.showTally === undefined ? true : !!c.showTally,
      cls: String(c.cls || '').toLowerCase() === 'beastlord' ? 'beastlord' : 'monk',
      level: intIn(c.level, 1, 65, DEFAULT_CFG.level),
      race: String(c.race || '').toLowerCase() === 'iksar' ? 'iksar' : 'human',
      epic: !!c.epic,
    };
    out.fistVerbs = out.fistVerbs.filter(function (v) { return out.twoVerbs.indexOf(v) < 0; });   // a verb is one or the other
    if (!out.fistVerbs.length) out.fistVerbs = DEFAULT_CFG.fistVerbs.filter(function (v) { return out.twoVerbs.indexOf(v) < 0; });
    return out;
  }

  // ── Lines ───────────────────────────────────────────────────────────────────────────────────────────────────
  var HIT_RE = /^You (\w+) (.+?) for (\d+) points? of damage\./i;           // colour 265 (USERCOLOR_YOU_HIT_OTHER)
  var MISS_RE = /^You try to (\w+) (.+?), but /i;                           // colour 267 (USERCOLOR_YOU_MISS_OTHER); dodge, parry, block, riposte too
  var BAND_RE = /^Loading bandolier set \[(.+?)\]/i;                        // Zeal's own channel (the agent maps 1010/1011); text is distinctive enough to match on any colour
  function bare(text) { return String(text == null ? '' : text).replace(/^\[[^\]]*\]\s*/, '').trim(); }
  // YOUR melee swing, or null. Only a line that starts "You " counts: another player's hits arrive on other colours,
  // but this guards anyway.
  function parseSwing(text) {
    var t = bare(text), m = HIT_RE.exec(t), miss = false;
    if (!m) { m = MISS_RE.exec(t); miss = !!m; }
    return m ? { verb: m[1].toLowerCase(), target: m[2], miss: miss } : null;
  }
  function parseLoad(text) { var m = BAND_RE.exec(bare(text)); return m ? m[1] : null; }
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

  function median(a) {
    var s = a.slice().sort(function (x, y) { return x - y; }), n = s.length;
    return n ? (n % 2 ? s[(n - 1) >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2) : null;
  }

  function WeaveEngine(cfg) {
    this.cfg = cleanCfg(cfg);
    this.fresh();
  }
  WeaveEngine.prototype.fresh = function () {
    this.last2H = null; this.last2HLine = null; this.lastFist = null; this.lastFistLine = null;
    this.samples = []; this.lastSwingAt = null; this.pending = null;
    this.lastPress = null; this.outcome = null; this.tally = { presses: 0, landed: 0, clips: 0, misses: 0 };
  };
  WeaveEngine.prototype.setConfig = function (cfg) { this.cfg = cleanCfg(cfg); };
  WeaveEngine.prototype.interval2H = function () {
    return this.samples.length >= 3 ? median(this.samples) : this.cfg.twoHDelay * 100;
  };
  WeaveEngine.prototype.measured = function () { return this.samples.length >= 3; };
  WeaveEngine.prototype.core = function () {
    var iv = this.interval2H(), haste = this.cfg.twoHDelay * 100 / iv;
    return { last2H: this.last2H, lastFist: this.lastFist, interval2H: iv, haste: haste,
      fistInterval: handToHandDelay(this.cfg) * 100 / haste, marginMs: this.cfg.marginMs };
  };
  WeaveEngine.prototype._resolve = function (kind, at) {
    var p = this.pending;
    if (!p) return;
    this.pending = null;
    this.outcome = { kind: kind, at: at, pressAt: p.firstT };
    if (kind === 'landed') this.tally.landed++; else if (kind === 'clip') this.tally.clips++; else this.tally.misses++;
  };
  // One melee line, `t` = arrival (ms). Returns true when it was a swing.
  WeaveEngine.prototype.swing = function (text, t) {
    var s = parseSwing(text);
    if (!s) return false;
    var kind = classify(s.verb, this.cfg);
    if (!kind) return false;
    if (this.lastSwingAt != null && t - this.lastSwingAt > FIGHT_GAP_MS) this.fresh();   // a new fight
    this.lastSwingAt = t;
    if (kind === '2h') {
      if (this.last2HLine != null && t - this.last2HLine <= ROUND_MS) { this.last2HLine = t; return true; }   // the second line of a double attack
      this.last2HLine = t;
      var clipped = false;
      if (this.pending) {
        var p = this.pending, late = p.expected != null ? t - p.expected : 0;
        clipped = late > CLIP_MS;
        this._resolve(clipped ? 'clip' : (p.fist != null ? 'landed' : 'miss'), t);
      }
      if (this.last2H != null) {
        var dt = t - this.last2H, med = this.samples.length >= 3 ? median(this.samples) : null;
        // A clipped interval is longer than the weapon's own, and a gap past a fight break is not an interval.
        if (!clipped && dt >= 300 && (med != null ? dt <= 2 * med : dt <= FIGHT_GAP_MS)) {
          this.samples.push(dt);
          if (this.samples.length > MAX_SAMPLES) this.samples.shift();
        }
      }
      this.last2H = t;
    } else {
      if (this.lastFistLine != null && t - this.lastFistLine <= ROUND_MS) { this.lastFistLine = t; return true; }
      this.lastFistLine = t;
      this.lastFist = t;
      var q = this.pending;
      if (q && q.fist == null && t >= q.firstT && t - q.lastLoad <= FIST_AFTER_MS) q.fist = t;
    }
    return true;
  };
  // A "Loading bandolier set [name]" line: the press.
  WeaveEngine.prototype.load = function (text, t) {
    if (parseLoad(text) == null) return false;
    var p = this.pending;
    if (p && t - p.lastLoad <= PRESS_GROUP_MS) { p.lastLoad = t; this.lastPress = t; return true; }   // the macro's second load
    if (p) this._resolve(p.fist != null ? 'clip' : 'miss', t);   // an earlier press that never saw its 2H round
    var exp = null;
    if (this.last2H != null) { var iv = this.interval2H(), b = this.last2H; while (b + iv + CLIP_MS < t) b += iv; exp = b + iv; }
    this.pending = { firstT: t, lastLoad: t, fist: null, expected: exp };
    this.tally.presses++;
    this.lastPress = t;
    return true;
  };
  WeaveEngine.prototype.active = function (now) { return this.lastSwingAt != null && now - this.lastSwingAt <= FIGHT_GAP_MS; };
  // Settle what time alone decides, and reset after a fight. Returns true when the fight just ended.
  WeaveEngine.prototype.tick = function (now) {
    var p = this.pending;
    if (p && now > Math.max(p.expected != null ? p.expected : 0, p.lastLoad) + 2500) this._resolve(p.fist != null ? 'clip' : 'miss', now);
    if (this.lastSwingAt != null && !this.active(now)) { this.fresh(); return true; }
    return false;
  };
  WeaveEngine.prototype.snapshot = function (now) {
    var c = this.core(), d = this.active(now) ? derive(c, now) : null;
    return {
      active: !!d, phase: d ? d.phase : 'idle', at: now,
      core: c, measured: this.measured(), open: d ? d.open : null, close: d ? d.close : null, next2H: d ? d.next2H : null,
      lastPress: this.lastPress, outcome: this.outcome, tally: Object.assign({}, this.tally),
      cfg: { showTally: this.cfg.showTally, marginMs: this.cfg.marginMs },
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
      if (!e && make) { e = { character: character, eng: new WeaveEngine(Object.assign({}, dflt)), lastPipe: 0, sentAt: 0, wasActive: false, wantNeeds: false, needsAt: 0, configured: false }; engines.set(k, e); }
      return e || null;
    }
    function emit(e, st, now) { e.sentAt = now; st.character = e.character; st.source = (now - e.lastPipe <= PIPE_QUIET_MS) ? 'zeal' : 'needs-zeal'; send(st); }
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
        if (obj.type !== 0 || (!e && !enabled)) return false;
        var d = obj.data;
        if (typeof d === 'string') { try { d = JSON.parse(d); } catch (err) { return false; } }
        if (!d || typeof d.text !== 'string') return false;
        var k = Number(d.type), swing = (k === 265 || k === 267), load = !swing && d.text.indexOf('oading bandolier set') > 0;
        if (!swing && !load) return false;
        if (!e) { e = entry(obj.character, true); e.lastPipe = now; }
        var took = swing ? e.eng.swing(d.text, now) : e.eng.load(d.text, now);
        if (took && now - e.sentAt >= SEND_MS) { e.wasActive = true; emit(e, e.eng.snapshot(now), now); }
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
    classify: classify, derive: derive, zones: zones, median: median, WeaveEngine: WeaveEngine, createWeaveHub: createWeaveHub,
    CLIP_MS: CLIP_MS, FIGHT_GAP_MS: FIGHT_GAP_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.WpWeave = api;
})(typeof window !== 'undefined' ? window : null);
