// kiteCoach.js - the Map's kite coach: the pure math, no DOM, no clock of its own (every function is handed `t`).
//
// The guild lead, 2026-10-15: kiters run circles, one raider's loop is "flawless" and the guild lead's "is not";
// "common non-drifting circles and speeds are worth us hanging onto." map.html feeds this YOUR OWN position at the
// rate it arrives (Zeal ~10 Hz, up to 20/s); it finds a circle in it, counts laps, and says how far the centre drifts
// from one lap to the next. Nothing here sends anything: map.html decides what to show, the agent decides what may
// leave the machine.
//
// Loaded by map.html with <script src> (window.WPKite) and by test/kite-coach.test.js with require().
//
// Frames: positions are the Map's SERVER frame. The screen is (-x, -y), so +y is up the screen (north) and +x is to the
// left (west). 'cw' / 'ccw' are as seen on the Map with north up, and compass words are real compass (a drift of +x is W).
//
// How it works:
//  * a ring buffer of the last BUF_MS of positions, each with its running path length;
//  * not engaged: every SEARCH_MS look at windows of growing path length (WIN0 x WIN_RATIO^n) back from now and fit a
//    circle (Kasa, algebraic) to each; the first window that is a circle (radius R_MIN..R_MAX, wobble under
//    ENGAGE_WOBBLE of r) AND has turned one full, one-way lap around its centre engages. That window is "lap 0";
//  * engaged: the angle turned around the running centre is summed sample by sample (the crossing time is interpolated,
//    so lap times are good to a few ms, not a sample); every 2 pi is a lap, fitted on its own samples. Drift = distance
//    between this lap's centre and the previous lap's. The running centre is refitted over the last FIT_LAPS laps;
//  * disengaged after LOSE_LAPS lap-times with no lap, or when the loop stops being a circle or reverses;
//  * a lap is CLEAN (and CLEAN_LAPS clean laps in a row make a "report", once per run) when its wobble, centre drift,
//    radius change and lap-time change against the lap before it are all small and it turned the same way.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WPKite = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var TAU = Math.PI * 2;
  var K = {
    RUN_BASE_UPS: 30.3,       // 100% run, units a second (map.html RUN_BASE_UPS, measured)
    R_MIN: 20, R_MAX: 500,    // circle radius that counts
    ENGAGE_WOBBLE: 0.25,      // radius stddev / r to engage, and to keep a lap
    DIRECTION_PURITY: 0.85,   // |net angle| / total angle: below this it is a figure-eight or back-and-forth
    CLEAN_WOBBLE: 0.10,       // a clean lap: radius stddev <= 10% r
    CLEAN_DRIFT: 0.08,        //   centre moved <= 8% r from the lap before
    CLEAN_RADIUS: 0.08,       //   radius changed <= 8% from the lap before (a spiral fails here)
    CLEAN_PACE: 0.15,         //   lap time within +-15% of the lap before
    CLEAN_LAPS: 3,            // clean laps in a row for a report
    BUF_MS: 180000, BUF_MAX: 4500,
    WIN0: 120, WIN_RATIO: 1.2, WIN_MAX: 3800,   // search windows by path length: ~2 pi r for r 20 .. 500, 1.2 apart
    FIT_PTS: 180,             // a fit never takes more than this many points (subsampled)
    SEARCH_MS: 250, REFIT_MS: 400, MOVING_UPS: 8,
    PERSIST_LAPS: 0.2,        // the circle must still be there this much of a lap after it first passed, to engage
    FIT_LAPS: 1.2,            // the running centre is fitted over this many laps
    LOSE_LAPS: 1.5, LOSE_MIN_MS: 6000,          // no lap for LOSE_LAPS lap-times (at least LOSE_MIN_MS): not circling any more
    GAP_MS: 4000, JUMP: 250,  // no sample this long / a step this big (zoning, a gate): start over
    DRIFT_SHOW: 0.03,         // an arrow between the centres from this much drift (fraction of r)
    DRIFT_GREEN: 0.05, DRIFT_AMBER: 0.12,       // chip colour: green below the first, amber below the second, red above
    GUILD_CENTRE: 0.35, GUILD_RADIUS: 0.25,     // "near a guild loop": centre within 0.35 r, radius within 25%
  };

  function wrap(a) { return a - TAU * Math.round(a / TAU); }
  // The angle of a point around a centre on the SCREEN, growing clockwise (screen y is down, so this is atan2 of the
  // screen offsets (-dx, -dy)).
  function angAt(p, cx, cy) { return Math.atan2(-(p.y - cy), -(p.x - cx)); }

  // Kasa circle fit: the least-squares circle through points [{x, y}], algebraic form on mean-centred data. Returns
  // { cx, cy, r, sd, n } with r the mean distance from the centre and sd its standard deviation (the "wobble"), or null
  // for too few points or points on a line.
  function fitCircle(pts) {
    var n = pts.length, i;
    if (n < 6) return null;
    var mx = 0, my = 0;
    for (i = 0; i < n; i++) { mx += pts[i].x; my += pts[i].y; }
    mx /= n; my /= n;
    var suu = 0, svv = 0, suv = 0, suuu = 0, svvv = 0, suvv = 0, suuv = 0;
    for (i = 0; i < n; i++) {
      var u = pts[i].x - mx, v = pts[i].y - my, uu = u * u, vv = v * v;
      suu += uu; svv += vv; suv += u * v; suuu += uu * u; svvv += vv * v; suvv += u * vv; suuv += uu * v;
    }
    var det = suu * svv - suv * suv;
    if (!(det > 1e-4 * suu * svv)) return null;   // a line (or one point): no circle
    var b1 = (suuu + suvv) / 2, b2 = (suuv + svvv) / 2;
    var cx = mx + (b1 * svv - b2 * suv) / det, cy = my + (b2 * suu - b1 * suv) / det;
    var sum = 0, sq = 0;
    for (i = 0; i < n; i++) { var d = Math.hypot(pts[i].x - cx, pts[i].y - cy); sum += d; sq += d * d; }
    var r = sum / n, sd = Math.sqrt(Math.max(0, sq / n - r * r));
    return isFinite(cx) && isFinite(cy) && isFinite(r) ? { cx: cx, cy: cy, r: r, sd: sd, n: n } : null;
  }
  // The angle turned around a centre along points in order: { signed (clockwise positive), abs (every step counted) }.
  function turned(pts, cx, cy) {
    var signed = 0, abs = 0;
    for (var i = 1; i < pts.length; i++) {
      var d = wrap(angAt(pts[i], cx, cy) - angAt(pts[i - 1], cx, cy));
      signed += d; abs += Math.abs(d);
    }
    return { signed: signed, abs: abs };
  }
  function pathLen(pts) { var s = 0; for (var i = 1; i < pts.length; i++) s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); return s; }
  function mean(pts, k) { var s = 0; for (var i = 0; i < pts.length; i++) s += pts[i][k] || 0; return pts.length ? s / pts.length : 0; }
  function subsample(pts, max) {
    if (pts.length <= max) return pts;
    var out = [], step = (pts.length - 1) / (max - 1);
    for (var i = 0; i < max; i++) out.push(pts[Math.round(i * step)]);
    return out;
  }
  function isCircle(f) { return !!f && f.r >= K.R_MIN && f.r <= K.R_MAX && f.sd <= K.ENGAGE_WOBBLE * f.r; }

  var COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  // Which way (dx, dy) in the server frame points, as a compass word: +y is north, +x is west.
  function compass(dx, dy) {
    var north = dy, east = -dx;
    if (!(Math.hypot(north, east) > 0)) return '';
    var a = Math.atan2(east, north);           // 0 = north, growing clockwise
    return COMPASS[((Math.round(a / (TAU / 8)) % 8) + 8) % 8];
  }

  // Speed as % of a normal run: one circumference a lap. Not the length of the path walked: a few units of jitter on every
  // sample would add up to a lot of "distance" at 20 samples a second, and a lap within 10% of a circle is a circle.
  function speedPct(r, lapS) { return lapS > 0 ? TAU * r / lapS / K.RUN_BASE_UPS * 100 : 0; }
  // One lap from the samples walked during it.
  function lapFrom(pts, t0, t1, n) {
    var f = fitCircle(subsample(pts, K.FIT_PTS));
    if (!f || pts.length < 2) return null;
    var tn = turned(pts, f.cx, f.cy), lapS = (t1 - t0) / 1000;
    return { n: n, cx: f.cx, cy: f.cy, cz: mean(pts, 'z'), r: f.r, sd: f.sd, lapS: lapS,
      speedPct: speedPct(f.r, lapS), dir: tn.signed >= 0 ? 'cw' : 'ccw',
      t0: t0, t1: t1, drift: null, driftDx: 0, driftDy: 0, dr: null, clean: false };
  }
  // A lap against the one before it.
  function cleanLap(lap, prev) {
    if (!prev || lap.sd > K.CLEAN_WOBBLE * lap.r) return false;
    return lap.drift <= K.CLEAN_DRIFT * lap.r && Math.abs(lap.r - prev.r) <= K.CLEAN_RADIUS * prev.r
      && lap.dir === prev.dir && Math.abs(lap.lapS - prev.lapS) <= K.CLEAN_PACE * prev.lapS;
  }
  // Green / amber / red / none by the lap's drift as a share of its radius.
  function driftClass(lap) {
    if (!lap || lap.drift == null) return 'n';
    var f = lap.drift / lap.r;
    return f < K.DRIFT_GREEN ? 'g' : f < K.DRIFT_AMBER ? 'a' : 'r';
  }
  function num(v, dp) { var m = Math.pow(10, dp || 0); return Math.round(v * m) / m; }
  // `Lap 12.4 s · r 118 · drift 6 u NE · wobble 4 · 104%` (drift is a dash until there is a lap to compare with).
  function chipText(lap) {
    if (!lap) return '';
    var dr = lap.drift == null ? '-' : num(lap.drift) + ' u' + (lap.drift >= 0.5 ? ' ' + compass(lap.driftDx, lap.driftDy) : '');
    return 'Lap ' + num(lap.lapS, 1) + ' s · r ' + num(lap.r) + ' · drift ' + dr + ' · wobble ' + num(lap.sd) + ' · ' + Math.round(lap.speedPct) + '%';
  }

  // A guild loop { cx, cy, cz, r, lap_s, speed_pct, dir, drift_u, wobble_u, laps, seen, ... } the lap is on top of
  // (centre within GUILD_CENTRE r, radius within GUILD_RADIUS); the nearest centre wins. null for none.
  function matchGuild(lap, loops) {
    var best = null, bd = Infinity;
    if (!lap) return null;
    for (var i = 0; i < (loops || []).length; i++) {
      var L = loops[i], dc = Math.hypot(lap.cx - L.cx, lap.cy - L.cy);
      if (dc <= K.GUILD_CENTRE * L.r && Math.abs(lap.r - L.r) <= K.GUILD_RADIUS * L.r && dc < bd) { best = L; bd = dc; }
    }
    return best;
  }
  // `vs guild: +0.8 s/lap, centre 9 u off`
  function guildText(lap, L) {
    var d = num(lap.lapS - L.lap_s, 1), dc = Math.round(Math.hypot(lap.cx - L.cx, lap.cy - L.cy));
    return 'vs guild: ' + (d >= 0 ? '+' : '-') + Math.abs(d).toFixed(1) + ' s/lap, centre ' + dc + ' u off';
  }
  // `r 118 · 12.4 s · 104% · x7`
  function guildLabel(L) { return 'r ' + num(L.r) + ' · ' + num(L.lap_s, 1) + ' s · ' + Math.round(L.speed_pct) + '% · ×' + (L.seen || L.laps || 1); }
  // Where the pace dot of a guild loop is at `nowMs`: once round every lap_s, the loop's way, from the same phase for
  // everyone (the wall clock), so two Maps show the same dot.
  function guildDot(L, nowMs) {
    var ph = (nowMs / 1000 / L.lap_s) % 1, th = TAU * ph * (L.dir === 'ccw' ? -1 : 1);
    return { x: L.cx - L.r * Math.cos(th), y: L.cy - L.r * Math.sin(th) };   // screen (r cos, r sin), back to the server frame
  }

  function create() {
    var buf = [], eng = null, cand = null, lastSearch = -Infinity, view = null;

    function reset() { buf = []; eng = null; cand = null; lastSearch = -Infinity; view = null; }
    function trim(t) {
      var cut = 0;
      while (cut < buf.length - 1 && (t - buf[cut].t > K.BUF_MS || buf.length - cut > K.BUF_MAX)) cut++;
      if (cut) buf.splice(0, cut);
    }
    // The trailing samples covering `L` units of path, oldest first (null when the buffer holds less).
    function windowPath(L) {
      var end = buf[buf.length - 1], i = buf.length - 1;
      if (end.s - buf[0].s < L * 0.98) return null;
      while (i > 0 && end.s - buf[i - 1].s <= L) i--;
      return buf.slice(i);
    }
    function mkView() {
      if (!eng) { view = null; return; }
      var cur = eng.last, prev = eng.prev;
      view = { cur: cur, ghost: prev && prev !== cur ? prev : null, provisional: !!cur.provisional, cls: driftClass(cur),
        showArrow: !!prev && prev !== cur && cur.drift != null && cur.drift >= K.DRIFT_SHOW * cur.r,
        chip: chipText(cur), laps: eng.nLaps, streak: eng.streak.length, reported: eng.reported };
    }

    function search() {
      if (buf.length < 12) return null;
      var tail = buf[buf.length - 1], k = buf.length - 1;
      while (k > 0 && tail.t - buf[k - 1].t <= 1000) k--;
      var recent = buf.slice(k);
      var mv = recent.length > 1 ? pathLen(recent) / Math.max(1, tail.t - recent[0].t) * 1000 : 0;
      if (mv < K.MOVING_UPS) return null;
      for (var L = K.WIN0; L <= K.WIN_MAX; L *= K.WIN_RATIO) {
        var w = windowPath(L);
        if (!w) break;                                      // the buffer holds no window this long, so none longer either
        var pts = subsample(w, K.FIT_PTS), f = fitCircle(pts);
        if (!isCircle(f)) continue;
        var tn = turned(pts, f.cx, f.cy);
        if (Math.abs(tn.signed) < TAU * 0.98 || Math.abs(tn.signed) < K.DIRECTION_PURITY * tn.abs) continue;   // not one full lap one way
        var laps = Math.abs(tn.signed) / TAU, dur = w[w.length - 1].t - w[0].t;
        return { cx: f.cx, cy: f.cy, r: f.r, sd: f.sd, cz: mean(w, 'z'), lapS: dur / 1000 / laps, speedPct: speedPct(f.r, dur / 1000 / laps),
          dir: tn.signed > 0 ? 'cw' : 'ccw', t0: w[0].t, t1: w[w.length - 1].t, n: 0, drift: null, driftDx: 0, driftDy: 0, dr: null, clean: false, provisional: true };
      }
      return null;
    }

    function disengage(reason, out) {
      eng = null; view = null;
      out.push({ type: 'disengage', reason: reason });
    }

    function finishLap(tCross, out) {
      var pts = [];
      for (var i = buf.length - 1; i >= 0 && buf[i].t > eng.lapT0; i--) pts.push(buf[i]);
      pts.reverse();
      var lap = pts.length >= 6 ? lapFrom(pts, eng.lapT0, tCross, ++eng.nLaps) : null;
      if (!lap || !isCircle(lap)) { disengage('not a circle', out); return; }
      var prev = eng.last;
      lap.drift = Math.hypot(lap.cx - prev.cx, lap.cy - prev.cy);
      lap.driftDx = lap.cx - prev.cx; lap.driftDy = lap.cy - prev.cy;
      lap.dr = lap.r - prev.r;
      lap.clean = cleanLap(lap, prev);
      // A new loop elsewhere (centre more than a radius from the one reported): a new run, a new report.
      if (eng.reported && Math.hypot(lap.cx - eng.repCx, lap.cy - eng.repCy) > eng.repR) { eng.reported = false; eng.streak = []; }
      if (lap.clean) eng.streak.push(lap); else eng.streak = [];
      eng.prev = prev; eng.last = lap;
      eng.cx = lap.cx; eng.cy = lap.cy; eng.r = lap.r; eng.lapS = lap.lapS;
      eng.lapT0 = tCross;
      out.push({ type: 'lap', lap: lap });
      if (eng.streak.length >= K.CLEAN_LAPS && !eng.reported) {
        var s = eng.streak, m = function (k) { return mean(s, k); };
        eng.reported = true; eng.repCx = m('cx'); eng.repCy = m('cy'); eng.repR = m('r');
        out.push({ type: 'report', body: { cx: num(m('cx'), 1), cy: num(m('cy'), 1), cz: num(m('cz'), 1), r: num(m('r'), 1), lap_s: num(m('lapS'), 2),
          speed_pct: num(m('speedPct'), 1), drift_u: num(m('drift'), 1), wobble_u: num(m('sd'), 1), laps: s.length, dir: s[s.length - 1].dir } });
      }
      mkView();
    }

    function refit(t) {
      eng.refitAt = t;
      var pts = [], acc = 0, prevA = null;
      for (var i = buf.length - 1; i >= 0 && pts.length < 400; i--) {
        var a = angAt(buf[i], eng.cx, eng.cy);
        if (prevA != null) acc += Math.abs(wrap(a - prevA));
        prevA = a;
        pts.push(buf[i]);
        if (acc >= K.FIT_LAPS * TAU) break;
      }
      var f = fitCircle(subsample(pts.reverse(), K.FIT_PTS));
      if (isCircle(f)) { eng.cx = f.cx; eng.cy = f.cy; eng.r = f.r; }
    }

    function step(t, prevP, p, out) {
      var d = wrap(angAt(p, eng.cx, eng.cy) - angAt(prevP, eng.cx, eng.cy)) * eng.sgn, before = eng.prog;
      eng.prog += d;
      if (eng.prog >= TAU) {
        var tCross = prevP.t + (TAU - before) / (eng.prog - before) * (p.t - prevP.t);
        eng.prog -= TAU;
        finishLap(tCross, out);
        return;
      }
      if (eng.prog <= -Math.PI) { disengage('turned round', out); return; }
      if (t - eng.lapT0 > Math.max(K.LOSE_MIN_MS, K.LOSE_LAPS * eng.lapS * 1000)) { disengage('no lap', out); return; }
      if (t - eng.refitAt >= K.REFIT_MS) refit(t);
    }

    // One position sample. Returns the events it caused: { type: 'engage' } | { type: 'lap', lap } |
    // { type: 'report', body } | { type: 'disengage', reason }.
    function push(t, x, y, z) {
      var out = [];
      if (!isFinite(t) || !isFinite(x) || !isFinite(y)) return out;
      var tail = buf.length ? buf[buf.length - 1] : null;
      if (tail && t < tail.t) return out;
      if (tail && (t - tail.t > K.GAP_MS || Math.hypot(x - tail.x, y - tail.y) > K.JUMP)) { if (eng) out.push({ type: 'disengage', reason: 'gap' }); reset(); tail = null; }
      // The same spot again (a heartbeat, or the agent's poll repeating a push): nothing new to learn, but time passes.
      if (tail && x === tail.x && y === tail.y && t - tail.t < 1000) {
        if (eng && t - eng.lapT0 > Math.max(K.LOSE_MIN_MS, K.LOSE_LAPS * eng.lapS * 1000)) disengage('no lap', out);
        return out;
      }
      var p = { t: t, x: x, y: y, z: z == null ? 0 : z, s: tail ? tail.s + Math.hypot(x - tail.x, y - tail.y) : 0 };
      buf.push(p); trim(t);
      if (eng) step(t, tail || p, p, out);
      else if (t - lastSearch >= K.SEARCH_MS) {
        lastSearch = t;
        var lap0 = search();
        // A loop that is only the lobe of a figure-eight passes the test once, at the instant it closes. A circle keeps
        // passing: engage only when the same circle passes again PERSIST_LAPS of a lap later.
        if (!lap0) cand = null;
        else if (!cand || Math.hypot(lap0.cx - cand.cx, lap0.cy - cand.cy) > 0.25 * cand.r) { cand = { t: t, cx: lap0.cx, cy: lap0.cy, r: lap0.r }; lap0 = null; }
        else if (t - cand.t < K.PERSIST_LAPS * lap0.lapS * 1000) lap0 = null;
        if (lap0) {
          cand = null;
          eng = { cx: lap0.cx, cy: lap0.cy, r: lap0.r, lapS: lap0.lapS, sgn: lap0.dir === 'cw' ? 1 : -1, prog: 0, lapT0: t, refitAt: t,
            nLaps: 0, last: lap0, prev: null, streak: [], reported: false, repCx: 0, repCy: 0, repR: 0 };
          mkView();
          out.push({ type: 'engage', lap: lap0 });
        }
      }
      return out;
    }
    return { push: push, reset: reset, view: function () { return view; }, engaged: function () { return !!eng; } };
  }

  return { K: K, create: create, fitCircle: fitCircle, turned: turned, compass: compass, chipText: chipText, driftClass: driftClass,
    cleanLap: cleanLap, matchGuild: matchGuild, guildText: guildText, guildLabel: guildLabel, guildDot: guildDot };
});
